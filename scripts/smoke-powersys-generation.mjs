/**
 * Power Systems · Module 17 — Power Generation & Grid Monitoring in the browser: every mode, key computed numbers,
 * the 3D station (canvas, reset/fit, part list + info panel, guided tour, 3D↔2D, plant-type switch, timings), the 2D
 * process-flow fallback, the SCADA / state-estimation lab (bad data caught, unobservable message, remove and
 * re-estimate), activities, no console errors, no horizontal overflow at 1440 and 1280, leaving and re-entering,
 * and the WebGL fallback.
 * Run with the dev server on 5199: node scripts/smoke-powersys-generation.mjs
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
const MOD = '#/subjects/power-systems/generation'
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const hash = () => page.evaluate(() => location.hash)
const wait = (ms = 400) => page.waitForTimeout(ms)
const go = async (h) => {
  await page.goto(URL + h)
  await wait(900)
}
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ')
const acts = async () => (await text('.ps-acts summary')).replace(/\s+/g, ' ')
const results = async () => (await page.locator('section[aria-labelledby="gen-res"]').first().innerText()).replace(/\s+/g, ' ')
const panel = () => page.locator('.ps3-side')
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).click()
  await wait(700)
}
const openMore = async (summary) => {
  const d = page.locator('details', { has: page.locator('summary', { hasText: summary }) }).first()
  if (!(await d.evaluate((el) => el.open))) await d.locator('summary').first().click()
}
const slider = (label) => page.locator('.ps-slider', { hasText: label }).first().locator('input[type=range]')

// independent arithmetic for the defaults
const coal500 = (500e3 * 10000) / 17000 / 1000 // t/h
const coal600 = (600e3 * 10000) / 17000 / 1000
const qHydro = 200e6 / (1000 * 9.81 * 150 * 0.92 * 0.98)
const eKg = (1000 / 235.0439) * 6.02214076e23 * 200e6 * 1.602176634e-19
const u235day = ((1000 / 0.33) * 1e6 * 86400) / eKg
const rt = 0.98 * 0.9 * 0.91 * 0.98

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── page ─────────────────────────────────────────────────────────────────────
console.log('── Module page')
await go(MOD)
check((await text('main h1')) === 'Power Generation & Grid Monitoring', 'the module opens (status ready)')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'all five modes')
check(/0 of 6/.test(await acts()), 'six activities, none done')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
check(/Step 1 of 9/i.test(await text('.ps-stepper')), 'the explanation has nine steps')
check(/A coal plant, a dam and a nuclear reactor/.test(await text('.ps-step-body')), 'step 1 opens with the real-world question')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
check((await page.locator('.ps3 canvas').count()) === 1, 'step 1 shows the 3D station')
await panel().getByRole('button', { name: 'Boiler', exact: true }).click()
await wait()
check(/Burns the coal/.test(await panel().innerText()) && /1,389 MW/.test(await panel().innerText()), 'selecting the boiler explains it, with its computed heat input (1,389 MW)')
await page.locator('.gen-learn-visual').getByRole('radio', { name: 'Hydro' }).click()
await wait(800)
check((await page.locator('.ps3 canvas').count()) === 1 && /Penstock/.test(await panel().innerText()), 'the picture switches to a hydro station')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
check(/Rankine cycle/.test(await text('.ps-step-body')) && /✓/.test(await text('.gen-learn-visual')), 'step 2: the Rankine cycle, with the Carnot check')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
let lv = await text('.gen-learn-visual')
check(new RegExp(`${coal500.toFixed(1)} t/h`).test(lv) && /36\.00 %/.test(lv) && /✓/.test(lv), `step 3: heat rate → η 36.00 %, coal ${coal500.toFixed(1)} t/h, energy balance ✓`)
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
lv = await text('.gen-learn-visual')
check(new RegExp(`${qHydro.toFixed(2)} m³/s`).test(lv) && /✓/.test(lv), `step 4: hydro flow ${qHydro.toFixed(2)} m³/s, checked from first principles`)
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
lv = await text('.gen-learn-visual')
check(new RegExp(`${u235day.toFixed(3)} kg`).test(lv) && /illustration/i.test(lv), `step 5: nuclear — ${u235day.toFixed(3)} kg U-235 a day; the reactor drawing is labelled an illustration`)
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
check(new RegExp(`${(rt * 100).toFixed(1)} %`).test(await text('.ps-step-body')), `step 6: pumped storage round trip ${(rt * 100).toFixed(1)} %`)
check((await page.locator('.ps-step-body a[href="#/subjects/power-systems/economic"]').count()) === 1, '… linked to Module 11 for the load curve')
for (let k = 0; k < 3; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(300)
}
check(/State estimation/.test(await text('.ps-step-title')) && /✓/.test(await text('.gen-learn-visual')), 'the last step: WLS estimate, checked by direct minimisation')
check(/1 of 6/.test(await acts()), 'finishing the explanation completes an activity')
check(await noOverflow(), 'no horizontal overflow (Learn)')
await page.screenshot({ path: OUT + 'generation-learn.png', fullPage: true })
await page.getByRole('button', { name: /Explore the stations/ }).click()
await wait(900)
check((await hash()) === MOD + '?mode=explore', 'Learn leads on to Explore')

// ── Explore: 3D ──────────────────────────────────────────────────────────────
console.log('── Explore · 3D station')
const t0 = Date.now()
await go(MOD + '?mode=explore')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const firstDraw = Date.now() - t0
let ro = await results()
check(/36\.00/.test(ro) && /10,000/.test(ro) && new RegExp(coal500.toFixed(1)).test(ro), `default coal station: η 36.00 %, heat rate 10,000 kJ/kWh, coal ${coal500.toFixed(1)} t/h`)
await page.getByRole('button', { name: 'Reset view' }).click()
await page.getByRole('button', { name: 'Fit' }).click()
await wait(800)
await panel().getByRole('button', { name: 'Condenser' }).click()
await wait()
let info = (await panel().innerText()).replace(/\s+/g, ' ')
check(/Heat rejected 715 MW/.test(info) && /17\.1 m³\/s/.test(info), 'condenser info panel: 715 MW rejected, 17.1 m³/s cooling water')
await panel().getByRole('button', { name: 'Generator' }).click()
await wait()
// a parameter change, synchronised in the info panel and the results
await slider('Electrical output').fill('600')
await wait()
info = (await panel().innerText()).replace(/\s+/g, ' ')
ro = await results()
check(/Electrical output 600 MW/.test(info) && new RegExp(coal600.toFixed(1)).test(ro), `output 600 MW: the info panel and the results agree (coal ${coal600.toFixed(1)} t/h)`)
check(/You changed: Output → 600/.test(ro) && /rises 20\.0 %/.test(ro), 'the results say what changed, by how much (+20.0 %) and why')
await openMore('Station data')
await slider('Heat rate').fill('9000')
await wait()
ro = await results()
check(/40\.00/.test(ro) && /9,000/.test(ro), 'heat rate 9,000 kJ/kWh → η 40.00 %')
// guided tour
await page.getByRole('button', { name: 'Guided tour' }).click()
await wait()
check(/Tour · 1 of 5/i.test(await panel().innerText()), 'guided tour starts (coal station)')
for (let k = 0; k < 4; k++) {
  await panel().getByRole('button', { name: 'Next →' }).click()
  await wait(250)
}
check(/Electricity out/.test(await panel().innerText()), 'the tour reaches its last step')
await panel().getByRole('button', { name: 'Replay' }).click()
await wait(300)
check(/Tour · 1 of 5/i.test(await panel().innerText()), 'Replay restarts the tour')
await panel().getByRole('button', { name: 'Close tour' }).click()
// frame time while rotating
const canvas = page.locator('.ps3 canvas')
const box = await canvas.boundingBox()
await page.evaluate(() => {
  window.__dts = []
  let last = performance.now()
  const loop = (t) => {
    window.__dts.push(t - last)
    last = t
    if (window.__dts.length < 400) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
})
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
const tr = Date.now()
let i = 0
while (Date.now() - tr < 2000) {
  await page.mouse.move(box.x + box.width / 2 + Math.sin(i / 10) * 200, box.y + box.height / 2 + Math.cos(i / 13) * 40)
  i++
  await wait(16)
}
await page.mouse.up()
const dts = (await page.evaluate(() => window.__dts)).slice(2).sort((a, b) => a - b)
const mean = dts.reduce((s, x) => s + x, 0) / dts.length
const p95 = dts[Math.floor(dts.length * 0.95)]
console.log(`  · 3D first draw ≈ ${firstDraw} ms after navigation; while rotating: mean frame ${mean.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (${dts.length} frames)`)
check(mean < 50, `rotating stays smooth (mean frame ${mean.toFixed(1)} ms)`)
check(await noOverflow(), 'no horizontal overflow (Explore 3D)')
await page.getByRole('button', { name: 'Reset view' }).click()
await wait(800)
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'generation-explore-thermal-3d.png' })

// ── Explore: the other stations ──────────────────────────────────────────────
console.log('── Explore · plant types')
const station = page.locator('.ps-toolbar').nth(1)
await station.getByRole('radio', { name: 'Hydro' }).click()
await wait(900)
ro = await results()
check(new RegExp(qHydro.toFixed(1)).test(ro), `hydro: ${qHydro.toFixed(1)} m³/s for 200 MW at 150 m`)
await panel().getByRole('button', { name: 'Reservoir' }).click()
await wait()
check(/Energy stored ρgVH 40,875 MWh/.test((await panel().innerText()).replace(/\s+/g, ' ')), 'reservoir info: 40,875 MWh stored (ρgVH)')
await openMore('Station data')
await slider('Head H').fill('300')
await wait()
check(new RegExp((qHydro / 2).toFixed(1)).test(await results()), `doubling the head halves the flow needed (${(qHydro / 2).toFixed(1)} m³/s)`)
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'generation-explore-hydro-3d.png' })
await station.getByRole('radio', { name: 'Nuclear' }).click()
await wait(900)
check(new RegExp(u235day.toFixed(3)).test(await results()), `nuclear: ${u235day.toFixed(3)} kg of U-235 fissioned per day`)
await panel().getByRole('button', { name: 'Control rods' }).click()
await wait()
check(/absorbing/.test(await panel().innerText()), 'control rods explained')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'generation-explore-nuclear-3d.png' })
await station.getByRole('radio', { name: 'Pumped storage' }).click()
await wait(900)
ro = await results()
check(
  new RegExp((rt * 100).toFixed(1)).test(ro) && new RegExp(Math.round(1500 * rt).toLocaleString('en-GB')).test(ro),
  `pumped storage: round trip ${(rt * 100).toFixed(1)} %, ${Math.round(1500 * rt)} MWh returned`,
)
await page.getByRole('radio', { name: 'Pumping (off-peak)' }).click()
await wait(500)
await panel().getByRole('button', { name: 'Motor-generator' }).click()
await wait()
check(/As a motor/.test(await panel().innerText()), 'pumping mode: the machine is a motor in the info panel')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'generation-explore-pumped-3d.png' })
check(/2 of 6/.test(await acts()), 'running all four kinds of station completes an activity')
// 2D fallback view
await page.getByRole('radio', { name: '2D diagram' }).click()
await wait(400)
const pfd = await text('.ps3 .gen-pfd')
check((await page.locator('.ps3 .gen-pfd svg').count()) === 1 && /from the grid/.test(pfd) && /Pump-turbine/.test(pfd), '3D → 2D: the process-flow diagram (pumping)')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'generation-explore-2d.png' })
await station.getByRole('radio', { name: 'Thermal (coal)' }).click()
await wait(600)
await page.getByRole('radio', { name: '2D diagram' }).click()
await wait(400)
check(/Condenser/.test(await text('.ps3 .gen-pfd')) && /t\/h/.test(await text('.ps3 .gen-pfd')), '2D coal-station diagram with computed values')
await page.getByRole('radio', { name: '3D' }).click()
await wait(500)
check((await page.locator('.ps3 canvas').count()) === 1, '2D → 3D again')
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(400)
check(new RegExp(coal500.toFixed(1)).test(await results()), 'Reset restores the default coal station')
check(await noOverflow(), 'no horizontal overflow (Explore stations)')
await page.screenshot({ path: OUT + 'generation-explore.png', fullPage: true })

// ── Explore: SCADA and state estimation ──────────────────────────────────────
console.log('── Explore · SCADA and state estimation')
await page.getByRole('radio', { name: /Grid monitoring/ }).click()
await wait(600)
await page.locator('.gen-sc-block[aria-label="PMU (phasor measurement unit)"]').first().click()
await wait()
check(/GPS time/.test(await text('.gen-scada-info')), 'SCADA schematic: selecting the PMU explains it')
check(/No bad data/.test(await text('.ps-callout')), 'default measurements: no bad data')
await page.locator('.gen-select select').selectOption('P23')
await wait(500)
check(/Caught: Flow 2→3 flagged/.test(await text('.ps-callout')), 'a 30 MW error on flow 2→3 is caught by the largest normalised residual')
check((await page.locator('.gen-meter--flag').count()) === 1, '… and marked on the network diagram')
check(/3 of 6/.test(await acts()), 'catching the bad measurement completes an activity')
await page.screenshot({ path: OUT + 'generation-scada.png', fullPage: true })
await page.getByRole('button', { name: /Remove Flow 2→3 and estimate again/ }).click()
await wait(400)
check(/No bad data/.test(await text('.ps-callout')), 'removing it: the rest is consistent again')
// only the three flows: detected but not located
for (const name of ['Use Injection at bus 1', 'Use Injection at bus 2', 'Use Injection at bus 3']) await page.getByLabel(name).uncheck()
await page.getByLabel('Use Flow 2→3').check()
await wait(400)
check(/cannot be located/.test(await text('.ps-callout')), 'three flows only (m − n = 1): detected but cannot be located')
// unobservable
await page.getByLabel('Use Flow 1→2').uncheck()
await page.getByLabel('Use Flow 1→3').uncheck()
await wait(400)
check(/unobservable/.test(await text('.ps-callout')), 'one flow left: a clear "unobservable" message')
check((await page.locator('section[aria-labelledby="gen-se-res"]').count()) === 0, '… and no estimate is shown')
await page.screenshot({ path: OUT + 'generation-unobservable.png', fullPage: true })
await page.locator('.gen-se-ctl').getByRole('button', { name: 'Reset' }).click()
await wait(400)
check(/No bad data/.test(await text('.ps-callout')), 'Reset restores the default meters')
check(await noOverflow(), 'no horizontal overflow (SCADA)')

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await tab('Experiment')
for (const name of ['Improve the heat rate', 'Double the head', 'Inject a bad measurement']) {
  await page.getByRole('button', { name }).click()
  await wait(300)
  await page.locator('.ps-predict .ps-option').first().click()
  await wait(400)
}
check((await page.locator('.ps-table').count()) === 1 && (await page.locator('.gen-net svg').count()) === 1, 'the comparison table and the estimation network')
check(/4 of 6/.test(await acts()), 'three experiments complete an activity')
await page.getByRole('button', { name: 'Improve the heat rate' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: 'between 5 % and 15 %' }).click()
await wait(300)
check(
  /Your prediction was right/.test(await text('.ps-predict-result')) && /9\.52 %/.test(await text('.ps-predict-result')),
  'heat rate 10 500 → 9 500: coal falls 9.52 % (decided from the computation)',
)
check(await noOverflow(), 'no horizontal overflow (Experiment)')
await page.screenshot({ path: OUT + 'generation-experiment.png', fullPage: true })

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await tab('Verify')
check((await page.locator('.ps-check--ok').count()) === 8 && (await page.locator('.ps-check--bad').count()) === 0, 'eight checks, all confirmed (no ✗)')
const vt = await page.locator('.ps-panel').innerText()
check((vt.match(/Second route/g) ?? []).length === 5, 'five are second routes that start again from the inputs (coal, hydro, nuclear, pumped storage, WLS)')
check(/173\.3 MeV/.test(vt) && /86\.6 %/.test(vt) && /AME 2020/.test(vt), 'a genuine mass defect: U-235 + n → Ba-141 + Kr-92 + 3n gives 173.3 MeV, 86.6 % of 200 MeV')
check(/A consistency check, not an independent method/.test(vt), 'the energy bookkeeping is labelled as a consistency check')
await page.locator('.ps-num-answer input').fill('36')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/5 of 6/.test(await acts()), 'your-turn answer completes Verify')
check(await noOverflow(), 'no horizontal overflow (Verify)')
await page.screenshot({ path: OUT + 'generation-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await tab('Practise')
const nums = [
  (3600 / 9000) * 100,
  (600e3 * 9500) / 20000 / 1000,
  (1000 * 9.81 * 50 * 100 * 0.9) / 1e6,
  (1000 * 9.81 * 20e6 * 200 * 0.88) / 3.6e9,
  eKg / 1e12,
  1000 * 0.97 * 0.88 * 0.9 * 0.97,
  ((500 / 0.32) * 1e6 * 86400) / eKg,
  (1e4 * 1.02 + 2500 * 0.99) / 12500,
]
const choice = ['b', 'Pelton wheel', 'b', 'b', 'b', 'b', 'the same']
const qs = page.locator('.ps-quiz-list > li')
let c = 0
let n = 0
for (let k = 0; k < (await qs.count()); k++) {
  const q = qs.nth(k)
  if ((await q.locator('.ps-num-answer').count()) > 0) {
    await q.locator('input').fill(nums[n++].toFixed(4))
    await q.getByRole('button', { name: 'Check' }).click()
  } else {
    const want = choice[c++]
    const opts = q.locator('.ps-option')
    if (want.length === 1) await opts.nth(want.charCodeAt(0) - 97).click()
    else await opts.filter({ hasText: want }).click()
  }
  await wait(150)
}
check(/15 of 15 answered correctly/.test(await text('.ps-quiz')), 'all fifteen questions answered correctly with independently computed answers')
check(/6 of 6/.test(await acts()), 'every activity complete')
check(
  (await page.locator('.ps-q-level').allInnerTexts()).some((t) => /GATE/.test(t)),
  'questions run from concept to GATE-style',
)
check(await noOverflow(), 'no horizontal overflow (Practise)')
await page.screenshot({ path: OUT + 'generation-practise.png', fullPage: true })

// ── engineer level: every Verify check still holds for extreme inputs ─────────
console.log('── Extreme inputs')
await page.evaluate(() => localStorage.setItem('pel.prefs', JSON.stringify({ level: 'engineer' })))
await go(MOD + '?mode=explore')
await page.reload()
await wait(900)
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
await slider('η_b').fill('80')
await slider('η_cycle').fill('30')
await slider('η_g').fill('95')
await wait(300)
const hrMin = Number(await slider('Heat rate').getAttribute('min'))
check(hrMin >= 3600 / (0.8 * 0.95 * 0.5) - 1e-6, `heat-rate slider limited by the chain: minimum ${hrMin} kJ/kWh keeps η_cycle ≤ 50 %`)
await wait(300)
ro = await results()
check(/22\.80/.test(ro), 'engineer chain at its lower ends: η = 0.80 × 0.30 × 0.95 = 22.80 %')
await tab('Verify')
check((await page.locator('.ps-check--bad').count()) === 0 && (await page.locator('.ps-check--ok').count()) === 8, 'extreme chain: all eight checks still confirmed (no ✗)')
await page.screenshot({ path: OUT + 'generation-verify-extreme.png', fullPage: true })
await tab('Explore')
await page.getByRole('radio', { name: /Grid monitoring/ }).click()
await wait(600)
check(/How reliable is the test\? \(200 noise samples\)/.test(await page.locator('.ps-panel').innerText()), 'engineer level: the Monte-Carlo reliability of the bad-data test is shown')
for (const name of ['Use Flow 1→2', 'Use Flow 1→3', 'Use Injection at bus 1', 'Use Injection at bus 2', 'Use Injection at bus 3']) await page.getByLabel(name).uncheck()
await wait(400)
check(
  /Nothing can be tested: with these meters the network is unobservable/.test(await text('section[aria-labelledby="gen-mc"]')),
  'unobservable: the reliability panel says nothing can be tested (no "0 of 200")',
)
await page.locator('.gen-se-ctl').getByRole('button', { name: 'Reset' }).click()
await wait(300)
await page.screenshot({ path: OUT + 'generation-scada-engineer.png', fullPage: true })
await page.evaluate(() => localStorage.setItem('pel.prefs', JSON.stringify({ level: 'beginner' })))
await page.reload()
await wait(600)

// ── leave and re-enter ───────────────────────────────────────────────────────
console.log('── Leave and re-enter')
for (let k = 0; k < 2; k++) {
  await go('#/subjects/power-systems/grid')
  await go(MOD + '?mode=explore')
  await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
}
check(true, 'left and re-entered the module twice')

// ── 1280 wide ────────────────────────────────────────────────────────────────
console.log('── 1280 px')
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const p2 = await ctx.newPage()
p2.on('pageerror', (e) => errors.push(String(e)))
p2.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
for (const m of ['learn', 'explore', 'experiment', 'verify', 'practise']) {
  await p2.goto(URL + MOD + '?mode=' + m)
  await p2.waitForTimeout(1000)
  check(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `1280 px: no horizontal overflow (${m})`)
  if (m === 'explore') {
    await p2.screenshot({ path: OUT + 'generation-explore-1280.png', fullPage: true })
    await p2.getByRole('radio', { name: /Grid monitoring/ }).click()
    await p2.waitForTimeout(500)
    check(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '1280 px: no horizontal overflow (SCADA lab)')
    await p2.screenshot({ path: OUT + 'generation-scada-1280.png', fullPage: true })
  }
}
await ctx.close()

// ── WebGL fallback ───────────────────────────────────────────────────────────
console.log('── Without WebGL')
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx3.addInitScript(() => {
  HTMLCanvasElement.prototype.getContext = () => null
})
const p3 = await ctx3.newPage()
p3.on('pageerror', (e) => errors.push(String(e)))
p3.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await p3.goto(URL + MOD + '?mode=explore')
await p3.waitForTimeout(1200)
check(/3D is not available/.test(await p3.locator('.ps3').first().innerText()), 'no WebGL: the message appears')
check((await p3.locator('.ps3 .gen-pfd svg').count()) === 1 && (await p3.locator('.ps3 canvas').count()) === 0, 'no WebGL: the 2D process-flow diagram is shown instead')
check(new RegExp(coal500.toFixed(1)).test((await p3.locator('section[aria-labelledby="gen-res"]').innerText()).replace(/\s+/g, ' ')), 'no WebGL: results still computed')
await p3.screenshot({ path: OUT + 'generation-nowebgl.png', fullPage: true })
await ctx3.close()

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed')
process.exit(failures.length ? 1 : 0)
