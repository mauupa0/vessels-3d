// Performance numbers for the README and the page. Needs a production build served by `pnpm preview` (default http://127.0.0.1:4173/).
// usage: node scripts/perf.mjs [baseUrl] [--write]   (--write stores public/anatomy/measured.json)
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:4173/'
const write = process.argv.includes('--write')
const args = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist']

async function session(label, viewport, opts) {
  const browser = await chromium.launch({ headless: true, args })
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr, hasTouch: !!opts.touch, isMobile: !!opts.touch })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // time spent inside requestAnimationFrame callbacks (the whole render loop: JS, React Three Fiber, WebGL command submission)
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__rafMs = 0
    window.__rafCalls = 0
    // GPU time of the whole frame with a timer query around every rAF callback (EXT_disjoint_timer_query_webgl2)
    const orig = HTMLCanvasElement.prototype.getContext
    window.__gpu = []
    const pending = []
    HTMLCanvasElement.prototype.getContext = function (type, ...a) {
      const c = orig.call(this, type, ...a)
      if (type === 'webgl2' && c && !window.__gl && this.id !== 'probe') { window.__gl = c; window.__ext = c.getExtension('EXT_disjoint_timer_query_webgl2') }
      return c
    }
    window.requestAnimationFrame = (cb) => raf((t) => {
      const gl = window.__gl
      const ext = window.__ext
      if (gl && ext) {
        while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
          const q = pending.shift()
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) window.__gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6)
        }
      }
      let q = null
      if (gl && ext && pending.length < 6) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q) }
      const a = performance.now()
      try { cb(t) } finally {
        window.__rafMs += performance.now() - a
        window.__rafCalls++
        if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q) }
      }
    })
  })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (opts.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle })
  const t0 = Date.now()
  await page.goto(base + (opts.query ?? ''), { waitUntil: 'load' })
  await page.waitForFunction(() => window.__vessels?.store?.get().model && window.__vessels.stats?.fps > 0, null, { timeout: 180000 })
  const readyMs = Date.now() - t0
  // let the opening scan and the growth replay finish
  await page.waitForFunction(() => { const s = window.__vessels.store.get(); return !s.intro && !s.growing }, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  const gpu = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a' })
  const m0 = (await cdp.send('Performance.getMetrics')).metrics
  const f0 = await page.evaluate(() => window.__vessels.renderFrames())
  await page.evaluate(() => { window.__gpu.length = 0 })
  const r0 = await page.evaluate(() => ({ ms: window.__rafMs, n: window.__rafCalls }))
  await page.waitForTimeout(6000)
  const r1 = await page.evaluate(() => ({ ms: window.__rafMs, n: window.__rafCalls }))
  const gpuMs = await page.evaluate(() => window.__gpu.slice())
  const m1 = (await cdp.send('Performance.getMetrics')).metrics
  const f1 = await page.evaluate(() => window.__vessels.renderFrames())
  const get = (ms, n) => ms.find((x) => x.name === n).value
  const frames = f1 - f0
  const taskMs = ((get(m1, 'TaskDuration') - get(m0, 'TaskDuration')) * 1000) / Math.max(1, frames)
  const scriptMs = ((get(m1, 'ScriptDuration') - get(m0, 'ScriptDuration')) * 1000) / Math.max(1, frames)
  const res = await page.evaluate(() => { const v = window.__vessels; const s = v.store.get(); return { stats: v.stats, tier: s.tier, gen: s.model.timings, segments: Object.values(s.model.trees).reduce((a, t) => a + t.segments, 0) } })
  // idle: pause the heartbeat and count frames
  await page.evaluate(() => window.__vessels.store.set({ paused: true }))
  await page.waitForTimeout(1200)
  const i0 = await page.evaluate(() => window.__vessels.renderFrames())
  await page.waitForTimeout(3000)
  const i1 = await page.evaluate(() => window.__vessels.renderFrames())
  await browser.close()
  return {
    label,
    viewport: `${viewport.width} x ${viewport.height}${opts.dpr > 1 ? ' @' + opts.dpr + 'x' : ''}${opts.throttle ? ', CPU ' + opts.throttle + 'x slower' : ''}`,
    tier: res.tier,
    gpu,
    fps: +res.stats.fps.toFixed(1),
    frameMs: +res.stats.frameMs.toFixed(2),
    drawCalls: res.stats.drawCalls,
    triangles: res.stats.triangles,
    pixelRatio: res.stats.pixelRatio,
    gpuMsMedian: +(gpuMs.sort((a, b) => a - b)[Math.floor(gpuMs.length / 2)] ?? 0).toFixed(2),
    gpuMsP95: +(gpuMs[Math.floor(gpuMs.length * 0.95)] ?? 0).toFixed(2),
    gpuSamples: gpuMs.length,
    renderLoopMsPerFrame: +((r1.ms - r0.ms) / Math.max(1, r1.n - r0.n)).toFixed(2),
    mainThreadMsPerFrame: +taskMs.toFixed(2),
    scriptMsPerFrame: +scriptMs.toFixed(2),
    framesIdlePaused: i1 - i0,
    generationMs: Math.round(res.gen.generateMs),
    workerTotalMs: Math.round(res.gen.totalMs),
    segments: res.segments,
    readyMs,
    errors,
  }
}

const gz = (f) => zlib.gzipSync(fs.readFileSync(f)).length
const assets = path.join(root, 'dist', 'assets')
const js = fs.readdirSync(assets).filter((f) => f.endsWith('.js'))
const bytes = {
  js: js.filter((f) => !f.startsWith('generate.worker')).reduce((a, f) => a + gz(path.join(assets, f)), 0),
  worker: js.filter((f) => f.startsWith('generate.worker')).reduce((a, f) => a + gz(path.join(assets, f)), 0),
  css: fs.readdirSync(assets).filter((f) => f.endsWith('.css')).reduce((a, f) => a + gz(path.join(assets, f)), 0),
  glb: 0,
  data: 0,
}
const meta = JSON.parse(fs.readFileSync(path.join(root, 'public/anatomy/anatomy.json'), 'utf8'))
bytes.glb = Object.values(meta.layers).reduce((a, l) => a + l.bytes, 0)
bytes.data = meta.volume.bytes + meta.volume.fine.bytes + meta.vessels.bytes

// the GPU clock drifts with load, so one session is not a measurement: three runs, the one with the middle 95th percentile is reported
async function middleOfThree(...args) {
  const runs = []
  for (let i = 0; i < 3; i++) runs.push(await session(...args))
  runs.sort((a, b) => a.gpuMsP95 - b.gpuMsP95)
  return { ...runs[1], gpuMsP95Runs: runs.map((r) => r.gpuMsP95), gpuMsMedianRuns: runs.map((r) => r.gpuMsMedian) }
}

const columns = []
columns.push(await middleOfThree('Desktop', { width: 1440, height: 900 }, { dpr: 1, query: '?quality=full' }))
columns.push(await middleOfThree('Phone', { width: 360, height: 740 }, { dpr: 2, touch: true, throttle: 4, query: '?quality=light' }))
const cpu = (await import('node:os')).cpus()[0].model.trim()
const out = { machine: cpu, gpu: columns[0].gpu, measuredWith: 'headless Chromium, real GPU through ANGLE d3d11, vsync on, production build', columns, bytes }
console.log(JSON.stringify(out, null, 1))
if (write) {
  const slim = { ...out, columns: columns.map(({ label, viewport, fps, frameMs, drawCalls, triangles, generationMs, renderLoopMsPerFrame, gpuMsMedian, gpuMsP95, gpuMsP95Runs }) => ({ label, viewport, fps, frameMs, drawCalls, triangles, generationMs, renderLoopMsPerFrame, gpuMsMedian, gpuMsP95, gpuMsP95Runs })) }
  fs.writeFileSync(path.join(root, 'public/anatomy/measured.json'), JSON.stringify(slim, null, 1))
  fs.writeFileSync(path.join(root, 'scripts/perf-report.json'), JSON.stringify(out, null, 1))
}
