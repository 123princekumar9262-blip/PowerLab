import { beforeEach, describe, expect, it } from 'vitest'
import { CONCEPTS, ENGINEERING, LABS, labById, labsByPath, MODE_ORDER, modesOf, rectifierTopicFor, targetOf, topicOf } from '../src/catalogue/catalogue.ts'
import { search } from '../src/catalogue/search.ts'
import { LESSONS } from '../src/learning/lessons.ts'
import { RECTIFIERS } from '../src/circuits/registry.ts'
import { buildHash, href, LEGACY, parseRoute, redirectFor } from '../src/shell/router.ts'
import { getLevel, reloadPrefs, setLevel } from '../src/shell/prefs.ts'
import { clearProgress, learningPath, recordActivity, reloadProgress } from '../src/shell/progress.ts'
import { LOADERS } from '../src/workspaces/index.ts'
import * as dcdc from '../src/workspaces/dcdc.tsx'
import * as pwm from '../src/workspaces/pwm.tsx'
import * as inverters from '../src/workspaces/inverters.tsx'
import * as devices from '../src/workspaces/devices.tsx'
import * as magnetics from '../src/workspaces/magnetics.tsx'
import * as control from '../src/workspaces/control.tsx'
import * as drives from '../src/workspaces/drives.tsx'
import * as thermal from '../src/workspaces/thermal.tsx'
import * as ev from '../src/workspaces/ev.tsx'
import type { AnyTopic } from '../src/lab/types.ts'

// Node has no localStorage: a minimal in-memory one (the stores read it through the guarded helpers)
if (!('localStorage' in globalThis)) {
  const m = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
}

/** The simulation topics behind each shell-based lab (what a READY topic must resolve to). */
const SHELL_TOPICS: Record<string, Record<string, AnyTopic>> = {
  'dc-dc': dcdc.TOPICS,
  pwm: pwm.TOPICS,
  inverters: inverters.TOPICS,
  devices: devices.TOPICS,
  magnetics: magnetics.TOPICS,
  control: control.TOPICS,
  drives: drives.TOPICS,
  thermal: thermal.TOPICS,
  ev: ev.TOPICS,
}

describe('router', () => {
  it('parses and builds every route form', () => {
    const forms = ['#/home', '#/labs', '#/labs/rectifiers', '#/labs/rectifiers/3ph-bridge-scr', '#/labs/rectifiers/3ph-bridge-scr/learn', '#/labs/dc-dc', '#/labs/dc-dc/buck', '#/engineering', '#/engineering/design', '#/engineering/interview', '#/progress', '#/settings']
    for (const h of forms) expect(buildHash(parseRoute(h))).toBe(h)
    expect(parseRoute('#/labs/rectifiers/1ph-half-wave?load=RL&fw=1')).toEqual({ page: 'workspace', lab: 'rectifiers', topic: '1ph-half-wave', mode: 'explore', query: { load: 'RL', fw: '1' } })
    expect(href.workspace('dc-dc', 'buck', 'learn', { lesson: 'how', step: '2' })).toBe('#/labs/dc-dc/buck/learn?lesson=how&step=2')
  })
  it('redirects the empty address and every legacy module hash', () => {
    expect(redirectFor('')).toBe('#/home')
    expect(redirectFor('#')).toBe('#/home')
    expect(redirectFor('#/')).toBe('#/home')
    expect(redirectFor('#dcdc')).toBe('#/labs/dc-dc')
    expect(redirectFor('#engineering')).toBe('#/labs/thermal?moved=engineering')
    for (const [k, v] of Object.entries(LEGACY)) {
      expect(redirectFor(`#${k}`)).toBe(v)
      const r = parseRoute(v)
      expect(r.page).toBe('lab')
      if (r.page === 'lab') expect(labById(r.lab)).toBeDefined()
    }
    expect(redirectFor('#/labs/dc-dc')).toBeNull()
  })
  it('unknown paths and modes are "not found", never a crash', () => {
    expect(parseRoute('#/nowhere').page).toBe('notfound')
    expect(parseRoute('#/labs/dc-dc/buck/fly').page).toBe('notfound')
    expect(parseRoute('#/labs/dc-dc/buck/learn/extra').page).toBe('notfound')
    expect(parseRoute('#nonsense').page).toBe('notfound')
  })
})

describe('catalogue honesty', () => {
  it('ten labs in three groups, on a learning path 1…10, Losses & Thermal is not "Engineering"', () => {
    expect(LABS.map((l) => l.id)).toEqual(['rectifiers', 'dc-dc', 'pwm', 'inverters', 'devices', 'magnetics', 'control', 'drives', 'thermal', 'ev'])
    expect(labsByPath().map((l) => l.id)).toEqual(['rectifiers', 'dc-dc', 'pwm', 'inverters', 'devices', 'magnetics', 'control', 'drives', 'thermal', 'ev'])
    expect(labById('thermal')!.title).toBe('Losses & Thermal')
    expect(LABS.some((l) => /engineering/i.test(l.title))).toBe(false)
  })
  it('every READY lab has a workspace loader, a start topic and at least one working entry', () => {
    for (const lab of LABS.filter((l) => l.status === 'ready')) {
      expect(LOADERS[lab.id], lab.id).toBeDefined()
      const start = topicOf(lab, lab.start)
      expect(start?.status, `${lab.id} start`).toBe('ready')
      expect(lab.topics.some((t) => t.status === 'ready'), lab.id).toBe(true)
    }
  })
  it('every READY topic opens a real workspace: a rectifier circuit or a simulation topic', () => {
    for (const lab of LABS)
      for (const t of lab.topics.filter((x) => x.status === 'ready')) {
        const tg = targetOf(lab, t)
        const target = labById(tg.lab)
        expect(target, `${lab.id}/${t.id}`).toBeDefined()
        const tt = topicOf(target!, tg.topic)
        expect(tt?.status, `${lab.id}/${t.id} → ${tg.lab}/${tg.topic}`).toBe('ready')
        expect(tt?.opens, 'an entry point opens a workspace topic, not another entry point').toBeUndefined()
        if (tg.mode) expect(target!.modes).toContain(tg.mode)
        if (tg.lab === 'rectifiers') {
          const sel = tt!.rectifier!
          expect(RECTIFIERS.some((r) => r.topology === sel.topology && r.device === sel.device), `${tg.topic}`).toBe(true)
        } else expect(SHELL_TOPICS[tg.lab][tg.topic], `${tg.lab}/${tg.topic} has no simulation topic`).toBeDefined()
      }
  })
  it('every rectifier circuit of the simulator is in the catalogue (nothing built is hidden)', () => {
    for (const r of RECTIFIERS) expect(rectifierTopicFor({ topology: r.topology, device: r.device }), r.key).toBeDefined()
  })
  it('coming-soon items never point into a workspace and have no simulation behind them', () => {
    for (const lab of LABS)
      for (const t of lab.topics.filter((x) => x.status !== 'ready')) {
        expect(t.opens).toBeUndefined()
        if (lab.id !== 'rectifiers') expect(SHELL_TOPICS[lab.id]?.[t.id]).toBeUndefined()
      }
    for (const a of ENGINEERING) {
      if (a.status === 'ready') expect(a.opens).toBeDefined()
      else expect(a.opens).toBeUndefined()
    }
  })
  it('lesson counts match the real lessons; modes follow the global order', () => {
    expect(labById('rectifiers')!.lessons).toBe(LESSONS.length)
    for (const [labId, topics] of Object.entries(SHELL_TOPICS)) {
      const real = Object.values(topics).reduce((s, t) => s + t.lessons.length, 0)
      expect(labById(labId)!.lessons, labId).toBe(real)
    }
    for (const lab of LABS) expect(modesOf(lab)).toEqual(MODE_ORDER.filter((m) => lab.modes.includes(m)))
  })
  it('concepts point at ready topics', () => {
    for (const c of CONCEPTS) expect(topicOf(labById(c.lab)!, c.topic)?.status, c.term).toBe('ready')
  })
})

describe('search', () => {
  const top = (q: string) => search(q)[0]
  it('finds the brief’s examples in the right place', () => {
    expect(top('freewheeling diode').hash).toBe('#/labs/rectifiers/1ph-half-wave?load=RL&fw=1')
    expect(top('buck converter').hash).toBe('#/labs/dc-dc/buck')
    expect(top('SVPWM').hash).toBe('#/labs/inverters/svpwm')
    expect(top('commutation overlap').hash).toContain('#/labs/rectifiers/3ph-6pulse')
    expect(search('SCR').some((r) => r.context.startsWith('Rectifiers'))).toBe(true)
    expect(search('THD').length).toBeGreaterThan(0)
    expect(search('inductor current').some((r) => r.hash === '#/labs/dc-dc/buck')).toBe(true)
    expect(search('why current continues')[0].title).toMatch(/Freewheeling/)
  })
  it('one result per destination; coming-soon results lead to the landing page; nothing outside the app', () => {
    const r = search('freewheeling')
    expect(new Set(r.map((x) => x.hash)).size).toBe(r.length)
    const cuk = search('cuk')[0]
    expect(cuk.status).toBe('coming-soon')
    expect(cuk.hash).toBe('#/labs/dc-dc')
    expect(search('weather in paris')).toEqual([])
  })
})

describe('preferences and progress', () => {
  beforeEach(() => {
    localStorage.clear()
    reloadPrefs()
    reloadProgress()
  })
  it('the information level persists and migrates the rectifier lab’s saved density', () => {
    expect(getLevel()).toBe('beginner')
    setLevel('engineer')
    reloadPrefs()
    expect(getLevel()).toBe('engineer')
    localStorage.clear()
    localStorage.setItem('rectifier-lab.density', JSON.stringify({ d: 'standard' }))
    reloadPrefs()
    expect(getLevel()).toBe('standard')
  })
  it('continue / recent / learning path follow the activity; the path only recommends', () => {
    let path = learningPath()
    expect(path.find((p) => p.state === 'recommended')!.lab.id).toBe('rectifiers')
    recordActivity({ lab: 'dc-dc', topic: 'buck', mode: 'learn', title: 'Buck', labTitle: 'DC-DC Converters', lesson: { id: 'how', title: 'How a buck converter works', step: 2, of: 6 } })
    recordActivity({ lab: 'rectifiers', topic: '3ph-6pulse', mode: 'explore', title: '6-pulse bridge', labTitle: 'Rectifiers', query: { load: 'R' } })
    reloadProgress()
    path = learningPath()
    expect(path.find((p) => p.lab.id === 'dc-dc')!.state).toBe('started')
    // all rectifier lessons done → rectifiers completed, DC-DC recommended next
    localStorage.setItem('rectifier-lab.lessons', JSON.stringify({ done: LESSONS.map((l) => l.id) }))
    path = learningPath()
    expect(path[0].state).toBe('done')
    expect(path.find((p) => p.state === 'recommended')!.lab.id).toBe('dc-dc')
    clearProgress()
    expect(learningPath().every((p) => p.state !== 'done')).toBe(true)
  })
})
