import { isBranch, isSource, type Component, type Network } from './types.ts'

/**
 * Topology: which components are in service (all breakers that switch them closed) and which buses are
 * electrically connected (islands). Connectivity comes only from terminals and breaker states.
 */

export interface Issue {
  level: 'error' | 'warning'
  /** The component or bus concerned, if any. */
  at?: string
  text: string
}

/** Is a component in service? A line, transformer or load is out of service when any breaker on it is open. */
export function inService(net: Network, c: Component): boolean {
  if (c.kind === 'breaker') return c.closed
  return net.components.every((b) => b.kind !== 'breaker' || b.target !== c.id || b.closed)
}

/** The breakers that switch a component. */
export const breakersOf = (net: Network, id: string) => net.components.filter((c) => c.kind === 'breaker' && c.target === id)

/** Groups of electrically connected buses (through in-service branches). */
export function islands(net: Network): string[][] {
  const parent = new Map(net.buses.map((b) => [b.id, b.id]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  for (const c of net.components)
    if (isBranch(c) && inService(net, c) && parent.has(c.from) && parent.has(c.to)) {
      const a = find(c.from)
      const b = find(c.to)
      if (a !== b) parent.set(a, b)
    }
  const groups = new Map<string, string[]>()
  for (const b of net.buses) groups.set(find(b.id), [...(groups.get(find(b.id)) ?? []), b.id])
  return [...groups.values()]
}

/** Structural checks: references, duplicates, voltage levels, sources, values. */
export function validate(net: Network): Issue[] {
  const out: Issue[] = []
  const ids = new Set<string>()
  for (const x of [...net.buses, ...net.components]) {
    if (ids.has(x.id))
      out.push({
        level: 'error',
        at: x.id,
        text: `Duplicate identifier “${x.id}”.`,
      })
    ids.add(x.id)
  }
  const bus = new Map(net.buses.map((b) => [b.id, b]))
  if (!(net.baseMva > 0)) out.push({ level: 'error', text: 'The base power must be positive.' })
  for (const b of net.buses)
    if (!(b.kv > 0))
      out.push({
        level: 'error',
        at: b.id,
        text: `${b.name}: the nominal voltage must be positive.`,
      })
  for (const c of net.components) {
    const need = (id: string) => {
      if (!bus.has(id))
        out.push({
          level: 'error',
          at: c.id,
          text: `${c.name} is connected to a bus that does not exist (“${id}”).`,
        })
    }
    switch (c.kind) {
      case 'generator':
      case 'grid':
      case 'load':
        need(c.bus)
        break
      case 'line':
        need(c.from)
        need(c.to)
        if (bus.has(c.from) && bus.has(c.to) && bus.get(c.from)!.kv !== bus.get(c.to)!.kv)
          out.push({
            level: 'error',
            at: c.id,
            text: `${c.name} joins two different voltage levels — that needs a transformer.`,
          })
        if (!(c.lengthKm > 0))
          out.push({
            level: 'error',
            at: c.id,
            text: `${c.name}: the length must be positive.`,
          })
        if (c.rOhmPerKm < 0 || c.xOhmPerKm < 0 || c.bUsPerKm < 0)
          out.push({
            level: 'error',
            at: c.id,
            text: `${c.name}: line constants cannot be negative.`,
          })
        if (c.rOhmPerKm === 0 && c.xOhmPerKm === 0)
          out.push({
            level: 'error',
            at: c.id,
            text: `${c.name}: a line needs a non-zero impedance.`,
          })
        break
      case 'transformer':
        need(c.from)
        need(c.to)
        if (!(c.ratedMva > 0) || !(c.kvFrom > 0) || !(c.kvTo > 0))
          out.push({
            level: 'error',
            at: c.id,
            text: `${c.name}: rating and winding voltages must be positive.`,
          })
        if (!(c.zPct > 0))
          out.push({
            level: 'error',
            at: c.id,
            text: `${c.name}: the impedance must be positive.`,
          })
        break
      case 'breaker':
        if (!net.components.some((x) => x.id === c.target))
          out.push({
            level: 'error',
            at: c.id,
            text: `${c.name} switches a component that does not exist.`,
          })
        break
    }
  }
  if (!net.components.some(isSource))
    out.push({
      level: 'error',
      text: 'There is no source (generator or grid) in the network.',
    })
  const slacks = net.components.filter((c) => (c.kind === 'generator' && c.mode === 'slack') || c.kind === 'grid')
  if (slacks.length === 0)
    out.push({
      level: 'error',
      text: 'No reference source: one generator must hold voltage and angle (slack), or an external grid.',
    })
  return out
}
