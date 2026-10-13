/**
 * "Ask a doubt": live questions about the circuit on screen, answered by Google Gemini through the lab's own
 * server endpoint (api/tutor.ts). The browser never holds a Gemini key and never calls Google directly: it sends
 * the conversation and the simulated state of the workspace to /api/tutor, which adds the tutor's instructions,
 * calls a fixed model and streams the answer back.
 */
export const TUTOR_ENDPOINT = '/api/tutor'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// A Gemini key saved in this browser by an earlier version is no longer used: remove it from storage.
try {
  localStorage.removeItem('pel.assist')
} catch {
  /* storage blocked: nothing stored either */
}

/** Fixed texts for refusals the server sends without a JSON message (e.g. a platform error page). */
function messageFor(status: number): string {
  if (status === 429) return 'Too many questions in a short time. Wait a minute and ask again.'
  if (status === 413) return 'The question is too long.'
  if (status === 404) return 'The tutor is not available here (no server endpoint).'
  if (status === 503) return 'The tutor is not available right now.'
  return `The tutor could not answer (HTTP ${status}).`
}

/** Stream an answer: `onText` receives each piece as it arrives (the panel writes it out as it comes). */
export async function streamAnswer(opts: { context: string; messages: ChatMessage[]; onText(t: string): void; signal?: AbortSignal }): Promise<void> {
  const res = await fetch(TUTOR_ENDPOINT, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: opts.context, messages: opts.messages }),
  })
  if (!res.ok || !res.body) {
    let msg = messageFor(res.status)
    try {
      const j = (await res.json()) as { error?: unknown }
      if (typeof j.error === 'string' && j.error) msg = j.error
    } catch {
      /* not JSON */
    }
    throw new Error(msg)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
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
        const d = JSON.parse(line.slice(5).trim()) as { t?: string; error?: string; done?: boolean }
        if (d.error) throw new Error(d.error)
        if (d.t) opts.onText(d.t)
      }
    }
  }
}
