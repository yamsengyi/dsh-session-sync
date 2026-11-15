/**
 * Workspace ignore rules.
 *
 * Defaults keep version-control internals, dependency trees, and this plugin's
 * own state out of a snapshot. A root `.dshsyncignore` adds rules with
 * gitignore-like semantics: `#` comments, `!` negation, a trailing `/` for
 * directories only, a leading `/` to anchor at the root, and `*` / `**` / `?`
 * wildcards. The last matching rule wins. A directory that is ignored is not
 * walked, so a negation cannot re-include a child of an ignored directory.
 */

export const DEFAULT_IGNORES = [
  '.git/',
  '.dsh-sync/',
  'node_modules/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.DS_Store',
  'Thumbs.db',
]

/** Always applied after user rules so sync state can never be snapshotted. */
const HARD_IGNORES = ['.dsh-sync/']

function globBody(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i += 1
        if (pattern[i + 1] === '/') {
          i += 1
          out += '(?:.*/)?'
        } else {
          out += '.*'
        }
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return out
}

/** Parse one ignore line into a rule, or undefined for comments and blanks. */
export function parseRule(line) {
  let pattern = line.trim()
  if (pattern === '' || pattern.startsWith('#')) return undefined
  let negate = false
  if (pattern.startsWith('!')) {
    negate = true
    pattern = pattern.slice(1)
  }
  const dirOnly = pattern.endsWith('/')
  if (dirOnly) pattern = pattern.slice(0, -1)
  const anchored = pattern.startsWith('/')
  if (anchored) pattern = pattern.slice(1)
  if (pattern === '') return undefined
  const body = globBody(pattern)
  const hasSlash = pattern.includes('/')
  const source = anchored || hasSlash ? `^${body}$` : `(^|/)${body}($|/)`
  return { raw: line.trim(), negate, dirOnly, regex: new RegExp(source) }
}

export function compileRules(lines) {
  return lines.map(parseRule).filter(Boolean)
}

/** Combine defaults, a root `.dshsyncignore` file, extra patterns, and hard rules. */
export function buildRules(ignoreFileText, extra = []) {
  const userLines = ignoreFileText ? ignoreFileText.split(/\r?\n/) : []
  return compileRules([...DEFAULT_IGNORES, ...userLines, ...extra, ...HARD_IGNORES])
}

export function isIgnored(rules, relativePath, isDirectory) {
  let ignored = false
  for (const rule of rules) {
    if (rule.dirOnly && !isDirectory) continue
    if (rule.regex.test(relativePath)) ignored = !rule.negate
  }
  return ignored
}
