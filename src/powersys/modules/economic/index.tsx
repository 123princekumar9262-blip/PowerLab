import type { ModuleProps } from '../../types.ts'
import { Experiments } from './experiment.tsx'
import { Explore } from './explore.tsx'
import { Learn } from './learn.tsx'
import { Practise } from './practise.tsx'
import { Verify } from './verify.tsx'
import './economic.css'

/*
 * Module 11 — Economic Operation. Every number is computed (dispatch.ts, commitment.ts, lagrangian.ts):
 *  · economic load dispatch of three thermal units by λ-iteration — limits (Kuhn–Tucker), B-coefficient losses
 *    (penalty factors, coordination equations) — checked against the closed form, the exact breakpoint solution and
 *    Newton on the full Lagrangian;
 *  · unit commitment for one load level (priority list vs enumerating all 2ⁿ combinations), hour by hour over an
 *    illustrative daily curve;
 *  · load curve, load factor, duration curve and a two-part tariff (illustrative rates).
 * Reference case: Saadat, Power System Analysis, Example 7.4 ($); the Indian case (₹) is illustrative.
 */
export default function EconomicModule({ mode, setMode }: ModuleProps) {
  return (
    <div className="ed">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}
