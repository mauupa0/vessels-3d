// Final screenshots with the real GPU. usage: node scripts/final-shots.mjs <baseUrl> <outDir>
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const out = process.argv[3] ?? 'shots/after'
mkdirSync(out, { recursive: true })
const args = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist']

async function open(viewport, touch) {
  const browser = await chromium.launch({ headless: true, args })
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch })
  const page = await ctx.newPage()
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__vessels?.store?.get().model && window.__vessels.stats?.fps > 0, null, { timeout: 180000 })
  await page.waitForFunction(() => { const s = window.__vessels.store.get(); return !s.intro && !s.growing }, null, { timeout: 60000 })
  await page.waitForTimeout(1200)
  return { browser, page }
}

{
  const { browser, page } = await open({ width: 1440, height: 900 }, false)
  await page.screenshot({ path: out + '/1-live-desktop.png' })
  await page.locator('.organ', { hasText: 'Liver' }).click()
  await page.waitForTimeout(3200)
  await page.screenshot({ path: out + '/2-liver.png' })
  await page.keyboard.press('Escape')
  await page.locator('.organ', { hasText: 'Heart' }).first().click()
  await page.waitForTimeout(3200)
  await page.screenshot({ path: out + '/3-heart.png' })
  await browser.close()
}
for (const w of [360, 320]) {
  const { browser, page } = await open({ width: w, height: w === 360 ? 740 : 640 }, true)
  await page.screenshot({ path: out + `/6-live-${w}.png` })
  await browser.close()
}
console.log('done')
