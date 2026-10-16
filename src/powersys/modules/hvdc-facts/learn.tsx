import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity } from '../../progress.ts'
import { Plot } from '../../ui/Plot.tsx'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Eq, Readouts, Slider, Stepper, useTutorContext } from '../../ui/kit.tsx'
import { computeLine, presetDesign } from '../line-params/calc.ts'
import {
  acDc,
  acFundamental,
  breakEven,
  commutationNumeric,
  dcWaveform,
  K_VD0,
  LCC0,
  numericPmax,
  pMaxMidShunt,
  pMaxSeries,
  pMidShunt,
  qAtLimit,
  rectifierBridge,
  solveLcc,
  solveVsc,
  tcrB,
  tcrBNumeric,
  VSC0,
  WEAK0,
  xTh,
  type BridgeResult,
  type LccResult,
} from './calc.ts'
import { CapabilityPlot, CharacteristicsPlot, Chart, COLORS, PowerAnglePlot, PvPlot, TcrPlot } from './charts.tsx'
import { HvdcScene } from './Scene.tsx'
import { compute, MODULE, PE_LINKS, STATE0, SyllabusNote, times } from './shared.tsx'

const D2R = Math.PI / 180
const B = { vll: 213, xc: 12, id: 2 }
function bridge(a: number, xc = B.xc, id = B.id): BridgeResult {
  const b = rectifierBridge(B.vll, a, xc, id)
  if (!b.ok) throw new Error(b.issues[0])
  return b
}

/** The AC line of Module 8 (computed there): its x and b per km, and its DC resistance per phase. */
function module8Line() {
  const d = presetDesign('horizontal')
  const r = computeLine(d.geometry, d.options)
  if (!r.ok) throw new Error('Module 8 default line invalid')
  return { kv: d.options.kv, xOhmKm: r.xOhmKm, bUsKm: r.bUsKm, rDc: r.r.rDc, sil: r.silMw }
}

export function Learn({ onExplore }: { onExplore(): void }) {
  const level = useLevel()
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const [km, setKm] = useState(1000)
  const [kT, setKT] = useState(3.5)
  const [kL, setKL] = useState(0.7)
  const [alphaW, setAlphaW] = useState(30)
  const c0 = useMemo(() => compute(STATE0), [])
  const line = useMemo(module8Line, [])
  const dcKv = 400
  const dcKa = 2
  const cmp = acDc(km, line, { kvPole: dcKv, ka: dcKa, rOhmKmPole: line.rDc })
  // the slider stops below a quarter wavelength of the AC line (computed from Module 8's constants)
  const maxKm = Math.floor(cmp.quarterKm / 50) * 50
  const lengths = Array.from({ length: Math.floor((maxKm - 100) / 25) + 1 }, (_, j) => 100 + j * 25)
  const be = breakEven(kT, kL)
  // converter worked examples
  const b0 = bridge(15, 0)
  const b1 = bridge(15)
  const num1 = commutationNumeric(B.vll, 15, B.xc, B.id)
  const f1 = acFundamental(B.vll, 15, B.xc, B.id)
  const wIdeal = useMemo(() => dcWaveform(B.vll, alphaW, 0, 721), [alphaW])
  const wOver = useMemo(() => dcWaveform(B.vll, 15, b1.muDeg, 721), [b1.muDeg])
  const L = solveLcc(LCC0) as LccResult
  const V = solveVsc(VSC0)
  const qCurve = useMemo(() => Array.from({ length: 41 }, (_, j) => 5 + j * 2).map((a) => [a, bridge(a).q] as [number, number]), [])
  const pCurve = useMemo(() => Array.from({ length: 41 }, (_, j) => 5 + j * 2).map((a) => [a, bridge(a).p] as [number, number]), [])
  const curves = (['none', 'svc', 'statcom'] as const).map((s) => c0.curves[s]!).filter(Boolean)
  const bus = c0.bus

  const steps: Array<{ title: string; visual: ReactNode; body: ReactNode; work?: ReactNode }> = [
    {
      title: 'AC to DC and back',
      visual: <HvdcScene s={STATE0} c={c0} selected={sel} onSelect={setSel} tour={false} height={400} far />,
      body: (
        <>
          <p className="hf-question">Why would anyone convert AC to DC, send it 1,000 km, and convert it back to AC — and how can a box of capacitors and thyristors hold up a sagging bus voltage?</p>
          <p>
            The picture is an <b>HVDC link</b>. At the left, the <b>rectifier station</b> takes power from AC grid A: <b>AC filters</b> soak up the converter’s harmonics, <b>converter transformers</b>{' '}
            set its voltage, and thyristor <b>valves</b> in the valve hall turn AC into DC. A <b>smoothing reactor</b> steadies the current on the <b>DC line</b>. At the right the <b>inverter</b>{' '}
            turns it back into AC for grid B.
          </p>
          <p>
            In front is a <b>weak AC bus</b> — a load far from strong generation — with a <b>compensator</b> (here a STATCOM) that supplies reactive power to hold its voltage up. Select any part to
            see what it does and its computed values.
          </p>
          <SyllabusNote />
        </>
      ),
    },
    {
      title: 'Why DC? Charging current and the angle limit',
      visual: (
        <div className="ps-stack">
          <Slider
            label="Line length"
            value={km}
            min={100}
            max={maxKm}
            step={50}
            unit="km"
            decimals={0}
            onChange={setKm}
            hint={`up to ${maxKm} km — below a quarter wavelength (${fx(cmp.quarterKm, 0)} km)`}
          />
          <Plot
            label="Power a line can carry against its length"
            xLabel="Length [km]"
            yLabel="Power [MW]"
            height={220}
            series={[
              {
                id: 'ac',
                label: 'AC, δ 30°',
                color: COLORS.ac,
                points: lengths.map((l) => [l, acDc(l, line, { kvPole: dcKv, ka: dcKa, rOhmKmPole: line.rDc }).pAc30] as [number, number]),
              },
              {
                id: 'dc',
                label: 'DC bipole',
                color: COLORS.dc,
                points: lengths.map((l) => {
                  const x = acDc(l, line, { kvPole: dcKv, ka: dcKa, rOhmKmPole: line.rDc })
                  return [l, x.pDc - x.lossDc] as [number, number]
                }),
              },
            ]}
            vlines={[{ x: km, label: `${km} km` }]}
            yDomain={[0, 3200]}
          />
          <Readouts
            items={[
              { label: 'AC charging', value: fx(cmp.chargingMvar, 0), unit: 'Mvar', note: `V²·b·ℓ over ${km} km` },
              { label: 'AC at δ = 30°', value: fx(cmp.pAc30, 0), unit: 'MW', note: `angle limit V²/(Z_c·sin βℓ) = ${fx(cmp.pAcMax, 0)} MW (lumped x·ℓ: ${fx(cmp.pAcMaxLumped, 0)})` },
              { label: 'DC delivered', value: fx(cmp.pDc - cmp.lossDc, 0), unit: 'MW', note: `I²R loss ${fx(cmp.lossDc, 0)} MW (${fx((cmp.lossDc / cmp.pDc) * 100, 1)} %)` },
            ]}
          />
        </div>
      ),
      body: (
        <>
          <p>
            An AC line is a long capacitor as well as a conductor: every kilometre draws <b>charging current</b> whether or not any power flows. Module 8’s {line.kv} kV line (b = {fx(line.bUsKm, 3)}{' '}
            µS/km) draws {fx(cmp.chargingMvar, 0)} Mvar over {km} km.
          </p>
          <p>
            AC power also needs an <b>angle</b> across the line. For the lossless long line P = V²·sin δ / (Z_c·sin βℓ), with Z_c = {fx(cmp.zc, 1)} Ω and β = {fx(cmp.beta * 1000, 4)} rad per 1000 km;
            sin βℓ grows with length up to a quarter wavelength, π/(2β) = {fx(cmp.quarterKm, 0)} km. At {km} km and δ = 30° (an illustrative operating angle that leaves margin to the 90° limit) this
            line carries {fx(cmp.pAc30, 0)} MW, and below the quarter wavelength the longer the line, the less. (The short-line estimate with x·ℓ would give {fx(cmp.pAcMaxLumped / 2, 0)} MW —{' '}
            {fx(Math.abs(cmp.pAcMaxLumped / 2 - cmp.pAc30), 0)} MW {cmp.pAcMaxLumped / 2 < cmp.pAc30 ? 'less' : 'more'}.) A DC line has neither problem: in steady state its capacitance carries no
            current and there is no angle, only resistance. With the same conductors as a ±{dcKv} kV bipole at {dcKa} kA it delivers {fx(cmp.pDc - cmp.lossDc, 0)} MW.
          </p>
          <p>
            DC also links grids that are <b>not synchronised</b> (or run at different frequencies) and needs <b>fewer conductors</b>: two for a bipole against three for one AC circuit. The price is
            the converter stations.
          </p>
          <p className="small muted">
            Illustrative comparison: uncompensated, lossless AC line, exact long-line model (β and Z_c from Module 8’s default constants); charging shown as V²·b·ℓ; the DC bipole uses the same
            twin-bundle conductors (R = {fx(line.rDc, 4)} Ω/km per pole) — not a design.
          </p>
        </>
      ),
      work: (
        <section className="ps-card" aria-labelledby="hf-cost">
          <h3 id="hf-cost">The break-even distance — an illustrative cost model</h3>
          <div className="ps-cols-2">
            <Slider label="DC terminals ÷ AC terminals" value={kT} min={1.5} max={8} step={0.5} unit="×" decimals={1} onChange={setKT} />
            <Slider label="DC line ÷ AC line, per km" value={kL} min={0.4} max={0.95} step={0.05} unit="×" decimals={2} onChange={setKL} />
          </div>
          <Chart
            series={[
              { id: 'ac', label: 'AC: 1 + ℓ/100', color: COLORS.ac, points: [0, 3000].map((l) => [l, 1 + l / 100] as [number, number]) },
              { id: 'dc', label: `DC: ${fx(kT, 1)} + ${fx(kL, 2)}·ℓ/100`, color: COLORS.dc, points: [0, 3000].map((l) => [l, kT + (kL * l) / 100] as [number, number]) },
            ]}
            markers={be !== null && be <= 3000 ? [{ x: be, y: 1 + be / 100, color: COLORS.op, label: `break-even ${fx(be, 0)} km` }] : []}
            xLabel="Length ℓ [km]"
            yLabel="Cost [relative units]"
            xDomain={[0, 3000]}
            yDomain={[0, 32]}
            height={220}
            label="Illustrative cost of AC and DC transmission against length"
            desc={be !== null ? `Break-even at ${fx(be, 0)} km in this model.` : 'No break-even.'}
          />
          <p className="small muted">
            Relative cost units, not prices: AC terminals = 1, AC line = 1 per 100 km. DC terminals cost more, DC line less per km, so the lines cross — here at {be !== null ? `${fx(be, 0)} km` : '—'}
            . Real break-even distances depend on the project (overhead or cable, ratings, losses, right-of-way); this model only shows why a break-even exists.
          </p>
        </section>
      ),
    },
    {
      title: 'The line-commutated converter',
      visual: (
        <div className="ps-stack">
          <Slider label="Firing angle α" value={alphaW} min={0} max={90} step={1} unit="°" decimals={0} onChange={setAlphaW} />
          <Plot
            label="DC output voltage of an ideal 6-pulse bridge"
            xLabel="ωt [°]"
            yLabel="v_d [kV]"
            height={220}
            series={[
              { id: 'env', label: 'envelope', color: 'var(--text-3)', points: wIdeal.envelope, dashed: true },
              { id: 'vd', label: `α = ${alphaW}°`, color: COLORS.rect, points: wIdeal.vd },
            ]}
            hlines={[{ y: bridge(alphaW, 0).vd, label: `V_d = ${fx(bridge(alphaW, 0).vd, 1)} kV` }]}
            xDomain={[0, 360]}
            yDomain={[-350, 350]}
          />
          <p className="small muted">
            Calculated valve by valve: ideal thyristors, no commutation reactance, constant I_d. Dashed: the envelope of the line-to-line voltages; the horizontal line is the mean V_d.
          </p>
        </div>
      ),
      body: (
        <>
          <p>
            A 6-pulse bridge has six thyristors. Each can be <b>switched on</b> by a gate pulse but turns off only when its current falls to zero — the AC voltage does that (<b>line commutation</b>).
            At any moment one valve connects the most positive phase to the + rail and one the most negative to the − rail, so v_d follows the top of the line voltages: six pulses per cycle.
          </p>
          <p>
            Delay each firing by <b>α</b> after its natural point and each valve keeps the old phase a little longer: the mean DC voltage falls as cos α. At α = {alphaW}° it is{' '}
            {fx(bridge(alphaW, 0).vd, 1)} kV; above 90° it would be negative — the bridge inverts.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="V_d = V_d0·cos α,   V_d0 = (3√2/π)·V_LL = 1.3505·V_LL"
            where={[
              ['V_LL', 'rms line-to-line voltage on the valve side', 'kV'],
              ['α', 'firing delay after the natural commutation point', '°'],
              ['V_d0', 'the mean DC voltage at α = 0 (no load)', 'kV'],
            ]}
            assume="ideal valves, no commutation reactance (X_c = 0), ripple-free DC current"
          />
          <Calc
            title={`Worked example: V_LL = ${B.vll} kV, α = 15°`}
            steps={[
              { label: 'V_d0 = 1.3505 × V_LL', expr: `${fx(K_VD0, 4)} × ${B.vll}`, result: `${fx(b0.vd0, 2)} kV` },
              { label: 'V_d = V_d0·cos α', expr: `${fx(b0.vd0, 2)} × cos 15°`, result: `${fx(b0.vd, 2)} kV` },
            ]}
            check={(() => {
              const w = dcWaveform(B.vll, 15, 0, 36001)
              return { ok: Math.abs(w.mean - b0.vd) / b0.vd < 2e-4, text: `The mean of the valve-by-valve waveform: ${fx(w.mean, 2)} kV (sampled every 0.01°).` }
            })()}
          />
        </>
      ),
    },
    {
      title: 'Overlap: the commutation reactance',
      visual: (
        <div className="ps-stack">
          <Plot
            label="DC voltage with commutation overlap"
            xLabel="ωt [°]"
            yLabel="v_d [kV]"
            height={220}
            series={[
              { id: 'env', label: 'envelope', color: 'var(--text-3)', points: wOver.envelope, dashed: true },
              { id: 'vd', label: `μ = ${fx(b1.muDeg, 1)}°`, color: COLORS.rect, points: wOver.vd },
            ]}
            hlines={[{ y: b1.vd, label: `V_d = ${fx(b1.vd, 1)} kV` }]}
            xDomain={[0, 360]}
            yDomain={[0, 340]}
          />
          <p className="small muted">
            Calculated: X_c = {B.xc} Ω, I_d = {B.id} kA. The notches are the overlaps, when two phases are shorted through their reactances.
          </p>
        </div>
      ),
      body: (
        <>
          <p>
            The transformer’s leakage reactance <b>X_c</b> means the current cannot jump from one valve to the next. For an <b>overlap angle μ</b> both conduct, shorting the two phases: the rail sits
            halfway between them and a slice of voltage is lost every pulse.
          </p>
          <p>
            A bigger current takes longer to move (μ grows with I_d), and the voltage lost is exactly proportional to I_d — like a resistance (3/π)·X_c, though nothing is dissipated. For the full
            converter waveforms, see the Power Electronics{' '}
            <a className="ps-link" href={PE_LINKS.rectifiers}>
              rectifier lab
            </a>
            .
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="cos(α + μ) = cos α − √2·X_c·I_d / V_LL      V_d = V_d0·cos α − (3/π)·X_c·I_d = ½·V_d0·[cos α + cos(α + μ)]"
            where={[
              ['X_c', 'commutation reactance per phase (ωL_c)', 'Ω'],
              ['I_d', 'DC current (kV / Ω = kA)', 'kA'],
              ['μ', 'overlap angle', '°'],
            ]}
            assume="constant I_d during commutation; μ < 60° (normal two-and-three-valve conduction)"
          />
          <Calc
            title={`Worked example: α = 15°, X_c = ${B.xc} Ω, I_d = ${B.id} kA, V_LL = ${B.vll} kV`}
            steps={[
              { label: '√2·X_c·I_d / V_LL', expr: `1.4142 × ${B.xc} × ${B.id} / ${B.vll}`, result: fx(b1.k, 5) },
              { label: 'cos(α + μ)', expr: `cos 15° − ${fx(b1.k, 5)}`, result: fx(Math.cos(15 * D2R) - b1.k, 5) },
              { label: 'μ', expr: `arccos(${fx(Math.cos(15 * D2R) - b1.k, 5)}) − 15°`, result: `${fx(b1.muDeg, 3)}°` },
              { label: 'Drop (3/π)·X_c·I_d', expr: `0.9549 × ${B.xc} × ${B.id}`, result: `${fx(b1.drop, 3)} kV` },
              { label: 'V_d', expr: `${fx(b1.vd0, 2)} × cos 15° − ${fx(b1.drop, 3)}`, result: `${fx(b1.vd, 3)} kV` },
            ]}
            check={
              num1.ok
                ? {
                    ok: Math.abs(num1.muDeg - b1.muDeg) < 1e-4 && Math.abs(num1.vd - b1.vd) < 1e-3,
                    text: `Integrating 2L_c·di/dt = √2·V_LL·sin(ωt) numerically until i = I_d gives μ = ${fx(num1.muDeg, 4)}° and V_d = ${fx(num1.vd, 3)} kV.`,
                  }
                : undefined
            }
          />
        </>
      ),
    },
    {
      title: 'The converter’s hunger for reactive power',
      visual: (
        <div className="ps-stack">
          <Chart
            series={[
              { id: 'p', label: 'P = V_d·I_d [MW]', color: COLORS.rect, points: pCurve },
              { id: 'q', label: 'Q = P·tan φ [Mvar]', color: COLORS.inv, points: qCurve },
            ]}
            markers={[{ x: 15, y: b1.q, color: COLORS.op, label: `α = 15°: Q ${fx(b1.q, 0)} Mvar` }]}
            xLabel="Firing angle α [°]"
            yLabel="MW, Mvar"
            xDomain={[0, 90]}
            yDomain={[0, 620]}
            height={240}
            label="Active and reactive power of one bridge against firing angle at constant current"
            desc={`At α = 15°: P ${fx(b1.p, 0)} MW, Q ${fx(b1.q, 0)} Mvar.`}
          />
          <p className="small muted">
            Calculated for one bridge at constant I_d = {B.id} kA (X_c = {B.xc} Ω).
          </p>
        </div>
      ),
      body: (
        <>
          <p>
            Delaying the firing delays the AC current behind the voltage, so the converter runs at a lagging power factor. Its AC current is set by I_d, so the apparent power stays about V_d0·I_d
            while the active part falls with cos α: what is left is <b>reactive power</b> it absorbs — a rectifier and an inverter both.
          </p>
          <p>
            At α = 15° this bridge draws {fx(b1.q, 0)} Mvar for {fx(b1.p, 0)} MW ({fx((b1.q / b1.p) * 100, 0)} % of P). Converter stations therefore carry large AC filters and capacitor banks, which
            also remove the harmonics.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="cos φ ≈ ½[cos α + cos(α + μ)] = V_d / V_d0      Q = P·tan φ"
            where={[
              ['φ', 'displacement angle of the AC fundamental current', '°'],
              ['P', 'active power, V_d·I_d', 'MW'],
              ['Q', 'reactive power absorbed', 'Mvar'],
            ]}
            assume="the standard approximation: the fundamental AC current keeps its no-overlap size (√6/π)·I_d"
          />
          <Calc
            title="Worked example: the same bridge"
            steps={[
              { label: 'cos φ', expr: `½[cos 15° + cos ${fx(15 + b1.muDeg, 2)}°]`, result: fx(b1.cosPhi, 4) },
              { label: 'P = V_d·I_d', expr: `${fx(b1.vd, 2)} × ${B.id}`, result: `${fx(b1.p, 1)} MW` },
              { label: 'Q = P·tan φ', expr: `${fx(b1.p, 1)} × tan ${fx(b1.phiDeg, 2)}°`, result: `${fx(b1.q, 1)} Mvar` },
            ]}
            check={
              f1.ok
                ? {
                    ok: Math.abs(f1.pAc - b1.p) / b1.p < 1e-6,
                    text: `Fourier analysis of the actual AC current (with its overlap ramps) gives the exact cos φ₁ = ${fx(f1.cosPhi1, 4)} and the same active power ${fx(f1.pAc, 1)} MW; the approximation is ${fx(Math.abs(f1.cosPhi1 - b1.cosPhi), 4)} away because the fundamental shrinks to ${fx((f1.i1 / f1.i1Ideal) * 100, 2)} % of (√6/π)·I_d during overlap.`,
                  }
                : undefined
            }
          />
        </>
      ),
    },
    {
      title: 'The DC link and its controls',
      visual: <CharacteristicsPlot link={LCC0} res={L} height={280} />,
      body: (
        <>
          <p>
            Join a rectifier and an inverter through the line resistance: I_d = (V_dr − V_di)/R_dc. The two voltages differ by only {fx(L.vdr - L.vdi, 1)} kV ({fx(((L.vdr - L.vdi) / L.vdr) * 100, 1)}{' '}
            % of {fx(L.vdr, 1)} kV), so a small change in either moves the current a lot — {fx(L.dIdAlpha, 3)} kA per degree of α ({fx((L.dIdAlpha / L.id) * 100, 0)} % of I_d). The link is therefore
            run by control:
          </p>
          <ul className="small">
            <li>
              <b>Rectifier: constant current (CC)</b> — it adjusts α to hold I_d at the order (the vertical line).
            </li>
            <li>
              <b>Inverter: constant extinction angle (CEA)</b> — it holds γ at its minimum safe value so its valves recover, which sets the DC voltage (the sloping line).
            </li>
            <li>
              <b>Current margin ΔI</b> — the inverter’s own current order is ΔI lower; if the rectifier’s AC voltage sags so it reaches α_min, the inverter takes over current control (mode shift).
            </li>
          </ul>
          <p>
            Each station here is <b>12-pulse</b>: two 6-pulse bridges in series, fed from Y and Δ transformer windings — twice the voltage, and the lowest harmonics cancel.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="Inverter: V_di = V_d0i·cos γ − (3/π)·X_c·I_d  (V_di counted positive, opposing I_d)      I_d = (V_dr − V_di)/R_dc      P_dr − P_di = I_d²·R_dc"
            where={[
              ['γ', 'extinction angle: from the end of overlap to the voltage reversal', '°'],
              ['β', 'firing advance β = γ + μ = 180° − α_inverter', '°'],
              ['R_dc', 'DC line (loop) resistance', 'Ω'],
            ]}
            assume="steady state; both stations 12-pulse (two bridges); the operating point is where the two characteristics cross"
          />
          <Calc
            title="Worked example: the link ordered to send 1000 MW"
            steps={[
              { label: 'V_d0i·cos γ₀ (12-pulse)', expr: `${fx(L.vd0i, 2)} × cos ${LCC0.gammaDeg}°`, result: `${fx(L.vd0i * Math.cos(LCC0.gammaDeg * D2R), 2)} kV` },
              { label: 'P = (V_d0i cos γ₀ + (R_dc − R_ci) I)·I', expr: `solve for I, R_ci = ${fx(L.rci, 3)} Ω`, result: `I_d = ${fx(L.id, 4)} kA` },
              { label: 'V_di', expr: `${fx(L.vd0i * Math.cos(LCC0.gammaDeg * D2R), 2)} − ${fx(L.rci, 3)} × ${fx(L.id, 4)}`, result: `${fx(L.vdi, 2)} kV` },
              { label: 'V_dr = V_di + R_dc·I_d', expr: `${fx(L.vdi, 2)} + ${LCC0.rdc} × ${fx(L.id, 4)}`, result: `${fx(L.vdr, 2)} kV` },
              { label: 'α from V_dr = V_d0r cos α − R_cr I_d', expr: `arccos((${fx(L.vdr, 2)} + ${fx(L.rcr * L.id, 2)}) / ${fx(L.vd0r, 2)})`, result: `${fx(L.alphaDeg, 2)}°` },
            ]}
            check={{
              ok: Math.abs(L.pr - L.pi - L.id * L.id * LCC0.rdc) < 1e-6 && Math.abs(L.pr - 1000) < 1e-6,
              text: `P_dr − P_di = ${fx(L.pr, 1)} − ${fx(L.pi, 1)} = ${fx(L.loss, 2)} MW = I_d²·R_dc, and P_dr = 1000 MW as ordered.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'VSC-HVDC: P and Q, independently',
      visual: V.ok ? <CapabilityPlot title="Station 1" vs={VSC0.vs1} x={VSC0.x} iMax={VSC0.iMax} vcMax={VSC0.vcMax} p={V.p1} q={VSC0.q1} ok width={380} height={320} /> : <p>—</p>,
      body: (
        <>
          <p>
            A <b>voltage-source converter</b> uses IGBTs that switch on <i>and</i> off, many times a cycle (PWM). It is not line commutated: it makes its own AC voltage V_c, of any size and angle,
            behind a <b>phase reactor</b> X. The angle δ of V_c sets P; its size sets Q — independently, and either sign. It can even start a dead network.
          </p>
          <p>
            The limit is a <b>capability circle</b>: the current (|S| ≤ V_s·I_max) and the largest V_c the DC voltage allows. The PWM itself is in the Power Electronics{' '}
            <a className="ps-link" href={PE_LINKS.inverters}>
              inverter
            </a>{' '}
            and{' '}
            <a className="ps-link" href={PE_LINKS.pwm}>
              PWM
            </a>{' '}
            labs.
          </p>
        </>
      ),
      work: V.ok ? (
        <>
          <Eq
            expr="P = V_s·V_c·sin δ / X      Q = (V_s·V_c·cos δ − V_s²)/X      ⇒ V_c·cos δ = V_s + Q·X/V_s,  V_c·sin δ = P·X/V_s"
            where={[
              ['V_c∠δ', 'converter AC voltage, δ ahead of the grid voltage', 'pu'],
              ['X', 'phase reactor plus transformer', 'pu'],
              ['P, Q', 'delivered to the grid', 'pu'],
            ]}
            assume="the phase-reactor model: fundamental frequency only, lossless converter and reactor"
          />
          <Calc
            title={`Worked example: station 1 takes P = ${fx(-V.p1, 2)} pu from its grid and supplies Q = ${fx(VSC0.q1, 2)} pu, X = ${VSC0.x} pu`}
            steps={[
              { label: 'V_c·cos δ', expr: `1 + ${fx(VSC0.q1, 2)} × ${VSC0.x} / 1`, result: fx(1 + VSC0.q1 * VSC0.x, 4) },
              { label: 'V_c·sin δ', expr: `${fx(V.p1, 2)} × ${VSC0.x} / 1`, result: fx(V.p1 * VSC0.x, 4) },
              { label: 'V_c, δ', expr: '√(…² + …²), arctan', result: `${fx(V.st1.vc, 4)} pu ∠ ${fx(V.st1.deltaDeg, 3)}°` },
            ]}
            check={{
              ok: Math.abs(V.st1.pCheck - V.p1) < 1e-9 && Math.abs(V.st1.qCheck - VSC0.q1) < 1e-9,
              text: `Back through P = V_s·V_c·sin δ/X and Q = (V_s·V_c·cos δ − V_s²)/X: ${fx(V.st1.pCheck, 4)} and ${fx(V.st1.qCheck, 4)} pu.`,
            }}
          />
        </>
      ) : undefined,
    },
    {
      title: 'Series and shunt compensation',
      visual: <PowerAnglePlot v={1} x={0.5} k={0.5} p={1.5} height={260} />,
      body: (
        <>
          <p>Back to AC. A line’s power limit is P_max = V²/X. Two ways to raise it — the GATE topic “series and shunt compensation”:</p>
          <ul className="small">
            <li>
              <b>Series capacitors</b> cancel part k of the reactance: X_eff = X(1 − k). With k = 50 % the whole curve doubles: P_max {fx(pMaxSeries(1, 1, 0.5, 0), 2)} →{' '}
              {fx(pMaxSeries(1, 1, 0.5, 0.5), 2)} pu.
            </li>
            <li>
              A <b>shunt compensator at the midpoint</b> that holds its voltage splits the line into two halves of X/2, each carrying δ/2: P = (2V²/X)·sin(δ/2). Its maximum,{' '}
              {fx(pMaxMidShunt(1, 0.5), 2)} pu, is {times(pMaxMidShunt(1, 0.5), pMaxSeries(1, 1, 0.5, 0))} the uncompensated value — but reached only at δ = 180°.
            </li>
          </ul>
          <p className="small muted">Calculated for V = 1 pu at both ends and X = 0.5 pu (lossless).</p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="Series: P = V_s·V_r·sin δ / (X(1 − k)),  P_max = V_s·V_r / (X(1 − k))      Midpoint shunt: P = (2V²/X)·sin(δ/2),  P_max = 2V²/X at δ = 180°"
            where={[
              ['k', 'degree of series compensation (fraction of X cancelled)', ''],
              ['V', 'end and midpoint voltage (equal)', 'pu'],
            ]}
            assume="lossless line; an ideal midpoint compensator with unlimited Q"
          />
          {(() => {
            const ns = numericPmax((d) => pMidShunt(1, 0.5, d))
            return (
              <Calc
                title="Worked example: X = 0.5 pu, V = 1 pu"
                steps={[
                  { label: 'Uncompensated', expr: '1 × 1 / 0.5', result: '2.000 pu at 90°' },
                  { label: 'Series, k = 0.5', expr: '1 / (0.5 × 0.5)', result: `${fx(pMaxSeries(1, 1, 0.5, 0.5), 3)} pu at 90°` },
                  { label: 'Midpoint shunt', expr: '2 × 1² / 0.5', result: `${fx(pMaxMidShunt(1, 0.5), 3)} pu at 180°` },
                ]}
                check={{ ok: Math.abs(ns.f - pMaxMidShunt(1, 0.5)) < 1e-9, text: `Searching the midpoint curve numerically for its maximum: ${fx(ns.f, 6)} pu at δ = ${fx(ns.x, 3)}°.` }}
              />
            )
          })()}
        </>
      ),
    },
    {
      title: 'SVC and STATCOM: holding up a weak bus',
      visual: <PvPlot curves={curves} load={WEAK0.p} op={bus.ok ? { p: WEAK0.p, v: bus.v } : null} active="statcom" height={280} />,
      body: (
        <>
          <p>
            A bus fed through a large reactance (a low <b>short-circuit ratio</b>, here SCR = {WEAK0.scr}, X = {fx(xTh(WEAK0.scr), 3)} pu) sags as its load grows, and beyond the <b>nose</b> of its P–V
            curve no solution exists: the voltage <b>collapses</b>. Without support that happens at {fx(c0.curves.none!.nose.p, 3)} pu of load.
          </p>
          <p>
            An <b>SVC</b> is a fixed capacitor in parallel with a <b>thyristor-controlled reactor</b>: firing the TCR later (α → 180°) leaves less inductance, so the net susceptance B is set by α. A{' '}
            <b>STATCOM</b> is a voltage-source converter making reactive current. Both hold the voltage until they reach their rating ({WEAK0.rating} pu here). Then the SVC is a fixed capacitor, Q =
            B·V², while the STATCOM keeps its current, Q = I·V: at 0.7 pu the SVC gives {fx(qAtLimit('svc', 1, 0.7), 2)} and the STATCOM {fx(qAtLimit('statcom', 1, 0.7), 2)} of their rating. The
            collapse load rises to {fx(c0.curves.svc!.nose.p, 3)} pu (SVC) and {fx(c0.curves.statcom!.nose.p, 3)} pu (STATCOM).
          </p>
          <Callout tone="good" title="The answer to the opening question">
            <p className="small">
              DC because a long AC line is limited by its charging current and its angle, and a DC link is not — and it can join unsynchronised grids. A box of capacitors and thyristors (an SVC), or a
              converter (a STATCOM), holds a bus voltage up by supplying the reactive power its load and line need; the STATCOM keeps more of its output when the voltage sags.
            </p>
          </Callout>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Explore the link and the weak bus →
          </button>
        </>
      ),
      work: (
        <>
          <Eq
            expr="B_TCR(α) = (2π − 2α + sin 2α) / (π·ωL),  90° ≤ α ≤ 180°      SVC: Q = (B_C − B_TCR)·V²      STATCOM at its limit: Q = I_max·V"
            where={[
              ['α', 'TCR firing angle measured from the voltage ZERO crossing (90° = full conduction, 180° = off)', '°'],
              ['ωL', 'reactance of the TCR inductor', 'pu'],
              ['B_C', 'fixed capacitor susceptance', 'pu'],
            ]}
            assume="fundamental component only; the TCR's harmonics are filtered"
          />
          <TcrPlot alpha={135} height={200} />
          <Calc
            title="Worked example: TCR at α = 135°"
            steps={[{ label: 'B/B_max', expr: '(2π − 2·(3π/4) + sin 270°) / π', result: fx(tcrB(135)!, 5) }]}
            check={{
              ok: Math.abs(tcrBNumeric(135)! - tcrB(135)!) < 1e-9,
              text: `Fourier analysis of the TCR current (cos α − cos θ, conducting from α to 360° − α): fundamental ${fx(tcrBNumeric(135)!, 5)} of full conduction.`,
            }}
          />
          {level === 'engineer' && (
            <Eq
              title="The weak-bus power flow solved"
              expr="P = E·V·sin δ / X,  P·tan φ − Q_c(V) = (E·V·cos δ − V²)/X   ⇒  (1 − XB)²·V⁴ + (2XQ(1 − XB) − E²)·V² + X²(P² + Q²) = 0"
              where={[
                ['E', 'Thevenin source, 1.0 pu', 'pu'],
                ['X', '1/SCR', 'pu'],
                ['B', 'fixed shunt susceptance (0 without support, B_C for an SVC at its limit)', 'pu'],
              ]}
              assume="lossless; constant-power load; the STATCOM case is solved by Newton (not a quadratic in V²)"
            />
          )}
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — HVDC & FACTS, step ${step + 1} of ${steps.length}: ${cur.title}. Default LCC link: ${fx(L.pr, 0)} MW, I_d ${fx(L.id, 3)} kA, α ${fx(L.alphaDeg, 2)}°, γ ${LCC0.gammaDeg}°, Q_r ${fx(L.qr, 0)} Mvar. Bridge example: 213 kV, α 15°, X_c 12 Ω, I_d 2 kA → μ ${fx(b1.muDeg, 2)}°, V_d ${fx(b1.vd, 2)} kV, Q ${fx(b1.q, 0)} Mvar. Weak bus SCR ${WEAK0.scr}: collapse none ${fx(c0.curves.none!.nose.p, 3)}, SVC ${fx(c0.curves.svc!.nose.p, 3)}, STATCOM ${fx(c0.curves.statcom!.nose.p, 3)} pu.`,
  )
  return (
    <div className="ps-split hf-learn">
      <div className="hf-learn-visual ps-stack">
        {cur.visual}
        {cur.work}
      </div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}
