import { zBaseOhm } from '../../network/perunit.ts'
import { cx, fx } from '../../ui/format.ts'
import { CURVES, curvePoints, grade, tripTime, type CurveId, type Relay } from '../faults/relays.ts'
import { FAULT_LABEL, FAULT_TYPES } from '../faults/sequence.ts'
import { breakerDuty, faultModel, faultNetwork, RELAYS0, relayCurrents, SETUP0, tagsFor } from '../faults/study.ts'
import { faultStudy, theveninAt, type SeqModel } from '../faults/zbus.ts'
import { num, type Challenge, type State } from './types.ts'

/*
 * Challenges solved with Module 4's fault model (sequence networks of the Grid Explorer network): choosing breaker
 * ratings from fault duties, and grading overcurrent relays. Every verdict is computed with the same functions the
 * Faults & Protection module uses.
 */

let model: SeqModel | null = null
const m = () => (model ??= faultModel(SETUP0))
const SLD = { place: { G1: { side: 'left' as const }, factory: { side: 'below' as const }, town: { side: 'right' as const } }, viewBox: '-70 46 1170 290' }

// ── 1 · choose the breakers ─────────────────────────────────────────────────────────────────────────────────────

/** IEC 62271-100 preferred rated short-circuit breaking currents (R10 series) [kA]. */
const RATINGS = [6.3, 8, 10, 12.5, 16, 20, 25]
const HEADROOM = 1.25
const POINTS = [
  { id: 'mv', bus: 'mvA', label: 'CB2 / CB3 — 33 kV, grid substation' },
  { id: 'lv', bus: 'lv', label: 'CB4 — 11 kV, town feeder' },
]
const duty = (bus: string) => breakerDuty(m(), bus)
const smallestAdequate = (ka: number) => RATINGS.find((r) => r >= HEADROOM * ka - 1e-12)!

/** The bus's Thevenin sequence impedances in ohms (what the student is given to work from). */
function theveninOhms(bus: string) {
  const k = m().busIds.indexOf(bus)
  const zb = zBaseOhm(m().kv[k], m().net.baseMva)
  const z = theveninAt(m(), k)
  const o = (x: typeof z.z1) => (x ? cx(x.re * zb, x.im * zb, 2) : 'open')
  return { z1: o(z.z1), z2: o(z.z2), z0: o(z.z0), kv: m().kv[k] }
}

export const BREAKER_CHALLENGE: Challenge = {
  id: 'breakers',
  title: 'Choose the circuit breakers',
  line: 'From the Thevenin sequence impedances to a standard breaking rating',
  brief: [
    'New switchgear is being ordered for the grid substation’s 33 kV bus (CB2, CB3) and the town’s 11 kV bus (CB4). A breaker must interrupt the largest fault current it can see, of any fault type, at its bus.',
    `Company policy: the rated breaking current must be at least ${fx(HEADROOM * 100, 0)} % of the calculated duty (room for network growth) — and, to control cost, the smallest standard rating that meets this.`,
    'The protection engineer has given you the Thevenin sequence impedances seen from each bus (pre-fault voltage 1.0 pu). Choose a rating for each.',
  ],
  uses: ['faults', 'per-unit'],
  level: 'Advanced',
  controls: POINTS.map((p) => ({ kind: 'choice' as const, id: p.id, label: p.label, options: RATINGS.map((r) => ({ id: String(r), label: `${r} kA` })) })),
  initial: { mv: '25', lv: '25' },
  solution: { mv: '6.3', lv: '8' },
  evaluate(s) {
    const objectives = POINTS.flatMap((p) => {
      const d = duty(p.bus)
      const r = Number(s[p.id])
      const need = HEADROOM * d.ka
      const best = smallestAdequate(d.ka)
      return [
        { id: `${p.id}-ok`, label: `${p.label.split(' — ')[0]}: rating ≥ ${fx(HEADROOM * 100, 0)} % of its duty`, ok: r >= need - 1e-12, detail: `${r} kA vs ${fx(need, 2)} kA needed` },
        { id: `${p.id}-min`, label: `${p.label.split(' — ')[0]}: the smallest standard rating that does`, ok: r === best, detail: r === best ? `${r} kA` : `${r} kA chosen` },
      ]
    })
    return {
      objectives,
      measurements: POINTS.flatMap((p) => {
        const z = theveninOhms(p.bus)
        return [
          { label: `${z.kv} kV bus · Z₁ = Z₂`, value: z.z1, unit: 'Ω' },
          { label: `${z.kv} kV bus · Z₀`, value: z.z0, unit: z.z0.startsWith('open') ? undefined : 'Ω', note: z.z0.startsWith('open') ? 'delta / unearthed: no zero-sequence path' : undefined },
        ]
      }),
      diagram: { net: faultNetwork(SETUP0), sol: null, ...SLD, tags: tagsFor(SETUP0), highlight: ['CB2', 'CB3', 'CB4', 'mvA', 'lv'] },
    }
  },
  hints: [
    'Work in ohms or per unit, but per phase: a three-phase fault draws I = (V_LL/√3) / |Z₁|.',
    'Check every fault type. A line-to-ground fault draws 3·V/|Z₁ + Z₂ + Z₀| — larger than the three-phase fault wherever Z₀ is smaller than Z₁.',
    'At 11 kV the town transformer’s earthed star makes Z₀ small. At 33 kV there is no zero-sequence path at all, so an earth fault draws no current there.',
  ],
  debrief() {
    return POINTS.map((p) => {
      const d = duty(p.bus)
      const all = FAULT_TYPES.map((t) => `${FAULT_LABEL[t].toLowerCase()} ${fx(faultStudy(m(), p.bus, t).faultKa, 2)} kA`).join(', ')
      return `${p.label}: ${all}. The duty is the ${FAULT_LABEL[d.type].toLowerCase()} fault, ${fx(d.ka, 2)} kA → ${fx(HEADROOM * d.ka, 2)} kA with headroom → ${smallestAdequate(d.ka)} kA.`
    }).concat('Sizing on the three-phase fault alone is a classic mistake: near an earthed-star winding, the line-to-ground fault is the largest.')
  },
}

// ── 2 · grade the relays ────────────────────────────────────────────────────────────────────────────────────────

const L2_LIMIT = 0.5
const up = (s: State): Relay => ({ ...RELAYS0.up, curve: s.curve as CurveId, tms: num(s, 'tms') })

export const GRADING_CHALLENGE: Challenge = {
  id: 'grading',
  title: 'Grade the overcurrent relays',
  line: 'Selective and fast: set the 33 kV relay against the town’s relay',
  brief: [
    `Relay R1 protects the town feeder at 11 kV (CB4): ${CURVES[RELAYS0.down.curve].name.toLowerCase()} curve, pick-up ${RELAYS0.down.isA} A, TMS ${RELAYS0.down.tms}. Relay R2 on the 33 kV line L2 (CB2, pick-up ${RELAYS0.up.isA} A) is its back-up.`,
    'Set R2 so that for every type of fault on the town feeder R1 trips first, with a grading margin of at least 0.3 s — and so that R2 still clears a three-phase fault at the far end of its own line within 0.5 s.',
  ],
  uses: ['faults'],
  level: 'Advanced',
  controls: [
    { kind: 'choice', id: 'curve', label: 'R2 curve', options: (Object.keys(CURVES) as CurveId[]).map((c) => ({ id: c, label: CURVES[c].name })) },
    { kind: 'slider', id: 'tms', label: 'R2 time-multiplier setting (TMS)', min: 0.05, max: 0.5, step: 0.01, unit: '', decimals: 2 },
  ],
  initial: { curve: 'SI', tms: 0.1 },
  solution: { curve: 'EI', tms: 0.13 },
  evaluate(s) {
    const r2 = up(s)
    const per = FAULT_TYPES.map((t) => {
      const c = relayCurrents(m(), 'feeder', t)
      return { t, g: grade(RELAYS0.down, r2, c.downA, c.upA), c }
    })
    const worst = per.filter((x) => Number.isFinite(x.g.tDown)).reduce((a, b) => (b.g.margin < a.g.margin ? b : a))
    const far = faultStudy(m(), 'mvB', '3ph').branches.find((b) => b.id === 'L2')!
    const tFar = tripTime(r2.curve, r2.tms, r2.isA, far.kaFrom * 1000)
    const c3 = per.find((x) => x.t === '3ph')!.c
    return {
      objectives: [
        {
          id: 'graded',
          label: 'R1 trips first, ≥ 0.3 s ahead of R2, for every fault type on the town feeder',
          ok: per.every((x) => !Number.isFinite(x.g.tDown) || x.g.ok),
          detail: `smallest margin ${fx(worst.g.margin, 3)} s (${FAULT_LABEL[worst.t].toLowerCase()})`,
        },
        {
          id: 'fast',
          label: `R2 clears a three-phase fault at the end of L2 within ${L2_LIMIT} s`,
          ok: tFar <= L2_LIMIT,
          detail: Number.isFinite(tFar) ? `${fx(tFar, 3)} s at ${fx(far.kaFrom * 1000, 0)} A` : 'does not operate',
        },
      ],
      measurements: [
        { label: 'R1 time, feeder fault', value: fx(per.find((x) => x.t === '3ph')!.g.tDown, 3), unit: 's', note: `at ${fx(c3.downA, 0)} A (three-phase)` },
        { label: 'R2 time, same fault', value: fx(per.find((x) => x.t === '3ph')!.g.tUp, 3), unit: 's', note: `at ${fx(c3.upA, 0)} A on 33 kV` },
        { label: 'R2 time, end of L2', value: Number.isFinite(tFar) ? fx(tFar, 3) : '—', unit: 's', tone: tFar > L2_LIMIT ? 'warn' : undefined },
      ],
      plot: {
        label: 'Time–current curves referred to 11 kV',
        xLabel: 'Fault current, referred to 11 kV [kA]',
        yLabel: 'Operating time [s]',
        xDomain: [0, 8],
        yDomain: [0, 2.5],
        series: [
          { id: 'r1', label: 'R1', color: 'var(--ps-c)', points: curvePoints(RELAYS0.down, 1, 200).map(([i, t]) => [i / 1000, Math.min(t, 10)] as [number, number]) },
          { id: 'r2', label: 'R2', color: 'var(--ps-b)', points: curvePoints(r2, 33 / 11, 200).map(([i, t]) => [i / 1000, Math.min(t, 10)] as [number, number]) },
        ],
        vlines: [{ x: c3.downA / 1000, label: `town feeder fault ${fx(c3.downA / 1000, 2)} kA` }],
      },
    }
  },
  hints: [
    'Compute R1’s time for the largest feeder fault, add 0.3 s: that is the least R2 may take at the current it sees for the same fault.',
    'Raising R2’s TMS buys grading margin but slows R2 for faults on its own line. A steeper curve separates the two relays more at high current and less at low current.',
    'Try the extremely inverse curve: at the high current of a fault at the end of L2 it is fast, yet at the lower current it sees for a town fault it is slow.',
  ],
  debrief(s) {
    const r2 = up(s)
    return [
      `${CURVES[r2.curve].name} at TMS ${fx(r2.tms, 2)}: R2 waits for R1 on every town fault and still clears its own line quickly. A standard inverse curve cannot do both here — set slow enough to grade, it is too slow at the end of L2.`,
      'Grading is a compromise between selectivity (only the nearest breaker trips) and speed (faults cleared before damage or instability). Curve shape is the tool that resolves it.',
    ]
  },
}

export const FAULT_CHALLENGES = [BREAKER_CHALLENGE, GRADING_CHALLENGE]
