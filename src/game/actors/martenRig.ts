import * as THREE from 'three'
import { loadMarten as loadAnatomy, type MartenBody as AnatomyBody, type MartenInput as AnatomyInput, type MartenPose as AnatomyPose } from './martenAnatomy'

// The canonical companion rig, shared by gameplay, preview and asset export.
export type MartenPoseV2 = AnatomyPose | 'curl'
export type MartenInputV2 = Omit<AnatomyInput, 'pose'> & { pose: MartenPoseV2 }
type V = THREE.Vector3
const Y = new THREE.Vector3(0, 1, 0)
const ids = ['FL', 'FR', 'HL', 'HR'] as const
const smooth = (a: number, b: number, n: number) => THREE.MathUtils.smoothstep(n, a, b)
const lerp = THREE.MathUtils.lerp
const curve = (p: V[]) => new THREE.CatmullRomCurve3(p, false, 'centripetal')
const point = (c: THREE.CatmullRomCurve3, t: number) => c.getPoint(THREE.MathUtils.clamp(t, 0, 1))
const world = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3())

interface Joint {
  bone: THREE.Bone
  rest: V
  end: V
  group: 'body' | 'tail' | 'leg'
  t: number
}

export interface MartenBodyV2 {
  root: THREE.Group
  mesh: THREE.SkinnedMesh
  bones: THREE.Bone[]
  animator: MartenAnimatorV2
  rim: AnatomyBody['rim']
}

export async function loadMartenV2(url = '/models/marten.glb'): Promise<MartenBodyV2> {
  return buildMartenV2(await loadAnatomy(url))
}

export function buildMartenV2(driver: AnatomyBody): MartenBodyV2 {
  driver.root.updateMatrixWorld(true)
  const old = new Map(driver.bones.map(b => [b.name, b]))
  const get = (name: string) => old.get(name)!
  const axisNames = ['hips', 'spine1', 'spine2', 'spine3', 'chest', 'neck1', 'neck2', 'head']
  const axisRest = axisNames.map(n => world(get(n)))
  const spineCurve = curve(axisRest.slice(0, 5))
  const neckCurve = curve(axisRest.slice(4))
  const oldTail = Array.from({ length: 8 }, (_, i) => world(get(`tail${i}`)))
  const last = oldTail[7].clone().sub(oldTail[6])
  const tailCurve = curve([...oldTail, oldTail[7].clone().add(last)])
  const root = new THREE.Group()
  root.name = 'Susar_V2'
  const joints: Joint[] = []
  const add = (name: string, rest: V, end: V, parent: THREE.Object3D, group: Joint['group'], t = 0) => {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.copy(rest).sub(parent instanceof THREE.Bone ? joints.find(j => j.bone === parent)!.rest : new THREE.Vector3())
    parent.add(bone)
    const j = { bone, rest, end, group, t }
    joints.push(j)
    return j
  }
  const spine: Joint[] = []
  for (let i = 0; i <= 7; i++) {
    const t = i / 7
    spine.push(add(i === 0 ? 'pelvis_v2' : i === 7 ? 'chest_v2' : `spine_v2_${i}`,
      point(spineCurve, t), i === 7 ? point(neckCurve, 1 / 3) : point(spineCurve, (i + 1) / 7),
      i ? spine[i - 1].bone : root, 'body', t * 4 / 7))
  }
  const neck: Joint[] = []
  for (let i = 1; i <= 3; i++) {
    const t = i / 3
    neck.push(add(i === 3 ? 'head_v2' : `neck_v2_${i}`, point(neckCurve, t),
      i === 3 ? point(neckCurve, 1).add(new THREE.Vector3(0, 0, 0.08)) : point(neckCurve, (i + 1) / 3),
      i === 1 ? spine[7].bone : neck[i - 2].bone, 'body', (4 + t * 3) / 7))
  }
  // The model has a long rump behind the hip joint. It must bend too; treating
  // that whole volume as one pelvis produces a corner when she curls up.
  const rump: Joint[] = []
  for (let i = 1; i <= 2; i++) {
    const p = axisRest[0].clone().lerp(oldTail[0], i / 2)
    const end = i === 2 ? point(tailCurve, 1 / 16) : oldTail[0].clone()
    rump.push(add(`rump_v2_${i}`, p, end, i === 1 ? spine[0].bone : rump[0].bone, 'body'))
  }
  const tail: Joint[] = []
  for (let i = 0; i < 16; i++) tail.push(add(`tail_v2_${String(i).padStart(2, '0')}`,
    point(tailCurve, i / 16), point(tailCurve, (i + 1) / 16), i ? tail[i - 1].bone : rump[1].bone, 'tail', i / 16))
  const legs: Record<string, Joint[]> = {}
  for (const id of ids) {
    const names = id[0] === 'F' ? ['shoulder', 'elbow', 'wrist', 'paw'] : ['thigh', 'knee', 'hock', 'paw']
    const positions = names.map(name => world(get(name + id)))
    if (id[0] === 'F') {
      // The elbow belongs inside the chest silhouette. The visible foreleg
      // below it is one long radius/ulna segment, not a mid-shin joint.
      positions[1].copy(positions[0]).add(new THREE.Vector3(
        positions[1].x - positions[0].x, -0.033, -0.043))
    }
    legs[id] = []
    names.forEach((name, i) => {
      const rest = positions[i]
      const end = i < 3 ? positions[i + 1].clone() : rest.clone().add(new THREE.Vector3(0, 0, 0.04))
      legs[id].push(add(`${name}${id}_v2`, rest, end,
        i ? legs[id][i - 1].bone : spine[id[0] === 'F' ? 7 : 0].bone, 'leg'))
    })
  }
  const geo = driver.mesh.geometry.clone()
  const pos = geo.getAttribute('position')
  const oldI = geo.getAttribute('skinIndex'), oldW = geo.getAttribute('skinWeight')
  const si = new Uint16Array(pos.count * 4), sw = new Float32Array(pos.count * 4)
  const body = [...rump].reverse().concat(spine, neck)
  const boneIndex = new Map(joints.map((j, i) => [j.bone.name, i]))
  // Preserve V1's topology-based isolation of each leg. Redistribute only the
  // axial contribution with smooth longitudinal weights on the denser chains.
  const axial = (list: Joint[], z: number, amount: number, out: Map<number, number>) => {
    const backwards = list[0].rest.z > list[list.length - 1].rest.z
    const zz = backwards ? -z : z
    let i = 0
    while (i < list.length - 2 && (backwards ? -list[i + 1].rest.z : list[i + 1].rest.z) < zz) i++
    const a = backwards ? -list[i].rest.z : list[i].rest.z
    const b = backwards ? -list[i + 1].rest.z : list[i + 1].rest.z
    const t = THREE.MathUtils.clamp((zz - a) / Math.max(1e-6, b - a), 0, 1)
    for (const [j, w] of [[list[i], 1 - t], [list[i + 1], t]] as const) {
      const index = boneIndex.get(j.bone.name)!
      out.set(index, (out.get(index) ?? 0) + w * amount)
    }
  }
  for (let i = 0; i < pos.count; i++) {
    const weights = new Map<number, number>()
    const frontWeights: Record<string, number> = {}
    let bodyW = 0, tailW = 0
    for (let k = 0; k < 4; k++) {
      const w = oldW.getComponent(i, k)
      const name = driver.bones[oldI.getComponent(i, k)].name
      if (name.startsWith('tail')) tailW += w
      else if (axisNames.includes(name)) bodyW += w
      else {
        const id = name.slice(-2)
        if (id[0] === 'F') frontWeights[id] = (frontWeights[id] ?? 0) + w
        else {
          const n = boneIndex.get(name + '_v2')!
          weights.set(n, (weights.get(n) ?? 0) + w)
        }
      }
    }
    // Rebind each isolated foreleg to the corrected joints. Keep the original
    // left/right masks; proximity alone must not bind a paw to its neighbour.
    for (const [id, amount] of Object.entries(frontWeights)) {
      const vertex = new THREE.Vector3().fromBufferAttribute(pos, i)
      const chain = legs[id]
      const distances = chain.map(j => {
        const segment = j.end.clone().sub(j.rest)
        const u = THREE.MathUtils.clamp(vertex.clone().sub(j.rest).dot(segment) / segment.lengthSq(), 0, 1)
        const distance = vertex.distanceTo(j.rest.clone().addScaledVector(segment, u))
        return 1 / Math.pow(distance + 0.008, 4)
      })
      const sum = distances.reduce((a, b) => a + b, 0)
      chain.forEach((j, k) => weights.set(boneIndex.get(j.bone.name)!, amount * distances[k] / sum))
    }
    axial(body, pos.getZ(i), bodyW, weights)
    axial(tail, pos.getZ(i), tailW, weights)
    const top = [...weights].filter(([, w]) => w > 1e-8).sort((a, b) => b[1] - a[1]).slice(0, 4)
    const total = top.reduce((s, [, w]) => s + w, 0)
    top.forEach(([b, w], k) => { si[i * 4 + k] = b; sw[i * 4 + k] = w / total })
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4))
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))
  const mesh = new THREE.SkinnedMesh(geo, driver.mesh.material)
  mesh.name = 'Susar_V2_Skin'
  mesh.frustumCulled = false
  mesh.castShadow = true
  root.add(mesh)
  root.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(joints.map(j => j.bone)))
  const animator = new MartenAnimatorV2(driver, root, mesh, joints, spine, neck, rump, tail, legs, axisRest)
  return { root, mesh, animator, bones: joints.map(j => j.bone), rim: driver.rim }
}

export class MartenAnimatorV2 {
  private curl = 0
  private tailAngles = new Float64Array(16)
  private elapsed = 0
  private turn = 0
  private restQ = new THREE.Quaternion()
  private length: number
  private tailLength: number
  private rumpLength: number
  private neckLength: number
  private baseBones: Map<string, THREE.Bone>
  private floorVertices: number[] = []
  private clearance = 0
  private legNormals = new Map<string, V>()
  private legDirections = new Map<string, V>()
  private wristFrames = new Map<string, THREE.Quaternion>()
  private frontGuides = new Map<string, THREE.Object3D[]>()
  private hindGuides = new Map<string, THREE.Object3D[]>()
  // Accessible to export/QA, in the model's local coordinates.
  readonly contact = { head: new THREE.Vector3(), tail: new THREE.Vector3() }

  constructor(private driver: AnatomyBody, readonly root: THREE.Group, readonly mesh: THREE.SkinnedMesh,
    private joints: Joint[], private spine: Joint[], private neck: Joint[], private rump: Joint[], private tail: Joint[],
    private legs: Record<string, Joint[]>, private axisRest: V[]) {
    this.length = curve(axisRest.slice(0, 5)).getLength()
    this.rumpLength = axisRest[0].distanceTo(rump[1].rest)
    this.neckLength = curve(axisRest.slice(4)).getLength()
    this.tailLength = tail.reduce((n, j) => n + j.rest.distanceTo(j.end), 0)
    this.baseBones = new Map(driver.bones.map(b => [b.name, b]))
    const positions = mesh.geometry.getAttribute('position')
    const indices = mesh.geometry.getAttribute('skinIndex')
    const weights = mesh.geometry.getAttribute('skinWeight')
    const extremes = new Map<string, [number, number]>()
    const directions: V[] = []
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++)
      if (x || y || z) directions.push(new THREE.Vector3(x, y, z))
    const p = new THREE.Vector3()
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i)
      for (let k = 0; k < 4; k++) if (weights.getComponent(i, k) > 0.15) {
        const b = indices.getComponent(i, k)
        directions.forEach((d, n) => {
          const key = `${b}:${n}`, value = p.dot(d)
          if (value > (extremes.get(key)?.[0] ?? -Infinity)) extremes.set(key, [value, i])
        })
      }
    }
    this.floorVertices = [...new Set([...extremes.values()].map(([, i]) => i))]
  }

  snap(pose: MartenPoseV2) {
    this.curl = pose === 'curl' ? 1 : 0
    this.driver.animator.snap(pose === 'curl' ? 'crouch' : pose)
    this.tailAngles.fill(0)
    this.clearance = 0
    this.legNormals.clear()
    this.legDirections.clear()
    this.wristFrames.clear()
    this.update(1 / 120, { speed: 0, turnRate: 0, pose, look: null, time: this.elapsed, warn: false })
  }

  /** Export the original bind transform, independent of the sampled action. */
  restoreBindPose() {
    for (const j of this.joints) {
      const parent = this.joints.find(p => p.bone === j.bone.parent)
      j.bone.position.copy(j.rest).sub(parent?.rest ?? new THREE.Vector3())
      j.bone.quaternion.identity()
    }
    this.root.updateMatrixWorld(true)
  }

  private place(j: Joint, p: V, q: THREE.Quaternion) {
    const parent = j.bone.parent!
    parent.updateWorldMatrix(true, false)
    // p/q are model-local, independent of the actor's world transform.
    j.bone.position.copy(parent.worldToLocal(this.root.localToWorld(p.clone())))
    const pq = parent.getWorldQuaternion(new THREE.Quaternion())
    j.bone.quaternion.copy(pq.invert().multiply(this.root.getWorldQuaternion(new THREE.Quaternion())).multiply(q))
    j.bone.updateMatrixWorld(true)
  }

  private orient(j: Joint, tangent: V, guide = this.restQ): THREE.Quaternion {
    // An explicit up frame avoids the 180-degree twist of shortest-arc
    // quaternions as a curled spine/tail turns back against its rest direction.
    const frame = (forward: V, up: V) => {
      const z = forward.clone().normalize()
      let x = up.clone().cross(z)
      if (x.lengthSq() < 1e-8) x = new THREE.Vector3(1, 0, 0).cross(z)
      x.normalize()
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, z.clone().cross(x).normalize(), z))
    }
    const rest = frame(j.end.clone().sub(j.rest), Y)
    return frame(tangent, Y.clone().applyQuaternion(guide)).multiply(rest.invert())
  }

  update(dt: number, input: MartenInputV2) {
    if (!(dt > 0)) return
    // Bounded integration makes a paused tab and a slow frame safe.
    const steps = Math.max(1, Math.ceil(Math.min(dt, 0.25) / (1 / 120)))
    const h = Math.min(dt, 0.25) / steps
    for (let s = 0; s < steps; s++) {
      this.elapsed = input.time - (steps - 1 - s) * h
      this.curl = lerp(this.curl, input.pose === 'curl' ? 1 : 0, 1 - Math.exp(-h * 1.55))
      this.turn = lerp(this.turn, THREE.MathUtils.clamp(input.turnRate, -4, 4), 1 - Math.exp(-h * 5))
      const localLook = input.look ? this.root.worldToLocal(input.look.clone()) : null
      this.driver.animator.update(h, { ...input, pose: input.pose === 'curl' ? 'crouch' : input.pose,
        speed: input.speed * (1 - this.curl), look: localLook, time: this.elapsed })
      this.solve(h, input)
    }
  }

  private solve(dt: number, input: MartenInputV2) {
    const c = smooth(0.015, 0.985, this.curl)
    const bodyCurl = smooth(0, 0.88, c)
    const tailCurl = smooth(0.12, 0.98, c)
    const t = this.elapsed
    const base = (name: string) => this.baseBones.get(name)!
    const live = ['hips', 'spine1', 'spine2', 'spine3', 'chest', 'neck1', 'neck2', 'head'].map(n => world(base(n)))
    const liveSpine = curve(live.slice(0, 5)), liveNeck = curve(live.slice(4))
    const body = [...this.spine, ...this.neck]
    const totalLength = this.rumpLength + this.length + this.neckLength
    const radius = totalLength / 4.0
    const bellyHeight = 0.095
    const bodyArc = (fraction: number): V => {
      const a = -Math.PI / 2 + fraction * 4.0
      return new THREE.Vector3(Math.cos(a) * radius, bellyHeight + 0.009 * Math.sin(fraction * Math.PI)
        + 0.04 * smooth((this.rumpLength + this.length) / totalLength, 1, fraction)
        + Math.sin(t * 1.55) * 0.0015, Math.sin(a) * radius)
    }
    const positions: V[] = []
    const rotations: THREE.Quaternion[] = []
    for (let i = 0; i < body.length; i++) {
      const j = body[i]
      const onSpine = i < this.spine.length
      const u = onSpine ? i / 7 : (i - 7) / 3
      const source = onSpine ? liveSpine : liveNeck
      const arcFraction = (this.rumpLength + (onSpine ? u * this.length : this.length + u * this.neckLength)) / totalLength
      const p = point(source, u)
      // Gentle travelling lateral wave, additional to the IK guide's turns.
      const wave = Math.sin(t * 3.1 - j.t * 3.3) * 0.004 * smooth(0.1, 1.5, input.speed)
      p.x += Math.sin(j.t * Math.PI) * (wave + this.turn * 0.006)
      const cp = bodyArc(arcFraction)
      p.lerp(cp, bodyCurl)
      const guide = (onSpine ? base(['hips', 'spine1', 'spine2', 'spine3', 'chest'][Math.min(4, Math.round(u * 4))])
        : base(['chest', 'neck1', 'neck2', 'head'][Math.min(3, Math.round(u * 3))])).getWorldQuaternion(new THREE.Quaternion())
      const nextFraction = i < body.length - 1
        ? (this.rumpLength + (i < 7 ? (i + 1) / 7 * this.length : this.length + (i - 6) / 3 * this.neckLength)) / totalLength
        : arcFraction + 0.025
      const sourceNext = i < 7 ? point(liveSpine, (i + 1) / 7)
        : i < body.length - 1 ? point(liveNeck, (i - 6) / 3)
        : point(liveNeck, 1).add(new THREE.Vector3(0, 0, 0.08).applyQuaternion(guide))
      const tangent = sourceNext.sub(point(source, u))
      const q = this.orient(j, tangent, guide)
      const curlTangent = bodyArc(nextFraction).sub(cp).normalize()
      // A sleeping cat lies on its flank: the back faces outside the ring,
      // rather than leaving an upright animal bent into a horizontal doughnut.
      const outward = bodyArc(arcFraction).setY(0).normalize()
      const roll = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(Y, outward), onSpine ? 1 : 1 - u)
      const curlQ = this.orient(j, curlTangent, roll)
      if (i === body.length - 1) {
        // The muzzle rests on the tail, facing gently into the centre of the ring.
        curlTangent.y = -0.12
        curlTangent.normalize()
        curlQ.copy(this.orient(j, curlTangent))
      }
      // Bend first, then roll onto the flank. A single 3D shortest-path slerp
      // changes sides when the combined bend and roll passes 180 degrees.
      const flatCurl = this.orient(j, curlTangent)
      q.slerp(flatCurl, bodyCurl)
      q.multiply(new THREE.Quaternion().slerp(flatCurl.clone().invert().multiply(curlQ), bodyCurl))
      // Blend rotations and follow them with fixed segment lengths. Blending
      // straight and circular vertex positions would collapse the spine halfway.
      if (i) p.copy(positions[i - 1]).add(j.rest.clone().sub(body[i - 1].rest).applyQuaternion(rotations[i - 1]))
      positions.push(p)
      rotations.push(q)
      this.place(j, p, q)
    }
    this.contact.head.copy(positions[positions.length - 1])

    const liveRumpStart = world(base('tail0'))
    for (let i = 0; i < this.rump.length; i++) {
      const j = this.rump[i]
      const u = (i + 1) / 2
      const fraction = this.rumpLength * (1 - u) / totalLength
      const parentPosition = i ? this.root.worldToLocal(world(this.rump[i - 1].bone)) : positions[0]
      const parentRest = i ? this.rump[i - 1].rest : this.spine[0].rest
      const p = live[0].clone().lerp(liveRumpStart, u).lerp(bodyArc(fraction), bodyCurl)
      p.sub(parentPosition).setLength(j.rest.distanceTo(parentRest)).add(parentPosition)
      const guide = base('hips').getWorldQuaternion(new THREE.Quaternion())
      const rumpRoll = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(Y, bodyArc(fraction).setY(0).normalize()), 1 - u)
      const cq = this.orient(j, bodyArc(fraction - 0.002).sub(bodyArc(fraction)), rumpRoll)
      this.place(j, p, guide.slerp(cq, bodyCurl))
    }

    for (const id of ids) {
      const chain = this.legs[id]
      const front = id[0] === 'F'
      const original = chain.map(j => base(j.bone.name.replace('_v2', '')))
      const names = front ? this.frontGuide(id, chain, original) : this.hindGuide(id, chain, original, 1 - bodyCurl)
      // The guide already solves anatomical IK, wrist limits and the nearly
      // straight reach in a bound. Solving it again changed the bend plane,
      // twisted the hind skin and reintroduced a 97% elbow kink in flight.
      if (bodyCurl === 0) {
        chain.forEach((j, i) => this.place(j, world(names[i]), names[i].getWorldQuaternion(new THREE.Quaternion())))
        this.legNormals.delete(id)
        this.legDirections.delete(id)
        this.wristFrames.delete(id)
        continue
      }
      const attachIndex = front ? 7 : 0
      const attach = positions[attachIndex]
      const aq = rotations[attachIndex]
      const originalAttach = this.spine[attachIndex].rest
      const targets = chain.map(j => j.rest.clone().sub(originalAttach).applyQuaternion(aq).add(attach))
      const upper = targets[0]
      const inward = attach.clone().setY(0).normalize().negate()
      let paw = attach.clone().addScaledVector(inward, front ? 0.045 : 0.09)
      paw.y = 0.045
      paw.z += front ? -0.015 : 0.02
      const low = paw.clone().add(new THREE.Vector3(0, 0.022, front ? -0.012 : 0.02))
      const l1 = chain[0].rest.distanceTo(chain[1].rest)
      const l2 = chain[1].rest.distanceTo(chain[2].rest)
      const reach = low.clone().sub(upper)
      reach.setLength(THREE.MathUtils.clamp(reach.length(), Math.abs(l1 - l2) + 0.004, (l1 + l2) * 0.95))
      low.copy(upper).add(reach)
      paw = low.clone().add(new THREE.Vector3(0, -chain[2].rest.distanceTo(chain[3].rest), 0))
      const pole = inward.clone().negate().add(new THREE.Vector3(0, -0.3, front ? -0.5 : 0.5))
      const mid = twoBone(upper, low, l1, l2, pole)
      const curlPositions = [upper, mid, low, paw]
      const mixed = names.map((b, i) => world(b).lerp(curlPositions[i], bodyCurl))
      const direction = mixed[2].clone().sub(mixed[0])
      direction.setLength(THREE.MathUtils.clamp(direction.length(), Math.abs(l1 - l2) + 0.004, (l1 + l2) * lerp(0.999999, 0.97, bodyCurl)))
      mixed[2].copy(mixed[0]).add(direction)
      const restNormal = chain[1].rest.clone().sub(chain[0].rest).cross(chain[2].rest.clone().sub(chain[1].rest)).normalize()
      const liveNormal = world(names[1]).sub(world(names[0])).cross(world(names[2]).sub(world(names[1]))).normalize()
      const wantedNormal = restNormal.clone().applyQuaternion(aq)
      const normalDelta = new THREE.Quaternion().setFromUnitVectors(liveNormal, wantedNormal)
      const normal = liveNormal.applyQuaternion(new THREE.Quaternion().slerp(normalDelta, bodyCurl))
      const reachDirection = direction.clone().normalize()
      normal.addScaledVector(reachDirection, -normal.dot(reachDirection))
      const previousNormal = this.legNormals.get(id)
      const previousDirection = this.legDirections.get(id)
      if (previousNormal && previousDirection) {
        const transported = previousNormal.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(previousDirection, reachDirection))
        if (normal.lengthSq() < 1e-7) normal.copy(transported)
        if (normal.dot(transported) < 0) normal.negate()
        normal.normalize().lerp(transported, Math.exp(-dt * 18)).normalize()
      } else normal.normalize()
      this.legNormals.set(id, normal.clone())
      this.legDirections.set(id, reachDirection)
      const mixedPole = direction.clone().cross(normal).normalize()
      mixed[1].copy(twoBone(mixed[0], mixed[2], l1, l2, mixedPole))
      const liveFootLink = world(names[3]).sub(world(names[2])).normalize()
      const curledFootLink = curlPositions[3].clone().sub(curlPositions[2]).normalize()
      const footDelta = new THREE.Quaternion().setFromUnitVectors(liveFootLink, curledFootLink)
      mixed[3].copy(liveFootLink.applyQuaternion(new THREE.Quaternion().slerp(footDelta, bodyCurl)))
        .multiplyScalar(chain[2].rest.distanceTo(chain[3].rest)).add(mixed[2])
      const planeFrame = (forward: V, planeNormal: V) => {
        const z = forward.clone().normalize()
        const x = planeNormal.clone().addScaledVector(z, -planeNormal.dot(z)).normalize()
        return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, z.clone().cross(x).normalize(), z))
      }
      for (let i = 0; i < chain.length; i++) {
        const j = chain[i]
        const old = names[i]
        const p = mixed[i]
        const tangent = i < 3 ? mixed[i + 1].clone().sub(p)
          : j.end.clone().sub(j.rest).applyQuaternion(old.getWorldQuaternion(new THREE.Quaternion())).normalize()
            .lerp(inward.clone().add(new THREE.Vector3(0, -0.1, 0)).normalize(), bodyCurl)
        let q = i === 3
          ? (input.pose === 'curl' || c > 0.001
            ? new THREE.Quaternion().slerp(aq, bodyCurl)
            : old.getWorldQuaternion(new THREE.Quaternion()))
          : planeFrame(tangent, normal).multiply(planeFrame(j.end.clone().sub(j.rest), restNormal).invert())
        if (i < 2) {
          // Preserve the guide's axial roll while bending into the sleep pose.
          // A bend-plane frame alone may differ by 180° around a limb's axis.
          const sourceNormal = world(names[1]).sub(world(names[0])).cross(world(names[2]).sub(world(names[1]))).normalize()
          const sourceTangent = world(names[i + 1]).sub(world(names[i]))
          const sourceFrame = planeFrame(sourceTangent, sourceNormal)
            .multiply(planeFrame(j.end.clone().sub(j.rest), restNormal).invert())
          q.multiply(sourceFrame.invert().multiply(old.getWorldQuaternion(new THREE.Quaternion())))
        }
        if (i === 2) {
          const previousFrame = this.wristFrames.get(id)
          if (previousFrame) {
            const previousDirection = j.end.clone().sub(j.rest).normalize().applyQuaternion(previousFrame)
            q = new THREE.Quaternion().setFromUnitVectors(previousDirection, tangent.clone().normalize()).multiply(previousFrame)
            if (bodyCurl < 0.1) q.slerp(old.getWorldQuaternion(new THREE.Quaternion()), (1 - bodyCurl / 0.1) * (1 - Math.exp(-dt * 12)))
          } else q = this.orient(j, tangent, old.getWorldQuaternion(new THREE.Quaternion()))
          this.wristFrames.set(id, q.clone())
        }
        this.place(j, p, q)
      }
    }

    const tailBase = Array.from({ length: 8 }, (_, i) => world(base(`tail${i}`)))
    tailBase.push(tailBase[7].clone().add(tailBase[7].clone().sub(tailBase[6])))
    const liveTail = curve(tailBase)
    const tailRoot = this.root.worldToLocal(world(this.rump[1].bone))
    const headForward = bodyArc(1.002).sub(bodyArc(1)).normalize()
    const support = bodyArc(1).addScaledVector(headForward, 0.085)
    support.y = 0.065
    const makeWrap = (spread: number) => curve([
      bodyArc(0),
      new THREE.Vector3(-radius * 0.9 * spread, 0.105, -radius * 1.25),
      new THREE.Vector3(-radius * 1.55 * spread, 0.09, -radius * 0.65),
      new THREE.Vector3(-radius * 1.5 * spread, 0.085, radius * 0.1), support,
    ])
    let lowSpread = 0.45, highSpread = 1.4
    for (let i = 0; tailCurl > 0 && i < 8; i++) {
      const middle = (lowSpread + highSpread) / 2
      if (makeWrap(middle).getLength() > this.tailLength) highSpread = middle
      else lowSpread = middle
    }
    const wrap = makeWrap((lowSpread + highSpread) / 2)
    const livePoints: V[] = [], wrapPoints: V[] = []
    let tailDistance = 0
    for (let i = 0; i <= 16; i++) {
      if (i) tailDistance += this.tail[i - 1].rest.distanceTo(this.tail[i - 1].end)
      const u = tailDistance / this.tailLength
      const p = liveTail.getPointAt(u)
      // Cascaded first-order dynamics: progressively softer, stable at any dt.
      if (i < 16) {
        const lead = i ? this.tailAngles[i - 1] : -this.turn * 0.15
        const goal = lead + Math.sin(t * 1.65 - u * 2.6) * 0.015
        this.tailAngles[i] = lerp(this.tailAngles[i], goal, 1 - Math.exp(-dt * (9 - u * 4)))
        p.x += Math.sin(this.tailAngles[i]) * this.tailLength * u * 0.22
        p.y += Math.sin(t * 1.3 - u * 2) * u * 0.003
      }
      livePoints.push(p)
      wrapPoints.push(wrap.getPointAt(u))
    }
    const tailPoints = [livePoints[0].clone().lerp(tailRoot, tailCurl)]
    let previousLiveYaw = Math.PI, previousWrapYaw = Math.PI
    for (let i = 0; i < 16; i++) {
      const j = this.tail[i]
      const liveDirection = livePoints[i + 1].clone().sub(livePoints[i])
      const wrapDirection = wrapPoints[i + 1].clone().sub(wrapPoints[i])
      // Unwrap along the whole chain before interpolation. Quaternion slerp
      // chooses the shorter turn and flips sides at 180 degrees in a full curl.
      const unwrap = (a: number, previous: number) => previous + Math.atan2(Math.sin(a - previous), Math.cos(a - previous))
      const liveYaw = unwrap(Math.atan2(liveDirection.x, liveDirection.z), previousLiveYaw)
      const wrapYaw = unwrap(Math.atan2(wrapDirection.x, wrapDirection.z), previousWrapYaw)
      previousLiveYaw = liveYaw; previousWrapYaw = wrapYaw
      const yaw = lerp(liveYaw, wrapYaw, tailCurl)
      const pitch = lerp(Math.asin(THREE.MathUtils.clamp(liveDirection.clone().normalize().y, -1, 1)),
        Math.asin(THREE.MathUtils.clamp(wrapDirection.clone().normalize().y, -1, 1)), tailCurl)
      const forward = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      const q = this.orient(j, forward)
      const segmentLength = lerp(j.rest.distanceTo(j.end), wrapDirection.length(), tailCurl)
      tailPoints.push(j.end.clone().sub(j.rest).normalize().applyQuaternion(q).multiplyScalar(segmentLength).add(tailPoints[i]))
      this.place(j, tailPoints[i], q)
    }
    this.contact.tail.copy(tailPoints[16])
    // A small ballistic arc after the hind paws leave the ground. It is a
    // skeleton offset, so the actor's world/navigation coordinates stay intact.
    const flight = (this.driver.animator.gaitPhase - 0.18) / 0.40
    const flightLift = flight > 0 && flight < 1 ? 4 * flight * (1 - flight) * 0.03
      * THREE.MathUtils.clamp(this.driver.animator.boundAmount, 0, 1) * (1 - bodyCurl) : 0
    this.spine[0].bone.position.y += flightLift
    this.contact.head.y += flightLift
    this.contact.tail.y += flightLift
    this.root.updateMatrixWorld(true)
    this.mesh.skeleton.update()
    // Surface clearance uses extrema of the actual skin, including the thick
    // tail. Moving the root bone keeps the actor's world transform untouched.
    const attribute = this.mesh.geometry.getAttribute('position')
    const surface = new THREE.Vector3()
    let minimum = Infinity
    for (const index of this.floorVertices) {
      surface.fromBufferAttribute(attribute, index)
      this.mesh.applyBoneTransform(index, surface)
      minimum = Math.min(minimum, surface.y)
    }
    const wanted = c > 0.98 ? 0.006 - minimum : Math.max(0, 0.006 - minimum)
    this.clearance = wanted > this.clearance ? wanted : lerp(this.clearance, wanted, 1 - Math.exp(-dt * 9))
    this.spine[0].bone.position.y += this.clearance
    this.contact.head.y += this.clearance
    this.contact.tail.y += this.clearance
    this.root.updateMatrixWorld(true)
    this.mesh.skeleton.update()
  }

  private frontGuide(id: string, chain: Joint[], source: THREE.Bone[]): THREE.Object3D[] {
    let guides = this.frontGuides.get(id)
    if (!guides) { guides = chain.map(() => new THREE.Object3D()); this.frontGuides.set(id, guides) }
    const chestQ = this.baseBones.get('chest')!.getWorldQuaternion(new THREE.Quaternion())
    const shoulder = world(source[0])
    const desiredWrist = world(source[2])
    const reach = desiredWrist.clone().sub(shoulder).applyQuaternion(chestQ.clone().invert())
    const angle = THREE.MathUtils.clamp(0.91 - Math.atan2(reach.z, -reach.y) * 0.15, 0.60, 1.15)
    const upperRest = chain[1].rest.clone().sub(chain[0].rest)
    const sagittalLength = Math.hypot(upperRest.y, upperRest.z)
    const upper = new THREE.Vector3(upperRest.x, -Math.cos(angle) * sagittalLength, -Math.sin(angle) * sagittalLength)
    const elbow = upper.applyQuaternion(chestQ).add(shoulder)
    const forearmLength = chain[1].rest.distanceTo(chain[2].rest)
    const wrist = desiredWrist.sub(elbow).setLength(forearmLength).add(elbow)
    const paw = world(source[3]).sub(world(source[2])).setLength(chain[2].rest.distanceTo(chain[3].rest)).add(wrist)
    const points = [shoulder, elbow, wrist, paw]
    chain.forEach((j, i) => {
      guides![i].position.copy(points[i])
      if (i < 3) {
        const from = j.end.clone().sub(j.rest).normalize().applyQuaternion(chestQ)
        const to = points[i + 1].clone().sub(points[i]).normalize()
        guides![i].quaternion.setFromUnitVectors(from, to).multiply(chestQ)
      } else guides![i].quaternion.copy(source[i].getWorldQuaternion(new THREE.Quaternion()))
      guides![i].updateMatrixWorld(true)
    })
    return guides
  }

  private hindGuide(id: string, chain: Joint[], source: THREE.Bone[], enabled: number): THREE.Object3D[] {
    const phase = (this.driver.animator.gaitPhase + (id === 'HR' ? 0.06 : 0)) % 1
    const hold = smooth(0.14, 0.24, phase) * (1 - smooth(0.48, 0.68, phase))
      * smooth(0.10, 0.90, this.driver.animator.boundAmount) * enabled
    if (hold < 1e-6) return source
    let guides = this.hindGuides.get(id)
    if (!guides) { guides = chain.map(() => new THREE.Object3D()); this.hindGuides.set(id, guides) }
    const hipsQ = this.baseBones.get('hips')!.getWorldQuaternion(new THREE.Quaternion())
    const hip = world(source[0])
    const l1 = chain[0].rest.distanceTo(chain[1].rest), l2 = chain[1].rest.distanceTo(chain[2].rest)
    const extended = new THREE.Vector3(0, -0.62, -0.78).normalize().applyQuaternion(hipsQ)
      .multiplyScalar((l1 + l2) * 0.985).add(hip)
    const hock = world(source[2]).lerp(extended, hold)
    const reach = hock.clone().sub(hip)
    reach.setLength(THREE.MathUtils.clamp(reach.length(), Math.abs(l1 - l2) + 0.001, (l1 + l2) * 0.99))
    hock.copy(hip).add(reach)
    const pole = new THREE.Vector3(id === 'HL' ? 0.25 : -0.25, 0, 1).applyQuaternion(hipsQ)
    const knee = twoBone(hip, hock, l1, l2, pole, 0.99)
    const footDirection = world(source[3]).sub(world(source[2])).normalize()
    const extendedFoot = new THREE.Vector3(0, -0.65, -0.76).normalize().applyQuaternion(hipsQ)
    footDirection.applyQuaternion(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(footDirection, extendedFoot), hold))
    const paw = footDirection.multiplyScalar(chain[2].rest.distanceTo(chain[3].rest)).add(hock)
    const points = [hip, knee, hock, paw]
    chain.forEach((j, i) => {
      const q = source[i].getWorldQuaternion(new THREE.Quaternion())
      guides![i].position.copy(points[i])
      if (i < 3) {
        const from = j.end.clone().sub(j.rest).normalize().applyQuaternion(q)
        const to = points[i + 1].clone().sub(points[i]).normalize()
        guides![i].quaternion.setFromUnitVectors(from, to).multiply(q)
      } else guides![i].quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), hold * 0.6))
      guides![i].updateMatrixWorld(true)
    })
    return guides
  }
}

export { loadMartenV2 as loadMarten }
export type { MartenBodyV2 as MartenBody, MartenPoseV2 as MartenPose, MartenInputV2 as MartenInput }

function twoBone(a: V, target: V, l1: number, l2: number, pole: V, maxStretch = 0.97): V {
  const delta = target.clone().sub(a)
  const d = THREE.MathUtils.clamp(delta.length(), Math.abs(l1 - l2) + 1e-5, (l1 + l2) * maxStretch)
  const direction = delta.normalize()
  const cos = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
  const side = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize()
  return a.clone().addScaledVector(direction, l1 * cos).addScaledVector(side, l1 * Math.sqrt(1 - cos * cos))
}
