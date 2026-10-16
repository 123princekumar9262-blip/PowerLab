import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity } from '../../progress.ts'
import { statusFor } from '../../syllabus/coverage.ts'
import { TOPICS } from '../../syllabus/topics.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Eq, Stepper, useTutorContext } from '../../ui/kit.tsx'
import { Chart, TimeBar } from './charts.tsx'
import { Lattice } from './Lattice.tsx'
import { WaveScene } from './Scene.tsx'
import { amps, kv, LineView2D, MODULE, solve, usePlayback } from './shared.tsx'
import {
  C_LIGHT,
  CABLE_TYPICAL,
  convergence,
  gammaOf,
  LI_FIT,
  MEDIA,
  MODEL0,
  margin,
  powerSplit,
  profile,
  PU_KV,
  SEP0,
  separationFormula,
  separationRun,
  steadyState,
  surgeValue,
  tauOf,
  timeSeries,
} from './waves.ts'

/** "Supplementary for you — VIT BEEE404L (elective) Module 7; GATE EE: not named", from the syllabus mapping. */
function SyllabusNote() {
  const ts = TOPICS.filter((t) => t.module === 'transients')
  const vit = ts.map((t) => statusFor(t, 'vit-eee'))
  const gate = ts.map((t) => statusFor(t, 'gate-ee'))
  const elective = vit.find((v) => v.elective)
  const gateNamed = gate.some((g) => g.status === 'verified' || g.status === 'partial')
  return (
    <p className="small muted tr-syllabus">
      Syllabus: {elective ? `named in VIT ${elective.ref.where} Module ${elective.ref.unit} — ${elective.elective} — so supplementary for your own courses` : 'not named in your VIT courses'}
      {gateNamed ? ' · named in GATE EE' : ' · not named in the GATE EE syllabus'}. Beyond the core, but real engineering: it is the basis of surge protection.
    </p>
  )
}

export function Learn({ onExplore }: { onExplore(): void }) {
  const level = useLevel()
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const s0 = useMemo(() => solve(MODEL0), [])
  const an0 = s0.an!
  const f0 = s0.f!
  const pb = usePlayback(an0.window, an0.T, 'learn', 1.5 * an0.T)
  const ohl = MEDIA['ohl-twin']
  const cab = MEDIA.cable
  // boundary examples: open / short / matched with a matched source (no re-reflection), 1000 kV step
  const boundary = useMemo(
    () =>
      (['open', 'short', 'matched'] as const).map((term) => {
        const s = solve({ ...MODEL0, term, rs: ohl.zc })
        return { term, s, pts: profile(s.f!, 1.5 * s.an!.T, 200) }
      }),
    [ohl.zc],
  )
  const rl = 1500
  const sR = useMemo(() => solve({ ...MODEL0, term: 'resistor', rl, rs: ohl.zc }), [ohl.zc])
  const endR = sR.f!.end(1.5 * sR.an!.T)
  // a junction into a cable
  const sJ = useMemo(() => solve({ ...MODEL0, term: 'junction', rs: ohl.zc }), [ohl.zc])
  const endJ = sJ.f!.end(1.5 * sJ.an!.T)
  const ps = powerSplit(sJ.an!.zl, sJ.an!.zc)
  // the travelling step on its own: matched source, half-way along
  const sHalf = useMemo(() => solve({ ...MODEL0, rs: ohl.zc }), [ohl.zc])
  // the lattice example: the default model (open end, R_s = 50 Ω)
  const conv = useMemo(() => convergence(f0, 6), [f0])
  const ss0 = steadyState(an0)
  // the impulse
  const li = LI_FIT.times
  const imp = useMemo(() => Array.from({ length: 601 }, (_, k) => [k * 0.2, surgeValue('impulse', 1, 0, k * 0.2)] as [number, number]), [])
  const impFront = useMemo(() => Array.from({ length: 301 }, (_, k) => [k * 0.02, surgeValue('impulse', 1, 0, k * 0.02)] as [number, number]), [])
  // energising
  const sSw = useMemo(() => solve({ ...MODEL0, surge: 'switching', rs: 10, lengthKm: 20 }), [])
  const swPeak = sSw.f!.end(1.5 * sSw.an!.T).v / PU_KV
  // separation
  const c3 = { zc: ohl.zc, v: ohl.v, dM: 3, s: SEP0.s, ekv: SEP0.ekv, vres: SEP0.vres }
  const c30 = { ...c3, dM: 30 }
  const r3 = useMemo(() => separationRun(c3, 400, 40000, separationRun(c30).tEnd), []) // eslint-disable-line react-hooks/exhaustive-deps
  const r30 = useMemo(() => separationRun(c30), []) // eslint-disable-line react-hooks/exhaustive-deps
  const f30 = separationFormula(c30)
  const thin = (r: typeof r3) => r.t.map((t, k) => [t, r.vt[k]] as [number, number]).filter((_, k) => k % 10 === 0)
  // the summary: the first picture's far end, with and without an arrester at the end
  const endNo = useMemo(() => timeSeries(f0, an0.lengthM, 500), [f0, an0])
  const endArr = useMemo(() => {
    const s = solve({ ...MODEL0, arrester: true })
    return timeSeries(s.f!, s.an!.lengthM, 500)
  }, [])
  // hand values
  const lH = ohl.lMhKm * 1e-6
  const cF = ohl.cNfKm * 1e-12
  const zcHand = Math.sqrt(lH / cF)
  const vHand = 1 / Math.sqrt(lH * cF) / 1e6
  const gR = (rl - ohl.zc) / (rl + ohl.zc)
  const k0 = an0.k
  const E0 = MODEL0.ekv

  const steps: Array<{ title: string; visual: ReactNode; body: ReactNode; work?: ReactNode }> = [
    {
      title: 'Why can a surge double?',
      visual: (
        <div className="ps-stack">
          <WaveScene
            s={s0}
            t={pb.t}
            probeX={an0.lengthM}
            selected={sel}
            onSelect={setSel}
            fallback={<LineView2D s={s0} t={pb.t} probeX={an0.lengthM} />}
            height={340}
            label="A surge on a line with an open far end"
          />
          <TimeBar t={pb.t} setT={pb.setT} window={an0.window} T={an0.T} playing={pb.playing} setPlaying={pb.setPlaying} />
        </div>
      ),
      body: (
        <>
          <p className="tr-question">Lightning strikes a line far from a substation — why can the voltage at the transformer end up nearly DOUBLE the surge that arrived?</p>
          <p>
            The picture: a <b>source</b> (where the surge enters, with resistance R_s), {fx(MODEL0.lengthKm, 0)} km of <b>line</b>, and the far <b>end</b> — here open, as a transformer looks to a very
            fast surge. The blue ribbon is the computed voltage along the line at the time on the slider. Press play or drag the time.
          </p>
          <p>
            A {fx(f0.F(0.5 * an0.T), 0)} kV wave runs along the line. When it reaches the open end the voltage there jumps to {fx(f0.end(1.5 * an0.T).v, 0)} kV —{' '}
            {fx(f0.end(1.5 * an0.T).v / f0.F(0.5 * an0.T), 2)} times the wave that arrived. The next steps explain why, and what an arrester does about it.
          </p>
          <SyllabusNote />
        </>
      ),
    },
    {
      title: 'A surge is a travelling wave',
      visual: (
        <>
          <LineView2D s={sHalf} t={0.5 * sHalf.an!.T} probeX={0.25 * sHalf.an!.lengthM} compact label="A voltage step half-way along the line" />
          <p className="small muted">Calculated: a {fx(E0, 0)} kV step from a matched source, half a travel time after it starts.</p>
        </>
      ),
      body: (
        <>
          <p>
            A line has inductance L and capacitance C spread along its whole length. Apply a voltage at one end and it cannot appear everywhere at once: the first metre’s capacitance must be charged
            through the first metre’s inductance, then the next metre, and so on. The voltage step moves along the line as a <b>wave</b>, at a speed v set by L and C.
          </p>
          <p>
            Charging the capacitance takes current, so a current wave travels with the voltage wave. The ratio of the two is fixed by the line: the <b>surge impedance</b> Z_c. To an arriving wave the
            line looks like a resistor Z_c — even though it dissipates nothing.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="Z_c = √(L / C)     v = 1 / √(L C)     i_wave = v_wave / Z_c"
            where={[
              ['L, C', 'inductance and capacitance per metre', 'H/m, F/m'],
              ['Z_c', 'surge impedance (characteristic impedance of the lossless line)', 'Ω'],
              ['v', 'propagation speed', 'm/µs'],
            ]}
            assume="a lossless line (no R, no G, no corona or skin-effect attenuation), one propagation mode"
          />
          <Calc
            title="Worked example: Module 8’s 400 kV twin-bundle line"
            steps={[
              { label: 'L and C (Module 8)', expr: `${fx(ohl.lMhKm, 4)} mH/km, ${fx(ohl.cNfKm, 3)} nF/km`, result: `${fx(lH * 1e6, 4)} µH/m, ${fx(cF * 1e12, 3)} pF/m` },
              { label: 'Z_c = √(L/C)', expr: `√(${fx(lH * 1e6, 4)}×10⁻⁶ / ${fx(cF * 1e12, 3)}×10⁻¹²)`, result: `${fx(zcHand, 1)} Ω` },
              { label: 'v = 1/√(LC)', expr: `1 / √(${fx(lH * 1e6, 4)}×10⁻⁶ × ${fx(cF * 1e12, 3)}×10⁻¹²)`, result: `${fx(vHand, 1)} m/µs` },
              { label: 'Current with a 1000 kV wave', expr: `1000 kV / ${fx(zcHand, 1)} Ω`, result: amps((1000 / zcHand) * 1000) },
            ]}
            check={{
              ok: Math.abs(zcHand - ohl.zc) < 1e-9 && Math.abs(vHand - ohl.v) < 1e-9,
              text: `The model uses Z_c = ${fx(ohl.zc, 1)} Ω and v = ${fx(ohl.v, 1)} m/µs — the same (${fx((ohl.v / C_LIGHT) * 100, 1)} % of the speed of light).`,
            }}
          />
          <p className="small muted">
            A cable (typical values: ε_r = {CABLE_TYPICAL.epsR}, conductor radius {CABLE_TYPICAL.rcMm} mm, insulation to {CABLE_TYPICAL.riMm} mm) has {fx(cab.cNfKm / ohl.cNfKm, 1)} times this line’s
            capacitance per metre ({fx(cab.cNfKm, 1)} nF/km): Z_c = {fx(cab.zc, 1)} Ω and v = {fx(cab.v, 1)} m/µs (= c/√ε_r).
          </p>
        </>
      ),
    },
    {
      title: 'At the end: reflection',
      visual: (
        <div className="ps-stack">
          {boundary.map(({ term, s, pts }) => (
            <Chart
              key={term}
              series={[
                {
                  id: term,
                  label: `${term === 'open' ? 'Open end' : term === 'short' ? 'Short-circuited end' : 'Matched resistor'}: v along the line at 1.5 T`,
                  color: term === 'open' ? 'var(--ps-a)' : term === 'short' ? 'var(--ps-c)' : 'var(--ps-b)',
                  points: pts,
                },
              ]}
              xLabel="Distance x [km]"
              yLabel="v [kV]"
              xUnit="km"
              yUnit="kV"
              xDomain={[0, s.an!.model.lengthKm]}
              yDomain={[-200, 1200]}
              height={150}
              label={`Voltage along the line, ${term}`}
            />
          ))}
        </div>
      ),
      body: (
        <>
          <p>
            At the end of the line the wave meets a load Z_L. The load insists on its own ratio v/i = Z_L. If that is not Z_c, the wave alone cannot satisfy it — so a <b>reflected</b> wave is born,
            just big enough to make the totals fit.
          </p>
          <p>
            <b>Open end</b>: no current can flow out, so the reflected current cancels the incident current. A current wave travelling backwards carries the opposite voltage sign, so the reflected
            voltage <i>adds</i>: the end voltage is {fx(boundary[0].s.f!.end(1.5 * boundary[0].s.an!.T).v, 0)} kV, double the {fx(boundary[0].s.f!.F(0.5 * boundary[0].s.an!.T), 0)} kV wave.{' '}
            <b>Short circuit</b>: the voltage must be zero, so the reflected voltage is the negative of the incident one (the current doubles). <b>Matched</b> (Z_L = Z_c): nothing needs to be
            reflected.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="Γ = (Z_L − Z_c)/(Z_L + Z_c)     τ = 1 + Γ = 2Z_L/(Z_L + Z_c)     current: reflected −Γ, transmitted 1 − Γ"
            where={[
              ['Γ', 'voltage reflection coefficient: reflected wave ÷ incident wave', '—'],
              ['τ', 'transmission coefficient: end voltage ÷ incident wave', '—'],
              ['Z_L', 'the load at the end (∞ open, 0 short)', 'Ω'],
            ]}
            assume="a resistive load; each wave’s current measured positive in its own direction of travel"
          />
          <Calc
            title={`Worked example: a ${rl} Ω resistor (a simplified stand-in for a transformer)`}
            steps={[
              { label: 'Γ', expr: `(${rl} − ${fx(ohl.zc, 1)}) / (${rl} + ${fx(ohl.zc, 1)})`, result: fx(gR, 4) },
              { label: 'τ = 1 + Γ', expr: `1 + ${fx(gR, 4)}`, result: fx(1 + gR, 4) },
              { label: 'End voltage (incident wave from a matched source)', expr: `${fx(endR.a, 1)} kV × ${fx(1 + gR, 4)}`, result: kv(endR.a * (1 + gR)) },
              { label: 'Current into the resistor', expr: `${fx(endR.a * (1 + gR), 1)} kV / ${rl} Ω`, result: amps(((endR.a * (1 + gR)) / rl) * 1000) },
            ]}
            check={{
              ok: Math.abs(endR.v - endR.a * (1 + gR)) < 1e-9 && Math.abs(endR.v / rl - (endR.a - endR.r) / ohl.zc) < 1e-9,
              text: `The model’s end voltage is ${kv(endR.v)}, and its line current (incident − reflected)/Z_c = ${amps(endR.iLine)} equals v/Z_L — the boundary condition holds.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'A junction: a line runs into a cable',
      visual: <JunctionPicture a={endJ.a} r={endJ.r} tr={endJ.v} z1={sJ.an!.zc} z2={sJ.an!.zl} />,
      body: (
        <>
          <p>
            A long cable beyond a junction looks, to the arriving wave, like a resistor equal to the cable’s Z_c. So the same Γ and τ apply: part of the wave carries on into the cable (the
            <b> transmitted</b> wave τ·v) and part is reflected back along the line.
          </p>
          <p>
            Going from the line (Z₁ = {fx(sJ.an!.zc, 0)} Ω) into the cable (Z₂ = {fx(sJ.an!.zl, 1)} Ω), only {fx(endJ.v / endJ.a, 3)} of the voltage passes on, and the reflection is{' '}
            {fx(sJ.an!.gammaL, 3)}. Energy is conserved: what arrives either goes on or comes back.
          </p>
        </>
      ),
      work: (
        <Calc
          title="Worked example: overhead line into a cable, 1000 kV step from a matched source"
          steps={[
            { label: 'Incident wave', expr: 'k·E = ½ × 1000 kV (matched source)', result: kv(endJ.a) },
            { label: 'τ = 2Z₂/(Z₁ + Z₂)', expr: `2 × ${fx(sJ.an!.zl, 2)} / (${fx(sJ.an!.zc, 2)} + ${fx(sJ.an!.zl, 2)})`, result: fx(tauOf(sJ.an!.zl, sJ.an!.zc), 4) },
            { label: 'Transmitted voltage', expr: `${fx(endJ.a, 1)} × ${fx(tauOf(sJ.an!.zl, sJ.an!.zc), 4)}`, result: kv(endJ.v) },
            { label: 'Γ = (Z₂ − Z₁)/(Z₂ + Z₁)', expr: `(${fx(sJ.an!.zl, 2)} − ${fx(sJ.an!.zc, 2)}) / (${fx(sJ.an!.zl, 2)} + ${fx(sJ.an!.zc, 2)})`, result: fx(gammaOf(sJ.an!.zl, sJ.an!.zc), 4) },
            { label: 'Reflected voltage', expr: `${fx(endJ.a, 1)} × ${fx(sJ.an!.gammaL, 4)}`, result: kv(endJ.r) },
            { label: 'Power split (per kV² of incident wave)', expr: `reflected Γ²/Z₁ + transmitted τ²/Z₂`, result: `${fx(ps.reflected * 1000, 4)} + ${fx(ps.absorbed * 1000, 4)} mS` },
          ]}
          check={{
            ok: Math.abs(ps.reflected + ps.absorbed - ps.incident) < 1e-12,
            text: `Incident 1/Z₁ = ${fx(ps.incident * 1000, 4)} mS = reflected + transmitted: energy is conserved at the junction.`,
          }}
        />
      ),
    },
    {
      title: 'Back and forth: the Bewley lattice',
      visual: <Lattice f={f0} t={pb.t} onT={pb.setT} probeX={an0.lengthM} height={340} />,
      body: (
        <>
          <p>
            The reflected wave returns to the source, where R_s = {fx(MODEL0.rs, 0)} Ω reflects it again with Γ_s = (R_s − Z_c)/(R_s + Z_c) = {fx(an0.gammaS, 3)}. The wave launched at the very start
            is k = Z_c/(R_s + Z_c) = {fx(k0, 4)} of the source voltage.
          </p>
          <p>
            The <b>lattice diagram</b> keeps track: distance across, time down. Each zig-zag line is one wave, labelled with its value. The voltage at any point and time is the sum of every wave that
            has reached it by then. Each round trip multiplies the waves by Γ_s·Γ_L = {fx(an0.rho, 4)}, so they die away and the end voltage settles at the DC value.
          </p>
        </>
      ),
      work: (
        <Calc
          title={`Worked example: ${fx(E0, 0)} kV step, R_s = ${MODEL0.rs} Ω, open end`}
          steps={[
            { label: 'First wave k·E', expr: `${fx(k0, 4)} × ${fx(E0, 0)}`, result: kv(k0 * E0) },
            ...conv.slice(0, 4).map((c) => ({
              label: `End voltage after ${2 * c.n + 1}T`,
              expr: c.n === 0 ? `(1 + Γ_L) × ${fx(k0 * E0, 1)}` : `previous + (1 + Γ_L)·k·E·(Γ_sΓ_L)^${c.n}`,
              result: kv(c.v, 2),
            })),
            { label: 'Steady state (closed form)', expr: 'E·Z_L/(R_s + Z_L) → E for an open end', result: ss0.kind === 'value' ? kv(ss0.v, 2) : '—' },
          ]}
          check={{
            ok: ss0.kind === 'value' && conv.every((c) => Math.abs(c.err! - -(ss0.v * an0.rho ** (c.n + 1))) < 1e-6),
            text: `After n round trips the difference from the final value is −V_final·(Γ_sΓ_L)^(n+1): ${conv
              .slice(0, 4)
              .map((c) => fx(c.err ?? NaN, 1))
              .join(', ')} kV. The sum approaches ${ss0.kind === 'value' ? kv(ss0.v) : '—'} but never equals it after a finite number of reflections.`,
          }}
        />
      ),
    },
    {
      title: 'Surge shapes: lightning and switching',
      visual: (
        <div className="ps-stack">
          <Chart
            series={[{ id: 'li', label: 'normalised impulse e(t)/E', color: 'var(--ps-a)', points: imp }]}
            xLabel="Time t [µs]"
            yLabel="e / E"
            xUnit="µs"
            yUnit=""
            xDomain={[0, 120]}
            yDomain={[0, 1.08]}
            vlines={[{ x: li.t50, label: `half value at ${fx(li.t50, 1)} µs` }]}
            hlines={[{ y: 0.5, label: '50 %', tone: 'muted' }]}
            height={170}
            label="The fitted 1.2/50 µs impulse"
          />
          <Chart
            series={[
              { id: 'front', label: 'front', color: 'var(--ps-a)', points: impFront },
              {
                id: 'virt',
                label: 'line through 30 % and 90 %',
                color: 'var(--text-3)',
                points: [
                  [li.origin, 0],
                  [li.origin + li.front, 1],
                ],
                dashed: true,
              },
            ]}
            xLabel="Time t [µs]"
            yLabel="e / E"
            xUnit="µs"
            yUnit=""
            xDomain={[-0.5, 6]}
            yDomain={[0, 1.08]}
            hlines={[
              { y: 0.3, label: '30 %', tone: 'muted' },
              { y: 0.9, label: '90 %', tone: 'muted' },
            ]}
            height={170}
            label="The front of the impulse with the 30 % and 90 % points"
          />
        </div>
      ),
      body: (
        <>
          <p>
            Real surges are not perfect steps. <b>Lightning</b> rises in about a microsecond and decays over tens of microseconds; the conventional test waveform is the <b>1.2/50 µs impulse</b>. By
            its definition the front time T1 is 1.67 × the time between the 30 % and 90 % points, and the tail time T2 runs from the virtual origin (where the line through those points crosses zero)
            to the half value on the tail.
          </p>
          <p>
            <b>Switching</b> an unloaded line on is a surge too: closing at the source’s peak applies a 1 pu step at the sending end, and the line takes a wave of k = Z_c/(R_s + Z_c) ={' '}
            {fx(sSw.an!.k, 3)} pu through R_s = 10 Ω. At the open end it doubles: {fx(swPeak, 3)} pu on a 20 km line (lossless model). Real energisation differs: losses, closing resistors and
            controlled switching lower it, while trapped charge on reclosing and other effects can raise it.
          </p>
        </>
      ),
      work: (
        <Calc
          title="The double exponential, fitted to 1.2/50 µs"
          steps={[
            { label: 'e(t) = E (e^(−αt) − e^(−βt)) / η', expr: 'α, β fitted by Newton’s method', result: `α ${fx(LI_FIT.alpha, 5)} /µs, β ${fx(LI_FIT.beta, 4)} /µs` },
            { label: 'Peak of e^(−αt) − e^(−βt)', expr: `at t = ln(β/α)/(β − α) = ${fx(li.tPeak, 3)} µs`, result: `η = ${fx(li.eta, 4)}` },
            { label: '30 % and 90 % on the front', expr: 't_30, t_90', result: `${fx(li.t30, 4)}, ${fx(li.t90, 4)} µs` },
            { label: 'Front time T1 = (t_90 − t_30)/0.6', expr: `(${fx(li.t90, 4)} − ${fx(li.t30, 4)}) / 0.6`, result: `${fx(li.front, 4)} µs` },
            { label: 'Virtual origin O1 = t_30 − 0.3 T1', expr: `${fx(li.t30, 4)} − 0.3 × ${fx(li.front, 4)}`, result: `${fx(li.origin, 4)} µs` },
            { label: 'Tail time T2 = t_50 − O1', expr: `${fx(li.t50, 3)} − (${fx(li.origin, 4)})`, result: `${fx(li.tail, 3)} µs` },
          ]}
          check={{ ok: Math.abs(li.front - 1.2) < 1e-3 && Math.abs(li.tail - 50) < 1e-2, text: `The fitted constants reproduce T1 = ${fx(li.front, 3)} µs and T2 = ${fx(li.tail, 2)} µs.` }}
        />
      ),
    },
    {
      title: 'Arresters and insulation coordination',
      visual: (
        <Chart
          series={[
            { id: 'd3', label: 'transformer, arrester 3 m away', color: 'var(--ps-c)', points: thin(r3) },
            { id: 'd30', label: 'transformer, arrester 30 m away', color: 'var(--ps-a)', points: thin(r30) },
          ]}
          xLabel="Time after the wave reaches the arrester [µs]"
          yLabel="Voltage [kV]"
          xUnit="µs"
          yUnit="kV"
          xDomain={[0, Math.max(r3.tEnd, r30.tEnd)]}
          hlines={[
            { y: SEP0.vres, label: `V_res ${SEP0.vres} kV`, tone: 'warn' },
            { y: SEP0.bil, label: `BIL ${SEP0.bil} kV (illustrative)`, tone: 'bad' },
          ]}
          height={240}
          label="Voltage at the transformer for two arrester distances"
        />
      ),
      body: (
        <>
          <p>
            A <b>surge arrester</b> is a non-linear resistor from line to earth: almost no current at normal voltage, but above its <b>residual voltage</b> V_res it conducts whatever current is needed
            to stop the voltage rising further. Here it is modelled as an ideal clamp — a simplification of a real metal-oxide arrester’s steep V–I curve.
          </p>
          <p>
            <b>Insulation coordination</b>: equipment is tested to withstand a lightning impulse of crest equal to its <b>basic insulation level</b> (BIL). The voltage reaching it must stay below the
            BIL with a margin. But the arrester only fixes the voltage at its own terminals: a transformer {fx(c30.dM, 0)} m away reaches {fx(r30.vtMax, 0)} kV (simulated), against {fx(r3.vtMax, 0)}{' '}
            kV at 3 m.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="protective margin = (BIL − V_protective) / V_protective     V_transformer ≈ V_res + 2·S·d / v"
            where={[
              ['BIL', 'basic insulation level of the equipment (illustrative values here)', 'kV'],
              ['S', 'steepness of the surge front', 'kV/µs'],
              ['d', 'distance from the arrester to the equipment', 'm'],
            ]}
            assume="lossless line, the equipment an open end, ideal clamp, a straight front still rising when the arrester operates, 2Sd/v ≤ V_res"
          />
          <Calc
            title={`Worked example: S = ${SEP0.s} kV/µs, d = 30 m, V_res = ${SEP0.vres} kV, BIL = ${SEP0.bil} kV (illustrative)`}
            steps={[
              { label: 'Travel time d/v', expr: `30 m / ${fx(ohl.v, 1)} m/µs`, result: `${fx(30 / ohl.v, 4)} µs` },
              { label: '2·S·d/v', expr: `2 × ${SEP0.s} × ${fx(30 / ohl.v, 4)}`, result: kv(f30.extra) },
              { label: 'V_transformer', expr: `${SEP0.vres} + ${fx(f30.extra, 1)}`, result: kv(f30.value) },
              { label: 'Margin at the arrester', expr: `(${SEP0.bil} − ${SEP0.vres}) / ${SEP0.vres}`, result: `${fx(margin(SEP0.bil, SEP0.vres) * 100, 1)} %` },
              { label: 'Margin at the transformer', expr: `(${SEP0.bil} − ${fx(f30.value, 1)}) / ${fx(f30.value, 1)}`, result: `${fx(margin(SEP0.bil, f30.value) * 100, 1)} %` },
            ]}
            check={{ ok: f30.valid && Math.abs(r30.vtMax - f30.value) <= r30.peakTol, text: `The simulation gives ${kv(r30.vtMax)} (read to ±${fx(r30.peakTol, 2)} kV): the rule holds here.` }}
          />
        </>
      ),
    },
    {
      title: 'The answer, and what is left out',
      visual: (
        <div className="ps-stack">
          <Chart
            series={[
              { id: 'no', label: 'far end, no arrester', color: 'var(--ps-a)', points: endNo },
              { id: 'arr', label: `far end, arrester at the end (V_res ${MODEL0.vres} kV)`, color: 'var(--ps-c)', points: endArr },
            ]}
            xLabel="Time t [µs]"
            yLabel="Voltage [kV]"
            xUnit="µs"
            yUnit="kV"
            xDomain={[0, an0.window]}
            hlines={[{ y: MODEL0.vres, label: `V_res ${MODEL0.vres} kV`, tone: 'warn' }]}
            height={230}
            label="The far-end voltage of the first picture, with and without an arrester"
          />
          <Callout title="The opening question">
            <p>
              A transformer takes almost no current from a fast surge, so it acts like an open end: the reflected wave adds to the arriving one, and the voltage there reaches up to twice the surge
              that arrived ({fx(f0.end(1.5 * an0.T).v / f0.F(0.5 * an0.T), 2)} × in the first picture). An arrester close to the transformer caps it; one too far away cannot stop the doubling in the
              last few metres.
            </p>
          </Callout>
        </div>
      ),
      body: (
        <>
          <p>
            What you can now do: compute Z_c and v from L and C; find Γ and τ for any resistive end or junction; build a lattice diagram and read the voltage at any point and time; explain why a
            switched open line reaches nearly 2 pu on the lossless model; and check an arrester’s protective margin, including its distance from the equipment.
          </p>
          <Callout tone="info" title="Not modelled here">
            Line losses and corona (which round and attenuate real surges), multi-conductor modes and earth return, the capacitance of transformers, real arrester V–I curves and lead lengths, and
            statistical insulation coordination.
          </Callout>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Explore the model →
          </button>
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — travelling waves and insulation coordination, step ${step + 1} of ${steps.length}: ${cur.title}. Default: ${fx(MODEL0.lengthKm, 0)} km of Module 8’s twin-bundle 400 kV line, Zc ${fx(ohl.zc, 1)} Ω, v ${fx(ohl.v, 1)} m/µs, 1000 kV step, Rs ${MODEL0.rs} Ω, open end; cable Zc ${fx(cab.zc, 1)} Ω.`,
  )
  return (
    <div className="ps-split tr-learn">
      <div className="tr-learn-visual">
        {cur.visual}
        {cur.work &&
          (level === 'beginner' ? (
            <details className="ps-more ps-card">
              <summary>The equations and a worked example</summary>
              {cur.work}
            </details>
          ) : (
            cur.work
          ))}
      </div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}

/** The junction: incident, reflected and transmitted waves as arrows whose lengths are the computed values. */
function JunctionPicture({ a, r, tr, z1, z2 }: { a: number; r: number; tr: number; z1: number; z2: number }) {
  const W = 560
  const H = 280
  const base = 145
  const xj = 300
  const sc = 105 / Math.max(Math.abs(a), Math.abs(r), Math.abs(tr))
  const bar = (x: number, v: number, cls: string, label: string) => {
    const h = Math.abs(v * sc)
    return (
      <g className={cls}>
        <rect x={x} y={v >= 0 ? base - h : base} width={90} height={h} />
        <text x={x + 45} y={v >= 0 ? base - h - 8 : base + h + 16} textAnchor="middle">
          {label} {fx(v, 0)} kV
        </text>
      </g>
    )
  }
  return (
    <figure className="tr-junction">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Incident, reflected and transmitted waves at a junction (calculated)">
        <line x1={20} x2={xj} y1={base} y2={base} className="tr-conductor" />
        <line x1={xj} x2={W - 20} y1={base} y2={base} className="tr-conductor is-cable" />
        <line x1={xj} x2={xj} y1={22} y2={H - 8} className="tr-lat-end" />
        <text x={xj - 10} y={18} textAnchor="end" className="tr-sym-text">
          overhead line Z₁ {fx(z1, 0)} Ω
        </text>
        <text x={xj + 10} y={18} className="tr-sym-text">
          cable Z₂ {fx(z2, 1)} Ω
        </text>
        {bar(50, a, 'tr-jbar tr-jbar--inc', 'incident →')}
        {bar(xj - 110, r, 'tr-jbar tr-jbar--ref', '← reflected')}
        {bar(xj + 40, tr, 'tr-jbar tr-jbar--tr', 'transmitted →')}
      </svg>
      <figcaption className="small muted">Calculated: bar heights are the wave voltages (a 1000 kV step from a matched source), just after the wave reaches the junction.</figcaption>
    </figure>
  )
}
