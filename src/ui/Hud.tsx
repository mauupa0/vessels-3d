import { AnimatePresence, LazyMotion, domAnimation, m } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { ORGANS, partVolumeMl, type PartMeta } from '../lib/anatomy'
import { describePick, fmt } from '../lib/describe'
import { store, useStore, type LayerId } from '../store'
import Dock from './Dock'
import { IconClose, IconDown } from './icons'

const ORGAN_ORDER = ['brain', 'heart', 'right-lung', 'left-lung', 'liver', 'stomach', 'spleen', 'pancreas', 'right-kidney', 'left-kidney', 'small-intestine', 'large-intestine', 'bladder', 'gallbladder', 'right-adrenal', 'left-adrenal', 'trachea']

const volumeLabel = (ml: number | null) => (ml === null ? '' : ml >= 1000 ? fmt(ml / 1000, 1) + ' L' : fmt(ml) + ' mL')

function LayerList() {
  const layers = useStore((s) => s.layers)
  const meta = useStore((s) => s.meta)
  const model = useStore((s) => s.model)
  const segs = (a: 'artery' | 'pulmArtery' | 'vein' | 'pulmVein', b: 'artery' | 'pulmArtery' | 'vein' | 'pulmVein') => (model ? fmt(model.trees[a].segments + model.trees[b].segments) : '')
  const rows: { id: LayerId; label: string; swatch: string; count: string }[] = [
    { id: 'skin', label: 'Skin', swatch: 'var(--skin-swatch)', count: '' },
    { id: 'skeleton', label: 'Skeleton', swatch: 'var(--bone-swatch)', count: meta ? fmt(meta.layers.skeleton.parts) + ' parts' : '' },
    { id: 'organs', label: 'Organs', swatch: 'var(--organ)', count: meta ? fmt(meta.layers.organs.parts) + ' organs' : '' },
    { id: 'arteries', label: 'Arteries', swatch: 'var(--artery)', count: segs('artery', 'pulmArtery') },
    { id: 'veins', label: 'Veins', swatch: 'var(--vein)', count: segs('vein', 'pulmVein') },
  ]
  return (
    <div>
      <h2 className="group-title" style={{ fontFamily: 'var(--sans)', letterSpacing: 0 }}>
        Layers
      </h2>
      <div className="layers" role="group" aria-label="Layers">
        {rows.map((r) => (
          <button key={r.id} className="layer" aria-pressed={layers[r.id]} style={{ ['--sw' as string]: r.swatch }} onClick={() => store.set((s) => ({ layers: { ...s.layers, [r.id]: !s.layers[r.id] } }))}>
            <span className="swatch" />
            <span>{r.label}</span>
            <span className="count">{r.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function OrganList() {
  const meta = useStore((s) => s.meta)
  const selected = useStore((s) => s.selected)
  const hover = useStore((s) => s.hover)
  const parts = useMemo(() => {
    if (!meta) return []
    const byId = new Map(meta.parts.filter((p) => p.group === 'organ').map((p) => [p.id, p]))
    return ORGAN_ORDER.map((id) => byId.get(id)).filter((p): p is PartMeta => !!p)
  }, [meta])
  if (!meta) return null
  const pick = (p: PartMeta) => {
    const same = selected?.layer === 'organs' && selected.index === p.index
    store.set((s) => ({ selected: same ? null : { layer: 'organs', index: p.index }, layers: { ...s.layers, organs: true } }))
  }
  return (
    <div className="organs-wrap">
      <h2 className="group-title" style={{ fontFamily: 'var(--sans)', letterSpacing: 0 }}>
        Organs
      </h2>
      <ul className="organs">
        {parts.map((p) => (
          <li key={p.id}>
            <button
              className={'organ' + (hover?.layer === 'organs' && hover.index === p.index ? ' hot' : '')}
              aria-current={selected?.layer === 'organs' && selected.index === p.index}
              onClick={() => pick(p)}
            >
              <span>{ORGANS[p.id]?.name ?? p.name}</span>
              <small>{volumeLabel(partVolumeMl(meta, p.id))}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Card({ reducedMotion }: { reducedMotion: boolean }) {
  const selected = useStore((s) => s.selected)
  const meta = useStore((s) => s.meta)
  const model = useStore((s) => s.model)
  const info = selected && meta ? describePick(selected, meta, model) : null
  const key = selected ? selected.layer + ':' + selected.index : 'none'
  return (
    <AnimatePresence mode="wait">
      {info && (
        <m.aside
          key={key}
          className="card"
          aria-label={info.title}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: reducedMotion ? 0.12 : 0.24, ease: [0.23, 1, 0.32, 1] }}
        >
          <button className="close" aria-label="Close the details" onClick={() => store.set({ selected: null })}>
            <IconClose />
          </button>
          <h2>{info.title}</h2>
          {info.fact && <p className="fact">{info.fact}</p>}
          <dl>
            {info.rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </m.aside>
      )}
    </AnimatePresence>
  )
}

function Tooltip() {
  const hover = useStore((s) => s.hover)
  const selected = useStore((s) => s.selected)
  const meta = useStore((s) => s.meta)
  const model = useStore((s) => s.model)
  const ref = useRef<HTMLDivElement>(null)
  const label = hover && meta ? describePick(hover, meta, model)?.title : null
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const el = ref.current
      if (el) el.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [])
  const hide = !label || (selected && hover && selected.layer === hover.layer && selected.index === hover.index)
  return (
    <div ref={ref} className="tip" style={{ opacity: hide ? 0 : 1, transition: 'opacity 120ms' }} role="presentation">
      {label}
    </div>
  )
}

function Hint() {
  const selected = useStore((s) => !!s.selected)
  const ready = useStore((s) => !!s.model && !s.intro)
  return (
    <p className="hint" style={{ opacity: selected || !ready ? 0 : 1 }} aria-hidden="true">
      Hover an organ, a bone or a vessel.
      <br />
      Click it to look closer.
    </p>
  )
}

function Loader() {
  const progress = useStore((s) => s.genProgress)
  const model = useStore((s) => s.model)
  const error = useStore((s) => s.loadError)
  if (error) {
    return (
      <div className="errorbox" role="alert">
        Something failed while loading: {error}. Reload the page, or open it with ?quality=light.
      </div>
    )
  }
  if (!progress || model) return null
  return (
    <div className="loader" role="status" aria-live="polite">
      <div>{progress.label}</div>
      <div className="bar">
        <i style={{ transform: `scaleX(${Math.max(0.03, progress.fraction)})` }} />
      </div>
    </div>
  )
}

function StatLine() {
  const stats = useStore((s) => s.stats)
  if (stats.fps <= 0) return null
  return (
    <div className="statline" aria-hidden="true">
      <div>
        {fmt(stats.fps)} fps, {fmt(stats.frameMs, 1)} ms a frame
      </div>
      <div>
        {fmt(stats.drawCalls)} draw calls, {fmt(stats.triangles / 1e6, 2)} M triangles
      </div>
    </div>
  )
}

export default function Hud({ reducedMotion }: { reducedMotion: boolean }) {
  // the chip row and the card sit above the dock whatever height the dock has
  useEffect(() => {
    const dock = document.querySelector<HTMLElement>('.dock')
    const stage = dock?.closest<HTMLElement>('.stage')
    if (!dock || !stage) return
    const apply = () => stage.style.setProperty('--dock-h', dock.offsetHeight + 'px')
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(dock)
    return () => ro.disconnect()
  }, [])
  const hasCard = useStore((s) => !!s.selected)
  useEffect(() => {
    document.querySelector<HTMLElement>('.stage')?.setAttribute('data-card', hasCard ? '1' : '0')
  }, [hasCard])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.set({ selected: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <LazyMotion features={domAnimation} strict>
      <header className="brand">
        <h1>Vessels</h1>
        <p>A human body from an open atlas. Its vessels are grown by an algorithm, live in your browser.</p>
      </header>
      <nav className="topnav" aria-label="Page sections">
        <a href="#how">
          <span>How it works</span>
          <IconDown />
        </a>
        <a href="#sources">
          <span>Sources</span>
        </a>
      </nav>
      <aside className="rail" aria-label="Anatomy controls">
        <LayerList />
        <OrganList />
      </aside>
      <Card reducedMotion={reducedMotion} />
      <Hint />
      <Tooltip />
      <Dock reducedMotion={reducedMotion} />
      <Loader />
      <StatLine />
    </LazyMotion>
  )
}
