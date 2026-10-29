import { beforeAll, describe, expect, it } from 'vitest'
import { supplyOrgan } from './anatomy'
import { generateModel, packSegments, SEGMENT_STRIDE, SKIN_MARGIN, type Model } from './generate'
import { TREE_KINDS, isArterial } from './kinds'
import { chamfer, L_BONE, L_OUTSIDE, L_TISSUE, rleDecode, type Volume } from './volume'
import { pickTier, supersampleRatio } from './tiers'
import { heartScale, pulse } from './wave'
import { loadAtlas, loadMeta, loadVolume, type AnatomyMetaFile } from './testAssets'
import type { AtlasTree } from './vesselsData'
import type { TreeKind } from './kinds'

let meta: AnatomyMetaFile
let volume: Volume
let atlas: Record<TreeKind, AtlasTree>
let model: Model
let again: Model

beforeAll(() => {
  meta = loadMeta()
  volume = loadVolume(meta)
  atlas = loadAtlas(meta)
  model = generateModel(volume, atlas, 1234, 'full')
  again = generateModel(volume, atlas, 1234, 'full')
}, 120000)

describe('label volume', () => {
  it('decodes to exactly the declared size and holds a plausible body', () => {
    const [nx, ny, nz] = meta.volume.dims
    expect(volume.labels.length).toBe(nx * ny * nz)
    let inside = 0
    for (const l of volume.labels) if (l !== L_OUTSIDE) inside++
    const litres = inside * meta.volume.voxel ** 3 * 1000
    expect(litres).toBeGreaterThan(60)
    expect(litres).toBeLessThan(95)
  })

  it('decodes runs longer than 127 voxels (multi byte lengths)', () => {
    // label 7 for 300 voxels (LEB128 0xAC 0x02), label 0 for 5, then label 2 for 128 (0x80 0x01)
    const out = rleDecode(new Uint8Array([7, 0xac, 0x02, 0, 5, 2, 0x80, 0x01]), [433, 1, 1])
    expect(out.length).toBe(433)
    expect(out[0]).toBe(7)
    expect(out[299]).toBe(7)
    expect(out[300]).toBe(0)
    expect(out[304]).toBe(0)
    expect(out[305]).toBe(2)
    expect(out[432]).toBe(2)
  })

  it('reports a decode error when the stream is the wrong length', () => {
    expect(() => rleDecode(new Uint8Array([1, 5]), [4, 1, 1])).toThrow(/length mismatch/)
  })

  it('puts every organ where the mesh says it is (centroid of its voxels near the part centre)', () => {
    const f = volume.fine
    const sum = new Map<number, [number, number, number, number]>()
    for (let iz = 0; iz < f.dims[2]; iz++) {
      for (let iy = 0; iy < f.dims[1]; iy++) {
        for (let ix = 0; ix < f.dims[0]; ix++) {
          const l = f.labels[ix + f.dims[0] * (iy + f.dims[1] * iz)]
          if (!l) continue
          const s = sum.get(l) ?? [0, 0, 0, 0]
          s[0] += f.origin[0] + (ix + 0.5) * f.voxel
          s[1] += f.origin[1] + (iy + 0.5) * f.voxel
          s[2] += f.origin[2] + (iz + 0.5) * f.voxel
          s[3]++
          sum.set(l, s)
        }
      }
    }
    const organs = meta.parts.filter((p) => p.group === 'organ')
    expect(organs.length).toBeGreaterThanOrEqual(17)
    for (const p of organs) {
      const s = sum.get(volume.organLabels[p.id])!
      expect(s, p.id).toBeDefined()
      const d = Math.hypot(s[0] / s[3] - p.center[0], s[1] / s[3] - p.center[1], s[2] / s[3] - p.center[2])
      expect(d, p.id).toBeLessThan(0.25 * Math.max(...p.size))
    }
  })

  it('gives every organ an anchor point that lies inside the organ, also where the bounding box centre does not', () => {
    const organs = meta.parts.filter((p) => p.group === 'organ')
    let centresOutside = 0
    for (const p of organs) {
      expect(p.anchor, p.id).toBeDefined()
      expect(volume.organAt(p.anchor![0], p.anchor![1], p.anchor![2]), p.id).toBe(volume.organLabels[p.id])
      if (volume.organAt(p.center[0], p.center[1], p.center[2]) !== volume.organLabels[p.id]) centresOutside++
    }
    // the control: without anchors, several labels would sit in empty space
    expect(centresOutside).toBeGreaterThanOrEqual(3)
  })

  it('keeps the heart left of the midline and above the liver', () => {
    const heart = meta.parts.find((p) => p.id === 'heart')!
    const liver = meta.parts.find((p) => p.id === 'liver')!
    expect(heart.center[0]).toBeGreaterThan(0)
    expect(liver.center[0]).toBeLessThan(0)
    expect(heart.center[1]).toBeGreaterThan(liver.center[1])
  })

  it('chamfer distance of a cube follows 3 units per voxel', () => {
    const n = 9
    const labels = new Uint8Array(n * n * n).fill(L_TISSUE)
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x === 0 || y === 0 || z === 0 || x === n - 1 || y === n - 1 || z === n - 1) labels[x + n * (y + n * z)] = L_OUTSIDE
    const d = chamfer(labels, [n, n, n], (l) => l === L_OUTSIDE)
    expect(d[4 + n * (4 + n * 4)]).toBe(12)
    expect(d[1 + n * (4 + n * 4)]).toBe(3)
    expect(d[2 + n * (2 + n * 4)]).toBe(6)
  })

  it('chamfer distance weighs face, edge and corner neighbours 3, 4 and 5', () => {
    const n = 5
    const labels = new Uint8Array(n * n * n).fill(L_TISSUE)
    labels[0] = L_OUTSIDE
    const d = chamfer(labels, [n, n, n], (l) => l === L_OUTSIDE)
    expect(d[1]).toBe(3)
    expect(d[1 + n]).toBe(4)
    expect(d[1 + n + n * n]).toBe(5)
  })

  it('has bone voxels the vessels must avoid, and refuses to place a node in one', () => {
    let bone = 0
    let first = -1
    for (let i = 0; i < volume.labels.length; i++) if (volume.labels[i] === L_BONE) { bone++; if (first < 0 && volume.depthGrid()[i] > 6) first = i }
    expect(bone).toBeGreaterThan(20000)
    const [nx, ny] = volume.dims
    const x = volume.origin[0] + ((first % nx) + 0.5) * volume.voxel
    const y = volume.origin[1] + ((Math.floor(first / nx) % ny) + 0.5) * volume.voxel
    const z = volume.origin[2] + (Math.floor(first / (nx * ny)) + 0.5) * volume.voxel
    expect(volume.labelAt(x, y, z)).toBe(L_BONE)
    expect(volume.allows(x, y, z, 0)).toBe(false)
    expect(volume.allows(0, 3, 0, 0)).toBe(false)
  })
})

describe('atlas trees', () => {
  it.each(TREE_KINDS)('%s is one rooted tree with sane radii', (kind) => {
    const t = atlas[kind]
    let roots = 0
    for (let i = 0; i < t.count; i++) {
      if (t.parent[i] < 0) roots++
      else expect(t.parent[i]).toBeLessThan(i)
      expect(t.radius[i]).toBeGreaterThan(0)
      expect(t.radius[i]).toBeLessThan(0.02)
      expect(t.nameIndex[i]).toBeLessThan(t.names.length)
    }
    expect(roots).toBe(1)
    expect(t.parent[0]).toBe(-1)
  })

  it('starts the arterial tree at the aortic root, 15 mm radius', () => {
    expect(atlas.artery.radius[0]).toBeCloseTo(0.015, 3)
    expect(atlas.artery.names[atlas.artery.nameIndex[0]]).toBe('Ascending aorta')
  })

  it('keeps atlas vessel nodes inside the body', () => {
    for (const kind of TREE_KINDS) {
      const t = atlas[kind]
      let outside = 0
      for (let i = 0; i < t.count; i++) if (volume.labelAt(t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2]) === L_OUTSIDE) outside++
      expect(outside / t.count).toBeLessThan(0.01)
    }
  })

  it('records how loosely the atlas follows Murray (median ratio between 1 and 1.8)', () => {
    expect(model.murray.junctions).toBeGreaterThan(200)
    expect(model.murray.median).toBeGreaterThan(1)
    expect(model.murray.median).toBeLessThan(1.8)
  })
})

describe('colonization', () => {
  it('is deterministic for a seed and different for another', () => {
    for (const k of TREE_KINDS) {
      expect(again.trees[k].grown.count).toBe(model.trees[k].grown.count)
      expect(Buffer.from(again.trees[k].grown.pos.buffer).equals(Buffer.from(model.trees[k].grown.pos.buffer))).toBe(true)
    }
    const other = generateModel(volume, atlas, 99, 'light')
    expect(other.trees.artery.grown.count).not.toBe(model.trees.artery.grown.count)
  })

  it.each(TREE_KINDS)('%s: every attractor is consumed, abandoned or reported unreached, and nearly all are consumed', (kind) => {
    const g = model.trees[kind].grown
    expect(g.attractorsConsumed + g.attractorsAbandoned + g.attractorsUnreached).toBe(g.attractorsTotal)
    expect(g.attractorsConsumed / g.attractorsTotal).toBeGreaterThan(0.95)
    expect(g.count).toBeGreaterThan(g.atlasCount)
  })

  it.each(TREE_KINDS)('%s: grown nodes stay inside the skin margin and outside bone', (kind) => {
    const g = model.trees[kind].grown
    for (let i = g.atlasCount; i < g.count; i++) {
      expect(volume.allows(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2], SKIN_MARGIN)).toBe(true)
    }
  })

  it.each(TREE_KINDS)('%s: a branch that entered an organ never leaves it', (kind) => {
    const g = model.trees[kind].grown
    let leaks = 0
    for (let i = g.atlasCount; i < g.count; i++) {
      const p = g.parent[i]
      const from = volume.organAt(g.pos[p * 3], g.pos[p * 3 + 1], g.pos[p * 3 + 2])
      if (from !== 0 && volume.organAt(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]) !== from) leaks++
    }
    expect(leaks).toBe(0)
  })

  it.each(TREE_KINDS)('%s: parents come before children and no twig is shorter than the pruning length', (kind) => {
    const g = model.trees[kind].grown
    const children = new Int32Array(g.count)
    for (let i = 0; i < g.count; i++) {
      if (g.parent[i] >= 0) {
        expect(g.parent[i]).toBeLessThan(i)
        children[g.parent[i]]++
      }
    }
    let short = 0
    for (let i = g.atlasCount; i < g.count; i++) {
      if (children[i] !== 0) continue
      // a leaf whose whole chain up to the branching point is shorter than the pruning length
      let len = 0
      let n = i
      for (;;) {
        const p = g.parent[n]
        len += Math.hypot(g.pos[n * 3] - g.pos[p * 3], g.pos[n * 3 + 1] - g.pos[p * 3 + 1], g.pos[n * 3 + 2] - g.pos[p * 3 + 2])
        if (p < g.atlasCount || children[p] !== 1) break
        n = p
      }
      if (len < 0.014 * 0.999) short++
    }
    expect(short).toBe(0)
  })
})

describe("Murray's law", () => {
  it.each(TREE_KINDS)('%s: r^3 of a grown node equals the sum of its children r^3, and no child is thicker than its parent', (kind) => {
    const t = model.trees[kind]
    const g = t.grown
    const sum = new Float64Array(g.count)
    for (let i = g.atlasCount; i < g.count; i++) {
      const p = g.parent[i]
      sum[p] += t.radius[i] ** 3
      expect(t.radius[i]).toBeLessThanOrEqual(t.radius[p] * 1.0000001)
    }
    let checked = 0
    for (let i = g.atlasCount; i < g.count; i++) {
      if (sum[i] === 0) continue
      expect(t.radius[i] ** 3).toBeCloseTo(sum[i], 14)
      checked++
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('gives every grown leaf the leaf radius of the tier', () => {
    const t = model.trees.artery
    const g = t.grown
    const has = new Uint8Array(g.count)
    for (let i = g.atlasCount; i < g.count; i++) has[g.parent[i]] = 1
    for (let i = g.atlasCount; i < g.count; i++) if (!has[i]) expect(t.radius[i]).toBeLessThanOrEqual(0.00011 * 1.0001)
    // and most leaves are exactly the leaf radius: only subtrees scaled down under a thin atlas twig are smaller
    let exact = 0
    let leaves = 0
    for (let i = g.atlasCount; i < g.count; i++) if (!has[i]) { leaves++; if (Math.abs(t.radius[i] - 0.00011) < 1e-9) exact++ }
    expect(exact / leaves).toBeGreaterThan(0.9)
  })
})

describe('pulse wave', () => {
  it.each(TREE_KINDS)('%s: wave coordinate runs the right way along every path', (kind) => {
    const t = model.trees[kind]
    const g = t.grown
    for (let i = 1; i < g.count; i++) {
      const p = g.parent[i]
      if (isArterial(kind)) expect(t.coord[i]).toBeGreaterThanOrEqual(t.coord[p] - 1e-6)
      else expect(t.coord[i]).toBeLessThanOrEqual(t.coord[p] + 1e-6)
    }
  })

  it('starts the venous wave after the longest arterial path of its circuit', () => {
    expect(Math.min(...model.trees.vein.coord)).toBeGreaterThan(model.trees.artery.maxDist)
    expect(Math.min(...model.trees.pulmVein.coord)).toBeGreaterThan(model.trees.pulmArtery.maxDist)
  })

  it('has a sharp upstroke and a slow decay', () => {
    expect(pulse(0)).toBe(0)
    expect(pulse(0.06)).toBeGreaterThan(0.6)
    expect(pulse(0.06)).toBeGreaterThan(pulse(0.5))
    expect(pulse(1.06)).toBeCloseTo(pulse(0.06), 10)
    for (let b = 0; b < 3; b += 0.01) {
      expect(heartScale(b)).toBeGreaterThanOrEqual(1)
      expect(heartScale(b)).toBeLessThan(1.1)
    }
  })

  it('knows the path to the foot is longer than the path to the hand', () => {
    const hand = model.references.find((r) => r.name === 'Right radial artery')!
    const foot = model.references.find((r) => r.name === 'Right dorsalis pedis artery')!
    expect(foot.metres).toBeGreaterThan(hand.metres)
    expect(hand.metres).toBeGreaterThan(0.5)
    expect(foot.metres).toBeLessThan(2.5)
  })
})

describe('instanced segments', () => {
  it('packs parent and child positions, radii and organ labels, one segment per non-root node', () => {
    const t = model.trees.artery
    const p = packSegments(t)
    expect(p.count).toBe(t.grown.count - 1)
    expect(p.data.length).toBe(p.count * SEGMENT_STRIDE)
    for (const s of [0, 100, p.count - 1]) {
      const child = p.child[s]
      const parent = t.grown.parent[child]
      expect(p.data[s * SEGMENT_STRIDE]).toBe(t.grown.pos[parent * 3])
      expect(p.data[s * SEGMENT_STRIDE + 3]).toBe(t.grown.pos[child * 3])
      expect(p.data[s * SEGMENT_STRIDE + 6]).toBe(t.radius[parent])
      expect(p.data[s * SEGMENT_STRIDE + 7]).toBe(t.radius[child])
      expect(p.data[s * SEGMENT_STRIDE + 10]).toBe(t.organ[child])
    }
  })

  it('gives the grown branches of every organ a birth time between 0 and 1, atlas nodes 0', () => {
    const p = packSegments(model.trees.artery)
    for (let s = 0; s < p.count; s++) {
      const b = p.data[s * SEGMENT_STRIDE + 11]
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(1)
      if (p.child[s] < model.trees.artery.grown.atlasCount) expect(b).toBe(0)
    }
  })

  it('grows vessels into every organ', () => {
    for (const [id, stats] of Object.entries(model.organStats)) {
      expect(stats.segments, id).toBeGreaterThanOrEqual(3)
      expect(stats.lengthM, id).toBeGreaterThan(0.02)
    }
    for (const [id, min] of [['liver', 1000], ['brain', 500], ['right-kidney', 100], ['left-kidney', 100], ['heart', 300], ['right-lung', 500], ['small-intestine', 300]] as const) {
      expect(model.organStats[id].segments, id).toBeGreaterThan(min)
    }
  })
})

describe('organ membership of atlas vessels', () => {
  it('is decided by name, so one trunk never switches between organ and not organ along its length', () => {
    for (const kind of TREE_KINDS) {
      const t = model.trees[kind]
      const a = t.atlas
      const byName = new Map<number, Set<number>>()
      for (let i = 0; i < t.grown.atlasCount; i++) {
        const set = byName.get(a.nameIndex[i]) ?? new Set<number>()
        set.add(t.organ[i])
        byName.set(a.nameIndex[i], set)
      }
      for (const [name, labels] of byName) expect(labels.size, a.names[name]).toBe(1)
    }
  })

  it('credits hepatic vessels to the liver', () => {
    const t = model.trees.vein
    const idx = t.atlas.names.findIndex((n) => /hepatic/i.test(n))
    expect(idx).toBeGreaterThanOrEqual(0)
    const node = t.atlas.nameIndex.findIndex((n) => n === idx)
    expect(t.organ[node]).toBe(volume.organLabels.liver)
  })
})

describe('twig roots', () => {
  it('a side branch starts at its own radius instead of flaring out of the parent as a cone', () => {
    for (const kind of TREE_KINDS) {
      const t = model.trees[kind]
      const g = t.grown
      const p = packSegments(t)
      let flaring = 0 // control: the raw parent radius would flare for many twigs
      let checked = 0
      const main = new Map<number, number>()
      for (let i = 0; i < g.count; i++) {
        const par = g.parent[i]
        if (par >= 0 && (!main.has(par) || t.radius[i] > t.radius[main.get(par)!])) main.set(par, i)
      }
      for (let s = 0; s < p.count; s++) {
        const node = p.child[s]
        const par = g.parent[node]
        if (main.get(par) === node) continue
        checked++
        const o = s * SEGMENT_STRIDE
        if (t.radius[par] > 3 * t.radius[node]) flaring++
        expect(p.data[o + 6]).toBeLessThanOrEqual(p.data[o + 7] * 1.0001)
      }
      expect(checked).toBeGreaterThan(100)
      expect(flaring).toBeGreaterThan(20)
    }
  })
})

describe('tube joints', () => {
  it('shares the end tangent between a segment and its continuation, and keeps every tangent a unit vector', () => {
    const t = model.trees.artery
    const p = packSegments(t)
    const first = new Map<number, number>() // child node -> segment index
    p.child.forEach((c, s) => first.set(c, s))
    let joined = 0
    for (let s = 0; s < p.count; s++) {
      const o = s * SEGMENT_STRIDE
      expect(Math.hypot(p.data[o + 12], p.data[o + 13], p.data[o + 14])).toBeCloseTo(1, 4)
      expect(Math.hypot(p.data[o + 15], p.data[o + 16], p.data[o + 17])).toBeCloseTo(1, 4)
    }
    // for every node, its thickest child continues the parent segment ring to ring
    const g = t.grown
    const main = new Map<number, number>()
    for (let i = 0; i < g.count; i++) {
      const par = g.parent[i]
      if (par >= 0 && (!main.has(par) || t.radius[i] > t.radius[main.get(par)!])) main.set(par, i)
    }
    for (const [node, cont] of main) {
      const a = first.get(node)
      const b = first.get(cont)
      if (a === undefined || b === undefined) continue
      for (let k = 0; k < 3; k++) expect(p.data[a * SEGMENT_STRIDE + 15 + k]).toBeCloseTo(p.data[b * SEGMENT_STRIDE + 12 + k], 5)
      joined++
    }
    expect(joined).toBeGreaterThan(10000)
  })
})

describe('naming and tiers', () => {
  it('maps supply vessels to the organ they feed', () => {
    expect(supplyOrgan('Right renal artery')).toBe('right-kidney')
    expect(supplyOrgan('Left suprarenal vein')).toBe('left-adrenal')
    expect(supplyOrgan('Common hepatic artery')).toBe('liver')
    expect(supplyOrgan('Left pulmonary artery')).toBe('left-lung')
    expect(supplyOrgan('Femoral artery')).toBeNull()
    expect(supplyOrgan('Aortic arch')).toBeNull()
  })

  it('picks the light tier on a phone and the full tier on a desktop', () => {
    expect(pickTier({ coarsePointer: true, cores: 8, memoryGb: 8, smallScreen: true })).toBe('light')
    expect(pickTier({ coarsePointer: false, cores: 12, memoryGb: 16, smallScreen: false })).toBe('full')
    expect(pickTier({ coarsePointer: false, cores: 2, memoryGb: 16, smallScreen: false })).toBe('light')
  })

  it('supersamples the full tier on a normal window, within a pixel budget, and never the light tier', () => {
    expect(supersampleRatio('full', 1440, 900)).toBe(1.5)
    expect(supersampleRatio('full', 1920, 1080)).toBe(1.5)
    expect(supersampleRatio('full', 1920, 1200)).toBe(1.25)
    expect(supersampleRatio('full', 2560, 1440)).toBe(1)
    expect(supersampleRatio('full', 800, 600)).toBe(1.5)
    expect(supersampleRatio('light', 1440, 900)).toBe(1)
    expect(supersampleRatio('full', 0, 0)).toBe(1)
    for (const [w, h] of [[1280, 720], [1366, 768], [1536, 864], [1920, 1200], [3440, 1440]]) {
      const r = supersampleRatio('full', w, h)
      expect(r).toBeGreaterThanOrEqual(1)
      expect(r).toBeLessThanOrEqual(1.5)
      if (r > 1) expect(w * h * r * r).toBeLessThanOrEqual(4.8e6 * 1.0001)
    }
  })
})
