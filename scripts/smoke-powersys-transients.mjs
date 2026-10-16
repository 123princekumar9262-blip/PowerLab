/**
 * Power Systems · Module 15 — Transients & Insulation Coordination in the browser: every mode, key computed numbers
 * (checked against independent closed forms computed here), the 3D line (canvas, reset/fit, part list + info panel,
 * guided tour, 3D↔2D, the 3D wave matching the 2D snapshot at a scrubbed time, timings), the lattice ↔ time-plot link,
 * the no-steady-state message, reset, activities, no console errors, no horizontal overflow at 1440 and 1280, leaving
 * and re-entering, and the WebGL fallback.
 * Run with the dev server on 5199: node scripts/smoke-powersys-transients.mjs
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
const MOD = '#/subjects/power-systems/transients'
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
const results = async () => flat(await page.locator('section[aria-labelledby="tr-res"]').first().innerText())
const panel = () => page.locator('.ps3-side')
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).click()
  await wait(700)
}
const num = (s) => Number(s.replace('−', '-'))
/** Set a range input (fractional steps) the way a user drag does: the native setter, then an input event. */
const setRange = (loc, v) =>
  loc.evaluate((el, val) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, String(val))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, v)

// independent closed forms (the twin-bundle line of Module 8: Z_c 305.976 Ω, v 292.861 m/µs)
const ZC = 305.976
const V = 292.861
const k50 = ZC / (50 + ZC)

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── page ─────────────────────────────────────────────────────────────────────
console.log('── Module page')
await go(MOD)
check((await text('main h1')) === 'Transients & Insulation Coordination', 'the module opens (status ready)')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'all five modes')
check(/0 of 6/.test(await acts()), 'six activities, none done')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
check(/Step 1 of 8/i.test(await text('.ps-stepper')), 'the explanation has eight steps')
check(/Lightning strikes a line far from a substation/.test(await text('.ps-step-body')), 'step 1 opens with the real-world question')
check(/BEEE404L/.test(await text('.ps-step-body')) && /supplementary/.test(await text('.ps-step-body')), 'syllabus: elective BEEE404L, supplementary for this student')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
check((await page.locator('.ps3 canvas').count()) === 1, 'step 1 shows the 3D line')
await panel().getByRole('button', { name: 'Surge arrester' }).click()
await wait()
check(/non-linear resistor/.test(await panel().innerText()), 'selecting a part explains what it does')
const s1 = flat(await text('.ps-step-body'))
check(new RegExp(`jumps to ${Math.round(2 * k50 * 1000)} kV`).test(s1), `the opening numbers are computed (${Math.round(2 * k50 * 1000)} kV at the open end)`)
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
await page.locator('summary', { hasText: 'The equations and a worked example' }).click()
await wait(200)
check(/306\.0 Ω/.test(await text('.tr-learn-visual')) && /✓/.test(await text('.tr-learn-visual')), 'Z_c from Module 8’s L and C (306.0 Ω), checked')
for (let k = 0; k < 6; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(250)
}
check(/The answer/.test(await text('.ps-step-title')), 'the explanation ends with the answer to the question')
check(/Not modelled here/.test(await text('.ps-step-body')), 'limitations are stated')
check(/1 of 6/.test(await acts()), 'finishing the explanation completes an activity')
check(await noOverflow(), 'no horizontal overflow (Learn)')
await page.screenshot({ path: OUT + 'tr-learn.png', fullPage: true })
await page.getByRole('button', { name: /Explore the model/ }).click()
await wait(900)
check((await hash()) === MOD + '?mode=explore', 'Learn leads on to Explore')

// ── Explore: 3D ──────────────────────────────────────────────────────────────
console.log('── Explore · 3D line')
const t0 = Date.now()
await go(MOD + '?mode=explore')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const firstDraw = Date.now() - t0
let ro = await results()
check(/1\.000/.test(ro) && new RegExp((2 * k50 * 1000).toFixed(1)).test(ro) && /1000\.0/.test(ro), `default: Γ_L 1.000, first peak ${(2 * k50 * 1000).toFixed(1)} kV, steady state 1000.0 kV`)
await page.getByRole('button', { name: 'Reset view' }).click()
await page.getByRole('button', { name: 'Fit' }).click()
await wait(800)
await panel().getByRole('button', { name: 'Termination' }).click()
await wait()
let info = flat(await panel().innerText())
check(/Γ_L 1\.0000/.test(info) && /τ = 1 \+ Γ_L 2\.0000/.test(info), 'termination info panel: Γ_L 1.0000, τ 2.0000')
// a parameter change, synchronised in the info panel and the results
await page.getByRole('radio', { name: 'Resistor', exact: true }).click()
await wait()
const gR = (1500 - ZC) / (1500 + ZC)
info = flat(await panel().innerText())
ro = await results()
check(new RegExp(`Γ_L ${gR.toFixed(4)}`).test(info) && new RegExp(gR.toFixed(3)).test(ro), `1500 Ω resistor: Γ_L ${gR.toFixed(4)} in the info panel and the results`)
check(/You changed: Termination open → resistor/.test(ro), 'the results say what changed and why')
// time scrub: the 3D wave and the 2D snapshot show the same computed profile
await page.locator('summary', { hasText: 'The lattice diagram and the voltage plots' }).click()
await wait(300)
await setRange(page.locator('.tr-time-slider'), 7.2)
await wait(400)
const w3 = await page.locator('.tr-scene').getAttribute('data-wave')
const w2 = await page.locator('.tr-chart[data-wave]').getAttribute('data-wave')
const t3 = await page.locator('.tr-scene').getAttribute('data-t')
const t2 = await page.locator('.tr-chart[data-wave]').getAttribute('data-t')
check(t3 === t2 && Math.abs(num(t3) - 7.2) < 0.2, `scrubbed to t = ${t3} µs in both views`)
check(w3 === w2, `3D wave = 2D snapshot at 0, ¼, ½, ¾, 1 of ℓ: ${w3}`)
// at 7.2 µs (< T = 10.24 µs) the front is at v·t = 2.11 km: behind it the launched wave, ahead of it nothing
const vals = w3.split(',').map(Number)
const front = (7.2 * V) / 1000
check(
  Math.abs(vals[0] - k50 * 1000) < 0.5 && Math.abs(vals[2] - k50 * 1000) < 0.5 && vals[3] === 0 && vals[4] === 0,
  `the front is between ½ℓ and ¾ℓ (at ${front.toFixed(2)} km): ${(k50 * 1000).toFixed(1)} kV behind, 0 ahead`,
)
check(Math.abs(num((await page.locator('.tr-lattice').getAttribute('data-front')) ?? 'NaN') - front) < 0.02, 'the lattice marks the front at the same place')
// lattice → time plot link
const lat = page.locator('.tr-lattice svg')
const lb = await lat.boundingBox()
await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height * 0.6)
await wait(300)
const tAfter = num((await page.locator('.tr-scene').getAttribute('data-t')) ?? 'NaN')
check(tAfter > 30 && /t = /.test(await text('.tr-time-out')), `clicking the lattice sets the time everywhere (t = ${tAfter.toFixed(2)} µs)`)
check((await page.locator('.tr-cursor').count()) >= 1, 'the time plot shows the same time as a cursor')
check(/2 of 6/.test(await acts()), 'picking a moment on the lattice completes an activity')
// guided tour with a "show this moment" button
await page.getByRole('button', { name: 'Guided tour' }).click()
await wait()
check(/Tour · 1 of 4/i.test(await panel().innerText()), 'guided tour starts')
await panel()
  .getByRole('button', { name: /Show t = / })
  .click()
await wait(300)
check(Math.abs(num((await page.locator('.tr-scene').getAttribute('data-t')) ?? 'NaN') - 0.3 * 10.243) < 0.05, 'the tour’s “show” button sets the time (launch, 0.3 T)')
for (let k = 0; k < 3; k++) {
  await panel().getByRole('button', { name: 'Next →' }).click()
  await wait(250)
}
check(/the lattice/.test(await panel().innerText()), 'the tour reaches the lattice step')
await panel().getByRole('button', { name: 'Replay' }).click()
await wait(300)
check(/Tour · 1 of 4/i.test(await panel().innerText()), 'Replay restarts the tour')
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
await wait(900)
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'tr-explore-3d.png' })

// ── Explore: terminations, 2D, infeasible state, reset ───────────────────────
console.log('── Explore · terminations and 2D')
for (const name of ['Short', 'Matched', 'Into cable']) {
  await page.getByRole('radio', { name, exact: true }).click()
  await wait(450)
}
ro = await results()
const gJ = (36.233 - ZC) / (36.233 + ZC)
check(new RegExp(gJ.toFixed(3).replace('-', '−')).test(ro), `into a cable: Γ_L ${gJ.toFixed(3)}`)
check(/3 of 6/.test(await acts()), 'all five terminations complete an activity')
await page.getByRole('radio', { name: '2D diagram' }).click()
await wait(400)
check((await page.locator('.ps3 .tr-lineview svg').count()) === 1, '3D → 2D: the line view')
check(
  (await page.locator('.ps3 .tr-lineview').getAttribute('data-wave')) === (await page.locator('.tr-chart[data-wave]').getAttribute('data-wave')),
  'the 2D line view shows the same wave as the snapshot',
)
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'tr-explore-2d.png' })
await page.getByRole('radio', { name: '3D' }).click()
await wait(500)
check((await page.locator('.ps3 canvas').count()) === 1, '2D → 3D again')
// infeasible: R_s = 0 with an open end has no steady state
await page.getByRole('radio', { name: 'Open', exact: true }).click()
await page.locator('.ps-slider', { hasText: 'Source resistance' }).locator('input').fill('0')
await wait(400)
ro = await results()
check(/Steady state \(closed form\) none/.test(ro) && /swings 0 ↔ 2000 kV for ever/.test(ro), 'R_s = 0, open end: “no steady state” (swings 0 ↔ 2E) instead of a number')
// R_s = 0 with an arrester: the computed case decides what is shown
await page.locator('summary', { hasText: 'Line, probe and arrester' }).click()
await page.getByLabel('Surge arrester at the far end').check()
await wait(300)
await setRange(page.locator('.ps-slider', { hasText: 'Arrester residual voltage' }).first().locator('input'), 1500)
await wait(400)
ro = await results()
check(/Steady state \(closed form\) 1000\.0/.test(ro), 'R_s = 0, arrester V_res = 1.5E: settles at E = 1000.0 kV (closed form)')
await setRange(page.locator('.ps-slider', { hasText: 'Arrester residual voltage' }).first().locator('input'), 1200)
await wait(400)
ro = await results()
check(/Steady state \(closed form\) none/.test(ro) && /keeps swinging 800 kV ↔ 1200 kV/.test(ro), 'R_s = 0, arrester V_res = 1200 kV: no steady state, keeps swinging 800 ↔ 1200 kV')
await setRange(page.locator('.ps-slider', { hasText: 'Arrester residual voltage' }).first().locator('input'), 900)
await wait(400)
ro = await results()
check(/arrester current grows without limit/.test(ro), 'R_s = 0, arrester V_res below E: the arrester current grows without limit')
await page.screenshot({ path: OUT + 'tr-explore-rs0-arrester.png', fullPage: true })
await page.screenshot({ path: OUT + 'tr-explore-nosteady.png', fullPage: true })
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(400)
ro = await results()
check(new RegExp((2 * k50 * 1000).toFixed(1)).test(ro) && /1\.000/.test(ro), 'Reset restores the default model')
check(await noOverflow(), 'no horizontal overflow (Explore)')
await page.screenshot({ path: OUT + 'tr-explore.png', fullPage: true })

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await tab('Experiment')
for (const name of ['A surge reaches an open end', 'A surge reaches a short circuit', 'An overhead line runs into a cable']) {
  await page.getByRole('button', { name }).click()
  await wait(300)
  await page.locator('.ps-predict .ps-option').first().click()
  await wait(400)
}
check((await page.locator('.tr-exp-result .tr-chart svg').count()) === 1 && (await page.locator('.tr-exp-result .ps-table').count()) === 1, 'computed plot and table after predicting')
check(/4 of 6/.test(await acts()), 'three experiments complete an activity')
await page.getByRole('button', { name: 'A surge reaches an open end' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: '× 2' }).click()
await wait(300)
check(/Your prediction was right/.test(await text('.ps-predict-result')) && /2\.000 × the incident wave/.test(await text('.ps-predict-result')), 'open end: × 2 (decided from the computation)')
await page.getByRole('button', { name: 'The arrester 30 m or 3 m from the transformer' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: 'Noticeably higher' }).click()
await wait(300)
const sep30 = 850 + (2 * 2000 * 30) / V
check(
  /Your prediction was right/.test(await text('.ps-predict-result')) && new RegExp(sep30.toFixed(1)).test(await text('.ps-predict-result')),
  `separation: 30 m is higher (rule ${sep30.toFixed(1)} kV)`,
)
check(await noOverflow(), 'no horizontal overflow (Experiment)')
await page.screenshot({ path: OUT + 'tr-experiment.png', fullPage: true })

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await tab('Verify')
check((await page.locator('.ps-check--ok').count()) === 6 && (await page.locator('.ps-check--bad').count()) === 0, 'six checks, all confirmed by an independent method')
await page.locator('.ps-num-answer input').fill(((1000 * 2 * 1500) / (1500 + ZC)).toFixed(1))
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/5 of 6/.test(await acts()), 'your-turn answer completes Verify')
check(await noOverflow(), 'no horizontal overflow (Verify)')
await page.screenshot({ path: OUT + 'tr-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await tab('Practise')
const nums = [
  Math.sqrt(1.2e-6 / 9.5e-12),
  1 / Math.sqrt(1.2e-6 * 9.5e-12) / 1e6,
  (1600 - 400) / (1600 + 400),
  (500 * 2 * 40) / 440,
  (500 * (40 - 400)) / 440,
  2 * 0.8 * 1000 * (1 + (100 - 400) / 500),
  650 + (2 * 1000 * 14) / 280,
  ((1050 - 750) / 750) * 100,
]
const choice = ['b', 'a', 'c', 'a']
const qs = page.locator('.ps-quiz-list > li')
let c = 0
let n = 0
for (let k = 0; k < (await qs.count()); k++) {
  const q = qs.nth(k)
  if ((await q.locator('.ps-num-answer').count()) > 0) {
    await q.locator('input').fill(nums[n++].toFixed(3))
    await q.getByRole('button', { name: 'Check' }).click()
  } else {
    await q
      .locator('.ps-option')
      .nth(choice[c++].charCodeAt(0) - 97)
      .click()
  }
  await wait(150)
}
check(/12 of 12 answered correctly/.test(await text('.ps-quiz')), 'all twelve questions answered correctly with independently computed answers')
check(/6 of 6/.test(await acts()), 'every activity complete')
check(
  (await page.locator('.ps-q-level').allInnerTexts()).some((t) => /University/.test(t)) && !(await page.locator('.ps-q-level').allInnerTexts()).some((t) => /GATE/.test(t)),
  'questions run from concept to university-style (no GATE label: these topics are GATE-supplementary)',
)
check(await noOverflow(), 'no horizontal overflow (Practise)')
await page.screenshot({ path: OUT + 'tr-practise.png', fullPage: true })

// ── Engineer level: arrester and insulation coordination ─────────────────────
console.log('── Engineer: arrester and coordination')
await page.evaluate(() => localStorage.setItem('pel.prefs', JSON.stringify({ level: 'engineer' })))
await page.reload()
await go(MOD + '?mode=explore')
await page.getByLabel('Surge arrester at the far end').check()
await wait(400)
ro = await results()
check(/850\.0/.test(ro), 'arrester fitted: the first peak at the open end is capped at V_res = 850.0 kV')
await panel().getByRole('button', { name: 'Surge arrester' }).click()
await setRange(page.locator('.tr-time-slider'), 15)
await wait(400)
info = flat(await panel().innerText())
check(/clamping/.test(info) && /Arrester current now \d/.test(info), 'arrester info panel: clamping, with its current')
const coord = flat(await page.locator('.tr-coord').innerText())
check(/1259\.[45]/.test(coord) && new RegExp(sep30.toFixed(1).slice(0, 5)).test(coord) && /The rule holds here/.test(coord), `coordination: simulated 1259.5 kV vs rule ${sep30.toFixed(1)} kV`)
const marginT = ((1300 - 1259.5) / 1259.5) * 100
check(new RegExp(`${marginT.toFixed(1)} %`).test(coord) && /a thin margin/.test(coord), `margin at the transformer ${marginT.toFixed(1)} %, described from the number`)
await page.locator('.tr-coord .ps-slider', { hasText: 'Separation distance' }).locator('input').fill('3')
await wait(400)
check(new RegExp((850 + (2 * 2000 * 3) / V).toFixed(0)).test(flat(await page.locator('.tr-coord').innerText())), 'moving the arrester to 3 m lowers the transformer voltage')
check(await noOverflow(), 'no horizontal overflow (Explore, engineer)')
await page.screenshot({ path: OUT + 'tr-explore-engineer.png', fullPage: true })

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
  if (m === 'explore') await p2.screenshot({ path: OUT + 'tr-explore-1280.png', fullPage: true })
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
check((await p3.locator('.ps3 .tr-lineview svg').count()) === 1 && (await p3.locator('.ps3 canvas').count()) === 0, 'no WebGL: the 2D line view is shown instead')
check(new RegExp((2 * k50 * 1000).toFixed(1)).test(flat(await p3.locator('section[aria-labelledby="tr-res"]').innerText())), 'no WebGL: results still computed')
await p3.screenshot({ path: OUT + 'tr-nowebgl.png', fullPage: true })
await ctx3.close()

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed')
process.exit(failures.length ? 1 : 0)
