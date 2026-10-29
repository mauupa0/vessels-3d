import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from 'react'
import { boot } from './engine'
import { store, useStore } from './store'
import Hud from './ui/Hud'
import HowItWorks from './ui/HowItWorks'
import { useReducedMotion } from './useReducedMotion'

const Scene = lazy(() => import('./scene/Scene'))

function useViewport() {
  const subscribe = (cb: () => void) => {
    window.addEventListener('resize', cb)
    return () => window.removeEventListener('resize', cb)
  }
  const w = useSyncExternalStore(subscribe, () => window.innerWidth, () => 1440)
  const h = useSyncExternalStore(subscribe, () => window.innerHeight, () => 900)
  return { w, h }
}

export default function App() {
  const reduced = useReducedMotion()
  const { w, h } = useViewport()
  const selected = useStore((s) => !!s.selected)
  const stageRef = useRef<HTMLElement>(null)
  useEffect(() => boot(), [])

  // pause rendering while the stage is scrolled out of view
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => store.set({ stageVisible: e.isIntersecting }), { threshold: 0.02 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const desktop = w > 860
  // fitBottom and fitTop size the body once; bottom and top only shift it while a card is open
  const insets = desktop
    ? { left: 292 + 24, right: selected ? 340 + 24 : 0, top: 0, bottom: 104, fitBottom: 104, fitTop: 20 }
    : { left: 0, right: 0, top: 64, bottom: selected ? Math.min(h * 0.46, 330) : 130, fitBottom: 130, fitTop: 64 }
  return (
    <>
      <section className="stage" ref={stageRef} aria-label="Interactive human body">
        <div className="stage-canvas" role="img" aria-label="A 3D human body with skin, skeleton, organs, arteries and veins. Use the controls to explore it.">
          <Suspense fallback={null}>
            <Scene reducedMotion={reduced} insets={insets} />
          </Suspense>
        </div>
        <div className="vignette" />
        <Hud reducedMotion={reduced} />
      </section>
      <HowItWorks />
    </>
  )
}
