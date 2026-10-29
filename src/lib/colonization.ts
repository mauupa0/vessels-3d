import type { TreeKind } from './kinds'
import { mulberry32 } from './rng'
import type { Vec3 } from './volume'

export interface GrowParams {
  /** Inertia of generated branches (weight of the previous direction). */
  tropism: number
  /** Inertia of a sprout leaving an atlas node. Low, so side branches leave sideways. */
  seedTropism: number
  jitter: number
  /** Cap on atlas plus generated nodes. */
  maxNodes: number
  /** Atlas nodes thicker than this (m) do not sprout unless they are a tip. */
  feedMaxRadius: number
  /** Atlas nodes between 1.2 mm and feedMaxRadius: only every k-th node sprouts. */
  feedStride: number
  /** Attractors die this many kill distances from an atlas node: tissue next to a real vessel counts as supplied. */
  atlasKillFactor: number
  seed: number
}

export interface SeedTree {
  pos: Float32Array
  parent: Int32Array
  radius: Float32Array
}

/**
 * Attractor points with their own scale. A node feels an attractor within `influence`, the attractor is consumed
 * when any node comes closer than `kill`, and a node pulled by it extends by `step`. Two spatial groups let a
 * sparse scaffold (large influence) and a dense fine population (small influence) share one tree cheaply.
 */
export interface AttractorSet {
  pos: Float32Array
  kill: Float32Array
  influence: Float32Array
  step: Float32Array
  group: Uint8Array
}

export interface GrownTree {
  kind: TreeKind
  count: number
  atlasCount: number
  pos: Float32Array
  parent: Int32Array
  /** Iteration that created the node divided by the iteration count; 0 for atlas nodes. Replays the growth. */
  birth: Float32Array
  attractorsTotal: number
  attractorsConsumed: number
  attractorsUnreached: number
  attractorsAbandoned: number
  iterations: number
}

export interface GrowOptions {
  kind: TreeKind
  seedTree: SeedTree
  attractors: AttractorSet
  params: GrowParams
  bounds: { min: Vec3; max: Vec3 }
  /** Whether a node may be placed at (x, y, z) when it grows from (fx, fy, fz): inside the body, outside bone, and an organ is not left. */
  allows: (x: number, y: number, z: number, fx: number, fy: number, fz: number) => boolean
  onProgress?: (fraction: number) => void
}

const THIN = 0.0012
const GROUPS = 2

interface Grid {
  cell: number
  gx: number
  gy: number
  gz: number
  start: Int32Array
  items: Int32Array
}

function buildGrid(set: AttractorSet, group: number, bounds: { min: Vec3; max: Vec3 }): Grid {
  let cell = 1e-3
  let count = 0
  const na = set.group.length
  for (let a = 0; a < na; a++) {
    if (set.group[a] !== group) continue
    count++
    if (set.influence[a] > cell) cell = set.influence[a]
  }
  const gx = Math.ceil((bounds.max[0] - bounds.min[0]) / cell) + 1
  const gy = Math.ceil((bounds.max[1] - bounds.min[1]) / cell) + 1
  const gz = Math.ceil((bounds.max[2] - bounds.min[2]) / cell) + 1
  const start = new Int32Array(gx * gy * gz + 1)
  const cellOf = new Int32Array(na).fill(-1)
  for (let a = 0; a < na; a++) {
    if (set.group[a] !== group) continue
    const ix = Math.min(gx - 1, Math.max(0, Math.floor((set.pos[a * 3] - bounds.min[0]) / cell)))
    const iy = Math.min(gy - 1, Math.max(0, Math.floor((set.pos[a * 3 + 1] - bounds.min[1]) / cell)))
    const iz = Math.min(gz - 1, Math.max(0, Math.floor((set.pos[a * 3 + 2] - bounds.min[2]) / cell)))
    const c = ix + gx * (iy + gy * iz)
    cellOf[a] = c
    start[c + 1]++
  }
  for (let c = 0; c < gx * gy * gz; c++) start[c + 1] += start[c]
  const fill = start.slice(0, gx * gy * gz)
  const items = new Int32Array(count)
  for (let a = 0; a < na; a++) if (cellOf[a] >= 0) items[fill[cellOf[a]]++] = a
  return { cell, gx, gy, gz, start, items }
}

export function growTree(opts: GrowOptions): GrownTree {
  const { kind, seedTree, attractors, params, bounds, allows } = opts
  const rnd = mulberry32(params.seed)
  const cap = Math.min(params.maxNodes, 800000)
  const atlasCount = seedTree.parent.length
  if (atlasCount > cap) throw new Error('node cap smaller than the atlas tree')
  const pos = new Float32Array(cap * 3)
  const parent = new Int32Array(cap)
  const birthIter = new Uint16Array(cap)
  pos.set(seedTree.pos)
  parent.set(seedTree.parent)
  let n = atlasCount

  const hasChild = new Uint8Array(atlasCount)
  for (let i = 0; i < atlasCount; i++) if (seedTree.parent[i] >= 0) hasChild[seedTree.parent[i]] = 1
  const feedsAtlas = new Uint8Array(atlasCount)
  for (let i = 0; i < atlasCount; i++) {
    const r = seedTree.radius[i]
    feedsAtlas[i] = !hasChild[i] || (r <= params.feedMaxRadius && (r <= THIN || i % params.feedStride === 0)) ? 1 : 0
  }

  const ap = attractors.pos
  const na = attractors.group.length
  const kill2 = new Float32Array(na)
  const killAtlas2 = new Float32Array(na)
  const inf2 = new Float32Array(na)
  for (let a = 0; a < na; a++) {
    kill2[a] = attractors.kill[a] * attractors.kill[a]
    killAtlas2[a] = kill2[a] * params.atlasKillFactor * params.atlasKillFactor
    inf2[a] = attractors.influence[a] * attractors.influence[a]
  }
  const alive = new Uint8Array(na).fill(1)
  const nearest = new Int32Array(na).fill(-1)
  const nearD2 = new Float32Array(na).fill(Infinity)
  const lastD2 = new Float32Array(na).fill(Infinity)
  const stall = new Uint8Array(na)
  let aliveCount = na
  let abandoned = 0

  const grids: Grid[] = []
  for (let g = 0; g < GROUPS; g++) grids.push(buildGrid(attractors, g, bounds))
  const minX = bounds.min[0]
  const minY = bounds.min[1]
  const minZ = bounds.min[2]

  const touchNodes = (from: number, to: number) => {
    for (let node = from; node < to; node++) {
      const feeds = node >= atlasCount || feedsAtlas[node] === 1
      const px = pos[node * 3]
      const py = pos[node * 3 + 1]
      const pz = pos[node * 3 + 2]
      for (let g = 0; g < GROUPS; g++) {
        const grid = grids[g]
        if (grid.items.length === 0) continue
        const ix = Math.floor((px - minX) / grid.cell)
        const iy = Math.floor((py - minY) / grid.cell)
        const iz = Math.floor((pz - minZ) / grid.cell)
        for (let z = Math.max(0, iz - 1); z <= Math.min(grid.gz - 1, iz + 1); z++) {
          for (let y = Math.max(0, iy - 1); y <= Math.min(grid.gy - 1, iy + 1); y++) {
            for (let x = Math.max(0, ix - 1); x <= Math.min(grid.gx - 1, ix + 1); x++) {
              const c = x + grid.gx * (y + grid.gy * z)
              for (let q = grid.start[c]; q < grid.start[c + 1]; q++) {
                const a = grid.items[q]
                if (!alive[a]) continue
                const dx = ap[a * 3] - px
                const dy = ap[a * 3 + 1] - py
                const dz = ap[a * 3 + 2] - pz
                const d2 = dx * dx + dy * dy + dz * dz
                if (d2 < (node < atlasCount ? killAtlas2[a] : kill2[a])) {
                  alive[a] = 0
                  aliveCount--
                } else if (feeds && d2 < inf2[a] && d2 < nearD2[a]) {
                  nearD2[a] = d2
                  nearest[a] = node
                }
              }
            }
          }
        }
      }
    }
  }

  touchNodes(0, n)

  const sx = new Float32Array(cap)
  const sy = new Float32Array(cap)
  const sz = new Float32Array(cap)
  const cnt = new Uint16Array(cap)
  const minStep = new Float32Array(cap).fill(Infinity)
  const touched: number[] = []
  let iterations = 0
  const startAlive = aliveCount
  const maxIter = 4000
  while (iterations < maxIter && aliveCount > 0 && n < cap) {
    iterations++
    touched.length = 0
    for (let a = 0; a < na; a++) {
      if (!alive[a]) continue
      const node = nearest[a]
      if (node < 0) continue
      if (nearD2[a] < lastD2[a] * 0.98) {
        lastD2[a] = nearD2[a]
        stall[a] = 0
      } else if (++stall[a] > 14) {
        alive[a] = 0
        aliveCount--
        abandoned++
        continue
      }
      const dx = ap[a * 3] - pos[node * 3]
      const dy = ap[a * 3 + 1] - pos[node * 3 + 1]
      const dz = ap[a * 3 + 2] - pos[node * 3 + 2]
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      if (cnt[node] === 0) touched.push(node)
      cnt[node]++
      sx[node] += dx / l
      sy[node] += dy / l
      sz[node] += dz / l
      if (attractors.step[a] < minStep[node]) minStep[node] = attractors.step[a]
    }
    const before = n
    for (let t = 0; t < touched.length; t++) {
      const node = touched[t]
      let dx = sx[node]
      let dy = sy[node]
      let dz = sz[node]
      const step = minStep[node]
      sx[node] = sy[node] = sz[node] = 0
      cnt[node] = 0
      minStep[node] = Infinity
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (l < 1e-6 || n >= cap) continue
      dx /= l
      dy /= l
      dz /= l
      const par = parent[node]
      let tx = 0
      let ty = 0
      let tz = 0
      if (par >= 0) {
        tx = pos[node * 3] - pos[par * 3]
        ty = pos[node * 3 + 1] - pos[par * 3 + 1]
        tz = pos[node * 3 + 2] - pos[par * 3 + 2]
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
        tx /= tl
        ty /= tl
        tz /= tl
      }
      const trop = node < atlasCount ? params.seedTropism : params.tropism
      let nx = dx + trop * tx + params.jitter * (rnd() * 2 - 1)
      let ny = dy + trop * ty + params.jitter * (rnd() * 2 - 1)
      let nz = dz + trop * tz + params.jitter * (rnd() * 2 - 1)
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      nx /= nl
      ny /= nl
      nz /= nl
      let px = pos[node * 3] + nx * step
      let py = pos[node * 3 + 1] + ny * step
      let pz = pos[node * 3 + 2] + nz * step
      const fx = pos[node * 3]
      const fy = pos[node * 3 + 1]
      const fz = pos[node * 3 + 2]
      if (!allows(px, py, pz, fx, fy, fz)) {
        px = fx + dx * step
        py = fy + dy * step
        pz = fz + dz * step
        if (!allows(px, py, pz, fx, fy, fz)) continue
      }
      pos[n * 3] = px
      pos[n * 3 + 1] = py
      pos[n * 3 + 2] = pz
      parent[n] = node
      birthIter[n] = iterations
      n++
    }
    if (n === before) break
    touchNodes(before, n)
    if (opts.onProgress && (iterations & 7) === 0) opts.onProgress(1 - aliveCount / Math.max(1, startAlive))
  }
  opts.onProgress?.(1)

  const birth = new Float32Array(n)
  for (let i = atlasCount; i < n; i++) birth[i] = birthIter[i] / Math.max(1, iterations)

  return {
    kind,
    count: n,
    atlasCount,
    pos: pos.slice(0, n * 3),
    parent: parent.slice(0, n),
    birth,
    attractorsTotal: na,
    attractorsConsumed: na - aliveCount - abandoned,
    attractorsUnreached: aliveCount,
    attractorsAbandoned: abandoned,
    iterations,
  }
}

/**
 * Remove generated twigs (leaf chains without a branching point) shorter than `minLength`.
 * Space colonization leaves many one or two step stubs next to existing vessels; they carry no blood anywhere.
 * Atlas nodes keep their indices, generated nodes are compacted in creation order.
 */
export function pruneTwigs(g: GrownTree, minLength: number): GrownTree {
  const { count, atlasCount, pos, parent } = g
  const dead = new Uint8Array(count)
  const children = new Int32Array(count)
  for (let i = atlasCount; i < count; i++) children[parent[i]]++
  const edge = (i: number) => {
    const p = parent[i]
    return Math.hypot(pos[i * 3] - pos[p * 3], pos[i * 3 + 1] - pos[p * 3 + 1], pos[i * 3 + 2] - pos[p * 3 + 2])
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (let i = count - 1; i >= atlasCount; i--) {
      if (dead[i] || children[i] !== 0) continue
      const chain: number[] = []
      let len = 0
      let node = i
      for (;;) {
        chain.push(node)
        len += edge(node)
        const p = parent[node]
        if (p < atlasCount || children[p] !== 1 || dead[p]) break
        node = p
      }
      if (len < minLength) {
        for (const c of chain) {
          dead[c] = 1
          children[parent[c]]--
        }
        changed = true
      }
    }
    if (!changed) break
  }
  const remap = new Int32Array(count)
  let n = 0
  for (let i = 0; i < count; i++) remap[i] = dead[i] ? -1 : n++
  const npos = new Float32Array(n * 3)
  const npar = new Int32Array(n)
  const nbirth = new Float32Array(n)
  for (let i = 0; i < count; i++) {
    const j = remap[i]
    if (j < 0) continue
    npos[j * 3] = pos[i * 3]
    npos[j * 3 + 1] = pos[i * 3 + 1]
    npos[j * 3 + 2] = pos[i * 3 + 2]
    npar[j] = parent[i] < 0 ? -1 : remap[parent[i]]
    nbirth[j] = g.birth[i]
  }
  return { ...g, count: n, pos: npos, parent: npar, birth: nbirth }
}
