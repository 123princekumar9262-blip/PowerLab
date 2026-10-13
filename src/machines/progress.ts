/**
 * What the 3D Machines Lab remembers in this browser: the machines opened recently, and the knowledge-check
 * questions answered right. Its own keys (the circuit labs' progress is untouched); "Reset progress" clears them.
 */
const RECENT = 'pel.machines.recent'
const CHECKS = 'pel.machines.checks'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* storage blocked: nothing is remembered */
  }
}

export function recentMachines(): string[] {
  const v = read<unknown>(RECENT, [])
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
export function noteOpened(id: string) {
  write(RECENT, [id, ...recentMachines().filter((x) => x !== id)].slice(0, 6))
}
export function solvedChecks(machine: string): string[] {
  const v = read<Record<string, unknown>>(CHECKS, {})
  const list = v && typeof v === 'object' ? v[machine] : undefined
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
}
export function noteSolved(machine: string, question: string) {
  const v = read<Record<string, string[]>>(CHECKS, {})
  const list = new Set(Array.isArray(v[machine]) ? v[machine] : [])
  list.add(question)
  write(CHECKS, { ...v, [machine]: [...list] })
}
export const MACHINE_PROGRESS_KEYS = [RECENT, CHECKS]
