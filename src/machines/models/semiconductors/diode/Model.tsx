import type { ModelState } from '../../../types.ts'
import { Part } from '../../../viewer/Part.tsx'
import { depletionFraction } from '../common.ts'
import { arcPts, Callout, Carriers, COLOR, CurrentPath, Depletion, HeatFlow, modeOf, Note, Package, rect, Region, Shade, Terminal, type P2, type Stream } from '../shared.tsx'
import { DIODE_STATES, DIODE_STEP_MODE } from './content.ts'

/*
 * Power p-i-n diode cell, anode on top. Forward: holes move DOWN from the p+ anode, electrons UP from the n+
 * cathode, conventional current flows DOWN (anode → cathode). Reverse recovery: both kinds move back, current UP.
 * Right-hand edge of the cut: the anode junction ends with a rounded corner (x = 1.2), a floating p guard ring
 * (x 1.45…1.75) and passivation over the edge.
 */
const J = 0.25 // p+ / n− junction (flat part)
const SURF = 0.7
const metal = rect(-2, SURF, 1.05, 0.95)
const passivation = rect(1.05, SURF, 2, 0.83)
const pAnode: P2[] = [[-2, J], ...arcPts(0.95, 0.5, 0.25, -Math.PI / 2, 0), [1.2, SURF], [-2, SURF]]
const ring = rect(1.45, 0.4, 1.75, SURF)
const drift: P2[] = [[-2, -1], [2, -1], [2, SURF], [1.75, SURF], [1.75, 0.4], [1.45, 0.4], [1.45, SURF], [1.2, SURF], ...arcPts(0.95, 0.5, 0.25, 0, -Math.PI / 2), [-2, J]]
const cathode = rect(-2, -1.55, 2, -1.0)
const back = rect(-2, -1.75, 2, -1.55)
const LEADS = [
  { pos: -1 as const, label: 'K', tab: true },
  { pos: 1 as const, label: 'A', wire: 'main' as const },
]

const S = (pts: P2[], density?: number): Stream => ({ pts, density })
const HX = [-1.6, -0.9, -0.2, 0.5]
const EX = [-1.3, -0.55, 0.15, 0.8]
const H_ON = HX.map((x) => S([[x, 0.55], [x + 0.05, -1.05]], 8))
const E_ON = EX.map((x) => S([[x, -1.3], [x - 0.05, 0.3]], 8))
const H_IN = HX.map((x) => S([[x, 0.5], [x, -0.25]], 7))
const E_IN = EX.map((x) => S([[x, -1.25], [x, -0.55]], 7))
const H_BACK = HX.map((x) => S([[x + 0.05, -0.9], [x, 0.45]], 4))
const E_BACK = EX.map((x) => S([[x - 0.05, 0.1], [x, -1.25]], 4))

export function DiodeModel({ state }: { state: ModelState }) {
  const mode = modeOf(state.step, DIODE_STEP_MODE, state.params.state, DIODE_STATES)
  const L = state.layers
  const frac = depletionFraction(state.params)
  const depth = frac * (J + 1.0)
  const p = mode === 'on' ? state.calc.pcond : null
  const edgeStep = state.step === 'edge'
  return (
    <group>
      <Part id="anode-metal">
        <Region pts={metal} color={COLOR.metal} kind="metal" />
      </Part>
      <Part id="passivation">
        <Region pts={passivation} color={COLOR.oxide} kind="oxide" />
      </Part>
      <Part id="p-anode">
        <Region pts={pAnode} color={COLOR.pPlus} />
      </Part>
      <Part id="guard-ring">
        <Region pts={ring} color={COLOR.p} />
      </Part>
      <Part id="n-drift">
        <Region pts={drift} color={COLOR.nMinus} />
      </Part>
      <Part id="n-cathode">
        <Region pts={cathode} color={COLOR.nPlus} />
      </Part>
      <Part id="cathode-metal">
        <Region pts={back} color={COLOR.backMetal} kind="metal" />
      </Part>
      <Package leads={LEADS} gatePad={false} />
      <Callout top={0.95} bottom={-1.75} />

      <Terminal at={[-1.75, 0.83]} text="A" />
      <Terminal at={[1.75, -1.66]} text="K" />

      {/* ── conceptual layers ── */}
      {L.has('field') && (mode === 'block' || mode === 'turnoff' || mode === 'turnon') && (
        <>
          <Depletion x0={-2} x1={1.2} yJ={J} depth={depth} dir={-1} anim={mode === 'turnon' ? 'shrink' : mode === 'turnoff' ? 'grow' : edgeStep ? 'none' : 'grow'} />
          {mode === 'block' && (
            <>
              {/* the depletion region bends round the junction end and reaches out to the guard ring */}
              <Shade x0={1.2} y0={Math.max(-1.0, 0.5 - depth)} x1={1.85} y1={0.4} />
              {edgeStep && <Note at={[0.4, -0.75]} text="field crowds at the curved edge; the ring spreads it" />}
            </>
          )}
        </>
      )}
      {L.has('field') && (mode === 'on' || mode === 'idle') && <Note at={[0.2, -0.45]} text={mode === 'idle' ? 'no voltage applied' : 'forward-biased: no blocking depletion region'} />}
      {L.has('carriers') && (
        <group>
          {mode === 'on' && (
            <>
              <Carriers streams={H_ON} kind="hole" speed={0.12} />
              <Carriers streams={E_ON} kind="electron" speed={0.3} />
              <Note at={[0.3, -2.05]} text="drift flooded: high-level injection" />
            </>
          )}
          {mode === 'turnon' && (
            <>
              <Carriers streams={H_IN} kind="hole" speed={0.1} />
              <Carriers streams={E_IN} kind="electron" speed={0.22} />
              <Note at={[0.3, -2.05]} text="injection from both ends begins" />
            </>
          )}
          {mode === 'turnoff' && (
            <>
              <Carriers streams={H_BACK} kind="hole" speed={0.12} />
              <Carriers streams={E_BACK} kind="electron" speed={0.25} />
              <Note at={[0.3, -2.05]} text="stored carriers pulled back out" />
            </>
          )}
          {mode === 'block' && !edgeStep && <Note at={[0.3, -2.05]} text="reverse bias: carriers pulled away" />}
        </group>
      )}
      {L.has('current') && (
        <group>
          {(mode === 'on' || mode === 'turnon') &&
            [-1.25, 0.45].map((x) => <CurrentPath key={x} pts={[[x, 0.9], [x, -1.7]]} rate={mode === 'on' ? 1 : 0.4} />)}
          {mode === 'turnoff' && [-1.25, 0.45].map((x) => <CurrentPath key={x} pts={[[x, -1.7], [x, 0.9]]} rate={0.8} />)}
          <Note
            at={[0.3, -2.3]}
            text={mode === 'on' || mode === 'turnon' ? 'iF: anode → cathode (down)' : mode === 'turnoff' ? 'reverse-recovery current (up)' : 'i ≈ 0 (leakage only)'}
            tone="current"
          />
        </group>
      )}
      {L.has('energy') &&
        (mode === 'on' ? (
          <HeatFlow from={-0.2} to={-1.9} xs={[-1, 0, 1]} text={`heat ${p != null ? `≈ ${p.toFixed(1)} W ` : ''}→ tab → heat sink`} />
        ) : (
          <Note at={[0.3, -2.55]} text={mode === 'block' ? 'blocking: P ≈ 0 (leakage neglected)' : mode === 'turnoff' ? 'recovery loss: reverse current at rising voltage' : 'switching: loss in the transition'} tone="energy" />
        ))}
    </group>
  )
}
