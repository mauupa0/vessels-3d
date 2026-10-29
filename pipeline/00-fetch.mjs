// Stage 0: download the two atlases into the data directory (outside the repository, about 600 MB unpacked) and unpack them.
// Skips whatever is already there. BodyParts3D is slow (about 25 MB a minute), so this can take 10 minutes.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BP3D_META, DATA } from './lib/paths.mjs'

const BP3D = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/'
const ZANA = 'https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/master/Z-Anatomy.zip'

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return
  fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true })
  console.log('downloading', url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(url + ': HTTP ' + res.status)
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file))
}
const unpack = (zip, dir) => execFileSync('tar', ['-xf', zip, '-C', dir], { stdio: 'inherit' })

fs.mkdirSync(BP3D_META, { recursive: true })
for (const f of ['isa_element_parts.txt', 'partof_element_parts.txt']) await download(BP3D + f, BP3D_META + '/' + f)
await download(BP3D + 'isa_BP3D_4.0_obj_99.zip', DATA + '/bp3d/isa.zip')
if (!fs.existsSync(DATA + '/bp3d/obj')) {
  fs.mkdirSync(DATA + '/bp3d/obj', { recursive: true })
  unpack(DATA + '/bp3d/isa.zip', DATA + '/bp3d/obj')
}
await download(ZANA, DATA + '/zana/Z-Anatomy.zip')
if (!fs.existsSync(DATA + '/zana/Z-Anatomy/Startup.blend')) unpack(DATA + '/zana/Z-Anatomy.zip', DATA + '/zana')
console.log('raw data ready in', DATA)
