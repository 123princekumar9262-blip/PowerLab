import { affineFlow, type Mat } from '../expm.ts'
import type { BuckInterval, ConverterKind, ResolvedConverter } from '../types.ts'

/**
 * DC-DC converter THEORY — independent of the simulator (no time stepping, no netlist).
 *
 * 1. EXACT piecewise-linear solution of the same circuit equations, solved analytically per interval
 *    with the matrix exponential; the periodic steady state is the fixed point of the period map
 *    (CCM: a 2×2 linear solve; DCM: the diode-off instant and the start voltage by root finding).
 *    State x = [iL, vC]; i_feed = current the converter pushes into the output node;
 *    vout = k·(vC + ESR·i_feed), k = R/(R + ESR);  C·dvC/dt = (R·i_feed − vC)/(R + ESR).
 *
 *    BUCK        ON:  L·diL/dt = Vin − (RonQ + DCR)·iL − vout          i_feed = iL
 *                OFF: L·diL/dt = −Vf − (RonD + DCR)·iL − vout          i_feed = iL
 *    BOOST       ON:  L·diL/dt = Vin − (RonQ + DCR)·iL                 i_feed = 0
 *                OFF: L·diL/dt = Vin − Vf − (RonD + DCR)·iL − vout     i_feed = iL
 *    BUCK-BOOST  ON:  L·diL/dt = Vin − (RonQ + DCR)·iL                 i_feed = 0
 *                OFF: L·diL/dt = vout − Vf − (RonD + DCR)·iL           i_feed = −iL
 *    IDLE (DCM, all three): iL = 0, i_feed = 0.
 *
 * 2. TEXTBOOK relations (ideal devices, lossless L and C, small ripple) with their assumptions,
 *    shown only where those assumptions hold.
 */

export interface DcdcExact {
  mode: 'CCM' | 'DCM'
  tOn: number
  tOff: number
  tIdle: number
  /** State at the start of the period (rising gate edge): [iL, vC]. */
  x0: number[]
  at(t: number): { iL: number; vC: number; vout: number; interval: BuckInterval }
  metrics: DcdcMetrics
}

export interface DcdcMetrics {
  voutAvg: number
  voutMax: number
  voutMin: number
  ilAvg: number
  ilMax: number
  ilMin: number
  ioAvg: number
  pinAvg: number
  poutAvg: number
  efficiency: number
  d2: number
  d3: number
}

interface Sys {
  A: Mat
  b: number[]
  /** i_feed = f·iL in this interval. */
  feed: number
}

function systems(p: ResolvedConverter): { k: number; on: Sys; off: Sys; idle: Sys } {
  const k = p.r / (p.r + p.esr)
  const kind = p.kind ?? 'buck'
  const cDen = p.c * (p.r + p.esr)
  // diL/dt row and dvC/dt row for i_feed = f·iL, with vout = k·(vC + ESR·f·iL).
  const sys = (vSrc: number, rSeries: number, voutCoef: number, f: number): Sys => ({
    // L·diL/dt = vSrc − rSeries·iL + voutCoef·vout
    A: [
      [(-rSeries + voutCoef * k * p.esr * f) / p.l, (voutCoef * k) / p.l],
      [(p.r * f) / cDen, -1 / cDen],
    ],
    b: [vSrc / p.l, 0],
    feed: f,
  })
  const rq = p.q.ron + p.rl
  const rd = p.d.ron + p.rl
  let on: Sys
  let off: Sys
  if (kind === 'buck') {
    on = sys(p.vin, rq, -1, 1)
    off = sys(-p.d.vf, rd, -1, 1)
  } else if (kind === 'boost') {
    on = sys(p.vin, rq, 0, 0)
    off = sys(p.vin - p.d.vf, rd, -1, 1)
  } else {
    on = sys(p.vin, rq, 0, 0)
    off = sys(-p.d.vf, rd, 1, -1)
  }
  const idle: Sys = { A: [[0, 0], [0, -1 / cDen]], b: [0, 0], feed: 0 }
  return { k, on, off, idle }
}

/** Exact periodic steady state of the converter with the given parameters. */
export function dcdcExact(p: ResolvedConverter): DcdcExact {
  const { k, on, off, idle } = systems(p)
  const Ts = p.ts
  const tOn = p.duty * Ts
  const flowOn = affineFlow(on.A, on.b, tOn)
  const flowOffFull = affineFlow(off.A, off.b, Ts - tOn)
  const offAt = (x1: number[], t: number) => affineFlow(off.A, off.b, t)(x1)
  const idleAt = (v: number, t: number) => affineFlow(idle.A, idle.b, t)([0, v])
  // The DCM search below evaluates the same flows over and over (the scan grid and the bisection midpoints
  // recur on every outer iteration: ~75 % of its matrix exponentials). Reuse each flow for an identical
  // step length — the very same function of the very same input, so every result is bit-identical. The
  // cache lives only for this call; at() below keeps the uncached flows.
  const memo = (A: number[][], b: number[]) => {
    const flows = new Map<number, (x: number[]) => number[]>()
    return (t: number) => {
      let f = flows.get(t)
      if (!f) {
        f = affineFlow(A, b, t)
        flows.set(t, f)
      }
      return f
    }
  }
  const offFlow = memo(off.A, off.b)
  const idleFlow = memo(idle.A, idle.b)
  const offAtCached = (x1: number[], t: number) => offFlow(t)(x1)
  const idleAtCached = (v: number, t: number) => idleFlow(t)([0, v])

  // CCM: x0 = Φoff(Φon(x0)) — affine: solve (I − M)·x0 = c.
  const map = (x: number[]) => flowOffFull(flowOn(x))
  const c0 = map([0, 0])
  const e1 = map([1, 0]).map((v, i) => v - c0[i])
  const e2 = map([0, 1]).map((v, i) => v - c0[i])
  const a11 = 1 - e1[0]
  const a12 = -e2[0]
  const a21 = -e1[1]
  const a22 = 1 - e2[1]
  const det = a11 * a22 - a12 * a21
  let x0 = [(c0[0] * a22 - a12 * c0[1]) / det, (a11 * c0[1] - a21 * c0[0]) / det]

  // iL falls monotonically while the diode conducts, so its minimum over OFF is at the end (= x0[0]).
  // If that is not positive, the diode would have turned off: DCM.
  let mode: 'CCM' | 'DCM' = 'CCM'
  let tOff = Ts - tOn
  let tIdle = 0
  if (!(x0[0] > 0)) {
    mode = 'DCM'
    const span = Ts - tOn
    const diodeOff = (x1: number[]) => {
      let lo = 0
      let hi = span
      const N = 64
      for (let j = 1; j <= N; j++) {
        const t = (span * j) / N
        if (offAtCached(x1, t)[0] <= 0) {
          hi = t
          lo = (span * (j - 1)) / N
          break
        }
      }
      for (let it = 0; it < 80; it++) {
        const mid = (lo + hi) / 2
        if (offAtCached(x1, mid)[0] > 0) lo = mid
        else hi = mid
      }
      return hi
    }
    const cycle = (v0: number) => {
      const x1 = flowOn([0, v0])
      const t2 = Math.min(diodeOff(x1), span)
      const x2 = offAtCached(x1, t2)
      return { t2, vEnd: idleAtCached(x2[1], span - t2)[1] }
    }
    // g(v0) = vC(Ts) − v0 changes sign at the periodic start voltage: bracket around the ideal DCM
    // estimate (expanding as needed), then bisect.
    const est = dcmEstimate(p)
    const g = (v: number) => cycle(v).vEnd - v
    let lo = est * 0.5
    let hi = est * 1.5 + (est === 0 ? Math.sign(guessSign(p)) : 0)
    for (let it = 0; it < 40 && Math.sign(g(lo)) === Math.sign(g(hi)); it++) {
      lo *= 0.5
      hi *= 2
    }
    let glo = g(lo)
    for (let it = 0; it < 100; it++) {
      const mid = (lo + hi) / 2
      const gm = g(mid)
      if (Math.sign(gm) === Math.sign(glo)) {
        lo = mid
        glo = gm
      } else hi = mid
    }
    const v0 = (lo + hi) / 2
    tOff = cycle(v0).t2
    tIdle = Ts - tOn - tOff
    x0 = [0, v0]
  }

  const x1 = flowOn(x0)
  const x2 = mode === 'CCM' ? flowOffFull(x1) : offAt(x1, tOff)
  const voutOf = (sys: Sys, x: number[]) => k * (x[1] + p.esr * sys.feed * x[0])
  const at = (t: number) => {
    const u = ((t % Ts) + Ts) % Ts
    if (u < tOn) {
      const x = affineFlow(on.A, on.b, u)(x0)
      return { iL: x[0], vC: x[1], vout: voutOf(on, x), interval: 'on' as const }
    }
    if (u < tOn + tOff) {
      const x = offAt(x1, u - tOn)
      return { iL: x[0], vC: x[1], vout: voutOf(off, x), interval: 'off' as const }
    }
    const x = idleAt(x2[1], u - tOn - tOff)
    return { iL: 0, vC: x[1], vout: k * x[1], interval: 'idle' as const }
  }

  // Cycle metrics: the exact solution stepped with one small-step exponential per interval (midpoint rule).
  const N = 4000
  let sv = 0
  let si = 0
  let spin = 0
  let spout = 0
  const segs: Array<[number, number, 'on' | 'off' | 'idle']> = [
    [0, tOn, 'on'],
    [tOn, tOn + tOff, 'off'],
    [tOn + tOff, Ts, 'idle'],
  ]
  const kind = p.kind ?? 'buck'
  for (const [a, b, name] of segs) {
    if (b - a <= 0) continue
    const h = (b - a) / N
    const sys = name === 'on' ? on : name === 'off' ? off : idle
    const half = affineFlow(sys.A, sys.b, h / 2)
    const full = affineFlow(sys.A, sys.b, h)
    let x = name === 'on' ? x0 : name === 'off' ? x1 : [0, x2[1]]
    for (let j = 0; j < N; j++) {
      const xm = half(x)
      const iL = name === 'idle' ? 0 : xm[0]
      const vo = name === 'idle' ? k * xm[1] : voutOf(sys, xm)
      sv += vo * h
      si += iL * h
      // Source current: iL while Q1 conducts (buck, buck-boost); always iL for the boost.
      if (name === 'on' || (kind === 'boost' && name === 'off')) spin += p.vin * iL * h
      spout += ((vo * vo) / p.r) * h
      x = full(x)
    }
  }
  let vmax = -Infinity
  let vmin = Infinity
  let imax = -Infinity
  let imin = Infinity
  for (let j = 0; j <= 2000; j++) {
    const s = at((Ts * j) / 2000)
    vmax = Math.max(vmax, s.vout)
    vmin = Math.min(vmin, s.vout)
    imax = Math.max(imax, s.iL)
    imin = Math.min(imin, s.iL)
  }
  imax = Math.max(imax, x1[0])
  imin = Math.min(imin, mode === 'CCM' ? x0[0] : 0)
  return {
    mode,
    tOn,
    tOff,
    tIdle,
    x0,
    at,
    metrics: {
      voutAvg: sv / Ts,
      voutMax: vmax,
      voutMin: vmin,
      ilAvg: si / Ts,
      ilMax: imax,
      ilMin: imin,
      ioAvg: sv / Ts / p.r,
      pinAvg: spin / Ts,
      poutAvg: spout / Ts,
      efficiency: spin > 0 ? spout / spin : NaN,
      d2: tOff / Ts,
      d3: tIdle / Ts,
    },
  }
}

const guessSign = (p: ResolvedConverter) => ((p.kind ?? 'buck') === 'buck-boost' ? -1 : 1)

/** Ideal DCM output voltage (textbook), used to bracket the exact DCM search. */
function dcmEstimate(p: ResolvedConverter): number {
  const b = dcdcBoundary(p)
  return idealDcmM(p.kind ?? 'buck', p.duty, b.K) * p.vin
}

/** Ideal conversion ratio Vout/Vin in DCM. */
export function idealDcmM(kind: ConverterKind, D: number, K: number): number {
  if (kind === 'buck') return 2 / (1 + Math.sqrt(1 + (4 * K) / (D * D)))
  if (kind === 'boost') return (1 + Math.sqrt(1 + (4 * D * D) / K)) / 2
  return -D / Math.sqrt(K)
}
/** Ideal conversion ratio Vout/Vin in CCM. */
export function idealCcmM(kind: ConverterKind, D: number): number {
  if (kind === 'buck') return D
  if (kind === 'boost') return 1 / (1 - D)
  return -D / (1 - D)
}

/** CCM/DCM boundary, dimensionless: CCM ⇔ K = 2L/(R·Ts) > Kcrit(D). */
export function dcdcBoundary(p: Pick<ResolvedConverter, 'l' | 'r' | 'ts' | 'duty' | 'fs'> & { kind?: ConverterKind }) {
  const kind = p.kind ?? 'buck'
  const D = p.duty
  const K = (2 * p.l) / (p.r * p.ts)
  const Kcrit = kind === 'buck' ? 1 - D : kind === 'boost' ? D * (1 - D) ** 2 : (1 - D) ** 2
  return {
    K,
    Kcrit,
    lCrit: (Kcrit * p.r) / (2 * p.fs),
    rCrit: (2 * p.l * p.fs) / Kcrit,
    ccm: K > Kcrit,
    /** The relation shown to students. */
    lCritFormula: kind === 'buck' ? 'Lcrit = (1 − D)·R/(2·fs)' : kind === 'boost' ? 'Lcrit = D·(1 − D)²·R/(2·fs)' : 'Lcrit = (1 − D)²·R/(2·fs)',
  }
}

export interface TextbookValue {
  key: string
  value: number | null
  formula: string
  assumptions: string[]
  notApplicable?: string
}

export function dcdcTextbook(p: ResolvedConverter): Record<string, TextbookValue> {
  const kind = p.kind ?? 'buck'
  const b = dcdcBoundary(p)
  const D = p.duty
  const ideal = p.devices === 'ideal' && p.rl === 0
  const base = ['ideal switch and diode (no drops)', 'lossless inductor and capacitor', 'periodic steady state']
  const nonIdeal = ideal ? undefined : 'Non-ideal devices or DCR: the ideal relation is only an approximation here (see the exact theory).'
  const out: Record<string, TextbookValue> = {}
  const vinDT = (p.vin * D) / (p.l * p.fs)
  if (b.ccm) {
    const M = idealCcmM(kind, D)
    const vout = M * p.vin
    const io = vout / p.r
    const vForm = kind === 'buck' ? 'Vout = D·Vin' : kind === 'boost' ? 'Vout = Vin/(1 − D)' : 'Vout = −D·Vin/(1 − D)'
    out.voutAvg = { key: 'voutAvg', value: vout, formula: vForm, assumptions: [...base, 'continuous conduction (CCM)'], notApplicable: nonIdeal }
    const il = kind === 'buck' ? io : Math.abs(io) / (1 - D)
    out.ilAvg = {
      key: 'ilAvg',
      value: il,
      formula: kind === 'buck' ? 'IL = Iout = Vout/R' : 'IL = |Iout|/(1 − D) (the diode passes iL only for (1 − D)·Ts)',
      assumptions: [...base, 'CCM; the capacitor carries no average current'],
      notApplicable: kind === 'buck' ? undefined : nonIdeal,
    }
    const di = kind === 'buck' ? (vout * (1 - D)) / (p.l * p.fs) : vinDT
    out.ilPP = {
      key: 'ilPP',
      value: di,
      formula: kind === 'buck' ? 'ΔiL = (Vin − Vout)·D/(L·fs) = Vout·(1 − D)/(L·fs)' : 'ΔiL = Vin·D/(L·fs) (vL = Vin while Q1 is ON)',
      assumptions: [...base, 'CCM', 'Vout constant over a period (small ripple)'],
      notApplicable: nonIdeal,
    }
    out.ilMax = { key: 'ilMax', value: il + di / 2, formula: 'IL,max = IL + ΔiL/2', assumptions: [...base, 'CCM'], notApplicable: nonIdeal }
    out.ilMin = { key: 'ilMin', value: il - di / 2, formula: 'IL,min = IL − ΔiL/2', assumptions: [...base, 'CCM'], notApplicable: nonIdeal }
    out.voutPP =
      kind === 'buck'
        ? {
            key: 'voutPP',
            value: di / (8 * p.c * p.fs),
            formula: 'ΔVout = ΔiL/(8·C·fs)',
            assumptions: [...base, 'CCM', 'all ripple current flows into C', 'no capacitor ESR'],
            notApplicable: p.esr > 0 ? 'ESR > 0 adds ΔiL·ESR to the ripple; the capacitive-only formula does not apply.' : nonIdeal,
          }
        : {
            key: 'voutPP',
            value: (Math.abs(io) * D) / (p.c * p.fs),
            formula: 'ΔVout = |Iout|·D/(C·fs) (C alone feeds the load while Q1 is ON)',
            assumptions: [...base, 'CCM', 'load current constant (small ripple)', 'iL ≥ Iout throughout OFF (C charges only then)', 'no capacitor ESR'],
            notApplicable:
              p.esr > 0
                ? 'ESR > 0 adds a step of iL·ESR when the diode turns on; the capacitive-only formula does not apply.'
                : il - di / 2 < Math.abs(io)
                  ? 'iL falls below the load current during OFF, so C also discharges then: the D·Ts formula underestimates the ripple here.'
                  : nonIdeal,
          }
    out.d2 = { key: 'd2', value: 1 - D, formula: 'D2 = 1 − D (diode conducts for the rest of the period)', assumptions: ['CCM'] }
  } else {
    const M = idealDcmM(kind, D, b.K)
    const vout = M * p.vin
    const vForm =
      kind === 'buck' ? 'Vout/Vin = 2 / (1 + √(1 + 4K/D²)),  K = 2L/(R·Ts)' : kind === 'boost' ? 'Vout/Vin = (1 + √(1 + 4D²/K)) / 2,  K = 2L/(R·Ts)' : 'Vout/Vin = −D/√K,  K = 2L/(R·Ts)'
    out.voutAvg = { key: 'voutAvg', value: vout, formula: vForm, assumptions: [...base, 'discontinuous conduction (DCM)', 'small output ripple'], notApplicable: nonIdeal }
    const peak = kind === 'buck' ? ((p.vin - vout) * D) / (p.l * p.fs) : vinDT
    out.ilMax = { key: 'ilMax', value: peak, formula: kind === 'buck' ? 'IL,peak = (Vin − Vout)·D/(L·fs)' : 'IL,peak = Vin·D/(L·fs)', assumptions: [...base, 'DCM: iL starts each period at 0'], notApplicable: nonIdeal }
    out.ilMin = { key: 'ilMin', value: 0, formula: 'IL,min = 0 (DCM)', assumptions: ['DCM'] }
    out.ilPP = { ...out.ilMax, key: 'ilPP', formula: 'ΔiL = IL,peak − 0 (DCM)' }
    const d2 = kind === 'buck' ? (D * (1 - M)) / M : kind === 'boost' ? D / (M - 1) : Math.sqrt(b.K)
    out.d2 = {
      key: 'd2',
      value: d2,
      formula: kind === 'buck' ? 'D2 = D·(Vin − Vout)/Vout (volt-second balance)' : kind === 'boost' ? 'D2 = D·Vin/(Vout − Vin) (volt-second balance)' : 'D2 = D·Vin/|Vout| = √K (volt-second balance)',
      assumptions: [...base, 'DCM'],
      notApplicable: nonIdeal,
    }
    out.d3 = { key: 'd3', value: 1 - D - d2, formula: 'D3 = 1 − D − D2', assumptions: out.d2.assumptions, notApplicable: nonIdeal }
    out.ilAvg = { key: 'ilAvg', value: (peak * (D + d2)) / 2, formula: 'IL = ½·IL,peak·(D + D2) (triangle area)', assumptions: [...base, 'DCM'], notApplicable: nonIdeal }
    out.voutPP = { key: 'voutPP', value: null, formula: '—', assumptions: [], notApplicable: 'No simple closed form for the ripple in DCM: compare with the exact solution.' }
  }
  const v = out.voutAvg.value ?? 0
  const vNA = out.voutAvg.notApplicable
  out.ioAvg = { key: 'ioAvg', value: v / p.r, formula: 'Iout = Vout/R', assumptions: out.voutAvg.assumptions, notApplicable: vNA }
  out.poutAvg = { key: 'poutAvg', value: (v * v) / p.r, formula: 'Pout = Vout²/R (ripple neglected)', assumptions: [...out.voutAvg.assumptions, 'small output ripple'], notApplicable: vNA }
  out.pinAvg = { key: 'pinAvg', value: (v * v) / p.r, formula: 'Pin = Pout (lossless)', assumptions: [...out.voutAvg.assumptions], notApplicable: vNA }
  out.efficiency = { key: 'efficiency', value: 1, formula: 'η = 100 %', assumptions: ['ideal (lossless) components'], notApplicable: ideal ? undefined : 'Non-ideal devices dissipate power.' }
  return out
}

/**
 * First-order ESTIMATE of Vout with device drops (CCM): volt-second balance on L with constant iL and
 * charge balance on C, solved for Vout.
 *   buck:        D·(Vin − I·RonQ) − (1 − D)·(Vf + I·RonD) − I·DCR = Vout,       I = Vout/R
 *   boost:       Vin − I·DCR − D·I·RonQ − (1 − D)·(Vf + I·RonD + Vout) = 0,     I = Vout/(R(1 − D))
 *   buck-boost:  D·(Vin − I·RonQ) − (1 − D)·(|Vout| + Vf + I·RonD) − I·DCR = 0,  I = |Vout|/(R(1 − D))
 */
export function dcdcVoutEstimate(p: ResolvedConverter): number {
  const D = p.duty
  const kind = p.kind ?? 'buck'
  const rq = p.q.ron
  const rd = p.d.ron
  if (kind === 'buck') return (D * p.vin - (1 - D) * p.d.vf) / (1 + (D * rq + (1 - D) * rd + p.rl) / p.r)
  const a = 1 - D
  // Write I = |Vout|/(R·a); solve the linear equation for |Vout|.
  const rEff = (p.rl + D * rq + a * rd) / (p.r * a)
  if (kind === 'boost') return (p.vin - a * p.d.vf) / (a + rEff)
  return -(D * p.vin - a * p.d.vf) / (a + rEff)
}
