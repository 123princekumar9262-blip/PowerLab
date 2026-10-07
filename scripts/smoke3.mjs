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

// Section switch + run
await page.getByRole('tab', { name: 'Three-phase' }).click()
check(await page.getByRole('radio', { name: '6-pulse bridge', exact: true }).isVisible(), 'three-phase section offers the 6-pulse bridge')
await page.getByRole('button', { name: /Run simulation/ }).click()
await page.waitForTimeout(600)
const headline = () => page.locator('.state-headline').innerText()
check(/D1 & D6|D\d & D\d/.test(await headline()), `state panel names the conducting pair — "${await headline()}"`)
check((await page.locator('.circuit .diode').count()) === 6, 'schematic shows six bridge diodes')
const readings = await page.locator('.readings').innerText()
check(/VaN/.test(readings) && /VbN/.test(readings) && /VcN/.test(readings) && /Vo/.test(readings), 'readings show VaN, VbN, VcN, Vo, Io')

// Angle view drag → master cursor; pair changes across a commutation boundary
const av = await page.locator('.angle-svg').boundingBox()
const xAtDeg = (d) => av.x + (av.width * (44 + (d / 360) * (720 - 56))) / 720
await page.mouse.click(xAtDeg(60), av.y + 40)
await page.waitForTimeout(150)
const p60 = await page.locator('.facts').innerText()
await page.mouse.click(xAtDeg(120), av.y + 40)
await page.waitForTimeout(150)
const p120 = await page.locator('.facts').innerText()
check(/D1 & D6/.test(p60) && /D1 & D2/.test(p120), 'angle view moves the master cursor: D1&D6 at 60°, D1&D2 at 120°')
const theta = await page.locator('.state-time').innerText()
check(/θ = 1[12]\d\.\d°/.test(theta), `state panel follows the angle cursor (${theta.replace(/\n/g, ' ')})`)
await page.screenshot({ path: OUT + '3ph-10-explore.png' })

// WHY + Physics Lens
await page.getByRole('button', { name: /WHY\?/ }).click()
const chain = await page.locator('#why-chain').innerText()
check(/Highest: phase A/.test(chain) && /Lowest: phase C/.test(chain) && /Vac/.test(chain), 'WHY chain: highest A, lowest C, Vo = Vac')
await page.getByRole('button', { name: /Physics Lens/ }).click()
for (let k = 0; k < 4; k++) await page.getByRole('button', { name: 'Next stage →' }).click()
check(/Output voltage/i.test(await page.locator('.lens-panel h2').innerText()), 'Physics Lens steps to the output stage')
check((await page.locator('svg.circuit.lens--output').count()) === 1, 'schematic highlights the stage being explained')
await page.screenshot({ path: OUT + '3ph-11-lens.png' })
await page.getByRole('button', { name: 'Close Physics Lens' }).click()

// Layout modes still work in three-phase
await page.getByRole('radio', { name: 'Overlay', exact: true }).click()
await page.waitForTimeout(150)
await page.locator('.instrument').screenshot({ path: OUT + '3ph-12-overlay.png' })
await page.getByRole('radio', { name: 'Grouped', exact: true }).click()

// SCR control
await page.getByRole('radio', { name: /SCRs/ }).click()
await page.waitForTimeout(400)
const alpha = page.getByLabel(/^Firing angle/).last()
await alpha.fill('60')
await alpha.press('Enter')
await page.waitForTimeout(400)
const vdc = await page.locator('tr', { hasText: 'Average output' }).locator('td').first().innerText()
// Real diodes: 1.35·VLL·cos 60° − 2Vf = 14.03 − 1.4 ≈ 12.6 V
check(/^12\.[5-8]\d* V/.test(vdc.trim()), `SCR bridge at α = 60°: Vdc ≈ 1.35·VLL·cos60° − 2Vf ≈ 12.6 V (${vdc.trim()})`)
check((await page.locator('.circuit .gate').count()) === 6, 'schematic shows six SCR gates')
check((await page.locator('.flag[role="alert"]').count()) === 0, 'controlled bridge agrees with theory (no ⚠ flag)')
await page.screenshot({ path: OUT + '3ph-13-scr.png' })
await page.getByRole('radio', { name: /Diodes/ }).click()
await page.waitForTimeout(300)

// Experiment: before/after + fault
await page.getByRole('tab', { name: 'Experiment' }).click()
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
await page.getByRole('tab', { name: 'Predict' }).click()
await page.getByRole('button', { name: 'It decreases' }).click()
await page.getByRole('button', { name: 'Run the simulation' }).click()
await page.waitForTimeout(400)
const wi = await page.locator('.mode-panel').innerText()
check(/Actual result/i.test(wi) && /Your prediction was right/.test(wi), 'what-if: simulation evaluates the prediction (R doubled → Idc decreases)')
await page.screenshot({ path: OUT + '3ph-15-whatif.png' })

// Reverse engineering
await page.getByRole('tab', { name: 'Reverse' }).click()
await page.waitForTimeout(600)
check((await page.locator('.bench.instrument--hidden').count()) === 1, 'reverse mode hides the circuit')
const legend = await page.locator('.legend').innerText()
check(!/Io/.test(legend), 'reverse mode shows only source and output channels')
await page.screenshot({ path: OUT + '3ph-16-reverse.png' })

// Learn: three-phase lesson
await page.getByRole('tab', { name: 'Learn' }).click()
await page.getByRole('button', { name: /The six-pulse bridge/ }).click()
await page.waitForTimeout(500)
const lesson = await page.locator('.mode-panel').first().innerText()
check(/D1 \+ D6 conduct/.test(lesson) && !/\{\w+\}/.test(lesson), 'three-phase lesson narrates D1 + D6 from the simulation')
await page.getByRole('button', { name: 'All lessons' }).click()

// Challenge: three-phase
await page.getByRole('tab', { name: 'Challenge' }).click()
await page.getByRole('button', { name: /24 V from a six-pulse bridge/ }).click()
await page.waitForTimeout(400)
const vIn = page.getByLabel(/^Phase voltage/).last()
await vIn.fill('10.87')
await vIn.press('Enter')
await page.waitForTimeout(500)
check(/★★★/.test(await page.locator('.stars').innerText()), 'three-phase challenge: Vph = 10.87 V earns three stars')
await page.screenshot({ path: OUT + '3ph-17-challenge.png' })
await page.getByRole('button', { name: 'All challenges' }).click()
await page.getByRole('tab', { name: 'Explore' }).click()

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
