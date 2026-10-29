import { supplyOrgan } from './anatomy'
import { attractorClasses, sampleAttractors } from './attractors'
import { growTree, pruneTwigs, type GrowParams, type GrownTree } from './colonization'
import { isArterial, TREE_KINDS, type TreeKind } from './kinds'
import { murrayRadii } from './murray'
import { hashSeed } from './rng'
import { TIERS, type Tier } from './tiers'
import { Volume, type Vec3 } from './volume'
import type { AtlasTree } from './vesselsData'
import { pathDistances, waveCoords } from './wave'

/**
 * Floats per instanced tube segment: A xyz, B xyz, radius A/B, wave coordinate A/B, organ label, birth,
 * tangent at A (xyz), tangent at B (xyz). Neighbouring segments share their end tangent, so the tubes join seamlessly.
 */
export const SEGMENT_STRIDE = 18

/** Distance from the skin a vessel node must keep (m). */
export const SKIN_MARGIN = 0.007

export interface TreeResult {
  kind: TreeKind
  atlas: AtlasTree
  grown: GrownTree
  radius: Float32Array
  dist: Float32Array
  coord: Float32Array
  maxDist: number
  leaves: number
  clamped: number
  attachments: number
  /** Organ label (3 and up) of the voxel a node sits in, 0 elsewhere. */
  organ: Uint8Array
  growMs: number
}

export interface OrganStats {
  label: number
  /** Generated segments whose end lies in the organ. */
  segments: number
  lengthM: number
  /** Generated leaves (vessel tips) in the organ. */
  tips: number
  rMin: number
  rMax: number
}

export interface MurrayStats {
  junctions: number
  median: number
  p10: number
  p90: number
  /** Histogram of sum(child r^3) / parent r^3 over 0 to 2.5 in 25 bins. */
  bins: number[]
}

export interface Reference {
  name: string
  /** Path length from the heart along the arterial tree (m). */
  metres: number
  radiusMm: number
}

export interface Model {
  seed: number
  tier: Tier
  trees: Record<TreeKind, TreeResult>
  organStats: Record<string, OrganStats>
  murray: MurrayStats
  references: Reference[]
  totalMs: number
}

export type Progress = (label: string, fraction: number) => void

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const LABELS: Record<TreeKind, string> = {
  artery: 'Growing systemic arteries',
  vein: 'Growing systemic veins',
  pulmArtery: 'Growing pulmonary arteries',
  pulmVein: 'Growing pulmonary veins',
}
const SALT: Record<TreeKind, number> = { artery: 1, vein: 2, pulmArtery: 3, pulmVein: 4 }

export function volumeBounds(volume: Volume): { min: Vec3; max: Vec3 } {
  return {
    min: [...volume.origin] as Vec3,
    max: [0, 1, 2].map((k) => volume.origin[k] + volume.dims[k] * volume.voxel) as Vec3,
  }
}

export function growParams(tier: Tier, seed: number, kind: TreeKind): GrowParams {
  const cfg = TIERS[tier]
  return {
    tropism: 0.8,
    seedTropism: 0.25,
    jitter: 0.2,
    maxNodes: cfg.maxNodes,
    feedMaxRadius: 0.0045,
    feedStride: cfg.feedStride,
    atlasKillFactor: cfg.atlasKillFactor,
    seed: hashSeed(seed, 10 + SALT[kind]),
  }
}

export function generateModel(volume: Volume, atlas: Record<TreeKind, AtlasTree>, seed: number, tier: Tier, progress?: Progress): Model {
  const cfg = TIERS[tier]
  const t0 = now()
  const bounds = volumeBounds(volume)
  // inside the skin, outside bone, and a branch that has entered an organ stays in that organ
  const allows = (x: number, y: number, z: number, fx: number, fy: number, fz: number) => {
    if (!volume.allows(x, y, z, SKIN_MARGIN)) return false
    const from = volume.organAt(fx, fy, fz)
    return from === 0 || volume.organAt(x, y, z) === from
  }
  const trees = {} as Record<TreeKind, TreeResult>
  const step = 1 / TREE_KINDS.length
  let arterialMax: Record<'systemic' | 'pulmonary', number> = { systemic: 0, pulmonary: 0 }
  TREE_KINDS.forEach((kind, ti) => {
    const base = ti * step
    progress?.(LABELS[kind], base)
    const t1 = now()
    const at = atlas[kind]
    const classes = attractorClasses(volume, kind)
    const attractors = sampleAttractors(volume, kind, cfg.scale, hashSeed(seed, SALT[kind]), classes)
    const raw = growTree({
      kind,
      seedTree: { pos: at.pos, parent: at.parent, radius: at.radius },
      attractors,
      params: growParams(tier, seed, kind),
      bounds,
      allows,
      onProgress: (f) => progress?.(LABELS[kind], base + f * step),
    })
    const grown = pruneTwigs(raw, cfg.minTwig)
    const { radius, leaves, clamped, attachments } = murrayRadii(grown.parent, grown.count, grown.atlasCount, at.radius, cfg.leafRadius)
    const dist = pathDistances(grown.pos, grown.parent, grown.count)
    const circuit = kind === 'artery' || kind === 'vein' ? 'systemic' : 'pulmonary'
    const { coord, maxDist } = waveCoords(kind, dist, arterialMax[circuit])
    if (isArterial(kind)) arterialMax = { ...arterialMax, [circuit]: maxDist }
    const organ = new Uint8Array(grown.count)
    for (let i = 0; i < grown.count; i++) {
      organ[i] = volume.organAt(grown.pos[i * 3], grown.pos[i * 3 + 1], grown.pos[i * 3 + 2])
    }
    // Atlas vessels belong to an organ by name only (hepatic veins to the liver, renal arteries to the kidney), wherever they run.
    // A voxel label would flicker along a trunk that grazes an organ and cut it into beads when the organ is isolated.
    for (let i = 0; i < grown.atlasCount; i++) {
      const id = supplyOrgan(at.names[at.nameIndex[i]] ?? '')
      organ[i] = (id ? volume.organLabels[id] : undefined) ?? 0
    }
    trees[kind] = { kind, atlas: at, grown, radius, dist, coord, maxDist, leaves, clamped, attachments, organ, growMs: now() - t1 }
  })
  progress?.('Done', 1)
  return { seed, tier, trees, organStats: organStatistics(volume, trees), murray: atlasMurray(atlas), references: referencePaths(trees.artery), totalMs: now() - t0 }
}

export function organStatistics(volume: Volume, trees: Record<TreeKind, TreeResult>): Record<string, OrganStats> {
  const stats: Record<string, OrganStats> = {}
  const byLabel = new Map<number, OrganStats>()
  for (const [id, label] of Object.entries(volume.organLabels)) {
    const s: OrganStats = { label, segments: 0, lengthM: 0, tips: 0, rMin: Infinity, rMax: 0 }
    stats[id] = s
    byLabel.set(label, s)
  }
  for (const kind of TREE_KINDS) {
    const t = trees[kind]
    const g = t.grown
    const hasChild = new Uint8Array(g.count)
    for (let i = g.atlasCount; i < g.count; i++) hasChild[g.parent[i]] = 1
    for (let i = g.atlasCount; i < g.count; i++) {
      const s = byLabel.get(t.organ[i])
      if (!s) continue
      const p = g.parent[i]
      s.segments++
      s.lengthM += Math.hypot(g.pos[i * 3] - g.pos[p * 3], g.pos[i * 3 + 1] - g.pos[p * 3 + 1], g.pos[i * 3 + 2] - g.pos[p * 3 + 2])
      if (!hasChild[i]) s.tips++
      if (t.radius[i] < s.rMin) s.rMin = t.radius[i]
      if (t.radius[i] > s.rMax) s.rMax = t.radius[i]
    }
  }
  for (const s of Object.values(stats)) if (!isFinite(s.rMin)) s.rMin = 0
  return stats
}

export interface PackedSegments {
  data: Float32Array
  /** Child node of every segment, to map a picked instance back to the tree. */
  child: Int32Array
  count: number
}

function unit(x: number, y: number, z: number, fx = 0, fy = 1, fz = 0): [number, number, number] {
  const l = Math.hypot(x, y, z)
  return l < 1e-9 ? [fx, fy, fz] : [x / l, y / l, z / l]
}

export function packSegments(r: TreeResult): PackedSegments {
  const g = r.grown
  let segs = 0
  for (let i = 0; i < g.count; i++) if (g.parent[i] >= 0) segs++
  const data = new Float32Array(segs * SEGMENT_STRIDE)
  const child = new Int32Array(segs)
  // the thickest child of every node is its continuation: the tube joins it ring to ring
  const main = new Int32Array(g.count).fill(-1)
  for (let i = 0; i < g.count; i++) {
    const p = g.parent[i]
    if (p >= 0 && (main[p] < 0 || r.radius[i] > r.radius[main[p]])) main[p] = i
  }
  const dir = (a: number, b: number): [number, number, number] => unit(g.pos[b * 3] - g.pos[a * 3], g.pos[b * 3 + 1] - g.pos[a * 3 + 1], g.pos[b * 3 + 2] - g.pos[a * 3 + 2])
  let o = 0
  let s = 0
  for (let i = 0; i < g.count; i++) {
    const p = g.parent[i]
    if (p < 0) continue
    data[o++] = g.pos[p * 3]
    data[o++] = g.pos[p * 3 + 1]
    data[o++] = g.pos[p * 3 + 2]
    data[o++] = g.pos[i * 3]
    data[o++] = g.pos[i * 3 + 1]
    data[o++] = g.pos[i * 3 + 2]
    // a side branch starts at its own radius: only the continuation shares the parent's ring, otherwise every twig flares out of a thin trunk like a cone
    data[o++] = main[p] === i ? r.radius[p] : Math.min(r.radius[p], r.radius[i])
    data[o++] = r.radius[i]
    data[o++] = r.coord[p]
    data[o++] = r.coord[i]
    data[o++] = r.organ[i]
    data[o++] = g.birth[i]
    const own = dir(p, i)
    const incoming = g.parent[p] >= 0 ? dir(g.parent[p], p) : own
    const outgoing = main[i] >= 0 ? dir(i, main[i]) : own
    const ta = unit(incoming[0] + own[0], incoming[1] + own[1], incoming[2] + own[2], incoming[0], incoming[1], incoming[2])
    const tb = unit(own[0] + outgoing[0], own[1] + outgoing[1], own[2] + outgoing[2], own[0], own[1], own[2])
    data[o++] = ta[0]
    data[o++] = ta[1]
    data[o++] = ta[2]
    data[o++] = tb[0]
    data[o++] = tb[1]
    data[o++] = tb[2]
    child[s++] = i
  }
  return { data, child, count: segs }
}

/**
 * How closely the atlas itself follows Murray's law: at every junction of the atlas trees (parent thicker than 1.5 mm),
 * the ratio of the children's summed cubed radii to the parent's cubed radius. Murray predicts 1.
 */
export function atlasMurray(atlas: Record<TreeKind, AtlasTree>): MurrayStats {
  const ratios: number[] = []
  for (const kind of TREE_KINDS) {
    const t = atlas[kind]
    const sum = new Float64Array(t.count)
    const kids = new Uint16Array(t.count)
    for (let i = 0; i < t.count; i++) {
      const p = t.parent[i]
      if (p < 0) continue
      sum[p] += t.radius[i] ** 3
      kids[p]++
    }
    for (let i = 0; i < t.count; i++) {
      if (kids[i] >= 2 && t.radius[i] >= 0.0015) ratios.push(sum[i] / t.radius[i] ** 3)
    }
  }
  ratios.sort((a, b) => a - b)
  const at = (q: number) => (ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))] : 0)
  const bins = new Array(25).fill(0)
  for (const r of ratios) bins[Math.min(24, Math.floor(r / 0.1))]++
  return { junctions: ratios.length, median: at(0.5), p10: at(0.1), p90: at(0.9), bins }
}

const REFERENCE_VESSELS = ['Right superficial temporal artery', 'Right brachial artery', 'Right radial artery', 'Right femoral artery', 'Right popliteal artery', 'Right dorsalis pedis artery']

/** Path length from the aortic root to the far end of a few named atlas arteries, for the pulse diagram. */
export function referencePaths(t: TreeResult): Reference[] {
  const out: Reference[] = []
  const names = t.atlas.names
  for (const want of REFERENCE_VESSELS) {
    const idx = names.indexOf(want)
    if (idx < 0) continue
    let far = -1
    for (let i = 0; i < t.atlas.count; i++) if (t.atlas.nameIndex[i] === idx && (far < 0 || t.dist[i] > t.dist[far])) far = i
    if (far >= 0) out.push({ name: want, metres: t.dist[far], radiusMm: t.radius[far] * 1000 })
  }
  return out
}
