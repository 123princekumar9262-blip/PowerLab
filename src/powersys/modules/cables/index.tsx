import { useState } from 'react'
import type { ModuleProps } from '../../types.ts'
import { DEFAULT_CABLE, G_PERM_DEFAULT, type CableInput } from './calc.ts'
import { Experiments } from './experiment.tsx'
import { Explore } from './explore.tsx'
import { GRADING0, type GradingState } from './grading.ts'
import { Learn } from './learn.tsx'
import { Practise, Verify } from './practise.tsx'
import './cables.css'

/*
 * Module 10 — Underground Cables. One single-core cable (r, R, V, ε_r, ρ, tan δ, f, length) is computed by calc.ts:
 * the radial field (potential and stress), capacitance, insulation resistance, charging current and dielectric loss,
 * the most economical size, grading, a three-core belted cable and the comparison with Module 8's overhead line.
 * Learn: a guided explanation. Explore: the 3D cable (cut-away / stepped, a probe through the insulation) with its 2D
 * cross-section and plots. Experiment: predict, then compare. Verify: the numbers by hand. Practise.
 */
export default function CablesModule({ mode, setMode }: ModuleProps) {
  const [cable, setCable] = useState<CableInput>(DEFAULT_CABLE)
  const [gPerm, setGPerm] = useState(G_PERM_DEFAULT)
  const [grading, setGrading] = useState<GradingState>(GRADING0)
  return (
    <div className="cb">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore cable={cable} setCable={setCable} gPerm={gPerm} setGPerm={setGPerm} grading={grading} setGrading={setGrading} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify cable={cable} gPerm={gPerm} grading={grading} edited={cable !== DEFAULT_CABLE} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}
