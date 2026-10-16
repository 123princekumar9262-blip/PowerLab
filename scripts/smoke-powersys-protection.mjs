/**
 * Power Systems · Module 13 — Advanced Protection in the browser: every mode, key computed numbers, the 3D route
 * (canvas, reset/fit, part list + info panel, guided tour, 3D↔2D, timings), the R–X plane and time–distance chart
 * following the fault, invalid settings, every Explore section, activities, no console errors, no horizontal overflow
 * at 1440 and 1280, leaving and re-entering, and the WebGL fallback.
 * Run with the dev server on 5199: node scripts/smoke-powersys-protection.mjs
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
const MOD = '#/subjects/power-systems/protection'
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const wait = (ms = 400) => page.waitForTimeout(ms)
const go = async (h) => {
  await page.goto(URL + h)
  await wait(1000)
}
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ')
const acts = () => text('.ps-acts summary')
const panel = () => page.locator('.ps3-side')
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).click()
  await wait(800)
}
const section = async (name) => {
  await page.getByRole('radiogroup', { name: 'Protection section' }).getByRole('radio', { name, exact: true }).click()
  await wait(700)
}
const slider = (label) => page.locator('.ps-slider', { hasText: label }).first().locator('input')
const relayCard = () => text('section[aria-labelledby="pr-res-h"]')
const rxLabel = () => page.locator('.pr-rx svg').first().getAttribute('aria-label')

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── page ─────────────────────────────────────────────────────────────────────
console.log('── Module page')
await go(MOD)
check((await text('main h1')) === 'Advanced Protection', 'the module opens (status ready)')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'all five modes')
check(/0 of 6/.test(await acts()), 'six activities, none done')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
check(/step 1 of 10/i.test(await text('.ps-stepper')), 'the explanation has ten steps')
check(/How can a relay at one end of a 120 km line tell whether a fault is inside its own line or on the next one/.test(await text('.ps-step-body')), 'step 1 opens with the real-world question')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
check((await page.locator('.ps3 canvas').count()) === 1, 'step 1 shows the 3D route')
await panel().getByRole('button', { name: 'Current transformers' }).click()
await wait()
check(/800 : 1/.test(await panel().innerText()), 'selecting a part explains what it does')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
check(
  /34\.81 Ω/.test(await text('.pr-learn-visual')) && /0\.7000/.test(await text('.pr-learn-visual')) && /✓/.test(await text('.pr-learn-visual')),
  'worked example: V/I = 34.81 Ω → m = 0.7000, checked',
)
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
check(/0\.6928/.test(await text('.pr-learn-visual')) && /under-reach/.test(await text('.pr-learn-visual')), 'k₀ = 0.6928, uncompensated relay under-reaches')
for (let k = 0; k < 7; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(250)
}
check(/Circuit breakers/.test(await text('.ps-step-title')), 'the explanation ends with circuit breakers')
check(/359\.3 kV/.test(await text('.pr-learn-visual')), 'TRV worked example: 2V_m = 359.3 kV at CB1')
check(/1 of 6/.test(await acts()), 'finishing the explanation completes an activity')
check(await noOverflow(), 'no horizontal overflow (Learn)')
await page.screenshot({ path: OUT + 'protection-learn.png', fullPage: true })
await page.getByRole('button', { name: /Explore it yourself/ }).click()
await wait(900)
check((await page.evaluate(() => location.hash)) === MOD + '?mode=explore', 'Learn leads on to Explore')

// ── Explore: distance (3D) ───────────────────────────────────────────────────
console.log('── Explore · distance, 3D')
const t0 = Date.now()
await go(MOD + '?mode=explore')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const firstDraw = Date.now() - t0
let rc = await relayCard()
check(/34\.81/.test(rc) && /Zone 1/.test(rc), 'default: 3-phase fault at 84 km (70 %) → Z_app 34.81 Ω, zone 1')
check(/Cleared at 0\.06 s by CB A/.test(await text('.pr-outcome')), 'the outcome: cleared at 0.06 s by CB A')
await page.getByRole('button', { name: 'Reset view' }).click()
await page.getByRole('button', { name: 'Fit' }).click()
await wait(800)
await panel().getByRole('button', { name: 'Distance relay R_A' }).click()
await wait()
let info = (await panel().innerText()).replace(/\s+/g, ' ')
check(/34\.81 Ω ∠81\.7°/.test(info) && /zone 1/.test(info), 'relay info panel: 34.81 Ω ∠81.7°, zone 1')
const rx0 = await rxLabel()
await slider('Fault position from A').fill('108')
await wait(900)
info = (await panel().innerText()).replace(/\s+/g, ' ')
rc = await relayCard()
const rx1 = await rxLabel()
check(/44\.75 Ω/.test(info) && /zone 2/.test(info) && /44\.75/.test(rc) && /Zone 2/.test(rc), 'fault at 108 km (90 %): 44.75 Ω, zone 2 — in the 3D info panel and the results')
check(rx0 !== rx1 && /44\.75/.test(rx1 ?? ''), 'the R–X plot follows the fault (apparent impedance 44.75 Ω)')
check(/You changed: Fault moved 84\.0 → 108\.0 km/.test(rc) && /exactly the distance ratio/.test(rc) && /exactly m·Z₁L/.test(rc), 'the results say what changed and why')
await panel().getByRole('button', { name: 'Breaker CB A' }).click()
await wait()
check(/open at 0\.36 s/.test((await panel().innerText()).replace(/\s+/g, ' ')), 'CB A info: opens at 0.36 s (zone 2 + breaker)')
await slider('Fault position from A').fill('150')
await wait(900)
check(/CB B2 \(line L3 at B\)/.test(await text('.pr-outcome')) && /R_A had started timing and resets/.test(await text('.pr-outcome')), 'fault on L3: cleared at B, R_A resets')
check(/3 of 6|2 of 6/.test(await acts()), 'progress counted')
// fault resistance moves the point
await slider('Fault position from A').fill('84')
await slider('Fault resistance R_f').fill('15')
await wait(900)
rc = await relayCard()
check(/Zone 2/.test(rc) && /The R_f term/.test(rc) && /R_f × 1\.000/.test(rc), 'R_f = 15 Ω at 70 %: the relay under-reaches into zone 2')
// guided tour
await page.getByRole('button', { name: 'Guided tour' }).click()
await wait()
check(/Tour · 1 of 5/i.test(await panel().innerText()), 'guided tour starts')
for (let k = 0; k < 4; k++) {
  await panel().getByRole('button', { name: 'Next →' }).click()
  await wait(400)
}
check(/The breakers trip/.test(await panel().innerText()), 'the tour reaches the breaker trip')
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
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'protection-explore-3d.png' })
// 3D ↔ 2D
await page.getByRole('radio', { name: '2D diagram' }).click()
await wait(400)
check((await page.locator('.ps3 .pr-sld').count()) === 1, '3D → 2D: the single-line diagram')
check(/OPEN|closed/.test((await page.locator('.ps3 .pr-sld').first().textContent()) ?? ''), '2D shows the breaker states')
await page.getByRole('radio', { name: '3D' }).click()
await wait(500)
check((await page.locator('.ps3 canvas').count()) === 1, '2D → 3D again')
// invalid settings
await page.locator('summary', { hasText: 'Relay settings' }).click()
await slider('Zone 1 reach').fill('0')
await wait(500)
check(/cannot be used/.test(await text('.ps-panel')) && (await page.locator('section[aria-labelledby="pr-res-h"]').count()) === 0, 'zero reach: a clear message and no decisions')
await page.getByRole('button', { name: 'Restore the typical settings' }).click()
await wait(500)
await page.locator('.pr-card-head').getByRole('button', { name: 'Reset' }).first().click()
await wait(700)
check(/34\.81/.test(await relayCard()), 'Reset restores the default case')
// earth fault without k0
await page.locator('.ps-card', { hasText: 'The fault' }).getByRole('radio', { name: 'L-G', exact: true }).click()
await wait(500)
check(/34\.81/.test(await relayCard()), 'L-G fault with k₀: still 34.81 Ω (m·Z₁L)')
await page.getByLabel('Residual compensation k₀ in the earth loops').uncheck()
await wait(600)
check(!/34\.81/.test(await relayCard()), 'without k₀ the earth loop reads a different (larger) impedance')
await page.getByLabel('Residual compensation k₀ in the earth loops').check()
await page.locator('.pr-card-head').getByRole('button', { name: 'Reset' }).first().click()
await wait(500)
check(await noOverflow(), 'no horizontal overflow (Explore · distance)')
await page.screenshot({ path: OUT + 'protection-explore.png', fullPage: true })

// ── Explore: the other sections ─────────────────────────────────────────────
console.log('── Explore · other sections')
await section('Directional')
check(/Forward/.test(await text('section[aria-labelledby="pr-dirres-h"]')), 'directional: fault on L1 → forward')
await slider('Fault position from A').fill('130')
await wait(600)
const dir = await text('section[aria-labelledby="pr-dirres-h"]')
check(/Reverse/.test(dir) && /would have tripped L1/.test(dir), 'fault on L3 → reverse; a plain overcurrent relay would have tripped')
await page.screenshot({ path: OUT + 'protection-directional.png', fullPage: true })
await section('Differential')
let df = await text('section[aria-labelledby="pr-diffres-h"]')
check(/Restrain/.test(df) && /0\.000/.test(df), 'differential, through fault: I_op = 0, restrain')
await page.getByRole('radio', { name: 'Internal: LV terminals' }).click()
await wait(500)
check(/Trip/.test(await text('section[aria-labelledby="pr-diffres-h"]')), 'internal fault: trip')
await page.getByRole('radio', { name: 'External: 33 kV bus' }).click()
await page
  .locator('summary', { hasText: 'Vector group and errors' })
  .click()
  .catch(() => {})
await page.getByRole('radiogroup', { name: 'Relay vector-group setting' }).getByRole('radio', { name: 'Yd1', exact: true }).click()
await wait(500)
df = await text('section[aria-labelledby="pr-diffres-h"]')
check(/Trip/.test(df) && /false trip/.test(df), 'wrong vector-group compensation: a false trip, said so')
await page.screenshot({ path: OUT + 'protection-differential.png', fullPage: true })
await section('Neutral earthing')
await page.getByRole('radiogroup', { name: 'Earthing method' }).getByRole('radio', { name: 'Unearthed' }).click()
await wait(500)
const ea = await text('section[aria-labelledby="pr-earthres-h"]')
check(/3\.75 A/.test(ea) && /1\.732/.test(ea), 'unearthed: 3.75 A capacitive current, healthy phases 1.732 pu')
await page.getByRole('radiogroup', { name: 'Earthing method' }).getByRole('radio', { name: 'Resonant (Petersen)' }).click()
await wait(500)
check(/2122\.0 Ω/.test(await text('section[aria-labelledby="pr-pet-h"]')), 'Petersen coil tuned at 2122.0 Ω')
await page.screenshot({ path: OUT + 'protection-earthing.png', fullPage: true })
await section('Generator')
check(/95\.0/.test(await text('section[aria-labelledby="pr-genres-h"]')), 'generator: 5 % relay protects 95.0 % of the winding')
await section('Breaker TRV')
check(/359\.3/.test(await text('section[aria-labelledby="pr-cbres-h"]')) && /0\.98/.test(await text('section[aria-labelledby="pr-cbres-h"]')), 'CB1: TRV peak 359.3 kV, breaking current 0.98 kA')
await page.screenshot({ path: OUT + 'protection-breaker.png', fullPage: true })
check(/every section opened/.test(await text('.ps-panel')), 'all six sections opened')
check(await noOverflow(), 'no horizontal overflow (Explore · sections)')

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await tab('Experiment')
for (const name of ['A fault at 70 % and at 90 % of the line', 'Add fault resistance', 'More capacitance at the breaker']) {
  await page.getByRole('button', { name }).click()
  await wait(300)
  await page.locator('.ps-predict .ps-option').first().click()
  await wait(400)
}
check((await page.locator('.ps-exp-run, .ps-table').count()) >= 1, 'the comparison table appears')
await page.getByRole('button', { name: 'A fault at 70 % and at 90 % of the line' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: '70 % in zone 1, 90 % in zone 2' }).click()
await wait(300)
check(/Your prediction was right/.test(await text('.ps-predict-result')), '70 % → zone 1, 90 % → zone 2 (decided from the computation)')
check(await noOverflow(), 'no horizontal overflow (Experiment)')
await page.screenshot({ path: OUT + 'protection-experiment.png', fullPage: true })

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await tab('Verify')
check(/Here Z_app equals the line impedance to the fault/.test(await text('.ps-panel')), 'Verify block 1: Z_app = m·Z₁L stated only because it holds (bolted, k₀ on)')
check((await page.locator('.ps-check--ok').count()) === 6 && (await page.locator('.ps-check--bad').count()) === 0, 'six hand calculations, all confirmed by a second method')
await page.locator('.ps-num-answer input').fill('34.81')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/Correct/.test(await text('.ps-quiz')), 'your-turn answer accepted')
check(await noOverflow(), 'no horizontal overflow (Verify)')
await page.screenshot({ path: OUT + 'protection-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await tab('Practise')
const answers = ['a', 'a', 29.834, 0.6928, 1061.03, 1.0, 50.91, 0.3636, 90, 11, 0, 0, 5.986]
const qs = page.locator('.ps-quiz-list > li')
for (let k = 0; k < (await qs.count()); k++) {
  const q = qs.nth(k)
  const a = answers[k]
  if ((await q.locator('.ps-num-answer').count()) > 0) {
    await q.locator('input').fill(String(a))
    await q.getByRole('button', { name: 'Check' }).click()
  } else
    await q
      .locator('.ps-option')
      .nth(a === 'a' ? 0 : a)
      .click()
  await wait(150)
}
check(/13 of 13 answered correctly/.test(await text('.ps-quiz')), 'all thirteen questions answered correctly with independently computed answers')
check(
  (await page.locator('.ps-q-level').allInnerTexts()).some((t) => /GATE/.test(t)),
  'questions run from concept to GATE-style',
)
check(await noOverflow(), 'no horizontal overflow (Practise)')
await page.screenshot({ path: OUT + 'protection-practise.png', fullPage: true })
check(/6 of 6/.test(await acts()), 'every activity complete')

// ── Engineer detail level: the six loops table ─────────────────────────────
console.log('── Engineer level')
await page.evaluate(() => localStorage.setItem('pel.prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('pel.prefs') ?? '{}'), level: 'engineer' })))
await go(MOD + '?mode=explore')
await page.reload()
await wait(1200)
await section('Distance')
check(/All six measuring loops/.test(await text('.ps-panel')) && /Load encroachment/.test(await text('.ps-panel')), 'engineer level shows the six measuring loops and the load-encroachment check')
await page.screenshot({ path: OUT + 'protection-explore-engineer.png', fullPage: true })
await page.evaluate(() => localStorage.setItem('pel.prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('pel.prefs') ?? '{}'), level: 'beginner' })))
await page.reload()
await wait(800)

// ── leave and re-enter ───────────────────────────────────────────────────────
console.log('── Leave and re-enter')
for (let k = 0; k < 2; k++) {
  await go('#/subjects/power-systems/faults')
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
  await p2.waitForTimeout(1100)
  check(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `1280 px: no horizontal overflow (${m})`)
  if (m === 'explore') await p2.screenshot({ path: OUT + 'protection-explore-1280.png', fullPage: true })
}
await p2.goto(URL + MOD + '?mode=explore')
await p2.waitForTimeout(1100)
for (const s of ['Directional', 'Differential', 'Neutral earthing', 'Generator', 'Breaker TRV']) {
  await p2.getByRole('radiogroup', { name: 'Protection section' }).getByRole('radio', { name: s, exact: true }).click()
  await p2.waitForTimeout(600)
  check(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `1280 px: no horizontal overflow (${s})`)
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
await p3.waitForTimeout(1300)
check(/3D is not available/.test(await p3.locator('.ps3').first().innerText()), 'no WebGL: the message appears')
check((await p3.locator('.ps3 .pr-sld').count()) === 1 && (await p3.locator('.ps3 canvas').count()) === 0, 'no WebGL: the 2D single-line diagram is shown instead')
check(/34\.81/.test((await p3.locator('section[aria-labelledby="pr-res-h"]').innerText()).replace(/\s+/g, ' ')), 'no WebGL: results still computed')
await p3.screenshot({ path: OUT + 'protection-nowebgl.png', fullPage: true })
await ctx3.close()

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed')
process.exit(failures.length ? 1 : 0)
