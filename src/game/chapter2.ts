// Chapter 2 «Курганы у Чёрных вод» (docs/LEVELS.md, docs/DIALOGUES.md): the script on top of the shared game.

import * as THREE from 'three'
import type { Director } from './director'
import type { Game, Interaction, Say, Shot } from './Game'
import type { Barrier } from './level/build'
import type { EchoStone, FireBowl } from './level/extras'
import type { BossEvent } from './world'
import { hud } from './core/store'
import { SuInahi } from './actors/suinahi'
import { createAisylu, createAlbasty, createArslan, createMother, fresnelMat } from './actors/models2'
import type { Humanoid } from './actors/rig'
import { HERO_CLIPS } from './actors/models'
import { CH2_ALBASTY, CH2_BRIDGE, CH2_CAVE, CH2_KURGAN_ECHO, CH2_MELODY, CH2_MIRROR, CH2_OPENING, CH2_SANCTUARY, CH2_TRIGGERS, SU_DEFEAT, SU_INTRO, SU_PHASE2 } from './script'
import { CELL } from './level/map'
import { rand } from './util'

/** the order the bowls must burn in (indices into the bowls north to south), sung by the second balbal */
const MELODY = [2, 0, 3, 1]
const NOTE_T = 0.8
const TEAL = new THREE.Color(0.35, 1.9, 1.8)

const say = (s: Say) => (typeof s === 'string' ? { line: s } : { line: s.text, who: s.who })

export class Chapter2 implements Director {
  private g: Game
  private bowls: FireBowl[]
  private lit: number[] = []
  private solved = false
  private melody: { i: number; t: number } | null = null
  private melodyHeard = false
  private mirrorOn = false
  private reflArslan: Humanoid | null = null
  private reflMother: Humanoid | null = null
  private reflMat: THREE.ShaderMaterial | null = null
  private silhouettes: { rigs: Humanoid[]; t: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null
  private altarSaid = false
  private nearStoneSaid = new Set<EchoStone>()
  private kuraiLesson = false
  /** a wrong bowl: seconds until every bowl goes out */
  private douseT = -1

  constructor(g: Game) {
    this.g = g
    // the bowls north to south: the melody names them in that order
    this.bowls = [...g.level.extras.bowls].sort((a, b) => a.pos.z - b.pos.z)
  }

  // ------------------------------------------------------------------ the opening

  begin() {
    const g = this.g
    const p = g.player.pos
    const t1 = g.level.triggers.find((t) => t.id === '1')
    if (t1) t1.fired = true
    g.playScene(
      [
        { cam: { x: p.x, z: p.z - 22, dist: 48, snap: true }, dur: 3.8, ...say(CH2_OPENING[0]) },
        { cam: { x: p.x, z: p.z - 4, dist: 22 }, dur: 2.8, ...say(CH2_OPENING[1]) },
        { ...g.lineShot(CH2_OPENING[2]) },
        { cam: null, dur: 0.8 },
      ],
      () => g.hintQueue.push('Азамат держится за левым плечом, под щитом. Его не нужно защищать: он сам уходит от ударов.'),
      true,
    )
  }

  // ------------------------------------------------------------------ triggers

  trigger(id: string, pos: THREE.Vector3) {
    const g = this.g
    void pos
    if (id === '6') {
      this.albastyScene()
      return true
    }
    if (id === 'F') {
      this.mirrorScene()
      return true
    }
    const beat = CH2_TRIGGERS[id]
    if (beat) g.beat(beat)
    if (id === '2' || id === '3') this.beginKuraiLesson()
    return !!beat
  }

  private beginKuraiLesson() {
    if (this.kuraiLesson) return
    this.kuraiLesson = true
    this.g.tutor.begin('kurai', true)
  }

  // ------------------------------------------------------------------ Azamat's kurai at the old stones

  kurai() {
    const g = this.g
    const p = g.player.pos
    for (const s of g.level.extras.echoes) {
      if (s.pos.distanceTo(p) > 7.5) continue
      s.glow.color.setRGB(0.6, 2.6, 2.5)
      g.vfx.rings.spawn(s.pos.x, s.pos.z, { from: 0.3, to: 3, dur: 0.7, color: TEAL, width: 0.06 })
      if (s.kind === 'echo') this.kurganEcho(s)
      else this.playMelody(s)
    }
  }

  /** DLG_CH2_KURGAN_ECHO: thirty winters ago a rider with the water galloped past this stone */
  private kurganEcho(s: EchoStone) {
    const g = this.g
    if (s.heard) return
    s.heard = true
    const at = new THREE.Vector3(s.pos.x + 6, 0, s.pos.z - 7)
    g.echo.play(at, [
      { to: new THREE.Vector3(s.pos.x + 1.6, 0, s.pos.z - 1.2), dur: 1.3 },
      { clip: HERO_CLIPS.interact, dur: 0.9, whisper: true },
      { to: new THREE.Vector3(s.pos.x - 5, 0, s.pos.z + 7), dur: 1.5 },
    ])
    g.playScene(
      [
        { ...g.lineShot(CH2_KURGAN_ECHO[0]), cam: { x: s.pos.x, z: s.pos.z, dist: 15 } },
        g.lineShot(CH2_KURGAN_ECHO[1]),
        g.lineShot(CH2_KURGAN_ECHO[2]),
        { cam: null, dur: 0.6 },
      ],
      () => g.findClue('kurgan_echo', true),
      false,
    )
  }

  /** the balbal of the song: the signs on the pillars flare one after another in the order of the bowls */
  private playMelody(s: EchoStone) {
    const g = this.g
    if (this.solved) return
    this.melody = { i: -1, t: 0 }
    if (!s.heard) {
      s.heard = true
      g.narrQueue.push(CH2_MELODY.heard)
      g.hintQueue.unshift(CH2_MELODY.hint)
      g.hintT = 0
      g.tutor.begin('bow')
    }
    this.melodyHeard = true
  }

  private updateMelody(dt: number) {
    const m = this.melody
    for (const b of this.bowls) b.sign.color.multiplyScalar(Math.exp(-3 * dt))
    for (const s of this.g.level.extras.echoes) s.glow.color.lerp(new THREE.Color(0.12, 0.45, 0.45), 1 - Math.exp(-1.5 * dt))
    if (!m) return
    m.t -= dt
    if (m.t > 0) return
    m.i++
    if (m.i >= MELODY.length) {
      this.melody = null
      return
    }
    m.t = NOTE_T
    const b = this.bowls[MELODY[m.i]]
    if (!b) return
    b.sign.color.setRGB(0.6, 3, 2.8)
    this.g.audio.note(m.i * 2, false)
    this.g.vfx.rings.spawn(b.pos.x, b.pos.z, { from: 0.2, to: 1.6, dur: 0.5, color: TEAL, width: 0.05 })
    for (let i = 0; i < 12; i++) this.g.vfx.add.spawn({ x: b.pos.x, y: 1.9, z: b.pos.z, vx: rand(-1, 1), vy: rand(0.4, 1.4), vz: rand(-1, 1), r: 0.4, g: 2, b: 1.9, size: 0.05, life: 0.8, drag: 1 })
  }

  // ------------------------------------------------------------------ the bowls (TRG_CH2_BRAZIER_SHOT)

  private setBowl(b: FireBowl, lit: boolean) {
    const g = this.g
    b.lit = lit
    b.light.on = lit
    b.flame.visible = lit
    b.coal.visible = lit
    g.sound(lit ? 'ignite' : 'douse', b.pos, { indicate: false })
    if (lit) for (let i = 0; i < 30; i++) g.vfx.add.spawn({ x: b.pos.x, y: b.pos.y + 0.2, z: b.pos.z, vx: rand(-1.5, 1.5), vy: rand(1, 4), vz: rand(-1.5, 1.5), r: 2.4, g: 1, b: 0.3, size: 0.07, life: 0.9, drag: 1.5 })
    else for (let i = 0; i < 12; i++) g.vfx.soft.spawn({ x: b.pos.x, y: b.pos.y + 0.3, z: b.pos.z, vy: rand(0.5, 1.5), r: 0.08, g: 0.08, b: 0.08, a: 0.5, size: 0.7, life: 1.6, grow: 2 })
  }

  arrowLanded(pos: THREE.Vector3, fire: boolean): 'keep' | 'break' | 'burn' | null {
    const g = this.g
    const i = this.bowls.findIndex((b) => Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) < 1.3)
    if (i < 0) return null
    const b = this.bowls[i]
    if (!fire) {
      g.toast(b.lit ? 'Чаша уже горит' : 'Смолу зажжёт только огненная стрела', 'warn', 'flame')
      return 'break'
    }
    if (this.solved) return 'burn'
    if (b.lit && this.douseT < 0) return 'burn'
    this.setBowl(b, true)
    if (MELODY[this.lit.length] === i) {
      this.lit.push(i)
      g.toast(`Чаша горит · ${this.lit.length} из ${MELODY.length}`, 'info', 'flame')
      if (this.lit.length === MELODY.length) this.solve()
    } else {
      // the wrong bowl: the fire runs from bowl to bowl and goes out in all of them at once
      this.douseT = 0.7
      this.lit = []
      g.narrQueue.push(CH2_MELODY.wrong)
      g.hintQueue.unshift(this.melodyHeard ? CH2_MELODY.again : CH2_MELODY.near)
      g.hintT = 0
    }
    return 'burn'
  }

  private solve() {
    const g = this.g
    this.solved = true
    g.narrQueue.push(CH2_MELODY.right)
    g.sound('perfect', null, { indicate: false })
    const veil = g.level.barriers.find((b) => b.kind === 'veil')
    if (veil) {
      g.playScene([{ cam: { x: veil.center.x, z: veil.center.z, dist: 18 }, dur: 2.4, run: () => g.openBarrier(veil) }, { cam: null, dur: 0.8 }], undefined, false)
    }
  }

  arrowProbe(pos: THREE.Vector3, fire: boolean) {
    void fire
    const g = this.g
    // the drawbridge's rope
    const r = g.level.extras.rope
    if (r && !r.cut) {
      const ax = r.b.x - r.a.x
      const az = r.b.z - r.a.z
      const l2 = ax * ax + az * az || 1
      const t = Math.max(0, Math.min(1, ((pos.x - r.a.x) * ax + (pos.z - r.a.z) * az) / l2))
      const d = Math.hypot(pos.x - (r.a.x + ax * t), pos.z - (r.a.z + az * t))
      if (d < 0.7) {
        r.cut = true
        r.mesh.visible = false
        g.sound('crack', r.a, { indicate: false })
        const bridge = g.level.barriers.find((b) => b.kind === 'bridge')
        if (bridge) g.openBarrier(bridge)
        g.narrQueue.push(CH2_BRIDGE)
        return true
      }
    }
    // a false figure of the mirror haze
    const b = g.boss
    if (b instanceof SuInahi && b.probeFake(pos)) return true
    return false
  }

  // ------------------------------------------------------------------ [E]

  interaction(): Interaction | null {
    const g = this.g
    const p = g.player.pos
    const ex = g.level.extras
    for (const s of ex.echoes) {
      if (s.pos.distanceTo(p) > 2.6) continue
      if (s.kind === 'melody' && this.solved) continue
      if (s.kind === 'echo' && s.heard) continue
      if (!this.nearStoneSaid.has(s) && s.kind === 'melody') {
        this.nearStoneSaid.add(s)
        g.hintQueue.unshift(CH2_MELODY.near)
        g.hintT = 0
      }
      return { label: 'Азамат сыграет камню на курае', key: 'Q', run: () => g.playKurai() }
    }
    if (ex.exit && ex.exit.distanceTo(p) < 3.2) {
      const b = g.boss
      if (b && b.alive) return { label: 'Хозяйка переправы не пустит к горе', key: '' }
      return { label: CH2_CAVE.go, run: () => this.enterCave() }
    }
    return null
  }

  barrier(b: Barrier) {
    if (b.kind === 'veil') return { thought: 'Завеса духов. Холодная, как вода подо льдом. Её не пройти, пока камни молчат.', label: 'Завеса духов: зажги чаши за водой по песне балбала' }
    if (b.kind === 'bridge') return { thought: 'Мосток поднят. Верёвка тянется к столбу на острове.', label: 'Мосток поднят: перебей верёвку стрелой' }
    return null
  }

  // ------------------------------------------------------------------ zone 5: the albasty over the water

  private albastyScene() {
    const g = this.g
    const mat = fresnelMat(new THREE.Color(0.75, 0.8, 0.9), { opacity: 0.85, depthTest: false })
    const from = new THREE.Vector3(48 * CELL, 0, 49 * CELL)
    const to = new THREE.Vector3(56 * CELL, 0, 37 * CELL)
    const alb = createAlbasty(mat)
    const ais = createAisylu(fresnelMat(new THREE.Color(1.0, 0.75, 0.6), { opacity: 0.8, depthTest: false }))
    for (const r of [alb, ais]) {
      r.root.traverse((o) => (o.castShadow = false))
      g.overlay.add(r.root)
    }
    this.silhouettes = { rigs: [alb, ais], t: 0, from, to }
    const mid = from.clone().lerp(to, 0.35)
    g.playScene(
      [
        { cam: { x: mid.x - 6, z: mid.z + 4, dist: 30 }, dur: 4.4, ...say(CH2_ALBASTY[0]) },
        { ...g.lineShot(CH2_ALBASTY[1]) },
        { ...g.lineShot(CH2_ALBASTY[2]) },
        { dur: 2.6, ...say(CH2_ALBASTY[3]) },
        { cam: null, dur: 0.8 },
      ],
      () => {
        for (const r of this.silhouettes?.rigs ?? []) g.overlay.remove(r.root)
        this.silhouettes = null
      },
    )
  }

  private updateSilhouettes(dt: number) {
    const s = this.silhouettes
    if (!s) return
    s.t += dt
    const k = Math.min(1, s.t / 13)
    const dir = Math.atan2(s.to.x - s.from.x, s.to.z - s.from.z)
    s.rigs.forEach((r, i) => {
      // the Albasty glides first; Aisylu walks behind her, not looking back
      const p = s.from.clone().lerp(s.to, Math.max(0, k - i * 0.05))
      r.root.position.set(p.x, -0.1, p.z)
      r.root.rotation.y = dir
      r.update(dt, { speed: 1.3, forward: 1, time: this.g.time })
      r.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined
        if (m?.uniforms?.uOpacity) m.uniforms.uOpacity.value = Math.min(1, s.t / 1.5) * (1 - Math.max(0, (s.t - 11) / 2)) * 0.85
      })
    })
  }

  // ------------------------------------------------------------------ zone 6: the water shows the past (TRG_CH2_LAKE_MIRROR)

  private mirrorScene() {
    const g = this.g
    if (this.mirrorOn) return
    this.mirrorOn = true
    // the reflections: grey-haired Arslan instead of Aldar, the mother in her coral kashmau instead of the marten
    this.reflMat = fresnelMat(new THREE.Color(0.7, 0.85, 1.15), { opacity: 0.8, power: 1.4, base: 0.5, depthTest: false })
    const coral = fresnelMat(new THREE.Color(1.6, 0.45, 0.3), { opacity: 0.85, power: 1.2, base: 0.7, depthTest: false })
    this.reflArslan = createArslan(this.reflMat)
    this.reflMother = createMother(fresnelMat(new THREE.Color(1.1, 0.9, 0.85), { opacity: 0.8, power: 1.4, base: 0.5, depthTest: false }), coral)
    for (const r of [this.reflArslan, this.reflMother]) {
      r.root.scale.set(1, -1, 1)
      r.root.traverse((o) => {
        o.castShadow = false
        // drawn over the black water (and the bright shallows at the spit's edge): a ghost in the mirror, not a body under it
        o.renderOrder = 7
      })
      g.scene.add(r.root)
    }
    const lake = g.level.lake
    if (lake) lake.mat.uniforms.uClarity.value = 0.4
    this.updateReflections(0)
    const at = this.reflArslan.root.position
    g.playScene(
      [
        { cam: { x: (at.x + g.player.pos.x) / 2, z: (at.z + g.player.pos.z) / 2 + 1, dist: 14 }, dur: 1.8 },
        { ...g.lineShot(CH2_MIRROR[0]) },
        { ...g.lineShot(CH2_MIRROR[1]) },
        { dur: Math.max(3.4, (CH2_MIRROR[2] as string).length * 0.055), ...say(CH2_MIRROR[2]) },
        { cam: null, dur: 0.8 },
      ] as Shot[],
      () => g.findClue('mirror', true),
    )
  }

  /** where the reflection of something on the spit shows: on the open water beside it, toward the viewer */
  private waterBeside(x: number, z: number, out: THREE.Vector3) {
    const f = this.g.field
    for (let d = 1; d < 9; d += 0.5) {
      for (const sx of [1, -1]) {
        const px = x + sx * d
        if (f.isDeep(px, z) && f.isDeep(px + sx * 0.8, z)) return out.set(px + sx * 0.5, 0, z + 0.4)
      }
    }
    return null
  }

  private updateReflections(dt: number) {
    const g = this.g
    if (!this.mirrorOn || !this.reflArslan || !this.reflMother) return
    const p = g.player
    const onSpit = p.pos.z / CELL > 23 && p.pos.z / CELL < 45
    const lake = g.level.lake
    if (lake) lake.mat.uniforms.uClarity.value += ((onSpit ? 0.4 : 0.86) - lake.mat.uniforms.uClarity.value) * (1 - Math.exp(-2 * dt))
    const v = new THREE.Vector3()
    const show = (rig: Humanoid, x: number, z: number, facing: number, speed: number) => {
      const at = onSpit ? this.waterBeside(x, z, v) : null
      rig.root.visible = !!at
      if (!at) return
      rig.root.position.set(at.x, -0.24, at.z)
      rig.root.rotation.y = facing
      rig.update(dt, { speed, forward: 1, time: g.time })
    }
    show(this.reflArslan, p.pos.x, p.pos.z, p.facing, p.speedNow)
    const m = g.marten
    if (m) show(this.reflMother, m.pos.x, m.pos.z, m.facing, 1.4)
    else this.reflMother.root.visible = false
    if (this.reflMat) this.reflMat.uniforms.uTime.value = g.time
  }

  // ------------------------------------------------------------------ the crossing: Хыу инәһе

  bossIntro() {
    const g = this.g
    const b = g.boss
    if (!b) return
    const c = g.level.arenaCenter
    g.playScene(
      [
        { cam: { x: c.x, z: c.z + 3, dist: 24 }, dur: 1.6 },
        { dur: 2.2, run: () => b.startFight(), ...say(SU_INTRO.lines![0]) },
        g.lineShot(SU_INTRO.lines![1]),
        { cam: null, dur: 0.8 },
      ],
      () => g.hintQueue.push(...(SU_INTRO.hints ?? [])),
    )
  }

  bossEvent(ev: BossEvent) {
    if (ev === 'phase2') this.g.beat(SU_PHASE2)
  }

  onBossDefeated() {
    const g = this.g
    const c = g.level.arenaCenter
    const exit = g.level.extras.exit
    g.playScene(
      [
        { ...g.lineShot(SU_DEFEAT[0]), cam: { x: c.x, z: c.z + 2, dist: 18 }, run: () => g.slowmo(1.4, 0.4) },
        { dur: 4.4, ...say(SU_DEFEAT[1]), cam: exit ? { x: exit.x, z: exit.z + 4, dist: 22 } : undefined },
        { cam: null, dur: 0.8 },
      ],
      () => {
        g.openGate()
        g.victoryT = -1
        g.hintQueue.push('Вход в пещеру Шульган-Таш — на севере, за островками.')
      },
    )
  }

  /** into the cave: the chapter ends */
  private enterCave() {
    const g = this.g
    const exit = g.level.extras.exit!
    g.victoryT = 0
    g.playScene([{ cam: { x: exit.x, z: exit.z + 3, dist: 16 }, dur: 3.2, line: 'Отец, сын и куница шагнули в чёрный зев горы. Из глубины тянуло могильным холодом.' }], () => hud.set({ screen: 'epilogue' }))
  }

  // ------------------------------------------------------------------ every frame

  update(dt: number) {
    const g = this.g
    if (this.douseT >= 0) {
      this.douseT -= dt
      if (this.douseT < 0) for (const o of this.bowls) if (o.lit) this.setBowl(o, false)
    }
    this.updateMelody(dt)
    this.updateSilhouettes(dt)
    this.updateReflections(dt)
    const altar = g.level.extras.altar
    if (altar && !this.altarSaid && altar.distanceTo(g.player.pos) < 5) {
      this.altarSaid = true
      g.narrQueue.push(CH2_SANCTUARY)
    }
    // the first ancestors' armour met in the fight teaches the kurai
    if (!this.kuraiLesson && g.enemies.some((e) => e.aggro && (e.kind === 'guard' || e.kind === 'archer'))) this.beginKuraiLesson()
  }

  respawn() {
    // a bowl lit out of order stays dark; the right ones stay burning
  }
}
