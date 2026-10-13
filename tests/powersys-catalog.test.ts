import { beforeEach, describe, expect, it } from 'vitest'
import { subjectById } from '../src/catalogue/subjects.ts'
import { PS_GROUPS, PS_MODULES, psModule } from '../src/powersys/catalog.ts'
import { MODULE_LOADERS } from '../src/powersys/modules/index.ts'
import { clearPsProgress, completeActivity, moduleProgress, PS_PROGRESS_KEY, reloadPsProgress, visitModule } from '../src/powersys/progress.ts'
import { PS_MODE_ORDER } from '../src/powersys/types.ts'
import { buildHash, href, parseRoute } from '../src/shell/router.ts'

describe('Power Systems module catalogue', () => {
  it('seven modules in order, unique ids, every group used, the subject’s topics are the modules', () => {
    expect(PS_MODULES.map((m) => m.id)).toEqual(['grid', 'three-phase', 'per-unit', 'faults', 'load-flow', 'stability', 'challenge'])
    expect(PS_MODULES.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const s = subjectById('power-systems')!
    expect(s.topics.map((t) => t.id)).toEqual(PS_MODULES.map((m) => m.id))
    expect(s.groups).toEqual(PS_GROUPS)
    for (const t of s.topics) expect(t.modules).toEqual([t.id])
  })
  it('every module has a page loader; a ready module has modes, activities and learning outcomes', () => {
    for (const m of PS_MODULES) {
      expect(typeof MODULE_LOADERS[m.id]).toBe('function')
      expect(m.modes.length).toBeGreaterThan(0)
      for (const md of m.modes) expect(PS_MODE_ORDER).toContain(md)
      if (m.status === 'ready') {
        expect(m.activities.length, m.id).toBeGreaterThan(0)
        expect(m.learn.length, m.id).toBeGreaterThan(0)
        for (const a of m.activities) expect(m.modes, `${m.id}/${a.id}`).toContain(a.mode)
        expect(new Set(m.activities.map((a) => a.id)).size).toBe(m.activities.length)
      }
    }
    // all seven modules are built (a planned module would open a 'planned' page instead)
    expect(PS_MODULES.filter((m) => m.status !== 'ready').map((m) => m.id)).toEqual([])
  })
  it('every ready module page loads and exports a component', async () => {
    for (const m of PS_MODULES.filter((x) => x.status === 'ready')) {
      const mod = await MODULE_LOADERS[m.id]()
      expect(typeof mod.default, m.id).toBe('function')
    }
  })
})

describe('Power Systems routes', () => {
  it('a module page keeps its mode in the query; the address round-trips', () => {
    const h = href.subject('power-systems', 'grid', { mode: 'experiment' })
    expect(h).toBe('#/subjects/power-systems/grid?mode=experiment')
    const r = parseRoute(h)
    expect(r).toEqual({
      page: 'subject',
      subject: 'power-systems',
      topic: 'grid',
      query: { mode: 'experiment' },
    })
    expect(buildHash(r)).toBe(h)
  })
})

describe('Power Systems progress', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    clearPsProgress()
  })
  it('records visits and completed activities, counts only the module’s own activities, and clears', () => {
    visitModule('grid', 'explore')
    completeActivity('grid', 'tour')
    completeActivity('grid', 'tour')
    completeActivity('grid', 'exp-peak') // a detail, not one of the module's activities
    const saved = JSON.parse(store.get(PS_PROGRESS_KEY)!)
    expect(saved.visited).toEqual(['grid'])
    expect(saved.last.module).toBe('grid')
    expect(saved.done).toEqual(['grid/tour', 'grid/exp-peak'])
    reloadPsProgress()
    expect(moduleProgress(saved, 'grid')).toEqual({
      done: 1,
      total: psModule('grid')!.activities.length,
    })
    clearPsProgress()
    expect(JSON.parse(store.get(PS_PROGRESS_KEY)!)).toEqual({
      visited: [],
      done: [],
      last: null,
    })
  })
  it('the platform’s Reset progress clears Power Systems progress too', async () => {
    completeActivity('grid', 'tour')
    const { clearProgress } = await import('../src/shell/progress.ts')
    clearProgress()
    expect(JSON.parse(store.get(PS_PROGRESS_KEY)!).done).toEqual([])
  })
})

describe('Search finds Power Systems', () => {
  it('the subject and its modules, by name and by keyword', async () => {
    const { search } = await import('../src/catalogue/search.ts')
    expect(search('power systems')[0].hash).toBe('#/subjects/power-systems')
    const g = search('grid explorer')[0]
    expect(g.hash).toBe('#/subjects/power-systems/grid')
    expect(g.subject).toBe('Power Systems')
    expect(search('single line diagram').some((r) => r.hash === '#/subjects/power-systems/grid')).toBe(true)
    expect(search('newton raphson').some((r) => r.hash === '#/subjects/power-systems/load-flow')).toBe(true)
  })
})
