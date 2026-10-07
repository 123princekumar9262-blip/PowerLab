import { useMemo } from 'react'
import { deviceName } from '../../circuits/devices.ts'
import { overlapAnalysis } from '../../measurements/overlap.ts'
import type { SimulationResult, SimulationSample } from '../../types/simulation.ts'
import { formatA, formatDeg } from '../../utils/format.ts'

/**
 * ANALYSIS → Commutation / μ. Measured μ comes from the switching events of the simulation;
 * the textbook relation is compared only when its assumptions hold — otherwise the panel says
 * why, instead of showing a misleading error.
 */
export function OverlapPanel({ result, sample }: { result: SimulationResult; sample: SimulationSample }) {
  const ov = useMemo(() => overlapAnalysis(result), [result])
  if (!ov) return <p className="lesson-body">Commutation overlap applies to the three-phase rectifiers.</p>
  const p = result.params
  const nm = (id: Parameters<typeof deviceName>[1]) => deviceName(p, id)
  const now = ov.rows.find((r) => sample.time >= r.c.tStart && sample.time <= r.c.tEnd)
  const all = ov.rows
  const dIdx = (id: string) => result.diodeIds.indexOf(id as never)
  return (
    <div className="overlap-panel">
      <dl className="summary-grid">
        <div>
          <dt>Measured μ</dt>
          <dd>{ov.measuredMu === null ? '—' : formatDeg(ov.measuredMu)}</dd>
        </div>
        <div>
          <dt>Theoretical μ</dt>
          <dd>{ov.theoryMu === null ? '—' : formatDeg(ov.theoryMu)}</dd>
        </div>
        <div>
          <dt>Difference</dt>
          <dd>{ov.difference === null ? '—' : `${ov.difference >= 0 ? '+' : '−'}${Math.abs(ov.difference * 100).toFixed(2)} %`}</dd>
        </div>
        <div>
          <dt>Ls per phase</dt>
          <dd>{(p.threePhase.ls * 1e3).toFixed(2)} mH</dd>
        </div>
      </dl>
      <p className="muted small">
        Measured: μ = θ(outgoing device turns OFF) − θ(incoming device turns ON), from the simulation’s switching events, averaged over the {all.length} commutations of the last
        cycle.
      </p>
      {!ov.available && (
        <div className="flag flag--info">
          <b>Overlap theory comparison unavailable for this operating condition.</b>
          <ul>
            {ov.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="chain-eq">{ov.formula}</p>
      <details>
        <summary className="small">Assumptions of the overlap relation</summary>
        <ul className="theory-notes">
          {ov.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>

      {now && (
        <div className="firing-answer">
          <p>
            <b>The cursor is inside a commutation</b> ({nm(now.c.outgoing)} → {nm(now.c.incoming)}): both conduct. Now: i({nm(now.c.outgoing)}) ={' '}
            {formatA(sample.diodes[dIdx(now.c.outgoing)]?.current ?? 0)}, i({nm(now.c.incoming)}) = {formatA(sample.diodes[dIdx(now.c.incoming)]?.current ?? 0)} — their sum is the load
            current {formatA(sample.io)}.
          </p>
        </div>
      )}

      {all.length > 0 && (
        <div className="table-wrap">
          <table className="ba-table">
            <thead>
              <tr>
                <th>Commutation</th>
                <th className="num">starts θ</th>
                <th className="num">ends θ</th>
                <th className="num no-case">μ measured</th>
                <th className="num no-case">μ theory</th>
                <th>Current transfer (start → end)</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r, k) => (
                <tr key={k}>
                  <th>
                    {nm(r.c.outgoing)} → {nm(r.c.incoming)}
                    {r.alphaDeg > 0 && <span className="muted"> (α = {formatDeg(r.alphaDeg)})</span>}
                  </th>
                  <td className="num">{formatDeg(r.c.thetaStartDeg)}</td>
                  <td className="num">{formatDeg(r.c.thetaEndDeg)}</td>
                  <td className="num">{formatDeg(r.c.muDeg)}</td>
                  <td className="num">{r.theoryMu === null || !ov.available ? '—' : formatDeg(r.theoryMu)}</td>
                  <td className="small">
                    old {nm(r.c.outgoing)}: {formatA(r.c.iOut[0])} → {formatA(r.c.iOut[1])} · new {nm(r.c.incoming)}: {formatA(r.c.iIn[0])} → {formatA(r.c.iIn[1])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        On the scope (conduction shading on) every overlap is shaded amber; the Events view lists “commutation begins” and “fully conducting” markers next to the natural commutation
        points. μ is resolved by a first-order integrator — a finer timestep (Advanced → Simulation) tightens the agreement.
      </p>
    </div>
  )
}
