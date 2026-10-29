// Negative control for the test suite: break the implementation on purpose, check that a test goes red, restore the file.
// usage: node scripts/mutation-check.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')

const MUTATIONS = [
  { file: 'src/lib/volume.ts', find: 'return ix + iy * this.sy + iz * this.sz', replace: 'return iy + ix * this.sy + iz * this.sz', why: 'voxel index axes swapped' },
  { file: 'src/lib/volume.ts', find: 'shift += 7', replace: 'shift += 6', why: 'run-length varint decoded wrongly' },
  { file: 'src/lib/volume.ts', find: "relax(i, xx * sx + yy * sy + zz * sz, k === 1 ? 3 : k === 2 ? 4 : 5)", replace: 'relax(i, xx * sx + yy * sy + zz * sz, 3)', why: 'chamfer weights flattened' },
  { file: 'src/lib/volume.ts', find: 'if (l === L_OUTSIDE || l === L_BONE) return false', replace: 'if (l === L_OUTSIDE) return false', why: 'vessels may enter bone' },
  { file: 'src/lib/murray.ts', find: 'const raw = Math.cbrt(r3[i])', replace: 'const raw = Math.sqrt(r3[i])', why: "Murray's exponent wrong" },
  { file: 'src/lib/murray.ts', find: 'scale[i] = cap / raw', replace: 'scale[i] = 1', why: 'subtree may be thicker than the atlas vessel' },
  { file: 'src/lib/wave.ts', find: 'coord[i] = base + (maxDist - dist[i])', replace: 'coord[i] = base + dist[i]', why: 'venous wave runs outward' },
  { file: 'src/lib/wave.ts', find: 'const base = arterialMaxDist + CAPILLARY_LAG', replace: 'const base = 0', why: 'venous wave starts before the arterial one ends' },
  { file: 'src/lib/colonization.ts', find: 'if (d2 < (node < atlasCount ? killAtlas2[a] : kill2[a])) {', replace: 'if (d2 < 0) {', why: 'attractors are never consumed' },
  { file: 'src/lib/generate.ts', find: 'return from === 0 || volume.organAt(x, y, z) === from', replace: 'return true', why: 'branches may leave an organ' },
  { file: 'src/lib/generate.ts', find: 'const grown = pruneTwigs(raw, cfg.minTwig)', replace: 'const grown = raw', why: 'no pruning of stubs' },
  { file: 'src/lib/generate.ts', find: 'data[o++] = r.radius[i]', replace: 'data[o++] = r.radius[p]', why: 'segment end radius packed from the wrong node' },
  { file: 'src/lib/generate.ts', find: 'organ[i] = volume.organAt(grown.pos[i * 3], grown.pos[i * 3 + 1], grown.pos[i * 3 + 2])', replace: 'organ[i] = 0', why: 'no organ labels on vessel nodes' },
  { file: 'src/lib/anatomy.ts', find: "return side ? side + '-kidney' : null", replace: "return side ? side + '-lung' : null", why: 'renal vessels credited to the lung' },
  { file: 'src/lib/tiers.ts', find: "if (h.coarsePointer && h.smallScreen) return 'light'", replace: "if (h.coarsePointer && h.smallScreen) return 'full'", why: 'phones get the heavy tier' },
  { file: 'src/lib/generate.ts', find: 'const tb = unit(own[0] + outgoing[0], own[1] + outgoing[1], own[2] + outgoing[2], own[0], own[1], own[2])', replace: 'const tb = unit(own[0] + own[0], own[1] + own[1], own[2] + own[2], own[0], own[1], own[2])', why: 'tube rings no longer match at the joints (visible seams)' },
  { file: 'src/lib/generate.ts', find: 'main[p] === i ? r.radius[p] : Math.min(r.radius[p], r.radius[i])', replace: 'r.radius[p]', why: 'side branches flare out of the parent as cones' },
  { file: 'src/lib/tiers.ts', find: "if (tier === 'light' || width <= 0 || height <= 0) return 1", replace: "if (width <= 0 || height <= 0) return 1", why: 'the light tier supersamples too' },
  { file: 'src/lib/tiers.ts', find: 'const fit = Math.sqrt(SUPERSAMPLE_PIXEL_BUDGET / (width * height))', replace: 'const fit = 2', why: 'supersampling ignores the pixel budget' },
  { file: 'src/lib/wave.ts', find: 'const attack = Math.min(1, Math.max(0, p / 0.06))', replace: 'const attack = 1', why: 'pulse without an upstroke' },
]

function run() {
  try {
    const out = execFileSync(process.execPath, [vitest, 'run', '--reporter=json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
    return { failed: [], passed: JSON.parse(out.slice(out.indexOf('{'))).numPassedTests }
  } catch (e) {
    const out = String(e.stdout ?? '')
    const i = out.indexOf('{')
    if (i < 0) return { failed: ['(no report: ' + String(e.stderr).slice(0, 200) + ')'], passed: 0 }
    const j = JSON.parse(out.slice(i))
    const failed = []
    for (const f of j.testResults) for (const t of f.assertionResults) if (t.status === 'failed') failed.push(t.fullName)
    return { failed, passed: j.numPassedTests }
  }
}

const lines = []
let allRed = true
const base = run()
lines.push(`baseline: ${base.failed.length === 0 ? 'green' : 'RED'} (${base.passed} passed)`)
if (base.failed.length) {
  console.log(lines.join('\n'))
  process.exit(1)
}
for (const m of MUTATIONS) {
  const file = path.join(root, m.file)
  const original = fs.readFileSync(file, 'utf8')
  const count = original.split(m.find).length - 1
  if (count < 1) {
    lines.push(`SKIP   ${m.file}: pattern not found (${m.why})`)
    allRed = false
    continue
  }
  try {
    fs.writeFileSync(file, original.split(m.find).join(m.replace))
    const r = run()
    const red = r.failed.length > 0
    if (!red) allRed = false
    lines.push(`${red ? 'RED   ' : 'GREEN!'} ${m.file}: ${m.why} -> ${red ? r.failed.length + ' failing, first: ' + r.failed[0] : 'NO TEST NOTICED'}`)
  } finally {
    fs.writeFileSync(file, original)
  }
}
const after = run()
lines.push(`after restore: ${after.failed.length === 0 ? 'green' : 'RED'} (${after.passed} passed)`)
lines.push(`${MUTATIONS.length} mutations, all caught: ${allRed && after.failed.length === 0}`)
fs.writeFileSync(path.join(root, 'scripts', 'mutation-report.txt'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
process.exit(allRed && after.failed.length === 0 ? 0 : 1)
