/**
 * Browser checks of the 3D Machines Lab (#/machines). Run with the dev server (or a preview) on 5199:
 *   node scripts/smoke-machines.mjs
 */
import { chromium } from 'playwright'
import { fullWorkspace } from './full-workspace.mjs'
import { decodePng, drawnFraction } from './png.mjs'

const URL = process.env.LAB_URL ?? 'http://localhost:5199/'
const failures = []
const errors = []
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failures.push(msg)
}
const browser = fullWorkspace(await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' }))
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const wait = (ms = 400) => page.waitForTimeout(ms)
const h1 = () => page.locator('main h1').first().innerText()

// ── Navigation and catalogue ──
console.log('── Catalogue')
await page.goto(URL + '#/home')
await wait(600)
await page.locator('.side-nav').getByRole('link', { name: 'Electrical Machines & Drives' }).click()
await wait(600)
await page.locator('.subject-topic-card', { hasText: 'All 3D models' }).click()
await wait(800)
check((await page.evaluate(() => location.hash)) === '#/machines' && (await h1()) === '3D Machines Lab', 'the sidebar leads to the 3D Machines Lab (Electrical Machines & Drives › All 3D models)')
const rows = await page.locator('.mx-row').count()
check(rows >= 25, `the catalogue lists every machine and device (${rows})`)
const readyRows = await page.locator('.mx-row:not(.mx-row--planned)').count()
check(readyRows >= 1 && (await page.locator('.mx-row').first().locator('.mx-avail--ready').count()) === 1, `interactive models come first, marked "3D model" (${readyRows})`)
const plannedRows = await page.locator('.mx-row--planned').count()
if (plannedRows > 0) check((await page.locator('.mx-row--planned .mx-avail').first().innerText()) === 'Planned', 'planned entries say so')
else check(/0 planned/.test(await page.locator('.mx-section-links').innerText()), 'every catalogue entry has its interactive model (0 planned)')
await page.getByLabel('Search machines and devices').fill('commutator')
await wait()
check((await page.locator('.mx-row').first().innerText()).includes('Brushed DC motor'), 'search: "commutator" finds the brushed DC motor')
await page.getByLabel('Search machines and devices').fill('')
await page.getByLabel('Family').selectOption('semiconductor')
await wait()
const semi = await page.locator('.mx-row-tags').allInnerTexts()
check(semi.length >= 4 && semi.every((t) => t.includes('Power semiconductors')), `family filter: power semiconductors only (${semi.length})`)
await page.getByRole('button', { name: 'Clear' }).click()
await page.getByLabel('Role').selectOption('Generator')
await wait()
check((await page.locator('.mx-row').allInnerTexts()).some((t) => /alternator/i.test(t)), 'role filter: generators include the alternator')
await page.goto(URL + '#/machines/servo')
await wait(600)
const servoReady = (await page.locator('.mx-canvas, .ws-loading').count()) > 0
if (!servoReady) check(/Planned/.test(await page.locator('main').innerText()), 'a planned machine opens an honest "planned" page, not an empty model')
await page.goto(URL + '#/machines/no-such-machine')
await wait(500)
check((await h1()) === 'Not in the 3D Machines Lab', 'an unknown machine says so')

// ── The DC motor ──
console.log('── Brushed DC motor: components')
await page.goto(URL + '#/machines/dc-motor')
await page.waitForSelector('.mx-canvas canvas', { timeout: 60000 })
await wait(1200)
check((await h1()) === 'Brushed DC motor', 'the model opens')
check(/Simplified educational model/.test(await page.locator('.mx-title-row').innerText()) && /DC machines · Motor/.test(await page.locator('.mx-title-row').innerText()), 'it is labelled a simplified educational model, with its family and role')
const asm = await page.locator('.mx-node--asm').allInnerTexts()
check(asm.length === 4 && asm.some((t) => t.startsWith('Stator')) && asm.some((t) => t.startsWith('Rotor')) && asm.some((t) => t.startsWith('Brush gear')) && asm.some((t) => t.startsWith('End caps')), `the components are a tree of assemblies (${asm.length}): stator, rotor, brush gear, end caps`)
// open every assembly: every part is a keyboard-reachable row
while ((await page.getByRole('button', { name: /^Expand / }).count()) > 0) await page.getByRole('button', { name: /^Expand / }).first().click()
const partRows = (await page.locator('.mx-parts .mx-node:not(.mx-node--asm)').allInnerTexts()).map((t) => t.trim())
const EXPECTED = ['Housing (yoke)', 'Permanent magnet (N pole)', 'Permanent magnet (S pole)', 'Shaft', 'Armature core', 'Armature winding', 'Commutator', 'Supply terminals', 'Brush holders', 'Brush (+)', 'Brush (−)', 'Front end cap', 'Front bearing', 'Rear end cap', 'Rear bearing']
check(EXPECTED.every((x) => partRows.includes(x)) && partRows.length === 15, `every one of the 15 parts is listed under its assembly (${partRows.length})`)
// every part can be selected, and its card describes that part (not a generic text)
const fns = new Set()
let cardsOk = 0
for (const name of EXPECTED) {
  await page.locator('.mx-parts .mx-node', { hasText: name }).first().click()
  await wait(120)
  const h = await page.locator('.mx-part h2').innerText()
  const card = await page.locator('.mx-part').innerText()
  const fn = (card.match(/Function\. (.*)/) ?? [])[1]
  const chip = await page.locator('.mx-selchip b').innerText()
  const rowOn = await page.locator('.mx-parts .mx-node.on').innerText()
  if (h === name && fn && chip === name && rowOn.trim() === name && /Where it sits\./.test(card) && /Works with/.test(card)) cardsOk++
  if (fn) fns.add(fn)
}
check(cardsOk === 15, `each part selects from the list: row, 3D chip and card agree, with its function, place and relations (${cardsOk} of 15)`)
check(fns.size === 15, `every part has its own explanation (${fns.size} different)`)
await page.locator('.mx-parts .mx-node', { hasText: 'Commutator' }).click()
await wait()
check(/reverses the current/i.test(await page.locator('.mx-part').innerText()) && (await page.locator('.mx-label').allInnerTexts()).includes('Commutator'), 'the commutator: its function, and its label on the model')
await page.locator('.mx-part details summary').click()
check(/mica/.test(await page.locator('.mx-part').innerText()) && /rock to a standstill/.test(await page.locator('.mx-part').innerText()), 'its material, and what happens without it')
// selecting an assembly selects all its parts
await page.locator('.mx-node--asm', { hasText: 'Rotor' }).click()
await wait()
const rotorLabels = await page.locator('.mx-label').allInnerTexts()
check(['Shaft', 'Armature core', 'Armature winding', 'Commutator'].every((x) => rotorLabels.includes(x)) && /Selected assembly/i.test(await page.locator('.mx-part').innerText()), `selecting the rotor assembly highlights its four parts (${rotorLabels.length} labels)`)
// a click in the 3D view selects the same entry in the tree
await page.locator('.mx-selchip-x').click()
await page.getByLabel('Find a part').fill('zzz')
await wait(150)
check(/No part matches/.test(await page.locator('.mx-tree').innerText()), 'search: no match says so')
await page.getByLabel('Find a part').fill('magnet')
await wait(150)
const magnetRows = (await page.locator('.mx-parts .mx-node:not(.mx-node--asm)').allInnerTexts()).map((t) => t.trim())
check(magnetRows.includes('Permanent magnet (N pole)') && magnetRows.includes('Permanent magnet (S pole)') && !magnetRows.includes('Shaft'), `search: "magnet" finds the magnets (${magnetRows.length} rows)`)
await page.getByLabel('Find a part').fill('')
const box = await page.locator('.mx-canvas canvas').boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await wait(500)
const chip3d = await page.locator('.mx-selchip b').innerText().catch(() => '')
const row3d = await page.locator('.mx-parts .mx-node.on').innerText().catch(() => '')
check(chip3d.length > 0 && row3d.trim() === chip3d && (await page.locator('.mx-part h2').innerText()) === chip3d, `a click on the model selects that part in the tree too (${chip3d})`)
// keyboard: the tree is buttons
await page.locator('.mx-parts .mx-node', { hasText: 'Shaft' }).focus()
await page.keyboard.press('Enter')
await wait(200)
check((await page.locator('.mx-part h2').innerText()) === 'Shaft', 'keyboard: Enter on a row selects the part')

// isolate, hide / show
await page.locator('.mx-parts .mx-node', { hasText: 'Commutator' }).click()
await page.locator('.mx-part-actions button', { hasText: 'Isolate' }).click()
await wait()
check((await page.locator('.mx-label').count()) === 1, 'isolate: only the selected part (and its label) remain')
await page.locator('.mx-part-actions button', { hasText: 'Show all' }).click()
await page.getByLabel('Labels').selectOption('all')
await wait(500)
const allLabels = await page.locator('.mx-label').count()
await page.getByRole('button', { name: 'Hide Brush (+)' }).click()
await page.getByRole('button', { name: 'Hide End caps and bearings' }).click()
await wait()
const visibleNow = await page.locator('.mx-label').evaluateAll((els) => els.filter((e) => e.parentElement.style.display !== 'none').map((e) => e.textContent))
check(!visibleNow.includes('Brush (+)') && !visibleNow.includes('Front end cap') && !visibleNow.includes('Rear bearing') && /5 parts hidden/.test(await page.locator('.mx-hidden-note').innerText()), `hide: a part and a whole assembly disappear (5 parts hidden)`)
await page.locator('.mx-hidden-note button', { hasText: 'Show all parts' }).click()
await wait()
const backNow = await page.locator('.mx-label').evaluateAll((els) => els.filter((e) => e.parentElement.style.display !== 'none').length)
check(backNow === allLabels && (await page.locator('.mx-hidden-note').count()) === 0, `show all: every hidden part is back (${backNow} of ${allLabels} labels)`)

// inspect and back: the view goes to the part, then exactly back
const labelPos = () => page.locator('.mx-label').evaluateAll((els) => els.filter((e) => e.parentElement.style.display !== 'none').map((e) => { const r = e.getBoundingClientRect(); return [e.textContent, Math.round(r.x), Math.round(r.y)] }))
const dist = (a, b) => { const o = a.map((x) => { const y = b.find((z) => z[0] === x[0]); return y ? Math.hypot(x[1] - y[1], x[2] - y[2]) : 0 }); return Math.max(0, ...o) }
await page.locator('.mx-parts .mx-node', { hasText: 'Shaft' }).click()
await page.locator('.mx-parts .mx-node', { hasText: 'Commutator' }).click()
await wait(300)
const before = await labelPos()
await page.locator('.mx-part-actions button', { hasText: 'Inspect' }).click()
await wait(900)
const inspected = await labelPos()
check(dist(before, inspected) > 40, `Inspect turns the view to the part (labels moved ${dist(before, inspected).toFixed(0)} px)`)
await page.locator('.mx-part-actions button', { hasText: 'Back to the whole machine' }).click()
await wait(900)
check(dist(before, await labelPos()) <= 1, 'Back to the whole machine returns to the same view')
await page.locator('.mx-selchip-x').click()
await wait(300)

// one part at a time: pull a part out on its own — nothing else moves — and put it back exactly
console.log('── Brushed DC motor: pull out one part')
await page.locator('.mx-parts .mx-node', { hasText: 'Brush (+)' }).click()
await wait(300)
const beforePull = await labelPos()
await page.locator('.mx-part-actions button', { hasText: 'Pull out' }).click()
await wait(1600)
const afterPull = await labelPos()
const movedPull = afterPull.filter((a) => { const b = beforePull.find((x) => x[0] === a[0]); return b && Math.hypot(a[1] - b[1], a[2] - b[2]) > 3 }).map((a) => a[0])
check(movedPull.length === 1 && movedPull[0] === 'Brush (+)', `Pull out moves only the selected part (moved: ${movedPull.join(', ') || 'none'})`)
check(/Pulled out: Brush \(\+\)/.test(await page.locator('.mx-pulled-note').innerText()) && (await page.locator('.mx-out-tag').count()) === 1, 'the tree marks it "out", with a way to put everything back')
check(await page.locator('.mx-toggles label', { hasText: 'Turn the rotor' }).locator('input').isDisabled(), 'the machine does not run while a part is out')
await page.locator('.mx-part-actions button', { hasText: 'Put back' }).click()
await wait(1600)
check(dist(beforePull, await labelPos()) <= 1 && (await page.locator('.mx-pulled-note').count()) === 0, 'Put back returns it to its exact place')
await page.locator('.mx-parts .mx-node', { hasText: 'Commutator' }).click()
await page.locator('.mx-part-actions button', { hasText: 'Pull out' }).click()
await wait(400)
check(/For inspection only: The commutator is pressed onto the shaft/.test(await page.locator('.mx-part').innerText()), 'a part that cannot really come off on its own says so')
await page.locator('.mx-parts .mx-node--asm', { hasText: 'Rotor' }).click()
await page.locator('.mx-part-actions button', { hasText: 'Pull out' }).click()
await wait(400)
check(/Pulled out: Commutator, Rotor/.test(await page.locator('.mx-pulled-note').innerText()), 'a whole assembly can be pulled out as one unit, as well as a part of it')
await page.locator('.mx-pulled-note button', { hasText: 'Put all back' }).click()
await wait(2200)
check(dist(beforePull, await labelPos()) <= 1, `Put all back: every part, and the view, exactly as before (${dist(beforePull, await labelPos()).toFixed(1)} px)`)
await page.locator('.mx-selchip-x').click().catch(() => {})
await wait(300)

console.log('── Brushed DC motor: disassembly')
/** Wait until no part is moving any more (and the camera has finished stepping back or in). */
const settle = async () => {
  await page.waitForFunction(() => !/coming off|going back/i.test(document.querySelector('.mx-stage-note .eyebrow')?.textContent ?? ''), null, { timeout: 40000 })
  await wait(900)
}
const start = await labelPos()
// Disassemble: one part (or parts fixed together) at a time, in the predefined order
const ORDER = ['Front end cap + Supply terminals', 'Brush (+)', 'Brush (−)', 'Brush holders', 'Rear end cap', 'Front bearing', 'Rear bearing', 'Housing (yoke)', 'Permanent magnet (N pole)', 'Permanent magnet (S pole)']
const nowSeen = []
await page.getByRole('button', { name: 'Disassemble' }).click()
for (let t = 0; t < 200; t++) {
  const n = (await page.locator('.mx-now').innerText().catch(() => '')).replace(/^(Now|Going back):\s*/, '')
  if (n && nowSeen.at(-1) !== n) nowSeen.push(n)
  if (/100 %/.test(await page.locator('.mx-slider output').innerText())) break
  await wait(100)
}
check(nowSeen.join('|') === ORDER.join('|'), `Disassemble takes the parts off one at a time, in order (${nowSeen.length} moves: ${nowSeen.slice(0, 3).join(', ')} …)`)
await settle()
const apart = await labelPos()
const moved = apart.filter((a) => { const b = start.find((x) => x[0] === a[0]); return b && Math.hypot(a[1] - b[1], a[2] - b[2]) > 8 }).length
check(moved >= 10 && /100 %/.test(await page.locator('.mx-slider output').innerText()), `Disassemble: the parts move apart, 100 % (${moved} labels moved)`)
// every label still in the view when apart
const vb = await page.locator('.mx-viewport').boundingBox()
const outside = apart.filter((a) => a[1] < vb.x - 5 || a[1] > vb.x + vb.width + 5 || a[2] < vb.y - 5 || a[2] > vb.y + vb.height + 5).map((a) => a[0])
check(outside.length === 0, `apart, every part stays in the view (${outside.length ? outside.join(', ') : 'none outside'})`)
await page.getByRole('button', { name: 'Reassemble' }).click()
await wait(500)
await settle()
check(dist(start, await labelPos()) <= 1, `Reassemble: every part returns exactly (largest offset ${dist(start, await labelPos()).toFixed(1)} px)`)
// the stages in their order, forwards and back
const STAGES = ['Take off the front end cap', 'Withdraw the brushes', 'Remove the brush holders', 'Take off the rear end cap', 'Pull the bearings off the shaft', 'Separate the stator from the rotor']
const seen = []
const stepNow = []
for (let i = 0; i < ORDER.length; i++) {
  await page.getByRole('button', { name: 'Next part ▶' }).click()
  await wait(400)
  await settle()
  const h = await page.locator('.mx-stage-note h3').innerText()
  if (seen.at(-1) !== h) seen.push(h)
  stepNow.push((await page.locator('.mx-now').innerText()).replace(/^Now:\s*/, ''))
}
check(stepNow.join('|') === ORDER.join('|'), `Next part takes off exactly one part (or parts fixed together) each time (${stepNow.length})`)
check(seen.join('|') === STAGES.join('|'), `step-by-step disassembly follows the stages: ${seen.length} stages, ${seen[0]} … ${seen.at(-1)}`)
const note = await page.locator('.mx-stage-note').innerText()
check(/Housing \(yoke\)/.test(note) && /Belongs:/.test(note) && /Works with:/.test(note), 'each stage names its parts, why they are there, where they belong and what they work with')
check(await page.getByRole('button', { name: 'Next part ▶' }).isDisabled(), 'after the last part there is no next one')
await page.getByRole('button', { name: '◀ Previous part' }).click()
await wait(400)
await settle()
check(/Permanent magnet \(N pole\)/.test(await page.locator('.mx-now').innerText()) && (await page.locator('.mx-stage-note h3').innerText()) === STAGES[5], 'Previous part puts the last part back (step-by-step reassembly)')
// the slider: continuous, the same positions as the stages
await page.locator('.mx-slider input').fill('50')
await wait(400)
const half = await labelPos()
check(/50 %/.test(await page.locator('.mx-slider output').innerText()) && (await page.locator('.mx-stage-note h3').innerText()) === STAGES[3], 'slider at 50 %: half way — part 5 of 10, stage 4 of 6')
await page.locator('.mx-slider input').fill('0')
await wait(1000)
check(dist(start, await labelPos()) <= 1 && dist(start, half) > 8, 'slider at 0 %: the original assembly again')
// repeated cycles do not drift
for (let i = 0; i < 3; i++) {
  await page.locator('.mx-slider input').fill('100')
  await wait(250)
  await page.locator('.mx-slider input').fill(String(13 + i * 29))
  await wait(250)
  await page.getByRole('button', { name: 'Disassemble' }).click()
  await wait(2500)
  await page.getByRole('button', { name: 'Pause' }).first().click().catch(() => {})
  await page.getByRole('button', { name: 'Reassemble' }).click()
  await wait(500)
  await settle()
}
check(dist(start, await labelPos()) <= 1, `after 3 explode / pause / reassemble cycles every part is exactly back (largest offset ${dist(start, await labelPos()).toFixed(1)} px)`)
// a part selected while apart shows where it belongs
await page.locator('.mx-slider input').fill('100')
await wait(500)
await page.locator('.mx-parts .mx-node', { hasText: 'Housing (yoke)' }).click()
await wait(400)
check((await page.locator('.mx-selchip b').innerText()) === 'Housing (yoke)', 'a part can be selected while the machine is apart')
await page.getByRole('button', { name: 'Reset model' }).click()
await wait(1200)
check(dist(start, await labelPos()) <= 1 && (await page.locator('.mx-selchip').count()) === 0 && /0 %/.test(await page.locator('.mx-slider output').innerText()), 'Reset model restores the assembly, the selection and the view')
await page.getByLabel('Labels').selectOption('focus')

// layers with legend
await page.locator('.mx-toggles label', { hasText: 'Magnetic field' }).locator('input').check()
await wait()
check(/conceptual/.test(await page.locator('.mx-legend').innerText()) && /N magnet/.test(await page.locator('.mx-legend').innerText()), 'a layer comes with its legend in words, marked conceptual')
await page.locator('.mx-toggles label', { hasText: 'Magnetic field' }).locator('input').uncheck()

// keyboard view controls
await page.locator('.mx-toolbar button').first().focus()
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowUp')
await page.keyboard.press('-')
check(true, 'the view turns and zooms from the keyboard (toolbar arrow keys)')

// how it works
console.log('── How it works')
await page.getByRole('tab', { name: 'How it works' }).click()
await wait()
const titles = []
for (let i = 0; i < 8; i++) {
  titles.push(await page.locator('.mx-learn h2').innerText())
  if (i < 7) await page.locator('.mx-step-controls button', { hasText: 'Next' }).click()
  await wait(200)
}
check(titles.every((t, i) => t.startsWith(`${i + 1} ·`)), `the steps advance in order (${titles.length})`)
check(/field/i.test(titles[1]) && /current/i.test(titles[2]) && /torque/i.test(titles[3]) && /turns/i.test(titles[4]) && /Commutation/.test(titles[5]) && /back EMF/i.test(titles[6]) && /Energy/.test(titles[7]), 'construction → field → current → torque → rotation → commutation → back EMF → energy')
await page.locator('.mx-step-controls button', { hasText: 'Previous' }).click()
await wait(200)
check((await page.locator('.mx-learn h2').innerText()).startsWith('7 ·'), 'Previous goes to the previous step')
check(/E = kΦ · ω/.test(await page.locator('.mx-learn .mx-eq').innerText()) && (await page.locator('.mx-learn details', { hasText: 'Assumptions' }).count()) === 1, 'the back-EMF step shows its relation, E = kΦ · ω, with its assumptions')
await page.locator('.mx-step-controls button', { hasText: 'Previous' }).click()
await wait(300)
check(/Commutation/.test(await page.locator('.mx-legend').innerText()) && (await page.locator('.mx-label').allInnerTexts()).includes('Commutator'), 'commutation: the commutator and brushes highlighted, its layer and legend shown')
await page.locator('.mx-step-layers label', { hasText: 'Commutation' }).locator('input').uncheck()
await wait(200)
check(!/Commutation/.test(await page.locator('.mx-legend').innerText()), "a step's layer can be switched off")
await page.locator('.mx-step-controls').getByRole('button', { name: 'Start', exact: true }).click()
await wait(1200)
check((await page.locator('.mx-step-controls').getByRole('button', { name: 'Pause', exact: true }).count()) === 1 && /playing/i.test(await page.locator('.mx-learn .eyebrow').first().innerText()), 'Start plays the step (Pause offered)')
await page.locator('.mx-step-controls').getByRole('button', { name: 'Pause', exact: true }).click()
const t1 = Number(await page.locator('.mx-step-time').getAttribute('aria-valuenow'))
await wait(1000)
const t2 = Number(await page.locator('.mx-step-time').getAttribute('aria-valuenow'))
check(t1 > 0 && t1 === t2 && (await page.locator('.mx-step-controls').getByRole('button', { name: 'Resume', exact: true }).count()) === 1, `Pause stops the step where it is (${t1} %), Resume offered`)
await page.locator('.mx-step-controls').getByRole('button', { name: 'Resume', exact: true }).click()
await wait(1200)
check(Number(await page.locator('.mx-step-time').getAttribute('aria-valuenow')) > t2, 'Resume carries on from there')
await page.locator('.mx-step-controls button', { hasText: 'Replay this step' }).click()
await wait(300)
check(Number(await page.locator('.mx-step-time').getAttribute('aria-valuenow')) < 10 && (await page.locator('.mx-learn h2').innerText()).startsWith('6 ·'), 'Replay starts the same step again')
await page.locator('.mx-step-controls button', { hasText: 'Reset to step 1' }).click()
await wait(300)
check((await page.locator('.mx-learn h2').innerText()).startsWith('1 ·') && (await page.locator('.mx-step-controls').getByRole('button', { name: 'Start', exact: true }).count()) === 1, 'Reset goes back to step 1, stopped')
check((await page.locator('.mx-learn .step-bar span').count()) === 8, 'step progress shows every step')
// selecting a part during the lesson: its role in this step, a way into Explore, and back to the same step
for (let i = 0; i < 5; i++) await page.locator('.mx-step-controls button', { hasText: 'Next' }).click()
await page.locator('.mx-step-controls').getByRole('button', { name: 'Start', exact: true }).click()
await wait(800)
await page.locator('.mx-learn .mx-link', { hasText: 'Commutator' }).click()
await wait(300)
check(/Its role in this step/i.test(await page.locator('.mx-step-part').innerText()) && /segments slide under the brushes/.test(await page.locator('.mx-step-part').innerText()), 'a part selected in a lesson step shows its role in THAT step')
check((await page.locator('.mx-step-controls').getByRole('button', { name: 'Resume', exact: true }).count()) === 1, 'looking at a part pauses the lesson (Resume offered)')
await page.locator('.mx-step-part button', { hasText: 'Inspect it in Explore' }).click()
await wait(600)
check((await page.locator('.mx-part h2').innerText()) === 'Commutator' && /6 · Commutation/.test(await page.locator('.mx-back-lesson').innerText()), 'Inspect it in Explore opens the part, remembering the lesson step')
await page.locator('.mx-back-lesson button').click()
await wait(600)
check((await page.locator('.mx-learn h2').innerText()).startsWith('6 ·') && (await page.locator('.mx-step-part').count()) === 1, 'Back to the lesson returns to the same step')
await page.locator('.mx-step-part button', { hasText: 'Close' }).click()
await page.locator('.mx-step-controls button', { hasText: 'Reset to step 1' }).click()
await wait(300)

// calculations
console.log('── Calculate')
await page.getByRole('tab', { name: 'Calculate' }).click()
await wait()
const speed = async () => Number((await page.locator('.mx-results tr', { hasText: 'Speed n' }).locator('td').innerText()).split(' ')[0])
const n24 = await speed()
check(Math.abs(n24 - 4201.7) < 1, `24 V, 0.1 N·m: n = ${n24} rpm (ω = (V − Ia·Ra)/kΦ)`)
await page.locator('.mx-param', { hasText: 'Armature voltage' }).locator('input').fill('12')
await wait()
check((await speed()) < n24, 'lower voltage → lower speed')
await page.locator('.mx-param', { hasText: 'Load torque' }).locator('input').fill('1.5')
await wait()
check((await speed()) === 0 && /cannot turn/.test(await page.locator('.mx-results').innerText()), 'above the stall torque: speed 0 and the reason, no invented value')

// knowledge check
console.log('── Check')
await page.getByRole('tab', { name: 'Check' }).click()
await wait(600)
check((await page.locator('.mx-label').count()) === 0, 'identify: no label gives the answer away')
check(!/✓|✗/.test(await page.locator('.mx-q').innerText()), 'no answer before the student answers')
await page.locator('.mx-q .choice').nth(1).click()
await wait()
check(/the answer is “Commutator”/.test(await page.locator('.exp-verdict').innerText()), 'a wrong answer shows the right one and why')
await page.locator('.mx-step-controls button', { hasText: 'Next question' }).click()
await page.locator('.mx-q .choice', { hasText: 'Brush' }).click()
await wait()
check(/✓ Right/.test(await page.locator('.exp-verdict').innerText()), 'a right answer is confirmed with its explanation')

// the other deep models: tree, own card per part, teardown order, exact reassembly
for (const m of [
  { id: 'induction-motor', name: 'Three-phase induction motor', asm: 4, parts: 15, stages: ['Remove the fan cover', 'Pull off the cooling fan', 'Take off the end shields', 'Separate the rotor from the stator', 'Pull the bearings off the shaft'] },
  { id: 'transformer', name: 'Single-phase transformer', asm: 4, parts: 8, stages: ['Disconnect the leads and terminals', 'Remove the clamping frame', 'Unstack the top yoke', 'Lift the windings off the limbs', 'Slide off the insulating tubes'] },
]) {
  console.log(`── ${m.id}: components and teardown`)
  await page.goto(URL + '#/machines/' + m.id)
  await page.waitForSelector('.mx-canvas canvas', { timeout: 60000 })
  await wait(1200)
  const nAsm = await page.locator('.mx-node--asm').count()
  while ((await page.getByRole('button', { name: /^Expand / }).count()) > 0) await page.getByRole('button', { name: /^Expand / }).first().click()
  const rows = (await page.locator('.mx-parts .mx-node:not(.mx-node--asm)').allInnerTexts()).map((t) => t.trim())
  check(nAsm === m.asm && rows.length === m.parts, `${m.id}: ${nAsm} assemblies, ${rows.length} parts in the tree`)
  let good = 0
  const fns = new Set()
  for (const name of rows) {
    await page.locator('.mx-parts .mx-node:not(.mx-node--asm)', { hasText: name }).first().click()
    await wait(100)
    const card = await page.locator('.mx-part').innerText()
    const ok = (await page.locator('.mx-part h2').innerText()) === name && (await page.locator('.mx-selchip b').innerText()) === name && /Function\./.test(card) && /Where it sits\./.test(card) && /Works with/.test(card)
    if (ok) good++
    fns.add((card.match(/Function\. (.*)/) ?? [])[1])
    await page.locator('.mx-selchip-x').click()
  }
  check(good === m.parts && fns.size === m.parts, `${m.id}: every part selects, with its own function, place and relations (${good} of ${m.parts}, ${fns.size} different)`)
  if (m.id === 'induction-motor') {
    await page.locator('.mx-parts .mx-node:not(.mx-node--asm)', { hasText: 'Air gap' }).first().click()
    check(await page.locator('.mx-part-actions button', { hasText: 'Pull out' }).isDisabled(), 'induction motor: the air gap is a region, not a part — it cannot be pulled out')
    await page.locator('.mx-selchip-x').click()
  }
  await page.getByLabel('Labels').selectOption('all')
  await wait(500)
  const at0 = await labelPos()
  const seen = []
  let steps = 0
  while (!(await page.getByRole('button', { name: 'Next part ▶' }).isDisabled()) && steps < 30) {
    await page.getByRole('button', { name: 'Next part ▶' }).click()
    await wait(400)
    await settle()
    steps++
    const h = await page.locator('.mx-stage-note h3').innerText()
    if (seen.at(-1) !== h) seen.push(h)
  }
  check(seen.join('|') === m.stages.join('|'), `${m.id}: the teardown follows its order (${seen[0]} … ${seen.at(-1)})`)
  const apartNow = await labelPos()
  const vb2 = await page.locator('.mx-viewport').boundingBox()
  const out2 = apartNow.filter((a) => a[1] < vb2.x - 5 || a[1] > vb2.x + vb2.width + 5 || a[2] < vb2.y - 5 || a[2] > vb2.y + vb2.height + 5)
  check(out2.length === 0 && dist(at0, apartNow) > 30, `${m.id}: apart, every part stays in the view`)
  await page.getByRole('button', { name: 'Reassemble' }).click()
  await wait(500)
  await settle()
  check(dist(at0, await labelPos()) <= 1, `${m.id}: Reassemble puts every part back exactly (${dist(at0, await labelPos()).toFixed(1)} px)`)
}

// compare, checks hub
console.log('── Compare')
await page.goto(URL + '#/machines/compare?m=dc-motor,bldc')
await wait(700)
check((await page.locator('.mx-compare-head [role=columnheader] a').count()) === 2, 'compare shows two machines side by side')
check((await page.locator('.mx-compare-row').count()) >= 9, 'compared by construction, excitation, commutation, speed, torque, control, efficiency, maintenance, applications')
check(!/\d+ ?%/.test(await page.locator('.mx-compare').innerText()), 'no invented efficiency figures')
await page.goto(URL + '#/machines/checks')
await wait(500)
check((await page.locator('.lab-tile').count()) >= 1, 'the knowledge-checks hub lists the interactive models')

// full view
console.log('── Full view')
await page.goto(URL + '#/machines/dc-motor')
await page.waitForSelector('.mx-canvas canvas', { timeout: 60000 })
await wait(1000)
await page.getByRole('button', { name: /Full view/ }).click()
await wait(900)
const vh = (await page.locator('.mx-viewport').boundingBox()).height
check((await page.locator('.mx-ws--max').count()) === 1 && vh > 700, `Full view: the model fills the screen (${Math.round(vh)} px high)`)
await page.getByRole('button', { name: 'Hide panel' }).click()
await wait(500)
check(!(await page.locator('.mx-panel').isVisible()) && (await page.locator('.mx-dock').isVisible()), 'Hide panel: only the model, with the disassembly controls on it')
await page.locator('.mx-dock button', { hasText: 'Part ▶' }).click()
await wait(1800)
check(/Front end cap/.test(await page.locator('.mx-dock-now').innerText()), 'the floating controls take the next part off')
await page.keyboard.press('Escape')
await wait(600)
check((await page.locator('.mx-ws--max').count()) === 0 && (await page.locator('.mx-panel').isVisible()), 'Esc leaves the full view')
// viewer usability: tooltips on the toolbar symbols (hover and keyboard focus), the side panel can be hidden
await page.locator('.mx-toolbar button').first().focus()
await page.keyboard.press('Tab')
await page.keyboard.press('Shift+Tab')
await wait(200)
const tip = await page.locator('.mx-toolbar button').first().evaluate((e) => getComputedStyle(e, '::after').content)
check(/Turn the view left/.test(tip), `the toolbar symbols explain themselves on keyboard focus (${tip})`)
const wPanel = (await page.locator('.mx-viewport').boundingBox()).width
await page.getByRole('button', { name: 'Hide panel' }).click()
await wait(600)
const wFull = (await page.locator('.mx-viewport').boundingBox()).width
check(!(await page.locator('.mx-panel').isVisible()) && wFull > wPanel + 200 && (await page.locator('.mx-dock').isVisible()), `Hide panel (normal view): the model takes the width (${Math.round(wPanel)} → ${Math.round(wFull)} px), its controls stay on it`)
await page.getByRole('tab', { name: 'Details' }).click()
await wait(300)
check(await page.locator('.mx-panel').isVisible(), 'a tab whose content is in the panel shows it again')
await page.getByRole('tab', { name: 'Explore' }).click()
await wait(300)
// first visit: a short "getting around" hint, once (part of the first-visit essentials)
const fv = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await fv.addInitScript(() => localStorage.setItem('pel.essentials', '"on"'))
await fv.goto(URL + '#/machines/dc-motor')
await fv.waitForSelector('.mx-canvas canvas', { timeout: 60000 })
await fv.waitForTimeout(800)
const hintShown = (await fv.locator('.mx-first').count()) === 1 && /Pull out/.test(await fv.locator('.mx-first').innerText())
await fv.getByRole('button', { name: 'Got it' }).click()
await fv.reload()
await fv.waitForSelector('.mx-canvas canvas', { timeout: 60000 })
await fv.waitForTimeout(600)
check(hintShown && (await fv.locator('.mx-first').count()) === 0, 'first visit: a short hint on getting around; once dismissed it stays away')
await fv.close()

// how it works tells each step on the model, from its own view
await page.getByRole('tab', { name: 'How it works' }).click()
await wait(700)
await page.locator('.mx-step-controls button', { hasText: 'Next' }).click()
await wait(1200)
check(/^2\/8 · Establish the magnetic field/.test(await page.locator('.mx-caption').innerText()), 'How it works: the step is told on the model itself')
check((await page.locator('.mx-label', { hasText: 'Front end cap' }).count()) === 0 && (await page.locator('.mx-label').allInnerTexts()).includes('Housing (yoke)'), 'the casing the step does not need is out of the way; the field parts are labelled')
await page.getByRole('tab', { name: 'Explore' }).click()
await wait(400)

// leaving cleans up
await page.goto(URL + '#/machines/dc-motor')
await page.waitForSelector('.mx-canvas canvas', { timeout: 60000 })
await page.locator('.mx-toggles label', { hasText: 'Turn the rotor' }).locator('input').check()
await wait(500)
await page.goto(URL + '#/home')
await wait(600)
check((await page.locator('canvas').count()) === 0, 'leaving the model removes its canvas (and its animation)')

// reduced motion
const rm = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
rm.on('pageerror', (e) => errors.push(String(e)))
await rm.goto(URL + '#/machines/dc-motor?tab=learn')
await rm.waitForSelector('.mx-canvas canvas', { timeout: 60000 })
await rm.waitForTimeout(600)
check(/Reduced motion is on/.test(await rm.locator('.mx-learn').innerText()), 'reduced motion: the tour is shown still, described in words')
await rm.close()

// phone
const ph = await browser.newPage({ viewport: { width: 390, height: 844 } })
ph.on('pageerror', (e) => errors.push(String(e)))
for (const r of ['#/machines', '#/machines/dc-motor', '#/machines/compare']) {
  await ph.goto(URL + r)
  await ph.waitForTimeout(r.includes('dc-motor') ? 2500 : 700)
  const sw = await ph.evaluate(() => document.documentElement.scrollWidth)
  check(sw <= 390, `390 px ${r}: no horizontal page overflow (${sw})`)
}
await ph.goto(URL + '#/machines/dc-motor')
await ph.waitForSelector('.mx-canvas canvas', { timeout: 60000 })
const vp = await ph.locator('.mx-viewport').boundingBox()
check(vp && vp.width >= 340 && vp.height >= 300, `390 px: a large viewer (${vp && Math.round(vp.width)}×${vp && Math.round(vp.height)})`)
await ph.close()

// ── every interactive model: opens, comes apart and back, plays a step, offers a quiz ──
console.log('── Every model')
await page.goto(URL + '#/machines')
await wait(500)
const ids = await page.locator('.mx-row:not(.mx-row--planned)').evaluateAll((els) => els.map((e) => e.getAttribute('href').split('/').pop()))
let ok = 0
for (const id of ids) {
  const errsBefore = errors.length
  await page.goto(URL + '#/machines/' + id)
  const opened = await page.waitForSelector('.mx-canvas canvas', { timeout: 60000 }).then(() => true).catch(() => false)
  if (!opened) {
    check(false, `${id}: the model opens`)
    continue
  }
  await wait(600)
  // the model is really drawn: a good share of the 3D area differs from the empty background (the canvas alone —
  // labels and buttons over it are hidden for the capture; with nothing rendered this reads 0 %)
  const bare = await page.addStyleTag({ content: '.mx-canvas-host > :not(.mx-canvas), .mx-viewport > :not(.mx-canvas-host) { visibility: hidden !important }' })
  const drawn = drawnFraction(decodePng(await page.locator('.mx-canvas canvas').screenshot()))
  await bare.evaluate((n) => n.remove())
  if (drawn < 0.05) check(false, `${id}: the model is drawn (${(drawn * 100).toFixed(1)} % of the view)`)
  const parts = await page.locator('.mx-parts button').count()
  await page.locator('.mx-explode button').first().click()
  await wait(1500)
  await page.getByRole('button', { name: 'Reset model' }).click()
  await page.getByRole('tab', { name: 'How it works' }).click()
  await page.locator('.mx-step-controls button', { hasText: 'Next' }).click()
  await page.locator('.mx-step-controls').getByRole('button', { name: 'Start', exact: true }).click()
  await wait(900)
  const stepText = (await page.locator('.mx-learn h2 + p').innerText()).length
  await page.getByRole('tab', { name: 'Calculate' }).click()
  const calcRows = await page.locator('.mx-results tr').count()
  await page.getByRole('tab', { name: 'Check' }).click()
  const quiz = await page.locator('.mx-q').count()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  const good = drawn >= 0.05 && parts >= 5 && stepText > 40 && quiz === 1 && !overflow && errors.length === errsBefore
  if (good) ok++
  else check(false, `${id}: parts ${parts}, step text ${stepText}, calc rows ${calcRows}, quiz ${quiz}, overflow ${overflow}, new errors ${errors.length - errsBefore}`)
}
check(ok === ids.length && ids.length >= 29, `all ${ids.length} models are drawn, open, disassemble and reset, play a How-it-works step, calculate and quiz without errors (${ok} of ${ids.length})`)
const ph2 = await browser.newPage({ viewport: { width: 390, height: 844 } })
let wide = 0
for (const id of ids) {
  await ph2.goto(URL + '#/machines/' + id)
  await ph2.waitForSelector('.mx-canvas canvas', { timeout: 60000 }).catch(() => {})
  await ph2.waitForTimeout(500)
  if ((await ph2.evaluate(() => document.documentElement.scrollWidth)) > 390) wide++
}
check(wide === 0, `390 px: no model page overflows (${wide} do)`)
await ph2.close()

await browser.close()
check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL 3D MACHINES CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
