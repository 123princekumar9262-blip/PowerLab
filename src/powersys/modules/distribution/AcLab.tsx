import { useMemo, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { abs, arg, C, deg, mul, scale } from '../../engine/complex.ts'
import { fx, ph } from '../../ui/format.ts'
import { Callout, Readouts, Seg, Slider, useTutorContext } from '../../ui/kit.tsx'
import { Phasors, type Phasor } from '../../ui/Phasors.tsx'
import { defaultAc, solveAc, superpositionVA, type AcDistributor, type AcLoad, type AcOk, type PfRef } from './acdist.ts'
import { tiny } from './shared.tsx'
import { pctWords } from './words.ts'

const phDeg = (c: { re: number; im: number }, d = 2, a = 2) => ph(abs(c), deg(arg(c)), d, a)
export const REF_LABEL: Record<PfRef, string> = { receiving: '(a) pf referred to V_B', own: '(b) pf referred to each load’s own voltage' }

/** Explore: an AC distributor with two loads — the two ways a load's power factor can be referred. */
export function AcLab() {
  const level = useLevel()
  const [d, setD] = useState<AcDistributor>(defaultAc)
  const [show, setShow] = useState<PfRef>('own')
  const a = useMemo(() => solveAc(d, 'receiving'), [d])
  const b = useMemo(() => solveAc(d, 'own'), [d])
  const setLoad = (id: string, patch: Partial<AcLoad>) => setD((s) => ({ ...s, loads: s.loads.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const [lc, ld] = d.loads
  const okBoth = a.ok && b.ok
  const err = !a.ok ? a.message : !b.ok ? b.message : null
  const cur = show === 'own' ? b : a
  const edited = JSON.stringify(d) !== JSON.stringify(defaultAc())

  useTutorContext(() => {
    const loads = d.loads.map((l) => `${l.id}: ${l.I} A at ${l.x} m, pf ${l.pf} ${l.lag ? 'lagging' : 'leading'}`).join('; ')
    const res = okBoth && a.ok && b.ok ? `V_A (a) = ${phDeg(a.VA)} V, V_A (b) = ${phDeg(b.VA)} V, difference ${fx(abs(b.VA) - abs(a.VA), 3)} V.` : `Invalid: ${err}`
    return `Explore — single-phase AC distributor fed at A, far end B at ${d.VB} V (reference). Loop impedance ${d.R} + j${d.X} Ω/km, length ${d.L} m. Loads ${loads}. ${res}`
  })

  const gap = a.ok && b.ok ? abs(b.VA) - abs(a.VA) : 0
  return (
    <div className="ps-stack">
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <section className="ps-card" aria-label="Phasor diagram">
            <div className="ps-toolbar">
              <Seg
                label="Convention drawn"
                value={show}
                onChange={setShow}
                options={[
                  { id: 'receiving', label: '(a) referred to V_B' },
                  { id: 'own', label: '(b) referred to own voltages' },
                ]}
              />
              <span className="small muted">To scale; V_B is the reference (0°). Left: only the drop V_A − V_B, magnified.</span>
            </div>
            {cur.ok ? (
              <AcPhasors d={d} r={cur} />
            ) : (
              <Callout tone="bad" title="Check the inputs">
                {err}
              </Callout>
            )}
          </section>
          {a.ok && b.ok && <CompareTable d={d} a={a} b={b} />}
        </div>
        <aside className="ps-stack">
          <section className="ps-card" aria-labelledby="ds-ac-h">
            <h3 id="ds-ac-h">Two loads on an AC distributor</h3>
            <p className="small muted">
              Single-phase, {fx(d.L, 0)} m from A to B; load {lc.id} at {fx(lc.x, 0)} m, load {ld.id} at the far end B. The voltage at B is known: {fx(d.VB, 0)} V. Illustrative values.
            </p>
            <Slider label={`Power factor of ${lc.id} (lagging)`} value={lc.pf} min={0.5} max={1} step={0.01} decimals={2} onChange={(v) => setLoad(lc.id, { pf: v })} />
            <Slider label={`Power factor of ${ld.id} (lagging)`} value={ld.pf} min={0.5} max={1} step={0.01} decimals={2} onChange={(v) => setLoad(ld.id, { pf: v })} />
            {a.ok && b.ok && (
              <Readouts
                label="Sending-end voltage"
                items={[
                  { label: '|V_A|, convention (a)', value: fx(abs(a.VA), 3), unit: 'V', note: `drop ${fx(a.drop, 2)} V` },
                  { label: '|V_A|, convention (b)', value: fx(abs(b.VA), 3), unit: 'V', note: `drop ${fx(b.drop, 2)} V` },
                  {
                    label: '(b) − (a)',
                    value: `${gap >= 0 ? '+' : '−'}${fx(Math.abs(gap), 3)}`,
                    unit: 'V',
                    note: `${pctWords(Math.abs(gap) / Math.max(1e-12, Math.abs(a.drop)))} difference in the drop`,
                  },
                ]}
              />
            )}
            <button type="button" className="text-btn" disabled={!edited} onClick={() => setD(defaultAc())}>
              Reset
            </button>
          </section>
          <details className="ps-card ps-more" open={level !== 'beginner'}>
            <summary>Currents, position, far-end voltage and impedance</summary>
            <Slider label={`${lc.id} current`} value={lc.I} min={0} max={200} step={5} unit="A" decimals={0} onChange={(v) => setLoad(lc.id, { I: v })} />
            <Slider label={`${lc.id} distance from A`} value={lc.x} min={0} max={d.L} step={10} unit="m" decimals={0} onChange={(v) => setLoad(lc.id, { x: v })} />
            <Slider label={`${ld.id} current`} value={ld.I} min={0} max={200} step={5} unit="A" decimals={0} onChange={(v) => setLoad(ld.id, { I: v })} />
            <Slider label="V_B (far end, reference)" value={d.VB} min={200} max={250} step={1} unit="V" decimals={0} onChange={(v) => setD((s) => ({ ...s, VB: v }))} />
            <Slider label="Loop resistance R" value={d.R} min={0.05} max={1} step={0.01} unit="Ω/km" decimals={2} onChange={(v) => setD((s) => ({ ...s, R: v }))} hint="Go and return together." />
            <Slider label="Loop reactance X" value={d.X} min={0} max={1} step={0.01} unit="Ω/km" decimals={2} onChange={(v) => setD((s) => ({ ...s, X: v }))} />
          </details>
        </aside>
      </div>
      {cur.ok && (
        <details className="ps-card ps-more" open={level === 'engineer'}>
          <summary>Working back from B, step by step — convention {show === 'own' ? '(b)' : '(a)'}</summary>
          <BackSweep d={d} r={cur} />
        </details>
      )}
    </div>
  )
}

export function AcPhasors({ d, r }: { d: AcDistributor; r: AcOk }) {
  const z = C(d.R / 1000, d.X / 1000)
  const n = r.xs.length
  // the drop V_A − V_B, built tip-to-tail from each section's I·Z (magnified: V_B itself is left out)
  const drops: Phasor[] = []
  const parts: Array<{ color: string; text: string }> = []
  const colors = ['var(--ps-b)', 'var(--ps-a)', 'var(--ps-sel)', 'var(--ps-lv)', 'var(--ps-ehv)']
  let at = C(0, 0)
  for (let k = n - 1; k > 0; k--) {
    const dv = mul(r.Isec[k - 1], scale(z, r.xs[k] - r.xs[k - 1]))
    if (abs(dv) < 1e-9) continue
    const color = colors[parts.length % colors.length]
    drops.push({ id: `dz${k}`, label: '', re: dv.re, im: dv.im, color, from: at, thin: true })
    parts.push({ color, text: `${fx(r.xs[k - 1], 0)}–${fx(r.xs[k], 0)} m: ${phDeg(dv, 2, 1)} V` })
    at = C(at.re + dv.re, at.im + dv.im)
  }
  drops.push({ id: 'dva', label: 'V_A − V_B', re: r.VA.re - d.VB, im: r.VA.im, color: 'var(--ps-mv)' })
  const imax = Math.max(1e-9, ...d.loads.map((l) => l.I))
  const currents: Phasor[] = [
    { id: 'vbref', label: 'V_B dir.', re: imax, im: 0, color: 'var(--ps-c)', dashed: true },
    ...d.loads.map((l, j) => ({ id: `i${l.id}`, label: `I_${l.id}`, re: r.Iload[j].re, im: r.Iload[j].im, color: j ? 'var(--ps-a)' : 'var(--ps-sel)' })),
  ]
  return (
    <div className="ds-row-2">
      <div>
        <Phasors label="The drop V_A − V_B, built from each section's I·Z (V_B itself left out so the drops can be seen)" phasors={drops} size={300} unit="V" />
        <ul className="ds-partlist" aria-label="Section drops I·Z">
          {parts.map((p) => (
            <li key={p.text}>
              <span className="ds-key" style={{ background: p.color }} aria-hidden="true" />
              {p.text}
            </li>
          ))}
        </ul>
      </div>
      <Phasors label="Load currents against the V_B direction" phasors={currents} size={300} unit="A" />
    </div>
  )
}

function CompareTable({ d, a, b }: { d: AcDistributor; a: AcOk; b: AcOk }) {
  const rows: Array<[string, string, string]> = [
    ...d.loads.map((l, j) => [`Current of load ${l.id} [A]`, phDeg(a.Iload[j]), phDeg(b.Iload[j])] as [string, string, string]),
    ...d.loads
      .filter((l) => l.x !== d.L && l.x !== 0)
      .map((l) => {
        const k = a.xs.indexOf(l.x)
        return [`Voltage at ${l.id} [V]`, phDeg(a.V[k], 3), phDeg(b.V[k], 3)] as [string, string, string]
      }),
    ['Sending voltage V_A [V]', phDeg(a.VA, 3), phDeg(b.VA, 3)],
    ['|V_A| − |V_B| [V]', fx(a.drop, 3), fx(b.drop, 3)],
  ]
  const sa = superpositionVA(d, a)
  const sb = superpositionVA(d, b)
  const err = Math.max(abs(C(sa.re - a.VA.re, sa.im - a.VA.im)), abs(C(sb.re - b.VA.re, sb.im - b.VA.im)))
  // the angle of each intermediate load's own voltage from V_B, in words with the number
  const nodeAng = d.loads
    .filter((l) => l.x !== d.L)
    .map((l) => {
      const ang = deg(arg(b.V[b.xs.indexOf(l.x)]))
      return Math.abs(ang) < 0.005 ? `V_${l.id} is in phase with V_B` : `V_${l.id} ${ang > 0 ? 'leads' : 'lags'} V_B by ${fx(Math.abs(ang), 2)}°`
    })
  return (
    <section className="ps-card" aria-label="The two conventions compared">
      <div className="ds-table-wrap">
        <table className="ps-table ds-table">
          <caption className="sr-only">Convention (a) against convention (b)</caption>
          <thead>
            <tr>
              <th scope="col">Quantity (V_B = reference)</th>
              <th scope="col">(a) pf referred to V_B</th>
              <th scope="col">(b) pf referred to own voltage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([q, x, y]) => (
              <tr key={q}>
                <td>{q}</td>
                <td>{x}</td>
                <td>{y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        In (a) every current is drawn from the same reference, V_B. In (b) each current is measured from its OWN node voltage
        {nodeAng.length ? ` (${nodeAng.join('; ')})` : ''}, so those currents are turned by the same angles. Check by superposition (V_B + Σ I_k·z·x_k): agrees to {tiny(err, 3)} V.
      </p>
    </section>
  )
}

function BackSweep({ d, r }: { d: AcDistributor; r: AcOk }) {
  const n = r.xs.length
  const rows = []
  for (let k = n - 1; k >= 0; k--) {
    const here = d.loads.filter((l) => l.x === r.xs[k])
    rows.push(
      <tr key={k}>
        <td>{fx(r.xs[k], 0)} m</td>
        <td>{phDeg(r.V[k], 3)}</td>
        <td>{here.length ? here.map((l) => `${l.id}: ${phDeg(r.Iload[d.loads.indexOf(l)])}`).join(', ') : '—'}</td>
        <td>{k > 0 ? phDeg(r.Isec[k - 1]) : '—'}</td>
        <td>{k > 0 ? `${phDeg(mul(r.Isec[k - 1], scale(C(d.R / 1000, d.X / 1000), r.xs[k] - r.xs[k - 1])), 3)}` : '—'}</td>
      </tr>,
    )
  }
  return (
    <>
      <p className="small muted">
        Start at B with V_B = {fx(d.VB, 0)}∠0° V. At each point add the loads there (their angle {r.ref === 'own' ? 'measured from THIS point’s voltage' : 'measured from V_B'}), then step towards A:
        V_previous = V + I_section × z × length, z = {fx(d.R, 2)} + j{fx(d.X, 2)} Ω/km of loop.
      </p>
      <div className="ds-table-wrap">
        <table className="ps-table ds-table">
          <caption className="sr-only">Back-sweep from B to A</caption>
          <thead>
            <tr>
              <th scope="col">Point</th>
              <th scope="col">Voltage [V]</th>
              <th scope="col">Load currents here [A]</th>
              <th scope="col">Current in the section towards A [A]</th>
              <th scope="col">Its drop I·Z [V]</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </>
  )
}
