/**
 * The universal workspace shell, simplified (redesign Phase 4), with Buck as the reference — end-to-end in
 * Edge. Four regions (header · parameters · circuit + one status line · waveforms); WHY as the primary
 * action and everything else behind one Explore menu; one master cursor driving every panel (and never
 * re-running the simulation); overlays (dock, drawer, modal sheet) with keyboard behaviour; Focus view;
 * levels; navigation. Desktop, tablet and phone. Screenshots for the visual matrix.
 * Run with the dev server on 5199: node scripts/smoke-workspace.mjs
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
const BUCK = URL + '#/labs/dc-dc/buck'
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
const ctx = await browser.newContext()
const open = async (w, h, level = 'beginner') => {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: w, height: h })
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(BUCK)
  await p.evaluate((lv) => localStorage.setItem('pel.prefs', JSON.stringify({ level: lv })), level)
  await p.reload()
  await p.waitForSelector('.ws .cscope canvas')
  await p.waitForTimeout(400)
  return p
}
const why = (p) => p.locator('.ws-act--why')
/** Open the Explore menu and choose an item. */
const explore = async (p, name) => {
  await p.locator('.ws-explore-btn').click()
  await p.locator('.ws-explore-menu').getByRole(/Focus|Show current path/.test(name) ? 'menuitemcheckbox' : 'menuitem', { name }).click()
  await p.waitForTimeout(150)
}
const menuItems = async (p) => {
  await p.locator('.ws-explore-btn').click()
  const items = await p.locator('.ws-explore-menu [role^=menuitem]').allInnerTexts()
  await p.keyboard.press('Escape')
  return items.map((x) => x.replace(/[✓⚠]/g, '').trim().split('\n').pop().trim())
}
const runId = (p) => p.locator('main.ws').getAttribute('data-run-id')
const scopeAt = async (p, frac) => {
  const c = p.locator('.cscope canvas.scope-layer--overlay')
  await c.scrollIntoViewIfNeeded()
  const b = await c.boundingBox()
  await p.mouse.click(b.x + 64 + (b.width - 64 - 54) * frac, b.y + b.height / 2)
  await p.waitForTimeout(200)
}
const kv = async (p, root, key) => {
  const t = await p.locator(root).innerText()
  const m = t.match(new RegExp(`${key}\\s*\\n?\\s*([^\\n]+)`))
  return m ? m[1].trim() : ''
}

// ── Desktop 1440 ──────────────────────────────────────────────────────────────
console.log('── desktop 1440')
let p = await open(1440, 900)
check(await p.locator('.ws--desktop').isVisible(), 'desktop presentation at 1440 px')
for (const region of ['.ws-head', '.ws-params', '.ws-bench', '.ws-wave']) check(await p.locator(region).isVisible(), `region ${region}`)
check((await p.locator('.ws-side').count()) === 0, 'no third column until something is opened: the circuit gets the space')
check((await p.getByRole('heading', { level: 1 }).innerText()) === 'Buck converter', 'header: the circuit name is the page heading')
const benchBox = await p.locator('.ws-bench').boundingBox()
check(benchBox.width > 900, `the circuit is the visual centre (${Math.round(benchBox.width)} px wide)`)
// the default workspace: two actions, not a row of tools
const acts = await p.locator('.ws-actions .ws-act').allInnerTexts()
check(acts.map((x) => x.replace(/\s+/g, ' ').replace(/^[?☰⚙] /, '').trim()).join('|') === 'WHY|Explore', `two everyday actions: WHY and Explore (${acts.length})`)
check((await menuItems(p)).join('|') === 'Show current path|Inspect a component|State details|Energy|Switching events|Measurements & theory|Lessons|Focus view', 'Explore holds the rest: path, inspect, state, energy, events, measurements, lessons, focus')
const modeTabs = await p.locator('.ws-modes-tabs [role=tab]').allInnerTexts()
check(modeTabs.join('|') === 'Explore|Learn|Experiment' && (await p.locator('.ws-more-modes summary').innerText()).startsWith('More'), 'modes: Explore · Learn · Experiment, practice under More')
// Basic parameters only; Advanced on demand
const labels = await p.locator('.ws-params .pfield-label').allInnerTexts()
check((await p.locator('.ws-params details.wp-advanced').getAttribute('open')) === null, 'Advanced parameters closed by default (Beginner)')
check(['Input voltage Vin', 'Switching frequency fs', 'Duty ratio D', 'Load resistance R'].every((l) => labels.some((x) => x.startsWith(l))) && !labels.some((x) => x.startsWith('Inductance')), 'Basic: Vin, fs, D, R (L and C under Advanced)')
await p.locator('.ws-params summary', { hasText: 'Advanced parameters' }).click()
check(await p.locator('.ws-params').getByText('Inductance L').isVisible(), 'Advanced holds L, C and the device model')
await p.locator('.ws-params summary', { hasText: 'Advanced parameters' }).click()
// numbers on the circuit: Engineer only; primary waveforms by default
check(!(await p.locator('.buck-diagram').innerHTML()).includes('Vout +'), 'Beginner: no live numbers on the circuit')
const chips0 = await p.locator('.wp-channels .chip--on').allInnerTexts()
check(chips0.length === 3 && ['Gate', 'Vout', 'iL'].every((c) => chips0.some((x) => x.startsWith(c))), 'waveforms: Gate, Vout, iL by default')
check((await p.getByRole('radiogroup', { name: 'Vertical scale' }).count()) === 0, 'Beginner: no scale switches on the waveform')
await p.screenshot({ path: `${OUT}ws-desktop.png` })

// ── One master cursor drives everything (and never re-runs the simulation) ──
console.log('── one timestep')
const run0 = await runId(p)
await scopeAt(p, 1.25 / 4) // ON part of period 2
const sOn = await p.locator('.wp-status-line').innerText()
check(/SWITCH ON/i.test(sOn) && /inductor charging/.test(sOn), `status line from the simulated state (${sOn.split('\n')[0]})`)
await p.locator('.wp-status-line').click()
const stOn = await p.locator('.ws-side .dc-state').innerText()
check(/Switch Q1\s*ON/.test(stOn) && /Diode D1\s*OFF/.test(stOn), 'clicking the status line opens State details: Q1 ON, D1 OFF')
const ilState = (stOn.match(/iL\s*\n?\s*([−+\d.]+ \S?A)/) ?? [])[1]
await p.locator('.buck-diagram [data-part="l"]').click()
const ilInspect = await kv(p, '.wv-inspect', 'Current now')
check(!!ilState && ilInspect.startsWith(ilState.replace('+', '')), `clicking L inspects it: iL (${ilInspect}) = State iL (${ilState}) at the same instant`)
check(/STORING ENERGY/.test(await p.locator('.wv-state').innerText()), 'ON instant: the inductor is storing energy')
await p.screenshot({ path: `${OUT}ws-desktop-inspect.png` })
await p.keyboard.press('Escape')
await p.waitForTimeout(150)
check((await p.locator('.ws-side').count()) === 0, 'Esc closes the panel and the side column goes away')
await explore(p, 'Show current path')
check((await p.locator('.buck-diagram .wire--flow').count()) > 4 && /Current path\s+Vin\+ → Q1/.test(await p.locator('.wp-path').innerText()), 'Show current path: highlighted on the circuit, Vin → Q1 → L (from the simulated devices)')
await why(p).click()
const whyOn = await p.locator('.wv-why').innerText()
check(['WHAT IS HAPPENING?', 'WHY?', 'PHYSICAL PRINCIPLE', 'WHAT HAPPENS NEXT?'].every((h) => whyOn.toUpperCase().includes(h)), 'WHY: what is happening · why · physical principle · what happens next')
check(/Why is D1 OFF\?/.test(whyOn) && /gate goes LOW at t = /.test(whyOn), 'ON: WHY explains D1 OFF; next = the gate falling at its simulated time')
await p.screenshot({ path: `${OUT}ws-desktop-why.png` })
// "Go to that instant" moves the cursor to the quoted event
await p.locator('.wv-goto').click()
await p.waitForTimeout(200)
check(/SWITCH OFF/i.test(await p.locator('.wp-status-line').innerText()), 'WHY → “Go to t = …” moves the cursor to the next event (now switch OFF)')
// move to the OFF part: every panel follows
await scopeAt(p, 1.75 / 4)
const sOff = await p.locator('.wp-status-line').innerText()
check(/SWITCH OFF/i.test(sOff) && /diode freewheeling/.test(sOff), 'OFF instant: status line follows the cursor')
check(/Why did D1 turn ON\?/.test(await p.locator('.wv-why').innerText()) && /Q1 turns ON again at t = /.test(await p.locator('.wv-why').innerText()), 'OFF: WHY and its next consequence follow the cursor')
check(/D1/.test(await p.locator('.wp-path').innerText()), 'OFF: the path goes through D1')
check((await runId(p)) === run0, `moving the cursor never re-ran the simulation (run ${run0})`)
await p.locator('.buck-diagram [data-part="l"]').click()
check(/RELEASING ENERGY/.test(await p.locator('.wv-state').innerText()), 'OFF: the inductor releases energy (inspector follows the cursor)')
await p.keyboard.press('Escape')
await explore(p, 'Show current path')
// events: click one → cursor moves there
await explore(p, 'Switching events')
const firstEvent = p.locator('.wv-event').nth(2)
const evLabel = await firstEvent.innerText()
await firstEvent.click()
await p.waitForTimeout(200)
const tEvent = evLabel.split('\n')[0].trim()
const tCursor = (await p.locator('.wp-time').innerText()).replace('t = ', '')
check(Math.abs(parseFloat(tCursor) - parseFloat(tEvent)) < 0.5 && tCursor.split(' ')[1] === tEvent.split(' ')[1], `clicking an event moves the master cursor (${tEvent} → ${tCursor})`)
check(await p.locator('.wv-event-detail').isVisible(), 'the selected event is explained')
await p.screenshot({ path: `${OUT}ws-desktop-events.png` })
await p.keyboard.press('Escape')
// energy, analyze
await explore(p, 'Energy')
const en = await p.locator('.wv-energy').innerText()
check(/Inductor EL/.test(en) && /conserved/.test(en), 'Energy: stored EL and EC, every element’s power, Σp conserved')
await p.screenshot({ path: `${OUT}ws-desktop-energy.png` })
await p.keyboard.press('Escape')
await explore(p, 'Measurements & theory')
const tabs = await p.locator('.wv-analyze [role=tab]').allInnerTexts()
check(['Overview', 'Output', 'Current', 'Ripple', 'Power', 'Efficiency', 'Device stress'].every((t) => tabs.includes(t)) && tabs.some((t) => t.startsWith('Theory vs Simulation')), `Measurements & theory categories: ${tabs.join(' · ')}`)
check(/SIMULATION/.test(await p.locator('.wv-analyze').innerText()) && /THEORY/.test(await p.locator('.wv-analyze').innerText()) && /✓/.test(await p.locator('.wv-analyze').innerText()), 'SIMULATION and THEORY side by side, with the error')
check(await p.locator('.ws-bench .ov--dock').isVisible(), 'the analysis docks under the circuit — it never covers it')
await p.screenshot({ path: `${OUT}ws-desktop-analyze.png`, fullPage: true })
await p.locator('.ov-close').click()
// channels
await p.getByRole('button', { name: '+ Add waveform' }).click()
check((await p.locator('.wp-add-group legend').allInnerTexts()).length >= 3, '+ Add waveform lists the signals by kind')
await p.locator('.add-menu').getByRole('checkbox', { name: /^iC/ }).check()
await p.getByRole('button', { name: '+ Add waveform' }).click()
check((await p.locator('.wp-channels .chip--on').count()) === 4, 'a waveform can be added')
// parameters change → one new simulation, every panel updates
await explore(p, 'State details')
const vBefore = await p.locator('.ws-side .dc-state').innerText()
const dIn = p.getByLabel('Duty ratio D value')
await dIn.fill('30')
await dIn.press('Enter')
await p.waitForTimeout(500)
check((await p.locator('.ws-side .dc-state').innerText()) !== vBefore && (await runId(p)) !== run0, 'changing D runs the simulation again; the state follows')
await p.getByRole('button', { name: 'Reset' }).click()
await p.keyboard.press('Escape')
// levels: Standard adds the scale switches; Engineer shows numbers on the circuit and opens Advanced
await p.locator('.ws-level select').selectOption('standard')
await p.waitForTimeout(200)
check((await p.getByRole('radiogroup', { name: 'Vertical scale' }).count()) === 1, 'Standard: waveform scale and layout switches appear')
await p.locator('.ws-level select').selectOption('engineer')
await p.waitForTimeout(200)
check((await p.locator('.buck-diagram').innerHTML()).includes('Vout +'), 'Engineer: values on the circuit')
check((await p.locator('.ws-params details.wp-advanced').getAttribute('open')) !== null, 'Engineer: Advanced parameters open')
await p.locator('.ws-level select').selectOption('beginner')
// focus view
await explore(p, 'Focus view')
await p.waitForTimeout(200)
check((await p.locator('.ws-params').count()) === 0, 'Focus: parameters step aside; the circuit takes the width')
const fItems = await menuItems(p)
check(fItems.join('|') === 'Show current path|Inspect a component|State details|Focus view', `Focus: Energy, Events, Measurements and Lessons step aside (${fItems.join(', ')})`)
const fChips = await p.locator('.wp-wave .lane-name, .wp-wave canvas').count()
check((await p.locator('.wp-channels').count()) === 0 && fChips > 0, 'Focus: the primary waveforms only, no channel tools')
await p.screenshot({ path: `${OUT}ws-desktop-focus.png` })
await explore(p, 'Focus view')
// modes: Analyze is not a mode; practice modes under More; routes update
for (const m of ['Learn', 'Experiment', 'Explore']) {
  await p.locator('.ws-modes-tabs').getByRole('tab', { name: m }).click()
  await p.waitForTimeout(150)
  const h = await p.evaluate(() => location.hash)
  check(m === 'Explore' ? h.startsWith('#/labs/dc-dc/buck') && !/\/(learn|experiment|predict)/.test(h) : h.includes(`/${m.toLowerCase()}`), `mode ${m} → ${h}`)
}
await p.locator('.ws-modes-tabs').getByRole('tab', { name: 'Learn' }).click()
check(await p.locator('.ws-side .ws-activity').isVisible(), 'Learn: the lesson list is the side panel (the activity of the mode)')
await p.locator('.ws-more-modes summary').click()
await p.locator('.ws-more-modes').getByRole('button', { name: 'Predict' }).click()
await p.waitForTimeout(150)
check((await p.evaluate(() => location.hash)).includes('/predict') && /Predict/.test(await p.locator('.ws-more-modes summary').innerText()), 'More → Predict (the menu shows where you are)')
await p.locator('.ws-modes-tabs').getByRole('tab', { name: 'Explore' }).click()
// navigation: back link, change circuit, Back
await p.getByRole('link', { name: 'Back to DC-DC Converters' }).click()
await p.waitForTimeout(300)
check((await p.evaluate(() => location.hash)) === '#/labs/dc-dc', 'the header back link opens the lab')
await p.goBack()
await p.waitForSelector('.ws .cscope canvas')
check((await p.evaluate(() => location.hash)).startsWith('#/labs/dc-dc/buck'), 'browser Back returns to the workspace')
await p.getByLabel('Change circuit').click()
await p.locator('.ws-switch-menu').getByRole('link', { name: 'Boost', exact: true }).click()
await p.waitForSelector('.ws-head h1:text-is("Boost converter")')
check((await p.locator('.ws .cscope canvas').count()) > 0 && (await p.evaluate(() => location.hash)) === '#/labs/dc-dc/boost', 'Change circuit → Boost (its own address, the same workspace)')
await p.getByLabel('Change circuit').click()
await p.locator('.ws-switch-menu').getByRole('link', { name: 'Buck', exact: true }).click()
await p.waitForSelector('.ws-head h1:text-is("Buck converter")')
check((await p.locator('.ws').count()) === 1, 'and back to Buck')
await p.goto(URL + '#dcdc')
await p.waitForTimeout(400)
check((await p.evaluate(() => location.hash)) === '#/labs/dc-dc', 'old #dcdc still redirects')
await p.close()

// ── Desktop 1024, tablets 820/768 ─────────────────────────────────────────────
for (const [w, h, pres] of [
  [1024, 768, 'desktop'],
  [820, 1180, 'tablet'],
  [768, 1024, 'tablet'],
]) {
  console.log(`── ${w}`)
  p = await open(w, h)
  check(await p.locator(`.ws--${pres}`).isVisible(), `${w}: ${pres} presentation`)
  check((await p.evaluate(() => document.documentElement.scrollWidth)) <= w, `${w}: no horizontal overflow`)
  const bench = await p.locator('.ws-bench').boundingBox()
  check(bench.width >= w * (pres === 'desktop' ? 0.6 : 0.9), `${w}: the circuit stays large (${Math.round(bench.width)} px)`)
  if (pres === 'tablet') {
    await p.getByRole('button', { name: /Parameters/ }).click()
    check(await p.locator('.ov--drawer.ov--left').isVisible(), `${w}: Parameters open as a side drawer`)
    check((await p.locator('.ov--drawer[aria-modal=true]').count()) === 0, `${w}: the drawer does not block the page`)
    await p.screenshot({ path: `${OUT}ws-${w}-params.png` })
    await p.keyboard.press('Escape')
    await why(p).click()
    check(await p.locator('.ov--drawer .wv-why').isVisible(), `${w}: WHY opens in a side drawer`)
    await scopeAt(p, 1.75 / 4)
    check(/SWITCH OFF/i.test(await p.locator('.wp-status-line').innerText()) && /Why did D1 turn ON/.test(await p.locator('.ov--drawer .wv-why').innerText()), `${w}: the cursor still works with the drawer open (non-blocking)`)
    await p.keyboard.press('Escape')
  } else {
    await why(p).click()
    check(await p.locator('.ws-side .wv-why').isVisible(), `${w}: WHY opens beside the circuit`)
    await p.keyboard.press('Escape')
  }
  await p.screenshot({ path: `${OUT}ws-${w}.png`, fullPage: true })
  await p.close()
}

// ── Phones 390/375 ────────────────────────────────────────────────────────────
for (const [w, h] of [
  [390, 844],
  [375, 667],
]) {
  console.log(`── phone ${w}`)
  p = await open(w, h)
  check(await p.locator('.ws--phone').isVisible(), `${w}: phone presentation`)
  check((await p.evaluate(() => document.documentElement.scrollWidth)) <= w, `${w}: no horizontal overflow`)
  const total = await p.evaluate(() => document.documentElement.scrollHeight)
  check(total <= 2 * h, `${w}: compact page (${total} px ≤ 2 screens)`)
  const order = await p.evaluate(() => ['.ws-bench .wp-circuit', '.wp-status', '.ws-wave'].map((s) => document.querySelector(s).getBoundingClientRect().top))
  check(order[0] < order[1] && order[1] < order[2], `${w}: circuit → status → waveform`)
  check((await p.locator('.ws-params').count()) === 0 && (await p.locator('.ws-side').count()) === 0, `${w}: parameters and panels are not on the page (sheets)`)
  const bar = p.locator('.ws-actions--sticky')
  check(await bar.isVisible(), `${w}: sticky action bar`)
  check((await bar.locator('.ws-act').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').replace(/^[?☰⚙] /, '').trim()).join('|') === 'Parameters|WHY|Explore', `${w}: Parameters · WHY · Explore`)
  const sizes = await bar.locator('.ws-act').evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]))
  check(sizes.every(([bw, bh]) => bw >= 44 && bh >= 44), `${w}: action targets ≥ 44 px (${sizes.map((s) => Math.round(s[0])).join(', ')})`)
  // parameters: modal sheet with a focus trap; Esc closes and focus returns
  await bar.getByRole('button', { name: /Parameters/ }).click()
  const sheet = p.locator('.ov--sheet[aria-modal=true]')
  check(await sheet.isVisible(), `${w}: Parameters open as a modal bottom sheet`)
  check((await p.evaluate(() => document.getElementById('root').hasAttribute('inert'))) === true, `${w}: the page behind the sheet is inert`)
  for (let i = 0; i < 25; i++) await p.keyboard.press('Tab')
  check(await p.evaluate(() => !!document.activeElement?.closest('.ov--sheet')), `${w}: keyboard focus stays inside the sheet`)
  await p.screenshot({ path: `${OUT}ws-${w}-params.png` })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(150)
  check((await sheet.count()) === 0 && (await p.evaluate(() => document.activeElement?.textContent?.includes('Parameters'))), `${w}: Esc closes the sheet and focus returns to its button`)
  // WHY in a sheet; the status line opens the state
  await why(p).click()
  check(await p.locator('.ov--sheet .wv-why').isVisible(), `${w}: WHY opens in a bottom sheet`)
  await p.screenshot({ path: `${OUT}ws-${w}-why.png` })
  await p.locator('.ov--sheet .ov-close').click()
  await p.locator('.wp-status-line').click()
  check(await p.locator('.ov--sheet .dc-state').isVisible(), `${w}: tapping the status line opens State details`)
  await p.locator('.ov--sheet .ov-close').click()
  await explore(p, 'Inspect a component')
  await p.locator('.ov--sheet').getByRole('button', { name: 'Inductor L', exact: true }).click()
  check(/Inductor L/.test(await p.locator('.ov--sheet .wv-inspect').innerText()), `${w}: Inspect works without clicking the tiny circuit (component chips)`)
  await p.screenshot({ path: `${OUT}ws-${w}-inspect.png` })
  await p.locator('.ov--sheet .ov-close').click()
  await explore(p, 'Measurements & theory')
  check(await p.locator('.ov--sheet .wv-analyze').isVisible(), `${w}: measurements and theory in a bottom sheet`)
  await p.screenshot({ path: `${OUT}ws-${w}-analyze.png` })
  await p.locator('.ov--sheet .ov-close').click()
  // waveform usable: tap moves the cursor
  const t0 = await p.locator('.wp-time').innerText()
  await scopeAt(p, 0.6)
  check((await p.locator('.wp-time').innerText()) !== t0, `${w}: the waveform cursor responds to a tap`)
  await p.screenshot({ path: `${OUT}ws-${w}.png`, fullPage: true })
  await p.close()
}

await browser.close()
check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL WORKSPACE CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
