import { describe, expect, it } from 'vitest'
import { PS_MODULES } from '../src/powersys/catalog.ts'
import { inPath, isTaught, pathSummary, pathTopics, statusFor } from '../src/powersys/syllabus/coverage.ts'
import { GATE_EE_2027, VIT_EEE_2023 } from '../src/powersys/syllabus/evidence.ts'
import { SOURCES, VIT_STUDENT_COURSES } from '../src/powersys/syllabus/sources.ts'
import { TOPICS } from '../src/powersys/syllabus/topics.ts'

/*
 * The syllabus mapping is evidence, not opinion: every verified or partial status quotes the official wording, and
 * that wording must really be in the official text (evidence.ts, extracted from the documents in sources.ts).
 */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('Syllabus mapping — evidence', () => {
  it('two official sources, each with a URL, a version and a retrieval date', () => {
    expect(SOURCES.map((s) => s.syllabus).sort()).toEqual(['gate-ee', 'vit-eee'])
    for (const s of SOURCES) {
      expect(s.url).toMatch(/^https:\/\/(gate2027\.iitm\.ac\.in|vit\.ac\.in)\//)
      expect(s.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(s.version.length).toBeGreaterThan(5)
    }
  })
  it('the stored excerpts hold the Power Systems section of GATE EE and the six VIT power-systems courses', () => {
    expect(GATE_EE_2027['6']).toMatch(/^Power Systems /)
    expect(Object.keys(VIT_EEE_2023).sort()).toEqual(['BEEE304L', 'BEEE306L', 'BEEE401E', 'BEEE402L', 'BEEE404L', 'BEEE406L'])
    expect(VIT_EEE_2023.BEEE304L.title).toBe('Power Systems Engineering')
    expect(VIT_EEE_2023.BEEE304L.modules['2']).toMatch(/^Transmission Line Parameters/)
    expect(VIT_EEE_2023.BEEE306L.modules['2']).toMatch(/^Load Flow Analysis/)
  })
  for (const t of TOPICS)
    it(`${t.id}: every verified or partial status quotes words that are really in the official text`, () => {
      for (const [ref, text] of [
        [t.gate, t.gate.where ? GATE_EE_2027[t.gate.where] : undefined],
        [t.vit, t.vit.where && t.vit.unit ? VIT_EEE_2023[t.vit.where]?.modules[t.vit.unit] : undefined],
      ] as const) {
        if (ref.status === 'verified' || ref.status === 'partial') {
          expect(ref.quote, `${t.id}: a ${ref.status} status needs a quote`).toBeTruthy()
          expect(text, `${t.id}: ${ref.where} ${ref.unit ?? ''} is in the excerpts`).toBeTruthy()
          expect(norm(text!).includes(norm(ref.quote!)), `${t.id}: “${ref.quote}” in ${ref.where} ${ref.unit ?? ''}`).toBe(true)
        } else expect(ref.note, `${t.id}: a ${ref.status} status says why`).toBeTruthy()
      }
    })
})

describe('Syllabus mapping — structure', () => {
  it('unique topic ids; prerequisites exist; every module named exists; planned topics say where they go', () => {
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length)
    for (const t of TOPICS) {
      for (const p of t.prerequisites)
        expect(
          TOPICS.some((x) => x.id === p),
          `${t.id} → ${p}`,
        ).toBe(true)
      if (t.module)
        expect(
          PS_MODULES.some((m) => m.id === t.module),
          `${t.id}: module ${t.module}`,
        ).toBe(true)
      if (!t.module || t.plannedIn) expect(t.plan, `${t.id}: a plan`).toBeTruthy()
    }
  })
  it('every built module (except the integrative Challenge) teaches at least one mapped topic', () => {
    for (const m of PS_MODULES.filter((x) => x.status === 'ready' && x.id !== 'challenge'))
      expect(
        TOPICS.some((t) => t.module === m.id),
        m.id,
      ).toBe(true)
  })
  it('a topic taught only in a VIT elective is supplementary for this student, with the elective named', () => {
    expect(VIT_STUDENT_COURSES).toEqual(['BEEE304L', 'BEEE306L'])
    const ed = TOPICS.find((t) => t.id === 'economic-dispatch')!
    const s = statusFor(ed, 'vit-eee')
    expect(s.status).toBe('supplementary')
    expect(s.elective).toMatch(/Operation and Control/)
    expect(statusFor(ed, 'gate-ee').status).toBe('verified')
    expect(
      statusFor(
        TOPICS.find((t) => t.id === 'line-inductance')!,
        'vit-eee',
      ).status,
    ).toBe('verified')
  })
  it('the learning paths: GATE and VIT differ; Combined is their union; counts add up', () => {
    const gate = pathTopics('gate-ee').map((t) => t.id)
    const vit = pathTopics('vit-eee').map((t) => t.id)
    const both = pathTopics('combined').map((t) => t.id)
    expect(gate).toContain('economic-dispatch')
    expect(vit).not.toContain('economic-dispatch') // an elective for this student
    expect(vit).toContain('sag-tension')
    expect(gate).not.toContain('sag-tension')
    expect(new Set(both)).toEqual(new Set([...gate, ...vit]))
    for (const p of ['gate-ee', 'vit-eee', 'combined'] as const) {
      const s = pathSummary(p)
      expect(s.taught + s.planned).toBe(s.named)
      expect(pathTopics(p).every((t) => inPath(t, p))).toBe(true)
    }
    expect(TOPICS.filter(isTaught).every((t) => PS_MODULES.find((m) => m.id === t.module)?.status === 'ready')).toBe(true)
  })
})
