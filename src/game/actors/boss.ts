import * as THREE from 'three'
import { Enemy } from './enemies'
import { createShurale, SHURALE_CLIPS } from './models'
import type { Clip, Rig } from './rig'
import type { World } from '../world'
import type { AttackDef } from '../types'
import { rand, smoothstep } from '../util'

const AMBER = new THREE.Color(1.3, 0.55, 0.15)

const SWIPE_R: AttackDef = { dur: 1.0, hitStart: 0.48, hitEnd: 0.6, range: 3.9, arc: 160, dmg: 17, knock: 6, lunge: 1.6, lungeStart: 0.42, lungeEnd: 0.58, cd: 0.7, phases: [['swipeR', 0, 1]], swing: 'swing_heavy', slash: { dir: 1, tilt: 0.15, scale: 1.6, color: AMBER } }
const SWIPE_L: AttackDef = { dur: 0.85, hitStart: 0.42, hitEnd: 0.56, range: 3.9, arc: 160, dmg: 17, knock: 6, lunge: 1.4, lungeStart: 0.38, lungeEnd: 0.54, cd: 1.0, phases: [['swipeL', 0, 1]], swing: 'swing_heavy', slash: { dir: -1, tilt: -0.15, scale: 1.6, color: AMBER } }
const GRAB: AttackDef = { dur: 1.4, hitStart: 0.5, hitEnd: 0.66, range: 2.4, arc: 80, dmg: 4, knock: 0, grab: true, lunge: 7, lungeStart: 0.48, lungeEnd: 0.64, cd: 1.2, phases: [['grab', 0, 1]], sound: 'giggle' }

type Sub = 'roar' | 'hold' | 'crouch' | 'launch' | 'air' | 'fall' | 'land'

export class Shurale extends Enemy {
  kind = 'boss' as const
  clips = SHURALE_CLIPS
  rig: Rig
  private fingers: THREE.Object3D[]
  phase = 1
  fightStarted = false
  private sub: Sub = 'roar'
  private roarIsPhase2 = false
  private grabCd = 5
  private leapCd = 9
  private lastAtk: AttackDef | null = null
  private holdTick = 0
  private airDur = 2
  private airAng = 0
  private noiseT = 0
  private landAt = new THREE.Vector3()
  private telegraphed = false
  readonly spawn = new THREE.Vector3()

  constructor(w: World, x: number, z: number) {
    super(w, x, z)
    const m = createShurale()
    this.rig = m.rig
    this.fingers = m.fingers
    w.scene.add(this.rig.root)
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
    this.state = 'dormant'
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
    this.forceHidden = false
    this.airY = 0
    this.atk = null
    this.pos.copy(this.spawn)
    this.vel.set(0, 0, 0)
    this.grabCd = 5
    this.leapCd = 9
    this.rig.root.position.y = 0
    this.rig.root.visible = true
    this.setState('dormant')
  }

  startFight() {
    this.fightStarted = true
    this.aggro = true
    this.roarIsPhase2 = false
    this.sub = 'roar'
    this.faceTo(this.w.player.pos.x, this.w.player.pos.z, 1)
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
    if (this.state === 'special') return
    super.stun(sec)
  }

  protected think(dt: number) {
    const p = this.w.player
    const d = this.distToPlayer
    this.grabCd -= dt
    this.leapCd -= dt
    const sp = this.phase === 2 ? 5.3 : 4.4
    if (this.phase === 1 && this.hp < this.maxHp * 0.55) {
      this.phase = 2
      this.roarIsPhase2 = true
      this.sub = 'roar'
      this.setState('special')
      return
    }
    if (this.leapCd <= 0 && (d > 7 || Math.random() < dt * 0.25)) {
      this.leapCd = this.phase === 2 ? rand(7, 10) : rand(10, 14)
      this.sub = 'crouch'
      this.setState('special')
      this.emit('giggle', 'threat', 0.8)
      return
    }
    if (this.atkCd <= 0) {
      if (d < 3.7) {
        if (this.grabCd <= 0 && Math.random() < 0.4) {
          this.grabCd = this.phase === 2 ? 7 : 10
          this.lastAtk = GRAB
          this.startAttack(GRAB)
        } else {
          this.lastAtk = SWIPE_R
          this.startAttack(SWIPE_R)
        }
        return
      }
      if (d < 8 && this.grabCd <= 0 && Math.random() < dt * 1.5) {
        this.grabCd = this.phase === 2 ? 7 : 10
        this.lastAtk = GRAB
        this.startAttack(GRAB)
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
    this.atk = null
    this.sub = 'hold'
    this.holdTick = 0
    this.setState('special')
    this.emit('giggle', 'threat', 1)
  }

  protected voice() {
    if (this.fightStarted) this.emit('giggle', 'threat', 0.7, 0.8)
  }

  protected specialUpdate(dt: number): { clip: Clip | null; t: number } {
    const w = this.w
    const p = w.player
    switch (this.sub) {
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
          else this.stun(1.5)
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
          this.sub = 'air'
          this.st = 0
          this.hidden = true
          this.forceHidden = true
          this.airDur = rand(1.6, 2.5)
          this.airAng = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z)
          this.noiseT = 0.2
          this.telegraphed = false
        }
        return { clip: this.clips.leap, t: 0.45 + k * 0.55 }
      }
      case 'air': {
        // Unseen: circle around the hero among the trees, betraying himself only by sound.
        this.airAng += dt * 1.6
        const r = 9
        const tx = p.pos.x + Math.sin(this.airAng) * r
        const tz = p.pos.z + Math.cos(this.airAng) * r
        this.pos.set(tx, 0, tz)
        this.airY = 15
        this.noiseT -= dt
        if (this.noiseT <= 0) {
          this.noiseT = rand(0.35, 0.6)
          w.sound(Math.random() < 0.65 ? 'crack' : 'giggle', new THREE.Vector3(tx, 0, tz), { tone: 'threat', strength: 0.85, indicate: true, id: 'boss-air' })
        }
        if (!this.telegraphed && this.st >= this.airDur - 0.85) {
          this.telegraphed = true
          this.landAt.set(p.pos.x + p.vel.x * 0.1, 0, p.pos.z + p.vel.z * 0.1)
          w.vfx.rings.spawn(this.landAt.x, this.landAt.z, { from: 3.4, to: 3.4, dur: 0.85, color: new THREE.Color(1.2, 0.25, 0.08), width: 0.06, fill: 0.18, hold: true })
          w.sound('leap', this.landAt, { tone: 'threat', strength: 1, indicate: true })
        }
        if (this.st >= this.airDur) {
          this.sub = 'fall'
          this.st = 0
          this.pos.copy(this.landAt)
          this.hidden = false
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
          const d = this.distToPlayer
          if (d < 3.4 + p.radius) {
            const r = p.takeHit({ dmg: 26, x: this.pos.x, z: this.pos.z, knock: 11, heavy: true })
            if (r === 'perfect') {
              this.addPosture(40)
              w.perfectDodge()
            }
          }
        }
        return { clip: this.clips.land, t: 0 }
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
    // creepy finger wiggle while winding up a grab or holding the hero
    const grabbing = (this.state === 'attack' && this.atk === GRAB && this.st / GRAB.dur < 0.55) || (this.state === 'special' && this.sub === 'hold')
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
