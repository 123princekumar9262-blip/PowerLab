import { useMemo, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { TourStep } from '../../three/Scene3D.tsx'
import type { ModuleProps } from '../../types.ts'
import { fx } from '../../ui/format.ts'
import { Readouts, Seg, Slider, Toggle, useTutorContext, type ReadoutItem } from '../../ui/kit.tsx'
import { Chart, TimeBar } from './charts.tsx'
import { Coordination } from './coordination.tsx'
import { Experiments } from './experiment.tsx'
import { Lattice } from './Lattice.tsx'
import { Learn } from './learn.tsx'
import { Practise, Verify } from './practise.tsx'
import { WaveScene } from './Scene.tsx'
import { amps, InvalidModel, kv, LineView2D, MODULE, quartiles, termName, usePlayback, useSolved, type Solved } from './shared.tsx'
import {
  arrivals,
  convergence,
  firstPeak,
  isStepLike,
  LIMITS,
  MEDIA,
  MODEL0,
  nextMedium,
  profile,
  reflectionWords,
  steadyState,
  surgeCrest,
  SURGE_LABEL,
  TERM_LABEL,
  timeSeries,
  type MediumId,
  type SurgeKind,
  type Termination,
  type WaveModel,
} from './waves.ts'
import './transients.css'

/*
 * Module 15 — Transients & insulation coordination. One model (a lossless line between a source with R_s and a
 * termination, optional arrester) is solved exactly by waves.ts; the 3D wave, the 2D line view, the v(x) snapshot,
 * the probe's v(t) and the Bewley lattice are all drawn from that one solution at the chosen time. Learn: a guided
 * explanation. Explore: the model. Experiment: predict, then compare. Verify: by hand and against an independent
 * time-domain (Bergeron) solution. Practise: questions.
 */

const TERMS: Termination[] = ['open', 'short', 'matched', 'resistor', 'junction']

export default function TransientsModule({ mode, setMode }: ModuleProps) {
  const [model, setModel] = useState<WaveModel>(MODEL0)
  const [probeF, setProbeF] = useState(1)
  const [seen, setSeen] = useState<Termination[]>(['open'])
  return (
    <div className="tr">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore model={model} setModel={setModel} probeF={probeF} setProbeF={setProbeF} seen={seen} setSeen={setSeen} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify model={model} probeF={probeF} edited={model !== MODEL0} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}

// ── what changed, and why ──────────────────────────────────────────────────────────────────────────────────────

function describeChange(a: WaveModel, b: WaveModel): { what: string; why: string } | null {
  if (a.term !== b.term)
    return {
      what: `Termination ${TERM_LABEL[a.term].toLowerCase()} → ${TERM_LABEL[b.term].toLowerCase()}`,
      why: 'The load at the end sets Γ_L = (Z_L − Z_c)/(Z_L + Z_c): how much of each wave comes back, and with which sign.',
    }
  if (a.surge !== b.surge)
    return {
      what: `Surge ${SURGE_LABEL[a.surge]} → ${SURGE_LABEL[b.surge]}`,
      why: b.arrester
        ? 'The coefficients do not change, but the arrester acts only on the part of each wave above V_res, so the result is not a scaled copy of the surge.'
        : 'The coefficients do not change — every wave is the same shape as the source surge, shifted and scaled; the voltage at a point is their sum.',
    }
  if (a.rs !== b.rs)
    return { what: `Source resistance ${fx(a.rs, 0)} → ${fx(b.rs, 0)} Ω`, why: 'R_s sets the launched fraction k = Z_c/(R_s + Z_c) and the source-end reflection Γ_s, so how the reflections die out.' }
  if (a.rl !== b.rl) return { what: `Terminating resistance ${fx(a.rl, 0)} → ${fx(b.rl, 0)} Ω`, why: 'Γ_L depends on Z_L: above Z_c it is positive (the voltage rises), below Z_c negative.' }
  if (a.line !== b.line)
    return { what: `Line → ${MEDIA[b.line].short}`, why: 'A different L and C: a different Z_c (so every Γ and the launched fraction) and a different speed (so every travel time).' }
  if (a.lengthKm !== b.lengthKm)
    return {
      what: `Length ${fx(a.lengthKm, 1)} → ${fx(b.lengthKm, 1)} km`,
      why: isStepLike(b.surge)
        ? 'Only the travel time T = ℓ/v changes: the same waves, stretched in time. For a step the voltages after each arrival do not depend on ℓ.'
        : 'The travel time T = ℓ/v changes, so the shifted copies of this surge overlap differently and the voltages change.',
    }
  if (a.ekv !== b.ekv)
    return {
      what: `Surge amplitude ${fx(a.ekv, 0)} → ${fx(b.ekv, 0)} kV`,
      why: b.arrester ? 'Voltages below V_res scale in proportion; the arrester still caps the end at V_res.' : 'The line is linear: every voltage scales in proportion.',
    }
  if (a.arrester !== b.arrester)
    return { what: b.arrester ? 'Arrester fitted at the far end' : 'Arrester removed', why: 'The arrester conducts only above V_res, so it caps the end voltage; below V_res it does nothing.' }
  if (a.vres !== b.vres) return { what: `Residual voltage ${fx(a.vres, 0)} → ${fx(b.vres, 0)} kV`, why: 'The clamp level: the end voltage cannot exceed it.' }
  if (a.steep !== b.steep)
    return { what: `Front steepness ${fx(a.steep, 0)} → ${fx(b.steep, 0)} kV/µs`, why: 'A steeper front reaches its crest sooner, so more of its rise happens before reflections return.' }
  return null
}

interface Summary {
  gammaL: number
  peak: number
  ss: string
}
function summarise(s: Solved): Summary | null {
  if (!s.an || !s.f) return null
  const ss = steadyState(s.an)
  return { gammaL: s.an.gammaL, peak: firstPeak(s.f, s.an.lengthM).v, ss: ss.kind === 'value' ? kv(ss.v) : ss.kind === 'decays' ? '0 kV (the surge decays)' : `none (${ss.note})` }
}

// ── Explore ────────────────────────────────────────────────────────────────────────────────────────────────────

function Explore({
  model,
  setModel,
  probeF,
  setProbeF,
  seen,
  setSeen,
}: {
  model: WaveModel
  setModel(m: WaveModel): void
  probeF: number
  setProbeF(p: number): void
  seen: Termination[]
  setSeen(s: Termination[]): void
}) {
  const level = useLevel()
  const progress = usePsProgress()
  const s = useSolved(model)
  const an = s.an
  const f = s.f
  const [selected, setSelected] = useState<string | null>(null)
  const [change, setChange] = useState<{ what: string; why: string; before: Summary | null } | null>(null)
  const pb = usePlayback(an?.window ?? 1, an?.T ?? 1, `${model.line}|${model.lengthKm}`, an ? Math.min(an.window, 1.5 * an.T) : 0)
  const t = Math.min(pb.t, an?.window ?? 0)
  const probeX = an ? probeF * an.lengthM : 0

  const update = (next: WaveModel) => {
    const c = describeChange(model, next)
    if (c) setChange({ ...c, before: summarise(s) })
    setModel(next)
  }
  const set = (patch: Partial<WaveModel>) => update({ ...model, ...patch })
  const setTerm = (term: Termination) => {
    set({ term })
    if (!seen.includes(term)) {
      const n = [...seen, term]
      setSeen(n)
      if (n.length >= TERMS.length) completeActivity(MODULE, 'terminations')
    }
  }
  const pickFromLattice = (v: number) => {
    pb.setPlaying(false)
    pb.setT(v)
    completeActivity(MODULE, 'lattice')
  }

  const ss = an ? steadyState(an) : null
  const peak = an && f ? firstPeak(f, an.lengthM) : null
  const incCrest = an ? an.k * surgeCrest(model.surge, model.ekv) : 0
  const now = an && f ? { v: f.v(probeX, t), i: f.i(probeX, t), end: f.end(t) } : null
  const vt = useMemo(() => (f && an ? timeSeries(f, probeX, 700) : []), [f, an, probeX])
  const it = useMemo(() => (f && an ? timeSeries(f, probeX, 700, 'i') : []), [f, an, probeX])
  const snap = useMemo(() => (f ? profile(f, t, 240) : []), [f, t])
  const hits = an ? arrivals(an, probeX) : []
  const conv = useMemo(() => (f && an && isStepLike(model.surge) ? convergence(f, 8) : []), [f, an, model.surge])
  const after = summarise(s)

  const fallback = <LineView2D s={s} t={t} probeX={probeX} />
  const show = (tt: number) => (
    <button type="button" className="text-btn tr-tour-btn" onClick={() => pickTime(tt)}>
      Show t = {fx(tt, 2)} µs
    </button>
  )
  const pickTime = (tt: number) => {
    pb.setPlaying(false)
    pb.setT(tt)
  }
  const tour: TourStep[] | undefined =
    an && f
      ? [
          {
            title: 'The surge is launched',
            focus: ['source'],
            camera: [-2, 12, 34],
            text: (
              <>
                <p>
                  The source e(t) drives the line through R_s = {fx(model.rs, 0)} Ω. The line at first looks like a resistance Z_c = {fx(an.zc, 1)} Ω, so the wave launched is k = Z_c/(R_s + Z_c) ={' '}
                  {fx(an.k, 3)} of the source voltage: {kv(incCrest)} at the crest.
                </p>
                {show(0.3 * an.T)}
              </>
            ),
          },
          {
            title: 'The incident wave travels',
            focus: ['line'],
            text: (
              <>
                <p>
                  The front moves at v = {fx(an.line.v, 1)} m/µs, charging the line’s capacitance as it goes. A tenth of the way along, half a travel time in, the voltage is{' '}
                  {kv(f.v(0.1 * an.lengthM, 0.5 * an.T))} and the current {amps(f.i(0.1 * an.lengthM, 0.5 * an.T))} — their ratio is Z_c. It reaches the end after T = {fx(an.T, 2)} µs.
                </p>
                {show(0.7 * an.T)}
              </>
            ),
          },
          {
            title: 'Reflection at the end',
            focus: ['termination'],
            camera: [58, 14, 30],
            text: (
              <>
                <p>
                  At the {termName(model, an)} Γ_L = {fx(an.gammaL, 3)} ({reflectionWords(an.gammaL)}). {model.arrester ? 'With the arrester the end voltage is capped at V_res.' : ''} The end voltage
                  after the arrival is {kv(f.end(1.5 * an.T).v)}, and a reflected wave of {kv(f.R(1.5 * an.T))} heads back to the source.
                </p>
                {show(1.4 * an.T)}
              </>
            ),
          },
          {
            title: 'Many reflections: the lattice',
            focus: ['probe'],
            text: (
              <>
                <p>
                  Each wave is reflected again at the source (Γ_s = {fx(an.gammaS, 3)}). The lattice diagram below the 3D view draws every one of them; the voltage at the probe is the sum of those
                  that have reached it.{' '}
                  {ss?.kind === 'value'
                    ? `For this step-like source they settle at the DC value ${kv(ss.v)}.`
                    : ss?.kind === 'decays'
                      ? 'This surge itself decays, so every voltage returns to zero.'
                      : ss?.kind === 'none'
                        ? `Here there is no steady state: ${ss.note}.`
                        : ''}
                </p>
                {show(3.5 * an.T)}
              </>
            ),
          },
        ]
      : undefined

  const info = (id: string) => {
    if (!an || !f || !now) return <p className="small">No values: the inputs are not valid.</p>
    const rows: Array<[string, string]> =
      id === 'source'
        ? [
            ['e(t) now', kv(f.e(t))],
            ['R_s', `${fx(model.rs, 0)} Ω`],
            ['Γ_s', fx(an.gammaS, 3)],
            ['Launched fraction k', fx(an.k, 4)],
            ['Voltage at x = 0', kv(f.v(0, t))],
            ['Current into the line', amps(f.i(0, t))],
          ]
        : id === 'line'
          ? [
              ['L', `${fx(an.line.lMhKm, 4)} mH/km`],
              ['C', `${fx(an.line.cNfKm, 3)} nF/km`],
              ['Z_c = √(L/C)', `${fx(an.zc, 1)} Ω`],
              ['v = 1/√(LC)', `${fx(an.line.v, 1)} m/µs`],
              ['Length ℓ', `${fx(model.lengthKm, 1)} km`],
              ['Travel time T', `${fx(an.T, 2)} µs`],
            ]
          : id === 'termination'
            ? [
                ['Z_L', an.zl === Infinity ? '∞ (open)' : `${fx(an.zl, 1)} Ω`],
                ['Γ_L', fx(an.gammaL, 4)],
                ['τ = 1 + Γ_L', fx(an.tauL, 4)],
                ['End voltage now', kv(now.end.v)],
                ['Line current at the end', amps(now.end.iLine)],
                ['Current in the load', amps(now.end.iLoad)],
              ]
            : id === 'arrester'
              ? model.arrester
                ? [
                    ['Residual voltage V_res', kv(model.vres, 0)],
                    ['State now', now.end.clamped && t >= an.T ? 'clamping' : 'not conducting'],
                    ['Arrester current now', amps(now.end.iArr)],
                  ]
                : [['Fitted', 'no — switch it on under “Line, probe and arrester”']]
              : [
                  ['Position', `${fx(probeX / 1000, 2)} km (${fx(probeF * 100, 0)} % of ℓ)`],
                  ['v now', kv(now.v)],
                  ['i now (+ towards the end)', amps(now.i)],
                  ['Waves arrive at', hits.map((h) => fx(h.t, 1)).join(', ') + ' µs'],
                ]
    return (
      <dl className="tr-info">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    )
  }

  useTutorContext(
    () =>
      `Explore — travelling waves. ${MEDIA[model.line].name}, ${model.lengthKm} km; source ${SURGE_LABEL[model.surge]} ${model.surge === 'switching' ? '1 pu' : `${model.ekv} kV`}, R_s ${model.rs} Ω; termination ${termName(model, an)}; arrester ${model.arrester ? `on, V_res ${model.vres} kV` : 'off'}. ${an ? `Zc ${fx(an.zc, 1)} Ω, v ${fx(an.line.v, 1)} m/µs, T ${fx(an.T, 2)} µs, Γ_L ${fx(an.gammaL, 4)}, Γ_s ${fx(an.gammaS, 4)}, k ${fx(an.k, 4)}. Time shown t = ${fx(t, 2)} µs; probe at ${fx(probeX / 1000, 2)} km reads ${fx(now?.v ?? NaN, 1)} kV. First peak at the end ${fx(peak?.v ?? NaN, 1)} kV.` : 'Invalid inputs.'}`,
  )

  const main: ReadoutItem[] =
    an && f && peak && ss && now
      ? [
          { label: model.arrester ? 'Γ_L (without the arrester)' : 'Reflection at the end Γ_L', value: fx(an.gammaL, 3), note: reflectionWords(an.gammaL) },
          {
            label: 'First peak at the far end',
            value: fx(peak.v, 1),
            unit: 'kV',
            note: incCrest !== 0 ? `${fx(peak.v / incCrest, 3)} × the incident crest ${fx(incCrest, 0)} kV` : undefined,
            tone: model.arrester && Math.abs(Math.abs(peak.v) - model.vres) < 1e-6 ? 'warn' : undefined,
          },
          {
            label: 'Steady state (closed form)',
            value: ss.kind === 'value' ? fx(ss.v, 1) : ss.kind === 'decays' ? '0' : 'none',
            unit: ss.kind === 'none' ? undefined : 'kV',
            note: ss.kind === 'value' ? (ss.arresterHolds ? 'held by the arrester' : 'E·Z_L/(R_s + Z_L)') : ss.kind === 'decays' ? 'the impulse returns to zero' : ss.note,
          },
          { label: `Probe at t = ${fx(t, 1)} µs`, value: fx(now.v, 1), unit: 'kV', note: `${fx(probeX / 1000, 2)} km from the source` },
        ]
      : []
  const more: ReadoutItem[] =
    an && f && now
      ? [
          { label: 'Surge impedance Z_c', value: fx(an.zc, 1), unit: 'Ω', note: '√(L/C)' },
          { label: 'Velocity v', value: fx(an.line.v, 1), unit: 'm/µs', note: `${fx((an.line.v / 299.792458) * 100, 1)} % of light speed` },
          { label: 'Travel time T', value: fx(an.T, 2), unit: 'µs', note: 'ℓ / v' },
          { label: 'Source reflection Γ_s', value: fx(an.gammaS, 3), note: '(R_s − Z_c)/(R_s + Z_c)' },
          { label: 'Launched fraction k', value: fx(an.k, 4), note: 'Z_c/(R_s + Z_c)' },
          { label: 'Probe current now', value: fx(now.i, 0), unit: 'A', note: '+ towards the end' },
        ]
      : []

  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <span className="small muted">End:</span>
          <Seg
            label="Termination"
            value={model.term}
            onChange={setTerm}
            options={TERMS.map((id) => ({ id, label: id === 'junction' ? (nextMedium(model).kind === 'cable' ? 'Into cable' : 'Into line') : TERM_LABEL[id] }))}
          />
          <button
            type="button"
            className="text-btn"
            disabled={model === MODEL0 && probeF === 1}
            onClick={() => {
              setChange(null)
              setModel(MODEL0)
              setProbeF(1)
              pb.setT(1.5 * (solvedT(MODEL0) ?? 1))
            }}
          >
            Reset
          </button>
        </div>
        <span className="small muted">{isDone(progress, MODULE, 'terminations') ? '✓ all five terminations tried' : `${seen.length} of ${TERMS.length} terminations tried`}</span>
      </div>
      <section className="ps-card tr-primary" aria-label="Main controls">
        <div className="tr-primary-row">
          <div>
            <p className="ps-slider-label">
              <span>Surge shape</span>
            </p>
            <Seg
              label="Surge shape"
              value={model.surge}
              onChange={(v: SurgeKind) => set({ surge: v })}
              options={(['step', 'impulse', 'switching', ...(level === 'engineer' || model.surge === 'ramp' ? (['ramp'] as SurgeKind[]) : [])] as SurgeKind[]).map((id) => ({
                id,
                label: SURGE_LABEL[id],
              }))}
            />
            <p className="ps-hint">
              {model.surge === 'step'
                ? `a ${fx(model.ekv, 0)} kV step`
                : model.surge === 'impulse'
                  ? `the standard lightning-impulse shape, crest ${fx(model.ekv, 0)} kV`
                  : model.surge === 'switching'
                    ? 'closing onto the line at the source’s peak, 1 pu (taken as a step)'
                    : `a ramp of ${fx(model.steep, 0)} kV/µs up to ${fx(model.ekv, 0)} kV`}
            </p>
          </div>
          <Slider
            label="Source resistance R_s"
            value={model.rs}
            min={LIMITS.rs[0]}
            max={LIMITS.rs[1]}
            step={5}
            unit="Ω"
            decimals={0}
            onChange={(v) => set({ rs: v })}
            hint={
              an
                ? `Γ_s = ${fx(an.gammaS, 3)} · ${Math.abs(model.rs - an.zc) < 2.5 ? 'matched: nothing returns from the source' : model.rs < an.zc ? 'below Z_c: returning waves come back inverted' : 'above Z_c: returning waves come back with the same sign'}`
                : undefined
            }
          />
          {model.term === 'resistor' && (
            <Slider
              label="Terminating resistance R_L"
              value={model.rl}
              min={LIMITS.rl[0]}
              max={LIMITS.rl[1]}
              step={5}
              unit="Ω"
              decimals={0}
              onChange={(v) => set({ rl: v })}
              hint="a large resistance is a simplified stand-in for a transformer (really mostly capacitive to a fast surge)"
            />
          )}
        </div>
      </section>
      <InvalidModel out={s.out} />
      {an && f && (
        <>
          <WaveScene s={s} t={t} probeX={probeX} selected={selected} onSelect={setSelected} fallback={fallback} info={info} tour={tour} />
          <TimeBar t={t} setT={pb.setT} window={an.window} T={an.T} playing={pb.playing} setPlaying={pb.setPlaying} />
          <section className="ps-card" aria-labelledby="tr-res">
            <h3 id="tr-res">Results</h3>
            <Readouts label="Main results" items={main} />
            {level === 'beginner' ? (
              <details className="ps-more">
                <summary>More results</summary>
                <Readouts label="More results" items={more} />
              </details>
            ) : (
              <Readouts label="More results" items={more} />
            )}
            {change && after && (
              <div className="tr-change" aria-live="polite">
                <p className="small">
                  <b>You changed:</b> {change.what}.
                </p>
                {change.before && (
                  <p className="small">
                    Γ_L {fx(change.before.gammaL, 3)} → {fx(after.gammaL, 3)} · first peak at the end {fx(change.before.peak, 1)} → {fx(after.peak, 1)} kV · steady state {change.before.ss} →{' '}
                    {after.ss}
                  </p>
                )}
                <p className="small muted">Why: {change.why}</p>
              </div>
            )}
          </section>
          <details className="ps-card ps-more tr-graphs" open={level !== 'beginner'}>
            <summary>The lattice diagram and the voltage plots (linked by the time cursor)</summary>
            <div className="tr-pair">
              <div className="tr-pair-col">
                <Lattice f={f} t={t} onT={pickFromLattice} probeX={probeX} />
              </div>
              <div className="tr-pair-col">
                <Chart
                  series={[{ id: 'vp', label: `v at the probe (${fx(probeX / 1000, 2)} km)`, color: 'var(--ps-a)', points: vt }]}
                  xLabel="Time t [µs]"
                  yLabel="Voltage [kV]"
                  xUnit="µs"
                  yUnit="kV"
                  xDomain={[0, an.window]}
                  cursor={t}
                  onCursor={pickTime}
                  marks={hits.map((h) => ({ x: h.t }))}
                  hlines={[
                    ...(ss?.kind === 'value' && !ss.arresterHolds ? [{ y: ss.v, label: `steady state ${fx(ss.v, 0)} kV`, tone: 'muted' as const }] : []),
                    ...(model.arrester ? [{ y: model.vres, label: `V_res ${fx(model.vres, 0)} kV`, tone: 'warn' as const }] : []),
                  ]}
                  height={210}
                  label="Voltage at the probe against time; choose a time"
                />
                <Chart
                  series={[{ id: 'vx', label: `v along the line at t = ${fx(t, 2)} µs`, color: 'var(--ps-c)', points: snap }]}
                  xLabel="Distance from the source x [km]"
                  yLabel="Voltage [kV]"
                  xUnit="km"
                  yUnit="kV"
                  xDomain={[0, model.lengthKm]}
                  yDomain={[-s.vmax * 1.08, s.vmax * 1.08]}
                  cursor={probeX / 1000}
                  height={190}
                  label="Voltage along the line at the chosen time"
                  data={{ wave: quartiles(snap), t: t.toFixed(4) }}
                />
              </div>
            </div>
            <p className="small muted">
              Sign convention: voltages to earth; each wave’s current is positive in its own direction of travel (i = v/Z_c), and the line current is reported positive towards the termination. Marks
              under the time axis: the instants a wave reaches the probe.
            </p>
          </details>
          <section className="ps-card" aria-labelledby="tr-std">
            <details className="ps-more" open={level !== 'beginner'}>
              <summary id="tr-std">Line, probe and arrester</summary>
              <div className="ps-cols-2">
                <div>
                  <p className="ps-slider-label">
                    <span>The line (Z_c and v)</span>
                  </p>
                  <Seg
                    label="Line type"
                    full
                    value={model.line}
                    onChange={(v: MediumId) => set({ line: v })}
                    options={(['ohl-twin', 'ohl-single', 'cable'] as MediumId[]).map((id) => ({ id, label: MEDIA[id].short }))}
                  />
                  <p className="ps-hint">
                    {MEDIA[model.line].source}: Z_c {fx(MEDIA[model.line].zc, 1)} Ω, v {fx(MEDIA[model.line].v, 1)} m/µs.
                  </p>
                  <Slider label="Line length ℓ" value={model.lengthKm} min={LIMITS.lengthKm[0]} max={LIMITS.lengthKm[1]} step={0.1} unit="km" decimals={1} onChange={(v) => set({ lengthKm: v })} />
                  <Slider
                    label="Probe position"
                    value={probeF * 100}
                    min={0}
                    max={100}
                    step={5}
                    unit="% of ℓ"
                    decimals={0}
                    onChange={(v) => setProbeF(v / 100)}
                    hint={`${fx(probeX / 1000, 2)} km from the source`}
                  />
                </div>
                <div>
                  {model.surge !== 'switching' && (
                    <Slider
                      label="Surge amplitude E"
                      value={model.ekv}
                      min={LIMITS.ekv[0]}
                      max={LIMITS.ekv[1]}
                      step={50}
                      unit="kV"
                      decimals={0}
                      onChange={(v) => set({ ekv: v })}
                      hint="step height, or crest of the impulse / ramp"
                    />
                  )}
                  <Toggle label="Surge arrester at the far end" checked={model.arrester} onChange={(v) => set({ arrester: v })} />
                  <p className="ps-hint">An ideal clamp: no current below V_res, any current needed to hold V_res above it (simplified).</p>
                  {level === 'engineer' || model.arrester ? (
                    <Slider
                      label="Arrester residual voltage V_res"
                      value={model.vres}
                      min={LIMITS.vres[0]}
                      max={LIMITS.vres[1]}
                      step={10}
                      unit="kV"
                      decimals={0}
                      onChange={(v) => set({ vres: v })}
                      hint="illustrative value"
                    />
                  ) : null}
                  {(level === 'engineer' || model.surge === 'ramp') && (
                    <Slider
                      label="Front steepness S (ramp surge)"
                      value={model.steep}
                      min={LIMITS.steep[0]}
                      max={LIMITS.steep[1]}
                      step={50}
                      unit="kV/µs"
                      decimals={0}
                      onChange={(v) => set({ steep: v })}
                    />
                  )}
                </div>
              </div>
            </details>
          </section>
          {(level === 'engineer' || isStepLike(model.surge)) && conv.length > 0 && (
            <details className="ps-card ps-more" open={level === 'engineer'}>
              <summary>Convergence to the steady state, round trip by round trip</summary>
              <Convergence conv={conv} ss={ss} rho={an.rho} linear={!model.arrester} />
            </details>
          )}
          {level !== 'beginner' && (
            <details className="ps-card ps-more" open={level === 'engineer'}>
              <summary>Current at the probe{model.arrester ? ' and in the arrester' : ''}</summary>
              <Chart
                series={[
                  { id: 'ip', label: 'i at the probe (+ towards the end)', color: 'var(--ps-b)', points: it },
                  ...(model.arrester
                    ? [{ id: 'ia', label: 'arrester current', color: 'var(--warning)', points: timeSeries(f, an.lengthM, 500).map(([tt]) => [tt, f.end(tt).iArr] as [number, number]), dashed: true }]
                    : []),
                ]}
                xLabel="Time t [µs]"
                yLabel="Current [A]"
                xUnit="µs"
                yUnit="A"
                xDomain={[0, an.window]}
                cursor={t}
                onCursor={pickTime}
                height={200}
                width={1150}
                label="Current against time"
              />
            </details>
          )}
        </>
      )}
      <details className="ps-card ps-more" open={level === 'engineer'}>
        <summary>Insulation coordination: arrester, separation distance and BIL</summary>
        <Coordination vres={model.vres} setVres={(v) => set({ vres: v })} />
      </details>
    </div>
  )
}

const solvedT = (m: WaveModel) => {
  const l = MEDIA[m.line]
  return (m.lengthKm * 1000) / l.v
}

function Convergence({ conv, ss, rho, linear }: { conv: Array<{ n: number; t: number; v: number; err: number | null }>; ss: ReturnType<typeof steadyState> | null; rho: number; linear: boolean }) {
  return (
    <div className="ps-stack">
      <div className="table-wrap">
        <table className="ps-table">
          <caption className="sr-only">Far-end voltage after each round trip</caption>
          <thead>
            <tr>
              <th scope="col">After arrival</th>
              <th scope="col">
                Far-end voltage <span className="tr-unit">[kV]</span>
              </th>
              <th scope="col">
                Minus the closed-form steady state <span className="tr-unit">[kV]</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {conv.map((c) => (
              <tr key={c.n}>
                <td>{2 * c.n + 1}T</td>
                <td className="tr-num">{fx(c.v, 2)}</td>
                <td className="tr-num">{c.err === null ? '—' : fx(c.err, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {ss?.kind === 'value'
          ? Math.abs(rho) >= 1 - 1e-12
            ? `The closed-form steady state is ${kv(ss.v)}: with R_s = 0 every wave would be reflected in full, but the arrester removed the overshoot while it conducted and what is left balances exactly at both ends${ss.arresterHolds ? ' — with the arrester carrying a constant current for ever (a real arrester cannot; it would overheat)' : ''}.`
            : ss.arresterHolds
              ? `The closed-form steady state is ${kv(ss.v)}: the DC value E·Z_L/(R_s + Z_L) would exceed V_res, so the ideal clamp would have to hold it — a real arrester cannot conduct indefinitely (it would overheat).`
              : !linear
                ? `The closed-form steady state is ${kv(ss.v)} = E·Z_L/(R_s + Z_L), below V_res, so the arrester is idle at the end. While it clamps, the end is non-linear and the differences do not follow Γ_s·Γ_L exactly.`
                : Math.abs(rho) < 1e-12
                  ? `The closed-form steady state is ${kv(ss.v)} = E·Z_L/(R_s + Z_L). Here Γ_s·Γ_L = 0: no wave comes back after the first arrival, so the far end is at its final value from then on (the differences above are zero).`
                  : `The closed-form steady state is ${kv(ss.v)} = E·Z_L/(R_s + Z_L). Each round trip multiplies the remaining difference by Γ_s·Γ_L = ${fx(rho, 4)}, so it shrinks but a truncated sum never equals the final value exactly.`
          : ss?.kind === 'none'
            ? ss.reason
            : ''}
      </p>
    </div>
  )
}
