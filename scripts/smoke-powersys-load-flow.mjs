/**
 * Power Systems Module 5 — Load Flow & Bus Analysis, in the browser: every mode, the computed numbers that must
 * appear (Saadat Example 6.10: |V2| = 0.9717 pu, slack 218.42 MW), the Y_bus builder, the Newton–Raphson stepper,
 * Gauss–Seidel, results, a line outage with no operating point, experiments, hand checks and practice; no console
 * errors and no horizontal overflow. Run with the dev server on 5199: node scripts/smoke-powersys-load-flow.mjs
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
const text = (sel) => page.locator(sel).first().innerText()
const acts = async () => (await page.locator('.ps-acts summary').innerText()).replace(/\s+/g, ' ')
const BASE = '#/subjects/power-systems/load-flow'

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── the module page ──────────────────────────────────────────────────────────
console.log('── Module page')
await go('#/subjects/power-systems')
const card = await page.locator('.subject-topic-card', { hasText: 'Load Flow' }).innerText()
check(/Interactive module/.test(card), 'the subject page lists Load Flow as an interactive module')
await go(BASE)
check((await page.locator('main h1').first().innerText()) === 'Load Flow & Bus Analysis', 'module heading')
check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Learn|Explore|Experiment|Verify|Practise', 'five modes')
check(/0 of 6/.test(await acts()), 'six activities, none done')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
check(/Step 1 of 6/i.test(await text('.ps-stepper')), 'the tour has six steps')
check((await page.locator('.ps-lf-sld [aria-label^="Bus 2, Bus 2, PQ"]').count()) === 1, 'the diagram names each bus with its type (Bus 2 is PQ)')
await page.screenshot({ path: OUT + 'powersys-lf-learn.png', fullPage: true })
for (let k = 0; k < 2; k++) await page.getByRole('button', { name: 'Next →' }).click()
await wait(200)
check(/18\.42 MW/.test(await text('.ps-step-body')) && /218\.42 MW/.test(await text('.ps-step-body')), 'why a slack bus: losses 18.42 MW, slack 218.42 MW (computed)')
for (let k = 0; k < 3; k++) await page.getByRole('button', { name: 'Next →' }).click()
await wait(200)
const answer = await text('.ps-step-body')
check(/0\.971684/.test(answer) && /−2\.696/.test(answer) && /−0\.4988/.test(answer), 'the answer: |V2| = 0.971684, θ2 = −2.696°, θ3 = −0.4988° (Saadat 6.10)')
check(/146\.177/.test(answer) && /218\.423/.test(answer), 'slack 218.423 MW and Q3 146.177 Mvar')
check((await page.locator('.ps-lf-sld [aria-label*="0.9717 per unit"]').count()) === 1, 'the diagram shows |V2| = 0.9717 pu')
check(/1 of 6/.test(await acts()), 'finishing the tour completes an activity')
check(await noOverflow(), 'Learn: no horizontal overflow')

// ── Explore: Y_bus ───────────────────────────────────────────────────────────
console.log('── Explore · Y_bus')
await go(BASE + '?mode=explore')
check(/after 0 of 3/.test(await text('.ps-lf-ycard h3')), 'Y_bus starts empty')
await page.getByRole('button', { name: /Add line 1–2/ }).click()
await wait(200)
check((await page.locator('.ps-lf-matrix td.is-changed').count()) === 4, 'adding line 1–2 changes four entries, outlined')
check(/10\.00 − j20\.00/.test(await text('.ps-lf-matrix')), 'Y11 = 10 − j20 after line 1–2')
check((await page.locator('.ps-lf-line.is-current').count()) === 1, 'the line being added is marked on the diagram')
await page.getByRole('button', { name: 'Add all' }).click()
await wait(200)
const ym = await text('.ps-lf-matrix')
check(/26\.00 − j52\.00/.test(ym) && /−16\.00 \+ j32\.00/.test(ym), 'complete Y_bus: Y22 = 26 − j52, Y23 = −16 + j32')
check(/same matrix/.test(await page.locator('.ps-callout').first().innerText()), 'checked against the shared Y_bus builder')
check(/2 of 6/.test(await acts()), 'building Y_bus completes an activity')
check(await noOverflow(), 'Y_bus view: no horizontal overflow')

// ── Explore: Newton–Raphson ──────────────────────────────────────────────────
console.log('── Explore · Newton–Raphson')
await page.getByRole('radio', { name: 'Newton–Raphson' }).click()
await wait()
const mm = await text('.ps-lf-nrgrid')
check(/−2\.86/.test(mm) && /1\.438/.test(mm) && /−0\.22/.test(mm), 'flat-start mismatches ΔP2 = −2.86, ΔP3 = 1.4384, ΔQ2 = −0.22')
await page.getByRole('button', { name: 'Next iteration →' }).click()
await wait(200)
check(/Iteration 1/.test(await text('.ps-lf-status')), 'Next iteration advances')
await page.locator('.ps-lf-jac summary').click()
await wait(200)
check((await page.locator('.ps-lf-jac .ps-lf-matrix tbody tr').count()) === 3, 'the Jacobian is 3 × 3 (on demand)')
await page.getByRole('button', { name: 'Run to the end' }).click()
await wait(300)
check(/Converged: after 3 iterations/.test(await text('.ps-lf-status')), 'converges in 3 iterations')
check((await page.locator('.ps-lf-sld [aria-label*="0.9717 per unit"]').count()) === 1, 'the diagram follows the iteration (|V2| = 0.9717 at the end)')
check(/3 of 6/.test(await acts()), 'stepping to convergence completes an activity')
await page.screenshot({ path: OUT + 'powersys-lf-nr.png', fullPage: true })

// ── Explore: Gauss–Seidel, results ───────────────────────────────────────────
console.log('── Explore · Gauss–Seidel and results')
await page.getByRole('radio', { name: 'Gauss–Seidel' }).click()
await wait()
const gs = await page.locator('.ps-lf-gsrow .ps-readouts').innerText()
check(/NEWTON–RAPHSON\s*3/i.test(gs) && /GAUSS–SEIDEL\s*20/i.test(gs), 'NR 3 iterations, plain GS 20')
check(/yes/.test(gs), 'GS reaches the same solution')
await page.locator('.ps-slider', { hasText: 'Acceleration factor' }).locator('input').fill('1.2')
await wait()
check(/GAUSS–SEIDEL\s*10/i.test(await page.locator('.ps-lf-gsrow .ps-readouts').innerText()), 'α = 1.2 cuts GS to 10 iterations')
await page.getByRole('radio', { name: 'Results' }).click()
await wait()
const res = await page.locator('.ps-lf-results').innerText()
check(/0\.9717/.test(res) && /218\.42/.test(res) && /146\.18/.test(res), 'results: |V2| 0.9717, slack 218.42 MW, Q3 146.18 Mvar')
check(/balanced/.test(await page.locator('.ps-readouts').nth(1).innerText()), 'power balance holds')
check(await noOverflow(), 'Results: no horizontal overflow')

// ── Explore: 5-bus network, an outage ────────────────────────────────────────
console.log('── Explore · 5-bus network')
await page.getByRole('radio', { name: '5-bus meshed (illustrative)' }).click()
await wait()
const side = await page.locator('.ps-lf-side').innerText()
check(/0\.981/.test(side) && /Valley town/.test(side) && /5\.25/.test(side), '5-bus: lowest |V| 0.981 pu at Valley town, losses 5.25 MW')
check(/2–4/.test(await text('.ps-lf-results')), 'line flows for all seven lines')
await page.screenshot({ path: OUT + 'powersys-lf-five.png', fullPage: true })
await page.locator('.ps-lf-line[aria-label^="Line 1–3"]').focus()
await page.keyboard.press('Enter')
await wait(500)
const nope = await page.locator('.ps-lf-side .ps-callout').innerText()
check(/No operating point/.test(nope) && /166 Mvar/.test(nope), 'line 1–3 out (keyboard): no operating point — East plant would need 166 Mvar')
check((await page.locator('.ps-lf-line.is-out').count()) === 1, 'the outaged line is drawn out of service')
await page.locator('.ps-lf-linebtns').getByRole('button', { name: 'Reset' }).click()
await wait()
check(!/No operating point/.test(await page.locator('.ps-lf-side').innerText()), 'Reset restores the network')
await page.locator('.ps-slider', { hasText: 'All loads' }).locator('input').fill('1.5')
await wait()
check(/Overloaded: line 1–3/.test(await page.locator('.ps-lf-side').innerText()), 'loads × 1.5 overload line 1–3')
check(await noOverflow(), '5-bus: no horizontal overflow')

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await go(BASE + '?mode=experiment')
check((await page.locator('.ps-lf-expitem').count()) === 5, 'five experiments')
check((await page.locator('.ps-lf-compare').count()) === 0, 'nothing is revealed before a prediction')
await page.locator('.ps-option', { hasText: 'between 1.25 and 3 times' }).click()
await wait(600)
check(/Your prediction was right/.test(await text('.ps-predict')), 'nose: the answer is judged from the computed curve')
check(/1\.92\d/.test(await text('.ps-predict')) && /750 MW/.test(await text('.ps-predict')), 'maximum loadability ≈ 1.92 × (750 MW)')
check((await page.locator('.ps-plot').count()) >= 1, 'the P–V curve is drawn')
await page.screenshot({ path: OUT + 'powersys-lf-nose.png', fullPage: true })
await page.locator('.ps-lf-expitem', { hasText: 'A PV generator' }).click()
await wait()
await page.locator('.ps-option', { hasText: 'falls below 1.04' }).click()
await wait()
check(/Your prediction was right/.test(await text('.ps-predict')) && /1\.0308/.test(await text('.ps-lf-compare')), 'Q limit: bus 3 falls to 1.0308 pu')
await page.locator('.ps-lf-expitem', { hasText: 'Flat start' }).click()
await wait()
await page.locator('.ps-option', { hasText: 'different answer' }).click()
await wait()
check(/0\.0866/.test(await text('.ps-predict')), 'a poor start converges to the low-voltage solution 0.0866 pu')
check(/4 of 6/.test(await acts()), 'three experiments complete an activity')
check(await noOverflow(), 'Experiment: no horizontal overflow')

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await go(BASE + '?mode=verify')
check((await page.locator('.ps-check--ok').count()) === 6 && (await page.locator('.ps-check--bad').count()) === 0, 'all six hand checks agree')
const inputs = page.locator('.ps-num-answer input')
await inputs.nth(0).fill('-62')
await page.locator('.ps-num-answer').nth(0).getByRole('button', { name: 'Check' }).click()
await inputs.nth(1).fill('9.85')
await page.locator('.ps-num-answer').nth(1).getByRole('button', { name: 'Check' }).click()
await wait()
check(/2 of 2 answered correctly/.test(await text('.ps-quiz')), 'the student’s own calculations (B33 = −62, loss 9.85 MW) are checked')
check(/5 of 6/.test(await acts()), 'Verify completes an activity')
await page.screenshot({ path: OUT + 'powersys-lf-verify.png', fullPage: true })

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await go(BASE + '?mode=practise')
check((await page.locator('.ps-quiz-list > li').count()) === 9, 'nine practice questions')
await page.locator('.ps-q', { hasText: 'How many equations' }).locator('input').fill('7')
await page.locator('.ps-q', { hasText: 'How many equations' }).getByRole('button', { name: 'Check' }).click()
await wait()
check(/1 of 9 answered correctly/.test(await text('.ps-quiz')), 'answers are checked (5-bus Jacobian is 7 × 7)')
check(await noOverflow(), 'Practise: no horizontal overflow')
check((await hash()) === BASE + '?mode=practise', 'the mode is kept in the address')

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
process.exit(failures.length ? 1 : 0)
