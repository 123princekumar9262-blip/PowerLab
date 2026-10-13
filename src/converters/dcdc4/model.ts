import type { Element, NetlistSolution } from '../../circuits/netlist.ts'
import type { CircuitModel } from '../engine.ts'
import { periodicSchedule } from '../schedule.ts'
import { resolveBidi, resolveCoupled, type BidiParams, type CoupledKind, type CoupledParams, type ResolvedBidi, type ResolvedCoupled } from './params.ts'
import { bidiSettlePeriods, coupledIdeal, coupledSettlePeriods } from './theory.ts'

/**
 * The advanced converters as NETLISTS on the generic engine (engine.ts). Q1 is a PWM-gated switch (Ron
 * while gated, open otherwise), D1 a diode whose state the solver decides. Signal names are shared by
 * the three coupled converters:
 *
 *   ĆUK     Vin+ ─L1─ A ─C1─ B ─L2─ out      Q1: A → ground    D1: B → ground (anode B)     Vout < 0
 *   SEPIC   Vin+ ─L1─ A ─C1─ B ─D1→ out      Q1: A → ground    L2: ground → B               Vout > 0
 *   ZETA    Vin+ ─Q1─ A ─C1─ B ─L2─ out      L1: A → ground    D1: ground → B (anode gnd)   Vout > 0
 *
 * Current directions (the element's a → b): iL1 Vin → A (Ćuk, SEPIC) or A → ground (Zeta); iL2 out → B
 * (Ćuk), ground → B (SEPIC), B → out (Zeta) — chosen so that both inductor currents are POSITIVE in
 * normal operation and the diode current is iL1 + iL2 in every converter. vC1 = vA − vB (Ćuk, SEPIC),
 * vB − vA (Zeta): positive in normal operation. The output always has C (behind its ESR) and R to ground.
 */
export function coupledModel(kind: CoupledKind): CircuitModel<CoupledParams, ResolvedCoupled> {
  return {
    kind,
    resolve: (input) => resolveCoupled(input, kind),
    startupPeriods: (p) => coupledSettlePeriods(p),
    build(p) {
      const sched = periodicSchedule('Q1', p.ts, [
        { t: 0, rising: true },
        { t: p.duty * p.ts, rising: false },
      ])
      const gate = sched.at
      let n = 0
      const nIn = ++n
      const nA = ++n
      const nB = ++n
      const nOut = ++n
      const nC = p.esr > 0 ? ++n : nOut
      const els: Element[] = [{ kind: 'V', id: 'Vin', a: nIn, b: 0, value: () => p.vin }]
      const inductor = (id: 'L1' | 'L2', la: number, lb: number, l: number) => {
        if (p.rl > 0) {
          const nx = ++n
          els.push({ kind: 'L', id, a: la, b: nx, l }, { kind: 'R', id: `R${id}`, a: nx, b: lb, r: p.rl })
        } else els.push({ kind: 'L', id, a: la, b: lb, l })
      }
      // Element order fixes the storage order: [iL1, iL2, vC1, vC].
      if (kind === 'cuk') {
        inductor('L1', nIn, nA, p.l1)
        inductor('L2', nOut, nB, p.l2)
        els.push(
          { kind: 'S', id: 'Q1', a: nA, b: 0, ron: p.q.ron, gate },
          { kind: 'D', id: 'D1', a: nB, b: 0, vf: p.d.vf },
          { kind: 'C', id: 'C1', a: nA, b: nB, c: p.c1 },
        )
      } else if (kind === 'sepic') {
        inductor('L1', nIn, nA, p.l1)
        inductor('L2', 0, nB, p.l2)
        els.push(
          { kind: 'S', id: 'Q1', a: nA, b: 0, ron: p.q.ron, gate },
          { kind: 'D', id: 'D1', a: nB, b: nOut, vf: p.d.vf },
          { kind: 'C', id: 'C1', a: nA, b: nB, c: p.c1 },
        )
      } else {
        inductor('L1', nA, 0, p.l1)
        inductor('L2', nB, nOut, p.l2)
        els.push(
          { kind: 'S', id: 'Q1', a: nIn, b: nA, ron: p.q.ron, gate },
          { kind: 'D', id: 'D1', a: 0, b: nB, vf: p.d.vf },
          { kind: 'C', id: 'C1', a: nB, b: nA, c: p.c1 },
        )
      }
      els.push({ kind: 'C', id: 'C', a: nC, b: 0, c: p.c }, { kind: 'R', id: 'R', a: nOut, b: 0, r: p.r })
      if (p.esr > 0) els.push({ kind: 'R', id: 'ESR', a: nOut, b: nC, r: p.esr })
      const idx = (id: string) => els.findIndex((e) => e.id === id)
      const iV = idx('Vin')
      const iL1 = idx('L1')
      const iL2 = idx('L2')
      const iC1 = idx('C1')
      const iC = idx('C')
      const L1 = els[iL1] as Extract<Element, { kind: 'L' }>
      const L2 = els[iL2] as Extract<Element, { kind: 'L' }>
      const g = coupledIdeal(p)
      const vScale = Math.max(Math.abs(g.vout), p.vin, 1e-3)
      const iScale = Math.max(Math.abs(g.i1), Math.abs(g.i2), p.vin / p.r, 1e-3)
      return {
        net: { nodes: n, elements: els },
        diode: { kind: 'real', vf: p.d.vf, ron: p.d.ron },
        schedules: [sched],
        devices: ['Q1', 'D1'],
        dcmDiode: 'D1',
        scale: [iScale, iScale, Math.max(Math.abs(g.v1), vScale), vScale],
        initialGuess: [g.i1, g.i2, g.v1, g.vout],
        read(sol: NetlistSolution) {
          const v = sol.v
          const il1 = sol.i[iL1]
          const il2 = sol.i[iL2]
          const vout = v[nOut]
          const vc1 = sol.storage.vC[0]
          const vc = sol.storage.vC[1]
          const ic = sol.i[iC]
          const io = vout / p.r
          const q = sol.switches[0]
          const d = sol.diodes[0]
          const iin = -sol.i[iV]
          return {
            gate: q.on ? 1 : 0,
            don: d.on ? 1 : 0,
            idle: !q.on && !d.on ? 1 : 0,
            vsw: v[nA],
            vb: v[nB],
            il1,
            il2,
            vl1: v[L1.a] - v[L1.b],
            vl2: v[L2.a] - v[L2.b],
            vc1,
            ic1: sol.i[iC1],
            vout,
            vc,
            ic,
            io,
            iq: q.current,
            vq: q.voltage,
            id: d.current,
            vd: d.voltage,
            iin,
            el: 0.5 * p.l1 * il1 * il1 + 0.5 * p.l2 * il2 * il2,
            ec: 0.5 * p.c1 * vc1 * vc1 + 0.5 * p.c * vc * vc,
            pin: p.vin * iin,
            pout: vout * io,
            // instantaneous dissipation, for the loss averages (event-aware quadrature)
            pq: q.voltage * q.current,
            pd: d.voltage * d.current,
            pdcr: p.rl * (il1 * il1 + il2 * il2),
            pesr: p.esr * ic * ic,
          }
        },
      }
    },
  }
}

/**
 * BIDIRECTIONAL half-bridge. HV bus VHV (stiff source) on top; Q1 (upper) from HV+ to the switch node,
 * D1 antiparallel (anode sw, cathode HV+); Q2 (lower) from the switch node to ground, D2 antiparallel
 * (anode ground, cathode sw). L (+ DCR) from sw to the LV node; C (behind its ESR) and the battery
 * (EMF Eb behind Rb) from the LV node to ground. iL is positive from sw to the battery side.
 *
 * Gates are complementary: Q1 ON for [td, D·Ts), Q2 ON for [D·Ts + td, Ts) — the dead time td follows
 * each edge, during which only the antiparallel diodes can carry iL.
 */
export function bidiModel(): CircuitModel<BidiParams, ResolvedBidi> {
  return {
    kind: 'bidirectional',
    resolve: resolveBidi,
    startupPeriods: (p) => bidiSettlePeriods(p),
    // The LV capacitor sits across the battery: it starts charged to the battery EMF (no inrush from rest).
    initialState: (p) => [0, p.eb],
    build(p) {
      const { ts, d } = p
      const td = p.deadTime
      const s1 = periodicSchedule('Q1', ts, [
        { t: td, rising: true },
        { t: d * ts, rising: false },
      ])
      const s2 = periodicSchedule('Q2', ts, [
        { t: d * ts + td, rising: true },
        { t: ts, rising: false },
      ])
      let n = 0
      const nHV = ++n
      const nSw = ++n
      const nLV = ++n
      const nBat = ++n
      const nC = p.esr > 0 ? ++n : nLV
      const els: Element[] = [
        { kind: 'V', id: 'Vhv', a: nHV, b: 0, value: () => p.vhv },
        { kind: 'S', id: 'Q1', a: nHV, b: nSw, ron: p.q.ron, gate: s1.at },
        { kind: 'D', id: 'D1', a: nSw, b: nHV, vf: p.dio.vf },
        { kind: 'S', id: 'Q2', a: nSw, b: 0, ron: p.q.ron, gate: s2.at },
        { kind: 'D', id: 'D2', a: 0, b: nSw, vf: p.dio.vf },
      ]
      if (p.rl > 0) {
        const nx = ++n
        els.push({ kind: 'L', id: 'L', a: nSw, b: nx, l: p.l }, { kind: 'R', id: 'RL', a: nx, b: nLV, r: p.rl })
      } else els.push({ kind: 'L', id: 'L', a: nSw, b: nLV, l: p.l })
      els.push(
        { kind: 'C', id: 'C', a: nC, b: 0, c: p.c },
        { kind: 'R', id: 'Rb', a: nLV, b: nBat, r: p.rb },
        { kind: 'V', id: 'Eb', a: nBat, b: 0, value: () => p.eb },
      )
      if (p.esr > 0) els.push({ kind: 'R', id: 'ESR', a: nLV, b: nC, r: p.esr })
      const idx = (id: string) => els.findIndex((e) => e.id === id)
      const iHV = idx('Vhv')
      const iLel = idx('L')
      const iCel = idx('C')
      const iEb = idx('Eb')
      const L = els[iLel] as Extract<Element, { kind: 'L' }>
      const vlv0 = d * p.vhv
      const il0 = (vlv0 - p.eb) / p.rb
      return {
        net: { nodes: n, elements: els },
        diode: { kind: 'real', vf: p.dio.vf, ron: p.dio.ron },
        schedules: [s1, s2],
        devices: ['Q1', 'D1', 'Q2', 'D2'],
        scale: [Math.max(Math.abs(il0), Math.abs(p.irefSigned), (p.vhv * 0.25) / (p.l * p.fs), 1e-3), Math.max(p.eb, vlv0, 1e-3)],
        initialGuess: [il0, vlv0],
        read(sol: NetlistSolution) {
          const v = sol.v
          const il = sol.i[iLel]
          const vlv = v[nLV]
          const vc = sol.storage.vC[0]
          const [q1, q2] = sol.switches
          const [d1, d2] = sol.diodes
          const ihv = -sol.i[iHV] // current out of the bus's + terminal (+ = the bus supplies)
          const ib = sol.i[iEb] // current into the battery's + terminal (+ = charging)
          const ic = sol.i[iCel]
          return {
            gate1: q1.on ? 1 : 0,
            gate2: q2.on ? 1 : 0,
            dio: d1.on || d2.on ? 1 : 0,
            vsw: v[nSw],
            il,
            vl: v[L.a] - v[L.b],
            vlv: vlv,
            vc,
            ic,
            ib,
            ihv,
            iq1: q1.current,
            vq1: q1.voltage,
            iq2: q2.current,
            vq2: q2.voltage,
            id1: d1.current,
            vd1: d1.voltage,
            id2: d2.current,
            vd2: d2.voltage,
            // the upper and lower leg currents (switch + its antiparallel diode), positive INTO the switch node
            iup: q1.current - d1.current,
            ilo: d2.current - q2.current,
            el: 0.5 * p.l * il * il,
            ec: 0.5 * p.c * vc * vc,
            phv: p.vhv * ihv,
            plv: vlv * ib,
            pbat: p.eb * ib,
            prb: p.rb * ib * ib,
            psw: q1.voltage * q1.current + q2.voltage * q2.current,
            pdio: d1.voltage * d1.current + d2.voltage * d2.current,
            pdcr: p.rl * il * il,
            pesr: p.esr * ic * ic,
          }
        },
      }
    },
  }
}
