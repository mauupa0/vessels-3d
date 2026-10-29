# Vessels

A human body from open anatomical atlases, in the browser. The skeleton, the organs and the vessel trunks are real atlas data. The small vessels that reach every organ are grown by an algorithm when the page loads: space colonization, with radii from Murray's law and a pulse wave that travels down the tree.

Live: https://vessels-oktawian.vercel.app

## What you can do

- Toggle skin, skeleton, organs, arteries and veins. Hover any organ, bone or vessel for its name, click to fly the camera to it.
- Selecting an organ isolates it, makes it translucent and lights up the vessels that feed it, including the branches the algorithm grew inside it.
- Heart rate, pause (zero frames rendered while paused), a section plane in three directions, replay of the growth, a new seed.
- An opening scan: the section plane sweeps from the feet to the head, then the vessels grow in.
- Phone: 360 px layout with a light tier (fewer attractors, no post-processing).

## Where the anatomy comes from

| Piece | Source | Licence |
|---|---|---|
| Skin, kidneys, small intestine, brain | BodyParts3D (DBCLS), 2234 OBJ meshes | CC BY 4.0 on the database page, the OBJ files still say CC BY-SA 2.1 Japan |
| Skeleton (288 parts), cartilage, discs, heart, lungs, liver, stomach, spleen, pancreas, colon, bladder, trachea, adrenals | Z-Anatomy, `Startup.blend` | CC BY-SA 4.0 |
| 650 vessel centerlines with a radius at every point | Z-Anatomy, curves of the cardiovascular collection | CC BY-SA 4.0 |

Left out on purpose: the elements Z-Anatomy lists under non-commercial licences (kidney, inner ear, Brainder brain and white matter). Kidneys and brain come from BodyParts3D instead. The intrarenal vessel curves are dropped and regrown by the algorithm.

The meshes, volumes and vessel data under `public/anatomy/` are derived works and are distributed under CC BY-SA 4.0. `public/anatomy/ATTRIBUTION.txt` ships next to them and the page lists the sources under "Sources and licences".

Code, fonts and libraries: React, three.js, react-three-fiber, drei, postprocessing, Motion (MIT); Instrument Serif and Geist (SIL OFL 1.1). Blender (GPL) was used offline for extraction only.

## How it works

1. **Pipeline** (`pipeline/`, run once, offline). `00-fetch` downloads the two atlases (about 230 MB, 600 MB unpacked, kept outside the repository), `05-blender` dumps the Z-Anatomy meshes and curves with headless Blender 5.2, `20-assemble` registers BodyParts3D into the Z-Anatomy frame, `30-build` smooths, simplifies (meshoptimizer) and writes three GLB files with meshopt compression, `40-volume` builds the label volumes, `50-vessels` turns the curves into four rooted trees, `60-stats` writes the numbers the page quotes. The whole thing is reproducible: running stages 20 to 60 again gives byte-identical assets (checked with md5).
2. **Registration.** The atlases do not share a frame: Z-Anatomy sits about (0, 98, 72) mm off BodyParts3D in the torso and re-poses the limbs by up to 20 mm. 120 bones that exist in both fix a global scale (0.9972) and translation, a Shepard interpolation of the per-bone residuals does the rest. Residual after the global fit: 13.7 mm RMS.
3. **Label volume.** 119 x 292 x 54 voxels of 6 mm (outside, tissue, bone, one label per organ) and a 3 mm grid for the organs only (91 x 304 x 72). Built by conservative triangle rasterisation plus an exterior flood fill; open meshes (lung lobes) are sealed by one voxel when the plain fill leaks. 77.9 L of body.
4. **Trunks.** Each Bezier curve is resampled every 3.5 mm and joined to the nearest already placed node of the same kind. Four trees: systemic arteries and veins, pulmonary arteries and veins. 35,897 atlas nodes.
5. **Growth** (`src/lib/colonization.ts`, in a Web Worker). Space colonization from the atlas nodes. Attractors are scattered by volume and demand: kill distance 13.5 mm in tissue, shrinking with the cube root of demand in organs (kidney about 3.6 mm). A sparse scaffold at tissue scale plus a dense fine population share one tree. Attractors die 1.8 kill distances from an atlas node (no bottle-brush along trunks), a branch that entered an organ cannot leave it, bone is an obstacle, stubs shorter than 14 mm are pruned.
6. **Radii.** Murray's law bottom-up from a leaf of 0.11 mm, `r_parent^3 = sum r_child^3`. A subtree that would be thicker than the atlas vessel it hangs from is scaled down as a whole (the law is homogeneous, so it stays exact). The atlas itself only roughly follows it: median ratio 1.32 over 409 junctions.
7. **Pulse.** Every node stores its path length from the heart. The shader computes `phase = fract(beat - s / wavelength)`, so changing the heart rate never makes the wave jump. Veins use the return path, offset past the longest arterial path of their circuit. The wavelength (1.25 m) is far shorter than a real pulse wave so that the delay can be seen.
8. **Rendering.** One merged mesh per layer with a part id per vertex (a patched `MeshPhysicalMaterial`: per-part highlight, focus, heart and lung motion, surface finish), vessels as instanced tubes built in the vertex shader (one draw call per tree), a translucent skin, an environment from procedural light panels, bloom, N8AO ambient occlusion, 4x MSAA in the composer plus 1.5x supersampling of the frame on a 1x screen (the browser scales it down; a pixel budget caps it, and a machine that falls under 50 fps drops back to the native size). The light tier has no composer and uses the canvas antialiasing. Tubes join ring to ring: a segment and its thickest continuation share the end ring and tangent, a side branch starts at its own radius, so a trunk is one smooth pipe and not a string of beads. Hover and click use GPU picking: the same geometry renders ids into a 1 x 1 target.

## Measured

Machine: AMD Ryzen 5 7600X, Radeon RX 6950 XT. Headless Chromium with the real GPU (ANGLE d3d11), vsync on, production build, `scripts/perf.mjs` (full numbers in `scripts/perf-report.json`).

| | Desktop, full tier | Phone profile, light tier |
|---|---|---|
| Viewport | 1440 x 900, drawn at 1.5x (2160 x 1350) | 360 x 740, 2x, touch, CPU 4x slower |
| Frame rate | 60 (vsync cap) | 60 (vsync cap) |
| Frame time | 16.6 ms | 16.6 ms |
| Render loop on the main thread | 0.2 ms | 0.36 ms (under the 4x slowdown) |
| GPU time per frame, 95th percentile (median) | 11.7 ms (5.2) | 3.8 ms (0.7) |
| Draw calls per frame | 38, of which the post-processing passes are most | 9 |
| Triangles per frame | 1.72 M | 0.77 M |
| Vessel segments drawn | 86,565 | 43,896 |
| Vessel generation (worker) | 1.4 to 1.6 s | 0.4 s |
| Frames rendered while paused | 0 | 0 |

Downloads: 1.46 MB of meshes (skin 183 KB, skeleton 589 KB, organs 690 KB), 1.11 MB of volume and vessel data, 511 KB of script (gzip), 7 KB for the generation worker. 1.41 M triangles in the atlases became 345 k in the scene.

GPU time is the sum of the timer queries (`EXT_disjoint_timer_query_webgl2`) around every frame, so it is real work and not the vsync wait. Each session runs three times and the run with the middle 95th percentile is reported; the median moves with the GPU clock from run to run (0.6 to 5 ms with the same code), the 95th percentile does not (three runs: 11.5, 11.7, 11.7 ms). Before this round (SMAA, no samples, drawn at 1x): desktop 5.5 ms at the 95th percentile (median 2.3), phone 3.6 (0.5). Now: desktop 11.7 (5.2), phone 3.8 (0.7), 60 fps in both. Why: the scene buffer of the composer had 4 samples all along (read at run time: framebuffer samples 0 before, 4 after, N8AO and bloom passes 0 as they should be), but 4 coverage levels on the thin bright rim of the skin still leave stairs. Share of edge pixels with no intermediate level on the shoulder arc: 70% before, 83% with no antialiasing, 48% with MSAA 4, 30% with MSAA 4 and 1.5x supersampling (27% at 2x, 16.2 ms at the 95th percentile, too close to the frame budget). Screenshots: `shots/round2/edge-compare-dpr1.png` and `edge-compare-dpr2.png` (same frame, 6x zoom).

Not measured: real phone hardware (the phone column is a desktop GPU with a throttled CPU, so real mobile GPUs and thermal behaviour are unknown), Safari and Firefox.

## Run

```
pnpm install
pnpm dev                  # http://localhost:5173
pnpm build && pnpm preview
```

URL parameters: `?seed=1234`, `?quality=light|full`.

## Tests

- `pnpm test`: 65 Vitest tests on the real shipped assets: volume decoding and chamfer distances, atlas tree validity, determinism, attractor accounting, nodes inside the skin and outside bone, branches never leaving an organ, no stubs left, Murray's law exact at every grown node, wave direction, packing, GLB contents (part ids, scene units, groin kept smooth), licence file present, no long dashes.
- `node scripts/mutation-check.mjs`: the negative control. It breaks the implementation in 20 places (voxel index axes, varint decoding, chamfer weights, bone check, Murray exponent and scaling, venous wave direction and offset, attractor consumption, organ leaving, pruning, packing, organ labels, supply mapping, tier choice, tube joints, side branch radius, supersampling of the light tier and ignoring its pixel budget, pulse upstroke), checks that a test goes red each time and restores the file. Last run: 20 of 20 red, suite green again afterwards (`scripts/mutation-report.txt`). The first run caught two gaps (long run lengths and bone in `allows`), which now have tests.
- `node scripts/interact.mjs` (needs a preview build): 45 browser checks with the real GPU: layers, picking and hidden layers, organ list and camera flight, card, Escape, hover tooltip, drag does not select, heart rate, zero frames while paused and behind the page, section plane, new seed, keyboard focus, reduced motion (no scan, no spin), 360 px (no overflow measured against the 360 that was asked for, card and dock inside the screen, touch targets, the growth replay button and a heart rate slider of at least 100 px).
- `node scripts/overlap.mjs [url]`: bounding boxes of every control at 320, 360, 390, 1024, 1280 and 1440 px, idle and with a card open. Goal and last result: 0 overlaps (`--break` pushes the dock over the chips and has to go red).
- `scripts/states.mjs`, `scripts/organs.mjs`, `scripts/timeline.mjs`, `scripts/snap.mjs`: screenshots at 1440 and 360 px for visual review.

## Rebuilding the assets

```
node pipeline/run.mjs     # download, Blender dump, assemble, build, volume, vessels, stats
```

Needs Node 22 or newer, Blender 5.2 (`BLENDER=` if it is not in the default path) and a few minutes (BodyParts3D downloads slowly). Data goes to `VESSELS_DATA` (default `<system temp dir>/vessels-work`), the result to `public/anatomy/`.

## Decisions

- **Real anatomy over the signed distance body.** The previous version generated a mannequin from ellipsoids. The new one needed true organs and bones, so the body is an atlas and the "inside the body" test became a voxel volume baked from the meshes.
- **Z-Anatomy as the frame, BodyParts3D warped into it.** Most of the content (skeleton, organs, all vessels) is native to Z-Anatomy, and the vessel centerlines only make sense next to its bones. Skin, kidneys, small intestine and brain are moved.
- **Vessel trunks from the atlas curves, not from my own paths.** The old hand-placed splines are gone. The atlas has the limb arteries, hand arches and organ hila.
- **Four trees, not two.** The pulmonary circuit is part of the atlas and of a heart that beats, so it is grown into the lungs and coloured by oxygenation (pulmonary arteries blue, pulmonary veins red). The arteries and veins toggles follow flow direction, not colour.
- **meshopt, not Draco.** Draco decoders load from a CDN by default. The meshopt decoder is a small script in the bundle, so there is no runtime fetch from a third party.
- **GPU picking, not a raycaster.** 300 k triangles per layer without a BVH, 288 bones in one draw call.
- **Neutral tone mapping, not AgX.** AgX washed the red and blue vessels to pastel.
- **Skin in the groin is flattened.** The BodyParts3D skin is a complete nude male. For a public page the region is smoothed into a mannequin surface, and a test keeps it that way.
- **Dithered discard for hidden parts, real alpha for the selected organ.** Partial dither leaves a visible dot pattern; full discard is clean. The selected organ is translucent so that its internal vessels show.
- **Level of detail by radius.** Far away the finest twigs are skipped, they resolve as the camera comes closer. It keeps the overview readable and the vertex work down.
- **Light tier.** Phones and low-core machines get a coarser generation (kill distance 24 mm), 6-sided tubes, no post-processing and a lower pixel ratio.
- **Dependencies added:** `@react-three/drei` (camera controls, environment), `@react-three/postprocessing` and `postprocessing` (bloom, ambient occlusion, tone mapping, MSAA), `motion` (card and panel transitions), `@fontsource/instrument-serif` and `@fontsource-variable/geist` (type). Dev only: `@gltf-transform/*` and `meshoptimizer` (the pipeline, and the GLB reader in the tests). Versions are pinned to what the package manager's release-age rule allows.
- **Dropped from the old project:** the SDF body, surface nets, the hand-written trunk skeleton, the instanced heart, `Newsreader` and `Hanken Grotesk`.

## Limits

Illustrative, not medical. One male atlas. The atlas radii only roughly follow Murray's law. The pulse wave is much slower than a real one. Per-organ demand weights are design choices. The BodyParts3D brain is assembled from separate pieces and has small gaps. Pulmonary circuit growth uses the lung volume only. Heart chambers move as one piece (no valves). No real phone was tested, and no iPhone: touch behaviour was checked with emulated touch in Chromium.

## License

Code: MIT, see `LICENSE`. The data under `public/anatomy/` is CC BY-SA 4.0, see `public/anatomy/ATTRIBUTION.txt`.
