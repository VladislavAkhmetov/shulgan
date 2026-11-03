import * as THREE from 'three'
import { Actor, WADE, inArc } from './actor'
import { createHero, HERO_CLIPS, type HeroModel } from './models'
import type { HeroAnimator } from './heroAnim'
import type { Clip } from './rig'
import type { World } from '../world'
import type { Input } from '../core/input'
import type { AttackDef, HitInfo, HitResult } from '../types'
import type { Enemy } from './enemies'
import { CAM_YAW, clamp, damp, dampAngle, rand, smoothstep, wrapAngle } from '../util'
import { WEAPONS, hitRange, tipReach, trailBand, type MeleeWeapon } from '../rpg/weapons'

export type Weapon = 'blade' | 'bow'

export type PState =
  | 'move'
  | 'attack'
  | 'charge'
  | 'slam'
  | 'dodge'
  | 'hurt'
  | 'drink'
  | 'lasso'
  | 'pull'
  | 'bow'
  | 'eagle'
  | 'interact'
  | 'grabbed'
  | 'finisher'
  | 'dead'

/** ext: how far past the weapon's tip the blow carries (a thrust straightens the arm and leans in) */
type PAttack = AttackDef & { cancel: number; ext: number }
type PAttackDef = Omit<PAttack, 'range'>

// the blade's trail warms with the series and burns ochre in rage
const SLASH_BONE = new THREE.Color(0.62, 0.6, 0.55)
const SLASH_AMBER = new THREE.Color(1.1, 0.68, 0.3)
const SLASH_RAGE = new THREE.Color(1.6, 0.55, 0.18)

// short kylys moveset (docs/COMBAT.md §2, §7); range comes from the weapon (rpg/weapons.ts)
const ATK: Record<string, PAttackDef> = {
  // Косой: diagonal cut from the right
  kos: { dur: 0.34, hitStart: 0.34, hitEnd: 0.56, ext: 0, arc: 150, dmg: 9, posture: 5, knock: 2.5, lunge: 0.7, lungeStart: 0.25, lungeEnd: 0.5, phases: [['atk1', 0, 1]], cancel: 0.58, slash: { dir: -1, tilt: 0.35 } },
  // Обратный: backhand
  obr: { dur: 0.34, hitStart: 0.34, hitEnd: 0.56, ext: 0, arc: 150, dmg: 9, posture: 5, knock: 2.5, lunge: 0.7, lungeStart: 0.25, lungeEnd: 0.5, phases: [['atk2', 0, 1]], cancel: 0.58, slash: { dir: 1, tilt: -0.3 } },
  // Укол: a lunge with the point, reaches 0.6 m further
  ukol: { dur: 0.4, hitStart: 0.46, hitEnd: 0.62, ext: 0.6, arc: 50, dmg: 11, posture: 7, knock: 3, lunge: 1.3, lungeStart: 0.36, lungeEnd: 0.56, phases: [['thrust', 0, 1]], cancel: 0.64 },
  // Полумесяц: a full turn with the blade flat, the finale of the string
  polu: { dur: 0.55, hitStart: 0.28, hitEnd: 0.66, ext: 0.15, arc: 360, dmg: 16, posture: 12, knock: 5.5, lunge: 0.5, lungeStart: 0.2, lungeEnd: 0.5, phases: [['crescent', 0, 1]], cancel: 0.74, slash: { dir: 1, tilt: 0.04 } },
  // Выпад сквозь: thrust out of a dash
  vypad: { dur: 0.4, hitStart: 0.4, hitEnd: 0.62, ext: 0.5, arc: 70, dmg: 14, posture: 8, knock: 4, lunge: 2.4, lungeStart: 0.25, lungeEnd: 0.6, phases: [['thrust', 0, 1]], cancel: 0.66 },
  // Рассечение: overhead cut; charge and fires change it (startSlam)
  slam: { dur: 0.62, hitStart: 0.2, hitEnd: 0.34, ext: 0.1, arc: 120, dmg: 22, posture: 26, knock: 7, heavy: true, lunge: 1.1, lungeStart: 0.05, lungeEnd: 0.22, phases: [['slam', 0, 1]], cancel: 0.7, slash: { dir: 1, tilt: 1.45 } },
}
const STRING = ['kos', 'obr', 'ukol', 'polu']

export class Player extends Actor {
  rig: HeroModel['rig']
  model: HeroModel
  state: PState = 'move'
  st = 0
  aimPoint = new THREE.Vector3()
  aimAngle = 0
  /** Where Timer actually looks: body facing + a neck-limited turn toward the cursor. Drives vision. */
  gaze = 0
  gazeOff = 0
  stance = false
  private idleTurning = false
  private visYaw = 0
  private lastDt = 0.016
  combo = 0
  /** blades started, ever (onboarding counts them) */
  swings = 0
  comboIdle = 0
  bufferT = 0
  lmbHeld = false
  holdT = 0
  chargeT = 0
  attack: PAttack = { ...ATK.kos, range: hitRange(WEAPONS.kylys) }
  hitSet = new Set<Enemy>()
  swung = false
  impactDone = false
  dodgeCharges = 2
  dodgeMax = 2
  dodgeRecharge = 0
  iframes = 0
  dodgeStart = -10
  dodgeDir = new THREE.Vector3()
  lassoCd = 0
  eagleCd = 0
  sips = 3
  maxSips = 3
  torchOn = true
  torchDoused = 0
  bowDraw = 0
  /** arrows loosed, ever (the body plays the recoil on each) */
  arrowsShot = 0
  /**
   * Блок comes with the shield (docs/COMBAT.md, «Блок»): until Timer has one, Shift is only the stance.
   * The guard pose (Mixamo block) and the −70% switch on together, with their own onboarding step.
   */
  hasShield = false
  /** what is in Timer's hands: [1] the kylys, [2] the bow (docs/COMBAT.md, «Оружие») */
  weapon: Weapon = 'blade'
  /** the blade in hand: its length sets the reach and the slash trail of every blow */
  melee: MeleeWeapon = WEAPONS.kylys
  /** seconds left in the combat stance after the last blow, dodge or hit */
  private combatT = 0
  /** a switch asked for mid-swing, applied when he is free */
  private pendingWeapon: Weapon | null = null
  /** a flat amber line on the ground while the bow is drawn: where the arrow will go */
  private aimLine: THREE.Mesh
  healPending = false
  checkpoint = new THREE.Vector3()
  grabProgress = 0
  finisherTarget: Enemy | null = null
  finisherDone = false
  interactCb: (() => void) | null = null
  interactDone = false
  private stepAcc = 0
  /** Серия: blows landed in a row; each adds +8% to the next */
  series = 0
  private seriesT = 0
  /** Запал: 0..30, every 10 is one fire; heavy blows spend all fires */
  zeal = 0
  private lastLandT = -10
  /** Ответ is open until this time (after a perfect dodge) */
  private counterUntil = -10
  private counterNow = false
  /** fires spent by the current heavy blow */
  private heavyFires = 0
  /** last ranged tool that hit (bow, lasso, eagle) — a blade hit soon after links them */
  private lastTool = { kind: '', t: -10 }
  private spin = 0
  /** Mixamo body, when loaded */
  anim: HeroAnimator | null = null
  /** the tracker's sense: Timer walks slowly, reading the ground */
  slowWalk = false
  private attackName = 'kos'
  private landed = false
  private heavyFull = false
  private breathT = 1.5
  /** current ground speed (the companion paces herself by it) */
  speedNow = 0
  private moveDir = new THREE.Vector3()
  private v = new THREE.Vector3()
  // lasso
  private rope: THREE.Mesh
  private loop: THREE.Mesh
  lasso = { phase: 'none' as 'none' | 'out' | 'back' | 'hold', len: 0, dir: new THREE.Vector3(), target: null as Enemy | null, thrown: false, t: 0 }

  constructor(w: World) {
    super(w)
    this.model = createHero(w.vfx)
    this.rig = this.model.rig
    w.scene.add(this.rig.root)
    this.radius = 0.42
    this.hp = this.maxHp = 100
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 0.9 })
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 4).translate(0, 0.5, 0), ropeMat)
    this.loop = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.022, 4, 14), ropeMat)
    this.rope.visible = this.loop.visible = false
    this.rope.frustumCulled = false
    w.scene.add(this.rope, this.loop)
    const aimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.85, 0.3), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    this.aimLine = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 1).rotateX(-Math.PI / 2).translate(0, 0.06, 0.5), aimMat)
    this.aimLine.visible = false
    this.aimLine.frustumCulled = false
    this.aimLine.renderOrder = 3
    w.scene.add(this.aimLine)
  }

  /** Take the kylys or the bow. Mid-swing the switch waits until the blow is done. */
  setWeapon(wp: Weapon) {
    if (!this.alive) return
    if (this.state !== 'move' && this.state !== 'bow') {
      this.pendingWeapon = wp
      return
    }
    this.pendingWeapon = null
    if (this.state === 'bow') this.setState('move')
    if (this.weapon === wp) return
    this.weapon = wp
    this.bowDraw = 0
    this.w.sound('swing', this.pos, { indicate: false, vol: 0.25 })
    this.w.toast(wp === 'bow' ? 'Лук' : 'Кылыс', 'info', wp === 'bow' ? 'bow' : 'kylys')
  }

  private startDraw() {
    if (this.w.rpg.count('arrow') + this.w.rpg.count('arrow_fire') <= 0) {
      this.w.toast('Колчан пуст', 'warn', 'bow')
      this.w.sound('ui', null, { indicate: false, vol: 0.5 })
      return
    }
    this.bowDraw = 0
    this.setState('bow')
  }

  get canAct() {
    return this.state === 'move' || (this.state === 'attack' && this.st / this.attack.dur >= this.attack.cancel) || (this.state === 'hurt' && this.st > 0.25)
  }

  setState(s: PState) {
    this.state = s
    this.st = 0
  }

  respawnAt(p: THREE.Vector3) {
    this.pos.copy(p)
    this.vel.set(0, 0, 0)
    this.hp = this.maxHp
    this.sips = this.maxSips
    this.alive = true
    this.airY = 0
    this.iframes = 1.5
    this.torchDoused = 0
    this.w.rpg.oil = Math.max(this.w.rpg.oil, 0.5)
    this.lasso.phase = 'none'
    this.lasso.target = null
    this.visYaw = this.facing
    this.setState('move')
  }

  /** Logic turns instantly (attacks hit where you aim); the visible body turns smoothly. */
  syncRig() {
    this.visYaw = dampAngle(this.visYaw, this.facing, 20, this.lastDt)
    this.rig.root.position.set(this.pos.x, this.airY, this.pos.z)
    // the Mixamo Полумесяц turns the body itself
    const clipSpins = this.anim?.has('atk_polu')
    this.rig.root.rotation.y = this.visYaw + (this.state === 'attack' && !clipSpins ? this.spin : 0)
  }

  // ------------------------------------------------------------------ damage

  takeHit(h: HitInfo): HitResult {
    if (!this.alive) return 'immune'
    if (this.state === 'finisher' || this.state === 'pull' || this.state === 'grabbed') return 'immune'
    if (this.iframes > 0) return this.w.time - this.dodgeStart < 0.22 ? 'perfect' : 'iframe'
    // Блок (Shift with the kylys): a blow from the front loses 70%, heavy blows and grabs break through (COMBAT.md §2)
    const blocking = this.blocking && !h.heavy && !h.grab
    const frontal = Math.abs(wrapAngle(Math.atan2(h.x - this.pos.x, h.z - this.pos.z) - this.facing)) < 1.3
    // a blow that would kill even through the guard is taken in full below
    if (blocking && frontal && this.hp > h.dmg * 0.3) {
      this.hp -= h.dmg * 0.3
      this.combatT = 4
      this.w.sound('clang', this.pos, { indicate: false, vol: 0.7 })
      this.w.shake(0.12)
      this.model.bladeTip.getWorldPosition(this.v)
      this.w.vfx.hit(this.v.x, this.v.y, this.v.z, h.x - this.pos.x, h.z - this.pos.z, false, new THREE.Color(1.6, 0.9, 0.4))
      this.knock(h.x, h.z, h.knock * 0.35)
      return 'hit'
    }
    this.hp -= h.dmg
    this.rig.hitFlash()
    this.w.sound('hurt', null, { indicate: false })
    this.w.damagePulse(Math.min(1, 0.45 + h.dmg / 30))
    this.w.shake(h.heavy ? 0.5 : 0.25)
    this.w.vfx.hit(this.pos.x, 1.1, this.pos.z, this.pos.x - h.x, this.pos.z - h.z, !!h.heavy, new THREE.Color(0.35, 0.03, 0.02))
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
      this.cancelLasso()
      this.setState('dead')
      this.w.sound('death', this.pos, { indicate: false })
      return 'hit'
    }
    this.series = 0
    if (!this.w.rpg.has('fourth')) this.zeal *= 0.5
    if (h.grab) return 'hit'
    this.knock(h.x, h.z, h.knock)
    if (h.heavy || h.dmg >= 15 || this.state === 'drink' || this.state === 'bow') {
      this.cancelLasso()
      this.setState('hurt')
    }
    return 'hit'
  }

  /** Shift with the kylys and a shield */
  get blocking() {
    return this.hasShield && this.state === 'move' && this.stance && this.weapon === 'blade'
  }

  /** Timer's hand in the world: the Mixamo bone when the body is loaded, the procedural joint before that */
  handWorld(side: 'L' | 'R', out: THREE.Vector3) {
    return this.anim?.handWorld(side, out) ?? (side === 'L' ? this.model.handL : this.model.sword).getWorldPosition(out)
  }

  heal(v: number) {
    this.hp = Math.min(this.maxHp, this.hp + v)
  }

  /** Damage that bypasses dodge frames (grab ticks, throws). */
  directDamage(d: number) {
    if (!this.alive) return
    this.hp -= d
    this.rig.hitFlash()
    this.w.damagePulse(0.6)
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
      this.airY = 0
      this.setState('dead')
      this.w.sound('death', this.pos, { indicate: false })
    }
  }

  // ------------------------------------------------------------------ actions

  get fires() {
    return Math.floor(this.zeal / 10)
  }

  /** a perfect dodge opens Ответ for a moment */
  onPerfectDodge() {
    this.counterUntil = this.w.time + 0.6
  }

  /** bow, lasso or eagle connected: a blade hit within 1.5 s links the tools */
  noteTool(kind: string) {
    this.lastTool = { kind, t: this.w.time }
  }

  addZeal(n: number) {
    const before = this.fires
    this.zeal = Math.min(30, this.zeal + n)
    if (this.fires > before) {
      this.w.sound('ignite', null, { indicate: false, vol: 0.35 })
      this.w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.2, to: 1.2, dur: 0.4, color: new THREE.Color(1.6, 0.7, 0.25), width: 0.04 })
    }
  }

  private startAttack(name: string) {
    const base = this.armed(ATK[name])
    // rage (three fires): blows come 10% faster
    this.attack = this.fires >= 3 ? { ...base, dur: base.dur * 0.9 } : base
    this.combo = Math.max(0, STRING.indexOf(name))
    this.swings++
    this.attackName = name
    this.landed = false
    this.counterNow = this.w.time < this.counterUntil
    if (this.counterNow) this.counterUntil = -10
    this.hitSet.clear()
    this.swung = false
    this.impactDone = false
    this.facing = this.aimAngle
    this.bufferT = 0
    this.setState('attack')
  }

  private startSlam() {
    const p = clamp(this.chargeT / 0.85, 0, 1)
    this.heavyFires = this.fires
    this.zeal -= this.heavyFires * 10
    this.attack = { ...this.armed(ATK.slam), dmg: Math.round(22 + p * 12), posture: Math.round(26 + p * 14), knock: 7 + p * 4 }
    this.attackName = 'slam'
    this.landed = false
    this.heavyFull = p >= 0.95
    this.counterNow = this.w.time < this.counterUntil
    if (this.counterNow) this.counterUntil = -10
    this.hitSet.clear()
    this.swung = false
    this.impactDone = false
    this.facing = this.aimAngle
    this.setState('slam')
    if (this.heavyFires > 0) this.w.sound('ignite', null, { indicate: false, vol: 0.6 })
  }

  /** a blow as dealt with the weapon in hand: the reach follows its length */
  private armed(base: PAttackDef): PAttack {
    return { ...base, range: hitRange(this.melee, base.ext) }
  }

  private tryDodge(mx: number, mz: number) {
    if (this.dodgeCharges <= 0) return false
    this.dodgeCharges--
    if (this.dodgeRecharge <= 0) this.dodgeRecharge = this.w.rpg.dodgeRecharge
    if (Math.hypot(mx, mz) < 0.1) {
      mx = -Math.sin(this.aimAngle)
      mz = -Math.cos(this.aimAngle)
    }
    const l = Math.hypot(mx, mz)
    this.dodgeDir.set(mx / l, 0, mz / l)
    // the dash is a forward lunge, so the body turns into it (the spring rig smooths the turn)
    this.facing = Math.atan2(this.dodgeDir.x, this.dodgeDir.z)
    this.iframes = 0.27
    this.dodgeStart = this.w.time
    this.cancelLasso()
    this.setState('dodge')
    this.w.sound('dodge', null, { indicate: false })
    this.w.vfx.dust(this.pos.x, this.pos.z, 8, 0.6, new THREE.Color(0.16, 0.14, 0.12))
    this.w.playerNoise(this.pos, 4)
    return true
  }

  startFinisher(e: Enemy) {
    this.pendingWeapon = null
    this.finisherTarget = e
    this.finisherDone = false
    this.facing = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z)
    this.iframes = 1.1
    this.setState('finisher')
    e.beginFinisher()
  }

  startInteract(cb: () => void) {
    this.interactCb = cb
    this.interactDone = false
    this.setState('interact')
  }

  grabbedBy() {
    this.cancelLasso()
    this.grabProgress = 0
    this.setState('grabbed')
  }

  release(throwX: number, throwZ: number, force: number) {
    this.airY = 0
    this.iframes = 0.7
    if (force > 0) {
      this.knock(throwX, throwZ, force)
      this.setState('hurt')
    } else this.setState('move')
  }

  private cancelLasso() {
    if (this.lasso.phase !== 'none') this.lasso.phase = 'back'
    this.lasso.target = null
  }

  // ------------------------------------------------------------------ update

  update(dt: number, inp: Input) {
    const w = this.w
    this.st += dt
    this.iframes = Math.max(0, this.iframes - dt)
    this.lassoCd = Math.max(0, this.lassoCd - dt)
    this.eagleCd = Math.max(0, this.eagleCd - dt)
    this.bufferT = Math.max(0, this.bufferT - dt)
    this.torchDoused = Math.max(0, this.torchDoused - dt)
    if (this.dodgeCharges < this.dodgeMax) {
      this.dodgeRecharge -= dt
      if (this.dodgeRecharge <= 0) {
        this.dodgeCharges++
        this.dodgeRecharge = this.dodgeCharges < this.dodgeMax ? w.rpg.dodgeRecharge : 0
      }
    }
    if (this.state === 'move') {
      this.comboIdle += dt
      if (this.comboIdle > 0.55) this.combo = 0
    } else this.comboIdle = 0
    this.decayPosture(dt, 30)

    // aim
    const ax = this.aimPoint.x - this.pos.x
    const az = this.aimPoint.z - this.pos.z
    if (ax * ax + az * az > 0.09) this.aimAngle = Math.atan2(ax, az)

    // camera-relative movement input
    const ix = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0)
    const iy = (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0)
    const rx = Math.cos(CAM_YAW)
    const rz = -Math.sin(CAM_YAW)
    const ux = -Math.sin(CAM_YAW)
    const uz = -Math.cos(CAM_YAW)
    let mx = rx * ix + ux * iy
    let mz = rz * ix + uz * iy
    let ml = Math.hypot(mx, mz)
    if (ml > 0) {
      mx /= ml
      mz /= ml
    } else if (inp.moveX || inp.moveY) {
      // analog stick: keep magnitude for walk/run blending
      mx = rx * inp.moveX + ux * inp.moveY
      mz = rz * inp.moveX + uz * inp.moveY
      ml = Math.min(1, Math.hypot(mx, mz))
      const l = Math.hypot(mx, mz) || 1
      mx = (mx / l) * ml
      mz = (mz / l) * ml
    }
    this.moveDir.set(mx, 0, mz)

    // LMB hold tracking
    if (inp.pressed('Mouse0')) {
      this.lmbHeld = true
      this.holdT = 0
    }
    if (this.lmbHeld) this.holdT += dt
    if (inp.released('Mouse0')) this.lmbHeld = false

    // torch (needs oil)
    if (inp.pressed('KeyT') && this.alive) {
      if (this.torchDoused > 0) w.sound('douse', this.pos, { indicate: false, vol: 0.4 })
      else if (!this.torchOn && w.rpg.oil <= 0.001) {
        w.toast('Нет масла', 'warn', 'lantern')
        w.sound('douse', this.pos, { indicate: false, vol: 0.4 })
      } else {
        this.torchOn = !this.torchOn
        w.sound(this.torchOn ? 'ignite' : 'douse', this.pos, { indicate: false, vol: 0.5 })
      }
    }

    // ---- RPG: derived max health, buffs, quick items, arrow type
    const rpg = w.rpg
    if (this.maxHp !== rpg.maxHp) {
      const grow = rpg.maxHp - this.maxHp
      this.maxHp = rpg.maxHp
      if (grow > 0) this.hp += grow
      this.hp = Math.min(this.hp, this.maxHp)
    }
    // the series dies after a pause; the zeal cools slowly a while after the last landed blow
    this.seriesT -= dt
    if (this.seriesT <= 0) this.series = 0
    if (w.time - this.lastLandT > 6) this.zeal = Math.max(0, this.zeal - 2 * dt)
    if (rpg.honeyT > 0) {
      rpg.honeyT = Math.max(0, rpg.honeyT - dt)
      if (this.alive) this.heal(4 * dt)
      if (Math.random() < dt * 6)
        w.vfx.add.spawn({
          x: this.pos.x + rand(-0.4, 0.4),
          y: rand(0.4, 1.6),
          z: this.pos.z + rand(-0.4, 0.4),
          vy: 0.6,
          r: 1.6,
          g: 1.0,
          b: 0.3,
          size: 0.05,
          life: 0.8,
          drag: 1,
        })
    }
    if (rpg.kumysT > 0) {
      rpg.kumysT = Math.max(0, rpg.kumysT - dt)
      this.eagleCd = Math.max(0, this.eagleCd - dt * 0.6)
    }
    if (this.alive && this.state !== 'grabbed' && this.state !== 'dead') {
      if (inp.pressed('Digit1')) this.setWeapon('blade')
      else if (inp.pressed('Digit2')) this.setWeapon('bow')
      else if (inp.pressed('PadWeapon')) this.setWeapon(this.weapon === 'bow' ? 'blade' : 'bow')
      if (this.pendingWeapon && this.state === 'move') this.setWeapon(this.pendingWeapon)
      if (inp.pressed('KeyZ')) {
        if (rpg.take('honey')) {
          rpg.honeyT = 10
          w.sound('drink', null, { indicate: false, vol: 0.6 })
          w.toast('Дикий мёд', 'info', 'honey')
        } else w.toast('Нет мёда', 'warn', 'honey')
      }
      if (inp.pressed('KeyC')) {
        if (rpg.take('kumys')) {
          rpg.kumysT = 30
          w.sound('drink', null, { indicate: false, vol: 0.6 })
          w.toast('Кумыс', 'info', 'kumys')
        } else w.toast('Нет кумыса', 'warn', 'kumys')
      }
    }
    if (inp.pressed('KeyX')) {
      if (rpg.arrowType === 'arrow' && rpg.count('arrow_fire') > 0)
        rpg.arrowType = 'arrow_fire'
      else rpg.arrowType = 'arrow'
      w.toast(rpg.arrowType === 'arrow_fire' ? `Огненные стрелы ${rpg.count('arrow_fire')}` : `Стрелы ${rpg.count('arrow')}`, 'info', rpg.arrowType)
    }

    const busy = this.state === 'dead' || this.state === 'grabbed' || this.state === 'finisher' || this.state === 'interact' || this.state === 'pull'
    if (!busy && inp.pressed('Space') && this.state !== 'dodge' && (this.state !== 'hurt' || this.st > 0.12)) this.tryDodge(mx, mz)

    let speed = 0
    /** aim = turn to cursor, move = turn to movement, none = hold */
    let faceMode: 'aim' | 'move' | 'none' = 'aim'
    this.stance = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')
    let clip: Clip | null = null
    let ct = 0
    let shake = 0

    switch (this.state) {
      case 'move': {
        speed = (this.stance || this.slowWalk ? 2.6 : 5.2) * (w.rpg.kumysT > 0 ? 1.08 : 1)
        faceMode = this.stance ? 'aim' : 'move'
        if (inp.pressed('Mouse0')) {
          if (this.weapon === 'bow') this.startDraw()
          else this.startAttack(STRING[this.combo])
        } else if (inp.pressed('KeyQ') && this.lassoCd <= 0) this.startLasso()
        else if (inp.pressed('KeyE') && this.eagleCd <= 0) {
          this.eagleCd = w.rpg.eagleCd
          this.setState('eagle')
        } else if (inp.pressed('KeyR') && this.sips > 0 && this.hp < this.maxHp) {
          this.healPending = true
          this.setState('drink')
        }
        break
      }
      case 'attack':
      case 'slam': {
        const a = this.attack
        const n = this.st / a.dur
        clip = HERO_CLIPS[a.phases[0][0]]
        ct = n
        // Полумесяц turns the whole body a full circle
        this.spin = a.phases[0][0] === 'crescent' ? Math.PI * 2 * smoothstep(0.12, 0.72, n) : 0
        faceMode = n < a.hitStart * 0.8 ? 'aim' : 'none'
        if (a.lunge && n >= (a.lungeStart ?? 0) && n <= (a.lungeEnd ?? 1)) {
          const win = ((a.lungeEnd ?? 1) - (a.lungeStart ?? 0)) * a.dur
          const nearest = this.nearestEnemyAhead(a.range + 0.4)
          // the step in stops once the target is inside the tip's path
          const k = nearest ? Math.min(1, Math.max(0, nearest - (tipReach(this.melee) - 0.15)) / a.range) : 1
          this.move(dt, this.fx * (a.lunge / win) * k, this.fz * (a.lunge / win) * k)
        }
        if (n >= a.hitStart && !this.swung) {
          this.swung = true
          w.sound(a.heavy ? 'swing_heavy' : 'swing', this.pos, { indicate: false })
          w.playerNoise(this.pos, 9)
          const color = this.fires >= 3 || this.heavyFires > 0 ? SLASH_RAGE : this.series >= 2 ? SLASH_AMBER : SLASH_BONE
          // the trail is drawn where the blade actually passes: from its base to the tip
          const band = trailBand(this.melee, a.ext)
          if (a.slash) {
            w.vfx.slashes.spawn(this.pos.x, 1.0 + (a.slash.tilt && Math.abs(a.slash.tilt) > 1 ? 0.3 : 0), this.pos.z, this.facing, { dir: a.slash.dir, tilt: a.slash.tilt, inner: band.inner, outer: band.outer, angle: (a.arc * Math.PI) / 180, color, dur: a.heavy ? 0.28 : 0.2 })
          } else {
            // the point leaves a thin streak along the blade's path
            for (let k = 0; k < 10; k++) {
              const d = band.inner + (k / 9) * (band.outer - band.inner)
              w.vfx.add.spawn({ x: this.pos.x + this.fx * d, y: 1.05, z: this.pos.z + this.fz * d, vx: this.fx * 2, vz: this.fz * 2, r: color.r, g: color.g, b: color.b, a: 0.7, size: 0.05, life: 0.18, drag: 4 })
            }
          }
        }
        if (n >= a.hitStart && n <= a.hitEnd) this.resolveHits(a)
        if (this.state === 'attack') {
          if (inp.pressed('Mouse0')) this.bufferT = 0.45
          if (this.lmbHeld && this.holdT > 0.3 && n >= a.hitEnd) {
            this.chargeT = 0
            this.setState('charge')
            break
          }
          if (n >= a.cancel && this.bufferT > 0) {
            this.startAttack(STRING[(this.combo + 1) % STRING.length])
            break
          }
        }
        if (n >= a.cancel && this.state === 'attack' && inp.pressed('KeyQ')) {
          this.setState('move')
          break
        }
        if (n >= 1) {
          if (this.state === 'attack') this.combo = (this.combo + 1) % STRING.length
          else this.combo = 0
          this.setState('move')
        }
        break
      }
      case 'charge': {
        speed = 1.4
        this.chargeT = Math.min(1, this.chargeT + dt)
        clip = HERO_CLIPS.charge
        ct = Math.min(1, this.chargeT / 0.85)
        shake = ct
        if (Math.random() < dt * 30 * ct) {
          this.model.bladeTip.getWorldPosition(this.v)
          w.vfx.add.spawn({ x: this.v.x + rand(-0.6, 0.6), y: this.v.y + rand(-0.6, 0.6), z: this.v.z + rand(-0.6, 0.6), vx: 0, vy: 0, vz: 0, r: 2.2, g: 1.1, b: 0.4, size: 0.06, life: 0.35, drag: 1 })
        }
        if (!this.lmbHeld) this.startSlam()
        break
      }
      case 'dodge': {
        faceMode = 'none'
        const n = this.st / 0.34
        clip = HERO_CLIPS.dodge
        ct = n
        const sp = n < 0.7 ? 15.5 : 15.5 * (1 - (n - 0.7) / 0.3)
        this.move(dt, this.dodgeDir.x * sp, this.dodgeDir.z * sp)
        if (Math.random() < 0.7) w.vfx.soft.spawn({ x: this.pos.x + rand(-0.2, 0.2), y: 0.9 + rand(-0.4, 0.4), z: this.pos.z + rand(-0.2, 0.2), r: 0.05, g: 0.07, b: 0.12, a: 0.5, size: 0.7, life: 0.4, grow: 1 })
        // Выпад сквозь: a strike out of the dash
        if (n > 0.35 && inp.pressed('Mouse0') && this.weapon === 'blade') {
          this.startAttack('vypad')
          break
        }
        if (n >= 1) {
          this.setState('move')
        }
        break
      }
      case 'hurt': {
        faceMode = 'none'
        clip = HERO_CLIPS.hurt
        ct = this.st / 0.38
        if (this.st > 0.38) this.setState('move')
        break
      }
      case 'drink': {
        speed = 1.4
        faceMode = 'move'
        clip = HERO_CLIPS.drink
        ct = this.st / 0.95
        if (this.healPending && ct > 0.45) {
          this.healPending = false
          this.sips--
          this.heal(w.rpg.waterHeal)
          w.sound('drink', null, { indicate: false })
          for (let i = 0; i < 26; i++) w.vfx.add.spawn({ x: this.pos.x + rand(-0.5, 0.5), y: rand(0.2, 1.8), z: this.pos.z + rand(-0.5, 0.5), vy: rand(0.5, 1.6), r: 0.4, g: 2.0, b: 1.7, size: 0.06, life: 0.9, drag: 1 })
        }
        if (ct >= 1) this.setState('move')
        break
      }
      case 'lasso': {
        clip = HERO_CLIPS.lasso
        ct = Math.min(1, this.st / 0.5)
        if (!this.lasso.thrown && this.st > 0.17) this.throwLasso()
        if (this.st > 0.5 && this.lasso.phase === 'none') this.setState('move')
        if (this.st > 1.6) this.setState('move')
        break
      }
      case 'pull': {
        faceMode = 'none'
        clip = HERO_CLIPS.pull
        ct = Math.min(1, this.st / 0.3)
        const t = this.lasso.target
        if (!t || !t.alive || this.st > 0.6) {
          this.lasso.phase = 'back'
          this.setState('move')
          break
        }
        const dx = t.pos.x - this.pos.x
        const dz = t.pos.z - this.pos.z
        const d = Math.hypot(dx, dz)
        this.facing = Math.atan2(dx, dz)
        if (d < t.radius + 1.4) {
          this.lasso.phase = 'back'
          this.lasso.target = null
          this.setState('move')
          break
        }
        this.iframes = Math.max(this.iframes, 0.1)
        this.move(dt, (dx / d) * 17, (dz / d) * 17)
        break
      }
      case 'bow': {
        speed = 2.2
        this.bowDraw = Math.min(1, this.bowDraw + dt / w.rpg.bowDrawTime)
        clip = HERO_CLIPS.bow
        ct = this.bowDraw
        if (inp.pressed('Mouse2')) {
          // lower the bow without shooting
          this.bowDraw = 0
          this.setState('move')
        } else if (!inp.isDown('Mouse0')) {
          this.fireArrow()
          this.setState('move')
        }
        break
      }
      case 'eagle': {
        clip = HERO_CLIPS.eagle
        ct = this.st / 0.55
        if (this.st > 0.22 && this.st - dt <= 0.22) w.releaseEagle()
        if (ct >= 1) this.setState('move')
        break
      }
      case 'interact': {
        faceMode = 'none'
        clip = HERO_CLIPS.interact
        ct = this.st / 0.9
        if (!this.interactDone && ct > 0.4) {
          this.interactDone = true
          this.interactCb?.()
        }
        if (ct >= 1) this.setState('move')
        break
      }
      case 'grabbed': {
        faceMode = 'none'
        clip = HERO_CLIPS.grabbed
        ct = 0.5 + 0.5 * Math.sin(this.st * 9)
        shake = 1
        if (inp.pressed('Mouse0') || inp.pressed('Space')) this.grabProgress = Math.min(1, this.grabProgress + 0.13)
        this.grabProgress = Math.max(0, this.grabProgress - dt * 0.12)
        break
      }
      case 'finisher': {
        faceMode = 'none'
        clip = HERO_CLIPS.finisher
        ct = this.st / 1.0
        const t = this.finisherTarget
        if (t && !this.finisherDone && ct > 0.6) {
          this.finisherDone = true
          t.finisherHit(this)
          w.sound('hit_heavy', t.pos, { indicate: false })
          w.hitstop(0.14)
          w.shake(0.8)
          w.slowmo(0.45, 0.35)
          w.vfx.rings.spawn(t.pos.x, t.pos.z, { from: 0.3, to: 5, dur: 0.6, color: new THREE.Color(1.6, 0.8, 0.3), width: 0.06 })
          w.vfx.hit(t.pos.x, 1.0, t.pos.z, this.fx, this.fz, true)
        }
        if (ct >= 1) this.setState('move')
        break
      }
      case 'dead': {
        faceMode = 'none'
        clip = HERO_CLIPS.death
        ct = Math.min(1, this.st / 1.3)
        break
      }
    }

    // ---- facing: the body follows the legs, the head follows the cursor
    let speedScale = 1
    if (faceMode === 'aim') {
      this.facing = dampAngle(this.facing, this.aimAngle, 16, dt)
      this.idleTurning = false
    } else if (faceMode === 'move') {
      if (ml > 0.05) {
        const target = Math.atan2(mx, mz)
        const diff = Math.abs(wrapAngle(target - this.facing))
        this.facing = dampAngle(this.facing, target, 11, dt)
        // a sharp reversal brakes first and turns, instead of moonwalking
        speedScale = 0.35 + 0.65 * Math.max(0, Math.cos(diff))
        this.idleTurning = false
      } else {
        // standing still: turn the whole body only when the cursor leaves the neck's reach
        const d = Math.abs(wrapAngle(this.aimAngle - this.facing))
        if (d > 1.15) this.idleTurning = true
        if (this.idleTurning) {
          this.facing = dampAngle(this.facing, this.aimAngle, 6, dt)
          if (d < 0.12) this.idleTurning = false
        }
      }
    }
    const busyGaze = this.state === 'dead' || this.state === 'grabbed' || this.state === 'dodge'
    const off = busyGaze ? 0 : clamp(wrapAngle(this.aimAngle - this.facing), -1.2, 1.2)
    this.gazeOff = damp(this.gazeOff, off, 9, dt)
    this.gaze = this.facing + this.gazeOff
    if (speed > 0) {
      this.move(dt, mx * speed * speedScale, mz * speed * speedScale)
      this.speedNow = ml > 0 ? speed * Math.min(1, ml) * speedScale : this.idleTurning ? 0.9 : 0
    } else if (this.state !== 'dodge' && this.state !== 'pull' && this.state !== 'attack' && this.state !== 'slam') {
      this.move(dt, 0, 0)
      this.speedNow = 0
    } else this.speedNow = 0

    const wading = w.field.isWater(this.pos.x, this.pos.z)
    if (wading) this.speedNow *= WADE
    if (this.speedNow > 0.5) {
      this.stepAcc += this.speedNow * dt
      if (this.stepAcc > 1.45) {
        this.stepAcc = 0
        if (wading) {
          // every step in the stream is a splash the whole ravine hears
          w.sound('splash', this.pos, { indicate: false, vol: 0.45 })
          w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.15, to: 1.3, dur: 0.9, color: new THREE.Color(0.35, 0.45, 0.6), width: 0.03 })
          w.playerNoise(this.pos, 7)
        } else {
          w.sound('step_light', this.pos, { indicate: false, vol: 0.18 })
          if (this.speedNow > 4) w.vfx.dust(this.pos.x - this.fx * 0.2, this.pos.z - this.fz * 0.2, 3, 0.35, new THREE.Color(0.16, 0.14, 0.12))
          // a careful step (stance) carries less far than a run
          w.playerNoise(this.pos, (this.torchOn ? 4.5 : 2.5) * (this.speedNow > 3.5 ? 1 : 0.55))
        }
      }
    }

    // breath vapour in the cold night air (faster when running or hurt)
    this.breathT -= dt * (this.speedNow > 3 || this.hp < this.maxHp * 0.35 ? 1.8 : 1)
    if (this.breathT <= 0 && this.alive) {
      this.breathT = 2.6 + Math.random() * 0.8
      const head = this.rig.joints.head.getWorldPosition(this.v)
      for (let i = 0; i < 4; i++)
        w.vfx.soft.spawn({ x: head.x + this.fx * 0.18, y: head.y + 0.08, z: head.z + this.fz * 0.18, vx: this.fx * (0.4 + Math.random() * 0.3), vy: 0.12, vz: this.fz * (0.4 + Math.random() * 0.3), r: 0.5, g: 0.55, b: 0.62, a: 0.12, size: 0.14 + i * 0.05, life: 1.4, drag: 1.2, grow: 2.2 })
    }

    this.updateLasso(dt)
    // the wrist turns the blade into line with the forearm for Укол and Выпад
    const thrusting = this.state === 'attack' && this.attack.phases[0][0] === 'thrust' && this.st / this.attack.dur > 0.25 && this.st / this.attack.dur < 0.85
    this.model.sword.rotation.x = damp(this.model.sword.rotation.x, thrusting ? -0.12 : -1.25, 22, dt)
    // the finisher is always done with the blade
    const blade = this.weapon === 'blade' || this.state === 'finisher'
    this.model.sword.visible = blade
    this.model.bowHand.visible = !blade
    this.model.bowBack.visible = blade
    this.updateAimLine()

    const mlen = Math.hypot(mx, mz) || 1
    const fwd = ml > 0.05 ? (mx * this.fx + mz * this.fz) / mlen : 1
    const side = ml > 0.05 ? (mx * Math.cos(this.facing) - mz * Math.sin(this.facing)) / mlen : 0
    const st = this.state
    const snap =
      st === 'attack' || st === 'slam' ? 2.3 : st === 'dodge' ? 2.4 : st === 'hurt' ? 2.8 : st === 'finisher' ? 2.0 : st === 'lasso' || st === 'pull' ? 2.0 : st === 'dead' ? 0.9 : st === 'charge' ? 1.4 : 1.15
    this.rig.update(dt, { speed: this.speedNow, forward: fwd, side, look: this.gazeOff, clip, t: ct, time: w.time, shake, snap })
    this.lastDt = dt
    this.syncRig()
    // the body keeps its guard for a while after a fight action, and whenever an awake enemy is close
    const st2 = this.state
    if (st2 === 'attack' || st2 === 'charge' || st2 === 'slam' || st2 === 'bow' || st2 === 'hurt' || st2 === 'dodge' || this.stance) this.combatT = 4
    else this.combatT = Math.max(0, this.combatT - dt)
    const threat = this.w.enemies.some((e) => e.alive && e.aggro && !e.hidden && Math.abs(e.pos.x - this.pos.x) < 14 && Math.abs(e.pos.z - this.pos.z) < 14)
    this.anim?.update(dt, {
      state: this.state,
      speed: this.speedNow,
      stance: this.stance,
      forward: fwd,
      combat: this.combatT > 0 || threat,
      weapon: this.weapon,
      side,
      block: this.blocking,
      action: this.attackName,
      n: this.st / this.attack.dur,
      hit: [this.attack.hitStart, this.attack.hitEnd],
      charge: clamp(this.chargeT / 0.85, 0, 1),
      draw: this.bowDraw,
      shots: this.arrowsShot,
      st: this.st,
    })
    this.updateLantern(dt)
  }

  private nearestEnemyAhead(range: number) {
    let best: number | null = null
    for (const e of this.w.enemies) {
      if (!e.alive || e.hidden) continue
      if (!inArc(this.pos.x, this.pos.z, this.facing, e.pos.x, e.pos.z, range, 70, e.radius)) continue
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) - e.radius
      if (best === null || d < best) best = d
    }
    return best
  }

  private resolveHits(a: PAttack) {
    const w = this.w
    const rpg = w.rpg
    const name = this.attackName
    let any = false
    // the series: every blow landed in a row adds 8%, the finale carries the whole bonus
    const mult = rpg.meleeMult * (1 + 0.08 * Math.min(4, this.series)) * (this.counterNow ? 2 : 1)
    for (const e of w.enemies) {
      if (!e.alive || this.hitSet.has(e) || e.hidden) continue
      if (Math.abs(e.airY) > 2) continue
      if (!inArc(this.pos.x, this.pos.z, this.facing, e.pos.x, e.pos.z, a.range, a.arc, e.radius)) continue
      this.hitSet.add(e)
      let m = mult
      // Выпад into the back
      if (name === 'vypad' && Math.sin(e.facing) * this.fx + Math.cos(e.facing) * this.fz > 0.3) m *= 1.3
      const r = e.takeHit(a.dmg * m, ((a.posture ?? 0) + (this.counterNow ? 25 : 0)) * rpg.postureMult, this.pos.x, this.pos.z, a.knock, !!a.heavy, 'melee')
      if (!r) continue
      any = true
      w.vfx.hit(e.pos.x, 1.0 + e.hitHeight, e.pos.z, this.fx, this.fz, !!a.heavy || this.counterNow, e.bloodColor)
    }
    if (any && !this.landed) this.onLanded(name, !!a.heavy)
    if (a.heavy && !this.impactDone) {
      this.impactDone = true
      const ix = this.pos.x + this.fx * 1.6
      const iz = this.pos.z + this.fz * 1.6
      w.vfx.dust(ix, iz, 14, 1.2)
      w.vfx.rings.spawn(ix, iz, { from: 0.3, to: 3.2, dur: 0.45, color: new THREE.Color(0.9, 0.6, 0.35), width: 0.08 })
      const f = this.heavyFires
      if (f >= 3 || (f >= 2 && rpg.has('hide'))) this.eagleStrike()
      else if (f === 2) {
        this.wave(this.facing - 0.32)
        this.wave(this.facing + 0.32)
      } else if (f === 1 || this.heavyFull) this.wave(this.facing)
    }
  }

  /** first landed hit of a blow: series, zeal, the note, the weight */
  private onLanded(name: string, heavy: boolean) {
    const w = this.w
    const rpg = w.rpg
    this.landed = true
    this.lastLandT = w.time
    this.series = Math.min(6, this.series + 1)
    this.seriesT = rpg.has('pack') ? 1.5 : 0.8
    const finale = name === 'polu'
    let z = 1 + (finale ? 3 : 0)
    if (this.counterNow) z += 5 + (rpg.wearing('fang') ? 10 : 0)
    if (w.time - this.lastTool.t < 1.5) {
      z += 2
      this.lastTool.t = -10
    }
    if (name === 'vypad' && rpg.has('leap')) z += 10
    // the fires heavy blows spend are not refunded by their own hit
    if (!heavy) this.addZeal(z)
    if (finale && this.fires >= 3 && rpg.has('blood')) this.heal(8)
    // each blow in a row rises a step up the kurai pentatonic; the finale lands on the drum
    w.audio.note(Math.min(7, this.series - 1), finale || heavy)
    if (this.counterNow) {
      w.slowmo(0.3, 0.35)
      w.sound('clang', this.pos, { indicate: false })
      w.shake(0.45)
    }
    w.sound(heavy ? 'hit_heavy' : 'hit', this.pos, { indicate: false })
    w.hitstop(heavy ? 0.1 : finale ? 0.11 : 0.04 + 0.015 * Math.min(3, this.series))
    w.shake(heavy || finale ? 0.35 : 0.12 + 0.03 * this.series)
  }

  /** a cutting wave along the ground (charged or fire-fed Рассечение) */
  private wave(angle: number) {
    const w = this.w
    const dx = Math.sin(angle)
    const dz = Math.cos(angle)
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || this.hitSet.has(e)) continue
      const ex = e.pos.x - this.pos.x
      const ez = e.pos.z - this.pos.z
      const along = ex * dx + ez * dz
      const lat = Math.abs(ex * dz - ez * dx)
      if (along < 0.5 || along > 5.2 || lat > 0.9 + e.radius) continue
      if (e.takeHit(18 * w.rpg.meleeMult, 20 * w.rpg.postureMult, this.pos.x, this.pos.z, 4, false, 'melee')) w.vfx.hit(e.pos.x, 1.0 + e.hitHeight, e.pos.z, dx, dz, true, e.bloodColor)
    }
    for (let k = 1; k <= 8; k++) {
      const x = this.pos.x + dx * k * 0.62
      const z = this.pos.z + dz * k * 0.62
      if (w.field.clearance(x, z) < -0.2) break
      w.vfx.dust(x, z, 3, 0.35, new THREE.Color(0.5, 0.32, 0.16))
      for (let i = 0; i < 3; i++) w.vfx.add.spawn({ x: x + rand(-0.2, 0.2), y: rand(0.1, 0.9), z: z + rand(-0.2, 0.2), vy: rand(0.5, 2), r: 1.8, g: 0.75, b: 0.25, size: rand(0.04, 0.08), life: rand(0.3, 0.6), drag: 2 })
    }
    w.vfx.slashes.spawn(this.pos.x + dx * 2.4, 0.5, this.pos.z + dz * 2.4, angle, { dir: 1, tilt: 1.45, scale: 1.7, color: SLASH_RAGE, dur: 0.32 })
  }

  /** three fires: Kara stoops together with Timer — everything around is struck and stunned */
  private eagleStrike() {
    const w = this.w
    const R = 4.4
    w.releaseEagle()
    w.sound('eagle', this.pos, { indicate: false })
    w.slowmo(0.45, 0.3)
    w.shake(0.9)
    w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.5, to: R + 0.6, dur: 0.6, color: new THREE.Color(1.8, 0.9, 0.35), width: 0.12 })
    w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.2, to: R * 0.6, dur: 0.45, color: new THREE.Color(1.2, 1.1, 0.9), width: 0.05 })
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2)
      w.vfx.soft.spawn({ x: this.pos.x + Math.cos(a) * 0.6, y: rand(0.3, 2.4), z: this.pos.z + Math.sin(a) * 0.6, vx: Math.cos(a) * rand(3, 7), vy: rand(0, 2), vz: Math.sin(a) * rand(3, 7), r: 0.32, g: 0.22, b: 0.12, a: 0.9, size: rand(0.08, 0.14), life: rand(0.8, 1.4), drag: 2, gravity: 1.5 })
    }
    for (const e of w.enemies) {
      if (!e.alive || e.hidden) continue
      if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) > R + e.radius) continue
      if (e.takeHit(40 * w.rpg.meleeMult, 60 * w.rpg.postureMult, this.pos.x, this.pos.z, 7, true, 'melee')) {
        e.stun(e.kind === 'boss' ? 0.8 : 2)
        w.vfx.hit(e.pos.x, 1.0 + e.hitHeight, e.pos.z, e.pos.x - this.pos.x, e.pos.z - this.pos.z, true, e.bloodColor)
      }
    }
  }

  // ------------------------------------------------------------------ lasso

  private startLasso() {
    this.lassoCd = 5
    this.lasso.thrown = false
    this.lasso.target = null
    this.facing = this.aimAngle
    this.setState('lasso')
  }

  private throwLasso() {
    this.lasso.thrown = true
    this.lasso.phase = 'out'
    this.lasso.len = 0
    this.lasso.dir.set(Math.sin(this.aimAngle), 0, Math.cos(this.aimAngle))
    this.w.sound('lasso', null, { indicate: false })
  }

  private updateLasso(dt: number) {
    const L = this.lasso
    const w = this.w
    if (L.phase === 'none') {
      this.rope.visible = this.loop.visible = false
      return
    }
    // the Mixamo throw casts with the right hand
    const hand = this.handWorld(this.anim?.has('throw') ? 'R' : 'L', this.v)
    const ox = this.pos.x
    const oz = this.pos.z
    let tip = new THREE.Vector3()
    if (L.phase === 'out') {
      L.len += 34 * dt
      const wall = w.field.ray(ox, oz, L.dir.x, L.dir.z, L.len, 0)
      if (wall < L.len - 0.01) {
        L.len = wall
        L.phase = 'back'
      }
      for (const e of w.enemies) {
        if (!e.alive || e.hidden || e.airY > 1.5) continue
        const ex = e.pos.x - ox
        const ez = e.pos.z - oz
        const along = ex * L.dir.x + ez * L.dir.z
        if (along < 0 || along > L.len) continue
        const perp = Math.abs(ex * L.dir.z - ez * L.dir.x)
        if (perp < e.radius + 0.45) {
          L.target = e
          L.phase = 'hold'
          L.t = 0
          e.lassoed(this)
          this.noteTool('lasso')
          if (w.rpg.wearing('shurale_finger') && e.alive) {
            // the finger tickles: the bound enemy laughs itself off balance
            e.addPosture(25)
            w.sound('giggle', e.pos, { indicate: false, vol: 0.5 })
          }
          w.sound('hit', e.pos, { indicate: false, vol: 0.5 })
          if (e.weight === 'heavy') this.setState('pull')
          break
        }
      }
      if (L.len >= 10.5) L.phase = 'back'
      tip.set(ox + L.dir.x * L.len, 1.0, oz + L.dir.z * L.len)
    } else if (L.phase === 'hold') {
      L.t += dt
      const t = L.target
      if (!t || !t.alive || L.t > 0.7) {
        L.phase = 'back'
        L.len = t ? Math.hypot(t.pos.x - ox, t.pos.z - oz) : L.len
        tip.set(ox + L.dir.x * L.len, 1, oz + L.dir.z * L.len)
      } else {
        tip.set(t.pos.x, 1.0 + t.hitHeight * 0.5, t.pos.z)
        L.len = Math.hypot(t.pos.x - ox, t.pos.z - oz)
        L.dir.set(t.pos.x - ox, 0, t.pos.z - oz).normalize()
      }
    } else {
      L.len -= 30 * dt
      if (L.len <= 0.3) {
        L.phase = 'none'
        this.rope.visible = this.loop.visible = false
        return
      }
      tip.set(ox + L.dir.x * L.len, 1.0, oz + L.dir.z * L.len)
    }
    const d = tip.clone().sub(hand)
    const len = d.length()
    this.rope.visible = this.loop.visible = true
    this.rope.position.copy(hand)
    this.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
    this.rope.scale.set(1, len, 1)
    this.loop.position.copy(tip)
    this.loop.rotation.set(Math.PI / 2, 0, w.time * 12)
  }

  // ------------------------------------------------------------------ bow

  /** Where the arrow will fly: as long as its flight at this draw, cut short by trees and walls. */
  private updateAimLine() {
    const l = this.aimLine
    const mat = l.material as THREE.MeshBasicMaterial
    if (this.state !== 'bow' || !this.alive) {
      l.visible = false
      return
    }
    const dx = Math.sin(this.aimAngle)
    const dz = Math.cos(this.aimAngle)
    const reach = (26 + Math.max(0.2, this.bowDraw) * 20) * 0.9
    const d = Math.max(1, this.w.field.ray(this.pos.x, this.pos.z, dx, dz, reach, 0.3) - 0.6)
    l.visible = true
    l.position.set(this.pos.x + dx * 0.6, 0, this.pos.z + dz * 0.6)
    l.rotation.y = this.aimAngle
    l.scale.set(0.6 + this.bowDraw * 0.8, 1, d)
    mat.opacity = 0.12 + 0.4 * this.bowDraw
  }

  private fireArrow() {
    const rpg = this.w.rpg
    let fire = rpg.arrowType === 'arrow_fire' && rpg.count('arrow_fire') > 0
    if (!fire && rpg.count('arrow') <= 0) fire = rpg.count('arrow_fire') > 0
    if (!rpg.take(fire ? 'arrow_fire' : 'arrow')) return
    if (fire && rpg.count('arrow_fire') === 0) rpg.arrowType = 'arrow'
    this.arrowsShot++
    const p = Math.max(0.2, this.bowDraw)
    const dir = new THREE.Vector3(Math.sin(this.aimAngle), 0, Math.cos(this.aimAngle))
    this.w.projectiles.spawnArrow(new THREE.Vector3(this.pos.x + dir.x * 0.6, 1.35, this.pos.z + dir.z * 0.6), dir, p,
      fire,
      rpg.arrowMult,
    )
    this.w.sound('arrow', null, { indicate: false })
    this.w.playerNoise(this.pos, 5)
  }

  // ------------------------------------------------------------------ lantern

  private updateLantern(dt: number) {
    const l = this.w.lighting.lantern
    const rpg = this.w.rpg
    if (this.torchOn && this.torchDoused <= 0 && this.alive) {
      rpg.oil = Math.max(0, rpg.oil - rpg.oilDrain * dt)
      if (rpg.oil <= 0) {
        this.torchOn = false
        this.w.sound('douse', this.pos, { indicate: false, vol: 0.5 })
        this.w.toast('Масло кончилось', 'warn', 'lantern')
      }
    }
    const on = this.torchOn && this.torchDoused <= 0 && this.alive
    // follow the swinging glass; lift the light a little so the ground beside it does not blow out
    this.model.lanternGlow.getWorldPosition(this.v)
    l.position.set(this.v.x, this.v.y + 0.6, this.v.z)
    const t = this.w.time
    const flick = 0.86 + 0.08 * Math.sin(t * 11) * Math.sin(t * 7.3 + 1) + 0.06 * Math.sin(t * 23)
    // running dry: the flame shrinks and gutters
    const low = rpg.oil < 0.15 ? 0.45 + (rpg.oil / 0.15) * 0.55 : 1
    const gutter =
      rpg.oil < 0.15 ? 0.75 + 0.25 * Math.sin(t * 31) * Math.sin(t * 17) : 1
    const target = on ? 7 * flick * low * gutter : 0
    l.intensity += (target - l.intensity) * (1 - Math.exp(-14 * dt))
    this.model.lanternFlame.visible = on
    const g = this.model.lanternGlow.material as THREE.MeshBasicMaterial
    g.color.setRGB(on ? 3 * flick : 0.15, on ? 1.6 * flick : 0.07, on ? 0.6 : 0.03)
  }
}
