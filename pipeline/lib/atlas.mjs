import fs from 'node:fs'
import { BP3D_META, BP3D_OBJ, DATA } from './paths.mjs'
import { readBp3dObj } from './mesh.mjs'

const rows = (f) =>
  fs
    .readFileSync(BP3D_META + '/' + f, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((l) => l.split('\t'))

export function loadBp3dIndex() {
  const headers = JSON.parse(fs.readFileSync(DATA + '/headers.json', 'utf8'))
  const byFile = new Map(headers.map((h) => [h.file, h]))
  const isa = rows('isa_element_parts.txt')
  const partof = rows('partof_element_parts.txt')
  const elements = (table, fma) => [...new Set(table.filter((r) => r[0] === fma).map((r) => r[2]))]
  return {
    byFile,
    isa: (fma) => elements(isa, fma),
    partof: (fma) => elements(partof, fma),
    read: (file) => readBp3dObj(BP3D_OBJ + '/' + file + '.obj'),
  }
}

const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 }
const cap = (s) => s[0].toUpperCase() + s.slice(1)

// BodyParts3D bone name -> Z-Anatomy object name, for the bones both atlases contain (registration anchors).
export function zanaNameOfBp3dBone(n) {
  let m
  const side = (s) => (s === 'Left' ? '.l' : '.r')
  if ((m = n.match(/^(Left|Right) (femur|tibia|fibula|humerus|radius|ulna|scapula|clavicle|patella|calcaneus|talus|hip bone|cuboid bone|lunate|scaphoid|capitate|hamate|pisiform|trapezium|trapezoid|triquetral|parietal bone|temporal bone|maxilla|zygomatic bone|nasal bone|lacrimal bone|palatine bone|medial cuneiform bone|lateral cuneiform bone|intermediate cuneiform bone)$/)))
    return cap(m[2]) + side(m[1])
  if ((m = n.match(/^(Left|Right) (\w+) rib$/))) return cap(m[2]) + ' rib' + side(m[1])
  if ((m = n.match(/^(Left|Right) (\w+) (metacarpal|metatarsal) bone$/))) return cap(m[2]) + ' ' + m[3] + ' bone' + side(m[1])
  if ((m = n.match(/^(\w+) (thoracic|lumbar|cervical) vertebra$/))) return 'Vertebra ' + { thoracic: 'T', lumbar: 'L', cervical: 'C' }[m[2]] + ORDINAL[m[1].toLowerCase()]
  if (n === 'Atlas') return 'Atlas (C1)'
  if (n === 'Axis') return 'Axis (C2)'
  if (['Sacrum', 'Mandible', 'Frontal bone', 'Occipital bone', 'Sphenoid bone', 'Ethmoid bone', 'Vomer'].includes(n)) return n
  return null
}
