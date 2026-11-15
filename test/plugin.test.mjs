import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, initFolder } from '../index.js'
import { createHubServer } from '../src/hub-server.js'

const quiet = { info() {}, warn() {}, error() {}, log() {} }

/** Minimal Cordis-shaped context: listeners, effects, and a persistence stub. */
function fakeContext() {
  const listeners = new Map()
  const disposers = []
  return {
    logger: quiet,
    sessionPersistence: {
      async open() {
        return {
          async read() {
            return { eventState: 'detached', events: [] }
          },
          async close() {},
        }
      },
    },
    commands: {
      definitions: new Map(),
      register(definition) {
        this.definitions.set(definition.name, definition)
        return () => this.definitions.delete(definition.name)
      },
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(listener)
      return () => {}
    },
    effect(execute) {
      const disposer = execute()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) void listener(...args)
    },
    dispose() {
      for (const disposer of disposers) void disposer()
    },
  }
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

test('an unknown role is rejected and an empty hubUrl stays inert', async (t) => {
  await assert.rejects(apply(fakeContext(), { role: 'bogus' }), /role must be/)
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-inert-'))
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })
  const ctx = fakeContext()
  await apply(ctx, { role: 'client', hubUrl: '', token: '', dataDir })
  ctx.dispose()
})

test('hub role starts a listener and closes on dispose', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-plugin-'))
  const port = await freePort()
  const ctx = fakeContext()
  t.after(async () => {
    ctx.dispose()
    await rm(dataDir, { recursive: true, force: true })
  })

  await apply(ctx, {
    role: 'hub',
    hubHost: '127.0.0.1',
    hubPort: port,
    hubTokens: [{ name: 'dev-a', token: 'tok-a' }],
    dataDir,
  })

  const health = await fetch(`http://127.0.0.1:${port}/v1/health`)
  assert.equal(health.status, 200)

  ctx.dispose()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await assert.rejects(fetch(`http://127.0.0.1:${port}/v1/health`))
})

test('client role pushes a finished turn to the hub', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-plugin-'))
  const hub = await createHubServer({ dataDir, port: 0, tokens: [{ name: 'dev-a', token: 'tok-a' }], logger: quiet })
  const ctx = fakeContext()
  t.after(async () => {
    ctx.dispose()
    await hub.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  await apply(ctx, {
    role: 'client',
    hubUrl: hub.url,
    token: 'tok-a',
    dataDir,
    autoPush: true,
  })

  const session = { id: 's-test', header: { id: 's-test', version: 3, createdAt: 1 } }
  ctx.emit('session/event', session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } })
  ctx.emit('session/event', session, { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'success' } } })

  const deadline = Date.now() + 8000
  let head = 0
  while (Date.now() < deadline) {
    const response = await fetch(`${hub.url}/v1/sessions/s-test`, { headers: { authorization: 'Bearer tok-a' } })
    if (response.ok) {
      head = (await response.json()).head
      if (head === 2) break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(head, 2)
})

test('role auto starts a hub when hub.json exists', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-auto-hub-'))
  const port = await freePort()
  await writeFile(join(dataDir, 'hub.json'), JSON.stringify({ enabled: true, host: '127.0.0.1', port }))
  const ctx = fakeContext()
  t.after(async () => {
    ctx.dispose()
    await rm(dataDir, { recursive: true, force: true })
  })

  await apply(ctx, { role: 'auto', dataDir, autoPush: false, autoCheckpoint: false })

  const deadline = Date.now() + 8000
  let healthy = false
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`)
      if (response.ok) {
        healthy = true
        break
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(healthy, true)
})

test('role auto syncs as a client when client.json exists', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-auto-client-'))
  const hub = await createHubServer({
    dataDir: join(dataDir, 'hub-data'),
    port: 0,
    tokens: [{ name: 'auto', token: 'tok-auto' }],
    logger: quiet,
  })
  await writeFile(
    join(dataDir, 'client.json'),
    JSON.stringify({ hubUrl: hub.url, token: 'tok-auto', deviceName: 'pc-auto' }),
  )
  const ctx = fakeContext()
  t.after(async () => {
    ctx.dispose()
    await hub.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  await apply(ctx, { role: 'auto', dataDir })

  const session = { id: 's-auto-client', header: { id: 's-auto-client', version: 3, createdAt: 1 } }
  ctx.emit('session/event', session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } })
  ctx.emit('session/event', session, { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'success' } } })

  const deadline = Date.now() + 8000
  let head = 0
  while (Date.now() < deadline) {
    const response = await fetch(`${hub.url}/v1/sessions/s-auto-client`, {
      headers: { authorization: 'Bearer tok-auto' },
    })
    if (response.ok) {
      head = (await response.json()).head
      if (head === 2) break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(head, 2)
})

test('client role commits a marked workspace after a finished turn', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-plugin-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-sync-ws-'))
  await writeFile(join(workspace, 'hello.txt'), 'hello\n')
  const folderId = await initFolder(workspace, 'auto-demo')
  const hub = await createHubServer({ dataDir, port: 0, tokens: [{ name: 'dev-a', token: 'tok-a' }], logger: quiet })
  const ctx = fakeContext()
  t.after(async () => {
    ctx.dispose()
    await hub.close()
    await rm(dataDir, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  await apply(ctx, {
    role: 'client',
    hubUrl: hub.url,
    token: 'tok-a',
    dataDir,
    autoCheckpoint: true,
    checkpointIntervalMs: 0,
    deviceName: 'pc-a',
  })

  const session = { id: 's-auto', header: { id: 's-auto', version: 3, createdAt: 1, cwd: workspace } }
  ctx.emit('session/event', session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } })
  ctx.emit('session/event', session, { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'success' } } })

  const deadline = Date.now() + 8000
  let version = 0
  while (Date.now() < deadline) {
    const response = await fetch(`${hub.url}/v1/folders/${folderId}/head`, { headers: { authorization: 'Bearer tok-a' } })
    if (response.ok) {
      version = (await response.json()).version
      if (version === 1) break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(version, 1)

  const response = await fetch(`${hub.url}/v1/folders/${folderId}/checkpoints/1`, {
    headers: { authorization: 'Bearer tok-a' },
  })
  const checkpoint = await response.json()
  const paths = checkpoint.files.map((file) => file.path).sort()
  assert.deepEqual(paths, ['.dsh-sync.json', 'hello.txt'])
  assert.equal(checkpoint.author, 'pc-a')
  assert.equal(checkpoint.sessionId, 's-auto')
  assert.equal(checkpoint.seq, 1)
})

test('the sync command initializes a hub, pairs, and starts syncing', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-command-'))
  const port = await freePort()
  const ctx = fakeContext()
  t.after(async () => {
    ctx.dispose()
    await rm(dataDir, { recursive: true, force: true })
  })

  await apply(ctx, { role: 'auto', dataDir, autoPush: true, autoCheckpoint: false })
  const command = ctx.commands.definitions.get('session-sync')
  assert.ok(command, 'sync command is registered')

  const signal = new AbortController().signal
  const init = await command.handler({ rawInput: `init-hub 127.0.0.1 ${port}`, signal })
  assert.equal(init.kind, 'success', init.text)
  const code = /Pairing code: ([A-Z0-9-]+)/.exec(init.text)?.[1]
  assert.ok(code)

  const health = await fetch(`http://127.0.0.1:${port}/v1/health`)
  assert.equal(health.status, 200)

  const paired = await command.handler({
    rawInput: `pair http://127.0.0.1:${port} ${code} cmd-pc`,
    signal,
  })
  assert.equal(paired.kind, 'success', paired.text)

  const status = await command.handler({ rawInput: 'status', signal })
  assert.match(status.text, /client:/)

  const clientConfig = JSON.parse(await readFile(join(dataDir, 'client.json'), 'utf8'))
  const session = { id: 's-command', header: { id: 's-command', version: 3, createdAt: 1 } }
  ctx.emit('session/event', session, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } })
  ctx.emit('session/event', session, { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'success' } } })

  const deadline = Date.now() + 8000
  let head = 0
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/sessions/s-command`, {
      headers: { authorization: `Bearer ${clientConfig.token}` },
    })
    if (response.ok) {
      head = (await response.json()).head
      if (head === 2) break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(head, 2)
})

