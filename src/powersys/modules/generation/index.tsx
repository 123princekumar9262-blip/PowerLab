import { useState } from 'react'
import type { ModuleProps } from '../../types.ts'
import { DEFAULT_PLANTS, type Plants, type PlantType } from './calc.ts'
import { Experiments } from './experiment.tsx'
import { Explore } from './explore.tsx'
import { Learn } from './learn.tsx'
import { Practise, Verify } from './practise.tsx'
import { LAB0, type LabState } from './se.ts'
import './generation.css'

/*
 * Module 17 — Power Generation & Grid Monitoring. Every number is computed (calc.ts, se.ts):
 *  · coal (heat rate, efficiency chain, fuel, condenser heat), hydro (ρgQHη, reservoir energy), nuclear (≈ 200 MeV per
 *    fission, energy per kg from Avogadro, fuel per day) and pumped storage (round trip) — station data illustrative;
 *  · SCADA / EMS / PMU explained, and a weighted-least-squares state estimator on a three-bus DC network with the
 *    chi-square and largest-normalised-residual bad-data tests.
 * Learn: a guided explanation. Explore: the 3D stations (2D process-flow fallback) and the SCADA / estimation lab.
 * Experiment: predict, then compare. Verify: the numbers by hand, each checked a second way. Practise.
 */
export default function GenerationModule({ mode, setMode }: ModuleProps) {
  const [plants, setPlants] = useState<Plants>(DEFAULT_PLANTS)
  const [lab, setLab] = useState<LabState>(LAB0)
  const [seen, setSeen] = useState<PlantType[]>(['thermal'])
  return (
    <div className="gen">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore plants={plants} setPlants={setPlants} lab={lab} setLab={setLab} seen={seen} setSeen={setSeen} setMode={setMode} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify plants={plants} lab={lab} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}
