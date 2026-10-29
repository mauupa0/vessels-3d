import { CameraControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ElementRef } from 'react'
import * as THREE from 'three'
import { ORGANS, type PartMeta } from '../lib/anatomy'
import { heartScale } from '../lib/wave'
import { samePick, store, type Pick } from '../store'
import { Picker } from './picking'
import { anatomyUniforms, BODY_RANGE, camState, FOV, sectionPlane, skinUniforms, vesselHover, vesselShared } from './registry'

type Controls = ElementRef<typeof CameraControls>

const TARGET = new THREE.Vector3(0, 0.9, 0)
const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt))

export interface RigProps {
  reducedMotion: boolean
  /** Pixels of the viewport covered by interface panels; the body is centred in what is left. */
  insets: { left: number; right: number; top: number; bottom: number; fitBottom: number; fitTop: number }
  parts: PartMeta[]
}

function dirFromAngles(azDeg: number, polDeg: number, out = new THREE.Vector3()) {
  const az = (azDeg * Math.PI) / 180
  const pol = (polDeg * Math.PI) / 180
  return out.set(Math.sin(az) * Math.sin(pol), Math.cos(pol), Math.cos(az) * Math.sin(pol))
}

export default function Rig({ reducedMotion, insets, parts }: RigProps) {
  const { camera, gl, scene, size, invalidate } = useThree()
  const dpr = useThree((s) => s.viewport.dpr)
  const controls = useRef<Controls>(null)
  const picker = useMemo(() => new Picker(), [])
  const persp = camera as THREE.PerspectiveCamera
  const fitDist = useRef(3.6)
  const beat = useRef(0.1)
  const breath = useRef(0)
  const lastInput = useRef(performance.now())
  const frames = useRef<number[]>([])
  const lastReport = useRef(0)
  const anim = useRef({ focus: 0, skinGhost: 0, skeletonGhost: 0, organsGhost: 0, organsStipple: 0, skeletonStipple: 0, selAlpha: 1, introT: 0, appearSkeleton: 1, appearOrgans: 1, appearSkin: 1, offX: 0, offY: 0 })
  const prevLayers = useRef(store.get().layers)
  const byLayerIndex = useMemo(() => new Map(parts.map((p) => [p.layer + ':' + p.index, p])), [parts])
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts])

  useEffect(() => {
    gl.info.autoReset = false
    gl.localClippingEnabled = true
    return () => picker.dispose()
  }, [gl, picker])

  // camera fit and view offset (panels cover part of the canvas, the body stays centred in the free area)
  useEffect(() => {
    persp.fov = FOV
    const t = Math.tan((FOV * Math.PI) / 360)
    const freeH = Math.max(0.4, (size.height - 40 - insets.fitTop - insets.fitBottom) / size.height)
    const freeW = Math.max(0.4, (size.width - insets.left - Math.min(insets.right, 0)) / size.height)
    const d = Math.max(0.84 / (t * freeH), 0.5 / (t * freeW))
    fitDist.current = d
    persp.near = 0.05
    persp.far = 14
    persp.updateProjectionMatrix()
    vesselShared.uPxScale.value = (2 * t) / (size.height * gl.getPixelRatio())
    // the thinnest vessel stays 1.25 screen pixels wide when the frame is supersampled, not 1.25 pixels of the larger frame
    vesselShared.uMinPx.value = 1.25 * Math.max(1, dpr / (window.devicePixelRatio || 1))
    vesselShared.uFogNear.value = d - 0.3
    vesselShared.uFogFar.value = d + 0.8
    camState.w = size.width
    camState.h = size.height
    invalidate()
  }, [persp, size, gl, dpr, invalidate, insets.fitBottom, insets.fitTop, insets.left])

  const home = (animate: boolean) => {
    const c = controls.current
    if (!c) return
    const p = TARGET.clone().add(dirFromAngles(16, 86).multiplyScalar(fitDist.current))
    c.setLookAt(p.x, p.y, p.z, TARGET.x, TARGET.y, TARGET.z, animate)
  }

  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.minDistance = 0.22
    c.maxDistance = 4.6
    c.minPolarAngle = 0.12
    c.maxPolarAngle = Math.PI - 0.12
    c.smoothTime = 0.28
    c.draggingSmoothTime = 0.1
    c.dollySpeed = 0.7
    c.truckSpeed = 1.2
    c.infinityDolly = false
    c.dollyToCursor = false
    home(false)
    const bump = () => {
      lastInput.current = performance.now()
      invalidate()
    }
    c.addEventListener('controlstart', bump)
    const onUpdate = () => invalidate()
    c.addEventListener('update', onUpdate)
    return () => {
      c.removeEventListener('controlstart', bump)
      c.removeEventListener('update', onUpdate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidate])

  // selection -> fly the camera
  useEffect(() => {
    let prev: Pick | null = store.get().selected
    return store.subscribe(() => {
      const s = store.get()
      invalidate()
      if (samePick(prev, s.selected)) return
      prev = s.selected
      const c = controls.current
      if (!c) return
      if (!s.selected) return
      if (s.selected.layer === 'organs' || s.selected.layer === 'skeleton') {
        const part = byLayerIndex.get(s.selected.layer + ':' + s.selected.index)
        if (!part) return
        const info = ORGANS[part.id]
        const extent = Math.max(part.size[0], part.size[1], part.size[2])
        const center = new THREE.Vector3(...(part.anchor ?? part.center))
        const t = Math.tan((FOV * Math.PI) / 360)
        const aspect = Math.max(0.3, (size.width - insets.left - insets.right) / size.height)
        const fitW = (Math.max(part.size[0], part.size[2]) * 0.75) / (t * aspect)
        const dist = THREE.MathUtils.clamp(Math.max(extent * (info?.view.dist ?? 2.4), fitW), 0.42, 2.6)
        const dir = info ? dirFromAngles(info.view.az, info.view.pol) : c.camera.position.clone().sub(c.getTarget(new THREE.Vector3())).normalize()
        const pos = center.clone().add(dir.multiplyScalar(dist))
        c.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, true)
      }
    })
  }, [byLayerIndex, invalidate, size.width, size.height, insets.left, insets.right])

  // Section: when the axis changes, look at the cut face.
  useEffect(() => {
    let prev = store.get().section
    return store.subscribe(() => {
      const sec = store.get().section
      if (store.get().intro || (sec.on === prev.on && sec.axis === prev.axis)) {
        prev = sec
        return
      }
      const turnedOn = sec.on && (!prev.on || sec.axis !== prev.axis)
      prev = sec
      const c = controls.current
      if (!c || !turnedOn) return
      const dir = sec.axis === 'x' ? dirFromAngles(78, 80) : sec.axis === 'z' ? dirFromAngles(0, 84) : dirFromAngles(25, 38)
      const target = c.getTarget(new THREE.Vector3())
      const pos = target.clone().add(dir.multiplyScalar(Math.max(sec.axis === 'y' ? Math.max(2.4, fitDist.current * 0.8) : Math.max(1.6, fitDist.current * 0.45), c.distance)))
      c.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, true)
    })
  }, [])

  // pointer: hover and click picking
  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number } | null = null
    let pending = false
    let px = 0
    let py = 0
    const rectPoint = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const doHover = () => {
      pending = false
      const pick = picker.pick(gl, scene, persp, px, py)
      if (!samePick(pick, store.get().hover)) store.set({ hover: pick })
    }
    const onMove = (e: PointerEvent) => {
      lastInput.current = performance.now()
      if (e.buttons !== 0 || e.pointerType === 'touch') return
      const p = rectPoint(e)
      px = p.x
      py = p.y
      if (!pending) {
        pending = true
        requestAnimationFrame(doHover)
      }
      invalidate()
    }
    const onDown = (e: PointerEvent) => {
      lastInput.current = performance.now()
      down = rectPoint(e)
    }
    const onUp = (e: PointerEvent) => {
      if (!down) return
      const p = rectPoint(e)
      const moved = Math.hypot(p.x - down.x, p.y - down.y)
      down = null
      if (moved > 6) return
      const pick = picker.pick(gl, scene, persp, p.x, p.y)
      store.set({ selected: pick, hover: e.pointerType === 'touch' ? null : pick })
    }
    const onLeave = () => {
      if (store.get().hover) store.set({ hover: null })
    }
    const onWheel = () => (lastInput.current = performance.now())
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, scene, persp, picker, invalidate])

  // expose a tiny handle for tests and the interface (home, fly)
  useEffect(() => {
    ;(window as unknown as { __vessels?: Record<string, unknown> }).__vessels = {
      ...(window as unknown as { __vessels?: Record<string, unknown> }).__vessels,
      home: () => home(true),
      view: (az: number, pol: number, dist: number, target: [number, number, number] = [0, 0.9, 0], animate = false) => {
        const t = new THREE.Vector3(...target)
        const p = t.clone().add(dirFromAngles(az, pol).multiplyScalar(dist))
        controls.current?.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, animate)
      },
      store,
      renderFrames: () => gl.info.render.frame,
      controls: () => controls.current,
      camera: persp,
      pickAt: (x: number, y: number) => picker.pick(gl, scene, persp, x, y),
      partsById,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persp, gl, scene, picker, partsById])

  // statistics: read what the previous frame drew, then reset the counters
  useFrame((_, delta) => {
    const info = gl.info.render
    const calls = info.calls
    const tris = info.triangles
    gl.info.reset()
    const f = frames.current
    f.push(delta)
    if (f.length > 90) f.shift()
    const now = performance.now()
    if (now - lastReport.current > 500 && f.length > 10) {
      lastReport.current = now
      const sorted = [...f].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]
      const stats = { fps: med > 0 ? 1 / med : 0, frameMs: med * 1000, drawCalls: calls, triangles: tris, pixelRatio: gl.getPixelRatio() }
      store.set({ stats })
      ;(window as unknown as { __vessels?: Record<string, unknown> }).__vessels = { ...(window as unknown as { __vessels?: Record<string, unknown> }).__vessels, stats }
    }
  }, -2)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const s = store.get()
    const a = anim.current
    let moving = false

    if (!s.paused) {
      beat.current += (dt * s.bpm) / 60
      breath.current += dt * ((14 / 60) * Math.PI * 2)
    }
    vesselShared.uBeat.value = beat.current
    const camDist = controls.current ? controls.current.distance : fitDist.current
    vesselShared.uMinRadius.value = THREE.MathUtils.lerp(0, 0.00068, THREE.MathUtils.smoothstep(camDist, 1.6, 4.2))
    const hs = heartScale(beat.current)
    const lung = 1 + 0.016 * Math.sin(breath.current)
    for (const key of ['organs'] as const) {
      const u = anatomyUniforms[key]
      u.uBeatScale.value = hs
      u.uBreath.value = lung
    }

    // layers appearing: a dithered fade-in on first show
    const pl = prevLayers.current
    if (!pl.skeleton && s.layers.skeleton) a.appearSkeleton = 0
    if (!pl.organs && s.layers.organs) a.appearOrgans = 0
    if (!pl.skin && s.layers.skin) a.appearSkin = 0
    prevLayers.current = s.layers
    a.appearSkeleton = Math.min(1, a.appearSkeleton + dt / 0.55)
    a.appearOrgans = Math.min(1, a.appearOrgans + dt / 0.55)
    a.appearSkin = Math.min(1, a.appearSkin + dt / 0.6)
    if (a.appearSkeleton < 1 || a.appearOrgans < 1 || a.appearSkin < 1) moving = true

    // selection -> focus state
    const sel = s.selected
    const selPart = sel && (sel.layer === 'organs' || sel.layer === 'skeleton') ? byLayerIndex.get(sel.layer + ':' + sel.index) : null
    const hovPart = s.hover && (s.hover.layer === 'organs' || s.hover.layer === 'skeleton') ? byLayerIndex.get(s.hover.layer + ':' + s.hover.index) : null
    const selOrgans = sel?.layer === 'organs' ? sel.index : -1
    const selSkeleton = sel?.layer === 'skeleton' ? sel.index : -1
    const focusTarget = selPart ? 1 : 0
    const tg = {
      focus: focusTarget,
      skinGhost: selPart ? 0.86 : 0,
      skeletonGhost: sel?.layer === 'organs' ? 0.9 : 0,
      organsGhost: sel?.layer === 'skeleton' ? 0.92 : 0,
      organsStipple: sel?.layer === 'organs' ? 1 : 0,
      skeletonStipple: sel?.layer === 'skeleton' ? 1 : 0,
      selAlpha: sel?.layer === 'organs' ? 0.3 : 1,
    }
    const k = reducedMotion ? 60 : 7
    for (const key of Object.keys(tg) as (keyof typeof tg)[]) {
      const next = damp(a[key], tg[key], k, dt)
      if (Math.abs(next - tg[key]) > 0.002) moving = true
      a[key] = Math.abs(next - tg[key]) < 0.002 ? tg[key] : next
    }
    const sk = anatomyUniforms.skeleton
    const og = anatomyUniforms.organs
    sk.uSel.value = selSkeleton
    og.uSel.value = selOrgans
    sk.uHover.value = s.hover?.layer === 'skeleton' ? s.hover.index : -1
    og.uHover.value = s.hover?.layer === 'organs' ? s.hover.index : -1
    sk.uFocus.value = a.focus * (sel?.layer === 'skeleton' ? 1 : 0)
    og.uFocus.value = a.focus * (sel?.layer === 'organs' ? 1 : 0)
    og.uSelAlpha.value = a.selAlpha
    sk.uStipple.value = a.skeletonStipple
    og.uStipple.value = a.organsStipple
    sk.uGhost.value = Math.max(a.skeletonGhost, 1 - a.appearSkeleton)
    og.uGhost.value = Math.max(a.organsGhost, 1 - a.appearOrgans)
    const heart = partsById.get('heart')
    const lungA = partsById.get('right-lung')
    const lungB = partsById.get('left-lung')
    if (heart && lungA && lungB) {
      og.uHeartPart.value = heart.index
      og.uHeartCenter.value.set(...heart.center)
      og.uLungPartA.value = lungA.index
      og.uLungPartB.value = lungB.index
      og.uLungCenter.value.set((lungA.center[0] + lungB.center[0]) / 2, (lungA.center[1] + lungB.center[1]) / 2, (lungA.center[2] + lungB.center[2]) / 2)
    }
    for (const side of ['back', 'front'] as const) skinUniforms[side].uGhost.value = Math.max(a.skinGhost, 1 - a.appearSkin)

    // vessels: highlight the selected organ, hover and select an instance
    let selOrganLabel = -1
    if (selPart?.group === 'organ' && s.meta) selOrganLabel = s.meta.volume.labels.organs[selPart.id] ?? -1
    vesselShared.uSelOrgan.value = selOrganLabel
    vesselShared.uFocus.value = selOrganLabel >= 0 ? a.focus : 0
    for (const kind of Object.keys(vesselHover) as (keyof typeof vesselHover)[]) {
      const h = s.hover?.layer === kind ? s.hover.index : -1
      vesselHover[kind].value = h >= 0 ? h : sel?.layer === kind ? sel.index : -1
    }
    void hovPart

    // opening scan: the section plane sweeps from the feet to the head, then the vessels grow
    if (s.intro && s.stageVisible) {
      a.introT = Math.min(1, a.introT + dt / 3.4)
      const e = 1 - (1 - a.introT) ** 3
      const done = a.introT >= 1
      store.set({ section: { on: !done, axis: 'y', t: e * 1.04 }, intro: !done, growing: done })
      moving = true
    } else if (!s.intro) a.introT = 0

    // growth replay
    if (s.growing && s.stageVisible) {
      const next = Math.min(1, s.growth + dt / 7)
      store.set({ growth: next, growing: next < 1 })
      moving = true
    }
    vesselShared.uGrowth.value = store.get().growth

    // section plane
    const sec = s.section
    if (sec.on) {
      const r = BODY_RANGE[sec.axis]
      const c = r[0] + (r[1] - r[0]) * sec.t
      if (sec.axis === 'y') sectionPlane.normal.set(0, -1, 0)
      else if (sec.axis === 'x') sectionPlane.normal.set(-1, 0, 0)
      else sectionPlane.normal.set(0, 0, -1)
      sectionPlane.constant = c
      if (gl.clippingPlanes.length === 0) gl.clippingPlanes = [sectionPlane]
    } else if (gl.clippingPlanes.length) gl.clippingPlanes = []
    const side = sec.on ? THREE.DoubleSide : THREE.FrontSide
    scene.traverse((o) => {
      const l = (o.userData as { layer?: string }).layer
      if ((l === 'organs' || l === 'skeleton') && (o as THREE.Mesh).material) {
        const m = (o as THREE.Mesh).material as THREE.Material
        if (m.side !== side) {
          m.side = side
          m.needsUpdate = true
        }
        if (l === 'organs') {
          const see = a.selAlpha < 0.999
          if (m.transparent !== see) {
            m.transparent = see
            m.depthWrite = !see
            m.needsUpdate = true
          }
        }
      }
    })

    // view offset: keep the body centred in the area the panels leave free
    const targetX = -(insets.left - insets.right) / 2
    const targetY = (insets.bottom - insets.top) / 2
    a.offX = damp(a.offX, targetX, 6, dt)
    a.offY = damp(a.offY, targetY, 6, dt)
    if (Math.abs(a.offX - targetX) > 0.4 || Math.abs(a.offY - targetY) > 0.4) moving = true
    camState.ox = Math.round(a.offX)
    camState.oy = Math.round(a.offY)
    persp.setViewOffset(size.width, size.height, camState.ox, camState.oy, size.width, size.height)

    // idle spin
    const c = controls.current
    const idle = performance.now() - lastInput.current > 2800
    if (c && idle && !reducedMotion && !s.paused && s.stageVisible && !sel && !s.section.on) {
      c.rotate(dt * 0.09, 0, false)
      moving = true
    }
    if (moving && s.paused && s.stageVisible) invalidate()
  }, -1)

  return (
    <CameraControls ref={controls} makeDefault />
  )
}
