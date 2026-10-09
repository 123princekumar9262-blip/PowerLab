/**
 * Platform shell (redesign Phase 1): navigation, Home, Labs, landing pages, routing and redirects,
 * Continue learning, the information level, search, Back, and no horizontal overflow on a phone.
 * Covers the ten Phase 1 validation tests. Run with the dev server on 5199: node scripts/smoke-shell.mjs
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

await page.goto(URL)
await page.evaluate(() => localStorage.clear())
await page.reload()
await wait(600)

// ── Home (first visit) ────────────────────────────────────────────────────────
console.log('── Home')
check((await hash()) === '#/home', 'the empty address opens Home (#/home)')
check((await h1()) === 'Power Electronics Lab', 'Home heading')
check(/Start here/i.test(await page.locator('.hero').innerText()), 'first visit: "Start here", no Continue yet')
check((await page.locator('.hero').count()) === 1, 'exactly one hero activity')
check((await page.locator('main canvas, main .scope-canvas, main svg.buck-diagram').count()) === 0, 'Home shows no waveforms or circuits')
for (const g of ['Conversion', 'Foundations', 'Systems']) check(await page.locator('.group-title', { hasText: g }).first().isVisible(), `Home groups the labs: ${g}`)
check((await page.locator('.home-section .lab-card').count()) === 10, 'Home lists the ten labs')
check((await page.locator('.lpath-step--recommended').innerText()).includes('Rectifiers'), 'learning path recommends Rectifiers first')
check(/recommendation/i.test(await page.locator('.home-section', { hasText: 'learning path' }).innerText()), 'the path is presented as a recommendation, not a gate')
// Home explains the app: what it is, how it works, what each mode is for, what each group means
check(/simulated, never drawn by hand/.test(await page.locator('.page-lead').innerText()), 'Home says what the app is: real simulation')
check((await page.locator('.how-steps li').count()) === 3, 'How it works: three steps (choose · change · ask WHY)')
const how = await page.locator('.home-section', { hasText: 'How it works' }).innerText()
for (const m of ['Explore', 'Learn', 'Experiment', 'Predict']) check(how.includes(m), `How it works explains the ${m} mode`)
check((await page.locator('.group-line').count()) === 3, 'each group of labs has a one-line meaning')
await page.screenshot({ path: `${OUT}shell-home.png`, fullPage: true })

// ── TEST 1: Home → Rectifiers → Three-phase → 6-pulse bridge ─────────────────
console.log('── Test 1')
await page.getByRole('link', { name: /^Rectifiers/ }).first().click()
await wait()
check((await hash()) === '#/labs/rectifiers', 'Rectifiers landing (#/labs/rectifiers)')
check(await page.locator('.group-title', { hasText: 'Three-phase' }).isVisible(), 'landing page groups circuits: Three-phase')
await page.getByRole('link', { name: /^6-pulse bridge/ }).click()
await page.waitForSelector('.scope-canvas canvas')
await wait(500)
check((await hash()).startsWith('#/labs/rectifiers/3ph-6pulse'), 'the circuit has its own address')
check((await page.getByRole('button', { name: /Run simulation/ }).count()) === 0, 'no Run step: the circuit opens running')
check(/D\d \+ D\d conducting/i.test(await page.locator('.wp-status-line').innerText()), 'the 6-pulse bridge is simulated (conducting pair shown)')
check(await page.getByRole('link', { name: 'Back to Rectifiers' }).isVisible(), 'a back link to the lab is always there')
// the first workspace visit explains the workspace: four numbered steps marked on their regions
check(await page.locator('.ws-guide').isVisible(), 'first visit: "How this lab works" is shown')
check((await page.locator('.ws-guide-steps li').count()) === 4, 'the guide has four steps (values · circuit · waveforms · WHY)')
check((await page.locator('.ws-params .ws-mark, .ws-bench > .ws-mark, .ws-wave > .ws-mark, .ws-actions .ws-mark').count()) === 4, 'each step is marked on its region (1 values, 2 circuit, 3 waveforms, 4 WHY)')
check(/Predict/.test(await page.locator('.ws-guide-modes').innerText()), 'the guide says what each of the lab’s modes is for')
await page.locator('.ws-guide').getByRole('button', { name: 'Got it' }).click()
await wait(200)
check((await page.locator('.ws-guide').count()) === 0 && (await page.locator('.ws-mark').count()) === 0, '“Got it” closes the guide and its marks')
await page.getByRole('button', { name: 'How to use' }).click()
await wait(200)
check(await page.locator('.ws-guide').isVisible(), '“How to use” opens the guide again')
await page.getByRole('button', { name: 'How to use' }).click()
await wait(200)
check((await page.locator('.ws-guide').count()) === 0, '… and closes it')
check((await page.locator('.ws-level-label').innerText()) === 'Detail', 'the level control is labelled “Detail”')
await page.screenshot({ path: `${OUT}shell-workspace.png` })

// ── TEST 10: Back ────────────────────────────────────────────────────────────
console.log('── Test 10')
await page.goBack()
await wait()
check((await hash()) === '#/labs/rectifiers', 'Back → the landing page')
await page.goBack()
await wait()
check((await hash()) === '#/home', 'Back → Home')
await page.goForward()
await wait()
check((await hash()) === '#/labs/rectifiers', 'Forward → the landing page again')

// ── TEST 6: Continue learning ────────────────────────────────────────────────
console.log('── Test 6')
await page.goto(URL + '#/home')
await wait()
const hero = await page.locator('.hero').innerText()
check(/Continue learning/i.test(hero) && hero.includes('6-pulse bridge'), 'Home now offers to continue the 6-pulse bridge')
await page.goto(URL + '#/labs/dc-dc/buck/learn')
await wait(900)
await page.getByRole('button', { name: /How a buck converter works/ }).first().click()
await wait()
await page.getByRole('button', { name: /Next/ }).first().click()
await wait()
await page.goto(URL + '#/home')
await wait()
check(/Buck/.test(await page.locator('.hero').innerText()) && /step 2 of/.test(await page.locator('.hero').innerText()), 'Continue remembers lab, circuit, mode and lesson step')
await page.locator('.hero a').click()
await wait(900)
check((await hash()).startsWith('#/labs/dc-dc/buck/learn?lesson='), 'Continue reopens the lesson')
check((await page.locator('.lesson-text').count()) > 0, 'the lesson is shown again')
await page.goto(URL + '#/home')
await wait()
check((await page.locator('.recent li').count()) >= 1 && (await page.locator('.recent li').count()) <= 4, 'Recent lists 1–4 items')

// ── TEST 2: Home → DC-DC → Buck ──────────────────────────────────────────────
console.log('── Test 2')
await page.getByRole('link', { name: /^DC-DC Converters/ }).first().click()
await wait()
check((await hash()) === '#/labs/dc-dc', 'DC-DC landing')
const buckCard = page.getByRole('link', { name: /^Buck Step a DC voltage down/ })
check(await buckCard.isVisible(), 'Buck is an open (ready) card')
check(await page.getByLabel('Ćuk, coming soon').isVisible(), 'unbuilt converters are labelled coming soon, not links')
await buckCard.click()
await wait(900)
check((await hash()) === '#/labs/dc-dc/buck', 'Buck workspace opens')
check(await page.locator('.buck-diagram').isVisible(), 'the buck circuit is shown')

// ── TEST 3: Practice (the engineering practice area, #/engineering) ──────────
console.log('── Test 3')
await page.locator('.shell-nav').getByRole('link', { name: 'Practice' }).click()
await wait()
check((await hash()) === '#/engineering' && (await h1()) === 'Practice', 'Practice opens the practice area')
const eng = await page.locator('main').innerText()
for (const a of ['Design', 'Challenge', 'Reverse Engineering', 'Fault Diagnosis', 'Interview']) check(eng.includes(a), `practice area lists ${a}`)
check(!/junction|heatsink/i.test(eng), 'Practice is not the losses/thermal lab')
await page.getByRole('link', { name: /^Design/ }).click()
await wait()
check((await hash()) === '#/engineering/design' && /Coming soon/i.test(await page.locator('main').innerText()), 'Design is honest: coming soon')
await page.goto(URL + '#/engineering/challenge')
await wait()
await page.getByRole('link', { name: /Open Challenge/ }).click()
await wait(900)
check((await hash()).includes('/challenge'), 'Challenge opens the rectifier workspace in Challenge mode')

// ── TESTS 4, 5: legacy addresses ─────────────────────────────────────────────
console.log('── Tests 4, 5')
await page.goto(URL + '#engineering')
await wait(600)
check((await hash()).startsWith('#/labs/thermal'), '#engineering → Losses & Thermal')
check((await h1()) === 'Losses & Thermal' && (await page.locator('.notice').isVisible()), 'the moved lab explains where Engineering went')
await page.goto(URL + '#dcdc')
await wait(600)
check((await hash()) === '#/labs/dc-dc', '#dcdc → DC-DC lab')
for (const [old, now] of [['#pwm', '#/labs/pwm'], ['#inverters', '#/labs/inverters'], ['#control', '#/labs/control'], ['#ev', '#/labs/ev']]) {
  await page.goto(URL + old)
  await wait(400)
  check((await hash()) === now, `${old} → ${now}`)
}
await page.goto(URL + '#/somewhere/else')
await wait()
check((await h1()) === 'Page not found', 'unknown addresses show "Page not found" with a way home')

// ── TEST 7: information level persists ───────────────────────────────────────
console.log('── Test 7')
await page.goto(URL + '#/settings')
await wait()
for (const lvl of ['Beginner', 'Standard', 'Engineer']) {
  await page.getByRole('radio', { name: new RegExp(`^${lvl}`) }).click()
  await page.reload()
  await wait()
  check((await page.locator('[role=radio][aria-checked=true]').innerText()).startsWith(lvl), `level "${lvl}" persists after a refresh`)
}
await page.goto(URL + '#/labs/pwm/lab')
await wait(900)
check((await page.locator('.ws-level select').inputValue()) === 'engineer', 'a workspace opens at the chosen level')
await page.locator('.ws-level select').selectOption('beginner')
await page.goto(URL + '#/settings')
await wait()
check((await page.locator('[role=radio][aria-checked=true]').innerText()).startsWith('Beginner'), 'the workspace shortcut and Settings stay in step')

// ── TEST 9: Labs catalogue is truthful ───────────────────────────────────────
console.log('── Test 9')
await page.goto(URL + '#/labs')
await wait()
check((await page.locator('.lab-card').count()) === 10, 'ten labs in the catalogue')
for (const g of ['Conversion', 'Foundations', 'Systems']) check(await page.locator('.group-title', { hasText: g }).isVisible(), `catalogue group ${g}`)
// every ready card on every landing page opens a working workspace
const labs = await page.locator('.lab-card').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
let opened = 0
let total = 0
for (const l of labs) {
  await page.goto(URL + l)
  await wait(250)
  const cards = await page.locator('a.topic-card').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
  for (const c of cards) {
    total++
    await page.goto(URL + c)
    await page.waitForSelector('.scope-canvas canvas, .cscope canvas, .compare-lab, .dc-lab', { timeout: 8000 }).catch(() => {})
    const ok = (await page.locator('.scope-canvas canvas, .cscope canvas, .compare-lab, .dc-lab').count()) > 0
    if (!ok) check(false, `ready card ${c} opens a working workspace`)
    else opened++
  }
}
check(total > 30 && opened === total, `every READY card opens a working workspace (${opened} of ${total})`)

// ── Search ────────────────────────────────────────────────────────────────────
console.log('── Search')
await page.goto(URL + '#/home')
await wait()
await page.keyboard.press('Control+k')
await page.keyboard.type('svpwm')
await wait(200)
check(/SVPWM/.test(await page.locator('.palette-list').innerText()), 'search finds SVPWM')
await page.keyboard.press('Enter')
await wait(900)
check((await hash()) === '#/labs/inverters/svpwm', 'Enter opens the result')
await page.locator('.shell-search').click()
await page.keyboard.type('commutation overlap')
await wait(200)
await page.keyboard.press('Enter')
await wait(1200)
check((await hash()).startsWith('#/labs/rectifiers/3ph-6pulse'), 'concept search opens the right circuit')
check(await page.locator('.wv-analyze').isVisible() && (await page.locator('.wv-analyze [role=tab][aria-selected=true]').innerText()).startsWith('Commutation'), '… with Measurements & theory opened on commutation')
await page.keyboard.press('Escape')

// ── TEST 8: phone width, no horizontal overflow; tablet ──────────────────────
console.log('── Test 8')
for (const [w, hgt, tag] of [[390, 844, 'mobile'], [820, 1180, 'tablet']]) {
  const p = await browser.newPage({ viewport: { width: w, height: hgt } })
  p.on('pageerror', (e) => errors.push(String(e)))
  for (const route of ['#/home', '#/labs', '#/labs/rectifiers', '#/labs/ev', '#/engineering', '#/engineering/fault', '#/progress', '#/settings', '#/labs/rectifiers/1ph-bridge', '#/labs/dc-dc/buck', '#/labs/inverters/svpwm']) {
    await p.goto(URL + route)
    await p.waitForTimeout(700)
    const sw = await p.evaluate(() => document.documentElement.scrollWidth)
    if (sw > w) check(false, `${tag} ${route}: page is ${sw}px wide at ${w}px`)
  }
  check(true, `${tag} (${w}px): no horizontal page overflow on 11 routes`)
  await p.goto(URL + '#/home')
  await p.waitForTimeout(500)
  if (w < 900) {
    check(await p.locator('.shell-menu-btn').isVisible(), `${tag}: compact header with a menu button`)
    await p.locator('.shell-menu-btn').click()
    check(await p.locator('.menu-sheet').getByRole('link', { name: 'Labs' }).isVisible(), `${tag}: the menu holds the navigation`)
    const tgt = await p.locator('.shell-menu-btn').boundingBox()
    check(tgt.width >= 36 && tgt.height >= 36, `${tag}: touch target ${Math.round(tgt.width)}×${Math.round(tgt.height)}`)
  }
  await p.screenshot({ path: `${OUT}shell-home-${tag}.png`, fullPage: true })
  await p.goto(URL + '#/labs/rectifiers')
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${OUT}shell-landing-${tag}.png`, fullPage: true })
  await p.close()
}

await browser.close()
check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL SHELL CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
