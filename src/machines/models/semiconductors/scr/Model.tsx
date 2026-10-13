import type { ModelState } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { depletionFraction } from '../common.ts'
import { Callout, Carriers, COLOR, CurrentPath, Depletion, HeatFlow, modeOf, Note, Package, rect, Region, Terminal, type P2, type Stream } from '../shared.tsx'
import { SCR_STATES, SCR_STEP_MODE } from './content.ts'

/*
 * Thyristor cell, cathode and gate on top, anode at the bottom. Layers p1 (−1.55…−1.0), n1 (−1.0…0.05),
 * p2 (0.05…0.7, reaching the surface at the gate on the left), n2 (0.35…0.7, x > −0.7). Junctions: J1 at y = −1.0,
 * J2 at y = 0.05, J3 at y = 0.35 (under the cathode). Conducting: holes move UP from p1, electrons DOWN from n2,
 * conventional current UP (anode → cathode).
 */
const J1 = -1.0
const J2 = 0.05
const J3 = 0.35
const SURF = 0.7
const cathodeMetal = rect(-0.5, SURF, 1.9, 0.95)
const gateMetal = rect(-1.85, SURF, -1.15, 0.92)
const n2 = rect(-0.7, J3, 2, SURF)
const p2: P2[] = [[-2, J2], [2, J2], [2, J3], [-0.7, J3], [-0.7, SURF], [-2, SURF]]
const n1 = rect(-2, J1, 2, J2)
const p1 = rect(-2, -1.55, 2, J1)
const anodeMetal = rect(-2, -1.75, 2, -1.55)
const LEADS = [
  { pos: -1 as const, label: 'K', wire: 'main' as const },
  { pos: 0 as const, label: 'A', tab: true },
  { pos: 1 as const, label: 'G', wire: 'gate' as const },
]

const S = (pts: P2[], density?: number): Stream => ({ pts, density })
const H_ON = [-1.6, -0.9, -0.2, 0.5, 1.2].map((x) => S([[x, -1.35], [x + 0.1, J3 - 0.05]], 8))
const E_ON = [-0.35, 0.35, 1.05, 1.7].map((x) => S([[x, 0.55], [x - 0.15, -1.25]], 8))
const H_GATE = [S([[-1.5, 0.62], [-1.1, 0.25], [-0.3, 0.2], [0.6, 0.2]], 10)]
const E_TRIG = [0.0, 0.7, 1.4].map((x) => S([[x, 0.55], [x, -0.65]], 6))
const H_TRIG = [0.3, 1.0, 1.7].map((x) => S([[x, -1.3], [x, -0.2]], 6))
const H_OFF = [-1.2, 0.0, 1.2].map((x) => S([[x, -1.0], [x + 0.1, J2 - 0.1]], 2.5))
const E_OFF = [-0.3, 0.9].map((x) => S([[x, -0.1], [x, -1.0]], 2.5))
const I_GATE: P2[] = [[-1.5, 0.95], [-1.5, 0.6], [-1.0, 0.27], [0.1, 0.27], [0.3, 0.5], [0.3, 0.95]]

export function ScrModel({ state }: { state: ModelState }) {
  const mode = modeOf(state.step, SCR_STEP_MODE, state.params.state, SCR_STATES)
  const L = state.layers
  const frac = depletionFraction(state.params)
  const baseH = J2 - J1
  const p = mode === 'on' ? state.calc.pcond : null
  const junctions = state.step === 'structure' || L.has('field')
  return (
    <group>
      <Part id="cathode-metal">
        <Region pts={cathodeMetal} color={COLOR.metal} kind="metal" />
      </Part>
      <Part id="gate-contact">
        <Region pts={gateMetal} color={COLOR.metal} kind="metal" />
      </Part>
      <Part id="n-cathode">
        <Region pts={n2} color={COLOR.nPlus} />
      </Part>
      <Part id="p-base">
        <Region pts={p2} color={COLOR.p} />
      </Part>
      <Part id="n-base">
        <Region pts={n1} color={COLOR.nMinus} />
      </Part>
      <Part id="p-anode">
        <Region pts={p1} color={COLOR.pPlus} />
      </Part>
      <Part id="anode-metal">
        <Region pts={anodeMetal} color={COLOR.backMetal} kind="metal" />
      </Part>
      <Package leads={LEADS} />
      <Callout top={0.95} bottom={-1.75} />

      <Terminal at={[0.7, 0.83]} text="K" />
      <Terminal at={[-1.5, 0.81]} text="G" />
      <Terminal at={[1.75, -1.66]} text="A" />
      {junctions && (
        <>
          <Terminal at={[2.3, J1]} text="J1" />
          <Terminal at={[2.3, J2]} text="J2" />
          <Terminal at={[2.3, J3]} text="J3" />
        </>
      )}

      {/* ── conceptual layers ── */}
      {L.has('field') && (mode === 'block' || mode === 'turnoff' || mode === 'turnon') && (
        <Depletion x0={-2} x1={2} yJ={J2} depth={frac * baseH} dir={-1} anim={mode === 'turnon' ? 'shrink' : 'grow'} />
      )}
      {L.has('field') && mode === 'rblock' && <Depletion x0={-2} x1={2} yJ={J1} depth={frac * baseH} dir={1} anim="grow" />}
      {L.has('field') && (mode === 'on' || mode === 'idle') && <Note at={[0.3, -0.45]} text={mode === 'idle' ? 'no voltage applied' : 'latched: J1, J2, J3 all forward-biased'} />}
      {L.has('field') && mode === 'block' && <Note at={[0.3, -2.05]} text="J2 reverse-biased: it blocks" />}
      {L.has('field') && mode === 'rblock' && <Note at={[0.3, -2.05]} text="J1 reverse-biased: it blocks" />}
      {L.has('carriers') && (
        <group>
          {mode === 'on' && (
            <>
              <Carriers streams={H_ON} kind="hole" speed={0.12} />
              <Carriers streams={E_ON} kind="electron" speed={0.3} />
              <Note at={[0.3, -2.05]} text="both bases flooded; gate not needed" />
            </>
          )}
          {mode === 'turnon' && (
            <>
              <Carriers streams={H_GATE} kind="hole" speed={0.12} />
              <Carriers streams={E_TRIG} kind="electron" speed={0.25} />
              <Carriers streams={H_TRIG} kind="hole" speed={0.1} />
              <Note at={[0.3, -2.05]} text="npn (n2-p2-n1) ⇄ pnp (p1-n1-p2): regeneration" />
            </>
          )}
          {mode === 'turnoff' && (
            <>
              <Carriers streams={H_OFF} kind="hole" speed={0.05} />
              <Carriers streams={E_OFF} kind="electron" speed={0.08} />
              <Note at={[0.3, -2.05]} text="iA < IH: regeneration stops, charge recombines" />
            </>
          )}
        </group>
      )}
      {L.has('current') && (
        <group>
          {mode === 'on' && [0.1, 1.2].map((x) => <CurrentPath key={x} pts={[[x, -1.7], [x, 0.9]]} />)}
          {mode === 'turnon' && (
            <>
              <CurrentPath pts={I_GATE} rate={1} />
              <CurrentPath pts={[[1.2, -1.7], [1.2, 0.9]]} rate={0.35} />
            </>
          )}
          <Note
            at={[0.3, -2.3]}
            text={mode === 'on' ? 'iT: anode → cathode (up)' : mode === 'turnon' ? 'iG: gate → p base → cathode' : mode === 'turnoff' ? 'iA falling below IH' : 'i ≈ 0 (leakage only)'}
            tone="current"
          />
        </group>
      )}
      {L.has('energy') &&
        (mode === 'on' ? (
          <HeatFlow from={-0.2} to={-1.9} xs={[-1, 0, 1]} text={`heat ${p != null ? `≈ ${p.toFixed(1)} W ` : ''}→ tab → heat sink`} />
        ) : (
          <Note at={[0.3, -2.55]} text={mode === 'block' || mode === 'rblock' ? 'blocking: P ≈ 0 (leakage neglected)' : 'switching: loss in the transition'} tone="energy" />
        ))}
    </group>
  )
}
