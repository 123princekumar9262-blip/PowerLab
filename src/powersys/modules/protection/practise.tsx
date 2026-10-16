import { useMemo } from 'react'
import { abs, add, arg, C, conj, mul, polarDeg, scale, sub, type Complex } from '../../engine/complex.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { CT_HV, I_RATED_HV, I_RATED_LV, T2_MVA } from './differential.ts'
import { inMho, K0, KV, L1_KM, L3_KM, LOOP_LABEL, Z0_KM, Z1_KM, Z1L, Z1L3, whereText } from './distance.ts'
import { GEN_KV, neutralZ, VPH_GEN } from './earthing.ts'
import { MODULE, typeName } from './shared.tsx'
import type { ModState } from './state.ts'
import { checkDiff, checkK0, checkPetersen, checkStator, checkTrv, checkZapp, TRV_TOL } from './verify.ts'
import { zRect } from './words.ts'

/** Compare Z_app with m·Z₁L (the line impedance to the fault) and say so only as far as it is true. */
function mzText(z: Complex, km: number): string {
  const mz = add(scale(Z1L, Math.min(km, L1_KM) / L1_KM), scale(Z1L3, Math.max(0, km - L1_KM) / L3_KM))
  const d = abs(sub(z, mz))
  return d <= 1e-9 * Math.max(1, abs(mz))
    ? `Here Z_app equals the line impedance to the fault, m·Z₁L = ${zRect(mz)}.`
    : `The line impedance to the fault is ${zRect(mz)}; Z_app differs from it by ${fx(d, 3)} Ω (fault resistance, infeed or an uncompensated earth loop — see Explore).`
}

const ph = (z: Complex, d = 3) => `${fx(abs(z), d)} ∠${fx((arg(z) * 180) / Math.PI, 1)}°`

export function Verify({ st }: { st: ModState }) {
  const progress = usePsProgress()
  const z = useMemo(() => checkZapp(st.dist), [st.dist])
  const k = useMemo(() => checkK0(), [])
  const dc = useMemo(() => checkDiff(st.diff), [st.diff])
  const pc = useMemo(() => checkPetersen(st.earth.c0uF > 0 ? st.earth.c0uF : 0.5), [st.earth.c0uF])
  const tc = useMemo(() => checkTrv(st.trv), [st.trv])
  const sc = useMemo(() => checkStator(st.stator), [st.stator])
  useTutorContext(
    () =>
      'Verify mode: hand calculations of the apparent impedance (against KVL along the line), k0, the differential operating and restraint currents (against the delta-CT matrix), the Petersen coil, the TRV (against RK4) and the generator earth-fault coverage (against bisection).',
  )
  const s = st.dist.spec
  const kmTurn = s.km > 0 && s.km <= L1_KM ? s.km : 0.6 * L1_KM
  const zTurn = abs(Z1L) * (kmTurn / L1_KM)
  const quiz: QuizItem[] = [
    {
      id: 'z-turn',
      kind: 'number',
      level: 'numerical',
      q: `Your turn: a bolted three-phase fault ${fx(kmTurn, 1)} km from A on this ${L1_KM} km line (Z₁L = ${zRect(Z1L)}). What |Z_app| does the relay at A measure?`,
      answer: zTurn,
      unit: 'Ω',
      tol: Math.max(0.05, zTurn * 0.005),
      why: `Z_app = m·Z₁L = (${fx(kmTurn, 1)}/${L1_KM}) × ${fx(abs(Z1L), 3)} = ${fx(zTurn, 3)} Ω.`,
      mistake: 'Use the magnitude of the line impedance |Z₁L| = √(R² + X²) and scale it by the fraction of the line.',
    },
  ]
  const dP = dc.d
  return (
    <div className="ps-stack">
      <Callout title="Check the relay arithmetic by hand">
        <p>
          Each block repeats a result step by step from the numbers the model shows, and compares it with a second, independent method. The first, third, fifth and sixth blocks use the cases you set
          in Explore. {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      {z ? (
        <Calc
          title={`1 · Apparent impedance: ${typeName(s.type)} fault ${whereText(s.km)}, R_f ${fx(s.rfOhm, 1)} Ω`}
          steps={[
            { label: `Loop ${LOOP_LABEL[z.loop]} voltage at A`, expr: z.loop.endsWith('E') ? 'V_a' : 'V_b − V_c', result: `${ph(scale(z.vLoop, (KV * 1000) / Math.sqrt(3) / 1000), 2)} kV` },
            {
              label: 'Loop current',
              expr: z.loop.endsWith('E') ? `I_a + k₀·3I₀ (k₀ ${st.dist.zones.k0On ? 'on' : 'off'})` : 'I_b − I_c',
              result: `${ph(scale(z.iLoop, 1000 * (100 / (Math.sqrt(3) * KV))), 1)} A`,
            },
            { label: 'Z_app = V/I', expr: 'divide the phasors', result: zRect(z.zDirect) },
          ]}
          check={{
            ok: z.ok,
            text: `Independent check — KVL along the line data: the line impedance to the fault weighted by each segment’s current, ${zRect(z.zLine)}, plus the fault-point voltage over the relay current, ${zRect(z.zFault)}, gives ${zRect(z.zKvl)} (agree within 1e-9 relative — both are exact). ${mzText(z.zDirect, s.km)}`,
          }}
        />
      ) : (
        <Callout tone="warn" title="1 · Apparent impedance">
          The case set in Explore has no measurement (invalid settings or too little current at A). Move the fault or reset the settings in Explore.
        </Callout>
      )}
      <Calc
        title="2 · The residual compensation factor k₀"
        steps={[
          { label: 'Z₁ per km', expr: 'from the line data (Module 4)', result: zRect(Z1_KM, 3).replace(' Ω', ' Ω/km') },
          { label: 'Z₀ per km', expr: 'zero sequence (earth return)', result: zRect(Z0_KM, 3).replace(' Ω', ' Ω/km') },
          { label: 'k₀ = (Z₀ − Z₁)/(3Z₁)', expr: `(${zRect(sub(Z0_KM, Z1_KM), 3)})/(3 × ${zRect(Z1_KM, 3)})`, result: ph(K0, 4) },
        ]}
        check={{
          ok: k.ok,
          text: `Independent check — a bolted earth fault at 70 % of L1 solved with Module 4’s fault model: V_a/(I_a + k₀·3I₀) = ${zRect(k.zc)}, exactly 0.7·Z₁L = ${zRect(k.want)}.`,
        }}
      />
      <Calc
        title={`3 · Differential: phase a, ${st.diff.loc === 'ext-lv' ? 'external 33 kV fault' : st.diff.loc === 'int-lv' ? 'internal LV-terminal fault' : 'external 220 kV fault'}, ${typeName(st.diff.type)}`}
        steps={[
          { label: 'HV primary, phase a', expr: 'from Module 4’s fault study', result: `${ph(dP.hvA[0], 1)} A` },
          { label: 'HV secondary, matched', expr: `÷ CT ${CT_HV}, then × ${CT_HV}/${fx(I_RATED_HV, 1)} A (matching)`, result: `${ph(dc.matched[0], 3)} pu` },
          { label: `Compensated (Yd${st.diff.s.relayClock} matrix)`, expr: st.diff.s.relayClock === 11 ? '(I_a − I_b)/√3' : '(I_a − I_c)/√3', result: `${ph(dc.comp[0], 3)} pu` },
          { label: 'LV, matched', expr: `÷ ${fx(I_RATED_LV, 0)} A rated`, result: `${ph(dP.lvPu[0], 3)} pu` },
          { label: 'I_op = |I_HV + I_LV|', expr: 'phasor sum', result: `${fx(dc.iop[0], 4)} pu` },
          { label: 'I_res = (|I_HV| + |I_LV|)/2', expr: 'average of magnitudes', result: `${fx(dc.ires[0], 4)} pu` },
          { label: 'Threshold', expr: 'bias characteristic at I_res', result: `${fx(dc.thr[0], 4)} pu → ${dc.iop[0] > dc.thr[0] ? 'operate' : 'restrain'}` },
        ]}
        check={{
          ok: dc.ok,
          text: `Independent check — the relay model compensates in symmetrical components (zero sequence removed, I₁ turned by −h·30°); the phase-domain matrix above gives the same I_op and I_res on all three phases, and the same decision: ${dc.trip ? 'trip' : 'restrain'}.${!st.diff.s.zsFilter ? ' (Zero-sequence filter off: I₀ added back to the matrix result.)' : ''}`,
        }}
      />
      <Calc
        title={`4 · Petersen coil for C₀ = ${fx(st.earth.c0uF > 0 ? st.earth.c0uF : 0.5, 2)} µF per phase at 50 Hz`}
        steps={[
          { label: 'X_C0 = 1/(ωC₀)', expr: `1/(2π·50 × ${fx(st.earth.c0uF > 0 ? st.earth.c0uF : 0.5, 2)}×10⁻⁶)`, result: `${fx(pc.xc, 1)} Ω` },
          { label: 'Classical X_L = 1/(3ωC₀)', expr: `${fx(pc.xc, 1)} / 3`, result: `${fx(pc.classic, 2)} Ω` },
          { label: 'Exact: 3X_L + X₀,gen = X_C0', expr: `(${fx(pc.xc, 1)} − ${fx(pc.x0, 3)}) / 3`, result: `${fx(pc.exact, 2)} Ω` },
        ]}
        check={{
          ok: pc.ok,
          text: `Independent check — the same fault solved in phase quantities (three emfs behind the machine’s phase impedance matrix, the coil from star point to earth, C₀ on each terminal, phase a bolted to earth; no symmetrical components): with the coil at ${fx(pc.exact, 2)} Ω the fault current is ${pc.iTuned < 1e-6 ? '0' : fx(pc.iTuned, 6)} A while the capacitances carry ${fx(pc.iCap, 2)} A; at the classical ${fx(pc.classic, 2)} Ω the residual is ${fx(pc.iClassic, 4)} A in both models.`,
        }}
      />
      {tc ? (
        <Calc
          title={`5 · Recovery voltage at ${tc.d.id} (${tc.d.kv} kV), C = ${st.trv.cNf} nF${st.trv.rOn ? `, R = ${st.trv.rOhm} Ω across the contacts` : ''}`}
          steps={[
            { label: 'L = X₁/ω', expr: `${fx(tc.d.xOhm, 2)} Ω / (2π·50)`, result: `${fx(tc.d.lH * 1000, 2)} mH` },
            { label: 'ω₀ = 1/√(LC)', expr: `1/√(${fx(tc.d.lH, 4)} × ${st.trv.cNf}×10⁻⁹)`, result: `${fx(tc.mt.w0, 0)} rad/s (f₀ ${fx(tc.mt.f0 / 1000, 2)} kHz)` },
            { label: 'V_m = √2·V/√3', expr: `√2 × ${tc.d.kv}/√3 kV`, result: `${fx(tc.d.vPeakV / 1000, 2)} kV` },
            ...(tc.mt.regime === 'undamped'
              ? [
                  { label: 'Peak = 2V_m at t = π/ω₀', expr: `2 × ${fx(tc.d.vPeakV / 1000, 2)}`, result: `${fx(tc.mt.peakV / 1000, 1)} kV at ${fx((tc.mt.tPeak ?? 0) * 1e6, 1)} µs` },
                  { label: 'RRRV = V_m·ω₀', expr: `${fx(tc.d.vPeakV / 1000, 2)} kV × ${fx(tc.mt.w0, 0)} /s`, result: `${fx(tc.mt.rrrv / 1e9, 4)} kV/µs` },
                ]
              : [
                  {
                    label: 'α = 1/(2RC)',
                    expr: `1/(2 × ${st.trv.rOhm} × ${st.trv.cNf}×10⁻⁹)`,
                    result: `${fx(tc.mt.alpha, 0)} /s (${tc.mt.regime === 'under' ? 'under-damped' : tc.mt.regime === 'critical' ? 'critically damped' : 'over-damped'})`,
                  },
                  { label: 'Highest voltage', expr: tc.mt.regime === 'under' ? 'V_m(1 + e^(−απ/ω_d))' : 'no overshoot: tends to V_m', result: `${fx(tc.mt.peakV / 1000, 1)} kV` },
                  { label: 'RRRV = max dv/dt', expr: 'where d²v/dt² = 0', result: `${fx(tc.mt.rrrv / 1e9, 4)} kV/µs` },
                ]),
          ]}
          check={{
            ok: tc.ok,
            text: `Independent check — the circuit integrated numerically (RK4, 4000 steps over 2.2 periods): largest difference from the closed form ${fx(tc.devRel * 1e6, 3)} × 10⁻⁶ V_m (tolerance ${TRV_TOL.v * 1e6} × 10⁻⁶), highest sampled dv/dt ${fx(tc.r.sMax / 1e9, 4)} kV/µs (${fx(tc.slopeRel * 100, 4)} % from the formula; tolerance ${TRV_TOL.slope * 100} %, set by the step).`,
          }}
        />
      ) : (
        <Callout tone="warn" title="5 · Recovery voltage">
          The TRV case set in Explore is not valid.
        </Callout>
      )}
      {sc && (
        <Calc
          title={`6 · Generator stator earth fault: relay at ${st.stator.p.kPct} %, R_f ${fx(st.stator.p.rfOhm, 0)} Ω`}
          steps={[
            { label: 'Z_N = R_n ‖ 1/(j3ωC₀)', expr: `${st.stator.p.rnOhm} Ω ‖ 3 × ${st.stator.p.c0uF} µF`, result: zRect(neutralZ(st.stator.p), 1) },
            {
              label: 'x_min = k·|Z_N + R_f|/|Z_N|',
              expr: `${st.stator.p.kPct} % × ${fx(abs(add(neutralZ(st.stator.p), C(st.stator.p.rfOhm))), 1)} / ${fx(abs(neutralZ(st.stator.p)), 1)}`,
              result: `${fx(sc.cov.xMin * 100, 3)} % from the neutral`,
            },
            { label: 'Protected', expr: '1 − x_min', result: `${fx(sc.cov.protectedPct, 3)} % of the winding` },
          ]}
          check={{
            ok: sc.ok,
            text: `Independent check — a nodal model (KCL at the star point: R_n, each terminal’s C₀ at V_N + E_p with the real phase emfs, and R_f from the faulted point), bisected for V_N = ${st.stator.p.kPct} % of ${fx(VPH_GEN, 0)} V: x = ${fx(sc.xBis * 100, 3)} %${sc.cov.xMin >= 1 ? ' (the relay never sees a fault in this winding)' : ''}.`,
          }}
        />
      )}
      <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
    </div>
  )
}

// ── Practise ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function practiceItems(): QuizItem[] {
  const z60 = abs(Z1L) * 0.6
  const k0m = abs(K0)
  const pet = 1 / (3 * 2 * Math.PI * 50 * 1e-6)
  const w0 = 1 / Math.sqrt(10e-3 * 10e-9)
  const rrrv = (10e3 * w0) / 1e9
  const spill = (4 * 0.1) / 1.1
  // GATE-style mho check: Z_L = 10 + j40 Ω, fault at 50 % through 8 Ω, single source, zone 1 = 80 %
  const zl = C(10, 40)
  const zf = C(0.5 * 10 + 8, 0.5 * 40)
  const zone1 = inMho(zf, scale(zl, 0.8))
  // directional: current lags V_a by 60°, quadrature connection, RCA 45°
  const ia = polarDeg(1, -60)
  const vbc = sub(polarDeg(1, -120), polarDeg(1, 120))
  const fwd = mul(mul(ia, conj(vbc)), polarDeg(1, -45)).re > 0
  const lead = ((arg(ia) - arg(vbc)) * 180) / Math.PI
  const iC = 3 * 2 * Math.PI * 50 * 1e-6 * (11e3 / Math.sqrt(3))
  return [
    {
      id: 'z1-80',
      kind: 'choice',
      level: 'concept',
      q: 'Why is zone 1 of a distance relay set to about 80 % of the line rather than 100 %?',
      options: [
        { id: 'a', label: 'So that measuring errors cannot make it trip instantly for a fault just beyond the far end' },
        { id: 'b', label: 'Because the last 20 % of a line never has faults' },
        { id: 'c', label: 'To save the relay’s memory' },
        { id: 'd', label: 'Because the relay cannot measure more than 80 % of an impedance' },
      ],
      answer: 'a',
      why: 'Errors in the CTs, VTs and line data (and fault resistance on a line carrying load) could make a fault just beyond the far end look inside; zone 2, with a delay, covers the end of the line.',
      mistake: 'Faults can happen anywhere on the line; the margin is about the relay’s accuracy, not where faults occur.',
    },
    {
      id: 'mho-dir',
      kind: 'choice',
      level: 'concept',
      q: 'A mho characteristic is a circle on the R–X plane that passes through the origin. What does that give the relay?',
      options: [
        { id: 'a', label: 'It is inherently directional: faults behind the relay (third quadrant) are outside the circle' },
        { id: 'b', label: 'It ignores fault resistance completely' },
        { id: 'c', label: 'It trips on load current' },
      ],
      answer: 'a',
      why: 'A reverse fault gives Z_app pointing away from the line angle, outside a circle through the origin along the line angle.',
    },
    {
      id: 'z-60',
      kind: 'number',
      level: 'numerical',
      q: `Line L1: Z₁ = ${zRect(Z1_KM, 2).replace(' Ω', '')} Ω/km over ${L1_KM} km. What |Z_app| does a relay at one end see for a bolted three-phase fault at 60 % of the line?`,
      answer: z60,
      unit: 'Ω',
      tol: 0.1,
      why: `|Z₁L| = ${fx(abs(Z1L), 3)} Ω, and 0.6 × that = ${fx(z60, 2)} Ω.`,
      mistake: 'Multiply the per-km impedance by the length first, then take 60 % of its magnitude.',
    },
    {
      id: 'k0',
      kind: 'number',
      level: 'numerical',
      q: `With Z₁ = ${zRect(Z1_KM, 2).replace(' Ω', '')} and Z₀ = ${zRect(Z0_KM, 2).replace(' Ω', '')} Ω/km, what is |k₀| = |(Z₀ − Z₁)/(3Z₁)|?`,
      answer: k0m,
      unit: '',
      tol: 0.005,
      why: `k₀ = ${ph(K0, 4)}.`,
      mistake: 'Divide by 3Z₁ as a complex number, not by 3|Z₀|.',
    },
    {
      id: 'pet',
      kind: 'number',
      level: 'numerical',
      q: 'A system has 1 µF per phase to earth. What reactance must a Petersen coil have at 50 Hz (classical formula)?',
      answer: pet,
      unit: 'Ω',
      tol: 2,
      why: `X_L = 1/(3ωC₀) = 1/(3 × 314.16 × 10⁻⁶) = ${fx(pet, 1)} Ω.`,
      mistake: 'The coil carries the current of all three phase capacitances: 3C₀, not C₀.',
    },
    {
      id: 'rrrv',
      kind: 'number',
      level: 'numerical',
      q: 'After interruption the source side is L = 10 mH with C = 10 nF, and the voltage at the current zero is V_m = 10 kV. What is the maximum rate of rise of the restriking voltage (lossless)?',
      answer: rrrv,
      unit: 'kV/µs',
      tol: 0.01,
      why: `ω₀ = 1/√(LC) = ${fx(w0, 0)} rad/s; RRRV = V_m·ω₀ = ${fx(rrrv * 1e9, 0)} V/s = ${fx(rrrv, 3)} kV/µs (peak 2V_m = 20 kV).`,
      mistake: 'V_m·ω₀ is in V/s: divide by 10⁹ for kV/µs.',
    },
    {
      id: 'making',
      kind: 'number',
      level: 'numerical',
      q: 'A breaker’s rated symmetrical breaking current is 20 kA. Using the usual doubling factor of 1.8, what peak making current must it withstand?',
      answer: 1.8 * Math.SQRT2 * 20,
      unit: 'kA',
      tol: 0.3,
      why: `1.8 × √2 × 20 = ${fx(1.8 * Math.SQRT2 * 20, 1)} kA (the 2.55 factor).`,
      mistake: 'Convert rms to peak (√2) and then apply the asymmetry factor 1.8.',
    },
    {
      id: 'spill',
      kind: 'number',
      level: 'university',
      q: 'A through fault drives 4 pu (of rating) on the LV side of a transformer. Its tap changer has added 10 % to the HV turns compared with the ratio the differential relay was matched to, so the HV current is 4/(1 + 0.1) pu (ideal CTs). What spill current |I_HV + I_LV| does the relay see?',
      answer: spill,
      unit: 'pu',
      tol: 0.01,
      why: `HV side 4/1.1 = ${fx(4 / 1.1, 3)} pu against 4 pu: I_op = ${fx(spill, 3)} pu. With a 30 % slope at I_res ≈ ${fx((4 + 4 / 1.1) / 2, 2)} pu, it is well restrained.`,
      mistake: 'The HV current is 4/(1 + t) = 3.636 pu, not 4 × (1 − t) = 3.6 pu: the spill is 4·t/(1 + t), not 4·t.',
    },
    {
      id: 'stator',
      kind: 'number',
      level: 'university',
      q: 'A high-resistance-earthed generator has a neutral overvoltage relay set at 10 % of the phase voltage. For a bolted fault, what percentage of the stator winding is protected?',
      answer: 90,
      unit: '%',
      tol: 0.5,
      why: 'A fault x from the neutral gives V_N = x·V_ph; the relay sees x > 10 %, i.e. the 90 % of the winding nearest the terminals.',
    },
    {
      id: 'unearthed-v',
      kind: 'number',
      level: 'university',
      q: 'An unearthed 11 kV system has a solid earth fault on one phase. To what voltage to earth do the healthy phases rise (ideal)?',
      answer: 11,
      unit: 'kV',
      tol: 0.1,
      why: `The faulted phase sits at earth potential, so the healthy phases are a full line voltage, 11 kV, above earth — √3 × ${fx(11 / Math.sqrt(3), 2)} kV.`,
      mistake: 'They rise by √3 from the phase voltage, to the line voltage.',
    },
    {
      id: 'gate-mho',
      kind: 'choice',
      level: 'gate',
      q: 'A line has Z_L = 10 + j40 Ω. A three-phase fault at its midpoint has 8 Ω of fault resistance; the line is fed from one end only. The mho zone 1 reaches 80 % of Z_L along the line angle. Does zone 1 operate?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
      answer: zone1 ? 'yes' : 'no',
      why: `Z_app = 0.5Z_L + R_f = ${zRect(zf, 1)}. Zone 1: centre ${zRect(scale(zl, 0.4), 1)}, radius ${fx(abs(zl) * 0.4, 2)} Ω; distance from the centre ${fx(abs(sub(zf, scale(zl, 0.4))), 2)} Ω → ${zone1 ? 'inside' : 'outside'}.`,
      mistake: 'Test the distance from the circle’s centre (Z_r/2), not |Z_app| against |Z_r|.',
    },
    {
      id: 'gate-dir',
      kind: 'choice',
      level: 'gate',
      q: 'A directional relay uses the quadrature connection (I_a with V_bc) and a characteristic angle of 45°. In a fault, I_a lags V_a by 60° (V_a undisturbed). Does it operate (forward)?',
      options: [
        { id: 'yes', label: 'Yes — forward' },
        { id: 'no', label: 'No — reverse' },
      ],
      answer: fwd ? 'yes' : 'no',
      why: `V_bc lags V_a by 90°, so I_a leads V_bc by ${fx(lead, 0)}°; that is ${fx(Math.abs(lead - 45), 0)}° from the 45° maximum-torque line, inside ±90° → ${fwd ? 'forward' : 'reverse'}.`,
    },
    {
      id: 'gate-ic',
      kind: 'number',
      level: 'university',
      q: 'An unearthed 11 kV, 50 Hz system has 1 µF per phase to earth. What current flows in a solid earth fault (neglect series impedances)?',
      answer: iC,
      unit: 'A',
      tol: 0.05,
      why: `I_C = 3ωC₀V_ph = 3 × 314.16 × 10⁻⁶ × ${fx(11e3 / Math.sqrt(3), 0)} = ${fx(iC, 2)} A.`,
      mistake: 'Use the phase voltage and the capacitance of all three phases (3C₀).',
    },
  ]
}

export function Practise() {
  const items = useMemo(practiceItems, [])
  useTutorContext(
    () =>
      `Practise mode — ${items.length} questions on distance, directional and differential protection, neutral earthing, generator earth faults and breaker duty. Questions are written for this app (not past papers).`,
  )
  return (
    <div className="ps-stack">
      <p className="small muted">
        Written for this app in the style of university and GATE questions — not past papers. Concept questions first, then numericals. Numbers about “this line” are Module 4’s data ({KV} kV, {L1_KM}{' '}
        km), T2 is {T2_MVA} MVA, the generator {GEN_KV} kV.
      </p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
