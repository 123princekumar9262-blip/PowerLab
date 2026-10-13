/**
 * Platform shell + DC-DC buck converter — end-to-end in Edge (Playwright).
 * Run with the dev server on 5199: node scripts/smoke-dcdc.mjs
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { fullWorkspace } from './full-workspace.mjs'

const OUT = 'scripts/out/'
mkdirSync(OUT, { recursive: true })
const errors = []
const failures = []
const check = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures.push(msg)
}
const URL = process.env.LAB_URL ?? 'http://localhost:5199/'
const browser = fullWorkspace(await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' }))
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(URL + '#/home')
await page.evaluate(() => localStorage.clear())
await page.reload()

const shellNav = page.locator('.side-nav')
const stateText = () => page.locator('.dc-state').innerText()
const scope = page.locator('.cscope canvas.scope-layer--overlay')
/** Click the scope at a fraction of the shown time window. */
const clickScope = async (frac) => {
  await scope.scrollIntoViewIfNeeded()
  const b = await scope.boundingBox()
  await page.mouse.click(b.x + 64 + (b.width - 64 - 54) * frac, b.y + b.height / 2)
  await page.waitForTimeout(150)
}

// ── Platform shell ───────────────────────────────────────────────────────────
check(await page.getByRole('heading', { name: 'Power Electronics Lab', level: 1 }).isVisible(), 'the platform opens on Home')
check((await shellNav.getByRole('link', { name: 'Home' }).getAttribute('aria-current')) === 'page', 'Home is the current page')
await page.getByRole('link', { name: /DC-DC Converters/ }).first().click()
await page.waitForTimeout(300)
check(page.url().endsWith('#/labs/dc-dc'), 'DC-DC landing page is addressable (#/labs/dc-dc)')
for (const t of ['Ćuk', 'SEPIC', 'Zeta', 'Bidirectional']) check(await page.locator('a.topic-card', { hasText: t }).first().isVisible(), `${t} (built since) opens from the landing page`)
await page.getByRole('link', { name: /^Buck Step a DC voltage down/ }).click()
await page.waitForTimeout(700)
check(page.url().endsWith('#/labs/dc-dc/buck'), 'Buck workspace is addressable (#/labs/dc-dc/buck)')
check(!(await page.getByRole('heading', { name: 'Rectifier Lab' }).isVisible().catch(() => false)), 'only the DC-DC environment is shown')
// Buck uses the universal workspace shell (simplified, Phase 4): header, parameters, circuit, one status
// line, WHY + Explore, waveforms.
const wsMode = async (name) => {
  if (['Explore', 'Learn', 'Experiment', 'Predict'].includes(name)) return page.locator('.ws-modes-tabs').getByRole('tab', { name, exact: true }).click()
  await page.locator('.ws-more-modes summary').click()
  await page.locator('.ws-more-modes').getByRole('button', { name, exact: true }).click()
}
const why = () => page.locator('.ws-act--why')
const whyText = () => page.locator('.wv-why').innerText()
const whyQ = (name) => page.locator('.wv-why').getByRole('button', { name, exact: true })
const explore = async (name) => {
  await page.locator('.ws-explore-btn').click()
  await page.locator('.ws-explore-menu').getByRole(/Show current path|Focus/.test(name) ? 'menuitemcheckbox' : 'menuitem', { name }).click()
  await page.waitForTimeout(150)
}
const status = () => page.locator('.wp-status-line').innerText()
const buckState = async () => {
  if (!(await page.locator('.ov .dc-state').count())) await explore('State details')
  return stateText()
}
const openWhy = async () => {
  if (!(await page.locator('.wv-why').count())) await why().click()
}
check(await page.getByRole('heading', { name: 'Buck converter', level: 1 }).isVisible(), 'Buck workspace header names the circuit')
check(await page.getByRole('link', { name: 'Back to DC-DC Converters' }).isVisible(), 'the header has a back link to the lab')
for (const m of ['Explore', 'Learn', 'Experiment', 'Predict']) check(await page.locator('.ws-modes-tabs').getByRole('tab', { name: m, exact: true }).isVisible(), `mode tab ${m}`)
check((await page.locator('.ws-more-modes').count()) === 0, 'DC-DC has exactly four modes, all tabs: no More menu')
check((await page.locator('.ws-modes').getByRole('tab', { name: 'Analyze' }).count()) === 0, 'Analyze is not a mode (Explore → Measurements & theory)')

// ── Explore: defaults, channels, state at cursor ───────────────────────────────
check(await page.getByText('SIMULATION VALUES').isVisible(), 'parameters are labelled SIMULATION VALUES')
const chips = await page.locator('.wp-channels .chip--on').allInnerTexts()
check(['Gate', 'Vout', 'iL'].every((c) => chips.some((x) => x.startsWith(c))) && chips.length === 3, 'default channels: Gate, Vout, iL')
check(/Switch ON interval/.test(await buckState()), 'cursor starts in the switch ON interval')
check(/Switch Q1\s*ON/.test(await stateText()) && /Diode D1\s*OFF/.test(await stateText()), 'state: Q1 ON, D1 OFF')
check(/SWITCH ON/i.test(await status()) && /diode OFF/.test(await status()), 'status line: switch ON, diode OFF')

// Number fields: a visible keyboard focus, and the field always shows the value the simulation uses
{
  const vin = page.getByLabel('Input voltage Vin value')
  const frame = page.locator('.pfield-input', { has: vin })
  const look = () => frame.evaluate((el) => ({ border: getComputedStyle(el).borderColor, shadow: getComputedStyle(el).boxShadow }))
  const rest = await look()
  await page.locator('.pfield', { has: vin }).locator('input[type="range"]').focus()
  await page.keyboard.press('Tab')
  const focused = await look()
  check((await vin.evaluate((el) => el === document.activeElement)) && focused.border !== rest.border && focused.shadow !== 'none', 'keyboard focus on a number field is visible (accent frame and ring)')
  const diagram = () => page.locator('.buck-diagram').textContent()
  for (const n of [1, 2]) {
    await vin.fill('99999')
    await vin.press('Enter')
    await page.waitForTimeout(300)
    check((await vin.inputValue()) === '400' && /Limited to 400 V/.test(await page.locator('.pfield', { has: vin }).innerText()) && (await diagram()).includes('400.0 V'), `out-of-range Vin (entry ${n}): the field shows the 400 V the simulation uses, and says it was limited`)
  }
  await vin.fill('30')
  await vin.press('Enter')
  await page.waitForTimeout(300)
  check((await vin.inputValue()) === '30' && !/Limited to/.test(await page.locator('.pfield', { has: vin }).innerText()) && (await diagram()).includes('30.00 V'), 'a valid value afterwards: applied, and the limit note is gone')
  await vin.fill('24')
  await vin.press('Enter')
  await page.waitForTimeout(300)
}
await openWhy()
check(await whyQ('Why is D1 OFF?').isVisible(), 'WHY offers “Why is D1 OFF?” in the ON interval')
check(/What happens next/i.test(await whyText()) && /gate goes LOW at t = /.test(await whyText()), 'WHY: what happens next quotes the next gate edge')
check((await page.locator('.buck-diagram .wire--flow').count()) > 4, 'the current flows on the circuit from the start (its conducting path)')
await explore('Show current path')
check((await page.locator('.buck-diagram .wire--flow').count()) === 0, 'Explore → Show current path turns the flow off')
await explore('Show current path')
check((await page.locator('.buck-diagram .wire--flow').count()) > 4, '… and on again')
await page.screenshot({ path: `${OUT}dcdc-explore.png`, fullPage: true })

// Cursor into the OFF interval of period 2 (4 periods shown; D = 0.5 → 1.75/4).
await clickScope(1.75 / 4)
check(/Freewheeling interval/.test(await buckState()), 'cursor in the OFF part: freewheeling interval')
check(/Diode D1\s*ON/.test(await stateText()), 'state: D1 ON while Q1 is OFF')
check(/SWITCH OFF/i.test(await status()) && /diode freewheeling/.test(await status()), 'status line: switch OFF, diode freewheeling')
await openWhy()
check(await whyQ('Why did D1 turn ON?').isVisible(), 'WHY: “Why did D1 turn ON?”')
check(/cannot change instantly/.test(await whyText()), 'WHY explains the inductor current continuing')
check(await whyQ('Why is iL falling?').isVisible(), 'WHY: iL falling during freewheeling')

// Keyboard: Shift+→ jumps to the next switching event; the Events panel explains it.
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('Shift+ArrowRight')
await page.waitForTimeout(150)
await explore('Switching events')
check(await page.locator('.wv-event-detail').isVisible(), 'Shift+→ jumps to the next switching event and the Events panel explains it')
await page.locator('.ov-close').first().click()

// + Add waveform
await page.getByRole('button', { name: '+ Add waveform' }).click()
await page.locator('.add-menu').getByRole('checkbox', { name: /^iD/ }).check()
await page.getByRole('button', { name: '+ Add waveform' }).click()
check((await page.locator('.wp-channels .chip--on').allInnerTexts()).some((x) => x.startsWith('iD')), '+ Add waveform adds the diode current')

// Energy (Explore)
await explore('Energy')
check(/Inductor EL/.test(await page.locator('.wv-energy').innerText()) && /supplying/i.test(await page.locator('.wv-energy').innerText()) && /conserved/.test(await page.locator('.wv-energy').innerText()), 'energy view: EL, EC, every element’s power, Σp conserved')
await page.locator('.ov-close').first().click()

// Inspector: clicking a part
await page.locator('.buck-diagram [data-part="l"]').click()
check(/Inductor L/.test(await page.locator('.wv-inspect').innerText()) && /Ripple ΔiL/.test(await page.locator('.wv-inspect').innerText()), 'clicking L opens its inspector with ripple and energy')
await page.locator('.ov-close').first().click()

// DCM: lighter load (Analyze → Overview names the mode).
const rIn = page.getByLabel('Load resistance R value')
await rIn.fill('30')
await rIn.press('Enter')
await page.waitForTimeout(400)
await explore('Measurements & theory')
check(/DCM/.test(await page.locator('.wv-analyze').innerText()), 'R = 30 Ω: DCM detected')
await page.locator('.ov-close').first().click()
await clickScope(1.95 / 4)
check(/Idle interval/.test(await buckState()), 'DCM: idle interval with both devices OFF')
await page.locator('.ov-close').first().click()
await openWhy()
check(await whyQ('Why is D1 OFF while Q1 is OFF?').isVisible(), 'WHY explains the diode turning off at iL = 0')
await page.screenshot({ path: `${OUT}dcdc-dcm.png`, fullPage: true })

// ── Analyze (an action-bar panel) ─────────────────────────────────────────────
await explore('Measurements & theory')
await page.waitForTimeout(300)
await page.locator('.wv-analyze').getByRole('tab', { name: /Theory vs Simulation/ }).click()
check(/SIMULATION/.test(await page.locator('.wv-table').innerText()) && /THEORY/.test(await page.locator('.wv-table').innerText()) && !/⚠/.test(await page.locator('.wv-table').innerText()), 'Theory vs Simulation: every row agrees with the exact solution')
await page.locator('.wp-more > summary', { hasText: /^Textbook formulas compared$/ }).click()
const table = page.locator('.dc-table')
check(/SIMULATION/.test(await table.innerText()) && /THEORY/.test(await table.innerText()), 'measurements table separates SIMULATION and THEORY')
check(/2 \/ \(1 \+ √\(1 \+ 4K\/D²\)\)/.test(await table.innerText()), 'DCM: the DCM textbook relation is used, not Vout = D·Vin')
await page.getByRole('radio', { name: 'Exact solution' }).click()
const exactText = await table.innerText()
check(exactText.includes('✓') && !exactText.includes('✗'), 'every quantity agrees with the exact analytic solution')
if ((await page.locator('.wp-more', { hasText: /^Derivation/ }).getAttribute('open')) === null) await page.locator('.wp-more > summary', { hasText: /^Derivation$/ }).click()
check(/volt-second balance/i.test(await page.locator('.dc-theory').innerText()), 'Theory shows the volt-second derivation')
await page.locator('.wp-more > summary', { hasText: /^Duty sweep$/ }).click()
const sweepStart = Date.now()
await page.getByRole('button', { name: /Run duty sweep/ }).click()
check((Date.now() - sweepStart) < 2000, `the sweep button returns at once (page stays responsive: ${Date.now() - sweepStart} ms)`)
await page.waitForFunction(() => document.querySelectorAll('.sweep-chart > circle.sweep-dot').length === 17, null, { timeout: 30000 })
console.log(`    (duty sweep, DCM, 17 points in the browser: ${Date.now() - sweepStart} ms)`)
check((await page.locator('.sweep-chart > circle.sweep-dot').count()) === 17, 'duty sweep: 17 simulated points on the theory curve')
await page.screenshot({ path: `${OUT}dcdc-analyze.png`, fullPage: true })
await page.locator('.ov-close').first().click()

// Reset parameters for the modes.
await page.getByRole('button', { name: 'Reset' }).click()
await page.waitForTimeout(300)

// ── Experiment ────────────────────────────────────────────────────────────────
await wsMode('Experiment')
await page.getByRole('button', { name: /Change the duty ratio/ }).click()
await page.getByRole('radio', { name: 'Vout rises' }).click()
await page.getByRole('button', { name: /Run the experiment/ }).click()
await page.waitForTimeout(300)
check(await page.locator('.ws-side .ws-activity').isVisible(), 'Experiment: the mode’s panel is the side panel')
check(/matches the simulation/.test(await page.locator('.dc-mode-panel').innerText()), 'experiment: prediction → run → verdict')
check(/before/i.test(await page.locator('.dc-mode-panel').innerText()) && /4 · Why/.test(await page.locator('.dc-mode-panel').innerText()), 'experiment: before/after table and WHY')

// ── Learn ─────────────────────────────────────────────────────────────────────
await wsMode('Learn')
await page.getByRole('button', { name: /How a buck converter works/ }).click()
check(/The PWM gate chops the input/.test(await page.locator('.dc-mode-panel').innerText()), 'lesson starts at step 1')
for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next →' }).click()
await page.waitForTimeout(200)
check(/volt-second balance/i.test(await page.locator('.dc-mode-panel').innerText()), 'lesson reaches volt-second balance (step 6)')
check(/simulated/.test(await page.locator('.lesson-text').innerText()), 'lesson text quotes simulated values')
await page.getByRole('button', { name: 'Finish' }).click()

// ── Predict ───────────────────────────────────────────────────────────────────
await wsMode('Predict')
await page.getByLabel('Your prediction').fill('12')
await page.getByRole('button', { name: 'Simulate and check' }).click()
await page.waitForTimeout(300)
check(/SIMULATION:/.test(await page.locator('.dc-mode-panel').innerText()), 'prediction answered by the simulation, theory shown afterwards')

// ── Start-up view ─────────────────────────────────────────────────────────────
await wsMode('Explore')
await page.getByRole('radio', { name: 'Start-up' }).click()
await page.waitForTimeout(600)
check(/Start-up from rest/.test(await page.locator('.wp-run-note').innerText()), 'start-up view from a discharged circuit')
await page.screenshot({ path: `${OUT}dcdc-startup.png`, fullPage: true })
await page.getByRole('radio', { name: 'Steady state' }).click()

// ── Boost (the same workspace shell) — reached from the header's "Change circuit" menu ──
await page.getByLabel('Change circuit').click()
const menuLinks = await page.locator('.ws-switch-menu a').allInnerTexts()
check(menuLinks.join('|') === 'Buck|Boost|Buck-Boost|Ćuk|SEPIC|Zeta|Bidirectional', `Change circuit lists the ready converters only (${menuLinks.join(', ')})`)
await page.locator('.ws-switch-menu').getByRole('link', { name: 'Boost', exact: true }).click()
await page.waitForSelector('.ws-head h1:text-is("Boost converter")')
await page.waitForTimeout(500)
check(page.url().endsWith('#/labs/dc-dc/boost'), 'Change circuit → Boost has its own address')
check((await page.locator('.ws-actions .ws-act').count()) === 3 && (await page.locator('.ws-params .pfield-label').allInnerTexts()).length >= 4, 'Boost: the same simplified workspace as Buck (parameters, WHY, Ask, Explore)')
check(/Vout\s*\+2[34]\.\d+ V/.test(await buckState()), 'Boost: 12 V in, about 24 V out')
await clickScope(1.75 / 4)
check(/Freewheeling interval/.test(await buckState()), 'Boost: the OFF interval while Q1 is OFF')
check(/SWITCH OFF/i.test(await status()) && /diode feeds the output/.test(await status()), 'Boost status: switch OFF, the diode feeds the output (not “freewheeling”)')
await page.locator('.ov-close').first().click()
await openWhy()
check(/RISES until D1/.test(await whyText()), 'Boost WHY: the switch node rises above the output')
check(/What happens next/i.test(await whyText()), 'Boost WHY: what happens next, from the run')
await page.locator('.ov-close').first().click()
await explore('Energy')
check(/conserved/.test(await page.locator('.wv-energy').innerText()), 'Boost energy: every element’s power, Σp conserved')
await page.locator('.ov-close').first().click()
await explore('Measurements & theory')
await page.locator('.wv-analyze').getByRole('tab', { name: /Theory vs Simulation/ }).click()
await page.locator('.wp-more > summary', { hasText: /^Textbook formulas compared$/ }).click()
await page.getByRole('radio', { name: 'Exact solution' }).click()
const boostExact = await page.locator('.dc-table').innerText()
check(boostExact.includes('✓') && !boostExact.includes('✗'), 'Boost: every quantity agrees with the exact solution')
await page.getByRole('radio', { name: 'Textbook formulas' }).click()
check(/Vin\/\(1 − D\)/.test(await page.locator('.dc-table').innerText()), 'Boost: textbook law Vout = Vin/(1 − D)')
await page.screenshot({ path: `${OUT}dcdc-boost.png`, fullPage: true })
await page.locator('.ov-close').first().click()

// ── Buck-boost ────────────────────────────────────────────────────────────────
await page.getByLabel('Change circuit').click()
await page.locator('.ws-switch-menu').getByRole('link', { name: 'Buck-Boost', exact: true }).click()
await page.waitForSelector('.ws-head h1:text-is("Inverting buck-boost converter")')
await page.waitForTimeout(500)
check(/Vout\s*−1[12]\.\d+ V/.test(await buckState()), 'Buck-boost: the output is negative')
await page.locator('.ov-close').first().click()
await clickScope(1.75 / 4)
// (the current path is on from the start in every circuit)
check(/pulled OUT of the output/.test(await page.locator('.wp-path').innerText()), 'Buck-boost: current path explains the negative output')
await wsMode('Learn')
await page.getByRole('button', { name: /How an inverting buck-boost works/ }).click()
check(/charges, the output is isolated/.test(await page.locator('.dc-mode-panel').innerText()), 'Buck-boost lesson starts')
await page.getByRole('button', { name: '← Lessons' }).click()
await wsMode('Explore')
await page.screenshot({ path: `${OUT}dcdc-buckboost.png`, fullPage: true })

// ── Back to rectifiers ────────────────────────────────────────────────────────
await page.goto(URL + '#/labs/rectifiers/1ph-bridge')
await page.waitForSelector('.scope-canvas canvas') // the rectifier workspace loads on demand
check(await page.getByRole('heading', { level: 1, name: 'Single-phase bridge' }).isVisible(), 'Rectifiers workspace is back (Single-phase bridge)')
await page.goto(URL + '#dcdc')
await page.waitForTimeout(500)
check(page.url().endsWith('#/labs/dc-dc'), 'old deep link #dcdc redirects to the DC-DC lab')

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
await browser.close()
if (failures.length) {
  console.log(`\n${failures.length} DC-DC smoke check(s) failed`)
  process.exit(1)
}
console.log('All DC-DC smoke checks passed')
