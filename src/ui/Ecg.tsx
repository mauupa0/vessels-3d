import { useEffect, useRef } from 'react'
import { store } from '../store'
import { beat as beatClock } from '../beat'

const g = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2))

/** One heartbeat of a synthetic ECG; the R wave sits just before the visual contraction. */
export function ecg(phase: number): number {
  const p = phase - Math.floor(phase)
  let y = 0
  for (const o of [-1, 0, 1]) {
    const q = p + o
    y += 0.13 * g(q, -0.12, 0.03) - 0.14 * g(q, -0.012, 0.009) + 1 * g(q, 0.02, 0.012) - 0.22 * g(q, 0.045, 0.012) + 0.3 * g(q, 0.25, 0.05)
  }
  return y
}

const WINDOW = 3.2

export default function Ecg({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let running = false
    const css = getComputedStyle(document.documentElement)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.scale(dpr, dpr)
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      const beat = beatClock.value
      const grad = ctx.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0, 'rgba(236,228,213,0)')
      grad.addColorStop(0.7, css.getPropertyValue('--bone-dim') || '#bbb')
      grad.addColorStop(1, css.getPropertyValue('--accent') || '#fb4')
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.beginPath()
      for (let x = 0; x <= w; x += 1) {
        const t = beat - ((w - x) / w) * WINDOW
        const y = h * 0.78 - ecg(t) * h * 0.62
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    const sync = () => {
      const s = store.get()
      const want = !s.paused && s.stageVisible && !reducedMotion
      if (want && !running) {
        running = true
        raf = requestAnimationFrame(loop)
      } else if (!want && running) {
        running = false
        cancelAnimationFrame(raf)
        draw()
      }
    }
    sync()
    draw()
    const unsub = store.subscribe(sync)
    return () => {
      unsub()
      cancelAnimationFrame(raf)
    }
  }, [reducedMotion])
  return <canvas ref={ref} className="ecg" aria-hidden="true" />
}
