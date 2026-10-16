/**
 * Power Systems · Module 9 — Mechanical Design & Insulation in the browser: every mode, key computed numbers, the 3D
 * span (canvas, reset/fit, part list + info panel, guided tour, 3D↔2D, timings), a parameter change synchronised in the
 * 3D info panel and the 2D elevation, the insulator string and grading, corona, an infeasible span, activities, no
 * console errors, no horizontal overflow at 1440 and 1280, leaving and re-entering, and the WebGL fallback.
 * Run with the dev server on 5199: node scripts/smoke-powersys-mechanical.mjs
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
const MOD = '#/subjects/power-systems/mechanical'
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
const text = (sel) => page.locator(sel).first().innerText()
const flat = (s) => s.replace(/\s+/g, ' ')
const acts = async () => flat(await text('.ps-acts summary'))
const spanRes = async () => flat(await page.locator('section[aria-labelledby="mech-span-res"]').first().innerText())
const panel = () => page.locator('.ps3-side')
const slider = (label) => page.locator('.ps-slider', { hasText: label }).first().locator('input')
const level = async (l) => {
  await page.getByLabel('Detail level the labs open with').selectOption(l)
  await wait(300)
}
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).click()
  await wait(700)
}

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── page ─────────────────────────────────────────────────────────────────────
console.log('── Module page')
await go(MOD)
check((await text('main h1')) === 'Mechanical Design & Insulation', 'the module opens (status ready)')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'all five modes')
check(/0 of 6/.test(await acts()), 'six activities, none done')
await tab('Explore')
check(
  (await page.getByRole('radiogroup', { name: 'Set the tension by' }).count()) === 0 && (await page.locator('summary', { hasText: 'Supports, clearance' }).count()) === 0,
  'Beginner: only the primary span controls',
)
await level('standard')
check((await page.getByRole('radiogroup', { name: 'Set the tension by' }).count()) === 1, 'Standard: more controls (tension by T₀ or factor of safety)')
await tab('Learn')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
check(/Step 1 of 8/i.test(await text('.ps-stepper')), 'the explanation has eight steps')
check(/Why does an overhead line hang in a curve/.test(await text('.ps-step-body')), 'step 1 opens with the real-world question')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
check((await page.locator('.ps3 canvas').count()) === 1, 'step 1 shows the 3D span')
check(/VIT BEEE304L Modules 4 and 5/.test(await text('.ps-step-body')), 'syllabus line from the mapping')
await panel()
  .getByRole('button', { name: /Disc 5 · line end/ })
  .click()
await wait()
check(/11\.39 kV/.test(await panel().innerText()), 'selecting the line-end disc shows its computed voltage (11.39 kV)')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
check(/4\.3212 m/.test(await text('.mech-learn-visual')) && /✓/.test(await text('.mech-learn-visual')), 'catenary worked example S = 4.3212 m, checked by numerical integration')
for (let k = 0; k < 6; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(300)
}
check(/Corona/.test(await text('.ps-step-title')), 'the explanation ends with corona')
check(/99\.39 kV/.test(await text('.mech-learn-visual')) && /✓/.test(await text('.mech-learn-visual')), 'Peek worked example V_c = 99.39 kV, checked by the surface gradient')
check((await page.locator('.ps-check--bad').count()) === 0, 'no ✗ in Learn')
check(/1 of 6/.test(await acts()), 'finishing the explanation completes an activity')
check(await noOverflow(), 'no horizontal overflow (Learn)')
await page.screenshot({ path: OUT + 'mechanical-learn.png', fullPage: true })
await page.getByRole('button', { name: /Explore the span/ }).click()
await wait(900)
check((await hash()) === MOD + '?mode=explore', 'Learn leads on to Explore')

// ── Explore: 3D span ─────────────────────────────────────────────────────────
console.log('── Explore · 3D span')
const t0 = Date.now()
await go(MOD + '?mode=explore')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const firstDraw = Date.now() - t0
let ro = await spanRes()
check(/4\.32/.test(ro) && /10\.68/.test(ro) && /25\.04/.test(ro) && /3\.55/.test(ro), 'default span: sag 4.32 m, clearance 10.68 m, support tension 25.04 kN, FoS 3.55')
check(/vertical is exaggerated ×5\.0/.test(await text('.ps3-kind')), 'the vertical exaggeration (×5.0) is stated')
await page.getByRole('button', { name: 'Reset view' }).click()
await page.getByRole('button', { name: 'Fit' }).click()
await wait(800)
await panel().getByRole('button', { name: 'Lowest point' }).click()
await wait()
let info = flat(await panel().innerText())
check(/Vertical sag 4\.321 m/.test(info) && /Ground clearance 10\.68 m/.test(info), 'lowest-point info panel: sag 4.321 m, clearance 10.68 m')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'mechanical-explore-3d.png' })
// a parameter change, synchronised in the info panel, the readouts and (below) the 2D view
await slider('Span L').fill('400')
await wait()
info = flat(await panel().innerText())
ro = await spanRes()
check(/Vertical sag 7\.684 m/.test(info) && /7\.68/.test(ro) && /7\.32/.test(ro), 'span 400 m: sag 7.684 m in the info panel and the results, clearance 7.32 m')
check(/You changed: Span 300 → 400 m/.test(ro), 'the results say what changed and why')
await page.getByRole('radio', { name: '2D diagram' }).click()
await wait(400)
const elev = await text('.ps3 .mech-elev')
check(/sag 7\.68 m/.test(elev) && /clearance 7\.32 m/.test(elev) && /span 400 m/.test(elev), '3D → 2D: the elevation shows the same sag 7.68 m and clearance 7.32 m')
check((await page.locator('.ps3 .mech-ladder svg').count()) === 1, '2D view also shows the insulator ladder')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'mechanical-explore-2d.png' })
await page.getByRole('radio', { name: '3D' }).click()
await wait(500)
check((await page.locator('.ps3 canvas').count()) === 1, '2D → 3D again')
await slider('Span L').fill('300')
await wait(300)
// guided tour
await page.getByRole('button', { name: 'Guided tour' }).click()
await wait()
check(/Tour · 1 of 5/i.test(await panel().innerText()), 'guided tour starts')
const tourTitles = []
for (let k = 0; k < 4; k++) {
  await panel().getByRole('button', { name: 'Next →' }).click()
  await wait(700)
  tourTitles.push(await panel().locator('h4').innerText())
}
check(tourTitles.join('|') === 'The sag|The ground clearance|The insulator string|The most-stressed disc', `tour: span → sag → clearance → string → most-stressed disc`)
check(/Disc 5, nearest the line, carries 11\.39 kV/.test(await panel().innerText()), 'the last tour step names the computed most-stressed disc')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'mechanical-tour-disc.png' })
await panel().getByRole('button', { name: 'Replay' }).click()
await wait(300)
check(/Tour · 1 of 5/i.test(await panel().innerText()), 'Replay restarts the tour')
await panel().getByRole('button', { name: 'Close tour' }).click()
await page.getByRole('button', { name: 'Reset view' }).click()
await wait(700)
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

// ── Explore: wind and ice ────────────────────────────────────────────────────
console.log('── Explore · wind and ice')
await page.getByLabel('Ice', { exact: true }).check()
await wait(400)
ro = await spanRes()
check(/8\.26/.test(ro) && /6\.74/.test(ro) && /25\.15/.test(ro), 'ice 10 mm: sag 8.26 m, clearance 6.74 m, tension 25.15 kN')
check(/below the minimum clearance/.test(ro), '… and a warning: below the minimum clearance (computed)')
await page.getByLabel('Wind', { exact: true }).check()
await wait(500)
check(/2 of 6/.test(await acts()), 'trying ice and wind completes an activity')
check((await page.locator('.mech-figure', { hasText: 'arrows are to scale' }).count()) === 1, 'the load diagram appears, drawn to scale')
await page.getByRole('button', { name: 'Reset view' }).click()
await wait(900)
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'mechanical-wind-ice-3d.png' })
await page.screenshot({ path: OUT + 'mechanical-explore-span.png', fullPage: true })
// infeasible: too slack for the span
await page.getByLabel('Ice', { exact: true }).uncheck()
await page.getByLabel('Wind', { exact: true }).uncheck()
await slider('Span L').fill('800')
await slider('Tension T₀').fill('2')
await wait(400)
const panelText = await page.locator('.ps-panel').innerText()
check(/Tension too low for this span/.test(panelText), 'too slack for an 800 m span: a clear message')
check((await page.locator('section[aria-labelledby="mech-span-res"]').count()) === 0, '… and no results')
await page.screenshot({ path: OUT + 'mechanical-invalid.png', fullPage: true })
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(400)
check(/4\.32/.test(await spanRes()), 'Reset restores the default span')
// factor-of-safety mode: ice keeps the support tension, lowers T₀
await page.getByRole('radio', { name: 'Factor of safety' }).click()
await wait(300)
await page.getByLabel('Ice', { exact: true }).check()
await wait(400)
ro = await spanRes()
check(
  /T₀ 35\.571 → 35\.493 kN/.test(ro) && /support tension 35\.60 → 35\.60 kN \(no change\)/.test(ro) && /T₀ is solved again: it falls, and the sag rises/.test(ro),
  'FoS mode + ice: T₀ 35.571 → 35.493 kN, support tension unchanged — and the “why” says so',
)
check(/support tension is held at the working tension/.test(ro) && !/T₀ is held/.test(ro), 'FoS mode: the model note does not claim T₀ is held')
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(300)
// a span shorter than the drawn width: the caption says compressed, not exaggerated
await slider('Span L').fill('50')
await wait(400)
check(/vertical is compressed ×0\.83/.test(await text('.ps3-kind')) && !/exaggerated/.test(await text('.ps3-kind')), '50 m span: the 3D caption says the vertical is compressed ×0.83')
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(300)
check(await noOverflow(), 'no horizontal overflow (Explore · span)')

// ── Explore: insulator string ────────────────────────────────────────────────
console.log('── Explore · insulator string')
await page.getByRole('radio', { name: 'Insulator string' }).click()
await wait(500)
const strRes = async () => flat(await page.locator('section[aria-labelledby="mech-str-res"]').innerText())
let sr = await strRes()
check(/66\.9/.test(sr) && /11\.39/.test(sr) && /5\.28/.test(sr), '5 discs, m = 0.1, 66 kV: η 66.9 %, line-end 11.39 kV, top 5.28 kV')
check(/Disc 5 · line/.test(await text('.mech-ladder')) && /11\.39 kV/.test(await text('.mech-ladder')), 'the ladder diagram shows each disc’s voltage')
await page.locator('.mech-chip').nth(4).click()
await wait()
check(/11\.39 kV/.test(await panel().innerText()), 'choosing a disc in the legend selects it in the 3D view')
await slider('Discs n').fill('8')
await wait(400)
check(/45\.6/.test(await strRes()), '8 discs: η falls to 45.6 %')
await page.getByRole('radio', { name: 'Grading' }).click()
await wait(400)
sr = await strRes()
check(/100\.0/.test(sr) && /all discs equal/.test(sr), 'capacitance grading: η 100.0 %, every disc equal')
await page.getByRole('radio', { name: 'Guard ring' }).click()
await wait(400)
check(/100\.0/.test(await strRes()) && /IDEAL guard ring/.test(await strRes()), 'ideal guard ring: η 100.0 %, its model stated')
check(/3 of 6/.test(await acts()), 'both grading methods complete an activity')
await page.screenshot({ path: OUT + 'mechanical-explore-string.png', fullPage: true })
check(await noOverflow(), 'no horizontal overflow (Explore · string)')
await page.getByRole('radio', { name: 'None' }).click()
await slider('Discs n').fill('5')
await wait(300)

// ── Explore: corona ──────────────────────────────────────────────────────────
console.log('── Explore · corona')
await page.getByRole('radio', { name: 'Corona' }).click()
await wait(500)
const corRes = async () => flat(await page.locator('section[aria-labelledby="mech-cor-res"]').innerText())
let cr = await corRes()
check(/99\.4/.test(cr) && /172\.1/.test(cr) && /No corona expected/.test(cr), 'V_c 99.4 kV phase (172.1 kV line); 66 kV: no corona expected')
await page.getByRole('radio', { name: '220', exact: true }).click()
await wait(400)
cr = await corRes()
check(/Corona expected/.test(cr) && /127\.0/.test(cr), '220 kV (127.0 kV per phase): corona expected — the verdict is computed')
await slider('Air pressure b').fill('60')
await wait(400)
check(/78\.5/.test(await corRes()), 'lower pressure (60 cmHg): V_c falls to 78.5 kV')
// factors that make V_v < V_c: the verdict says so instead of contradicting itself
await slider('Air pressure b').fill('76')
await slider('Spacing D between conductors').fill('4')
await page.locator('summary', { hasText: 'Surface factors' }).click()
await slider('Irregularity factor m₀').fill('1')
await slider('Visual factor m_v').fill('0.6')
await wait(400)
cr = await corRes()
check(
  /No corona expected/.test(cr) && /132\.4/.test(cr) && /102\.7/.test(cr) && /inconsistent/.test(cr) && !/operating voltage above it/.test(cr),
  'm₀ 1, m_v 0.6, D 4 m: V_v (102.7) < V_c (132.4) is flagged as inconsistent; no contradiction',
)
await page.screenshot({ path: OUT + 'mechanical-corona-inconsistent.png', fullPage: true })
await page.screenshot({ path: OUT + 'mechanical-explore-corona.png', fullPage: true })
check(await noOverflow(), 'no horizontal overflow (Explore · corona)')
await page.getByRole('radio', { name: 'Span & sag' }).click()
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(300)

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await tab('Experiment')
for (const name of ['Double the span', 'Add ice to the conductor', 'Let the wind blow']) {
  await page.getByRole('button', { name }).click()
  await wait(300)
  await page.locator('.ps-predict .ps-option').first().click()
  await wait(400)
}
check((await page.locator('.mech-exp-pair .mech-elev').count()) === 2, 'before/after elevations, drawn on one scale')
check(/4 of 6/.test(await acts()), 'three experiments complete an activity')
await page.getByRole('button', { name: 'Double the span' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: 'About 4 times' }).click()
await wait(300)
check(/Your prediction was right/.test(await text('.ps-predict-result')) && /4\.00/.test(await text('.ps-predict-result')), 'doubling the span: sag ×4 (decided from the computation)')
await page.getByRole('button', { name: 'Use more discs in the string' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: 'It falls' }).click()
await wait(300)
check((await page.locator('.mech-exp-pair .mech-ladder').count()) === 2 && /Your prediction was right/.test(await text('.ps-predict-result')), 'more discs: efficiency falls, two ladders compared')
check(await noOverflow(), 'no horizontal overflow (Experiment)')
await page.screenshot({ path: OUT + 'mechanical-experiment.png', fullPage: true })

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await tab('Verify')
check((await page.locator('.ps-check--ok').count()) === 6 && (await page.locator('.ps-check--bad').count()) === 0, 'six hand calculations, all confirmed by a second method')
await page.locator('.ps-num-answer input').fill('4.32')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/5 of 6/.test(await acts()), 'your-turn answer completes Verify')
check(await noOverflow(), 'no horizontal overflow (Verify)')
await page.screenshot({ path: OUT + 'mechanical-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await tab('Practise')
const g0 = 30 / Math.SQRT2
const iceW = (d, t) => 915 * 9.81 * Math.PI * t * (d + t)
const wi = iceW(0.0195, 0.012)
const wv = 9 + wi
const ww = 390 * (0.0195 + 0.024)
const wr = Math.hypot(wv, ww)
const sVert = ((wr * 200 ** 2) / (8 * 30e3)) * (wv / wr)
const x1 = 150 - (10e3 * 20) / (10 * 300)
const m = 0.125
const V = 33 / Math.sqrt(3)
const r3 = [1, 1 + m, 1 + 3 * m + m * m]
const v3 = (r3[2] * V) / (r3[0] + r3[1] + r3[2])
const delta = (3.92 * 74) / 303
const nums = [
  (6 * 250 ** 2) / (8 * 15e3),
  iceW(0.02, 0.01),
  sVert,
  40 - (10 * x1 * x1) / (2 * 10e3),
  v3,
  (V / (3 * v3)) * 100,
  0.9 * g0 * delta * Math.log(250),
  4,
  1 + 3 * 0.2,
  (3.92 * 72) / 308,
  (2.1 / 2.2) * 100,
]
const choice = [1, 1, 2, 1]
const qs = page.locator('.ps-quiz-list > li')
let c = 0
let n = 0
for (let k = 0; k < (await qs.count()); k++) {
  const q = qs.nth(k)
  if ((await q.locator('.ps-num-answer').count()) > 0) {
    await q.locator('input').fill(nums[n++].toFixed(4))
    await q.getByRole('button', { name: 'Check' }).click()
  } else await q.locator('.ps-option').nth(choice[c++]).click()
  await wait(150)
}
check(/15 of 15 answered correctly/.test(await text('.ps-quiz')), 'all fifteen questions answered correctly with independently computed answers')
check(/6 of 6/.test(await acts()), 'every activity complete')
check(
  (await page.locator('.ps-q-level').allInnerTexts()).some((t) => /GATE/.test(t)),
  'questions run from concept to GATE-style',
)
check(await noOverflow(), 'no horizontal overflow (Practise)')
await page.screenshot({ path: OUT + 'mechanical-practise.png', fullPage: true })

// ── an extreme design: every Verify check still holds ─────────────────────────
console.log('── Extreme design (engineer level: wind and ice, then unequal supports)')
await tab('Explore')
await level('engineer')
await page.getByLabel('Ice', { exact: true }).check()
await page.getByLabel('Wind', { exact: true }).check()
await slider('Span L').fill('600')
await slider('Tension T₀').fill('60')
await wait(300)
await slider('Height of support A').fill('40')
await wait(300)
await tab('Verify')
check((await page.locator('.ps-check--bad').count()) === 0 && (await page.locator('.ps-check--ok').count()) === 6, '600 m, 60 kN, ice and wind, 40 m supports: all six checks still confirmed (no ✗)')
await page.screenshot({ path: OUT + 'mechanical-verify-extreme.png', fullPage: true })
await tab('Explore')
await page.getByLabel('Supports at different levels').check()
await slider('Support B higher by h').fill('60')
await slider('Span L').fill('300')
await wait(400)
ro = await spanRes()
check(/Lowest point below A \/ B/.test(ro), 'unequal supports: sags from both supports are reported')
check(/beyond the lower support/.test(ro), '300 m, 60 kN, 60 m height difference: x₁ < 0 is explained (computed)')
await page.getByRole('button', { name: 'Reset view' }).click()
await wait(900)
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'mechanical-unequal-3d.png' })
await tab('Verify')
check((await page.locator('.ps-check--bad').count()) === 0 && (await page.locator('.ps-check--ok').count()) === 6, 'unequal supports with wind and ice: all six checks confirmed')
await level('beginner')

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
for (const md of ['learn', 'explore', 'experiment', 'verify', 'practise']) {
  await p2.goto(URL + MOD + '?mode=' + md)
  await p2.waitForTimeout(1000)
  check(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `1280 px: no horizontal overflow (${md})`)
  if (md === 'explore') await p2.screenshot({ path: OUT + 'mechanical-explore-1280.png', fullPage: true })
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
check(
  (await p3.locator('.ps3 .mech-elev svg').count()) === 1 && (await p3.locator('.ps3 .mech-ladder svg').count()) === 1 && (await p3.locator('.ps3 canvas').count()) === 0,
  'no WebGL: the 2D elevation and ladder are shown instead',
)
check(/4\.32/.test(flat(await p3.locator('section[aria-labelledby="mech-span-res"]').innerText())), 'no WebGL: results still computed')
await p3.screenshot({ path: OUT + 'mechanical-nowebgl.png', fullPage: true })
await ctx3.close()

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed')
process.exit(failures.length ? 1 : 0)
