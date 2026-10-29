import fs from 'node:fs'
let s = fs.readFileSync('extract_zanatomy.py', 'utf8')
s = s.replace("dg = bpy.context.evaluated_depsgraph_get()\nindex = []\nblob = bytearray()\nfor name in MESHES:\n    o = bpy.data.objects.get(name)\n    if o is None or o.type != 'MESH':\n        print('MISSING', name)\n        continue\n",
`# Every bone-sized mesh of the skeletal system collection, minus guide objects, sinuses and the larynx.
SKIP = ('Sinus', 'Thyroid cartilage', 'Cricoid', 'Arytenoid', 'Corniculate', 'nasal septal', 'alar cartilage', 'Costal cartilage')
for o in bpy.data.collections['1: Skeletal system'].all_objects:
    if o.type != 'MESH' or len(o.data.polygons) < 60 or o.name.endswith('.g') or o.name.endswith('.j'):
        continue
    if any(k in o.name for k in SKIP) or o.name in MESHES:
        continue
    MESHES.append(o.name)

dg = bpy.context.evaluated_depsgraph_get()
index = []
blob = bytearray()
for name in MESHES:
    o = bpy.data.objects.get(name)
    if o is None or o.type != 'MESH':
        print('MISSING', name)
        continue
`)
fs.writeFileSync('extract_zanatomy.py', s)
