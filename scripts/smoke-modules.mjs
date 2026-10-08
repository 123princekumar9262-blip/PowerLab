/**
 * Control, Devices, Drives, Magnetics, EV, Engineering — end-to-end in Edge (Playwright).
 * Every module: addressable route, circuit + state card, WHY, the exact comparison all ✓, one experiment
 * confirmed by the simulation, one lesson, one prediction, and its side panel.
 * Run with the dev server on 5199: node scripts/smoke-modules.mjs
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
const stateText = () => page.locator('.dc-state').innerText()
const exactAllPass = async () => {
  await mode('Analyze').click()
  await page.waitForTimeout(300)
  await page.getByRole('radio', { name: 'Exact solution' }).click()
  const txt = await page.locator('.dc-table').innerText()
  return txt.includes('✓') && !txt.includes('✗')
}
const density = (name) => page.locator('.density-seg').getByRole('radio', { name, exact: true }).click()

const MODULES = [
  { tab: 'Control', hash: 'control', title: 'Closed-loop buck converter', state: /duty|Vout|error/i, side: 'Bode', sideCheck: '.bode-line', experiment: 'Open the loop', choice: 'Vout stays off target', lesson: 'Why a converter needs a feedback loop' },
  { tab: 'Devices', hash: 'devices', title: 'MOSFET double-pulse test', state: /Miller plateau|current rise|ohmic|delay/i, side: null, experiment: 'Double the gate resistance', choice: 'About doubles', lesson: 'Turn-on in four phases' },
  { tab: 'Drives', hash: 'drives', title: 'DC motor fed by a PWM chopper', state: /supply|freewheel|rpm/i, side: 'Energy', experiment: 'Double the load torque', choice: 'The current about doubles; the speed drops only a little', lesson: 'Starting a DC motor' },
  { tab: 'Magnetics', hash: 'magnetics', title: 'Gapped-core winding on a square-wave bridge', state: /linear|saturated/i, side: 'B–i', sideCheck: '.bi-curve', experiment: 'Double the air gap', choice: 'It stays the same — the current rises instead', lesson: 'Volt-seconds set the flux' },
  { tab: 'EV', hash: 'ev', title: 'Electric drivetrain on a drive cycle', state: /km\/h/i, side: 'Energy', experiment: 'Switch regeneration off', choice: 'rises noticeably', lesson: 'Where the energy goes in the city' },
  { tab: 'Engineering', hash: 'engineering', title: 'Switch losses through the thermal path', state: /junction Tj/i, side: 'Zth', sideCheck: '.bi-traj', experiment: 'Halve the heatsink resistance', choice: 'falls by more than the heatsink share — the losses fall too', lesson: 'Power cycling' },
]

await page.goto(URL)
const modules = page.locator('.platform-bar')
for (const name of ['Rectifiers', 'DC-DC', 'PWM', 'Inverters', 'Devices', 'Drives', 'Magnetics', 'Control', 'EV', 'Engineering'])
  check(!(await modules.getByRole('tab', { name, exact: true }).isDisabled()), `${name} module is open in the top navigation`)

for (const M of MODULES) {
  console.log(`── ${M.tab}`)
  await modules.getByRole('tab', { name: M.tab, exact: true }).click()
  await page.waitForTimeout(900)
  check(page.url().endsWith(`#${M.hash}`), `${M.tab} is addressable (#${M.hash})`)
  check(await page.getByRole('heading', { name: M.title }).isVisible(), `${M.tab}: circuit "${M.title}" shown`)
  check(M.state.test(await stateText()), `${M.tab}: state card describes the simulated state`)
  check((await page.locator('.dc-why').getByRole('tab').count()) >= 2, `${M.tab}: WHY offers questions from the simulation`)
  check((await page.locator('.cscope canvas').count()) > 0, `${M.tab}: scope drawn`)
  await density('Standard')
  if (M.side) {
    await page.getByRole('tab', { name: M.side, exact: true }).click()
    await page.waitForTimeout(200)
    check(await page.locator('.dc-energy, .bode').first().isVisible(), `${M.tab}: side panel "${M.side}" shows`)
    if (M.sideCheck) check((await page.locator(M.sideCheck).count()) > 0, `${M.tab}: ${M.side} chart drawn`)
  } else check(/Eon/.test(await page.locator('.dc-mode').innerText()), `${M.tab}: switching-loss card shows Eon (Standard)`)
  check(await exactAllPass(), `${M.tab}: SIMULATION agrees with the exact THEORY (every row ✓)`)
  await page.screenshot({ path: `${OUT}${M.hash}-analyze.png`, fullPage: true })
  await mode('Experiment').click()
  await page.getByRole('button', { name: new RegExp(M.experiment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
  await page.getByRole('radio', { name: M.choice, exact: true }).click()
  await page.getByRole('button', { name: /Run the experiment/ }).click()
  await page.waitForTimeout(600)
  check(/matches the simulation/.test(await page.locator('.dc-mode-panel').innerText()), `${M.tab}: experiment "${M.experiment}" — the simulation confirms the right answer`)
  await mode('Learn').click()
  await page.getByRole('button', { name: new RegExp(M.lesson) }).first().click()
  await page.waitForTimeout(500)
  check(((await page.locator('.lesson-text').innerText()) ?? '').length > 40 && !/NaN|undefined/.test(await page.locator('.lesson-text').innerText()), `${M.tab}: lesson "${M.lesson}" starts with text from the simulation`)
  await page.getByRole('button', { name: '← Lessons' }).click()
  await mode('Predict').click()
  await page.waitForTimeout(200)
  const input = page.locator('.predict-input input')
  if (await input.count()) await input.fill('1')
  else await page.locator('.dc-mode-panel .choice').first().click()
  await page.locator('.dc-mode-panel .run-btn').first().click()
  await page.waitForTimeout(500)
  check(await page.locator('.dc-mode-panel .exp-verdict').isVisible(), `${M.tab}: a prediction is answered by the simulation`)
  check(/THEORY/.test(await page.locator('.dc-mode-panel').innerText()), `${M.tab}: the theory is shown after the simulation answered`)
  await mode('Explore').click()
  await density('Beginner')
}

// module-specific behaviour
console.log('── specifics')
await modules.getByRole('tab', { name: 'Drives', exact: true }).click()
await page.waitForTimeout(600)
await density('Standard')
await page.getByRole('radio', { name: 'Two-quadrant', exact: true }).click()
await page.getByRole('radio', { name: 'Duty step', exact: true }).click()
await page.waitForTimeout(800)
check(/braking −\d/.test(await page.locator('.dc-mode').first().innerText()), 'Drives: the two-quadrant duty step brakes (negative current, energy returned)')
check(await exactAllPass(), 'Drives: two-quadrant braking also agrees with the exact theory')
await mode('Explore').click()
await page.getByRole('button', { name: 'Reset' }).click()
await page.waitForTimeout(500)
await modules.getByRole('tab', { name: 'Magnetics', exact: true }).click()
await page.waitForTimeout(600)
await page.getByRole('radio', { name: 'Start-up', exact: true }).click()
await page.waitForTimeout(800)
check(/start-up peak/i.test(await page.locator('.dc-lab').innerText()) || /SATURATED|saturated/.test(await stateText()), 'Magnetics: start-up shows the flux-doubling inrush')
check(await exactAllPass(), 'Magnetics: start-up agrees with the exact theory')
await mode('Explore').click()
await modules.getByRole('tab', { name: 'EV', exact: true }).click()
await page.waitForTimeout(600)
await page.getByRole('radio', { name: '0–100', exact: true }).click()
await page.waitForTimeout(800)
check(/0–100/.test(await page.locator('.dc-lab').innerText()), 'EV: the acceleration test runs')
check(await exactAllPass(), 'EV: 0–100 km/h agrees with the quadrature theory')
await mode('Explore').click()
await page.screenshot({ path: `${OUT}ev-accel.png`, fullPage: true })

// existing labs unchanged
await modules.getByRole('tab', { name: 'Rectifiers', exact: true }).click()
await page.waitForTimeout(600)
check(await page.getByRole('heading', { name: 'Rectifier Lab' }).isVisible(), 'Rectifier lab still opens unchanged')

await browser.close()
check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
