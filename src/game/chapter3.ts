// Chapter 3 «Чрево Горы» (docs/LEVELS.md, docs/DIALOGUES.md, docs/STORY.md): the cave of Shulgan-Tash and the summit.

import * as THREE from 'three'
import type { Director } from './director'
import type { Game, Interaction, Say } from './Game'
import type { Barrier } from './level/build'
import type { Icicle } from './level/extras'
import type { BossEvent } from './world'
import type { EndingId } from './core/store'
import { createAisylu, createAlbasty, createArslan, fresnelMat, NPC_CLIPS } from './actors/models2'
import type { Humanoid } from './actors/rig'
import { HERO_CLIPS } from './actors/models'
import { CH3_ARSLAN, CH3_COLLAPSE, CH3_CONFRONT, CH3_OPENING, CH3_SACRIFICE, CH3_TRIGGERS, FINAL, SHULGEN_DEFEAT, SHULGEN_FIGHT, SHULGEN_PHASE2 } from './script'
import { CELL } from './level/map'
import { SUMMIT_ROW } from './level/map3'
import type { LightSource } from './render/lights'
import { std } from './render/materials'
import { lerp, rand } from './util'

const say = (s: Say) => (typeof s === 'string' ? { line: s } : { line: s.text, who: s.who })
const BLUE = new THREE.Color(0.35, 0.62, 1.0)

export class Chapter3 implements Director {
  private g: Game
  private collapsed = false
  private met = false
  private given = false
  private arslan: Humanoid | null = null
  private arslanMat: THREE.ShaderMaterial
  private arslanFade = 0
  private aisylu: Humanoid | null = null
  private albasty: Humanoid | null = null
  private confronted = false
  private flareT = 0
  private flareLight: LightSource
  private sonLight: LightSource | null = null
  /** the blood sense: distances (in cells) to the bowl of the spring */
  private toSpring: Float32Array
  private senseT = 0
  private drinkSaid = false
  private finalReady = false
  private ended = false
  private dawnGoal = 0

  constructor(g: Game) {
    this.g = g
    this.arslanMat = fresnelMat(new THREE.Color(0.45, 0.65, 1.1), { opacity: 0, depthTest: false, power: 1.8, base: 0.25 })
    this.flareLight = g.lighting.add({ pos: new THREE.Vector3(), color: new THREE.Color(1, 0.85, 0.6), intensity: 0, distance: 18, flicker: 0.4, on: false })
    this.toSpring = this.distances(g.level.extras.basin ?? g.level.arenaCenter)
    // the people at the bowl: Aisylu lying by it, the Albasty standing over her
    const ex = g.level.extras
    if (ex.aisylu) {
      this.aisylu = createAisylu()
      this.aisylu.root.position.set(ex.aisylu.x, 0, ex.aisylu.z)
      this.aisylu.root.rotation.y = 0.6
      g.scene.add(this.aisylu.root)
      this.albasty = createAlbasty()
      this.albasty.root.position.set(ex.aisylu.x + 1.6, 0, ex.aisylu.z + 1.2)
      this.albasty.root.rotation.y = -2.2
      g.scene.add(this.albasty.root)
    }
  }

  /** BFS over the floor from the bowl: the blood follows it down to Aldar */
  private distances(goal: THREE.Vector3) {
    const L = this.g.levelData
    const d = new Float32Array(L.cols * L.rows).fill(Infinity)
    const start = Math.floor(goal.z / CELL) * L.cols + Math.floor(goal.x / CELL)
    // the bowl itself is a circle obstacle on floor cells: start from the nearest floor cell
    const q: number[] = []
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const i = start + dr * L.cols + dc
        if (i >= 0 && i < d.length && L.walk[i]) {
          d[i] = 0
          q.push(i)
        }
      }
    for (let h = 0; h < q.length; h++) {
      const cur = q[h]
      const r = Math.floor(cur / L.cols)
      const c = cur - r * L.cols
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc
        const nr = r + dr
        if (nc < 0 || nr < 0 || nc >= L.cols || nr >= L.rows) continue
        const ni = nr * L.cols + nc
        if (!L.walk[ni] || d[ni] <= d[cur] + 1) continue
        d[ni] = d[cur] + 1
        q.push(ni)
      }
    }
    return d
  }

  // ------------------------------------------------------------------ the opening

  begin() {
    const g = this.g
    const p = g.player.pos
    const t1 = g.level.triggers.find((t) => t.id === '1')
    if (t1) t1.fired = true
    g.playScene(
      [
        { cam: { x: p.x, z: p.z - 10, dist: 34, snap: true }, dur: 4.2, ...say(CH3_OPENING[0]) },
        { ...g.lineShot(CH3_OPENING[1]), cam: { x: p.x, z: p.z, dist: 18 } },
        { cam: null, dur: 0.8 },
      ],
      undefined,
      false,
    )
  }

  trigger(id: string) {
    const g = this.g
    if (id === '2') {
      this.collapse()
      return true
    }
    if (id === '6') {
      this.confront()
      return true
    }
    const beat = CH3_TRIGGERS[id]
    if (beat) g.beat(beat)
    return !!beat
  }

  // ------------------------------------------------------------------ TRG_CH3_AZAMAT_COLLAPSE

  private collapse() {
    const g = this.g
    if (this.collapsed) return
    this.collapsed = true
    g.player.vesselTint = BLUE.clone()
    const s = g.son
    if (s) s.state = 'kneel'
    const sp = s?.pos ?? g.player.pos
    g.playScene(
      [
        { cam: { x: sp.x, z: sp.z, dist: 13 }, dur: 3.6, ...say(CH3_COLLAPSE[0]) },
        g.lineShot(CH3_COLLAPSE[1]),
        g.lineShot(CH3_COLLAPSE[2]),
        { cam: null, dur: 0.6 },
      ],
      () => {
        if (s) s.state = 'stagger'
        this.showArslan()
        g.hintQueue.push('Азамат еле идёт. Ищи помощи в глубине пещеры, у подземной реки.')
      },
    )
  }

  /** the Shadow of Arslan rises by the underground river */
  private showArslan() {
    const g = this.g
    const at = g.level.extras.arslan
    if (!at || this.arslan) return
    this.arslan = createArslan(this.arslanMat)
    this.arslan.root.position.set(at.x, 0, at.z)
    this.arslan.root.traverse((o) => (o.castShadow = false))
    g.overlay.add(this.arslan.root)
    this.arslanFade = 0.01
    g.sound('whisper', at, { tone: 'magic', strength: 0.8, id: 'arslan', vol: 0.8 })
  }

  // ------------------------------------------------------------------ DLG_CH3_ARSLAN_MEETING → TRG_CH3_SUSAR_SACRIFICE

  private meet() {
    const g = this.g
    if (this.met || !this.arslan) return
    this.met = true
    const a = this.arslan.root.position
    const cam = { x: (a.x + g.player.pos.x) / 2, z: (a.z + g.player.pos.z) / 2 + 1, dist: 14 }
    g.playScene(
      [{ ...g.lineShot(CH3_ARSLAN[0]), cam }, g.lineShot(CH3_ARSLAN[1]), g.lineShot(CH3_ARSLAN[2]), g.lineShot(CH3_ARSLAN[3]), g.lineShot(CH3_ARSLAN[4])],
      () => {
        g.findClue('arslan', true)
        this.sacrifice()
      },
    )
  }

  private sacrifice() {
    const g = this.g
    const m = g.marten
    const s = g.son
    const a = this.arslan!.root.position
    const hearth = g.level.extras.fatherArrows ?? a
    const cf = g.level.coldFires[0]
    // Azamat is laid by Arslan's old fire pit, the marten goes to the shadow, then to the boy
    if (s) {
      s.pos.set(hearth.x - 0.4, 0, hearth.z - 0.9)
      s.state = 'kneel'
    }
    g.playScene(
      [
        { cam: { x: hearth.x, z: hearth.z, dist: 12 }, dur: 5.2, line: CH3_SACRIFICE.touch, run: () => this.susarGoes() },
        { ...g.lineShot(CH3_SACRIFICE.arslan) },
        { dur: 3.4, line: CH3_SACRIFICE.give, run: () => this.giveVessel() },
        g.lineShot(CH3_SACRIFICE.aldar),
        { cam: null, dur: 0.8 },
      ],
      () => {
        g.findClue('susar_gift', true)
        if (cf && !cf.lit) {
          cf.lit = true
          cf.light.on = true
          cf.flame.visible = true
          cf.coal.visible = true
        }
        if (cf) g.rest(cf.pos, new THREE.Vector3(cf.pos.x + 1.4, 0, cf.pos.z - 1.4))
        g.pickups.spawn(new THREE.Vector3(hearth.x + 0.6, 0, hearth.z + 0.4), { label: CH3_SACRIFICE.arrows, kind: 'quiver', arrows: 4 })
        g.hintQueue.push(CH3_SACRIFICE.hint)
        g.tutor.begin('sense', true)
        this.arslanFade = -1
      },
    )
    void m
  }

  /** the marten touches Arslan's palm, curls on Azamat's chest and scatters into golden dust */
  private susarGoes() {
    const g = this.g
    const m = g.marten
    const s = g.son
    if (m) {
      const at = s ? s.pos : m.pos
      for (let i = 0; i < 80; i++) g.vfx.add.spawn({ x: at.x + rand(-0.4, 0.4), y: rand(0.2, 1.2), z: at.z + rand(-0.4, 0.4), vx: rand(-0.6, 0.6), vy: rand(0.6, 2.2), vz: rand(-0.6, 0.6), r: 2.4, g: 1.7, b: 0.6, size: rand(0.04, 0.08), life: rand(1.5, 3), drag: 0.6 })
      g.vfx.rings.spawn(at.x, at.z, { from: 0.2, to: 4, dur: 1.4, color: new THREE.Color(2.2, 1.6, 0.6), width: 0.05 })
      g.scene.remove(m.rig.root)
      g.marten = null
    }
    g.sound('revive', s?.pos ?? g.player.pos, { indicate: false })
    if (s) s.state = 'stay'
  }

  /** Aldar unbuckles the vessel and hangs it over his son's shoulder: from here up, alone and without fire */
  private giveVessel() {
    const g = this.g
    g.kit.vesselGiven = true
    g.player.vesselTint = null
    const s = g.son
    if (s) {
      s.vessel.visible = true
      s.state = 'stay'
      this.sonLight = g.lighting.add({ pos: new THREE.Vector3(s.pos.x, 1, s.pos.z), color: new THREE.Color(1, 0.6, 0.28), intensity: 8, distance: 13, flicker: 0.6, on: true })
    }
    this.given = true
  }

  // ------------------------------------------------------------------ the summit

  private confront() {
    const g = this.g
    if (this.confronted) return
    this.confronted = true
    const c = g.level.extras.basin ?? g.level.arenaCenter
    g.playScene(
      [
        { cam: { x: c.x, z: c.z + 2, dist: 22 }, dur: 5.4, ...say(CH3_CONFRONT[0]) },
        { ...g.lineShot(CH3_CONFRONT[1]) },
        { ...g.lineShot(CH3_CONFRONT[2]), cam: { x: (c.x + g.player.pos.x) / 2, z: (c.z + g.player.pos.z) / 2, dist: 18 } },
        { cam: null, dur: 0.8 },
      ],
      () => g.hintQueue.push('За скальными воротами — чаша Йәншишмә.'),
    )
  }

  bossIntro() {
    const g = this.g
    const b = g.boss
    if (!b) return
    const c = g.level.arenaCenter
    g.playScene([{ cam: { x: c.x, z: c.z + 2, dist: 20 }, dur: 1.6, run: () => b.startFight() }, { dur: 1.2 }, { cam: null, dur: 0.6 }], () => g.hintQueue.push(...(SHULGEN_FIGHT.hints ?? [])))
  }

  bossEvent(ev: BossEvent) {
    const g = this.g
    if (ev === 'phase2') g.beat(SHULGEN_PHASE2)
    else if (ev === 'scar') g.flareScar()
    else if (ev === 'flare') {
      // the parry's sparks light the summit for 4 s (docs/COMBAT.md)
      this.flareT = 4
      const b = g.boss
      if (b) this.flareLight.pos.set(b.pos.x, 2.2, b.pos.z)
      this.flareLight.on = true
    } else if (ev === 'drink' && !this.drinkSaid) {
      this.drinkSaid = true
      g.hintQueue.unshift('Он пьёт из родника! Беркут [R] или стрела — выбей воду из руки.')
      g.hintT = 0
    }
  }

  onBossDefeated() {
    const g = this.g
    const b = g.boss
    const at = b ? b.pos.clone() : g.level.arenaCenter
    g.playScene(
      [
        { ...g.lineShot(SHULGEN_DEFEAT[0]), cam: { x: at.x, z: at.z + 1, dist: 14 }, run: () => g.slowmo(1.4, 0.4) },
        { dur: 4, ...say(SHULGEN_DEFEAT[1]) },
        { cam: null, dur: 0.6 },
      ],
      () => {
        this.finalReady = true
        g.victoryT = -1
        g.narrQueue.push(FINAL.albasty)
      },
    )
  }

  /** TRG_CH3_FINAL_CHOICE: the cut palm over the bowl, or the lips to it */
  ending(id: EndingId) {
    const g = this.g
    if (this.ended) return
    this.ended = true
    const c = g.level.extras.basin ?? g.level.arenaCenter
    const drink = id === 'shulgen'
    g.player.startInteract(() => {})
    const water = g.level.extras.basinWater
    const shots = [
      { cam: { x: c.x, z: c.z + 1, dist: 12 }, dur: 3.6, line: drink ? FINAL.drink : FINAL.give },
      {
        dur: 3.4,
        line: drink ? 'Серебро ушло в него до дна, и чаша опустела. Над горой не посветлело.' : id === 'life' ? 'Родник взял из рассечённой ладони только чужую воду. Над Иремелем посветлело.' : 'Родник забирал своё до самого дна. Над Иремелем посветлело.',
        run: () => {
          this.dawnGoal = drink ? 0 : 1
          if (water) water.uniforms.uLife.value = drink ? 0.15 : 1.6
          if (g.level.extras.basinLight) g.level.extras.basinLight.intensity = drink ? 3 : 26
        },
      },
      { dur: 2.6 },
    ]
    g.playScene(shots, () => g.showEnding(id))
  }

  // ------------------------------------------------------------------ arrows: the icicles over the way

  arrowProbe(pos: THREE.Vector3) {
    for (const ic of this.g.level.extras.icicles) {
      if (ic.fallen || Math.hypot(ic.pos.x - pos.x, ic.pos.z - pos.z) > 1.0) continue
      ic.fallen = true
      ic.t = 0
      this.g.sound('crack', ic.pos, { indicate: false })
      return true
    }
    return false
  }

  arrowLanded() {
    return null
  }

  private updateIcicles(dt: number) {
    const g = this.g
    for (const ic of g.level.extras.icicles) {
      if (!ic.fallen || ic.t >= 1) continue
      ic.t = Math.min(1, ic.t + dt / 0.38)
      ic.mesh.position.y = lerp(4.6, 0.3, ic.t * ic.t)
      if (ic.t >= 1) this.icicleLands(ic)
    }
  }

  private icicleLands(ic: Icicle) {
    const g = this.g
    g.sound('clang', ic.pos, { indicate: false })
    g.sound('crack', ic.pos, { indicate: false })
    g.shake(0.5)
    ic.mesh.visible = false
    for (let i = 0; i < 60; i++) g.vfx.add.spawn({ x: ic.pos.x + rand(-0.6, 0.6), y: 0.3, z: ic.pos.z + rand(-0.6, 0.6), vx: rand(-5, 5), vy: rand(1, 5), vz: rand(-5, 5), r: 0.75, g: 0.95, b: 1.2, size: rand(0.04, 0.09), life: rand(0.5, 1), drag: 1, gravity: 10 })
    g.vfx.rings.spawn(ic.pos.x, ic.pos.z, { from: 0.3, to: 2.6, dur: 0.4, color: new THREE.Color(0.7, 1, 1.3), width: 0.08 })
    for (const e of g.enemies) {
      if (!e.alive || e.hidden || e.kind === 'boss') continue
      if (Math.hypot(e.pos.x - ic.pos.x, e.pos.z - ic.pos.z) > 2.4 + e.radius) continue
      e.takeHit(130, 80, ic.pos.x, ic.pos.z, 6, true, 'melee')
    }
    const p = g.player
    if (Math.hypot(p.pos.x - ic.pos.x, p.pos.z - ic.pos.z) < 2.2 + p.radius) p.takeHit({ dmg: 18, x: ic.pos.x, z: ic.pos.z, knock: 6, unblockable: true })
  }

  // ------------------------------------------------------------------ [E]

  interaction(): Interaction | null {
    const g = this.g
    const p = g.player.pos
    const c = g.level.extras.basin
    if (c && this.finalReady && !this.ended && c.distanceTo(p) < 4.2) return { label: FINAL.prompt, run: () => g.openFinal() }
    return null
  }

  barrier(b: Barrier) {
    void b
    return null
  }

  kurai() {}

  respawn() {
    const s = this.g.son
    if (this.given && s) {
      const hearth = this.g.level.extras.fatherArrows
      if (hearth) s.pos.set(hearth.x - 0.4, 0, hearth.z - 0.9)
      s.state = 'stay'
    }
  }

  // ------------------------------------------------------------------ every frame

  update(dt: number) {
    const g = this.g
    const p = g.player
    const summit = p.pos.z / CELL < SUMMIT_ROW
    // inside the mountain there is no moon; up on Iremel the sky opens
    const moonGoal = summit ? 1 : 0.12
    g.moonScale += (moonGoal - g.moonScale) * (1 - Math.exp(-1.5 * dt))
    g.lighting.hemi.intensity = lerp(0.2, 0.45, g.moonScale)
    g.nightEyes = this.given && !summit ? 0.8 : 1
    // the shadow of Arslan fades in by the river, and out once the marten has gone with him
    if (this.arslan) {
      if (this.arslanFade > 0) this.arslanFade = Math.min(1, this.arslanFade + dt * 0.5)
      else if (this.arslanFade < 0) this.arslanFade = Math.max(-1, this.arslanFade - dt * 0.4)
      const k = this.arslanFade > 0 ? this.arslanFade : 1 + this.arslanFade
      this.arslanMat.uniforms.uOpacity.value = Math.max(0, k) * (0.85 + Math.sin(g.time * 3) * 0.1)
      this.arslanMat.uniforms.uTime.value = g.time
      const r = this.arslan
      r.root.rotation.y = Math.atan2(p.pos.x - r.root.position.x, p.pos.z - r.root.position.z)
      r.update(dt, { speed: 0, time: g.time })
      if (this.arslanFade <= -1) {
        g.overlay.remove(r.root)
        this.arslan = null
      }
      if (this.collapsed && !this.met && r.root.position.distanceTo(p.pos) < 7.5 && !g.inScene) this.meet()
    }
    // the fire stays with Azamat by the river
    const s = g.son
    if (s && this.sonLight) this.sonLight.pos.set(s.pos.x, 1, s.pos.z)
    // the parry's flare
    g.extraVis.length = 0
    if (this.flareT > 0) {
      this.flareT -= dt
      const k = Math.min(1, this.flareT / 1.2)
      this.flareLight.intensity = 22 * k
      if (this.flareT <= 0) this.flareLight.on = false
      const at = g.level.arenaCenter
      g.extraVis.push({ x: at.x, z: at.z, full: 9 * k, fade: 13 * k, level: k })
    }
    this.updateSense(dt)
    this.updateIcicles(dt)
    // the people at the bowl
    if (this.aisylu) this.aisylu.update(dt, { speed: 0, clip: NPC_CLIPS.lie, t: 0.5, time: g.time })
    if (this.albasty) this.albasty.update(dt, { speed: 0, clip: this.finalReady ? NPC_CLIPS.reach : null, t: 0.35, time: g.time })
    // dawn after the debt is returned
    g.dawn += (this.dawnGoal - g.dawn) * (1 - Math.exp(-0.5 * dt))
    void HERO_CLIPS
    void std
  }

  /** «тропу к роднику моя кровь теперь чует сама»: silver sparks run up the way and light it a little */
  private updateSense(dt: number) {
    const g = this.g
    const p = g.player
    if (!p.bloodSense) return
    g.tutor.tally.sense += dt
    const L = g.levelData
    const strength = Math.min(1.4, 0.7 + 0.15 * g.kit.waterDebt)
    let c = Math.floor(p.pos.x / CELL)
    let r = Math.floor(p.pos.z / CELL)
    const pts: THREE.Vector3[] = []
    for (let k = 0; k < 9; k++) {
      const cur = r * L.cols + c
      let best = this.toSpring[cur]
      let bc = c
      let br = r
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = (r + dr) * L.cols + c + dc
        if (this.toSpring[ni] < best) {
          best = this.toSpring[ni]
          bc = c + dc
          br = r + dr
        }
      }
      if (bc === c && br === r) break
      c = bc
      r = br
      pts.push(new THREE.Vector3((c + 0.5) * CELL, 0, (r + 0.5) * CELL))
    }
    pts.forEach((v, i) => {
      if (i < 5) g.extraVis.push({ x: v.x, z: v.z, full: 1.1 * strength, fade: 2.2 * strength, level: 0.8 })
    })
    this.senseT -= dt
    if (this.senseT > 0) return
    this.senseT = 0.05
    const v = pts[Math.floor(Math.random() * pts.length)]
    if (v) g.vfx.add.spawn({ x: v.x + rand(-0.6, 0.6), y: 0.15, z: v.z + rand(-0.6, 0.6), vx: rand(-0.2, 0.2), vy: rand(0.3, 0.9), vz: rand(-0.2, 0.2), r: 1.5, g: 1.9, b: 2.4, size: 0.05, life: 1.2, drag: 1 })
  }
}
