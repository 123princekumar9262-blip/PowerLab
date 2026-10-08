/**
 * PWM lab + inverters (single-phase, three-phase, SPWM, SVPWM) — end-to-end in Edge (Playwright).
 * Run with the dev server on 5199: node scripts/smoke-inv.mjs
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const OUT = 'scripts/out/'
mkdirSync(OUT, { recursive: true })
const errors = []
const failures = []
const check = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures.push(msg)
}
const URL = process.env.LAB_URL ?? 'http://localhost:5199/'
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const mode = (name) => page.locator('.modes').getByRole('tab', { name, exact: true })
const topicTab = (name) => page.locator('.dc-converters').getByRole('tab', { name, exact: true })
const stateText = () => page.locator('.dc-state').innerText()
const scope = page.locator('.cscope canvas.scope-layer--overlay')
const clickScope = async (frac) => {
  await scope.scrollIntoViewIfNeeded()
  const b = await scope.boundingBox()
  await page.mouse.click(b.x + 64 + (b.width - 64 - 54) * frac, b.y + b.height / 2)
  await page.waitForTimeout(150)
}
const exactAllPass = async () => {
  await mode('Analyze').click()
  await page.getByRole('radio', { name: 'Exact solution' }).click()
  const txt = await page.locator('.dc-table').innerText()
  return txt.includes('✓') && !txt.includes('✗')
}

// ── PWM lab ───────────────────────────────────────────────────────────────────
await page.goto(URL)
await page.locator('.platform-bar').getByRole('tab', { name: 'PWM' }).click()
await page.waitForTimeout(500)
check(page.url().endsWith('#pwm'), 'PWM module is addressable (#pwm)')
check(await page.getByRole('heading', { name: 'PWM modulator' }).isVisible(), 'PWM lab shows the modulator block diagram')
check(/Gate (HIGH|LOW)/.test(await stateText()), 'state card reports the comparator output')
check(await page.locator('.dc-why').getByRole('tab', { name: /Why is the gate (HIGH|LOW)\?/ }).isVisible(), 'WHY explains the gate from r and c')
check(await exactAllPass(), 'PWM: every harmonic agrees with the Bessel series (natural sampling)')
await page.getByRole('tab', { name: 'Spectrum' }).click()
check((await page.locator('.spectrum-chart .spec-bar').count()) > 30, 'PWM spectrum chart with simulated bars')
check((await page.locator('.spectrum-chart .spec-theory').count()) > 10, 'PWM spectrum chart with theory markers')
await page.screenshot({ path: `${OUT}pwm-analyze.png`, fullPage: true })
await page.getByRole('radio', { name: 'Regular (symmetric)' }).click()
await page.waitForTimeout(300)
await page.getByRole('tab', { name: 'Measurements' }).click()
await page.getByRole('radio', { name: 'Exact solution' }).click()
{
  const t = await page.locator('.dc-table').innerText()
  check(t.includes('✓') && !t.includes('✗'), 'PWM: regular sampling also agrees with its Bessel series')
}
await mode('Experiment').click()
await page.getByRole('button', { name: /Double the carrier frequency/ }).click()
await page.getByRole('radio', { name: /higher order/ }).click()
await page.getByRole('button', { name: /Run the experiment/ }).click()
await page.waitForTimeout(300)
check(/matches the simulation/.test(await page.locator('.dc-mode-panel').innerText()), 'PWM experiment: prediction confirmed by the simulation')
await mode('Learn').click()
await page.getByRole('button', { name: /How a PWM signal is made/ }).click()
check(/carrier/i.test(await page.locator('.lesson-text').innerText()), 'PWM lesson starts (text from the simulation)')
await page.getByRole('button', { name: '← Lessons' }).click()
await mode('Explore').click()

// ── Inverters: single-phase ───────────────────────────────────────────────────
await page.locator('.platform-bar').getByRole('tab', { name: 'Inverters' }).click()
await page.waitForTimeout(600)
check(page.url().endsWith('#inverters'), 'Inverters module is addressable (#inverters)')
for (const t of ['Single-phase', 'Three-phase', 'SPWM', 'SVPWM']) check(await topicTab(t).isVisible(), `inverter topic ${t}`)
check(await page.getByRole('heading', { name: 'Single-phase inverter' }).isVisible(), 'single-phase H-bridge shown')
// Just after the polarity reversal (cycle 2, θ ≈ 185°) the diodes carry the current.
await clickScope((1 + 185 / 360) / 2)
check(/freewheeling/.test(await page.locator('.dc-interval').innerText()), 'after the voltage reverses a diode freewheels (inductive load)')
check(await page.locator('.dc-why').getByRole('tab', { name: /Why does D\d conduct/ }).isVisible(), 'WHY explains why the diode (not the IGBT) conducts')
await page.locator('.inv-diagram [data-part="S1"]').click()
check(/IGBT S1/.test(await page.locator('.dc-inspect').innerText()), 'clicking S1 opens its inspector')
check(await exactAllPass(), 'single-phase: simulation agrees with the exact ideal-switch theory')
await mode('Explore').click()
await page.getByRole('radio', { name: 'Quasi-square (α)' }).click()
await page.waitForTimeout(300)
check(await exactAllPass(), 'quasi-square: simulation agrees with the theory')
await page.screenshot({ path: `${OUT}inv-1ph.png`, fullPage: true })
await mode('Explore').click()

// ── Three-phase ───────────────────────────────────────────────────────────────
await topicTab('Three-phase').click()
await page.waitForTimeout(600)
check(await page.getByRole('heading', { name: /Three-phase inverter/ }).isVisible(), 'three-phase six-step inverter shown')
await page.getByRole('radio', { name: 'Standard' }).click()
check(/vnN/.test(await stateText()), 'state card shows the load-neutral voltage (Standard)')
check(await exactAllPass(), 'six-step: simulation agrees with the theory')
await mode('Explore').click()

// ── SPWM ──────────────────────────────────────────────────────────────────────
await topicTab('SPWM').click()
await page.waitForTimeout(800)
check(await exactAllPass(), 'SPWM bipolar: simulation agrees with the theory')
await mode('Explore').click()
await page.getByRole('radio', { name: '1-ph unipolar' }).click()
await page.waitForTimeout(800)
check(await exactAllPass(), 'SPWM unipolar: simulation agrees with the theory')
await page.getByRole('tab', { name: 'Spectrum' }).click()
check((await page.locator('.spectrum-chart').count()) >= 2, 'SPWM: voltage and current spectra')
await page.screenshot({ path: `${OUT}inv-spwm.png`, fullPage: true })
await mode('Explore').click()

// ── SVPWM ─────────────────────────────────────────────────────────────────────
await topicTab('SVPWM').click()
await page.waitForTimeout(1000)
check(await page.locator('.sv-diagram').isVisible(), 'SVPWM: space-vector hexagon with sector and dwell times')
check(/Sector \d/.test(await page.locator('.sv-diagram').innerHTML()), 'SVPWM: the present sector is shown')
await page.getByRole('radio', { name: 'Standard' }).click()
check(/sector/.test(await stateText()), 'SVPWM: dwell times in the state card')
check(await exactAllPass(), 'SVPWM: simulation agrees with the exact ideal-switch theory')
await mode('Predict').click()
await page.getByLabel('Your prediction').fill('80')
await page.getByRole('button', { name: 'Simulate and check' }).click()
await page.waitForTimeout(400)
check(/SIMULATION:/.test(await page.locator('.dc-mode-panel').innerText()), 'SVPWM prediction answered by the simulation')
await page.screenshot({ path: `${OUT}inv-svpwm.png`, fullPage: true })

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
if (failures.length) {
  console.log(`\n${failures.length} PWM/inverter smoke check(s) failed`)
  process.exit(1)
}
console.log('All PWM / inverter smoke checks passed')
