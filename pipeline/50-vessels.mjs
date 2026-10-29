// Stage 5: atlas vessel trees (centerlines + radii) from the Z-Anatomy curves, written as one binary.
import fs from 'node:fs'
import { OUT, ZANA } from './lib/paths.mjs'
import { bbox, readZana } from './lib/mesh.mjs'
import { buildTree, classify, KINDS } from './lib/vessels.mjs'
import { toScene } from './lib/frame.mjs'
import { rleDecode } from './lib/rle.mjs'

const meta = JSON.parse(fs.readFileSync(OUT + '/anatomy.json', 'utf8'))
const vol = meta.volume
const labels = rleDecode(fs.readFileSync(OUT + '/' + vol.file), vol.dims)
const labelAt = (p) => {
  const x = Math.floor((p[0] - vol.origin[0]) / vol.voxel)
  const y = Math.floor((p[1] - vol.origin[1]) / vol.voxel)
  const z = Math.floor((p[2] - vol.origin[2]) / vol.voxel)
  if (x < 0 || y < 0 || z < 0 || x >= vol.dims[0] || y >= vol.dims[1] || z >= vol.dims[2]) return 0
  return labels[x + vol.dims[0] * (y + vol.dims[1] * z)]
}

const curves = JSON.parse(fs.readFileSync(ZANA + '/zana_curves.json', 'utf8'))
const zana = readZana(ZANA)
const center = (n) => toScene(bbox(zana.get(n)).center)
const side = (s) => (s === 'l' ? 'Left' : s === 'r' ? 'Right' : '')
export function pretty(raw) {
  let n = raw.replace(/#\d+$/, '').replace(/^\((.*)\)(\.[lr])?$/, '$1$2')
  const m = n.match(/^(.*)\.([lr])$/)
  let s = ''
  if (m) { n = m[1]; s = side(m[2]) }
  n = n.replace(/\s*\(.*\)\s*$/, (x) => x).trim()
  n = n[0].toUpperCase() + n.slice(1)
  return s ? s + ' ' + n[0].toLowerCase() + n.slice(1) : n
}

const byKind = Object.fromEntries(KINDS.map((k) => [k, []]))
for (const cu of curves) {
  const k = classify(cu.name)
  if (!k) continue
  cu.splines.forEach((sp, i) => {
    if (sp.length < 2) return
    byKind[k].push({ name: pretty(cu.name), pts: sp.map((p) => [...toScene(p), p[3]]) })
  })
}

const ra = center('Right atrium')
const la = center('Left atrium')
const pt = bbox(zana.get('Pulmonary trunk'))
const ptBottom = toScene([pt.center[0], pt.center[1], pt.min[2]])
const roots = {
  artery: { rootSpline: 'Ascending aorta', tol: 0.03 },
  vein: { root: { pos: ra, radius: 0.0125, name: 'Right atrium' }, tol: 0.03, rootTol: 0.08 },
  pulmArtery: { root: { pos: ptBottom, radius: 0.014, name: 'Pulmonary trunk' }, tol: 0.03, rootTol: 0.08 },
  pulmVein: { root: { pos: la, radius: 0.012, name: 'Left atrium' }, tol: 0.03, rootTol: 0.08 },
}

const chunks = []
let off = 0
const push = (arr) => {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
  const o = off
  chunks.push(buf)
  off += buf.length
  const pad = (4 - (off % 4)) % 4
  if (pad) { chunks.push(Buffer.alloc(pad)); off += pad }
  return o
}
const trees = {}
for (const k of KINDS) {
  const cfg = roots[k]
  const t = buildTree(byKind[k], cfg.root ?? null, cfg)
  // drop nodes outside the skin (head and hand arteries hug the surface), relinking their children
  const keep = new Int32Array(t.pos.length).fill(-1)
  const outPos = []
  const outPar = []
  const outRad = []
  const outName = []
  let dropped = 0
  const parentOf = new Int32Array(t.pos.length)
  for (let i = 0; i < t.pos.length; i++) {
    let p = t.parent[i]
    while (p >= 0 && keep[p] < 0) p = t.parent[p]
    parentOf[i] = p
    const inside = labelAt(t.pos[i]) !== 0 || i === t.rootId
    if (!inside) { dropped++; continue }
    keep[i] = outPos.length
    outPos.push(t.pos[i])
    outPar.push(p < 0 ? -1 : keep[p])
    outRad.push(t.radius[i])
    outName.push(t.name[i])
  }
  const n = outPos.length
  const pos = new Float32Array(n * 3)
  outPos.forEach((p, i) => pos.set(p, i * 3))
  const o = {
    count: n,
    names: t.names,
    root: 0,
    dropped,
    orphans: t.stats.orphans,
    pos: push(pos),
    radius: push(Float32Array.from(outRad)),
    parent: push(Int32Array.from(outPar)),
    name: push(Uint16Array.from(outName)),
  }
  trees[k] = o
  console.log(k.padEnd(11), 'nodes', n, 'dropped outside skin', dropped, 'orphans', t.stats.orphans.length, 'names', t.names.length, 'max radius mm', (Math.max(...outRad) * 1000).toFixed(1))
}
fs.writeFileSync(OUT + '/vessels.bin', Buffer.concat(chunks))
meta.vessels = { file: 'vessels.bin', bytes: off, trees, heart: { rightAtrium: ra, leftAtrium: la, leftVentricle: center('Left ventricle'), rightVentricle: center('Right ventricle'), pulmonaryTrunk: ptBottom } }
fs.writeFileSync(OUT + '/anatomy.json', JSON.stringify(meta))
console.log('vessels.bin', (off / 1024).toFixed(0), 'KB')
