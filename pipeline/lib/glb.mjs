import fs from 'node:fs'
import { Document, NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { meshopt, quantize } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import { vertexNormals } from './geom.mjs'

// One mesh, one primitive: POSITION, NORMAL and _PART (uint16 part index, read by the part picker and highlighter).
export async function writeGlb(file, { positions, indices, partIds }, copyright) {
  await MeshoptEncoder.ready
  const doc = new Document()
  doc.getRoot().getAsset().generator = 'vessels pipeline'
  if (copyright) doc.getRoot().getAsset().copyright = copyright
  const buffer = doc.createBuffer()
  const normals = vertexNormals(positions, indices)
  const pos = doc.createAccessor('position').setType('VEC3').setArray(positions).setBuffer(buffer)
  const nor = doc.createAccessor('normal').setType('VEC3').setArray(normals).setBuffer(buffer)
  const part = doc.createAccessor('part').setType('SCALAR').setArray(Uint16Array.from(partIds)).setBuffer(buffer)
  const idx = doc.createAccessor('indices').setType('SCALAR').setArray(indices.length > 65535 ? indices : Uint16Array.from(indices)).setBuffer(buffer)
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nor).setAttribute('_PART', part).setIndices(idx)
  const mesh = doc.createMesh('anatomy').addPrimitive(prim)
  const node = doc.createNode('anatomy').setMesh(mesh)
  doc.createScene('scene').addChild(node)
  await doc.transform(quantize({ quantizePosition: 16, quantizeNormal: 10 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }))
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  const glb = await io.writeBinary(doc)
  fs.writeFileSync(file, glb)
  return glb.byteLength
}
