import { gridForModel, gridSeparation } from './bergeron.ts'
import {
  analyse,
  gammaOf,
  isStepLike,
  latticeSum,
  LI_FIT,
  makeField,
  maxAbs,
  MEDIA,
  MODEL0,
  SEP0,
  SEP_LIMITS,
  separationFormula,
  separationRun,
  steadyState,
  surgeValue,
  surgeFinal,
  type Analysis,
  type Field,
  type WaveModel,
} from './waves.ts'

/*
 * The Verify mode's checks as plain functions, so the tests can run them over the whole input range: a ✓ on screen
 * must hold for EVERY valid input, not only the default.
 */

/** Sections of the independent grid (probe positions in 5 % steps of ℓ fall on its nodes). */
export const GRID_N = 200
/** Both methods are exact at the grid points for a lossless line, so only rounding separates them [kV]. */
export const GRID_TOL_KV = 1e-6

export function verifyChecks(model: WaveModel, probeF: number) {
  const out = analyse(model)
  const own = out.ok
  const m = own ? model : MODEL0
  const an = (own ? out : analyse(MODEL0)) as Analysis
  const f: Field = makeField(an)
  const node = Math.round(Math.min(1, Math.max(0, probeF)) * GRID_N)
  const xP = (node / GRID_N) * an.lengthM
  const grid = gridForModel(an, GRID_N, [...new Set([node, GRID_N, GRID_N / 4])])
  // 1 · coefficients by hand, and the end of the INDEPENDENT grid solver at t = 1.5 T (after the first arrival only)
  const zl = an.zl
  const g = gammaOf(zl, an.zc)
  const e = (t: number) => surgeValue(m.surge, m.ekv, m.steep, t)
  const aHand = an.k * e(0.5 * an.T)
  const vLin = (1 + g) * aHand
  const vHand = m.arrester && Math.abs(vLin) > m.vres ? Math.sign(vLin) * m.vres : vLin
  const iHand = ((2 * aHand - vHand) / an.zc) * 1000
  const iLoadHand = zl === Infinity ? 0 : zl === 0 ? iHand : (vHand / zl) * 1000
  const kEnd = Math.round(1.5 * GRID_N)
  const gEnd = { v: grid.v[GRID_N][kEnd], i: grid.i[GRID_N][kEnd], iArr: grid.iArr[GRID_N]?.[kEnd] ?? 0 }
  const iTol = 1e-6 * Math.max(1, Math.abs(iHand))
  const endOk = Math.abs(gEnd.v - vHand) < GRID_TOL_KV && Math.abs(gEnd.i - iHand) < iTol && Math.abs(gEnd.i - gEnd.iArr - iLoadHand) < iTol && (!m.arrester || Math.abs(gEnd.v) <= m.vres + 1e-9)
  // 2 · the lattice (or, with the non-linear arrester, the wave solution) at the probe against the grid
  const sol = (t: number) => (m.arrester ? f.v(xP, t) : latticeSum(an, xP, t).v)
  const rows = Array.from({ length: 8 }, (_, j) => {
    const k = Math.round(((j + 0.5) * an.T) / grid.dt)
    const vSol = sol(grid.t[k])
    return { t: grid.t[k], vSol, vGrid: grid.v[node][k], d: Math.abs(vSol - grid.v[node][k]) }
  })
  let maxDiff = 0
  grid.t.forEach((t, k) => {
    maxDiff = Math.max(maxDiff, Math.abs(sol(t) - grid.v[node][k]))
  })
  const hand = latticeSum(an, xP, 3.5 * an.T)
  // 3 · one wave alone: by hand v = k·e(t − x/v) and i = v/Z_c, against the grid at x = ℓ/4, t = T/2
  const vs = an.k * e(0.25 * an.T)
  const is = (vs / an.zc) * 1000
  const kS = Math.round(0.5 * GRID_N)
  const gS = { v: grid.v[GRID_N / 4][kS], i: grid.i[GRID_N / 4][kS] }
  const singleOk = Math.abs(gS.v - vs) < GRID_TOL_KV && Math.abs(gS.i - is) < 1e-6 * Math.max(1, Math.abs(is))
  // 4 · steady state: closed form = the infinite lattice sum; the far end after 8T = V_final(1 − ρ⁴)
  const ss = steadyState(an)
  const E = surgeFinal(m.surge, m.ekv)
  const series = ((1 + an.gammaL) * an.k * E) / (1 - an.rho)
  const lateK = grid.t.length - 1
  const vEndLate = grid.v[GRID_N][lateK]
  const predicted = ss.kind === 'value' ? ss.v * (1 - an.rho ** 4) : NaN
  const steadyApplies = isStepLike(m.surge) && ss.kind === 'value'
  const steadyOk = !steadyApplies || m.arrester || (Math.abs(series - (ss.kind === 'value' ? ss.v : NaN)) < 1e-9 * Math.max(1, Math.abs(series)) && Math.abs(vEndLate - predicted) < GRID_TOL_KV)
  // 5 · separation distance (the default study, with this model's V_res): recursion vs grid, and the rule
  const sep = { zc: MEDIA['ohl-twin'].zc, v: MEDIA['ohl-twin'].v, dM: SEP0.dM, s: SEP0.s, ekv: SEP0.ekv, vres: Math.min(Math.max(m.vres, SEP_LIMITS.vres[0]), SEP_LIMITS.vres[1]) }
  const sr = separationRun(sep)
  const sg = gridSeparation(sep, 40)
  const sgMax = maxAbs(sg.v[sg.nodeT])
  const sgTol = 2 * sep.s * sg.dt + sr.peakTol
  const sf = separationFormula(sep)
  const sepOk = Math.abs(sgMax - sr.vtMax) <= sgTol && (!sf.valid || Math.abs(sr.vtMax - sf.value) <= sr.peakTol)
  // 6 · the impulse
  const li = LI_FIT.times
  const impulseOk = Math.abs(li.front - 1.2) < 1e-3 && Math.abs(li.tail - 50) < 1e-2
  return {
    own,
    m,
    an,
    f,
    node,
    xP,
    grid,
    zl,
    g,
    aHand,
    vHand,
    iHand,
    iLoadHand,
    gEnd,
    coefficientsOk: endOk,
    rows,
    maxDiff,
    gridOk: maxDiff < GRID_TOL_KV,
    hand,
    vs,
    is,
    gS,
    singleOk,
    ss,
    E,
    series,
    lateK,
    vEndLate,
    predicted,
    steadyApplies,
    steadyOk,
    sep,
    sr,
    sg,
    sgMax,
    sgTol,
    sf,
    sepOk,
    li,
    impulseOk,
  }
}
