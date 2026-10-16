import { useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { fx } from '../../ui/format.ts'
import { Callout, Readouts, Seg, Slider, useTutorContext } from '../../ui/kit.tsx'
import { RHO } from './distributor.ts'
import { DEFAULT_KELVIN, K_ILLUSTRATIVE, kelvinArea, kelvinCost, kelvinNumeric, validateKelvin, type KelvinInput } from './kelvin.ts'
import { rupees, tiny } from './shared.tsx'
import { KelvinChart } from './visuals.tsx'
import { pctWords } from './words.ts'

/** Explore: the most economical conductor size (Kelvin's law), and what the law leaves out. */
export function KelvinLab() {
  const level = useLevel()
  const [q, setQ] = useState<KelvinInput>(DEFAULT_KELVIN)
  const [mat, setMat] = useState<'aluminium' | 'copper'>('aluminium')
  const [len, setLen] = useState(2)
  const [vll, setVll] = useState(11000)
  const [limit, setLimit] = useState(5)
  const bad = validateKelvin(q)
  const a = bad ? NaN : kelvinArea(q)
  const c = bad ? null : kelvinCost(q, a)
  const num = bad || level !== 'engineer' ? null : kelvinNumeric(q)
  const set = (p: Partial<KelvinInput>) => setQ((s) => ({ ...s, ...p }))
  // voltage drop of a three-phase line of this size (resistance only, unity power factor — a lower bound on the drop)
  const Rkm = (q.rho * 1000) / a
  const drop = (Math.sqrt(3) * q.I * Rkm * len) / vll
  const aDrop = (Math.sqrt(3) * q.I * q.rho * 1000 * len) / ((limit / 100) * vll)
  useTutorContext(
    () =>
      `Explore — Kelvin's law. I = ${q.I} A for ${q.T} h/yr, energy ₹${q.c}/kWh, ρ = ${q.rho} Ω·mm²/m (${mat}), conductor cost ₹${q.k} per mm² per km, interest + depreciation ${fx(q.p * 100, 1)} %/yr. ${
        c ? `Economical area a* = ${fx(a, 1)} mm²; annual capital charge = energy-loss cost = ₹${fx(c.capital, 0)} per km per conductor.` : `Invalid: ${bad}`
      }`,
  )
  const edited = JSON.stringify(q) !== JSON.stringify(DEFAULT_KELVIN) || mat !== 'aluminium'
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-label="Annual cost against the cross-section">
          {c ? (
            <KelvinChart q={q} />
          ) : (
            <Callout tone="bad" title="Check the inputs">
              {bad}
            </Callout>
          )}
          <p className="small muted">Per km of route and per conductor. Illustrative costs — not from a catalogue or a utility.</p>
        </section>
        {c && (
          <Callout title="What Kelvin’s law leaves out">
            <p>
              It balances only two costs. It ignores the <b>voltage drop</b>, the conductor’s <b>current rating</b> (how hot it gets), <b>corona</b> on high-voltage lines and mechanical strength, and
              it assumes the cost of the conductor rises in proportion to its area. The size actually installed must satisfy all of these; Kelvin’s size is only the starting point.
            </p>
          </Callout>
        )}
        {c && level !== 'beginner' && (
          <section className="ps-card" aria-label="Voltage-drop check">
            <p className="ds-h">Does the economical size meet the voltage-drop limit?</p>
            <div className="ds-row-2">
              <div>
                <Slider label="Route length" value={len} min={0.5} max={15} step={0.5} unit="km" decimals={1} onChange={setLen} />
                <Slider label="Allowed drop (your choice)" value={limit} min={1} max={10} step={0.5} unit="%" decimals={1} onChange={setLimit} />
                <Seg
                  label="Line voltage"
                  value={String(vll)}
                  onChange={(v) => setVll(Number(v))}
                  options={[
                    { id: '400', label: '400 V' },
                    { id: '11000', label: '11 kV' },
                    { id: '33000', label: '33 kV' },
                  ]}
                />
              </div>
              <Readouts
                items={[
                  { label: 'Drop with a*', value: fx(drop * 100, 2), unit: '%', note: `√3·I·R·ℓ / V_LL — ${pctWords(drop)} drop` },
                  { label: 'Area the drop limit needs', value: fx(aDrop, 1), unit: 'mm²', note: `for ≤ ${fx(limit, 1)} %` },
                  {
                    label: 'Governs',
                    value: aDrop > a ? 'voltage drop' : 'Kelvin’s law',
                    tone: aDrop > a ? 'warn' : 'good',
                    note: aDrop > a ? `needs ${fx(aDrop / a, 2)} × the economical area` : `a* is ${fx(a / aDrop, 2)} × what the drop needs`,
                  },
                ]}
              />
            </div>
            <p className="small muted">
              Three-phase line, resistance only at unity power factor (reactance and power factor would add to the drop). The current rating must also be checked from the manufacturer’s tables (not
              modelled).
            </p>
          </section>
        )}
        {num && c && (
          <section className="ps-card" aria-label="Numerical check">
            <p className="small muted">
              Check by golden-section search of the total cost over ln a ({num.iterations} steps): a = {fx(num.a, 4)} mm² against the formula’s {fx(a, 4)} mm² (difference{' '}
              {tiny(Math.abs(num.a - a), 3)} mm²).
            </p>
          </section>
        )}
      </div>
      <aside className="ps-stack">
        <section className="ps-card" aria-labelledby="ds-kv-h">
          <h3 id="ds-kv-h">The most economical cross-section</h3>
          <Slider label="Current I (equivalent, flowing T h per year)" value={q.I} min={10} max={500} step={5} unit="A" decimals={0} onChange={(v) => set({ I: v })} />
          <Slider label="Energy price c" value={q.c} min={2} max={15} step={0.5} unit="₹/kWh" decimals={1} onChange={(v) => set({ c: v })} />
          <Slider label="Conductor cost k" value={q.k} min={300} max={6000} step={50} unit="₹/(mm²·km)" decimals={0} onChange={(v) => set({ k: v })} />
          {c && (
            <Readouts
              label="Kelvin's law"
              items={[
                { label: 'Economical area a*', value: fx(a, 1), unit: 'mm²', note: `I·√(ρTc/(pk)); current density ${fx(q.I / a, 2)} A/mm²` },
                { label: 'Annual capital charge', value: rupees(c.capital), note: 'per km per conductor' },
                { label: 'Annual cost of losses', value: rupees(c.energy), note: 'equal to the capital charge at a*' },
              ]}
            />
          )}
          <button
            type="button"
            className="text-btn"
            disabled={!edited}
            onClick={() => {
              setQ(DEFAULT_KELVIN)
              setMat('aluminium')
            }}
          >
            Reset
          </button>
        </section>
        <details className="ps-card ps-more" open={level !== 'beginner'}>
          <summary>Hours, interest and the conductor material</summary>
          <Slider
            label="Hours per year T"
            value={q.T}
            min={500}
            max={8760}
            step={10}
            unit="h/yr"
            decimals={0}
            onChange={(v) => set({ T: v })}
            hint="I flowing for T hours gives the same annual I²·t as the real, varying load."
          />
          <Slider label="Interest + depreciation p" value={q.p * 100} min={3} max={25} step={0.5} unit="%/yr" decimals={1} onChange={(v) => set({ p: v / 100 })} />
          <Seg
            label="Conductor material"
            value={mat}
            full
            onChange={(m) => {
              setMat(m)
              set({ rho: RHO[m], k: K_ILLUSTRATIVE[m] })
            }}
            options={[
              { id: 'aluminium', label: `Aluminium (ρ ${RHO.aluminium})` },
              { id: 'copper', label: `Copper (ρ ${RHO.copper})` },
            ]}
          />
          <p className="small muted">
            ρ in Ω·mm²/m at 20 °C. Changing the material changes both ρ and the cost per mm²: k is set to an illustrative ₹{K_ILLUSTRATIVE[mat]} per mm² per km for {mat} (adjust it above).
          </p>
        </details>
      </aside>
    </div>
  )
}
