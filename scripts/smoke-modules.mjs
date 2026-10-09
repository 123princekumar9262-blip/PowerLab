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
// Every lab is in the universal workspace shell (Phase 5): modes as tabs (+ "More"), WHY, one Explore menu.
const explore = async (name) => {
  await page.locator('.ws-explore-btn').click()
  await page.locator('.ws-explore-menu').getByRole(/Show current path|Focus/.test(name) ? 'menuitemcheckbox' : 'menuitem', { name, exact: true }).click()
  await page.waitForTimeout(250)
}
const closePanels = async () => {
  for (let i = 0; i < 3 && (await page.locator('.ws .ov').count()); i++) await page.locator('.ws .ov-close').first().click()
}
const openAnalyze = async () => {
  if (!(await page.locator('.wv-analyze').count())) await explore('Measurements & theory')
  await page.waitForTimeout(300)
}
const mode = (name) => ({
  click: async () => {
    if (name === 'Analyze') return openAnalyze()
    await closePanels()
    if (['Explore', 'Learn', 'Experiment', 'Predict'].includes(name)) await page.locator('.ws-modes-tabs').getByRole('tab', { name, exact: true }).click()
    else {
      await page.locator('.ws-more-modes summary').click()
      await page.locator('.ws-more-modes').getByRole('button', { name, exact: true }).click()
    }
    await page.waitForTimeout(200)
  },
})
const openState = async () => {
  if (!(await page.locator('.ov .dc-state').count())) await explore('State details')
}
const stateText = async () => {
  await openState()
  return page.locator('.ov .dc-state').innerText()
}
const openWhy = async () => {
  if (!(await page.locator('.wv-why').count())) await page.locator('.ws-act--why').click()
  await page.waitForTimeout(150)
}
const whyQ = async (name) => {
  await openWhy()
  return page.locator('.wv-why').getByRole('button', { name })
}
/** Measurements & theory → Theory vs Simulation → the exact solution: every row ✓. */
const exactAllPass = async () => {
  await openAnalyze()
  await page.locator('.wv-analyze').getByRole('tab', { name: /Theory vs Simulation/ }).click()
  const d = page.locator('.wp-more', { hasText: 'Textbook formulas compared' })
  if ((await d.getAttribute('open')) === null) await d.locator('summary').click()
  await page.getByRole('radio', { name: 'Exact solution' }).click()
  const txt = await page.locator('.dc-table').innerText()
  return txt.includes('✓') && !txt.includes('✗') && !(await page.locator('.wv-analyze .row-bad').count())
}
/** The lab's other topics, through the header's "Change circuit" menu (each has its own address). */
const topicTab = (name) => ({
  isVisible: async () => {
    await page.getByLabel('Change circuit').click()
    const v = await page.locator('.ws-switch-menu').getByRole('link', { name, exact: true }).isVisible()
    await page.getByLabel('Change circuit').click()
    return v
  },
  click: async () => {
    await page.getByLabel('Change circuit').click()
    await page.locator('.ws-switch-menu').getByRole('link', { name, exact: true }).click()
    await page.waitForSelector('.ws .cscope canvas')
    await page.waitForTimeout(400)
  },
})
const density = async (name) => {
  await page.locator('.ws-level select').selectOption(name.toLowerCase())
  await page.waitForTimeout(200)
}
const h1 = () => page.locator('.ws-head h1').innerText()

const MODULES = [
  { tab: 'Control', route: '#/labs/control/buck', title: 'Closed-loop buck converter', state: /duty|Vout|error/i, side: 'Bode', sideCheck: '.bode-line', experiment: 'Open the loop', choice: 'Vout stays off target', lesson: 'Why a converter needs a feedback loop' },
  { tab: 'Devices', route: '#/labs/devices/mosfet', title: 'MOSFET double-pulse test', state: /Miller plateau|current rise|ohmic|delay/i, side: null, experiment: 'Double the gate resistance', choice: 'About doubles', lesson: 'Turn-on in four phases' },
  { tab: 'Drives', route: '#/labs/drives/dc-motor', title: 'DC motor fed by a PWM chopper', state: /supply|freewheel|rpm/i, side: 'Energy', experiment: 'Double the load torque', choice: 'The current about doubles; the speed drops only a little', lesson: 'Starting a DC motor' },
  { tab: 'Magnetics', route: '#/labs/magnetics/inductor', title: 'Gapped-core winding on a square-wave bridge', state: /linear|saturated/i, side: 'B–i', sideCheck: '.bi-curve', experiment: 'Double the air gap', choice: 'It stays the same — the current rises instead', lesson: 'Volt-seconds set the flux' },
  { tab: 'EV', route: '#/labs/ev/drivetrain', title: 'Electric drivetrain on a drive cycle', state: /km\/h/i, side: 'Energy', experiment: 'Switch regeneration off', choice: 'rises noticeably', lesson: 'Where the energy goes in the city' },
  { tab: 'Losses & Thermal', route: '#/labs/thermal/switch', title: 'Switch losses through the thermal path', state: /junction Tj/i, side: 'Zth', sideCheck: '.bi-traj', experiment: 'Halve the heatsink resistance', choice: 'falls by more than the heatsink share — the losses fall too', lesson: 'Power cycling' },
]

await page.goto(URL + '#/labs')
await page.waitForTimeout(400)
for (const name of ['Rectifiers', 'DC-DC Converters', 'PWM', 'Inverters', 'Switching Devices', 'Magnetics', 'Control', 'Drives & Motors', 'Losses & Thermal', 'EV Power Electronics'])
  check(await page.locator('.lab-card', { hasText: name }).first().isVisible(), `${name} is in the Labs catalogue`)
const go = async (route) => {
  await page.goto(URL + route)
  await page.waitForTimeout(900)
}

for (const M of MODULES) {
  console.log(`── ${M.tab}`)
  await go(M.route)
  check(page.url().includes(M.route), `${M.tab} is addressable (${M.route})`)
  check((await h1()).length > 0 && (await page.locator('.ws-bench svg').count()) > 0, `${M.tab}: the workspace opens with its circuit ("${await h1()}")`)
  check(M.state.test(await stateText()), `${M.tab}: state card describes the simulated state`)
  await openWhy()
  check((await page.locator('.wv-why .why-q').count()) >= 2, `${M.tab}: WHY offers questions from the simulation`)
  check(/WHAT IS HAPPENING/i.test(await page.locator('.wv-why').innerText()) && /PHYSICAL PRINCIPLE/i.test(await page.locator('.wv-why').innerText()), `${M.tab}: WHY answers what · why · principle`)
  await closePanels()
  check((await page.locator('.cscope canvas').count()) > 0, `${M.tab}: scope drawn`)
  // Beginner: the diagram keeps names, set values and words; live numbers come back from Standard
  check(!/\d/.test(await page.locator('.ws-bench svg .path-caption').first().textContent()), `${M.tab}: Beginner diagram caption has no live numbers`)
  await density('Standard')
  check(/\d/.test(await page.locator('.ws-bench svg .path-caption').first().textContent()), `${M.tab}: Standard diagram caption shows the live numbers`)
  if (M.side) {
    await explore(M.side)
    check(await page.locator('.ws .ov .dc-energy, .ws .ov .bode').first().isVisible(), `${M.tab}: Explore → "${M.side}" shows`)
    if (M.sideCheck) check((await page.locator(M.sideCheck).count()) > 0, `${M.tab}: ${M.side} chart drawn`)
    await closePanels()
  } else {
    await openState()
    check(/Eon/.test(await page.locator('.ov .dc-mode').innerText()), `${M.tab}: switching-loss card shows Eon (Standard)`)
    await closePanels()
  }
  check(await exactAllPass(), `${M.tab}: SIMULATION agrees with the exact THEORY (every row ✓)`)
  await page.screenshot({ path: `${OUT}${M.route.split('/')[2]}-analyze.png`, fullPage: true })
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
await go('#/labs/drives/dc-motor')
await density('Standard')
await page.getByRole('radio', { name: 'Two-quadrant', exact: true }).click()
await page.getByRole('radio', { name: 'Duty step', exact: true }).click()
await page.waitForTimeout(800)
await openState()
check(/braking −\d/.test(await page.locator('.ov .dc-mode').first().innerText()), 'Drives: the two-quadrant duty step brakes (negative current, energy returned)')
check(await exactAllPass(), 'Drives: two-quadrant braking also agrees with the exact theory')
await mode('Explore').click()
await page.getByRole('button', { name: 'Reset' }).click()
await page.waitForTimeout(500)
// past the start-up's last event, WHY still says what happens next: how the motor settles until the run ends
{
  const sc = page.locator('.cscope canvas.scope-layer--overlay')
  await sc.scrollIntoViewIfNeeded()
  const b = await sc.boundingBox()
  await page.mouse.click(b.x + 64 + (b.width - 64 - 54) * 0.9, b.y + b.height / 2)
  await openWhy()
  const nx = await page.locator('.wv-why .why-next').innerText()
  check(/No further event in this run/.test(nx) && /Speed .+ rpm/.test(nx), 'Drives: past the last event, "What happens next" describes the settling from the simulation')
  await closePanels()
}
await go('#/labs/magnetics/inductor')
await page.getByRole('radio', { name: 'Start-up', exact: true }).click()
await page.waitForTimeout(800)
check(/start-up peak/i.test(await page.locator('main.ws').innerText()) || /SATURATED|saturated/.test(await stateText()), 'Magnetics: start-up shows the flux-doubling inrush')
check(await exactAllPass(), 'Magnetics: start-up agrees with the exact theory')
await mode('Explore').click()
await go('#/labs/ev/drivetrain')
await page.getByRole('radio', { name: '0–100', exact: true }).click()
await page.waitForTimeout(800)
check(/0–100/.test(await page.locator('main.ws').innerText()), 'EV: the acceleration test runs')
check(await exactAllPass(), 'EV: 0–100 km/h agrees with the quadrature theory')
await mode('Explore').click()
await page.screenshot({ path: `${OUT}ev-accel.png`, fullPage: true })

// existing labs unchanged
await go('#/labs/rectifiers/1ph-bridge')
await page.waitForSelector('.scope-canvas canvas', { timeout: 10000 }).catch(() => {}) // the rectifier workspace loads on demand
check(await page.getByRole('heading', { level: 1, name: 'Single-phase bridge' }).isVisible(), 'Rectifier lab still opens (Single-phase bridge)')

await browser.close()
check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
