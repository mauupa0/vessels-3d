import type { AttractorSet } from './colonization'
import type { TreeKind } from './kinds'
import { mulberry32 } from './rng'
import { L_TISSUE, type Volume } from './volume'

// Relative vessel demand per unit volume. Tissue is the baseline; organs follow how richly perfused they are.
// A higher demand shrinks the kill distance (finer, denser branching). The numbers are design choices, not measurements.
export interface Demand {
  tissue: number
  organs: Record<string, number>
}

const SYSTEMIC_ORGANS: Record<string, number> = {
  brain: 4,
  heart: 5,
  liver: 5,
  spleen: 5,
  stomach: 3,
  pancreas: 4,
  'right-kidney': 9,
  'left-kidney': 9,
  'right-adrenal': 6,
  'left-adrenal': 6,
  'small-intestine': 4.5,
  'large-intestine': 3,
  bladder: 2,
  gallbladder: 1.5,
  trachea: 0.4,
  'right-lung': 0.3,
  'left-lung': 0.3,
}

export const DEMAND: Record<TreeKind, Demand> = {
  artery: { tissue: 1, organs: SYSTEMIC_ORGANS },
  vein: { tissue: 1, organs: SYSTEMIC_ORGANS },
  pulmArtery: { tissue: 0, organs: { 'right-lung': 3.5, 'left-lung': 3.5 } },
  pulmVein: { tissue: 0, organs: { 'right-lung': 3.5, 'left-lung': 3.5 } },
}

export interface ScaleConfig {
  /** Kill distance of plain tissue (m). */
  baseKill: number
  /** Smallest kill distance any organ may reach (m). */
  minKill: number
  /** kill = baseKill / demand^exponent */
  demandExponent: number
  stepRatio: number
  influenceCoarse: number
  influenceFine: number
  /** Attractor spacing as a fraction of the kill distance. */
  spacing: number
}

export interface ClassGrid {
  origin: [number, number, number]
  voxel: number
  dims: [number, number, number]
}

export interface AttractorClass {
  name: string
  grid: ClassGrid
  voxels: Int32Array
  demand: number
}

/** Tissue keeps one voxel away from the skin so that twigs do not reach the surface (chamfer units, thirds of a voxel). */
const SKIN_GAP = 4

export function attractorClasses(volume: Volume, kind: TreeKind): AttractorClass[] {
  const demand = DEMAND[kind]
  const classes: AttractorClass[] = []
  const labels = volume.labels
  const coarse: ClassGrid = { origin: volume.origin, voxel: volume.voxel, dims: volume.dims }
  const fineGrid: ClassGrid = { origin: volume.fine.origin, voxel: volume.fine.voxel, dims: volume.fine.dims }
  if (demand.tissue > 0) {
    const depth = volume.depthGrid()
    const list: number[] = []
    for (let i = 0; i < labels.length; i++) if (labels[i] === L_TISSUE && depth[i] >= SKIN_GAP) list.push(i)
    classes.push({ name: 'tissue', grid: coarse, voxels: Int32Array.from(list), demand: demand.tissue })
  }
  const byLabel = new Map<number, number[]>()
  for (const [id, w] of Object.entries(demand.organs)) {
    const label = volume.organLabels[id]
    if (label !== undefined && w > 0) byLabel.set(label, [])
  }
  const fine = volume.fine.labels
  for (let i = 0; i < fine.length; i++) byLabel.get(fine[i])?.push(i)
  for (const [id, w] of Object.entries(demand.organs)) {
    const list = byLabel.get(volume.organLabels[id])
    if (list && list.length > 0) classes.push({ name: id, grid: fineGrid, voxels: Int32Array.from(list), demand: w })
  }
  return classes
}

export function classKill(demand: number, cfg: ScaleConfig): number {
  return Math.min(cfg.baseKill, Math.max(cfg.minKill, cfg.baseKill / Math.pow(demand, cfg.demandExponent)))
}

/**
 * Scatter attractors. Every class gets a coarse scaffold at the tissue scale (so that fine attractors deep inside an organ
 * are reachable) and, if its demand is high enough, a fine population at its own kill distance.
 * Counts follow volume / spacing^3, so denser organs get more points.
 */
export function sampleAttractors(volume: Volume, kind: TreeKind, cfg: ScaleConfig, seed: number, classes = attractorClasses(volume, kind)): AttractorSet {
  const rnd = mulberry32(seed)
  const pos: number[] = []
  const kill: number[] = []
  const influence: number[] = []
  const step: number[] = []
  const group: number[] = []
  const emit = (c: AttractorClass, k: number, g: number, inf: number) => {
    const [nx, ny] = c.grid.dims
    const v = c.grid.voxel
    const spacing = k * cfg.spacing
    const want = Math.round((c.voxels.length * v * v * v) / (spacing * spacing * spacing))
    for (let q = 0; q < want; q++) {
      const i = c.voxels[Math.floor(rnd() * c.voxels.length)]
      const ix = i % nx
      const iy = Math.floor(i / nx) % ny
      const iz = Math.floor(i / (nx * ny))
      pos.push(c.grid.origin[0] + (ix + rnd()) * v, c.grid.origin[1] + (iy + rnd()) * v, c.grid.origin[2] + (iz + rnd()) * v)
      kill.push(k)
      influence.push(inf)
      step.push(k * cfg.stepRatio)
      group.push(g)
    }
  }
  for (const c of classes) {
    const k = classKill(c.demand, cfg)
    if (k >= cfg.baseKill * 0.999) {
      emit(c, cfg.baseKill, 0, cfg.baseKill * cfg.influenceCoarse)
    } else {
      emit(c, cfg.baseKill, 0, cfg.baseKill * cfg.influenceCoarse)
      emit(c, k, 1, k * cfg.influenceFine)
    }
  }
  return {
    pos: Float32Array.from(pos),
    kill: Float32Array.from(kill),
    influence: Float32Array.from(influence),
    step: Float32Array.from(step),
    group: Uint8Array.from(group),
  }
}
