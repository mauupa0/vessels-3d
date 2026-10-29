// BodyParts3D / Z-Anatomy frame: x patient left, y posterior, z superior, metres.
// Scene frame (three.js): X patient left = viewer right when facing the front, Y up, Z anterior (towards the viewer).
// (x, y, z) -> (x, z, -y) is a proper rotation, so triangle winding is preserved.
export const toScene = (p) => [p[0], p[2], -p[1]]

export function toSceneMesh(mesh) {
  const p = new Float32Array(mesh.positions.length)
  for (let i = 0; i < p.length; i += 3) {
    p[i] = mesh.positions[i]
    p[i + 1] = mesh.positions[i + 2]
    p[i + 2] = -mesh.positions[i + 1]
  }
  return { positions: p, indices: mesh.indices }
}
