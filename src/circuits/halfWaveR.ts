import { solveDiodeThevenin } from '../solvers/diode.ts'
import type { CircuitModel } from './circuitModel.ts'

/** The R load stores no energy, so the circuit has no state variables. */
export type HalfWaveRState = Record<string, never>

const NO_STATE: HalfWaveRState = {}

/**
 * Half-wave rectifier with a resistive load.
 *
 *           D1
 *   ┌──────┤>|──────┐ +
 *   │ +    A    K   │
 *  (~) vin          R  vout
 *   │ −             │
 *   └───────────────┘ −   (return / 0 V reference)
 *
 * One series loop: source → D1 (anode → cathode) → R → back to source.
 * Kirchhoff's voltage law around the loop:  vin = vD + vout,  with vout = R·io.
 * Kirchhoff's current law: in a single loop the same current flows everywhere, so iD = io.
 *
 * Seen from the diode terminals, the rest of the circuit is the source in series
 * with R — a Thévenin equivalent (vth = vin, Rth = R). The diode solver decides
 * ON/OFF from that, then everything else follows from Ohm's law and KVL.
 */
export const halfWaveR: CircuitModel<HalfWaveRState> = {
  id: 'half-wave:R',
  name: 'Half-wave rectifier · R load',
  topology: 'half-wave',
  load: 'R',
  signals: ['vin', 'vout', 'vd', 'io', 'id'],

  initialState: () => NO_STATE,

  step(p, _state, t, h, source) {
    const vin = source.v(t + h)
    const d = solveDiodeThevenin(vin, p.resistance, p.diode)

    const io = d.current // loop current (KCL: identical through source, D1 and R)
    const vout = p.resistance * io // Ohm's law across the load
    const vd = d.voltage // anode − cathode; KVL guarantees vin = vd + vout

    return {
      solution: {
        signals: { vin, vout, vd, io, id: io },
        diodes: [{ id: 'D1', on: d.on, bias: d.bias }],
      },
      // Memoryless: nothing to carry to the next step.
      state: NO_STATE,
    }
  },
}
