import { DC_PARTS } from '../dcMotor/content.ts'
import type { CalcResult, LayerInfo, Manifest, MachinePart } from '../../types.ts'
import type { Kind } from './geometry.ts'

/*
 * Shared data of the five wound-field DC machines: the parts (with connection-specific wording), the layers and
 * their legends, the manifest and the common assumptions. Each machine's own steps, calculations, content and quiz
 * live in its file (generator.ts, separately.ts, shunt.ts, series.ts, compound.ts).
 */

/** The motor's wording for a part these machines share (only name and description: its place, relations and
 *  disassembly belong to the permanent-magnet motor, not to these wound-field machines). */
const lead = (id: string): Pick<MachinePart, 'id' | 'label' | 'what' | 'function'> => {
  const p = DC_PARTS.find((x) => x.id === id)!
  return { id: p.id, label: p.label, what: p.what, function: p.function }
}

const FIELD_LABEL: Record<Kind, string> = {
  generator: 'Field coils (F1–F2, separately excited)',
  separate: 'Field coils (F1–F2, separately excited)',
  shunt: 'Shunt field coils (E1–E2)',
  series: '',
  compound: 'Shunt field coils (E1–E2)',
}
const FIELD_FUNCTION: Record<Kind, string> = {
  generator: 'Their current If, from a separate field supply Vf, magnetises the poles: Φ ∝ If (unsaturated). Changing If changes the generated EMF at a given speed — the usual way to set the output voltage.',
  separate: 'Their current If, from a separate supply Vf, magnetises the poles: Φ ∝ If (unsaturated). Because If is independent of the armature, the flux can be set on its own — field weakening raises the speed.',
  shunt: 'Connected across the supply in parallel with the armature, they carry If = V/Rf and keep the flux nearly constant whatever the load. Many turns of thin wire give the ampere-turns from a small current at full voltage.',
  series: '',
  compound: 'Connected across the supply (long shunt), they give the main, constant part of the flux, Φsh ∝ If = V/Rf; they also give the machine a definite no-load speed.',
}
const CONNECTION: Record<Kind, string> = {
  generator: 'Here: F1–F2 go to the field supply Vf, A1–A2 to the load.',
  separate: 'Here: no links — F1–F2 go to the field supply, A1–A2 to the armature supply.',
  shunt: 'Here: links E1–A1 and A2–E2 put the field in parallel with the armature on one supply.',
  series: 'Here: the link A2–D1 puts the series field in series with the armature; the supply goes to A1 and D2.',
  compound: 'Here (long shunt): links E1–A1, A2–D1 and D2–E2 — shunt field across the supply, series field in the armature circuit.',
}

export function dcParts(kind: Kind): MachinePart[] {
  const gen = kind === 'generator'
  const parts: MachinePart[] = [
    { id: 'yoke', label: 'Yoke (frame)', what: 'The cylindrical steel frame, with its mounting feet.', function: 'Holds the main poles and carries the flux from one pole to the other around the outside (the magnetic return path). It is also the mechanical frame of the machine.', outer: true, explode: [0, 0, -2.3], stage: 2, anchor: [-1.15, 1.2, 0.7], related: ['pole-n', 'pole-s'] },
    {
      id: 'terminal-box',
      label: 'Terminal box',
      what: 'A box on the frame with terminal studs marked A1–A2 (armature) and E (shunt), F (separate) or D (series) for the field windings, and the internal leads.',
      function: `The field connection is made here: links between studs and the external cables decide whether the machine is separately excited, shunt, series or compound. ${CONNECTION[kind]}`,
      explode: [0, 0, -2.3],
      stage: 2,
      anchor: [0, 2.2, 0.0],
      related: kind === 'series' ? ['series-coils', 'brushes'] : kind === 'compound' ? ['field-coils', 'series-coils', 'brushes'] : ['field-coils', 'brushes'],
    },
    { id: 'end-cap-front', label: 'Front end shield', what: 'The cover at the commutator end.', function: 'Closes the machine and holds the front bearing and the brush gear.', outer: true, explode: [0, 0, 1.25], stage: 1, anchor: [1.15, -1.0, 1.6], related: ['bearings', 'brushes'] },
    { id: 'end-cap-rear', label: 'Rear end shield', what: 'The cover at the drive end.', function: 'Closes the machine and holds the rear bearing.', outer: true, explode: [0, 0, gen ? -2.6 : -2.8], stage: 1, anchor: [0.9, -1.25, -1.05], related: ['bearings'] },
    { id: 'pole-n', label: 'Main pole (N)', what: 'A laminated pole core bolted to the yoke, ending in a wider pole shoe that faces the armature.', function: 'Carries the field coil and guides its flux into the air gap; the shoe spreads the flux over the armature surface. It is N because of the direction the field current circulates round it (right-hand grip rule) — reverse the field current and it becomes S.', explode: [1.5, 0, 0], stage: 3, anchor: [0.88, 0.62, -0.6], related: ['pole-s', 'yoke'] },
    { id: 'pole-s', label: 'Main pole (S)', what: 'The opposite pole: core and shoe, its coil wound so that this pole is S.', function: 'Completes the magnetic circuit: flux leaves the N pole shoe, crosses the air gap and armature, enters the S pole and returns through the yoke.', explode: [-1.5, 0, 0], stage: 3, anchor: [-0.79, 0.32, -0.32], related: ['pole-n', 'yoke'] },
  ]
  if (kind !== 'series')
    parts.push({ id: 'field-coils', label: FIELD_LABEL[kind], what: 'Many turns of fine insulated copper wire round each pole core; the two coils are joined in series.', function: FIELD_FUNCTION[kind], explode: [1.5, 0, 0], stage: 3, anchor: [1.2, -0.3, -0.85], related: ['pole-n', 'pole-s', 'terminal-box'] })
  if (kind === 'series' || kind === 'compound')
    parts.push({
      id: 'series-coils',
      label: 'Series field coils (D1–D2)',
      what: kind === 'series' ? 'A few turns of thick copper strip round each pole core, carrying the whole armature current.' : 'A few turns of thick copper strip round each pole, next to the pole shoe, carrying the armature current.',
      function:
        kind === 'series'
          ? 'The armature current itself magnetises the poles: Φ ∝ Ia (unsaturated). Few turns of heavy strip give the ampere-turns from a large current with a very small resistance Rse, so little voltage is lost in them.'
          : 'Adds a flux proportional to the load current to the shunt flux (cumulative compound) or subtracts it (differential compound) — this is what shapes the speed–load or voltage–load curve.',
      explode: [1.5, 0, 0],
      stage: 3,
      anchor: [1.0, 0.03, -0.9],
      related: ['pole-n', 'pole-s', 'terminal-box', 'armature-winding'],
    })
  parts.push(
    { ...lead('armature-core'), explode: [0, 0, 0], stage: 3, anchor: [-0.12, -0.71, 0.22], related: ['armature-winding', 'shaft'] },
    {
      id: 'armature-winding',
      label: 'Armature winding',
      what: 'Insulated copper coils in the core slots, their ends joined to the commutator segments.',
      function: gen
        ? 'Its conductors cut the flux as the prime mover turns them, so an EMF is induced in them (e = B·l·v); the load current then flows through them.'
        : 'Carries the armature current; each conductor in the flux feels a force F = B·I·L, and together they make the torque. Turning, the same conductors generate the back EMF.',
      explode: [0, 0, 0],
      stage: 3,
      anchor: [0.6, -0.62, 0.86],
      related: ['armature-core', 'commutator'],
    },
    { ...lead('shaft'), function: gen ? 'Brings the mechanical torque from the prime mover into the armature.' : lead('shaft').function, explode: [0, 0, 0], stage: 3, anchor: [0, 0.15, -1.6], related: ['bearings'] },
    {
      id: 'commutator',
      label: 'Commutator',
      what: 'Copper segments, insulated from each other, on the shaft; each coil end is joined to a segment.',
      function: gen
        ? 'A mechanical rectifier: as a coil passes the neutral zone between the poles (where its EMF is zero) its segments move from one brush to the other, reversing its connection. The coil’s alternating EMF therefore always reaches the terminals in the same direction.'
        : 'With the brushes, reverses the current in each coil as it passes between the poles, so the current pattern under each pole — and the torque — keeps its direction.',
      explode: [0, 0, 0.45],
      stage: 3,
      anchor: [0.36, 0.36, 1.18],
      related: ['brushes', 'armature-winding'],
    },
    {
      id: 'brushes',
      label: 'Brushes',
      what: 'Two carbon blocks in holders, pressed onto the commutator, on the neutral axis between the poles.',
      function: gen ? 'Collect the generated current from the turning commutator and lead it out to terminals A1 (+) and A2 (−).' : 'Bring the current from the stationary terminals A1–A2 into the turning commutator. They slide, so they wear.',
      explode: [0, 0, 0.95],
      stage: 1,
      anchor: [0, 0.66, 1.25],
      related: ['commutator', 'terminal-box'],
    },
    { id: 'bearings', label: 'Bearings', what: 'Two ball bearings, one in each end shield.', function: 'Hold the shaft centred in the bore and let it turn with little friction.', explode: [0, 0, 1.2], stage: 1, anchor: [0.24, -0.26, 1.62], related: ['shaft', 'end-cap-front', 'end-cap-rear'] },
  )
  if (gen)
    parts.push({ id: 'prime-mover', label: 'Prime mover and coupling', what: 'The machine that turns the generator — an engine, a turbine or a motor — joined to the shaft by a flange coupling.', function: 'Supplies the mechanical power. It must deliver the counter-torque T = kΦ·Ia that the load current produces (plus the friction and iron losses), otherwise it slows down.', explode: [0, 0, -2.6], stage: 1, anchor: [0, 1.15, -2.6], related: ['shaft'] })
  return parts
}

export function dcLayers(kind: Kind): LayerInfo[] {
  const gen = kind === 'generator'
  const fieldSource = kind === 'series' ? 'the armature current in the series coils' : kind === 'compound' ? 'the shunt coils plus (or minus) the series coils' : 'the field current in the coils'
  return [
    { id: 'field', label: 'Magnetic field', legend: `Blue dashed lines: flux made by ${fieldSource} — out of the N pole, across the air gap and armature, into the S pole, back through the yoke.`, conceptual: true },
    {
      id: 'current',
      label: 'Currents and connection',
      legend: `Green: conventional current. ⊙ out of the screen, ⊗ into it, in the armature conductors; dashes around the field coils show the coil current (it circulates so the right pole is N). The inset shows the terminal connection with Ia, If and IL and their calculated values${kind === 'compound' ? '; a differential series coil carries its current the other way round' : ''}.`,
      conceptual: true,
    },
    { id: 'torque', label: gen ? 'Forces and counter-torque' : 'Force and torque', legend: gen ? 'Amber: the force on the current-carrying conductors (F = B·I·L) points against the rotation — the counter-torque; the arrow at the back is the prime mover’s driving torque.' : 'Amber arrows: the force on the conductors (F = B·I·L) and the resulting torque on the armature.', conceptual: true },
    { id: 'rotation', label: 'Rotation', legend: 'White curved arrow: the direction the armature turns (clockwise seen from the commutator end).', conceptual: false },
    {
      id: 'emf',
      label: gen ? 'Induced EMF' : 'Back EMF',
      legend: gen ? 'Magenta: the EMF induced in the moving conductors (v × B). The inset plots one coil’s EMF over a turn (alternating) and what the commutator delivers to the brushes (one direction).' : 'Magenta markers: the EMF induced in the moving conductors; it opposes the current the supply drives (back EMF).',
      conceptual: true,
    },
    { id: 'energy', label: 'Energy flow', legend: gen ? 'Orange: mechanical power in from the prime mover → electrical power out to the load; part becomes heat in the windings.' : 'Orange: electrical power in at the terminals → mechanical power out at the shaft; part becomes heat in the windings.', conceptual: true },
  ]
}

export function dcManifest(kind: Kind, simplified: string): Manifest {
  const gen = kind === 'generator'
  return {
    source: 'Original procedural geometry, written for this lab (no external asset). Armature and commutator geometry follow the lab’s brushed DC motor model.',
    license: 'Part of this project — no third-party model.',
    simplified,
    camera: gen ? { position: [8.6, 4.6, 5.6], target: [0, 0.2, -1.1] } : { position: [7.4, 4.0, 5.9], target: [0, 0.2, -0.2] },
    radius: gen ? 4.2 : 3.6,
    views: gen
      ? { front: [0, 0.4, 8.8], side: [10.2, 0.6, -1.0], top: [0, 10.6, -0.9], iso: [8.6, 4.6, 5.6] }
      : { front: [0, 0.3, 8.6], side: [9.4, 0.6, -0.2], top: [0, 9.6, 0], iso: [7.4, 4.0, 5.9] },
    limitations: [
      'Field lines, current markers and force arrows are conceptual illustrations of directions, not a field simulation.',
      'The animation speed follows the calculated speed only in proportion (slowed down); it is not a measurement.',
      'Two poles, 8 armature slots and 8 commutator segments; real machines have more poles, slots and segments, interpoles and often a compensating winding (not drawn).',
      'The calculations are the ideal steady state with linear magnetics: no saturation, no residual flux, no armature reaction, no brush drop, friction or iron loss.',
    ],
  }
}

export const LINEAR_ASSUMPTIONS = [
  'Steady state (constant speed and currents).',
  'Linear magnetics: the flux is proportional to the exciting current (no saturation, no residual flux).',
  'Armature reaction, brush contact drop, friction, windage and iron loss neglected.',
]

/** Animation speed from a calculated speed [rpm]: clockwise from the front, slowed down ×50. */
export function motionFromRpm(n: number | null, why: string): { omega: number; note: string } {
  if (n === null) return { omega: 0, note: why }
  return { omega: -((n / 60) * 2 * Math.PI) / 50, note: n > 0 ? 'The armature turns at the calculated speed, slowed down ×50.' : why }
}

/** A row helper: value null when not finite. */
export const row = (id: string, label: string, value: number | null | undefined, unit: string, formula: string, note?: string): CalcResult => ({
  id,
  label,
  value: value === null || value === undefined || !Number.isFinite(value) ? null : value,
  unit,
  formula,
  note,
})
