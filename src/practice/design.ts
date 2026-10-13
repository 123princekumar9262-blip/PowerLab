import { simulateCircuit } from '../converters/engine.ts'
import { dcdcModel } from '../converters/dcdc/model.ts'
import { measureDcdc, type DcdcMeasurements } from '../converters/dcdc/measure.ts'
import { DCDC_DEFAULTS } from '../converters/params.ts'
import type { ConverterKind, ConverterParams, Run, ResolvedConverter } from '../converters/types.ts'
import { measure, type Measurements } from '../measurements/measurements.ts'
import { runSimulation } from '../simulation/engine.ts'
import { DEFAULT_PARAMS } from '../simulation/params.ts'
import type { LabParams, SimulationResult } from '../types/simulation.ts'
import { formatA, formatSI } from '../utils/format.ts'

/**
 * DESIGN — specification → your design → validated result.
 *
 * The student chooses component values; the real engines simulate exactly that design (DC-DC: the converter
 * netlist in its periodic steady state, `converters/engine.ts` + `dcdc/model.ts`; rectifier filter: the rectifier
 * engine from a discharged capacitor). Every requirement is judged on the SIMULATED value: PASS inside the limit,
 * WARNING within a small margin past it, FAIL beyond. Hints scale the simulated value with the circuit's own
 * proportionality (ripple ∝ 1/(L·fs), ∝ 1/C …) — always labelled as an estimate for the next try.
 */

export type Verdict = 'pass' | 'warning' | 'fail'

export interface DesignField {
  key: string
  label: string
  /** Display unit; the stored value is display × scale. */
  unit: string
  scale: number
  min: number
  max: number
  step: number
}

export interface Check {
  id: string
  label: string
  /** The requirement, e.g. "≤ 30 % of IL". */
  limit: string
  /** The simulated value, formatted. */
  value: string
  /** The simulated value in the requirement's own unit (numbers for tests). */
  sim: number
  verdict: Verdict
  hint: string
}

export interface DcdcRunView {
  kind: 'dcdc'
  label: string
  run: Run<ResolvedConverter>
  m: DcdcMeasurements
}
export interface RectRunView {
  kind: 'rect'
  label: string
  result: SimulationResult
  m: Measurements
}
export interface DesignResult {
  checks: Check[]
  verdict: Verdict
  /** What was simulated (e.g. the duty actually used). */
  used: Array<[string, string]>
  runs: Array<DcdcRunView | RectRunView>
}

export interface DesignSpec {
  id: string
  title: string
  /** One line: the specification in numbers. */
  brief: string
  story: string
  /** Given (not yours to choose). */
  given: Array<[string, string]>
  /** The requirements as written in the spec. */
  requirements: Array<[string, string]>
  fields: DesignField[]
  /** Starting design (deliberately not a solution). */
  start: Record<string, number>
  /** Duty: computed from the ideal conversion ratio unless the student overrides it. */
  autoDuty?: (d: Record<string, number>) => number
  evaluate(d: Record<string, number>): DesignResult
  /** The workspace at this design. */
  link(d: Record<string, number>): { lab: string; topic: string; query: Record<string, string> }
}

// ── Verdict rules ─────────────────────────────────────────────────────────────

/** value ≤ limit: PASS; ≤ limit·(1 + margin): WARNING; else FAIL. */
export const upper = (value: number, limit: number, margin = 0.15): Verdict => (value <= limit ? 'pass' : value <= limit * (1 + margin) ? 'warning' : 'fail')
/** value ≥ limit: PASS; ≥ limit·(1 − margin): WARNING; else FAIL. */
export const lower = (value: number, limit: number, margin = 0.04): Verdict => (value >= limit ? 'pass' : value >= limit * (1 - margin) ? 'warning' : 'fail')
/** |value − target| ≤ tol·target: PASS; ≤ warn·target: WARNING; else FAIL. */
export const band = (value: number, target: number, tol: number, warn: number): Verdict => {
  const e = Math.abs(value - target) / Math.abs(target)
  return e <= tol ? 'pass' : e <= warn ? 'warning' : 'fail'
}
export function overall(checks: Check[]): Verdict {
  if (checks.some((c) => c.verdict === 'fail')) return 'fail'
  if (checks.some((c) => c.verdict === 'warning')) return 'warning'
  return 'pass'
}

const pctTxt = (x: number, d = 1) => `${(x * 100).toFixed(d)} %`
const margin = (value: number, limit: number) => `Margin: ${pctTxt(Math.abs(limit - value) / Math.abs(limit), 0)} inside the limit.`
const uH = (h: number) => formatSI(h, 'H')

// ── DC-DC specs ──────────────────────────────────────────────────────────────

/** Simulate a DC-DC design (ideal devices: 1 mΩ switch, 0 V / 1 mΩ diode — as the DC-DC lab's "ideal"). */
export function simulateDcdc(kind: ConverterKind, p: Partial<ConverterParams>): { run: Run<ResolvedConverter>; m: DcdcMeasurements } {
  const run = simulateCircuit(dcdcModel(kind), { ...DCDC_DEFAULTS[kind], devices: 'ideal', rl: 0, esr: 0, view: 'steady', periods: 4, stepsPerPeriod: 300, ...p })
  return { run, m: measureDcdc(run) }
}

const DCDC_FIELDS: DesignField[] = [
  { key: 'l', label: 'Inductance L', unit: 'µH', scale: 1e-6, min: 1, max: 2000, step: 1 },
  { key: 'c', label: 'Output capacitance C', unit: 'µF', scale: 1e-6, min: 1, max: 2000, step: 1 },
  { key: 'fs', label: 'Switching frequency fs', unit: 'kHz', scale: 1e3, min: 10, max: 500, step: 1 },
  { key: 'duty', label: 'Duty ratio D', unit: '%', scale: 0.01, min: 10, max: 90, step: 0.1 },
]

/** Vout requirement with a hint from the simulated conversion ratio. */
function voutCheck(kind: ConverterKind, m: DcdcMeasurements, vin: number, target: number, D: number, label = 'Output voltage'): Check {
  const v = band(m.voutAvg, target, 0.02, 0.05)
  // next duty: scale the SIMULATED conversion ratio M toward the target (buck: M ∝ D; boost: M ∝ 1/(1 − D))
  const next = kind === 'buck' ? (D * target) / m.voutAvg : 1 - ((1 - D) * m.voutAvg) / target
  return {
    id: label === 'Output voltage' ? 'vout' : `vout-${label}`,
    label,
    limit: `${formatSI(target, 'V')} ± 2 %`,
    value: formatSI(m.voutAvg, 'V'),
    sim: m.voutAvg,
    verdict: v,
    hint:
      v === 'pass'
        ? `Error ${pctTxt((m.voutAvg - target) / target, 2)}.`
        : m.mode === 'DCM'
          ? `The converter is in DCM here, where Vout depends on the load and L, not only on D: fix CCM first (more L).`
          : `Simulated Vout/Vin = ${(m.voutAvg / vin).toFixed(3)} with D = ${pctTxt(D)}. Estimate for the next try: D ≈ ${pctTxt(Math.min(0.9, Math.max(0.1, next)))}.`,
  }
}

function dcdcSpec(o: {
  id: string
  kind: ConverterKind
  title: string
  story: string
  vin: number
  vout: number
  io: number
  ilRipple: number
  voutRipple: number
  ipk: number
  start: Record<string, number>
}): DesignSpec {
  const r = o.vout / o.io
  const ideal = () => (o.kind === 'buck' ? o.vout / o.vin : 1 - o.vin / o.vout)
  return {
    id: o.id,
    title: o.title,
    brief: `${o.vin} V → ${o.vout} V, ${o.io} A ${o.kind}`,
    story: o.story,
    given: [
      ['Input voltage Vin', formatSI(o.vin, 'V')],
      ['Load', `${formatSI(o.io, 'A')} (R = ${formatSI(r, 'Ω')})`],
      ['Devices', 'ideal switch and diode'],
    ],
    requirements: [
      ['Output voltage', `${o.vout} V ± 2 %`],
      ['Inductor ripple ΔiL', `≤ ${pctTxt(o.ilRipple, 0)} of IL`],
      ['Output ripple ΔVout', `≤ ${pctTxt(o.voutRipple, 0)} of Vout`],
      [o.kind === 'buck' ? 'Switch peak current' : 'Diode peak current', `≤ ${formatSI(o.ipk, 'A')}`],
      ['Conduction mode', 'continuous (CCM)'],
    ],
    fields: DCDC_FIELDS,
    start: o.start,
    autoDuty: ideal,
    evaluate(d) {
      const D = d.duty
      const { run, m } = simulateDcdc(o.kind, { vin: o.vin, r, l: d.l, c: d.c, fs: d.fs, duty: D })
      const il = m.ilPP / m.ilAvg
      const vr = m.voutPP / m.voutAvg
      const ipk = o.kind === 'buck' ? m.iqPeak : m.ilMax
      const kIl = il / o.ilRipple
      const kV = vr / o.voutRipple
      const checks: Check[] = [
        voutCheck(o.kind, m, o.vin, o.vout, D),
        {
          id: 'il-ripple',
          label: 'Inductor ripple ΔiL',
          limit: `≤ ${pctTxt(o.ilRipple, 0)} of IL`,
          value: `${formatA(m.ilPP)} = ${pctTxt(il)}`,
          sim: il,
          verdict: upper(il, o.ilRipple),
          hint: il <= o.ilRipple ? margin(il, o.ilRipple) : `ΔiL ∝ 1/(L·fs). Raise L·fs by ×${kIl.toFixed(2)} or more — e.g. L ≥ ${uH(d.l * kIl)} at this fs.`,
        },
        {
          id: 'vout-ripple',
          label: 'Output ripple ΔVout',
          limit: `≤ ${pctTxt(o.voutRipple, 0)} of Vout`,
          value: `${formatSI(m.voutPP, 'V')} = ${pctTxt(vr, 2)}`,
          sim: vr,
          verdict: upper(vr, o.voutRipple),
          hint:
            vr <= o.voutRipple
              ? margin(vr, o.voutRipple)
              : o.kind === 'buck'
                ? `ΔVout ∝ ΔiL/(C·fs): raise C·fs by ×${kV.toFixed(2)} (e.g. C ≥ ${formatSI(d.c * kV, 'F')}) or lower ΔiL.`
                : `In a boost C alone feeds the load while Q1 is ON: ΔVout ∝ Io·D/(C·fs). Raise C·fs by ×${kV.toFixed(2)} (e.g. C ≥ ${formatSI(d.c * kV, 'F')}).`,
        },
        {
          id: 'ipk',
          label: o.kind === 'buck' ? 'Switch peak current' : 'Diode peak current',
          limit: `≤ ${formatSI(o.ipk, 'A')}`,
          value: formatA(ipk),
          sim: ipk,
          verdict: upper(ipk, o.ipk, 0.08),
          hint: ipk <= o.ipk ? margin(ipk, o.ipk) : `The peak is IL + ΔiL/2 = ${formatA(m.ilAvg)} + ${formatA(m.ilPP / 2)}: lower ΔiL (more L or fs).`,
        },
        {
          id: 'ccm',
          label: 'Conduction mode',
          limit: 'CCM',
          value: m.mode,
          sim: m.mode === 'CCM' ? 1 : 0,
          verdict: m.mode === 'CCM' ? 'pass' : 'fail',
          hint: m.mode === 'CCM' ? `Lowest inductor current ${formatA(m.ilMin)} — it never reaches zero.` : `iL reaches zero every period: ΔiL must stay below 2·IL. Raise L (or fs).`,
        },
      ]
      return { checks, verdict: overall(checks), used: [['Duty simulated', pctTxt(D, 1)], ['Load R', formatSI(r, 'Ω')]], runs: [{ kind: 'dcdc', label: 'Full load', run, m }] }
    },
    link: (d) => ({ lab: 'dc-dc', topic: o.kind, query: q({ vin: o.vin, r, l: d.l, c: d.c, fs: d.fs, duty: d.duty }) }),
  }
}

const q = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(Number(v.toPrecision(6)))]))

const LIGHT = { vin: 24, vout: 5, full: 3, light: 0.5 }
const lightSpec: DesignSpec = {
  id: 'buck-light-load',
  title: 'Buck that stays in CCM',
  brief: '24 V → 5 V, 3 A, CCM down to 0.5 A',
  story: 'A 5 V rail for a board whose load drops to 0.5 A in standby. The output must stay regulated by D alone — continuous conduction — from full load down to standby.',
  given: [
    ['Input voltage Vin', '24.00 V'],
    ['Full load', `3.000 A (R = ${formatSI(LIGHT.vout / LIGHT.full, 'Ω')})`],
    ['Standby load', `500 mA (R = ${formatSI(LIGHT.vout / LIGHT.light, 'Ω')})`],
    ['Devices', 'ideal switch and diode'],
  ],
  requirements: [
    ['Output voltage, full load', '5 V ± 2 %'],
    ['Output ripple, full load', '≤ 1 % of Vout'],
    ['Conduction mode at 0.5 A', 'continuous (CCM)'],
    ['Output voltage at 0.5 A', '5 V ± 2 %'],
  ],
  fields: DCDC_FIELDS,
  start: { l: 22e-6, c: 47e-6, fs: 50e3, duty: LIGHT.vout / LIGHT.vin },
  autoDuty: () => LIGHT.vout / LIGHT.vin,
  evaluate(d) {
    const base = { vin: LIGHT.vin, l: d.l, c: d.c, fs: d.fs, duty: d.duty }
    const full = simulateDcdc('buck', { ...base, r: LIGHT.vout / LIGHT.full })
    const light = simulateDcdc('buck', { ...base, r: LIGHT.vout / LIGHT.light })
    const vr = full.m.voutPP / full.m.voutAvg
    const k = light.m.ilPP / (2 * LIGHT.light)
    const checks: Check[] = [
      voutCheck('buck', full.m, LIGHT.vin, LIGHT.vout, d.duty, 'Output voltage, full load'),
      {
        id: 'vout-ripple',
        label: 'Output ripple, full load',
        limit: '≤ 1 % of Vout',
        value: `${formatSI(full.m.voutPP, 'V')} = ${pctTxt(vr, 2)}`,
        sim: vr,
        verdict: upper(vr, 0.01),
        hint: vr <= 0.01 ? margin(vr, 0.01) : `ΔVout ∝ ΔiL/(C·fs): raise C·fs by ×${(vr / 0.01).toFixed(2)} (e.g. C ≥ ${formatSI((d.c * vr) / 0.01, 'F')}).`,
      },
      {
        id: 'ccm-light',
        label: 'Conduction mode at 0.5 A',
        limit: 'CCM',
        value: light.m.mode,
        sim: light.m.mode === 'CCM' ? 1 : 0,
        verdict: light.m.mode === 'CCM' ? 'pass' : 'fail',
        hint:
          light.m.mode === 'CCM'
            ? `Lowest iL at 0.5 A: ${formatA(light.m.ilMin)}.`
            : `At 0.5 A iL reaches zero. CCM needs ΔiL < 2·IL = 1 A; ΔiL ∝ 1/(L·fs), so raise L·fs by ×${k.toFixed(2)} or more — e.g. L ≥ ${uH(d.l * k)} at this fs.`,
      },
      voutCheck('buck', light.m, LIGHT.vin, LIGHT.vout, d.duty, 'Output voltage at 0.5 A'),
    ]
    return {
      checks,
      verdict: overall(checks),
      used: [['Duty simulated', pctTxt(d.duty, 1)]],
      runs: [
        { kind: 'dcdc', label: 'Full load, 3 A', run: full.run, m: full.m },
        { kind: 'dcdc', label: 'Standby, 0.5 A', run: light.run, m: light.m },
      ],
    }
  },
  link: (d) => ({ lab: 'dc-dc', topic: 'buck', query: q({ vin: LIGHT.vin, r: LIGHT.vout / LIGHT.light, l: d.l, c: d.c, fs: d.fs, duty: d.duty }) }),
}

// ── Rectifier capacitor filter ──────────────────────────────────────────────

/** The filter bench: single-phase bridge, 12 V rms 50 Hz, R = 20 Ω; real diodes 0.7 V + 0.1 Ω (incl. winding). */
export const FILTER = { vrms: 12, f: 50, r: 20, vf: 0.7, ron: 0.1, ripple: 0.1, vdcMin: 14, inrush: 22, cycles: 6 }

/** The filter hint's next capacitance: scale by the ripple ratio (ripple ∝ 1/C), plus 20 % because a large ripple falls slower than 1/C. */
export const nextFilterC = (c: number, ripple: number) => c * (ripple / FILTER.ripple) * 1.2

export function simulateFilter(c: number): { result: SimulationResult; m: Measurements; inrush: number } {
  const p: LabParams = {
    ...DEFAULT_PARAMS,
    source: { vrms: FILTER.vrms, frequency: FILTER.f, phaseDeg: 0 },
    diode: { model: 'real', vf: FILTER.vf, ron: FILTER.ron },
    load: { ...DEFAULT_PARAMS.load, resistance: FILTER.r, capacitance: c },
    sim: { ...DEFAULT_PARAMS.sim, cycles: FILTER.cycles },
  }
  const result = runSimulation(p, 'bridge:RC')
  const m = measure(result)
  // switch-on surge: the largest diode current of the whole run (the capacitor starts discharged, at vin = 0)
  let inrush = 0
  for (const d of result.trace.diodes) for (let i = 0; i < d.current.length; i++) inrush = Math.max(inrush, d.current[i])
  return { result, m, inrush }
}

const filterSpec: DesignSpec = {
  id: 'rect-filter',
  title: 'Rectifier smoothing capacitor',
  brief: 'Bridge rectifier: ripple ≤ 10 %, Vdc ≥ 14 V, surge ≤ 22 A',
  story: 'A 12 V transformer and a diode bridge feed a 20 Ω load. Choose the smoothing capacitor: big enough to keep the ripple down, small enough that the switch-on surge does not destroy the diodes. The supply is switched on at a zero crossing, with the capacitor empty.',
  given: [
    ['Transformer secondary', '12 V rms, 50 Hz'],
    ['Load', 'R = 20 Ω'],
    ['Diodes (incl. winding)', '0.7 V + 0.1 Ω each'],
    ['Switch-on', 'at a zero crossing, capacitor empty'],
  ],
  requirements: [
    ['Output ripple (p-p)', '≤ 10 % of Vdc'],
    ['Average output Vdc', '≥ 14 V'],
    ['Switch-on surge (diode peak)', `≤ ${FILTER.inrush} A`],
  ],
  fields: [{ key: 'c', label: 'Capacitance C', unit: 'µF', scale: 1e-6, min: 100, max: 20000, step: 10 }],
  start: { c: 1000e-6 },
  evaluate(d) {
    const { result, m, inrush } = simulateFilter(d.c)
    const rip = m.ripplePP / m.voutAvg
    const k = rip / FILTER.ripple
    const checks: Check[] = [
      {
        id: 'ripple',
        label: 'Output ripple (p-p)',
        limit: '≤ 10 % of Vdc',
        value: `${formatSI(m.ripplePP, 'V')} = ${pctTxt(rip)}`,
        sim: rip,
        verdict: upper(rip, FILTER.ripple, 0.2),
        hint: rip <= FILTER.ripple ? margin(rip, FILTER.ripple) : `The capacitor alone feeds R between the peaks, so the ripple falls roughly as 1/C — a little slower while it is large. Try C ≈ ${formatSI(nextFilterC(d.c, rip), 'F')} (×${k.toFixed(2)} plus 20 %).`,
      },
      {
        id: 'vdc',
        label: 'Average output Vdc',
        limit: '≥ 14 V',
        value: formatSI(m.voutAvg, 'V'),
        sim: m.voutAvg,
        verdict: lower(m.voutAvg, FILTER.vdcMin),
        hint: m.voutAvg >= FILTER.vdcMin ? `Peak minus half the ripple: ${formatSI(m.voutPeak, 'V')} − ${formatSI(m.ripplePP / 2, 'V')}.` : `Vdc sits about half the ripple below the peak (${formatSI(m.voutPeak, 'V')}): less ripple — more C — raises it.`,
      },
      {
        id: 'inrush',
        label: 'Switch-on surge (diode peak)',
        limit: `≤ ${FILTER.inrush} A`,
        value: formatA(inrush),
        sim: inrush,
        verdict: upper(inrush, FILTER.inrush, 0.15),
        hint:
          inrush <= FILTER.inrush
            ? `${margin(inrush, FILTER.inrush)} Steady-state diode peak: ${formatA(m.idPeak)}.`
            : `At switch-on the empty capacitor follows the rising sine and draws i ≈ C·dv/dt: the surge grows with C. Reduce C — about ×${(FILTER.inrush / inrush).toFixed(2)} — or, in a real design, add a series resistor or NTC.`,
      },
    ]
    return { checks, verdict: overall(checks), used: [['Simulated', `${FILTER.cycles} cycles from switch-on`]], runs: [{ kind: 'rect', label: 'Switch-on and steady state', result, m }] }
  },
  link: () => ({ lab: 'rectifiers', topic: '1ph-bridge', query: { load: 'RC' } }),
}

export const SPECS: DesignSpec[] = [
  dcdcSpec({
    id: 'buck-48-12',
    kind: 'buck',
    title: 'Buck converter',
    story: 'A 12 V, 5 A supply for a motor controller, from a 48 V battery. Size the inductor, the output capacitor and the switching frequency.',
    vin: 48,
    vout: 12,
    io: 5,
    ilRipple: 0.3,
    voutRipple: 0.01,
    ipk: 6,
    start: { l: 22e-6, c: 10e-6, fs: 50e3, duty: 0.25 },
  }),
  dcdcSpec({
    id: 'boost-12-24',
    kind: 'boost',
    title: 'Boost converter',
    story: 'Double a 12 V supply to 24 V for a 2 A LED string. In a boost the inductor carries the input current, so it is larger than the load current.',
    vin: 12,
    vout: 24,
    io: 2,
    ilRipple: 0.4,
    voutRipple: 0.02,
    ipk: 5,
    start: { l: 15e-6, c: 10e-6, fs: 50e3, duty: 0.5 },
  }),
  lightSpec,
  filterSpec,
]
