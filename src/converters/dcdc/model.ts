import type { Element, NetlistSolution } from '../../circuits/netlist.ts'
import type { CircuitModel } from '../engine.ts'
import { resolveConverter } from '../params.ts'
import { periodicSchedule } from '../schedule.ts'
import type { ConverterKind, ConverterParams, ResolvedConverter } from '../types.ts'

/**
 * The three basic DC-DC converters as netlists. Q1 is a PWM-gated switch (Ron while gated, open
 * otherwise), D1 the diode whose state the solver decides. Same signal names for all three:
 *
 *   BUCK         Vin+ ─Q1─ sw ─L─ out          D1: ground → sw       (step-down)
 *   BOOST        Vin+ ─L─ sw ─D1→ out          Q1: sw → ground       (step-up)
 *   BUCK-BOOST   Vin+ ─Q1─ sw ─L─ ground       D1: out → sw          (inverting: Vout < 0)
 *
 * The output always has C (behind its ESR) and R to ground. vsw is the node where Q1, L and D1 meet.
 */
export function dcdcModel(kind: ConverterKind): CircuitModel<ConverterParams, ResolvedConverter> {
  return {
    kind,
    resolve: (input) => resolveConverter(input, kind),
    startupPeriods: (p) => startupPeriods(kind, p),
    build(p) {
      const sched = periodicSchedule('Q1', p.ts, [
        { t: 0, rising: true },
        { t: p.duty * p.ts, rising: false },
      ])
      const gate = sched.at
      let n = 0
      const nIn = ++n
      const nSw = ++n
      const nOut = ++n
      const nC = p.esr > 0 ? ++n : nOut
      const els: Element[] = [{ kind: 'V', id: 'Vin', a: nIn, b: 0, value: () => p.vin }]
      // Inductor with its DCR in series: L from `la` to an internal node, DCR to `lb`.
      const inductor = (la: number, lb: number) => {
        if (p.rl > 0) {
          const nx = ++n
          els.push({ kind: 'L', id: 'L', a: la, b: nx, l: p.l }, { kind: 'R', id: 'RL', a: nx, b: lb, r: p.rl })
        } else els.push({ kind: 'L', id: 'L', a: la, b: lb, l: p.l })
      }
      if (kind === 'buck') {
        els.push({ kind: 'S', id: 'Q1', a: nIn, b: nSw, ron: p.q.ron, gate }, { kind: 'D', id: 'D1', a: 0, b: nSw, vf: p.d.vf })
        inductor(nSw, nOut)
      } else if (kind === 'boost') {
        inductor(nIn, nSw)
        els.push({ kind: 'S', id: 'Q1', a: nSw, b: 0, ron: p.q.ron, gate }, { kind: 'D', id: 'D1', a: nSw, b: nOut, vf: p.d.vf })
      } else {
        els.push({ kind: 'S', id: 'Q1', a: nIn, b: nSw, ron: p.q.ron, gate }, { kind: 'D', id: 'D1', a: nOut, b: nSw, vf: p.d.vf })
        inductor(nSw, 0)
      }
      els.push({ kind: 'C', id: 'C', a: nC, b: 0, c: p.c }, { kind: 'R', id: 'R', a: nOut, b: 0, r: p.r })
      if (p.esr > 0) els.push({ kind: 'R', id: 'ESR', a: nOut, b: nC, r: p.esr })
      const iV = els.findIndex((e) => e.id === 'Vin')
      const iLel = els.findIndex((e) => e.id === 'L')
      const iCel = els.findIndex((e) => e.id === 'C')
      const L = els[iLel] as Extract<Element, { kind: 'L' }>
      const g = guess(kind, p)
      return {
        net: { nodes: n, elements: els },
        diode: { kind: 'real', vf: p.d.vf, ron: p.d.ron },
        schedules: [sched],
        devices: ['Q1', 'D1'],
        dcmDiode: 'D1',
        scale: [Math.max(Math.abs(g.il), p.vin / p.r, 1e-3), Math.max(Math.abs(g.vout), p.vin, 1e-3)],
        initialGuess: [g.il, g.vout],
        read(sol: NetlistSolution) {
          const v = sol.v
          const il = sol.i[iLel]
          const vout = v[nOut]
          const vc = sol.storage.vC[0]
          const io = vout / p.r
          const q = sol.switches[0]
          const d = sol.diodes[0]
          const iin = -sol.i[iV] // the source's element current flows + → − inside it
          return {
            gate: q.on ? 1 : 0,
            vsw: v[nSw],
            il,
            vl: v[L.a] - v[L.b],
            vout,
            vc,
            ic: sol.i[iCel],
            io,
            iq: q.current,
            vq: q.voltage,
            id: d.current,
            vd: d.voltage,
            iin,
            el: 0.5 * p.l * il * il,
            ec: 0.5 * p.c * vc * vc,
            pin: p.vin * iin,
            pout: vout * io,
          }
        },
      }
    },
  }
}

/** Ideal averaged operating point (CCM) — only a starting guess for the steady-state search. */
export function guess(kind: ConverterKind, p: Pick<ResolvedConverter, 'vin' | 'duty' | 'r'>): { vout: number; il: number } {
  const D = p.duty
  if (kind === 'buck') return { vout: D * p.vin, il: (D * p.vin) / p.r }
  if (kind === 'boost') {
    const vout = p.vin / (1 - D)
    return { vout, il: vout / (p.r * (1 - D)) }
  }
  const vout = (-D / (1 - D)) * p.vin
  return { vout, il: -vout / (p.r * (1 - D)) }
}

/**
 * Periods simulated in the start-up view: about five time constants of the slowest mode of the
 * averaged model  x' = A·x  (A = [[−DCR/L, −a/L], [a/C, −1/(R·C)]], a = 1 for the buck, 1 − D for the
 * boost and the buck-boost).
 */
export function startupPeriods(kind: ConverterKind, p: ResolvedConverter): number {
  const a = kind === 'buck' ? 1 : 1 - p.duty
  const A11 = -p.rl / p.l
  const A12 = -a / p.l
  const A21 = a / p.c
  const A22 = -1 / (p.r * p.c)
  const tr = A11 + A22
  const det = A11 * A22 - A12 * A21
  const disc = tr * tr - 4 * det
  const slow = disc >= 0 ? Math.abs((tr + Math.sqrt(disc)) / 2) : Math.abs(tr / 2)
  const tau = 1 / Math.max(slow, 1e-12)
  return Math.max(20, Math.min(600, Math.ceil((5 * tau) / p.ts)))
}
