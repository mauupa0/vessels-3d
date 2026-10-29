import { fmt } from '../lib/describe'
import { useStore } from '../store'
import { GrowthReplay, MeasuredTable, MurrayFigure, PulseFigure, SliceViewer } from './figures'

function Pipeline() {
  const meta = useStore((s) => s.meta)
  if (!meta?.pipeline) return null
  const p = meta.pipeline
  const web = { skin: meta.layers.skin.triangles, skeleton: meta.layers.skeleton.triangles, organs: meta.layers.organs.triangles }
  const bytes = Object.values(meta.layers).reduce((a, l) => a + l.bytes, 0)
  const rows: { name: string; src: number; out: number }[] = [
    { name: 'Skin', src: p.sourceTriangles.skin, out: web.skin },
    { name: 'Skeleton', src: p.sourceTriangles.skeleton, out: web.skeleton },
    { name: 'Organs', src: p.sourceTriangles.organs, out: web.organs },
  ]
  const max = Math.max(...rows.map((r) => r.src))
  const totalSrc = rows.reduce((a, r) => a + r.src, 0)
  const totalOut = rows.reduce((a, r) => a + r.out, 0)
  return (
    <div className="pipeline">
      <ol className="steps">
        <li>
          <h3>Two open atlases</h3>
          <p>
            BodyParts3D gives the skin, kidneys, small intestine and brain. Z-Anatomy gives the skeleton, the other organs and {fmt(p.vesselCurves.used)} vessel centerlines with a radius at every point.
          </p>
        </li>
        <li>
          <h3>One frame</h3>
          <p>
            The atlases disagree by up to 20 mm, because Z-Anatomy re-posed the limbs. {fmt(p.registration.anchors)} bones that exist in both fix a scale of {p.registration.scale} and a smooth warp. Residual
            after the global fit: {p.registration.residualRmsMm} mm RMS.
          </p>
        </li>
        <li>
          <h3>Fewer triangles</h3>
          <p>
            Each mesh is smoothed and simplified with meshoptimizer, then merged per layer with a part id on every vertex, so a hover can tell {fmt(meta.layers.skeleton.parts)} bones apart in one draw call.
          </p>
        </li>
        <li>
          <h3>Small files</h3>
          <p>
            Three GLB files with meshopt compression and 16 bit positions: {fmt(bytes / 1e6, 2)} MB in total. The skeleton and the organs load after the skin.
          </p>
        </li>
      </ol>
      <div className="bars" role="img" aria-label={`Triangles before and after simplification: ${rows.map((r) => `${r.name} ${fmt(r.src)} to ${fmt(r.out)}`).join(', ')}.`}>
        {rows.map((r) => (
          <div key={r.name} className="bar-row">
            <span className="bar-name">{r.name}</span>
            <span className="bar-track">
              <i className="src" style={{ width: (r.src / max) * 100 + '%' }} />
              <i className="out" style={{ width: (r.out / max) * 100 + '%' }} />
            </span>
            <span className="bar-num">
              {fmt(r.src / 1000)}k to {fmt(r.out / 1000)}k
            </span>
          </div>
        ))}
        <div className="bar-total">
          {fmt(totalSrc / 1e6, 2)} M triangles from the atlases, {fmt(totalOut / 1e3)}k in the scene.
        </div>
      </div>
    </div>
  )
}

function MurrayDiagram() {
  return (
    <svg className="y" viewBox="0 0 300 226" role="img" aria-label="A vessel of radius r splitting into two thinner vessels of radii r1 and r2. Murray's law: r cubed equals r1 cubed plus r2 cubed.">
      <path d="M150 216 V140" stroke="var(--bone-dim)" strokeWidth={26} fill="none" />
      <path d="M150 140 C150 108 108 100 78 30" stroke="var(--bone-dim)" strokeWidth={18} fill="none" />
      <path d="M150 140 C150 108 192 100 222 30" stroke="var(--bone-dim)" strokeWidth={18} fill="none" />
      <g fontFamily="var(--serif)" fontSize={22} fill="var(--bone)" fontStyle="italic">
        <text x={172} y={190}>
          r
        </text>
        <text x={26} y={74}>
          r<tspan fontSize={14} dy={5}>1</tspan>
        </text>
        <text x={254} y={74}>
          r<tspan fontSize={14} dy={5}>2</tspan>
        </text>
      </g>
    </svg>
  )
}

export default function HowItWorks() {
  const model = useStore((s) => s.model)
  const meta = useStore((s) => s.meta)
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const art = model?.trees.artery
  return (
    <main className="page" id="how">
      <section className="sec sec-intro">
        <h2>How it works</h2>
        <p className="lead">
          The body is not modelled here. It is assembled from open anatomical atlases, and the part that is missing from them, the small vessels that reach every organ, is grown by an algorithm when the page loads.
        </p>
      </section>

      <section className="sec">
        <header>
          <h2>From atlas to scene</h2>
          <p>Real anatomy is heavy. Making it light enough for a phone is most of the work, and it is done once, offline, by a pipeline of small scripts in the repository.</p>
        </header>
        <Pipeline />
      </section>

      <section className="sec split">
        <header>
          <h2>A body that can answer where you are</h2>
          <p>
            Every vessel node asks the same three questions: am I inside the skin, am I outside bone, and which organ am I in. A label volume answers all three with one array read. The organs get a second grid at
            3 mm, because their boundaries decide whether a branch stays inside or pokes through the surface.
          </p>
          {meta?.pipeline && (
            <p className="data">
              {fmt(meta.pipeline.voxelCount)} voxels at {meta.volume.voxel * 1000} mm cover {meta.pipeline.bodyLitres} L of body.
            </p>
          )}
        </header>
        <SliceViewer />
      </section>

      <section className="sec">
        <header>
          <h2>Growing into organs</h2>
          <p>
            The method is space colonization. Points are scattered wherever tissue still needs blood. Every vessel node that has points within reach is pulled toward them, the nearest node grows one segment, and a point is
            removed when a vessel arrives. The atlas supplies the trunks, so growth starts from real arteries and veins and only the fine branches are invented.
          </p>
          <p>
            Demand sets the scale. Muscle uses a kill distance of 13.5 mm, the kidney a third of that, so the kidney branches finer. A branch that has entered an organ cannot leave it.
          </p>
        </header>
        <GrowthReplay reducedMotion={reduced} />
      </section>

      <section className="sec split">
        <header>
          <h2>Radii follow Murray&rsquo;s law</h2>
          <p>
            At a branching, the cube of the parent radius equals the sum of the cubes of the children. The grown branches obey it exactly: the radii are computed bottom-up from a leaf of {art ? fmt(art.leafRadius * 1000, 2) : '0.11'} mm.
            The aorta, the renal artery and everything in between then get their thickness from how many leaves hang below them.
          </p>
          <MurrayDiagram />
          <p className="formula">
            r<sup>3</sup> = r<sub>1</sub>
            <sup>3</sup> + r<sub>2</sub>
            <sup>3</sup>
          </p>
        </header>
        <MurrayFigure />
      </section>

      <section className="sec">
        <header>
          <h2>A pulse that travels</h2>
          <p>
            Each node stores the distance blood has travelled from the heart. The shader reads the beat as a phase, <code>fract(beat - s / wavelength)</code>, so changing the heart rate stretches the wave without a jump. Veins use the return path,
            offset past the longest arterial path of their circuit.
          </p>
        </header>
        <PulseFigure />
      </section>

      <section className="sec">
        <header>
          <h2>Measured</h2>
          <p>Numbers from the measurement script in the repository, and from this device while you read.</p>
        </header>
        <MeasuredTable />
      </section>

      <section className="sec split" id="sources">
        <header>
          <h2>Sources and licences</h2>
          <p>
            The anatomy is not mine. It comes from two open projects, and what is shown here is a derived work that stays under their share-alike terms.
          </p>
        </header>
        <div className="sources">
          <dl>
            <div>
              <dt>BodyParts3D</dt>
              <dd>
                The Database Center for Life Science. Skin, kidneys, small intestine, brain, and the bones used to register the two atlases. CC BY 4.0 on the database page; the OBJ files still say CC BY-SA 2.1 Japan.{' '}
                <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" rel="noopener">
                  Source
                </a>
              </dd>
            </div>
            <div>
              <dt>Z-Anatomy</dt>
              <dd>
                Skeleton, cartilage, heart, lungs, liver, stomach, spleen, pancreas, colon, bladder, trachea, adrenal glands and the vessel centerlines. CC BY-SA 4.0. The pieces it lists under non-commercial terms are left out.{' '}
                <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" rel="noopener">
                  Source
                </a>
              </dd>
            </div>
            <div>
              <dt>Derived files</dt>
              <dd>
                The meshes and volumes in this page are distributed under CC BY-SA 4.0, as a work derived from both atlases. The attribution file ships next to them.{' '}
                <a href={import.meta.env.BASE_URL + 'anatomy/ATTRIBUTION.txt'}>ATTRIBUTION.txt</a>
              </dd>
            </div>
            <div>
              <dt>Code and type</dt>
              <dd>React, three.js, react-three-fiber, drei, postprocessing and Motion are MIT. Instrument Serif and Geist are under the SIL Open Font License.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="sec">
        <header>
          <h2>Limits</h2>
          <p>
            This is an illustration, not a medical tool. The body is one male atlas. Limb arteries and veins come from the atlas as drawn, and its radii only roughly follow Murray&rsquo;s law. The pulse wave is far slower than a real one so
            that it can be seen. Vessels near the skin are generated at a distance from it, and the demand weights per organ are design choices, not physiology. The brain is assembled from separate BodyParts3D pieces and has small gaps between them.
          </p>
        </header>
      </section>

      <footer className="foot">
        <p>Built by Oktawian Palikot.</p>
      </footer>
    </main>
  )
}
