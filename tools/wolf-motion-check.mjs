// CPU verification of the delivered skin and the actual game animator. Optional native-Blender preview.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

const bytes = await readFile('public/models/wolf_rig.glb')
const jsonLength = bytes.readUInt32LE(12)
const data = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString())
// Image decoding requires a browser; the delivered geometry, weights, bones and animation stay intact.
delete data.images; delete data.textures; delete data.samplers
for (const material of data.materials ?? []) {
  for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete material[key]
  for (const key of ['baseColorTexture', 'metallicRoughnessTexture']) delete material.pbrMetallicRoughness?.[key]
}
for (const key of ['extensionsRequired', 'extensionsUsed'])
  if (data[key]) data[key] = data[key].filter((name) => name !== 'EXT_texture_webp')
const json = Buffer.from(JSON.stringify(data))
const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded)
const bin = bytes.subarray(20 + jsonLength)
const header = Buffer.alloc(20)
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + bin.length, 8)
header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
const glb = Buffer.concat([header, padded, bin])
const source = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '')
const originalLoad = GLTFLoader.prototype.loadAsync
GLTFLoader.prototype.loadAsync = async () => source
const server = await createServer({ configFile: false, cacheDir: '.cache/wolf-motion-vite',
  server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
try {
  const { WolfRig } = await server.ssrLoadModule('/src/game/actors/wolfRig.ts')
  const { WOLF_CLIPS } = await server.ssrLoadModule('/src/game/actors/models.ts')
  const make = async (base = false) => {
    const rig = new WolfRig()
    assert.equal(await rig.ready, true)
    rig.gait = 0; rig.idleTime = 0; rig.reaction = 'hit_left'
    if (base) rig.motion = null
    return rig
  }
  const bones = (rig) => { let list; rig.root.traverse(o => { if (o.isSkinnedMesh) list = o.skeleton.bones }); return list }
  const bone = (rig, name) => bones(rig).find(b => b.name === THREE.PropertyBinding.sanitizeNodeName(name))
  const world = (b) => b.getWorldPosition(new THREE.Vector3())
  const pose = (rig) => bones(rig).flatMap(b => [...b.position, ...b.quaternion])
  const angle = (rig) => {
    rig.root.updateMatrixWorld(true)
    const rear = world(bone(rig, 'Torso')).sub(world(bone(rig, 'Back')))
    const front = world(bone(rig, 'Neck1')).sub(world(bone(rig, 'Torso2')))
    return Math.atan2(Math.sin(Math.atan2(front.x, front.z) - Math.atan2(rear.x, rear.z)), Math.cos(Math.atan2(front.x, front.z) - Math.atan2(rear.x, rear.z)))
  }
  const left = await make(), right = await make(), straight = await make(true)
  for (let i = 0; i < 120; i++) {
    for (const [rig, turn] of [[left, 1.8], [right, -1.8], [straight, 0]]) {
      rig.root.rotation.y += turn / 60
      rig.update(1 / 60, { speed: 6.5, time: i / 60 })
      assert.ok(pose(rig).every(Number.isFinite))
    }
  }
  const curveLeft = angle(left), curveRight = angle(right), curveBase = angle(straight)
  assert.ok(curveLeft - curveBase > 0.15 && curveRight - curveBase < -0.15, 'Spine must curve in both turn directions')
  assert.notDeepEqual(bone(left, 'Tail2').quaternion.toArray(), bone(left, 'Tail7').quaternion.toArray(), 'Tail segments must bend independently')
  let maximumPawGap = 0, maximumPawShift = 0
  const moving = await make(), baseline = await make(true)
  for (let i = 0; i < 360; i++) {
    const speed = i < 60 ? 1.5 : 6.5
    const attack = i >= 240
    const progress = (i - 240) / 119
    const state = { speed: attack ? 0 : speed, time: i / 60,
      clip: attack ? progress <= .38 ? WOLF_CLIPS.crouch : WOLF_CLIPS.leap : null,
      t: progress <= .38 ? progress / .38 : (progress - .38) / .62 }
    moving.root.rotation.y = baseline.root.rotation.y = Math.sin(i / 80) * 1.2
    moving.update(1 / 60, state); baseline.update(1 / 60, state)
    moving.root.updateMatrixWorld(true); baseline.root.updateMatrixWorld(true)
    for (const side of ['L', 'R']) for (const [lowerName, ankleName] of [['FrontLowerLeg', 'IKFrontLeg'], ['BackLowerLeg', 'IKBackLeg']]) {
      const lower = bone(moving, `${lowerName}.${side}`), ankle = bone(moving, `${ankleName}.${side}`)
      const baseLower = bone(baseline, `${lowerName}.${side}`), baseAnkle = bone(baseline, `${ankleName}.${side}`)
      const length = world(baseLower).distanceTo(world(baseAnkle))
      const end = new THREE.Vector3(0, 1, 0).applyQuaternion(lower.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(length).add(world(lower))
      maximumPawGap = Math.max(maximumPawGap, end.distanceTo(world(ankle)))
      maximumPawShift = Math.max(maximumPawShift, world(ankle).distanceTo(world(baseAnkle)))
    }
    assert.ok(pose(moving).every(Number.isFinite))
  }
  assert.ok(maximumPawGap < 0.0001, `Shins must meet paws: ${maximumPawGap}`)
  assert.ok(maximumPawShift < 0.05, `Reach correction must stay small: ${maximumPawShift}`)
  moving.root.position.set(3, 0, -7)
  moving.root.rotation.y = Math.PI - .01
  moving.update(1 / 30, { speed: 6.5, time: 9 })
  moving.root.rotation.y = -Math.PI + .01
  moving.update(1 / 30, { speed: 6.5, time: 9.03 })
  moving.update(.4, { speed: 0, time: 9.43 })
  assert.ok(pose(moving).every(Number.isFinite), 'Yaw wrap and frame hitches must remain finite')
  assert.deepEqual(moving.root.position.toArray(), [3, 0, -7])
  for (let i = 0; i < 120; i++) moving.update(1 / 60, { speed: 0, clip: WOLF_CLIPS.death, t: 1, time: 10 + i / 60 })
  const dead = pose(moving)
  for (let i = 0; i < 60; i++) moving.update(1 / 60, { speed: 0, clip: WOLF_CLIPS.death, t: 1, time: 12 + i / 60 })
  assert.deepEqual(pose(moving), dead, 'Dead spine and tail must hold still')

  const frightened = await make(), calm = await make()
  for (let i = 0; i < 120; i++) {
    const state = { speed: 0, clip: WOLF_CLIPS.stagger, t: 1, time: i / 60 }
    frightened.update(1 / 60, { ...state, fear: 1 }); calm.update(1 / 60, state)
  }
  frightened.root.updateMatrixWorld(true); calm.root.updateMatrixWorld(true)
  const headDrop = world(bone(calm, 'Head')).y - world(bone(frightened, 'Head')).y
  const tailForward = world(bone(frightened, 'Tail8')).z - world(bone(calm, 'Tail8')).z
  assert.ok(headDrop > 0.10, `Cowering head must lower: ${headDrop}`)
  assert.ok(tailForward > 0.30, `Tail must curl forward under the body: ${tailForward}`)
  for (const side of ['L', 'R']) {
    const earDirection = world(bone(frightened, `Ear4.${side}`)).sub(world(bone(frightened, `Ear1.${side}`)))
    const calmEar = world(bone(calm, `Ear4.${side}`)).sub(world(bone(calm, `Ear1.${side}`)))
    const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(bone(frightened, 'Head').getWorldQuaternion(new THREE.Quaternion()))
    const calmForward = new THREE.Vector3(0, 1, 0).applyQuaternion(bone(calm, 'Head').getWorldQuaternion(new THREE.Quaternion()))
    assert.ok(earDirection.dot(forward) < calmEar.dot(calmForward) - 0.025, 'Both ears must fold toward the back of the head')
  }
  let skin
  frightened.root.traverse(o => { if (o.isSkinnedMesh) skin = o })
  skin.skeleton.update()
  let minimumSurface = Infinity
  for (let i = 0; i < skin.geometry.attributes.position.count; i++) {
    const vertex = skin.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(skin.matrixWorld)
    minimumSurface = Math.min(minimumSurface, vertex.y)
  }
  assert.ok(minimumSurface > -0.035, `Cowering tail and head must stay above ground: ${minimumSurface}`)
  for (let i = 0; i < 240; i++) {
    const state = { speed: 0, clip: WOLF_CLIPS.stagger, t: 1, time: 2 + i / 60 }
    frightened.update(1 / 60, state); calm.update(1 / 60, state)
  }
  const releaseError = Math.max(...pose(frightened).map((v, i) => Math.abs(v - pose(calm)[i])))
  assert.ok(releaseError < 0.002, `Fear must blend out on recovery: ${releaseError}`)
  let minimumDuringFear = Infinity
  let fearMinimumAt
  for (const clip of [null, WOLF_CLIPS.stagger, WOLF_CLIPS.hurt]) {
    const rig = await make()
    let mesh
    rig.root.traverse(o => { if (o.isSkinnedMesh) mesh = o })
    for (let i = 0; i < 180; i++) {
      rig.update(1 / 60, { speed: 0, clip, t: Math.min(i / 20, 1), fear: i < 120 ? 1 : 0, time: i / 60 })
      if (i % 6) continue
      rig.root.updateMatrixWorld(true); mesh.skeleton.update()
      for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex += 3) {
        const position = mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
        if (position.y < minimumDuringFear) { minimumDuringFear = position.y; fearMinimumAt = { clip: clip === null ? 'idle' : clip === WOLF_CLIPS.stagger ? 'stagger' : 'hurt', frame: i, vertex, source: mesh.geometry.attributes.position.getX(vertex) } }
      }
    }
  }
  assert.ok(minimumDuringFear > -0.035, `Fear entry and release must stay above ground: ${minimumDuringFear} ${JSON.stringify(fearMinimumAt)}`)
  const { Wolf } = await server.ssrLoadModule('/src/game/actors/enemies.ts')
  const enemyWorld = { scene: new THREE.Scene(), time: 0, sound() {}, onEnemyDeath() {},
    player: { pos: new THREE.Vector3(0, 0, 4), alive: true }, enemies: [],
    field: { isWater: () => false, resolve() {} }, vision: { sees: () => true },
    vfx: { soft: { spawn() {} }, rings: { spawn() {} } } }
  const enemy = new Wolf(enemyWorld, 0, 0)
  await enemy.rig.ready
  enemy.aggro = true; enemy.senseT = 100
  let displayedFear
  const originalUpdate = enemy.rig.update.bind(enemy.rig)
  enemy.rig.update = (dt, state) => { displayedFear = state.fear; originalUpdate(dt, state) }
  enemy.takeHit(5, 30, 0, 4, 0, false, 'melee')
  assert.equal(enemy.state, 'stagger')
  enemy.update(1 / 60)
  assert.equal(displayedFear, 1, 'Actual posture break must request the cowering pose')
  enemy.st = enemy.stagDur + .01
  enemy.update(1 / 60)
  assert.equal(enemy.state, 'chase')
  assert.equal(displayedFear, 0, 'Recovered wolf must release the cowering pose')
  enemy.takeHit(1, 0, 0, 4, 0, false, 'melee')
  assert.equal(enemy.state, 'hurt')
  enemy.update(1 / 60)
  assert.equal(displayedFear, 1, 'Ordinary hit recovery must also request fear')
  enemy.die(); enemy.update(1 / 60)
  assert.equal(displayedFear ?? 0, 0, 'Death must not inherit fear from injury')
  console.log(JSON.stringify({ passed: true, curveLeft, curveRight, curveBase, maximumPawGap, maximumPawShift,
    deathHold: true, headDrop, tailForward, minimumSurface, minimumDuringFear, releaseError, injuryPoseConnected: true }))

  if (process.argv.includes('--preview')) {
    const rig = await make()
    const all = bones(rig)
    const clips = []
    const cases = [['walk', 1.5, 0], ['run', 6.5, 0], ['turn_left', 6.5, 1.8], ['turn_right', 6.5, -1.8], ['attack', 0, 0], ['fear', 0, 0], ['fear_stagger', 0, 0]]
    for (const [name, speed, turn] of cases) {
      rig.root.rotation.y = 0; rig.gait = 0; rig.idleTime = 0
      for (let i = 0; i < 90; i++) rig.update(1 / 60, { speed, time: i / 60 })
      const positions = all.map(() => []), rotations = all.map(() => []), times = []
      for (let frame = 0; frame <= 72; frame++) {
        const t = frame / 24
        const progress = (t % 2.1) / 1.2
        const attack = name === 'attack' && progress <= 1
        rig.root.rotation.y += turn / 24
        rig.update(1 / 24, { speed, time: t,
          fear: name.startsWith('fear') ? 1 : 0,
          clip: name === 'fear_stagger' ? WOLF_CLIPS.stagger : attack ? progress <= .38 ? WOLF_CLIPS.crouch : WOLF_CLIPS.leap : null,
          t: progress <= .38 ? progress / .38 : (progress - .38) / .62 })
        times.push(t)
        all.forEach((b, i) => { positions[i].push(...b.position); rotations[i].push(...b.quaternion) })
      }
      clips.push(new THREE.AnimationClip(name, 3, all.flatMap((b, i) => [
        new THREE.VectorKeyframeTrack(`${b.uuid}.position`, times, positions[i]),
        new THREE.QuaternionKeyframeTrack(`${b.uuid}.quaternion`, times, rotations[i]),
      ])))
    }
    rig.root.rotation.y = 0
    rig.root.updateMatrixWorld(true)
    globalThis.FileReader = class {
      readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() }) }
    }
    const exported = await new GLTFExporter().parseAsync(rig.root, { binary: true, animations: clips })
    await mkdir('.cache', { recursive: true })
    await writeFile('.cache/wolf-flex-preview.glb', Buffer.from(exported))
    console.log('Native preview: .cache/wolf-flex-preview.glb')
  }
} finally {
  GLTFLoader.prototype.loadAsync = originalLoad
  await server.close()
}
