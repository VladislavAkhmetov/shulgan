import * as THREE from 'three'
import { Actor } from './actor'
import { Rig, type Spring, type V3 } from './rig'
import { loadMarten, type MartenBody, type MartenPose } from './martenRig'
import type { Enemy } from './enemies'
import type { World } from '../world'
import { dampAngle, rand, wrapAngle } from '../util'

/**
 * Susar, the pine marten Timer frees from a trap mid-way through the urman (docs/COMPANION.md).
 * She keeps her distance, hides when blood is spilled, and smells what Timer cannot see:
 * every unseen enemy within reach is marked for him (Game draws the marks).
 */

const SENSE_R = 22

/** Actor transform only; the loaded skin is the sole visible companion. */
class MartenSceneRig extends Rig {
  protected springFor(): Spring { return [6, 1, 0] }
  protected locomotion(): V3 { return [0, 0, 0] }
}

export type MartenState = 'trapped' | 'freed' | 'follow' | 'alert' | 'hide' | 'sniff'

export class Marten extends Actor {
  rig: MartenSceneRig
  readonly ready: Promise<boolean>
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
  /** The current 45-bone companion, shared with the model viewer. */
  private body: MartenBody | null = null
  private prevFacing = 0
  private moteT = 0
  private idleT = 0
  private wakeT = 0

  constructor(w: World, at: THREE.Vector3) {
    super(w)
    this.rig = new MartenSceneRig()
    w.scene.add(this.rig.root)
    this.ready = loadMarten('/models/marten.glb')
      .then((b) => {
        this.body = b
        this.rig.root.add(b.root)
        b.animator.snap(this.state === 'trapped' ? 'trapped' : 'stand')
        b.root.position.set(0, 0, 0)
        b.root.rotation.y = 0
        this.prevFacing = this.facing
        return true
      })
      .catch((e) => { console.warn('marten.glb', e); return false })
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
    let pose: MartenPose = 'stand'
    let speed = 0
    const toP = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z)
    const canRest = this.state === 'follow' && p.speedNow < 0.2 && toP >= 3 && toP <= 4.8 && !this.combat && !this.clue && this.sensed.length === 0
    if (canRest) this.idleT += dt
    else { if (this.idleT > 8) this.wakeT = 1.2; this.idleT = 0 }
    this.wakeT = Math.max(0, this.wakeT - dt)

    if (this.state === 'trapped') {
      pose = 'trapped'
      this.whimperT -= dt
      if (this.whimperT <= 0) {
        // heard before she is seen
        this.whimperT = rand(2.6, 4.2)
        w.sound('whimper', this.pos, { tone: 'neutral', strength: 0.7, id: 'marten' })
      }
    } else if (this.state === 'freed') {
      if (this.st < 0.9) speed = this.runTo(this.goal, 5.5, dt)
      else {
        pose = 'sit'
        this.face(p.pos, dt)
        if (this.st > 3.2) this.state = 'follow'
      }
    } else {
      this.sense(dt)
      if (toP > 26) this.catchUp()
      if (this.state === 'alert') {
        pose = 'alert'
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
          pose = 'sniff'
          this.face(this.clue, dt)
        }
      } else {
        this.state = 'follow'
        // stay within Timer's peripheral sight (~4.6 m) but never at his feet; when he moves she scouts a little ahead
        const moving = p.speedNow > 0.5
        if (this.wakeT > 0 && !this.combat) {
          this.face(p.pos, dt)
        } else if (this.idleT > 8) {
          pose = 'curl'
        } else if (moving || toP > 4.8 || toP < 3) {
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
            pose = this.st % 7 < 3.5 ? 'sit' : 'stand'
            this.face(p.pos, dt)
          }
        }
      }
    }

    this.speedNow = speed
    this.syncRig()
    if (this.body) this.driveBody(dt, pose, toP)
  }

  /** what she is doing → a pose, a gaze and a speed for her animator */
  private driveBody(dt: number, pose: MartenPose, toP: number) {
    const b = this.body!
    const p = this.w.player
    if (this.state === 'hide' && this.speedNow < 0.3) pose = 'crouch'
    let look: THREE.Vector3 | null = null
    if (pose === 'alert' && this.alertAt) look = this.alertAt.pos
    else if (pose === 'sniff' && this.clue) look = this.clue
    else if (pose === 'crouch') look = this.nearestEnemy()?.pos ?? p.pos
    else if (pose === 'trapped' || this.speedNow < 0.4) look = toP < 14 ? new THREE.Vector3(p.pos.x, 1.2, p.pos.z) : null
    const rate = dt > 0 ? wrapAngle(this.facing - this.prevFacing) / dt : 0
    this.prevFacing = this.facing
    // syncRig owns world placement; the skin stays local to the actor root.
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
