// close look at a few grown trunk segments. usage: node scripts/trunk-zoom.mjs <baseUrl> <out.png> [tx ty tz] [dist]
import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const [base, out, tx = '-0.006', ty = '1.241', tz = '0.021', dist = '0.06'] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 })).newPage()
await page.goto(base, { waitUntil: 'load' })
await page.waitForFunction(() => window.__vessels?.store?.get().model && window.__vessels.stats?.fps > 0, null, { timeout: 180000 })
await page.waitForFunction(() => { const s = window.__vessels.store.get(); return !s.intro && !s.growing }, null, { timeout: 60000 })
await page.waitForTimeout(800)
await page.evaluate(([tx, ty, tz, d]) => {
  const v = window.__vessels
  v.store.set((s) => ({ layers: { ...s.layers, organs: false, skin: false } }))
  v.controls().setLookAt(+tx, +ty, +tz + +d, +tx, +ty, +tz, false)
}, [tx, ty, tz, dist])
await page.waitForTimeout(1500)
await page.screenshot({ path: out })
await browser.close()
