import type { MurrayStats, OrganStats, Reference } from '../lib/generate'
import type { TreeKind } from '../lib/kinds'
import type { Tier } from '../lib/tiers'
import type { VesselsMeta } from '../lib/vesselsData'
import type { VolumeMeta } from '../lib/volume'

export interface WorkerRequest {
  type: 'generate'
  base: string
  volume: VolumeMeta
  vessels: VesselsMeta
  seed: number
  tier: Tier
}

export interface PackedTree {
  kind: TreeKind
  /** 12 floats per segment, see SEGMENT_STRIDE. */
  data: Float32Array
  /** Child node of every segment. */
  child: Int32Array
  segments: number
  nodes: number
  atlasNodes: number
  /** Atlas vessel name index per node (atlas nodes only, length atlasNodes). */
  nameIndex: Uint16Array
  leaves: number
  clamped: number
  attachments: number
  attractors: number
  consumed: number
  abandoned: number
  unreached: number
  iterations: number
  maxDist: number
  leafRadius: number
  growMs: number
}

export interface GenerateDone {
  type: 'done'
  seed: number
  tier: Tier
  trees: Record<TreeKind, PackedTree>
  organStats: Record<string, OrganStats>
  murray: MurrayStats
  references: Reference[]
  /** Copy of the label volume for the slice diagram. */
  labels: Uint8Array
  timings: { loadMs: number; generateMs: number; totalMs: number }
}

export type WorkerMessage = { type: 'progress'; label: string; fraction: number } | GenerateDone | { type: 'error'; message: string }
