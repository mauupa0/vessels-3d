// Selecting through the list must leave the organ see-through. usage: node scripts/click-test.mjs <baseUrl> <outDir>
import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const out = process.argv[3] ?? 'shots/after'
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(base, { waitUntil: 'load' })
await page.waitForFunction(() => window.__vessels?.store?.get().model && window.__vessels.stats?.fps > 0, null, { timeout: 180000 })
await page.waitForFunction(() => { const s = window.__vessels.store.get(); return !s.intro && !s.growing }, null, { timeout: 60000 })
await page.waitForTimeout(1200)
await page.locator('.organ', { hasText: 'Liver' }).click()
for (const ms of [1500, 3000, 6000]) {
  await page.waitForTimeout(ms === 1500 ? 1500 : ms / 2)
  await page.screenshot({ path: out + `/click-${ms}.png`, clip: { x: 380, y: 150, width: 640, height: 520 } })
}
console.log(JSON.stringify(await page.evaluate(() => { const s = window.__vessels.store.get(); return { sel: s.selected, hover: s.hover } })))
await browser.close()
