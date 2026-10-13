import { describe, expect, it } from 'vitest'
import { assemblyOf, disassemblyMoves, inspectOffset, labelOf, parentOf, partMatches, partsIn, pullOffsets, rootOf, roots, slotsOf, stageCount } from '../src/machines/hierarchy.ts'
import { MODEL_LOADERS } from '../src/machines/models/index.ts'
import { ease, stageFactor } from '../src/machines/viewer/context.tsx'
import type { MachineDef } from '../src/machines/types.ts'

const load = async (id: string): Promise<MachineDef> => (await MODEL_LOADERS[id]()).default

/** Where a part sits when the assembly is at `e` (0 … moves): what <Part> computes every frame. */
const offsetIn = (def: MachineDef) => {
  const slots = slotsOf(def)
  return (p: MachineDef['parts'][number], e: number) => p.explode.map((x) => x * ease(stageFactor(e, slots.get(p.id) ?? p.stage)))
}

describe('3D Machines Lab: component explorer (every model)', () => {
  it.each(Object.keys(MODEL_LOADERS))('%s: the component tree, relations and disassembly are consistent', async (id) => {
    const def = await load(id)
    const parts = new Set(def.parts.map((p) => p.id))
    // every relation points at a real part (never itself)
    for (const p of def.parts)
      for (const r of p.relations ?? []) {
        expect(parts.has(r.id), `${p.id} → ${r.id}`).toBe(true)
        expect(r.id).not.toBe(p.id)
        expect(r.how.length, `${p.id} → ${r.id} says how`).toBeGreaterThan(8)
      }
    // the tree: each part exactly once, assembly ids distinct from part ids, no cycles
    const asm = def.assemblies ?? []
    for (const a of asm) {
      expect(parts.has(a.id), `${a.id} is not also a part`).toBe(false)
      expect(a.children.length).toBeGreaterThan(0)
      expect(a.what.length).toBeGreaterThan(20)
    }
    const listed = roots(def).flatMap((r) => partsIn(def, r))
    expect([...listed].sort()).toEqual([...parts].sort())
    expect(new Set(listed).size).toBe(listed.length)
    // narration: one per stage when given
    const S = stageCount(def)
    if (def.disassembly) expect(def.disassembly.length).toBe(S)
    // every stage moves at least one part (a stage that moves nothing would be an empty step)
    for (let k = 1; k <= S; k++) expect(def.parts.some((p) => p.stage === k && p.explode.some((x) => x !== 0)), `stage ${k} moves something`).toBe(true)
  })

  it('Disassemble moves one part (or parts fixed together) at a time, stage by stage', async () => {
    for (const id of Object.keys(MODEL_LOADERS)) {
      const def = await load(id)
      const moves = disassemblyMoves(def)
      const offset = offsetIn(def)
      // every moving part in exactly one move; stages never go backwards; a move's parts share stage and direction
      const moving = def.parts.filter((p) => p.explode.some((x) => x !== 0)).map((p) => p.id)
      expect(moves.flatMap((m) => m.parts).sort(), id).toEqual([...moving].sort())
      for (let k = 1; k < moves.length; k++) expect(moves[k].stage).toBeGreaterThanOrEqual(moves[k - 1].stage)
      for (const m of moves) {
        const ps = m.parts.map((pid) => def.parts.find((p) => p.id === pid)!)
        expect(new Set(ps.map((p) => p.stage)).size).toBe(1)
        // parts move together only when physically fixed together ('attached'), or (older models) share a direction
        if (def.disassemblyGrouping === 'attached') expect(new Set(m.parts.map((pid) => rootOf(def, pid))).size, `${id} move ${m.slot}`).toBe(1)
        else expect(new Set(ps.map((p) => p.explode.join(','))).size).toBe(1)
      }
      // halfway through move k, only move k's parts are on their way; the others are home or already off
      for (const m of moves) {
        const e = m.slot - 0.5
        for (const p of def.parts.filter((x) => moving.includes(x.id))) {
          const o = offset(p, e)
          const done = o.every((x, i) => x === p.explode[i])
          const home = o.every((x) => x === 0)
          if (m.parts.includes(p.id)) expect(!done && !home, `${id} ${p.id} moving in move ${m.slot}`).toBe(true)
          else expect(done || home, `${id} ${p.id} still during move ${m.slot}`).toBe(true)
        }
      }
    }
  })

  it('separation is exact: 0 % is the assembly, 100 % the full offsets, and positions never accumulate', async () => {
    for (const id of Object.keys(MODEL_LOADERS)) {
      const def = await load(id)
      const offset = offsetIn(def)
      const slots = slotsOf(def)
      const S = disassemblyMoves(def).length
      for (const p of def.parts) {
        const k = slots.get(p.id) ?? p.stage
        expect(offset(p, 0).every((x) => x === 0), `${id} ${p.id} at 0`).toBe(true)
        expect(offset(p, S), `${id} ${p.id} at 100 %`).toEqual(p.explode.map((x) => x * 1))
        // a part has finished moving once its own move is done, and has not started before it
        expect(offset(p, k)).toEqual(p.explode.map((x) => x * 1))
        expect(offset(p, k - 1).every((x) => x === 0)).toBe(true)
      }
      // going 0 → 100 % → 0 through many intermediate values returns exactly (the offset is a function of e only)
      const path = [0.3, 2.7, S, 1.1, 0.05, S * 0.5, 0]
      for (const p of def.parts) expect(path.map((e) => offset(p, e)).at(-1)!.every((x) => x === 0)).toBe(true)
    }
  })
})

describe('3D Machines Lab: brushed DC motor components', () => {
  it('15 parts in 4 assemblies: stator, rotor, brush gear, end caps and bearings', async () => {
    const def = await load('dc-motor')
    expect(def.parts).toHaveLength(15)
    expect(roots(def)).toEqual(['stator', 'rotor', 'brush-gear', 'frame'])
    expect(partsIn(def, 'stator')).toEqual(['housing', 'magnet-n', 'magnet-s'])
    expect(partsIn(def, 'rotor')).toEqual(['shaft', 'armature-core', 'armature-winding', 'commutator'])
    expect(partsIn(def, 'brush-gear')).toEqual(['terminals', 'brush-holders', 'brush-pos', 'brush-neg'])
    expect(parentOf(def, 'commutator')?.id).toBe('rotor')
    expect(assemblyOf(def, 'rotor')?.label).toMatch(/armature/)
    expect(labelOf(def, 'brush-neg')).toBe('Brush (−)')
  })

  it('every part has its own location, material, relations and fault note (no copied text)', async () => {
    const def = await load('dc-motor')
    for (const p of def.parts) {
      expect(p.location?.length, `${p.id} location`).toBeGreaterThan(15)
      expect(p.material?.length, `${p.id} material`).toBeGreaterThan(4)
      expect(p.ifFaulty?.length, `${p.id} fault`).toBeGreaterThan(30)
      expect(p.relations?.length, `${p.id} relations`).toBeGreaterThanOrEqual(2)
      expect(p.related).toEqual(p.relations!.map((r) => r.id))
    }
    for (const k of ['function', 'location', 'ifFaulty'] as const) expect(new Set(def.parts.map((p) => p[k])).size, k).toBe(15)
  })

  it('relations are mutual where the physics is: brushes ↔ commutator, shaft ↔ bearings, magnet ↔ magnet', async () => {
    const def = await load('dc-motor')
    const rel = (a: string, b: string) => !!def.parts.find((p) => p.id === a)?.relations?.some((r) => r.id === b)
    for (const [a, b] of [['brush-pos', 'commutator'], ['brush-neg', 'commutator'], ['shaft', 'bearing-front'], ['shaft', 'bearing-rear'], ['magnet-n', 'magnet-s'], ['terminals', 'brush-pos']]) {
      expect(rel(a, b), `${a} → ${b}`).toBe(true)
      expect(rel(b, a), `${b} → ${a}`).toBe(true)
    }
  })

  it('disassembly order: front cap, brushes, holders, rear cap, bearings, stator — the rotor stays whole', async () => {
    const def = await load('dc-motor')
    const stageOf = (id: string) => def.parts.find((p) => p.id === id)!.stage
    expect(stageCount(def)).toBe(6)
    expect(['end-cap-front', 'terminals'].map(stageOf)).toEqual([1, 1])
    expect(['brush-pos', 'brush-neg'].map(stageOf)).toEqual([2, 2])
    expect(stageOf('brush-holders')).toBe(3)
    expect(stageOf('end-cap-rear')).toBe(4)
    expect(['bearing-front', 'bearing-rear'].map(stageOf)).toEqual([5, 5])
    expect(['housing', 'magnet-n', 'magnet-s'].map(stageOf)).toEqual([6, 6, 6])
    for (const id of partsIn(def, 'rotor')) expect(def.parts.find((p) => p.id === id)!.explode).toEqual([0, 0, 0])
    expect(def.disassembly!.map((d) => d.title)).toEqual(['Take off the front end cap', 'Withdraw the brushes', 'Remove the brush holders', 'Take off the rear end cap', 'Pull the bearings off the shaft', 'Separate the stator from the rotor'])
    // parts leave along their own directions: front parts forward (+z), rear parts backward, brushes radially
    const ex = (id: string) => def.parts.find((p) => p.id === id)!.explode
    expect(ex('end-cap-front')[2]).toBeGreaterThan(0)
    expect(ex('end-cap-rear')[2]).toBeLessThan(0)
    expect(ex('brush-pos')[1]).toBeGreaterThan(0)
    expect(ex('brush-neg')[1]).toBeLessThan(0)
    expect(ex('magnet-n')[0]).toBeGreaterThan(0)
    expect(ex('magnet-s')[0]).toBeLessThan(0)
  })

  it('how it works: 8 steps in order, commutation its own step, every relation stated with the model', async () => {
    const def = await load('dc-motor')
    expect(def.steps.map((s) => s.id)).toEqual(['construction', 'field', 'current', 'torque', 'rotation', 'commutation', 'back-emf', 'energy'])
    const s = Object.fromEntries(def.steps.map((x) => [x.id, x]))
    expect(s.commutation.layers).toContain('commutation')
    expect(s.commutation.focus).toEqual(expect.arrayContaining(['commutator', 'brush-pos', 'brush-neg']))
    expect(s.field.rotate).toBeFalsy()
    expect(s.rotation.rotate && s.commutation.rotate && s['back-emf'].rotate).toBe(true)
    expect(s.torque.equation).toBe('T = kΦ · Ia')
    expect(s['back-emf'].equation).toContain('E = kΦ · ω')
    // the rotation is clockwise seen from the front (the side the force arrows give): negative ω about +z
    const m = def.motion!({ n: 3000 }, {})
    expect(m.omega).toBeLessThan(0)
  })

  it('search finds parts by name, role and material', async () => {
    const def = await load('dc-motor')
    const find = (q: string) => def.parts.filter((p) => partMatches(p, q)).map((p) => p.id)
    expect(find('magnet')).toEqual(expect.arrayContaining(['magnet-n', 'magnet-s']))
    expect(find('mica')).toEqual(['commutator'])
    expect(find('graphite')).toEqual(expect.arrayContaining(['brush-pos']))
    expect(find('')).toHaveLength(15)
  })
})

/** The same depth for the other deep models: assemblies, own text per part, mutual relations, ordered teardown. */
describe.each([
  {
    id: 'induction-motor',
    roots: ['stator', 'rotor', 'ends', 'cooling', 'air-gap'],
    parts: 15,
    stages: ['Remove the fan cover', 'Pull off the cooling fan', 'Take off the end shields', 'Separate the rotor from the stator', 'Pull the bearings off the shaft'],
    order: [['fan-cover'], ['fan'], ['end-shield-front', 'end-shield-rear'], ['frame', 'stator-core', 'stator-winding'], ['bearing-de', 'bearing-nde']],
    whole: 'rotor',
    mutual: [['rotor-bars', 'end-rings'], ['shaft', 'bearing-de'], ['shaft', 'bearing-nde'], ['fan', 'fan-cover'], ['stator-core', 'stator-winding']],
  },
  {
    id: 'transformer',
    roots: ['primary-circuit', 'magnetic-circuit', 'secondary-circuit', 'structure'],
    parts: 8,
    stages: ['Disconnect the leads and terminals', 'Remove the clamping frame', 'Unstack the top yoke', 'Lift the windings off the limbs', 'Slide off the insulating tubes'],
    order: [['hv-terminals', 'lv-terminals'], ['frame'], ['top-yoke'], ['primary', 'secondary'], ['insulation']],
    whole: null,
    mutual: [['primary', 'secondary'], ['core', 'top-yoke'], ['primary', 'hv-terminals'], ['secondary', 'lv-terminals'], ['hv-terminals', 'lv-terminals']],
  },
])('3D Machines Lab: $id components', ({ id, roots: top, parts, stages, order, whole, mutual }) => {
  it('assemblies, and every part described in its own words', async () => {
    const def = await load(id)
    expect(def.parts).toHaveLength(parts)
    expect(roots(def)).toEqual(top)
    for (const p of def.parts) {
      expect(p.location?.length, `${p.id} location`).toBeGreaterThan(10)
      expect(p.material?.length, `${p.id} material`).toBeGreaterThan(4)
      expect(p.ifFaulty?.length, `${p.id} fault`).toBeGreaterThan(30)
      expect(p.relations?.length, `${p.id} relations`).toBeGreaterThanOrEqual(2)
    }
    for (const k of ['function', 'location', 'ifFaulty'] as const) expect(new Set(def.parts.map((p) => p[k])).size, k).toBe(parts)
  })
  it('relations are mutual where the physics is', async () => {
    const def = await load(id)
    const rel = (a: string, b: string) => !!def.parts.find((p) => p.id === a)?.relations?.some((r) => r.id === b)
    for (const [a, b] of mutual) expect(rel(a, b) && rel(b, a), `${a} ↔ ${b}`).toBe(true)
  })
  it('the teardown follows its order, one narration per stage', async () => {
    const def = await load(id)
    expect(def.disassembly!.map((d) => d.title)).toEqual(stages)
    const stageOf = (pid: string) => def.parts.find((p) => p.id === pid)!.stage
    order.forEach((ids, k) => ids.forEach((pid) => expect(stageOf(pid), pid).toBe(k + 1)))
    if (whole) for (const pid of partsIn(def, whole)) expect(def.parts.find((p) => p.id === pid)!.explode, `${pid} stays`).toEqual([0, 0, 0])
  })
})

describe('3D Machines Lab: transformer teardown is physical', () => {
  it('the windings lift straight up off the limbs, clear of the insulating tubes, after the top yoke is out of the way', async () => {
    const def = await load('transformer')
    const ex = (pid: string) => def.parts.find((p) => p.id === pid)!.explode
    expect(ex('primary')).toEqual([0, 3.2, 0])
    expect(ex('secondary')).toEqual([0, 3.2, 0])
    expect(ex('insulation')[0]).toBe(0)
    // coils (y −0.9 … 0.9) end above the tubes (y −0.97 … 0.97 + their own lift)
    expect(-0.9 + ex('primary')[1]).toBeGreaterThan(0.97 + ex('insulation')[1])
    // the top yoke moves up and back, out of the coils' path (coils reach z ±0.73, the yoke is 0.8 deep)
    expect(ex('top-yoke')[2] + 0.4).toBeLessThan(-0.73)
  })
})

describe('3D Machines Lab: one part at a time — pull out and put back (DC motor, induction motor, transformer)', () => {
  it.each(['dc-motor', 'induction-motor', 'transformer'])('%s: every physical part can be pulled out on its own; nothing else moves', async (id) => {
    const def = await load(id)
    for (const p of def.parts) {
      const v = inspectOffset(def, p.id)
      if (p.id === 'air-gap') {
        expect(v, 'a region is not a part: it cannot be pulled out').toBeNull()
        continue
      }
      expect(v, `${id} ${p.id} can be pulled out`).not.toBeNull()
      const pulls = pullOffsets(def, [p.id])
      // only this part moves, by exactly its offset
      expect([...pulls.keys()]).toEqual([p.id])
      expect(pulls.get(p.id)).toEqual(v)
    }
    // putting it back: no pulled ids, no offsets at all
    expect(pullOffsets(def, []).size).toBe(0)
  })

  it('a pulled assembly moves all its parts as one unit; a child pulled as well adds its own offset', async () => {
    const def = await load('dc-motor')
    const rotor = pullOffsets(def, ['rotor'])
    expect([...rotor.keys()].sort()).toEqual(['armature-core', 'armature-winding', 'commutator', 'shaft'])
    for (const v of rotor.values()) expect(v).toEqual([0, 0, -3.8])
    const both = pullOffsets(def, ['rotor', 'commutator'])
    expect(both.get('commutator')).toEqual([0, 0, -3.8 + 2.4])
    expect(both.get('shaft')).toEqual([0, 0, -3.8])
  })

  it('parts that cannot really come off on their own say so', async () => {
    for (const [id, parts] of [['dc-motor', ['shaft', 'armature-core', 'armature-winding', 'commutator', 'terminals']], ['induction-motor', ['stator-core', 'stator-winding', 'rotor-bars', 'end-rings', 'rotor-core', 'shaft']], ['transformer', ['core', 'primary', 'secondary', 'insulation']]] as const) {
      const def = await load(id)
      for (const pid of parts) expect(def.parts.find((p) => p.id === pid)!.inspectNote?.length, `${id} ${pid}`).toBeGreaterThan(30)
    }
  })

  it('the disassembly moves only parts that are physically fixed together', async () => {
    const tx = disassemblyMoves(await load('transformer'))
    // the two coils are separate parts: two moves, not one
    expect(tx.find((m) => m.parts.includes('primary'))!.parts).toEqual(['primary'])
    expect(tx.find((m) => m.parts.includes('secondary'))!.parts).toEqual(['secondary'])
    const dc = disassemblyMoves(await load('dc-motor'))
    expect(dc.find((m) => m.parts.includes('terminals'))!.parts).toEqual(['end-cap-front', 'terminals'])
    const im = disassemblyMoves(await load('induction-motor'))
    expect(im.find((m) => m.parts.includes('frame'))!.parts.sort()).toEqual(['air-gap', 'frame', 'stator-core', 'stator-winding', 'terminal-box'])
  })
})

describe('3D Machines Lab: lessons explain each highlighted part in its step', () => {
  it.each(Object.keys(MODEL_LOADERS))('%s: step roles belong to that step', async (id) => {
    const def = await load(id)
    for (const s of def.steps) for (const pid of Object.keys(s.roles ?? {})) expect(s.focus, `${id} ${s.id}: ${pid}`).toContain(pid)
  })
  it.each(['dc-motor', 'induction-motor', 'transformer'])('%s: after the construction overview, every highlighted part has its own role in the step', async (id) => {
    const def = await load(id)
    for (const s of def.steps.filter((x) => x.id !== 'construction'))
      for (const pid of s.focus) {
        const role = s.roles?.[pid]
        expect(role?.length, `${id} ${s.id}: ${pid}`).toBeGreaterThan(20)
        // specific to the step, not the part's general description
        expect(role, `${id} ${s.id}: ${pid}`).not.toBe(def.parts.find((p) => p.id === pid)!.function)
      }
  })
})
