/**
 * Power Systems · Module 10 — Underground Cables in the browser: every mode, key computed numbers (checked against
 * formulas written out here), the 3D cable (canvas, reset/fit, layers hidden and shown, part list + info panel, the
 * probe moving with its value in the 3D info panel and the 2D plot, assembled/stepped, guided tour, 3D↔2D, timings),
 * an invalid cable, grading, activities, no console errors, no horizontal overflow at 1440 and 1280, leaving and
 * re-entering, and the WebGL fallback.
 * Run with the dev server on 5199: node scripts/smoke-powersys-cables.mjs
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
const MOD = '#/subjects/power-systems/cables'
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
const squash = (s) => s.replace(/\s+/g, ' ')
const acts = async () => squash(await text('.ps-acts summary'))
const results = async () => squash(await page.locator('section[aria-labelledby="cb-res"]').first().innerText())
const panel = () => page.locator('.ps3-side')
const slider = (label) => page.locator('.ps-slider', { hasText: label }).first().locator('input')
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).click()
  await wait(700)
}
const f = (x, d) => x.toFixed(d)

// the formulas, written out independently of the app
const EPS0 = 8.8541878128e-12
const g = (V, x, r, R) => V / (x * Math.log(R / r))
const pot = (V, x, r, R) => (V * Math.log(R / x)) / Math.log(R / r)
const cUfKm = (eps, r, R) => ((2 * Math.PI * EPS0 * eps) / Math.log(R / r)) * 1e9

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── page ─────────────────────────────────────────────────────────────────────
console.log('── Module page')
await go(MOD)
check((await text('main h1')) === 'Underground Cables', 'the module opens (status ready)')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'all five modes')
check(/0 of 6/.test(await acts()), 'six activities, none done')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
check(/Step 1 of 8/i.test(await text('.ps-stepper')), 'the explanation has eight steps')
check(/Why can’t we just bury an overhead-line conductor/.test(await text('.ps-step-body')), 'step 1 opens with the real-world question')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
check((await page.locator('.ps3 canvas').count()) === 1, 'step 1 shows the 3D cable')
await panel().getByRole('button', { name: 'Metallic sheath' }).click()
await wait()
check(/moisture/.test(await panel().innerText()), 'selecting a part explains what it does')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
check(/illustration/.test(await text('.cb-learn-visual')) && /Belted/.test(await text('.ps-step-body')), 'cable types: a labelled illustration')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(300)
const gmax0 = g(38.1, 1, 1, 2.2)
check(new RegExp(`${f(gmax0, 2)} kV/cm`).test(await text('.cb-learn-visual')) && /✓/.test(await text('.cb-learn-visual')), `field step: g_max ${f(gmax0, 2)} kV/cm, checked by a second method`)
check(/Equipotentials/.test(await text('.cb-learn-visual')), '… with the calculated equipotentials')
for (let k = 0; k < 5; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(300)
}
check(/Three-core belted/.test(await text('.ps-step-title')), 'the explanation ends with the three-core cable')
check((await page.locator('.cb-learn-visual .ps-check--bad').count()) === 0, 'no ✗ in Learn')
check(/1 of 6/.test(await acts()), 'finishing the explanation completes an activity')
check(await noOverflow(), 'no horizontal overflow (Learn)')
await page.screenshot({ path: OUT + 'cables-learn.png', fullPage: true })
await page.getByRole('button', { name: /Explore the cable/ }).click()
await wait(900)
check((await hash()) === MOD + '?mode=explore', 'Learn leads on to Explore')

// ── Explore: 3D ──────────────────────────────────────────────────────────────
console.log('── Explore · 3D cable')
const t0 = Date.now()
await go(MOD + '?mode=explore')
await page.waitForSelector('.ps3 canvas', { timeout: 8000 })
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const firstDraw = Date.now() - t0
let ro = await results()
const c0 = cUfKm(2.3, 1, 2.2)
check(
  new RegExp(f(gmax0, 2)).test(ro) && new RegExp(f(g(38.1, 2.2, 1, 2.2), 2)).test(ro) && new RegExp(f(c0, 4)).test(ro),
  `default cable: g_max ${f(gmax0, 2)}, g_min ${f(g(38.1, 2.2, 1, 2.2), 2)} kV/cm, C ${f(c0, 4)} µF/km`,
)
await page.getByRole('button', { name: 'Reset view' }).click()
await page.getByRole('button', { name: 'Fit' }).click()
await wait(800)
await panel().getByRole('button', { name: 'Insulation (dielectric)' }).click()
await wait()
let info = squash(await panel().innerText())
const xp0 = 1 + 0.3 * 1.2
check(
  info.includes(`${f(g(38.1, xp0, 1, 2.2), 2)} kV/cm`) && info.includes(`${f(pot(38.1, xp0, 1, 2.2), 2)} kV`),
  `insulation info panel: probe at ${f(xp0 * 10, 1)} mm, g ${f(g(38.1, xp0, 1, 2.2), 2)} kV/cm, V ${f(pot(38.1, xp0, 1, 2.2), 2)} kV`,
)
// move the probe: the 3D info panel and the 2D plot follow
await slider('Probe radius x').fill('20')
await wait()
info = squash(await panel().innerText())
const plotText = squash(await page.locator('section[aria-labelledby="cb-across"]').innerText())
const svgText = await page.locator('section[aria-labelledby="cb-across"] svg').first().textContent()
check(info.includes(`${f(g(38.1, 2, 1, 2.2), 2)} kV/cm`), `probe moved to 20 mm: info panel g ${f(g(38.1, 2, 1, 2.2), 2)} kV/cm`)
check(svgText.includes(`probe: ${f(g(38.1, 2, 1, 2.2), 2)} kV/cm`) || plotText.includes(f(g(38.1, 2, 1, 2.2), 2)), '… and the 2D stress plot marks the probe with the same value')
check((await page.locator('.ps3-label', { hasText: `g ${f(g(38.1, 2, 1, 2.2), 2)} kV/cm` }).count()) === 1, '… and the 3D probe label shows it')
// probe activity: from conductor to sheath
await slider('Probe radius x').fill('10')
await wait(200)
await slider('Probe radius x').fill('22')
await wait(300)
check(/2 of 6/.test(await acts()), 'moving the probe from conductor to sheath completes an activity')
// a parameter change: R = 30 mm
await slider('Sheath radius R').fill('30')
await wait()
ro = await results()
info = squash(await panel().innerText())
const g30 = g(38.1, 1, 1, 3)
check(new RegExp(f(g30, 2)).test(ro) && info.includes(`${f(g30, 2)} kV/cm`), `R = 30 mm: g_max ${f(g30, 2)} kV/cm in the results and the info panel`)
check(/You changed: Sheath radius R 22\.0 → 30\.0 mm/.test(ro), 'the results say what changed and why')
// layers hidden and shown
await page.locator('.cb-layers').getByLabel('Armour').uncheck()
await wait()
check((await panel().getByRole('button', { name: 'Armour' }).count()) === 0, 'hiding the armour removes it from the scene and the part list')
await page.locator('.cb-layers').getByLabel('Armour').check()
await wait()
check((await panel().getByRole('button', { name: 'Armour' }).count()) === 1, 'showing it again brings it back')
// stepped view
await page.getByRole('radio', { name: /Stepped/ }).click()
await wait(600)
check((await page.locator('.ps3 canvas').count()) === 1 && (await page.locator('.ps3-label', { hasText: 'Sheath' }).count()) >= 1, 'stepped view: each layer exposed and labelled')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'cables-stepped-3d.png' })
await page.getByRole('radio', { name: /Assembled/ }).click()
await wait(600)
// guided tour
await page.getByRole('button', { name: 'Guided tour' }).click()
await wait()
check(/Tour · 1 of 5/i.test(await panel().innerText()), 'guided tour starts')
for (let k = 0; k < 4; k++) {
  await panel().getByRole('button', { name: 'Next →' }).click()
  await wait(250)
}
check(/The probe/.test(await panel().innerText()), 'the tour reaches the probe')
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
  .screenshot({ path: OUT + 'cables-explore-3d.png' })

// ── Explore: 2D ──────────────────────────────────────────────────────────────
console.log('── Explore · 2D cross-section')
await page.getByRole('radio', { name: '2D diagram' }).click()
await wait(400)
const xs = squash(await text('.ps3 .cb-xs'))
check((await page.locator('.ps3 .cb-xs svg').count()) === 1, '3D → 2D: the cross-section')
const e80 = 3 * (1 / 3) ** 0.8 * 10
check(xs.includes(`80 % · ${f(0.8 * 38.1, 1)} kV at ${f(e80, 1)} mm`), `2D equipotential 80 % at ${f(e80, 1)} mm (R(r/R)^0.8)`)
check(xs.includes(`g = ${f(g(38.1, 3, 1, 3), 2)} kV/cm`), '2D probe value matches (probe at the sheath, 30 mm)')
await page
  .locator('.ps3')
  .first()
  .screenshot({ path: OUT + 'cables-explore-2d.png' })
await page.getByRole('radio', { name: '3D' }).click()
await wait(500)
check((await page.locator('.ps3 canvas').count()) === 1, '2D → 3D again')
// invalid cable
await slider('Conductor radius r').fill('35')
await wait(400)
check(/not physically possible/.test(await page.locator('.ps-panel').innerText()), 'r > R: a clear message')
check((await page.locator('section[aria-labelledby="cb-res"]').count()) === 0 && (await page.locator('.ps3 canvas').count()) === 0, '… and no results or scene')
check(!/NaN|Infinity|undefined/.test(await page.locator('.ps-panel').innerText()), '… and no NaN/Infinity on screen')
await page.screenshot({ path: OUT + 'cables-invalid.png', fullPage: true })
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await wait(500)
check(new RegExp(f(gmax0, 2)).test(await results()), 'Reset restores the default cable')
// grading
await page.locator('summary', { hasText: 'Grading the insulation' }).click()
await page.getByRole('button', { name: 'Place boundaries for equal peaks' }).click()
await wait(400)
const gtext = squash(await page.locator('details', { hasText: 'Grading the insulation' }).innerText())
const K = 38.1 / (Math.log(4 / 3) / 4 + Math.log(2.2 / (4 / 3)) / 3)
check(gtext.includes(f(K / 4, 2)) && /✓ All layers reach the same maximum/.test(gtext), `capacitance grading ε 4 | 3: equal peaks ${f(K / 4, 2)} kV/cm`)
check(/3 of 6/.test(await acts()), 'equal-peak grading completes an activity')
await page.getByRole('radio', { name: 'Intersheath grading' }).click()
await page.getByRole('button', { name: 'Set intersheath voltages for equal peaks' }).click()
await wait(300)
check(/✓ All layers reach the same maximum/.test(await page.locator('details', { hasText: 'Grading the insulation' }).innerText()), 'intersheath grading: equal peaks')
// comparison and three-core
await page.locator('summary', { hasText: 'Cable against overhead line' }).click()
const cmp = squash(await page.locator('details', { hasText: 'Cable against overhead line' }).innerText())
check(/11\.16/.test(cmp) && /306\.0/.test(cmp) && new RegExp(f(c0 * 1000, 1)).test(cmp), 'comparison uses Module 8’s line (11.16 nF/km, 306.0 Ω) against the cable')
await page.locator('summary', { hasText: 'Three-core belted' }).click()
const bel = squash(await page.locator('details', { hasText: 'Three-core belted' }).innerText())
check(/0\.7500 µF/.test(bel) && new RegExp(f(2 * Math.PI * 50 * 0.75e-6 * (11000 / Math.sqrt(3)), 3)).test(bel), 'three-core: C_n 0.7500 µF and its charging current')
await page.getByLabel('Measurement 2 (C₂) [µF]').fill('0.2')
await wait(300)
check(/not possible/.test(await page.locator('details', { hasText: 'Three-core belted' }).innerText()), 'impossible measurements: a clear message')
check(await noOverflow(), 'no horizontal overflow (Explore)')
await page.screenshot({ path: OUT + 'cables-explore.png', fullPage: true })

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await tab('Experiment')
for (const name of ['Double the insulation thickness', 'A higher-permittivity insulation', '10 km of cable against 10 km of overhead line']) {
  await page.getByRole('button', { name }).click()
  await wait(300)
  await page.locator('.ps-predict .ps-option').first().click()
  await wait(400)
}
check((await page.locator('.ps-table').count()) === 1, 'the comparison table appears after predicting')
check(/4 of 6/.test(await acts()), 'three experiments complete an activity')
await page.getByRole('button', { name: 'Double the insulation thickness' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: 'clearly less than half' }).click()
await wait(300)
const pct = ((Math.log(2) / Math.log(3) - 1) * 100).toFixed(1).replace('-', '')
check(
  /Your prediction was right/.test(await text('.ps-predict-result')) && (await text('.ps-predict-result')).includes(`falls by ${pct} %`),
  `thicker insulation: g_max falls ${pct} % (decided from the computation)`,
)
check((await page.locator('.ps-plot svg').count()) === 1, '… with the before/after stress plot')
await page.getByRole('button', { name: 'A bigger conductor in the same sheath' }).click()
await wait(300)
await page.locator('.ps-predict .ps-option', { hasText: 'first falls, then rises' }).click()
await wait(300)
check(/Your prediction was right/.test(await text('.ps-predict-result')) && /r = R\/e = 9\.20 mm/.test(await text('.ps-predict-result')), 'bigger conductor: g_max dips at r = R/e = 9.20 mm')
check(await noOverflow(), 'no horizontal overflow (Experiment)')
await page.screenshot({ path: OUT + 'cables-experiment.png', fullPage: true })

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await tab('Verify')
check((await page.locator('.ps-check--ok').count()) === 7 && (await page.locator('.ps-check--bad').count()) === 0, 'seven hand calculations, all confirmed by a second method')
await page.locator('.ps-num-answer input').fill(f(gmax0, 2))
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/5 of 6/.test(await acts()), 'your-turn answer completes Verify')
check(await noOverflow(), 'no horizontal overflow (Verify)')
await page.screenshot({ path: OUT + 'cables-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await tab('Practise')
const cKm = cUfKm(3.5, 1, 2.5)
const Kc = 66 / (Math.log(1.25) / 5 + Math.log(2) / 4)
const Gi = 66 / (Math.log(1.6) + 1.6 * Math.log(2.5 / 1.6))
const cn = 0.84 / 3 + 3 * ((0.54 - 0.84 / 3) / 2)
const nums = [
  cKm,
  (5e12 * Math.log(2.5)) / (2 * Math.PI * 2000) / 1e6,
  2 * Math.PI * 50 * cKm * 1e-6 * (66000 / Math.sqrt(3)),
  33 / (0.5 * Math.log(4)),
  2 * (50 / 40),
  Kc / 5,
  66 - Gi * Math.log(1.6),
  2 * Math.PI * 50 * cn * 1e-6 * (11000 / Math.sqrt(3)),
  Math.E,
  Math.log(2) / Math.log(3),
  (3 * 2 * Math.PI * 50 * 0.25e-6 * 10 * (66000 / Math.sqrt(3)) ** 2 * 0.002) / 1000,
]
const choice = ['At the conductor surface', 'halves', 'does not change (but the capacitance doubles)', 'To make the stress more uniform']
const qs = page.locator('.ps-quiz-list > li')
let c = 0
let n = 0
for (let k = 0; k < (await qs.count()); k++) {
  const q = qs.nth(k)
  if ((await q.locator('.ps-num-answer').count()) > 0) {
    await q.locator('input').fill(nums[n++].toFixed(4))
    await q.getByRole('button', { name: 'Check' }).click()
  } else await q.locator('.ps-option').filter({ hasText: choice[c++] }).click()
  await wait(150)
}
check(/15 of 15 answered correctly/.test(await text('.ps-quiz')), 'all fifteen questions answered correctly with independently computed answers')
check(/6 of 6/.test(await acts()), 'every activity complete')
check(
  (await page.locator('.ps-q-level').allInnerTexts()).some((t) => /GATE/.test(t)),
  'questions run from concept to GATE-style',
)
check(await noOverflow(), 'no horizontal overflow (Practise)')
await page.screenshot({ path: OUT + 'cables-practise.png', fullPage: true })

// ── extreme cable: every Verify check still holds ─────────────────────────────
console.log('── Extreme cable (r 2 mm, R 80 mm, 130 kV, ε_r 8)')
await tab('Explore')
await slider('Conductor radius r').fill('2')
await slider('Sheath radius R').fill('80')
await slider('Voltage V, core to sheath').fill('130')
await page.locator('summary', { hasText: 'Material, frequency and length' }).click()
await slider('Relative permittivity').fill('8')
await wait(400)
check(/not physically possible/.test(await page.locator('.ps-panel').innerText()) === false, 'the extreme cable is valid')
check(/above the permissible stress/.test(await page.locator('.cb-legend').innerText()), 'g_max above G: the legend says so (computed)')
await tab('Verify')
check((await page.locator('.ps-check--bad').count()) === 0 && (await page.locator('.ps-check--ok').count()) === 7, 'all seven checks still confirmed (no ✗)')

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
  if (m === 'explore') await p2.screenshot({ path: OUT + 'cables-explore-1280.png', fullPage: true })
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
check((await p3.locator('.ps3 .cb-xs svg').count()) === 1 && (await p3.locator('.ps3 canvas').count()) === 0, 'no WebGL: the 2D cross-section is shown instead')
check(new RegExp(f(gmax0, 2)).test(squash(await p3.locator('section[aria-labelledby="cb-res"]').innerText())), 'no WebGL: results still computed')
await p3.screenshot({ path: OUT + 'cables-nowebgl.png', fullPage: true })
await ctx3.close()

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed')
process.exit(failures.length ? 1 : 0)
