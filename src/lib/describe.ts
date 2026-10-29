import { ORGANS, partVolumeMl, type AnatomyMeta, type PartMeta } from './anatomy'
import { isArterial, type TreeKind } from './kinds'
import { SEGMENT_STRIDE } from './generate'
import type { Pick } from '../store'
import type { GenerateDone } from '../worker/protocol'

export interface Info {
  kind: 'organ' | 'bone' | 'cartilage' | 'atlas-vessel' | 'grown-vessel'
  title: string
  fact?: string
  rows: [string, string][]
  /** Part id for organs and bones, used to highlight the matching list row. */
  partId?: string
}

const KIND_NAME: Record<TreeKind, string> = {
  artery: 'arterial',
  vein: 'venous',
  pulmArtery: 'pulmonary arterial',
  pulmVein: 'pulmonary venous',
}

export const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function lengthLabel(m: number): string {
  return m >= 1 ? fmt(m, 1) + ' m' : fmt(m * 100, 0) + ' cm'
}

export function radiusLabel(m: number): string {
  return m >= 0.001 ? fmt(m * 1000, 1) + ' mm' : fmt(m * 1000, 2) + ' mm'
}

export function findPart(meta: AnatomyMeta, layer: 'skeleton' | 'organs', index: number): PartMeta | undefined {
  return meta.parts.find((p) => p.layer === layer && p.index === index)
}

export function describePick(pick: Pick, meta: AnatomyMeta, model: GenerateDone | null): Info | null {
  if (pick.layer === 'organs' || pick.layer === 'skeleton') {
    const part = findPart(meta, pick.layer, pick.index)
    if (!part) return null
    if (part.group === 'organ') {
      const info = ORGANS[part.id]
      const stats = model?.organStats[part.id]
      const rows: [string, string][] = []
      const ml = partVolumeMl(meta, part.id)
      if (ml !== null) rows.push(['Volume', fmt(ml) + ' mL'])
      if (stats && stats.segments > 0) {
        rows.push(['Grown branches', fmt(stats.segments)])
        rows.push(['Vessel length', fmt(stats.lengthM, stats.lengthM < 10 ? 1 : 0) + ' m'])
        rows.push(['Branch radius', fmt(stats.rMin * 1000, 2) + ' to ' + fmt(stats.rMax * 1000, 2) + ' mm'])
      }
      return { kind: 'organ', title: info?.name ?? part.name, fact: info?.fact, rows, partId: part.id }
    }
    const longest = Math.max(...part.size)
    return {
      kind: part.group === 'cartilage' ? 'cartilage' : 'bone',
      title: part.name,
      fact: part.group === 'cartilage' ? 'Cartilage from the atlas, shown with the skeleton layer.' : 'One of the bones of the atlas skeleton.',
      rows: [['Longest side', lengthLabel(longest)]],
      partId: part.id,
    }
  }
  if (!model) return null
  const kind = pick.layer
  const tree = model.trees[kind]
  if (pick.index >= tree.segments) return null
  const child = tree.child[pick.index]
  const radius = tree.data[pick.index * SEGMENT_STRIDE + 7]
  const s = tree.data[pick.index * SEGMENT_STRIDE + 9]
  if (child < tree.atlasNodes) {
    const name = meta.vessels.trees[kind].names[tree.nameIndex[child]] ?? 'Vessel'
    const rows: [string, string][] = [['Radius', radiusLabel(radius)]]
    if (isArterial(kind)) rows.push(['From the heart', lengthLabel(s)])
    return { kind: 'atlas-vessel', title: name, fact: 'A centerline from the atlas, drawn at its measured radius.', rows }
  }
  const rows: [string, string][] = [['Radius', radiusLabel(radius)]]
  if (isArterial(kind)) rows.push(['From the heart', lengthLabel(s)])
  return {
    kind: 'grown-vessel',
    title: 'Grown ' + KIND_NAME[kind] + ' branch',
    fact: 'Not in the atlas. Space colonization grew it toward tissue that still needed blood, and Murray’s law set its radius.',
    rows,
  }
}
