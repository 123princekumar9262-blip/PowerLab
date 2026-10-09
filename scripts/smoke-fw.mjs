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
const BASE = process.env.LAB_URL ?? 'http://localhost:5199/'
await page.goto(BASE + '#/home')
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('pel.prefs', JSON.stringify({ level: 'standard' })) })
await page.goto(BASE + '#/labs/rectifiers/1ph-half-wave?load=RL')
await page.reload()
// The simplified workspace (Phase 4): modes as tabs (+ "More"), WHY, and one Explore menu.
const MENU = { 'Current path': 'Show current path', Inspect: 'Inspect a component', Analyze: 'Measurements & theory', Measurements: 'Measurements & theory', Energy: 'Energy', Events: 'Switching events', State: 'State details', Focus: 'Focus view' }
const explore = async (name) => {
  await page.locator('.ws-explore-btn').click()
  await page.locator('.ws-explore-menu').getByRole(/Show current path|Focus/.test(name) ? 'menuitemcheckbox' : 'menuitem', { name }).click()
  await page.waitForTimeout(150)
}
const menuItems = async () => {
  await page.locator('.ws-explore-btn').click()
  const items = await page.locator('.ws-explore-menu [role^=menuitem]').allInnerTexts()
  await page.keyboard.press('Escape')
  return items.map((x) => x.replace(/[✓⚠]/g, '').trim().split('\n').pop().trim())
}
const mode = (name) => ({
  click: async () => {
    if (['Explore', 'Learn', 'Experiment'].includes(name)) await page.locator('.ws-modes-tabs').getByRole('tab', { name, exact: true }).click()
    else {
      await page.locator('.ws-more-modes summary').click()
      await page.locator('.ws-more-modes').getByRole('button', { name, exact: true }).click()
    }
    await page.waitForTimeout(150)
  },
})
const why = () => page.locator('.ws-act--why')
const openWhy = async () => {
  if (!(await page.locator('.wv-why').count())) await why().click()
  if (!(await page.locator('.wv-more').count())) await page.locator('.wv-more-btn').click()
}
const openState = async () => {
  if (!(await page.locator('.ov .state-headline').count())) await explore('State details')
}
const action = (name) => ({
  click: async () => (name === 'WHY' ? openWhy() : explore(MENU[name])),
  count: async () => (name === 'WHY' ? why().count() : (await menuItems()).includes(MENU[name]) ? 1 : 0),
  innerText: async () => page.locator('.ws-explore-btn').innerText(),
})
const panelTab = (name) => ({
  click: async () => {
    if (name === 'State') return openState()
    if (name === 'Why') return openWhy()
    // the mode's own panel (lesson, experiment…) is always on the page: close whatever covers it
    if (await page.locator('.ws-side .ov').count()) await page.locator('.ws-side .ov-close').click()
  },
})
const headline = async () => {
  await openState()
  return page.locator('.ov .state-headline').innerText()
}

await page.waitForSelector('.scope-canvas canvas')
await page.waitForTimeout(400)
check((await page.locator('.circuit .diode').count()) === 1, 'RL rectifier without Dfw: one diode')
check(!(await page.locator('.fw-panel').count()), 'no freewheel panel while Dfw is OFF')

// Toggle the freewheeling diode ON
await page.getByRole('button', { name: /Freewheeling diode: OFF/ }).click()
await page.waitForTimeout(500)
check((await page.locator('.circuit .diode').count()) === 2, 'Dfw ON: schematic shows D1 and Dfw')
check(/freewheeling diode/.test(await page.locator('.ws-head h1').innerText()), 'the workspace title names the freewheeling diode')
check(await page.locator('.legend').getByText('Ifw', { exact: true }).isVisible(), 'scope offers the Ifw channel')
await page.getByRole('button', { name: '+ Add waveform' }).click()
check(await page.locator('.channel-pop').getByRole('checkbox', { name: /^WL/ }).isVisible(), 'the E_L (WL) channel can be added')
await page.keyboard.press('Escape')
await page.locator('.ws-head h1').click()
check((await page.locator('.flag[role="alert"]').count()) === 0, 'simulation agrees with theory (no ⚠ flag)')
await action('Analyze').click()
await page.locator('.wv-analyze').getByRole('tab', { name: 'Device stress' }).click()
check(await page.locator('.wv-analyze').getByText('Dfw conduction per cycle').isVisible(), 'Analyze → Device stress has the Dfw rows')
await page.keyboard.press('Escape')

// Step through conduction (State details): step 5 = freewheel current flows
await openState()
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
await action('Current path').click()
const path = await page.locator('.wp-path').innerText()
check(/L[\s\S]*R[\s\S]*Dfw/.test(path), 'current path L → R → Dfw')
await action('Current path').click()
await action('WHY').click()
await page.getByRole('button', { name: 'Show detailed explanation' }).click()
const whySteps = await page.locator('#fw-why li').count()
check(whySteps === 7, `"Why is Dfw ON?" has 7 steps (${whySteps})`)
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
await page.waitForTimeout(300)
// phones: the parameters (and the Dfw choice in Basic) open as a sheet
await page.getByRole('button', { name: /Parameters/ }).click()
await page.getByRole('button', { name: /Freewheeling diode: OFF/ }).click()
await page.waitForTimeout(400)
check((await page.locator('.circuit .diode').count()) === 2, 'phone: the parameters sheet fits the freewheeling diode')
await page.keyboard.press('Escape')
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(overflow <= 0, `no horizontal page scroll at 390 px (overflow ${overflow}px)`)
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll freewheeling-diode smoke checks passed')
process.exit(failures.length ? 1 : 0)
