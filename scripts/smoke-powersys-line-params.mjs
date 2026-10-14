/**
 * Power Systems · Module 8 — Transmission-Line Parameters in the browser: every mode, key computed numbers, the 3D
 * tower (canvas, reset/fit, part list + info panel, guided tour, 3D↔2D, timings), the 2D cross-section editor
 * (keyboard move, invalid geometry), the hand-off to Module 2, activities, no console errors, no horizontal overflow
 * at 1440 and 1280, leaving and re-entering, and the WebGL fallback.
 * Run with the dev server on 5199: node scripts/smoke-powersys-line-params.mjs
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
const MOD = '#/subjects/power-systems/line-params'
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
const acts = async () => (await text('.ps-acts summary')).replace(/\s+/g, ' ')
const results = async () => (await page.locator('section[aria-labelledby="lp-res"]').first().innerText()).replace(/\s+/g, ' ')
const panel = () => page.locator('.ps3-side')
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).click()
  await wait(700)
}

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── page ─────────────────────────────────────────────────────────────────────
console.log('── Module page')
await go(MOD)
check((await text('main h1')) === 'Transmission-Line Parameters', 'the module opens (status ready)')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'all five modes')
check(/0 of 6/.test(await acts()), 'six activities, none done')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
check(/Step 1 of 7/i.test(await text('.ps-stepper')), 'the explanation has seven steps')
check(/Why do towers hold their conductors/.test(await text('.ps-step-body')), 'step 1 opens with the real-world question')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
check((await page.locator('.ps3 canvas').count()) === 1, 'step 1 shows the 3D tower')
await panel().getByRole('button', { name: 'Insulator strings' }).click()
await wait()
check(/discs/.test(await panel().innerText()), 'selecting a part explains what it does')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
check(/Ω\/km per phase/.test(await text('.lp-learn')) && /✓/.test(await text('.lp-learn-visual')), 'resistance worked example, checked against the model')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
check(/mH\/km/.test(await text('.lp-learn-visual')) && /illustration/.test(await text('.lp-learn-visual')), 'inductance: flux-linkage illustration (labelled) and single-phase example')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
check(/1\.4041 mH\/km/.test(await text('.lp-learn-visual')) && /✓/.test(await text('.lp-learn-visual')), 'three-phase flat line, single conductors: L = 1.4041 mH/km, matrix-checked')
for (let k = 0; k < 3; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(300)
}
check(/From L and C/.test(await text('.ps-step-title')), 'the explanation ends with X, B, Z_c and SIL')
check(/Double-circuit lines .* not modelled/.test(await text('.ps-step-body')), 'double circuits are stated as not covered')
check(/1 of 6/.test(await acts()), 'finishing the explanation completes an activity')
check(await noOverflow(), 'no horizontal overflow (Learn)')
await page.screenshot({ path: OUT + 'lp-learn.png', fullPage: true })
await page.getByRole('button', { name: /Design your own line/ }).click()
await wait(900)
check((await hash()) === MOD + '?mode=explore', 'Learn leads on to Explore')

// ── Explore: 3D ──────────────────────────────────────────────────────────────
console.log('── Explore · 3D tower')
const t0 = Date.now()
await go(MOD + '?mode=explore')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const firstDraw = Date.now() - t0
await page.locator('summary', { hasText: 'All results' }).click()
let ro = await results()
check(/1\.0448/.test(ro) && /11\.160/.test(ro) && /523/.test(ro), 'default 400 kV twin flat line: L 1.0448 mH/km, C 11.160 nF/km, SIL 523 MW')
check(/0\.3282/.test(ro) && /3\.506/.test(ro) && /306\.0/.test(ro) && /13\.86/.test(ro), 'X 0.3282 Ω/km, B 3.506 µS/km, Z_c 306.0 Ω, GMD 13.86 m')
await page.getByRole('button', { name: 'Reset view' }).click()
await page.getByRole('button', { name: 'Fit' }).click()
await wait(800)
await panel().getByRole('button', { name: 'Phase b conductor' }).click()
await wait()
let info = (await panel().innerText()).replace(/\s+/g, ' ')
check(/GMR \(bundle\) 74\.6 mm/.test(info) && /1\.0448 mH\/km/.test(info), 'phase b info panel: GMR 74.6 mm, L 1.0448 mH/km')
// a parameter change, synchronised in the info panel and the results
await page.locator('.ps-card', { hasText: 'The cross-section' }).getByRole('radio', { name: '1', exact: true }).click()
await wait()
info = (await panel().innerText()).replace(/\s+/g, ' ')
ro = await results()
check(/1\.4041 mH\/km/.test(info) && /1\.4041/.test(ro), 'one conductor per phase: L 1.4041 mH/km in the info panel and the results')
check(/You changed: Sub-conductors per phase 2 → 1/.test(ro), 'the results say what changed and why')
await page.locator('.ps-card', { hasText: 'The cross-section' }).getByRole('radio', { name: '2', exact: true }).click()
await wait()
// guided tour
await page.getByRole('button', { name: 'Guided tour' }).click()
await wait()
check(/Tour · 1 of 5/i.test(await panel().innerText()), 'guided tour starts')
for (let k = 0; k < 4; k++) {
  await panel().getByRole('button', { name: 'Next →' }).click()
  await wait(250)
}
check(/What it all adds up to/.test(await panel().innerText()), 'the tour reaches its last step')
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
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'lp-explore-3d.png' })

// ── Explore: arrangements ────────────────────────────────────────────────────
console.log('── Explore · arrangements')
await page.getByRole('radio', { name: 'Vertical', exact: true }).click()
await wait(600)
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'lp-vertical-3d.png' })
await page.getByRole('radio', { name: 'Triangular', exact: true }).click()
await wait(600)
ro = await results()
check(/GMD 11\.00 m/i.test(ro), 'triangular (equilateral) arrangement: GMD equals the spacing, 11.00 m')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'lp-triangular-3d.png' })
check(/2 of 6/.test(await acts()), 'all three arrangements completes an activity')

// ── Explore: 2D editor ───────────────────────────────────────────────────────
console.log('── Explore · 2D cross-section editor')
await page.getByRole('radio', { name: 'Horizontal', exact: true }).click()
await wait(400)
await page.getByRole('radio', { name: '2D diagram' }).click()
await wait(400)
check((await page.locator('.ps3 .lp-xs svg').count()) === 1, '3D → 2D: the cross-section editor')
const xs = await text('.ps3 .lp-xs')
check(/Dab 11\.00 m/.test(xs) && /Dca 22\.00 m/.test(xs) && /GMR 74\.6 mm/.test(xs), '2D shows D_ab 11.00 m, D_ca 22.00 m and the bundle GMR 74.6 mm')
await page.locator('.lp-handle').first().focus()
await page.keyboard.press('Shift+ArrowRight')
await wait(300)
check(/Dab 10\.00 m/.test(await text('.ps3 .lp-xs')), 'keyboard: Shift+→ moves phase a 1 m (D_ab 10.00 m)')
check((await page.getByRole('radio', { name: 'Custom' }).count()) === 1, 'moving a phase makes the arrangement custom')
await page.getByRole('radio', { name: 'GMD spacings' }).click()
await page.getByLabel('Show image conductors').check()
await wait(300)
check((await page.locator('.lp-image').count()) === 3, 'image conductors drawn below the ground')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'lp-explore-2d.png' })
await page.getByRole('radio', { name: '3D' }).click()
await wait(500)
check((await page.locator('.ps3 canvas').count()) === 1, '2D → 3D again')
// invalid geometry through the numeric inputs
await page.locator('summary', { hasText: 'Exact positions' }).click()
await page.getByLabel('Phase a x [m]').fill('0.4')
await wait(400)
check(/not physically possible/.test(await page.locator('.ps-panel').innerText()), 'phases too close: a clear message')
check((await page.locator('section[aria-labelledby="lp-res"]').count()) === 0, '… and no results')
check(await page.getByRole('button', { name: 'Use these constants in Module 2' }).isDisabled(), '… and nothing can be sent to Module 2')
await page.getByLabel('Phase a x [m]').fill('-11')
await page.getByLabel('Phase a height [m]').fill('0.1')
await wait(400)
check(/below the ground/.test(await page.locator('.ps-panel').innerText()), 'conductor below the ground: a clear message')
await page.screenshot({ path: OUT + 'lp-invalid.png', fullPage: true })
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(400)
check(/1\.0448/.test(await results()), 'Reset restores the default line')
// untransposed
await page.getByRole('checkbox', { name: 'Transposed' }).uncheck()
await wait(400)
const untr = await page.locator('.ps-card', { hasText: 'Not transposed: each phase is different' }).innerText()
check(/0\.9985/.test(untr) && /1\.0678/.test(untr), 'untransposed: phase b 0.9985, outer phases 1.0678 mH/km')
await page.getByRole('checkbox', { name: 'Transposed' }).check()
// hand-off
await page.getByRole('button', { name: 'Use these constants in Module 2' }).click()
await wait(400)
const sent = await page.evaluate(() => JSON.parse(localStorage.getItem('pel.powersys.line') ?? 'null'))
check(
  sent && Math.abs(sent.xOhmPerKm - 0.3282) < 1e-3 && Math.abs(sent.bUsPerKm - 3.506) < 1e-3 && sent.kv === 400 && sent.fHz === 50,
  `the constants reach Module 2's store (x ${sent?.xOhmPerKm?.toFixed(4)}, b ${sent?.bUsPerKm?.toFixed(3)})`,
)
check(/Offered to Module 2 \(this design\)/.test(await text('.lp-handoff')), 'the offered design is shown')
check((await page.locator('.lp-handoff a').getAttribute('href')) === '#/subjects/power-systems/three-phase?mode=explore', 'a link to Module 2')
check(/3 of 6/.test(await acts()), 'sending completes an activity')
check(await noOverflow(), 'no horizontal overflow (Explore)')
await page.screenshot({ path: OUT + 'lp-explore.png', fullPage: true })

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await tab('Experiment')
for (const name of ['Double the phase spacing', 'Use two sub-conductors per phase', 'Raise the line higher above the earth']) {
  await page.getByRole('button', { name }).click()
  await wait(300)
  await page.locator('.ps-predict .ps-option').first().click()
  await wait(400)
}
check((await page.locator('.ps-table').count()) === 1 && (await page.locator('.lp-exp-pair svg').count()) === 2, 'before/after cross-sections and the comparison table')
check(/−|\+/.test(await text('.ps-table')), 'the comparison shows the changes')
check(/4 of 6/.test(await acts()), 'three experiments complete an activity')
await page.getByRole('button', { name: 'Double the phase spacing' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: 'much less than double' }).click()
await wait(300)
check(/Your prediction was right/.test(await text('.ps-predict-result')) && /\+13\.3 %/.test(await text('.ps-predict-result')), 'doubling the spacing: L rises 13.3 % (decided from the computation)')
check(await noOverflow(), 'no horizontal overflow (Experiment)')
await page.screenshot({ path: OUT + 'lp-experiment.png', fullPage: true })

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await tab('Verify')
check((await page.locator('.ps-check--ok').count()) === 5 && (await page.locator('.ps-check--bad').count()) === 0, 'five hand calculations, all confirmed by a second method')
await page.locator('.ps-num-answer input').fill('1.0448')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/5 of 6/.test(await acts()), 'your-turn answer completes Verify')
check(await noOverflow(), 'no horizontal overflow (Verify)')
await page.screenshot({ path: OUT + 'lp-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await tab('Practise')
const EPS0 = 8.8541878128e-12
const rp = (r) => Math.exp(-0.25) * r
const gmd4 = Math.cbrt(4 * 4 * 8)
const nums = [
  4e-7 * Math.log(2 / rp(0.006)) * 1e6,
  gmd4,
  0.2 * Math.log(gmd4 / rp(0.01)),
  ((2 * Math.PI * EPS0) / Math.log(12 / Math.sqrt(0.015 * 0.4))) * 1e12,
  0.06 * (1 + 0.00403 * 55),
  0.2 * Math.log(2),
  Math.sqrt(1e-3 / 11e-9),
]
const choice = ['b', 'b', 'b', 'slightly larger']
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
check(/11 of 11 answered correctly/.test(await text('.ps-quiz')), 'all eleven questions answered correctly with independently computed answers')
check(/6 of 6/.test(await acts()), 'every activity complete')
check(
  (await page.locator('.ps-q-level').allInnerTexts()).some((t) => /GATE/.test(t)),
  'questions run from concept to GATE-style',
)
check(await noOverflow(), 'no horizontal overflow (Practise)')
await page.screenshot({ path: OUT + 'lp-practise.png', fullPage: true })

// ── a large conductor: every Verify check still holds ─────────────────────────
console.log('── Large conductor (25 mm, 0 °C)')
await tab('Explore')
await page.locator('summary', { hasText: 'Exact positions' }).click()
await page.locator('.ps-slider', { hasText: 'Conductor radius r' }).locator('input').fill('25')
await page.locator('.ps-slider', { hasText: 'Conductor temperature' }).locator('input').fill('0')
await wait(400)
await tab('Verify')
const vtext = await page.locator('.ps-panel').innerText()
check((await page.locator('.ps-check--bad').count()) === 0 && (await page.locator('.ps-check--ok').count()) === 5, 'r = 25 mm at 0 °C: all five checks still confirmed (no ✗)')
check(
  /neither estimate is close|high-frequency asymptote applies/.test(vtext) && /skin effect of this conductor is (large|noticeable)/.test(vtext),
  'the skin-effect wording comes from the computed ratio',
)
await page.screenshot({ path: OUT + 'lp-verify-large.png', fullPage: true })

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
  if (m === 'explore') await p2.screenshot({ path: OUT + 'lp-explore-1280.png', fullPage: true })
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
check((await p3.locator('.ps3 .lp-xs svg').count()) === 1 && (await p3.locator('.ps3 canvas').count()) === 0, 'no WebGL: the 2D cross-section is shown instead')
check(/1\.0448/.test((await p3.locator('section[aria-labelledby="lp-res"]').innerText()).replace(/\s+/g, ' ')), 'no WebGL: results still computed')
await p3.screenshot({ path: OUT + 'lp-nowebgl.png', fullPage: true })
await ctx3.close()

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed')
process.exit(failures.length ? 1 : 0)
