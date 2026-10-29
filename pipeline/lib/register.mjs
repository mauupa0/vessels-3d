// BodyParts3D -> Z-Anatomy registration. The two atlases share an origin convention but Z-Anatomy was
// scaled (about 4 percent) and its arms and legs were re-posed, so a single transform leaves up to 20 mm.
// Model: one global uniform scale + translation fitted to bone centres, then a Shepard inverse-distance
// interpolation of the remaining per-bone residuals.

export function fitWarp(anchors, { power = 2, soft = 0.03 } = {}) {
  // anchors: [{ from: [x,y,z], to: [x,y,z] }]
  const n = anchors.length
  const mf = [0, 0, 0]
  const mt = [0, 0, 0]
  for (const a of anchors) for (let k = 0; k < 3; k++) { mf[k] += a.from[k] / n; mt[k] += a.to[k] / n }
  let num = 0
  let den = 0
  for (const a of anchors) for (let k = 0; k < 3; k++) { num += (a.from[k] - mf[k]) * (a.to[k] - mt[k]); den += (a.from[k] - mf[k]) ** 2 }
  const s = num / den
  const t = [0, 1, 2].map((k) => mt[k] - s * mf[k])
  const global = (p) => [s * p[0] + t[0], s * p[1] + t[1], s * p[2] + t[2]]
  const residual = anchors.map((a) => {
    const g = global(a.from)
    return { c: a.from, r: [a.to[0] - g[0], a.to[1] - g[1], a.to[2] - g[2]] }
  })
  const warp = (p) => {
    const g = global(p)
    let sw = 0
    let rx = 0
    let ry = 0
    let rz = 0
    for (const q of residual) {
      const dx = p[0] - q.c[0]
      const dy = p[1] - q.c[1]
      const dz = p[2] - q.c[2]
      const w = 1 / (Math.pow(dx * dx + dy * dy + dz * dz + soft * soft, power / 2))
      sw += w
      rx += w * q.r[0]
      ry += w * q.r[1]
      rz += w * q.r[2]
    }
    return [g[0] + rx / sw, g[1] + ry / sw, g[2] + rz / sw]
  }
  const rms = Math.sqrt(residual.reduce((acc, q) => acc + q.r[0] ** 2 + q.r[1] ** 2 + q.r[2] ** 2, 0) / n)
  return { warp, scale: s, translation: t, residualRms: rms }
}

export function warpMesh(mesh, warp) {
  const p = new Float32Array(mesh.positions.length)
  for (let i = 0; i < p.length; i += 3) {
    const q = warp([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]])
    p[i] = q[0]
    p[i + 1] = q[1]
    p[i + 2] = q[2]
  }
  return { positions: p, indices: mesh.indices }
}
