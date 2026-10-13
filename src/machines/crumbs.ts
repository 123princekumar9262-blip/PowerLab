import { homeOfMachine, subjectById, topicHref } from '../catalogue/subjects.ts'
import { href } from '../shell/router.ts'

/**
 * Breadcrumbs of the 3D Machines Lab's pages, by subject: Subjects › subject › topic › page. A model sits in the
 * topic that is its home (most in Electrical Machines & Drives; the power semiconductors and the inductor in
 * Power Electronics). The catalogue-wide pages (all models, compare, checks) sit directly under the subject.
 */
type Crumb = { label: string; href?: string }
const machinesSubject = (): Crumb[] => {
  const s = subjectById('machines')!
  return [
    { label: 'Subjects', href: href.home() },
    { label: s.title, href: href.subject(s.id) },
  ]
}
export function machineCrumbs(id: string, label: string): Crumb[] {
  const home = homeOfMachine(id)
  if (!home) return [...machinesSubject(), { label: 'All 3D models', href: href.machines() }, { label }]
  return [
    { label: 'Subjects', href: href.home() },
    { label: home.subject.title, href: href.subject(home.subject.id) },
    { label: home.topic.title, href: topicHref(home.subject, home.topic) },
    { label },
  ]
}
export const catalogueCrumbs = (page?: string): Crumb[] => (page ? [...machinesSubject(), { label: 'All 3D models', href: href.machines() }, { label: page }] : [...machinesSubject(), { label: 'All 3D models' }])
