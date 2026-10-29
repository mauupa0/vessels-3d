// One screenshot with the real GPU. usage: node scripts/snap.mjs <url> <out.png> [width] [height] [dpr] [settleMs]
// env: EVAL = js run in the page before the shot (e.g. select an organ), TOUCH=1, FULL=1 for a full-page shot
import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')

const [url, out, w = '1440', h = '900', dpr = '1', settle = '3500'] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr, hasTouch: !!process.env.TOUCH, isMobile: !!process.env.TOUCH })
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text())
})
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
const t0 = Date.now()
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(() => window.__vessels && window.__vessels.stats && window.__vessels.stats.fps > 0, null, { timeout: 120000 }).catch(() => logs.push('timeout waiting for the scene'))
console.log('ready in', Date.now() - t0, 'ms')
await page.waitForTimeout(+settle)
if (process.env.EVAL) {
  const r = await page.evaluate(process.env.EVAL)
  if (r !== undefined) console.log('eval ->', JSON.stringify(r))
  await page.waitForTimeout(+(process.env.AFTER ?? 1800))
}
await page.screenshot({ path: out, fullPage: !!process.env.FULL })
const stats = await page.evaluate(() => window.__vessels?.stats)
console.log('stats', JSON.stringify(stats))
if (logs.length) console.log(logs.slice(0, 12).join('\n'))
await browser.close()
