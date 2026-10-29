// The BodyParts3D skin is an anatomically complete male body. For a public showcase the genital region is
// flattened into a smooth pubic mound: vertices inside a soft box are pushed back to a sloping plane.
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export const GROIN = { halfWidth: 0.058, zTop: 0.865, zBottom: 0.7, yTop: -0.086, yBottom: -0.05, feather: 0.018 }

export function planeY(z) {
  const t = Math.min(1, Math.max(0, (z - GROIN.zBottom) / (GROIN.zTop - GROIN.zBottom)))
  return GROIN.yBottom + (GROIN.yTop - GROIN.yBottom) * t
}

// y is posterior-positive: anterior = more negative. Anything more anterior than the plane is clamped to it.
export function flattenGroin(mesh) {
  const p = Float32Array.from(mesh.positions)
  const g = GROIN
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]
    const z = p[i + 2]
    const wx = 1 - smooth(g.halfWidth - g.feather, g.halfWidth, Math.abs(x))
    const wz = smooth(g.zBottom - g.feather, g.zBottom, z) * (1 - smooth(g.zTop, g.zTop + g.feather, z))
    const w = wx * wz
    if (w <= 0) continue
    const plane = planeY(Math.min(g.zTop, Math.max(g.zBottom, z)))
    if (p[i + 1] < plane) p[i + 1] = p[i + 1] + (plane - p[i + 1]) * w
  }
  return { positions: p, indices: mesh.indices }
}

// Laplacian smoothing restricted to the same soft box; melts what the clamp left of the protrusion.
export function smoothGroin(mesh, iterations = 40) {
  const g = GROIN
  const n = mesh.positions.length / 3
  const nbr = Array.from({ length: n }, () => new Set())
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]
    nbr[a].add(b).add(c)
    nbr[b].add(a).add(c)
    nbr[c].add(a).add(b)
  }
  const w = new Float32Array(n)
  for (let v = 0; v < n; v++) {
    const x = mesh.positions[v * 3]
    const z = mesh.positions[v * 3 + 2]
    const wx = 1 - smooth(g.halfWidth + 0.01, g.halfWidth + 0.04, Math.abs(x))
    const wz = smooth(g.zBottom - 0.03, g.zBottom + 0.02, z) * (1 - smooth(g.zTop - 0.01, g.zTop + 0.04, z))
    w[v] = wx * wz
  }
  let p = Float32Array.from(mesh.positions)
  const q = new Float32Array(p.length)
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < n; v++) {
      if (w[v] <= 0 || nbr[v].size === 0) {
        q[v * 3] = p[v * 3]
        q[v * 3 + 1] = p[v * 3 + 1]
        q[v * 3 + 2] = p[v * 3 + 2]
        continue
      }
      let x = 0
      let y = 0
      let z = 0
      for (const u of nbr[v]) {
        x += p[u * 3]
        y += p[u * 3 + 1]
        z += p[u * 3 + 2]
      }
      const k = nbr[v].size
      const a = 0.6 * w[v]
      q[v * 3] = p[v * 3] + a * (x / k - p[v * 3])
      q[v * 3 + 1] = p[v * 3 + 1] + a * (y / k - p[v * 3 + 1])
      q[v * 3 + 2] = p[v * 3 + 2] + a * (z / k - p[v * 3 + 2])
    }
    p.set(q)
  }
  return { positions: p, indices: mesh.indices }
}
