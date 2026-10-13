/**
 * Power Systems — Module 4, Faults & Protection, in the browser: every mode, the key computed numbers, the activities,
 * no console errors and no horizontal overflow at 1440 × 900 (and 1280 wide). Screenshots go to scripts/out/.
 * Run with the dev server on 5199: node scripts/smoke-powersys-faults.mjs
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
const BASE = '#/subjects/power-systems/faults'
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const wait = (ms = 400) => page.waitForTimeout(ms)
const go = async (h) => {
  await page.goto(URL + h)
  await wait(900)
}
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const text = (sel) => page.locator(sel).first().innerText()
const flat = (s) => s.replace(/\s+/g, ' ')
const acts = async () => flat(await page.locator('.ps-acts summary').innerText())
const shot = async (name) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: OUT + `faults-${name}.png`, fullPage: true })
}
const radio = (group, name) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true })

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
await go(BASE)
check((await page.locator('main h1').first().innerText()) === 'Faults & Protection', 'the module opens (status ready)')
const tabs = await page.getByRole('tab').allInnerTexts()
check(tabs.join('|') === 'Learn|Explore|Experiment|Verify|Practise', `modes: ${tabs.join(' · ')}`)
check(/Step 1 of 7/i.test(await text('.ps-stepper')), 'the tour has seven steps')
const s1 = await text('.ps-step-body')
check(/4\.15 kA/.test(s1) && /25\.1 kA/.test(s1), 'step 1: town 4.15 kA and generator 25.1 kA, computed')
check((await page.locator('svg.ps-sld .ps-fault').count()) === 1, 'the fault is drawn at its bus')
await shot('learn-1')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(200)
const s2 = await text('.ps-step-body')
check(/\b600\b/.test(s2) && /\b79\b/.test(s2), 'fault-level table: 600 MVA at the generator, 79 MVA at the town')
await shot('learn-2')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(200)
await page.locator('.ps-more summary').first().click()
check((await page.locator('.ps-ft-zbus tbody tr').count()) === 6, 'the 6 × 6 |Z_bus| is shown on request')
await shot('learn-3')
for (let k = 0; k < 4; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(200)
  if (k < 3) await shot(`learn-${k + 4}`)
}
check(/Clearing the fault/.test(await text('.ps-step-title')), 'the tour ends with protection')
check((await page.locator('.ps-ft-logplot').count()) === 1, 'the relay curves are plotted')
await shot('learn-7')
check(/1 of 6/.test(await acts()), 'finishing the tour completes an activity')
check(await noOverflow(), 'learn: no horizontal overflow')

// ── Explore: fault study ────────────────────────────────────────────────────
console.log('── Explore · fault study')
await page
  .locator('.ps-ft-tour')
  .getByRole('button', { name: /Fault any bus yourself/ })
  .click()
await wait(600)
check((await page.evaluate(() => location.hash)) === BASE + '?mode=explore', 'the tour leads to Explore')
const ro = async () => flat(await text('.ps-readouts'))
check(/Fault current 4\.146 kA/i.test(await ro()), 'three-phase at the town: 4.146 kA')
for (const t of ['Line-to-ground', 'Line-to-line', 'Double line-to-ground']) {
  await radio('Fault type', t).click()
  await wait(250)
}
check(/Fault current 5\.286 kA/i.test(await ro()), 'double line-to-ground at the town: 5.286 kA')
check(/✓ You have compared all four/.test(await page.locator('.ps-card', { has: page.locator('#ps-ft-compare') }).innerText()), 'all four types tried → activity')
await radio('Fault type', 'Line-to-ground').click()
await wait(250)
check(/Fault current 5\.372 kA/i.test(await ro()), 'line-to-ground at the town: 5.372 kA')
await shot('explore-study-lg')
// the unearthed 33 kV system
await page.locator('svg.ps-sld [aria-label^="Distribution substation 33 kV"]').click()
await wait(300)
check(/Fault current 0\.000 kA/i.test(await ro()), 'an earth fault on the unearthed 33 kV line: 0 kA')
check(/No earth-fault current/.test(await page.locator('main').innerText()), '…explained, with the healthy phases at √3')
await page.locator('.ps-ft-details summary').click()
await page.getByLabel('Earthing transformer on the 33 kV grid-substation bus').check()
await wait(300)
const etKa = Number((await ro()).match(/Fault current ([\d.]+) kA/i)?.[1])
check(etKa > 0.5 && etKa < 2, `with an earthing transformer the earth fault draws current (${etKa} kA)`)
await shot('explore-study-et')
await page.getByRole('button', { name: 'Reset earthing' }).click()
await wait(200)
await page.getByRole('radio', { name: 'Connection at the fault' }).click()
await wait(200)
check((await page.locator('svg.ps-ft-ic').count()) === 1, 'the connection of the sequence networks is drawn')
await page.getByRole('radio', { name: 'Every bus and branch' }).click()
await wait(200)
check((await page.locator('.ps-ft-tables table').count()) === 2, 'tables of every bus voltage and branch current')
check(await noOverflow(), 'explore: no horizontal overflow')
await page.getByRole('radio', { name: 'Sequence networks' }).click()
await radio('Fault location', 'Town 11 kV').click()
await wait(300)
await shot('explore-study')

// ── Explore: symmetrical components ─────────────────────────────────────────
console.log('── Explore · symmetrical components')
await radio('Explore', 'Symmetrical components').click()
await wait(300)
await page.getByRole('radio', { name: 'One phase only' }).click()
await wait(200)
const sc = flat(await text('aside .ps-readouts'))
check(/Zero \|x₀\| 0\.333/i.test(sc) && /Positive \|x₁\| 0\.333/i.test(sc), `one phase alone: three components of 1/3 (${sc.slice(0, 80)})`)
await page.getByRole('radio', { name: 'Balanced' }).click()
await wait(200)
check(/Negative \|x₂\| 0\.000/i.test(flat(await text('aside .ps-readouts'))), 'a balanced set has no negative sequence')
check(/3 of 6/.test(await acts()), 'three sets decomposed → activity')
await shot('explore-components')

// ── Explore: protection ─────────────────────────────────────────────────────
console.log('── Explore · protection')
await radio('Explore', 'Protection').click()
await wait(300)
const pr = flat(await text('.ps-readouts'))
check(/R1 sees \(11 kV\) 4146 A/i.test(pr) && /R2 sees \(33 kV\) 1382 A/i.test(pr), `relays see 4146 A (11 kV) and 1382 A (33 kV) (${pr.slice(0, 90)})`)
check(/Trips first CB4/i.test(pr), 'CB4 trips first')
check((await page.locator('.ps-ft-bad').count()) > 0, 'default settings are not graded (margin < 0.3 s flagged)')
await page.locator('.ps-more summary', { hasText: 'Show the TMS that grades' }).click()
const need = Number((await page.locator('.ps-more', { hasText: 'Show the TMS that grades' }).locator('b').innerText()).trim())
check(need > 0.1 && need < 0.3, `the TMS that grades is computed (${need})`)
const tms = page.locator('section[aria-label="Relay R2"] .ps-slider', { hasText: 'Time multiplier' }).locator('input')
await tms.fill(String(need))
await wait(300)
check(
  (await page
    .locator('.ps-card', { has: page.locator('#ps-ft-grade') })
    .locator('.ps-ft-bad')
    .count()) === 0,
  'R2 at that TMS grades for every fault type',
)
check(/4 of 6/.test(await acts()), 'grading completes the protection activity')
await radio('Fault location', '33 kV, end of L2').click()
await wait(200)
check(/Trips first CB2/i.test(flat(await text('.ps-readouts'))), 'a fault on the 33 kV line is cleared by CB2 (outside R1’s zone)')
check(
  (await page
    .locator('.ps-card', { has: page.locator('#ps-ft-duty') })
    .locator('tbody tr')
    .count()) === 4,
  'breaker duty against ratings for four breakers',
)
check(await noOverflow(), 'protection: no horizontal overflow')
await radio('Fault location', 'Town feeder, beyond CB4').click()
await wait(200)
await shot('explore-protection')

// ── Experiment ──────────────────────────────────────────────────────────────
console.log('── Experiment')
await page.getByRole('tab', { name: 'Experiment' }).click()
await wait(400)
check((await page.locator('.ps-ft-exp-item').count()) === 6, 'six experiments')
check((await page.locator('.ps-table').count()) === 0, 'no results before a prediction')
await page.locator('.ps-option', { hasText: /^Line-to-ground$/ }).click()
await wait(300)
check(/Your prediction was right/.test(await text('.ps-predict')), 'severity at the generator: line-to-ground is largest (computed)')
check(/32\.7 kA/.test(await text('.ps-predict')), 'the explanation quotes 32.7 kA')
await page.locator('.ps-ft-exp-item', { hasText: 'An earth fault on the 33 kV line' }).click()
await wait(300)
await page.locator('.ps-option', { hasText: 'Practically none' }).click()
await wait(300)
check(/Your prediction was right/.test(await text('.ps-predict')), 'unearthed 33 kV: practically none')
await page.locator('.ps-ft-exp-item', { hasText: 'Line-to-line against three-phase' }).click()
await wait(300)
await page.locator('.ps-option', { hasText: 'seven-eighths' }).click()
await wait(300)
check(/86\.6 %/.test(await text('.ps-predict')), 'LL = 86.6 % of three-phase')
check(/5 of 6/.test(await acts()), 'three experiments complete the activity')
await shot('experiment')
for (const id of ['Earth the generator through a reactor', 'Does the load before the fault matter?', 'A line-to-line fault seen through the transformer']) {
  await page.locator('.ps-ft-exp-item', { hasText: id }).click()
  await wait(300)
  await page.locator('.ps-option').first().click()
  await wait(300)
  check((await page.locator('.ps-table').count()) >= 1, `“${id}” shows its computed table`)
}
check(/2\/√3/.test(await text('.ps-predict')), 'the Dyn experiment explains the 2/√3 factor')
check(await noOverflow(), 'experiment: no horizontal overflow')
await shot('experiment-dyn')

// ── Verify ──────────────────────────────────────────────────────────────────
console.log('── Verify')
await page.getByRole('tab', { name: 'Verify' }).click()
await wait(400)
const okN = await page.locator('.ps-check--ok').count()
const badN = await page.locator('.ps-check--bad').count()
check(okN === 4 && badN === 0, `hand checks agree at the 33 kV default bus (${okN} ok, ${badN} bad; no earth path there for LG)`)
await radio('Bus to verify', 'Town 11 kV').click()
await wait(300)
check((await page.locator('.ps-check--ok').count()) === 5 && (await page.locator('.ps-check--bad').count()) === 0, 'at the town all five checks agree, incl. the phase-domain LG solution')
for (const t of ['Line-to-line', 'Double line-to-ground']) {
  await radio('Fault type', t).click()
  await wait(200)
  check((await page.locator('.ps-check--bad').count()) === 0 && (await page.locator('.ps-check--ok').count()) === 5, `${t}: sequence method = phase domain`)
}
await page.locator('.ps-num-answer input').fill('1.98')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(200)
check(/✓ Correct/.test(await text('.ps-quiz')), 'the student’s own fault-current calculation is checked (1.98 kA)')
check(await noOverflow(), 'verify: no horizontal overflow')
await shot('verify')

// ── Practise ────────────────────────────────────────────────────────────────
console.log('── Practise')
await page.getByRole('tab', { name: 'Practise' }).click()
await wait(400)
check((await page.locator('.ps-quiz-list > li').count()) === 9, 'nine practice questions')
const q0 = page.locator('.ps-q', { hasText: 'zero-sequence component' })
await q0.locator('input').fill('0.333')
await q0.getByRole('button', { name: 'Check' }).click()
await wait(200)
await page.locator('.ps-q', { hasText: 'In the zero-sequence network it appears as' }).locator('.ps-option', { hasText: '3·X_n' }).click()
await wait(200)
check(/2 of 9 answered correctly/.test(await text('.ps-quiz')), 'answers are checked and counted')
check(await noOverflow(), 'practise: no horizontal overflow')
await shot('practise')

// ── laptop width 1280 ───────────────────────────────────────────────────────
await page.setViewportSize({ width: 1280, height: 800 })
for (const md of ['', '?mode=explore', '?mode=experiment', '?mode=verify', '?mode=practise']) {
  await go(BASE + md)
  check(await noOverflow(), `1280 wide ${md || '(learn)'}: no horizontal overflow`)
}
await go(BASE + '?mode=explore')
await shot('explore-1280')

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
process.exit(failures.length ? 1 : 0)
