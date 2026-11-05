// The enemies of chapters 2–3 (docs/LEVELS.md, docs/COMBAT.md, docs/COMPANION.md): the barrow guards in the armour of the
// ancestors, which only Azamat's kurai breaks; the barrow archers on their stones; the grave shadows of Shulgan-Tash.

import * as THREE from 'three'
import { Enemy } from './enemies'
import type { Clip, Rig } from './rig'
import { createGuard, createShade, GUARD_CLIPS, SHADE_CLIPS } from './models2'
import type { World } from '../world'
import type { AttackDef } from '../types'
import type { SoundKind } from '../audio/audio'
import { clamp, rand } from '../util'

const TEAL = new THREE.Color(0.35, 1.6, 1.5)
const GLINT_AMBER = new THREE.Color(2.2, 1.4, 0.45)

const G_SLASH: AttackDef = { dur: 1.1, hitStart: 0.45, hitEnd: 0.57, range: 2.4, arc: 110, dmg: 15, knock: 4, lunge: 0.9, lungeStart: 0.42, lungeEnd: 0.55, cd: 0.9, phases: [['slash', 0, 1]], swing: 'swing', slash: { dir: 1, tilt: 0.2, color: new THREE.Color(0.4, 1.1, 1.0) } }
const G_CLEAVE: AttackDef = { dur: 1.55, hitStart: 0.52, hitEnd: 0.62, range: 2.7, arc: 60, dmg: 24, heavy: true, knock: 7, lunge: 1.4, lungeStart: 0.48, lungeEnd: 0.6, cd: 1.6, phases: [['cleave', 0, 1]], swing: 'swing_heavy', slash: { dir: 1, tilt: 1.4, scale: 1.3, color: new THREE.Color(0.4, 1.1, 1.0) } }
const G_BASH: AttackDef = { dur: 0.95, hitStart: 0.42, hitEnd: 0.56, range: 2.1, arc: 80, dmg: 10, knock: 9, lunge: 2.4, lungeStart: 0.38, lungeEnd: 0.55, cd: 1.1, phases: [['bash', 0, 1]], swing: 'swing' }
const A_SHOOT: AttackDef = { dur: 1.55, hitStart: 0.72, hitEnd: 0.73, range: 0, arc: 0, dmg: 0, knock: 0, cd: 1.0, phases: [['shoot', 0, 1]] }
const A_KNIFE: AttackDef = { dur: 0.95, hitStart: 0.42, hitEnd: 0.54, range: 2.1, arc: 100, dmg: 10, knock: 3, lunge: 0.8, lungeStart: 0.4, lungeEnd: 0.52, cd: 0.8, phases: [['slash', 0, 1]], swing: 'swing' }

let armorHintT = -100

/**
 * A dead warrior risen out of his barrow (chapter 2, zone 2). The armour of the ancestors — a turquoise shell — takes every
 * blow and breaks every arrow until Azamat's kurai [Q] shatters it for 6 s (docs/COMPANION.md, «Зов курая»).
 */
export class KurganGuard extends Enemy {
  kind: 'guard' | 'archer' = 'guard'
  clips: Record<string, Clip> = GUARD_CLIPS
  rig: Rig
  protected shell: THREE.Object3D
  protected shellMat: THREE.ShaderMaterial
  /** seconds left with the armour broken */
  armorT = 0
  protected deathSound: SoundKind = 'ubyr_death'
  private lastAtk: AttackDef | null = null

  constructor(w: World, x: number, z: number, archer = false) {
    super(w, x, z)
    const m = createGuard(archer)
    this.rig = m.rig
    this.shell = m.shell
    this.shellMat = m.shellMat
    w.scene.add(this.rig.root)
    this.weight = archer ? 'light' : 'heavy'
    this.hp = this.maxHp = archer ? 60 : 115
    this.maxPosture = archer ? 50 : 90
    this.speed = archer ? 3 : 2.5
    this.detect = archer ? 22 : 11
    this.radius = 0.5
    this.stepEvery = 0.6
    this.stepSound = 'step_heavy'
    this.stepStrength = 0.6
    this.name = archer ? 'Лучник кургана' : 'Страж кургана'
    this.bloodColor = new THREE.Color(0.25, 0.9, 0.85)
  }

  /** the ancestors' armour holds */
  get armored() {
    return this.alive && this.armorT <= 0
  }

  /** Azamat's kurai: the shell shatters for `sec` seconds */
  breakArmor(sec: number) {
    if (!this.alive) return
    const was = this.armored
    this.armorT = Math.max(this.armorT, sec)
    if (!was) return
    const w = this.w
    w.sound('clang', this.pos, { indicate: false, vol: 0.8 })
    w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.3, to: 2.2, dur: 0.4, color: TEAL, width: 0.08 })
    for (let i = 0; i < 30; i++) w.vfx.add.spawn({ x: this.pos.x + rand(-0.4, 0.4), y: this.airY + rand(0.3, 2), z: this.pos.z + rand(-0.4, 0.4), vx: rand(-3, 3), vy: rand(0, 3), vz: rand(-3, 3), r: 0.35, g: 1.6, b: 1.5, size: rand(0.04, 0.08), life: rand(0.4, 0.8), drag: 2, gravity: 5 })
  }

  arrowBreaks() {
    return this.armored
  }

  takeHit(dmg: number, posture: number, fromX: number, fromZ: number, knock: number, heavy: boolean, source: 'melee' | 'arrow' | 'eagle' | 'fire'): boolean {
    if (this.armored && source !== 'eagle') {
      if (!this.alive || this.hidden) return false
      // the blow rings on the shell of the ancestors and does nothing
      const w = this.w
      w.sound('clang', this.pos, { indicate: false, vol: 0.6 })
      for (let i = 0; i < 10; i++) w.vfx.add.spawn({ x: this.pos.x + rand(-0.3, 0.3), y: this.airY + rand(0.6, 1.6), z: this.pos.z + rand(-0.3, 0.3), vx: rand(-2, 2), vy: rand(0, 2), vz: rand(-2, 2), r: 0.4, g: 1.7, b: 1.6, size: 0.04, life: 0.3, drag: 3 })
      this.knock(fromX, fromZ, knock * 0.1)
      if (!this.aggro) this.becomeAggro(true)
      if (w.time - armorHintT > 12) {
        armorHintT = w.time
        w.toast('Броня духов: курай Азамата [Q] разобьёт её', 'warn', 'kurai')
      }
      void dmg
      void posture
      void heavy
      return false
    }
    return super.takeHit(dmg, posture, fromX, fromZ, knock, heavy, source)
  }

  protected think(dt: number) {
    const p = this.w.player
    const d = this.distToPlayer
    this.steerTo(p.pos.x, p.pos.z, this.speed, 1.6)
    if (this.atkCd > 0) return
    if (d < 2.3) {
      const a = Math.random() < 0.3 ? G_BASH : this.lastAtk === G_SLASH && Math.random() < 0.6 ? G_CLEAVE : G_SLASH
      this.lastAtk = a
      this.startAttack(a)
    } else if (d < 3.4 && Math.random() < dt * 0.8) {
      this.lastAtk = G_BASH
      this.startAttack(G_BASH)
    }
  }

  protected voice() {
    if (this.aggro) this.emit('groan', 'threat', 0.5, 0.6)
  }
  protected onAlert() {
    this.emit('ubyr_growl', 'threat', 0.7, 0.7)
  }
  protected onDamaged() {
    this.emit('ubyr_hurt', 'threat', 0.5, 0.7)
  }

  update(dt: number) {
    const was = this.armored
    this.armorT = Math.max(0, this.armorT - dt)
    if (!was && this.armored && this.alive) {
      // the shell grows back
      this.w.sound('cast', this.pos, { indicate: false, vol: 0.4 })
      this.w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 2.2, to: 0.4, dur: 0.5, color: TEAL, width: 0.06 })
    }
    super.update(dt)
    this.shell.visible = this.armored && this.rig.root.visible
    this.shellMat.uniforms.uTime.value = this.w.time
    this.shellMat.uniforms.uOpacity.value = 0.4 + Math.sin(this.w.time * 5 + this.id) * 0.08
  }
}

/**
 * A barrow archer on his stone (chapter 2, zone 2): out of the kylys's reach, he looses arrows the kalkan can stop.
 * Kara knocks him off the stone; when Aldar stands under it too long he jumps down with a knife.
 */
export class KurganArcher extends KurganGuard {
  private underT = 0
  constructor(w: World, x: number, z: number) {
    super(w, x, z, true)
    this.kind = 'archer'
    this.ledge = true
    this.airY = 1.05
  }

  protected think(dt: number) {
    const p = this.w.player
    const d = this.distToPlayer
    if (!this.ledge) {
      this.steerTo(p.pos.x, p.pos.z, this.speed, 1.5)
      if (this.atkCd <= 0 && d < 2.2) this.startAttack(A_KNIFE)
      return
    }
    this.desire.set(0, 0, 0)
    this.faceTo(p.pos.x, p.pos.z, 5, dt)
    this.underT = d < 3 ? this.underT + dt : Math.max(0, this.underT - dt)
    if (this.underT > 2.2) {
      this.jumpDown(p.pos.x, p.pos.z)
      return
    }
    if (this.atkCd <= 0 && d < 24 && this.w.field.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
      this.startAttack(A_SHOOT)
      this.glint(GLINT_AMBER)
    }
  }

  protected onStrike(a: AttackDef) {
    if (a !== A_SHOOT) return
    const p = this.w.player
    // aims a little ahead of where Aldar is going
    const tx = p.pos.x + p.moveDir.x * p.speedNow * 0.2
    const tz = p.pos.z + p.moveDir.z * p.speedNow * 0.2
    const dir = new THREE.Vector3(tx - this.pos.x, 0, tz - this.pos.z).normalize()
    this.w.projectiles.spawnEnemyArrow(new THREE.Vector3(this.pos.x + dir.x * 0.6, 1.2, this.pos.z + dir.z * 0.6), dir)
    this.emit('arrow', 'threat', 0.8, 0.8)
    this.atkCd = rand(1.6, 2.6)
  }

  private jumpDown(tx: number, tz: number) {
    if (!this.ledge) return
    this.ledge = false
    const dx = tx - this.pos.x
    const dz = tz - this.pos.z
    const l = Math.hypot(dx, dz) || 1
    this.pos.x += (dx / l) * 1.7
    this.pos.z += (dz / l) * 1.7
    this.airY = 0
    this.w.vfx.dust(this.pos.x, this.pos.z, 12, 1)
    this.w.sound('step_heavy', this.pos, { indicate: false })
  }

  /** Kara's claws: down off the stone, onto his back */
  eagleStrike() {
    if (this.ledge) {
      const p = this.w.player.pos
      this.jumpDown(p.x, p.z)
      this.stun(1.8)
      this.w.toast('Кара сбросил лучника с камня', 'info', 'eagle')
      return
    }
    super.eagleStrike()
  }

  update(dt: number) {
    super.update(dt)
    if (this.ledge && this.alive) {
      this.airY = 1.05
      this.pos.x = this.home.x
      this.pos.z = this.home.z
    }
  }

  resetToHome() {
    super.resetToHome()
    this.ledge = true
    this.airY = 1.05
    this.underT = 0
  }
}

const SH_CLAW: AttackDef = { dur: 0.9, hitStart: 0.4, hitEnd: 0.54, range: 2.1, arc: 100, dmg: 11, knock: 3, lunge: 0.8, lungeStart: 0.38, lungeEnd: 0.5, cd: 0.8, phases: [['claw', 0, 1]], swing: 'swing', slash: { dir: 1, tilt: 0.25, color: new THREE.Color(0.6, 0.8, 1.0) } }
const SH_LEAP: AttackDef = { dur: 1.25, hitStart: 0.5, hitEnd: 0.66, range: 1.9, arc: 80, dmg: 17, knock: 5, lunge: 5.5, lungeStart: 0.46, lungeEnd: 0.64, cd: 3.2, unblockable: true, phases: [['leap', 0, 1]], sound: 'whisper' }

/**
 * A grave shadow of Shulgan-Tash (chapter 3): fast, weak, hunting in twos and threes in the dark of the karst shaft.
 * Light burns it (+50% damage where it is lit); an icicle shot down from the vault kills it outright.
 */
export class Shade extends Enemy {
  kind = 'shade' as const
  clips = SHADE_CLIPS
  rig: Rig
  protected deathSound: SoundKind = 'death'
  constructor(w: World, x: number, z: number) {
    super(w, x, z)
    this.rig = createShade()
    w.scene.add(this.rig.root)
    this.hp = this.maxHp = 44
    this.maxPosture = 34
    this.speed = 4.3
    this.detect = 9
    this.radius = 0.42
    this.stepEvery = 9999
    this.name = 'Могильная тень'
    this.bloodColor = new THREE.Color(0.05, 0.06, 0.09)
  }
  damageMult(source: string) {
    return (this.w.isLit(this.pos.x, this.pos.z) ? 1.5 : 1) * (source === 'arrow' ? 1.2 : 1)
  }
  protected think(dt: number) {
    const p = this.w.player
    const d = this.distToPlayer
    this.steerTo(p.pos.x, p.pos.z, this.speed, 1.4)
    if (this.atkCd > 0) return
    if (d < 2.1) this.startAttack(SH_CLAW)
    else if (d > 3.5 && d < 6 && Math.random() < dt * 0.9 && this.w.field.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) this.startAttack(SH_LEAP)
  }
  protected voice() {
    this.emit('whisper', this.aggro ? 'threat' : 'magic', this.aggro ? 0.55 : 0.35, 0.7)
  }
  protected onAlert() {
    this.emit('whisper', 'threat', 0.8)
  }
  update(dt: number) {
    if (this.alive) this.airY = 0.05 + Math.sin(this.w.time * 3 + this.id) * 0.04
    super.update(dt)
    if (this.alive && this.rig.root.visible && Math.random() < clamp(dt * 20, 0, 1))
      this.w.vfx.soft.spawn({ x: this.pos.x + rand(-0.3, 0.3), y: rand(0.2, 1.6), z: this.pos.z + rand(-0.3, 0.3), vy: 0.4, r: 0.01, g: 0.012, b: 0.018, a: 0.5, size: 0.45, life: 0.9, grow: 1.6 })
  }
}
