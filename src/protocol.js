import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'

export const PROTOCOL_VERSION = '1'
export const PROTOCOL_HEADER = 'x-dsh-sync-protocol'

/**
 * Largest JSON request body the hub accepts (256 MiB).
 *
 * One session push carries the events appended since the previous push, so
 * this cap only binds a first push that backfills a very long session, or a
 * workspace checkpoint with an enormous manifest.
 */
export const MAX_JSON_BYTES = 256 * 1024 * 1024

/** One wire failure a client can classify without inspecting the message. */
export class SyncHttpError extends Error {
  constructor(status, code, message, detail) {
    super(message)
    this.name = 'SyncHttpError'
    this.status = status
    this.code = code
    this.detail = detail
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.detail === undefined ? {} : { detail: this.detail }) } }
  }
}

export function fail(status, code, message, detail) {
  throw new SyncHttpError(status, code, message, detail)
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** Hash one file without loading it into memory. */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export function hashToken(token) {
  return sha256Hex(String(token))
}

/** Constant-time comparison of a presented token against a stored hash. */
export function tokenMatches(expectedHash, presented) {
  const expected = Buffer.from(expectedHash, 'hex')
  const actual = Buffer.from(hashToken(presented), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function bearerToken(request) {
  const header = request.headers?.authorization
  if (typeof header !== 'string') return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]
}

export function sendJson(response, status, payload) {
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

export function sendError(response, error) {
  const status = error instanceof SyncHttpError ? error.status : 500
  const body = error instanceof SyncHttpError
    ? error.toJSON()
    : { error: { code: 'internal', message: error?.message ? String(error.message) : 'internal error' } }
  sendJson(response, status, body)
}

export async function readJsonBody(request, limit = MAX_JSON_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) fail(413, 'body-too-large', `request body exceeds ${limit} bytes`)
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    fail(400, 'invalid-json', 'request body is not valid JSON')
  }
}

/** Reject ids that could escape the hub's data directory. */
export function assertSafeId(id, kind = 'id') {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    fail(400, 'invalid-id', `${kind} must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}`)
  }
  return id
}

/** Manifests use POSIX relative paths only. */
export function assertSafeRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096) {
    fail(400, 'invalid-path', 'manifest path must be a non-empty string of at most 4096 characters')
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.includes('\0')) {
    fail(400, 'invalid-path', `manifest path is not POSIX relative: ${path}`)
  }
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(400, 'invalid-path', `manifest path contains an unsafe segment: ${path}`)
  }
  return path
}

export function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}
