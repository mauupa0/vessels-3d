import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
for (const extra of [[], ['--enable-features=WebGLDrawingBufferStorage', '--enable-webgl-developer-extensions', '--enable-webgl-draft-extensions']]) {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', ...extra] })
  const page = await browser.newPage()
  console.log(extra.length ? 'dev flags' : 'default', await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); return [!!g.getExtension('EXT_disjoint_timer_query_webgl2'), !!g.getExtension('EXT_disjoint_timer_query')] }))
  await browser.close()
}
