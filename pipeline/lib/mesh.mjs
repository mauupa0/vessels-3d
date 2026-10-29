import fs from 'node:fs'

// A mesh is { positions: Float32Array (xyz, metres, BodyParts3D frame), indices: Uint32Array }.
export function readBp3dObj(file) {
  const text = fs.readFileSync(file, 'utf8')
  const pos = []
  const idx = []
  for (const line of text.split('\n')) {
    if (line.charCodeAt(0) === 118 && line.charCodeAt(1) === 32) {
      const p = line.trim().split(/\s+/)
      pos.push(+p[1] / 1000, +p[2] / 1000, +p[3] / 1000)
    } else if (line.charCodeAt(0) === 102 && line.charCodeAt(1) === 32) {
      const p = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1)
      for (let i = 1; i < p.length - 1; i++) idx.push(p[0], p[i], p[i + 1])
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

export function readZana(dir) {
  const index = JSON.parse(fs.readFileSync(dir + '/zana_meshes.json', 'utf8'))
  const blob = fs.readFileSync(dir + '/zana_meshes.bin')
  const ab = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)
  const out = new Map()
  for (const e of index) {
    out.set(e.name, {
      positions: new Float32Array(ab.slice(e.voff, e.voff + e.vertices * 12)),
      indices: new Uint32Array(ab.slice(e.ioff, e.ioff + e.triangles * 12)),
    })
  }
  return out
}

export function bbox(m) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const p = m.positions
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k]
      if (p[i + k] > max[k]) max[k] = p[i + k]
    }
  }
  return { min, max, center: min.map((v, k) => (v + max[k]) / 2) }
}

export function merge(meshes) {
  let nv = 0
  let ni = 0
  for (const m of meshes) {
    nv += m.positions.length
    ni += m.indices.length
  }
  const positions = new Float32Array(nv)
  const indices = new Uint32Array(ni)
  let vo = 0
  let io = 0
  for (const m of meshes) {
    positions.set(m.positions, vo)
    const base = vo / 3
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base
    vo += m.positions.length
    io += m.indices.length
  }
  return { positions, indices }
}

// Merge vertices closer than `eps` (hash grid), drop degenerate triangles.
export function weld(m, eps = 1e-5) {
  const p = m.positions
  const map = new Map()
  const remap = new Uint32Array(p.length / 3)
  const keep = []
  for (let i = 0; i < p.length / 3; i++) {
    const key = Math.round(p[i * 3] / eps) + ',' + Math.round(p[i * 3 + 1] / eps) + ',' + Math.round(p[i * 3 + 2] / eps)
    let j = map.get(key)
    if (j === undefined) {
      j = keep.length / 3
      map.set(key, j)
      keep.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
    }
    remap[i] = j
  }
  const idx = []
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = remap[m.indices[i]]
    const b = remap[m.indices[i + 1]]
    const c = remap[m.indices[i + 2]]
    if (a !== b && b !== c && a !== c) idx.push(a, b, c)
  }
  return { positions: new Float32Array(keep), indices: new Uint32Array(idx) }
}
