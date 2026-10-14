/**
 * Power Systems — Module 12, Generator & Frequency Control, in the browser: every mode, the key computed numbers,
 * a parameter change synchronised in the 3D info panel and the 2D diagram, reset, the no-disturbance and unstable
 * states, playback and scrubbing, the 3D layer (canvas, reset/fit, part list + info panel, 3D↔2D, guided tour,
 * re-entering the module, the WebGL fallback), activities, no console errors, no horizontal overflow at 1440 and 1280,
 * and rough 3D timings (time to first draw, frame time while rotating).
 * Run with the dev server on 5199: node scripts/smoke-powersys-gen-control.mjs
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
const PAGE = '#/subjects/power-systems/gen-control'
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const wait = (ms = 400) => page.waitForTimeout(ms)
const go = async (h, ms = 1500) => {
  await page.goto(URL + h)
  await wait(ms)
}
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const text = (sel) => page.locator(sel).first().innerText()
const main = () => page.locator('main').innerText()
const acts = async () => (await page.locator('.ps-acts summary').innerText()).replace(/\s+/g, ' ')
const noBad = async (where) => check(!/NaN|undefined|Infinity/.test(await main()), `${where}: no NaN / undefined / Infinity on screen`)
const slider = (label) => page.locator('.ps-slider', { hasText: label }).locator('input')
const cmpText = () => text('.ps-gc-compare')

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── subject page ─────────────────────────────────────────────────────────────
console.log('── Subject page')
await go('#/subjects/power-systems')
const card = await page.locator('.subject-topic-card', { hasText: 'Generator & Frequency Control' }).innerText()
check(/Interactive module/.test(card), 'Module 12 is listed as an interactive module')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
const t0 = Date.now()
await page.goto(URL + PAGE)
await page.locator('.ps3 canvas').first().waitFor({ timeout: 15000 })
await page.locator('.ps3-label').first().waitFor({ state: 'visible', timeout: 15000 })
const firstDraw = Date.now() - t0
check((await page.locator('main h1').first().innerText()) === 'Generator & Frequency Control', 'module heading')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'five modes')
check(/Step 1 of 9/i.test(await text('.ps-stepper')), 'the story has nine steps')
check(/why does the frequency fall everywhere/.test(await text('.ps-step-body')), 'step 1 opens with the real-world question')
check(/GATE EE Section 6/.test(await text('.ps-step-body')) && /BEEE402L/.test(await text('.ps-step-body')), 'step 1 states the syllabus relevance (from the syllabus data)')
await page.screenshot({ path: OUT + 'gc-learn-1.png', fullPage: true })
const next = async () => {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(350)
}
await next()
check(/−0\.500 Hz\/s/.test(await text('.ps-step-body')), 'step 2: RoCoF(0) = −0.1 × 50 / (2 × 5) = −0.500 Hz/s')
await next()
check(/ΔP_tie12 = −0\.0\d{3} pu/.test(await text('.ps-step-body')), 'step 3: the tie flow at t = 1 s is negative (area 2 sends)')
await next()
check(/−0\.299/.test(await text('.ps-step-body')) && /−0\.174/.test(await text('.ps-step-body')), 'step 4: nadirs −0.299 Hz (area 1) and −0.174 Hz (area 2)')
await next()
const s5 = await text('.ps-step-body')
check(/−0\.1190 Hz/.test(s5) && /−0\.0500 pu/.test(s5) && /0\.0476 pu/.test(s5), 'step 5: Δf = −0.1190 Hz, ΔP_tie12 = −0.0500 pu, each governor +0.0476 pu')
check((await page.locator('.ps-step-body .ps-check--ok').count()) === 1, 'step 5: the closed form agrees with the simulation')
await next()
check(/−0\.1000 pu/.test(await text('.ps-step-body')) && /0\.0000 pu/.test(await text('.ps-step-body')), 'step 6: ACE₁ = −0.1000 pu, ACE₂ = 0')
await next()
check(/Δf after 60 s\s*[−]?0\.000\d/i.test(await text('.ps-step-body')), 'step 7: with AGC Δf returns to ≈ 0')
await next()
check(/0\.0909 pu/.test(await text('.ps-step-body')) && (await page.locator('svg.ps-gc-avr').count()) === 1, 'step 8: AVR e_ss = 1/(1 + 10) = 0.0909 pu, with its block diagram')
await next()
check(/K < 12\.16/.test(await text('.ps-step-body')) && (await page.locator('.ps-step-body .ps-check--ok').count()) === 1, 'step 9: Routh limit K < 12.16, simulation agrees')
await page.screenshot({ path: OUT + 'gc-learn-9.png', fullPage: true })
check(/1 of 6/.test(await acts()), 'finishing the story completes an activity')
check(await noOverflow(), 'Learn: no horizontal overflow')
await page.getByRole('button', { name: 'Explore the two areas →' }).click()
await wait(1500)
check((await page.evaluate(() => location.hash)) === PAGE + '?mode=explore', 'the story leads on to Explore')

// ── Explore · two areas ──────────────────────────────────────────────────────
console.log('── Explore · two areas')
check((await page.locator('.ps3 canvas').count()) === 1, '3D canvas present')
let cmp = await cmpText()
check(/Δf₁\s*−0\.1190 Hz\s*−0\.1190 Hz/.test(cmp), 'closed form and simulation side by side: Δf = −0.1190 Hz')
check(/ΔP_tie12\s*−0\.0500 pu\s*−0\.0500 pu/.test(cmp), 'ΔP_tie12 = −0.0500 pu in both')
check(/Initial RoCoF, area 1\s*−0\.500 Hz\/s\s*−0\.500 Hz\/s/.test(cmp), 'initial RoCoF −0.500 Hz/s in both')
await noBad('Explore')
// select a part from the keyboard part list → info panel with live values
await page.locator('.ps3-part', { hasText: 'Area 1 · frequency' }).click()
await wait(400)
let info = await text('.ps3-info')
check(/Area 1 · frequency/.test(info) && /−0\.1190 Hz/.test(info), 'part list selects Area 1 · frequency; its info panel shows Δf = −0.1190 Hz')
await page.screenshot({ path: OUT + 'gc-explore-3d.png', fullPage: true })
// a parameter change, synchronised in the 3D info panel and the 2D diagram
await slider('Load step ΔP_L').fill('0.2')
await wait(700)
info = await text('.ps3-info')
check(/−0\.2381 Hz/.test(info), 'ΔP_L = 0.2 pu: the 3D info panel updates to Δf = −0.2381 Hz')
check(/Δf₁\s*−0\.2381 Hz\s*−0\.2381 Hz/.test(await cmpText()), 'and the closed-form/simulated table to −0.2381 Hz')
await page.locator('.ps3-toolbar').getByRole('radio', { name: '2D diagram' }).click()
await wait(500)
const svg2d = await page.locator('.ps3-fallback svg.ps-gc-diagram').textContent()
check(/−0\.2381 Hz/.test(svg2d) && /−0\.1000 pu/.test(svg2d), '2D block diagram shows the same model: Δf −0.2381 Hz, ΔP_tie12 −0.1000 pu')
await page.screenshot({ path: OUT + 'gc-explore-2d.png', fullPage: true })
await page.locator('.ps3-toolbar').getByRole('radio', { name: '3D' }).click()
await wait(700)
check((await page.locator('.ps3 canvas').count()) === 1, '3D view restored')
// reset
await page.locator('.ps-gc-primary').getByRole('button', { name: 'Reset' }).click()
await wait(600)
check(/Δf₁\s*−0\.1190 Hz/.test(await cmpText()), 'Reset restores ΔP_L = 0.1 pu (Δf −0.1190 Hz)')
// load step in area 2 reverses the tie flow
await page.locator('.ps-gc-primary').getByRole('radio', { name: 'Area 2' }).click()
await wait(600)
check(/ΔP_tie12\s*0\.0500 pu\s*0\.0500 pu/.test(await cmpText()), 'the same step in area 2: ΔP_tie12 = +0.0500 pu (area 1 → area 2)')
await page.locator('.ps-gc-primary').getByRole('radio', { name: 'Area 1' }).click()
await wait(400)
// no disturbance
await slider('Load step ΔP_L').fill('0')
await wait(500)
check(/No disturbance/.test(await main()), 'ΔP_L = 0: a clear “No disturbance” message')
await noBad('No disturbance')
await page.locator('.ps-gc-primary').getByRole('button', { name: 'Reset' }).click()
await wait(400)
// an unstable state: a stiff tie line with these lags
await page.locator('summary', { hasText: 'Area settings' }).click()
await wait(200)
await slider('Tie-line coefficient').fill('0.2')
await wait(800)
check(/Unstable: the oscillation grows/.test(await main()), 'T₁₂ = 0.2 pu/rad: the growing inter-area oscillation is reported as unstable')
check(/— \(growing\)/.test(await cmpText()), 'and simulated steady values are not shown as if reached')
await noBad('Unstable LFC')
await page.screenshot({ path: OUT + 'gc-explore-unstable.png', fullPage: true })
await page.locator('.ps-gc-primary').getByRole('button', { name: 'Reset' }).click()
await wait(500)
// playback and scrubbing
await page.getByRole('button', { name: 'Play the response' }).click()
await wait(600)
const n1 = await text('.ps-gc-now')
await wait(500)
const n2 = await text('.ps-gc-now')
check(n1 !== n2 && /^t = \d/.test(n2), `Play moves the time shown (${n1.split(' ·')[0]} → ${n2.split(' ·')[0]})`)
await page.getByRole('button', { name: 'Pause' }).click()
await wait(300)
const n3 = await text('.ps-gc-now')
await wait(400)
check(n3 === (await text('.ps-gc-now')), 'Pause holds it')
await page.locator('.ps-gc-scrub input').fill('1')
await wait(400)
check(/^t = 1\.00 s/.test(await text('.ps-gc-now')), 'the time slider moves to t = 1.00 s')
await page.locator('.ps3-part', { hasText: 'Tie line' }).click()
await wait(300)
check(/t = 1\.00 s/.test(await text('.ps3-info')) && /area 2 → area 1/.test(await text('.ps3-info')), 'the tie-line info panel follows the time shown (t = 1.00 s, area 2 → area 1)')
// 3D controls
await page.locator('.ps3-toolbar').getByRole('button', { name: 'Reset view' }).click()
await page.locator('.ps3-toolbar').getByRole('button', { name: 'Fit' }).click()
await page.locator('.ps3-toolbar').getByRole('button', { name: 'Zoom in' }).click()
await wait(800)
check((await page.locator('.ps3 canvas').count()) === 1, 'Reset view / Fit / zoom work without error')
// guided tour
await page.locator('.ps3-toolbar').getByRole('button', { name: 'Guided tour' }).click()
await wait(500)
check(/Tour · 1 of 5/i.test(await text('.ps3-tour')), 'guided tour starts (1 of 5)')
for (let k = 0; k < 4; k++) {
  await page.locator('.ps3-tour').getByRole('button', { name: 'Next →' }).click()
  await wait(350)
}
check(/Tour · 5 of 5/i.test(await text('.ps3-tour')), 'tour Next reaches step 5 of 5')
await page.locator('.ps3-tour').getByRole('button', { name: 'Replay' }).click()
await wait(400)
check(/Tour · 1 of 5/i.test(await text('.ps3-tour')), 'Replay returns to step 1')
await page.locator('.ps3-tour').getByRole('button', { name: 'Close tour' }).click()
// AGC on
await page.locator('.ps-gc-primary').getByLabel('AGC (both areas)').check()
await wait(800)
cmp = await cmpText()
check(/Δf₁\s*0\.0000 Hz\s*[−]?0\.000\d Hz/.test(cmp) && /ΔP_m1\s*0\.1000 pu\s*0\.099\d pu|ΔP_m1\s*0\.1000 pu\s*0\.1000 pu/.test(cmp), 'AGC on: Δf → 0 and ΔP_m1 → ΔP_L1 = 0.1 pu')
check(/2 of 6/.test(await acts()), 'running AGC completes the Explore activity')
// frame time while rotating
const box = await page.locator('.ps3-canvas-host').boundingBox()
await page.evaluate(() => {
  window.__gcFrames = []
  let last = performance.now()
  const loop = (t) => {
    window.__gcFrames.push(t - last)
    last = t
    if (window.__gcFrames.length < 400) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
})
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
const tRot = Date.now()
let kk = 0
while (Date.now() - tRot < 2000) {
  await page.mouse.move(box.x + box.width / 2 + 200 * Math.sin(kk / 10), box.y + box.height / 2 + 30 * Math.cos(kk / 13))
  kk++
}
await page.mouse.up()
const frames = await page.evaluate(() => window.__gcFrames.slice(5))
frames.sort((a, b) => a - b)
const median = frames[Math.floor(frames.length / 2)] ?? NaN
const p95 = frames[Math.floor(frames.length * 0.95)] ?? NaN
check(Number.isFinite(median), `rotating: ${frames.length} frames, median ${median.toFixed(1)} ms, 95th percentile ${p95.toFixed(1)} ms`)
check(await noOverflow(), 'Explore: no horizontal overflow at 1440')
await page.setViewportSize({ width: 1280, height: 860 })
await wait(500)
check(await noOverflow(), 'Explore: no horizontal overflow at 1280')
await page.screenshot({ path: OUT + 'gc-explore-1280.png', fullPage: true })
await page.setViewportSize({ width: 1440, height: 900 })

// ── Explore · AVR ────────────────────────────────────────────────────────────
console.log('── Explore · AVR')
await page.getByRole('radio', { name: 'Voltage: the AVR loop' }).click()
await wait(600)
check((await page.locator('svg.ps-gc-avr').count()) === 1, 'the AVR block diagram is shown')
let avr = await main()
check(/0\.0909/.test(avr) && /12\.16/.test(avr) && /Stable by Routh · simulation: decays/.test(avr), 'K_A = 10: e_ss = 0.0909 pu, Routh limit 12.16, stable and decaying')
await slider('Amplifier gain K_A').fill('15')
await wait(700)
avr = await main()
check(/Unstable: the voltage oscillation grows/.test(avr) && /Unstable by Routh · simulation: grows/.test(avr), 'K_A = 15: unstable by Routh and in the simulation (labelled)')
check(/2 roots of the characteristic equation are in the right half plane/.test(avr), 'Routh: two right-half-plane roots')
check(
  (await page.locator('.ps-plot-ref + text', { hasText: 'growing: stopped here' }).count()) + (/growing: stopped here/.test(await page.locator('.ps-plot').first().textContent()) ? 1 : 0) >= 1,
  'the growing response is stopped at the display bound and marked',
)
await noBad('Unstable AVR')
check(/3 of 6/.test(await acts()), 'pushing K_A past the limit completes the AVR activity')
await page.screenshot({ path: OUT + 'gc-explore-avr.png', fullPage: true })
await page.locator('.ps-gc-side').getByRole('button', { name: 'Reset' }).click()
await wait(400)
check(/Stable by Routh/.test(await main()), 'Reset restores K_A = 10')
// engineer level shows the advanced settings expanded
await page.evaluate(() => localStorage.setItem('pel.prefs', JSON.stringify({ level: 'engineer' })))
await go(PAGE + '?mode=explore')
await page.reload()
await wait(1500)
check((await page.locator('#gc-eng').count()) === 1, 'Engineer level: governor/turbine, bias and per-area AGC settings appear')
await page.screenshot({ path: OUT + 'gc-explore-engineer.png', fullPage: true })
await page.evaluate(() => localStorage.setItem('pel.prefs', JSON.stringify({ level: 'beginner' })))
await page.reload()
await wait(1000)

// ── leave and re-enter the module twice ──────────────────────────────────────
console.log('── Re-entering')
const errBefore = errors.length
for (let k = 0; k < 2; k++) {
  await go('#/subjects/power-systems/grid', 900)
  await go(PAGE + '?mode=explore', 1500)
}
check((await page.locator('.ps3 canvas').count()) === 1 && errors.length === errBefore, 'leaving and re-entering twice: the scene is back, no console error')

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await go(PAGE + '?mode=experiment')
check((await page.locator('.ps-gc-exp-item').count()) === 5, 'five experiments')
check((await page.locator('.ps-table').count()) === 0, 'no answer before a prediction')
await page.locator('.ps-option', { hasText: 'More power flows from area 2 into area 1' }).click()
await wait(600)
check(/Your prediction was right/.test(await text('.ps-predict')), 'tie direction: the prediction is judged from the computed runs')
check(/−0\.0500 pu/.test(await text('.ps-predict')), 'and explained with ΔP_tie12 = −0.0500 pu')
check((await page.locator('.ps-table').count()) === 1 && (await page.locator('.ps-plot').count()) === 2, 'then the comparison plots and table')
await page.locator('.ps-gc-exp-item', { hasText: 'Switch on AGC' }).click()
await wait(600)
await page.locator('.ps-option', { hasText: 'Back at exactly 50 Hz' }).click()
await wait(500)
check(/Your prediction was right/.test(await text('.ps-predict')), 'AGC: Δf → 0 decided from the runs')
await page.locator('.ps-gc-exp-item', { hasText: 'A stiffer tie line' }).click()
await wait(600)
await page.locator('.ps-option', { hasText: 'It builds up faster and swings back and forth more' }).click()
await wait(600)
const stiffWhy = await text('.ps-predict')
const stiffTable = await text('.ps-table')
check(/Your prediction was right/.test(stiffWhy), 'stiffer tie: the answer comes from rise time and overshoot')
check(/rises monotonically/.test(stiffWhy) && /−0\.0500 pu in both cases/.test(stiffWhy), 'T₁₂ = 0.01 is reported as monotonic; the final value −0.0500 pu (closed form) is the same for both')
check(
  /none — rises monotonically/.test(stiffTable) && /First tie-flow peak at\s*none — rises monotonically\s*1\.20 s/.test(stiffTable),
  'the table: no first peak for T₁₂ = 0.01, a first peak at 1.20 s for T₁₂ = 0.08',
)
check(!/20\.00 s/.test(stiffWhy + stiffTable), 'no end-of-run time is passed off as a peak')
await page.screenshot({ path: OUT + 'gc-experiment-stiff.png', fullPage: true })
await page.locator('.ps-gc-exp-item', { hasText: 'Turn up the AVR gain' }).click()
await wait(600)
await page.locator('.ps-option', { hasText: 'Smaller error and a better-damped response' }).click()
await wait(500)
check(/Not quite/.test(await text('.ps-predict')) && /0\.0800 pu/.test(await text('.ps-predict')), 'AVR gain: a wrong prediction is corrected with the computed trade-off (e_ss 0.0800 pu)')
check(/4 of 6/.test(await acts()), 'three experiments complete the activity')
await noBad('Experiment')
await page.screenshot({ path: OUT + 'gc-experiment.png', fullPage: true })

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await go(PAGE + '?mode=verify')
check((await page.locator('.ps-check--ok').count()) === 6 && (await page.locator('.ps-check--bad').count()) === 0, 'all six hand checks agree with the simulations')
const ans = page.locator('.ps-num-answer input')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(200)
check(/Enter a number in MW first/.test(await text('.ps-q')), 'an empty answer is explained, not judged')
await ans.fill('100')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/Not yet/.test(await text('.ps-q')) && /OTHER area/.test(await text('.ps-q')), 'a wrong answer shows the usual mistake')
await ans.fill('50')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/✓ Correct/.test(await text('.ps-quiz')), 'your turn: 50 MW from area 2 is accepted')
check(/5 of 6/.test(await acts()), 'Verify completes its activity')
await noBad('Verify')
check(await noOverflow(), 'Verify: no horizontal overflow')
await page.screenshot({ path: OUT + 'gc-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await go(PAGE + '?mode=practise')
check((await page.locator('.ps-quiz-list > li').count()) === 8, 'eight practice questions')
const levels = await page.locator('.ps-q-level').allInnerTexts()
check(
  ['Concept', 'Numerical', 'University-style', 'GATE-style'].every((l) => levels.includes(l)),
  `levels concept → GATE-style (${[...new Set(levels)].join(', ')})`,
)
const q3 = page.locator('.ps-q', { hasText: 'H = 4 s' })
await q3.locator('input').fill('−0.3125')
await q3.getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/✓ Correct/.test(await q3.innerText()), 'RoCoF question: −0.3125 Hz/s accepted (typographic minus)')
await noBad('Practise')
await page.screenshot({ path: OUT + 'gc-practise.png', fullPage: true })

// ── WebGL unavailable ────────────────────────────────────────────────────────
console.log('── WebGL fallback')
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p2 = await ctx2.newPage()
const err2 = []
p2.on('pageerror', (e) => err2.push(String(e)))
p2.on('console', (m) => m.type() === 'error' && err2.push(m.text()))
await p2.addInitScript(() => {
  HTMLCanvasElement.prototype.getContext = () => null
})
await p2.goto(URL + PAGE + '?mode=explore')
await p2.waitForTimeout(1800)
check((await p2.locator('.ps3-fallback svg.ps-gc-diagram').count()) === 1, 'without WebGL the 2D block diagram is shown')
check(/3D is not available in this browser/.test(await p2.locator('main').innerText()), 'with the message that 3D is unavailable')
check((await p2.locator('.ps3 canvas').count()) === 0, 'and no canvas is created')
await p2.screenshot({ path: OUT + 'gc-nowebgl.png', fullPage: true })
check(err2.length === 0, `fallback: no console errors${err2.length ? `: ${err2.slice(0, 2).join(' | ')}` : ''}`)
await ctx2.close()

console.log(`\n3D timings: first draw ${firstDraw} ms (navigation → canvas and labels); rotating ${frames.length} frames, median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`)
check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
process.exit(failures.length ? 1 : 0)
