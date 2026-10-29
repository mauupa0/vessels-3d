// Collision check on the bounding boxes of every control, at several viewport sizes. Goal: 0 overlaps.
// usage: node scripts/overlap.mjs [baseUrl]
import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const sizes = [
  { w: 320, h: 640, touch: true }, { w: 360, h: 740, touch: true }, { w: 390, h: 844, touch: true },
  { w: 1024, h: 700 }, { w: 1280, h: 720 }, { w: 1440, h: 900 },
]
let total = 0
for (const sz of sizes) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: sz.touch ? 2 : 1, hasTouch: !!sz.touch, isMobile: !!sz.touch })
  const page = await ctx.newPage()
  await page.goto(base + (sz.touch ? '?quality=light' : ''), { waitUntil: 'load' })
  await page.waitForFunction(() => window.__vessels?.store?.get().model && window.__vessels.stats?.fps > 0, null, { timeout: 120000 })
  await page.waitForFunction(() => { const s = window.__vessels.store.get(); return !s.intro && !s.growing }, null, { timeout: 60000 })
  // negative control: --break pushes the dock up over the layer chips, the check has to go red
  if (process.argv.includes('--break')) await page.addStyleTag({ content: '.dock { transform: translateY(-' + (sz.touch ? 70 : Math.round(sz.h * 0.55)) + 'px) !important }' })
  for (const state of ['idle', 'card']) {
    if (state === 'card') {
      await page.evaluate(() => { const v = window.__vessels; const p = v.partsById.get('heart'); v.store.set({ selected: { layer: 'organs', index: p.index } }) })
      await page.waitForTimeout(900)
    }
    const res = await page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' }
      const clip = (r, c) => { const x1 = Math.max(r.left, c.left), y1 = Math.max(r.top, c.top), x2 = Math.min(r.right, c.right), y2 = Math.min(r.bottom, c.bottom); return x2 > x1 && y2 > y1 ? { left: x1, top: y1, right: x2, bottom: y2 } : null }
      const items = []
      const add = (group, e, clipTo) => { if (!vis(e)) return; let r = e.getBoundingClientRect(); if (clipTo) r = clip(r, clipTo.getBoundingClientRect()); if (!r) return; items.push({ group, name: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 22), l: r.left, t: r.top, r: r.right, b: r.bottom }) }
      document.querySelectorAll('.brand h1, .brand p').forEach((e) => add('brand', e))
      document.querySelectorAll('.topnav a').forEach((e) => add('nav', e))
      const layers = document.querySelector('.layers')
      document.querySelectorAll('.layer').forEach((e) => add('chips', e, layers))
      const organs = document.querySelector('.organs')
      if (organs && vis(organs)) document.querySelectorAll('.organ').forEach((e) => add('organs', e, organs))
      document.querySelectorAll('.dock').forEach((e) => add('dock', e))
      document.querySelectorAll('.card').forEach((e) => add('card', e))
      document.querySelectorAll('.hint').forEach((e) => add('hint', e))
      const out = []
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j]
        if (a.group === b.group) continue
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
        if (w > 0.5 && h > 0.5) out.push(`${a.group}:${a.name} x ${b.group}:${b.name} (${Math.round(w)}x${Math.round(h)})`)
      }
      // controls must also stay inside the viewport
      for (const it of items) if (it.l < -0.5 || it.t < -0.5 || it.r > innerWidth + 0.5 || it.b > innerHeight + 0.5) out.push(`${it.group}:${it.name} leaves the viewport`)
      return { out, n: items.length }
    })
    total += res.out.length
    console.log(`${String(sz.w).padStart(4)} x ${String(sz.h).padEnd(3)} ${state.padEnd(5)} controls ${String(res.n).padStart(2)}  overlaps ${res.out.length}${res.out.length ? '\n   ' + res.out.slice(0, 6).join('\n   ') : ''}`)
  }
  await ctx.close()
}
await browser.close()
console.log('\ntotal overlaps:', total)
process.exit(total === 0 ? 0 : 1)
