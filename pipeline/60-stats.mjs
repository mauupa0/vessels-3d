// Stage 6: numbers the page quotes about the pipeline itself, measured from the intermediate files, plus the attribution file.
import fs from 'node:fs'
import { DATA, OUT, ZANA } from './lib/paths.mjs'
import { loadParts } from './lib/binmesh.mjs'
import { classify } from './lib/vessels.mjs'

const meta = JSON.parse(fs.readFileSync(OUT + '/anatomy.json', 'utf8'))
const assembled = loadParts(DATA + '/assembled')
const tris = (groups) => assembled.filter((p) => groups.includes(p.group)).reduce((a, p) => a + p.triangles, 0)
const count = (groups) => assembled.filter((p) => groups.includes(p.group)).length
const registration = JSON.parse(fs.readFileSync(DATA + '/registration.json', 'utf8'))
const curves = JSON.parse(fs.readFileSync(ZANA + '/zana_curves.json', 'utf8'))
let used = 0
let splines = 0
for (const c of curves) if (classify(c.name)) { used++; splines += c.splines.filter((s) => s.length >= 2).length }
const v = meta.volume
const inside = Object.entries(v.voxels).filter(([k]) => k !== '0').reduce((a, [, n]) => a + n, 0)

meta.pipeline = {
  sourceTriangles: { skin: tris(['skin']), skeleton: tris(['bone', 'cartilage']), organs: tris(['organ']) },
  sourceMeshes: { skin: count(['skin']), skeleton: count(['bone', 'cartilage']), organs: count(['organ']) },
  registration: { anchors: registration.anchors, scale: +registration.scale.toFixed(4), residualRmsMm: +(registration.residualRms * 1000).toFixed(1) },
  vesselCurves: { total: curves.length, used, splines },
  bodyLitres: +((inside * v.voxel ** 3) * 1000).toFixed(1),
  voxelCount: v.dims[0] * v.dims[1] * v.dims[2],
}
fs.writeFileSync(OUT + '/anatomy.json', JSON.stringify(meta))
console.log(JSON.stringify(meta.pipeline))

fs.writeFileSync(
  OUT + '/ATTRIBUTION.txt',
  `Anatomy data used by Vessels
=============================

BodyParts3D (skin, kidneys, small intestine, brain and the 120 registration bones)
  (c) The Database Center for Life Science (DBCLS), Okubo K. et al.
  https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
  The database page states CC BY 4.0. The OBJ files themselves still carry the older note CC BY-SA 2.1 Japan.

Z-Anatomy (skeleton, cartilage, intervertebral discs, heart, lungs, liver, stomach, spleen, pancreas, colon, bladder, trachea, adrenal glands, and 654 vessel centerlines with radii)
  Z-Anatomy, The libre 3D atlas of anatomy, CC BY-SA 4.0
  https://github.com/Z-Anatomy/Models-of-human-anatomy
  Z-Anatomy itself derives from BodyParts3D.
  Not used on purpose: the items Z-Anatomy lists with non-commercial licences (kidney, inner ear, Brainder brain and white matter).

What was changed: the meshes were registered into one frame, smoothed and simplified, merged per layer, and compressed
(meshopt). The skin was edited in the groin region. Vessel centerlines were resampled and joined into rooted trees; the
intrarenal curves were dropped and are regrown by the algorithm.

The files in this folder are derived works and are distributed under Creative Commons Attribution-ShareAlike 4.0
International (https://creativecommons.org/licenses/by-sa/4.0/). Credit the two atlases above when you reuse them.
`,
)
