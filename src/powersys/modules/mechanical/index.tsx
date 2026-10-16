import { useState } from 'react'
import type { ModuleProps } from '../../types.ts'
import { Experiments } from './experiment.tsx'
import { Explore, type ExploreView } from './explore.tsx'
import { Learn } from './learn.tsx'
import { DESIGN0, type Design } from './model.ts'
import { Practise } from './practise.tsx'
import { Verify } from './verify.tsx'
import './mechanical.css'

/*
 * Module 9 — Mechanical Design & Insulation. One design (a span with its conductor, tension and loads; an insulator
 * string; the corona inputs) is computed by calc.ts: the catenary in the plane of the load (with the parabola beside
 * it), wind and ice, unequal supports and clearance; the string's voltage distribution (ladder and nodal solve,
 * grading, an ideal guard ring); Peek's corona voltages. Learn: a guided explanation. Explore: the 3D span and string
 * with 2D elevation, ladder and corona views. Experiment: predict, then compare. Verify: the numbers by hand. Practise.
 */
export default function MechanicalModule({ mode, setMode }: ModuleProps) {
  const [design, setDesign] = useState<Design>(DESIGN0)
  const [view, setView] = useState<ExploreView>('span')
  return (
    <div className="mech">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore design={design} setDesign={setDesign} view={view} setView={setView} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify design={design} edited={design !== DESIGN0} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}
