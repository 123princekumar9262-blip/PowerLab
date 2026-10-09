import { compareEv, EV_DEFAULTS, EV_EXPERIMENTS, EV_LESSONS, evEventLabel, evEventWhy, evPredictions, evStateAt, evView, evWhy, measureEv, simulateEv, type EvState } from '../converters/ev/content.ts'
import { accelTheory } from '../converters/ev/theory.ts'
import { CYCLE_NAME, EV_LIMITS as L, type EvMeasurements, type EvParams, type EvRun } from '../converters/ev/vehicle.ts'
import type { ChannelMeta, Topic } from '../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../utils/format.ts'

const CH: Record<string, ChannelMeta> = {
  vkmh: { id: 'vkmh', label: 'v', name: 'Vehicle speed [km/h]', unit: '', color: '#199e70', group: 'Speed' },
  vref: { id: 'vref', label: 'cycle', name: 'Drive-cycle speed [km/h]', unit: '', color: '#aeb7c5', dash: [6, 4], group: 'Speed' },
  f: { id: 'f', label: 'F', name: 'Motor force at the wheels [N]', unit: '', color: '#d95926', group: 'Force' },
  fbrake: { id: 'fbrake', label: 'Fbrake', name: 'Friction-brake force [N]', unit: '', color: '#aeb7c5', dash: [2, 3], group: 'Force' },
  pbatt: { id: 'pbatt', label: 'Pbatt', name: 'Battery power (negative = charging)', unit: 'W', color: '#3987e5', group: 'Power' },
  pwheel: { id: 'pwheel', label: 'Pwheel', name: 'Motor power at the wheels', unit: 'W', color: '#9085e9', dash: [6, 4], group: 'Power' },
  pbrake: { id: 'pbrake', label: 'Pbrake', name: 'Power burnt in the friction brakes', unit: 'W', color: '#aeb7c5', dash: [2, 3], group: 'Power' },
  ibatt: { id: 'ibatt', label: 'Ibatt', name: 'Battery current', unit: 'A', color: '#e66767', group: 'Current' },
  soc: { id: 'soc', label: 'SOC', name: 'State of charge [%]', unit: '', color: '#c98500', group: 'SOC' },
  ebatt: { id: 'ebatt', label: 'E', name: 'Energy from the battery terminals', unit: 'J', color: '#d55181', group: 'Energy' },
}

function EvDiagram({ st, r, selected, onSelect, values, live }: { st: EvState; r: EvRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live: boolean }) {
  const p = r.params
  const part = (id: string, label: string) => ({
    'data-part': id,
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': selected === id,
    className: `cpart ${selected === id ? 'cpart--sel' : ''}`,
    onClick: () => onSelect(id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(id)
      }
    },
  })
  const regen = st.pBatt < 0
  const flow = `wire ${Math.abs(st.pBatt) > 1 ? (regen ? 'wire--diode' : 'wire--igbt') : ''}`
  const arrow = (x: number, y: number, len: number, cls: string, label: string) =>
    Math.abs(len) < 2 ? null : (
      <g>
        <path d={`M${x} ${y} H${x + len} M${x + len - Math.sign(len) * 8} ${y - 6} L${x + len} ${y} L${x + len - Math.sign(len) * 8} ${y + 6}`} className={cls} />
        <text x={x + len / 2} y={y - 8} textAnchor="middle" className="cvalue">
          {label}
        </text>
      </g>
    )
  const scale = 140 / Math.max(p.fTmax, 1)
  return (
    <svg className="buck-diagram" viewBox="0 0 690 270" role="group" aria-label={`Electric drivetrain: ${st.phase}`}>
      <path d="M130 100 H170 M250 100 H290 M370 100 H400" className={flow} />
      <g {...part('battery', 'Battery')}>
        <rect x={40} y={70} width={90} height={60} rx={8} className="cpart-hit" />
        <rect x={46} y={76} width={78} height={48} rx={6} className="sym-body" />
        <rect x={50} y={80} width={Math.max(0, Math.min(70, 0.7 * st.soc))} height={40} rx={3} fill="#199e70" opacity={0.35} />
        <text x={85} y={97} textAnchor="middle" className="clabel">
          battery
        </text>
        {live && (
          <text x={85} y={114} textAnchor="middle" className="cvalue">
            {st.soc.toFixed(2)} %
          </text>
        )}
        {values && (
          <text x={85} y={146} textAnchor="middle" className="cvalue cvalue--strong">
            {formatV(st.vBatt, false)} · {formatA(st.iBatt, true)}
          </text>
        )}
      </g>
      <g {...part('inverter', 'Inverter')}>
        <rect x={170} y={74} width={80} height={52} rx={6} className="cpart-hit" />
        <rect x={172} y={76} width={76} height={48} rx={6} className={`pblock ${Math.abs(st.pBatt) > 1 ? 'pblock--on' : ''}`} />
        <text x={210} y={97} textAnchor="middle" className="clabel">
          inverter
        </text>
        <text x={210} y={114} textAnchor="middle" className="cvalue">
          η {(p.eta * 100).toFixed(0)} %
        </text>
      </g>
      <g {...part('motor', 'Motor')}>
        <rect x={290} y={70} width={80} height={60} className="cpart-hit" />
        <circle cx={330} cy={100} r={26} className="sym-body" />
        <text x={330} y={105} textAnchor="middle" className="clabel">
          M
        </text>
        <text x={330} y={146} textAnchor="middle" className="cvalue">
          {regen ? 'generating' : 'motoring'}
        </text>
      </g>
      {values && (
        <text x={260} y={60} textAnchor="middle" className="cvalue cvalue--strong">
          {regen ? '← ' : ''}
          {formatW(Math.abs(st.pBatt))}
          {regen ? '' : ' →'}
        </text>
      )}
      {/* car */}
      <g {...part('car', 'Vehicle')}>
        <rect x={400} y={50} width={250} height={140} className="cpart-hit" />
        <path d="M420 150 V120 L455 92 H560 L600 120 H630 V150 Z" className="sym-body" />
        <circle cx={460} cy={155} r={16} className="sym-body" />
        <circle cx={590} cy={155} r={16} className="sym-body" />
        {live && (
          <text x={525} y={128} textAnchor="middle" className="clabel">
            {(st.v * 3.6).toFixed(1)} km/h
          </text>
        )}
        <text x={525} y={84} textAnchor="middle" className="cvalue">
          {p.mass.toFixed(0)} kg · Cd {p.cd}
        </text>
      </g>
      {arrow(525, 205, st.f * scale, 'sym sym--on-q', live ? `motor ${st.f.toFixed(0)} N` : 'motor')}
      {arrow(470, 232, -st.fAero * scale, 'sym', live ? `drag ${st.fAero.toFixed(0)} N` : 'drag')}
      {st.fBrake > 1 && arrow(600, 232, -st.fBrake * scale, 'sym', live ? `brake ${st.fBrake.toFixed(0)} N` : 'brake')}
      <text x={210} y={258} className="path-caption" textAnchor="middle">
        {st.phase}
        {live && ` · ${formatW(st.pBatt)} · ${(st.dist / 1000).toFixed(2)} km`}
      </text>
    </svg>
  )
}

function EvEnergy({ m, r }: { m: EvMeasurements; r: EvRun }) {
  const p = r.params
  if (p.cycle === 'accel') {
    const th = accelTheory(p)
    return (
      <section className="dc-energy" aria-label="Acceleration">
        <h3 className="eyebrow">Acceleration (SIMULATION)</h3>
        <ul className="eflows">
          <li>
            <span className="eflow-label">0–100 km/h</span>
            <span className="eflow-value">{m.t100 === null ? '—' : formatTime(m.t100)}</span>
          </li>
          <li>
            <span className="eflow-label">speed after {p.duration} s</span>
            <span className="eflow-value">{m.vEnd.toFixed(1)} km/h</span>
          </li>
          <li>
            <span className="eflow-label">top speed (THEORY)</span>
            <span className="eflow-value">{th.vTop.toFixed(1)} km/h</span>
          </li>
          <li>
            <span className="eflow-label">peak battery current</span>
            <span className="eflow-value">{formatA(m.iPeak)}</span>
          </li>
        </ul>
      </section>
    )
  }
  const wh = (j: number) => `${(j / 3600).toFixed(2)} Wh`
  const items = [
    { label: 'drawn from the cells', w: m.eChem },
    { label: 'returned by regeneration', w: m.eRegen },
    { label: 'lost in the drivetrain (1 − η)', w: m.eDriveLoss },
    { label: 'lost in the battery (Rb·I²)', w: m.eBattLoss },
    { label: 'burnt in the friction brakes', w: m.eBrake },
    { label: 'auxiliaries', w: p.aux * p.duration },
  ]
  const max = Math.max(...items.map((f) => Math.abs(f.w)), 1e-12)
  return (
    <section className="dc-energy" aria-label="Energy over the cycle">
      <h3 className="eyebrow">Energy over the cycle (SIMULATION)</h3>
      <ul className="eflows">
        {items.map((f) => (
          <li key={f.label}>
            <span className="eflow-label">{f.label}</span>
            <span className="eflow-bar">
              <span style={{ width: `${(100 * Math.abs(f.w)) / max}%` }} />
            </span>
            <span className="eflow-value">{wh(f.w)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        {(m.dist / 1000).toFixed(2)} km · {m.consumption.toFixed(1)} Wh/km · range ≈ {m.range.toFixed(0)} km from {(p.soc0 * 100).toFixed(0)} % of {(p.capacity / 1000).toFixed(0)} kWh (if every km looked like
        this cycle).
      </p>
    </section>
  )
}

export const EV_TOPIC: Topic<EvParams, EvRun, EvMeasurements, EvState> = {
  id: 'evdrive',
  label: 'EV drivetrain',
  title: 'Electric drivetrain on a drive cycle',
  defaults: EV_DEFAULTS,
  basic: [
    {
      kind: 'choice',
      key: 'cycle',
      label: 'Drive cycle',
      options: [
        { value: 'urban', label: 'Urban', title: CYCLE_NAME.urban },
        { value: 'highway', label: 'Highway', title: CYCLE_NAME.highway },
        { value: 'accel', label: '0–100', title: CYCLE_NAME.accel },
      ],
    },
    { kind: 'number', key: 'mass', label: 'Mass', unit: 'kg', min: L.mass.min, max: L.mass.max, step: 50 },
    { kind: 'number', key: 'cd', label: 'Drag coefficient Cd', unit: '', min: L.cd.min, max: L.cd.max, step: 0.01 },
    { kind: 'number', key: 'pregen', label: 'Regeneration limit', unit: 'kW', scale: 1e3, min: L.pregen.min, max: L.pregen.max, step: 5 },
    { kind: 'number', key: 'grade', label: 'Road gradient', unit: '%', min: L.grade.min, max: L.grade.max, step: 0.5 },
  ],
  advanced: [
    { kind: 'number', key: 'pmax', label: 'Motor peak power', unit: 'kW', scale: 1e3, min: L.pmax.min, max: L.pmax.max, log: true },
    { kind: 'number', key: 'tmax', label: 'Motor peak torque', unit: 'N·m', min: L.tmax.min, max: L.tmax.max, log: true },
    { kind: 'number', key: 'gear', label: 'Gear ratio', unit: '', min: L.gear.min, max: L.gear.max, step: 0.1 },
    { kind: 'number', key: 'wheel', label: 'Wheel radius', unit: 'm', min: L.wheel.min, max: L.wheel.max, step: 0.01 },
    { kind: 'number', key: 'area', label: 'Frontal area', unit: 'm²', min: L.area.min, max: L.area.max, step: 0.05 },
    { kind: 'number', key: 'crr', label: 'Rolling resistance Crr', unit: '', min: L.crr.min, max: L.crr.max, step: 0.001 },
    { kind: 'number', key: 'eta', label: 'Drivetrain efficiency', unit: '%', scale: 0.01, min: L.eta.min, max: L.eta.max, step: 1 },
    { kind: 'number', key: 'aux', label: 'Auxiliary load', unit: 'W', min: L.aux.min, max: L.aux.max, step: 50 },
    { kind: 'number', key: 'voc', label: 'Battery voltage Voc', unit: 'V', min: L.voc.min, max: L.voc.max, log: true },
    { kind: 'number', key: 'rb', label: 'Battery resistance', unit: 'mΩ', scale: 1e-3, min: L.rb.min, max: L.rb.max, log: true },
    { kind: 'number', key: 'capacity', label: 'Battery capacity', unit: 'kWh', scale: 1e3, min: L.capacity.min, max: L.capacity.max, log: true },
    { kind: 'number', key: 'soc0', label: 'Initial state of charge', unit: '%', scale: 0.01, min: L.soc0.min, max: L.soc0.max, step: 1 },
  ],
  paramNote: (_p, r) => `${CYCLE_NAME[r.params.cycle]} · base speed ${(r.params.vBase * 3.6).toFixed(0)} km/h · max wheel force ${(r.params.fTmax / 1000).toFixed(2)} kN · constant η and Voc (simplified)`,
  simulate: (p) => simulateEv(p),
  measure: measureEv,
  state: evStateAt,
  view: (st) => evView(st),
  why: evWhy,
  Diagram: ({ r, st, selected, onSelect, values, live = true }) => <EvDiagram r={r} st={st} selected={selected} onSelect={onSelect} values={values} live={live} />,
  channels: CH,
  defaultChannels: ['vkmh', 'vref', 'pbatt'],
  addOrder: ['vkmh', 'vref', 'f', 'fbrake', 'pbatt', 'pwheel', 'pbrake', 'ibatt', 'soc', 'ebatt'],
  shade: (r, k) => (r.signals.pbatt[k] < 0 ? 'rgba(34,177,76,0.12)' : r.signals.pbrake[k] > 1 ? 'rgba(230,103,103,0.16)' : null),
  shadeLegend: 'green band: regenerating · red band: friction brakes in use',
  eventLabel: evEventLabel,
  eventWhy: evEventWhy,
  eventColor: (e) => (e.device === 'friction-brake' ? '#e66767' : e.device === 'peak-regen' ? '#22b14c' : '#3987e5'),
  initialCursor: (r) => (r.params.cycle === 'accel' ? (r.events.find((e) => e.device === '100kmh')?.time ?? 5) : (r.events.find((e) => e.device === 'peak-power')?.time ?? 0)),
  periodName: 'cycle',
  badge: (r, m) => (
    <section className="dc-mode" aria-label="Cycle result">
      <div className="dc-mode-head">
        <span className="mode-pill mode-pill--ccm">{r.params.cycle === 'accel' ? '0–100' : `${m.consumption.toFixed(0)} Wh/km`}</span>
        <span className="small">
          {r.params.cycle === 'accel' ? `${m.t100 === null ? '—' : formatTime(m.t100)} · ${m.vEnd.toFixed(0)} km/h after ${r.params.duration} s` : `${(m.dist / 1000).toFixed(2)} km · range ≈ ${m.range.toFixed(0)} km`}
          <span className="muted"> · SIMULATION</span>
        </span>
      </div>
      <p className="muted small">
        peak {formatW(m.pPeak)} · {formatA(m.iPeak)}
        {r.params.cycle !== 'accel' ? ` · regen ${(m.eRegen / 3600).toFixed(1)} Wh${m.limitedFrac > 0 ? ` · motor limited ${(m.limitedFrac * 100).toFixed(1)} % of the time` : ''}` : ''}
      </p>
    </section>
  ),
  summary: (r, m) => (r.params.cycle === 'accel' ? `0–100 km/h in ${m.t100 === null ? '—' : formatTime(m.t100)} (SIMULATION)` : `${m.consumption.toFixed(0)} Wh/km · range ≈ ${m.range.toFixed(0)} km (SIMULATION)`),
  energy: (_st, m, r) => <EvEnergy m={m} r={r} />,
  inspect: (part, st, m, r) => {
    const p = r.params
    if (part === 'battery')
      return {
        title: 'Battery',
        role: 'Stores the energy; its internal resistance turns part of every joule into heat and makes the voltage sag under load.',
        rows: [
          ['Voc / Rb', `${formatV(p.voc, false)} / ${formatSI(p.rb, 'Ω')}`],
          ['Terminal voltage now', formatV(st.vBatt, false)],
          ['Current now', formatA(st.iBatt, true)],
          ['Peak current', formatA(m.iPeak)],
          ['Capacity', `${(p.capacity / 1000).toFixed(1)} kWh`],
          ['SOC used', `${m.dSoc.toFixed(3)} %`],
        ],
      }
    if (part === 'inverter' || part === 'motor')
      return {
        title: part === 'inverter' ? 'Inverter' : 'Traction motor',
        role: 'Converts DC battery power into the motor\'s AC (and back while braking). Modelled as a constant efficiency inside the motor\'s torque and power envelope.',
        rows: [
          ['Peak torque / power', `${p.tmax} N·m / ${formatW(p.pmax)}`],
          ['Regen limit', formatW(p.pregen)],
          ['Efficiency', `${(p.eta * 100).toFixed(0)} %`],
          ['Base speed', `${(p.vBase * 3.6).toFixed(0)} km/h`],
          ['Drivetrain loss over the run', `${(m.eDriveLoss / 3600).toFixed(2)} Wh`],
        ],
      }
    return {
      title: 'Vehicle',
      role: 'Mass to accelerate, air and tyres to push against, a gradient to climb.',
      rows: [
        ['Mass', `${p.mass.toFixed(0)} kg`],
        ['Cd·A', `${(p.cd * p.area).toFixed(3)} m²`],
        ['Crr', String(p.crr)],
        ['Gradient', `${p.grade} %`],
        ['Drag now', `${st.fAero.toFixed(0)} N`],
        ['Road load now', `${st.fRoad.toFixed(0)} N`],
      ],
    }
  },
  analyze: {
    compare: compareEv,
    theory: (r) => (
      <>
        <h3>Road load, envelope and battery</h3>
        <ol className="derivation">
          <li>
            <b>Vehicle</b> — <span className="mono">m·dv/dt = F − ½·ρ·Cd·A·v² − Crr·m·g·cos θ − m·g·sin θ</span>.
          </li>
          <li>
            <b>Motor envelope</b> — <span className="mono">F ≤ min(Tmax·G/r, Pmax/v)</span>: constant force up to the base speed {(r.params.vBase * 3.6).toFixed(0)} km/h, constant power above; braking
            through the motor is limited to min(Tmax·G/r, Pregen/v).
          </li>
          <li>
            <b>Battery</b> — <span className="mono">Pbatt = F·v/η (or F·v·η) + Paux = (Voc − Rb·I)·I</span>.
          </li>
          <li>
            <b>Cycle energy</b> — for a perfectly followed cycle the wheel power is a cubic in time on each linear piece of the speed profile; the THEORY integrates it exactly, piece by piece.
          </li>
        </ol>
      </>
    ),
    convergence: ['eChem', 't100'],
  },
  lessons: EV_LESSONS,
  experiments: EV_EXPERIMENTS,
  predictions: evPredictions,
  measureLabels: {
    consumption: { label: 'Consumption', fmt: (v) => `${v.toFixed(1)} Wh/km` },
    eRegen: { label: 'Regenerated', fmt: (v) => `${(v / 3600).toFixed(2)} Wh` },
    eBrake: { label: 'Friction brakes', fmt: (v) => `${(v / 3600).toFixed(2)} Wh` },
    pPeak: { label: 'Peak battery power', fmt: (v) => formatW(v) },
    pCruise: { label: 'Cruise power', fmt: (v) => formatW(v) },
    t100: { label: '0–100 km/h', fmt: (v) => formatTime(v) },
  },
}
