import { regenerate } from '../engine'
import { store, useStore, type SectionAxis } from '../store'
import Ecg from './Ecg'
import { IconGrow, IconHome, IconPause, IconPlay, IconSection } from './icons'

const AXES: { id: SectionAxis; label: string; title: string }[] = [
  { id: 'y', label: 'Across', title: 'Transverse cut, top to bottom' },
  { id: 'z', label: 'Front', title: 'Coronal cut, front to back' },
  { id: 'x', label: 'Side', title: 'Sagittal cut, side to side' },
]

declare global {
  interface Window {
    __vessels?: Record<string, unknown>
  }
}

export default function Dock({ reducedMotion }: { reducedMotion: boolean }) {
  const paused = useStore((s) => s.paused)
  const bpm = useStore((s) => s.bpm)
  const section = useStore((s) => s.section)
  const seed = useStore((s) => s.seed)
  const tier = useStore((s) => s.tier)
  const busy = useStore((s) => s.genProgress !== null)
  const growing = useStore((s) => s.growing)
  const intro = useStore((s) => s.intro)

  const home = () => (window.__vessels?.home as (() => void) | undefined)?.()
  return (
    <div className="dock" role="group" aria-label="Playback and view controls">
      <div>
        <button className="icon-btn" aria-label={paused ? 'Resume the heartbeat' : 'Pause the heartbeat'} onClick={() => store.set({ paused: !paused })}>
          {paused ? <IconPlay /> : <IconPause />}
          <span className="cap">{paused ? 'Play' : 'Pause'}</span>
        </button>
      </div>
      <div>
        <Ecg reducedMotion={reducedMotion} />
        <div className="field">
          <label htmlFor="bpm">Heart rate</label>
          <div className="bpm">
            <input id="bpm" type="range" min={40} max={180} step={1} value={bpm} onChange={(e) => store.set({ bpm: Number(e.target.value) })} aria-valuetext={bpm + ' beats per minute'} />
            <output htmlFor="bpm">{bpm}</output>
            <span>bpm</span>
          </div>
        </div>
      </div>
      <div className="hide-s">
        <button
          className="icon-btn"
          aria-pressed={section.on && !intro}
          aria-label="Cut the body open"
          title="Section plane"
          onClick={() => store.set({ section: { ...section, on: !section.on, t: section.on ? section.t : section.axis === 'y' ? 0.66 : 0.5 } })}
        >
          <IconSection />
        </button>
        {section.on && !intro && (
          <>
            <div className="seg" role="group" aria-label="Cut direction">
              {AXES.map((a) => (
                <button key={a.id} aria-pressed={section.axis === a.id} title={a.title} onClick={() => store.set({ section: { ...section, axis: a.id, t: 0.5 } })}>
                  {a.label}
                </button>
              ))}
            </div>
            <input type="range" min={0} max={1000} value={Math.round(section.t * 1000)} aria-label="Cut position" onChange={(e) => store.set({ section: { ...section, t: Number(e.target.value) / 1000 } })} />
          </>
        )}
      </div>
      <div className="replay-cell">
        <button className="icon-btn" aria-label="Replay the vessel growth" title="Replay the growth" disabled={growing || busy} onClick={() => store.set({ growth: 0, growing: true })}>
          <IconGrow />
          <span className="cap">Regrow</span>
        </button>
        <button className="icon-btn hide-s" aria-label={'Grow new vessels from seed ' + (seed + 1)} title={'New seed (' + seed + ')'} disabled={busy} onClick={() => regenerate(seed + 1, tier)} style={{ width: 'auto', padding: '0 10px', fontSize: 13 }}>
          Seed {seed}
        </button>
      </div>
      <div>
        <button className="icon-btn" aria-label="Reset the view" title="Reset the view" onClick={home}>
          <IconHome />
          <span className="cap">Reset</span>
        </button>
      </div>
    </div>
  )
}
