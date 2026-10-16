import { useState } from 'react'
import type { ModuleProps } from '../../types.ts'
import { Experiments } from './experiment.tsx'
import { Explore } from './explore.tsx'
import { Learn } from './learn.tsx'
import { Practise } from './practise.tsx'
import { STATE0, type HfState } from './shared.tsx'
import { Verify } from './verify.tsx'
import './hvdc-facts.css'

/*
 * Module 14 — HVDC & FACTS. One model (calc.ts): the line-commutated converter (V_d, overlap, reactive power), the
 * LCC link under CC/CEA control, the VSC link inside its capability, series and midpoint shunt compensation, the TCR,
 * and a weak bus with an SVC or a STATCOM (P–V curves, collapse). Learn: a guided explanation. Explore: four views
 * with a 3D scene of the link and the weak bus (2D schematic as fallback). Experiment: predict, then compare.
 * Verify: the numbers by hand, each checked by a second method. Practise: questions.
 */
export default function HvdcFactsModule({ mode, setMode }: ModuleProps) {
  const [st, setSt] = useState<HfState>(STATE0)
  return (
    <div className="hf">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore st={st} setSt={setSt} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify st={st} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}
