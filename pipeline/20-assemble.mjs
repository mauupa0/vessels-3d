// Stage 2: put every atlas piece into the Z-Anatomy frame (metres, BodyParts3D axes:
// x patient left, y posterior, z superior) and label it with a part id, a display name and a group.
import fs from 'node:fs'
import { DATA, ZANA } from './lib/paths.mjs'
import { bbox, merge, readZana } from './lib/mesh.mjs'
import { loadBp3dIndex, zanaNameOfBp3dBone } from './lib/atlas.mjs'
import { fitWarp, warpMesh } from './lib/register.mjs'
import { saveParts } from './lib/binmesh.mjs'

const zana = readZana(ZANA)
const bp = loadBp3dIndex()

// 1. registration anchors: bones present in both atlases
const anchors = []
for (const [file, h] of bp.byFile) {
  const zn = zanaNameOfBp3dBone(h.name)
  if (!zn || !zana.has(zn)) continue
  anchors.push({ name: zn, from: bbox(bp.read(file)).center, to: bbox(zana.get(zn)).center })
}
const reg = fitWarp(anchors)
console.log('anchors', anchors.length, 'scale', reg.scale.toFixed(4), 'translation mm', reg.translation.map((v) => (v * 1000).toFixed(1)).join(','), 'residual rms mm', (reg.residualRms * 1000).toFixed(1))
fs.writeFileSync(DATA + '/registration.json', JSON.stringify({ anchors: anchors.length, scale: reg.scale, translation: reg.translation, residualRms: reg.residualRms }))

const parts = []
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const add = (id, name, group, mesh, extra = {}) => parts.push({ id, name, group, mesh, ...extra })
const bpMesh = (files) => warpMesh(merge(files.map((f) => bp.read(f))), reg.warp)
const zMesh = (names) => merge(names.map((n) => {
  const m = zana.get(n)
  if (!m) throw new Error('Z-Anatomy mesh missing: ' + n)
  return m
}))

// 2. skin (BodyParts3D, warped)
add('skin', 'Skin', 'skin', bpMesh(bp.isa('FMA7163')))

// 3. organs
const organ = (id, name, mesh, extra) => add(id, name, 'organ', mesh, extra)
organ('heart', 'Heart', zMesh(['Left ventricle', 'Left atrium', 'Right ventricle', 'Right atrium', 'Pulmonary trunk']))
organ('right-lung', 'Right lung', zMesh(['Superior lobe of right lung', 'Middle lobe of right lung', 'Inferior lobe of right lung']))
organ('left-lung', 'Left lung', zMesh(['Superior lobe of left lung', 'Inferior lobe of left lung']))
organ('liver', 'Liver', zMesh(['Liver']))
organ('gallbladder', 'Gallbladder', zMesh(['Gallbladder']))
organ('stomach', 'Stomach', zMesh(['Stomach']))
organ('spleen', 'Spleen', zMesh(['Spleen']))
organ('pancreas', 'Pancreas', zMesh(['Pancreas']))
organ('right-kidney', 'Right kidney', bpMesh(bp.isa('FMA7204')))
organ('left-kidney', 'Left kidney', bpMesh(bp.isa('FMA7205')))
organ('right-adrenal', 'Right adrenal gland', zMesh(['Suprarenal gland.r']))
organ('left-adrenal', 'Left adrenal gland', zMesh(['Suprarenal gland.l']))
organ('small-intestine', 'Small intestine', bpMesh(bp.partof('FMA7200')))
organ('large-intestine', 'Large intestine', zMesh(['Ascending colon', 'Transverse colon', 'Descending colon', 'Sigmoid colon', 'Vermiform appendix']))
organ('bladder', 'Urinary bladder', zMesh(['Urinary bladder']))
organ('trachea', 'Trachea', zMesh(['Trachea']))
const brainFiles = bp.partof('FMA50801').filter((f) => /gyrus|cerebell|midbrain|pons|medulla|lobe|white matter|orbital|hemisphere/i.test(bp.byFile.get(f).name))
organ('brain', 'Brain', bpMesh(brainFiles))

// 4. skeleton: every Z-Anatomy bone mesh not used above
const used = new Set(['Liver', 'Gallbladder', 'Stomach', 'Duodenum', 'Pancreas', 'Spleen', 'Urinary bladder', 'Trachea', 'Pulmonary trunk', 'Left ventricle', 'Left atrium', 'Right ventricle', 'Right atrium', 'Suprarenal gland.l', 'Suprarenal gland.r', 'Thyroid gland', 'Ascending colon', 'Transverse colon', 'Descending colon', 'Sigmoid colon', 'Vermiform appendix'])
for (const n of zana.keys()) {
  if (used.has(n) || /lobe of (left|right) lung/.test(n)) continue
  if (/^Intervertebral disc/.test(n) || /^Costal cartilage/.test(n)) {
    add(slug(n), n.replace(/\.l$/, ' (left)').replace(/\.r$/, ' (right)'), 'cartilage', zana.get(n))
    continue
  }
  const display = n.replace(/^Vertebra (\w+)$/, '$1 vertebra').replace(/^(.*)\.l$/, 'Left $1').replace(/^(.*)\.r$/, 'Right $1')
  add(slug(n), display.charAt(0).toUpperCase() + display.slice(1), 'bone', zana.get(n))
}

saveParts(DATA + '/assembled', parts)
const count = (g) => parts.filter((p) => p.group === g)
for (const g of ['skin', 'organ', 'bone', 'cartilage']) console.log(g, count(g).length, 'parts', count(g).reduce((a, p) => a + p.mesh.indices.length / 3, 0), 'tris')
