import * as THREE from 'three'
import type { Rig } from './rig'
import type { World } from '../world'
import { wrapAngle } from '../util'

/** speed multiplier in shallow water */
export const WADE = 0.62

export abstract class Actor {
  readonly pos = new THREE.Vector3()
  /** external impulse velocity (knockback, pulls) */
  readonly vel = new THREE.Vector3()
  facing = 0
  radius = 0.45
  hp = 100
  maxHp = 100
  posture = 0
  maxPosture = 100
  postureIdle = 0
  alive = true
  airY = 0
  abstract rig: Rig
  protected w: World

  constructor(w: World) {
    this.w = w
  }

  get fx() {
    return Math.sin(this.facing)
  }
  get fz() {
    return Math.cos(this.facing)
  }

  knock(fromX: number, fromZ: number, force: number) {
    let dx = this.pos.x - fromX
    let dz = this.pos.z - fromZ
    const l = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l
    this.vel.x += dx * force
    this.vel.z += dz * force
  }

  move(dt: number, vx: number, vz: number) {
    // wading through shallow water: everyone is slower, wolves too
    const k0 = this.airY < 0.3 && this.w.field.isWater(this.pos.x, this.pos.z) ? WADE : 1
    this.pos.x += (vx * k0 + this.vel.x) * dt
    this.pos.z += (vz * k0 + this.vel.z) * dt
    const k = Math.exp(-7 * dt)
    this.vel.x *= k
    this.vel.z *= k
    this.w.field.resolve(this.pos, this.radius)
  }

  addPosture(v: number) {
    this.posture = Math.min(this.maxPosture, this.posture + v)
    this.postureIdle = 0
  }

  decayPosture(dt: number, rate: number) {
    this.postureIdle += dt
    if (this.postureIdle > 1.6) this.posture = Math.max(0, this.posture - rate * dt)
  }

  syncRig() {
    this.rig.root.position.set(this.pos.x, this.airY, this.pos.z)
    this.rig.root.rotation.y = this.facing
  }
}

/** Is (bx,bz) with radius br inside an attack arc from actor a? */
export function inArc(ax: number, az: number, facing: number, bx: number, bz: number, range: number, arcDeg: number, br: number) {
  const dx = bx - ax
  const dz = bz - az
  const d = Math.hypot(dx, dz)
  if (d > range + br) return false
  if (d < br + 0.3) return true
  const a = Math.atan2(dx, dz)
  const allowance = Math.atan2(br, d)
  return Math.abs(wrapAngle(a - facing)) <= (arcDeg * Math.PI) / 360 + allowance
}
