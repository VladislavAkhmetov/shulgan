import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Humanoid } from './rig'

/**
 * Aldar's Mixamo body. Three layers, bottom to top:
 *  1. clips in the mixer: idle, idle_combat, run, roll; the blows, the charge and death are scrubbed by the game's
 *     own timing (the clip's strike lands inside the game's hit window, see BLOWS);
 *  2. procedural poses for states without a clip, retargeted onto the Mixamo bones (world-space deltas from a shared
 *     reference pose);
 *  3. an upper-body layer for the bow and the block, so Aldar aims and guards while his legs walk.
 * The procedural rig still runs underneath: logic, hands for the lasso and eagle, springs.
 */

const MAP: [string, string][] = [
  ['hips', 'Hips'],
  ['spine', 'Spine'],
  ['chest', 'Spine2'],
  ['neck', 'Neck'],
  ['head', 'Head'],
  ['shL', 'LeftArm'],
  ['elL', 'LeftForeArm'],
  ['haL', 'LeftHand'],
  ['shR', 'RightArm'],
  ['elR', 'RightForeArm'],
  ['haR', 'RightHand'],
  ['thL', 'LeftUpLeg'],
  ['knL', 'LeftLeg'],
  ['ftL', 'LeftFoot'],
  ['thR', 'RightUpLeg'],
  ['knR', 'RightLeg'],
  ['ftR', 'RightFoot'],
]

/** the part of "Stand To Roll" that is the roll itself */
const UP = new THREE.Vector3(0, 1, 0)
const ROLL_FROM = 0.72
const ROLL_TO = 1.95
const ROLL_SHOWN = 0.55
const RUN_SPEED = 5.2

/**
 * [clip, clip time at n=0, at hitStart, at hitEnd, at n=1] for every blow of the kylys: the game keeps its short,
 * snappy timings, the clip is warped piecewise so its fastest sweep falls inside the hit window.
 */
type Blow = [string, number, number, number, number]
const BLOWS: Record<string, Blow> = {
  kos: ['atk_kos', 0.25, 0.53, 0.68, 0.88],
  obr: ['atk_obr', 0.5, 0.8, 0.95, 1.12],
  ukol: ['atk_ukol', 0.25, 0.55, 0.72, 0.86],
  vypad: ['atk_ukol', 0.33, 0.55, 0.72, 0.86],
  // Ответное рассечение: the backhand, faster
  counter: ['atk_obr', 0.5, 0.8, 0.95, 1.12],
  // Удар щитом: the shoving thrust until the Shield Bash clip arrives (docs/EQUIPMENT.md)
  bash: ['atk_ukol', 0.3, 0.55, 0.72, 0.86],
  // the clip turns the whole body a full circle itself (the code's spin is off while it plays)
  polu: ['atk_polu', 0.45, 0.87, 1.25, 1.5],
  // the wind-up was the charge (CHARGE_*): the blow starts overhead
  slam: ['atk_heavy', 0.62, 0.78, 0.9, 1.35],
}
/** Рассечение's wind-up: atk_heavy's overhead raise, held while the charge grows */
const CHARGE_FROM = 0.12
const CHARGE_TO = 0.62
/** death: skip the first still frames, fall a bit faster than the clip */
const DEATH_FROM = 0.15
const DEATH_SPEED = 1.15
/** bow_draw from reaching for the arrow (0.1) to the full draw (1.0) follows the game's draw 0..1 */
const DRAW_FROM = 0.1
const SHOT_SPEED = 1.25
/** the block clip is a held pose */
const BLOCK_T = 0.5
/** clips scrubbed by the code (time set every frame) */
/**
 * States played as one clip on the state's own clock: [seconds in the state, clip time] keys, linear between them.
 * The moments that matter land where the game acts: the lasso leaves the hand at 0.17 s, the pick-up touches the
 * ground at 0.36 s, the finisher's blade goes in at 0.6 s.
 */
const TIMED: Record<string, { clip: string; keys: [number, number][] }> = {
  hurt: { clip: 'hit', keys: [[0, 0.1], [0.38, 0.85]] },
  // Kara leaves the glove (Standing Torch Light in docs/EQUIPMENT.md; the throw until then)
  eagle: { clip: 'throw', keys: [[0, 0.45], [0.15, 0.87], [0.35, 1.2]] },
  // «Вспышка живицы»: a short sweep of the hand toward the belt
  flash: { clip: 'throw', keys: [[0, 0.5], [0.12, 0.85], [0.3, 1.1]] },
  interact: { clip: 'pickup', keys: [[0, 0.35], [0.36, 0.98], [0.9, 1.85]] },
  finisher: { clip: 'finisher', keys: [[0, 0.1], [0.6, 0.85], [1.0, 1.45]] },
}
/** «Перевести дух» lasts 0.8 s: the drink clip's hand-to-chest stretch */
const DRINK_FROM = 1.0
const DRINK_TO = 2.85
const DRINK_DUR = 0.8
/** stance walk (Shift): four directions blended by the step; metres per walk cycle at the game's pace */
const STANCE_CYCLE = 1.7
const STANCE_CLIPS = ['stance_fwd', 'stance_back', 'stance_left', 'stance_right'] as const
/**
 * The side steps turn the chest toward the step (left +38°, right −37°, measured on the shoulders). The spine turns
 * it back to where the forward step faces (−20°), so Aldar keeps facing the enemy whichever way he steps.
 */
const TORSO_TARGET = -20
const TORSO: Record<string, number> = { stance_left: 38, stance_right: -37 }
const SCRUBBED = /^(atk_|death$|block$|bow_|stance_|hit$|throw$|pickup$|finisher$|drink$)/

function keyed(t: number, keys: [number, number][]) {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0))
    }
  }
  return keys[keys.length - 1][1]
}
/** clips laid over the upper body */
const UPPER_CLIPS = ['block', 'bow_draw', 'bow_aim', 'bow_shot', 'drink']

function warp(n: number, hit: [number, number], b: Blow) {
  const [, c0, c1, c2, c3] = b
  const [h0, h1] = hit
  if (n <= h0) return c0 + (c1 - c0) * (n / Math.max(h0, 1e-3))
  if (n <= h1) return c1 + (c2 - c1) * ((n - h0) / Math.max(h1 - h0, 1e-3))
  return c2 + (c3 - c2) * Math.min(1, (n - h1) / Math.max(1 - h1, 1e-3))
}

export interface AnimInput {
  state: string
  speed: number
  stance: boolean
  forward: number
  /** danger near or a blow just struck: the combat stance replaces the calm idle */
  combat: boolean
  weapon: 'blade' | 'bow'
  /** step direction against the facing: forward (+1 ahead) and side (+1 to Aldar's left) */
  side: number
  /** holding the guard: Shift with the kylys and a shield (the block comes with the shield) */
  block: boolean
  /** the blow being struck: kos, obr, ukol, polu, vypad, slam */
  action: string
  /** progress of the blow, 0..1 */
  n: number
  /** the blow's hit window, in n */
  hit: [number, number]
  /** charge of Рассечение, 0..1 */
  charge: number
  /** bow draw, 0..1 */
  draw: number
  /** arrows loosed so far: a change plays the shot's recoil */
  shots: number
  /** seconds in the current state */
  st: number
}

/** a clip's rotations for the upper-body layer, evaluated at any time */
interface UpperPose {
  dur: number
  hips: THREE.Interpolant | null
  rot: Map<THREE.Bone, THREE.Interpolant>
}

export class HeroAnimator {
  readonly root = new THREE.Group()
  private mixer: THREE.AnimationMixer
  private act: Record<string, THREE.AnimationAction> = {}
  private w: Record<string, number> = {}
  private combatK = 0
  /** base_body (hidden when dressed), base_head (always), outfit_<name> */
  private parts: Record<string, THREE.SkinnedMesh> = {}
  private proc = 1
  private bones: Record<string, THREE.Bone> = {}
  private order: THREE.Bone[] = []
  private refProc = new Map<string, THREE.Quaternion>()
  private refMix = new Map<THREE.Bone, THREE.Quaternion>()
  private mapped = new Map<THREE.Bone, string>()
  private bindLocal = new Map<THREE.Bone, THREE.Quaternion>()
  private hipsBind = new THREE.Vector3()
  private hipsRefProc = new THREE.Vector3()
  private hipsRefMix = new THREE.Vector3()
  private rollT = -1
  private time = 0
  private shots = -1
  /** seconds since the arrow left, -1 when no shot is playing */
  private shotT = -1
  private upperPoses: Record<string, UpperPose> = {}
  /** Spine and everything above it */
  private upper: THREE.Bone[] = []
  private overK = 0
  /** shared phase of the stance walk, in cycles */
  private stanceP = 0
  private lastOver: [string, number] | null = null
  private q = new THREE.Quaternion()
  private q2 = new THREE.Quaternion()
  private q3 = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private worldQ = new Map<THREE.Bone, THREE.Quaternion>()

  private constructor(
    private rig: Humanoid,
    gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] },
    height: number,
    props: THREE.Object3D[],
    flash: THREE.MeshStandardMaterial[],
  ) {
    const scene = gltf.scene
    const meshes: THREE.SkinnedMesh[] = []
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
      if ((o as THREE.Bone).isBone) {
        const name = o.name.replace(/^mixamorig:?/, '')
        this.bones[name] = o as THREE.Bone
        this.order.push(o as THREE.Bone)
      }
    })
    if (!meshes.length) throw new Error('hero_rig: no skinned mesh')
    for (const m of meshes) {
      m.castShadow = true
      m.frustumCulled = false
      this.parts[m.name] = m
      const mat = m.material as THREE.MeshStandardMaterial
      if (!flash.includes(mat)) flash.push(mat)
    }

    // fit: feet on the ground, given height (measured on the base body, not on an outfit)
    this.root.add(scene)
    scene.updateMatrixWorld(true)
    const bb = new THREE.Box3()
    for (const m of meshes) if (!m.name.startsWith('outfit_')) bb.expandByObject(m)
    const k = height / (bb.max.y - bb.min.y)
    scene.scale.multiplyScalar(k)
    scene.position.y = -bb.min.y * k
    this.root.updateMatrixWorld(true)

    // clips: no root motion (code moves Aldar); the roll is cut to the roll itself. Death keeps its stagger and fall.
    this.mixer = new THREE.AnimationMixer(scene)
    for (const clip of gltf.animations) {
      for (const tr of clip.tracks) {
        if (/Hips\.position$/.test(tr.name) && clip.name !== 'death') {
          const v = tr.values
          for (let i = 0; i < v.length; i += 3) {
            v[i] = v[0]
            v[i + 2] = v[2]
          }
        }
      }
      const a = this.mixer.clipAction(clip)
      a.play()
      a.setEffectiveWeight(clip.name === 'idle' ? 1 : 0)
      if (SCRUBBED.test(clip.name)) a.paused = true
      this.w[clip.name] = clip.name === 'idle' ? 1 : 0
      this.act[clip.name] = a
    }
    if (this.act.roll) this.act.roll.setLoop(THREE.LoopOnce, 1).clampWhenFinished = true

    // the upper-body layer reads its clips directly, bone by bone
    const spine = this.bones.Spine
    if (spine) spine.traverse((o) => (o as THREE.Bone).isBone && this.upper.push(o as THREE.Bone))
    const upperSet = new Set(this.upper)
    for (const clip of gltf.animations) {
      if (!UPPER_CLIPS.includes(clip.name)) continue
      const pose: UpperPose = { dur: clip.duration, hips: null, rot: new Map() }
      for (const tr of clip.tracks) {
        const m = /^(.*)\.quaternion$/.exec(tr.name)
        if (!m) continue
        const bone = this.bones[m[1].replace(/^mixamorig:?/, '')]
        const slerp = () => new THREE.QuaternionLinearInterpolant(tr.times, tr.values, 4, new Float32Array(4))
        if (bone === this.bones.Hips) pose.hips = slerp()
        else if (bone && upperSet.has(bone)) pose.rot.set(bone, slerp())
      }
      this.upperPoses[clip.name] = pose
    }

    // reference pose: Mixamo bind pose vs the procedural rig with its arms raised the same way
    for (const b of this.order) this.bindLocal.set(b, b.quaternion.clone())
    const J = rig.joints
    const saved = { p: rig.root.position.clone(), r: rig.root.rotation.clone(), bp: rig.body.position.clone(), br: rig.body.rotation.clone() }
    rig.root.position.set(0, 0, 0)
    rig.root.rotation.set(0, 0, 0)
    rig.body.position.set(0, 0, 0)
    rig.body.rotation.set(0, 0, 0)
    for (const n of Object.keys(J)) J[n].rotation.set(0, 0, 0)
    for (const side of ['L', 'R']) {
      const arm = this.bones[(side === 'L' ? 'Left' : 'Right') + 'Arm']
      const fore = this.bones[(side === 'L' ? 'Left' : 'Right') + 'ForeArm']
      const a = arm.getWorldPosition(new THREE.Vector3())
      const f = fore.getWorldPosition(new THREE.Vector3())
      const ang = Math.atan2(Math.abs(f.x - a.x), a.y - f.y)
      J['sh' + side].rotation.z = side === 'L' ? ang : -ang
    }
    rig.root.updateMatrixWorld(true)
    for (const [pj, mb] of MAP) {
      const bone = this.bones[mb]
      if (!bone) continue
      this.mapped.set(bone, pj)
      this.refProc.set(pj, J[pj].getWorldQuaternion(new THREE.Quaternion()))
      this.refMix.set(bone, bone.getWorldQuaternion(new THREE.Quaternion()))
    }
    J.hips.getWorldPosition(this.hipsRefProc)
    this.bones.Hips.getWorldPosition(this.hipsRefMix)
    this.hipsBind.copy(this.bones.Hips.position)

    // props move onto the Mixamo bones, inside a holder that copies their procedural joint's frame
    const jointToBone: Record<string, string> = { haR: 'RightHand', haL: 'LeftHand', elL: 'LeftForeArm', elR: 'RightForeArm', chest: 'Spine2', hips: 'Hips', spine: 'Spine' }
    const jointNames = new Map(Object.entries(J).map(([n, o]) => [o as THREE.Object3D, n]))
    for (const prop of props) {
      let top: THREE.Object3D = prop
      while (top.parent && !jointNames.has(top.parent)) top = top.parent
      const jn = top.parent ? jointNames.get(top.parent)! : null
      const bone = jn ? this.bones[jointToBone[jn] ?? 'Hips'] : null
      if (!jn || !bone) continue
      const joint = J[jn]
      const holder = new THREE.Object3D()
      joint.getWorldQuaternion(holder.quaternion)
      bone.getWorldPosition(holder.position)
      // the bone lives in the model's scaled space: the holder undoes that scale so props stay metric
      bone.updateMatrixWorld(true)
      const inv = bone.matrixWorld.clone().invert()
      const m = new THREE.Matrix4().compose(holder.position, holder.quaternion, new THREE.Vector3(1, 1, 1)).premultiply(inv)
      m.decompose(holder.position, holder.quaternion, holder.scale)
      bone.add(holder)
      holder.add(top)
    }

    for (const n of Object.keys(J)) J[n].rotation.set(0, 0, 0)
    rig.root.position.copy(saved.p)
    rig.root.rotation.copy(saved.r)
    rig.body.position.copy(saved.bp)
    rig.body.rotation.copy(saved.br)

    // the procedural body is no longer drawn
    rig.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = false
    })
  }

  /** Outfits in the model file, without the prefix: ['kaftan', ...] */
  get outfits() {
    return Object.keys(this.parts)
      .filter((n) => n.startsWith('outfit_'))
      .map((n) => n.slice(7))
  }

  /** Dress Aldar: null = the base shirt. The head is always the base's; the base body hides under clothes. */
  setOutfit(name: string | null) {
    const has = !!name && !!this.parts['outfit_' + name]
    for (const [n, m] of Object.entries(this.parts)) {
      if (n === 'base_head') m.visible = true
      else if (n === 'base_body') m.visible = !has
      else m.visible = has && n === 'outfit_' + name
    }
  }

  static async load(rig: Humanoid, url: string, height: number, props: THREE.Object3D[], flash: THREE.MeshStandardMaterial[]) {
    const gltf = await new GLTFLoader().loadAsync(url)
    return new HeroAnimator(rig, gltf, height, props, flash)
  }

  /** the file has this clip */
  has(name: string) {
    return !!this.act[name]
  }

  update(dt: number, inp: AnimInput) {
    const rig = this.rig
    this.root.position.copy(rig.root.position)
    this.root.rotation.copy(rig.root.rotation)
    this.time += dt
    const s = inp.state

    // 1. a blow, the charge or death: one clip, scrubbed by the game's own clock
    let driven: [string, number] | null = null
    const blow = s === 'attack' || s === 'slam' || s === 'bash' ? BLOWS[inp.action] : undefined
    if (blow && this.act[blow[0]]) driven = [blow[0], warp(inp.n, inp.hit, blow)]
    else if (s === 'charge' && this.act.atk_heavy) driven = ['atk_heavy', CHARGE_FROM + (CHARGE_TO - CHARGE_FROM) * inp.charge]
    else if (TIMED[s] && this.act[TIMED[s].clip]) driven = [TIMED[s].clip, keyed(inp.st, TIMED[s].keys)]
    else if (s === 'dead' && this.act.death) driven = ['death', Math.min(this.act.death.getClip().duration, DEATH_FROM + inp.st * DEATH_SPEED)]

    // the roll (a strike out of it cuts it short)
    if (s === 'dodge' && this.rollT < 0 && this.act.roll) {
      this.rollT = 0
      this.act.roll.reset().play()
      this.act.roll.time = ROLL_FROM
    }
    if (driven) this.rollT = -1
    const rolling = this.rollT >= 0 && this.rollT < ROLL_SHOWN
    if (this.rollT >= 0) {
      this.rollT += dt
      if (this.rollT >= ROLL_SHOWN) this.rollT = -1
    }

    // 3. the upper-body layer: drawing and holding the bow, the shot's recoil, the block
    if (inp.shots !== this.shots && this.shots >= 0 && this.act.bow_shot) this.shotT = 0
    else if (s !== 'move') this.shotT = -1
    this.shots = inp.shots
    let over: [string, number] | null = null
    let overTarget = 1
    if (s === 'bow') {
      over = inp.draw < 0.999 || !this.act.bow_aim ? ['bow_draw', DRAW_FROM + (1 - DRAW_FROM) * inp.draw] : ['bow_aim', this.time % this.act.bow_aim.getClip().duration]
    } else if (this.shotT >= 0) {
      const dur = this.act.bow_shot.getClip().duration
      const t = this.shotT * SHOT_SPEED
      this.shotT += dt
      if (t >= dur) this.shotT = -1
      else {
        over = ['bow_shot', t]
        // the arms settle back into the walk over the last third
        overTarget = THREE.MathUtils.clamp((dur - t) / (dur * 0.35), 0, 1)
      }
    } else if (s === 'breath') {
      // «Перевести дух»: a hand to the chest, as the sip used to be
      over = ['drink', DRINK_FROM + (DRINK_TO - DRINK_FROM) * Math.min(1, inp.st / DRINK_DUR)]
    } else if (s === 'move' && inp.block) over = ['block', BLOCK_T]
    if (over && !this.upperPoses[over[0]]) over = null

    // which source drives the legs and hips
    const walking = s === 'move' || s === 'bow' || s === 'breath'
    // the stance walk: Shift, drawing the bow, a sip on the move
    const stanceWalk = (inp.stance || s === 'bow' || s === 'breath') && !!this.act.stance_fwd
    // without the stance clips the side and back steps stay procedural
    const strafing = !this.act.stance_fwd && (inp.stance || s === 'bow') && inp.speed > 0.3 && inp.forward < 0.5
    const useClips = !!driven || (rolling ? s === 'dodge' || s === 'move' : walking && !strafing)
    this.proc += ((useClips ? 0 : 1) - this.proc) * Math.min(1, dt / (useClips ? 0.14 : 0.08))

    // clip weights
    const runK = THREE.MathUtils.clamp((inp.speed - 0.4) / 1.6, 0, 1)
    this.combatK += ((inp.combat && this.act.idle_combat ? 1 : 0) - this.combatK) * Math.min(1, dt / 0.35)
    const target: Record<string, number> = {}
    if (rolling) target.roll = 1
    else if (driven) target[driven[0]] = 1
    else {
      const still = 1 - runK
      // standing, the bow and the block take the legs too: the archer's and the guard's stance
      if (over && this.act[over[0]]) target[over[0]] = still
      else {
        target.idle = still * (1 - this.combatK)
        target.idle_combat = still * this.combatK
      }
      if (stanceWalk) {
        const f = THREE.MathUtils.clamp(inp.forward, -1, 1)
        const sd = THREE.MathUtils.clamp(inp.side, -1, 1)
        const dir = { stance_fwd: Math.max(0, f), stance_back: Math.max(0, -f), stance_left: Math.max(0, sd), stance_right: Math.max(0, -sd) }
        const sum = dir.stance_fwd + dir.stance_back + dir.stance_left + dir.stance_right || 1
        for (const n of STANCE_CLIPS) target[n] = runK * (dir[n] / sum)
      } else target.run = runK
    }
    for (const [n, a] of Object.entries(this.act)) {
      const to = target[n] ?? 0
      // a blow snaps in; everything else blends
      const tau = n === 'roll' || n === driven?.[0] ? 0.05 : driven ? 0.06 : 0.15
      this.w[n] += (to - this.w[n]) * Math.min(1, dt / tau)
      if (this.w[n] < 1e-3 && to === 0) this.w[n] = 0
      a.setEffectiveWeight(this.w[n])
    }
    if (driven) this.act[driven[0]].time = driven[1]
    if (over && this.act[over[0]]) this.act[over[0]].time = over[1]
    // one phase for the four directions, so a diagonal step blends feet that move together
    this.stanceP = (this.stanceP + (dt * inp.speed) / STANCE_CYCLE) % 1
    for (const n of STANCE_CLIPS) if (this.act[n]) this.act[n].time = this.stanceP * this.act[n].getClip().duration
    if (this.act.run) this.act.run.timeScale = THREE.MathUtils.clamp(inp.speed / RUN_SPEED, 0.55, 1.4)
    if (this.act.roll) this.act.roll.timeScale = (ROLL_TO - ROLL_FROM) / ROLL_SHOWN
    this.mixer.update(dt)

    // the chest of the side steps turns back toward the enemy
    let torso = 0
    for (const [n, deg] of Object.entries(TORSO)) torso += (this.w[n] ?? 0) * (TORSO_TARGET - deg)
    if (Math.abs(torso) > 0.5) {
      const a = THREE.MathUtils.degToRad(torso) / 2
      this.twist(this.bones.Spine, a)
      this.twist(this.bones.Spine1, a)
    }

    // 2. procedural poses
    if (this.proc >= 0.002) this.applyProcedural()

    // 3. upper body over whatever the legs do
    // a blow out of the guard drops it at once
    this.overK += ((over ? overTarget : 0) - this.overK) * Math.min(1, dt / (over ? 0.07 : driven ? 0.04 : 0.14))
    if (over) this.lastOver = over
    if (this.overK > 0.002 && this.lastOver) this.applyUpper(this.lastOver[0], this.lastOver[1], this.overK)
  }

  /** Turn a bone about the world's vertical (the model only yaws, so this is the body's own vertical). */
  private twist(b: THREE.Bone | undefined, a: number) {
    if (!b?.parent) return
    b.parent.getWorldQuaternion(this.q2)
    this.q.setFromAxisAngle(UP, a)
    this.q3.copy(this.q2).invert().multiply(this.q).multiply(this.q2)
    b.quaternion.premultiply(this.q3)
  }

  /** where the Mixamo hand is in the world (the rope and the eagle leave from it) */
  handWorld(side: 'L' | 'R', out: THREE.Vector3) {
    const b = this.bones[side === 'L' ? 'LeftHand' : 'RightHand']
    return b ? b.getWorldPosition(out) : null
  }

  /**
   * A clip's upper body on top of the current legs. The spine is anchored to the model, not to the hips: the torso
   * faces where it faced in the clip (the aim stays on the target) however the hips swing in the walk.
   */
  private applyUpper(name: string, t: number, k: number) {
    const pose = this.upperPoses[name]
    const hips = this.bones.Hips
    const spine = this.bones.Spine
    if (pose.hips) this.q3.fromArray(pose.hips.evaluate(t) as unknown as number[])
    else this.q3.copy(this.bindLocal.get(hips)!)
    for (const b of this.upper) {
      const it = pose.rot.get(b)
      if (!it) continue
      this.q.fromArray(it.evaluate(t) as unknown as number[])
      if (b === spine) this.q.premultiply(this.q3).premultiply(this.q2.copy(hips.quaternion).invert())
      b.quaternion.slerp(this.q, k)
    }
  }

  /** procedural pose → Mixamo bones: world delta from the reference, applied to the bind world rotation */
  private applyProcedural() {
    const rig = this.rig
    rig.root.updateMatrixWorld(true)
    const J = rig.joints
    this.root.updateMatrixWorld(true)
    const parentQ = (b: THREE.Object3D) => {
      const p = b.parent!
      if ((p as THREE.Bone).isBone && this.worldQ.has(p as THREE.Bone)) return this.worldQ.get(p as THREE.Bone)!
      return p.getWorldQuaternion(new THREE.Quaternion())
    }
    this.worldQ.clear()
    for (const b of this.order) {
      const pq = parentQ(b)
      const pj = this.mapped.get(b)
      let world: THREE.Quaternion
      if (pj) {
        J[pj].getWorldQuaternion(this.q)
        world = this.q.clone().multiply(this.q2.copy(this.refProc.get(pj)!).invert()).multiply(this.refMix.get(b)!)
      } else {
        world = pq.clone().multiply(this.bindLocal.get(b)!)
      }
      // both world rotations include the hero's yaw (procedural root and this.root follow it together)
      const local = pq.clone().invert().multiply(world)
      b.quaternion.slerp(local, this.proc)
      this.worldQ.set(b, pq.clone().multiply(b.quaternion))
    }
    // hips travel: crouches and lunges of the procedural poses
    J.hips.getWorldPosition(this.v)
    rig.root.worldToLocal(this.v)
    this.v.sub(this.hipsRefProc)
    const hipsTo = this.hipsRefMix.clone().add(this.v)
    this.root.localToWorld(hipsTo)
    const hips = this.bones.Hips
    hips.parent!.worldToLocal(hipsTo)
    hips.position.lerp(hipsTo, this.proc)
  }
}
