import { useEffect, useId, useRef, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { Callout, Readouts, Seg, Slider, Toggle, useTutorContext, type ReadoutItem } from '../../ui/kit.tsx'
import {
  beltedByMatrix,
  beltedCharging,
  beltedFromMeasurements,
  compareWithLine,
  criticalLength,
  DEFAULT_CABLE,
  economicSize,
  pct,
  RANGE,
  sheathFor,
  shareWords,
  timesWords,
  type CableInput,
  type CableResult,
} from './calc.ts'
import { CableScene, type CableView } from './CableScene.tsx'
import { CableSection } from './CableSection.tsx'
import { equalPeakState, gradingOutcome, gradingRadii, peaksEqual, type GradingState } from './grading.ts'
import { InvalidCable, layerSpecs, LINE_PARAMS_HREF, MODULE, PartInfo, probeValues, TRANSIENTS_HREF, useCable, type LayerId } from './shared.tsx'
import { EconomicPlot, GradingPlot, StressLegend, StressPlots } from './visuals.tsx'

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
/** 1.0 × 10¹⁴ */
export function sci(x: number, d = 1): string {
  const e = Math.floor(Math.log10(x) + 1e-9)
  const m = x / 10 ** e
  const exp = String(e)
    .split('')
    .map((ch) => (ch === '-' ? '⁻' : SUP[Number(ch)]))
    .join('')
  return `${fx(m, d)} × 10${exp}`
}

const fmtPct = (a: number, b: number, d = 1) => {
  const p = pct(a, b)
  return Math.abs(p) < 0.05 ? 'no change' : `${p > 0 ? '+' : '−'}${fx(Math.abs(p), d)} %`
}

/** What changed between two cables, in words, and why the results move as they do (true for any values). */
function describeChange(a: CableInput, b: CableInput): { what: string; why: string } | null {
  if (a.rMm !== b.rMm)
    return {
      what: `Conductor radius r ${fx(a.rMm, 1)} → ${fx(b.rMm, 1)} mm`,
      why: 'g_max = V/(r·ln(R/r)): r changes both the curvature of the conductor surface and how much insulation is left; C and R_ins change through ln(R/r).',
    }
  if (a.RMm !== b.RMm)
    return {
      what: `Sheath radius R ${fx(a.RMm, 1)} → ${fx(b.RMm, 1)} mm`,
      why: 'Insulation is added or removed at the outside: only ln(R/r) changes, so the stresses, C and R_ins change logarithmically.',
    }
  if (a.vKv !== b.vKv) return { what: `Voltage ${fx(a.vKv, 1)} → ${fx(b.vKv, 1)} kV`, why: 'Stresses and charging current are proportional to V, the losses to V²; C and R_ins do not depend on V.' }
  if (a.epsR !== b.epsR)
    return { what: `ε_r ${fx(a.epsR, 1)} → ${fx(b.epsR, 1)}`, why: 'C, the charging current and the loss are proportional to ε_r; with one dielectric the stress does not depend on ε_r.' }
  if (a.rhoOhmM !== b.rhoOhmM)
    return { what: `Resistivity ${sci(a.rhoOhmM)} → ${sci(b.rhoOhmM)} Ω·m`, why: 'R_ins is proportional to ρ (and the leakage current to 1/ρ); the ac quantities do not change.' }
  if (a.tanDelta !== b.tanDelta) return { what: `tan δ ${fx(a.tanDelta, 4)} → ${fx(b.tanDelta, 4)}`, why: 'Only the dielectric loss changes: P = ωCV² tan δ.' }
  if (a.fHz !== b.fHz) return { what: `Frequency ${a.fHz} → ${b.fHz} Hz`, why: 'Charging current, reactive power and loss are proportional to ω; C, R_ins and the stresses are not.' }
  if (a.lengthKm !== b.lengthKm)
    return { what: `Length ${fx(a.lengthKm, 1)} → ${fx(b.lengthKm, 1)} km`, why: 'Totals scale with length (C, charging current, losses ∝ l; R_ins ∝ 1/l); per-km values and stresses do not change.' }
  return null
}

function LogSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange(v: number): void
  hint?: string
}) {
  const id = useId()
  return (
    <div className="ps-slider cb-logslider">
      <label htmlFor={id} className="ps-slider-label">
        <span>{label}</span>
        <output htmlFor={id} className="ps-slider-value">
          {sci(value)} {unit}
        </output>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={Math.log10(value)} onChange={(e) => onChange(10 ** Number(e.target.value))} aria-valuetext={`${sci(value)} ${unit}`} />
      {hint && <p className="ps-hint">{hint}</p>}
    </div>
  )
}

function NumField({ label, value, onCommit, unit, decimals = 2 }: { label: string; value: number; onCommit(v: number): void; unit: string; decimals?: number }) {
  const [text, setText] = useState(value.toFixed(decimals))
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (!focus) setText(value.toFixed(decimals))
  }, [value, focus, decimals])
  const parse = (t: string) => Number(t.replace(',', '.').replace('−', '-'))
  const bad = text.trim() === '' || !Number.isFinite(parse(text))
  return (
    <label className="cb-num">
      <span className="small">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={`${label} [${unit}]`}
        aria-invalid={bad || undefined}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => {
          setText(e.target.value)
          const v = parse(e.target.value)
          if (e.target.value.trim() !== '' && Number.isFinite(v)) onCommit(v)
        }}
      />
      <span className="ps-unit">{unit}</span>
    </label>
  )
}

export interface ExploreProps {
  cable: CableInput
  setCable(c: CableInput): void
  gPerm: number
  setGPerm(g: number): void
  grading: GradingState
  setGrading(g: GradingState): void
}

export function Explore({ cable, setCable, gPerm, setGPerm, grading, setGrading }: ExploreProps) {
  const level = useLevel()
  const out = useCable(cable)
  const res = out.ok ? out : null
  const progress = usePsProgress()
  const [view, setView] = useState<CableView>('assembled')
  const [hidden, setHidden] = useState<LayerId[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [probeT, setProbeT] = useState(0.3)
  const visited = useRef({ low: false, high: false })
  const [change, setChange] = useState<{ what: string; why: string; before: CableResult | null } | null>(null)

  const update = (patch: Partial<CableInput>) => {
    const next = { ...cable, ...patch }
    const c = describeChange(cable, next)
    if (c) setChange({ ...c, before: res })
    setCable(next)
  }
  const moveProbe = (t: number) => {
    setProbeT(t)
    if (t <= 0.05) visited.current.low = true
    if (t >= 0.95) visited.current.high = true
    if (visited.current.low && visited.current.high) completeActivity(MODULE, 'probe')
  }
  const toggleLayer = (id: LayerId, show: boolean) => setHidden((h) => (show ? h.filter((x) => x !== id) : [...h, id]))
  const c = cable
  const pv = res ? probeValues(res, probeT) : null

  const tour: TourStep[] | undefined = res
    ? [
        {
          title: 'The conductor',
          focus: ['conductor'],
          text: (
            <p>
              A {fx(2 * c.rMm, 0)} mm diameter conductor ({fx(Math.PI * c.rMm * c.rMm, 0)} mm²) at {fx(c.vKv, 1)} kV to the sheath. The charge on it — {fx(res.cFm * c.vKv * 1e9, 2)} µC per metre (q =
              CV) — starts the electric field.
            </p>
          ),
        },
        {
          title: 'The insulation: where the stress is',
          focus: ['insulation'],
          text: (
            <p>
              The same flux D = q/(2πx) crosses every cylinder inside the insulation, so the stress g = V/(x·ln(R/r)) is largest on the smallest circle: {fx(res.gMax, 2)} kV/cm at the conductor,{' '}
              {fx(res.gMin, 2)} kV/cm at the sheath — {fx(res.ratio, 2)} times less (= R/r). The colour shows it.
            </p>
          ),
        },
        {
          title: 'The metallic sheath',
          focus: ['sheath'],
          text: (
            <p>
              Earthed, so the whole {fx(c.vKv, 1)} kV appears across the insulation and nothing outside the sheath is stressed. It returns the charging current — {fx(res.ic, 2)} A per core over{' '}
              {fx(c.lengthKm, 1)} km here.
            </p>
          ),
        },
        {
          title: 'Armour and serving',
          focus: ['armour'],
          text: <p>Mechanical protection only: wires against digging and crushing, a jacket against corrosion. They carry none of the voltage, so they are outside the electrical model.</p>,
        },
        {
          title: 'The probe',
          focus: ['probe'],
          text: (
            <p>
              The white ring is at x = {fx(pv!.xMm, 1)} mm: g = {fx(pv!.g, 2)} kV/cm and V = {fx(pv!.v, 2)} kV there. Move it with the probe slider below — the plots and this panel follow.
            </p>
          ),
        },
      ]
    : undefined

  useTutorContext(
    () =>
      `Explore — underground cable. r ${fx(c.rMm, 1)} mm, R ${fx(c.RMm, 1)} mm, V ${fx(c.vKv, 1)} kV rms core-to-sheath, ε_r ${c.epsR}, ρ ${sci(c.rhoOhmM)} Ω·m, tan δ ${c.tanDelta}, ${c.fHz} Hz, ${c.lengthKm} km. ${
        res
          ? `g_max ${fx(res.gMax, 2)} kV/cm, g_min ${fx(res.gMin, 2)} kV/cm, C ${fx(res.cUfKm, 4)} µF/km, R_ins ${fx(res.rInsMOhmKm, 0)} MΩ·km, Ic ${fx(res.icAKm, 3)} A/km per core, loss ${fx(res.pWKm, 1)} W/km per core. Probe at ${fx(pv!.xMm, 1)} mm: g ${fx(pv!.g, 2)} kV/cm, V ${fx(pv!.v, 2)} kV. Permissible G ${gPerm} kV/cm.`
          : `Invalid: ${out.ok ? '' : out.issues.map((i) => i.message).join(' ')}`
      }`,
  )

  const main: ReadoutItem[] = res
    ? [
        { label: 'Maximum stress g_max', value: fx(res.gMax, 2), unit: 'kV/cm', note: 'at the conductor (x = r)', tone: res.gMax > gPerm ? 'bad' : undefined },
        { label: 'Minimum stress g_min', value: fx(res.gMin, 2), unit: 'kV/cm', note: 'at the sheath (x = R)' },
        { label: 'Capacitance', value: fx(res.cUfKm, 4), unit: 'µF/km', note: `per core; ${fx(res.cUf, 3)} µF for ${fx(c.lengthKm, 1)} km` },
      ]
    : []
  const more: ReadoutItem[] = res
    ? [
        {
          label: 'Insulation resistance',
          value: res.rInsMOhmKm >= 1e5 ? sci(res.rInsMOhmKm, 2) : fx(res.rInsMOhmKm, 0),
          unit: 'MΩ·km',
          note: `${res.rInsMOhm >= 1e5 ? sci(res.rInsMOhm, 2) : fx(res.rInsMOhm, 0)} MΩ for ${fx(c.lengthKm, 1)} km`,
        },
        { label: 'Charging current', value: fx(res.icAKm, 3), unit: 'A/km', note: `per core; ${fx(res.ic, 2)} A over ${fx(c.lengthKm, 1)} km` },
        { label: 'Charging reactive power', value: fx(res.q3Mvar, 3), unit: 'Mvar', note: `three cores, ${fx(c.lengthKm, 1)} km (√3·${fx(c.vKv, 1)} = ${fx(Math.sqrt(3) * c.vKv, 1)} kV line)` },
        { label: 'Dielectric loss', value: fx(res.pWKm, 1), unit: 'W/km', note: `per core; ${fx(res.p3Kw, 2)} kW for three cores over ${fx(c.lengthKm, 1)} km` },
        { label: 'g_max (peak)', value: fx(res.gMaxPeak, 2), unit: 'kV/cm', note: '√2 × rms, for comparison with peak strengths' },
        { label: 'Surge impedance', value: fx(res.zc, 1), unit: 'Ω', note: `wave speed ${fx(res.speed, 0)} m/µs` },
      ]
    : []
  const delta = change && change.before && res

  const fallback = res ? <CableSection res={res} probeT={probeT} gPerm={gPerm} selected={selected} /> : null
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <Seg
            label="3D view"
            value={view}
            onChange={setView}
            options={[
              { id: 'assembled', label: 'Assembled (cut away)' },
              { id: 'stepped', label: 'Stepped (layers exposed)' },
            ]}
          />
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setChange(null)
              setCable(DEFAULT_CABLE)
              setHidden([])
              setProbeT(0.3)
            }}
            disabled={cable === DEFAULT_CABLE && hidden.length === 0}
          >
            Reset
          </button>
        </div>
        <span className="small muted">
          Single-core cable · per core · {c.fHz} Hz · {isDone(progress, MODULE, 'probe') ? '✓ probe moved from conductor to sheath' : 'move the probe from the conductor to the sheath'}
        </span>
      </div>
      <fieldset className="cb-layers">
        <legend>Show layers</legend>
        {layerSpecs(c.rMm, Math.max(c.RMm, c.rMm)).map((l) => (
          <Toggle key={l.id} label={l.name} checked={!hidden.includes(l.id)} onChange={(v) => toggleLayer(l.id, v)} />
        ))}
      </fieldset>
      {res ? (
        <>
          <CableScene
            res={res}
            view={view}
            hidden={hidden}
            probeT={probeT}
            gPerm={gPerm}
            selected={selected}
            onSelect={setSelected}
            fallback={fallback}
            info={(id) => <PartInfo id={id} res={res} probeT={probeT} />}
            tour={tour}
          />
          <StressLegend res={res} gPerm={gPerm} probeT={probeT} />
        </>
      ) : (
        <InvalidCable outcome={out} />
      )}
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <section className="ps-card" aria-labelledby="cb-ctl">
            <h3 id="cb-ctl">The cable</h3>
            <div className="ps-cols-2">
              <div>
                <Slider
                  label="Conductor radius r"
                  value={c.rMm}
                  min={RANGE.rMm[0]}
                  max={RANGE.rMm[1]}
                  step={RANGE.rMm[2]}
                  unit="mm"
                  decimals={1}
                  onChange={(v) => update({ rMm: v })}
                  hint="over the conductor screen"
                />
                <Slider
                  label="Sheath radius R"
                  value={c.RMm}
                  min={RANGE.RMm[0]}
                  max={RANGE.RMm[1]}
                  step={RANGE.RMm[2]}
                  unit="mm"
                  decimals={1}
                  onChange={(v) => update({ RMm: v })}
                  hint="inside of the sheath (under the insulation screen)"
                />
              </div>
              <div>
                <Slider
                  label="Voltage V, core to sheath"
                  value={c.vKv}
                  min={RANGE.vKv[0]}
                  max={RANGE.vKv[1]}
                  step={RANGE.vKv[2]}
                  unit="kV"
                  decimals={1}
                  onChange={(v) => update({ vKv: v })}
                  hint={`rms; the phase voltage of a ${fx(Math.sqrt(3) * c.vKv, 1)} kV three-phase system`}
                />
                {res && (
                  <Slider
                    label="Probe radius x"
                    value={probeValues(res, probeT).xMm}
                    min={c.rMm}
                    max={c.RMm}
                    step={0.1}
                    unit="mm"
                    decimals={1}
                    onChange={(v) => moveProbe((v - c.rMm) / (c.RMm - c.rMm))}
                    hint={`g = ${fx(pv!.g, 2)} kV/cm, V = ${fx(pv!.v, 2)} kV here`}
                  />
                )}
              </div>
            </div>
            <details className="ps-more" open={level !== 'beginner'}>
              <summary>Material, frequency and length</summary>
              <div className="ps-cols-2">
                <div>
                  <Slider
                    label="Relative permittivity ε_r"
                    value={c.epsR}
                    min={RANGE.epsR[0]}
                    max={RANGE.epsR[1]}
                    step={RANGE.epsR[2]}
                    decimals={1}
                    onChange={(v) => update({ epsR: v })}
                    hint="typical: XLPE about 2.3, impregnated paper about 3.5–4"
                  />
                  <LogSlider
                    label="Insulation resistivity ρ"
                    value={c.rhoOhmM}
                    min={RANGE.log10Rho[0]}
                    max={RANGE.log10Rho[1]}
                    step={RANGE.log10Rho[2]}
                    unit="Ω·m"
                    onChange={(v) => update({ rhoOhmM: v })}
                    hint="illustrative range"
                  />
                  <Slider
                    label="Loss factor tan δ"
                    value={c.tanDelta}
                    min={RANGE.tanDelta[0]}
                    max={RANGE.tanDelta[1]}
                    step={RANGE.tanDelta[2]}
                    decimals={4}
                    onChange={(v) => update({ tanDelta: v })}
                  />
                </div>
                <div>
                  <p className="ps-slider-label">
                    <span>Frequency</span>
                  </p>
                  <Seg
                    label="Frequency"
                    full
                    value={String(c.fHz)}
                    onChange={(v) => update({ fHz: Number(v) })}
                    options={[
                      { id: '50', label: '50 Hz' },
                      { id: '60', label: '60 Hz' },
                    ]}
                  />
                  <div style={{ height: 10 }} />
                  <Slider label="Length" value={c.lengthKm} min={RANGE.lengthKm[0]} max={RANGE.lengthKm[1]} step={RANGE.lengthKm[2]} unit="km" decimals={1} onChange={(v) => update({ lengthKm: v })} />
                </div>
              </div>
            </details>
          </section>
        </div>
        <div className="ps-stack">
          {res && (
            <section className="ps-card" aria-labelledby="cb-res">
              <h3 id="cb-res">Results</h3>
              <Readouts label="Main results" items={main} />
              {level === 'beginner' ? (
                <details className="ps-more">
                  <summary>All results</summary>
                  <Readouts label="More results" items={more} />
                </details>
              ) : (
                <Readouts label="More results" items={more} />
              )}
              {level === 'engineer' && (
                <p className="small muted">
                  Leakage through R_ins: {fx(res.leakUa, res.leakUa < 10 ? 3 : 1)} µA per core, a loss of {fx(res.leakW, 4)} W over {fx(c.lengthKm, 1)} km —{' '}
                  {shareWords(res.leakW, res.pWKm * c.lengthKm || 1e-300)} of the dielectric loss of one core. (Its loss factor 1/(ωε₀ε_rρ) = {sci(res.tanCond, 2)}.)
                </p>
              )}
              {delta && change && (
                <div className="cb-change" aria-live="polite">
                  <p className="small">
                    <b>You changed:</b> {change.what}.
                  </p>
                  <p className="small">
                    g_max {fx(change.before!.gMax, 2)} → {fx(res.gMax, 2)} kV/cm ({fmtPct(res.gMax, change.before!.gMax)}), C {fx(change.before!.cUfKm, 4)} → {fx(res.cUfKm, 4)} µF/km (
                    {fmtPct(res.cUfKm, change.before!.cUfKm)}), R_ins {fmtPct(res.rInsMOhm, change.before!.rInsMOhm)}, charging current {fmtPct(res.ic, change.before!.ic)}, loss{' '}
                    {fmtPct(res.p3Kw, change.before!.p3Kw)}.
                  </p>
                  <p className="small muted">Why: {change.why}</p>
                </div>
              )}
              <p className="small muted">V is the rms core-to-sheath voltage; stresses are rms. Per core: three single-core cables make a three-phase circuit.</p>
            </section>
          )}
          {!res && <p className="small muted">Fix the geometry to see the results.</p>}
        </div>
      </div>
      {res && (
        <section className="ps-card" aria-labelledby="cb-across">
          <h3 id="cb-across">Across the insulation</h3>
          <StressPlots res={res} probeT={probeT} gPerm={gPerm} />
          <p className="small muted">
            Calculated: g(x) = V/(x·ln(R/r)) and V(x) = V·ln(R/x)/ln(R/r) for one homogeneous dielectric between a smooth conductor and an earthed sheath (no space charge, end effects ignored). The
            stress falls as 1/x; the potential falls fastest near the conductor.
          </p>
        </section>
      )}
      {res && (
        <details className="ps-card ps-more" open={level !== 'beginner'}>
          <summary>The most economical conductor size</summary>
          <Economic res={res} gPerm={gPerm} setGPerm={setGPerm} />
        </details>
      )}
      {res && (
        <details className="ps-card ps-more" open={level !== 'beginner'}>
          <summary>Grading the insulation</summary>
          <Grading res={res} st={grading} setSt={setGrading} />
        </details>
      )}
      {res && (
        <details className="ps-card ps-more" open={level !== 'beginner'}>
          <summary>Cable against overhead line</summary>
          <VsLine res={res} />
        </details>
      )}
      <details className="ps-card ps-more" open={level === 'engineer'}>
        <summary>Three-core belted cable: capacitance from two measurements</summary>
        <Belted fHz={c.fHz} />
      </details>
    </div>
  )
}

// ── most economical size ──────────────────────────────────────────────────────────────────────────────────────

function Economic({ res, gPerm, setGPerm }: { res: CableResult; gPerm: number; setGPerm(g: number): void }) {
  const v = res.c.vKv
  const opt = economicSize(v, gPerm)
  const rNow = res.r
  const Rneed = sheathFor(rNow, v, gPerm)
  const bigger = rNow > opt.rCm * 1.001
  return (
    <div className="ps-stack">
      <p className="small">
        For a voltage V and a permissible maximum stress G, the sheath must satisfy V/(r·ln(R/r)) ≤ G, i.e. R ≥ r·e^(V/(G·r)). That R is smallest when ln(R/r) = 1: r = V/G and R = e·r.
      </p>
      <Slider
        label="Permissible maximum stress G"
        value={gPerm}
        min={RANGE.gPerm[0]}
        max={RANGE.gPerm[1]}
        step={RANGE.gPerm[2]}
        unit="kV/cm"
        decimals={0}
        onChange={setGPerm}
        hint="rms; a design value you choose (it also sets the top of the colour scale)"
      />
      <Readouts
        items={[
          { label: 'Economical r = V/G', value: fx(opt.rCm * 10, 2), unit: 'mm', note: `d = ${fx(opt.rCm * 20, 2)} mm` },
          { label: 'Smallest R = e·r', value: fx(opt.RCm * 10, 2), unit: 'mm', note: `D = ${fx(opt.RCm * 20, 2)} mm` },
          { label: `R needed for your r`, value: fx(Rneed * 10, 2), unit: 'mm', note: `r = ${fx(rNow * 10, 1)} mm; your R is ${fx(res.c.RMm, 1)} mm` },
        ]}
      />
      <div className="cb-plot-narrow">
        <EconomicPlot vKv={v} gPerm={gPerm} rMm={rNow * 10} />
      </div>
      <p className="small muted">
        {bigger
          ? `Your conductor (r = ${fx(rNow * 10, 1)} mm) is larger than V/G = ${fx(opt.rCm * 10, 2)} mm — as happens when the current rating, not the stress, sets the conductor size. Then keep that conductor and use R = r·e^(V/(G·r)) = ${fx(Rneed * 10, 2)} mm; ln(R/r) = ${fx(Math.log(Rneed / rNow), 3)} is below 1.`
          : `Your conductor (r = ${fx(rNow * 10, 1)} mm) is ${rNow < opt.rCm * 0.999 ? 'smaller than' : 'at'} V/G = ${fx(opt.rCm * 10, 2)} mm; ${rNow < opt.rCm * 0.999 ? `it needs R = ${fx(Rneed * 10, 2)} mm, more than the minimum ${fx(opt.RCm * 10, 2)} mm. A thicker conductor would make the cable smaller overall.` : 'it gives the smallest cable.'}`}{' '}
        {res.c.RMm / 10 >= Rneed
          ? `With R = ${fx(res.c.RMm, 1)} mm your cable keeps g_max (${fx(res.gMax, 2)} kV/cm) within G.`
          : `With R = ${fx(res.c.RMm, 1)} mm your cable’s g_max (${fx(res.gMax, 2)} kV/cm) exceeds G.`}
      </p>
    </div>
  )
}

// ── grading ───────────────────────────────────────────────────────────────────────────────────────────────────

function Grading({ res, st, setSt }: { res: CableResult; st: GradingState; setSt(s: GradingState): void }) {
  const level = useLevel()
  const g = gradingOutcome(res, st)
  const radii = gradingRadii(res, st)
  const [msg, setMsg] = useState<string | null>(null)
  const equal = g.ok && peaksEqual(g)
  const better = g.ok && g.peak < res.gMax
  useEffect(() => {
    if (g.ok && equal && better) completeActivity(MODULE, 'grading')
  }, [g.ok, equal, better])
  const setBound = (i: number, mm: number) => {
    const b = [...st.bounds]
    b[i] = (mm / 10 - res.r) / (res.R - res.r)
    setSt({ ...st, bounds: b })
    setMsg(null)
  }
  const setEps = (i: number, v: number) => {
    const e = [...st.eps]
    e[i] = v
    setSt({ ...st, eps: e })
    setMsg(null)
  }
  const setInter = (i: number, kv: number) => {
    const p = [...st.inter]
    p[i] = kv / res.c.vKv
    setSt({ ...st, inter: p })
    setMsg(null)
  }
  const equalise = () => {
    const r = equalPeakState(res, st)
    if (r.ok) {
      setSt(r.state)
      setMsg(null)
    } else setMsg(r.message)
  }
  return (
    <div className="ps-stack">
      <p className="small">
        One dielectric is stressed hardest at the conductor and lightly at the sheath — most of the insulation is under-used. Grading makes the stress more even, so the same thickness takes a higher
        voltage (or less insulation is needed).
      </p>
      <div className="cb-grading-tools">
        <Seg
          label="Grading method"
          value={st.kind}
          onChange={(k) => (setSt({ ...st, kind: k }), setMsg(null))}
          options={[
            { id: 'capacitance', label: 'Capacitance grading' },
            { id: 'intersheath', label: 'Intersheath grading' },
          ]}
        />
        <Seg
          label="Number of layers"
          value={String(st.n) as '2' | '3'}
          onChange={(n) => (setSt({ ...st, n: Number(n) as 2 | 3 }), setMsg(null))}
          options={[
            { id: '2', label: '2 layers' },
            { id: '3', label: '3 layers' },
          ]}
        />
        <button type="button" className="btn btn--primary ps-btn-sm" onClick={equalise}>
          {st.kind === 'capacitance' ? 'Place boundaries for equal peaks' : 'Set intersheath voltages for equal peaks'}
        </button>
      </div>
      <div className="ps-cols-2">
        <div>
          {radii.slice(1, -1).map((x, i) => (
            <Slider
              key={`b${i}`}
              label={st.kind === 'capacitance' ? `Boundary r${'₁₂'[i]} (layer ${i + 1} | ${i + 2})` : `Intersheath ${i + 1} radius r${'₁₂'[i]}`}
              value={Math.round(x * 100) / 10}
              min={res.c.rMm}
              max={res.c.RMm}
              step={0.1}
              unit="mm"
              decimals={1}
              onChange={(v) => setBound(i, v)}
            />
          ))}
        </div>
        <div>
          {st.kind === 'capacitance'
            ? st.eps
                .slice(0, st.n)
                .map((e, i) => (
                  <Slider
                    key={`e${i}`}
                    label={`ε_r of layer ${i + 1}${i === 0 ? ' (inner)' : i === st.n - 1 ? ' (outer)' : ''}`}
                    value={e}
                    min={1}
                    max={8}
                    step={0.1}
                    decimals={1}
                    onChange={(v) => setEps(i, v)}
                  />
                ))
            : st.inter
                .slice(0, st.n - 1)
                .map((f, i) => (
                  <Slider
                    key={`p${i}`}
                    label={`Intersheath ${i + 1} potential`}
                    value={Math.round(f * res.c.vKv * 10) / 10}
                    min={0}
                    max={res.c.vKv}
                    step={0.1}
                    unit="kV"
                    decimals={1}
                    onChange={(v) => setInter(i, v)}
                  />
                ))}
        </div>
      </div>
      {msg && (
        <Callout tone="warn" title="Not possible with these values">
          {msg}
        </Callout>
      )}
      {!g.ok ? (
        <Callout tone="bad" title="This grading is not valid — no results">
          {g.message}
        </Callout>
      ) : (
        <>
          <div className="table-wrap">
            <table className="ps-table">
              <caption className="sr-only">Layer stresses</caption>
              <thead>
                <tr>
                  <th scope="col">Layer</th>
                  <th scope="col">
                    Radii <span className="cb-unit">[mm]</span>
                  </th>
                  <th scope="col">{st.kind === 'capacitance' ? 'ε_r' : 'Potential at inner face'}</th>
                  <th scope="col">
                    Voltage across <span className="cb-unit">[kV]</span>
                  </th>
                  <th scope="col">
                    g_max <span className="cb-unit">[kV/cm]</span>
                  </th>
                  <th scope="col">
                    g_min <span className="cb-unit">[kV/cm]</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.layers.map((l, i) => (
                  <tr key={i} className={l.gMax === g.peak ? 'is-changed' : ''}>
                    <td>{i + 1}</td>
                    <td>
                      {fx(l.inner * 10, 1)} – {fx(l.outer * 10, 1)}
                    </td>
                    <td>{st.kind === 'capacitance' ? fx(l.eps, 1) : `${fx(g.potentials![i], 2)} kV`}</td>
                    <td>{fx(l.vKv, 2)}</td>
                    <td>{fx(l.gMax, 2)}</td>
                    <td>{fx(l.gMin, 2)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Sum</td>
                  <td />
                  <td />
                  <td>
                    {fx(
                      g.layers.reduce((s, l) => s + l.vKv, 0),
                      2,
                    )}
                  </td>
                  <td colSpan={2} className="small muted">
                    = V = {fx(res.c.vKv, 2)} kV
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="cb-plot-narrow">
            <GradingPlot res={res} graded={[g]} height={210} />
          </div>
          <p className={`small ${equal ? '' : 'muted'}`}>
            Highest stress {fx(g.peak, 2)} kV/cm against {fx(res.gMax, 2)} kV/cm ungraded ({fmtPct(g.peak, res.gMax)}).{' '}
            {equal
              ? `✓ All layers reach the same maximum (within 1 %)${better ? ' — the insulation is used more evenly.' : ', but the peak is not lower than ungraded.'}`
              : `The layer maxima differ by ${fx(((Math.max(...g.layers.map((l) => l.gMax)) - Math.min(...g.layers.map((l) => l.gMax))) / g.peak) * 100, 1)} % — the most stressed layer is ${g.layers.findIndex((l) => l.gMax === g.peak) + 1}.`}
            {st.kind === 'capacitance' && g.cUfKm !== undefined && ` Capacitance ${fx(g.cUfKm, 4)} µF/km (ungraded with ε_r = ${fx(res.c.epsR, 1)}: ${fx(res.cUfKm, 4)}).`}
          </p>
          {level !== 'beginner' && (
            <p className="small muted">
              {st.kind === 'capacitance'
                ? 'D = q/(2πx) is continuous, so ε₁g₁ = ε₂g₂ at a boundary: the stress jumps where ε falls. Equal maxima need ε₁r = ε₂r₁ = ε₃r₂. Drawbacks: materials with the right, stable permittivities are scarce, and ε changes with temperature and age.'
                : 'Each layer between metal intersheaths is a small coaxial cable with ΔV across it. Drawbacks: the intersheaths must be fed from transformer taps, carry charging currents (losses) and can be damaged in laying; a damaged intersheath over-stresses its neighbours. Neither method is common today: smooth extruded screens and high-strength XLPE are used instead.'}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── cable against overhead line ───────────────────────────────────────────────────────────────────────────────

function VsLine({ res }: { res: CableResult }) {
  const level = useLevel()
  const cmp = compareWithLine(res)
  const [rated, setRated] = useState(800)
  const lc = criticalLength(rated, res.icAKm)
  return (
    <div className="ps-stack">
      <p className="small">
        Module 8’s default overhead line (400 kV, flat, twin bundle — computed by Module 8) against this cable, at the same phase voltage V = {fx(res.c.vKv, 1)} kV and the same length (
        {fx(res.c.lengthKm, 1)} km).
      </p>
      <div className="table-wrap">
        <table className="ps-table">
          <caption className="sr-only">Cable against overhead line</caption>
          <thead>
            <tr>
              <th scope="col">Per phase</th>
              <th scope="col">Overhead line</th>
              <th scope="col">Cable</th>
              <th scope="col">Cable ÷ line</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Capacitance [nF/km]</td>
              <td>{fx(cmp.cLine, 2)}</td>
              <td>{fx(cmp.cCable, 1)}</td>
              <td>{timesWords(cmp.cRatio)}</td>
            </tr>
            <tr>
              <td>Charging current at {fx(res.c.vKv, 1)} kV [A/km]</td>
              <td>{fx(cmp.icLine, 4)}</td>
              <td>{fx(cmp.icCable, 3)}</td>
              <td>{timesWords(cmp.icCable / cmp.icLine)}</td>
            </tr>
            <tr>
              <td>Over {fx(res.c.lengthKm, 1)} km [A]</td>
              <td>{fx(cmp.icLineTotal, 3)}</td>
              <td>{fx(cmp.icCableTotal, 2)}</td>
              <td>{timesWords(cmp.icCableTotal / cmp.icLineTotal)}</td>
            </tr>
            <tr>
              <td>Surge impedance [Ω]</td>
              <td>{fx(cmp.zcLine, 1)}</td>
              <td>{fx(cmp.zcCable, 1)}</td>
              <td>×{fx(cmp.zcCable / cmp.zcLine, 3)}</td>
            </tr>
            <tr>
              <td>Wave speed [m/µs]</td>
              <td>{fx(cmp.speedLine, 0)}</td>
              <td>{fx(cmp.speedCable, 0)}</td>
              <td>×{fx(cmp.speedCable / cmp.speedLine, 3)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Line: L and C from GMD/GMR (
        <a className="ps-link" href={LINE_PARAMS_HREF}>
          Module 8
        </a>
        ). Cable: coaxial C and L from the flux inside the insulation (internal conductor flux neglected, as for surges). The low surge impedance and slower waves change how switching and lightning
        surges travel and reflect where a cable meets a line —{' '}
        <a className="ps-link" href={TRANSIENTS_HREF}>
          Module 15
        </a>
        .
      </p>
      {level !== 'beginner' && (
        <>
          <Slider label="Rated current of the conductor" value={rated} min={100} max={3000} step={50} unit="A" decimals={0} onChange={setRated} hint="a value you choose (illustrative)" />
          <p className="small">
            The charging current grows with length: at {fx(lc, lc < 100 ? 1 : 0)} km it alone would equal {rated} A — at the sending end no capacity would be left for the load. Long ac cables
            therefore need shunt reactors along the route (or dc transmission).
          </p>
        </>
      )}
    </div>
  )
}

// ── three-core belted ───────────────────────────────────────────────────────────────────────────────────────

function Belted({ fHz }: { fHz: number }) {
  const [c1, setC1] = useState(0.9)
  const [c2, setC2] = useState(0.6)
  const [vll, setVll] = useState(11)
  const b = beltedFromMeasurements(c1, c2)
  return (
    <div className="ps-stack">
      <p className="small">
        A three-core belted cable has a capacitance C_s from each core to the sheath and C_c between each pair of cores. Two measurements on the whole cable find them: (1) all three cores joined,
        measured to the sheath: C₁ = 3C_s; (2) one core against the other two joined to the sheath: C₂ = C_s + 2C_c.
      </p>
      <div className="ps-toolbar-group">
        <NumField label="Measurement 1 (C₁)" value={c1} onCommit={setC1} unit="µF" decimals={3} />
        <NumField label="Measurement 2 (C₂)" value={c2} onCommit={setC2} unit="µF" decimals={3} />
        <NumField label="Line voltage" value={vll} onCommit={setVll} unit="kV" decimals={1} />
      </div>
      {!b.ok ? (
        <Callout tone="bad" title="These measurements are not possible">
          {b.message}
        </Callout>
      ) : vll <= 0 ? (
        <Callout tone="bad" title="The line voltage must be positive">
          Enter a voltage above 0 kV.
        </Callout>
      ) : (
        <>
          <Readouts
            items={[
              { label: 'C_s (core to sheath)', value: fx(b.cs, 4), unit: 'µF', note: 'C₁ / 3' },
              { label: 'C_c (core to core)', value: fx(b.cc, 4), unit: 'µF', note: '(C₂ − C_s) / 2' },
              { label: 'C_n per phase', value: fx(b.cn, 4), unit: 'µF', note: 'C_s + 3C_c' },
              { label: 'Charging current', value: fx(beltedCharging(b.cn, vll, fHz), 3), unit: 'A', note: `per phase at ${fx(vll, 1)} kV, ${fHz} Hz` },
            ]}
          />
          <p className="small muted">
            Check: the cores’ capacitance matrix with balanced phase voltages gives q_a/V_a = {fx(beltedByMatrix(b.cs, b.cc).re, 4)} µF — the same C_n. (The measurements are for the whole cable;
            values are illustrative.)
          </p>
        </>
      )}
    </div>
  )
}
