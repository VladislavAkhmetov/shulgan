// Adds (or replaces) Mixamo clips in the finished public/models/hero_rig.glb, without rebuilding the meshes.
// For new animation deliveries after the body and outfits are already built (tools/hero-rig.mjs).
//
//   1. FBX → GLB:  FBX2glTF --binary --input <dir>/<name>.fbx --output <dir>/<name>   (npm package fbx2gltf)
//   2. node tools/hero-anims.mjs <dir> atk_kos atk_obr block ...
//
// Each <dir>/<name>.glb gives one clip named <name>; channels are copied by bone name, so With Skin and
// Without Skin downloads both work. The skeleton must be Timer's (same Mixamo upload).
//
// Dev-only deps: @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { resample, prune } from '@gltf-transform/functions'

const [dir, ...names] = process.argv.slice(2)
const OUT = 'public/models/hero_rig.glb'
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(OUT)
const root = doc.getRoot()
const buf = root.listBuffers()[0]
const short = (n) => n.replace(/^mixamorig:?/, '')
const byName = new Map(root.listNodes().map((n) => [short(n.getName()), n]))

for (const name of names) {
  for (const old of root.listAnimations().filter((a) => a.getName() === name)) old.dispose()
  const src = await io.read(`${dir}/${name}.glb`)
  const a = src.getRoot().listAnimations()[0]
  const anim = doc.createAnimation(name)
  let n = 0
  for (const c of a.listChannels()) {
    const target = byName.get(short(c.getTargetNode().getName()))
    if (!target) continue
    const s = c.getSampler()
    const inp = doc.createAccessor().setArray(s.getInput().getArray().slice()).setType('SCALAR').setBuffer(buf)
    const out = doc.createAccessor().setArray(s.getOutput().getArray().slice()).setType(s.getOutput().getType()).setBuffer(buf)
    const smp = doc.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation(s.getInterpolation())
    anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(c.getTargetPath()).setSampler(smp))
    n++
  }
  const dur = Math.max(...anim.listSamplers().map((s) => s.getInput().getMax([])[0]))
  console.log(`${name}: ${n} channels, ${dur.toFixed(2)} s`)
}

await doc.transform(resample(), prune())
await io.write(OUT, doc)
console.log('anims', root.listAnimations().map((a) => a.getName()).join(','))
