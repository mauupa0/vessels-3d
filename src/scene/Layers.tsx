import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { TIERS } from '../lib/tiers'
import type { TreeKind } from '../lib/kinds'
import type { PackedTree } from '../worker/protocol'
import { SEGMENT_STRIDE } from '../lib/generate'
import { PICK_ID, PICK_LAYER, anatomyUniforms, skinUniforms, VESSEL_LOOK, vesselHover, vesselShared } from './registry'
import { patchAnatomy, pickFragment, pickPartVertex, pickVesselFragment, pickVesselVertex, skinFragment, skinVertex, vesselFragment, vesselVertex } from './shaders'

/** Bones, cartilage or organs: one merged mesh, parts told apart by the aPart vertex attribute. */
export function AnatomyLayer({ name, geometry, visible }: { name: 'skeleton' | 'organs'; geometry: THREE.BufferGeometry; visible: boolean }) {
  const uniforms = anatomyUniforms[name]
  const material = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.35, side: THREE.FrontSide, envMapIntensity: 1.35 })
    m.onBeforeCompile = (shader) => patchAnatomy(shader, uniforms)
    m.customProgramCacheKey = () => 'anatomy-' + name
    return m
  }, [name, uniforms])
  const pick = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: pickPartVertex, fragmentShader: pickFragment, uniforms: { uLayer: { value: PICK_ID[name] } }, clipping: true, side: THREE.DoubleSide }),
    [name],
  )
  useEffect(
    () => () => {
      material.dispose()
      pick.dispose()
    },
    [material, pick],
  )
  return (
    <group visible={visible}>
      <mesh geometry={geometry} material={material} renderOrder={name === 'organs' ? 1 : 0} frustumCulled={false} userData={{ layer: name }} />
      <mesh geometry={geometry} material={pick} frustumCulled={false} onUpdate={(m) => m.layers.set(PICK_LAYER)} />
    </group>
  )
}

export function SkinLayer({ geometry, visible }: { geometry: THREE.BufferGeometry; visible: boolean }) {
  const back = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: skinVertex, fragmentShader: skinFragment, side: THREE.BackSide, transparent: true, depthWrite: false, clipping: true, uniforms: skinUniforms.back }),
    [],
  )
  const front = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: skinVertex, fragmentShader: skinFragment, side: THREE.FrontSide, transparent: true, depthWrite: false, clipping: true, uniforms: skinUniforms.front }),
    [],
  )
  useEffect(
    () => () => {
      back.dispose()
      front.dispose()
    },
    [back, front],
  )
  return (
    <group visible={visible}>
      <mesh geometry={geometry} material={back} renderOrder={3} frustumCulled={false} />
      <mesh geometry={geometry} material={front} renderOrder={4} frustumCulled={false} />
    </group>
  )
}

function buildTubeGeometry(tree: PackedTree, radial: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry()
  const unit = new Float32Array((radial + 1) * 2 * 2)
  const pos = new Float32Array((radial + 1) * 2 * 3)
  for (let e = 0; e < 2; e++) {
    for (let i = 0; i <= radial; i++) {
      const o = (e * (radial + 1) + i) * 2
      unit[o] = (i / radial) * Math.PI * 2
      unit[o + 1] = e
    }
  }
  const idx: number[] = []
  for (let i = 0; i < radial; i++) {
    const a = i
    const b = i + 1
    const c = radial + 1 + i
    const d = radial + 1 + i + 1
    idx.push(a, c, b, b, c, d)
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aUnit', new THREE.BufferAttribute(unit, 2))
  g.setIndex(idx)
  const buf = new THREE.InstancedInterleavedBuffer(tree.data, SEGMENT_STRIDE, 1)
  g.setAttribute('aA', new THREE.InterleavedBufferAttribute(buf, 3, 0))
  g.setAttribute('aB', new THREE.InterleavedBufferAttribute(buf, 3, 3))
  g.setAttribute('aRS', new THREE.InterleavedBufferAttribute(buf, 4, 6))
  g.setAttribute('aMeta', new THREE.InterleavedBufferAttribute(buf, 2, 10))
  g.setAttribute('aTA', new THREE.InterleavedBufferAttribute(buf, 3, 12))
  g.setAttribute('aTB', new THREE.InterleavedBufferAttribute(buf, 3, 15))
  g.instanceCount = tree.segments
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3)
  return g
}

/** One vessel tree: atlas centerlines plus the grown branches, drawn as instanced tubes in a single call. */
export function VesselTree({ kind, tree, visible, tier }: { kind: TreeKind; tree: PackedTree; visible: boolean; tier: 'light' | 'full' }) {
  const geometry = useMemo(() => buildTubeGeometry(tree, TIERS[tier].radial), [tree, tier])
  const look = VESSEL_LOOK[kind]
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vesselVertex,
        fragmentShader: vesselFragment,
        clipping: true,
        side: THREE.DoubleSide,
        uniforms: {
          ...vesselShared,
          uHoverInst: vesselHover[kind],
          uSwell: { value: look.swell },
          uAmp: { value: look.amp },
          uGlow: { value: look.glow },
          uBase: { value: new THREE.Color(look.base) },
          uHot: { value: new THREE.Color(look.hot) },
        },
      }),
    [kind, look],
  )
  const pick = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pickVesselVertex,
        fragmentShader: pickVesselFragment,
        clipping: true,
        uniforms: { ...vesselShared, uHoverInst: vesselHover[kind], uSwell: { value: look.swell }, uLayer: { value: PICK_ID[kind] } },
      }),
    [kind, look],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
      pick.dispose()
    },
    [geometry, material, pick],
  )
  return (
    <group visible={visible}>
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} userData={{ layer: kind }} />
      <mesh geometry={geometry} material={pick} frustumCulled={false} onUpdate={(m) => m.layers.set(PICK_LAYER)} />
    </group>
  )
}
