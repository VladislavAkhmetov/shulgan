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

/** the stance (docs/COMBAT.md §1): 1 — kylys + kalkan, 2 — the bow in both hands */
export type Weapon = 'blade' | 'bow'

export type PState =
  | 'move'
  | 'attack'
  | 'charge'
  | 'slam'
  | 'bash'
  | 'dodge'
  | 'hurt'
  | 'bow'
  | 'eagle'
  | 'flash'
  | 'breath'
  | 'interact'
  | 'grabbed'
  | 'finisher'
  | 'dead'

/** ext: how far past the weapon's tip the blow carries; reach: a fixed range (the shield's rim) instead of the blade's */
type PAttack = AttackDef & { cancel: number; ext: number; reach?: number }
type PAttackDef = Omit<PAttack, 'range'>

// the blade's trail warms with the series; the counter flashes bronze like the boss of the shield
const SLASH_BONE = new THREE.Color(0.62, 0.6, 0.55)
const SLASH_AMBER = new THREE.Color(1.1, 0.68, 0.3)
const SLASH_RAGE = new THREE.Color(1.6, 0.55, 0.18)
const SLASH_COUNTER = new THREE.Color(1.8, 1.25, 0.55)

// docs/COMBAT.md «Стойка 1»; numbers: docs/ROADMAP.md «Решения реализации». Range comes from the weapon (rpg/weapons.ts)
const ATK: Record<string, PAttackDef> = {
  // the series: three cuts on a horizontal arc, 1.0× → 1.1× → 1.35×
  kos: { dur: 0.34, hitStart: 0.34, hitEnd: 0.56, ext: 0, arc: 150, dmg: 10, posture: 6, knock: 2.5, lunge: 0.7, lungeStart: 0.25, lungeEnd: 0.5, phases: [['atk1', 0, 1]], cancel: 0.58, slash: { dir: -1, tilt: 0.35 } },
  obr: { dur: 0.34, hitStart: 0.34, hitEnd: 0.56, ext: 0, arc: 150, dmg: 11, posture: 6, knock: 2.5, lunge: 0.7, lungeStart: 0.25, lungeEnd: 0.5, phases: [['atk2', 0, 1]], cancel: 0.58, slash: { dir: 1, tilt: -0.3 } },
  polu: { dur: 0.55, hitStart: 0.28, hitEnd: 0.66, ext: 0.15, arc: 360, dmg: 13.5, posture: 12, knock: 5.5, lunge: 0.5, lungeStart: 0.2, lungeEnd: 0.5, phases: [['crescent', 0, 1]], cancel: 0.74, slash: { dir: 1, tilt: 0.04 } },
  // Ответное рассечение: after a parry (or a perfect dodge), 2.2×, sets off the companions' marks
  counter: { dur: 0.4, hitStart: 0.3, hitEnd: 0.55, ext: 0.15, arc: 170, dmg: 22, posture: 30, knock: 5, lunge: 0.9, lungeStart: 0.2, lungeEnd: 0.45, phases: [['atk2', 0, 1]], cancel: 0.62, slash: { dir: 1, tilt: -0.25, color: SLASH_COUNTER } },
  // a thrust out of the roll
  vypad: { dur: 0.4, hitStart: 0.4, hitEnd: 0.62, ext: 0.5, arc: 70, dmg: 14, posture: 8, knock: 4, lunge: 2.4, lungeStart: 0.25, lungeEnd: 0.6, phases: [['thrust', 0, 1]], cancel: 0.66 },
  // the heavy lunge (held LMB); the charge changes it (startSlam)
  slam: { dur: 0.62, hitStart: 0.2, hitEnd: 0.34, ext: 0.1, arc: 120, dmg: 22, posture: 26, knock: 7, heavy: true, lunge: 1.1, lungeStart: 0.05, lungeEnd: 0.22, phases: [['slam', 0, 1]], cancel: 0.7, slash: { dir: 1, tilt: 1.45 } },
  // Удар щитом / Пролом: the kalkan's rim rams forward, 1.2×, throws back and sets off marks
  bash: { dur: 0.42, hitStart: 0.3, hitEnd: 0.5, ext: 0, reach: 1.8, arc: 110, dmg: 12, posture: 22, knock: 8, lunge: 0.9, lungeStart: 0.2, lungeEnd: 0.45, phases: [['thrust', 0, 1]], cancel: 0.7 },
}
const STRING = ['kos', 'obr', 'polu']
/** blows that set off the companions' marks (docs/COMBAT.md) */
const DETONATE = new Set(['counter', 'bash'])
/** the window to press [ПКМ] before a blow lands for a parry */
const PARRY_WINDOW = 0.2
/** after the draw peaks, the window for a piercing shot */
const PEAK_WINDOW = 0.3
const FLASH_CD = 2.5
/** holding [F] longer than this is the heat focus, not a flash */
const FOCUS_HOLD = 0.22
const BREATH_COST = 50
const BREATH_HEAL = 35
const BREATH_DUR = 0.8
const FIRE_ARROW_COST = 35

export class Player extends Actor {
  rig: HeroModel['rig']
  model: HeroModel
  state: PState = 'move'
  st = 0
  aimPoint = new THREE.Vector3()
  aimAngle = 0
  /** Where Aldar actually looks: body facing + a neck-limited turn toward the cursor. Drives vision. */
  gaze = 0
  gazeOff = 0
  /** squared to the cursor: guarding or drawing */
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
  eagleCd = 0
  readonly eagleCdMax = 8
  bowDraw = 0
  /** when the draw reached its peak (−1 = not yet) */
  private bowFullAt = -1
  /** the next arrow is lit at the vessel's slot */
  fireNocked = false
  /** arrows loosed, ever (the body plays the recoil on each) */
  arrowsShot = 0
  /** ever: parries, blows taken on the shield, shield bashes, breaths caught (the onboarding counts them) */
  parries = 0
  blocks = 0
  bashes = 0
  breaths = 0
  /** what is in Aldar's hands: [1] the kylys and kalkan, [2] the bow (docs/COMBAT.md §1) */
  weapon: Weapon = 'blade'
  /** the blade in hand: its length sets the reach and the slash trail of every blow */
  melee: MeleeWeapon = WEAPONS.kylys
  /** seconds left in the combat stance after the last blow, dodge or hit */
  combatT = 0
  /** a switch asked for mid-swing, applied when he is free */
  private pendingWeapon: Weapon | null = null
  /** a flat amber line on the ground while the bow is drawn: where the arrow will go */
  private aimLine: THREE.Mesh
  checkpoint = new THREE.Vector3()
  grabProgress = 0
  finisherTarget: Enemy | null = null
  finisherDone = false
  interactCb: (() => void) | null = null
  interactDone = false
  private stepAcc = 0
  /** blows landed in a row (the notes climb with it) */
  series = 0
  private seriesT = 0
  private lastLandT = -10
  /** [ПКМ] held with the kylys: the kalkan is up */
  private guardHeld = false
  /** when [ПКМ] went down: a blow landing within PARRY_WINDOW after it is parried */
  private guardPressT = -10
  private parryUsed = true
  /** Ответное рассечение is open until this time (after a parry or a perfect dodge) */
  private counterUntil = -10
  private spin = 0
  /** Mixamo body, when loaded */
  anim: HeroAnimator | null = null
  /** the heat focus slows the step (Aldar reads the ground) */
  slowWalk = false
  /** 0..1: flood water to the waist or a field of ice drags the step (chapter 2–3 bosses); set by them every frame */
  mire = 0
  private attackName = 'kos'
  private landed = false
  private heavyFull = false
  private breathT = 1.5
  /** current ground speed (the companion paces herself by it) */
  speedNow = 0
  readonly moveDir = new THREE.Vector3()
  private v = new THREE.Vector3()
  // the belt vessel (docs/COMBAT.md «Поясной сосуд с углём»)
  private fDown = false
  private fHeldT = 0
  /** [F] held: the heat focus, a narrow cone of light ahead */
  focus = false
  flashCd = 0
  /** the slots are stuffed with swamp mud (Shurale's tickle): no light until it is shaken out */
  clogT = 0
  /** held by Shurale's roots: no step */
  rootedT = 0
  /** «Перевести дух» progress, 0..1 */
  get breath() {
    return this.state === 'breath' ? clamp(this.st / BREATH_DUR, 0, 1) : 0
  }

  constructor(w: World) {
    super(w)
    this.model = createHero(w.vfx)
    this.rig = this.model.rig
    w.scene.add(this.rig.root)
    this.radius = 0.42
    this.hp = this.maxHp = 100
    const aimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.85, 0.3), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    this.aimLine = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 1).rotateX(-Math.PI / 2).translate(0, 0.06, 0.5), aimMat)
    this.aimLine.visible = false
    this.aimLine.frustumCulled = false
    this.aimLine.renderOrder = 3
    w.scene.add(this.aimLine)
  }

  /** the coal burns in the vessel and nothing has stuffed its slots */
  get lightOn() {
    return this.w.kit.ember && !this.w.kit.vesselGiven && this.clogT <= 0 && this.alive
  }
  /** chapter 3 without the vessel: [F] held — the blood senses the way to the spring */
  bloodSense = false
  /** the grave cold of Shulgan-Tash turns the coals blue (TRG_CH3_AZAMAT_COLLAPSE); null — the home amber */
  vesselTint: THREE.Color | null = null

  /** [ПКМ] with the kylys and the kalkan, standing or stepping */
  get guard() {
    return this.guardHeld && this.state === 'move'
  }

  /** the draw is at its peak: a shot now pierces */
  get bowPeak() {
    return this.state === 'bow' && this.bowFullAt >= 0 && this.w.time - this.bowFullAt <= PEAK_WINDOW
  }

  /** Take the kylys or the bow. Mid-swing the switch waits until the blow is done. */
  setWeapon(wp: Weapon) {
    if (!this.alive) return
    if (wp === 'bow' && !this.w.kit.bow) {
      this.w.toast('Азамат впопыхах унёс лук с собой', 'warn', 'bow')
      return
    }
    if (this.state !== 'move' && this.state !== 'bow') {
      this.pendingWeapon = wp
      return
    }
    this.pendingWeapon = null
    if (this.state === 'bow') this.setState('move')
    if (this.weapon === wp) return
    this.weapon = wp
    this.bowDraw = 0
    this.focus = false
    this.w.sound('swing', this.pos, { indicate: false, vol: 0.25 })
    this.w.toast(wp === 'bow' ? 'Лук йәйә' : 'Кылыс и калкан', 'info', wp === 'bow' ? 'bow' : 'kylys')
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
    this.alive = true
    this.airY = 0
    this.iframes = 1.5
    this.clogT = 0
    this.rootedT = 0
    this.fireNocked = false
    this.focus = false
    this.w.kit.fervor = Math.max(this.w.kit.fervor, 40)
    this.visYaw = this.facing
    this.setState('move')
  }

  /** Shurale's tickle stuffs the vessel's slots with swamp mud (docs/COMBAT.md) */
  clog(sec: number) {
    if (!this.w.kit.ember) return
    this.clogT = Math.max(this.clogT, sec)
    this.w.sound('douse', this.pos, { indicate: false, vol: 0.6 })
  }

  /** Logic turns instantly (attacks hit where you aim); the visible body turns smoothly. */
  syncRig() {
    this.visYaw = dampAngle(this.visYaw, this.facing, 20, this.lastDt)
    this.rig.root.position.set(this.pos.x, this.airY, this.pos.z)
    // the Mixamo spin attack turns the body itself
    const clipSpins = this.anim?.has('atk_polu')
    this.rig.root.rotation.y = this.visYaw + (this.state === 'attack' && !clipSpins ? this.spin : 0)
  }

  // ------------------------------------------------------------------ damage

  takeHit(h: HitInfo): HitResult {
    if (!this.alive) return 'immune'
    if (this.state === 'finisher' || this.state === 'grabbed') return 'immune'
    if (this.iframes > 0) return this.w.time - this.dodgeStart < 0.22 ? 'perfect' : 'iframe'
    const w = this.w
    const kit = w.kit
    const frontal = Math.abs(wrapAngle(Math.atan2(h.x - this.pos.x, h.z - this.pos.z) - this.facing)) < 1.4
    // the kalkan: a red-flash blow and a grab go through it (docs/COMBAT.md «Стойка 1»)
    if (this.guard && frontal && !h.grab && !h.unblockable) {
      this.combatT = 4
      if (!this.parryUsed && w.time - this.guardPressT <= PARRY_WINDOW) {
        this.parryUsed = true
        this.parries++
        this.onParry(h)
        return 'parry'
      }
      // the shield takes all of the blow; Запал pays for it
      const k = h.heavy ? 1.6 : 1
      const cost = h.dmg * k
      this.model.shieldBoss.getWorldPosition(this.v)
      this.blocks++
      if (kit.fervor >= cost) {
        kit.fervor -= cost
        w.sound('clang', this.pos, { indicate: false, vol: 0.7 })
        w.shake(0.12)
        w.vfx.hit(this.v.x, this.v.y, this.v.z, h.x - this.pos.x, h.z - this.pos.z, false, new THREE.Color(1.6, 0.9, 0.4))
        this.knock(h.x, h.z, h.knock * 0.3)
        return 'blocked'
      }
      // the guard breaks: what Запал could not pay goes through, and he staggers
      const through = (cost - kit.fervor) / k
      kit.fervor = 0
      w.sound('clang', this.pos, { indicate: false, vol: 1 })
      w.toast('Щит пробит', 'warn', 'kalkan')
      this.hp -= through
      this.rig.hitFlash()
      w.damagePulse(0.6)
      w.shake(0.4)
      this.knock(h.x, h.z, h.knock)
      if (this.hp <= 0) return this.die()
      this.setState('hurt')
      return 'hit'
    }
    this.hp -= h.dmg
    this.rig.hitFlash()
    w.sound('hurt', null, { indicate: false })
    w.damagePulse(Math.min(1, 0.45 + h.dmg / 30))
    w.shake(h.heavy ? 0.5 : 0.25)
    w.vfx.hit(this.pos.x, 1.1, this.pos.z, this.pos.x - h.x, this.pos.z - h.z, !!h.heavy, new THREE.Color(0.35, 0.03, 0.02))
    this.combatT = 4
    if (this.hp <= 0) return this.die()
    this.series = 0
    if (h.grab) return 'hit'
    this.knock(h.x, h.z, h.knock)
    if (h.heavy || h.dmg >= 15 || this.state === 'bow' || this.state === 'breath') this.setState('hurt')
    return 'hit'
  }

  private die(): HitResult {
    this.hp = 0
    this.alive = false
    this.airY = 0
    this.focus = false
    this.setState('dead')
    this.w.sound('death', this.pos, { indicate: false })
    return 'hit'
  }

  /** the bronze boss of the kalkan meets the blow: a sheaf of sparks, +25 Запал, the counter opens */
  private onParry(h: HitInfo) {
    const w = this.w
    w.kit.addFervor(25)
    this.counterUntil = w.time + 1.0
    this.model.shieldBoss.getWorldPosition(this.v)
    w.sound('clang', this.pos, { indicate: false, vol: 1 })
    w.sound('perfect', null, { indicate: false, vol: 0.7 })
    w.hitstop(0.08)
    w.slowmo(0.35, 0.4)
    w.shake(0.35)
    const dx = h.x - this.pos.x
    const dz = h.z - this.pos.z
    const l = Math.hypot(dx, dz) || 1
    for (let i = 0; i < 40; i++) {
      const a = Math.atan2(dx, dz) + rand(-0.9, 0.9)
      const sp = rand(3, 9)
      w.vfx.add.spawn({ x: this.v.x, y: this.v.y, z: this.v.z, vx: Math.sin(a) * sp, vy: rand(0.5, 4), vz: Math.cos(a) * sp, r: 2.6, g: 1.6, b: 0.6, size: rand(0.03, 0.06), life: rand(0.25, 0.5), drag: 3, gravity: 6 })
    }
    w.vfx.rings.spawn(this.v.x + (dx / l) * 0.4, this.v.z + (dz / l) * 0.4, { from: 0.1, to: 1.6, dur: 0.3, color: new THREE.Color(2, 1.4, 0.6), width: 0.06 })
    this.combatT = 4
  }

  /** Aldar's hand in the world: the Mixamo bone when the body is loaded, the procedural joint before that */
  handWorld(side: 'L' | 'R', out: THREE.Vector3) {
    return this.anim?.handWorld(side, out) ?? (side === 'L' ? this.model.handL : this.model.sword).getWorldPosition(out)
  }

  heal(v: number) {
    this.hp = Math.min(this.maxHp, this.hp + v)
  }

  /** Damage that bypasses dodge frames (grab ticks, roots). */
  directDamage(d: number) {
    if (!this.alive) return
    this.hp -= d
    this.rig.hitFlash()
    this.w.damagePulse(0.6)
    if (this.hp <= 0) this.die()
  }

  // ------------------------------------------------------------------ actions

  /** a perfect dodge opens the counter for a moment */
  onPerfectDodge() {
    this.counterUntil = this.w.time + 0.6
  }

  private startAttack(name: string) {
    this.attack = this.armed(ATK[name])
    this.combo = Math.max(0, STRING.indexOf(name))
    this.swings++
    this.attackName = name
    this.landed = false
    if (name === 'counter') this.counterUntil = -10
    this.hitSet.clear()
    this.swung = false
    this.impactDone = false
    this.facing = this.aimAngle
    this.bufferT = 0
    this.setState(name === 'bash' ? 'bash' : 'attack')
    if (name === 'bash') {
      this.bashes++
      this.w.sound('swing_heavy', this.pos, { indicate: false, vol: 0.6 })
    }
  }

  private startSlam() {
    const p = clamp(this.chargeT / 0.85, 0, 1)
    this.attack = { ...this.armed(ATK.slam), dmg: Math.round(22 + p * 12), posture: Math.round(26 + p * 14), knock: 7 + p * 4 }
    this.attackName = 'slam'
    this.landed = false
    this.heavyFull = p >= 0.95
    this.hitSet.clear()
    this.swung = false
    this.impactDone = false
    this.facing = this.aimAngle
    this.setState('slam')
  }

  /** a blow as dealt with the weapon in hand: the reach follows its length (the shield has its own) */
  private armed(base: PAttackDef): PAttack {
    return { ...base, range: base.reach ?? hitRange(this.melee, base.ext) }
  }

  private tryDodge(mx: number, mz: number) {
    if (this.dodgeCharges <= 0 || this.rootedT > 0) return false
    this.dodgeCharges--
    if (this.dodgeRecharge <= 0) this.dodgeRecharge = 1.1
    if (Math.hypot(mx, mz) < 0.1) {
      mx = -Math.sin(this.aimAngle)
      mz = -Math.cos(this.aimAngle)
    }
    const l = Math.hypot(mx, mz)
    this.dodgeDir.set(mx / l, 0, mz / l)
    // the roll goes where he steps, so the body turns into it (the spring rig smooths the turn)
    this.facing = Math.atan2(this.dodgeDir.x, this.dodgeDir.z)
    // docs/COMBAT.md: an invulnerable window of 0.25 s
    this.iframes = 0.25
    this.dodgeStart = this.w.time
    this.focus = false
    this.setState('dodge')
    this.w.sound('dodge', null, { indicate: false })
    this.w.vfx.dust(this.pos.x, this.pos.z, 8, 0.6, new THREE.Color(0.16, 0.14, 0.12))
    this.w.playerNoise(this.pos, 4)
    return true
  }

  startFinisher(e: Enemy) {
    this.pendingWeapon = null
    this.weapon = 'blade'
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
    this.focus = false
    this.setState('interact')
  }

  grabbedBy() {
    this.grabProgress = 0
    this.focus = false
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

  /** «Огненная стрела»: the arrowhead to the hot slot at the hip, 35 Запала */
  private nockFire() {
    const w = this.w
    if (this.fireNocked) return
    if (!this.lightOn) {
      w.toast(w.kit.vesselGiven ? 'Огонь остался у Азамата' : this.clogT > 0 ? 'Прорези забиты тиной' : 'Сосуд пуст', 'warn', 'flame')
      return
    }
    if (!w.kit.spendFervor(FIRE_ARROW_COST)) {
      w.toast(`Нужно ${FIRE_ARROW_COST} запала`, 'warn', 'flame')
      return
    }
    this.fireNocked = true
    w.sound('ignite', this.pos, { indicate: false, vol: 0.55 })
    this.model.vesselCore.getWorldPosition(this.v)
    for (let i = 0; i < 14; i++) w.vfx.add.spawn({ x: this.v.x, y: this.v.y, z: this.v.z, vx: rand(-1, 1), vy: rand(1, 2.5), vz: rand(-1, 1), r: 2.4, g: 1.0, b: 0.3, size: 0.05, life: 0.5, drag: 2 })
  }

  /** «Вспышка живицы»: a pinch of resin into the slot, a ring of sparks around the belt */
  private tryFlash() {
    const w = this.w
    if (!w.kit.ember) {
      w.toast('Сосуд пуст: в нём нет огня', 'warn', 'flame')
      return
    }
    if (w.kit.vesselGiven) return
    if (this.flashCd > 0 || (this.state !== 'move' && this.state !== 'hurt')) return
    this.flashCd = FLASH_CD
    this.clogT = 0
    this.setState('flash')
    w.vesselFlash(this.pos)
  }

  // ------------------------------------------------------------------ update

  update(dt: number, inp: Input) {
    const w = this.w
    const kit = w.kit
    this.st += dt
    this.iframes = Math.max(0, this.iframes - dt)
    this.eagleCd = Math.max(0, this.eagleCd - dt)
    this.bufferT = Math.max(0, this.bufferT - dt)
    this.flashCd = Math.max(0, this.flashCd - dt)
    this.clogT = Math.max(0, this.clogT - dt)
    this.rootedT = Math.max(0, this.rootedT - dt)
    if (this.dodgeCharges < this.dodgeMax) {
      this.dodgeRecharge -= dt
      if (this.dodgeRecharge <= 0) {
        this.dodgeCharges++
        this.dodgeRecharge = this.dodgeCharges < this.dodgeMax ? 1.1 : 0
      }
    }
    if (this.state === 'move') {
      this.comboIdle += dt
      if (this.comboIdle > 0.55) this.combo = 0
    } else this.comboIdle = 0
    this.decayPosture(dt, 30)
    // the series dies after a pause; out of a fight the embers warm Запал back to 40
    this.seriesT -= dt
    if (this.seriesT <= 0) this.series = 0
    if (this.combatT <= 0 && kit.fervor < 40) kit.addFervor(4 * dt)

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

    const free = this.alive && this.state !== 'grabbed' && this.state !== 'dead' && this.state !== 'finisher'
    if (free) {
      // the stance (docs/COMBAT.md §1): Tab toggles, 1 and 2 pick
      if (inp.pressed('Digit1')) this.setWeapon('blade')
      else if (inp.pressed('Digit2')) this.setWeapon('bow')
      else if (inp.pressed('Tab')) this.setWeapon(this.weapon === 'bow' ? 'blade' : 'bow')
      if (this.pendingWeapon && this.state === 'move') this.setWeapon(this.pendingWeapon)
    }

    // the kalkan: [ПКМ] held with the kylys; its pressing starts the parry window
    const shield = kit.ember && this.weapon === 'blade'
    if (shield && inp.pressed('Mouse2') && free) {
      this.guardPressT = w.time
      this.parryUsed = false
      // the guard comes up out of the tail of a blow
      if (this.state === 'attack' && this.st / this.attack.dur >= this.attack.cancel) this.setState('move')
    }
    this.guardHeld = shield && inp.isDown('Mouse2') && free

    // the belt vessel: [F] tapped — a flash; held — the heat focus; with the bow out — light the arrow
    if (inp.pressed('KeyF') && free) {
      if (this.weapon === 'bow' && kit.ember && !kit.vesselGiven) this.nockFire()
      else {
        this.fDown = true
        this.fHeldT = 0
      }
    }
    if (this.fDown) {
      if (inp.isDown('KeyF')) {
        this.fHeldT += dt
        if (this.fHeldT > FOCUS_HOLD && this.lightOn && this.state === 'move') this.focus = true
        this.bloodSense = kit.vesselGiven && this.fHeldT > FOCUS_HOLD && this.state === 'move'
      } else {
        if (!this.focus && this.fHeldT <= FOCUS_HOLD) this.tryFlash()
        this.fDown = false
        this.focus = false
        this.bloodSense = false
      }
    }
    if (!kit.vesselGiven || this.state !== 'move') this.bloodSense = false
    if (!this.lightOn || this.weapon !== 'blade' || (this.state !== 'move' && this.state !== 'interact')) this.focus = false
    this.slowWalk = this.focus

    const busy = this.state === 'dead' || this.state === 'grabbed' || this.state === 'finisher' || this.state === 'interact'
    if (!busy && inp.pressed('Space') && this.state !== 'dodge' && (this.state !== 'hurt' || this.st > 0.12)) this.tryDodge(mx, mz)

    let speed = 0
    /** aim = turn to cursor, move = turn to movement, none = hold */
    let faceMode: 'aim' | 'move' | 'none' = 'aim'
    this.stance = this.guard || this.state === 'bow'
    let clip: Clip | null = null
    let ct = 0
    let shake = 0

    switch (this.state) {
      case 'move': {
        speed = this.guard ? 2.2 : this.slowWalk ? 2.6 : 5.2
        faceMode = this.guard ? 'aim' : 'move'
        const bash = shield && (inp.pressed('PadBash') || (this.guard && inp.pressed('KeyE')) || (inp.pressed('Mouse0') && inp.isDown('ShiftLeft')))
        if (bash) this.startAttack('bash')
        else if (this.weapon === 'bow') {
          if (inp.pressed('Mouse2')) {
            if (kit.arrows <= 0) {
              w.toast('Колчан пуст', 'warn', 'bow')
              w.sound('ui', null, { indicate: false, vol: 0.5 })
            } else {
              this.bowDraw = 0
              this.bowFullAt = -1
              this.setState('bow')
            }
          }
        } else if (inp.pressed('Mouse0')) {
          if (w.time < this.counterUntil) this.startAttack('counter')
          else this.startAttack(STRING[this.combo])
        }
        if (this.state === 'move') {
          if (inp.pressed('KeyR')) {
            if (this.eagleCd <= 0) {
              this.eagleCd = this.eagleCdMax
              this.setState('eagle')
            }
          } else if (inp.isDown('KeyV') && this.hp < this.maxHp && !this.guard) {
            if (kit.fervor >= BREATH_COST) this.setState('breath')
            else if (inp.pressed('KeyV')) w.toast(`Нужно ${BREATH_COST} запала`, 'warn', 'breath')
          }
        }
        break
      }
      case 'attack':
      case 'slam':
      case 'bash': {
        const a = this.attack
        const n = this.st / a.dur
        clip = HERO_CLIPS[a.phases[0][0]]
        ct = n
        // the spin attack turns the whole body a full circle
        this.spin = a.phases[0][0] === 'crescent' ? Math.PI * 2 * smoothstep(0.12, 0.72, n) : 0
        faceMode = n < a.hitStart * 0.8 ? 'aim' : 'none'
        if (a.lunge && n >= (a.lungeStart ?? 0) && n <= (a.lungeEnd ?? 1)) {
          const win = ((a.lungeEnd ?? 1) - (a.lungeStart ?? 0)) * a.dur
          const nearest = this.nearestEnemyAhead(a.range + 0.4)
          // the step in stops once the target is inside the tip's path
          const reach = a.reach ?? tipReach(this.melee)
          const k = nearest !== null ? Math.min(1, Math.max(0, nearest - (reach - 0.15)) / a.range) : 1
          this.move(dt, this.fx * (a.lunge / win) * k, this.fz * (a.lunge / win) * k)
        }
        if (n >= a.hitStart && !this.swung) {
          this.swung = true
          w.playerNoise(this.pos, 9)
          if (this.state === 'bash') {
            this.model.shieldBoss.getWorldPosition(this.v)
            w.vfx.dust(this.pos.x + this.fx * 1.1, this.pos.z + this.fz * 1.1, 6, 0.5)
          } else {
            w.sound(a.heavy ? 'swing_heavy' : 'swing', this.pos, { indicate: false })
            const color = a.slash?.color ?? (this.heavyFull ? SLASH_RAGE : this.series >= 2 ? SLASH_AMBER : SLASH_BONE)
            // the trail is drawn where the blade actually passes: from its base to the tip
            const band = trailBand(this.melee, a.ext)
            if (a.slash) {
              w.vfx.slashes.spawn(this.pos.x, 1.0 + (a.slash.tilt && Math.abs(a.slash.tilt) > 1 ? 0.3 : 0), this.pos.z, this.facing, { dir: a.slash.dir, tilt: a.slash.tilt, inner: band.inner, outer: band.outer, angle: (a.arc * Math.PI) / 180, color, dur: a.heavy ? 0.28 : 0.2 })
            } else {
              for (let k = 0; k < 10; k++) {
                const d = band.inner + (k / 9) * (band.outer - band.inner)
                w.vfx.add.spawn({ x: this.pos.x + this.fx * d, y: 1.05, z: this.pos.z + this.fz * d, vx: this.fx * 2, vz: this.fz * 2, r: color.r, g: color.g, b: color.b, a: 0.7, size: 0.05, life: 0.18, drag: 4 })
              }
            }
          }
        }
        if (n >= a.hitStart && n <= a.hitEnd) this.resolveHits(a)
        if (this.state === 'attack' && this.attackName !== 'counter') {
          if (inp.pressed('Mouse0')) this.bufferT = 0.45
          if (this.lmbHeld && this.holdT > 0.3 && n >= a.hitEnd && this.attackName !== 'vypad') {
            this.chargeT = 0
            this.setState('charge')
            break
          }
          if (n >= a.cancel && this.bufferT > 0) {
            if (w.time < this.counterUntil) this.startAttack('counter')
            else this.startAttack(STRING[(this.combo + 1) % STRING.length])
            break
          }
        }
        if (n >= 1) {
          if (this.state === 'attack' && STRING.includes(this.attackName)) this.combo = (this.combo + 1) % STRING.length
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
        // a thrust out of the roll
        if (n > 0.35 && inp.pressed('Mouse0') && this.weapon === 'blade') {
          this.startAttack(w.time < this.counterUntil ? 'counter' : 'vypad')
          break
        }
        if (n >= 1) this.setState('move')
        break
      }
      case 'hurt': {
        faceMode = 'none'
        clip = HERO_CLIPS.hurt
        ct = this.st / 0.38
        if (this.st > 0.38) this.setState('move')
        break
      }
      case 'bow': {
        speed = 2.2
        const before = this.bowDraw
        this.bowDraw = Math.min(1, this.bowDraw + dt / kit.drawTime)
        if (this.bowDraw >= 1 && before < 1) {
          this.bowFullAt = w.time
          w.sound('ui', null, { indicate: false, vol: 0.18 })
        }
        clip = HERO_CLIPS.bow
        ct = this.bowDraw
        if (inp.pressed('Mouse0')) {
          this.fireArrow()
          if (inp.isDown('Mouse2') && kit.arrows > 0) {
            this.bowDraw = 0
            this.bowFullAt = -1
            this.st = 0
          } else this.setState('move')
        } else if (!inp.isDown('Mouse2')) {
          // lowered without a shot: the arrow goes back into the quiver
          this.bowDraw = 0
          this.setState('move')
        }
        break
      }
      case 'eagle': {
        clip = HERO_CLIPS.eagle
        ct = this.st / 0.35
        if (this.st > 0.15 && this.st - dt <= 0.15) w.releaseEagle()
        if (ct >= 1) this.setState('move')
        break
      }
      case 'flash': {
        faceMode = 'none'
        clip = HERO_CLIPS.interact
        ct = 0.3 + (this.st / 0.3) * 0.2
        if (this.st >= 0.3) this.setState('move')
        break
      }
      case 'breath': {
        speed = 1.2
        faceMode = 'move'
        if (!inp.isDown('KeyV')) {
          this.setState('move')
          break
        }
        if (Math.random() < dt * 14) w.vfx.add.spawn({ x: this.pos.x + rand(-0.4, 0.4), y: rand(0.4, 1.6), z: this.pos.z + rand(-0.4, 0.4), vy: 0.7, r: 1.8, g: 0.9, b: 0.3, size: 0.05, life: 0.8, drag: 1 })
        if (this.st >= BREATH_DUR) {
          kit.fervor = Math.max(0, kit.fervor - BREATH_COST)
          this.heal(BREATH_HEAL)
          this.breaths++
          w.sound('ignite', null, { indicate: false, vol: 0.35 })
          w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.2, to: 1.4, dur: 0.6, color: new THREE.Color(1.6, 0.8, 0.3), width: 0.04 })
          this.setState('move')
        }
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
    if (this.rootedT > 0) speed = 0

    // ---- facing: the body follows the legs, the head follows the cursor
    let speedScale = 1
    if (faceMode === 'aim') {
      this.facing = dampAngle(this.facing, this.aimAngle, 16, dt)
      this.idleTurning = false
    } else if (faceMode === 'move') {
      if (ml > 0.05 && this.rootedT <= 0) {
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
    speedScale *= 1 - 0.5 * this.mire
    this.mire = Math.max(0, this.mire - dt * 4)
    if (speed > 0) {
      this.move(dt, mx * speed * speedScale, mz * speed * speedScale)
      this.speedNow = ml > 0 ? speed * Math.min(1, ml) * speedScale : this.idleTurning ? 0.9 : 0
    } else if (this.state !== 'dodge' && this.state !== 'attack' && this.state !== 'slam' && this.state !== 'bash') {
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
          // every step in the water is a splash the whole ravine hears
          w.sound('splash', this.pos, { indicate: false, vol: 0.45 })
          w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.15, to: 1.3, dur: 0.9, color: new THREE.Color(0.35, 0.45, 0.6), width: 0.03 })
          w.playerNoise(this.pos, 7)
        } else {
          w.sound('step_light', this.pos, { indicate: false, vol: 0.18 })
          if (this.speedNow > 4) w.vfx.dust(this.pos.x - this.fx * 0.2, this.pos.z - this.fz * 0.2, 3, 0.35, new THREE.Color(0.16, 0.14, 0.12))
          // a careful step carries less far than a run; the glow at the belt is seen from afar
          w.playerNoise(this.pos, (this.lightOn ? 4.5 : 2.5) * (this.speedNow > 3.5 ? 1 : 0.55))
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

    this.updateGear(dt)
    this.updateAimLine()

    const mlen = Math.hypot(mx, mz) || 1
    const fwd = ml > 0.05 ? (mx * this.fx + mz * this.fz) / mlen : 1
    const side = ml > 0.05 ? (mx * Math.cos(this.facing) - mz * Math.sin(this.facing)) / mlen : 0
    const st = this.state
    const snap = st === 'attack' || st === 'slam' || st === 'bash' ? 2.3 : st === 'dodge' ? 2.4 : st === 'hurt' ? 2.8 : st === 'finisher' ? 2.0 : st === 'dead' ? 0.9 : st === 'charge' ? 1.4 : 1.15
    this.rig.update(dt, { speed: this.speedNow, forward: fwd, side, look: this.gazeOff, clip, t: ct, time: w.time, shake, snap })
    this.lastDt = dt
    this.syncRig()
    // the body keeps its guard for a while after a fight action, and whenever an awake enemy is close
    if (st === 'attack' || st === 'charge' || st === 'slam' || st === 'bash' || st === 'bow' || st === 'hurt' || st === 'dodge' || this.guard) this.combatT = 4
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
      block: this.guard,
      action: this.attackName,
      n: this.st / this.attack.dur,
      hit: [this.attack.hitStart, this.attack.hitEnd],
      charge: clamp(this.chargeT / 0.85, 0, 1),
      draw: this.bowDraw,
      shots: this.arrowsShot,
      st: this.st,
    })
    this.updateVessel(dt)
  }

  private nearestEnemyAhead(range: number) {
    let best: number | null = null
    for (const e of this.w.enemies) {
      if (!e.alive || e.hidden || e.cloakedNow || e.ledge) continue
      if (!inArc(this.pos.x, this.pos.z, this.facing, e.pos.x, e.pos.z, range, 70, e.radius)) continue
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) - e.radius
      if (best === null || d < best) best = d
    }
    return best
  }

  private resolveHits(a: PAttack) {
    const w = this.w
    const kit = w.kit
    const name = this.attackName
    let any = false
    let mult = kit.meleeMult
    if (name === 'counter' && kit.keepsakes.has('fang')) mult *= 1.2
    for (const e of w.enemies) {
      if (!e.alive || this.hitSet.has(e) || e.hidden || e.cloakedNow || e.ledge) continue
      if (Math.abs(e.airY) > 2) continue
      if (!inArc(this.pos.x, this.pos.z, this.facing, e.pos.x, e.pos.z, a.range, a.arc, e.radius)) continue
      this.hitSet.add(e)
      let m = mult
      // a thrust into the back
      if (name === 'vypad' && Math.sin(e.facing) * this.fx + Math.cos(e.facing) * this.fz > 0.3) m *= 1.3
      const r = e.takeHit(a.dmg * m, a.posture ?? 0, this.pos.x, this.pos.z, a.knock, !!a.heavy, 'melee')
      if (!r) continue
      any = true
      if (DETONATE.has(name)) e.detonateMarks()
      w.vfx.hit(e.pos.x, 1.0 + e.hitHeight, e.pos.z, this.fx, this.fz, !!a.heavy || name === 'counter', e.bloodColor)
    }
    if (any && !this.landed) this.onLanded(name, !!a.heavy)
    if (a.heavy && !this.impactDone) {
      this.impactDone = true
      const ix = this.pos.x + this.fx * 1.6
      const iz = this.pos.z + this.fz * 1.6
      w.vfx.dust(ix, iz, 14, 1.2)
      w.vfx.rings.spawn(ix, iz, { from: 0.3, to: 3.2, dur: 0.45, color: new THREE.Color(0.9, 0.6, 0.35), width: 0.08 })
      if (this.heavyFull) this.wave(this.facing)
    }
  }

  /** first landed hit of a blow: series, Запал, the note, the weight */
  private onLanded(name: string, heavy: boolean) {
    const w = this.w
    this.landed = true
    this.lastLandT = w.time
    this.series = Math.min(6, this.series + 1)
    this.seriesT = 0.8
    const finale = name === 'polu'
    w.kit.addFervor(name === 'bash' ? 3 : name === 'counter' ? 6 : finale ? 8 : 4)
    // each blow in a row rises a step up the kurai pentatonic; the finale lands on the drum
    w.audio.note(Math.min(7, this.series - 1), finale || heavy || name === 'bash')
    if (name === 'counter') {
      w.slowmo(0.3, 0.35)
      w.sound('clang', this.pos, { indicate: false })
      w.shake(0.45)
    }
    w.sound(heavy || name === 'bash' ? 'hit_heavy' : 'hit', this.pos, { indicate: false })
    w.hitstop(heavy ? 0.1 : finale || name === 'bash' ? 0.11 : name === 'counter' ? 0.12 : 0.04 + 0.015 * Math.min(3, this.series))
    w.shake(heavy || finale || name === 'bash' ? 0.35 : 0.12 + 0.03 * this.series)
  }

  /** a cutting wave along the ground (a fully charged heavy lunge) */
  private wave(angle: number) {
    const w = this.w
    const dx = Math.sin(angle)
    const dz = Math.cos(angle)
    for (const e of w.enemies) {
      if (!e.alive || e.hidden || e.cloakedNow || this.hitSet.has(e)) continue
      const ex = e.pos.x - this.pos.x
      const ez = e.pos.z - this.pos.z
      const along = ex * dx + ez * dz
      const lat = Math.abs(ex * dz - ez * dx)
      if (along < 0.5 || along > 5.2 || lat > 0.9 + e.radius) continue
      if (e.takeHit(18 * w.kit.meleeMult, 20, this.pos.x, this.pos.z, 4, false, 'melee')) w.vfx.hit(e.pos.x, 1.0 + e.hitHeight, e.pos.z, dx, dz, true, e.bloodColor)
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
    const peak = this.bowPeak
    l.scale.set(0.6 + this.bowDraw * 0.8 + (peak ? 0.8 : 0), 1, d)
    mat.opacity = 0.12 + 0.4 * this.bowDraw + (peak ? 0.3 : 0)
    if (this.fireNocked) mat.color.setRGB(2, 0.7, 0.2)
    else if (peak) mat.color.setRGB(2.2, 1.6, 0.7)
    else mat.color.setRGB(1.6, 0.85, 0.3)
  }

  private fireArrow() {
    const w = this.w
    if (!w.kit.takeArrow()) return
    this.arrowsShot++
    const pierce = this.bowPeak
    const power = Math.max(0.3, this.bowDraw)
    // docs/COMBAT.md: 3.0× a kylys blow, 4.0× and through the small ones at the peak
    const dmg = pierce ? 40 : 30 * power
    const dir = new THREE.Vector3(Math.sin(this.aimAngle), 0, Math.cos(this.aimAngle))
    w.projectiles.spawnArrow(new THREE.Vector3(this.pos.x + dir.x * 0.6, 1.35, this.pos.z + dir.z * 0.6), dir, power, { fire: this.fireNocked, pierce, dmg })
    this.fireNocked = false
    w.sound('arrow', null, { indicate: false, vol: pierce ? 1 : 0.8 })
    if (pierce) w.shake(0.12)
    w.playerNoise(this.pos, 5)
  }

  // ------------------------------------------------------------------ gear and the vessel

  /** what is where: kylys in the hand or in the scabbard, kalkan on the forearm or the back, the bow likewise */
  private updateGear(dt: number) {
    const m = this.model
    const kit = this.w.kit
    // the wrist turns the blade into line with the forearm for thrusts
    const thrusting = (this.state === 'attack' || this.state === 'bash') && this.attack.phases[0][0] === 'thrust' && this.st / this.attack.dur > 0.25 && this.st / this.attack.dur < 0.85
    m.sword.rotation.x = damp(m.sword.rotation.x, thrusting ? -0.12 : -1.25, 22, dt)
    const blade = this.weapon === 'blade' || this.state === 'finisher'
    m.sword.visible = blade
    m.swordSheathed.visible = !blade
    m.shield.visible = kit.ember && blade
    m.shieldBack.visible = kit.ember && !blade
    m.bowHand.visible = kit.bow && !blade
    m.bowBack.visible = kit.bow && blade
    const quiver = m.quiverArrows[0].parent!
    quiver.visible = kit.bow
    m.quiverArrows.forEach((a, i) => (a.visible = i < kit.arrows - (this.state === 'bow' ? 1 : 0)))
    m.arrowHand.visible = this.state === 'bow'
    m.arrowFlame.visible = this.state === 'bow' && this.fireNocked
  }

  /** The coal in the vessel: its light on the belt, the heat focus as a narrow cone ahead (docs/COMBAT.md). */
  private updateVessel(dt: number) {
    const L = this.w.lighting
    const l = L.lantern
    const kit = this.w.kit
    const on = this.lightOn
    // follow the swinging vessel; lift the light a little so the ground beside it does not blow out
    this.model.vesselCore.getWorldPosition(this.v)
    l.position.set(this.v.x, this.v.y + 0.6, this.v.z)
    const t = this.w.time
    const flick = 0.86 + 0.08 * Math.sin(t * 11) * Math.sin(t * 7.3 + 1) + 0.06 * Math.sin(t * 23)
    const target = on ? 7 * flick * kit.lightMult : 0
    l.intensity += (target - l.intensity) * (1 - Math.exp(-14 * dt))
    l.distance = 18 * kit.lightMult
    const g = this.model.vesselGlow
    const heat = on ? flick * (0.7 + 0.3 * kit.lightMult) : kit.ember ? 0.06 : 0.02
    const tint = this.vesselTint
    if (tint) {
      g.color.setRGB(tint.r * 3 * heat, tint.g * 3 * heat, tint.b * 3 * heat)
      l.color.copy(tint)
    } else {
      g.color.setRGB(3.2 * heat, 1.3 * heat, 0.35 * heat)
      l.color.setRGB(1.0, 0.62, 0.3)
    }
    this.model.vessel.visible = !kit.vesselGiven
    // the heat focus: the slots' light gathered into a cone of 12 m along the gaze
    const f = L.focus
    const fTarget = this.focus && on ? 60 * kit.lightMult : 0
    f.intensity += (fTarget - f.intensity) * (1 - Math.exp(-10 * dt))
    f.position.set(this.v.x, this.v.y + 0.9, this.v.z)
    f.target.position.set(this.pos.x + Math.sin(this.gaze) * 9, 0, this.pos.z + Math.cos(this.gaze) * 9)
    f.target.updateMatrixWorld()
  }
}
