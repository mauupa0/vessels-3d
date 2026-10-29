import * as THREE from 'three'
import type { TreeKind } from '../lib/kinds'
import { beat, WAVELENGTH } from '../beat'
import { ACCENT, makeAnatomyUniforms, type AnatomyUniforms } from './shaders'

export const BG = '#070a0d'
export const FOV = 30
export { WAVELENGTH }

/** Id written into the alpha channel of the pick target, per pickable layer. */
export const PICK_ID: Record<'skeleton' | 'organs' | TreeKind, number> = { skeleton: 1, organs: 2, artery: 3, vein: 4, pulmArtery: 5, pulmVein: 6 }
export const PICK_LAYER = 1

/** Everything the frame loop writes and the materials read. Created once, shared by materials and pick materials. */
export const anatomyUniforms: Record<'skeleton' | 'organs', AnatomyUniforms> = {
  skeleton: makeAnatomyUniforms(),
  organs: makeAnatomyUniforms(),
}

export const skinUniforms = {
  back: {
    uTint: { value: new THREE.Color('#6f7f8c') },
    uEdge: { value: new THREE.Color('#bcd2df') },
    uBase: { value: 0.012 },
    uStrength: { value: 0.07 },
    uPower: { value: 1.7 },
    uGhost: { value: 0 },
    uKey: { value: new THREE.Vector3(-0.4, 0.8, 0.5) },
  },
  front: {
    uTint: { value: new THREE.Color('#8397a6') },
    uEdge: { value: new THREE.Color('#dff0fa') },
    uBase: { value: 0.012 },
    uStrength: { value: 0.85 },
    uPower: { value: 2.7 },
    uGhost: { value: 0 },
    uKey: { value: new THREE.Vector3(-0.4, 0.8, 0.5) },
  },
}

export const vesselShared = {
  uBeat: beat,
  uInvWavelength: { value: 1 / WAVELENGTH },
  uPxScale: { value: 0.001 },
  uMinPx: { value: 1.25 },
  uGrowth: { value: 1 },
  uSelOrgan: { value: -1 },
  uFocus: { value: 0 },
  uBoost: { value: 1.25 },
  uMinRadius: { value: 0 },
  uFog: { value: new THREE.Color(BG) },
  uFogNear: { value: 2.2 },
  uFogFar: { value: 4.2 },
  uAccent: { value: ACCENT.clone() },
}

export interface VesselLook {
  base: string
  hot: string
  swell: number
  amp: number
  glow: number
}

export const VESSEL_LOOK: Record<TreeKind, VesselLook> = {
  artery: { base: '#b3121f', hot: '#ff6a3d', swell: 0.2, amp: 1, glow: 1.5 },
  vein: { base: '#2358c8', hot: '#5eb2ff', swell: 0.06, amp: 0.8, glow: 1.0 },
  pulmArtery: { base: '#3a4fc9', hot: '#7aa8ff', swell: 0.12, amp: 0.9, glow: 1.1 },
  pulmVein: { base: '#c2201f', hot: '#ff7a4a', swell: 0.08, amp: 0.85, glow: 1.2 },
}

export const vesselHover: Record<TreeKind, { value: number }> = {
  artery: { value: -1 },
  vein: { value: -1 },
  pulmArtery: { value: -1 },
  pulmVein: { value: -1 },
}

/** The section plane shared by all materials through the renderer's global clipping planes. */
export const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10)

/** Body extent used to map the section slider onto each axis (scene frame, metres). */
export const BODY_RANGE = { x: [-0.34, 0.34], y: [0.0, 1.72], z: [-0.17, 0.2] } as const

export const camState = {
  /** View offset of the main camera, so the 1 x 1 pick window can be composed with it. */
  w: 1,
  h: 1,
  ox: 0,
  oy: 0,
}
