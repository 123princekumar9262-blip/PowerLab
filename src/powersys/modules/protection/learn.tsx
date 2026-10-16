import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { abs, add, scale, sub, ZERO } from '../../engine/complex.ts'
import { completeActivity } from '../../progress.ts'
import { statusFor } from '../../syllabus/coverage.ts'
import { TOPICS } from '../../syllabus/topics.ts'
import { fx } from '../../ui/format.ts'
import { Plot } from '../../ui/Plot.tsx'
import { Calc, Eq, Stepper, useTutorContext } from '../../ui/kit.tsx'
import { peakFactor, rCritical, sourceDuty, TEXTBOOK_DOUBLING, trvAt, trvMetrics, xrForDoubling } from './breaker.ts'
import { DIFF0, differential, I_RATED_HV, I_RATED_LV, T2_MVA } from './differential.ts'
import { apparentOhm, directional, distanceCase, IB_KA, K0, KV, L1_KM, L3_KM, RCA0, ROUTE0, sweep, Z0L, Z1L, ZONES0 } from './distance.ts'
import { capacitiveCurrent, compareMethods, EARTH0, METHODS, petersenClassic, petersenExact, statorCoverage, statorFault, STATOR0, X0G_OHM } from './earthing.ts'
import { DirDiagram } from './explore.tsx'
import { RouteScene } from './Scene.tsx'
import { BiasPlot } from './sections.tsx'
import { M4_HREF, MODULE, outcomeText, PartInfo, RouteSld, RxPlot, TimeDistance, type RxPoint } from './shared.tsx'
import { DIST0 } from './state.ts'
import { amps, timesWords, zoneName, zPolar, zRect } from './words.ts'

const TOPIC_IDS = ['distance-protection', 'differential-protection', 'directional-protection', 'neutral-earthing', 'generator-protection', 'circuit-breakers']

/** Which of this module's topics the syllabi name, from the syllabus mapping (nothing invented). */
function SyllabusNote() {
  const rows = TOPICS.filter((t) => TOPIC_IDS.includes(t.id)).map((t) => {
    const v = statusFor(t, 'vit-eee')
    const g = statusFor(t, 'gate-ee')
    const vit =
      v.status === 'verified' || v.status === 'partial' ? `VIT ${v.ref.where} Module ${v.ref.unit}` : v.elective ? `VIT elective ${v.ref.where} — supplementary for you` : 'VIT — not in your courses'
    const gate = g.status === 'verified' || g.status === 'partial' ? 'GATE EE' : 'not named in GATE EE'
    return { id: t.id, title: t.title, vit, gate }
  })
  return (
    <details className="ps-more pr-syllabus">
      <summary>Where this is in your syllabus</summary>
      <ul className="small">
        {rows.map((r) => (
          <li key={r.id}>
            {r.title}: {r.vit} · {r.gate}
          </li>
        ))}
      </ul>
    </details>
  )
}

export function Learn({ onExplore }: { onExplore(): void }) {
  const level = useLevel()
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  // every number below is computed from the module's models
  const c70 = useMemo(() => distanceCase(DIST0.spec, ROUTE0, ZONES0), [])
  const c90 = useMemo(() => distanceCase({ ...DIST0.spec, km: 0.9 * L1_KM }, ROUTE0, ZONES0), [])
  const before = useMemo(() => distanceCase({ ...DIST0.spec, km: L1_KM - 1.2 }, ROUTE0, ZONES0), [])
  const beyond = useMemo(() => distanceCase({ ...DIST0.spec, km: L1_KM + 1.2 }, ROUTE0, ZONES0), [])
  const sw = useMemo(() => sweep('3ph', 0, ROUTE0, ZONES0, 100), [])
  const slg = useMemo(() => distanceCase({ km: 0.7 * L1_KM, type: 'slg', rfOhm: 0 }, ROUTE0, ZONES0), [])
  const rf1 = useMemo(() => distanceCase({ km: 0.7 * L1_KM, type: '3ph', rfOhm: 10 }, ROUTE0, ZONES0), [])
  const infeed = { infeed: true, sscMva: 2000, deltaDeg: 0 }
  const rf2 = useMemo(() => distanceCase({ km: 0.7 * L1_KM, type: '3ph', rfOhm: 10 }, infeed, ZONES0), []) // eslint-disable-line react-hooks/exhaustive-deps
  const dirF = useMemo(() => distanceCase({ km: 60, type: '3ph', rfOhm: 0 }, infeed, ZONES0), []) // eslint-disable-line react-hooks/exhaustive-deps
  const dirR = useMemo(() => distanceCase({ km: L1_KM + 50, type: '3ph', rfOhm: 0 }, infeed, ZONES0), []) // eslint-disable-line react-hooks/exhaustive-deps
  const dF = directional(dirF.fault.relays.RBA, '3ph', RCA0)
  const dR = directional(dirR.fault.relays.RBA, '3ph', RCA0)
  const dThrough = useMemo(() => differential('ext-lv', '3ph', DIFF0), [])
  const dInt = useMemo(() => differential('int-lv', '3ph', DIFF0), [])
  const dTap = useMemo(() => differential('ext-lv', '3ph', { ...DIFF0, tapPct: 10 }), [])
  const methods = useMemo(() => compareMethods(EARTH0), [])
  const duty = useMemo(() => sourceDuty('CB1'), [])
  const trvP = { lH: duty.lH, cF: 10e-9, vPeakV: duty.vPeakV, rOhm: null }
  const trv = trvMetrics(trvP)
  const trvPts = useMemo(() => Array.from({ length: 241 }, (_, k) => [((2.2 / trv.f0) * k * 1e6) / 240, trvAt(((2.2 / trv.f0) * k) / 240, trvP) / 1000] as [number, number]), []) // eslint-disable-line react-hooks/exhaustive-deps
  const statorPts = useMemo(() => Array.from({ length: 101 }, (_, i) => [i, statorFault(i / 100, STATOR0).vnPct] as [number, number]), [])
  const ra = c70.decisions.RA
  const v70 = c70.fault.relays.RA
  const vA = abs(v70.vabc[0]) * (KV / Math.sqrt(3))
  const iA = abs(v70.iabc[0]) * IB_KA * 1000
  const zUnc = apparentOhm('aE', slg.fault.relays.RA, ZERO)!
  const zCmp = slg.decisions.RA.z!
  const vS = slg.fault.relays.RA
  const ires = add(add(vS.iabc[0], vS.iabc[1]), vS.iabc[2])
  const xr = duty.xOhm / duty.rOhm
  const pf = peakFactor(xr)
  const solid = methods.find((m) => m.method === 'solid')!.f
  const unearthed = methods.find((m) => m.method === 'unearthed')!.f
  const resist = methods.find((m) => m.method === 'resistance')!.f
  const react = methods.find((m) => m.method === 'reactance')!.f
  const cov = statorCoverage(STATOR0)
  const pts = (c: typeof c70, lab: string): RxPoint[] => (c.decisions.RA.z ? [{ z: c.decisions.RA.z, label: lab, kind: 'app' }] : [])
  const scene = (
    <RouteScene
      c={c70}
      selected={sel}
      onSelect={setSel}
      fallback={<RouteSld c={c70} label="Single-line diagram of the route" />}
      info={(id) => <PartInfo id={id} c={c70} />}
      height={360}
      label="A 220 kV line between substations A and B, with the next line to C"
    />
  )

  const steps: Array<{ title: string; visual: ReactNode; body: ReactNode; work?: ReactNode }> = [
    {
      title: 'Inside its own line — or on the next one?',
      visual: scene,
      body: (
        <>
          <p className="pr-question">
            How can a relay at one end of a {L1_KM} km line tell whether a fault is inside its own line or on the next one — using only the voltage and current it measures?
          </p>
          <p>
            The picture is Module 4’s 220 kV line L1 from substation A to B; beyond B the next line L3 runs {L3_KM} km to C. At A, <b>current transformers</b> and <b>voltage transformers</b> step the
            line’s current and voltage down to safe values; the <b>relay</b> in the kiosk reads them and, if it decides the fault is its own, tells the <b>circuit breaker</b> to open. Select any part
            to see what it does.
          </p>
          <p>
            An overcurrent relay (Module 4) only asks “how big is the current?” — but a three-phase fault 1.2 km before B sends {amps(before.decisions.RA.iA)} through the relay at A, and one 1.2 km
            beyond B sends {amps(beyond.decisions.RA.iA)}: {fx(Math.abs(before.decisions.RA.iA / beyond.decisions.RA.iA - 1) * 100, 1)} % apart
            {Math.abs(before.decisions.RA.iA / beyond.decisions.RA.iA - 1) < 0.05 ? ', too close to put a current setting between them' : ''}. A <b>distance relay</b> asks a better question.
          </p>
          <SyllabusNote />
        </>
      ),
    },
    {
      title: 'The relay measures impedance — and impedance means distance',
      visual: <RxPlot zones={ZONES0} points={pts(c70, `Z_app ${zPolar(ra.z!, 1)}`)} label="The apparent impedance of a fault at 70 % of the line" height={360} />,
      body: (
        <>
          <p>
            During a fault, current flows from A along the line to the fault and the voltage at A is what it takes to push that current through the line up to the fault. A fault further away has more
            line in the way: the same current needs more voltage. So the ratio V/I that the relay computes grows in proportion to the distance — it is the impedance of the line between the relay and
            the fault.
          </p>
          <p>The relay knows the whole line’s impedance Z₁L. If V/I is, say, 70 % of Z₁L, the fault is 70 % of the way along — on its own line. If it is 110 %, the fault is beyond B.</p>
        </>
      ),
      work: (
        <>
          <Eq
            title="Apparent impedance"
            expr="Z_app = V_relay / I_relay = m · Z₁L"
            where={[
              ['V_relay, I_relay', 'phase voltage and current measured at the relay (here phase a)', 'kV, kA'],
              ['m', 'the fault’s distance as a fraction of the line (the unknown)', '–'],
              ['Z₁L', `positive-sequence impedance of the whole line: ${zRect(Z1L)}`, 'Ω'],
            ]}
            assume="a bolted fault (no fault resistance), so the voltage at the fault is zero; measured with every breaker closed"
          />
          <Calc
            title="Worked example: a bolted three-phase fault at 70 % of L1"
            steps={[
              { label: 'Voltage at A, phase a', expr: 'VT reading (from Module 4’s fault model)', result: `${fx(vA, 2)} kV` },
              { label: 'Current at A, phase a', expr: 'CT reading', result: `${fx(iA, 1)} A` },
              { label: '|Z_app| = V/I', expr: `${fx(vA, 2)} kV / ${fx(iA, 1)} A`, result: `${fx(abs(ra.z!), 2)} Ω` },
              { label: 'm = |Z_app| / |Z₁L|', expr: `${fx(abs(ra.z!), 2)} / ${fx(abs(Z1L), 2)}`, result: fx(abs(ra.z!) / abs(Z1L), 4) },
            ]}
            check={{ ok: Math.abs(abs(ra.z!) / abs(Z1L) - 0.7) < 1e-9, text: `The fault was placed at 70 % — the relay finds it there. The angle, ${zPolar(ra.z!)}, is the line’s own angle.` }}
          />
        </>
      ),
    },
    {
      title: 'Earth faults: the earth return and k₀',
      visual: (
        <RxPlot
          zones={ZONES0}
          points={[
            { z: zCmp, label: 'with k₀', kind: 'app' },
            { z: zUnc, label: 'without k₀', kind: 'other' },
          ]}
          label="An earth fault at 70 %: compensated and uncompensated measurement"
          height={360}
        />
      ),
      body: (
        <>
          <p>
            In an earth fault the current goes out along phase a and comes back through the earth (and earth wires). That return path has its own, larger impedance: the line’s zero-sequence impedance
            Z₀L = {zRect(Z0L)} is {timesWords(abs(Z0L) / abs(Z1L))} Z₁L. The voltage at A includes the drop of this return, so V_a/I_a reads too high.
          </p>
          <p>The relay corrects it by adding a scaled residual current: I_a + k₀·3I₀. Then the earth loop measures m·Z₁L again — one setting works for every kind of fault.</p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="Z_app = V_a / (I_a + k₀·3I₀),     k₀ = (Z₀L − Z₁L) / (3Z₁L)"
            where={[
              ['3I₀', 'residual current I_a + I_b + I_c (what returns through the earth)', 'A'],
              ['k₀', 'residual compensation factor, a complex number set in the relay', '–'],
              ['Z₀L', 'zero-sequence impedance of the line', 'Ω'],
            ]}
            assume="the same k₀ along the whole line; mutual coupling to other circuits not modelled"
          />
          <Calc
            title="Worked example: a bolted earth fault on phase a at 70 % of L1"
            steps={[
              { label: 'k₀', expr: `(${zRect(Z0L, 1)} − ${zRect(Z1L, 1)}) / (3 × ${zRect(Z1L, 1)})`, result: `${fx(abs(K0), 4)} ∠${fx((Math.atan2(K0.im, K0.re) * 180) / Math.PI, 2)}°` },
              { label: 'Residual current 3I₀ at A', expr: 'I_a + I_b + I_c', result: amps(abs(ires) * IB_KA * 1000) },
              {
                label: 'Without k₀: V_a / I_a',
                expr: 'phase voltage ÷ phase current',
                result: `${zPolar(zUnc)} → ${zoneName(distanceCase({ km: 0.7 * L1_KM, type: 'slg', rfOhm: 0 }, ROUTE0, { ...ZONES0, k0On: false }).decisions.RA.zone)}`,
              },
              { label: 'With k₀: V_a/(I_a + k₀·3I₀)', expr: 'compensated', result: `${zPolar(zCmp)} → ${zoneName(slg.decisions.RA.zone)}` },
            ]}
            check={{
              ok: abs(sub(zCmp, scale(Z1L, 0.7))) < 1e-9 * abs(Z1L),
              text: `Compensated: exactly 0.7·Z₁L = ${zRect(scale(Z1L, 0.7))}. Uncompensated it reads ${timesWords(abs(zUnc) / abs(zCmp))} as far — under-reach.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Zones: reach and time',
      visual: (
        <>
          <RxPlot
            zones={ZONES0}
            points={[...pts(c70, '70 %'), ...(c90.decisions.RA.z ? [{ z: c90.decisions.RA.z, label: '90 %', kind: 'other' as const }] : [])]}
            label="The three mho zones of the relay at A"
            height={320}
          />
          <TimeDistance sw={sw} zones={ZONES0} faultKm={0.9 * L1_KM} trips={{ RA: c90.decisions.RA.tripS }} label="Stepped time–distance characteristic" />
        </>
      ),
      body: (
        <>
          <p>
            The relay compares Z_app with a <b>characteristic</b> on the R–X plane. The <b>mho</b> characteristic is a circle through the origin whose diameter is the reach, laid along the line’s
            angle. A fault inside the circle is “within reach”. Because the circle passes through the origin, faults behind the relay (pointing the other way) are outside: the mho is directional by
            itself.
          </p>
          <p>
            Several circles make <b>zones</b>. Typical settings (not from a standard): zone 1 ≈ 80 % of the line, no intentional delay; zone 2 ≈ 120 %, about 0.3 s; zone 3 further (here 200 %, 0.8 s)
            as backup for the next line. At 70 % the relay is in {zoneName(ra.zone)}; at 90 % in {zoneName(c90.decisions.RA.zone)}, so it waits {fx(c90.decisions.RA.tripS ?? 0, 2)} s — time for the
            next line’s own relay to act first if the fault were there.
          </p>
          <p className="small muted">Quadrilateral characteristics (reaching further along R) are used too; they are explained here, not modelled.</p>
        </>
      ),
      work: (
        <Eq
          expr="inside zone k  ⇔  |Z_app − Z_r,k/2| ≤ |Z_r,k|/2,    Z_r,k = (reach %)·Z₁L"
          where={[
            ['Z_r,k', 'reach of zone k along the line angle', 'Ω'],
            ['Z_app', 'apparent impedance measured', 'Ω'],
          ]}
          assume="relay characteristic angle = line angle; the same test as the phase comparator: angle between Z and Z_r − Z ≤ 90°"
        />
      ),
    },
    {
      title: 'Fault resistance and infeed: under-reach',
      visual: (
        <RxPlot
          zones={ZONES0}
          points={[
            { z: scale(Z1L, 0.7), label: 'bolted', kind: 'bolted' },
            ...(rf1.decisions.RA.z ? [{ z: rf1.decisions.RA.z, label: 'R_f, one source', kind: 'other' as const }] : []),
            ...(rf2.decisions.RA.z ? [{ z: rf2.decisions.RA.z, label: 'R_f, infeed at B', kind: 'app' as const }] : []),
          ]}
          label="Fault resistance shifts the apparent impedance"
          height={360}
        />
      ),
      body: (
        <>
          <p>
            Real faults often go through an arc or a tower footing: fault resistance R_f. The voltage at A now also includes I_F·R_f — the drop across the fault — so the point moves to the right on
            the R–X plane and may leave the zone. The relay sees the fault further away than it is: <b>under-reach</b>.
          </p>
          <p>
            With a source at B as well, R_f carries current from both ends, but the relay divides by its own current only, so R_f looks bigger still (and, with load flowing before the fault, tilted).
            Here for a three-phase fault at 70 % with 10 Ω: one source → {zPolar(rf1.decisions.RA.z!)} ({zoneName(rf1.decisions.RA.zone)}); with a 2000 MVA infeed at B →{' '}
            {rf2.decisions.RA.z ? `${zPolar(rf2.decisions.RA.z)} (${zoneName(rf2.decisions.RA.zone)})` : 'not measurable'}.
          </p>
          <p className="small muted">Load encroachment: heavy load also looks like an impedance — large, near the R axis. A long zone 3 could reach it; Explore checks that margin.</p>
        </>
      ),
      work: (
        <Eq
          expr="Z_app = m·Z₁L + R_f · I_F / I_A = m·Z₁L + R_f·(1 + I_B / I_A)"
          where={[
            ['I_F', 'total current into the fault', 'A'],
            ['I_A, I_B', 'the shares from A and from B', 'A'],
          ]}
          assume="three-phase fault through R_f per phase; one source ⇒ I_B = 0 and Z_app = m·Z₁L + R_f"
        />
      ),
    },
    {
      title: 'Directional protection',
      visual: (
        <div className="ps-cols-2">
          <div className="ps-card pr-flush">
            <p className="eyebrow">Fault on L1 (in front)</p>
            <DirDiagram angleDeg={dF.angleDeg} rcaDeg={RCA0} decided={dF.forward !== null} element={dF.element} />
          </div>
          <div className="ps-card pr-flush">
            <p className="eyebrow">Fault on L3 (behind)</p>
            <DirDiagram angleDeg={dR.angleDeg} rcaDeg={RCA0} decided={dR.forward !== null} element={dR.element} />
          </div>
        </div>
      ),
      body: (
        <>
          <p>
            When both ends have sources, the relay at B on L1 carries fault current whether the fault is on L1 (in front of it) or on L3 (behind it). Its size cannot say which; its <b>phase</b> can. A
            fault in front draws current lagging the voltage by about the line angle; a fault behind sends current the opposite way — 180° turned.
          </p>
          <p>
            The relay compares the current with a <b>polarising voltage</b>. With the quadrature connection, phase a’s element uses V_bc, which lags V_a by 90° and survives an earth fault on phase a.
            It operates when the current is within ±90° of the maximum-torque line, {RCA0}° ahead of V_pol. Here: L1 fault → I_a leads V_bc by {fx(dF.angleDeg, 1)}°,{' '}
            {dF.forward ? 'forward' : 'reverse'}; L3 fault → {fx(dR.angleDeg, 1)}°, {dR.forward ? 'forward' : 'reverse'}.
          </p>
        </>
      ),
      work: (
        <Eq
          expr="T = |I||V_pol| cos(θ − α) = Re[I · V_pol* · e^(−jα)],  forward ⇔ T > 0"
          where={[
            ['θ', 'angle by which the operating current leads V_pol', '°'],
            ['α', `relay characteristic (maximum-torque) angle, here ${RCA0}° (typical 30°–45°)`, '°'],
          ]}
          assume="enough voltage to polarise (a close-in three-phase fault collapses it; relays then use a memory of the pre-fault voltage)"
        />
      ),
    },
    {
      title: 'Differential protection: what goes in must come out',
      visual: <BiasPlot d={dTap} bias={DIFF0.bias} />,
      body: (
        <>
          <p>
            Put current transformers on every connection of a transformer (or generator, or busbar) and add their currents. Normal load or a fault outside: what enters leaves — the sum is ≈ 0. A fault
            inside: current enters and does not come out — the sum is the fault current. The relay trips only for faults in its zone, instantly, without grading.
          </p>
          <p>
            For T2 ({T2_MVA} MVA, YNd11): a through fault on the 33 kV bus gives I_op = {fx(dThrough.iop[0], 3)} pu; a fault at the LV terminals inside the zone gives {fx(dInt.iop[0], 2)} pu. The two
            sides must first be brought to a common base: ratings ({fx(I_RATED_HV, 1)} A and {fx(I_RATED_LV, 0)} A) and the 30° vector-group shift. A tap change spoils the balance a little: 10 % off
            gives a spill of {fx(dTap.iop[0], 3)} pu at {fx(dTap.ires[0], 2)} pu restraint — the <b>bias</b> (percentage) characteristic tolerates it (the plot).
          </p>
          <p className="small muted">
            Magnetising inrush (explained, not modelled): switching on draws a large one-sided current into one winding only — rich in second harmonic, which relays use to block tripping.
          </p>
        </>
      ),
      work: (
        <Eq
          expr="I_op = |I₁ + I₂|,  I_res = (|I₁| + |I₂|)/2;  trip if I_op > max(I_s1, k₁·I_res) (k₂ above the knee I_s2)"
          where={[
            ['I₁, I₂', 'currents into the zone from each side, per unit of rating, after compensation', 'pu'],
            ['k₁, k₂', `bias slopes (here ${DIFF0.bias.k1 * 100} % and ${DIFF0.bias.k2 * 100} %, typical)`, '–'],
            ['I_s1', `minimum operating current (${DIFF0.bias.is1} pu)`, 'pu'],
          ]}
          assume="ideal CTs (no saturation)"
        />
      ),
    },
    {
      title: 'Neutral earthing',
      visual: (
        <div className="table-wrap ps-card">
          <table className="ps-table">
            <caption className="small muted">Earth fault at Module 4’s 13.8 kV generator terminals, C₀ = {EARTH0.c0uF} µF per phase (computed)</caption>
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col">
                  Fault current <span className="pr-unit">[A]</span>
                </th>
                <th scope="col">
                  Healthy phase <span className="pr-unit">[pu]</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {methods.map(({ method, f }) => (
                <tr key={method}>
                  <td>{METHODS.find((m) => m.id === method)!.label}</td>
                  <td>{fx(f.iFaultA, f.iFaultA < 10 ? 2 : 0)}</td>
                  <td>{fx(f.vHealthyPu, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
      body: (
        <>
          <p>
            How the star point is connected to earth decides two things in an earth fault: how much current flows, and how high the two healthy phases rise. <b>Solid</b> earthing:{' '}
            {amps(solid.iFaultA)} but the healthy phases stay at {fx(solid.vHealthyPu, 3)} pu. <b>Unearthed</b>: only the capacitive current, {amps(unearthed.iFaultA)}, but the healthy phases rise to{' '}
            {fx(unearthed.vHealthyPu, 3)} pu — line voltage — and intermittent arcs can re-strike (“arcing grounds”) and build up overvoltages. <b>Resistance</b> ({fx(EARTH0.rnOhm, 0)} Ω) and{' '}
            <b>reactance</b> ({fx(EARTH0.xnOhm, 1)} Ω) earthing limit the current to {amps(resist.iFaultA)} and {amps(react.iFaultA)}; the healthy phases then rise to {fx(resist.vHealthyPu, 3)} and{' '}
            {fx(react.vHealthyPu, 3)} pu
            {resist.vHealthyPu > unearthed.vHealthyPu
              ? ' — the resistance pushes them even above the unearthed value: with a resistive Z₀ and inductive Z₁, Z₂ adding at an angle, the earth-fault factor can exceed √3'
              : ''}
            .
          </p>
          <p>
            A <b>Petersen coil</b> (resonant earthing) is a reactor tuned to the system’s capacitance: its inductive current cancels the capacitive current at the fault, so an arc goes out by itself.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="I_F = 3V_ph / (Z₁ + Z₂ + Z₀),   Z₀ = [(Z₀g + 3Z_n)⁻¹ + jωC₀]⁻¹;   Petersen: X_L = 1/(3ωC₀)"
            where={[
              ['Z_n', 'neutral impedance (0 solid, R, jX; open if unearthed)', 'Ω'],
              ['C₀', 'capacitance of each phase to earth', 'F'],
              ['Z₀g', 'the generator’s own zero-sequence impedance (Module 4)', 'Ω'],
            ]}
            assume="Module 4’s sequence model; capacitance lumped at the terminals; lossless coil"
          />
          <Calc
            title={`Worked example: Petersen coil for C₀ = ${EARTH0.c0uF} µF`}
            steps={[
              { label: 'X_L = 1/(3ωC₀)', expr: `1/(3 × 314.16 × ${EARTH0.c0uF}×10⁻⁶)`, result: `${fx(petersenClassic(EARTH0.c0uF), 1)} Ω` },
              { label: 'with the generator’s X₀', expr: `(1/(ωC₀) − ${fx(X0G_OHM, 3)})/3`, result: `${fx(petersenExact(EARTH0.c0uF), 1)} Ω` },
              { label: 'Capacitive current it cancels', expr: '3ωC₀·V_ph', result: amps(capacitiveCurrent(EARTH0.c0uF)) },
            ]}
          />
        </>
      ),
    },
    {
      title: 'Generator protection: the stator earth fault',
      visual: (
        <Plot
          series={[{ id: 'vn', label: 'V_N', color: 'var(--accent)', points: statorPts }]}
          xLabel="Fault position from the neutral [%]"
          yLabel="Neutral voltage [% of V_ph]"
          hlines={[{ y: STATOR0.kPct, label: `relay ${STATOR0.kPct} %` }]}
          xDomain={[0, 100]}
          label="Neutral voltage against fault position"
        />
      ),
      body: (
        <>
          <p>
            A large generator is earthed through a high resistance so that an internal earth fault draws only a few amperes (here {amps(statorFault(1, STATOR0).iFaultA)} at the terminals) instead of
            tens of kiloamperes. The winding’s emf rises evenly from the neutral to the terminal; a fault x of the way along pins that point to earth, so the neutral is pushed to x·V_ph.
          </p>
          <p>
            A neutral overvoltage relay set at k % of V_ph therefore protects the (100 − k) % nearest the terminals: at {STATOR0.kPct} %, {fx(cov.protectedPct, 0)} %. The last few per cent near the
            neutral need a different scheme (third-harmonic or injection — explained in Explore). Loss of excitation and reverse power are explained there too.
          </p>
          <p className="small muted">Generator protection is in the VIT elective BEEE401E — supplementary for you.</p>
        </>
      ),
      work: (
        <Eq
          expr="V_N = x·V_ph·|Z_N| / |Z_N + R_f|   ⇒ protected = 1 − k (R_f = 0)"
          where={[
            ['x', 'fault position from the neutral (0 to 1)', '–'],
            ['Z_N', 'neutral resistor in parallel with the capacitance 3C₀', 'Ω'],
            ['k', 'relay setting as a fraction of V_ph', '–'],
          ]}
          assume="emf spread evenly along the winding; winding impedance drop neglected"
        />
      ),
    },
    {
      title: 'Circuit breakers: interrupting at a current zero',
      visual: (
        <Plot
          series={[{ id: 'trv', label: 'v(t)', color: 'var(--accent)', points: trvPts }]}
          xLabel="Time after the current zero [µs]"
          yLabel="Voltage across the contacts [kV]"
          hlines={[{ y: (2 * duty.vPeakV) / 1000, label: '2 V_m' }]}
          label="Transient recovery voltage at CB1"
        />
      ),
      body: (
        <>
          <p>
            When the contacts part, the current carries on through an <b>arc</b> of hot, ionised gas. An a.c. arc dies at every current zero; the breaker’s job is to cool and de-ionise the gap so fast
            that it cannot re-ignite. Right after the zero, the source’s inductance and the capacitance next to the breaker ring: the voltage across the gap — the <b>restriking (recovery) voltage</b>{' '}
            — rushes towards twice the peak.
          </p>
          <p>
            For CB1 at A (220 kV): Module 4’s fault level gives L = {fx(duty.lH * 1000, 1)} mH; with 10 nF the ring is at {fx(trv.f0 / 1000, 2)} kHz, peaking at {fx(trv.peakV / 1000, 0)} kV and rising
            at up to {fx(trv.rrrv / 1e9, 2)} kV/µs. A resistor across the contacts (critical {fx(rCritical(duty.lH, 10e-9), 0)} Ω) damps it.
          </p>
          <p>
            <b>Breaking current</b> = the symmetrical fault current it must interrupt: {fx(duty.iSymKa, 2)} kA (Module 4). <b>Making current</b> = the first peak if it closes onto a fault, with full
            DC offset: textbook 1.8 × √2 = 2.55 × I; for this bus’s X/R of {fx(xr, 0)} the computed factor is {fx(pf, 3)} × √2.
          </p>
          <p>
            <a className="ps-link" href={M4_HREF}>
              Fault currents and overcurrent grading: Module 4 →
            </a>
          </p>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Explore it yourself →
          </button>
        </>
      ),
      work: (
        <>
          <Eq
            expr="L·C·v″ + v = V_m  ⇒  v(t) = V_m(1 − cos ω₀t),  ω₀ = 1/√(LC);  peak 2V_m at π/ω₀;  RRRV = V_m·ω₀"
            where={[
              ['V_m', 'source voltage at the current zero (its peak, √2·V/√3)', 'V'],
              ['L', 'source inductance, from the fault level: X₁/ω', 'H'],
              ['C', 'capacitance at the breaker', 'F'],
            ]}
            assume="ideal interruption at the current zero, lossless L and C, V_m constant over the transient; dv/dt = V_m ω₀ sin ω₀t is largest at t = π/(2ω₀)"
          />
          <Calc
            title="Worked example: CB1, C = 10 nF"
            steps={[
              { label: 'ω₀', expr: `1/√(${fx(duty.lH, 4)} × 10⁻⁸)`, result: `${fx(trv.w0, 0)} rad/s` },
              { label: 'Peak', expr: `2 × ${fx(duty.vPeakV / 1000, 2)} kV`, result: `${fx(trv.peakV / 1000, 1)} kV` },
              { label: 'RRRV', expr: `${fx(duty.vPeakV / 1000, 2)} kV × ${fx(trv.w0, 0)} /s`, result: `${fx(trv.rrrv / 1e9, 3)} kV/µs` },
              { label: 'Making current', expr: `2.55 × ${fx(duty.iSymKa, 3)} kA (textbook)`, result: `${fx(2.55 * duty.iSymKa, 2)} kA` },
            ]}
          />
          {level === 'engineer' && (
            <p className="small muted">
              Where 1.8 comes from: the fully offset current is √2·I·(e^(−ωt/(X/R)) − cos ωt); its first peak, near ωt = π, is ≈ √2·I·(1 + e^(−π/(X/R))). That equals 1.8 × √2·I when X/R ≈{' '}
              {fx(xrForDoubling(TEXTBOOK_DOUBLING), 1)}.
            </p>
          )}
          <p className="small muted">Arc physics and breaker types are explained in Explore; circuit breakers are in GATE EE and the VIT elective BEEE401E (supplementary for you).</p>
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(() => `Learn mode — advanced protection, step ${step + 1} of ${steps.length}: ${cur.title}. Default case: ${outcomeText(c70)}`)
  return (
    <div className="ps-split pr-learn">
      <div className="pr-learn-visual">
        {cur.visual}
        {cur.work}
      </div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}
