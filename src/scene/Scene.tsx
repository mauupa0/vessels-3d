import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { loadLayer } from '../lib/loadAnatomy'
import { TREE_KINDS } from '../lib/kinds'
import { supersampleRatio, TIERS } from '../lib/tiers'
import { store, useStore } from '../store'
import { AnatomyLayer, SkinLayer, VesselTree } from './Layers'
import { BG, camState } from './registry'
import Rig from './Rig'

function useGeometry(name: 'skin' | 'skeleton' | 'organs', wanted: boolean): THREE.BufferGeometry | null {
  const meta = useStore((s) => s.meta)
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  useEffect(() => {
    if (!meta || !wanted || geometry) return
    let cancelled = false
    loadLayer(name, meta)
      .then((g) => {
        if (cancelled) return g.dispose()
        setGeometry(g)
        store.set((s) => ({ loaded: { ...s.loaded, [name]: true } }))
      })
      .catch((e) => store.set({ loadError: String(e?.message ?? e) }))
    return () => {
      cancelled = true
    }
  }, [meta, name, wanted, geometry])
  return geometry
}

/** Full-screen gradient behind everything: a cool soft light centred on the body, so the figure has something to stand against. */
function Backdrop() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: { uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uCore: { value: new THREE.Color('#1f2e39') }, uEdge: { value: new THREE.Color(BG) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }',
        fragmentShader: `
          uniform vec2 uCenter; uniform float uAspect; uniform vec3 uCore; uniform vec3 uEdge; varying vec2 vUv;
          void main(){
            vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
            float r2 = dot(d, d);
            float wide = exp(-r2 * 2.6);
            float core = exp(-r2 * 11.0);
            vec3 col = mix(uEdge, uCore, wide * 0.8) + uCore * core * 0.28;
            col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  )
  useFrame(() => {
    const u = material.uniforms
    u.uCenter.value.set(0.5 - camState.ox / camState.w, 0.5 + camState.oy / camState.h + 0.03)
    u.uAspect.value = camState.w / camState.h
  })
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh frustumCulled={false} renderOrder={-10} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

function Floor() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color('#c9b8a4') } },
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          uniform vec3 uColor; varying vec2 vP;
          void main(){
            float r = length(vP);
            float pool = smoothstep(0.95, 0.0, r);
            float ring = 0.0;
            ring += smoothstep(0.003, 0.0, abs(r - 0.42)) * 0.22;
            float a = pool * pool * 0.14 + ring * smoothstep(0.95, 0.5, r);
            gl_FragColor = vec4(uColor, a);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.001, 0]} material={material} renderOrder={-1}>
      <circleGeometry args={[1.0, 96]} />
    </mesh>
  )
}

function Lights() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#04060a']} />
      <Lightformer form="rect" intensity={3.4} color="#ffe3c8" position={[-3.6, 4.6, 4]} scale={[6, 4, 1]} target={[0, 1, 0]} />
      <Lightformer form="rect" intensity={2.2} color="#9fc2ff" position={[5, 2.4, -4.2]} scale={[6, 6, 1]} target={[0, 1, 0]} />
      <Lightformer form="rect" intensity={0.9} color="#ffb48a" position={[1.2, -2, 3.5]} scale={[7, 2, 1]} target={[0, 0.6, 0]} />
      <Lightformer form="ring" intensity={1.4} color="#ffffff" position={[0, 6, 0]} scale={4} target={[0, 0, 0]} />
    </Environment>
  )
}

function Effects({ full }: { full: boolean }) {
  const { size, viewport } = useThree()
  if (!full) return null
  return (
    <EffectComposer multisampling={4} enableNormalPass={false} frameBufferType={THREE.HalfFloatType}>
      <N8AO aoRadius={0.1} distanceFalloff={0.6} intensity={2.4} quality="medium" halfRes={viewport.dpr > 1.5 || size.width > 1800} />
      <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.95} luminanceSmoothing={0.25} radius={0.72} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  )
}

export interface SceneProps {
  reducedMotion: boolean
  insets: { left: number; right: number; top: number; bottom: number; fitBottom: number; fitTop: number }
}

function Content({ reducedMotion, insets }: SceneProps) {
  const meta = useStore((s) => s.meta)
  const model = useStore((s) => s.model)
  const layers = useStore((s) => s.layers)
  const tier = useStore((s) => s.tier)
  const skin = useGeometry('skin', true)
  const organs = useGeometry('organs', true)
  const skeleton = useGeometry('skeleton', layers.skeleton || !!meta)
  const cfg = TIERS[tier]
  const parts = useMemo(() => meta?.parts ?? [], [meta])
  return (
    <>
      <color attach="background" args={[BG]} />
      <Lights />
      <directionalLight position={[-2.4, 3.6, 3.2]} intensity={1.15} color="#fff1e0" />
      <Backdrop />
      <Floor />
      <group>
        {skin && <SkinLayer geometry={skin} visible={layers.skin} />}
        {skeleton && <AnatomyLayer name="skeleton" geometry={skeleton} visible={layers.skeleton} />}
        {organs && <AnatomyLayer name="organs" geometry={organs} visible={layers.organs} />}
        {model &&
          TREE_KINDS.map((k) => (
            <VesselTree key={k + model.seed + model.tier} kind={k} tree={model.trees[k]} tier={model.tier} visible={k === 'artery' || k === 'pulmArtery' ? layers.arteries : layers.veins} />
          ))}
      </group>
      <Rig reducedMotion={reducedMotion} insets={insets} parts={parts} />
      <Effects full={cfg.postFx} />
    </>
  )
}

function useWindowSize() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

export default function Scene(props: SceneProps) {
  const tier = useStore((s) => s.tier)
  const paused = useStore((s) => s.paused)
  const visible = useStore((s) => s.stageVisible)
  const cfg = TIERS[tier]
  const size = useWindowSize()
  const ready = useStore((s) => !!s.model && !s.growing && !s.intro)
  const [slow, setSlow] = useState(false)
  const override = Number(new URLSearchParams(location.search).get('ss'))
  const wanted = override >= 1 && override <= 3 ? override : supersampleRatio(tier, size.w, size.h)
  // a machine that cannot hold 50 fps with the larger frame goes back to the native size for good
  const ss = slow ? 1 : wanted
  return (
    <Canvas
      dpr={[ss, Math.max(ss, cfg.maxPixelRatio)]}
      frameloop={paused || !visible ? 'demand' : 'always'}
      gl={{ antialias: cfg.msaa && !cfg.postFx, powerPreference: 'high-performance', alpha: false, stencil: false, toneMapping: cfg.postFx ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping }}
      camera={{ fov: 30, near: 0.05, far: 14, position: [0, 1, 3.6] }}
      onCreated={({ gl }) => {
        gl.setClearColor(BG)
      }}
    >
      <Content {...props} />
      {ss > 1 && ready && !paused && visible && <PerformanceMonitor onDecline={() => setSlow(true)} />}
    </Canvas>
  )
}
