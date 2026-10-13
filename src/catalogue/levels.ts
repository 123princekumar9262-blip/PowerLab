import type { Lab, Topic } from './catalogue.ts'

/**
 * How demanding each lab is, and the order its circuits are best met in. Plain data beside the catalogue
 * (cards, lab pages, the sidebar). A level is a recommendation, never a gate.
 */
export type LabLevel = 'beginner' | 'intermediate' | 'advanced'
export const LEVEL_LABEL: Record<LabLevel, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }

export const LAB_LEVEL: Record<string, LabLevel> = {
  rectifiers: 'beginner',
  'dc-dc': 'beginner',
  pwm: 'beginner',
  inverters: 'intermediate',
  devices: 'intermediate',
  magnetics: 'intermediate',
  thermal: 'intermediate',
  control: 'advanced',
  drives: 'advanced',
  ev: 'advanced',
}

/** A lab's circuits in the order to meet them (the first ready ones are its "Suggested order"). */
const ORDER: Record<string, string[]> = {
  rectifiers: ['1ph-half-wave', '1ph-bridge', '1ph-bridge-scr', '3ph-6pulse'],
  'dc-dc': ['buck', 'boost', 'buck-boost', 'sepic', 'cuk', 'zeta', 'bidirectional'],
  pwm: ['lab', 'multi-pulse'],
  inverters: ['1ph', '3ph', 'spwm', 'svpwm', '120'],
  devices: ['diode', 'mosfet', 'igbt', 'scr', 'sic', 'gan'],
  magnetics: ['inductor', 'transformer'],
  control: ['buck', 'boost'],
  drives: ['dc-motor', 'bldc', 'induction', 'pmsm'],
  thermal: ['switch'],
  ev: ['drivetrain', 'battery', 'dcdc-stage', 'accel'],
}
const STEP_LABEL = ['Start here', 'Then', 'Advanced']

/** "Start here → Then → Advanced": the lab's first three ready circuits in its order (none for a one-circuit lab). */
export function suggestedOrder(lab: Lab): Array<{ topic: Topic; label: string }> {
  const ready = (ORDER[lab.id] ?? []).map((id) => lab.topics.find((t) => t.id === id)).filter((t): t is Topic => !!t && t.status === 'ready')
  if (ready.length < 2) return []
  const pick = ready.length > 3 ? [ready[0], ready[1], ready[ready.length - 1]] : ready
  return pick.map((topic, k) => ({ topic, label: pick.length === 2 && k === 1 ? 'Then' : STEP_LABEL[k] }))
}

/** Practice activities: level and how long one takes (cards on the Practice page). */
export const AREA_META: Record<string, { level: LabLevel; effort: string }> = {
  challenge: { level: 'intermediate', effort: '9 design tasks · 10–20 min each' },
  reverse: { level: 'intermediate', effort: 'Random hidden circuits · about 5 min' },
  fault: { level: 'intermediate', effort: 'Hidden faults · about 5 min each' },
  design: { level: 'advanced', effort: 'Specifications · 10–20 min each' },
  interview: { level: 'beginner', effort: 'Short questions · 2 min each' },
}
