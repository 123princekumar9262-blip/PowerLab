import { fx } from '../../ui/format.ts'
import {
  LCC0,
  pvCurve,
  solveBus,
  solveLcc,
  solveVsc,
  VSC0,
  WEAK0,
  type BusOutcome,
  type LccLink,
  type LccOutcome,
  type PvCurve,
  type Support,
  type VscLink,
  type VscOutcome,
  type WeakBus,
} from './calc.ts'

/* The module's state (what Explore edits and Verify reads), its computation and computed wording — no React. */

export const MODULE = 'hvdc-facts'
export const PE_LINKS = {
  rectifiers: '#/labs/rectifiers',
  inverters: '#/labs/inverters',
  pwm: '#/labs/pwm',
}

// ── the state Explore edits (Verify reads it too) ─────────────────────────────────────────────────────────────

export type View = 'lcc' | 'vsc' | 'comp' | 'weak'
export const VIEW_LABEL: Record<View, string> = { lcc: 'LCC link', vsc: 'VSC link', comp: 'Compensation', weak: 'Weak bus' }

export interface LccUi {
  ctrl: 'power' | 'alpha'
  pMw: number
  alphaDeg: number
  /** Rectifier AC voltage as a fraction of nominal. */
  acPu: number
  gammaDeg: number
  marginKa: number
  xc: number
  rdc: number
  alphaMinDeg: number
}
export const LCC_UI0: LccUi = { ctrl: 'power', pMw: 1000, alphaDeg: 16, acPu: 1, gammaDeg: LCC0.gammaDeg, marginKa: LCC0.marginKa, xc: LCC0.xc, rdc: LCC0.rdc, alphaMinDeg: LCC0.alphaMinDeg }
export function lccLinkOf(u: LccUi): LccLink {
  return {
    ...LCC0,
    vllR: LCC0.vllR * u.acPu,
    xc: u.xc,
    rdc: u.rdc,
    alphaMinDeg: u.alphaMinDeg,
    gammaDeg: u.gammaDeg,
    marginKa: u.marginKa,
    control: u.ctrl === 'power' ? { kind: 'power', pMw: u.pMw } : { kind: 'alpha', alphaDeg: u.alphaDeg },
  }
}

export interface CompUi {
  /** Voltage at both ends [pu]. */
  v: number
  /** Line reactance [pu]. */
  x: number
  /** Series compensation degree k (fraction of X cancelled). */
  k: number
  /** Power to transfer [pu]. */
  p: number
}
export const COMP0: CompUi = { v: 1, x: 0.5, k: 0.4, p: 1.5 }

export interface WeakUi extends WeakBus {
  support: Support
}
export const WEAK_UI0: WeakUi = { ...WEAK0, support: 'statcom' }

export interface HfState {
  view: View
  /** The link drawn in the 3D scene (the last link view opened). */
  linkKind: 'lcc' | 'vsc'
  lcc: LccUi
  vsc: VscLink
  comp: CompUi
  weak: WeakUi
}
export const STATE0: HfState = { view: 'lcc', linkKind: 'lcc', lcc: LCC_UI0, vsc: VSC0, comp: COMP0, weak: WEAK_UI0 }

export interface Computed {
  link: LccLink
  lcc: LccOutcome
  vsc: VscOutcome
  bus: BusOutcome
  curves: Record<Support, PvCurve | null>
  /** The collapse load of the support in use (null when the inputs are invalid). */
  nose: number | null
}
export function compute(s: HfState): Computed {
  const link = lccLinkOf(s.lcc)
  const w = s.weak
  const curves = { none: null, svc: null, statcom: null } as Record<Support, PvCurve | null>
  for (const k of ['none', 'svc', 'statcom'] as Support[]) {
    const c = pvCurve(w, k)
    curves[k] = c.ok ? c : null
  }
  return { link, lcc: solveLcc(link), vsc: solveVsc(s.vsc), bus: solveBus(w, w.support), curves, nose: curves[w.support]?.nose.p ?? null }
}

// ── words computed from numbers ───────────────────────────────────────────────────────────────────────────────

/** The bus voltage in words, against nominal, with the number. */
export function voltageWords(v: number): string {
  const d = (v - 1) * 100
  if (Math.abs(d) < 0.05) return 'at nominal (1.000 pu)'
  return `${fx(Math.abs(d), 1)} % ${d < 0 ? 'below' : 'above'} nominal`
}
/** How far a load is from the collapse point, in words. */
export function marginWords(p: number, nose: number): string {
  const m = ((nose - p) / nose) * 100
  if (m < 0) return 'beyond the collapse point'
  if (m < 0.5) return 'at the collapse point'
  return `${fx(m, 0)} % below the collapse load (${fx(nose, 3)} pu)`
}
/** A compared size: "×1.43 (43 % more)". */
export function times(a: number, b: number): string {
  const r = a / b
  if (!Number.isFinite(r)) return '—'
  const pc = Math.abs(r - 1) * 100
  if (pc < 0.5) return 'the same'
  return `×${fx(r, 2)} (${fx(pc, 0)} % ${r > 1 ? 'more' : 'less'})`
}
