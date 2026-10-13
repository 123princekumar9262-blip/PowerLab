import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StateView, StatusInfo, WhyCard } from '../../lab/types.ts'
import type { CurrentPath, NextConsequence } from '../../workspace/contract.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { INDUCTION_DEFAULTS, resolveInduction, simulateInduction, syncRpm, type ImPlateau, type InductionParams, type InductionRun } from './induction.ts'
import { inductionTheory, type EqPoint } from './inductionTheory.ts'

/*
 * The induction motor topic's words: state at the cursor, status, WHY, events, SIMULATION vs THEORY, lessons,
 * experiments and predictions. Every number quoted here is read from a simulated run (or labelled THEORY, from
 * the equivalent circuit).
 */

export type ImPhase = 'locked' | 'accelerating' | 'decelerating' | 'running' | 'generating'

export interface ImState {
  k: number
  t: number
  ia: number
  ib: number
  ic: number
  /** Stator and rotor phase current, RMS-equivalent of the space vector [A]. */
  irms: number
  irr: number
  va: number
  vrms: number
  f: number
  n: number
  nsync: number
  slip: number
  te: number
  tl: number
  psi: number
  pin: number
  w: number
  /** Electrical angle of the stator flux, and the rotor's mechanical angle [rad]. */
  thf: number
  thr: number
  stuck: boolean
  /** Mean speed change over the last supply cycle [rpm/s]. */
  dndt: number
  phase: ImPhase
}

export function imStateAt(r: InductionRun, k: number): ImState {
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const p = r.params
  const kc = Math.max(1, Math.round(1 / Math.max(s.f[i], p.fr * 0.02) / p.dt))
  const j = Math.max(0, i - kc)
  const dndt = i > j ? (s.n[i] - s.n[j]) / ((i - j) * p.dt) : 0
  const stuck = s.stuck[i] > 0.5
  const ns = s.nsync[i]
  let phase: ImPhase
  if (stuck) phase = 'locked'
  else if (s.slip[i] < -1e-4) phase = 'generating'
  else if (Math.abs(dndt) > 0.05 * Math.max(ns, 1)) phase = dndt > 0 ? 'accelerating' : 'decelerating'
  else phase = 'running'
  return {
    k: i,
    t: r.time[i],
    ia: s.ia[i],
    ib: s.ib[i],
    ic: s.ic[i],
    irms: s.irms[i],
    irr: s.irr[i],
    va: s.va[i],
    vrms: s.vrms[i],
    f: s.f[i],
    n: s.n[i],
    nsync: ns,
    slip: s.slip[i],
    te: s.te[i],
    tl: s.tl[i],
    psi: s.psi[i],
    pin: s.pin[i],
    w: s.w[i],
    thf: s.thf[i],
    thr: s.thr[i],
    stuck,
    dndt,
    phase,
  }
}

const PHASE_TEXT: Record<ImPhase, string> = {
  locked: 'rotor at rest',
  accelerating: 'accelerating',
  decelerating: 'slowing down',
  running: 'running',
  generating: 'generating',
}
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)} %`
const nm = (x: number, d = 1) => `${x.toFixed(d)} N·m`
const rpmTxt = (x: number) => `${x.toFixed(0)} rpm`

// ── measurements ────────────────────────────────────────────────────────────

export interface InductionMeasurements {
  /** Final operating point (last supply cycle). */
  nEnd: number
  nsync: number
  slip: number
  /** Slip speed ns − n [rpm]. */
  slipRpm: number
  te: number
  isEnd: number
  irEnd: number
  pf: number
  pin: number
  pcuS: number
  pcuR: number
  pfr: number
  pout: number
  pag: number
  eff: number | null
  fEnd: number
  vEnd: number
  psi: number
  /** Operating point before the step (null without a step). */
  nPre: number | null
  slipPre: number | null
  /** Slip speed before the step [rpm]. */
  slipRpmPre: number | null
  isPre: number | null
  tePre: number | null
  /** Start-up: peak phase current, torque extremes, time to 95 % of the speed, energies until the start settled. */
  iPeak: number
  iPeakRun: number
  teMax: number
  teMin: number
  tStart: number | null
  einStart: number
  ecuSStart: number
  ecuRStart: number
  ekinStart: number
  /** Whole run energies and the conservation residual. */
  ein: number
  ecuS: number
  ecuR: number
  efr: number
  eload: number
  ekin: number
  emag: number
  balance: number
  locked: boolean
  stalled: boolean
  neverStarted: boolean
  settled: boolean
  outcome: string
}

export function measureInduction(r: InductionRun): InductionMeasurements {
  const e = r.end
  const st = r.start
  return {
    nEnd: e.n,
    nsync: e.nsync,
    slip: e.slip,
    slipRpm: e.nsync - e.n,
    te: e.te,
    isEnd: e.is,
    irEnd: e.ir,
    pf: e.pf,
    pin: e.pin,
    pcuS: e.pcuS,
    pcuR: e.pcuR,
    pfr: e.pfr,
    pout: e.pout,
    pag: e.pag,
    eff: e.eff,
    fEnd: e.f,
    vEnd: e.v,
    psi: e.psi,
    nPre: r.pre?.n ?? null,
    slipPre: r.pre?.slip ?? null,
    slipRpmPre: r.pre ? r.pre.nsync - r.pre.n : null,
    isPre: r.pre?.is ?? null,
    tePre: r.pre?.te ?? null,
    iPeak: st.iPeak,
    iPeakRun: r.iPeakRun,
    teMax: st.teMax,
    teMin: st.teMin,
    tStart: st.tStart,
    einStart: st.e.ein,
    ecuSStart: st.e.ecuS,
    ecuRStart: st.e.ecuR,
    ekinStart: st.e.ekin,
    ein: r.energy.ein,
    ecuS: r.energy.ecuS,
    ecuR: r.energy.ecuR,
    efr: r.energy.efr,
    eload: r.energy.eload,
    ekin: r.energy.ekin,
    emag: r.energy.emag,
    balance: r.energy.balance,
    locked: e.stuck,
    stalled: r.stalled,
    neverStarted: r.neverStarted,
    settled: r.diagnostics.steady.converged,
    outcome: e.stuck ? (r.neverStarted ? 'did not start' : 'stalled') : e.slip < -1e-4 ? 'generating' : 'running',
  }
}

// ── state view, status, path ────────────────────────────────────────────────

export function imView(st: ImState, r: InductionRun): StateView {
  const p = r.params
  return {
    badge: { text: PHASE_TEXT[st.phase], tone: st.phase === 'locked' ? 'off' : st.phase === 'generating' ? 'idle' : 'on' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'speed', v: rpmTxt(st.n), tone: st.stuck ? 'bad' : 'ok' },
      { k: 'synchronous speed', v: rpmTxt(st.nsync) },
      { k: 'slip', v: pct(st.slip) },
      { k: 'motor torque', v: nm(st.te, 2) },
      { k: 'load torque', v: nm(st.tl, 2) },
      { k: 'stator current (RMS)', v: formatA(st.irms) },
      { k: 'phase current ia', v: formatA(st.ia, true), min: 'standard' },
      { k: 'supply', v: `${st.f.toFixed(2)} Hz · ${formatV(st.vrms, false)} per phase`, min: 'standard' },
      { k: 'stator flux |ψs|', v: `${st.psi.toFixed(3)} Wb`, min: 'standard' },
      { k: 'rotor current (RMS)', v: formatA(st.irr), min: 'engineer' },
      { k: 'input power', v: formatW(st.pin), min: 'engineer' },
      { k: 'speed change', v: `${st.dndt.toFixed(0)} rpm/s`, min: 'engineer' },
      { k: 'fed by', v: p.supply === 'dol' ? 'mains (direct on line)' : 'V/f drive', min: 'engineer' },
    ],
    path: imPath(st).text,
  }
}

export function imStatus(st: ImState): StatusInfo {
  const facts = [`${rpmTxt(st.n)} of ${rpmTxt(st.nsync)}`, `slip ${pct(st.slip, 1)}`, `Te ${nm(st.te)}`, `${formatA(st.irms)} RMS`]
  if (st.phase === 'locked') return { headline: 'Rotor at rest', facts: [`motor torque ${nm(Math.abs(st.te))} ≤ load ${nm(st.tl)}`, `${formatA(st.irms)} RMS`, `slip 1`], tone: 'off' }
  if (st.phase === 'generating') return { headline: 'Generating · rotor faster than the field', facts, tone: 'idle' }
  if (st.phase === 'accelerating') return { headline: 'Accelerating', facts, tone: 'on' }
  if (st.phase === 'decelerating') return { headline: 'Slowing down', facts, tone: 'on' }
  return { headline: `Running · slip ${pct(st.slip, 2)}`, facts: facts.slice(0, 1).concat(facts.slice(2)), tone: 'on' }
}

export function imPath(st: ImState): CurrentPath {
  if (st.phase === 'generating')
    return {
      elements: ['load', 'rotor', 'stator', 'supply'],
      text: `shaft → rotor cage → air gap → stator → back into the supply (${formatW(-st.pin)})`,
      reasons: ['The rotor turns faster than the field: the slip is negative, the torque brakes and power flows back.'],
    }
  return {
    elements: ['supply', 'stator', 'rotor', 'load'],
    text: st.stuck ? `supply → stator → air gap → rotor cage, all turned into heat: the rotor does not turn (${formatW(st.pin)})` : `supply → stator windings → air gap → rotor cage → shaft → load (${formatW(st.pin)} in)`,
    reasons: st.stuck ? ['At standstill no mechanical power leaves: the input power heats the windings.'] : ['The rotating field induces the rotor currents; their force on the cage drives the shaft.'],
  }
}

// ── events ──────────────────────────────────────────────────────────────────

export function imEventLabel(e: RunEvent): string {
  switch (e.device) {
    case 'peak':
      return 'Peak starting current'
    case 'accel-peak':
      return 'Largest torque on the way up'
    case 'breakaway':
      return 'The rotor breaks away'
    case 'ramp-end':
      return 'The supply reaches its set frequency'
    case 'settled':
      return 'Steady operating point reached'
    case 'load-step':
      return 'Load torque step'
    case 'freq-step':
      return 'Frequency step'
    case 'regen-start':
      return 'Generating: the rotor overtakes the field'
    case 'regen-end':
      return 'Motoring again'
    case 'stall':
      return 'The motor stalls'
  }
  return e.device ?? e.kind
}

export function imEventWhy(e: RunEvent): string {
  const v = e.values
  const at = `${(v.n ?? 0).toFixed(0)} rpm, slip ${pct(v.slip ?? 0, 1)}, Te ${nm(v.te ?? 0)}, ${formatA(v.i ?? 0)} RMS.`
  switch (e.device) {
    case 'peak':
      return `${formatA(v.i ?? 0)} peak in one phase. At switch-on the rotor is at rest: slip 1, so the rotor bars cut the field at the full supply frequency, a large EMF drives large rotor currents and only the small leakage reactances and the resistances limit them. The flux also starts with a DC offset, which adds to the first peaks.`
    case 'accel-peak':
      return `${at} The steady torque–speed curve peaks at the breakdown slip; as the slip falls through it on the way up, the motor torque is largest.`
    case 'breakaway':
      return `${at} The supply frequency (${(v.f ?? 0).toFixed(2)} Hz) has risen far enough that the torque at standstill exceeds the load torque: the rotor starts to turn.`
    case 'ramp-end':
      return `${at} From here the frequency stays constant; the rotor settles at a small slip behind the field.`
    case 'settled':
      return `${at} Speed, torque and current no longer change: the torque matches the load (plus friction) — this is the steady operating point the equivalent circuit predicts.`
    case 'load-step': {
      const sb = v.sBefore ?? 0
      const se = v.sEnd ?? 0
      if (v.stalled) return `${at} The load torque jumps from ${nm(v.from ?? 0)} to ${nm(v.to ?? 0)} — more than the motor's breakdown torque: the rotor slows, the slip passes the breakdown slip, the torque falls instead of rising and the motor stalls.`
      return `${at} The load torque changes from ${nm(v.from ?? 0)} to ${nm(v.to ?? 0)}. The rotor ${(v.to ?? 0) > (v.from ?? 0) ? 'slows until the larger slip makes enough torque' : 'speeds up until the smaller slip matches the lighter load'}: slip ${pct(sb)} → ${pct(se)}, speed ${(v.nBefore ?? 0).toFixed(0)} → ${(v.nEnd ?? 0).toFixed(0)} rpm.`
    }
    case 'freq-step':
      return `${at} The drive ramps the frequency from ${(v.from ?? 0).toFixed(1)} to ${(v.to ?? 0).toFixed(1)} Hz (V/f keeps the flux): the synchronous speed moves and the rotor follows — speed ${(v.nBefore ?? 0).toFixed(0)} → ${(v.nEnd ?? 0).toFixed(0)} rpm by the end of the run.`
    case 'regen-start':
      return `${at} The field now turns slower than the rotor: the slip is negative, the torque reverses and brakes, and power flows back into the supply (a real drive needs a brake chopper or an active front end for it).`
    case 'regen-end':
      return `${at} The rotor has slowed below the synchronous speed again: positive slip, motoring torque.`
    case 'stall':
      return `${at} The rotor has stopped and the load holds it: the motor draws its locked-rotor current and turns all of its input power into heat.`
  }
  return at
}

const LATER = 1e-9

/** NEXT CONSEQUENCE: the run's next event after the cursor, else how the run ends (from the samples). */
export function imNextConsequence(r: InductionRun, st: ImState): NextConsequence | null {
  const e = r.events.find((x) => x.time > st.t + 0.5 * r.params.dt + LATER)
  if (e) return { text: `${imEventLabel(e)} at t = ${formatTime(e.time)}. ${imEventWhy(e)}`, time: e.time }
  const last = r.length - 1
  if (st.k >= last - 1) return { text: `This is the end of the simulated run (t = ${formatTime(r.time[last])}): nothing later is computed.`, time: null }
  const end = r.end
  return {
    text: `No further event in this run: the motor stays at ${rpmTxt(end.n)} (slip ${pct(end.slip)}), ${nm(end.te)} and ${formatA(end.is)} RMS until the run ends at t = ${formatTime(r.time[last])}.`,
    time: r.time[last],
  }
}

// ── readings ────────────────────────────────────────────────────────────────

export function imReadings(m: InductionMeasurements, r: InductionRun): Reading[] {
  const p = r.params
  return [
    { id: 'n', label: 'Speed', value: m.nEnd.toFixed(0), unit: 'rpm', note: `ns = 120·f/P = ${m.nsync.toFixed(0)} rpm` },
    { id: 'slip', label: 'Slip', value: (m.slip * 100).toFixed(2), unit: '%', note: m.locked ? 'rotor locked: s = 1' : `s = (ns − n)/ns` },
    {
      id: 'ipk',
      label: 'Starting current, peak',
      value: formatA(m.iPeak).replace(/ \S*A$/, ''),
      unit: formatA(m.iPeak).replace(/^[^ ]+ /, ''),
      note: `${(m.iPeak / Math.max(Math.SQRT2 * m.isEnd, 1e-9)).toFixed(1)}× running · ${p.supply === 'dol' ? 'DOL' : 'V/f'}`,
      min: 'standard',
    },
    m.eff === null
      ? { id: 'is', label: 'Stator current, RMS', value: formatA(m.isEnd).replace(/ \S*A$/, ''), unit: formatA(m.isEnd).replace(/^[^ ]+ /, ''), note: 'no output power', min: 'standard' }
      : { id: 'eff', label: 'Efficiency', value: (m.eff * 100).toFixed(1), unit: '%', note: 'η = Pout/Pin', min: 'standard' },
  ]
}

// ── WHY ─────────────────────────────────────────────────────────────────────

export function imWhy(r: InductionRun, st: ImState, m: InductionMeasurements): WhyCard[] {
  const p = r.params
  const th = inductionTheory(p)
  const cards: WhyCard[] = []
  const now: Record<ImPhase, Omit<WhyCard, 'id' | 'question'>> = {
    locked: {
      what: `The rotor is at rest: the motor torque (${nm(Math.abs(st.te))}) is not larger than the load torque (${nm(st.tl)}), so the load holds the shaft.`,
      why: 'At standstill the slip is 1: the rotor sees the field sweeping past at the full supply frequency. That induces large rotor currents, but at this slip they are mostly reactive — they make little torque.',
      equation: 's = 1:  I ≈ V/√((Rs + Rr)² + (Xls + Xlr)²)',
      physics: `The input power (${formatW(st.pin)} now) only heats the windings — no mechanical power leaves the shaft.`,
      whatIf: p.supply === 'dol' ? 'A lighter load (below the starting torque) lets it start; a V/f drive starts it at low frequency where the torque per ampere is high.' : 'More boost (more voltage at low frequency) raises the low-speed torque.',
    },
    accelerating: {
      what: `The motor torque (${nm(st.te)}) exceeds the load (${nm(st.tl)}): the rotor speeds up (${st.dndt.toFixed(0)} rpm/s, mean over the last cycle).`,
      why: 'The difference between motor and load torque accelerates the inertia. As the rotor catches up with the field, the slip falls and so does the rotor EMF.',
      equation: 'J·dωm/dt = Te − TL − B·ωm',
      physics: `Slip now ${pct(st.slip, 1)}; the field turns at ${rpmTxt(st.nsync)}, the rotor at ${rpmTxt(st.n)}.`,
      whatIf: 'More inertia J: a longer start, and (direct on line) more energy lost in the rotor while starting.',
    },
    decelerating: {
      what: `The motor torque (${nm(st.te)}) is below the load and friction: the rotor slows down (${st.dndt.toFixed(0)} rpm/s).`,
      why: 'A larger slip will be needed to make the torque the load asks for — the rotor slows until it gets it (or, above the breakdown torque, until it stalls).',
      equation: 'J·dωm/dt = Te − TL − B·ωm < 0',
      physics: `Slip now ${pct(st.slip, 1)}.`,
      whatIf: 'Above the breakdown torque there is no speed at which the torque is large enough.',
    },
    running: {
      what: `The rotor turns at ${rpmTxt(st.n)}, ${(st.nsync - st.n).toFixed(1)} rpm behind the rotating field (${rpmTxt(st.nsync)}): slip ${pct(st.slip)}.`,
      why: 'The rotor must lag the field: only then do the cage bars cut flux, carry current and make torque. The lag (slip) grows until the torque equals the load torque plus friction.',
      equation: 'T = 3·p/ωs · I2²·R2/s,  s = (ns − n)/ns',
      physics: `Torque ${nm(st.te, 2)} for a load of ${nm(st.tl, 2)} plus friction.`,
      whatIf: 'More load torque: a bigger slip and more current; the speed drops only a little until the breakdown torque.',
    },
    generating: {
      what: `The rotor (${rpmTxt(st.n)}) turns faster than the field (${rpmTxt(st.nsync)}): the slip is negative (${pct(st.slip)}).`,
      why: 'The cage now cuts the flux in the opposite sense: the rotor currents reverse, the torque reverses and brakes the rotor. The machine is a generator.',
      equation: 's < 0:  T < 0,  Pin < 0',
      physics: `Electrical power flows back into the supply: ${formatW(-st.pin)} now.`,
      whatIf: 'A slower frequency ramp keeps the slip small: less braking torque, less power returned.',
    },
  }
  cards.push({ id: 'now', question: `What is happening now? (${PHASE_TEXT[st.phase]})`, ...now[st.phase] })
  const tp = th.end.point
  cards.push({
    id: 'slip',
    question: 'Why does the rotor turn slower than the field?',
    what: m.locked
      ? `SIMULATION: the run ends with the rotor locked (slip 1), drawing ${formatA(m.isEnd)} RMS.`
      : `SIMULATION: ${rpmTxt(m.nEnd)} against a synchronous ${rpmTxt(m.nsync)} — slip ${pct(m.slip)} (${m.slipRpm.toFixed(1)} rpm).`,
    why: 'A cage rotor running exactly with the field would see no change of flux: no EMF, no current, no torque. It settles at the slip whose rotor current makes exactly the torque the load needs.',
    equation: 'ns = 120·f/P,  T ≈ (3·p/ωs)·(V²/R2)·s  for small s',
    physics: th.end.locked
      ? `THEORY (equivalent circuit): no stable operating point for this load — breakdown torque ${nm(th.end.bd.tMax)} — the rotor locks at s = 1.`
      : `THEORY (equivalent circuit): ${rpmTxt(tp.n)}, slip ${pct(tp.s)} — the torque–speed curve crosses the load line there. Breakdown torque ${nm(th.end.bd.tMax)} at slip ${pct(th.end.bd.sMax, 1)}.`,
    whatIf: 'Twice the load torque roughly doubles the slip (the curve is almost straight at small slip).',
  })
  if (p.supply === 'dol')
    cards.push({
      id: 'inrush',
      question: 'Why is the direct-on-line starting current so large?',
      what: `SIMULATION: ${formatA(m.iPeak)} peak at switch-on, ${(m.iPeak / Math.max(Math.SQRT2 * m.isEnd, 1e-9)).toFixed(1)}× the running peak current.`,
      why: 'At rest the slip is 1: the rotor EMF is at its largest and the rotor branch Rr/s is small, so only the leakage reactances and resistances limit the current. The flux also starts with a DC offset that adds to the first peaks.',
      equation: `THEORY: locked-rotor current I1(s = 1) = ${formatA(th.lockedRotor.i1)} RMS (${formatA(Math.SQRT2 * th.lockedRotor.i1)} peak)`,
      physics: `During the start ${formatSI(m.ecuRStart, 'J')} were turned into heat in the rotor while ${formatSI(m.ekinStart, 'J')} were stored in the rotating mass (SIMULATION).`,
      whatIf: 'A V/f ramp starts the motor at low frequency and low voltage: a small slip the whole time, a fraction of the current.',
    })
  else
    cards.push({
      id: 'vf',
      question: 'Why does the V/f start draw so little current?',
      what: `SIMULATION: ${formatA(m.iPeak)} peak during the start; the frequency rises at ${(p.rate).toFixed(1)} Hz/s and the voltage with it.`,
      why: 'The field starts slowly and speeds up gently; the rotor follows close behind. The slip FREQUENCY (field speed minus rotor speed) stays small the whole time, so the rotor EMF and current stay small too.',
      equation: 'V/f ≈ constant  ⇒  |ψs| ≈ V/(2π·f) constant',
      physics: `Stator flux at the end ${m.psi.toFixed(3)} Wb (SIMULATION). The boost (${pct(p.boost, 0)} of the rated voltage at 0 Hz) makes up for the voltage lost in Rs at low frequency.`,
      whatIf: 'A shorter ramp asks for more accelerating torque: more current. No boost: weak flux at low frequency, less torque.',
    })
  if (p.supply === 'dol' && m.teMin < 0)
    cards.push({
      id: 'pulsation',
      question: 'Why does the torque oscillate after switch-on?',
      what: `SIMULATION: the torque swings between ${nm(m.teMin)} and ${nm(m.teMax)} in the first cycles.`,
      why: 'Switching on gives the flux a decaying DC component. Seen from the rotating field it is a second field turning backwards at the supply frequency: the two interact and the torque pulsates at the supply frequency until the DC part has decayed.',
      equation: 'ψs(t) = ψsteady·e^{jωt} + ψdc·e^{−t/τ}',
      physics: 'These pulsations stress the shaft and coupling; the steady equivalent circuit cannot show them — only the dynamic model does.',
      whatIf: 'A V/f ramp (or a soft starter) avoids the jump and with it most of the pulsation.',
    })
  if (!m.locked)
    cards.push({
      id: 'losses',
      question: 'Where does the input power go?',
      what: `SIMULATION, last cycle: ${formatW(m.pin)} in → stator copper ${formatW(m.pcuS)}, rotor copper ${formatW(m.pcuR)}, friction ${formatW(m.pfr)}, load ${formatW(m.pout)}${m.eff === null ? '' : ` — efficiency ${pct(m.eff, 1)}`}.`,
      why: 'Power crosses the air gap as Pag = Te·ωs/p. The rotor turns it into mechanical power (1 − s)·Pag; the remainder s·Pag heats the rotor bars. A large slip is therefore always inefficient.',
      equation: `Pcu,r = s·Pag:  ${formatW(m.pcuR)} ≈ ${pct(m.slip)} × ${formatW(m.pag)}`,
      physics: 'Iron loss is not modelled here: a real motor also loses a few % in the core.',
      whatIf: 'More rotor resistance: more slip, more rotor heat, lower efficiency — but more starting torque.',
    })
  return cards
}

// ── SIMULATION vs THEORY ────────────────────────────────────────────────────

/** Tolerances (relative unless stated) and why: the run is declared settled when its 20 ms means change by < 2·10⁻⁶ of ns (speed) and < 2·10⁻⁵ (torque, current); RK4 at ≥ 200 steps per cycle is accurate to ~10⁻⁸. */
const TOL = { n: 5e-4, slip: 5e-3, other: 2e-3 }

export function compareInduction(r: InductionRun, m: InductionMeasurements): CompareResult {
  const p = r.params
  const th = inductionTheory(p)
  const rows: CompareRow[] = []
  const lockedSim = (pl: ImPlateau) => pl.stuck
  const mismatch = (pl: ImPlateau, locked: boolean) =>
    lockedSim(pl) !== locked
      ? lockedSim(pl)
        ? 'the simulated motor locked although a static operating point exists: the dynamic transient (inertia, overshoot) pulled it past the breakdown slip'
        : 'the simulated motor runs although the static start criterion says it cannot: the switch-on torque pulsations kicked the rotor past the part of the curve that lies below the load'
      : undefined
  const add = (key: string, label: string, unit: string, sim: number, exact: number, tol: number, formula: string, notes: string[], scale?: number, expected?: string) => {
    const den = scale ?? Math.max(Math.abs(exact), 1e-12)
    const error = Math.abs(sim - exact) / den
    rows.push({
      key,
      label,
      unit,
      sim,
      exact,
      error,
      tolerance: tol,
      pass: error <= tol,
      textbook: { key, value: exact, formula, assumptions: notes },
      textbookError: (sim - exact) / Math.max(Math.abs(exact), 1e-12),
      expected,
    })
  }
  const notes = ['steady state of the per-phase equivalent circuit (Rs, Xls, Xm, Xlr, Rr/s) at the final supply frequency and voltage', 'no iron loss, no saturation in either model']
  const block = (pl: ImPlateau, ts: typeof th.end, pre: boolean, lab: string) => {
    const tp: EqPoint = ts.point
    const unsettled = (pre ? r.tSettledA : r.tSettled) === null ? 'the run had not settled: the theory is the final steady state' : undefined
    const exp = unsettled ?? mismatch(pl, ts.locked)
    add(pre ? 'nPre' : 'nEnd', `Speed${lab}`, 'rpm', pl.n, tp.n, TOL.n, 'n = (1 − s)·120·f/P', notes, Math.max(pl.nsync, 1), exp)
    add(pre ? 'slipPre' : 'slip', `Slip${lab}`, '%', pl.slip, tp.s, TOL.slip, ts.locked ? 'locked rotor: s = 1' : 'Te(s) = TL + B·ωm (stable branch)', notes, Math.max(Math.abs(tp.s), 2e-3), exp)
    add(pre ? 'isPre' : 'isEnd', `Stator current, RMS${lab}`, 'A', pl.is, tp.i1, TOL.other, 'I1 = V/(Rs + jXls + jXm ∥ (Rr/s + jXlr))', notes, undefined, exp)
    if (!pre) {
      add('te', 'Electromagnetic torque', 'N·m', pl.te, tp.te, TOL.other, 'T = 3·p/ωs · I2²·Rr/s', notes, Math.max(Math.abs(tp.te), 0.01 * th.end.bd.tMax), exp)
      add('pf', 'Power factor', '', pl.pf, tp.pf, TOL.other, 'cos φ = P/(3·V·I1)', notes, undefined, exp)
      add('pin', 'Input power', 'W', pl.pin, tp.pin, TOL.other, 'P = 3·V·I1·cos φ', notes, undefined, exp)
      add('pcuR', 'Rotor copper loss', 'W', pl.pcuR, tp.pcuR, TOL.other, 'Pcu,r = 3·I2²·Rr = s·Pag', notes, Math.max(tp.pcuR, 1e-3 * Math.abs(tp.pin)), exp)
      const effTh = !ts.locked && tp.pin > 0 && tp.wm > 0 ? (ts.tl * tp.wm) / tp.pin : null
      if (pl.eff !== null && effTh !== null) add('eff', 'Efficiency', '%', pl.eff, effTh, TOL.other, 'η = TL·ωm/P', notes, undefined, exp)
    }
  }
  if (r.pre) block(r.pre, th.start, true, ' before the step')
  block(r.end, th.end, false, '')
  if (p.supply === 'dol') {
    const lr = th.lockedRotor
    add('iPeak', 'Peak starting current', 'A', m.iPeak, Math.SQRT2 * lr.i1, 0, '√2 · I1(s = 1)', ['steady locked-rotor current of the equivalent circuit'], undefined, 'the switch-on transient adds a decaying DC offset and the rotor already turns: the first peak differs from the steady locked-rotor value')
  }
  return {
    rows,
    allPass: rows.every((x) => x.pass || !!x.expected),
    header: `SIMULATION: the dynamic two-axis model (stationary frame) integrated by RK4, ${p.stepsPerPeriod} steps per ${formatTime(p.period)} period, from rest; each operating point is the mean over the last supply cycle of a settled plateau. THEORY: the per-phase steady-state equivalent circuit at the same frequency and voltage, operating point by bisection of Te(s) = TL + B·ωm. Tolerances: speed 0.05 % of ns, slip 0.5 %, others 0.2 % — the settling test stops at 20 ms means changing by < 2·10⁻⁶ of ns.`,
    note: p.supply === 'vf' ? 'The V/f drive is modelled by its fundamental: a sinusoidal voltage of the commanded frequency and amplitude (inverter switching is not modelled).' : undefined,
  }
}

// ── lessons ─────────────────────────────────────────────────────────────────

type L = Lesson<InductionParams, InductionRun, InductionMeasurements, ImState>

const ev = (r: InductionRun, device: string) => r.events.find((e) => e.device === device)
const tEnd = (r: InductionRun) => r.params.duration
/** The time of the largest start-up torque (from the samples). */
function tTeMax(r: InductionRun): number {
  const kA = r.kStep !== null ? r.kStep - 1 : r.length - 1
  let kb = 0
  for (let k = 0; k <= kA; k++) if (r.signals.te[k] > r.signals.te[kb]) kb = k
  return r.time[kb]
}
/** The same motor started direct on line (for the V/f lesson's comparison). */
const dolTwin = (r: InductionRun) => measureInduction(simulateInduction({ ...r.params, supply: 'dol', event: 'none' }))

export const INDUCTION_LESSONS: L[] = [
  {
    id: 'dol',
    title: 'Starting direct on line',
    summary: 'Switch a loaded motor straight onto the mains: inrush current, torque pulsations, then a small slip.',
    check: {
      question: 'Why does a direct-on-line start draw several times the running current?',
      options: ['the load torque is largest at standstill', 'at standstill the slip is 1: the rotor EMF is large and only the small leakage impedances limit the current', 'the mains voltage is higher at switch-on'],
      answer: 1,
      explain: 'With the rotor at rest the field sweeps the cage at the full supply frequency. The rotor branch Rr/s is small at s = 1, so the current is limited only by the leakage reactances and the resistances — typically 5 to 8 times the rated current.',
    },
    base: { supply: 'dol', event: 'none', tl: 15 },
    steps: [
      {
        title: '1 · Switch-on: a current surge',
        at: (r) => ev(r, 'peak')?.time ?? 0,
        window: (r) => [0, Math.min(tEnd(r), 0.6 * (r.start.tStart ?? tEnd(r)))],
        channels: ['ia', 'ib', 'ic', 'n'],
        look: 'Three large phase currents while the speed has barely started.',
        body: (_st, m) =>
          `The current peaks at ${formatA(m.iPeak)} — ${(m.iPeak / Math.max(Math.SQRT2 * m.isEnd, 1e-9)).toFixed(1)}× the peak of the running current (${formatA(m.isEnd)} RMS at the end). The rotor is still at rest: slip 1, so the cage sees the field at the full supply frequency and only the leakage impedances limit the current.`,
      },
      {
        title: '2 · Torque pulsations',
        at: (r) => tTeMax(r),
        window: (r) => [0, Math.min(tEnd(r), 1.1 * (r.start.tStart ?? tEnd(r)))],
        channels: ['te', 'tl', 'n'],
        look: 'The torque swings hard — even negative — before it settles into a smooth rise.',
        body: (_st, m) =>
          `In the first cycles the torque swings between ${nm(m.teMin)} and ${nm(m.teMax)}. The flux starts with a DC offset; until it decays, the torque pulsates at the supply frequency. Only then does the smooth "torque–speed curve" torque take over.`,
      },
      {
        title: '3 · Through the breakdown torque',
        at: (r) => ev(r, 'accel-peak')?.time ?? tTeMax(r),
        window: (r) => [0, Math.min(tEnd(r), 1.4 * (r.start.tStart ?? tEnd(r)))],
        channels: ['te', 'n', 'nsync'],
        look: 'Near the end of the run-up the torque rises to its largest smooth value, then falls as the rotor nears the field speed.',
        body: (st) => `At ${rpmTxt(st.n)} (slip ${pct(st.slip, 1)}) the torque reaches ${nm(st.te)}: the rotor is passing the breakdown slip, where the torque–speed curve peaks. Closer to the field speed the slip — and the torque — fall quickly.`,
      },
      {
        title: '4 · Running: a small slip',
        at: (r) => tEnd(r) - 0.5 / r.end.f,
        window: (r) => [Math.max(0, tEnd(r) - 0.25), tEnd(r)],
        channels: ['n', 'nsync', 'irms'],
        look: 'The speed sits just below the synchronous speed; the current has fallen to its running value.',
        body: (_st, m) =>
          `The rotor settles at ${rpmTxt(m.nEnd)}, ${m.slipRpm.toFixed(1)} rpm behind the field (${rpmTxt(m.nsync)}): slip ${pct(m.slip)}. The current is down to ${formatA(m.isEnd)} RMS. Starting cost ${formatSI(m.ecuRStart, 'J')} of heat in the rotor for ${formatSI(m.ekinStart, 'J')} stored in the rotating mass.`,
      },
    ],
  },
  {
    id: 'vf',
    title: 'A soft start with V/f',
    summary: 'Let a drive raise frequency and voltage together: the same motor starts with a fraction of the current.',
    check: {
      question: 'Why does a V/f ramp start the motor with so little current?',
      options: ['the drive keeps the voltage at a few volts all the time', 'the field speeds up gradually, so the slip frequency — and the rotor EMF — stays small the whole time', 'the rotor resistance rises at low frequency'],
      answer: 1,
      explain: 'The rotor follows the slowly accelerating field closely: the difference in speed (the slip frequency) stays small, so the rotor EMF and current stay close to their running values. Constant V/f keeps the flux, and so the torque per ampere, the same at every frequency.',
    },
    base: { supply: 'vf', event: 'none', tl: 15, f: 50 },
    steps: [
      {
        title: '1 · Volts follow hertz',
        at: (r) => 0.4 * (r.params.f / r.params.rate),
        window: (r) => [0, Math.min(tEnd(r), 1.2 * (r.params.f / r.params.rate))],
        channels: ['va', 'f', 'psi'],
        look: 'Frequency and voltage rise together; the stator flux stays almost flat.',
        body: (st) => `${st.f.toFixed(1)} Hz and ${formatV(st.vrms, false)} per phase — ${(st.vrms / Math.max(st.f, 1e-9)).toFixed(2)} V/Hz. The stator flux |ψs| is ${st.psi.toFixed(3)} Wb: keeping V/f constant keeps the flux constant, so the motor makes the same torque per ampere at every frequency.`,
      },
      {
        title: '2 · The rotor follows the field',
        at: (r) => 0.75 * (r.params.f / r.params.rate),
        window: (r) => [0, tEnd(r)],
        channels: ['n', 'nsync', 'te'],
        look: 'The rotor speed rises parallel to the synchronous speed, a small step behind it.',
        body: (st) => `The field turns at ${rpmTxt(st.nsync)}, the rotor at ${rpmTxt(st.n)}: only ${(st.nsync - st.n).toFixed(0)} rpm behind. The torque (${nm(st.te)}) is just the load plus what the inertia needs to keep up with the ramp.`,
      },
      {
        title: '3 · A fraction of the direct-on-line current',
        at: (r) => ev(r, 'peak')?.time ?? 0,
        window: (r) => [0, tEnd(r)],
        channels: ['ia', 'irms', 'n'],
        look: 'The phase current stays close to its running value during the whole start.',
        body: (_st, m, r) => {
          const d = dolTwin(r)
          return `Peak current with the ramp: ${formatA(m.iPeak)}. The same motor and load started direct on line: ${formatA(d.iPeak)} (SIMULATION) — ${(d.iPeak / Math.max(m.iPeak, 1e-9)).toFixed(1)}× more. Both end at the same operating point: ${rpmTxt(m.nEnd)} and ${rpmTxt(d.nEnd)}.`
        },
      },
      {
        title: '4 · Less heat in the rotor',
        at: (r) => r.tSettledA ?? tEnd(r),
        window: (r) => [0, tEnd(r)],
        channels: ['n', 'irms', 'pin'],
        look: 'A gentle start: no surge in the input power either.',
        body: (_st, m, r) => {
          const d = dolTwin(r)
          return `Rotor copper loss during the start: ${formatSI(m.ecuRStart, 'J')} with the ramp, ${formatSI(d.ecuRStart, 'J')} direct on line, for the same ${formatSI(m.ekinStart, 'J')} of kinetic energy. A direct-on-line start always heats the rotor by at least the kinetic energy it gives the load.`
        },
      },
    ],
  },
  {
    id: 'slip',
    title: 'Slip and the torque–speed curve',
    summary: 'Load the motor step by step: the slip grows with the torque — until the breakdown torque.',
    check: {
      question: 'Well below the breakdown torque, doubling the load torque…',
      options: ['roughly doubles the slip; the speed drops only a little', 'halves the speed', 'leaves the slip unchanged'],
      answer: 0,
      explain: 'At small slip the rotor current, and so the torque, is almost proportional to the slip (T ≈ 3·p·V²·s/(ωs·R2)). Twice the torque needs about twice the slip — a few percent of speed.',
    },
    base: { supply: 'dol', event: 'load', tl: 10, tl2: 20 },
    steps: [
      {
        title: '1 · A light load',
        at: (r) => (r.tstep ?? tEnd(r)) - 0.5 / r.params.fr,
        window: (r) => [Math.max(0, (r.tSettledA ?? 0) - 0.05), tEnd(r)],
        channels: ['n', 'te', 'tl'],
        look: 'Before the step: a steady speed just below the synchronous speed.',
        body: (_st, m) => `With ${nm(m.tePre ?? 0)} of torque the rotor runs at ${rpmTxt(m.nPre ?? 0)}: slip ${pct(m.slipPre ?? 0)}.`,
      },
      {
        title: '2 · Twice the load',
        at: (r) => tEnd(r) - 0.5 / r.params.fr,
        window: (r) => [Math.max(0, (r.tSettledA ?? 0) - 0.05), tEnd(r)],
        channels: ['n', 'te', 'tl', 'irms'],
        look: 'After the step the rotor slows a little and settles again.',
        body: (_st, m) => `Now ${nm(m.te)}: ${rpmTxt(m.nEnd)}, slip ${pct(m.slip)} — ${(m.slip / Math.max(m.slipPre ?? 1, 1e-9)).toFixed(2)}× the slip before. The speed fell by only ${((1 - m.nEnd / Math.max(m.nPre ?? 1, 1e-9)) * 100).toFixed(1)} %.`,
      },
      {
        title: '3 · Close to the breakdown torque',
        params: { tl: 15, tl2: 85 },
        at: (r) => tEnd(r) - 0.5 / r.params.fr,
        window: (r) => [Math.max(0, (r.tSettledA ?? 0) - 0.05), tEnd(r)],
        channels: ['n', 'te', 'tl', 'irms'],
        look: 'A heavy load: a large slip and a large current.',
        body: (_st, m, r) =>
          m.locked
            ? `${nm(r.params.tl2)} is more than this motor can carry: it stalls (${formatA(m.isEnd)} RMS).`
            : `At ${nm(m.te)} the rotor runs at ${rpmTxt(m.nEnd)}: slip ${pct(m.slip)}, current ${formatA(m.isEnd)} RMS, efficiency ${m.eff === null ? '—' : pct(m.eff, 1)}. Near the breakdown torque the curve flattens: a little more torque costs a lot more slip.`,
      },
      {
        title: '4 · Beyond the breakdown torque: stall',
        params: { tl: 15, tl2: 100 },
        at: (r) => ev(r, 'stall')?.time ?? tEnd(r),
        window: (r) => [Math.max(0, (r.tstep ?? 0) - 0.1), tEnd(r)],
        channels: ['n', 'te', 'tl', 'irms'],
        look: 'The speed collapses to zero; the current jumps to the locked-rotor value.',
        body: (_st, m, r) =>
          m.locked
            ? `Asked for ${nm(r.params.tl2)}, the motor slows; past the breakdown slip its torque FALLS as it slows, so nothing stops the fall: it stalls and draws ${formatA(m.isEnd)} RMS with the rotor at rest — all ${formatW(m.pin)} turned into heat.`
            : `This motor still carries the load: ${rpmTxt(m.nEnd)}, slip ${pct(m.slip)}.`,
      },
    ],
  },
  {
    id: 'speed',
    title: 'Speed control by frequency',
    summary: 'Halve the frequency of a V/f drive: the whole torque–speed curve moves, the slip speed stays.',
    check: {
      question: 'At constant load torque, lowering the V/f frequency…',
      options: ['lowers the synchronous speed; the slip speed ns − n stays about the same', 'keeps the speed and lowers the torque', 'raises the slip speed in proportion to the frequency change'],
      answer: 0,
      explain: 'With constant V/f the flux is the same, so the same torque needs the same rotor frequency, i.e. the same slip SPEED. The curve shifts left in parallel: the speed follows the frequency.',
    },
    base: { supply: 'vf', event: 'freq', f: 50, f2: 25, tl: 15, tramp: 0.4 },
    steps: [
      {
        title: '1 · At 50 Hz',
        at: (r) => (r.tstep ?? tEnd(r)) - 0.5 / r.params.f,
        window: (r) => [Math.max(0, (r.tstep ?? 0) - 0.3), tEnd(r)],
        channels: ['n', 'nsync', 'f'],
        look: 'Before the step: steady at rated frequency.',
        body: (_st, m, r) => `At ${r.params.f.toFixed(0)} Hz the rotor runs at ${rpmTxt(m.nPre ?? 0)}, ${(m.slipRpmPre ?? 0).toFixed(1)} rpm behind the field (slip ${pct(m.slipPre ?? 0)}).`,
      },
      {
        title: '2 · Ramping down: the motor brakes',
        at: (r) => {
          const a = ev(r, 'regen-start')
          const b = ev(r, 'regen-end')
          return a ? (b ? 0.5 * (a.time + b.time) : a.time) : (r.tstep ?? 0) + 0.1
        },
        window: (r) => [Math.max(0, (r.tstep ?? 0) - 0.1), tEnd(r)],
        channels: ['n', 'nsync', 'te', 'pin'],
        look: 'The field slows faster than the rotor: negative torque and negative input power.',
        body: (st) =>
          st.slip < 0
            ? `The field (${rpmTxt(st.nsync)}) now turns slower than the rotor (${rpmTxt(st.n)}): slip ${pct(st.slip)}, torque ${nm(st.te)} — the machine brakes as a generator and sends ${formatW(-st.pin)} back to the drive.`
            : `The rotor follows the falling field: ${rpmTxt(st.n)} against ${rpmTxt(st.nsync)}, torque ${nm(st.te)}.`,
      },
      {
        title: '3 · At 25 Hz',
        at: (r) => tEnd(r) - 0.5 / r.end.f,
        window: (r) => [Math.max(0, (r.tstep ?? 0) - 0.3), tEnd(r)],
        channels: ['n', 'nsync', 'irms'],
        look: 'Settled again at about half the speed; the current is back to its loaded value.',
        body: (_st, m) => `${rpmTxt(m.nEnd)} at ${m.fEnd.toFixed(0)} Hz: ${m.slipRpm.toFixed(1)} rpm behind the field (before the step: ${m.slipRpmPre === null ? '—' : `${m.slipRpmPre.toFixed(1)} rpm`}). The same torque needs about the same slip speed: the curve has moved left in parallel. Current ${formatA(m.isEnd)} RMS, about as before (${formatA(m.isPre ?? 0)}).`,
      },
      {
        title: '4 · Very low frequency needs boost',
        params: { f2: 5, boost: 0 },
        at: (r) => tEnd(r) - 0.5 / r.end.f,
        window: (r) => [Math.max(0, (r.tstep ?? 0) - 0.3), tEnd(r)],
        channels: ['n', 'nsync', 'psi'],
        look: 'Without boost the flux sags at 5 Hz and the slip grows.',
        body: (_st, m) =>
          `At ${m.fEnd.toFixed(0)} Hz with no boost the stator flux falls to ${m.psi.toFixed(3)} Wb: at low frequency the voltage lost in Rs is no longer small next to V. ${m.locked ? `The motor stalls.` : `The rotor runs ${m.slipRpm.toFixed(1)} rpm behind the field — slip ${pct(m.slip, 1)}.`} Boost (extra voltage at low frequency) restores the flux.`,
      },
    ],
  },
]

// ── experiments ─────────────────────────────────────────────────────────────

type E = Experiment<InductionParams, InductionMeasurements>
export const INDUCTION_EXPERIMENTS: E[] = [
  {
    id: 'load',
    title: 'Double the load torque',
    change: (p) => ({ tl: Math.max(5, 2 * p.tl) }),
    question: (p) => `The load torque goes from ${nm(p.tl)} to ${nm(Math.max(5, 2 * p.tl))}. What happens?`,
    choices: ['The slip about doubles; the speed drops only a few percent', 'The speed halves', 'Nothing changes'],
    judge: (b, a) => (a.locked ? 1 : a.slip / Math.max(b.slip, 1e-9) > 1.5 && a.nEnd / b.nEnd > 0.9 ? 0 : a.nEnd / b.nEnd < 0.6 ? 1 : 2),
    rows: ['nEnd', 'slip', 'isEnd', 'eff'],
    why: (b, a) => `Slip ${pct(b.slip)} → ${pct(a.slip)} (×${(a.slip / Math.max(b.slip, 1e-9)).toFixed(2)}), speed ${rpmTxt(b.nEnd)} → ${rpmTxt(a.nEnd)}, current ${formatA(b.isEnd)} → ${formatA(a.isEnd)}. At small slip the torque is almost proportional to the slip, so twice the torque needs about twice the slip — still only a few percent of the speed.`,
  },
  {
    id: 'vf',
    title: 'Start with a V/f ramp',
    change: (p) => (p.supply === 'vf' ? { supply: 'dol' } : { supply: 'vf', f: p.fr }),
    question: (p) => (p.supply === 'vf' ? 'The motor is switched straight onto the mains instead of being ramped. What happens to the peak starting current?' : 'Instead of switching the motor straight onto the mains, a V/f drive ramps it up to the same frequency. What happens to the peak starting current?'),
    choices: ['It falls several-fold; the final speed is the same', 'It rises', 'It stays the same'],
    judge: (b, a) => (Math.min(a.iPeak, b.iPeak) < 0.5 * Math.max(a.iPeak, b.iPeak) && Math.abs(a.nEnd - b.nEnd) < 0.005 * Math.max(b.nEnd, 1) ? (a.iPeak < b.iPeak ? 0 : 1) : a.iPeak > b.iPeak ? 1 : 2),
    rows: ['iPeak', 'ecuRStart', 'nEnd', 'tStart'],
    why: (b, a) => `Peak starting current ${formatA(b.iPeak)} → ${formatA(a.iPeak)}; rotor heat during the start ${formatSI(b.ecuRStart, 'J')} → ${formatSI(a.ecuRStart, 'J')}; final speed ${rpmTxt(b.nEnd)} → ${rpmTxt(a.nEnd)}. Ramped, the rotor follows the field closely: the slip frequency stays small, and so do the rotor EMF and the current. The price: a slower start (${a.tStart === null ? '—' : formatTime(a.tStart)} instead of ${b.tStart === null ? '—' : formatTime(b.tStart)} to 95 % speed).`,
  },
  {
    id: 'rr',
    title: 'Double the rotor resistance',
    change: (p) => ({ rr: 2 * p.rr }),
    question: () => 'The cage bars are made of a material with twice the resistance. What happens at the same load?',
    choices: ['The slip about doubles and the efficiency falls', 'The slip halves', 'Nothing changes'],
    judge: (b, a) => (a.slip / Math.max(b.slip, 1e-9) > 1.6 ? 0 : a.slip / Math.max(b.slip, 1e-9) < 0.7 ? 1 : 2),
    rows: ['slip', 'nEnd', 'eff', 'pcuR', 'tStart'],
    why: (b, a) => `Slip ${pct(b.slip)} → ${pct(a.slip)}, efficiency ${b.eff === null ? '—' : pct(b.eff, 1)} → ${a.eff === null ? '—' : pct(a.eff, 1)}, rotor loss ${formatW(b.pcuR)} → ${formatW(a.pcuR)}. The torque depends on Rr/s: the same torque needs the same Rr/s, so the slip doubles — and the rotor loss s·Pag doubles with it. The upside: more torque at standstill (start ${b.tStart === null ? '—' : formatTime(b.tStart)} → ${a.tStart === null ? '—' : formatTime(a.tStart)}).`,
  },
  {
    id: 'freq',
    title: 'Run it at half frequency',
    change: (p) => ({ supply: 'vf', f: p.fr / 2 }),
    question: (p) => `A V/f drive feeds the motor at ${(p.fr / 2).toFixed(0)} Hz instead of ${p.fr.toFixed(0)} Hz. What happens to the speed?`,
    choices: ['It about halves', 'It stays the same', 'It doubles'],
    judge: (b, a) => (a.nEnd / b.nEnd > 0.35 && a.nEnd / b.nEnd < 0.65 ? 0 : a.nEnd / b.nEnd < 1.3 ? 1 : 2),
    rows: ['nEnd', 'nsync', 'slipRpm', 'isEnd'],
    why: (b, a) => `Speed ${rpmTxt(b.nEnd)} → ${rpmTxt(a.nEnd)}; synchronous speed ${rpmTxt(b.nsync)} → ${rpmTxt(a.nsync)}; slip speed ${b.slipRpm.toFixed(1)} → ${a.slipRpm.toFixed(1)} rpm. The field speed is 120·f/P: half the frequency, half the field speed. V/f keeps the flux, so the same torque needs about the same slip speed and the same current.`,
  },
  {
    id: 'overload',
    title: 'Load it above the breakdown torque',
    change: () => ({ tl: 100 }),
    question: () => 'The load torque is set to 100 N·m — more than this motor\'s breakdown torque. What happens when it is switched on?',
    choices: ['It cannot run: the rotor ends up locked and draws the locked-rotor current', 'It runs, only slower', 'It runs at the same speed'],
    judge: (_b, a) => (a.locked ? 0 : a.nEnd < 0.9 * a.nsync ? 1 : 2),
    rows: ['outcome', 'nEnd', 'isEnd', 'pin'],
    why: (b, a) =>
      a.locked
        ? `The rotor ${a.neverStarted ? 'never turns' : 'is kicked by the switch-on torque but stalls'}: ${rpmTxt(a.nEnd)}, ${formatA(a.isEnd)} RMS instead of ${formatA(b.isEnd)}, ${formatW(a.pin)} all turned into heat. No speed gives this much torque, so there is no operating point.`
        : `It still runs: ${rpmTxt(a.nEnd)}, slip ${pct(a.slip)}.`,
  },
]

// ── predictions ─────────────────────────────────────────────────────────────

export function inductionPredictions(seed: number): Array<PredictTask<InductionParams, InductionMeasurements>> {
  const f = [40, 30, 60][seed % 3]
  const tl2 = [25, 30, 20][(seed + 1) % 3]
  const tlStart = [70, 40, 75][(seed + 2) % 3]
  const f25 = [25, 35, 20][seed % 3]
  // the reference values quoted in the questions come from the simulation itself (or the labelled THEORY)
  const ref = measureInduction(simulateInduction({ ...INDUCTION_DEFAULTS, supply: 'dol', tl: 10 }))
  const at50 = measureInduction(simulateInduction({ ...INDUCTION_DEFAULTS, supply: 'vf', f: 50 }))
  const tStart = (q: Partial<InductionParams>) => inductionTheory(resolveInduction({ ...INDUCTION_DEFAULTS, ...q, supply: 'dol' }).params).lockedRotor.te
  return [
    {
      id: 'nsync',
      prompt: `A ${2 * INDUCTION_DEFAULTS.pp}-pole motor (P = ${2 * INDUCTION_DEFAULTS.pp}) runs with no load from a V/f drive at ${f} Hz. Predict its speed.`,
      params: { supply: 'vf', f, tl: 0, event: 'none' },
      kind: 'number',
      unit: 'rpm',
      answer: (m) => m.nEnd,
      tolerance: 0.01,
      hint: 'With no load the rotor runs almost at the synchronous speed ns = 120·f/P.',
      theory: (p) => `ns = 120·f/P = 120·${p.f}/${2 * (p.pp ?? 2)} = ${syncRpm(p.f, p.pp ?? 2).toFixed(0)} rpm; friction needs a tiny slip, so the speed is a hair below.`,
    },
    {
      id: 'slip',
      prompt: `Direct on line at ${nm(10)} the slip is ${pct(ref.slip)} (SIMULATION). Predict the slip at ${nm(tl2)}.`,
      params: { supply: 'dol', tl: tl2, event: 'none' },
      kind: 'number',
      unit: '%',
      answer: (m) => m.slip * 100,
      tolerance: 0.1,
      hint: 'Far below the breakdown torque the torque is almost proportional to the slip.',
      theory: (p) => `s ≈ ${pct(ref.slip)} × ${p.tl}/10 = ${pct((ref.slip * p.tl) / 10)} (the curve bends a little: the real value is slightly larger).`,
    },
    {
      id: 'start',
      prompt: `The motor is switched direct on line against a constant ${nm(tlStart)} load. Its steady starting torque (equivalent circuit at standstill, s = 1) is ${nm(tStart({}))}. Does it run up?`,
      params: { supply: 'dol', tl: tlStart, event: 'none' },
      kind: 'choice',
      choices: ['Yes: it runs up and settles', 'No: the rotor ends up locked'],
      answer: (m) => (m.locked ? 1 : 0),
      hint: 'The rotor can only accelerate where the motor torque exceeds the load torque — at standstill too.',
      theory: (p) => `Starting torque (equivalent circuit, s = 1) = ${nm(tStart(p))} ${p.tl > tStart(p) ? '<' : '>'} ${nm(p.tl)}: ${p.tl > tStart(p) ? 'the motor cannot accelerate the load from rest (the switch-on pulsations may jolt it, but it stalls again)' : 'it accelerates and settles on the stable part of the curve'}.`,
    },
    {
      id: 'speed',
      prompt: `A V/f drive runs the loaded motor (${nm(15)}) at ${f25} Hz. At 50 Hz it runs at ${rpmTxt(at50.nEnd)} (SIMULATION). Predict the speed at ${f25} Hz.`,
      params: { supply: 'vf', f: f25, tl: 15, event: 'none' },
      kind: 'number',
      unit: 'rpm',
      answer: (m) => m.nEnd,
      tolerance: 0.03,
      hint: 'V/f keeps the flux: the same torque needs about the same slip SPEED (ns − n), not the same slip.',
      theory: (p) => `ns = ${syncRpm(p.f, p.pp ?? 2).toFixed(0)} rpm; minus the same slip speed as at 50 Hz (≈ ${at50.slipRpm.toFixed(1)} rpm): about ${(syncRpm(p.f, p.pp ?? 2) - at50.slipRpm).toFixed(0)} rpm.`,
    },
  ]
}

export { simulateInduction }
