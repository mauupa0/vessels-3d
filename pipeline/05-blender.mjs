// Stage 0.5: dump the Z-Anatomy meshes and vessel curves with a headless Blender (set BLENDER to the executable if it is not the default).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA, ZANA } from './lib/paths.mjs'

const blender = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
const here = path.dirname(fileURLToPath(import.meta.url))
fs.mkdirSync(ZANA, { recursive: true })
execFileSync(blender, ['-b', DATA + '/zana/Z-Anatomy/Startup.blend', '-P', path.join(here, 'blender', 'extract_zanatomy.py'), '--', ZANA], { stdio: 'inherit' })
