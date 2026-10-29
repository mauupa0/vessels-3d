import * as THREE from 'three'
import type { TreeKind } from '../lib/kinds'
import type { Pick } from '../store'
import { camState, PICK_ID, PICK_LAYER } from './registry'

const LAYER_OF: Record<number, Pick['layer']> = {}
for (const [layer, id] of Object.entries(PICK_ID)) LAYER_OF[id] = layer as 'skeleton' | 'organs' | TreeKind

/**
 * GPU picking. The pick meshes (layer 1) carry the same geometry as the visible ones but write an id instead of a colour.
 * The camera is narrowed to the single pixel under the cursor, so the extra pass costs one vertex sweep and no fragment work.
 * Occlusion, hidden layers and the section plane come for free because they are the same draw state.
 */
export class Picker {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    generateMipmaps: false,
  })
  private readonly buf = new Uint8Array(4)
  private readonly clear = new THREE.Color()

  constructor() {
    this.target.texture.colorSpace = THREE.NoColorSpace
  }

  pick(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, x: number, y: number): Pick | null {
    const { w, h, ox, oy } = camState
    if (x < 0 || y < 0 || x >= w || y >= h) return null
    const prevTarget = gl.getRenderTarget()
    const prevAuto = gl.autoClear
    const prevClearAlpha = gl.getClearAlpha()
    gl.getClearColor(this.clear)
    const prevBackground = scene.background
    const prevMask = camera.layers.mask
    scene.background = null
    camera.layers.set(PICK_LAYER)
    camera.setViewOffset(w, h, ox + Math.floor(x), oy + Math.floor(y), 1, 1)
    gl.setRenderTarget(this.target)
    gl.setClearColor(0x000000, 0)
    gl.autoClear = true
    gl.render(scene, camera)
    gl.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.buf)
    gl.setRenderTarget(prevTarget)
    gl.autoClear = prevAuto
    gl.setClearColor(this.clear, prevClearAlpha)
    scene.background = prevBackground
    camera.layers.mask = prevMask
    camera.setViewOffset(w, h, ox, oy, w, h)
    const layerId = this.buf[3]
    if (layerId === 0) return null
    const layer = LAYER_OF[layerId]
    if (!layer) return null
    const index = layer === 'skeleton' || layer === 'organs' ? this.buf[0] + this.buf[1] * 256 : this.buf[0] + this.buf[1] * 256 + this.buf[2] * 65536
    return { layer, index }
  }

  dispose() {
    this.target.dispose()
  }
}
