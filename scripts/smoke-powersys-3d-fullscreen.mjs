// Power Systems 3D viewer: the full-screen button, in the browser's own full-screen mode and in the window-filling
// fallback (used when full screen is not allowed). Uses Module 14's scene; the viewer is shared by every 3D module.
import { chromium } from 'playwright'

const URL = (process.env.LAB_URL ?? 'http://localhost:5199/') + '#/subjects/power-systems/hvdc-facts?mode=explore'
const OUT = 'scripts/out'
const results = []
const check = (ok, msg) => results.push(`${ok ? '✓' : '✗'} ${msg}`)

const browser = await chromium.launch({ channel: 'msedge' })
for (const mode of ['native', 'overlay']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  if (mode === 'overlay') await page.addInitScript(() => Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false }))
  await page.goto(URL)
  await page.waitForSelector('.ps3 canvas', { timeout: 20000 })
  await page.waitForTimeout(1200)
  const before = await page.locator('.ps3 canvas').first().boundingBox()
  const btn = page.locator('.ps3-full-btn').first()
  check((await btn.innerText()).includes('Full screen'), `${mode}: the button is offered`)
  await btn.click()
  await page.waitForTimeout(900)
  const full = await page.evaluate(() => ({ native: !!document.fullscreenElement, cls: document.querySelector('.ps3')?.classList.contains('is-full') }))
  check(full.cls && (mode === 'native' ? full.native : !full.native), `${mode}: entered (${JSON.stringify(full)})`)
  const after = await page.locator('.ps3 canvas').first().boundingBox()
  check(
    after.width > before.width * 1.2 && after.height > before.height * 1.5,
    `${mode}: the 3D view grows (${Math.round(before.width)}×${Math.round(before.height)} → ${Math.round(after.width)}×${Math.round(after.height)})`,
  )
  const labels = await page.locator('.ps3-label').count()
  check(labels > 3, `${mode}: labels still drawn (${labels})`)
  check(await page.locator('.ps3-parts').first().isVisible(), `${mode}: the parts list is visible`)
  check((await btn.innerText()).includes('Exit full screen'), `${mode}: the button now offers to exit`)
  // select a part from the list: its info shows in full screen
  await page.locator('.ps3-part').nth(1).click()
  await page.waitForTimeout(300)
  check(await page.locator('.ps3-info').first().isVisible(), `${mode}: a selected part's info shows`)
  // 2D in full screen
  await page.getByRole('radio', { name: '2D diagram' }).first().click()
  await page.waitForTimeout(400)
  check(await page.locator('.ps3-fallback').first().isVisible(), `${mode}: the 2D diagram works in full screen`)
  await page.getByRole('radio', { name: '3D' }).first().click()
  await page.waitForTimeout(900)
  if (OUT) await page.screenshot({ path: `${OUT}/fullscreen-${mode}.png` })
  // a real Esc leaves the browser's own full screen; scripts cannot send that key, so leave it the same way the browser does
  if (mode === 'native') await page.evaluate(() => document.exitFullscreen())
  else await page.keyboard.press('Escape')
  await page.waitForTimeout(900)
  const left = await page.evaluate(() => ({
    native: !!document.fullscreenElement,
    cls: document.querySelector('.ps3')?.classList.contains('is-full'),
    scroll: getComputedStyle(document.body).overflow,
  }))
  check(!left.native && !left.cls && left.scroll !== 'hidden', `${mode}: Esc leaves full screen (${JSON.stringify(left)})`)
  const back = await page.locator('.ps3 canvas').first().boundingBox()
  check(Math.abs(back.height - before.height) < 4, `${mode}: back to the normal size (${Math.round(back.height)} px)`)
  // the button toggles off too
  await btn.click()
  await page.waitForTimeout(700)
  await btn.click()
  await page.waitForTimeout(700)
  check(!(await page.evaluate(() => document.querySelector('.ps3')?.classList.contains('is-full'))), `${mode}: the button also leaves full screen`)
  check(errors.length === 0, `${mode}: no console errors${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}`)
  await ctx.close()
}
await browser.close()
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0)
