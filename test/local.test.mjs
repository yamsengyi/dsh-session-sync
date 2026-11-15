import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHubServer } from '../src/hub-server.js'
import { SyncClient, readBase, safeJoin } from '../src/sync-client.js'
import { initFolder } from '../index.js'

const quiet = { info() {}, warn() {}, error() {}, log() {} }

async function makeWorkspace(files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sync-ws-'))
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  return root
}

async function makeHub(t, tokens = [{ name: 'dev-a', token: 'tok-a' }]) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sync-hub-'))
  const hub = await createHubServer({ dataDir: dir, port: 0, tokens, logger: quiet })
  t.after(async () => {
    await hub.close()
    await rm(dir, { recursive: true, force: true })
  })
  return hub
}

function clientFor(hub, token = 'tok-a') {
  return new SyncClient({ baseUrl: hub.url, token, logger: quiet })
}

async function cleanup(t, ...roots) {
  t.after(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true })
  })
}

test('checkpoint roundtrip, update, delete, and conflict', async (t) => {
  const hub = await makeHub(t)
  const a = clientFor(hub)
  const b = clientFor(hub)
  const rootA = await makeWorkspace({
    'README.md': '# v1\n',
    'src/app.js': 'console.log(1)\n',
    'old.txt': 'old\n',
  })
  const rootB = await makeWorkspace({})
  await cleanup(t, rootA, rootB)

  const first = await a.pushCheckpoint('demo', rootA, { message: 'turn 1' })
  assert.equal(first.version, 1)
  assert.equal(first.fileCount, 3)

  const pulled = await b.pullCheckpoint('demo', rootB)
  assert.equal(pulled.changed, true)
  assert.equal(pulled.writes, 3)
  assert.equal(await readFile(join(rootB, 'README.md'), 'utf8'), '# v1\n')
  assert.equal(await readFile(join(rootB, 'src', 'app.js'), 'utf8'), 'console.log(1)\n')

  // A second pull without remote changes is a no-op.
  assert.equal((await b.pullCheckpoint('demo', rootB)).changed, false)

  // An unchanged workspace is not committed again.
  const repeat = await a.pushCheckpoint('demo', rootA, { message: 'unchanged' })
  assert.equal(repeat.skipped, true)
  assert.equal((await a.head('demo')).version, 1)

  await writeFile(join(rootA, 'README.md'), '# v2\n')
  await rm(join(rootA, 'old.txt'))
  await writeFile(join(rootA, 'new.txt'), 'new\n')
  const second = await a.pushCheckpoint('demo', rootA, { message: 'turn 2' })
  assert.equal(second.version, 2)

  const pulled2 = await b.pullCheckpoint('demo', rootB)
  assert.equal(pulled2.changed, true)
  assert.equal(pulled2.writes, 2)
  assert.equal(pulled2.removes, 1)
  assert.equal(await readFile(join(rootB, 'README.md'), 'utf8'), '# v2\n')
  assert.equal(await readFile(join(rootB, 'new.txt'), 'utf8'), 'new\n')
  await assert.rejects(stat(join(rootB, 'old.txt')), (error) => error.code === 'ENOENT')

  // Both sides changed the same file: local wins and remote is preserved.
  await writeFile(join(rootA, 'src', 'app.js'), 'console.log("A")\n')
  await a.pushCheckpoint('demo', rootA, { message: 'turn 3' })
  await writeFile(join(rootB, 'src', 'app.js'), 'console.log("B")\n')
  const pulled3 = await b.pullCheckpoint('demo', rootB)
  assert.equal(pulled3.changed, true)
  assert.equal(pulled3.conflicts.length, 1)
  assert.equal(pulled3.conflicts[0].path, 'src/app.js')
  assert.equal(await readFile(join(rootB, 'src', 'app.js'), 'utf8'), 'console.log("B")\n')
  const savedBase = await readBase(rootB)
  assert.equal(savedBase.version, 3)
  const conflictFile = join(rootB, ...pulled3.conflicts[0].savedAs.split('/'))
  assert.equal(await readFile(conflictFile, 'utf8'), 'console.log("A")\n')

  const head = await b.head('demo')
  assert.equal(head.version, 3)
  const list = await b.checkpoints('demo', 0)
  assert.equal(list.checkpoints.length, 3)
})

test('ignore rules keep dependencies and sync state out of a checkpoint', async (t) => {
  const hub = await makeHub(t)
  const client = clientFor(hub)
  const root = await makeWorkspace({
    'keep.txt': 'k',
    'skip.log': 's',
    'node_modules/x.js': 'x',
    'sub/deep.txt': 'd',
  })
  await writeFile(join(root, '.dshsyncignore'), '*.log\n')
  await cleanup(t, root)

  const result = await client.pushCheckpoint('ignore-demo', root, { message: 'turn 1' })
  const checkpoint = await client.checkpoint('ignore-demo', result.version)
  const paths = checkpoint.files.map((file) => file.path).sort()
  assert.deepEqual(paths, ['.dshsyncignore', 'keep.txt', 'sub/deep.txt'])
})

test('session push is idempotent, paginates, and refuses a stale head', async (t) => {
  const hub = await makeHub(t)
  const client = clientFor(hub)
  const header = { id: 's-1', version: 3, createdAt: 1_700_000_000_000, cwd: 'C:/ws' }
  const events = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: 2, data: { role: 'user', content: 'hi' } },
    { type: 'assistant/message', seq: 2, time: 3, data: { turn: 1, step: 1, message: { role: 'assistant', content: 'yo' }, stream: [] } },
    { type: 'turn/end', seq: 3, time: 4, data: { turn: 1, reason: { kind: 'success' } } },
  ]

  const first = await client.pushSession({ header, events, expectHead: 0 })
  assert.equal(first.head, 4)

  const replay = await client.pushSession({ header, events, expectHead: 4 })
  assert.equal(replay.head, 4)

  const page = await client.pullSession('s-1', 1, 2)
  assert.equal(page.events.length, 2)
  assert.equal(page.events[0].seq, 1)
  assert.equal(page.events[1].seq, 2)
  assert.equal(page.head, 4)
  assert.equal(page.nextAfter, 3)

  await assert.rejects(
    client.pushSession({ header, events, expectHead: 99 }),
    (error) => error.status === 409 && error.code === 'head-mismatch',
  )
  await assert.rejects(
    client.pushSession({
      header,
      events: [{ type: 'turn/start', seq: 10, time: 9, data: { turn: 2 } }],
      expectHead: 4,
    }),
    (error) => error.status === 409 && error.code === 'gap',
  )
})

test('health is public, other routes require a token and protocol 1', async (t) => {
  const hub = await makeHub(t)

  const health = await fetch(`${hub.url}/v1/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true, protocol: '1' })

  const anonymous = await fetch(`${hub.url}/v1/sessions`)
  assert.equal(anonymous.status, 401)

  const wrongToken = await fetch(`${hub.url}/v1/sessions`, { headers: { authorization: 'Bearer nope' } })
  assert.equal(wrongToken.status, 401)

  const mismatch = await fetch(`${hub.url}/v1/sessions`, {
    headers: { authorization: 'Bearer tok-a', 'x-dsh-sync-protocol': '99' },
  })
  assert.equal(mismatch.status, 426)
})

test('safeJoin refuses paths that escape the workspace', () => {
  assert.throws(() => safeJoin('C:/ws', '../x'))
  assert.throws(() => safeJoin('C:/ws', 'a/../../x'))
  assert.equal(safeJoin('C:/ws', 'a/b.txt'), join('C:/ws', 'a', 'b.txt'))
})

test('a different local path can join an existing hub folderId', async () => {
  const hub = await createHubServer({
    dataDir: await mkdtemp(join(tmpdir(), 'dsh-sync-join-hub-')),
    port: 0,
    tokens: [{ name: 'join', token: 'tok-join' }],
    logger: quiet,
  })
  const rootA = await makeWorkspace({ 'hello.txt': 'from A\n' })
  const rootB = await mkdtemp(join(tmpdir(), 'dsh-sync-join-b-'))
  try {
    const client = new SyncClient({ baseUrl: hub.url, token: 'tok-join', logger: quiet })
    const folderId = 'join-demo'
    await client.pushCheckpoint(folderId, rootA, { name: 'demo' })
    await initFolder(rootB, folderId)
    await client.pullCheckpoint(folderId, rootB)
    assert.equal(await readFile(join(rootB, 'hello.txt'), 'utf8'), 'from A\n')

    const folders = await client.folders()
    assert.equal(folders.folders.find((folder) => folder.id === folderId)?.name, 'demo')
  } finally {
    await hub.close()
    await rm(rootA, { recursive: true, force: true })
    await rm(rootB, { recursive: true, force: true })
    await rm(hub.store.dataDir, { recursive: true, force: true })
  }
})
