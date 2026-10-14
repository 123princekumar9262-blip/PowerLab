import { useMemo, type ReactNode } from 'react'
import { fx } from '../../ui/format.ts'
import { Callout } from '../../ui/kit.tsx'
import { computeLine, PHASES, presetDesign, type Design, type LineOutcome, type LineResult, type PhaseIndex } from './calc.ts'

/** The design's computed line (memoised on the design object). */
export function useLine(design: Design): LineOutcome {
  return useMemo(() => computeLine(design.geometry, design.options), [design])
}

export const MODULE = 'line-params'
/** The design every mode starts from: a 400 kV flat line with twin bundles. */
export const DESIGN0 = presetDesign('horizontal')
export const M2_HREF = '#/subjects/power-systems/three-phase?mode=explore'

/** A geometry the model refuses: the reasons, and no numbers. */
export function InvalidGeometry({ outcome }: { outcome: LineOutcome }) {
  if (outcome.ok) return null
  return (
    <Callout tone="bad" title="This cross-section is not physically possible — no results">
      <ul className="lp-issues">
        {outcome.issues.map((i, k) => (
          <li key={k}>{i.message}</li>
        ))}
      </ul>
      <p className="small">Move the phases apart or up, or choose an arrangement to start again.</p>
    </Callout>
  )
}

/** Live values for a selected part of the tower. */
export function PartInfo({ id, design, res }: { id: string; design: Design; res: LineResult | null }): ReactNode {
  const g = design.geometry
  const k: PhaseIndex | null = id === 'pa' ? 0 : id === 'pb' ? 1 : id === 'pc' ? 2 : null
  if (!res) return <p className="small">No values: the cross-section is not valid.</p>
  if (k !== null) {
    const p = g.phases[k]
    const others = ([0, 1, 2] as PhaseIndex[]).filter((j) => j !== k)
    const d = (j: PhaseIndex) => Math.hypot(p.x - g.phases[j].x, p.y - g.phases[j].y)
    const tr = design.options.transposed
    return (
      <dl className="lp-info">
        <div>
          <dt>Position</dt>
          <dd>
            x {fx(p.x, 1)} m · h {fx(p.y, 1)} m
          </dd>
        </div>
        {others.map((j) => (
          <div key={j}>
            <dt>To phase {PHASES[j]}</dt>
            <dd>{fx(d(j), 2)} m</dd>
          </div>
        ))}
        <div>
          <dt>GMD (all three)</dt>
          <dd>{fx(res.gmd, 2)} m</dd>
        </div>
        <div>
          <dt>GMR {g.n > 1 ? '(bundle)' : '(r′)'}</dt>
          <dd>{fx(res.gmrL * 1000, 1)} mm</dd>
        </div>
        <div>
          <dt>L {tr ? '(transposed)' : `of phase ${PHASES[k]}`}</dt>
          <dd>{fx(tr ? res.lMhKm : res.matrix.lPhase[k].re, 4)} mH/km</dd>
        </div>
        <div>
          <dt>C {tr ? '(transposed)' : `of phase ${PHASES[k]}`}</dt>
          <dd>{fx(tr ? res.cNfKm : res.matrix.cPhase[k].re, 3)} nF/km</dd>
        </div>
      </dl>
    )
  }
  if (id === 'ground')
    return (
      <dl className="lp-info">
        <div>
          <dt>Mean height</dt>
          <dd>{fx(res.hMean, 1)} m</dd>
        </div>
        <div>
          <dt>C ignoring earth</dt>
          <dd>{fx(res.cNoEarthNfKm, 3)} nF/km</dd>
        </div>
        <div>
          <dt>C with earth</dt>
          <dd>{design.options.earth ? `${fx(res.cNfKm, 3)} nF/km` : 'switched off'}</dd>
        </div>
      </dl>
    )
  if (id === 'ins') return <p className="small">Drawn length suggests the scale for {design.options.kv} kV (an illustration, not a design value). Insulators do not enter R, L or C here.</p>
  if (id === 'tower')
    return (
      <p className="small">
        Its cross-arms set the spacings D_ab {fx(res.dab, 2)} m, D_bc {fx(res.dbc, 2)} m, D_ca {fx(res.dca, 2)} m → GMD {fx(res.gmd, 2)} m.
      </p>
    )
  return null
}
