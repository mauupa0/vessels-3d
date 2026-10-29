import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { describePick } from './describe'
import { groinProtrusion, loadMeta, readGlb } from './testAssets'

const dir = path.resolve(__dirname, '../../public/anatomy')
const meta = loadMeta()

describe('shipped assets', () => {
  it('has the three layers as real GLB files that match the metadata byte for byte', () => {
    let total = 0
    for (const [name, layer] of Object.entries(meta.layers)) {
      const buf = fs.readFileSync(path.join(dir, layer.file))
      expect(buf.subarray(0, 4).toString('ascii'), name).toBe('glTF')
      expect(buf.length, name).toBe(layer.bytes)
      total += buf.length
    }
    expect(total).toBeLessThan(4 * 1024 * 1024)
  })

  it('numbers the parts of each layer 0..n-1 without gaps', () => {
    for (const layer of ['skin', 'skeleton', 'organs'] as const) {
      const parts = meta.parts.filter((p) => p.layer === layer).sort((a, b) => a.index - b.index)
      expect(parts.length).toBe(meta.layers[layer].parts)
      parts.forEach((p, i) => expect(p.index).toBe(i))
    }
  })

  it('stores a part id per vertex that stays inside the declared range', async () => {
    for (const layer of ['skeleton', 'organs'] as const) {
      const g = await readGlb(layer + '.glb')
      expect(g.part).not.toBeNull()
      let max = 0
      for (const v of g.part!) if (v > max) max = v
      expect(max).toBe(meta.layers[layer].parts - 1)
      expect(g.positions.length / 3).toBe(meta.layers[layer].vertices)
    }
  })

  it('puts the body in scene metres: feet near 0, head near 1.7, left side positive x', async () => {
    const g = await readGlb('skin.glb')
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 1; i < g.positions.length; i += 3) {
      minY = Math.min(minY, g.positions[i])
      maxY = Math.max(maxY, g.positions[i])
    }
    expect(minY).toBeGreaterThan(-0.05)
    expect(minY).toBeLessThan(0.05)
    expect(maxY).toBeGreaterThan(1.62)
    expect(maxY).toBeLessThan(1.8)
    const heart = meta.parts.find((p) => p.id === 'heart')!
    expect(heart.center[0]).toBeGreaterThan(0)
  })

  it('keeps the groin of the skin smooth', async () => {
    const skin = await readGlb('skin.glb')
    expect(groinProtrusion(skin.positions)).toBeLessThan(0.095)
  })

  it('detects a protrusion when there is one (control for the check above)', () => {
    const bump = new Float32Array([0, 0.78, 0.108, 0.01, 0.8, 0.05])
    expect(groinProtrusion(bump)).toBeGreaterThan(0.095)
  })

  it('declares the licence and the sources next to the data', () => {
    const text = fs.readFileSync(path.join(dir, 'ATTRIBUTION.txt'), 'utf8')
    expect(text).toMatch(/BodyParts3D/)
    expect(text).toMatch(/Z-Anatomy/)
    expect(text).toMatch(/CC BY-SA 4\.0|Attribution-ShareAlike 4\.0/)
    expect(meta.pipeline!.registration.anchors).toBeGreaterThan(100)
    expect(meta.pipeline!.registration.residualRmsMm).toBeLessThan(20)
  })

  it('writes no long dashes anywhere in the shipped text', () => {
    const files = ['ATTRIBUTION.txt', 'anatomy.json']
    const dashes = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']')
    for (const f of files) expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(dashes)
  })
})

describe('cards', () => {
  it('describes an organ with its measured volume and a true sentence', () => {
    const heart = meta.parts.find((p) => p.id === 'heart')!
    const info = describePick({ layer: 'organs', index: heart.index }, meta as never, null)!
    expect(info.title).toBe('Heart')
    expect(info.fact).toMatch(/times a day/)
    expect(info.rows[0][0]).toBe('Volume')
    expect(parseInt(info.rows[0][1].replace(/,/g, ''), 10)).toBeGreaterThan(300)
  })

  it('describes a bone by its longest side', () => {
    const femur = meta.parts.find((p) => p.id === 'femur-l')!
    const info = describePick({ layer: 'skeleton', index: femur.index }, meta as never, null)!
    expect(info.kind).toBe('bone')
    expect(info.rows[0][1]).toMatch(/cm/)
  })
})
