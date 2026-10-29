// Stage 4: voxel label volume (outside / tissue / bone / one label per organ) from the built meshes.
import fs from 'node:fs'
import { DATA, OUT } from './lib/paths.mjs'
import { loadParts } from './lib/binmesh.mjs'
import { bbox } from './lib/mesh.mjs'
import { makeGrid, voxelize, voxelizeSolid } from './lib/voxel.mjs'
import { rleEncode } from './lib/rle.mjs'

const VOXEL = 0.006
const parts = loadParts(DATA + '/built')
const meta = JSON.parse(fs.readFileSync(OUT + '/anatomy.json', 'utf8'))
const skin = parts.find((p) => p.id === 'skin')
const sb = bbox(skin.mesh)
const grid = makeGrid(sb.min, sb.max, VOXEL, 3)
console.log('grid', grid.dims.join('x'), grid.count, 'voxels')

const labels = new Uint8Array(grid.count)
const t0 = Date.now()
const inside = voxelizeSolid(skin.mesh, grid)
let tissue = 0
for (let i = 0; i < grid.count; i++) if (inside[i]) { labels[i] = 1; tissue++ }
console.log('skin voxelised in', Date.now() - t0, 'ms, volume', (tissue * VOXEL ** 3 * 1000).toFixed(1), 'L')

function localGrid(mesh, pad = 2) {
  const b = bbox(mesh)
  const lo = [0, 1, 2].map((k) => Math.max(0, Math.floor((b.min[k] - grid.origin[k]) / VOXEL) - pad))
  const hi = [0, 1, 2].map((k) => Math.min(grid.dims[k] - 1, Math.floor((b.max[k] - grid.origin[k]) / VOXEL) + pad))
  const dims = [0, 1, 2].map((k) => hi[k] - lo[k] + 1)
  return { lo, grid: { origin: lo.map((v, k) => grid.origin[k] + v * VOXEL), voxel: VOXEL, dims, count: dims[0] * dims[1] * dims[2] } }
}
// Organs are labelled with their interior only: every labelled voxel lies fully inside the mesh, so a vessel node in it
// cannot poke through the surface. Organs too thin for that (fewer than MIN_INTERIOR voxels) keep the shell voxels.
const MIN_INTERIOR = 40
function paint(mesh, label, interiorOnly = false) {
  const { lo, grid: g } = localGrid(mesh)
  let m
  if (interiorOnly) {
    const r = voxelize(mesh, g)
    let n = 0
    for (let i = 0; i < r.interior.length; i++) n += r.interior[i]
    m = n >= MIN_INTERIOR ? r.interior : r.inside
  } else m = voxelizeSolid(mesh, g)
  let n = 0
  for (let z = 0; z < g.dims[2]; z++) for (let y = 0; y < g.dims[1]; y++) for (let x = 0; x < g.dims[0]; x++) {
    if (!m[x + g.dims[0] * (y + g.dims[1] * z)]) continue
    const gi = lo[0] + x + grid.dims[0] * (lo[1] + y + grid.dims[1] * (lo[2] + z))
    if (labels[gi] === 0) continue
    labels[gi] = label
    n++
  }
  return n
}

// bones first (label 2), organs after so an organ wins where a rib overlaps it
const t1 = Date.now()
for (const p of parts.filter((q) => q.group === 'bone')) paint(p.mesh, 2)
console.log('bones painted in', Date.now() - t1, 'ms')
const organs = parts.filter((q) => q.group === 'organ')
const organLabels = {}
organs.forEach((p, i) => {
  const label = 3 + i
  organLabels[p.id] = label
  const n = paint(p.mesh, label)
  console.log(p.id.padEnd(18), 'label', label, n, 'voxels', (n * VOXEL ** 3 * 1e6).toFixed(0), 'mL')
})

// Fine organ grid (3 mm): the coarse grid is too blunt for organ boundaries, and vessel branches must not poke through them.
const FINE = 0.003
const omin = [Infinity, Infinity, Infinity]
const omax = [-Infinity, -Infinity, -Infinity]
for (const p of organs) {
  const b = bbox(p.mesh)
  for (let k = 0; k < 3; k++) {
    omin[k] = Math.min(omin[k], b.min[k])
    omax[k] = Math.max(omax[k], b.max[k])
  }
}
const fineGrid = makeGrid(omin, omax, FINE, 2)
const fine = new Uint8Array(fineGrid.count)
const fineCounts = {}
organs.forEach((p, i) => {
  const label = 3 + i
  const b = bbox(p.mesh)
  const lo = [0, 1, 2].map((k) => Math.max(0, Math.floor((b.min[k] - fineGrid.origin[k]) / FINE) - 1))
  const hi = [0, 1, 2].map((k) => Math.min(fineGrid.dims[k] - 1, Math.floor((b.max[k] - fineGrid.origin[k]) / FINE) + 1))
  const dims = [0, 1, 2].map((k) => hi[k] - lo[k] + 1)
  const g = { origin: lo.map((v, k) => fineGrid.origin[k] + v * FINE), voxel: FINE, dims, count: dims[0] * dims[1] * dims[2] }
  const m = voxelizeSolid(p.mesh, g)
  let n = 0
  for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
    if (!m[x + dims[0] * (y + dims[1] * z)]) continue
    const gi = lo[0] + x + fineGrid.dims[0] * (lo[1] + y + fineGrid.dims[1] * (lo[2] + z))
    if (fine[gi] === 0) { fine[gi] = label; n++ }
  }
  fineCounts[label] = n
})
// Anchor of every organ: its bounding box centre if that lies inside the organ, otherwise the nearest voxel of the organ.
// (A bent or hollow organ such as the colon or the stomach has an empty bounding box centre.)
const anchors = {}
{
  const voxelCentre = (i) => {
    const ix = i % fineGrid.dims[0]
    const iy = Math.floor(i / fineGrid.dims[0]) % fineGrid.dims[1]
    const iz = Math.floor(i / (fineGrid.dims[0] * fineGrid.dims[1]))
    return [fineGrid.origin[0] + (ix + 0.5) * FINE, fineGrid.origin[1] + (iy + 0.5) * FINE, fineGrid.origin[2] + (iz + 0.5) * FINE]
  }
  const best = new Map(organs.map((p, i) => [3 + i, { d: Infinity, c: null, id: p.id, centre: bbox(p.mesh).center }]))
  for (let i = 0; i < fine.length; i++) {
    const b = best.get(fine[i])
    if (!b) continue
    const c = voxelCentre(i)
    const d = (c[0] - b.centre[0]) ** 2 + (c[1] - b.centre[1]) ** 2 + (c[2] - b.centre[2]) ** 2
    if (d < b.d) { b.d = d; b.c = c }
  }
  for (const b of best.values()) {
    const ix = Math.floor((b.centre[0] - fineGrid.origin[0]) / FINE)
    const iy = Math.floor((b.centre[1] - fineGrid.origin[1]) / FINE)
    const iz = Math.floor((b.centre[2] - fineGrid.origin[2]) / FINE)
    const label = 3 + organs.findIndex((p) => p.id === b.id)
    const inside = ix >= 0 && iy >= 0 && iz >= 0 && ix < fineGrid.dims[0] && iy < fineGrid.dims[1] && iz < fineGrid.dims[2] && fine[ix + fineGrid.dims[0] * (iy + fineGrid.dims[1] * iz)] === label
    anchors[b.id] = (inside ? b.centre : b.c).map((v) => +v.toFixed(4))
    console.log(b.id.padEnd(16), inside ? 'centre inside' : 'anchor moved ' + (Math.sqrt(b.d) * 1000).toFixed(0) + ' mm')
  }
}
for (const p of meta.parts) if (anchors[p.id]) p.anchor = anchors[p.id]
const fineEncoded = rleEncode(fine, fineGrid.dims)
fs.writeFileSync(OUT + '/organs.bin', fineEncoded)
console.log('organs.bin', fineGrid.dims.join('x'), (fineEncoded.length / 1024).toFixed(0), 'KB')

const counts = new Array(256).fill(0)
for (let i = 0; i < grid.count; i++) counts[labels[i]]++
const encoded = rleEncode(labels, grid.dims)
fs.writeFileSync(OUT + '/volume.bin', encoded)
meta.volume = {
  file: 'volume.bin',
  bytes: encoded.length,
  origin: grid.origin.map((v) => +v.toFixed(5)),
  voxel: VOXEL,
  dims: grid.dims,
  labels: { outside: 0, tissue: 1, bone: 2, organs: organLabels },
  voxels: Object.fromEntries(counts.map((c, i) => [i, c]).filter(([, c]) => c > 0)),
  fine: { file: 'organs.bin', bytes: fineEncoded.length, origin: fineGrid.origin.map((v) => +v.toFixed(5)), voxel: FINE, dims: fineGrid.dims, voxels: fineCounts },
}
fs.writeFileSync(OUT + '/anatomy.json', JSON.stringify(meta))
console.log('volume.bin', (encoded.length / 1024).toFixed(0), 'KB')
