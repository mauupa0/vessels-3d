import fs from 'node:fs'
import path from 'node:path'
import { BP3D_OBJ, DATA } from './lib/paths.mjs'
const dir = process.argv[2] ?? BP3D_OBJ
const out = []
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.obj')) continue
  const fd = fs.openSync(path.join(dir, f), 'r')
  const buf = Buffer.alloc(2048)
  fs.readSync(fd, buf, 0, 2048, 0)
  fs.closeSync(fd)
  const t = buf.toString('utf8')
  const g = (k) => (t.match(new RegExp('# ' + k + ' *: *(.*)')) || [])[1]?.trim()
  const b = (t.match(/Bounds\(mm\): \(([^)]*)\)-\(([^)]*)\)/) || []).slice(1).map((s) => s.split(',').map(Number))
  out.push({ file: f.replace('.obj', ''), rep: g('Representation ID'), fma: g('Concept ID'), name: g('English name'), min: b[0], max: b[1], vol: Number(g('Volume\(cm3\)')) })
}
fs.writeFileSync(process.argv[3] ?? DATA + '/headers.json', JSON.stringify(out))
console.log(out.length)
