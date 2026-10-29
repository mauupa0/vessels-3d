# Run: blender -b Startup.blend -P extract_zanatomy.py -- <out_dir>
# Dumps the evaluated, world-space triangle meshes of a hand-picked list of Z-Anatomy objects
# and the centerlines (Bezier sampled, with radius) of every vessel curve in the cardiovascular collection.
import bpy, json, struct, sys, math

out_dir = sys.argv[sys.argv.index('--') + 1]

MESHES = [
    'Liver', 'Gallbladder', 'Stomach', 'Duodenum', 'Pancreas', 'Spleen', 'Urinary bladder', 'Trachea',
    'Superior lobe of left lung', 'Inferior lobe of left lung', 'Superior lobe of right lung',
    'Middle lobe of right lung', 'Inferior lobe of right lung',
    'Left ventricle', 'Left atrium', 'Right ventricle', 'Right atrium', 'Pulmonary trunk',
    'Ascending colon', 'Transverse colon', 'Descending colon', 'Sigmoid colon', 'Vermiform appendix',
    'Suprarenal gland.l', 'Suprarenal gland.r', 'Thyroid gland',
    'Body of sternum', 'Manubrium of sternum',
]
for side in ('l', 'r'):
    for n in ('first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'):
        MESHES.append('Costal cartilage of %s rib.%s' % (n, side))
for a, b in [('C2','C3'),('C3','C4'),('C4','C5'),('C5','C6'),('C6','C7'),('C7','T1')] + \
            [('T%d' % i, 'T%d' % (i + 1)) for i in range(1, 12)] + [('T12','L1'),('L1','L2'),('L2','L3'),('L3','L4'),('L4','L5'),('L5','S1')]:
    MESHES.append('Intervertebral disc %s-%s' % (a, b))

# Every bone-sized mesh of the skeletal system collection, minus guide objects, sinuses and the larynx.
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
    eo = o.evaluated_get(dg)
    me = eo.to_mesh()
    me.calc_loop_triangles()
    mw = eo.matrix_world
    verts = []
    for v in me.vertices:
        p = mw @ v.co
        verts.extend((p.x, p.y, p.z))
    tris = []
    for t in me.loop_triangles:
        tris.extend(t.vertices)
    index.append({'name': name, 'vertices': len(verts) // 3, 'triangles': len(tris) // 3,
                  'voff': len(blob), 'ioff': len(blob) + len(verts) * 4})
    blob += struct.pack('<%df' % len(verts), *verts)
    blob += struct.pack('<%dI' % len(tris), *tris)
    eo.to_mesh_clear()
open(out_dir + '/zana_meshes.bin', 'wb').write(blob)
json.dump(index, open(out_dir + '/zana_meshes.json', 'w'), indent=1)
print('MESHES', len(index), 'bytes', len(blob))

def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return [u*u*u*p0[i] + 3*u*u*t*p1[i] + 3*u*t*t*p2[i] + t*t*t*p3[i] for i in range(3)]

col = bpy.data.collections['5: Cardiovascular system']
curves = []
for o in col.all_objects:
    if o.type != 'CURVE':
        continue
    cu = o.data
    mw = o.matrix_world
    scale = (abs(mw.to_scale().x) + abs(mw.to_scale().y) + abs(mw.to_scale().z)) / 3
    splines = []
    for s in cu.splines:
        pts = []
        if s.type == 'BEZIER':
            bp = s.bezier_points
            for i in range(len(bp) - 1):
                a, b = bp[i], bp[i + 1]
                p0 = mw @ a.co; p1 = mw @ a.handle_right; p2 = mw @ b.handle_left; p3 = mw @ b.co
                steps = 8
                for k in range(steps):
                    t = k / steps
                    q = bez(p0, p1, p2, p3, t)
                    pts.append([q[0], q[1], q[2], (a.radius + (b.radius - a.radius) * t) * cu.bevel_depth * scale])
            last = bp[-1]
            q = mw @ last.co
            pts.append([q.x, q.y, q.z, last.radius * cu.bevel_depth * scale])
        else:
            for p in s.points:
                q = mw @ p.co.to_3d()
                pts.append([q.x, q.y, q.z, p.radius * cu.bevel_depth * scale])
        splines.append(pts)
    curves.append({'name': o.name, 'splines': splines})
json.dump(curves, open(out_dir + '/zana_curves.json', 'w'))
print('CURVES', len(curves))
