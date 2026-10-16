import { useMemo, useState, type ReactNode } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { Plot } from '../../ui/Plot.tsx'
import { fx } from '../../ui/format.ts'
import { Predict, useTutorContext } from '../../ui/kit.tsx'
import { dcWaveform, pvCurve, rectifierBridge, WEAK0, type PvCurve } from './calc.ts'
import { Chart, COLORS, PowerAnglePlot, QvPlot } from './charts.tsx'
import { EXP_BRIDGE, EXPERIMENTS, type Experiment } from './experiments.ts'
import { MODULE } from './shared.tsx'

export function Experiments() {
  const [current, setCurrent] = useState(EXPERIMENTS[0].id)
  const progress = usePsProgress()
  const e = EXPERIMENTS.find((x) => x.id === current)!
  const onAnswered = (id: string) => {
    completeActivity(MODULE, `exp-${id}`)
    const done = new Set([...EXPERIMENTS.filter((x) => isDone(progress, MODULE, `exp-${x.id}`)).map((x) => x.id), id])
    if (done.size >= 3) completeActivity(MODULE, 'experiments')
  }
  return (
    <div className="ps-stack">
      <nav className="ps-exp-list" aria-label="Experiments">
        <p className="small muted">Predict first, then see what the calculation says. Three experiments complete this activity.</p>
        <ol>
          {EXPERIMENTS.map((x, k) => (
            <li key={x.id}>
              <button type="button" className={`ps-exp-item ${x.id === current ? 'on' : ''}`} aria-current={x.id === current ? 'true' : undefined} onClick={() => setCurrent(x.id)}>
                <span className="ps-exp-n" aria-hidden="true">
                  {isDone(progress, MODULE, `exp-${x.id}`) ? '✓' : k + 1}
                </span>
                {x.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <ExperimentRun key={e.id} e={e} onAnswered={() => onAnswered(e.id)} />
    </div>
  )
}

function bridgeWave(alpha: number, id: number) {
  const b = rectifierBridge(EXP_BRIDGE.vll, alpha, EXP_BRIDGE.xc, id)
  if (!b.ok) return null
  return dcWaveform(EXP_BRIDGE.vll, alpha, b.muDeg, 721)
}
const curve = (scr: number): PvCurve | null => {
  const c = pvCurve({ ...WEAK0, scr }, 'none')
  return c.ok ? c : null
}

/** The picture for each experiment — all calculated. */
function Visual({ id }: { id: string }): ReactNode {
  if (id === 'alpha' || id === 'current') {
    const [a0, i0, a1, i1] = id === 'alpha' ? [15, 2, 35, 2] : [15, 1, 15, 2]
    const w0 = bridgeWave(a0, i0)
    const w1 = bridgeWave(a1, i1)
    if (!w0 || !w1) return null
    return (
      <Plot
        label="DC voltage of the bridge before and after"
        xLabel="ωt [°]"
        yLabel="v_d [kV]"
        height={220}
        xDomain={[0, 120]}
        yDomain={[0, 330]}
        series={[
          { id: 'b', label: id === 'alpha' ? `α ${a0}°` : `${i0} kA`, color: 'var(--text-3)', points: w0.vd.filter((p) => p[0] <= 120), dashed: true },
          { id: 'a', label: id === 'alpha' ? `α ${a1}°` : `${i1} kA`, color: COLORS.rect, points: w1.vd.filter((p) => p[0] <= 120) },
        ]}
      />
    )
  }
  if (id === 'series') return <PowerAnglePlot v={1} x={0.5} k={0.5} p={1} height={240} />
  if (id === 'shunt') return <PowerAnglePlot v={1} x={0.5} k={0} p={1} height={240} />
  if (id === 'svc-statcom') return <QvPlot rating={0.5} v={0.7} />
  if (id === 'scr') {
    const a = curve(5)
    const b = curve(2)
    if (!a || !b) return null
    return (
      <Chart
        series={[
          { id: 's5', label: `SCR 5 (collapse ${fx(a.nose.p, 3)} pu)`, color: COLORS.dc, points: a.points },
          { id: 's2', label: `SCR 2 (collapse ${fx(b.nose.p, 3)} pu)`, color: COLORS.ac, points: b.points },
        ]}
        markers={[
          { x: a.nose.p, y: a.nose.v, color: COLORS.dc, shape: 'ring', label: 'nose' },
          { x: b.nose.p, y: b.nose.v, color: COLORS.ac, shape: 'ring', label: 'nose' },
        ]}
        xLabel="Load P [pu]"
        yLabel="Bus voltage V [pu]"
        xDomain={[0, a.nose.p * 1.1]}
        yDomain={[0, 1.1]}
        height={240}
        label="P–V curves of the bus with a strong and a weak supply"
        desc={`Collapse at ${fx(a.nose.p, 3)} pu (SCR 5) and ${fx(b.nose.p, 3)} pu (SCR 2).`}
      />
    )
  }
  return null
}

function ExperimentRun({ e, onAnswered }: { e: Experiment; onAnswered(): void }) {
  const r = useMemo(() => e.run(), [e])
  const [answered, setAnswered] = useState(false)
  useTutorContext(() => `Experiment mode — "${e.title}" (${e.layer}): ${e.change} Question: ${e.question} ${answered ? `Result: ${r.explain.join(' ')}` : 'The student has not predicted yet.'}`)
  return (
    <div className="ps-stack">
      <div className="ps-card">
        <p className="eyebrow">Experiment · {e.layer}</p>
        <h3>{e.title}</h3>
        <p>{e.change}</p>
      </div>
      <Predict
        question={e.question}
        options={e.options}
        answer={r.answer}
        onAnswered={() => {
          setAnswered(true)
          onAnswered()
        }}
        why={
          <>
            {r.explain.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
          </>
        }
      />
      {answered && (
        <>
          <div className="ps-card hf-flush">
            <Visual id={e.id} />
          </div>
          <div className="ps-card table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Before and after: {e.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">{r.beforeLabel ?? 'Before'}</th>
                  <th scope="col">{r.afterLabel ?? 'After'}</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => {
                  const d = row.after - row.before
                  const changed = Math.abs(d) > 0.5 * 10 ** -row.decimals
                  return (
                    <tr key={row.label} className={changed ? 'is-changed' : ''}>
                      <td>{row.label}</td>
                      <td>
                        {fx(row.before, row.decimals)} {row.unit}
                      </td>
                      <td>
                        {fx(row.after, row.decimals)} {row.unit}
                      </td>
                      <td className={!changed ? '' : d > 0 ? 'up' : 'down'}>
                        {!changed ? 'no change' : `${d > 0 ? '+' : '−'}${fx(Math.abs(d), row.decimals)}${row.before !== 0 ? ` (${d > 0 ? '+' : '−'}${fx(Math.abs(d / row.before) * 100, 1)} %)` : ''}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
