import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Humanoid } from './rig'

/**
 * Dresses a procedural Humanoid in a static GLB (image-to-3D output: one mesh, A-pose, no skeleton).
 * The rig's joints become the skeleton's bones, so every procedural clip and spring keeps working.
 * Weights come from distance to the bone segments, which is enough for an A-posed figure whose
 * arms and legs stand clear of the body.
 */

export interface SkinOptions {
  /** total height of the model in metres after scaling */
  height: number
  /** keep these procedural pieces visible (weapons, lantern, bow) */
  keep: THREE.Object3D[]
}

/** r: how thick the limb is; vertices further out prefer the torso (mantles, skirts) */
type Seg = { bone: number; a: THREE.Vector3; b: THREE.Vector3; r: number }

export async function wearGlb(rig: Humanoid, url: string, opt: SkinOptions): Promise<THREE.SkinnedMesh> {
  const gltf = await new GLTFLoader().loadAsync(url)
  let src: THREE.Mesh | null = null
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o) => {
    if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh
  })
  if (!src) throw new Error('no mesh in ' + url)
  const mesh = src as THREE.Mesh
  const geo = mesh.geometry.clone()
  geo.applyMatrix4(mesh.matrixWorld)
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const k = opt.height / (bb.max.y - bb.min.y)
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, 0)
  geo.scale(k, k, k)

  // ---- bind pose: the rig at the origin, arms raised to match the model's A-pose
  const J = rig.joints
  const root = rig.root
  const saved = { p: root.position.clone(), r: root.rotation.clone(), bp: rig.body.position.clone(), br: rig.body.rotation.clone() }
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  rig.body.position.set(0, 0, 0)
  rig.body.rotation.set(0, 0, 0)
  const names = Object.keys(J)
  for (const n of names) J[n].rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const w = (n: string) => J[n].getWorldPosition(new THREE.Vector3())
  // the hands are the outermost vertices on each side: that gives the A-pose angle
  for (const side of ['L', 'R'] as const) {
    let best = 0
    const hand = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      const x = side === 'L' ? v.x : -v.x
      if (x > best) {
        best = x
        hand.copy(v)
      }
    }
    const sh = w('sh' + side)
    const ang = Math.atan2(Math.abs(hand.x - sh.x), sh.y - hand.y)
    J['sh' + side].rotation.z = side === 'L' ? ang : -ang
  }
  root.updateMatrixWorld(true)

  // ---- bone segments in bind pose
  const bones = names.map((n) => J[n] as unknown as THREE.Bone)
  const idx = (n: string) => names.indexOf(n)
  const segs: Seg[] = []
  const limb = (bone: string) => (/^(sh|el|ha)/.test(bone) ? 0.1 : /^(th|kn|ft)/.test(bone) ? 0.15 : 1)
  const seg = (bone: string, a: THREE.Vector3, b: THREE.Vector3) => segs.push({ bone: idx(bone), a, b, r: limb(bone) })
  const up = (p: THREE.Vector3, d: number) => p.clone().add(new THREE.Vector3(0, d, 0))
  seg('hips', up(w('hips'), -0.12), w('spine'))
  seg('spine', w('spine'), w('chest'))
  seg('chest', w('chest'), w('neck'))
  seg('neck', w('neck'), w('head'))
  seg('head', w('head'), up(w('head'), 0.32))
  for (const s of ['L', 'R']) {
    seg('sh' + s, w('sh' + s), w('el' + s))
    seg('el' + s, w('el' + s), w('ha' + s))
    const ha = w('ha' + s)
    seg('ha' + s, ha, ha.clone().add(ha.clone().sub(w('el' + s)).setLength(0.14)))
    seg('th' + s, w('th' + s), w('kn' + s))
    seg('kn' + s, w('kn' + s), w('ft' + s))
    const ft = w('ft' + s)
    seg('ft' + s, ft, ft.clone().add(new THREE.Vector3(0, -0.05, 0.16)))
  }

  // ---- weights: the three nearest segments, falloff 1/d^4
  const n = pos.count
  const skinIndex = new Uint16Array(n * 4)
  const skinWeight = new Float32Array(n * 4)
  const ab = new THREE.Vector3()
  const ap = new THREE.Vector3()
  const dist = new Float32Array(segs.length)
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i)
    for (let s = 0; s < segs.length; s++) {
      const { a, b, r } = segs[s]
      ab.subVectors(b, a)
      ap.subVectors(v, a)
      const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1)
      const d = ap.sub(ab.multiplyScalar(t)).length()
      dist[s] = d + Math.max(0, d - r) * 3
    }
    const order = [...dist.keys()].sort((x, y) => dist[x] - dist[y]).slice(0, 3)
    let sum = 0
    const ws = order.map((s) => {
      const q = 1 / Math.pow(dist[s] + 0.015, 4)
      sum += q
      return q
    })
    for (let j = 0; j < 3; j++) {
      skinIndex[i * 4 + j] = segs[order[j]].bone
      skinWeight[i * 4 + j] = ws[j] / sum
    }
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4))
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))

  // a cheaper standard material with the same maps
  const sm = mesh.material as THREE.MeshStandardMaterial
  const mat = new THREE.MeshStandardMaterial({ map: sm.map, normalMap: sm.normalMap, roughnessMap: sm.roughnessMap, metalnessMap: sm.metalnessMap, roughness: 1, metalness: sm.metalnessMap ? 1 : 0, side: THREE.FrontSide })
  const skinned = new THREE.SkinnedMesh(geo, mat)
  skinned.castShadow = true
  skinned.frustumCulled = false
  root.add(skinned)
  skinned.bind(new THREE.Skeleton(bones), skinned.matrixWorld)
  rig.flashMats.push(mat)

  // hide the procedural body, keep the props
  const keep = new Set<THREE.Object3D>()
  for (const k of opt.keep) k.traverse((o) => keep.add(o))
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== skinned && !keep.has(o)) o.visible = false
  })

  for (const nm of names) J[nm].rotation.set(0, 0, 0)
  root.position.copy(saved.p)
  root.rotation.copy(saved.r)
  rig.body.position.copy(saved.bp)
  rig.body.rotation.copy(saved.br)
  root.updateMatrixWorld(true)
  return skinned
}
