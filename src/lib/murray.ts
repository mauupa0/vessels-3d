export interface Radii {
  radius: Float32Array
  leaves: number
  /** Generated subtrees whose Murray radius exceeded the atlas vessel they hang from (radius was clamped). */
  clamped: number
  /** Generated roots (children of atlas nodes). */
  attachments: number
}

/**
 * Murray's law at every generated node, bottom-up: r_parent^3 = sum of r_child^3, a generated leaf has radius leafRadius.
 * Atlas nodes keep their measured radius; a generated subtree is never thicker than the atlas node it hangs from.
 * Nodes are stored parent-before-child, so a single reverse sweep visits every child before its parent.
 */
export function murrayRadii(parent: Int32Array, count: number, atlasCount: number, atlasRadius: Float32Array, leafRadius: number): Radii {
  const r3 = new Float64Array(count)
  const hasChild = new Uint8Array(count)
  for (let i = atlasCount; i < count; i++) hasChild[parent[i]] = 1
  const leaf3 = leafRadius * leafRadius * leafRadius
  let leaves = 0
  for (let i = atlasCount; i < count; i++) {
    if (!hasChild[i]) {
      r3[i] = leaf3
      leaves++
    }
  }
  for (let i = count - 1; i >= atlasCount; i--) {
    const p = parent[i]
    if (p >= atlasCount) r3[p] += r3[i]
  }
  const radius = new Float32Array(count)
  radius.set(atlasRadius.subarray(0, atlasCount))
  // A subtree that would be thicker than the atlas vessel it hangs from is scaled down as a whole. Murray's law is
  // homogeneous in the radii, so it still holds exactly inside the scaled subtree.
  const scale = new Float64Array(count).fill(1)
  let clamped = 0
  let attachments = 0
  for (let i = atlasCount; i < count; i++) {
    const raw = Math.cbrt(r3[i])
    if (parent[i] < atlasCount) {
      attachments++
      const cap = atlasRadius[parent[i]]
      if (raw > cap) {
        clamped++
        scale[i] = cap / raw
      }
    } else scale[i] = scale[parent[i]]
    radius[i] = raw * scale[i]
  }
  return { radius, leaves, clamped, attachments }
}
