import { useMemo, useState } from 'react'
import { fx } from '../../ui/format.ts'
import { Readouts, Slider } from '../../ui/kit.tsx'
import { Chart } from './charts.tsx'
import { margin, MEDIA, SEP0, SEP_LIMITS, separationFormula, separationRun, type SepCase } from './waves.ts'

/*
 * Insulation coordination: the arrester's protective level, the equipment's basic insulation level (BIL —
 * ILLUSTRATIVE values, not taken from a standard), the protective margin, and the separation-distance effect: an
 * arrester d metres from an open-ended transformer, a ramp front of S kV/µs from a long line.
 */

export const marginWords = (mg: number) =>
  mg < 0 ? 'the voltage EXCEEDS the BIL — the insulation is not protected' : mg < 0.1 ? 'a thin margin' : mg < 0.3 ? 'a moderate margin' : 'a comfortable margin'

export function Coordination({ vres, setVres }: { vres: number; setVres(v: number): void }) {
  const [d, setD] = useState<number>(SEP0.dM)
  const [s, setS] = useState<number>(SEP0.s)
  const [e, setE] = useState<number>(SEP0.ekv)
  const [bil, setBil] = useState<number>(SEP0.bil)
  const [cursor, setCursor] = useState<number | null>(null)
  const line = MEDIA['ohl-twin']
  const c: SepCase = { zc: line.zc, v: line.v, dM: d, s, ekv: e, vres: Math.min(Math.max(vres, SEP_LIMITS.vres[0]), SEP_LIMITS.vres[1]) }
  const run = useMemo(() => separationRun(c), [c.dM, c.s, c.ekv, c.vres]) // eslint-disable-line react-hooks/exhaustive-deps
  const fm = separationFormula(c)
  const step = Math.max(1, Math.floor(run.t.length / 700))
  const pick = (ys: number[]) => run.t.map((t, k) => [t, ys[k]] as [number, number]).filter((_, k) => k % step === 0)
  const mA = margin(bil, c.vres)
  const mT = margin(bil, run.vtMax)
  const arrOperates = run.vaMax >= c.vres - 1e-9
  return (
    <div className="ps-stack tr-coord">
      <p className="small">
        An arrester protects equipment by capping the voltage at its own terminals. Coordination asks: does the equipment’s insulation strength — its <b>basic insulation level (BIL)</b>, the
        lightning-impulse crest it is tested to withstand — exceed the voltage that actually reaches it, with a margin? Here a transformer (seen by a fast surge as an open end) sits d metres from the
        arrester on {line.short.toLowerCase()} (v = {fx(line.v, 1)} m/µs); a surge with a straight front of S kV/µs arrives from a long line. BIL and V_res values are <b>illustrative</b>, not from a
        standard.
      </p>
      <div className="ps-cols-2">
        <div>
          <Slider label="Separation distance d" value={d} min={SEP_LIMITS.dM[0]} max={SEP_LIMITS.dM[1]} step={1} unit="m" decimals={0} onChange={setD} hint="arrester to transformer" />
          <Slider label="Front steepness S" value={s} min={SEP_LIMITS.s[0]} max={SEP_LIMITS.s[1]} step={50} unit="kV/µs" decimals={0} onChange={setS} />
          <Slider label="Incoming surge crest" value={e} min={SEP_LIMITS.ekv[0]} max={SEP_LIMITS.ekv[1]} step={50} unit="kV" decimals={0} onChange={setE} />
        </div>
        <div>
          <Slider
            label="Arrester residual voltage V_res"
            value={c.vres}
            min={SEP_LIMITS.vres[0]}
            max={SEP_LIMITS.vres[1]}
            step={10}
            unit="kV"
            decimals={0}
            onChange={setVres}
            hint="the protective level (illustrative)"
          />
          <Slider label="Transformer BIL" value={bil} min={SEP_LIMITS.bil[0]} max={SEP_LIMITS.bil[1]} step={25} unit="kV" decimals={0} onChange={setBil} hint="illustrative, not a standard value" />
        </div>
      </div>
      <Readouts
        label="Coordination results"
        items={[
          { label: 'Peak at the transformer (simulated)', value: fx(run.vtMax, 1), unit: 'kV', note: `read to ±${fx(run.peakTol, 2)} kV`, tone: mT < 0 ? 'bad' : mT < 0.1 ? 'warn' : 'good' },
          { label: 'Rule V_res + 2Sd/v', value: fx(fm.value, 1), unit: 'kV', note: fm.valid ? `2Sd/v = ${fx(fm.extra, 1)} kV` : 'assumptions not met (below)' },
          { label: 'Margin at the arrester', value: fx(mA * 100, 1), unit: '%', note: '(BIL − V_res)/V_res', tone: mA < 0 ? 'bad' : undefined },
          { label: 'Margin at the transformer', value: fx(mT * 100, 1), unit: '%', note: marginWords(mT), tone: mT < 0 ? 'bad' : mT < 0.1 ? 'warn' : 'good' },
        ]}
      />
      <Chart
        series={[
          { id: 'a', label: 'incoming wave', color: 'var(--text-3)', points: pick(run.a), dashed: true },
          { id: 'va', label: 'arrester terminal', color: 'var(--ps-c)', points: pick(run.va) },
          { id: 'vt', label: 'transformer', color: 'var(--ps-a)', points: pick(run.vt) },
        ]}
        xLabel="Time after the wave reaches the arrester [µs]"
        yLabel="Voltage [kV]"
        xUnit="µs"
        yUnit="kV"
        xDomain={[0, run.tEnd]}
        hlines={[
          { y: c.vres, label: `V_res ${fx(c.vres, 0)} kV`, tone: 'warn' },
          { y: bil, label: `BIL ${fx(bil, 0)} kV`, tone: 'bad' },
        ]}
        cursor={cursor}
        onCursor={setCursor}
        height={250}
        width={1150}
        label="Voltage at the arrester and at the transformer against time"
      />
      <div className="small">
        {!arrOperates ? (
          <p>The surge never drives the arrester terminal to V_res, so the arrester does not operate and the transformer sees the doubled wave.</p>
        ) : fm.valid ? (
          <p>
            The rule holds here: the simulated peak {fx(run.vtMax, 1)} kV and V_res + 2Sd/v = {fx(fm.value, 1)} kV differ by {fx(Math.abs(run.vtMax - fm.value), 2)} kV, within the sampling resolution
            of ±{fx(run.peakTol, 2)} kV.
          </p>
        ) : (
          <p>
            The rule V_res + 2Sd/v does not apply here: {fm.reasons.join('; ')}. The simulated peak is {fx(run.vtMax, 1)} kV.
          </p>
        )}
        <details className="ps-more">
          <summary>Where 2Sd/v comes from</summary>
          <p>
            Let τ = d/v. The front passes the arrester (which does not conduct yet), reaches the open transformer after τ and doubles there; its reflection is back at the arrester after 2τ. From then
            on the arrester terminal sees the incident ramp plus the reflection: v_A = S·t + S·(t − 2τ). The arrester operates when v_A = V_res, at t_c = (V_res + 2Sτ)/(2S); the wave heading to the
            transformer at that moment is S·t_c = V_res/2 + Sτ, and it doubles: V_T = V_res + 2Sτ = V_res + 2Sd/v.
          </p>
          <p className="muted">
            Assumes a lossless line, a transformer that is a pure open end (its winding capacitance is ignored), an ideal clamp, a straight front still rising when the arrester operates (S·t_c below
            the crest) and 2Sd/v ≤ V_res (the reflection is back before the arrester operates). The leads connecting the arrester add their own length the same way; they are not modelled.
          </p>
        </details>
      </div>
    </div>
  )
}
