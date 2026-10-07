/**
 * Freewheeling-diode end-to-end smoke test (Playwright + Edge). Run with the dev server on 5199:
 *   npm run dev -- --port 5199   then   node scripts/smoke-fw.mjs
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

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(process.env.LAB_URL ?? 'http://localhost:5199/')
await page.evaluate(() => localStorage.clear())
await page.reload()
const mode = (name) => page.locator('.modes').getByRole('tab', { name, exact: true })
const panelTab = (name) => page.locator('.panel-tabs').getByRole('tab', { name, exact: true })

await page.getByRole('radio', { name: 'Half-wave', exact: true }).click()
await page.getByRole('radio', { name: 'RL', exact: true }).click()
await page.getByRole('button', { name: /Run simulation/ }).click()
await page.waitForTimeout(400)
check((await page.locator('.circuit .diode').count()) === 1, 'RL rectifier without Dfw: one diode')
check(!(await page.locator('.fw-panel').count()), 'no freewheel panel while Dfw is OFF')

// Toggle the freewheeling diode ON
await page.getByRole('button', { name: /Freewheeling diode: OFF/ }).click()
await page.waitForTimeout(500)
check((await page.locator('.circuit .diode').count()) === 2, 'Dfw ON: schematic shows D1 and Dfw')
check(/freewheeling diode/.test(await page.locator('.bench-title').innerText()), 'bench title names the freewheeling diode')
check(await page.locator('.legend').getByText('Ifw', { exact: true }).isVisible(), 'scope offers the Ifw channel')
await page.getByRole('button', { name: '+ Add channel' }).click()
check(await page.locator('.channel-pop').getByRole('checkbox', { name: /^WL/ }).isVisible(), 'the E_L (WL) channel can be added')
await page.keyboard.press('Escape')
await page.locator('.bench-title').click()
check((await page.locator('.flag[role="alert"]').count()) === 0, 'simulation agrees with theory (no ⚠ flag)')
await page.getByRole('button', { name: /^Measurements/ }).click()
await page.locator('.drawer').getByRole('tab', { name: 'Diodes', exact: true }).click()
check(await page.locator('.drawer').getByText('Dfw conduction per cycle').isVisible(), 'Measurements → Diodes has the Dfw rows')
await page.keyboard.press('Escape')

// Step through conduction: step 5 = freewheel current flows
await page.getByRole('button', { name: /Step through conduction/ }).click()
for (let k = 0; k < 4; k++) await page.getByRole('button', { name: 'Next step →' }).click()
await page.waitForTimeout(300)
check(/Freewheel current flows/.test(await page.locator('.step-panel h2').innerText()), 'step-through reaches step 5 "Freewheel current flows"')
const fwState = await page.locator('.fw-state-big').innerText()
check(fwState === 'ON', `freewheel card follows the cursor: Dfw ${fwState}`)
check(/Dfw ON/.test(await page.locator('.state-headline').innerText()), 'state panel headline: Dfw ON')
const vout = await page.locator('.fw-instant').innerText()
check(/−0\.700 V/.test(vout), 'paused instant: Vout clamped at −Vf')
check((await page.locator('svg.circuit path.wire--active').count()) > 0, 'active wires highlighted')
await page.screenshot({ path: OUT + 'fw-10-freewheeling.png' })
await page.getByRole('button', { name: /Current path/ }).click()
const path = await page.locator('.path-vertical').innerText()
check(/L[\s\S]*R[\s\S]*Dfw/.test(path), 'current path L → R → Dfw')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'WHY?' }).click()
await page.getByRole('button', { name: 'Show detailed explanation' }).click()
const why = await page.locator('#fw-why li').count()
check(why === 7, `"Why is Dfw ON?" has 7 steps (${why})`)
check(/E_L = ½·L·i²/.test(await page.locator('#fw-why').innerText()), 'WHY quotes E_L = ½·L·i²')

// Physics Lens: ten stages
await page.getByRole('button', { name: /Physics Lens/ }).click()
check((await page.locator('.lens-panel .lens-steps li').count()) === 10, 'Physics Lens has 10 freewheel stages')
for (let k = 0; k < 7; k++) await page.getByRole('button', { name: 'Next stage →' }).click()
check(/Freewheeling diode turns on/.test(await page.locator('.lens-panel h2').innerText()), 'lens stage 8: freewheeling diode turns on')
check((await page.locator('svg.circuit.lens--fw-on').count()) === 1, 'schematic emphasises the stage')
await page.getByRole('button', { name: 'Close Physics Lens' }).click()
await page.getByRole('button', { name: 'Close step-through' }).click()

// Comparison (a primary view of its own)
await page.locator('.view-seg').getByRole('tab', { name: 'With / without Dfw' }).click()
await page.waitForTimeout(800)
const cmp = await page.locator('.compare').innerText()
check(/never goes below −0\.700 V/.test(cmp), 'comparison: Vout clamped at −Vf with Dfw vs negative without')
check(/continuous/.test(cmp), 'comparison: load current becomes continuous')
check((await page.locator('.compare .cmp-trace').count()) === 8, 'comparison draws both circuits on 4 lanes')
check((await page.locator('.compare .cmp-band').count()) > 0, 'comparison shades where the outputs differ')
await page.locator('.compare').screenshot({ path: OUT + 'fw-11-compare.png' })

// Guided experiment 2
await mode('Experiment').click()
await page.getByRole('button', { name: /2 · Enable the freewheeling diode/ }).click()
await page.waitForTimeout(800)
const exp = await page.locator('.mode-panel').first().innerText()
check(/Freewheeling diode added/.test(exp) && /What does the physics say\?/i.test(exp), 'experiment 2: what changed, why, and what the physics says')
await page.screenshot({ path: OUT + 'fw-12-experiment.png' })

// Prediction A–D
await mode('Predict').click()
await page.getByRole('button', { name: /B\. Becomes smoother/ }).click()
await page.getByRole('button', { name: 'Run the simulation' }).click()
await page.waitForTimeout(600)
check(/Your prediction was right/.test(await page.locator('.mode-panel').first().innerText()), 'prediction: the simulation says the current becomes smoother')
await mode('Explore').click()

// Toggle OFF again: original circuit
await page.getByRole('button', { name: /Freewheeling diode: ON/ }).click()
await page.waitForTimeout(400)
check((await page.locator('.circuit .diode').count()) === 1, 'Dfw OFF: back to the plain RL rectifier')

const body = await page.locator('body').innerText()
check(!/NaN|Infinity|undefined/.test(body), 'no NaN / Infinity / undefined on the page')
await page.setViewportSize({ width: 390, height: 844 })
await page.getByRole('button', { name: /Freewheeling diode: OFF/ }).click()
await page.waitForTimeout(400)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(overflow <= 0, `no horizontal page scroll at 390 px (overflow ${overflow}px)`)
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll freewheeling-diode smoke checks passed')
process.exit(failures.length ? 1 : 0)
