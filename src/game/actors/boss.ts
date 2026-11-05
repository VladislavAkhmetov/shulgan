import * as THREE from 'three'
import { Enemy } from './enemies'
import { createShurale, SHURALE_CLIPS } from './models'
import type { Clip, Rig } from './rig'
import type { World } from '../world'
import type { AttackDef } from '../types'
import { rand, smoothstep } from '../util'
import { std } from '../render/materials'

const AMBER = new THREE.Color(1.3, 0.55, 0.15)

// «Когтистый размах»: two wide blows of the long arms — the kalkan can meet them (docs/COMBAT.md, boss of chapter 1)
const SWIPE_R: AttackDef = { dur: 1.0, hitStart: 0.48, hitEnd: 0.6, range: 3.9, arc: 160, dmg: 17, knock: 6, lunge: 1.6, lungeStart: 0.42, lungeEnd: 0.58, cd: 0.7, phases: [['swipeR', 0, 1]], swing: 'swing_heavy', slash: { dir: 1, tilt: 0.15, scale: 1.6, color: AMBER } }
const SWIPE_L: AttackDef = { dur: 0.85, hitStart: 0.42, hitEnd: 0.56, range: 3.9, arc: 160, dmg: 17, knock: 6, lunge: 1.4, lungeStart: 0.38, lungeEnd: 0.54, cd: 1.0, phases: [['swipeL', 0, 1]], swing: 'swing_heavy', slash: { dir: -1, tilt: -0.15, scale: 1.6, color: AMBER } }
// «Смертельная щекотка»: a leap with the fingers spread — unblockable; it stuffs the vessel's slots with mud for 4 s
const TICKLE: AttackDef = { dur: 1.4, hitStart: 0.5, hitEnd: 0.66, range: 2.4, arc: 80, dmg: 4, knock: 0, grab: true, unblockable: true, lunge: 7, lungeStart: 0.48, lungeEnd: 0.64, cd: 1.2, phases: [['grab', 0, 1]], sound: 'giggle' }

const LOG_WINDUP = 1.1
const PERCH_H = 7.5
const KNOCK_DMG = 40

type Sub = 'drop' | 'roar' | 'hold' | 'log' | 'crouch' | 'launch' | 'perch' | 'fall' | 'knocked' | 'land' | 'roots'

/** what the game needs from any boss: the duel starts and resets, phases, a tree to hide in (Shurale only) */
export interface BossLike {
  fightStarted: boolean
  phase: number
  perch: THREE.Vector3 | null
  /** the line under the name on the boss bar */
  title: string
  resetBoss(): void
  startFight(): void
}
export type Boss = Enemy & BossLike

/**
 * Shurale, master of the sick urman. Phase 1 (100 → 50%): the claw sweep, the rotten stump (an arrow in the horn blows it
 * up in his hands), the deadly tickle. Phase 2 (50 → 0%): he hides in the pine crowns — Susar points at the tree, an arrow
 * or Kara knocks him down — and black roots break out under Aldar unless the vessel's flash burns them.
 */
export class Shurale extends Enemy implements BossLike {
  kind = 'boss' as const
  title = 'хозяин больного урмана'
  clips = SHURALE_CLIPS
  rig: Rig
  private fingers: THREE.Object3D[]
  private stump: THREE.Object3D
  phase = 1
  fightStarted = false
  private sub: Sub = 'roar'
  private roarIsPhase2 = false
  private grabCd = 5
  private logCd = 4
  private leapCd = 6
  private rootCd = 4
  private lastAtk: AttackDef | null = null
  private holdTick = 0
  private perchDur = 3.5
  private noiseT = 0
  private landAt = new THREE.Vector3()
  private telegraphed = false
  private logThrown = false
  /** the pine he is hiding in (phase 2), null when on the ground */
  perch: THREE.Vector3 | null = null
  readonly spawn = new THREE.Vector3()

  constructor(w: World, x: number, z: number) {
    super(w, x, z)
    const m = createShurale()
    this.rig = m.rig
    this.fingers = m.fingers
    w.scene.add(this.rig.root)
    // the stump he tears out of the moss, held over his head
    const stump = new THREE.Group()
    const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.8, 8), std(0x2a2018, 1))
    wood.rotation.z = Math.PI / 2
    const moss = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), std(0x1e2a14, 1))
    moss.position.y = 0.2
    moss.scale.set(1.4, 0.5, 1)
    stump.add(wood, moss)
    stump.position.set(0, 3.0, 0.3)
    stump.visible = false
    this.rig.root.add(stump)
    this.stump = stump
    this.weight = 'heavy'
    this.hp = this.maxHp = 900
    this.maxPosture = 240
    this.speed = 4.4
    this.radius = 0.85
    this.stagDur = 3.4
    this.stepEvery = 0.62
    this.stepSound = 'step_heavy'
    this.stepStrength = 0.95
    this.hitHeight = 0.9
    this.name = 'Шурале'
    this.bloodColor = new THREE.Color(0.1, 0.09, 0.04)
    this.spawn.set(x, 0, z)
    this.toCrown()
  }

  /** up in the old oak's crown, unseen, until Aldar steps onto the glade */
  private toCrown() {
    this.state = 'dormant'
    this.airY = PERCH_H
    this.forceHidden = true
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
    this.perch = null
    this.stump.visible = false
    this.pos.copy(this.spawn)
    this.vel.set(0, 0, 0)
    this.grabCd = 5
    this.logCd = 4
    this.leapCd = 6
    this.rootCd = 4
    this.arrowsIn = 0
    this.rig.root.position.y = 0
    this.rig.root.visible = true
    this.toCrown()
    this.setState('dormant')
  }

  /** TRG_CH1_SHURALE_START: he jumps down from the branch onto the glade */
  startFight() {
    this.fightStarted = true
    this.aggro = true
    this.roarIsPhase2 = false
    const p = this.w.player.pos
    // lands between the oak and Aldar
    this.landAt.set(this.spawn.x + (p.x - this.spawn.x) * 0.35, 0, this.spawn.z + (p.z - this.spawn.z) * 0.35)
    this.pos.copy(this.landAt)
    this.forceHidden = false
    this.sub = 'drop'
    this.faceTo(p.x, p.z, 1)
    this.setState('special')
  }

  protected canFlinch() {
    return false
  }

  damageMult() {
    return this.state === 'special' && this.sub === 'land' ? 1.3 : 1
  }

  becomeAggro() {
    /* the boss only wakes through startFight() */
  }

  hearNoise() {}

  stun(sec: number) {
    if (this.state === 'special' && this.sub !== 'log') return
    if (this.state === 'special') this.stump.visible = false
    super.stun(sec)
  }

  /** Kara's claws: out of the crown he comes down; on the ground, any wind-up breaks */
  eagleStrike() {
    if (this.perch) return this.knockDown()
    super.eagleStrike()
  }

  /** an arrow during the stump throw goes into the horn on his brow: the stump bursts in his hands */
  onArrow(fromX: number, fromZ: number) {
    if (this.state !== 'special' || this.sub !== 'log' || this.logThrown) return false
    const front = Math.sin(this.facing) * (fromX - this.pos.x) + Math.cos(this.facing) * (fromZ - this.pos.z) > 0
    if (!front) return false
    const w = this.w
    this.stump.visible = false
    w.sound('crack', this.pos, { indicate: false })
    w.sound('boom', this.pos, { indicate: false, vol: 0.6 })
    w.shake(0.6)
    w.hitstop(0.08)
    for (let i = 0; i < 40; i++) w.vfx.soft.spawn({ x: this.pos.x + rand(-0.5, 0.5), y: 2.8 + rand(-0.3, 0.3), z: this.pos.z + rand(-0.5, 0.5), vx: rand(-5, 5), vy: rand(0, 5), vz: rand(-5, 5), r: 0.12, g: 0.09, b: 0.06, a: 0.95, size: rand(0.06, 0.14), life: rand(0.8, 1.5), drag: 1.2, gravity: 9 })
    this.hp -= 45
    this.rig.hitFlash()
    this.addPosture(70)
    this.atk = null
    if (this.hp <= 0) {
      this.die()
      return true
    }
    if (this.posture >= this.maxPosture) this.enterStagger()
    else {
      this.state = 'stun'
      this.st = 0
      this.stunT = 2
    }
    return true
  }

  /** out of the crown and onto his back: the fall breaks his balance (finishable) */
  knockDown() {
    if (!this.perch) return
    const w = this.w
    const at = this.perch
    this.perch = null
    w.bossEvent('unperch')
    this.pos.set(at.x, 0, at.z)
    // nudge him off the trunk toward the open glade
    const c = w.level.arenaCenter
    const d = Math.hypot(c.x - at.x, c.z - at.z) || 1
    this.pos.x += ((c.x - at.x) / d) * 1.8
    this.pos.z += ((c.z - at.z) / d) * 1.8
    this.forceHidden = false
    this.sub = 'knocked'
    this.setState('special')
    w.sound('crack', this.pos, { indicate: false })
    this.emit('roar', 'threat', 0.7)
  }

  protected think(dt: number) {
    const p = this.w.player
    const d = this.distToPlayer
    this.grabCd -= dt
    this.logCd -= dt
    this.leapCd -= dt
    this.rootCd -= dt
    const sp = this.phase === 2 ? 5.3 : 4.4
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2
      this.roarIsPhase2 = true
      this.sub = 'roar'
      this.leapCd = 2
      this.rootCd = 6
      this.setState('special')
      return
    }
    if (this.phase === 2) {
      if (this.leapCd <= 0 && (d > 5 || Math.random() < dt * 0.4)) {
        this.leapCd = rand(10, 13)
        this.sub = 'crouch'
        this.setState('special')
        this.emit('giggle', 'threat', 0.8)
        return
      }
      if (this.rootCd <= 0 && d < 12) {
        this.rootCd = rand(8, 11)
        this.sub = 'roots'
        this.faceTo(p.pos.x, p.pos.z, 1)
        this.setState('special')
        return
      }
    }
    if (this.atkCd <= 0) {
      if (d < 3.7) {
        if (this.grabCd <= 0 && Math.random() < 0.4) {
          this.grabCd = this.phase === 2 ? 7 : 10
          this.lastAtk = TICKLE
          this.startAttack(TICKLE)
        } else {
          this.lastAtk = SWIPE_R
          this.startAttack(SWIPE_R)
        }
        return
      }
      if (d < 8 && this.grabCd <= 0 && Math.random() < dt * 1.5) {
        this.grabCd = this.phase === 2 ? 7 : 10
        this.lastAtk = TICKLE
        this.startAttack(TICKLE)
        return
      }
      if (d > 4.5 && d < 15 && this.logCd <= 0 && this.w.field.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
        // «Бросок гнилой колоды»: tears a rotten stump out of the moss
        this.logCd = this.phase === 2 ? rand(9, 12) : rand(6, 9)
        this.sub = 'log'
        this.logThrown = false
        this.stump.visible = true
        this.faceTo(p.pos.x, p.pos.z, 1)
        this.setState('special')
        this.glint(new THREE.Color(2.2, 1.4, 0.45))
        this.w.sound('crack', this.pos, { indicate: false, vol: 0.7 })
        this.w.vfx.dust(this.pos.x, this.pos.z, 14, 1.2)
        return
      }
    }
    this.steerTo(p.pos.x, p.pos.z, sp, 2.6)
  }

  protected onAttackEnd() {
    if (this.lastAtk === SWIPE_R && this.alive && this.distToPlayer < 5 && Math.random() < 0.75 && this.state === 'chase') {
      this.lastAtk = SWIPE_L
      this.startAttack(SWIPE_L)
    }
  }

  protected onHitPlayer(a: AttackDef) {
    if (!a.grab) return
    const p = this.w.player
    if (!p.alive) return
    p.grabbedBy()
    p.clog(4)
    this.atk = null
    this.sub = 'hold'
    this.holdTick = 0
    this.setState('special')
    this.emit('giggle', 'threat', 1)
  }

  protected voice() {
    if (this.fightStarted) this.emit('giggle', 'threat', 0.7, 0.8)
  }

  /** the pine farthest from Aldar among the glade's edge */
  private pickPerch() {
    const p = this.w.player.pos
    const list = this.w.level.perches
    let best: THREE.Vector3 | null = null
    let bd = -1
    for (const t of list) {
      const d = Math.hypot(t.x - p.x, t.z - p.z) + rand(0, 4)
      if (d > bd) {
        bd = d
        best = t
      }
    }
    return best
  }

  protected specialUpdate(dt: number): { clip: Clip | null; t: number } {
    const w = this.w
    const p = w.player
    switch (this.sub) {
      case 'drop': {
        const k = Math.min(1, this.st / 0.45)
        this.airY = PERCH_H * (1 - k * k)
        if (k >= 1) {
          this.airY = 0
          this.sub = 'roar'
          this.st = 0
          w.sound('boom', this.pos, { indicate: false })
          w.shake(1)
          w.vfx.dust(this.pos.x, this.pos.z, 34, 2.4)
        }
        return { clip: this.clips.leap, t: 1 }
      }
      case 'roar': {
        if (this.st > 0.45 && this.st - dt <= 0.45) {
          this.emit('roar', 'threat', 1)
          w.shake(0.6)
          if (this.roarIsPhase2) w.bossEvent('phase2')
        }
        if (this.st >= 2.1) this.setState('chase')
        return { clip: this.clips.roar, t: this.st / 2.1 }
      }
      case 'hold': {
        this.holdTick += dt
        p.pos.set(this.pos.x + this.fx * 1.35, 0, this.pos.z + this.fz * 1.35)
        p.airY = 0.65
        p.facing = this.facing + Math.PI
        if (this.holdTick > 0.45) {
          this.holdTick = 0
          p.directDamage(5)
          w.sound('hit', p.pos, { indicate: false, vol: 0.4 })
          if (Math.random() < 0.5) this.emit('giggle', 'threat', 0.8)
        }
        if (!p.alive) {
          this.setState('chase')
          return { clip: this.clips.hold, t: 0 }
        }
        if (p.grabProgress >= 1) {
          p.release(0, 0, 0)
          this.addPosture(50)
          w.sound('hit_heavy', this.pos, { indicate: false })
          w.shake(0.4)
          if (this.posture >= this.maxPosture) this.enterStagger()
          else super.stun(1.5)
          return { clip: this.clips.hurt, t: 0 }
        }
        if (this.st > 3.3) {
          p.release(this.pos.x, this.pos.z, 13)
          p.directDamage(16)
          w.shake(0.6)
          w.sound('hit_heavy', p.pos, { indicate: false })
          this.setState('chase')
        }
        return { clip: this.clips.hold, t: (this.st * 2.5) % 1 }
      }
      case 'log': {
        if (!this.logThrown) this.faceTo(p.pos.x, p.pos.z, 5, dt)
        this.rig.eyeBoost = smoothstep(0, LOG_WINDUP, this.st)
        if (!this.logThrown && this.st >= LOG_WINDUP) {
          this.logThrown = true
          this.stump.visible = false
          const dir = new THREE.Vector3(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize()
          w.projectiles.spawnLog(new THREE.Vector3(this.pos.x + dir.x * 1.2, 2.2, this.pos.z + dir.z * 1.2), dir)
          w.sound('swing_heavy', this.pos, { indicate: false })
        }
        if (this.st >= LOG_WINDUP + 0.5) this.setState('chase')
        return { clip: this.clips.roar, t: Math.min(1, this.st / (LOG_WINDUP + 0.5)) }
      }
      case 'roots': {
        // a stomp: black roots answer under Aldar's feet
        if (this.st > 0.5 && this.st - dt <= 0.5) {
          w.spawnRoots(p.pos.clone())
          w.shake(0.35)
          w.sound('thorns', p.pos, { indicate: false, vol: 0.8 })
        }
        if (this.st >= 1.0) this.setState('chase')
        return { clip: this.clips.roar, t: this.st / 1.0 }
      }
      case 'crouch': {
        this.faceTo(p.pos.x, p.pos.z, 6, dt)
        if (this.st >= 0.55) {
          this.sub = 'launch'
          this.st = 0
          this.emit('leap', 'threat', 0.9)
          w.vfx.dust(this.pos.x, this.pos.z, 18, 1.6)
        }
        return { clip: this.clips.leap, t: (this.st / 0.55) * 0.3 }
      }
      case 'launch': {
        const k = Math.min(1, this.st / 0.38)
        this.airY = k * k * 15
        if (k >= 1) {
          // «Прыжки из тумана»: into one of the pines at the edge of the glade
          const t = this.pickPerch()
          this.sub = 'perch'
          this.st = 0
          this.forceHidden = true
          this.perchDur = rand(3.2, 4.2)
          this.noiseT = 0.3
          this.telegraphed = false
          if (t) {
            this.perch = t.clone()
            this.pos.set(t.x, 0, t.z)
            w.bossEvent('perch')
          }
          this.airY = PERCH_H
        }
        return { clip: this.clips.leap, t: 0.45 + k * 0.55 }
      }
      case 'perch': {
        // unseen in the crown, betraying himself by the crack of branches and his laughter
        this.airY = PERCH_H
        this.noiseT -= dt
        if (this.noiseT <= 0) {
          this.noiseT = rand(0.5, 0.9)
          w.sound(Math.random() < 0.6 ? 'crack' : 'giggle', new THREE.Vector3(this.pos.x, 0, this.pos.z), { tone: 'threat', strength: 0.85, indicate: true, id: 'boss-air' })
        }
        if (!this.telegraphed && this.st >= this.perchDur - 0.85) {
          this.telegraphed = true
          this.landAt.set(p.pos.x + p.vel.x * 0.1, 0, p.pos.z + p.vel.z * 0.1)
          w.vfx.rings.spawn(this.landAt.x, this.landAt.z, { from: 3.4, to: 3.4, dur: 0.85, color: new THREE.Color(1.2, 0.25, 0.08), width: 0.06, fill: 0.18, hold: true })
          w.sound('leap', this.landAt, { tone: 'threat', strength: 1, indicate: true })
        }
        if (this.st >= this.perchDur) {
          this.perch = null
          w.bossEvent('unperch')
          this.sub = 'fall'
          this.st = 0
          this.pos.copy(this.landAt)
          this.forceHidden = false
        }
        return { clip: this.clips.leap, t: 1 }
      }
      case 'fall': {
        const k = Math.min(1, this.st / 0.22)
        this.airY = 15 * (1 - k * k)
        if (k >= 1) {
          this.airY = 0
          this.sub = 'land'
          this.st = 0
          w.sound('boom', this.pos, { indicate: false })
          w.shake(1)
          w.hitstop(0.06)
          w.vfx.dust(this.pos.x, this.pos.z, 34, 2.4)
          w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.5, to: 7, dur: 0.6, color: new THREE.Color(1.1, 0.6, 0.3), width: 0.05 })
          if (this.distToPlayer < 3.4 + p.radius) {
            const r = p.takeHit({ dmg: 26, x: this.pos.x, z: this.pos.z, knock: 11, heavy: true, unblockable: true })
            if (r === 'perfect') {
              this.addPosture(40)
              w.perfectDodge()
            }
          }
        }
        return { clip: this.clips.land, t: 0 }
      }
      case 'knocked': {
        // down out of the crown, onto his back
        const k = Math.min(1, this.st / 0.35)
        this.airY = PERCH_H * (1 - k * k)
        if (k >= 1) {
          this.airY = 0
          w.sound('boom', this.pos, { indicate: false })
          w.shake(0.9)
          w.vfx.dust(this.pos.x, this.pos.z, 30, 2.2)
          this.hp -= KNOCK_DMG
          this.rig.hitFlash()
          if (this.hp <= 0) this.die()
          else this.enterStagger()
        }
        return { clip: this.clips.stagger, t: 1 }
      }
      case 'land': {
        if (this.st >= 1.0) this.setState('chase')
        return { clip: this.clips.land, t: this.st / 1.0 }
      }
    }
    return { clip: null, t: 0 }
  }

  update(dt: number) {
    if (this.state === 'dormant') {
      this.rig.update(dt, { speed: 0, clip: this.clips.stagger, t: 1, time: this.w.time })
      this.syncRig()
      this.updateVisibility(dt)
      return
    }
    super.update(dt)
    if (this.state !== 'special' || this.sub !== 'log') this.stump.visible = false
    // creepy finger wiggle while winding up a grab or holding the hero
    const grabbing = (this.state === 'attack' && this.atk === TICKLE && this.st / TICKLE.dur < 0.55) || (this.state === 'special' && this.sub === 'hold')
    const k = grabbing ? 1 : 0.15
    this.fingers.forEach((f, i) => {
      f.rotation.x = 0.2 + Math.sin(this.w.time * 14 + i * 1.3) * 0.35 * k
    })
    if (this.state === 'attack' && this.atk) {
      const n = this.st / this.atk.dur
      this.rig.eyeBoost = n < this.atk.hitStart ? smoothstep(0, this.atk.hitStart, n) : 0
    }
  }
}
