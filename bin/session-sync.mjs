#!/usr/bin/env node
/**
 * dsh-session-sync setup CLI.
 *
 * `init-hub` writes the marker that makes the DSH plugin start a hub, and mints
 * the first pairing code. `pair` exchanges that code for a device token and
 * writes the client marker, so no profile patch or manual token copy is needed.
 */

import { hostname, homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { ensureHubState } from '../src/hub-server.js'

function defaultDataDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-sync')
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      args._.push(token)
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      index += 1
    }
  }
  return args
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function writeJsonAtomic(path, value) {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

function hubBase(value) {
  return String(value).replace(/\/+$/, '')
}

async function initHub(args) {
  const dataDir = args['data-dir'] || defaultDataDir()
  const host = args.host || '0.0.0.0'
  const port = Number(args.port ?? 8787)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be 1..65535')
  const hubDir = join(dataDir, 'hub')
  await mkdir(dataDir, { recursive: true })
  const configFile = join(dataDir, 'hub.json')
  const existing = await readJson(configFile)
  await writeJsonAtomic(configFile, {
    enabled: true,
    host,
    port,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  })
  const state = await ensureHubState(hubDir)
  console.log(`hub config: ${configFile}`)
  console.log(`data dir:   ${hubDir}`)
  console.log(`pairing:    ${state.pairingCode}`)
  console.log(`code file:  ${join(hubDir, 'pairing-code.txt')}`)
  console.log('')
  console.log('next: start DSH on this machine; the hub starts automatically.')
  console.log('then pair each client:')
  console.log(`  node bin/session-sync.mjs pair --hub http://<this-host>:${port} --code ${state.pairingCode} --name <device>`)
}

async function pair(args) {
  const dataDir = args['data-dir'] || defaultDataDir()
  const hubUrl = hubBase(args.hub || '')
  const code = args.code
  const name = args.name || hostname()
  if (!hubUrl || !code) throw new Error('pair requires --hub <url> and --code <code>')
  const response = await fetch(`${hubUrl}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`pairing failed: ${payload?.error?.message ?? response.status}`)
  await mkdir(dataDir, { recursive: true })
  const file = join(dataDir, 'client.json')
  await writeJsonAtomic(file, {
    hubUrl,
    token: payload.token,
    deviceName: payload.device ?? name,
    pairedAt: new Date().toISOString(),
  })
  console.log(`paired as ${payload.device ?? name}`)
  console.log(`client config: ${file}`)
  console.log('next: start or reload DSH on this machine')
}

async function status(args) {
  const dataDir = args['data-dir'] || defaultDataDir()
  const hubConfig = await readJson(join(dataDir, 'hub.json'))
  const clientConfig = await readJson(join(dataDir, 'client.json'))
  console.log(`data dir: ${dataDir}`)
  console.log(`hub:      ${hubConfig ? JSON.stringify(hubConfig) : 'not initialized'}`)
  console.log(`client:   ${clientConfig ? `paired to ${clientConfig.hubUrl} as ${clientConfig.deviceName ?? 'device'}` : 'not paired'}`)
  const state = await readJson(join(dataDir, 'hub', 'hub-state.json'))
  if (state?.pairing?.code) console.log(`pairing:  ${state.pairing.code}`)
  if (state?.devices?.length) console.log(`devices:  ${state.devices.map((device) => device.name).join(', ')}`)
  const target = clientConfig?.hubUrl
    || (hubConfig ? `http://127.0.0.1:${hubConfig.port}` : '')
  if (target) {
    try {
      const response = await fetch(`${hubBase(target)}/v1/health`)
      console.log(`health:   ${response.status} ${await response.text()}`)
    } catch (error) {
      console.log(`health:   failed (${error.message})`)
    }
  }
}

async function code(args) {
  const dataDir = args['data-dir'] || defaultDataDir()
  const hubUrl = args.hub ? hubBase(args.hub) : ''
  const token = args.token || ''
  if (args.rotate) {
    if (!hubUrl || !token) throw new Error('--rotate requires --hub and --token')
    const response = await fetch(`${hubUrl}/v1/pair/rotate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`rotate failed: ${payload?.error?.message ?? response.status}`)
    console.log(payload.code)
    return
  }
  if (hubUrl && token) {
    const response = await fetch(`${hubUrl}/v1/pair`, { headers: { authorization: `Bearer ${token}` } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`read failed: ${payload?.error?.message ?? response.status}`)
    console.log(payload.code)
    return
  }
  const state = await readJson(join(dataDir, 'hub', 'hub-state.json'))
  if (!state?.pairing?.code) throw new Error('no hub state found; run init-hub first')
  console.log(state.pairing.code)
}

const help = `dsh-session-sync — personal session and workspace sync

Usage:
  dsh-session-sync init-hub [--host 0.0.0.0] [--port 8787] [--data-dir PATH]
  dsh-session-sync pair --hub URL --code CODE [--name NAME] [--data-dir PATH]
  dsh-session-sync status [--data-dir PATH]
  dsh-session-sync code [--rotate] [--hub URL --token TOKEN] [--data-dir PATH]

Defaults:
  data dir  $DSH_HOME/dsh-sync (or ~/.dsh/dsh-sync)
  hub bind  0.0.0.0:8787 behind a firewall or proxy
`

const args = parseArgs(process.argv.slice(2))
const command = args._[0] ?? 'help'
try {
  if (command === 'init-hub') await initHub(args)
  else if (command === 'pair') await pair(args)
  else if (command === 'status') await status(args)
  else if (command === 'code') await code(args)
  else {
    console.log(help)
    if (command !== 'help') process.exit(1)
  }
} catch (error) {
  console.error(`[session-sync] ${error.message}`)
  process.exit(1)
}
