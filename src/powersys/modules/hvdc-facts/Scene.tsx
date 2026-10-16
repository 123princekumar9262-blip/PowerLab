import { useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { Label3D, Scene3D, SCENE_COLORS, Selectable, useHighlight, type ScenePart, type TourStep } from '../../three/Scene3D.tsx'
import { fx } from '../../ui/format.ts'
import { LCC_MODE_TEXT, SUPPORT_LABEL, V_REF, xTh, type Support } from './calc.ts'
import { inverterRole, pWords, qWords } from './notes.ts'
import { Schematic } from './Schematic.tsx'
import { marginWords, type Computed, type HfState } from './shared.tsx'

/*
 * The HVDC link and a weak AC bus in 3D. GEOMETRY: the equipment and its layout — schematic, not to scale.
 * CALCULATED (from the solved model): the power-flow arrows (direction from the sign of P, length ∝ |P|), the
 * reactive-power bars at each converter (height ∝ Q), the weak bus's voltage gauge (height ∝ V, with the 1.0 pu mark)
 * and the compensator's output bar (height ∝ Q_c). Nothing moves on its own; the picture changes only when the model
 * changes.
 */

type V3 = [number, number, number]

const C = {
  hall: '#8d99ab',
  roof: '#6f7b8c',
  xfmr: '#5f6b7a',
  bushing: SCENE_COLORS.insulator,
  filter: '#a7b4c4',
  reactor: '#8f7a5a',
  steel: SCENE_COLORS.steel,
  conductor: '#c9d2de',
  bus: '#b9c4d2',
  grid: '#4f95ea',
  load: '#c97b63',
  statcom: '#9085e9',
  svc: '#2fb37f',
  pArrow: '#7ef0a0',
  qBar: '#e0a91c',
  ground: SCENE_COLORS.ground,
}
const DIM = new THREE.Color('#1b222c')
function tone(h: ReturnType<typeof useHighlight>, base: string): string {
  if (h === 'selected') return SCENE_COLORS.selected
  if (h === 'hovered') return SCENE_COLORS.hovered
  if (h === 'dim') return '#' + new THREE.Color(base).lerp(DIM, 0.55).getHexString()
  return base
}

export const PART_IDS = ['gridA', 'filtersR', 'xfmrR', 'valveR', 'reactorR', 'dcline', 'reactorI', 'valveI', 'xfmrI', 'filtersI', 'gridB', 'source', 'weakbus', 'comp', 'load'] as const

export function sceneParts(s: HfState): ScenePart[] {
  const lcc = s.linkKind === 'lcc'
  const dev = SUPPORT_LABEL[s.weak.support]
  return [
    { id: 'gridA', name: 'AC grid A (sending)', what: 'The AC network that supplies the power. Its busbar feeds the converter station.' },
    {
      id: 'filtersR',
      name: 'AC filters (rectifier)',
      what: lcc
        ? 'Tuned capacitor banks: they absorb the converter’s harmonic currents and supply much of the reactive power it draws.'
        : 'A VSC switches fast (PWM), so only small high-frequency filters are needed.',
    },
    {
      id: 'xfmrR',
      name: 'Converter transformers (rectifier)',
      what: lcc
        ? 'Set the valve-side voltage; their leakage reactance is the commutation reactance X_c. Two windings (Y and Δ) feed two 6-pulse bridges: 12-pulse.'
        : 'Match the grid voltage to the converter; with the phase reactor they form the reactance X.',
    },
    {
      id: 'valveR',
      name: lcc ? 'Rectifier valve hall (thyristors)' : 'Converter 1 valve hall (IGBTs)',
      what: lcc
        ? 'Thyristor valves fired at angle α turn AC into DC. They can only be switched on; the AC voltage turns them off (line commutated).'
        : 'IGBT valves switched on and off by PWM make an AC voltage of any size and angle (self-commutated, voltage source).',
    },
    { id: 'reactorR', name: 'DC smoothing reactor (rectifier end)', what: 'A large inductor that smooths the DC current and limits how fast it can rise in a fault.' },
    { id: 'dcline', name: 'DC line', what: 'Two conductors (pole and return). No reactive charging current in steady state and no angle limit — only its resistance matters.' },
    { id: 'reactorI', name: 'DC smoothing reactor (inverter end)', what: 'The same at the receiving end.' },
    {
      id: 'valveI',
      name: lcc ? 'Inverter valve hall (thyristors)' : 'Converter 2 valve hall (IGBTs)',
      what: lcc
        ? 'Thyristors fired late (α > 90°) turn DC back into AC; the control holds the extinction angle γ so the valves can recover.'
        : 'Holds the DC voltage and sets its own reactive power independently.',
    },
    { id: 'xfmrI', name: 'Converter transformers (inverter)', what: 'Connect the inverter to the receiving AC grid.' },
    { id: 'filtersI', name: 'AC filters (inverter)', what: lcc ? 'Like the rectifier’s: harmonics out, reactive power in — an inverter absorbs reactive power too.' : 'Small high-frequency filters.' },
    { id: 'gridB', name: 'AC grid B (receiving)', what: 'The receiving AC network. It need not run at the same frequency or phase as grid A — the DC link is asynchronous.' },
    { id: 'source', name: 'AC network feeding the weak bus', what: 'A Thevenin equivalent: an ideal 1.0 pu source behind the reactance X = 1/SCR (the short-circuit ratio).' },
    { id: 'weakbus', name: 'Weak AC bus', what: 'A load bus far from strong generation. Its voltage sags as the load rises; past the nose of its P–V curve it collapses.' },
    {
      id: 'comp',
      name: s.weak.support === 'none' ? 'Compensator (switched off)' : dev,
      what:
        s.weak.support === 'statcom'
          ? 'A voltage-source converter: it makes its own AC voltage and so supplies reactive current up to its current limit, even at low voltage.'
          : s.weak.support === 'svc'
            ? 'A static var compensator: a fixed capacitor and a thyristor-controlled reactor (TCR). Its output is a susceptance: Q = B·V².'
            : 'No compensator in service: the bus has no voltage support.',
    },
    { id: 'load', name: 'Load', what: `The load at the weak bus (power factor ${s.weak.pf} lagging).` },
  ]
}

export function sceneTour(s: HfState, c: Computed): TourStep[] {
  const lcc = s.linkKind === 'lcc'
  const L = c.lcc
  const V = c.vsc
  const b = c.bus
  const dev = s.weak.support
  return [
    {
      title: lcc ? 'The rectifier station' : 'Converter station 1',
      focus: ['valveR'],
      camera: [-16, 11, 17],
      text: lcc ? (
        L.ok ? (
          <p>
            AC from grid A passes the filters and the converter transformers into the valve hall, where thyristors fired at α = {fx(L.alphaDeg, 1)}° make V_dr = {fx(L.vdr, 1)} kV. It draws{' '}
            {fx(L.pr, 0)} MW and {fx(L.qr, 0)} Mvar from grid A (the amber bar).
          </p>
        ) : (
          <p>The link has no operating point with the present settings (see the message beside the controls).</p>
        )
      ) : V.ok ? (
        <p>
          Converter 1 {pWords(V.p1 * s.vsc.sMva, 'grid A')} and, independently, {qWords(s.vsc.q1 * s.vsc.sMva, 'it')}: its IGBTs make V_c = {fx(V.st1.vc, 3)} pu at {fx(V.st1.deltaDeg, 1)}°.
        </p>
      ) : (
        <p>The VSC order is outside a converter’s capability, so there is no operating point to show.</p>
      ),
    },
    {
      title: 'The DC line',
      focus: ['dcline'],
      camera: [0, 13, 19],
      text: lcc ? (
        L.ok ? (
          <p>
            I_d = (V_dr − V_di)/R_dc = ({fx(L.vdr, 1)} − {fx(L.vdi, 1)}) / {fx(c.link.rdc, 1)} Ω = {fx(L.id, 3)} kA. The arrows’ length is the power; the line loses I²R = {fx(L.loss, 1)} MW and draws
            no charging current.
          </p>
        ) : (
          <p>No current flows in the present state.</p>
        )
      ) : V.ok ? (
        <p>
          I_dc = {fx(V.idc, 3)} kA at {fx(s.vsc.vdc, 0)} kV; the line loses {fx(V.loss, 1)} MW.
        </p>
      ) : (
        <p>No operating point.</p>
      ),
    },
    {
      title: lcc ? 'The inverter station' : 'Converter station 2',
      focus: ['valveI'],
      camera: [16, 11, 17],
      text: lcc ? (
        L.ok ? (
          <p>
            Thyristors fired late turn DC back into AC. {inverterRole(L)}: V_di = {fx(L.vdi, 1)} kV. It delivers {fx(L.pi, 0)} MW to grid B — and absorbs {fx(L.qi, 0)} Mvar.
          </p>
        ) : (
          <p>No operating point.</p>
        )
      ) : V.ok ? (
        <p>
          Converter 2 holds the DC voltage, {pWords(V.p2 * s.vsc.sMva, 'grid B')} and {qWords(s.vsc.q2 * s.vsc.sMva, 'it')}.
        </p>
      ) : (
        <p>No operating point.</p>
      ),
    },
    {
      title: 'A weak AC bus',
      focus: ['weakbus'],
      camera: [2, 11, 34],
      text: b.ok ? (
        <p>
          This bus is fed through X = 1/SCR = {fx(xTh(s.weak.scr), 3)} pu. At a load of {fx(s.weak.p, 2)} pu its voltage is {fx(b.v, 3)} pu (the gauge)
          {c.nose !== null ? ` — ${marginWords(s.weak.p, c.nose)}` : ''}.
        </p>
      ) : (
        <p>At this load the bus has no power-flow solution: the voltage collapses (the gauge shows no value).</p>
      ),
    },
    {
      title: dev === 'none' ? 'The compensator (off)' : `The ${SUPPORT_LABEL[dev]}`,
      focus: ['comp'],
      camera: [9, 8, 25],
      text:
        dev === 'none' ? (
          <p>No compensator is in service. Choose an SVC or a STATCOM in the Weak bus view and watch the gauge.</p>
        ) : b.ok ? (
          <p>
            {b.state === 'regulating'
              ? `It holds the bus at ${fx(V_REF, 2)} pu by supplying ${fx(b.qc, 3)} pu of reactive power (within its ${fx(s.weak.rating, 2)} pu rating).`
              : `It is at its limit: ${dev === 'svc' ? `a fixed susceptance, Q = B·V² = ${fx(b.qc, 3)} pu` : `a fixed current, Q = I_max·V = ${fx(b.qc, 3)} pu`} at V = ${fx(b.v, 3)} pu.`}
          </p>
        ) : (
          <p>Even with the {SUPPORT_LABEL[dev]} at its limit, this load is beyond the collapse point.</p>
        ),
    },
  ]
}

/** Live values for a selected part. */
export function partInfo(id: string, s: HfState, c: Computed): ReactNode {
  const lcc = s.linkKind === 'lcc'
  const L = c.lcc
  const V = c.vsc
  const rows = (items: Array<[string, string]>) => (
    <dl className="hf-info">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
  if (['gridA', 'filtersR', 'xfmrR', 'valveR', 'reactorR', 'dcline', 'reactorI', 'valveI', 'xfmrI', 'filtersI', 'gridB'].includes(id)) {
    if (lcc) {
      if (!L.ok) return <p className="small">No values: the link has no operating point ({L.issues[0]})</p>
      const rect = ['gridA', 'filtersR', 'xfmrR', 'valveR', 'reactorR'].includes(id)
      if (id === 'dcline')
        return rows([
          ['I_d', `${fx(L.id, 3)} kA`],
          ['V_dr → V_di', `${fx(L.vdr, 1)} → ${fx(L.vdi, 1)} kV`],
          ['R_dc', `${fx(c.link.rdc, 1)} Ω`],
          ['Loss I²R', `${fx(L.loss, 1)} MW (${fx((L.loss / L.pr) * 100, 1)} %)`],
          ['Power sent', `${fx(L.pr, 0)} MW`],
        ])
      if (rect)
        return rows([
          ['V_LL (valve side)', `${fx(c.link.vllR, 1)} kV`],
          ['Firing angle α', `${fx(L.alphaDeg, 2)}°`],
          ['Overlap μ', `${fx(L.muRDeg, 2)}°`],
          ['V_dr', `${fx(L.vdr, 1)} kV`],
          ['P drawn', `${fx(L.pr, 0)} MW`],
          ['Q drawn', `${fx(L.qr, 0)} Mvar (cos φ ${fx(L.cosPhiR, 3)})`],
          ['Control', L.mode === 'normal' ? 'current control (CC)' : L.mode === 'manual' ? 'α set by hand' : 'at α_min'],
        ])
      return rows([
        ['V_LL (valve side)', `${fx(c.link.vllI, 1)} kV`],
        ['Extinction angle γ', `${fx(L.gammaDeg, 2)}°`],
        ['Overlap μ', `${fx(L.muIDeg, 2)}°`],
        ['V_di', `${fx(L.vdi, 1)} kV`],
        ['P delivered', `${fx(L.pi, 0)} MW`],
        ['Q drawn', `${fx(L.qi, 0)} Mvar (cos φ ${fx(L.cosPhiI, 3)})`],
        ['Control', L.mode === 'shift' ? 'current control (I_order − ΔI)' : 'constant extinction angle (CEA)'],
      ])
    }
    if (!V.ok) return <p className="small">No values: {V.issues[0]}</p>
    const one = ['gridA', 'filtersR', 'xfmrR', 'valveR', 'reactorR'].includes(id)
    if (id === 'dcline')
      return rows([
        ['I_dc', `${fx(V.idc, 3)} kA`],
        ['V_dc1 → V_dc2', `${fx(V.vdc1, 1)} → ${fx(s.vsc.vdc, 1)} kV`],
        ['Loss I²R', `${fx(V.loss, 1)} MW`],
      ])
    const st = one ? V.st1 : V.st2
    const p = one ? V.p1 : V.p2
    const q = one ? s.vsc.q1 : s.vsc.q2
    return rows([
      ['P to its grid', `${fx(p * s.vsc.sMva, 0)} MW`],
      ['Q to its grid', `${fx(q * s.vsc.sMva, 0)} Mvar`],
      ['Converter voltage V_c', `${fx(st.vc, 3)} pu ∠ ${fx(st.deltaDeg, 2)}°`],
      ['Current', `${fx(st.i, 3)} pu of ${fx(s.vsc.iMax, 2)}`],
    ])
  }
  const b = c.bus
  const w = s.weak
  if (id === 'source')
    return rows([
      ['E', '1.000 pu'],
      ['SCR', fx(w.scr, 2)],
      ['X = 1/SCR', `${fx(xTh(w.scr), 3)} pu`],
    ])
  if (!b.ok) return <p className="small">No values: {b.issues[0]}</p>
  if (id === 'weakbus')
    return rows([
      ['Voltage (source at 0°)', `${fx(b.v, 3)} pu ∠ ${fx(-b.deltaDeg, 2)}°`],
      ['Load', `${fx(w.p, 2)} pu`],
      ['Collapse load', c.nose !== null ? `${fx(c.nose, 3)} pu` : '—'],
    ])
  if (id === 'comp')
    return w.support === 'none'
      ? rows([['Output', 'none (off)']])
      : rows([
          ['Output Q_c', `${fx(b.qc, 3)} pu`],
          ['Rating', `${fx(w.rating, 2)} pu at 1 pu`],
          ['State', b.state === 'regulating' ? `regulating at ${fx(V_REF, 2)} pu` : 'at its capacitive limit'],
        ])
  if (id === 'load')
    return rows([
      ['P', `${fx(w.p, 3)} pu`],
      ['Q = P·tan φ', `${fx(w.p * Math.tan(Math.acos(w.pf)), 3)} pu`],
    ])
  return null
}

// ── geometry ────────────────────────────────────────────────────────────────────────────────────────────────

function Bx({ p, s, color, r = 0.6, m = 0.2 }: { p: V3; s: V3; color: string; r?: number; m?: number }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} roughness={r} metalness={m} />
    </mesh>
  )
}
function Cyl({ p, r, h, color, seg = 12, rot }: { p: V3; r: number; h: number; color: string; seg?: number; rot?: V3 }) {
  return (
    <mesh position={p} rotation={rot}>
      <cylinderGeometry args={[r, r, h, seg]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
    </mesh>
  )
}
/** A thin member between two points. */
function Rod({ a, b, t, color }: { a: V3; b: V3; t: number; color: string }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const d = vb.clone().sub(va)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())
    return { pos: va.add(vb).multiplyScalar(0.5), quat: q, len: d.length() }
  }, [a, b])
  return (
    <mesh position={pos} quaternion={quat}>
      <boxGeometry args={[t, len, t]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} />
    </mesh>
  )
}
/** An arrow: shaft and cone, along +x (dir = ±1), centred at p, total length len. */
function Arrow({ p, dir, len, color, axis = 'x' }: { p: V3; dir: 1 | -1; len: number; color: string; axis?: 'x' | 'z' }) {
  const head = Math.min(0.9, len * 0.45)
  const shaft = Math.max(0.01, len - head)
  const rot: V3 = axis === 'x' ? [0, 0, dir > 0 ? -Math.PI / 2 : Math.PI / 2] : [dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0]
  const off = (d: number): V3 => (axis === 'x' ? [p[0] + dir * d, p[1], p[2]] : [p[0], p[1], p[2] + dir * d])
  return (
    <group>
      <mesh position={off(-head / 2)} rotation={rot}>
        <cylinderGeometry args={[0.12, 0.12, shaft, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={off(shaft / 2)} rotation={rot}>
        <coneGeometry args={[0.36, head, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
    </group>
  )
}
/** A vertical bar from the ground, height h (≥ a sliver), for a calculated quantity. */
function Bar({ p, h, color, w = 0.5 }: { p: V3; h: number; color: string; w?: number }) {
  const hh = Math.max(0.03, h)
  return (
    <mesh position={[p[0], p[1] + hh / 2, p[2]]}>
      <boxGeometry args={[w, hh, w]} />
      <meshStandardMaterial color={color} roughness={0.5} emissive={color} emissiveIntensity={0.2} />
    </mesh>
  )
}

function Station({ side, kind, ids }: { side: -1 | 1; kind: 'lcc' | 'vsc'; ids: { filters: string; xfmr: string; valve: string; reactor: string; grid: string } }) {
  // side −1: the rectifier on the left; +1: the inverter on the right. Its AC side faces outwards (x0 + side·k),
  // its DC side faces the line in the middle (x0 − side·k).
  const x0 = side * 12
  const out = (k: number) => x0 + side * k
  const hv = useHighlight(ids.valve)
  const hx = useHighlight(ids.xfmr)
  const hf = useHighlight(ids.filters)
  const hr = useHighlight(ids.reactor)
  const hg = useHighlight(ids.grid)
  const nf = kind === 'lcc' ? 4 : 2
  return (
    <group>
      <Selectable id={ids.valve}>
        <Bx p={[x0, 2, 0]} s={[5.4, 4, 6.4]} color={tone(hv, C.hall)} />
        <Bx p={[x0, 4.15, 0]} s={[5.6, 0.3, 6.6]} color={tone(hv, C.roof)} />
        <Label3D position={[x0, 5.2, 0]}>{side < 0 ? (kind === 'lcc' ? 'Rectifier' : 'Converter 1') : kind === 'lcc' ? 'Inverter' : 'Converter 2'}</Label3D>
      </Selectable>
      <Selectable id={ids.xfmr}>
        {[-1.7, 1.7].map((z) => (
          <group key={z}>
            <Bx p={[out(4.3), 1.1, z]} s={[1.8, 2.2, 2.2]} color={tone(hx, C.xfmr)} />
            {[-0.55, 0, 0.55].map((dz) => (
              <Cyl key={dz} p={[out(4.6), 2.8, z + dz]} r={0.1} h={1.2} color={tone(hx, C.bushing)} seg={8} />
            ))}
          </group>
        ))}
      </Selectable>
      <Selectable id={ids.filters}>
        {Array.from({ length: nf }, (_, j) => (
          <Cyl key={j} p={[out(7.2), 1.2, -4.4 + j * 1.6]} r={0.36} h={2.4} color={tone(hf, C.filter)} />
        ))}
      </Selectable>
      <Selectable id={ids.reactor}>
        <Cyl p={[x0 - side * 4.2, 1.3, 0]} r={0.16} h={2.6} color={tone(hr, C.bushing)} seg={8} />
        <Cyl p={[x0 - side * 4.2, 3.3, 0]} r={0.85} h={1.4} color={tone(hr, C.reactor)} seg={16} />
      </Selectable>
      <Selectable id={ids.grid}>
        {[-1, 1].map((z) => (
          <Cyl key={z} p={[out(9.6), 1.6, z * 3]} r={0.12} h={3.2} color={tone(hg, C.steel)} seg={6} />
        ))}
        <Bx p={[out(9.6), 3.3, 0]} s={[0.22, 0.22, 6.4]} color={tone(hg, C.bus)} />
        {[-0.9, 0, 0.9].map((z) => (
          <Rod key={z} a={[out(9.6), 3.3, z]} b={[out(15), 4.2, z]} t={0.06} color={tone(hg, C.conductor)} />
        ))}
        <Label3D position={[out(13.5), 6.4, 0]}>{side < 0 ? 'AC grid A' : 'AC grid B'}</Label3D>
      </Selectable>
    </group>
  )
}

function DcLine() {
  const h = useHighlight('dcline')
  const towers = [-4, 0, 4]
  return (
    <Selectable id="dcline">
      {towers.map((x) => (
        <group key={x}>
          <Rod a={[x, 0, -1.4]} b={[x, 7, -0.3]} t={0.16} color={tone(h, C.steel)} />
          <Rod a={[x, 0, 1.4]} b={[x, 7, 0.3]} t={0.16} color={tone(h, C.steel)} />
          <Rod a={[x, 6.6, -1.8]} b={[x, 6.6, 1.8]} t={0.14} color={tone(h, C.steel)} />
        </group>
      ))}
      {[-1.6, 1.6].map((z) => (
        <group key={z}>
          <Rod a={[-7.8, 6.2, z]} b={[7.8, 6.2, z]} t={0.08} color={tone(h, C.conductor)} />
          <Rod a={[-7.8, 6.2, z]} b={[-7.8, 4.0, z * 0.2]} t={0.06} color={tone(h, C.conductor)} />
          <Rod a={[7.8, 6.2, z]} b={[7.8, 4.0, z * 0.2]} t={0.06} color={tone(h, C.conductor)} />
        </group>
      ))}
      {/* an invisible fat target so the thin line is easy to pick */}
      <mesh position={[0, 6.2, 0]} visible={false}>
        <boxGeometry args={[15.6, 1.2, 4]} />
        <meshBasicMaterial />
      </mesh>
      <Label3D position={[0, 6.9, 2.6]}>DC line</Label3D>
    </Selectable>
  )
}

const ZW = 16 // the weak-bus area lies in front of the link

function WeakArea({ s, c }: { s: HfState; c: Computed }) {
  const hs = useHighlight('source')
  const hb = useHighlight('weakbus')
  const hc = useHighlight('comp')
  const hl = useHighlight('load')
  const w = s.weak
  const b = c.bus
  const dev = w.support
  const GAUGE = 3.6 // height for 1.2 pu
  return (
    <group>
      <Selectable id="source">
        <Bx p={[-12, 1.3, ZW]} s={[2.6, 2.6, 2.6]} color={tone(hs, C.xfmr)} />
        <Cyl p={[-12, 3.2, ZW]} r={0.12} h={1.2} color={tone(hs, C.bushing)} seg={8} />
        <Label3D position={[-12, 4.5, ZW]}>AC network (Thevenin)</Label3D>
        {[-0.6, 0, 0.6].map((dz) => (
          <Rod key={dz} a={[-11.2, 3.6, ZW + dz]} b={[2, 3.6, ZW + dz]} t={0.05} color={tone(hs, C.conductor)} />
        ))}
        {[-7, -2].map((x) => (
          <group key={x}>
            <Rod a={[x, 0, ZW - 0.9]} b={[x, 3.9, ZW]} t={0.1} color={tone(hs, C.steel)} />
            <Rod a={[x, 0, ZW + 0.9]} b={[x, 3.9, ZW]} t={0.1} color={tone(hs, C.steel)} />
          </group>
        ))}
      </Selectable>
      <Selectable id="weakbus">
        {[-1, 1].map((z) => (
          <Cyl key={z} p={[2, 1.7, ZW + z * 2]} r={0.12} h={3.4} color={tone(hb, C.steel)} seg={6} />
        ))}
        <Bx p={[2, 3.5, ZW]} s={[0.26, 0.26, 4.6]} color={tone(hb, C.bus)} />
        <Label3D position={[0.6, 5, ZW]}>Weak bus</Label3D>
        {/* the voltage gauge: frame, fill ∝ V, and the 1.0 pu mark */}
        <Bx p={[2, GAUGE / 2, ZW + 4.4]} s={[0.08, GAUGE, 0.9]} color="#3a4452" />
        {b.ok && <Bar p={[2.2, 0, ZW + 4.4]} h={(Math.min(b.v, 1.2) / 1.2) * GAUGE} color={Math.abs(b.v - 1) <= 0.05 ? SCENE_COLORS.good : SCENE_COLORS.warn} w={0.55} />}
        <Bx p={[2.2, (1 / 1.2) * GAUGE, ZW + 4.4]} s={[0.75, 0.05, 0.75]} color="#e8edf3" />
        <Label3D position={[2.2, GAUGE + 0.6, ZW + 4.4]} className="is-value" always>
          {b.ok ? `V = ${fx(b.v, 3)} pu` : 'V: no solution (collapse)'}
        </Label3D>
      </Selectable>
      <Selectable id="load">
        <Rod a={[2, 3.5, ZW + 1.5]} b={[6.6, 2.2, ZW + 2.2]} t={0.05} color={tone(hl, C.conductor)} />
        <Bx p={[7.6, 1.1, ZW + 2.2]} s={[2.2, 2.2, 2.2]} color={tone(hl, C.load)} />
        <Label3D position={[9.8, 1.6, ZW + 3.4]}>Load</Label3D>
      </Selectable>
      <Selectable id="comp">
        <Rod a={[2, 3.5, ZW - 1.5]} b={[6.4, 2.2, ZW - 3.6]} t={0.05} color={tone(hc, C.conductor)} />
        {dev === 'svc' ? (
          <group>
            {[-1, 0, 1].map((j) => (
              <Cyl key={j} p={[7.6 + j * 1.3, 0.8, ZW - 4.8]} r={0.5} h={1.4} color={tone(hc, C.reactor)} seg={14} />
            ))}
            {[-1, 0, 1].map((j) => (
              <Bx key={`c${j}`} p={[7.6 + j * 1.3, 1.0, ZW - 3]} s={[0.8, 2, 0.8]} color={tone(hc, C.filter)} />
            ))}
            <Bx p={[10.4, 1, ZW - 3.9]} s={[1.4, 2, 2]} color={tone(hc, C.svc)} />
          </group>
        ) : (
          <group>
            <Bx p={[8.4, 1.2, ZW - 4]} s={[3.2, 2.4, 2.4]} color={tone(hc, dev === 'statcom' ? C.statcom : '#4a5566')} />
            <Bx p={[6.2, 0.9, ZW - 3.6]} s={[1.2, 1.8, 1.4]} color={tone(hc, C.xfmr)} />
          </group>
        )}
        <Label3D position={[8.4, 3.6, ZW - 5]}>{dev === 'none' ? 'Compensator (off)' : SUPPORT_LABEL[dev]}</Label3D>
        {dev !== 'none' && b.ok && w.rating > 0 && (
          <>
            <Bar p={[12, 0, ZW - 3]} h={(b.qc / w.rating) * 2.4} color={C.qBar} w={0.45} />
            <Label3D position={[12.6, (b.qc / w.rating) * 2.4 + 0.7, ZW - 3]} className="is-value" always>
              Q_c {fx(b.qc, 3)} pu
            </Label3D>
          </>
        )}
      </Selectable>
      {/* the load power arrow along the AC line (calculated) */}
      {b.ok && w.p > 1e-3 && <Arrow p={[-4.5, 4.6, ZW]} dir={1} len={0.8 + 3 * Math.min(w.p / 1.5, 1.2)} color={C.pArrow} />}
    </group>
  )
}

/** Power-flow arrows and reactive bars of the link, from the solved model. */
function LinkFlows({ s, c }: { s: HfState; c: Computed }) {
  const lcc = s.linkKind === 'lcc'
  let pSend = 0
  let pRecv = 0
  let q1 = 0
  let q2 = 0
  let pRef = 1
  let qRef = 1
  let ok = false
  let label = ''
  if (lcc && c.lcc.ok) {
    ok = true
    pSend = c.lcc.pr
    pRecv = c.lcc.pi
    q1 = c.lcc.qr // absorbed
    q2 = c.lcc.qi
    pRef = 1300
    qRef = 800
    label = `P ${fx(c.lcc.pr, 0)} MW · I_d ${fx(c.lcc.id, 3)} kA`
  } else if (!lcc && c.vsc.ok) {
    ok = true
    pSend = c.vsc.pDc1Mw
    pRecv = c.vsc.pDc2Mw
    q1 = -s.vsc.q1 * s.vsc.sMva // positive = absorbed from the grid
    q2 = -s.vsc.q2 * s.vsc.sMva
    pRef = s.vsc.sMva
    qRef = s.vsc.sMva
    label = `P ${fx(c.vsc.pDc1Mw, 0)} MW · I_dc ${fx(c.vsc.idc, 3)} kA`
  }
  if (!ok)
    return (
      <Label3D position={[0, 9.2, 0]} className="is-value" always>
        No operating point
      </Label3D>
    )
  const dir: 1 | -1 = pSend >= 0 ? 1 : -1
  const L = (p: number) => 0.6 + 3.4 * Math.min(Math.abs(p) / pRef, 1.3)
  const qh = (q: number) => 3.2 * Math.min(Math.abs(q) / qRef, 1.4)
  return (
    <group>
      {Math.abs(pSend) > 1e-6 && (
        <>
          <Arrow p={[0, 8.6, 0]} dir={dir} len={L(pSend)} color={C.pArrow} />
          <Arrow p={[-24.5, 5.4, 0]} dir={dir} len={L(pSend)} color={C.pArrow} />
          <Arrow p={[24.5, 5.4, 0]} dir={dir} len={L(pRecv)} color={C.pArrow} />
        </>
      )}
      <Label3D position={[0, 10.6, 0]} className="is-value" always>
        {label}
      </Label3D>
      {[
        { x: -19.2, q: q1 },
        { x: 19.2, q: q2 },
      ].map((b) => (
        <group key={b.x}>
          <Bar p={[b.x, 0, 2.4]} h={qh(b.q)} color={C.qBar} />
          <Label3D position={[b.x, qh(b.q) + 0.7, 2.4]} className="is-value" always>
            {b.q >= 0 ? `Q drawn ${fx(b.q, 0)} Mvar` : `Q supplied ${fx(-b.q, 0)} Mvar`}
          </Label3D>
        </group>
      ))}
    </group>
  )
}

function Ground() {
  return (
    <mesh position={[0, -0.05, 0]}>
      <boxGeometry args={[400, 0.1, 400]} />
      <meshStandardMaterial color={C.ground} roughness={1} />
    </mesh>
  )
}

export function HvdcScene({
  s,
  c,
  selected,
  onSelect,
  tour = true,
  height = 440,
  info = true,
  far = false,
}: {
  s: HfState
  c: Computed
  selected: string | null
  onSelect(id: string | null): void
  tour?: boolean
  height?: number
  info?: boolean
  /** A narrow canvas: start further away so the whole link fits. */
  far?: boolean
}) {
  const parts = useMemo(() => sceneParts(s), [s])
  return (
    <Scene3D
      label="An HVDC link between two AC grids, and a weak AC bus with a compensator"
      parts={parts}
      selected={selected}
      onSelect={onSelect}
      camera={{ position: far ? [0, 22, 44] : [0, 21, 44], target: [0, 1.5, 6], fov: 42 }}
      radius={24}
      fallback={<Schematic s={s} c={c} selected={selected} onSelect={onSelect} />}
      info={info ? (id) => partInfo(id, s, c) : undefined}
      tour={tour ? sceneTour(s, c) : undefined}
      height={height}
      deps={[s, c, selected]}
      kindNote="Equipment and layout: a schematic picture, not to scale. Calculated: the green power arrows (direction and length from P), the amber reactive-power bars, the weak bus’s voltage gauge (white mark = 1.0 pu) and the compensator’s output bar."
    >
      <Ground />
      <Station side={-1} kind={s.linkKind} ids={{ filters: 'filtersR', xfmr: 'xfmrR', valve: 'valveR', reactor: 'reactorR', grid: 'gridA' }} />
      <Station side={1} kind={s.linkKind} ids={{ filters: 'filtersI', xfmr: 'xfmrI', valve: 'valveI', reactor: 'reactorI', grid: 'gridB' }} />
      <DcLine />
      <LinkFlows s={s} c={c} />
      <WeakArea s={s} c={c} />
    </Scene3D>
  )
}

export const MODE_TEXT = LCC_MODE_TEXT
export type { Support }
