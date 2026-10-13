import { useMemo } from 'react'
import { Part } from '../../viewer/Part.tsx'
import { arcPts, Channel, COLOR, mirror, rect, Region, type Mode, type P2 } from './shared.tsx'

/*
 * The MOS-gated top of a vertical cell, shared by the power MOSFET and the IGBT (they differ only underneath).
 * Planar DMOS geometry, x ∈ [−2, 2]: two p-body wells (x < −0.7 and x > 0.7, down to y = 0.05) with n+ source /
 * emitter regions inside, the channel at the p-body surface between the n+ region and the well edge (|x| 0.7…0.95),
 * the polysilicon gate on a thin oxide over both channels and the drift "neck" between the wells, insulation over the
 * gate, and the top metal contacting both n+ and p body.
 */
export const SURF = 0.7 // silicon surface
export const WELL = 0.05 // bottom of the p-body wells
export const TOP = 1.35 // top of the metal

const pBodyL: P2[] = [[-2, WELL], ...arcPts(-0.95, 0.3, 0.25, -Math.PI / 2, 0), [-0.7, SURF], [-0.95, SURF], [-0.95, 0.4], [-1.45, 0.4], [-1.45, SURF], [-2, SURF]]
const pBodyR = mirror(pBodyL)
const nL = rect(-1.45, 0.4, -0.95, SURF)
const nR = mirror(nL)
export const driftPoly = (yb: number): P2[] => [[-2, yb], [2, yb], [2, WELL], ...arcPts(0.95, 0.3, 0.25, -Math.PI / 2, -Math.PI), [0.7, SURF], [-0.7, SURF], ...arcPts(-0.95, 0.3, 0.25, 0, -Math.PI / 2), [-2, WELL]]
const oxide = rect(-1.25, SURF, 1.25, 1.12)
const oxideHole = [rect(-1.1, 0.76, 1.1, 1.0)]
const gate = rect(-1.1, 0.76, 1.1, 1.0)
const metal: P2[] = [[-2, SURF], [-1.25, SURF], [-1.25, 1.12], [1.25, 1.12], [1.25, SURF], [2, SURF], [2, TOP], [-2, TOP]]
export const CHANNELS: Array<[number, number, number, number]> = [
  [-0.95, 0.64, -0.7, SURF],
  [0.7, 0.64, 0.95, SURF],
]

export interface MosIds {
  metal: string
  gate: string
  oxide: string
  nplus: string
  pbody: string
  channel: string
  drift: string
}

export function MosTop({ ids, driftBottom, mode }: { ids: MosIds; driftBottom: number; mode: Mode }) {
  const drift = useMemo(() => driftPoly(driftBottom), [driftBottom])
  return (
    <>
      <Part id={ids.metal}>
        <Region pts={metal} color={COLOR.metal} kind="metal" />
      </Part>
      <Part id={ids.gate}>
        <Region pts={gate} color={COLOR.poly} />
      </Part>
      <Part id={ids.oxide}>
        <Region pts={oxide} holes={oxideHole} color={COLOR.oxide} kind="oxide" />
      </Part>
      <Part id={ids.nplus}>
        <Region pts={nL} color={COLOR.nPlus} />
        <Region pts={nR} color={COLOR.nPlus} />
      </Part>
      <Part id={ids.pbody}>
        <Region pts={pBodyL} color={COLOR.p} />
        <Region pts={pBodyR} color={COLOR.p} />
      </Part>
      <Part id={ids.channel}>
        <Channel boxes={CHANNELS} mode={mode} />
      </Part>
      <Part id={ids.drift}>
        <Region pts={drift} color={COLOR.nMinus} />
      </Part>
    </>
  )
}

/** Mirror a stream (list of points) about x = 0, keeping its direction. */
export const mx = (pts: P2[]): P2[] => pts.map(([x, y]) => [-x, y] as P2)

/** Electron paths of the on-state: n+ source → channel → neck → down through the drift (left side; mirror for the right). */
export const E_ON_L: P2[][] = [
  [[-1.25, 0.56], [-1.0, 0.67], [-0.75, 0.67], [-0.45, 0.52], [-0.32, 0.05], [-0.5, -0.6], [-0.6, -1.4]],
  [[-1.2, 0.5], [-1.0, 0.67], [-0.75, 0.67], [-0.5, 0.45], [-0.6, -0.05], [-1.2, -0.6], [-1.45, -1.4]],
]
