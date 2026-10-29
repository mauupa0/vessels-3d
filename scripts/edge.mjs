// Crop of the skin silhouette at 3x to judge aliasing. usage: node scripts/edge.mjs <url> <out.png> [query] [deviceScaleFactor]
import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const [url, out, query = '', dpr = '1'] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(dpr) })).newPage()
await page.goto(url + query, { waitUntil: 'load' })
await page.waitForFunction(() => window.__vessels?.store?.get().model && window.__vessels.stats?.fps > 0, null, { timeout: 120000 })
await page.waitForFunction(() => { const s = window.__vessels.store.get(); return !s.intro && !s.growing }, null, { timeout: 60000 })
await page.evaluate(() => { window.__vessels.store.set({ paused: true }); window.__vessels.view(0, 88, 3.4) })
await page.waitForTimeout(2500)
await page.screenshot({ path: out, clip: { x: 760, y: 120, width: 300, height: 220 } })
await browser.close()
