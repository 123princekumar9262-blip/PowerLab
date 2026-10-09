import { useEffect, useState } from 'react'
import { voltSecondFromSim, type DcdcState } from '../../converters/dcdc/explain.ts'
import { measureDcdc, type DcdcMeasurements } from '../../converters/dcdc/measure.ts'
import { dcdcModel } from '../../converters/dcdc/model.ts'
import { dcdcBoundary, dcdcExact, idealCcmM, idealDcmM } from '../../converters/dcdc/theory.ts'
import { simulateCircuit } from '../../converters/engine.ts'
import type { ConverterKind, ConverterParams, ConverterResult, ResolvedConverter } from '../../converters/types.ts'
import type { InspectInfo } from '../../lab/types.ts'
import { formatA, formatSI, formatV, formatW } from '../../utils/format.ts'
import { formatSlopeA } from '../../converters/dcdc/explain.ts'

/** CCM/DCM detection (from the simulation) and where the operating point sits relative to the boundary (theory). */
export function DcdcBadge({ m, p }: { m: DcdcMeasurements; p: ResolvedConverter }) {
  const b = dcdcBoundary(p)
  const x = Math.min(1, Math.max(0, 0.5 + Math.log(b.K / b.Kcrit) / Math.log(16)))
  const agree = (m.mode === 'CCM') === b.ccm
  return (
    <section className="dc-mode" aria-label="Conduction mode">
      <div className="dc-mode-head">
        <span className={`mode-pill mode-pill--${m.mode.toLowerCase()}`}>{m.mode}</span>
        <span className="small">
          {m.mode === 'CCM' ? `iL never reaches zero (min ${formatA(m.ilMin)})` : `iL = 0 for ${(m.d3 * 100).toFixed(1)} % of each period`}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <div className="boundary-bar" role="img" aria-label={`Boundary indicator: L is ${(p.l / b.lCrit).toFixed(2)} times the critical inductance`}>
        <span className="boundary-zone boundary-zone--dcm">DCM</span>
        <span className="boundary-zone boundary-zone--ccm">CCM</span>
        <span className="boundary-mark" style={{ left: '50%' }} />
        <span className="boundary-dot" style={{ left: `${x * 100}%` }} />
      </div>
      <p className="muted small">
        L / Lcrit = {(p.l / b.lCrit).toFixed(2)} (THEORY: {b.lCritFormula} = {formatSI(b.lCrit, 'H')}).
        {!agree && ' The ideal boundary and the simulation disagree here: device drops, resistances and finite ripple shift it slightly.'}
      </p>
    </section>
  )
}

/** Energy view: stored energies and the instantaneous power flow between source, L, C and R. */
export function DcdcEnergy({ st, m, p }: { st: DcdcState; m: DcdcMeasurements; p: ResolvedConverter }) {
  const pS = st.pin
  const pL = st.pL
  const pC = st.pC
  const pR = st.pout
  const loss = pS - pL - pC - pR
  const flows: Array<{ from: string; to: string; w: number }> = [
    { from: 'Source', to: 'circuit', w: pS },
    pL >= 0 ? { from: 'circuit', to: 'Inductor (storing)', w: pL } : { from: 'Inductor (releasing)', to: 'circuit', w: -pL },
    pC >= 0 ? { from: 'circuit', to: 'Capacitor (charging)', w: pC } : { from: 'Capacitor (discharging)', to: 'circuit', w: -pC },
    { from: 'circuit', to: 'Load R', w: pR },
    { from: 'circuit', to: 'losses (Q1, D1, DCR, ESR)', w: Math.max(0, loss) },
  ]
  const max = Math.max(...flows.map((f) => f.w), 1e-12)
  return (
    <section className="dc-energy" aria-label="Energy">
      <div className="energy-stores">
        <div className="estore estore--l">
          <span className="estore-label">Inductor EL = ½·L·iL²</span>
          <span className="estore-value">{formatSI(st.el, 'J')}</span>
          <span className="estore-bar">
            <span style={{ width: `${(100 * st.el) / Math.max(m.elMax, 1e-15)}%` }} />
          </span>
          <span className="muted small">
            {st.pL >= 0 ? 'storing' : 'releasing'} {formatW(Math.abs(st.pL))}
          </span>
        </div>
        <div className="estore estore--c">
          <span className="estore-label">Capacitor EC = ½·C·vC²</span>
          <span className="estore-value">{formatSI(st.ec, 'J')}</span>
          <span className="estore-bar">
            <span style={{ width: `${Math.min(100, (100 * st.ec) / Math.max(0.5 * p.c * Math.max(m.voutMax ** 2, m.voutMin ** 2), 1e-15))}%` }} />
          </span>
          <span className="muted small">
            {st.pC >= 0 ? 'charging' : 'discharging'} {formatW(Math.abs(st.pC))}
          </span>
        </div>
      </div>
      <h3 className="eyebrow">Power flow now (SIMULATION)</h3>
      <ul className="eflows">
        {flows.map((f, k) => (
          <li key={k}>
            <span className="eflow-label">
              {f.from} → {f.to}
            </span>
            <span className="eflow-bar">
              <span style={{ width: `${(100 * f.w) / max}%` }} />
            </span>
            <span className="eflow-value">{formatW(f.w)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Balance now: Pin {formatW(pS)} = PL {formatW(pL)} + PC {formatW(pC)} + PR {formatW(pR)} + losses {formatW(loss)}. Per period the source delivers {formatSI(m.energyPerPeriod, 'J')}; L and C end each
        period with the energy they started with, so on average Pin = Pout + losses.
      </p>
    </section>
  )
}

const ROLE: Record<ConverterKind, Record<string, string>> = {
  buck: {
    vin: 'Supplies energy — but only while Q1 is ON. Its current is a pulse train.',
    q1: 'Controlled switch (e.g. MOSFET). The PWM gate sets its state; it chops Vin into pulses.',
    d1: 'Freewheeling diode: gives the inductor current a path when Q1 is OFF.',
    sw: 'Where Q1, D1 and L meet. Its voltage is a pulse train between Vin and about 0 V.',
  },
  boost: {
    vin: 'In series with L: it supplies the inductor current all the time (a continuous input current in CCM).',
    q1: 'Shorts the switch node to ground while ON, so the inductor charges from Vin.',
    d1: 'Delivers the inductor current to the output while Q1 is OFF; blocks the output from Q1 while ON.',
    sw: 'Where L, Q1 and D1 meet: ~0 V while Q1 is ON, ~Vout while D1 conducts.',
  },
  'buck-boost': {
    vin: 'Supplies energy only while Q1 is ON (pulsed input current).',
    q1: 'Connects the inductor across Vin while ON.',
    d1: 'While Q1 is OFF it lets the inductor pull current out of the output — making Vout negative.',
    sw: 'Where Q1, L and D1 meet: +Vin while Q1 is ON, ≈ Vout (negative) while D1 conducts.',
  },
}

/** Component inspector: role, present state and stress of the clicked part. */
export function dcdcInspect(part: string, st: DcdcState, m: DcdcMeasurements, r: ConverterResult): InspectInfo {
  const p = r.params
  const role = ROLE[st.kind]
  switch (part) {
    case 'vin':
      return { title: 'Input source Vin', role: role.vin, rows: [['Voltage', formatV(p.vin, false)], ['Current now', formatA(st.pin / p.vin)], ['Average input power', formatW(m.pinAvg)]] }
    case 'q1':
      return {
        title: 'Switch Q1',
        role: role.q1,
        rows: [
          ['State now', st.qOn ? 'ON (gate HIGH)' : 'OFF (gate LOW)'],
          ['Current now', formatA(st.iq)],
          ['Voltage now', formatV(st.vq)],
          ['Peak / RMS current', `${formatA(m.iqPeak)} / ${formatA(m.iqRms)}`],
          ['Max blocking voltage', formatV(m.vqMax, false)],
          ['Conduction loss', formatW(m.losses.q)],
        ],
      }
    case 'd1':
      return {
        title: 'Diode D1',
        role: role.d1,
        rows: [
          ['State now', st.dOn ? 'ON (forward)' : 'OFF'],
          ['Current now', formatA(st.id)],
          ['Voltage now (anode − cathode)', formatV(st.vd)],
          ['Average / RMS current', `${formatA(m.idAvg)} / ${formatA(m.idRms)}`],
          ['Max reverse voltage', formatV(m.vdReverseMax, false)],
          ['Conduction loss', formatW(m.losses.d)],
        ],
      }
    case 'l':
      return {
        title: 'Inductor L',
        role: 'Stores energy while Q1 is ON and releases it while Q1 is OFF; its current cannot jump.',
        rows: [
          ['Inductance', formatSI(p.l, 'H')],
          ['Current now', formatA(st.il)],
          ['Voltage now', formatV(st.vl)],
          ['diL/dt now', formatSlopeA(st.dildt)],
          ['Average / peak current', `${formatA(m.ilAvg)} / ${formatA(m.ilMax)}`],
          ['Ripple ΔiL', formatA(m.ilPP)],
          ['Stored energy now / max', `${formatSI(st.el, 'J')} / ${formatSI(m.elMax, 'J')}`],
          ['DCR loss', formatW(m.losses.dcr)],
        ],
      }
    case 'c':
      return {
        title: 'Capacitor C',
        role: 'Holds the output voltage; supplies the load whenever the converter does not.',
        rows: [
          ['Capacitance', formatSI(p.c, 'F')],
          ['Voltage now', formatV(st.vc)],
          ['Current now', formatA(st.ic, true)],
          ['RMS ripple current', formatA(m.icRms)],
          ['Output ripple ΔVout', formatSI(m.voutPP, 'V')],
          ['ESR loss', formatW(m.losses.esr)],
        ],
      }
    case 'r':
      return { title: 'Load R', role: 'Consumes the output power.', rows: [['Resistance', formatSI(p.r, 'Ω')], ['Current now', formatA(st.io, true)], ['Average power', formatW(m.poutAvg)]] }
    case 'sw':
      return { title: 'Switch node', role: role.sw, rows: [['Voltage now', formatV(st.vsw)]] }
    default:
      return { title: 'Output node', role: 'The DC output.', rows: [['Voltage now', formatV(st.vout)], ['Average', formatV(m.voutAvg)], ['Ripple (p-p)', formatSI(m.voutPP, 'V')]] }
  }
}

const DERIVATION: Record<ConverterKind, { title: string; steps: string[]; checkLabel: string }> = {
  buck: {
    title: 'Ideal buck, CCM: Vout = D·Vin',
    steps: [
      'ON (D·Ts): vL = Vin − Vout. OFF ((1 − D)·Ts): vL = −Vout (ideal diode).',
      '(Vin − Vout)·D·Ts − Vout·(1 − D)·Ts = 0  ⇒  Vout = D·Vin',
      'Ripple: ΔiL = (Vin − Vout)·D/(L·fs); the capacitor takes the triangle\'s AC part: ΔVout = ΔiL/(8·C·fs).',
    ],
    checkLabel: 'average vsw (should equal Vout)',
  },
  boost: {
    title: 'Ideal boost, CCM: Vout = Vin/(1 − D)',
    steps: [
      'ON (D·Ts): Q1 grounds the switch node, vL = Vin. OFF ((1 − D)·Ts): D1 conducts, vL = Vin − Vout.',
      'Vin·D·Ts + (Vin − Vout)·(1 − D)·Ts = 0  ⇒  Vout = Vin/(1 − D)',
      'Power balance: Vin·IL = Vout²/R ⇒ IL = Iout/(1 − D). While Q1 is ON, C alone feeds the load: ΔVout = Iout·D/(C·fs).',
    ],
    checkLabel: 'average vsw (should equal Vin)',
  },
  'buck-boost': {
    title: 'Ideal inverting buck-boost, CCM: Vout = −D·Vin/(1 − D)',
    steps: [
      'L sits between the switch node and ground, so vL = vsw. ON: vL = Vin. OFF: D1 conducts, vL = Vout (negative).',
      'Vin·D·Ts + Vout·(1 − D)·Ts = 0  ⇒  Vout = −D·Vin/(1 − D)',
      'IL = |Iout|/(1 − D); while Q1 is ON, C alone feeds the load: ΔVout = |Iout|·D/(C·fs).',
    ],
    checkLabel: 'average vsw (should be 0)',
  },
}

export function DcdcTheory({ r, m }: { r: ConverterResult; m: DcdcMeasurements }) {
  const p = r.params
  const kind = p.kind
  const vs = voltSecondFromSim(r)
  const b = dcdcBoundary(p)
  const d = DERIVATION[kind]
  return (
    <>
      <h3>{d.title}</h3>
      <ul className="theory-notes">
        <li>Assumptions: ideal switch and diode (no voltage drop), lossless L and C, continuous inductor current (CCM), periodic steady state.</li>
      </ul>
      <details open>
        <summary>Derivation: volt-second balance on the inductor</summary>
        <ol className="derivation">
          <li>
            The inductor obeys <span className="mono">vL = L·diL/dt</span>. In steady state iL returns to its starting value every period, so <span className="mono">∫₀ᵀˢ vL dt = L·[iL(Ts) − iL(0)] = 0</span>.
          </li>
          {d.steps.map((s) => (
            <li key={s}>
              <span className="mono">{s}</span>
            </li>
          ))}
          <li>
            CCM needs the inductor current to stay above zero: <span className="mono">{b.lCritFormula}</span> — here {formatSI(b.lCrit, 'H')}. Below it a third (idle) interval appears and the ratio depends on the
            load: K = 2L/(R·Ts) = {b.K.toFixed(3)}, Kcrit = {b.Kcrit.toFixed(3)}.
          </li>
        </ol>
      </details>
      <h3>Check it on the simulation</h3>
      <dl className="dc-kv dc-kv--wide">
        <div>
          <dt>average vL (should be 0)</dt>
          <dd>{formatV(vs.vlAvg)}</dd>
        </div>
        <div>
          <dt>{d.checkLabel}</dt>
          <dd>{formatV(vs.vswAvg)}</dd>
        </div>
        <div>
          <dt>average Vout</dt>
          <dd>{formatV(vs.voutAvg)}</dd>
        </div>
        <div>
          <dt>Ideal CCM law (THEORY)</dt>
          <dd>{formatV(idealCcmM(kind, p.duty) * p.vin)}</dd>
        </div>
      </dl>
      <p className="small">
        The simulation never uses these laws: it integrates <span className="mono">L·diL/dt = vL</span> and <span className="mono">C·dvC/dt = iC</span>, and the diode state follows from the solved voltages and
        currents ({m.mode}).
      </p>
      <h3>Exact solution (used to validate the solver)</h3>
      <p className="small">
        The same piecewise-linear equations are solved analytically per interval with the matrix exponential <span className="mono">x(t) = e^(A·t)·x₀ + ∫e^(A·τ)dτ·b</span>, and the periodic steady state is the fixed
        point of the period map (DCM: the diode-off instant by root finding). It includes Ron, Vf, DCR and ESR.
      </p>
    </>
  )
}

/** D = 10 % … 90 % in 5 % steps (the same 17 values the loop `d += 0.05` rounded to). */
const SWEEP_DUTIES = Array.from({ length: 17 }, (_, i) => Math.round((0.1 + 0.05 * i) * 100) / 100)

/** Vout/Vin against D: the simulation (dots) and the ideal CCM / DCM relations (line). */
export function DcdcSweep({ p }: { p: ConverterParams & { kind?: ConverterKind } }) {
  const kind = (p as { kind?: ConverterKind }).kind ?? 'buck'
  const [run, setRun] = useState(false)
  const [pts, setPts] = useState<Array<{ d: number; sim: number; mode: string; exact: number }>>([])
  // keyed on the parameter VALUES: callers pass a fresh object each render
  const key = JSON.stringify(p)
  // One duty point per task, so the page stays responsive and the dots appear as they are computed.
  useEffect(() => {
    if (!run) return
    const model = dcdcModel(kind)
    const out: Array<{ d: number; sim: number; mode: string; exact: number }> = []
    let i = 0
    let timer = 0
    setPts([])
    const step = () => {
      const pp = { ...p, duty: SWEEP_DUTIES[i], view: 'steady' as const, periods: 1 }
      const r = simulateCircuit(model, pp)
      const mm = measureDcdc(r)
      out.push({ d: pp.duty, sim: mm.voutAvg / p.vin, mode: mm.mode, exact: dcdcExact(r.params).metrics.voutAvg / p.vin })
      setPts([...out])
      if (++i < SWEEP_DUTIES.length) timer = window.setTimeout(step, 0)
    }
    timer = window.setTimeout(step, 0)
    return () => window.clearTimeout(timer)
  }, [run, key, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const ideal = (d: number) => {
    const K = (2 * p.l * p.fs) / p.r
    const b = dcdcBoundary({ l: p.l, r: p.r, ts: 1 / p.fs, duty: d, fs: p.fs, kind })
    return b.ccm ? idealCcmM(kind, d) : idealDcmM(kind, d, K)
  }
  const line = Array.from({ length: 81 }, (_, k) => 0.1 + (k * 0.8) / 80)
  const vals = [...line.map((d) => Math.abs(ideal(d))), ...pts.map((q) => Math.abs(q.sim))]
  const yMax = Math.max(1, Math.min(12, Math.ceil(Math.max(...vals) * 1.05)))
  const W = 520
  const H = 260
  const L = 46
  const B = 34
  const x = (d: number) => L + ((d - 0.1) / 0.8) * (W - L - 12)
  const y = (v: number) => H - B - (Math.min(Math.abs(v), yMax) / yMax) * (H - B - 12)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)
  return (
    <div className="dc-sweep">
      <p className="small">
        Simulates the converter at D = 10 % … 90 % with the present L, C, R and fs, and plots the simulated |Vout|/Vin (dots) on the textbook curve (line: the CCM law, the DCM relation below the boundary).
      </p>
      {!run ? (
        <button className="run-btn" onClick={() => setRun(true)}>
          Run duty sweep (17 simulations)
        </button>
      ) : (
        <>
        {pts.length < SWEEP_DUTIES.length && (
          <p className="small muted" role="status">
            Simulating D = {Math.round(SWEEP_DUTIES[pts.length] * 100)} % … ({pts.length} / {SWEEP_DUTIES.length})
          </p>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="sweep-chart" role="img" aria-label="Output to input ratio versus duty ratio: simulation and theory">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - 12} y1={y(v)} y2={y(v)} className="grid" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" className="tick">
                {v.toFixed(v < 10 ? 2 : 1)}
              </text>
            </g>
          ))}
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((d) => (
            <text key={d} x={x(d)} y={H - B + 16} textAnchor="middle" className="tick">
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
                D = {(q.d * 100).toFixed(0)} %: simulated Vout/Vin = {q.sim.toFixed(4)} ({q.mode}); exact theory {q.exact.toFixed(4)}; ideal textbook {ideal(q.d).toFixed(4)}
              </title>
            </circle>
          ))}
          <g transform={`translate(${L + 10}, 18)`}>
            <line x1={0} x2={22} y1={0} y2={0} className="sweep-theory" />
            <text x={28} y={4} className="tick">
              THEORY (ideal)
            </text>
            <circle cx={140} cy={0} r={5} className="sweep-dot sweep-dot--ccm" />
            <text x={150} y={4} className="tick">
              SIMULATION, CCM
            </text>
            <circle cx={270} cy={0} r={5} className="sweep-dot sweep-dot--dcm" />
            <text x={280} y={4} className="tick">
              SIMULATION, DCM
            </text>
          </g>
        </svg>
        </>
      )}
      {pts.length > 0 && (
        <div className="table-wrap">
          <table className="ba-table">
            <thead>
              <tr>
                <th>D</th>
                <th className="num">SIMULATION Vout/Vin</th>
                <th className="num">Exact theory</th>
                <th className="num">Ideal textbook</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((q) => (
                <tr key={q.d}>
                  <th>{(q.d * 100).toFixed(0)} %</th>
                  <td className="num">{q.sim.toFixed(4)}</td>
                  <td className="num">{q.exact.toFixed(4)}</td>
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

export function DcdcStress({ m }: { m: DcdcMeasurements }) {
  const rows: Array<[string, string]> = [
    ['Switch: peak / RMS current', `${formatSI(m.iqPeak, 'A')} / ${formatSI(m.iqRms, 'A')}`],
    ['Switch: max blocking voltage', formatSI(m.vqMax, 'V')],
    ['Diode: average / RMS current', `${formatSI(m.idAvg, 'A')} / ${formatSI(m.idRms, 'A')}`],
    ['Diode: max reverse voltage', formatSI(m.vdReverseMax, 'V')],
    ['Capacitor RMS current', formatSI(m.icRms, 'A')],
    ['Losses Q1 · D1 · DCR · ESR', `${formatSI(m.losses.q, 'W')} · ${formatSI(m.losses.d, 'W')} · ${formatSI(m.losses.dcr, 'W')} · ${formatSI(m.losses.esr, 'W')}`],
    ['Measured D · fs', `${(m.dutyMeasured * 100).toFixed(2)} % · ${formatSI(m.fsMeasured, 'Hz')}`],
  ]
  return (
    <>
      <p className="small">Device and component stress over the measurement window (SIMULATION).</p>
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
