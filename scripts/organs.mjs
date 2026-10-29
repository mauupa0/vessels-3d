// Select a list of parts one by one and screenshot each. usage: node scripts/organs.mjs <url> <outPrefix> <w> <h> <ids comma> [dpr]
import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const [url, prefix, w = '1440', h = '900', ids = 'brain,heart,right-kidney,small-intestine', dpr = '1'] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr, hasTouch: !!process.env.TOUCH, isMobile: !!process.env.TOUCH })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(() => window.__vessels && window.__vessels.stats && window.__vessels.stats.fps > 0, null, { timeout: 120000 })
await page.waitForTimeout(2500)
await page.evaluate(() => window.__vessels.store.set({ growth: 1, growing: false }))
for (const id of ids.split(',')) {
  await page.evaluate((id) => {
    const v = window.__vessels
    const p = v.partsById.get(id)
    v.store.set((s) => ({ selected: { layer: p.layer, index: p.index }, layers: { ...s.layers, [p.layer]: true } }))
  }, id)
  await page.waitForTimeout(2600)
  await page.screenshot({ path: `${prefix}-${id}.png` })
}
await browser.close()
