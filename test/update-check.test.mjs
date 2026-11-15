import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, latestVersionFromTags, parseVersion } from '../src/update-check.js'

test('semver comparison treats v-prefixed versions as equal', () => {
  assert.equal(compareVersions('0.4.5', 'v0.4.5'), 0)
  assert.equal(compareVersions('0.4.5', '0.4.6'), -1)
  assert.equal(compareVersions('0.5.0', '0.4.9'), 1)
  assert.equal(compareVersions('0.4.10', '0.4.9'), 1)
})

test('the latest stable tag ignores junk and prereleases', () => {
  const latest = latestVersionFromTags([
    { name: 'v0.4.5' },
    { name: 'v0.4.10' },
    { name: 'v0.5.0-beta.1' },
    { name: 'not-a-version' },
    { name: 'v0.4.9' },
  ])
  assert.equal(latest, 'v0.5.0')
})

test('parseVersion normalizes a tag', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { raw: 'v1.2.3', parts: [1, 2, 3] })
  assert.equal(parseVersion('v1.2'), null)
})
