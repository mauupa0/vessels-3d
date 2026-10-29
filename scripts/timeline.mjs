// Screenshots at fixed times after the first frame. usage: node scripts/timeline.mjs <url> <outPrefix> <w> <h> <ms,ms,...>
import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const [url, prefix, w = '1440', h = '900', times = '800,2000,4000,9000'] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: +w, height: +h } })).newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(() => window.__vessels && window.__vessels.store && window.__vessels.store.get().model, null, { timeout: 120000 })
const t0 = Date.now()
for (const t of times.split(',').map(Number)) {
  const wait = t - (Date.now() - t0)
  if (wait > 0) await page.waitForTimeout(wait)
  await page.screenshot({ path: `${prefix}-${t}.png` })
}
await browser.close()
