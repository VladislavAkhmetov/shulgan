import * as THREE from 'three'
import type { World } from '../world'
import type { Enemy } from './enemies'
import { rand } from '../util'
import { EagleRig } from './eagleRig'

/**
 * Kara the golden eagle: rises above the hero, reveals every creature nearby as a warm ghost
 * silhouette through the darkness, then dives at the closest one.
 */
export class Eagle {
  readonly group = new THREE.Group()
  private rig = new EagleRig()
  readonly ready = this.rig.ready
  active = false
  private t = 0
  private phase: 'rise' | 'circle' | 'dive' | 'leave' = 'rise'
  private target: Enemy | null = null
  private from = new THREE.Vector3()
  private center = new THREE.Vector3()
  private w: World
  private prev = new THREE.Vector3()
  private velocity = new THREE.Vector3()
  private diveTo = new THREE.Vector3()
  private circleFrom = new THREE.Vector3()
  private orientation = new THREE.Euler(0, 0, 0, 'YXZ')
  private goalQ = new THREE.Quaternion()
  private heading = 0
  private attacked = false

  constructor(w: World) {
    this.w = w
    this.group.name = 'Kara_Eagle'
    this.group.add(this.rig.root)
    this.group.visible = false
    this.group.scale.setScalar(1.3)
    w.scene.add(this.group)
  }

  release(from: THREE.Vector3) {
    this.active = true
    this.t = 0
    this.phase = 'rise'
    this.from.copy(from)
    this.group.visible = true
    this.group.position.copy(from)
    this.target = null
    this.attacked = false
    this.heading = this.w.player.aimAngle
    this.group.rotation.set(-.45, this.heading, 0, 'YXZ')
    this.rig.sample('climb', 0, 0, true)
    this.w.sound('eagle', from, { indicate: false })
  }

  update(dt: number) {
    if (!this.active || dt <= 0) return
    const w = this.w
    this.t += dt
    const g = this.group
    const p = w.player.pos
    let clip = 'climb'
    let clipTime = this.t
    this.prev.copy(g.position)
    if (this.phase === 'rise') {
      const k = Math.min(1, this.t / 0.7)
      g.position.set(this.from.x, this.from.y + k * 8, this.from.z)
      if (k >= 1) {
        this.phase = 'circle'
        this.t = 0
        this.center.copy(p)
        this.circleFrom.copy(g.position)
        let n = 0
        for (const e of w.enemies) {
          if (!e.alive) continue
          if (e.pos.distanceTo(p) < 24) {
            e.revealT = 6
            n++
          }
        }
        w.vfx.rings.spawn(p.x, p.z, { from: 1, to: 24, dur: 1.2, color: new THREE.Color(1.2, 0.75, 0.3), width: 0.02 })
        w.sound('eagle', g.position, { indicate: false, vol: 0.6 })
        void n
      }
    } else if (this.phase === 'circle') {
      this.center.lerp(p, 1 - Math.exp(-2 * dt))
      const a = this.t * 2.2
      const enter = THREE.MathUtils.smoothstep(this.t, 0, .22)
      g.position.set(
        THREE.MathUtils.lerp(this.circleFrom.x, this.center.x + Math.sin(a) * 6, enter),
        THREE.MathUtils.lerp(this.circleFrom.y, 8.5 + Math.sin(this.t * 3) * .3, enter),
        THREE.MathUtils.lerp(this.circleFrom.z, this.center.z + Math.cos(a) * 6, enter),
      )
      clip = 'circle_left'
      if (this.t > 1.3) {
        let best: Enemy | null = null
        let bd = 18
        for (const e of w.enemies) {
          if (!e.alive || e.hidden || e.state === 'dormant') continue
          const d = e.pos.distanceTo(p)
          if (d < bd) {
            bd = d
            best = e
          }
        }
        this.target = best
        this.phase = best ? 'dive' : 'leave'
        this.from.copy(g.position)
        this.t = 0
      }
    } else if (this.phase === 'dive') {
      const tg = this.target
      const k = Math.min(1, this.t / 0.5)
      if (tg) {
        this.diveTo.set(tg.pos.x, 1.3 + tg.airY, tg.pos.z)
        g.position.lerpVectors(this.from, this.diveTo, k * k)
      }
      clip = this.t < .2 ? 'dive' : 'talon_strike'
      clipTime = this.t < .2 ? this.t / .2 * .5 : this.t - .2
      if (k >= 1) {
        if (tg && tg.alive && !tg.hidden) {
          if (tg.takeHit(14, 18, g.position.x, g.position.z, 3, false, 'eagle')) w.player.noteTool('eagle')
          tg.stun(tg.kind === 'boss' ? 0.6 : 1.6)
          tg.revealT = Math.max(tg.revealT, 3)
          w.sound('eagle', tg.pos, { indicate: false })
          w.sound('hit', tg.pos, { indicate: false, vol: 0.6 })
          for (let i = 0; i < 18; i++) w.vfx.soft.spawn({ x: tg.pos.x, y: 1.4, z: tg.pos.z, vx: rand(-3, 3), vy: rand(0, 3), vz: rand(-3, 3), r: 0.3, g: 0.2, b: 0.1, a: 0.9, size: 0.12, life: 1.2, drag: 2, gravity: 2 })
        }
        this.phase = 'leave'
        this.attacked = true
        this.from.copy(g.position)
        this.t = 0
      }
    } else {
      g.position.y += dt * 9
      g.position.x += dt * 6
      const recoverStart = this.attacked ? .3 : 0
      clip = this.attacked && this.t < .3 ? 'talon_strike' : this.t < recoverStart + .8 ? 'pull_up' : 'climb'
      clipTime = this.attacked && this.t < .3 ? .3 + this.t : Math.max(0, this.t - (clip === 'pull_up' ? recoverStart : recoverStart + .8))
      if (this.t > 1.4) {
        this.active = false
        g.visible = false
      }
    }
    const vel = this.velocity.copy(g.position).sub(this.prev)
    const flat = Math.hypot(vel.x, vel.z)
    if (flat > 1e-6) this.heading = Math.atan2(vel.x, vel.z)
    let pitch = -Math.atan2(vel.y, Math.max(flat, 1e-6))
    pitch = THREE.MathUtils.clamp(pitch, -.85, .95)
    // Level out before talon contact instead of driving the bill into the enemy.
    if (this.phase === 'dive') pitch *= 1 - THREE.MathUtils.smoothstep(this.t, .34, .5)
    if (this.phase === 'leave' && this.attacked && this.t < .12) pitch = 0
    this.orientation.set(pitch, this.heading, 0, 'YXZ')
    this.goalQ.setFromEuler(this.orientation)
    g.quaternion.slerp(this.goalQ, 1 - Math.exp(-20 * dt))
    this.rig.sample(clip, clipTime, dt)
    if (Math.random() < 0.8) w.vfx.add.spawn({ x: g.position.x, y: g.position.y, z: g.position.z, r: 1.4, g: 0.9, b: 0.35, a: 0.6, size: 0.08, life: 0.5 })
  }

  dispose() {
    this.active = false
    this.rig.dispose()
    this.group.removeFromParent()
  }
}
