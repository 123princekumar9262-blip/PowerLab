import { useEffect, useState } from 'react'
import { segmentAverage, simulateCircuit } from '../../converters/engine.ts'
import type { BidiMeasurements, BidiRun, CoupledMeasurements, CoupledRun } from '../../converters/dcdc4/measure.ts'
import { measureCoupled } from '../../converters/dcdc4/measure.ts'
import { coupledModel } from '../../converters/dcdc4/model.ts'
import type { CoupledKind, CoupledParams, ResolvedCoupled } from '../../converters/dcdc4/params.ts'
import { bidiIdeal, bidiTextbook, coupledBoundary, coupledLaw, coupledVc1Law } from '../../converters/dcdc4/theory.ts'
import { formatA, formatSI, formatV, formatW } from '../../utils/format.ts'

/** CCM/DCM from the simulation, and where the operating point sits relative to the theory boundary. */
export function CoupledBadge({ m, p }: { m: CoupledMeasurements; p: ResolvedCoupled }) {
  const b = coupledBoundary(p)
  const x = Math.min(1, Math.max(0, 0.5 + Math.log(b.K / b.Kcrit) / Math.log(16)))
  const agree = (m.mode === 'CCM') === b.ccm
  return (
    <section className="dc-mode" aria-label="Conduction mode">
      <div className="dc-mode-head">
        <span className={`mode-pill mode-pill--${m.mode.toLowerCase()}`}>{m.mode}</span>
        <span className="small">
          {m.mode === 'CCM' ? `the diode current iL1 + iL2 never reaches zero` : `iD = 0 for ${(m.d3 * 100).toFixed(1)} % of each period; L1 and L2 circulate ${formatA(Math.abs(m.idleCurrent))}`}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <div className="boundary-bar" role="img" aria-label={`Boundary indicator: Le is ${(b.le / b.leCrit).toFixed(2)} times the critical value`}>
        <span className="boundary-zone boundary-zone--dcm">DCM</span>
        <span className="boundary-zone boundary-zone--ccm">CCM</span>
        <span className="boundary-mark" style={{ left: '50%' }} />
        <span className="boundary-dot" style={{ left: `${x * 100}%` }} />
      </div>
      <p className="muted small">
        Le / Le,crit = {(b.le / b.leCrit).toFixed(2)} (THEORY: Le = L1‖L2 = {formatSI(b.le, 'H')}, Le,crit = (1 − D)²·R/(2·fs) = {formatSI(b.leCrit, 'H')}).
        {!agree && ' The ideal boundary and the simulation disagree here: device drops, resistances and the C1 ripple shift it slightly.'}
      </p>
    </section>
  )
}

const DERIVATION: Record<CoupledKind, { title: string; steps: string[] }> = {
  cuk: {
    title: 'Ideal Ćuk, CCM: Vout = −D·Vin/(1 − D)',
    steps: [
      'ON (D·Ts): vL1 = Vin;  vL2 = vC1 − |Vout| = Vin.  OFF ((1 − D)·Ts): vL1 = Vin − vC1 = −|Vout|;  vL2 = −|Vout|.',
      'L1: Vin·D + (Vin − VC1)·(1 − D) = 0  ⇒  VC1 = Vin/(1 − D) = Vin + |Vout|',
      'L2: (VC1 − |Vout|)·D − |Vout|·(1 − D) = 0  ⇒  |Vout| = D·Vin/(1 − D), inverted.',
      'C1 charge balance: IL1·(1 − D) = IL2·D. Ripples: ΔiL1 = Vin·D/(L1·fs), ΔiL2 = Vin·D/(L2·fs), ΔVC1 = |Iout|·D/(C1·fs), ΔVout = ΔiL2/(8·C·fs).',
    ],
  },
  sepic: {
    title: 'Ideal SEPIC, CCM: Vout = D·Vin/(1 − D)',
    steps: [
      'Loop Vin → L1 → C1 → L2 → ground with zero average inductor voltages  ⇒  VC1 = Vin.',
      'ON (D·Ts): vL1 = Vin;  vL2 = vC1 = Vin.  OFF: vL1 = Vin − VC1 − Vout = −Vout;  vL2 = −Vout.',
      'L1: Vin·D − Vout·(1 − D) = 0  ⇒  Vout = D·Vin/(1 − D) (non-inverted, up or down).',
      'Ripples: ΔiL1 = Vin·D/(L1·fs), ΔiL2 = Vin·D/(L2·fs), ΔVC1 = Iout·D/(C1·fs); the output is fed in pulses: ΔVout = Iout·D/(C·fs).',
    ],
  },
  zeta: {
    title: 'Ideal Zeta, CCM: Vout = D·Vin/(1 − D)',
    steps: [
      'ON (D·Ts): vL1 = Vin;  vL2 = Vin + vC1 − Vout = Vin.  OFF: vL1 = −VC1;  vL2 = −Vout.',
      'L1: Vin·D − VC1·(1 − D) = 0  ⇒  VC1 = D·Vin/(1 − D) = Vout.',
      'L2: Vin·D − Vout·(1 − D) = 0  ⇒  Vout = D·Vin/(1 − D) (non-inverted, up or down).',
      'Ripples: ΔiL1 = Vin·D/(L1·fs), ΔiL2 = Vin·D/(L2·fs), ΔVC1 = Iout·D/(C1·fs); L2 feeds the output continuously: ΔVout = ΔiL2/(8·C·fs).',
    ],
  },
}

export function CoupledTheory({ r, m }: { r: CoupledRun; m: CoupledMeasurements }) {
  const p = r.params
  const d = DERIVATION[p.kind]
  const b = coupledBoundary(p)
  const vl1 = segmentAverage(r, 'vl1')
  const vl2 = segmentAverage(r, 'vl2')
  return (
    <>
      <h3>{d.title}</h3>
      <ul className="theory-notes">
        <li>Assumptions: ideal switch and diode, lossless L1, L2, C1 and C, small ripple on C1 and C, continuous diode current (CCM), periodic steady state.</li>
      </ul>
      <details open>
        <summary>Derivation: volt-second balance on both inductors</summary>
        <ol className="derivation">
          {d.steps.map((s) => (
            <li key={s}>
              <span className="mono">{s}</span>
            </li>
          ))}
          <li>
            DCM: the diode carries iL1 + iL2, which behaves like the buck-boost's iL with <span className="mono">Le = L1·L2/(L1 + L2)</span>. CCM needs <span className="mono">Le &gt; (1 − D)²·R/(2·fs)</span> = {formatSI(b.leCrit, 'H')} (here {formatSI(b.le, 'H')}). Below it the
            DIODE current reaches zero each period, the inductor currents keep circulating at ±I through C1, and |Vout|/Vin = D/√Ke with Ke = 2·Le/(R·Ts) = {b.K.toFixed(3)}.
          </li>
        </ol>
      </details>
      <h3>Check it on the simulation</h3>
      <dl className="dc-kv dc-kv--wide">
        <div>
          <dt>average vL1, vL2 (should be 0)</dt>
          <dd>
            {formatV(vl1)}, {formatV(vl2)}
          </dd>
        </div>
        <div>
          <dt>average vC1 · {coupledVc1Law(p.kind)}</dt>
          <dd>{formatV(m.vc1Avg, false)}</dd>
        </div>
        <div>
          <dt>average Vout · {coupledLaw(p.kind)}</dt>
          <dd>{formatV(m.voutAvg)}</dd>
        </div>
        <div>
          <dt>mode (SIMULATION)</dt>
          <dd>{m.mode}</dd>
        </div>
      </dl>
      <p className="small">
        The simulation never uses these laws: it integrates <span className="mono">L·di/dt = v</span> and <span className="mono">C·dv/dt = i</span> for both inductors and both capacitors; the diode state follows from the solved voltages and currents.
      </p>
      <h3>Exact solution (used to validate the solver)</h3>
      <p className="small">
        The circuit equations of each conduction mode (Q1 ON; D1 ON; both OFF with iL2 = −iL1) are written by hand as <span className="mono">x′ = A·x + b</span>, x = [iL1, iL2, vC1, vC], and solved with the matrix exponential; every mode change is found by bisection on the exact flow and
        the periodic steady state is the fixed point of the exact period map (Newton). It includes Ron, Vf, DCR and ESR.
      </p>
    </>
  )
}

export function CoupledStress({ m }: { m: CoupledMeasurements }) {
  const rows: Array<[string, string]> = [
    ['Switch: peak / RMS current', `${formatA(m.iqPeak)} / ${formatA(m.iqRms)}`],
    ['Switch: max blocking voltage', formatV(m.vqMax, false)],
    ['Diode: average / peak / RMS current', `${formatA(m.idAvg)} / ${formatA(m.idPeak)} / ${formatA(m.idRms)}`],
    ['Diode: max reverse voltage', formatV(m.vdReverseMax, false)],
    ['Coupling capacitor: average / ripple', `${formatV(m.vc1Avg, false)} / ${formatV(m.vc1PP, false)}`],
    ['Output capacitor RMS current', formatA(m.icRms)],
    ['Losses Q1 · D1 · DCR · ESR', `${formatW(m.losses.q)} · ${formatW(m.losses.d)} · ${formatW(m.losses.dcr)} · ${formatW(m.losses.esr)}`],
  ]
  return (
    <>
      <p className="small">Device and component stress over the measurement window (SIMULATION). Q1 and D1 both see Vin + |Vout| and both carry iL1 + iL2.</p>
      <dl className="dc-kv dc-kv--wide">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

const SWEEP = Array.from({ length: 15 }, (_, i) => Math.round((0.15 + 0.05 * i) * 100) / 100)

/** |Vout|/Vin against D: the simulation (dots) on the ideal CCM / DCM relation (line). */
export function CoupledSweep({ p, kind }: { p: CoupledParams; kind: CoupledKind }) {
  const [run, setRun] = useState(false)
  const [pts, setPts] = useState<Array<{ d: number; sim: number; mode: string }>>([])
  const key = JSON.stringify(p)
  useEffect(() => {
    if (!run) return
    const model = coupledModel(kind)
    const out: Array<{ d: number; sim: number; mode: string }> = []
    let i = 0
    let timer = 0
    setPts([])
    const step = () => {
      const r = simulateCircuit(model, { ...p, duty: SWEEP[i], view: 'steady', periods: 1 })
      const mm = measureCoupled(r)
      out.push({ d: SWEEP[i], sim: Math.abs(mm.voutAvg) / p.vin, mode: mm.mode })
      setPts([...out])
      if (++i < SWEEP.length) timer = window.setTimeout(step, 0)
    }
    timer = window.setTimeout(step, 0)
    return () => window.clearTimeout(timer)
  }, [run, key, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const ideal = (d: number) => {
    const b = coupledBoundary({ ...p, duty: d })
    return b.ccm ? d / (1 - d) : d / Math.sqrt(b.K)
  }
  const line = Array.from({ length: 71 }, (_, k) => 0.15 + (k * 0.7) / 70)
  const vals = [...line.map(ideal), ...pts.map((q) => q.sim)]
  const yMax = Math.max(1, Math.min(8, Math.ceil(Math.max(...vals) * 1.05)))
  const W = 520
  const H = 250
  const L = 46
  const Bm = 34
  const x = (d: number) => L + ((d - 0.15) / 0.7) * (W - L - 12)
  const y = (v: number) => H - Bm - (Math.min(v, yMax) / yMax) * (H - Bm - 14)
  return (
    <div className="dc-sweep">
      <p className="small">Simulates the converter at D = 15 % … 85 % with the present L1, L2, C1, C, R and fs, and plots the simulated |Vout|/Vin (dots) on the ideal relation (line). Above the dashed line (ratio 1) it steps up.</p>
      {!run ? (
        <button className="run-btn" onClick={() => setRun(true)}>
          Run duty sweep ({SWEEP.length} simulations)
        </button>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="sweep-chart" role="img" aria-label="Output to input ratio versus duty ratio: simulation and theory">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W - 12} y1={y(f * yMax)} y2={y(f * yMax)} className="grid" />
              <text x={L - 6} y={y(f * yMax) + 4} textAnchor="end" className="tick">
                {(f * yMax).toFixed(2)}
              </text>
            </g>
          ))}
          <line x1={L} x2={W - 12} y1={y(1)} y2={y(1)} className="grid" strokeDasharray="5 4" />
          {[0.2, 0.35, 0.5, 0.65, 0.8].map((d) => (
            <text key={d} x={x(d)} y={H - Bm + 16} textAnchor="middle" className="tick">
              {(d * 100).toFixed(0)} %
            </text>
          ))}
          <text x={(W + L) / 2} y={H - 4} textAnchor="middle" className="tick">
            duty ratio D
          </text>
          <polyline points={line.map((d) => `${x(d)},${y(ideal(d))}`).join(' ')} className="sweep-theory" />
          {pts.map((q) => (
            <circle key={q.d} cx={x(q.d)} cy={y(q.sim)} r={5} className={`sweep-dot sweep-dot--${q.mode.toLowerCase()}`}>
              <title>
                D = {(q.d * 100).toFixed(0)} %: simulated |Vout|/Vin = {q.sim.toFixed(4)} ({q.mode}); ideal {ideal(q.d).toFixed(4)}
              </title>
            </circle>
          ))}
        </svg>
      )}
      {pts.length > 0 && (
        <div className="table-wrap">
          <table className="ba-table">
            <thead>
              <tr>
                <th>D</th>
                <th className="num">SIMULATION |Vout|/Vin</th>
                <th className="num">Ideal (THEORY)</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((q) => (
                <tr key={q.d}>
                  <th>{(q.d * 100).toFixed(0)} %</th>
                  <td className="num">{q.sim.toFixed(4)}</td>
                  <td className="num">{ideal(q.d).toFixed(4)}</td>
                  <td>{q.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Bidirectional ─────────────────────────────────────────────────────────────────────────────────────

export function BidiBadge({ m, r }: { m: BidiMeasurements; r: BidiRun }) {
  const buck = m.direction === 'buck'
  return (
    <section className="dc-mode" aria-label="Power direction">
      <div className="dc-mode-head">
        <span className={`mode-pill mode-pill--${buck ? 'ccm' : 'dcm'}`}>{buck ? 'BUCK' : 'BOOST'}</span>
        <span className="small">
          {buck ? `bus → battery, ${formatW(m.phvAvg)}` : `battery → bus, ${formatW(-m.phvAvg)}`}
          {m.reverses ? ' · iL changes sign inside every period' : ''}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        Battery current {formatA(m.ibAvg, true)} for a reference of {formatA(r.params.irefSigned, true)}
        {r.params.control === 'duty' ? ' (duty set by hand: the reference is not used)' : ''}. Complementary switches carry iL both ways, so there is no discontinuous mode.
      </p>
    </section>
  )
}

export function BidiTheory({ r, m }: { r: BidiRun; m: BidiMeasurements }) {
  const p = r.params
  const tb = bidiTextbook(p)
  const g = bidiIdeal(p)
  return (
    <>
      <h3>Ideal bidirectional half-bridge: VLV = D·VHV, IHV = D·IL</h3>
      <ul className="theory-notes">
        <li>Assumptions: ideal switches conducting both ways, complementary gating without dead time, lossless L and C, periodic steady state.</li>
      </ul>
      <details open>
        <summary>Derivation</summary>
        <ol className="derivation">
          <li>
            <span className="mono">vsw = VHV while Q1 is ON (D·Ts), 0 while Q2 is ON ((1 − D)·Ts) — whatever the sign of iL, because a switch conducts both ways.</span>
          </li>
          <li>
            <span className="mono">Volt-second balance on L: average vsw = average vLV  ⇒  VLV = D·VHV</span> (= {formatV(g.vlv, false)} here).
          </li>
          <li>
            <span className="mono">The battery sees VLV through Rb: IL = Ib = (D·VHV − Eb)/(Rb + DCR + Ron)</span> = {formatA(tb.ilAvg.value ?? NaN, true)}. Positive: buck (charging); negative: boost (discharging).
          </li>
          <li>
            <span className="mono">Power balance (lossless): VHV·IHV = VLV·IL  ⇒  IHV = D·IL</span> = {formatA(tb.ihvAvg.value ?? NaN, true)}.
          </li>
          <li>
            <span className="mono">ΔiL = VHV·D·(1 − D)/(L·fs)</span> = {formatA(tb.ilPP.value ?? NaN)} — the same in both directions. When ΔiL/2 &gt; |IL| the current crosses zero inside the period; the converter does not enter DCM.
          </li>
          <li>
            Dead time: while both gates are LOW a diode carries iL — D2 (switch node at ground) if iL &gt; 0, D1 (switch node at the bus) if iL &lt; 0 — so the effective duty depends on the current direction. If iL reaches zero inside a dead time nothing conducts and iL stays at zero until the next
            gate edge (the switch-node voltage is then undefined: in a real converter the device capacitances ring with L).
          </li>
        </ol>
      </details>
      <h3>Check it on the simulation</h3>
      <dl className="dc-kv dc-kv--wide">
        <div>
          <dt>average vsw (= VLV in steady state)</dt>
          <dd>{formatV(m.vswAvg, false)}</dd>
        </div>
        <div>
          <dt>average VLV</dt>
          <dd>{formatV(m.vlvAvg, false)}</dd>
        </div>
        <div>
          <dt>IHV vs D·IL</dt>
          <dd>
            {formatA(m.ihvAvg, true)} vs {formatA(p.d * m.ilAvg, true)}
          </dd>
        </div>
        <div>
          <dt>direction (SIMULATION)</dt>
          <dd>{m.direction}</dd>
        </div>
      </dl>
      <h3>Exact solution (used to validate the solver)</h3>
      <p className="small">
        For each combination of gates and conducting diodes the switch-node voltage follows from KCL; <span className="mono">L·diL/dt = vsw − vLV − DCR·iL</span> and the LV node (C with its ESR in parallel with Eb behind Rb) give <span className="mono">x′ = A·x + b</span>, x = [iL, vC], solved
        with the matrix exponential, mode changes by bisection on the exact flow, the periodic state by Newton on the exact period map.
      </p>
    </>
  )
}

export function BidiStress({ m, r }: { m: BidiMeasurements; r: BidiRun }) {
  const rows: Array<[string, string]> = [
    ['Q1 / Q2 RMS current', `${formatA(m.iq1Rms)} / ${formatA(m.iq2Rms)}`],
    ['Blocking voltage (each switch)', formatV(r.params.vhv, false)],
    ['Inductor: average / peak-to-peak', `${formatA(m.ilAvg, true)} / ${formatA(m.ilPP)}`],
    ['Diode conduction', `${(m.diodeFraction * 100).toFixed(2)} % of the period`],
    ['Losses switches · diodes · DCR · ESR', `${formatW(m.losses.sw)} · ${formatW(m.losses.dio)} · ${formatW(m.losses.dcr)} · ${formatW(m.losses.esr)}`],
    ['Battery: EMF power · Rb loss', `${formatW(m.pbatAvg)} · ${formatW(m.prbAvg)}`],
  ]
  return (
    <>
      <p className="small">Stress and losses over the measurement window (SIMULATION).</p>
      <dl className="dc-kv dc-kv--wide">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
