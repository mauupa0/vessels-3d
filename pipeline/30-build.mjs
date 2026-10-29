// Stage 3: smooth, decimate, convert to the scene frame and write the web assets.
import fs from 'node:fs'
import { DATA, OUT } from './lib/paths.mjs'
import { loadParts, saveParts } from './lib/binmesh.mjs'
import { merge, weld, bbox } from './lib/mesh.mjs'
import { meshVolume, midpointSubdivide, simplify, taubin } from './lib/geom.mjs'
import { flattenGroin, smoothGroin } from './lib/groin.mjs'
import { toSceneMesh } from './lib/frame.mjs'
import { writeGlb } from './lib/glb.mjs'

const COPYRIGHT = 'Derived from BodyParts3D (DBCLS) and Z-Anatomy (CC BY-SA 4.0). See README.'
const parts = loadParts(DATA + '/assembled')

// per-part treatment: [smoothing, targetTris]
const treat = {
  skin: { pre: (m) => taubin(smoothGroin(flattenGroin(weld(m, 2e-5))), 4), tris: 42000, error: 0.004 },
  brain: { pre: (m) => taubin(weld(m, 2e-5), 5), tris: 42000 },
  'small-intestine': { pre: (m) => taubin(midpointSubdivide(weld(m, 2e-5)), 10), tris: 30000 },
  heart: { tris: 20000 },
  'right-lung': { tris: 14000 },
  'left-lung': { tris: 11000 },
  'large-intestine': { tris: 16000 },
  liver: { tris: 9000 },
  stomach: { tris: 6000 },
  pancreas: { tris: 3000 },
  trachea: { tris: 3500 },
}
const boneTarget = (p) => (p.group === 'cartilage' ? p.triangles * 0.12 : p.triangles * 0.2)

const out = []
for (const p of parts) {
  const t = treat[p.id]
  let mesh = p.mesh
  if (t?.pre) mesh = t.pre(mesh)
  const target = t?.tris ?? (p.group === 'organ' ? p.triangles * 0.5 : boneTarget(p))
  mesh = await simplify(mesh, target, { minTris: p.group === 'bone' ? 140 : 60, error: t?.error ?? 0.03 })
  out.push({ id: p.id, name: p.name, group: p.group, mesh: toSceneMesh(mesh) })
}

fs.mkdirSync(OUT, { recursive: true })
const layers = { skin: ['skin'], skeleton: ['bone', 'cartilage'], organs: ['organ'] }
const meta = { parts: [], layers: {}, source: COPYRIGHT }
for (const [layer, groups] of Object.entries(layers)) {
  const sel = out.filter((p) => groups.includes(p.group))
  const merged = merge(sel.map((p) => p.mesh))
  const partIds = new Uint16Array(merged.positions.length / 3)
  let vo = 0
  sel.forEach((p, i) => {
    const n = p.mesh.positions.length / 3
    partIds.fill(i, vo, vo + n)
    vo += n
    const b = bbox(p.mesh)
    meta.parts.push({
      id: p.id,
      name: p.name,
      group: p.group,
      layer,
      index: i,
      center: b.center.map((v) => +v.toFixed(4)),
      size: b.max.map((v, k) => +(v - b.min[k]).toFixed(4)),
      triangles: p.mesh.indices.length / 3,
      ...(p.group === 'organ' ? { volumeMl: +(meshVolume(p.mesh) * 1e6).toFixed(1) } : {}),
    })
  })
  const bytes = await writeGlb(OUT + '/' + layer + '.glb', { ...merged, partIds }, COPYRIGHT)
  meta.layers[layer] = { file: layer + '.glb', bytes, triangles: merged.indices.length / 3, vertices: merged.positions.length / 3, parts: sel.length }
  console.log(layer.padEnd(9), sel.length, 'parts', merged.indices.length / 3, 'tris', (bytes / 1024).toFixed(0), 'KB')
}
fs.writeFileSync(OUT + '/anatomy.json', JSON.stringify(meta))
saveParts(DATA + '/built', out.map((p) => ({ id: p.id, name: p.name, group: p.group, mesh: p.mesh })))
