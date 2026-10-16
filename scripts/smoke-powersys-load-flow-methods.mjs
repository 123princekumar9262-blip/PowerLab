/**
 * Power Systems Module 5 — the "Other solution methods" extension, in the browser: the Learn pointer, the Explore
 * sub-view (Newton–Raphson / fast decoupled / DC on the module's diagram, iteration table and plot, DC-vs-AC table,
 * the phase-shifting transformer panel), predictions decided from the computation, the on-demand Verify and Practise
 * blocks (which record no activity), invalid/infeasible states, no console errors and no horizontal overflow at 1440
 * and 1280. Run with the dev server on 5199: node scripts/smoke-powersys-load-flow-methods.mjs
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
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const both = async (label) => {
  check(await noOverflow(), `${label}: no horizontal overflow at 1440`)
  await page.setViewportSize({ width: 1280, height: 900 })
  await wait(250)
  check(await noOverflow(), `${label}: no horizontal overflow at 1280`)
  await page.setViewportSize({ width: 1440, height: 900 })
  await wait(150)
}
const text = (sel) => page.locator(sel).first().innerText()
const acts = async () => (await page.locator('.ps-acts summary').innerText()).replace(/\s+/g, ' ')
const card = (h) => page.locator('.ps-lfm > section').filter({ has: page.locator('h3', { hasText: h }) })
const slider = (label) => page.locator('.ps-slider', { hasText: label }).locator('input')
const BASE = '#/subjects/power-systems/load-flow'

await page.goto(URL)
await page.evaluate(() => localStorage.clear())

// ── Learn: the pointer ───────────────────────────────────────────────────────
console.log('── Learn')
await go(BASE)
check((await page.locator('.ps-lfm-teaser').count()) === 1, 'Learn has a “Beyond Newton–Raphson” pointer below the tour')
check(/Step 1 of 6/i.test(await text('.ps-stepper')), 'the tour still has six steps')
await page.getByRole('button', { name: /Open: fast decoupled/ }).click()
await wait(700)
check(/mode=explore/.test(await page.evaluate(() => location.hash)), 'the pointer opens Explore')
check((await page.getByRole('radio', { name: 'Other methods' }).getAttribute('aria-checked')) === 'true', '… on the Other methods view')

// ── Explore · Newton–Raphson reference and decoupling ────────────────────────
console.log('── Explore · reference')
const intro = await text('.ps-lfm-intro')
check(/61 %/.test(intro) && /0\.33 to 0\.50/.test(intro), 'Saadat: coupling blocks 61 % of the main blocks, r/x 0.33 to 0.50 (computed)')
check(/3 iterations/.test(await card('The reference').innerText()) && /3 × 3 Jacobian/.test(await card('The reference').innerText()), 'NR reference: 3 iterations, 3 × 3 Jacobian')
check((await page.locator('.ps-lf-sld [aria-label*="0.9717 per unit"]').count()) === 1, 'diagram shows the NR solution (|V2| = 0.9717 pu)')
await both('Methods · NR')

// ── fast decoupled ───────────────────────────────────────────────────────────
console.log('── Explore · fast decoupled')
await page.getByRole('radio', { name: 'Fast decoupled' }).click()
await wait()
check((await card('Fast decoupled load flow').locator('.ps-plot').count()) === 0, 'nothing is revealed before a prediction')
await page.locator('.ps-option', { hasText: 'More — but each one is cheaper' }).click()
await wait(500)
const fdc = await card('Fast decoupled load flow').innerText()
check(/Your prediction was right/.test(fdc) && /It needs 8/.test(fdc), 'prediction judged from the computation: FDLF needs 8 iterations (NR 3)')
const fro = await card('Fast decoupled load flow').locator('.ps-readouts').innerText()
check(/8\s*iterations/i.test(fro) && /yes/.test(fro), 'readouts: 8 iterations, same solution: yes')
check(/B′ factorised once, B″ once/.test(fro), 'B′ and B″ factorised once')
check((await page.locator('.ps-lfm-itertable tbody tr').count()) === 9, 'iteration table: start + 8 iterations')
check(/7\.3 × 10⁻⁹/.test(await text('.ps-lfm-itertable')), 'FDLF final mismatch 7.3 × 10⁻⁹ pu in the table')
check((await card('Fast decoupled load flow').locator('.ps-plot').count()) >= 1, 'mismatch-vs-iteration plot drawn')
check((await page.locator('.ps-lf-sld [aria-label*="0.9717 per unit"]').count()) === 1, 'diagram shows the FDLF solution (the same |V2| = 0.9717)')
await page.locator('details', { hasText: 'two constant matrices' }).locator('summary').click()
await wait(200)
const mats = await page.locator('.ps-lfm-mats').innerText()
check(/65\.00/.test(mats) && /73\.33/.test(mats) && /52\.00/.test(mats), 'B′ (65, 73.33) and B″ (52) shown on demand')
await page.screenshot({ path: OUT + 'load-flow-methods-smoke-fd.png', fullPage: true })
await both('Methods · FDLF')

// ── DC load flow ─────────────────────────────────────────────────────────────
console.log('── Explore · DC load flow')
await page.getByRole('radio', { name: 'DC load flow' }).click()
await wait()
await page.locator('.ps-option', { hasText: 'Lower — by about the AC losses' }).click()
await wait(400)
check(
  /Your prediction was right/.test(await card('DC load flow').innerText()) && /200\.0 MW/.test(await card('DC load flow').innerText()),
  'DC slack 200.0 MW < AC 218.4 MW (judged from the computation)',
)
const dct = await text('.ps-lfm-dctable')
check(/168\.4/.test(dct) && /179\.4/.test(dct) && /−10\.9/.test(dct), 'line 1–2: DC 168.4 MW, AC 179.4 MW, error −10.9 MW')
check(/−231\.6/.test(dct) && /−229\.0/.test(dct), 'line 2–3: DC −231.6 MW, AC −229.0 MW')
check((await page.locator('.ps-lf-sld text', { hasText: '— Mvar' }).count()) === 3, 'diagram: DC flows with Mvar shown as not computed (—)')
check((await page.locator('.ps-lf-sld [aria-label*="1.0000 per unit at −3.86 degrees"]').count()) === 1, 'diagram: DC angle θ2 = −3.86° at |V| = 1')
await both('Methods · DC')

// ── phase-shifting transformer ───────────────────────────────────────────────
console.log('── Explore · phase shifter')
await page.locator('.ps-option', { hasText: 'It falls' }).click()
await wait(400)
check(/Your prediction was right/.test(await card('Phase-shifting transformer').innerText()), 'PST prediction (line 1–2 falls) judged from the AC solution')
await slider('Phase shift').fill('5')
await wait(500)
const pr = await card('Phase-shifting transformer').locator('.ps-readouts').innerText()
check(/\+81\.8/.test(pr) && /\+91\.9/.test(pr), 'φ = 5° in line 1–3: AC +81.8 MW, DC +91.9 MW (= φ/Σx)')
check((await page.locator('.ps-lf-line.is-current').count()) === 1, 'the PST line is outlined on the diagram')
check(/−91\.9/.test(await text('.ps-lfm-psttable')), 'DC: the parallel path loses the same 91.9 MW')
await page.getByRole('button', { name: 'Set φ = 0' }).click()
await wait(400)
check(
  /\+0\.0|0\.0/.test(await card('Phase-shifting transformer').locator('.ps-readouts').innerText()) && (await page.locator('.ps-lf-line.is-current').count()) === 0,
  'φ = 0 restores the ordinary network',
)
// invalid: the PST's line switched out
await page.locator('.ps-lf-line[aria-label^="Line 1–3"]').click()
await wait(500)
check(/Line 1–3 is out of service — choose another line/.test(await card('Phase-shifting transformer').innerText()), 'PST line out of service: a clear message')
await page.locator('.ps-lf-linebtns').getByRole('button', { name: 'Reset' }).click()
await wait(400)

// 5-bus: relieving an overload
await page.getByRole('radio', { name: '5-bus meshed (illustrative)' }).click()
await wait(500)
await page.locator('.ps-option', { hasText: 'It falls' }).click()
await wait(300)
await slider('All loads').fill('1.5')
await slider('Phase shift').fill('-5')
await wait(600)
const p5 = await card('Phase-shifting transformer').locator('.ps-readouts').innerText()
check(/108 → 97 %/.test(p5) && /272\.3/.test(p5), '5-bus, loads × 1.5: −5° in line 1–3 relieves it from 108 % to 97 % (272.3 MW)')
check(/without the phase shifter/.test(await text('.ps-lfm-intro')), 'the side panel is said to describe the network without the shifter')
await page.screenshot({ path: OUT + 'load-flow-methods-smoke-pst.png', fullPage: true })
await both('Methods · PST')

// 5-bus at loads × 1.6: a PV bus switches to PQ inside the FDLF
await slider('All loads').fill('1.6')
await page.getByRole('radio', { name: 'Fast decoupled' }).click()
await wait(400)
await page
  .getByRole('button', { name: /Skip the prediction/ })
  .first()
  .click()
await wait(400)
const f16 = await card('Fast decoupled load flow').innerText()
check(/B″ 2 times \(a PV bus switched to PQ\)/.test(f16) && /reaches its reactive limit/.test(f16), 'loads × 1.6: the East plant hits its Q limit; B″ re-factorised (2 times)')
check((await page.locator('.ps-lfm-itertable tr.is-event').count()) === 1, 'the switch is marked in the iteration table')
// infeasible: beyond the maximum loadability
await slider('All loads').fill('2.2')
await wait(600)
check(/did not converge/.test(await card('Fast decoupled load flow').innerText()), 'loads × 2.2: no FDLF solution — a clear message, no numbers')
await page.getByRole('radio', { name: 'NR (full AC)' }).click()
await wait(300)
check(/finds no operating point/.test(await text('.ps-lfm')), 'loads × 2.2: Newton–Raphson finds no operating point (message)')
check(!/NaN|undefined|Infinity/.test(await text('.ps-lfm')), 'no NaN / undefined / Infinity on screen')
await both('Methods · infeasible')

// ── Verify (on demand, records nothing) ──────────────────────────────────────
console.log('── Verify')
await go(BASE + '?mode=verify')
const before = await acts()
check((await page.locator('.ps-check--ok').count()) === 6, 'the module’s six checks are unchanged (extension hidden until opened)')
await page.getByRole('button', { name: /Also check by hand/ }).click()
await wait(500)
const block = page.locator('.ps-lfm-ondemand')
check(
  (await block.locator('.ps-check--ok').count()) === 5 && (await block.locator('.ps-check--bad').count()) === 0,
  'five new hand checks (B′/B″, first FDLF iteration, FDLF = NR, DC by hand, PST by hand) agree',
)
check(/168\.42 MW/.test(await block.innerText()) && /91\.86 MW/.test(await block.innerText()), 'hand results: DC P12 = 168.42 MW, PST loop flow 91.86 MW')
const vi = block.locator('.ps-num-answer input')
await vi.nth(0).fill('73.33')
await block.locator('.ps-num-answer').nth(0).getByRole('button', { name: 'Check' }).click()
await vi.nth(1).fill('−183.7')
await block.locator('.ps-num-answer').nth(1).getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/2 of 2 answered correctly/.test(await block.locator('.ps-quiz').innerText()), 'your turn: B′33 = 73.33, line 1–2 −183.7 MW')
check((await acts()) === before, `no activity recorded (${before})`)
await page.screenshot({ path: OUT + 'load-flow-methods-smoke-verify.png', fullPage: true })
await both('Verify')

// ── Practise (on demand, records nothing) ────────────────────────────────────
console.log('── Practise')
await go(BASE + '?mode=practise')
check((await page.locator('.ps-quiz-list > li').count()) === 9, 'the module’s nine questions are unchanged')
await page.getByRole('button', { name: /More practice/ }).click()
await wait(400)
const pb = page.locator('.ps-lfm-ondemand')
check((await pb.locator('.ps-quiz-list > li').count()) === 9, 'nine extension questions')
const lv = await pb.innerText()
check(
  /Concept/.test(lv) && /Numerical/.test(lv) && /University-style/.test(lv) && !/GATE-style/.test(lv),
  'levels: concept → numerical → university-style (no GATE tag: both topics are GATE-supplementary)',
)
const gq = pb.locator('.ps-q', { hasText: 'Two lines in parallel' })
await gq.locator('input').fill('-2.29')
await gq.getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/angle across the pair fixed/.test(await gq.innerText()), 'a wrong answer shows the common mistake')
await gq.locator('input').fill('-5.73')
await gq.getByRole('button', { name: 'Check' }).click()
await wait(300)
check(/1 of 9 answered correctly/.test(await pb.locator('.ps-quiz').innerText()), 'parallel-lines PST: φ = −5.73° is right')
check(/0 of 6/.test(await acts()), 'no activity recorded by the extension')
await both('Practise')

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
process.exit(failures.length ? 1 : 0)
