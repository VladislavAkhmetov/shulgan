import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Keep the delivered geometry, joints, weights and clips; image decoding belongs to browser QA.
const bytes = await readFile('public/models/berkut_rig.glb')
const jsonLength = bytes.readUInt32LE(12), data = JSON.parse(bytes.subarray(20, 20 + jsonLength))
delete data.images; delete data.textures; delete data.samplers
for (const material of data.materials ?? []) {
  for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete material[key]
  for (const key of ['baseColorTexture', 'metallicRoughnessTexture']) delete material.pbrMetallicRoughness?.[key]
}
const json = Buffer.from(JSON.stringify(data)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32)
json.copy(padded)
const bin = bytes.subarray(20 + jsonLength), header = Buffer.alloc(20)
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + bin.length, 8)
header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
const glb = Buffer.concat([header, padded, bin])
const source = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '')
const originalLoad = GLTFLoader.prototype.loadAsync
GLTFLoader.prototype.loadAsync = async () => source
const server = await createServer({ configFile: false, cacheDir: '.cache/eagle-check-vite', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
try {
  const { Eagle } = await server.ssrLoadModule('/src/game/actors/eagle.ts')
  const { EagleRig } = await server.ssrLoadModule('/src/game/actors/eagleRig.ts')
  function world(enemies = []) {
    const events = { hits: [], stuns: [], tools: [], sounds: [] }
    return {
      scene: new THREE.Scene(), enemies, time: 0, events,
      player: { pos: new THREE.Vector3(), aimAngle: .5, noteTool: (tool) => events.tools.push(tool) },
      sound: (kind) => events.sounds.push(kind),
      vfx: { rings: { spawn() {} }, soft: { spawn() {} }, add: { spawn() {} } },
    }
  }
  function enemy(w, x, z, options = {}) {
    const e = { pos: new THREE.Vector3(x, 0, z), alive: true, hidden: false, state: 'idle', kind: 'ubyr', airY: 0, revealT: 0,
      takeHit(...args) { w.events.hits.push({ time: w.time, enemy: e, args }); return true },
      stun(seconds) { w.events.stuns.push(seconds) }, ...options }
    return e
  }
  async function make(w) { const e = new Eagle(w); assert.equal(await e.ready, true); return e }
  function advance(w, e, duration, fps = 60) {
    for (let i = 0; i < Math.ceil(duration * fps); i++) { w.time += 1 / fps; e.update(1 / fps); e.group.updateMatrixWorld(true) }
  }
  const w = world()
  const near = enemy(w, 3, 1), far = enemy(w, 9, 0), hidden = enemy(w, 1, 0, { hidden: true }), dormant = enemy(w, .5, 0, { state: 'dormant' }), dead = enemy(w, .2, 0, { alive: false })
  w.enemies.push(far, hidden, dormant, dead, near)
  const eagle = await make(w)
  let meshes = []; eagle.group.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o) })
  assert.equal(meshes.length, 1); assert.equal(meshes[0].skeleton.bones.length, 84)
  assert(meshes[0].layers.isEnabled(4) && meshes[0].layers.isEnabled(5), 'shadow layers')
  eagle.release(new THREE.Vector3(0, 1.25, 0))
  advance(w, eagle, .25)
  const before = meshes[0].skeleton.bones.flatMap((b) => b.quaternion.toArray())
  eagle.update(0)
  assert.deepEqual(meshes[0].skeleton.bones.flatMap((b) => b.quaternion.toArray()), before, 'paused bird changes pose')
  advance(w, eagle, 4)
  assert.equal(w.events.hits.length, 1, 'skill hits more than once')
  assert.equal(w.events.hits[0].enemy, near, 'target selection changed')
  assert(w.events.hits[0].time > 2.45 && w.events.hits[0].time < 2.65, 'contact timing')
  assert.deepEqual([w.events.hits[0].args[0], w.events.hits[0].args[1], w.events.hits[0].args[4], w.events.hits[0].args[6]], [14, 18, 3, 'eagle'])
  assert.deepEqual(w.events.stuns, [1.6]); assert.deepEqual(w.events.tools, ['eagle'])
  assert.equal(hidden.revealT, 6); assert.equal(dormant.revealT, 6); assert.equal(dead.revealT, 0)
  assert.equal(eagle.active, false); assert.equal(eagle.group.visible, false)
  assert(meshes[0].skeleton.bones.every((b) => b.quaternion.toArray().every(Number.isFinite)))
  // Repeat releases, coarse frames, no target, boss and a target hidden during the dive.
  for (const fps of [20, 30, 60]) {
    const testWorld = world(); const boss = enemy(testWorld, 2, 1, { kind: 'boss' }); testWorld.enemies.push(boss)
    const e = await make(testWorld); e.release(new THREE.Vector3(0, 1, 0)); advance(testWorld, e, 4.5, fps)
    assert.equal(testWorld.events.hits.length, 1); assert.deepEqual(testWorld.events.stuns, [.6]); e.dispose()
  }
  const emptyWorld = world(), empty = await make(emptyWorld)
  empty.release(new THREE.Vector3(0, 1, 0)); advance(emptyWorld, empty, 4.5)
  assert.equal(emptyWorld.events.hits.length, 0); assert.equal(empty.active, false); empty.dispose()
  const invalidWorld = world(), invalidEnemy = enemy(invalidWorld, 2, 1); invalidWorld.enemies.push(invalidEnemy)
  const invalid = await make(invalidWorld); invalid.release(new THREE.Vector3(0, 1, 0)); advance(invalidWorld, invalid, 2.2); invalidEnemy.hidden = true; advance(invalidWorld, invalid, 2)
  assert.equal(invalidWorld.events.hits.length, 0); invalid.dispose()
  eagle.release(new THREE.Vector3(4, 2, -3)); assert.equal(eagle.group.visible, true); assert.equal(eagle.group.position.x, 4)
  const independent = new EagleRig(); assert.equal(await independent.ready, true)
  let otherMesh; independent.root.traverse((o) => { if (o.isSkinnedMesh) otherMesh = o })
  assert.notEqual(otherMesh.skeleton.bones[0], meshes[0].skeleton.bones[0]); assert.notEqual(otherMesh.material, meshes[0].material)
  independent.dispose(); eagle.dispose(); assert.equal(eagle.group.parent, null)
  const late = new EagleRig(); late.dispose(); assert.equal(await late.ready, false); assert.equal(late.root.children.length, 0)
  console.log('Eagle game: real 84-bone skin, clips, shadows, one hit, nearest valid target, reveal, stun, 20/30/60 fps, pause, repeated release and disposal passed.')
} finally { GLTFLoader.prototype.loadAsync = originalLoad; await server.close() }
