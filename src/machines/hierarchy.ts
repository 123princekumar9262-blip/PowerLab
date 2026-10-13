import type { Assembly, MachineDef, MachinePart, Vec3 } from './types.ts'

/*
 * The component hierarchy of a model: assemblies group parts (or smaller assemblies). A model without assemblies
 * is one flat list of parts. Selecting an assembly selects every part in it.
 */

export const assemblyOf = (def: MachineDef, id: string): Assembly | undefined => def.assemblies?.find((a) => a.id === id)

/** The part ids an id stands for: itself for a part, every part inside for an assembly. */
export function partsIn(def: MachineDef, id: string): string[] {
  const a = assemblyOf(def, id)
  if (!a) return def.parts.some((p) => p.id === id) ? [id] : []
  return a.children.flatMap((c) => partsIn(def, c))
}

/** The assembly that directly contains an id (part or assembly), if any. */
export const parentOf = (def: MachineDef, id: string): Assembly | undefined => def.assemblies?.find((a) => a.children.includes(id))

/** The top of the tree: assemblies and parts that no assembly contains. */
export function roots(def: MachineDef): string[] {
  if (!def.assemblies?.length) return def.parts.map((p) => p.id)
  const inside = new Set(def.assemblies.flatMap((a) => a.children))
  return [...def.assemblies.map((a) => a.id), ...def.parts.map((p) => p.id)].filter((id) => !inside.has(id))
}

export const labelOf = (def: MachineDef, id: string): string => assemblyOf(def, id)?.label ?? def.parts.find((p) => p.id === id)?.label ?? id

/** Does a part match a search (label, what it is, its function, its material)? */
export function partMatches(p: MachinePart, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return [p.label, p.what, p.function, p.material ?? ''].some((t) => t.toLowerCase().includes(s))
}

/** The stages a model comes apart in (1 … N). */
export const stageCount = (def: MachineDef): number => Math.max(1, ...def.parts.map((p) => p.stage))

/**
 * The disassembly as single moves, one after another: a move is one part, or the parts that come off together
 * (same stage and same direction — e.g. an end cap with the terminals mounted on it). Ordered by stage, then by
 * the order the parts are listed in. Move k runs while the assembly goes from k − 1 to k.
 */
export interface Move {
  slot: number
  stage: number
  parts: string[]
}
export function disassemblyMoves(def: MachineDef): Move[] {
  const moving = def.parts.filter((p) => p.explode.some((x) => x !== 0))
  const stages = [...new Set(moving.map((p) => p.stage))].sort((a, b) => a - b)
  const moves: Move[] = []
  for (const st of stages) {
    const groups = new Map<string, string[]>()
    for (const p of moving.filter((x) => x.stage === st)) {
      const key = def.disassemblyGrouping === 'attached' ? rootOf(def, p.id) : p.explode.join(',')
      groups.set(key, [...(groups.get(key) ?? []), p.id])
    }
    for (const parts of groups.values()) moves.push({ slot: moves.length + 1, stage: st, parts })
  }
  return moves
}

/** The part a part is (through `attachedTo`, transitively) fixed to — itself if it is fixed to nothing. */
export function rootOf(def: MachineDef, id: string): string {
  const seen = new Set<string>()
  let cur = id
  for (;;) {
    const next = def.parts.find((p) => p.id === cur)?.attachedTo
    if (!next || seen.has(next)) return cur
    seen.add(cur)
    cur = next
  }
}

/** The offset a part (or each part of an assembly) moves by when pulled out on its own; null if it cannot be. */
export function inspectOffset(def: MachineDef, id: string): Vec3 | null {
  const a = assemblyOf(def, id)
  if (a) return a.inspect ?? null
  const p = def.parts.find((x) => x.id === id)
  if (!p) return null
  // an explicit zero offset: not a separate physical part (e.g. a region such as an air gap)
  if (p.inspect) return p.inspect.some((x) => x !== 0) ? p.inspect : null
  return p.explode.some((x) => x !== 0) ? p.explode : null
}

/** Each part's total pull-out offset for the pulled ids (parts and assemblies; offsets of nested pulls add up). */
export function pullOffsets(def: MachineDef, pulled: Iterable<string>): Map<string, Vec3> {
  const out = new Map<string, Vec3>()
  for (const id of pulled) {
    const v = inspectOffset(def, id)
    if (!v) continue
    for (const pid of partsIn(def, id)) {
      const o = out.get(pid) ?? [0, 0, 0]
      out.set(pid, [o[0] + v[0], o[1] + v[1], o[2] + v[2]])
    }
  }
  return out
}

/** Each moving part's move number (parts that never move are not listed). */
export function slotsOf(def: MachineDef): Map<string, number> {
  return new Map(disassemblyMoves(def).flatMap((m) => m.parts.map((id) => [id, m.slot] as const)))
}
