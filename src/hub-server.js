import { createServer } from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  SyncHttpError,
  assertSafeId,
  assertSafeRelativePath,
  bearerToken,
  fail,
  hashToken,
  isSha256,
  readJsonBody,
  sendError,
  sendJson,
  sha256Hex,
  sha256File,
  tokenMatches,
} from './protocol.js'

const DEFAULT_LIST_LIMIT = 500
const MAX_LIST_LIMIT = 1000
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makePairingCode() {
  const bytes = randomBytes(8)
  let code = ''
  for (let index = 0; index < 8; index += 1) code += PAIRING_ALPHABET[bytes[index] % PAIRING_ALPHABET.length]
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function normalizePairingCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function cleanDeviceName(value) {
  const name = String(value ?? '').trim()
  return (name || 'device').slice(0, 64)
}

function sameSecret(a, b) {
  const left = Buffer.from(sha256Hex(String(a)), 'hex')
  const right = Buffer.from(sha256Hex(String(b)), 'hex')
  return timingSafeEqual(left, right)
}

function intQuery(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

/**
 * Durable, single-user hub storage.
 *
 * Layout under `dataDir`:
 *   folders/<id>/folder.json    checkpoint index (manifests inline)
 *   folders/<id>/blobs/<sha>    content-addressed file bytes
 *   sessions/<id>/meta.json     immutable header plus the committed head
 *   sessions/<id>/events.jsonl  append-only session log
 */
export class HubStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.locks = new Map()
    this.state = undefined
  }

  async init() {
    await mkdir(join(this.dataDir, 'sessions'), { recursive: true })
    await mkdir(join(this.dataDir, 'folders'), { recursive: true })
    await this.loadState()
    await this.reconcileSessions()
  }

  statePath() {
    return join(this.dataDir, 'hub-state.json')
  }

  /**
   * Load the durable hub identity: paired devices and the current pairing code.
   * A first start creates both, so a fresh hub is immediately pairable.
   */
  async loadState() {
    let state
    try {
      state = JSON.parse(await readFile(this.statePath(), 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (!state || typeof state !== 'object') state = { version: 1, createdAt: Date.now(), devices: [] }
    if (!Array.isArray(state.devices)) state.devices = []
    if (!state.pairing || typeof state.pairing.code !== 'string') {
      state.pairing = { code: makePairingCode(), createdAt: Date.now() }
    }
    state.version = 1
    this.state = state
    await this.saveState()
    await this.writePairingCodeFile()
  }

  async saveState() {
    await this.writeJsonAtomic(this.statePath(), this.state)
  }

  async writePairingCodeFile() {
    try {
      await writeFile(join(this.dataDir, 'pairing-code.txt'), `${this.state.pairing.code}\n`, 'utf8')
    } catch {
      // The state file is authoritative; the text file is a convenience.
    }
  }

  pairingCode() {
    return this.state?.pairing?.code
  }

  devices() {
    return this.state?.devices ?? []
  }

  async addDevice(name) {
    return this.withLock('state', async () => {
      const token = randomBytes(32).toString('hex')
      const device = { name: cleanDeviceName(name), hash: hashToken(token), createdAt: Date.now() }
      this.state.devices.push(device)
      await this.saveState()
      return { token, device: device.name }
    })
  }

  async rotatePairing() {
    return this.withLock('state', async () => {
      this.state.pairing = { code: makePairingCode(), createdAt: Date.now() }
      await this.saveState()
      await this.writePairingCodeFile()
      return this.state.pairing.code
    })
  }

  /**
   * Repair every stored session after an unclean stop.
   *
   * A crash can leave a torn final JSONL line after the last successful
   * append, or a stale `meta.head` when the append landed but the metadata
   * write did not. The log is the authority: drop an unparsable trailing
   * fragment, then set the head to the number of complete records.
   */
  async reconcileSessions() {
    const root = join(this.dataDir, 'sessions')
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) await this.reconcileSession(entry.name)
    }
  }

  async reconcileSession(id) {
    const meta = await this.loadSession(id)
    if (!meta) return
    const file = join(this.sessionDir(id), 'events.jsonl')
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      if ((meta.head ?? 0) !== 0) await this.saveSessionMeta(id, { ...meta, head: 0 })
      return
    }
    let repaired = text
    if (repaired.length > 0 && !repaired.endsWith('\n')) {
      const lastNewline = repaired.lastIndexOf('\n')
      repaired = lastNewline < 0 ? '' : repaired.slice(0, lastNewline + 1)
    }
    const lines = repaired === '' ? [] : repaired.slice(0, -1).split('\n')
    let count = lines.length
    while (count > 0) {
      try {
        JSON.parse(lines[count - 1])
        break
      } catch {
        count -= 1
      }
    }
    if (count !== lines.length) {
      repaired = count === 0 ? '' : `${lines.slice(0, count).join('\n')}\n`
    }
    if (repaired !== text) await writeFile(file, repaired, 'utf8')
    if ((meta.head ?? 0) !== count) await this.saveSessionMeta(id, { ...meta, head: count })
  }

  async withLock(key, operation) {
    const previous = this.locks.get(key) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    this.locks.set(key, run.then(() => undefined, () => undefined))
    return run
  }

  async writeJsonAtomic(file, value) {
    const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temp, file)
  }

  folderDir(id) {
    return join(this.dataDir, 'folders', id)
  }

  async loadFolder(id) {
    try {
      return JSON.parse(await readFile(join(this.folderDir(id), 'folder.json'), 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  }

  async saveFolder(folder) {
    folder.updatedAt = Date.now()
    await this.writeJsonAtomic(join(this.folderDir(folder.id), 'folder.json'), folder)
  }

  async listFolders() {
    const root = join(this.dataDir, 'folders')
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const folders = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const folder = await this.loadFolder(entry.name)
      if (folder) {
        folders.push({
          id: folder.id,
          name: folder.name,
          headVersion: folder.headVersion ?? 0,
          updatedAt: folder.updatedAt ?? folder.createdAt ?? 0,
          checkpointCount: folder.checkpoints?.length ?? 0,
        })
      }
    }
    return folders.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }

  blobPath(folderId, sha) {
    return join(this.folderDir(folderId), 'blobs', sha)
  }

  async blobExists(folderId, sha) {
    try {
      return (await stat(this.blobPath(folderId, sha))).isFile()
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw error
    }
  }

  async putBlob(folderId, sha, request) {
    if (!isSha256(sha)) fail(400, 'invalid-hash', 'blob hash must be 64 lowercase hex characters')
    const directory = join(this.folderDir(folderId), 'blobs')
    await mkdir(directory, { recursive: true })
    const target = this.blobPath(folderId, sha)
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      await pipeline(request, createWriteStream(temp))
      const actual = await sha256File(temp)
      if (actual !== sha) fail(400, 'digest-mismatch', `blob digest ${actual} does not match ${sha}`)
      await rename(temp, target)
      return (await stat(target)).size
    } finally {
      await rm(temp, { force: true })
    }
  }

  async addCheckpoint(folderId, checkpoint, folderName) {
    return this.withLock(`folder:${folderId}`, async () => {
      let folder = await this.loadFolder(folderId)
      if (!folder) {
        folder = {
          id: folderId,
          name: typeof folderName === 'string' && folderName.trim() ? folderName.trim().slice(0, 200) : folderId,
          headVersion: 0,
          checkpoints: [],
          createdAt: Date.now(),
        }
      }
      const uniqueBlobs = [...new Set(checkpoint.files.map((file) => file.blob))]
      const missing = []
      for (const blob of uniqueBlobs) {
        if (!(await this.blobExists(folderId, blob))) missing.push(blob)
      }
      if (missing.length > 0) {
        fail(409, 'missing-blobs', 'the checkpoint references blobs the hub does not have', { missing })
      }
      const version = (folder.headVersion ?? 0) + 1
      const record = {
        version,
        id: randomUUID(),
        sessionId: checkpoint.sessionId,
        seq: checkpoint.seq,
        message: checkpoint.message,
        author: checkpoint.author,
        createdAt: checkpoint.createdAt ?? Date.now(),
        files: checkpoint.files,
        dirs: checkpoint.dirs,
      }
      folder.checkpoints.push(record)
      folder.headVersion = version
      await this.saveFolder(folder)
      return { version, checkpointId: record.id, headVersion: version }
    })
  }

  sessionDir(id) {
    return join(this.dataDir, 'sessions', id)
  }

  async loadSession(id) {
    try {
      return JSON.parse(await readFile(join(this.sessionDir(id), 'meta.json'), 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  }

  async saveSessionMeta(id, meta) {
    await this.writeJsonAtomic(join(this.sessionDir(id), 'meta.json'), meta)
  }

  async listSessions() {
    const root = join(this.dataDir, 'sessions')
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const sessions = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const meta = await this.loadSession(entry.name)
      if (meta) sessions.push({ id: entry.name, header: meta.header, head: meta.head })
    }
    return sessions.sort((a, b) => (a.header?.createdAt ?? 0) - (b.header?.createdAt ?? 0))
  }

  async appendSessionEvents(id, header, events, expectHead) {
    return this.withLock(`session:${id}`, async () => {
      let meta = await this.loadSession(id)
      if (!meta) {
        if (!header || typeof header !== 'object' || header.id !== id) {
          fail(400, 'invalid-header', 'the first push must carry a header whose id matches the path')
        }
        meta = { header, head: 0 }
        await this.saveSessionMeta(id, meta)
      }
      const head = meta.head
      if (expectHead !== undefined && expectHead !== null && expectHead !== head) {
        throw new SyncHttpError(409, 'head-mismatch', `session head is ${head}, not ${expectHead}`, { head })
      }
      const incoming = events
        .filter((event) => Number.isInteger(event?.seq) && event.seq >= head)
        .sort((a, b) => a.seq - b.seq)
      if (incoming.length === 0) return head
      if (incoming[0].seq !== head) {
        throw new SyncHttpError(409, 'gap', `first accepted event is seq ${incoming[0].seq}, head is ${head}`, { head })
      }
      for (let index = 1; index < incoming.length; index += 1) {
        if (incoming[index].seq !== incoming[index - 1].seq + 1) {
          throw new SyncHttpError(409, 'gap', `event seq is not contiguous at ${incoming[index].seq}`, { head })
        }
      }
      const file = join(this.sessionDir(id), 'events.jsonl')
      await mkdir(this.sessionDir(id), { recursive: true })
      await appendFile(file, incoming.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8')
      meta.head = head + incoming.length
      await this.saveSessionMeta(id, meta)
      return meta.head
    })
  }

  async readSessionEvents(id, after, limit) {
    const meta = await this.loadSession(id)
    if (!meta) fail(404, 'session-not-found', `session ${id} is not stored on this hub`)
    let all = []
    try {
      const text = await readFile(join(this.sessionDir(id), 'events.jsonl'), 'utf8')
      const lines = text.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (line === '') continue
        try {
          all.push(JSON.parse(line))
        } catch {
          // A live copy can capture a partially written final line; ignore it.
          if (index === lines.length - 1) break
          throw new Error(`session ${id} has a corrupt log line at ${index + 1}`)
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const start = Math.min(after, all.length)
    const events = all.slice(start, start + limit)
    return {
      header: meta.header,
      head: meta.head,
      events,
      nextAfter: start + events.length < all.length ? start + events.length : null,
    }
  }

  async head(folderId) {
    const folder = await this.loadFolder(folderId)
    if (!folder) return { version: 0, checkpointId: null, updatedAt: null }
    const last = folder.checkpoints?.[folder.checkpoints.length - 1]
    return { version: folder.headVersion ?? 0, checkpointId: last?.id ?? null, updatedAt: folder.updatedAt ?? null }
  }

  async listCheckpoints(folderId, after) {
    const folder = await this.loadFolder(folderId)
    if (!folder) return { headVersion: 0, checkpoints: [] }
    const checkpoints = (folder.checkpoints ?? [])
      .filter((checkpoint) => checkpoint.version > after)
      .map(({ files, dirs, ...rest }) => ({ ...rest, fileCount: files?.length ?? 0 }))
    return { headVersion: folder.headVersion ?? 0, checkpoints }
  }

  async getCheckpoint(folderId, version) {
    const folder = await this.loadFolder(folderId)
    const checkpoint = folder?.checkpoints?.find((entry) => entry.version === version)
    if (!checkpoint) fail(404, 'checkpoint-not-found', `checkpoint ${version} is not stored for ${folderId}`)
    return checkpoint
  }
}

function normalizeCheckpoint(raw) {
  if (!raw || typeof raw !== 'object') fail(400, 'invalid-checkpoint', 'checkpoint must be an object')
  if (!Array.isArray(raw.files)) fail(400, 'invalid-checkpoint', 'checkpoint.files must be an array')
  const seen = new Set()
  const files = raw.files.map((file) => {
    if (!file || typeof file !== 'object') fail(400, 'invalid-file', 'every checkpoint file must be an object')
    assertSafeRelativePath(file.path)
    if (seen.has(file.path)) fail(400, 'duplicate-path', `duplicate manifest path: ${file.path}`)
    seen.add(file.path)
    if (!isSha256(file.blob)) fail(400, 'invalid-hash', `invalid blob hash for ${file.path}`)
    const size = Number.isInteger(file.size) && file.size >= 0 ? file.size : 0
    return { path: file.path, blob: file.blob, size, executable: Boolean(file.executable) }
  })
  const dirs = Array.isArray(raw.dirs)
    ? [...new Set(raw.dirs.map((dir) => assertSafeRelativePath(dir)))].sort()
    : []
  return {
    sessionId: typeof raw.sessionId === 'string' ? assertSafeId(raw.sessionId, 'sessionId') : null,
    seq: Number.isInteger(raw.seq) && raw.seq >= 0 ? raw.seq : 0,
    message: typeof raw.message === 'string' ? raw.message.slice(0, 500) : '',
    author: typeof raw.author === 'string' ? raw.author.slice(0, 100) : '',
    files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    dirs,
  }
}

/**
 * Start one hub listener.
 *
 * @param {object} options
 * @param {string} options.dataDir - hub storage directory
 * @param {string} [options.host] - concrete bind address
 * @param {number} [options.port] - bind port; 0 asks the OS
 * @param {Array<{name: string, token: string}>} [options.tokens] - device tokens
 * @param {Console} [options.logger]
 */
export async function createHubServer(options) {
  const { dataDir, host = '127.0.0.1', port = 8787, tokens = [], logger = console } = options
  if (!dataDir) throw new Error('createHubServer requires dataDir')
  const store = new HubStore(dataDir)
  await store.init()

  const devices = tokens
    .filter((entry) => entry && typeof entry.token === 'string' && entry.token.length > 0)
    .map((entry) => ({ name: typeof entry.name === 'string' && entry.name ? entry.name : 'device', hash: hashToken(entry.token) }))

  const authenticate = (request) => {
    const presented = bearerToken(request)
    if (!presented) return undefined
    for (const device of devices) {
      if (tokenMatches(device.hash, presented)) return device.name
    }
    for (const device of store.devices()) {
      if (tokenMatches(device.hash, presented)) return device.name
    }
    return undefined
  }

  const pairAttempts = new Map()
  const allowPairAttempt = (ip) => {
    const now = Date.now()
    const entry = pairAttempts.get(ip) ?? { count: 0, reset: now + 60_000 }
    if (now >= entry.reset) {
      entry.count = 0
      entry.reset = now + 60_000
    }
    entry.count += 1
    pairAttempts.set(ip, entry)
    return entry.count <= 20
  }

  const handle = async (request, response) => {
    const url = new URL(request.url, 'http://hub')
    const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
    const declared = request.headers[PROTOCOL_HEADER]
    if (declared !== undefined && declared !== PROTOCOL_VERSION) {
      fail(426, 'protocol-mismatch', `this hub speaks protocol ${PROTOCOL_VERSION}`)
    }
    if (parts[0] !== 'v1') fail(404, 'not-found', 'unknown route')
    if (parts[1] === 'health' && parts.length === 2 && request.method === 'GET') {
      sendJson(response, 200, { ok: true, protocol: PROTOCOL_VERSION })
      return
    }
    if (parts[1] === 'pair' && parts.length === 2 && request.method === 'POST') {
      const ip = request.socket?.remoteAddress ?? 'unknown'
      if (!allowPairAttempt(ip)) fail(429, 'pairing-rate-limited', 'too many pairing attempts; retry in a minute')
      const body = await readJsonBody(request, 64 * 1024)
      const current = normalizePairingCode(store.pairingCode())
      const presented = normalizePairingCode(body.code)
      if (!current || !sameSecret(presented, current)) {
        fail(403, 'pairing-code-invalid', 'pairing code is not valid')
      }
      const result = await store.addDevice(body.name)
      sendJson(response, 200, { ok: true, token: result.token, device: result.device })
      return
    }
    const device = authenticate(request)
    if (!device) fail(401, 'unauthorized', 'a valid device token is required')

    if (parts[1] === 'pair' && parts.length === 2 && request.method === 'GET') {
      sendJson(response, 200, { code: store.pairingCode() })
      return
    }
    if (parts[1] === 'pair' && parts.length === 3 && parts[2] === 'rotate' && request.method === 'POST') {
      sendJson(response, 200, { code: await store.rotatePairing() })
      return
    }

    if (parts[1] === 'sessions') {
      if (parts.length === 2 && request.method === 'GET') {
        sendJson(response, 200, { sessions: await store.listSessions() })
        return
      }
      const id = assertSafeId(parts[2])
      if (parts.length === 3 && request.method === 'GET') {
        const meta = await store.loadSession(id)
        if (!meta) fail(404, 'session-not-found', `session ${id} is not stored on this hub`)
        sendJson(response, 200, { header: meta.header, head: meta.head })
        return
      }
      if (parts.length === 4 && parts[3] === 'events' && request.method === 'POST') {
        const body = await readJsonBody(request)
        const events = Array.isArray(body.events) ? body.events : []
        const head = await store.appendSessionEvents(id, body.header, events, body.expectHead)
        sendJson(response, 200, { head })
        return
      }
      if (parts.length === 4 && parts[3] === 'events' && request.method === 'GET') {
        const after = intQuery(url.searchParams.get('after'), 0)
        const limit = Math.min(Math.max(intQuery(url.searchParams.get('limit'), DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT)
        sendJson(response, 200, await store.readSessionEvents(id, after, limit))
        return
      }
      fail(404, 'not-found', 'unknown session route')
    }

    if (parts[1] === 'folders') {
      if (parts.length === 2 && request.method === 'GET') {
        sendJson(response, 200, { folders: await store.listFolders() })
        return
      }
      const folderId = assertSafeId(parts[2], 'folderId')
      if (parts.length === 4 && parts[3] === 'head' && request.method === 'GET') {
        sendJson(response, 200, await store.head(folderId))
        return
      }
      if (parts.length === 5 && parts[3] === 'blobs' && parts[4] === 'missing' && request.method === 'POST') {
        const body = await readJsonBody(request)
        const hashes = Array.isArray(body.hashes) ? body.hashes : []
        const missing = []
        for (const hash of hashes) {
          if (!isSha256(hash)) fail(400, 'invalid-hash', `invalid blob hash: ${hash}`)
          if (!(await store.blobExists(folderId, hash))) missing.push(hash)
        }
        sendJson(response, 200, { missing })
        return
      }
      if (parts.length === 5 && parts[3] === 'blobs' && request.method === 'PUT') {
        const size = await store.putBlob(folderId, parts[4], request)
        sendJson(response, 200, { sha: parts[4], size })
        return
      }
      if (parts.length === 5 && parts[3] === 'blobs' && request.method === 'GET') {
        const sha = parts[4]
        if (!isSha256(sha)) fail(400, 'invalid-hash', 'blob hash must be 64 lowercase hex characters')
        const path = store.blobPath(folderId, sha)
        let info
        try {
          info = await stat(path)
        } catch (error) {
          if (error?.code === 'ENOENT') fail(404, 'blob-not-found', `blob ${sha} is not stored for ${folderId}`)
          throw error
        }
        if (!info.isFile()) fail(404, 'blob-not-found', `blob ${sha} is not a file`)
        response.statusCode = 200
        response.setHeader('content-type', 'application/octet-stream')
        response.setHeader('content-length', info.size)
        response.setHeader('cache-control', 'no-store')
        createReadStream(path).pipe(response)
        return
      }
      if (parts.length === 4 && parts[3] === 'checkpoints' && request.method === 'POST') {
        const body = await readJsonBody(request)
        const result = await store.addCheckpoint(folderId, normalizeCheckpoint(body.checkpoint), body.name)
        sendJson(response, 201, result)
        return
      }
      if (parts.length === 4 && parts[3] === 'checkpoints' && request.method === 'GET') {
        const after = intQuery(url.searchParams.get('after'), 0)
        sendJson(response, 200, await store.listCheckpoints(folderId, after))
        return
      }
      if (parts.length === 5 && parts[3] === 'checkpoints' && request.method === 'GET') {
        const version = Number(parts[4])
        if (!Number.isInteger(version) || version < 1) fail(400, 'invalid-version', 'checkpoint version must be a positive integer')
        sendJson(response, 200, await store.getCheckpoint(folderId, version))
        return
      }
      fail(404, 'not-found', 'unknown folder route')
    }

    fail(404, 'not-found', 'unknown route')
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (!(error instanceof SyncHttpError) || error.status >= 500) {
        logger.error?.(`[session-sync] ${request.method} ${request.url} failed: ${error?.stack ?? error}`)
      }
      sendError(response, error)
    })
  })
  server.on('clientError', (_error, socket) => socket.destroy())

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const actualPort = server.address().port
  const urlHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host.includes(':') ? `[${host}]` : host

  return {
    store,
    server,
    port: actualPort,
    host,
    url: `http://${urlHost}:${actualPort}`,
    pairingCode: () => store.pairingCode(),
    close: async () => {
      await new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
    },
  }
}

/**
 * Create or load the durable hub state without binding a listener. `init-hub`
 * uses it to mint the first pairing code before DSH starts.
 */
export async function ensureHubState(dataDir) {
  const store = new HubStore(dataDir)
  await store.init()
  return { dataDir, pairingCode: store.pairingCode() }
}
