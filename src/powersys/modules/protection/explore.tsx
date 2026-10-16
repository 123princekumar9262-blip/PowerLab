import { useEffect, useMemo, useRef, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { abs, arg, scale, ZERO } from '../../engine/complex.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { Callout, Readouts, Seg, Slider, Toggle, useTutorContext, type ReadoutItem } from '../../ui/kit.tsx'
import {
  apparentOhm,
  CT_RATIO,
  directional,
  distanceCase,
  I_MIN_A,
  IB_KA,
  inMho,
  K0,
  KV,
  L1_KM,
  loadCheck,
  LOAD_MVA,
  LOOP_LABEL,
  LOOPS,
  OC_PICKUP_A,
  preloadImpedance,
  reachOhm,
  ROUTE_KM,
  secondaryOhm,
  whereText,
  Z1L,
  ZONES0,
  type DistanceCase,
  type Zone,
  type ZoneSettings,
} from './distance.ts'
import { CAM_HOME, CAM_SUB_A, camAtKm, RouteScene } from './Scene.tsx'
import { DifferentialSection, BreakerSection, EarthingSection, GeneratorSection } from './sections.tsx'
import { MODULE, outcomeText, PartInfo, RouteSld, RxPlot, TimeDistance, TYPE_OPTIONS, typeName, useDistance, useSweep, type RxPoint } from './shared.tsx'
import { describeChange } from './describe.ts'
import { DIR0, DIST0, SECTIONS, type DirState, type DistState, type ModState, type Section } from './state.ts'
import { afterS, amps, compareWord, zoneName, zPolar, zRect } from './words.ts'

export function Explore({ st, set, section, setSection }: { st: ModState; set(s: ModState): void; section: Section; setSection(s: Section): void }) {
  const progress = usePsProgress()
  const [seen, setSeen] = useState<Section[]>([section])
  useEffect(() => {
    setSeen((v) => {
      if (v.includes(section)) return v
      const next = [...v, section]
      if (next.length >= SECTIONS.length) completeActivity(MODULE, 'sections')
      return next
    })
  }, [section])
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <Seg label="Protection section" value={section} onChange={setSection} options={SECTIONS} />
        <span className="small muted">{isDone(progress, MODULE, 'sections') ? '✓ every section opened' : `${seen.length} of ${SECTIONS.length} sections opened`}</span>
      </div>
      {section === 'distance' && <DistanceSection st={st.dist} set={(dist) => set({ ...st, dist })} />}
      {section === 'directional' && <DirectionalSection st={st.dir} set={(dir) => set({ ...st, dir })} />}
      {section === 'differential' && <DifferentialSection st={st.diff} set={(diff) => set({ ...st, diff })} />}
      {section === 'earthing' && <EarthingSection p={st.earth} set={(earth) => set({ ...st, earth })} />}
      {section === 'generator' && <GeneratorSection st={st.stator} set={(stator) => set({ ...st, stator })} />}
      {section === 'breaker' && <BreakerSection st={st.trv} set={(trv) => set({ ...st, trv })} />}
    </div>
  )
}

// ── Distance ───────────────────────────────────────────────────────────────────────────────────────────────────

function useCompleteZones(c: DistanceCase | null) {
  const seen = useRef(new Set<Zone>())
  useEffect(() => {
    if (!c) return
    const z = c.decisions.RA.zone
    if (z) seen.current.add(z)
    if (seen.current.has(1) && seen.current.has(2) && seen.current.has(3)) completeActivity(MODULE, 'zones')
  }, [c])
  return seen.current
}

export function DistanceSection({ st, set }: { st: DistState; set(s: DistState): void }) {
  const level = useLevel()
  const { issues, c } = useDistance(st)
  const sw = useSweep(st)
  const [selected, setSelected] = useState<string | null>(null)
  const [change, setChange] = useState<{ what: string; why: string } | null>(null)
  const zonesSeen = useCompleteZones(c)
  const progress = usePsProgress()
  const update = (next: DistState) => {
    const nc = zoneIssuesOk(next) ? distanceCase(next.spec, next.opts, next.zones) : null
    setChange(describeChange(st, next, c, nc))
    set(next)
  }
  const spec = st.spec
  const o = st.opts
  const z = st.zones
  const setSpec = (p: Partial<typeof spec>) => update({ ...st, spec: { ...spec, ...p } })
  const setOpts = (p: Partial<typeof o>) => update({ ...st, opts: { ...o, ...p } })
  const setZones = (p: Partial<typeof z>) => update({ ...st, zones: { ...z, ...p } })
  const ra = c?.decisions.RA
  const bolted = scale(Z1L, spec.km / L1_KM)
  const points: RxPoint[] = []
  if (ra?.z) points.push({ z: ra.z, label: `Z_app ${zPolar(ra.z, 1)}`, kind: 'app' })
  if (spec.rfOhm > 0 || o.infeed) points.push({ z: bolted, label: 'line to the fault', kind: 'bolted' })
  const pre = useMemo(() => preloadImpedance(o), [o])
  if (pre) points.push({ z: pre, label: 'pre-fault load', kind: 'load' })
  const lc = loadCheck(z)
  const fallback = c ? <RouteSld c={c} selected={selected} onSelect={(id) => setSelected(selected === id ? null : id)} label={`Single-line diagram: ${outcomeText(c)}`} /> : null
  useTutorContext(
    () =>
      `Explore — distance protection. Fault ${whereText(spec.km)}, ${typeName(spec.type)}, R_f ${spec.rfOhm} Ω; remote infeed ${o.infeed ? `${o.sscMva} MVA, pre-fault angle ${o.deltaDeg}°` : 'off'}; zones ${z.reachPct.join('/')} % at ${z.timeS.join('/')} s, k0 ${z.k0On ? 'on' : 'off'}. ${c ? outcomeText(c) : `Invalid settings: ${issues.join(' ')}`}`,
  )
  const tour: TourStep[] | undefined = c
    ? [
        {
          title: 'The protected line',
          focus: ['l1'],
          camera: CAM_HOME.position,
          text: (
            <p>
              Line L1 runs {L1_KM} km from A to B. Its positive-sequence impedance is Z₁L = {zRect(Z1L)} ({zPolar(Z1L)}) — {fx(abs(Z1L) / L1_KM, 4)} Ω per km. Beyond B, the next line L3 continues to
              C.
            </p>
          ),
        },
        {
          title: 'Current and voltage transformers',
          focus: ['ct'],
          camera: CAM_SUB_A,
          text: (
            <p>
              The relay never touches 220 kV. The CT (800 : 1) gives it phase a’s current — now {amps(abs(c.fault.relays.RA.iabc[0]) * IB_KA * 1000)} primary,{' '}
              {fx((abs(c.fault.relays.RA.iabc[0]) * IB_KA * 1000) / CT_RATIO, 3)} A secondary; the VT gives it the voltage — now {fx((abs(c.fault.relays.RA.vabc[0]) * KV) / Math.sqrt(3), 2)} kV to
              earth.
            </p>
          ),
        },
        {
          title: 'The relay divides V by I',
          focus: ['relay'],
          camera: CAM_SUB_A,
          text: (
            <p>
              {ra?.z
                ? `Loop ${LOOP_LABEL[ra.loop]}: Z_app = ${zPolar(ra.z)} — ${zoneName(ra.zone)} of its mho characteristic${ra.zone ? `, so it trips ${afterS(ra.tripS!)}` : ', so it does not trip'}.`
                : `Too little current to measure (below ${I_MIN_A} A).`}
            </p>
          ),
        },
        {
          title: 'The fault',
          focus: ['fault'],
          camera: camAtKm(spec.km),
          text: (
            <p>
              A {typeName(spec.type)} fault {whereText(spec.km)}
              {spec.rfOhm > 0 ? ` through ${fx(spec.rfOhm, 1)} Ω` : ''}. Fault current {fx(c.fault.faultKa, 3)} kA (Module 4’s model of this system).
            </p>
          ),
        },
        {
          title: 'The breakers trip',
          focus: ['cbA'],
          camera: CAM_HOME.position,
          text: <p>{outcomeText(c)}</p>,
        },
      ]
    : undefined
  const main: ReadoutItem[] =
    c && ra
      ? [
          {
            label: 'Z_app at A',
            value: ra.z ? fx(abs(ra.z), 2) : '—',
            unit: ra.z ? 'Ω' : undefined,
            note: ra.z ? `∠${fx((arg(ra.z) * 180) / Math.PI, 1)}° · ${zRect(ra.z, 2)}` : `below ${I_MIN_A} A: no measurement`,
          },
          {
            label: 'R_A decision',
            value: ra.z ? (ra.zone ? `Zone ${ra.zone}` : 'No zone') : '—',
            tone: ra.zone === 1 ? 'good' : ra.zone ? 'warn' : 'bad',
            note: ra.zone ? `trips ${afterS(ra.tripS!)}` : 'does not trip',
          },
          {
            label: 'Fault cleared',
            value: c.clearing.clearedS !== null ? fx(c.clearing.clearedS, 2) : 'no',
            unit: c.clearing.clearedS !== null ? 's' : undefined,
            tone: c.clearing.clearedS === null ? 'bad' : undefined,
            note: 'relay time + 60 ms breaker',
          },
        ]
      : []
  const more: ReadoutItem[] = c
    ? [
        { label: 'Fault current', value: fx(c.fault.faultKa, 3), unit: 'kA', note: `largest phase, ${typeName(spec.type)}` },
        {
          label: 'R_BA (B → A)',
          value: c.decisions.RBA.z ? (c.decisions.RBA.zone ? `Zone ${c.decisions.RBA.zone}` : 'No zone') : 'no current',
          note: c.decisions.RBA.z ? zPolar(c.decisions.RBA.z, 1) : `below ${I_MIN_A} A`,
        },
        {
          label: 'R_BC (B → C)',
          value: c.decisions.RBC.z ? (c.decisions.RBC.zone ? `Zone ${c.decisions.RBC.zone}` : 'No zone') : 'no current',
          note: c.decisions.RBC.z ? zPolar(c.decisions.RBC.z, 1) : `below ${I_MIN_A} A`,
        },
        { label: 'Secondary Z_app', value: ra?.z ? fx(abs(secondaryOhm(ra.z)), 3) : '—', unit: ra?.z ? 'Ω' : undefined, note: `× CT/VT = ${CT_RATIO}/2000` },
      ]
    : []
  return (
    <div className="ps-stack">
      {c ? (
        <RouteScene c={c} selected={selected} onSelect={setSelected} fallback={fallback} info={(id) => <PartInfo id={id} c={c} />} tour={tour} />
      ) : (
        <Callout tone="bad" title="These zone settings cannot be used — no decisions">
          <ul className="pr-issues">
            {issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <button type="button" className="text-btn" onClick={() => update({ ...st, zones: ZONES0 })}>
            Restore the typical settings
          </button>
        </Callout>
      )}
      {c && (
        <p className="pr-outcome" aria-live="polite">
          {outcomeText(c)}
        </p>
      )}
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <section className="ps-card" aria-labelledby="pr-fault-h">
            <div className="pr-card-head">
              <h3 id="pr-fault-h">The fault</h3>
              <button type="button" className="text-btn" onClick={() => (setChange(null), set(DIST0))} disabled={st === DIST0}>
                Reset
              </button>
            </div>
            <Slider label="Fault position from A" value={spec.km} min={0} max={ROUTE_KM} step={0.5} unit="km" decimals={1} onChange={(km) => setSpec({ km })} hint={whereText(spec.km)} />
            <div className="ps-cols-2">
              <div>
                <p className="ps-slider-label">
                  <span>Fault type</span>
                </p>
                <Seg label="Fault type" full value={spec.type} onChange={(type) => setSpec({ type })} options={TYPE_OPTIONS} />
              </div>
              <Slider
                label="Fault resistance R_f"
                value={spec.rfOhm}
                min={0}
                max={40}
                step={0.5}
                unit="Ω"
                decimals={1}
                onChange={(rfOhm) => setSpec({ rfOhm })}
                hint="arc and tower-footing resistance"
              />
            </div>
            <details className="ps-more" open={level === 'engineer'}>
              <summary>The system: a second source at B</summary>
              <Toggle label="Grid infeed at B" checked={o.infeed} onChange={(infeed) => setOpts({ infeed, deltaDeg: infeed ? o.deltaDeg : 0 })} />
              {o.infeed && (
                <div className="ps-cols-2">
                  <Slider label="Its fault level" value={o.sscMva} min={300} max={8000} step={100} unit="MVA" decimals={0} onChange={(sscMva) => setOpts({ sscMva })} hint="X/R 10 (typical)" />
                  <Slider
                    label="Pre-fault angle A ahead of B"
                    value={o.deltaDeg}
                    min={-20}
                    max={20}
                    step={1}
                    unit="°"
                    decimals={0}
                    onChange={(deltaDeg) => setOpts({ deltaDeg })}
                    hint={o.deltaDeg > 0 ? 'A exports to B before the fault' : o.deltaDeg < 0 ? 'A imports from B before the fault' : 'no power transfer (Module 4’s assumption)'}
                  />
                </div>
              )}
            </details>
            <details className="ps-more" open={level === 'engineer'}>
              <summary>Relay settings (all three relays use the same % of their own line)</summary>
              <div className="ps-cols-3">
                {([0, 1, 2] as const).map((k) => (
                  <Slider
                    key={k}
                    label={`Zone ${k + 1} reach`}
                    value={z.reachPct[k]}
                    min={k === 0 ? 0 : 50}
                    max={k === 2 ? 500 : 300}
                    step={5}
                    unit="%"
                    decimals={0}
                    onChange={(v) => setZones({ reachPct: z.reachPct.map((x, j) => (j === k ? v : x)) as [number, number, number] })}
                    hint={`${fx(abs(reachOhm(Z1L, z.reachPct[k])), 1)} Ω at the line angle`}
                  />
                ))}
              </div>
              <div className="ps-cols-3">
                <p className="small muted pr-z1-time">Zone 1: no intentional delay</p>
                {([1, 2] as const).map((k) => (
                  <Slider
                    key={k}
                    label={`Zone ${k + 1} time`}
                    value={z.timeS[k]}
                    min={0}
                    max={2}
                    step={0.05}
                    unit="s"
                    decimals={2}
                    onChange={(v) => setZones({ timeS: z.timeS.map((x, j) => (j === k ? v : x)) as [number, number, number] })}
                  />
                ))}
              </div>
              <Toggle label="Residual compensation k₀ in the earth loops" checked={z.k0On} onChange={(k0On) => setZones({ k0On })} />
              <p className="ps-hint">Typical settings (not from a standard): 80 % / 120 % / 200 % at 0 / 0.3 / 0.8 s. Relay characteristic angle = line angle {fx((arg(Z1L) * 180) / Math.PI, 1)}°.</p>
            </details>
          </section>
          {c && (
            <section className="ps-card" aria-labelledby="pr-rx-h">
              <h3 id="pr-rx-h">The R–X plane: what R_A sees</h3>
              <RxPlot
                zones={z}
                points={points}
                trajectory={sw ? sw.points.filter((p) => p.z).map((p) => p.z!) : []}
                load={level !== 'beginner' ? { zMin: lc.zMin, phiDeg: lc.phiDeg } : null}
                activeZone={ra?.zone}
                label="R–X plane of the relay at A: its three mho zones, the line impedance and the apparent impedance"
              />
              <p className="small muted">
                Mho circles through the origin, diameter = the zone’s reach along the line angle. Thin curve: Z_app as the same fault ({typeName(spec.type)}, R_f {fx(spec.rfOhm, 1)} Ω) sweeps the
                route (calculated, fault by fault).
                {level !== 'beginner' && ` Hatched: the heaviest load (${fx(lc.zMin, 1)} Ω at up to ${fx(lc.phiDeg, 1)}°).`}
              </p>
            </section>
          )}
          {c && sw && (
            <section className="ps-card" aria-labelledby="pr-td-h">
              <h3 id="pr-td-h">Time against distance: the stepped characteristic</h3>
              <TimeDistance
                sw={sw}
                zones={z}
                faultKm={spec.km}
                trips={{ RA: c.decisions.RA.tripS, RBC: c.decisions.RBC.tripS, RBA: c.decisions.RBA.tripS }}
                label="Operating time of each relay against the fault position"
              />
            </section>
          )}
        </div>
        <div className="ps-stack">
          {c && (
            <section className="ps-card" aria-labelledby="pr-res-h">
              <h3 id="pr-res-h">The relay at A</h3>
              <Readouts label="Main results" items={main} />
              {level === 'beginner' ? (
                <details className="ps-more">
                  <summary>All results</summary>
                  <Readouts label="More results" items={more} />
                </details>
              ) : (
                <Readouts label="More results" items={more} />
              )}
              {change && (
                <div className="pr-change" aria-live="polite">
                  <p className="small">
                    <b>You changed:</b> {change.what}.
                  </p>
                  <p className="small muted">Why: {change.why}</p>
                </div>
              )}
              <p className="small muted">
                {isDone(progress, MODULE, 'zones')
                  ? '✓ You have put a fault in all three zones.'
                  : `Zones you have reached: ${[1, 2, 3].filter((k) => zonesSeen.has(k as Zone)).join(', ') || 'none yet'} — find all three.`}
              </p>
            </section>
          )}
          {c && level !== 'beginner' && <Loops c={c} zones={z} />}
          {level !== 'beginner' && (
            <section className="ps-card" aria-labelledby="pr-load-h">
              <h3 id="pr-load-h">Load encroachment</h3>
              <p className="small">
                The heaviest load assumed — L1’s rating {fx(LOAD_MVA, 0)} MVA at 0.9 pu voltage, power factor 0.85 or better — looks like {fx(lc.zMin, 1)} Ω or more. Zone 3 reaches{' '}
                {fx(lc.reachAtLoad, 1)} Ω along the load’s {fx(lc.phiDeg, 1)}° direction:{' '}
                {lc.encroaches ? (
                  <b className="pr-bad">the load would sit inside zone 3 — it would trip on load alone.</b>
                ) : (
                  <>a margin of {fx(lc.margin, 1)} Ω, so load alone does not reach zone 3.</>
                )}
              </p>
              {pre && (
                <p className="small muted">
                  With {o.deltaDeg}° pre-fault angle, the load seen at A is {zPolar(pre)} (the square on the plot).
                </p>
              )}
              <p className="small muted">Illustrative load assumptions; real relays add load-blinding characteristics.</p>
            </section>
          )}
          <Callout title="Overcurrent grading lives in Module 4">
            <p className="small">
              Inverse-time overcurrent relays and their grading are taught in Module 4.{' '}
              <a className="ps-link" href="#/subjects/power-systems/faults?mode=explore">
                Open Module 4 →
              </a>
            </p>
          </Callout>
        </div>
      </div>
    </div>
  )
}

const zoneIssuesOk = (s: DistState) =>
  s.zones.reachPct.every((r) => r > 0 && r <= 500) &&
  s.zones.reachPct[1] > s.zones.reachPct[0] &&
  s.zones.reachPct[2] > s.zones.reachPct[1] &&
  s.zones.timeS.every((t) => t >= 0) &&
  s.zones.timeS[1] >= s.zones.timeS[0] &&
  s.zones.timeS[2] >= s.zones.timeS[1]

/** The six measuring loops of R_A (engineer view). */
function Loops({ c, zones }: { c: DistanceCase; zones: ZoneSettings }) {
  const v = c.fault.relays.RA
  const k0 = zones.k0On ? K0 : ZERO
  const unc = c.fault.spec.type === 'slg' || c.fault.spec.type === 'dlg' ? apparentOhm('aE', v, ZERO) : null
  return (
    <section className="ps-card" aria-labelledby="pr-loops-h">
      <h3 id="pr-loops-h">All six measuring loops of R_A</h3>
      <div className="table-wrap">
        <table className="ps-table">
          <caption className="sr-only">Apparent impedance of each loop</caption>
          <thead>
            <tr>
              <th scope="col">Loop</th>
              <th scope="col">
                Z <span className="pr-unit">[Ω]</span>
              </th>
              <th scope="col">Sees</th>
            </tr>
          </thead>
          <tbody>
            {LOOPS.map((l) => {
              const z = apparentOhm(l, v, k0)
              const zone = z ? ([1, 2, 3].find((k) => inMho(z, reachOhm(Z1L, zones.reachPct[k - 1]))) ?? 0) : null
              return (
                <tr key={l} className={l === c.decisions.RA.loop ? 'is-changed' : ''}>
                  <td>{LOOP_LABEL[l]}</td>
                  <td>{z ? zPolar(z, 1) : 'no current'}</td>
                  <td>{zone === null ? '—' : zone ? `zone ${zone}` : 'none'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Highlighted: the loop that matches this fault type (phase a is the faulted phase for L-G; b and c for L-L, as in Module 4). Earth loops use V_p/(I_p + k₀·3I₀)
        {zones.k0On ? '' : ' (k₀ switched off: k₀ = 0)'}; the line’s k₀ = {fx(abs(K0), 3)} ∠{fx((arg(K0) * 180) / Math.PI, 1)}°.
        {unc &&
          zones.k0On &&
          ` Without k₀ the a–E loop would read ${zPolar(unc, 1)} — ${compareWord(abs(unc), abs(c.decisions.RA.z ?? unc), 'further away', 'nearer')} than the compensated ${c.decisions.RA.z ? zPolar(c.decisions.RA.z, 1) : '—'}.`}
      </p>
    </section>
  )
}

// ── Directional ────────────────────────────────────────────────────────────────────────────────────────────────

export function DirectionalSection({ st, set }: { st: DirState; set(s: DirState): void }) {
  const level = useLevel()
  const c = useMemo(() => distanceCase({ km: st.km, type: st.type, rfOhm: 0 }, { infeed: true, sscMva: st.sscMva, deltaDeg: 0 }, ZONES0), [st])
  const d = directional(c.fault.relays.RBA, st.type, st.rcaDeg)
  const iA = abs(d.iOp) * IB_KA * 1000
  const onL1 = st.km <= L1_KM
  useTutorContext(
    () =>
      `Explore — directional relay at B on line L1 (quadrature connection, RCA ${st.rcaDeg}°). Fault ${whereText(st.km)}, ${typeName(st.type)}. I_op ahead of V_pol by ${fx(d.angleDeg, 1)}°, torque ${d.torque > 0 ? 'positive' : 'negative'}: ${d.forward === null ? 'undecided' : d.forward ? 'forward' : 'reverse'}. Current ${fx(iA, 0)} A.`,
  )
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-dir-h">
          <div className="pr-card-head">
            <h3 id="pr-dir-h">Which side is the fault on?</h3>
            <button type="button" className="text-btn" onClick={() => set(DIR0)} disabled={st === DIR0}>
              Reset
            </button>
          </div>
          <p className="small">
            The relay at B on line L1 looks back towards A. With a source at both ends (the grid at B is switched on here), current flows through it for faults on <b>either</b> side — an overcurrent
            relay alone cannot tell them apart. The directional element compares the current’s phase with a voltage.
          </p>
          <Slider label="Fault position from A" value={st.km} min={0} max={ROUTE_KM} step={0.5} unit="km" decimals={1} onChange={(km) => set({ ...st, km })} hint={whereText(st.km)} />
          <div className="ps-cols-2">
            <div>
              <p className="ps-slider-label">
                <span>Fault type</span>
              </p>
              <Seg label="Fault type" full value={st.type} onChange={(type) => set({ ...st, type })} options={TYPE_OPTIONS} />
            </div>
            <div>
              <p className="ps-slider-label">
                <span>Relay characteristic angle</span>
              </p>
              <Seg
                label="Relay characteristic angle"
                full
                value={String(st.rcaDeg)}
                onChange={(v) => set({ ...st, rcaDeg: Number(v) })}
                options={[
                  { id: '30', label: '30°' },
                  { id: '45', label: '45°' },
                ]}
              />
            </div>
          </div>
          {level !== 'beginner' && <Slider label="Grid fault level at B" value={st.sscMva} min={300} max={8000} step={100} unit="MVA" decimals={0} onChange={(sscMva) => set({ ...st, sscMva })} />}
        </section>
        <section className="ps-card pr-flush">
          <RouteSld c={c} selected="RBA" label={`Single-line diagram with the fault ${whereText(st.km)} and the relay at B on L1`} />
        </section>
      </div>
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="pr-dirres-h">
          <h3 id="pr-dirres-h">The directional element</h3>
          <DirDiagram angleDeg={d.angleDeg} rcaDeg={st.rcaDeg} decided={d.forward !== null} element={d.element} />
          <Readouts
            items={[
              {
                label: 'Decision',
                value: d.forward === null ? 'Undecided' : d.forward ? 'Forward' : 'Reverse',
                tone: d.forward === null ? 'warn' : d.forward ? 'good' : undefined,
                note: d.forward === null ? (d.why === 'no-current' ? `current below ${I_MIN_A} A` : 'polarising voltage collapsed') : d.forward ? 'towards A: may trip' : 'behind the relay: blocked',
              },
              { label: `I_${d.element} ahead of V_pol`, value: fx(d.angleDeg, 1), unit: '°', note: `operate within ${fx(st.rcaDeg - 90, 0)}° … ${fx(st.rcaDeg + 90, 0)}°` },
              { label: 'Current', value: amps(iA), note: iA > OC_PICKUP_A ? `a plain ${OC_PICKUP_A} A overcurrent relay would pick up` : `below a ${OC_PICKUP_A} A overcurrent setting` },
            ]}
          />
          <p className="small">
            {d.forward === null
              ? 'With too little current or voltage the element cannot decide (real relays then use a memory of the pre-fault voltage).'
              : `The fault is ${onL1 ? 'on L1, in front of the relay' : 'on L3, behind the relay'}; the element ${d.forward === onL1 ? 'agrees' : 'disagrees'}: torque ${d.torque > 0 ? 'positive' : 'negative'} (${fx(d.torque, 3)} pu).`}
            {d.forward === false && iA > OC_PICKUP_A ? ` Without the directional element this ${amps(iA)} would have tripped L1 for a fault on L3.` : ''}
          </p>
          <details className="ps-more" open={level === 'engineer'}>
            <summary>The convention used here</summary>
            <p className="small">
              Quadrature (90°) connection: the phase-a element uses I_a with V_bc, the phase-b element I_b with V_ca (used for faults between b and c). V_bc lags V_a by 90° in a healthy system and
              stays healthy during an earth fault on phase a. Torque T = Re[I·V_pol*·e^(−jα)] ∝ |I||V|cos(θ − α), θ = how far I leads V_pol, α = the relay characteristic angle (maximum torque when θ =
              α). Forward ⇔ T &gt; 0. Typical α: 30° or 45° (not from a standard).
            </p>
          </details>
        </section>
      </div>
    </div>
  )
}

/** The current phasor against the polarising voltage (drawn as the 0° reference), the maximum-torque line and the operate half-plane. */
export function DirDiagram({ angleDeg, rcaDeg, decided, element }: { angleDeg: number; rcaDeg: number; decided: boolean; element: 'a' | 'b' }) {
  const S = 240
  const c = S / 2
  const R = 92
  const P = (deg: number, r = R) => ({ x: c + r * Math.cos((deg * Math.PI) / 180), y: c - r * Math.sin((deg * Math.PI) / 180) })
  const half = (from: number) => {
    const pts: string[] = [`${c},${c}`]
    for (let k = 0; k <= 36; k++) {
      const p = P(from + (180 * k) / 36, R + 14)
      pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    }
    return pts.join(' ')
  }
  const tip = P(angleDeg, R - 6)
  const mta = P(rcaDeg, R + 16)
  const vp = P(0, R - 6)
  return (
    <figure className="pr-dir">
      <svg
        viewBox={`0 0 ${S} ${S}`}
        role="img"
        aria-label={`Operating current ${fx(angleDeg, 1)} degrees ahead of the polarising voltage; maximum torque at ${rcaDeg} degrees; the operate region is within 90 degrees of it.`}
      >
        <polygon points={half(rcaDeg - 90)} className="pr-dir-fwd" />
        <polygon points={half(rcaDeg + 90)} className="pr-dir-rev" />
        <circle cx={c} cy={c} r={R} className="ps-ph-circle" />
        <line x1={c} y1={c} x2={mta.x} y2={mta.y} className="pr-dir-mta" />
        <text x={mta.x} y={mta.y - 4} className="pr-dir-text" textAnchor="middle">
          MTA {rcaDeg}°
        </text>
        <line x1={c} y1={c} x2={vp.x} y2={vp.y} className="pr-dir-v" markerEnd="url(#pr-dir-arr-v)" />
        <text x={vp.x - 2} y={vp.y + 16} className="pr-dir-text" textAnchor="end">
          V_pol ({element === 'a' ? 'V_bc' : 'V_ca'})
        </text>
        {decided && (
          <>
            <line x1={c} y1={c} x2={tip.x} y2={tip.y} className="pr-dir-i" markerEnd="url(#pr-dir-arr-i)" />
            <text x={P(angleDeg, R + 6).x} y={P(angleDeg, R + 6).y + 4} className="pr-dir-text pr-dir-text--i" textAnchor={Math.cos((angleDeg * Math.PI) / 180) < -0.2 ? 'end' : 'start'}>
              I_{element}
            </text>
          </>
        )}
        <text x={P(rcaDeg - 10, R * 0.55).x} y={P(rcaDeg - 10, R * 0.55).y} className="pr-dir-zone" textAnchor="middle">
          forward
        </text>
        <text x={P(rcaDeg + 180, R * 0.55).x} y={P(rcaDeg + 180, R * 0.55).y} className="pr-dir-zone" textAnchor="middle">
          reverse
        </text>
        <defs>
          <marker id="pr-dir-arr-v" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 10 5 0 10z" className="pr-dir-head-v" />
          </marker>
          <marker id="pr-dir-arr-i" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 10 5 0 10z" className="pr-dir-head-i" />
          </marker>
        </defs>
      </svg>
      <figcaption className="small muted">Calculated angles; lengths not to scale. V_pol drawn as the 0° reference.</figcaption>
    </figure>
  )
}
