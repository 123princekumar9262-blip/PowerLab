/**
 * Platform shell + DC-DC buck converter — end-to-end in Edge (Playwright).
 * Run with the dev server on 5199: node scripts/smoke-dcdc.mjs
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
await page.goto(URL)
await page.evaluate(() => localStorage.clear())
await page.reload()

const modules = page.locator('.platform-bar')
const mode = (name) => page.locator('.modes').getByRole('tab', { name, exact: true })
const stateText = () => page.locator('.dc-state').innerText()
const scope = page.locator('.cscope canvas.scope-layer--overlay')
/** Click the scope at a fraction of the shown time window. */
const clickScope = async (frac) => {
  const b = await scope.boundingBox()
  await page.mouse.click(b.x + 64 + (b.width - 64 - 54) * frac, b.y + b.height / 2)
  await page.waitForTimeout(150)
}

// ── Platform shell ───────────────────────────────────────────────────────────
check(await modules.getByRole('tab', { name: 'Rectifiers' }).getAttribute('aria-selected') === 'true', 'platform opens on Rectifiers (existing lab unchanged)')
check(await page.getByRole('heading', { name: 'Rectifier Lab' }).isVisible(), 'rectifier lab header is shown')
for (const name of ['Devices', 'Drives', 'Magnetics', 'Control', 'EV', 'Engineering']) {
  if (!(await modules.getByRole('tab', { name, exact: true }).isDisabled())) check(false, `${name} is shown as planned (disabled)`)
}
check(true, 'unbuilt modules are shown as the roadmap (disabled)')
await modules.getByRole('tab', { name: 'DC-DC' }).click()
await page.waitForTimeout(500)
check(page.url().endsWith('#dcdc'), 'DC-DC is addressable (#dcdc)')
check(!(await page.getByRole('heading', { name: 'Rectifier Lab' }).isVisible().catch(() => false)), 'only the DC-DC environment is shown')
const conv = page.locator('.dc-converters')
check(await conv.getByRole('tab', { name: 'Buck', exact: true }).getAttribute('aria-selected') === 'true', 'Buck is selected')
check(await conv.getByRole('tab', { name: 'Advanced', exact: true }).isDisabled(), 'Advanced converters are shown as planned (disabled)')
for (const m of ['Explore', 'Learn', 'Experiment', 'Predict', 'Analyze']) check(await mode(m).isVisible(), `mode tab ${m}`)

// ── Explore: defaults, channels, state at cursor ───────────────────────────────
check(await page.getByText('SIMULATION VALUES').isVisible(), 'parameters are labelled SIMULATION VALUES')
const chips = await page.locator('.dc-channels .chip--on').allInnerTexts()
check(['Gate', 'Vsw', 'iL', 'Vout'].every((c) => chips.some((x) => x.startsWith(c))) && chips.length === 4, 'default channels: Gate, Vsw, iL, Vout')
check(/Switch ON interval/.test(await stateText()), 'cursor starts in the switch ON interval')
check(/Switch Q1\s*ON/.test(await stateText()) && /Diode D1\s*OFF/.test(await stateText()), 'state: Q1 ON, D1 OFF')
check(await page.locator('.dc-why').getByRole('tab', { name: 'Why is D1 OFF?' }).isVisible(), 'WHY offers “Why is D1 OFF?” in the ON interval')
check((await page.locator('.buck-diagram .wire--flow').count()) > 4, 'current path is highlighted on the circuit')
await page.screenshot({ path: `${OUT}dcdc-explore.png`, fullPage: true })

// Cursor into the OFF interval of period 2 (4 periods shown; D = 0.5 → 1.75/4).
await clickScope(1.75 / 4)
check(/Freewheeling interval/.test(await stateText()), 'cursor in the OFF part: freewheeling interval')
check(/Diode D1\s*ON/.test(await stateText()), 'state: D1 ON while Q1 is OFF')
check(await page.locator('.dc-why').getByRole('tab', { name: 'Why did D1 turn ON?' }).isVisible(), 'WHY: “Why did D1 turn ON?”')
check(/cannot change instantly/.test(await page.locator('.dc-why').innerText()), 'WHY explains the inductor current continuing')
check(await page.locator('.dc-why').getByRole('tab', { name: 'Why is iL falling?' }).isVisible(), 'WHY: iL falling during freewheeling')

// Keyboard: Shift+→ jumps to the next switching event and explains it.
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('Shift+ArrowRight')
await page.waitForTimeout(150)
check(await page.locator('.dc-event').isVisible(), 'Shift+→ jumps to the next switching event and explains it')

// + Add channel
await page.getByRole('button', { name: '+ Add channel' }).click()
await page.locator('.add-menu').getByRole('checkbox').nth(4).check()
await page.getByRole('button', { name: '+ Add channel' }).click()
check((await page.locator('.dc-channels .chip--on').allInnerTexts()).some((x) => x.startsWith('iD')), '+ Add channel adds the diode current')

// Density: Standard shows the mode badge and energy.
await page.getByRole('radio', { name: 'Standard' }).click()
check(/CCM/.test(await page.locator('.dc-mode').innerText()), 'CCM detected from the simulation at the defaults')
await page.locator('.panel-tabs').getByRole('tab', { name: 'Energy' }).click()
check(/Inductor EL/.test(await page.locator('.dc-energy').innerText()) && /power flow now/i.test(await page.locator('.dc-energy').innerText()), 'energy view: EL, EC and power flow')

// Inspector
await page.locator('.buck-diagram [data-part="l"]').click()
check(/Inductor L/.test(await page.locator('.dc-inspect').innerText()) && /Ripple ΔiL/.test(await page.locator('.dc-inspect').innerText()), 'clicking L opens its inspector with ripple and energy')

// DCM: lighter load.
const rIn = page.getByLabel('Load resistance R value')
await rIn.fill('30')
await rIn.press('Enter')
await page.waitForTimeout(400)
check(/DCM/.test(await page.locator('.dc-mode').innerText()), 'R = 30 Ω: DCM detected')
await clickScope(1.95 / 4)
check(/Idle interval/.test(await stateText()), 'DCM: idle interval with both devices OFF')
await page.locator('.panel-tabs').getByRole('tab', { name: 'Why?' }).click()
check(await page.locator('.dc-why').getByRole('tab', { name: 'Why is D1 OFF while Q1 is OFF?' }).isVisible(), 'WHY explains the diode turning off at iL = 0')
await page.screenshot({ path: `${OUT}dcdc-dcm.png`, fullPage: true })

// ── Analyze ───────────────────────────────────────────────────────────────────
await mode('Analyze').click()
await page.waitForTimeout(300)
const table = page.locator('.dc-table')
check(/SIMULATION/.test(await table.innerText()) && /THEORY/.test(await table.innerText()), 'measurements table separates SIMULATION and THEORY')
check(/2 \/ \(1 \+ √\(1 \+ 4K\/D²\)\)/.test(await table.innerText()), 'DCM: the DCM textbook relation is used, not Vout = D·Vin')
await page.getByRole('radio', { name: 'Exact solution' }).click()
const exactText = await table.innerText()
check(exactText.includes('✓') && !exactText.includes('✗'), 'every quantity agrees with the exact analytic solution')
await page.getByRole('tab', { name: 'Theory', exact: true }).click()
check(/volt-second balance/i.test(await page.locator('.dc-theory').innerText()), 'Theory shows the volt-second derivation')
await page.getByRole('tab', { name: 'Duty sweep' }).click()
await page.getByRole('button', { name: /Run duty sweep/ }).click()
await page.waitForTimeout(1500)
check((await page.locator('.sweep-chart > circle.sweep-dot').count()) === 17, 'duty sweep: 17 simulated points on the theory curve')
await page.screenshot({ path: `${OUT}dcdc-analyze.png`, fullPage: true })

// Reset parameters for the modes.
await mode('Explore').click()
await page.getByRole('button', { name: 'Reset' }).click()
await page.waitForTimeout(300)

// ── Experiment ────────────────────────────────────────────────────────────────
await mode('Experiment').click()
await page.getByRole('button', { name: /Change the duty ratio/ }).click()
await page.getByRole('radio', { name: 'Vout rises' }).click()
await page.getByRole('button', { name: /Run the experiment/ }).click()
await page.waitForTimeout(300)
check(/matches the simulation/.test(await page.locator('.dc-mode-panel').innerText()), 'experiment: prediction → run → verdict')
check(/before/i.test(await page.locator('.dc-mode-panel').innerText()) && /4 · Why/.test(await page.locator('.dc-mode-panel').innerText()), 'experiment: before/after table and WHY')

// ── Learn ─────────────────────────────────────────────────────────────────────
await mode('Learn').click()
await page.getByRole('button', { name: /How a buck converter works/ }).click()
check(/The PWM gate chops the input/.test(await page.locator('.dc-mode-panel').innerText()), 'lesson starts at step 1')
for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next →' }).click()
await page.waitForTimeout(200)
check(/volt-second balance/i.test(await page.locator('.dc-mode-panel').innerText()), 'lesson reaches volt-second balance (step 6)')
check(/simulated/.test(await page.locator('.lesson-text').innerText()), 'lesson text quotes simulated values')
await page.getByRole('button', { name: 'Finish' }).click()

// ── Predict ───────────────────────────────────────────────────────────────────
await mode('Predict').click()
await page.getByLabel('Your prediction').fill('12')
await page.getByRole('button', { name: 'Simulate and check' }).click()
await page.waitForTimeout(300)
check(/SIMULATION:/.test(await page.locator('.dc-mode-panel').innerText()), 'prediction answered by the simulation, theory shown afterwards')

// ── Start-up view ─────────────────────────────────────────────────────────────
await mode('Explore').click()
await page.getByRole('radio', { name: 'Start-up' }).click()
await page.waitForTimeout(600)
check(/Start-up from rest/.test(await page.locator('.dc-scope-foot').innerText()), 'start-up view from a discharged circuit')
await page.screenshot({ path: `${OUT}dcdc-startup.png`, fullPage: true })
await page.getByRole('radio', { name: 'Steady state' }).click()

// ── Boost ─────────────────────────────────────────────────────────────────────
await conv.getByRole('tab', { name: 'Boost', exact: true }).click()
await page.waitForTimeout(500)
check(await page.getByRole('heading', { name: 'Boost converter' }).isVisible(), 'Boost: its own circuit')
check(/Vout \+2[34]\.\d+ V/.test(await page.locator('.buck-diagram').innerHTML()), 'Boost: 12 V in, about 24 V out')
await clickScope(1.75 / 4)
check(/Freewheeling interval/.test(await stateText()), 'Boost: freewheeling interval while Q1 is OFF')
check(/RISES until D1/.test(await page.locator('.dc-why').innerText()), 'Boost WHY: the switch node rises above the output')
await mode('Analyze').click()
await page.getByRole('radio', { name: 'Exact solution' }).click()
const boostExact = await page.locator('.dc-table').innerText()
check(boostExact.includes('✓') && !boostExact.includes('✗'), 'Boost: every quantity agrees with the exact solution')
await page.getByRole('radio', { name: 'Textbook formulas' }).click()
check(/Vin\/\(1 − D\)/.test(await page.locator('.dc-table').innerText()), 'Boost: textbook law Vout = Vin/(1 − D)')
await page.screenshot({ path: `${OUT}dcdc-boost.png`, fullPage: true })
await mode('Explore').click()

// ── Buck-boost ────────────────────────────────────────────────────────────────
await conv.getByRole('tab', { name: 'Buck-Boost', exact: true }).click()
await page.waitForTimeout(500)
check(/Vout −1[12]\.\d+ V/.test(await page.locator('.buck-diagram').innerHTML()), 'Buck-boost: the output is negative')
await clickScope(1.75 / 4)
check(/pulled OUT of the output/.test(await page.locator('.dc-path').innerText()), 'Buck-boost: current path explains the negative output')
await mode('Learn').click()
await page.getByRole('button', { name: /How an inverting buck-boost works/ }).click()
check(/charges, the output is isolated/.test(await page.locator('.dc-mode-panel').innerText()), 'Buck-boost lesson starts')
await page.getByRole('button', { name: '← Lessons' }).click()
await mode('Explore').click()
await page.screenshot({ path: `${OUT}dcdc-buckboost.png`, fullPage: true })

// ── Back to rectifiers ────────────────────────────────────────────────────────
await modules.getByRole('tab', { name: 'Rectifiers' }).click()
await page.waitForTimeout(300)
check(await page.getByRole('heading', { name: 'Rectifier Lab' }).isVisible(), 'Rectifiers module is back, unchanged')
await page.goto(URL + '#dcdc')
await page.waitForTimeout(500)
check(await page.locator('.dc-converters').isVisible(), 'deep link #dcdc opens the DC-DC environment')

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
await browser.close()
if (failures.length) {
  console.log(`\n${failures.length} DC-DC smoke check(s) failed`)
  process.exit(1)
}
console.log('All DC-DC smoke checks passed')
