import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256File } from './protocol.js'
import { buildRules, isIgnored } from './ignore.js'

export const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024
export const DEFAULT_MAX_FILES = 20_000

/**
 * Walk one workspace directory and build a content-addressed manifest.
 *
 * Files are sorted by path. Symlinks and files above `maxFileBytes` are
 * skipped with a warning: following a link could escape the workspace, and a
 * single huge file should not silently dominate a snapshot.
 *
 * @returns {{ root: string, files: Array<{path: string, blob: string, size: number, executable: boolean, abs: string}>, dirs: string[], warnings: Array<{path: string, reason: string}> }}
 */
export async function scanWorkspace(root, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const logger = options.logger

  const info = await stat(root)
  if (!info.isDirectory()) throw new Error(`not a directory: ${root}`)

  let ignoreText = ''
  try {
    ignoreText = await readFile(join(root, '.dshsyncignore'), 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const rules = buildRules(ignoreText, options.ignore ?? [])

  const files = []
  const dirs = []
  const warnings = []

  async function walk(directory, relative) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      warnings.push({ path: relative || '.', reason: `cannot list directory: ${error?.code ?? error?.message ?? error}` })
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        warnings.push({ path, reason: 'symlink skipped' })
        continue
      }
      if (entry.isDirectory()) {
        if (isIgnored(rules, path, true)) continue
        dirs.push(path)
        await walk(join(directory, entry.name), path)
        continue
      }
      if (!entry.isFile()) {
        warnings.push({ path, reason: 'not a regular file' })
        continue
      }
      if (isIgnored(rules, path, false)) continue
      if (files.length >= maxFiles) {
        throw new Error(`workspace has more than ${maxFiles} files; raise maxFiles or ignore directories`)
      }
      const absolute = join(directory, entry.name)
      const metadata = await stat(absolute)
      if (metadata.size > maxFileBytes) {
        warnings.push({ path, reason: `larger than ${maxFileBytes} bytes; skipped` })
        continue
      }
      const blob = await sha256File(absolute)
      files.push({
        path,
        blob,
        size: metadata.size,
        executable: (metadata.mode & 0o111) !== 0,
        abs: absolute,
      })
    }
  }

  await walk(root, '')
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  dirs.sort()
  if (logger && warnings.length > 0) {
    for (const warning of warnings) logger.warn?.(`[session-sync] ${warning.path}: ${warning.reason}`)
  }
  return { root, files, dirs, warnings }
}

/** Strip local-only fields before sending a manifest over the wire or storing it. */
export function toWireManifest(scan) {
  return {
    files: scan.files.map(({ path, blob, size, executable }) => ({ path, blob, size, executable })),
    dirs: scan.dirs,
  }
}

function byPath(files) {
  const map = new Map()
  for (const file of files) map.set(file.path, file)
  return map
}

function same(a, b) {
  return (a?.blob ?? null) === (b?.blob ?? null)
}

/**
 * Three-way plan over base / local / remote manifests.
 *
 * `write` names files whose remote content wins; `remove` names local files
 * whose remote deletion wins; every other disagreement is a conflict that
 * keeps the local file and records the remote content separately.
 */
export function diffManifests(baseFiles, localFiles, remoteFiles) {
  const base = byPath(baseFiles)
  const local = byPath(localFiles)
  const remote = byPath(remoteFiles)
  const paths = new Set([...base.keys(), ...local.keys(), ...remote.keys()])
  const write = []
  const remove = []
  const conflicts = []

  for (const path of [...paths].sort()) {
    const b = base.get(path)
    const l = local.get(path)
    const r = remote.get(path)

    if (!r) {
      if (!l) continue
      // With no common base, remote absence cannot mean "delete": the folder
      // may hold work that was never uploaded. Keep local-only files.
      if (!b) continue
      if (same(l, b)) {
        remove.push(path)
        continue
      }
      conflicts.push({ path, remoteBlob: null, reason: 'remote-deleted' })
      continue
    }

    if (!l) {
      if (!b) {
        write.push(r)
        continue
      }
      if (same(b, r)) continue
      conflicts.push({ path, remoteBlob: r.blob, reason: 'local-deleted' })
      continue
    }

    if (same(l, r)) continue
    if (!b) {
      conflicts.push({ path, remoteBlob: r.blob, reason: 'both-added' })
      continue
    }
    if (same(l, b)) {
      write.push(r)
      continue
    }
    if (same(r, b)) continue
    conflicts.push({ path, remoteBlob: r.blob, reason: 'both-modified' })
  }

  return { write, remove, conflicts }
}
