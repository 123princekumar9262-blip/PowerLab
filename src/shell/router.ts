import { useEffect, useState } from 'react'
import type { ModeId } from '../catalogue/catalogue.ts'
import { MODE_ORDER } from '../catalogue/catalogue.ts'

/**
 * A small hash router (no dependency). Routes:
 *   #/home  #/labs  #/labs/:lab  #/labs/:lab/:topic  #/labs/:lab/:topic/:mode  (+ ?query)
 *   #/engineering  #/engineering/:area  #/progress  #/settings
 * Legacy module hashes (#dcdc, #engineering …) redirect to their new homes. Navigation pushes a history
 * entry (Back works); redirects and in-workspace selection updates replace it.
 */
export type Route =
  | { page: 'home' }
  | { page: 'labs' }
  | { page: 'lab'; lab: string; query: Record<string, string> }
  | { page: 'workspace'; lab: string; topic: string; mode: ModeId; query: Record<string, string> }
  | { page: 'engineering'; area: string | null }
  | { page: 'progress' }
  | { page: 'settings' }
  | { page: 'notfound'; path: string }

/** Old module hashes → their new routes. `#engineering` was the losses-and-thermal lab. */
export const LEGACY: Record<string, string> = {
  dcdc: '#/labs/dc-dc',
  pwm: '#/labs/pwm',
  inverters: '#/labs/inverters',
  devices: '#/labs/devices',
  drives: '#/labs/drives',
  magnetics: '#/labs/magnetics',
  control: '#/labs/control',
  ev: '#/labs/ev',
  engineering: '#/labs/thermal?moved=engineering',
  rectifiers: '#/labs/rectifiers',
}

const isMode = (m: string): m is ModeId => (MODE_ORDER as string[]).includes(m)

function parseQuery(q: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!q) return out
  for (const part of q.split('&')) {
    if (!part) continue
    const [k, v = ''] = part.split('=')
    out[decodeURIComponent(k)] = decodeURIComponent(v)
  }
  return out
}

/** The canonical hash a raw hash should be replaced by (redirects), or null when it is already canonical. */
export function redirectFor(hash: string): string | null {
  const h = hash.replace(/^#/, '')
  if (h === '' || h === '/') return '#/home'
  if (!h.startsWith('/')) {
    const key = h.split(/[/?]/)[0]
    return LEGACY[key] ?? null
  }
  return null
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const [path, q = ''] = raw.split('?')
  const query = parseQuery(q)
  const seg = path.split('/').filter(Boolean)
  const [a, b, c, d] = seg
  if (a === 'home' && seg.length === 1) return { page: 'home' }
  if (a === 'labs') {
    if (!b) return { page: 'labs' }
    if (!c) return { page: 'lab', lab: b, query }
    if (seg.length <= 4 && (!d || isMode(d))) return { page: 'workspace', lab: b, topic: c, mode: (d as ModeId | undefined) ?? 'explore', query }
  }
  if (a === 'engineering' && seg.length <= 2) return { page: 'engineering', area: b ?? null }
  if (a === 'progress' && seg.length === 1) return { page: 'progress' }
  if (a === 'settings' && seg.length === 1) return { page: 'settings' }
  return { page: 'notfound', path: raw }
}

const qs = (query?: Record<string, string>) => {
  const e = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== '')
  return e.length ? `?${e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : ''
}

export const href = {
  home: () => '#/home',
  labs: () => '#/labs',
  lab: (lab: string) => `#/labs/${lab}`,
  workspace: (lab: string, topic: string, mode: ModeId = 'explore', query?: Record<string, string>) => `#/labs/${lab}/${topic}${mode === 'explore' ? '' : `/${mode}`}${qs(query)}`,
  engineering: (area?: string) => (area ? `#/engineering/${area}` : '#/engineering'),
  progress: () => '#/progress',
  settings: () => '#/settings',
}

export function buildHash(r: Route): string {
  switch (r.page) {
    case 'home':
      return href.home()
    case 'labs':
      return href.labs()
    case 'lab':
      return `${href.lab(r.lab)}${qs(r.query)}`
    case 'workspace':
      return href.workspace(r.lab, r.topic, r.mode, r.query)
    case 'engineering':
      return href.engineering(r.area ?? undefined)
    case 'progress':
      return href.progress()
    case 'settings':
      return href.settings()
    case 'notfound':
      return `#${r.path}`
  }
}

/** Go somewhere (a new history entry: Back returns here). */
export function navigate(hash: string): void {
  if (window.location.hash === hash) return
  window.location.hash = hash
}

/** Update the address without a new history entry (redirects, workspace selection changes). */
export function replace(hash: string): void {
  if (window.location.hash === hash) return
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/**
 * The current route and a navigation counter; applies redirects on load and on every hash change.
 * The counter changes on every navigation, so a page keyed by it starts fresh even when the address
 * equals one it showed before (a workspace may have quietly updated its own address meanwhile).
 */
export function useRoute(): { route: Route; nav: number } {
  const read = () => {
    const red = redirectFor(window.location.hash)
    if (red) window.history.replaceState(null, '', red)
    return parseRoute(window.location.hash)
  }
  const [state, setState] = useState(() => ({ route: read(), nav: 0 }))
  useEffect(() => {
    const on = () => setState((s) => ({ route: read(), nav: s.nav + 1 }))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return state
}

/**
 * Replace the workspace address silently (no re-render through the router): the workspace already
 * shows what the address now says.
 */
export function replaceQuietly(hash: string): void {
  if (window.location.hash === hash) return
  window.history.replaceState(null, '', hash)
}
