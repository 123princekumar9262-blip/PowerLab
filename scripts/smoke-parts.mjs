/**
 * Browser check of the 3D Machines Lab: every part of every model can be SEEN when it is selected — wherever it
 * sits (inside a casing, inside a winding…). For each part: select it, capture the 3D area, hide just that part,
 * capture again; the pixels that change are the part's own. Run with the dev server (or a preview) on 5199:
 *   node scripts/smoke-parts.mjs
 */
import { chromium } from 'playwright'
import { fullWorkspace } from './full-workspace.mjs'
import { decodePng } from './png.mjs'

const URL = process.env.LAB_URL ?? 'http://localhost:5199/'
/** A selected part must cover at least this share of the 3D area (about 400 px of a 760 × 630 view). */
const MIN_SHARE = 0.0008
const failures = []
const errors = []
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failures.push(msg)
}
const browser = fullWorkspace(await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' }))
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const wait = (ms = 300) => page.waitForTimeout(ms)

/** The 3D area alone: the labels, chip and toolbar over it hidden for the capture. */
async function capture() {
  const tag = await page.addStyleTag({ content: '.mx-canvas-host > :not(.mx-canvas), .mx-viewport > :not(.mx-canvas-host) { visibility: hidden !important }' })
  const png = decodePng(await page.locator('.mx-canvas canvas').screenshot())
  await tag.evaluate((n) => n.remove())
  return png
}
function changed(a, b) {
  let n = 0
  for (let i = 0; i < a.data.length; i += a.channels) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30) n++
  return n / (a.width * a.height)
}

await page.goto(URL + '#/machines')
await wait(600)
const all = await page.locator('.mx-row:not(.mx-row--planned)').evaluateAll((els) => els.map((e) => e.getAttribute('href').split('/').pop()))
// ONLY=power-diode,mosfet checks just those models
const ids = process.env.ONLY ? all.filter((x) => process.env.ONLY.split(',').includes(x)) : all
let total = 0
let seen = 0
const weakest = []
for (const id of ids) {
  await page.goto(URL + '#/machines/' + id)
  await page.waitForSelector('.mx-canvas canvas', { timeout: 60000 })
  await wait(900)
  await page.getByLabel('Labels').selectOption('off')
  while ((await page.getByRole('button', { name: /^Expand / }).count()) > 0) await page.getByRole('button', { name: /^Expand / }).first().click()
  const names = (await page.locator('.mx-parts .mx-node:not(.mx-node--asm)').allInnerTexts()).map((t) => t.trim())
  const hidden = []
  for (const name of names) {
    total++
    await page.locator('.mx-parts .mx-node:not(.mx-node--asm)', { hasText: name }).first().click()
    await wait(250)
    const a = await capture()
    await page.getByRole('button', { name: `Hide ${name}`, exact: true }).click()
    await wait(250)
    const b = await capture()
    await page.getByRole('button', { name: `Show ${name}`, exact: true }).click()
    await page.locator('.mx-selchip-x').click()
    let share = changed(a, b)
    // a very thin part (bond wires…) must at least be offered a close-up, and be clearly seen in it
    if (share < MIN_SHARE) {
      await page.locator('.mx-parts .mx-node:not(.mx-node--asm)', { hasText: name }).first().click()
      await wait(900)
      const offered = (await page.locator('.mx-small-hint').count()) === 1
      await page.locator('.mx-part-actions button', { hasText: 'Inspect' }).click()
      await wait(900)
      const c = await capture()
      await page.getByRole('button', { name: `Hide ${name}`, exact: true }).click()
      await wait(250)
      const d = await capture()
      await page.getByRole('button', { name: `Show ${name}`, exact: true }).click()
      await page.locator('.mx-part-actions button', { hasText: 'Back to the whole machine' }).click()
      await wait(700)
      await page.locator('.mx-selchip-x').click()
      const close = changed(c, d)
      console.log(`    ${id} / ${name}: ${(share * 100).toFixed(3)} % at normal distance; close-up offered: ${offered}; with Inspect ${(close * 100).toFixed(2)} %`)
      if (offered && close >= MIN_SHARE * 4) share = close
    }
    weakest.push([share, `${id} / ${name}`])
    if (share >= MIN_SHARE) seen++
    else hidden.push(`${name} (${(share * 100).toFixed(3)} %)`)
  }
  check(hidden.length === 0, `${id}: every selected part can be seen (${names.length - hidden.length} of ${names.length})${hidden.length ? ' — not: ' + hidden.join(', ') : ''}`)
}
weakest.sort((x, y) => x[0] - y[0])
console.log(`  smallest: ${weakest.slice(0, 5).map(([s, n]) => `${n} ${(s * 100).toFixed(2)} %`).join(' · ')}`)
check(seen === total, `all ${total} parts of all ${ids.length} models are visible when selected (${seen} of ${total})`)
await browser.close()
check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PART-VISIBILITY CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
