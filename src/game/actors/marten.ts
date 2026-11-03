import * as THREE from 'three'
import { Actor } from './actor'
import { part, Quadruped, type Clip } from './rig'
import { loadMarten, type MartenBody, type MartenPose } from './martenRig'
import type { Enemy } from './enemies'
import type { World } from '../world'
import { glow, std } from '../render/materials'
import { dampAngle, rand, wrapAngle } from '../util'

/**
 * Susar, the pine marten Timer frees from a trap mid-way through the urman (docs/COMPANION.md).
 * She keeps her distance, hides when blood is spilled, and smells what Timer cannot see:
 * every unseen enemy within reach is marked for him (Game draws the marks).
 */

// larger than life on purpose: at the iso camera a true-size marten is a dozen pixels
const SCALE = 0.5
const SENSE_R = 22

export const MARTEN_CLIPS: Record<string, Clip> = {
  // caught: lying on her side, the trapped paw stretched out
  trapped: [
    { t: 0, p: { pelvis: [0.05, 0, 1.15], chest: [0.08, 0, 0.1], neck: [0.25, 0.35, -0.3], head: [0.15, 0.3, -0.2], uFL: [-1.1, 0, 0], lFL: [0.2, 0, 0], uFR: [-0.4, 0, 0], lFR: [0.9, 0, 0], uBL: [0.5, 0, 0], lBL: [0.7, 0, 0], uBR: [0.3, 0, 0], lBR: [0.9, 0, 0], tail: [0.1, 0.5, 0] }, b: [-0.36, 0, 0] },
    { t: 1, p: { pelvis: [0.06, 0, 1.12], chest: [0.12, 0, 0.14], neck: [0.15, 0.55, -0.3], head: [0.05, 0.45, -0.2] }, b: [-0.37, 0, 0] },
  ],
  // sitting up, watching
  sit: [{ t: 0, p: { chest: [-0.35, 0, 0], neck: [-0.2, 0, 0], head: [0.25, 0, 0], uBL: [-1.0, 0, 0], lBL: [1.8, 0, 0], uBR: [-1.0, 0, 0], lBR: [1.8, 0, 0], uFL: [0.2, 0, 0], uFR: [0.2, 0, 0], tail: [0.5, 0, 0] }, b: [-0.12, -0.05, -0.35] }],
  // up on the hind legs, nose to the threat
  alert: [
    { t: 0, p: { chest: [-0.6, 0, 0], neck: [-0.3, 0, 0], head: [0.45, 0, 0], uFL: [-0.9, 0, 0], lFL: [1.2, 0, 0], uFR: [-0.9, 0, 0], lFR: [1.2, 0, 0], uBL: [-0.9, 0, 0], lBL: [1.4, 0, 0], uBR: [-0.9, 0, 0], lBR: [1.4, 0, 0], tail: [0.9, 0, 0] }, b: [0.1, -0.1, -0.95] },
    { t: 1, p: { head: [0.35, 0.25, 0] }, b: [0.12, -0.1, -1.0] },
  ],
  // nose to the ground over a sign
  sniff: [
    { t: 0, p: { neck: [0.7, 0, 0], head: [0.3, 0.2, 0], tail: [0.2, 0, 0] }, b: [-0.05, 0, 0.2] },
    { t: 1, p: { neck: [0.75, 0, 0], head: [0.35, -0.2, 0] }, b: [-0.05, 0, 0.22] },
  ],
}

export function createMarten() {
  const fur = std(0x9a6232, 0.9)
  const dark = std(0x3e2614, 0.9)
  const rig = new Quadruped({ bodyLen: 1.25, height: 0.42, legR: 0.045, fur, dark, runSpeed: 7 })
  const J = rig.joints
  // the cream bib on the throat, round ears, a bushy tail
  part(new THREE.SphereGeometry(0.19, 8, 6), std(0xecd3a0, 0.9), J.chest, 0, -0.06, 0.16).scale.set(0.9, 1.15, 0.8)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.06, 6, 5), dark, J.head, s * 0.1, 0.14, -0.04).scale.set(1, 1, 0.5)
  for (let i = 0; i < 5; i++) part(new THREE.SphereGeometry(0.11 - i * 0.008, 6, 5), fur, J.tail, 0, -0.08 - i * 0.03, -0.18 - i * 0.12).scale.set(1, 1, 1.4)
  // night eyeshine, so she reads in the dark
  const eye = glow(1.4, 0.95, 0.45)
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.034, 6, 4), eye, J.head, s * 0.07, 0.05, 0.13)
  rig.root.scale.setScalar(SCALE)
  rig.root.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return rig
}

export type MartenState = 'trapped' | 'freed' | 'follow' | 'alert' | 'hide' | 'sniff'

export class Marten extends Actor {
  rig: Quadruped
  state: MartenState = 'trapped'
  /** enemies she smells right now (unseen by Timer) */
  readonly sensed: Enemy[] = []
  /** set by the game each frame */
  combat = false
  clue: THREE.Vector3 | null = null
  private st = 0
  private speedNow = 0
  private goal = new THREE.Vector3()
  private alertAt: Enemy | null = null
  private warned = new Set<Enemy>()
  private wanderT = 0
  private whimperT = 2
  private side = 1
  private hideT = 0
  /** the GLB body with its own skeleton and animator (docs/COMPANION.md); the procedural one is the fallback */
  private body: MartenBody | null = null
  private prevFacing = 0
  private moteT = 0

  constructor(w: World, at: THREE.Vector3) {
    super(w)
    this.rig = createMarten()
    w.scene.add(this.rig.root)
    loadMarten('/models/marten.glb')
      .then((b) => {
        this.body = b
        w.scene.add(b.root)
        this.rig.root.visible = false
        b.animator.snap(this.state === 'trapped' ? 'trapped' : 'stand')
        b.root.position.set(this.pos.x, 0, this.pos.z)
        b.root.rotation.y = this.facing
        this.prevFacing = this.facing
      })
      .catch((e) => console.warn('marten.glb', e))
    this.pos.copy(at)
    this.radius = 0.2
    this.facing = 1.2
    this.syncRig()
  }

  /** the trap is opened: she bolts a few steps, then sits and looks back */
  free() {
    const p = this.w.player.pos
    const away = new THREE.Vector3(this.pos.x - p.x, 0, this.pos.z - p.z).normalize()
    this.goal.copy(this.pos).addScaledVector(away, 3.5)
    this.state = 'freed'
    this.st = 0
    this.w.sound('chirr', this.pos, { indicate: false, vol: 0.6 })
  }

  get active() {
    return this.state !== 'trapped' && this.state !== 'freed'
  }

  update(dt: number) {
    const w = this.w
    const p = w.player
    this.st += dt
    let clip: Clip | null = null
    let ct = 0
    let speed = 0
    const toP = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z)

    if (this.state === 'trapped') {
      clip = MARTEN_CLIPS.trapped
      ct = 0.5 + 0.5 * Math.sin(this.st * 7)
      this.whimperT -= dt
      if (this.whimperT <= 0) {
        // heard before she is seen
        this.whimperT = rand(2.6, 4.2)
        w.sound('whimper', this.pos, { tone: 'neutral', strength: 0.7, id: 'marten' })
      }
    } else if (this.state === 'freed') {
      if (this.st < 0.9) speed = this.runTo(this.goal, 5.5, dt)
      else {
        clip = MARTEN_CLIPS.sit
        this.face(p.pos, dt)
        if (this.st > 3.2) this.state = 'follow'
      }
    } else {
      this.sense(dt)
      if (toP > 26) this.catchUp()
      if (this.state === 'alert') {
        clip = MARTEN_CLIPS.alert
        ct = Math.min(1, this.st / 0.4)
        if (this.alertAt) this.face(this.alertAt.pos, dt)
        if (this.st > 1.4) this.state = 'follow'
      } else if (this.combat || (this.state === 'hide' && this.hideT > 0)) {
        // hides for the fight and stays put a moment after it, before creeping back
        if (this.combat) this.hideT = 2.2
        else this.hideT -= dt
        this.state = 'hide'
        // away from the nearest enemy, but within sight of Timer
        const e = this.nearestEnemy()
        const from = e ? e.pos : p.pos
        const dir = new THREE.Vector3(p.pos.x - from.x, 0, p.pos.z - from.z).normalize()
        this.goal.set(p.pos.x + dir.x * 9, 0, p.pos.z + dir.z * 9)
        speed = this.runTo(this.goal, 7, dt)
        if (speed < 0.1) this.face(from, dt)
      } else if (this.clue && Math.hypot(this.clue.x - this.pos.x, this.clue.z - this.pos.z) < 12 && this.sensed.length === 0) {
        // a sign nearby: she finds it first and waits by it
        this.state = 'sniff'
        this.goal.set(this.clue.x + 0.6, 0, this.clue.z + 0.4)
        speed = this.runTo(this.goal, 4.5, dt)
        if (speed < 0.1) {
          clip = MARTEN_CLIPS.sniff
          ct = 0.5 + 0.5 * Math.sin(this.st * 3)
          this.face(this.clue, dt)
        }
      } else {
        this.state = 'follow'
        // stay within Timer's peripheral sight (~4.6 m) but never at his feet; when he moves she scouts a little ahead
        const moving = p.speedNow > 0.5
        if (moving || toP > 4.8 || toP < 3) {
          const ahead = p.facing + this.side * 0.75
          let gx = p.pos.x + Math.sin(ahead) * 3.9
          let gz = p.pos.z + Math.cos(ahead) * 3.9
          if (this.w.field.clearance(gx, gz) < 0.4) {
            // the other side of the path
            this.side = -this.side
            gx = p.pos.x + Math.sin(p.facing - this.side * 0.75) * 3.9
            gz = p.pos.z + Math.cos(p.facing - this.side * 0.75) * 3.9
          }
          this.goal.set(gx, 0, gz)
          speed = this.runTo(this.goal, toP > 8 ? 8 : Math.max(2, p.speedNow * 1.15), dt)
          if (speed < 0.1) this.face(p.pos, dt)
        } else {
          // idle: a sniff here, a few steps there
          this.wanderT -= dt
          if (this.wanderT <= 0) {
            this.wanderT = rand(2.5, 5)
            this.goal.set(this.pos.x + rand(-0.8, 0.8), 0, this.pos.z + rand(-0.8, 0.8))
          }
          speed = this.runTo(this.goal, 1.4, dt)
          if (speed < 0.1) {
            clip = this.st % 7 < 3.5 ? MARTEN_CLIPS.sit : null
            this.face(p.pos, dt)
          }
        }
      }
    }

    this.speedNow = speed
    this.syncRig()
    if (this.body) this.driveBody(dt, clip, toP)
    else this.rig.update(dt, { speed: this.speedNow / SCALE / 2.2, forward: 1, clip, t: ct, time: w.time, snap: this.state === 'alert' ? 2 : 1.2 })
  }

  /** what she is doing → a pose, a gaze and a speed for her animator */
  private driveBody(dt: number, clip: Clip | null, toP: number) {
    const b = this.body!
    const p = this.w.player
    let pose: MartenPose = 'stand'
    if (clip === MARTEN_CLIPS.trapped) pose = 'trapped'
    else if (clip === MARTEN_CLIPS.sit) pose = 'sit'
    else if (clip === MARTEN_CLIPS.alert) pose = 'alert'
    else if (clip === MARTEN_CLIPS.sniff) pose = 'sniff'
    else if (this.state === 'hide' && this.speedNow < 0.3) pose = 'crouch'
    let look: THREE.Vector3 | null = null
    if (pose === 'alert' && this.alertAt) look = this.alertAt.pos
    else if (pose === 'sniff' && this.clue) look = this.clue
    else if (pose === 'crouch') look = this.nearestEnemy()?.pos ?? p.pos
    else if (pose === 'trapped' || this.speedNow < 0.4) look = toP < 14 ? new THREE.Vector3(p.pos.x, 1.2, p.pos.z) : null
    const rate = dt > 0 ? wrapAngle(this.facing - this.prevFacing) / dt : 0
    this.prevFacing = this.facing
    b.root.position.set(this.pos.x, 0, this.pos.z)
    b.root.rotation.y = this.facing
    b.animator.update(dt, { speed: this.speedNow, turnRate: rate, pose, look, time: this.w.time, warn: this.sensed.length > 0 })
    // now and then a golden mote leaves her fur
    this.moteT -= dt
    if (this.moteT <= 0 && pose !== 'trapped') {
      this.moteT = 0.25 + Math.random() * 0.5
      this.w.vfx.add.spawn({ x: this.pos.x + rand(-0.3, 0.3), y: rand(0.2, 0.5), z: this.pos.z + rand(-0.3, 0.3), vx: rand(-0.1, 0.1), vy: rand(0.15, 0.4), vz: rand(-0.1, 0.1), r: 1.6, g: 1.1, b: 0.45, size: rand(0.025, 0.045), life: rand(1, 1.8), drag: 0.6 })
    }
  }

  /** smell: unseen enemies within reach; the first time she smells one, she rears up and chitters */
  private sense(dt: number) {
    void dt
    this.sensed.length = 0
    const p = this.w.player.pos
    for (const e of this.w.enemies) {
      if (!e.alive || e.removed) continue
      if (e.visibleNow && !e.hidden) continue
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > SENSE_R) continue
      this.sensed.push(e)
      if (!this.warned.has(e) && !this.combat && this.state !== 'alert') {
        this.warned.add(e)
        this.alertAt = e
        this.state = 'alert'
        this.st = 0
        this.w.sound('chirr', this.pos, { indicate: false })
      }
    }
  }

  private nearestEnemy() {
    let best: Enemy | null = null
    let bd = 1e9
    for (const e of this.w.enemies) {
      if (!e.alive || e.removed) continue
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z)
      if (d < bd) {
        bd = d
        best = e
      }
    }
    return best
  }

  /** fell far behind (respawn, a closed gate): appear behind Timer, out of his sight */
  private catchUp() {
    const p = this.w.player
    const back = p.gaze + Math.PI
    for (let i = 0; i < 8; i++) {
      const a = back + (i % 2 ? 1 : -1) * Math.floor((i + 1) / 2) * 0.5
      const x = p.pos.x + Math.sin(a) * 6
      const z = p.pos.z + Math.cos(a) * 6
      if (this.w.field.clearance(x, z) > 0.5) {
        this.pos.set(x, 0, z)
        return
      }
    }
  }

  private runTo(goal: THREE.Vector3, max: number, dt: number) {
    const dx = goal.x - this.pos.x
    const dz = goal.z - this.pos.z
    const d = Math.hypot(dx, dz)
    if (d < 0.25) return 0
    const sp = Math.min(max, d * 3)
    this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 10, dt)
    // run where she faces: turns arc instead of sliding
    const k = Math.max(0.2, Math.cos(wrapAngle(Math.atan2(dx, dz) - this.facing)))
    this.move(dt, Math.sin(this.facing) * sp * k, Math.cos(this.facing) * sp * k)
    return sp * k
  }

  private face(at: THREE.Vector3, dt: number) {
    this.facing = dampAngle(this.facing, Math.atan2(at.x - this.pos.x, at.z - this.pos.z), 6, dt)
  }
}
