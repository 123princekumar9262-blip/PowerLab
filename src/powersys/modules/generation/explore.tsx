import { useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { ModuleProps } from '../../types.ts'
import { fx } from '../../ui/format.ts'
import { Readouts, Seg, Slider, useTutorContext, type ReadoutItem } from '../../ui/kit.tsx'
import {
  changeWords,
  coalTonnesPerDay,
  DEFAULT_PLANTS,
  ETA_CYCLE_RANGE,
  heatRateBounds,
  P_RANGE,
  PLANT_LABEL,
  T_COOL_C,
  T_STEAM_C,
  timesWords,
  withHeatRate,
  type Plants,
  type PlantType,
} from './calc.ts'
import { PlantPfd, Sankey } from './diagrams.tsx'
import { PlantScene } from './PlantScene.tsx'
import { ScadaLab } from './scada.tsx'
import type { LabState } from './se.ts'
import { ECON_HREF, grp, Invalid, MODULE, pc, sci, usePlants, type PlantResults } from './shared.tsx'

const TYPES: PlantType[] = ['thermal', 'hydro', 'nuclear', 'pumped']

export function Explore({
  plants,
  setPlants,
  lab,
  setLab,
  seen,
  setSeen,
}: {
  plants: Plants
  setPlants(p: Plants): void
  lab: LabState
  setLab(l: LabState): void
  seen: PlantType[]
  setSeen(s: PlantType[]): void
  setMode: ModuleProps['setMode']
}) {
  const [view, setView] = useState<'stations' | 'scada'>('stations')
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <Seg
          label="What to explore"
          value={view}
          onChange={setView}
          options={[
            { id: 'stations', label: 'Power stations' },
            { id: 'scada', label: 'Grid monitoring (SCADA & state estimation)' },
          ]}
        />
      </div>
      {view === 'stations' ? <Stations plants={plants} setPlants={setPlants} seen={seen} setSeen={setSeen} /> : <ScadaLab lab={lab} setLab={setLab} />}
    </div>
  )
}

// ── what changed ─────────────────────────────────────────────────────────────────────────────────────────────

interface Change {
  what: string
  why: string
}
/** The headline result of a station (for "you changed"). */
function headline(t: PlantType, r: PlantResults): { label: string; value: number; unit: string; d: number } | null {
  if (t === 'thermal') return r.thermal.ok ? { label: 'Coal burnt', value: r.thermal.fuelKgH / 1000, unit: 't/h', d: 1 } : null
  if (t === 'hydro') return r.hydro.ok ? { label: 'Flow needed', value: r.hydro.qM3s, unit: 'm³/s', d: 1 } : null
  if (t === 'nuclear') return r.nuclear.ok ? { label: 'U-235 fissioned', value: r.nuclear.kgPerDay, unit: 'kg/day', d: 3 } : null
  return r.pumped.ok ? { label: 'Energy returned', value: r.pumped.eOutMwh, unit: 'MWh', d: 1 } : null
}
const WHY: Record<string, string> = {
  'thermal.pMw': 'At a fixed heat rate the fuel, the heat and every loss scale with the output.',
  'thermal.etaCycle': 'Fuel per hour = P × HR / CV: it is proportional to the heat rate (here set through the steam-cycle efficiency).',
  'thermal.cvKjKg': 'For the same heat, coal with a lower calorific value must be burnt in proportionally greater mass.',
  'thermal.etaBoiler': 'Each efficiency in the chain multiplies into η = η_b·η_cycle·η_g — so into the heat rate and the fuel.',
  'thermal.etaGen': 'Each efficiency in the chain multiplies into η = η_b·η_cycle·η_g — so into the heat rate and the fuel.',
  'thermal.co2KgPerGj': 'Only the CO₂ estimate depends on the emission factor.',
  'thermal.dTCondK': 'For the same condenser heat, a larger temperature rise needs proportionally less cooling water.',
  'hydro.pMw': 'Q = P/(ρgHη): the flow needed is proportional to the output.',
  'hydro.headM': 'Q = P/(ρgHη): each cubic metre falling further gives more energy, so the same output needs proportionally less water.',
  'hydro.etaTurbine': 'Q = P/(ρgHη): a less efficient machine needs more water for the same output.',
  'hydro.etaGen': 'Q = P/(ρgHη): a less efficient machine needs more water for the same output.',
  'hydro.volumeMm3': 'The volume changes only the energy stored and how long it lasts, not the flow.',
  'nuclear.pMw': 'Heat = P/η_th, and the fuel fissioned is proportional to the heat.',
  'nuclear.etaTh': 'A less efficient steam cycle needs more reactor heat — more fissions — for the same output.',
  'pumped.pMw': 'Energy in = rating × pumping hours; every energy scales with it.',
  'pumped.headM': 'The head changes how much water must be moved and the flows — not the energies (the efficiencies are unchanged).',
  'pumped.hoursPumping': 'Energy in = rating × pumping hours.',
  'pumped.etaMotor': 'η_rt is the product of four efficiencies: each one scales the energy returned.',
  'pumped.etaPump': 'η_rt is the product of four efficiencies: each one scales the energy returned.',
  'pumped.etaTurbine': 'η_rt is the product of four efficiencies: each one scales the energy returned.',
  'pumped.etaGen': 'η_rt is the product of four efficiencies: each one scales the energy returned.',
  'pumped.mode': 'The same machine, run the other way: the picture and the flows reverse; the energies do not change.',
}
const NAME: Record<string, string> = {
  pMw: 'Output',
  etaCycle: 'Heat rate (steam-cycle efficiency)',
  cvKjKg: 'Calorific value',
  etaBoiler: 'Boiler efficiency',
  etaGen: 'Generator efficiency',
  co2KgPerGj: 'Emission factor',
  dTCondK: 'Cooling-water rise',
  headM: 'Head',
  etaTurbine: 'Turbine efficiency',
  volumeMm3: 'Reservoir volume',
  etaTh: 'Thermal efficiency',
  hoursPumping: 'Pumping time',
  etaMotor: 'Motor efficiency',
  etaPump: 'Pump efficiency',
  mode: 'Mode',
}
function describe(a: Plants, b: Plants): Change | null {
  if (a.type !== b.type) return null
  const t = b.type
  const ia = a[t] as unknown as Record<string, number | string>
  const ib = b[t] as unknown as Record<string, number | string>
  const k = Object.keys(ib).find((key) => ia[key] !== ib[key])
  if (!k) return null
  const v = ib[k]
  if (t === 'thermal' && k === 'etaCycle') {
    const th = b.thermal
    return { what: `Heat rate → ${grp(3600 / (th.etaBoiler * th.etaCycle * th.etaGen), 0)} kJ/kWh (steam-cycle efficiency ${pc(th.etaCycle)})`, why: WHY['thermal.etaCycle'] }
  }
  return { what: `${NAME[k] ?? k} → ${typeof v === 'number' ? (v < 1 ? pc(v) : grp(v, v < 10 ? 1 : 0)) : v === 'generate' ? 'generating' : 'pumping'}`, why: WHY[`${t}.${k}`] ?? '' }
}

// ── stations ───────────────────────────────────────────────────────────────────────────────────────────────

function Stations({ plants, setPlants, seen, setSeen }: { plants: Plants; setPlants(p: Plants): void; seen: PlantType[]; setSeen(s: PlantType[]): void }) {
  const level = useLevel()
  const res = usePlants(plants)
  const progress = usePsProgress()
  const [selected, setSelected] = useState<string | null>(null)
  const [change, setChange] = useState<(Change & { before: ReturnType<typeof headline> }) | null>(null)
  const t = plants.type
  const update = (next: Plants) => {
    const c = describe(plants, next)
    setChange(c ? { ...c, before: headline(t, res) } : null)
    setPlants(next)
  }
  const setType = (type: PlantType) => {
    setSelected(null)
    setChange(null)
    setPlants({ ...plants, type })
    if (!seen.includes(type)) {
      const next = [...seen, type]
      setSeen(next)
      if (next.length >= 4) completeActivity(MODULE, 'plants')
    }
  }
  const set = <K extends PlantType>(k: K, patch: Partial<Plants[K]>) => update({ ...plants, [k]: { ...plants[k], ...patch } })
  const outcome = res[t]
  const fallback = (
    <PlantPfd
      type={t}
      res={{
        thermal: res.thermal.ok ? res.thermal : undefined,
        hydro: res.hydro.ok ? res.hydro : undefined,
        nuclear: res.nuclear.ok ? res.nuclear : undefined,
        pumped: res.pumped.ok ? res.pumped : undefined,
      }}
      inputs={{ pMw: plants[t].pMw, headM: t === 'hydro' ? plants.hydro.headM : plants.pumped.headM, pumped: plants.pumped }}
      selected={selected}
    />
  )
  const head = headline(t, res)
  useTutorContext(
    () =>
      `Explore — power stations. Plant type ${PLANT_LABEL[t]}. Inputs: ${JSON.stringify(plants[t])}. ${outcome.ok ? `Results: ${resultText(plants, res)}` : `Invalid: ${outcome.issues.join(' ')}`}`,
  )
  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <Seg label="Plant type" value={t} onChange={setType} options={TYPES.map((id) => ({ id, label: PLANT_LABEL[id] }))} />
          <button
            type="button"
            className="text-btn"
            disabled={plants[t] === DEFAULT_PLANTS[t]}
            onClick={() => {
              setChange(null)
              setPlants({ ...plants, [t]: DEFAULT_PLANTS[t] })
            }}
          >
            Reset
          </button>
        </div>
        <span className="small muted">{isDone(progress, MODULE, 'plants') ? '✓ all four kinds of station run' : `${seen.length} of 4 kinds of station seen`}</span>
      </div>
      <PlantScene p={plants} res={res} selected={selected} onSelect={setSelected} fallback={fallback} />
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <section className="ps-card" aria-labelledby="gen-ctl">
            <h3 id="gen-ctl">{PLANT_LABEL[t]} station</h3>
            <Controls plants={plants} set={set} level={level} />
          </section>
          {outcome.ok && (
            <section className="ps-card" aria-labelledby="gen-flow">
              <h3 id="gen-flow">Where the energy goes</h3>
              <Sankey c={outcome.chain} label={`${PLANT_LABEL[t]} energy flow`} />
              {t === 'pumped' && (
                <p className="small muted">
                  Why store at a loss? Off-peak energy is cheap and the peak is expensive: the load curve and its peak are in{' '}
                  <a className="ps-link" href={ECON_HREF}>
                    Module 11 (Economic Operation)
                  </a>
                  .
                </p>
              )}
            </section>
          )}
        </div>
        <div className="ps-stack">
          {!outcome.ok && <Invalid issues={outcome.issues} />}
          {outcome.ok && (
            <section className="ps-card" aria-labelledby="gen-res">
              <h3 id="gen-res">Results</h3>
              <Results plants={plants} res={res} level={level} />
              {change && change.before && head && (
                <div className="gen-change" aria-live="polite">
                  <p className="small">
                    <b>You changed:</b> {change.what}.
                  </p>
                  <p className="small">
                    {head.label} {fx(change.before.value, head.d)} → {fx(head.value, head.d)} {head.unit} ({changeWords(head.value, change.before.value)}).
                  </p>
                  {change.why && <p className="small muted">Why: {change.why}</p>}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function resultText(p: Plants, r: PlantResults): string {
  if (p.type === 'thermal' && r.thermal.ok)
    return `η ${pc(r.thermal.eta)}, heat rate ${grp(r.thermal.heatRate, 0)} kJ/kWh, coal ${grp(r.thermal.fuelKgH / 1000, 1)} t/h, condenser ${grp(r.thermal.condenserMw, 0)} MW.`
  if (p.type === 'hydro' && r.hydro.ok) return `Q ${grp(r.hydro.qM3s, 1)} m³/s, stored ${grp(r.hydro.storedMwh, 0)} MWh, ${grp(r.hydro.hours, 1)} h.`
  if (p.type === 'nuclear' && r.nuclear.ok) return `heat ${grp(r.nuclear.thermalMw, 0)} MW, U-235 ${fx(r.nuclear.kgPerDay, 3)} kg/day.`
  if (p.type === 'pumped' && r.pumped.ok) return `round trip ${pc(r.pumped.etaRt)}, ${grp(r.pumped.eInMwh, 0)} MWh in, ${grp(r.pumped.eOutMwh, 0)} MWh out.`
  return ''
}

// ── controls ───────────────────────────────────────────────────────────────────────────────────────────────

type SetFn = <K extends PlantType>(k: K, patch: Partial<Plants[K]>) => void

function Controls({ plants, set, level }: { plants: Plants; set: SetFn; level: string }) {
  const t = plants.type
  const [lo, hi] = P_RANGE[t]
  const eta = (label: string, value: number, onChange: (v: number) => void, min: number, max: number, hint?: string) => (
    <Slider label={label} value={value * 100} min={min * 100} max={max * 100} step={0.5} unit="%" decimals={1} onChange={(v) => onChange(v / 100)} hint={hint} />
  )
  const primary = (
    <>
      <Slider
        label={t === 'pumped' ? 'Machine rating' : 'Electrical output'}
        value={plants[t].pMw}
        min={lo}
        max={hi}
        step={10}
        unit="MW"
        decimals={0}
        onChange={(v) => set(t, { pMw: v })}
        hint={t === 'pumped' ? 'the power drawn while pumping and delivered while generating' : undefined}
      />
      {t === 'pumped' && (
        <div className="gen-mode">
          <span className="ps-slider-label">
            <span>The machine is</span>
          </span>
          <Seg
            label="Pumped-storage mode"
            full
            value={plants.pumped.mode}
            onChange={(m) => set('pumped', { mode: m })}
            options={[
              { id: 'generate', label: 'Generating (peak)' },
              { id: 'pump', label: 'Pumping (off-peak)' },
            ]}
          />
        </div>
      )}
    </>
  )
  let standard = null
  let engineer = null
  if (t === 'thermal') {
    const th = plants.thermal
    const hr = 3600 / (th.etaBoiler * th.etaCycle * th.etaGen)
    // the reachable heat rates, rounded inwards to the slider's 50 kJ/kWh step (so η_cycle never leaves its range)
    const [b0, b1] = heatRateBounds(th)
    const hrLo = Math.ceil(b0 / 50) * 50
    const hrHi = Math.floor(b1 / 50) * 50
    standard = (
      <>
        <Slider
          label="Heat rate"
          value={hr}
          min={hrLo}
          max={hrHi}
          step={50}
          unit="kJ/kWh"
          decimals={0}
          onChange={(v) => set('thermal', withHeatRate(th, v))}
          hint={`heat in per kWh out. Moving it changes the steam-cycle efficiency (boiler and generator held), kept within this module’s ${ETA_CYCLE_RANGE[0] * 100}–${ETA_CYCLE_RANGE[1] * 100} % range: ${grp(hrLo, 0)}–${grp(hrHi, 0)} kJ/kWh here`}
        />
        <Slider
          label="Calorific value of the coal"
          value={th.cvKjKg}
          min={12000}
          max={30000}
          step={500}
          unit="kJ/kg"
          decimals={0}
          onChange={(v) => set('thermal', { cvKjKg: v })}
          hint="illustrative range"
        />
      </>
    )
    engineer = (
      <>
        {eta('Boiler efficiency η_b', th.etaBoiler, (v) => set('thermal', { etaBoiler: v }), 0.8, 0.94)}
        {eta('Steam-cycle efficiency η_cycle', th.etaCycle, (v) => set('thermal', { etaCycle: v }), ETA_CYCLE_RANGE[0], ETA_CYCLE_RANGE[1], 'turbine work ÷ heat into steam')}
        {eta('Generator efficiency η_g', th.etaGen, (v) => set('thermal', { etaGen: v }), 0.95, 0.99)}
        <Slider
          label="CO₂ emission factor"
          value={th.co2KgPerGj}
          min={80}
          max={110}
          step={1}
          unit="kg/GJ"
          decimals={0}
          onChange={(v) => set('thermal', { co2KgPerGj: v })}
          hint="illustrative, per GJ of coal heat"
        />
        <Slider label="Cooling-water temperature rise" value={th.dTCondK} min={6} max={14} step={1} unit="K" decimals={0} onChange={(v) => set('thermal', { dTCondK: v })} />
      </>
    )
  } else if (t === 'hydro') {
    const h = plants.hydro
    standard = (
      <>
        <Slider
          label="Head H"
          value={h.headM}
          min={20}
          max={600}
          step={5}
          unit="m"
          decimals={0}
          onChange={(v) => set('hydro', { headM: v })}
          hint="height of the reservoir surface above the tailrace"
        />
        <Slider label="Usable reservoir volume" value={h.volumeMm3} min={5} max={500} step={5} unit="million m³" decimals={0} onChange={(v) => set('hydro', { volumeMm3: v })} />
      </>
    )
    engineer = (
      <>
        {eta('Turbine efficiency η_t', h.etaTurbine, (v) => set('hydro', { etaTurbine: v }), 0.8, 0.95)}
        {eta('Generator efficiency η_g', h.etaGen, (v) => set('hydro', { etaGen: v }), 0.95, 0.99)}
      </>
    )
  } else if (t === 'nuclear') {
    standard = eta('Thermal efficiency η_th', plants.nuclear.etaTh, (v) => set('nuclear', { etaTh: v }), 0.28, 0.4, 'electrical output ÷ reactor heat')
  } else {
    const ps = plants.pumped
    standard = (
      <>
        <Slider label="Head H" value={ps.headM} min={100} max={600} step={10} unit="m" decimals={0} onChange={(v) => set('pumped', { headM: v })} />
        <Slider label="Pumping time (off-peak)" value={ps.hoursPumping} min={1} max={10} step={0.5} unit="h" decimals={1} onChange={(v) => set('pumped', { hoursPumping: v })} />
      </>
    )
    engineer = (
      <>
        {eta('Motor efficiency', ps.etaMotor, (v) => set('pumped', { etaMotor: v }), 0.9, 0.99)}
        {eta('Pump efficiency', ps.etaPump, (v) => set('pumped', { etaPump: v }), 0.8, 0.95)}
        {eta('Turbine efficiency', ps.etaTurbine, (v) => set('pumped', { etaTurbine: v }), 0.8, 0.95)}
        {eta('Generator efficiency', ps.etaGen, (v) => set('pumped', { etaGen: v }), 0.9, 0.99)}
      </>
    )
  }
  return (
    <div className="ps-stack gen-controls">
      {primary}
      {standard && (
        <details className="ps-more" open={level !== 'beginner'}>
          <summary>Station data</summary>
          <div className="gen-ctl-group">{standard}</div>
        </details>
      )}
      {engineer && (
        <details className="ps-more" open={level === 'engineer'}>
          <summary>{t === 'thermal' ? 'The efficiency chain' : 'Machine efficiencies'}</summary>
          <div className="gen-ctl-group">{engineer}</div>
        </details>
      )}
      <p className="small muted">All values are illustrative (typical orders of magnitude), not a particular station.</p>
    </div>
  )
}

// ── results ────────────────────────────────────────────────────────────────────────────────────────────────

function Results({ plants, res, level }: { plants: Plants; res: PlantResults; level: string }) {
  let main: ReadoutItem[] = []
  let more: ReadoutItem[] = []
  let note = ''
  if (plants.type === 'thermal' && res.thermal.ok) {
    const r = res.thermal
    main = [
      { label: 'Station efficiency η', value: fx(r.eta * 100, 2), unit: '%', note: '3600 ÷ heat rate' },
      { label: 'Heat rate', value: grp(r.heatRate, 0), unit: 'kJ/kWh' },
      { label: 'Coal burnt', value: grp(r.fuelKgH / 1000, 1), unit: 't/h', note: `${grp(r.fuelTDay, 0)} t/day` },
    ]
    more = [
      { label: 'Fuel heat input', value: grp(r.qInMw, 0), unit: 'MW', note: 'P ÷ η' },
      { label: 'Heat to the condenser', value: grp(r.condenserMw, 0), unit: 'MW', note: `${pc(r.condenserMw / r.qInMw)} of the fuel heat` },
      { label: 'Cooling water', value: fx(r.coolingM3s, 1), unit: 'm³/s', note: `for a ${plants.thermal.dTCondK} K rise` },
      { label: 'CO₂ (illustrative)', value: grp(r.co2TH, 0), unit: 't/h', note: `${grp(r.co2KgPerMwh, 0)} kg/MWh` },
      { label: 'Carnot limit', value: fx(r.carnot * 100, 1), unit: '%', note: `illustrative ${T_STEAM_C} °C / ${T_COOL_C} °C` },
    ]
    note = 'Net output; the station’s own auxiliary consumption is not modelled. The CO₂ factor is illustrative, not a measured value for any coal.'
  } else if (plants.type === 'hydro' && res.hydro.ok) {
    const r = res.hydro
    main = [
      { label: 'Flow needed Q', value: grp(r.qM3s, 1), unit: 'm³/s', note: 'P ÷ (ρgHη)' },
      { label: 'Water per MWh', value: grp(r.m3PerMwh, 0), unit: 'm³' },
      { label: 'Overall efficiency', value: fx(r.eta * 100, 1), unit: '%', note: 'η_t · η_g' },
    ]
    more = [
      { label: 'Power in the water', value: grp(r.waterMw, 1), unit: 'MW', note: 'ρgQH' },
      { label: 'Energy stored', value: grp(r.storedMwh, 0), unit: 'MWh', note: 'ρgVH' },
      { label: 'As electricity', value: grp(r.electricalMwh, 0), unit: 'MWh', note: `lasts ${grp(r.hours, 1)} h at this output` },
    ]
    note = 'The head is taken as constant (the reservoir level does not fall in the model); pipe friction is included in the turbine efficiency.'
  } else if (plants.type === 'nuclear' && res.nuclear.ok) {
    const r = res.nuclear
    const th = plants.thermal
    const hr = 3600 / (th.etaBoiler * th.etaCycle * th.etaGen)
    const coal = coalTonnesPerDay(plants.nuclear.pMw, hr, th.cvKjKg)
    main = [
      { label: 'Reactor heat', value: grp(r.thermalMw, 0), unit: 'MW', note: 'P ÷ η_th' },
      { label: 'U-235 fissioned', value: fx(r.kgPerDay, 3), unit: 'kg/day' },
      { label: 'Fissions per second', value: sci(r.fissionsPerS), note: '≈ 200 MeV each' },
    ]
    more = [
      { label: 'Heat rejected', value: grp(r.rejectedMw, 0), unit: 'MW' },
      { label: 'Energy per kg fissioned', value: fx(r.energyPerKgJ / 1e12, 1), unit: 'TJ/kg' },
      { label: 'Coal for the same output', value: grp(coal, 0), unit: 't/day', note: `${timesWords((coal * 1000) / r.kgPerDay)} the mass (coal station’s heat rate and CV)` },
    ]
    note = 'Counts only the U-235 that fissions: in a real reactor some U-235 absorbs a neutron without splitting, and part of the energy comes from plutonium bred in the fuel.'
  } else if (plants.type === 'pumped' && res.pumped.ok) {
    const r = res.pumped
    main = [
      { label: 'Round-trip efficiency', value: fx(r.etaRt * 100, 1), unit: '%', note: 'η_m·η_p·η_t·η_g' },
      { label: 'Energy returned', value: grp(r.eOutMwh, 0), unit: 'MWh', note: `of ${grp(r.eInMwh, 0)} MWh pumped` },
      { label: 'Break-even price ratio', value: fx(r.breakEven, 3), note: 'peak ÷ off-peak = 1/η_rt' },
    ]
    more = [
      { label: 'Energy stored', value: grp(r.storedMwh, 0), unit: 'MWh' },
      { label: 'Water raised', value: grp(r.volumeM3 / 1e6, 2), unit: 'million m³' },
      { label: 'Flow pumping / generating', value: `${grp(r.qPump, 0)} / ${grp(r.qGen, 0)}`, unit: 'm³/s' },
      { label: 'Generation time', value: grp(r.hoursGen, 2), unit: 'h', note: 'at the rating' },
    ]
    note = 'Head taken as constant; evaporation and leakage neglected.'
  }
  return (
    <>
      <Readouts label="Main results" items={main} />
      {level === 'beginner' ? (
        <details className="ps-more">
          <summary>All results</summary>
          <Readouts label="More results" items={more} />
        </details>
      ) : (
        <Readouts label="More results" items={more} />
      )}
      <p className="small muted">{note}</p>
    </>
  )
}
