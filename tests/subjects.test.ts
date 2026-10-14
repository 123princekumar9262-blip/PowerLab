import { describe, expect, it } from 'vitest'
import { LABS } from '../src/catalogue/catalogue.ts'
import { GUIDE } from '../src/guide/content.ts'
import { MACHINES } from '../src/machines/catalog.ts'
import { homeOfLab, homeOfMachine, subjectById, subjectCounts, SUBJECTS, topicCounts } from '../src/catalogue/subjects.ts'
import { PS_MODULES } from '../src/powersys/catalog.ts'

describe('Subject registry', () => {
  it('three subjects, stable ids, every topic in one of its groups, no empty topic', () => {
    expect(SUBJECTS.map((s) => s.id)).toEqual(['power-electronics', 'machines', 'power-systems'])
    for (const s of SUBJECTS) {
      expect(new Set(s.topics.map((t) => t.id)).size, s.id).toBe(s.topics.length)
      for (const g of s.groups) expect(s.topics.some((t) => t.group === g), `${s.id}: group ${g} has topics`).toBe(true)
      for (const t of s.topics) {
        expect(s.groups, `${s.id}/${t.id}`).toContain(t.group)
        const c = topicCounts(t)
        // a Power Systems module still marked planned opens a page that says so (and nothing else)
        const planned = t.modules?.length === 1 && PS_MODULES.find((m) => m.id === t.modules![0])?.status === 'planned'
        if (!planned) expect(c.simulations + c.models + c.modules, `${s.id}/${t.id} has something to open`).toBeGreaterThan(0)
      }
    }
  })

  it('every lab and every 3D model has exactly one canonical home — nothing orphaned, nothing duplicated', () => {
    for (const l of LABS) {
      const homes = SUBJECTS.flatMap((s) => s.topics.filter((t) => t.labs?.includes(l.id)))
      expect(homes.length, `lab ${l.id}`).toBe(1)
      expect(homeOfLab(l.id)?.topic.id).toBe(homes[0].id)
    }
    for (const m of MACHINES) {
      const homes = SUBJECTS.flatMap((s) => s.topics.filter((t) => t.machines?.includes(m.id)))
      expect(homes.length, `machine ${m.id}`).toBe(1)
      expect(homeOfMachine(m.id)?.topic.id).toBe(homes[0].id)
    }
  })

  it('references and cross-links point at things that exist (and are not the topic’s own)', () => {
    for (const s of SUBJECTS)
      for (const t of s.topics) {
        for (const id of [...(t.labs ?? []), ...(t.related?.labs ?? [])]) expect(LABS.some((l) => l.id === id), `${t.id}: lab ${id}`).toBe(true)
        for (const id of [...(t.machines ?? []), ...(t.related?.machines ?? [])]) expect(MACHINES.some((m) => m.id === id), `${t.id}: machine ${id}`).toBe(true)
        for (const w of t.related?.workspaces ?? []) expect(LABS.find((l) => l.id === w.lab)?.topics.some((x) => x.id === w.topic && x.status === 'ready'), `${t.id}: ${w.lab}/${w.topic}`).toBe(true)
        for (const id of t.related?.labs ?? []) expect(t.labs ?? [], `${t.id}: ${id} is not related to itself`).not.toContain(id)
        for (const id of t.related?.machines ?? []) expect(t.machines ?? []).not.toContain(id)
      }
  })

  it('counts are the real totals of the catalogues', () => {
    const all = SUBJECTS.map(subjectCounts)
    const sum = (k: 'simulations' | 'lessons' | 'articles' | 'models' | 'modules') => all.reduce((n, c) => n + c[k], 0)
    expect(sum('simulations')).toBe(LABS.reduce((n, l) => n + l.topics.filter((t) => t.status === 'ready' && !t.opens).length, 0))
    expect(sum('lessons')).toBe(LABS.reduce((n, l) => n + l.lessons, 0))
    expect(sum('articles')).toBe(GUIDE.length)
    expect(sum('models')).toBe(MACHINES.filter((m) => m.status === 'ready').length)
    expect(sum('modules')).toBe(PS_MODULES.filter((m) => m.status === 'ready').length)
    // the subjects as they are today
    expect(subjectCounts(subjectById('power-electronics')!)).toEqual({ topics: 9, simulations: 39, lessons: 73, articles: 45, models: 5, modules: 0 })
    expect(subjectCounts(subjectById('machines')!)).toEqual({ topics: 6, simulations: 4, lessons: 13, articles: 7, models: 24, modules: 0 })
    expect(subjectCounts(subjectById('power-systems')!)).toEqual({ topics: 15, simulations: 0, lessons: 0, articles: 0, models: 0, modules: 10 })
  })
})

describe('Subject pages link only to what exists', () => {
  it('every ready 3D model really has the features its topic page lists (Components · Disassembly · How it works · Calculate · Check)', async () => {
    const { MODEL_LOADERS } = await import('../src/machines/models/index.ts')
    for (const m of MACHINES.filter((x) => x.status === 'ready')) {
      const def = (await MODEL_LOADERS[m.id]()).default
      const defaults = Object.fromEntries(def.params.map((p) => [p.id, p.value]))
      expect(def.parts.length, `${m.id} components`).toBeGreaterThanOrEqual(5)
      expect(def.parts.some((p) => p.explode.some((x) => x !== 0)), `${m.id} disassembly`).toBe(true)
      expect(def.steps.length, `${m.id} how it works`).toBeGreaterThanOrEqual(4)
      expect(def.calc(defaults).length, `${m.id} calculate`).toBeGreaterThan(0)
      expect(def.quiz.length, `${m.id} check`).toBeGreaterThanOrEqual(4)
    }
  })
  it('each topic opens a real page: its lab’s own page (one lab, Power Electronics) or its topic page', async () => {
    const { topicHref } = await import('../src/shell/subjects.tsx')
    const { parseRoute } = await import('../src/shell/router.ts')
    for (const s of SUBJECTS)
      for (const t of s.topics) {
        const r = parseRoute(topicHref(s, t))
        if (r.page === 'lab') expect(LABS.some((l) => l.id === r.lab), `${t.id} → ${r.lab}`).toBe(true)
        else expect(r, `${s.id}/${t.id}`).toEqual({ page: 'subject', subject: s.id, topic: t.id, query: {} })
      }
    // power electronics: every topic is one lab's page; machines: every topic has its own page
    expect(subjectById('power-electronics')!.topics.every((t) => parseRoute(topicHref(subjectById('power-electronics')!, t)).page === 'lab')).toBe(true)
    expect(subjectById('machines')!.topics.every((t) => parseRoute(topicHref(subjectById('machines')!, t)).page === 'subject')).toBe(true)
    // power systems: every topic is one module's page
    expect(subjectById('power-systems')!.topics.every((t) => t.modules?.length === 1 && parseRoute(topicHref(subjectById('power-systems')!, t)).page === 'subject')).toBe(true)
  })
})

describe('Search knows the subjects', () => {
  it('finds subjects and machine topics by name, and every result names its subject', async () => {
    const { search } = await import('../src/catalogue/search.ts')
    const pe = search('power electronics')[0]
    expect(pe.kind).toBe('Subject')
    expect(pe.hash).toBe('#/subjects/power-electronics')
    const im = search('induction machines')[0]
    expect(im.kind).toBe('Topic')
    expect(im.hash).toBe('#/subjects/machines/induction')
    expect(im.subject).toBe('Electrical Machines & Drives')
    // a circuit, a 3D model that lives in Power Electronics, a 3D machine, a guide page
    expect(search('half-wave').find((r) => r.kind === 'Circuit')?.subject).toBe('Power Electronics')
    expect(search('mosfet').find((r) => r.kind === '3D model')?.subject).toBe('Power Electronics')
    expect(search('brushed dc motor').find((r) => r.kind === '3D model')?.subject).toBe('Electrical Machines & Drives')
    expect(search('drives').find((r) => r.kind === 'Lab' && r.title === 'Drives & Motors')?.subject).toBe('Electrical Machines & Drives')
    // nothing outside a subject except the subjects themselves
    const { searchIndex } = await import('../src/catalogue/search.ts')
    for (const e of searchIndex()) if (e.kind !== 'Subject') expect(e.subject, `${e.kind} ${e.title}`).toBeTruthy()
  })
})
