import type { MachineDef, ModelState, Vec3 } from '../../types.ts'
import { Part } from '../../viewer/Part.tsx'
import { LAYER_COLOR, Marker, Spin } from '../../visualizations/viz.tsx'
import { Box, C, Cyl, Disc } from './blocks.tsx'
import { AxisArrow, Cable, Flow, kw } from './flow.tsx'
import { GS_CONTENT, GS_LAYERS, GS_PARAMS, GS_PARTS, GS_QUIZ, GS_STEPS, gsCalc } from './gensetContent.ts'

/*
 * Genset assembly — original procedural blocks. Shaft along x at y = 0, z = 0 (engine −x, alternator +x).
 * Positive rotation about +x = counter-clockwise seen from the alternator end.
 */

const CABLE_Z = [0.16, 0, -0.16]
const cablePath = (z: number): Vec3[] => [
  [1.88, -0.05, z],
  [2.15, -0.55, z],
  [2.75, -0.6, z],
  [3.08, -0.35, z],
]

function GensetModel({ state }: { state: ModelState }) {
  const L = state.layers
  const c = state.calc
  const pp = (state.params.poles ?? 4) / 2
  return (
    <group>
      <Part id="base-frame">
        {[0.5, -0.5].map((z) => (
          <Box key={z} size={[5.0, 0.14, 0.12]} at={[-0.5, -0.9, z]} color={C.darkSteel} metal={0.5} />
        ))}
        {[-2.8, -0.7, 1.7].map((x) => (
          <Box key={x} size={[0.12, 0.1, 1.0]} at={[x, -0.9, 0]} color={C.darkSteel} metal={0.5} />
        ))}
      </Part>
      <Part id="fuel-tank">
        <Box size={[4.2, 0.28, 0.9]} at={[-0.5, -1.12, 0]} color="#3d4651" />
        <Cyl r={0.06} len={0.1} axis="y" at={[1.2, -0.95, 0.3]} color={C.black} />
      </Part>
      <Part id="radiator">
        <Box size={[0.16, 1.25, 1.0]} at={[-2.85, 0, 0]} color="#3b4048" />
        {Array.from({ length: 9 }, (_, i) => (
          <Box key={i} size={[0.02, 1.1, 0.03]} at={[-2.94, 0, -0.4 + i * 0.1]} color="#9aa4b2" metal={0.6} />
        ))}
      </Part>
      <Part id="engine">
        <Box size={[1.7, 0.85, 0.85]} at={[-1.75, -0.4, 0]} color={C.engine} metal={0.4} rough={0.55} />
        <Box size={[1.5, 0.62, 0.66]} at={[-1.75, 0.33, 0]} color={C.engine} metal={0.4} rough={0.55} />
        <Box size={[1.42, 0.14, 0.5]} at={[-1.75, 0.71, 0]} color="#8a3b2e" metal={0.4} rough={0.5} />
        {[-2.3, -1.93, -1.57, -1.2].map((x) => (
          <Cyl key={x} r={0.05} len={0.12} axis="y" at={[x, 0.84, 0]} color={C.steel} />
        ))}
        {/* exhaust manifold and stack */}
        <Cyl r={0.07} len={1.3} axis="x" at={[-1.75, 0.42, -0.42]} color="#6d5a4a" metal={0.6} />
        <Cyl r={0.09} len={1.0} axis="y" at={[-1.05, 0.95, -0.42]} color="#6d5a4a" metal={0.6} />
        {/* bell-housing ring (the flywheel housing is drawn open) */}
        <Cyl r={0.45} len={0.12} axis="x" at={[-0.95, 0, 0]} color={C.engine} />
      </Part>
      <Part id="governor">
        <Box size={[0.26, 0.22, 0.18]} at={[-1.4, 0.05, 0.52]} color="#2d3238" />
        <Cyl r={0.02} len={0.5} axis="y" at={[-1.4, 0.4, 0.5]} color={C.steel} />
      </Part>
      <Part id="avr">
        <Box size={[0.5, 0.3, 0.45]} at={[0.6, 0.78, 0]} color="#2d3238" />
        <Box size={[0.3, 0.12, 0.02]} at={[0.6, 0.8, 0.235]} color="#6ea8ff" metal={0.1} rough={0.4} />
      </Part>
      <Part id="alternator">
        <Cyl r={0.6} len={1.45} axis="x" at={[0.47, 0, 0]} color={C.alternator} seg={40} />
        {Array.from({ length: 8 }, (_, i) => (
          <Cyl key={i} r={0.62} len={0.04} axis="x" at={[-0.15 + i * 0.18, 0, 0]} color="#5f7186" seg={40} />
        ))}
        <Cyl r={0.56} len={0.06} axis="x" at={[1.22, 0, 0]} color="#30363e" seg={40} />
        <Box size={[1.2, 0.5, 0.18]} at={[0.47, -0.62, 0.42]} color={C.alternator} />
        <Box size={[1.2, 0.5, 0.18]} at={[0.47, -0.62, -0.42]} color={C.alternator} />
      </Part>
      <Part id="control-panel">
        <Box size={[0.24, 0.95, 0.72]} at={[1.75, 0.25, 0]} color="#3a4350" />
        {[-0.2, 0, 0.2].map((z) => (
          <Cyl key={z} r={0.06} len={0.02} axis="x" at={[1.875, 0.52, z]} color="#e8ecf2" metal={0.1} rough={0.4} />
        ))}
        <Box size={[0.03, 0.14, 0.3]} at={[1.88, 0.2, 0]} color="#101418" />
        <Box size={[0.05, 0.12, 0.08]} at={[1.89, -0.05, 0.2]} color={C.red} />
      </Part>
      <Part id="cables">
        {CABLE_Z.map((z, k) => (
          <Cable key={z} points={cablePath(z)} color={C.phase[k]} radius={0.03} />
        ))}
      </Part>
      <Part id="load">
        <Box size={[0.6, 1.0, 0.8]} at={[3.4, -0.75, 0]} color="#4a4f58" />
        {Array.from({ length: 6 }, (_, i) => (
          <Box key={i} size={[0.61, 0.04, 0.6]} at={[3.4, -0.45 - i * 0.1, 0]} color="#22262c" />
        ))}
        <Box size={[0.6, 0.06, 0.8]} at={[3.4, -0.22, 0]} color="#5b616b" />
      </Part>
      {/* the rotating train: flywheel and coupling (the alternator rotor is inside its housing) */}
      <Spin axis="x">
        <Part id="flywheel">
          <group position={[-0.78, 0, 0]}>
            <Disc r={0.62} t={0.12} color="#8d97a6" holes={6} holeR={0.06} />
            <Cyl r={0.64} len={0.05} axis="x" color="#6c7582" seg={60} />
          </group>
        </Part>
        <Part id="coupling">
          <group position={[-0.5, 0, 0]}>
            <Disc r={0.32} t={0.07} color="#7c8794" holes={4} holeR={0.035} />
            <Cyl r={0.28} len={0.1} axis="x" at={[0.08, 0, 0]} color={C.rubber} rough={0.9} metal={0} />
            <Disc r={0.32} t={0.07} color="#7c8794" holes={4} holeR={0.035} />
          </group>
          <Cyl r={0.08} len={0.5} axis="x" at={[-0.45, 0, 0]} color={C.steel} />
        </Part>
      </Spin>

      {L.has('rotation') && <AxisArrow axis="x" at={[-0.3, 0, 0]} radius={0.42} start={Math.PI * 0.45} sweep={Math.PI * 1.0} color={LAYER_COLOR.rotation} tube={0.02} />}
      {L.has('torque') && (
        <group>
          <AxisArrow axis="x" at={[-0.62, 0, 0]} radius={0.95} start={Math.PI * 0.55} sweep={Math.PI * 0.7} color={LAYER_COLOR.torque} />
          <Marker at={[-0.62, 0.5, 1.12]} text="T engine (drives)" tone="torque" />
          <AxisArrow axis="x" at={[1.32, 0, 0]} radius={0.72} start={Math.PI * 1.25} sweep={-Math.PI * 0.7} color={LAYER_COLOR.torque} />
          <Marker at={[1.32, 0.5, 0.9]} text="T counter (alternator)" tone="torque" />
        </group>
      )}
      {L.has('energy') && (
        <group>
          <Flow points={[[-1.2, -1.0, 0.55], [-1.5, -0.5, 0.55], [-1.75, 0, 0.5]]} color={LAYER_COLOR.energy} width={3.5} onTop />
          <Flow points={[[-1.75, 0, 0], [-0.6, 0, 0], [0.5, 0, 0], [0.6, 0.45, 0], [1.6, 0.45, 0], [1.88, 0.0, 0], [2.15, -0.5, 0], [2.75, -0.55, 0], [3.1, -0.3, 0]]} color={LAYER_COLOR.energy} width={3.5} onTop />
          <Flow points={[[-1.75, 0.3, -0.42], [-1.05, 0.5, -0.42], [-1.05, 1.6, -0.42]]} color={LAYER_COLOR.energy} width={1.6} onTop />
          <Flow points={[[-2.0, 0, 0], [-2.85, 0, 0], [-3.3, 0, 0]]} color={LAYER_COLOR.energy} width={1.6} onTop />
          <Flow points={[[0.5, 0.2, 0], [0.5, 0.6, -0.5], [0.5, 1.1, -0.8]]} color={LAYER_COLOR.energy} width={1.2} onTop />
          <Marker at={[-1.3, -1.35, 0.7]} text={`fuel${kw(c.pfuel)}`} tone="energy" />
          <Marker at={[-0.6, -0.95, 0]} text={`shaft T·ω${kw(c.pshaft)}`} tone="energy" />
          <Marker at={[3.2, 0.15, 0]} text={`to load${kw(c.pelec)}`} tone="energy" />
          <Marker at={[-1.05, 1.78, -0.42]} text={`heat${kw(c.lossEngine)}`} tone="energy" />
          <Marker at={[0.5, 1.25, -0.8]} text="alternator losses" tone="energy" />
        </group>
      )}
      {L.has('current') &&
        CABLE_Z.map((z, k) => <Flow key={z} points={cablePath(z).map(([x, y, zz]) => [x, y + 0.06, zz] as Vec3)} color={LAYER_COLOR.current} rate={(a) => 1.6 * Math.cos(pp * a - (k * 2 * Math.PI) / 3)} width={2.2} onTop />)}
      {L.has('current') && <Marker at={[2.45, -0.95, 0.3]} text="ia, ib, ic (AC)" tone="current" />}
    </group>
  )
}

const SLOW = 100
const def: MachineDef = {
  id: 'sys-genset',
  manifest: {
    source: 'Original procedural geometry, written for this lab (no external asset).',
    license: 'Part of this project — no third-party model.',
    simplified: 'Simplified block model: a four-cylinder diesel engine, exposed flywheel (its housing drawn open), flexible coupling, an alternator drawn as a housing, AVR, control panel, three output cables and a load bank on a skid with a built-in fuel tank. Proportions are illustrative.',
    camera: { position: [4.8, 3.4, 8.3], target: [0.4, -0.3, 0] },
    radius: 3.8,
    views: { front: [0.3, 0, 9.6], side: [9.6, 0.6, 0], top: [0.3, 9.8, 0.3], iso: [4.8, 3.4, 8.3] },
    limitations: [
      'Energy, torque and current layers are conceptual illustrations; the numbers on them come from the explicit calculation with assumed efficiencies.',
      'The shaft animation is the set speed slowed down ×100; the AC current dashes follow the electrical angle only as an illustration.',
      'The alternator and the engine are blocks: see the alternator model for the inside of the generator.',
      'Steady state only: governor and AVR dynamics are described, not calculated.',
    ],
  },
  parts: GS_PARTS,
  layers: GS_LAYERS,
  steps: GS_STEPS,
  params: GS_PARAMS,
  calc: gsCalc,
  motion: (_c, p) => ({ omega: (((p.n ?? 0) / 60) * 2 * Math.PI) / SLOW, note: `The shaft turns at the set speed n = ${p.n} rpm, slowed down ×${SLOW}.` }),
  content: GS_CONTENT,
  quiz: GS_QUIZ,
  Model: GensetModel,
}
export default def
