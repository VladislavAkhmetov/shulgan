import * as THREE from 'three'
import { Enemy } from './enemies'
import type { BossLike } from './boss'
import { createSuInahi, SU_CLIPS, type SuModel } from './models2'
import type { Clip, Rig } from './rig'
import type { World } from '../world'
import type { AttackDef } from '../types'
import { clamp, rand, smoothstep } from '../util'

const WATER = new THREE.Color(0.3, 0.7, 0.9)
const SLAP: AttackDef = { dur: 1.0, hitStart: 0.45, hitEnd: 0.58, range: 3.7, arc: 120, dmg: 16, knock: 6, cd: 0.9, phases: [['slap', 0, 1]], swing: 'swing_heavy', slash: { dir: 1, tilt: 0.2, scale: 1.5, color: WATER } }

type Sub = 'none' | 'rise' | 'roar' | 'whip' | 'flood' | 'dive' | 'frozen' | 'burst' | 'mirror'

const WHIP_WIND = 1.15
const FROZEN_T = 3.5
const MIRROR_WIND = 2.7
const UNDER = -2.6
const FLOAT = -0.1
const ISLET_R = 4.3

interface Flood {
  pos: THREE.Vector3
  mesh: THREE.Mesh
  t: number
  on: boolean
  hurt: number
}

interface Fake {
  model: SuModel
  pos: THREE.Vector3
  alive: boolean
}

/**
 * Хыу инәһе, the mistress of the crossing (docs/COMBAT.md, boss of chapter 2) — on the black pool among five basalt islets.
 * Phase 1 (100 → 60%): the lash of black braids across the islets (blocked by the kalkan, broken by an arrow into the golden
 * comb), the rising pool that floods two islets (water to the waist, into the vessel's slots), the dive into the deep —
 * Azamat's kurai [Q] freezes the surface and seals her waist-deep in ice for 3.5 s. Phase 2 (60 → 0%): the mirror haze —
 * three figures ready a volley of water spears; only under the true one does the golden comb shine in the water.
 */
export class SuInahi extends Enemy implements BossLike {
  kind = 'boss' as const
  clips = SU_CLIPS
  rig: Rig
  title = 'водяная хозяйка переправы'
  phase = 1
  fightStarted = false
  perch: THREE.Vector3 | null = null
  readonly model: SuModel
  readonly spawn = new THREE.Vector3()
  private center: THREE.Vector3
  private sub: Sub = 'none'
  private whipCd = 2.5
  private floodCd = 7
  private diveCd = 11
  private mirrorCd = 2
  private whipAt = new THREE.Vector3()
  private whipDir = 0
  private whipDone = false
  private lines: THREE.Group
  private lineMat: THREE.MeshBasicMaterial
  private floods: Flood[] = []
  private ice: THREE.Mesh
  private diveFrom = new THREE.Vector3()
  private diveTo = new THREE.Vector3()
  private rippleT = 0
  private struck = false
  private fakes: Fake[] = []
  private combGlint: THREE.Mesh
  private volleyDone = false

  constructor(w: World, x: number, z: number, center: THREE.Vector3, islets: THREE.Vector3[]) {
    super(w, x, z)
    this.model = createSuInahi()
    this.rig = this.model.rig
    w.scene.add(this.rig.root)
    this.center = center.clone()
    this.spawn.set(x, 0, z)
    this.weight = 'heavy'
    this.hp = this.maxHp = 1100
    this.maxPosture = 260
    this.speed = 3.2
    this.radius = 1.0
    this.stagDur = 3.2
    this.hitHeight = 0.7
    this.stepEvery = 9999
    this.name = 'Хыу инәһе'
    this.bloodColor = new THREE.Color(0.2, 0.45, 0.6)
    // the lash: two crossed bands on the water and the islets, amber while she raises the braids
    this.lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    this.lines = new THREE.Group()
    for (const r of [0, Math.PI / 2]) {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 22).rotateX(-Math.PI / 2), this.lineMat)
      band.rotation.y = r
      this.lines.add(band)
    }
    this.lines.visible = false
    w.scene.add(this.lines)
    // the flood: a disc of black water that rises over an islet
    const floodMat = new THREE.MeshStandardMaterial({ color: 0x06121a, roughness: 0.12, metalness: 0.3, transparent: true, opacity: 0.88, emissive: new THREE.Color(0.01, 0.04, 0.06) })
    for (const p of islets) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(ISLET_R + 0.6, 28).rotateX(-Math.PI / 2), floodMat)
      mesh.position.set(p.x, -0.6, p.z)
      mesh.visible = false
      w.scene.add(mesh)
      this.floods.push({ pos: p.clone(), mesh, t: 0, on: false, hurt: 0 })
    }
    // the frozen pool: white-blue ice round her
    this.ice = new THREE.Mesh(new THREE.CircleGeometry(6, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9ab8c8, roughness: 0.25, metalness: 0.1, emissive: new THREE.Color(0.05, 0.09, 0.12), transparent: true, opacity: 0.85 }))
    this.ice.position.y = -0.08
    this.ice.visible = false
    w.scene.add(this.ice)
    // the mirror haze: two false figures, and the golden comb's glint in the water under the true one
    for (let i = 0; i < 2; i++) {
      const model = createSuInahi()
      model.rig.root.visible = false
      w.scene.add(model.rig.root)
      this.fakes.push({ model, pos: new THREE.Vector3(), alive: false })
    }
    this.combGlint = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.combGlint.visible = false
    w.scene.add(this.combGlint)
    this.toDeep()
  }

  /** under the black water, unseen, until Aldar steps onto the crossing */
  private toDeep() {
    this.state = 'dormant'
    this.airY = UNDER
    this.hidden = true
    this.forceHidden = true
  }

  get frozen() {
    return this.sub === 'frozen'
  }

  /** she is under the water right now (the moment for the kurai) */
  get submerged() {
    return this.alive && this.state === 'special' && this.sub === 'dive' && this.hidden
  }

  resetBoss() {
    this.alive = true
    this.removed = false
    this.hp = this.maxHp
    this.posture = 0
    this.phase = 1
    this.fightStarted = false
    this.aggro = false
    this.atk = null
    this.sub = 'none'
    this.pos.copy(this.spawn)
    this.vel.set(0, 0, 0)
    this.whipCd = 2.5
    this.floodCd = 7
    this.diveCd = 11
    this.mirrorCd = 2
    this.arrowsIn = 0
    this.lines.visible = false
    this.ice.visible = false
    this.combGlint.visible = false
    for (const f of this.floods) {
      f.on = false
      f.mesh.visible = false
    }
    for (const f of this.fakes) this.hideFake(f, false)
    this.rig.root.position.y = 0
    this.rig.root.visible = true
    this.toDeep()
    this.setState('dormant')
  }

  /** she rises out of the middle of the pool */
  startFight() {
    this.fightStarted = true
    this.aggro = true
    this.forceHidden = false
    this.hidden = false
    this.sub = 'rise'
    this.faceTo(this.w.player.pos.x, this.w.player.pos.z, 1)
    this.setState('special')
  }

  becomeAggro() {}
  hearNoise() {}
  protected canFlinch() {
    return false
  }
  /** the water carries her: no knockback, no walls (she glides over the deep) */
  knock() {}
  move(dt: number, vx: number, vz: number) {
    this.pos.x += vx * dt
    this.pos.z += vz * dt
    // keep to the black pool
    const dx = this.pos.x - this.center.x
    const dz = this.pos.z - this.center.z
    const d = Math.hypot(dx, dz)
    if (d > 9) {
      this.pos.x = this.center.x + (dx / d) * 9
      this.pos.z = this.center.z + (dz / d) * 9
    }
  }

  damageMult(source: string) {
    if (this.sub === 'frozen') return 1.6
    return source === 'fire' ? 0.6 : 1
  }

  stun(sec: number) {
    if (this.state === 'special' && this.sub !== 'whip' && this.sub !== 'mirror') return
    this.lines.visible = false
    super.stun(sec)
  }

  /** Kara's claws break the lash and the volley like any wind-up */
  eagleStrike() {
    if (this.sub === 'mirror') return this.breakIllusion()
    super.eagleStrike()
  }

  /** an arrow into the golden comb while the braids are raised: the lash breaks */
  onArrow(fromX: number, fromZ: number) {
    void fromX
    void fromZ
    if (this.state === 'special' && this.sub === 'whip' && !this.whipDone) {
      const w = this.w
      this.lines.visible = false
      w.sound('clang', this.pos, { indicate: false })
      w.hitstop(0.08)
      w.shake(0.5)
      for (let i = 0; i < 30; i++) w.vfx.add.spawn({ x: this.pos.x, y: 1.6 + this.airY, z: this.pos.z, vx: rand(-4, 4), vy: rand(0, 4), vz: rand(-4, 4), r: 2.4, g: 1.7, b: 0.5, size: 0.06, life: 0.5, drag: 2 })
      this.hp -= 35
      this.addPosture(80)
      this.rig.hitFlash()
      this.sub = 'none'
      if (this.hp <= 0) this.die()
      else if (this.posture >= this.maxPosture) this.enterStagger()
      else {
        this.state = 'stun'
        this.st = 0
        this.stunT = 2.2
      }
      w.toast('Стрела в гребень: хлыст сломан', 'info', 'bow')
      return true
    }
    if (this.sub === 'mirror' && this.st < MIRROR_WIND + 0.2) {
      this.breakIllusion()
      return false
    }
    return false
  }

  /** Azamat's kurai: the surface freezes and seals her waist-deep where she is (only while she is under) */
  freeze() {
    if (!this.submerged) return false
    const w = this.w
    this.sub = 'frozen'
    this.st = 0
    this.hidden = false
    this.airY = -0.75
    this.ice.visible = true
    this.ice.position.set(this.pos.x, -0.08, this.pos.z)
    this.ice.scale.setScalar(0.1)
    w.sound('clang', this.pos, { indicate: false })
    w.sound('crack', this.pos, { indicate: false })
    w.shake(0.6)
    w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.5, to: 7, dur: 0.6, color: new THREE.Color(0.7, 1.2, 1.5), width: 0.08 })
    return true
  }

  /** an arrow found a false figure: it bursts into mist (the volley goes on from the others) */
  probeFake(pos: THREE.Vector3) {
    if (this.sub !== 'mirror') return false
    for (const f of this.fakes) {
      if (!f.alive || Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z) > 1.1) continue
      this.hideFake(f, true)
      return true
    }
    return false
  }

  private hideFake(f: Fake, burst: boolean) {
    if (burst && f.alive) {
      for (let i = 0; i < 40; i++) this.w.vfx.soft.spawn({ x: f.pos.x + rand(-0.6, 0.6), y: rand(0.2, 2.6), z: f.pos.z + rand(-0.6, 0.6), vx: rand(-1, 1), vy: rand(0.2, 1.4), vz: rand(-1, 1), r: 0.25, g: 0.4, b: 0.5, a: 0.5, size: rand(0.3, 0.6), life: 1.4, grow: 1.5 })
      this.w.sound('teleport', f.pos, { indicate: false, vol: 0.6 })
    }
    f.alive = false
    f.model.rig.root.visible = false
  }

  /** the true one is struck: the haze goes, she reels */
  private breakIllusion() {
    if (this.sub !== 'mirror') return
    for (const f of this.fakes) this.hideFake(f, true)
    this.combGlint.visible = false
    this.sub = 'none'
    this.hp -= 40
    this.rig.hitFlash()
    this.w.toast('Настоящая — та, под которой блестит гребень', 'info', 'water')
    if (this.hp <= 0) this.die()
    else this.enterStagger()
  }

  takeHit(dmg: number, posture: number, fromX: number, fromZ: number, knock: number, heavy: boolean, source: 'melee' | 'arrow' | 'eagle' | 'fire'): boolean {
    const r = super.takeHit(dmg, posture, fromX, fromZ, knock, heavy, source)
    if (r && this.sub === 'mirror' && this.alive) this.breakIllusion()
    return r
  }

  private ringPoint(out: THREE.Vector3, gap: number) {
    const p = this.w.player.pos
    const dx = p.x - this.center.x
    const dz = p.z - this.center.z
    const d = Math.hypot(dx, dz) || 1
    const r = clamp(d - gap, 2.5, 8.6)
    return out.set(this.center.x + (dx / d) * r, 0, this.center.z + (dz / d) * r)
  }

  protected think(dt: number) {
    const p = this.w.player
    this.whipCd -= dt
    this.floodCd -= dt
    this.diveCd -= dt
    this.mirrorCd -= dt
    if (this.phase === 1 && this.hp < this.maxHp * 0.6) {
      this.phase = 2
      this.sub = 'roar'
      this.mirrorCd = 1
      this.setState('special')
      return
    }
    // glide along the pool toward the islet Aldar stands on
    const t = this.ringPoint(this.tmp, 3.0)
    const dx = t.x - this.pos.x
    const dz = t.z - this.pos.z
    const dd = Math.hypot(dx, dz)
    if (dd > 0.3) this.desire.set((dx / dd) * this.speed, 0, (dz / dd) * this.speed)
    this.faceTo(p.pos.x, p.pos.z, 5, dt)
    const d = this.distToPlayer
    if (this.phase === 2 && this.mirrorCd <= 0) return this.startMirror()
    if (this.diveCd <= 0 && d < 18) return this.startDive()
    if (this.floodCd <= 0) return this.startFlood()
    if (this.whipCd <= 0 && d < 18) return this.startWhip()
    if (this.atkCd <= 0 && d < 3.9) this.startAttack(SLAP)
  }

  private startWhip() {
    const p = this.w.player
    this.whipCd = this.phase === 2 ? rand(5, 7) : rand(4, 6)
    this.sub = 'whip'
    this.whipDone = false
    this.whipAt.set(p.pos.x + p.moveDir.x * p.speedNow * 0.3, 0, p.pos.z + p.moveDir.z * p.speedNow * 0.3)
    this.whipDir = Math.atan2(this.whipAt.x - this.pos.x, this.whipAt.z - this.pos.z)
    this.lines.position.set(this.whipAt.x, 0.06, this.whipAt.z)
    this.lines.rotation.y = this.whipDir
    this.lines.visible = true
    this.faceTo(this.whipAt.x, this.whipAt.z, 1)
    this.setState('special')
    this.glint(new THREE.Color(2.2, 1.4, 0.45))
    this.emit('cast', 'threat', 0.9)
  }

  private startFlood() {
    this.floodCd = rand(11, 14)
    const p = this.w.player.pos
    const sorted = [...this.floods].sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p))
    const pick = [sorted[0], sorted[1 + Math.floor(Math.random() * (sorted.length - 1))]]
    for (const f of pick) {
      if (!f || f.on) continue
      f.on = true
      f.t = 0
      f.hurt = 0
      f.mesh.visible = true
      f.mesh.position.y = -0.6
      this.w.vfx.rings.spawn(f.pos.x, f.pos.z, { from: ISLET_R, to: ISLET_R, dur: 1.4, color: new THREE.Color(0.3, 0.7, 1.0), width: 0.07, fill: 0.12, hold: true })
    }
    this.sub = 'flood'
    this.setState('special')
    this.emit('cast', 'threat', 0.8)
  }

  private startDive() {
    this.diveCd = this.phase === 2 ? rand(14, 17) : rand(11, 14)
    this.sub = 'dive'
    this.diveFrom.copy(this.pos)
    this.ringPoint(this.diveTo, 2.6)
    this.rippleT = 0
    this.setState('special')
    this.emit('splash', 'threat', 0.8)
  }

  private startMirror() {
    this.mirrorCd = rand(13, 16)
    const p = this.w.player.pos
    const a0 = Math.atan2(p.x - this.center.x, p.z - this.center.z)
    const spots = [-1.5, 0, 1.5].map((o) => new THREE.Vector3(this.center.x + Math.sin(a0 + o) * 6.6, 0, this.center.z + Math.cos(a0 + o) * 6.6))
    const real = Math.floor(Math.random() * 3)
    this.pos.copy(spots[real])
    let k = 0
    spots.forEach((s, i) => {
      if (i === real) return
      const f = this.fakes[k++]
      f.pos.copy(s)
      f.alive = true
      f.model.rig.root.visible = true
    })
    this.sub = 'mirror'
    this.volleyDone = false
    this.setState('special')
    this.emit('cast', 'magic', 1)
    for (const s of spots) this.w.vfx.rings.spawn(s.x, s.z, { from: 0.3, to: 3, dur: 0.6, color: WATER, width: 0.06 })
  }

  protected specialUpdate(dt: number): { clip: Clip | null; t: number } {
    const w = this.w
    const p = w.player
    switch (this.sub) {
      case 'rise': {
        const k = Math.min(1, this.st / 1.6)
        this.airY = UNDER + (FLOAT - UNDER) * smoothstep(0, 1, k)
        if (Math.random() < 0.7) this.splash(0.6)
        if (k >= 1) {
          this.sub = 'roar'
          this.st = 0
        }
        return { clip: this.clips.cast, t: k * 0.5 }
      }
      case 'roar': {
        if (this.st > 0.4 && this.st - dt <= 0.4) {
          this.emit('roar', 'threat', 1)
          w.shake(0.6)
          if (this.phase === 2) w.bossEvent('phase2')
        }
        if (this.st >= 1.8) this.endSpecial()
        return { clip: this.clips.whip, t: Math.min(0.5, this.st / 1.8) }
      }
      case 'whip': {
        const k = this.st / WHIP_WIND
        this.lineMat.opacity = this.whipDone ? Math.max(0, 0.6 - (this.st - WHIP_WIND) * 3) : 0.12 + 0.35 * smoothstep(0, 1, k) + Math.sin(this.st * 20) * 0.04
        this.model.combMat.color.setRGB(2.4 + k * 2, 1.7 + k * 1.4, 0.5 + k * 0.4)
        if (!this.whipDone && this.st >= WHIP_WIND) {
          this.whipDone = true
          this.strikeWhip()
        }
        if (this.st >= WHIP_WIND + 0.6) {
          this.lines.visible = false
          this.endSpecial()
        }
        return { clip: this.clips.whip, t: Math.min(1, (this.st / (WHIP_WIND + 0.6)) * 1.0) }
      }
      case 'flood': {
        if (this.st >= 1.0) this.endSpecial()
        return { clip: this.clips.cast, t: this.st / 1.0 }
      }
      case 'dive': {
        if (this.st < 0.6) {
          this.airY = FLOAT + (UNDER - FLOAT) * smoothstep(0, 0.6, this.st)
          if (Math.random() < 0.6) this.splash(0.4)
          return { clip: this.clips.cast, t: 0.2 }
        }
        if (!this.hidden) {
          this.hidden = true
          this.atk = null
        }
        const k = Math.min(1, (this.st - 0.6) / 2.4)
        this.pos.lerpVectors(this.diveFrom, this.diveTo, smoothstep(0, 1, k))
        this.rippleT -= dt
        if (this.rippleT <= 0) {
          this.rippleT = 0.28
          w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 0.4, to: 2.2, dur: 0.7, color: new THREE.Color(0.25, 0.5, 0.7), width: 0.04 })
          w.sound('splash', this.pos, { tone: 'threat', strength: 0.7, id: 'su-dive', vol: 0.4 })
        }
        if (k >= 1) {
          this.sub = 'burst'
          this.st = 0
          this.struck = false
          w.vfx.rings.spawn(this.pos.x, this.pos.z, { from: 3.2, to: 3.2, dur: 0.7, color: new THREE.Color(1.2, 0.25, 0.08), width: 0.06, fill: 0.18, hold: true })
        }
        return { clip: this.clips.cast, t: 0.2 }
      }
      case 'burst': {
        if (this.st >= 0.7 && !this.struck) {
          this.struck = true
          this.hidden = false
          this.airY = FLOAT
          w.sound('boom', this.pos, { indicate: false, vol: 0.7 })
          w.shake(0.8)
          this.splash(40)
          if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 3.2 + p.radius) {
            const r = p.takeHit({ dmg: 22, x: this.pos.x, z: this.pos.z, knock: 10, heavy: true, unblockable: true })
            if (r === 'perfect') w.perfectDodge()
          }
        }
        if (this.st >= 1.4) this.endSpecial()
        return { clip: this.clips.whip, t: Math.min(1, this.st / 1.4) }
      }
      case 'frozen': {
        const k = Math.min(1, this.st / 0.3)
        this.ice.scale.setScalar(Math.max(0.1, k))
        if (this.st >= FROZEN_T) {
          // the ice cracks and she tears free
          this.ice.visible = false
          w.sound('crack', this.pos, { indicate: false })
          for (let i = 0; i < 50; i++) w.vfx.add.spawn({ x: this.pos.x + rand(-3, 3), y: 0.1, z: this.pos.z + rand(-3, 3), vx: rand(-2, 2), vy: rand(1, 4), vz: rand(-2, 2), r: 0.8, g: 1.1, b: 1.3, size: 0.06, life: 0.7, drag: 1, gravity: 9 })
          this.airY = FLOAT
          this.endSpecial()
        }
        return { clip: this.clips.frozen, t: (this.st * 0.7) % 1 }
      }
      case 'mirror': {
        this.faceTo(p.pos.x, p.pos.z, 6, dt)
        // only the true one's comb shines in the black water under her
        this.combGlint.visible = true
        this.combGlint.position.set(this.pos.x + 0.6, -0.09, this.pos.z + 0.6)
        ;(this.combGlint.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.st * 8) * 0.25
        for (const f of this.fakes) {
          if (!f.alive) continue
          f.model.rig.root.position.set(f.pos.x, FLOAT, f.pos.z)
          f.model.rig.root.rotation.y = Math.atan2(p.pos.x - f.pos.x, p.pos.z - f.pos.z)
          f.model.rig.update(dt, { speed: 0, clip: this.clips.cast, t: Math.min(0.6, this.st / MIRROR_WIND), time: w.time })
          f.model.columnMat.uniforms.uTime.value = w.time
          // the false combs are dull
          f.model.combMat.color.setRGB(0.4, 0.32, 0.15)
        }
        if (!this.volleyDone && this.st >= MIRROR_WIND) {
          this.volleyDone = true
          const from = [this.pos, ...this.fakes.filter((f) => f.alive).map((f) => f.pos)]
          for (const s of from) {
            const base = Math.atan2(p.pos.x - s.x, p.pos.z - s.z)
            for (const o of [-0.22, 0, 0.22]) {
              const dir = new THREE.Vector3(Math.sin(base + o), 0, Math.cos(base + o))
              w.projectiles.spawnSpear(new THREE.Vector3(s.x + dir.x * 1.2, 1.2, s.z + dir.z * 1.2), dir)
            }
          }
          this.emit('splash', 'threat', 1)
        }
        if (this.st >= MIRROR_WIND + 0.7) {
          for (const f of this.fakes) this.hideFake(f, true)
          this.combGlint.visible = false
          this.endSpecial()
        }
        return { clip: this.clips.cast, t: Math.min(0.6, this.st / MIRROR_WIND) }
      }
    }
    return { clip: null, t: 0 }
  }

  private endSpecial() {
    this.sub = 'none'
    this.setState('chase')
  }

  private strikeWhip() {
    const w = this.w
    const p = w.player
    const ax = Math.sin(this.whipDir)
    const az = Math.cos(this.whipDir)
    w.sound('swing_heavy', this.whipAt, { indicate: false })
    w.sound('splash', this.whipAt, { indicate: false })
    w.shake(0.5)
    // water bursts up along both braids
    for (let k = -10; k <= 10; k += 1.2)
      for (const [dx, dz] of [
        [ax, az],
        [az, -ax],
      ]) {
        const x = this.whipAt.x + dx * k
        const z = this.whipAt.z + dz * k
        for (let i = 0; i < 2; i++) w.vfx.add.spawn({ x: x + rand(-0.3, 0.3), y: 0.1, z: z + rand(-0.3, 0.3), vx: rand(-0.6, 0.6), vy: rand(2, 4.5), vz: rand(-0.6, 0.6), r: 0.35, g: 0.7, b: 0.95, a: 0.8, size: 0.07, life: 0.6, drag: 1, gravity: 9 })
      }
    const rx = p.pos.x - this.whipAt.x
    const rz = p.pos.z - this.whipAt.z
    const off1 = Math.abs(rx * az - rz * ax)
    const off2 = Math.abs(rx * ax + rz * az)
    const along1 = Math.abs(rx * ax + rz * az)
    const along2 = Math.abs(rx * az - rz * ax)
    const hit = (off1 < 0.95 + p.radius && along1 < 11) || (off2 < 0.95 + p.radius && along2 < 11)
    if (!hit || p.airY > 1) return
    const r = p.takeHit({ dmg: 20, x: this.pos.x, z: this.pos.z, knock: 6 })
    if (r === 'parry') this.parried()
    else if (r === 'perfect') w.perfectDodge()
  }

  private splash(n: number) {
    const count = n < 1 ? (Math.random() < n ? 1 : 0) : n
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const r = rand(0.4, 1.2)
      this.w.vfx.add.spawn({ x: this.pos.x + Math.cos(a) * r, y: 0, z: this.pos.z + Math.sin(a) * r, vx: Math.cos(a) * 1.5, vy: rand(2, 5), vz: Math.sin(a) * 1.5, r: 0.35, g: 0.7, b: 0.95, a: 0.8, size: 0.08, life: 0.8, drag: 0.8, gravity: 9 })
    }
  }

  private updateFloods(dt: number) {
    const p = this.w.player
    for (const f of this.floods) {
      if (!f.on) continue
      f.t += dt
      const t = f.t
      if (t < 1.4) {
        if (Math.random() < dt * 30) this.w.vfx.add.spawn({ x: f.pos.x + rand(-ISLET_R, ISLET_R) * 0.7, y: 0.05, z: f.pos.z + rand(-ISLET_R, ISLET_R) * 0.7, vy: rand(0.5, 1.5), r: 0.3, g: 0.6, b: 0.85, a: 0.7, size: 0.06, life: 0.5, drag: 1, gravity: 3 })
      } else if (t < 2.0) f.mesh.position.y = -0.6 + 0.95 * smoothstep(1.4, 2.0, t)
      else if (t < 7.5) {
        f.mesh.position.y = 0.35 + Math.sin(t * 2) * 0.03
        // water to the waist: the step drags, the vessel's slots fill with silt, the cold bites
        if (Math.hypot(p.pos.x - f.pos.x, p.pos.z - f.pos.z) < ISLET_R && p.alive) {
          p.mire = 1
          p.clog(0.6)
          f.hurt += dt
          if (f.hurt > 0.5) {
            f.hurt = 0
            p.directDamage(3)
          }
        }
      } else if (t < 8.3) f.mesh.position.y = 0.35 - 0.95 * smoothstep(7.5, 8.3, t)
      else {
        f.on = false
        f.mesh.visible = false
      }
    }
  }

  update(dt: number) {
    if (this.state === 'dormant') {
      this.rig.update(dt, { speed: 0, clip: this.clips.cast, t: 0, time: this.w.time })
      this.syncRig()
      this.updateVisibility(dt)
      return
    }
    super.update(dt)
    this.model.columnMat.uniforms.uTime.value = this.w.time
    if (this.sub !== 'whip') this.model.combMat.color.setRGB(2.4, 1.7, 0.5)
    // a stagger or a stun cuts whatever she was doing
    if (this.state !== 'special' && this.sub !== 'none') {
      this.lines.visible = false
      if (this.sub === 'mirror') {
        for (const f of this.fakes) this.hideFake(f, true)
        this.combGlint.visible = false
      }
      if (this.sub === 'frozen') {
        this.ice.visible = false
        this.airY = FLOAT
      }
      this.hidden = false
      this.sub = 'none'
    }
    if (this.alive && this.sub !== 'dive' && this.sub !== 'frozen' && this.sub !== 'rise' && this.sub !== 'burst') this.airY = FLOAT + Math.sin(this.w.time * 1.3) * 0.05
    if (!this.alive) {
      this.airY -= dt * 0.6
      this.lines.visible = false
      this.ice.visible = false
      for (const f of this.fakes) this.hideFake(f, false)
    }
    this.updateFloods(dt)
  }
}
