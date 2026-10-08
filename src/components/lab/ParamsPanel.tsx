import { useEffect, useState } from 'react'
import type { ChoiceSpec, FieldSpec, ParamSpec } from '../../lab/types.ts'

/** A slider (linear or logarithmic) with an editable value, in display units (value / scale). */
export function Field(props: {
  id: string
  label: string
  value: number
  min: number
  max: number
  log?: boolean
  step?: number
  unit: string
  scale?: number
  hint?: string
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const scale = props.scale ?? 1
  const { min, max, log } = props
  const value = props.value
  const toPos = (v: number) => (log ? (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (v - min) / (max - min))
  const fromPos = (x: number) => (log ? Math.exp(Math.log(min) + x * (Math.log(max) - Math.log(min))) : min + x * (max - min))
  const show = (v: number) => String(+(v / scale).toPrecision(4))
  const [text, setText] = useState(show(value))
  useEffect(() => setText(show(value)), [value, scale]) // eslint-disable-line react-hooks/exhaustive-deps
  const clampV = (v: number) => Math.min(max, Math.max(min, v))
  const snap = (v: number) => (props.step ? Math.round(v / scale / props.step) * props.step * scale : +v.toPrecision(3))
  const commit = () => {
    const v = parseFloat(text) * scale
    if (Number.isFinite(v)) props.onChange(clampV(v))
    else setText(show(value))
  }
  return (
    <div className="pfield">
      <label htmlFor={props.id} className="pfield-label">
        {props.label}
        {props.hint && <span className="pfield-hint">{props.hint}</span>}
      </label>
      <div className="pfield-row">
        <input
          id={props.id}
          type="range"
          min={0}
          max={1000}
          value={Math.round(Math.min(1, Math.max(0, toPos(Math.max(value, log ? min : -Infinity)))) * 1000)}
          disabled={props.disabled}
          aria-valuetext={`${show(value)} ${props.unit}`}
          onChange={(e) => props.onChange(clampV(snap(fromPos(+e.target.value / 1000))))}
        />
        <span className="pfield-input">
          <input
            aria-label={`${props.label} value`}
            value={text}
            disabled={props.disabled}
            inputMode="decimal"
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
          <span className="pfield-unit">{props.unit}</span>
        </span>
      </div>
    </div>
  )
}

function Choice<P>({ spec, p, onChange, disabled }: { spec: ChoiceSpec<P>; p: P; onChange: (patch: Partial<P>) => void; disabled?: boolean }) {
  const v = p[spec.key] as unknown as string | number
  return (
    <div className="pfield">
      <span className="pfield-label">{spec.label}</span>
      <div className="seg seg--wrap" role="radiogroup" aria-label={spec.label}>
        {spec.options.map((o) => (
          <button key={String(o.value)} role="radio" aria-checked={v === o.value} className={v === o.value ? 'on' : ''} title={o.title} disabled={disabled} onClick={() => onChange({ [spec.key]: o.value } as Partial<P>)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SpecList<P>({ specs, p, onChange, disabled, idPrefix }: { specs: Array<ParamSpec<P>>; p: P; onChange: (patch: Partial<P>) => void; disabled?: boolean; idPrefix: string }) {
  return (
    <>
      {specs
        .filter((s) => !s.when || s.when(p))
        .map((s) =>
          s.kind === 'choice' ? (
            <Choice key={s.key} spec={s} p={p} onChange={onChange} disabled={disabled} />
          ) : (
            <NumberSpec key={s.key} spec={s} p={p} onChange={onChange} disabled={disabled} idPrefix={idPrefix} />
          ),
        )}
    </>
  )
}

function NumberSpec<P>({ spec, p, onChange, disabled, idPrefix }: { spec: FieldSpec<P>; p: P; onChange: (patch: Partial<P>) => void; disabled?: boolean; idPrefix: string }) {
  return (
    <Field
      id={`${idPrefix}-${spec.key}`}
      label={spec.label}
      value={p[spec.key] as unknown as number}
      min={spec.min}
      max={spec.max}
      log={spec.log}
      step={spec.step}
      unit={spec.unit}
      scale={spec.scale}
      hint={spec.hint?.(p)}
      disabled={disabled}
      onChange={(v) => onChange({ [spec.key]: v } as Partial<P>)}
    />
  )
}
