import { generateModel, packSegments } from '../lib/generate'
import { TREE_KINDS, type TreeKind } from '../lib/kinds'
import { TIERS } from '../lib/tiers'
import { decodeAtlasTree, type AtlasTree } from '../lib/vesselsData'
import { rleDecode, Volume } from '../lib/volume'
import type { GenerateDone, PackedTree, WorkerMessage, WorkerRequest } from './protocol'

const ctx = self as unknown as {
  postMessage(m: WorkerMessage, t?: Transferable[]): void
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
}

let cache: { key: string; volume: Volume; atlas: Record<TreeKind, AtlasTree> } | null = null

async function load(req: WorkerRequest) {
  const key = req.base + req.volume.bytes + ':' + req.volume.fine.bytes + ':' + req.vessels.bytes
  if (cache?.key === key) return cache
  const [vol, fin, ves] = await Promise.all([
    fetch(req.base + req.volume.file).then((r) => {
      if (!r.ok) throw new Error('volume.bin: HTTP ' + r.status)
      return r.arrayBuffer()
    }),
    fetch(req.base + req.volume.fine.file).then((r) => {
      if (!r.ok) throw new Error('organs.bin: HTTP ' + r.status)
      return r.arrayBuffer()
    }),
    fetch(req.base + req.vessels.file).then((r) => {
      if (!r.ok) throw new Error('vessels.bin: HTTP ' + r.status)
      return r.arrayBuffer()
    }),
  ])
  const volume = new Volume(req.volume, rleDecode(new Uint8Array(vol), req.volume.dims), rleDecode(new Uint8Array(fin), req.volume.fine.dims))
  const atlas = {} as Record<TreeKind, AtlasTree>
  for (const k of TREE_KINDS) atlas[k] = decodeAtlasTree(k, req.vessels.trees[k], ves)
  cache = { key, volume, atlas }
  return cache
}

ctx.onmessage = async (e) => {
  const req = e.data
  if (req.type !== 'generate') return
  try {
    const t0 = performance.now()
    ctx.postMessage({ type: 'progress', label: 'Reading the volume and the atlas vessels', fraction: 0 })
    const { volume, atlas } = await load(req)
    const t1 = performance.now()
    let last = -1
    const model = generateModel(volume, atlas, req.seed, req.tier, (label, fraction) => {
      const step = Math.floor(fraction * 50)
      if (step === last) return
      last = step
      ctx.postMessage({ type: 'progress', label, fraction })
    })
    const trees = {} as Record<TreeKind, PackedTree>
    const transfer: Transferable[] = []
    for (const k of TREE_KINDS) {
      const r = model.trees[k]
      const p = packSegments(r)
      trees[k] = {
        kind: k,
        data: p.data,
        child: p.child,
        segments: p.count,
        nodes: r.grown.count,
        atlasNodes: r.grown.atlasCount,
        nameIndex: Uint16Array.from(r.atlas.nameIndex),
        leaves: r.leaves,
        clamped: r.clamped,
        attachments: r.attachments,
        attractors: r.grown.attractorsTotal,
        consumed: r.grown.attractorsConsumed,
        abandoned: r.grown.attractorsAbandoned,
        unreached: r.grown.attractorsUnreached,
        iterations: r.grown.iterations,
        maxDist: r.maxDist,
        leafRadius: TIERS[req.tier].leafRadius,
        growMs: r.growMs,
      }
      transfer.push(p.data.buffer, p.child.buffer, trees[k].nameIndex.buffer)
    }
    const labels = volume.labels.slice()
    transfer.push(labels.buffer)
    const done: GenerateDone = {
      type: 'done',
      seed: req.seed,
      tier: req.tier,
      trees,
      organStats: model.organStats,
      murray: model.murray,
      references: model.references,
      labels,
      timings: { loadMs: t1 - t0, generateMs: model.totalMs, totalMs: performance.now() - t0 },
    }
    ctx.postMessage(done, transfer)
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
