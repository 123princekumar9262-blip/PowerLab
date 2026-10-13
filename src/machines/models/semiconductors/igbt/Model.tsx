import type { ModelState } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { depletionFraction } from '../common.ts'
import { E_ON_L, MosTop, mx, WELL } from '../mosCell.tsx'
import { Callout, Carriers, COLOR, CurrentPath, Depletion, HeatFlow, modeOf, Note, Package, rect, Region, Shade, Terminal, type P2, type Stream } from '../shared.tsx'
import { IGBT_STATES, IGBT_STEP_MODE } from './content.ts'

/*
 * IGBT cell: the MOS top of ../mosCell.tsx over an n− drift, an n field stop and a p+ collector. Electrons move
 * DOWN from the channel to the collector side; holes injected by the p+ collector move UP to the p body and the
 * emitter metal; conventional current flows up (collector → emitter).
 */
const DRIFT_BOTTOM = -0.95
const fieldStop = rect(-2, -1.2, 2, DRIFT_BOTTOM)
const collector = rect(-2, -1.55, 2, -1.2)
const metal = rect(-2, -1.75, 2, -1.55)
const IDS = { metal: 'emitter-metal', gate: 'gate', oxide: 'gate-oxide', nplus: 'n-emitter', pbody: 'p-body', channel: 'channel', drift: 'n-drift' }
const LEADS = [
  { pos: -1 as const, label: 'G', wire: 'gate' as const },
  { pos: 0 as const, label: 'C', tab: true },
  { pos: 1 as const, label: 'E', wire: 'main' as const },
]

const S = (pts: P2[], density?: number): Stream => ({ pts, density })
const both = (l: P2[][], density?: number): Stream[] => [...l.map((p) => S(p, density)), ...l.map((p) => S(mx(p), density))]
// electrons: through the channel and down to the collector junction, where they recombine with injected holes
const E_L: P2[][] = E_ON_L.map((p) => [...p.slice(0, -1), [p[p.length - 1][0], -1.25] as P2])
const H_L: P2[][] = [
  [[-1.6, -1.35], [-1.6, -0.2], [-1.7, 0.3], [-1.75, 0.62]],
  [[-1.0, -1.35], [-1.0, -0.3], [-1.25, 0.2], [-1.62, 0.6]],
  [[-0.3, -1.35], [-0.35, -0.45], [-0.8, 0.12], [-1.55, 0.35]],
]
const E_ON = both(E_L, 9)
const H_ON = both(H_L, 9)
const E_TURNON = both(E_L, 4)
const H_TURNON = both([[[-1.3, -1.35], [-1.3, -0.75]], [[-0.6, -1.35], [-0.6, -0.8]]], 6)
const H_TAIL = both(H_L, 2.5)
const E_TAIL = both([[[-1.2, -0.3], [-1.2, -1.25]], [[-0.4, -0.4], [-0.5, -1.25]]], 2.5)
const I_E_L: P2[] = [[-0.9, -1.7], [-0.9, -0.4], [-0.45, 0.25], [-0.82, 0.69], [-1.1, 0.6], [-1.33, 0.6], [-1.33, 1.25]]
const I_H_L: P2[] = [[-1.65, -1.7], [-1.65, 0.2], [-1.78, 0.6], [-1.78, 1.25]]

export function IgbtModel({ state }: { state: ModelState }) {
  const mode = modeOf(state.step, IGBT_STEP_MODE, state.params.state, IGBT_STATES)
  const L = state.layers
  const frac = depletionFraction(state.params)
  const driftH = WELL - DRIFT_BOTTOM
  const p = mode === 'on' ? state.calc.pcond : null
  return (
    <group>
      <MosTop ids={IDS} driftBottom={DRIFT_BOTTOM} mode={mode} />
      <Part id="field-stop">
        <Region pts={fieldStop} color={COLOR.nBuffer} />
      </Part>
      <Part id="p-collector">
        <Region pts={collector} color={COLOR.pPlus} />
      </Part>
      <Part id="collector-metal">
        <Region pts={metal} color={COLOR.backMetal} kind="metal" />
      </Part>
      <Package leads={LEADS} />
      <Callout top={1.35} bottom={-1.75} />

      <Terminal at={[-1.75, 1.2]} text="E" />
      <Terminal at={[0, 0.88]} text="G" />
      <Terminal at={[1.75, -1.66]} text="C" />

      {/* ── conceptual layers ── */}
      {L.has('field') && (mode === 'block' || mode === 'turnoff' || mode === 'turnon') && (
        <>
          <Depletion x0={-2} x1={2} yJ={WELL} depth={frac * driftH} dir={-1} anim={mode === 'turnon' ? 'shrink' : 'grow'} />
          {mode !== 'turnon' && <Shade x0={-0.7} y0={WELL} x1={0.7} y1={0.7} />}
        </>
      )}
      {L.has('field') && (mode === 'on' || mode === 'idle') && <Note at={[0.9, -0.55]} text={mode === 'idle' ? 'no voltage applied' : 'conducting: no blocking depletion region'} />}
      {L.has('carriers') && (
        <group>
          {mode === 'on' && (
            <>
              <Carriers streams={E_ON} kind="electron" speed={0.32} />
              <Carriers streams={H_ON} kind="hole" speed={0.12} />
              <Note at={[0.3, -2.05]} text="drift flooded: conductivity modulation" />
            </>
          )}
          {mode === 'turnon' && (
            <>
              <Carriers streams={E_TURNON} kind="electron" speed={0.3} />
              <Carriers streams={H_TURNON} kind="hole" speed={0.1} />
              <Note at={[0.3, -2.05]} text="p+ collector starts injecting holes" />
              <Note at={[0, 1.58]} text="gate charged: VGE > Vth" tone="torque" />
            </>
          )}
          {mode === 'turnoff' && (
            <>
              <Carriers streams={H_TAIL} kind="hole" speed={0.06} />
              <Carriers streams={E_TAIL} kind="electron" speed={0.08} />
              <Note at={[0.3, -2.05]} text="channel gone; stored holes leave slowly: tail" />
            </>
          )}
          {mode === 'block' && <Note at={[0.3, -2.05]} text="VGE < Vth: no channel, no injection" />}
        </group>
      )}
      {L.has('current') && (
        <group>
          {(mode === 'on' || mode === 'turnon') && (
            <>
              {[I_E_L, mx(I_E_L), I_H_L, mx(I_H_L)].map((pts, k) => (
                <CurrentPath key={k} pts={pts} rate={mode === 'on' ? 1 : 0.4} />
              ))}
              <Note at={[0.3, -2.3]} text="iC: collector → emitter (up)" tone="current" />
            </>
          )}
          {mode === 'turnoff' && (
            <>
              <CurrentPath pts={I_H_L} rate={0.25} />
              <CurrentPath pts={mx(I_H_L)} rate={0.25} />
              <Note at={[0.3, -2.3]} text="tail current (holes only)" tone="current" />
            </>
          )}
          {(mode === 'block' || mode === 'idle') && <Note at={[0.3, -2.3]} text="iC ≈ 0 (leakage only)" tone="current" />}
        </group>
      )}
      {L.has('energy') &&
        (mode === 'on' ? (
          <HeatFlow from={-0.2} to={-1.9} xs={[-1, 0, 1]} text={`heat ${p != null ? `≈ ${p.toFixed(1)} W ` : ''}→ tab → heat sink`} />
        ) : (
          <Note at={[0.3, -2.55]} text={mode === 'block' ? 'off: P ≈ 0 (leakage neglected)' : mode === 'turnoff' ? 'tail at high voltage: turn-off loss' : 'switching: loss in the transition'} tone="energy" />
        ))}
    </group>
  )
}
