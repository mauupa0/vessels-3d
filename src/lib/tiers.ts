import type { ScaleConfig } from './attractors'

export type Tier = 'light' | 'full'

export interface TierConfig {
  scale: ScaleConfig
  /** Cap on atlas plus generated nodes, per tree. */
  maxNodes: number
  /** Radius of a generated leaf (m); everything above it follows from Murray's law. */
  leafRadius: number
  feedStride: number
  atlasKillFactor: number
  /** Generated twigs shorter than this (m) are pruned before the radii are computed. */
  minTwig: number
  maxPixelRatio: number
  msaa: boolean
  /** Bloom and ambient occlusion. */
  postFx: boolean
  /** Tube sides in the instanced vessel renderer. */
  radial: number
}

export const TIERS: Record<Tier, TierConfig> = {
  light: {
    scale: { baseKill: 0.024, minKill: 0.0075, demandExponent: 0.6, stepRatio: 0.78, influenceCoarse: 4.1, influenceFine: 3.4, spacing: 0.95 },
    maxNodes: 60000,
    leafRadius: 0.00018,
    feedStride: 3,
    atlasKillFactor: 1.8,
    minTwig: 0.022,
    maxPixelRatio: 1.5,
    msaa: true,
    postFx: false,
    radial: 6,
  },
  full: {
    scale: { baseKill: 0.0135, minKill: 0.0034, demandExponent: 0.6, stepRatio: 0.78, influenceCoarse: 4.1, influenceFine: 3.4, spacing: 0.95 },
    maxNodes: 160000,
    leafRadius: 0.00011,
    feedStride: 3,
    atlasKillFactor: 1.8,
    minTwig: 0.014,
    maxPixelRatio: 2,
    msaa: true,
    postFx: true,
    radial: 8,
  },
}

export interface DeviceHints {
  coarsePointer: boolean
  cores: number
  memoryGb: number | undefined
  smallScreen: boolean
}

export function pickTier(h: DeviceHints): Tier {
  if (h.coarsePointer && h.smallScreen) return 'light'
  if (h.cores <= 4) return 'light'
  if (h.memoryGb !== undefined && h.memoryGb <= 4) return 'light'
  return 'full'
}

/** Pixels the full tier may fill per frame: 1.5 x 1.5 supersampling of a 1920 x 1080 window. */
export const SUPERSAMPLE_PIXEL_BUDGET = 4.8e6
export const SUPERSAMPLE_MAX = 1.5

/**
 * Pixel ratio the full tier renders at on a screen that is not already dense. Edges of a 1x screen stair-step even
 * with multisampling (4 coverage levels), so the frame is rendered larger and the browser scales it down.
 * Whole 0.25 steps, 1 to 1.5, and never more than the pixel budget allows. The light tier never supersamples.
 */
export function supersampleRatio(tier: Tier, width: number, height: number): number {
  if (tier === 'light' || width <= 0 || height <= 0) return 1
  const fit = Math.sqrt(SUPERSAMPLE_PIXEL_BUDGET / (width * height))
  return Math.min(SUPERSAMPLE_MAX, Math.max(1, Math.floor(fit * 4) / 4))
}
