// Build the Ubyr's shared mesh + seven Mixamo clips from the supplied FBX files.
// node tools/ubyr-rig.mjs <fbx-directory>
// Work on copies: FBX2glTF extracts embedded textures next to its input.
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import convert from 'fbx2gltf'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
  dedup,
  prune,
  resample,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
if (!source) throw new Error('Usage: node tools/ubyr-rig.mjs <fbx-directory>')
const work = path.join(project, '.cache/ubyr')
await mkdir(work, { recursive: true })
const files = {
  walk: 'Zombie Walk.fbx',
  run: 'ubir_running.fbx',
  scream: 'ubir_scream.fbx',
  swipe: 'Zombie Attack.fbx',
  kick: 'Zombie Kicking.fbx',
  hurt: 'Zombie Reaction Hit.fbx',
  death: 'Zombie Death.fbx',
}
for (const [name, file] of Object.entries(files)) {
  const input = path.join(work, name + '.fbx')
  const output = path.join(work, name + '.glb')
  await copyFile(path.resolve(source, file), input)
  await convert(input, output)
  console.log(`Converted ${file}`)
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(path.join(work, 'walk.glb'))
const root = doc.getRoot()
const buffer = root.listBuffers()[0]
const short = (name) => name.replace(/^mixamorig:?/, '')
const bones = new Map(root.listNodes().map((n) => [short(n.getName()), n]))
if (!root.listSkins().length)
  throw new Error('The walk FBX must contain a skinned Ubyr mesh')
for (const a of root.listAnimations()) a.setName('walk')
for (const name of Object.keys(files).slice(1)) {
  const src = await io.read(path.join(work, name + '.glb'))
  const animation = src.getRoot().listAnimations()[0]
  if (!animation) throw new Error(`No animation in ${files[name]}`)
  const out = doc.createAnimation(name)
  for (const channel of animation.listChannels()) {
    const target = bones.get(short(channel.getTargetNode().getName()))
    if (!target)
      throw new Error(
        `${name}: missing bone ${channel.getTargetNode().getName()}`,
      )
    const sampler = channel.getSampler()
    const input = doc
      .createAccessor()
      .setArray(sampler.getInput().getArray().slice())
      .setType('SCALAR')
      .setBuffer(buffer)
    const output = doc
      .createAccessor()
      .setArray(sampler.getOutput().getArray().slice())
      .setType(sampler.getOutput().getType())
      .setBuffer(buffer)
    out
      .addSampler(
        doc
          .createAnimationSampler()
          .setInput(input)
          .setOutput(output)
          .setInterpolation(sampler.getInterpolation()),
      )
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(target)
          .setTargetPath(channel.getTargetPath())
          .setSampler(out.listSamplers().at(-1)),
      )
  }
}

// In-place clips: keep vertical motion (including the fall), remove XZ travel.
for (const anim of root.listAnimations()) {
  for (const channel of anim.listChannels()) {
    if (
      short(channel.getTargetNode().getName()) !== 'Hips' ||
      channel.getTargetPath() !== 'translation'
    )
      continue
    const values = channel.getSampler().getOutput().getArray()
    const bind = channel.getTargetNode().getTranslation()
    for (let i = 0; i < values.length; i += 3) {
      values[i] = bind[0]
      values[i + 2] = bind[2]
    }
  }
}
for (const mat of root.listMaterials())
  mat.setMetallicFactor(0).setRoughnessFactor(0.88)
await MeshoptSimplifier.ready
const triangles = root
  .listMeshes()
  .reduce(
    (sum, mesh) =>
      sum +
      mesh
        .listPrimitives()
        .reduce((n, p) => n + p.getIndices().getCount() / 3, 0),
    0,
  )
await doc.transform(
  weld(),
  simplify({
    simplifier: MeshoptSimplifier,
    ratio: Math.min(1, 9000 / triangles),
    error: 0.005,
  }),
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [1024, 1024],
  }),
  resample(),
  dedup(),
  prune(),
)
const output = path.join(project, 'public/models/ubyr_rig.glb')
await io.write(output, doc)
console.log(
  `${output}: ${((await stat(output)).size / 1048576).toFixed(2)} MiB`,
)
for (const a of root.listAnimations())
  console.log(`${a.getName()}: ${a.listChannels().length} channels`)
for (const mesh of root.listMeshes())
  console.log(
    `${mesh.getName()}: ${mesh.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0)} triangles`,
  )
