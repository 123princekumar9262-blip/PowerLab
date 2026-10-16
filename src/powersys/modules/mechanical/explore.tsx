import { useEffect, useMemo, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { Plot } from '../../ui/Plot.tsx'
import { Callout, Readouts, Seg, Slider, Toggle, useTutorContext, type ReadoutItem } from '../../ui/kit.tsx'
import {
  bundleGradient,
  CONDUCTORS,
  coronaVerdict,
  criticalDisruptive,
  diffWords,
  parabolaVerdict,
  visualCritical,
  type ConductorId,
  type CoronaResult,
  type Grading,
  type SpanResult,
  type StringResult,
} from './calc.ts'
import { RANGES } from './checks.ts'
import { Elevation, GapPlot, Ladder, LoadDiagram, ShareLegend } from './diagrams.tsx'
import { conductorOf, coronaOf, DESIGN0, spanOf, stringOf, type CoronaState, type Design, type SpanState, type StringState } from './model.ts'
import { deg, Issues, kN, LP_HREF, MODULE, PartInfo, signedPct } from './shared.tsx'
import { SpanScene, stringCamera, stringDrawLen } from './SpanScene.tsx'

/*
 * Explore: the span (3D scene + 2D elevation and the catenary-vs-parabola difference), the insulator string (the same
 * scene, the ladder diagram and grading) and corona (Peek's voltages against the operating voltage). One design is
 * shared with Verify; the line voltage and the conductor are the same in every view.
 */

export type ExploreView = 'span' | 'string' | 'corona'

const CONDUCTOR_OPTIONS = (engineer: boolean) => [
  ...(['light', 'medium', 'heavy'] as const).map((id) => ({ id: id as ConductorId, label: CONDUCTORS[id].name })),
  ...(engineer ? [{ id: 'custom' as ConductorId, label: 'Custom' }] : []),
]

export function Explore({ design, setDesign, view, setView }: { design: Design; setDesign(d: Design): void; view: ExploreView; setView(v: ExploreView): void }) {
  const level = useLevel()
  const progress = usePsProgress()
  const spanOut = useMemo(() => spanOf(design), [design])
  const strOut = useMemo(() => stringOf(design), [design])
  const corOut = useMemo(() => coronaOf(design), [design])
  const res = spanOut.ok ? spanOut : null
  const str = strOut.ok ? strOut : null
  const cor = corOut.ok ? corOut : null
  const [selected, setSelected] = useState<string | null>(null)
  const [change, setChange] = useState<Change>(null)
  const [seen, setSeen] = useState<Set<string>>(() => new Set())

  const s = design.span
  const st = design.string
  const n = st.n
  // keep a selected disc inside the string when the disc count changes
  useEffect(() => {
    const m = /^disc-(\d+)$/.exec(selected ?? '')
    if (m && Number(m[1]) > n) setSelected(null)
  }, [n, selected])
  // activities: wind and ice both tried; both grading methods tried
  useEffect(() => {
    const next = new Set(seen)
    if (s.ice) next.add('ice')
    if (s.wind) next.add('wind')
    if (st.grading === 'capacitance') next.add('capacitance')
    if (st.grading === 'guard') next.add('guard')
    if (next.size !== seen.size) setSeen(next)
    if (next.has('ice') && next.has('wind')) completeActivity(MODULE, 'loads')
    if (next.has('capacitance') && next.has('guard')) completeActivity(MODULE, 'string')
  }, [s.ice, s.wind, st.grading]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: Design, what: string, why: string) => {
    setChange({ what, why, kind: view, before: { span: res, str, cor } })
    setDesign(next)
  }
  const setSpan = (patch: Partial<SpanState>, what: string, why: string) => update({ ...design, span: { ...s, ...patch } }, what, why)
  const setStr = (patch: Partial<StringState>, what: string, why: string) => update({ ...design, string: { ...st, ...patch } }, what, why)
  const setCor = (patch: Partial<CoronaState>, what: string, why: string) => update({ ...design, corona: { ...design.corona, ...patch } }, what, why)

  const geom = { L: s.L, hA: s.hA, h: s.unequal ? s.h : 0, n }
  const fallback = (
    <div className="mech-fallback">
      {res ? (
        <Elevation res={res} stringLen={stringDrawLen(n)} label="Side elevation of the span: catenary and parabola" />
      ) : (
        <Issues issues={spanOut.ok ? [] : spanOut.issues} title="No span to draw" />
      )}
      {str && <Ladder str={str} selected={discOf(selected)} onSelect={(k) => setSelected(k === null ? null : `disc-${k}`)} label="The insulator string as a capacitor ladder" />}
    </div>
  )
  const tour = useTour(res, str, geom)
  useTutorContext(() => tutorText(design, res, str, cor, view))

  return (
    <div className="ps-stack mech-explore">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <Seg
            label="What to explore"
            value={view}
            onChange={setView}
            options={[
              { id: 'span', label: 'Span & sag' },
              { id: 'string', label: 'Insulator string' },
              { id: 'corona', label: 'Corona' },
            ]}
          />
          <button
            type="button"
            className="text-btn"
            disabled={design === DESIGN0}
            onClick={() => {
              setChange(null)
              setDesign(DESIGN0)
            }}
          >
            Reset
          </button>
        </div>
        <span className="small muted">
          {isDone(progress, MODULE, 'loads') ? '✓ wind and ice tried' : `${['ice', 'wind'].filter((x) => seen.has(x)).length} of 2 loads tried`} ·{' '}
          {isDone(progress, MODULE, 'string') ? '✓ both grading methods tried' : `${['capacitance', 'guard'].filter((x) => seen.has(x)).length} of 2 grading methods tried`}
        </span>
      </div>
      {view !== 'corona' && (
        <>
          <SpanScene geom={geom} res={res} str={str} selected={selected} onSelect={setSelected} fallback={fallback} info={(id) => <PartInfo id={id} res={res} str={str} />} tour={tour} />
          {str && <ShareLegend str={str} selected={discOf(selected)} onSelect={(k) => setSelected(k === null ? null : `disc-${k}`)} />}
        </>
      )}
      {view === 'span' && <SpanPanel s={s} res={res} out={spanOut} level={level} setSpan={setSpan} change={change} n={n} />}
      {view === 'string' && <StringPanel st={st} str={str} level={level} setStr={setStr} change={change} selected={discOf(selected)} onSelect={(k) => setSelected(k === null ? null : `disc-${k}`)} />}
      {view === 'corona' && <CoronaPanel design={design} cor={cor} out={corOut} level={level} setCor={setCor} setStr={setStr} setSpan={setSpan} change={change} />}
    </div>
  )
}

const discOf = (id: string | null) => {
  const m = /^disc-(\d+)$/.exec(id ?? '')
  return m ? Number(m[1]) : null
}

// ── the change box ──────────────────────────────────────────────────────────────────────────────────────────

type Change = { what: string; why: string; kind: ExploreView; before: { span: SpanResult | null; str: StringResult | null; cor: CoronaResult | null } } | null

function ChangeBox({ change, items, kind }: { change: Change; kind: ExploreView; items: Array<[string, number | null | undefined, number | null | undefined, string, number]> }) {
  if (!change || change.kind !== kind) return null
  const rows = items.filter(([, a, b]) => a != null && b != null) as Array<[string, number, number, string, number]>
  return (
    <div className="mech-change" aria-live="polite">
      <p className="small">
        <b>You changed:</b> {change.what}.
      </p>
      {rows.length > 0 && (
        <p className="small">
          {rows.map(([label, a, b, unit, d], k) => (
            <span key={label}>
              {k > 0 && ', '}
              {label} {fx(a, d)} → {fx(b, d)} {unit} ({signedPct(b, a)})
            </span>
          ))}
          .
        </p>
      )}
      <p className="small muted">Why: {change.why}</p>
    </div>
  )
}

// ── span ────────────────────────────────────────────────────────────────────────────────────────────────────

function SpanPanel({
  s,
  res,
  out,
  level,
  setSpan,
  change,
  n,
}: {
  s: SpanState
  res: SpanResult | null
  out: ReturnType<typeof spanOf>
  level: string
  setSpan(p: Partial<SpanState>, what: string, why: string): void
  change: Change
  n: number
}) {
  const c = conductorOf(s)
  const engineer = level === 'engineer'
  const beginner = level === 'beginner'
  const before = change?.before.span ?? null
  const level0 = !s.unequal
  const main: ReadoutItem[] = res
    ? [
        level0
          ? { label: 'Sag (vertical)', value: fx(res.vSagA, 2), unit: 'm', note: res.loads.theta > 0 ? `S·cos θ; ${fx(res.cat.SB, 2)} m in the load plane` : 'catenary, at mid-span' }
          : {
              label: 'Lowest point below A / B',
              value: `${fx(res.vSagA, 2)} / ${fx(res.vSagB, 2)}`,
              unit: 'm',
              note: res.vertexInSpan ? `at ${fx(res.low.x, 1)} m from A` : 'the lower support is the lowest point',
            },
        {
          label: 'Ground clearance',
          value: fx(res.clearance, 2),
          unit: 'm',
          tone: res.clearance < s.minClear ? 'bad' : 'good',
          note: res.clearance < s.minClear ? `${fx(s.minClear - res.clearance, 2)} m below your minimum` : `${fx(res.clearance - s.minClear, 2)} m above your minimum`,
        },
        { label: 'Tension at the support', value: fx(kN(res.Tmax), 2), unit: 'kN', note: `factor of safety ${fx(res.fosActual, 2)}` },
      ]
    : []
  const more: ReadoutItem[] = res
    ? [
        { label: 'T₀ at the lowest point', value: fx(kN(res.T0), 2), unit: 'kN', note: s.mode === 'fos' ? `solved so the support carries ${fx(kN(res.Tworking ?? 0), 2)} kN` : 'set by you' },
        { label: 'Load w_r', value: fx(res.loads.wr, 2), unit: 'N/m', note: res.loads.theta > 0 ? `θ = ${fx(deg(res.loads.theta), 1)}° from vertical` : 'the bare conductor' },
        { label: 'Parabola sag', value: fx(level0 ? res.par.Slevel : res.par.SB, 3), unit: 'm', note: `${parabolaVerdict(res.relDiff)}: ${diffWords(res.relDiff)}` },
        { label: 'Conductor length', value: fx(res.cat.length, 2), unit: 'm', note: `${fx((res.cat.length - Math.hypot(s.L, level0 ? 0 : s.h)) * 100, 1)} cm more than the straight line` },
        ...(res.loads.theta > 0 ? [{ label: 'Sideways swing', value: fx(res.low.z, 2), unit: 'm', note: 'at the lowest point' }] : []),
      ]
    : []
  const T = (x: SpanResult | null) => (x ? kN(x.Tmax) : null)
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="mech-span-h">
          <h3 id="mech-span-h">The span</h3>
          <div className="ps-cols-2">
            <div>
              <Slider
                label="Span L"
                value={s.L}
                min={RANGES.L[0]}
                max={RANGES.L[1]}
                step={10}
                unit="m"
                onChange={(v) =>
                  setSpan(
                    { L: v },
                    `Span ${s.L} → ${v} m`,
                    `At a fixed T₀ the parabola says sag ∝ L²: (${v}/${s.L})² = ${fx((v / s.L) ** 2, 2)}${s.mode === 'fos' ? ' (here the support tension is fixed instead and T₀ is re-solved, so only approximately)' : ''}. Twice the span carries twice the weight over twice the distance.`,
                  )
                }
              />
              {!beginner && (
                <Seg
                  label="Set the tension by"
                  value={s.mode}
                  full
                  onChange={(v) =>
                    setSpan(
                      { mode: v },
                      v === 'fos' ? 'Tension set by breaking strength ÷ factor of safety' : 'Tension T₀ set directly',
                      v === 'fos'
                        ? 'The support (largest) tension is set to the working tension; T₀ is solved from it.'
                        : 'You set the tension at the lowest point; the support tension follows: T = T₀ + wS.',
                    )
                  }
                  options={[
                    { id: 'T0', label: 'Tension T₀' },
                    { id: 'fos', label: 'Factor of safety' },
                  ]}
                />
              )}
              {s.mode === 'T0' ? (
                <Slider
                  label="Tension T₀ (lowest point)"
                  value={s.T0kN}
                  min={RANGES.T0kN[0]}
                  max={RANGES.T0kN[1]}
                  step={0.5}
                  unit="kN"
                  decimals={1}
                  onChange={(v) => setSpan({ T0kN: v }, `T₀ ${fx(s.T0kN, 1)} → ${fx(v, 1)} kN`, `S = wL²/(8T₀): sag is inversely proportional to the tension (×${fx(s.T0kN / v, 2)} by the parabola).`)}
                  hint="the tension where the conductor is lowest (horizontal without wind)"
                />
              ) : (
                <Slider
                  label="Factor of safety"
                  value={s.fos}
                  min={RANGES.fos[0]}
                  max={RANGES.fos[1]}
                  step={0.1}
                  decimals={1}
                  onChange={(v) =>
                    setSpan(
                      { fos: v },
                      `Factor of safety ${fx(s.fos, 1)} → ${fx(v, 1)}`,
                      `Working tension = breaking strength ÷ FoS = ${fx(c.uts / 1000, 0)} ÷ ${fx(v, 1)} = ${fx(c.uts / 1000 / v, 2)} kN at the support.`,
                    )
                  }
                  hint={`working tension = ${fx(c.uts / 1000, 0)} kN ÷ FoS, at the support`}
                />
              )}
            </div>
            <div>
              <p className="ps-slider-label">
                <span>Conductor</span>
              </p>
              <Seg
                label="Conductor"
                full
                value={s.conductor}
                onChange={(v) => {
                  const nc = conductorOf({ ...s, conductor: v })
                  setSpan(
                    { conductor: v },
                    `Conductor → ${nc.name.toLowerCase()} (${fx(nc.w, 1)} N/m)`,
                    'Weight sets the sag (S ∝ w); diameter sets the wind and ice loads (and corona); strength sets the factor of safety.',
                  )
                }}
                options={CONDUCTOR_OPTIONS(engineer || s.conductor === 'custom')}
              />
              <p className="ps-hint">
                w = {fx(c.w, 2)} N/m · d = {fx(c.d * 1000, 1)} mm · breaks at {fx(c.uts / 1000, 0)} kN{s.conductor !== 'custom' ? ' (illustrative values)' : ''}
              </p>
              <div className="mech-toggles">
                <Toggle
                  label="Ice"
                  checked={s.ice}
                  onChange={(v) =>
                    setSpan(
                      { ice: v },
                      v ? `Ice on (${fx(s.iceMm, 0)} mm)` : 'Ice off',
                      v
                        ? s.mode === 'fos'
                          ? 'Ice adds weight: w_i = ρ·g·π·t(d + t). The support tension stays at the working tension (breaking strength ÷ FoS), so T₀ is solved again: it falls, and the sag rises.'
                          : 'Ice adds weight: w_i = ρ·g·π·t(d + t), so the sag and the support tension rise (T₀ held).'
                        : 'The ice weight is removed.',
                    )
                  }
                />
                <Toggle
                  label="Wind"
                  checked={s.wind}
                  onChange={(v) =>
                    setSpan(
                      { wind: v },
                      v ? `Wind on (${fx(s.windPa, 0)} N/m²)` : 'Wind off',
                      v ? 'Wind pushes sideways: the conductor swings into the plane of the resultant load w_r.' : 'The conductor hangs vertically again.',
                    )
                  }
                />
              </div>
              {!beginner && s.ice && (
                <Slider
                  label="Radial ice thickness t"
                  value={s.iceMm}
                  min={1}
                  max={RANGES.iceMm[1]}
                  step={1}
                  unit="mm"
                  decimals={0}
                  onChange={(v) => setSpan({ iceMm: v }, `Ice ${s.iceMm} → ${v} mm`, 'Ice weight ∝ t(d + t): it grows faster than the thickness.')}
                  hint="ice density 915 kg/m³ (typical)"
                />
              )}
              {!beginner && s.wind && (
                <Slider
                  label="Wind pressure p"
                  value={s.windPa}
                  min={50}
                  max={RANGES.windPa[1]}
                  step={10}
                  unit="N/m²"
                  decimals={0}
                  onChange={(v) => setSpan({ windPa: v }, `Wind ${s.windPa} → ${v} N/m²`, 'Wind force per metre = p·(d + 2t), on the projected area.')}
                  hint="a design input — not taken from a specific standard"
                />
              )}
            </div>
          </div>
          {!beginner && (
            <details className="ps-more" open={engineer}>
              <summary>Supports, clearance{engineer ? ' and a custom conductor' : ''}</summary>
              <div className="ps-cols-2 mech-more">
                <div>
                  <Slider
                    label="Height of support A"
                    value={s.hA}
                    min={RANGES.hA[0]}
                    max={RANGES.hA[1]}
                    step={0.5}
                    unit="m"
                    decimals={1}
                    onChange={(v) =>
                      setSpan(
                        { hA: v },
                        `Support A ${fx(s.hA, 1)} → ${fx(v, 1)} m`,
                        'Raising the supports raises the whole conductor: the clearance changes by the same amount; sag and tension do not.',
                      )
                    }
                    hint="conductor attachment above the ground"
                  />
                  <Slider
                    label="Minimum ground clearance"
                    value={s.minClear}
                    min={RANGES.minClear[0]}
                    max={RANGES.minClear[1]}
                    step={0.5}
                    unit="m"
                    decimals={1}
                    onChange={(v) => setSpan({ minClear: v }, `Minimum clearance ${fx(s.minClear, 1)} → ${fx(v, 1)} m`, 'Your design limit — the computed clearance is compared with it.')}
                    hint="your design limit (not from a specific rule)"
                  />
                </div>
                <div>
                  {(engineer || s.unequal) && (
                    <>
                      <Toggle
                        label="Supports at different levels"
                        checked={s.unequal}
                        onChange={(v) =>
                          setSpan(
                            { unequal: v },
                            v ? `Support B ${fx(s.h, 0)} m higher` : 'Supports level again',
                            v ? 'The lowest point moves towards the lower support: x₁ = L/2 − T₀h/(wL).' : 'Level supports: the lowest point is at mid-span.',
                          )
                        }
                      />
                      {s.unequal && (
                        <Slider
                          label="Support B higher by h"
                          value={s.h}
                          min={RANGES.h[0]}
                          max={RANGES.h[1]}
                          step={1}
                          unit="m"
                          decimals={0}
                          onChange={(v) => setSpan({ h: v }, `Height difference ${s.h} → ${v} m`, 'x₁ = L/2 − T₀h/(wL): the lowest point moves towards support A; S₂ − S₁ = h.')}
                        />
                      )}
                    </>
                  )}
                  {s.conductor === 'custom' && (
                    <>
                      <Slider
                        label="Weight w"
                        value={s.w}
                        min={RANGES.w[0]}
                        max={RANGES.w[1]}
                        step={0.1}
                        unit="N/m"
                        decimals={1}
                        onChange={(v) => setSpan({ w: v }, `Weight ${fx(s.w, 1)} → ${fx(v, 1)} N/m`, 'S ∝ w at a given T₀.')}
                      />
                      <Slider
                        label="Diameter d"
                        value={s.dMm}
                        min={RANGES.dMm[0]}
                        max={RANGES.dMm[1]}
                        step={0.5}
                        unit="mm"
                        decimals={1}
                        onChange={(v) => setSpan({ dMm: v }, `Diameter ${fx(s.dMm, 1)} → ${fx(v, 1)} mm`, 'The diameter sets the wind and ice loads and the corona voltage (r = d/2).')}
                      />
                      <Slider
                        label="Breaking strength"
                        value={s.utsKN}
                        min={RANGES.utsKN[0]}
                        max={RANGES.utsKN[1]}
                        step={1}
                        unit="kN"
                        decimals={0}
                        onChange={(v) => setSpan({ utsKN: v }, `Breaking strength ${s.utsKN} → ${v} kN`, 'Sets the factor of safety (or, in FoS mode, the working tension).')}
                      />
                    </>
                  )}
                </div>
              </div>
            </details>
          )}
        </section>
        {res && (
          <details className="ps-card ps-more" open={level !== 'beginner'}>
            <summary>Side view: catenary and parabola</summary>
            <Elevation res={res} stringLen={stringDrawLen(n)} label="Side elevation of the span with the catenary and the parabola" />
            {!beginner && <GapPlot res={res} />}
            <p className="small muted">
              The parabola S = wL²/(8T₀) is {parabolaVerdict(res.relDiff)} here: it is {diffWords(res.relDiff)} below the catenary
              {level0 ? `, close to the estimate (4/3)(S/L)² = ${fx(res.relDiffEst * 100, 3)} %` : ''}. The error grows with the square of S/L; the module calls the parabola good within 1 %.
            </p>
          </details>
        )}
        {res && (s.ice || s.wind) && (
          <details className="ps-card ps-more" open={!beginner}>
            <summary>Wind and ice loads on one metre of conductor</summary>
            <LoadDiagram loads={res.loads} d={c.d} t={res.input.iceT} p={res.input.windP} />
          </details>
        )}
      </div>
      <div className="ps-stack">
        {!out.ok && <Issues issues={out.issues} title="This span cannot be built as set — no results" />}
        {res && (
          <section className="ps-card" aria-labelledby="mech-span-res">
            <h3 id="mech-span-res">Sag and tension</h3>
            <Readouts label="Main results" items={main} />
            {beginner ? (
              <details className="ps-more">
                <summary>All results</summary>
                <Readouts label="More results" items={more} />
              </details>
            ) : (
              <Readouts label="More results" items={more} />
            )}
            {res.warnings.map((w) => (
              <Callout key={w.id} tone={w.id === 'clearance' ? 'warn' : 'info'}>
                {w.message}
              </Callout>
            ))}
            <ChangeBox
              kind="span"
              change={change}
              items={[
                ['sag (vertical)', before?.vSagA, res.vSagA, 'm', 2],
                ['T₀', before ? kN(before.T0) : null, kN(res.T0), 'kN', 3],
                ['support tension', T(before), T(res), 'kN', 2],
                ['clearance', before?.clearance, res.clearance, 'm', 2],
              ]}
            />
            <p className="small muted">
              One span, a uniform flexible conductor (catenary).{' '}
              {s.mode === 'fos'
                ? 'The support tension is held at the working tension (breaking strength ÷ FoS) and T₀ is solved from it, so a heavier load lowers T₀ and deepens the sag'
                : 'T₀ is held at the value set — the textbook approach'}
              ; the change of conductor length with tension and temperature (the stringing or “change of state” calculation) is not modelled. The insulator string’s own swing is not modelled.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}

// ── insulator string ────────────────────────────────────────────────────────────────────────────────────────

const GRADING_LABEL: Record<Grading, string> = { none: 'No grading', capacitance: 'Capacitance grading', guard: 'Guard ring (ideal)' }

function StringPanel({
  st,
  str,
  level,
  setStr,
  change,
  selected,
  onSelect,
}: {
  st: StringState
  str: StringResult | null
  level: string
  setStr(p: Partial<StringState>, what: string, why: string): void
  change: Change
  selected: number | null
  onSelect(k: number | null): void
}) {
  const beginner = level === 'beginner'
  const before = change?.before.str ?? null
  const equal = str ? Math.max(...str.discV) - Math.min(...str.discV) < 1e-9 * str.V : false
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="mech-str-h">
          <h3 id="mech-str-h">The insulator string</h3>
          <div className="ps-cols-2">
            <div>
              <Slider
                label="Discs n"
                value={st.n}
                min={RANGES.n[0]}
                max={RANGES.n[1]}
                step={1}
                decimals={0}
                onChange={(v) => setStr({ n: v }, `Discs ${st.n} → ${v}`, 'Each extra link adds a shunt path to the tower; their charging currents all pass through the discs nearest the line.')}
              />
              <Slider
                label="Shunt ratio m = C_shunt / C"
                value={st.m}
                min={RANGES.m[0]}
                max={RANGES.m[1]}
                step={0.01}
                decimals={2}
                onChange={(v) => setStr({ m: v }, `m ${fx(st.m, 2)} → ${fx(v, 2)}`, 'A larger m sends more current sideways to the tower at each link, so the lower discs carry more.')}
                hint="a longer cross-arm makes m smaller"
              />
            </div>
            <div>
              <p className="ps-slider-label">
                <span>Improve it with</span>
              </p>
              <Seg
                label="Grading"
                full
                value={st.grading}
                onChange={(v) =>
                  setStr(
                    { grading: v },
                    GRADING_LABEL[v],
                    v === 'none'
                      ? 'Equal discs: the line-end disc carries the most.'
                      : v === 'capacitance'
                        ? 'Each disc is given just enough capacitance to carry the current arriving from above it.'
                        : 'A ring at line potential feeds each link exactly the current its shunt capacitance takes.',
                  )
                }
                options={[
                  { id: 'none', label: 'None' },
                  { id: 'capacitance', label: 'Grading' },
                  { id: 'guard', label: 'Guard ring' },
                ]}
              />
              {!beginner && (
                <>
                  <p className="ps-slider-label mech-gap">
                    <span>Line voltage (line to line)</span>
                  </p>
                  <Seg
                    label="Line voltage"
                    full
                    value={String(st.kv)}
                    onChange={(v) => setStr({ kv: Number(v) }, `Line voltage ${st.kv} → ${v} kV`, 'Every disc voltage scales with the phase voltage; the shares and η do not change.')}
                    options={RANGES.kv.map((k) => ({ id: String(k), label: `${k}` }))}
                  />
                  <p className="ps-hint">kV; the phase voltage is V_LL/√3</p>
                </>
              )}
            </div>
          </div>
        </section>
        {str && (
          <section className="ps-card mech-flush" aria-label="Ladder diagram">
            <Ladder str={str} selected={selected} onSelect={onSelect} label="The insulator string as a capacitor ladder, with each disc's computed voltage" />
            <p className="small muted">
              Calculated: each disc’s voltage from a nodal solve of this circuit (discs C, shunts mC{st.grading === 'guard' ? ', guard-ring capacitances C_g' : ''}). Select a disc to see it in the 3D
              view.
            </p>
          </section>
        )}
      </div>
      <div className="ps-stack">
        {str && (
          <section className="ps-card" aria-labelledby="mech-str-res">
            <h3 id="mech-str-res">Voltage distribution</h3>
            <Readouts
              items={[
                { label: 'String efficiency η', value: fx(str.eff * 100, 1), unit: '%', note: 'V / (n × V_max)', tone: str.eff > 0.999 ? 'good' : undefined },
                {
                  label: equal ? 'Every disc' : `Disc ${str.maxIdx + 1} (line end)`,
                  value: fx(str.discV[str.maxIdx], 2),
                  unit: 'kV',
                  note: equal ? 'all discs equal' : `${fx((str.discV[str.maxIdx] / str.V) * 100, 1)} % of V; ${fx(str.discV[str.maxIdx] / (str.V / str.input.n), 2)}× an equal share`,
                },
                { label: 'Disc 1 (cross-arm end)', value: fx(str.discV[0], 2), unit: 'kV', note: `${fx((str.discV[0] / str.V) * 100, 1)} % of V` },
              ]}
            />
            {st.grading !== 'none' && (
              <>
                <p className="small">
                  Without {st.grading === 'guard' ? 'the ring' : 'grading'} this string’s efficiency would be {fx(str.effPlain * 100, 1)} %.{' '}
                  {st.grading === 'capacitance' ? 'Disc capacitances needed (× C, top first):' : 'Line-to-link capacitances needed (× C, link below disc 1 first):'}
                </p>
                <p className="small mech-mono">{(st.grading === 'capacitance' ? str.discC : str.lineC).map((x) => fx(x, 3)).join(' · ')}</p>
                <p className="small muted">
                  {st.grading === 'capacitance'
                    ? `C_k = C·(1 + m·k(k−1)/2): the line-end disc needs ${fx(str.discC[str.input.n - 1], 2)} times the top disc’s capacitance. Real strings approximate this with a few disc sizes.`
                    : 'An IDEAL guard ring: the line-to-link capacitances that cancel every shunt current exactly — a model of what a ring aims for, not of a particular ring’s shape. A real ring only approaches it; the nodal solve shows the voltages it would give.'}
                </p>
              </>
            )}
            <ChangeBox
              kind="string"
              change={change}
              items={[
                ['η', before ? before.eff * 100 : null, str.eff * 100, '%', 1],
                ['line-end disc', before ? Math.max(...before.discV) : null, Math.max(...str.discV), 'kV', 2],
              ]}
            />
            <p className="small muted">Each disc has the same self-capacitance C unless graded; leakage (surface current) is neglected — in wet weather it evens out the distribution somewhat.</p>
          </section>
        )}
      </div>
    </div>
  )
}

// ── corona ──────────────────────────────────────────────────────────────────────────────────────────────────

function CoronaPanel({
  design,
  cor,
  out,
  level,
  setCor,
  setStr,
  setSpan,
  change,
}: {
  design: Design
  cor: CoronaResult | null
  out: ReturnType<typeof coronaOf>
  level: string
  setCor(p: Partial<CoronaState>, what: string, why: string): void
  setStr(p: Partial<StringState>, what: string, why: string): void
  setSpan(p: Partial<SpanState>, what: string, why: string): void
  change: Change
}) {
  const beginner = level === 'beginner'
  const c = design.corona
  const cond = conductorOf(design.span)
  const before = change?.before.cor ?? null
  const plot = useMemo(() => {
    if (!cor) return null
    const D = cor.input.DCm
    const pts = Array.from({ length: 61 }, (_, i) => 0.3 + (i / 60) * 2.7)
    return {
      vc: pts.map((r) => [r, criticalDisruptive(c.m0, cor.delta, r, D)] as [number, number]),
      vv: pts.map((r) => [r, visualCritical(c.mv, cor.delta, r, D)] as [number, number]),
    }
  }, [cor, c.m0, c.mv])
  const bundles = cor ? ([1, 2, 3, 4] as const).map((nb) => ({ nb, g: bundleGradient(cor.vPhase, nb, cor.input.rCm, 40, cor.input.DCm) })) : []
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="mech-cor-h">
          <h3 id="mech-cor-h">Corona on this line</h3>
          <div className="ps-cols-2">
            <div>
              <p className="ps-slider-label">
                <span>Line voltage (line to line, kV)</span>
              </p>
              <Seg
                label="Line voltage"
                full
                value={String(design.string.kv)}
                onChange={(v) => setStr({ kv: Number(v) }, `Line voltage ${design.string.kv} → ${v} kV`, 'V_c does not depend on the operating voltage; whether the line is above it does.')}
                options={RANGES.kv.map((k) => ({ id: String(k), label: `${k}` }))}
              />
              <p className="ps-slider-label mech-gap">
                <span>Conductor (r = d/2)</span>
              </p>
              <Seg
                label="Conductor"
                full
                value={design.span.conductor}
                onChange={(v) =>
                  setSpan(
                    { conductor: v },
                    `Conductor → ${conductorOf({ ...design.span, conductor: v }).name.toLowerCase()}`,
                    'V_c ∝ r·ln(D/r): a thicker conductor has a weaker surface field at the same voltage.',
                  )
                }
                options={CONDUCTOR_OPTIONS(level === 'engineer' || design.span.conductor === 'custom')}
              />
              <p className="ps-hint">r = {fx((cond.d / 2) * 100, 3)} cm — the same conductor as the span</p>
            </div>
            <div>
              <Slider
                label="Spacing D between conductors"
                value={c.Dm}
                min={RANGES.Dm[0]}
                max={RANGES.Dm[1]}
                step={0.1}
                unit="m"
                decimals={1}
                onChange={(v) => setCor({ Dm: v }, `Spacing ${fx(c.Dm, 1)} → ${fx(v, 1)} m`, 'V_c ∝ ln(D/r): spacing helps, but only logarithmically.')}
                hint="use the GMD for an unsymmetrical line"
              />
              <Slider
                label="Air pressure b"
                value={c.b}
                min={RANGES.b[0]}
                max={RANGES.b[1]}
                step={0.5}
                unit="cmHg"
                decimals={1}
                onChange={(v) => setCor({ b: v }, `Pressure ${fx(c.b, 1)} → ${fx(v, 1)} cmHg`, 'δ ∝ b: thinner air breaks down at a lower field (V_c ∝ δ).')}
                hint="76 cmHg at sea level; lower at altitude"
              />
              {!beginner && (
                <Slider
                  label="Air temperature t"
                  value={c.t}
                  min={RANGES.t[0]}
                  max={RANGES.t[1]}
                  step={1}
                  unit="°C"
                  decimals={0}
                  onChange={(v) => setCor({ t: v }, `Temperature ${c.t} → ${v} °C`, 'δ ∝ 1/(273 + t): hot air is thinner.')}
                />
              )}
            </div>
          </div>
          {!beginner && (
            <details className="ps-more" open={level === 'engineer'}>
              <summary>Surface factors m₀ and m_v</summary>
              <div className="ps-cols-2 mech-more">
                <Slider
                  label="Irregularity factor m₀"
                  value={c.m0}
                  min={RANGES.m0[0]}
                  max={RANGES.m0[1]}
                  step={0.01}
                  decimals={2}
                  onChange={(v) => setCor({ m0: v }, `m₀ ${fx(c.m0, 2)} → ${fx(v, 2)}`, 'Strands, scratches, dirt and raindrops raise the local field: a lower m₀, a lower V_c.')}
                  hint="1 polished; about 0.80–0.87 stranded (typical textbook range)"
                />
                <Slider
                  label="Visual factor m_v"
                  value={c.mv}
                  min={RANGES.mv[0]}
                  max={RANGES.mv[1]}
                  step={0.01}
                  decimals={2}
                  onChange={(v) => setCor({ mv: v }, `m_v ${fx(c.mv, 2)} → ${fx(v, 2)}`, 'm_v scales the visual critical voltage the same way m₀ scales V_c.')}
                  hint="stranded: about 0.72 local, 0.82 general corona (typical)"
                />
              </div>
            </details>
          )}
        </section>
        {cor && plot && (
          <section className="ps-card mech-flush" aria-label="Critical voltages against conductor radius">
            <Plot
              label="Critical disruptive and visual critical voltage against conductor radius"
              xLabel="conductor radius r [cm]"
              yLabel="phase voltage [kV rms]"
              series={[
                { id: 'vc', label: 'V_c (disruptive)', color: 'var(--accent)', points: plot.vc },
                { id: 'vv', label: 'V_v (visual)', color: 'var(--warning)', points: plot.vv, dashed: true },
              ]}
              hlines={[{ y: cor.vPhase, label: `operating ${fx(cor.vPhase, 1)} kV` }]}
              vlines={[{ x: cor.input.rCm, label: `this conductor` }]}
              height={230}
            />
            <p className="small muted">
              Calculated with Peek’s formulas at D = {fx(c.Dm, 1)} m and δ = {fx(cor.delta, 3)}.
            </p>
          </section>
        )}
      </div>
      <div className="ps-stack">
        {!out.ok && <Issues issues={out.issues} title="Peek’s formula does not apply — no results" />}
        {cor && (
          <section className="ps-card" aria-labelledby="mech-cor-res">
            <h3 id="mech-cor-res">Critical voltages</h3>
            <Readouts
              items={[
                { label: 'V_c (phase)', value: fx(cor.vc, 1), unit: 'kV', note: `${fx(cor.vcLine, 1)} kV line to line` },
                {
                  label: 'Operating phase voltage',
                  value: fx(cor.vPhase, 1),
                  unit: 'kV',
                  tone: cor.above ? 'bad' : 'good',
                  note: cor.above ? `${fx((cor.vPhase / cor.vc - 1) * 100, 1)} % above V_c` : `${fx((1 - cor.vPhase / cor.vc) * 100, 1)} % below V_c`,
                },
                { label: 'Air density δ', value: fx(cor.delta, 4), note: `b = ${fx(c.b, 1)} cmHg, t = ${c.t} °C` },
              ]}
            />
            {!beginner && (
              <Readouts
                items={[
                  { label: 'V_v visual (phase)', value: fx(cor.vv, 1), unit: 'kV', note: coronaVerdict(cor).vvNote, tone: coronaVerdict(cor).consistent ? undefined : 'warn' },
                  { label: 'Surface gradient now', value: fx(cor.gSurface, 2), unit: 'kV/cm', note: `breakdown at m₀g₀δ = ${fx(cor.gCritical, 2)}` },
                ]}
              />
            )}
            <Callout tone={coronaVerdict(cor).tone}>{coronaVerdict(cor).text}</Callout>
            <ChangeBox kind="corona" change={change} items={[['V_c', before?.vc, cor.vc, 'kV', 1]]} />
            {!beginner && (
              <details className="ps-more">
                <summary>Bundled conductors</summary>
                <table className="ps-table">
                  <caption className="small muted">
                    Average surface gradient at {fx(cor.vPhase, 1)} kV, sub-conductors of r = {fx(cor.input.rCm, 2)} cm, 40 cm apart (computed; earth ignored)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Sub-conductors</th>
                      <th scope="col">g_avg [kV/cm]</th>
                      <th scope="col">vs m₀g₀δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundles.map((b) => (
                      <tr key={b.nb}>
                        <td>{b.nb}</td>
                        <td>{fx(b.g, 2)}</td>
                        <td>{b.g > cor.gCritical ? 'above' : 'below'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted">
                  The phase charge is shared by n sub-conductors: g = V/(n·r·ln(D/r_eq)), with r_eq the bundle’s equivalent radius from{' '}
                  <a className="ps-link" href={LP_HREF}>
                    Module 8
                  </a>
                  . This is the average gradient; the peak on each sub-conductor is somewhat higher. Peek’s V_c formula itself is for single conductors.
                </p>
              </details>
            )}
            <p className="small muted">
              Peek’s formulas are empirical — fitted to measurements on round conductors in air at power frequency. They assume D ≫ r, fair weather and a uniform surface (m₀ and m_v absorb its
              roughness). g₀ = 30 kV/cm peak = {fx(30 / Math.SQRT2, 2)} kV/cm rms (many textbooks round to 21.1). Peek’s corona-loss formula is not computed here.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}

// ── tour and tutor ──────────────────────────────────────────────────────────────────────────────────────────

function useTour(res: SpanResult | null, str: StringResult | null, geom: { L: number; hA: number; h: number; n: number }): TourStep[] | undefined {
  if (!res || !str) return undefined
  const n = str.input.n
  const equal = Math.max(...str.discV) - Math.min(...str.discV) < 1e-9 * str.V
  const k = str.maxIdx + 1
  const level = res.input.h === 0
  return [
    {
      title: 'One span',
      focus: ['conductor'],
      text: (
        <p>
          A {fx(res.input.L, 0)} m span between two towers. The conductor’s load ({fx(res.loads.wr, 2)} N/m{res.input.iceT > 0 ? ', with ice' : ''}
          {res.input.windP > 0 ? ', with wind' : ''}) pulls it down; the tension T₀ = {fx(kN(res.T0), 2)} kN at the lowest point holds it up. Its shape is computed: a catenary.
        </p>
      ),
    },
    {
      title: 'The sag',
      focus: ['low'],
      camera: [(res.low.x / res.input.L - 0.5) * 60 + 9, res.low.y + 6, 3.2 + res.low.z + 24],
      text: (
        <p>
          {level
            ? `The lowest point is ${fx(res.vSagA, 2)} m below the supports, at mid-span.`
            : `The lowest point is ${fx(res.vSagA, 2)} m below support A and ${fx(res.vSagB, 2)} m below support B, ${fx(res.low.x, 1)} m from A.`}{' '}
          Tightening the conductor reduces the sag; the price is tension the towers and the conductor must carry: {fx(kN(res.Tmax), 2)} kN at the {level ? 'supports' : 'higher support'}, a factor of
          safety of {fx(res.fosActual, 2)}.
        </p>
      ),
    },
    {
      title: 'The ground clearance',
      focus: ['ground'],
      camera: [(res.low.x / res.input.L - 0.5) * 60 + 15, Math.max(4, res.low.y * 0.5 + 3), 3.2 + res.low.z + 22],
      text: (
        <p>
          From the lowest point to the ground: {fx(res.clearance, 2)} m —{' '}
          {res.clearance >= res.input.minClear ? `${fx(res.clearance - res.input.minClear, 2)} m above` : `${fx(res.input.minClear - res.clearance, 2)} m below`} the minimum of{' '}
          {fx(res.input.minClear, 1)} m you set. Ice, heat (not modelled here) and a longer span all eat into it.
        </p>
      ),
    },
    {
      title: 'The insulator string',
      focus: ['disc-1'],
      camera: stringCamera(geom, 7.5),
      text: (
        <p>
          {n} discs hold the conductor away from the earthed tower. Each disc is a capacitor C; each link between discs also has a capacitance mC to the tower (m = {fx(str.input.m, 2)}). The colours
          are the computed shares of the {fx(str.V, 2)} kV phase voltage.
        </p>
      ),
    },
    {
      title: equal ? 'Every disc equal' : 'The most-stressed disc',
      focus: [`disc-${k}`],
      camera: stringCamera(geom, 5, k),
      text: equal ? (
        <p>
          With {str.input.grading === 'guard' ? 'the ideal guard ring' : str.input.grading === 'capacitance' ? 'capacitance grading' : 'no shunt capacitance (m = 0)'} every disc carries{' '}
          {fx(str.V / n, 2)} kV: the string efficiency is {fx(str.eff * 100, 1)} %.
        </p>
      ) : (
        <p>
          Disc {k}, nearest the line, carries {fx(str.discV[k - 1], 2)} kV — {fx((str.discV[k - 1] / str.V) * 100, 1)} % of the phase voltage, {fx(str.discV[k - 1] / (str.V / n), 2)} times an equal
          share. The charging currents of every link above pass through it. String efficiency: {fx(str.eff * 100, 1)} %. This is the disc that flashes over or punctures first.
        </p>
      ),
    },
  ]
}

function tutorText(d: Design, res: SpanResult | null, str: StringResult | null, cor: CoronaResult | null, view: ExploreView): string {
  const s = d.span
  const c = conductorOf(s)
  return [
    `Explore — Mechanical design (${view}). Span ${s.L} m, ${s.unequal ? `support B ${s.h} m higher, ` : 'level supports, '}support A ${s.hA} m, conductor w ${fx(c.w, 2)} N/m d ${fx(c.d * 1000, 1)} mm breaking ${fx(c.uts / 1000, 0)} kN, ${s.mode === 'T0' ? `T0 ${s.T0kN} kN` : `FoS ${s.fos}`}, ice ${s.ice ? `${s.iceMm} mm` : 'off'}, wind ${s.wind ? `${s.windPa} N/m²` : 'off'}.`,
    res
      ? `Results: w_r ${fx(res.loads.wr, 2)} N/m, θ ${fx(deg(res.loads.theta), 1)}°, sag (vertical) ${fx(res.vSagA, 3)} m, clearance ${fx(res.clearance, 2)} m (min ${s.minClear}), T0 ${fx(kN(res.T0), 2)} kN, support tension ${fx(kN(res.Tmax), 2)} kN, FoS ${fx(res.fosActual, 2)}, parabola differs ${fx(res.relDiff * 100, 3)} %.`
      : 'The span is invalid.',
    str
      ? `String: ${str.input.n} discs, m ${str.input.m}, ${str.input.kv} kV, ${str.input.grading}; disc voltages ${str.discV.map((v) => fx(v, 2)).join(', ')} kV; efficiency ${fx(str.eff * 100, 1)} %.`
      : '',
    cor ? `Corona: δ ${fx(cor.delta, 3)}, Vc ${fx(cor.vc, 1)} kV phase, Vv ${fx(cor.vv, 1)} kV, operating ${fx(cor.vPhase, 1)} kV.` : '',
  ].join(' ')
}
