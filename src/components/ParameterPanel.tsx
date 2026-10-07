import { useEffect, useId, useState } from 'react'
import { LIMITS } from '../simulation/params.ts'
import type { LabParams, ParamIssue, ResolvedParams } from '../types/simulation.ts'
import { formatSI } from '../utils/format.ts'

interface Props {
  params: LabParams
  resolved: ResolvedParams | null
  issues: ParamIssue[]
  computeMs: number | null
  samples: number | null
  onChange: (p: LabParams) => void
  onReset: () => void
}

export function ParameterPanel({ params, resolved, issues, computeMs, samples, onChange, onReset }: Props) {
  const set = <K extends keyof LabParams>(group: K, patch: Partial<LabParams[K]>) => onChange({ ...params, [group]: { ...params[group], ...patch } })
  const ideal = params.diode.model === 'ideal'

  return (
    <section className="params" aria-labelledby="params-title">
      <header className="section-head section-head--row">
        <h2 id="params-title" className="eyebrow">Parameters</h2>
        <button className="text-btn" onClick={onReset}>
          Defaults
        </button>
      </header>

      <div className="param-group">
        <h3 className="group-title">Basic</h3>
        <NumberField label="Vrms" hint="Source RMS voltage" unit="V" value={params.source.vrms} limits={LIMITS.vrms} slider={{ min: 1, max: 50, step: 0.5 }} onCommit={(v) => set('source', { vrms: v })} />
        <NumberField label="Frequency" hint="Source frequency f" unit="Hz" value={params.source.frequency} limits={LIMITS.frequency} slider={{ min: 1, max: 1000, log: true }} onCommit={(v) => set('source', { frequency: v })} />
        <NumberField label="Resistance" hint="Load resistance R" unit="Ω" value={params.load.resistance} limits={LIMITS.resistance} slider={{ min: 0.1, max: 100000, log: true }} onCommit={(v) => set('load', { resistance: v })} />
        <div className="field">
          <span className="field-label">Diode model</span>
          <div className="seg seg--full" role="radiogroup" aria-label="Diode model">
            {(['ideal', 'real'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={params.diode.model === m} className={params.diode.model === m ? 'on' : ''} onClick={() => set('diode', { model: m })}>
                {m === 'ideal' ? 'Ideal' : 'Real (Vf)'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <details className="param-group advanced">
        <summary className="group-title">Advanced</summary>
        <NumberField label="Phase φ" hint="vin = Vm·sin(ωt + φ)" unit="°" value={params.source.phaseDeg} limits={LIMITS.phaseDeg} slider={{ min: -180, max: 180, step: 1 }} onCommit={(v) => set('source', { phaseDeg: v })} />
        <NumberField label="Forward voltage Vf" hint={ideal ? 'Ideal diode uses 0 V' : 'Knee voltage of D1'} unit="V" value={params.diode.vf} limits={LIMITS.vf} slider={{ min: 0, max: 2, step: 0.05 }} disabled={ideal} onCommit={(v) => set('diode', { vf: v })} />
        <NumberField label="On-resistance Ron" hint={ideal ? 'Ideal diode uses 0 Ω' : 'Bulk resistance of D1'} unit="Ω" value={params.diode.ron} limits={LIMITS.ron} slider={{ min: 0, max: 10, step: 0.1 }} disabled={ideal} onCommit={(v) => set('diode', { ron: v })} />
        <NumberField label="Duration" hint="Simulated source cycles" unit="cycles" value={params.sim.cycles} limits={LIMITS.cycles} slider={{ min: 1, max: 20, step: 1 }} onCommit={(v) => set('sim', { cycles: Math.round(v) })} />
        <div className="field">
          <span className="field-label">Timestep Δt</span>
          <div className="seg seg--full" role="radiogroup" aria-label="Timestep mode">
            {(['auto', 'manual'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={params.sim.timestepMode === m} className={params.sim.timestepMode === m ? 'on' : ''} onClick={() => set('sim', { timestepMode: m })}>
                {m === 'auto' ? 'Auto (T/2000)' : 'Manual'}
              </button>
            ))}
          </div>
        </div>
        {params.sim.timestepMode === 'manual' && (
          <NumberField label="Manual Δt" hint="Simulation timestep" unit="µs" value={params.sim.timestepUs} limits={LIMITS.timestepUs} slider={{ min: 1, max: 2000, log: true }} onCommit={(v) => set('sim', { timestepUs: v })} />
        )}
      </details>

      {resolved && (
        <p className="diag">
          Δt = {formatSI(resolved.dt, 's')} · {Math.round(resolved.period / resolved.dt).toLocaleString()} samples/cycle
          {samples !== null && <> · {samples.toLocaleString()} samples</>}
          {computeMs !== null && <> · solved in {computeMs.toFixed(1)} ms</>}
        </p>
      )}

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

/** Round to 3 significant figures so log-slider values read cleanly (e.g. 47.3 Ω, not 47.2831 Ω). */
function roundNice(v: number): number {
  const mag = 10 ** (Math.floor(Math.log10(v)) - 2)
  return Math.round(v / mag) * mag
}
