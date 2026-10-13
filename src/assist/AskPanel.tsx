import { useEffect, useRef, useState, type ReactNode } from 'react'
import { streamAnswer, type ChatMessage } from './gemini.ts'
import './ask.css'

/** Conversations stay while the app is open, one per circuit (closing the panel keeps them). */
const HISTORY = new Map<string, ChatMessage[]>()

const STARTERS = ['Why does the output look like this?', 'What would happen if I doubled the load resistance?', 'Explain the current path at this instant.']

/**
 * "Ask a doubt": a live chat about the circuit on screen. Each question is sent with the workspace's simulated
 * state (`context()`, read at the moment of asking), and the answer is written out as it arrives.
 */
export function AskPanel({ id, context, starters = STARTERS, intro = 'Ask anything about this circuit. Your question is sent with what the simulation shows now (values, readings, the state at the cursor).' }: { id: string; context(): string; starters?: string[]; intro?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => HISTORY.get(id) ?? [])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    HISTORY.set(id, messages)
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [id, messages])
  useEffect(() => () => abort.current?.abort(), [])

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setError(null)
    setText('')
    const history: ChatMessage[] = [...messages, { role: 'user', content: question }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setBusy(true)
    const ctl = new AbortController()
    abort.current = ctl
    let answer = ''
    try {
      await streamAnswer({
        context: context(),
        messages: history,
        signal: ctl.signal,
        onText: (t) => {
          answer += t
          setMessages([...history, { role: 'assistant', content: answer }])
        },
      })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      if (!answer) setMessages(history)
    } finally {
      setBusy(false)
      abort.current = null
      if (!answer) setMessages((m) => m.filter((x) => x.content !== ''))
    }
  }

  return (
    <section className="ask" aria-label="Ask a doubt">
      <div className="ask-list" ref={list} aria-live="polite">
        {messages.length === 0 && (
          <div className="ask-empty">
            <p className="muted small">{intro}</p>
            <div className="ask-starters">
              {starters.map((s) => (
                <button key={s} className="chip-btn" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ask-msg ask-msg--${m.role}`}>
            {m.role === 'assistant' ? <Answer text={m.content} writing={busy && i === messages.length - 1} /> : <p>{m.content}</p>}
          </div>
        ))}
        {error && (
          <p className="ask-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <textarea
          value={text}
          rows={2}
          placeholder="Type your doubt… (Enter to send, Shift+Enter for a new line)"
          aria-label="Your question"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ask(text)
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={!text.trim()}>
            Ask
          </button>
        )}
      </form>
      <p className="ask-foot muted">Answers by Google Gemini, through the lab’s server, from this simulation’s data — check them against the lab.</p>
    </section>
  )
}

const BULLET = /^\s*[-•*]\s+/
const NUMBERED = /^\s*\d+[.)]\s+/

/**
 * An answer as it is written: paragraphs, bulleted ("- ", "* ", "• ") and numbered lists — also when a list follows a
 * sentence without a blank line — and **bold**, with a caret while it is still coming.
 */
function Answer({ text, writing }: { text: string; writing: boolean }) {
  if (!text) return <p className="ask-thinking">Thinking…</p>
  // runs of consecutive lines of the same kind: text, bullets or numbered items
  type Run = { kind: 'p' | 'ul' | 'ol'; lines: string[] }
  const runs: Run[] = []
  for (const block of text.split(/\n{2,}/)) {
    let prevBlock = true
    for (const line of block.split('\n')) {
      if (!line.trim()) continue
      const kind: Run['kind'] = BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : 'p'
      const last = runs[runs.length - 1]
      if (last && last.kind === kind && !(kind === 'p' && prevBlock)) last.lines.push(line.replace(kind === 'ul' ? BULLET : kind === 'ol' ? NUMBERED : /^/, ''))
      else runs.push({ kind, lines: [line.replace(kind === 'ul' ? BULLET : kind === 'ol' ? NUMBERED : /^/, '')] })
      prevBlock = false
    }
  }
  return (
    <div className="ask-answer">
      {runs.map((r, i) => {
        const caret = writing && i === runs.length - 1 ? <span className="ask-caret" aria-hidden="true" /> : null
        if (r.kind !== 'p') {
          const List = r.kind
          return (
            <List key={i}>
              {r.lines.map((l, k) => (
                <li key={k}>
                  {inline(l)}
                  {k === r.lines.length - 1 && caret}
                </li>
              ))}
            </List>
          )
        }
        return (
          <p key={i}>
            {r.lines.map((l, k) => (
              <span key={k}>
                {k > 0 && <br />}
                {inline(l)}
              </span>
            ))}
            {caret}
          </p>
        )
      })}
    </div>
  )
}

function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part,
  )
}
