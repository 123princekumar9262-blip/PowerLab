import type { ModuleProps } from '../../types.ts'
import { Experiments } from './experiment.tsx'
import { Explore } from './explore.tsx'
import { Learn } from './learn.tsx'
import { Practise } from './practise.tsx'
import { Verify } from './verify.tsx'
import './distribution.css'

/*
 * Module 16 — Distribution Systems & Power Factor. Every number is computed (distributor.ts, acdist.ts, pf.ts,
 * kelvin.ts):
 *  · two-wire DC distributors fed at one end, at both ends or as a ring main, with concentrated and uniform loads —
 *    section currents, the point of minimum potential, checked by nodal analysis;
 *  · an AC distributor with load power factors referred to the far-end voltage or to their own voltages (complex);
 *  · power-factor correction: the capacitor bank (kVAr, µF per phase in star and delta), the economical power factor
 *    and a feeder solved exactly; Kelvin's law for the economical conductor size.
 * All data are illustrative values (no textbook example, utility tariff or standard is quoted). The module is 2D:
 * the diagrams are drawn to scale, and a 3D street would add no engineering the 2D diagram does not show.
 */
export default function DistributionModule({ mode, setMode }: ModuleProps) {
  return (
    <div className="ds">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}
