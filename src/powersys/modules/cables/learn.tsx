import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity } from '../../progress.ts'
import { statusFor } from '../../syllabus/coverage.ts'
import { TOPICS } from '../../syllabus/topics.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Eq, Stepper, useTutorContext } from '../../ui/kit.tsx'
import {
  beltedByMatrix,
  beltedCharging,
  beltedFromMeasurements,
  capacitanceByCharge,
  capacitanceGraded,
  compareWithLine,
  computeCable,
  DEFAULT_CABLE,
  economicNumeric,
  economicSize,
  EPS0,
  equalPeakRadii,
  G_PERM_DEFAULT,
  insulationByShells,
  intersheathEqualPeak,
  intersheathGraded,
  NUM_TOL,
  potentialAt,
  stressByDerivative,
  timesWords,
  verifyChecks,
  voltageByIntegration,
  type CableInput,
  type CableResult,
  type GradedResult,
} from './calc.ts'
import { CableScene } from './CableScene.tsx'
import { CableSection } from './CableSection.tsx'
import { MODULE, PartInfo, TRANSIENTS_HREF } from './shared.tsx'
import { BeltedFigure, CableTypes, EconomicPlot, GradingPlot, StressLegend, StressPlots } from './visuals.tsx'

function solve(c: CableInput): CableResult {
  const r = computeCable(c)
  if (!r.ok) throw new Error(r.issues[0].message)
  return r
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)

/** "GATE EE Section 6 (partly) · VIT BEEE304L Module 5 (partly)" from the syllabus mapping. */
function SyllabusNote() {
  const t = TOPICS.find((x) => x.id === 'cables')
  if (!t) return null
  const gate = statusFor(t, 'gate-ee')
  const vit = statusFor(t, 'vit-eee')
  const word = (s: string) => (s === 'verified' ? 'named' : s === 'partial' ? 'partly' : s)
  return (
    <p className="small muted cb-syllabus">
      Syllabus: {gate.ref.where ? `GATE EE Section ${gate.ref.where} (${word(gate.status)}: “${gate.ref.quote}”)` : 'GATE EE — not named'}
      {vit.ref.where ? ` · VIT ${vit.ref.where} Module ${vit.ref.unit} (${word(vit.status)}: “${vit.ref.quote}”)` : ''}. Stress, grading and the numericals go beyond the named wording; university
      examinations commonly set them.
    </p>
  )
}

export function Learn({ onExplore }: { onExplore(): void }) {
  const level = useLevel()
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const c0 = DEFAULT_CABLE
  const r0 = useMemo(() => solve(c0), [c0])
  const G = G_PERM_DEFAULT
  const v = c0.vKv
  const xMid = 1.5 // cm, for the worked potential
  const chk = useMemo(() => verifyChecks(r0, G), [r0, G])
  const lengths = useMemo(() => [1, 5, 10, 20].map((l) => solve({ ...c0, lengthKm: l })), [c0])
  const cmp = useMemo(() => compareWithLine(solve({ ...c0, lengthKm: 10 })), [c0])
  const eco = economicSize(v, G)
  const ecoNum = economicNumeric(v, G)
  // grading examples on the default cable
  const epsG = [3.5, c0.epsR]
  const r1 = equalPeakRadii(r0.r, epsG)[0]
  const capG = capacitanceGraded(v, [r0.r, r1, r0.R], epsG) as GradedResult
  const rIs = 1.5
  const pIs = intersheathEqualPeak(v, [r0.r, rIs, r0.R])
  const isG = intersheathGraded(v, [r0.r, rIs, r0.R], pIs, c0.epsR) as GradedResult
  const Ssum = capG.layers.reduce((s, l) => s + Math.log(l.outer / l.inner) / l.eps, 0)
  const wIs = r0.r * Math.log(rIs / r0.r) + rIs * Math.log(r0.R / rIs)
  // belted example (illustrative measurements)
  const bm = { c1: 0.9, c2: 0.6, vll: 11 }
  const bel = beltedFromMeasurements(bm.c1, bm.c2)
  const belOk = bel.ok ? bel : null
  const xs0 = <CableSection res={r0} probeT={0.3} gPerm={G} label="Cross-section of the cable in the picture" />

  const steps: Array<{ title: string; visual: ReactNode; body: ReactNode; work?: ReactNode }> = [
    {
      title: 'Why not just bury a bare conductor?',
      visual: (
        <>
          <CableScene
            res={r0}
            view="stepped"
            probeT={0.3}
            gPerm={G}
            selected={sel}
            onSelect={setSel}
            fallback={xs0}
            info={(id) => <PartInfo id={id} res={r0} probeT={0.3} />}
            height={380}
            label="A single-core underground cable stripped back layer by layer"
          />
          <StressLegend res={r0} gPerm={G} />
        </>
      ),
      body: (
        <>
          <p className="cb-question">Why can’t we just bury an overhead-line conductor — and why does the insulation of a cable fail first right next to the conductor?</p>
          <p>
            An overhead line is insulated by <b>air</b>: metres of it, free, and self-healing after a flashover. Underground there is no air gap. Moist soil conducts, so a bare conductor would
            discharge straight into the earth. A cable therefore carries its <b>own insulation</b> — here {fx(r0.thicknessMm, 0)} mm of it — and closes it inside an <b>earthed metal sheath</b>.
          </p>
          <p>The picture is a single-core cable, each layer stripped back further than the one inside it. From the inside out:</p>
          <ul className="cb-layer-list small">
            <li>
              <b>conductor</b> (copper or aluminium) and a thin semiconducting <b>conductor screen</b> that makes its surface smooth;
            </li>
            <li>
              the <b>insulation</b> that holds the whole voltage, and an <b>insulation screen</b>;
            </li>
            <li>
              the <b>metallic sheath</b> — earthed, it keeps moisture out and the electric field in;
            </li>
            <li>
              <b>bedding</b>, <b>armour</b> (mechanical protection) and the outer <b>serving</b>.
            </li>
          </ul>
          <p>Select any part to see what it does. The insulation is coloured by the computed stress — notice where it is hottest. Step 3 explains why.</p>
          <SyllabusNote />
        </>
      ),
    },
    {
      title: 'Kinds of cable',
      visual: <CableTypes />,
      body: (
        <>
          <p>The same idea — conductor, insulation, sheath — has been built in several ways as voltages rose (the drawings are illustrations):</p>
          <ul className="cb-layer-list small">
            <li>
              <b>Belted</b>: three paper-insulated cores inside a common “belt” of paper and one sheath. The field between the cores is not radial; part of it runs along the paper layers, where paper
              is weakest — so belted cables are kept to the lower distribution voltages.
            </li>
            <li>
              <b>Screened (H-type)</b>: each core has its own thin metallic screen, all touching the earthed sheath. Each core’s field becomes purely radial, as in a single-core cable.
            </li>
            <li>
              <b>SL</b>: each core has its own lead sheath — radial fields, and three sheaths instead of one heavy one.
            </li>
            <li>
              <b>Oil-filled</b> and <b>gas-pressure</b>: at higher voltages tiny voids in paper insulation ionise and erode it. Low-viscosity oil under pressure (through a duct) or gas under pressure
              suppresses those voids.
            </li>
            <li>
              <b>XLPE</b>: extruded cross-linked polyethylene with extruded semiconducting screens — dry, low-loss, and the usual choice for new cables.
            </li>
          </ul>
          <p>The rest of this module works with the single-core (or screened) cable, whose field is radial and can be calculated exactly.</p>
        </>
      ),
    },
    {
      title: 'The field inside: why the stress is highest at the conductor',
      visual: (
        <>
          {xs0}
          <StressPlots res={r0} probeT={(xMid - r0.r) / (r0.R - r0.r)} gPerm={G} height={190} stack />
        </>
      ),
      body: (
        <>
          <p>
            Put a voltage between conductor and sheath and a charge q appears on every metre of conductor. Its electric flux spreads radially outwards and <b>all of it</b> crosses every cylinder
            around the conductor. A cylinder of radius x has a circumference 2πx, so the flux density is D = q/(2πx) — densest on the smallest circle, the conductor surface.
          </p>
          <p>
            The stress (electric field) is g = D/ε. So it is largest at the conductor, {fx(r0.gMax, 2)} kV/cm here, and smallest at the sheath, {fx(r0.gMin, 2)} kV/cm — exactly R/r = {fx(r0.ratio, 2)}{' '}
            times less. That answers the opening question: the insulation next to the conductor carries the highest stress, so that is where it breaks down first.
          </p>
          <p>The dashed circles are equipotentials at 80, 60, 40 and 20 % of V: they crowd towards the conductor, where the potential falls fastest.</p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="g(x) = V / (x · ln(R/r))        V(x) = V · ln(R/x) / ln(R/r)"
            where={[
              ['V', 'core-to-sheath voltage (rms; the phase voltage in a three-phase system)', 'kV'],
              ['x', 'radius in the insulation, r ≤ x ≤ R', 'cm'],
              ['r, R', 'conductor radius (over its screen) and sheath inner radius', 'cm'],
              ['g', 'electric stress (field strength), rms', 'kV/cm'],
              ['g_max, g_min', 'at x = r: V/(r ln(R/r)); at x = R: V/(R ln(R/r))', 'kV/cm'],
            ]}
            assume="a long coaxial cable; one uniform, homogeneous dielectric; conductor and sheath equipotential; no space charge; end effects ignored"
          />
          <Calc
            title={`Worked example: r = ${fx(c0.rMm, 0)} mm, R = ${fx(c0.RMm, 0)} mm, V = ${fx(v, 1)} kV`}
            steps={[
              { label: 'ln(R/r)', expr: `ln(${fx(r0.R, 1)} / ${fx(r0.r, 1)})`, result: fx(r0.ln, 4) },
              { label: 'g_max = V/(r ln(R/r))', expr: `${fx(v, 1)} / (${fx(r0.r, 1)} × ${fx(r0.ln, 4)})`, result: `${fx(r0.gMax, 2)} kV/cm` },
              { label: 'g_min = V/(R ln(R/r))', expr: `${fx(v, 1)} / (${fx(r0.R, 1)} × ${fx(r0.ln, 4)})`, result: `${fx(r0.gMin, 2)} kV/cm` },
              { label: `V at x = ${fx(xMid * 10, 0)} mm`, expr: `${fx(v, 1)} × ln(${fx(r0.R, 1)}/${fx(xMid, 1)}) / ${fx(r0.ln, 4)}`, result: `${fx(potentialAt(v, xMid, r0.r, r0.R), 2)} kV` },
            ]}
            check={{
              ok: chk.gmax.ok && chk.vint.ok,
              text: `Second method: −dV/dx of V(x) at the conductor (numerical) = ${fx(stressByDerivative(v, r0.r, r0.r, r0.R), 4)} kV/cm, and ∫g dx from r to R (Simpson) = ${fx(voltageByIntegration(v, r0.r, r0.R), 4)} kV = V. Agreement within ${NUM_TOL} (relative).`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Capacitance and insulation resistance',
      visual: (
        <div className="table-wrap cb-card-table">
          <table className="ps-table">
            <caption className="small muted">The cable in the picture at four lengths (computed)</caption>
            <thead>
              <tr>
                <th scope="col">Length</th>
                <th scope="col">
                  Capacitance <span className="cb-unit">[µF]</span>
                </th>
                <th scope="col">
                  Insulation resistance <span className="cb-unit">[MΩ]</span>
                </th>
                <th scope="col">
                  Charging current <span className="cb-unit">[A]</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lengths.map((x) => (
                <tr key={x.c.lengthKm}>
                  <td>{x.c.lengthKm} km</td>
                  <td>{fx(x.cUf, 3)}</td>
                  <td>{fx(x.rInsMOhm, 0)}</td>
                  <td>{fx(x.ic, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
      body: (
        <>
          <p>
            The conductor and the sheath are two cylindrical “plates” with the insulation between them: a <b>capacitor</b> all along the cable. The thinner the insulation and the higher its ε_r, the
            more charge per volt.
          </p>
          <p>
            The insulation is not a perfect insulator either: a tiny <b>leakage current</b> flows radially from conductor to sheath. Each thin shell of insulation is in series with the next (from r to
            R), while every metre of cable is in parallel with the others — so a longer cable has a <b>lower</b> insulation resistance (the table: it halves when the length doubles), and it is quoted
            in MΩ·km.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="C = 2π ε₀ ε_r l / ln(R/r)       R_ins = ρ · ln(R/r) / (2π l)"
            where={[
              ['ε₀', `${fx(EPS0 * 1e12, 4)} × 10⁻¹² (free space)`, 'F/m'],
              ['ε_r', 'relative permittivity of the insulation', '—'],
              ['ρ', 'resistivity of the insulation', 'Ω·m'],
              ['l', 'length', 'm'],
            ]}
            assume="the same coaxial, homogeneous model; R_ins uses the dc leakage through the volume of the insulation"
          />
          <Calc
            title={`Worked example: ε_r = ${c0.epsR}, ρ = 10¹⁴ Ω·m (illustrative), 1 km`}
            steps={[
              { label: 'C per metre', expr: `2π × ${fx(EPS0 * 1e12, 4)}×10⁻¹² × ${c0.epsR} / ${fx(r0.ln, 4)}`, result: `${fx(r0.cFm * 1e12, 2)} pF/m` },
              { label: 'C per km', expr: `${fx(r0.cFm * 1e12, 2)} pF/m × 1000 m`, result: `${fx(r0.cUfKm, 4)} µF/km` },
              { label: 'R_ins × length', expr: `10¹⁴ × ${fx(r0.ln, 4)} / (2π)`, result: `${fx(r0.rInsMOhmKm, 0)} MΩ·km` },
              { label: `R_ins for ${c0.lengthKm} km`, expr: `${fx(r0.rInsMOhmKm, 0)} / ${c0.lengthKm}`, result: `${fx(r0.rInsMOhm, 0)} MΩ` },
            ]}
            check={{
              ok: chk.cap.ok && chk.rins.ok,
              text: `Second method: put 1 µC/m on the conductor, integrate Gauss’s field from r to R for V, C = q/V = ${fx(capacitanceByCharge(c0.epsR, r0.r, r0.R) * 1e9, 4)} µF/km; summing thin shells in series, ρ∫dx/(2πx) = ${fx(insulationByShells(c0.rhoOhmM, r0.r, r0.R) / 1e9, 0)} MΩ·km. Both agree within ${NUM_TOL}.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Charging current, dielectric loss — and the overhead line',
      visual: (
        <div className="table-wrap cb-card-table">
          <table className="ps-table">
            <caption className="small muted">10 km at the same phase voltage, {fx(v, 1)} kV (computed; the line is Module 8’s default 400 kV design)</caption>
            <thead>
              <tr>
                <th scope="col">Per phase</th>
                <th scope="col">Overhead line</th>
                <th scope="col">Cable</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Capacitance [nF/km]</td>
                <td>{fx(cmp.cLine, 2)}</td>
                <td>{fx(cmp.cCable, 1)}</td>
              </tr>
              <tr>
                <td>Charging current over 10 km [A]</td>
                <td>{fx(cmp.icLineTotal, 2)}</td>
                <td>{fx(cmp.icCableTotal, 2)}</td>
              </tr>
              <tr>
                <td>Surge impedance [Ω]</td>
                <td>{fx(cmp.zcLine, 1)}</td>
                <td>{fx(cmp.zcCable, 1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ),
      body: (
        <>
          <p>
            On ac the cable’s capacitance is charged and discharged {2 * c0.fHz} times a second: a <b>charging current</b> I_c = ωCV flows even with no load. The insulation also heats a little as it
            is polarised back and forth — the <b>dielectric loss</b>, measured by the loss factor tan δ.
          </p>
          <p>
            Compared with an overhead line the plates are millimetres apart instead of metres, and filled with a dielectric instead of air. Here the cable has {timesWords(cmp.cRatio)} the line’s
            capacitance per km, so {timesWords(cmp.icCableTotal / cmp.icLineTotal)} the charging current. Over a long route the charging current alone fills the conductor’s rating — why long ac cables
            need shunt reactors (or dc).
          </p>
          <p className="small muted">
            The surge impedance is much lower too ({fx(cmp.zcCable, 1)} Ω against {fx(cmp.zcLine, 1)} Ω): a surge passing from a line into a cable is strongly reflected —{' '}
            <a className="ps-link" href={TRANSIENTS_HREF}>
              Module 15
            </a>
            .
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="I_c = ω C V       Q = ω C V²       P = ω C V² tan δ   (per core)"
            where={[
              ['V', 'phase (core-to-sheath) voltage', 'V'],
              ['C', 'capacitance of the length considered', 'F'],
              ['tan δ', 'loss factor of the insulation at the working frequency', '—'],
            ]}
            assume="sinusoidal voltage; tan δ constant; a three-phase circuit of three cores takes three times Q and P"
          />
          <Calc
            title={`Worked example: per km per core, ${c0.fHz} Hz, tan δ = ${c0.tanDelta}`}
            steps={[
              { label: 'ω = 2πf', expr: `2π × ${c0.fHz}`, result: `${fx(r0.omega, 2)} rad/s` },
              { label: 'I_c = ωCV', expr: `${fx(r0.omega, 2)} × ${fx(r0.cUfKm, 4)}×10⁻⁶ × ${fx(v * 1000, 0)}`, result: `${fx(r0.icAKm, 3)} A/km` },
              { label: 'Q = ωCV²', expr: `${fx(r0.icAKm, 3)} × ${fx(v, 1)} kV`, result: `${fx(r0.qKvarKm, 1)} kvar/km` },
              { label: 'P = Q tan δ', expr: `${fx(r0.qKvarKm * 1000, 0)} × ${c0.tanDelta}`, result: `${fx(r0.pWKm, 1)} W/km` },
            ]}
            check={{
              ok: chk.reactive.ok,
              text: `Second method: the average energy stored in the field, ∫½εE²dVol (numerical), is ${fx((r0.qKvarKm * 1000) / (2 * r0.omega), 3)} J/km; Q = 2ω × that = ${fx(chk.reactive.b, 1)} kvar/km — the same within ${NUM_TOL}.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'The most economical conductor size',
      visual: (
        <>
          <EconomicPlot vKv={v} gPerm={G} />
          <p className="small muted">
            Calculated: the sheath radius needed to keep g_max = {G} kV/cm at {fx(v, 1)} kV, for each conductor radius.
          </p>
        </>
      ),
      body: (
        <>
          <p>
            Suppose the insulation may take at most G = {G} kV/cm (a design value). For a given conductor, the sheath must be far enough out to keep g_max ≤ G. A <b>thin</b> conductor has a sharply
            curved surface and needs a lot of insulation; a <b>very thick</b> one is itself large. Somewhere between, the overall cable is smallest.
          </p>
          <p>
            Setting g_max = G gives R = r·e^(V/(G·r)). Its minimum (dR/dr = 0) is at <b>ln(R/r) = 1</b>, i.e. <b>R = e·r</b> with r = V/G: here r = {fx(eco.rCm * 10, 2)} mm and R ={' '}
            {fx(eco.RCm * 10, 2)} mm.
          </p>
          <p className="small muted">
            If the current rating needs a thicker conductor than V/G, the thicker conductor is used and R follows from R = r·e^(V/(G·r)) — then ln(R/r) is below 1. Explore shows this for any r.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="R = r · e^(V/(G r))     dR/dr = e^(V/(G r)) · (1 − V/(G r)) = 0  ⇒  r = V/G,  R = e·r"
            where={[
              ['G', 'permissible maximum stress (rms)', 'kV/cm'],
              ['e', '2.718… (so ln(R/r) = 1)', '—'],
            ]}
            assume="the voltage and the permissible stress are fixed; the conductor size is free (not set by the current)"
          />
          <Calc
            title={`Worked example: V = ${fx(v, 1)} kV, G = ${G} kV/cm`}
            steps={[
              { label: 'r = V/G', expr: `${fx(v, 1)} / ${G}`, result: `${fx(eco.rCm, 4)} cm` },
              { label: 'R = e·r', expr: `2.7183 × ${fx(eco.rCm, 4)}`, result: `${fx(eco.RCm, 4)} cm` },
              { label: 'Diameters', expr: 'd = 2r, D = 2R', result: `${fx(eco.rCm * 20, 2)} mm and ${fx(eco.RCm * 20, 2)} mm` },
            ]}
            check={{
              ok: rel(ecoNum.rCm, eco.rCm) < NUM_TOL,
              text: `Second method: minimising R(r) numerically (golden-section search, no formula) gives r = ${fx(ecoNum.rCm, 4)} cm, R = ${fx(ecoNum.RCm, 4)} cm — the same within ${NUM_TOL}.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Grading: using the insulation evenly',
      visual: (
        <>
          <GradingPlot res={r0} graded={[capG, isG]} extra={['capacitance', 'intersheath']} />
          <p className="small muted">Calculated, for the cable in the picture: both gradings set for equal maximum stress in each layer.</p>
        </>
      ),
      body: (
        <>
          <p>
            With one dielectric the insulation at the sheath works at only {fx((r0.gMin / r0.gMax) * 100, 0)} % of the stress at the conductor. <b>Grading</b> evens it out:
          </p>
          <ul className="cb-layer-list small">
            <li>
              <b>Capacitance grading</b>: layers of different permittivity, the highest ε next to the conductor. D = q/(2πx) is the same in every layer, so g = D/ε is lower where ε is higher. Equal
              maxima need ε₁r = ε₂r₁ = ε₃r₂ = …
            </li>
            <li>
              <b>Intersheath grading</b>: thin metal sheaths inside the insulation, held at chosen potentials (from transformer taps). Each layer is then a small cable with its own share of the
              voltage.
            </li>
          </ul>
          <p>
            Here capacitance grading lowers the peak from {fx(r0.gMax, 2)} to {fx(capG.peak, 2)} kV/cm, one intersheath to {fx(isG.peak, 2)} kV/cm.{' '}
            {level !== 'beginner' &&
              'In practice both are rare today: materials with suitable, stable permittivities are scarce, and intersheaths need feeding, carry charging currents and can be damaged in laying. Modern cables rely on smooth extruded screens and stronger insulation instead.'}
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="Capacitance grading: g_i(x) = K/(ε_i x), K = V / Σ ln(r_i/r_{i−1})/ε_i       Intersheath: g_i(x) = ΔV_i / (x ln(r_i/r_{i−1}))"
            where={[
              ['r_i', 'layer boundaries, r₀ = r … r_n = R', 'cm'],
              ['ε_i', 'relative permittivity of layer i', '—'],
              ['ΔV_i', 'voltage across layer i (set by the intersheath potentials)', 'kV'],
            ]}
            assume="each layer homogeneous; the field radial; intersheaths are thin equipotentials"
          />
          <Calc
            title={`Worked example: ε = ${epsG[0]} out to r₁ = ε₁r/ε₂ = ${fx(r1 * 10, 2)} mm, then ${epsG[1]}`}
            steps={[
              { label: 'Σ ln(r_i/r_{i−1})/ε_i', expr: `ln(${fx(r1, 3)}/${fx(r0.r, 1)})/${epsG[0]} + ln(${fx(r0.R, 1)}/${fx(r1, 3)})/${epsG[1]}`, result: fx(Ssum, 5) },
              { label: 'K = V / Σ', expr: `${fx(v, 1)} / ${fx(Ssum, 5)}`, result: `${fx(capG.kKv!, 3)} kV` },
              { label: 'g₁ max = K/(ε₁ r)', expr: `${fx(capG.kKv!, 3)} / (${epsG[0]} × ${fx(r0.r, 1)})`, result: `${fx(capG.layers[0].gMax, 2)} kV/cm` },
              { label: 'g₂ max = K/(ε₂ r₁)', expr: `${fx(capG.kKv!, 3)} / (${epsG[1]} × ${fx(r1, 3)})`, result: `${fx(capG.layers[1].gMax, 2)} kV/cm` },
              { label: `Intersheath at ${fx(rIs * 10, 0)} mm: G = V / Σ r_{i−1} ln(r_i/r_{i−1})`, expr: `${fx(v, 1)} / ${fx(wIs, 4)}`, result: `${fx(isG.peak, 2)} kV/cm` },
              { label: 'Its potential V₁ = V − G r ln(r₁/r)', expr: `${fx(v, 1)} − ${fx(isG.peak, 2)} × ${fx(r0.r, 1)} × ${fx(Math.log(rIs / r0.r), 4)}`, result: `${fx(pIs[0], 2)} kV` },
            ]}
            check={{
              ok: rel(capG.layers[0].vKv + capG.layers[1].vKv, v) < 1e-9 && rel(capG.layers[0].eps * capG.layers[0].gMin, capG.layers[1].eps * capG.layers[1].gMax) < 1e-9,
              text: `The layer voltages add up to ${fx(capG.layers[0].vKv + capG.layers[1].vKv, 3)} kV = V, and at the boundary ε₁g₁ = ${fx(capG.layers[0].eps * capG.layers[0].gMin, 3)} = ε₂g₂ = ${fx(capG.layers[1].eps * capG.layers[1].gMax, 3)} (D is continuous).`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Three-core belted cable',
      visual: <BeltedFigure />,
      body: (
        <>
          <p>
            In a three-core cable each core has a capacitance <b>C_s</b> to the sheath and <b>C_c</b> to each of the other two cores. Neither can be measured alone, but two measurements on the whole
            cable find both:
          </p>
          <ul className="cb-layer-list small">
            <li>(1) all three cores joined, measured to the sheath: C₁ = 3C_s;</li>
            <li>(2) one core against the other two joined to the sheath: C₂ = C_s + 2C_c.</li>
          </ul>
          <p>
            In balanced three-phase operation the delta of C_c’s is equivalent to a star of 3C_c per phase, so each phase sees <b>C_n = C_s + 3C_c</b> to the neutral (the sheath).
          </p>
          <Callout tone="info" title="Explore it">
            Try your own measurements in Explore (Engineer level shows it open).
          </Callout>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Explore the cable →
          </button>
        </>
      ),
      work: belOk ? (
        <Calc
          title={`Worked example: C₁ = ${bm.c1} µF, C₂ = ${bm.c2} µF (illustrative), ${bm.vll} kV, 50 Hz`}
          steps={[
            { label: 'C_s = C₁/3', expr: `${bm.c1} / 3`, result: `${fx(belOk.cs, 3)} µF` },
            { label: 'C_c = (C₂ − C_s)/2', expr: `(${bm.c2} − ${fx(belOk.cs, 3)}) / 2`, result: `${fx(belOk.cc, 3)} µF` },
            { label: 'C_n = C_s + 3C_c', expr: `${fx(belOk.cs, 3)} + 3 × ${fx(belOk.cc, 3)}`, result: `${fx(belOk.cn, 3)} µF` },
            { label: 'I_c = ω C_n V_LL/√3', expr: `2π50 × ${fx(belOk.cn, 3)}×10⁻⁶ × ${fx((bm.vll * 1000) / Math.sqrt(3), 0)}`, result: `${fx(beltedCharging(belOk.cn, bm.vll, 50), 3)} A` },
          ]}
          check={{
            ok: rel(beltedByMatrix(belOk.cs, belOk.cc).re, belOk.cn) < 1e-9,
            text: `Second method: the cores’ capacitance matrix (diagonal C_s + 2C_c, off-diagonal −C_c) with balanced phase voltages gives q_a/V_a = ${fx(beltedByMatrix(belOk.cs, belOk.cc).re, 4)} µF — the same.`,
          }}
        />
      ) : undefined,
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — underground cables, step ${step + 1} of ${steps.length}: ${cur.title}. Default cable: r ${c0.rMm} mm, R ${c0.RMm} mm, V ${v} kV rms core-to-sheath, ε_r ${c0.epsR}: g_max ${fx(r0.gMax, 2)} kV/cm, g_min ${fx(r0.gMin, 2)} kV/cm, C ${fx(r0.cUfKm, 4)} µF/km, R_ins ${fx(r0.rInsMOhmKm, 0)} MΩ·km, Ic ${fx(r0.icAKm, 3)} A/km.`,
  )
  return (
    <div className="ps-split cb-learn">
      <div className="cb-learn-visual">
        {cur.visual}
        {cur.work}
      </div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}
