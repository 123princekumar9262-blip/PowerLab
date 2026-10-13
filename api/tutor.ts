/**
 * POST /api/tutor — "Ask a doubt", answered by Google Gemini ON THE SERVER.
 *
 * The Gemini key lives only in the server environment variable GEMINI_API_KEY and is read here, at request time;
 * it never reaches the browser (not in the bundle, not in a response, not in a log). The browser sends the
 * student's conversation and the simulation data of the circuit on screen; the server builds the tutor's
 * instructions itself, calls one fixed model with fixed limits, and streams the answer back.
 *
 * It is a public endpoint, so it is also guarded: request size and shape are validated, other websites are refused,
 * and requests are rate-limited — per client and per day in total — through a shared Redis store when one is
 * configured (Upstash, via the Vercel Marketplace). Without that store the limit holds only within one warm server
 * instance, which is NOT a global limit; the response says which mode is active (x-tutor-ratelimit).
 *
 * Runs as a Vercel Function (Node.js runtime, Web Request/Response). One self-contained file: Vercel compiles
 * each file under api/ on its own. The Vite dev and preview servers mount the same handler (vite.config.ts).
 */

// ── fixed, server-controlled configuration ────────────────────────────────────────────────────────────────
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/'
export const TUTOR_MODEL = 'gemini-flash-latest'
/** One retry goes here when the main model is busy (503) or out of quota (429), before anything was streamed. */
export const TUTOR_FALLBACK_MODEL = 'gemini-flash-lite-latest'
/**
 * Output limits. The budget is in tokens, and Hindi (Devanagari) text needs several times more tokens per word than
 * English, so it is generous; the instructions still ask for short answers.
 */
export const GENERATION = { maxOutputTokens: 2048, temperature: 0.4 } as const
/**
 * The main model "thinks" before it writes by default; that thinking counts against the output budget and the
 * timeout (measured: ~650 thinking tokens and ~10 s before the first word). A tutor's short explanation does not
 * need it, so it is switched off. The fallback (lite) model does not think and rejects this setting.
 */
export const MAIN_THINKING = { thinkingConfig: { thinkingBudget: 0 } } as const

export const LIMITS = {
  bodyBytes: 32_000,
  contextChars: 6_000,
  messages: 16,
  userChars: 2_000,
  assistantChars: 4_000,
  totalChars: 16_000,
  /** The whole upstream exchange (connect + stream) [ms] — within a serverless function's default 60 s. */
  timeoutMs: 45_000,
  /**
   * How long the main model may take to START answering [ms] (it normally starts within ~4 s). If it has not, it is
   * abandoned and the fallback model is asked instead, within what is left of the overall time.
   */
  firstByteMs: 15_000,
} as const

export const RATE = {
  perMinute: 8,
  perDay: 60,
  /** All clients together, per UTC day (a cost cap); TUTOR_DAILY_LIMIT can lower or raise it. */
  globalPerDay: 800,
} as const

// ── the tutor's instructions (built on the server: the browser cannot replace them) ──────────────────────────
export function tutorSystem(context: string): string {
  return [
    'You are the tutor inside the Power Electronics Lab, an interactive learning platform used by an electrical-engineering student. It covers power electronics, electrical machines and drives, and power systems.',
    'Answer the student’s question about what they have open (a circuit, a machine or a power-system module). The SIMULATION DATA below is the ground truth for it: quote its numbers (“in this simulation …”) instead of inventing values.',
    'If the data does not contain what the question needs, say so briefly, then explain from standard electrical-engineering theory and state the assumptions (ideal devices, balanced three-phase, steady state, …).',
    'Reply in the language the student writes in or asks for: if they ask for Hindi (e.g. “hindi me batao”), answer in Hindi in Devanagari; if they write Hinglish, you may answer in simple Hinglish. Keep symbols, units, numbers and standard technical terms (e.g. transformer, per unit) as they are, adding the English term in brackets where it helps.',
    'Write for a beginner unless the question is advanced: short paragraphs, units always, the lab’s own symbols (they are listed in the data). Prefer under 180 words; use a short list or one equation when it helps. Never claim the simulation shows something it does not.',
    'If the question is unrelated to electrical engineering or this lab, answer in one sentence and steer back.',
    'Write equations in plain text with Unicode symbols (Vdc = Vm/π ≈ 0.45·Vrms, ΔiL, α, √2) — never LaTeX, never $ signs. Use **bold** sparingly; no headings.',
    '',
    'SIMULATION DATA (from the workspace at the moment of the question):',
    context,
  ].join('\n')
}

// ── request validation ───────────────────────────────────────────────────────────────────────────────────────
export interface TutorMessage {
  role: 'user' | 'assistant'
  content: string
}
export interface TutorRequest {
  context: string
  messages: TutorMessage[]
}

/** The request body, or the reason it is refused (never echoing the input back). */
export function validate(body: unknown): { ok: true; value: TutorRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'The request must be a JSON object.' }
  const b = body as Record<string, unknown>
  const extra = Object.keys(b).filter((k) => k !== 'context' && k !== 'messages')
  if (extra.length) return { ok: false, error: 'The request has fields the tutor does not accept.' }
  if (typeof b.context !== 'string') return { ok: false, error: 'The simulation context is missing.' }
  if (b.context.length > LIMITS.contextChars) return { ok: false, error: 'The simulation context is too long.' }
  if (!Array.isArray(b.messages) || b.messages.length === 0) return { ok: false, error: 'There is no question.' }
  if (b.messages.length > LIMITS.messages) return { ok: false, error: 'The conversation is too long — start a new one.' }
  let total = 0
  const messages: TutorMessage[] = []
  for (const m of b.messages as unknown[]) {
    if (!m || typeof m !== 'object') return { ok: false, error: 'A message is not valid.' }
    const { role, content, ...rest } = m as Record<string, unknown>
    if (Object.keys(rest).length) return { ok: false, error: 'A message has fields the tutor does not accept.' }
    if (role !== 'user' && role !== 'assistant') return { ok: false, error: 'A message has an unknown role.' }
    if (typeof content !== 'string' || !content.trim()) return { ok: false, error: 'A message is empty.' }
    if (content.length > (role === 'user' ? LIMITS.userChars : LIMITS.assistantChars)) return { ok: false, error: 'A message is too long.' }
    total += content.length
    messages.push({ role, content })
  }
  if (total > LIMITS.totalChars) return { ok: false, error: 'The conversation is too long — start a new one.' }
  if (messages[messages.length - 1].role !== 'user') return { ok: false, error: 'The last message must be the question.' }
  return { ok: true, value: { context: b.context, messages } }
}

// ── rate limiting ────────────────────────────────────────────────────────────────────────────────────────────
export interface Limiter {
  /** 'shared': one count for all server instances (Redis); 'instance': this warm instance only. */
  mode: 'shared' | 'instance'
  /** Count one request against `key` in a fixed window; ok = still within `limit`. Throws if the store fails. */
  hit(key: string, limit: number, windowSec: number, now: number): Promise<{ ok: boolean; retryAfter: number }>
}

/** Shared fixed-window counter in Upstash Redis (REST API: no client library needed). */
export function redisLimiter(url: string, token: string, fetchImpl: typeof fetch = fetch): Limiter {
  return {
    mode: 'shared',
    async hit(key, limit, windowSec, now) {
      const bucket = Math.floor(now / 1000 / windowSec)
      const k = `tutor:${key}:${windowSec}:${bucket}`
      const res = await fetchImpl(`${url.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify([
          ['INCR', k],
          ['EXPIRE', k, String(windowSec + 5)],
        ]),
      })
      if (!res.ok) throw new Error(`rate-limit store HTTP ${res.status}`)
      const out = (await res.json()) as Array<{ result?: unknown; error?: string }>
      const count = Number(out?.[0]?.result)
      if (!Number.isFinite(count)) throw new Error('rate-limit store: bad reply')
      const retryAfter = Math.max(1, Math.ceil((bucket + 1) * windowSec - now / 1000))
      return { ok: count <= limit, retryAfter }
    },
  }
}

/** Counts in this server instance's memory only — a best-effort brake, NOT a global limit on a serverless host. */
export function instanceLimiter(): Limiter {
  const counts = new Map<string, { n: number; until: number }>()
  return {
    mode: 'instance',
    async hit(key, limit, windowSec, now) {
      const bucket = Math.floor(now / 1000 / windowSec)
      const k = `${key}:${windowSec}:${bucket}`
      const until = (bucket + 1) * windowSec * 1000
      const c = counts.get(k) ?? { n: 0, until }
      c.n++
      counts.set(k, c)
      if (counts.size > 5000) for (const [kk, v] of counts) if (v.until <= now) counts.delete(kk)
      return { ok: c.n <= limit, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) }
    },
  }
}

/** The limiter for this environment: shared Redis when configured (Upstash or Vercel KV variable names). */
export function limiterFor(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): Limiter {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN
  return url && token ? redisLimiter(url, token, fetchImpl) : (fallbackLimiter ??= instanceLimiter())
}
let fallbackLimiter: Limiter | undefined

// ── the handler ──────────────────────────────────────────────────────────────────────────────────────────────
export interface Deps {
  env: Record<string, string | undefined>
  fetch: typeof fetch
  limiter: Limiter
  now(): number
  timeoutMs?: number
  firstByteMs?: number
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const fail = (status: number, error: string, extra: Record<string, string> = {}) => new Response(JSON.stringify({ error }), { status, headers: { ...JSON_HEADERS, ...extra } })

/** The client address as the platform reports it (Vercel sets x-forwarded-for / x-real-ip itself). */
function clientOf(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim()
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (real || fwd || 'unknown').slice(0, 64)
}

/** A browser request from another website is refused (a script elsewhere cannot use this tutor). */
function originAllowed(req: Request, env: Record<string, string | undefined>): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // not a cross-site browser request (same-origin GETs, tools); still rate-limited
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  const own = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
  const extra = (env.TUTOR_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s).host
      } catch {
        return s
      }
    })
  return host === own || extra.includes(host)
}

/** Reads the body, refusing more than `max` bytes (whatever Content-Length claims). */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > max) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.byteLength
  }
  return new TextDecoder().decode(all)
}

class UpstreamError extends Error {
  constructor(
    public status: number,
    public retryable: boolean,
  ) {
    super(`upstream ${status}`)
  }
}

/** What the student is told for an upstream status (fixed texts: nothing from Google is passed through). */
function publicError(status: number): { status: number; error: string } {
  if (status === 429) return { status: 429, error: 'The tutor has reached its question limit for now. Wait a minute and ask again.' }
  if (status === 503 || status === 500) return { status: 503, error: 'The tutor is busy right now. Ask again in a moment.' }
  if (status === 400 || status === 401 || status === 403 || status === 404) return { status: 503, error: 'The tutor is not available right now.' }
  return { status: 502, error: 'The tutor could not answer. Ask again in a moment.' }
}

async function callGemini(model: string, key: string, req: TutorRequest, deps: Deps, signal: AbortSignal, extra: object = {}): Promise<Response> {
  const res = await deps.fetch(`${GEMINI_BASE}${model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: tutorSystem(req.context) }] },
      contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { ...GENERATION, ...extra },
    }),
  })
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {})
    throw new UpstreamError(res.status, res.status === 429 || res.status === 503)
  }
  return res
}

/** The main model did not start answering in time (it is abandoned; the fallback is asked). */
const SLOW = 408

/**
 * Call a model, abandoning only this call if it has not started answering (response headers) within `ms`. Once it
 * has started, only the outer signal (overall timeout, or the student's Stop) can end it.
 */
async function callWithin(model: string, key: string, req: TutorRequest, deps: Deps, outer: AbortSignal, ms: number, extra: object = {}): Promise<Response> {
  const own = new AbortController()
  if (outer.aborted) own.abort()
  else outer.addEventListener('abort', () => own.abort(), { once: true })
  const slow = setTimeout(() => own.abort(), ms)
  try {
    return await callGemini(model, key, req, deps, own.signal, extra)
  } catch (e) {
    if (own.signal.aborted && !outer.aborted) throw new UpstreamError(SLOW, true)
    throw e
  } finally {
    clearTimeout(slow)
  }
}

export async function handleTutor(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return fail(405, 'Use POST.', { allow: 'POST' })
  if (!originAllowed(req, deps.env)) return fail(403, 'This tutor only answers the Power Electronics Lab.')
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return fail(415, 'Send the question as JSON.')

  const key = deps.env.GEMINI_API_KEY?.trim()
  if (!key) return fail(503, 'The tutor is not set up on this server yet.')

  const raw = await readCapped(req, LIMITS.bodyBytes)
  if (raw === null) return fail(413, 'The question is too long.')
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return fail(400, 'The request is not valid JSON.')
  }
  const v = validate(body)
  if (!v.ok) return fail(400, v.error)

  // rate limits: per client per minute and per day, and all clients together per day
  const now = deps.now()
  const client = clientOf(req)
  const daily = Math.max(1, Number(deps.env.TUTOR_DAILY_LIMIT) || RATE.globalPerDay)
  const mode = { 'x-tutor-ratelimit': deps.limiter.mode }
  try {
    for (const [k, limit, win] of [
      [`ip:${client}`, RATE.perMinute, 60],
      [`ip:${client}`, RATE.perDay, 86_400],
      ['all', daily, 86_400],
    ] as const) {
      const r = await deps.limiter.hit(k, limit, win, now)
      if (!r.ok) return fail(429, win === 60 ? 'Too many questions in a short time. Wait a minute and ask again.' : 'The tutor has reached today’s question limit. Try again tomorrow.', { 'retry-after': String(r.retryAfter), ...mode })
    }
  } catch {
    // the shared store is down: refuse rather than run without a limit
    console.error('tutor: rate-limit store unavailable')
    return fail(503, 'The tutor is not available right now.', mode)
  }

  // upstream, with an overall timeout; the student pressing Stop cancels it too
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), deps.timeoutMs ?? LIMITS.timeoutMs)
  req.signal?.addEventListener('abort', () => ctl.abort(), { once: true })
  const firstByte = deps.firstByteMs ?? LIMITS.firstByteMs
  let upstream: Response
  try {
    try {
      try {
        upstream = await callWithin(TUTOR_MODEL, key, v.value, deps, ctl.signal, firstByte, MAIN_THINKING)
      } catch (e) {
        // the "latest" alias may move to a model that rejects the thinking setting: ask it once without
        if (!(e instanceof UpstreamError && e.status === 400)) throw e
        upstream = await callWithin(TUTOR_MODEL, key, v.value, deps, ctl.signal, firstByte)
      }
    } catch (e) {
      // busy (429/503), too slow to start, or unreachable: one try on the fallback model, in the time that is left
      const retry = e instanceof UpstreamError ? e.retryable : !ctl.signal.aborted
      if (!retry) throw e
      if (e instanceof UpstreamError && e.status === SLOW) console.error('tutor: main model slow to start; asking the fallback')
      upstream = await callGemini(TUTOR_FALLBACK_MODEL, key, v.value, deps, ctl.signal)
    }
  } catch (e) {
    clearTimeout(timer)
    if (ctl.signal.aborted) return fail(504, 'The tutor took too long to answer. Ask again.', mode)
    const st = e instanceof UpstreamError ? e.status : 0
    console.error(`tutor: upstream failed (${st || 'network'})`)
    const p = publicError(st)
    return fail(p.status, p.error, mode)
  }

  // re-stream: Gemini's server-sent events → { t } pieces for the browser; a fixed message if it stops early
  const enc = new TextEncoder()
  const send = (c: ReadableStreamDefaultController<Uint8Array>, obj: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const reader = upstream.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i: number
          while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
            const event = buf.slice(0, i)
            buf = buf.slice(i).replace(/^\r?\n\r?\n/, '')
            for (const line of event.split(/\r?\n/)) {
              if (!line.startsWith('data:')) continue
              let d: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: unknown }
              try {
                d = JSON.parse(line.slice(5).trim())
              } catch {
                continue
              }
              if (d.error) throw new Error('upstream stream error')
              const t = (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
              if (t) send(c, { t })
            }
          }
        }
        send(c, { done: true })
      } catch {
        send(c, { error: ctl.signal.aborted ? 'The tutor took too long to answer. Ask again.' : 'The answer stopped early. Ask again.' })
        await reader.cancel().catch(() => {})
      } finally {
        clearTimeout(timer)
        c.close()
      }
    },
    cancel() {
      clearTimeout(timer)
      ctl.abort()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff', ...mode } })
}

/** Vercel Function entry (Node.js runtime, Web handler). */
export function POST(request: Request): Promise<Response> {
  return handleTutor(request, { env: process.env, fetch, limiter: limiterFor(process.env), now: Date.now })
}
