/**
 * Three-phase end-to-end smoke test (Playwright + Edge). Run with the dev server on 5199:
 *   npm run dev -- --port 5199   then   node scripts/smoke3.mjs
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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(process.env.LAB_URL ?? 'http://localhost:5199/')
await page.evaluate(() => localStorage.clear())
await page.reload()

const mode = (name) => page.locator('.modes').getByRole('tab', { name, exact: true })
const panelTab = (name) => page.locator('.panel-tabs').getByRole('tab', { name, exact: true })
const view = (name) => page.locator('.view-seg').getByRole('tab', { name, exact: true })
const openAdvanced = async () => {
  if (!(await page.locator('details.advanced').getAttribute('open') !== null)) await page.locator('details.advanced > summary').click()
}

// Section switch + run
await page.getByRole('tab', { name: 'Three-phase' }).click()
check(await page.getByRole('radio', { name: '6-pulse bridge', exact: true }).isVisible(), 'three-phase section offers the 6-pulse bridge')
await page.getByRole('button', { name: /Run simulation/ }).click()
await page.waitForTimeout(600)
const headline = async () => {
  await panelTab('State').click()
  return page.locator('.state-headline').innerText()
}
check(/D\d & D\d/.test(await headline()), `state panel names the conducting pair — "${await headline()}"`)
check((await page.locator('.circuit .diode').count()) === 6, 'schematic shows six bridge diodes')
const legend = await page.locator('.legend').innerText()
check(/VaN/.test(legend) && /VbN/.test(legend) && /VcN/.test(legend) && /Vo/.test(legend) && /Io/.test(legend), 'default (Basic) channels: VaN, VbN, VcN, Vo, Io')
check((await page.locator('.legend .chip').count()) === 5, 'only the five essential channels are shown by default')

// Angle view (one primary view at a time) drives the master cursor
await view('Angle view').click()
const av = await page.locator('.angle-svg').boundingBox()
const xAtDeg = (d) => av.x + (av.width * (44 + (d / 360) * (720 - 56))) / 720
await page.mouse.click(xAtDeg(60), av.y + 40)
await page.waitForTimeout(150)
const p60 = await page.locator('.strip-state').innerText()
await page.mouse.click(xAtDeg(120), av.y + 40)
await page.waitForTimeout(150)
const p120 = await page.locator('.strip-state').innerText()
check(/D1 \+ D6/.test(p60) && /D1 \+ D2/.test(p120), 'angle view moves the master cursor: D1+D6 at 60°, D1+D2 at 120°')
check(/θ = 1[12]\d\.\d°/.test(p120), `state strip follows the angle cursor`)
await page.screenshot({ path: OUT + '3ph-10-explore.png' })

// Current path: drawer + highlighted path on the circuit
await page.getByRole('button', { name: /Current path/ }).click()
const path = await page.locator('.path-vertical').innerText()
check(/Phase A[\s\S]*D1[\s\S]*Load[\s\S]*D2[\s\S]*Phase C/.test(path), 'current path drawer: Phase A → D1 → Load → D2 → Phase C')
check(/highest eligible phase/.test(await page.locator('.path-reasons').innerText()), 'drawer says why this path (highest / lowest phase)')
check((await page.locator('.circuit-wrap.show-path').count()) === 1, 'the path is highlighted on the circuit')
await page.keyboard.press('Escape')
check((await page.locator('.circuit-wrap.show-path').count()) === 0, 'closing the drawer returns to the clean circuit')

// WHY + Physics Lens
await page.getByRole('button', { name: 'WHY?' }).click()
const short = await page.locator('.why-steps').innerText()
check(/Highest: A/.test(short) && /lowest: C/.test(short) && /Vac/.test(short), 'WHY (short): highest A, lowest C, Vo = Vac')
await page.getByRole('button', { name: 'Show detailed explanation' }).click()
check(/Highest: phase A/.test(await page.locator('#why-chain').innerText()), 'detailed WHY chain on request')
await page.getByRole('button', { name: /Physics Lens/ }).click()
for (let k = 0; k < 4; k++) await page.getByRole('button', { name: 'Next stage →' }).click()
check(/Output voltage/i.test(await page.locator('.lens-panel h2').innerText()), 'Physics Lens steps to the output stage')
check((await page.locator('svg.circuit.lens--output').count()) === 1, 'schematic highlights the stage being explained')
await page.screenshot({ path: OUT + '3ph-11-lens.png' })
await page.getByRole('button', { name: 'Close Physics Lens' }).click()

// Inspect: click a device on the circuit
await page.getByRole('button', { name: /Inspect/ }).click()
await page.locator('[data-part="D1"]').first().click()
const insp = await page.locator('.drawer').innerText()
check(/D1 — diode/.test(insp) && /Conduction per cycle/.test(insp) && /ON/.test(insp), 'inspect D1: state, current and conduction per cycle')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /Inspect/ }).click()

// Layout modes still work in three-phase
await view('Waveforms').click()
await page.getByRole('radio', { name: 'Overlay', exact: true }).click()
await page.waitForTimeout(150)
await page.locator('.instrument').screenshot({ path: OUT + '3ph-12-overlay.png' })
await page.getByRole('radio', { name: 'Grouped', exact: true }).click()
// Channel presets and "+ Add channel"
await page.getByRole('radio', { name: 'Diode analysis' }).click()
check(/Id1/.test(await page.locator('.legend').innerText()) && /Id6/.test(await page.locator('.legend').innerText()), 'Diode analysis preset shows every device current')
await page.getByRole('button', { name: '+ Add channel' }).click()
await page.locator('.channel-pop').getByRole('checkbox', { name: /^Vab/ }).check()
check(/Vab/.test(await page.locator('.legend').innerText()) && (await page.getByRole('radio', { name: 'Custom' }).count()) === 1, '+ Add channel adds a line voltage (preset becomes Custom)')
await page.keyboard.press('Escape')
await page.getByRole('radio', { name: 'Basic', exact: true }).click()

// SCR control (Advanced parameters)
await openAdvanced()
await page.getByRole('radio', { name: /SCRs/ }).click()
await page.waitForTimeout(400)
const alpha = page.getByLabel(/^Firing angle/).last()
await alpha.fill('60')
await alpha.press('Enter')
await page.waitForTimeout(400)
await page.getByRole('button', { name: /^Measurements/ }).click()
await page.locator('.drawer').getByRole('tab', { name: 'Output', exact: true }).click()
const vdc = await page.locator('.drawer tr', { hasText: 'Average output' }).locator('td').first().innerText()
await page.keyboard.press('Escape')
// Real diodes: 1.35·VLL·cos 60° − 2Vf = 14.03 − 1.4 ≈ 12.6 V
check(/^12\.[5-8]\d* V/.test(vdc.trim()), `SCR bridge at α = 60°: Vdc ≈ 1.35·VLL·cos60° − 2Vf ≈ 12.6 V (${vdc.trim()})`)
check((await page.locator('.circuit .gate').count()) === 6, 'schematic shows six SCR gates')
check((await page.locator('.flag[role="alert"]').count()) === 0, 'controlled bridge agrees with theory (no ⚠ flag)')
await page.screenshot({ path: OUT + '3ph-13-scr.png' })
await page.getByRole('radio', { name: /Diodes/ }).click()
await page.waitForTimeout(300)

// Experiment: before/after + fault
await mode('Experiment').click()
await page.getByRole('button', { name: 'Capture BEFORE' }).click()
const r = page.getByLabel(/^Resistance/).last()
await r.fill('20')
await r.press('Enter')
await page.waitForTimeout(400)
const exp = await page.locator('.mode-panel').innerText()
check(/Load R/.test(exp) && /stayed the same/.test(exp) && /fell 50\.0 %/.test(exp), 'experiment: R doubled → Vdc same, Idc −50 %, with WHY')
await page.getByLabel('Fault type').selectOption('open')
await page.getByLabel('Device', { exact: true }).selectOption('D1')
await page.getByRole('button', { name: 'Inject fault' }).click()
await page.waitForTimeout(500)
check((await page.locator('.circuit .fault-tag').count()) >= 1, 'faulty device is marked on the schematic')
const exp2 = await page.locator('.mode-panel').innerText()
check(/open device can never conduct/.test(exp2), 'fault explanation appears in the comparison')
await page.screenshot({ path: OUT + '3ph-14-fault.png' })
await page.getByRole('button', { name: 'Clear fault' }).click()

// Predict: what-if
await mode('Predict').click()
await page.getByRole('button', { name: 'It decreases' }).click()
await page.getByRole('button', { name: 'Run the simulation' }).click()
await page.waitForTimeout(400)
const wi = await page.locator('.mode-panel').innerText()
check(/Actual result/i.test(wi) && /Your prediction was right/.test(wi), 'what-if: simulation evaluates the prediction (R doubled → Idc decreases)')
await page.screenshot({ path: OUT + '3ph-15-whatif.png' })

// Reverse engineering
await mode('Reverse').click()
await page.waitForTimeout(600)
check((await page.locator('.bench.instrument--hidden').count()) === 1, 'reverse mode hides the circuit')
const aria = await page.locator('.scope-layer--overlay').getAttribute('aria-label')
check(!/Io/.test(aria) && /Vo/.test(aria), 'reverse mode shows only source and output channels')
check((await page.locator('.panel-tabs [role="tab"]').count()) === 1, 'reverse mode hides the State / Why / Energy tabs (they would give the answer away)')
await page.screenshot({ path: OUT + '3ph-16-reverse.png' })

// Learn: three-phase lesson
await mode('Learn').click()
await page.getByRole('button', { name: /The six-pulse bridge/ }).click()
await page.waitForTimeout(500)
const lesson = await page.locator('.mode-panel').first().innerText()
check(/D1 \+ D6 conduct/.test(lesson) && !/\{\w+\}/.test(lesson), 'three-phase lesson narrates D1 + D6 from the simulation')
await page.getByRole('button', { name: 'All lessons' }).click()

// Challenge: three-phase
await mode('Challenge').click()
await page.getByRole('button', { name: /24 V from a six-pulse bridge/ }).click()
await page.waitForTimeout(400)
const vIn = page.getByLabel(/^Phase voltage/).last()
await vIn.fill('10.87')
await vIn.press('Enter')
await page.waitForTimeout(500)
check(/★★★/.test(await page.locator('.stars').innerText()), 'three-phase challenge: Vph = 10.87 V earns three stars')
await page.screenshot({ path: OUT + '3ph-17-challenge.png' })
await page.getByRole('button', { name: 'All challenges' }).click()
await mode('Explore').click()

// Focus mode
await page.getByRole('button', { name: /◎ Focus/ }).click()
check((await page.locator('.col-params').count()) === 0 && (await page.locator('.col-state').count()) === 0, 'focus mode hides parameters and side panels')
check((await page.locator('.focus-bar').count()) === 1 && (await page.locator('svg.circuit').count()) === 1, 'focus mode keeps the circuit, the waveform and the state')
await page.locator('.focus-bar').getByRole('button', { name: 'WHY?' }).click()
check((await page.locator('.drawer .why-steps').count()) === 1, 'WHY opens as a drawer in focus mode')
await page.screenshot({ path: OUT + '3ph-18-focus.png' })
await page.keyboard.press('Escape')
await page.locator('.focus-bar').getByRole('button', { name: 'Exit focus' }).click()

// Density levels
await page.getByRole('radio', { name: 'Beginner', exact: true }).click()
check((await page.getByRole('button', { name: /^Measurements/ }).count()) === 0 && (await view('Angle view').count()) === 0, 'Beginner: no measurements button, no angle view')
await page.getByRole('radio', { name: 'Engineer', exact: true }).click()
check((await page.getByRole('button', { name: /Theory/ }).count()) === 1 && (await page.locator('.readings').count()) === 1, 'Engineer: theory & equations and every reading available')
await page.getByRole('button', { name: /Theory/ }).click()
check((await page.locator('.theory-card').count()) > 10, 'theory & equations: one card per formula')
await page.keyboard.press('Escape')
await page.getByRole('radio', { name: 'Standard', exact: true }).click()

// Back to single-phase: the original simulator is untouched
await page.getByRole('tab', { name: 'Single-phase' }).click()
await page.waitForTimeout(400)
check((await page.locator('.circuit .diode').count()) === 4, 'switching back to single-phase restores the single-phase bridge')

const body = await page.locator('body').innerText()
check(!/NaN|Infinity|undefined/.test(body), 'no NaN / Infinity / undefined on the page')
await page.setViewportSize({ width: 390, height: 844 })
await page.getByRole('tab', { name: 'Three-phase' }).click()
await page.waitForTimeout(400)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(overflow <= 0, `no horizontal page scroll at 390 px in three-phase (overflow ${overflow}px)`)
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll three-phase smoke checks passed')
process.exit(failures.length ? 1 : 0)
