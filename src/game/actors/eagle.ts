import * as THREE from 'three'
import type { World } from '../world'
import type { Enemy } from './enemies'
import { rand } from '../util'

/**
 * Kara the golden eagle: rises above the hero, reveals every creature nearby as a warm ghost
 * silhouette through the darkness, then dives at the closest one.
 */
export class Eagle {
  readonly group = new THREE.Group()
  private wingL = new THREE.Group()
  private wingR = new THREE.Group()
  active = false
  private t = 0
  private phase: 'rise' | 'circle' | 'dive' | 'leave' = 'rise'
  private target: Enemy | null = null
  private from = new THREE.Vector3()
  private center = new THREE.Vector3()
  private w: World

  constructor(w: World) {
    this.w = w
    const body = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.8, emissive: new THREE.Color(0.35, 0.2, 0.05), emissiveIntensity: 0.8 })
    const head = new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.7, emissive: new THREE.Color(0.3, 0.25, 0.15), emissiveIntensity: 0.6 })
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 3, 8).rotateX(Math.PI / 2), body)
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), head)
    h.position.set(0, 0.05, 0.32)
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 4).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8a030 }))
    beak.position.set(0, 0.03, 0.43)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.25), body)
    tail.position.set(0, 0, -0.36)
    for (const [wing, s] of [
      [this.wingL, 1],
      [this.wingR, -1],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.02, 0.32).translate(s * 0.42, 0, 0), body)
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.22).translate(s * 0.2, 0, -0.04), body)
      tip.position.x = s * 0.84
      wing.add(m, tip)
      wing.position.set(s * 0.08, 0.04, 0.05)
      this.group.add(wing)
    }
    this.group.add(torso, h, beak, tail)
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
    this.w.sound('eagle', from, { indicate: false })
  }

  update(dt: number) {
    if (!this.active) return
    const w = this.w
    this.t += dt
    const g = this.group
    const p = w.player.pos
    let flap = 0
    const prev = g.position.clone()
    if (this.phase === 'rise') {
      const k = Math.min(1, this.t / 0.7)
      g.position.set(this.from.x, this.from.y + k * 8, this.from.z)
      flap = Math.sin(this.t * 22) * 0.9
      if (k >= 1) {
        this.phase = 'circle'
        this.t = 0
        this.center.copy(p)
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
      g.position.set(this.center.x + Math.sin(a) * 6, 8.5 + Math.sin(this.t * 3) * 0.3, this.center.z + Math.cos(a) * 6)
      flap = Math.sin(this.t * 6) * 0.25
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
        const to = new THREE.Vector3(tg.pos.x, 1.3 + tg.airY, tg.pos.z)
        g.position.lerpVectors(this.from, to, k * k)
      }
      flap = -0.6
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
        this.from.copy(g.position)
        this.t = 0
      }
    } else {
      g.position.y += dt * 9
      g.position.x += dt * 6
      flap = Math.sin(this.t * 20) * 0.9
      if (this.t > 1.4) {
        this.active = false
        g.visible = false
      }
    }
    this.wingL.rotation.z = flap
    this.wingR.rotation.z = -flap
    const vel = g.position.clone().sub(prev)
    if (vel.lengthSq() > 1e-6) g.lookAt(g.position.clone().add(vel))
    if (Math.random() < 0.8) w.vfx.add.spawn({ x: g.position.x, y: g.position.y, z: g.position.z, r: 1.4, g: 0.9, b: 0.35, a: 0.6, size: 0.08, life: 0.5 })
  }
}
