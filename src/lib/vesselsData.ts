import type { TreeKind } from './kinds'

export interface TreeMeta {
  count: number
  names: string[]
  root: number
  dropped: number
  orphans: string[]
  pos: number
  radius: number
  parent: number
  name: number
}

export interface AtlasTree {
  kind: TreeKind
  count: number
  pos: Float32Array
  radius: Float32Array
  parent: Int32Array
  nameIndex: Uint16Array
  names: string[]
}

export interface VesselsMeta {
  file: string
  bytes: number
  trees: Record<TreeKind, TreeMeta>
  heart: { rightAtrium: number[]; leftAtrium: number[]; leftVentricle: number[]; rightVentricle: number[]; pulmonaryTrunk: number[] }
}

export function decodeAtlasTree(kind: TreeKind, meta: TreeMeta, buf: ArrayBuffer): AtlasTree {
  const n = meta.count
  return {
    kind,
    count: n,
    pos: new Float32Array(buf, meta.pos, n * 3),
    radius: new Float32Array(buf, meta.radius, n),
    parent: new Int32Array(buf, meta.parent, n),
    nameIndex: new Uint16Array(buf, meta.name, n),
    names: meta.names,
  }
}
