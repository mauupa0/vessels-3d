import type { VesselsMeta } from './vesselsData'
import type { VolumeMeta } from './volume'

export type Group = 'skin' | 'bone' | 'cartilage' | 'organ'
export type LayerName = 'skin' | 'skeleton' | 'organs'

export interface PartMeta {
  id: string
  name: string
  group: Group
  layer: LayerName
  /** Value of the _PART vertex attribute inside its layer mesh. */
  index: number
  center: [number, number, number]
  size: [number, number, number]
  triangles: number
  /** Organs only: volume of the closed atlas mesh. */
  volumeMl?: number
  /** Organs only: a point inside the organ (the bounding box centre when that is inside, else the nearest voxel of the organ). */
  anchor?: [number, number, number]
}

export interface LayerMeta {
  file: string
  bytes: number
  triangles: number
  vertices: number
  parts: number
}

export interface PipelineStats {
  sourceTriangles: { skin: number; skeleton: number; organs: number }
  sourceMeshes: { skin: number; skeleton: number; organs: number }
  registration: { anchors: number; scale: number; residualRmsMm: number }
  vesselCurves: { total: number; used: number; splines: number }
  bodyLitres: number
  voxelCount: number
}

export interface AnatomyMeta {
  pipeline?: PipelineStats
  parts: PartMeta[]
  layers: Record<LayerName, LayerMeta>
  volume: VolumeMeta
  vessels: VesselsMeta
  source: string
}

export interface OrganInfo {
  name: string
  /** One true sentence about the organ. */
  fact: string
  /** Base colour (sRGB hex) and surface finish. */
  color: string
  roughness: number
  clearcoat: number
  /** Camera framing: azimuth (0 = front, 90 = patient left), polar angle from straight up, and distance in organ sizes. */
  view: { az: number; pol: number; dist: number }
}

export const ORGANS: Record<string, OrganInfo> = {
  brain: {
    name: 'Brain',
    fact: 'About 2 percent of body weight, yet it uses roughly a fifth of the oxygen the body takes in.',
    color: '#d6a9a8',
    roughness: 0.55,
    clearcoat: 0.5,
    view: { az: -28, pol: 82, dist: 3.4 },
  },
  heart: {
    name: 'Heart',
    fact: 'Beats about 100,000 times a day and moves roughly 5 litres of blood a minute at rest.',
    color: '#a8262f',
    roughness: 0.42,
    clearcoat: 0.6,
    view: { az: 14, pol: 88, dist: 3.2 },
  },
  'right-lung': {
    name: 'Right lung',
    fact: 'Three lobes. The left lung has only two, which leaves room for the heart.',
    color: '#cfa9a6',
    roughness: 0.62,
    clearcoat: 0.18,
    view: { az: -22, pol: 86, dist: 2.8 },
  },
  'left-lung': {
    name: 'Left lung',
    fact: 'Two lobes and a notch on the inner edge that the tip of the heart sits in.',
    color: '#cfa9a6',
    roughness: 0.62,
    clearcoat: 0.18,
    view: { az: 22, pol: 86, dist: 2.8 },
  },
  liver: {
    name: 'Liver',
    fact: 'The largest organ inside the body. It is fed by both the hepatic artery and the portal vein.',
    color: '#7a2f20',
    roughness: 0.38,
    clearcoat: 0.65,
    view: { az: -24, pol: 84, dist: 2.9 },
  },
  gallbladder: {
    name: 'Gallbladder',
    fact: 'Stores and concentrates the bile the liver makes.',
    color: '#657f30',
    roughness: 0.35,
    clearcoat: 0.7,
    view: { az: -18, pol: 84, dist: 4.2 },
  },
  stomach: {
    name: 'Stomach',
    fact: 'Holds about a litre comfortably and mixes food with acid and enzymes before it moves on.',
    color: '#cc7b7c',
    roughness: 0.42,
    clearcoat: 0.5,
    view: { az: 16, pol: 86, dist: 3.0 },
  },
  spleen: {
    name: 'Spleen',
    fact: 'Filters old red cells out of the blood and stores white cells and platelets.',
    color: '#6f2c42',
    roughness: 0.4,
    clearcoat: 0.45,
    view: { az: 118, pol: 86, dist: 3.8 },
  },
  pancreas: {
    name: 'Pancreas',
    fact: 'Makes digestive enzymes and, in its islets, the insulin that controls blood sugar.',
    color: '#d6a874',
    roughness: 0.55,
    clearcoat: 0.2,
    view: { az: 0, pol: 84, dist: 3.5 },
  },
  'right-kidney': {
    name: 'Right kidney',
    fact: 'The two kidneys together receive about a fifth of the heart output at rest.',
    color: '#832d27',
    roughness: 0.4,
    clearcoat: 0.55,
    view: { az: -150, pol: 84, dist: 4.0 },
  },
  'left-kidney': {
    name: 'Left kidney',
    fact: 'Sits slightly higher than the right one, which is pushed down by the liver.',
    color: '#832d27',
    roughness: 0.4,
    clearcoat: 0.55,
    view: { az: 150, pol: 84, dist: 4.0 },
  },
  'right-adrenal': {
    name: 'Right adrenal gland',
    fact: 'A small cap on top of the kidney that releases adrenaline and cortisol.',
    color: '#d6b45e',
    roughness: 0.5,
    clearcoat: 0.3,
    view: { az: -150, pol: 82, dist: 5.5 },
  },
  'left-adrenal': {
    name: 'Left adrenal gland',
    fact: 'A small cap on top of the kidney that releases adrenaline and cortisol.',
    color: '#d6b45e',
    roughness: 0.5,
    clearcoat: 0.3,
    view: { az: 150, pol: 82, dist: 5.5 },
  },
  'small-intestine': {
    name: 'Small intestine',
    fact: 'Roughly 3 to 5 metres long in a living adult, and where most nutrients are absorbed.',
    color: '#dc927c',
    roughness: 0.4,
    clearcoat: 0.6,
    view: { az: 0, pol: 86, dist: 2.9 },
  },
  'large-intestine': {
    name: 'Large intestine',
    fact: 'About 1.5 metres long; its main job is to take water back out of what is left.',
    color: '#bf9159',
    roughness: 0.5,
    clearcoat: 0.35,
    view: { az: 0, pol: 86, dist: 2.8 },
  },
  bladder: {
    name: 'Urinary bladder',
    fact: 'Stretches to hold roughly 400 to 600 mL before the urge to empty becomes strong.',
    color: '#d5958a',
    roughness: 0.45,
    clearcoat: 0.45,
    view: { az: 0, pol: 90, dist: 4.2 },
  },
  trachea: {
    name: 'Trachea',
    fact: 'A tube about 10 to 12 cm long, kept open by C-shaped rings of cartilage.',
    color: '#bdc8cf',
    roughness: 0.5,
    clearcoat: 0.3,
    view: { az: 0, pol: 84, dist: 3.8 },
  },
}

export const GROUP_COLOR: Record<'bone' | 'cartilage', string> = { bone: '#ebe4d3', cartilage: '#a3bcc3' }

export function partVolumeMl(meta: AnatomyMeta, id: string): number | null {
  const p = meta.parts.find((q) => q.id === id)
  return p?.volumeMl ?? null
}

/** Which organ a named atlas vessel feeds or drains, so the supply route lights up with the organ. Null for trunks and limb vessels. */
export function supplyOrgan(name: string): string | null {
  const n = name.toLowerCase()
  const side = /\bright\b/.test(n) ? 'right' : /\bleft\b/.test(n) ? 'left' : null
  if (/suprarenal/.test(n)) return side ? side + '-adrenal' : null
  if (/renal/.test(n)) return side ? side + '-kidney' : null
  if (/hepatic|portal/.test(n)) return 'liver'
  if (/cystic/.test(n)) return 'gallbladder'
  if (/splenic/.test(n)) return 'spleen'
  if (/pancreat/.test(n)) return 'pancreas'
  if (/gastric|gastro/.test(n)) return 'stomach'
  if (/colic|sigmoid|anorectal|appendicular|marginal artery/.test(n)) return 'large-intestine'
  if (/mesenteric|ileal|jejunal|ileocolic/.test(n)) return 'small-intestine'
  if (/vesical|vesic/.test(n)) return 'bladder'
  if (/coronary|cardiac|interventricular|circumflex artery of heart/.test(n)) return 'heart'
  if (/cerebral|cerebell|basilar|communicating|sagittal|sinus|straight|choroid|callosal|pericallosal|callosomarginal|striate|parieto|occipital artery|temporal branch|frontobasal|central sulcus|precentral|postcentral/.test(n)) return 'brain'
  if (/lung|pulmonary/.test(n) && side) return side + '-lung'
  return null
}
