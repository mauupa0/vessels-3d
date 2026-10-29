import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { BASE } from './assetBase'
import { GROUP_COLOR, ORGANS, type AnatomyMeta, type LayerName, type PartMeta } from './anatomy'

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

function floatAttribute(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize)
  for (let i = 0; i < a.count; i++) {
    out[i * a.itemSize] = a.getX(i)
    if (a.itemSize > 1) out[i * a.itemSize + 1] = a.getY(i)
    if (a.itemSize > 2) out[i * a.itemSize + 2] = a.getZ(i)
  }
  return new THREE.BufferAttribute(out, a.itemSize)
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

/** Per-part base colour as linear vertex colours; bones get a small deterministic variation so the skeleton is not one flat tone. */
export function colourParts(geometry: THREE.BufferGeometry, parts: PartMeta[]) {
  const part = geometry.getAttribute('aPart') as THREE.BufferAttribute
  const colours = new Float32Array(part.count * 3)
  const byIndex = new Map(parts.map((p) => [p.index, p]))
  const palette = new Map<number, THREE.Color>()
  const c = new THREE.Color()
  for (const p of parts) {
    if (p.group === 'organ') c.set(ORGANS[p.id]?.color ?? '#c88')
    else {
      c.set(GROUP_COLOR[p.group as 'bone' | 'cartilage'])
      const h = hash(p.id)
      c.offsetHSL((h - 0.5) * 0.02, (h - 0.5) * 0.06, (h - 0.5) * 0.07)
    }
    palette.set(p.index, c.clone())
  }
  for (let i = 0; i < part.count; i++) {
    const col = palette.get(part.getX(i)) ?? palette.get(byIndex.keys().next().value as number)!
    colours[i * 3] = col.r
    colours[i * 3 + 1] = col.g
    colours[i * 3 + 2] = col.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  // surface finish per vertex: roughness and clearcoat of the part
  const surf = new Float32Array(part.count * 2)
  const finish = new Map<number, [number, number]>()
  for (const p of parts) {
    const info = ORGANS[p.id]
    finish.set(p.index, info ? [info.roughness, info.clearcoat] : p.group === 'cartilage' ? [0.5, 0.2] : [0.62, 0.1])
  }
  for (let i = 0; i < part.count; i++) {
    const f = finish.get(part.getX(i)) ?? [0.6, 0.1]
    surf[i * 2] = f[0]
    surf[i * 2 + 1] = f[1]
  }
  geometry.setAttribute('aSurf', new THREE.BufferAttribute(surf, 2))
}

export async function loadLayer(name: LayerName, meta: AnatomyMeta): Promise<THREE.BufferGeometry> {
  const gltf = await loader.loadAsync(BASE + meta.layers[name].file)
  gltf.scene.updateMatrixWorld(true)
  let mesh: THREE.Mesh | null = null
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !mesh) mesh = o as THREE.Mesh
  })
  if (!mesh) throw new Error(name + '.glb has no mesh')
  const src = (mesh as THREE.Mesh).geometry
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', floatAttribute(src.getAttribute('position')))
  g.setAttribute('normal', floatAttribute(src.getAttribute('normal')))
  const part = src.getAttribute('_part')
  if (part) g.setAttribute('aPart', floatAttribute(part))
  g.setIndex(src.getIndex())
  g.applyMatrix4((mesh as THREE.Mesh).matrixWorld)
  // a rotation or non-uniform scale in the node would skew the normals, so renormalise
  const n = g.getAttribute('normal') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < n.count; i++) n.setXYZ(i, ...v.fromBufferAttribute(n, i).normalize().toArray())
  g.computeBoundingSphere()
  g.computeBoundingBox()
  src.dispose()
  if (name !== 'skin' && part) colourParts(g, meta.parts.filter((p) => p.layer === name))
  return g
}
