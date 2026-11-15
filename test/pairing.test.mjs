import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHubServer } from '../src/hub-server.js'

const quiet = { info() {}, warn() {}, error() {}, log() {} }

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, payload }
}

test('pairing issues a durable token and rotates the code', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-pair-'))
  let hub = await createHubServer({ dataDir, port: 0, tokens: [], logger: quiet })
  t.after(async () => {
    await hub.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  const code = hub.pairingCode()
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)

  const wrong = await postJson(`${hub.url}/v1/pair`, { code: 'AAAA-AAAA', name: 'laptop' })
  assert.equal(wrong.status, 403)

  const paired = await postJson(`${hub.url}/v1/pair`, { code: code.toLowerCase(), name: 'laptop' })
  assert.equal(paired.status, 200)
  assert.ok(typeof paired.payload.token === 'string' && paired.payload.token.length >= 32)
  assert.equal(paired.payload.device, 'laptop')

  const token = paired.payload.token
  const sessions = await fetch(`${hub.url}/v1/sessions`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(sessions.status, 200)

  const rotated = await postJson(`${hub.url}/v1/pair/rotate`, {}, { authorization: `Bearer ${token}` })
  assert.equal(rotated.status, 200)
  assert.notEqual(rotated.payload.code, code)

  const oldCode = await postJson(`${hub.url}/v1/pair`, { code, name: 'old' })
  assert.equal(oldCode.status, 403)
  const newCode = await postJson(`${hub.url}/v1/pair`, { code: rotated.payload.code, name: 'second' })
  assert.equal(newCode.status, 200)

  // A restart keeps paired devices and the current code.
  await hub.close()
  hub = await createHubServer({ dataDir, port: 0, tokens: [], logger: quiet })
  assert.equal(hub.pairingCode(), rotated.payload.code)
  const afterRestart = await fetch(`${hub.url}/v1/sessions`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(afterRestart.status, 200)
})

test('pairing is rate limited', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-sync-pair-limit-'))
  const hub = await createHubServer({ dataDir, port: 0, tokens: [], logger: quiet })
  t.after(async () => {
    await hub.close()
    await rm(dataDir, { recursive: true, force: true })
  })
  let limited = false
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const result = await postJson(`${hub.url}/v1/pair`, { code: 'AAAA-AAAA', name: 'x' })
    if (result.status === 429) {
      limited = true
      break
    }
  }
  assert.equal(limited, true)
})
