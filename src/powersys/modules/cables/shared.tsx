import { useMemo, type ReactNode } from 'react'
import type { ScenePart } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { Callout } from '../../ui/kit.tsx'
import { computeCable, potentialAt, probeRadius, stressAt, type CableInput, type CableOutcome, type CableResult } from './calc.ts'

export const MODULE = 'cables'
export const TRANSIENTS_HREF = '#/subjects/power-systems/transients'
export const LINE_PARAMS_HREF = '#/subjects/power-systems/line-params'

/** The cable's computed result (memoised on the input object). */
export function useCable(c: CableInput): CableOutcome {
  return useMemo(() => computeCable(c), [c])
}

export type LayerId = 'conductor' | 'cscreen' | 'insulation' | 'iscreen' | 'sheath' | 'bedding' | 'armour' | 'serving'
export const LAYER_IDS: LayerId[] = ['conductor', 'cscreen', 'insulation', 'iscreen', 'sheath', 'bedding', 'armour', 'serving']

export interface LayerSpec {
  id: LayerId
  name: string
  /** Inner and outer radius [mm]. */
  inner: number
  outer: number
  /** 'model': r and R, the radii the calculation uses; 'drawn': a thickness drawn for recognition (illustrative). */
  kind: 'model' | 'drawn'
  color: string
  /** A short name for labels in the 3D view. */
  short: string
}

/** Drawn thicknesses of the layers outside the model [mm] — typical-looking, illustrative, not a design. */
const DRAWN = { cscreen: 1, iscreen: 1, sheath: 1.6, bedding: 2, armour: 3, serving: 2.6 }

export const LAYER_COLOR: Record<LayerId, string> = {
  conductor: '#c97a3d',
  cscreen: '#4a4f58',
  insulation: '#d9e1ea',
  iscreen: '#4a4f58',
  sheath: '#a9b0ba',
  bedding: '#8a7354',
  armour: '#7d8796',
  serving: '#5d6470',
}

/** The concentric layers of the cable drawn for radii r and R [mm]: the conductor screen is drawn inside r (r is over it). */
export function layerSpecs(rMm: number, RMm: number): LayerSpec[] {
  const cs = Math.min(DRAWN.cscreen, 0.12 * rMm)
  let x = RMm
  const next = (t: number) => {
    const a = x
    x += t
    return [a, x] as const
  }
  const [isI, isO] = next(DRAWN.iscreen)
  const [shI, shO] = next(DRAWN.sheath)
  const [bdI, bdO] = next(DRAWN.bedding)
  const [arI, arO] = next(DRAWN.armour)
  const [svI, svO] = next(DRAWN.serving)
  return [
    { id: 'conductor', short: 'Conductor', name: 'Conductor', inner: 0, outer: rMm - cs, kind: 'model', color: LAYER_COLOR.conductor },
    { id: 'cscreen', short: 'Cond. screen', name: 'Conductor screen', inner: rMm - cs, outer: rMm, kind: 'drawn', color: LAYER_COLOR.cscreen },
    { id: 'insulation', short: 'Insulation', name: 'Insulation', inner: rMm, outer: RMm, kind: 'model', color: LAYER_COLOR.insulation },
    { id: 'iscreen', short: 'Ins. screen', name: 'Insulation screen', inner: isI, outer: isO, kind: 'drawn', color: LAYER_COLOR.iscreen },
    { id: 'sheath', short: 'Sheath', name: 'Metallic sheath', inner: shI, outer: shO, kind: 'drawn', color: LAYER_COLOR.sheath },
    { id: 'bedding', short: 'Bedding', name: 'Bedding', inner: bdI, outer: bdO, kind: 'drawn', color: LAYER_COLOR.bedding },
    { id: 'armour', short: 'Armour', name: 'Armour', inner: arI, outer: arO, kind: 'drawn', color: LAYER_COLOR.armour },
    { id: 'serving', short: 'Serving', name: 'Serving (outer jacket)', inner: svI, outer: svO, kind: 'drawn', color: LAYER_COLOR.serving },
  ]
}

/** The parts of the cable (3D part list), with what each one does. */
export const CABLE_PARTS: ScenePart[] = [
  { id: 'conductor', name: 'Conductor', what: 'Copper or aluminium, usually stranded. It carries the load current — and at its surface the insulation is stressed most.' },
  {
    id: 'cscreen',
    name: 'Conductor screen',
    what: 'A thin semiconducting layer over the strands. It makes the conductor a smooth cylinder of radius r, so there are no sharp edges that would raise the stress locally.',
  },
  { id: 'insulation', name: 'Insulation (dielectric)', what: 'XLPE, impregnated paper or similar. It holds the whole voltage between conductor and sheath. Its colour is the computed stress.' },
  { id: 'iscreen', name: 'Insulation screen', what: 'A semiconducting layer that makes the outer boundary of the insulation a smooth equipotential at radius R.' },
  {
    id: 'sheath',
    name: 'Metallic sheath',
    what: 'Lead or aluminium. It keeps moisture out, is earthed, confines the electric field to the insulation and returns the charging and fault currents.',
  },
  { id: 'bedding', name: 'Bedding', what: 'A cushion of jute, compound or polymer tape that protects the sheath from the armour wires.' },
  {
    id: 'armour',
    name: 'Armour',
    what: 'Wires or tapes for mechanical protection in the ground. Single-core ac cables use non-magnetic armour (e.g. aluminium wires): steel around one core would heat by induced currents.',
  },
  { id: 'serving', name: 'Serving (outer jacket)', what: 'The outer covering — jute and compound, or a PVC/PE jacket — that protects the armour from corrosion.' },
  { id: 'probe', name: 'Probe ring (radius x)', what: 'A ring you move through the insulation: the stress and the potential at its radius, computed.' },
]

/** A cable the model refuses: the reasons, and no numbers. */
export function InvalidCable({ outcome }: { outcome: CableOutcome }) {
  if (outcome.ok) return null
  return (
    <Callout tone="bad" title="This cable is not physically possible — no results">
      <ul className="cb-issues">
        {outcome.issues.map((i, k) => (
          <li key={k}>{i.message}</li>
        ))}
      </ul>
      <p className="small">Make the sheath radius R larger than the conductor radius r, or press Reset.</p>
    </Callout>
  )
}

/** Stress and potential at the probe. */
export function probeValues(res: CableResult, t: number) {
  const x = probeRadius(res, t)
  return { xCm: x, xMm: x * 10, g: stressAt(res.c.vKv, x, res.r, res.R), v: potentialAt(res.c.vKv, x, res.r, res.R) }
}

/** Live values for a selected part of the cable. */
export function PartInfo({ id, res, probeT }: { id: string; res: CableResult | null; probeT: number }): ReactNode {
  if (!res) return <p className="small">No values: the cable is not valid.</p>
  const c = res.c
  const p = probeValues(res, probeT)
  const row = (k: string, v: string) => (
    <div key={k}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
  if (id === 'conductor')
    return (
      <dl className="cb-info">
        {row('Radius r', `${fx(c.rMm, 1)} mm`)}
        {row('Cross-section πr²', `${fx(Math.PI * c.rMm * c.rMm, 0)} mm²`)}
        {row('Potential', `${fx(c.vKv, 1)} kV (rms)`)}
        {row('Stress at its surface', `${fx(res.gMax, 2)} kV/cm`)}
      </dl>
    )
  if (id === 'insulation' || id === 'probe')
    return (
      <dl className="cb-info">
        {row('Probe radius x', `${fx(p.xMm, 1)} mm`)}
        {row('g(x) at the probe', `${fx(p.g, 2)} kV/cm`)}
        {row('V(x) at the probe', `${fx(p.v, 2)} kV`)}
        {row('g_max (x = r)', `${fx(res.gMax, 2)} kV/cm`)}
        {row('g_min (x = R)', `${fx(res.gMin, 2)} kV/cm`)}
        {id === 'insulation' && row('Thickness R − r', `${fx(res.thicknessMm, 1)} mm`)}
        {id === 'insulation' && row('ε_r', fx(c.epsR, 1))}
      </dl>
    )
  if (id === 'cscreen' || id === 'iscreen')
    return (
      <p className="small">
        {id === 'cscreen' ? `Part of the conductor boundary: r = ${fx(c.rMm, 1)} mm is measured over it.` : `The outer boundary of the insulation: R = ${fx(c.RMm, 1)} mm is measured under it.`} Its
        drawn thickness is illustrative.
      </p>
    )
  if (id === 'sheath')
    return (
      <dl className="cb-info">
        {row('Inner radius R', `${fx(c.RMm, 1)} mm`)}
        {row('Potential', '0 (earthed)')}
        {row('Stress at its inner face', `${fx(res.gMin, 2)} kV/cm`)}
        {row('Charging current it returns', `${fx(res.ic, 2)} A over ${fx(c.lengthKm, 1)} km`)}
      </dl>
    )
  return <p className="small">Outside the electrical model: it carries no part of the voltage. Its drawn thickness is illustrative.</p>
}
