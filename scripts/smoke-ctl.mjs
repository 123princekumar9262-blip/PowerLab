/**
 * Controlled rectifiers, single-phase freewheeling, commutation overlap and Compare mode —
 * end-to-end in Edge (Playwright). Run with the dev server on 5199: node scripts/smoke-ctl.mjs
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { fullWorkspace } from './full-workspace.mjs'

const OUT = 'scripts/out/'
mkdirSync(OUT, { recursive: true })
const errors = []
const failures = []
const check = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures.push(msg)
}
const browser = fullWorkspace(await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' }))
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const BASE = process.env.LAB_URL ?? 'http://localhost:5199/'
await page.goto(BASE + '#/home')
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('pel.prefs', JSON.stringify({ level: 'standard' })) })
await page.goto(BASE + '#/labs/rectifiers/1ph-half-wave')
await page.reload()
await page.waitForSelector('.scope-canvas canvas')
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
    if (['Explore', 'Learn', 'Experiment', 'Predict'].includes(name)) await page.locator('.ws-modes-tabs').getByRole('tab', { name, exact: true }).click()
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
const status = () => page.locator('.wp-status-line').innerText()
const measureTab = async (tab, label) => {
  await action('Analyze').click()
  try {
    await page.locator('.wv-analyze').getByRole('tab', { name: tab }).click({ timeout: 3000 })
    return (await page.locator('.wv-analyze tr', { hasText: label }).first().locator('td').first().innerText()).trim()
  } finally {
    await page.keyboard.press('Escape')
  }
}
// circuits are chosen in the header's "Change circuit" menu (each has its own address)
const circuit = async (label, h1) => {
  await page.getByLabel('Change circuit').click()
  await page.locator('.ws-switch-menu').getByRole('link', { name: label, exact: true }).first().click()
  await page.waitForSelector(`.ws-head h1:text-matches("^${h1}")`)
  await page.waitForTimeout(400)
}
const load = (name) => page.locator('.rx-load').getByRole('radio', { name, exact: true }).click()

// ── Single-phase controlled: picker group → fully controlled bridge, RL ───────────
await page.getByLabel('Change circuit').click()
check(await page.locator('.ws-switch-menu').getByText('Controlled (SCR)').isVisible(), 'Change circuit has a Controlled (SCR) group')
await page.getByLabel('Change circuit').click()
await circuit('Fully controlled bridge', 'Single-phase fully controlled bridge')
await load('RL')
await page.waitForTimeout(600)
check((await page.locator('.circuit .gate').count()) === 4, 'fully controlled bridge: four SCR gate leads')
check(/T1 \+ T4 conducting/i.test(await status()), 'status line names the SCR pair (T1 + T4)')
const alpha = page.getByLabel(/^Firing angle/).last()
check(await alpha.isVisible(), 'firing angle α is a main (Basic) parameter of a controlled rectifier')
const vdc30 = await measureTab('Output', 'Average output')
await alpha.fill('60')
await alpha.press('Enter')
await page.waitForTimeout(500)
const vdc60 = await measureTab('Output', 'Average output')
check(parseFloat(vdc60) < parseFloat(vdc30), `raising α lowers Vdc (${vdc30} → ${vdc60})`)
check((await page.locator('.flag[role="alert"]').count()) === 0, 'controlled bridge agrees with theory (no ⚠)')

// WHY + firing panel
await action('WHY').click()
check(/Firing angle α = 60\.0°/.test(await page.locator('.firing-panel').innerText()), 'Why tab shows the firing-angle panel')
await page.getByRole('button', { name: 'Why did it turn ON now?' }).click()
check(/turned ON at θ = /.test(await page.locator('.firing-answer').innerText()), 'why did it turn ON now? — from the switching event')
// Put the cursor before the firing of the next pair (θ = 50°) and ask why it is OFF.
await page.getByRole('radio', { name: '15°' }).click()
for (let k = 0; k < 24; k++) {
  const th = Number((await status()).match(/θ = ([\d.]+)°/)?.[1])
  if (th >= 40 && th < 60) break
  await page.getByRole('button', { name: 'Step forward' }).click()
}
await page.getByRole('button', { name: 'Why is the SCR OFF?' }).click()
check(/gate/.test(await page.locator('.firing-answer').innerText()), 'why is the SCR OFF? — forward biased but not fired yet')
await page.screenshot({ path: OUT + 'ctl-10-firing.png' })

// Semi-controlled bridge
await circuit('Semi-controlled bridge', 'Single-phase semi-controlled bridge')
check((await page.locator('.circuit .gate').count()) === 2, 'semi-controlled bridge: two SCRs (T1, T2) and two diodes')
check((await page.locator('.flag[role="alert"]').count()) === 0, 'semi-controlled bridge agrees with theory')

// Half-wave controlled
await circuit('Half-wave controlled', 'Single-phase half-wave controlled')
check((await page.locator('.circuit .gate').count()) === 1, 'half-wave controlled: one SCR')

// ── Freewheeling diode on the bridge ─────────────────────────────────────────────
await circuit('Bridge', 'Single-phase bridge')
await page.getByRole('button', { name: /Freewheeling diode: OFF/ }).click()
await page.waitForTimeout(500)
check((await page.locator('.circuit .diode').count()) === 5, 'bridge + freewheeling diode: four bridge diodes and Dfw')
check(await page.locator('.legend').getByText('Ifw', { exact: true }).isVisible(), 'Ifw channel shown')
await page.getByRole('radio', { name: 'Δt' }).click()
// Step to an instant where Dfw conducts (near the zero crossing: |vin| < Vf).
let fwSeen = false
await page.getByRole('radio', { name: 'Event', exact: true }).click()
for (let k = 0; k < 30 && !fwSeen; k++) {
  await page.getByRole('button', { name: 'Step forward' }).click()
  fwSeen = /Dfw conducting/i.test(await status())
}
check(fwSeen, 'stepping by events reaches an instant where Dfw conducts')
await panelTab('Why').click()
await page.getByRole('button', { name: 'Show detailed explanation' }).click()
check(/LOAD → FREEWHEEL DIODE → LOAD/.test(await page.locator('#fw-why').innerText()), 'WHY: why is the freewheeling diode conducting? (7 steps)')
await page.screenshot({ path: OUT + 'ctl-11-bridge-fw.png' })

// Center-tap + freewheel
await circuit('Center-tapped', 'Single-phase center-tapped')
check((await page.locator('.circuit .diode').count()) === 3, 'center-tap + freewheeling diode (kept by Change circuit): D1, D2 and Dfw')
check((await page.locator('.flag[role="alert"]').count()) === 0, 'center-tap + Dfw agrees with theory')

// ── Three-phase commutation overlap ──────────────────────────────────────────────
await circuit('6-pulse bridge', '6-pulse bridge')
await load('RL')
await page.locator('details.advanced > summary').click()
const L = page.getByLabel(/^Inductance/).last()
await L.fill('100')
await L.press('Enter')
const ls = page.getByLabel(/^Source inductance/).last()
await ls.fill('1')
await ls.press('Enter')
await page.waitForTimeout(800)
const mu = await measureTab('Timing', 'Commutation overlap').catch(() => null)
await action('Analyze').click()
await page.locator('.wv-analyze').getByRole('tab', { name: 'Commutation μ' }).click()
const ov = await page.locator('.overlap-panel').innerText()
check(/Measured μ\s+1\d\.\d°/.test(ov), 'Commutation / μ: measured μ from the switching events')
check(/Theoretical μ\s+1\d\.\d°/.test(ov) && /Difference\s+[−+]\d\.\d\d %/.test(ov), 'μ compared with cos α − cos(α + μ) = 2ωLs·Id/(√6·Vph)')
check((await page.locator('.overlap-panel tbody tr').count()) === 6, 'six commutations per cycle, each with its current transfer')
await page.screenshot({ path: OUT + 'ctl-12-overlap.png' })
await page.keyboard.press('Escape')
await action('Events').click()
const evText = await page.locator('.wv-event-list').innerText()
check(/commutation begins/.test(evText) && /fully conducting/.test(evText), 'events: commutation begins / fully conducting markers')
await page.keyboard.press('Escape')
void mu

// ── Compare mode ─────────────────────────────────────────────────────────────────
await mode('Compare').click()
check((await page.locator('.compare-lab').count()) === 1 && (await page.locator('.ws-full').count()) === 1 && (await page.locator('.ws-grid').count()) === 0, 'Compare is its own full-width lab (the workspace regions step aside)')
await page.getByRole('button', { name: 'Run comparison' }).click()
await page.waitForSelector('.cmp-card', { timeout: 30000 })
const cards = await page.locator('.cmp-cards').innerText()
check(/100 Hz/.test(cards) && /300 Hz/.test(cards), 'bridge vs 6-pulse: ripple 100 Hz vs 300 Hz (simulated)')
check(/Same phase RMS voltage/.test(await page.locator('.cmp-basis-note').innerText()), 'the comparison states its basis')
await page.getByRole('tab', { name: 'Power', exact: true }).click()
check(/Theoretical|Simulated/.test(await page.locator('.cmp-table').innerText()), 'every metric is tagged Simulated or Theoretical')
await page.getByRole('tab', { name: 'Stress', exact: true }).click()
check(/Peak inverse voltage/.test(await page.locator('.cmp-table').innerText()), 'device stress tab')
check(/Pulses per cycle: Bridge 2, 6-pulse bridge 6/.test(await page.locator('.cmp-why').innerText()), 'why do they differ? — from the results')
await page.getByRole('button', { name: 'Compare waveforms' }).click()
check((await page.locator('.cmp-wave .cmp-trace').count()) === 2, 'waveform overlay of Vo A and Vo B')
await page.getByRole('radio', { name: 'Difference' }).click()
check((await page.locator('.cmp-wave .cmp-trace--d').count()) === 1, 'difference view')
await page.getByRole('radio', { name: 'Motor drive' }).click()
check(/Trade-offs/.test(await page.locator('.cmp-advice').innerText()), 'which should I choose? — with trade-offs')
await page.locator('select[aria-label="Comparison basis"]').selectOption('pout')
check(/conditions above have changed/.test(await page.locator('main.ws').innerText()), 'changing the basis marks results as stale until re-run')
await page.getByRole('button', { name: 'Run comparison' }).click()
await page.waitForTimeout(4000)
check(/adjusted to match power/.test(await page.locator('.cmp-basis-note').innerText()), 'same-output-power basis adjusts B’s source and says so')
await page.screenshot({ path: OUT + 'ctl-13-compare.png', fullPage: true })

const body = await page.locator('body').innerText()
check(!/NaN|Infinity|undefined/.test(body), 'no NaN / Infinity / undefined')
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(300)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(overflow <= 0, `Compare: no horizontal page scroll at 390 px (overflow ${overflow}px)`)
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll controlled / compare smoke checks passed')
process.exit(failures.length ? 1 : 0)
