import { dcdcModel } from '../dcdc/model.ts'

/**
 * Buck (step-down) converter.
 *
 *   Vin+ ──Q1──┬── sw ──L──(DCR)── out ──┬────┐
 *              │                         │    │
 *             D1 (anode at ground)     (ESR)  R
 *              │                         C    │
 *   Vin− ──────┴─────────────────────────┴────┘  (ground)
 *
 * Built by the DC-DC family model (dcdc/model.ts). The solver integrates L·diL/dt = vL and
 * C·dvC/dt = iC with iC = iL − iLoad; the diode state is never scheduled.
 */
export const BUCK_MODEL = dcdcModel('buck')
