import type { ModelState } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { depletionFraction } from '../common.ts'
import { E_ON_L, MosTop, mx, WELL } from '../mosCell.tsx'
import { Callout, Carriers, COLOR, CurrentPath, Depletion, HeatFlow, modeOf, Note, Package, rect, Region, Shade, Terminal, type P2, type Stream } from '../shared.tsx'
import { MOSFET_STATES, MOSFET_STEP_MODE } from './content.ts'

/*
 * Vertical n-channel power MOSFET, one planar DMOS cell (see ../mosCell.tsx), on an n+ substrate with the drain
 * metal underneath; a TO-247-style package beside it. Electrons move DOWN (source → drain) when on; conventional
 * current flows UP (drain → source). Body diode: holes down from the p body, electrons up from the substrate.
 */
const DRIFT_BOTTOM = -1.0
const substrate = rect(-2, -1.55, 2, DRIFT_BOTTOM)
const drain = rect(-2, -1.75, 2, -1.55)
const IDS = { metal: 'source-metal', gate: 'gate', oxide: 'gate-oxide', nplus: 'n-source', pbody: 'p-body', channel: 'channel', drift: 'n-drift' }
const LEADS = [
  { pos: -1 as const, label: 'G', wire: 'gate' as const },
  { pos: 0 as const, label: 'D', tab: true },
  { pos: 1 as const, label: 'S', wire: 'main' as const },
]

const S = (pts: P2[], density?: number): Stream => ({ pts, density })
const E_ON: Stream[] = [...E_ON_L.map((p) => S(p)), ...E_ON_L.map((p) => S(mx(p)))]
const E_OFFING: Stream[] = E_ON.map((s) => S(s.pts, 1.6))
const E_TURNON: Stream[] = [S([[-1.15, 0.6], [-0.95, 0.672], [-0.72, 0.672]], 14), S(mx([[-1.15, 0.6], [-0.95, 0.672], [-0.72, 0.672]]), 14)]
const H_TURNON: Stream[] = [S([[-0.83, 0.62], [-0.83, 0.22]], 10), S(mx([[-0.83, 0.62], [-0.83, 0.22]]), 10)]
const BD_HOLES_L: P2[][] = [
  [[-1.75, 0.45], [-1.75, 0.05], [-1.7, -0.95]],
  [[-1.15, 0.2], [-1.1, -0.95]],
]
const BD_ELEC_L: P2[][] = [
  [[-1.5, -1.4], [-1.45, 0.05]],
  [[-0.85, -1.4], [-0.95, 0.0]],
]
const BD_HOLES: Stream[] = [...BD_HOLES_L.map((p) => S(p)), ...BD_HOLES_L.map((p) => S(mx(p)))]
const BD_ELEC: Stream[] = [...BD_ELEC_L.map((p) => S(p)), ...BD_ELEC_L.map((p) => S(mx(p)))]
const I_ON_L: P2[] = [[-0.62, -1.7], [-0.5, -0.6], [-0.36, 0.05], [-0.48, 0.5], [-0.82, 0.69], [-1.1, 0.6], [-1.33, 0.6], [-1.33, 1.25]]
const I_BD_L: P2[] = [[-1.75, 1.25], [-1.75, 0.3], [-1.6, -0.5], [-1.6, -1.7]]

export function MosfetModel({ state }: { state: ModelState }) {
  const mode = modeOf(state.step, MOSFET_STEP_MODE, state.params.state, MOSFET_STATES)
  const L = state.layers
  const frac = depletionFraction(state.params)
  const p = mode === 'on' ? state.calc.pcond : mode === 'reverse' && state.calc.vsd != null ? state.calc.vsd * (state.params.id ?? 0) : null
  const driftH = WELL - DRIFT_BOTTOM
  return (
    <group>
      <MosTop ids={IDS} driftBottom={DRIFT_BOTTOM} mode={mode} />
      <Part id="n-substrate">
        <Region pts={substrate} color={COLOR.nPlus} />
      </Part>
      <Part id="drain-metal">
        <Region pts={drain} color={COLOR.backMetal} kind="metal" />
      </Part>
      <Package leads={LEADS} />
      <Callout top={1.35} bottom={-1.75} />

      <Terminal at={[-1.75, 1.2]} text="S" />
      <Terminal at={[0, 0.88]} text="G" />
      <Terminal at={[1.75, -1.66]} text="D" />

      {/* ── conceptual layers ── */}
      {L.has('field') && (mode === 'block' || mode === 'turnoff' || mode === 'turnon') && (
        <Depletion x0={-2} x1={2} yJ={WELL} depth={frac * driftH} dir={-1} anim={mode === 'block' || mode === 'turnoff' ? 'grow' : 'shrink'} />
      )}
      {L.has('field') && (mode === 'block' || mode === 'turnoff') && <Shade x0={-0.7} y0={WELL} x1={0.7} y1={0.7} />}
      {L.has('field') && mode === 'turnon' && <Note at={[0.4, -0.75]} text="vDS falls: the depletion region collapses" />}
      {L.has('field') && (mode === 'on' || mode === 'reverse' || mode === 'idle') && <Note at={[0.9, -0.55]} text={mode === 'idle' ? 'no voltage applied' : 'conducting: no blocking depletion region'} />}
      {L.has('carriers') && (
        <group>
          {mode === 'on' && <Carriers streams={E_ON} kind="electron" speed={0.35} />}
          {mode === 'turnoff' && <Carriers streams={E_OFFING} kind="electron" speed={0.2} />}
          {mode === 'turnon' && (
            <>
              <Carriers streams={E_TURNON} kind="electron" speed={0.12} />
              <Carriers streams={H_TURNON} kind="hole" speed={0.08} />
              <Note at={[0, 1.58]} text="gate charged: VGS > Vth" tone="torque" />
            </>
          )}
          {mode === 'reverse' && (
            <>
              <Carriers streams={BD_HOLES} kind="hole" speed={0.14} />
              <Carriers streams={BD_ELEC} kind="electron" speed={0.3} />
              <Note at={[0.3, -2.05]} text="gate off — body diode conducts" />
            </>
          )}
          {mode === 'block' && <Note at={[0.3, -2.05]} text="VGS < Vth: no channel, no free path for electrons" />}
          {(mode === 'on' || mode === 'turnoff') && <Note at={[0.3, -2.05]} text={mode === 'on' ? 'electrons only (unipolar)' : 'channel vanishing: electron flow stops'} />}
        </group>
      )}
      {L.has('current') && (
        <group>
          {(mode === 'on' || mode === 'turnon') && (
            <>
              <CurrentPath pts={I_ON_L} rate={mode === 'on' ? 1 : 0.4} />
              <CurrentPath pts={mx(I_ON_L)} rate={mode === 'on' ? 1 : 0.4} />
              <Note at={[0.3, -2.3]} text="iD: drain → source (up)" tone="current" />
            </>
          )}
          {mode === 'reverse' && (
            <>
              <CurrentPath pts={I_BD_L} />
              <CurrentPath pts={mx(I_BD_L)} />
              <Note at={[0.3, -2.3]} text="iS: source → drain (down)" tone="current" />
            </>
          )}
          {(mode === 'block' || mode === 'idle') && <Note at={[0.3, -2.3]} text="iD ≈ 0 (leakage only)" tone="current" />}
          {mode === 'turnoff' && <Note at={[0.3, -2.3]} text="iD falling" tone="current" />}
        </group>
      )}
      {L.has('energy') &&
        (mode === 'on' || mode === 'reverse' ? (
          <HeatFlow from={-0.2} to={-1.9} xs={[-1, 0, 1]} text={`heat ${p != null ? `≈ ${p.toFixed(1)} W ` : ''}→ tab → heat sink`} />
        ) : (
          <Note at={[0.3, -2.55]} text={mode === 'block' ? 'off: P ≈ 0 (leakage neglected)' : 'switching: loss in the transition'} tone="energy" />
        ))}
    </group>
  )
}
