/**
 * Power Systems · Module 14 — HVDC & FACTS in the browser: every mode, key computed numbers, the 3D link + weak bus
 * (canvas, reset/fit, part list + info panel, guided tour, 3D↔2D, timings), parameter changes synchronised in the
 * 3D info panel and the 2D schematic, reset, infeasible states (mode shift, VSC capability, voltage collapse),
 * activities, no console errors, no horizontal overflow at 1440 and 1280, leaving and re-entering, the WebGL fallback.
 * Run with the dev server on 5199: node scripts/smoke-powersys-hvdc-facts.mjs
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
const MOD = '#/subjects/power-systems/hvdc-facts'
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const wait = (ms = 400) => page.waitForTimeout(ms)
const go = async (h) => {
  await page.goto(URL + h)
  await wait(900)
}
const hash = () => page.evaluate(() => location.hash)
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ')
const acts = () => text('.ps-acts summary')
const panel = () => page.locator('.ps3-side')
const panelText = async () => (await panel().innerText()).replace(/\s+/g, ' ')
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).click()
  await wait(700)
}
const view = async (name) => {
  await page.getByRole('radio', { name, exact: true }).click()
  await wait(700)
}
const slider = (label) => page.getByRole('slider', { name: label, exact: true })

await page.goto(URL)
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('pel.prefs', JSON.stringify({ level: 'standard' }))
})

// ── page ─────────────────────────────────────────────────────────────────────
console.log('── Module page')
await go(MOD)
await page.reload()
await wait(1200)
check((await text('main h1')) === 'HVDC & FACTS', 'the module opens (status ready)')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'all five modes')
check(/0 of 6/.test(await acts()), 'six activities, none done')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
check(/Step 1 of 9/i.test(await text('.ps-stepper')), 'the explanation has nine steps')
check(/Why would anyone convert AC to DC/.test(await text('.ps-step-body')), 'step 1 opens with the real-world question')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
check((await page.locator('.ps3 canvas').count()) === 1, 'step 1 shows the 3D link')
check(/BEEE406L/.test(await text('.ps-step-body')) && /supplementary/.test(await text('.ps-step-body')), 'syllabus note: VIT elective named as supplementary')
await panel().getByRole('button', { name: 'DC line' }).click()
await wait()
check(/1\.965 kA/.test(await panelText()) && /38\.6 MW/.test(await panelText()), 'selecting the DC line shows I_d 1.965 kA and the 38.6 MW loss')
const next = async () => {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(350)
}
await next()
check(
  /Mvar/.test(await text('.hf-learn-visual')) && /break-even/.test(await text('.hf-learn-visual')) && /illustrative/i.test(await text('.hf-learn-visual')),
  'AC vs DC: charging Mvar computed, break-even from a labelled illustrative cost model',
)
await page.screenshot({ path: OUT + 'hf-learn-acdc.png', fullPage: true })
await next()
check(/277\.85 kV/.test(await text('.hf-learn-visual')) && /✓/.test(await text('.hf-learn-visual')), 'LCC bridge: V_d = 277.85 kV at α = 15°, checked against the waveform')
await next()
check(/21\.237°/.test(await text('.hf-learn-visual')) && /✓/.test(await text('.hf-learn-visual')), 'overlap: μ = 21.237°, checked by numerical integration')
await page.screenshot({ path: OUT + 'hf-learn-overlap.png', fullPage: true })
await next()
check(/266\.5 Mvar/.test(await text('.hf-learn-visual')) && /✓/.test(await text('.hf-learn-visual')), 'reactive power: Q = 266.5 Mvar, checked by Fourier analysis')
await next()
check(/15\.66°/.test(await text('.hf-learn-visual')) && /✓/.test(await text('.hf-learn-visual')), 'DC link: α = 15.66° for 1000 MW, power balance checked')
await next()
check(/✓/.test(await text('.hf-learn-visual')), 'VSC: P and Q checked back through the phase-reactor equations')
await next()
check(/4\.000 pu at 180°/.test(await text('.hf-learn-visual')) && /✓/.test(await text('.hf-learn-visual')), 'compensation: midpoint P_max 4.000 pu at 180°, numerically confirmed')
await next()
check(/SVC and STATCOM/.test(await text('.ps-step-title')), 'last step: SVC and STATCOM')
check(/1\.086 pu/.test(await text('.ps-step-body')) && /1\.392 pu/.test(await text('.ps-step-body')), 'weak bus: collapse at 1.086 pu (none) and 1.392 pu (STATCOM)')
check(/1 of 6/.test(await acts()), 'finishing the explanation completes an activity')
check(await noOverflow(), 'no horizontal overflow (Learn)')
await page.screenshot({ path: OUT + 'hf-learn.png', fullPage: true })
await page.getByRole('button', { name: /Explore the link/ }).click()
await wait(900)
check((await hash()) === MOD + '?mode=explore', 'Learn leads on to Explore')

// ── Explore: LCC + 3D ────────────────────────────────────────────────────────
console.log('── Explore · LCC link and 3D')
const t0 = Date.now()
await go(MOD + '?mode=explore')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const firstDraw = Date.now() - t0
let res = await text('#hf-lcc-results')
check(/1\.965/.test(res) && /1000/.test(res) && /15\.66/.test(res), 'default link: I_d 1.965 kA, 1000 MW, α 15.66°')
check(/508\.9/.test(res) && /489\.3/.test(res) && /527/.test(res) && /543/.test(res), 'V_dr 508.9 kV, V_di 489.3 kV, Q 527 / 543 Mvar')
await page.getByRole('button', { name: 'Reset view' }).click()
await page.getByRole('button', { name: 'Fit' }).click()
await wait(800)
await panel().getByRole('button', { name: 'Rectifier valve hall (thyristors)' }).click()
await wait()
check(/15\.66°/.test(await panelText()) && /527 Mvar/.test(await panelText()), 'rectifier info panel: α 15.66°, Q 527 Mvar')
await slider('Power order').fill('800')
await wait(500)
res = await text('#hf-lcc-results')
check(
  /1\.556/.test(res) && /17\.10/.test(res) && /17\.10°/.test(await panelText()) && /401 Mvar/.test(await panelText()),
  '800 MW: I_d 1.556 kA, α 17.10°, Q 401 Mvar — results and 3D info panel agree',
)
check(/You changed: power order 1000 → 800 MW/.test(res) && /Why:/.test(res), 'the results say what changed and why')
await slider('Rectifier AC voltage').fill('90')
await wait(500)
check(
  /Mode shift/.test(await text('.ps-panel')) && /1\.356/.test(await text('#hf-lcc-results')),
  'AC voltage 90 % (800 MW order): mode shift — the inverter takes the current at I_order − ΔI = 1.356 kA',
)
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(500)
check(/1\.965/.test(await text('#hf-lcc-results')), 'Reset restores the default link')
await page.getByRole('radio', { name: 'Firing angle by hand' }).click()
await wait(400)
check(/1\.871/.test(await text('#hf-lcc-results')), 'α set by hand to 16°: I_d 1.871 kA follows')
await page.getByRole('button', { name: 'Guided tour' }).click()
await wait(300)
for (let k = 0; k < 2; k++) {
  await panel().getByRole('button', { name: 'Next →' }).click()
  await wait(250)
}
check(/holds its extinction angle/.test(await panelText()) && !/controls the current/.test(await panelText()), 'α by hand: the tour says the inverter holds γ (it does not claim current control)')
await panel().getByRole('button', { name: 'Close tour' }).click()
await slider('Rectifier firing angle α').fill('30')
await wait(400)
check(/No operating point/.test(await text('.ps-panel')) && (await page.locator('#hf-lcc-results').count()) === 0, 'α = 30°: no current can flow — a clear message and no results')
check(/No operating point/.test(await text('.ps3-overlay')), 'the 3D scene shows no values in that state')
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(400)
// tour
await page.getByRole('button', { name: 'Guided tour' }).click()
await wait()
check(/Tour · 1 of 5/i.test(await panelText()) && /rectifier station/i.test(await panelText()), 'guided tour starts at the rectifier station')
for (let k = 0; k < 4; k++) {
  await panel().getByRole('button', { name: 'Next →' }).click()
  await wait(250)
}
check(/STATCOM/.test(await panelText()) && /0\.372 pu/.test(await panelText()), 'the tour ends at the STATCOM (Q 0.372 pu)')
await panel().getByRole('button', { name: 'Replay' }).click()
await wait(300)
check(/Tour · 1 of 5/i.test(await panelText()), 'Replay restarts the tour')
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
await page.getByRole('button', { name: 'Reset view' }).click()
await wait(800)
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'hf-explore-3d.png' })
// 3D → 2D
await page.getByRole('radio', { name: '2D diagram' }).click()
await wait(400)
const sch = await text('.ps3 .hf-schematic')
check(/P 1000 MW · I_d 1\.965 kA/.test(sch) && /V = 1\.000 pu/.test(sch), '3D → 2D: the schematic shows the same 1000 MW, 1.965 kA and V = 1.000 pu')
await page.locator('.hf-el[aria-label="DC line"]').focus()
await page.keyboard.press('Enter')
await wait(300)
check(/1\.965 kA/.test(await panelText()), 'keyboard selection in the 2D schematic opens the same info')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'hf-explore-2d.png' })
await page.getByRole('radio', { name: '3D' }).click()
await wait(500)
check((await page.locator('.ps3 canvas').count()) === 1, '2D → 3D again')
check(await noOverflow(), 'no horizontal overflow (Explore LCC)')
await page.screenshot({ path: OUT + 'hf-explore-lcc.png', fullPage: true })

// ── Explore: VSC ─────────────────────────────────────────────────────────────
console.log('── Explore · VSC link')
await view('VSC link')
res = await text('#hf-vsc-results')
check(/788/.test(res) && /1\.037/.test(res) && /−6\.65°/.test(res), 'VSC: 788 MW received, V_c1 1.037 pu ∠ −6.65°')
await slider('Q at station 1').fill('-0.3')
await wait(400)
check(/788/.test(await text('#hf-vsc-results')) && /the active power did not change/.test(await text('#hf-vsc-results')), 'changing Q₁ leaves P unchanged (independent P and Q)')
await slider('Power order P').fill('0.95')
await slider('Q at station 1').fill('0.6')
await wait(400)
check(/Outside the capability/.test(await text('.ps-panel')) && (await page.locator('#hf-vsc-results').count()) === 0, 'an order outside the capability circle: a message and no results')
await page.screenshot({ path: OUT + 'hf-explore-vsc.png', fullPage: true })
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(400)

// ── Explore: compensation ────────────────────────────────────────────────────
console.log('── Explore · Compensation')
await view('Compensation')
res = await text('.ps-panel')
check(/2\.000/.test(res) && /3\.333/.test(res) && /4\.000/.test(res), 'P_max: 2.000 (none), 3.333 (k = 40 %), 4.000 pu (midpoint shunt)')
await slider('Series compensation k').fill('50')
await wait(400)
check(/4\.000/.test(await text('.ps-panel')) && /×2\.00/.test(await text('.ps-panel')), 'k = 50 %: series P_max 4.000 pu, ×2.00')
check(await noOverflow(), 'no horizontal overflow (Compensation)')
await page.screenshot({ path: OUT + 'hf-explore-comp.png', fullPage: true })

// ── Explore: weak bus ────────────────────────────────────────────────────────
console.log('── Explore · Weak bus')
await view('Weak bus')
res = await text('#hf-weak-results')
check(/1\.000/.test(res) && /0\.372/.test(res) && /1\.392/.test(res), 'STATCOM at 0.8 pu: V 1.000 pu, Q_c 0.372 pu, collapse at 1.392 pu')
check(/2 of 6/.test(await acts()) && /all four views explored/.test(await text('.ps-toolbar')), 'all four views explored')
await page.getByRole('radio', { name: 'No support' }).click()
await wait(400)
check(/0\.845/.test(await text('#hf-weak-results')), 'no support at 0.8 pu: V 0.845 pu')
await panel().getByRole('button', { name: 'Weak AC bus' }).click()
await wait(300)
check(/0\.845 pu/.test(await panelText()), 'the 3D info panel shows the same 0.845 pu')
await slider('Load P').fill('1.2')
await wait(400)
check(/voltage collapses/.test(await text('.ps-panel')) && (await page.locator('#hf-weak-results').count()) === 0, 'no support at 1.2 pu: beyond collapse — a message, no numbers')
await page.screenshot({ path: OUT + 'hf-explore-collapse.png', fullPage: true })
await page.getByRole('radio', { name: 'STATCOM' }).click()
await wait(400)
check(/0\.927/.test(await text('#hf-weak-results')) && /at its capacitive limit/.test(await text('#hf-weak-results')), 'STATCOM holds 1.2 pu: V 0.927 pu at its limit')
await page.getByRole('radio', { name: 'SVC' }).click()
await wait(400)
check(/0\.899/.test(await text('#hf-weak-results')), 'SVC at 1.2 pu: V 0.899 pu (below the STATCOM’s)')
check(/3 of 6/.test(await acts()), 'collapse, then held up: an activity completes')
check(await noOverflow(), 'no horizontal overflow (Weak bus)')
await page.screenshot({ path: OUT + 'hf-explore-weak.png', fullPage: true })
// a weak system at a high regulated load: the compensator must hold exactly 1.000 pu
await page.getByRole('radio', { name: 'STATCOM' }).click()
await slider('Short-circuit ratio SCR').fill('1.5')
await slider('Load power factor (lagging)').fill('1')
await slider('Compensator rating').fill('1')
await slider('Load P').fill('1.4')
await wait(500)
res = await text('#hf-weak-results')
check(/Bus voltage 1\.000/.test(res) && /regulating at 1\.00 pu/.test(res) && !/above nominal/.test(res), 'SCR 1.5, unity pf, rating 1.0, load 1.40, STATCOM: regulating at exactly 1.000 pu')
// the weak bus is still selected from above: its info panel follows the model
check(/1.000 pu ∠ −68.96°/.test(await panelText()), '… and the 3D info panel: 1.000 pu at −68.96° (δ = asin(P·X) = 68.96°)')
await page.screenshot({ path: OUT + 'hf-explore-weak-regulating.png', fullPage: true })
// exactly at the nose (ill-conditioned): SCR 2, unity pf, no support, load 1.00
await page.getByRole('radio', { name: 'No support' }).click()
await slider('Short-circuit ratio SCR').fill('2')
await slider('Load P').fill('1')
await wait(500)
check(/0\.707/.test(await text('#hf-weak-results')), 'at the nose (SCR 2, unity pf, 1.00 pu): V = 0.707 pu')

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await tab('Experiment')
for (const name of ['Raise the firing angle α at constant current', 'Double the DC current', 'Voltage dip: SVC or STATCOM?']) {
  await page.getByRole('button', { name }).click()
  await wait(300)
  await page.locator('.ps-predict .ps-option').first().click()
  await wait(400)
}
check((await page.locator('.ps-table').count()) === 1 && (await page.locator('.hf-flush svg').count()) >= 1, 'a calculated chart and the before/after table')
check(/4 of 6/.test(await acts()), 'three experiments complete an activity')
await page.getByRole('button', { name: 'Series compensation: 50 %' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: '×2' }).click()
await wait(300)
check(/Your prediction was right/.test(await text('.ps-predict-result')) && /×2\.00/.test(await text('.ps-predict-result')), 'series 50 %: ×2.00 (decided from the computation)')
await page.getByRole('button', { name: 'Raise the firing angle α at constant current' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: 'It rises' }).click()
await wait(300)
check(/Your prediction was right/.test(await text('.ps-predict-result')), 'raising α at constant current: Q rises')
check(await noOverflow(), 'no horizontal overflow (Experiment)')
await page.screenshot({ path: OUT + 'hf-experiment.png', fullPage: true })

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await tab('Verify')
check((await page.locator('.ps-check--ok').count()) === 7 && (await page.locator('.ps-check--bad').count()) === 0, 'seven hand calculations, all confirmed by a second method')
check(
  /close to the nose/.test(await text('.ps-panel')) && /Kirchhoff/.test(await text('.ps-panel')),
  'the weak-bus check states its conditioning tolerance at the nose; the link check is numerical + Kirchhoff',
)
await page.locator('.ps-num-answer input').fill('264.86')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/5 of 6/.test(await acts()), 'your-turn answer completes Verify')
check(await noOverflow(), 'no horizontal overflow (Verify)')
await page.screenshot({ path: OUT + 'hf-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await tab('Practise')
const tcr120 = (2 * Math.PI - (4 * Math.PI) / 3 + Math.sin((240 * Math.PI) / 180)) / Math.PI
const vd = (3 * Math.SQRT2 * 220 * Math.cos((20 * Math.PI) / 180)) / Math.PI - (3 / Math.PI) * 10 * 1.5
const mu = (Math.acos(Math.cos((20 * Math.PI) / 180) - (Math.SQRT2 * 10 * 1.5) / 220) * 180) / Math.PI - 20
const nums = [(3 * Math.SQRT2 * 100) / Math.PI, 200 * Math.tan((25 * Math.PI) / 180), tcr120, vd, mu, 20, 2, 1 / 0.6, 2 / 0.6]
const choices = ['delays the AC current', 'The rectifier (constant current)', 'The STATCOM']
const qs = page.locator('.ps-quiz-list > li')
let c = 0
let n = 0
for (let k = 0; k < (await qs.count()); k++) {
  const q = qs.nth(k)
  if ((await q.locator('.ps-num-answer').count()) > 0) {
    await q.locator('input').fill(nums[n++].toFixed(4))
    await q.getByRole('button', { name: 'Check' }).click()
  } else await q.locator('.ps-option', { hasText: choices[c++] }).click()
  await wait(150)
}
check(/12 of 12 answered correctly/.test(await text('.ps-quiz')), 'all twelve questions answered correctly with independently computed answers')
check(/6 of 6/.test(await acts()), 'every activity complete')
check(
  (await page.locator('.ps-q-level').allInnerTexts()).some((t) => /GATE/.test(t)),
  'questions run from concept to GATE-style',
)
check(await noOverflow(), 'no horizontal overflow (Practise)')
await page.screenshot({ path: OUT + 'hf-practise.png', fullPage: true })

// ── engineer level: Newton iterations shown ──────────────────────────────────
console.log('── Engineer level')
await page.evaluate(() => localStorage.setItem('pel.prefs', JSON.stringify({ level: 'engineer' })))
await go(MOD + '?mode=explore')
await page.reload()
await wait(1200)
await view('Weak bus')
check(/Newton–Raphson/.test(await text('.ps-panel')) && /Second method/.test(await text('.ps-panel')), 'engineer: the Newton iterations and the second method are shown')
check(!/Δ \[°\]/.test(await text('.ps-panel')), 'no uppercase-mangled symbols in table headers')
await page.screenshot({ path: OUT + 'hf-explore-weak-engineer.png', fullPage: true })

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
  await p2.waitForTimeout(1200)
  check(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `1280 px: no horizontal overflow (${m})`)
  if (m === 'explore') {
    for (const v of ['VSC link', 'Compensation', 'Weak bus']) {
      await p2.getByRole('radio', { name: v, exact: true }).click()
      await p2.waitForTimeout(600)
      check(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `1280 px: no horizontal overflow (${v})`)
    }
    await p2.screenshot({ path: OUT + 'hf-explore-1280.png', fullPage: true })
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
await p3.waitForTimeout(1500)
check(/3D is not available/.test(await p3.locator('.ps3').first().innerText()), 'no WebGL: the message appears')
check((await p3.locator('.ps3 .hf-schematic svg').count()) === 1 && (await p3.locator('.ps3 canvas').count()) === 0, 'no WebGL: the 2D schematic is shown instead')
check(/1\.965/.test(await p3.locator('#hf-lcc-results').innerText()), 'no WebGL: results still computed')
await p3.screenshot({ path: OUT + 'hf-nowebgl.png', fullPage: true })
await ctx3.close()

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed')
process.exit(failures.length ? 1 : 0)
