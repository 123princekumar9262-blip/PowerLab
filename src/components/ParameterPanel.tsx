import { useEffect, useId, useState, type ReactNode } from 'react'
import { LIMITS } from '../simulation/params.ts'
import type { FieldKey } from '../challenges/challenges.ts'
import type { Density } from '../state/labState.ts'
import { alwaysControlled, isThreePhase, supportsFreewheel, type LabParams, type LoadType, type ParamIssue, type RectifierTopology, type ResolvedParams } from '../types/simulation.ts'
import { THREE_PHASE_DEFAULTS } from '../simulation/params.ts'
import { formatSI } from '../utils/format.ts'

interface Props {
  topology: RectifierTopology
  load: LoadType
  params: LabParams
  resolved: ResolvedParams | null
  issues: ParamIssue[]
  computeMs: number | null
  samples: number | null
  onChange: (p: LabParams) => void
  onReset: () => void
  /** When set (challenge mode), only these fields can be changed; the rest are locked. */
  editable?: FieldKey[]
  /** Engineer density opens the advanced parameters by default. */
  density?: Density
  /** Circuit choices shown first in Basic (the workspace shell puts the load selector here). */
  loadPicker?: ReactNode
}

export function ParameterPanel({ topology, load, params, resolved, issues, computeMs, samples, onChange, onReset, editable, density, loadPicker }: Props) {
  // Advanced parameters: open for engineers, or when a challenge unlocks one of them.
  const ADV_KEYS: FieldKey[] = ['inductance', 'capacitance', 'diode', 'phase', 'vf', 'ron', 'cycles', 'timestep']
  const advDefault = density === 'engineer' || !!editable?.some((k) => ADV_KEYS.includes(k))
  const [advOpen, setAdvOpen] = useState(advDefault)
  useEffect(() => setAdvOpen(advDefault), [advDefault])
  const three = isThreePhase(topology)
  const tp = params.threePhase ?? THREE_PHASE_DEFAULTS.threePhase!
  const ctl = params.control ?? THREE_PHASE_DEFAULTS.control!
  const scrPossible = !alwaysControlled(topology)
  const scr = alwaysControlled(topology) || ctl.device === 'scr'
  // Three-way diode model on top of the engine's (ideal | real with Vf + Ron).
  const diodeMode = params.diode.model === 'ideal' ? 'ideal' : params.diode.ron > 0 ? 'pwl' : 'vf'
  const locked = (k: FieldKey) => editable !== undefined && !editable.includes(k)
  // Controls that are never challenge parameters are simply locked during a challenge.
  const lockAll = editable !== undefined
  const hasL = load === 'RL' || load === 'RLC'
  const hasC = load === 'RC' || load === 'RLC'
  const set = <K extends keyof LabParams>(group: K, patch: Partial<LabParams[K]>) => onChange({ ...params, [group]: { ...params[group], ...patch } })
  const ideal = params.diode.model === 'ideal'

  return (
    <section className="params" aria-labelledby="params-title">
      <header className="section-head section-head--row">
        <h2 id="params-title" className="eyebrow">Parameters</h2>
        {editable ? (
          <span className="muted small">🔒 challenge: some fields locked</span>
        ) : (
          <button className="text-btn" onClick={onReset}>
            Defaults
          </button>
        )}
      </header>

      <div className="param-group">
        <h3 className="group-title">Basic</h3>
        {loadPicker}
        <NumberField disabled={locked('vrms')} label={three ? 'Phase voltage' : 'Vrms'} hint={three ? `RMS per phase · VLL = √3·Vph = ${(Math.sqrt(3) * params.source.vrms).toFixed(2)} V` : 'Source RMS voltage'} unit="V" value={params.source.vrms} limits={LIMITS.vrms} slider={{ min: 1, max: 50, step: 0.5 }} onCommit={(v) => set('source', { vrms: v })} />
        <NumberField disabled={locked('frequency')} label="Frequency" hint="Source frequency f" unit="Hz" value={params.source.frequency} limits={LIMITS.frequency} slider={{ min: 1, max: 1000, log: true }} onCommit={(v) => set('source', { frequency: v })} />
        <NumberField disabled={locked('resistance')} label="Resistance" hint="Load resistance R" unit="Ω" value={params.load.resistance} limits={LIMITS.resistance} slider={{ min: 0.1, max: 100000, log: true }} onCommit={(v) => set('load', { resistance: v })} />
        {scr && (
          <NumberField
            disabled={locked('alpha')}
            label="Firing angle α"
            hint="Gate delay after each natural turn-on point"
            unit="°"
            value={ctl.alphaDeg}
            limits={LIMITS.alphaDeg}
            slider={{ min: 0, max: 180, step: 1 }}
            onCommit={(v) => set('control', { ...ctl, alphaDeg: v })}
          />
        )}
        {!advOpen && (hasL || hasC) && (
          <p className="adv-summary muted small">
            {[hasL && `L = ${roundSig(params.load.inductance * 1e3)} mH`, hasC && `C = ${roundSig(params.load.capacitance * 1e6)} µF`].filter(Boolean).join(' · ')} — in Advanced
          </p>
        )}
      </div>

      <details className="param-group advanced" open={advOpen} onToggle={(e) => setAdvOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="group-title">Advanced parameters</summary>

        {(hasL || hasC) && (
          <div className="adv-group">
            <h4 className="adv-title">Load elements</h4>
            {hasL && (
              <NumberField
                disabled={locked('inductance')}
                label="Inductance"
                hint={load === 'RL' ? 'Load inductance L' : 'Filter choke L'}
                unit="mH"
                value={roundSig(params.load.inductance * 1e3)}
                limits={{ min: LIMITS.inductance.min * 1e3, max: LIMITS.inductance.max * 1e3 }}
                slider={{ min: 0.1, max: 5000, log: true }}
                onCommit={(v) => set('load', { inductance: v / 1e3 })}
              />
            )}
            {hasC && (
              <NumberField
                disabled={locked('capacitance')}
                label="Capacitance"
                hint="Filter capacitor C"
                unit="µF"
                value={roundSig(params.load.capacitance * 1e6)}
                limits={{ min: LIMITS.capacitance.min * 1e6, max: LIMITS.capacitance.max * 1e6 }}
                slider={{ min: 1, max: 100000, log: true }}
                onCommit={(v) => set('load', { capacitance: v / 1e6 })}
              />
            )}
          </div>
        )}

        <div className="adv-group">
          <h4 className="adv-title">Devices</h4>
          <div className="field">
            <span className="field-label">Diode model</span>
            <div className="seg seg--full" role="radiogroup" aria-label="Diode model">
              {(
                [
                  ['ideal', 'Ideal', 'Perfect switch: Vf = 0, Ron = 0'],
                  ['vf', 'Constant Vf', 'Constant forward drop Vf while conducting'],
                  ['pwl', 'Vf + Ron', 'Piecewise linear: vD = Vf + Ron·i'],
                ] as const
              ).map(([m, label, title]) => (
                <button
                  key={m}
                  role="radio"
                  title={title}
                  disabled={locked('diode')}
                  aria-checked={diodeMode === m}
                  className={diodeMode === m ? 'on' : ''}
                  onClick={() => set('diode', m === 'ideal' ? { model: 'ideal' } : m === 'vf' ? { model: 'real', ron: 0 } : { model: 'real', ron: params.diode.ron > 0 ? params.diode.ron : 0.1 })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <NumberField label="Forward voltage Vf" hint={ideal ? 'Ideal diode uses 0 V' : 'Knee voltage of D1'} unit="V" value={params.diode.vf} limits={LIMITS.vf} slider={{ min: 0, max: 2, step: 0.05 }} disabled={ideal || locked('vf')} onCommit={(v) => set('diode', { vf: v })} />
          <NumberField label="On-resistance Ron" hint={ideal ? 'Ideal diode uses 0 Ω' : 'Bulk resistance of D1'} unit="Ω" value={params.diode.ron} limits={LIMITS.ron} slider={{ min: 0, max: 10, step: 0.1 }} disabled={ideal || locked('ron')} onCommit={(v) => set('diode', { ron: v })} />
          {scrPossible && (
            <div className="field">
              <span className="field-label">Switching devices</span>
              <div className="seg seg--full" role="radiogroup" aria-label="Switching devices">
                {(['diode', 'scr'] as const).map((d) => (
                  <button key={d} role="radio" disabled={lockAll} aria-checked={ctl.device === d} className={ctl.device === d ? 'on' : ''} onClick={() => set('control', { ...ctl, device: d })}>
                    {d === 'diode' ? 'Diodes (uncontrolled)' : 'SCRs (controlled)'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(three || supportsFreewheel(topology, load)) && (
            <div className="field">
              <span className="field-label">Freewheeling diode</span>
              <div className="seg seg--full" role="radiogroup" aria-label="Freewheeling diode">
                {([false, true] as const).map((on) => (
                  <button key={String(on)} role="radio" disabled={lockAll} aria-checked={ctl.freewheel === on} className={ctl.freewheel === on ? 'on' : ''} onClick={() => set('control', { ...ctl, freewheel: on })}>
                    {on ? 'ON — fitted' : 'OFF — not fitted'}
                  </button>
                ))}
              </div>
              <p className="muted small">Across the load: anode on the − output, cathode on the + output. It conducts only when the load drives the output below zero.</p>
            </div>
          )}
        </div>

        <div className="adv-group">
          <h4 className="adv-title">Source</h4>
          <NumberField disabled={locked('phase')} label="Phase φ" hint="vin = Vm·sin(ωt + φ)" unit="°" value={params.source.phaseDeg} limits={LIMITS.phaseDeg} slider={{ min: -180, max: 180, step: 1 }} onCommit={(v) => set('source', { phaseDeg: v })} />
          {three && (
            <>
              <div className="field">
                <span className="field-label">Phase sequence</span>
                <div className="seg seg--full" role="radiogroup" aria-label="Phase sequence">
                  {(['abc', 'acb'] as const).map((q) => (
                    <button key={q} role="radio" disabled={lockAll} aria-checked={tp.sequence === q} className={tp.sequence === q ? 'on' : ''} onClick={() => set('threePhase', { ...tp, sequence: q })}>
                      {q === 'abc' ? 'a → b → c' : 'a → c → b'}
                    </button>
                  ))}
                </div>
              </div>
              <NumberField disabled={lockAll} label="Source resistance Rs" hint="Per phase" unit="Ω" value={tp.rs} limits={LIMITS.rs} slider={{ min: 0, max: 2, step: 0.01 }} onCommit={(v) => set('threePhase', { ...tp, rs: v })} />
              <NumberField disabled={lockAll} label="Source inductance Ls" hint="Per phase — commutation overlap" unit="mH" value={roundSig(tp.ls * 1e3)} limits={{ min: 0, max: LIMITS.ls.max * 1e3 }} slider={{ min: 0, max: 5, step: 0.05 }} onCommit={(v) => set('threePhase', { ...tp, ls: v / 1e3 })} />
            </>
          )}
        </div>

        <div className="adv-group">
          <h4 className="adv-title">Simulation</h4>
          <NumberField disabled={locked('cycles')} label="Duration" hint="Simulated source cycles" unit="cycles" value={params.sim.cycles} limits={LIMITS.cycles} slider={{ min: 1, max: 20, step: 1 }} onCommit={(v) => set('sim', { cycles: Math.round(v) })} />
          <div className="field">
            <span className="field-label">Timestep Δt</span>
            <div className="seg seg--full" role="radiogroup" aria-label="Timestep mode">
              {(['auto', 'manual'] as const).map((m) => (
                <button key={m} role="radio" disabled={locked('timestep')} aria-checked={params.sim.timestepMode === m} className={params.sim.timestepMode === m ? 'on' : ''} onClick={() => set('sim', { timestepMode: m })}>
                  {m === 'auto' ? 'Auto (T/2000)' : 'Manual'}
                </button>
              ))}
            </div>
          </div>
          {params.sim.timestepMode === 'manual' && (
            <NumberField label="Manual Δt" hint="Simulation timestep" unit="µs" value={params.sim.timestepUs} limits={LIMITS.timestepUs} slider={{ min: 1, max: 2000, log: true }} onCommit={(v) => set('sim', { timestepUs: v })} />
          )}
          {resolved && (
            <p className="diag">
              Δt = {formatSI(resolved.dt, 's')} · {Math.round(resolved.period / resolved.dt).toLocaleString()} samples/cycle
              {samples !== null && <> · {samples.toLocaleString()} samples</>}
              {computeMs !== null && <> · solved in {computeMs.toFixed(1)} ms</>}
            </p>
          )}
        </div>
      </details>

      {issues.length > 0 && (
        <ul className="issues" aria-live="polite">
          {issues.map((i, k) => (
            <li key={k} className={`issue issue--${i.severity}`}>
              {i.severity === 'info' ? 'ⓘ' : '⚠'} {i.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface FieldProps {
  label: string
  hint: string
  unit: string
  value: number
  limits: { min: number; max: number }
  slider: { min: number; max: number; step?: number; log?: boolean }
  disabled?: boolean
  onCommit: (v: number) => void
}

/** Number input + slider. Typed text commits on Enter/blur; the slider commits live. */
function NumberField({ label, hint, unit, value, limits, slider, disabled, onCommit }: FieldProps) {
  const id = useId()
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])

  const commit = () => {
    const v = Number(text.replace(',', '.').trim())
    if (text.trim() === '' || !Number.isFinite(v)) {
      setText(String(value)) // reject non-numbers, keep the last valid value
      return
    }
    if (v !== value) onCommit(v)
  }

  // Log sliders map position 0..1000 onto [min, max] geometrically (R spans 6 decades).
  const toPos = (v: number) =>
    slider.log ? (Math.log(Math.min(slider.max, Math.max(slider.min, v)) / slider.min) / Math.log(slider.max / slider.min)) * 1000 : v
  const fromPos = (p: number) => (slider.log ? roundNice(slider.min * Math.pow(slider.max / slider.min, p / 1000)) : p)

  const outOfRange = value < limits.min || value > limits.max
  return (
    <div className={`field ${disabled ? 'field--disabled' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        <span className="field-hint">{hint}</span>
      </label>
      <div className="field-row">
        <input
          type="range"
          aria-label={`${label} slider`}
          min={slider.log ? 0 : slider.min}
          max={slider.log ? 1000 : slider.max}
          step={slider.log ? 1 : (slider.step ?? 1)}
          value={toPos(value)}
          disabled={disabled}
          onChange={(e) => onCommit(fromPos(Number(e.target.value)))}
        />
        <div className={`num-input ${outOfRange ? 'num-input--bad' : ''}`}>
          <input
            id={id}
            inputMode="decimal"
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setText(String(value))
            }}
            aria-describedby={`${id}-range`}
          />
          <span className="unit">{unit}</span>
        </div>
      </div>
      <span id={`${id}-range`} className="sr-only">
        Allowed {limits.min} to {limits.max} {unit}
      </span>
    </div>
  )
}

/** Round to 6 significant figures (removes float noise from unit conversion, e.g. 50.000000001 mH). */
function roundSig(v: number): number {
  return Number(v.toPrecision(6))
}

/** Round to 3 significant figures so log-slider values read cleanly (e.g. 47.3 Ω, not 47.2831 Ω). */
function roundNice(v: number): number {
  const mag = 10 ** (Math.floor(Math.log10(v)) - 2)
  return Math.round(v / mag) * mag
}
