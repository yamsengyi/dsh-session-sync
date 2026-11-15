import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  SyncHttpError,
} from './protocol.js'
import { diffManifests, scanWorkspace, toWireManifest } from './manifest.js'

export const STATE_DIR = '.dsh-sync'
const BASE_FILE = 'base.json'

function basePath(root) {
  return join(root, STATE_DIR, BASE_FILE)
}

/** Read the manifest this PC last applied, or undefined when it never pulled. */
export async function readBase(root) {
  try {
    return JSON.parse(await readFile(basePath(root), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function writeBase(root, value) {
  const file = basePath(root)
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, file)
}

/** Resolve a manifest path under root, refusing anything that escapes it. */
export function safeJoin(root, relativePath) {
  const segments = relativePath.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`unsafe manifest path: ${relativePath}`)
  }
  const target = join(root, ...segments)
  const check = relative(root, target)
  if (check.startsWith('..') || isAbsolute(check)) throw new Error(`path escapes workspace: ${relativePath}`)
  return target
}

function manifestEquals(a, b) {
  const leftFiles = a.files ?? []
  const rightFiles = b.files ?? []
  if (leftFiles.length !== rightFiles.length) return false
  for (let index = 0; index < leftFiles.length; index += 1) {
    if (leftFiles[index].path !== rightFiles[index].path) return false
    if (leftFiles[index].blob !== rightFiles[index].blob) return false
  }
  const leftDirs = a.dirs ?? []
  const rightDirs = b.dirs ?? []
  if (leftDirs.length !== rightDirs.length) return false
  for (let index = 0; index < leftDirs.length; index += 1) {
    if (leftDirs[index] !== rightDirs[index]) return false
  }
  return true
}

/**
 * HTTP client for one hub. Plain fetch, no dependency on the DSH runtime, so
 * the same class serves the Host plugin and local tests.
 */
export class SyncClient {
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, logger = console }) {
    if (!baseUrl) throw new Error('SyncClient requires baseUrl')
    if (!token) throw new Error('SyncClient requires token')
    if (typeof fetchImpl !== 'function') throw new Error('SyncClient requires a fetch implementation')
    this.baseUrl = String(baseUrl).replace(/\/+$/, '')
    this.token = token
    this.fetch = fetchImpl
    this.logger = logger
  }

  async request(path, options = {}) {
    const headers = {
      authorization: `Bearer ${this.token}`,
      [PROTOCOL_HEADER]: PROTOCOL_VERSION,
      ...(options.headers ?? {}),
    }
    const init = { method: options.method ?? 'GET', headers }
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body)
      headers['content-type'] = 'application/json'
    } else if (options.raw !== undefined) {
      init.body = options.raw
      init.duplex = 'half'
      headers['content-type'] = 'application/octet-stream'
    }
    const response = await this.fetch(`${this.baseUrl}${path}`, init)
    if (!response.ok) {
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      const error = payload?.error ?? {}
      throw new SyncHttpError(
        response.status,
        error.code ?? 'http-error',
        error.message ?? `${response.status} ${response.statusText}`,
        error.detail,
      )
    }
    return response
  }

  async json(path, options) {
    return (await this.request(path, options)).json()
  }

  async health() {
    return this.json('/v1/health')
  }

  async session(id) {
    try {
      return await this.json(`/v1/sessions/${encodeURIComponent(id)}`)
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 404) return undefined
      throw error
    }
  }

  async sessions() {
    return this.json('/v1/sessions')
  }

  async pushSession({ header, events, expectHead }) {
    return this.json(`/v1/sessions/${encodeURIComponent(header.id)}/events`, {
      method: 'POST',
      body: { header, events, expectHead },
    })
  }

  async pullSession(id, after = 0, limit = 500) {
    return this.json(`/v1/sessions/${encodeURIComponent(id)}/events?after=${after}&limit=${limit}`)
  }

  async head(folderId) {
    return this.json(`/v1/folders/${encodeURIComponent(folderId)}/head`)
  }

  async folders() {
    return this.json('/v1/folders')
  }

  async missingBlobs(folderId, hashes) {
    if (hashes.length === 0) return { missing: [] }
    return this.json(`/v1/folders/${encodeURIComponent(folderId)}/blobs/missing`, {
      method: 'POST',
      body: { hashes },
    })
  }

  async uploadBlob(folderId, sha, file) {
    const info = await stat(file)
    await this.request(`/v1/folders/${encodeURIComponent(folderId)}/blobs/${sha}`, {
      method: 'PUT',
      raw: Readable.toWeb(createReadStream(file)),
      headers: { 'content-length': String(info.size) },
    })
  }

  async downloadBlob(folderId, sha, target) {
    const response = await this.request(`/v1/folders/${encodeURIComponent(folderId)}/blobs/${sha}`)
    if (!response.body) throw new Error(`hub returned no body for blob ${sha}`)
    await mkdir(dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temp))
      await rename(temp, target)
    } finally {
      await rm(temp, { force: true })
    }
  }

  async checkpoints(folderId, after = 0) {
    return this.json(`/v1/folders/${encodeURIComponent(folderId)}/checkpoints?after=${after}`)
  }

  async checkpoint(folderId, version) {
    return this.json(`/v1/folders/${encodeURIComponent(folderId)}/checkpoints/${version}`)
  }

  /**
   * Commit the current workspace as the next checkpoint.
   *
   * Uploads only missing blobs, then references them from the manifest. The
   * local base manifest is updated so a later pull compares against what this
   * PC actually shows.
   */
  async pushCheckpoint(folderId, root, options = {}) {
    const scan = await scanWorkspace(root, {
      maxFileBytes: options.maxFileBytes,
      maxFiles: options.maxFiles,
      ignore: options.ignore,
      logger: this.logger,
    })
    const wire = toWireManifest(scan)

    // Nothing changed since the checkpoint this PC already applied: keep the
    // history clean instead of committing an identical manifest again.
    const head = await this.head(folderId)
    const base = await readBase(root)
    if (!options.force && base && base.folderId === folderId && base.version === head.version && manifestEquals(base, wire)) {
      return { skipped: true, version: head.version, fileCount: wire.files.length, warnings: scan.warnings }
    }

    const unique = [...new Set(scan.files.map((file) => file.blob))]
    const { missing } = await this.missingBlobs(folderId, unique)
    const byHash = new Map()
    for (const file of scan.files) if (!byHash.has(file.blob)) byHash.set(file.blob, file)
    for (const sha of missing) {
      const file = byHash.get(sha)
      if (!file) throw new Error(`missing blob ${sha} has no local file`)
      await this.uploadBlob(folderId, sha, file.abs)
    }
    const result = await this.json(`/v1/folders/${encodeURIComponent(folderId)}/checkpoints`, {
      method: 'POST',
      body: {
        name: options.name ?? basename(root),
        checkpoint: {
          sessionId: options.sessionId ?? null,
          seq: options.seq ?? 0,
          message: options.message ?? '',
          author: options.author ?? '',
          files: wire.files,
          dirs: wire.dirs,
        },
      },
    })
    await writeBase(root, { folderId, version: result.version, files: wire.files, dirs: wire.dirs })
    return { ...result, fileCount: wire.files.length, warnings: scan.warnings }
  }

  /**
   * Apply the hub's newest checkpoint to a workspace.
   *
   * @returns {{changed: boolean, version: number, writes?: number, removes?: number, conflicts?: Array<object>}}
   */
  async pullCheckpoint(folderId, root, options = {}) {
    const head = await this.head(folderId)
    const base = await readBase(root)
    const usableBase = base && base.folderId === folderId ? base : undefined
    if (!options.force && usableBase && usableBase.version >= head.version) {
      return { changed: false, version: head.version }
    }
    if (!head.version) return { changed: false, version: 0 }

    const remote = await this.checkpoint(folderId, head.version)
    const local = await scanWorkspace(root, {
      maxFileBytes: options.maxFileBytes,
      maxFiles: options.maxFiles,
      ignore: options.ignore,
      logger: this.logger,
    })
    const plan = diffManifests(usableBase?.files ?? [], local.files, remote.files)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const conflicts = []
    for (const conflict of plan.conflicts) {
      if (!conflict.remoteBlob) {
        conflicts.push({ ...conflict, savedAs: null })
        continue
      }
      const saved = safeJoin(root, `${STATE_DIR}/conflicts/${stamp}/${conflict.path}`)
      await this.downloadBlob(folderId, conflict.remoteBlob, saved)
      conflicts.push({ ...conflict, savedAs: relative(root, saved) })
    }

    for (const path of plan.remove) {
      await rm(safeJoin(root, path), { force: true })
    }
    for (const file of plan.write) {
      const target = safeJoin(root, file.path)
      await this.downloadBlob(folderId, file.blob, target)
      if (file.executable) await chmod(target, 0o755).catch(() => undefined)
    }
    for (const dir of remote.dirs ?? []) {
      await mkdir(safeJoin(root, dir), { recursive: true })
    }

    await writeBase(root, {
      folderId,
      version: head.version,
      files: remote.files ?? [],
      dirs: remote.dirs ?? [],
    })
    return {
      changed: true,
      version: head.version,
      writes: plan.write.length,
      removes: plan.remove.length,
      conflicts,
    }
  }
}
