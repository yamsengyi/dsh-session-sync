/**
 * dsh-session-sync: a personal hub for DSH sessions and workspace snapshots.
 *
 * `role: auto` resolves at startup from two marker files in the data directory:
 * `hub.json` starts the hub, `client.json` (written by `/session-sync pair`) makes
 * this machine a client. Neither file leaves the plugin inert, so installing
 * the bundle never changes behavior until `init-hub` or `pair` runs.
 *
 * This plugin deliberately imports no DSH package: the hub and client are
 * plain Node modules, which keeps a profile-installed bundle resolvable
 * without a build step and lets the same code run outside DSH for tests.
 */

import { hostname, homedir } from 'node:os'
import { watch } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, isAbsolute, join } from 'node:path'
import { createHubServer } from './src/hub-server.js'
import { SyncClient } from './src/sync-client.js'
import { PROTOCOL_VERSION, SyncHttpError, sha256Hex } from './src/protocol.js'
import { compareVersions, fetchLatestVersion } from './src/update-check.js'
import { createSessionSyncRoutes } from './src/ui-api.js'

const require = createRequire(import.meta.url)
const PLUGIN_VERSION = require('./package.json').version

export const name = 'session-sync'

/** Persistence for backfill, commands for setup, and the Web carrier for the settings page API. */
export const inject = ['sessionPersistence', 'commands', 'webServer', 'connection', 'workspaceRegistry']

const MAX_BUFFER_EVENTS = 2000
const PUSH_DEBOUNCE_MS = 300
const RETRY_SWEEP_MS = 60_000
const MARKER_DEBOUNCE_MS = 250
const MARKER_FILE = '.dsh-sync.json'
const FOLDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function normalizeConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {}
  const role = config.role ?? 'auto'
  if (role !== 'auto' && role !== 'client' && role !== 'hub' && role !== 'idle') {
    throw new Error(`[session-sync] role must be "auto", "client", "hub", or "idle", received ${JSON.stringify(role)}`)
  }
  const hubHost = String(config.hubHost ?? '127.0.0.1')
  const hubPort = Number(config.hubPort ?? 8787)
  if (!Number.isInteger(hubPort) || hubPort < 0 || hubPort > 65535) {
    throw new Error(`[session-sync] hubPort must be an integer between 0 and 65535, received ${JSON.stringify(config.hubPort)}`)
  }
  const defaultWorkspaceMode = String(config.defaultWorkspaceMode ?? 'children')
  if (!['children', 'root', 'off'].includes(defaultWorkspaceMode)) {
    throw new Error('[session-sync] defaultWorkspaceMode must be "children", "root", or "off"')
  }
  const rawTokens = Array.isArray(config.hubTokens) ? config.hubTokens : []
  const tokens = rawTokens.map((entry) => {
    if (entry && typeof entry === 'object' && typeof entry.token === 'string' && entry.token.length > 0) {
      return { name: String(entry.name ?? 'device'), token: entry.token }
    }
    if (typeof entry === 'string' && entry.length > 0) return { name: 'device', token: entry }
    throw new Error('[session-sync] every hubTokens entry must be a token string or { name, token }')
  })
  return {
    role,
    hubUrl: String(config.hubUrl ?? ''),
    token: String(config.token ?? ''),
    dataDir: String(config.dataDir ?? ''),
    hubHost,
    hubPort,
    tokens,
    autoPush: config.autoPush !== false,
    autoCheckpoint: config.autoCheckpoint !== false,
    checkpointIntervalMs: Number.isFinite(Number(config.checkpointIntervalMs))
      ? Math.max(0, Number(config.checkpointIntervalMs))
      : 30_000,
    defaultWorkspace: String(config.defaultWorkspace ?? '')
      || join(homedir(), 'Documents', 'deepseek-harness', 'sync-default'),
    defaultWorkspaceMode,
    deviceName: String(config.deviceName ?? '') || hostname(),
  }
}

function defaultDataDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'dsh-sync')
}

function loopbackUrl(host, port) {
  const urlHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host.includes(':') ? `[${host}]` : host
  return `http://${urlHost}:${port}`
}

function describe(error) {
  if (error instanceof SyncHttpError) return `${error.code} (${error.status}): ${error.message}`
  return error?.stack ?? String(error)
}

function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'workspace'
}

function samePath(left, right) {
  const normalize = (value) => String(value ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalize(left) === normalize(right)
}

function safeProjectFolder(value) {
  const name = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/^[. ]+|[. ]+$/g, '')
    .trim()
    .slice(0, 80)
  return name || 'project'
}

async function readJsonIfExists(path) {
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

/** Read the workspace's folder marker, or undefined when it never opted in. */
async function readMarker(root) {
  try {
    const parsed = JSON.parse(await readFile(join(root, MARKER_FILE), 'utf8'))
    if (parsed && typeof parsed.folderId === 'string' && FOLDER_ID.test(parsed.folderId)) return parsed
    return undefined
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Write the folder marker that opts a workspace into automatic checkpoints.
 *
 * The marker is an ordinary file, so the first checkpoint carries it to every
 * other PC and they address the same hub folder without a path mapping.
 *
 * @param {string} root - existing workspace directory
 * @param {string} [folderId] - explicit id; defaults to a slug plus a short path hash
 * @returns {Promise<string>} the folder id in the marker
 */
export async function initFolder(root, folderId) {
  const existing = await readMarker(root)
  if (existing) return existing.folderId
  const id = folderId ?? `${slugify(basename(root))}-${sha256Hex(root).slice(0, 6)}`
  if (!FOLDER_ID.test(id)) {
    throw new Error(`[session-sync] folderId must match ${FOLDER_ID}: ${JSON.stringify(id)}`)
  }
  await writeFile(
    join(root, MARKER_FILE),
    `${JSON.stringify({ folderId: id, createdAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
  return id
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} raw
 */
export async function apply(ctx, raw) {
  const config = normalizeConfig(raw)
  const logger = ctx.logger ?? console
  const dataDir = config.dataDir || defaultDataDir()
  const hubConfigPath = join(dataDir, 'hub.json')
  const clientConfigPath = join(dataDir, 'client.json')
  const selfClientConfigPath = join(dataDir, 'self-client.json')
  const uiStatePath = join(dataDir, 'ui.json')
  const updateStatePath = join(dataDir, 'update-check.json')

  // sync-default is a container. Its immediate child directories are the
  // projects: each becomes a DSH Workspace and is marked shared by default.
  // The container itself is not marked, so project checkpoints stay separate.
  const scanDefaultProjects = async () => {
    const parent = config.defaultWorkspace
    await mkdir(parent, { recursive: true })
    const ui = (await readJsonIfExists(uiStatePath)) ?? {}
    if (config.defaultWorkspaceMode === 'off') {
      return { mode: 'off', scanned: 0, registered: 0, shared: 0 }
    }
    const registry = ctx.workspaceRegistry
    if (config.defaultWorkspaceMode === 'root') {
      const optedOut = ui.defaultWorkspaceUnshared === true
        && samePath(ui.defaultWorkspaceUnsharedPath, parent)
      let shared = 0
      if (!optedOut) {
        const marker = await readMarker(parent)
        if (!marker) {
          await initFolder(parent)
          shared = 1
        }
      }
      let registered = 0
      if (registry) {
        const existing = await registry.resolveByPath(parent).catch(() => undefined)
        if (!existing) {
          await registry.create(parent)
          registered = 1
        }
      }
      return { mode: 'root', scanned: 1, registered, shared }
    }

    // Children mode: the parent is a container, never a shared project.
    const parentMarker = await readMarker(parent).catch(() => undefined)
    if (parentMarker) await rm(join(parent, MARKER_FILE), { force: true })
    const unshared = Array.isArray(ui.unsharedWorkspaces) ? ui.unsharedWorkspaces : []
    const entries = await readdir(parent, { withFileTypes: true }).catch(() => [])
    const children = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map((entry) => join(parent, entry.name))
    let registered = 0
    let shared = 0
    for (const child of children) {
      try {
        const blocked = unshared.some((path) => samePath(path, child))
        const marker = await readMarker(child)
        if (blocked) {
          if (marker) await rm(join(child, MARKER_FILE), { force: true })
        } else if (!marker) {
          await initFolder(child)
          shared += 1
        }
        if (registry) {
          const existing = await registry.resolveByPath(child).catch(() => undefined)
          if (!existing) {
            await registry.create(child)
            registered += 1
          }
        }
      } catch (error) {
        logger.warn?.(`[session-sync] cannot prepare project ${child}: ${describe(error)}`)
      }
    }
    if (children.length > 0 && ui.workspacePath && samePath(ui.workspacePath, parent)) {
      await writeJsonAtomic(uiStatePath, { ...ui, workspacePath: children[0] })
    }
    return { mode: 'children', scanned: children.length, registered, shared }
  }

  void scanDefaultProjects().then((result) => {
    if (result.registered > 0 || result.shared > 0) {
      logger.info?.(`[session-sync] default workspace scan: ${JSON.stringify(result)}`)
    }
  }).catch((error) => {
    logger.warn?.(`[session-sync] cannot prepare default workspace ${config.defaultWorkspace}: ${describe(error)}`)
  })

  const readUi = async () => (await readJsonIfExists(uiStatePath)) ?? {}
  const updateUi = async (patch) => {
    const current = await readUi()
    await mkdir(dataDir, { recursive: true })
    await writeJsonAtomic(uiStatePath, { ...current, ...patch })
  }

  if (config.role === 'idle') {
    logger.info?.('[session-sync] role idle; nothing to do')
    return
  }

  const runtime = {
    hub: null,
    client: null,
    clientKind: null,
    deviceName: config.deviceName,
    buffers: new Map(),
    pushing: new Set(),
    dirty: new Set(),
    timers: new Map(),
    checkpointState: new Map(),
  }

  let hubStarting
  const startHub = async (hubConfig) => {
    if (runtime.hub) return runtime.hub
    if (hubStarting) return hubStarting
    hubStarting = (async () => {
      const hubDataDir = hubConfig?.dataDir || join(dataDir, 'hub')
      const host = hubConfig?.host ?? config.hubHost
      const port = hubConfig?.port ?? config.hubPort
      const hub = await createHubServer({ dataDir: hubDataDir, host, port, tokens: config.tokens, logger })
      runtime.hub = hub
      logger.info?.(`[session-sync] hub listening on ${hub.url} (${config.tokens.length} configured token(s))`)
      const code = hub.pairingCode()
      if (code) logger.info?.(`[session-sync] pairing code: ${code} (${join(hubDataDir, 'pairing-code.txt')})`)
      return hub
    })()
    try {
      return await hubStarting
    } finally {
      hubStarting = undefined
    }
  }

  const stopHub = async () => {
    const hub = runtime.hub
    runtime.hub = null
    if (!hub) return
    logger.info?.('[session-sync] hub stopped')
    await hub.close()
  }

  /** Read a stored session range through the persistence seam, never the live log. */
  const readRange = async (id, from, to) => {
    if (to <= from) return []
    const handle = await ctx.sessionPersistence.open(id, 'read')
    try {
      const result = await handle.read(from, to - from)
      return result.events
    } finally {
      await handle.close()
    }
  }

  const bufferFor = (session) => {
    let buffer = runtime.buffers.get(session.id)
    if (!buffer) {
      buffer = { session, header: session.header, events: [] }
      runtime.buffers.set(session.id, buffer)
    } else {
      buffer.session = session
      buffer.header = session.header
    }
    return buffer
  }

  const pushNow = async (session) => {
    const client = runtime.client
    if (!client) return
    const buffer = runtime.buffers.get(session.id)
    if (!buffer || buffer.events.length === 0) return
    // Only explicitly marked workspaces upload session history. A session
    // without cwd is a test/legacy shape and remains allowed.
    const cwd = session.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) {
      let marker
      try {
        marker = await readMarker(cwd)
      } catch {
        marker = undefined
      }
      if (!marker) {
        runtime.buffers.delete(session.id)
        return
      }
    }
    if (runtime.pushing.has(session.id)) {
      runtime.dirty.add(session.id)
      return
    }
    runtime.pushing.add(session.id)
    try {
      let head = 0
      try {
        const remote = await client.session(session.id)
        head = remote?.head ?? 0
      } catch (error) {
        if (!(error instanceof SyncHttpError) || error.status !== 404) throw error
      }
      const pending = buffer.events.filter((event) => Number.isInteger(event?.seq) && event.seq >= head)
      if (pending.length === 0) {
        buffer.events = []
        return
      }
      let events = pending
      if (pending[0].seq > head) {
        const backfill = await readRange(session.id, head, pending[0].seq)
        events = [...backfill, ...pending]
      }
      if (events[0]?.seq !== head) {
        logger.warn?.(`[session-sync] ${session.id}: cannot align local seq ${events[0]?.seq} with hub head ${head}`)
        return
      }
      const result = await client.pushSession({ header: buffer.header, events, expectHead: head })
      buffer.events = buffer.events.filter((event) => event.seq >= result.head)
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 409) {
        runtime.dirty.add(session.id)
      } else {
        logger.warn?.(`[session-sync] ${session.id}: push failed: ${describe(error)}`)
      }
    } finally {
      runtime.pushing.delete(session.id)
      if (runtime.dirty.delete(session.id)) schedule(session)
    }
  }

  const schedule = (session) => {
    if (!runtime.client) return
    if (runtime.timers.has(session.id)) return
    const timer = setTimeout(() => {
      runtime.timers.delete(session.id)
      void pushNow(session)
    }, PUSH_DEBOUNCE_MS)
    timer.unref?.()
    runtime.timers.set(session.id, timer)
  }

  /** Commit a marked workspace after a finished turn, at most once per interval. */
  const checkpointSession = async (session, event) => {
    const client = runtime.client
    if (!client) return
    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) return
    if (session.header?.origin === 'subagent' || (session.header?.delegationDepth ?? 0) > 0) return
    const state = runtime.checkpointState.get(cwd) ?? { at: 0, running: false }
    runtime.checkpointState.set(cwd, state)
    if (state.running) return
    if (Date.now() - state.at < config.checkpointIntervalMs) return
    let marker
    try {
      marker = await readMarker(cwd)
    } catch (error) {
      logger.warn?.(`[session-sync] cannot read ${MARKER_FILE} under ${cwd}: ${describe(error)}`)
      return
    }
    // Only a workspace that carries the marker opts into automatic commits.
    if (!marker) return
    state.running = true
    try {
      const result = await client.pushCheckpoint(marker.folderId, cwd, {
        message: event?.data?.turn ? `turn ${event.data.turn}` : 'turn',
        sessionId: session.id,
        seq: Number.isInteger(event?.seq) ? event.seq : 0,
        author: runtime.deviceName,
        name: basename(cwd),
      })
      state.at = Date.now()
      if (!result.skipped) {
        logger.info?.(`[session-sync] checkpoint ${marker.folderId} v${result.version} (${result.fileCount} files)`)
      }
    } catch (error) {
      logger.warn?.(`[session-sync] checkpoint ${marker.folderId} failed: ${describe(error)}`)
    } finally {
      state.running = false
    }
  }

  const startClient = (settings, kind = 'external') => {
    if (runtime.client) return runtime.client
    const hubUrl = settings?.hubUrl || (runtime.hub ? loopbackUrl(runtime.hub.host, runtime.hub.port) : '')
    const token = settings?.token || ''
    if (!hubUrl || !token) return undefined
    runtime.deviceName = settings?.deviceName || config.deviceName
    runtime.client = new SyncClient({ baseUrl: hubUrl, token, logger })
    runtime.clientKind = kind
    logger.info?.(`[session-sync] ${kind} client pushing to ${hubUrl}`)
    return runtime.client
  }

  const stopClient = () => {
    runtime.client = null
    runtime.clientKind = null
    for (const timer of runtime.timers.values()) clearTimeout(timer)
    runtime.timers.clear()
    runtime.buffers.clear()
    runtime.pushing.clear()
    runtime.dirty.clear()
  }

  /**
   * A Host is also a sync source: its own sessions and workspace must reach
   * the hub it serves. Mint (or reuse) a local device token and run an
   * in-process client against this listener. The external paired client stays
   * in client.json for a later Client-mode switch.
   */
  const ensureSelfClient = async (hub) => {
    const hubUrl = hub.url
    let saved
    try {
      saved = await readJsonIfExists(selfClientConfigPath)
    } catch {
      saved = undefined
    }
    let token = saved?.token
    let valid = false
    if (token) {
      try {
        const response = await fetch(`${hubUrl}/v1/sessions`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(2_000),
        })
        valid = response.ok
      } catch {
        valid = false
      }
    }
    if (!valid) {
      const issued = await hub.store.addDevice('host-self')
      token = issued.token
    }
    const settings = {
      hubUrl,
      token,
      deviceName: saved?.deviceName || config.deviceName,
    }
    const same = runtime.clientKind === 'self'
      && runtime.client?.baseUrl === hubUrl
      && runtime.client?.token === token
    if (!same) {
      stopClient()
      await mkdir(dataDir, { recursive: true })
      await writeJsonAtomic(selfClientConfigPath, {
        ...settings,
        enabled: true,
        selfHost: true,
        pairedAt: saved?.pairedAt ?? new Date().toISOString(),
      })
      startClient(settings, 'self')
    } else if (!saved) {
      await mkdir(dataDir, { recursive: true })
      await writeJsonAtomic(selfClientConfigPath, {
        ...settings,
        enabled: true,
        selfHost: true,
        pairedAt: new Date().toISOString(),
      })
    }
  }

  const resolveRolesNow = async () => {
    const hubConfig = await readJsonIfExists(hubConfigPath)
    const clientConfig = await readJsonIfExists(clientConfigPath)
    const fallback = config.hubUrl && config.token
      ? { hubUrl: config.hubUrl, token: config.token, deviceName: config.deviceName }
      : undefined
    const settings = clientConfig ?? fallback
    const hubEnabled = Boolean(hubConfig) && hubConfig.enabled !== false
    const clientConfigured = clientConfig
      ? clientConfig.enabled !== false
      : Boolean(fallback)
    const wantHost = config.role === 'hub' || (config.role === 'auto' && hubEnabled)
    // A Host owns its own upload path through the self client; an external
    // client.json is used only in Client mode (or when no hub is enabled).
    const wantClient = config.role === 'client'
      || (config.role === 'auto' && !hubEnabled && clientConfigured)

    if (wantHost) {
      const desiredHost = hubConfig?.host ?? config.hubHost
      const desiredPort = hubConfig?.port ?? config.hubPort
      if (runtime.hub && (runtime.hub.host !== desiredHost || runtime.hub.port !== desiredPort)) {
        await stopHub()
      }
      let hub = null
      try {
        hub = await startHub(hubConfig)
      } catch (error) {
        logger.error?.(`[session-sync] hub failed to start: ${describe(error)}`)
      }
      if (hub) {
        try {
          await ensureSelfClient(hub)
        } catch (error) {
          logger.error?.(`[session-sync] self client failed to start: ${describe(error)}`)
          stopClient()
        }
      } else {
        stopClient()
      }
    } else {
      if (runtime.clientKind === 'self') stopClient()
      if (runtime.hub) await stopHub()
    }

    if (!wantHost && wantClient) {
      const sameClient = runtime.clientKind === 'external' && runtime.client && settings
        && runtime.client.baseUrl === settings.hubUrl
        && runtime.client.token === settings.token
      if (settings && !sameClient) {
        stopClient()
        startClient(settings, 'external')
      } else if (!settings) {
        logger.info?.('[session-sync] client idle: no hubUrl/token')
      }
    } else if (!wantHost) {
      stopClient()
    }
  }

  let resolving = Promise.resolve()
  const resolveRoles = () => {
    const run = resolving.then(resolveRolesNow, resolveRolesNow)
    resolving = run.catch(() => undefined)
    return run
  }

  ctx.on('session/event', (session, event) => {
    if (!runtime.client) return
    if (config.autoPush) {
      const buffer = bufferFor(session)
      buffer.events.push(event)
      if (buffer.events.length > MAX_BUFFER_EVENTS) {
        buffer.events = buffer.events.slice(-MAX_BUFFER_EVENTS)
      }
    }
    if (event?.type !== 'turn/end') return
    if (config.autoPush) schedule(session)
    if (config.autoCheckpoint) void checkpointSession(session, event)
  })

  // Parallel durability checkpoint: schedule, but never hold the loop on the
  // network. Local durability belongs to the JSONL backend.
  ctx.on('session/flush', (session) => {
    if (runtime.client && config.autoPush) schedule(session)
  })

  ctx.on('session/disposed', (session) => {
    if (!runtime.client) return
    void pushNow(session).finally(() => {
      const buffer = runtime.buffers.get(session.id)
      if (buffer && buffer.events.length === 0) runtime.buffers.delete(session.id)
    })
  })

  const sweep = setInterval(() => {
    for (const buffer of runtime.buffers.values()) {
      if (buffer.events.length > 0) schedule(buffer.session)
    }
  }, RETRY_SWEEP_MS)
  sweep.unref?.()

  if (config.role === 'auto') {
    await mkdir(dataDir, { recursive: true })
    let debounce
    const watcher = watch(dataDir, () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        void resolveRoles().catch((error) => logger.warn?.(`[session-sync] marker reload failed: ${describe(error)}`))
      }, MARKER_DEBOUNCE_MS)
      debounce.unref?.()
    })
    watcher.unref?.()
    ctx.effect(() => () => {
      watcher.close()
      clearTimeout(debounce)
    })
  }

  ctx.effect(() => async () => {
    clearInterval(sweep)
    stopClient()
    await stopHub()
  })

  await resolveRoles()

  if (ctx.commands?.register) {
    const dispose = ctx.commands.register({
      name: 'session-sync',
      description: 'Set up or inspect session and workspace sync',
      input: {
        hint: 'init-hub [host] [port] | pair <hub-url> <code> [name] | status | code [rotate]',
      },
      handler: async ({ rawInput, signal }) => {
        const argv = rawInput.trim().split(/\s+/).filter(Boolean)
        const subcommand = argv[0] ?? 'status'
        try {
          if (subcommand === 'init-hub') {
            if (config.role !== 'auto' && config.role !== 'hub') {
              return { kind: 'error', text: 'role is not auto or hub; set role: auto in the profile first' }
            }
            const host = argv[1] || '127.0.0.1'
            const port = Number(argv[2] ?? 8787)
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
              return { kind: 'error', text: 'port must be 1..65535' }
            }
            const existing = await readJsonIfExists(hubConfigPath)
            await mkdir(dataDir, { recursive: true })
            await writeJsonAtomic(hubConfigPath, {
              enabled: true,
              host,
              port,
              createdAt: existing?.createdAt ?? new Date().toISOString(),
            })
            await resolveRoles()
            if (!runtime.hub) return { kind: 'error', text: 'hub did not start; check the DSH log' }
            return {
              kind: 'success',
              text: `Hub started on ${runtime.hub.url}\nPairing code: ${runtime.hub.pairingCode()}\nPair a client with: /session-sync pair <hub-url> <code> <name>`,
            }
          }
          if (subcommand === 'pair') {
            const hubUrl = argv[1]
            const code = argv[2]
            const name = argv[3] || hostname()
            if (!hubUrl || !code) return { kind: 'error', text: 'usage: /session-sync pair <hub-url> <code> [name]' }
            const response = await fetch(`${hubUrl.replace(/\/+$/, '')}/v1/pair`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code, name }),
              signal,
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok) {
              return { kind: 'error', text: `pairing failed: ${payload?.error?.message ?? response.status}` }
            }
            await mkdir(dataDir, { recursive: true })
            await writeJsonAtomic(clientConfigPath, {
              hubUrl,
              token: payload.token,
              deviceName: payload.device ?? name,
              pairedAt: new Date().toISOString(),
            })
            await resolveRoles()
            return { kind: 'success', text: `Paired as ${payload.device ?? name}; client now pushes to ${hubUrl}` }
          }
          if (subcommand === 'status') {
            const hubConfig = await readJsonIfExists(hubConfigPath)
            const clientConfig = await readJsonIfExists(clientConfigPath)
            const lines = [
              `data: ${dataDir}`,
              `hub: ${runtime.hub ? runtime.hub.url : hubConfig ? 'configured, not running' : 'not configured'}`,
              `client: ${runtime.client ? runtime.client.baseUrl : clientConfig ? 'paired, not running' : 'not paired'}`,
            ]
            if (runtime.hub) lines.push(`pairing code: ${runtime.hub.pairingCode()}`)
            return { kind: 'success', text: lines.join('\n') }
          }
          if (subcommand === 'code') {
            if (!runtime.hub) return { kind: 'error', text: 'hub is not running on this machine' }
            if (argv[1] === 'rotate') {
              return { kind: 'success', text: `new pairing code: ${await runtime.hub.store.rotatePairing()}` }
            }
            return { kind: 'success', text: `pairing code: ${runtime.hub.pairingCode()}` }
          }
          return {
            kind: 'error',
            text: 'usage: /session-sync init-hub [host] [port] | pair <hub-url> <code> [name] | status | code [rotate]',
          }
        } catch (error) {
          return { kind: 'error', text: describe(error) }
        }
      },
    })
    ctx.effect(() => () => dispose())
  }

  const currentPath = async () => {
    try {
      const sessions = await ctx.sessionPersistence.list()
      const withCwd = sessions.filter((entry) => typeof entry.header?.cwd === 'string' && entry.header.cwd.length > 0)
      withCwd.sort((a, b) => (b.header.createdAt ?? 0) - (a.header.createdAt ?? 0))
      return withCwd[0]?.header.cwd ?? null
    } catch {
      return null
    }
  }

  const listKnownWorkspaces = async () => {
    const seen = new Map()
    const add = (path, extra = {}) => {
      const key = String(path ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      if (!key || seen.has(key)) return
      seen.set(key, { path, sessions: 0, lastAt: 0, ...extra })
    }
    try {
      // Only DSH's saved workspace records belong in the list; a session cwd
      // that was never saved as a Workspace is not a workspace entry.
      for (const workspace of ctx.workspaceRegistry?.list?.() ?? []) {
        if (config.defaultWorkspaceMode === 'children' && samePath(workspace.path, config.defaultWorkspace)) continue
        add(workspace.path, {
          sessions: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
          lastAt: Date.parse(workspace.updatedAt) || 0,
        })
      }
    } catch {
      // A missing registry still leaves the configured default and selection.
    }
    const ui = await readUi()
    if (ui.workspacePath && !(config.defaultWorkspaceMode === 'children' && samePath(ui.workspacePath, config.defaultWorkspace))) {
      add(ui.workspacePath)
    }
    if (config.defaultWorkspaceMode !== 'children') add(config.defaultWorkspace)
    const workspaces = []
    for (const item of seen.values()) {
      let marker
      try {
        marker = await readMarker(item.path)
      } catch {
        marker = undefined
      }
      workspaces.push({
        ...item,
        shared: Boolean(marker),
        folderId: marker?.folderId ?? null,
      })
    }
    return workspaces
  }

  const readStatus = async () => {
    const hubConfig = await readJsonIfExists(hubConfigPath)
    const clientConfig = await readJsonIfExists(clientConfigPath)
    const selfConfig = await readJsonIfExists(selfClientConfigPath)
    const ui = await readUi()
    let marker
    let baseline = false
    let nonEmpty = false
    if (ui.workspacePath) {
      try {
        marker = await readMarker(ui.workspacePath)
      } catch {
        marker = undefined
      }
      try {
        baseline = await stat(join(ui.workspacePath, '.dsh-sync', 'base.json')).then(() => true, () => false)
      } catch {
        baseline = false
      }
      try {
        const entries = await readdir(ui.workspacePath, { withFileTypes: true })
        nonEmpty = entries.some((entry) => entry.name !== '.dsh-sync' && entry.name !== '.dsh-sync.json')
      } catch {
        nonEmpty = false
      }
    }
    const runningHub = runtime.hub
    const hubEnabled = Boolean(hubConfig) && hubConfig.enabled !== false
    const clientEnabled = Boolean(clientConfig) && clientConfig.enabled !== false
    const selfActive = runtime.clientKind === 'self'
    const activeClient = selfActive ? selfConfig : clientConfig
    const mode = hubEnabled ? 'host' : clientEnabled ? 'client' : 'off'
    let update
    try {
      update = await readJsonIfExists(updateStatePath)
    } catch {
      update = undefined
    }
    return {
      pluginVersion: PLUGIN_VERSION,
      protocol: PROTOCOL_VERSION,
      mode,
      role: config.role,
      hub: {
        configured: Boolean(hubConfig),
        enabled: hubEnabled,
        running: Boolean(runningHub),
        host: runningHub?.host ?? hubConfig?.host ?? config.hubHost,
        port: runningHub?.port ?? hubConfig?.port ?? config.hubPort,
        url: runningHub?.url ?? null,
        pairingCode: runningHub?.pairingCode() ?? null,
      },
      client: {
        paired: selfActive ? Boolean(selfConfig) : Boolean(clientConfig),
        enabled: selfActive ? true : clientEnabled,
        running: Boolean(runtime.client),
        self: selfActive,
        hubUrl: activeClient?.hubUrl ?? null,
        deviceName: activeClient?.deviceName ?? null,
      },
      workspace: {
        path: ui.workspacePath ?? null,
        folderId: marker?.folderId ?? null,
        marked: Boolean(marker),
        baseline,
        nonEmpty,
      },
      defaultWorkspace: config.defaultWorkspace,
      currentPath: await currentPath(),
      knownWorkspaces: await listKnownWorkspaces(),
      update: update ?? null,
      lastSync: ui.lastSync ?? null,
    }
  }

  const setMode = async (body) => {
    const mode = String(body?.mode ?? '')
    if (mode !== 'host' && mode !== 'client' && mode !== 'off') {
      throw new SyncHttpError(400, 'invalid-mode', 'mode must be host, client, or off')
    }
    const hubConfig = await readJsonIfExists(hubConfigPath)
    const clientConfig = await readJsonIfExists(clientConfigPath)
    if (mode === 'client' && !clientConfig) {
      throw new SyncHttpError(409, 'not-paired', 'pair this machine first')
    }
    const wantsHub = mode === 'host'
    const port = Number(body?.port ?? hubConfig?.port ?? config.hubPort)
    if (wantsHub && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new SyncHttpError(400, 'invalid-port', 'port must be 1..65535')
    }
    const bind = String(body?.bind ?? hubConfig?.host ?? config.hubHost)
    if (wantsHub) {
      await mkdir(dataDir, { recursive: true })
      await writeJsonAtomic(hubConfigPath, {
        ...hubConfig,
        enabled: true,
        host: bind,
        port,
        createdAt: hubConfig?.createdAt ?? new Date().toISOString(),
      })
    } else if (hubConfig) {
      await writeJsonAtomic(hubConfigPath, {
        ...hubConfig,
        enabled: false,
        host: hubConfig.host ?? bind,
        port: hubConfig.port ?? port,
      })
    }
    if (clientConfig && mode !== 'host') {
      await writeJsonAtomic(clientConfigPath, {
        ...clientConfig,
        enabled: mode === 'client',
      })
    }
    await resolveRoles()
    return readStatus()
  }

  const pairClient = async (body) => {
    const hubUrl = String(body?.hubUrl ?? '').trim().replace(/\/+$/, '')
    const code = String(body?.code ?? '').trim()
    const name = String(body?.name ?? '').trim() || config.deviceName
    if (!hubUrl || !code) throw new SyncHttpError(400, 'invalid-pair', 'hubUrl and code are required')
    const response = await fetch(`${hubUrl}/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new SyncHttpError(response.status, 'pair-failed', payload?.error?.message ?? 'pairing failed')
    }
    await mkdir(dataDir, { recursive: true })
    await writeJsonAtomic(clientConfigPath, {
      hubUrl,
      token: payload.token,
      deviceName: payload.device ?? name,
      enabled: true,
      pairedAt: new Date().toISOString(),
    })
    await resolveRoles()
    const ui = await readUi()
    if (ui.workspacePath) {
      try {
        await pushWorkspaceSessions(runtime.client, ui.workspacePath)
      } catch {
        // pushWorkspaceSessions logs per-session failures; pairing still succeeds.
      }
    }
    return readStatus()
  }

  const unpairClient = async () => {
    await rm(clientConfigPath, { force: true })
    await resolveRoles()
    return readStatus()
  }

  const markWorkspace = async (body) => {
    const target = String(body?.path ?? '').trim()
    if (!target) throw new SyncHttpError(400, 'invalid-path', 'workspace path is required')
    let info
    try {
      info = await stat(target)
    } catch {
      throw new SyncHttpError(400, 'invalid-path', 'workspace path does not exist')
    }
    if (!info.isDirectory()) throw new SyncHttpError(400, 'invalid-path', 'workspace path is not a directory')
    const folderId = await initFolder(target)
    const current = await readUi()
    const unshared = Array.isArray(current.unsharedWorkspaces)
      ? current.unsharedWorkspaces.filter((path) => !samePath(path, target))
      : []
    const patch = { workspacePath: target, unsharedWorkspaces: unshared }
    if (samePath(target, config.defaultWorkspace)) {
      patch.defaultWorkspaceUnshared = false
      patch.defaultWorkspaceUnsharedPath = null
    }
    await updateUi(patch)
    return { ...(await readStatus()), folderId }
  }

  const unmarkWorkspace = async (body) => {
    const target = String(body?.path ?? '').trim()
    if (!target) throw new SyncHttpError(400, 'invalid-path', 'workspace path is required')
    const info = await stat(target).catch(() => undefined)
    if (!info?.isDirectory()) throw new SyncHttpError(400, 'invalid-path', 'workspace path is not a directory')
    const markerPath = join(target, MARKER_FILE)
    try {
      await stat(markerPath)
    } catch {
      throw new SyncHttpError(404, 'not-marked', 'workspace is not marked for sync')
    }
    await rm(markerPath, { force: true })
    const current = await readUi()
    const unshared = Array.isArray(current.unsharedWorkspaces) ? [...current.unsharedWorkspaces] : []
    if (!unshared.some((path) => samePath(path, target))) unshared.push(target)
    const patch = { unsharedWorkspaces: unshared }
    if (samePath(target, config.defaultWorkspace)) {
      patch.defaultWorkspaceUnshared = true
      patch.defaultWorkspaceUnsharedPath = target
    }
    await updateUi(patch)
    return readStatus()
  }

  const sessionInfo = async (body) => {
    const sessionId = String(body?.sessionId ?? '').trim()
    if (!sessionId) throw new SyncHttpError(400, 'invalid-session', 'session id is required')
    let info
    try {
      info = await ctx.sessionPersistence.stat(sessionId)
    } catch {
      throw new SyncHttpError(404, 'session-not-found', 'session not found')
    }
    const cwd = typeof info?.header?.cwd === 'string' ? info.header.cwd : null
    let marker
    if (cwd) {
      try {
        marker = await readMarker(cwd)
      } catch {
        marker = undefined
      }
    }
    return {
      sessionId,
      cwd,
      shared: Boolean(marker),
      folderId: marker?.folderId ?? null,
    }
  }

  const pushWorkspaceSessions = async (client, workspacePath) => {
    if (!workspacePath) return { scanned: 0, pushed: 0, events: 0, errors: 0 }
    let rootMarker
    try {
      rootMarker = await readMarker(workspacePath)
    } catch {
      rootMarker = undefined
    }
    if (!rootMarker) return { scanned: 0, pushed: 0, events: 0, errors: 0 }
    const normalizePath = (value) => String(value ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    let sessions
    try {
      sessions = await ctx.sessionPersistence.list()
    } catch {
      return { scanned: 0, pushed: 0, events: 0, errors: 0 }
    }
    const matching = sessions
      .filter((entry) => normalizePath(entry.header?.cwd) === normalizePath(workspacePath) && entry.header?.origin !== 'subagent')
      .sort((a, b) => (b.header.createdAt ?? 0) - (a.header.createdAt ?? 0))
      .slice(0, 50)
    let pushed = 0
    let events = 0
    let errors = 0
    for (const entry of matching) {
      try {
        const remote = await client.session(entry.header.id)
        const head = remote?.head ?? 0
        const handle = await ctx.sessionPersistence.open(entry.header.id, 'read')
        let slice
        try {
          slice = await handle.read(head)
        } finally {
          await handle.close()
        }
        const pending = slice.events.filter((event) => Number.isInteger(event?.seq) && event.seq >= head)
        if (pending.length === 0) continue
        if (pending[0].seq !== head) {
          errors += 1
          continue
        }
        await client.pushSession({ header: entry.header, events: pending, expectHead: head })
        pushed += 1
        events += pending.length
      } catch (error) {
        errors += 1
        logger.warn?.(`[session-sync] session ${entry.header.id} upload failed: ${describe(error)}`)
      }
    }
    return { scanned: matching.length, pushed, events, errors }
  }

  const syncNow = async () => {
    if (!runtime.client) throw new SyncHttpError(409, 'client-inactive', 'client mode is not active; pair first')
    const ui = await readUi()
    const target = ui.workspacePath
    if (!target) throw new SyncHttpError(409, 'no-workspace', 'mark a workspace first')
    let marker
    try {
      marker = await readMarker(target)
    } catch {
      marker = undefined
    }
    if (!marker) throw new SyncHttpError(409, 'no-marker', 'workspace is not marked for sync')
    const pulled = await runtime.client.pullCheckpoint(marker.folderId, target)
    const sessions = await pushWorkspaceSessions(runtime.client, target)
    const pushed = await runtime.client.pushCheckpoint(marker.folderId, target, {
      message: 'manual sync',
      author: runtime.deviceName,
      name: basename(target),
    })
    await updateUi({ lastSync: { at: Date.now(), pulled, pushed, sessions } })
    return { ...(await readStatus()), pushed, pulled, sessions }
  }

  const issueCode = async (body) => {
    if (!runtime.hub) throw new SyncHttpError(409, 'hub-inactive', 'host mode is not running')
    if (body?.rotate) return { code: await runtime.hub.store.rotatePairing() }
    return { code: runtime.hub.pairingCode() }
  }

  const scanWorkspaces = async () => {
    const scan = await scanDefaultProjects()
    return { ...(await readStatus()), scan }
  }

  const listProjects = async () => {
    if (!runtime.client) throw new SyncHttpError(409, 'client-inactive', 'client mode is not active')
    const result = await runtime.client.folders()
    return { projects: Array.isArray(result?.folders) ? result.folders : [] }
  }

  const prepareProject = async (body) => {
    const folderId = String(body?.folderId ?? '').trim()
    if (!FOLDER_ID.test(folderId)) throw new SyncHttpError(400, 'invalid-project', 'invalid project id')
    const name = safeProjectFolder(body?.name ?? folderId)
    const requested = String(body?.path ?? '').trim()
    const target = requested || join(config.defaultWorkspace, name)
    if (!isAbsolute(target)) throw new SyncHttpError(400, 'invalid-path', 'project path must be absolute')
    await mkdir(target, { recursive: true })
    const marker = await readMarker(target).catch(() => undefined)
    if (marker && marker.folderId !== folderId) {
      throw new SyncHttpError(409, 'project-mismatch', 'folder already belongs to a different project')
    }
    if (!marker) await initFolder(target, folderId)
    let workspaceId = null
    const registry = ctx.workspaceRegistry
    if (registry) {
      const existing = await registry.resolveByPath(target)
      const workspace = existing ?? await registry.create(target)
      workspaceId = String(workspace.id)
    }
    await updateUi({ workspacePath: target })
    return { folderId, name, path: target, workspaceId }
  }

  const syncProject = async (body) => {
    if (!runtime.client) throw new SyncHttpError(409, 'client-inactive', 'client mode is not active')
    const folderId = String(body?.folderId ?? '').trim()
    if (!FOLDER_ID.test(folderId)) throw new SyncHttpError(400, 'invalid-project', 'invalid project id')
    const target = String(body?.path ?? '').trim()
    if (!isAbsolute(target)) throw new SyncHttpError(400, 'invalid-path', 'project path must be absolute')
    const marker = await readMarker(target).catch(() => undefined)
    if (!marker || marker.folderId !== folderId) {
      throw new SyncHttpError(409, 'project-mismatch', 'folder does not belong to this project')
    }
    const pulled = await runtime.client.pullCheckpoint(folderId, target)
    await updateUi({ workspacePath: target, lastSync: { at: Date.now(), pulled } })
    return { ...(await readStatus()), pulled }
  }

  const checkUpdate = async (body) => {
    const force = body?.force === true
    let cached
    try {
      cached = await readJsonIfExists(updateStatePath)
    } catch {
      cached = undefined
    }
    const now = Date.now()
    const minInterval = force ? 60_000 : 3_600_000
    if (cached && Number.isFinite(cached.checkedAt) && now - cached.checkedAt < minInterval) {
      return cached
    }
    try {
      const latest = await fetchLatestVersion()
      const result = {
        current: PLUGIN_VERSION,
        latest,
        updateAvailable: compareVersions(latest, PLUGIN_VERSION) > 0,
        checkedAt: now,
      }
      await mkdir(dataDir, { recursive: true })
      await writeJsonAtomic(updateStatePath, result)
      return result
    } catch (error) {
      return {
        current: PLUGIN_VERSION,
        latest: cached?.latest ?? null,
        updateAvailable: cached?.updateAvailable ?? false,
        checkedAt: now,
        error: String(error?.message ?? error),
      }
    }
  }

  if (ctx.webServer && ctx.connection) {
    const disposeRoutes = createSessionSyncRoutes({
      webServer: ctx.webServer,
      connection: ctx.connection,
      handlers: {
        status: readStatus,
        setMode,
        pair: pairClient,
        unpair: unpairClient,
        markWorkspace,
        unmarkWorkspace,
        sessionInfo,
        scanWorkspaces,
        listProjects,
        prepareProject,
        syncProject,
        syncNow,
        code: issueCode,
        checkUpdate,
      },
      logger,
    })
    ctx.effect(() => () => disposeRoutes())
  }
}

/**
 * Pull a hub checkpoint into a local folder outside the plugin lifecycle. This
 * is the entry point a command or the CLI helper uses until a UI lands.
 */
export async function pullFolder({ hubUrl, token, folderId, root, logger = console }) {
  const client = new SyncClient({ baseUrl: hubUrl, token, logger })
  return client.pullCheckpoint(folderId, root)
}

/** Commit a folder to the hub outside the plugin lifecycle. */
export async function pushFolder({ hubUrl, token, folderId, root, message = '', sessionId = null, seq = 0, author = '', logger = console }) {
  const client = new SyncClient({ baseUrl: hubUrl, token, logger })
  return client.pushCheckpoint(folderId, root, { message, sessionId, seq, author, name: basename(root) })
}
