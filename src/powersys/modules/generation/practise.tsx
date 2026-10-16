import { useMemo } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import {
  etaFromHeatRate,
  fissionEnergyPerKgJ,
  fuelKgPerHour,
  G,
  hydroPowerW,
  J_PER_MWH,
  M_U235,
  MEV_PER_FISSION,
  NA,
  nuclear,
  reservoirEnergyJ,
  RHO_W,
  roundTrip,
  U_MEV,
  type Plants,
  ATOMIC_MASS_U,
} from './calc.ts'
import { DEG, NET, type LabState } from './se.ts'
import { verifyData } from './verify.ts'
import { grp, MODULE, pc, sci } from './shared.tsx'

// ── Verify ────────────────────────────────────────────────────────────────────────────────────────────────────

export function Verify({ plants, lab }: { plants: Plants; lab: LabState }) {
  const progress = usePsProgress()
  const v = useMemo(() => verifyData(plants, lab), [plants, lab])
  useTutorContext(
    () =>
      `Verify mode: hand calculations of heat rate/efficiency/fuel, hydro power, fission energy per kg, pumped-storage round trip and the WLS state estimate, each checked by a second route; plus a bookkeeping (consistency) check.`,
  )
  const { th, hy, nu, pu } = v
  const T = v.plants.thermal
  const Hy = v.plants.hydro
  const Nu = v.plants.nuclear
  const Pu = v.plants.pumped
  const c1 = v.thermal
  const c2 = v.hydro
  const c3 = v.nuclear
  const c4 = v.pumped
  const { ms, G: Gm, t: tv, det, xHand, grad, direct, dx } = v.wls
  const exact = v.exact.se
  const own = v.own
  const seOwn = { ok: v.ownLab }
  const quiz: QuizItem[] = [
    {
      id: 'eta-turn',
      kind: 'number',
      level: 'numerical',
      q: `Your turn: a station has a heat rate of ${grp(th.heatRate, 0)} kJ/kWh. What is its efficiency?`,
      answer: th.eta * 100,
      unit: '%',
      tol: 0.1,
      why: `η = 3600 / ${grp(th.heatRate, 0)} = ${pc(th.eta, 2)}.`,
      mistake: '1 kWh = 3600 kJ: divide 3600 by the heat rate (not the other way round).',
    },
  ]
  const note = own ? 'For the stations as you set them in Explore. ' : 'Some Explore inputs are not valid, so the default stations are checked. '
  return (
    <div className="ps-stack">
      <Callout title="Check the model’s numbers by hand">
        <p>
          {note}
          {seOwn.ok ? 'The state estimate uses your lab’s measurements. ' : 'Your lab’s measurement set is unobservable, so the default set is used for the estimate. '}
          Each numbered block repeats a result by hand and checks it by a second route that starts again from the inputs (so it would catch an error in the model); the last power block is a
          bookkeeping check and says so. {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title={`1 · Coal station: ${grp(T.pMw, 0)} MW, heat rate ${grp(th.heatRate, 0)} kJ/kWh`}
        steps={[
          { label: 'η = 3600 / HR', expr: `3600 / ${grp(th.heatRate, 1)}`, result: pc(th.eta, 3) },
          { label: 'Coal = P · HR / CV', expr: `${grp(T.pMw * 1000, 0)} kW × ${grp(th.heatRate, 1)} / ${grp(T.cvKjKg, 0)}`, result: `${grp(th.fuelKgH, 0)} kg/h` },
        ]}
        check={{
          ok: c1.ok,
          text: `Second route, in SI units: heat in = ${grp(T.pMw, 0)}×10⁶ W × ${grp(th.heatRate, 1)}/3600 = ${sci(c1.heatW, 5)} J/s; ÷ ${grp(T.cvKjKg * 1000, 0)} J/kg = ${fx(c1.kgPerS, 3)} kg/s; × 3600 s = ${grp(c1.fuelSi, 0)} kg/h — the model’s coal flow (to 1 part in 10⁹).`,
        }}
      />
      <Calc
        title={`2 · Hydro: ${grp(Hy.pMw, 0)} MW at ${grp(Hy.headM, 0)} m`}
        steps={[
          { label: 'Q = P / (ρ g H η)', expr: `${grp(Hy.pMw, 0)}×10⁶ / (${RHO_W} × ${G} × ${grp(Hy.headM, 0)} × ${fx(hy.eta, 4)})`, result: `${grp(hy.qM3s, 3)} m³/s` },
          { label: 'Jet speed at the foot, v = √(2gH)', expr: `√(2 × ${G} × ${grp(Hy.headM, 0)})`, result: `${fx(c2.v, 3)} m/s` },
        ]}
        check={{
          ok: c2.ok,
          text: `Second route — kinetic energy instead of height: water falling ${grp(Hy.headM, 0)} m without friction leaves at ${fx(c2.v, 2)} m/s; its kinetic power ½ρQv² = ½ × ${RHO_W} × ${grp(hy.qM3s, 3)} × ${fx(c2.v, 3)}² = ${grp(c2.jetW / 1e6, 3)} MW; × η ${fx(hy.eta, 4)} = ${grp(c2.pMw, 3)} MW, the output asked for.`,
        }}
      />
      <Calc
        title={`3 · Nuclear: ${grp(Nu.pMw, 0)} MW at η_th ${pc(Nu.etaTh)} — U-235 per day`}
        steps={[
          { label: 'Energy per kg (model)', expr: `(1000 / ${M_U235}) × ${sci(NA, 6)} × ${MEV_PER_FISSION} MeV`, result: `${sci(c3.ekA, 5)} J/kg` },
          { label: 'U-235 per day (model)', expr: `${grp(nu.thermalMw, 2)}×10⁶ × 86 400 / ${sci(c3.ekA, 4)}`, result: `${fx(nu.kgPerDay, 4)} kg` },
        ]}
        check={{
          ok: c3.ok,
          text: `Second route — count the atoms: ${sci((Nu.pMw * 1e6) / Nu.etaTh, 4)} W ÷ ${sci(MEV_PER_FISSION * 1.602176634e-13, 4)} J per fission = ${sci(c3.perS, 4)} fissions/s; × 86 400 s = ${sci(c3.perDay, 4)} atoms a day = ${fx(c3.moles, 3)} mol; × ${M_U235} g/mol = ${fx(c3.kg, 4)} kg — the same.`,
        }}
      />
      <Calc
        title="3b · Where the ≈ 200 MeV comes from: one fission from atomic masses"
        steps={[
          { label: 'Before: U-235 + n', expr: `${ATOMIC_MASS_U.U235} + ${ATOMIC_MASS_U.n} u`, result: `${fx(c3.md.before, 7)} u` },
          { label: 'After: Ba-141 + Kr-92 + 3n', expr: `${ATOMIC_MASS_U.Ba141} + ${ATOMIC_MASS_U.Kr92} + 3 × ${ATOMIC_MASS_U.n} u`, result: `${fx(c3.md.after, 7)} u` },
          { label: 'Mass lost Δm', expr: 'before − after', result: `${fx(c3.md.dmU, 5)} u` },
          { label: 'Energy Δm·c²', expr: `${fx(c3.md.dmU, 5)} × ${U_MEV} MeV/u`, result: `${fx(c3.md.mev, 1)} MeV` },
        ]}
        check={{
          ok: c3.mdOk,
          text: `${fx(c3.md.mev, 1)} MeV is ${fx(c3.share * 100, 1)} % of the ${MEV_PER_FISSION} MeV used above (checked to lie within 80–100 %): this is the prompt kinetic energy of the fragments and neutrons for this one split. The rest comes from prompt γ rays and the later radioactive decay of the fission products; other fission pairs differ by a few MeV — so ${MEV_PER_FISSION} MeV is an approximate total. Atomic masses: standard atomic-mass data (AME 2020), rounded.`,
        }}
      />
      <Calc
        title={`4 · Pumped storage: ${grp(Pu.pMw, 0)} MW for ${grp(Pu.hoursPumping, 1)} h, head ${grp(Pu.headM, 0)} m`}
        steps={[
          { label: 'η_rt', expr: `${fx(Pu.etaMotor, 3)} × ${fx(Pu.etaPump, 3)} × ${fx(Pu.etaTurbine, 3)} × ${fx(Pu.etaGen, 3)}`, result: fx(roundTrip(Pu), 5) },
          { label: 'Stored = E_in · η_m · η_p', expr: `${grp(pu.eInMwh, 1)} × ${fx(Pu.etaMotor, 3)} × ${fx(Pu.etaPump, 3)}`, result: `${grp(pu.storedMwh, 2)} MWh` },
          { label: 'E_out = η_rt · E_in', expr: `${fx(roundTrip(Pu), 5)} × ${grp(pu.eInMwh, 1)}`, result: `${grp(pu.eOutMwh, 2)} MWh` },
        ]}
        check={{
          ok: c4.ok,
          text: `Second route — through the water flows: pumping at ${grp(pu.qPump, 2)} m³/s for ${grp(Pu.hoursPumping, 1)} h raises V = ${grp(c4.vol, 0)} m³, so ρgVH = ${grp(c4.storedMwh, 2)} MWh is stored; at the generating flow ${grp(pu.qGen, 2)} m³/s that water runs down in ${fx(c4.hoursDown, 3)} h, delivering ${grp(Pu.pMw, 0)} MW × ${fx(c4.hoursDown, 3)} h = ${grp(c4.eOut, 2)} MWh — the same.`,
        }}
      />
      <Calc
        title="Bookkeeping: every megawatt is accounted for"
        steps={[
          { label: 'Coal: losses + output', expr: `${grp(th.boilerLossMw, 2)} + ${grp(th.condenserMw, 2)} + ${grp(th.genLossMw, 2)} + ${grp(T.pMw, 0)}`, result: `${grp(c1.balance, 2)} MW` },
          { label: 'Pumped storage: losses + returned', expr: `${pu.chain.steps.map((st) => grp(st.loss, 2)).join(' + ')} + ${grp(pu.eOutMwh, 2)}`, result: `${grp(c4.losses + pu.eOutMwh, 2)} MWh` },
        ]}
        check={{
          ok: c1.balanceOk && c4.balanceOk,
          text: `A consistency check, not an independent method: the losses are each stage’s input minus its output, so they must add up to the fuel heat (${grp(th.qInMw, 2)} MW) and to the energy drawn (${grp(pu.eInMwh, 1)} MWh). It confirms nothing is double-counted or lost; it cannot catch a wrong efficiency.`,
        }}
      />
      <Calc
        title={`5 · State estimate: ${ms.length} measurements, normal equations by hand`}
        steps={[
          { label: 'G = HᵀWH', expr: 'Σ hᵢᵀ hᵢ / σᵢ² over the measurements', result: `[[${sci(Gm[0][0], 4)}, ${sci(Gm[0][1], 4)}], [${sci(Gm[1][0], 4)}, ${sci(Gm[1][1], 4)}]]` },
          { label: 'HᵀWz', expr: 'Σ hᵢᵀ zᵢ / σᵢ²', result: `[${sci(tv[0], 4)}, ${sci(tv[1], 4)}]` },
          { label: 'x̂ = G⁻¹ HᵀWz', expr: `2 × 2 inverse, det G = ${sci(det, 4)}`, result: `θ̂₂ ${fx(xHand[0] / DEG, 5)}°, θ̂₃ ${fx(xHand[1] / DEG, 5)}°` },
          { label: 'Optimality Hᵀ W r', expr: 'should be zero at the minimum', result: `[${sci(grad[0], 2)}, ${sci(grad[1], 2)}]` },
        ]}
        check={{
          ok: v.wls.ok,
          text: `Second route — minimise J(x) directly, using only values of J (Newton steps with derivatives from differences of J, then coordinate polishing — no normal equations): θ₂ ${fx(direct.x[0] / DEG, 5)}°, θ₃ ${fx(direct.x[1] / DEG, 5)}°, within ${sci(Math.max(dx, 1e-16), 1)} rad (tolerance 10⁻⁹ rad: J is quadratic, so both reach the same minimum to rounding).`,
        }}
      />
      <Calc
        title="6 · With exact measurements the residuals vanish"
        steps={[
          { label: 'Noise off, no gross error', expr: 'z = H x_true', result: `${exact.meas.length} measurements` },
          { label: 'Largest |residual|', expr: 'max |z − H x̂|', result: `${sci(Math.max(...exact.meas.map((m) => Math.abs(m.r))), 2)} pu` },
          { label: 'J(x̂)', expr: 'Σ r²/σ²', result: sci(exact.J, 2) },
        ]}
        check={{
          ok: v.exact.ok,
          text: `The measurements fit the true state exactly, so x̂ is the true state (θ₂ ${fx(exact.x[0] / DEG, 4)}°, θ₃ ${fx(exact.x[1] / DEG, 4)}°) and every residual is zero to rounding. Residuals come only from meter errors — which is what the bad-data tests rely on.`,
        }}
      />
      <p className="small muted">
        Network for the state-estimate blocks: x₁₂ = {NET.x12}, x₁₃ = {NET.x13}, x₂₃ = {NET.x23} pu, DC model. Constants: 1 u = {U_MEV} MeV, N_A = {sci(NA, 9)} /mol, 1 MeV = 1.602176634 × 10⁻¹³ J.
      </p>
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}

// ── Practise ──────────────────────────────────────────────────────────────────────────────────────────────────

export function Practise() {
  const items = useMemo<QuizItem[]>(() => {
    const coal = fuelKgPerHour(600, 9500, 20000) / 1000
    const pHyd = hydroPowerW(50, 100, 0.9) / 1e6
    const eRes = (reservoirEnergyJ(20e6, 200) * 0.88) / J_PER_MWH
    const ekg = fissionEnergyPerKgJ() / 1e12
    const rt = 1000 * roundTrip({ etaMotor: 0.97, etaPump: 0.88, etaTurbine: 0.9, etaGen: 0.97 })
    const n500 = nuclear({ pMw: 500, etaTh: 0.32 })
    const kg500 = n500.ok ? n500.kgPerDay : NaN
    const w1 = 1 / 0.01 ** 2
    const w2 = 1 / 0.02 ** 2
    const vHat = (w1 * 1.02 + w2 * 0.99) / (w1 + w2)
    const ratioHalf = hydroPowerW(2, 0.5, 1) / hydroPowerW(1, 1, 1)
    return [
      {
        id: 'condenser',
        kind: 'choice',
        level: 'concept',
        q: 'Why does a coal station have a condenser after its turbine?',
        options: [
          { id: 'a', label: 'To heat the feed water before the boiler' },
          { id: 'b', label: 'To turn the exhaust steam back into water at low pressure, so the steam expands further in the turbine — rejecting the heat the cycle cannot convert' },
          { id: 'c', label: 'To remove ash from the steam' },
        ],
        answer: 'b',
        why: 'A low exhaust pressure lets the steam do more work; the heat rejected there is the largest loss of the station.',
        mistake: 'No heat engine converts all its heat to work: some must be rejected to a cold sink — the condenser.',
      },
      {
        id: 'pelton',
        kind: 'choice',
        level: 'concept',
        q: 'A site has a very high head and a small flow. Which turbine is the usual choice?',
        options: [
          { id: 'pelton', label: 'Pelton wheel' },
          { id: 'francis', label: 'Francis turbine' },
          { id: 'kaplan', label: 'Kaplan turbine' },
        ],
        answer: 'pelton',
        why: 'Pelton wheels (jets on buckets) suit high heads with small flows; Francis medium heads; Kaplan low heads with large flows.',
      },
      {
        id: 'moderator',
        kind: 'choice',
        level: 'concept',
        q: 'What does the moderator in a thermal reactor do?',
        options: [
          { id: 'a', label: 'Absorbs neutrons to stop the reaction' },
          { id: 'b', label: 'Slows the fast neutrons from fission so they cause further fissions in U-235 more readily' },
          { id: 'c', label: 'Shields the operators from radiation' },
        ],
        answer: 'b',
        why: 'Control rods absorb neutrons; the moderator (e.g. water) slows them; shielding protects people.',
        mistake: 'Absorbing neutrons is the job of the control rods.',
      },
      {
        id: 'pumped-why',
        kind: 'choice',
        level: 'concept',
        q: 'Over a full day, a pumped-storage station…',
        options: [
          { id: 'a', label: 'produces more energy than it uses' },
          { id: 'b', label: 'uses more energy than it returns, but moves energy from off-peak hours to the peak' },
          { id: 'c', label: 'uses exactly as much as it returns' },
        ],
        answer: 'b',
        why: 'Its round trip is below 100 %; its value is in the timing — see the load curve in Module 11.',
      },
      {
        id: 'pmu',
        kind: 'choice',
        level: 'concept',
        q: 'What can a PMU measure that conventional SCADA cannot?',
        options: [
          { id: 'a', label: 'The voltage magnitude' },
          { id: 'b', label: 'Phasor angles, time-stamped by GPS, so angles at distant substations can be compared at the same instant' },
          { id: 'c', label: 'Breaker status' },
        ],
        answer: 'b',
        why: 'The common GPS time makes the measured angles comparable across the grid, and PMUs stream them much faster than SCADA scans.',
      },
      {
        id: 'critical',
        kind: 'choice',
        level: 'concept',
        q: 'A measurement is "critical" in state estimation when…',
        options: [
          { id: 'a', label: 'it has the largest residual' },
          { id: 'b', label: 'removing it would make the network unobservable — its residual is always zero, so its error cannot be detected' },
          { id: 'c', label: 'it is the most accurate meter' },
        ],
        answer: 'b',
        why: 'The estimate must fit a critical measurement exactly (Ω_ii = 0): no test can see its error.',
      },
      {
        id: 'hr-eta',
        kind: 'number',
        level: 'numerical',
        q: 'A station’s heat rate is 9 000 kJ/kWh. What is its efficiency?',
        answer: etaFromHeatRate(9000) * 100,
        unit: '%',
        tol: 0.1,
        why: `η = 3600 / 9000 = ${fx(etaFromHeatRate(9000) * 100, 1)} %.`,
        mistake: '1 kWh = 3600 kJ.',
      },
      {
        id: 'coal',
        kind: 'number',
        level: 'numerical',
        q: 'A 600 MW unit has a heat rate of 9 500 kJ/kWh and burns coal of 20 000 kJ/kg. How much coal does it burn per hour?',
        answer: coal,
        unit: 't/h',
        tol: 0.5,
        why: `600 000 kW × 9 500 kJ/kWh ÷ 20 000 kJ/kg = ${grp(coal * 1000, 0)} kg/h = ${fx(coal, 1)} t/h.`,
        mistake: 'Use the power in kW so that kW × kJ/kWh gives kJ per hour.',
      },
      {
        id: 'hydro',
        kind: 'number',
        level: 'numerical',
        q: 'A turbine passes 50 m³/s under a head of 100 m with an overall efficiency of 90 %. What is its electrical output?',
        answer: pHyd,
        unit: 'MW',
        tol: 0.1,
        why: `P = 1000 × 9.81 × 50 × 100 × 0.9 = ${fx(pHyd, 2)} MW.`,
        mistake: 'P = ρgQHη gives watts — divide by 10⁶ for MW.',
      },
      {
        id: 'reservoir',
        kind: 'number',
        level: 'university',
        q: 'A reservoir holds 20 million m³ of usable water at a mean head of 200 m. With an overall efficiency of 88 %, how much electrical energy can it give?',
        answer: eRes,
        unit: 'MWh',
        tol: 5,
        why: `E = ρgVHη = 1000 × 9.81 × 20×10⁶ × 200 × 0.88 J = ${grp(eRes, 0)} MWh (1 MWh = 3.6 × 10⁹ J).`,
        mistake: 'Convert joules to MWh by dividing by 3.6 × 10⁹.',
      },
      {
        id: 'fission-kg',
        kind: 'number',
        level: 'university',
        q: 'Taking 200 MeV per fission and M = 235.0439 g/mol, how much energy is released by fissioning 1 kg of U-235?',
        answer: ekg,
        unit: 'TJ',
        tol: 0.5,
        why: `(1000/235.0439) × 6.022×10²³ × 200 × 1.602×10⁻¹³ J = ${fx(ekg, 1)} TJ.`,
        mistake: '1 MeV = 1.602 × 10⁻¹³ J; count atoms with Avogadro’s number on 1000 g.',
      },
      {
        id: 'round-trip',
        kind: 'number',
        level: 'university',
        q: 'A pumped-storage plant: motor 97 %, pump 88 %, turbine 90 %, generator 97 %. If 1000 MWh is drawn for pumping, how much is returned?',
        answer: rt,
        unit: 'MWh',
        tol: 1,
        why: `1000 × 0.97 × 0.88 × 0.90 × 0.97 = ${fx(rt, 1)} MWh (round trip ${fx(rt / 10, 1)} %).`,
        mistake: 'Multiply all four efficiencies: the losses compound.',
      },
      {
        id: 'head-flow',
        kind: 'choice',
        level: 'gate',
        q: 'At another site the head is half and the flow is double (same efficiency). The power is…',
        options: [
          { id: 'half', label: 'half' },
          { id: 'same', label: 'the same' },
          { id: 'double', label: 'double' },
        ],
        answer: Math.abs(ratioHalf - 1) < 1e-12 ? 'same' : ratioHalf < 1 ? 'half' : 'double',
        why: `P ∝ Q·H: 2 × ½ = ${fx(ratioHalf, 2)}.`,
      },
      {
        id: 'nuc-500',
        kind: 'number',
        level: 'gate',
        q: 'A 500 MW (electrical) nuclear station runs at 32 % thermal efficiency. With 200 MeV per fission, how much U-235 does it fission per day?',
        answer: kg500,
        unit: 'kg',
        tol: 0.02,
        why: `Heat 500/0.32 = ${fx(500 / 0.32, 1)} MW; × 86 400 s = ${fx((500 / 0.32) * 0.0864, 1)} TJ; ÷ ${fx(ekg, 1)} TJ/kg = ${fx(kg500, 3)} kg.`,
        mistake: 'Divide by the thermal efficiency first: the reactor makes heat, not electricity.',
      },
      {
        id: 'wls-1',
        kind: 'number',
        level: 'university',
        q: 'Two meters measure the same bus voltage: 1.02 pu (σ = 0.01 pu) and 0.99 pu (σ = 0.02 pu). What is the weighted-least-squares estimate?',
        answer: vHat,
        unit: 'pu',
        tol: 0.0005,
        why: `Weights 1/σ²: ${grp(w1, 0)} and ${grp(w2, 0)}. V̂ = (${grp(w1, 0)} × 1.02 + ${grp(w2, 0)} × 0.99) / ${grp(w1 + w2, 0)} = ${fx(vHat, 4)} pu — closer to the more accurate meter.`,
        mistake: 'Weight by 1/σ², not 1/σ — and not a plain average.',
      },
    ]
  }, [])
  useTutorContext(
    () => 'Practise mode: questions on coal, hydro, nuclear and pumped-storage stations, SCADA/PMU and weighted-least-squares state estimation. Answers come from the module’s calculations.',
  )
  return (
    <div className="ps-card ps-practise">
      <h3>Practice questions</h3>
      <p className="small muted">
        From concept to GATE-style. Every number comes from this module’s calculations; the questions are written for this app. Answer all of them correctly to complete the activity.
      </p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
