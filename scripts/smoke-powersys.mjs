/**
 * Power Systems subject in the browser: the subject page and its modules (built or planned, said truthfully), the
 * module page (modes in the address, activities, Ask panel) and Module 1 — Power Grid Explorer: the tour, both views,
 * selection and the inspector, operating breakers and loads, experiments, the hand checks and practice.
 * Run with the dev server on 5199: node scripts/smoke-powersys.mjs
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
const hash = () => page.evaluate(() => location.hash)
const h1 = () => page.locator('main h1').first().innerText()
const wait = (ms = 400) => page.waitForTimeout(ms)
const go = async (h) => {
  await page.goto(URL + h)
  await wait(700)
}
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── the subject ──────────────────────────────────────────────────────────────
console.log('── Subject')
await go('#/subjects/power-systems')
check((await h1()) === 'Power Systems', 'the subject page opens')
const cards = await page.locator('.subject-topic-card').allInnerTexts()
check(cards.length === 17, `seventeen modules listed (${cards.length})`)
check(/Engineer’s Challenge|Engineer's Challenge/.test(cards[cards.length - 1]), 'the Engineer’s Challenge is listed last')
check(/Grid Explorer[\s\S]*Interactive module · Learn · Explore · Experiment · Verify · Practise/.test(cards[0]), 'Module 1 is interactive and lists its modes')
const planned = cards.filter((c) => /Planned — not built yet/.test(c)).length
const ready = cards.filter((c) => /Interactive module/.test(c)).length
check(ready === 17 && planned === 0, `all seventeen modules are interactive, none planned (${ready}; planned ${planned})`)
check((await page.locator('.side-nav .side-subject', { hasText: 'Power Systems' }).count()) === 1, 'the sidebar lists Power Systems')

// ── the syllabus view: GATE EE / VIT Vellore / Combined ──────────────────────
console.log('── Syllabus')
const syl = page.locator('.ps-syl')
check((await syl.getByRole('radio', { name: 'Combined' }).getAttribute('aria-checked')) === 'true', 'the Combined learning path is the default')
const sumOf = async () => (await page.locator('.ps-syl-summary').innerText()).replace(/\s+/g, ' ')
const combined = await sumOf()
await syl.getByRole('radio', { name: 'GATE EE' }).click()
await wait(300)
const gateSum = await sumOf()
check(/topics named by GATE EE — (all \d+ taught in a module|\d+ taught in a module now, \d+ planned)/.test(gateSum) && gateSum !== combined, `choosing GATE EE shows its own coverage (${gateSum})`)
check((await syl.innerText()).includes('Economic load dispatch'), 'GATE EE includes economic load dispatch')
await syl.getByRole('radio', { name: 'VIT Vellore' }).click()
await wait(300)
check(/topics named by your VIT courses/.test(await sumOf()) && !(await syl.innerText()).includes('Economic load dispatch, without and with'), 'VIT (your courses BEEE304L and BEEE306L) leaves out the elective-only economic dispatch')
check((await syl.innerText()).includes('Sag and tension'), 'VIT includes sag and tension (BEEE304L Module 5)')
await page.reload()
await wait(900)
check((await page.locator('.ps-syl').getByRole('radio', { name: 'VIT Vellore' }).getAttribute('aria-checked')) === 'true', 'the chosen learning path is remembered')
const firstWords = page.locator('.ps-syl-words').first()
await firstWords.locator('summary').click()
check(/VIT BEEE304L/.test(await firstWords.innerText()) && /“/.test(await firstWords.innerText()), 'each topic shows the official wording on demand')
await page.locator('.ps-syl').getByRole('radio', { name: 'Combined' }).click()
await wait(200)
check((await page.locator('.ps-syl-sources a').count()) === 2, 'both official documents are linked')

// ── a module page ────────────────────────────────────────────────────────────
console.log('── Module page')
await page.locator('.subject-topic-card', { hasText: 'Grid Explorer' }).click()
await wait(900)
check((await hash()) === '#/subjects/power-systems/grid', 'a module opens at its own address')
check((await h1()) === 'Power Grid Explorer', 'module heading')
check(/Subjects.*Power Systems.*Power Grid Explorer/s.test((await page.locator('.crumbs li').allInnerTexts()).join(' ')), 'breadcrumbs: Subjects › Power Systems › module')
const tabs = await page.getByRole('tab').allInnerTexts()
check(tabs.join('|') === 'Learn|Explore|Experiment|Verify|Practise', `modes: ${tabs.join(' · ')}`)
check((await page.getByRole('tab', { name: 'Learn' }).getAttribute('aria-selected')) === 'true', 'Learn is the first mode')
await page.getByRole('tab', { name: 'Experiment' }).click()
await wait()
check((await hash()) === '#/subjects/power-systems/grid?mode=experiment', 'the mode is kept in the address')
await page.reload()
await wait(900)
check((await page.getByRole('tab', { name: 'Experiment' }).getAttribute('aria-selected')) === 'true', 'reloading keeps the mode')
await page.getByRole('tab', { name: 'Experiment' }).focus()
await page.keyboard.press('ArrowLeft')
await wait()
check((await hash()) === '#/subjects/power-systems/grid?mode=explore', 'arrow keys move between modes')
// Ask a doubt: opens with the module's context, closes with Esc (no question is sent here)
await page.getByRole('button', { name: 'Ask a doubt' }).click()
await wait()
check(await page.locator('#ps-ask').isVisible(), 'Ask a doubt opens beside the module')
await page.keyboard.press('Escape')
await wait()
check((await page.locator('#ps-ask').count()) === 0, 'Esc closes it')

// ── Learn: follow the electricity ────────────────────────────────────────────
console.log('── Learn')
await go('#/subjects/power-systems/grid')
check(await page.locator('.ps-phys').isVisible(), 'the physical view is shown first')
check(/Step 1 of 8/i.test(await page.locator('.ps-stepper').innerText()), 'the tour has eight steps')
check((await page.locator('.ps-phys .ps-el.is-dim').count()) > 0 && (await page.locator('.ps-phys .ps-el.is-hl').count()) > 0, 'each step points at its part of the grid (others dimmed)')
const step1 = await page.locator('.ps-step-body').innerText()
check(/28\.6 MW/.test(step1) && /1177 A/.test(step1), 'the numbers in the story come from the load flow (28.6 MW, 1177 A)')
for (let k = 0; k < 7; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(150)
}
check(/The whole journey/.test(await page.locator('.ps-step-title').innerText()), 'the tour ends with the whole journey')
check(/1 of 5/.test(await page.locator('.ps-acts summary').innerText()), 'finishing the tour completes an activity')
await page.locator('.ps-tour').getByRole('button', { name: /Operate the grid yourself/ }).click()
await wait()
check((await hash()) === '#/subjects/power-systems/grid?mode=explore', 'the tour leads on to Explore')

// ── Explore ──────────────────────────────────────────────────────────────────
console.log('── Explore')
check(/28\.64\s*MW/.test(await page.locator('.ps-readouts').first().innerText()), 'summary: 28.64 MW generated')
await page.locator('.ps-phys [aria-label="Step-up transformer T1"] .ps-tank').click()
await wait()
check((await page.locator('.ps-inspector h3').innerText()) === 'Step-up transformer T1', 'selecting a part in the picture opens it in the inspector')
check(/Current\s*74\s*A/i.test(await page.locator('.ps-inspector').innerText()), 'the inspector shows its live values (74 A on the 220 kV side)')
await page.locator('.ps-toolbar').getByRole('radio', { name: 'Single-line diagram' }).click()
await wait()
check(await page.locator('svg.ps-sld:not(.ps-phys)').isVisible(), 'the single-line diagram replaces the picture')
check((await page.locator('svg.ps-sld [aria-label="Step-up transformer T1"]').getAttribute('aria-pressed')) === 'true', 'the selection is the same component in both views')
// keyboard selection
await page.locator('svg.ps-sld [aria-label="33 kV line L2"]').focus()
await page.keyboard.press('Enter')
await wait()
check((await page.locator('.ps-inspector h3').innerText()) === '33 kV line L2', 'a part can be selected with the keyboard')
// operate a breaker
await page.locator('.ps-breakers').getByRole('button', { name: 'CB2 closed' }).click()
await wait()
const sum = await page.locator('.ps-readouts').first().innerText()
check(/16\.0 MW without supply/.test(sum), 'opening CB2 leaves the town (16 MW) without supply')
check((await page.locator('svg.ps-sld [aria-label^="Town 11 kV feeders"]').getAttribute('aria-label')).includes('not energised'), 'the town’s bus is de-energised on the diagram')
check((await page.locator('svg.ps-sld .ps-el.is-dead').count()) >= 3, 'de-energised parts are drawn dead')
await page.locator('.ps-breakers').getByRole('button', { name: 'Reset' }).click()
await wait()
check(!/without supply/.test(await page.locator('.ps-readouts').first().innerText()), 'Reset restores the network')
// heavy load → voltage warning and overload
const town = page.locator('.ps-slider', { hasText: 'Town demand' }).locator('input')
await town.fill('30')
await wait()
const warnings = await page.locator('.ps-callout').allInnerTexts()
check(warnings.some((w) => /Voltage outside the normal band/.test(w)) && warnings.some((w) => /Overload/.test(w)), 'a 30 MW town drops the voltage and overloads T3 — both are flagged')
await page.locator('.ps-breakers').getByRole('button', { name: 'Reset' }).click()
await wait()
// inspect five parts → activity
for (const name of ['Generator G1', 'Grid transformer T2', 'Factory', 'Distribution transformer T3']) {
  await page.locator(`svg.ps-sld [aria-label^="${name}"]`).first().click()
  await wait(120)
}
// five distinct parts selected (T1, L2 and these four) → the activity is ticked
await page.locator('.ps-acts summary').click()
check(/✓ Inspect five parts/.test(await page.locator('.ps-acts ul').innerText()), 'the activity list ticks it')
await page.locator('.ps-acts summary').click()
check(await noOverflow(), 'no horizontal overflow')
await page.screenshot({ path: OUT + 'powersys-explore.png', fullPage: true })

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await page.getByRole('tab', { name: 'Experiment' }).click()
await wait()
check((await page.locator('.ps-exp-item').count()) === 6, 'six experiments')
check((await page.locator('.ps-table').count()) === 0, 'no answer before a prediction')
await page.locator('.ps-option', { hasText: 'It falls a lot' }).click()
await wait()
check(/Your prediction was right/.test(await page.locator('.ps-predict').innerText()), 'the prediction is judged from the solved network')
const table = await page.locator('.ps-table').innerText()
check(/Town voltage \(11 kV bus\)\s*11\.12 kV\s*8\.12 kV/.test(table), 'before / after: the town falls from 11.12 kV to 8.12 kV')
for (const id of ['Open breaker CB2', 'Transmit at 33 kV']) {
  await page.locator('.ps-exp-item', { hasText: id }).click()
  await wait()
  await page.locator('.ps-option').first().click()
  await wait()
}
check(/No operating point at 33 kV/.test(await page.locator('main').innerText()), 'transmitting at 33 kV: no operating point, said plainly')
check(/V²\/X/.test(await page.locator('.ps-predict').innerText()), 'and why (the V²/X limit, computed)')
check(/3 of 5|4 of 5/.test(await page.locator('.ps-acts summary').innerText()), 'three experiments complete an activity')

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await page.getByRole('tab', { name: 'Verify' }).click()
await wait()
check((await page.locator('.ps-check--ok').count()) === 4 && (await page.locator('.ps-check--bad').count()) === 0, 'all four hand checks agree with the solver')
// invalid entries are explained, not silently ignored, and never judged
const answer = page.locator('.ps-num-answer input')
const checkBtn = page.locator('.ps-num-answer').getByRole('button', { name: 'Check' })
const invalidMsg = page.locator('.ps-q .ps-invalid')
await checkBtn.click()
await wait(200)
check((await invalidMsg.innerText().catch(() => '')) === 'Enter a number in A first.' && (await invalidMsg.getAttribute('role')) === 'alert', 'an empty answer: “Enter a number in A first.” (announced)')
await answer.fill('abc')
await checkBtn.click()
await wait(200)
const q0 = await page.locator('.ps-q').first().innerText()
check(/“abc” is not a number/.test(q0) && !/Correct|Not yet/.test(q0), 'an alphabetic answer: explained, and not judged right or wrong')
check((await answer.getAttribute('aria-invalid')) === 'true' && (await answer.getAttribute('aria-describedby')) === (await invalidMsg.getAttribute('id')), 'the field is marked invalid and points to the message')
await answer.fill('7')
await wait(150)
check((await invalidMsg.count()) === 0 && (await answer.getAttribute('aria-invalid')) === null, 'editing the answer clears the message')
await answer.fill('1e9')
await checkBtn.click()
await wait(200)
check(/✗ Not yet/.test(await page.locator('.ps-q').first().innerText()) && (await invalidMsg.count()) === 0, 'an out-of-range number is judged wrong (not invalid)')
await answer.fill('73.8')
await checkBtn.click()
await wait()
check(/✓ Correct/.test(await page.locator('.ps-quiz').innerText()), 'the student’s own calculation is checked')

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await page.getByRole('tab', { name: 'Practise' }).click()
await wait()
check((await page.locator('.ps-quiz-list > li').count()) === 7, 'seven practice questions')
await page.locator('.ps-q', { hasText: 'Why is bulk power transmitted' }).locator('.ps-option', { hasText: 'losses grow with current squared' }).click()
await wait()
check(/1 of 7 answered correctly/.test(await page.locator('.ps-quiz').innerText()), 'answers are checked and counted')

// ── planned modules, progress ────────────────────────────────────────────────
console.log('── Planned modules and progress')
const plannedCard = cards.findIndex((c) => /Planned — not built yet/.test(c))
if (plannedCard >= 0) {
  await go('#/subjects/power-systems')
  await page.locator('.subject-topic-card').nth(plannedCard).click()
  await wait(900)
  check(/planned and not built yet/.test(await page.locator('main').innerText()) && (await page.getByRole('tab').count()) === 0, 'a planned module says so and offers nothing to run')
}
await go('#/progress')
const ps = await page.locator('.subject-progress-card', { hasText: 'Power Systems' }).innerText()
check(/\d+ of \d+ activities done/.test(ps) && !/^0 of/.test(ps.split('\n').pop()), `Progress shows Power Systems activities (${ps.replace(/\s+/g, ' ')})`)
await go('#/subjects/power-systems')
check((await page.locator('.subject-continue').count()) === 1, 'the subject offers Continue learning')

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
process.exit(failures.length ? 1 : 0)
