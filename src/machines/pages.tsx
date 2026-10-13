import { lazy, Suspense, useMemo, useState } from 'react'
import { Icon } from '../shell/icons.tsx'
import { href } from '../shell/router.ts'
import { Crumbs, PageHead } from '../shell/ui.tsx'
import { catalogueCrumbs, machineCrumbs } from './crumbs.ts'
import { FAMILY_LABEL, filterMachines, MACHINES, machineById, NO_FILTER, type MachineFilter } from './catalog.ts'
import { recentMachines } from './progress.ts'
import { TRAIT_LABEL, type Family, type MachineEntry, type TraitKey } from './types.ts'
import './styles/machines.css'

/** The workspace brings three.js: it loads only when a machine is opened. */
const Workspace = lazy(() => import('./Workspace.tsx'))

const LEVEL_TEXT = { beginner: 'Beginner', standard: 'Intermediate', engineer: 'Advanced' } as const
const LEVEL_CLASS = { beginner: 'beginner', standard: 'intermediate', engineer: 'advanced' } as const

export type MachinesView = { view: 'overview' } | { view: 'machine'; id: string; tab?: string } | { view: 'compare'; ids: string[] } | { view: 'checks' }

/** The 3D Machines Lab section (route #/machines…). */
export default function MachinesSection({ route }: { route: MachinesView }) {
  if (route.view === 'compare') return <ComparePage ids={route.ids} />
  if (route.view === 'checks') return <ChecksPage />
  if (route.view === 'machine') {
    const m = machineById(route.id)
    if (!m) return <Missing id={route.id} />
    if (m.status !== 'ready') return <PlannedPage m={m} />
    return (
      <Suspense fallback={<div className="ws-loading" role="status">Loading the 3D model of the {m.name}…</div>}>
        <Workspace key={`${m.id}:${route.tab ?? ''}`} entry={m} tab={route.tab} />
      </Suspense>
    )
  }
  return <Overview />
}

function Missing({ id }: { id: string }) {
  return (
    <div className="page page--narrow">
      <Crumbs items={catalogueCrumbs(id)} />
      <PageHead title="Not in the 3D Machines Lab" lead={`There is no machine “${id}”.`} />
      <p>
        <a className="btn" href={href.machines()}>
          ← All machines
        </a>
      </p>
    </div>
  )
}

/** A planned machine: listed honestly, with what exists today (a simulated circuit lab, if any). */
function PlannedPage({ m }: { m: MachineEntry }) {
  return (
    <div className="page page--narrow">
      <Crumbs items={machineCrumbs(m.id, m.name)} />
      <PageHead title={m.name} lead={m.summary} side={<span className="status status--coming-soon">Planned</span>} />
      <div className="soon-box">
        <p>
          <b>Planned.</b> The interactive 3D model of this {m.role === 'Static device' ? 'device' : 'machine'} is not built yet — nothing here pretends otherwise.
        </p>
        {m.simulatedIn && (
          <p>
            Available today: its circuit is simulated in <a href={href.workspace(m.simulatedIn.lab, m.simulatedIn.topic)}>{m.simulatedIn.label.replace(' (simulated)', '')}</a>.
          </p>
        )}
      </div>
      <p>
        <a className="btn" href={href.machines()}>
          ← All machines
        </a>
      </p>
    </div>
  )
}

function Overview() {
  const [f, setF] = useState<MachineFilter>(NO_FILTER)
  const list = useMemo(() => filterMachines(f), [f])
  const filtered = f.q !== '' || f.family !== 'all' || f.supply !== 'all' || f.role !== 'all' || f.level !== 'all'
  const ready = MACHINES.filter((m) => m.status === 'ready')
  const recommended = ready.filter((m) => m.recommended)
  const recent = recentMachines()
    .map((id) => machineById(id))
    .filter((m): m is MachineEntry => !!m && m.status === 'ready')
    .slice(0, 4)
  const set = (patch: Partial<MachineFilter>) => setF({ ...f, ...patch })
  const families = [...new Set(MACHINES.map((m) => m.family))] as Family[]
  return (
    <div className="page mx-page">
      <Crumbs items={catalogueCrumbs()} />
      <PageHead
        title="3D Machines Lab"
        lead="Take electrical machines and devices apart in 3D: see what each part is, follow how they work step by step, and connect the motion to the engineering relations. The models are simplified and the animations conceptual — each page says what is calculated and what is only illustrated."
      />
      <p className="mx-section-links">
        <a href={href.machines('compare')}>Compare machines</a>
        <a href={href.machines('checks')}>Knowledge checks</a>
        <span className="muted">
          {ready.length} interactive model{ready.length === 1 ? '' : 's'} · {MACHINES.length - ready.length} planned
        </span>
      </p>

      {recent.length > 0 && !filtered && (
        <section aria-labelledby="mx-recent">
          <h2 id="mx-recent" className="group-title">
            Recently explored
          </h2>
          <div className="tile-grid">{recent.map((m) => <MachineTile key={m.id} m={m} />)}</div>
        </section>
      )}
      {!filtered && recommended.length > 0 && (
        <section aria-labelledby="mx-rec">
          <h2 id="mx-rec" className="group-title">
            Start with
          </h2>
          <div className="tile-grid">{recommended.map((m) => <MachineTile key={m.id} m={m} />)}</div>
        </section>
      )}

      <section aria-labelledby="mx-all" className="mx-catalogue">
        <h2 id="mx-all" className="group-title">
          Catalogue
        </h2>
        <div className="mx-filters" role="search">
          <label className="mx-search">
            <Icon name="search" />
            <input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search machines and devices…" aria-label="Search machines and devices" />
          </label>
          <Select label="Family" value={f.family} onChange={(v) => set({ family: v as MachineFilter['family'] })} options={[['all', 'All families'], ...families.map((x) => [x, FAMILY_LABEL[x]] as [string, string])]} />
          <Select label="Supply" value={f.supply} onChange={(v) => set({ supply: v as MachineFilter['supply'] })} options={[['all', 'AC, DC or static'], ['AC', 'AC'], ['DC', 'DC'], ['Static', 'Static device']]} />
          <Select label="Role" value={f.role} onChange={(v) => set({ role: v as MachineFilter['role'] })} options={[['all', 'Any role'], ['Motor', 'Motor'], ['Generator', 'Generator'], ['Other', 'Other device or system']]} />
          <Select label="Level" value={f.level} onChange={(v) => set({ level: v as MachineFilter['level'] })} options={[['all', 'Any level'], ['beginner', 'Beginner'], ['standard', 'Intermediate'], ['engineer', 'Advanced']]} />
          {filtered && (
            <button className="text-btn" onClick={() => setF(NO_FILTER)}>
              Clear
            </button>
          )}
        </div>
        <p className="muted small" role="status">
          {list.length} of {MACHINES.length} shown · interactive models first
        </p>
        <div className="mx-list">
          {list.map((m) => (
            <MachineRow key={m.id} m={m} />
          ))}
          {list.length === 0 && <p className="muted">Nothing matches. Try another word or clear the filters.</p>}
        </div>
      </section>
    </div>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange(v: string): void; options: Array<[string, string]> }) {
  return (
    <label className="mx-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  )
}

function MachineTile({ m }: { m: MachineEntry }) {
  return (
    <a className="lab-tile" href={href.machines(m.id)}>
      <span className="lab-tile-head">
        <span className="lab-tile-title">{m.name}</span>
        <span className={`lvl lvl--${LEVEL_CLASS[m.level]}`}>{LEVEL_TEXT[m.level]}</span>
      </span>
      <span className="lab-tile-line">{m.summary}</span>
      <span className="lab-tile-meta">
        <span>
          {m.subgroup} · {m.supply === 'Static' ? 'static device' : `${m.supply} ${m.role.toLowerCase()}`}
        </span>
        <span className="lab-tile-open">
          Open 3D <Icon name="arrow" />
        </span>
      </span>
    </a>
  )
}

function MachineRow({ m }: { m: MachineEntry }) {
  const ready = m.status === 'ready'
  return (
    <a className={`mx-row ${ready ? '' : 'mx-row--planned'}`} href={href.machines(m.id)}>
      <span className="mx-row-main">
        <span className="mx-row-title">
          {m.name}
          {ready ? <span className="mx-avail mx-avail--ready">3D model</span> : <span className="mx-avail">Planned</span>}
        </span>
        <span className="mx-row-line">{m.summary}</span>
      </span>
      <span className="mx-row-tags">
        <span>{m.subgroup}</span>
        <span>{m.supply === 'Static' ? 'Static' : m.supply}</span>
        <span>{LEVEL_TEXT[m.level]}</span>
      </span>
    </a>
  )
}

// ── Compare ─────────────────────────────────────────────────────────────────

const TRAITS = Object.keys(TRAIT_LABEL) as TraitKey[]
const PAIRS: Array<[string, string]> = [
  ['dc-motor', 'bldc'],
  ['induction-motor', 'synchronous-motor'],
  ['dc-generator', 'alternator'],
  ['transformer', 'induction-motor'],
]

/** Side-by-side traits of 2–3 machines: qualitative words from the catalogue; no invented figures. */
function ComparePage({ ids }: { ids: string[] }) {
  const comparable = MACHINES.filter((m) => m.traits)
  const chosen = (ids.length >= 2 ? ids : PAIRS[0]).map((id) => machineById(id)).filter((m): m is MachineEntry => !!m && !!m.traits).slice(0, 3)
  const setAt = (k: number, id: string) => {
    const next = chosen.map((m) => m.id)
    next[k] = id
    window.location.hash = href.machines('compare', { m: next.filter(Boolean).join(',') })
  }
  return (
    <div className="page mx-page">
      <Crumbs items={catalogueCrumbs('Compare machines')} />
      <PageHead title="Compare machines" lead="Two or three machines side by side, by construction and behaviour. These are qualitative descriptions: different machines are not always comparable point by point, and no performance figures are invented." />
      <p className="mx-pairs">
        Suggested:{' '}
        {PAIRS.map(([a, b]) => (
          <a key={a + b} href={href.machines('compare', { m: `${a},${b}` })}>
            {machineById(a)?.name.split(' (')[0]} vs {machineById(b)?.name.split(' (')[0]}
          </a>
        ))}
      </p>
      <div className="mx-compare-pick">
        {[0, 1, 2].map((k) => (
          <label key={k} className="mx-select">
            <span>{k === 2 ? 'Third (optional)' : k === 0 ? 'First' : 'Second'}</span>
            <select value={chosen[k]?.id ?? ''} onChange={(e) => setAt(k, e.target.value)}>
              {k === 2 && <option value="">—</option>}
              {comparable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="mx-compare" style={{ gridTemplateColumns: `180px repeat(${chosen.length}, minmax(0, 1fr))` }} role="table" aria-label="Comparison">
        <div role="row" className="mx-compare-row mx-compare-head">
          <span role="columnheader" />
          {chosen.map((m) => (
            <span key={m.id} role="columnheader">
              <a href={href.machines(m.id)}>{m.name}</a>
              {m.status !== 'ready' && <span className="mx-avail">3D planned</span>}
            </span>
          ))}
        </div>
        {TRAITS.map((t) => (
          <div key={t} role="row" className="mx-compare-row">
            <span role="rowheader" className="mx-compare-th">{TRAIT_LABEL[t]}</span>
            {chosen.map((m) => (
              <span key={m.id} role="cell">
                {m.traits?.[t] ?? <span className="muted">—</span>}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Knowledge checks ────────────────────────────────────────────────────────

function ChecksPage() {
  const ready = MACHINES.filter((m) => m.status === 'ready')
  return (
    <div className="page mx-page">
      <Crumbs items={catalogueCrumbs('Knowledge checks')} />
      <PageHead title="Knowledge checks" lead="Short questions on each interactive model: identify a highlighted part, predict what happens, put the working sequence in order, match a relation. Each answer is explained." />
      <div className="tile-grid">
        {ready.map((m) => (
          <a key={m.id} className="lab-tile" href={href.machines(m.id, { tab: 'check' })}>
            <span className="lab-tile-head">
              <span className="lab-tile-title">{m.name}</span>
            </span>
            <span className="lab-tile-line">{m.summary}</span>
            <span className="lab-tile-meta">
              <span>{m.subgroup}</span>
              <span className="lab-tile-open">
                Start <Icon name="arrow" />
              </span>
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
