import * as THREE from 'three'
import { hud, type HudState } from './core/store'
import { Input } from './core/input'
import { parseLevel, zoneAt, ZONES, type LevelData } from './level/map'
import { Field } from './level/field'
import { buildLevel, moonLevel, shaftTime, updateEmitters, type Barrier, type Brazier, type LevelBuild } from './level/build'
import type { Halo } from './level/dressing'
import { assignShadowLayers, trimShadows } from './level/geo'
import { Lighting } from './render/lights'
import { projScale, VFX } from './render/vfx'
import { Vision } from './render/vision'
import { PostFX } from './render/post'
import { globalUniforms } from './render/materials'
import { SoundIndicators } from './render/indicators'
import { AudioEngine, type SoundKind } from './audio/audio'
import type { Mood } from './audio/music'
import { Player } from './actors/player'
import { HERO_CLIPS } from './actors/models'
import { Albasty, Enemy, Ubyr, Wolf } from './actors/enemies'
import { Shurale } from './actors/boss'
import { Projectiles } from './actors/projectiles'
import { CLUES, QUESTIONS, journal, type ClueId } from './clues'
import { wearGlb } from './actors/skin'
import { Marten } from './actors/marten'
import { HeroAnimator } from './actors/heroAnim'
import { Eagle } from './actors/eagle'
import { Echo } from './echo'
import { Tutor } from './tutor'
import { RpgState, type OutfitId } from './rpg/state'
import { Pickups, type Pickup, type PickupKind } from './rpg/pickups'
import { ITEMS, SKAZ, type ItemId, type NodeId, type StatId } from './rpg/data'
import type { World } from './world'
import type { SoundOpts } from './types'
import { BOSS_INTRO, BOSS_PHASE2, OPENING, DEATH_LINES, DROP_DRINK, DROP_GIVE, FIRST_STAGGER, SHURALE_LAST, SPRING_USED, TRIGGERS, VICTORY, type Beat } from './script'
import { CAM_YAW, clamp, fbm, lerp, pick, rand, wrapAngle } from './util'

const PITCH = THREE.MathUtils.degToRad(55)

/** One beat of a directed scene. */
export interface Shot {
  /** where the camera looks (null = back to the hero); snap = cut instead of glide */
  cam?: { x: number; z: number; dist?: number; snap?: boolean } | null
  dur: number
  line?: string
  /** who says the line (the sesen by default) */
  who?: string
  run?: () => void
}

interface Interaction {
  label: string
  run?: () => void
}

export class Game implements World {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  /** drawn after the vision mask (memory echoes) */
  readonly overlay = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly input: Input
  readonly audio = new AudioEngine()
  readonly rpg = new RpgState()
  pickups!: Pickups
  levelData!: LevelData
  field!: Field
  lighting!: Lighting
  vfx!: VFX
  level!: LevelBuild
  vision!: Vision
  post!: PostFX
  indicators: SoundIndicators
  player!: Player
  enemies: Enemy[] = []
  boss: Shurale | null = null
  projectiles!: Projectiles
  eagle!: Eagle
  echo!: Echo
  time = 0
  private container: HTMLElement
  private raf = 0
  private last = 0
  private ro: ResizeObserver
  private ready = false
  private hitstopT = 0
  private slowmoT = 0
  private slowmoScale = 1
  private shakeAmt = 0
  private damage = 0
  private camTarget = new THREE.Vector3()
  private camDist = 26
  private camDistS = 26
  private mouseWorld = new THREE.Vector3()
  private raycaster = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private hudT = 0
  private fpsAcc = 0
  private fpsN = 0
  private fps = 60
  /** sesen lines (strings) or someone else's (Timer's thoughts) */
  private narrQueue: (string | { who: string; text: string })[] = []
  private narrT = 0
  private narrId = 0
  private hintQueue: string[] = []
  private hintT = 0
  private curHint: string | null = null
  private curNarr: { id: number; speaker: string; text: string } | null = null
  private interaction: Interaction | null = null
  private choiceOpen = false
  private loreOpen = false
  private restOpen = false
  private sumaOpen = false
  private zealHinted = false
  private bowHinted = false
  readonly tutor = new Tutor()
  private tutorPrev: { x: number; z: number; gaze: number; sips: number; state: string; swings: number } | null = null
  /** signs of the abductors Timer has read (docs/TRACKING.md) */
  readonly clueFound = new Set<ClueId>()
  /** the marten companion */
  marten: Marten | null = null
  private scentT = 0
  private whimperHeard = false
  /** the tracker's sense: held [V], out of combat */
  private sense = 0
  private counterHinted = false
  private inCombat = false
  private toastList: {
    id: number
    text: string
    kind: 'item' | 'info' | 'warn'
    icon?: string
    t: number
  }[] = []
  private toastId = 0
  private rpgSig = ''
  private bossIntro = false
  private deathT = -1
  private victoryT = -1
  private dawn = 0
  /** the lantern's share in the vision mask, faded so lighting and dousing are not a hard cut */
  private lanternVis = 0
  private visLights: { x: number; z: number; full: number; fade: number; level: number }[] = []
  private kills = 0
  private deaths = 0
  private drunk = 0
  private given = 0
  private shownStagger = false
  private springUsedOnce = false
  private debug = false
  private bossWolves: Enemy[] = []
  private tmpV = new THREE.Vector3()
  private quality: 'high' | 'low' = 'high'
  private buildTimer = 0
  private frameN = 0

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.setClearColor(0x020306, 1)
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' })
    container.appendChild(this.renderer.domElement)
    this.indicators = new SoundIndicators(container)
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 140)
    this.input = new Input(this.renderer.domElement)
    window.addEventListener('keydown', this.onKey)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    hud.set({ screen: 'title', loadingText: 'Урман просыпается…' })
    // Build on the next frame so the title screen paints first.
    this.buildTimer = window.setTimeout(() => this.build(), 30)
  }

  // ------------------------------------------------------------------ setup

  private build() {
    const t0 = performance.now()
    this.levelData = parseLevel()
    this.field = new Field(this.levelData)
    this.lighting = new Lighting(this.scene)
    this.vfx = new VFX(this.scene)
    this.level = buildLevel(this.scene, this.levelData, this.field, this.lighting, this.vfx)
    this.vision = new Vision(this.renderer, this.field, this.levelData.width, this.levelData.depth)
    this.post = new PostFX(this.renderer, 4, 4)
    this.projectiles = new Projectiles(this)
    this.player = new Player(this)
    // the hero's Mixamo body; if it fails, the static GLB skinned to the procedural rig; if that fails, the procedural body
    const pl = this.player
    HeroAnimator.load(pl.rig, '/models/hero_rig.glb', 1.82, pl.model.props, pl.rig.flashMats)
      .then((a) => {
        pl.anim = a
        a.setOutfit(this.rpg.outfit)
        this.scene.add(a.root)
      })
      .catch((e) => {
        console.warn('hero_rig.glb', e)
        return wearGlb(pl.rig, '/models/hero.glb', { height: 1.97, keep: pl.model.props })
      })
      .catch((e) => console.warn('hero.glb', e))
    this.player.pos.copy(this.level.start)
    this.player.checkpoint.copy(this.level.start)
    this.player.facing = Math.PI
    this.player.aimAngle = Math.PI
    this.player.gaze = Math.PI
    this.eagle = new Eagle(this)
    this.echo = new Echo(this, this.overlay)
    // Susar waits in the hunter's trap mid-way through the urman (docs/COMPANION.md)
    const trap = this.level.trap
    if (trap) this.marten = new Marten(this, new THREE.Vector3(trap.pos.x - 0.15, 0, trap.pos.z + 0.1))
    this.pickups = new Pickups(this.scene)
    this.placeLoot()
    for (const s of this.level.spawns) {
      if (s.ch === 'B') {
        this.boss = new Shurale(this, s.x, s.z)
        this.enemies.push(this.boss)
      } else if (s.ch === 'U') this.enemies.push(new Ubyr(this, s.x, s.z, true))
      else if (s.ch === 'a') this.enemies.push(new Albasty(this, s.x, s.z, true))
      else this.spawnEnemy(s.ch === 'u' ? 'ubyr' : s.ch === 'w' ? 'wolf' : 'albasty', s.x, s.z, false)
    }
    // shadow budget: tiny details stop casting (characters, story props)
    this.scene.updateMatrixWorld(true)
    let trimmed = trimShadows(this.player.rig.root) + trimShadows(this.level.root)
    for (const e of this.enemies) trimmed += trimShadows(e.rig.root, e.kind === 'boss' ? 0.2 : 0.14)
    assignShadowLayers(this.level.root)
    assignShadowLayers(this.player.rig.root)
    for (const e of this.enemies) assignShadowLayers(e.rig.root)
    console.info(`[urman] shadow casters trimmed: ${trimmed}`)
    this.camTarget.copy(this.player.pos)
    this.resize()
    this.updateCamera(1)
    this.player.update(0.016, this.input)
    for (const e of this.enemies) e.update(0.016)
    this.renderer.compile(this.scene, this.camera)
    this.ready = true
    console.info(`[urman] level built in ${Math.round(performance.now() - t0)} ms, ${this.level.instancedMeshes} instanced batches`)
    hud.set({ loadingText: '' })
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    const pr = this.renderer.getPixelRatio()
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.indicators.resize(w, h, Math.min(window.devicePixelRatio, 2))
    if (this.post) this.post.setSize(Math.floor(w * pr), Math.floor(h * pr))
    projScale.value = (h * pr * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    globalUniforms.uFadeRadius.value = h * pr * 0.2
  }

  dispose() {
    clearTimeout(this.buildTimer)
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    window.removeEventListener('keydown', this.onKey)
    this.input.dispose()
    this.post?.dispose()
    this.vision?.dispose()
    this.audio.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
    this.indicators.canvas.remove()
  }

  // ------------------------------------------------------------------ public API (UI)

  start() {
    if (!this.ready) return
    this.audio.start()
    this.audio.setVolume(hud.get().volume)
    hud.set({ screen: 'prologue', tutorOn: this.tutor.enabled })
    this.audio.music?.playKuray(8)
  }

  endEpilogue() {
    if (hud.get().screen === 'epilogue') hud.set({ screen: 'victory' })
  }

  /** Called when the cave-painting prologue ends (or is skipped). */
  endPrologue() {
    if (hud.get().screen !== 'prologue') return
    hud.set({ screen: 'playing', journal: journal(this.clueFound) })
    this.beginStory()
  }

  /** Opening shot: from high above the dark forest the camera sinks to Timer at his fire. */
  private beginStory() {
    const p = this.player.pos
    const t1 = this.level.triggers.find((t) => t.id === '1')
    if (t1) t1.fired = true
    const beat = TRIGGERS['1']
    this.playScene(
      [
        { cam: { x: p.x - 3, z: p.z - 9, dist: 46, snap: true }, dur: 3.2, line: OPENING.lines?.[0] },
        { cam: { x: p.x, z: p.z, dist: 26 }, dur: 5.4, line: OPENING.lines?.[1] },
      ],
      () => {
        this.hintQueue.push(...(beat.hints ?? []))
        this.tutor.begin('path')
      },
      false,
    )
  }

  // ------------------------------------------------------------------ directed scenes

  private cine: { shots: Shot[]; i: number; t: number; started: boolean; done?: () => void; unveil: boolean } | null = null
  private cineGoal: { x: number; z: number; dist?: number } | null = null
  private veil = 1
  private cineId = 0

  /** Letterboxed, HUD-less moment with a directed camera. `unveil` lifts the darkness of the vision mask. */
  playScene(shots: Shot[], done?: () => void, unveil = true) {
    this.cine = { shots, i: 0, t: 0, started: false, done, unveil }
    this.input.reset()
    hud.set({ cinema: true })
  }

  get inScene() {
    return !!this.cine
  }

  /** Jump to the end of the current scene, still running every shot's action. */
  skipScene() {
    const sc = this.cine
    if (!sc) return
    for (let k = sc.started ? sc.i + 1 : sc.i; k < sc.shots.length; k++) sc.shots[k].run?.()
    this.cine = null
    this.cineGoal = null
    hud.set({ cinema: false, cineLine: null })
    sc.done?.()
  }

  private updateScene(rdt: number) {
    const sc = this.cine
    // the veil of darkness fades back in after a scene
    const veilGoal = sc && sc.unveil ? 0 : 1
    this.veil += (veilGoal - this.veil) * (1 - Math.exp(-2.2 * rdt))
    this.post.visionMat.uniforms.uVisionOn.value = hud.get().visionOn ? this.veil : 0
    this.vision.enabled = hud.get().visionOn && !(sc && sc.unveil)
    if (!sc) return
    const shot = sc.shots[sc.i]
    if (!sc.started) {
      sc.started = true
      shot.run?.()
      if (shot.line) hud.set({ cineLine: { id: ++this.cineId, speaker: shot.who ?? 'Сэсэн', text: shot.line } })
      if (shot.cam !== undefined) {
        this.cineGoal = shot.cam ? { x: shot.cam.x, z: shot.cam.z, dist: shot.cam.dist } : null
        if (shot.cam?.snap) {
          this.camTarget.set(shot.cam.x, 0, shot.cam.z)
          if (shot.cam.dist) this.camDistS = shot.cam.dist
        }
      }
    }
    sc.t += rdt
    if (sc.t >= shot.dur) {
      sc.i++
      sc.t = 0
      sc.started = false
      if (sc.i >= sc.shots.length) {
        this.cine = null
        this.cineGoal = null
        hud.set({ cinema: false, cineLine: null })
        sc.done?.()
      }
    }
  }

  resume() {
    if (hud.get().screen !== 'paused') return
    this.audio.suspend(false)
    hud.set({ screen: 'playing' })
  }

  pause() {
    if (hud.get().screen !== 'playing' || this.choiceOpen || this.loreOpen ||
      this.restOpen ||
      this.sumaOpen
    ) return
    this.input.reset()
    this.audio.suspend(true)
    hud.set({ screen: 'paused' })
  }

  setVolume(v: number) {
    this.audio.setVolume(v)
    hud.set({ volume: v })
  }

  setVision(on: boolean) {
    this.vision.enabled = on
    this.post.visionMat.uniforms.uVisionOn.value = on ? 1 : 0
    this.indicators.enabled = on
    hud.set({ visionOn: on })
  }

  setQuality(q: 'high' | 'low') {
    this.quality = q
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : 1)
    this.post.bloomOn = q === 'high'
    this.lighting.lantern.castShadow = q === 'high'
    this.resize()
    hud.set({ quality: q })
  }

  chooseDrop(kind: 'drink' | 'give') {
    const d = this.level.drop
    if (!d || d.taken) return
    d.taken = true
    d.orb.visible = false
    d.light.on = false
    this.choiceOpen = false
    hud.set({ choice: false })
    const p = this.player
    if (kind === 'drink') {
      this.drunk++
      this.gainSkaz(SKAZ.drop)
      p.maxSips++
      p.sips = p.maxSips
      p.heal(p.maxHp)
      this.sound('drink', null, { indicate: false })
      this.beat(DROP_DRINK)
      for (let i = 0; i < 40; i++) this.vfx.add.spawn({ x: p.pos.x + rand(-0.6, 0.6), y: rand(0.2, 2), z: p.pos.z + rand(-0.6, 0.6), vy: rand(0.4, 1.5), r: 0.4, g: 2.0, b: 1.7, size: 0.07, life: 1.2, drag: 1 })
    } else {
      this.given++
      this.gainSkaz(SKAZ.drop)
      const g = this.level.grove
      if (g) {
        g.revived = true
        g.t = 0
        g.light.on = true
        for (const f of g.foliage) f.visible = true
        this.vfx.rings.spawn(g.center.x, g.center.z, { from: 0.5, to: 14, dur: 2.2, color: new THREE.Color(1.4, 1.0, 0.4), width: 0.03 })
      }
      this.sound('revive', d.pos, { indicate: false })
      if (g)
        this.playScene([
          { cam: { x: g.center.x, z: g.center.z + 2, dist: 22 }, dur: 2.2, line: DROP_GIVE.lines?.[0] },
          { dur: 2.4 },
          { cam: null, dur: 1.0 },
        ])
      else this.beat(DROP_GIVE)
    }
  }

  // ------------------------------------------------------------------ RPG

  // ---- Susar the marten

  private freeMarten() {
    const m = this.marten
    const trap = this.level.trap
    if (!m || !trap) return
    trap.open()
    m.free()
    this.sound('crack', trap.pos, { indicate: false, vol: 0.5 })
    this.playScene(
      [
        { cam: { x: trap.pos.x, z: trap.pos.z, dist: 11 }, dur: 2.6, line: 'Куница. Лапу зажал охотничий капкан.' },
        { dur: 2.8, line: 'Она отбежала, но не ушла. Села и смотрела на Тимера.' },
        { cam: null, dur: 1.0 },
      ],
      () => {
        this.beat({ lines: ['Тимер назвал её Сусар.'], hints: ['Сусар чует тех, кого не видно. Золотой след лапы — там, где она учуяла врага. В бою она прячется, а после возвращается.'] })
        this.toast('Сусар идёт следом', 'info', 'marten')
      },
    )
    this.gainSkaz(SKAZ.echo)
  }

  private updateMarten(dt: number) {
    const m = this.marten
    if (!m) return
    const p = this.player
    m.combat = this.inCombat
    // the nearest unread sign (she finds it first and waits by it)
    let clue: THREE.Vector3 | null = null
    let best = 14
    for (const id of Object.keys(this.level.clues) as ClueId[]) {
      if (this.clueFound.has(id) || !CLUES[id].prompt) continue
      const at = this.level.clues[id]!
      const d = Math.hypot(at.x - p.pos.x, at.z - p.pos.z)
      if (d < best) {
        best = d
        clue = at
      }
    }
    m.clue = clue
    m.update(dt)
    if (m.state === 'trapped' && !this.whimperHeard && Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) < 11) {
      this.whimperHeard = true
      this.narrQueue.push('Где-то у тропы скулит зверёк.')
    }
    // what she smells is marked for Timer: gold paw marks in the dark, arrows at the screen edge
    if (!m.active) return
    this.scentT -= dt
    if (this.scentT <= 0) {
      this.scentT = 0.7
      for (const e of m.sensed) {
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z)
        this.indicators.push(e.pos, 'scent', 0.85 - d / 40, d, 'scent-' + e.id)
      }
    }
  }

  // ---- tracking: signs of the abductors and what they tell

  findClue(id: ClueId) {
    if (this.clueFound.has(id)) return
    this.clueFound.add(id)
    this.tutor.tally.clues++
    const c = CLUES[id]
    const q = QUESTIONS.find((x) => x.id === c.q)!
    const n = q.clues.filter((x) => this.clueFound.has(x)).length
    if (c.thought) this.narrQueue.push({ who: 'Тимер', text: c.thought })
    this.gainSkaz(SKAZ.clue)
    this.audio.play('perfect', null, 0.25)
    this.toast(`${q.title} · ${n} из ${q.clues.length}`, 'info', 'amanat')
    if (n === q.clues.length) this.narrQueue.push(q.answer)
    if (QUESTIONS.every((x) => x.clues.every((k) => this.clueFound.has(k)))) this.narrQueue.push('Теперь Тимер знал, кто и куда. Не знал только, почему за его ребёнком.')
    hud.set({ journal: journal(this.clueFound) })
  }

  /** glints over unread signs; held [V] makes the trail and the signs stand out */
  private updateTracking(dt: number) {
    const p = this.player
    const want = this.input.isDown('KeyV') && p.alive && !this.inCombat && !this.cine ? 1 : 0
    this.sense += (want - this.sense) * Math.min(1, dt * (want ? 5 : 3))
    p.slowWalk = want === 1
    for (const m of this.level.trackMats) {
      m.emissive.setRGB(0.9 * this.sense, 0.5 * this.sense, 0.15 * this.sense)
      m.opacity = Math.min(1, (m.userData.base ?? 0.6) + 0.3 * this.sense)
    }
    const L = this.level
    for (const id of Object.keys(L.clues) as ClueId[]) {
      if (this.clueFound.has(id) || !CLUES[id].prompt) continue
      const at = L.clues[id]!
      const d = Math.hypot(at.x - p.pos.x, at.z - p.pos.z)
      const reach = 6 + 22 * this.sense
      if (d > reach) continue
      const rate = (this.sense > 0.5 ? 14 : 4) * (1 - d / (reach + 1))
      if (Math.random() < rate * dt) this.vfx.add.spawn({ x: at.x + rand(-0.3, 0.3), y: rand(0.1, 0.8), z: at.z + rand(-0.3, 0.3), vy: rand(0.2, 0.6), r: 1.8, g: 1.25, b: 0.55, size: rand(0.03, 0.06), life: rand(0.6, 1.1), drag: 1 })
      if (this.sense > 0.5 && Math.random() < dt * 0.7) this.vfx.rings.spawn(at.x, at.z, { from: 0.2, to: 1.6, dur: 0.9, color: new THREE.Color(1.2, 0.8, 0.35), width: 0.03 })
    }
  }

  toast(text: string, kind: 'item' | 'info' | 'warn' = 'item', icon?: string) {
    this.toastList.push({
      id: ++this.toastId,
      text,
      kind,
      icon,
      t: performance.now() / 1000,
    })
    if (this.toastList.length > 5) this.toastList.shift()
    hud.set({
      toasts: this.toastList.map(({ id, text, kind, icon }) => ({ id, text, kind, icon })),
    })
  }

  private gainSkaz(n: number) {
    if (this.rpg.addSkaz(n)) {
      this.toast('Новая строка кубаира', 'info', 'dombra')
      this.audio.play('ui', null, 0.7)
    }
  }

  arrowLanded(pos: THREE.Vector3, fire: boolean) {
    if (!fire) return
    for (const b of this.level.barriers) {
      if (b.kind !== 'thorns' || b.open) continue
      if (b.circles.some((c) => Math.hypot(c.x - pos.x, c.z - pos.z) < 2.2)) return this.openBarrier(b)
    }
    for (const b of this.level.braziers) {
      if (!b.lit && Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) < 1.7) {
        this.setBrazier(b, true, true)
        this.toast('Жаровня горит', 'info', 'flame')
        return
      }
    }
  }

  private spawnPickup(
    x: number,
    z: number,
    items: [ItemId, number][],
    label: string,
    kind: PickupKind,
    extra: { oil?: number; onTake?: () => void } = {},
  ) {
    return this.pickups.spawn(new THREE.Vector3(x, 0, z), items, {
      label,
      kind,
      ...extra,
    })
  }

  /** Story finds and caches, placed next to the props that tell their story. */
  private placeLoot() {
    const M = this.levelData.markers
    const at = (ch: string, i = 0) => M.filter((m) => m.ch === ch)[i]
    const h = at('h')
    if (h)
      this.spawnPickup(
        h.x + 0.6,
        h.z - 0.4,
        [
          ['fang', 1],
          ['arrow', 6],
        ],
        'Взять клык и стрелы',
        'amulet',
        {
          onTake: () => {
            if (!this.rpg.wolfOpen) {
              this.rpg.wolfOpen = true
              this.toast('Тамга Волка', 'info', 'wolf')
              this.narrQueue.push(
                'Охотник был из волчьего рода. Его тамга перешла к Тимеру.',
              )
              this.hintQueue.push('Есть стрелы. [2] — взять лук, [1] — снова кылыс.')
            }
          },
        },
      )
    const s = at('s')
    if (s)
      this.spawnPickup(
        s.x + 1.1,
        s.z + 1.0,
        [['birch_tamga', 1]],
        'Взять берестяную тамгу',
        'amulet',
      )
    const y0 = at('y', 0)
    if (y0)
      this.spawnPickup(
        y0.x + 0.4,
        y0.z + 0.3,
        [
          ['arrow_fire', 5],
          ['resin', 2],
        ],
        'Обыскать юрту',
        'pouch',
      )
    const y1 = at('y', 1)
    if (y1)
      this.spawnPickup(
        y1.x - 0.3,
        y1.z + 0.4,
        [
          ['kumys', 1],
          ['honey', 1],
        ],
        'Обыскать юрту',
        'pouch',
      )
    const H = at('H')
    if (H)
      this.spawnPickup(
        H.x - 0.9,
        H.z + 0.9,
        [
          ['flint', 2],
          ['fur_fox', 1],
        ],
        'Открыть суму',
        'pouch',
        { oil: 0.5 },
      )
    const e = at('e')
    if (e)
      // what survived the fire, at the edge of the clearing
      this.spawnPickup(e.x + 2.6, e.z + 1.6, [['kumys', 1]], 'Взять уцелевший кумыс', 'pouch')
    const r = at('r', 1)
    if (r)
      this.spawnPickup(
        r.x + 1.3,
        r.z + 0.6,
        [
          ['arrow', 5],
          ['bone', 1],
        ],
        'Взять колчан',
        'pouch',
      )
    const n = at('n')
    if (n)
      // the bort: a reward for following the stream up into the dark
      this.spawnPickup(n.x + 0.9, n.z + 0.9, [['honey', 2], ['resin', 1]], 'Достать дикий мёд', 'pouch')
    const A = at('A')
    if (A)
      this.spawnPickup(A.x + 0.5, A.z + 0.2, [['arslan_steel', 1]], 'Поднять огниво', 'amulet', {
        onTake: () => this.narrQueue.push({ who: 'Тимер', text: 'Огниво с тамгой нашего рода. Такое было у отца.' }, 'Арслан ушёл в горы, когда Тимер был мал. Тимер не знал, что отец проходил здесь.'),
      })
    const b = at('b', 0)
    if (b)
      this.spawnPickup(
        b.x + 1.2,
        b.z - 0.8,
        [],
        'Взять масло',
        'bottle',
        { oil: 0.6 },
      )
  }

  private dropLoot(e: Enemy) {
    const x = e.pos.x
    const z = e.pos.z
    if (e.kind === 'boss') {
      if (this.rpg.add('shurale_finger', 1))
        this.toast('Палец Шурале', 'item', 'shurale_finger')
      return
    }
    const items: [ItemId, number][] = []
    if (e.kind === 'ubyr') {
      items.push(['bone', 1])
      if (Math.random() < 0.45) items.push(['arrow', 3])
    } else if (e.kind === 'wolf') items.push(['hide_wolf', 1])
    else if (e.kind === 'albasty') {
      items.push(['hair', 1])
      if (Math.random() < 0.5) items.push(['honey', 1])
    }
    if (items.length) this.spawnPickup(x, z, items, '', 'drop')
  }

  private collect(pk: Pickup) {
    if (pk.taken) return
    this.pickups.take(pk)
    for (const [id, n] of pk.items) {
      const got = this.rpg.add(id, n)
      const def = ITEMS[id]
      if (def.kind === 'amulet')
        this.toast(def.name, 'item', id)
      else if (got > 0) this.toast(`${def.name} +${got}`, 'item', id)
      else this.toast(def.kind === 'ammo' ? 'Колчан полон' : 'Больше не унести', 'warn', id)
    }
    if (pk.oil > 0) {
      this.rpg.oil = Math.min(1, this.rpg.oil + pk.oil)
      this.toast('Масло', 'item', 'lantern')
    }
    this.audio.play('ui', null, 0.5)
    pk.onTake?.()
  }

  private updateLoot() {
    const p = this.player
    if (!p.alive) return
    this.pickups.update(this.time)
    const n = this.projectiles.collectNear(p.pos, 1.1, (ITEMS.arrow.max ?? 20) - this.rpg.count('arrow'))
    if (n > 0) this.toast(`Стрелы +${this.rpg.add('arrow', n)}`, 'item', 'arrow')
    for (const pk of this.pickups.list)
      if (!pk.taken && pk.auto && pk.pos.distanceTo(p.pos) < 1.2)
        this.collect(pk)
  }

  // ---- rest at a spring or fire: heal, then the sesen sings the gathered Skaz
  private openRest(kind: 'spring' | 'fire') {
    const p = this.player
    p.heal(p.maxHp)
    this.restOpen = true
    this.restSpent = {}
    this.input.reset()
    // the camera sits down with Timer: close, with him to the right of the menu
    const off = 4.4
    this.cineGoal = { x: p.pos.x - Math.cos(CAM_YAW) * off, z: p.pos.z + Math.sin(CAM_YAW) * off, dist: 14 }
    this.syncHud()
    hud.set({ rest: kind })
  }

  closeRest() {
    if (!this.restOpen) return
    this.restOpen = false
    this.cineGoal = null
    this.input.reset()
    hud.set({ rest: null })
  }

  restSing() {
    const n = this.rpg.sing()
    if (n > 0) {
      this.player.heal(this.player.maxHp)
      this.sound('revive', this.player.pos, { indicate: false })
      this.vfx.rings.spawn(this.player.pos.x, this.player.pos.z, {
        from: 0.2,
        to: 1.4,
        dur: 0.9,
        color: new THREE.Color(1.4, 0.9, 0.4),
        width: 0.05,
      })
    }
    this.syncHud()
  }

  /** points put into each stat during this rest: they can be taken back until Timer gets up */
  restSpent: Partial<Record<StatId, number>> = {}

  raiseStat(id: StatId) {
    if (this.rpg.raise(id)) {
      this.restSpent[id] = (this.restSpent[id] ?? 0) + 1
      this.audio.play('ui', null, 0.5)
    }
    this.syncHud()
  }

  lowerStat(id: StatId) {
    if ((this.restSpent[id] ?? 0) > 0 && this.rpg.lower(id)) {
      this.restSpent[id]! -= 1
      this.audio.play('ui', null, 0.35)
    }
    this.syncHud()
  }

  learnNode(id: NodeId) {
    if (this.rpg.learn(id)) this.audio.play('ui', null, 0.6)
    this.syncHud()
  }

  craftFireArrows() {
    if (this.rpg.count('arrow_fire') >= (ITEMS.arrow_fire.max ?? 10))
      return this.toast('Колчан полон', 'warn', 'arrow_fire')
    if (!this.rpg.take('resin')) return this.toast('Нет смолы', 'warn', 'resin')
    this.rpg.add('arrow_fire', 3)
    this.audio.play('ignite', null, 0.4)
    this.syncHud()
  }

  // ---- сума (inventory)
  openSuma() {
    if (hud.get().screen !== 'playing' || this.choiceOpen || this.loreOpen || this.restOpen || this.cine || !this.player.alive) return
    this.sumaOpen = true
    this.tutor.tally.suma++
    this.input.reset()
    this.syncHud()
    hud.set({ suma: true })
  }

  closeSuma() {
    if (!this.sumaOpen) return
    this.sumaOpen = false
    this.input.reset()
    hud.set({ suma: false })
  }

  /** Change clothes (out of combat): null = the base shirt. */
  wearOutfit(id: OutfitId | null) {
    if (this.inCombat) return this.toast('Не в бою', 'warn')
    if (id && !this.rpg.outfits.has(id)) return
    this.rpg.outfit = id
    this.player.anim?.setOutfit(id)
    this.audio.play('ui', null, 0.5)
    this.syncHud()
  }

  equipAmulet(id: ItemId | null) {
    if (this.inCombat) return this.toast('Не в бою', 'warn')
    this.rpg.equip(this.rpg.equipped === id ? null : id)
    this.audio.play('ui', null, 0.5)
    this.syncHud()
  }

  selectArrows(t: 'arrow' | 'arrow_fire') {
    if (t === 'arrow_fire' && this.rpg.count('arrow_fire') <= 0) return
    this.rpg.arrowType = t
    this.syncHud()
  }

  /** Read a tamga stone: the world holds its breath while the page is open. */
  openLore(id: number) {
    // the second tamga tells who the albasty comes for
    if (id === 1 && !this.clueFound.has('lore_albasty')) this.findClue('lore_albasty')
    this.loreOpen = true
    this.input.reset()
    this.audio.play('ui', null, 0.6)
    hud.set({ lore: id })
  }

  closeLore() {
    if (!this.loreOpen) return
    this.loreOpen = false
    this.input.reset()
    hud.set({ lore: null })
  }

  respawn() {
    const p = this.player
    this.deaths++
    this.deathT = -1
    p.respawnAt(p.checkpoint)
    this.projectiles.clear()
    this.indicators.clear()
    for (const e of this.bossWolves) {
      e.alive = false
      e.removed = true
      e.rig.root.visible = false
    }
    this.bossWolves = []
    for (const e of this.enemies) if (e !== this.boss && e.aggro) e.resetToHome()
    if (this.boss && this.boss.alive && (this.boss.fightStarted || this.bossIntro)) {
      this.bossIntro = false
      this.boss.resetBoss()
      this.openGate()
      for (const b of this.level.braziers) if (b.arena) this.setBrazier(b, true, false)
      hud.set({ boss: null })
    }
    this.camTarget.copy(p.pos)
    hud.set({ screen: 'playing' })
  }

  // ------------------------------------------------------------------ World services

  sound(kind: SoundKind, pos: THREE.Vector3 | null, opts: SoundOpts = {}) {
    this.audio.play(kind, pos, opts.vol ?? 1, opts.id)
    if (opts.indicate === false || !pos || !opts.tone) return
    const d = Math.hypot(pos.x - this.player.pos.x, pos.z - this.player.pos.z)
    if (d > 34) return
    this.indicators.push(pos, opts.tone, (opts.strength ?? 0.6) * (1 - d / 45), d, opts.id ?? null)
  }

  hitstop(sec: number) {
    this.hitstopT = Math.max(this.hitstopT, sec)
  }
  shake(a: number) {
    this.shakeAmt = Math.min(1.5, this.shakeAmt + a)
  }
  slowmo(sec: number, scale = 0.3) {
    this.slowmoT = Math.max(this.slowmoT, sec)
    this.slowmoScale = scale
  }
  damagePulse(k: number) {
    this.damage = Math.max(this.damage, k)
  }

  playerNoise(pos: THREE.Vector3, radius: number) {
    for (const e of this.enemies) if (e.alive) e.hearNoise(pos, radius)
  }

  perfectDodge() {
    this.player.onPerfectDodge()
    if (!this.counterHinted) {
      this.counterHinted = true
      this.beat({ hints: ['Идеальное уклонение. Сразу [ЛКМ] — Ответ: удар вдвое сильнее.'] })
    }
    this.slowmo(0.6, 0.28)
    this.sound('perfect', null, { indicate: false })
    const p = this.player.pos
    this.vfx.rings.spawn(p.x, p.z, { from: 0.3, to: 3.5, dur: 0.5, color: new THREE.Color(0.7, 0.9, 1.4), width: 0.08 })
    this.player.dodgeCharges = Math.min(this.player.dodgeMax, this.player.dodgeCharges + 1)
  }

  releaseEagle() {
    const h = this.player.handWorld('L', this.tmpV)
    this.eagle.release(h.clone())
  }

  isLit(x: number, z: number) {
    for (const b of this.level.braziers) if (b.lit && Math.hypot(b.pos.x - x, b.pos.z - z) < 6) return true
    for (const f of this.level.fires) if (Math.hypot(f.pos.x - x, f.pos.z - z) < 6) return true
    const s = this.level.spring
    if (s && Math.hypot(s.pos.x - x, s.pos.z - z) < 5) return true
    const g = this.level.grove
    if (g && g.revived && Math.hypot(g.center.x - x, g.center.z - z) < 9) return true
    const p = this.player
    if (p.torchOn && p.torchDoused <= 0 && Math.hypot(p.pos.x - x, p.pos.z - z) < 5.5) return true
    return false
  }

  spawnEnemy(kind: 'ubyr' | 'wolf' | 'albasty', x: number, z: number, aggro: boolean) {
    const e = kind === 'ubyr' ? new Ubyr(this, x, z) : kind === 'wolf' ? new Wolf(this, x, z) : new Albasty(this, x, z)
    if (this.ready) {
      e.rig.root.updateMatrixWorld(true)
      trimShadows(e.rig.root)
      assignShadowLayers(e.rig.root)
    }
    this.enemies.push(e)
    if (aggro) e.becomeAggro(false)
    return e
  }

  onEnemyDeath(e: Enemy) {
    this.kills++
    this.gainSkaz(
      e.kind === 'boss'
        ? SKAZ.boss
        : e.kind === 'albasty'
          ? SKAZ.albasty
          : e.kind === 'wolf'
            ? SKAZ.wolf
            : SKAZ.ubyr,
    )
    this.dropLoot(e)
    if (e === this.boss) {
      this.victoryT = 0
      hud.set({ boss: null })
      for (const o of this.enemies) if (o !== e && o.alive && o.aggro) o.die()
      // his laughter scatters as dry leaves
      for (let i = 0; i < 90; i++)
        this.vfx.soft.spawn({ x: e.pos.x + rand(-1, 1), y: rand(0.5, 3.5), z: e.pos.z + rand(-1, 1), vx: rand(-3, 3), vy: rand(0.5, 3.5), vz: rand(-3, 3), r: rand(0.25, 0.45), g: rand(0.15, 0.28), b: 0.06, a: 0.95, size: rand(0.08, 0.14), life: rand(2, 4), drag: 0.9, gravity: 0.8 })
      const p = this.player.pos
      this.playScene(
        [
          { cam: { x: e.pos.x, z: e.pos.z + 1, dist: 15 }, dur: 3.4, who: 'Шурале', line: SHURALE_LAST[0], run: () => this.slowmo(1.6, 0.35) },
          { dur: 2.8, who: 'Шурале', line: SHURALE_LAST[1] },
          { cam: { x: e.pos.x, z: e.pos.z + 1, dist: 20 }, dur: 3.4, line: VICTORY.lines?.[0] },
          { cam: { x: p.x, z: p.z, dist: 34 }, dur: 3.8, line: VICTORY.lines?.[1] },
        ],
        () => hud.set({ screen: 'epilogue' }),
      )
      for (let i = 0; i < 120; i++)
        this.vfx.add.spawn({ x: e.pos.x + rand(-1, 1), y: rand(0.5, 3.5), z: e.pos.z + rand(-1, 1), vx: rand(-2, 2), vy: rand(0.5, 3), vz: rand(-2, 2), r: 1.6, g: 1.0, b: 0.3, size: rand(0.05, 0.12), life: rand(1.5, 3), drag: 0.8 })
    }
  }

  bossEvent(ev: 'phase2' | 'death') {
    if (ev !== 'phase2') return
    for (const b of this.level.braziers) if (b.arena && b.lit) this.setBrazier(b, false, true)
    this.player.torchDoused = 9
    this.sound('douse', this.player.pos, { indicate: false })
    this.beat(BOSS_PHASE2)
    const c = this.level.arenaCenter
    for (const s of [-1, 1]) {
      const x = c.x + s * 8
      const z = c.z + 4
      if (this.field.clearance(x, z) > 0.8) this.bossWolves.push(this.spawnEnemy('wolf', x, z, true))
    }
  }

  // ------------------------------------------------------------------ helpers

  private beat(b: Beat) {
    if (b.lines) this.narrQueue.push(...b.lines)
    if (b.hints) this.hintQueue.push(...b.hints)
  }

  // ---- barriers: thorns burn, the deadfall is pushed (docs/LEVEL.md)

  private openBarrier(b: Barrier) {
    if (b.open) return
    b.open = true
    b.t = 0
    for (const c of b.circles) this.field.removeCircle(c)
    for (const ci of b.cells) this.field.blocked[ci] = 0
    this.field.updateFlow(this.player.pos.x, this.player.pos.z, true)
    if (b.kind === 'thorns') {
      this.sound('ignite', b.center, { indicate: false, vol: 0.8 })
      this.toast('Терновник горит', 'info', 'flame')
    } else {
      this.sound('crack', b.center, { indicate: false, vol: 0.9 })
      this.sound('boom', b.center, { indicate: false, vol: 0.5 })
      this.shake(0.35)
      this.toast('Путь к кочевью открыт', 'info')
    }
    this.playerNoise(b.center, 14)
  }

  private updateBarriers(dt: number) {
    for (const b of this.level.barriers) {
      if (b.t < 0 || b.t >= 1) continue
      b.t = Math.min(1, b.t + dt / (b.kind === 'thorns' ? 2.6 : 1.4))
      const k = b.t
      if (b.kind === 'thorns') {
        // flare up, smoulder, sink into ash
        const heat = Math.sin(Math.min(1, k * 1.4) * Math.PI)
        b.mat.emissive.setRGB(1.6 * heat, 0.45 * heat, 0.08 * heat)
        b.mesh.scale.y = Math.max(0.05, 1 - Math.max(0, k - 0.35) * 1.45)
        if (Math.random() < dt * 40) {
          const c = b.circles[Math.floor(Math.random() * b.circles.length)]
          this.vfx.add.spawn({ x: c.x + rand(-1, 1), y: rand(0.2, 2.4) * b.mesh.scale.y, z: c.z + rand(-1, 1), vx: rand(-0.4, 0.4), vy: rand(1.2, 3), vz: rand(-0.4, 0.4), r: 2.4, g: 0.9, b: 0.25, size: rand(0.05, 0.11), life: rand(0.8, 1.6), drag: 0.5, gravity: -0.3 })
          if (Math.random() < 0.3) this.vfx.soft.spawn({ x: c.x, y: 1.5, z: c.z, vx: 0.2, vy: 0.9, vz: 0, r: 0.07, g: 0.065, b: 0.06, a: 0.35, size: 0.8, life: 3, drag: 0.3, grow: 3 })
        }
        if (Math.random() < dt * 6) this.audio.play('crackle', b.center, 0.9)
        if (k >= 1) b.mat.emissive.setRGB(0.12, 0.03, 0)
      } else {
        // the logs roll off the heap and settle flat
        const e = 1 - Math.pow(1 - k, 3)
        b.mesh.children.forEach((o, i) => {
          o.position.y = lerp(o.userData.y0 ?? (o.userData.y0 = o.position.y), 0.18, e)
          o.rotation.x = (o.userData.rx0 ?? (o.userData.rx0 = o.rotation.x)) + e * (i % 2 ? 0.25 : -0.2)
        })
        b.mesh.position.z = b.center.z - e * 1.6
      }
    }
  }

  /** what Timer can do at a barrier, or what he thinks the first time he meets it */
  private barrierInteraction(): Interaction | null {
    const p = this.player
    for (const b of this.level.barriers) {
      if (b.open) continue
      const near = b.circles.some((c) => Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < 3.2)
      if (!near) continue
      if (!this.barrierNoted.has(b)) {
        this.barrierNoted.add(b)
        this.narrQueue.push({ who: 'Тимер', text: b.kind === 'thorns' ? 'Терновник Шурале. Сырой лес так не растёт. Огонь его возьмёт.' : 'Завал. Свежий, ветки ещё в хвое.' })
      }
      if (b.kind === 'thorns') {
        const lit = p.torchOn && p.torchDoused <= 0
        return lit
          ? {
              label: 'Поджечь терновник',
              run: () =>
                p.startInteract(() => {
                  this.rpg.oil = Math.max(0, this.rpg.oil - 0.25)
                  this.openBarrier(b)
                }),
            }
          : { label: 'Нужен огонь фонаря: [T]' }
      }
      // the deadfall gives only from the barrow side (south)
      if (p.pos.z > b.center.z) return { label: 'Столкнуть стволы', run: () => p.startInteract(() => this.openBarrier(b)) }
      return { label: 'С этой стороны не сдвинуть' }
    }
    return null
  }

  /** The first step into a named place puts its title on screen. */
  private updateZones(rdt: number) {
    if (this.zoneT > 0) {
      this.zoneT -= rdt
      if (this.zoneT <= 0) this.zoneCard = null
    }
    if (this.cine || hud.get().screen !== 'playing' || !this.player.alive) return
    const z = zoneAt(this.levelData, this.player.pos.x, this.player.pos.z)
    if (z < 0 || this.zonesSeen.has(z)) return
    this.zonesSeen.add(z)
    this.zoneCard = { id: z, name: ZONES[z].name, sub: ZONES[z].sub }
    this.zoneT = 4.8
  }

  /** Azamat cries in the hollow, now and then the kurai: a sound to walk toward. */
  private updateHollow(dt: number) {
    const h = this.level.hollow
    if (!h || !this.boss || !this.boss.alive || this.victoryT >= 0) return
    this.cryT -= dt
    if (this.cryT > 0) return
    this.cryT = 5 + Math.random() * 2.5
    const d = h.distanceTo(this.player.pos)
    if (d > 58) return
    const kurai = Math.random() < 0.35
    this.sound(kurai ? 'kurai' : 'cry', h, { tone: 'neutral', strength: Math.max(0.35, 1 - d / 60), id: 'azamat', vol: Math.max(0.25, 1 - d / 70) })
  }

  private setBrazier(b: Brazier, lit: boolean, fx: boolean) {
    b.lit = lit
    b.light.on = lit
    b.flame.visible = lit
    b.coal.visible = lit
    if (fx) {
      this.sound(lit ? 'ignite' : 'douse', b.pos, { indicate: false })
      if (lit)
        for (let i = 0; i < 30; i++) this.vfx.add.spawn({ x: b.pos.x, y: 1.3, z: b.pos.z, vx: rand(-1.5, 1.5), vy: rand(1, 4), vz: rand(-1.5, 1.5), r: 2.4, g: 1, b: 0.3, size: 0.07, life: 0.9, drag: 1.5 })
      else for (let i = 0; i < 12; i++) this.vfx.soft.spawn({ x: b.pos.x, y: 1.4, z: b.pos.z, vy: rand(0.5, 1.5), r: 0.08, g: 0.08, b: 0.08, a: 0.5, size: 0.7, life: 1.6, grow: 2 })
    }
  }

  private closeGate() {
    const g = this.level.gate
    if (!g || g.closed) return
    g.closed = true
    g.anim = 0
    g.mesh.visible = true
    for (const c of g.circles) this.field.addCircle(c)
    for (const ci of g.cells) this.field.blocked[ci] = 1
    this.field.updateFlow(this.player.pos.x, this.player.pos.z, true)
    this.sound('thorns', g.center, { indicate: false })
  }

  private openGate() {
    const g = this.level.gate
    if (!g || !g.closed) return
    g.closed = false
    g.mesh.visible = false
    g.mesh.position.y = -4.5
    for (const c of g.circles) this.field.removeCircle(c)
    for (const ci of g.cells) this.field.blocked[ci] = 0
    this.field.updateFlow(this.player.pos.x, this.player.pos.z, true)
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Tab') {
      e.preventDefault()
      if (this.sumaOpen) this.closeSuma()
      else this.openSuma()
      return
    }
    if (e.code === 'Escape') {
      if (this.sumaOpen) return this.closeSuma()
      if (this.restOpen) return this.closeRest()
      const s = hud.get().screen
      if (s === 'playing') this.pause()
      else if (s === 'paused') this.resume()
    }
    if (e.code === 'Backquote') {
      this.debug = !this.debug
      if (!this.debug) hud.set({ debug: null })
    }
  }

  // ------------------------------------------------------------------ loop

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const real = Math.max(0.0001, (now - this.last) / 1000)
    const rdt = Math.min(0.05, real)
    this.last = now
    this.fpsAcc += real
    this.fpsN++
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.fpsN / this.fpsAcc)
      this.fpsAcc = 0
      this.fpsN = 0
    }
    this.input.pollPad()
    if (this.input.rawPressed('PadView')) {
      if (this.sumaOpen) this.closeSuma()
      else this.openSuma()
    }
    if (this.input.rawPressed('PadStart')) {
      const sc = hud.get().screen
      if (sc === 'playing') this.pause()
      else if (sc === 'paused') this.resume()
      else if (sc === 'title') this.start()
      else if (sc === 'prologue') this.endPrologue()
      else if (sc === 'dead') this.respawn()
    }
    const screen = hud.get().screen
    const simulate = screen === 'playing' || screen === 'dead' || screen === 'victory' || screen === 'epilogue'
    this.input.enabled = screen === 'playing' && !this.choiceOpen && !this.loreOpen &&
      !this.restOpen &&
      !this.sumaOpen &&
      this.player.alive && !this.cine
    if (simulate && !this.choiceOpen && !this.loreOpen &&
      !this.restOpen &&
      !this.sumaOpen
    ) this.update(rdt)
    else this.idle(rdt)
    this.render(rdt)
    this.input.endFrame()
  }

  /** Title / pause: keep the world breathing without simulating gameplay. */
  private idle(rdt: number) {
    globalUniforms.uTime.value += rdt
    shaftTime.value += rdt
    this.vfx.update(rdt, this.camera, globalUniforms.uTime.value)
    updateEmitters(this.level.emitters, this.vfx, this.player.pos, rdt)
    this.lighting.update(rdt, this.player.pos)
    this.updateCamera(rdt)
    this.feedVisionLight(rdt)
    this.vision.update(this.player.pos.x, this.player.pos.z, this.player.gaze, rdt)
  }

  private update(rdt: number) {
    let dt = rdt
    if (this.hitstopT > 0) {
      this.hitstopT -= rdt
      dt = 0
    } else if (this.slowmoT > 0) {
      this.slowmoT -= rdt
      dt = rdt * this.slowmoScale
    }
    globalUniforms.uTime.value += rdt
    shaftTime.value += rdt
    const p = this.player

    // mouse -> ground
    const r = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2((this.input.mouseX / r.width) * 2 - 1, -(this.input.mouseY / r.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    this.plane.constant = -1.0
    if (this.input.padActive) {
      // right stick aims; otherwise look where you walk
      const ax = this.input.aimX || this.input.moveX
      const ay = this.input.aimY || this.input.moveY
      if (ax || ay) {
        const wx = Math.cos(CAM_YAW) * ax - Math.sin(CAM_YAW) * ay
        const wz = -Math.sin(CAM_YAW) * ax - Math.cos(CAM_YAW) * ay
        const l = Math.hypot(wx, wz) || 1
        p.aimPoint.set(p.pos.x + (wx / l) * 6, 0, p.pos.z + (wz / l) * 6)
      } else p.aimPoint.set(p.pos.x + Math.sin(p.aimAngle) * 6, 0, p.pos.z + Math.cos(p.aimAngle) * 6)
    } else if (this.raycaster.ray.intersectPlane(this.plane, this.mouseWorld)) p.aimPoint.copy(this.mouseWorld)
    if (this.input.wheel) this.camDist = clamp(this.camDist + this.input.wheel * 1.5, 21, 38)

    if (dt > 0) {
      this.time += dt
      p.update(dt, this.input)
      this.field.updateFlow(p.pos.x, p.pos.z)
      for (const e of this.enemies) if (!e.removed) e.update(dt)
      this.separate()
      this.projectiles.update(dt)
      this.eagle.update(dt)
      this.echo.update(dt)
      this.updateMarten(dt)
      this.updateWorld(dt)
      this.atmosphere(dt)
      this.updateLoot()
      this.updateTracking(dt)
      this.updateBarriers(dt)
      this.updateHollow(dt)
      this.vfx.update(dt, this.camera, globalUniforms.uTime.value)
      updateEmitters(this.level.emitters, this.vfx, p.pos, dt)
    }

    if (this.cine && this.cine.t > 0.4 && this.input.rawPressed('Space')) this.skipScene()
    this.updateScene(rdt)
    this.updateScript(rdt)
    this.updateZones(rdt)
    this.updateTutor(rdt)
    this.updateInteraction()
    this.updateCamera(rdt)
    this.lighting.update(rdt, p.pos)
    this.feedVisionLight(rdt)
    this.vision.update(p.pos.x, p.pos.z, p.gaze, rdt)
    this.audio.setListener(p.pos, CAM_YAW)
    const mood = this.computeMood(rdt)
    this.audio.setMood(mood)
    this.inCombat = mood === 'combat' || mood === 'boss' || mood === 'boss2'
    // the HUD dissolves when nothing is happening and returns with danger or any action
    const acted = ['Mouse0', 'Mouse2', 'Digit1', 'Digit2', 'Space', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyF'].some((c) => this.input.pressed(c))
    const quiet = mood === 'explore' && p.hp >= p.maxHp && !this.interaction && p.state === 'move' && !acted
    this.calmT = quiet ? this.calmT + rdt : 0
    this.audio.lowHp = p.alive ? clamp(1 - p.hp / p.maxHp / 0.35, 0, 1) : 0
    this.audio.update(rdt)

    // death / victory flow
    if (!p.alive) {
      if (this.deathT < 0) {
        this.deathT = 0
        this.narrQueue = [pick(DEATH_LINES)]
        this.narrT = 0
      }
      this.deathT += rdt
      if (this.deathT > 2.6 && hud.get().screen === 'playing') hud.set({ screen: 'dead' })
    }
    if (this.victoryT >= 0) {
      this.victoryT += rdt
      this.dawn = clamp((this.victoryT - 1.5) / 5, 0, 1)

    }

    this.damage = Math.max(0, this.damage - rdt * 1.8)
    this.hudT -= rdt
    if (this.hudT <= 0) {
      this.hudT = 0.08
      this.syncHud()
    }
  }

  private calmT = 0
  /** zones already announced, the title on screen and how long it stays */
  private zonesSeen = new Set<number>()
  private zoneCard: { id: number; name: string; sub: string } | null = null
  private zoneT = 0
  private cryT = 4
  private babbleT = 0
  /** one-time thoughts at the barriers */
  private barrierNoted = new Set<Barrier>()
  private combatHold = 0
  private tensionHold = 0

  /** Adaptive music state with hysteresis so the score cools down instead of cutting off. */
  private computeMood(rdt: number): Mood {
    if (this.victoryT >= 0) return this.victoryT > 1.5 ? 'victory' : 'silent'
    const p = this.player
    if (!p.alive) return 'silent'
    const b = this.boss
    if (b && b.fightStarted && b.alive) return b.phase === 2 ? 'boss2' : 'boss'
    let level = 0
    for (const e of this.enemies) {
      if (!e.alive || !e.aggro || e === b) continue
      const d = e.pos.distanceTo(p.pos)
      if (d < 16 && (e.state === 'chase' || e.state === 'attack' || e.state === 'special')) level = 2
      else if (d < 28) level = Math.max(level, 1)
    }
    this.combatHold = level >= 2 ? 6 : Math.max(0, this.combatHold - rdt)
    this.tensionHold = level >= 1 ? 8 : Math.max(0, this.tensionHold - rdt)
    if (this.combatHold > 0) return 'combat'
    if (this.tensionHold > 0) return 'tension'
    return 'explore'
  }

  private separate() {
    const list: { pos: THREE.Vector3; radius: number; w: number }[] = []
    const p = this.player
    if (p.alive && p.state !== 'grabbed') list.push({ pos: p.pos, radius: p.radius, w: 0.25 })
    for (const e of this.enemies) if (e.alive && !e.hidden && e.airY < 1) list.push({ pos: e.pos, radius: e.radius, w: e.weight === 'heavy' ? 0.1 : 1 })
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const dx = b.pos.x - a.pos.x
        const dz = b.pos.z - a.pos.z
        const d = Math.hypot(dx, dz)
        const min = a.radius + b.radius
        if (d < min && d > 1e-4) {
          const push = (min - d) / d
          const tw = a.w + b.w
          a.pos.x -= dx * push * (a.w / tw)
          a.pos.z -= dz * push * (a.w / tw)
          b.pos.x += dx * push * (b.w / tw)
          b.pos.z += dz * push * (b.w / tw)
        }
      }
    }
  }

  private lanternHalo: Halo | null = null

  /** Falling needles and leaves, drifting ground fog, fire crackle and water babble near the hero. */
  private atmosphere(dt: number) {
    const p = this.player.pos
    const vfx = this.vfx
    for (let i = 0; i < 2; i++) {
      if (Math.random() > dt * 4) continue
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 11
      const x = p.x + Math.cos(a) * r
      const z = p.z + Math.sin(a) * r
      const g = this.level.grove
      const gold = fbm(x * 0.06 + 3, z * 0.06 - 2) > 0.58 || (!!g && g.revived && Math.hypot(g.center.x - x, g.center.z - z) < 10)
      vfx.soft.spawn({ x, y: 6 + Math.random() * 3, z, vx: 0.25 + Math.random() * 0.3, vy: -0.55 - Math.random() * 0.35, vz: (Math.random() - 0.5) * 0.3, r: gold ? 0.42 : 0.15, g: gold ? 0.28 : 0.1, b: gold ? 0.07 : 0.055, a: 0.95, size: gold ? 0.11 : 0.07, life: 11, drag: 0.15 })
    }
    if (Math.random() < dt * 1.3) {
      const a = Math.random() * Math.PI * 2
      const r = 3 + Math.random() * 11
      const x = p.x + Math.cos(a) * r
      const z = p.z + Math.sin(a) * r
      if (this.field.sample(x, z) > -1)
        vfx.soft.spawn({ x, y: 0.35 + Math.random() * 0.5, z, vx: 0.18, vy: 0.02, vz: 0.06, r: 0.16, g: 0.2, b: 0.27, a: 0.07, size: 3 + Math.random() * 2.5, life: 10, drag: 0, grow: 0.6 })
    }
    for (const f of this.level.fires) if (f.pos.distanceTo(p) < 14 && Math.random() < dt * 2.6) this.audio.play('crackle', f.pos, 0.7)
    for (const b of this.level.braziers) if (b.lit && b.pos.distanceTo(p) < 12 && Math.random() < dt * 1.6) this.audio.play('crackle', b.pos, 0.45)
    const s = this.level.spring
    if (s && s.pos.distanceTo(p) < 11 && Math.random() < dt * 3) this.audio.play('water', s.pos, 0.6)
    // the stream babbles from the nearest stretch of water
    this.babbleT -= dt
    if (this.babbleT <= 0) {
      this.babbleT = 0.35 + Math.random() * 0.3
      let best: THREE.Vector3 | null = null
      let bd = 13
      for (const w of this.level.waterSpots) {
        const d = Math.hypot(w.x - p.x, w.z - p.z)
        if (d < bd) {
          bd = d
          best = w
        }
      }
      if (best) this.audio.play('water', best, 0.35 * (1 - bd / 13))
    }
  }

  private updateWorld(dt: number) {
    const L = this.level
    const p = this.player
    // gate thorns rising
    const g = L.gate
    if (g && g.closed && g.anim < 1) {
      g.anim = Math.min(1, g.anim + dt * 1.3)
      g.mesh.position.y = lerp(-4.5, 0, 1 - Math.pow(1 - g.anim, 3))
    }
    // boss fight trigger
    const b = this.boss
    // the intro scene starts once: the fight itself only begins in its second shot
    if (g && b && b.alive && !b.fightStarted && !this.bossIntro && p.alive && p.pos.z < g.center.z - 1.2) {
      this.bossIntro = true
      this.closeGate()
      const intro = BOSS_INTRO
      this.playScene(
        [
          { cam: { x: b.pos.x, z: b.pos.z + 2, dist: 19 }, dur: 1.3 },
          { dur: 2.6, line: intro.lines?.[0], run: () => b.startFight() },
          { cam: null, dur: 0.9 },
        ],
        () => this.hintQueue.push(...(intro.hints ?? [])),
      )
    }
    // revived grove
    const gr = L.grove
    if (gr && gr.revived && gr.t < 1) {
      gr.t = Math.min(1, gr.t + dt * 0.5)
      const k = 1 - Math.pow(1 - gr.t, 3)
      for (const f of gr.foliage) {
        f.scale.setScalar(Math.max(0.001, k))
        f.position.y = -0.5 + k * 0.5
      }
    }
    // the stream: moonlight on the ripples, foam collars and wakes around anyone wading
    if (L.stream) {
      const waders: { x: number; z: number }[] = []
      const p = this.player
      if (p.alive && p.airY < 0.3) waders.push(p.pos)
      for (const e of this.enemies) {
        if (waders.length >= 4) break
        if (e.alive && this.field.isWater(e.pos.x, e.pos.z)) waders.push(e.pos)
      }
      L.stream.update(this.lighting.moon, waders)
    }
    // floating drop
    const d = L.drop
    if (d && !d.taken) {
      d.orb.position.y = 1.35 + Math.sin(this.time * 2) * 0.08
      d.orb.rotation.y += dt
    }
    // first stagger hint
    if (!this.shownStagger && this.enemies.some((e) => e.finishable)) {
      this.shownStagger = true
      this.beat(FIRST_STAGGER)
    }
  }

  private updateScript(rdt: number) {
    const p = this.player
    for (const t of this.level.triggers) {
      if (t.fired) continue
      if (Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < 4.5) {
        t.fired = true
        if (t.id === '5') {
          // the pack answers from the ravine ahead long before it is seen
          const wolf = this.enemies.find((e) => e.kind === 'wolf' && e.alive)
          if (wolf) this.sound('wolf_howl', wolf.pos, { tone: 'threat', strength: 0.9, id: wolf.id })
        }
        if (t.id === 'h' || t.id === 'H') this.gainSkaz(SKAZ.echo)
        if (t.id === 'h') {
          // the dead hunter's last seconds: he runs toward the spring, glances back, falls
          this.echo.play(new THREE.Vector3(t.pos.x + 1.5, 0, t.pos.z - 8), [
            { to: new THREE.Vector3(t.pos.x + 0.8, 0, t.pos.z - 3.5), dur: 1.4 },
            { to: t.pos.clone(), dur: 1.1, look: -1.1, whisper: true },
            { clip: HERO_CLIPS.death, dur: 1.5 },
          ])
        } else if (t.id === 'A') {
          // thirty winters ago a man rested here with a child in his arms, then hurried east (docs/STORY.md)
          const at = new THREE.Vector3(t.pos.x - 5, 0, t.pos.z + 1)
          this.gainSkaz(SKAZ.echo)
          this.echo.play(at, [
            { to: new THREE.Vector3(t.pos.x - 0.8, 0, t.pos.z + 0.4), dur: 1.6 },
            { clip: HERO_CLIPS.interact, dur: 2.2, whisper: true },
            { dur: 0.9, look: 0.9 },
            { to: new THREE.Vector3(t.pos.x + 6, 0, t.pos.z - 2.5), dur: 2.0 },
          ])
        } else if (t.id === 'H') {
          // a herder tending the horse turns toward something in the dark, stumbles back and falls
          const at = new THREE.Vector3(t.pos.x + 1.3, 0, t.pos.z + 0.4)
          this.echo.play(
            at,
            [
              { clip: HERO_CLIPS.interact, dur: 1.8 },
              { dur: 1.0, look: 1.1, whisper: true },
              { to: new THREE.Vector3(at.x + 1.4, 0, at.z + 2.2), dur: 0.9 },
              { clip: HERO_CLIPS.hurt, dur: 0.45 },
              { clip: HERO_CLIPS.death, dur: 1.5 },
            ],
            Math.atan2(t.pos.x - at.x, t.pos.z - at.z),
          )
        }
        const beat = TRIGGERS[t.id]
        if (beat) this.beat(beat)
      }
    }
    // narration
    this.narrT -= rdt
    if (this.narrT <= 0) {
      const next = this.narrQueue.shift()
      if (next) {
        const n = typeof next === 'string' ? { who: 'Сэсэн', text: next } : next
        this.curNarr = { id: ++this.narrId, speaker: n.who, text: n.text }
        this.narrT = Math.max(3.8, n.text.length * 0.065)
      } else this.curNarr = null
    }
    this.hintT -= rdt
    // contextual hints wait while a lesson is on screen: one instruction at a time
    if (this.hintT <= 0) {
      const next = this.tutor.active ? undefined : this.hintQueue.shift()
      this.curHint = next ?? null
      this.hintT = next ? Math.max(6, next.length * 0.075) : 0
    }
  }

  /** Feeds the onboarding with what Timer actually did this frame. */
  private updateTutor(rdt: number) {
    const p = this.player
    const tt = this.tutor
    const live = hud.get().screen === 'playing' && !this.cine && !this.choiceOpen && !this.loreOpen && !this.restOpen && p.alive
    const prev = this.tutorPrev
    if (live && prev) {
      const t = tt.tally
      if (p.state === 'move') t.moved += Math.min(1, Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z))
      t.turned += Math.abs(wrapAngle(p.gaze - prev.gaze))
      if (this.sense > 0.5) t.sense += rdt
      if (p.swings > prev.swings) t.attacks += p.swings - prev.swings
      if (p.state === 'dodge' && prev.state !== 'dodge') t.dodges++
      if (p.stance) t.stance += rdt
      if (p.sips < prev.sips) t.sips++
    }
    this.tutorPrev = { x: p.pos.x, z: p.pos.z, gaze: p.gaze, sips: p.sips, state: p.state, swings: p.swings }
    if (!live) return
    if (this.inCombat) tt.begin('fight', true)
    if (p.hp < p.maxHp * 0.5 && p.sips > 0 && !this.inScene) tt.begin('wounds', true)
    if (tt.update(rdt)) this.audio.play('ui', null, 0.45)
  }

  setTutor(on: boolean) {
    this.tutor.setEnabled(on)
    hud.set({ tutorOn: on })
  }

  private updateInteraction() {
    const p = this.player
    this.interaction = null
    if (!p.alive || p.state !== 'move' || this.choiceOpen) return
    const L = this.level
    for (const e of this.enemies) {
      if (e.finishable && e.pos.distanceTo(p.pos) < e.radius + 2.4) {
        this.interaction = { label: 'Добить', run: () => p.startFinisher(e) }
        break
      }
    }
    if (!this.interaction) this.interaction = this.barrierInteraction()
    if (!this.interaction && this.marten?.state === 'trapped' && L.trap && L.trap.pos.distanceTo(p.pos) < 2.4) {
      this.interaction = { label: 'Разжать капкан', run: () => p.startInteract(() => this.freeMarten()) }
    }
    if (!this.interaction) {
      for (const id of Object.keys(L.clues) as ClueId[]) {
        const at = L.clues[id]!
        if (this.clueFound.has(id) || !CLUES[id].prompt || Math.hypot(at.x - p.pos.x, at.z - p.pos.z) > 2.3) continue
        this.interaction = { label: CLUES[id].prompt, run: () => p.startInteract(() => this.findClue(id)) }
        break
      }
    }
    if (!this.interaction && L.spring && L.spring.pos.distanceTo(p.pos) < 3.3) {
      const s = L.spring
      this.interaction = {
        label: 'Отдохнуть у родника',
        run: () =>
          p.startInteract(() => {
            p.sips = p.maxSips
            p.checkpoint.set(s.pos.x, 0, s.pos.z + 2.6)
            this.sound('spring', s.pos, { indicate: false })
            this.vfx.rings.spawn(s.pos.x, s.pos.z, { from: 1, to: 6, dur: 1.2, color: new THREE.Color(0.3, 1.4, 1.2), width: 0.05 })
            if (!this.springUsedOnce) {
              this.springUsedOnce = true
              this.beat(SPRING_USED)
            }
            this.openRest('spring')
          }),
      }
    }
    if (!this.interaction) {
      for (const f of L.fires) {
        if (f.pos.distanceTo(p.pos) > 3.4) continue
        this.interaction = {
          label: 'Отдохнуть у огня',
          run: () =>
            p.startInteract(() => {
              p.checkpoint.set(f.pos.x + 1.6, 0, f.pos.z + 1.6)
              this.rpg.oil = 1
              this.sound('ignite', f.pos, { indicate: false, vol: 0.5 })
              this.openRest('fire')
            }),
        }
        break
      }
    }
    if (!this.interaction) {
      for (const pk of this.pickups.list) {
        if (pk.taken || pk.auto || pk.pos.distanceTo(p.pos) > 1.9) continue
        this.interaction = {
          label: pk.label,
          run: () => p.startInteract(() => this.collect(pk)),
        }
        break
      }
    }
    if (!this.interaction && L.drop && !L.drop.taken && L.drop.pos.distanceTo(p.pos) < 2.7) {
      this.interaction = {
        label: 'Склониться над каплей',
        run: () => {
          this.choiceOpen = true
          this.input.reset()
          hud.set({ choice: true })
        },
      }
    }
    if (!this.interaction) {
      for (const t of L.tamgas) {
        if (t.pos.distanceTo(p.pos) > 2.3) continue
        this.interaction = {
          label: t.read ? 'Перечитать тамгу' : 'Прочесть тамгу',
          run: () => {
            if (!t.read) this.gainSkaz(SKAZ.tamga)
            t.read = true
            this.openLore(t.id)
          },
        }
        break
      }
    }
    if (!this.interaction) {
      for (const b of L.braziers) {
        if (b.lit || b.pos.distanceTo(p.pos) > 2.5) continue
        const canLight = p.torchOn && p.torchDoused <= 0
        this.interaction = canLight
          ? { label: 'Зажечь жаровню', run: () => p.startInteract(() => this.setBrazier(b, true, true)) }
          : { label: p.torchDoused > 0 ? 'Фонарь ещё не разгорелся' : 'Нужен огонь фонаря: [T]' }
        break
      }
    }
    if (!this.interaction && this.rpg.oil < 0.95) {
      for (const b of L.braziers) {
        if (!b.lit || b.pos.distanceTo(p.pos) > 2.5) continue
        this.interaction = {
          label: 'Долить масло',
          run: () =>
            p.startInteract(() => {
              this.rpg.oil = 1
              this.sound('ignite', b.pos, { indicate: false, vol: 0.4 })
              this.toast('Фонарь полон', 'info', 'lantern')
            }),
        }
        break
      }
    }
    if (this.interaction && this.input.pressed('KeyF') && this.interaction.run) this.interaction.run()
  }

  /**
   * Light decides how far Timer sees (docs/GDD.md, «Свет и обзор»): night eyes reach a few metres and follow
   * the moon behind the clouds; beyond them the cone shows only lit places. Every light of the level counts
   * (fires, braziers, moon shafts, the spring, glowing mushrooms) and the lantern carries a circle with him.
   */
  private feedVisionLight(rdt: number) {
    const p = this.player
    const v = this.vision
    const moon = moonLevel.value
    v.darkFull = lerp(lerp(3, 5, moon), v.range, this.dawn)
    v.darkFade = lerp(lerp(6.5, 9.5, moon), v.range + 4, this.dawn)
    const lit = p.torchOn && p.torchDoused <= 0 && p.alive
    // running dry, the circle shrinks with the flame
    const oil = this.rpg.oil
    const target = lit ? (oil < 0.15 ? 0.6 + 0.4 * (oil / 0.15) : 1) : 0
    this.lanternVis += (target - this.lanternVis) * (1 - Math.exp(-6 * rdt))
    const list = this.visLights
    list.length = 0
    list.push({ x: p.pos.x, z: p.pos.z, full: 7, fade: 11, level: this.lanternVis })
    // a point light of reach D shows its surroundings to about half of it
    for (const s of this.lighting.sources) list.push({ x: s.pos.x, z: s.pos.z, full: s.distance * 0.3, fade: s.distance * 0.5, level: s.level })
    v.setLights(list)
  }

  private updateCamera(rdt: number) {
    const p = this.player
    const lead = this.tmpV.copy(p.aimPoint).sub(p.pos).setY(0)
    const ll = lead.length()
    if (ll > 7) lead.multiplyScalar(7 / ll)
    lead.multiplyScalar(0.28)
    const tx = p.pos.x + lead.x
    const tz = p.pos.z + lead.z
    const cg = this.cineGoal
    const k = 1 - Math.exp(-(cg || this.cine ? 1.7 : 5) * rdt)
    this.camTarget.x += ((cg ? cg.x : tx) - this.camTarget.x) * k
    this.camTarget.z += ((cg ? cg.z : tz) - this.camTarget.z) * k
    this.camTarget.y = 0
    // pull back a little during the boss duel to frame his reach and leaps
    const bossOn = !!this.boss && this.boss.fightStarted && this.boss.alive
    const goalDist = cg?.dist ?? this.camDist + (bossOn ? 5 : 0)
    this.camDistS += (goalDist - this.camDistS) * (1 - Math.exp(-(this.cine ? 0.9 : 1.5) * rdt))
    const d = this.camDistS
    const ox = Math.sin(CAM_YAW) * Math.cos(PITCH) * d
    const oy = Math.sin(PITCH) * d
    const oz = Math.cos(CAM_YAW) * Math.cos(PITCH) * d
    this.shakeAmt *= Math.exp(-6 * rdt)
    const s = this.shakeAmt * 0.3
    this.camera.position.set(this.camTarget.x + ox + rand(-s, s), oy + rand(-s, s), this.camTarget.z + oz + rand(-s, s))
    this.camera.lookAt(this.camTarget.x, 0.8, this.camTarget.z)
    this.camera.updateMatrixWorld()
  }

  private render(rdt: number) {
    if (!this.ready) return
    const p = this.player
    if (!this.lanternHalo) this.lanternHalo = this.level.halos.add(new THREE.Vector3(), new THREE.Color(1, 0.62, 0.3), 2.6, 0.32, null)
    p.model.lanternGlow.getWorldPosition(this.lanternHalo.sprite.position)
    this.lanternHalo.strength = p.torchOn && p.torchDoused <= 0 && p.alive ? 0.32 : 0
    this.level.halos.update(globalUniforms.uTime.value)
    // hero occlusion dissolve uniforms
    const v = this.tmpV.set(p.pos.x, 1.0 + p.airY, p.pos.z)
    const viewZ = v.clone().applyMatrix4(this.camera.matrixWorldInverse).z
    v.project(this.camera)
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    globalUniforms.uPlayerScreen.value.set(((v.x + 1) / 2) * size.x, ((v.y + 1) / 2) * size.y)
    globalUniforms.uPlayerDepth.value = -viewZ
    globalUniforms.uCamWorld.value.copy(this.camera.matrixWorld)

    // grading
    const fu = this.post.finalMat.uniforms
    fu.uTime.value = globalUniforms.uTime.value
    fu.uDamage.value = this.damage
    fu.uLowHp.value = p.alive ? clamp(1 - p.hp / p.maxHp / 0.3, 0, 1) : 0.6
    fu.uSlowmo.value = this.slowmoT > 0 ? 1 : 0
    fu.uWarm.value = this.dawn
    fu.uExposure.value = 1.25 + this.dawn * 0.35
    fu.uFade.value = this.deathT > 0 ? clamp((this.deathT - 0.8) / 2, 0, 0.7) : 0
    const vu = this.post.visionMat.uniforms
    vu.uTime.value = globalUniforms.uTime.value
    vu.uVisMin.value.copy(this.vision.min)
    vu.uVisSize.value.copy(this.vision.size)
    vu.uMist.value = 1 - this.dawn * 0.6
    // clouds drift over the moon: the whole forest slowly darkens and brightens again
    const tt = globalUniforms.uTime.value
    const cloud = clamp(0.45 + fbm(tt * 0.035, 7.3, 3) * 0.9, 0.35, 1)
    moonLevel.value += (cloud - moonLevel.value) * (1 - Math.exp(-0.8 * rdt))
    this.lighting.moon.intensity = lerp(0.5, 1.05, moonLevel.value)
    if (this.dawn > 0) {
      this.lighting.moon.color.setRGB(lerp(0.55, 1.0, this.dawn), lerp(0.68, 0.72, this.dawn), lerp(1.0, 0.5, this.dawn))
      this.lighting.moon.intensity = lerp(1.0, 1.8, this.dawn)
      this.lighting.hemi.intensity = lerp(0.4, 1.0, this.dawn)
    }

    this.renderer.shadowMap.needsUpdate = true
    this.frameN++
    this.lighting.lantern.shadow.needsUpdate = (this.frameN & 1) === 0 || this.quality === 'high' && this.fps > 100
    const ghosts = this.enemies.some((e) => e.revealT > 0 && e.alive && !e.visibleNow && !e.hidden)
    this.post.render(this.scene, this.camera, this.vision.texture, rdt, ghosts, this.overlay)

    this.indicators.draw(this.camera, rdt)
    const scr = hud.get().screen
    if (scr === 'playing') {
      for (const e of this.enemies) {
        if (!e.alive || e.kind === 'boss' || !e.visibleNow || (!e.aggro && e.hp >= e.maxHp)) continue
        const hp = this.tmpV.set(e.pos.x, 2.25 + e.hitHeight + e.airY, e.pos.z).project(this.camera)
        const w = this.container.clientWidth
        const h = this.container.clientHeight
        this.indicators.drawBar(((hp.x + 1) / 2) * w, ((1 - hp.y) / 2) * h, e.hp / e.maxHp, e.posture / e.maxPosture, e.finishable)
      }
    }
    if (this.debug) {
      const i = this.renderer.info.render
      hud.set({ debug: `${this.fps} fps · ${i.calls} draw · ${(i.triangles / 1000).toFixed(0)}k tris · ${this.enemies.filter((e) => e.alive).length} foes` })
    }
  }

  

  syncHud() {
    const p = this.player
    const b = this.boss
    if (!this.bowHinted && p.weapon === 'bow') {
      this.bowHinted = true
      this.beat({ hints: ['Держи [ЛКМ] — Тимер натягивает лук, отпусти — выстрел. Чем дольше держишь, тем сильнее и дальше. [ПКМ] — опустить лук.'] })
    }
    if (!this.zealHinted && p.zeal >= 10) {
      this.zealHinted = true
      this.beat({ hints: ['Загорелся огонь запала. Держи [ЛКМ]: Рассечение потратит огни. Три огня — Удар беркута.'] })
    }
    const partial: Partial<HudState> = {
      hp: Math.max(0, Math.round(p.hp)),
      zeal: Math.floor(p.zeal),
      maxHp: p.maxHp,
      sips: p.sips,
      maxSips: p.maxSips,
      dodge: p.dodgeCharges,
      dodgeMax: p.dodgeMax,
      dodgeRecharge: p.dodgeCharges < p.dodgeMax ? 1 - Math.max(0, p.dodgeRecharge) / 1.1 : 1,
      lassoCd: p.lassoCd / 5,
      eagleCd: p.eagleCd / 14,
      bowDraw: p.state === 'bow' ? p.bowDraw : 0,
      weapon: p.weapon,
      torchOn: p.torchOn,
      torchDoused: p.torchDoused,
      boss:
        b && b.fightStarted && b.alive
          ? { name: 'Шурале', title: 'хозяин урмана', hp: b.hp, maxHp: b.maxHp, posture: b.posture, maxPosture: b.maxPosture }
          : null,
      prompt: this.interaction ? this.interaction.label : null,
      narration: this.curNarr,
      hint: this.curHint,
      tutor: this.tutor.view(),
      zone: this.zoneCard,
      grab: p.state === 'grabbed' ? p.grabProgress : null,
      combat: this.inCombat,
      drunk: this.drunk,
      given: this.given,
      kills: this.kills,
      deaths: this.deaths,
      fps: this.fps,
      calm: this.calmT > 3.5,
      sense: this.sense > 0.5,
      companion: this.marten?.active ? { state: this.marten.state, threats: this.marten.sensed.length } : null,
    }
    const now = performance.now() / 1000
    this.toastList = this.toastList.filter((t) => now - t.t < 3.6)
    partial.toasts = this.toastList.map(({ id, text, kind, icon }) => ({ id, text, kind, icon }))
    const snap = this.rpg.snapshot()
    const sig = JSON.stringify(snap)
    if (sig !== this.rpgSig) {
      this.rpgSig = sig
      partial.rpg = snap
    }
    if (partial.boss) {
      partial.boss.hp = Math.round(partial.boss.hp)
      partial.boss.posture = Math.round(partial.boss.posture)
    }
    hud.set(partial)
  }
}
