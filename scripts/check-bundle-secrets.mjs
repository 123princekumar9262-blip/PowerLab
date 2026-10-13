/**
 * Fails if the production bundle (dist/) contains a Gemini / Google API credential or a direct Gemini call.
 * Run after `vite build` (the build script does). It reports only WHETHER and WHERE a match was found — never
 * the matched text.
 *
 * Checks: Google API keys (AIza…), Google AI Studio keys (AQ.…), the Gemini API host and the key header (the
 * browser must only ever call /api/tutor), and — if a local .env.local holds a key — that exact value.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
if (!existsSync(DIST)) {
  console.error('check-bundle-secrets: no dist/ folder — build first.')
  process.exit(1)
}
const patterns = [
  ['Google API key (AIza…)', /AIza[0-9A-Za-z_-]{35}/],
  ['Google AI Studio key (AQ.…)', /\bAQ\.[0-9A-Za-z_-]{30,}/],
  ['direct Gemini API host', /generativelanguage\.googleapis\.com/],
  ['Gemini key header', /x-goog-api-key/i],
]
// the exact value of a key kept in the local environment file, whatever its variable name
const known = []
if (existsSync('.env.local'))
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*[A-Z0-9_]*(?:GEMINI|GOOGLE)[A-Z0-9_]*\s*=\s*(.+?)\s*$/)
    if (m && m[1].replace(/^['"]|['"]$/g, '').length >= 20) known.push(m[1].replace(/^['"]|['"]$/g, ''))
  }

const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|mjs|cjs|html|css|json|map|txt|svg)$/i.test(f)) files.push(p)
  }
}
walk(DIST)

const found = []
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const [name, re] of patterns) if (re.test(text)) found.push(`${name} in ${f}`)
  if (known.some((k) => text.includes(k))) found.push(`the key from .env.local in ${f}`)
}
if (found.length) {
  console.error(`check-bundle-secrets: FOUND ${found.length} problem(s) in the production bundle:\n  - ${found.join('\n  - ')}`)
  process.exit(1)
}
console.log(`check-bundle-secrets: no Gemini credential or direct Gemini call in ${files.length} built files${known.length ? ' (including the local key)' : ''}.`)
