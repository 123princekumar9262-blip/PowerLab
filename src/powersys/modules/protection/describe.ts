import { abs, add, div, mul, scale, sub, ZERO, type Complex } from '../../engine/complex.ts'
import { toPhase } from '../faults/sequence.ts'
import { fx } from '../../ui/format.ts'
import { I_MIN_A, IB_KA, K0, L1_KM, L3_KM, LOOP_LABEL, LOOP_OF, loopAmps, loopVI, Z1L, Z1L3, ZB, type DistanceCase, type RouteFault, type ZoneSettings } from './distance.ts'
import type { DistState } from './state.ts'
import { amps, timesWords, zRect } from './words.ts'

/*
 * Why Z_app is what it is, and what changed — every cause named in the text is a computed term.
 *
 * KVL from A to the fault (each segment carries its own current; the line's own drop always uses its true k₀):
 *   V_loop = Z_L1,part·I_A,true + Z_L3,part·I_L3,true + V_F,loop
 * and the relay divides by its loop current I_loop (with its k₀ setting). Splitting the quotient exactly:
 *   Z_app = line + k₀-error + infeed + R_f-term
 *   line      = Z_L1,part + Z_L3,part                         (the line impedance to the fault, m·Z₁L)
 *   k₀-error  = line·(I_A,true/I_loop − 1)                    (zero when the relay's k₀ is the line's)
 *   infeed    = Z_L3,part·(I_L3,true − I_A,true)/I_loop       (current added at B for a fault beyond B)
 *   R_f-term  = V_F,loop/I_loop                               (the fault-point voltage, R_f × a current ratio)
 */

export type Cause = 'line' | 'k0' | 'infeed' | 'rf'
export const CAUSE_NAME: Record<Cause, string> = {
  line: 'the line impedance to the fault',
  k0: 'the error of an uncompensated earth loop',
  infeed: 'the infeed at B (current that enters L3 at B without passing A)',
  rf: 'the fault-resistance term',
}

export interface ZappParts {
  total: Complex
  line: Complex
  k0: Complex
  infeed: Complex
  rf: Complex
  /** The faulted phase's fault current, the relay's phase current and loop current, and the fault current that does not pass the relay [A]. */
  iFaultA: number
  iPhaseA: number
  iLoopA: number
  iOtherA: number
}

export function decomposeZapp(f: RouteFault, zones: ZoneSettings): ZappParts | null {
  const loop = LOOP_OF[f.spec.type]
  const v = f.relays.RA
  const iL = loopVI(loop, v.vabc, v.iabc, zones.k0On ? K0 : ZERO).i
  if (loopAmps(iL) < I_MIN_A) return null
  const iT = loopVI(loop, v.vabc, v.iabc, K0).i
  const km = Math.min(Math.max(f.spec.km, 0), L1_KM + L3_KM)
  const zL1 = scale(Z1L, Math.min(km, L1_KM) / L1_KM)
  const zL3 = km > L1_KM ? scale(Z1L3, (km - L1_KM) / L3_KM) : ZERO
  let iSeg = iT
  if (km > L1_KM) {
    const seg = f.result.branches.find((b) => b.id === 'L3a') ?? f.result.branches.find((b) => b.id === 'L3')!
    iSeg = loopVI(loop, v.vabc, toPhase(seg.i012From), K0).i
  }
  const vf = f.result.point.vabc
  const vF = loop.endsWith('E') ? vf[0] : sub(vf[1], vf[2])
  const line = add(zL1, zL3)
  const k0 = mul(line, sub(div(iT, iL), { re: 1, im: 0 }))
  const infeed = div(mul(zL3, sub(iSeg, iT)), iL)
  const rf = scale(div(vF, iL), ZB)
  const p = loop.endsWith('E') ? 0 : 1
  const iFp = f.result.point.iabc[p]
  const iRp = v.iabc[p]
  return {
    total: add(add(line, k0), add(infeed, rf)),
    line,
    k0,
    infeed,
    rf,
    iFaultA: abs(iFp) * IB_KA * 1000,
    iPhaseA: abs(iRp) * IB_KA * 1000,
    iLoopA: loopAmps(iL),
    iOtherA: abs(sub(iFp, iRp)) * IB_KA * 1000,
  }
}

/** A term counts as a cause when it is at least 0.01 Ω and 0.2 % of |Z_app|. */
export const significant = (z: Complex, total: Complex) => abs(z) >= Math.max(0.01, 0.002 * abs(total))

/** The causes present in Z_app (the line itself always, when the fault is not at A). */
export function causes(p: ZappParts): Cause[] {
  return (['line', 'k0', 'infeed', 'rf'] as Cause[]).filter((c) => significant(p[c], p.total))
}

/** "line 34.83 Ω; R_f term 9.48 + j0.04 Ω" — only the causes present. */
export function partsText(p: ZappParts): string {
  const cs = causes(p)
  if (!cs.length) return 'zero (a fault at the relay)'
  return cs
    .map((c) =>
      c === 'line'
        ? `line to the fault ${zRect(p.line)}`
        : c === 'k0'
          ? `uncompensated-earth-loop error ${zRect(p.k0)}`
          : c === 'infeed'
            ? `infeed at B ${zRect(p.infeed)}`
            : `R_f term ${zRect(p.rf)}`,
    )
    .join(' + ')
}

/** Why the R_f term has the size it has (computed from the currents). */
function rfWhy(p: ZappParts, rfOhm: number): string {
  const ratio = abs(p.rf) / rfOhm
  const base = `R_f × ${fx(ratio, 3)}: the drop across R_f is driven by the fault current (${amps(p.iFaultA)}) but the relay divides by its loop current (${amps(p.iLoopA)})`
  if (Math.abs(ratio - 1) < 0.01) return `${base} — the two are equal here, so the term is R_f itself`
  if (p.iFaultA > p.iLoopA) return `${base}; ${amps(p.iOtherA)} of the fault current reaches the fault without passing the relay at A, so R_f looks ${timesWords(ratio)} as large`
  return `${base}; the loop current is the larger${p.iLoopA > p.iPhaseA * 1.001 ? ' (the earth loop adds k₀·3I₀ to the phase current)' : ''}, so R_f looks ${timesWords(ratio)} as large`
}

const pName = (cs: Cause[]) => cs.filter((c) => c !== 'line').map((c) => CAUSE_NAME[c])

/** What changed between two states, and why the result moved — every named cause is a computed, non-negligible term. */
export function describeChange(a: DistState, b: DistState, ca: DistanceCase | null, cb: DistanceCase | null): { what: string; why: string; causes: Cause[] } | null {
  const pa = ca ? decomposeZapp(ca.fault, a.zones) : null
  const pb = cb ? decomposeZapp(cb.fault, b.zones) : null
  const cs = pb ? causes(pb) : []
  const extra = pName(cs)
  const now = pb ? `Z_app = ${partsText(pb)}${extra.length ? '' : ' — exactly m·Z₁L'}.` : 'The relay cannot measure: too little current.'
  const out = (what: string, why: string) => ({ what, why, causes: cs })
  if (a.spec.km !== b.spec.km) {
    const what = `Fault moved ${fx(a.spec.km, 1)} → ${fx(b.spec.km, 1)} km`
    if (!pa || !pb || a.spec.km === 0) return out(what, `The relay measures V/I at A: the further away the fault, the more line impedance between them. ${now}`)
    const rz = abs(pb.total) / abs(pa.total)
    const rd = b.spec.km / a.spec.km
    return out(
      what,
      Math.abs(rz - rd) < 1e-6 * rd
        ? `|Z_app| ${fx(abs(pa.total), 2)} → ${fx(abs(pb.total), 2)} Ω: ${timesWords(rz)}, exactly the distance ratio (${fx(rd, 3)}). ${now}`
        : `|Z_app| ${fx(abs(pa.total), 2)} → ${fx(abs(pb.total), 2)} Ω (${fx(rz, 3)}×) while the distance changed ${fx(rd, 3)}×: besides the line, Z_app contains ${extra.join(' and ') || 'nothing else'}. ${now}`,
    )
  }
  if (a.spec.type !== b.spec.type)
    return out(
      `Fault type → ${b.spec.type === '3ph' ? 'three-phase' : b.spec.type === 'slg' ? 'line-to-ground' : b.spec.type === 'll' ? 'line-to-line' : 'double line-to-ground'}`,
      `The relay now uses its ${LOOP_LABEL[LOOP_OF[b.spec.type]]} loop. ${now}`,
    )
  if (a.spec.rfOhm !== b.spec.rfOhm) {
    const what = `Fault resistance ${fx(a.spec.rfOhm, 1)} → ${fx(b.spec.rfOhm, 1)} Ω`
    if (!pb) return out(what, now)
    if (!cs.includes('rf')) return out(what, `${b.spec.rfOhm === 0 ? 'Bolted: the R_f term is zero.' : `The R_f term is negligible for this loop (${zRect(pb.rf)}).`} ${now}`)
    return out(what, `The R_f term ${pa ? `${zRect(pa.rf)} → ` : ''}${zRect(pb.rf)} = ${rfWhy(pb, b.spec.rfOhm)}. ${now}`)
  }
  if (a.opts.infeed !== b.opts.infeed || a.opts.sscMva !== b.opts.sscMva || a.opts.deltaDeg !== b.opts.deltaDeg) {
    const what =
      a.opts.infeed !== b.opts.infeed
        ? b.opts.infeed
          ? 'Remote infeed at B switched on'
          : 'Remote infeed switched off'
        : a.opts.sscMva !== b.opts.sscMva
          ? `Remote fault level ${a.opts.sscMva} → ${b.opts.sscMva} MVA`
          : `Pre-fault angle ${a.opts.deltaDeg}° → ${b.opts.deltaDeg}°`
    if (!pa || !pb) return out(what, now)
    const d = (x: Complex, y: Complex) => (significant(x, pa.total) || significant(y, pb.total) ? `${zRect(x)} → ${zRect(y)}` : null)
    const parts = [
      d(pa.rf, pb.rf) && `R_f term ${d(pa.rf, pb.rf)}`,
      d(pa.infeed, pb.infeed) && `infeed term ${d(pa.infeed, pb.infeed)}`,
      d(pa.k0, pb.k0) && `earth-loop error ${d(pa.k0, pb.k0)}`,
    ].filter(Boolean)
    return out(what, parts.length ? `Changed: ${parts.join('; ')}. ${now}` : `No part of Z_app depends on the source at B for this fault (bolted, on L1, compensated): ${now}`)
  }
  if (a.zones.k0On !== b.zones.k0On) {
    if (!pb) return out(b.zones.k0On ? 'k₀ compensation on' : 'k₀ compensation off', now)
    return out(
      b.zones.k0On ? 'k₀ compensation on' : 'k₀ compensation off',
      cs.includes('k0') || (pa && significant(pa.k0, pa.total))
        ? `Uncompensated-earth-loop error ${pa ? `${zRect(pa.k0)} → ` : ''}${zRect(pb.k0)}: without k₀ the drop of the earth return (Z₀ > Z₁) is divided by the phase current alone. ${now}`
        : `This loop carries no residual current (${LOOP_LABEL[LOOP_OF[b.spec.type]]}), so k₀ makes no difference. ${now}`,
    )
  }
  if (a.zones !== b.zones) return out('Zone settings changed', 'The mho circles and the time steps move; the measured impedance does not.')
  return null
}
