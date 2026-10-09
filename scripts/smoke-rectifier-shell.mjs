/**
 * The Rectifier Lab in the universal workspace shell (redesign Phase 3) — end-to-end in Edge.
 * The visual matrix (1440 / 1024 / 820 / 768 / 390 / 375): presentation, regions, no page overflow,
 * overlays (dock, drawer, modal sheet); one master cursor driving status, state, WHY and its next
 * consequence; Analyze categories; Events; entry points (freewheel, firing angle, commutation sheet).
 * Run with the dev server on 5199: node scripts/smoke-rectifier-shell.mjs
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
const ctx = await browser.newContext()
const open = async (w, h, hash, level = 'standard', ready = '.ws .scope-canvas canvas') => {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: w, height: h })
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(URL + '#/home')
  await p.evaluate((lv) => {
    localStorage.clear()
    localStorage.setItem('pel.prefs', JSON.stringify({ level: lv }))
  }, level)
  await p.goto(URL + hash)
  await p.reload()
  await p.waitForSelector(ready)
  await p.waitForTimeout(400)
  return p
}
const why = (p) => p.locator('.ws-act--why')
/** Open the Explore menu and choose an item. */
const explore = async (p, name) => {
  await p.locator('.ws-explore-btn').click()
  await p.locator('.ws-explore-menu').getByRole(/Show current path|Focus/.test(name) ? 'menuitemcheckbox' : 'menuitem', { name }).click()
  await p.waitForTimeout(150)
}
const menuItems = async (p) => {
  await p.locator('.ws-explore-btn').click()
  const items = await p.locator('.ws-explore-menu [role^=menuitem]').allInnerTexts()
  await p.keyboard.press('Escape')
  return items.map((x) => x.replace(/[✓⚠]/g, '').trim().split('\n').pop().trim())
}
const runId = (p) => p.locator('main.ws').getAttribute('data-run-id')
const status = (p) => p.locator('.wp-status-line').innerText()
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const scopeAt = async (p, frac) => {
  const c = p.locator('.scope-layer--overlay')
  await c.scrollIntoViewIfNeeded()
  const b = await c.boundingBox()
  await p.mouse.click(b.x + 58 + (b.width - 58 - 14) * frac, b.y + 80)
  await p.waitForTimeout(200)
}

// ── Desktop 1440 ──────────────────────────────────────────────────────────────
console.log('── desktop 1440')
let p = await open(1440, 900, '#/labs/rectifiers/1ph-bridge?load=RL')
check(await p.locator('.ws--desktop').isVisible(), 'desktop presentation at 1440 px')
for (const region of ['.ws-head', '.ws-params', '.ws-bench', '.ws-wave']) check(await p.locator(region).isVisible(), `region ${region}`)
check((await p.locator('.ws-side').count()) === 0, 'no side column until something is opened')
check((await menuItems(p)).join('|') === 'Show current path|Inspect a component|State details|Energy|Switching events|Measurements & theory|Lessons|Focus view', 'one Explore menu: path, inspect, state, energy, events, measurements, lessons, focus')
check((await p.locator('.ws-modes-tabs [role=tab]').allInnerTexts()).join('|') === 'Explore|Learn|Experiment', 'modes: Explore · Learn · Experiment (Predict, Challenge, Reverse, Compare under More)')
check((await p.locator('main.ws').count()) === 1, 'the workspace is the page’s main landmark')
check((await p.getByRole('heading', { level: 1 }).innerText()) === 'Single-phase bridge', 'header: the circuit name is the page heading')
check((await p.locator('.ws-bar').count()) === 0 && (await p.locator('.picker[aria-label="Rectifier"]').count()) === 0, 'the old header circuit picker and section switch are retired')
const bench = await p.locator('.ws-bench').boundingBox()
const params = await p.locator('.ws-params').boundingBox()
check(bench.width > params.width * 2, `the circuit is the widest region (${Math.round(bench.width)} px)`)
// parameters: the load selector first in Basic
const basic = p.locator('.ws-params .param-group').first()
check((await basic.locator('.rx-load [role=radio]').count()) === 4 && (await basic.locator('.rx-load [aria-checked=true]').innerText()) === 'RL', 'Basic starts with the load selector (R · RL · RC · RLC), RL from the route')
check((await p.locator('.ws-params details.advanced').getAttribute('open')) === null, 'Advanced parameters closed below Engineer')
// numbers on the circuit: Engineer only
check(!(await p.locator('.rx-circuit text.value').first().isVisible()), 'Standard: no live numbers on the circuit (status line and State carry them)')
// status line ↔ State ↔ the run, one cursor
const run0 = await runId(p)
await scopeAt(p, 0.3)
const s1 = await status(p)
await p.locator('.wp-status-line').click()
const head1 = await p.locator('.ws-side .state-headline').innerText()
check(/D1 \+ D4 conducting|D2 \+ D3 conducting/i.test(s1) && /Vo = /.test(s1) && /θ = /.test(s1), `status line from the simulated state (${s1.split('\n')[0]})`)
const pair = s1.match(/(D\d) \+ (D\d)/i)
check(pair && head1.includes(pair[1]) && head1.includes(pair[2]), 'the State panel names the same conducting pair as the status line')
// WHY: four parts + next consequence
await why(p).click()
const w1 = await p.locator('.wv-why').innerText()
check(['WHAT IS HAPPENING?', 'WHY?', 'PHYSICAL PRINCIPLE', 'WHAT HAPPENS NEXT?'].every((h) => w1.toUpperCase().includes(h)), 'WHY: what is happening · why · physical principle · what happens next')
check(/at t = [\d.]+ m?s \(θ = [\d.]+°\)/.test(w1) && /forward biased/.test(w1), 'WHY: the diode rule of this state; next = the run’s next instant')
await p.locator('.wv-goto').click()
await p.waitForTimeout(200)
check((await status(p)) !== s1 && (await runId(p)) === run0, 'WHY → “Go to t = …” moves the cursor (same run, not re-simulated)')
await p.keyboard.press('Escape')
// current path (an overlay)
await explore(p, 'Show current path')
check((await p.locator('.circuit-wrap.show-path').count()) === 1 && /→/.test(await p.locator('.wp-path').innerText()), 'Show current path: highlighted on the circuit, the loop under the status line')
await explore(p, 'Show current path')
check((await p.locator('.circuit-wrap.show-path').count()) === 0, 'toggled off: the clean circuit again')
// inspect: click a part
await p.locator('[data-part="R"]').first().click()
check(/component/i.test(await p.locator('.ov').innerText()) && (await p.locator('.ov .inspect-rows').count()) === 1 && (await p.locator('.ov .wp-parts .chip-btn').count()) >= 6, 'clicking a part opens its inspector (every part also as a chip)')
await p.keyboard.press('Escape')
// Measurements & theory: a wide dock with categories
await explore(p, 'Measurements & theory')
check((await p.locator('.ws-bench .ov--dock').count()) === 1, 'Measurements & theory docks under the circuit (wide)')
const cats = await p.locator('.wv-analyze .ws-tabs [role=tab]').allInnerTexts()
check(['Overview', 'Output', 'Current', 'Ripple', 'Power & efficiency', 'Device stress', 'Timing', 'Theory vs Simulation'].every((c) => cats.some((x) => x.startsWith(c))) && !cats.some((x) => /Commutation/.test(x)), `categories, Timing at every level (${cats.join(' · ')})`)
await p.locator('.wv-analyze').getByRole('tab', { name: 'Theory vs Simulation' }).click()
check(/SIMULATION/.test(await p.locator('.wv-analyze table').innerText()) && /✓/.test(await p.locator('.wv-analyze table').innerText()) && !(await p.locator('.wv-analyze .row-bad').count()), 'Theory vs Simulation: every row within tolerance')
await p.locator('.wv-assumptions > summary').click()
check(/Measured on the simulated waveforms/.test(await p.locator('.wv-assumptions').innerText()), 'the theory’s assumptions are listed')
await p.keyboard.press('Escape')
// Events
await explore(p, 'Switching events')
await p.locator('.wv-event').first().click()
check((await p.locator('.ov .wv-event-detail').count()) === 1 && (await p.locator('.ov .wv-event').count()) > 1, 'Events: the list and WHAT HAPPENED / WHY for the selected event')
await p.keyboard.press('Escape')
// Change circuit menu
await p.getByLabel('Change circuit').click()
const menu = await p.locator('.ws-switch-menu ul').innerText()
check(/Single-phase/i.test(menu) && /Controlled \(SCR\)/i.test(menu) && /Three-phase/i.test(menu) && (await p.locator('.ws-switch-menu a').count()) === 11, 'Change circuit: 11 circuits in three groups')
await p.getByLabel('Change circuit').click()
check((await overflow(p)) <= 0, 'no horizontal page scroll')
await p.screenshot({ path: `${OUT}rx-shell-1440.png` })
await p.close()

// ── Entry points: firing angle, freewheeling, commutation sheet ────────────────
console.log('── entry points')
p = await open(1440, 900, '#/labs/rectifiers/1ph-bridge-scr?load=RL&alpha=45')
check((await p.getByLabel(/^Firing angle/).last().inputValue()) === '45', 'firing-angle entry: α = 45° from the route')
await why(p).click()
await p.locator('.wv-more-btn').click()
check(/Firing angle α = 45\.0°/.test(await p.locator('.firing-panel').innerText()), 'WHY → More detail carries the firing panel of the controlled bridge')
await p.close()
p = await open(1440, 900, '#/labs/rectifiers/1ph-half-wave?load=RL&fw=1')
check((await p.locator('.circuit .diode').count()) === 2 && /freewheeling diode/.test(await p.locator('.ws-head h1').innerText()), 'freewheeling entry: Dfw fitted, named in the header')
check((await p.locator('.view-seg').getByRole('tab', { name: 'With / without Dfw' }).count()) === 1, 'the With / without Dfw view is offered')
await p.close()
p = await open(1440, 900, '#/labs/rectifiers/3ph-6pulse?load=RL&ls=2&sheet=commutation', 'engineer')
check((await p.locator('.wv-analyze [role=tab][aria-selected=true]').innerText()).startsWith('Commutation'), 'commutation entry opens Measurements & theory → Commutation μ')
check(/Measured μ\s+2\d\.\d°/.test(await p.locator('.overlap-panel').innerText()), 'the measured overlap μ is shown (Ls = 2 mH)')
check(await p.locator('.rx-circuit text.value').first().isVisible(), 'Engineer: live numbers on the circuit')
await p.keyboard.press('Escape')
await p.locator('.view-seg').getByRole('tab', { name: 'Angle view' }).click()
check((await p.locator('.angle-svg').count()) === 1, 'three-phase: Angle view is a waveform view')
await p.screenshot({ path: `${OUT}rx-shell-3ph.png` })
await p.close()

// ── Tablet 1024 / 820 / 768: drawers (non-modal) ───────────────────────────────
for (const w of [1024, 820, 768]) {
  console.log(`── ${w}`)
  p = await open(w, 1000, '#/labs/rectifiers/3ph-bridge-scr?load=RL')
  const pres = w >= 1024 ? 'desktop' : 'tablet'
  check(await p.locator(`.ws--${pres}`).isVisible(), `${w}: ${pres} presentation`)
  check((await overflow(p)) <= 0, `${w}: no horizontal page scroll`)
  if (pres === 'tablet') {
    await p.getByRole('button', { name: /Parameters/ }).click()
    check((await p.locator('.ov--drawer').count()) === 1 && (await p.locator('[aria-modal="true"]').count()) === 0, `${w}: parameters open as a non-modal drawer`)
    await p.keyboard.press('Escape')
    await why(p).click()
    check(/What happens next/i.test(await p.locator('.ov').innerText()), `${w}: WHY opens in a drawer with what happens next`)
    await p.keyboard.press('Escape')
  } else {
    await why(p).click()
    check(/What happens next/i.test(await p.locator('.ws-side').innerText()), `${w}: WHY opens beside the circuit`)
  }
  await p.screenshot({ path: `${OUT}rx-shell-${w}.png`, fullPage: true })
  await p.close()
}

// ── Phone 390 / 375: modal sheets, sticky actions ─────────────────────────────
for (const w of [390, 375]) {
  console.log(`── ${w}`)
  p = await open(w, 844, '#/labs/rectifiers/1ph-half-wave-scr?load=RL')
  check(await p.locator('.ws--phone').isVisible(), `${w}: phone presentation`)
  check((await overflow(p)) <= 0, `${w}: no horizontal page scroll`)
  check((await p.locator('.ws-actions--sticky').count()) === 1 && (await p.locator('.ws-actions--sticky .ws-act').count()) === 3, `${w}: sticky bar: Parameters · WHY · Explore`)
  const rc = await p.locator('.rx-circuit').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  check(rc.sw > rc.cw, `${w}: the schematic keeps a legible width and scrolls inside its card`)
  await why(p).click()
  const sheet = p.locator('[role="dialog"][aria-modal="true"]')
  check((await sheet.count()) === 1 && (await p.locator('#root[inert]').count()) === 1, `${w}: WHY opens as a modal sheet; the page behind is inert`)
  check(/What happens next/i.test(await sheet.innerText()), `${w}: the sheet carries what happens next`)
  const before = await status(p)
  await p.keyboard.press('ArrowRight')
  check((await status(p)) === before, `${w}: arrow keys do not move the cursor behind a sheet`)
  await p.keyboard.press('Escape')
  check((await sheet.count()) === 0 && (await p.locator('#root[inert]').count()) === 0, `${w}: Escape closes the sheet`)
  await p.locator('.ws-actions--sticky').getByRole('button', { name: /Parameters/ }).click()
  check(await p.locator('[role="dialog"] .rx-load').isVisible(), `${w}: parameters sheet with the load selector`)
  await p.keyboard.press('Escape')
  await p.screenshot({ path: `${OUT}rx-shell-${w}.png`, fullPage: true })
  await p.close()
}

// ── Change circuit keeps compatible values, and says so ───────────────────────
console.log('── change circuit')
p = await open(1440, 900, '#/labs/rectifiers/1ph-bridge-scr?load=RL')
const setField = async (label, v) => {
  const f = p.getByLabel(label).last()
  await f.fill(String(v))
  await f.press('Enter')
  await p.waitForTimeout(300)
}
await setField(/^Resistance/, 20)
await setField(/^Firing angle/, 60)
await p.getByLabel('Change circuit').click()
await p.locator('.ws-switch-menu').getByRole('link', { name: 'Bridge', exact: true }).click()
await p.waitForSelector('.ws-head h1:text-is("Single-phase bridge")')
await p.waitForTimeout(400)
const notice = await p.locator('.wv-notice').innerText()
check(/Kept from the previous circuit/.test(notice) && /R = 20\.00 Ω/.test(notice), `the notice lists the kept values (${notice.split('\n')[0]})`)
check(/Not used here/.test(notice) && /α = 60°/.test(notice), 'α is not used by a diode bridge: remembered and said so (never silently dropped)')
check((await p.getByLabel(/^Resistance/).last().inputValue()) === '20', 'R really is 20 Ω in the new circuit')
await p.locator('.wv-notice').getByRole('button', { name: 'Got it' }).click()
check((await p.locator('.wv-notice').count()) === 0, 'the notice can be dismissed')
await p.getByLabel('Change circuit').click()
await p.locator('.ws-switch-menu').getByRole('link', { name: 'Fully controlled bridge', exact: true }).first().click()
await p.waitForSelector('.ws-head h1:text-is("Single-phase fully controlled bridge")')
await p.waitForTimeout(400)
check((await p.getByLabel(/^Firing angle/).last().inputValue()) === '60' && /α = 60°/.test(await p.locator('.wv-notice').innerText()), 'back to an SCR bridge: α = 60° is used again')
await p.goto(URL + '#/labs/rectifiers/1ph-bridge-scr?load=RL&alpha=45')
await p.waitForTimeout(600)
check((await p.getByLabel(/^Firing angle/).last().inputValue()) === '45', 'an entry point’s own value (α = 45° in the address) wins over the carried one')
await p.close()

// ── Levels and Focus: the same workspace, more or less detail ──────────────────
console.log('── levels & focus')
p = await open(1440, 900, '#/labs/rectifiers/1ph-bridge?load=RL', 'beginner')
check(!/Vo = /.test(await status(p)) && !(await p.locator('.rx-circuit text.value').first().isVisible()), 'Beginner: a short status (what conducts, what it means) and a clean circuit')
check((await p.getByRole('radiogroup', { name: 'Playback speed' }).count()) === 0 && (await p.getByRole('radiogroup', { name: 'Channel preset' }).count()) === 0, 'Beginner: play / step only; one essential set of waveforms + Add waveform')
check((await menuItems(p)).includes('Energy') && (await menuItems(p)).includes('Measurements & theory'), 'Beginner: nothing removed — energy and measurements stay one menu away')
await p.locator('.ws-level select').selectOption('standard')
await p.waitForTimeout(200)
check(/Vo = /.test(await status(p)) && (await p.getByRole('radiogroup', { name: 'Playback speed' }).count()) === 1, 'Standard: Vo and Io in the status; step size and speed')
await p.locator('.ws-level select').selectOption('engineer')
await p.waitForTimeout(200)
check(await p.locator('.rx-circuit text.value').first().isVisible(), 'Engineer: live numbers on the circuit')
await p.locator('.ws-level select').selectOption('beginner')
await explore(p, 'Focus view')
check((await p.locator('.ws-params').count()) === 0 && (await p.locator('.channel-bar').count()) === 0, 'Focus: parameters and waveform tools step aside')
const aria = await p.locator('.scope-layer--overlay').getAttribute('aria-label')
check(/Vin/.test(aria) && /Vout|Vo/.test(aria) && !/Io/.test(aria), `Focus: the primary waveforms only (${aria})`)
check(!(await menuItems(p)).includes('Energy'), 'Focus: energy, events, measurements and lessons step aside')
await explore(p, 'Focus view')
await p.close()

// ── Compare: full width ────────────────────────────────────────────────────────
console.log('── compare')
p = await open(1440, 900, '#/labs/rectifiers/1ph-bridge/compare', 'standard', '.compare-lab')
check((await p.locator('.ws-full .compare-lab').count()) === 1 && (await p.locator('.ws-grid').count()) === 0, 'Compare keeps its full-width layout under the workspace header')
await p.setViewportSize({ width: 390, height: 844 })
await p.waitForTimeout(300)
check((await overflow(p)) <= 0, 'Compare: no horizontal page scroll at 390 px')
await p.close()

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nALL RECTIFIER WORKSPACE CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
