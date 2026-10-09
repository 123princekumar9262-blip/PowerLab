/*
 * "Change circuit" keeps the student's values. Each lab remembers its last parameters for the session; when
 * a circuit opens, the lab's own rule keeps every value the new circuit uses, lists the ones it does not use
 * (kept for later, never silently dropped), and lets the address's explicit values (entry points) win.
 */
const last = new Map<string, unknown>()

export function rememberParams(lab: string, params: unknown): void {
  last.set(lab, params)
}
export function lastParams<T>(lab: string): T | undefined {
  return last.get(lab) as T | undefined
}
/** For tests: forget everything. */
export function clearRememberedParams(): void {
  last.clear()
}

/** What the notice says: values kept from the previous circuit, and values this circuit does not use. */
export interface CarryReport {
  kept: string[]
  notUsed: string[]
}
export const carryIsEmpty = (r: CarryReport | null | undefined) => !r || (r.kept.length === 0 && r.notUsed.length === 0)
