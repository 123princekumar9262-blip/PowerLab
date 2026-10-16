import { useEffect, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Callout, Eq, Readouts, Seg, Slider, useTutorContext, type ReadoutItem } from '../../ui/kit.tsx'
import { angleFor, LCC_MODE_TEXT, pMaxMidShunt, pMaxSeries, qMidShunt, SUPPORT_LABEL, tcrAlphaFor, TCR_RATIO, V_REF, xTh, type Support } from './calc.ts'
import { CapabilityPlot, CharacteristicsPlot, PowerAnglePlot, PvPlot, QvPlot, TcrPlot } from './charts.tsx'
import { keyRows, whyFor, type Note } from './notes.ts'
import { HvdcScene } from './Scene.tsx'
import { compute, Issues, marginWords, MODULE, PE_LINKS, STATE0, times, useComputed, VIEW_LABEL, voltageWords, type Computed, type HfState, type View } from './shared.tsx'

/*
 * Explore: one model, four views. LCC link (converter, DC-link control), VSC link (independent P and Q),
 * Compensation (series and midpoint shunt on the power–angle curve) and Weak bus (SVC vs STATCOM on the P–V curve).
 * The 3D scene shows the link and the weak bus with the values of whatever is being explored.
 */

const SCENE_VIEWS: View[] = ['lcc', 'vsc', 'weak']

export function Explore({ st, setSt }: { st: HfState; setSt(s: HfState): void }) {
  const c = useComputed(st)
  const progress = usePsProgress()
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [seen, setSeen] = useState<View[]>([st.view])
  const [sawCollapse, setSawCollapse] = useState(false)

  const apply = (next: HfState, key: string, what: string) => {
    const nc = compute(next)
    const before = keyRows(st.view, c, st)
    const after = keyRows(st.view, nc, next)
    setNote({ what, why: whyFor(key, st, next, c, nc), rows: before.map((r, i) => ({ label: r.label, before: r.v, after: after[i].v, unit: r.unit, d: r.d })) })
    setSt(next)
  }
  const setView = (v: View) => {
    setNote(null)
    setSt({ ...st, view: v, linkKind: v === 'lcc' || v === 'vsc' ? v : st.linkKind })
    if (!seen.includes(v)) {
      const n = [...seen, v]
      setSeen(n)
      if (n.length >= 4) completeActivity(MODULE, 'views')
    }
  }
  // the collapse activity: see the collapse, then carry a load beyond the unsupported collapse point
  const noseNone = c.curves.none?.nose.p ?? null
  useEffect(() => {
    if (!c.bus.ok && /collapse/.test(c.bus.issues[0] ?? '')) setSawCollapse(true)
    if (sawCollapse && c.bus.ok && noseNone !== null && st.weak.p > noseNone) completeActivity(MODULE, 'collapse')
  }, [c.bus, sawCollapse, noseNone, st.weak.p])

  useTutorContext(() => {
    const L = c.lcc
    const b = c.bus
    return `Explore — HVDC & FACTS, view ${VIEW_LABEL[st.view]}. LCC: ${L.ok ? `${L.mode}, I_d ${fx(L.id, 3)} kA, α ${fx(L.alphaDeg, 2)}°, γ ${fx(L.gammaDeg, 2)}°, V_dr ${fx(L.vdr, 1)} kV, V_di ${fx(L.vdi, 1)} kV, P ${fx(L.pr, 0)} MW, Q_r ${fx(L.qr, 0)} Mvar` : `no operating point (${L.issues[0]})`}. VSC: ${c.vsc.ok ? `P1 ${fx(c.vsc.pDc1Mw, 0)} MW, V_c1 ${fx(c.vsc.st1.vc, 3)} pu` : 'outside capability'}. Compensation: V ${st.comp.v}, X ${st.comp.x} pu, k ${st.comp.k}. Weak bus: SCR ${st.weak.scr}, load ${st.weak.p} pu, ${st.weak.support}: ${b.ok ? `V ${fx(b.v, 3)} pu, Q_c ${fx(b.qc, 3)} pu` : 'beyond collapse'}.`
  })

  return (
    <div className="ps-stack">
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <Seg label="View" value={st.view} onChange={setView} options={(['lcc', 'vsc', 'comp', 'weak'] as View[]).map((v) => ({ id: v, label: VIEW_LABEL[v] }))} />
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setNote(null)
              setSt({ ...STATE0, view: st.view, linkKind: st.linkKind })
            }}
          >
            Reset
          </button>
        </div>
        <span className="small muted">{isDone(progress, MODULE, 'views') ? '✓ all four views explored' : `${seen.length} of 4 views explored`}</span>
      </div>
      {SCENE_VIEWS.includes(st.view) && <HvdcScene s={st} c={c} selected={selected} onSelect={setSelected} height={540} />}
      {st.view === 'lcc' && <LccView st={st} c={c} apply={apply} note={note} />}
      {st.view === 'vsc' && <VscView st={st} c={c} apply={apply} note={note} />}
      {st.view === 'comp' && <CompView st={st} apply={apply} note={note} />}
      {st.view === 'weak' && <WeakView st={st} c={c} apply={apply} note={note} />}
    </div>
  )
}

type Apply = (next: HfState, key: string, what: string) => void

function ChangeNote({ note }: { note: Note | null }) {
  if (!note) return null
  return (
    <div className="hf-change" aria-live="polite">
      <p className="small">
        <b>You changed:</b> {note.what}.
      </p>
      <ul className="hf-change-rows small">
        {note.rows.map((r) => (
          <li key={r.label}>
            {r.label}: {r.before === null ? '—' : fx(r.before, r.d)} → {r.after === null ? '—' : fx(r.after, r.d)} {r.unit}
          </li>
        ))}
      </ul>
      <p className="small muted">Why: {note.why}</p>
    </div>
  )
}

const pct = (x: number) => `${fx(x * 100, 0)} %`

// ── LCC ──────────────────────────────────────────────────────────────────────────────────────────────────────

function LccView({ st, c, apply, note }: { st: HfState; c: Computed; apply: Apply; note: Note | null }) {
  const level = useLevel()
  const u = st.lcc
  const set = (patch: Partial<HfState['lcc']>, key: string, what: string) => apply({ ...st, lcc: { ...u, ...patch } }, key, what)
  const L = c.lcc
  const main: ReadoutItem[] = L.ok
    ? [
        { label: 'DC current I_d', value: fx(L.id, 3), unit: 'kA', note: L.iOrder !== null ? `order ${fx(L.iOrder, 3)} kA` : 'follows α' },
        {
          label: 'Power sent P_dr',
          value: fx(L.pr, 0),
          unit: 'MW',
          note: L.pOrder !== null ? (Math.abs(L.pr - L.pOrder) < 0.5 ? 'meets the order' : `order ${fx(L.pOrder, 0)} MW — not met`) : `received ${fx(L.pi, 0)} MW`,
        },
        { label: 'Firing angle α', value: fx(L.alphaDeg, 2), unit: '°', note: L.mode === 'manual' ? 'set by hand' : L.mode === 'normal' ? 'set by the current controller' : 'at α_min' },
      ]
    : []
  const more: ReadoutItem[] = L.ok
    ? [
        { label: 'V_dr (rectifier)', value: fx(L.vdr, 1), unit: 'kV' },
        { label: 'V_di (inverter)', value: fx(L.vdi, 1), unit: 'kV', note: `γ = ${fx(L.gammaDeg, 2)}°` },
        { label: 'Line loss I²R', value: fx(L.loss, 1), unit: 'MW', note: `${fx((L.loss / L.pr) * 100, 2)} % of P` },
        { label: 'P received', value: fx(L.pi, 0), unit: 'MW' },
        { label: 'Q drawn, rectifier', value: fx(L.qr, 0), unit: 'Mvar', note: `cos φ ≈ ${fx(L.cosPhiR, 3)}` },
        { label: 'Q drawn, inverter', value: fx(L.qi, 0), unit: 'Mvar', note: `cos φ ≈ ${fx(L.cosPhiI, 3)}` },
      ]
    : []
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="hf-lcc-ctl">
          <h3 id="hf-lcc-ctl">Run the link</h3>
          <Seg
            label="How α is set"
            value={u.ctrl}
            onChange={(v) => set({ ctrl: v }, 'lcc-ctrl', v === 'power' ? 'control → power order (CC/CEA)' : 'control → firing angle by hand')}
            options={[
              { id: 'power', label: 'Power order (CC/CEA control)' },
              { id: 'alpha', label: 'Firing angle by hand' },
            ]}
          />
          <div className="ps-cols-2">
            {u.ctrl === 'power' ? (
              <Slider
                label="Power order"
                value={u.pMw}
                min={200}
                max={1300}
                step={10}
                unit="MW"
                decimals={0}
                onChange={(v) => set({ pMw: v }, 'lcc-p', `power order ${fx(u.pMw, 0)} → ${fx(v, 0)} MW`)}
                hint="the rectifier’s current controller turns it into I_order"
              />
            ) : (
              <Slider
                label="Rectifier firing angle α"
                value={u.alphaDeg}
                min={u.alphaMinDeg}
                max={30}
                step={0.1}
                unit="°"
                decimals={1}
                onChange={(v) => set({ alphaDeg: v }, 'lcc-alpha', `α ${fx(u.alphaDeg, 1)} → ${fx(v, 1)}°`)}
                hint="the inverter still holds γ₀"
              />
            )}
            <Slider
              label="Rectifier AC voltage"
              value={u.acPu * 100}
              min={85}
              max={110}
              step={0.5}
              unit="% of nominal"
              decimals={1}
              onChange={(v) => set({ acPu: v / 100 }, 'lcc-ac', `rectifier AC voltage ${fx(u.acPu * 100, 1)} → ${fx(v, 1)} %`)}
              hint={`valve side ${fx(c.link.vllR, 1)} kV per bridge`}
            />
          </div>
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>Inverter setting and current margin</summary>
            <div className="ps-cols-2">
              <Slider
                label="Inverter extinction angle γ₀"
                value={u.gammaDeg}
                min={12}
                max={30}
                step={0.5}
                unit="°"
                decimals={1}
                onChange={(v) => set({ gammaDeg: v }, 'lcc-gamma', `γ₀ ${fx(u.gammaDeg, 1)} → ${fx(v, 1)}°`)}
                hint="the valves need time to recover"
              />
              <Slider
                label="Current margin ΔI"
                value={u.marginKa}
                min={0.05}
                max={0.4}
                step={0.01}
                unit="kA"
                decimals={2}
                onChange={(v) => set({ marginKa: v }, 'lcc-margin', `ΔI ${fx(u.marginKa, 2)} → ${fx(v, 2)} kA`)}
                hint="inverter current order = I_order − ΔI"
              />
            </div>
          </details>
          <details className="ps-more" open={level === 'engineer'}>
            <summary>Converter and line data</summary>
            <div className="ps-cols-2">
              <div>
                <Slider
                  label="Commutation reactance X_c"
                  value={u.xc}
                  min={0}
                  max={24}
                  step={0.5}
                  unit="Ω per phase"
                  decimals={1}
                  onChange={(v) => set({ xc: v }, 'lcc-xc', `X_c ${fx(u.xc, 1)} → ${fx(v, 1)} Ω`)}
                />
                <Slider
                  label="DC line resistance R_dc"
                  value={u.rdc}
                  min={2}
                  max={20}
                  step={0.5}
                  unit="Ω"
                  decimals={1}
                  onChange={(v) => set({ rdc: v }, 'lcc-rdc', `R_dc ${fx(u.rdc, 1)} → ${fx(v, 1)} Ω`)}
                />
              </div>
              <div>
                <Slider
                  label="Minimum firing angle α_min"
                  value={u.alphaMinDeg}
                  min={2}
                  max={10}
                  step={0.5}
                  unit="°"
                  decimals={1}
                  onChange={(v) => set({ alphaMinDeg: v, alphaDeg: Math.max(v, u.alphaDeg) }, 'lcc-amin', `α_min ${fx(u.alphaMinDeg, 1)} → ${fx(v, 1)}°`)}
                />
                <p className="ps-hint">
                  Each station: 12-pulse (two 6-pulse bridges in series), valve side {fx(c.link.vllR, 1)} kV (rectifier) and {fx(c.link.vllI, 1)} kV (inverter) per bridge. Illustrative values, not a
                  specific project.
                </p>
              </div>
            </div>
          </details>
        </section>
        {L.ok ? (
          <section className="ps-card" aria-labelledby="hf-lcc-char">
            <h3 id="hf-lcc-char">Where the two controllers meet</h3>
            <CharacteristicsPlot link={c.link} res={L} />
            <p className="small">
              <b>{LCC_MODE_TEXT[L.mode]}.</b>{' '}
              {L.mode === 'normal'
                ? `The rectifier’s vertical current line (I_order = ${fx(L.iOrder!, 3)} kA) crosses the inverter’s CEA line at ${fx(L.vdr, 1)} kV. The inverter’s own current order is ΔI = ${fx(u.marginKa, 2)} kA lower, so it does not fight the rectifier.`
                : L.mode === 'shift'
                  ? `The rectifier’s α_min line now lies below the inverter’s CEA line at I_order, so the operating point drops to the inverter’s current line: I_d = ${fx(L.id, 3)} kA, ${fx(u.marginKa, 2)} kA below the order.`
                  : L.mode === 'limits'
                    ? `The α_min and CEA lines cross between the two current orders (at ${fx(L.id, 3)} kA): neither controller is in charge.`
                    : `With α fixed, the rectifier is a sloping line (slope −R_cr = −${fx(L.rcr, 2)} Ω) and the current is where it meets the inverter’s CEA line. 1° of α moves I_d by ${fx(L.dIdAlpha, 3)} kA.`}
            </p>
          </section>
        ) : null}
        {L.ok && level !== 'beginner' && (
          <section className="ps-card" aria-labelledby="hf-lcc-conv">
            <h3 id="hf-lcc-conv">Each converter (converter level)</h3>
            <div className="table-wrap">
              <table className="ps-table">
                <caption className="sr-only">Rectifier and inverter quantities</caption>
                <thead>
                  <tr>
                    <th scope="col">Quantity</th>
                    <th scope="col">Rectifier</th>
                    <th scope="col">Inverter</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Control angle</td>
                    <td>α = {fx(L.alphaDeg, 2)}°</td>
                    <td>
                      γ = {fx(L.gammaDeg, 2)}° (β = {fx(L.inv.betaDeg!, 2)}°)
                    </td>
                  </tr>
                  <tr>
                    <td>Overlap μ</td>
                    <td>{fx(L.muRDeg, 2)}°</td>
                    <td>{fx(L.muIDeg, 2)}°</td>
                  </tr>
                  <tr>
                    <td>No-load voltage V_d0 (12-pulse)</td>
                    <td>{fx(L.vd0r, 1)} kV</td>
                    <td>{fx(L.vd0i, 1)} kV</td>
                  </tr>
                  <tr>
                    <td>Commutation drop (3/π)X_c·I_d × 2</td>
                    <td>{fx(L.rcr * L.id, 1)} kV</td>
                    <td>{fx(L.rci * L.id, 1)} kV</td>
                  </tr>
                  <tr>
                    <td>DC voltage</td>
                    <td>{fx(L.vdr, 1)} kV</td>
                    <td>{fx(L.vdi, 1)} kV</td>
                  </tr>
                  <tr>
                    <td>P (AC side)</td>
                    <td>{fx(L.pr, 0)} MW drawn</td>
                    <td>{fx(L.pi, 0)} MW delivered</td>
                  </tr>
                  <tr>
                    <td>cos φ ≈ ½[cos θ + cos(θ+μ)]</td>
                    <td>{fx(L.cosPhiR, 3)}</td>
                    <td>{fx(L.cosPhiI, 3)}</td>
                  </tr>
                  <tr>
                    <td>Q absorbed = P·tan φ</td>
                    <td>{fx(L.qr, 0)} Mvar</td>
                    <td>{fx(L.qi, 0)} Mvar</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">
              Sign convention: V_di is counted positive as a back-EMF opposing I_d. Both converters absorb reactive power — the AC filters and capacitor banks must supply it. Steady state, constant
              (ripple-free) I_d, ideal valves. For the bridge and its waveforms in detail, see the Power Electronics{' '}
              <a className="ps-link" href={PE_LINKS.rectifiers}>
                rectifier lab
              </a>
              .
            </p>
          </section>
        )}
        {level === 'engineer' && L.ok && (
          <details className="ps-card ps-more" open>
            <summary>The equations solved</summary>
            <Eq
              expr="V_dr = V_d0r·cos α − R_cr·I_d   V_di = V_d0i·cos γ − R_ci·I_d   I_d = (V_dr − V_di)/R_dc"
              where={[
                ['V_d0', '2 × (3√2/π)·V_LL for a 12-pulse station', 'kV'],
                ['R_c', '2 × (3/π)·X_c — the commutation drop per kA (no losses)', 'Ω'],
                ['CEA line', `V_dr = V_d0i·cos γ₀ + (R_dc − R_ci)·I_d = ${fx(L.vd0i * Math.cos((u.gammaDeg * Math.PI) / 180), 1)} + ${fx(u.rdc - L.rci, 2)}·I_d`, 'kV'],
              ]}
              assume="steady state; ripple-free I_d; overlap below 60°; the cos φ formula is the standard approximation"
            />
          </details>
        )}
      </div>
      <div className="ps-stack">
        {!L.ok && <Issues title="No operating point — no results" issues={L.issues} hint="Raise the rectifier AC voltage, lower the order or the firing angle, or press Reset." />}
        {L.ok && (
          <section className="ps-card" aria-labelledby="hf-lcc-res" id="hf-lcc-results">
            <h3 id="hf-lcc-res">The link now</h3>
            <Readouts label="Main results" items={main} />
            {level === 'beginner' ? (
              <details className="ps-more">
                <summary>All results</summary>
                <Readouts label="More results" items={more} />
              </details>
            ) : (
              <Readouts label="More results" items={more} />
            )}
            <ChangeNote note={note} />
          </section>
        )}
        <Callout title="Four layers — keep them apart">
          <p className="small">
            <b>Converter:</b> α, μ, V_d, cos φ (one bridge). <b>DC-link control:</b> where the CC and CEA lines cross. <b>AC power flow:</b> P drawn and delivered. <b>Reactive support:</b> the Q the
            converters absorb, supplied by filters and capacitors.
          </p>
        </Callout>
      </div>
    </div>
  )
}

// ── VSC ──────────────────────────────────────────────────────────────────────────────────────────────────────

function VscView({ st, c, apply, note }: { st: HfState; c: Computed; apply: Apply; note: Note | null }) {
  const level = useLevel()
  const v = st.vsc
  const set = (patch: Partial<HfState['vsc']>, key: string, what: string) => apply({ ...st, vsc: { ...v, ...patch } }, key, what)
  const V = c.vsc
  const req = !V.ok && 'requested' in V ? V.requested : undefined
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="hf-vsc-ctl">
          <h3 id="hf-vsc-ctl">Set P and Q</h3>
          <div className="ps-cols-3">
            <Slider
              label="Power order P"
              value={v.pOrder}
              min={-1}
              max={1}
              step={0.01}
              unit="pu"
              decimals={2}
              onChange={(x) => set({ pOrder: x }, 'vsc-p', `P order ${fx(v.pOrder, 2)} → ${fx(x, 2)} pu`)}
              hint={`station 1 → 2 (${fx(v.pOrder * v.sMva, 0)} MW); negative reverses`}
            />
            <Slider
              label="Q at station 1"
              value={v.q1}
              min={-1}
              max={1}
              step={0.01}
              unit="pu"
              decimals={2}
              onChange={(x) => set({ q1: x }, 'vsc-q1', `Q₁ ${fx(v.q1, 2)} → ${fx(x, 2)} pu`)}
              hint="to grid A; + supplies vars"
            />
            <Slider
              label="Q at station 2"
              value={v.q2}
              min={-1}
              max={1}
              step={0.01}
              unit="pu"
              decimals={2}
              onChange={(x) => set({ q2: x }, 'vsc-q2', `Q₂ ${fx(v.q2, 2)} → ${fx(x, 2)} pu`)}
              hint="to grid B"
            />
          </div>
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>Grid voltages</summary>
            <div className="ps-cols-2">
              <Slider
                label="Grid A voltage V_s1"
                value={v.vs1}
                min={0.9}
                max={1.1}
                step={0.005}
                unit="pu"
                decimals={3}
                onChange={(x) => set({ vs1: x }, 'vsc-vs', `V_s1 ${fx(v.vs1, 3)} → ${fx(x, 3)} pu`)}
              />
              <Slider
                label="Grid B voltage V_s2"
                value={v.vs2}
                min={0.9}
                max={1.1}
                step={0.005}
                unit="pu"
                decimals={3}
                onChange={(x) => set({ vs2: x }, 'vsc-vs', `V_s2 ${fx(v.vs2, 3)} → ${fx(x, 3)} pu`)}
              />
            </div>
          </details>
          <details className="ps-more" open={level === 'engineer'}>
            <summary>Converter data</summary>
            <div className="ps-cols-3">
              <Slider
                label="Reactor X"
                value={v.x}
                min={0.05}
                max={0.3}
                step={0.005}
                unit="pu"
                decimals={3}
                onChange={(x) => set({ x }, 'vsc-x', `X ${fx(v.x, 3)} → ${fx(x, 3)} pu`)}
                hint="phase reactor + transformer"
              />
              <Slider
                label="Largest V_c"
                value={v.vcMax}
                min={1.0}
                max={1.3}
                step={0.01}
                unit="pu"
                decimals={2}
                onChange={(x) => set({ vcMax: x }, 'vsc-vcmax', `V_c,max ${fx(v.vcMax, 2)} → ${fx(x, 2)} pu`)}
                hint="set by the DC voltage"
              />
              <Slider label="DC line resistance" value={v.rdc} min={1} max={20} step={0.5} unit="Ω" decimals={1} onChange={(x) => set({ rdc: x }, 'vsc-rdc', `R_dc ${fx(v.rdc, 1)} → ${fx(x, 1)} Ω`)} />
            </div>
            <p className="ps-hint">
              {fx(v.sMva, 0)} MVA converters, station 2 holds {fx(v.vdc, 0)} kV DC, current limit {fx(v.iMax, 2)} pu. Illustrative values; converter losses are neglected.
            </p>
          </details>
        </section>
        <section className="ps-card" aria-labelledby="hf-vsc-cap">
          <h3 id="hf-vsc-cap">Capability of each converter</h3>
          <div className="ps-cols-2 hf-cap-pair">
            <CapabilityPlot title="Station 1" vs={v.vs1} x={v.x} iMax={v.iMax} vcMax={v.vcMax} p={V.ok ? V.p1 : (req?.p1 ?? -v.pOrder)} q={v.q1} ok={V.ok || !!req?.in1} />
            <CapabilityPlot title="Station 2" vs={v.vs2} x={v.x} iMax={v.iMax} vcMax={v.vcMax} p={V.ok ? V.p2 : (req?.p2 ?? v.pOrder)} q={v.q2} ok={V.ok || !!req?.in2} />
          </div>
          <p className="small muted">
            Phase-reactor model: the converter makes V_c∠δ behind X; P = V_s·V_c·sin δ / X and Q = (V_s·V_c·cos δ − V_s²)/X. The current limit is a circle about the origin; the voltage limit a circle
            centred at Q = −V_s²/X. Steady state; switching (PWM) is in the Power Electronics{' '}
            <a className="ps-link" href={PE_LINKS.inverters}>
              inverter
            </a>{' '}
            and{' '}
            <a className="ps-link" href={PE_LINKS.pwm}>
              PWM
            </a>{' '}
            labs.
          </p>
        </section>
      </div>
      <div className="ps-stack">
        {!V.ok && <Issues title="Outside the capability — no results" issues={V.issues} hint="Lower |P| or |Q| at the station named, or raise its grid voltage." />}
        {V.ok && (
          <section className="ps-card" aria-labelledby="hf-vsc-res" id="hf-vsc-results">
            <h3 id="hf-vsc-res">The link now</h3>
            <Readouts
              items={[
                { label: 'P received at station 2', value: fx(V.pDc2Mw, 0), unit: 'MW', note: `sent ${fx(V.pDc1Mw, 0)} MW, line loss ${fx(V.loss, 1)} MW` },
                { label: 'Station 1: V_c', value: `${fx(V.st1.vc, 3)} ∠ ${fx(V.st1.deltaDeg, 2)}°`, unit: 'pu', note: `current ${fx(V.st1.i, 3)} of ${fx(v.iMax, 2)} pu` },
                { label: 'Station 2: V_c', value: `${fx(V.st2.vc, 3)} ∠ ${fx(V.st2.deltaDeg, 2)}°`, unit: 'pu', note: `current ${fx(V.st2.i, 3)} of ${fx(v.iMax, 2)} pu` },
              ]}
            />
            {level !== 'beginner' && (
              <Readouts
                items={[
                  { label: 'DC current', value: fx(V.idc, 3), unit: 'kA' },
                  { label: 'V_dc at station 1', value: fx(V.vdc1, 1), unit: 'kV', note: `station 2 holds ${fx(v.vdc, 0)} kV` },
                ]}
              />
            )}
            <ChangeNote note={note} />
          </section>
        )}
        <Callout title="VSC vs LCC">
          <p className="small">
            {V.ok
              ? `Here station 1 ${v.q1 >= 0 ? 'supplies' : 'absorbs'} ${fx(Math.abs(v.q1) * v.sMva, 0)} Mvar and station 2 ${v.q2 >= 0 ? 'supplies' : 'absorbs'} ${fx(Math.abs(v.q2) * v.sMva, 0)} Mvar while ${fx(Math.abs(V.pDc1Mw), 0)} MW flows — each set independently. An LCC always absorbs Q, and its P cannot reverse without reversing the DC voltage.`
              : 'A VSC can set P and Q independently — but only inside its capability.'}
          </p>
        </Callout>
      </div>
    </div>
  )
}

// ── compensation ─────────────────────────────────────────────────────────────────────────────────────────────

function LineSketch({ k }: { k: number }) {
  return (
    <figure className="hf-sketch">
      <svg viewBox="0 0 640 120" role="img" aria-label="Illustration: a line with a series capacitor and a midpoint shunt compensator">
        <line x1={40} x2={600} y1={50} y2={50} className="hf-wire hf-wire--ac" />
        <circle cx={40} cy={50} r={14} className="hf-sym" />
        <text x={40} y={90} className="hf-tag" textAnchor="middle">
          V_s∠δ
        </text>
        <circle cx={600} cy={50} r={14} className="hf-sym" />
        <text x={600} y={90} className="hf-tag" textAnchor="middle">
          V_r∠0
        </text>
        <rect x={110} y={40} width={80} height={20} rx={3} className="hf-sym" />
        <text x={150} y={30} className="hf-tag" textAnchor="middle">
          X/2
        </text>
        <rect x={440} y={40} width={80} height={20} rx={3} className="hf-sym" />
        <text x={480} y={30} className="hf-tag" textAnchor="middle">
          X/2
        </text>
        <g className={k > 0 ? '' : 'is-off'}>
          <rect x={226} y={36} width={34} height={28} className="hf-bg" />
          <line x1={238} x2={238} y1={36} y2={64} className="hf-wire" />
          <line x1={248} x2={248} y1={36} y2={64} className="hf-wire" />
          <text x={243} y={28} className="hf-tag" textAnchor="middle">
            series C: kX
          </text>
        </g>
        <line x1={340} x2={340} y1={50} y2={80} className="hf-wire hf-wire--ac" />
        <rect x={312} y={80} width={56} height={24} rx={4} className="hf-sym" />
        <text x={340} y={96} className="hf-sym-sub" textAnchor="middle">
          shunt
        </text>
        <text x={378} y={72} className="hf-tag">
          midpoint V_m
        </text>
      </svg>
      <figcaption className="small muted">Illustration (no numbers): where series and shunt compensation connect. The curves below are calculated.</figcaption>
    </figure>
  )
}

function CompView({ st, apply, note }: { st: HfState; apply: Apply; note: Note | null }) {
  const level = useLevel()
  const k = st.comp
  const set = (patch: Partial<HfState['comp']>, key: string, what: string) => apply({ ...st, comp: { ...k, ...patch } }, key, what)
  const p0 = pMaxSeries(k.v, k.v, k.x, 0)
  const ps = pMaxSeries(k.v, k.v, k.x, k.k)
  const pm = pMaxMidShunt(k.v, k.x)
  const d0 = angleFor(k.p, p0, false)
  const ds = angleFor(k.p, ps, false)
  const dm = angleFor(k.p, pm, true)
  const ang = (d: number | null, pmax: number) => (d === null ? `cannot carry ${fx(k.p, 2)} pu (P_max ${fx(pmax, 2)})` : `δ = ${fx(d, 1)}°`)
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="hf-comp-ctl">
          <h3 id="hf-comp-ctl">Compensate the line</h3>
          <div className="ps-cols-2">
            <Slider
              label="Series compensation k"
              value={k.k * 100}
              min={0}
              max={75}
              step={1}
              unit="% of X"
              decimals={0}
              onChange={(x) => set({ k: x / 100 }, 'comp-k', `k ${pct(k.k)} → ${fx(x, 0)} %`)}
              hint="series capacitors cancel k·X"
            />
            <Slider label="Power to transfer" value={k.p} min={0} max={4} step={0.05} unit="pu" decimals={2} onChange={(x) => set({ p: x }, 'comp-p', `transfer ${fx(k.p, 2)} → ${fx(x, 2)} pu`)} />
          </div>
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>The line</summary>
            <div className="ps-cols-2">
              <Slider label="Voltage at both ends V" value={k.v} min={0.9} max={1.1} step={0.01} unit="pu" decimals={2} onChange={(x) => set({ v: x }, 'comp-v', `V ${fx(k.v, 2)} → ${fx(x, 2)} pu`)} />
              <Slider label="Line reactance X" value={k.x} min={0.2} max={1} step={0.01} unit="pu" decimals={2} onChange={(x) => set({ x }, 'comp-x', `X ${fx(k.x, 2)} → ${fx(x, 2)} pu`)} />
            </div>
          </details>
          <LineSketch k={k.k} />
        </section>
        <section className="ps-card" aria-labelledby="hf-comp-pa">
          <h3 id="hf-comp-pa">Power–angle curves</h3>
          <PowerAnglePlot v={k.v} x={k.x} k={k.k} p={k.p} />
          <p className="small muted">Lossless line, equal end voltages. Series: P = V²·sin δ / (X(1 − k)). Midpoint shunt (ideal, holding V_m = V): P = (2V²/X)·sin(δ/2), maximum at δ = 180°.</p>
        </section>
        {level === 'engineer' && (
          <Eq
            title="Where the midpoint curve comes from"
            expr="P = V·V_m·sin(δ/2) / (X/2) with V_m = V   ⇒   P = (2V²/X)·sin(δ/2);   Q_m = (4V²/X)·(1 − cos(δ/2))"
            where={[
              ['δ/2', 'each half of the line carries half the angle (symmetry)', '°'],
              ['Q_m', 'reactive power the midpoint compensator must supply', 'pu'],
            ]}
            assume="ideal compensator with unlimited Q; lossless line; V_s = V_r = V"
          />
        )}
      </div>
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="hf-comp-res">
          <h3 id="hf-comp-res">Maximum power</h3>
          <Readouts
            items={[
              { label: 'Uncompensated', value: fx(p0, 3), unit: 'pu', note: ang(d0, p0) },
              { label: `Series, k = ${pct(k.k)}`, value: fx(ps, 3), unit: 'pu', note: `${times(ps, p0)} · ${ang(ds, ps)}` },
              { label: 'Midpoint shunt', value: fx(pm, 3), unit: 'pu', note: `${times(pm, p0)} · ${ang(dm, pm)}` },
            ]}
          />
          {level !== 'beginner' && (
            <Readouts
              items={[
                { label: 'Series capacitor reactance', value: fx(k.k * k.x, 3), unit: 'pu', note: 'X_C = k·X' },
                { label: 'Midpoint Q needed', value: dm === null ? '—' : fx(qMidShunt(k.v, k.x, dm), 3), unit: 'pu', note: dm === null ? 'beyond its P_max' : `at δ = ${fx(dm, 1)}°` },
              ]}
            />
          )}
          <ChangeNote note={note} />
        </section>
        <Callout title="TCSC — a concept, not modelled here">
          <p className="small">A thyristor-controlled series capacitor puts a TCR in parallel with the series capacitor, so k can be varied quickly. This module models only fixed k.</p>
        </Callout>
      </div>
    </div>
  )
}

// ── weak bus ─────────────────────────────────────────────────────────────────────────────────────────────────

function WeakView({ st, c, apply, note }: { st: HfState; c: Computed; apply: Apply; note: Note | null }) {
  const level = useLevel()
  const w = st.weak
  const set = (patch: Partial<HfState['weak']>, key: string, what: string) => apply({ ...st, weak: { ...w, ...patch } }, key, what)
  const b = c.bus
  const curves = (['none', 'svc', 'statcom'] as Support[]).map((s) => c.curves[s]).filter((x): x is NonNullable<typeof x> => !!x)
  // the SVC's firing angle: B_SVC = Q_c/V² = B_C − B_TCR, with B_C = rating and B_TCR,max = TCR_RATIO·rating
  const svcAlpha = w.support === 'svc' && b.ok && w.rating > 0 ? tcrAlphaFor(Math.max(0, Math.min(1, (w.rating - b.qc / (b.v * b.v)) / (TCR_RATIO * w.rating)))) : null
  let info: ReactNode = null
  if (b.ok)
    info = (
      <Readouts
        items={[
          { label: 'Bus voltage', value: fx(b.v, 3), unit: 'pu', tone: Math.abs(b.v - 1) <= 0.05 ? 'good' : 'warn', note: voltageWords(b.v) },
          {
            label: w.support === 'none' ? 'Compensator' : `${SUPPORT_LABEL[w.support]} output`,
            value: w.support === 'none' ? 'off' : fx(b.qc, 3),
            unit: w.support === 'none' ? undefined : 'pu',
            note:
              w.support === 'none' ? 'no voltage support' : b.state === 'regulating' ? `regulating at ${fx(V_REF, 2)} pu (${fx((b.qc / w.rating) * 100, 0)} % of rating)` : 'at its capacitive limit',
          },
          { label: 'Collapse load', value: c.nose !== null ? fx(c.nose, 3) : '—', unit: 'pu', note: c.nose !== null ? marginWords(w.p, c.nose) : undefined },
        ]}
      />
    )
  return (
    <div className="ps-split ps-split--wide-side">
      <div className="ps-stack">
        <section className="ps-card" aria-labelledby="hf-weak-ctl">
          <h3 id="hf-weak-ctl">Load the weak bus</h3>
          <Seg
            label="Voltage support"
            value={w.support}
            onChange={(s) => set({ support: s }, 'weak-support', `support ${SUPPORT_LABEL[w.support]} → ${SUPPORT_LABEL[s]}`)}
            options={(['none', 'svc', 'statcom'] as Support[]).map((s) => ({ id: s, label: SUPPORT_LABEL[s] }))}
          />
          <div className="ps-cols-2">
            <Slider
              label="Load P"
              value={w.p}
              min={0}
              max={1.8}
              step={0.01}
              unit="pu"
              decimals={2}
              onChange={(x) => set({ p: x }, 'weak-p', `load ${fx(w.p, 2)} → ${fx(x, 2)} pu`)}
              hint="of the load rating (the per-unit base)"
            />
            <Slider
              label="Short-circuit ratio SCR"
              value={w.scr}
              min={1.5}
              max={10}
              step={0.1}
              unit=""
              decimals={1}
              onChange={(x) => set({ scr: x }, 'weak-scr', `SCR ${fx(w.scr, 1)} → ${fx(x, 1)}`)}
              hint={`X = 1/SCR = ${fx(xTh(w.scr), 3)} pu; lower = weaker`}
            />
          </div>
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>Load power factor and compensator rating</summary>
            <div className="ps-cols-2">
              <Slider
                label="Load power factor (lagging)"
                value={w.pf}
                min={0.8}
                max={1}
                step={0.01}
                unit=""
                decimals={2}
                onChange={(x) => set({ pf: x }, 'weak-pf', `power factor ${fx(w.pf, 2)} → ${fx(x, 2)}`)}
              />
              <Slider
                label="Compensator rating"
                value={w.rating}
                min={0.1}
                max={1}
                step={0.05}
                unit="pu"
                decimals={2}
                onChange={(x) => set({ rating: x }, 'weak-rating', `rating ${fx(w.rating, 2)} → ${fx(x, 2)} pu`)}
                hint="capacitive output at 1.0 pu voltage (both devices)"
              />
            </div>
          </details>
        </section>
        <section className="ps-card" aria-labelledby="hf-weak-pv">
          <h3 id="hf-weak-pv">P–V curves: where the voltage collapses</h3>
          <PvPlot curves={curves} load={w.p} op={b.ok ? { p: w.p, v: b.v } : null} active={w.support} />
          <p className="small muted">
            E = 1.0 pu behind X = 1/SCR, lossless; load at constant power and power factor. The compensator holds V = {fx(V_REF, 2)} pu (ideal, no droop) until it reaches its rating; then the SVC is a
            fixed susceptance (Q = B·V²) and the STATCOM a fixed current (Q = I·V). Solid: the stable upper branch; dashed: the lower branch; rings: the collapse (nose) points.
          </p>
        </section>
        {level !== 'beginner' && (
          <section className="ps-card" aria-labelledby="hf-weak-qv">
            <h3 id="hf-weak-qv">SVC vs STATCOM at a depressed voltage</h3>
            <QvPlot rating={w.rating} v={b.ok ? b.v : null} />
            {b.ok && (
              <p className="small">
                At V = {fx(b.v, 3)} pu, at their limits: SVC {fx(w.rating * b.v * b.v, 3)} pu, STATCOM {fx(w.rating * b.v, 3)} pu — the STATCOM gives {times(w.rating * b.v, w.rating * b.v * b.v)}
                {b.v > 1 ? ' (above 1 pu the SVC gives more)' : ''}.
              </p>
            )}
          </section>
        )}
        {level !== 'beginner' && w.support === 'svc' && (
          <section className="ps-card" aria-labelledby="hf-weak-tcr">
            <h3 id="hf-weak-tcr">Inside the SVC: the thyristor-controlled reactor</h3>
            <TcrPlot alpha={svcAlpha} />
            <p className="small muted">
              Fixed capacitor B_C = {fx(w.rating, 2)} pu in parallel with a TCR of up to {fx(TCR_RATIO * w.rating, 2)} pu ({fx(TCR_RATIO, 1)} × the capacitor — an illustrative design choice). B_SVC =
              B_C − B_TCR(α); α is measured from the voltage zero crossing (90° = full conduction, 180° = off).
              {svcAlpha !== null && b.ok ? ` To supply ${fx(b.qc, 3)} pu at ${fx(b.v, 3)} pu the TCR fires at α = ${fx(svcAlpha, 1)}°.` : ''}
            </p>
          </section>
        )}
        {level === 'engineer' && b.ok && (
          <details className="ps-card ps-more" open>
            <summary>Solver: Newton–Raphson on (V, δ)</summary>
            <div className="table-wrap">
              <table className="ps-table">
                <caption className="small muted">f₁ = E·V·sin δ / X − P, f₂ = (E·V·cos δ − V²)/X − (P·tan φ − Q_c(V)); start V = 1, δ = 0</caption>
                <thead>
                  <tr>
                    <th scope="col">Iteration</th>
                    <th scope="col">V [pu]</th>
                    <th scope="col">δ [°]</th>
                    <th scope="col">Largest mismatch [pu]</th>
                  </tr>
                </thead>
                <tbody>
                  {b.steps.map((s) => (
                    <tr key={s.k}>
                      <td>{s.k}</td>
                      <td>{fx(s.v, 9)}</td>
                      <td>{fx(s.deltaDeg, 6)}</td>
                      <td>{s.mismatch < 1e-12 ? '< 10⁻¹²' : s.mismatch.toExponential(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small">
              Second method — {b.checkMethod}: V = {fx(b.vCheck, 9)} pu; difference {Math.abs(b.v - b.vCheck) < 1e-12 ? 'below 10⁻¹²' : Math.abs(b.v - b.vCheck).toExponential(1)} pu.
            </p>
          </details>
        )}
      </div>
      <div className="ps-stack">
        {!b.ok && <Issues title="No solution — the voltage collapses" issues={b.issues} hint="Lower the load, add an SVC or a STATCOM, raise its rating, or strengthen the system (higher SCR)." />}
        {b.ok && (
          <section className="ps-card" aria-labelledby="hf-weak-res" id="hf-weak-results">
            <h3 id="hf-weak-res">The bus now</h3>
            {info}
            <ChangeNote note={note} />
          </section>
        )}
        <Callout title="Try this">
          <p className="small">With no support, raise the load until the voltage collapses. Then switch on an SVC or a STATCOM: can the bus now carry that load?</p>
        </Callout>
      </div>
    </div>
  )
}
