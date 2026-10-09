import { describe, expect, it } from 'vitest'
import { compareWithTheory } from '../src/measurements/compare.ts'
import { DEFAULT_PARAMS, THREE_PHASE_DEFAULTS } from '../src/simulation/params.ts'
import { runSimulation } from '../src/simulation/engine.ts'
import { RECOMMENDED_CYCLES } from '../src/state/labState.ts'
import type { CircuitId, LabParams, LoadType, RectifierTopology } from '../src/types/simulation.ts'

/*
 * Golden numbers for the Rectifier Lab, recorded before the Phase 3 workspace-shell migration.
 * The migration moves UI only — these values must not change. 6 significant digits.
 *
 * columns: Vdc, Vrms, ΔVpp, Io avg, Id peak, PIV, μ [°] (null = not a 3-φ quantity), solver fallbacks, events
 */
type Golden = [string, RectifierTopology, LoadType, 'diode' | 'scr', { alpha?: number; fw?: boolean; ls?: number }, Array<number | null>]
const GOLDEN: Golden[] = [
  ['1φ half-wave R', 'half-wave', 'R', 'diode', {}, [5.05649, 8.0424, 16.2706, 0.505649, 1.62706, 16.9706, null, 0, 31]],
  ['1φ half-wave RL', 'half-wave', 'RL', 'diode', {}, [3.72216, 8.87031, 31.1547, 0.371568, 1.01031, 16.9706, null, 0, 59]],
  ['1φ half-wave RL + Dfw', 'half-wave', 'RL', 'diode', { fw: true }, [4.70189, 8.05775, 16.9706, 0.470189, 1.02078, 16.2706, null, 0, 74]],
  ['1φ center-tap R', 'center-tap', 'R', 'diode', {}, [10.113, 11.3737, 16.2706, 1.0113, 1.62706, 33.2411, null, 0, 47]],
  ['1φ bridge RC', 'bridge', 'RC', 'diode', {}, [12.137, 12.3612, 7.39262, 1.2137, 5.21959, 16.2706, null, 0, 118]],
  ['1φ bridge RLC', 'bridge', 'RLC', 'diode', {}, [9.40379, 9.40761, 0.765226, 0.940379, 1.1792, 16.2706, null, 0, 187]],
  ['1φ half-wave SCR R α30', 'half-wave', 'R', 'scr', {}, [4.75132, 7.94204, 16.2706, 0.475132, 1.62706, 16.9706, null, 0, 31]],
  ['1φ full bridge SCR RL α45', 'bridge', 'RL', 'scr', { alpha: 45 }, [6.23943, 11.1611, 28.9706, 0.623944, 0.921745, 16.2706, null, 0, 93]],
  ['1φ semi bridge RL α30', 'semi-bridge', 'RL', 'scr', {}, [8.68149, 10.6579, 16.9706, 0.867582, 1.09966, 16.2706, null, 0, 93]],
  ['3φ 3-pulse R', '3ph-half-wave', 'R', 'diode', {}, [13.3345, 13.5788, 8.48528, 1.33345, 1.62706, 28.6939, 0, 0, 63]],
  ['3φ 6-pulse R', '3ph-bridge', 'R', 'diode', {}, [26.6691, 26.6951, 3.93803, 2.66691, 2.79939, 28.6939, 0, 0, 87]],
  ['3φ 6-pulse RL Ls 2 mH', '3ph-bridge', 'RL', 'diode', { ls: 2e-3 }, [25.1369, 25.1875, 5.10932, 2.51294, 2.59473, 27.7537, 26.0178, 0, 277]],
  ['3φ 3-pulse SCR R α30', '3ph-half-wave', 'R', 'scr', {}, [11.4647, 12.5416, 16.2706, 1.14647, 1.62706, 28.6939, null, 0, 87]],
  ['3φ half-controlled RL α30', '3ph-half-controlled', 'RL', 'scr', {}, [24.7925, 25.0745, 14.6703, 2.47851, 2.72187, 28.6939, 0, 0, 202]],
  ['3φ full bridge SCR RL α30', '3ph-bridge', 'RL', 'scr', {}, [22.9122, 23.3383, 14.6969, 2.28939, 2.48178, 28.6939, 0, 0, 202]],
]

/** The parameters the lab uses when a circuit is opened from its route (App.initialState). */
function paramsFor(topology: RectifierTopology, load: LoadType, device: 'diode' | 'scr', o: Golden[4]): LabParams {
  const base = topology.startsWith('3ph') ? THREE_PHASE_DEFAULTS : DEFAULT_PARAMS
  const ctl = base.control ?? { device: 'diode' as const, alphaDeg: 30, freewheel: false }
  const p: LabParams = {
    ...base,
    control: { ...ctl, device, alphaDeg: o.alpha ?? 30, freewheel: !!o.fw },
    sim: { ...base.sim, cycles: Math.max(base.sim.cycles, RECOMMENDED_CYCLES[load]) },
  }
  if (o.ls !== undefined && p.threePhase) p.threePhase = { ...p.threePhase, ls: o.ls }
  return p
}

const sig = (x: number) => Number(x.toPrecision(6))

describe('Rectifier golden numbers (unchanged by the workspace-shell migration)', () => {
  for (const [name, topology, load, device, o, want] of GOLDEN) {
    it(name, () => {
      const r = runSimulation(paramsFor(topology, load, device, o), `${topology}:${load}` as CircuitId)
      const c = compareWithTheory(r)
      const m = c.measurements
      const got = [m.voutAvg, m.voutRms, m.ripplePP, m.ioAvg, m.idPeak, m.piv]
      got.forEach((g, i) => expect(sig(g), `${name} column ${i}`).toBe(want[i]))
      if (want[6] === null) expect(m.overlapDeg === null || m.overlapDeg === undefined).toBe(true)
      else expect(sig(m.overlapDeg ?? NaN)).toBe(want[6])
      expect(r.diagnostics.solverFallbacks).toBe(want[7])
      expect(r.events.length).toBe(want[8])
      expect(c.allWithinTolerance).toBe(true)
    })
  }
})
