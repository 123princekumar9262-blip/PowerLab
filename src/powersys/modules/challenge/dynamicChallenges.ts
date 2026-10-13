import { fx } from '../../ui/format.ts'
import { FREQ0, rocof0, simulateFrequency, steadyStateHz, type FreqParams } from '../stability/frequency.ts'
import { deg, simulateSwing, SMIB0, summarise, type SmibParams } from '../stability/swing.ts'
import { num, type Challenge, type State } from './types.ts'

/*
 * Challenges solved with the dynamic models of Module 6: the swing equation of a generator connected by two lines
 * (rotor-angle stability) and the single-area frequency model. Every verdict is decided by simulating.
 */

// ── 1 · is the protection fast enough? ─────────────────────────────────────────────────────────────────────────

const RELAYS = [
  { id: 'idmt', label: 'Overcurrent (IDMT)', time: 0.3, cost: 1 },
  { id: 'distance', label: 'Distance, zone 1', time: 0.025, cost: 2 },
  { id: 'differential', label: 'Line differential', time: 0.02, cost: 3 },
]
const BREAKERS = [
  { id: 'c5', label: '5-cycle (100 ms)', time: 0.1, cost: 1 },
  { id: 'c3', label: '3-cycle (60 ms)', time: 0.06, cost: 2 },
  { id: 'c2', label: '2-cycle (40 ms)', time: 0.04, cost: 3 },
]
const CCT_PLANT: SmibParams = { ...SMIB0, Pm: 0.95, fault: 'bus' }
const MARGIN = 0.8
let tcrCache: number | null = null
/** The plant's critical clearing time, by simulation (computed once). */
const tcr = () => (tcrCache ??= summarise(CCT_PLANT).tcrSim)
const relayOf = (s: State) => RELAYS.find((r) => r.id === s.relay)!
const breakerOf = (s: State) => BREAKERS.find((b) => b.id === s.breaker)!
const clearing = (s: State) => relayOf(s).time + breakerOf(s).time
const costOf = (s: State) => relayOf(s).cost + breakerOf(s).cost
/** The cheapest relay + breaker that clears within the margin (ties: the faster). */
function cheapestValid() {
  const ok = RELAYS.flatMap((r) => BREAKERS.map((b) => ({ r, b, t: r.time + b.time, cost: r.cost + b.cost }))).filter((c) => c.t <= MARGIN * tcr() + 1e-12)
  return ok.sort((a, b) => a.cost - b.cost || a.t - b.t)[0]
}

export const CCT_CHALLENGE: Challenge = {
  id: 'cct',
  title: 'Is the protection fast enough?',
  line: 'Choose relay and breaker so the generator stays in step — at the lowest cost',
  brief: [
    `A power station exports ${fx(CCT_PLANT.Pm, 2)} pu over two parallel lines (H = ${CCT_PLANT.H} s, E′ = ${CCT_PLANT.E} pu, X′d + X_T = ${CCT_PLANT.Xg} pu, each line ${CCT_PLANT.Xl} pu). A three-phase fault on one line, close to the station, must be cleared by opening that line.`,
    'The clearing time is the relay’s operating time plus the breaker’s interrupting time. Faster equipment costs more (relative costs: relays 1/2/3, breakers 1/2/3).',
    `The planning standard asks for a ${fx((1 - MARGIN) * 100, 0)} % margin: the fault must be cleared within ${fx(MARGIN * 100, 0)} % of the critical clearing time. Choose the cheapest combination that meets it — the station must keep its full output.`,
  ],
  uses: ['stability', 'faults'],
  level: 'Advanced',
  controls: [
    {
      kind: 'choice',
      id: 'relay',
      label: 'Protection relay',
      options: RELAYS.map((r) => ({ id: r.id, label: r.label })),
      hint: 'operating time: IDMT 300 ms at this fault level · distance zone 1 25 ms · differential 20 ms',
    },
    { kind: 'choice', id: 'breaker', label: 'Circuit breaker', options: BREAKERS.map((b) => ({ id: b.id, label: b.label })) },
  ],
  initial: { relay: 'idmt', breaker: 'c5' },
  solution: { relay: 'distance', breaker: 'c3' },
  evaluate(s) {
    const tc = clearing(s)
    const run = simulateSwing({ ...CCT_PLANT, tc }, { kind: 'fault' }, { tEnd: 2, keepEvery: 5, dStop: 2 * Math.PI })
    const best = cheapestValid()
    const limit = MARGIN * tcr()
    return {
      objectives: [
        { id: 'stable', label: 'The generator stays in synchronism', ok: run.stable, detail: run.stable ? `first swing peaks at ${fx(deg(run.dPeak), 1)}°` : 'loses synchronism' },
        {
          id: 'margin',
          label: `Cleared within ${fx(MARGIN * 100, 0)} % of the critical clearing time`,
          ok: tc <= limit + 1e-12,
          detail: `${fx(tc * 1000, 0)} ms vs ${fx(limit * 1000, 1)} ms allowed (t_cr = ${fx(tcr() * 1000, 1)} ms)`,
        },
        { id: 'cost', label: 'The cheapest combination that meets the margin', ok: costOf(s) === best.cost && tc <= limit + 1e-12, detail: `cost ${costOf(s)}; cheapest that meets it: ${best.cost}` },
      ],
      measurements: [
        { label: 'Clearing time', value: fx(tc * 1000, 0), unit: 'ms', note: `${fx(relayOf(s).time * 1000, 0)} relay + ${fx(breakerOf(s).time * 1000, 0)} breaker` },
        { label: 'Critical clearing time', value: fx(tcr() * 1000, 1), unit: 'ms', note: 'by simulation' },
        { label: 'Peak rotor angle', value: run.stable ? fx(deg(run.dPeak), 1) : '> 180', unit: '°', tone: run.stable ? undefined : 'bad' },
        { label: 'Relative cost', value: String(costOf(s)) },
      ],
      plot: {
        label: 'Rotor angle after the fault',
        xLabel: 'Time [s]',
        yLabel: 'Rotor angle δ [°]',
        yDomain: [0, 200],
        series: [{ id: 'd', label: 'δ', color: 'var(--accent)', points: run.t.map((t, k) => [t, Math.min(deg(run.d[k]), 200)] as [number, number]) }],
        vlines: [{ x: tc, label: `cleared at ${fx(tc * 1000, 0)} ms` }],
        hlines: [{ y: 180, label: '180°' }],
      },
    }
  },
  hints: [
    `First find the time you have: what is the critical clearing time of this plant at ${fx(CCT_PLANT.Pm, 2)} pu output, and 80 % of it?`,
    'An overcurrent relay’s inverse-time delay is far too slow for a fault next to a generator. Which relays trip without intentional delay?',
    'With a fast relay, check each breaker in turn — the cheapest one whose total still fits within the margin is the answer.',
  ],
  debrief(s) {
    return [
      `Cleared in ${fx(clearing(s) * 1000, 0)} ms against a critical clearing time of ${fx(tcr() * 1000, 1)} ms. The rotor accelerates while the fault blocks its power; the faster the fault is cleared, the less kinetic energy it gains and the smaller the first swing.`,
      'Transmission protection is chosen for exactly this reason: instantaneous distance or differential protection with fast breakers on lines near large generators, inverse-time overcurrent only where clearing time does not threaten stability.',
    ]
  },
}

// ── 2 · keep the frequency up when the largest unit trips ──────────────────────────────────────────────────────

const LOSS = 0.12
const H_SYNC = 6
const NADIR_LIMIT = 0.4
const ROCOF_LIMIT = 1.0
const SS_LIMIT = 0.25
const SHARE_TARGET = 50

function freqParams(s: State): FreqParams {
  const share = num(s, 'share') / 100
  return { ...FREQ0, dPL: LOSS, H: H_SYNC * (1 - share) + num(s, 'hsc'), R: num(s, 'droop') / 100, D: FREQ0.D + num(s, 'ffr') }
}

export const FREQ_CHALLENGE: Challenge = {
  id: 'frequency',
  title: 'Survive the loss of the largest generator',
  line: 'Inertia, droop and fast frequency response in a low-inertia grid',
  brief: [
    `The largest generating unit — ${fx(LOSS * 100, 0)} % of demand — trips without warning. Synchronous machines give this system H = ${H_SYNC} s; inverter-based solar and wind give none, so H falls as their share grows.`,
    `The plan requires at least ${SHARE_TARGET} % inverter-based generation. The system’s first stage of under-frequency load shedding is set at ${fx(50 - NADIR_LIMIT, 1)} Hz; distributed generators trip on a rate of change above ${fx(ROCOF_LIMIT, 1)} Hz/s; and before secondary control acts the frequency must settle above ${fx(50 - SS_LIMIT, 2)} Hz.`,
    'Your tools: the inverter share, the governors’ droop, fast frequency response from batteries (an instant power response proportional to Δf) and synchronous condensers (inertia without generation).',
  ],
  uses: ['stability'],
  level: 'Advanced',
  controls: [
    { kind: 'slider', id: 'share', label: 'Inverter-based generation', min: 30, max: 80, step: 10, unit: '%', decimals: 0 },
    { kind: 'slider', id: 'droop', label: 'Governor droop R', min: 3, max: 8, step: 1, unit: '%', decimals: 0 },
    { kind: 'slider', id: 'ffr', label: 'Battery fast frequency response', min: 0, max: 10, step: 1, unit: 'pu/pu', decimals: 0, hint: 'adds to the load damping D' },
    { kind: 'slider', id: 'hsc', label: 'Synchronous condensers', min: 0, max: 1, step: 0.5, unit: 's of H', decimals: 1 },
  ],
  initial: { share: 60, droop: 8, ffr: 0, hsc: 0 },
  solution: { share: 50, droop: 4, ffr: 5, hsc: 0 },
  evaluate(s) {
    const p = freqParams(s)
    const run = simulateFrequency(p, { tEnd: 20, keepEvery: 5 })
    const rocof = rocof0(p)
    const ss = steadyStateHz(p)
    return {
      objectives: [
        { id: 'share', label: `At least ${SHARE_TARGET} % inverter-based generation`, ok: num(s, 'share') >= SHARE_TARGET, detail: `${fx(num(s, 'share'), 0)} %` },
        { id: 'rocof', label: `Rate of change of frequency within ${fx(ROCOF_LIMIT, 1)} Hz/s`, ok: Math.abs(rocof) <= ROCOF_LIMIT + 1e-9, detail: `${fx(rocof, 3)} Hz/s (H = ${fx(p.H, 1)} s)` },
        { id: 'nadir', label: `Lowest frequency above ${fx(50 - NADIR_LIMIT, 1)} Hz`, ok: -run.nadir <= NADIR_LIMIT, detail: `${fx(50 + run.nadir, 3)} Hz` },
        { id: 'ss', label: `Settles above ${fx(50 - SS_LIMIT, 2)} Hz before secondary control`, ok: -ss <= SS_LIMIT, detail: `${fx(50 + ss, 3)} Hz` },
      ],
      measurements: [
        { label: 'System inertia H', value: fx(p.H, 1), unit: 's' },
        { label: 'Initial RoCoF', value: fx(rocof, 3), unit: 'Hz/s', tone: Math.abs(rocof) > ROCOF_LIMIT + 1e-9 ? 'bad' : undefined },
        { label: 'Nadir', value: fx(50 + run.nadir, 3), unit: 'Hz', note: `at ${fx(run.tNadir, 2)} s`, tone: -run.nadir > NADIR_LIMIT ? 'bad' : undefined },
        { label: 'Settles at', value: fx(50 + ss, 3), unit: 'Hz', tone: -ss > SS_LIMIT ? 'warn' : undefined },
      ],
      plot: {
        label: 'Frequency after the trip',
        xLabel: 'Time [s]',
        yLabel: 'Frequency [Hz]',
        series: [{ id: 'f', label: 'f', color: 'var(--accent)', points: run.t.map((t, k) => [t, 50 + run.df[k]] as [number, number]) }],
        hlines: [
          { y: 50 - NADIR_LIMIT, label: `load shedding ${fx(50 - NADIR_LIMIT, 1)} Hz` },
          { y: 50 - SS_LIMIT, label: `settle limit ${fx(50 - SS_LIMIT, 2)} Hz` },
        ],
        yDomain: [49.1, 50.05],
      },
    }
  },
  hints: [
    'The first moments are set by inertia alone: RoCoF = −ΔP·f₀/(2H). Which controls change H?',
    'The governors then stop the fall: a smaller droop R means more response per hertz, and the steady value is −ΔP/(D + 1/R).',
    'Batteries respond within a fraction of a second — before the governors’ valves have moved — so they lift the nadir most.',
  ],
  debrief(s) {
    const p = freqParams(s)
    return [
      `With H = ${fx(p.H, 1)} s the initial fall is ${fx(-rocof0(p), 3)} Hz/s. Inertia only slows the fall; the governors (droop ${fx(p.R * 100, 0)} %) and the batteries are what stop it.`,
      'Grids with a high share of inverter-based generation keep frequency secure exactly this way: fast frequency response from batteries, tighter governor settings, and inertia from synchronous condensers or grid-forming inverters where RoCoF would otherwise be too high.',
    ]
  },
}

export const DYNAMIC_CHALLENGES = [CCT_CHALLENGE, FREQ_CHALLENGE]
