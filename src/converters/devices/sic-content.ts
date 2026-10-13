import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, Reading, StatusInfo, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV } from '../../utils/format.ts'
import { compareMosfet, mosfetWhy, type MosfetState } from './content.ts'
import { siParts } from './igbt-content.ts'
import { gateChargeTheory, MATERIAL, measureSic, SI_PRESET, SIC_DEFAULTS, simulateSic, type SicMeasurements, type SicParams, type SicRun } from './sic.ts'

const nsV = (v: number | null) => (v === null ? '—' : `${(v / 1e9).toFixed(1)} V/ns`)

export function sicStatus(st: MosfetState, r: SicRun): StatusInfo {
  const facts = [`vDS ${formatV(st.vds, false)}`, `iD ${formatA(st.id)}`]
  if (st.phase.startsWith('voltage')) facts.push(`gate on the plateau ${formatV(st.vgs, false)}`)
  if (st.phase === 'on (ohmic)') facts.push(`Ron ${formatSI(r.params.ron, 'Ω')} at ${r.sic.tj.toFixed(0)} °C`)
  return { headline: st.phase.charAt(0).toUpperCase() + st.phase.slice(1), facts, tone: st.phase === 'on (ohmic)' ? 'on' : st.phase === 'off' ? 'off' : 'idle' }
}

export function sicWhy(r: SicRun, st: MosfetState, m: SicMeasurements): WhyCard[] {
  const p = r.params
  const s = r.sic
  const mat = MATERIAL[s.material]
  const cards = mosfetWhy(r, st, m)
  cards.push({
    id: 'fast',
    question: s.material === 'sic' ? 'Why does a SiC MOSFET switch so fast?' : 'Why does this silicon MOSFET switch slower?',
    what: `SIMULATION: the drain voltage falls at ${nsV(m.dvdtOn === null ? null : Math.abs(m.dvdtOn))} and rises at ${nsV(m.dvdtOff)}; Eon + Eoff = ${formatSI(m.etot, 'J')}.`,
    why:
      s.material === 'sic'
        ? 'Silicon carbide breaks down at a ten times higher field than silicon, so a 1200 V die can be thin and small for its on-resistance. A small die has small capacitances: little Miller charge to move through Rg, so short plateaus.'
        : 'A silicon die needs a much larger area for the same voltage and on-resistance: larger capacitances, more Miller charge — longer plateaus at the same gate current.',
    equation: 'dvDS/dt ≈ (Vdrv − Vpl)/(Rg·Cgd)  ⇒  E_sw ≈ ½·Vdc·I0·(t_i + t_v) shrinks with Cgd',
    physics: `Cgd = ${formatSI(p.cgd, 'F')}, Ciss = ${formatSI(p.ciss, 'F')}, gate charge Qg = ${formatSI(m.qg, 'C')} (SIMULATION) — the driver delivers Qg·(Vdrv − Voff) per cycle.`,
    whatIf: 'The price of fast edges: a high dv/dt drives currents through every stray capacitance (EMI, motor-winding stress).',
  })
  cards.push({
    id: 'ron',
    question: 'What sets the on-resistance here?',
    what: `Ron = ${formatSI(p.ron, 'Ω')} at Tj = ${s.tj.toFixed(0)} °C and +${p.vdrv.toFixed(0)} V gate (rated ${formatSI(s.ron25, 'Ω')} at 25 °C, +${mat.vref} V); the SIMULATION reads vDS(on) = ${formatV(m.vdsOn, false)}.`,
    why:
      s.material === 'sic'
        ? 'SiC’s channel has a low electron mobility: half of Ron sits in the channel and only shrinks with a high gate overdrive — hence +18 V. The drift layer adds the other half, and both grow with temperature.'
        : 'In a silicon superjunction MOSFET the drift region dominates Ron and its resistance roughly doubles from 25 to 150 °C; +10 V already enhances the channel fully.',
    equation: `Ron = Ron25·(${mat.share} + ${(1 - mat.share).toFixed(1)}·(${mat.vref} − Vth)/(Vdrv − Vth))·(1 + ${(mat.kT * 100).toFixed(2)} %/K·(Tj − 25 °C))  (model)`,
    physics: `Conduction loss at ${formatA(p.i0)}: ${formatSI(p.i0 * m.vdsOn, 'W')}. A positive temperature coefficient shares the current between paralleled dies.`,
    whatIf: 'Drive a SiC MOSFET with only +12 V and its Ron rises noticeably — and the smaller overdrive slows the switching too.',
  })
  cards.push({
    id: 'body',
    question: 'And the body diode?',
    what: 'In this double-pulse test the freewheeling current flows through a separate diode, so the MOSFET’s own body diode never conducts (NOT simulated here).',
    why: 'A SiC body diode is a SiC p-n junction: its forward voltage is high — typically 3–4.5 V at rated current, higher with a negative gate (datasheet values, not this simulation) — against about 0.7–1 V for silicon.',
    equation: 'P_body ≈ V_F·I·t_dead·2·fs  (each dead time of a half-bridge)',
    physics: 'Its reverse recovery is small (almost no stored charge), but the high V_F makes dead-time conduction expensive: keep the dead time short, or turn the channel on (synchronous rectification).',
    whatIf: 'With −4 V on the gate the body diode drop rises further: the negative off-voltage that protects against false turn-on costs dead-time loss.',
  })
  return cards
}

/** SIMULATION vs THEORY: the MOSFET model's exact PWL comparison, plus the gate charge and on-state relations. */
export function compareSic(r: SicRun, m: SicMeasurements): CompareResult {
  const base = compareMosfet(r, m)
  const p = r.params
  const rows: CompareRow[] = [...base.rows]
  const qgTh = gateChargeTheory(p)
  const eQ = Math.abs(m.qg - qgTh) / qgTh
  rows.push({
    key: 'qg',
    label: 'Gate charge Qg (turn-on)',
    unit: 'C',
    sim: m.qg,
    exact: qgTh,
    error: eQ,
    tolerance: 0.005,
    pass: eQ <= 0.005,
    textbook: { key: 'qg', value: qgTh, formula: 'Cgs·(Vdrv − Voff) + Cgd·(Vdrv − Voff + Vdc − vDS,on)', assumptions: ['exact for constant capacitances: the charge moved into the gate node'] },
    textbookError: (m.qg - qgTh) / qgTh,
  })
  const vTh = p.i0 * p.ron
  const eV = Math.abs(m.vdsOn - vTh) / vTh
  rows.push({
    key: 'vdsOn',
    label: 'On-state voltage I0·Ron(Tj, Vdrv)',
    unit: 'V',
    sim: m.vdsOn,
    exact: vTh,
    error: eV,
    tolerance: 0.005,
    pass: eV <= 0.005,
    textbook: { key: 'vdsOn', value: vTh, formula: 'I0·Ron25·(drive factor)·(1 + kT·(Tj − 25))', assumptions: ['the static on-resistance model of this topic'] },
    textbookError: (m.vdsOn - vTh) / vTh,
  })
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `${base.header} The device values are ${MATERIAL[r.sic.material].name}-typical; the model is the MOSFET topic's, unchanged.`,
  }
}

export function sicReadings(m: SicMeasurements, r: SicRun): Reading[] {
  const s = r.sic
  return [
    { id: 'etot', label: 'Switching energy Eon + Eoff', ...siParts(m.etot, 'J'), note: `Eon ${formatSI(m.eon, 'J')} + Eoff ${formatSI(m.eoff, 'J')}; at 100 kHz ${formatSI(m.psw100k, 'W')}` },
    { id: 'dvdt', label: 'Voltage slope at turn-off', value: m.dvdtOff === null ? '—' : (m.dvdtOff / 1e9).toFixed(1), unit: 'V/ns', note: 'dv/dt ≈ (Vpl − Voff)/(Rg·Cgd): small Cgd, fast edge' },
    { id: 'ron', label: `On-resistance at ${s.tj.toFixed(0)} °C`, ...siParts(m.ronSim, 'Ω'), note: `vDS(on)/I0 = ${formatV(m.vdsOn, false)}/${formatA(r.params.i0)}; rated ${formatSI(s.ron25, 'Ω')} at 25 °C`, min: 'standard' },
    { id: 'qg', label: 'Gate charge per turn-on', ...siParts(m.qg, 'C'), note: `∫iG dt; driver energy Qg·(Vdrv − Voff) = ${formatSI(m.qg * (r.params.vdrv - r.params.voff), 'J')}`, min: 'standard' },
  ]
}

const win = (r: SicRun): [number, number] => [r.params.ton - 0.1 * (r.params.toff - r.params.ton), r.params.ton + 0.45 * (r.params.toff - r.params.ton)]
const winOff = (r: SicRun): [number, number] => [r.params.toff - 0.1 * (r.params.toff - r.params.ton), r.params.toff + 0.45 * (r.params.toff - r.params.ton)]
const M = (r: SicRun) => measureSic(r)
const onAt = (r: SicRun) => r.params.ton + 0.85 * (r.params.toff - r.params.ton)

export const SIC_LESSONS: Array<Lesson<SicParams, SicRun, SicMeasurements, MosfetState>> = [
  {
    id: 'fast',
    title: 'Why SiC switches fast',
    summary: 'Small capacitances, a high gate drive — and what that does to dv/dt and the switching energy.',
    check: {
      question: 'At the same 800 V and 20 A, the silicon superjunction MOSFET’s switching energy compared with the SiC MOSFET’s is…',
      options: ['about the same', 'several times larger', 'smaller'],
      answer: 1,
      explain: 'The silicon die needs far more area for the same voltage and Ron, so its capacitances and Miller charge are several times larger: longer plateaus at the same gate current, more overlap of voltage and current.',
    },
    base: {},
    steps: [
      {
        title: '1 · A +18/−4 V gate drive',
        at: (r) => r.params.ton + 0.5 * (M(r).tdOn ?? 0),
        window: win,
        channels: ['vg', 'vgs', 'vds', 'id'],
        look: 'The driver swings from −4 V to +18 V; vGS charges towards it.',
        body: (st, m, r) => `vGS = ${formatV(st.vgs)} on its way from ${formatV(r.params.voff)} to ${formatV(r.params.vdrv)}. SiC needs +18 V to reach its rated Ron, and −4 V keeps it safely off. The delay is ${formatTime(m.tdOn ?? NaN)} (SIMULATION).`,
      },
      {
        title: '2 · A very steep voltage fall',
        at: (r) => r.params.ton + (M(r).tdOn ?? 0) + (M(r).tri ?? 0) + 0.5 * (M(r).tfv ?? 0),
        window: win,
        channels: ['vgs', 'vds', 'id', 'ig'],
        look: 'vDS drops 800 V in a few nanoseconds.',
        body: (st, m) => `vDS is ${formatV(st.vds)} and falling at ${nsV(m.dvdtOn === null ? null : Math.abs(m.dvdtOn))}: the whole 800 V swing takes ${formatTime(m.tfv ?? NaN)}. With only ${formatSI(st.ig, 'A')} of gate current, the small Cgd is discharged quickly.`,
      },
      {
        title: '3 · Turn-off',
        at: (r) => r.params.toff + (M(r).tdOff ?? 0) + 0.5 * (M(r).trv ?? 0),
        window: winOff,
        channels: ['vgs', 'vds', 'id', 'pdev'],
        look: 'The voltage rise is just as fast; the power pulse is short.',
        body: (_st, m) => `Voltage rise ${formatTime(m.trv ?? NaN)} at ${nsV(m.dvdtOff)}. Eon = ${formatSI(m.eon, 'J')}, Eoff = ${formatSI(m.eoff, 'J')} (SIMULATION).`,
      },
      {
        title: '4 · The same test with silicon',
        params: SI_PRESET,
        at: (r) => r.params.ton + (M(r).tdOn ?? 0) + (M(r).tri ?? 0) + 0.5 * (M(r).tfv ?? 0),
        window: (r) => [0, r.params.tend],
        channels: ['vgs', 'vds', 'id', 'energy'],
        look: 'Same 800 V and 20 A, a silicon superjunction die: long plateaus, a tall energy staircase.',
        body: (_st, m) => `Silicon superjunction MOSFET, +12/0 V: Eon + Eoff = ${formatSI(m.etot, 'J')}, turn-off dv/dt ${nsV(m.dvdtOff)}, Qg = ${formatSI(m.qg, 'C')}. Compare the SiC numbers from the previous steps.`,
      },
    ],
  },
  {
    id: 'ron',
    title: 'On-resistance: temperature and gate drive',
    summary: 'Ron rises with temperature and falls with gate voltage — and why the body diode is a weak spot.',
    check: {
      question: 'When the junction heats from 25 °C to 150 °C at the same current, the conduction loss…',
      options: ['rises: Ron grows with temperature', 'falls: hot semiconductors conduct better', 'stays the same'],
      answer: 0,
      explain: 'A MOSFET’s on-resistance has a positive temperature coefficient (here about +0.3 %/K for SiC): at 150 °C the same current costs about 40 % more conduction loss. The good side: paralleled dies share the current.',
    },
    base: {},
    steps: [
      {
        title: '1 · Cold: 25 °C',
        at: onAt,
        window: (r) => [r.params.ton, r.params.toff],
        channels: ['vds', 'id'],
        look: 'The flat on-state voltage.',
        body: (_st, m) => `vDS(on) = ${formatV(m.vdsOn, false)} at ${formatA(m.vdsOn / m.ronSim)}: Ron = ${formatSI(m.ronSim, 'Ω')} (SIMULATION).`,
      },
      {
        title: '2 · Hot: 150 °C',
        params: { tj: 150 },
        at: onAt,
        window: (r) => [r.params.ton, r.params.toff],
        channels: ['vds', 'id'],
        look: 'The same current, a higher on-state voltage.',
        body: (_st, m) => `At 150 °C: vDS(on) = ${formatV(m.vdsOn, false)}, Ron = ${formatSI(m.ronSim, 'Ω')}. The switching energy hardly moves (Eon + Eoff = ${formatSI(m.etot, 'J')}): in this model the capacitances do not depend on temperature.`,
      },
      {
        title: '3 · Under-driven: +12 V',
        params: { vdrv: 12 },
        at: (r) => r.params.ton + (M(r).tdOn ?? 0) + (M(r).tri ?? 0) + 0.5 * (M(r).tfv ?? 0),
        window: win,
        channels: ['vg', 'vgs', 'vds', 'id'],
        look: 'The plateau sits closer to the drive voltage: less gate current, a slower fall.',
        body: (_st, m) => `With +12 V the channel is not fully enhanced: Ron = ${formatSI(m.ronSim, 'Ω')}, and the gate current on the plateau (Vdrv − Vpl)/Rg is smaller, so t_fv = ${formatTime(m.tfv ?? NaN)} and Eon = ${formatSI(m.eon, 'J')} (SIMULATION).`,
      },
      {
        title: '4 · A note on the body diode',
        at: (r) => r.params.ton - 0.5 * r.params.ton,
        window: (r) => [0, r.params.tend],
        channels: ['vds', 'id', 'idiode'],
        look: 'Before the pulse the load current flows in the separate freewheeling diode.',
        body: (st) => `Here the freewheeling diode (${formatA(st.idiode)}) is a separate, ideal diode. In a half-bridge the other SiC MOSFET's body diode would carry it during the dead time — with a forward drop of about 3–4.5 V (datasheet typical, not simulated): run it synchronously and keep the dead time short.`,
      },
    ],
  },
]

export const SIC_EXPERIMENTS: Array<Experiment<SicParams, SicMeasurements>> = [
  {
    id: 'si',
    title: 'Swap in a silicon superjunction MOSFET',
    change: () => SI_PRESET,
    question: () => 'Same 800 V, 20 A and Rg, but a silicon superjunction MOSFET (larger die, +12/0 V drive). What happens to the switching energy Eon + Eoff?',
    choices: ['It grows several times', 'About the same', 'It falls'],
    judge: (b, a) => (a.etot / b.etot > 2 ? 0 : a.etot / b.etot < 0.8 ? 2 : 1),
    rows: ['etot', 'tfv', 'trv', 'dvdtOff', 'qg', 'vdsOn'],
    why: (b, a) => `Eon + Eoff ${formatSI(b.etot, 'J')} → ${formatSI(a.etot, 'J')} (×${(a.etot / b.etot).toFixed(1)}), dv/dt ${nsV(b.dvdtOff)} → ${nsV(a.dvdtOff)}, Qg ${formatSI(b.qg, 'C')} → ${formatSI(a.qg, 'C')}. The silicon die's larger Cgd and Ciss stretch every plateau; at 100 kHz that is ${formatSI(b.psw100k, 'W')} vs ${formatSI(a.psw100k, 'W')}.`,
  },
  {
    id: 'hot',
    title: 'Heat the junction to 150 °C',
    change: () => ({ tj: 150 }),
    question: () => 'Tj goes from 25 °C to 150 °C. Which loss changes more?',
    choices: ['The conduction loss (Ron rises)', 'The switching energy', 'Neither changes'],
    judge: (b, a) => {
      const c = Math.abs(a.vdsOn / b.vdsOn - 1)
      const s = Math.abs(a.etot / b.etot - 1)
      return Math.max(c, s) < 0.01 ? 2 : c > s ? 0 : 1
    },
    rows: ['ronSim', 'vdsOn', 'etot'],
    why: (b, a) => `Ron ${formatSI(b.ronSim, 'Ω')} → ${formatSI(a.ronSim, 'Ω')} (×${(a.ronSim / b.ronSim).toFixed(2)}), while Eon + Eoff ${formatSI(b.etot, 'J')} → ${formatSI(a.etot, 'J')}. In SiC the switching is almost temperature-independent (no stored charge); the conduction loss carries the temperature.`,
  },
  {
    id: 'drive',
    title: 'Drive the gate with +12 V instead of +18 V',
    change: () => ({ vdrv: 12 }),
    question: () => 'The gate drive drops from +18 V to +12 V (a silicon-style driver). What happens?',
    choices: ['Both the on-resistance and the turn-on energy rise', 'Only the turn-on energy rises', 'Nothing important changes'],
    judge: (b, a) => (a.ronSim > b.ronSim * 1.03 && a.eon > b.eon * 1.1 ? 0 : a.eon > b.eon * 1.1 ? 1 : 2),
    rows: ['ronSim', 'eon', 'tfv', 'plateau'],
    why: (b, a) => `Ron ${formatSI(b.ronSim, 'Ω')} → ${formatSI(a.ronSim, 'Ω')}: SiC's channel needs the overdrive. Eon ${formatSI(b.eon, 'J')} → ${formatSI(a.eon, 'J')}: with the plateau at ${formatV(a.plateau ?? NaN, false)}, (Vdrv − Vpl) — the voltage that drives the gate current through Rg on the plateau — is smaller, so t_fv ${formatTime(b.tfv ?? NaN)} → ${formatTime(a.tfv ?? NaN)}.`,
  },
]

export function sicPredictions(seed: number): Array<PredictTask<SicParams, SicMeasurements>> {
  const tj = [100, 125, 150][seed % 3]
  const vdc = [400, 600, 800][(seed + 1) % 3]
  return [
    {
      id: 'ron',
      prompt: `Ron = 75 mΩ at 25 °C (+18 V), rising 0.32 % per kelvin. Predict the on-state voltage at 20 A and Tj = ${tj} °C.`,
      params: { tj },
      kind: 'number',
      unit: 'V',
      answer: (m) => m.vdsOn,
      tolerance: 0.03,
      hint: 'Ron(Tj) = Ron25·(1 + kT·(Tj − 25)); then I·Ron.',
      theory: (p) => `vDS(on) = I0·Ron25·(1 + 0.0032·(Tj − 25)) = ${formatV(p.i0 * p.ron25 * (1 + 0.0032 * (p.tj - 25)), false)}`,
    },
    {
      id: 'qg',
      prompt: `Cgs = 1.3 nF, Cgd = 25 pF, gate +18/−4 V, Vdc = ${vdc} V. Predict the gate charge for one turn-on (in nC).`,
      params: { vdc },
      kind: 'number',
      unit: 'nC',
      answer: (m) => m.qg * 1e9,
      tolerance: 0.05,
      hint: 'Charge Cgs over the gate swing, and Cgd over the gate swing plus the drain swing.',
      theory: (p) => `Qg = Cgs·(Vdrv − Voff) + Cgd·(Vdrv − Voff + Vdc − vDS,on) ≈ ${formatSI(p.cgs * (p.vdrv - p.voff) + p.cgd * (p.vdrv - p.voff + p.vdc), 'C')}`,
    },
    {
      id: 'drive',
      prompt: 'The SiC MOSFET is driven with +12 V instead of its rated +18 V. Its on-resistance is then…',
      params: { vdrv: 12 },
      kind: 'choice',
      choices: ['lower than rated', 'about the rated value', 'clearly higher than rated'],
      answer: (m) => (m.ronSim < m.ronRated * 0.97 ? 0 : m.ronSim > m.ronRated * 1.05 ? 2 : 1),
      hint: 'SiC’s channel has a low mobility: it needs gate overdrive.',
      theory: (p) => `Model: Ron = Ron25·(0.5 + 0.5·(18 − Vth)/(Vdrv − Vth)) = ${formatSI(p.ron25 * (0.5 + (0.5 * (18 - p.vth)) / (p.vdrv - p.vth)), 'Ω')} at +${p.vdrv} V`,
    },
    {
      id: 'si',
      prompt: 'Same 800 V / 20 A test on a silicon superjunction MOSFET (+12/0 V). Its Eon + Eoff compared with the SiC MOSFET’s is…',
      params: SI_PRESET,
      kind: 'choice',
      choices: ['lower', 'about the same', 'several times higher'],
      answer: (m) => {
        const ref = measureSic(simulateSic(SIC_DEFAULTS)).etot
        return m.etot > 2 * ref ? 2 : m.etot < 0.8 * ref ? 0 : 1
      },
      hint: 'Which die has the larger capacitances for the same voltage and Ron?',
      theory: () => 'E_sw ≈ ½·Vdc·I0·(t_ri + t_fv + t_rv + t_fi); every plateau time scales with Rg·Cgd and every current time with Rg·Ciss — both several times larger for the silicon die.',
    },
  ]
}

export { SIC_DEFAULTS }
