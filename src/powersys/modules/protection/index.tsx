import { useState } from 'react'
import type { ModuleProps } from '../../types.ts'
import { Experiments } from './experiment.tsx'
import { Explore } from './explore.tsx'
import { Learn } from './learn.tsx'
import { Practise, Verify } from './practise.tsx'
import { STATE0, type ModState, type Section } from './state.ts'
import './protection.css'

/*
 * Module 13 — Advanced Protection. Distance protection (built on Module 4's fault model: a fault part-way along a
 * line, what each relay measures, k₀, mho zones, fault resistance and infeed, the trip sequence), directional
 * elements, transformer differential protection, neutral earthing, the generator stator earth fault and circuit-breaker
 * duty (breaking and making current, recovery voltage). Learn → Explore (3D route + R–X plane) → Experiment →
 * Verify → Practise.
 */

export default function ProtectionModule({ mode, setMode }: ModuleProps) {
  const [st, setSt] = useState<ModState>(STATE0)
  const [section, setSection] = useState<Section>('distance')
  return (
    <div className="pr">
      {mode === 'learn' && <Learn onExplore={() => setMode('explore')} />}
      {mode === 'explore' && <Explore st={st} set={setSt} section={section} setSection={setSection} />}
      {mode === 'experiment' && <Experiments />}
      {mode === 'verify' && <Verify st={st} />}
      {mode === 'practise' && <Practise />}
    </div>
  )
}
