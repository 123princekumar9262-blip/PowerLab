import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * Text that appears word by word, as if someone were writing it. The whole text is in the page from the
 * start (screen readers, copy, search, the browser checks read it at once); only its appearance is staged with
 * a CSS animation per word. A `TypedRun` gives several pieces one continuous pace (the WHY answer reads as one
 * explanation). Reduced motion, or a click on the run ("show it all"), shows everything at once.
 */
const STEP_MS = 34
const MAX_MS = 3200

interface Run {
  /** Word offset of each piece in the run. */
  offsets: Map<string, number>
  step: number
}
const RunCtx = createContext<Run | null>(null)

/** One run of typed pieces: `pieces` = [id, text] in reading order. */
export function TypedRun({ pieces, children, done, onDone }: { pieces: Array<[string, string]>; children: ReactNode; done?: boolean; onDone?(): void }) {
  const run = useMemo(() => {
    const offsets = new Map<string, number>()
    let n = 0
    for (const [id, text] of pieces) {
      offsets.set(id, n)
      n += words(text).length
    }
    return { offsets, step: Math.min(STEP_MS, MAX_MS / Math.max(1, n)) }
  }, [pieces.map(([id, t]) => `${id}:${t.length}`).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <RunCtx.Provider value={run}>
      <div className={`typed-run ${done ? 'typed-run--done' : ''}`} onClick={onDone} title={done ? undefined : 'Click to show it all'}>
        {children}
      </div>
    </RunCtx.Provider>
  )
}

const words = (t: string) => t.split(/(\s+)/).filter((w) => w.length > 0)

/** A piece of a run (or alone: its own pace). */
export function Typed({ id, text }: { id?: string; text: string }) {
  const run = useContext(RunCtx)
  const parts = words(text)
  const start = run && id ? (run.offsets.get(id) ?? 0) : 0
  const step = run ? run.step : Math.min(STEP_MS, MAX_MS / Math.max(1, parts.length))
  let k = start
  return (
    <>
      {parts.map((w, i) =>
        /^\s+$/.test(w) ? (
          w
        ) : (
          <span key={i} className="typed-w" style={{ animationDelay: `${Math.round(k++ * step)}ms` }}>
            {w}
          </span>
        ),
      )}
    </>
  )
}
