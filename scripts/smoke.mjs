/**
 * End-to-end smoke test in a real browser (Playwright driving Microsoft Edge/Chromium).
 * Walks the guided flow and checks that the UI reflects the simulation:
 *   choose → run → move cursor → circuit/state update → WHY → events → step → play → params.
 *
 * Usage: start the app (npm run dev -- --port 5199), then `npm run smoke`.
 * Screenshots land in scripts/out/.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const APP_URL = process.env.LAB_URL ?? 'http://localhost:5199/'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const errors = []
const failures = []
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.log(`  ✗ ${msg}`)
    failures.push(msg)
  }
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

// Entry (Phase 1 of the redesign): Home → Rectifiers → Half-wave opens the circuit already running.
await page.goto(APP_URL + '#/home')
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('pel.prefs', JSON.stringify({ level: 'standard' })) })
await page.goto(APP_URL + '#/labs/rectifiers/1ph-half-wave?load=R')
await page.reload()
await page.waitForSelector('.scope-canvas canvas')
await page.screenshot({ path: OUT + '01-intro.png' })
check((await page.getByRole('button', { name: /Run simulation/ }).count()) === 0, 'opening a circuit runs it at once — no separate Run step')
check(await page.getByRole('heading', { level: 1, name: 'Single-phase half-wave' }).isVisible(), 'the route opened the half-wave rectifier (workspace header)')
await page.screenshot({ path: OUT + '02-chosen.png' })
await page.waitForTimeout(300)
await page.screenshot({ path: OUT + '03-run.png' })

// The simplified workspace (Phase 4): modes as tabs (+ "More"), WHY, and one Explore menu.
const MENU = { 'Current path': 'Show current path', Inspect: 'Inspect a component', Analyze: 'Measurements & theory', Measurements: 'Measurements & theory', Energy: 'Energy', Events: 'Switching events', State: 'State details', Focus: 'Focus view' }
const explore = async (name) => {
  await page.locator('.ws-explore-btn').click()
  await page.locator('.ws-explore-menu').getByRole(/Show current path|Focus/.test(name) ? 'menuitemcheckbox' : 'menuitem', { name }).click()
  await page.waitForTimeout(150)
}
const menuItems = async () => {
  await page.locator('.ws-explore-btn').click()
  const items = await page.locator('.ws-explore-menu [role^=menuitem]').allInnerTexts()
  await page.keyboard.press('Escape')
  return items.map((x) => x.replace(/[✓⚠]/g, '').trim().split('\n').pop().trim())
}
const mode = (name) => ({
  click: async () => {
    if (['Explore', 'Learn', 'Experiment'].includes(name)) await page.locator('.ws-modes-tabs').getByRole('tab', { name, exact: true }).click()
    else {
      await page.locator('.ws-more-modes summary').click()
      await page.locator('.ws-more-modes').getByRole('button', { name, exact: true }).click()
    }
    await page.waitForTimeout(150)
  },
})
const why = () => page.locator('.ws-act--why')
const openWhy = async () => {
  if (!(await page.locator('.wv-why').count())) await why().click()
  if (!(await page.locator('.wv-more').count())) await page.locator('.wv-more-btn').click()
}
const openState = async () => {
  if (!(await page.locator('.ov .state-headline').count())) await explore('State details')
}
const action = (name) => ({
  click: async () => (name === 'WHY' ? openWhy() : explore(MENU[name])),
  count: async () => (name === 'WHY' ? why().count() : (await menuItems()).includes(MENU[name]) ? 1 : 0),
  innerText: async () => page.locator('.ws-explore-btn').innerText(),
})
const panelTab = (name) => ({
  click: async () => {
    if (name === 'State') return openState()
    if (name === 'Why') return openWhy()
    // the mode's own panel (lesson, experiment…) is always on the page: close whatever covers it
    if (await page.locator('.ws-side .ov').count()) await page.locator('.ws-side .ov-close').click()
  },
})
const headline = async () => {
  await openState()
  return page.locator('.ov .state-headline').innerText()
}
const stateTime = () => page.locator('.wp-status-line').innerText()
const measureRow = async (tab, label) => {
  await action('Analyze').click()
  await page.locator('.wv-analyze').getByRole('tab', { name: tab }).click()
  const v = (await page.locator('.wv-analyze tr', { hasText: label }).first().locator('td').first().innerText()).trim()
  await page.keyboard.press('Escape')
  return v
}

check(/ON/.test(await headline()), `initial cursor (first positive peak) shows D1 ON — "${await headline()}"`)
check((await page.locator('.circuit--on').count()) === 1, 'circuit diagram shows the ON state')
check((await page.locator('.circuit .flow').count()) >= 1, 'current-flow particles are present while conducting')

// Drag the cursor into the negative half-cycle of cycle 1 (θ ≈ 270° → t ≈ 15 ms of 80 ms).
const overlay = page.locator('.scope-layer--overlay')
await overlay.scrollIntoViewIfNeeded() // the platform module bar pushes the scope lower on a 900 px viewport
const box = await overlay.boundingBox()
const plotLeft = box.x + 58
const plotRight = box.x + box.width - 14
const xAt = (t) => plotLeft + (t / 0.08) * (plotRight - plotLeft)
await page.mouse.move(xAt(0.005), box.y + 150)
await page.mouse.down()
await page.mouse.move(xAt(0.015), box.y + 150, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(150)
await page.screenshot({ path: OUT + '04-negative.png' })
check(/OFF/.test(await headline()) && /reverse/.test(await headline()), `negative half-cycle shows D1 OFF, reverse biased — "${await headline()}"`)
check((await page.locator('.circuit--off').count()) === 1, 'circuit diagram shows the OFF state')
check((await page.locator('.circuit .flow').count()) === 0, 'no current-flow animation while blocking')
const strip = await page.locator('.wp-status-line').innerText()
check(/Vo = 0\.000 V/.test(strip) && /Io = 0\.000 A/.test(strip), 'Vout = 0 and Io = 0 while OFF (status line)')

// WHY: short answer first, the full causal chain on request
await action('WHY').click()
await page.waitForTimeout(100)
check((await page.locator('.why-steps li').count()) === 5, 'WHY? shows a five-step answer')
await page.getByRole('button', { name: 'Show detailed explanation' }).click()
const chain = await page.locator('#why-chain').innerText()
check(/Circuit condition/i.test(chain) && /reverse biased/.test(chain), 'detailed WHY explains the reverse-biased state')
await page.screenshot({ path: OUT + '05-why.png', fullPage: false })

// Events panel (action bar): click the first switching event → WHAT HAPPENED / WHY
await action('Events').click()
await page.locator('.wv-event').first().click()
await page.waitForTimeout(150)
check((await page.locator('.ov .wv-event-detail').count()) === 1, 'clicking an event opens WHAT HAPPENED / WHY')
const evText = await page.locator('.wv-event-detail').innerText()
check(/What happened\?/i.test(evText) && /Why did it happen\?/i.test(evText), 'event detail has both sections')
await page.screenshot({ path: OUT + '06-event.png' })
await page.keyboard.press('Escape')

// Step forward through events: time must advance monotonically.
const t0 = await stateTime()
await page.getByRole('button', { name: 'Step forward' }).click()
await page.waitForTimeout(80)
const t1 = await stateTime()
await page.getByRole('button', { name: 'Step forward' }).click()
await page.waitForTimeout(80)
const t2 = await stateTime()
check(t0 !== t1 && t1 !== t2, `step forward advances the instant`)
await page.getByRole('button', { name: 'Step backward' }).click()
await page.waitForTimeout(80)
check((await stateTime()) === t1, 'step backward returns to the previous event')

// Angle stepping: 15° increments
await page.getByRole('radio', { name: '15°' }).click()
await page.getByRole('button', { name: 'Step forward' }).click()
await page.waitForTimeout(80)
const theta = (await stateTime()).match(/θ = ([\d.]+)°/)?.[1]
const rem = Number(theta) % 15
check(theta !== undefined && Math.min(rem, 15 - rem) < 0.2, `15° stepping lands on a 15° multiple (θ = ${theta}°)`)

// Playback moves the cursor
await page.getByRole('button', { name: 'Play' }).click()
await page.waitForTimeout(700)
const tp1 = await stateTime()
await page.waitForTimeout(500)
const tp2 = await stateTime()
await page.getByRole('button', { name: 'Pause' }).click()
check(tp1 !== tp2, `playback advances time`)

// Parameters: change R from 10 Ω to 100 Ω → peak current must drop 10× (Measurements → Load).
const before = await measureRow('Current', 'Peak current')
const rInput = page.getByLabel(/^Resistance/).last()
await rInput.fill('100')
await rInput.press('Enter')
await page.waitForTimeout(200)
const after = await measureRow('Current', 'Peak current')
check(before !== after, `changing R re-runs the simulation (Io,pk ${before} → ${after})`)
const num = (s) => parseFloat(s) * (/mA/.test(s) ? 1e-3 : 1)
// Displayed values are rounded to 4 significant figures, so allow 0.5 %.
check(Math.abs(num(before) / num(after) / 10 - 1) < 0.005, 'Io,pk scales as 1/R')

// Invalid typed input is rejected, not propagated.
await rInput.fill('abc')
await rInput.press('Enter')
await page.waitForTimeout(100)
check((await rInput.inputValue()) === '100', 'non-numeric input is rejected and the last valid value restored')

// Coarse timestep with a half-sample phase → theory flag appears (visible without opening anything).
await page.locator('details.advanced > summary').click()
await page.getByLabel(/^Phase/).last().fill('11.25')
await page.getByLabel(/^Phase/).last().press('Enter')
await page.getByRole('radio', { name: 'Manual' }).click()
const dtInput = page.getByLabel(/^Manual Δt/).last()
await dtInput.fill('1250')
await dtInput.press('Enter')
await page.waitForTimeout(200)
check((await page.locator('.flag[role="alert"]').count()) === 1, 'coarse timestep raises the "disagrees with theory" alert')
check(/⚠/.test(await action('Analyze').innerText()), 'the Explore button (Measurements & theory) carries the warning')
await page.screenshot({ path: OUT + '07-flag.png' })
await page.getByRole('radio', { name: /Auto/ }).click()
await page.waitForTimeout(200)
check((await page.locator('.flag[role="alert"]').count()) === 0, 'auto timestep clears the flag')

// Frequency change: 60 Hz → ripple frequency row shows 60 Hz (Measurements → Output).
const fInput = page.getByLabel(/^Frequency/).last()
await fInput.fill('60')
await fInput.press('Enter')
await page.waitForTimeout(200)
const ripple = await measureRow('Ripple', 'Ripple frequency')
check(/^60\.000 Hz/.test(ripple), `ripple frequency follows the source (${ripple})`)

// Ideal diode — the conduction angle is in Measurements → Timing (Engineer level)
await page.getByRole('radio', { name: 'Ideal' }).click()
await page.locator('.ws-level select').selectOption('engineer')
await page.waitForTimeout(200)
const gamma = await measureRow('Timing', 'Conduction angle')
check(/^180\.00°/.test(gamma), `ideal diode conduction angle = 180° (${gamma})`)
await page.locator('.ws-level select').selectOption('standard')

const body = await page.locator('body').innerText()
check(!/NaN|Infinity|undefined/.test(body), 'no NaN / Infinity / undefined anywhere on the page')
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: OUT + '08-final.png', fullPage: true })

// ── Phase 2–7: every circuit, graph layouts, inductor hold-on, energy view ─────────────
await page.evaluate(() => window.scrollTo(0, 0))
// the circuit is chosen in the header's "Change circuit" menu (its own address); the load in Basic
const pick = async (topo, load) => {
  const title = (await page.locator('.ws-head h1').innerText()).trim()
  const want = { 'Half-wave': 'Single-phase half-wave', 'Center-tapped': 'Single-phase center-tapped', Bridge: 'Single-phase bridge' }[topo]
  if (title !== want) {
    await page.getByLabel('Change circuit').click()
    await page.locator('.ws-switch-menu').getByRole('link', { name: topo, exact: true }).click()
    await page.waitForSelector(`.ws-head h1:text-is("${want}")`)
  }
  await page.locator('.rx-load').getByRole('radio', { name: load, exact: true }).click()
  await page.waitForTimeout(250)
}
await page.getByRole('button', { name: 'Defaults' }).click()
for (const topo of ['Half-wave', 'Center-tapped', 'Bridge']) {
  for (const load of ['R', 'RL', 'RC', 'RLC']) {
    await pick(topo, load)
    const text = await page.locator('main.ws').innerText()
    const flagged = await page.locator('.flag[role="alert"]').count()
    const diodes = await page.locator('.circuit .diode').count()
    check(!/NaN|Infinity|undefined/.test(text) && flagged === 0 && diodes === (topo === 'Half-wave' ? 1 : topo === 'Center-tapped' ? 2 : 4), `${topo} ${load}: renders, ${diodes} diode(s), theory within tolerance, no NaN`)
    if ((topo === 'Bridge' && load === 'RC') || (topo === 'Center-tapped' && load === 'RLC') || (topo === 'Half-wave' && load === 'RL')) {
      await page.screenshot({ path: OUT + `10-${topo}-${load}.png`.toLowerCase() })
    }
  }
}

// Graph layout: overlay / grouped / separate (user's choice)
await pick('Bridge', 'RC')
for (const [m, label] of [['overlay', 'Overlay'], ['separate', 'Separate'], ['grouped', 'Grouped']]) {
  await page.getByRole('radio', { name: label, exact: true }).click()
  await page.waitForTimeout(200)
  const aria = await page.locator('.scope-layer--overlay').getAttribute('aria-label')
  check(aria.includes(`${m} layout`), `graph layout "${label}" applied`)
  await page.locator('.instrument').screenshot({ path: OUT + `11-layout-${m}.png` })
}

// Half-wave RL: past the zero crossing the inductor holds D1 on (vout < 0)
await pick('Half-wave', 'RL')
await page.getByRole('radio', { name: 'Event', exact: true }).click()
await page.getByRole('button', { name: 'Reset to t = 0' }).click()
let held = false
for (let k = 0; k < 12 && !held; k++) {
  await page.getByRole('button', { name: 'Step forward' }).click()
  await page.waitForTimeout(60)
  const th = Number((await stateTime()).match(/θ = ([\d.]+)°/)?.[1])
  if (th > 185 && th < 230) held = /held on by the inductor/.test(await headline())
}
if (!held) {
  // step by angle into the hold-on region
  await page.getByRole('radio', { name: '15°' }).click()
  for (let k = 0; k < 30 && !held; k++) {
    await page.getByRole('button', { name: 'Step forward' }).click()
    await page.waitForTimeout(40)
    held = /held on by the inductor/.test(await headline())
  }
}
check(held, 'half-wave RL: WHY engine reports D1 held ON by the inductor after vin < 0')
await page.screenshot({ path: OUT + '12-rl-held.png' })

// Energy (Phase 6): the Energy action opens the ENERGY tab; the power ledger balances
await action('Energy').click()
await page.waitForTimeout(200)
const bal = await page.locator('.balance').innerText()
check(/conserved/.test(bal), `energy ledger balances at the cursor (${bal.trim()})`)
await page.screenshot({ path: OUT + '13-energy.png' })
await panelTab('State').click()

// ── Phase 8: Learn ───────────────────────────────────────────────────────────────
await page.evaluate(() => window.scrollTo(0, 0))
await mode('Learn').click()
await page.getByRole('button', { name: /Inductors keep current flowing/ }).click()
await page.waitForTimeout(300)
for (let k = 0; k < 2; k++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await page.waitForTimeout(250)
}
const lessonText = await page.locator('.mode-panel').innerText()
check(/step 3 of 4/i.test(lessonText) && !/\{\w+\}/.test(lessonText), 'lesson step 3 rendered with all numbers filled from the simulation')
check(/held on by the inductor/.test(await headline()), 'lesson placed the cursor where the inductor holds D1 on')
await panelTab('Why').click()
check((await page.locator('#why-chain').count()) === 1, 'lesson step opened the detailed WHY chain')
await page.screenshot({ path: OUT + '14-learn.png' })
await panelTab('Lesson').click()
await page.getByRole('button', { name: 'Next →' }).click()
await page.waitForTimeout(250)
await page.getByRole('button', { name: 'later' }).click()
check(/Right/.test(await page.locator('.quiz-feedback').innerText()), 'quiz gives feedback on the correct answer')
await page.getByRole('button', { name: /Finish lesson/ }).click()

// ── Phase 10: Challenge ─────────────────────────────────────────────────────────
await mode('Challenge').click()
await page.getByRole('button', { name: /Smooth it out/ }).click()
await page.waitForTimeout(300)
check(await page.getByLabel(/^Resistance/).last().isDisabled(), 'challenge locks the fixed parameters (R)')
const cIn = page.getByLabel(/^Capacitance/).last()
check(!(await cIn.isDisabled()) && (await cIn.isVisible()), 'challenge unlocks (and shows) the design parameter (C)')
check(/☆☆☆/.test(await page.locator('.stars').innerText()), 'starting design earns no stars')
await cIn.fill('3000')
await cIn.press('Enter')
await page.waitForTimeout(400)
check(/★★★/.test(await page.locator('.stars').innerText()), 'a good design (C = 3000 µF) earns three stars, checked by the simulation')
await page.getByRole('button', { name: /Submit design/ }).click()
await page.screenshot({ path: OUT + '15-challenge.png' })
await page.getByRole('button', { name: 'All challenges' }).click()

// ── Phase 9: Predict ────────────────────────────────────────────────────────────
await mode('Predict').click()
await page.getByRole('tab', { name: 'Sketch the output' }).click()
await page.waitForTimeout(400)
check((await page.locator('.instrument--hidden').count()) === 1, 'prediction hides the scope until the reveal')
check((await action('Analyze').count()) === 0, 'prediction hides the measurements (Analyze) until the reveal')
const sk = await page.locator('canvas.sketch').boundingBox()
await page.mouse.move(sk.x + 2, sk.y + sk.height * 0.3)
await page.mouse.down()
for (let k = 0; k <= 40; k++) await page.mouse.move(sk.x + 2 + (k / 40) * (sk.width - 4), sk.y + sk.height * (0.5 - 0.25 * Math.sin((k / 40) * Math.PI)), { steps: 2 })
await page.mouse.up()
const guessInputs = page.locator('.guess input')
await guessInputs.nth(0).fill('8')
await page.getByRole('button', { name: /Reveal the simulation/ }).click()
await page.waitForTimeout(300)
check(/Shape match/.test(await page.locator('.score').innerText()), 'reveal scores the sketch against the simulated Vout')
check((await page.locator('.instrument--hidden').count()) === 0 && (await action('Analyze').count()) === 1, 'after the reveal the scope and measurements (Analyze) appear')
await page.screenshot({ path: OUT + '16-predict.png' })
await mode('Explore').click()

// Phone-width layout
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(300)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(overflow <= 0, `no horizontal page scroll at 390 px (overflow ${overflow}px)`)
await page.screenshot({ path: OUT + '09-mobile.png', fullPage: false })

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
await browser.close()

console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll smoke checks passed')
process.exit(failures.length ? 1 : 0)
