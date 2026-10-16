/**
 * Power Systems — Module 16, Distribution Systems & Power Factor, in the browser: every mode, the key computed numbers
 * (expected values derived here from closed forms), the distributor diagram and profile following the controls,
 * invalid and infeasible states, activities, levels, no console errors, no horizontal overflow at 1440 and 1280 px.
 * (No 3D view in this module: the distributor is drawn to scale in 2D.)
 * Run with the dev server on 5199: node scripts/smoke-powersys-distribution.mjs
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
const PAGE = '#/subjects/power-systems/distribution'
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
const text = (sel) => page.locator(sel).first().innerText()
const panel = () => page.locator('#ps-panel').innerText()
const acts = async () => (await page.locator('.ps-acts summary').innerText()).replace(/\s+/g, ' ')
const level = async (l) => {
  await page.getByLabel('Detail level the labs open with').selectOption(l)
  await wait(300)
}
const slider = (label) => page.locator('.ps-slider', { hasText: label }).first().locator('input')
const radio = (name) => page.getByRole('radio', { name, exact: true }).first()
const readouts = async (label) =>
  (
    await page
      .locator(label ? `dl.ps-readouts[aria-label="${label}"]` : '.ps-readouts')
      .first()
      .innerText()
  ).replace(/\s+/g, ' ')
const next = async () => {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(250)
}

// ── expected values, derived here ──────────────────────────────────────────────────────────────────────────────
const rl = 0.0002 // 2 × 0.1 Ω/km per conductor, in Ω/m
const loads = [
  [100, 50],
  [200, 40],
  [300, 60],
  [350, 30],
]
const vMinOne = 220 - rl * loads.reduce((s, [x, I]) => s + I * x, 0) // 211.70
const iaBoth = loads.reduce((s, [x, I]) => s + (I * (400 - x)) / 400, 0) // 76.25
const tan = (pf) => Math.sqrt(1 - pf * pf) / pf
const qc = 200 * (tan(0.7) - tan(0.95))
const w = 2 * Math.PI * 50
const cStar = ((qc * 1000) / (w * 400 * 400)) * 1e6
const cDelta = cStar / 3
const econ = Math.sqrt(1 - (480 / 2400) ** 2)
const aKelvin = 150 * Math.sqrt((0.0282 * 3000 * 8) / (0.1 * 2000))

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

console.log('── Subject page')
await go('#/subjects/power-systems')
const card = await page.locator('.subject-topic-card', { hasText: 'Distribution & PF' }).first().innerText()
check(/Interactive module/.test(card), 'Module 16 is listed as an interactive module')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
await go(PAGE)
await level('beginner')
check((await page.locator('main h1').first().innerText()) === 'Distribution Systems & Power Factor', 'module heading')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'five modes')
check(/0 of 6/.test(await acts()), 'six activities, none done')
check(/Step 1 of 10/i.test(await text('.ps-stepper')), 'the tour has ten steps')
let body = await text('.ps-step-body')
check(/Why does the voltage at the last house on a street feeder sag in the evening/.test(body), 'step 1 opens with the real-world question')
check(/GATE EE Section 6/.test(body) && /BEEE304L Module 6/.test(body) && /BEEE304L Module 7/.test(body), 'step 1 shows the syllabus mapping (GATE §6, BEEE304L Modules 6 and 7)')
check(/Illustration/.test(await text('.ds-illus')), 'the structure picture is labelled as an illustration')
await page.screenshot({ path: OUT + 'ds-learn-1.png', fullPage: true })
await next()
check(/Radial/.test(await text('.ds-layouts')) && /Ring main/.test(await text('.ds-layouts')), 'step 2: radial, ring and interconnected layouts')
await next()
body = await text('.ps-step-body')
check(body.includes(vMinOne.toFixed(2)) && /noticeable \(3\.8 %\)/.test(body), `step 3: lowest voltage ${vMinOne.toFixed(2)} V, a computed "noticeable (3.8 %)" drop`)
check(/Classic mistake/.test(body) && /4\.15 V/.test(body), 'step 3: the per-conductor vs loop mistake, with its computed wrong answer')
await next()
check((await text('.ps-step-body')).includes(iaBoth.toFixed(2)), `step 4: fed at both ends, I_A = ${iaBoth.toFixed(2)} A`)
check(/lowest voltage 217\.95 V at 200 m/.test(await text('.ds-diagram')), 'step 4: the diagram marks the minimum at L2 (200 m)')
await slider('V_B (try it)').fill('214')
await wait(250)
const ia214 = (6 + rl * 30500) / (rl * 400)
let left214 = ia214
const min214 = loads.find(([, I]) => (left214 -= I) <= 0)[0]
check(
  (await text('.ps-step-body')).includes(ia214.toFixed(2)) && new RegExp(`at ${min214} m`).test(await text('.ds-diagram')),
  `step 4: V_B = 214 V moves the minimum to ${min214} m (I_A = ${ia214.toFixed(2)} A)`,
)
await page.screenshot({ path: OUT + 'ds-learn-4.png', fullPage: true })
await next()
check(/one half \(0\.5000\)/.test(await text('.ps-step-body')) && /8\.000 V/.test(await text('.ps-step-body')), 'step 5: uniform load drop 8.000 V, one half of the far-end case')
await next()
check(/the ring closes|continue round the ring/.test(await text('.ds-diagram')), 'step 6: the ring main is drawn opened out')
await next()
body = await text('.ps-step-body')
check(/275\.192/.test(body) && /275\.136/.test(body), 'step 7: AC distributor V_A = 275.192 V (a) and 275.136 V (b)')
await page.screenshot({ path: OUT + 'ds-learn-7.png', fullPage: true })
await next()
check((await text('.ps-step-body')).includes(aKelvin.toFixed(1)), `step 8: Kelvin's law a* = ${aKelvin.toFixed(1)} mm²`)
await next()
body = await text('.ps-step-body')
check(
  body.includes(qc.toFixed(1)) && body.includes(cStar.toFixed(1)) && body.includes(cDelta.toFixed(1)),
  `step 9: Q_c ${qc.toFixed(1)} kVAr, C star ${cStar.toFixed(1)} µF, delta ${cDelta.toFixed(1)} µF`,
)
await next()
check((await text('.ps-step-body')).includes(econ.toFixed(4)), `step 10: economical pf ${econ.toFixed(4)}`)
check(/1 of 6/.test(await acts()), 'finishing the tour completes an activity')
check(await noOverflow(), 'Learn: no horizontal overflow')
await page.screenshot({ path: OUT + 'ds-learn-10.png', fullPage: true })
await page.getByRole('button', { name: /Feed a distributor and size a bank yourself/ }).click()
await wait(700)
check((await page.evaluate(() => location.hash)) === PAGE + '?mode=explore', 'the tour leads on to Explore')

// ── Explore: DC distributor ─────────────────────────────────────────────────
console.log('── Explore · DC distributor')
let ro = await readouts()
check(ro.includes(vMinOne.toFixed(2)) && /at load L4/.test(ro), `fed at one end: lowest ${vMinOne.toFixed(2)} V at L4`)
check(!(await page.locator('details.ps-more', { hasText: 'Voltages, conductor' }).getAttribute('open')), 'Beginner: the extra controls are folded away')
await radio('Both ends').click()
await wait(300)
ro = await readouts()
check(/217\.95/.test(ro) && /at load L2/.test(ro) && /76\.3 · 103\.8/.test(ro), 'both ends: lowest 217.95 V at L2; A 76.3 A, B 103.8 A')
check(/You changed:.*one end → both ends/.test(await panel()), 'the change note says what changed and what it did')
await page.getByRole('radio', { name: 'L3', exact: true }).click()
await slider('L3 current').fill('120')
await wait(300)
ro = await readouts()
check(/300 m/.test(ro) && /at load L3/.test(ro), 'L3 → 120 A: the lowest point moves to L3 (300 m)')
check(/moved from 200 m to 300 m/.test(await panel()), 'the change note reports the move, computed')
check(/lowest voltage .* at 300 m/.test(await text('.ds-diagram')), 'the diagram marks the new minimum')
await radio('Ring main').click()
await wait(300)
check(/2 of 6/.test(await acts()), 'both ends, ring main and a moved minimum complete the activity')
await page.screenshot({ path: OUT + 'ds-explore-dc.png', fullPage: true })
await level('standard')
check((await page.locator('details.ps-more', { hasText: 'Voltages, conductor' }).getAttribute('open')) !== null, 'Standard: the extra controls are open')
check((await page.locator('.ds-table tbody tr').count()) === 5, 'Standard: the section table lists five sections')
await slider('Length A → B').fill('300')
await wait(300)
check(/beyond the end/.test(await panel()) && (await page.locator('.ps-readouts').count()) === 0, 'length 300 m with a load at 350 m: invalid input message, no results')
await page.getByRole('button', { name: 'Reset' }).first().click()
await wait(300)
ro = await readouts()
check(/217\.95/.test(ro), 'Reset restores the case (ring main: lowest 217.95 V)')
await page.getByLabel('Uniformly distributed load as well').check()
await wait(300)
check(/uniform load of 0\.20 A\/m/.test(await text('.ds-diagram')), 'uniform load: drawn and labelled')
await level('engineer')
check(/Check by nodal analysis/.test(await panel()), 'Engineer: the nodal check is shown')
check(await noOverflow(), 'Explore DC: no horizontal overflow')
await page.screenshot({ path: OUT + 'ds-explore-dc-engineer.png', fullPage: true })

// ── Explore: AC, PF, Kelvin ─────────────────────────────────────────────────
console.log('── Explore · AC, power factor, Kelvin')
await level('standard')
await radio('AC distributor').click()
await wait(400)
ro = await readouts('Sending-end voltage')
check(/275\.192/.test(ro) && /275\.136/.test(ro), 'AC: |V_A| 275.192 V (a) and 275.136 V (b)')
await slider('Power factor of C').fill('1')
await slider('Power factor of D').fill('1')
await wait(300)
ro = await readouts('Sending-end voltage')
check(!/275\.192/.test(ro) && /convention \(a\) \d+\.\d+/.test(ro), 'unity power factors: both sending voltages recomputed')
await page.screenshot({ path: OUT + 'ds-explore-ac.png', fullPage: true })
await radio('Power-factor correction').click()
await wait(400)
ro = await readouts('Capacitor bank')
check(ro.includes(qc.toFixed(1)) && ro.includes(cStar.toFixed(1)), `PF: Q_c ${qc.toFixed(1)} kVAr, star ${cStar.toFixed(1)} µF`)
check(/falls by 26\.3 %/.test(ro), 'PF: line current falls by 26.3 % (computed)')
await radio('Delta bank').click()
await wait(300)
check((await readouts('Capacitor bank')).includes(cDelta.toFixed(1)), `delta bank: ${cDelta.toFixed(1)} µF per phase`)
check(/3 of 6/.test(await acts()), 'correcting to 0.95 and comparing star/delta completes the PF activity')
check((await panel()).includes(econ.toFixed(4)), `economical pf ${econ.toFixed(4)} shown`)
await slider('Target power factor').fill('0.6')
await wait(300)
check(/reactor/.test(await panel()) && /cannot be reached/.test(await panel()), 'target below the initial pf: impossible-target message, no bank sized')
await slider('Target power factor').fill('0.9')
await radio('Leading (over-corrected)').click()
await wait(300)
check(/Over-corrected/.test(await panel()), 'leading target: over-correction warning, with computed comparisons')
await page.screenshot({ path: OUT + 'ds-explore-pf.png', fullPage: true })
await radio('Conductor size (Kelvin)').click()
await wait(400)
check((await readouts("Kelvin's law")).includes(aKelvin.toFixed(1)), `Kelvin: a* = ${aKelvin.toFixed(1)} mm²`)
check(/What Kelvin’s law leaves out/.test(await panel()), 'Kelvin: its limitations are stated')
await page.getByRole('radio', { name: '400 V', exact: true }).click()
await wait(300)
check(/voltage drop/.test(await text('.ps-readout--warn')), '400 V route: the voltage drop governs, not Kelvin (computed)')
check(await noOverflow(), 'Explore Kelvin: no horizontal overflow')
await page.screenshot({ path: OUT + 'ds-explore-kelvin.png', fullPage: true })

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await page.getByRole('tab', { name: 'Experiment' }).click()
await wait(500)
check((await page.locator('.ds-exp-item').count()) === 6, 'six experiments')
check((await page.locator('#ps-panel .ps-table').count()) === 0, 'no result before a prediction')
await page.locator('.ps-option', { hasText: 'At load L2' }).click()
await wait(400)
check(/Your prediction was right/.test(await text('.ps-predict')), 'both ends: the lowest point at L2 — judged from the computation')
await page.locator('.ds-exp-item', { hasText: 'One load near end B grows' }).click()
await wait(400)
await page.locator('.ps-option', { hasText: 'Towards B' }).click()
await wait(400)
check(/Your prediction was right/.test(await text('.ps-predict')) && /moves from 200 m to 300 m/.test(await text('.ps-predict')), 'far load: the minimum moves towards B (200 → 300 m)')
await page.locator('.ds-exp-item', { hasText: 'Spread the load evenly' }).click()
await wait(400)
await page.locator('.ps-option', { hasText: 'one quarter' }).click()
await wait(400)
check(/Not quite/.test(await text('.ps-predict')) && /one half \(0\.5000\)/.test(await text('.ps-predict')), 'uniform: a wrong prediction is explained — the ratio is one half')
check(/4 of 6/.test(await acts()), 'three experiments complete an activity')
await page.locator('.ds-exp-item', { hasText: 'Correct to unity' }).click()
await wait(400)
await page.locator('.ps-option', { hasText: 'economical power factor, below unity' }).click()
await wait(400)
check(/Your prediction was right/.test(await text('.ps-predict')), 'unity vs economical pf: the economical pf costs less (computed)')
await page.screenshot({ path: OUT + 'ds-experiment.png', fullPage: true })
check(await noOverflow(), 'Experiment: no horizontal overflow')

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await page.getByRole('tab', { name: 'Verify' }).click()
await wait(700)
check(
  (await page.locator('.ps-check--ok').count()) === 8 && (await page.locator('.ps-check--bad').count()) === 0,
  'all eight checks agree (nodal, discretisation, superposition, Q from C, search, KVL, Kelvin)',
)
const vq = page.locator('.ps-quiz-list > li')
await vq
  .nth(0)
  .locator('input')
  .fill(((2 + rl * 30500) / (rl * 400)).toFixed(2))
await vq.nth(0).getByRole('button', { name: 'Check' }).click()
await vq
  .nth(1)
  .locator('input')
  .fill(((100000 / (3 * w * 400 * 400)) * 1e6).toFixed(1))
await vq.nth(1).getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/2 of 2 answered correctly/.test(await text('.ps-quiz')), 'the student’s own calculations are checked')
check(/5 of 6/.test(await acts()), 'Verify completes its activity')
check(await noOverflow(), 'Verify: no horizontal overflow')
await page.screenshot({ path: OUT + 'ds-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await page.getByRole('tab', { name: 'Practise' }).click()
await wait(500)
const q = page.locator('.ps-quiz-list > li')
check((await q.count()) === 15, 'fifteen practice questions')
const num = async (k, v) => {
  await q.nth(k).locator('.ps-num-answer input').fill(String(v))
  await q.nth(k).getByRole('button', { name: 'Check' }).click()
}
const opt = (k, t) => q.nth(k).locator('.ps-option', { hasText: t }).click()
await num(1, 'abc')
await wait(200)
check(/is not a number/.test(await q.nth(1).innerText()), 'a non-number answer is reported, not judged')
await num(1, 0.03)
await wait(200)
check(/one conductor/.test(await q.nth(1).innerText()), 'a wrong answer shows the common mistake (one conductor only)')
await opt(0, 'A feeder has no loads tapped off it')
await num(1, 0.06)
await num(2, vMinOne.toFixed(2))
await num(3, iaBoth.toFixed(2))
await opt(4, 'L2 (200 m')
// unequal ends: I_A = (4 + 2r·Σ I(L − x))/(2rL) with 2r = 0.0001 Ω/m
const r6 = 0.0001
const ia6 = (4 + r6 * (60 * 400 + 80 * 250 + 50 * 100)) / (r6 * 500)
const v6 = 230 - r6 * (ia6 * 100 + (ia6 - 60) * 150 + (ia6 - 140) * 150) // current reverses after the load at 400 m
await num(5, v6.toFixed(3))
await num(6, 8)
await opt(7, 'both ends with equal voltages')
await num(8, qc.toFixed(2))
await num(9, cDelta.toFixed(1))
await num(10, ((1 - 0.7 / 0.95) * 100).toFixed(2))
await num(11, Math.sqrt(1 - 0.09).toFixed(4))
const qc13 = 500 * (tan(0.75) - tan(0.9))
await num(12, (((qc13 * 1000) / (w * 11000 * 11000)) * 1e6).toFixed(3))
await opt(13, 'annual cost of the energy lost')
await num(14, (200 * Math.sqrt((0.0282 * 4000 * 6) / (0.12 * 1500))).toFixed(1))
await wait(300)
check(/15 of 15 answered correctly/.test(await text('.ps-quiz')), 'all fifteen answers are checked against the models')
check(/6 of 6/.test(await acts()), 'all six activities done')
check(await noOverflow(), 'Practise: no horizontal overflow')
await page.screenshot({ path: OUT + 'ds-practise.png', fullPage: true })

// ── leave and re-enter, 1280 wide ────────────────────────────────────────────
console.log('── Re-entry and 1280 px')
for (let k = 0; k < 2; k++) {
  await go('#/subjects/power-systems/grid')
  await go(PAGE + '?mode=explore')
}
check((await page.locator('.ds-diagram').count()) === 1, 'leaving and re-entering twice: the distributor diagram renders')
await level('beginner')
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
const p2 = await ctx.newPage()
p2.on('pageerror', (e) => errors.push(String(e)))
p2.on('console', (mm) => mm.type() === 'error' && errors.push(mm.text()))
for (const mode of ['', '?mode=explore', '?mode=experiment', '?mode=verify', '?mode=practise']) {
  await p2.goto(URL + PAGE + mode)
  await p2.waitForTimeout(900)
  check(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `1280 px ${mode || 'learn'}: no horizontal overflow`)
}
await p2.goto(URL + PAGE + '?mode=explore')
await p2.waitForTimeout(700)
for (const tabName of ['AC distributor', 'Power-factor correction', 'Conductor size (Kelvin)']) {
  await p2.getByRole('radio', { name: tabName, exact: true }).click()
  await p2.waitForTimeout(300)
  check(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `1280 px ${tabName}: no horizontal overflow`)
}
await p2.screenshot({ path: OUT + 'ds-explore-1280.png', fullPage: true })
await ctx.close()

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
process.exit(failures.length ? 1 : 0)
