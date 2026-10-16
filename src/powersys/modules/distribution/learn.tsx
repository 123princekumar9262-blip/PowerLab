import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { abs } from '../../engine/complex.ts'
import { completeActivity } from '../../progress.ts'
import { fx, ph } from '../../ui/format.ts'
import { Calc, Eq, Slider, Stepper, useTutorContext } from '../../ui/kit.tsx'
import { Plot } from '../../ui/Plot.tsx'
import { defaultAc, solveAc, type AcOk } from './acdist.ts'
import { AcPhasors } from './AcLab.tsx'
import { DistributorDiagram, VoltageProfile } from './DistributorDiagram.tsx'
import { areaFor, defaultDc, loopPerM, RHO, solveDc, uniformDropAt, type DcDistributor, type DcOk } from './distributor.ts'
import { DEFAULT_KELVIN, kelvinArea, kelvinCost } from './kelvin.ts'
import { annualCost, DEFAULT_FEEDER, DEFAULT_PF, DEFAULT_TARIFF, economicPf, pfCorrection, solveFeeder, type PfOk } from './pf.ts'
import { Illus, MODULE, rupees, SyllabusNote } from './shared.tsx'
import { KelvinChart, LayoutsDiagram, PfCostChart, PowerTriangle, StructureDiagram } from './visuals.tsx'
import { changeWords, pctWords, placeWords, ratioWords } from './words.ts'

const okDc = (r: ReturnType<typeof solveDc>) => r as DcOk
const deg = (x: number) => (x * 180) / Math.PI

/** Learn: from "why does the last house's voltage sag?" to capacitor banks and the economical power factor. */
export function Learn({ onExplore }: { onExplore(): void }) {
  const level = useLevel()
  const [step, setStep] = useState(0)
  const [vb, setVb] = useState(220)
  const data = useMemo(() => {
    const one = defaultDc('one')
    const r1 = okDc(solveDc(one))
    const ring = defaultDc('ring')
    const rr = okDc(solveDc(ring))
    const uni: DcDistributor = { L: 400, rCond: 0.1, VA: 220, VB: 220, feed: 'one', loads: [], i: 0.5 }
    const ru = okDc(solveDc(uni))
    const far: DcDistributor = { ...uni, i: 0, loads: [{ id: 'F', x: 400, I: 200 }] }
    const rf = okDc(solveDc(far))
    const ac = defaultAc()
    const aA = solveAc(ac, 'receiving') as AcOk
    const aB = solveAc(ac, 'own') as AcOk
    const pf = pfCorrection(DEFAULT_PF) as PfOk
    const lead = pfCorrection({ ...DEFAULT_PF, pf2: 0.9, lead2: true }) as PfOk
    const unity = pfCorrection({ ...DEFAULT_PF, pf2: 1 }) as PfOk
    const econ = economicPf(DEFAULT_PF.pf1, DEFAULT_TARIFF)
    const f0 = solveFeeder(DEFAULT_FEEDER, DEFAULT_PF.P, pf.Q1, 0)
    const f1 = solveFeeder(DEFAULT_FEEDER, DEFAULT_PF.P, pf.Q1, pf.Qc)
    const ka = kelvinArea(DEFAULT_KELVIN)
    return { one, r1, ring, rr, uni, ru, far, rf, ac, aA, aB, pf, lead, unity, econ, f0, f1, ka }
  }, [])
  const { one, r1, ring, rr, uni, ru, far, rf, ac, aA, aB, pf, lead, unity, econ, f0, f1, ka } = data
  const both = useMemo(() => ({ ...defaultDc('both'), VB: vb }), [vb])
  const r2 = useMemo(() => okDc(solveDc(both)), [both])
  const rl = loopPerM(one.rCond)
  const sumIx = one.loads.reduce((s, l) => s + l.I * l.x, 0)
  const sumIL = both.loads.reduce((s, l) => s + l.I * (both.L - l.x), 0)
  const limit = 0.05
  const rNeed = (limit * one.VA) / ((2 * sumIx) / 1000) // per-conductor Ω/km that gives a 5 % drop
  const kc = kelvinCost(DEFAULT_KELVIN, ka)
  const cE = annualCost(DEFAULT_PF.P, DEFAULT_PF.pf1, econ.pf, DEFAULT_TARIFF)
  const cU = annualCost(DEFAULT_PF.P, DEFAULT_PF.pf1, 1, DEFAULT_TARIFF)
  const cN = annualCost(DEFAULT_PF.P, DEFAULT_PF.pf1, DEFAULT_PF.pf1, DEFAULT_TARIFF)

  const steps: Array<{ title: string; figure: ReactNode; body: ReactNode }> = [
    {
      title: 'The last house on the street',
      figure: (
        <div className="ds-figure">
          <Illus>how electricity reaches a house (not to scale; typical voltages)</Illus>
          <StructureDiagram />
        </div>
      ),
      body: (
        <>
          <p className="ds-big">Why does the voltage at the last house on a street feeder sag in the evening — and why do factories pay to install capacitor banks?</p>
          <p>
            Between the distribution substation and your socket, power travels along conductors that have resistance. Every ampere that flows through them drops a little voltage. In the evening
            everybody switches on, the currents rise, and the house at the far end — whose current has travelled furthest — sees the lowest voltage.
          </p>
          <p>
            The <b>feeder</b> carries power from the substation to a feeding point; nothing is connected along it. The <b>distributor</b> runs along the street and has consumers tapped off all along
            it. The <b>service mains</b> are the short connections from the distributor into each building.
          </p>
          <p className="small muted">This module is named in both of your syllabi (from the verified mapping):</p>
          <SyllabusNote />
        </>
      ),
    },
    {
      title: 'Radial, ring and interconnected',
      figure: (
        <div className="ds-figure">
          <Illus>three ways to lay out a distribution system</Illus>
          <LayoutsDiagram />
        </div>
      ),
      body: (
        <>
          <p>
            The same street can be fed in different ways. A <b>radial</b> system is the cheapest but the least secure. A <b>ring main</b> feeds every point from two directions. An{' '}
            <b>interconnected</b> system adds more than one source.
          </p>
          <p>
            <b>Overhead or underground?</b> Overhead lines are cheaper and faults are easy to find and repair; underground cables cost more but are safe, out of sight and out of the weather — the
            usual choice in dense cities.
          </p>
          <p>
            <b>AC or DC?</b> Almost all distribution is three-phase AC, because transformers change its voltage easily (11 kV feeders, 400 V / 230 V distributors). DC distribution is studied because
            it is the clearest way to learn how drops add up along a distributor, and DC is used where loads need it (traction, battery and solar systems). The method you learn on DC carries straight
            over to AC once currents and impedances become complex.
          </p>
        </>
      ),
    },
    {
      title: 'A distributor fed at one end',
      figure: (
        <div className="ds-figure">
          <DistributorDiagram d={one} r={r1} label="The distributor fed at A — calculated" />
          <VoltageProfile d={one} r={r1} height={200} />
        </div>
      ),
      body: (
        <>
          <p>
            A two-wire DC distributor, {one.L} m long, fed at A at {one.VA} V, with four loads (illustrative values). The section next to A carries <b>every</b> load’s current; each later section
            carries only the loads beyond it (
            {r1.sections
              .filter((s) => s.Iin > 0)
              .map((s) => fx(s.Iin, 0))
              .join(' → ')}{' '}
            A). So the voltage falls fastest near A, and keeps falling until the last load.
          </p>
          <Eq
            title="Voltage drop along a distributor"
            expr="V(x) = V_A − Σ (section current × loop resistance of that section),   R_loop = 2·r·ℓ"
            where={[
              ['V_A', 'voltage at the feeding point (known)', 'V'],
              ['r', 'resistance of ONE conductor per km (known)', 'Ω/km'],
              ['ℓ', 'length of the section', 'km'],
              ['section current', 'sum of all the load currents beyond that section (found by KCL)', 'A'],
            ]}
            assume="loads are constant currents; conductor resistance only (DC); the two conductors are identical"
          />
          <Calc
            title="Worked example: the lowest voltage"
            steps={[
              { label: 'Loop resistance', expr: `2 × ${one.rCond} Ω/km`, result: `${fx(rl * 1000, 2)} Ω/km = ${fx(rl, 4)} Ω/m` },
              ...r1.sections
                .filter((s) => s.Iin > 0)
                .map((s) => ({ label: `${fx(s.x0, 0)}–${fx(s.x1, 0)} m`, expr: `${fx(s.Iin, 0)} A × ${fx(rl, 4)} × ${fx(s.x1 - s.x0, 0)}`, result: `${fx(s.drop, 2)} V` })),
              { label: 'Lowest voltage', expr: `${one.VA} − ${fx(one.VA - r1.minV, 2)}`, result: `${fx(r1.minV, 2)} V, ${pctWords((one.VA - r1.minV) / one.VA)} drop` },
            ]}
          />
          <p className="ds-mistake">
            <b>Classic mistake:</b> the current goes out on one conductor and returns on the other. If a problem gives the resistance “per conductor”, double it; if it gives the “loop” resistance, do
            not. Here using r instead of 2r would give a drop of {fx((one.VA - r1.minV) / 2, 2)} V — half the true {fx(one.VA - r1.minV, 2)} V.
          </p>
          <details className="ps-more" open={level === 'engineer'}>
            <summary>The same answer by moments</summary>
            <p>
              Each load’s current flows from A to its own point, so the total drop to the far end is 2r·Σ I_k·x_k = {fx(rl, 4)} × {fx(sumIx, 0)} = {fx(rl * sumIx, 2)} V — the same number, without
              finding the section currents.
            </p>
          </details>
        </>
      ),
    },
    {
      title: 'Fed at both ends: where is the lowest voltage?',
      figure: (
        <div className="ds-figure">
          <DistributorDiagram d={both} r={r2} label="The distributor fed at both ends — calculated" />
          <VoltageProfile d={both} r={r2} height={200} />
        </div>
      ),
      body: (
        <>
          <p>
            Connect end B to a supply too. Now each load can be fed from both sides, and somewhere the current coming from A meets the current coming from B. At that point the current changes
            direction — and the voltage is lowest there: the <b>point of minimum potential</b>.
          </p>
          <Slider label="V_B (try it)" value={vb} min={214} max={226} step={0.5} unit="V" decimals={1} onChange={setVb} />
          <Eq
            title="Current supplied by A"
            expr="I_A = [ (V_A − V_B) + 2r·Σ I_k·(L − x_k) ] / (2r·L)"
            where={[
              ['V_A, V_B', 'the two feeding voltages (known)', 'V'],
              ['L', 'length A → B', 'm'],
              ['I_k, x_k', 'each load and its distance from A (known)', 'A, m'],
              ['I_A', 'current from A (unknown); I_B = Σ I_k − I_A', 'A'],
            ]}
            assume="the drop from A to B along the distributor must equal V_A − V_B (KVL)"
          />
          <Calc
            title={`Worked example: V_A = 220 V, V_B = ${fx(vb, 1)} V`}
            steps={[
              { label: 'Σ I·(L − x)', expr: both.loads.map((l) => `${l.I}×${both.L - l.x}`).join(' + '), result: `${fx(sumIL, 0)} A·m` },
              { label: 'I_A', expr: `[${fx(220 - vb, 1)} + ${fx(rl, 4)} × ${fx(sumIL, 0)}] / (${fx(rl, 4)} × ${both.L})`, result: `${fx(r2.IA, 2)} A` },
              { label: 'I_B', expr: `${fx(r2.totalLoad, 0)} − ${fx(r2.IA, 2)}`, result: `${fx(r2.IB, 2)} A` },
              { label: 'Section currents', expr: 'subtract each load in turn', result: `${r2.sections.map((s) => fx(s.Iin, 1)).join(' → ')} A` },
              { label: 'Minimum potential', expr: 'where the current reverses', result: `${placeWords(r2.minKind, r2.minX, r2.minIds, both.L)}: ${fx(r2.minV, 2)} V` },
            ]}
          />
          <p className="small muted">
            Move V_B:{' '}
            {r2.IA < 0
              ? 'with V_B this high, A no longer supplies anything — it receives current, and A itself is the lowest point.'
              : 'a higher V_B pushes current back towards A, so the meeting point moves towards A.'}
          </p>
        </>
      ),
    },
    {
      title: 'A uniformly loaded distributor',
      figure: (
        <div className="ds-figure">
          <Plot
            label="Voltage along a 400 m distributor: 200 A spread uniformly, and 200 A at the far end"
            series={[
              { id: 'u', label: '0.5 A/m uniform', color: 'var(--ps-c)', points: Array.from({ length: 81 }, (_, k) => [k * 5, ru.V(k * 5)] as [number, number]) },
              { id: 'f', label: '200 A at the end', color: 'var(--ps-a)', points: Array.from({ length: 81 }, (_, k) => [k * 5, rf.V(k * 5)] as [number, number]), dashed: true },
            ]}
            xLabel="Distance from A [m]"
            yLabel="Voltage [V]"
            xDomain={[0, 400]}
            height={240}
          />
        </div>
      ),
      body: (
        <>
          <p>
            A street with many small consumers is close to a <b>uniform</b> load: i amperes per metre. The current is no longer constant between loads; it falls linearly, from i·L at A to zero at the
            far end.
          </p>
          <Eq
            title="Drop on a uniformly loaded distributor fed at one end"
            expr="drop(x) = i·r·(L·x − x²/2),   total drop = i·r·L²/2   (r = loop resistance per metre)"
            where={[
              ['i', 'load per metre (known)', 'A/m'],
              ['r', 'LOOP resistance per metre = 2 × per-conductor value', 'Ω/m'],
              ['L', 'length', 'm'],
            ]}
            assume="the load is spread evenly along the whole length; DC (or unity power factor and R only)"
          />
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>Derivation</summary>
            <p>
              At a point x the current still to be delivered is I(x) = i(L − x). Over a small length dx it drops dV = I(x)·r·dx. Integrating from 0 to x: drop(x) = i·r·∫₀ˣ (L − s) ds = i·r·(L·x −
              x²/2). At x = L this is i·r·L²/2 = (i·L)·r·(L/2): the whole load i·L acting at the <b>middle</b>.
            </p>
          </details>
          <Calc
            title="Worked example: 0.5 A/m over 400 m, 0.1 Ω/km per conductor"
            steps={[
              { label: 'r (loop)', expr: '2 × 0.1 Ω/km', result: `${fx(loopPerM(uni.rCond), 4)} Ω/m` },
              { label: 'Drop at 200 m', expr: `0.5 × ${fx(loopPerM(uni.rCond), 4)} × (400·200 − 200²/2)`, result: `${fx(uniformDropAt(uni.i, loopPerM(uni.rCond), uni.L, 200), 3)} V` },
              { label: 'Total drop', expr: `0.5 × ${fx(loopPerM(uni.rCond), 4)} × 400² / 2`, result: `${fx(uni.VA - ru.minV, 3)} V` },
              { label: 'All 200 A at the end', expr: `200 × ${fx(loopPerM(uni.rCond), 4)} × 400`, result: `${fx(far.VA - rf.minV, 3)} V` },
              { label: 'Ratio', expr: 'uniform / at the end', result: ratioWords((uni.VA - ru.minV) / (far.VA - rf.minV)) },
            ]}
          />
          <p className="small muted">Half of the drop happens in the first {fx(400 * (1 - Math.SQRT1_2), 0)} m (where the current is largest) — the curve is steep near A and flat at the end.</p>
        </>
      ),
    },
    {
      title: 'A ring main',
      figure: (
        <div className="ds-figure">
          <DistributorDiagram d={ring} r={rr} label="The ring main, opened out at its feed point — calculated" />
        </div>
      ),
      body: (
        <>
          <p>
            A ring main fed at one point A: go round the ring and you come back to A. Cut it open at A and lay it out straight — it is a distributor fed at <b>both ends with the same voltage</b>.
            Every result of the last step applies with V_B = V_A.
          </p>
          <p>
            For the same four loads on a {ring.L} m ring, end A sends {fx(rr.IA, 2)} A one way round and {fx(rr.IB, 2)} A the other; the lowest voltage is {fx(rr.minV, 2)} V{' '}
            {placeWords(rr.minKind, rr.minX, rr.minIds, ring.L)}, against {fx(r1.minV, 2)} V on the radial distributor fed at one end — the largest drop{' '}
            {changeWords(one.VA - r1.minV, ring.VA - rr.minV)}.
          </p>
          <p className="small muted">Real rings often add an interconnector across the ring to share the load further; the method is the same (Kirchhoff’s laws), with one more unknown current.</p>
        </>
      ),
    },
    {
      title: 'AC distributors: which voltage is the power factor measured from?',
      figure: (
        <div className="ds-figure">
          <AcPhasors d={ac} r={aB} />
          <p className="small muted">
            Convention (b) drawn: each load current lags its own node voltage. To scale; V_B is the reference (0°); left: the drop V_A − V_B only, built section by section.
          </p>
        </div>
      ),
      body: (
        <>
          <p>
            In an AC distributor every load current has a <b>phase</b> as well as a size, and the conductors have reactance as well as resistance. The drops are complex: I·Z per section. A load’s
            power factor tells you the angle between its current and <b>a voltage</b> — but which one? Examination problems say it in one of two ways:
          </p>
          <ul className="small">
            <li>
              (a) <b>referred to the receiving-end voltage V_B</b>: every current is drawn from the same reference;
            </li>
            <li>
              (b) <b>referred to the load’s own voltage</b>: each current lags its own node voltage, which you must find first, working back from B.
            </li>
          </ul>
          <Calc
            title={`Worked example: two loads, ${ac.L} m, z = ${ac.R} + j${ac.X} Ω/km (loop), V_B = ${ac.VB} V`}
            steps={[
              { label: 'Loads', expr: ac.loads.map((l) => `${l.id}: ${l.I} A at pf ${l.pf} lag, ${l.x} m`).join('; '), result: 'V_B = reference' },
              {
                label: '(a) V_A',
                expr: `V_B + I_${ac.loads[1].id}·z·ℓ_CB + (I_${ac.loads[0].id} + I_${ac.loads[1].id})·z·ℓ_AC`,
                result: `${ph(abs(aA.VA), deg(Math.atan2(aA.VA.im, aA.VA.re)), 3, 3)} V`,
              },
              { label: '(b) V_A', expr: `same, with I_${ac.loads[0].id} lagging V_${ac.loads[0].id} instead of V_B`, result: `${ph(abs(aB.VA), deg(Math.atan2(aB.VA.im, aB.VA.re)), 3, 3)} V` },
              { label: 'Difference', expr: '|V_A(b)| − |V_A(a)|', result: `${fx(abs(aB.VA) - abs(aA.VA), 3)} V` },
            ]}
          />
          <p className="small muted">
            Here the difference is {pctWords(Math.abs(abs(aB.VA) - abs(aA.VA)) / Math.abs(aA.drop))} of the {fx(aA.drop, 2)} V drop: it grows with the angle by which the node voltages lead V_B. Read
            the question carefully — the method changes, even when the answer changes little.
          </p>
        </>
      ),
    },
    {
      title: 'Sizing a conductor: current, voltage drop and Kelvin’s law',
      figure: (
        <div className="ds-figure">
          <KelvinChart q={DEFAULT_KELVIN} height={250} />
          <p className="small muted">Illustrative costs, per km of route and per conductor.</p>
        </div>
      ),
      body: (
        <>
          <p>
            A conductor must (1) carry its current without overheating — its <b>current rating</b>, from the manufacturer’s tables; (2) keep the <b>voltage drop</b> acceptable — the rule for
            distributors; and (3) not cost more than it must over its life — <b>Kelvin’s law</b>, for feeders that carry heavy current for many hours.
          </p>
          <Calc
            title="Sizing by voltage drop: the one-end distributor, for at most 5 % (a limit chosen here, not a standard)"
            steps={[
              { label: 'Allowed drop', expr: `5 % of ${one.VA} V`, result: `${fx(limit * one.VA, 1)} V` },
              { label: 'Largest r', expr: `${fx(limit * one.VA, 1)} / (2 × Σ I·x) = ${fx(limit * one.VA, 1)} / (2 × ${fx(sumIx / 1000, 1)} A·km)`, result: `${fx(rNeed, 4)} Ω/km per conductor` },
              { label: 'Copper area', expr: `ρ·1000/r = ${RHO.copper} × 1000 / ${fx(rNeed, 4)}`, result: `${fx(areaFor(rNeed, RHO.copper), 1)} mm²` },
            ]}
          />
          <Eq
            title="Kelvin’s law"
            expr="annual cost of energy lost = annual interest + depreciation on the part of the capital proportional to the cross-section  →  a* = I·√(ρ·T·c / (p·k))"
            where={[
              ['I', 'equivalent current: flowing T hours a year, it gives the year’s I²·t', 'A'],
              ['T', 'hours per year that I flows', 'h'],
              ['c', 'price of energy', '₹/kWh'],
              ['ρ', 'resistivity', 'Ω·mm²/m'],
              ['k', 'conductor cost proportional to area', '₹/(mm²·km)'],
              ['p', 'interest + depreciation', 'per year'],
            ]}
            assume="the variable capital cost is linear in a; voltage drop, current rating and corona are ignored"
          />
          <Calc
            title="Worked example (illustrative values)"
            steps={[
              { label: 'a*', expr: `150 × √(0.0282 × 3000 × 8 / (0.1 × 2000))`, result: `${fx(ka, 1)} mm²` },
              { label: 'Each annual cost', expr: 'p·k·a*  =  I²·(1000ρ/a*)·T·c/1000', result: `${rupees(kc.capital)} = ${rupees(kc.energy)} per km` },
            ]}
          />
          <details className="ps-more" open={level === 'engineer'}>
            <summary>Why the two costs are equal at the optimum</summary>
            <p>Total = A·a + B/a. d(Total)/da = A − B/a² = 0 gives a² = B/A, and then A·a = B/a: the part that rises with a equals the part that falls with a.</p>
          </details>
        </>
      ),
    },
    {
      title: 'Why a low power factor costs money',
      figure: (
        <div className="ds-figure">
          <PowerTriangle P={DEFAULT_PF.P} r={pf} height={280} />
        </div>
      ),
      body: (
        <>
          <p>
            A motor needs reactive power to magnetise its iron. That reactive current does no useful work, but it flows through every cable and transformer back to the generator. For the same real
            power, a lower power factor means <b>more current</b>: more I²R loss, more voltage drop, bigger kVA ratings — and, under a kVA maximum-demand tariff, a bigger bill.
          </p>
          <p>
            A capacitor bank at the factory supplies that reactive power locally. P does not change; Q and S shrink. Here: {DEFAULT_PF.P} kW at {DEFAULT_PF.pf1} → {DEFAULT_PF.pf2} lagging, 400 V, 50
            Hz (illustrative).
          </p>
          <Eq
            title="Capacitor bank and capacitance per phase"
            expr="Q_c = P·(tan φ₁ − tan φ₂);   star: C = Q_c / (3ω·V_ph²) = Q_c / (ω·V_LL²);   delta: C = Q_c / (3ω·V_LL²)"
            where={[
              ['P', 'real power of the load (unchanged)', 'kW'],
              ['φ₁, φ₂', 'angles before and after: cos φ is the power factor', '°'],
              ['Q_c', 'reactive power the bank must supply', 'kVAr'],
              ['ω', '2πf', 'rad/s'],
              ['C', 'capacitance in each phase', 'F'],
            ]}
            assume="balanced three-phase load; capacitors at their rated voltage"
          />
          <Calc
            title="Worked example"
            steps={[
              { label: 'Q_c', expr: `${DEFAULT_PF.P} × (${fx(Math.tan(pf.phi1), 4)} − ${fx(Math.tan(pf.phi2), 4)})`, result: `${fx(pf.Qc, 1)} kVAr` },
              { label: 'Star, per phase', expr: `${fx(pf.Qc * 1000, 0)} / (${fx(2 * Math.PI * 50, 2)} × 400²)`, result: `${fx(pf.Cstar, 1)} µF at ${fx(pf.VcapStar, 0)} V` },
              { label: 'Delta, per phase', expr: `${fx(pf.Qc * 1000, 0)} / (3 × ${fx(2 * Math.PI * 50, 2)} × 400²)`, result: `${fx(pf.Cdelta, 1)} µF at 400 V` },
              { label: 'Line current', expr: `P/(√3·V·cos φ)`, result: `${fx(pf.I1, 1)} → ${fx(pf.I2, 1)} A (${changeWords(pf.I1, pf.I2)})` },
              ...(f0.ok && f1.ok
                ? [
                    {
                      label: 'On a feeder',
                      expr: `415 V source, ${DEFAULT_FEEDER.R} + j${DEFAULT_FEEDER.X} Ω per phase`,
                      result: `load voltage ${fx(f0.VrLL, 1)} → ${fx(f1.VrLL, 1)} V; loss ${fx(f0.loss, 2)} → ${fx(f1.loss, 2)} kW`,
                    },
                  ]
                : []),
            ]}
          />
          <p className="small muted">
            The delta bank needs {ratioWords(pf.Cdelta / pf.Cstar)} of the star capacitance, because each capacitor sees √3 times the voltage — but it must be rated for the line voltage.
          </p>
        </>
      ),
    },
    {
      title: 'How far to correct? The economical power factor',
      figure: (
        <div className="ds-figure">
          <PfCostChart P={DEFAULT_PF.P} pf1={DEFAULT_PF.pf1} t={DEFAULT_TARIFF} econ={econ.pf} target={null} height={250} />
          <p className="small muted">
            Illustrative tariff: x = ₹{DEFAULT_TARIFF.x} per kVA per year, capacitors y = ₹{DEFAULT_TARIFF.y} per kVAr per year — not any utility’s rates.
          </p>
        </div>
      ),
      body: (
        <>
          <p>
            Each kVAr of capacitors costs money every year (interest, depreciation, upkeep), and each kVA of maximum demand saved earns money. Near unity the kVA hardly falls as you add kVAr — so
            correcting all the way to 1.0 is not the cheapest.
          </p>
          <Eq
            title="Most economical power factor"
            expr="minimise  x·P/cos φ₂ + y·P·(tan φ₁ − tan φ₂)   →   sin φ₂ = y/x,   cos φ₂ = √(1 − (y/x)²)"
            where={[
              ['x', 'maximum-demand charge', '₹ per kVA per year'],
              ['y', 'annual cost of the capacitors', '₹ per kVAr per year'],
            ]}
            assume="the tariff charges the kVA of maximum demand; capacitor cost is proportional to kVAr; if y/x ≥ sin φ₁ no correction pays"
          />
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>Derivation</summary>
            <p>
              d/dφ₂ [x·P·sec φ₂ − y·P·tan φ₂] = x·P·sec φ₂·tan φ₂ − y·P·sec² φ₂ = 0 → x·sin φ₂ = y. The second derivative is positive there, so it is a minimum. Notice that P and φ₁ have dropped out:
              the economical power factor depends only on the ratio of the two prices.
            </p>
          </details>
          <Calc
            title="Worked example"
            steps={[
              { label: 'sin φ₂', expr: `${DEFAULT_TARIFF.y}/${DEFAULT_TARIFF.x}`, result: fx(econ.ratio, 3) },
              { label: 'cos φ₂', expr: `√(1 − ${fx(econ.ratio, 3)}²)`, result: `${fx(econ.pf, 4)} lagging` },
              { label: 'Annual cost', expr: 'no correction / economical / unity', result: `${rupees(cN.total)} / ${rupees(cE.total)} / ${rupees(cU.total)}` },
            ]}
          />
          <p>
            <b>Over-correction</b> — going past unity to a leading power factor — is worse still: at 0.9 leading the bank must be {fx(lead.Qc, 1)} kVAr (against {fx(unity.Qc, 1)} kVAr for unity) and
            the line current {changeWords(unity.I2, lead.I2)} again. Leading reactive power raises the voltage, which can become too high at light load.
          </p>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Feed a distributor and size a bank yourself →
          </button>
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — Distribution Systems & Power Factor, step ${step + 1} of ${steps.length}: ${cur.title}. Default DC distributor: 400 m two-wire, 220 V, 0.1 Ω/km per conductor, loads ${one.loads.map((l) => `${l.I} A at ${l.x} m`).join(', ')}; fed at one end the lowest voltage is ${fx(r1.minV, 2)} V; fed at both ends (V_B = ${vb} V) I_A = ${fx(r2.IA, 2)} A, minimum ${fx(r2.minV, 2)} V at ${fx(r2.minX, 0)} m. PF example: 200 kW 0.7 → 0.95 lag, Qc = ${fx(pf.Qc, 1)} kVAr.`,
  )
  return (
    <div className="ps-stack">
      <div className="ds-figure ps-card">{cur.figure}</div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps.map((x) => ({ title: x.title, body: x.body }))} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}
