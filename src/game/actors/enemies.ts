import * as THREE from 'three'
import { Actor, inArc } from './actor'
import type { Clip, Rig } from './rig'
import { MOROK_CLIPS, createMorok, UBYR_CLIPS, WOLF_CLIPS } from './models'
import { UbyrRig } from './ubyrRig'
import { WolfRig } from './wolfRig'
import type { World } from '../world'
import type { AttackDef } from '../types'
import type { SoundKind } from '../audio/audio'
import type { Tone } from '../render/indicators'
import type { Player } from './player'
import { clamp, dampAngle, rand, smoothstep } from '../util'

export type EKind = 'ubyr' | 'wolf' | 'morok' | 'boss' | 'guard' | 'archer' | 'shade'
export type EState = 'idle' | 'alert' | 'chase' | 'attack' | 'hurt' | 'stagger' | 'stun' | 'dead' | 'special' | 'finished' | 'dormant'

/** the companions' marks (docs/COMPANION.md): rusty — Susar, white — Kara, turquoise — the kurai (chapter 2) */
export type MarkKind = 'red' | 'white' | 'teal'

const MARK_COLOR: Record<MarkKind, THREE.Color> = {
  red: new THREE.Color(2.2, 0.75, 0.2),
  white: new THREE.Color(1.9, 1.9, 1.8),
  teal: new THREE.Color(0.4, 2.2, 2.1),
}
const GLINT_AMBER = new THREE.Color(2.2, 1.4, 0.45)
const GLINT_RED = new THREE.Color(2.6, 0.22, 0.1)

let nextId = 1

export abstract class Enemy extends Actor {
  abstract kind: EKind
  abstract clips: Record<string, Clip>
  weight: 'light' | 'heavy' = 'light'
  state: EState = 'idle'
  st = 0
  readonly id = nextId++
  readonly home = new THREE.Vector3()
  homeFacing = 0
  aggro = false
  alertPoint: THREE.Vector3 | null = null
  lostT = 0
  atk: AttackDef | null = null
  atkHit = false
  atkSwung = false
  atkCd = 1
  speed = 3
  detect = 8
  hidden = false
  revealT = 0
  seen = 0
  visibleNow = false
  private lastReveal = false
  stepT = 0
  stepEvery = 0.55
  stepSound: SoundKind = 'step_light'
  stepStrength = 0.5
  voiceT = rand(2, 6)
  senseT = Math.random() * 0.15
  deadT = 0
  removed = false
  hitHeight = 0
  bloodColor = new THREE.Color(0.2, 0.03, 0.04)
  stagDur = 2.6
  stunT = 0
  desire = new THREE.Vector3()
  /** seconds left on each companion mark */
  readonly marks: Record<MarkKind, number> = { red: 0, white: 0, teal: 0 }
  /** unseen and untouchable until Susar tears the veil (docs/COMPANION.md, EXPOSE_LEAP) */
  cloaked = false
  exposedT = 0
  /** stands out of the kylys's reach (the pack leader on his ledge): only arrows and Kara get him */
  ledge = false
  /** arrows that went in and stayed: they fall out by the body (docs/COMBAT.md, «Возврат стрел») */
  arrowsIn = 0
  /** the colour of the flash before the current blow: amber — the kalkan can meet it, red — it cannot */
  get telegraph(): 'amber' | 'red' | null {
    const a = this.atk
    if (this.state !== 'attack' || !a || this.st / a.dur >= a.hitStart) return null
    return a.grab || a.unblockable ? 'red' : 'amber'
  }
  speedNow = 0
  protected tmp = new THREE.Vector3()
  name = ''

  /** veiled right now: no blow, arrow or eagle can find it, and it is not drawn */
  get cloakedNow() {
    return this.cloaked && this.exposedT <= 0
  }

  mark(kind: MarkKind, sec: number) {
    if (!this.alive) return
    this.marks[kind] = Math.max(this.marks[kind], sec)
  }

  /** Susar tears the veil for a while (and leaves her rusty mark) */
  expose(sec: number) {
    if (!this.alive) return
    this.exposedT = Math.max(this.exposedT, sec)
    this.mark('red', sec)
  }

  /** A counter, a shield bash or a piercing arrow sets the marks off: each burns for extra damage and balance. */
  detonateMarks() {
    if (!this.alive) return 0
    let n = 0
    for (const k of Object.keys(this.marks) as MarkKind[]) {
      if (this.marks[k] <= 0) continue
      this.marks[k] = 0
      n++
      const c = MARK_COLOR[k]
      this.w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.3, to: 2.4, dur: 0.4, color: c, width: 0.08 })
      for (let i = 0; i < 18; i++) this.w.vfx.add.spawn({ x: this.pos.x + rand(-0.3, 0.3), y: 0.6 + this.hitHeight + rand(0, 0.9), z: this.pos.z + rand(-0.3, 0.3), vx: rand(-3, 3), vy: rand(0.5, 3), vz: rand(-3, 3), r: c.r, g: c.g, b: c.b, size: 0.06, life: 0.5, drag: 2 })
    }
    if (n === 0) return 0
    this.w.sound('hit_heavy', this.pos, { indicate: false, vol: 0.6 })
    this.hp -= 12 * n
    this.addPosture(20 * n)
    this.rig.hitFlash()
    if (this.hp <= 0) this.die()
    else if (this.posture >= this.maxPosture && this.state !== 'stagger') this.enterStagger()
    return n
  }

  /** Kara's claws: the wind-up breaks (an unblockable one too) */
  eagleStrike() {
    this.stun(this.weight === 'heavy' ? 0.8 : 1.4)
  }

  /** an arrow reached it: return true if it is taken in a special way (no ordinary hit) */
  onArrow(_fromX: number, _fromZ: number) {
    return false
  }

  /** the arrow breaks on it for good (the ancestors' armour not yet broken by the kurai, docs/COMBAT.md) */
  arrowBreaks() {
    return false
  }

  /** the kalkan's boss met the blow: off balance for 1.5 s (docs/COMBAT.md) */
  parried() {
    if (!this.alive) return
    this.addPosture(this.weight === 'heavy' ? 25 : 35)
    if (this.posture >= this.maxPosture) this.enterStagger()
    else this.stun(this.weight === 'heavy' ? 1.1 : 1.5)
  }

  /** the vessel's flash: knocked back from the sparks (wolves run, see Wolf) */
  scare(fromX: number, fromZ: number) {
    if (!this.alive || this.state === 'dormant') return
    this.knock(fromX, fromZ, this.weight === 'heavy' ? 1 : 5)
    if (this.weight !== 'heavy') this.stun(0.5)
  }

  constructor(w: World, x: number, z: number) {
    super(w)
    this.pos.set(x, 0, z)
    this.home.set(x, 0, z)
    this.facing = this.homeFacing = Math.random() * Math.PI * 2
  }

  protected abstract think(dt: number): void
  protected voice() {}
  protected onAlert() {}
  protected onDamaged() {}
  protected rigFear() { return 0 }
  protected deathSound: SoundKind = 'death'
  protected onStrike(_a: AttackDef) {}
  protected onAttackEnd() {}
  protected specialUpdate(_dt: number): { clip: Clip | null; t: number } {
    return { clip: null, t: 0 }
  }

  get distToPlayer() {
    return Math.hypot(this.w.player.pos.x - this.pos.x, this.w.player.pos.z - this.pos.z)
  }

  setState(s: EState) {
    this.state = s
    this.st = 0
  }

  emit(kind: SoundKind, tone: Tone, strength: number, vol = 1) {
    this.w.sound(kind, this.pos, { tone, strength, id: this.id, indicate: !this.visibleNow, vol })
  }

  resetToHome() {
    if (!this.alive) return
    this.pos.copy(this.home)
    this.vel.set(0, 0, 0)
    this.hp = this.maxHp
    this.posture = 0
    this.aggro = false
    this.alertPoint = null
    this.atk = null
    this.hidden = false
    this.airY = 0
    this.rig.root.scale.setScalar(1)
    this.setState('idle')
  }

  // ------------------------------------------------------------------ perception

  becomeAggro(shout: boolean) {
    if (this.aggro || !this.alive) return
    this.aggro = true
    this.lostT = 0
    if (this.state === 'idle' || this.state === 'alert') this.setState('chase')
    if (shout) this.onAlert()
    for (const e of this.w.enemies) {
      if (e !== this && e.alive && !e.aggro && e.kind !== 'boss' && e.pos.distanceTo(this.pos) < 12) e.becomeAggro(false)
    }
  }

  hearNoise(p: THREE.Vector3, radius: number) {
    if (this.aggro || !this.alive || this.state === 'dormant') return
    if (p.distanceTo(this.pos) > radius) return
    this.alertPoint = p.clone()
    if (this.state === 'idle') this.setState('alert')
    if (p.distanceTo(this.pos) < radius * 0.6) this.becomeAggro(true)
  }

  private perceive() {
    const p = this.w.player
    if (!p.alive) {
      if (this.aggro) {
        this.aggro = false
        if (this.state === 'chase') this.setState('idle')
      }
      return
    }
    const d = this.distToPlayer
    if (!this.aggro) {
      // the glow at Aldar's belt is seen from afar
      const range = this.detect * (p.lightOn ? 1.35 : 1)
      if (d < range && this.w.field.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) this.becomeAggro(true)
    } else if (d > 30) {
      this.lostT += 0.15
      if (this.lostT > 5) {
        this.aggro = false
        this.alertPoint = this.home.clone()
        this.setState('alert')
      }
    } else this.lostT = 0
  }

  // ------------------------------------------------------------------ combat

  startAttack(a: AttackDef) {
    this.atk = a
    this.atkHit = false
    this.atkSwung = false
    this.setState('attack')
    this.faceTo(this.w.player.pos.x, this.w.player.pos.z, 1)
    if (a.sound) this.emit(a.sound, 'threat', 0.85)
    if (a.range > 0) this.glint(a.grab || a.unblockable ? GLINT_RED : GLINT_AMBER)
  }

  /** a flash at the head before a blow: amber — meet it with the kalkan, red — only a roll or Kara */
  protected glint(c: THREE.Color) {
    if (!this.visibleNow) return
    const y = 1.55 + this.hitHeight + this.airY
    for (let i = 0; i < 3; i++) this.w.vfx.add.spawn({ x: this.pos.x, y, z: this.pos.z, r: c.r, g: c.g, b: c.b, a: 1, size: 0.34 - i * 0.08, life: 0.32, drag: 1 })
    for (let i = 0; i < 6; i++) this.w.vfx.add.spawn({ x: this.pos.x, y, z: this.pos.z, vx: rand(-1.5, 1.5), vy: rand(-0.5, 1.5), vz: rand(-1.5, 1.5), r: c.r, g: c.g, b: c.b, size: 0.05, life: 0.3, drag: 2 })
  }

  faceTo(x: number, z: number, k: number, dt = 1) {
    const a = Math.atan2(x - this.pos.x, z - this.pos.z)
    this.facing = k >= 1 ? a : dampAngle(this.facing, a, k, dt)
  }

  protected runAttack(dt: number) {
    const a = this.atk!
    const n = this.st / a.dur
    const p = this.w.player
    this.rig.eyeBoost = n < a.hitStart ? smoothstep(0.05, a.hitStart, n) : Math.max(0, 1 - (n - a.hitStart) * 4)
    if (n < a.hitStart * 0.75) this.faceTo(p.pos.x, p.pos.z, 7, dt)
    if (a.lunge && n >= (a.lungeStart ?? 0) && n <= (a.lungeEnd ?? 1)) {
      const win = ((a.lungeEnd ?? 1) - (a.lungeStart ?? 0)) * a.dur
      const d = this.distToPlayer
      const k = d < this.radius + p.radius + 0.4 ? 0.1 : 1
      this.desire.set(this.fx * (a.lunge / win) * k, 0, this.fz * (a.lunge / win) * k)
    }
    if (n >= a.hitStart && !this.atkSwung) {
      this.atkSwung = true
      if (a.swing) this.emit(a.swing, 'threat', 0.7)
      if (a.slash) this.w.vfx.slashes.spawn(this.pos.x, 1.0 + this.hitHeight * 0.5, this.pos.z, this.facing, { dir: a.slash.dir, tilt: a.slash.tilt, scale: a.slash.scale, color: a.slash.color ?? new THREE.Color(0.9, 0.25, 0.15), dur: 0.22 })
      this.onStrike(a)
    }
    if (n >= a.hitStart && n <= a.hitEnd && !this.atkHit && a.range > 0) {
      if (inArc(this.pos.x, this.pos.z, this.facing, p.pos.x, p.pos.z, a.range, a.arc, p.radius) && Math.abs(p.airY - this.airY) < 1.6) {
        this.atkHit = true
        const r = p.takeHit({ dmg: a.dmg, x: this.pos.x, z: this.pos.z, knock: a.knock, heavy: a.heavy, grab: a.grab, unblockable: a.unblockable })
        if (r === 'perfect') {
          this.addPosture(this.weight === 'heavy' ? 30 : 40)
          this.w.perfectDodge()
          if (this.posture >= this.maxPosture) this.enterStagger()
        } else if (r === 'parry') {
          this.atk = null
          this.parried()
          return
        } else if (r === 'hit') this.onHitPlayer(a)
      }
    }
    if (n >= 1 && this.state === 'attack') {
      this.atk = null
      this.atkCd = a.cd ?? 1
      this.setState('chase')
      this.onAttackEnd()
    }
  }

  protected onHitPlayer(_a: AttackDef) {}

  protected canFlinch(heavy: boolean) {
    if (this.state === 'attack' && this.atk) {
      const n = this.st / this.atk.dur
      if (n < this.atk.hitEnd) return heavy && n < this.atk.hitStart * 0.7
    }
    return this.state !== 'special'
  }

  damageMult(source: string) {
    void source
    return 1
  }

  burnT = 0

  /** set on fire: damage over time, flames, fear of the light */
  ignite(sec: number) {
    if (!this.alive) return
    this.burnT = Math.max(this.burnT, sec)
  }

  takeHit(dmg: number, posture: number, fromX: number, fromZ: number, knock: number, heavy: boolean, source: 'melee' | 'arrow' | 'eagle' | 'fire'): boolean {
    if (!this.alive || this.hidden || this.cloakedNow || this.state === 'finished' || this.state === 'dormant') return false
    let m = this.damageMult(source)
    // Susar's rusty mark: the first blow of kylys, kalkan or arrow lands 25% harder
    if (this.marks.red > 0 && source !== 'eagle') {
      m *= 1.25
      this.marks.red = 0
    }
    this.hp -= dmg * m
    this.addPosture(posture * m)
    this.rig.hitFlash()
    this.knock(fromX, fromZ, knock * (this.weight === 'heavy' ? 0.15 : 1))
    if (!this.aggro) this.becomeAggro(true)
    if (this.hp <= 0) {
      this.die()
      return true
    }
    this.onDamaged()
    if (this.state === 'stagger') return true
    if (this.posture >= this.maxPosture) {
      this.enterStagger()
      return true
    }
    if (this.canFlinch(heavy)) {
      if (this.state === 'attack') this.onAttackEnd()
      this.atk = null
      this.setState('hurt')
    }
    return true
  }

  enterStagger() {
    if (this.state === 'attack') this.onAttackEnd()
    this.atk = null
    this.posture = this.maxPosture
    this.setState('stagger')
    this.w.sound('hit_heavy', this.pos, { indicate: false, vol: 0.7 })
    this.w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.4, to: 2.6, dur: 0.5, color: new THREE.Color(1.6, 1.1, 0.4), width: 0.1 })
  }

  get finishable() {
    return this.alive && this.state === 'stagger'
  }

  beginFinisher() {
    this.setState('finished')
  }

  finisherHit(_p: Player) {
    const dmg = this.kind === 'boss' ? this.maxHp * 0.18 : this.hp + 1
    this.hp -= dmg
    this.posture = 0
    this.rig.hitFlash()
    if (this.hp <= 0) this.die()
    else this.setState('hurt')
  }

  stun(sec: number) {
    if (!this.alive || this.state === 'stagger' || this.state === 'dormant') return
    if (this.state === 'attack') this.onAttackEnd()
    this.atk = null
    this.stunT = sec
    this.setState('stun')
  }

  die() {
    if (!this.alive) return
    this.alive = false
    this.hp = 0
    if (this.state === 'attack') this.onAttackEnd()
    this.atk = null
    this.setState('dead')
    this.deadT = 0
    this.rig.eyeBoost = 0
    this.emit(this.deathSound, 'neutral', 0.5)
    this.w.onEnemyDeath(this)
  }

  // ------------------------------------------------------------------ steering

  /** Move toward (tx,tz): direct when visible and close, otherwise follow the flow field. */
  steerTo(tx: number, tz: number, speed: number, stopAt = 0) {
    const dx = tx - this.pos.x
    const dz = tz - this.pos.z
    const d = Math.hypot(dx, dz)
    if (d <= stopAt) {
      this.desire.set(0, 0, 0)
      return
    }
    const p = this.w.player.pos
    const targetIsPlayer = Math.abs(tx - p.x) < 0.01 && Math.abs(tz - p.z) < 0.01
    if (d < 14 && this.w.field.los(this.pos.x, this.pos.z, tx, tz)) {
      this.desire.set((dx / d) * speed, 0, (dz / d) * speed)
    } else if (targetIsPlayer && this.w.field.flowDir(this.pos.x, this.pos.z, this.tmp)) {
      this.desire.set(this.tmp.x * speed, 0, this.tmp.z * speed)
    } else {
      this.desire.set((dx / d) * speed, 0, (dz / d) * speed)
    }
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    const w = this.w
    this.st += dt
    this.desire.set(0, 0, 0)
    let clip: Clip | null = null
    let ct = 0

    if (!this.alive) {
      this.deadT += dt
      clip = this.clips.death
      ct = Math.min(1, this.deadT / 1.0)
      if (this.deadT > 1.6) {
        const k = this.deadT - 1.6
        this.rig.root.position.y = -k * 0.7
        if (Math.random() < 0.5 && this.rig.root.visible)
          w.vfx.soft.spawn({ x: this.pos.x + rand(-0.5, 0.5), y: 0.2 + rand(0, 0.6), z: this.pos.z + rand(-0.5, 0.5), vy: 0.6, r: 0.02, g: 0.02, b: 0.03, a: 0.5, size: 0.6, life: 1.2, grow: 1.5 })
        if (this.deadT > 3.4) {
          this.removed = true
          this.rig.root.visible = false
        }
      }
      if (!this.removed) {
        this.rig.update(dt, { speed: 0, clip, t: ct, time: w.time, snap: this.deadT < 0.3 ? 2.2 : 0.9 })
        this.rig.root.rotation.y = this.facing
        if (this.deadT <= 1.6) this.syncRig()
        this.updateVisibility(dt)
      }
      return
    }

    this.atkCd -= dt
    this.revealT -= dt
    this.exposedT = Math.max(0, this.exposedT - dt)
    for (const k of Object.keys(this.marks) as MarkKind[]) this.marks[k] = Math.max(0, this.marks[k] - dt)
    if (this.burnT > 0) {
      this.burnT -= dt
      this.hp -= 7 * this.damageMult('fire') * dt
      if (Math.random() < 0.8) w.vfx.add.spawn({ x: this.pos.x + rand(-0.3, 0.3), y: 0.4 + rand(0, 1.4) + this.airY, z: this.pos.z + rand(-0.3, 0.3), vy: 1.5, r: 2.4, g: 0.9, b: 0.25, size: rand(0.06, 0.12), life: 0.5, drag: 1 })
      if (this.hp <= 0) {
        this.die()
        return
      }
    }
    this.decayPosture(dt, this.weight === 'heavy' ? 14 : 22)
    this.senseT -= dt
    if (this.senseT <= 0) {
      this.senseT = 0.15
      if (this.state !== 'dormant') this.perceive()
    }
    if (this.rig.eyeBoost > 0 && this.state !== 'attack') this.rig.eyeBoost = Math.max(0, this.rig.eyeBoost - dt * 3)

    const p = w.player
    switch (this.state) {
      case 'dormant':
        break
      case 'idle':
        this.facing = dampAngle(this.facing, this.homeFacing + Math.sin(w.time * 0.3 + this.id) * 0.6, 1, dt)
        break
      case 'alert': {
        const t = this.alertPoint ?? this.home
        const d = Math.hypot(t.x - this.pos.x, t.z - this.pos.z)
        if (d > 1.2 && this.st < 8) {
          this.steerTo(t.x, t.z, this.speed * 0.55)
        } else if (this.st > 2.5 || d <= 1.2) {
          if (this.alertPoint && this.alertPoint.distanceTo(this.home) > 1) {
            this.alertPoint = this.home.clone()
            this.setState('alert')
          } else {
            this.alertPoint = null
            this.setState('idle')
          }
        }
        break
      }
      case 'chase':
        if (!p.alive) {
          this.setState('idle')
          break
        }
        this.think(dt)
        break
      case 'attack':
        this.runAttack(dt)
        clip = this.attackClip()
        ct = this.attackClipT()
        break
      case 'hurt':
        clip = this.clips.hurt
        ct = this.st / 0.32
        if (this.st > 0.32) this.setState('chase')
        break
      case 'stagger':
        clip = this.clips.stagger ?? this.clips.hurt
        ct = Math.min(1, this.st / this.stagDur)
        if (this.st > this.stagDur) {
          this.posture = 0
          this.setState('chase')
        }
        break
      case 'stun':
        clip = this.clips.hurt
        ct = 0.2
        this.stunT -= dt
        if (this.stunT <= 0) this.setState('chase')
        break
      case 'finished':
        clip = this.clips.stagger ?? this.clips.hurt
        ct = 1
        if (this.st > 2) this.setState('chase')
        break
      case 'special': {
        const r = this.specialUpdate(dt)
        clip = r.clip
        ct = r.t
        break
      }
      case 'dead':
        break
    }

    this.move(dt, this.desire.x, this.desire.z)
    this.speedNow = Math.hypot(this.desire.x, this.desire.z)
    if (this.state === 'chase' || this.state === 'alert') {
      if (this.speedNow > 0.3) this.facing = dampAngle(this.facing, Math.atan2(this.desire.x, this.desire.z), 9, dt)
      if (this.state === 'chase' && this.facesPlayerClose && this.distToPlayer < 4) this.faceTo(p.pos.x, p.pos.z, 8, dt)
    }

    // footsteps & voice
    if (this.speedNow > 0.5 && !this.hidden && this.airY < 0.5) {
      this.stepT -= dt * clamp(this.speedNow / this.speed, 0.5, 1.6)
      if (this.stepT <= 0) {
        this.stepT = this.stepEvery
        this.emit(this.stepSound, this.aggro ? 'threat' : 'neutral', this.stepStrength, 0.8)
      }
    }
    this.voiceT -= dt
    if (this.voiceT <= 0 && this.state !== 'dormant') {
      this.voiceT = rand(4, 8)
      this.voice()
    }

    if (!clip) {
      if (this.state === 'special') clip = null
    }
    const fwd = this.speedNow > 0.1 ? (this.desire.x * this.fx + this.desire.z * this.fz) / this.speedNow : 1
    this.rig.update(dt, { speed: this.state === 'attack' ? 0 : this.speedNow, forward: fwd, clip, t: ct, time: w.time, snap: this.snapFor(), fear: this.rigFear() })
    this.syncRig()
    this.updateVisibility(dt)
  }

  protected attackClip(): Clip | null {
    const a = this.atk
    if (!a) return null
    const n = this.st / a.dur
    for (const [name, s, e] of a.phases) if (n >= s && n <= e) return this.clips[name]
    return this.clips[a.phases[a.phases.length - 1][0]]
  }

  protected attackClipT() {
    const a = this.atk
    if (!a) return 0
    const n = this.st / a.dur
    for (const [, s, e] of a.phases) if (n >= s && n <= e) return (n - s) / Math.max(0.001, e - s)
    return 1
  }

  forceHidden = false
  /** humanoids square up to the hero when close; wolves keep running along their path */
  protected facesPlayerClose = true

  /** Spring stiffness per state: strikes and flinches snap, everything else flows. */
  protected snapFor() {
    switch (this.state) {
      case 'attack':
        return this.weight === 'heavy' ? 1.7 : 2.1
      case 'hurt':
        return 2.7
      case 'stagger':
      case 'finished':
        return 1.4
      case 'special':
        return 1.6
      default:
        return 1
    }
  }

  protected updateVisibility(dt: number) {
    const w = this.w
    const sees = !this.hidden && !this.forceHidden && !this.cloakedNow && w.vision.sees(this.pos.x, this.pos.z)
    this.visibleNow = sees
    this.seen += ((sees ? 1 : 0) - this.seen) * (1 - Math.exp(-(sees ? 14 : 5) * dt))
    const reveal = this.revealT > 0 && !this.hidden && !this.removed && !this.cloakedNow
    this.rig.root.visible = !this.removed && (this.seen > 0.05 || reveal)
    const ghost = reveal && !sees
    if (ghost !== this.lastReveal) {
      this.lastReveal = ghost
      this.rig.setLayer(2, ghost)
    }
  }
}

// ======================================================================= UBYR

const UBYR_SWIPE: AttackDef = { dur: 1.25, hitStart: 0.44, hitEnd: 0.56, range: 2.3, arc: 110, dmg: 14, knock: 4, lunge: 0.9, lungeStart: 0.42, lungeEnd: 0.55, cd: 0.8, phases: [['swipe', 0, 1]], sound: 'ubyr_attack', swing: 'swing', slash: { dir: 1, tilt: 0.3 } }
const UBYR_LUNGE: AttackDef = { dur: 1.5, hitStart: 0.46, hitEnd: 0.62, range: 1.9, arc: 90, dmg: 20, heavy: true, knock: 7, lunge: 4.6, lungeStart: 0.45, lungeEnd: 0.6, cd: 2.2, phases: [['lunge', 0, 1]], sound: 'ubyr_attack', swing: 'swing_heavy' }

export class Ubyr extends Enemy {
  kind = 'ubyr' as const
  clips = UBYR_CLIPS
  rig: UbyrRig
  protected deathSound: SoundKind = 'ubyr_death'
  /** lies under the forest floor until the hero comes close, then claws its way out */
  buried = false
  private emergeT = -1
  constructor(w: World, x: number, z: number, buried = false) {
    super(w, x, z)
    this.rig = new UbyrRig()
    w.scene.add(this.rig.root)
    if (buried) {
      this.buried = true
      this.hidden = true
      this.airY = -1.9
      this.state = 'special'
    }
    this.hp = this.maxHp = 70
    this.maxPosture = 60
    this.speed = 2.8
    this.detect = 8
    this.radius = 0.45
    this.stepEvery = 0.62
    this.name = 'Убыр'
    this.bloodColor = new THREE.Color(0.12, 0.13, 0.06)
  }
  protected think(dt: number) {
    const p = this.w.player
    const d = this.distToPlayer
    this.steerTo(p.pos.x, p.pos.z, this.speed, 1.5)
    if (this.atkCd <= 0) {
      if (d < 2.3) this.startAttack(UBYR_SWIPE)
      else if (d > 3.4 && d < 6.2 && Math.random() < dt * 0.9 && this.w.field.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) this.startAttack(UBYR_LUNGE)
    }
  }
  protected voice() {
    if (this.buried && this.emergeT < 0) {
      // a muffled groan from under the earth: heard, never seen
      if (this.distToPlayer < 16) this.emit('ubyr_buried', 'threat', 0.35, 0.65)
      return
    }
    this.emit('ubyr_groan', this.aggro ? 'threat' : 'neutral', this.aggro ? 0.6 : 0.4, 0.8)
  }
  protected onAlert() {
    this.emit('ubyr_growl', 'threat', 0.7)
    this.rig.scream()
  }

  protected onDamaged() {
    this.emit('ubyr_hurt', 'threat', 0.5, 0.8)
  }

  update(dt: number) {
    this.rig.emerging = this.buried
    super.update(dt)
  }

  damageMult(source: string) {
    // the dead remember the pyre
    return source === 'fire' ? 1.6 : 1
  }

  becomeAggro(shout: boolean) {
    if (this.buried) {
      if (this.distToPlayer < 7.5) this.startEmerge()
      return
    }
    super.becomeAggro(shout)
  }

  hearNoise(p: THREE.Vector3, radius: number) {
    if (this.buried) {
      if (p.distanceTo(this.pos) < Math.min(radius, 7)) this.startEmerge()
      return
    }
    super.hearNoise(p, radius)
  }

  private startEmerge() {
    if (this.emergeT >= 0) return
    this.emergeT = 0
    this.hidden = false
    this.faceTo(this.w.player.pos.x, this.w.player.pos.z, 1)
    this.emit('ubyr_emerge', 'threat', 1)
    this.w.shake(0.2)
  }

  protected specialUpdate(dt: number) {
    if (!this.buried) return super.specialUpdate(dt)
    if (this.emergeT < 0) {
      if (this.distToPlayer < 6) this.startEmerge()
      return { clip: this.clips.stagger, t: 1 }
    }
    this.emergeT += dt
    const k = Math.min(1, this.emergeT / 1.7)
    this.airY = -1.9 * (1 - k * k * (3 - 2 * k))
    this.faceTo(this.w.player.pos.x, this.w.player.pos.z, 3, dt)
    if (Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2
      this.w.vfx.soft.spawn({ x: this.pos.x + Math.cos(a) * 0.5, y: 0.1, z: this.pos.z + Math.sin(a) * 0.5, vx: Math.cos(a) * 1.5, vy: 1.5 + Math.random() * 2.5, vz: Math.sin(a) * 1.5, r: 0.09, g: 0.075, b: 0.055, a: 0.9, size: 0.12 + Math.random() * 0.1, life: 0.9, drag: 1, gravity: 9 })
    }
    if (k >= 1) {
      this.buried = false
      this.airY = 0
      this.home.copy(this.pos)
      this.setState('chase')
      super.becomeAggro(false)
    }
    return { clip: this.clips.stagger, t: 1 - k }
  }
}

// ======================================================================= SHADOW WOLF

let wolfToken: Wolf | null = null

const WOLF_LEAP: AttackDef = {
  dur: 1.2,
  hitStart: 0.42,
  hitEnd: 0.62,
  range: 1.7,
  arc: 80,
  dmg: 11,
  knock: 3,
  lunge: 5.5,
  lungeStart: 0.38,
  lungeEnd: 0.6,
  cd: 2.5,
  phases: [
    ['crouch', 0, 0.38],
    ['leap', 0.38, 1],
  ],
  sound: 'wolf_bark',
  swing: 'bite',
}

export class Wolf extends Enemy {
  kind = 'wolf' as const
  clips = WOLF_CLIPS
  rig: Rig
  protected deathSound: SoundKind = 'wolf_death'
  private orbitDir = Math.random() < 0.5 ? 1 : -1
  private retreatT = 0
  protected facesPlayerClose = false
  constructor(w: World, x: number, z: number) {
    super(w, x, z)
    this.rig = new WolfRig()
    w.scene.add(this.rig.root)
    this.hp = this.maxHp = 36
    this.maxPosture = 30
    this.speed = 6.5
    this.detect = 10
    this.radius = 0.5
    this.stepEvery = 0.3
    this.stepSound = 'step_wolf'
    this.stepStrength = 0.4
    this.hitHeight = -0.35
    this.stagDur = 2.0
    this.name = 'Лесной волк'
    this.bloodColor = new THREE.Color(0.03, 0.03, 0.05)
  }
  protected think(dt: number) {
    const p = this.w.player
    const d = this.distToPlayer
    if (wolfToken && (!wolfToken.alive || wolfToken.state !== 'attack')) wolfToken = null
    this.retreatT -= dt
    if (this.retreatT > 0) {
      const dx = this.pos.x - p.pos.x
      const dz = this.pos.z - p.pos.z
      const l = Math.hypot(dx, dz) || 1
      this.desire.set((dx / l) * this.speed * 0.8, 0, (dz / l) * this.speed * 0.8)
      return
    }
    const los = this.w.field.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z)
    if (this.atkCd <= 0 && (!wolfToken || wolfToken === this) && d < 7 && los) {
      wolfToken = this
      this.startAttack(WOLF_LEAP)
      return
    }
    if (!los || d > 11) {
      this.steerTo(p.pos.x, p.pos.z, this.speed)
      return
    }
    const dx = p.pos.x - this.pos.x
    const dz = p.pos.z - this.pos.z
    const nx = dx / d
    const nz = dz / d
    const radial = clamp((d - 5) * 0.7, -1, 1)
    let vx = -nz * this.orbitDir + nx * radial
    let vz = nx * this.orbitDir + nz * radial
    const l = Math.hypot(vx, vz) || 1
    vx /= l
    vz /= l
    if (this.w.field.sample(this.pos.x + vx * 1.5, this.pos.z + vz * 1.5) < 0.6) this.orbitDir *= -1
    // quadrupeds cannot strafe: circle with the body along the path, head turned to the prey
    this.desire.set(vx * this.speed * 0.7, 0, vz * this.speed * 0.7)
    void dt
  }
  protected onAttackEnd() {
    if (wolfToken === this) wolfToken = null
    this.retreatT = 0.6
    this.atkCd = rand(2.2, 3.6)
  }
  /** the vessel's sparks: wolves bolt from the fire (docs/COMBAT.md, «Вспышка живицы») */
  scare(fromX: number, fromZ: number) {
    if (!this.alive) return
    if (this.state === 'attack') this.onAttackEnd()
    this.atk = null
    this.knock(fromX, fromZ, 4)
    this.retreatT = 2
    this.becomeAggro(false)
    if (this.state !== 'stagger') this.setState('chase')
    this.emit('wolf_hurt', 'threat', 0.5, 0.7)
  }
  protected override canFlinch(_heavy?: boolean) {
    return true
  }
  protected voice() {
    if (this.aggro) this.emit(this.distToPlayer < 8 && Math.random() < 0.25 ? 'wolf_bark' : 'wolf_growl', 'threat', 0.5, 0.7)
  }
  protected onAlert() {
    this.emit('wolf_howl', 'threat', 0.9)
  }
  protected onDamaged() {
    this.emit('wolf_hurt', 'threat', 0.6, 0.85)
  }
  protected rigFear() {
    return this.alive && (this.state === 'hurt' || this.state === 'stagger' || this.state === 'stun' || this.state === 'finished' || this.retreatT > 0) ? 1 : 0
  }
  update(dt: number) {
    super.update(dt)
    if (this.alive && this.speedNow > 1 && Math.random() < 0.5 && this.rig.root.visible)
      this.w.vfx.soft.spawn({ x: this.pos.x + rand(-0.3, 0.3), y: 0.5 + rand(0, 0.4), z: this.pos.z + rand(-0.3, 0.3), vy: 0.3, r: 0.01, g: 0.012, b: 0.02, a: 0.55, size: 0.5, life: 0.7, grow: 1.4 })
  }
}

// ======================================================================= PACK LEADER

/**
 * Zone 7 (docs/LEVELS.md): the leader keeps to the dark on a high stone ledge and howls up reinforcements for the pack.
 * Out of the kylys's reach: an arrow (or Kara) brings him down.
 */
export class WolfLeader extends Wolf {
  private howlT = 2.5
  private called: Wolf[] = []
  constructor(w: World, x: number, z: number) {
    super(w, x, z)
    this.ledge = true
    this.hp = this.maxHp = 75
    this.maxPosture = 50
    this.detect = 18
    this.radius = 0.65
    this.name = 'Вожак стаи'
    this.airY = 1.55
    this.rig.root.scale.setScalar(1.38)
  }
  protected override canFlinch(heavy = false) {
    return heavy
  }
  protected override rigFear(): 0 | 1 {
    return 0
  }
  protected onDamaged() {
    this.emit(Math.random() < 0.5 ? 'wolf_bark' : 'wolf_growl', 'threat', 0.8, 1.1)
  }
  protected onAlert() {
    this.emit('wolf_howl', 'threat', 1.0)
    this.howlT = 1.0
  }
  protected think(dt: number) {
    const p = this.w.player
    this.faceTo(p.pos.x, p.pos.z, 4, dt)
    this.desire.set(0, 0, 0)
    this.howlT -= dt
    this.called = this.called.filter((e) => e.alive)
    if (this.howlT <= 0) {
      this.howlT = rand(6, 9)
      this.emit('wolf_howl', 'threat', 1)
      this.w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.5, to: 4.5, dur: 0.9, color: new THREE.Color(0.8, 0.25, 0.1), width: 0.08 })
      if (this.called.length < 3) {
        // a wolf answers out of the dark at the far end of the ravine
        const a = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + rand(-0.8, 0.8)
        for (let i = 0; i < 6; i++) {
          const r = rand(7, 11)
          const x = this.pos.x + Math.sin(a + i) * r
          const z = this.pos.z + Math.cos(a + i) * r
          if (this.w.field.clearance(x, z) > 0.8 && !this.w.vision.sees(x, z)) {
            const spawned = this.w.spawnEnemy('wolf', x, z, true) as Wolf
            if (spawned) this.called.push(spawned)
            break
          }
        }
      }
    }
  }
  update(dt: number) {
    super.update(dt)
    if (this.alive) this.airY = 1.55
    // he stays on his stone: no knockback carries him off
    this.pos.x = this.home.x
    this.pos.z = this.home.z
  }
  scare() {}
  stun(sec: number) {
    super.stun(Math.min(sec, 1))
  }
  resetToHome() {
    super.resetToHome()
    this.airY = 1.55
    this.rig.root.scale.setScalar(1.38)
  }
  die() {
    super.die()
    // with the pack leader fallen, the wolves lose heart and scatter into the dark
    for (const w of this.w.enemies) {
      if (w.kind === 'wolf' && w !== this && w.alive) {
        w.scare(this.pos.x, this.pos.z)
      }
    }
  }
}

// ======================================================================= MOROK

const ALB_CAST: AttackDef = { dur: 1.45, hitStart: 0.62, hitEnd: 0.63, range: 0, arc: 0, dmg: 0, knock: 0, cd: 2.6, phases: [['cast', 0, 1]], sound: 'cast' }
const ALB_CLAW: AttackDef = { dur: 1.0, hitStart: 0.42, hitEnd: 0.55, range: 2.1, arc: 100, dmg: 12, knock: 4, lunge: 0.6, lungeStart: 0.4, lungeEnd: 0.52, cd: 1.2, phases: [['claw', 0, 1]], swing: 'swing', slash: { dir: 1, tilt: 0.2, color: new THREE.Color(0.8, 0.3, 1.4) } }

/**
 * A phantom of the thicket (docs/LEVELS.md, zones 9–10): invisible and untouchable until Susar tears its veil.
 * It slips away from the light, throws cold lights from afar and claws close by.
 */
export class Morok extends Enemy {
  kind = 'morok' as const
  clips = MOROK_CLIPS
  rig: Rig
  private handGlow: THREE.MeshBasicMaterial
  private teleCd = 2
  private tele: 'out' | 'gone' | 'in' = 'out'
  private teleTarget = new THREE.Vector3()
  private strafe = Math.random() < 0.5 ? 1 : -1
  /** waits unseen; when the hero comes close she appears where he is not looking */
  private lurking = false
  constructor(w: World, x: number, z: number, lurk = false) {
    super(w, x, z)
    const m = createMorok()
    this.rig = m.rig
    this.handGlow = m.handGlow
    w.scene.add(this.rig.root)
    if (lurk) {
      this.lurking = true
      this.hidden = true
      this.tele = 'gone'
      this.state = 'special'
      this.rig.root.scale.setScalar(0.01)
    }
    this.hp = this.maxHp = 55
    this.maxPosture = 40
    this.speed = 3.2
    this.detect = 11
    this.radius = 0.42
    this.stepEvery = 9999
    this.cloaked = true
    this.name = 'Морок'
    this.bloodColor = new THREE.Color(0.25, 0.1, 0.35)
  }
  damageMult(source: string) {
    let m = this.w.isLit(this.pos.x, this.pos.z) ? 1.5 : 1
    if (source === 'arrow') m *= 1.6
    return m
  }
  protected think(dt: number) {
    const p = this.w.player
    const d = this.distToPlayer
    this.teleCd -= dt
    // the coal's glow close by drives it off
    const glow = p.lightOn && d < 4
    if (this.teleCd <= 0 && (d < 3.2 || glow)) {
      this.startTeleport()
      return
    }
    const los = this.w.field.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z)
    if (this.atkCd <= 0) {
      if (d < 2.2) {
        this.startAttack(ALB_CLAW)
        return
      }
      if (d < 16 && los) {
        this.startAttack(ALB_CAST)
        return
      }
    }
    if (!los || d > 12) {
      this.steerTo(p.pos.x, p.pos.z, this.speed)
    } else if (d < 6) {
      const dx = this.pos.x - p.pos.x
      const dz = this.pos.z - p.pos.z
      this.desire.set((dx / d) * this.speed, 0, (dz / d) * this.speed)
    } else {
      const nx = (p.pos.x - this.pos.x) / d
      const nz = (p.pos.z - this.pos.z) / d
      if (this.w.field.sample(this.pos.x - nz * this.strafe * 1.5, this.pos.z + nx * this.strafe * 1.5) < 0.6) this.strafe *= -1
      this.desire.set(-nz * this.strafe * 1.4, 0, nx * this.strafe * 1.4)
    }
    this.faceTo(p.pos.x, p.pos.z, 6, dt)
  }
  protected onStrike(a: AttackDef) {
    if (a !== ALB_CAST) return
    const p = this.w.player
    const base = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z)
    for (const off of [-0.28, 0, 0.28]) {
      const dir = new THREE.Vector3(Math.sin(base + off), 0, Math.cos(base + off))
      this.w.projectiles.spawnOrb(new THREE.Vector3(this.pos.x + dir.x * 0.6, 1.5, this.pos.z + dir.z * 0.6), dir)
    }
    this.emit('orb', 'magic', 0.7)
  }
  private startTeleport() {
    this.teleCd = this.w.isLit(this.pos.x, this.pos.z) ? 3.5 : 6
    this.tele = 'out'
    this.setState('special')
    this.emit('teleport', 'magic', 0.7)
  }
  becomeAggro(shout: boolean) {
    if (this.lurking) return
    super.becomeAggro(shout)
  }
  hearNoise(p: THREE.Vector3, radius: number) {
    if (this.lurking) return
    super.hearNoise(p, radius)
  }
  private pickSpot(rMin = 8, rMax = 12) {
    const p = this.w.player
    const f = this.w.field
    let fallback: THREE.Vector3 | null = null
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2
      const r = rand(rMin, rMax)
      const x = p.pos.x + Math.sin(a) * r
      const z = p.pos.z + Math.cos(a) * r
      if (f.clearance(x, z) < 1) continue
      if (!f.los(p.pos.x, p.pos.z, x, z)) continue
      const v = new THREE.Vector3(x, 0, z)
      if (!this.w.vision.sees(x, z)) return v
      fallback ??= v
    }
    return fallback ?? this.pos.clone()
  }
  protected specialUpdate(dt: number) {
    const s = this.rig.root.scale
    if (this.tele === 'out') {
      s.set(1 - this.st / 0.4, 1 + this.st, 1 - this.st / 0.4)
      this.burst()
      if (this.st >= 0.4) {
        this.hidden = true
        this.tele = 'gone'
        this.st = 0
        this.teleTarget.copy(this.pickSpot())
      }
    } else if (this.tele === 'gone') {
      s.setScalar(0.01)
      if (this.lurking) {
        if (this.distToPlayer > 11 || !this.w.player.alive) return { clip: this.clips.cast, t: 0.3 }
        // first appearance: close, and outside Aldar's gaze
        this.lurking = false
        this.teleTarget.copy(this.pickSpot(5.5, 8))
        this.st = 0.55
      }
      if (this.st >= 0.55) {
        this.pos.copy(this.teleTarget)
        this.hidden = false
        this.tele = 'in'
        this.st = 0
        this.emit('whisper', 'magic', 0.6)
      }
    } else {
      const k = Math.min(1, this.st / 0.4)
      s.set(k, 2 - k, k)
      this.burst()
      if (this.st >= 0.4) {
        s.setScalar(1)
        this.atkCd = Math.min(this.atkCd, 0.4)
        this.setState('chase')
        if (!this.aggro) super.becomeAggro(false)
      }
    }
    void dt
    return { clip: this.clips.cast, t: 0.3 }
  }
  private burst() {
    if (!this.rig.root.visible) return
    for (let i = 0; i < 2; i++)
      this.w.vfx.add.spawn({ x: this.pos.x + rand(-0.4, 0.4), y: rand(0.3, 2), z: this.pos.z + rand(-0.4, 0.4), vy: rand(0.5, 2), r: 0.8, g: 0.35, b: 1.6, size: 0.07, life: 0.6, drag: 1 })
  }
  protected voice() {
    if (this.lurking) {
      // heard long before she is seen
      if (this.distToPlayer < 22) this.emit('whisper', 'magic', 0.35, 0.55)
      return
    }
    this.emit('whisper', 'magic', this.aggro ? 0.6 : 0.4, 0.8)
  }
  protected onAlert() {
    this.emit('whisper', 'magic', 0.7)
  }
  update(dt: number) {
    if (this.alive) this.airY = 0.28 + Math.sin(this.w.time * 2 + this.id) * 0.08
    super.update(dt)
    let g = 0
    if (this.state === 'attack' && this.atk === ALB_CAST) {
      const n = this.st / ALB_CAST.dur
      g = n < 0.62 ? smoothstep(0, 0.6, n) : Math.max(0, 1 - (n - 0.62) * 5)
    }
    this.handGlow.color.setRGB(1.2 * g, 0.45 * g, 2.4 * g)
  }
}
