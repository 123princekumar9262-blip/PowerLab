import { useEffect, useMemo, useRef, useState } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Callout, Readouts, Seg, Slider, Toggle, useTutorContext } from '../../ui/kit.tsx'
import { DistributorDiagram, VoltageProfile } from './DistributorDiagram.tsx'
import { areaFor, defaultDc, FEED_LABEL, loopPerM, nodalDc, RHO, solveDc, type DcDistributor, type DcOk, type Feed } from './distributor.ts'
import { MODULE, tiny } from './shared.tsx'
import { changeWords, pctWords, placeWords } from './words.ts'

const FEED_SHORT: Record<Feed, string> = { one: 'one end', both: 'both ends', ring: 'ring main' }

interface Change {
  what: string
  from: string
  to: string
  before: DcOk | null
}

/** Explore: the DC distributor — feed it from one end, both ends or as a ring; move and resize its loads. */
export function DcLab() {
  const level = useLevel()
  const progress = usePsProgress()
  const [d, setD] = useState<DcDistributor>(() => defaultDc('one'))
  const [sel, setSel] = useState<string | null>('L4')
  const [change, setChange] = useState<Change | null>(null)
  const [seen, setSeen] = useState({ both: false, ring: false, moved: false })
  const r = useMemo(() => solveDc(d), [d])
  const ok = r.ok ? r : null
  const last = useRef<DcOk | null>(null)
  useEffect(() => {
    if (ok) last.current = ok
  }, [ok])

  const update = (what: string, from: string, to: string, next: DcDistributor) => {
    setChange({ what, from, to, before: ok ?? last.current })
    setD(next)
  }
  const load = d.loads.find((l) => l.id === sel) ?? null
  const setLoad = (patch: { I?: number; x?: number }) => {
    if (!load) return
    const what = patch.I !== undefined ? `Load ${load.id} current` : `Load ${load.id} position`
    const from = patch.I !== undefined ? `${fx(load.I, 0)} A` : `${fx(load.x, 0)} m`
    const to = patch.I !== undefined ? `${fx(patch.I, 0)} A` : `${fx(patch.x!, 0)} m`
    update(what, from, to, { ...d, loads: d.loads.map((l) => (l.id === load.id ? { ...l, ...patch } : l)) })
  }

  // the activity: both ends, ring, and moving the lowest point while fed from two sides
  useEffect(() => {
    setSeen((s) => {
      const n = { ...s }
      if (ok && d.feed === 'both') n.both = true
      if (ok && d.feed === 'ring') n.ring = true
      if (ok && change?.before && d.feed !== 'one' && change.what !== 'the feeding:' && Math.abs(change.before.minX - ok.minX) > 1e-9) n.moved = true
      return n.both === s.both && n.ring === s.ring && n.moved === s.moved ? s : n
    })
  }, [ok, d.feed, change])
  useEffect(() => {
    if (seen.both && seen.ring && seen.moved) completeActivity(MODULE, 'distributor')
  }, [seen])

  const nodal = useMemo(() => (ok && level === 'engineer' ? nodalDc(d) : null), [ok, d, level])
  const edited = JSON.stringify(d) !== JSON.stringify(defaultDc(d.feed))

  useTutorContext(() => {
    const loads = d.loads.map((l) => `${l.id} ${l.I} A at ${l.x} m`).join(', ')
    const res = ok
      ? `I_A = ${fx(ok.IA, 2)} A, I_B = ${fx(ok.IB, 2)} A, section currents ${ok.sections.map((s) => fx(s.Iin, 2)).join(', ')} A, lowest voltage ${fx(ok.minV, 3)} V ${placeWords(ok.minKind, ok.minX, ok.minIds, d.L)}, conductor loss ${fx(ok.loss, 1)} W.`
      : `Invalid: ${!r.ok ? r.message : ''}`
    return `Explore — DC distributor (two-wire). ${FEED_LABEL[d.feed]}; L = ${d.L} m; r = ${d.rCond} Ω/km per conductor (loop ${fx(2 * d.rCond, 3)} Ω/km); V_A = ${d.VA} V${d.feed === 'both' ? `, V_B = ${d.VB} V` : ''}; uniform load ${d.i} A/m; loads ${loads}. Result: ${res}`
  })

  const dropFrac = ok ? (d.VA - ok.minV) / d.VA : 0
  return (
    <div className="ps-stack">
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <section className="ps-card" aria-label="The distributor">
            <DistributorDiagram d={d} r={ok} selected={sel} onSelect={setSel} />
            {!r.ok && (
              <Callout tone="bad" title={r.field === 'collapse' ? 'These loads cannot be supplied' : 'Check the inputs'}>
                <p>{r.message}</p>
                <p>No voltages or currents are shown until the inputs are valid.</p>
              </Callout>
            )}
          </section>
          {ok && (
            <section className="ps-card" aria-label="Voltage along the distributor">
              <VoltageProfile d={d} r={ok} />
            </section>
          )}
          {ok && change && <ChangeNote c={change} now={ok} d={d} />}
          {ok && (
            <details className="ps-card ps-more" open={level !== 'beginner'}>
              <summary>Section by section: currents, loop resistances and drops</summary>
              <SectionTable d={d} r={ok} />
              <p className="ds-mistake">
                <b>Classic mistake:</b> using r (one conductor) instead of 2r (the loop). The current goes out on one conductor and comes back on the other, so every section’s drop is I × 2r × length
                — here {fx(loopPerM(d.rCond) * 1000, 3)} Ω per km of route.
              </p>
            </details>
          )}
          {ok && nodal && (
            <details className="ps-card ps-more" open>
              <summary>Check by nodal analysis (conductance matrix)</summary>
              <p className="small muted">
                {nodal.free.length} unknown node voltages, G·V = I; each section is a conductance 1/(2rℓ)
                {d.i > 0 ? ', a uniform load is shared half-and-half between the ends of its section (exact for the node voltages)' : ''}. Largest difference from the section-current method:{' '}
                {tiny(Math.max(...nodal.V.map((v, k) => Math.abs(v - ok.nodes[k].V))), 3)} V; feed currents {fx(nodal.IA, 4)} / {fx(nodal.IB, 4)} A.
              </p>
            </details>
          )}
        </div>
        <aside className="ps-stack">
          <section className="ps-card" aria-labelledby="ds-dc-h">
            <h3 id="ds-dc-h">Feed and load the distributor</h3>
            <Seg
              label="How the distributor is fed"
              value={d.feed}
              full
              onChange={(f: Feed) => update('the feeding:', FEED_SHORT[d.feed], FEED_SHORT[f], { ...d, feed: f })}
              options={[
                { id: 'one', label: 'One end' },
                { id: 'both', label: 'Both ends' },
                { id: 'ring', label: 'Ring main' },
              ]}
            />
            <div className="ds-loadpick" role="group" aria-label="Choose a load to change">
              <span className="small muted">Load:</span>
              <Seg label="Load to change" value={sel ?? ''} onChange={(id) => setSel(id)} options={d.loads.map((l) => ({ id: l.id, label: l.id }))} />
            </div>
            {load && (
              <>
                <Slider label={`${load.id} current`} value={load.I} min={0} max={200} step={5} unit="A" decimals={0} onChange={(v) => setLoad({ I: v })} />
                <Slider label={`${load.id} distance from A`} value={Math.min(load.x, d.L)} min={0} max={d.L} step={5} unit="m" decimals={0} onChange={(v) => setLoad({ x: v })} />
              </>
            )}
            {ok && (
              <Readouts
                label="Distributor result"
                items={[
                  { label: 'Lowest voltage', value: fx(ok.minV, 2), unit: 'V', note: `${pctWords(dropFrac)} drop below V_A` },
                  { label: 'Where', value: ok.minKind === 'between' ? `${fx(ok.minX, 1)} m` : `${fx(ok.minX, 0)} m`, note: placeWords(ok.minKind, ok.minX, ok.minIds, d.L) },
                  {
                    label: d.feed === 'one' ? 'Fed at A' : 'Fed at A · at B',
                    value: d.feed === 'one' ? fx(ok.IA, 1) : `${fx(ok.IA, 1)} · ${fx(ok.IB, 1)}`,
                    unit: 'A',
                    note: `total load ${fx(ok.totalLoad, 1)} A`,
                  },
                  {
                    label: 'Loss in the conductors',
                    value: fx(ok.loss, 0),
                    unit: 'W',
                    note: `${fx((ok.loss / (d.VA * ok.IA + (d.feed === 'one' ? 0 : (d.feed === 'ring' ? d.VA : d.VB) * ok.IB))) * 100, 2)} % of the power sent`,
                  },
                ]}
              />
            )}
            <div className="ds-btnrow">
              <button
                type="button"
                className="text-btn"
                disabled={!edited}
                onClick={() => {
                  setChange(null)
                  setD(defaultDc(d.feed))
                  setSel('L4')
                }}
              >
                Reset
              </button>
            </div>
          </section>
          <details className="ps-card ps-more" open={level !== 'beginner'}>
            <summary>Voltages, conductor, length and uniform load</summary>
            <Slider
              label="V_A (feed voltage at A)"
              value={d.VA}
              min={200}
              max={240}
              step={0.5}
              unit="V"
              decimals={1}
              onChange={(v) => update('V_A', `${fx(d.VA, 1)} V`, `${fx(v, 1)} V`, { ...d, VA: v })}
            />
            {d.feed === 'both' && (
              <Slider
                label="V_B (feed voltage at B)"
                value={d.VB}
                min={200}
                max={240}
                step={0.5}
                unit="V"
                decimals={1}
                onChange={(v) => update('V_B', `${fx(d.VB, 1)} V`, `${fx(v, 1)} V`, { ...d, VB: v })}
              />
            )}
            {d.feed === 'ring' && <p className="small muted">A ring main has one feed point, so both “ends” are at V_A.</p>}
            <Slider
              label="r, each conductor"
              value={d.rCond}
              min={0.02}
              max={0.5}
              step={0.01}
              unit="Ω/km"
              decimals={2}
              onChange={(v) => update('Conductor resistance', `${fx(d.rCond, 2)} Ω/km`, `${fx(v, 2)} Ω/km`, { ...d, rCond: v })}
              hint={`Loop (go + return) = 2r = ${fx(2 * d.rCond, 2)} Ω/km. In copper this r means about ${fx(areaFor(d.rCond, RHO.copper), 0)} mm² per conductor (at 20 °C).`}
            />
            <Slider label="Length A → B" value={d.L} min={100} max={1000} step={10} unit="m" decimals={0} onChange={(v) => update('Length', `${fx(d.L, 0)} m`, `${fx(v, 0)} m`, { ...d, L: v })} />
            <Toggle label="Uniformly distributed load as well" checked={d.i > 0} onChange={(on) => update('Uniform load', `${fx(d.i, 2)} A/m`, on ? '0.20 A/m' : '0 A/m', { ...d, i: on ? 0.2 : 0 })} />
            {d.i > 0 && (
              <Slider
                label="Uniform load i"
                value={d.i}
                min={0.05}
                max={1}
                step={0.05}
                unit="A/m"
                decimals={2}
                onChange={(v) => update('Uniform load', `${fx(d.i, 2)} A/m`, `${fx(v, 2)} A/m`, { ...d, i: v })}
              />
            )}
            <div className="ds-btnrow">
              <button
                type="button"
                className="text-btn"
                disabled={d.loads.length >= 6}
                onClick={() => {
                  const id = `L${Math.max(0, ...d.loads.map((l) => Number(l.id.slice(1)) || 0)) + 1}`
                  update('Loads', `${d.loads.length}`, `${d.loads.length + 1}`, { ...d, loads: [...d.loads, { id, x: Math.round(d.L / 2 / 5) * 5, I: 20 }] })
                  setSel(id)
                }}
              >
                + Add a load
              </button>
              <button
                type="button"
                className="text-btn"
                disabled={!load}
                onClick={() => {
                  if (!load) return
                  const rest = d.loads.filter((l) => l.id !== load.id)
                  update('Loads', `${d.loads.length}`, `${rest.length}`, { ...d, loads: rest })
                  setSel(rest[rest.length - 1]?.id ?? null)
                }}
              >
                Remove {load?.id ?? 'load'}
              </button>
            </div>
          </details>
          <section className="ps-card">
            <p className="eyebrow">Activity</p>
            <ul className="ds-task">
              <li className={seen.both ? 'is-done' : ''}>{seen.both ? '✓' : '○'} Feed the distributor from both ends</li>
              <li className={seen.ring ? 'is-done' : ''}>{seen.ring ? '✓' : '○'} Turn it into a ring main</li>
              <li className={seen.moved ? 'is-done' : ''}>{seen.moved ? '✓' : '○'} Fed from both sides, change a load until the lowest point moves</li>
            </ul>
            {isDone(progress, MODULE, 'distributor') && <p className="small muted">✓ Activity complete.</p>}
          </section>
        </aside>
      </div>
    </div>
  )
}

function SectionTable({ d, r }: { d: DcDistributor; r: DcOk }) {
  return (
    <div className="ds-table-wrap">
      <table className="ps-table ds-table">
        <caption className="sr-only">Section currents and drops</caption>
        <thead>
          <tr>
            <th scope="col">Section [m]</th>
            <th scope="col">Length [m]</th>
            <th scope="col">Current [A]{d.i > 0 ? ' in → out' : ''}</th>
            <th scope="col">Direction</th>
            <th scope="col">Loop R [Ω]</th>
            <th scope="col">Drop [V]</th>
            <th scope="col">V at the end [V]</th>
          </tr>
        </thead>
        <tbody>
          {r.sections.map((s, k) => {
            const mean = (s.Iin + s.Iout) / 2
            const isMin = Math.abs(s.x1 - r.minX) < 1e-9
            return (
              <tr key={k}>
                <td>
                  {fx(s.x0, 0)}–{fx(s.x1, 0)}
                </td>
                <td>{fx(s.x1 - s.x0, 0)}</td>
                <td>{d.i > 0 ? `${fx(s.Iin, 2)} → ${fx(s.Iout, 2)}` : fx(s.Iin, 2)}</td>
                <td>{Math.abs(s.Iin) < 1e-9 && Math.abs(s.Iout) < 1e-9 ? 'no current' : mean >= 0 ? 'A → B' : 'B → A'}</td>
                <td>{fx(s.R, 4)}</td>
                <td>{fx(s.drop, 3)}</td>
                <td className={isMin ? 'ds-min-cell' : ''}>
                  {fx(r.nodes[k + 1].V, 3)}
                  {isMin ? ' ▼ lowest' : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** What changed, and what it did — every word computed from the before and after results. */
function ChangeNote({ c, now, d }: { c: Change; now: DcOk; d: DcDistributor }) {
  const b = c.before
  if (!b) return null
  const moved = Math.abs(b.minX - now.minX) > 1e-9
  return (
    <p className="ds-changed" aria-live="polite">
      <b>You changed:</b> {c.what} {c.from} → {c.to}. <b>Result:</b> the lowest voltage {changeWords(b.minV, now.minV, 3)} ({fx(b.minV, 2)} → {fx(now.minV, 2)} V);{' '}
      {moved
        ? `the lowest point moved from ${fx(b.minX, 0)} m to ${fx(now.minX, 0)} m (${placeWords(now.minKind, now.minX, now.minIds, d.L)})`
        : `the lowest point stays ${placeWords(now.minKind, now.minX, now.minIds, d.L)}`}
      . {d.feed !== 'one' ? `End A now supplies ${fx(now.IA, 2)} A and end B ${fx(now.IB, 2)} A.` : `End A supplies all ${fx(now.IA, 2)} A.`}
    </p>
  )
}
