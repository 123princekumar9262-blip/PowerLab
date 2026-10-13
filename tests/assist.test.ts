import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamAnswer, TUTOR_ENDPOINT } from '../src/assist/gemini.ts'

/** A fake reply of the lab's own endpoint (server-sent events), delivered in awkward chunks. */
function sse(events: unknown[], status = 200) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  const bytes = new TextEncoder().encode(text)
  const cut = [...new Set([0, 7, 40, Math.floor(bytes.length / 2), bytes.length].filter((x) => x <= bytes.length))].sort((a, b) => a - b)
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 1; i < cut.length; i++) c.enqueue(bytes.slice(cut[i - 1], cut[i]))
      c.close()
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('Ask a doubt — the browser side', () => {
  it('asks the lab’s own endpoint (never Google, never with a key) and streams the answer', async () => {
    const fetchMock = vi.fn(async () => sse([{ t: 'In this ' }, { t: 'simulation Vout ' }, { t: '= 12.0 V.' }, { done: true }]))
    vi.stubGlobal('fetch', fetchMock)
    const pieces: string[] = []
    await streamAnswer({ context: 'Vout average: 12.0 V', messages: [{ role: 'user', content: 'Why?' }], onText: (t) => pieces.push(t) })
    expect(pieces.join('')).toBe('In this simulation Vout = 12.0 V.')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(TUTOR_ENDPOINT)
    expect(TUTOR_ENDPOINT).toBe('/api/tutor')
    const headers = init.headers as Record<string, string>
    expect(Object.keys(headers).map((h) => h.toLowerCase())).toEqual(['content-type'])
    const body = JSON.parse(String(init.body))
    // only the conversation and the simulation data: no key, no model, no instructions
    expect(Object.keys(body).sort()).toEqual(['context', 'messages'])
    expect(body.messages).toEqual([{ role: 'user', content: 'Why?' }])
  })
  it('shows the server’s message when a question is refused (rate limit, too long, not set up)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Too many questions in a short time. Wait a minute and ask again.' }), { status: 429 })))
    await expect(streamAnswer({ context: '', messages: [{ role: 'user', content: 'q' }], onText: () => {} })).rejects.toThrow(/Wait a minute/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>error</html>', { status: 503 })))
    await expect(streamAnswer({ context: '', messages: [{ role: 'user', content: 'q' }], onText: () => {} })).rejects.toThrow(/not available/)
  })
  it('an answer that stops early ends with the server’s message (what was written stays)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ t: 'Half an ' }, { error: 'The answer stopped early. Ask again.' }])))
    const pieces: string[] = []
    await expect(streamAnswer({ context: '', messages: [{ role: 'user', content: 'q' }], onText: (t) => pieces.push(t) })).rejects.toThrow(/stopped early/)
    expect(pieces.join('')).toBe('Half an ')
  })
})
