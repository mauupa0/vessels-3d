// Solid voxelisation of a triangle mesh: conservative surface rasterisation (exact triangle-box overlap),
// then a 6-connected flood fill of the exterior. Whatever the flood cannot reach is inside.
// No parity rule, so overlapping shells and tiny holes (smaller than a voxel) do not matter.

export function makeGrid(min, max, voxel, pad = 2) {
  const dims = [0, 1, 2].map((k) => Math.ceil((max[k] - min[k]) / voxel) + 2 * pad)
  const origin = [0, 1, 2].map((k) => min[k] - pad * voxel)
  return { origin, voxel, dims, count: dims[0] * dims[1] * dims[2] }
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// Akenine-Moller separating-axis test. v0..v2 are relative to the box centre, h is the half size.
function triBox(v0, v1, v2, h) {
  const e = [
    [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]],
    [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]],
    [v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]],
  ]
  const vs = [v0, v1, v2]
  for (let k = 0; k < 3; k++) {
    const mn = Math.min(v0[k], v1[k], v2[k])
    const mx = Math.max(v0[k], v1[k], v2[k])
    if (mn > h || mx < -h) return false
  }
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (const ed of e) {
    for (const ax of axes) {
      const a = cross(ed, ax)
      if (a[0] === 0 && a[1] === 0 && a[2] === 0) continue
      const p0 = dot(a, vs[0])
      const p1 = dot(a, vs[1])
      const p2 = dot(a, vs[2])
      const r = h * (Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2]))
      if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false
    }
  }
  const n = cross(e[0], e[1])
  const d = dot(n, v0)
  const r = h * (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]))
  return Math.abs(d) <= r
}

export function rasteriseShell(mesh, grid) {
  const { origin, voxel, dims } = grid
  const shell = new Uint8Array(grid.count)
  const p = mesh.positions
  const h = voxel / 2
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3
    const b = mesh.indices[t + 1] * 3
    const c = mesh.indices[t + 2] * 3
    const lo = [0, 0, 0]
    const hi = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const mn = Math.min(p[a + k], p[b + k], p[c + k])
      const mx = Math.max(p[a + k], p[b + k], p[c + k])
      lo[k] = Math.max(0, Math.floor((mn - origin[k]) / voxel))
      hi[k] = Math.min(dims[k] - 1, Math.floor((mx - origin[k]) / voxel))
    }
    for (let z = lo[2]; z <= hi[2]; z++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let x = lo[0]; x <= hi[0]; x++) {
          const idx = x + dims[0] * (y + dims[1] * z)
          if (shell[idx]) continue
          const cx = origin[0] + (x + 0.5) * voxel
          const cy = origin[1] + (y + 0.5) * voxel
          const cz = origin[2] + (z + 0.5) * voxel
          const v0 = [p[a] - cx, p[a + 1] - cy, p[a + 2] - cz]
          const v1 = [p[b] - cx, p[b + 1] - cy, p[b + 2] - cz]
          const v2 = [p[c] - cx, p[c + 1] - cy, p[c + 2] - cz]
          if (triBox(v0, v1, v2, h)) shell[idx] = 1
        }
      }
    }
  }
  return shell
}

// Returns Uint8Array mask: 1 for shell and enclosed voxels.
export function voxelizeSolid(mesh, grid) {
  return voxelize(mesh, grid).inside
}

// Both masks: `inside` (shell and enclosed voxels) and `interior` (enclosed voxels only, every one of them lies fully inside the mesh).
export function voxelize(mesh, grid) {
  const plain = fill(rasteriseShell(mesh, grid), grid)
  // An open mesh (a lung lobe with its hilum cut away) lets the exterior flood in and leaves only a thin shell.
  // If sealing the shell by one voxel more than a third bigger a solid, trust the sealed one.
  const sealed = fill(dilate(rasteriseShell(mesh, grid), grid, 1), grid)
  let a = 0
  let b = 0
  for (let i = 0; i < plain.inside.length; i++) {
    a += plain.inside[i]
    b += sealed.inside[i]
  }
  return b > a * 1.35 ? { ...sealed, sealedBy: 1 } : { ...plain, sealedBy: 0 }
}

function dilate(mask, grid, r) {
  const { dims } = grid
  let cur = mask
  for (let it = 0; it < r; it++) {
    const next = Uint8Array.from(cur)
    for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
      const i = x + dims[0] * (y + dims[1] * z)
      if (!cur[i]) continue
      if (x > 0) next[i - 1] = 1
      if (x < dims[0] - 1) next[i + 1] = 1
      if (y > 0) next[i - dims[0]] = 1
      if (y < dims[1] - 1) next[i + dims[0]] = 1
      if (z > 0) next[i - dims[0] * dims[1]] = 1
      if (z < dims[2] - 1) next[i + dims[0] * dims[1]] = 1
    }
    cur = next
  }
  return cur
}

function fill(shell, grid) {
  const { dims } = grid
  const outside = new Uint8Array(grid.count)
  const stack = []
  const push = (x, y, z) => {
    const i = x + dims[0] * (y + dims[1] * z)
    if (!shell[i] && !outside[i]) {
      outside[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < dims[0]; x++) for (let y = 0; y < dims[1]; y++) { push(x, y, 0); push(x, y, dims[2] - 1) }
  for (let x = 0; x < dims[0]; x++) for (let z = 0; z < dims[2]; z++) { push(x, 0, z); push(x, dims[1] - 1, z) }
  for (let y = 0; y < dims[1]; y++) for (let z = 0; z < dims[2]; z++) { push(0, y, z); push(dims[0] - 1, y, z) }
  const sx = 1
  const sy = dims[0]
  const sz = dims[0] * dims[1]
  while (stack.length) {
    const i = stack.pop()
    const x = i % dims[0]
    const y = Math.floor(i / sy) % dims[1]
    const z = Math.floor(i / sz)
    if (x > 0) push(x - 1, y, z)
    if (x < dims[0] - 1) push(x + 1, y, z)
    if (y > 0) push(x, y - 1, z)
    if (y < dims[1] - 1) push(x, y + 1, z)
    if (z > 0) push(x, y, z - 1)
    if (z < dims[2] - 1) push(x, y, z + 1)
  }
  const inside = new Uint8Array(grid.count)
  const interior = new Uint8Array(grid.count)
  for (let i = 0; i < grid.count; i++) {
    inside[i] = outside[i] ? 0 : 1
    interior[i] = outside[i] || shell[i] ? 0 : 1
  }
  void sx
  return { inside, interior }
}
