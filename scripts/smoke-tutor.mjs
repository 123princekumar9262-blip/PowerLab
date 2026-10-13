/**
 * Browser checks of "Ask a doubt" after the move to a server-side tutor (api/tutor.ts). The tutor's replies are
 * simulated here (the route is intercepted), so the suite never spends Gemini quota. Run against the dev server
 * or a preview (both serve /api/tutor):
 *   node scripts/smoke-tutor.mjs
 */
import { chromium } from 'playwright'
import { fullWorkspace } from './full-workspace.mjs'

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
const wait = (ms = 400) => page.waitForTimeout(ms)

// every request the page makes: none may go to Google, none may carry a key
const requests = []
page.on('request', (r) => requests.push({ url: r.url(), headers: r.headers(), body: r.postData() ?? '' }))

console.log('── The tutor panel')
const sent = []
let reply = 'ok'
await page.route('**/api/tutor', async (route) => {
  sent.push({ headers: route.request().headers(), body: route.request().postData() })
  if (reply === 'limit') return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Too many questions in a short time. Wait a minute and ask again.' }) })
  if (reply === 'slow') await new Promise((r) => setTimeout(r, 1500))
  const events = [{ t: 'In this simulation the output ' }, { t: 'average is **5.06 V**.' }, { done: true }]
  return route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') })
})
await page.goto(URL + '#/labs/rectifiers/1ph-half-wave?load=R')
await page.waitForSelector('.ws-act', { timeout: 60000 })
await wait(800)
await page.locator('.ws-act', { hasText: 'Ask' }).first().click()
await wait(500)
check((await page.locator('.ask textarea').count()) === 1 && !/API key/i.test(await page.locator('.ask').innerText()), 'Ask is ready at once — no key to set up')
reply = 'slow'
await page.locator('.ask textarea').fill('Why is the output 5 V?')
await page.locator('.ask-form button', { hasText: 'Ask' }).click()
await wait(300)
check((await page.locator('.ask-thinking').count()) === 1 && (await page.locator('.ask-form button', { hasText: 'Stop' }).count()) === 1, 'while waiting: "Thinking…" and a Stop button')
await wait(2000)
check(/average is 5\.06 V/.test(await page.locator('.ask-msg--assistant').last().innerText()) && (await page.locator('.ask-msg--assistant b').count()) >= 1, 'the streamed answer appears, formatted')
const body = JSON.parse(sent[0].body)
check(Object.keys(body).sort().join(',') === 'context,messages' && body.messages.at(-1).content === 'Why is the output 5 V?' && body.context.length > 50, 'it sends only the question history and the simulation data')
check(!Object.keys(sent[0].headers).some((h) => /goog|api-key|authorization/i.test(h)), 'no key or credential header leaves the browser')
reply = 'limit'
await page.locator('.ask textarea').fill('And now?')
await page.locator('.ask-form button', { hasText: 'Ask' }).click()
await wait(800)
check(/Wait a minute/.test(await page.locator('.ask-error').innerText()), 'a refused question shows the server’s message')
check(!requests.some((r) => /googleapis\.com/.test(r.url)), `no request from the browser to Google (${requests.length} requests made)`)
check(!requests.some((r) => /x-goog-api-key/i.test(JSON.stringify(r.headers))), 'no request carries a Gemini key header')

console.log('── Help & settings')
await page.goto(URL + '#/settings')
await wait(600)
const settings = await page.locator('.assist-settings').innerText()
check(/nothing to set up/.test(settings) && (await page.locator('.assist-settings input').count()) === 0, 'settings: no key field, it says the server holds it')
check(await page.evaluate(() => localStorage.getItem('pel.assist') === null), 'a key saved in this browser by an earlier version is removed')

console.log('── The endpoint (real server handler, no Gemini call)')
await page.unroute('**/api/tutor')
const api = page.request
const post = (data, headers = {}) => api.post(URL + 'api/tutor', { data, headers: { 'content-type': 'application/json', ...headers }, failOnStatusCode: false })
check((await api.get(URL + 'api/tutor', { failOnStatusCode: false })).status() === 405, 'GET is refused (405)')
check((await post({ context: 'c', messages: [] })).status() === 400, 'an empty question is refused (400)')
check((await post({ context: 'c', messages: [{ role: 'user', content: 'q' }], model: 'gemini-pro-latest' })).status() === 400, 'choosing a model from the browser is refused (400)')
check((await post({ context: 'c', messages: [{ role: 'user', content: 'q' }] }, { origin: 'https://evil.example.com' })).status() === 403, 'another website is refused (403)')
check((await post({ context: 'x'.repeat(40_000), messages: [{ role: 'user', content: 'q' }] })).status() === 413, 'an oversized request is refused (413)')
const refused = await post({ context: 'c', messages: [] })
check(!/AQ\.|AIza/.test(await refused.text()), 'refusals contain no key')

console.log('── The bundle served to the browser')
const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.src))
let leak = false
const seenJs = new Set(requests.filter((r) => /\.js(\?|$)/.test(r.url)).map((r) => r.url).concat(scripts))
for (const u of seenJs) {
  const t = await (await api.get(u)).text()
  if (/AQ\.[0-9A-Za-z_-]{30,}|AIza[0-9A-Za-z_-]{35}|generativelanguage\.googleapis\.com|x-goog-api-key/i.test(t)) leak = true
}
check(!leak && seenJs.size > 0, `no Gemini key or direct Gemini call in the ${seenJs.size} scripts the browser loaded`)

await browser.close()
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL TUTOR CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
