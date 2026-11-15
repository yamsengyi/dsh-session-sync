/**
 * Latest-tag lookup for the Session sync settings page.
 *
 * The plugin is installed from GitHub, so the repository tags are the update
 * source. This module stays independent of DSH and accepts an injected fetch
 * for tests.
 */

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/

/** @param {unknown} value @returns {{raw: string, parts: number[]} | null} */
export function parseVersion(value) {
  const match = VERSION.exec(String(value ?? '').trim())
  if (!match) return null
  return {
    raw: `v${match[1]}.${match[2]}.${match[3]}`,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
  }
}

/** @param {string} left @param {string} right @returns {-1 | 0 | 1} */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] < b.parts[index]) return -1
    if (a.parts[index] > b.parts[index]) return 1
  }
  return 0
}

/** Pick the highest stable tag from GitHub's tag objects (or plain strings). */
export function latestVersionFromTags(tags) {
  const versions = (Array.isArray(tags) ? tags : [])
    .map((tag) => parseVersion(typeof tag === 'string' ? tag : tag?.name))
    .filter(Boolean)
    .sort((a, b) => compareVersions(a.raw, b.raw))
  return versions.length > 0 ? versions[versions.length - 1].raw : null
}

/**
 * Query the public GitHub tags API. No token is used; callers cache the result
 * so an unauthenticated rate limit is not hit on every settings render.
 */
export async function fetchLatestVersion(options = {}) {
  const repo = options.repo ?? 'yamsengyi/dsh-session-sync'
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 5_000
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/tags?per_page=30`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-session-sync',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`GitHub tags request failed: ${response.status}`)
  const tags = await response.json()
  const latest = latestVersionFromTags(tags)
  if (!latest) throw new Error('GitHub tags contain no stable version')
  return latest
}
