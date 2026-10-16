import { useEffect, useMemo, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Callout, Readouts, Slider, Toggle, useTutorContext } from '../../ui/kit.tsx'
import { EstimationNetwork, SCADA_BLOCKS, ScadaDiagram } from './diagrams.tsx'
import { CHI2_CONF, DEG, estimate, LAB0, labMeasurements, LNR_THRESHOLD, MEAS_IDS, measDefs, NET, toScreen, trueState, trueValues, unitOf, type LabState, type MeasId, type SeOutcome } from './se.ts'
import { ECON_HREF, LFC_HREF, MODULE } from './shared.tsx'

/*
 * Explore · grid monitoring: the SCADA schematic (an illustration) and the state-estimation lab — a three-bus DC
 * network with redundant meters, seeded noise and an optional gross error, estimated by weighted least squares with
 * the chi-square and largest-normalised-residual tests. Every verdict below is computed from the estimate.
 */

const defs = measDefs()
const nameOf = (id: MeasId) => defs[id].name

/** What the tests say about the current lab, in words — every case decided from the computed outcome. */
export function verdict(out: SeOutcome, lab: LabState): { tone: 'good' | 'warn' | 'bad' | 'info'; title: string; text: string; caught: boolean } {
  if (!out.ok) return { tone: 'bad', title: 'No estimate', text: out.message, caught: false }
  const bad = lab.bad && lab.enabled[lab.bad.id] ? lab.bad : null
  const badM = bad ? out.meas.find((m) => m.id === bad.id) : undefined
  const unit = bad ? unitOf(bad.id) : ''
  if (out.dof === 0)
    return {
      tone: bad ? 'warn' : 'info',
      title: 'No redundancy',
      text: `${out.meas.length} measurements for 2 unknowns: the estimate fits every measurement exactly, every residual is zero (J = ${fx(out.J, 6)}), so no error can be detected${bad ? ` — the ${fx(Math.abs(bad.size), 2)} ${unit} error on ${nameOf(bad.id)} goes straight into the estimate` : ''}. Add a measurement.`,
      caught: false,
    }
  if (badM?.critical)
    return {
      tone: 'warn',
      title: `${nameOf(bad!.id)} is a critical measurement`,
      text: `Without it the network would be unobservable, so the estimate must fit it exactly: its residual is always zero (Ω_ii = 0) and its ${fx(Math.abs(bad!.size), 2)} ${unit} error cannot be detected. More redundancy is needed around it.`,
      caught: false,
    }
  const jText = `J(x̂) = ${fx(out.J, 2)} ${out.detected ? '>' : '≤'} χ² limit ${fx(out.chi2, 2)} (${fx(CHI2_CONF * 100, 0)} %, ${out.dof} degrees of freedom)`
  if (out.flagged) {
    const tied = out.ties.length > 1
    if (tied)
      return {
        tone: 'warn',
        title: 'Bad data detected — but it cannot be located',
        text: `${jText}. ${out.ties.map(nameOf).join(', ')} all have the same normalised residual ${fx(out.largest!.rN, 2)}: their residual sensitivities are parallel (a critical ${out.ties.length === 2 ? 'pair' : 'set'}), so an error in any of them looks identical. ${out.dof === 1 ? 'With m − n = 1 this always happens.' : ''} Add a measurement.`,
        caught: false,
      }
    if (bad && out.flagged === bad.id)
      return {
        tone: 'good',
        title: `Caught: ${nameOf(bad.id)} flagged`,
        text: `${jText}. Its normalised residual ${fx(out.largest!.rN, 2)} is the largest and exceeds ${LNR_THRESHOLD}: this is the meter with the ${fx(Math.abs(bad.size), 2)} ${unit} error. Remove it and estimate again.`,
        caught: true,
      }
    if (bad)
      return {
        tone: 'warn',
        title: `${nameOf(out.flagged)} flagged — but the error is on ${nameOf(bad.id)}`,
        text: `${jText}. The largest normalised residual (${fx(out.largest!.rN, 2)}) is on the wrong meter: with this much noise compared with the ${fx(Math.abs(bad.size), 2)} ${unit} error, the test is misled (its r_N is ${fx(badM?.rN ?? 0, 2)}).`,
        caught: false,
      }
    return {
      tone: 'warn',
      title: `${nameOf(out.flagged)} flagged — a false alarm`,
      text: `${jText}. No gross error was added: ordinary noise exceeds ${LNR_THRESHOLD} standard deviations now and then. Draw another noise sample.`,
      caught: false,
    }
  }
  if (bad)
    return {
      tone: 'warn',
      title: 'The error is not flagged',
      text: `${jText}. The largest normalised residual is ${fx(out.largest?.rN ?? 0, 2)} (≤ ${LNR_THRESHOLD}): an error of ${fx(Math.abs(bad.size), 2)} ${unit} on ${nameOf(bad.id)} is too small, against the meter noise, to stand out (its r_N is ${fx(badM?.rN ?? 0, 2)}). Make it larger.`,
      caught: false,
    }
  return {
    tone: 'good',
    title: 'No bad data',
    text: `${jText}; the largest normalised residual is ${fx(out.largest?.rN ?? 0, 2)} (≤ ${LNR_THRESHOLD}). The measurements are consistent.`,
    caught: false,
  }
}

export function ScadaLab({ lab, setLab }: { lab: LabState; setLab(l: LabState): void }) {
  const level = useLevel()
  const [block, setBlock] = useState<string | null>(null)
  const ms = useMemo(() => labMeasurements(lab), [lab])
  const out = useMemo(() => estimate(ms), [ms])
  const v = verdict(out, lab)
  useEffect(() => {
    if (v.caught) completeActivity(MODULE, 'bad-data')
  }, [v.caught])
  const xt = trueState()
  const tv = trueValues()
  const b = SCADA_BLOCKS.find((q) => q.id === block)
  const set = (patch: Partial<LabState>) => setLab({ ...lab, ...patch })
  useTutorContext(
    () =>
      `Explore — SCADA and state estimation. Measurements used: ${MEAS_IDS.filter((i) => lab.enabled[i]).join(', ')}; noise ${lab.noise ? 'on' : 'off'}; gross error ${lab.bad ? `${lab.bad.size} ${unitOf(lab.bad.id)} on ${lab.bad.id}` : 'none'}. ${out.ok ? `θ̂2 ${fx(out.x[0] / DEG, 3)}°, θ̂3 ${fx(out.x[1] / DEG, 3)}°, J ${fx(out.J, 2)}, χ² limit ${fx(out.chi2, 2)}, largest rN ${out.largest ? `${out.largest.id} ${fx(out.largest.rN, 2)}` : '—'}.` : out.message} Verdict: ${v.title}.`,
  )
  const mc = useMemo(() => (level === 'engineer' ? reliability(lab) : null), [lab, level])
  return (
    <div className="ps-stack">
      <section className="ps-card" aria-labelledby="gen-scada">
        <h3 id="gen-scada">How the control centre sees the grid</h3>
        <div className="gen-scada-row">
          <ScadaDiagram selected={block} onSelect={setBlock} />
          <div className="gen-scada-info" aria-live="polite">
            {b ? (
              <>
                <p className="eyebrow">Selected</p>
                <h4>{b.name}</h4>
                <p className="small">{b.what}</p>
                {b.id === 'ems' && (
                  <p className="small">
                    Load–frequency control is in{' '}
                    <a className="ps-link" href={LFC_HREF}>
                      Module 12
                    </a>
                    , economic dispatch in{' '}
                    <a className="ps-link" href={ECON_HREF}>
                      Module 11
                    </a>
                    ; state estimation is the lab below.
                  </p>
                )}
              </>
            ) : (
              <p className="small muted">
                Select a block in the diagram to see what it does. SCADA measures (MW, Mvar, voltage, current, frequency, breaker positions) and controls (open/close breakers, raise/lower taps,
                generator set-points through AGC).
              </p>
            )}
          </div>
        </div>
      </section>
      <section className="ps-card" aria-labelledby="gen-se">
        <h3 id="gen-se">State-estimation lab</h3>
        <p className="small">
          The measurements reach the control centre with small errors — and sometimes a big one. The state estimator finds the bus angles that fit all of them best (weighted least squares) and then
          checks whether any measurement disagrees with the rest. Model: three buses, DC approximation (|V| = 1 pu, lossless lines x₁₂ = {NET.x12}, x₁₃ = {NET.x13}, x₂₃ = {NET.x23} pu on 100 MVA), bus
          1 the angle reference; meter accuracies are illustrative.
        </p>
        <div className="ps-split ps-split--wide-side">
          <div className="ps-stack">
            <EstimationNetwork out={out} enabled={lab.enabled} bad={lab.bad?.id ?? null} />
            <MeasTable lab={lab} setLab={setLab} out={out} tv={tv} />
          </div>
          <div className="ps-stack">
            <div className="ps-card gen-se-ctl">
              <div className="gen-ctl-row">
                <Toggle label="Meter noise" checked={lab.noise} onChange={(noise) => set({ noise })} />
                <button type="button" className="text-btn" disabled={!lab.noise} onClick={() => set({ seed: lab.seed + 1 })}>
                  New noise sample
                </button>
                <button type="button" className="text-btn" disabled={lab === LAB0} onClick={() => setLab(LAB0)}>
                  Reset
                </button>
              </div>
              <label className="gen-select">
                <span className="ps-slider-label">
                  <span>Gross error (a faulty meter)</span>
                </span>
                <select
                  value={lab.bad?.id ?? 'none'}
                  onChange={(e) => {
                    const id = e.target.value
                    set({ bad: id === 'none' ? null : { id: id as MeasId, size: id === 'TH3' ? 0.5 : 30 } })
                  }}
                >
                  <option value="none">None</option>
                  {MEAS_IDS.map((id) => (
                    <option key={id} value={id}>
                      {nameOf(id)}
                    </option>
                  ))}
                </select>
              </label>
              {lab.bad && (
                <Slider
                  label="Size of the error"
                  value={lab.bad.size}
                  min={lab.bad.id === 'TH3' ? -2 : -60}
                  max={lab.bad.id === 'TH3' ? 2 : 60}
                  step={lab.bad.id === 'TH3' ? 0.01 : 1}
                  unit={unitOf(lab.bad.id)}
                  decimals={lab.bad.id === 'TH3' ? 2 : 0}
                  onChange={(size) => set({ bad: { id: lab.bad!.id, size } })}
                  hint={!lab.enabled[lab.bad.id] ? 'this meter is not in use — tick it in the table' : 'added to the reading (on top of the normal noise)'}
                />
              )}
              <details className="ps-more" open={level === 'engineer'}>
                <summary>Meter accuracy (the weights W = 1/σ²)</summary>
                <Slider label="Flow meters σ" value={lab.sigma.flowMw} min={0.2} max={5} step={0.1} unit="MW" decimals={1} onChange={(flowMw) => set({ sigma: { ...lab.sigma, flowMw } })} />
                <Slider label="Injection meters σ" value={lab.sigma.injMw} min={0.5} max={10} step={0.5} unit="MW" decimals={1} onChange={(injMw) => set({ sigma: { ...lab.sigma, injMw } })} />
                <Slider label="PMU angle σ" value={lab.sigma.angleDeg} min={0.01} max={0.5} step={0.01} unit="°" decimals={2} onChange={(angleDeg) => set({ sigma: { ...lab.sigma, angleDeg } })} />
                <p className="ps-hint">A more accurate meter gets a larger weight: the estimate leans towards it.</p>
              </details>
            </div>
            <Callout tone={v.tone} title={v.title}>
              <p className="small">{v.text}</p>
              {out.ok && out.flagged && lab.enabled[out.flagged] && out.ties.length <= 1 && (
                <button type="button" className="btn btn--primary ps-btn-sm" onClick={() => set({ enabled: { ...lab.enabled, [out.flagged as MeasId]: false } })}>
                  Remove {nameOf(out.flagged)} and estimate again
                </button>
              )}
            </Callout>
            {out.ok && (
              <section className="ps-card" aria-labelledby="gen-se-res">
                <h3 id="gen-se-res">The estimate</h3>
                <Readouts
                  items={[
                    { label: 'θ̂₂', value: fx(out.x[0] / DEG, 3), unit: '°', note: `true ${fx(xt[0] / DEG, 3)}° · σ ${fx(Math.sqrt(out.cov[0][0]) / DEG, 3)}°` },
                    { label: 'θ̂₃', value: fx(out.x[1] / DEG, 3), unit: '°', note: `true ${fx(xt[1] / DEG, 3)}° · σ ${fx(Math.sqrt(out.cov[1][1]) / DEG, 3)}°` },
                    {
                      label: 'J(x̂)',
                      value: fx(out.J, 2),
                      tone: out.dof > 0 ? (out.detected ? 'bad' : 'good') : undefined,
                      note: out.dof > 0 ? `χ² limit ${fx(out.chi2, 2)} (${out.dof} d.o.f.)` : 'no redundancy',
                    },
                    { label: 'Redundancy', value: `${out.meas.length} − 2 = ${out.dof}`, note: 'measurements − unknowns' },
                  ]}
                />
                <p className="small muted">
                  Error of the estimate (known here because the true state is known): θ₂ {fx((out.x[0] - xt[0]) / DEG, 4)}°, θ₃ {fx((out.x[1] - xt[1]) / DEG, 4)}°. σ comes from the covariance (HᵀWH)⁻¹
                  — the spread expected over many noise samples.
                </p>
              </section>
            )}
            {mc && (
              <section className="ps-card" aria-labelledby="gen-mc">
                <h3 id="gen-mc">How reliable is the test?{mc.n > 0 ? ` (${mc.n} noise samples)` : ''}</h3>
                <p className="small">{mc.text}</p>
              </section>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

/** Re-run the estimator over many noise samples: how often is the injected error flagged correctly, and how often is there a false alarm? */
export function reliability(lab: LabState): { n: number; text: string } {
  const n = 200
  const base = estimate(labMeasurements({ ...lab, bad: null }))
  if (!base.ok) return { n: 0, text: 'Nothing can be tested: with these meters the network is unobservable, so there is no estimate.' }
  if (base.dof === 0) return { n: 0, text: 'Nothing can be tested: with no redundancy (m = n) every residual is zero, so no error can be detected — and no false alarm can occur either.' }
  let hit = 0
  let falseAlarm = 0
  for (let k = 0; k < n; k++) {
    const seed = 1000 + k
    const clean = estimate(labMeasurements({ ...lab, noise: true, seed, bad: null }))
    if (clean.ok && clean.flagged) falseAlarm++
    if (lab.bad && lab.enabled[lab.bad.id]) {
      const o = estimate(labMeasurements({ ...lab, noise: true, seed }))
      if (o.ok && o.flagged === lab.bad.id && o.ties.length <= 1) hit++
    }
  }
  const bad = lab.bad && lab.enabled[lab.bad.id] ? lab.bad : null
  const critical = bad ? base.meas.find((m) => m.id === bad.id)?.critical : false
  const paired = bad ? base.pairs.find((p) => p.includes(bad.id)) : undefined
  const badText = !bad
    ? 'Choose a gross error to see how often it is caught.'
    : critical
      ? `${nameOf(bad.id)} is critical in this set: its error can never be flagged (0 of ${n} samples, as it must be).`
      : `A ${fx(Math.abs(bad.size), 2)} ${unitOf(bad.id)} error on ${nameOf(bad.id)} was flagged correctly (and alone) in ${hit} of ${n} samples${paired ? ` — it forms a critical pair with ${nameOf(paired[0] === bad.id ? paired[1] : paired[0])}, so it can never be singled out` : ''}.`
  return {
    n,
    text: `${badText} With no gross error, a false alarm (largest r_N above ${LNR_THRESHOLD}) occurred in ${falseAlarm} of ${n} samples. Computed by re-running this estimator with ${n} different noise samples.`,
  }
}

function MeasTable({ lab, setLab, out, tv }: { lab: LabState; setLab(l: LabState): void; out: SeOutcome; tv: Record<MeasId, number> }) {
  const ms = labMeasurements(lab)
  return (
    <div className="table-wrap">
      <table className="ps-table gen-meas">
        <caption className="sr-only">Measurements, estimates and residuals</caption>
        <thead>
          <tr>
            <th scope="col">Use</th>
            <th scope="col">Measurement</th>
            <th scope="col">True</th>
            <th scope="col">Measured z</th>
            <th scope="col">Estimate</th>
            <th scope="col">Residual r</th>
            <th scope="col">r_N</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {MEAS_IDS.map((id) => {
            const on = lab.enabled[id]
            const z = ms.find((m) => m.id === id)
            const m = out.ok ? out.meas.find((q) => q.id === id) : undefined
            const u = id === 'TH3' ? ' °' : ''
            const d = id === 'TH3' ? 3 : 2
            const flagged = out.ok && out.flagged === id
            const status = !on ? 'not used' : !out.ok ? '—' : m?.critical ? 'critical' : flagged ? (out.ties.length > 1 ? 'suspect (tied)' : 'flagged') : 'ok'
            return (
              <tr key={id} className={`${flagged ? 'is-flag' : ''} ${!on ? 'is-off' : ''}`}>
                <td>
                  <input type="checkbox" checked={on} aria-label={`Use ${nameOf(id)}`} onChange={(e) => setLab({ ...lab, enabled: { ...lab.enabled, [id]: e.target.checked } })} />
                </td>
                <th scope="row">
                  {nameOf(id)}
                  {lab.bad?.id === id && <span className="gen-badtag"> faulty</span>}
                </th>
                <td>
                  {fx(toScreen(id, tv[id]), d)}
                  {u}
                </td>
                <td>{z ? `${fx(toScreen(id, z.z), d)}${u}` : '—'}</td>
                <td>{m ? `${fx(toScreen(id, m.est), d)}${u}` : '—'}</td>
                <td>{m ? `${fx(toScreen(id, m.r), d)}${u}` : '—'}</td>
                <td>{m ? (m.rN === null ? '—' : fx(m.rN, 2)) : '—'}</td>
                <td className={`gen-status gen-status--${status.split(' ')[0]}`}>{status}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="small muted">
        Values in MW (the PMU angle in degrees). Residual r = z − h(x̂). r_N = |r|/√Ω_ii, where Ω = R − H(HᵀWH)⁻¹Hᵀ is the residual covariance: each residual measured against its own expected spread. A
        flag needs r_N &gt; {LNR_THRESHOLD}. Critical: Ω_ii = 0 — the measurement cannot be checked.
      </p>
    </div>
  )
}
