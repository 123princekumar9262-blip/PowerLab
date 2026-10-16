import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Eq, Seg, Stepper, useTutorContext } from '../../ui/kit.tsx'
import {
  carnot,
  DEFAULT_PLANTS,
  DEFAULT_PUMPED,
  fissionEnergyPerKgJ,
  G,
  J_PER_MWH,
  M_U235,
  MEV_J,
  MEV_PER_FISSION,
  NA,
  PLANT_LABEL,
  RHO_W,
  T_COOL_C,
  T_STEAM_C,
  timesWords,
  type Plants,
  type PlantType,
} from './calc.ts'
import { EstimationNetwork, HydroPfd, PlantPfd, ReactorDiagram, Sankey, SCADA_BLOCKS, ScadaDiagram, ThermalPfd } from './diagrams.tsx'
import { PlantScene } from './PlantScene.tsx'
import { checkCoal, checkNuclear, checkPumped } from './verify.ts'
import { DEG, estimate, LAB0, labMeasurements, measDefs, minimiseJ } from './se.ts'
import { ECON_HREF, grp, LFC_HREF, MODULE, pc, sci, STAB_HREF, SyllabusNote, usePlants } from './shared.tsx'

const req = <T extends { ok: boolean }>(o: T): Extract<T, { ok: true }> => {
  if (!o.ok) throw new Error('default inputs invalid')
  return o as Extract<T, { ok: true }>
}

export function Learn({ onExplore }: { onExplore(): void }) {
  const level = useLevel()
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const [type, setType] = useState<PlantType>('thermal')
  const [scadaSel, setScadaSel] = useState<string | null>(null)
  const p0: Plants = useMemo(() => ({ ...DEFAULT_PLANTS, type }), [type])
  const res = usePlants(p0)
  const th = req(res.thermal)
  const hy = req(res.hydro)
  const nu = req(res.nuclear)
  const pu = req(res.pumped)
  const T = DEFAULT_PLANTS.thermal
  const Hy = DEFAULT_PLANTS.hydro
  const Nu = DEFAULT_PLANTS.nuclear
  const Pu = DEFAULT_PUMPED
  // nuclear by hand
  const atomsPerKg = (1000 / M_U235) * NA
  const jPerFission = MEV_PER_FISSION * MEV_J
  const eKg = fissionEnergyPerKgJ()
  // per-MWh comparison
  const coalKgMwh = (th.heatRate * 1000) / T.cvKjKg
  const waterM3Mwh = J_PER_MWH / (RHO_W * G * Hy.headM * hy.eta)
  const u235gMwh = (J_PER_MWH / (Nu.etaTh * eKg)) * 1000
  const psWaterMwh = J_PER_MWH / (RHO_W * G * Pu.headM * Pu.etaTurbine * Pu.etaGen)
  // state estimation, default lab
  const ms = useMemo(() => labMeasurements(LAB0), [])
  const se = useMemo(() => estimate(ms), [ms])
  const direct = useMemo(() => minimiseJ(ms), [ms])
  const defs = measDefs()
  const cyc = carnot(T_STEAM_C, T_COOL_C)
  const cc = checkCoal(T, th)
  const cn = checkNuclear(Nu, nu)
  const cp = checkPumped(Pu, pu)
  // the largest single loss of the coal station, computed
  const biggest = th.chain.steps.reduce((b, st) => (st.loss > b.loss ? st : b))
  const sceneFallback = (
    <PlantPfd type={type} res={{ thermal: th, hydro: hy, nuclear: nu, pumped: pu }} inputs={{ pMw: p0[type].pMw, headM: type === 'hydro' ? Hy.headM : Pu.headM, pumped: Pu }} selected={sel} />
  )

  const steps: Array<{ title: string; visual: ReactNode; body: ReactNode; work?: ReactNode }> = [
    {
      title: 'Where does a power station’s energy come from?',
      visual: (
        <>
          <div className="ps-toolbar">
            <Seg
              label="Plant type"
              value={type}
              onChange={(t) => {
                setSel(null)
                setType(t)
              }}
              options={(['thermal', 'hydro', 'nuclear', 'pumped'] as PlantType[]).map((id) => ({ id, label: PLANT_LABEL[id] }))}
            />
          </div>
          <PlantScene p={p0} res={res} selected={sel} onSelect={setSel} fallback={sceneFallback} tour={false} height={360} />
        </>
      ),
      body: (
        <>
          <p className="gen-question">
            A coal plant, a dam and a nuclear reactor all end up spinning the same kind of generator — so where does each one’s energy come from, and how much fuel or water does a megawatt need?
          </p>
          <p>
            Switch the picture between the four kinds of station. In every one, a <b>turbine</b> turns a <b>synchronous generator</b>. What turns the turbine differs: steam made by <b>burning coal</b>
            , steam made by <b>splitting uranium nuclei</b>, or <b>falling water</b>. Pumped storage runs the water the other way too — it stores energy.
          </p>
          <p>Select any part (in the picture or the list) to see what it does and its computed values.</p>
          <SyllabusNote ids={['power-generation']} />
        </>
      ),
    },
    {
      title: 'A coal station: water → steam → work → water',
      visual: <ThermalPfd r={th} pMw={T.pMw} />,
      body: (
        <>
          <p>
            Follow the water round the loop. The <b>feed pump</b> pushes water into the <b>boiler</b> at high pressure. Burning coal boils it into hot, high-pressure <b>steam</b>. The steam expands
            through the <b>turbine</b>: its pressure and temperature fall as it pushes the blades round. The exhausted steam is turned back into water in the <b>condenser</b>, and the pump sends it
            round again. This loop is the <b>Rankine cycle</b>.
          </p>
          <p>
            Why throw heat away in the condenser? Condensing the steam keeps the turbine exhaust at a very low pressure, so the steam expands — and works — much further. But a heat engine must reject
            heat to something cold: no cycle can turn all its heat into work. Here the condenser takes {grp(th.condenserMw, 0)} MW — {pc(th.condenserMw / th.qInMw)} of the fuel heat,{' '}
            {biggest === th.chain.steps[1] ? 'the largest single loss in the station' : `not the largest loss: ${biggest.lossLabel.toLowerCase()} is bigger (${grp(biggest.loss, 0)} MW)`}.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            title="The upper limit: Carnot"
            expr="η_Carnot = 1 − T_cold / T_hot   (temperatures in kelvin)"
            where={[
              ['T_hot', 'temperature at which heat is taken in (the steam)', 'K'],
              ['T_cold', 'temperature at which heat is rejected (the condenser)', 'K'],
            ]}
            assume="an ideal reversible cycle — real cycles always fall short"
          />
          <Calc
            title={`Illustrative temperatures: steam ${T_STEAM_C} °C, condenser ${T_COOL_C} °C`}
            steps={[
              { label: 'T_hot', expr: `${T_STEAM_C} + 273.15`, result: `${fx(T_STEAM_C + 273.15, 2)} K` },
              { label: 'T_cold', expr: `${T_COOL_C} + 273.15`, result: `${fx(T_COOL_C + 273.15, 2)} K` },
              { label: 'η_Carnot', expr: `1 − ${fx(T_COOL_C + 273.15, 2)} / ${fx(T_STEAM_C + 273.15, 2)}`, result: pc(cyc) },
            ]}
            check={{ ok: T.etaCycle < cyc, text: `The steam-cycle efficiency used here, ${pc(T.etaCycle)}, is below this limit, as it must be.` }}
          />
        </>
      ),
    },
    {
      title: 'Heat rate, efficiency and fuel',
      visual: <Sankey c={th.chain} label="Coal station energy flow" />,
      body: (
        <>
          <p>
            Stations quote their performance as a <b>heat rate</b>: the fuel heat needed for each kWh sent out. A kWh is 3600 kJ, so a station needing {grp(th.heatRate, 0)} kJ of heat per kWh converts
            3600/{grp(th.heatRate, 0)} = {pc(th.eta)} of the heat. A lower heat rate is better.
          </p>
          <p>
            The efficiency is a <b>chain</b>: the boiler puts {pc(T.etaBoiler)} of the coal’s heat into the steam, the steam cycle turns {pc(T.etaCycle)} of that into shaft work, and the generator
            turns {pc(T.etaGen)} of the work into electricity: {pc(T.etaBoiler)} × {pc(T.etaCycle)} × {pc(T.etaGen)} = {pc(th.eta)}. (Illustrative component values.)
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="η = 3600 / HR     ṁ_fuel = P · HR / CV     η = η_boiler · η_cycle · η_generator"
            where={[
              ['HR', 'heat rate: heat in per kWh out', 'kJ/kWh'],
              ['P', 'electrical output', 'kW'],
              ['CV', 'calorific value of the coal (heat per kg burnt)', 'kJ/kg'],
              ['ṁ_fuel', 'coal burnt', 'kg/h'],
            ]}
            assume="steady full output; net output (the station’s own auxiliary power is not modelled)"
          />
          <Calc
            title={`Worked example: ${grp(T.pMw, 0)} MW, heat rate ${grp(th.heatRate, 0)} kJ/kWh, coal of ${grp(T.cvKjKg, 0)} kJ/kg`}
            steps={[
              { label: 'η = 3600 / HR', expr: `3600 / ${grp(th.heatRate, 0)}`, result: pc(th.eta, 2) },
              { label: 'Fuel heat Q_in = P / η', expr: `${grp(T.pMw, 0)} / ${fx(th.eta, 4)}`, result: `${grp(th.qInMw, 1)} MW` },
              {
                label: 'Coal = P · HR / CV',
                expr: `${grp(T.pMw * 1000, 0)} kW × ${grp(th.heatRate, 0)} / ${grp(T.cvKjKg, 0)}`,
                result: `${grp(th.fuelKgH, 0)} kg/h = ${grp(th.fuelKgH / 1000, 1)} t/h`,
              },
              { label: 'CO₂ (illustrative factor)', expr: `${grp(th.qInMw, 1)} MW × 3.6 GJ/MWh × ${T.co2KgPerGj} kg/GJ`, result: `${grp(th.co2TH, 0)} t/h ≈ ${grp(th.co2KgPerMwh, 0)} kg/MWh` },
            ]}
            check={{
              ok: cc.ok,
              text: `Second route, in SI units: ${grp(T.pMw, 0)}×10⁶ W × ${grp(th.heatRate, 0)}/3600 = ${sci(cc.heatW, 4)} J/s of heat; ÷ ${grp(T.cvKjKg * 1000, 0)} J/kg = ${fx(cc.kgPerS, 2)} kg/s = ${grp(cc.fuelSi, 0)} kg/h — the same. (The losses ${grp(th.boilerLossMw, 1)} + ${grp(th.condenserMw, 1)} + ${grp(th.genLossMw, 1)} MW plus the output add up to ${grp(th.qInMw, 1)} MW — that is bookkeeping, not a second method.)`,
            }}
          />
          <p className="small muted">The CO₂ factor ({T.co2KgPerGj} kg per GJ of coal heat) is an illustrative value of the right order for coal; real coals differ.</p>
        </>
      ),
    },
    {
      title: 'Hydro: the energy of falling water',
      visual: <HydroPfd r={hy} pMw={Hy.pMw} headM={Hy.headM} />,
      body: (
        <>
          <p>
            A dam holds water at a height: the <b>head</b> H between the reservoir surface and the tailrace. Water flowing down the <b>penstock</b> turns height into pressure and speed, and the{' '}
            <b>turbine</b> takes that energy. Each second, a mass ρQ falls H metres and gives up ρQ·g·H joules: power is <b>head × flow</b>.
          </p>
          <p>
            Turbines suit the head: <b>Pelton</b> wheels (jets striking buckets) for high heads with small flows; <b>Francis</b> turbines for medium heads; <b>Kaplan</b> turbines (adjustable propeller
            blades) for low heads with large flows. (Typical uses — the ranges overlap.)
          </p>
          <p className="small muted">
            The energy waiting in the reservoir is E = ρgVH: {grp(Hy.volumeMm3, 0)} million m³ at {grp(Hy.headM, 0)} m is {grp(hy.storedMwh, 0)} MWh of potential energy; after the {pc(hy.eta)}{' '}
            efficiency that is {grp(hy.electricalMwh, 0)} MWh of electricity — {grp(hy.hours, 1)} hours at {grp(Hy.pMw, 0)} MW.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="P = ρ · g · Q · H · η     E = ρ · g · V · H"
            where={[
              ['ρ', 'density of water, 1000', 'kg/m³'],
              ['g', '9.81', 'm/s²'],
              ['Q', 'flow (discharge)', 'm³/s'],
              ['H', 'net head', 'm'],
              ['η', 'overall efficiency, η_turbine · η_generator', ''],
              ['P, E', 'power and stored energy', 'W, J'],
            ]}
            assume="constant head; friction in the penstock counted in the efficiency"
          />
          <Calc
            title={`Worked example: ${grp(Hy.pMw, 0)} MW at ${grp(Hy.headM, 0)} m, η = ${pc(hy.eta)} — how much water?`}
            steps={[
              { label: 'η = η_t · η_g', expr: `${fx(Hy.etaTurbine, 2)} × ${fx(Hy.etaGen, 2)}`, result: fx(hy.eta, 4) },
              { label: 'Q = P / (ρ g H η)', expr: `${grp(Hy.pMw, 0)}×10⁶ / (1000 × 9.81 × ${grp(Hy.headM, 0)} × ${fx(hy.eta, 4)})`, result: `${grp(hy.qM3s, 2)} m³/s` },
              { label: 'Water per MWh', expr: `${grp(hy.qM3s, 2)} m³/s × 3600 s / ${grp(Hy.pMw, 0)} MW`, result: `${grp(hy.m3PerMwh, 0)} m³` },
            ]}
            check={{
              ok: Math.abs(RHO_W * hy.qM3s * G * Hy.headM * hy.eta - Hy.pMw * 1e6) < 1e-6 * Hy.pMw * 1e6,
              text: `First principles: ${grp(RHO_W * hy.qM3s, 0)} kg of water a second falling ${grp(Hy.headM, 0)} m gives m·g·H = ${grp((RHO_W * hy.qM3s * G * Hy.headM) / 1e6, 2)} MW; × η = ${grp((RHO_W * hy.qM3s * G * Hy.headM * hy.eta) / 1e6, 2)} MW.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Nuclear: energy from splitting atoms',
      visual: <ReactorDiagram />,
      body: (
        <>
          <p>
            When a slow neutron strikes a U-235 nucleus, the nucleus <b>splits</b> (fission) into two lighter nuclei and releases about {MEV_PER_FISSION} MeV — plus two or three fast neutrons that can
            split further nuclei: a <b>chain reaction</b>. The reactor keeps it steady:
          </p>
          <ul className="gen-list">
            <li>
              <b>Fuel</b> — uranium oxide pellets in metal rods (mostly U-238, enriched in U-235).
            </li>
            <li>
              <b>Moderator</b> — here water: slows the neutrons, so they cause fission more readily.
            </li>
            <li>
              <b>Control rods</b> — absorb neutrons: in to slow the reaction, fully in to stop it.
            </li>
            <li>
              <b>Coolant</b> — carries the heat to the steam generator; from there it is a steam station.
            </li>
            <li>
              <b>Shielding and containment</b> — thick concrete and steel against radiation.
            </li>
          </ul>
        </>
      ),
      work: (
        <>
          <Eq
            expr="E per kg = (1000 / M) · N_A · E_f      fuel per day = (P / η_th) · 86 400 s / (E per kg)"
            where={[
              ['M', `molar mass of U-235, ${M_U235}`, 'g/mol'],
              ['N_A', `Avogadro constant, ${sci(NA, 9)}`, '1/mol'],
              ['E_f', `energy per fission, ≈ ${MEV_PER_FISSION} MeV = ${sci(jPerFission, 4)} J (approximate textbook value)`, 'J'],
              ['η_th', 'thermal efficiency (electrical out ÷ reactor heat)', ''],
            ]}
            assume="only the U-235 that fissions is counted (no capture, no plutonium contribution)"
          />
          <Calc
            title={`Worked example: ${grp(Nu.pMw, 0)} MW at η_th = ${pc(Nu.etaTh, 0)}`}
            steps={[
              { label: 'Atoms in 1 kg', expr: `(1000 / ${M_U235}) × ${sci(NA, 4)}`, result: sci(atomsPerKg, 4) },
              { label: 'Energy per kg', expr: `${sci(atomsPerKg, 4)} × ${sci(jPerFission, 4)} J`, result: `${sci(eKg, 4)} J = ${fx(eKg / 1e12, 1)} TJ` },
              { label: 'Reactor heat', expr: `${grp(Nu.pMw, 0)} / ${fx(Nu.etaTh, 2)}`, result: `${grp(nu.thermalMw, 1)} MW` },
              { label: 'U-235 per day', expr: `${grp(nu.thermalMw, 1)}×10⁶ × 86 400 / ${sci(eKg, 4)}`, result: `${fx(nu.kgPerDay, 3)} kg` },
            ]}
            check={{
              ok: cn.ok,
              text: `Second route — count the atoms: ${sci(cn.perS, 4)} fissions a second × 86 400 s = ${sci(cn.perDay, 4)} atoms = ${fx(cn.moles, 3)} mol × ${M_U235} g/mol = ${fx(cn.kg, 3)} kg — the same. A coal station of heat rate ${grp(th.heatRate, 0)} kJ/kWh would burn ${grp(((Nu.pMw * 24 * th.heatRate) / T.cvKjKg) * 1, 0)} t of coal a day for the same output — ${timesWords((Nu.pMw * 24 * th.heatRate * 1000) / T.cvKjKg / nu.kgPerDay)} the mass.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Pumped storage: a battery made of water',
      visual: <Sankey c={pu.chain} label="Pumped-storage round trip" />,
      body: (
        <>
          <p>
            At night, when demand is low and energy is cheap, the machine runs as a <b>motor-driven pump</b> and lifts water to the upper reservoir. At the evening peak the same machine runs the other
            way as <b>turbine and generator</b>. It is a store, not a source: every stage loses a little.
          </p>
          <p>
            Here {grp(pu.eInMwh, 0)} MWh pumped returns {grp(pu.eOutMwh, 0)} MWh — a round trip of {pc(pu.etaRt)}. It pays when peak energy is worth more than 1/η_rt = {fx(pu.breakEven, 2)} times
            off-peak energy — and it lets the big thermal units run steadily instead of following the load. The daily load curve and its peak are in{' '}
            <a className="ps-link" href={ECON_HREF}>
              Module 11 (Economic Operation)
            </a>
            .
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="η_rt = η_motor · η_pump · η_turbine · η_generator     E_out = η_rt · E_in"
            where={[
              ['E_in', 'energy drawn from the grid while pumping', 'MWh'],
              ['E_out', 'energy returned while generating', 'MWh'],
            ]}
            assume="same head both ways; evaporation and leakage neglected"
          />
          <Calc
            title={`Worked example: ${grp(Pu.pMw, 0)} MW for ${Pu.hoursPumping} h, head ${grp(Pu.headM, 0)} m`}
            steps={[
              { label: 'E_in', expr: `${grp(Pu.pMw, 0)} MW × ${Pu.hoursPumping} h`, result: `${grp(pu.eInMwh, 0)} MWh` },
              { label: 'Stored = E_in · η_m · η_p', expr: `${grp(pu.eInMwh, 0)} × ${fx(Pu.etaMotor, 2)} × ${fx(Pu.etaPump, 2)}`, result: `${grp(pu.storedMwh, 1)} MWh` },
              { label: 'Water raised V = E / (ρgH)', expr: `${grp(pu.storedMwh, 1)} × 3.6×10⁹ / (1000 × 9.81 × ${grp(Pu.headM, 0)})`, result: `${grp(pu.volumeM3 / 1e6, 3)} million m³` },
              { label: 'E_out = stored · η_t · η_g', expr: `${grp(pu.storedMwh, 1)} × ${fx(Pu.etaTurbine, 2)} × ${fx(Pu.etaGen, 2)}`, result: `${grp(pu.eOutMwh, 1)} MWh` },
            ]}
            check={{
              ok: cp.ok,
              text: `Second route — through the flows: pumping ${grp(pu.qPump, 1)} m³/s for ${Pu.hoursPumping} h raises ${grp(cp.vol, 0)} m³; at ${grp(pu.qGen, 1)} m³/s it runs back down in ${fx(cp.hoursDown, 3)} h, giving ${grp(Pu.pMw, 0)} MW × ${fx(cp.hoursDown, 3)} h = ${grp(cp.eOut, 1)} MWh — the same as ${grp(pu.eInMwh, 0)} × η_rt ${fx(pu.etaRt, 4)}.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Back to the question: what does a megawatt-hour need?',
      visual: (
        <div className="ps-card table-wrap">
          <table className="ps-table">
            <caption className="small muted">For 1 MWh of electricity, with this module’s illustrative station data (computed)</caption>
            <thead>
              <tr>
                <th scope="col">Station</th>
                <th scope="col">What it uses per MWh</th>
                <th scope="col">Assuming</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Coal</td>
                <td>{grp(coalKgMwh, 0)} kg of coal</td>
                <td>
                  heat rate {grp(th.heatRate, 0)} kJ/kWh, CV {grp(T.cvKjKg, 0)} kJ/kg
                </td>
              </tr>
              <tr>
                <td>Hydro</td>
                <td>{grp(waterM3Mwh, 0)} m³ of water (re-used downstream)</td>
                <td>
                  head {grp(Hy.headM, 0)} m, η {pc(hy.eta)}
                </td>
              </tr>
              <tr>
                <td>Nuclear</td>
                <td>{fx(u235gMwh, 3)} g of U-235 fissioned</td>
                <td>η_th {pc(Nu.etaTh, 0)}, ≈ 200 MeV per fission</td>
              </tr>
              <tr>
                <td>Pumped storage</td>
                <td>
                  {fx(1 / pu.etaRt, 3)} MWh pumped earlier, {grp(psWaterMwh, 0)} m³ cycled
                </td>
                <td>
                  head {grp(Pu.headM, 0)} m, round trip {pc(pu.etaRt)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ),
      body: (
        <>
          <p>
            The same megawatt-hour costs {grp(coalKgMwh, 0)} kg of coal, {grp(waterM3Mwh, 0)} m³ of water falling {grp(Hy.headM, 0)} m — or {fx(u235gMwh, 3)} g of uranium-235. Coal and uranium differ{' '}
            {timesWords(coalKgMwh / (u235gMwh / 1000))} in mass because a chemical reaction releases a few electron-volts per atom, a fission about {MEV_PER_FISSION} million.
          </p>
          <p>Pumped storage makes no energy of its own: it returns {pc(pu.etaRt)} of what it was given — at the hour when it is worth most.</p>
        </>
      ),
    },
    {
      title: 'SCADA: how the control centre sees the grid',
      visual: (
        <div className="gen-scada-row">
          <ScadaDiagram selected={scadaSel} onSelect={setScadaSel} />
          <div className="gen-scada-info">{scadaSel ? <ScadaInfo id={scadaSel} /> : <p className="small muted">Select a block to read what it does.</p>}</div>
        </div>
      ),
      body: (
        <>
          <p>
            A grid of many substations is run from a <b>control centre</b>. In each substation an <b>RTU</b> (or the <b>IEDs</b> — digital relays and meters) reads the analogue values (MW, Mvar,
            voltage, current, frequency) and the status of every breaker. A <b>communication network</b> carries them to the <b>master station</b>, whose servers keep a live database, raise alarms and
            show it all to the operators on the <b>HMI</b>. Commands go the other way: open or close a breaker, raise or lower a tap, change a generator’s set-point.
          </p>
          <p>
            The <b>EMS</b> applications turn the data into decisions: <b>state estimation</b> (next step), <b>load–frequency control / AGC</b> (
            <a className="ps-link" href={LFC_HREF}>
              Module 12
            </a>
            ), <b>economic dispatch</b> (
            <a className="ps-link" href={ECON_HREF}>
              Module 11
            </a>
            ) and security analysis. Generator dynamics after a disturbance are in{' '}
            <a className="ps-link" href={STAB_HREF}>
              Module 6
            </a>
            .
          </p>
          <p>
            <b>PMUs</b> measure voltage and current <i>phasors</i> — magnitude and angle — stamped with GPS time, and stream them many times a second. SCADA scans its RTUs in turn, so its snapshot is
            slower and not time-aligned; with PMUs the angle difference across the grid can be seen directly (wide-area monitoring).
          </p>
          <SyllabusNote ids={['scada-wams']} />
        </>
      ),
    },
    {
      title: 'State estimation: the best picture from imperfect meters',
      visual: se.ok ? <EstimationNetwork out={se} enabled={LAB0.enabled} bad={null} /> : null,
      body: (
        <>
          <p>
            Every meter has a small error, some readings are missing, and now and then one is badly wrong. The <b>state estimator</b> finds the one set of bus angles (the <b>state</b>) that fits all
            the measurements best, giving accurate meters more weight. Because there are more measurements than unknowns (<b>redundancy</b>), the leftover differences — the <b>residuals</b> — show
            whether a measurement disagrees with the rest.
          </p>
          <p>
            Here: {se.ok ? se.meas.length : 0} power measurements for 2 unknown angles on a three-bus network (DC model: lossless lines, |V| = 1 pu, small angles). In Explore you can switch meters
            off, add a PMU and inject a faulty reading.
          </p>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Explore the stations and the state estimator →
          </button>
        </>
      ),
      work: se.ok ? (
        <>
          <Eq
            expr="z = H x + e     J(x) = Σ (z_i − h_i x)² / σ_i²     x̂ = (HᵀWH)⁻¹ HᵀW z"
            where={[
              ['x', 'the state [θ₂, θ₃] (θ₁ = 0, the reference)', 'rad'],
              ['z', 'the measurements: flows P_ij = (θ_i − θ_j)/x_ij and injections', 'pu'],
              ['H', 'how each measurement depends on the state (one row each)', 'pu/rad'],
              ['W', 'weights 1/σ_i² — accurate meters count more', '1/pu²'],
              ['r', 'the residuals z − Hx̂; J(x̂) is tested against χ²', 'pu'],
            ]}
            assume="DC power flow; independent Gaussian meter errors"
          />
          <Calc
            title={`The estimate from these ${se.meas.length} measurements`}
            steps={[
              { label: 'H rows (flow 1→2, flow 2→3)', expr: `[${defs.P12.row.map((v) => fx(v, 0)).join(', ')}], [${defs.P23.row.map((v) => fx(v, 0)).join(', ')}] …`, result: `${se.meas.length} × 2` },
              { label: 'x̂ = (HᵀWH)⁻¹ HᵀWz', expr: 'normal equations (2 × 2)', result: `θ̂₂ ${fx(se.x[0] / DEG, 4)}°, θ̂₃ ${fx(se.x[1] / DEG, 4)}°` },
              { label: 'J(x̂)', expr: `Σ r²/σ² over ${se.meas.length} measurements`, result: fx(se.J, 3) },
              { label: 'χ² limit', expr: `${se.dof} degrees of freedom, 99 %`, result: fx(se.chi2, 3) },
            ]}
            check={{
              ok: Math.abs(direct.x[0] - se.x[0]) < 1e-9 && Math.abs(direct.x[1] - se.x[1]) < 1e-9,
              text: `Minimising J(x) directly, without the normal equations (Newton steps from values of J alone): θ₂ ${fx(direct.x[0] / DEG, 4)}°, θ₃ ${fx(direct.x[1] / DEG, 4)}° — the same. J ${se.detected ? 'exceeds' : 'is within'} the limit: ${se.detected ? 'bad data suspected' : 'no bad data'}.`,
            }}
          />
          {level !== 'beginner' && (
            <Callout tone="info" title="Why the DC model?">
              Real estimators use the full AC equations (voltage magnitudes and Mvar too) and iterate; the DC model keeps the estimator linear, so the WLS solution is one step and every number can be
              checked by hand.
            </Callout>
          )}
        </>
      ) : null,
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — power generation, step ${step + 1} of ${steps.length}: ${cur.title}. Defaults: coal ${T.pMw} MW, heat rate ${grp(th.heatRate, 0)} kJ/kWh, coal ${grp(th.fuelKgH / 1000, 1)} t/h; hydro ${Hy.pMw} MW at ${Hy.headM} m, Q ${grp(hy.qM3s, 1)} m³/s; nuclear ${Nu.pMw} MW at ${pc(Nu.etaTh)}, ${fx(nu.kgPerDay, 2)} kg U-235/day; pumped storage round trip ${pc(pu.etaRt)}.`,
  )
  return (
    <div className="ps-split gen-learn">
      <div className="gen-learn-visual ps-stack">
        {cur.visual}
        {cur.work}
      </div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}

function ScadaInfo({ id }: { id: string }) {
  const b = SCADA_BLOCKS.find((q) => q.id === id)
  if (!b) return null
  return (
    <>
      <p className="eyebrow">Selected</p>
      <h4>{b.name}</h4>
      <p className="small">{b.what}</p>
    </>
  )
}
