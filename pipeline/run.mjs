// Runs the whole pipeline: download, Blender dump, headers, assemble, build, volume, vessels, stats (see README, Rebuilding the assets).
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
for (const step of ['00-fetch.mjs', '05-blender.mjs', '10-headers.mjs', '20-assemble.mjs', '30-build.mjs', '40-volume.mjs', '50-vessels.mjs', '60-stats.mjs']) {
  console.log('\n== ' + step)
  execFileSync(process.execPath, [path.join(dir, step)], { stdio: 'inherit' })
}
