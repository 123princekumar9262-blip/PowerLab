import type { Source } from './types.ts'

/** The official documents the mapping is based on (read in full; excerpts in evidence.ts). */
export const SOURCES: Source[] = [
  {
    id: 'gate-ee-2027',
    syllabus: 'gate-ee',
    title: 'GATE 2027 Syllabus — Electrical Engineering (EE)',
    issuer: 'IIT Madras (organising institute)',
    version: 'GATE 2027 (the organising institute notes that the 2027 syllabi were revised)',
    url: 'https://gate2027.iitm.ac.in/static/doc/GATE2027_Syllabus/EE_GATE2027_Syllabus.pdf',
    retrieved: '2026-10-13',
  },
  {
    id: 'vit-eee-2023',
    syllabus: 'vit-eee',
    title: 'B.Tech. Electrical and Electronics Engineering (B.Tech. EEE) — CBCS Curriculum (2023–2024)',
    issuer: 'VIT, School of Electrical Engineering',
    version: 'Curriculum 2023–2024, syllabus version 1.0 (the version published on vit.ac.in, uploaded January 2026)',
    url: 'https://vit.ac.in/wp-content/uploads/2026/01/EEE-2023.pdf',
    retrieved: '2026-10-13',
    note: 'If the 2026 course handout for BEEE304L or BEEE306L differs, the mapping should be updated to it.',
  },
]

/**
 * The VIT courses this student takes (Discipline Core). A topic named only in an elective (BEEE401E, BEEE402L,
 * BEEE404L, BEEE406L) is shown as supplementary for this student, with the elective named.
 */
export const VIT_STUDENT_COURSES = ['BEEE304L', 'BEEE306L']
export const VIT_COURSE_TITLES: Record<string, string> = {
  BEEE304L: 'Power Systems Engineering',
  BEEE306L: 'Power Systems Analysis',
  BEEE401E: 'Power Systems Protection and Switchgear (elective)',
  BEEE402L: 'Power Systems Operation and Control (elective)',
  BEEE404L: 'High Voltage Engineering (elective)',
  BEEE406L: 'FACTS and HVDC (elective)',
}
