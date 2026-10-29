import fs from 'node:fs'

// Intermediate store: parts.json (metadata) + parts.bin (positions float32, indices uint32 per part).
export function saveParts(dir, parts) {
  fs.mkdirSync(dir, { recursive: true })
  const meta = []
  const chunks = []
  let off = 0
  for (const p of parts) {
    const { mesh, ...rest } = p
    meta.push({ ...rest, vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3, voff: off, ioff: off + mesh.positions.byteLength })
    chunks.push(Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength))
    chunks.push(Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength))
    off += mesh.positions.byteLength + mesh.indices.byteLength
  }
  fs.writeFileSync(dir + '/parts.bin', Buffer.concat(chunks))
  fs.writeFileSync(dir + '/parts.json', JSON.stringify(meta))
}

export function loadParts(dir) {
  const meta = JSON.parse(fs.readFileSync(dir + '/parts.json', 'utf8'))
  const blob = fs.readFileSync(dir + '/parts.bin')
  const ab = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)
  return meta.map((m) => ({
    ...m,
    mesh: {
      positions: new Float32Array(ab.slice(m.voff, m.voff + m.vertices * 12)),
      indices: new Uint32Array(ab.slice(m.ioff, m.ioff + m.triangles * 12)),
    },
  }))
}
