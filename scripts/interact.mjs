// Behaviour checks in a real browser (real GPU). usage: node scripts/interact.mjs [baseUrl]
import { createRequire } from 'node:module'
const require = createRequire(process.env.GLOBAL_NODE_MODULES ? process.env.GLOBAL_NODE_MODULES + '/' : import.meta.url)
const { chromium } = require('playwright')
const base = process.argv[2] ?? 'http://127.0.0.1:4173/'
const args = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist']
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''))
}

async function open(viewport, opts = {}) {
  const browser = await chromium.launch({ headless: true, args })
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr ?? 1, hasTouch: !!opts.touch, isMobile: !!opts.touch, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await page.goto(base + (opts.query ?? ''), { waitUntil: 'load' })
  await page.waitForFunction(() => window.__vessels?.store?.get().model && window.__vessels.stats?.fps > 0, null, { timeout: 180000 })
  return { browser, page, errors }
}
const state = (page, expr) => page.evaluate(`(() => { const s = window.__vessels.store.get(); return ${expr} })()`)
const settle = async (page) => { await page.waitForFunction(() => { const s = window.__vessels.store.get(); return !s.intro && !s.growing }, null, { timeout: 60000 }); await page.waitForTimeout(600) }

// ---------------------------------------------------------------- desktop
{
  const { browser, page, errors } = await open({ width: 1440, height: 900 })
  await settle(page)
  const bufW = await page.evaluate(() => document.querySelector('canvas').width)
  check('the desktop frame is rendered 1.5x larger than the window (supersampling)', bufW === 2160, 'canvas width ' + bufW)

  // layers
  check('skeleton is off at first', (await state(page, 's.layers.skeleton')) === false)
  await page.getByRole('button', { name: /^Skeleton/ }).click()
  check('layer button turns the skeleton on', (await state(page, 's.layers.skeleton')) === true)
  await page.waitForTimeout(900)
  const bones = await page.evaluate(() => { const v = window.__vessels; let hit = 0; for (let x = 480; x < 1280; x += 20) for (let y = 120; y < 760; y += 20) { const p = v.pickAt(x, y); if (p && p.layer === 'skeleton') hit++ } return hit })
  check('skeleton parts can be picked once it is on', bones > 40, 'hits ' + bones)
  await page.getByRole('button', { name: /^Skeleton/ }).click()
  await page.waitForTimeout(300)
  const bonesOff = await page.evaluate(() => { const v = window.__vessels; let hit = 0; for (let x = 480; x < 1280; x += 20) for (let y = 120; y < 760; y += 20) { const p = v.pickAt(x, y); if (p && p.layer === 'skeleton') hit++ } return hit })
  check('a hidden layer cannot be picked', bonesOff === 0, 'hits ' + bonesOff)

  // organ list -> fly and card
  await page.locator('.organ', { hasText: 'Liver' }).click()
  await page.waitForTimeout(2800)
  check('organ list selects the liver', (await state(page, 's.selected && s.selected.layer')) === 'organs')
  check('the card shows the title', (await page.locator('.card h2').innerText()) === 'Liver')
  const target = await page.evaluate(() => { const c = window.__vessels.controls(); const t = c.getTarget({ x: 0, y: 0, z: 0, set(a, b, c2) { this.x = a; this.y = b; this.z = c2; return this } }); return [t.x, t.y, t.z] })
  check('the camera flew to the liver', Math.abs(target[0] + 0.02) < 0.12 && target[1] > 1.1 && target[1] < 1.3, JSON.stringify(target.map((v) => +v.toFixed(2))))
  await page.keyboard.press('Escape')
  await page.locator('.organ', { hasText: 'Large intestine' }).click()
  await page.waitForTimeout(3000)
  const li = await page.evaluate(() => { const v = window.__vessels; const p = v.partsById.get('large-intestine'); const c = v.controls().getTarget({ x: 0, y: 0, z: 0, set(a, b, d) { this.x = a; this.y = b; this.z = d; return this } }); return Math.hypot(c.x - p.anchor[0], c.y - p.anchor[1], c.z - p.anchor[2]) })
  check('the camera aims at the anchor inside a bent organ, not at its empty box centre', li < 0.02, li.toFixed(3) + ' m')
  await page.keyboard.press('Escape')
  await page.locator('.organ', { hasText: 'Liver' }).click()
  await page.waitForTimeout(2800)
  check('the card reports grown branches', /Grown branches/.test(await page.locator('.card').innerText()))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check('Escape closes the card', (await page.locator('.card').count()) === 0 && (await state(page, 's.selected')) === null)

  // click picking on the canvas
  await page.evaluate(() => window.__vessels.home())
  await page.waitForTimeout(2200)
  const spot = await page.evaluate(() => { const v = window.__vessels; for (let x = 520; x < 1250; x += 8) for (let y = 160; y < 760; y += 8) { const p = v.pickAt(x, y); if (p && p.layer === 'organs') return { x, y, p } } return null })
  check('there is an organ to click on', !!spot)
  if (spot) {
    await page.mouse.move(spot.x, spot.y)
    await page.waitForTimeout(400)
    check('hover reports the organ under the pointer', (await state(page, 's.hover && s.hover.layer')) === 'organs')
    check('the tooltip is visible while hovering', (await page.locator('.tip').evaluate((e) => getComputedStyle(e).opacity)) === '1')
    await page.mouse.click(spot.x, spot.y)
    await page.waitForTimeout(600)
    check('a click selects it', (await state(page, 's.selected && s.selected.layer')) === 'organs')
    await page.keyboard.press('Escape')
  }

  // drag must not select
  await page.evaluate(() => window.__vessels.home())
  await page.waitForTimeout(1800)
  await page.mouse.move(800, 400)
  await page.mouse.down()
  await page.mouse.move(900, 420, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  check('dragging orbits and does not select', (await state(page, 's.selected')) === null)

  // heart rate and pause
  await page.locator('#bpm').fill('120')
  check('the heart rate slider updates the model', (await state(page, 's.bpm')) === 120)
  const f0 = await page.evaluate(() => window.__vessels.renderFrames())
  await page.waitForTimeout(700)
  const f1 = await page.evaluate(() => window.__vessels.renderFrames())
  check('the scene renders while the heart beats', f1 - f0 > 20, 'frames ' + (f1 - f0))
  await page.getByRole('button', { name: /Pause the heartbeat/ }).click()
  await page.waitForTimeout(1500)
  const p0 = await page.evaluate(() => window.__vessels.renderFrames())
  await page.waitForTimeout(2500)
  const p1 = await page.evaluate(() => window.__vessels.renderFrames())
  check('zero frames are rendered while paused', p1 - p0 === 0, 'frames ' + (p1 - p0))
  await page.getByRole('button', { name: /Resume the heartbeat/ }).click()

  // section
  await page.getByRole('button', { name: /Cut the body open/ }).click()
  await page.waitForTimeout(400)
  check('the cut turns on', (await state(page, 's.section.on')) === true)
  await page.locator('input[aria-label="Cut position"]').fill('300')
  check('the cut slider moves the plane', (await state(page, 's.section.t')) === 0.3)
  await page.getByRole('button', { name: /^Front/ }).click()
  check('the cut direction changes', (await state(page, 's.section.axis')) === 'z')
  await page.getByRole('button', { name: /Cut the body open/ }).click()
  check('the cut turns off', (await state(page, 's.section.on')) === false)

  // new seed
  const seed0 = await state(page, 's.seed')
  await page.getByRole('button', { name: /Grow new vessels/ }).click()
  await page.waitForFunction((s0) => window.__vessels.store.get().seed !== s0 && window.__vessels.store.get().genProgress === null, seed0, { timeout: 60000 })
  check('a new seed regrows the vessels', (await state(page, 's.seed')) === seed0 + 1)

  // keyboard focus
  await page.keyboard.press('Tab')
  const focus = await page.evaluate(() => { const e = document.activeElement; return e ? getComputedStyle(e).outlineStyle + ' ' + e.tagName : '' })
  check('keyboard focus lands on a control with a visible outline', /solid/.test(focus), focus)

  // the page below
  await page.evaluate(() => document.querySelector('#how').scrollIntoView())
  await page.waitForTimeout(900)
  check('the stage stops rendering when scrolled away', (await state(page, 's.stageVisible')) === false)
  const q0 = await page.evaluate(() => window.__vessels.renderFrames())
  await page.waitForTimeout(1500)
  const q1 = await page.evaluate(() => window.__vessels.renderFrames())
  check('no frames behind the page', q1 - q0 === 0, 'frames ' + (q1 - q0))
  check('the slice viewer has a canvas', (await page.locator('.slice canvas').count()) === 1)
  check('there is no horizontal scroll', (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) === true)
  check('no console errors on desktop', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

// ---------------------------------------------------------------- reduced motion
{
  const { browser, page, errors } = await open({ width: 1440, height: 900 }, { reduced: true })
  check('reduced motion skips the opening scan and growth', (await state(page, 's.growth === 1 && !s.intro && !s.growing && !s.section.on')) === true)
  const a0 = await page.evaluate(() => window.__vessels.controls().azimuthAngle)
  await page.waitForTimeout(4500)
  const a1 = await page.evaluate(() => window.__vessels.controls().azimuthAngle)
  check('reduced motion does not spin the camera', Math.abs(a1 - a0) < 0.01, a0.toFixed(3) + ' -> ' + a1.toFixed(3))
  check('no console errors with reduced motion', errors.length === 0, errors.slice(0, 2).join(' | '))
  await browser.close()
}

// ---------------------------------------------------------------- phone
{
  const { browser, page, errors } = await open({ width: 360, height: 740 }, { dpr: 2, touch: true, query: '?quality=light' })
  await settle(page)
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }))
  // innerWidth is no yardstick on a mobile viewport: the layout viewport widens to the content, so it always equals scrollWidth. Compare with the 360 that was asked for.
  check('no horizontal overflow at 360 px', overflow.sw <= 360, JSON.stringify(overflow))
  check('the light tier is used on the phone profile', (await state(page, 's.tier')) === 'light')
  await page.touchscreen.tap(180, 330)
  await page.waitForTimeout(1500)
  const picked = await state(page, 's.selected')
  check('a tap selects something', !!picked, JSON.stringify(picked))
  if (picked) {
    const box = await page.locator('.card').boundingBox()
    check('the card stays inside the screen and under 46 percent of the height', !!box && box.x >= 0 && box.x + box.width <= 361 && box.y >= 0 && box.height <= 740 * 0.46, JSON.stringify(box))
    await page.getByRole('button', { name: /Close the details/ }).tap()
    await page.waitForTimeout(500)
    check('the close button works on touch', (await state(page, 's.selected')) === null)
  }
  const dockBox = await page.locator('.dock').boundingBox()
  check('the dock fits the screen', !!dockBox && dockBox.x >= 0 && dockBox.x + dockBox.width <= 361, JSON.stringify(dockBox))
  const small = await page.evaluate(() => [...document.querySelectorAll('button, a, input[type=range]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40) && getComputedStyle(e).display !== 'none' && r.top < innerHeight }).map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)))
  check('touch targets on the first screen are at least 40 px', small.length === 0, small.join(', '))
  const mt = await page.evaluate(() => { const m = document.querySelector('.measured'); const ths = [...m.querySelectorAll('thead th')].filter((t) => t.firstChild).map((t) => { const r = document.createRange(); r.selectNodeContents(t.firstChild); return r.getClientRects().length }); return { sw: m.scrollWidth, cw: m.clientWidth, headerLines: ths } })
  check('the measured table fits at 360 px without scrolling and each header name is on one line', mt.sw <= mt.cw && mt.headerLines.every((n) => n === 1), JSON.stringify(mt))
  const replay = page.getByRole('button', { name: /Replay the vessel growth/ })
  const rb = await replay.boundingBox()
  check('the growth replay button is on the phone dock, at least 40 px', !!rb && rb.width >= 40 && rb.height >= 40 && rb.x + rb.width <= 361, JSON.stringify(rb))
  const slider = await page.locator('#bpm').boundingBox()
  check('the heart rate slider is at least 100 px wide on the phone', !!slider && slider.width >= 100, JSON.stringify(slider))
  await replay.tap()
  await page.waitForTimeout(400)
  check('tapping replay restarts the growth', (await state(page, 's.growing')) === true)
  check('no console errors on the phone', errors.length === 0, errors.slice(0, 2).join(' | '))
  await browser.close()
}

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
