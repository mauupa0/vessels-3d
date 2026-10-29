import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ORGANS } from '../lib/anatomy'
import { fmt } from '../lib/describe'
import { SEGMENT_STRIDE } from '../lib/generate'
import { TREE_KINDS } from '../lib/kinds'
import { pulse } from '../lib/wave'
import { WAVELENGTH } from '../beat'
import { useStore } from '../store'
import { IconPause, IconPlay } from './icons'

export function useVisible(ref: RefObject<Element | null>): boolean {
  const [v, setV] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setV(e.isIntersecting), { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return v
}

// ---------------------------------------------------------------------------------------------------------------
// Slice of the label volume the generator queries, drawn from the real data.
// ---------------------------------------------------------------------------------------------------------------

const SLICE_COLOURS: Record<string, [number, number, number]> = {}
function colourOfLabel(label: number, organIds: Record<number, string>): [number, number, number] {
  if (label === 1) return [58, 48, 44]
  if (label === 2) return [226, 218, 198]
  const id = organIds[label]
  const hex = (id && ORGANS[id]?.color) || '#c88'
  if (!SLICE_COLOURS[hex]) {
    const n = parseInt(hex.slice(1), 16)
    SLICE_COLOURS[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return SLICE_COLOURS[hex]
}

export function SliceViewer() {
  const meta = useStore((s) => s.meta)
  const model = useStore((s) => s.model)
  const ref = useRef<HTMLCanvasElement>(null)
  const dims = meta?.volume.dims
  const [slice, setSlice] = useState(24)
  const [probe, setProbe] = useState<string>('Move over the slice to query the volume.')
  const organIds = useMemo(() => {
    const m: Record<number, string> = {}
    if (meta) for (const [id, l] of Object.entries(meta.volume.labels.organs)) m[l] = id
    return m
  }, [meta])

  useEffect(() => {
    const c = ref.current
    if (!c || !meta || !model || !dims) return
    const [nx, ny, nz] = dims
    c.width = nx
    c.height = ny
    const g = c.getContext('2d')!
    const img = g.createImageData(nx, ny)
    const z = Math.min(nz - 1, slice)
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const l = model.labels[x + nx * (y + ny * z)]
        const o = ((ny - 1 - y) * nx + x) * 4
        if (l === 0) {
          img.data[o + 3] = 0
          continue
        }
        const [r, gg, b] = colourOfLabel(l, organIds)
        img.data[o] = r
        img.data[o + 1] = gg
        img.data[o + 2] = b
        img.data[o + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
  }, [meta, model, dims, slice, organIds])

  if (!meta || !dims) return null
  const [nx, ny] = dims
  const v = meta.volume
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!model) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * nx)
    const y = ny - 1 - Math.floor(((e.clientY - r.top) / r.height) * ny)
    if (x < 0 || y < 0 || x >= nx || y >= ny) return
    const l = model.labels[x + nx * (y + ny * slice)]
    const name = l === 0 ? 'outside the body' : l === 1 ? 'soft tissue' : l === 2 ? 'bone' : (ORGANS[organIds[l]]?.name ?? 'organ').toLowerCase()
    const height = v.origin[1] + (y + 0.5) * v.voxel
    setProbe(`${name}, ${fmt(height, 2)} m above the floor`)
  }
  return (
    <figure className="slice">
      <div className="slice-canvas" style={{ aspectRatio: `${nx} / ${ny}` }}>
        <canvas ref={ref} onPointerMove={onMove} aria-label="A slice through the label volume. Each pixel is a 6 millimetre voxel." role="img" />
      </div>
      <figcaption>
        <label htmlFor="slice-range">Depth of the slice, front to back</label>
        <input id="slice-range" type="range" min={0} max={dims[2] - 1} value={slice} onChange={(e) => setSlice(Number(e.target.value))} />
        <output aria-live="polite">{probe}</output>
        <p className="note">
          Slice {slice + 1} of {dims[2]}. {fmt(v.dims[0] * v.dims[1] * v.dims[2])} voxels of {v.voxel * 1000} mm, plus a {v.fine.voxel * 1000} mm grid for the organs.
        </p>
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Replay of the growth inside one organ, drawn from the generated segments.
// ---------------------------------------------------------------------------------------------------------------

const REPLAY_ORGANS = ['liver', 'right-kidney', 'right-lung', 'brain', 'small-intestine']

export function GrowthReplay({ reducedMotion }: { reducedMotion: boolean }) {
  const meta = useStore((s) => s.meta)
  const model = useStore((s) => s.model)
  const [organ, setOrgan] = useState('liver')
  const [t, setT] = useState(1)
  const [playing, setPlaying] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLCanvasElement>(null)
  const visible = useVisible(wrap)
  const raf = useRef(0)

  const prepared = useMemo(() => {
    if (!meta || !model) return null
    const label = meta.volume.labels.organs[organ]
    const part = meta.parts.find((p) => p.id === organ)
    if (!part || label === undefined) return null
    const segs: { kind: number; idx: number }[] = []
    TREE_KINDS.forEach((k, ki) => {
      const tr = model.trees[k]
      for (let i = 0; i < tr.segments; i++) if (tr.data[i * SEGMENT_STRIDE + 10] === label) segs.push({ kind: ki, idx: i })
    })
    return { part, segs, count: segs.length }
  }, [meta, model, organ])

  useEffect(() => {
    if (!playing || !visible || reducedMotion) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      let done = false
      setT((cur) => {
        const next = cur + dt / 5
        if (next >= 1) {
          done = true
          return 1
        }
        return next
      })
      if (done) setPlaying(false)
      else raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, visible, reducedMotion])

  useEffect(() => {
    const c = ref.current
    if (!c || !prepared || !model) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = c.clientWidth
    const h = c.clientHeight
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, h)
    const { part } = prepared
    const pad = 28
    const sx = part.size[0]
    const sy = part.size[1]
    const scale = Math.min((w - pad * 2) / sx, (h - pad * 2) / sy)
    const cx = w / 2
    const cy = h / 2
    const px = (x: number) => cx + (x - part.center[0]) * scale
    const py = (y: number) => cy - (y - part.center[1]) * scale
    g.lineCap = 'round'
    const colours = ['#e0533f', '#4f8df0', '#e3774f', '#7aa7f5']
    const faint = ['#7b2f2a', '#26407a', '#7b2f2a', '#26407a']
    for (const s of prepared.segs) {
      const tr = model.trees[TREE_KINDS[s.kind]]
      const o = s.idx * SEGMENT_STRIDE
      const birth = tr.data[o + 11]
      const atlas = birth === 0
      if (birth > t) continue
      const r = Math.max(0.6, tr.data[o + 7] * scale * 2)
      g.strokeStyle = atlas ? faint[s.kind] : colours[s.kind]
      g.globalAlpha = atlas ? 0.9 : 0.8
      g.lineWidth = Math.min(r, 5)
      g.beginPath()
      g.moveTo(px(tr.data[o]), py(tr.data[o + 1]))
      g.lineTo(px(tr.data[o + 3]), py(tr.data[o + 4]))
      g.stroke()
    }
    g.globalAlpha = 1
  }, [prepared, model, t])

  if (!meta || !model) return null
  const rows = TREE_KINDS.map((k) => model.trees[k])
  const attractors = rows.reduce((a, r) => a + r.attractors, 0)
  const consumed = rows.reduce((a, r) => a + r.consumed, 0)
  return (
    <figure className="replay" ref={wrap}>
      <div className="replay-tabs" role="group" aria-label="Organ to replay">
        {REPLAY_ORGANS.map((id) => (
          <button key={id} aria-pressed={organ === id} onClick={() => { setOrgan(id); setT(1) }}>
            {ORGANS[id].name}
          </button>
        ))}
      </div>
      <canvas ref={ref} className="replay-canvas" role="img" aria-label={`The vessels grown into the ${ORGANS[organ].name.toLowerCase()}, seen from the front, drawn in the order they grew.`} />
      <figcaption>
        <div className="replay-controls">
          <button className="icon-btn" aria-label={playing ? 'Pause the replay' : 'Replay the growth'} onClick={() => { if (t >= 1) setT(0); setPlaying((p) => !p) }}>
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <input type="range" min={0} max={1000} value={Math.round(t * 1000)} aria-label="Growth progress" onChange={(e) => { setPlaying(false); setT(Number(e.target.value) / 1000) }} />
        </div>
        <p className="note">
          {prepared ? fmt(prepared.count) : 0} segments in this organ, seen from the front. All four trees together scattered {fmt(attractors)} attractors and consumed {fmt(consumed)} of them.
        </p>
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Murray's law: histogram of the atlas junctions and the aortic bifurcation as a worked example.
// ---------------------------------------------------------------------------------------------------------------

export function MurrayFigure() {
  const model = useStore((s) => s.model)
  if (!model) return null
  const m = model.murray
  const max = Math.max(...m.bins)
  const W = 560
  const H = 190
  const bw = W / m.bins.length
  const x1 = (1.0 / 2.5) * W
  return (
    <figure className="murray">
      <svg viewBox={`0 0 ${W} ${H + 46}`} role="img" aria-label={`Histogram of the ratio of summed child radii cubed to parent radius cubed over ${m.junctions} atlas junctions. The median is ${fmt(m.median, 2)}; Murray's law predicts 1.`}>
        {m.bins.map((b, i) => (
          <rect key={i} x={i * bw + 1} y={H - (b / max) * (H - 12)} width={bw - 2} height={(b / max) * (H - 12)} fill="var(--bone-faint)" opacity={0.7} />
        ))}
        <line x1={x1} x2={x1} y1={4} y2={H} stroke="var(--accent)" strokeWidth={1.5} />
        <text x={x1 + 8} y={16} fill="var(--accent)" fontSize={13}>
          Murray: 1.0
        </text>
        <line x1={0} x2={W} y1={H} y2={H} stroke="var(--line)" />
        {[0, 0.5, 1, 1.5, 2, 2.5].map((v) => (
          <text key={v} x={(v / 2.5) * W} y={H + 18} fill="var(--bone-faint)" fontSize={12} textAnchor={v === 0 ? 'start' : v === 2.5 ? 'end' : 'middle'}>
            {v.toFixed(1)}
          </text>
        ))}
        <text x={W / 2} y={H + 38} fill="var(--bone-dim)" fontSize={12.5} textAnchor="middle">
          sum of child radii cubed, divided by parent radius cubed
        </text>
      </svg>
      <figcaption className="note">
        {fmt(m.junctions)} junctions in the atlas where the parent is thicker than 1.5 mm. Median {fmt(m.median, 2)}, middle 80 percent between {fmt(m.p10, 2)} and {fmt(m.p90, 2)}.
        The grown branches are exactly 1.00 by construction, because their radii are computed from the leaves up.
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The pulse: one waveform, delayed by path length.
// ---------------------------------------------------------------------------------------------------------------

export function PulseFigure() {
  const model = useStore((s) => s.model)
  const bpm = useStore((s) => s.bpm)
  if (!model) return null
  const refs = [{ name: 'Aortic root', metres: 0 }, ...model.references.filter((r) => ['Right brachial artery', 'Right radial artery', 'Right femoral artery', 'Right dorsalis pedis artery'].includes(r.name)).map((r) => ({ name: r.name, metres: r.metres }))]
  const W = 600
  const rowH = 46
  const H = rowH * refs.length + 34
  const beats = 2
  const curve = (delay: number) => {
    const pts: string[] = []
    for (let i = 0; i <= 240; i++) {
      const x = (i / 240) * beats
      const y = pulse(x - delay)
      pts.push(`${((x / beats) * W).toFixed(1)},${(rowH - 8 - y * (rowH - 18)).toFixed(1)}`)
    }
    return pts.join(' ')
  }
  const speed = (WAVELENGTH * bpm) / 60
  return (
    <figure className="pulse">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The same pulse waveform drawn for five arteries, each delayed in proportion to its path length from the heart.">
        {refs.map((r, i) => {
          const delay = r.metres / WAVELENGTH
          return (
            <g key={r.name} transform={`translate(0 ${i * rowH})`}>
              <polyline points={curve(delay)} fill="none" stroke={i === 0 ? 'var(--accent)' : 'var(--artery)'} strokeWidth={1.6} strokeLinejoin="round" />
              <line x1={0} x2={W} y1={rowH - 6} y2={rowH - 6} stroke="var(--line-soft)" />
              <text x={4} y={12} fill="var(--bone-dim)" fontSize={12.5}>
                {r.name}
              </text>
              <text x={W - 4} y={12} fill="var(--bone-faint)" fontSize={12.5} textAnchor="end">
                {fmt(r.metres, 2)} m, arrives {fmt(delay, 2)} beats later
              </text>
            </g>
          )
        })}
        <text x={0} y={H - 6} fill="var(--bone-faint)" fontSize={12}>
          0
        </text>
        <text x={W / 2} y={H - 6} fill="var(--bone-faint)" fontSize={12} textAnchor="middle">
          1 beat
        </text>
        <text x={W} y={H - 6} fill="var(--bone-faint)" fontSize={12} textAnchor="end">
          2 beats
        </text>
      </svg>
      <figcaption className="note">
        Path lengths are measured along the grown tree from the aortic root. At {bpm} beats a minute the drawn wave moves at {fmt(speed, 2)} m per second. A real pulse wave is several times faster, so the
        wavelength of {fmt(WAVELENGTH, 2)} m is a design choice that makes the delay visible.
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Measured numbers: a fixed table from the measurement script, plus the visitor's own device.
// ---------------------------------------------------------------------------------------------------------------

export interface Measured {
  machine: string
  gpu: string
  columns: { label: string; viewport: string; fps: number; frameMs: number; drawCalls: number; triangles: number; generationMs: number; gpuMsMedian?: number; gpuMsP95?: number; boot?: string }[]
  bytes: { glb: number; data: number; js: number; worker: number }
}

export function MeasuredTable() {
  const [m, setM] = useState<Measured | null>(null)
  const stats = useStore((s) => s.stats)
  const model = useStore((s) => s.model)
  const meta = useStore((s) => s.meta)
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'anatomy/measured.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setM)
      .catch(() => setM(null))
  }, [])
  const glb = meta ? Object.values(meta.layers).reduce((a, l) => a + l.bytes, 0) : 0
  const data = meta ? meta.volume.bytes + meta.volume.fine.bytes + meta.vessels.bytes : 0
  return (
    <div className="measured">
      <table>
        <thead>
          <tr>
            <th scope="col" />
            {m?.columns.map((c) => (
              <th key={c.label} scope="col">
                {c.label}
                <small>{c.viewport}</small>
              </th>
            ))}
            <th scope="col">
              This device
              <small>live</small>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Frame time</th>
            {m?.columns.map((c) => <td key={c.label}>{fmt(c.frameMs, 1)} ms</td>)}
            <td>{stats.fps > 0 ? fmt(stats.frameMs, 1) + ' ms' : 'n/a'}</td>
          </tr>
          <tr>
            <th scope="row">Frame rate</th>
            {m?.columns.map((c) => <td key={c.label}>{fmt(c.fps)} fps</td>)}
            <td>{stats.fps > 0 ? fmt(stats.fps) + ' fps' : 'n/a'}</td>
          </tr>
          <tr>
            <th scope="row">GPU time per frame, 95th percentile</th>
            {m?.columns.map((c) => <td key={c.label}>{c.gpuMsMedian != null ? (
              <>
                {fmt(c.gpuMsP95 ?? 0, 1)} ms<small>median {fmt(c.gpuMsMedian, 1)} ms</small>
              </>
            ) : (
              'n/a'
            )}</td>)}
            <td>n/a</td>
          </tr>
          <tr>
            <th scope="row">Draw calls</th>
            {m?.columns.map((c) => <td key={c.label}>{fmt(c.drawCalls)}</td>)}
            <td>{stats.drawCalls > 0 ? fmt(stats.drawCalls) : 'n/a'}</td>
          </tr>
          <tr>
            <th scope="row">Triangles per frame</th>
            {m?.columns.map((c) => <td key={c.label}>{fmt(c.triangles / 1e6, 2)} M</td>)}
            <td>{stats.triangles > 0 ? fmt(stats.triangles / 1e6, 2) + ' M' : 'n/a'}</td>
          </tr>
          <tr>
            <th scope="row">Vessel generation</th>
            {m?.columns.map((c) => <td key={c.label}>{fmt(c.generationMs / 1000, 2)} s</td>)}
            <td>{model ? fmt(model.timings.generateMs / 1000, 2) + ' s' : 'n/a'}</td>
          </tr>
        </tbody>
      </table>
      <p className="note">
        {m ? `Measured on ${m.machine}, ${m.gpu}, real GPU in headless Chromium, vsync on, production build. ` : ''}
        Downloads: {fmt(glb / 1e6, 2)} MB of meshes in three files, {fmt(data / 1e3)} KB of volume and vessel data{m ? `, ${fmt(m.bytes.js / 1e3)} KB of script (gzip) and ${fmt(m.bytes.worker / 1e3, 1)} KB for the generation worker` : ''}.
        {m ? ' The phone column is a 360 pixel touch viewport on the light tier with a 4x CPU slowdown on a desktop GPU; real phone GPUs were not measured.' : ''}
      </p>
    </div>
  )
}

