// Turns the Z-Anatomy vessel centerlines (Bezier splines with a radius per point) into four rooted trees:
// systemic arteries, systemic veins, pulmonary arteries, pulmonary veins. Pure functions, no file access.

export const KINDS = ['artery', 'vein', 'pulmArtery', 'pulmVein']

export function classify(name) {
  const n = name.toLowerCase()
  if (/intrarenal/.test(n)) return null // grown by the algorithm instead
  const pulm = /pulmonary|of (right|left) lung|lingular/.test(n)
  const vein = /vein|sinus|vena|azygos/.test(n)
  if (pulm) return vein ? 'pulmVein' : 'pulmArtery'
  return vein ? 'vein' : 'artery'
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// Resample a polyline [x,y,z,r] at equal arc length (at least 2 points).
export function resample(pts, spacing) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]))
  const total = cum[cum.length - 1]
  if (total < 1e-9) return [pts[0], pts[pts.length - 1]].map((p) => [...p])
  const n = Math.max(1, Math.round(total / spacing))
  const out = []
  let j = 0
  for (let k = 0; k <= n; k++) {
    const s = (total * k) / n
    while (j < pts.length - 2 && cum[j + 1] < s) j++
    const span = cum[j + 1] - cum[j] || 1
    const t = Math.min(1, Math.max(0, (s - cum[j]) / span))
    out.push([0, 1, 2, 3].map((c) => pts[j][c] + (pts[j + 1][c] - pts[j][c]) * t))
  }
  return out
}

// Uniform grid over points for nearest-neighbour queries.
export class PointIndex {
  constructor(cell = 0.02) {
    this.cell = cell
    this.map = new Map()
    this.points = []
  }
  key(x, y, z) {
    return Math.floor(x / this.cell) + ',' + Math.floor(y / this.cell) + ',' + Math.floor(z / this.cell)
  }
  add(p, id) {
    this.points.push(p)
    const k = this.key(p[0], p[1], p[2])
    const l = this.map.get(k)
    if (l) l.push(id)
    else this.map.set(k, [id])
  }
  nearest(p, maxDist, pos) {
    const r = Math.ceil(maxDist / this.cell)
    const cx = Math.floor(p[0] / this.cell)
    const cy = Math.floor(p[1] / this.cell)
    const cz = Math.floor(p[2] / this.cell)
    let best = -1
    let bd = maxDist
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
      const l = this.map.get(x + ',' + y + ',' + z)
      if (!l) continue
      for (const id of l) {
        const q = pos(id)
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
        if (d < bd) { bd = d; best = id }
      }
    }
    return best < 0 ? null : { id: best, d: bd }
  }
}

/**
 * Build one tree.
 * splines: [{ name, pts:[[x,y,z,r]] }] already scene-frame, one kind.
 * root: { pos:[x,y,z], radius } virtual root (the heart chamber the tree is attached to), or null to start from `rootSpline`.
 * opts: { spacing, tol, rootTol, forceRoot: (name)=>boolean, rootSpline }
 */
export function buildTree(splines, root, opts) {
  const { spacing = 0.0035, tol = 0.03, rootTol = 0.07, forceRoot = () => false, rootSpline = null } = opts
  const pos = []
  const parent = []
  const radius = []
  const name = []
  const names = []
  const nameId = new Map()
  const index = new PointIndex(0.02)
  const nid = (s) => {
    if (!nameId.has(s)) { nameId.set(s, names.length); names.push(s) }
    return nameId.get(s)
  }
  const addNode = (p, par, nm) => {
    const id = pos.length
    pos.push([p[0], p[1], p[2]])
    parent.push(par)
    radius.push(Math.max(p[3], 0.0001))
    name.push(nid(nm))
    index.add(pos[id], id)
    return id
  }
  const getPos = (id) => pos[id]
  const sorted = [...splines].sort((a, b) => Math.max(...b.pts.map((p) => p[3])) - Math.max(...a.pts.map((p) => p[3])))
  const stats = { splines: splines.length, attached: 0, forced: 0, orphans: [] }
  let rootId = -1
  if (root) rootId = addNode([root.pos[0], root.pos[1], root.pos[2], root.radius], -1, root.name || 'root')

  const place = (s, startFromRoot) => {
    const pts = resample(s.pts, spacing)
    const a = pts[0]
    const b = pts[pts.length - 1]
    let chain = pts
    let par = -1
    if (rootId >= 0 || pos.length > 0) {
      const na = index.nearest(a, forceRoot(s.name) ? 0.2 : tol, getPos)
      const nb = index.nearest(b, forceRoot(s.name) ? 0.2 : tol, getPos)
      let pick = null
      if (na && (!nb || na.d <= nb.d)) pick = { ...na, rev: false }
      else if (nb) pick = { ...nb, rev: true }
      if (!pick && rootId >= 0) {
        const ra = Math.hypot(a[0] - pos[rootId][0], a[1] - pos[rootId][1], a[2] - pos[rootId][2])
        const rb = Math.hypot(b[0] - pos[rootId][0], b[1] - pos[rootId][1], b[2] - pos[rootId][2])
        if (Math.min(ra, rb) < rootTol) pick = { id: rootId, d: Math.min(ra, rb), rev: rb < ra }
      }
      if (!pick) { stats.orphans.push(s.name); return false }
      par = pick.id
      if (pick.rev) chain = [...pts].reverse()
      stats.attached++
    }
    let prev = par
    for (let i = 0; i < chain.length; i++) prev = addNode(chain[i], prev, s.name)
    return true
  }

  if (!root && rootSpline) {
    const s = sorted.find((q) => q.name === rootSpline)
    if (!s) throw new Error('root spline missing: ' + rootSpline)
    // start at the end farthest from every other spline (the heart end)
    const pts = resample(s.pts, spacing)
    let prev = -1
    for (const p of pts) prev = addNode(p, prev, s.name)
    rootId = 0
    sorted.splice(sorted.indexOf(s), 1)
  }
  // two passes: later splines can attach to nodes created after their turn (hand-offs between equal radii)
  let pending = sorted
  for (let pass = 0; pass < 3 && pending.length; pass++) {
    const next = []
    for (const s of pending) if (!place(s)) next.push(s)
    stats.orphans.length = 0
    pending = next
    if (pass === 2) for (const s of next) stats.orphans.push(s.name)
  }
  return { pos, parent, radius, name, names, rootId, stats }
}
