import { describe, expect, it } from 'vitest'
import type { AnyTopic } from '../src/lab/types.ts'
import { TOPICS as CONTROL } from '../src/workspaces/control.tsx'
import { TOPICS as DCDC } from '../src/workspaces/dcdc.tsx'
import { TOPICS as DEVICES } from '../src/workspaces/devices.tsx'
import { TOPICS as DRIVES } from '../src/workspaces/drives.tsx'
import { TOPICS as EV } from '../src/workspaces/ev.tsx'
import { TOPICS as INV } from '../src/workspaces/inverters.tsx'
import { TOPICS as MAG } from '../src/workspaces/magnetics.tsx'
import { TOPICS as PWM } from '../src/workspaces/pwm.tsx'
import { TOPICS as THERMAL } from '../src/workspaces/thermal.tsx'

/*
 * Every Experiment in the topic labs, run as the Experiment panel runs it: from the lab's standard values
 * (steady view) to the experiment's change. The change must really change the circuit and its result, the
 * verdict must be one of the offered answers, and the explanation must quote real numbers.
 */
const LABS: Record<string, Record<string, AnyTopic>> = { DCDC, PWM, INV, DEVICES, MAG, CONTROL, DRIVES, THERMAL, EV }
const cases: Array<[string, AnyTopic, number]> = []
for (const [lab, topics] of Object.entries(LABS)) for (const [id, t] of Object.entries(topics)) t.experiments.forEach((_, i) => cases.push([`${lab}/${id} #${i + 1} ${t.experiments[i].title}`, t, i]))

describe('experiments: a real change, a verdict from the two simulations', () => {
  it.each(cases)('%s', (_name, t, i) => {
    const exp = t.experiments[i]
    const p0 = { ...(t.defaults as object), view: 'steady' }
    const p1 = { ...p0, ...exp.change(p0 as never) }
    const before = t.measure(t.simulate(p0 as never)) as Record<string, unknown>
    const after = t.measure(t.simulate(p1 as never)) as Record<string, unknown>
    // the experiment changes the circuit, and at least one of the quantities it shows
    expect(JSON.stringify(p1)).not.toBe(JSON.stringify(p0))
    const moved = exp.rows.some((k) => {
      const a = before[k]
      const b = after[k]
      return typeof a === 'number' && typeof b === 'number' ? Math.abs(b - a) > 1e-6 * Math.max(Math.abs(a), Math.abs(b), 1e-12) : a !== b
    })
    expect(moved, 'no shown quantity changed: the experiment would compare a run with itself').toBe(true)
    const verdict = exp.judge(before as never, after as never)
    expect(Number.isInteger(verdict) && verdict >= 0 && verdict < exp.choices.length).toBe(true)
    const why = exp.why(before as never, after as never, p0 as never, p1 as never)
    expect(why).not.toMatch(/NaN|undefined|Infinity/)
  })
})
