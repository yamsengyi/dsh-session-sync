import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHubServer } from '../src/hub-server.js'
import { SyncClient } from '../src/sync-client.js'

const quiet = { info() {}, warn() {}, error() {}, log() {} }

test('restart repairs a torn tail and a stale head', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-recovery-'))
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  const header = { id: 's-r', version: 3, createdAt: 1_700_000_000_000 }
  const events = [0, 1, 2, 3].map((seq) => ({ type: 'turn/start', seq, time: seq + 1, data: { turn: 1 } }))

  const first = await createHubServer({ dataDir, port: 0, tokens: [{ name: 'dev', token: 'tok' }], logger: quiet })
  const client = new SyncClient({ baseUrl: first.url, token: 'tok', logger: quiet })
  await client.pushSession({ header, events, expectHead: 0 })
  await first.close()

  const sessionDir = join(dataDir, 'sessions', 's-r')
  // Simulate a crash: a torn final line plus metadata that never caught up.
  await appendFile(join(sessionDir, 'events.jsonl'), '{"type":"turn/end","seq":4')
  const meta = JSON.parse(await readFile(join(sessionDir, 'meta.json'), 'utf8'))
  meta.head = 2
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta))

  const second = await createHubServer({ dataDir, port: 0, tokens: [{ name: 'dev', token: 'tok' }], logger: quiet })
  t.after(async () => {
    await second.close()
  })
  const recovered = new SyncClient({ baseUrl: second.url, token: 'tok', logger: quiet })

  const page = await recovered.pullSession('s-r', 0, 10)
  assert.equal(page.head, 4)
  assert.equal(page.events.length, 4)
  assert.deepEqual(page.events.map((event) => event.seq), [0, 1, 2, 3])

  const repaired = await readFile(join(sessionDir, 'events.jsonl'), 'utf8')
  assert.ok(repaired.endsWith('\n'))
  assert.equal(repaired.split('\n').filter(Boolean).length, 4)

  const next = await recovered.pushSession({
    header,
    events: [{ type: 'turn/end', seq: 4, time: 9, data: { turn: 1, reason: { kind: 'success' } } }],
    expectHead: 4,
  })
  assert.equal(next.head, 5)
})
