/**
 * Power Systems Module 3 — Per-Unit System in the browser: every mode (Learn tour, Explore bases and the impedance-
 * diagram build, Experiments, Verify, Practise), key computed numbers, activity completion, no console errors and no
 * horizontal overflow at 1440 and 1280 wide. Screenshots go to scripts/out/.
 * Run with the dev server on 5199: node scripts/smoke-powersys-per-unit.mjs
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
const PAGE = '#/subjects/power-systems/per-unit'
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
const text = (sel) => (sel.startsWith('svg') ? page.locator(sel).first().textContent() : page.locator(sel).first().innerText())
const acts = async () =>
  (await page.locator('.ps-acts summary').innerText())
    .match(/(\d+) of (\d+)/)
    ?.slice(1)
    .map(Number)
const shot = async (name) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: OUT + name, fullPage: true })
}

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── page ─────────────────────────────────────────────────────────────────────
console.log('── Module page')
await go(PAGE)
check((await page.locator('main h1').first().innerText()) === 'Per-Unit System', 'the module opens (ready, not planned)')
const tabs = await page.getByRole('tab').allInnerTexts()
check(tabs.join('|') === 'Learn|Explore|Experiment|Verify|Practise', `five modes: ${tabs.join(' · ')}`)
check(JSON.stringify(await acts()) === '[0,6]', 'six activities, none done')

// ── Learn ────────────────────────────────────────────────────────────────────
console.log('── Learn')
check(await page.locator('svg.ps-pu-dia').isVisible(), 'the zone diagram is shown')
check((await page.locator('svg.ps-pu-dia .ps-pu-zone').count()) === 4, 'four voltage zones')
check(/Step 1 of 8/i.test(await text('.ps-stepper')), 'the tour has eight steps')
const s1 = await text('.ps-step-body')
check(/0\.190 Ω/.test(s1) && /48\.4 Ω/.test(s1), 'step 1: T1 is 0.190 Ω and 48.4 Ω depending on the side (computed)')
check(/0\.190 Ω at 13\.8 kV/.test(await text('svg.ps-pu-dia')), 'the diagram shows T1’s ohms on both sides')
await shot('powersys-per-unit-learn-1.png')
await page.getByRole('button', { name: 'Next →' }).click()
await page.getByRole('button', { name: 'Next →' }).click()
await wait(150)
const s3 = await text('.ps-step-body')
check(/484\.0 Ω/.test(s3) && /0\.2624 kA/.test(s3), 'step 3: Z_base 484 Ω and I_base 0.2624 kA at 220 kV, 100 MVA')
check(/I_base 0\.2624 kA/.test(await text('svg.ps-pu-dia')), 'the zone header carries its base quantities')
await page.getByRole('button', { name: 'Next →' }).click()
await page.getByRole('button', { name: 'Next →' }).click()
await wait(150)
const s5 = await text('.ps-step-body')
check(/0\.1000 pu[\s\S]*0\.1000 pu/.test(s5) && /same per-unit value/.test(s5), 'step 5: T1 is 0.1000 pu from both sides')
await shot('powersys-per-unit-learn-5.png')
for (let k = 0; k < 3; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(120)
}
const s8 = await text('.ps-step-body')
check(/One base, one diagram/.test(await text('.ps-step-title')) && /4\.120\s*kA/.test(s8), 'the last step: town fault 4.120 kA from per unit')
check(JSON.stringify(await acts()) === '[1,6]', 'finishing the tour completes an activity')
check(await noOverflow(), 'no horizontal overflow (Learn)')
await shot('powersys-per-unit-learn-8.png')
await page.getByRole('button', { name: /Build the impedance diagram yourself/ }).click()
await wait(600)
check((await page.evaluate(() => location.hash)) === PAGE + '?mode=explore', 'the tour leads on to Explore')
check(/Step 1 of 9/i.test(await text('.ps-stepper')), '…straight into the diagram build')

// ── Explore: the impedance-diagram build ─────────────────────────────────────
console.log('── Explore · impedance diagram')
check((await page.locator('svg.ps-pu-dia .is-ghost').count()) >= 6, 'at the start every element is ghosted')
await page.getByRole('button', { name: 'Next →' }).click()
await wait(150)
check(/x″d on its own rating/.test(await text('.ps-step-title')) && /j0\.1667 pu/.test(await text('.ps-step-body')), 'G1: 0.2 on 120 MVA → j0.1667 pu')
await page.getByRole('button', { name: 'Next →' }).click()
await page.getByRole('button', { name: 'Next →' }).click()
await page.getByRole('button', { name: 'Next →' }).click()
await wait(150)
const t2 = await text('.ps-step-body')
check(/0\.0061 \+ j0\.1836 pu/.test(t2) && /0\.9524 : 1/.test(t2), 'T2: 0.0061 + j0.1836 pu with t = 0.9524 : 1')
check(/t = 0\.9524 : 1/.test(await text('svg.ps-pu-dia')), 'the off-nominal ratio is drawn on the diagram')
await shot('powersys-per-unit-diagram-t2.png')
for (let k = 0; k < 4; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await wait(120)
}
const fin = await text('.ps-step-body')
check(/checked against the engine/.test(await text('.ps-step-title')), 'the build ends with the engine cross-check')
check((fin.match(/✓ yes/g) ?? []).length === 5 && /Every branch agrees/.test(fin), 'all five branches agree with branchPu')
check((await page.locator('svg.ps-pu-dia .is-ghost').count()) === 0, 'the complete diagram')
await page.getByRole('radio', { name: 'Impedance diagram (R + jX)' }).click()
await wait(200)
check(/0\.0149 \+ j0\.1017/.test(await text('svg.ps-pu-dia')) && /jB\/2 0\.0813/.test(await text('svg.ps-pu-dia')), 'R + jX view: L1 0.0149 + j0.1017, B/2 0.0813')
check(JSON.stringify(await acts()) === '[2,6]', 'the diagram build completes an activity')
check(await noOverflow(), 'no horizontal overflow (diagram)')
await shot('powersys-per-unit-diagram.png')

// ── Explore: bases and zones ─────────────────────────────────────────────────
console.log('── Explore · bases and zones')
await page.getByRole('radio', { name: 'Bases and zones' }).click()
await wait(300)
const kA0 = (await text('.ps-pu-eqline')).match(/= ([\d.]+) kA$/)?.[1]
check(kA0 === '4.1197', `town fault 4.1197 kA on the network base (${kA0})`)
const sSlider = page.locator('.ps-slider', { hasText: 'S_base' }).locator('input')
await sSlider.fill('250')
await wait(200)
const eq250 = await text('.ps-pu-eqline')
check(/= 4\.1197 kA$/.test(eq250) && !/^I_f = 1\.1053 \/ 1\.4081/.test(eq250), 'S_base 250 MVA: per-unit values change, the kA do not')
check(/Z_base 193\.6 Ω/.test(await text('svg.ps-pu-dia')), 'Z_base of the 220 kV zone becomes 193.6 Ω')
await page.locator('.ps-pu-field').getByRole('radio', { name: '11 kV' }).click()
await wait(200)
check(/11 kV zone · reference/.test(await text('svg.ps-pu-dia')), 'the reference can move to another zone')
const vSlider = page.locator('.ps-slider', { hasText: 'V_base in the' }).locator('input')
await vSlider.fill('12')
await wait(200)
const dia = await text('svg.ps-pu-dia')
check(/V_base 240 kV/.test(dia) && /V_base 15\.055 kV/.test(dia), 'V_base 12 kV at 11 kV → 240 kV and 15.055 kV in the other zones')
check(/= 4\.1197 kA$/.test(await text('.ps-pu-eqline')), 'the fault current in kA still has not moved')
check(/✓ Worked in ohms/.test(await text('.ps-check')), 'the ohmic check agrees')
check(JSON.stringify(await acts()) === '[3,6]', 'trying all three completes the bases activity')
await page.getByRole('checkbox', { name: /rated ratios/ }).check()
await wait(200)
check(/= 4\.1197 kA$/.test(await text('.ps-pu-eqline')), 'bases following the rated ratios: still 4.1197 kA')
await page.getByRole('checkbox', { name: /rated ratios/ }).uncheck()
await page.getByRole('radio', { name: 'Ohms' }).click()
await wait(200)
check(/X 49\.2 Ω/.test(await text('svg.ps-pu-dia')), 'the ohms view: L1 X 49.2 Ω')
await page.getByRole('radio', { name: 'Per unit' }).click()
await page.locator('.ps-pu-more summary').click()
await wait(200)
check((await page.locator('.ps-pu-more table tbody tr').count()) === 4, 'the nameplate table converts G1, T1, T2 and T3')
check(await noOverflow(), 'no horizontal overflow (bases)')
await shot('powersys-per-unit-bases.png')
await page.getByRole('button', { name: /Reset to 100 MVA, 220 kV/ }).click()
await wait(200)
check(/Base: 100 MVA, 220 kV in the 220 kV zone/.test(await text('.ps-pu-figtitle')), 'Reset restores the network base')

// ── Experiment ───────────────────────────────────────────────────────────────
console.log('── Experiment')
await page.getByRole('tab', { name: 'Experiment' }).click()
await wait(500)
check((await page.locator('.ps-pu-exp-item').count()) === 6, 'six experiments')
check((await page.locator('.ps-table').count()) === 0, 'no numbers before a prediction')
await page.locator('.ps-option', { hasText: 'They double' }).click()
await wait(200)
check(/Your prediction was right/.test(await text('.ps-predict')), 'S_base ×2: per-unit impedances double (judged from the numbers)')
const tb = await text('.ps-table')
check(/T1 \|z\|\s*0\.1000 pu\s*0\.2000 pu/.test(tb) && /Fault at 11 kV: current\s*4\.1197 kA\s*4\.1197 kA\s*unchanged/.test(tb), 'table: T1 0.1000 → 0.2000 pu; fault 4.1197 kA unchanged')
await shot('powersys-per-unit-experiment.png')
await page.locator('.ps-pu-exp-item', { hasText: 'Look at T1' }).click()
await wait(200)
await page.locator('.ps-option', { hasText: 'Exactly the same' }).click()
await wait(200)
check(/Your prediction was right/.test(await text('.ps-predict')), 'T1 from either side: the same per unit')
await page.locator('.ps-pu-exp-item', { hasText: 'rated ratios' }).click()
await wait(200)
await page.locator('.ps-option', { hasText: 'stays' }).click()
await wait(200)
check(/Not quite/.test(await text('.ps-predict')) && /t = 1\.0000/.test(await text('.ps-predict')), 'a wrong prediction is corrected: the tap is absorbed (t = 1)')
check(JSON.stringify(await acts()) === '[4,6]', 'three experiments complete the activity')
check(await noOverflow(), 'no horizontal overflow (experiment)')
await shot('powersys-per-unit-experiment-tap.png')

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Verify')
await page.getByRole('tab', { name: 'Verify' }).click()
await wait(500)
const checks = await page.locator('.ps-check').allInnerTexts()
check(checks.length === 5 && checks.every((c) => c.startsWith('✓')), `every hand check passes (${checks.filter((c) => c.startsWith('✓')).length}/${checks.length})`)
check(/484\.0000 Ω/.test(await text('.ps-calc')) && /0\.262432 kA/.test(await text('.ps-calc')), 'base quantities 484 Ω and 0.262432 kA')
const v5 = await page.locator('.ps-calc', { hasText: 'One fault, three ways' }).innerText()
check(/In ohms 4\.1197 kA/.test(v5) && /= 4\.1197 kA on base A/.test(v5) && /= 4\.1197 kA on base B/.test(v5), 'town fault: 4.1197 kA in ohms and on both bases')
await page.getByRole('radio', { name: '220 kV, end of L1' }).click()
await wait(200)
check(/In ohms 0\.7126 kA/.test(await page.locator('.ps-calc', { hasText: 'One fault, three ways' }).innerText()), 'fault at the 220 kV end of L1: 0.7126 kA')
await page.locator('.ps-num-answer input').fill('0.3214')
await page.locator('.ps-num-answer').getByRole('button', { name: 'Check' }).click()
await wait(200)
check(/Correct/.test(await text('.ps-quiz')), 'the hand calculation is accepted')
check(JSON.stringify(await acts()) === '[5,6]', 'Verify completes its activity')
check(await noOverflow(), 'no horizontal overflow (verify)')
await shot('powersys-per-unit-verify.png')

// ── Practise ─────────────────────────────────────────────────────────────────
console.log('── Practise')
await page.getByRole('tab', { name: 'Practise' }).click()
await wait(500)
const qs = page.locator('.ps-quiz-list > li')
check((await qs.count()) === 9, 'nine questions')
const answers = { 0: '10.89', 1: '5.249', 3: '0.4', 4: '14.43', 5: '0.1017', 7: '4.12' }
const choices = { 2: 'S_base', 6: 'ratio squared', 8: 'doubles' }
for (let k = 0; k < 9; k++) {
  const q = qs.nth(k)
  if (answers[k] !== undefined) {
    await q.locator('input').fill(answers[k])
    await q.getByRole('button', { name: 'Check' }).click()
  } else await q.locator('.ps-option', { hasText: choices[k] }).click()
  await wait(80)
}
check(/9 of 9 answered correctly/.test(await text('.ps-quiz')), 'all nine answered from computed values')
check(JSON.stringify(await acts()) === '[6,6]', 'all six activities done')
check(await noOverflow(), 'no horizontal overflow (practise)')
await shot('powersys-per-unit-practise.png')

// ── 1280 wide ────────────────────────────────────────────────────────────────
console.log('── 1280 × 800')
await page.setViewportSize({ width: 1280, height: 800 })
for (const m of ['', '?mode=explore', '?mode=experiment', '?mode=verify', '?mode=practise']) {
  await go(PAGE + m)
  check(await noOverflow(), `no horizontal overflow at 1280 (${m || 'learn'})`)
}
await shot('powersys-per-unit-1280-practise.png')

// ── keyboard and reduced motion ──────────────────────────────────────────────
await go(PAGE + '?mode=explore')
await page.getByRole('radio', { name: 'Build the impedance diagram' }).focus()
await page.keyboard.press('Enter')
await wait(200)
check(/Step 1 of 9/i.test(await text('.ps-stepper')), 'the tools are keyboard-operable')

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed')
process.exit(failures.length ? 1 : 0)
