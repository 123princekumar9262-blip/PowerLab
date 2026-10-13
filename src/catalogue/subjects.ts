import { MACHINES } from '../machines/catalog.ts'
import { GUIDE } from '../guide/content.ts'
import { LABS, type Lab } from './catalogue.ts'
import { href } from '../shell/router.ts'
import { PS_GROUPS, PS_MODULES } from '../powersys/catalog.ts'

/**
 * THE SUBJECT REGISTRY — the platform organised by subject: Subject → topic → the resources that exist.
 *
 * It adds no content and duplicates nothing: a topic only REFERENCES existing circuit labs (catalogue.ts),
 * existing 3D models (machines/catalog.ts) and Power Systems modules (powersys/catalog.ts) by id. Every count shown anywhere is computed from those sources, so
 * it cannot drift from what really exists. Each lab and each 3D model has exactly one canonical home (its topic);
 * `related` adds cross-links to resources whose home is elsewhere (tests/subjects.test.ts checks all of this).
 */

export type SubjectId = 'power-electronics' | 'machines' | 'power-systems'

export interface SubjectTopic {
  id: string
  title: string
  /** One line: what the topic is about. */
  line: string
  /** Group heading on the subject page. */
  group: string
  /** Circuit labs whose canonical home is this topic. A Power Electronics topic that is one lab uses that lab's title. */
  labs?: string[]
  /** 3D models whose canonical home is this topic. */
  machines?: string[]
  /** Power Systems modules whose home is this topic (the topic's page is the module's page). */
  modules?: string[]
  /** Cross-links to resources whose home is another topic (no counts are taken from these). */
  related?: { labs?: string[]; workspaces?: Array<{ lab: string; topic: string }>; machines?: string[] }
}

export interface Subject {
  id: SubjectId
  title: string
  /** One short paragraph: what the subject covers. */
  description: string
  /** What a student learns, in a few plain phrases. */
  learn: string[]
  groups: string[]
  topics: SubjectTopic[]
}

export const SUBJECTS: Subject[] = [
  {
    id: 'power-electronics',
    title: 'Power Electronics',
    description: 'How electronic switches convert electrical power: AC to DC, DC to DC and DC to AC — the circuits, the devices and magnetics inside them, their control, losses and applications.',
    learn: ['how rectifiers, converters and inverters work, instant by instant', 'how to read their waveforms and predict their values', 'how devices, magnetics, control and heat limit a design'],
    groups: ['AC to DC', 'DC to DC', 'DC to AC', 'Devices, magnetics and control', 'Losses and applications'],
    topics: [
      { id: 'rectifiers', title: 'Rectifiers', line: 'AC → DC with diodes and thyristors', group: 'AC to DC', labs: ['rectifiers'] },
      { id: 'dc-dc', title: 'DC-DC Converters', line: 'Step a DC voltage down or up with a switch', group: 'DC to DC', labs: ['dc-dc'] },
      { id: 'inverters', title: 'Inverters', line: 'DC → AC for motors and the grid', group: 'DC to AC', labs: ['inverters'] },
      { id: 'pwm', title: 'PWM', line: 'How switching signals are made', group: 'DC to AC', labs: ['pwm'] },
      {
        id: 'devices',
        title: 'Switching Devices',
        line: 'Diodes, SCRs, MOSFETs, IGBTs, SiC and GaN',
        group: 'Devices, magnetics and control',
        labs: ['devices'],
        machines: ['power-diode', 'mosfet', 'igbt', 'scr'],
      },
      {
        id: 'magnetics',
        title: 'Magnetics',
        line: 'Inductors and transformers in converters',
        group: 'Devices, magnetics and control',
        labs: ['magnetics'],
        machines: ['inductor'],
        related: { machines: ['transformer'] },
      },
      { id: 'control', title: 'Control', line: 'Feedback loops that hold the output', group: 'Devices, magnetics and control', labs: ['control'] },
      { id: 'thermal', title: 'Losses & Thermal', line: 'Where the power goes and how hot it gets', group: 'Losses and applications', labs: ['thermal'] },
      { id: 'ev', title: 'EV Power Electronics', line: 'Battery, converters and drive in an electric car', group: 'Losses and applications', labs: ['ev'], related: { machines: ['sys-ev', 'sys-regen'] } },
    ],
  },
  {
    id: 'machines',
    title: 'Electrical Machines & Drives',
    description: 'How motors, generators and transformers are built and how they work — in interactive 3D you can take apart — and how drives control them.',
    learn: ['what every part of a machine is and does', 'the working principle of each machine, step by step', 'the equations behind speed, torque and voltage, and how a drive controls them'],
    groups: ['Rotating machines', 'Transformers', 'Drives and systems'],
    topics: [
      {
        id: 'dc-machines',
        title: 'DC machines',
        line: 'Brushed motor, generator, shunt, series and compound',
        group: 'Rotating machines',
        machines: ['dc-motor', 'dc-generator', 'dc-separately', 'dc-shunt', 'dc-series', 'dc-compound'],
        related: { workspaces: [{ lab: 'drives', topic: 'dc-motor' }] },
      },
      {
        id: 'induction',
        title: 'Induction machines',
        line: 'Squirrel-cage, wound-rotor and single-phase motors',
        group: 'Rotating machines',
        machines: ['induction-motor', 'wound-rotor', 'single-phase-induction'],
        related: { workspaces: [{ lab: 'drives', topic: 'induction' }] },
      },
      { id: 'synchronous', title: 'Synchronous machines', line: 'Synchronous motor and alternator', group: 'Rotating machines', machines: ['synchronous-motor', 'alternator'] },
      {
        id: 'special',
        title: 'Special machines',
        line: 'BLDC, PMSM, switched reluctance, stepper and servo',
        group: 'Rotating machines',
        machines: ['bldc', 'pmsm', 'srm', 'stepper', 'servo'],
        related: { workspaces: [{ lab: 'drives', topic: 'bldc' }, { lab: 'drives', topic: 'pmsm' }] },
      },
      {
        id: 'transformers',
        title: 'Transformers',
        line: 'Single-phase, three-phase and auto-transformers',
        group: 'Transformers',
        machines: ['transformer', 'transformer-3ph', 'autotransformer'],
        related: { workspaces: [{ lab: 'magnetics', topic: 'transformer' }] },
      },
      {
        id: 'drives',
        title: 'Drives and systems',
        line: 'Motor drives, and machines at work in complete systems',
        group: 'Drives and systems',
        labs: ['drives'],
        machines: ['sys-inverter-motor', 'sys-motor-load', 'sys-genset', 'sys-regen', 'sys-ev'],
        related: { labs: ['ev'] },
      },
    ],
  },
  {
    id: 'power-systems',
    title: 'Power Systems',
    description: 'Visualise the grid, understand the physics, solve the engineering: how power is generated, transmitted and delivered — phasors, per unit, faults, load flow and stability on networks you can operate.',
    learn: ['how a grid carries power from a power station to every consumer', 'the calculations engineers use: per unit, fault currents, load flow', 'why grids trip, how they stay stable and how frequency is held'],
    groups: PS_GROUPS,
    topics: PS_MODULES.map((m) => ({ id: m.id, title: m.short, line: m.line, group: m.group, modules: [m.id] })),
  },
]

/**
 * The practice activities that use a lab's circuits (verified in src/practice: Challenge, Reverse engineering and
 * Fault diagnosis run the rectifier engine; Design covers DC-DC converters and the rectifier filter). Interview
 * spans the whole subject and is listed on the subject page.
 */
export const PRACTICE_FOR: Record<string, string[]> = {
  rectifiers: ['challenge', 'reverse', 'fault', 'design'],
  'dc-dc': ['design'],
}

// ── lookups and real counts ───────────────────────────────────────────────────────────────────────────────────

export const subjectById = (id: string): Subject | undefined => SUBJECTS.find((s) => s.id === id)

/** The subject and topic that are the canonical home of a lab. */
export function homeOfLab(lab: string): { subject: Subject; topic: SubjectTopic } | undefined {
  for (const subject of SUBJECTS) for (const topic of subject.topics) if (topic.labs?.includes(lab)) return { subject, topic }
  return undefined
}
/** The subject and topic that are the canonical home of a 3D model. */
export function homeOfMachine(id: string): { subject: Subject; topic: SubjectTopic } | undefined {
  for (const subject of SUBJECTS) for (const topic of subject.topics) if (topic.machines?.includes(id)) return { subject, topic }
  return undefined
}

const labsOf = (t: SubjectTopic): Lab[] => (t.labs ?? []).map((id) => LABS.find((l) => l.id === id)).filter((l): l is Lab => !!l && l.status === 'ready')

/** What a topic (or a whole subject) really contains — counted from the catalogues. */
export interface Counts {
  /** Interactive circuit simulations (ready workspace topics of its labs; entry points not counted twice). */
  simulations: number
  /** Guided lessons in its labs. */
  lessons: number
  /** Lab-guide theory articles of its labs. */
  articles: number
  /** Interactive 3D models (ready) whose home is here. */
  models: number
  /** Interactive Power Systems modules (ready) whose home is here. */
  modules: number
}
export function topicCounts(t: SubjectTopic): Counts {
  const labs = labsOf(t)
  return {
    simulations: labs.reduce((n, l) => n + l.topics.filter((x) => x.status === 'ready' && !x.opens).length, 0),
    lessons: labs.reduce((n, l) => n + l.lessons, 0),
    articles: GUIDE.filter((a) => (t.labs ?? []).includes(a.lab)).length,
    models: (t.machines ?? []).filter((id) => MACHINES.find((m) => m.id === id)?.status === 'ready').length,
    modules: (t.modules ?? []).filter((id) => PS_MODULES.find((m) => m.id === id)?.status === 'ready').length,
  }
}
export function subjectCounts(s: Subject): Counts & { topics: number } {
  const sum = s.topics.map(topicCounts).reduce((a, c) => ({ simulations: a.simulations + c.simulations, lessons: a.lessons + c.lessons, articles: a.articles + c.articles, models: a.models + c.models, modules: a.modules + c.modules }), { simulations: 0, lessons: 0, articles: 0, models: 0, modules: 0 })
  return { ...sum, topics: s.topics.length }
}
/** The labs whose home is in a subject (for its progress). */
export const subjectLabs = (s: Subject): Lab[] => s.topics.flatMap(labsOf)
/** The 3D models whose home is in a subject. */
export const subjectMachines = (s: Subject): string[] => s.topics.flatMap((t) => t.machines ?? [])

/** The subject a lab belongs to, as a link to its overview (the workspace header shows it). */
export function subjectOf(lab: string): { href: string; label: string } | undefined {
  const h = homeOfLab(lab)
  return h && { href: href.subject(h.subject.id), label: h.subject.title }
}

/** Where a topic opens: its lab's own page when it is one Power Electronics lab; otherwise its topic page. */
export function topicHref(s: Subject, t: SubjectTopic): string {
  if (s.id === 'power-electronics' && t.labs?.length === 1) return href.lab(t.labs[0])
  return href.subject(s.id, t.id)
}
