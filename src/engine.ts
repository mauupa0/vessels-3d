import { fetchMeta, BASE } from './lib/assetBase'
import { pickTier, type Tier } from './lib/tiers'
import { store } from './store'
import type { WorkerMessage } from './worker/protocol'

let worker: Worker | null = null
let started = false

export function detectTier(): Tier {
  const q = new URLSearchParams(location.search).get('quality')
  if (q === 'light' || q === 'full') return q
  const nav = navigator as Navigator & { deviceMemory?: number }
  return pickTier({
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    cores: navigator.hardwareConcurrency || 4,
    memoryGb: nav.deviceMemory,
    smallScreen: Math.min(window.innerWidth, window.innerHeight) < 700,
  })
}

export function regenerate(seed: number, tier: Tier, opts: { animate?: boolean; scan?: boolean } = {}) {
  const s = store.get()
  if (!s.meta) return
  worker?.terminate()
  store.set({ genProgress: { label: 'Starting', fraction: 0 } })
  const w = new Worker(new URL('./worker/generate.worker.ts', import.meta.url), { type: 'module' })
  worker = w
  w.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data
    if (m.type === 'progress') store.set({ genProgress: { label: m.label, fraction: m.fraction } })
    else if (m.type === 'done') {
      const animate = opts.animate !== false
      store.set({ model: m, seed: m.seed, tier: m.tier, genProgress: null, growth: animate ? 0 : 1, growing: animate && !opts.scan, intro: animate && !!opts.scan, ...(animate && opts.scan ? { section: { on: true, axis: 'y' as const, t: 0 } } : {}) })
    } else store.set({ loadError: m.message, genProgress: null })
  }
  w.onerror = (ev) => store.set({ loadError: ev.message || 'The generator failed to start', genProgress: null })
  w.postMessage({ type: 'generate', base: new URL(BASE, location.href).href, volume: s.meta.volume, vessels: s.meta.vessels, seed, tier })
}

export function boot() {
  if (started) return
  started = true
  const params = new URLSearchParams(location.search)
  const seed = Number(params.get('seed')) || store.get().seed
  const tier = detectTier()
  fetchMeta()
    .then((meta) => {
      store.set({ meta, tier, seed })
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      regenerate(seed, tier, { animate: !reduced, scan: !reduced })
    })
    .catch((e) => store.set({ loadError: String(e?.message ?? e), genProgress: null }))
}
