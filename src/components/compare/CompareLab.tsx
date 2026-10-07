import { useMemo, useState } from 'react'
import { RECTIFIERS, LOADS } from '../../circuits/registry.ts'
import { advise, APPLICATIONS, BASES, DEFAULT_SETUP, runComparison, whyTheyDiffer, type Application, type CompareResult, type CompareSetup, type Metric, type SideMetrics } from '../../compare/compare.ts'
import { formatA, formatSI, formatV, formatW } from '../../utils/format.ts'

type Tab = 'output' | 'current' | 'power' | 'stress' | 'rect'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'output', label: 'Output' },
  { id: 'current', label: 'Current' },
  { id: 'power', label: 'Power' },
  { id: 'stress', label: 'Stress' },
  { id: 'rect', label: 'Rectification' },
]

type Row = { key: keyof SideMetrics; label: string; fmt: (v: number) => string; lowerIsBetter?: boolean }
const pct = (v: number) => `${(v * 100).toFixed(1)} %`
const deg = (v: number) => `${v.toFixed(1)}°`
const num = (d: number) => (v: number) => v.toFixed(d)
const ROWS: Record<Tab, Row[]> = {
  output: [
    { key: 'vdc', label: 'Average DC output Vdc', fmt: (v) => formatV(v) },
    { key: 'vrms', label: 'RMS output', fmt: (v) => formatV(v) },
    { key: 'vpk', label: 'Peak output', fmt: (v) => formatV(v) },
    { key: 'vmin', label: 'Minimum output', fmt: (v) => formatV(v) },
    { key: 'ripplePP', label: 'Ripple (peak-to-peak)', fmt: (v) => formatV(v, false), lowerIsBetter: true },
    { key: 'rippleFactor', label: 'Ripple factor', fmt: num(3), lowerIsBetter: true },
    { key: 'rippleFrequency', label: 'Ripple frequency', fmt: (v) => `${v.toFixed(0)} Hz` },
  ],
  current: [
    { key: 'idc', label: 'Average load current', fmt: (v) => formatA(v) },
    { key: 'irms', label: 'RMS load current', fmt: (v) => formatA(v) },
    { key: 'ipk', label: 'Peak load current', fmt: (v) => formatA(v) },
    { key: 'iripple', label: 'Current ripple (p-p)', fmt: (v) => formatA(v), lowerIsBetter: true },
  ],
  power: [
    { key: 'pdc', label: 'DC output power Vdc·Idc', fmt: (v) => formatW(v) },
    { key: 'pload', label: 'Load power (avg R·i²)', fmt: (v) => formatW(v) },
    { key: 'pin', label: 'AC / input power', fmt: (v) => formatW(v) },
    { key: 'efficiency', label: 'Efficiency', fmt: pct },
    { key: 'rectRatio', label: 'Rectification ratio Pdc / Pin', fmt: pct },
    { key: 'tufSim', label: 'TUF — simulated (secondary)', fmt: num(3) },
    { key: 'tufTheory', label: 'TUF — theoretical (textbook)', fmt: num(3) },
  ],
  stress: [
    { key: 'devPeakI', label: 'Peak device current', fmt: (v) => formatA(v), lowerIsBetter: true },
    { key: 'devAvgI', label: 'Average device current', fmt: (v) => formatA(v), lowerIsBetter: true },
    { key: 'devRmsI', label: 'RMS device current', fmt: (v) => formatA(v), lowerIsBetter: true },
    { key: 'piv', label: 'Peak inverse voltage', fmt: (v) => formatV(v, false), lowerIsBetter: true },
    { key: 'devPeakV', label: 'Peak device voltage', fmt: (v) => formatV(v, false), lowerIsBetter: true },
    { key: 'conduction', label: 'Conduction per device', fmt: deg },
  ],
  rect: [
    { key: 'pulses', label: 'Pulses per cycle', fmt: num(0) },
    { key: 'rippleFrequency', label: 'Ripple frequency', fmt: (v) => `${v.toFixed(0)} Hz` },
    { key: 'conduction', label: 'Conduction interval', fmt: deg },
    { key: 'alpha', label: 'Firing angle α', fmt: deg },
    { key: 'overlap', label: 'Commutation overlap μ', fmt: deg },
  ],
}

const sameSetup = (x: CompareSetup, y: CompareSetup) => JSON.stringify(x) === JSON.stringify(y)

/** COMPARE — two rectifiers, one declared basis, every number from the two simulations. */
export function CompareLab() {
  const [setup, setSetup] = useState<CompareSetup>(DEFAULT_SETUP)
  const [ran, setRan] = useState<{ setup: CompareSetup; res: CompareResult } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('output')
  const [wavesOpen, setWavesOpen] = useState(false)
  const [app, setApp] = useState<Application | null>(null)
  const set = (patch: Partial<CompareSetup>) => setSetup((s) => ({ ...s, ...patch }))
  const ca = RECTIFIERS.find((r) => r.key === setup.a)!
  const cb = RECTIFIERS.find((r) => r.key === setup.b)!
  const controlled = ca.device === 'scr' || cb.device === 'scr'
  const hasL = setup.load === 'RL' || setup.load === 'RLC'
  const hasC = setup.load === 'RC' || setup.load === 'RLC'
  const run = () => {
    setBusy(true)
    setError(null)
    // Let the button repaint before the two simulations run.
    setTimeout(() => {
      try {
        setRan({ setup, res: runComparison(setup) })
      } catch (e) {
        setError(String(e))
      }
      setBusy(false)
    }, 20)
  }
  const res = ran?.res ?? null
  const stale = !!ran && !sameSetup(ran.setup, setup)
  const why = useMemo(() => (res ? whyTheyDiffer(res) : []), [res])
  const advice = res && app ? advise(res, app) : null

  const pick = (side: 'a' | 'b') => {
    const c = side === 'a' ? ca : cb
    return (
      <div className="cmp-pick">
        <span className="eyebrow">Rectifier {side.toUpperCase()}</span>
        <select aria-label={`Rectifier ${side.toUpperCase()} family`} value={c.phases} onChange={(e) => set({ [side]: RECTIFIERS.find((r) => r.phases === Number(e.target.value))!.key } as Partial<CompareSetup>)}>
          <option value={1}>Single-phase</option>
          <option value={3}>Three-phase</option>
        </select>
        <select aria-label={`Rectifier ${side.toUpperCase()}`} value={c.key} onChange={(e) => set({ [side]: e.target.value } as Partial<CompareSetup>)}>
          {RECTIFIERS.filter((r) => r.phases === c.phases).map((r) => (
            <option key={r.key} value={r.key}>
              {r.short}
              {r.group === 'Controlled' && !/controlled/i.test(r.short) ? ' (SCR)' : ''}
            </option>
          ))}
        </select>
      </div>
    )
  }
  const field = (label: string, value: number, onChange: (v: number) => void, unit: string, step = 'any') => (
    <label className="cmp-field">
      <span>{label}</span>
      <span className="num-input">
        <input type="number" step={step} value={Number(value.toPrecision(6))} onChange={(e) => Number.isFinite(Number(e.target.value)) && e.target.value !== '' && onChange(Number(e.target.value))} aria-label={label} />
        <span className="unit">{unit}</span>
      </span>
    </label>
  )

  return (
    <main className="compare-lab">
      <section className="cmp-setup" aria-labelledby="cmp-setup-title">
        <h2 id="cmp-setup-title" className="eyebrow">Compare rectifiers</h2>
        <div className="cmp-choose">
          {pick('a')}
          <span className="cmp-vs" aria-hidden="true">vs</span>
          {pick('b')}
        </div>
        <div className="cmp-basis">
          <label className="cmp-field cmp-field--wide">
            <span>Comparison basis</span>
            <select aria-label="Comparison basis" value={setup.basis} onChange={(e) => set({ basis: e.target.value as CompareSetup['basis'] })}>
              {BASES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          {field(setup.basis === 'vll' ? 'VLL (RMS)' : setup.basis === 'vph' ? 'V per phase / winding (RMS)' : 'V for rectifier A (RMS)', setup.v, (v) => set({ v: Math.max(0.1, Math.min(400, v)) }), 'V')}
        </div>
        <p className="muted small">{BASES.find((b) => b.id === setup.basis)!.explain}</p>
        <div className="cmp-conditions">
          <div className="seg" role="radiogroup" aria-label="Load">
            {LOADS.map((l) => (
              <button key={l.id} role="radio" aria-checked={setup.load === l.id} className={setup.load === l.id ? 'on' : ''} onClick={() => set({ load: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
          {field('R', setup.resistance, (v) => set({ resistance: Math.max(1e-3, v) }), 'Ω')}
          {hasL && field('L', setup.inductance * 1e3, (v) => set({ inductance: Math.max(1e-6, v / 1e3) }), 'mH')}
          {hasC && field('C', setup.capacitance * 1e6, (v) => set({ capacitance: Math.max(1e-9, v / 1e6) }), 'µF')}
          {field('f', setup.frequency, (v) => set({ frequency: Math.max(1, Math.min(1000, v)) }), 'Hz')}
          <div className="seg" role="radiogroup" aria-label="Devices">
            {(['real', 'ideal'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={setup.diode === m} className={setup.diode === m ? 'on' : ''} onClick={() => set({ diode: m })}>
                {m === 'ideal' ? 'Ideal devices' : `Vf = ${setup.vf} V`}
              </button>
            ))}
          </div>
          {controlled && field('α', setup.alphaDeg, (v) => set({ alphaDeg: Math.max(0, Math.min(180, v)) }), '°', '1')}
          <label className="check">
            <input type="checkbox" checked={setup.freewheel} onChange={() => set({ freewheel: !setup.freewheel })} /> Freewheeling diode (where supported)
          </label>
          <button className="primary-btn" onClick={run} disabled={busy}>
            {busy ? 'Simulating both…' : 'Run comparison'}
          </button>
        </div>
        {error && <p className="flag">{error}</p>}
      </section>

      {!res ? (
        <section className="cmp-empty">
          <p className="intro-lead">Choose two rectifiers and a basis, then run the comparison.</p>
          <p className="muted">Both circuits are simulated with the same load, frequency and devices; every number below comes from those two simulations.</p>
        </section>
      ) : (
        <>
          {stale && <p className="flag flag--info">The conditions above have changed — the results below are for the previous run. Press Run comparison to update.</p>}
          <section className="cmp-basis-note">
            <p>
              <b>Basis:</b> {res.basisNote}
            </p>
            <p className="muted small">
              A: {res.a.sourceNote} · B: {res.b.sourceNote}. Held constant: {res.heldConstant.join('; ')}.
            </p>
          </section>

          <section className="cmp-cards">
            {(['a', 'b'] as const).map((k) => {
              const s = res[k]
              const m = s.metrics
              return (
                <article key={k} className={`cmp-card cmp-card--${k}`}>
                  <h3>
                    <span className="cmp-badge">{k.toUpperCase()}</span> {s.choice.label}
                  </h3>
                  <dl>
                    <div><dt>Vdc</dt><dd>{show(m.vdc, (v) => formatV(v))}</dd></div>
                    <div><dt>Ripple p-p</dt><dd>{show(m.ripplePP, (v) => formatV(v, false))}</dd></div>
                    <div><dt>f ripple</dt><dd>{show(m.rippleFrequency, (v) => `${v.toFixed(0)} Hz`)}</dd></div>
                    <div><dt>Idc</dt><dd>{show(m.idc, (v) => formatA(v))}</dd></div>
                    <div><dt>Irms</dt><dd>{show(m.irms, (v) => formatA(v))}</dd></div>
                    <div><dt>Efficiency</dt><dd>{show(m.efficiency, pct)}</dd></div>
                    <div><dt>TUF</dt><dd>{show(m.tufSim, num(3))} <span className="tag tag--sim">sim</span>{m.tufTheory.value !== null && <> / {num(3)(m.tufTheory.value)} <span className="tag tag--theory">theory</span></>}</dd></div>
                  </dl>
                </article>
              )
            })}
          </section>

          <section className="cmp-metrics">
            <div className="seg" role="tablist" aria-label="Metric group">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <table className="ba-table cmp-table">
              <thead>
                <tr>
                  <th>Quantity</th>
                  <th className="num">A · {res.a.choice.short}</th>
                  <th className="num">B · {res.b.choice.short}</th>
                  <th className="cmp-bars-h">A vs B</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {ROWS[tab].map((r) => {
                  const ma = res.a.metrics[r.key]
                  const mb = res.b.metrics[r.key]
                  return (
                    <tr key={r.key}>
                      <th title={ma.note ?? mb.note}>{r.label}</th>
                      <td className="num">{show(ma, r.fmt)}</td>
                      <td className="num">{show(mb, r.fmt)}</td>
                      <td>
                        <Bars a={ma.value} b={mb.value} />
                      </td>
                      <td>
                        <span className={`tag tag--${ma.source}`} title={ma.note ?? mb.note}>
                          {ma.source === 'sim' ? 'Simulated' : 'Theoretical'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {tab === 'power' && (
              <p className="muted small">
                Simulated TUF = Pdc / Σ(Vrms·Irms) over the source windings, from the simulated winding currents (secondary side; the lab has no primary-winding model). The
                theoretical TUF is the textbook value for ideal diodes with an R load — labelled “Theoretical”, never presented as measured.
              </p>
            )}
          </section>

          <section className="cmp-why">
            <h3 className="eyebrow">Why do they differ?</h3>
            <ul className="change-list">
              {why.map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ul>
          </section>

          <section className="cmp-waves">
            <button className="text-btn" aria-expanded={wavesOpen} onClick={() => setWavesOpen((o) => !o)}>
              {wavesOpen ? 'Hide waveforms' : 'Compare waveforms'}
            </button>
            {wavesOpen && <CompareWaves res={res} />}
          </section>

          <section className="cmp-advice">
            <h3 className="eyebrow">Which should I choose?</h3>
            <div className="seg" role="radiogroup" aria-label="Application">
              {APPLICATIONS.map((x) => (
                <button key={x.id} role="radio" aria-checked={app === x.id} className={app === x.id ? 'on' : ''} onClick={() => setApp(x.id)}>
                  {x.label}
                </button>
              ))}
            </div>
            {advice && (
              <div className="firing-answer">
                <p>
                  <b>{advice.lean === 'either' ? 'No clear winner for this application' : `Leans towards ${advice.lean} · ${(advice.lean === 'A' ? res.a : res.b).choice.short}`}</b>
                </p>
                {advice.reasons.map((t, k) => (
                  <p key={k}>{t}</p>
                ))}
                <p className="muted small">Trade-offs: {advice.tradeoffs.join(' ')}</p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

function show(m: Metric, fmt: (v: number) => string) {
  return m.value === null || !Number.isFinite(m.value) ? '—' : fmt(m.value)
}

/** Two compact bars on a shared scale (magnitudes). */
function Bars({ a, b }: { a: number | null; b: number | null }) {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null
  const max = Math.max(Math.abs(a), Math.abs(b)) || 1
  return (
    <span className="cmp-bars" aria-hidden="true">
      <span className="cmp-bar cmp-bar--a" style={{ width: `${(Math.abs(a) / max) * 100}%` }} />
      <span className="cmp-bar cmp-bar--b" style={{ width: `${(Math.abs(b) / max) * 100}%` }} />
    </span>
  )
}

/** Vo (and optionally Io) of both simulations over the last two cycles. */
function CompareWaves({ res }: { res: CompareResult }) {
  const [mode, setMode] = useState<'overlay' | 'separate' | 'difference'>('overlay')
  const [io, setIo] = useState(false)
  const W = 720
  const H = mode === 'separate' ? 300 : 170
  const L = 52
  const sig = io ? 'io' : 'vout'
  const series = (s: CompareResult['a']) => {
    const tr = s.result.trace
    const per = Math.round(s.result.params.period / s.result.params.dt)
    const from = Math.max(0, tr.length - 1 - 2 * per)
    const arr = tr.signals[sig]!
    return Array.from({ length: tr.length - from }, (_, k) => arr[from + k])
  }
  const A = series(res.a)
  const B = series(res.b)
  const n = Math.min(A.length, B.length)
  const D = Array.from({ length: n }, (_, k) => B[k] - A[k])
  const lanes = mode === 'separate' ? [[A], [B]] : mode === 'difference' ? [[D]] : [[A, B]]
  const colors = mode === 'separate' ? [['a'], ['b']] : mode === 'difference' ? [['d']] : [['a', 'b']]
  const laneH = (H - 20) / lanes.length
  const unit = io ? 'A' : 'V'
  return (
    <div className="cmp-wave">
      <div className="cmp-wave-bar">
        <div className="seg" role="radiogroup" aria-label="Waveform view">
          {(['overlay', 'separate', 'difference'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={io} onChange={() => setIo((v) => !v)} /> Show Io instead of Vo
        </label>
        <span className="compare-legend">
          <span className="cmp-key cmp-key--a">A {res.a.choice.short}</span>
          <span className="cmp-key cmp-key--b">B {res.b.choice.short}</span>
          {mode === 'difference' && <span className="cmp-key cmp-key--d">B − A</span>}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="compare-svg" role="img" aria-label={`${io ? 'Load current' : 'Output voltage'} of both rectifiers over two cycles (${mode})`}>
        {lanes.map((lane, li) => {
          const top = 8 + li * laneH
          const all = lane.flat()
          let lo = Math.min(0, ...all)
          let hi = Math.max(0, ...all)
          if (hi - lo < 1e-9) hi = lo + 1
          const pad = (hi - lo) * 0.06
          lo -= pad
          hi += pad
          const y = (v: number) => top + laneH - 12 - ((v - lo) / (hi - lo)) * (laneH - 16)
          const path = (arr: number[]) => {
            const step = Math.max(1, Math.floor(arr.length / 700))
            let d = ''
            for (let k = 0; k < arr.length; k += step) d += `${d ? 'L' : 'M'}${(L + (k / (n - 1)) * (W - L - 8)).toFixed(1)},${y(arr[k]).toFixed(1)}`
            return d
          }
          return (
            <g key={li}>
              <rect className="cmp-lane" x={L} y={top} width={W - L - 8} height={laneH - 12} />
              <line className="cmp-zero" x1={L} x2={W - 8} y1={y(0)} y2={y(0)} />
              <text className="cmp-tick" x={L - 6} y={top + 10} textAnchor="end">{formatSI(hi, unit)}</text>
              <text className="cmp-tick" x={L - 6} y={y(0) + 3} textAnchor="end">0</text>
              {lane.map((arr, k) => (
                <path key={k} className={`cmp-trace cmp-trace--${colors[li][k]}`} d={path(arr.slice(0, n))} />
              ))}
            </g>
          )
        })}
      </svg>
      <p className="muted small">The last two source cycles of each simulation, on the same time axis (same frequency).</p>
    </div>
  )
}
