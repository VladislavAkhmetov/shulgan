import * as THREE from 'three'
import type { World } from '../world'
import type { Enemy } from './enemies'
import { glow } from '../render/materials'
import { rand } from '../util'

interface Arrow {
  mesh: THREE.Group
  /** a faint amber glint on a lying arrow (the raven feather keepsake) */
  mark: THREE.Mesh
  pos: THREE.Vector3
  dir: THREE.Vector3
  speed: number
  dmg: number
  fire: boolean
  /** a shot at the peak of the draw: through the small ones, sets off marks */
  pierce: boolean
  hit: Set<Enemy>
  life: number
  stuck: boolean
  alive: boolean
}

interface Orb {
  mesh: THREE.Group
  /** a morok's cold light, Shurale's stump, a barrow archer's arrow, a water spear of Хыу инәһе */
  kind: 'orb' | 'log' | 'earrow' | 'spear'
  dmg: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  alive: boolean
}

export interface ArrowOpts {
  fire?: boolean
  pierce?: boolean
  dmg: number
}

const Z = new THREE.Vector3(0, 0, 1)

export class Projectiles {
  private arrows: Arrow[] = []
  private orbs: Orb[] = []
  private arrowGeo: THREE.BufferGeometry
  private headGeo: THREE.BufferGeometry
  private shaftMat = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.8 })
  private headMat = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4, metalness: 0.7 })
  private markMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.7, 0.25), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  private orbCore = glow(1.3, 0.5, 2.6)
  private orbHalo = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.12, 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  private logMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 })
  private mossMat = new THREE.MeshStandardMaterial({ color: 0x1e2a14, roughness: 1 })
  private ghostTip = glow(0.4, 1.8, 1.7)
  private spearMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.7, 0.9), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
  private w: World

  constructor(w: World) {
    this.w = w
    this.arrowGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4).rotateX(Math.PI / 2)
    this.headGeo = new THREE.ConeGeometry(0.03, 0.1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.44)
  }

  private take(): Arrow {
    let a = this.arrows.find((x) => !x.alive)
    if (!a) {
      const g = new THREE.Group()
      g.add(new THREE.Mesh(this.arrowGeo, this.shaftMat), new THREE.Mesh(this.headGeo, this.headMat))
      const mark = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12).rotateX(-Math.PI / 2), this.markMat)
      mark.visible = false
      this.w.scene.add(g, mark)
      a = { mesh: g, mark, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, dmg: 0, fire: false, pierce: false, hit: new Set(), life: 0, stuck: false, alive: false }
      this.arrows.push(a)
    }
    return a
  }

  spawnArrow(pos: THREE.Vector3, dir: THREE.Vector3, power: number, o: ArrowOpts) {
    const a = this.take()
    a.alive = true
    a.stuck = false
    a.pos.copy(pos)
    a.dir.copy(dir).normalize()
    a.dmg = o.dmg
    a.fire = !!o.fire
    a.pierce = !!o.pierce
    a.hit.clear()
    a.speed = 26 + power * 20 + (a.pierce ? 10 : 0)
    a.life = 0.9
    a.mesh.visible = true
    a.mark.visible = false
    a.mesh.quaternion.setFromUnitVectors(Z, a.dir)
    a.mesh.position.copy(a.pos)
  }

  /** an arrow already standing in a trunk or in the ground, waiting to be pulled out (docs/LEVELS.md) */
  spawnStuck(pos: THREE.Vector3, dir: THREE.Vector3) {
    const a = this.take()
    a.alive = true
    a.stuck = true
    a.fire = false
    a.pos.copy(pos)
    a.dir.copy(dir).normalize()
    a.life = Infinity
    a.mesh.visible = true
    a.mesh.quaternion.setFromUnitVectors(Z, a.dir)
    a.mesh.position.copy(a.pos)
    a.mark.position.set(a.pos.x, 0.04, a.pos.z)
  }

  /** a barrow archer's arrow: straight and fast; the kalkan stops it, a parry knocks it away */
  spawnEnemyArrow(pos: THREE.Vector3, dir: THREE.Vector3, dmg = 11) {
    const o = this.takeOrb('earrow')
    o.pos.copy(pos)
    o.vel.copy(dir).setY(0).normalize().multiplyScalar(19)
    o.life = 1.6
    o.dmg = dmg
    o.mesh.quaternion.setFromUnitVectors(Z, o.vel.clone().normalize())
  }

  /** a spear of black water (Хыу инәһе): it flies over the lake, the kalkan stops it */
  spawnSpear(pos: THREE.Vector3, dir: THREE.Vector3, dmg = 13) {
    const o = this.takeOrb('spear')
    o.pos.copy(pos)
    o.vel.copy(dir).setY(0).normalize().multiplyScalar(13)
    o.life = 2.6
    o.dmg = dmg
    o.mesh.quaternion.setFromUnitVectors(Z, o.vel.clone().normalize())
  }

  spawnOrb(pos: THREE.Vector3, dir: THREE.Vector3) {
    const o = this.takeOrb('orb')
    o.pos.copy(pos)
    o.vel.copy(dir).normalize().multiplyScalar(6.5)
    o.life = 4.5
  }

  /** Shurale's rotten stump, torn out of the moss and thrown */
  spawnLog(pos: THREE.Vector3, dir: THREE.Vector3) {
    const o = this.takeOrb('log')
    o.pos.copy(pos)
    o.vel.copy(dir).normalize().multiplyScalar(12)
    o.life = 2.2
  }

  private takeOrb(kind: Orb['kind']) {
    let o = this.orbs.find((x) => !x.alive && x.kind === kind)
    if (!o) {
      const g = new THREE.Group()
      if (kind === 'orb') {
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), this.orbCore))
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), this.orbHalo))
      } else if (kind === 'earrow') {
        g.add(new THREE.Mesh(this.arrowGeo, this.shaftMat), new THREE.Mesh(this.headGeo, this.headMat))
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), this.ghostTip))
      } else if (kind === 'spear') {
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1.3, 6).rotateX(Math.PI / 2), this.spearMat)
        g.add(s)
      } else {
        const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.8, 8), this.logMat)
        stump.rotation.z = Math.PI / 2
        const moss = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), this.mossMat)
        moss.position.y = 0.2
        moss.scale.set(1.4, 0.5, 1)
        g.add(stump, moss)
        g.traverse((m) => (m.castShadow = true))
      }
      this.w.scene.add(g)
      o = { mesh: g, kind, dmg: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, alive: false }
      this.orbs.push(o)
    }
    o.alive = true
    o.mesh.visible = true
    return o
  }

  /** The arrow stops: it stays in wood and earth, breaks on stone, burns up in thorns. */
  private land(a: Arrow) {
    const fate = this.w.arrowLanded(a.pos, a.fire)
    if (fate === 'keep') {
      a.stuck = true
      a.life = Infinity
      a.mark.position.set(a.pos.x, 0.04, a.pos.z)
      return
    }
    a.alive = false
    a.mesh.visible = false
    a.mark.visible = false
    if (fate === 'break') {
      for (let i = 0; i < 10; i++) this.w.vfx.add.spawn({ x: a.pos.x, y: a.pos.y, z: a.pos.z, vx: rand(-3, 3) - a.dir.x * 2, vy: rand(0.5, 3), vz: rand(-3, 3) - a.dir.z * 2, r: 1.6, g: 1.2, b: 0.7, size: 0.03, life: 0.3, drag: 3, gravity: 6 })
      this.w.sound('clang', a.pos, { indicate: false, vol: 0.3 })
    }
  }

  /** Pick up to `room` arrows lying or standing within r of p; the rest stay. */
  collectNear(p: THREE.Vector3, r: number, room: number) {
    let n = 0
    for (const a of this.arrows) {
      if (n >= room) break
      if (!a.alive || !a.stuck) continue
      if (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < r) {
        a.alive = false
        a.mesh.visible = false
        a.mark.visible = false
        n++
      }
    }
    return n
  }

  /** arrows lying about (for the companion's and the HUD's sake) */
  get lying() {
    return this.arrows.filter((a) => a.alive && a.stuck).map((a) => a.pos)
  }

  /** flying projectiles go; arrows in wood and on the ground stay where they are */
  clear() {
    for (const a of this.arrows) {
      if (a.alive && a.stuck) continue
      a.alive = false
      a.mesh.visible = false
      a.mark.visible = false
    }
    for (const o of this.orbs) {
      o.alive = false
      o.mesh.visible = false
    }
  }

  update(dt: number) {
    const w = this.w
    const feather = w.kit.keepsakes.has('feather')
    for (const a of this.arrows) {
      if (!a.alive) continue
      a.life -= dt
      if (a.stuck) {
        a.mark.visible = feather
        if (feather) (a.mark.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.15 * Math.sin(w.time * 3 + a.pos.x)
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
        if (w.arrowProbe(a.pos, a.fire)) {
          // something along the way took the arrow (a raven's nest, a perched Shurale)
          a.pos.y = 0.08
          a.mesh.rotation.x = Math.PI / 2 - 0.2
          this.land(a)
          done = true
          break
        }
        for (const e of w.enemies) {
          if (!e.alive || e.hidden || e.cloakedNow || a.hit.has(e) || Math.abs(e.airY) > 1.8) continue
          // an arrow loosed up at the leader on his ledge finds him over the rim of the stone
          if (Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) < e.radius + 0.25 + (e.ledge ? 1.1 : 0)) {
            a.hit.add(e)
            if (e.arrowBreaks()) {
              // the armour of the dead: the head shatters on it like on ice
              for (let i = 0; i < 12; i++) w.vfx.add.spawn({ x: a.pos.x, y: a.pos.y, z: a.pos.z, vx: rand(-3, 3) - a.dir.x * 2, vy: rand(0.5, 3), vz: rand(-3, 3) - a.dir.z * 2, r: 0.4, g: 1.8, b: 1.7, size: 0.04, life: 0.35, drag: 3, gravity: 6 })
              w.sound('clang', a.pos, { indicate: false, vol: 0.5 })
              w.toast('Стрела сломалась о броню духов', 'warn', 'arrow')
              a.alive = false
              a.mesh.visible = false
              done = true
              break
            }
            // the boss may answer an arrow in his own way (the horn during the stump throw)
            if (e.onArrow(a.pos.x - a.dir.x, a.pos.z - a.dir.z)) {
              w.sound('arrow_hit', a.pos, { indicate: false })
              a.alive = false
              a.mesh.visible = false
              e.arrowsIn++
              done = true
              break
            }
            const hit = e.takeHit(a.dmg, (6 + a.dmg * 0.5) * (a.pierce ? 1.4 : 1), a.pos.x - a.dir.x, a.pos.z - a.dir.z, a.pierce ? 4 : 2, false, a.fire ? 'fire' : 'arrow')
            if (hit) {
              if (a.fire) e.ignite(3.5)
              if (a.pierce) e.detonateMarks()
              w.vfx.hit(a.pos.x, a.pos.y, a.pos.z, a.dir.x, a.dir.z, a.pierce, e.bloodColor)
              w.sound('arrow_hit', a.pos, { indicate: false })
              if (!a.pierce || e.weight === 'heavy') {
                // it stays in the body; it falls out by the body once the creature is down
                e.arrowsIn++
                a.alive = false
                a.mesh.visible = false
                done = true
                break
              }
            }
          }
        }
        // deep water does not stop an arrow: it flies on over the black lakes to the far bank
        if (!done && w.field.seeClearance(a.pos.x, a.pos.z) < -0.1) {
          this.land(a)
          if (a.alive) w.sound('arrow_hit', a.pos, { indicate: false, vol: 0.4 })
          done = true
        }
      }
      a.mesh.position.copy(a.pos)
      if (!a.stuck && a.alive) {
        if (a.fire) for (let k = 0; k < 2; k++) w.vfx.add.spawn({ x: a.pos.x, y: a.pos.y, z: a.pos.z, vy: 0.5, r: 2.4, g: 1.0, b: 0.3, a: 0.9, size: 0.09, life: 0.3, drag: 2 })
        else if (a.pierce) w.vfx.add.spawn({ x: a.pos.x, y: a.pos.y, z: a.pos.z, r: 1.8, g: 1.3, b: 0.6, a: 0.8, size: 0.07, life: 0.3 })
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
      if (o.kind === 'orb') {
        // gentle homing
        const cur = Math.atan2(o.vel.x, o.vel.z)
        const want = Math.atan2(dx, dz)
        let diff = want - cur
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        const turn = Math.max(-1.4 * dt, Math.min(1.4 * dt, diff))
        const sp = o.vel.length()
        o.vel.set(Math.sin(cur + turn) * sp, 0, Math.cos(cur + turn) * sp)
      }
      o.pos.addScaledVector(o.vel, dt)
      const straight = o.kind === 'earrow' || o.kind === 'spear'
      o.pos.y = o.kind === 'orb' ? 1.3 + Math.sin(o.life * 6) * 0.08 : straight ? 1.2 : 1.0 + Math.sin(o.life * 3) * 0.3
      o.mesh.position.copy(o.pos)
      if (o.kind === 'log') o.mesh.rotation.x += dt * 8
      o.mesh.visible = w.vision.sees(o.pos.x, o.pos.z) || o.kind === 'spear'
      if (o.kind === 'orb' && o.mesh.visible && Math.random() < 0.8)
        w.vfx.add.spawn({ x: o.pos.x + rand(-0.08, 0.08), y: o.pos.y + rand(-0.08, 0.08), z: o.pos.z + rand(-0.08, 0.08), r: 0.7, g: 0.25, b: 1.5, size: 0.1, life: 0.4, drag: 2 })
      if (o.kind === 'spear' && Math.random() < 0.9) w.vfx.add.spawn({ x: o.pos.x + rand(-0.1, 0.1), y: o.pos.y, z: o.pos.z + rand(-0.1, 0.1), vy: rand(-0.5, 0.5), r: 0.3, g: 0.65, b: 0.9, a: 0.7, size: 0.08, life: 0.35, drag: 2, gravity: 4 })
      // arrows and spears fly over the black water; the morok's lights and the stump keep low over the ground
      let kill = o.life <= 0 || (straight ? w.field.seeClearance(o.pos.x, o.pos.z) < -0.15 : w.field.clearance(o.pos.x, o.pos.z) < -0.2)
      const reach = o.kind === 'log' ? 0.65 : 0.25
      if (!kill && d < p.radius + reach && p.airY < 1) {
        // the cold lights are not iron: the kalkan does not stop them; the stump, the arrows and the water spears it does
        const from = { x: o.pos.x - o.vel.x, z: o.pos.z - o.vel.z }
        const r = p.takeHit(
          o.kind === 'log'
            ? { dmg: 18, ...from, knock: 7, heavy: true }
            : straight
              ? { dmg: o.dmg, ...from, knock: o.kind === 'spear' ? 4 : 2 }
              : { dmg: 12, ...from, knock: 3, unblockable: true },
        )
        if (r === 'perfect') w.perfectDodge()
        if (r !== 'iframe' && r !== 'perfect') kill = true
      }
      if (kill) {
        o.alive = false
        o.mesh.visible = false
        if (o.kind === 'orb') for (let i = 0; i < 14; i++) w.vfx.add.spawn({ x: o.pos.x, y: o.pos.y, z: o.pos.z, vx: rand(-3, 3), vy: rand(-1, 3), vz: rand(-3, 3), r: 0.8, g: 0.3, b: 1.6, size: 0.08, life: 0.5, drag: 3 })
        else if (o.kind === 'spear') for (let i = 0; i < 16; i++) w.vfx.add.spawn({ x: o.pos.x, y: o.pos.y, z: o.pos.z, vx: rand(-3, 3), vy: rand(0, 3), vz: rand(-3, 3), r: 0.3, g: 0.6, b: 0.85, a: 0.8, size: 0.07, life: 0.5, drag: 2, gravity: 8 })
        else if (o.kind === 'earrow') w.sound('arrow_hit', o.pos, { indicate: false, vol: 0.4 })
        else {
          w.sound('crack', o.pos, { indicate: false, vol: 0.8 })
          w.vfx.dust(o.pos.x, o.pos.z, 16, 1.2, new THREE.Color(0.14, 0.11, 0.08))
          for (let i = 0; i < 16; i++) w.vfx.soft.spawn({ x: o.pos.x, y: o.pos.y, z: o.pos.z, vx: rand(-4, 4), vy: rand(0, 4), vz: rand(-4, 4), r: 0.12, g: 0.09, b: 0.06, a: 0.9, size: rand(0.06, 0.12), life: 1, drag: 1.5, gravity: 8 })
        }
      }
    }
  }
}
