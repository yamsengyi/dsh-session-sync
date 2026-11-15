import test from 'node:test'
import assert from 'node:assert/strict'
import { diffManifests } from '../src/manifest.js'

function file(path, blob) {
  return { path, blob }
}

test('first sync keeps local-only files and adds remote-only files', () => {
  const local = [file('notes.txt', 'local'), file('.dsh-sync.json', 'marker')]
  const remote = [file('.dsh-sync.json', 'marker'), file('other.txt', 'remote')]
  const plan = diffManifests([], local, remote)
  assert.deepEqual(plan.remove, [])
  assert.deepEqual(plan.conflicts, [])
  assert.deepEqual(plan.write.map((entry) => entry.path), ['other.txt'])
})

test('first sync keeps a differing local file and saves the remote copy as a conflict', () => {
  const plan = diffManifests([], [file('same.txt', 'local')], [file('same.txt', 'remote')])
  assert.deepEqual(plan.write, [])
  assert.deepEqual(plan.remove, [])
  assert.equal(plan.conflicts.length, 1)
  assert.equal(plan.conflicts[0].path, 'same.txt')
  assert.equal(plan.conflicts[0].reason, 'both-added')
  assert.equal(plan.conflicts[0].remoteBlob, 'remote')
})

test('with a base, an unchanged local file follows a remote deletion', () => {
  const base = [file('gone.txt', 'old')]
  const local = [file('gone.txt', 'old')]
  const plan = diffManifests(base, local, [])
  assert.deepEqual(plan.remove, ['gone.txt'])
  assert.deepEqual(plan.write, [])
  assert.deepEqual(plan.conflicts, [])
})
