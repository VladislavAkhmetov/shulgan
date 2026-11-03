import * as THREE from 'three'
import { clamp } from '../util'
import { WOLF_CLIPS } from './models'
import type { RigState } from './rig'

const COWER_SPINE = [-0.025, -0.015, 0.14, 0.15, 0.40, 0.34, 0.20, -0.15]
const TUCK_TAIL = [-0.83, -0.70, -0.56, -0.38, -0.22, -0.12, -0.06, -0.04]
const FOLD_EAR = [-0.95, -0.20, -0.10, -0.04]

/** An additive layer: the mixer owns the gait, these joints supply bend and follow-through. */
export class WolfMotion {
  private bones = new Map<string, THREE.Bone>()
  private body: THREE.Bone
  private saved: { bone: THREE.Bone; q: THREE.Quaternion; p: THREE.Vector3 }[] = []
  private spine: Bend[] = []
  private tail: Bend[] = []
  private ears: Bend[] = []
  private fear = 0
  private legs: Leg[] = []
  private previousYaw: number | null = null
  private previousSpeed = 0
  private turn = 0
  private acceleration = 0
  private speed = 0
  private actorQ = new THREE.Quaternion()
  private actorInverse = new THREE.Quaternion()
  private parentQ = new THREE.Quaternion()
  private rotation = new THREE.Quaternion()
  private delta = new THREE.Quaternion()
  private angles = new THREE.Euler()
  private a = new THREE.Vector3()
  private b = new THREE.Vector3()
  private c = new THREE.Vector3()
  private direction = new THREE.Vector3()
  private pole = new THREE.Vector3()
  private knee = new THREE.Vector3()

  constructor(private model: THREE.Object3D, private actor: THREE.Object3D) {
    model.traverse((object) => { if ((object as THREE.Bone).isBone) this.bones.set(object.name, object as THREE.Bone) })
    const bone = (name: string) => {
      const found = this.bones.get(THREE.PropertyBinding.sanitizeNodeName(name))
      if (!found) throw new Error(`Missing wolf motion joint: ${name}`)
      return found
    }
    this.body = bone('Body')
    for (const name of ['Back', 'Torso', 'Torso2', 'Torso3', 'Neck1', 'Neck2', 'Neck3', 'Head']) {
      this.spine.push(new Bend(bone(name)))
    }
    for (let i = 1; i <= 8; i++) this.tail.push(new Bend(bone(`Tail${i}`)))
    for (const side of ['L', 'R']) for (let i = 1; i <= 4; i++) this.ears.push(new Bend(bone(`Ear${i}.${side}`)))
    for (const side of ['L', 'R']) {
      this.legs.push(new Leg(bone(`FrontUpperLeg.${side}`), bone(`FrontLowerLeg.${side}`), null, bone(`IKFrontLeg.${side}`)))
      this.legs.push(new Leg(bone(`BackLeg.${side}`), bone(`BackUpperLeg.${side}`), bone(`BackLowerLeg.${side}`), bone(`IKBackLeg.${side}`)))
    }
    const touched = new Set<THREE.Bone>([this.body, ...[...this.spine, ...this.tail, ...this.ears].map((joint) => joint.bone)])
    for (const leg of this.legs) for (const joint of [leg.upper, leg.lower, leg.hock, leg.foot]) if (joint) touched.add(joint)
    this.saved = [...touched].map((joint) => ({ bone: joint, q: joint.quaternion.clone(), p: joint.position.clone() }))
  }

  /** Remove last frame's additions before sampling, including bones with constant GLTF tracks. */
  restore() {
    for (const { bone, q, p } of this.saved) { bone.quaternion.copy(q); bone.position.copy(p) }
  }

  update(dt: number, state: RigState, gait: number) {
    for (const saved of this.saved) { saved.q.copy(saved.bone.quaternion); saved.p.copy(saved.bone.position) }
    const h = clamp(dt, 0, 0.08)
    const yaw = this.actor.rotation.y
    const change = this.previousYaw === null ? 0 : Math.atan2(Math.sin(yaw - this.previousYaw), Math.cos(yaw - this.previousYaw))
    this.previousYaw = yaw
    const rate = dt > 0 ? clamp(change / dt, -6, 6) : 0
    this.turn += (rate - this.turn) * (1 - Math.exp(-12 * h))
    const acceleration = dt > 0 ? clamp((state.speed - this.previousSpeed) / dt, -14, 14) : 0
    this.previousSpeed = state.speed
    this.acceleration += (acceleration - this.acceleration) * (1 - Math.exp(-6 * h))
    this.speed += (state.speed - this.speed) * (1 - Math.exp(-9 * h))
    const n = clamp(state.t ?? 0, 0, 1)
    const dead = state.clip === WOLF_CLIPS.death
    const fearTarget = dead ? 0 : clamp(state.fear ?? 0, 0, 1)
    this.fear += (fearTarget - this.fear) * (1 - Math.exp(-h * (fearTarget > this.fear ? 16 : 5)))
    const alive = dead ? 1 - THREE.MathUtils.smoothstep(n, 0.05, 0.65) : 1
    // At the last death frame the source pose is exact, with no moving tail on the corpse.
    if (dead && !alive) {
      for (const joint of this.spine) joint.reset()
      for (const joint of this.tail) joint.reset()
      for (const joint of this.ears) joint.reset()
      this.fear = 0
      return
    }

    this.model.updateWorldMatrix(true, true)
    this.actor.getWorldQuaternion(this.actorQ)
    this.actorInverse.copy(this.actorQ).invert()
    for (const leg of this.legs) leg.capture()
    // Bend the supporting legs into a crouch while the animated feet remain planted.
    this.body.getWorldPosition(this.a)
    this.a.y -= this.fear * alive * 0.14
    this.body.position.copy(this.body.parent!.worldToLocal(this.a))

    const moving = state.clip ? 0 : clamp(this.speed / 6.5, 0, 1)
    const run = THREE.MathUtils.smoothstep(this.speed, 2, 4)
    const p = gait * Math.PI * 2
    const time = state.time
    const bend = clamp(this.turn * (0.12 + moving * 0.10), -0.5, 0.5)
    const fear = this.fear
    const stride = moving * (0.025 + run * 0.09) * (1 - fear * 0.65)
    const sway = Math.sin(p) * moving * (1 - run) * 0.035
    const breath = Math.sin(time * 2.1) * 0.008 * (1 - moving)
    const attack = state.clip === WOLF_CLIPS.crouch ? n * 0.38 : state.clip === WOLF_CLIPS.leap ? 0.38 + n * 0.62 : -1
    // Gather -> extension at contact -> absorb landing; continuous across the gameplay phase split.
    const curl = attack < 0 ? 0 : attackCurve(attack)
    const recoil = state.clip === WOLF_CLIPS.hurt ? Math.sin(n * Math.PI) * 0.05 : 0
    const lean = clamp(-this.turn * moving * 0.035, -0.10, 0.10)
    for (let i = 0; i < this.spine.length; i++) {
      const joint = this.spine[i]
      let pitch: number, yawOffset: number, roll: number
      if (i === 0) {
        pitch = Math.cos(p + 0.35) * stride * 0.30 + curl * 0.025
        yawOffset = -bend * 0.17 - sway
        roll = lean * 0.35
      } else if (i < 4) {
        const sign = i === 1 ? 1 : -1
        pitch = Math.cos(p - (i - 1) * 0.5) * stride * sign + curl * (i === 1 ? -0.15 : 0.105) + breath
        yawOffset = bend * (i === 1 ? 0.36 : i === 2 ? 0.40 : 0.22) + sway * 0.6
        roll = lean * (i === 2 ? 0.45 : 0.10)
      } else {
        // The neck follows the curve while the head damps vertical gallop motion.
        pitch = -Math.cos(p - 0.6) * stride * 0.13 + curl * 0.012 - recoil * 0.3
        yawOffset = bend * (i === 4 ? 0.10 : i === 7 ? -0.08 : 0.03) + (state.look ?? 0) * 0.15
        roll = -lean * 0.12
      }
      // Lower the forequarters and neck in a distributed curve; keep the muzzle facing ahead.
      const cowerPitch = COWER_SPINE[i]
      pitch += cowerPitch * fear
      joint.step(pitch, yawOffset * (1 - fear * 0.35), roll, h, i < 4 ? 180 : 110, 0.9, 0.4)
      this.bend(joint, alive)
    }

    for (let i = 0; i < this.tail.length; i++) {
      const joint = this.tail[i]
      const previous = i ? this.tail[i - 1] : null
      const wave = Math.sin(p - i * 0.6) * moving
      const idle = Math.sin(time * 1.6 - i * 0.45) * 0.014 * (1 - moving)
      const yawTarget = ((previous ? previous.y * 0.68 : -bend * 0.20) + wave * 0.025 + idle) * (1 - fear * 0.9)
      const loosePitch = (previous ? previous.x * 0.60 : clamp(this.acceleration * 0.004, -0.05, 0.05))
        + Math.sin(p - i * 0.6 - 0.7) * moving * 0.025 - curl * 0.012
      // Curl down, then forward between the hind legs, instead of holding the tail straight down.
      const tuck = TUCK_TAIL[i]
      const pitchTarget = THREE.MathUtils.lerp(loosePitch, tuck, fear)
      // The tip is softer than the base; each segment receives the previous segment's delayed motion.
      joint.step(pitchTarget, yawTarget, 0, h, 90 - i * 7, 0.68, 0.95)
      this.bend(joint, alive)
    }
    for (let i = 0; i < this.ears.length; i++) {
      const segment = i % 4
      const joint = this.ears[i]
      joint.step(FOLD_EAR[segment] * fear, 0,
        (i < 4 ? -1 : 1) * (segment === 0 ? 0.15 : 0.025) * fear, h, 190, 0.95, 1.1)
      this.bend(joint, alive)
    }
    if (fear > 0.0001 && !dead) this.keepTailAboveGround()
    // Spine changes must not separate the animated feet from their shins.
    for (const leg of this.legs) this.solveLeg(leg)
  }

  private bend(joint: Bend, weight: number) {
    this.rotation.setFromEuler(this.angles.set(joint.x * weight, joint.y * weight, joint.z * weight))
    this.delta.copy(this.actorQ).multiply(this.rotation).multiply(this.actorInverse)
    this.rotateWorld(joint.bone)
  }

  /** Apply the world-space delta without assuming Blender's local bone axes match the actor. */
  private rotateWorld(bone: THREE.Bone) {
    bone.parent!.getWorldQuaternion(this.parentQ)
    this.rotation.copy(this.parentQ).invert().multiply(this.delta).multiply(this.parentQ)
    bone.quaternion.premultiply(this.rotation).normalize()
  }

  private aim(bone: THREE.Bone, target: THREE.Vector3) {
    bone.getWorldPosition(this.a)
    bone.getWorldQuaternion(this.rotation)
    this.b.set(0, 1, 0).applyQuaternion(this.rotation)
    this.c.copy(target).sub(this.a).normalize()
    this.delta.setFromUnitVectors(this.b, this.c)
    this.rotateWorld(bone)
  }

  /** The long furred tail must sweep along the floor while tucking/unfolding, rather than through it. */
  private keepTailAboveGround() {
    this.actor.getWorldPosition(this.a)
    const floor = this.a.y + 0.17
    for (let i = 0; i < this.tail.length; i++) {
      const bone = this.tail[i].bone
      bone.getWorldPosition(this.a)
      if (i + 1 < this.tail.length) this.tail[i + 1].bone.getWorldPosition(this.knee)
      else { bone.updateWorldMatrix(true, false); this.knee.set(0, 0.05, 0).applyMatrix4(bone.matrixWorld) }
      if (this.knee.y >= floor) continue
      this.direction.copy(this.knee).sub(this.a)
      const length = this.direction.length()
      const dy = clamp(floor - this.a.y, -length, length)
      const horizontal = Math.hypot(this.direction.x, this.direction.z)
      const span = Math.sqrt(Math.max(0, length * length - dy * dy))
      if (horizontal > 0.0001) this.direction.multiplyScalar(span / horizontal)
      else this.direction.set(0, 0, span).applyQuaternion(this.actorQ)
      this.direction.y = dy
      this.knee.copy(this.a).add(this.direction)
      this.aim(bone, this.knee)
    }
  }

  private solveLeg(leg: Leg) {
    leg.upper.getWorldPosition(this.a)
    // Hind legs retain their animated metatarsal direction and solve the thigh/shin above it.
    this.c.copy(leg.target).sub(leg.metatarsal)
    this.direction.copy(this.c).sub(this.a)
    const distance = this.direction.length()
    if (distance < 1e-6 || leg.l1 < 1e-6 || leg.l2 < 1e-6) return
    this.direction.multiplyScalar(1 / distance)
    const reach = clamp(distance, Math.abs(leg.l1 - leg.l2) + 0.00001, (leg.l1 + leg.l2) * 0.9999)
    this.c.copy(this.a).addScaledVector(this.direction, reach)
    const along = (leg.l1 * leg.l1 - leg.l2 * leg.l2 + reach * reach) / (2 * reach)
    const height = Math.sqrt(Math.max(0, leg.l1 * leg.l1 - along * along))
    this.pole.copy(leg.pole).addScaledVector(this.direction, -leg.pole.dot(this.direction))
    if (this.pole.lengthSq() < 1e-8) this.pole.set(0, 0, 1).applyQuaternion(this.actorQ).addScaledVector(this.direction, -this.direction.dot(this.pole))
    this.pole.normalize()
    this.knee.copy(this.a).addScaledVector(this.direction, along).addScaledVector(this.pole, height)
    leg.solved.copy(this.c)
    this.aim(leg.upper, this.knee)
    this.aim(leg.lower, leg.solved)
    if (leg.hock) {
      leg.solved.add(leg.metatarsal)
      this.aim(leg.hock, leg.solved)
    }
    // A fully extended leg may need a small reach correction; never stretch the mesh.
    leg.foot.position.copy(leg.foot.parent!.worldToLocal(leg.solved))
  }
}

class Bend {
  x = 0; y = 0; z = 0
  private vx = 0; private vy = 0; private vz = 0
  constructor(readonly bone: THREE.Bone) {}
  reset() { this.x = this.y = this.z = this.vx = this.vy = this.vz = 0 }
  step(x: number, y: number, z: number, dt: number, stiffness: number, damping: number, pitchLimit = 0.23) {
    const steps = Math.max(1, Math.ceil(dt * 120))
    const h = dt / steps
    const drag = 2 * Math.sqrt(stiffness) * damping
    for (let i = 0; i < steps; i++) {
      this.vx += ((x - this.x) * stiffness - drag * this.vx) * h
      this.vy += ((y - this.y) * stiffness - drag * this.vy) * h
      this.vz += ((z - this.z) * stiffness - drag * this.vz) * h
      this.x = clamp(this.x + this.vx * h, -pitchLimit, pitchLimit)
      this.y = clamp(this.y + this.vy * h, -0.25, 0.25)
      this.z = clamp(this.z + this.vz * h, -0.15, 0.15)
    }
  }
}

class Leg {
  target = new THREE.Vector3()
  metatarsal = new THREE.Vector3()
  pole = new THREE.Vector3()
  solved = new THREE.Vector3()
  l1 = 0; l2 = 0
  private hip = new THREE.Vector3()
  private knee = new THREE.Vector3()
  private end = new THREE.Vector3()
  constructor(readonly upper: THREE.Bone, readonly lower: THREE.Bone, readonly hock: THREE.Bone | null, readonly foot: THREE.Bone) {}
  capture() {
    this.upper.getWorldPosition(this.hip)
    this.lower.getWorldPosition(this.knee)
    this.foot.getWorldPosition(this.target)
    if (this.hock) {
      this.hock.getWorldPosition(this.end)
      this.metatarsal.copy(this.target).sub(this.end)
    } else { this.end.copy(this.target); this.metatarsal.set(0, 0, 0) }
    this.l1 = this.hip.distanceTo(this.knee)
    this.l2 = this.knee.distanceTo(this.end)
    this.pole.copy(this.knee).sub(this.hip)
  }
}

function attackCurve(t: number) {
  if (t < 0.30) return THREE.MathUtils.smoothstep(t, 0, 0.30)
  if (t < 0.38) return 1
  if (t < 0.56) return 1 - 1.65 * THREE.MathUtils.smoothstep(t, 0.38, 0.56)
  if (t < 0.78) return -0.65 + 1.20 * THREE.MathUtils.smoothstep(t, 0.56, 0.78)
  return 0.55 * (1 - THREE.MathUtils.smoothstep(t, 0.78, 1))
}
