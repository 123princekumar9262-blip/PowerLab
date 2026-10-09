import { useState } from 'react'
import { App, type RectifierInitial } from '../App.tsx'
import { carryRectifier } from '../rectifier/carry.ts'
import type { LabParams } from '../types/simulation.ts'
import { lastParams } from '../workspace/carry.ts'
import { labById, rectifierTopicFor, topicOf, type ModeId } from '../catalogue/catalogue.ts'
import type { AppMode } from '../state/labState.ts'
import type { LoadType } from '../types/simulation.ts'
import type { WorkspaceProps } from './types.ts'

const LOADS: LoadType[] = ['R', 'RL', 'RC', 'RLC']
const toApp = (m: ModeId): AppMode => (m === 'explore' ? 'lab' : m)
const fromApp = (m: AppMode): ModeId => (m === 'lab' ? 'explore' : m)
const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)

/** The rectifier lab, opened on the circuit its route names and already running. */
export default function RectifierWorkspace({ topic, mode, query, level, onActivity }: WorkspaceProps) {
  const t = topicOf(labById('rectifiers')!, topic)!
  const sel = t.rectifier!
  const ls = num(query.ls)
  const load = LOADS.includes(query.load as LoadType) ? (query.load as LoadType) : 'R'
  // "Change circuit" keeps the previous circuit's values where this one uses them (read once, on opening);
  // the address's own values (α, Ls — entry points) win, so they are not reported as carried
  const [carry] = useState(() => {
    const prev = lastParams<LabParams>('rectifiers')
    if (!prev) return null
    const c = carryRectifier(prev, sel.topology, sel.device, load)
    const routed = (x: string) => (query.alpha !== undefined && x.startsWith('α')) || (query.ls !== undefined && x.startsWith('source Ls'))
    return { params: c.params, report: { kept: c.report.kept.filter((x) => !routed(x)), notUsed: c.report.notUsed.filter((x) => !routed(x)) } }
  })
  const initial: RectifierInitial = {
    topology: sel.topology,
    device: sel.device,
    load,
    mode: toApp(mode),
    density: level,
    freewheel: query.fw === '1',
    alphaDeg: num(query.alpha),
    // the route gives the source inductance in mH
    ls: ls !== undefined ? ls * 1e-3 : undefined,
    sheet: query.sheet || undefined,
    lesson: query.lesson ? { id: query.lesson, step: num(query.step) ?? 0 } : undefined,
    carried: carry?.params,
  }
  return (
    <App
      initial={initial}
      carryReport={carry?.report}
      onActivity={(a) => {
        const now = rectifierTopicFor({ topology: a.topology, device: a.device })
        if (!now) return
        onActivity({
          topic: now.id,
          mode: fromApp(a.mode),
          query: { load: a.load, ...(a.freewheel ? { fw: '1' } : {}), ...(a.lesson ? { lesson: a.lesson.id, step: String(a.lesson.step) } : {}) },
          level: a.density,
          lesson: a.lesson,
        })
      }}
    />
  )
}
