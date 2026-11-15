#!/usr/bin/env node
/**
 * Standalone dsh-sync hub.
 *
 * The same `createHubServer` the DSH plugin uses, without a DSH Host: run it
 * on a domain server behind a TLS reverse proxy and point every client's
 * `hubUrl` at that domain.
 *
 * Environment:
 *   DSH_SYNC_DATA_DIR  storage directory (default $DSH_HOME/dsh-sync/hub)
 *   DSH_SYNC_HOST      bind address (default 127.0.0.1)
 *   DSH_SYNC_PORT      bind port (default 8787)
 *   DSH_SYNC_TOKENS    "name:token,name:token" or a JSON [{name,token}] array
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHubServer } from '../src/hub-server.js'

function parseTokens(raw) {
  if (!raw || raw.trim() === '') return []
  const text = raw.trim()
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error('DSH_SYNC_TOKENS JSON must be an array')
    return parsed.map((entry) => {
      if (typeof entry === 'string') return { name: 'device', token: entry }
      if (entry && typeof entry.token === 'string') return { name: String(entry.name ?? 'device'), token: entry.token }
      throw new Error('each DSH_SYNC_TOKENS entry must be a token string or {name,token}')
    })
  }
  return text.split(',').map((pair) => {
    const trimmed = pair.trim()
    const index = trimmed.indexOf(':')
    if (index < 0) return { name: 'device', token: trimmed }
    return { name: trimmed.slice(0, index), token: trimmed.slice(index + 1) }
  })
}

const dataDir = process.env.DSH_SYNC_DATA_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-sync', 'hub')
const host = process.env.DSH_SYNC_HOST || '127.0.0.1'
const port = Number(process.env.DSH_SYNC_PORT ?? 8787)
const tokens = parseTokens(process.env.DSH_SYNC_TOKENS)

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[dsh-sync] invalid DSH_SYNC_PORT: ${process.env.DSH_SYNC_PORT}`)
  process.exit(1)
}
if (tokens.length === 0) {
  console.warn('[dsh-sync] no preconfigured tokens; enroll devices with the pairing code')
}

const hub = await createHubServer({ dataDir, host, port, tokens, logger: console })
console.log(`[dsh-sync] hub listening on ${hub.url} (data ${dataDir}, ${tokens.length} device token(s))`)
const pairingCode = hub.pairingCode()
if (pairingCode) {
  console.log(`[dsh-sync] pairing code: ${pairingCode} (also in ${join(dataDir, 'pairing-code.txt')})`)
}

let closing = false
async function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(`[dsh-sync] ${signal} received; closing`)
  try {
    await hub.close()
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
