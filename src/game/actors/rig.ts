import * as THREE from 'three'
import { clamp, TAU } from '../util'
import { rimMaterial } from '../render/materials'

/**
 * Procedural rigs built from primitives. They stand in for skinned GLB characters until the
 * Mixamo pipeline is ready: gameplay talks to `Rig.update({speed, action})` only, so swapping in
 * an AnimationMixer-driven model later does not touch combat code.
 *
 * Rotation conventions (character faces +Z, left = +X):
 *   shoulder/thigh  x<0 swings forward   z>0 raises left limb outward (z<0 for right)
 *   elbow x<0 bends forearm forward      knee x>0 bends shin backward
 *   spine/chest x>0 leans forward        y>0 twists toward the left
 */

export type V3 = [number, number, number]
export type Pose = Record<string, V3>
export interface Key {
  t: number
  p: Pose
  /** body offsets: [y, z, pitch] */
  b?: V3
}
export type Clip = Key[]

/**
 * Sample a clip at normalised time t (0..1) with non-uniform Catmull-Rom interpolation:
 * motion flows through keys instead of stopping on each one.
 */
export function sampleClip(clip: Clip, t: number, out: Pose, body: V3) {
  for (const k in out) delete out[k]
  body[0] = body[1] = body[2] = 0
  if (!clip.length) return
  let i = 0
  while (i < clip.length - 1 && clip[i + 1].t <= t) i++
  const a = clip[i]
  const b = clip[Math.min(i + 1, clip.length - 1)]
  const pa = clip[Math.max(0, i - 1)]
  const nb = clip[Math.min(clip.length - 1, i + 2)]
  const span = b.t - a.t
  const u = span > 0 ? clamp((t - a.t) / span, 0, 1) : 1
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2
  const h11 = u3 - u2
  const ta = span > 0 && b.t - pa.t > 0 ? span / (b.t - pa.t) : 0
  const tb = span > 0 && nb.t - a.t > 0 ? span / (nb.t - a.t) : 0
  const interp = (p0: number, v0: number, v1: number, p1: number) => h00 * v0 + h10 * (v1 - p0) * ta + h01 * v1 + h11 * (p1 - v0) * tb
  const keys = new Set([...Object.keys(a.p), ...Object.keys(b.p)])
  for (const j of keys) {
    const va = a.p[j] ?? b.p[j]
    const vb = b.p[j] ?? a.p[j]
    const vp = pa.p[j] ?? va
    const vn = nb.p[j] ?? vb
    out[j] = [interp(vp[0], va[0], vb[0], vn[0]), interp(vp[1], va[1], vb[1], vn[1]), interp(vp[2], va[2], vb[2], vn[2])]
  }
  const z3: V3 = [0, 0, 0]
  const ba = a.b ?? z3
  const bb = b.b ?? z3
  const bp = pa.b ?? ba
  const bn = nb.b ?? bb
  for (let k = 0; k < 3; k++) body[k] = interp(bp[k], ba[k], bb[k], bn[k])
}

export interface RigState {
  speed: number
  /** -1..1 movement direction relative to facing (1 = forward) */
  forward?: number
  /** -1..1 lateral movement (+ = toward the character's left) */
  side?: number
  /** head/torso yaw offset toward where the character is looking (radians) */
  look?: number
  /** 0..1 defensive/cowering posture during injury recovery. */
  fear?: number
  clip?: Clip | null
  t?: number
  weight?: number
  time: number
  /** additive tremble (charging, struggling) */
  shake?: number
  /** spring stiffness multiplier: >1 = snappier (strikes, flinches), 1 = flowing */
  snap?: number
}

/** Second-order dynamics follower (frequency f Hz, damping z, response r). */
class Follow {
  y = 0
  yd = 0
  xp = 0
  init = false
  step(x: number, dt: number, f: number, z: number, r: number) {
    if (!this.init || dt <= 0) {
      this.y = x
      this.xp = x
      this.yd = 0
      this.init = true
      return x
    }
    const w = 2 * Math.PI * f
    const k1 = z / (Math.PI * f)
    const k2 = 1 / (w * w)
    const k3 = (r * z) / w
    const xd = (x - this.xp) / dt
    this.xp = x
    const k2s = Math.max(k2, (dt * dt) / 2 + (dt * k1) / 2, dt * k1)
    this.y += dt * this.yd
    this.yd += (dt * (x + k3 * xd - this.y - k1 * this.yd)) / k2s
    return this.y
  }
}

export type Spring = [f: number, z: number, r: number]

interface DangleOpts {
  /** spring stiffness back to hanging */
  k?: number
  /** damping */
  c?: number
  /** how strongly body acceleration swings it */
  amt?: number
  /** 0..1 how much it hangs toward world gravity */
  grav?: number
  /** extra target angles [x, z] (e.g. legs pushing kaftan flaps) */
  bias?: () => [number, number]
  limit?: number
}

interface Dangle extends Required<Omit<DangleOpts, 'bias'>> {
  obj: THREE.Object3D
  bias?: () => [number, number]
  ax: number
  az: number
  vx: number
  vz: number
  pv: THREE.Vector3
  pvel: THREE.Vector3
  init: boolean
}

const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _acc = new THREE.Vector3()
const _g = new THREE.Vector3()
const _vel = new THREE.Vector3()

export abstract class Rig {
  readonly root = new THREE.Group()
  readonly body = new THREE.Group()
  readonly joints: Record<string, THREE.Object3D> = {}
  /** Materials that flash on hit */
  readonly flashMats: THREE.MeshStandardMaterial[] = []
  readonly eyeMats: THREE.MeshBasicMaterial[] = []
  protected phase = 0
  protected loco: Pose = {}
  private actionPose: Pose = {}
  private actionBody: V3 = [0, 0, 0]
  private blendW = 0
  private flash = 0
  private follows = new Map<string, [Follow, Follow, Follow]>()
  private bodyF: [Follow, Follow, Follow, Follow] = [new Follow(), new Follow(), new Follow(), new Follow()]
  private dangles: Dangle[] = []
  private speedS = 0
  private prevYaw = 0
  private turnS = 0
  private accS = 0
  baseEye = new THREE.Color(1, 1, 1)
  eyeBoost = 0

  constructor() {
    this.root.add(this.body)
  }

  protected joint(name: string, parent: THREE.Object3D, x: number, y: number, z: number) {
    const j = new THREE.Group()
    j.name = name
    j.position.set(x, y, z)
    parent.add(j)
    this.joints[name] = j
    return j
  }

  /** Per-joint spring: lower frequency = heavier, lazier follow-through. */
  protected abstract springFor(name: string): Spring
  protected abstract locomotion(dt: number, s: RigState, out: Pose): V3

  /**
   * Make an object hang and swing like a pendulum (cloth flaps, hair, rags, lanterns).
   * The object is re-parented under a pivot at its position so it swings about that point.
   */
  addDangle(obj: THREE.Object3D, o: DangleOpts = {}) {
    const parent = obj.parent!
    const pivot = new THREE.Group()
    pivot.position.copy(obj.position)
    parent.add(pivot)
    obj.position.set(0, 0, 0)
    pivot.add(obj)
    this.dangles.push({
      obj: pivot,
      k: o.k ?? 40,
      c: o.c ?? 6,
      amt: o.amt ?? 0.05,
      grav: o.grav ?? 1,
      limit: o.limit ?? 1.3,
      bias: o.bias,
      ax: 0,
      az: 0,
      vx: 0,
      vz: 0,
      pv: new THREE.Vector3(),
      pvel: new THREE.Vector3(),
      init: false,
    })
    return pivot
  }

  update(dt: number, s: RigState) {
    // smoothed speed and turn rate feed the locomotion so gait changes melt into each other
    this.speedS += (s.speed - this.speedS) * (1 - Math.exp(-7 * dt))
    const accel = dt > 0 ? (s.speed - this.speedS) : 0
    this.accS += (accel - this.accS) * (1 - Math.exp(-6 * dt))
    let dy = this.root.rotation.y - this.prevYaw
    while (dy > Math.PI) dy -= Math.PI * 2
    while (dy < -Math.PI) dy += Math.PI * 2
    this.prevYaw = this.root.rotation.y
    const turn = dt > 0 ? dy / dt : 0
    this.turnS += (turn - this.turnS) * (1 - Math.exp(-5 * dt))
    const raw = s.speed
    s.speed = this.speedS
    const locoBody = this.locomotion(dt, s, this.loco)
    s.speed = raw

    const target = s.clip ? (s.weight ?? 1) : 0
    this.blendW += (target - this.blendW) * (1 - Math.exp(-(s.clip ? 16 : 6) * dt))
    if (s.clip) sampleClip(s.clip, clamp(s.t ?? 0, 0, 1), this.actionPose, this.actionBody)
    const w = this.blendW
    const snap = s.snap ?? 1
    for (const name in this.joints) {
      const j = this.joints[name]
      const l = this.loco[name] ?? ZERO
      const a = w > 0.001 ? (this.actionPose[name] ?? l) : l
      let f = this.follows.get(name)
      if (!f) this.follows.set(name, (f = [new Follow(), new Follow(), new Follow()]))
      const [fq, z, r] = this.springFor(name)
      const lazy = name === 'head' || name === 'neck' || name === 'tail'
      const fr = fq * (lazy ? 1 + (snap - 1) * 0.5 : snap)
      j.rotation.set(
        f[0].step(l[0] + (a[0] - l[0]) * w, dt, fr, z, r),
        f[1].step(l[1] + (a[1] - l[1]) * w, dt, fr, z, r),
        f[2].step(l[2] + (a[2] - l[2]) * w, dt, fr, z, r),
      )
    }
    if (s.shake) {
      const k = s.shake * 0.05
      for (const n of ['chest', 'head', 'shR', 'shL']) {
        const j = this.joints[n]
        if (!j) continue
        j.rotation.x += (Math.random() - 0.5) * k
        j.rotation.z += (Math.random() - 0.5) * k
      }
    }
    const ab = this.actionBody
    const bf = 3.2 * Math.max(1, snap * 0.8)
    const sf = clamp(this.speedS / 4, 0, 1)
    const roll = clamp(-this.turnS * 0.045 * (0.3 + sf), -0.28, 0.28)
    const pitchAcc = clamp(this.accS * 0.06, -0.12, 0.12)
    this.body.position.y = this.bodyF[0].step(locoBody[0] + (ab[0] - locoBody[0]) * w, dt, bf, 0.75, 0)
    this.body.position.z = this.bodyF[1].step(locoBody[1] + (ab[1] - locoBody[1]) * w, dt, bf, 0.75, 0)
    this.body.rotation.x = this.bodyF[2].step(locoBody[2] + (ab[2] - locoBody[2]) * w + pitchAcc, dt, bf, 0.7, 0)
    this.body.rotation.z = this.bodyF[3].step(roll * (1 - w * 0.7), dt, 2.2, 0.6, 0)

    this.updateDangles(dt)

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7)
      for (const m of this.flashMats) m.emissive.setRGB(this.flash * 1.4, this.flash * 1.2, this.flash)
    }
    for (const m of this.eyeMats) {
      const k = 1 + this.eyeBoost * 3
      m.color.copy(this.baseEye).multiplyScalar(k)
    }
  }

  private updateDangles(dt: number) {
    if (!this.dangles.length || dt <= 0 || !this.root.visible) return
    this.root.updateMatrixWorld(true)
    const sub = dt > 1 / 50 ? 2 : 1
    const h = dt / sub
    for (const d of this.dangles) {
      const parent = d.obj.parent!
      parent.matrixWorld.decompose(_p, _q, _s)
      _p.copy(d.obj.position).applyMatrix4(parent.matrixWorld)
      if (!d.init) {
        d.pv.copy(_p)
        d.pvel.set(0, 0, 0)
        d.init = true
      }
      _vel.copy(_p).sub(d.pv).divideScalar(dt)
      _acc.copy(_vel).sub(d.pvel).divideScalar(dt)
      if (_acc.length() > 80) _acc.setLength(80)
      d.pv.copy(_p)
      d.pvel.copy(_vel)
      _q.invert()
      _acc.applyQuaternion(_q)
      _g.set(0, -1, 0).applyQuaternion(_q)
      let tx = Math.atan2(-_g.z, -_g.y) * d.grav
      let tz = Math.atan2(_g.x, -_g.y) * d.grav
      if (d.bias) {
        const [bx, bz] = d.bias()
        tx += bx
        tz += bz
      }
      for (let i = 0; i < sub; i++) {
        d.vx += (-(d.ax - tx) * d.k - d.vx * d.c + _acc.z * d.amt) * h
        d.vz += (-(d.az - tz) * d.k - d.vz * d.c - _acc.x * d.amt) * h
        d.ax = clamp(d.ax + d.vx * h, -d.limit, d.limit)
        d.az = clamp(d.az + d.vz * h, -d.limit, d.limit)
      }
      d.obj.rotation.set(d.ax, 0, d.az)
    }
  }

  hitFlash() {
    this.flash = 1
  }

  setLayer(layer: number, on: boolean) {
    this.root.traverse((o) => {
      if (on) o.layers.enable(layer)
      else o.layers.disable(layer)
    })
  }
}

const ZERO: V3 = [0, 0, 0]

// ---------------------------------------------------------------- humanoid

export interface HumanSpec {
  hipH: number
  thigh: number
  shin: number
  torso: number
  upperArm: number
  foreArm: number
  shoulderW: number
  hipW: number
  limbR: number
  headR: number
  skin: THREE.Material
  cloth: THREE.Material
  dark: THREE.Material
  stride?: number
  hunch?: number
  armHang?: number
  runSpeed?: number
}

const geoCache = new Map<string, THREE.BufferGeometry>()
export function capsule(r: number, len: number, seg = 7) {
  const k = `c${r.toFixed(3)}-${len.toFixed(3)}-${seg}`
  let g = geoCache.get(k)
  if (!g) {
    g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, seg)
    geoCache.set(k, g)
  }
  return g
}

const rimmed = new WeakSet<THREE.Material>()

export function part(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  if (mat instanceof THREE.MeshStandardMaterial && !rimmed.has(mat) && !mat.onBeforeCompile.toString().includes('uTime')) {
    rimmed.add(mat)
    rimMaterial(mat)
  }
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = true
  parent.add(m)
  return m
}

export class Humanoid extends Rig {
  readonly spec: HumanSpec

  constructor(spec: HumanSpec) {
    super()
    this.spec = spec
    const s = spec
    const hips = this.joint('hips', this.body, 0, s.hipH, 0)
    const spine = this.joint('spine', hips, 0, 0.04, 0)
    const chest = this.joint('chest', spine, 0, s.torso * 0.5, 0)
    const neck = this.joint('neck', chest, 0, s.torso * 0.48, 0)
    const head = this.joint('head', neck, 0, 0.08, 0)
    part(capsule(s.hipW * 0.62, s.torso * 0.35), s.cloth, spine, 0, s.torso * 0.15, 0)
    part(capsule(s.shoulderW * 0.36, s.torso * 0.3), s.cloth, chest, 0, s.torso * 0.15, 0).scale.set(1, 1, 0.72)
    part(capsule(s.limbR * 0.8, 0.06), s.skin, neck, 0, 0.02, 0)
    part(new THREE.SphereGeometry(s.headR, 14, 10), s.skin, head, 0, s.headR * 0.9, 0.01).scale.set(0.92, 1.08, 1)

    for (const side of [1, -1]) {
      const L = side === 1 ? 'L' : 'R'
      const sh = this.joint('sh' + L, chest, (side * s.shoulderW) / 2, s.torso * 0.4, 0)
      part(capsule(s.limbR, s.upperArm - s.limbR * 2), s.cloth, sh, 0, -s.upperArm / 2, 0)
      const el = this.joint('el' + L, sh, 0, -s.upperArm, 0)
      part(capsule(s.limbR * 0.85, s.foreArm - s.limbR * 2), s.skin, el, 0, -s.foreArm / 2, 0)
      const ha = this.joint('ha' + L, el, 0, -s.foreArm, 0)
      part(capsule(s.limbR * 0.95, s.limbR * 0.6), s.skin, ha, 0, -s.limbR * 0.6, 0)
      const th = this.joint('th' + L, hips, (side * s.hipW) / 2, 0, 0)
      part(capsule(s.limbR * 1.25, s.thigh - s.limbR * 2), s.cloth, th, 0, -s.thigh / 2, 0)
      const kn = this.joint('kn' + L, th, 0, -s.thigh, 0)
      part(capsule(s.limbR * 1.05, s.shin - s.limbR * 2), s.dark, kn, 0, -s.shin / 2, 0)
      const ft = this.joint('ft' + L, kn, 0, -s.shin, 0)
      part(new THREE.BoxGeometry(s.limbR * 2.1, s.limbR * 1.4, s.limbR * 4.2), s.dark, ft, 0, -s.limbR * 0.5, s.limbR * 1.1)
    }
  }

  /** Heavier creatures get lazier springs (springScale < 1). */
  springScale = 1

  protected springFor(n: string): Spring {
    const k = this.springScale
    if (n === 'hips') return [3.4 * k, 0.8, 0]
    if (n === 'spine') return [2.8 * k, 0.72, 0]
    if (n === 'chest') return [2.5 * k, 0.66, 0]
    if (n === 'neck') return [2.1 * k, 0.6, 0]
    if (n === 'head') return [1.8 * k, 0.55, -0.15]
    if (n.startsWith('sh')) return [3.1 * k, 0.6, 0.25]
    if (n.startsWith('el')) return [2.6 * k, 0.52, 0]
    if (n.startsWith('ha')) return [2.2 * k, 0.48, 0]
    if (n.startsWith('th')) return [6.5, 0.85, 0.2]
    if (n.startsWith('kn')) return [7, 0.82, 0]
    return [6.5, 0.8, 0]
  }

  protected locomotion(dt: number, st: RigState, o: Pose): V3 {
    const s = this.spec
    const run = s.runSpeed ?? 5.2
    const amp = clamp(st.speed / run, 0, 1.25)
    const fw = st.forward ?? 1
    const sd = st.side ?? 0
    const dir = fw < -0.3 ? -1 : 1
    // strafing: shorter steps, legs swing out sideways instead of forward
    const lat = clamp(Math.abs(sd) - Math.abs(fw) * 0.5, 0, 1)
    // stride grows with speed: long unhurried steps when running, shorter ones when walking
    const stride = (s.stride ?? 1.6) * (0.85 + 1.05 * clamp(amp, 0, 1))
    this.phase += ((dt * st.speed * TAU) / stride) * dir * (1 + lat * 0.4)
    const p = this.phase
    const sp = Math.sin(p)
    const hunch = s.hunch ?? 0
    const breathe = Math.sin(st.time * 1.7) * 0.025
    // idle: slow weight shift from foot to foot, a breathing chest, a wandering gaze
    const idle = clamp(1 - amp * 2, 0, 1)
    const shift = Math.sin(st.time * 0.55) * idle
    const gaze = Math.sin(st.time * 0.31) * Math.sin(st.time * 0.17 + 1) * idle
    o.hips = [0, Math.sin(p) * 0.12 * amp, Math.sin(p) * 0.07 * amp + shift * 0.05]
    o.spine = [0.05 * amp + hunch * 0.4, -Math.sin(p) * 0.1 * amp, -shift * 0.03]
    o.chest = [0.12 * amp + hunch * 0.5 + breathe, -Math.sin(p) * 0.14 * amp, -Math.sin(p) * 0.04 * amp - shift * 0.03]
    const look = st.look ?? 0
    o.chest[1] += look * 0.22
    o.spine[1] += look * 0.1
    o.hips[1] += sd * 0.25 * amp
    o.neck = [-hunch * 0.6, gaze * 0.15 + look * 0.3, 0]
    o.head = [-0.08 * amp - hunch * 0.3 + breathe * 0.5, Math.sin(p) * 0.06 * amp + gaze * 0.25 + look * 0.38, shift * 0.04]
    const hang = s.armHang ?? 0.12
    o.shL = [sp * 0.8 * amp - hunch * 0.3, 0, hang]
    o.shR = [-sp * 0.8 * amp - hunch * 0.3, 0, -hang]
    o.elL = [-0.25 - 0.55 * amp, 0, 0]
    o.elR = [-0.25 - 0.55 * amp, 0, 0]
    o.haL = [0, 0, 0]
    o.haR = [0, 0, 0]
    const fwdAmp = 1 - lat * 0.7
    o.thL = [-sp * 0.92 * amp * fwdAmp, 0, 0.02 - shift * 0.04 + Math.max(0, sp) * 0.38 * amp * lat * Math.sign(sd)]
    o.thR = [sp * 0.92 * amp * fwdAmp, 0, -0.02 - shift * 0.04 + Math.max(0, -sp) * 0.38 * amp * lat * Math.sign(sd)]
    o.knL = [(0.1 + Math.max(0, Math.sin(p - 1.3)) * 1.5) * amp + 0.04, 0, 0]
    o.knR = [(0.1 + Math.max(0, Math.sin(p + Math.PI - 1.3)) * 1.5) * amp + 0.04, 0, 0]
    o.ftL = [-0.2 * amp * Math.cos(p), 0, 0]
    o.ftR = [0.2 * amp * Math.cos(p), 0, 0]
    const bob = Math.abs(Math.cos(p)) * 0.07 * amp - 0.03 * amp
    return [bob, 0, 0]
  }
}

// ---------------------------------------------------------------- quadruped (shadow wolf)

export interface QuadSpec {
  bodyLen: number
  height: number
  legR: number
  fur: THREE.Material
  dark: THREE.Material
  runSpeed: number
}

export class Quadruped extends Rig {
  readonly spec: QuadSpec
  constructor(spec: QuadSpec) {
    super()
    this.spec = spec
    const s = spec
    const hip = this.joint('pelvis', this.body, 0, s.height, -s.bodyLen / 2)
    const chest = this.joint('chest', hip, 0, 0.05, s.bodyLen)
    const neck = this.joint('neck', chest, 0, 0.1, 0.15)
    const head = this.joint('head', neck, 0, 0.18, 0.3)
    const jaw = this.joint('jaw', head, 0, -0.08, 0.08)
    const tail = this.joint('tail', hip, 0, 0.05, -0.1)
    // lean waist, deep chest and high shoulders: a hunter's silhouette, not a barrel
    const torso = part(capsule(0.2, s.bodyLen * 0.75, 8), s.fur, hip, 0, 0.04, s.bodyLen * 0.45)
    torso.rotation.x = Math.PI / 2
    torso.scale.set(0.8, 1, 0.95)
    part(new THREE.SphereGeometry(0.33, 10, 8), s.fur, chest, 0, 0.04, 0).scale.set(0.85, 1.2, 1.05)
    part(new THREE.SphereGeometry(0.2, 8, 6), s.fur, hip, 0, 0.06, 0.05).scale.set(0.9, 0.95, 1.1)
    const nk = part(capsule(0.15, 0.3), s.fur, neck, 0, 0.08, 0.12)
    nk.rotation.x = 0.9
    part(new THREE.SphereGeometry(0.17, 10, 8), s.fur, head, 0, 0, 0).scale.set(0.9, 0.85, 1.1)
    const snout = part(new THREE.ConeGeometry(0.09, 0.38, 7), s.dark, head, 0, -0.03, 0.27)
    snout.rotation.x = Math.PI / 2
    const jw = part(new THREE.ConeGeometry(0.07, 0.26, 6), s.dark, jaw, 0, -0.02, 0.17)
    jw.rotation.x = Math.PI / 2
    for (const side of [1, -1]) {
      const ear = part(new THREE.ConeGeometry(0.05, 0.17, 4), s.dark, head, side * 0.09, 0.15, -0.04)
      ear.rotation.z = -side * 0.25
    }
    const t1 = part(capsule(0.07, 0.45), s.fur, tail, 0, -0.1, -0.2)
    t1.rotation.x = -1.1
    const legs: [string, THREE.Object3D, number][] = [
      ['FL', chest, 1],
      ['FR', chest, -1],
      ['BL', hip, 1],
      ['BR', hip, -1],
    ]
    for (const [n, parent, side] of legs) {
      const up = this.joint('u' + n, parent, side * 0.16, -0.05, 0.02)
      part(capsule(s.legR * 1.3, s.height * 0.42), s.fur, up, 0, -s.height * 0.24, 0)
      const lo = this.joint('l' + n, up, 0, -s.height * 0.48, 0)
      part(capsule(s.legR, s.height * 0.42), s.dark, lo, 0, -s.height * 0.24, 0)
    }
  }

  protected springFor(n: string): Spring {
    if (n === 'tail') return [1.5, 0.32, 0]
    if (n === 'jaw') return [5, 0.55, 0]
    if (n === 'head') return [2.2, 0.55, -0.1]
    if (n === 'neck') return [2.6, 0.62, 0]
    if (n === 'pelvis' || n === 'chest') return [3.4, 0.75, 0]
    return [7, 0.8, 0]
  }

  protected locomotion(dt: number, st: RigState, o: Pose): V3 {
    const amp = clamp(st.speed / this.spec.runSpeed, 0, 1.2)
    this.phase += dt * (2 + st.speed * 1.9)
    const p = this.phase
    const a = Math.sin(p)
    const b = Math.sin(p + 0.6)
    const breathe = Math.sin(st.time * 2.4) * 0.02
    o.pelvis = [a * 0.08 * amp, 0, 0]
    o.chest = [-a * 0.1 * amp + breathe, 0, 0]
    o.neck = [0.15 - 0.2 * amp, 0, 0]
    o.head = [0.3 + a * 0.1 * amp, 0, 0]
    o.jaw = [0.1 + breathe * 2, 0, 0]
    o.tail = [-0.3 + a * 0.2 * amp, Math.sin(st.time * 3) * 0.2, 0]
    o.uFL = [-b * 0.9 * amp, 0, 0]
    o.uFR = [-Math.sin(p + 0.9) * 0.9 * amp, 0, 0]
    o.uBL = [a * 0.9 * amp, 0, 0]
    o.uBR = [Math.sin(p + 0.3) * 0.9 * amp, 0, 0]
    o.lFL = [-Math.max(0, Math.sin(p + 2.1)) * 1.1 * amp, 0, 0]
    o.lFR = [-Math.max(0, Math.sin(p + 2.4)) * 1.1 * amp, 0, 0]
    o.lBL = [Math.max(0, Math.sin(p - 1.2)) * 1.2 * amp, 0, 0]
    o.lBR = [Math.max(0, Math.sin(p - 0.9)) * 1.2 * amp, 0, 0]
    return [Math.abs(Math.cos(p)) * 0.1 * amp, 0, 0]
  }
}
