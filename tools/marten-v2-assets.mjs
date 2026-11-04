// Bake the same V2 rig used by the interactive comparison, with its own skin.
import { writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { cloneDocument, copyToDocument, dedup, prune, resample } from '@gltf-transform/functions'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const original = await io.read('public/models/marten.glb')
const bare = cloneDocument(original)
for (const t of bare.getRoot().listTextures()) t.dispose()
const bytes = await io.writeBinary(bare)
const source = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
const originalLoad = GLTFLoader.prototype.loadAsync
GLTFLoader.prototype.loadAsync = async () => source
const server = await createServer({ configFile: false, cacheDir: '.cache/marten-v2-vite', optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
try {
  const { loadMartenV2 } = await server.ssrLoadModule('/src/game/actors/martenRig.ts')
  const body = await loadMartenV2()
  // Exercise the actual gameplay actor, not just the model preview.
  const { Marten } = await server.ssrLoadModule('/src/game/actors/marten.ts')
  const world = {
    scene: new THREE.Scene(), time: 0, enemies: [],
    player: { pos: new THREE.Vector3(), speedNow: 0, facing: 0, gaze: 0 },
    field: { isWater: () => false, resolve() {}, clearance: () => 100 },
    sound() {}, vfx: { add: { spawn() {} } },
  }
  const companion = new Marten(world, new THREE.Vector3(3.9, 0, 0))
  assert.equal(await companion.ready, true, 'Gameplay must load the current marten')
  const skins = []
  companion.rig.root.traverse(o => { if (o.isMesh) skins.push(o) })
  assert.equal(skins.length, 1, 'No old procedural fallback body may remain')
  assert.equal(skins[0].skeleton.bones.length, 45, 'Gameplay must use the accepted rig')
  let displayedPose
  const animate = companion.body.animator.update.bind(companion.body.animator)
  companion.body.animator.update = (dt, input) => { displayedPose = input.pose; animate(dt, input) }
  const tick = () => { world.time += 1 / 60; companion.update(1 / 60) }
  tick(); assert.equal(displayedPose, 'trapped')
  companion.free(); tick(); assert.equal(companion.state, 'freed')
  companion.st = 1.1; tick(); assert.equal(displayedPose, 'sit')
  companion.state = 'follow'; companion.pos.set(3.9, 0, 0)
  companion.goal.copy(companion.pos); companion.wanderT = 100
  for (let i = 0; i < 600; i++) tick()
  assert.equal(displayedPose, 'curl', 'A calm waiting companion must curl up')
  world.player.speedNow = 2
  tick(); assert.equal(displayedPose, 'stand', 'Movement must wake the companion')
  for (let i = 0; i < 90; i++) tick()
  assert.ok(companion.speedNow > 0, 'Companion must resume following after waking')
  const bodyWorld = companion.body.root.getWorldPosition(new THREE.Vector3())
  assert.ok(bodyWorld.distanceTo(companion.pos) < 1e-6, 'Actor translation must be applied exactly once')
  companion.combat = true
  world.enemies = [{ alive: true, removed: false, visibleNow: true, pos: new THREE.Vector3(0, 0, -2) }]
  companion.pos.set(0, 0, 9); tick(); assert.equal(displayedPose, 'crouch')
  companion.combat = false; world.enemies = []; companion.hideT = 0; companion.state = 'follow'
  companion.clue = new THREE.Vector3(4, 0, 0); companion.pos.set(4.6, 0, 0.4)
  tick(); assert.equal(displayedPose, 'sniff')
  world.scene.clear()
  const clips = []
  const cases = [
    ['idle', 'stand', 0, 0, 4], ['walk', 'stand', 1.3, 0, 4],
    ['trot', 'stand', 3, 0, 4], ['bound', 'stand', 6.5, 0, 4],
    ['turn_left', 'stand', 2, 1.6, 4], ['turn_right', 'stand', 2, -1.6, 4],
    ['sit', 'sit', 0, 0, 4], ['alert', 'alert', 0, 0, 4], ['sniff', 'sniff', 0, 0, 4],
    ['crouch', 'crouch', 0, 0, 4], ['trapped', 'trapped', 0, 0, 4],
    ['sleep_curled', 'curl', 0, 0, 4], ['curl_enter', 'curl', 0, 0, 6], ['curl_exit', 'stand', 0, 0, 6],
  ]
  const report = { bones: body.bones.length, vertices: body.mesh.geometry.attributes.position.count, clips: [], minY: {}, contact: null, maximumWeightError: 0, maximumLegLengthError: 0, maximumFrameAngle: 0, maximumGaitRollError: 0, maximumElbowForward: -Infinity, minimumForearmAlignment: 1 }
  const weights = body.mesh.geometry.attributes.skinWeight
  report.minimumAirborneExtension = 1
  report.minimumFlightRise = Infinity
  const restLengths = new Map()
  for (const id of ['FL', 'FR', 'HL', 'HR']) {
    const names = id[0] === 'F' ? ['shoulder', 'elbow', 'wrist', 'paw'] : ['thigh', 'knee', 'hock', 'paw']
    for (let i = 0; i < 3; i++) {
      const a = body.bones.find(b => b.name === names[i] + id + '_v2')
      const b = body.bones.find(b => b.name === names[i + 1] + id + '_v2')
      restLengths.set(`${id}:${i}`, a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())))
    }
  }
  for (let i = 0; i < weights.count; i++) {
    const sum = [0, 1, 2, 3].reduce((s, k) => s + weights.getComponent(i, k), 0)
    report.maximumWeightError = Math.max(report.maximumWeightError, Math.abs(sum - 1))
  }
  assert.ok(report.maximumWeightError < 1e-5, 'Every vertex must have normalized weights')
  const positionAttribute = body.mesh.geometry.attributes.position
  const checkY = () => {
    body.root.updateMatrixWorld(true); body.mesh.skeleton.update()
    let min = Infinity
    for (let i = 0; i < positionAttribute.count; i += 3) {
      const p = new THREE.Vector3().fromBufferAttribute(positionAttribute, i)
      body.mesh.applyBoneTransform(i, p)
      min = Math.min(min, p.y)
    }
    return min
  }
  for (const [name, pose, speed, turnRate, duration] of cases) {
    body.animator.snap(name === 'curl_exit' || name === 'sleep_curled' ? 'curl' : 'stand')
    if (!name.startsWith('curl_')) for (let i = 0; i < 240; i++) body.animator.update(1 / 60, { speed, turnRate, pose, look: null, time: i / 60, warn: false })
    const times = [], positions = body.bones.map(() => []), rotations = body.bones.map(() => [])
    let minY = Infinity
    let previous = null
    for (let f = 0; f <= duration * 24; f++) {
      const t = f / 24
      body.animator.update(1 / 24, { speed, turnRate, pose, look: null, time: t, warn: false })
      times.push(t)
      body.bones.forEach((b, i) => { positions[i].push(...b.position); rotations[i].push(...b.quaternion) })
      assert.ok(body.bones.every(b => [...b.position, ...b.quaternion].every(Number.isFinite)), `${name}: finite pose`)
      if (previous && name.startsWith('curl_')) body.bones.forEach((b, i) => {
        const angle = b.getWorldQuaternion(new THREE.Quaternion()).angleTo(previous[i])
        if (angle > report.maximumFrameAngle) {
          report.maximumFrameAngle = angle
          report.maximumFrameAngleAt = { name, frame: f, bone: b.name }
        }
      })
      previous = body.bones.map(b => b.getWorldQuaternion(new THREE.Quaternion()))
      if (['walk', 'trot', 'bound', 'turn_left', 'turn_right'].includes(name)) {
        for (const bone of body.bones.filter(b => name !== 'bound' && /^(thigh|knee|hock|pawH)/.test(b.name))) {
          const guide = body.animator.driver.bones.find(b => b.name === bone.name.replace('_v2', ''))
          const error = bone.getWorldQuaternion(new THREE.Quaternion()).angleTo(guide.getWorldQuaternion(new THREE.Quaternion()))
          report.maximumGaitRollError = Math.max(report.maximumGaitRollError, error)
        }
        if (name === 'bound') {
          const phase = body.animator.driver.animator.gaitPhase
          for (const id of ['HL', 'HR']) {
            const lp = (phase + (id === 'HR' ? 0.06 : 0)) % 1
            if (lp > 0.30 && lp < 0.44) {
              const hip = body.bones.find(b => b.name === 'thigh' + id + '_v2').getWorldPosition(new THREE.Vector3())
              const hock = body.bones.find(b => b.name === 'hock' + id + '_v2').getWorldPosition(new THREE.Vector3())
              report.minimumAirborneExtension = Math.min(report.minimumAirborneExtension,
                hip.distanceTo(hock) / (restLengths.get(`${id}:0`) + restLengths.get(`${id}:1`)))
            }
          }
          if (phase > 0.34 && phase < 0.42) {
            if (report.extensionPreviewFrame === undefined) report.extensionPreviewFrame = f
            const pelvis = body.bones.find(b => b.name === 'pelvis_v2').getWorldPosition(new THREE.Vector3())
            const guide = body.animator.driver.bones.find(b => b.name === 'hips').getWorldPosition(new THREE.Vector3())
            report.minimumFlightRise = Math.min(report.minimumFlightRise, pelvis.y - guide.y)
          }
        }
        const chestQ = body.animator.driver.bones.find(b => b.name === 'chest').getWorldQuaternion(new THREE.Quaternion())
        for (const id of ['FL', 'FR']) {
          const find = name => body.bones.find(b => b.name === name + id + '_v2')
          const shoulder = find('shoulder').getWorldPosition(new THREE.Vector3())
          const elbow = find('elbow').getWorldPosition(new THREE.Vector3())
          const wrist = find('wrist').getWorldPosition(new THREE.Vector3())
          const upper = elbow.clone().sub(shoulder).applyQuaternion(chestQ.clone().invert())
          report.maximumElbowForward = Math.max(report.maximumElbowForward, upper.z)
          const restElbow = new THREE.Vector3().setFromMatrixPosition(body.mesh.skeleton.boneInverses[body.bones.indexOf(find('elbow'))].clone().invert())
          const restWrist = new THREE.Vector3().setFromMatrixPosition(body.mesh.skeleton.boneInverses[body.bones.indexOf(find('wrist'))].clone().invert())
          const boneDirection = restWrist.sub(restElbow).normalize().applyQuaternion(find('elbow').getWorldQuaternion(new THREE.Quaternion()))
          report.minimumForearmAlignment = Math.min(report.minimumForearmAlignment, boneDirection.dot(wrist.sub(elbow).normalize()))
        }
      }
      for (const id of ['FL', 'FR', 'HL', 'HR']) {
        const n = id[0] === 'F' ? ['shoulder', 'elbow', 'wrist', 'paw'] : ['thigh', 'knee', 'hock', 'paw']
        const chain = n.map(s => body.bones.find(b => b.name === s + id + '_v2'))
        for (let i = 0; i < 3; i++) {
          const originalLength = restLengths.get(`${id}:${i}`)
          const length = chain[i].getWorldPosition(new THREE.Vector3()).distanceTo(chain[i + 1].getWorldPosition(new THREE.Vector3()))
          report.maximumLegLengthError = Math.max(report.maximumLegLengthError, Math.abs(length - originalLength))
        }
      }
      if (f % 12 === 0) minY = Math.min(minY, checkY())
    }
    const tracks = body.bones.flatMap((b, i) => [
      new THREE.VectorKeyframeTrack(`${b.uuid}.position`, times, positions[i]),
      new THREE.QuaternionKeyframeTrack(`${b.uuid}.quaternion`, times, rotations[i]),
    ])
    clips.push(new THREE.AnimationClip(name, duration, tracks))
    report.clips.push(name); report.minY[name] = minY
    if (name === 'sleep_curled') report.contact = { head: body.animator.contact.head.toArray(), tail: body.animator.contact.tail.toArray() }
  }
  assert.ok(Math.min(...Object.values(report.minY)) > -0.005, 'The skin must stay above the ground')
  assert.ok(report.maximumLegLengthError < 0.001, `Leg lengths must stay constant: ${report.maximumLegLengthError}`)
  assert.ok(report.maximumGaitRollError < 1e-5, `Gaits must preserve anatomical IK and axial roll: ${report.maximumGaitRollError}`)
  assert.ok(report.minimumAirborneExtension > 0.98, `Hind legs must extend after push-off: ${report.minimumAirborneExtension}`)
  assert.ok(report.minimumFlightRise > 0.025, `The flight arc must lift the body: ${report.minimumFlightRise}`)
  assert.ok(report.maximumElbowForward < -0.025, `The elbow must remain behind the shoulder: ${report.maximumElbowForward}`)
  assert.ok(report.minimumForearmAlignment > 0.99999, 'The visible forearm must be one rigid bone meeting the wrist')
  assert.ok(report.maximumFrameAngle < 0.8, `No sharp rotations during curl transitions: ${report.maximumFrameAngle} ${JSON.stringify(report.maximumFrameAngleAt)}`)
  // World placement and a long frame must not corrupt the model-local solver.
  body.root.position.set(3, 0, -7); body.root.rotation.y = Math.PI - 0.01
  body.animator.update(0.4, { speed: 3, turnRate: -2, pose: 'stand', look: new THREE.Vector3(2, 1, -6), time: 10, warn: false })
  assert.deepEqual(body.root.position.toArray(), [3, 0, -7])
  assert.ok(body.bones.every(b => [...b.position, ...b.quaternion].every(Number.isFinite)))
  body.root.position.set(0, 0, 0); body.root.rotation.y = 0
  // Bind/rest transform is exported at rest, never at the last animation sample.
  body.animator.restoreBindPose()
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() }) }
  }
  const output = await new GLTFExporter().parseAsync(body.root, { binary: true, animations: clips })
  const doc = await io.readBinary(new Uint8Array(output))
  const sourceMaterial = original.getRoot().listMaterials()[0]
  const material = copyToDocument(doc, original, [sourceMaterial]).get(sourceMaterial)
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setMaterial(material)
  await doc.transform(dedup(), prune(), resample())
  await mkdir('assets-src/marten-v2', { recursive: true })
  await io.write('public/models/marten_v2_rig.glb', doc)
  await writeFile('assets-src/marten-v2/qa.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  GLTFLoader.prototype.loadAsync = originalLoad
  await server.close()
}
