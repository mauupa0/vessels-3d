export type Vec3 = [number, number, number]

export const L_OUTSIDE = 0
export const L_TISSUE = 1
export const L_BONE = 2

export interface FineMeta {
  file: string
  bytes: number
  origin: Vec3
  voxel: number
  dims: Vec3
  voxels: Record<string, number>
}

export interface VolumeMeta {
  file: string
  bytes: number
  origin: Vec3
  voxel: number
  dims: Vec3
  labels: { outside: number; tissue: number; bone: number; organs: Record<string, number> }
  voxels: Record<string, number>
  /** Organs only, at a finer voxel size. */
  fine: FineMeta
}

// Row-wise run-length coding written by pipeline/lib/rle.mjs: (label, LEB128 run length) pairs per x-row.
export function rleDecode(bytes: Uint8Array, dims: Vec3): Uint8Array {
  const labels = new Uint8Array(dims[0] * dims[1] * dims[2])
  let o = 0
  let p = 0
  while (p < bytes.length) {
    const v = bytes[p++]
    let n = 0
    let shift = 0
    for (;;) {
      const b = bytes[p++]
      n |= (b & 0x7f) << shift
      if (b < 0x80) break
      shift += 7
    }
    labels.fill(v, o, o + n)
    o += n
  }
  if (o !== labels.length) throw new Error('volume stream length mismatch: ' + o + ' of ' + labels.length)
  return labels
}

// 3-4-5 chamfer distance transform, in thirds of a voxel, saturating at 255. Seeds are distance 0.
export function chamfer(labels: Uint8Array, dims: Vec3, isSeed: (label: number) => boolean): Uint8Array {
  const [nx, ny, nz] = dims
  const d = new Uint8Array(labels.length)
  for (let i = 0; i < labels.length; i++) d[i] = isSeed(labels[i]) ? 0 : 255
  const sx = 1
  const sy = nx
  const sz = nx * ny
  const relax = (i: number, j: number, w: number) => {
    const v = d[j] + w
    if (v < d[i]) d[i] = v > 255 ? 255 : v
  }
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = x + y * sy + z * sz
        if (d[i] === 0) continue
        for (let dz = -1; dz <= 0; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dz === 0 && (dy > 0 || (dy === 0 && dx >= 0))) continue
              const xx = x + dx
              const yy = y + dy
              const zz = z + dz
              if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny) continue
              const k = Math.abs(dx) + Math.abs(dy) + Math.abs(dz)
              relax(i, xx * sx + yy * sy + zz * sz, k === 1 ? 3 : k === 2 ? 4 : 5)
            }
          }
        }
      }
    }
  }
  for (let z = nz - 1; z >= 0; z--) {
    for (let y = ny - 1; y >= 0; y--) {
      for (let x = nx - 1; x >= 0; x--) {
        const i = x + y * sy + z * sz
        if (d[i] === 0) continue
        for (let dz = 0; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dz === 0 && (dy < 0 || (dy === 0 && dx <= 0))) continue
              const xx = x + dx
              const yy = y + dy
              const zz = z + dz
              if (xx < 0 || yy < 0 || zz >= nz || xx >= nx || yy >= ny) continue
              const k = Math.abs(dx) + Math.abs(dy) + Math.abs(dz)
              relax(i, xx * sx + yy * sy + zz * sz, k === 1 ? 3 : k === 2 ? 4 : 5)
            }
          }
        }
      }
    }
  }
  return d
}

export interface FineGrid {
  origin: Vec3
  voxel: number
  dims: Vec3
  labels: Uint8Array
}

export class Volume {
  readonly dims: Vec3
  readonly origin: Vec3
  readonly voxel: number
  readonly labels: Uint8Array
  readonly fine: FineGrid
  readonly organLabels: Record<string, number>
  private depthField: Uint8Array | null = null
  private readonly sy: number
  private readonly sz: number

  constructor(meta: Pick<VolumeMeta, 'dims' | 'origin' | 'voxel' | 'labels'> & { fine: Pick<FineMeta, 'origin' | 'voxel' | 'dims'> }, labels: Uint8Array, fineLabels: Uint8Array) {
    this.fine = { origin: meta.fine.origin, voxel: meta.fine.voxel, dims: meta.fine.dims, labels: fineLabels }
    this.dims = meta.dims
    this.origin = meta.origin
    this.voxel = meta.voxel
    this.labels = labels
    this.organLabels = meta.labels.organs
    this.sy = meta.dims[0]
    this.sz = meta.dims[0] * meta.dims[1]
  }

  index(x: number, y: number, z: number): number {
    const ix = Math.floor((x - this.origin[0]) / this.voxel)
    const iy = Math.floor((y - this.origin[1]) / this.voxel)
    const iz = Math.floor((z - this.origin[2]) / this.voxel)
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.dims[0] || iy >= this.dims[1] || iz >= this.dims[2]) return -1
    return ix + iy * this.sy + iz * this.sz
  }

  labelAt(x: number, y: number, z: number): number {
    const i = this.index(x, y, z)
    return i < 0 ? L_OUTSIDE : this.labels[i]
  }

  /** Organ label (3 and up) at 3 mm resolution, 0 where no organ is. */
  organAt(x: number, y: number, z: number): number {
    const f = this.fine
    const ix = Math.floor((x - f.origin[0]) / f.voxel)
    const iy = Math.floor((y - f.origin[1]) / f.voxel)
    const iz = Math.floor((z - f.origin[2]) / f.voxel)
    if (ix < 0 || iy < 0 || iz < 0 || ix >= f.dims[0] || iy >= f.dims[1] || iz >= f.dims[2]) return 0
    return f.labels[ix + f.dims[0] * (iy + f.dims[1] * iz)]
  }

  /** Chamfer distance to the nearest outside voxel in thirds of a voxel (0 outside the body). Built lazily. */
  depthGrid(): Uint8Array {
    if (!this.depthField) this.depthField = chamfer(this.labels, this.dims, (l) => l === L_OUTSIDE)
    return this.depthField
  }

  /** Distance to the nearest outside voxel, in metres (0 outside the body). */
  depthAt(x: number, y: number, z: number): number {
    const i = this.index(x, y, z)
    if (i < 0) return 0
    return (this.depthGrid()[i] / 3) * this.voxel
  }

  /** Whether a vessel node may sit here: inside the skin by `margin` and not inside bone. */
  allows(x: number, y: number, z: number, margin: number): boolean {
    const i = this.index(x, y, z)
    if (i < 0) return false
    const l = this.labels[i]
    if (l === L_OUTSIDE || l === L_BONE) return false
    if (margin <= 0) return true
    return this.depthAt(x, y, z) >= margin
  }

  organCount(label: number): number {
    let n = 0
    for (let i = 0; i < this.labels.length; i++) if (this.labels[i] === label) n++
    return n
  }
}
