import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Plot } from '../../ui/Plot.tsx'
import { Calc, Callout, Eq, Stepper, useTutorContext } from '../../ui/kit.tsx'
import { airDensity, computeCorona, computeSpan, computeString, coshm1, diffWords, G0_RMS, parabolaLimit, gradedCaps, RHO_ICE, G, type SpanInput, type SpanResult, type StringResult } from './calc.ts'
import { CORONA_HAND_TOL, lengthTensionCheck, loadsCheck, parabolaCheck, stringCheck, unequalCheck, coronaCheck } from './checks.ts'
import { CoronaSketch, Elevation, Ladder, LoadDiagram } from './diagrams.tsx'
import { DESIGN0, toCoronaInput, toSpanInput } from './model.ts'
import { deg, kN, LP_HREF, MODULE, PartInfo, SyllabusNote } from './shared.tsx'
import { SpanScene, stringDrawLen } from './SpanScene.tsx'

const BASE: SpanInput = toSpanInput(DESIGN0.span)
function span(p: Partial<SpanInput>): SpanResult {
  const r = computeSpan({ ...BASE, ...p })
  if (!r.ok) throw new Error(r.issues[0].message)
  return r
}
function str(n: number, m: number, grading: 'none' | 'capacitance' | 'guard' = 'none', kv = 66): StringResult {
  const r = computeString({ n, m, kv, grading })
  if (!r.ok) throw new Error('invalid string')
  return r
}

export function Learn({ onExplore }: { onExplore(): void }) {
  const level = useLevel()
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const d = useMemo(() => {
    const s0 = span({})
    const st0 = str(DESIGN0.string.n, DESIGN0.string.m)
    const tens = [10, 25, 50].map((t) => span({ T0: t * 1e3 }))
    const spans = [200, 400, 600].map((L) => span({ L, hA: 40 }))
    const uneq = span({ h: 20, T0: 10e3 })
    const uneqOut = span({ h: 20, T0: 25e3 })
    const fos = span({ mode: 'fos', fos: 2.5 })
    const loaded = span({ iceT: 0.01, windP: 400 })
    const s3 = str(3, 0.1)
    const graded = str(5, 0.1, 'capacitance')
    const effTable = [3, 5, 8].map((n) => ({ n, e: [0.05, 0.1, 0.2].map((m) => str(n, m).eff) }))
    const cor = computeCorona(toCoronaInput(DESIGN0))
    const cor220 = computeCorona({ ...toCoronaInput(DESIGN0), kv: 220 })
    if (!cor.ok || !cor220.ok) throw new Error('corona invalid')
    return { s0, st0, tens, spans, uneq, uneqOut, fos, loaded, s3, graded, effTable, cor, cor220 }
  }, [])
  const { s0, st0 } = d
  const w = BASE.w
  const geom = { L: BASE.L, hA: BASE.hA, h: 0, n: st0.input.n }
  const fallback = (
    <div className="mech-fallback">
      <Elevation res={s0} stringLen={stringDrawLen(st0.input.n)} label="Side elevation of the span" />
      <Ladder str={st0} label="The insulator string as a capacitor ladder" />
    </div>
  )
  const lt = lengthTensionCheck(s0)
  const pc = parabolaCheck(s0.T0, w, BASE.L)
  const lc = loadsCheck(d.loaded)
  const uc = unequalCheck(d.uneq)
  const sc = stringCheck(d.s3)
  const cc = coronaCheck(d.cor)
  // error of the parabola against S/L (exact, and the series estimate)
  const errCurve = useMemo(() => {
    const ex: Array<[number, number]> = []
    const est: Array<[number, number]> = []
    for (let i = 0; i <= 60; i++) {
      const sl = 0.002 + (i / 60) * 0.148
      const u = 4 * sl
      ex.push([sl * 100, (coshm1(u) / ((u * u) / 2) - 1) * 100])
      est.push([sl * 100, (4 / 3) * sl * sl * 100])
    }
    return { ex, est }
  }, [])
  const sl1 = useMemo(() => parabolaLimit(0.01), [])
  const st3 = d.s3
  const mults = st3.discV.map((v) => v / st3.discV[0])

  const steps: Array<{ title: string; visual: ReactNode; body: ReactNode; work?: ReactNode }> = [
    {
      title: 'Why does a line hang in a curve?',
      visual: (
        <SpanScene
          geom={geom}
          res={s0}
          str={st0}
          selected={sel}
          onSelect={setSel}
          fallback={fallback}
          info={(id) => <PartInfo id={id} res={s0} str={st0} />}
          height={380}
          label="A span of overhead line between two towers"
        />
      ),
      body: (
        <>
          <p className="mech-question">Why does an overhead line hang in a curve instead of being pulled straight — and why is the insulator disc nearest the conductor the one that fails first?</p>
          <p>
            The picture is one {fx(BASE.L, 0)} m <b>span</b>: two earthed steel <b>towers</b>, a <b>conductor</b> hanging between them, and at each tower an <b>insulator string</b> — a chain of{' '}
            {st0.input.n} porcelain or glass <b>discs</b> that holds the live conductor away from the steel. Select any part to see what it does and its computed values.
          </p>
          <p>
            Three questions decide whether this span works: does the conductor stay high enough above the ground (the <b>clearance</b>), is it strong enough for the <b>tension</b> — including ice and
            wind — and can the insulators and the air around the conductor hold the <b>voltage</b>?
          </p>
          <SyllabusNote />
        </>
      ),
    },
    {
      title: 'Weight against tension',
      visual: (
        <>
          <Plot
            label="The same span at three tensions"
            xLabel="distance from support A [m]"
            yLabel="height above ground [m]"
            series={d.tens.map((r, k) => ({
              id: `t${k}`,
              label: `T₀ ${fx(kN(r.T0), 0)} kN`,
              color: ['var(--ps-a)', 'var(--accent)', 'var(--ps-c)'][k],
              points: [...Array(41)].map((_, i) => {
                const u = (BASE.L * i) / 40
                return [u, BASE.hA - (r.cat.SA - r.cat.c * coshm1((u - r.cat.u0) / r.cat.c))] as [number, number]
              }),
            }))}
            hlines={[{ y: BASE.minClear, label: `minimum clearance ${fx(BASE.minClear, 0)} m` }]}
            height={250}
          />
          <p className="small muted">
            Calculated catenaries of a {fx(BASE.L, 0)} m span of a {fx(w, 1)} N/m conductor. The plot stretches the height axis.
          </p>
        </>
      ),
      body: (
        <>
          <p>
            A flexible conductor can only <b>pull along itself</b>. To hold up its own weight, the pull at each support needs an upward part — so the conductor must slope there, and it sags. A
            perfectly straight conductor would need an infinite tension.
          </p>
          <p>
            Pull harder and the sag shrinks, but the conductor and towers must carry more: at {fx(kN(d.tens[0].T0), 0)} kN the sag is {fx(d.tens[0].cat.SB, 2)} m, at {fx(kN(d.tens[2].T0), 0)} kN only{' '}
            {fx(d.tens[2].cat.SB, 2)} m. Too tight and the conductor may snap — or vibrate in the wind; too slack and it comes too close to the ground (and swings into its neighbours).
          </p>
          <p>
            The exact shape of a uniform, perfectly flexible chain is the <b>catenary</b>. Its tension at the lowest point, T₀, is horizontal; everywhere else T = T₀ + w·y, rising with height above
            the lowest point.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            title="The catenary"
            expr="y = c·(cosh(x/c) − 1)     c = T₀/w     S = c·(cosh(L/2c) − 1)     ℓ = 2c·sinh(L/2c)     T = T₀ + w·S"
            where={[
              ['x, y', 'distance from the lowest point, height above it', 'm'],
              ['T₀', 'tension at the lowest point (horizontal)', 'N'],
              ['w', 'load per metre of conductor', 'N/m'],
              ['L, S, ℓ', 'span, sag (level supports), conductor length', 'm'],
              ['T', 'tension at a support', 'N'],
            ]}
            assume="a uniform, perfectly flexible, inextensible conductor; level supports for S and ℓ"
          />
          <Calc
            title={`Worked example: ${fx(BASE.L, 0)} m span, w = ${fx(w, 1)} N/m, T₀ = ${fx(kN(s0.T0), 0)} kN`}
            steps={[
              { label: 'c = T₀ / w', expr: `${fx(s0.T0, 0)} / ${fx(w, 1)}`, result: `${fx(s0.cat.c, 2)} m` },
              { label: 'L / 2c', expr: `${fx(BASE.L, 0)} / (2 × ${fx(s0.cat.c, 2)})`, result: fx(BASE.L / (2 * s0.cat.c), 5) },
              { label: 'S = c(cosh(L/2c) − 1)', expr: `${fx(s0.cat.c, 2)} × (cosh ${fx(BASE.L / (2 * s0.cat.c), 5)} − 1)`, result: `${fx(s0.cat.SB, 4)} m` },
              { label: 'ℓ = 2c·sinh(L/2c)', expr: `2 × ${fx(s0.cat.c, 2)} × sinh ${fx(BASE.L / (2 * s0.cat.c), 5)}`, result: `${fx(s0.cat.length, 3)} m` },
              { label: 'T = T₀ + wS', expr: `${fx(s0.T0, 0)} + ${fx(w, 1)} × ${fx(s0.cat.SB, 4)}`, result: `${fx(kN(s0.cat.TB), 4)} kN` },
            ]}
            check={{
              ok: lt.ok,
              text: `Independent check: integrating √(1 + y′²) along the curve numerically gives ${fx(lt.numLen, 3)} m, and T₀·√(1 + y′²) at the support (tension along the tangent) gives ${fx(kN(lt.tTangent), 4)} kN — the same.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'The parabola — and when it is good enough',
      visual: (
        <>
          <Plot
            label="How far the parabola is below the catenary, against sag ÷ span"
            xLabel="sag ÷ span, S/L [%]"
            yLabel="parabola error [%]"
            series={[
              { id: 'ex', label: 'exact', color: 'var(--accent)', points: errCurve.ex },
              { id: 'est', label: '(4/3)(S/L)²', color: 'var(--warning)', points: errCurve.est, dashed: true },
            ]}
            vlines={[{ x: sl1 * 100, label: `1 % at S/L = ${fx(sl1 * 100, 1)} %` }]}
            height={240}
          />
          <p className="small muted">Calculated from the catenary and parabola formulas (level supports).</p>
        </>
      ),
      body: (
        <>
          <p>
            For a tight span the curve is shallow and cosh can be replaced by the first terms of its series. The catenary becomes a <b>parabola</b>, and the sag a simple formula every textbook uses: S
            = wL²/(8T₀). It says sag grows with the <b>square</b> of the span and falls in proportion to the tension.
          </p>
          <p>
            How good is it? The parabola always comes out a little low, by about (4/3)(S/L)². For this span (S/L = {fx((s0.cat.SB / BASE.L) * 100, 2)} %) the error is {diffWords(s0.relDiff)}. It
            reaches 1 % only when the sag is {fx(sl1 * 100, 1)} % of the span — very slack spans, or river crossings with deep sags. This module flags any span where the parabola is more than 1 % off.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            title="Parabolic approximation"
            expr="S ≈ wL² / (8T₀)     ℓ ≈ L + 8S²/(3L)     (S_cat − S_par)/S_par ≈ (4/3)(S/L)²"
            where={[
              ['w', 'load per metre', 'N/m'],
              ['L', 'span', 'm'],
              ['T₀', 'tension at the lowest point (≈ the working tension)', 'N'],
            ]}
            assume="S ≪ L (shallow sag); T is taken as constant along the span"
          />
          <Calc
            title="Worked example: the same span by the parabola"
            steps={[
              { label: 'S = wL²/(8T₀)', expr: `${fx(w, 1)} × ${fx(BASE.L, 0)}² / (8 × ${fx(s0.T0, 0)})`, result: `${fx(pc.Spar, 4)} m` },
              { label: 'Catenary (step 2)', expr: 'c(cosh(L/2c) − 1)', result: `${fx(pc.Scat, 4)} m` },
              { label: 'Difference', expr: `(${fx(pc.Scat, 4)} − ${fx(pc.Spar, 4)}) / ${fx(pc.Spar, 4)}`, result: `${fx(pc.d * 100, 4)} %` },
              { label: 'Estimate (4/3)(S/L)²', expr: `(4/3) × (${fx(pc.Spar, 3)} / ${fx(BASE.L, 0)})²`, result: `${fx(pc.lo * 100, 4)} %` },
            ]}
            check={{ ok: pc.ok, text: `The difference lies between (4/3)(S/L)² and (4/3)(S/L)²·cosh(L/2c) = ${fx(pc.hi * 100, 4)} % — as the series of cosh guarantees.` }}
          />
          <div className="table-wrap">
            <table className="ps-table">
              <caption className="small muted">The same conductor (T₀ = {fx(kN(s0.T0), 0)} kN) on longer spans — computed</caption>
              <thead>
                <tr>
                  <th scope="col">Span [m]</th>
                  <th scope="col">Parabola S [m]</th>
                  <th scope="col">Catenary S [m]</th>
                  <th scope="col">Parabola low by</th>
                </tr>
              </thead>
              <tbody>
                {d.spans.map((r) => (
                  <tr key={r.input.L}>
                    <td>{fx(r.input.L, 0)}</td>
                    <td>{fx(r.par.Slevel, 3)}</td>
                    <td>{fx(r.cat.SB, 3)}</td>
                    <td>{fx(r.relDiff * 100, 3)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ),
    },
    {
      title: 'Supports at different levels, and the working tension',
      visual: <Elevation res={d.uneq} stringLen={stringDrawLen(5)} label="A span with support B 20 m higher than support A" />,
      body: (
        <>
          <p>
            On a hillside or a river crossing one support is higher. The curve is the same shape, but its lowest point moves towards the <b>lower</b> support: x₁ from the lower support, x₂ from the
            higher, with x₁ + x₂ = L. Each sag is measured from its own support, and they differ by exactly the height difference: S₂ − S₁ = h.
          </p>
          <p>
            Here (h = {fx(d.uneq.input.h, 0)} m, T₀ = {fx(kN(d.uneq.T0), 0)} kN) the lowest point is {fx(d.uneq.par.x1, 1)} m from A. Tighten to {fx(kN(d.uneqOut.T0), 0)} kN and x₁ ={' '}
            {fx(d.uneqOut.par.x1, 1)} m
            {d.uneqOut.par.x1 < 0 ? ' — negative: the lowest point of the curve lies beyond A, so the conductor rises all the way from A, which is its lowest point in the span' : ''}.
          </p>
          <p>
            <b>Working tension.</b> The tension is chosen from the conductor’s breaking strength and a <b>factor of safety</b>: T_w = breaking strength ÷ FoS. Textbooks put T_w straight into S =
            wL²/(8T); strictly T_w is the largest tension — at the (higher) support.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="x₁ = L/2 − T₀h/(wL)     x₂ = L/2 + T₀h/(wL)     S₁ = w·x₁²/(2T₀)     S₂ = w·x₂²/(2T₀)"
            where={[
              ['h', 'height of the higher support above the lower', 'm'],
              ['x₁, x₂', 'horizontal distance of the lowest point from the lower and the higher support', 'm'],
              ['S₁, S₂', 'sag below the lower and the higher support', 'm'],
            ]}
            assume="parabolic approximation; if x₁ < 0 the lowest point is outside the span"
          />
          <Calc
            title={`Worked example: L = ${fx(BASE.L, 0)} m, h = ${fx(d.uneq.input.h, 0)} m, w = ${fx(w, 1)} N/m, T₀ = ${fx(kN(d.uneq.T0), 0)} kN`}
            steps={[
              { label: 'T₀h/(wL)', expr: `${fx(d.uneq.T0, 0)} × ${fx(d.uneq.input.h, 0)} / (${fx(w, 1)} × ${fx(BASE.L, 0)})`, result: `${fx((d.uneq.T0 * d.uneq.input.h) / (w * BASE.L), 2)} m` },
              { label: 'x₁, x₂', expr: `${fx(BASE.L / 2, 0)} ∓ ${fx((d.uneq.T0 * d.uneq.input.h) / (w * BASE.L), 2)}`, result: `${fx(uc.par.x1, 2)} m, ${fx(uc.par.x2, 2)} m` },
              { label: 'S₁ = w x₁²/(2T₀)', expr: `${fx(w, 1)} × ${fx(uc.par.x1, 2)}² / (2 × ${fx(d.uneq.T0, 0)})`, result: `${fx(uc.par.SA, 3)} m` },
              { label: 'S₂ = w x₂²/(2T₀)', expr: `${fx(w, 1)} × ${fx(uc.par.x2, 2)}² / (2 × ${fx(d.uneq.T0, 0)})`, result: `${fx(uc.par.SB, 3)} m` },
              { label: 'Catenary (exact)', expr: 'S₁, S₂', result: `${fx(d.uneq.cat.SA, 3)} m, ${fx(d.uneq.cat.SB, 3)} m` },
            ]}
            check={{ ok: uc.ok, text: `S₂ − S₁ = ${fx(uc.dPar, 6)} m by the parabola and ${fx(uc.dCat, 6)} m by the catenary — both exactly h, so each curve passes through both supports.` }}
          />
          <Calc
            title={`Working tension: breaking strength ${fx(BASE.uts / 1000, 0)} kN, factor of safety 2.5`}
            steps={[
              { label: 'T_w = breaking strength / FoS', expr: `${fx(BASE.uts / 1000, 0)} / 2.5`, result: `${fx(kN(d.fos.Tworking ?? 0), 2)} kN` },
              {
                label: 'Textbook: S = wL²/(8T_w)',
                expr: `${fx(w, 1)} × ${fx(BASE.L, 0)}² / (8 × ${fx(d.fos.Tworking ?? 0, 0)})`,
                result: `${fx((w * BASE.L ** 2) / (8 * (d.fos.Tworking ?? 1)), 4)} m`,
              },
              { label: 'Exact: T_w at the supports → T₀', expr: 'solve T₀ + wS = T_w', result: `T₀ = ${fx(kN(d.fos.T0), 4)} kN, S = ${fx(d.fos.cat.SB, 4)} m` },
            ]}
            check={{
              ok: Math.abs(d.fos.Tmax - (d.fos.Tworking ?? 0)) < 1e-6 * d.fos.Tmax,
              text: `The support tension of the exact span is ${fx(kN(d.fos.Tmax), 4)} kN = T_w; the textbook shortcut differs by T_w − T₀ = wS = ${fx(d.fos.Tmax - d.fos.T0, 1)} N.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Wind and ice',
      visual: <LoadDiagram loads={d.loaded.loads} d={BASE.d} t={0.01} p={400} />,
      body: (
        <>
          <p>
            <b>Ice</b> builds up as a ring round the conductor and adds weight. <b>Wind</b> pushes sideways on the iced conductor’s projected area. The conductor now carries a <b>resultant</b> load
            w_r, tilted from the vertical by θ, and it hangs — and sags — in that tilted plane: the line swings sideways.
          </p>
          <p>
            With 10 mm of ice and 400 N/m² of wind (illustrative design values), w_r = {fx(d.loaded.loads.wr, 2)} N/m, {fx(d.loaded.loads.wr / w, 2)} times the bare weight, at θ ={' '}
            {fx(deg(d.loaded.loads.theta), 1)}°. The sag in the tilted plane is {fx(d.loaded.cat.SB, 2)} m; only its vertical part, S·cos θ = {fx(d.loaded.vSagA, 2)} m, reduces the ground clearance —
            to {fx(d.loaded.clearance, 2)} m. The tension rises to {fx(kN(d.loaded.Tmax), 2)} kN: this worst-case load is what the factor of safety must cover.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="w_i = ρ_ice·g·π·t(d + t)     w_w = p·(d + 2t)     w_r = √((w + w_i)² + w_w²)     tan θ = w_w/(w + w_i)     vertical sag = S·cos θ"
            where={[
              ['t', 'radial thickness of ice', 'm'],
              ['d', 'conductor diameter', 'm'],
              ['ρ_ice', `density of ice, ${RHO_ICE} (typical)`, 'kg/m³'],
              ['p', 'wind pressure on the projected area (a design input, not from a specific standard)', 'N/m²'],
              ['θ', 'angle of the sag plane from the vertical', '°'],
            ]}
            assume="ice uniform round the conductor; steady wind across the line"
          />
          <Calc
            title={`Worked example: d = ${fx(BASE.d * 1000, 1)} mm, t = 10 mm, p = 400 N/m², ${fx(BASE.L, 0)} m span, T₀ = ${fx(kN(BASE.T0), 0)} kN`}
            steps={[
              { label: 'w_i', expr: `${RHO_ICE} × ${G} × π × 0.01 × (${fx(BASE.d, 4)} + 0.01)`, result: `${fx(lc.wi, 3)} N/m` },
              { label: 'w_w', expr: `400 × (${fx(BASE.d, 4)} + 0.02)`, result: `${fx(lc.ww, 3)} N/m` },
              { label: 'w_r', expr: `√((${fx(w, 2)} + ${fx(lc.wi, 3)})² + ${fx(lc.ww, 3)}²)`, result: `${fx(lc.wr, 3)} N/m` },
              { label: 'θ', expr: `atan(${fx(lc.ww, 3)} / ${fx(lc.wv, 3)})`, result: `${fx(deg(lc.theta), 2)}°` },
              { label: 'S (load plane, parabola)', expr: `${fx(lc.wr, 3)} × ${fx(BASE.L, 0)}² / (8 × ${fx(BASE.T0, 0)})`, result: `${fx(d.loaded.par.Slevel, 3)} m` },
              { label: 'Vertical sag S cos θ (catenary S)', expr: `${fx(lc.S, 4)} × cos ${fx(deg(lc.theta), 2)}°`, result: `${fx(lc.vSag, 3)} m` },
              { label: 'Clearance', expr: `${fx(BASE.hA, 1)} − ${fx(lc.vSag, 3)}`, result: `${fx(lc.clear, 3)} m` },
            ]}
            check={{
              ok: lc.ok,
              text: `The 3D model, which finds the lowest point by minimising the height of the curve (no cos θ used), gives a clearance of ${fx(d.loaded.clearance, 3)} m — the same.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Insulator strings: which disc fails first',
      visual: <Ladder str={st0} label="A five-disc string as a capacitor ladder, with each disc's computed voltage" />,
      body: (
        <>
          <p>
            Each disc is a <b>capacitor</b>: its metal cap and pin are the plates, porcelain the dielectric. If that were all, the discs in series would share the phase voltage equally. But every
            metal link between two discs also faces the earthed tower across the air: a small <b>shunt capacitance</b> mC to earth.
          </p>
          <p>
            Each shunt takes a little charging current. The current through disc 1 (at the cross-arm) is the smallest; disc 2 carries disc 1’s current <i>plus</i> the first shunt’s, and so on. The
            disc next to the conductor carries all of them — so with equal capacitances it has the largest voltage. In this {st0.input.n}-disc string (m = {fx(st0.input.m, 2)}, {st0.input.kv} kV) it
            takes {fx((st0.discV[st0.input.n - 1] / st0.V) * 100, 1)} % of the phase voltage, {fx(st0.discV[st0.input.n - 1] / st0.discV[0], 2)} times the top disc. That disc flashes over or punctures
            first.
          </p>
          <p>
            <b>String efficiency</b> η = V/(n·V_max) measures how evenly the voltage is shared: here {fx(st0.eff * 100, 1)} % (100 % would be a perfectly even string).
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            title="The ladder relations"
            expr="V₂ = V₁(1 + m)     V_{k+1} = V_k + m·(V₁ + … + V_k)     V = V₁ + … + V_n     η = V / (n·V_n)"
            where={[
              ['V_k', 'voltage across disc k (1 at the cross-arm, n at the line)', 'kV'],
              ['m', 'shunt capacitance ÷ disc capacitance', '—'],
              ['V', 'phase (line-to-earth) voltage, V_LL/√3', 'kV'],
            ]}
            assume="equal discs; leakage current over the surfaces neglected; no capacitance from the line to the links"
          />
          <Calc
            title={`Worked example: 3 discs, m = ${fx(st3.input.m, 1)}, ${st3.input.kv} kV line (V = ${fx(st3.V, 3)} kV)`}
            steps={[
              { label: 'V₂ = V₁(1 + m)', expr: `(1 + ${st3.input.m}) V₁`, result: `${fx(mults[1], 4)} V₁` },
              { label: 'V₃ = V₂ + m(V₁ + V₂)', expr: `${fx(mults[1], 4)} V₁ + ${st3.input.m} × ${fx(1 + mults[1], 4)} V₁`, result: `${fx(mults[2], 4)} V₁` },
              {
                label: 'V = V₁ + V₂ + V₃',
                expr: `${fx(
                  mults.reduce((a, b) => a + b, 0),
                  4,
                )} V₁ = ${fx(st3.V, 3)} kV`,
                result: `V₁ = ${fx(st3.discV[0], 3)} kV`,
              },
              { label: 'V₂, V₃', expr: `${fx(mults[1], 4)} V₁, ${fx(mults[2], 4)} V₁`, result: `${fx(st3.discV[1], 3)}, ${fx(st3.discV[2], 3)} kV` },
              { label: 'η = V / (3 V₃)', expr: `${fx(st3.V, 3)} / (3 × ${fx(st3.discV[2], 3)})`, result: `${fx(st3.eff * 100, 2)} %` },
            ]}
            check={{ ok: sc.ok, text: `An independent nodal solve of the same circuit gives ${sc.plain.map((v) => fx(v, 3)).join(', ')} kV — the same.` }}
          />
        </>
      ),
    },
    {
      title: 'Evening out the string',
      visual: (
        <>
          <Ladder str={d.graded} label="The same five-disc string with capacitance grading: every disc carries the same voltage" />
          <div className="table-wrap">
            <table className="ps-table">
              <caption className="small muted">String efficiency without grading — computed</caption>
              <thead>
                <tr>
                  <th scope="col">Discs</th>
                  <th scope="col">m = 0.05</th>
                  <th scope="col">m = 0.1</th>
                  <th scope="col">m = 0.2</th>
                </tr>
              </thead>
              <tbody>
                {d.effTable.map((r) => (
                  <tr key={r.n}>
                    <td>{r.n}</td>
                    {r.e.map((e, k) => (
                      <td key={k}>{fx(e * 100, 1)} %</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ),
      body: (
        <>
          <p>Three ways to make the discs share the voltage more evenly:</p>
          <p>
            <b>1 · A longer cross-arm.</b> Moving the string away from the tower reduces the shunt capacitance, so m falls (the table: smaller m, higher η). Limited by the tower’s cost and strength.
          </p>
          <p>
            <b>2 · Capacitance grading.</b> Give each disc just enough capacitance to carry the current arriving from above without extra voltage: C_k = C(1 + m·k(k−1)/2). For 5 discs and m = 0.1 the
            line-end disc needs {fx(gradedCaps(5, 0.1)[4], 2)} times the top disc’s capacitance — the picture shows every disc at {fx(d.graded.V / 5, 2)} kV. In practice a few disc sizes approximate
            it.
          </p>
          <p>
            <b>3 · A guard (grading) ring.</b> A metal ring round the bottom of the string, connected to the line, adds capacitance from the line to each link. Its currents feed the shunt currents, so
            less has to pass through the lower discs. The module models an <i>ideal</i> ring — the line-to-link capacitances that cancel every shunt current exactly (C_g,k = C·m·k/(n − k)); a real
            ring only approaches it.
          </p>
        </>
      ),
      work: (
        <Calc
          title="Capacitance grading, 5 discs, m = 0.1"
          steps={d.graded.discC.map((c, i) => ({ label: `C${i + 1}`, expr: `C(1 + 0.1 × ${i + 1} × ${i} / 2)`, result: `${fx(c, 3)} C` }))}
          check={{ ok: stringCheck(d.graded).ok, text: `A nodal solve with these capacitances gives every disc ${fx(d.graded.discV[0], 4)} kV (V/5) — η = ${fx(d.graded.eff * 100, 2)} %.` }}
        />
      ),
    },
    {
      title: 'Corona: when the air itself breaks down',
      visual: <CoronaSketch />,
      body: (
        <>
          <p>
            The electric field is strongest right at a conductor’s surface, and stronger the thinner the conductor. Air breaks down at about 30 kV/cm (peak) at normal pressure and temperature. When
            the surface field exceeds that, the air next to the conductor ionises: a hissing sound, a faint violet glow at night, ozone, radio noise — and power loss. That is <b>corona</b>.
          </p>
          <p>
            The phase voltage at which it starts is the <b>critical disruptive voltage</b> V_c (Peek’s empirical formula). For the module’s conductor (r = {fx(d.cor.input.rCm, 3)} cm, D ={' '}
            {fx(d.cor.input.DCm / 100, 1)} m, m₀ = {fx(d.cor.input.m0, 2)}, δ = {fx(d.cor.delta, 2)}) V_c = {fx(d.cor.vc, 1)} kV per phase, {fx(d.cor.vcLine, 1)} kV line to line: the {d.cor.input.kv}{' '}
            kV line is {d.cor.above ? 'above it' : 'below it'}, a 220 kV line ({fx(d.cor220.vPhase, 1)} kV per phase) would be {d.cor220.above ? 'above it' : 'below it'}.
          </p>
          <p>
            <b>What raises V_c:</b> a larger radius (the main remedy — or a bundle, which spreads the charge over several conductors; see{' '}
            <a className="ps-link" href={LP_HREF}>
              Module 8
            </a>
            ), wider spacing (only logarithmically), denser air (δ: low altitude, cool weather) and a smooth, clean surface (m₀). Rain, fog and dirt lower it.
          </p>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Explore the span, the string and corona →
          </button>
        </>
      ),
      work: (
        <>
          <Eq
            title="Peek’s formulas (empirical)"
            expr="V_c = m₀·g₀·δ·r·ln(D/r)     V_v = m_v·g₀·δ·r·(1 + 0.3/√(δr))·ln(D/r)     δ = 3.92·b/(273 + t)"
            where={[
              ['V_c, V_v', 'critical disruptive and visual critical voltage, rms phase to neutral', 'kV'],
              ['g₀', `breakdown strength of air: 30 kV/cm peak = ${fx(G0_RMS, 2)} kV/cm rms (often rounded to 21.1)`, 'kV/cm'],
              ['r, D', 'conductor radius and spacing (GMD for an unsymmetrical line)', 'cm'],
              ['m₀, m_v', 'surface factors: 1 polished; about 0.80–0.87 (m₀) for stranded conductors (typical textbook values)', '—'],
              ['δ', 'air density factor, 1 at 76 cmHg and 25 °C', '—'],
              ['b, t', 'air pressure, temperature', 'cmHg, °C'],
            ]}
            assume="empirical (Peek): round conductors in air at power frequency, D ≫ r, fair weather"
          />
          <Calc
            title={`Worked example: r = ${fx(d.cor.input.rCm, 3)} cm, D = ${fx(d.cor.input.DCm, 0)} cm, m₀ = ${d.cor.input.m0}, 76 cmHg, 25 °C`}
            steps={[
              { label: 'δ = (b/76)·(298/(273 + t))', expr: `(76/76) × (298/298)`, result: `${fx(cc.deltaExact, 4)} (3.92·b/(273 + t) gives ${fx(cc.delta, 4)})` },
              { label: 'ln(D/r)', expr: `ln(${fx(d.cor.input.DCm, 0)} / ${fx(d.cor.input.rCm, 3)})`, result: fx(d.cor.lnDr, 4) },
              { label: 'V_c', expr: `${d.cor.input.m0} × ${fx(G0_RMS, 3)} × ${fx(airDensity(76, 25), 3)} × ${fx(d.cor.input.rCm, 3)} × ${fx(d.cor.lnDr, 4)}`, result: `${fx(d.cor.vc, 2)} kV (phase)` },
              { label: 'Line to line', expr: `√3 × ${fx(d.cor.vc, 2)}`, result: `${fx(d.cor.vcLine, 1)} kV` },
              { label: 'With g₀ rounded to 21.1', expr: `${d.cor.input.m0} × 21.1 × … `, result: `${fx(cc.vc211, 2)} kV` },
            ]}
            check={{
              ok: cc.ok,
              text: `By hand with the textbook δ = 3.92·b/(273 + t): ${fx(cc.vcHand, 2)} kV, within ${fx(CORONA_HAND_TOL * 100, 2)} % of the model (3.92 is 298/76 rounded). Consistency: at V_c the charge q = 2πε₀V/ln(D/r) gives a surface field q/(2πε₀r) = ${fx(cc.g, 3)} kV/cm — exactly the breakdown gradient m₀·g₀·δ, which is what V_c means.`,
            }}
          />
          <Callout tone="info" title="Not computed here">
            Peek also gave an empirical formula for the power lost once corona has started; it is not computed in this module.
          </Callout>
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — mechanical design and insulation, step ${step + 1} of ${steps.length}: ${cur.title}. Default span ${BASE.L} m, w ${w} N/m, T0 ${kN(BASE.T0)} kN: sag ${fx(s0.cat.SB, 3)} m (parabola ${fx(s0.par.Slevel, 3)} m), clearance ${fx(s0.clearance, 2)} m. String ${st0.input.n} discs m ${st0.input.m}: ${st0.discV.map((v) => fx(v, 2)).join(', ')} kV, η ${fx(st0.eff * 100, 1)} %. Corona Vc ${fx(d.cor.vc, 1)} kV phase.`,
  )
  return (
    <div className="ps-split mech-learn">
      <div className="mech-learn-visual">
        {cur.visual}
        {level === 'beginner' && cur.work ? (
          <details className="ps-more">
            <summary>The equations and a worked example</summary>
            {cur.work}
          </details>
        ) : (
          cur.work
        )}
      </div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}
