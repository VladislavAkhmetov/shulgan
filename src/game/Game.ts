import * as THREE from 'three'
import { hud, type EndingId, type HudState } from './core/store'
import { Input } from './core/input'
import { CELL, parseLevel, zoneAt, type LevelData, type Zone } from './level/map'
import { CLAY2, FOREST_ROW2 } from './level/map2'
import { ABYSS_ROW, SUMMIT_ROW } from './level/map3'
import { CHAPTERS, freshCarry, saveProgress, type Carry, type ChapterDef, type ChapterId } from './chapters'
import type { Director } from './director'
import { Chapter2 } from './chapter2'
import { Chapter3 } from './chapter3'
import { Field } from './level/field'
import { buildLevel, moonLevel, shaftTime, updateEmitters, type Barrier, type Brazier, type ColdFire, type Drop, type LevelBuild } from './level/build'
import type { Halo } from './level/dressing'
import { assignShadowLayers, LAYER_LANTERN_SHADOW, limb, trimShadows } from './level/geo'
import { Lighting } from './render/lights'
import { projScale, VFX } from './render/vfx'
import { Vision } from './render/vision'
import { PostFX } from './render/post'
import { globalUniforms, std } from './render/materials'
import { SoundIndicators } from './render/indicators'
import { AudioEngine, type SoundKind } from './audio/audio'
import type { Mood } from './audio/music'
import { Player } from './actors/player'
import { createAzamat, HERO_CLIPS } from './actors/models'
import type { Humanoid } from './actors/rig'
import { Enemy, Morok, Ubyr, Wolf, WolfLeader } from './actors/enemies'
import { Shurale, type Boss } from './actors/boss'
import { KurganArcher, KurganGuard, Shade } from './actors/enemies2'
import { SuInahi } from './actors/suinahi'
import { Shulgen } from './actors/shulgen'
import { Azamat } from './actors/azamat'
import { Projectiles } from './actors/projectiles'
import { CLUES, QUESTIONS, journal, type ClueId } from './clues'
import { wearGlb } from './actors/skin'
import { Marten } from './actors/marten'
import { HeroAnimator } from './actors/heroAnim'
import { Eagle } from './actors/eagle'
import { Echo } from './echo'
import { Tutor } from './tutor'
import { KEEPSAKES, KitState } from './rpg/state'
import { Pickups, type Pickup } from './rpg/pickups'
import type { BossEvent, World } from './world'
import type { SoundOpts } from './types'
import {
  AZAMAT_RESCUE,
  COLD_FIRE,
  THREAD_LINES,
  DEATH_LINES,
  DROP_DRINK,
  DROP_GIVE,
  FIRST_DROP,
  FIRST_STAGGER,
  OPENING,
  PROLOGUE_02,
  RIBBON,
  SHURALE_DEFEAT,
  SHURALE_INTRO,
  SHURALE_PHASE2,
  SPRING_USED,
  SUSAR_TRAP,
  TRIGGERS,
  ENDINGS,
  type Beat,
  type Line,
} from './script'
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

export interface Interaction {
  label: string
  /** the key shown with the label ([E] by default) */
  key?: string
  /** seconds [E] must be held */
  hold?: number
  run?: () => void
}

/** Shurale's root trap: a ring warns, then black roots break out and hold Aldar unless the vessel's flash burns them */
interface RootTrap {
  pos: THREE.Vector3
  t: number
  erupted: boolean
  mesh: THREE.Group
}

const ROOT_WARN = 1.2
const ROOT_R = 2.2

/** a sesen line or someone else's */
export type Say = string | Line

export interface GameOpts {
  chapter?: ChapterId
  /** what Aldar carries in from the chapter before */
  carry?: Carry
  /** start the chapter's tale as soon as the level is built (a chapter after the first) */
  autostart?: boolean
  /** the next chapter is asked for (null — the kubair is over) */
  onChapterEnd?: (next: ChapterId | null, carry: Carry) => void
}

export class Game implements World {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  /** drawn after the vision mask (memory echoes) */
  readonly overlay = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly input: Input
  readonly audio = new AudioEngine()
  readonly kit = new KitState()
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
  boss: Boss | null = null
  readonly chapter: ChapterId
  readonly def: ChapterDef
  zones: Zone[] = []
  director: Director | null = null
  /** Azamat at his father's side (chapters 2–3) */
  son: Azamat | null = null
  private opts: GameOpts
  /** lights the chapter adds to the vision mask this frame (the parry flare, the blood sense) */
  readonly extraVis: { x: number; z: number; full: number; fade: number; level: number }[] = []
  /** how far night eyes reach (the cave has no moon) and how much moonlight there is (0..1) */
  nightEyes = 1
  moonScale = 1
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
  private frameMs = 16.7
  private frameP95 = 16.7
  private frameTimes: number[] = []
  narrQueue: Say[] = []
  private narrT = 0
  private narrId = 0
  hintQueue: string[] = []
  hintT = 0
  private curHint: string | null = null
  private curNarr: { id: number; speaker: string; text: string } | null = null
  private interaction: Interaction | null = null
  /** chapter 3: the choice at the bowl is open */
  private finalOpen = false
  private scarT = 0
  /** [E] held on a hold-interaction */
  private holdT = 0
  private holdLabel = ''
  /** the drop whose choice is open */
  private choiceDrop: Drop | null = null
  private loreOpen = false
  readonly tutor = new Tutor()
  private tutorPrev: { x: number; z: number; gaze: number; state: string; swings: number; shots: number; parries: number; bashes: number; breaths: number } | null = null
  /** signs Aldar has read (src/game/clues.ts) */
  readonly clueFound = new Set<ClueId>()
  /** Susar */
  marten: Marten | null = null
  private scentT = 0
  private trapHeard = false
  private firstDropSaid = false
  private inCombat = false
  private toastList: { id: number; text: string; kind: 'item' | 'info' | 'warn'; icon?: string; t: number }[] = []
  private toastId = 0
  private kitSig = ''
  bossIntro = false
  private deathT = -1
  victoryT = -1
  /** 0..1: the sun rises once the debt is returned (chapter 3) */
  dawn = 0
  /** the vessel's share in the vision mask, faded so lighting and clogging are not a hard cut */
  private lanternVis = 0
  private focusVis = 0
  private visLights: { x: number; z: number; full: number; fade: number; level: number }[] = []
  kills = 0
  deaths = 0
  private shownStagger = false
  private amberTaught = false
  private redTaught = false
  private springUsedOnce = false
  private debug = false
  private debugHudT = 0
  private debugShieldShadow = true
  private debugLanternShadow = true
  private debugShadowFrozen = false
  private debugGpu = ''
  private tmpV = new THREE.Vector3()
  private quality: 'high' | 'low' = 'high'
  private buildTimer = 0
  private disposed = false
  private frameN = 0
  private roots: RootTrap[] = []
  private rootMat = std(0x0b0806, 0.9)
  /** Azamat, once he climbs down from the hollow (the end of the chapter) */
  private azamat: { rig: Humanoid; phase: 'descend' | 'walk' | 'stand'; t: number; pos: THREE.Vector3; facing: number } | null = null
  /** when Aldar last tried to leave the clearing without the coal */
  private emberNagT = -10

  constructor(container: HTMLElement, opts: GameOpts = {}) {
    this.container = container
    this.opts = opts
    this.chapter = opts.chapter ?? 1
    this.def = CHAPTERS[this.chapter]
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    // Vision, shadows and postprocessing all belong to one frame, not just the final fullscreen draw.
    this.renderer.info.autoReset = false
    const gl = this.renderer.getContext()
    const gpu = gl.getExtension('WEBGL_debug_renderer_info')
    this.debugGpu = String(gl.getParameter(gpu ? gpu.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    this.renderer.setClearColor(0x020306, 1)
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' })
    container.appendChild(this.renderer.domElement)
    this.indicators = new SoundIndicators(container)
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 140)
    this.input = new Input(this.renderer.domElement)
    window.addEventListener('keydown', this.onKey)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    hud.reset()
    hud.set({ screen: 'title', chapter: this.chapter, loadingText: this.chapter === 1 ? 'Урман просыпается…' : this.chapter === 2 ? 'Степь курганов просыпается…' : 'Гора дышит холодом…' })
    // Build on the next frame so the title screen paints first.
    this.buildTimer = window.setTimeout(() => this.build(), 30)
  }

  // ------------------------------------------------------------------ setup

  private async build() {
    const t0 = performance.now()
    const def = this.def
    this.zones = def.zones
    this.levelData = parseLevel(def.map)
    this.field = new Field(this.levelData)
    this.lighting = new Lighting(this.scene)
    this.vfx = new VFX(this.scene)
    this.level = buildLevel(this.scene, this.levelData, this.field, this.lighting, this.vfx, {
      biome: def.biome,
      loreBase: def.loreBase,
      summitRow: this.chapter === 3 ? SUMMIT_ROW : undefined,
      abyssRow: this.chapter === 3 ? ABYSS_ROW : undefined,
      clay: this.chapter === 2 ? CLAY2 : undefined,
      forestRow: this.chapter === 2 ? FOREST_ROW2 : undefined,
    })
    // drops are numbered through the whole kubair: two in the urman, two by the black waters, the last on the mountain
    const dropBase = this.chapter === 1 ? 0 : this.chapter === 2 ? 2 : 4
    for (const d of this.level.drops) d.n += dropBase
    this.applyEnv()
    this.vision = new Vision(this.renderer, this.field, this.levelData.width, this.levelData.depth)
    this.post = new PostFX(this.renderer, 4, 4)
    this.post.visionMat.uniforms.uFogColor.value.setRGB(...def.env.fog)
    this.projectiles = new Projectiles(this)
    this.player = new Player(this)
    // the hero's Mixamo body; if it fails, the static GLB skinned to the procedural rig; if that fails, the procedural body
    const pl = this.player
    const heroReady = HeroAnimator.load(pl.rig, '/models/hero_rig.glb', 1.82, pl.model.props, pl.rig.flashMats)
      .then((a) => {
        if (this.disposed) return
        pl.anim = a
        a.setOutfit('kaftan')
        this.scene.add(a.root)
      })
      .catch((e) => {
        console.warn('hero_rig.glb', e)
        return wearGlb(pl.rig, '/models/hero.glb', { height: 1.97, keep: pl.model.props })
      })
      .catch((e) => console.warn('hero.glb', e))
    this.player.pos.copy(this.level.start)
    this.player.checkpoint.copy(this.level.start)
    // he comes back from the river and looks at what is left of the yurt; later chapters start facing north, up the way
    const h = this.level.hearth
    const face = h ? Math.atan2(h.pos.x - this.level.start.x, h.pos.z - this.level.start.z) : Math.PI
    this.player.facing = this.player.aimAngle = this.player.gaze = face
    this.applyCarry()
    this.eagle = new Eagle(this)
    this.echo = new Echo(this, this.overlay)
    // Susar waits in a rusty trap by the old spring (docs/LEVELS.md, zone 8)
    const trap = this.level.trap
    if (trap) this.marten = new Marten(this, new THREE.Vector3(trap.pos.x - 0.15, 0, trap.pos.z + 0.1))
    else if (this.chapter > 1) {
      // father, son and the marten go together (docs/COMPANION.md)
      const st = this.level.start
      this.marten = new Marten(this, new THREE.Vector3(st.x + 1.5, 0, st.z - 3))
      this.marten.state = 'follow'
      this.son = new Azamat(this, new THREE.Vector3(st.x + 0.9, 0, st.z + 1.2))
    }
    this.pickups = new Pickups(this.scene)
    this.placeLoot()
    for (const s of this.level.stuckArrows) this.projectiles.spawnStuck(s.pos, s.dir)
    for (const s of this.level.spawns) {
      if (s.ch === 'B') {
        // Shurale waits in the crown of the great oak
        const at = this.level.oak ?? new THREE.Vector3(s.x, 0, s.z)
        this.boss = new Shurale(this, at.x, at.z)
        this.enemies.push(this.boss)
      } else if (s.ch === 'V') {
        // Хыу инәһе waits under the black pool among the islets
        this.boss = new SuInahi(this, s.x, s.z, this.level.arenaCenter, this.level.extras.islets)
        this.enemies.push(this.boss)
      } else if (s.ch === 'X') {
        // Shulgen sits on his stone at the bowl
        this.boss = new Shulgen(this, s.x, s.z, this.level.extras.basin ?? this.level.arenaCenter)
        this.enemies.push(this.boss)
      } else if (s.ch === 'U') this.enemies.push(new Ubyr(this, s.x, s.z, true))
      else if (s.ch === 'a') this.enemies.push(new Morok(this, s.x, s.z, true))
      else if (s.ch === 'W') this.enemies.push(new WolfLeader(this, s.x, s.z))
      else if (s.ch === 'G') this.enemies.push(new KurganGuard(this, s.x, s.z))
      else if (s.ch === 'R') this.enemies.push(new KurganArcher(this, s.x, s.z))
      else if (s.ch === '$') this.enemies.push(new Shade(this, s.x, s.z))
      else this.spawnEnemy(s.ch === 'u' ? 'ubyr' : 'wolf', s.x, s.z, false)
    }
    this.director = this.chapter === 2 ? new Chapter2(this) : this.chapter === 3 ? new Chapter3(this) : null
    // shadow budget: tiny details stop casting (characters, story props)
    this.scene.updateMatrixWorld(true)
    this.setupEnvironmentAudio()
    let trimmed = trimShadows(this.player.rig.root) + trimShadows(this.level.root)
    for (const e of this.enemies) trimmed += trimShadows(e.rig.root, e.kind === 'boss' ? 0.2 : 0.14)
    assignShadowLayers(this.level.root)
    assignShadowLayers(this.player.rig.root)
    for (const e of this.enemies) assignShadowLayers(e.rig.root)
    console.info(`[urman] shadow casters trimmed: ${trimmed}`)
    // Tag gear before GLB attachment reparents it, then include the late materials in shader warm-up.
    hud.set({ loadingText: 'Образы проступают…' })
    await Promise.allSettled([
      heroReady,
      this.eagle.ready,
      this.marten?.ready,
      ...this.enemies.map((e) => 'ready' in e.rig ? e.rig.ready : undefined),
    ])
    if (this.disposed) return
    this.camTarget.copy(this.player.pos)
    this.resize()
    this.updateCamera(1)
    this.player.update(0.016, this.input)
    for (const e of this.enemies) e.update(0.016)
    this.lighting.update(0, this.player.pos)
    hud.set({ loadingText: 'Огонь разгорается…' })
    await this.precompile()
    if (this.disposed) return
    this.ready = true
    console.info(`[urman] level built in ${Math.round(performance.now() - t0)} ms, ${this.level.instancedMeshes} instanced batches`)
    hud.set({ loadingText: '' })
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
    if (this.opts.autostart) this.start()
  }

  /** the chapter's palette: moonlight, the cold fill, the low fog (docs/LEVELS.md, «Визуал и атмосфера») */
  private applyEnv() {
    const e = this.def.env
    this.lighting.moon.color.setRGB(...e.moon)
    this.lighting.hemi.color.setRGB(...e.sky)
    this.lighting.hemi.groundColor.setRGB(...e.ground)
    this.lighting.hemi.intensity = e.hemi
  }

  /** what Aldar brought from the chapter before: the drops, the arrows, the keepsakes, the signs read */
  private applyCarry() {
    const c = this.opts.carry ?? freshCarry()
    const kit = this.kit
    kit.waterDebt = c.waterDebt
    kit.earthHealed = c.earthHealed
    kit.keepsakes = new Set(c.keepsakes)
    for (const id of c.clues) this.clueFound.add(id)
    this.kills = c.kills
    this.deaths = c.deaths
    if (this.chapter > 1) {
      kit.ember = true
      kit.bow = true
      kit.maxArrows = Math.max(5, c.maxArrows)
      kit.arrows = Math.min(kit.maxArrows, Math.max(3, c.arrows))
      kit.fervor = Math.max(kit.fervor, 40)
    }
  }

  /** what goes on into the next chapter */
  carry(): Carry {
    const k = this.kit
    return { waterDebt: k.waterDebt, earthHealed: k.earthHealed, arrows: k.arrows, maxArrows: k.maxArrows, keepsakes: [...k.keepsakes], clues: [...this.clueFound], kills: this.kills, deaths: this.deaths }
  }

  /** on to the next chapter (the kubair is saved at its threshold) */
  nextChapter() {
    const next = this.chapter < 3 ? ((this.chapter + 1) as ChapterId) : null
    const carry = this.carry()
    if (next) saveProgress({ chapter: next, carry })
    this.opts.onChapterEnd?.(next, carry)
  }

  /**
   * Compile after GLBs attach, using the same HDR target as the scene pass.
   * Compiling against the default framebuffer produces sRGB variants; gameplay needs linear HDR variants instead.
   * Briefly include hidden gear in the offscreen shadow passes so its depth variants are ready too.
   */
  private async precompile() {
    const m = this.player.model
    const hidden = [...new Set([...m.props, m.swordSheathed, m.arrowFlame, ...m.quiverArrows])].filter((o) => !o.visible)
    for (const o of hidden) o.visible = true
    const target = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.post.sceneRT)
    try {
      await this.renderer.compileAsync(this.scene, this.camera)
      if (this.disposed) return
      // compileAsync prepares surface materials, not the depth materials created by the shadow renderer.
      this.renderer.shadowMap.needsUpdate = true
      this.lighting.lantern.shadow.needsUpdate = true
      this.renderer.render(this.scene, this.camera)
    } finally {
      for (const o of hidden) o.visible = false
      if (!this.disposed) this.renderer.setRenderTarget(target)
    }
  }

  private setupEnvironmentAudio() {
    const trees: THREE.Vector3[] = []
    const bushes: THREE.Vector3[] = []
    const matrix = new THREE.Matrix4()
    // Instances retain the actual planted locations, including the dressed forest edge.
    this.level.root.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return
      const tree = /^(spruce|pine|birch|dead)/.test(object.name)
      if (!tree && object.name !== 'bush') return
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix)
        const pos = new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld)
        pos.y += tree ? 2.5 : 0.2
        ;(tree ? trees : bushes).push(pos)
      }
    })
    this.audio.setEnvironment({
      fires: [
        ...this.level.fires.map((fire) => ({ pos: fire.pos, active: () => true, gain: 1.1 })),
        ...this.level.braziers.map((brazier) => ({ pos: brazier.pos, active: () => brazier.lit, gain: 0.65 })),
        ...this.level.coldFires.map((cf) => ({ pos: cf.pos, active: () => cf.lit, gain: 1.1 })),
      ],
      water: this.level.waterSpots,
      spring: this.level.spring?.pos ?? null,
      trees,
      bushes,
      cue: (kind, pos, volume) =>
        this.sound(kind, pos, {
          tone: 'neutral',
          strength: 0.3,
          id: kind,
          vol: volume,
          indicate: !this.vision.sees(pos.x, pos.z),
        }),
    })
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
    this.disposed = true
    clearTimeout(this.buildTimer)
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    window.removeEventListener('keydown', this.onKey)
    this.input.dispose()
    this.eagle?.dispose()
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
    if (!this.ready || hud.get().screen !== 'title') return
    this.audio.start()
    this.audio.setVolume(hud.get().volume)
    hud.set({ screen: 'prologue', tutorOn: this.tutor.enabled })
    this.audio.music?.playKuray(8)
  }

  endEpilogue() {
    if (hud.get().screen === 'epilogue') hud.set({ screen: 'victory' })
  }

  /** chapter 3: the epilogue of the old sesen is read; the kubair is over */
  endEnding() {
    if (hud.get().screen === 'ending') this.nextChapter()
  }

  /** Called when the sesen's prologue ends (or is skipped). */
  endPrologue() {
    if (hud.get().screen !== 'prologue') return
    hud.set({ screen: 'playing', journal: journal(this.clueFound, this.chapter) })
    if (this.director) this.director.begin()
    else this.beginStory()
  }

  /** Opening shot: from high above the black forest the camera sinks to Aldar at the flooded yurt. */
  private beginStory() {
    const p = this.player.pos
    const h = this.level.hearth?.pos ?? p
    const t1 = this.level.triggers.find((t) => t.id === '1')
    if (t1) t1.fired = true
    const say = (s: Say) => (typeof s === 'string' ? { line: s } : { line: s.text, who: s.who })
    this.playScene(
      [
        { cam: { x: h.x - 3, z: h.z - 9, dist: 46, snap: true }, dur: 3.6, ...say(OPENING[0]) },
        { cam: { x: (h.x + p.x) / 2, z: (h.z + p.z) / 2, dist: 30 }, dur: 4.2, ...say(OPENING[1]) },
        { cam: { x: h.x, z: h.z, dist: 18 }, dur: 2.4, ...say(OPENING[2]) },
        { cam: null, dur: 0.8 },
      ],
      () => this.tutor.begin('path'),
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

  /** a line as a shot: long lines stay longer */
  lineShot(s: Say, cam?: Shot['cam']): Shot {
    const text = typeof s === 'string' ? s : s.text
    const who = typeof s === 'string' ? undefined : s.who
    return { cam, dur: Math.max(2.6, text.length * 0.055), line: text, who }
  }

  resume() {
    if (hud.get().screen !== 'paused') return
    this.audio.suspend(false)
    hud.set({ screen: 'playing' })
  }

  pause() {
    if (hud.get().screen !== 'playing' || this.choiceDrop || this.loreOpen || this.finalOpen) return
    this.input.reset()
    this.audio.suspend(true)
    hud.set({ screen: 'paused', journal: journal(this.clueFound, this.chapter) })
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
    this.lighting.lantern.castShadow = q === 'high' && this.debugLanternShadow
    this.resize()
    hud.set({ quality: q })
  }

  // ------------------------------------------------------------------ drops of living water (TRG_WATER_DROP_01..05)

  openChoice(d: Drop) {
    this.choiceDrop = d
    this.input.reset()
    hud.set({ choice: d.n })
  }

  closeChoice() {
    if (!this.choiceDrop) return
    this.choiceDrop = null
    this.input.reset()
    hud.set({ choice: null })
  }

  /** [E] drink — stronger, and the coal dims; [F] give to the earth — the sick land breathes, part of the debt is paid */
  chooseDrop(kind: 'drink' | 'give') {
    const d = this.choiceDrop
    if (!d || d.taken) return
    d.taken = true
    d.orb.visible = false
    d.light.on = false
    this.closeChoice()
    const p = this.player
    const kit = this.kit
    if (kind === 'drink') {
      kit.waterDebt++
      kit.fervor = kit.maxFervor
      p.heal(p.maxHp)
      this.sound('drink', null, { indicate: false })
      this.narrQueue.push(DROP_DRINK)
      this.toast(`Запал до ${kit.maxFervor} · уголь тускнеет`, 'warn', 'water')
      for (let i = 0; i < 40; i++) this.vfx.add.spawn({ x: p.pos.x + rand(-0.6, 0.6), y: rand(0.2, 2), z: p.pos.z + rand(-0.6, 0.6), vy: rand(0.4, 1.5), r: 1.4, g: 1.8, b: 2.2, size: 0.07, life: 1.2, drag: 1 })
    } else {
      kit.earthHealed++
      d.sprouts.visible = true
      this.sproutT.set(d, 0)
      this.vfx.rings.spawn(d.pos.x, d.pos.z, { from: 0.5, to: 9, dur: 1.8, color: new THREE.Color(0.9, 1.4, 1.1), width: 0.03 })
      this.sound('revive', d.pos, { indicate: false })
      this.toast('Земля исцелена', 'info', 'water')
      const g = d.grove
      if (g) {
        g.revived = true
        g.t = 0
        g.light.on = true
        for (const f of g.foliage) f.visible = true
        this.vfx.rings.spawn(g.center.x, g.center.z, { from: 0.5, to: 14, dur: 2.2, color: new THREE.Color(1.4, 1.0, 0.4), width: 0.03 })
        this.playScene([{ cam: { x: g.center.x, z: g.center.z + 2, dist: 22 }, dur: 2.6, line: DROP_GIVE }, { dur: 2.2 }, { cam: null, dur: 1.0 }])
      } else this.narrQueue.push(DROP_GIVE)
    }
  }
  private sproutT = new Map<Drop, number>()
  private dropsSaid = new Set<Drop>()

  // ------------------------------------------------------------------ Azamat (chapters 2–3)

  private updateSon(dt: number) {
    const s = this.son
    if (!s) return
    s.combat = this.inCombat
    s.update(dt, this.inScene || this.vision.sees(s.pos.x, s.pos.z))
    if (this.input.pressed('KeyQ') && !this.inScene) this.playKurai()
  }

  /**
   * «Зов курая» (docs/COMPANION.md): in 9 m the armour of the ancestors cracks for 6 s under a turquoise mark; under the
   * black water the mistress of the crossing is sealed in ice; the old stones answer (the chapter's director).
   */
  playKurai() {
    const s = this.son
    if (!s) return
    if (!s.canPlay) {
      if (s.state !== 'follow' && s.state !== 'still') this.toast('Азамату не до курая', 'warn', 'kurai')
      else if (this.time - this.kuraiNagT > 2) {
        this.kuraiNagT = this.time
        this.toast('Курай ещё не отдохнул', 'warn', 'kurai')
      }
      return
    }
    s.play()
    this.tutor.tally.kurai++
    const at = s.pos
    const teal = new THREE.Color(0.35, 1.9, 1.8)
    this.vfx.rings.spawn(at.x, at.z, { from: 0.4, to: 9, dur: 0.9, color: teal, width: 0.06 })
    this.vfx.rings.spawn(at.x, at.z, { from: 0.2, to: 6, dur: 0.7, color: teal, width: 0.03 })
    const p = this.player.pos
    for (const e of this.enemies) {
      if (!e.alive || e.hidden) continue
      const near = Math.min(e.pos.distanceTo(p), e.pos.distanceTo(at)) < 9
      if (!near) continue
      if (e instanceof KurganGuard) {
        e.breakArmor(6)
        e.mark('teal', 6)
      } else if (e.kind !== 'boss') e.mark('teal', 6)
    }
    const b = this.boss
    if (b instanceof SuInahi && b.fightStarted && b.alive) {
      if (b.freeze()) this.toast('Курай заморозил гладь', 'info', 'kurai')
      else if (!this.kuraiBossHint) {
        this.kuraiBossHint = true
        this.hintQueue.unshift('Курай заморозит воду, когда хозяйка уйдёт под гладь.')
        this.hintT = 0
      }
    }
    this.playerNoise(at, 12)
    this.director?.kurai()
  }
  private kuraiNagT = -10
  private kuraiBossHint = false

  /** Shulgen steps behind Aldar: the scar on his chest flares 0.6 s before the blow (docs/COMBAT.md) */
  flareScar() {
    this.scarT = 0.7
    const p = this.player
    this.sound('perfect', null, { indicate: false, vol: 0.5 })
    for (let i = 0; i < 18; i++) this.vfx.add.spawn({ x: p.pos.x + Math.sin(p.facing) * 0.2, y: 1.35, z: p.pos.z + Math.cos(p.facing) * 0.2, vx: rand(-0.6, 0.6), vy: rand(0, 0.8), vz: rand(-0.6, 0.6), r: 2.2, g: 1.4, b: 1.6, size: 0.05, life: 0.5, drag: 2 })
  }

  // ------------------------------------------------------------------ the bowl of Yanshishma (TRG_CH3_FINAL_CHOICE)

  openFinal() {
    if (this.finalOpen) return
    this.finalOpen = true
    this.input.reset()
    hud.set({ finalChoice: true })
  }

  /** «Вернуть аманат» — life if at least three drops went back to the earth, blood otherwise; «Выпить» — the second Shulgen */
  chooseFinal(kind: 'give' | 'drink') {
    if (!this.finalOpen) return
    this.finalOpen = false
    hud.set({ finalChoice: false })
    const ending: EndingId = kind === 'drink' ? 'shulgen' : this.kit.earthHealed >= 3 ? 'life' : 'blood'
    ;(this.director as Chapter3 | null)?.ending?.(ending)
  }

  /** the old sesen's last words, then the kubair is over */
  showEnding(id: EndingId) {
    hud.set({ screen: 'ending', ending: id })
    this.audio.setMood(id === 'shulgen' ? 'silent' : 'victory')
    void ENDINGS
  }

  // ------------------------------------------------------------------ Susar

  /** TRG_CH1_SUSAR_TRAP: [E] held, Aldar springs the trap */
  private freeMarten() {
    const m = this.marten
    const trap = this.level.trap
    if (!m || !trap) return
    trap.open()
    m.free()
    this.sound('crack', trap.pos, { indicate: false, vol: 0.5 })
    this.playScene(
      [
        { ...this.lineShot(SUSAR_TRAP.found), cam: { x: trap.pos.x, z: trap.pos.z, dist: 11 } },
        { dur: 1.6, line: 'Куница отскочила, но не ушла. Села и посмотрела на Алдара — будто узнала.' },
        this.lineShot(SUSAR_TRAP.freed),
        { cam: null, dur: 0.8 },
      ],
      () => {
        this.hintQueue.push(SUSAR_TRAP.hint)
        this.toast('Сусар идёт впереди', 'info', 'marten')
      },
    )
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
    // the heat focus points her at a veiled enemy in its cone
    m.command = null
    if (p.focus) {
      let bd = 12.5
      for (const e of this.enemies) {
        if (!e.alive || !e.cloakedNow) continue
        const dx = e.pos.x - p.pos.x
        const dz = e.pos.z - p.pos.z
        const d = Math.hypot(dx, dz)
        if (d > bd || Math.abs(wrapAngle(Math.atan2(dx, dz) - p.gaze)) > 0.55) continue
        bd = d
        m.command = e
      }
    }
    m.pointAt = this.boss?.perch ?? null
    m.update(dt)
    // TRG_CH1_SUSAR_TRAP: within 8 m the chain rings and she squeaks
    if (m.state === 'trapped' && !this.trapHeard && Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) < 8) {
      this.trapHeard = true
      this.narrQueue.push(SUSAR_TRAP.heard)
      this.sound('crack', m.pos, { tone: 'neutral', strength: 0.6, vol: 0.4 })
    }
    // what she smells is marked for Aldar: rusty paw marks in the dark, arrows at the screen edge
    if (!m.active) return
    this.scentT -= dt
    if (this.scentT <= 0) {
      this.scentT = 0.7
      for (const e of m.sensed) {
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z)
        this.indicators.push(e.pos, 'scent', 0.85 - d / 30, d, 'scent-' + e.id)
      }
      if (m.pointAt) this.indicators.push(m.pointAt, 'scent', 1, Math.hypot(m.pointAt.x - p.pos.x, m.pointAt.z - p.pos.z), 'scent-perch')
    }
  }

  // ------------------------------------------------------------------ the journal «Следы»

  findClue(id: ClueId, silent = false) {
    if (this.clueFound.has(id)) return
    this.clueFound.add(id)
    const c = CLUES[id]
    const q = QUESTIONS.find((x) => x.id === c.q)!
    const n = q.clues.filter((x) => this.clueFound.has(x)).length
    if (c.thought && !silent) this.narrQueue.push({ who: 'Алдар', text: c.thought })
    this.audio.play('perfect', null, 0.25)
    this.toast(`${q.title} · ${n} из ${q.clues.length}`, 'info', 'amanat')
    if (n === q.clues.length) this.narrQueue.push(q.answer)
    hud.set({ journal: journal(this.clueFound, this.chapter) })
  }

  /** TRG_CH1_RIBBON: a close look at the blue ribbon on the shaman birch */
  private readRibbon() {
    const at = this.level.clues.ribbon
    if (!at || this.clueFound.has('ribbon')) return
    const s = RIBBON.lines![0] as Line
    this.playScene([{ ...this.lineShot(s), cam: { x: at.x, z: at.z, dist: 9 } }, { cam: null, dur: 0.6 }], () => this.findClue('ribbon', true))
  }

  /** the heat focus reveals the prints; glints over unread signs nearby */
  private updateTracking(dt: number) {
    const p = this.player
    const want = p.focus ? 1 : 0
    this.focusVis += (want - this.focusVis) * Math.min(1, dt * (want ? 6 : 3))
    this.tutor.tally.focus += p.focus ? dt : 0
    p.model.vesselCore.getWorldPosition(this.tmpV)
    this.level.trackFocus.value.set(this.tmpV.x, this.tmpV.z, p.gaze, this.focusVis)
    const L = this.level
    for (const id of Object.keys(L.clues) as ClueId[]) {
      if (this.clueFound.has(id) || !CLUES[id].prompt) continue
      if (id === 'prints' && !this.kit.ember) continue
      const at = L.clues[id]!
      const d = Math.hypot(at.x - p.pos.x, at.z - p.pos.z)
      const reach = 6 + 6 * this.focusVis
      if (d > reach) continue
      const rate = 4 * (1 - d / (reach + 1))
      if (Math.random() < rate * dt) this.vfx.add.spawn({ x: at.x + rand(-0.3, 0.3), y: rand(0.1, 0.8), z: at.z + rand(-0.3, 0.3), vy: rand(0.2, 0.6), r: 1.8, g: 1.25, b: 0.55, size: rand(0.03, 0.06), life: rand(0.6, 1.1), drag: 1 })
    }
  }

  toast(text: string, kind: 'item' | 'info' | 'warn' = 'item', icon?: string) {
    this.toastList.push({ id: ++this.toastId, text, kind, icon, t: performance.now() / 1000 })
    if (this.toastList.length > 5) this.toastList.shift()
    hud.set({ toasts: this.toastList.map(({ id, text, kind, icon }) => ({ id, text, kind, icon })) })
  }

  // ------------------------------------------------------------------ arrows

  arrowLanded(pos: THREE.Vector3, fire: boolean): 'keep' | 'break' | 'burn' {
    const own = this.director?.arrowLanded(pos, fire)
    if (own) return own
    // an arrow that falls into deep water is lost
    if (this.field.isDeep(pos.x, pos.z)) {
      this.vfx.rings.spawn(pos.x, pos.z, { from: 0.1, to: 0.8, dur: 0.6, color: new THREE.Color(0.3, 0.45, 0.6), width: 0.03 })
      this.sound('splash', pos, { indicate: false, vol: 0.3 })
      this.toast('Стрела ушла под воду', 'warn', 'arrow')
      return 'break'
    }
    if (fire) {
      for (const b of this.level.barriers) {
        if (b.kind !== 'thorns' || b.open) continue
        if (b.circles.some((c) => Math.hypot(c.x - pos.x, c.z - pos.z) < 2.2)) {
          this.openBarrier(b)
          return 'burn'
        }
      }
      for (const b of this.level.braziers) {
        if (!b.lit && Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) < 1.7) {
          this.setBrazier(b, true, true)
          this.toast('Жаровня горит', 'info', 'flame')
          return 'burn'
        }
      }
    }
    // stone breaks the head and the shaft for good (docs/COMBAT.md, «Возврат и поломка стрел»)
    for (const c of this.level.stones) {
      if (Math.hypot(c.x - pos.x, c.z - pos.z) < c.r + 0.35) {
        this.toast('Стрела сломалась о камень', 'warn', 'arrow')
        return 'break'
      }
    }
    return 'keep'
  }

  arrowProbe(pos: THREE.Vector3, fire = false): boolean {
    if (this.director?.arrowProbe(pos, fire)) return true
    // the raven's nest over the path in zone 3
    const n = this.level.nest
    if (n && !n.fallen && Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z) < 0.9) {
      n.fallen = true
      n.t = 0
      this.sound('crack', n.pos, { indicate: false })
      this.pickups.spawn(n.pos.clone(), { label: 'Поднять оберег из гнезда', kind: 'keepsake', keepsake: 'feather', hidden: true })
      return true
    }
    // a perched Shurale: an arrow into the crown brings him down (docs/COMBAT.md, phase 2)
    const b = this.boss
    if (b instanceof Shurale && b.perch && Math.hypot(b.perch.x - pos.x, b.perch.z - pos.z) < 1.7) {
      b.knockDown()
      return true
    }
    return false
  }

  /** the hunter's quiver and fang, the old quiver */
  private placeLoot() {
    const M = this.levelData.markers
    const at = (ch: string, i = 0) => M.filter((m) => m.ch === ch)[i]
    const h = at('h')
    if (h) this.pickups.spawn(new THREE.Vector3(h.x - 0.9, 0, h.z + 0.7), { label: 'Взять оберег и стрелы охотника', kind: 'quiver', arrows: 2, keepsake: 'fang' })
    const q = at('Q')
    if (q) this.pickups.spawn(new THREE.Vector3(q.x, 0, q.z), { label: 'Взять старый колчан', kind: 'upgrade' })
  }

  collect(pk: Pickup) {
    if (pk.taken) return
    this.pickups.take(pk)
    const kit = this.kit
    if (pk.kind === 'upgrade') {
      kit.maxArrows = 8
      this.toast('Старый колчан: до 8 стрел', 'item', 'bow')
      this.narrQueue.push('Старый колчан, кожа ещё крепкая. В нём поместится больше стрел.')
    }
    if (pk.arrows > 0) {
      const got = kit.addArrows(pk.arrows)
      this.toast(got > 0 ? `Стрелы +${got}` : 'Колчан полон', got > 0 ? 'item' : 'warn', 'arrow')
      // what did not fit stays as arrows on the ground
      for (let i = got; i < pk.arrows; i++) this.projectiles.spawnStuck(new THREE.Vector3(pk.pos.x + rand(-0.4, 0.4), 0.08, pk.pos.z + rand(-0.4, 0.4)), new THREE.Vector3(rand(-1, 1), -0.2, rand(-1, 1)))
    }
    if (pk.keepsake && !kit.keepsakes.has(pk.keepsake)) {
      kit.keepsakes.add(pk.keepsake)
      const k = KEEPSAKES[pk.keepsake]
      this.toast(`${k.name}: ${k.desc}`, 'item', pk.keepsake)
    }
    this.audio.play('ui', null, 0.5)
    pk.onTake?.()
  }

  /** arrows lying or standing about come out on approach (TRG_ARROW_PICKUP) */
  private updateLoot() {
    const p = this.player
    if (!p.alive) return
    this.pickups.update(this.time)
    if (!this.kit.bow) return
    const n = this.projectiles.collectNear(p.pos, 1.2, this.kit.quiverRoom)
    if (n > 0) {
      this.kit.addArrows(n)
      this.toast(`Стрелы +${n}`, 'item', 'arrow')
      this.audio.play('ui', null, 0.3)
    }
  }

  // ---- rest at the old spring or a fire: health, a point to rise at, a little hope
  rest(at: THREE.Vector3, back: THREE.Vector3) {
    const p = this.player
    const kit = this.kit
    p.heal(p.maxHp)
    p.checkpoint.copy(back)
    kit.fervor = Math.max(kit.fervor, 40)
    // the deficit stays, but never a dead end: at a rest the quiver holds at least three
    if (kit.bow && kit.arrows < 3) {
      const got = kit.addArrows(3 - kit.arrows)
      if (got > 0) this.toast(`Стрелы +${got}`, 'item', 'arrow')
    }
    this.vfx.rings.spawn(at.x, at.z, { from: 1, to: 6, dur: 1.2, color: new THREE.Color(0.6, 1.2, 1.2), width: 0.05 })
    this.toast('Здесь Алдар поднимется, если падёт', 'info', 'rise')
  }

  /** the coal gives its flame to the hunters' cold fire pit: a rest at the fork before the wolf ravine */
  private lightColdFire(cf: ColdFire) {
    if (cf.lit) return
    cf.lit = true
    cf.light.on = true
    cf.flame.visible = true
    cf.coal.visible = true
    this.sound('ignite', cf.pos, { indicate: false })
    for (let i = 0; i < 40; i++) this.vfx.add.spawn({ x: cf.pos.x, y: 0.4, z: cf.pos.z, vx: rand(-1.5, 1.5), vy: rand(1, 4), vz: rand(-1.5, 1.5), r: 2.4, g: 1, b: 0.3, size: 0.07, life: 0.9, drag: 1.5 })
    this.narrQueue.push(COLD_FIRE.lit)
    this.rest(cf.pos, new THREE.Vector3(cf.pos.x - 1.6, 0, cf.pos.z - 1.6))
  }

  /** Azamat's blue threads: the first look at each one */
  private updateThreads() {
    const p = this.player.pos
    this.level.threads.forEach((t, i) => {
      if (this.threadsSeen.has(i) || Math.hypot(t.x - p.x, t.z - p.z) > 3.5) return
      this.threadsSeen.add(i)
      this.narrQueue.push({ who: 'Алдар', text: THREAD_LINES[Math.min(THREAD_LINES.length - 1, this.threadsSeen.size - 1)] })
    })
    for (const cf of this.level.coldFires) {
      if (cf.lit || this.coldFireSeen || Math.hypot(cf.pos.x - p.x, cf.pos.z - p.z) > 6) continue
      this.coldFireSeen = true
      this.narrQueue.push(COLD_FIRE.seen)
    }
  }
  private threadsSeen = new Set<number>()
  private coldFireSeen = false

  /** Read a tamga stone: the world holds its breath while the page is open. */
  openLore(id: number) {
    // the first tamga is the albasty's: she comes for those who carry a child; the Horseman's stele and the ochre of the cave
    // answer the questions of chapters 2 and 3
    if (id === 0) this.findClue('tamga', true)
    else if (id === 4) this.findClue('horseman', true)
    else if (id === 6 || id === 7) this.findClue('ochre', true)
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
    for (const r of this.roots) this.scene.remove(r.mesh)
    this.roots = []
    for (const e of this.enemies) if (e !== this.boss && e.aggro) e.resetToHome()
    if (this.boss && this.boss.alive && (this.boss.fightStarted || this.bossIntro)) {
      this.bossIntro = false
      this.boss.resetBoss()
      this.openGate()
      hud.set({ boss: null })
    }
    this.son?.placeNear(p.pos, p.facing)
    this.director?.respawn()
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
    this.slowmo(0.6, 0.28)
    this.sound('perfect', null, { indicate: false })
    const p = this.player.pos
    this.vfx.rings.spawn(p.x, p.z, { from: 0.3, to: 3.5, dur: 0.5, color: new THREE.Color(0.7, 0.9, 1.4), width: 0.08 })
    this.player.dodgeCharges = Math.min(this.player.dodgeMax, this.player.dodgeCharges + 1)
  }

  /**
   * «Коготь с неба» (docs/COMPANION.md): Kara goes for Shurale in the crowns first, then for an unblockable wind-up,
   * then for whoever is under the cursor, then for the nearest awake enemy.
   */
  releaseEagle() {
    const p = this.player
    const h = p.handWorld('L', this.tmpV).clone()
    const fair = (e: Enemy) => e.alive && !e.hidden && !e.cloakedNow && e.state !== 'dormant' && e.pos.distanceTo(p.pos) < 20
    let target: Enemy | null = null
    if (this.boss?.perch) target = this.boss
    if (!target) target = this.enemies.find((e) => fair(e) && e.telegraph === 'red' && e.pos.distanceTo(p.pos) < 16) ?? null
    if (!target) {
      let bd = 5
      for (const e of this.enemies) {
        if (!fair(e)) continue
        const d = Math.hypot(e.pos.x - p.aimPoint.x, e.pos.z - p.aimPoint.z)
        if (d < bd) {
          bd = d
          target = e
        }
      }
    }
    if (!target) {
      let bd = 16
      for (const e of this.enemies) {
        if (!fair(e) || !e.aggro) continue
        const d = e.pos.distanceTo(p.pos)
        if (d < bd) {
          bd = d
          target = e
        }
      }
    }
    this.eagle.release(h, target)
  }

  /** «Вспышка живицы»: a ring of sparks R 3.5 m round the belt — roots burn, wolves bolt, the dead are thrown back */
  vesselFlash(pos: THREE.Vector3) {
    const R = 3.5
    this.sound('ignite', pos, { indicate: false })
    this.sound('crackle', pos, { indicate: false, vol: 0.8 })
    this.shake(0.15)
    this.vfx.rings.spawn(pos.x, pos.z, { from: 0.3, to: R, dur: 0.45, color: new THREE.Color(2.4, 1.1, 0.3), width: 0.1 })
    this.vfx.rings.spawn(pos.x, pos.z, { from: 0.2, to: R * 0.7, dur: 0.35, color: new THREE.Color(1.6, 0.8, 0.3), width: 0.05 })
    for (let i = 0; i < 70; i++) {
      const a = rand(0, Math.PI * 2)
      const sp = rand(5, 9)
      this.vfx.add.spawn({ x: pos.x, y: 0.9, z: pos.z, vx: Math.cos(a) * sp, vy: rand(0.5, 3), vz: Math.sin(a) * sp, r: 2.6, g: 1.2, b: 0.35, size: rand(0.03, 0.07), life: rand(0.3, 0.55), drag: 4 })
    }
    for (const e of this.enemies) {
      if (!e.alive || e.hidden || e.state === 'dormant') continue
      if (Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) > R + e.radius) continue
      e.scare(pos.x, pos.z)
      if (!e.cloakedNow) e.takeHit(4, 6, pos.x, pos.z, 0, false, 'fire')
    }
    // Shurale's roots burn
    for (const r of this.roots) {
      if (Math.hypot(r.pos.x - pos.x, r.pos.z - pos.z) > R + 0.5) continue
      this.burnRoots(r)
    }
    // an unlit brazier close by catches
    for (const b of this.level.braziers) if (!b.lit && b.pos.distanceTo(pos) < 2.4) this.setBrazier(b, true, true)
    this.playerNoise(pos, 10)
  }

  spawnRoots(pos: THREE.Vector3) {
    const g = new THREE.Group()
    g.position.set(pos.x, -1.6, pos.z)
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand(-0.2, 0.2)
      const r0 = rand(0.4, ROOT_R)
      const base = new THREE.Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0)
      const tip = base.clone().add(new THREE.Vector3(-Math.cos(a) * rand(0.2, 0.7), rand(1.1, 1.9), -Math.sin(a) * rand(0.2, 0.7)))
      parts.push(limb(base, tip, rand(0.08, 0.14), 0.01, 5))
    }
    for (const geo of parts) g.add(new THREE.Mesh(geo, this.rootMat))
    g.visible = false
    this.scene.add(g)
    this.roots.push({ pos: pos.clone(), t: 0, erupted: false, mesh: g })
    this.vfx.rings.spawn(pos.x, pos.z, { from: ROOT_R, to: ROOT_R, dur: ROOT_WARN, color: new THREE.Color(0.6, 0.15, 0.05), width: 0.06, fill: 0.14, hold: true })
  }

  private burnRoots(r: RootTrap) {
    if (r.t < 0) return
    r.t = -1
    this.sound('ignite', r.pos, { indicate: false, vol: 0.7 })
    for (let i = 0; i < 40; i++) this.vfx.add.spawn({ x: r.pos.x + rand(-ROOT_R, ROOT_R) * 0.7, y: rand(0.1, 1.6), z: r.pos.z + rand(-ROOT_R, ROOT_R) * 0.7, vy: rand(1, 3), r: 2.4, g: 0.9, b: 0.25, size: rand(0.05, 0.1), life: rand(0.6, 1.2), drag: 1 })
    if (this.player.rootedT > 0 && Math.hypot(this.player.pos.x - r.pos.x, this.player.pos.z - r.pos.z) < ROOT_R + 0.4) this.player.rootedT = 0
  }

  private updateRoots(dt: number) {
    const p = this.player
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const r = this.roots[i]
      if (r.t < 0) {
        // burning down: sink and go
        r.mesh.position.y -= dt * 3
        if (r.mesh.position.y < -2) {
          this.scene.remove(r.mesh)
          this.roots.splice(i, 1)
        }
        continue
      }
      r.t += dt
      if (!r.erupted && r.t >= ROOT_WARN) {
        r.erupted = true
        r.mesh.visible = true
        this.sound('thorns', r.pos, { indicate: false })
        this.shake(0.4)
        this.vfx.dust(r.pos.x, r.pos.z, 24, ROOT_R)
        if (p.alive && p.iframes <= 0 && Math.hypot(p.pos.x - r.pos.x, p.pos.z - r.pos.z) < ROOT_R + p.radius) {
          p.rootedT = 1.6
          p.directDamage(14)
          this.toast('Корни держат: вспышка [F]', 'warn', 'flame')
        }
      }
      if (r.erupted) {
        r.mesh.position.y = Math.min(0, r.mesh.position.y + dt * 12)
        if (r.t > ROOT_WARN + 2.4) r.t = -1
      }
    }
  }

  isLit(x: number, z: number) {
    for (const b of this.level.braziers) if (b.lit && Math.hypot(b.pos.x - x, b.pos.z - z) < 6) return true
    for (const f of this.level.fires) if (Math.hypot(f.pos.x - x, f.pos.z - z) < 6) return true
    for (const f of this.level.coldFires) if (f.lit && Math.hypot(f.pos.x - x, f.pos.z - z) < 6) return true
    const s = this.level.spring
    if (s && Math.hypot(s.pos.x - x, s.pos.z - z) < 5) return true
    for (const d of this.level.drops) if (d.grove?.revived && Math.hypot(d.grove.center.x - x, d.grove.center.z - z) < 9) return true
    const p = this.player
    if (p.lightOn && Math.hypot(p.pos.x - x, p.pos.z - z) < 5.5 * this.kit.lightMult) return true
    return false
  }

  spawnEnemy(kind: 'ubyr' | 'wolf' | 'morok', x: number, z: number, aggro: boolean) {
    const e = kind === 'ubyr' ? new Ubyr(this, x, z) : kind === 'wolf' ? new Wolf(this, x, z) : new Morok(this, x, z)
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
    // the arrows that went in fall out by the body (docs/COMBAT.md)
    for (let i = 0; i < e.arrowsIn; i++) {
      const a = rand(0, Math.PI * 2)
      const r = rand(0.3, 0.9)
      this.projectiles.spawnStuck(new THREE.Vector3(e.pos.x + Math.cos(a) * r, 0.08, e.pos.z + Math.sin(a) * r), new THREE.Vector3(Math.cos(a), -0.15, Math.sin(a)))
    }
    e.arrowsIn = 0
    if (this.boss && e === this.boss) {
      if (this.director) {
        this.victoryT = 0
        hud.set({ boss: null })
        for (const o of this.enemies) if (o !== e && o.alive && o.aggro) o.die()
        this.director.onBossDefeated()
      } else if (e instanceof Shurale) this.shuraleDefeated(e)
    }
  }

  /** TRG_CH1_SHURALE_END: his last words, Azamat climbs down from the hollow, the chapter ends */
  private shuraleDefeated(e: Shurale) {
    this.victoryT = 0
    hud.set({ boss: null })
    for (const o of this.enemies) if (o !== e && o.alive && o.aggro) o.die()
    for (const r of this.roots) this.burnRoots(r)
    const at = e.pos.clone()
    const hol = this.level.hollow ?? at
    const p = this.player.pos
    const leaves = () => {
      // his laughter scatters as dry leaves
      for (let i = 0; i < 90; i++)
        this.vfx.soft.spawn({ x: at.x + rand(-1, 1), y: rand(0.5, 3.5), z: at.z + rand(-1, 1), vx: rand(-3, 3), vy: rand(0.5, 3.5), vz: rand(-3, 3), r: rand(0.25, 0.45), g: rand(0.15, 0.28), b: 0.06, a: 0.95, size: rand(0.08, 0.14), life: rand(2, 4), drag: 0.9, gravity: 0.8 })
    }
    const camE = { x: at.x, z: at.z + 1, dist: 15 }
    this.playScene(
      [
        { ...this.lineShot(SHURALE_DEFEAT[0]), cam: camE, run: () => this.slowmo(1.6, 0.35) },
        this.lineShot(SHURALE_DEFEAT[1]),
        { ...this.lineShot(SHURALE_DEFEAT[2]), run: leaves },
        { cam: { x: hol.x, z: hol.z, dist: 16 }, dur: 2.6, line: 'Из дупла векового дуба спустился мальчик с кураем.', run: () => this.spawnAzamat() },
        { ...this.lineShot(AZAMAT_RESCUE[0]), cam: { x: (hol.x + p.x) / 2, z: (hol.z + p.z) / 2, dist: 13 } },
        this.lineShot(AZAMAT_RESCUE[1]),
      ],
      () => hud.set({ screen: 'epilogue' }),
    )
  }

  /** Azamat slides down the oak and runs to his father */
  private spawnAzamat() {
    const h = this.level.hollow
    if (!h || this.azamat) return
    const rig = createAzamat()
    this.scene.add(rig.root)
    const pos = new THREE.Vector3(h.x, 0, h.z + 0.2)
    this.azamat = { rig, phase: 'descend', t: 0, pos, facing: Math.atan2(this.player.pos.x - pos.x, this.player.pos.z - pos.z) }
    rig.root.position.set(pos.x, h.y, pos.z)
  }

  private updateAzamat(dt: number) {
    const a = this.azamat
    if (!a) return
    a.t += dt
    const p = this.player.pos
    let speed = 0
    let y = 0
    if (a.phase === 'descend') {
      const k = Math.min(1, a.t / 1.6)
      y = (this.level.hollow?.y ?? 5.5) * (1 - k * k)
      if (k >= 1) {
        a.phase = 'walk'
        a.t = 0
      }
    } else if (a.phase === 'walk') {
      const dx = p.x - a.pos.x
      const dz = p.z - a.pos.z
      const d = Math.hypot(dx, dz)
      if (d < 1.4) a.phase = 'stand'
      else {
        speed = 3.2
        a.pos.x += (dx / d) * speed * dt
        a.pos.z += (dz / d) * speed * dt
        a.facing = Math.atan2(dx, dz)
      }
    } else a.facing = Math.atan2(p.x - a.pos.x, p.z - a.pos.z)
    a.rig.update(dt, { speed, forward: 1, clip: a.phase === 'descend' ? HERO_CLIPS.grabbed : null, t: 0.5, time: this.time })
    a.rig.root.position.set(a.pos.x, y, a.pos.z)
    a.rig.root.rotation.y = a.facing
    a.rig.root.visible = this.vision.sees(a.pos.x, a.pos.z) || this.inScene
  }

  bossEvent(ev: BossEvent) {
    if (this.director) this.director.bossEvent(ev)
    else if (ev === 'phase2') this.beat(SHURALE_PHASE2)
  }

  // ------------------------------------------------------------------ helpers

  beat(b: Beat) {
    if (b.lines) this.narrQueue.push(...b.lines)
    if (b.hints) this.hintQueue.push(...b.hints)
  }

  // ---- barriers: dry thorns burn (a fire arrow), the deadfall is pushed (from the south)

  openBarrier(b: Barrier) {
    if (b.open) return
    b.open = true
    b.t = 0
    for (const c of b.circles) this.field.removeCircle(c)
    for (const ci of b.cells) this.field.blocked[ci] = 0
    this.field.updateFlow(this.player.pos.x, this.player.pos.z, true)
    if (b.kind === 'thorns') {
      this.sound('ignite', b.center, { indicate: false, vol: 0.8 })
      this.toast('Терновник горит', 'info', 'flame')
    } else if (b.kind === 'veil') {
      this.sound('teleport', b.center, { indicate: false, vol: 0.9 })
      this.toast('Завеса духов растаяла', 'info', 'kurai')
    } else if (b.kind === 'bridge') {
      this.sound('crack', b.center, { indicate: false, vol: 0.8 })
      this.toast('Мосток опустился', 'info', 'bow')
    } else {
      this.sound('crack', b.center, { indicate: false, vol: 0.9 })
      this.sound('boom', b.center, { indicate: false, vol: 0.5 })
      this.shake(0.35)
      this.toast('Путь открыт', 'info')
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
      } else if (b.kind === 'veil') {
        // the haze thins and blows away upward
        b.mat.opacity = 0.3 * (1 - k)
        b.mesh.position.y = k * 2.5
        if (Math.random() < dt * 30) {
          const c = b.circles[Math.floor(Math.random() * b.circles.length)]
          this.vfx.add.spawn({ x: c.x + rand(-1, 1), y: rand(0.2, 2.6), z: c.z + rand(-0.6, 0.6), vy: rand(1, 2.5), r: 0.3, g: 1.9, b: 1.8, size: 0.06, life: 1.2, drag: 0.5 })
        }
        if (k >= 1) b.mesh.visible = false
      } else if (b.kind === 'bridge') {
        // the deck swings down and slaps the water
        const pivot = b.mesh.children[0]
        const e = k * k
        pivot.rotation.z = -1.2 * (1 - e)
        if (k >= 1 && b.t - dt / 1.4 < 1) {
          this.shake(0.4)
          this.sound('boom', b.center, { indicate: false, vol: 0.5 })
          for (let i = 0; i < 30; i++) this.vfx.add.spawn({ x: b.center.x + rand(-4, 4), y: 0, z: b.center.z + rand(-2, 2), vy: rand(1.5, 4), r: 0.35, g: 0.6, b: 0.85, a: 0.8, size: 0.07, life: 0.7, drag: 1, gravity: 9 })
        }
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

  /** what Aldar can do at a barrier, or what he thinks the first time he meets it */
  private barrierInteraction(): Interaction | null {
    const p = this.player
    for (const b of this.level.barriers) {
      if (b.open) continue
      const near = b.circles.some((c) => Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < 3.2)
      if (!near) continue
      const own = this.director?.barrier(b)
      if (own) {
        if (!this.barrierNoted.has(b)) {
          this.barrierNoted.add(b)
          this.narrQueue.push({ who: 'Алдар', text: own.thought })
        }
        return { label: own.label, key: '' }
      }
      if (!this.barrierNoted.has(b)) {
        this.barrierNoted.add(b)
        this.narrQueue.push({ who: 'Алдар', text: b.kind === 'thorns' ? 'Сухой терновник. Голыми руками не продраться. А огонь его возьмёт.' : 'Завал. Свежий, ветки ещё в хвое.' })
      }
      if (b.kind === 'thorns') return { label: 'Нужна огненная стрела: [2], затем [F]', key: '' }
      // the deadfall gives only from the south
      if (p.pos.z > b.center.z) return { label: 'Столкнуть стволы', run: () => p.startInteract(() => this.openBarrier(b)) }
      return { label: 'С этой стороны не сдвинуть', key: '' }
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
    const z = zoneAt(this.zones, this.player.pos.x, this.player.pos.z)
    if (z < 0 || this.zonesSeen.has(z)) return
    this.zonesSeen.add(z)
    this.zoneCard = { id: z, name: this.zones[z].name, sub: this.zones[z].sub }
    this.zoneT = 4.8
  }

  /** Azamat in the hollow: now the kurai, now crying — a sound to walk toward. */
  private updateHollow(dt: number) {
    const h = this.level.hollow
    if (!h || !this.boss || !this.boss.alive || this.victoryT >= 0) return
    this.cryT -= dt
    if (this.cryT > 0) return
    this.cryT = 5 + Math.random() * 2.5
    const at = new THREE.Vector3(h.x, 0, h.z)
    const d = at.distanceTo(this.player.pos)
    if (d > 58) return
    const kurai = Math.random() < 0.55
    this.sound(kurai ? 'kurai' : 'cry', at, { tone: 'neutral', strength: Math.max(0.35, 1 - d / 60), id: 'azamat', vol: Math.max(0.25, 1 - d / 70) })
  }

  private setBrazier(b: Brazier, lit: boolean, fx: boolean) {
    b.lit = lit
    b.light.on = lit
    b.flame.visible = lit
    b.coal.visible = lit
    if (fx) {
      this.sound(lit ? 'ignite' : 'douse', b.pos, { indicate: false })
      if (lit) for (let i = 0; i < 30; i++) this.vfx.add.spawn({ x: b.pos.x, y: 1.3, z: b.pos.z, vx: rand(-1.5, 1.5), vy: rand(1, 4), vz: rand(-1.5, 1.5), r: 2.4, g: 1, b: 0.3, size: 0.07, life: 0.9, drag: 1.5 })
      else for (let i = 0; i < 12; i++) this.vfx.soft.spawn({ x: b.pos.x, y: 1.4, z: b.pos.z, vy: rand(0.5, 1.5), r: 0.08, g: 0.08, b: 0.08, a: 0.5, size: 0.7, life: 1.6, grow: 2 })
    }
  }

  /** black roots rise across the way back (docs/LEVELS.md, TRG_CH1_SHURALE_START) */
  closeGate() {
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

  openGate() {
    const g = this.level.gate
    if (!g || !g.closed) return
    g.closed = false
    g.mesh.visible = false
    g.mesh.position.y = -4.5
    for (const c of g.circles) this.field.removeCircle(c)
    for (const ci of g.cells) this.field.blocked[ci] = 0
    this.field.updateFlow(this.player.pos.x, this.player.pos.z, true)
  }

  private setDebugShieldShadow(enabled: boolean) {
    this.debugShieldShadow = enabled
    // Affect only casting into the vessel's map. The shield remains visible and keeps its moon shadow.
    for (const root of [this.player.model.shield, this.player.model.shieldBack]) {
      root.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh || !o.castShadow) return
        if (enabled) o.layers.enable(LAYER_LANTERN_SHADOW)
        else o.layers.disable(LAYER_LANTERN_SHADOW)
      })
    }
    this.lighting.lantern.shadow.needsUpdate = true
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat && (e.code === 'Backquote' || (this.debug && /^Digit[456]$/.test(e.code)))) return
    if (e.code === 'Escape') {
      if (this.finalOpen) return
      if (this.choiceDrop) return this.closeChoice()
      if (this.loreOpen) return this.closeLore()
      const s = hud.get().screen
      if (s === 'playing') this.pause()
      else if (s === 'paused') this.resume()
    }
    if (e.code === 'Backquote') {
      e.preventDefault()
      this.debug = !this.debug
      this.debugHudT = 0
      if (!this.debug) {
        if (this.ready) {
          this.setDebugShieldShadow(true)
          this.debugLanternShadow = true
          this.debugShadowFrozen = false
          this.lighting.lantern.castShadow = this.quality === 'high'
        }
        hud.set({ debug: null })
      }
    }
    if (!this.debug || !this.ready) return
    if (e.code === 'Digit4') {
      this.setDebugShieldShadow(!this.debugShieldShadow)
    } else if (e.code === 'Digit5') {
      this.debugLanternShadow = !this.debugLanternShadow
      this.lighting.lantern.castShadow = this.quality === 'high' && this.debugLanternShadow
      this.lighting.lantern.shadow.needsUpdate = true
    } else if (e.code === 'Digit6') {
      this.debugShadowFrozen = !this.debugShadowFrozen
      this.lighting.lantern.shadow.needsUpdate = true
    } else return
    e.preventDefault()
    this.debugHudT = 0
    // Start a fresh timing window after changing a diagnostic mode; allow shaders to warm up before comparing.
    this.frameTimes.length = 0
    this.fpsAcc = this.fpsN = 0
  }

  // ------------------------------------------------------------------ loop

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const real = Math.max(0.0001, (now - this.last) / 1000)
    const rdt = Math.min(0.05, real)
    this.last = now
    this.fpsAcc += real
    this.fpsN++
    this.frameTimes.push(real * 1000)
    if (this.frameTimes.length > 120) this.frameTimes.shift()
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.fpsN / this.fpsAcc)
      this.frameMs = (this.fpsAcc * 1000) / this.fpsN
      const sorted = this.frameTimes.slice().sort((a, b) => a - b)
      this.frameP95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
      this.fpsAcc = 0
      this.fpsN = 0
    }
    this.input.pollPad()
    const sc0 = hud.get().screen
    if (this.input.rawPressed('PadStart') || this.input.rawPressed('PadView')) {
      if (sc0 === 'playing') this.pause()
      else if (sc0 === 'paused') this.resume()
      else if (sc0 === 'title') this.start()
      else if (sc0 === 'prologue') this.endPrologue()
      else if (sc0 === 'dead') this.respawn()
    }
    const screen = hud.get().screen
    const simulate = screen === 'playing' || screen === 'dead' || screen === 'victory' || screen === 'epilogue' || screen === 'ending'
    const modal = !!this.choiceDrop || this.loreOpen || this.finalOpen
    this.input.enabled = screen === 'playing' && !modal && this.player.alive && !this.cine
    this.renderer.info.reset()
    // The title has its own video backdrop; skip the world and vision passes.
    if (screen !== 'title') {
      if (simulate && !modal) this.update(rdt)
      else this.idle(rdt)
      this.render(rdt)
    }
    this.input.endFrame()
  }

  /** Pause / story screens: keep the world breathing without simulating gameplay. */
  private idle(rdt: number) {
    globalUniforms.uTime.value += rdt
    shaftTime.value += rdt
    this.vfx.update(rdt, this.camera, globalUniforms.uTime.value)
    updateEmitters(this.level.emitters, this.vfx, this.player.pos, rdt)
    this.lighting.update(rdt, this.player.pos)
    this.updateCamera(rdt)
    this.feedVisionLight(rdt)
    this.vision.update(this.player.pos.x, this.player.pos.z, this.player.gaze, rdt)
    this.audio.setListener(this.player.pos, CAM_YAW)
    this.audio.updateEnvironment(rdt)
    if (this.choiceDrop || this.loreOpen || this.finalOpen) {
      this.hudT -= rdt
      if (this.hudT <= 0) {
        this.hudT = 0.1
        this.syncHud()
      }
    }
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
      this.holdEmber()
      this.holdBow()
      this.field.updateFlow(p.pos.x, p.pos.z)
      for (const e of this.enemies) if (!e.removed) e.update(dt)
      this.separate()
      this.projectiles.update(dt)
      this.eagle.update(dt)
      this.echo.update(dt)
      this.updateMarten(dt)
      this.updateSon(dt)
      this.director?.update(dt)
      this.updateWorld(dt)
      this.updateRoots(dt)
      this.updateAzamat(dt)
      this.atmosphere(dt)
      this.updateLoot()
      this.updateTracking(dt)
      this.updateThreads()
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
    this.updateInteraction(rdt)
    this.updateCamera(rdt)
    this.lighting.update(rdt, p.pos)
    this.feedVisionLight(rdt)
    this.vision.update(p.pos.x, p.pos.z, p.gaze, rdt)
    this.audio.setListener(p.pos, CAM_YAW)
    const mood = this.computeMood(rdt)
    this.audio.setMood(mood)
    this.inCombat = mood === 'combat' || mood === 'boss' || mood === 'boss2'
    // the HUD dissolves when nothing is happening and returns with danger or any action
    const acted = ['Mouse0', 'Mouse2', 'Digit1', 'Digit2', 'Tab', 'Space', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyV'].some((c) => this.input.pressed(c))
    const quiet = mood === 'explore' && p.hp >= p.maxHp && !this.interaction && p.state === 'move' && !acted && !p.focus
    this.calmT = quiet ? this.calmT + rdt : 0
    this.audio.lowHp = p.alive ? clamp(1 - p.hp / p.maxHp / 0.35, 0, 1) : 0
    this.audio.update(rdt)

    // death / end of the chapter
    if (!p.alive) {
      if (this.deathT < 0) {
        this.deathT = 0
        this.narrQueue = [pick(DEATH_LINES)]
        this.narrT = 0
      }
      this.deathT += rdt
      if (this.deathT > 2.6 && hud.get().screen === 'playing') hud.set({ screen: 'dead' })
    }
    if (this.victoryT >= 0) this.victoryT += rdt

    this.damage = Math.max(0, this.damage - rdt * 1.8)
    this.scarT -= rdt
    this.hudT -= rdt
    if (this.hudT <= 0) {
      this.hudT = 0.08
      this.syncHud()
    }
  }

  /** Without the coal Aldar does not leave the clearing (TRG_CH1_EMBER comes first). */
  private holdEmber() {
    if (this.kit.ember || !this.level.hearth || this.chapter !== 1) return
    const p = this.player
    const edge = 110 * CELL + 0.6
    if (p.pos.z < edge) {
      p.pos.z = edge
      if (this.time - this.emberNagT > 6) {
        this.emberNagT = this.time
        this.narrQueue.push({ who: 'Алдар', text: 'Без огня в урман не пойду. Под казаном мог уцелеть уголь.' })
      }
    }
  }

  /** TRG_CH1_EMBER: the coal into the father's vessel, the kalkan off the wall */
  private takeEmber() {
    const h = this.level.hearth
    const kit = this.kit
    if (!h || kit.ember) return
    kit.ember = true
    h.coal.visible = false
    h.gear.visible = false
    h.light.on = false
    this.tutor.tally.ember = 1
    this.sound('ignite', h.pos, { indicate: false, vol: 0.7 })
    this.toast('Ут-һауыт: уголь родного очага', 'info', 'flame')
    this.toast('Калкан со стены очага', 'item', 'kalkan')
    this.playScene(
      [
        { ...this.lineShot(PROLOGUE_02.coal[0]), cam: { x: h.pos.x, z: h.pos.z, dist: 12 } },
        { dur: 3.6, line: 'Алдар вложил уголь с берёзовым трутом в отцовский сосуд, застегнул его на ремне и снял со стены калкан. Крючья для лука пусты — Азамат впопыхах унёс его с собой.' },
        { cam: null, dur: 0.6 },
      ],
      () => this.hintQueue.push('В свете прорезей видны следы. Держи [F] — жар соберётся в луч.'),
    )
  }

  /** TRG_CH1_BOW_STREAM: Aldar finds his bow dropped by Azamat at the stream crossing */
  private takeBow() {
    const b = this.level.droppedBow
    const kit = this.kit
    if (kit.bow) return
    if (b) {
      b.taken = true
      b.mesh.visible = false
      b.light.on = false
      b.halo.sprite.visible = false
    }
    kit.bow = true
    kit.maxArrows = 5
    kit.arrows = Math.max(kit.arrows, 3)
    this.sound('arrow', b ? b.pos : this.player.pos, { indicate: false, vol: 0.85 })
    this.audio.play('ui', null, 0.45)
    this.toast('Лук йәйә отца · 3 стрелы', 'item', 'bow')
    const at = b ? b.pos : this.player.pos
    this.playScene(
      [
        { cam: { x: at.x, z: at.z, dist: 9.5 }, dur: 3.4, line: 'Лук отца! Азамат впопыхах унёс его из юрты и выронил здесь, когда перебегал через ручей.' },
        { cam: null, dur: 0.8, line: 'Тетива сухая, в колчане три стрелы. Вожака на уступе впереди можно достать только метким выстрелом.' },
      ],
      () => {
        this.tutor.begin('bow', true)
        this.hintQueue.push('Вожак стаи на высоком камне. Стойка с луком: [2] или [Tab], держи [ПКМ] для натяжения, [ЛКМ] — выстрел.')
      },
    )
  }

  private bowNagT = -10
  /** Cannot pass into the wolf ravine without the bow; picking it up is scripted and unmissable. */
  private holdBow() {
    const b = this.level.droppedBow
    const kit = this.kit
    if (kit.bow || this.chapter !== 1) return
    const p = this.player
    if (b && !b.taken) {
      const d = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z)
      if ((d < 2.5 || (p.pos.z <= b.pos.z + 0.6 && Math.abs(p.pos.x - b.pos.x) < 3.2)) && !this.inScene && hud.get().screen === 'playing') {
        p.startInteract(() => this.takeBow())
        return
      }
    }
    const edge = 79 * CELL + 0.6
    if (p.pos.z < edge) {
      p.pos.z = edge
      if (this.time - this.bowNagT > 6) {
        this.bowNagT = this.time
        this.narrQueue.push({ who: 'Алдар', text: 'Впереди лог волков. Без лука к вожаку на камне не подступиться. У ручья что-то блеснуло...' })
      }
    }
  }

  private calmT = 0
  /** zones already announced, the title on screen and how long it stays */
  private zonesSeen = new Set<number>()
  private zoneCard: { id: number; name: string; sub: string } | null = null
  private zoneT = 0
  private cryT = 4
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
    if (this.finalOpen) return 'silent'
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
    if (p.alive && p.state !== 'grabbed') list.push({ pos: p.pos, radius: p.radius, w: p.rootedT > 0 ? 0 : 0.25 })
    for (const e of this.enemies) if (e.alive && !e.hidden && e.airY < 1 && !e.ledge) list.push({ pos: e.pos, radius: e.radius, w: e.weight === 'heavy' ? 0.1 : 1 })
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
          const tw = a.w + b.w || 1
          a.pos.x -= dx * push * (a.w / tw)
          a.pos.z -= dz * push * (a.w / tw)
          b.pos.x += dx * push * (b.w / tw)
          b.pos.z += dz * push * (b.w / tw)
        }
      }
    }
  }

  private lanternHalo: Halo | null = null

  /** Falling needles and leaves, drifting ground fog of swamp blue near the hero. */
  private atmosphere(dt: number) {
    const air = this.def.env.air
    if (air !== 'needles') return this.atmosphereOther(dt, air)
    const p = this.player.pos
    const vfx = this.vfx
    for (let i = 0; i < 2; i++) {
      if (Math.random() > dt * 4) continue
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 11
      const x = p.x + Math.cos(a) * r
      const z = p.z + Math.sin(a) * r
      const gold = fbm(x * 0.06 + 3, z * 0.06 - 2) > 0.58 || this.level.drops.some((d) => !!d.grove?.revived && Math.hypot(d.grove.center.x - x, d.grove.center.z - z) < 10)
      vfx.soft.spawn({ x, y: 6 + Math.random() * 3, z, vx: 0.25 + Math.random() * 0.3, vy: -0.55 - Math.random() * 0.35, vz: (Math.random() - 0.5) * 0.3, r: gold ? 0.42 : 0.15, g: gold ? 0.28 : 0.1, b: gold ? 0.07 : 0.055, a: 0.95, size: gold ? 0.11 : 0.07, life: 11, drag: 0.15 })
    }
    if (Math.random() < dt * 1.3) {
      const a = Math.random() * Math.PI * 2
      const r = 3 + Math.random() * 11
      const x = p.x + Math.cos(a) * r
      const z = p.z + Math.sin(a) * r
      // docs/LEVELS.md: the swamp blue of the fog (#16262e)
      if (this.field.sample(x, z) > -1) vfx.soft.spawn({ x, y: 0.35 + Math.random() * 0.5, z, vx: 0.18, vy: 0.02, vz: 0.06, r: 0.13, g: 0.22, b: 0.27, a: 0.07, size: 3 + Math.random() * 2.5, life: 10, drag: 0, grow: 0.6 })
    }
  }

  /** the steppe: silver seeds of the feather grass on the wind and a grey ground haze; the mountain: snow above, icy steam below */
  private atmosphereOther(dt: number, air: 'grass' | 'snow') {
    const p = this.player.pos
    const vfx = this.vfx
    const summit = this.chapter === 3 && p.z / CELL < SUMMIT_ROW + 3
    for (let i = 0; i < (air === 'snow' && summit ? 4 : 2); i++) {
      if (Math.random() > dt * 4) continue
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 12
      const x = p.x + Math.cos(a) * r
      const z = p.z + Math.sin(a) * r
      if (air === 'grass') vfx.soft.spawn({ x: x - 5, y: 0.4 + Math.random() * 2.2, z, vx: 1.6 + Math.random(), vy: (Math.random() - 0.4) * 0.3, vz: (Math.random() - 0.5) * 0.4, r: 0.38, g: 0.4, b: 0.42, a: 0.8, size: 0.035, life: 6, drag: 0.1 })
      else if (summit) vfx.soft.spawn({ x: x - 3, y: 6 + Math.random() * 3, z, vx: 0.8 + Math.random() * 0.5, vy: -1 - Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.4, r: 0.8, g: 0.85, b: 0.95, a: 0.9, size: 0.07, life: 9, drag: 0.1 })
      else vfx.soft.spawn({ x, y: 4.5 + Math.random(), z, vy: -3.5, r: 0.3, g: 0.38, b: 0.45, a: 0.7, size: 0.03, life: 1.4, drag: 0 })
    }
    if (Math.random() < dt * 1.3) {
      const a = Math.random() * Math.PI * 2
      const r = 3 + Math.random() * 11
      const x = p.x + Math.cos(a) * r
      const z = p.z + Math.sin(a) * r
      const c = air === 'grass' ? [0.16, 0.19, 0.21] : [0.32, 0.4, 0.45]
      if (this.field.seeSample(x, z) > -1) vfx.soft.spawn({ x, y: 0.35 + Math.random() * 0.5, z, vx: air === 'grass' ? 0.5 : 0.1, vy: 0.02, vz: 0.06, r: c[0], g: c[1], b: c[2], a: air === 'grass' ? 0.06 : 0.05, size: 3 + Math.random() * 2.5, life: 10, drag: 0, grow: 0.6 })
    }
  }

  private updateWorld(dt: number) {
    const L = this.level
    const p = this.player
    // the roots across the way back rise
    const g = L.gate
    if (g && g.closed && g.anim < 1) {
      g.anim = Math.min(1, g.anim + dt * 1.3)
      g.mesh.position.y = lerp(-4.5, 0, 1 - Math.pow(1 - g.anim, 3))
    }
    // TRG_CH1_SHURALE_START: onto the glade — the kurai from the hollow, Shurale jumps from the branch, roots close the way
    const b = this.boss
    if (g && b && b.alive && !b.fightStarted && !this.bossIntro && p.alive && p.pos.z < g.center.z - 1.2 && this.director) {
      this.bossIntro = true
      this.closeGate()
      this.director.bossIntro()
    }
    if (g && b && b.alive && !b.fightStarted && !this.bossIntro && p.alive && p.pos.z < g.center.z - 1.2 && b instanceof Shurale) {
      this.bossIntro = true
      this.closeGate()
      const oak = L.oak ?? b.pos
      const hol = L.hollow
      if (hol) this.sound('kurai', new THREE.Vector3(hol.x, 0, hol.z), { indicate: false, vol: 1 })
      const intro = SHURALE_INTRO.lines![0] as Line
      this.playScene(
        [
          { cam: { x: oak.x, z: oak.z + 2, dist: 19 }, dur: 1.8 },
          { dur: 1.2, run: () => b.startFight() },
          this.lineShot(intro),
          { cam: null, dur: 0.8 },
        ],
        () => this.hintQueue.push(...(SHURALE_INTRO.hints ?? [])),
      )
    }
    // revived groves and sprouting drops
    for (const d of L.drops) {
      const gr = d.grove
      if (gr && gr.revived && gr.t < 1) {
        gr.t = Math.min(1, gr.t + dt * 0.5)
        const k = 1 - Math.pow(1 - gr.t, 3)
        for (const f of gr.foliage) {
          f.scale.setScalar(Math.max(0.001, k))
          f.position.y = -0.5 + k * 0.5
        }
      }
      const st = this.sproutT.get(d)
      if (st !== undefined && st < 1) {
        const t = Math.min(1, st + dt * 0.6)
        this.sproutT.set(d, t)
        d.sprouts.scale.setScalar(Math.max(0.001, 1 - Math.pow(1 - t, 3)))
      }
      if (!d.taken) {
        d.orb.position.y = 1.1 + Math.sin(this.time * 2 + d.n) * 0.06
        d.orb.scale.set(1 + Math.sin(this.time * 9) * 0.04, 1 - Math.sin(this.time * 9) * 0.04, 1)
      }
    }
    // the raven's nest falls off its bough
    const n = L.nest
    if (n && n.fallen && n.t < 1) {
      n.t = Math.min(1, n.t + dt * 1.6)
      n.mesh.position.y = lerp(3.45, 0.08, n.t * n.t)
      n.mesh.rotation.z = n.t * 1.2
      if (n.t >= 1) {
        this.sound('crack', n.pos, { indicate: false, vol: 0.5 })
        const pk = this.pickups.list.find((x) => x.keepsake === 'feather' && !x.taken)
        if (pk) pk.mesh.visible = true
      }
    }
    // the stream: moonlight on the ripples, foam collars and wakes around anyone wading
    if (L.stream) {
      const waders: { x: number; z: number }[] = []
      if (p.alive && p.airY < 0.3) waders.push(p.pos)
      for (const e of this.enemies) {
        if (waders.length >= 4) break
        if (e.alive && this.field.isWater(e.pos.x, e.pos.z)) waders.push(e.pos)
      }
      L.stream.update(this.lighting.moon, waders)
    }
    // DLG_CH1_FIRST_DROP: the first drop speaks to the blood in Aldar's chest; later chapters give each drop a shorter word
    for (const d of L.drops) {
      if (d.taken || this.dropsSaid.has(d) || d.pos.distanceTo(p.pos) > 8) continue
      this.dropsSaid.add(d)
      if (this.chapter === 1) {
        if (!this.firstDropSaid) this.narrQueue.push(...FIRST_DROP)
        this.firstDropSaid = true
      } else this.narrQueue.push(d.n === 5 ? 'Последняя капля Йәншишмә сочилась из скалы. Больше земля ничего не предложит.' : 'Ещё одна капля Йәншишмә дрожала на больной земле. Кровь Алдара снова толкнулась ей навстречу.')
    }
    // the first flash before a blow teaches what it means (docs/COMBAT.md): amber — the kalkan, red — a roll or Kara
    if (!this.amberTaught || !this.redTaught) {
      for (const e of this.enemies) {
        if (!e.visibleNow) continue
        const tel = e.telegraph
        if (tel === 'amber' && !this.amberTaught && this.kit.ember) {
          this.amberTaught = true
          this.hintQueue.unshift('Янтарный блик — удар можно встретить калканом. Нажми [ПКМ] в миг удара: враг потеряет равновесие.')
          this.hintT = 0
        } else if (tel === 'red' && !this.redTaught) {
          this.redTaught = true
          this.hintQueue.unshift('Красный блик — щит не удержит. Только перекат [Пробел] или беркут [R].')
          this.hintT = 0
        }
      }
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
        if (this.director) {
          this.director.trigger(t.id, t.pos)
          continue
        }
        if (t.id === '6') {
          // the pack answers from the ravine ahead long before it is seen
          const wolf = this.enemies.find((e) => e.kind === 'wolf' && e.alive)
          if (wolf) this.sound('wolf_howl', wolf.pos, { tone: 'threat', strength: 0.9, id: wolf.id })
          if (this.kit.bow) this.tutor.begin('bow')
        }
        if (t.id === '9') this.findClue('kurai', true)
        if (t.id === 'h') {
          // the dead hunter's last seconds: he runs, glances back, falls
          this.echo.play(new THREE.Vector3(t.pos.x + 1.5, 0, t.pos.z - 8), [
            { to: new THREE.Vector3(t.pos.x + 0.8, 0, t.pos.z - 3.5), dur: 1.4 },
            { to: t.pos.clone(), dur: 1.1, look: -1.1, whisper: true },
            { clip: HERO_CLIPS.death, dur: 1.5 },
          ])
        } else if (t.id === 'A') {
          // thirty winters ago a man ran through here from the mountains, a waterskin pressed to his chest (docs/STORY.md)
          const at = new THREE.Vector3(t.pos.x + 4, 0, t.pos.z - 5)
          this.echo.play(at, [
            { to: new THREE.Vector3(t.pos.x + 0.6, 0, t.pos.z - 0.6), dur: 1.5 },
            { clip: HERO_CLIPS.interact, dur: 1.4, whisper: true },
            { dur: 0.7, look: 0.9 },
            { to: new THREE.Vector3(t.pos.x - 3, 0, t.pos.z + 6), dur: 1.8 },
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

  /** Feeds the onboarding with what Aldar actually did this frame. */
  private updateTutor(rdt: number) {
    const p = this.player
    const tt = this.tutor
    const live = hud.get().screen === 'playing' && !this.cine && !this.choiceDrop && !this.loreOpen && p.alive
    const prev = this.tutorPrev
    if (live && prev) {
      const t = tt.tally
      if (p.state === 'move') t.moved += Math.min(1, Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z))
      t.turned += Math.abs(wrapAngle(p.gaze - prev.gaze))
      if (p.swings > prev.swings) t.attacks += p.swings - prev.swings
      if (p.state === 'dodge' && prev.state !== 'dodge') t.dodges++
      if (p.guard) t.guard += rdt
      if (p.state === 'bow') t.draw += rdt
      t.bow = p.weapon === 'bow' ? 1 : t.bow
      t.shots += p.arrowsShot - prev.shots
      t.parries += p.parries - prev.parries
      t.bashes += p.bashes - prev.bashes
      t.breaths += p.breaths - prev.breaths
    }
    this.tutorPrev = { x: p.pos.x, z: p.pos.z, gaze: p.gaze, state: p.state, swings: p.swings, shots: p.arrowsShot, parries: p.parries, bashes: p.bashes, breaths: p.breaths }
    if (!live) return
    if (this.inCombat) tt.begin('fight', true)
    if (p.blocks > 0) tt.begin('parry')
    if (p.hp < p.maxHp * 0.5 && this.kit.fervor >= 50 && !this.inScene) tt.begin('wounds', true)
    if (tt.update(rdt)) this.audio.play('ui', null, 0.45)
  }

  setTutor(on: boolean) {
    this.tutor.setEnabled(on)
    hud.set({ tutorOn: on })
  }

  /** what [E] does here, in order of what matters most */
  private findInteraction(): Interaction | null {
    const p = this.player
    const L = this.level
    const kit = this.kit
    for (const e of this.enemies) if (e.finishable && e.pos.distanceTo(p.pos) < e.radius + 2.4) return { label: 'Добить', run: () => p.startFinisher(e) }
    const own = this.director?.interaction()
    if (own) return own
    const h = L.hearth
    if (h && !kit.ember && h.pos.distanceTo(p.pos) < 1.9) return { label: 'Разгрести золу под казаном', run: () => p.startInteract(() => this.takeEmber()) }
    const b = L.droppedBow
    if (b && !kit.bow && !b.taken && b.pos.distanceTo(p.pos) < 2.4) return { label: 'Поднять отцовский лук йәйә', run: () => p.startInteract(() => this.takeBow()) }
    const bar = this.barrierInteraction()
    if (bar) return bar
    if (this.marten?.state === 'trapped' && L.trap && L.trap.pos.distanceTo(p.pos) < 2.4) return { label: 'Разжать капкан', hold: 0.9, run: () => p.startInteract(() => this.freeMarten()) }
    for (const id of Object.keys(L.clues) as ClueId[]) {
      const at = L.clues[id]!
      if (this.clueFound.has(id) || !CLUES[id].prompt || Math.hypot(at.x - p.pos.x, at.z - p.pos.z) > 2.3) continue
      if (id === 'prints' && !kit.ember) continue
      if (id === 'ribbon') return { label: CLUES[id].prompt, run: () => p.startInteract(() => this.readRibbon()) }
      return { label: CLUES[id].prompt, run: () => p.startInteract(() => this.findClue(id)) }
    }
    // taking a thing comes before resting by the fire it lies near
    for (const pk of this.pickups.list) {
      if (pk.taken || !pk.mesh.visible || pk.pos.distanceTo(p.pos) > 1.9) continue
      return { label: pk.label, run: () => p.startInteract(() => this.collect(pk)) }
    }
    const s = L.spring
    if (s && s.pos.distanceTo(p.pos) < 3.3)
      return {
        label: 'Отдохнуть у старого ключа',
        run: () =>
          p.startInteract(() => {
            this.sound('spring', s.pos, { indicate: false })
            this.rest(s.pos, new THREE.Vector3(s.pos.x, 0, s.pos.z + 2.6))
            if (!this.springUsedOnce) {
              this.springUsedOnce = true
              this.narrQueue.push(SPRING_USED)
            }
          }),
      }
    for (const f of L.fires) {
      if (f.pos.distanceTo(p.pos) > 3.4) continue
      return {
        label: 'Отдохнуть у огня',
        run: () =>
          p.startInteract(() => {
            this.sound('ignite', f.pos, { indicate: false, vol: 0.5 })
            this.rest(f.pos, new THREE.Vector3(f.pos.x + 1.6, 0, f.pos.z + 1.6))
          }),
      }
    }
    for (const cf of L.coldFires) {
      if (cf.pos.distanceTo(p.pos) > 3.2) continue
      if (cf.lit)
        return {
          label: 'Отдохнуть у огня',
          run: () => p.startInteract(() => this.rest(cf.pos, new THREE.Vector3(cf.pos.x - 1.6, 0, cf.pos.z - 1.6))),
        }
      return p.lightOn ? { label: 'Разжечь кострище от сосуда', run: () => p.startInteract(() => this.lightColdFire(cf)) } : { label: 'Нечем разжечь', key: '' }
    }
    for (const d of L.drops) {
      if (d.taken || d.pos.distanceTo(p.pos) > 2.7) continue
      return { label: 'Склониться над каплей живой воды', run: () => this.openChoice(d) }
    }
    for (const t of L.tamgas) {
      if (t.pos.distanceTo(p.pos) > 2.3) continue
      return {
        label: t.read ? 'Перечитать тамгу' : 'Прочесть тамгу',
        run: () => {
          t.read = true
          this.openLore(t.id)
        },
      }
    }
    for (const b of L.braziers) {
      if (b.lit || b.pos.distanceTo(p.pos) > 2.5) continue
      return p.lightOn ? { label: 'Зажечь жаровню от сосуда', run: () => p.startInteract(() => this.setBrazier(b, true, true)) } : { label: 'Нечем зажечь', key: '' }
    }
    return null
  }

  private updateInteraction(rdt: number) {
    const p = this.player
    this.interaction = null
    if (!p.alive || p.state !== 'move' || this.choiceDrop || this.finalOpen) {
      this.holdT = 0
      return
    }
    const it = this.findInteraction()
    this.interaction = it
    if (!it || !it.run || p.guard) {
      this.holdT = 0
      return
    }
    if (it.hold) {
      // a held action: the ring fills while [E] is down
      if (this.input.isDown('KeyE') && this.holdLabel === it.label) this.holdT += rdt
      else if (this.input.pressed('KeyE')) {
        this.holdLabel = it.label
        this.holdT = 0
      } else this.holdT = 0
      if (this.holdT >= it.hold) {
        this.holdT = 0
        it.run()
      }
    } else if (this.input.pressed('KeyE')) it.run()
  }

  /**
   * Light decides how far Aldar sees: night eyes reach a few metres and follow the moon behind the clouds; beyond them the
   * cone shows only lit places. Every light of the level counts, the belt vessel carries a circle with him (smaller with
   * every drop drunk), and the heat focus throws a narrow cone of 12 m ahead.
   */
  private feedVisionLight(rdt: number) {
    const p = this.player
    const v = this.vision
    const moon = moonLevel.value * this.moonScale
    v.darkFull = lerp(lerp(3, 5, moon) * this.nightEyes, v.range, this.dawn)
    v.darkFade = lerp(lerp(6.5, 9.5, moon) * this.nightEyes, v.range + 4, this.dawn)
    const target = p.lightOn ? 1 : 0
    this.lanternVis += (target - this.lanternVis) * (1 - Math.exp(-6 * rdt))
    const lm = this.kit.lightMult
    const list = this.visLights
    list.length = 0
    list.push({ x: p.pos.x, z: p.pos.z, full: 7 * lm, fade: 11 * lm, level: this.lanternVis })
    if (this.focusVis > 0.02) {
      const dx = Math.sin(p.gaze)
      const dz = Math.cos(p.gaze)
      for (const [d, r] of [[3, 1.3], [5.5, 1.9], [8, 2.4], [10.5, 2.9]] as const) list.push({ x: p.pos.x + dx * d * lm, z: p.pos.z + dz * d * lm, full: r * 0.7, fade: r * 1.2, level: this.focusVis })
    }
    // a point light of reach D shows its surroundings to about half of it
    for (const s of this.lighting.sources) list.push({ x: s.pos.x, z: s.pos.z, full: s.distance * 0.3, fade: s.distance * 0.5, level: s.level })
    for (const e of this.extraVis) list.push(e)
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
    const bossOn = !!this.boss && this.boss.fightStarted && this.boss.alive && !(this.boss instanceof Shulgen && this.boss.distToPlayer < 6)
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
    if (!this.lanternHalo) this.lanternHalo = this.level.halos.add(new THREE.Vector3(), new THREE.Color(1, 0.55, 0.22), 2.2, 0.3, null)
    p.model.vesselCore.getWorldPosition(this.lanternHalo.sprite.position)
    this.lanternHalo.strength = p.lightOn ? 0.3 * this.kit.lightMult : 0
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
    fu.uExposure.value = this.def.env.exposure + this.dawn * 0.35
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
    this.lighting.moon.intensity = lerp(this.def.env.moonMin, this.def.env.moonMax, moonLevel.value) * this.moonScale

    this.renderer.shadowMap.needsUpdate = true
    this.frameN++
    const lanternShadow = this.lighting.lantern.shadow
    if (!this.debugShadowFrozen) {
      lanternShadow.needsUpdate = lanternShadow.needsUpdate || (this.frameN & 1) === 0 || (this.quality === 'high' && this.fps > 100)
    }
    const ghosts = this.enemies.some((e) => e.revealT > 0 && e.alive && !e.visibleNow && !e.hidden)
    this.post.render(this.scene, this.camera, this.vision.texture, rdt, ghosts, this.overlay)

    this.indicators.draw(this.camera, rdt)
    const scr = hud.get().screen
    if (scr === 'playing' && !this.cine) {
      const w = this.container.clientWidth
      const h = this.container.clientHeight
      for (const e of this.enemies) {
        if (!e.alive || e.kind === 'boss' || !e.visibleNow) continue
        const marked = e.marks.red > 0 || e.marks.white > 0 || e.marks.teal > 0
        if (!e.aggro && e.hp >= e.maxHp && !marked) continue
        const hp = this.tmpV.set(e.pos.x, 2.25 + e.hitHeight + e.airY, e.pos.z).project(this.camera)
        this.indicators.drawBar(((hp.x + 1) / 2) * w, ((1 - hp.y) / 2) * h, e.hp / e.maxHp, e.posture / e.maxPosture, e.finishable, marked ? e.marks : null)
      }
    }
    this.debugHudT -= rdt
    if (this.debug && this.debugHudT <= 0) {
      this.debugHudT = 0.25
      const i = this.renderer.info.render
      hud.set({ debug: [
        `${this.fps} fps · ${this.frameMs.toFixed(1)} ms avg · ${this.frameP95.toFixed(1)} ms p95`,
        `${i.calls} draw · ${(i.triangles / 1000).toFixed(0)}k tris · ${size.x}×${size.y} · DPR ${this.renderer.getPixelRatio()}`,
        `GPU: ${this.debugGpu}`,
        `[4] Тень щита от огня: ${this.debugShieldShadow ? 'вкл' : 'выкл'}`,
        `[5] Тень огня: ${this.lighting.lantern.castShadow ? 'вкл' : 'выкл'} · качество ${this.quality}`,
        `[6] Карта тени: ${this.debugShadowFrozen ? 'заморожена' : 'обновляется'}`,
        'Сравнивать через 3 с после переключения. [Ё / ~] Скрыть панель',
      ].join('\n') })
    }
  }

  syncHud() {
    const p = this.player
    const b = this.boss
    const kit = this.kit
    const it = this.interaction
    const partial: Partial<HudState> = {
      hp: Math.max(0, Math.round(p.hp)),
      maxHp: p.maxHp,
      fervor: Math.floor(kit.fervor),
      maxFervor: kit.maxFervor,
      dodge: p.dodgeCharges,
      dodgeMax: p.dodgeMax,
      dodgeRecharge: p.dodgeCharges < p.dodgeMax ? 1 - Math.max(0, p.dodgeRecharge) / 1.1 : 1,
      eagleCd: p.eagleCd / p.eagleCdMax,
      weapon: p.weapon,
      armed: kit.ember,
      hasBow: kit.bow,
      bowDraw: p.state === 'bow' ? p.bowDraw : 0,
      bowPeak: p.bowPeak,
      fireNocked: p.fireNocked,
      vessel: { lit: p.lightOn, clog: Math.ceil(p.clogT), flashCd: Math.round((p.flashCd / 2.5) * 20) / 20, focus: p.focus },
      breath: Math.round(p.breath * 20) / 20,
      boss: b && b.fightStarted && b.alive ? { name: b.name, title: b.title, hp: Math.round(b.hp), maxHp: b.maxHp, posture: Math.round(b.posture), maxPosture: b.maxPosture } : null,
      prompt: it ? { text: it.label, key: it.key ?? 'E', hold: it.hold ? Math.round((this.holdT / it.hold) * 20) / 20 : null } : null,
      narration: this.curNarr,
      hint: this.curHint,
      tutor: this.tutor.view(),
      zone: this.zoneCard,
      grab: p.state === 'grabbed' ? Math.round(p.grabProgress * 20) / 20 : null,
      combat: this.inCombat,
      drunk: kit.waterDebt,
      given: kit.earthHealed,
      kills: this.kills,
      deaths: this.deaths,
      fps: this.fps,
      calm: this.calmT > 3.5,
      companion: this.marten?.active ? { state: this.marten.state, threats: this.marten.sensed.length } : null,
      son: this.son ? { cd: Math.round((this.son.kuraiCd / 10) * 20) / 20, state: this.son.state } : null,
      scar: Math.round(Math.max(0, this.scarT) * 10) / 10,
      sense: p.bloodSense,
      finalChoice: this.finalOpen,
    }
    const now = performance.now() / 1000
    this.toastList = this.toastList.filter((t) => now - t.t < 3.6)
    partial.toasts = this.toastList.map(({ id, text, kind, icon }) => ({ id, text, kind, icon }))
    const snap = kit.snapshot()
    const sig = JSON.stringify(snap)
    if (sig !== this.kitSig) {
      this.kitSig = sig
      partial.kit = snap
    }
    hud.set(partial)
  }
}
