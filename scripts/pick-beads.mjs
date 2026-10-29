import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const base = process.argv[2]
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(base, { waitUntil: 'load' })
await page.waitForFunction(() => window.__vessels?.store?.get().model && window.__vessels.stats?.fps > 0, null, { timeout: 180000 })
await page.waitForFunction(() => { const s = window.__vessels.store.get(); return !s.intro && !s.growing }, null, { timeout: 60000 })
await page.waitForTimeout(1000)
await page.locator('.organ', { hasText: 'Liver' }).click()
await page.waitForTimeout(4000)
const hits = await page.evaluate(() => {
  const v = window.__vessels
  const out = []
  for (let k = 0; k <= 40; k++) {
    const x0 = 745 - (210 * k) / 40, y0 = 262 + (323 * k) / 40
    const seen = new Map()
    for (let dx = -12; dx <= 12; dx += 2) for (let dy = -12; dy <= 12; dy += 2) {
      const p = v.pickAt(Math.round(x0 + dx), Math.round(y0 + dy))
      if (p && p.layer !== 'organs' && p.layer !== 'skin') seen.set(p.layer + ':' + p.index, 1)
    }
    out.push([Math.round(x0), Math.round(y0), [...seen.keys()].join(' ')])
  }
  return out
})
;(await import('node:fs')).writeFileSync((process.env.VESSELS_DATA || '.') + '/hits.json', JSON.stringify(hits))
await browser.close()
