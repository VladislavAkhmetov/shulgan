// Builds public/models/hero_rig.glb from Mixamo downloads (docs/ART.md «Анимации», docs/EQUIPMENT.md).
//
//   1. FBX → GLB:  FBX2glTF --binary --input <dir>/<name>.fbx --output <dir>/<name>   (npm package fbx2gltf)
//   2. node tools/hero-rig.mjs <dir> <original.glb> idle_combat run roll ... [--outfit kaftan=<dir>/kaftan.glb ...]
//
// <dir>/idle.glb gives the base body and the skeleton; the other names give clips (copied by bone name).
// <original.glb> is the generator's model the base was made from: Mixamo keeps the UVs but drops the normal and
// metal/roughness maps, so they are taken from there.
// The base is split into base_head (stays visible under every outfit) and base_body (hidden when dressed).
// Each outfit is bound to the base skeleton by bone name with its own inverse bind matrices, so at rest it sits on
// the base's bones exactly as it sat on its own; its head is cut away (the face is always the base's).
//
// Dev-only deps: @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { simplify, weld, textureCompress, prune, dedup, mergeDocuments } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const args = process.argv.slice(2)
const dir = args[0]
const original = args[1]
const clips = []
const outfits = []
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--outfit') outfits.push(args[++i].split('='))
  else clips.push(args[i])
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const base = await io.read(dir + '/idle.glb')
const root = base.getRoot()
const buf = root.listBuffers()[0]
const short = (n) => n.replace(/^mixamorig:?/, '')
const byName = new Map(root.listNodes().map((n) => [short(n.getName()), n]))

// ---- clips
root.listAnimations()[0].setName('idle')
for (const name of clips) {
  const src = await io.read(`${dir}/${name}.glb`)
  for (const a of src.getRoot().listAnimations()) {
    const anim = base.createAnimation(name)
    for (const c of a.listChannels()) {
      const target = byName.get(short(c.getTargetNode().getName()))
      if (!target) continue
      const s = c.getSampler()
      const inp = base.createAccessor().setArray(s.getInput().getArray().slice()).setType('SCALAR').setBuffer(buf)
      const out = base.createAccessor().setArray(s.getOutput().getArray().slice()).setType(s.getOutput().getType()).setBuffer(buf)
      const smp = base.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation(s.getInterpolation())
      anim.addSampler(smp).addChannel(base.createAnimationChannel().setTargetNode(target).setTargetPath(c.getTargetPath()).setSampler(smp))
    }
  }
}

// ---- base material: normal + metal/roughness from the generator's model
base.createExtension(EXTTextureWebP).setRequired(true)
const copyTex = (doc, t) => doc.createTexture(t.getName()).setImage(t.getImage().slice()).setMimeType(t.getMimeType())
{
  const orig = await io.read(original)
  const om = orig.getRoot().listMaterials()[0]
  const mat = root.listMaterials()[0]
  if (om.getNormalTexture()) mat.setNormalTexture(copyTex(base, om.getNormalTexture()))
  if (om.getMetallicRoughnessTexture()) mat.setMetallicRoughnessTexture(copyTex(base, om.getMetallicRoughnessTexture())).setMetallicFactor(1).setRoughnessFactor(1)
}

/** per-vertex weight of the given bones */
function boneWeight(prim, skin, names) {
  const joints = prim.getAttribute('JOINTS_0')
  const weights = prim.getAttribute('WEIGHTS_0')
  const want = new Set(skin.listJoints().map((j, i) => (names.has(short(j.getName())) ? i : -1)).filter((i) => i >= 0))
  const n = joints.getCount()
  const out = new Float32Array(n)
  const j = [0, 0, 0, 0]
  const w = [0, 0, 0, 0]
  for (let v = 0; v < n; v++) {
    joints.getElement(v, j)
    weights.getElement(v, w)
    for (let k = 0; k < 4; k++) if (want.has(j[k])) out[v] += w[k]
  }
  return out
}

/** indices of the triangles that pass the test */
function pickTriangles(prim, keep) {
  const idx = prim.getIndices().getArray()
  const out = []
  for (let t = 0; t < idx.length; t += 3) if (keep(idx[t], idx[t + 1], idx[t + 2])) out.push(idx[t], idx[t + 1], idx[t + 2])
  return out
}

const HEAD = new Set(['Head', 'HeadTop_End'])
const scene = root.listScenes()[0]
const baseNode = root.listNodes().find((n) => n.getMesh() && n.getSkin())
const skin = baseNode.getSkin()
const baseMesh = baseNode.getMesh()
const prim = baseMesh.listPrimitives()[0]
const head = boneWeight(prim, skin, HEAD)
// the head reaches a little down the neck so a collar never shows a gap
const headIdx = pickTriangles(prim, (a, b, c) => Math.max(head[a], head[b], head[c]) > 0.3)
const bodyIdx = pickTriangles(prim, (a, b, c) => Math.max(head[a], head[b], head[c]) <= 0.3)
const headPrim = prim.clone()
headPrim.setIndices(base.createAccessor().setArray(new Uint32Array(headIdx)).setType('SCALAR').setBuffer(buf))
prim.setIndices(base.createAccessor().setArray(new Uint32Array(bodyIdx)).setType('SCALAR').setBuffer(buf))
baseMesh.setName('base_body')
baseNode.setName('base_body')
const headNode = base.createNode('base_head').setMesh(base.createMesh('base_head').addPrimitive(headPrim)).setSkin(skin)
baseNode.getParentNode() ? baseNode.getParentNode().addChild(headNode) : scene.addChild(headNode)
console.log(`base: head ${headIdx.length / 3} tris, body ${bodyIdx.length / 3} tris`)

// ---- outfits
for (const [name, file] of outfits) {
  const src = await io.read(file)
  const srcRoot = src.getRoot()
  const srcNode = srcRoot.listNodes().find((n) => n.getMesh() && n.getSkin())
  const srcSkin = srcNode.getSkin()
  const srcPrim = srcNode.getMesh().listPrimitives()[0]
  // cut the outfit's own head: only triangles that are clearly head go
  const h = boneWeight(srcPrim, srcSkin, HEAD)
  const keep = pickTriangles(srcPrim, (a, b, c) => (h[a] + h[b] + h[c]) / 3 < 0.55)
  srcPrim.setIndices(src.createAccessor().setArray(new Uint32Array(keep)).setType('SCALAR').setBuffer(srcRoot.listBuffers()[0]))
  srcNode.setName('outfit_' + name)
  srcNode.getMesh().setName('outfit_' + name)
  const map = mergeDocuments(base, src)
  const node = map.get(srcNode)
  const newSkin = map.get(srcSkin)
  // the outfit moves with the base's bones (same names), keeping its own inverse bind matrices
  const joints = newSkin.listJoints()
  for (const j of joints) newSkin.removeJoint(j)
  for (const j of joints) {
    const b = byName.get(short(j.getName()))
    if (!b) throw new Error(`outfit ${name}: no base bone ${j.getName()}`)
    newSkin.addJoint(b)
  }
  newSkin.setSkeleton(skin.getSkeleton())
  node.getParentNode()?.removeChild(node)
  for (const s of root.listScenes()) s.removeChild(node)
  ;(baseNode.getParentNode() ?? scene).addChild(node)
  // drop the outfit's own skeleton and scene
  for (const s of root.listScenes()) if (s !== scene) s.dispose()
  for (const j of joints) j.dispose()
  for (const n of root.listNodes()) if (!n.getParentNode() && !scene.listChildren().includes(n) && n !== node) n.dispose()
  // outfits come without metal/roughness maps: cloth, fur and leather should not shine like plastic
  const om = node.getMesh().listPrimitives()[0].getMaterial()
  if (om && !om.getMetallicRoughnessTexture()) om.setMetallicFactor(0).setRoughnessFactor(0.82)
  console.log(`outfit ${name}: ${keep.length / 3} tris after the head cut`)
}

// one buffer for everything
for (const b of root.listBuffers().slice(1)) {
  for (const a of root.listAccessors()) if (a.getBuffer() === b) a.setBuffer(buf)
  b.dispose()
}

await base.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.26, error: 0.002 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
  dedup(),
  prune(),
)
await io.write('public/models/hero_rig.glb', base)
console.log('anims', root.listAnimations().map((a) => a.getName()).join(','))
console.log('meshes', root.listMeshes().map((m) => `${m.getName()} ${m.listPrimitives()[0].getIndices().getCount() / 3}t`).join(', '))
