import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// Raw atlas downloads and Blender dumps live outside the repository (about 600 MB).
export const DATA = process.env.VESSELS_DATA || path.join(os.tmpdir(), 'vessels-work').replace(/\\/g, '/')
export const BP3D_OBJ = DATA + '/bp3d/obj/isa_BP3D_4.0_obj_99'
export const BP3D_META = DATA + '/meta'
export const ZANA = DATA + '/zana/extract'
export const OUT = ROOT + '/public/anatomy'
