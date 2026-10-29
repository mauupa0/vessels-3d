import { MeshoptSimplifier } from 'meshoptimizer'

export function vertexNormals(positions, indices) {
  const n = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    // area-weighted face normal (not normalised)
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const o of [a, b, c]) {
      n[o] += nx
      n[o + 1] += ny
      n[o + 2] += nz
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= l
    n[i + 1] /= l
    n[i + 2] /= l
  }
  return n
}

// Drop vertices no triangle uses; returns a compact mesh.
export function compact(mesh) {
  const remap = new Int32Array(mesh.positions.length / 3).fill(-1)
  const pos = []
  const idx = new Uint32Array(mesh.indices.length)
  let next = 0
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = mesh.indices[i]
    if (remap[v] < 0) {
      remap[v] = next++
      pos.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
    }
    idx[i] = remap[v]
  }
  return { positions: new Float32Array(pos), indices: idx }
}

export async function simplify(mesh, targetTris, { minTris = 60, error = 0.02 } = {}) {
  await MeshoptSimplifier.ready
  const tris = mesh.indices.length / 3
  const target = Math.max(minTris, Math.floor(targetTris))
  if (tris <= target) return mesh
  const [idx] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target * 3, error, [])
  return compact({ positions: mesh.positions, indices: idx })
}

export function midpointSubdivide(mesh) {
  const pos = Array.from(mesh.positions)
  const cache = new Map()
  const mid = (a, b) => {
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a
    let m = cache.get(key)
    if (m === undefined) {
      m = pos.length / 3
      pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2)
      cache.set(key, m)
    }
    return m
  }
  const idx = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]
    const b = mesh.indices[i + 1]
    const c = mesh.indices[i + 2]
    const ab = mid(a, b)
    const bc = mid(b, c)
    const ca = mid(c, a)
    idx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

// Taubin lambda|mu smoothing: shrinks high frequency noise without shrinking the volume.
export function taubin(mesh, iterations = 8, lambda = 0.5, mu = -0.53) {
  const n = mesh.positions.length / 3
  const nbr = Array.from({ length: n }, () => new Set())
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]
    const b = mesh.indices[i + 1]
    const c = mesh.indices[i + 2]
    nbr[a].add(b).add(c)
    nbr[b].add(a).add(c)
    nbr[c].add(a).add(b)
  }
  let p = Float32Array.from(mesh.positions)
  const tmp = new Float32Array(p.length)
  const step = (f) => {
    for (let v = 0; v < n; v++) {
      const s = nbr[v]
      if (s.size === 0) {
        tmp[v * 3] = p[v * 3]
        tmp[v * 3 + 1] = p[v * 3 + 1]
        tmp[v * 3 + 2] = p[v * 3 + 2]
        continue
      }
      let x = 0
      let y = 0
      let z = 0
      for (const q of s) {
        x += p[q * 3]
        y += p[q * 3 + 1]
        z += p[q * 3 + 2]
      }
      x /= s.size
      y /= s.size
      z /= s.size
      tmp[v * 3] = p[v * 3] + f * (x - p[v * 3])
      tmp[v * 3 + 1] = p[v * 3 + 1] + f * (y - p[v * 3 + 1])
      tmp[v * 3 + 2] = p[v * 3 + 2] + f * (z - p[v * 3 + 2])
    }
    p.set(tmp)
  }
  for (let i = 0; i < iterations; i++) {
    step(lambda)
    step(mu)
  }
  return { positions: p, indices: mesh.indices }
}

// Volume of a closed triangle mesh (divergence theorem), in cubic units of the positions.
export function meshVolume(mesh) {
  const p = mesh.positions
  let v = 0
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3
    const b = mesh.indices[i + 1] * 3
    const c = mesh.indices[i + 2] * 3
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6
  }
  return Math.abs(v)
}
