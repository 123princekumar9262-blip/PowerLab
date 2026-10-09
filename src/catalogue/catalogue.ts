/**
 * THE CATALOGUE — the single source of truth for what the platform contains.
 *
 * Home, the Labs page, the lab landing pages, the learning path, the Engineering area, the progress
 * page and search all render from this file. Nothing here imports a simulation engine: the catalogue
 * is plain data, so the first screen loads without any physics.
 *
 * Honesty rule: a `ready` item must open a working workspace. `tests/catalogue.test.ts` fails if a
 * ready topic has no workspace behind it, if a lesson count drifts from the real lessons, or if a
 * coming-soon item links into a workspace.
 */

export type Status = 'ready' | 'in-development' | 'coming-soon'
export type Category = 'conversion' | 'foundations' | 'systems'
export type ModeId = 'explore' | 'learn' | 'experiment' | 'predict' | 'challenge' | 'reverse' | 'compare'

/** The global order of the learning modes (only the applicable ones are shown). */
export const MODE_ORDER: ModeId[] = ['explore', 'learn', 'experiment', 'predict', 'challenge', 'reverse', 'compare']
/** The everyday modes of a circuit workspace (tabs); the others are practice modes behind "More". */
export const PRIMARY_MODES: ModeId[] = ['explore', 'learn', 'experiment', 'predict']
/** A lab's modes split into the workspace's tabs and its "More" menu, labelled and described. */
export function workspaceModes(ids: ModeId[]) {
  const label = (m: ModeId) => ({ id: m, label: MODE_LABEL[m], hint: MODE_HINT[m] })
  return { modes: ids.filter((m) => PRIMARY_MODES.includes(m)).map(label), moreModes: ids.filter((m) => !PRIMARY_MODES.includes(m)).map(label) }
}
export const MODE_LABEL: Record<ModeId, string> = {
  explore: 'Explore',
  learn: 'Learn',
  experiment: 'Experiment',
  predict: 'Predict',
  challenge: 'Challenge',
  reverse: 'Reverse',
  compare: 'Compare',
}
/** What each mode is for, in plain words (Home, the workspace guide, the mode tabs' tooltips). */
export const MODE_HINT: Record<ModeId, string> = {
  explore: 'change any value and watch the circuit respond',
  learn: 'short guided lessons, one step at a time',
  experiment: 'change one thing and compare the results',
  predict: 'guess the result first, then let the simulation check it',
  challenge: 'design tasks scored by the simulation',
  reverse: 'work out a hidden circuit from its waveforms',
  compare: 'two circuits side by side',
}

export const CATEGORY_LABEL: Record<Category, string> = { conversion: 'Conversion', foundations: 'Foundations', systems: 'Systems' }
/** Each group in one plain sentence (Home and the Labs page). */
export const CATEGORY_LINE: Record<Category, string> = {
  conversion: 'Circuits that turn one kind of electrical power into another: AC to DC, DC to DC, DC to AC.',
  foundations: 'The parts inside every converter: the switch, the magnetic core and the feedback loop.',
  systems: 'Converters at work: driving a motor, staying cool, moving an electric car.',
}
export const CATEGORY_ORDER: Category[] = ['conversion', 'foundations', 'systems']

/** Rectifier circuit selection carried by a topic (the rectifier workspace's own vocabulary). */
export interface RectifierSelection {
  topology: 'half-wave' | 'center-tap' | 'bridge' | 'semi-bridge' | '3ph-half-wave' | '3ph-bridge' | '3ph-half-controlled'
  device: 'diode' | 'scr'
}

export interface Topic {
  id: string
  title: string
  /** Full name where the landing-page section is not around to disambiguate (Continue, Recent, breadcrumb, search). */
  name?: string
  /** Compact label for the topic tabs inside a workspace (defaults to the title). */
  short?: string
  /** One line: what you see in it. */
  purpose: string
  status: Status
  /** Section heading on the lab landing page. */
  section: string
  /** Rectifier lab only: which circuit this topic opens. */
  rectifier?: RectifierSelection
  /**
   * Entry points: a topic that opens ANOTHER topic's workspace with a starting point (query) or a
   * mode. `opens` is the workspace topic id (in this lab, or `lab/topic` in another lab).
   */
  opens?: string
  mode?: ModeId
  query?: Record<string, string>
  keywords?: string[]
}

export interface Lab {
  id: string
  title: string
  category: Category
  /** One-line purpose (cards). */
  tagline: string
  /** One-sentence description (landing page). */
  description: string
  status: Status
  /** Position on the recommended learning path (1 = first). */
  path: number
  /** Learning modes this lab's workspace offers, in MODE_ORDER. */
  modes: ModeId[]
  /** Guided lessons available in the lab (validated against the real lessons by a test). */
  lessons: number
  /** Workspace topic opened by "Start" / quick start. */
  start: string
  /** Order of the sections on the landing page. */
  sections: string[]
  topics: Topic[]
  /** A visual system chain shown on the landing page (EV). */
  chain?: string[]
  keywords: string[]
  /** Short glyph for cards (text, no icon font). */
  glyph: string
  related?: string[]
}

const FIVE: ModeId[] = ['explore', 'learn', 'experiment', 'predict']

export const LABS: Lab[] = [
  {
    id: 'rectifiers',
    title: 'Rectifiers',
    category: 'conversion',
    tagline: 'AC → DC with diodes and thyristors',
    description: 'Understand how diodes and controlled devices convert AC into DC — instant by instant.',
    status: 'ready',
    path: 1,
    modes: ['explore', 'learn', 'experiment', 'predict', 'challenge', 'reverse', 'compare'],
    lessons: 13,
    start: '1ph-half-wave',
    sections: ['Single-phase', 'Controlled (SCR)', 'Three-phase', 'Topics'],
    glyph: '⏚',
    keywords: ['rectifier', 'ac to dc', 'diode', 'bridge', 'scr', 'thyristor', 'ripple', 'piv'],
    related: ['dc-dc', 'inverters'],
    topics: [
      { id: '1ph-half-wave', title: 'Half-wave', name: 'Single-phase half-wave', purpose: 'One diode, one half-cycle', status: 'ready', section: 'Single-phase', rectifier: { topology: 'half-wave', device: 'diode' }, keywords: ['half wave', 'single diode'] },
      { id: '1ph-center-tap', title: 'Center-tapped', name: 'Single-phase center-tapped', purpose: 'Two windings, two diodes', status: 'ready', section: 'Single-phase', rectifier: { topology: 'center-tap', device: 'diode' }, keywords: ['center tap', 'full wave'] },
      { id: '1ph-bridge', title: 'Bridge', name: 'Single-phase bridge', purpose: 'Four diodes, both half-cycles', status: 'ready', section: 'Single-phase', rectifier: { topology: 'bridge', device: 'diode' }, keywords: ['full wave bridge', 'graetz'] },
      { id: '1ph-half-wave-scr', title: 'Half-wave controlled', name: 'Single-phase half-wave controlled', purpose: 'One SCR, fired at α', status: 'ready', section: 'Controlled (SCR)', rectifier: { topology: 'half-wave', device: 'scr' }, keywords: ['scr', 'thyristor', 'firing angle'] },
      { id: '1ph-semi', title: 'Semi-controlled bridge', name: 'Single-phase semi-controlled bridge', purpose: 'Two SCRs and two diodes', status: 'ready', section: 'Controlled (SCR)', rectifier: { topology: 'semi-bridge', device: 'scr' }, keywords: ['semi converter', 'half controlled', 'scr'] },
      { id: '1ph-bridge-scr', title: 'Fully controlled bridge', name: 'Single-phase fully controlled bridge', purpose: 'Four SCRs: the output can go negative', status: 'ready', section: 'Controlled (SCR)', rectifier: { topology: 'bridge', device: 'scr' }, keywords: ['full converter', 'scr', 'thyristor bridge'] },
      { id: '3ph-3pulse', title: '3-pulse', purpose: 'Three diodes on a star source', status: 'ready', section: 'Three-phase', rectifier: { topology: '3ph-half-wave', device: 'diode' }, keywords: ['three phase half wave', 'midpoint'] },
      { id: '3ph-6pulse', title: '6-pulse bridge', purpose: 'Six diodes, the highest and lowest phase', status: 'ready', section: 'Three-phase', rectifier: { topology: '3ph-bridge', device: 'diode' }, keywords: ['six pulse', 'three phase bridge'] },
      { id: '3ph-3pulse-scr', title: '3-pulse controlled', purpose: 'Three SCRs fired at α', status: 'ready', section: 'Three-phase', rectifier: { topology: '3ph-half-wave', device: 'scr' }, keywords: ['scr', 'three phase controlled'] },
      { id: '3ph-half-controlled', title: 'Half-controlled bridge', name: 'Three-phase half-controlled bridge', purpose: 'Three SCRs and three diodes', status: 'ready', section: 'Three-phase', rectifier: { topology: '3ph-half-controlled', device: 'scr' }, keywords: ['semi converter', 'scr'] },
      { id: '3ph-bridge-scr', title: 'Fully controlled bridge', name: 'Three-phase fully controlled bridge', purpose: 'Six SCRs, the 6-pulse converter', status: 'ready', section: 'Three-phase', rectifier: { topology: '3ph-bridge', device: 'scr' }, keywords: ['scr', 'six pulse converter', 'thyristor bridge'] },
      { id: 'freewheeling', title: 'Freewheeling diode', purpose: 'Why the current keeps flowing', status: 'ready', section: 'Topics', opens: '1ph-half-wave', query: { load: 'RL', fw: '1' }, keywords: ['freewheeling diode', 'flywheel diode', 'why current continues', 'dfw', 'inductive load'] },
      { id: 'firing-angle', title: 'Firing angle α', purpose: 'Control the output by delaying the SCRs', status: 'ready', section: 'Topics', opens: '1ph-bridge-scr', query: { load: 'RL', alpha: '45' }, keywords: ['firing angle', 'alpha', 'phase control', 'scr'] },
      { id: 'commutation', title: 'Commutation overlap μ', purpose: 'Source inductance slows the hand-over', status: 'ready', section: 'Topics', opens: '3ph-6pulse', query: { load: 'RL', ls: '2', sheet: 'commutation' }, keywords: ['commutation overlap', 'overlap angle', 'mu', 'source inductance'] },
      { id: 'compare', title: 'Compare two rectifiers', purpose: 'Side by side, on a declared basis', status: 'ready', section: 'Topics', opens: '1ph-bridge', mode: 'compare', keywords: ['compare', 'single phase vs three phase'] },
    ],
  },
  {
    id: 'dc-dc',
    title: 'DC-DC Converters',
    category: 'conversion',
    tagline: 'Control a DC voltage with a switch',
    description: 'Learn how switches, inductors and capacitors transfer and control energy.',
    status: 'ready',
    path: 2,
    modes: FIVE,
    lessons: 5,
    start: 'buck',
    sections: ['Basic converters', 'Advanced converters'],
    glyph: '⎓',
    keywords: ['dc-dc', 'dc dc converter', 'smps', 'switch mode', 'duty cycle', 'inductor current', 'ccm', 'dcm'],
    related: ['pwm', 'control', 'magnetics'],
    topics: [
      { id: 'buck', title: 'Buck', name: 'Buck converter', purpose: 'Step a DC voltage down', status: 'ready', section: 'Basic converters', keywords: ['buck converter', 'step down', 'inductor current', 'ccm', 'dcm'] },
      { id: 'boost', title: 'Boost', name: 'Boost converter', purpose: 'Step a DC voltage up', status: 'ready', section: 'Basic converters', keywords: ['boost converter', 'step up'] },
      { id: 'buck-boost', title: 'Buck-boost', name: 'Inverting buck-boost converter', short: 'Buck-Boost', purpose: 'Up or down — and inverted', status: 'ready', section: 'Basic converters', keywords: ['buck boost', 'inverting'] },
      { id: 'cuk', title: 'Ćuk', purpose: 'Capacitive energy transfer', status: 'coming-soon', section: 'Advanced converters', keywords: ['cuk'] },
      { id: 'sepic', title: 'SEPIC', purpose: 'Non-inverting up/down', status: 'coming-soon', section: 'Advanced converters', keywords: ['sepic'] },
      { id: 'zeta', title: 'Zeta', purpose: 'The SEPIC’s dual', status: 'coming-soon', section: 'Advanced converters', keywords: ['zeta'] },
      { id: 'bidirectional', title: 'Bidirectional', purpose: 'Power flow both ways', status: 'coming-soon', section: 'Advanced converters', keywords: ['bidirectional'] },
    ],
  },
  {
    id: 'pwm',
    title: 'PWM',
    category: 'conversion',
    tagline: 'How switching signals are made',
    description: 'Understand duty cycle, frequency, average value, ripple and the spectrum of a switched signal.',
    status: 'ready',
    path: 3,
    modes: FIVE,
    lessons: 2,
    start: 'lab',
    sections: ['Fundamentals', 'Methods'],
    glyph: '⊓',
    keywords: ['pwm', 'pulse width modulation', 'duty cycle', 'carrier', 'spectrum', 'harmonics', 'thd', 'fft'],
    related: ['inverters', 'dc-dc'],
    topics: [
      { id: 'lab', title: 'PWM lab', purpose: 'Carrier, reference, sampling, spectrum', status: 'ready', section: 'Fundamentals', keywords: ['duty cycle', 'carrier', 'natural sampling', 'regular sampling', 'dead time', 'spectrum', 'thd', 'fft'] },
      { id: 'single-pulse', title: 'Single pulse (quasi-square)', purpose: 'In Inverters › Single-phase', status: 'ready', section: 'Methods', opens: 'inverters/1ph', keywords: ['single pulse', 'quasi square'] },
      { id: 'spwm', title: 'Sine-triangle (SPWM)', purpose: 'In Inverters › SPWM', status: 'ready', section: 'Methods', opens: 'inverters/spwm', keywords: ['spwm', 'sinusoidal pwm', 'bipolar', 'unipolar'] },
      { id: 'svpwm', title: 'Space vector (SVPWM)', purpose: 'In Inverters › SVPWM', status: 'ready', section: 'Methods', opens: 'inverters/svpwm', keywords: ['svpwm', 'space vector'] },
      { id: 'multi-pulse', title: 'Multiple pulse', purpose: 'Several equal pulses per half-cycle', status: 'coming-soon', section: 'Methods', keywords: ['multiple pulse'] },
    ],
  },
  {
    id: 'inverters',
    title: 'Inverters',
    category: 'conversion',
    tagline: 'DC → AC with a switching bridge',
    description: 'Convert DC into AC: first choose the circuit, then how it is switched.',
    status: 'ready',
    path: 4,
    modes: FIVE,
    lessons: 5,
    start: '1ph',
    sections: ['Circuit', 'Switching method'],
    glyph: '∿',
    keywords: ['inverter', 'dc to ac', 'h bridge', 'vsi', 'six step', 'harmonics', 'thd', 'spectrum'],
    related: ['pwm', 'drives'],
    topics: [
      { id: '1ph', title: 'Single-phase bridge', short: 'Single-phase', purpose: 'Half or full bridge, square or quasi-square', status: 'ready', section: 'Circuit', keywords: ['h bridge', 'full bridge', 'half bridge', 'square wave'] },
      { id: '3ph', title: 'Three-phase VSI (180° six-step)', short: 'Three-phase', purpose: 'Three legs, six steps per cycle', status: 'ready', section: 'Circuit', keywords: ['three phase inverter', 'vsi', 'six step', '180 degree'] },
      { id: 'spwm', title: 'SPWM', purpose: 'Sine-triangle PWM, single- or three-phase', status: 'ready', section: 'Switching method', keywords: ['spwm', 'sinusoidal pwm', 'bipolar', 'unipolar', 'thd'] },
      { id: 'svpwm', title: 'SVPWM', purpose: 'Space vectors and dwell times (three-phase)', status: 'ready', section: 'Switching method', keywords: ['svpwm', 'space vector', 'hexagon'] },
      { id: '120', title: '120° conduction', purpose: 'Two legs conduct at a time', status: 'coming-soon', section: 'Switching method', keywords: ['120 degree'] },
    ],
  },
  {
    id: 'devices',
    title: 'Switching Devices',
    category: 'foundations',
    tagline: 'What happens inside a switch',
    description: 'Understand the semiconductor switch: how it turns on and off, and what that costs.',
    status: 'ready',
    path: 5,
    modes: FIVE,
    lessons: 1,
    start: 'mosfet',
    sections: ['Devices'],
    glyph: '⊣',
    keywords: ['mosfet', 'switching', 'miller plateau', 'double pulse test', 'gate', 'switching loss', 'device'],
    related: ['thermal'],
    topics: [
      { id: 'mosfet', title: 'MOSFET', name: 'MOSFET switching', short: 'MOSFET switching', purpose: 'Switching transients: the Miller plateau', status: 'ready', section: 'Devices', keywords: ['mosfet', 'double pulse', 'miller', 'gate resistance', 'eon', 'eoff'] },
      { id: 'diode', title: 'Diode', purpose: 'I-V and reverse recovery', status: 'coming-soon', section: 'Devices', keywords: ['diode', 'reverse recovery'] },
      { id: 'scr', title: 'SCR', purpose: 'Latching and turn-off', status: 'coming-soon', section: 'Devices', keywords: ['scr', 'thyristor', 'latching'] },
      { id: 'igbt', title: 'IGBT', purpose: 'Tail current', status: 'coming-soon', section: 'Devices', keywords: ['igbt', 'tail current'] },
      { id: 'sic', title: 'SiC MOSFET', purpose: 'Wide band-gap switching', status: 'coming-soon', section: 'Devices', keywords: ['sic', 'silicon carbide'] },
      { id: 'gan', title: 'GaN HEMT', purpose: 'Very fast switching', status: 'coming-soon', section: 'Devices', keywords: ['gan', 'gallium nitride'] },
    ],
  },
  {
    id: 'magnetics',
    title: 'Magnetics',
    category: 'foundations',
    tagline: 'Inductors, flux and saturation',
    description: 'Understand how volt-seconds set the flux — and what happens when the core saturates.',
    status: 'ready',
    path: 6,
    modes: FIVE,
    lessons: 3,
    start: 'inductor',
    sections: ['Components'],
    glyph: '∾',
    keywords: ['magnetics', 'inductor', 'saturation', 'flux', 'air gap', 'core', 'volt seconds', 'inductor current'],
    related: ['dc-dc'],
    topics: [
      { id: 'inductor', title: 'Gapped inductor', purpose: 'Volt-seconds, DC bias, saturation', status: 'ready', section: 'Components', keywords: ['inductor', 'air gap', 'saturation', 'b-h', 'inrush'] },
      { id: 'transformer', title: 'Transformer', purpose: 'Coupled windings and magnetising current', status: 'coming-soon', section: 'Components', keywords: ['transformer'] },
    ],
  },
  {
    id: 'control',
    title: 'Control',
    category: 'foundations',
    tagline: 'Feedback that holds the output',
    description: 'Connect power electronics with feedback: PID loops, step responses, Bode plots and stability.',
    status: 'ready',
    path: 7,
    modes: FIVE,
    lessons: 4,
    start: 'buck',
    sections: ['Converter loops'],
    glyph: '↻',
    keywords: ['control', 'feedback', 'pid', 'pi', 'closed loop', 'open loop', 'bode', 'phase margin', 'small signal'],
    related: ['dc-dc'],
    topics: [
      { id: 'buck', title: 'Buck voltage loop', purpose: 'PID control of a buck converter', status: 'ready', section: 'Converter loops', keywords: ['closed loop buck', 'pid', 'bode', 'phase margin'] },
      { id: 'boost', title: 'Boost voltage loop', purpose: 'Control with a right-half-plane zero', status: 'ready', section: 'Converter loops', keywords: ['closed loop boost', 'rhp zero'] },
    ],
  },
  {
    id: 'drives',
    title: 'Drives & Motors',
    category: 'systems',
    tagline: 'Converters that turn machines',
    description: 'Connect converters to machines: speed, torque, start-up and braking.',
    status: 'ready',
    path: 8,
    modes: FIVE,
    lessons: 3,
    start: 'dc-motor',
    sections: ['Motors'],
    glyph: '⚙',
    keywords: ['drive', 'motor', 'dc motor', 'chopper', 'regenerative braking', 'back emf', 'torque', 'speed'],
    related: ['inverters', 'control'],
    topics: [
      { id: 'dc-motor', title: 'DC motor', name: 'DC motor drive', short: 'DC motor drive', purpose: 'One- and two-quadrant chopper drive', status: 'ready', section: 'Motors', keywords: ['dc motor', 'chopper', 'back emf', 'regeneration', 'inrush'] },
      { id: 'bldc', title: 'BLDC', purpose: 'Trapezoidal commutation', status: 'coming-soon', section: 'Motors', keywords: ['bldc', 'brushless'] },
      { id: 'pmsm', title: 'PMSM', purpose: 'Field-oriented control', status: 'coming-soon', section: 'Motors', keywords: ['pmsm', 'foc'] },
      { id: 'induction', title: 'Induction motor', purpose: 'Slip and V/f control', status: 'coming-soon', section: 'Motors', keywords: ['induction motor', 'v/f'] },
    ],
  },
  {
    id: 'thermal',
    title: 'Losses & Thermal',
    category: 'systems',
    tagline: 'Where the heat comes from and where it goes',
    description: 'Follow conduction and switching losses through the thermal path to the junction temperature.',
    status: 'ready',
    path: 9,
    modes: FIVE,
    lessons: 2,
    start: 'switch',
    sections: ['Losses and temperature'],
    glyph: '♨',
    keywords: ['losses', 'thermal', 'junction temperature', 'heatsink', 'zth', 'foster', 'conduction loss', 'switching loss', 'thermal runaway', 'power cycling'],
    related: ['devices'],
    topics: [
      { id: 'switch', title: 'Switch losses & junction temperature', short: 'Losses & thermal', purpose: 'Conduction, switching, Zth, heatsink, runaway', status: 'ready', section: 'Losses and temperature', keywords: ['junction temperature', 'heatsink', 'zth', 'thermal runaway', 'power cycling'] },
    ],
  },
  {
    id: 'ev',
    title: 'EV Power Electronics',
    category: 'systems',
    tagline: 'Battery → inverter → motor → wheels',
    description: 'Follow the energy of an electric car from the battery to the wheels — and back when braking.',
    status: 'ready',
    path: 10,
    modes: FIVE,
    lessons: 2,
    start: 'drivetrain',
    sections: ['System', 'Subsystems'],
    chain: ['Battery', 'DC link', 'Inverter', 'Motor', 'Wheels'],
    glyph: '⚡',
    keywords: ['ev', 'electric vehicle', 'battery', 'regeneration', 'drive cycle', 'range', 'consumption', '0-100'],
    related: ['drives', 'inverters'],
    topics: [
      { id: 'drivetrain', title: 'Drivetrain on a drive cycle', short: 'EV drivetrain', purpose: 'Energy, regeneration and range', status: 'ready', section: 'System', keywords: ['drive cycle', 'regenerative braking', 'range', 'consumption'] },
      { id: 'accel', title: '0–100 km/h', purpose: 'Torque-limited, then power-limited', status: 'ready', section: 'System', opens: 'drivetrain', query: { cycle: 'accel' }, keywords: ['acceleration', '0-100', 'top speed'] },
      { id: 'battery', title: 'Battery & BMS', purpose: 'Cells, state of charge, balancing', status: 'coming-soon', section: 'Subsystems', keywords: ['battery', 'bms', 'soc'] },
      { id: 'dcdc-stage', title: 'DC-DC stage', purpose: 'Boosting the battery to the DC link', status: 'coming-soon', section: 'Subsystems', keywords: ['dc link'] },
    ],
  },
]

export interface EngineeringArea {
  id: string
  title: string
  purpose: string
  description: string
  status: Status
  /** Where a ready area opens (a workspace route target). */
  opens?: { lab: string; topic: string; mode: ModeId }
  /** What exists already that a coming-soon area will build on. */
  foundation?: string
  keywords: string[]
}

export const ENGINEERING: EngineeringArea[] = [
  {
    id: 'design',
    title: 'Design',
    purpose: 'Requirement → design → validated result',
    description: 'Start from a specification (for example 48 V → 12 V, 10 A buck), choose the components, simulate, and validate: PASS, WARNING or FAIL.',
    status: 'coming-soon',
    foundation: 'The rectifier Challenge tasks already check a design against the simulation.',
    keywords: ['design', 'specification', 'converter design'],
  },
  {
    id: 'challenge',
    title: 'Challenge',
    purpose: 'Design tasks checked by the simulation',
    description: 'Nine rectifier design tasks — smooth the output, protect the diode, hit an exact voltage — scored by the simulation.',
    status: 'ready',
    opens: { lab: 'rectifiers', topic: '1ph-bridge', mode: 'challenge' },
    keywords: ['challenge', 'design task', 'stars'],
  },
  {
    id: 'reverse',
    title: 'Reverse Engineering',
    purpose: 'Identify a circuit from its waveforms',
    description: 'The circuit is hidden: read the source and output waveforms and work out which rectifier and load produced them.',
    status: 'ready',
    opens: { lab: 'rectifiers', topic: '1ph-bridge', mode: 'reverse' },
    keywords: ['reverse engineering', 'identify', 'hidden circuit'],
  },
  {
    id: 'fault',
    title: 'Fault Diagnosis',
    purpose: 'Find a hidden fault from the evidence',
    description: 'A circuit with a hidden fault: investigate the waveforms, currents and devices, then diagnose, explain and verify.',
    status: 'coming-soon',
    foundation: 'Fault injection (open/short devices, missing phase) already exists in Rectifiers › Experiment.',
    keywords: ['fault', 'diagnosis', 'troubleshooting', 'open diode', 'short'],
  },
  {
    id: 'interview',
    title: 'Interview',
    purpose: 'Question → simulate → answer → explanation',
    description: 'Power-electronics interview questions answered with the simulator: you answer first, then the simulation and the explanation.',
    status: 'coming-soon',
    foundation: 'Every lab’s Predict mode already asks a question and lets the simulation answer it.',
    keywords: ['interview', 'questions', 'placement'],
  },
]

/** Quick start: an intent → the workspace that answers it. */
export const QUICK_START: Array<{ label: string; lab: string; topic: string }> = [
  { label: 'Convert AC to DC', lab: 'rectifiers', topic: '1ph-bridge' },
  { label: 'Convert a DC voltage', lab: 'dc-dc', topic: 'buck' },
  { label: 'Generate AC', lab: 'inverters', topic: '1ph' },
  { label: 'Understand switching', lab: 'pwm', topic: 'lab' },
  { label: 'Control a motor', lab: 'drives', topic: 'dc-motor' },
  { label: 'EV power electronics', lab: 'ev', topic: 'drivetrain' },
]

/** Concepts for search: a term, its aliases, and where it is best seen. */
export const CONCEPTS: Array<{ term: string; aliases: string[]; lab: string; topic: string; note: string }> = [
  { term: 'Freewheeling diode', aliases: ['flywheel diode', 'why current continues', 'dfw'], lab: 'rectifiers', topic: 'freewheeling', note: 'Half-wave RL rectifier with the freewheeling diode fitted' },
  { term: 'SCR / thyristor', aliases: ['scr', 'thyristor', 'controlled rectifier'], lab: 'rectifiers', topic: '1ph-bridge-scr', note: 'Fully controlled bridge with SCRs' },
  { term: 'Commutation overlap', aliases: ['overlap angle', 'mu', 'source inductance'], lab: 'rectifiers', topic: 'commutation', note: '6-pulse bridge with source inductance' },
  { term: 'THD and harmonics', aliases: ['thd', 'harmonics', 'fft', 'spectrum', 'power quality'], lab: 'inverters', topic: 'spwm', note: 'Spectrum side tab (also in the PWM lab)' },
  { term: 'Inductor current', aliases: ['il', 'ripple current', 'ccm', 'dcm'], lab: 'dc-dc', topic: 'buck', note: 'Buck converter inductor current' },
  { term: 'Duty cycle', aliases: ['duty ratio', 'pulse width'], lab: 'pwm', topic: 'lab', note: 'PWM lab' },
  { term: 'Miller plateau', aliases: ['gate charge', 'switching transient'], lab: 'devices', topic: 'mosfet', note: 'MOSFET double-pulse test' },
  { term: 'Regenerative braking', aliases: ['regeneration', 'regen'], lab: 'drives', topic: 'dc-motor', note: 'Two-quadrant chopper (also in EV)' },
  { term: 'Core saturation', aliases: ['saturation', 'b-h curve', 'flux'], lab: 'magnetics', topic: 'inductor', note: 'Gapped inductor' },
  { term: 'Phase margin', aliases: ['bode', 'stability', 'crossover'], lab: 'control', topic: 'buck', note: 'Buck voltage loop, Bode tab' },
  { term: 'Junction temperature', aliases: ['tj', 'heatsink', 'thermal resistance', 'zth'], lab: 'thermal', topic: 'switch', note: 'Losses & thermal' },
]

// ── Lookups ─────────────────────────────────────────────────────────────────

export const labById = (id: string): Lab | undefined => LABS.find((l) => l.id === id)
export const topicOf = (lab: Lab, id: string): Topic | undefined => lab.topics.find((t) => t.id === id)
export const areaById = (id: string): EngineeringArea | undefined => ENGINEERING.find((a) => a.id === id)
export const labsByPath = (): Lab[] => [...LABS].sort((a, b) => a.path - b.path)

/** A topic's workspace target: an entry point resolves to the topic it opens (possibly in another lab). */
export function targetOf(lab: Lab, t: Topic): { lab: string; topic: string; mode?: ModeId; query?: Record<string, string> } {
  if (!t.opens) return { lab: lab.id, topic: t.id, mode: t.mode, query: t.query }
  const [a, b] = t.opens.includes('/') ? t.opens.split('/') : [lab.id, t.opens]
  return { lab: a, topic: b, mode: t.mode, query: t.query }
}

/** A topic's unambiguous name (outside its landing-page section). */
export const fullName = (t: Topic) => t.name ?? t.title

/** A workspace topic (not an entry point) — the ones a workspace can open directly. */
export const isWorkspaceTopic = (t: Topic) => !t.opens

/** Modes shown in a lab's workspace, in the global order. */
export const modesOf = (lab: Lab): ModeId[] => MODE_ORDER.filter((m) => lab.modes.includes(m))

/** The rectifier topic for a circuit selection (the workspace reports its circuit this way). */
export function rectifierTopicFor(sel: RectifierSelection): Topic | undefined {
  return labById('rectifiers')!.topics.find((t) => t.rectifier && t.rectifier.topology === sel.topology && t.rectifier.device === sel.device)
}
