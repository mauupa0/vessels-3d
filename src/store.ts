import { useSyncExternalStore } from 'react'
import type { AnatomyMeta } from './lib/anatomy'
import type { TreeKind } from './lib/kinds'
import type { Tier } from './lib/tiers'
import type { GenerateDone } from './worker/protocol'

export type LayerId = 'skin' | 'skeleton' | 'organs' | 'arteries' | 'veins'
export type PickLayer = 'skeleton' | 'organs' | TreeKind

export interface Pick {
  layer: PickLayer
  index: number
}

export type SectionAxis = 'x' | 'y' | 'z'

export interface LiveStats {
  fps: number
  frameMs: number
  drawCalls: number
  triangles: number
  pixelRatio: number
}

export interface State {
  meta: AnatomyMeta | null
  model: GenerateDone | null
  tier: Tier
  seed: number
  layers: Record<LayerId, boolean>
  hover: Pick | null
  selected: Pick | null
  bpm: number
  paused: boolean
  section: { on: boolean; axis: SectionAxis; t: number }
  /** 0 to 1 replay of the vessel growth. */
  growth: number
  growing: boolean
  /** The opening scan (section plane sweeping up the body) is running. */
  intro: boolean
  stats: LiveStats
  /** Which asset layers have finished loading. */
  loaded: Record<'skin' | 'skeleton' | 'organs', boolean>
  loadError: string | null
  genProgress: { label: string; fraction: number } | null
  /** The viewport is in view (the page below the stage pauses rendering). */
  stageVisible: boolean
}

const initial: State = {
  meta: null,
  model: null,
  tier: 'full',
  seed: 1234,
  layers: { skin: true, skeleton: false, organs: true, arteries: true, veins: true },
  hover: null,
  selected: null,
  bpm: 72,
  paused: false,
  section: { on: false, axis: 'y', t: 0.5 },
  growth: 1,
  growing: false,
  intro: false,
  stats: { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, pixelRatio: 1 },
  loaded: { skin: false, skeleton: false, organs: false },
  loadError: null,
  genProgress: { label: 'Starting', fraction: 0 },
  stageVisible: true,
}

let state: State = initial
const listeners = new Set<() => void>()

export const store = {
  get: () => state,
  set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    const next = typeof patch === 'function' ? patch(state) : patch
    state = { ...state, ...next }
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state), () => selector(initial))
}

export const samePick = (a: Pick | null, b: Pick | null) => (a === b ? true : !!a && !!b && a.layer === b.layer && a.index === b.index)
