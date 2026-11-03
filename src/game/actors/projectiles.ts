import * as THREE from 'three'
import type { World } from '../world'
import { glow } from '../render/materials'
import { rand } from '../util'

interface Arrow {
  mesh: THREE.Group
  pos: THREE.Vector3
  dir: THREE.Vector3
  speed: number
  power: number
  mult: number
  fire: boolean
  life: number
  stuck: boolean
  alive: boolean
}

interface Orb {
  mesh: THREE.Group
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  alive: boolean
}

const Z = new THREE.Vector3(0, 0, 1)

export class Projectiles {
  private arrows: Arrow[] = []
  private orbs: Orb[] = []
  private arrowGeo: THREE.BufferGeometry
  private headGeo: THREE.BufferGeometry
  private shaftMat = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.8 })
  private headMat = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4, metalness: 0.7 })
  private orbCore = glow(1.3, 0.5, 2.6)
  private orbHalo = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.12, 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  private w: World

  constructor(w: World) {
    this.w = w
    this.arrowGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4).rotateX(Math.PI / 2)
    this.headGeo = new THREE.ConeGeometry(0.03, 0.1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.44)
  }

  spawnArrow(pos: THREE.Vector3, dir: THREE.Vector3, power: number, fire = false, mult = 1) {
    let a = this.arrows.find((x) => !x.alive)
    if (!a) {
      const g = new THREE.Group()
      g.add(new THREE.Mesh(this.arrowGeo, this.shaftMat), new THREE.Mesh(this.headGeo, this.headMat))
      this.w.scene.add(g)
      a = { mesh: g, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, power: 0, mult: 1, fire: false, life: 0, stuck: false, alive: false }
      this.arrows.push(a)
    }
    a.alive = true
    a.stuck = false
    a.pos.copy(pos)
    a.dir.copy(dir).normalize()
    a.power = power
    a.mult = mult
    a.fire = fire
    a.speed = 26 + power * 20
    a.life = 0.9
    a.mesh.visible = true
    a.mesh.quaternion.setFromUnitVectors(Z, a.dir)
    a.mesh.position.copy(a.pos)
  }

  spawnOrb(pos: THREE.Vector3, dir: THREE.Vector3) {
    let o = this.orbs.find((x) => !x.alive)
    if (!o) {
      const g = new THREE.Group()
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), this.orbCore))
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), this.orbHalo)
      g.add(halo)
      this.w.scene.add(g)
      o = { mesh: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, alive: false }
      this.orbs.push(o)
    }
    o.alive = true
    o.pos.copy(pos)
    o.vel.copy(dir).normalize().multiplyScalar(6.5)
    o.life = 4.5
    o.mesh.visible = true
  }

  /** Arrow stops: fire arrows burn out (and may light a brazier), plain ones wait to be picked up. */
  private land(a: Arrow) {
    a.stuck = true
    a.life = a.fire ? 3 : 90
    this.w.arrowLanded(a.pos, a.fire)
  }

  /** Pick up to `room` plain arrows lying within r of p; the rest stay on the ground. */
  collectNear(p: THREE.Vector3, r: number, room: number) {
    let n = 0
    for (const a of this.arrows) {
      if (n >= room) break
      if (!a.alive || !a.stuck || a.fire) continue
      if (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < r) {
        a.alive = false
        a.mesh.visible = false
        n++
      }
    }
    return n
  }

  clear() {
    for (const a of this.arrows) {
      a.alive = false
      a.mesh.visible = false
    }
    for (const o of this.orbs) {
      o.alive = false
      o.mesh.visible = false
    }
  }

  update(dt: number) {
    const w = this.w
    for (const a of this.arrows) {
      if (!a.alive) continue
      a.life -= dt
      if (a.stuck) {
        if (a.fire && Math.random() < 0.4) w.vfx.add.spawn({ x: a.pos.x, y: a.pos.y, z: a.pos.z, vy: 0.8, r: 2.2, g: 0.9, b: 0.25, size: 0.06, life: 0.5 })
        if (a.life <= 0) {
          a.alive = false
          a.mesh.visible = false
        }
        continue
      }
      if (a.life <= 0) {
        // spent arrows drop to the ground and can be picked up again
        a.pos.y = 0.08
        a.mesh.position.copy(a.pos)
        a.mesh.rotation.x = Math.PI / 2 - 0.2
        this.land(a)
        continue
      }
      const dist = a.speed * dt
      const steps = Math.ceil(dist / 0.3)
      const st = dist / steps
      let done = false
      for (let s = 0; s < steps && !done; s++) {
        a.pos.addScaledVector(a.dir, st)
        for (const e of w.enemies) {
          if (!e.alive || e.hidden || Math.abs(e.airY) > 1.5) continue
          if (Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) < e.radius + 0.25) {
            const hit = e.takeHit((10 + a.power * 22) * a.mult, (6 + a.power * 16) * a.mult, a.pos.x - a.dir.x, a.pos.z - a.dir.z, 2, false, a.fire ? 'fire' : 'arrow')
            if (hit) {
              w.player.noteTool('arrow')
              if (a.fire) e.ignite(3.5)
              w.vfx.hit(a.pos.x, a.pos.y, a.pos.z, a.dir.x, a.dir.z, false, e.bloodColor)
              w.sound('arrow_hit', a.pos, { indicate: false })
              a.alive = false
              a.mesh.visible = false
              done = true
              break
            }
          }
        }
        if (!done && w.field.clearance(a.pos.x, a.pos.z) < -0.1) {
          this.land(a)
          w.sound('arrow_hit', a.pos, { indicate: false, vol: 0.4 })
          done = true
        }
      }
      a.mesh.position.copy(a.pos)
      if (!a.stuck && a.alive) {
        if (a.fire) for (let k = 0; k < 2; k++) w.vfx.add.spawn({ x: a.pos.x, y: a.pos.y, z: a.pos.z, vy: 0.5, r: 2.4, g: 1.0, b: 0.3, a: 0.9, size: 0.09, life: 0.3, drag: 2 })
        else if (Math.random() < 0.6) w.vfx.add.spawn({ x: a.pos.x, y: a.pos.y, z: a.pos.z, r: 0.9, g: 0.6, b: 0.35, a: 0.4, size: 0.05, life: 0.25 })
      }
    }

    const p = w.player
    for (const o of this.orbs) {
      if (!o.alive) continue
      o.life -= dt
      const dx = p.pos.x - o.pos.x
      const dz = p.pos.z - o.pos.z
      const d = Math.hypot(dx, dz)
      // gentle homing
      const cur = Math.atan2(o.vel.x, o.vel.z)
      const want = Math.atan2(dx, dz)
      let diff = want - cur
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const turn = Math.max(-1.4 * dt, Math.min(1.4 * dt, diff))
      const sp = o.vel.length()
      o.vel.set(Math.sin(cur + turn) * sp, 0, Math.cos(cur + turn) * sp)
      o.pos.addScaledVector(o.vel, dt)
      o.pos.y = 1.3 + Math.sin(o.life * 6) * 0.08
      o.mesh.position.copy(o.pos)
      o.mesh.visible = w.vision.sees(o.pos.x, o.pos.z)
      if (o.mesh.visible && Math.random() < 0.8)
        w.vfx.add.spawn({ x: o.pos.x + rand(-0.08, 0.08), y: o.pos.y + rand(-0.08, 0.08), z: o.pos.z + rand(-0.08, 0.08), r: 0.7, g: 0.25, b: 1.5, size: 0.1, life: 0.4, drag: 2 })
      let kill = o.life <= 0 || w.field.clearance(o.pos.x, o.pos.z) < -0.2
      if (!kill && d < p.radius + 0.25 && p.airY < 1) {
        const r = p.takeHit({ dmg: 12, x: o.pos.x - o.vel.x, z: o.pos.z - o.vel.z, knock: 3 })
        if (r === 'perfect') w.perfectDodge()
        if (r === 'hit' || r === 'immune') kill = true
      }
      if (kill) {
        o.alive = false
        o.mesh.visible = false
        for (let i = 0; i < 14; i++) w.vfx.add.spawn({ x: o.pos.x, y: o.pos.y, z: o.pos.z, vx: rand(-3, 3), vy: rand(-1, 3), vz: rand(-3, 3), r: 0.8, g: 0.3, b: 1.6, size: 0.08, life: 0.5, drag: 3 })
      }
    }
  }
}
