// Test helper: loads the built anatomy assets from public/anatomy with node:fs (never imported by the app).
import fs from 'node:fs'
import path from 'node:path'
import type { AnatomyMeta } from './anatomy'
import { TREE_KINDS, type TreeKind } from './kinds'
import { decodeAtlasTree, type AtlasTree } from './vesselsData'
import { rleDecode, Volume } from './volume'

const dir = path.resolve(__dirname, '../../public/anatomy')

export type AnatomyMetaFile = AnatomyMeta

export function loadMeta(): AnatomyMetaFile {
  return JSON.parse(fs.readFileSync(path.join(dir, 'anatomy.json'), 'utf8'))
}

export function loadVolume(meta = loadMeta()): Volume {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, meta.volume.file)))
  const fine = new Uint8Array(fs.readFileSync(path.join(dir, meta.volume.fine.file)))
  return new Volume(meta.volume, rleDecode(bytes, meta.volume.dims), rleDecode(fine, meta.volume.fine.dims))
}

export function loadAtlas(meta = loadMeta()): Record<TreeKind, AtlasTree> {
  const raw = fs.readFileSync(path.join(dir, meta.vessels.file))
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  const out = {} as Record<TreeKind, AtlasTree>
  for (const k of TREE_KINDS) out[k] = decodeAtlasTree(k, meta.vessels.trees[k], buf)
  return out
}

// ---- GLB reading (tests only): decode a shipped layer into scene-frame positions ----
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

export async function readGlb(file: string): Promise<{ positions: Float32Array; part: Uint16Array | null; indices: Uint32Array }> {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.read(path.join(dir, file))
  const node = doc.getRoot().listNodes().find((n) => n.getMesh())!
  const prim = node.getMesh()!.listPrimitives()[0]
  const pos = prim.getAttribute('POSITION')!
  const m = node.getWorldMatrix()
  const out = new Float32Array(pos.getCount() * 3)
  const v = [0, 0, 0]
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v)
    out[i * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]
    out[i * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]
    out[i * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
  }
  const part = prim.getAttribute('_PART')
  const idx = prim.getIndices()!
  return { positions: out, part: part ? Uint16Array.from(part.getArray() as ArrayLike<number>) : null, indices: Uint32Array.from(idx.getArray() as ArrayLike<number>) }
}

/** Highest anterior (z) of any vertex in the groin box. A smooth mannequin groin stays below the limit. */
export function groinProtrusion(positions: Float32Array): number {
  let max = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    if (Math.abs(x) < 0.05 && y > 0.745 && y < 0.83 && positions[i + 2] > max) max = positions[i + 2]
  }
  return max
}
