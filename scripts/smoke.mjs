/**
 * End-to-end smoke test in a real browser (Playwright driving Microsoft Edge/Chromium).
 * Walks the guided flow and checks that the UI reflects the simulation:
 *   choose → run → move cursor → circuit/state update → WHY → events → step → play → params.
 *
 * Usage: start the app (npm run dev -- --port 5199), then `npm run smoke`.
 * Screenshots land in scripts/out/.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const APP_URL = process.env.LAB_URL ?? 'http://localhost:5199/'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const errors = []
const failures = []
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.log(`  ✗ ${msg}`)
    failures.push(msg)
  }
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(APP_URL)
await page.screenshot({ path: OUT + '01-intro.png' })
check(await page.getByRole('button', { name: /Run simulation/ }).isDisabled(), 'Run is disabled until rectifier and load are chosen')
check(await page.getByRole('radio', { name: /Full-wave/ }).isDisabled(), 'Full-wave is honestly marked unavailable')

await page.getByRole('radio', { name: 'Half-wave' }).click()
await page.getByRole('radio', { name: /^R$/ }).click()
await page.screenshot({ path: OUT + '02-chosen.png' })
await page.getByRole('button', { name: /Run simulation/ }).click()
await page.waitForSelector('.scope-canvas canvas')
await page.waitForTimeout(300)
await page.screenshot({ path: OUT + '03-run.png' })

const headline = () => page.locator('.state-headline').innerText()
const stateTime = () => page.locator('.state-time').innerText()
check(/ON/.test(await headline()), `initial cursor (first positive peak) shows D1 ON — "${await headline()}"`)
check((await page.locator('.circuit--on').count()) === 1, 'circuit diagram shows the ON state')
check((await page.locator('.circuit .flow').count()) === 1, 'current-flow particles are present while conducting')

// Drag the cursor into the negative half-cycle of cycle 1 (θ ≈ 270° → t ≈ 15 ms of 80 ms).
const overlay = page.locator('.scope-layer--overlay')
const box = await overlay.boundingBox()
const plotLeft = box.x + 58
const plotRight = box.x + box.width - 14
const xAt = (t) => plotLeft + (t / 0.08) * (plotRight - plotLeft)
await page.mouse.move(xAt(0.005), box.y + 150)
await page.mouse.down()
await page.mouse.move(xAt(0.015), box.y + 150, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(150)
await page.screenshot({ path: OUT + '04-negative.png' })
check(/OFF/.test(await headline()) && /reverse/.test(await headline()), `negative half-cycle shows D1 OFF, reverse biased — "${await headline()}"`)
check((await page.locator('.circuit--off').count()) === 1, 'circuit diagram shows the OFF state')
check((await page.locator('.circuit .flow').count()) === 0, 'no current-flow animation while blocking')
const readings = await page.locator('.readings').innerText()
check(/Vout\s+0\.000 V/.test(readings) && /Io\s+0\.000 A/.test(readings), 'Vout = 0 and Io = 0 while OFF (readings panel)')

// WHY chain
await page.getByRole('button', { name: /WHY\?/ }).click()
await page.waitForTimeout(100)
const chain = await page.locator('#why-chain').innerText()
check(/Circuit condition/i.test(chain) && /reverse biased/.test(chain), 'WHY chain explains the reverse-biased state')
await page.screenshot({ path: OUT + '05-why.png', fullPage: false })

// Event markers: click the first diode event chip.
await page.locator('.event-chip--diode').first().click()
await page.waitForTimeout(150)
check((await page.locator('.event-detail').count()) === 1, 'clicking an event opens WHAT HAPPENED / WHY')
const evText = await page.locator('.event-detail').innerText()
check(/What happened\?/i.test(evText) && /Why did it happen\?/i.test(evText), 'event detail has both sections')
await page.screenshot({ path: OUT + '06-event.png' })

// Step forward through events: time must advance monotonically.
const t0 = await stateTime()
await page.getByRole('button', { name: 'Step forward' }).click()
await page.waitForTimeout(80)
const t1 = await stateTime()
await page.getByRole('button', { name: 'Step forward' }).click()
await page.waitForTimeout(80)
const t2 = await stateTime()
check(t0 !== t1 && t1 !== t2, `step forward advances the instant (${t0} → ${t1} → ${t2})`)
await page.getByRole('button', { name: 'Step backward' }).click()
await page.waitForTimeout(80)
check((await stateTime()) === t1, 'step backward returns to the previous event')

// Angle stepping: 15° increments
await page.getByRole('radio', { name: '15°' }).click()
await page.getByRole('button', { name: 'Step forward' }).click()
await page.waitForTimeout(80)
const theta = (await stateTime()).match(/θ = ([\d.]+)°/)?.[1]
const rem = Number(theta) % 15
check(theta !== undefined && Math.min(rem, 15 - rem) < 0.2, `15° stepping lands on a 15° multiple (θ = ${theta}°)`)

// Playback moves the cursor
await page.getByRole('button', { name: 'Play' }).click()
await page.waitForTimeout(700)
const tp1 = await stateTime()
await page.waitForTimeout(500)
const tp2 = await stateTime()
await page.getByRole('button', { name: 'Pause' }).click()
check(tp1 !== tp2, `playback advances time (${tp1} → ${tp2})`)

// Parameters: change R from 10 Ω to 100 Ω → peak current must drop 10×.
const ioPeakCell = async () => (await page.locator('tr', { hasText: 'Peak current' }).locator('td').first().innerText()).trim()
const before = await ioPeakCell()
const rInput = page.getByLabel(/^Resistance/).last()
await rInput.fill('100')
await rInput.press('Enter')
await page.waitForTimeout(200)
const after = await ioPeakCell()
check(before !== after, `changing R re-runs the simulation (Io,pk ${before} → ${after})`)
const num = (s) => parseFloat(s) * (/mA/.test(s) ? 1e-3 : 1)
// Displayed values are rounded to 4 significant figures, so allow 0.5 %.
check(Math.abs(num(before) / num(after) / 10 - 1) < 0.005, 'Io,pk scales as 1/R')

// Invalid typed input is rejected, not propagated.
await rInput.fill('abc')
await rInput.press('Enter')
await page.waitForTimeout(100)
check((await rInput.inputValue()) === '100', 'non-numeric input is rejected and the last valid value restored')

// Coarse timestep with a half-sample phase → theory flag appears.
await page.locator('details.advanced > summary').click()
await page.getByLabel(/^Phase/).last().fill('11.25')
await page.getByLabel(/^Phase/).last().press('Enter')
await page.getByRole('radio', { name: 'Manual' }).click()
const dtInput = page.getByLabel(/^Manual Δt/).last()
await dtInput.fill('1250')
await dtInput.press('Enter')
await page.waitForTimeout(200)
check((await page.locator('.flag').count()) === 1, 'coarse timestep raises the "error exceeds tolerance" flag')
await page.locator('.measure').scrollIntoViewIfNeeded()
await page.screenshot({ path: OUT + '07-flag.png' })
await page.getByRole('radio', { name: /Auto/ }).click()
await page.waitForTimeout(200)
check((await page.locator('.flag').count()) === 0, 'auto timestep clears the flag')

// Frequency change: 60 Hz → ripple frequency row shows 60 Hz.
const fInput = page.getByLabel(/^Frequency/).last()
await fInput.fill('60')
await fInput.press('Enter')
await page.waitForTimeout(200)
const ripple = await page.locator('tr', { hasText: 'Ripple frequency' }).locator('td').first().innerText()
check(/^60\.000 Hz/.test(ripple.trim()), `ripple frequency follows the source (${ripple.trim()})`)

// Ideal diode
await page.getByRole('radio', { name: 'Ideal' }).click()
await page.waitForTimeout(200)
const gamma = await page.locator('tr', { hasText: 'Conduction angle' }).locator('td').first().innerText()
check(/^180\.00°/.test(gamma.trim()), `ideal diode conduction angle = 180° (${gamma.trim()})`)

const body = await page.locator('body').innerText()
check(!/NaN|Infinity|undefined/.test(body), 'no NaN / Infinity / undefined anywhere on the page')
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: OUT + '08-final.png', fullPage: true })

// Phone-width layout
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(300)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(overflow <= 0, `no horizontal page scroll at 390 px (overflow ${overflow}px)`)
await page.screenshot({ path: OUT + '09-mobile.png', fullPage: false })

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
await browser.close()

console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll smoke checks passed')
process.exit(failures.length ? 1 : 0)
