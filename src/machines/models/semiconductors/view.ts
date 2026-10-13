import type { Manifest } from '../../types.ts'

/** Camera of the semiconductor models: the magnified cell (x −2…2) with the package on its left. */
export const SEMI_CAMERA: Pick<Manifest, 'camera' | 'radius' | 'views'> = {
  camera: { position: [1.9, 1.7, 9.6], target: [-0.8, -0.35, 0], fov: 38 },
  radius: 3.9,
  views: { front: [-0.8, -0.35, 10.2], side: [9.4, 0.6, 2.4], top: [-0.8, 10, 1.6], iso: [4.4, 3.6, 8.6] },
}

export const SEMI_LIMITATIONS = [
  'Depletion regions, carriers and current paths are conceptual illustrations drawn on the cut face — not a device (TCAD) simulation; the carrier speed and number are illustrative.',
  'The depletion depth follows the calculated W / drift thickness of the one-sided abrupt junction; its growth while playing only illustrates W ∝ √V.',
  'On-state and switching values are steady relations with EXAMPLE device values; the switching transients are simulated in the Switching Devices lab.',
  'Package pin-out shown is a common one; always check the datasheet of a real part.',
]
