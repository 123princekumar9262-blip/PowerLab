import { useMemo } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { abs, add } from '../../engine/complex.ts'
import { fx } from '../../ui/format.ts'
import { Phasors } from '../../ui/Phasors.tsx'
import { Plot } from '../../ui/Plot.tsx'
import { Callout, Readouts, Seg, Slider, Toggle, useTutorContext } from '../../ui/kit.tsx'
import { DUTY_BREAKERS, peakFactor, rCritical, sourceDuty, TEXTBOOK_DOUBLING, trvAt, trvIssues, trvMetrics, trvRk4, xrForDoubling, type TrvParams } from './breaker.ts'
import { biasIssues, biasThreshold, CT_HV, CT_LV, DIFF_LOCATIONS, differential, I_RATED_HV, I_RATED_LV, T2_MVA, worstPhase, type BiasSettings, type DiffResult } from './differential.ts'
import {
  capacitiveCurrent,
  compareMethods,
  earthFault,
  earthIssues,
  GEN_KV,
  METHODS,
  petersenClassic,
  petersenExact,
  statorCoverage,
  statorFault,
  statorIssues,
  X0G_OHM,
  type EarthParams,
} from './earthing.ts'
import { TYPE_OPTIONS, typeName } from './shared.tsx'
import { DIFFSTATE0, STATORSTATE0, TRV0, type DiffState, type StatorState, type TrvState } from './state.ts'
import { EARTH0 } from './earthing.ts'
import { amps, timesWords } from './words.ts'

const PH = ['a', 'b', 'c'] as const

// ── Differential ───────────────────────────────────────────────────────────────────────────────────────────────

export function DifferentialSection({ st, set }: { st: DiffState; set(s: DiffState): void }) {
  const level = useLevel()
  const issues = biasIssues(st.s.bias)
  const d = useMemo(() => differential(st.loc, st.type, st.s), [st])
  const k = worstPhase(d)
  const loc = DIFF_LOCATIONS.find((x) => x.id === st.loc)!
  const s = st.s
  const setS = (p: Partial<typeof s>) => set({ ...st, s: { ...s, ...p } })
  const setB = (p: Partial<BiasSettings>) => setS({ bias: { ...s.bias, ...p } })
  const verdict = issues.length ? null : d.trip
  const expected = loc.internal
  useTutorContext(
    () =>
      `Explore — transformer differential (T2, ${T2_MVA} MVA 220/33 kV, YNd${s.clock}, relay set for Yd${s.relayClock}, zero-sequence filter ${s.zsFilter ? 'on' : 'off'}, tap ${s.tapPct} %, LV CT error ${s.ctErrPct} %). Fault ${loc.text}, ${typeName(st.type)}. Phase ${PH[k]}: I_op ${fx(d.iop[k], 3)} pu, I_res ${fx(d.ires[k], 3)} pu, threshold ${fx(d.thr[k], 3)} pu → ${d.trip ? 'trip' : 'restrain'}.`,
  )
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-diff-h">
          <div className="pr-card-head">
            <h3 id="pr-diff-h">Differential protection of transformer T2</h3>
            <button type="button" className="text-btn" onClick={() => set(DIFFSTATE0)} disabled={st === DIFFSTATE0}>
              Reset
            </button>
          </div>
          <p className="small">
            What flows into the zone between the two sets of current transformers must flow out again — unless there is a fault inside. The relay adds the two currents (referred to a common base); a
            healthy transformer leaves almost nothing.
          </p>
          <div className="ps-cols-2">
            <div>
              <p className="ps-slider-label">
                <span>Where is the fault?</span>
              </p>
              <Seg label="Fault location" full value={st.loc} onChange={(l) => set({ ...st, loc: l })} options={DIFF_LOCATIONS.map((x) => ({ id: x.id, label: x.label }))} />
            </div>
            <div>
              <p className="ps-slider-label">
                <span>Fault type</span>
              </p>
              <Seg label="Fault type" full value={st.type} onChange={(type) => set({ ...st, type })} options={TYPE_OPTIONS} />
            </div>
          </div>
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>Vector group and errors</summary>
            <div className="ps-cols-2">
              <div>
                <p className="ps-slider-label">
                  <span>Transformer vector group</span>
                </p>
                <Seg
                  label="Transformer vector group"
                  full
                  value={String(s.clock)}
                  onChange={(v) => setS({ clock: Number(v) as 1 | 11 })}
                  options={[
                    { id: '11', label: 'YNd11' },
                    { id: '1', label: 'YNd1' },
                  ]}
                />
              </div>
              <div>
                <p className="ps-slider-label">
                  <span>Relay compensates for</span>
                </p>
                <Seg
                  label="Relay vector-group setting"
                  full
                  value={String(s.relayClock)}
                  onChange={(v) => setS({ relayClock: Number(v) as 1 | 11 })}
                  options={[
                    { id: '11', label: 'Yd11' },
                    { id: '1', label: 'Yd1' },
                  ]}
                />
              </div>
            </div>
            <Toggle label="Remove zero sequence from the star-side currents" checked={s.zsFilter} onChange={(zsFilter) => setS({ zsFilter })} />
            <div className="ps-cols-2">
              <Slider
                label="Tap position away from the matched ratio"
                value={s.tapPct}
                min={-15}
                max={15}
                step={0.5}
                unit="%"
                decimals={1}
                onChange={(tapPct) => setS({ tapPct })}
                hint="on-load tap changer"
              />
              <Slider
                label="LV current-transformer error"
                value={s.ctErrPct}
                min={-10}
                max={10}
                step={0.5}
                unit="%"
                decimals={1}
                onChange={(ctErrPct) => setS({ ctErrPct })}
                hint="ratio error (in phase)"
              />
            </div>
          </details>
          {level === 'engineer' && (
            <details className="ps-more" open>
              <summary>Bias characteristic settings</summary>
              <div className="ps-cols-2">
                <Slider label="Minimum operate I_s1" value={s.bias.is1} min={0} max={1} step={0.05} unit="pu" decimals={2} onChange={(is1) => setB({ is1 })} />
                <Slider label="Knee I_s2" value={s.bias.is2} min={0.5} max={5} step={0.1} unit="pu" decimals={1} onChange={(is2) => setB({ is2 })} />
                <Slider label="Slope 1 k₁" value={s.bias.k1 * 100} min={0} max={60} step={1} unit="%" decimals={0} onChange={(v) => setB({ k1: v / 100 })} />
                <Slider label="Slope 2 k₂" value={s.bias.k2 * 100} min={20} max={150} step={5} unit="%" decimals={0} onChange={(v) => setB({ k2: v / 100 })} />
              </div>
            </details>
          )}
        </section>
        <section className="ps-card pr-flush">
          <DiffDiagram d={d} loc={st.loc} clock={s.clock} />
        </section>
        <section className="ps-card" aria-labelledby="pr-bias-h">
          <h3 id="pr-bias-h">The biased (dual-slope) characteristic</h3>
          {issues.length ? (
            <Callout tone="bad" title="These bias settings cannot be used">
              <ul className="pr-issues">
                {issues.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Callout>
          ) : (
            <BiasPlot d={d} bias={s.bias} />
          )}
        </section>
      </div>
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-diffres-h">
          <h3 id="pr-diffres-h">The relay’s decision</h3>
          {verdict === null ? (
            <p className="small">No decision: the settings are not valid.</p>
          ) : (
            <>
              <Readouts
                items={[
                  {
                    label: 'Decision',
                    value: d.trip ? 'Trip' : 'Restrain',
                    tone: d.trip === expected ? 'good' : 'bad',
                    note:
                      d.trip === expected ? (expected ? 'internal fault cleared' : 'stable for an external fault') : expected ? 'fails to trip an internal fault' : 'false trip for an external fault',
                  },
                  { label: `I_op (phase ${PH[k]})`, value: fx(d.iop[k], 3), unit: 'pu', note: `threshold ${fx(d.thr[k], 3)} pu` },
                  { label: `I_res (phase ${PH[k]})`, value: fx(d.ires[k], 3), unit: 'pu', note: `of rated current (${fx(I_RATED_HV, 1)} A / ${fx(I_RATED_LV, 0)} A)` },
                  { label: 'Fault current', value: fx(d.faultKa, 3), unit: 'kA', note: `at the fault (Module 4), ${typeName(st.type)}` },
                ]}
              />
              <p className="small">{diffWhy(d, st)}</p>
            </>
          )}
          {level !== 'beginner' && (
            <div className="table-wrap">
              <table className="ps-table">
                <caption className="sr-only">Per-phase currents</caption>
                <thead>
                  <tr>
                    <th scope="col">Phase</th>
                    <th scope="col">
                      HV <span className="pr-unit">[A]</span>
                    </th>
                    <th scope="col">
                      LV <span className="pr-unit">[A]</span>
                    </th>
                    <th scope="col">
                      I_op <span className="pr-unit">[pu]</span>
                    </th>
                    <th scope="col">
                      I_res <span className="pr-unit">[pu]</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PH.map((p, i) => (
                    <tr key={p} className={d.tripPhases[i] ? 'is-changed' : ''}>
                      <td>{p}</td>
                      <td>{fx(abs(d.hvA[i]), 1)}</td>
                      <td>{fx(abs(d.lvA[i]), 1)}</td>
                      <td>{fx(d.iop[i], 3)}</td>
                      <td>{fx(d.ires[i], 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="ps-more" open={level === 'engineer'}>
            <summary>Exact definitions used</summary>
            <p className="small">
              Currents positive into the zone on both sides, in per unit of rated current (CT {CT_HV}/1 A on 220 kV, {CT_LV}/1 A on 33 kV, matched by the relay). The star side is compensated: zero
              sequence removed (if the filter is on), positive sequence turned by −h·30° (h = the relay’s clock setting) — the digital form of delta-connected CTs. Per phase: I_op = |I_HV + I_LV|,
              I_res = (|I_HV| + |I_LV|)/2. Operate if I_op &gt; max(I_s1, k₁·I_res) up to I_s2, then I_op &gt; max(I_s1, k₁·I_s2 + k₂(I_res − I_s2)). Typical settings, not from a standard. The tap
              changes the HV/LV current ratio; its small effect on the fault level is neglected, as in Module 4. Ideal CTs (no saturation).
            </p>
          </details>
        </section>
        <Callout title="Magnetising inrush (explained, not modelled)">
          <p className="small">
            When a transformer is switched on, its core can draw a large, one-sided magnetising current for a few cycles — current into one side only, so the relay sees it as a differential current.
            Inrush is rich in the second harmonic (typically well above the share in a fault current), so relays block or add restraint when the second harmonic is high. Over-excitation shows up as
            the fifth harmonic in the same way.
          </p>
        </Callout>
        <Callout title="The same principle elsewhere">
          <p className="small">A generator’s stator and a busbar are protected the same way: compare all currents into the zone. Without a vector group or tap, the matching is simpler.</p>
        </Callout>
      </div>
    </div>
  )
}

function diffWhy(d: DiffResult, st: DiffState): string {
  const s = st.s
  const k = worstPhase(d)
  const loc = DIFF_LOCATIONS.find((x) => x.id === st.loc)!
  if (loc.internal)
    return d.trip
      ? `An internal fault: the HV current flows in and nothing comes out at the LV CTs, so I_op ≈ the fault current (${fx(d.iop[k], 2)} pu, ${timesWords(d.iop[k] / Math.max(d.thr[k], 1e-12))} the threshold).`
      : `I_op = ${fx(d.iop[k], 3)} pu does not exceed the threshold ${fx(d.thr[k], 3)} pu — the relay would not clear this internal fault with these settings.`
  if (d.throughPu < 1e-6) return 'No current flows through T2 for this fault (no source on the 33 kV side), so the relay has nothing to measure.'
  if (d.iop[k] < 1e-6 && st.loc === 'ext-hv')
    return `Only zero-sequence current flows in T2 (${fx(d.throughPu, 2)} pu in its earthed star winding): it circulates in the delta and never reaches the LV CTs. The zero-sequence filter removes it from the HV currents, so I_op = 0.`
  if (d.iop[k] < 1e-6) return `A through fault (${fx(d.throughPu, 2)} pu through the transformer): with correct compensation and ideal CTs the two sides cancel exactly — I_op = 0.`
  const reasons: string[] = []
  if (s.relayClock !== s.clock) reasons.push(`the relay compensates for Yd${s.relayClock} but the transformer is YNd${s.clock}: a 60° error, so the two sides no longer cancel`)
  const hvI0 = abs(add(add(d.hvA[0], d.hvA[1]), d.hvA[2])) / 3
  if (!s.zsFilter && hvI0 > 1e-6) reasons.push(`the star side’s zero-sequence current (${fx(hvI0, 1)} A, fed by T2’s earthed neutral) has no partner on the delta side`)
  if (s.tapPct !== 0 || s.ctErrPct !== 0) reasons.push(`the tap (${fx(s.tapPct, 1)} %) and CT error (${fx(s.ctErrPct, 1)} %) leave a spill current`)
  return `Spill I_op = ${fx(d.iop[k], 3)} pu because ${reasons.join('; ') || 'of the errors'}. ${d.trip ? `It exceeds the threshold ${fx(d.thr[k], 3)} pu: a false trip.` : `The bias raises the threshold to ${fx(d.thr[k], 3)} pu at I_res = ${fx(d.ires[k], 2)} pu, so the relay stays stable.`}`
}

function DiffDiagram({ d, loc, clock }: { d: DiffResult; loc: DiffState['loc']; clock: 1 | 11 }) {
  const W = 640
  const H = 170
  const y = 70
  const xF = loc === 'ext-hv' ? 60 : loc === 'int-lv' ? 430 : 590
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="pr-diffsvg"
      role="img"
      aria-label={`Transformer T2 between its current transformers; fault ${DIFF_LOCATIONS.find((x) => x.id === loc)!.text}. Phase a: ${fx(abs(d.hvA[0]), 0)} A on 220 kV, ${fx(abs(d.lvA[0]), 0)} A on 33 kV.`}
    >
      <rect x={150} y={y - 40} width={330} height={80} rx={8} className="pr-zone-box" />
      <text x={315} y={y - 46} className="pr-sld-text" textAnchor="middle">
        protected zone
      </text>
      <line x1={40} x2={40} y1={y - 30} y2={y + 30} className="pr-sld-bus" />
      <text x={40} y={y + 46} className="pr-sld-text" textAnchor="middle">
        220 kV
      </text>
      <line x1={40} x2={270} y1={y} y2={y} className="pr-sld-wire" />
      <circle cx={170} cy={y} r={7} className="pr-sld-ct" />
      <text x={170} y={y - 14} className="pr-sld-text" textAnchor="middle">
        CT {CT_HV}/1
      </text>
      <circle cx={293} cy={y} r={22} className="pr-sld-tx" />
      <circle cx={333} cy={y} r={22} className="pr-sld-tx" />
      <text x={313} y={y - 28} className="pr-sld-text" textAnchor="middle">
        T2 · YNd{clock}
      </text>
      <line x1={355} x2={600} y1={y} y2={y} className="pr-sld-wire" />
      <circle cx={460} cy={y} r={7} className="pr-sld-ct" />
      <text x={460} y={y - 14} className="pr-sld-text" textAnchor="middle">
        CT {CT_LV}/1
      </text>
      <line x1={600} x2={600} y1={y - 30} y2={y + 30} className="pr-sld-bus" />
      <text x={600} y={y + 46} className="pr-sld-text" textAnchor="middle">
        33 kV
      </text>
      <text x={95} y={y + 34} className="pr-sld-state" textAnchor="middle">
        {fx(abs(d.hvA[0]), 0)} A →
      </text>
      <text x={530} y={y + 34} className="pr-sld-state" textAnchor="middle">
        {fx(abs(d.lvA[0]), 0)} A into zone
      </text>
      <rect x={265} y={y + 56} width={100} height={26} rx={4} className="pr-relay-box" />
      <text x={315} y={y + 73} className="pr-sld-text" textAnchor="middle">
        87T: {d.trip ? 'TRIP' : 'restrain'}
      </text>
      <line x1={170} x2={170} y1={y + 7} y2={y + 69} className="pr-sld-sig" />
      <line x1={170} x2={265} y1={y + 69} y2={y + 69} className="pr-sld-sig" />
      <line x1={460} x2={460} y1={y + 7} y2={y + 69} className="pr-sld-sig" />
      <line x1={365} x2={460} y1={y + 69} y2={y + 69} className="pr-sld-sig" />
      <g className="pr-sld-fault">
        <path d={`M${xF} ${y + 2} l-6 12 h8 l-6 14`} />
      </g>
      <text x={W - 6} y={H - 4} className="pr-sld-kind" textAnchor="end">
        phase a currents, primary · calculated
      </text>
    </svg>
  )
}

export function BiasPlot({ d, bias }: { d: DiffResult; bias: BiasSettings }) {
  const W = 560
  const H = 280
  const m = { l: 46, r: 14, t: 12, b: 36 }
  const xMax = Math.max(4, ...d.ires.map((x) => x * 1.25))
  const yMax = Math.max(2, biasThreshold(xMax, bias) * 1.1, ...d.iop.map((x) => x * 1.2))
  const X = (v: number) => m.l + (v / xMax) * (W - m.l - m.r)
  const Y = (v: number) => H - m.b - (v / yMax) * (H - m.t - m.b)
  const pts: string[] = []
  for (let k = 0; k <= 80; k++) {
    const r = (xMax * k) / 80
    pts.push(`${X(r).toFixed(1)},${Y(biasThreshold(r, bias)).toFixed(1)}`)
  }
  const area = `${X(0)},${Y(yMax)} ${pts.join(' ')} ${X(xMax)},${Y(yMax)}`
  const step = xMax > 8 ? 2 : 1
  const ticks = Array.from({ length: Math.floor(xMax / step) + 1 }, (_, i) => i * step)
  const yStep = yMax > 8 ? 2 : yMax > 3 ? 1 : 0.5
  const yt = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep)
  return (
    <figure className="pr-bias">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Bias characteristic; operating points: ${PH.map((p, i) => `phase ${p} restraint ${fx(d.ires[i], 2)}, operate ${fx(d.iop[i], 2)} per unit`).join('; ')}`}
      >
        <polygon points={area} className="pr-bias-op" />
        {ticks.map((v) => (
          <g key={v}>
            <line x1={X(v)} x2={X(v)} y1={m.t} y2={H - m.b} className="pr-grid" />
            <text x={X(v)} y={H - m.b + 14} className="pr-tick" textAnchor="middle">
              {fx(v, 0)}
            </text>
          </g>
        ))}
        {yt.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="pr-grid" />
            <text x={m.l - 5} y={Y(v) + 4} className="pr-tick" textAnchor="end">
              {fx(v, yStep < 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        <polyline points={pts.join(' ')} className="pr-bias-line" />
        <text x={X(xMax * 0.62)} y={Y(yMax * 0.9)} className="pr-bias-text">
          operate
        </text>
        <text x={X(xMax * 0.8)} y={Y(biasThreshold(xMax * 0.8, bias) * 0.4)} className="pr-bias-text">
          restrain
        </text>
        <text x={W - m.r} y={H - 4} className="pr-axis-label" textAnchor="end">
          I_res [pu]
        </text>
        <text x={m.l + 4} y={m.t + 10} className="pr-axis-label">
          I_op [pu]
        </text>
        {PH.map((p, i) => (
          <g key={p} className={`pr-bias-pt pr-bias-pt--${p}`}>
            <circle cx={X(d.ires[i])} cy={Y(d.iop[i])} r={5.5} />
            <text x={X(d.ires[i]) + 8} y={Y(d.iop[i]) - 6 - i * 11} className="pr-pt-text">
              {p}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="small muted">
        Line: the threshold (I_s1 = {fx(bias.is1, 2)} pu, k₁ = {fx(bias.k1 * 100, 0)} % up to {fx(bias.is2, 1)} pu, then k₂ = {fx(bias.k2 * 100, 0)} %). Dots: each phase’s computed operating point.
      </figcaption>
    </figure>
  )
}

// ── Neutral earthing ───────────────────────────────────────────────────────────────────────────────────────────

export function EarthingSection({ p, set }: { p: EarthParams; set(p: EarthParams): void }) {
  const level = useLevel()
  const issues = earthIssues(p)
  const f = useMemo(() => (issues.length ? null : earthFault(p)), [p]) // eslint-disable-line react-hooks/exhaustive-deps
  const table = useMemo(() => compareMethods(p), [p])
  const vph = GEN_KV / Math.sqrt(3)
  const ph = f?.point.vabc ?? null
  const iC = capacitiveCurrent(p.c0uF)
  useTutorContext(
    () =>
      `Explore — neutral earthing of the 13.8 kV generator system (Module 4's G1). Method ${p.method}, Rn ${p.rnOhm} Ω, Xn ${p.xnOhm} Ω, C0 ${p.c0uF} µF/phase ${p.withC ? '' : '(ignored)'}. ${f ? `L-G fault current ${fx(f.iFaultA, 2)} A; healthy phase ${fx(f.vHealthyPu, 3)} pu.` : issues.join(' ')}`,
  )
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-earth-h">
          <div className="pr-card-head">
            <h3 id="pr-earth-h">How the generator’s star point is earthed</h3>
            <button type="button" className="text-btn" onClick={() => set(EARTH0)} disabled={p === EARTH0}>
              Reset
            </button>
          </div>
          <p className="small">
            Module 4’s 13.8 kV system: generator G1 feeds the delta winding of T1, so the generator’s star point is the only place it can be earthed. A line-to-ground fault on phase a at the
            terminals.
          </p>
          <Seg label="Earthing method" value={p.method} onChange={(method) => set({ ...p, method })} options={METHODS} />
          <div className="ps-cols-2 pr-gap-top">
            {p.method === 'resistance' && <Slider label="Neutral resistor R_n" value={p.rnOhm} min={1} max={4000} step={1} unit="Ω" decimals={0} onChange={(rnOhm) => set({ ...p, rnOhm })} />}
            {p.method === 'reactance' && <Slider label="Neutral reactor X_n" value={p.xnOhm} min={0.1} max={20} step={0.1} unit="Ω" decimals={1} onChange={(xnOhm) => set({ ...p, xnOhm })} />}
            {p.method === 'resonant' && (
              <Slider
                label="Coil detuning from resonance"
                value={p.detunePct}
                min={-30}
                max={30}
                step={1}
                unit="%"
                decimals={0}
                onChange={(detunePct) => set({ ...p, detunePct })}
                hint="+ : more reactance than resonance"
              />
            )}
            <Slider
              label="Capacitance to earth C₀"
              value={p.c0uF}
              min={0.05}
              max={3}
              step={0.05}
              unit="µF/phase"
              decimals={2}
              onChange={(c0uF) => set({ ...p, c0uF })}
              hint="winding, bus ducts, T1’s LV winding, surge capacitors (illustrative)"
            />
          </div>
          {level === 'engineer' && <Toggle label="Include C₀ (off: Module 4’s model, which neglects it)" checked={p.withC} onChange={(withC) => set({ ...p, withC })} />}
        </section>
        <section className="ps-card" aria-labelledby="pr-earthcmp-h">
          <h3 id="pr-earthcmp-h">All five methods, same fault, same C₀ = {fx(p.c0uF, 2)} µF</h3>
          <div className="table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Earth-fault current and healthy-phase voltage by earthing method</caption>
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Setting</th>
                  <th scope="col">
                    Fault current <span className="pr-unit">[A]</span>
                  </th>
                  <th scope="col">
                    Healthy phase <span className="pr-unit">[pu]</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.map(({ method, f: g }) => (
                  <tr key={method} className={method === p.method ? 'is-changed' : ''}>
                    <td>{METHODS.find((m) => m.id === method)!.label}</td>
                    <td>
                      {method === 'resistance'
                        ? `${fx(p.rnOhm, 0)} Ω`
                        : method === 'reactance'
                          ? `${fx(p.xnOhm, 1)} Ω`
                          : method === 'resonant'
                            ? `${fx(petersenExact(p.c0uF) * (1 + p.detunePct / 100), 0)} Ω`
                            : '—'}
                    </td>
                    <td>{fx(g.iFaultA, g.iFaultA < 10 ? 2 : 0)}</td>
                    <td>{fx(g.vHealthyPu, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Computed with Module 4’s earth-fault equations; C₀ in parallel with every method. Healthy phase = the higher of V_b, V_c, in pu of the phase voltage {fx(vph, 2)} kV (√3 ={' '}
            {fx(Math.sqrt(3), 3)}).
          </p>
        </section>
      </div>
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-earthres-h">
          <h3 id="pr-earthres-h">During the fault</h3>
          {!f ? (
            <Callout tone="bad" title="Not a valid earthing arrangement — no results">
              <ul className="pr-issues">
                {issues.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Callout>
          ) : (
            <>
              <Readouts
                items={[
                  { label: 'Earth-fault current', value: amps(f.iFaultA), note: `3I₀, phase a to earth` },
                  { label: 'Healthy-phase voltage', value: fx(f.vHealthyPu, 3), unit: 'pu', note: `${fx(f.vHealthyKv, 2)} kV to earth (normally ${fx(vph, 2)} kV)` },
                  { label: 'Neutral connection carries', value: amps(f.iNeutralA), note: `capacitances: ${amps(f.iCapA)}` },
                ]}
              />
              {ph && <p className="small muted">Solid arrows: during the fault (V_a = {fx(f.vPu[0], 3)} pu at the fault). Dashed: before it.</p>}
              {ph && (
                <Phasors
                  label="Phase-to-earth voltages during the fault"
                  size={240}
                  scale={Math.sqrt(3)}
                  unit="pu"
                  phasors={[
                    { id: 'va', label: 'Va', re: ph[0].re, im: ph[0].im, color: 'var(--ps-a)' },
                    { id: 'vb', label: 'Vb', re: ph[1].re, im: ph[1].im, color: 'var(--ps-b)' },
                    { id: 'vc', label: 'Vc', re: ph[2].re, im: ph[2].im, color: 'var(--ps-c)' },
                    ...[0, -120, 120].map((deg, k) => ({
                      id: `p${k}`,
                      label: k === 0 ? 'before' : '',
                      re: Math.cos((deg * Math.PI) / 180),
                      im: Math.sin((deg * Math.PI) / 180),
                      color: 'var(--text-3)',
                      dashed: true,
                      thin: true,
                    })),
                  ]}
                />
              )}
              <p className="small">{earthWhy(f.iFaultA, f.vHealthyPu, p, iC, Math.max(...table.map((r) => r.f.iFaultA)))}</p>
            </>
          )}
        </section>
        {p.method === 'resonant' && f && (
          <section className="ps-card" aria-labelledby="pr-pet-h">
            <h3 id="pr-pet-h">Tuning the Petersen coil</h3>
            <p className="small">
              Classical: X_L = 1/(3ωC₀) = {fx(petersenClassic(p.c0uF), 1)} Ω. Exact, with the generator’s own X₀ = {fx(X0G_OHM, 3)} Ω in series: X_L = (1/(ωC₀) − X₀)/3 = {fx(petersenExact(p.c0uF), 1)}{' '}
              Ω. Set {fx(petersenExact(p.c0uF) * (1 + p.detunePct / 100), 1)} Ω, the coil’s current ({amps(f.iNeutralA)}) {f.iFaultA < 1e-6 ? 'cancels' : 'partly cancels'} the capacitive current (
              {amps(f.iCapA)}): residual {amps(f.iFaultA)}
              {f.iFaultA < 1e-6 ? '' : `, ${fx((f.iFaultA / capacitiveCurrent(p.c0uF)) * 100, 0)} % of the unearthed system’s capacitive current`}.
            </p>
            <p className="small muted">Ideal lossless coil and capacitances. A real coil has losses, so a small resistive residual current always remains.</p>
          </section>
        )}
        <Callout title="Arcing grounds (explained, not modelled)">
          <p className="small">
            In an unearthed system the earth-fault current is the capacitive current of the healthy phases ({amps(iC)} here). Such an arc can go out at a current zero and strike again when the voltage
            recovers; each re-strike can leave charge trapped on the line capacitance and drive the healthy phases to several times their normal voltage. Earthing the neutral — or tuning the
            capacitance out with a Petersen coil so the arc cannot re-strike — prevents it.
          </p>
        </Callout>
      </div>
    </div>
  )
}

function earthWhy(i: number, vh: number, p: EarthParams, iC: number, iMax: number): string {
  switch (p.method) {
    case 'solid':
      return `Solidly earthed: the fault current is limited only by the machine’s own impedances — ${amps(i)}${i >= iMax ? ', the largest of the five methods' : ''} — and the healthy phases stay at ${fx(vh, 3)} pu.`
    case 'resistance':
      return `R_n limits the current to ${amps(i)}; the healthy phases rise to ${fx(vh, 3)} pu of phase voltage (${fx((vh / Math.sqrt(3)) * 100, 1)} % of the line voltage).`
    case 'reactance':
      return `X_n limits the current to ${amps(i)}; healthy phases ${fx(vh, 3)} pu.`
    case 'unearthed':
      return p.withC && p.c0uF > 0
        ? `No earth connection: only the capacitive current flows (${amps(i)}, ≈ 3ωC₀V_ph = ${amps(iC)}), and the healthy phases rise to ${fx(vh, 3)} pu — line voltage to earth.`
        : `No earth path at all in this model: no current, and the healthy phases rise to √3 = ${fx(vh, 3)} pu.`
    case 'resonant':
      return `The coil’s inductive current cancels the capacitive current at the fault: ${amps(i)} remains, so an arc goes out by itself. The healthy phases still rise to ${fx(vh, 3)} pu.`
  }
}

// ── Generator stator earth fault ───────────────────────────────────────────────────────────────────────────────

export function GeneratorSection({ st, set }: { st: StatorState; set(s: StatorState): void }) {
  const level = useLevel()
  const p = st.p
  const issues = statorIssues(p)
  const setP = (q: Partial<typeof p>) => set({ ...st, p: { ...p, ...q } })
  const valid = issues.length === 0
  const f = valid ? statorFault(st.xPct / 100, p) : null
  const cov = valid ? statorCoverage(p) : null
  const seen = f && f.vnPct > p.kPct
  const curves = useMemo(() => {
    if (!valid) return []
    const pts = (rf: number) => Array.from({ length: 101 }, (_, i) => [i, statorFault(i / 100, { ...p, rfOhm: rf }).vnPct] as [number, number])
    return [
      { id: 'rf', label: `R_f ${fx(p.rfOhm, 0)} Ω`, color: 'var(--accent)', points: pts(p.rfOhm) },
      ...(p.rfOhm > 0 ? [{ id: 'r0', label: 'bolted', color: 'var(--text-3)', dashed: true, points: pts(0) }] : []),
    ]
  }, [p, valid])
  useTutorContext(
    () =>
      `Explore — generator stator earth fault, high-resistance earthing Rn ${p.rnOhm} Ω, C0 ${p.c0uF} µF, Rf ${p.rfOhm} Ω, neutral overvoltage relay at ${p.kPct} %. Fault at ${st.xPct} % from the neutral: ${f ? `V_N ${fx(f.vnPct, 2)} %, I_F ${fx(f.iFaultA, 2)} A; protected ${fx(cov!.protectedPct, 1)} % of the winding.` : issues.join(' ')}`,
  )
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-gen-h">
          <div className="pr-card-head">
            <h3 id="pr-gen-h">An earth fault inside the generator’s stator winding</h3>
            <button type="button" className="text-btn" onClick={() => set(STATORSTATE0)} disabled={st === STATORSTATE0}>
              Reset
            </button>
          </div>
          <p className="small">
            Large generators are earthed through a high resistance, so an earth fault in the winding draws little current — {valid ? amps(statorFault(1, p).iFaultA) : '—'} here even at the terminals.
            A relay watches the neutral’s voltage: a fault x of the way from the neutral puts about x·V_ph on it. Faults close to the neutral make too little voltage to see.
          </p>
          <Slider label="Fault position from the neutral" value={st.xPct} min={0} max={100} step={1} unit="%" decimals={0} onChange={(xPct) => set({ ...st, xPct })} hint="100 % = the terminals" />
          <Slider label="Relay setting" value={p.kPct} min={1} max={30} step={1} unit="% of V_ph" decimals={0} onChange={(kPct) => setP({ kPct })} />
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>Earthing and fault resistance</summary>
            <div className="ps-cols-2">
              <Slider label="Neutral resistor R_n (primary)" value={p.rnOhm} min={100} max={10000} step={50} unit="Ω" decimals={0} onChange={(rnOhm) => setP({ rnOhm })} />
              <Slider label="Fault resistance R_f" value={p.rfOhm} min={0} max={5000} step={50} unit="Ω" decimals={0} onChange={(rfOhm) => setP({ rfOhm })} />
              <Slider label="Capacitance to earth C₀" value={p.c0uF} min={0} max={2} step={0.05} unit="µF/phase" decimals={2} onChange={(c0uF) => setP({ c0uF })} />
            </div>
          </details>
        </section>
        {valid && (
          <section className="ps-card">
            <Plot
              series={curves}
              xLabel="Fault position from the neutral [%]"
              yLabel="Neutral voltage [% of V_ph]"
              xDomain={[0, 100]}
              hlines={[{ y: p.kPct, label: `relay setting ${p.kPct} %` }]}
              vlines={[{ x: st.xPct, label: 'fault' }]}
              label="Neutral voltage against the fault position"
            />
          </section>
        )}
      </div>
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-genres-h">
          <h3 id="pr-genres-h">What the relay sees</h3>
          {!valid ? (
            <Callout tone="bad" title="Not a valid scheme — no results">
              <ul className="pr-issues">
                {issues.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Callout>
          ) : (
            <>
              <Readouts
                items={[
                  { label: 'Neutral voltage', value: fx(f!.vnV, 0), unit: 'V', note: `${fx(f!.vnPct, 2)} % of ${fx((GEN_KV * 1000) / Math.sqrt(3), 0)} V` },
                  { label: 'Relay', value: seen ? 'Operates' : 'Does not see it', tone: seen ? 'good' : 'warn', note: `setting ${p.kPct} %` },
                  { label: 'Fault current', value: amps(f!.iFaultA), note: `at ${st.xPct} % of the winding` },
                  { label: 'Winding protected', value: fx(cov!.protectedPct, 1), unit: '%', note: `the ${fx(Math.min(100, cov!.xMin * 100), 1)} % nearest the neutral is not` },
                ]}
              />
              <p className="small">
                {p.rfOhm === 0
                  ? `Bolted: V_N = x·V_ph exactly, so a ${p.kPct} % setting protects ${fx(100 - p.kPct, 0)} % of the winding.`
                  : `With R_f = ${fx(p.rfOhm, 0)} Ω the voltage divides between R_f and the neutral’s impedance: coverage falls from ${fx(100 - p.kPct, 0)} % to ${fx(cov!.protectedPct, 1)} %.`}
              </p>
              <p className="small muted">Assumes the emf is spread evenly along the winding; the winding’s own impedance drop is neglected (the current is a few amperes).</p>
            </>
          )}
        </section>
        <Callout title="Covering the last few per cent (explained, not modelled)">
          <p className="small">
            A generator makes a little third-harmonic voltage between its neutral and its terminals. A fault near the neutral upsets that balance — schemes using it (or injecting a low-frequency
            signal) protect the part the neutral-voltage relay cannot: together, 100 % of the winding.
          </p>
        </Callout>
        <Callout title="Loss of excitation and reverse power (explained, not modelled)">
          <p className="small">
            <b>Loss of excitation:</b> without field current the machine runs as an induction generator, draws reactive power from the system and overheats; an impedance relay at the terminals sees
            the apparent impedance move into an offset circle in the negative-X region and trips. <b>Reverse power:</b> if the prime mover fails, the generator motors, drawing active power; a
            reverse-power relay (set at a small fraction of rating, with a time delay) trips it to protect the turbine.
          </p>
        </Callout>
      </div>
    </div>
  )
}

// ── Breaker: TRV and duty ──────────────────────────────────────────────────────────────────────────────────────

export function trvParams(st: TrvState): TrvParams {
  const d = sourceDuty(st.cb)
  return { lH: d.lH, cF: st.cNf * 1e-9, vPeakV: d.vPeakV, rOhm: st.rOn ? st.rOhm : null }
}

export function BreakerSection({ st, set }: { st: TrvState; set(s: TrvState): void }) {
  const level = useLevel()
  const d = useMemo(() => sourceDuty(st.cb), [st.cb])
  const p = trvParams(st)
  const issues = trvIssues(p)
  const mt = issues.length ? null : trvMetrics(p)
  const xr = d.xOhm / d.rOhm
  const pf = peakFactor(xr)
  const rc = rCritical(d.lH, p.cF)
  const series = useMemo(() => {
    if (!mt) return []
    const T = 1 / mt.f0
    const tEnd = 2.2 * T
    const pts: Array<[number, number]> = []
    for (let k = 0; k <= 300; k++) {
      const t = (tEnd * k) / 300
      pts.push([t * 1e6, trvAt(t, p) / 1000])
    }
    const out = [{ id: 'cf', label: 'closed form', color: 'var(--accent)', points: pts }]
    if (level === 'engineer') {
      const r = trvRk4(p, tEnd, 3000)
      out.push({ id: 'rk', label: 'RK4', color: 'var(--ps-b)', points: r.t.filter((_, i) => i % 15 === 0).map((t, i) => [t * 1e6, r.v[i * 15] / 1000] as [number, number]), dashed: true } as never)
    }
    return out
  }, [mt, p.lH, p.cF, p.rOhm, p.vPeakV, level]) // eslint-disable-line react-hooks/exhaustive-deps
  useTutorContext(
    () =>
      `Explore — breaker ${d.id} (${d.kv} kV): breaking current ${fx(d.iSymKa, 2)} kA (Module 4), L ${fx(d.lH * 1000, 2)} mH, C ${st.cNf} nF${st.rOn ? `, switching resistor ${st.rOhm} Ω` : ''}. ${mt ? `f0 ${fx(mt.f0 / 1000, 2)} kHz, TRV peak ${fx(mt.peakV / 1000, 1)} kV, RRRV ${fx(mt.rrrv / 1e9, 3)} kV/µs.` : issues.join(' ')}`,
  )
  const marginPct = (d.iSymKa / d.ratingKa) * 100
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-cb-h">
          <div className="pr-card-head">
            <h3 id="pr-cb-h">What the breaker must survive</h3>
            <button type="button" className="text-btn" onClick={() => set(TRV0)} disabled={st === TRV0}>
              Reset
            </button>
          </div>
          <p className="small">
            The contacts part and an arc keeps the current flowing. At a current zero the arc goes out — and the voltage across the gap rushes up as the source’s inductance and the capacitance next to
            the breaker ring. If the gap’s strength rises faster than this <b>restriking voltage</b>, the interruption succeeds.
          </p>
          <Seg label="Breaker" value={st.cb} onChange={(cb) => set({ ...st, cb })} options={DUTY_BREAKERS.filter((b) => b.id !== 'CB3').map((b) => ({ id: b.id, label: b.label }))} />
          <div className="ps-cols-2 pr-gap-top">
            <Slider
              label="Capacitance at the breaker C"
              value={st.cNf}
              min={1}
              max={100}
              step={1}
              unit="nF"
              decimals={0}
              onChange={(cNf) => set({ ...st, cNf })}
              hint="bushings, CTs, busbar (illustrative)"
            />
            <div>
              <Toggle label="Resistor across the contacts" checked={st.rOn} onChange={(rOn) => set({ ...st, rOn })} />
              {st.rOn && (
                <Slider
                  label="Switching resistor R"
                  value={st.rOhm}
                  min={50}
                  max={20000}
                  step={50}
                  unit="Ω"
                  decimals={0}
                  onChange={(rOhm) => set({ ...st, rOhm })}
                  hint={`critical: ½√(L/C) = ${fx(rc, 0)} Ω`}
                />
              )}
            </div>
          </div>
        </section>
        {mt && (
          <section className="ps-card">
            <Plot
              series={series}
              xLabel="Time after the current zero [µs]"
              yLabel="Voltage across the contacts [kV]"
              hlines={[{ y: d.vPeakV / 1000, label: 'V_m' }, ...(mt.regime === 'undamped' || mt.regime === 'under' ? [{ y: mt.peakV / 1000, label: `peak ${fx(mt.peakV / 1000, 1)} kV` }] : [])]}
              vlines={[{ x: mt.tRrrv * 1e6, label: 'steepest' }]}
              label="Transient recovery voltage after interruption"
            />
          </section>
        )}
      </div>
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-cbres-h">
          <h3 id="pr-cbres-h">
            {d.id} · {d.what}
          </h3>
          <Readouts
            items={[
              { label: 'Breaking current', value: fx(d.iSymKa, 2), unit: 'kA', note: `symmetrical rms (Module 4) · rating ${d.ratingKa} kA (${fx(marginPct, 0)} % used)` },
              { label: 'Making current', value: fx(Math.SQRT2 * pf * d.iSymKa, 2), unit: 'kA peak', note: `X/R ${fx(xr, 1)} → factor ${fx(pf, 3)}; textbook 2.55 × I: ${fx(2.55 * d.iSymKa, 2)} kA` },
              ...(mt
                ? [
                    { label: 'Natural frequency f₀', value: fx(mt.f0 / 1000, 2), unit: 'kHz', note: `L = ${fx(d.lH * 1000, 2)} mH, C = ${st.cNf} nF` },
                    {
                      label: 'TRV peak',
                      value: fx(mt.peakV / 1000, 1),
                      unit: 'kV',
                      note: mt.regime === 'undamped' ? '2 V_m' : mt.regime === 'under' ? `${fx(mt.peakV / d.vPeakV, 3)} V_m` : 'rises to V_m, no overshoot',
                    },
                    {
                      label: 'RRRV (max dv/dt)',
                      value: fx(mt.rrrv / 1e9, 3),
                      unit: 'kV/µs',
                      note: mt.regime === 'undamped' ? `V_m·ω₀ at ${fx(mt.tRrrv * 1e6, 1)} µs` : `at ${fx(mt.tRrrv * 1e6, 1)} µs`,
                    },
                  ]
                : []),
            ]}
          />
          {!mt && (
            <Callout tone="bad" title="No TRV">
              {issues.join(' ')}
            </Callout>
          )}
          {mt && st.rOn && (
            <p className="small">
              {mt.regime === 'over' || mt.regime === 'critical'
                ? `R = ${fx(st.rOhm, 0)} Ω is at or below critical (${fx(rc, 0)} Ω): no oscillation, and the rate of rise falls to ${fx((mt.rrrv / (d.vPeakV * mt.w0)) * 100, 1)} % of the undamped value.`
                : `R = ${fx(st.rOhm, 0)} Ω is above critical (${fx(rc, 0)} Ω): the voltage still overshoots, but less, and the rate of rise is ${fx((mt.rrrv / (d.vPeakV * mt.w0)) * 100, 1)} % of the undamped value.`}
            </p>
          )}
          <details className="ps-more" open={level === 'engineer'}>
            <summary>Assumptions</summary>
            <p className="small">
              Single-phase equivalent of the source side: L from Module 4’s fault level (L = X₁/ω), C lumped at the breaker; ideal interruption at the current zero; lossless; the source voltage held
              at its peak V_m = √2·{d.kv}/√3 kV = {fx(d.vPeakV / 1000, 1)} kV for these microseconds; arc voltage and post-arc current neglected. The first pole to clear a three-phase fault not
              involving earth sees more (not included). Making current: first peak of a fully offset current, i/(√2 I) = e^(−ωt/(X/R)) − cos ωt maximised; the textbook factor 1.8 (×√2 = 2.55)
              corresponds to X/R ≈ {fx(xrForDoubling(TEXTBOOK_DOUBLING), 1)}.
            </p>
          </details>
        </section>
        <Callout title="Types of breaker (explained, not modelled)">
          <p className="small">
            They differ in what quenches the arc: <b>oil</b> (the arc’s heat makes a hydrogen bubble that cools it), <b>air-blast</b> (compressed air blows it out), <b>SF₆</b> (an electronegative gas
            that captures free electrons — the usual choice at transmission voltages) and <b>vacuum</b> (no gas to ionise; the arc is metal vapour that condenses within microseconds — common at medium
            voltage).
          </p>
        </Callout>
      </div>
    </div>
  )
}
