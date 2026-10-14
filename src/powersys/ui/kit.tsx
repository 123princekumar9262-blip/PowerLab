import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { fx } from './format.ts'
import { LEVELS } from './levels.ts'

/*
 * The small shared pieces every Power Systems module is built from: controls, readouts, equations with their
 * symbols and units, worked calculations, predictions and practice questions. Plain HTML/SVG, the app's tokens.
 */

// ── tutor context: a module tells the Ask panel what is on screen ─────────────────────────────────────────────

type ContextFn = () => string
export const TutorContext = createContext<{
  set(fn: ContextFn | null): void
} | null>(null)

/** Register what the tutor should know about the current screen (read at the moment a question is asked). */
export function useTutorContext(fn: ContextFn): void {
  const ctx = useContext(TutorContext)
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    ctx?.set(() => ref.current())
    return () => ctx?.set(null)
  }, [ctx])
}

export function useReducedMotion(): boolean {
  return useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
}

// ── controls ───────────────────────────────────────────────────────────────────────────────────────────────────

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  hint,
  decimals,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange(v: number): void
  hint?: ReactNode
  decimals?: number
}) {
  const id = useId()
  const d = decimals ?? Math.max(0, -Math.floor(Math.log10(step)))
  return (
    <div className="ps-slider">
      <label htmlFor={id} className="ps-slider-label">
        <span>{label}</span>
        <output htmlFor={id} className="ps-slider-value">
          {fx(value, d)}
          {unit ? ` ${unit}` : ''}
        </output>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="ps-hint">{hint}</p>}
    </div>
  )
}

export function Seg<T extends string>({ label, options, value, onChange, full }: { label: string; options: Array<{ id: NoInfer<T>; label: string }>; value: T; onChange(v: NoInfer<T>): void; full?: boolean }) {
  return (
    <div className={`seg ps-seg ${full ? 'seg--full' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="ps-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

// ── readouts ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReadoutItem {
  label: string
  value: string
  unit?: string
  tone?: 'good' | 'warn' | 'bad'
  /** A short line under the value. */
  note?: string
}

export function Readouts({ items, label }: { items: ReadoutItem[]; label?: string }) {
  return (
    <dl className="ps-readouts" aria-label={label}>
      {items.map((it) => (
        <div key={it.label} className={`ps-readout ${it.tone ? `ps-readout--${it.tone}` : ''}`}>
          <dt>{it.label}</dt>
          <dd>
            {it.value}
            {it.unit && <small> {it.unit}</small>}
          </dd>
          {it.note && <span className="ps-readout-note">{it.note}</span>}
        </div>
      ))}
    </dl>
  )
}

// ── explanation ────────────────────────────────────────────────────────────────────────────────────────────────

/** An equation with what its symbols mean and their units, and the assumptions it rests on. */
export function Eq({ expr, where, assume, title }: { expr: string; where?: Array<[string, string, string?]>; assume?: string; title?: string }) {
  return (
    <figure className="ps-eq">
      {title && <figcaption className="eyebrow">{title}</figcaption>}
      <p className="ps-eq-expr">{expr}</p>
      {where && (
        <dl className="ps-eq-where">
          {where.map(([sym, meaning, unit]) => (
            <div key={sym}>
              <dt>{sym}</dt>
              <dd>
                {meaning}
                {unit && <span className="ps-unit"> [{unit}]</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {assume && <p className="ps-eq-assume">Assumes: {assume}</p>}
    </figure>
  )
}

/** A worked calculation: each step's formula with the numbers substituted, and an optional independent check. */
export function Calc({ title, steps, check }: { title: string; steps: Array<{ label: string; expr: string; result: string }>; check?: { ok: boolean; text: string } }) {
  return (
    <section className="ps-calc" aria-label={title}>
      <h3 className="ps-calc-title">{title}</h3>
      <ol className="ps-calc-steps">
        {steps.map((s, k) => (
          <li key={k}>
            <span className="ps-calc-label">{s.label}</span>
            <span className="ps-calc-expr">{s.expr}</span>
            <span className="ps-calc-result">= {s.result}</span>
          </li>
        ))}
      </ol>
      {check && (
        <p className={`ps-check ${check.ok ? 'ps-check--ok' : 'ps-check--bad'}`}>
          {check.ok ? '✓ ' : '✗ '}
          {check.text}
        </p>
      )}
    </section>
  )
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'good' | 'bad'; title?: string; children: ReactNode }) {
  return (
    <div className={`ps-callout ps-callout--${tone}`} role={tone === 'bad' || tone === 'warn' ? 'status' : undefined}>
      {title && <p className="ps-callout-title">{title}</p>}
      <div>{children}</div>
    </div>
  )
}

/** The voltage-level colours, named. */
export function LevelLegend({ only }: { only?: string[] }) {
  return (
    <ul className="ps-legend" aria-label="Voltage levels">
      {LEVELS.filter((l) => !only || only.includes(l.id)).map((l) => (
        <li key={l.id}>
          <span className={`ps-swatch ps-lv--${l.id}`} aria-hidden="true" />
          {l.name} <span className="muted">{l.range}</span>
        </li>
      ))}
    </ul>
  )
}

// ── predict and practise ───────────────────────────────────────────────────────────────────────────────────────

export interface Choice {
  id: string
  label: string
}

/** Commit to a prediction first; then the answer and the reason are shown (and `onAnswered` runs). */
export function Predict({
  question,
  options,
  answer,
  why,
  onAnswered,
  children,
}: {
  question: string
  options: Choice[]
  answer: string
  why: ReactNode
  onAnswered?(correct: boolean): void
  children?: ReactNode
}) {
  const [pick, setPick] = useState<string | null>(null)
  const name = useId()
  const done = pick !== null
  return (
    <fieldset className="ps-predict">
      <legend className="ps-predict-q">{question}</legend>
      <div className="ps-options">
        {options.map((o) => {
          const state = !done ? '' : o.id === answer ? 'is-right' : o.id === pick ? 'is-wrong' : 'is-dim'
          return (
            <label key={o.id} className={`ps-option ${state}`}>
              <input
                type="radio"
                name={name}
                value={o.id}
                disabled={done}
                checked={pick === o.id}
                onChange={() => {
                  setPick(o.id)
                  onAnswered?.(o.id === answer)
                }}
              />
              <span>{o.label}</span>
            </label>
          )
        })}
      </div>
      {done && (
        <div className="ps-predict-result" aria-live="polite">
          <p className={pick === answer ? 'ps-right' : 'ps-wrong'}>{pick === answer ? 'Your prediction was right.' : 'Not quite — here is what happens.'}</p>
          <div className="ps-why">{why}</div>
          {children}
        </div>
      )}
    </fieldset>
  )
}

/**
 * What kind of practice a question is (shown as a label). "University-style" and "GATE-style" questions are written
 * for this app in the style of those examinations — never presented as official past papers.
 */
export type QuizLevel = 'concept' | 'numerical' | 'university' | 'gate'
export const QUIZ_LEVEL_LABEL: Record<QuizLevel, string> = { concept: 'Concept', numerical: 'Numerical', university: 'University-style', gate: 'GATE-style' }

/** Optional on every question: its kind, and the usual mistake explained when an answer is wrong. */
interface QuizExtras {
  level?: QuizLevel
  mistake?: string
}

export type QuizItem =
  | ({
      id: string
      q: string
      kind: 'choice'
      options: Choice[]
      answer: string
      why: string
    } & QuizExtras)
  | ({
      id: string
      q: string
      kind: 'number'
      answer: number
      unit: string
      tol: number
      why: string
    } & QuizExtras)

/** The result of checking a typed numeric answer. */
export type NumberCheck = { status: 'invalid'; message: string } | { status: 'right' | 'wrong'; value: number }

/**
 * Read and judge a typed numeric answer. A decimal comma and a typographic minus (−) are accepted; anything that is
 * not a finite number is reported as invalid (with the reason) instead of being judged right or wrong. A number is
 * right when it is within ±tol of the answer.
 */
export function checkNumberAnswer(text: string, answer: number, tol: number, unit: string): NumberCheck {
  const inUnit = unit ? ` in ${unit}` : ''
  if (text.trim() === '') return { status: 'invalid', message: `Enter a number${inUnit} first.` }
  const v = Number(text.replace(',', '.').replace('−', '-'))
  if (!Number.isFinite(v)) {
    const shown = text.trim().length > 24 ? `${text.trim().slice(0, 24)}…` : text.trim()
    return { status: 'invalid', message: `“${shown}” is not a number. Enter a value${inUnit}, for example 12.5.` }
  }
  return { status: Math.abs(v - answer) <= tol ? 'right' : 'wrong', value: v }
}

/** Practice questions: multiple choice or a number within a tolerance. Calls `onComplete` once all are right. */
export function Quiz({ items, onComplete }: { items: QuizItem[]; onComplete?(): void }) {
  const [right, setRight] = useState<Record<string, boolean>>({})
  const allRight = items.every((i) => right[i.id])
  const fired = useRef(false)
  useEffect(() => {
    if (allRight && !fired.current) {
      fired.current = true
      onComplete?.()
    }
  }, [allRight, onComplete])
  return (
    <div className="ps-quiz">
      <p className="small muted">
        {Object.values(right).filter(Boolean).length} of {items.length} answered correctly
      </p>
      <ol className="ps-quiz-list">
        {items.map((it) => (
          <li key={it.id}>
            <QuizQuestion item={it} onRight={() => setRight((r) => ({ ...r, [it.id]: true }))} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function QuizQuestion({ item, onRight }: { item: QuizItem; onRight(): void }) {
  const [pick, setPick] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<null | boolean>(null)
  const [invalid, setInvalid] = useState<string | null>(null)
  const name = useId()
  const hintId = useId()
  const check = (ok: boolean) => {
    setResult(ok)
    if (ok) onRight()
  }
  return (
    <div className="ps-q">
      <p className="ps-q-text">
        {item.level && <span className={`ps-q-level ps-q-level--${item.level}`}>{QUIZ_LEVEL_LABEL[item.level]}</span>}
        {item.q}
      </p>
      {item.kind === 'choice' ? (
        <div className="ps-options" role="radiogroup" aria-label={item.q}>
          {item.options.map((o) => (
            <label key={o.id} className={`ps-option ${result !== null && pick === o.id ? (result ? 'is-right' : 'is-wrong') : ''}`}>
              <input
                type="radio"
                name={name}
                checked={pick === o.id}
                disabled={result === true}
                onChange={() => {
                  setPick(o.id)
                  check(o.id === item.answer)
                }}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <form
          className="ps-num-answer"
          onSubmit={(e) => {
            e.preventDefault()
            const c = checkNumberAnswer(text, item.answer, item.tol, item.unit)
            if (c.status === 'invalid') {
              // not an answer: say why, and do not judge it (an earlier verdict no longer applies)
              setInvalid(c.message)
              setResult(null)
              return
            }
            setInvalid(null)
            check(c.status === 'right')
          }}
        >
          <input
            type="text"
            inputMode="decimal"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setInvalid(null)
            }}
            aria-label={`Your answer in ${item.unit}`}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? hintId : undefined}
            disabled={result === true}
          />
          <span className="ps-unit">{item.unit}</span>
          <button type="submit" className="text-btn" disabled={result === true}>
            Check
          </button>
        </form>
      )}
      {invalid && (
        <p id={hintId} className="ps-wrong ps-invalid" role="alert">
          {invalid}
        </p>
      )}
      {result !== null && (
        <p className={result ? 'ps-right' : 'ps-wrong'} aria-live="polite">
          {result ? '✓ Correct. ' : '✗ Not yet — try again. '}
          {result && <span className="ps-why">{item.why}</span>}
          {!result && item.kind === 'number' && (
            <span className="muted">
              {' '}
              (within ±{fx(item.tol, item.tol < 1 ? 3 : 1)} {item.unit})
            </span>
          )}
          {!result && item.mistake && <span className="ps-q-mistake">{item.mistake}</span>}
        </p>
      )}
    </div>
  )
}

/** A stepped explanation with Previous / Next, the step's own content, and `onFinish` at the last step. */
export function Stepper({ steps, index, onIndex, onFinish }: { steps: Array<{ title: string; body: ReactNode }>; index: number; onIndex(i: number): void; onFinish?(): void }) {
  const s = steps[index]
  const last = index === steps.length - 1
  useEffect(() => {
    if (last) onFinish?.()
  }, [last, onFinish])
  return (
    <section className="ps-stepper" aria-label="Steps">
      <p className="eyebrow">
        Step {index + 1} of {steps.length}
      </p>
      <h3 className="ps-step-title">{s.title}</h3>
      <div className="ps-step-body">{s.body}</div>
      <div className="ps-step-nav">
        <button type="button" className="text-btn" disabled={index === 0} onClick={() => onIndex(index - 1)}>
          ← Previous
        </button>
        <span className="ps-step-dots" aria-hidden="true">
          {steps.map((_, k) => (
            <span key={k} className={k === index ? 'on' : k < index ? 'past' : ''} />
          ))}
        </span>
        <button type="button" className="btn btn--primary ps-btn-sm" disabled={last} onClick={() => onIndex(index + 1)}>
          Next →
        </button>
      </div>
    </section>
  )
}
