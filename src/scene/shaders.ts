import * as THREE from 'three'

/** Interaction accent, the only warm hue in the scene. */
export const ACCENT = new THREE.Color('#ffb04a')

// ---------------------------------------------------------------------------------------------------------------
// Anatomy (bones, cartilage, organs): MeshPhysicalMaterial patched with a per-part highlight, focus stipple and
// the heart and lung motion. All state lives in uniforms, so selecting something never touches the geometry.
// ---------------------------------------------------------------------------------------------------------------

export interface AnatomyUniforms {
  uHover: { value: number }
  uSel: { value: number }
  uFocus: { value: number }
  uStipple: { value: number }
  uGhost: { value: number }
  uSelAlpha: { value: number }
  uAccent: { value: THREE.Color }
  uBeatScale: { value: number }
  uBreath: { value: number }
  uHeartPart: { value: number }
  uHeartCenter: { value: THREE.Vector3 }
  uLungPartA: { value: number }
  uLungPartB: { value: number }
  uLungCenter: { value: THREE.Vector3 }
}

export function makeAnatomyUniforms(): AnatomyUniforms {
  return {
    uHover: { value: -1 },
    uSel: { value: -1 },
    uFocus: { value: 0 },
    uStipple: { value: 0 },
    uGhost: { value: 0 },
    uSelAlpha: { value: 1 },
    uAccent: { value: ACCENT.clone() },
    uBeatScale: { value: 1 },
    uBreath: { value: 1 },
    uHeartPart: { value: -1 },
    uHeartCenter: { value: new THREE.Vector3() },
    uLungPartA: { value: -1 },
    uLungPartB: { value: -1 },
    uLungCenter: { value: new THREE.Vector3() },
  }
}

const BAYER = /* glsl */ `
float bayer4(vec2 p) {
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 q = ivec2(mod(p, 4.0));
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
`

export function patchAnatomy(shader: THREE.WebGLProgramParametersWithUniforms, u: AnatomyUniforms) {
  Object.assign(shader.uniforms, u)
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      /* glsl */ `#include <common>
attribute float aPart;
attribute vec2 aSurf;
varying float vPart;
varying vec2 vSurf;
uniform float uHeartPart; uniform vec3 uHeartCenter; uniform float uBeatScale;
uniform float uLungPartA; uniform float uLungPartB; uniform vec3 uLungCenter; uniform float uBreath;`,
    )
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
vPart = aPart;
vSurf = aSurf;
if (abs(aPart - uHeartPart) < 0.5) transformed = uHeartCenter + (transformed - uHeartCenter) * uBeatScale;
if (abs(aPart - uLungPartA) < 0.5 || abs(aPart - uLungPartB) < 0.5) transformed = uLungCenter + (transformed - uLungCenter) * uBreath;`,
    )
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      /* glsl */ `#include <common>
varying float vPart;
varying vec2 vSurf;
uniform float uHover; uniform float uSel; uniform float uFocus; uniform float uStipple; uniform float uGhost; uniform float uSelAlpha; uniform vec3 uAccent;
${BAYER}`,
    )
    .replace(
      '#include <clipping_planes_fragment>',
      /* glsl */ `#include <clipping_planes_fragment>
float isSel = 1.0 - step(0.5, abs(vPart - uSel));
float isHov = 1.0 - step(0.5, abs(vPart - uHover));
float fade = max(uGhost, uStipple * (1.0 - isSel));
if (fade > 0.0 && bayer4(gl_FragCoord.xy) < fade) discard;`,
    )
    .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replace('float roughnessFactor = roughness;', 'float roughnessFactor = vSurf.x;'))
    .replace('#include <lights_physical_fragment>', THREE.ShaderChunk.lights_physical_fragment.replace('material.clearcoat = clearcoat;', 'material.clearcoat = vSurf.y;'))
    .replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
diffuseColor.rgb *= mix(1.0, 0.32, uFocus * (1.0 - isSel));
diffuseColor.a *= mix(1.0, uSelAlpha, isSel);`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.2);
totalEmissiveRadiance += uAccent * (isHov * (0.03 + 0.35 * rimF) + isSel * (0.42 * rimF));`,
    )
}

// ---------------------------------------------------------------------------------------------------------------
// Skin: two translucent passes with a fresnel rim and a soft vertical key light.
// ---------------------------------------------------------------------------------------------------------------

export const skinVertex = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mvPosition.xyz;
  vH = position.y;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
`

export const skinFragment = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uTint;
uniform vec3 uEdge;
uniform float uBase;
uniform float uStrength;
uniform float uPower;
uniform float uGhost;
uniform vec3 uKey;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  #include <clipping_planes_fragment>
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(vV);
  float f = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), uPower);
  float key = clamp(dot(n, normalize(uKey)) * 0.5 + 0.5, 0.0, 1.0);
  float head = smoothstep(0.7, 1.7, vH);
  vec3 col = mix(uTint * (0.55 + 0.6 * key), uEdge, f);
  col += uEdge * 0.10 * head * key;
  float a = (uBase + uStrength * f) * (1.0 - uGhost);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`

// ---------------------------------------------------------------------------------------------------------------
// Vessels: instanced tubes. The vertex shader builds each tube from two endpoints, so a whole tree is one draw call.
// ---------------------------------------------------------------------------------------------------------------

export const vesselVertex = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
attribute vec2 aUnit;
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aRS;
attribute vec2 aMeta;
attribute vec3 aTA;
attribute vec3 aTB;

uniform float uBeat;
uniform float uInvWavelength;
uniform float uSwell;
uniform float uPxScale;
uniform float uMinPx;
uniform float uGrowth;
uniform float uSelOrgan;
uniform float uFocus;
uniform float uHoverInst;
uniform float uBoost;
uniform float uMinRadius;

varying vec3 vN;
varying float vPulse;
varying float vDepth;
varying float vThin;
varying float vRad;
varying float vDim;
varying float vHover;
varying float vFade;
varying float vBoost;

void main() {
  float birth = aMeta.y;
  float g = clamp((uGrowth - birth) * 30.0, 0.0, 1.0);
  // level of detail: far away the finest twigs are skipped, they resolve as the camera comes closer
  g *= step(uMinRadius, max(aRS.x, aRS.y) * uBoost);
  vec3 bEff = mix(aA, aB, g);
  float e0 = aUnit.y;
  vec3 axis = bEff - aA;
  float len = max(length(axis), 1e-6);
  // Each end uses the tangent shared with the neighbouring segment, so the rings of two joined tubes coincide: no seams, no overlap.
  vec3 t = normalize(e0 < 0.5 ? aTA : aTB);
  vec3 up = abs(t.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(up, t));
  vec3 v = cross(t, u);

  float e = aUnit.y;
  float r = mix(aRS.x, aRS.y, e) * uBoost;
  float s = mix(aRS.z, aRS.w, e);
  vec3 center = mix(aA, bEff, e);

  float ph = fract(uBeat - s * uInvWavelength);
  float attack = smoothstep(0.0, 0.06, ph);
  float pulse = exp(-ph * 6.0) * attack;

  vec4 mvc = modelViewMatrix * vec4(center, 1.0);
  float pxWorld = max(-mvc.z, 0.05) * uPxScale;
  float minR = uMinPx * pxWorld * 0.5;
  vRad = r;
  float rr = r * (1.0 + uSwell * pulse);
  vThin = clamp(minR / max(rr, 1e-6) - 1.0, 0.0, 1.0);
  rr = max(rr, minR) * step(0.001, g);

  vec3 n = cos(aUnit.x) * u + sin(aUnit.x) * v;
  vec3 p = center + n * rr;
  vN = normalize(mat3(modelViewMatrix) * n);
  vPulse = pulse;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mvPosition.z;
  float inSel = uSelOrgan < 0.0 ? 1.0 : 1.0 - step(0.5, abs(aMeta.x - uSelOrgan));
  float isGen = step(0.00005, birth);
  vDim = mix(1.0, mix(0.35, 1.0, inSel), uFocus);
  vFade = uFocus * (1.0 - inSel) * mix(0.985, 1.0, isGen);
  vBoost = uFocus * inSel;
  vHover = 1.0 - step(0.5, abs(float(gl_InstanceID) - uHoverInst));
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
`

export const vesselFragment = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uBase;
uniform vec3 uHot;
uniform vec3 uFog;
uniform vec3 uAccent;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAmp;
uniform float uGlow;

varying vec3 vN;
varying float vPulse;
varying float vDepth;
varying float vThin;
varying float vRad;
varying float vDim;
varying float vHover;
varying float vFade;
varying float vBoost;
${BAYER}
void main() {
  #include <clipping_planes_fragment>
  if (vFade > 0.0 && bayer4(gl_FragCoord.xy) < vFade) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 l = normalize(vec3(-0.45, 0.65, 0.62));
  float dif = dot(n, l) * 0.5 + 0.5;
  dif = dif * dif;
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.5);
  float heat = clamp(vPulse * uAmp, 0.0, 1.0);
  vec3 col = uBase * (0.55 + 0.6 * dif);
  col = mix(col, uHot, heat * 0.55);
  col += uHot * heat * uGlow;
  col += vec3(0.35) * rim * 0.12;
  col = col * (1.0 + 0.9 * vBoost) + uHot * vBoost * 0.12;
  col = mix(uAccent * 1.4, col, 1.0 - vHover * 0.85);
  float fog = smoothstep(uFogNear, uFogFar, vDepth) * 0.55;
  col = mix(col, uFog, fog);
  float w = smoothstep(0.0009, 0.0042, vRad);
  col *= mix(0.9, 1.0, w) * (1.0 - 0.1 * vThin);
  col = mix(uFog, col, vDim);
  gl_FragColor = vec4(col, 1.0);
}
`

// ---------------------------------------------------------------------------------------------------------------
// Picking: the same geometry rendered with ids instead of colour into a 1 x 1 target.
// ---------------------------------------------------------------------------------------------------------------

export const pickPartVertex = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
attribute float aPart;
varying float vP;
void main() {
  vP = aPart;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
`

export const pickFragment = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform float uLayer;
varying float vP;
void main() {
  #include <clipping_planes_fragment>
  float id = floor(vP + 0.5);
  gl_FragColor = vec4(mod(id, 256.0) / 255.0, floor(id / 256.0) / 255.0, 0.0, uLayer / 255.0);
}
`

export const pickVesselVertex = vesselVertex
  .replace('varying float vHover;', 'varying float vHover;\nvarying float vInst;')
  .replace('vHover = 1.0 - step(0.5, abs(float(gl_InstanceID) - uHoverInst));', 'vHover = 0.0;\n  vInst = float(gl_InstanceID);')
  .replace('float minR = uMinPx * pxWorld * 0.5;', 'float minR = (uMinPx + 3.0) * pxWorld * 0.5;')

export const pickVesselFragment = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform float uLayer;
varying float vInst;
void main() {
  #include <clipping_planes_fragment>
  float id = floor(vInst + 0.5);
  float lo = mod(id, 256.0);
  float mid = mod(floor(id / 256.0), 256.0);
  float hi = floor(id / 65536.0);
  gl_FragColor = vec4(lo / 255.0, mid / 255.0, hi / 255.0, uLayer / 255.0);
}
`
