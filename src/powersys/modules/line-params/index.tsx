import { useEffect, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { setDesignedLine, useDesignedLine } from '../../lineDesign.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { TourStep } from '../../three/Scene3D.tsx'
import type { ModuleProps } from '../../types.ts'
import { fx } from '../../ui/format.ts'
import { Readouts, Seg, Slider, Toggle, useTutorContext, type ReadoutItem } from '../../ui/kit.tsx'
import {
  ALUMINIUM,
  arrangementPhases,
  ARRANGEMENT_LABEL,
  F_DESIGN,
  PHASES,
  pct,
  rhoAt,
  skinDepth,
  skinQ,
  skinCheck,
  skinRatioHigh,
  skinWords,
  skinRatioQ,
  toDesignedLine,
  type Arrangement,
  type Bundle,
  type Design,
  type LineOptions,
  type LineResult,
  type PhaseIndex,
  type Pt,
} from './calc.ts'
import { CrossSection, type Highlight } from './CrossSection.tsx'
import { Experiments } from './experiment.tsx'
import { Learn } from './learn.tsx'
import { Practise, Verify } from './practise.tsx'
import { DESIGN0, InvalidGeometry, M2_HREF, MODULE, PartInfo, useLine } from './shared.tsx'
import { partOfPhase, phaseOfPart, TowerScene } from './TowerScene.tsx'
import { SkinPlot } from './visuals.tsx'
import './line-params.css'

/*
 * Module 8 — Transmission-Line Parameters. One design (a single-circuit three-phase cross-section, its conductors and
 * options) is computed by calc.ts: R (with temperature and skin effect), L and C from GMD/GMR (checked by an
 * independent matrix model), X, B, Z_c and SIL — and can be sent to Module 2. Learn: a guided explanation. Explore: the
 * 3D tower and the 2D cross-section editor. Experiment: predict, then compare. Verify: the numbers by hand. Practise.
 */

const SPACING_RANGE: Record<Arrangement, [number, number]> = { horizontal: [4, 16], vertical: [4, 12], triangular: [4, 16] }

export default function LineParamsModule({ mode, setMode }: ModuleProps) {
  const [design, setDesign] = useState<Design>(DESIGN0)
  const [seen, setSeen] = useState<Arrangement[]>(['horizontal'])
  return (
    <div className="lp">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore design={design} setDesign={setDesign} seen={seen} setSeen={setSeen} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify design={design} edited={design !== DESIGN0} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}

// ── Explore ───────────────────────────────────────────────────────────────────────────────────────────────────

/** What changed between two designs, in words, and why the results move the way they do. */
function describeChange(a: Design, b: Design): { what: string; why: string } | null {
  const ga = a.geometry
  const gb = b.geometry
  if (a.arrangement !== b.arrangement && b.arrangement !== 'custom')
    return { what: `Arrangement → ${ARRANGEMENT_LABEL[b.arrangement].toLowerCase()}`, why: 'The arrangement sets the three spacings, so the GMD.' }
  if (gb.n !== ga.n) return { what: `Sub-conductors per phase ${ga.n} → ${gb.n}`, why: 'A bigger bundle has a bigger GMR (and r_eq): ln(GMD/GMR) falls, so L falls and C rises.' }
  if (gb.dM !== ga.dM) return { what: `Bundle spacing ${fx(ga.dM, 2)} → ${fx(gb.dM, 2)} m`, why: 'The sub-conductor spacing sets the bundle’s GMR: wider spacing, larger GMR.' }
  if (gb.rM !== ga.rM)
    return { what: `Conductor radius ${fx(ga.rM * 1000, 1)} → ${fx(gb.rM * 1000, 1)} mm`, why: 'A thicker conductor: less resistance (R ∝ 1/r²) and a bigger GMR, but only logarithmically.' }
  if (a.spacing !== b.spacing && b.arrangement !== 'custom')
    return { what: `Phase spacing ${fx(a.spacing, 1)} → ${fx(b.spacing, 1)} m`, why: 'L ∝ ln(GMD/GMR): spacing changes L and C only logarithmically.' }
  if (a.height !== b.height && b.arrangement !== 'custom')
    return {
      what: `Height ${fx(a.height, 1)} → ${fx(b.height, 1)} m`,
      why: b.options.earth ? 'Only the earth term of C depends on height; L does not.' : 'With the earth effect off, height changes nothing.',
    }
  const moved = gb.phases.findIndex((p, k) => p.x !== ga.phases[k].x || p.y !== ga.phases[k].y)
  if (moved >= 0)
    return { what: `Phase ${PHASES[moved]} moved to (${fx(gb.phases[moved].x, 1)}, ${fx(gb.phases[moved].y, 1)}) m`, why: 'Its spacings to the other phases changed, so the GMD changed.' }
  const oa = a.options
  const ob = b.options
  if (oa.transposed !== ob.transposed)
    return {
      what: ob.transposed ? 'Transposed' : 'Not transposed',
      why: ob.transposed ? 'Each phase now takes each position: the phases are equal.' : 'Each phase keeps its own neighbours: the phase values differ (see the table).',
    }
  if (oa.earth !== ob.earth)
    return { what: ob.earth ? 'Earth effect on' : 'Earth effect off', why: 'The earth’s image charges change C — the size is in the numbers above (larger for a lower line); L is unchanged.' }
  if (oa.tempC !== ob.tempC) return { what: `Temperature ${oa.tempC} → ${ob.tempC} °C`, why: 'R = R₂₀[1 + α(T − 20)]: only the resistance changes.' }
  if (oa.kv !== ob.kv) return { what: `Voltage ${oa.kv} → ${ob.kv} kV`, why: 'L, C and Z_c do not depend on voltage; SIL = V²/Z_c does.' }
  return null
}

function NumField({ label, value, onCommit, unit, decimals = 1 }: { label: string; value: number; onCommit(v: number): void; unit: string; decimals?: number }) {
  const [text, setText] = useState(value.toFixed(decimals))
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (!focus) setText(value.toFixed(decimals))
  }, [value, focus, decimals])
  const parse = (t: string) => Number(t.replace(',', '.').replace('−', '-'))
  const bad = text.trim() === '' || !Number.isFinite(parse(text))
  return (
    <label className="lp-num">
      <span className="sr-only">{label}</span>
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

function Explore({ design, setDesign, seen, setSeen }: { design: Design; setDesign(d: Design): void; seen: Arrangement[]; setSeen(a: Arrangement[]): void }) {
  const level = useLevel()
  const out = useLine(design)
  const res = out.ok ? out : null
  const [selected, setSelected] = useState<string | null>(null)
  const [hl, setHl] = useState<Highlight>(null)
  const [showImages, setShowImages] = useState(false)
  const [fSkin, setFSkin] = useState(1000)
  const [change, setChange] = useState<{ what: string; why: string; before: LineResult | null; wasTransposed: boolean } | null>(null)
  const progress = usePsProgress()
  const g = design.geometry
  const o = design.options

  const update = (next: Design) => {
    const c = describeChange(design, next)
    if (c) setChange({ ...c, before: res, wasTransposed: o.transposed })
    setDesign(next)
  }
  const setArrangement = (a: Arrangement) => {
    const [lo, hi] = SPACING_RANGE[a]
    const spacing = Math.min(hi, Math.max(lo, design.spacing))
    update({ ...design, arrangement: a, spacing, geometry: { ...g, phases: arrangementPhases(a, spacing, design.height) } })
    if (!seen.includes(a)) {
      const next = [...seen, a]
      setSeen(next)
      if (next.length >= 3) completeActivity(MODULE, 'arrangements')
    }
  }
  const preset = design.arrangement === 'custom' ? null : design.arrangement
  const setSpacing = (spacing: number) => preset && update({ ...design, spacing, geometry: { ...g, phases: arrangementPhases(preset, spacing, design.height) } })
  const setHeight = (height: number) => preset && update({ ...design, height, geometry: { ...g, phases: arrangementPhases(preset, design.spacing, height) } })
  const movePhase = (k: PhaseIndex, p: Pt) => {
    const phases = g.phases.map((q, j) => (j === k ? p : q)) as [Pt, Pt, Pt]
    update({ ...design, arrangement: 'custom', geometry: { ...g, phases } })
  }
  const setGeo = (patch: Partial<Design['geometry']>) => update({ ...design, geometry: { ...g, ...patch } })
  const setOpt = (patch: Partial<LineOptions>) => update({ ...design, options: { ...o, ...patch } })

  const selPhase = phaseOfPart(selected)
  const fallback = (
    <div className="lp-xs-wrap">
      <CrossSection
        design={design}
        res={res}
        issues={out.ok ? [] : out.issues}
        editable
        onMove={movePhase}
        selected={selPhase}
        onSelect={(k) => setSelected(k === null ? null : partOfPhase(k))}
        highlight={hl}
        showImages={showImages}
        label="Cross-section editor: drag a phase or use the arrow keys"
      />
      <div className="ps-toolbar-group lp-xs-tools">
        <Seg
          label="Highlight"
          value={hl ?? 'none'}
          onChange={(v) => setHl(v === 'none' ? null : (v as Highlight))}
          options={[
            { id: 'none', label: 'No highlight' },
            { id: 'gmd', label: 'GMD spacings' },
            { id: 'gmr', label: 'GMR' },
            { id: 'height', label: 'Heights' },
          ]}
        />
        <Toggle label="Show image conductors" checked={showImages && o.earth} onChange={setShowImages} />
        {!o.earth && <span className="small muted">(images need the earth effect on)</span>}
      </div>
    </div>
  )
  const tour: TourStep[] | undefined = res
    ? [
        {
          title: 'Three phases, held apart',
          focus: ['pa'],
          text: (
            <p>
              Each phase is a conductor {g.n > 1 ? `bundle (${g.n} sub-conductors)` : ''} hanging from the tower. Current in it makes a magnetic field; charge on it makes an electric field. How far
              apart the phases are decides how much of each field links the others.
            </p>
          ),
        },
        {
          title: 'The spacings: GMD',
          focus: ['tower'],
          text: (
            <p>
              The blue dimension lines are the three spacings the calculation uses: {fx(res.dab, 2)}, {fx(res.dbc, 2)} and {fx(res.dca, 2)} m. Their geometric mean, GMD = {fx(res.gmd, 2)} m, is what
              enters L and C.
            </p>
          ),
        },
        {
          title: 'The bundle: GMR',
          focus: ['pb'],
          camera: [g.phases[1].x + 6, g.phases[1].y + 2, 14],
          text: (
            <p>
              {g.n > 1
                ? `Zoom in: each phase is ${g.n} conductors ${fx(g.dM, 2)} m apart. Together they act like one conductor of radius GMR = ${fx(res.gmrL * 1000, 1)} mm — ${fx(res.gmrL / (0.7788 * g.rM), 1)} times one conductor’s ${fx(0.7788 * g.rM * 1000, 1)} mm.`
                : `One conductor per phase: its GMR is r′ = 0.7788·r = ${fx(res.gmrL * 1000, 1)} mm.`}
            </p>
          ),
        },
        {
          title: 'The earth below',
          focus: ['ground'],
          text: (
            <p>
              The ground is a conductor: charge on the line induces opposite charge in it. That raises the capacitance a little —{' '}
              {o.earth ? `${fx(pct(res.cNfKm, res.cNoEarthNfKm), 2)} % here, at a mean height of ${fx(res.hMean, 1)} m` : 'switched off at the moment'}.
            </p>
          ),
        },
        {
          title: 'What it all adds up to',
          focus: ['pa'],
          text: (
            <p>
              L = {fx(res.lMhKm, 4)} mH/km and C = {fx(res.cNfKm, 3)} nF/km per phase, so X = {fx(res.xOhmKm, 4)} Ω/km, B = {fx(res.bUsKm, 3)} µS/km, Z_c = {fx(res.zcOhm, 1)} Ω and SIL ={' '}
              {fx(res.silMw, 0)} MW at {o.kv} kV.
            </p>
          ),
        },
      ]
    : undefined

  useTutorContext(
    () =>
      `Explore — Line parameters. Arrangement ${design.arrangement}; phases ${g.phases.map((p, k) => `${PHASES[k]} (${fx(p.x, 1)}, ${fx(p.y, 1)}) m`).join(', ')}; ${g.n} sub-conductor(s) of radius ${fx(g.rM * 1000, 1)} mm, spacing ${fx(g.dM, 2)} m; ${o.transposed ? 'transposed' : 'untransposed'}; earth ${o.earth ? 'on' : 'off'}; ${o.tempC} °C; ${o.kv} kV. ${res ? `GMD ${fx(res.gmd, 3)} m, GMR ${fx(res.gmrL * 1000, 2)} mm, L ${fx(res.lMhKm, 4)} mH/km, C ${fx(res.cNfKm, 3)} nF/km, R ac ${fx(res.r.rAc, 4)} Ω/km, X ${fx(res.xOhmKm, 4)} Ω/km, B ${fx(res.bUsKm, 3)} µS/km, Zc ${fx(res.zcOhm, 1)} Ω, SIL ${fx(res.silMw, 0)} MW.` : `Invalid geometry: ${out.ok ? '' : out.issues.map((i) => i.message).join(' ')}`}`,
  )

  const main: ReadoutItem[] = res
    ? [
        { label: 'Inductance L', value: fx(o.transposed ? res.lMhKm : res.matrix.lMhKm, 4), unit: 'mH/km', note: o.transposed ? 'per phase' : 'average of the phases' },
        { label: 'Capacitance C', value: fx(o.transposed ? res.cNfKm : res.matrix.cNfKm, 3), unit: 'nF/km', note: o.earth ? 'to neutral, with earth' : 'to neutral' },
        { label: 'SIL', value: fx(res.silMw, 0), unit: 'MW', note: `at ${o.kv} kV` },
      ]
    : []
  const more: ReadoutItem[] = res
    ? [
        { label: 'Reactance X', value: fx(res.xOhmKm, 4), unit: 'Ω/km', note: `ωL at ${F_DESIGN} Hz` },
        { label: 'Susceptance B', value: fx(res.bUsKm, 3), unit: 'µS/km', note: 'ωC' },
        { label: 'Surge impedance Z_c', value: fx(res.zcOhm, 1), unit: 'Ω', note: '√(L/C)' },
        { label: 'Resistance R (ac)', value: fx(res.r.rAc, 4), unit: 'Ω/km', note: `dc ${fx(res.r.rDc, 4)} at ${o.tempC} °C` },
        { label: 'GMD', value: fx(res.gmd, 2), unit: 'm', note: '∛(D_ab·D_bc·D_ca)' },
        { label: 'GMR (bundle)', value: fx(res.gmrL * 1000, 1), unit: 'mm', note: g.n > 1 ? `r_eq for C ${fx(res.req * 1000, 1)} mm` : 'r′ = 0.7788 r' },
        { label: 'Charging', value: fx(res.chargingMvar100, 1), unit: 'Mvar/100 km', note: `${fx(res.chargingAKm, 3)} A/km per phase` },
      ]
    : []
  const delta = change && change.before && res
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <Seg
            label="Arrangement"
            value={design.arrangement}
            onChange={(v) => v !== 'custom' && setArrangement(v as Arrangement)}
            options={[
              { id: 'horizontal', label: 'Horizontal' },
              { id: 'vertical', label: 'Vertical' },
              { id: 'triangular', label: 'Triangular' },
              ...(design.arrangement === 'custom' ? [{ id: 'custom' as const, label: 'Custom' }] : []),
            ]}
          />
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setChange(null)
              setDesign(DESIGN0)
            }}
            disabled={design === DESIGN0}
          >
            Reset
          </button>
        </div>
        <span className="small muted">
          Single circuit · {o.kv} kV · {F_DESIGN} Hz · per phase · {isDone(progress, MODULE, 'arrangements') ? '✓ all three arrangements seen' : `${seen.length} of 3 arrangements seen`}
        </span>
      </div>
      <TowerScene design={design} res={res} selected={selected} onSelect={setSelected} fallback={fallback} info={(id) => <PartInfo id={id} design={design} res={res} />} tour={tour} />
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <section className="ps-card" aria-labelledby="lp-geo">
            <h3 id="lp-geo">The cross-section</h3>
            <div className="ps-cols-2">
              <div>
                <Slider
                  label="Phase spacing D"
                  value={design.spacing}
                  min={preset ? SPACING_RANGE[preset][0] : 4}
                  max={preset ? SPACING_RANGE[preset][1] : 16}
                  step={0.5}
                  unit="m"
                  decimals={1}
                  onChange={setSpacing}
                  hint={
                    preset
                      ? preset === 'horizontal'
                        ? 'between neighbouring phases (a–c is 2D)'
                        : preset === 'vertical'
                          ? 'between phases one above the other'
                          : 'side of the equilateral triangle'
                      : 'custom positions: choose an arrangement to use this'
                  }
                />
                <Slider
                  label="Height of the lowest phase"
                  value={design.height}
                  min={8}
                  max={30}
                  step={0.5}
                  unit="m"
                  decimals={1}
                  onChange={setHeight}
                  hint={preset ? 'average height above the ground (sag not modelled)' : 'custom positions: edit them below'}
                />
              </div>
              <div>
                <p className="ps-slider-label">
                  <span>Sub-conductors per phase</span>
                </p>
                <Seg
                  label="Sub-conductors per phase"
                  full
                  value={String(g.n)}
                  onChange={(v) => setGeo({ n: Number(v) as Bundle })}
                  options={[
                    { id: '1', label: '1' },
                    { id: '2', label: '2' },
                    { id: '3', label: '3' },
                    { id: '4', label: '4' },
                  ]}
                />
                <p className="ps-hint">{g.n === 1 ? 'one conductor per phase' : `a ${['', '', 'twin', 'triple', 'quad'][g.n]} bundle, ${fx(g.dM, 2)} m between sub-conductors`}</p>
              </div>
            </div>
            <details className="ps-more" open={level !== 'beginner'}>
              <summary>Exact positions, conductor and options</summary>
              <table className="ps-table lp-pos">
                <caption className="sr-only">Phase positions</caption>
                <thead>
                  <tr>
                    <th scope="col">Phase</th>
                    <th scope="col">x (across)</th>
                    <th scope="col">height</th>
                  </tr>
                </thead>
                <tbody>
                  {g.phases.map((p, k) => (
                    <tr key={k} className={out.ok || !out.issues.some((i) => i.phases?.includes(k as PhaseIndex)) ? '' : 'is-bad'}>
                      <th scope="row">
                        <span className={`lp-swatch lp-swatch--${PHASES[k]}`} aria-hidden="true" /> {PHASES[k]}
                      </th>
                      <td>
                        <NumField label={`Phase ${PHASES[k]} x`} value={p.x} unit="m" onCommit={(x) => movePhase(k as PhaseIndex, { x, y: p.y })} />
                      </td>
                      <td>
                        <NumField label={`Phase ${PHASES[k]} height`} value={p.y} unit="m" onCommit={(y) => movePhase(k as PhaseIndex, { x: p.x, y })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ps-cols-2">
                <div>
                  <Slider
                    label="Conductor radius r"
                    value={g.rM * 1000}
                    min={5}
                    max={25}
                    step={0.1}
                    unit="mm"
                    decimals={1}
                    onChange={(v) => setGeo({ rM: v / 1000 })}
                    hint="solid aluminium conductor model"
                  />
                  <Slider
                    label="Bundle spacing d"
                    value={g.dM}
                    min={0.2}
                    max={0.6}
                    step={0.01}
                    unit="m"
                    decimals={2}
                    onChange={(v) => setGeo({ dM: v })}
                    hint={g.n === 1 ? 'used when there are 2–4 sub-conductors' : 'centre to centre of neighbouring sub-conductors'}
                  />
                </div>
                <div>
                  <Slider label="Conductor temperature" value={o.tempC} min={0} max={100} step={5} unit="°C" decimals={0} onChange={(v) => setOpt({ tempC: v })} />
                  <p className="ps-slider-label">
                    <span>Nominal voltage (for SIL and charging)</span>
                  </p>
                  <Seg label="Nominal voltage" full value={String(o.kv)} onChange={(v) => setOpt({ kv: Number(v) })} options={[132, 220, 400, 765].map((k) => ({ id: String(k), label: `${k} kV` }))} />
                  <div className="lp-toggles">
                    <Toggle label="Transposed" checked={o.transposed} onChange={(v) => setOpt({ transposed: v })} />
                    <Toggle label="Effect of earth on C" checked={o.earth} onChange={(v) => setOpt({ earth: v })} />
                  </div>
                </div>
              </div>
            </details>
          </section>
          {res && !o.transposed && <Untransposed res={res} />}
          {res && (
            <details className="ps-card ps-more lp-skin" open={level === 'engineer'}>
              <summary>Resistance and skin effect</summary>
              <SkinPanel res={res} rM={g.rM} tempC={o.tempC} f={fSkin} setF={setFSkin} n={g.n} />
            </details>
          )}
          {res && (
            <details className="ps-card ps-more" open={level === 'engineer'}>
              <summary>Independent check: the full matrix model</summary>
              <MatrixCheck res={res} />
            </details>
          )}
        </div>
        <div className="ps-stack">
          <InvalidGeometry outcome={out} />
          {res && (
            <section className="ps-card" aria-labelledby="lp-res">
              <h3 id="lp-res">Line constants</h3>
              <Readouts label="Main results" items={main} />
              {level === 'beginner' ? (
                <details className="ps-more">
                  <summary>All results</summary>
                  <Readouts label="More results" items={more} />
                </details>
              ) : (
                <Readouts label="More results" items={more} />
              )}
              {delta && change && (
                <div className="lp-change" aria-live="polite">
                  <p className="small">
                    <b>You changed:</b> {change.what}.
                  </p>
                  <p className="small">
                    L {fx(shownL(change.before!, change.wasTransposed), 4)} → {fx(shownL(res, o.transposed), 4)} mH/km (
                    {fmtPct(shownL(res, o.transposed), shownL(change.before!, change.wasTransposed))}), C {fx(shownC(change.before!, change.wasTransposed), 3)} → {fx(shownC(res, o.transposed), 3)}{' '}
                    nF/km ({fmtPct(shownC(res, o.transposed), shownC(change.before!, change.wasTransposed))}), SIL {fmtPct(res.silMw, change.before!.silMw)}, R{' '}
                    {fmtPct(res.r.rAc, change.before!.r.rAc)}.
                  </p>
                  <p className="small muted">Why: {change.why}</p>
                </div>
              )}
              <p className="small muted">
                {o.transposed
                  ? 'Transposed line: L and C from the GMD/GMR formulas.'
                  : 'Not transposed: the phases differ (table on the left); L and C show their average, while X, B, Z_c, SIL and the hand-off use the transposed values.'}{' '}
                Balanced operation; ground conductivity and earth wires are not modelled.
              </p>
            </section>
          )}
          <Handoff design={design} res={res} />
        </div>
      </div>
    </div>
  )
}

/** L and C as shown: transposed — the formula; not transposed — the average of the phases (matrix model). */
const shownL = (r: LineResult, transposed: boolean) => (transposed ? r.lMhKm : r.matrix.lMhKm)
const shownC = (r: LineResult, transposed: boolean) => (transposed ? r.cNfKm : r.matrix.cNfKm)

const fmtPct = (a: number, b: number) => {
  const d = pct(a, b)
  return Math.abs(d) < 0.005 ? 'no change' : `${d > 0 ? '+' : '−'}${fx(Math.abs(d), 2)} %`
}

function Untransposed({ res }: { res: LineResult }) {
  return (
    <section className="ps-card" aria-labelledby="lp-untr">
      <h3 id="lp-untr">Not transposed: each phase is different</h3>
      <div className="table-wrap">
        <table className="ps-table">
          <caption className="sr-only">Per-phase inductance and capacitance of the untransposed line</caption>
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">
                L <span className="lp-unit">[mH/km]</span>
              </th>
              <th scope="col">
                C <span className="lp-unit">[nF/km]</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {res.matrix.lPhase.map((z, k) => (
              <tr key={k}>
                <th scope="row">{PHASES[k]}</th>
                <td>{fx(z.re, 4)}</td>
                <td>{fx(res.matrix.cPhase[k].re, 3)}</td>
              </tr>
            ))}
            <tr className="is-changed">
              <th scope="row">Average</th>
              <td>{fx(res.matrix.lMhKm, 4)}</td>
              <td>{fx(res.matrix.cNfKm, 3)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        From the matrix model with balanced currents and voltages (each phase’s flux linkage ÷ its current). The values are strictly complex — the imaginary parts (
        {res.matrix.lPhase.map((z) => fx(z.im, 4)).join(', ')} mH/km) pass power between phases — and their average equals the transposed line. Transposition makes all three equal.
      </p>
    </section>
  )
}

function SkinPanel({ res, rM, tempC, f, setF, n }: { res: LineResult; rM: number; tempC: number; f: number; setF(v: number): void; n: number }) {
  const rho = rhoAt(tempC)
  const q = skinQ(rM, rho, f)
  const ratio = skinRatioQ(q)
  return (
    <div className="ps-stack lp-skin-body">
      <p className="small">
        A solid aluminium conductor (ρ₂₀ = {ALUMINIUM.rho20 * 1e8} × 10⁻⁸ Ω·m, α = {ALUMINIUM.alpha20} /°C — typical values) of radius {fx(rM * 1000, 1)} mm at {tempC} °C: R_dc = {fx(res.r.rDcSub, 4)}{' '}
        Ω/km per sub-conductor, {fx(res.r.rDc, 4)} Ω/km per phase ({n} in parallel).
      </p>
      <Slider label="Frequency for the skin-effect view" value={f} min={50} max={5000} step={50} unit="Hz" decimals={0} onChange={setF} hint="the line constants always use 50 Hz" />
      <Readouts
        items={[
          { label: 'Skin depth', value: fx(skinDepth(rho, f) * 1000, 2), unit: 'mm', note: `δ; at 50 Hz: ${fx(res.r.delta50 * 1000, 2)} mm` },
          { label: 'AC ÷ DC resistance', value: fx(ratio, 4), note: `R_ac/R_dc; at 50 Hz: ${fx(res.r.ratio50, 5)}` },
          {
            label: 'High-frequency estimate',
            value: fx(skinRatioHigh(q), 3),
            note: skinCheck(q).regime === 'high' ? 'r/(2δ) + ¼ (valid: q ≥ 3)' : `r/(2δ) + ¼ — valid only for q ≥ 3; here q = ${fx(q, 2)}`,
          },
        ]}
      />
      <SkinPlot
        curves={[
          { q: res.r.q50, label: '50 Hz', color: 'var(--ps-c)' },
          { q, label: `${f} Hz`, color: 'var(--ps-a)' },
        ]}
        height={200}
      />
      <p className="small muted">
        Exact solid-conductor (Bessel ber/bei) solution. Stranded ACSR with a steel core is beyond this model. The <b>proximity effect</b> — the field of the neighbouring sub-conductors and phases
        pushing the current to one side — adds further ac resistance; it is explained here, not computed. At 50 Hz the skin effect of this conductor is {skinWords(res.r.ratio50)}.
      </p>
    </div>
  )
}

function MatrixCheck({ res }: { res: LineResult }) {
  const m = res.matrix
  return (
    <div className="ps-stack">
      <p className="small">
        Every one of the {m.conductors} sub-conductors is modelled as its own conductor: flux linkages from L_kk = 2×10⁻⁷ ln(1/r′), L_kj = 2×10⁻⁷ ln(1/D_kj) with the currents adding to zero;
        potentials from the potential coefficients (with image conductors when the earth is on), inverted. Then reduced to phases and averaged over a transposition cycle.
      </p>
      <div className="table-wrap">
        <table className="ps-table">
          <caption className="sr-only">Formula against the matrix model</caption>
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col">GMD/GMR formula</th>
              <th scope="col">Matrix model</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>L [mH/km]</td>
              <td>{fx(res.lMhKm, 5)}</td>
              <td>{fx(m.lMhKm, 5)}</td>
              <td>{fmtPct(m.lMhKm, res.lMhKm)}</td>
            </tr>
            <tr>
              <td>C, equal charges [nF/km]</td>
              <td>{fx(res.cNfKm, 4)}</td>
              <td>{fx(m.cEqualNfKm, 4)}</td>
              <td>{fmtPct(m.cEqualNfKm, res.cNfKm)}</td>
            </tr>
            <tr>
              <td>C, exact (equipotential) [nF/km]</td>
              <td>{fx(res.cNfKm, 4)}</td>
              <td>{fx(m.cNfKm, 4)}</td>
              <td>{fmtPct(m.cNfKm, res.cNfKm)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        The formulas use centre-to-centre distances between bundles; the matrix uses every sub-conductor distance — they agree to about (bundle radius ÷ spacing)ⁿ. For C the formula also assumes each
        phase carries the same charge in every transposition section; letting the charge adjust (the phase is one equipotential conductor) changes C by the amount in the last row.
      </p>
    </div>
  )
}

function Handoff({ design, res }: { design: Design; res: LineResult | null }) {
  const offered = useDesignedLine()
  const [msg, setMsg] = useState<string | null>(null)
  const same =
    offered &&
    res &&
    Math.abs(offered.rOhmPerKm - res.r.rAc) < 1e-12 &&
    Math.abs(offered.xOhmPerKm - res.xOhmKm) < 1e-12 &&
    Math.abs(offered.bUsPerKm - res.bUsKm) < 1e-12 &&
    offered.kv === design.options.kv
  const send = () => {
    if (!res) return
    const ok = setDesignedLine(toDesignedLine(design, res, Date.now()))
    setMsg(ok ? 'Sent. Module 2’s transmission-line lab can now use these constants instead of its preset.' : 'These constants were refused (not valid line constants).')
    if (ok) completeActivity(MODULE, 'handoff')
  }
  return (
    <section className="ps-card lp-handoff" aria-labelledby="lp-handoff">
      <h3 id="lp-handoff">Use this line in Module 2</h3>
      <p className="small">
        Module 2 (Three-Phase Power, Phasors &amp; Lines) models a loaded line from its r, x and b per km. Send this design’s 50 Hz values (transposed, balanced) and use them there.
      </p>
      {res ? (
        <Readouts
          items={[
            { label: 'r', value: fx(res.r.rAc, 4), unit: 'Ω/km' },
            { label: 'x', value: fx(res.xOhmKm, 4), unit: 'Ω/km' },
            { label: 'b', value: fx(res.bUsKm, 3), unit: 'µS/km' },
          ]}
        />
      ) : (
        <p className="small muted">Nothing to send while the cross-section is invalid.</p>
      )}
      <div className="ps-toolbar-group">
        <button type="button" className="btn btn--primary ps-btn-sm" onClick={send} disabled={!res || !!same}>
          {same ? '✓ Offered to Module 2' : 'Use these constants in Module 2'}
        </button>
        {offered && (
          <button type="button" className="text-btn" onClick={() => (setDesignedLine(null), setMsg('Withdrawn: Module 2 uses its own presets.'))}>
            Withdraw
          </button>
        )}
      </div>
      {msg && (
        <p className="small" role="status">
          {msg}
        </p>
      )}
      <div className="lp-offered">
        {offered ? (
          <>
            <p className="small">
              <b>Offered to Module 2{same ? ' (this design)' : ''}:</b> {offered.kv} kV — {offered.summary}. r {fx(offered.rOhmPerKm, 4)} Ω/km, x {fx(offered.xOhmPerKm, 4)} Ω/km, b{' '}
              {fx(offered.bUsPerKm, 3)} µS/km, sent {new Date(offered.at).toLocaleTimeString()}.
            </p>
            {!same && res && <p className="small muted">Your design has changed since then — send it again to update Module 2.</p>}
          </>
        ) : (
          <p className="small muted">No design is offered: Module 2 uses its own presets.</p>
        )}
        <a className="ps-link" href={M2_HREF}>
          Open Module 2’s line lab →
        </a>
      </div>
    </section>
  )
}
