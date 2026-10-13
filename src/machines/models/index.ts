import type { MachineDef } from '../types.ts'

/**
 * The built machines: each loads lazily with its 3D code. A catalogue entry is `ready` exactly when it has a loader
 * here (tests/machines.test.ts checks both ways).
 */
export const MODEL_LOADERS: Record<string, () => Promise<{ default: MachineDef }>> = {
  'dc-motor': () => import('./dcMotor/index.ts'),
  'dc-generator': () => import('./dcMachines/generator.tsx'),
  'dc-separately': () => import('./dcMachines/separately.tsx'),
  'dc-shunt': () => import('./dcMachines/shunt.tsx'),
  'dc-series': () => import('./dcMachines/series.tsx'),
  'dc-compound': () => import('./dcMachines/compound.tsx'),
  'power-diode': () => import('./semiconductors/diode/index.ts'),
  mosfet: () => import('./semiconductors/mosfet/index.ts'),
  igbt: () => import('./semiconductors/igbt/index.ts'),
  scr: () => import('./semiconductors/scr/index.ts'),
  transformer: () => import('./static/transformer/index.ts'),
  'transformer-3ph': () => import('./static/transformer3ph/index.ts'),
  autotransformer: () => import('./static/autotransformer/index.ts'),
  inductor: () => import('./static/inductor/index.ts'),
  bldc: () => import('./modern/bldc/index.ts'),
  pmsm: () => import('./modern/pmsm/index.ts'),
  srm: () => import('./modern/srm/index.ts'),
  stepper: () => import('./modern/stepper/index.ts'),
  servo: () => import('./modern/servo/index.ts'),
  'induction-motor': () => import('./inductionMotor/index.ts'),
  'wound-rotor': () => import('./inductionMotor/woundRotor/index.ts'),
  'single-phase-induction': () => import('./inductionMotor/singlePhase/index.ts'),
  alternator: () => import('./synchronous/alternator.ts'),
  'synchronous-motor': () => import('./synchronous/motor.ts'),
  'sys-genset': () => import('./systems/genset.tsx'),
  'sys-motor-load': () => import('./systems/motorLoad.tsx'),
  'sys-inverter-motor': () => import('./systems/inverterMotor.tsx'),
  'sys-regen': () => import('./systems/regen.tsx'),
  'sys-ev': () => import('./systems/ev.tsx'),
}
