import { isArterial, type TreeKind } from './kinds'

// Cumulative path length (metres) from the tree root to every node, following parent links.
export function pathDistances(pos: Float32Array, parent: Int32Array, count: number): Float32Array {
  const d = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const p = parent[i]
    if (p < 0) continue
    const dx = pos[i * 3] - pos[p * 3]
    const dy = pos[i * 3 + 1] - pos[p * 3 + 1]
    const dz = pos[i * 3 + 2] - pos[p * 3 + 2]
    d[i] = d[p] + Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
  return d
}

export const CAPILLARY_LAG = 0.12

export interface WaveCoords {
  coord: Float32Array
  maxDist: number
}

// Wave coordinate s (metres of travel since the heart ejected the beat). Shader phase = fract(beat - s / wavelength).
// Arterial trees: the pulse leaves the heart, s grows with path distance.
// Venous trees: blood returns from the periphery, so s is largest at the heart end and smallest at the leaves,
// offset past the longest arterial path of the circuit it closes (systemic or pulmonary) plus a capillary lag.
export function waveCoords(kind: TreeKind, dist: Float32Array, arterialMaxDist: number): WaveCoords {
  let maxDist = 0
  for (let i = 0; i < dist.length; i++) if (dist[i] > maxDist) maxDist = dist[i]
  const coord = new Float32Array(dist.length)
  if (isArterial(kind)) {
    for (let i = 0; i < dist.length; i++) coord[i] = dist[i]
    return { coord, maxDist }
  }
  const base = arterialMaxDist + CAPILLARY_LAG
  for (let i = 0; i < dist.length; i++) coord[i] = base + (maxDist - dist[i])
  return { coord, maxDist }
}

export function pulse(phase: number): number {
  const p = phase - Math.floor(phase)
  const attack = Math.min(1, Math.max(0, p / 0.06))
  return Math.exp(-p * 6) * attack * attack * (3 - 2 * attack)
}

export function heartScale(beat: number): number {
  const p = beat - Math.floor(beat)
  const g = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2))
  return 1 + 0.06 * (g(p, 0.07, 0.055) + 0.55 * g(p, 0.3, 0.04))
}
