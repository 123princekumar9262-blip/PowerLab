import { fx } from '../../ui/format.ts'
import { angleFor, LCC_MODE_TEXT, pMaxMidShunt, pMaxSeries, SUPPORT_LABEL, V_REF, xTh, type LccResult } from './calc.ts'
import type { Computed, HfState, View } from './state.ts'

/*
 * Every sentence that describes a state or a change, built from the computed state (no React; unit-tested per mode).
 */

export interface Note {
  what: string
  why: string
  rows: Array<{ label: string; before: number | null; after: number | null; unit: string; d: number }>
}

/** Who holds what in the LCC link now — from the solved control mode and its numbers. */
export function modeSentence(L: LccResult): string {
  switch (L.mode) {
    case 'normal':
      return `The rectifier’s current controller holds I_d = ${fx(L.id, 3)} kA by setting α = ${fx(L.alphaDeg, 2)}°; the inverter holds γ = γ₀ = ${fx(L.gammaDeg, 1)}°.`
    case 'manual':
      return `α is set by hand at ${fx(L.alphaDeg, 2)}° and the inverter holds γ = ${fx(L.gammaDeg, 1)}°; no controller holds the current — I_d = ${fx(L.id, 3)} kA is where the two lines cross.`
    case 'shift':
      return `The rectifier is at α_min = ${fx(L.alphaDeg, 2)}°; the inverter controls the current at I_order − ΔI = ${fx(L.id, 3)} kA by raising γ to ${fx(L.gammaDeg, 2)}°.`
    case 'limits':
      return `Both converters are at their angle limits (α_min = ${fx(L.alphaDeg, 2)}°, γ₀ = ${fx(L.gammaDeg, 1)}°): no controller holds the current — I_d = ${fx(L.id, 3)} kA is where those two lines cross.`
  }
}

/** The inverter's role, for the 3D tour. */
export function inverterRole(L: LccResult): string {
  switch (L.mode) {
    case 'normal':
    case 'manual':
      return `The inverter holds its extinction angle γ = ${fx(L.gammaDeg, 1)}°`
    case 'shift':
      return `In this mode shift the inverter controls the current (I_d = ${fx(L.id, 3)} kA, γ raised to ${fx(L.gammaDeg, 2)}°)`
    case 'limits':
      return `The inverter is at γ₀ = ${fx(L.gammaDeg, 1)}° and the rectifier at α_min — neither controls the current`
  }
}

/** Active and reactive power exchanged with a grid, in words (P, Q given as delivered TO the grid). */
export function pWords(pMw: number, grid: string): string {
  if (Math.abs(pMw) < 0.5) return `exchanges no active power with ${grid}`
  return pMw < 0 ? `takes ${fx(-pMw, 0)} MW from ${grid}` : `delivers ${fx(pMw, 0)} MW to ${grid}`
}
export function qWords(qMvar: number, grid: string): string {
  if (Math.abs(qMvar) < 0.5) return `exchanges no reactive power with ${grid}`
  return qMvar < 0 ? `absorbs ${fx(-qMvar, 0)} Mvar from ${grid}` : `supplies ${fx(qMvar, 0)} Mvar to ${grid}`
}

const arrow = (a: number, b: number, d: number) => (Math.abs(a - b) < 0.5 * 10 ** -d ? `${fx(b, d)} (unchanged)` : `${fx(a, d)} → ${fx(b, d)}`)
/** The LCC quantities before → after. */
export function lccDelta(a: LccResult, b: LccResult): string {
  return `I_d ${arrow(a.id, b.id, 3)} kA, α ${arrow(a.alphaDeg, b.alphaDeg, 2)}°, γ ${arrow(a.gammaDeg, b.gammaDeg, 2)}°, V_dr ${arrow(a.vdr, b.vdr, 1)} kV, V_di ${arrow(a.vdi, b.vdi, 1)} kV`
}

/** The quantities a view reports when something changes. */
export function keyRows(view: View, c: Computed, s: HfState): Array<{ label: string; v: number | null; unit: string; d: number }> {
  if (view === 'lcc') {
    const L = c.lcc.ok ? c.lcc : null
    return [
      { label: 'I_d', v: L?.id ?? null, unit: 'kA', d: 3 },
      { label: 'α', v: L?.alphaDeg ?? null, unit: '°', d: 2 },
      { label: 'V_dr', v: L?.vdr ?? null, unit: 'kV', d: 1 },
      { label: 'P sent', v: L?.pr ?? null, unit: 'MW', d: 0 },
      { label: 'Q rectifier', v: L?.qr ?? null, unit: 'Mvar', d: 0 },
    ]
  }
  if (view === 'vsc') {
    const V = c.vsc.ok ? c.vsc : null
    return [
      { label: 'P received', v: V ? V.pDc2Mw : null, unit: 'MW', d: 0 },
      { label: 'V_c1', v: V?.st1.vc ?? null, unit: 'pu', d: 3 },
      { label: 'δ₁', v: V?.st1.deltaDeg ?? null, unit: '°', d: 2 },
      { label: 'V_c2', v: V?.st2.vc ?? null, unit: 'pu', d: 3 },
      { label: 'δ₂', v: V?.st2.deltaDeg ?? null, unit: '°', d: 2 },
    ]
  }
  if (view === 'comp') {
    const k = s.comp
    return [
      { label: 'P_max uncompensated', v: pMaxSeries(k.v, k.v, k.x, 0), unit: 'pu', d: 3 },
      { label: 'P_max series', v: pMaxSeries(k.v, k.v, k.x, k.k), unit: 'pu', d: 3 },
      { label: 'P_max midpoint shunt', v: pMaxMidShunt(k.v, k.x), unit: 'pu', d: 3 },
      { label: 'δ with series', v: angleFor(k.p, pMaxSeries(k.v, k.v, k.x, k.k), false), unit: '°', d: 1 },
    ]
  }
  const b = c.bus.ok ? c.bus : null
  return [
    { label: 'Bus voltage', v: b?.v ?? null, unit: 'pu', d: 3 },
    { label: 'Q_c', v: b ? b.qc : null, unit: 'pu', d: 3 },
    { label: 'Collapse load', v: c.nose, unit: 'pu', d: 3 },
  ]
}

/** Why the results moved, from the computed before and after and the actual control mode (never fixed text). */
export function whyFor(key: string, s0: HfState, s1: HfState, c0: Computed, c1: Computed): string {
  const L0 = c0.lcc.ok ? c0.lcc : null
  const L1 = c1.lcc.ok ? c1.lcc : null
  if (key.startsWith('lcc')) {
    if (!L1) return 'The link has no operating point now — see the message.'
    if (!L0) return `The link has an operating point again. ${modeSentence(L1)}`
    if (L1.mode !== L0.mode) return `The control mode changed: ${LCC_MODE_TEXT[L1.mode].toLowerCase()}. ${modeSentence(L1)}`
    const delta = lccDelta(L0, L1)
    if (key === 'lcc-p') {
      if (L1.mode === 'normal')
        return `The rectifier’s current controller follows the order: I_d ${fx(L0.id, 3)} → ${fx(L1.id, 3)} kA. The inverter holds γ, so V_dr moved only ${fx(Math.abs(L1.vdr - L0.vdr), 1)} kV. With the current, the overlap μ_r went ${fx(L0.muRDeg, 2)}° → ${fx(L1.muRDeg, 2)}° and the rectifier’s Q ${fx(L0.qr, 0)} → ${fx(L1.qr, 0)} Mvar.`
      return `${modeSentence(L1)}${L1.pOrder !== null ? ` The power order (${fx(L1.pOrder, 0)} MW) is not met: P_dr = ${fx(L1.pr, 0)} MW.` : ''}`
    }
    if (key === 'lcc-ac') {
      if (L1.mode === 'normal') {
        const w = L1.alphaDeg > L0.alphaDeg + 1e-6 ? 'raises' : L1.alphaDeg < L0.alphaDeg - 1e-6 ? 'lowers' : 'keeps'
        return `The current controller holds I_d = ${fx(L1.id, 3)} kA, so it ${w} α (${fx(L0.alphaDeg, 2)}° → ${fx(L1.alphaDeg, 2)}°) to keep V_dr on the inverter’s line. ${
          L1.qr > L0.qr + 0.5
            ? `A larger α means a worse power factor: Q rises ${fx(L1.qr - L0.qr, 0)} Mvar.`
            : L1.qr < L0.qr - 0.5
              ? `A smaller α means a better power factor: Q falls ${fx(L0.qr - L1.qr, 0)} Mvar.`
              : 'Q changes by less than 1 Mvar.'
        }`
      }
      if (L1.mode === 'manual')
        return `With α fixed by hand at ${fx(L1.alphaDeg, 2)}°, the rectifier’s no-load voltage V_d0r ${fx(L0.vd0r, 1)} → ${fx(L1.vd0r, 1)} kV moves its whole line, so the crossing moves: I_d ${fx(L0.id, 3)} → ${fx(L1.id, 3)} kA.`
      return `${modeSentence(L1)} ${delta}.`
    }
    if (key === 'lcc-alpha')
      return `With α set by hand, I_d = (V_d0r·cos α − V_d0i·cos γ₀)/(R_dc + R_cr − R_ci): a change of ${fx(L1.alphaDeg - L0.alphaDeg, 1)}° moved I_d by ${fx(L1.id - L0.id, 3)} kA. That sensitivity is why a current controller sets α.`
    if (key === 'lcc-gamma') {
      const c0g = L0.vd0i * Math.cos((s0.lcc.gammaDeg * Math.PI) / 180)
      const c1g = L1.vd0i * Math.cos((s1.lcc.gammaDeg * Math.PI) / 180)
      return `γ₀ ${fx(s0.lcc.gammaDeg, 1)}° → ${fx(s1.lcc.gammaDeg, 1)}° moves the inverter’s CEA line: V_d0i·cos γ₀ ${fx(c0g, 1)} → ${fx(c1g, 1)} kV. ${delta}; the inverter’s Q ${fx(L0.qi, 0)} → ${fx(L1.qi, 0)} Mvar.`
    }
    if (key === 'lcc-xc') return `X_c sets both the overlap (cos(α+μ) = cos α − √2·X_c·I_d/V_LL) and the voltage drop (3/π)X_c·I_d: μ_r ${fx(L0.muRDeg, 2)}° → ${fx(L1.muRDeg, 2)}°. ${delta}.`
    if (key === 'lcc-rdc') return `The line loss I²R went ${fx(L0.loss, 1)} → ${fx(L1.loss, 1)} MW. ${delta}. ${modeSentence(L1)}`
    return `${modeSentence(L1)} ${delta}.`
  }
  if (key.startsWith('vsc')) {
    const V0 = c0.vsc.ok ? c0.vsc : null
    const V1 = c1.vsc.ok ? c1.vsc : null
    if (!V1) return 'This order is outside a converter’s capability — see the message.'
    if (!V0) return 'The order is back inside both converters’ capability.'
    if (key === 'vsc-q1' || key === 'vsc-q2') {
      const k = key === 'vsc-q1' ? 1 : 2
      const a = k === 1 ? V0.st1 : V0.st2
      const b = k === 1 ? V1.st1 : V1.st2
      return `Q is set mainly by the size of V_c: V_c${k} ${fx(a.vc, 3)} → ${fx(b.vc, 3)} pu; the active power ${Math.abs(V0.pDc2Mw - V1.pDc2Mw) < 0.5 ? `did not change (${fx(V1.pDc2Mw, 0)} MW)` : `${fx(V0.pDc2Mw, 0)} → ${fx(V1.pDc2Mw, 0)} MW`}.`
    }
    if (key === 'vsc-p') return `P is set by the angle of V_c: δ₁ ${fx(V0.st1.deltaDeg, 2)}° → ${fx(V1.st1.deltaDeg, 2)}°. Each station’s Q stayed at its own order.`
    return 'The converters re-solved their voltages for the same orders.'
  }
  if (key.startsWith('comp')) {
    const a = s0.comp
    const b = s1.comp
    if (key === 'comp-k')
      return `X_eff = X(1 − k): ${fx(a.x * (1 - a.k), 3)} → ${fx(b.x * (1 - b.k), 3)} pu, so the series P_max = V²/X_eff went ${fx(pMaxSeries(a.v, a.v, a.x, a.k), 3)} → ${fx(pMaxSeries(b.v, b.v, b.x, b.k), 3)} pu.`
    if (key === 'comp-p') return 'The curves did not move; the operating angles slid along them to carry the new power.'
    return `Every curve scales with V²/X: uncompensated P_max ${fx(pMaxSeries(a.v, a.v, a.x, 0), 3)} → ${fx(pMaxSeries(b.v, b.v, b.x, 0), 3)} pu.`
  }
  const b0 = c0.bus.ok ? c0.bus : null
  const b1 = c1.bus.ok ? c1.bus : null
  if (!b1) return 'Beyond the collapse point there is no power-flow solution.'
  if (key === 'weak-support')
    return `With ${SUPPORT_LABEL[s1.weak.support]}: V = ${fx(b1.v, 3)} pu${b0 ? ` (was ${fx(b0.v, 3)})` : ''}, collapse load ${c1.nose !== null ? fx(c1.nose, 3) : '—'} pu${c0.nose !== null ? ` (was ${fx(c0.nose, 3)})` : ''}.`
  if (key === 'weak-scr')
    return `X = 1/SCR: ${fx(xTh(s0.weak.scr), 3)} → ${fx(xTh(s1.weak.scr), 3)} pu. The collapse load ${c0.nose !== null && c1.nose !== null ? `${fx(c0.nose, 3)} → ${fx(c1.nose, 3)} pu` : 'changed'}.`
  if (key === 'weak-p')
    return b1.state === 'regulating'
      ? `The compensator holds ${fx(V_REF, 2)} pu by supplying the Q the load and the line need: ${b0 ? `${fx(b0.qc, 3)} → ` : ''}${fx(b1.qc, 3)} pu of its ${fx(s1.weak.rating, 2)} pu.`
      : b1.state === 'at-limit'
        ? `The compensator is at its limit, so the voltage moves with the load: ${b0 ? `${fx(b0.v, 3)} → ` : ''}${fx(b1.v, 3)} pu.`
        : `The load’s current flows through X = ${fx(xTh(s1.weak.scr), 3)} pu: the bus voltage ${b0 ? `${fx(b0.v, 3)} → ` : ''}${fx(b1.v, 3)} pu.`
  return 'The bus re-solved for the new data.'
}
