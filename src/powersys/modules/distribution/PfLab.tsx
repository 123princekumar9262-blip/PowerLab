import { useEffect, useMemo, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Callout, Readouts, Seg, Slider, Toggle, useTutorContext } from '../../ui/kit.tsx'
import { annualCost, DEFAULT_FEEDER, DEFAULT_PF, DEFAULT_TARIFF, economicPf, pfCorrection, solveFeeder, type Connection, type Feeder, type PfInput, type Tariff } from './pf.ts'
import { MODULE, rupees } from './shared.tsx'
import { PfCostChart, PowerTriangle } from './visuals.tsx'
import { changeWords } from './words.ts'

/** Explore: correct a factory's power factor — the bank, its capacitance, the current, the bill and the feeder. */
export function PfLab() {
  const level = useLevel()
  const progress = usePsProgress()
  const [inp, setInp] = useState<PfInput>(DEFAULT_PF)
  const [conn, setConn] = useState<Connection>('star')
  const [zoom, setZoom] = useState(false)
  const [t, setT] = useState<Tariff>(DEFAULT_TARIFF)
  const [fd, setFd] = useState<Feeder>(DEFAULT_FEEDER)
  const [seen, setSeen] = useState({ corrected: false, star: true, delta: false })
  const r = useMemo(() => pfCorrection(inp), [inp])
  const ok = r.ok ? r : null
  const econ = economicPf(inp.pf1, t)
  const costNow = ok && !inp.lead2 ? annualCost(inp.P, inp.pf1, inp.pf2, t) : null
  const costEcon = annualCost(inp.P, inp.pf1, econ.pf, t)
  const costNone = annualCost(inp.P, inp.pf1, inp.pf1, t)
  const fBefore = useMemo(() => (ok ? solveFeeder({ ...fd, VratedLL: inp.VLL }, inp.P, ok.Q1, 0) : null), [ok, fd, inp])
  const fAfter = useMemo(() => (ok ? solveFeeder({ ...fd, VratedLL: inp.VLL }, inp.P, ok.Q1, ok.Qc) : null), [ok, fd, inp])
  const set = (patch: Partial<PfInput>) => setInp((s) => ({ ...s, ...patch }))

  useEffect(() => {
    setSeen((s) => {
      const n = { ...s, [conn]: true, corrected: s.corrected || (!!ok && !inp.lead2 && inp.pf2 >= 0.95 && inp.pf2 > inp.pf1) }
      return n.corrected === s.corrected && n.star === s.star && n.delta === s.delta ? s : n
    })
  }, [conn, ok, inp])
  useEffect(() => {
    if (seen.corrected && seen.star && seen.delta) completeActivity(MODULE, 'pf')
  }, [seen])

  useTutorContext(() => {
    const res = ok
      ? `Q1 = ${fx(ok.Q1, 2)} kVAr, Q2 = ${fx(ok.Q2, 2)} kVAr, bank Qc = ${fx(ok.Qc, 2)} kVAr, C per phase star ${fx(ok.Cstar, 1)} µF, delta ${fx(ok.Cdelta, 1)} µF, line current ${fx(ok.I1, 1)} → ${fx(ok.I2, 1)} A, S ${fx(ok.S1, 1)} → ${fx(ok.S2, 1)} kVA. Economical pf for x = ₹${t.x}/kVA/yr, y = ₹${t.y}/kVAr/yr: ${fx(econ.pf, 4)}.`
      : `Invalid: ${!r.ok ? r.message : ''}`
    return `Explore — power-factor correction of a ${inp.P} kW three-phase load at ${inp.VLL} V, ${inp.f} Hz, pf ${inp.pf1} lagging → ${inp.pf2} ${inp.lead2 ? 'leading' : 'lagging'}, ${conn} bank. ${res}`
  })

  const edited = JSON.stringify(inp) !== JSON.stringify(DEFAULT_PF) || JSON.stringify(t) !== JSON.stringify(DEFAULT_TARIFF) || JSON.stringify(fd) !== JSON.stringify(DEFAULT_FEEDER) || conn !== 'star'
  const over = ok && inp.lead2 && inp.pf2 < 1 ? pfCorrection({ ...inp, pf2: 1, lead2: false }) : null
  const unity = over && over.ok ? over : null
  const fUnity = useMemo(() => (ok && unity ? solveFeeder({ ...fd, VratedLL: inp.VLL }, inp.P, ok.Q1, unity.Qc) : null), [ok, unity, fd, inp])
  return (
    <div className="ps-stack">
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <section className="ps-card" aria-label="Power triangle">
            {ok ? (
              <PowerTriangle P={inp.P} r={ok} />
            ) : (
              <Callout tone="bad" title="This target cannot be reached with capacitors">
                <p>{!r.ok && r.message}</p>
                <p>No bank is sized until the target is possible.</p>
              </Callout>
            )}
          </section>
          {ok && unity && (
            <Callout tone="warn" title={`Over-corrected: ${fx(inp.pf2, 2)} leading`}>
              <p>
                The bank now supplies more reactive power than the load uses ({fx(ok.Qc, 1)} kVAr against {fx(ok.Q1, 1)} kVAr): the surplus {fx(-ok.Q2, 1)} kVAr flows back into the supply. Compared
                with stopping at unity, the bank is {fx(ok.Qc - unity.Qc, 1)} kVAr larger and the line current {changeWords(unity.I2, ok.I2)} ({fx(unity.I2, 1)} → {fx(ok.I2, 1)} A)
                {fAfter && fAfter.ok && fUnity && fUnity.ok ? `; on the feeder below, the voltage at the load is ${fx(fAfter.VrLL, 1)} V against ${fx(fUnity.VrLL, 1)} V at unity` : ''}. Under a kVA
                tariff both the kVA charge and the capacitor cost are higher than at unity, so over-correction never pays.
              </p>
            </Callout>
          )}
          {ok && level !== 'beginner' && (
            <section className="ps-card" aria-label="Annual cost against the final power factor">
              <p className="ds-h">The bill: kVA charge + capacitors (illustrative tariff)</p>
              <Toggle label="Zoom on the total" checked={zoom} onChange={setZoom} />
              <PfCostChart P={inp.P} pf1={inp.pf1} t={t} econ={econ.pf} target={inp.lead2 ? null : inp.pf2} zoom={zoom} />
              <p className="small muted">
                {econ.kind === 'interior'
                  ? `Cheapest at cos φ₂ = √(1 − (y/x)²) = √(1 − ${fx(econ.ratio, 3)}²) = ${fx(econ.pf, 4)} lagging: ${rupees(costEcon.total)} a year, against ${rupees(costNone.total)} with no correction${costNow ? ` and ${rupees(costNow.total)} at your target` : ''}.`
                  : econ.kind === 'unity'
                    ? 'The capacitors cost nothing here (y = 0), so correcting all the way to unity is cheapest.'
                    : `y/x = ${fx(econ.ratio, 3)} is not below sin φ₁ = ${fx(Math.sqrt(1 - inp.pf1 ** 2), 3)}: each kVAr of capacitors costs more than the kVA it saves, so no correction pays.`}
              </p>
            </section>
          )}
          {ok && level !== 'beginner' && fBefore && fAfter && (
            <section className="ps-card" aria-label="On a feeder">
              <p className="ds-h">On a feeder: source {fx(fd.VsLL, 0)} V held fixed, R + jX per phase (illustrative)</p>
              {fBefore.ok && fAfter.ok ? (
                <>
                  <Readouts
                    items={[
                      { label: 'Voltage at the load', value: fx(fAfter.VrLL, 1), unit: 'V', note: `was ${fx(fBefore.VrLL, 1)} V: ${changeWords(fBefore.VrLL, fAfter.VrLL, 2)}` },
                      { label: 'Feeder current', value: fx(fAfter.I, 1), unit: 'A', note: `was ${fx(fBefore.I, 1)} A: ${changeWords(fBefore.I, fAfter.I)}` },
                      { label: 'Copper loss in the feeder', value: fx(fAfter.loss, 2), unit: 'kW', note: `was ${fx(fBefore.loss, 2)} kW: ${changeWords(fBefore.loss, fAfter.loss)}` },
                      { label: 'Bank output at that voltage', value: fx(fAfter.Qbank, 1), unit: 'kVAr', note: `rated ${fx(ok.Qc, 1)} kVAr at ${fx(inp.VLL, 0)} V; ∝ V²` },
                    ]}
                  />
                  <p className="small muted">
                    Solved exactly: |V_s|²·V_r² = (V_r² + RP + XQ)² + (XP − RQ)² per phase, repeated because the bank’s kVAr follows V_r² ({fAfter.iterations} passes). The load is constant P + jQ.
                  </p>
                </>
              ) : (
                <Callout tone="bad">{!fBefore.ok ? fBefore.message : !fAfter.ok ? fAfter.message : ''}</Callout>
              )}
            </section>
          )}
        </div>
        <aside className="ps-stack">
          <section className="ps-card" aria-labelledby="ds-pf-h">
            <h3 id="ds-pf-h">Correct the power factor</h3>
            <p className="small muted">
              A balanced three-phase load at {fx(inp.VLL, 0)} V, {fx(inp.f, 0)} Hz (illustrative).
            </p>
            <Slider label="Real power P" value={inp.P} min={20} max={1000} step={10} unit="kW" decimals={0} onChange={(v) => set({ P: v })} />
            <Slider label="Initial power factor (lagging)" value={inp.pf1} min={0.5} max={0.99} step={0.01} decimals={2} onChange={(v) => set({ pf1: v })} />
            <Slider label={`Target power factor (${inp.lead2 ? 'leading' : 'lagging'})`} value={inp.pf2} min={0.5} max={1} step={0.005} decimals={3} onChange={(v) => set({ pf2: v })} />
            {ok && (
              <Readouts
                label="Capacitor bank"
                items={[
                  { label: 'Capacitor bank Q_c', value: fx(ok.Qc, 1), unit: 'kVAr', note: `P(tan φ₁ − tan φ₂) = ${fx(inp.P, 0)} × (${fx(Math.tan(ok.phi1), 3)} − ${fx(Math.tan(ok.phi2), 3)})` },
                  {
                    label: `C per phase, ${conn}`,
                    value: fx(conn === 'star' ? ok.Cstar : ok.Cdelta, 1),
                    unit: 'µF',
                    note: `each rated ${fx(conn === 'star' ? ok.VcapStar : ok.VcapDelta, 0)} V; ${conn === 'star' ? 'delta' : 'star'} would need ${fx(conn === 'star' ? ok.Cdelta : ok.Cstar, 1)} µF`,
                  },
                  { label: 'Line current', value: `${fx(ok.I1, 1)} → ${fx(ok.I2, 1)}`, unit: 'A', note: `${changeWords(ok.I1, ok.I2)} (at ${fx(inp.VLL, 0)} V)` },
                  { label: 'Apparent power', value: `${fx(ok.S1, 1)} → ${fx(ok.S2, 1)}`, unit: 'kVA', note: changeWords(ok.S1, ok.S2) },
                ]}
              />
            )}
            <Seg
              label="Capacitor connection"
              value={conn}
              full
              onChange={setConn}
              options={[
                { id: 'star', label: 'Star bank' },
                { id: 'delta', label: 'Delta bank' },
              ]}
            />
            <button
              type="button"
              className="text-btn"
              disabled={!edited}
              onClick={() => {
                setInp(DEFAULT_PF)
                setT(DEFAULT_TARIFF)
                setFd(DEFAULT_FEEDER)
                setConn('star')
              }}
            >
              Reset
            </button>
          </section>
          <details className="ps-card ps-more" open={level !== 'beginner'}>
            <summary>Tariff, over-correction, supply and feeder</summary>
            <p className="small muted">Illustrative values — not any utility’s tariff.</p>
            <Slider label="x: kVA demand charge" value={t.x} min={600} max={6000} step={60} unit="₹/kVA/yr" decimals={0} onChange={(v) => setT((s) => ({ ...s, x: v }))} />
            <Slider label="y: capacitor cost" value={t.y} min={0} max={3000} step={20} unit="₹/kVAr/yr" decimals={0} onChange={(v) => setT((s) => ({ ...s, y: v }))} />
            <p className="small">
              Economical power factor: <b>{fx(econ.pf, 4)}</b> lagging{econ.kind === 'none' ? ' (no correction pays)' : econ.kind === 'unity' ? ' (capacitors free)' : ''}.{' '}
              <button type="button" className="text-btn" disabled={econ.pf < inp.pf1 - 1e-12} onClick={() => set({ pf2: Math.round(econ.pf * 1e6) / 1e6, lead2: false })}>
                Use it as the target
              </button>
            </p>
            <Seg
              label="Target power factor is"
              value={inp.lead2 ? 'lead' : 'lag'}
              onChange={(v) => set({ lead2: v === 'lead' })}
              options={[
                { id: 'lag', label: 'Lagging' },
                { id: 'lead', label: 'Leading (over-corrected)' },
              ]}
            />
            <Seg
              label="Supply"
              value={`${inp.VLL}-${inp.f}`}
              onChange={(v) => {
                const [V, f] = v.split('-').map(Number)
                set({ VLL: V, f })
                setFd((s) => ({ ...s, VsLL: V === 400 ? 415 : V * 1.0375 }))
              }}
              options={[
                { id: '400-50', label: '400 V, 50 Hz' },
                { id: '11000-50', label: '11 kV, 50 Hz' },
                { id: '480-60', label: '480 V, 60 Hz' },
              ]}
            />
            <Slider
              label="Feeder R per phase"
              value={fd.R}
              min={0}
              max={inp.VLL > 1000 ? 5 : 0.1}
              step={inp.VLL > 1000 ? 0.05 : 0.001}
              unit="Ω"
              decimals={3}
              onChange={(v) => setFd((s) => ({ ...s, R: v }))}
            />
            <Slider
              label="Feeder X per phase"
              value={fd.X}
              min={0}
              max={inp.VLL > 1000 ? 5 : 0.1}
              step={inp.VLL > 1000 ? 0.05 : 0.001}
              unit="Ω"
              decimals={3}
              onChange={(v) => setFd((s) => ({ ...s, X: v }))}
            />
          </details>
          <section className="ps-card">
            <p className="eyebrow">Activity</p>
            <ul className="ds-task">
              <li className={seen.corrected ? 'is-done' : ''}>{seen.corrected ? '✓' : '○'} Correct the load to 0.95 lagging or better</li>
              <li className={seen.delta && seen.star ? 'is-done' : ''}>{seen.delta && seen.star ? '✓' : '○'} Compare a star bank with a delta bank</li>
            </ul>
            {isDone(progress, MODULE, 'pf') && <p className="small muted">✓ Activity complete.</p>}
          </section>
        </aside>
      </div>
    </div>
  )
}
