import * as THREE from 'three'
import { Enemy } from './enemies'
import type { BossLike } from './boss'
import { createShulgen, SHULGEN_CLIPS, type ShulgenModel } from './models2'
import type { Clip, Rig } from './rig'
import type { World } from '../world'
import type { AttackDef } from '../types'
import { rand, smoothstep } from '../util'

const SILVER = new THREE.Color(1.3, 1.45, 1.7)
const C1: AttackDef = { dur: 0.95, hitStart: 0.44, hitEnd: 0.56, range: 2.9, arc: 130, dmg: 16, knock: 4, lunge: 1.4, lungeStart: 0.4, lungeEnd: 0.55, cd: 0.05, phases: [['cut1', 0, 1]], swing: 'swing', slash: { dir: 1, tilt: 0.15, scale: 1.4, color: SILVER } }
const C2: AttackDef = { dur: 0.85, hitStart: 0.4, hitEnd: 0.52, range: 2.9, arc: 130, dmg: 16, knock: 4, lunge: 1.2, lungeStart: 0.36, lungeEnd: 0.5, cd: 0.05, phases: [['cut2', 0, 1]], swing: 'swing', slash: { dir: -1, tilt: -0.15, scale: 1.4, color: SILVER } }
const C3: AttackDef = { dur: 1.25, hitStart: 0.52, hitEnd: 0.62, range: 3.1, arc: 70, dmg: 23, heavy: true, knock: 7, lunge: 1.8, lungeStart: 0.48, lungeEnd: 0.6, cd: 1.3, phases: [['cut3', 0, 1]], swing: 'swing_heavy', slash: { dir: 1, tilt: 1.4, scale: 1.6, color: SILVER } }
const STEP_CUT: AttackDef = { dur: 0.8, hitStart: 0.34, hitEnd: 0.5, range: 2.8, arc: 150, dmg: 24, knock: 8, unblockable: true, cd: 0.9, phases: [['step', 0, 1]], swing: 'swing_heavy', slash: { dir: 1, tilt: 0.1, scale: 1.5, color: SILVER } }

type Sub = 'none' | 'rise' | 'roar' | 'vanish' | 'behind' | 'drink' | 'tread'

const DRINK_T = 3.2
const ZONE_R = 2.3

interface IceZone {
  pos: THREE.Vector3
  mesh: THREE.Group
  t: number
  hurt: number
}

/**
 * Shulgen at the Eternal spring (docs/COMBAT.md, the last boss). No vessel, no Susar: the summit is lit only by the bowl.
 * Phase 1 (100 → 50%): «Серебряный полумесяц» — a series of three cuts; a parry strikes sparks that light the summit for
 * 4 s and opens a window for a point-blank arrow. «Шаг сквозь тень» — he steps behind Aldar in frost; the scar on Aldar's
 * chest flares 0.6 s before the blow. Phase 2 (50 → 0%): «Глоток из Йәншишмә» — he kneels to heal at the bowl (Kara or an
 * arrow breaks it); «Поступь Албасты» — fields of ice round the bowl keep Aldar at a distance.
 */
export class Shulgen extends Enemy implements BossLike {
  kind = 'boss' as const
  clips = SHULGEN_CLIPS
  rig: Rig
  title = 'брат Урал-батыра, бессмертный'
  phase = 1
  fightStarted = false
  perch: THREE.Vector3 | null = null
  readonly model: ShulgenModel
  readonly spawn = new THREE.Vector3()
  private basin: THREE.Vector3
  private sub: Sub = 'none'
  private lastAtk: AttackDef | null = null
  private stepCd = 7
  private drinkCd = 6
  private treadCd = 4
  private behindAt = new THREE.Vector3()
  private zones: IceZone[] = []
  private zoneMat: THREE.MeshStandardMaterial
  /** a parry opened him: arrows bite twice as deep for a moment */
  openT = 0

  constructor(w: World, x: number, z: number, basin: THREE.Vector3) {
    super(w, x, z)
    this.model = createShulgen()
    this.rig = this.model.rig
    w.scene.add(this.rig.root)
    this.spawn.set(x, 0, z)
    this.basin = basin.clone()
    this.weight = 'heavy'
    this.hp = this.maxHp = 1300
    this.maxPosture = 280
    this.speed = 4.4
    this.radius = 0.6
    this.stagDur = 3
    this.stepEvery = 0.55
    this.stepSound = 'step_heavy'
    this.stepStrength = 0.7
    this.name = 'Шульген'
    this.bloodColor = new THREE.Color(0.6, 0.7, 0.85)
    this.zoneMat = new THREE.MeshStandardMaterial({ color: 0xbcd4e0, roughness: 0.2, emissive: new THREE.Color(0.08, 0.14, 0.2), transparent: true, opacity: 0.85 })
    this.toSeat()
  }

  /** he sits on his stone at the bowl until Aldar comes */
  private toSeat() {
    this.state = 'dormant'
    this.forceHidden = false
    this.facing = Math.atan2(this.basin.x - this.pos.x, this.basin.z - this.pos.z)
  }

  resetBoss() {
    this.alive = true
    this.removed = false
    this.hp = this.maxHp
    this.posture = 0
    this.phase = 1
    this.fightStarted = false
    this.aggro = false
    this.hidden = false
    this.atk = null
    this.sub = 'none'
    this.pos.copy(this.spawn)
    this.vel.set(0, 0, 0)
    this.stepCd = 7
    this.drinkCd = 6
    this.treadCd = 4
    this.openT = 0
    this.arrowsIn = 0
    for (const z of this.zones) this.w.scene.remove(z.mesh)
    this.zones = []
    this.rig.root.position.y = 0
    this.rig.root.visible = true
    this.toSeat()
    this.setState('dormant')
  }

  startFight() {
    this.fightStarted = true
    this.aggro = true
    this.sub = 'rise'
    this.setState('special')
  }

  becomeAggro() {}
  hearNoise() {}
  protected canFlinch() {
    return false
  }

  damageMult(source: string) {
    // the window a parry opens: an arrow point-blank goes in twice as deep
    if (this.openT > 0 && source === 'arrow') return 2
    return 1
  }

  /** the kalkan met the silver crescent: sparks light the summit, and he stands open for a breath */
  parried() {
    super.parried()
    this.lastAtk = null
    this.openT = 2.4
    if (this.state === 'stun') this.stunT = Math.max(this.stunT, 2.2)
    this.w.bossEvent('flare')
  }

  /** Kara's claws knock the water out of his hands at the bowl */
  eagleStrike() {
    if (this.sub === 'drink') return this.spill()
    super.eagleStrike()
  }

  takeHit(dmg: number, posture: number, fromX: number, fromZ: number, knock: number, heavy: boolean, source: 'melee' | 'arrow' | 'eagle' | 'fire'): boolean {
    if (this.state === 'special' && this.sub === 'drink' && source === 'arrow' && this.alive) {
      const r = super.takeHit(dmg, posture, fromX, fromZ, knock, heavy, source)
      this.spill()
      return r
    }
    return super.takeHit(dmg, posture, fromX, fromZ, knock, heavy, source)
  }

  /** the sip is struck out of his hand: the water spills back into the bowl and he reels */
  private spill() {
    if (this.sub !== 'drink') return
    const w = this.w
    this.sub = 'none'
    w.sound('splash', this.pos, { indicate: false })
    for (let i = 0; i < 30; i++) w.vfx.add.spawn({ x: this.pos.x, y: 1.1, z: this.pos.z, vx: rand(-3, 3), vy: rand(1, 4), vz: rand(-3, 3), r: 1.6, g: 1.8, b: 2.2, size: 0.06, life: 0.6, drag: 1, gravity: 8 })
    this.hp -= 45
    this.rig.hitFlash()
    w.toast('Глоток выбит из его руки', 'info', 'water')
    if (this.hp <= 0) this.die()
    else this.enterStagger()
  }

  protected think(dt: number) {
    const p = this.w.player
    const d = this.distToPlayer
    this.stepCd -= dt
    this.drinkCd -= dt
    this.treadCd -= dt
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2
      this.sub = 'roar'
      this.drinkCd = 3
      this.treadCd = 1.5
      this.setState('special')
      return
    }
    if (this.phase === 2 && this.drinkCd <= 0 && this.hp < this.maxHp * 0.85) {
      this.drinkCd = rand(15, 18)
      this.behindAt.copy(this.basin).add(new THREE.Vector3(this.pos.x - this.basin.x, 0, this.pos.z - this.basin.z).setLength(2.7))
      return this.startVanish()
    }
    if (this.phase === 2 && this.treadCd <= 0) return this.startTread()
    if (this.stepCd <= 0 && d > 3 && d < 15) {
      this.stepCd = this.phase === 2 ? rand(7, 9) : rand(9, 12)
      this.behindAt.set(0, 0, 0)
      return this.startVanish()
    }
    if (this.atkCd <= 0 && d < 3.0) {
      this.lastAtk = C1
      this.startAttack(C1)
      return
    }
    this.steerTo(p.pos.x, p.pos.z, this.phase === 2 ? 5 : this.speed, 2.2)
  }

  protected onAttackEnd() {
    // the silver crescent: three cuts in a row
    if (!this.alive || this.state !== 'chase' || this.distToPlayer > 4.5) return
    if (this.lastAtk === C1) {
      this.lastAtk = C2
      this.startAttack(C2)
    } else if (this.lastAtk === C2) {
      this.lastAtk = C3
      this.startAttack(C3)
    } else this.lastAtk = null
  }

  private startVanish() {
    this.sub = 'vanish'
    this.setState('special')
    this.emit('teleport', 'threat', 0.8)
  }

  private startTread() {
    this.treadCd = rand(9, 11)
    const p = this.w.player.pos
    const spots = [new THREE.Vector3(p.x, 0, p.z)]
    const a0 = Math.random() * Math.PI * 2
    for (let i = 0; i < 3; i++) spots.push(new THREE.Vector3(this.basin.x + Math.sin(a0 + i * 2.1) * 4.6, 0, this.basin.z + Math.cos(a0 + i * 2.1) * 4.6))
    for (const s of spots) {
      if (this.w.field.clearance(s.x, s.z) < 0.3) continue
      const g = new THREE.Group()
      const disc = new THREE.Mesh(new THREE.CircleGeometry(ZONE_R, 22).rotateX(-Math.PI / 2), this.zoneMat)
      disc.position.y = 0.04
      g.add(disc)
      for (let i = 0; i < 9; i++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.08 + Math.random() * 0.07, 0.4 + Math.random() * 0.6, 5), this.zoneMat)
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * ZONE_R * 0.85
        sp.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r)
        sp.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5)
        g.add(sp)
      }
      g.position.set(s.x, -0.6, s.z)
      g.visible = false
      this.w.scene.add(g)
      this.zones.push({ pos: s, mesh: g, t: 0, hurt: 0 })
      this.w.vfx.rings.spawn(s.x, s.z, { from: ZONE_R, to: ZONE_R, dur: 1.1, color: new THREE.Color(0.7, 0.9, 1.2), width: 0.06, fill: 0.14, hold: true })
    }
    this.sub = 'tread'
    this.setState('special')
    this.emit('cast', 'magic', 0.9)
  }

  protected specialUpdate(dt: number): { clip: Clip | null; t: number } {
    const w = this.w
    const p = w.player
    switch (this.sub) {
      case 'rise': {
        if (this.st >= 1.4) {
          this.sub = 'roar'
          this.st = 0
        }
        return { clip: this.clips.sit, t: 1 - this.st / 1.4 }
      }
      case 'roar': {
        if (this.st > 0.4 && this.st - dt <= 0.4) {
          this.emit('roar', 'threat', 1)
          w.shake(0.5)
          if (this.phase === 2) w.bossEvent('phase2')
        }
        if (this.st >= 1.6) this.endSpecial()
        return { clip: this.clips.cut3, t: Math.min(0.4, this.st / 1.6) }
      }
      case 'vanish': {
        // a frost steam swallows him
        if (Math.random() < 0.9) w.vfx.soft.spawn({ x: this.pos.x + rand(-0.5, 0.5), y: rand(0.2, 2), z: this.pos.z + rand(-0.5, 0.5), vy: rand(0.3, 1), r: 0.55, g: 0.62, b: 0.7, a: 0.45, size: rand(0.4, 0.8), life: 1.2, grow: 1.6 })
        if (this.st >= 0.35 && !this.hidden) this.hidden = true
        if (this.st >= 0.45) {
          if (this.behindAt.lengthSq() > 0) {
            // to the bowl, to drink
            this.pos.copy(this.behindAt)
            this.hidden = false
            this.faceTo(this.basin.x, this.basin.z, 1)
            this.sub = 'drink'
            this.st = 0
            w.bossEvent('drink')
            this.emit('drink', 'threat', 0.9)
          } else {
            this.sub = 'behind'
            this.st = 0
            // the scar on Aldar's chest flares: he is coming from behind
            w.bossEvent('scar')
          }
        }
        return { clip: this.clips.step, t: 0.1 }
      }
      case 'behind': {
        // footsteps on the ice behind Aldar
        const bx = p.pos.x - Math.sin(p.facing) * 1.7
        const bz = p.pos.z - Math.cos(p.facing) * 1.7
        if (this.st > 0.15 && this.st - dt <= 0.15) w.sound('step_heavy', new THREE.Vector3(bx, 0, bz), { tone: 'threat', strength: 1, indicate: true, id: 'shulgen-step' })
        if (this.st >= 0.6) {
          this.pos.set(bx, 0, bz)
          w.field.resolve(this.pos, this.radius)
          this.hidden = false
          for (let i = 0; i < 30; i++) w.vfx.soft.spawn({ x: this.pos.x + rand(-0.6, 0.6), y: rand(0.2, 2), z: this.pos.z + rand(-0.6, 0.6), vx: rand(-1, 1), vy: rand(0.2, 1), vz: rand(-1, 1), r: 0.6, g: 0.68, b: 0.78, a: 0.5, size: rand(0.3, 0.7), life: 1, grow: 1.4 })
          this.faceTo(p.pos.x, p.pos.z, 1)
          this.lastAtk = null
          this.startAttack(STEP_CUT)
        }
        return { clip: this.clips.step, t: 0.1 }
      }
      case 'drink': {
        // the sip from Yanshishma heals him while he kneels
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.028 * dt)
        if (Math.random() < 0.6) w.vfx.add.spawn({ x: this.pos.x + rand(-0.3, 0.3), y: rand(0.4, 1.6), z: this.pos.z + rand(-0.3, 0.3), vy: rand(0.4, 1), r: 1.5, g: 1.8, b: 2.3, size: 0.05, life: 0.8, drag: 1 })
        this.model.veins.color.setRGB(1.4 + Math.sin(this.st * 9) * 0.4, 1.7, 2.3)
        if (this.st >= DRINK_T) {
          this.model.veins.color.setRGB(0.7, 0.9, 1.2)
          this.endSpecial()
        }
        return { clip: this.clips.drink, t: Math.min(1, this.st / DRINK_T) }
      }
      case 'tread': {
        if (this.st >= 1.0) this.endSpecial()
        return { clip: this.clips.step, t: this.st }
      }
    }
    return { clip: null, t: 0 }
  }

  private endSpecial() {
    this.sub = 'none'
    this.setState('chase')
  }

  private updateZones(dt: number) {
    const p = this.w.player
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i]
      z.t += dt
      if (z.t < 1.1) continue
      if (z.t < 1.4) {
        z.mesh.visible = true
        z.mesh.position.y = -0.6 + 0.6 * smoothstep(1.1, 1.4, z.t)
        if (z.t - dt < 1.1) this.w.sound('crack', z.pos, { indicate: false, vol: 0.5 })
      } else if (z.t < 7.2) {
        if (Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z) < ZONE_R + p.radius * 0.5 && p.alive) {
          p.mire = 1
          z.hurt += dt
          if (z.hurt > 0.5) {
            z.hurt = 0
            p.directDamage(4)
          }
        }
      } else if (z.t < 7.8) z.mesh.position.y = -0.6 * smoothstep(7.2, 7.8, z.t)
      else {
        this.w.scene.remove(z.mesh)
        this.zones.splice(i, 1)
      }
    }
  }

  update(dt: number) {
    if (this.state === 'dormant') {
      this.rig.update(dt, { speed: 0, clip: this.clips.sit, t: 1, time: this.w.time })
      this.syncRig()
      this.updateVisibility(dt)
      return
    }
    this.openT = Math.max(0, this.openT - dt)
    super.update(dt)
    if (this.state !== 'special' && this.sub !== 'none') {
      this.hidden = false
      this.model.veins.color.setRGB(0.7, 0.9, 1.2)
      this.sub = 'none'
    }
    // the blade gleams brighter in the window a parry opened
    this.model.bladeMat.color.setRGB(0.55 + this.openT * 0.4, 0.62 + this.openT * 0.4, 0.72 + this.openT * 0.4)
    this.updateZones(dt)
    if (!this.alive) for (const z of this.zones) z.t = Math.max(z.t, 7.2)
  }
}
