import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Batcher, blob, displace, ensureUv, limb, merge, paint, prep, solid, type RGB } from './geo'
import { Halos, type Halo, PINES, addStoryProp, placeDetails, registerDressing } from './dressing'
import { CELL, type LevelData, type Marker } from './map'
import type { ClueId } from '../clues'
import type { Circle, Field } from './field'
import { fbm, lerp, mulberry32, smoothstep, vnoise, GLSL_NOISE } from '../util'
import { barkTexture, birchTexture, glow, groundTexture, needleTexture, ornamentTexture, patchMaterial, std } from '../render/materials'
import type { Lighting, LightSource } from '../render/lights'
import { makeFlame, type VFX } from '../render/vfx'
import { buildStream, type Stream } from './water'
import { buildLake, groundAt, groundCtx, placeBiomeGround, placeBiomeWalls, registerBiome, type BiomeOpts, type Lake } from './biome'
import { bridgeMesh, buildExtras, emptyExtras, veilMesh, type Extras } from './extras'
import type { Biome } from '../chapters'


// ---------------------------------------------------------------- vegetation & props

function spruceGeo(seed: number) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.1, 0.3, 3.4, 7, 1).translate(0, 1.7, 0)
  parts.push(solid(trunk, [0.07, 0.05, 0.04]))
  const tiers = 5
  const totalTop = 1.0 + tiers * 1.45 + 1.6
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1)
    const r = lerp(2.5, 0.75, t) * (0.9 + rng() * 0.2)
    const h = lerp(2.9, 2.0, t)
    const y = 1.0 + i * 1.45
    const cone = new THREE.ConeGeometry(r, h, 15, 4, true)
    const pos = cone.attributes.position
    const phase = rng() * 10
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k)
      const yy = pos.getY(k)
      const z = pos.getZ(k)
      const rim = smoothstep(0.1, -h / 2, yy)
      const ang = Math.atan2(z, x)
      const lobe = 1 + 0.18 * Math.sin(ang * 5 + phase) * rim + (rng() - 0.5) * 0.12 * rim
      pos.setXYZ(k, x * lobe, yy - rim * (0.15 + rng() * 0.35) * (0.6 + 0.4 * Math.sin(ang * 3 + phase)), z * lobe)
    }
    cone.computeVertexNormals()
    cone.translate(0, y + h / 2, 0)
    paint(cone, (p) => {
      const rad = Math.hypot(p.x, p.z) / r
      const top = p.y / totalTop
      const k = Math.min(1, rad) * 0.8 + top * 0.35
      return [lerp(0.02, 0.07, k), lerp(0.04, 0.115, k), lerp(0.038, 0.085, k)]
    })
    parts.push(cone)
  }
  const spike = new THREE.ConeGeometry(0.28, 1.6, 6, 1, true).translate(0, 1.0 + tiers * 1.45 + 0.7, 0)
  parts.push(solid(spike, [0.06, 0.1, 0.075]))
  return merge(parts)
}

function birchTrunkGeo(seed: number, h = 7.5) {
  const rng = mulberry32(seed)
  const g = new THREE.CylinderGeometry(0.1, 0.17, h, 8, 6)
  const pos = g.attributes.position
  const bend = rng() * 6
  for (let k = 0; k < pos.count; k++) {
    const y = pos.getY(k) + h / 2
    pos.setX(k, pos.getX(k) + Math.sin(y * 0.35 + bend) * 0.18)
  }
  g.computeVertexNormals()
  g.translate(0, h / 2, 0)
  return solid(g, [0.9, 0.9, 0.88])
}

function birchLeavesGeo(seed: number, golden: number) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const r = 0.9 + rng() * 0.7
    const b = displace(blob(r, 1), 0.5, 1.4, seed + i)
    const a = rng() * Math.PI * 2
    const d = rng() * 1.1
    b.translate(Math.cos(a) * d, 4.6 + rng() * 3.0, Math.sin(a) * d)
    const gold = rng() < golden
    paint(b, (p, n) => {
      const k = 0.55 + n.y * 0.35 + (vnoise(p.x * 3, p.z * 3) - 0.5) * 0.4
      return gold ? [0.34 * k, 0.22 * k, 0.05 * k] : [0.13 * k, 0.15 * k, 0.05 * k]
    })
    parts.push(b)
  }
  return merge(parts)
}

function deadTreeGeo(seed: number, scale = 1, color: RGB = [0.075, 0.062, 0.055]) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const h = (5 + rng() * 2.5) * scale
  const lean = new THREE.Vector3((rng() - 0.5) * 0.6, 1, (rng() - 0.5) * 0.6).normalize()
  const base = new THREE.Vector3(0, -0.2, 0)
  const top = lean.clone().multiplyScalar(h)
  parts.push(limb(base, top, 0.32 * scale, 0.07 * scale, 7))
  const nb = 5 + Math.floor(rng() * 3)
  for (let i = 0; i < nb; i++) {
    const t = 0.35 + rng() * 0.6
    const a = base.clone().lerp(top, t)
    const ang = rng() * Math.PI * 2
    const len = (1.2 + rng() * 2.2) * scale * (1.1 - t * 0.5)
    const dir = new THREE.Vector3(Math.cos(ang), 0.5 + rng() * 0.8, Math.sin(ang)).normalize()
    const b = a.clone().addScaledVector(dir, len)
    parts.push(limb(a, b, 0.11 * scale * (1.2 - t), 0.02 * scale, 5))
    for (let j = 0; j < 2; j++) {
      const a2 = a.clone().lerp(b, 0.5 + rng() * 0.4)
      const d2 = dir.clone().add(new THREE.Vector3(rng() - 0.5, rng() * 0.6, rng() - 0.5)).normalize()
      parts.push(limb(a2, a2.clone().addScaledVector(d2, len * 0.45), 0.035 * scale, 0.008 * scale, 4))
    }
  }
  const g = merge(parts)
  return paint(g, (p) => {
    const k = 0.75 + vnoise(p.x * 4, p.y * 4) * 0.5
    return [color[0] * k, color[1] * k, color[2] * k]
  })
}

function rockGeo(seed: number) {
  const g = displace(blob(1, 2), 0.55, 1.3, seed * 3.1)
  g.scale(1, 0.62, 1)
  g.computeVertexNormals()
  g.translate(0, 0.25, 0)
  return paint(g, (p, n) => {
    const moss = smoothstep(0.35, 0.8, n.y + (vnoise(p.x * 2.5, p.z * 2.5) - 0.5) * 0.5)
    const k = 0.8 + vnoise(p.x * 6 + seed, p.y * 6) * 0.4
    return [lerp(0.12, 0.045, moss) * k, lerp(0.115, 0.075, moss) * k, lerp(0.11, 0.035, moss) * k]
  })
}

function fernGeo(seed: number) {
  const rng = mulberry32(seed)
  const pos: number[] = []
  const col: number[] = []
  const blades = 9
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rng() * 0.5
    const L = 0.7 + rng() * 0.5
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const segs = 5
    let prevL: number[] | null = null
    let prevR: number[] | null = null
    for (let s = 0; s <= segs; s++) {
      const t = s / segs
      const d = t * L
      const y = Math.sin(t * Math.PI * 0.75) * 0.45 * L
      const w = 0.13 * (1 - t) + 0.01
      const cx = ca * d
      const cz = sa * d
      const l = [cx - sa * w, y, cz + ca * w]
      const r = [cx + sa * w, y, cz - ca * w]
      if (prevL && prevR) {
        pos.push(...prevL, ...prevR, ...l, ...prevR, ...r, ...l)
        const c0 = [0.03 + t * 0.05, 0.06 + t * 0.08, 0.025 + t * 0.03]
        for (let k = 0; k < 6; k++) col.push(...c0)
      }
      prevL = l
      prevR = r
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  ensureUv(g)
  return g
}

function grassGeo(seed: number) {
  const rng = mulberry32(seed)
  const pos: number[] = []
  const col: number[] = []
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2
    const r = rng() * 0.25
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const h = 0.35 + rng() * 0.45
    const lean = (rng() - 0.5) * 0.4
    const w = 0.035
    pos.push(x - w, 0, z, x + w, 0, z, x + lean, h, z + lean * 0.5)
    col.push(0.07, 0.07, 0.035, 0.07, 0.07, 0.035, 0.16, 0.15, 0.08)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  ensureUv(g)
  return g
}

function bushGeo(seed: number) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const b = displace(blob(0.5 + rng() * 0.35, 1), 0.35, 2, seed + i)
    b.translate((rng() - 0.5) * 0.8, 0.35 + rng() * 0.2, (rng() - 0.5) * 0.8)
    paint(b, (_p, n) => {
      const k = 0.6 + n.y * 0.4
      return [0.03 * k, 0.055 * k, 0.035 * k]
    })
    parts.push(b)
  }
  return merge(parts)
}

function mushroomGeo(seed: number, glowing: boolean) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 3 + Math.floor(rng() * 4)
  for (let i = 0; i < n; i++) {
    const x = (rng() - 0.5) * 0.6
    const z = (rng() - 0.5) * 0.6
    const h = 0.08 + rng() * 0.16
    const r = 0.05 + rng() * 0.07
    const stem = new THREE.CylinderGeometry(r * 0.3, r * 0.4, h, 5).translate(x, h / 2, z)
    const cap = new THREE.SphereGeometry(r, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, h, z)
    if (glowing) {
      solid(stem, [0.15, 0.45, 0.42])
      solid(cap, [0.18, 1.1, 0.95])
    } else {
      solid(stem, [0.25, 0.22, 0.18])
      solid(cap, [0.22, 0.1, 0.05])
    }
    parts.push(stem, cap)
  }
  return merge(parts)
}

function logGeo(seed: number) {
  const rng = mulberry32(seed)
  const len = 3 + rng() * 2.5
  const g = new THREE.CylinderGeometry(0.28, 0.34, len, 8, 3)
  displace(g, 0.12, 2, seed)
  g.rotateZ(Math.PI / 2)
  g.translate(0, 0.25, 0)
  return paint(g, (p, n) => {
    const moss = smoothstep(0.3, 0.9, n.y)
    const k = 0.8 + vnoise(p.x * 3, p.z * 5) * 0.4
    return [lerp(0.08, 0.04, moss) * k, lerp(0.06, 0.07, moss) * k, lerp(0.045, 0.03, moss) * k]
  })
}

// ---------------------------------------------------------------- interactive structures

export interface Brazier {
  pos: THREE.Vector3
  lit: boolean
  flame: THREE.Object3D
  coal: THREE.Mesh
  light: LightSource
  arena: boolean
}

export interface Spring {
  pos: THREE.Vector3
  light: LightSource
  water: THREE.ShaderMaterial
}

/** A drop of living water on a split black boulder (docs/ASSETS.md 2.4), TRG_WATER_DROP_01..05. */
export interface Drop {
  /** its number in the game, 1..5 (chapter 1 has the first two) */
  n: number
  pos: THREE.Vector3
  group: THREE.Group
  orb: THREE.Mesh
  light: LightSource
  /** young shoots and white kurai flowers, shown once the drop is given to the earth */
  sprouts: THREE.Group
  taken: boolean
  /** the dead grove around it, if any, comes alive when it is given */
  grove: Grove | null
}

export interface Grove {
  center: THREE.Vector3
  foliage: THREE.Object3D[]
  light: LightSource
  revived: boolean
  t: number
}

export interface Gate {
  cells: number[]
  mesh: THREE.Object3D
  circles: Circle[]
  closed: boolean
  anim: number
  center: THREE.Vector3
}

/**
 * Thorns that burn, or a deadfall that can be pushed from one side (chapter 1); the spirits' veil across the alley of
 * balbals and the raised drawbridge of the flooded sanctuary (chapter 2).
 */
export interface Barrier {
  kind: 'thorns' | 'deadfall' | 'veil' | 'bridge'
  cells: number[]
  circles: Circle[]
  mesh: THREE.Group
  mat: THREE.MeshStandardMaterial
  open: boolean
  /** opening animation 0..1, -1 = idle */
  t: number
  center: THREE.Vector3
}

export type EmitterKind = 'embers' | 'smoke' | 'motes' | 'fireflies' | 'sparkle' | 'spores' | 'spirit' | 'snow'

export interface Emitter {
  pos: THREE.Vector3
  kind: EmitterKind
  rate: number
  radius: number
  acc: number
  active: () => boolean
}

/** the flooded yurt's hearth: the last coal under the overturned cauldron, the kalkan and the bow on the wall lattice */
export interface Hearth {
  pos: THREE.Vector3
  /** the threshold, where a scrap of rusty fur lies */
  door: THREE.Vector3
  /** the tiny living coal (hidden once taken) */
  coal: THREE.Object3D
  /** the gear on the wall (hidden once taken) */
  gear: THREE.Object3D
  light: LightSource
}

/** a cold fire pit: the flame comes from the vessel's coal (docs/ROADMAP.md, «Решения реализации») */
export interface ColdFire {
  pos: THREE.Vector3
  lit: boolean
  flame: THREE.Object3D
  coal: THREE.Mesh
  light: LightSource
}

/** the raven's nest on a bough over the path (zone 3): an arrow brings it down */
export interface Nest {
  pos: THREE.Vector3
  mesh: THREE.Object3D
  fallen: boolean
  t: number
}

/** Aldar's bow and quiver lost by Azamat at the stream (TRG_CH1_BOW_STREAM) */
export interface DroppedBow {
  pos: THREE.Vector3
  mesh: THREE.Group
  light: LightSource
  halo: Halo
  taken: boolean
}

export interface LevelBuild {
  root: THREE.Group
  start: THREE.Vector3
  braziers: Brazier[]
  spring: Spring | null
  drops: Drop[]
  gate: Gate | null
  emitters: Emitter[]
  triggers: { id: string; pos: THREE.Vector3; fired: boolean }[]
  spawns: Marker[]
  arenaCenter: THREE.Vector3
  fires: LightSource[]
  instancedMeshes: number
  halos: Halos
  /** readable clan stones: id = lore page */
  tamgas: { pos: THREE.Vector3; id: number; read: boolean }[]
  /** where each sign of the abductors lies (src/game/clues.ts) */
  clues: Partial<Record<ClueId, THREE.Vector3>>
  /** footprints show only in the heat focus: x, z of the vessel, the gaze angle, strength 0..1 */
  trackFocus: { value: THREE.Vector4 }
  /** the rusty trap that holds Susar */
  trap: { pos: THREE.Vector3; open: () => void } | null
  barriers: Barrier[]
  /** the great oak's hollow, 5.5 m up, where Azamat hides (a sound landmark) */
  hollow: THREE.Vector3 | null
  /** the oak's foot: Shurale waits in its crown */
  oak: THREE.Vector3 | null
  /** pines at the edge of the glade where Shurale hides in phase 2 */
  perches: THREE.Vector3[]
  hearth: Hearth | null
  nest: Nest | null
  droppedBow: DroppedBow | null
  /** arrows standing in trunks and targets: pulled out on approach */
  stuckArrows: { pos: THREE.Vector3; dir: THREE.Vector3 }[]
  /** stones an arrow breaks on */
  stones: Circle[]
  /** the hunters' cold fire pits: lit from the vessel, they become a rest */
  coldFires: ColdFire[]
  /** threads of blue wool Azamat tied on twigs for his father */
  threads: THREE.Vector3[]
  /** centres of shallow-water cells (babble near the banks) */
  waterSpots: THREE.Vector3[]
  /** the mountain stream surface (docs/ART.md, "Вода"); the game feeds it the moon and the waders */
  stream: Stream | null
  biome: Biome
  /** the deep black water of chapters 2–3 */
  lake: Lake | null
  /** the places and things of chapters 2–3 (level/extras.ts) */
  extras: Extras
}

export interface BuildOpts extends Partial<BiomeOpts> {
  /** the first lore page of this chapter's stones */
  loreBase?: number
}

const springVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

export function buildLevel(scene: THREE.Scene, level: LevelData, field: Field, lights: Lighting, vfx: VFX, opts: BuildOpts = {}): LevelBuild {
  const biome: Biome = opts.biome ?? 'urman'
  const bo: BiomeOpts = { biome, summitRow: opts.summitRow, abyssRow: opts.abyssRow, clay: opts.clay, forestRow: opts.forestRow }
  const gctx = groundCtx(bo, level)
  const urman = biome === 'urman'
  const root = new THREE.Group()
  root.name = 'level'
  scene.add(root)
  const rng = mulberry32(1337)
  const batch = new Batcher()

  // ---------- materials
  const nTex = needleTexture()
  nTex.repeat.set(5, 3)
  const vegMat = patchMaterial(std(0xffffff, 0.92, { vertexColors: true, map: nTex }), { wind: 0.012, windStart: 2.5, fade: true })
  const deadMat = patchMaterial(std(0xffffff, 1, { vertexColors: true, map: barkTexture() }), { wind: 0.004, windStart: 3, fade: true })
  const bTex = birchTexture()
  bTex.repeat.set(1, 2.5)
  const birchBark = patchMaterial(std(0xffffff, 0.85, { vertexColors: true, map: bTex }), { fade: true })
  const leafMat = patchMaterial(std(0xffffff, 0.9, { vertexColors: true }), { wind: 0.03, windStart: 3.5, fade: true })
  const lowVeg = patchMaterial(std(0xffffff, 0.95, { vertexColors: true, side: THREE.DoubleSide }), { wind: 0.09, windStart: 0.05 })
  const rockMat = std(0xffffff, 0.95, { vertexColors: true })
  const rockFadeMat = patchMaterial(std(0xffffff, 0.95, { vertexColors: true }), { fade: true })
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true })

  // shallow water as a soft 0..1 mask: bilinear over the cell grid
  const waterCell = (c: number, r: number) => (c >= 0 && r >= 0 && c < level.cols && r < level.rows ? level.water[r * level.cols + c] : 0)
  const waterAt = (x: number, z: number) => {
    const fx = x / CELL - 0.5
    const fz = z / CELL - 0.5
    const c0 = Math.floor(fx)
    const r0 = Math.floor(fz)
    const tx = fx - c0
    const tz = fz - r0
    return lerp(lerp(waterCell(c0, r0), waterCell(c0 + 1, r0), tx), lerp(waterCell(c0, r0 + 1), waterCell(c0 + 1, r0 + 1), tx), tz)
  }
  /** 0..1 stream bed: lowers the ground and shapes the water surface, so the banks of both always agree */
  const bedAt = (x: number, z: number) => (field.sample(x, z) > -1 ? smoothstep(0.3, 0.75, waterAt(x, z) + (fbm(x * 0.13, z * 0.13) - 0.5) * 0.3) : 0)

  // ---------- ground
  {
    const W = level.width
    const D = level.depth
    const g = new THREE.PlaneGeometry(W, D, Math.ceil(W / 1), Math.ceil(D / 1))
    g.rotateX(-Math.PI / 2)
    g.translate(W / 2, 0, D / 2)
    const pos = g.attributes.position
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const sd = field.sample(x, z)
      const n = fbm(x * 0.13, z * 0.13)
      const n2 = vnoise(x * 0.7, z * 0.7)
      const floor: RGB = [0.1 * (0.7 + 0.6 * n), 0.083 * (0.7 + 0.6 * n), 0.064 * (0.7 + 0.55 * n)]
      const moss: RGB = [0.042 * (0.8 + 0.4 * n2), 0.062 * (0.8 + 0.4 * n2), 0.032 * (0.8 + 0.4 * n2)]
      const deep: RGB = [0.026, 0.03, 0.022]
      // the stream bed: washed gravel, a little lower than the banks (the water tints it)
      const wm = bedAt(x, z)
      if (!urman) {
        const gs = groundAt(gctx, x, z, sd, wm)
        col[i * 3] = gs.c[0]
        col[i * 3 + 1] = gs.c[1]
        col[i * 3 + 2] = gs.c[2]
        pos.setY(i, gs.y)
        continue
      }
      let c: RGB
      if (sd > 0) {
        const k = smoothstep(0.2, 2.6, sd + (n - 0.5) * 1.8)
        c = [lerp(moss[0], floor[0], k), lerp(moss[1], floor[1], k), lerp(moss[2], floor[2], k)]
      } else {
        const k = smoothstep(0, -3, sd)
        c = [lerp(moss[0], deep[0], k), lerp(moss[1], deep[1], k), lerp(moss[2], deep[2], k)]
      }
      if (wm > 0) {
        const gv = 0.75 + 0.5 * vnoise(x * 1.9 + 7, z * 1.9) + (n2 - 0.5) * 0.3
        const gravel: RGB = [0.062 * gv, 0.058 * gv, 0.048 * gv]
        c = [lerp(c[0], gravel[0], wm * 0.9), lerp(c[1], gravel[1], wm * 0.9), lerp(c[2], gravel[2], wm * 0.9)]
      }
      col[i * 3] = c[0]
      col[i * 3 + 1] = c[1]
      col[i * 3 + 2] = c[2]
      const y = sd < 0 ? Math.min(-sd, 4) * 0.16 * (0.5 + n) : -0.24 * wm
      pos.setY(i, y)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.computeVertexNormals()
    const tex = groundTexture()
    tex.repeat.set(W / 5, D / 5)
    const ground = new THREE.Mesh(g, std(0xffffff, 1, { vertexColors: true, map: tex }))
    ground.receiveShadow = true
    ground.name = 'ground'
    root.add(ground)
  }

  // ---------- the mountain stream: flowing clear water over gravel (src/game/level/water.ts)
  const waterSpots: THREE.Vector3[] = []
  const waterCells: [number, number][] = []
  for (let r = 0; r < level.rows; r++)
    for (let c = 0; c < level.cols; c++)
      if (level.water[r * level.cols + c]) {
        waterCells.push([c, r])
        waterSpots.push(new THREE.Vector3((c + 0.5) * CELL, 0, (r + 0.5) * CELL))
      }
  const stream = buildStream({ cells: waterCells, cell: CELL, bedAt, level: -0.07 })
  if (stream) root.add(stream.mesh)
  const lake = urman ? null : buildLake(level, bo, moonLevel, lights.moonOffset)
  if (lake) root.add(lake.mesh)

  // ---------- register instanced types
  const SPRUCE = ['spruce0', 'spruce1', 'spruce2']
  SPRUCE.forEach((k, i) => batch.register(k, spruceGeo(10 + i), vegMat))
  const BIRCH = ['birch0', 'birch1']
  BIRCH.forEach((k, i) => {
    const trunk = birchTrunkGeo(40 + i)
    const leaves = birchLeavesGeo(50 + i, 0.45)
    const g = mergeGeometries([prep(trunk), prep(leaves)], true)!
    batch.register(k, g, [birchBark, leafMat])
  })
  batch.register('deadbirch', birchTrunkGeo(77, 6), birchBark)
  const DEAD = ['dead0', 'dead1']
  DEAD.forEach((k, i) => batch.register(k, deadTreeGeo(60 + i), deadMat))
  const ROCK = ['rock0', 'rock1', 'rock2']
  ROCK.forEach((k, i) => batch.register(k, rockGeo(i + 1), rockMat))
  batch.register('boulder', rockGeo(9), rockFadeMat)
  batch.register('fern0', fernGeo(3), lowVeg, false)
  batch.register('fern1', fernGeo(4), lowVeg, false)
  batch.register('grass', grassGeo(5), lowVeg, false)
  batch.register('bush', bushGeo(6), vegMat, true)
  batch.register('mush', mushroomGeo(7, false), rockMat, false)
  batch.register('glowmush', mushroomGeo(8, true), glowMat, false)
  batch.register('log', logGeo(11), rockMat)
  // stream stones: darker and glossy where the water keeps them wet
  const wetStone = std(0x9a9a9a, 0.38, { vertexColors: true })
  batch.register('wetstone0', rockGeo(4), wetStone)
  batch.register('wetstone1', rockGeo(5), wetStone)
  batch.register('pebble', rockGeo(6), wetStone, false)
  if (stream)
    for (const s of stream.stones) {
      const rot = rng() * Math.PI * 2
      if (s.top) {
        // flat-topped stones that just break the surface (low enough to step over)
        const sy = 0.22 + rng() * 0.14
        batch.add(rng() < 0.5 ? 'wetstone0' : 'wetstone1', s.x, -0.22, s.z, rot, s.s, sy, s.s * (0.75 + rng() * 0.4))
      } else {
        const y = -0.24 * bedAt(s.x, s.z) - 0.015
        batch.add('pebble', s.x, y, s.z, rot, s.s, s.s * (0.4 + rng() * 0.25), s.s * (0.7 + rng() * 0.5))
      }
    }
  registerDressing(batch, vegMat, rockMat)
  const biomeKit = urman ? null : registerBiome(batch, bo)
  const halos = new Halos(root)

  const markersOf = (ch: string) => level.markers.filter((m) => m.ch === ch)
  // the dead grove belongs to the drop nearest the white birches (drop 1)
  const birchMarks = markersOf('x')
  let groveCenter: THREE.Vector3 | null = null
  if (birchMarks.length) {
    const cx = birchMarks.reduce((a, m) => a + m.x, 0) / birchMarks.length
    const cz = birchMarks.reduce((a, m) => a + m.z, 0) / birchMarks.length
    let bd = 1e9
    for (const d of markersOf('D')) {
      const dd = Math.hypot(d.x - cx, d.z - cz)
      if (dd < bd) {
        bd = dd
        groveCenter = new THREE.Vector3(d.x, 0, d.z)
      }
    }
  }
  /** the direction from (x, z) toward the nearest wall of the forest, and how far it is */
  const wallDir = (x: number, z: number) => {
    const e = 0.4
    const gx = field.sample(x + e, z) - field.sample(x - e, z)
    const gz = field.sample(x, z + e) - field.sample(x, z - e)
    const l = Math.hypot(gx, gz) || 1
    return { dir: new THREE.Vector3(-gx / l, 0, -gz / l), dist: Math.max(0.3, field.sample(x, z)) }
  }
  const stones: Circle[] = []
  const stuckArrows: LevelBuild['stuckArrows'] = []

  // ---------- forest placement (poisson-ish via jittered grid + spacing hash)
  const occupied = new Map<number, { x: number; z: number; r: number }[]>()
  const hkey = (x: number, z: number) => Math.floor(x / 3) + Math.floor(z / 3) * 1000
  const free = (x: number, z: number, r: number) => {
    const cx = Math.floor(x / 3)
    const cz = Math.floor(z / 3)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const l = occupied.get(cx + dx + (cz + dz) * 1000)
        if (!l) continue
        for (const o of l) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false
      }
    return true
  }
  const occupy = (x: number, z: number, r: number) => {
    const k = hkey(x, z)
    let l = occupied.get(k)
    if (!l) occupied.set(k, (l = []))
    l.push({ x, z, r })
  }

  const step = 1.25
  for (let z = 0; z < level.depth; z += step) {
    for (let x = 0; x < level.width; x += step) {
      const px = x + rng() * step
      const pz = z + rng() * step
      const sd = field.sample(px, pz)
      if (sd > -0.25 || sd < -7) continue
      // outside the urman only the edge of the forest the steppe begins from has trees
      if (!urman && !(bo.forestRow !== undefined && pz / CELL >= bo.forestRow)) continue
      if (!urman && gctx.deepAt(px, pz) > 0.05) continue
      const edge = sd > -2.6
      if (rng() > (edge ? 0.95 : 0.4)) continue
      const spacing = edge ? 0.8 : 1.3
      if (!free(px, pz, spacing)) continue
      occupy(px, pz, spacing)
      const inGrove = groveCenter && Math.hypot(px - groveCenter.x, pz - groveCenter.z) < 9
      const region = fbm(px * 0.06 + 3, pz * 0.06 - 2)
      const r = rng()
      const rot = rng() * Math.PI * 2
      if (inGrove) {
        batch.add('deadbirch', px, 0, pz, rot, 0.9 + rng() * 0.3, 0.8 + rng() * 0.4, 0.9 + rng() * 0.3, (rng() - 0.5) * 0.15, (rng() - 0.5) * 0.15)
      } else if (region > 0.6 && r < 0.75) {
        const s = 0.85 + rng() * 0.3
        batch.add(BIRCH[Math.floor(rng() * 2)], px, 0, pz, rot, s, s * (0.9 + rng() * 0.25), s)
      } else if (r < 0.12) {
        batch.add(DEAD[Math.floor(rng() * 2)], px, 0, pz, rot, 0.8 + rng() * 0.4)
      } else if (sd > -2.2 && r < 0.42) {
        // old pines line the path: tall readable trunks, crowns high above the cutaway
        const s = 0.85 + rng() * 0.35
        batch.add(PINES[Math.floor(rng() * 3)], px, 0, pz, rot, s, s * (0.9 + rng() * 0.2), s)
      } else {
        const s = 0.75 + rng() * 0.5
        batch.add(SPRUCE[Math.floor(rng() * 3)], px, 0, pz, rot, s, s * (0.85 + rng() * 0.35), s)
      }
    }
  }

  if (!urman) {
    placeBiomeWalls(batch, field, level, bo, gctx, rng)
    placeBiomeGround(batch, field, level, bo, gctx, waterAt, rng)
  }
  // ---------- undergrowth along the edges and scattered debris
  for (let z = 0; urman && z < level.depth; z += 0.9) {
    for (let x = 0; x < level.width; x += 0.9) {
      const px = x + rng() * 0.9
      const pz = z + rng() * 0.9
      const sd = field.sample(px, pz)
      if (sd < -3 || sd > 3.5) continue
      const r = rng()
      const rot = rng() * Math.PI * 2
      const wv = waterAt(px, pz)
      if (wv > 0.12) {
        // sedge and reeds on the banks, open water in the middle
        if (wv < 0.6 && r < 0.45) batch.add('grass', px, 0, pz, rot, 1.1 + rng() * 0.6, 1.6 + rng() * 1.4, 1.1 + rng() * 0.6)
        continue
      }
      // zone 2, «Кромка папоротников»: the ferns stand thick along the trail
      const fernEdge = pz > 104 * CELL && pz < 110 * CELL
      if (sd < (fernEdge ? 2.6 : 1.4) && r < (fernEdge ? 0.55 : 0.22)) batch.add(rng() < 0.5 ? 'fern0' : 'fern1', px, 0, pz, rot, fernEdge ? 1.1 + rng() * 0.9 : 0.8 + rng() * 0.8)
      else if (sd < 0.4 && r < 0.27) batch.add('bush', px, 0, pz, rot, 0.7 + rng() * 0.8)
      else if (sd > 0 && r < 0.3) batch.add('grass', px, 0, pz, rot, 0.7 + rng() * 0.7)
      else if (sd > 0.5 && r < 0.315) batch.add(ROCK[Math.floor(rng() * 3)], px, -0.05, pz, rot, 0.12 + rng() * 0.18)
      else if (sd < 1 && r < 0.33) batch.add('mush', px, 0, pz, rot, 0.8 + rng() * 0.6)
      else if (sd < -0.5 && r < 0.345) batch.add(ROCK[Math.floor(rng() * 3)], px, -0.2, pz, rot, 0.5 + rng() * 0.9)
      else if (sd < 0.2 && sd > -1.2 && r < 0.352) batch.add('log', px, 0, pz, rot, 0.8 + rng() * 0.4)
    }
  }

  const tamgas: LevelBuild['tamgas'] = []
  // ---------- litter, roots, branches, webs
  const triggers: LevelBuild['triggers'] = []
  const dctx = { root, batch, field, level, rng, veg: vegMat, plain: rockMat, triggers }
  if (urman) placeDetails(dctx)

  // ---------- markers
  const braziers: Brazier[] = []
  const emitters: Emitter[] = []
  const fires: LightSource[] = []
  const spawns: Marker[] = []
  let start = new THREE.Vector3(10, 0, 10)
  let spring: Spring | null = null
  const drops: Drop[] = []
  let grove: Grove | null = null
  const gateCells: number[] = []

  const ironMat = std(0x1a1715, 0.6, { metalness: 0.6 })
  const woodMat = std(0x2a1e15, 0.95, { map: barkTexture() })
  const charMat = std(0x0d0b0a, 1)
  const stoneMat = std(0x55534d, 0.95, { map: barkTexture() })
  const ornMat = std(0xffffff, 0.8, { map: ornamentTexture() })
  const boneMat = std(0xb8b0a0, 0.7)

  const coldFires: ColdFire[] = []
  const addFire = (m: Marker, lit = true) => {
    const g = new THREE.Group()
    g.position.set(m.x, 0, m.z)
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      batch.add(ROCK[i % 3], m.x + Math.cos(a) * 0.8, -0.05, m.z + Math.sin(a) * 0.8, a, 0.22, 0.25, 0.22)
    }
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6), charMat)
      log.rotation.set(Math.PI / 2 - 0.25, (i / 4) * Math.PI * 2, 0)
      log.position.y = 0.15
      log.castShadow = true
      g.add(log)
    }
    const coal = new THREE.Mesh(new THREE.CircleGeometry(0.45, 12).rotateX(-Math.PI / 2), glow(1.6, 0.35, 0.08))
    coal.position.y = 0.05
    g.add(coal)
    const fl = makeFlame(1.15)
    fl.position.y = 0.1
    g.add(fl)
    vfx.billboards.add(fl)
    root.add(g)
    const light = lights.add({ pos: new THREE.Vector3(m.x, 1.2, m.z), color: new THREE.Color(1, 0.5, 0.2), intensity: 13, distance: 15, flicker: 1, on: lit })
    halos.add(new THREE.Vector3(m.x, 1.0, m.z), new THREE.Color(1, 0.5, 0.2), 6.5, 0.5, light)
    field.addCircle({ x: m.x, z: m.z, r: 0.75, occludes: false })
    if (lit) {
      fires.push(light)
      emitters.push({ pos: new THREE.Vector3(m.x, 0.6, m.z), kind: 'embers', rate: 9, radius: 0.3, acc: 0, active: () => true })
      emitters.push({ pos: new THREE.Vector3(m.x, 1.3, m.z), kind: 'smoke', rate: 3, radius: 0.2, acc: 0, active: () => true })
      return
    }
    // cold: grey ash, a few charred sticks, waiting for a coal
    fl.visible = false
    coal.visible = false
    const cf: ColdFire = { pos: new THREE.Vector3(m.x, 0, m.z), lit: false, flame: fl, coal, light }
    coldFires.push(cf)
    emitters.push({ pos: new THREE.Vector3(m.x, 0.6, m.z), kind: 'embers', rate: 9, radius: 0.3, acc: 0, active: () => cf.lit })
    emitters.push({ pos: new THREE.Vector3(m.x, 1.3, m.z), kind: 'smoke', rate: 3, radius: 0.2, acc: 0, active: () => cf.lit })
  }

  const threads: THREE.Vector3[] = []
  const threadMat = std(0x2c5cb0, 0.7, { side: THREE.DoubleSide, emissive: 0x0c2248 })
  /** a twig out of the thicket at a boy's height, a thread of his mother's blue wool tied round it */
  const addThread = (m: Marker) => {
    const w = wallDir(m.x, m.z)
    const bx = m.x + w.dir.x * (w.dist + 0.1)
    const bz = m.z + w.dir.z * (w.dist + 0.1)
    const tip = new THREE.Vector3(m.x + w.dir.x * (w.dist - 0.7), 1.05, m.z + w.dir.z * (w.dist - 0.7))
    root.add(new THREE.Mesh(limb(new THREE.Vector3(bx, 0.95, bz), tip, 0.025, 0.008, 4), deadMat))
    const rib = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.32, 1, 3).translate(0, -0.16, 0), threadMat)
    displace(rib.geometry, 0.02, 3, m.row)
    rib.position.copy(tip).addScaledVector(w.dir, 0.12)
    rib.rotation.set(0.15, Math.atan2(w.dir.x, w.dir.z) + Math.PI / 2, 0.1)
    root.add(rib)
    halos.add(tip.clone(), new THREE.Color(0.3, 0.5, 1), 0.5, 0.06, null)
    threads.push(new THREE.Vector3(tip.x, 0, tip.z))
  }

  /** zone 8: dry thorn bushes round the old spring (they only look like the burnable ones) */
  const addThornBush = (x: number, z: number, seed: number) => {
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 16; i++) {
      const a = new THREE.Vector3((rng() - 0.5) * 1.2, -0.05, (rng() - 0.5) * 1.2)
      parts.push(limb(a, a.clone().add(new THREE.Vector3((rng() - 0.5) * 1.1, 0.5 + rng() * 0.9, (rng() - 0.5) * 1.1)), 0.035, 0.003, 3))
    }
    const geo = merge(parts)
    paint(geo, (p) => {
      const k = 0.7 + vnoise(p.x * 4 + seed, p.y * 4) * 0.5
      return [0.12 * k, 0.075 * k, 0.05 * k]
    })
    const mesh = new THREE.Mesh(geo, std(0xffffff, 0.9, { vertexColors: true }))
    mesh.position.set(x, 0, z)
    mesh.castShadow = true
    root.add(mesh)
  }

  const addBrazier = (m: Marker, lit: boolean, arena: boolean) => {
    const g = new THREE.Group()
    g.position.set(m.x, 0, m.z)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      const leg = new THREE.Mesh(limb(new THREE.Vector3(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45), new THREE.Vector3(0, 1.0, 0), 0.04, 0.03, 5), ironMat)
      leg.castShadow = true
      g.add(leg)
    }
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.22, 0.3, 12, 1, true), ironMat)
    bowl.position.y = 1.1
    bowl.castShadow = true
    const coal = new THREE.Mesh(new THREE.CircleGeometry(0.38, 12).rotateX(-Math.PI / 2), glow(1.4, 0.3, 0.06))
    coal.position.y = 1.18
    coal.visible = lit
    g.add(bowl, coal)
    const fl = makeFlame(0.75)
    fl.position.y = 1.15
    fl.visible = lit
    g.add(fl)
    vfx.billboards.add(fl)
    root.add(g)
    const light = lights.add({ pos: new THREE.Vector3(m.x, 1.9, m.z), color: new THREE.Color(1, 0.52, 0.22), intensity: 10, distance: 13, flicker: 0.8, on: lit })
    const b: Brazier = { pos: new THREE.Vector3(m.x, 0, m.z), lit, flame: fl, coal, light, arena }
    halos.add(new THREE.Vector3(m.x, 1.5, m.z), new THREE.Color(1, 0.52, 0.22), 5, 0.45, light)
    braziers.push(b)
    emitters.push({ pos: new THREE.Vector3(m.x, 1.5, m.z), kind: 'embers', rate: 5, radius: 0.2, acc: 0, active: () => b.lit })
    field.addCircle({ x: m.x, z: m.z, r: 0.45, occludes: false })
  }

  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMoon: moonLevel },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform float uMoon; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      ${GLSL_NOISE}
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float edge = pow(abs(dot(normalize(vN), V)), 3.5);
        float dust = fbm(vec2(vUv.x * 9.0, vUv.y * 5.0 - uTime * 0.06));
        float a = edge * smoothstep(1.0, 0.05, vUv.y) * smoothstep(0.0, 0.06, vUv.y) * (0.45 + 0.8 * dust);
        gl_FragColor = vec4(vec3(0.45, 0.6, 1.0) * a * 0.075 * uMoon * uMoon, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const poolMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shaftMat.uniforms.uTime, uMoon: moonLevel },
    vertexShader: springVert,
    fragmentShader: /* glsl */ `uniform float uTime; uniform float uMoon; varying vec2 vUv; ${GLSL_NOISE}
      void main(){ float d = length(vUv - 0.5) * 2.0; float n = fbm(vUv * 5.0 + uTime * 0.03);
        float a = smoothstep(1.0, 0.0, d) * (0.6 + 0.6 * n);
        gl_FragColor = vec4(vec3(0.35, 0.47, 0.8) * a * 0.12 * uMoon * uMoon, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const shaftDir = lights.moonOffset.clone().normalize()

  const addShaft = (m: Marker) => {
    const h = 18
    const cyl = new THREE.CylinderGeometry(1.7, 2.3, h, 20, 1, true)
    cyl.translate(0, h / 2, 0)
    const shaft = new THREE.Mesh(cyl, shaftMat)
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shaftDir)
    shaft.position.set(m.x, 0, m.z)
    shaft.renderOrder = 16
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 6.5).rotateX(-Math.PI / 2), poolMat)
    pool.position.set(m.x, 0.04, m.z)
    pool.renderOrder = 11
    root.add(shaft, pool)
    lights.add({ pos: new THREE.Vector3(m.x, 4, m.z), color: new THREE.Color(0.5, 0.62, 1), intensity: 6, distance: 10, flicker: 0, on: true })
    emitters.push({ pos: new THREE.Vector3(m.x, 2.5, m.z), kind: 'motes', rate: 4, radius: 1.6, acc: 0, active: () => true })
    for (let i = 0; i < 5; i++) batch.add('grass', m.x + (rng() - 0.5) * 4, 0, m.z + (rng() - 0.5) * 4, rng() * 6, 0.8 + rng() * 0.6)
  }

  const addGreatTree = (m: Marker) => {
    const g = deadTreeGeo(900 + m.row, 1.7, [0.06, 0.05, 0.045])
    const mesh = new THREE.Mesh(g, deadMat)
    mesh.position.set(m.x, 0, m.z)
    mesh.rotation.y = rng() * 6
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2
      batch.add(ROCK[i % 3], m.x + Math.cos(a) * 0.9, -0.1, m.z + Math.sin(a) * 0.9, a, 0.3, 0.3, 0.3)
    }
    field.addCircle({ x: m.x, z: m.z, r: 0.8, occludes: true })
  }

  const addBoulder = (m: Marker) => {
    const r = 1.0 + rng() * 0.35
    const x = m.x + (rng() - 0.5) * 0.5
    const z = m.z + (rng() - 0.5) * 0.5
    batch.add('boulder', x, -0.15, z, rng() * 6, r, r * 1.1, r)
    const c = { x, z, r: r * 0.92, occludes: true }
    field.addCircle(c)
    stones.push(c)
  }

  /** zone 7: a high flat-topped stone where the pack leader stands, out of the kylys's reach */
  const addLedge = (m: Marker) => {
    const r = 1.45
    batch.add('boulder', m.x, -0.1, m.z, rng() * 6, r, 1.25, r)
    batch.add('boulder', m.x + 0.9, -0.2, m.z - 0.6, rng() * 6, 0.8, 0.8, 0.8)
    // waist-high: it stops the step, not the eye (the leader on top must be seen and shot)
    const c = { x: m.x, z: m.z, r: r * 1.05, occludes: false }
    field.addCircle(c)
    stones.push(c)
  }

  const addBalbal = (m: Marker) => {
    const g = new THREE.Group()
    const stele = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.7, 0.32, 2, 4, 1), stoneMat)
    displace(stele.geometry, 0.06, 2.5, m.col)
    stele.position.y = 0.8
    stele.rotation.z = (rng() - 0.5) * 0.12
    stele.castShadow = true
    stele.receiveShadow = true
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.02), charMat)
    face.position.set(0, 1.35, 0.165)
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.02), charMat)
    eyes.position.set(0, 1.45, 0.165)
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), charMat)
    mouth.position.set(0, 1.2, 0.165)
    stele.add(face, eyes, mouth)
    face.position.sub(stele.position)
    eyes.position.sub(stele.position)
    mouth.position.sub(stele.position)
    g.add(stele)
    // a clan tamga smoulders on the stone: a sign that it can be read
    const tamga = new THREE.Group()
    const tm = glow(0.9, 0.32, 0.12)
    tamga.add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 4, 14, Math.PI * 1.3), tm))
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.01), tm)
    bar.position.y = -0.06
    tamga.add(bar)
    tamga.position.set(0, 0.85, 0.17)
    tamga.rotation.z = Math.PI * 0.85
    g.add(tamga)
    g.position.set(m.x, 0, m.z)
    g.rotation.y = rng() * Math.PI * 2
    root.add(g)
    const c = { x: m.x, z: m.z, r: 0.45, occludes: false }
    field.addCircle(c)
    stones.push(c)
    tamgas.push({ pos: new THREE.Vector3(m.x, 0, m.z), id: 0, read: false })
    halos.add(new THREE.Vector3(m.x, 0.9, m.z), new THREE.Color(0.9, 0.35, 0.15), 1.4, 0.12, null)
  }

  const ribbonMat = patchMaterial(std(0xffffff, 0.9, { vertexColors: true, side: THREE.DoubleSide }), { wind: 0.25, windStart: -10 })
  const addPole = (m: Marker) => {
    const g = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 3.6, 7), woodMat)
    pole.position.y = 1.8
    pole.castShadow = true
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.35, 8), ornMat)
    cap.position.y = 3.3
    const skull = new THREE.Mesh(displace(blob(0.17, 1), 0.06, 4, m.col), boneMat)
    skull.scale.set(0.8, 0.7, 1.6)
    skull.position.set(0, 3.65, 0.05)
    g.add(pole, cap, skull)
    const colors: RGB[] = [
      [0.55, 0.16, 0.08],
      [0.75, 0.72, 0.62],
      [0.12, 0.25, 0.4],
      [0.6, 0.42, 0.12],
    ]
    for (let i = 0; i < 5; i++) {
      const len = 0.7 + rng() * 0.6
      const rib = new THREE.PlaneGeometry(0.07, len, 1, 5).translate(0, -len / 2, 0)
      solid(rib, colors[i % 4])
      const mesh = new THREE.Mesh(rib, ribbonMat)
      mesh.position.set(Math.cos(i * 1.3) * 0.12, 3.05, Math.sin(i * 1.3) * 0.12)
      mesh.rotation.y = i * 1.3
      g.add(mesh)
    }
    g.position.set(m.x, 0, m.z)
    root.add(g)
    field.addCircle({ x: m.x, z: m.z, r: 0.25, occludes: false })
  }

  const addYurt = (m: Marker) => {
    const g = new THREE.Group()
    const parts: THREE.BufferGeometry[] = []
    const R = 2.3
    const n = 26
    for (let i = 0; i < n; i++) {
      if (rng() < 0.28) continue
      const a = (i / n) * Math.PI * 2
      const a2 = a + 0.42
      const h = 1.1 + (rng() - 0.5) * 0.4
      parts.push(limb(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R), new THREE.Vector3(Math.cos(a2) * R, h, Math.sin(a2) * R), 0.03, 0.03, 4))
      parts.push(limb(new THREE.Vector3(Math.cos(a2) * R, 0, Math.sin(a2) * R), new THREE.Vector3(Math.cos(a) * R, h, Math.sin(a) * R), 0.03, 0.03, 4))
    }
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2
      const b = new THREE.Vector3(Math.cos(a) * R, 1.1, Math.sin(a) * R)
      const e = new THREE.Vector3(Math.cos(a) * 0.4 + (rng() - 0.5) * 1.5, 0.05, Math.sin(a) * 0.4 + (rng() - 0.5) * 1.5)
      parts.push(limb(b, e, 0.035, 0.03, 4))
    }
    const frame = merge(parts)
    paint(frame, (p) => {
      const k = 0.6 + vnoise(p.x * 5, p.y * 5) * 0.6
      return [0.07 * k, 0.045 * k, 0.03 * k]
    })
    const fm = new THREE.Mesh(frame, std(0xffffff, 1, { vertexColors: true }))
    fm.castShadow = true
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 5, 14), charMat)
    wheel.rotation.set(Math.PI / 2 - 0.4, 0, 0.3)
    wheel.position.set(0.6, 0.18, -0.4)
    g.add(fm, wheel)
    for (let i = 0; i < 3; i++) {
      const felt = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9, 3, 2), std(0x2a2118, 1, { side: THREE.DoubleSide }))
      displace(felt.geometry, 0.15, 2, i + m.col)
      felt.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.4, rng() * 6, 0)
      felt.position.set((rng() - 0.5) * 3, 0.06, (rng() - 0.5) * 3)
      felt.receiveShadow = true
      g.add(felt)
    }
    for (let i = 0; i < 4; i++) {
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 5), boneMat)
      bone.rotation.set(Math.PI / 2, rng() * 6, 0)
      bone.position.set((rng() - 0.5) * 4, 0.04, (rng() - 0.5) * 4)
      g.add(bone)
    }
    g.position.set(m.x, 0, m.z)
    g.rotation.y = rng() * Math.PI * 2
    root.add(g)
    field.addCircle({ x: m.x, z: m.z, r: 2.1, occludes: false })
  }

  const clues: Partial<Record<ClueId, THREE.Vector3>> = {}
  const trackFocus = { value: new THREE.Vector4(0, 0, 0, 0) }
  /**
   * Footprints in the mud: barely there, until the heat focus [F] sweeps over them (docs/LEVELS.md, zone 2).
   * The cone test runs per fragment, so the prints light up exactly where the vessel's light falls.
   */
  const trackMaterial = (color: THREE.Color, base: number) =>
    new THREE.ShaderMaterial({
      uniforms: { uFocus: trackFocus, uColor: { value: color }, uBase: { value: base } },
      vertexShader: /* glsl */ `varying vec3 vW;
        void main(){
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `uniform vec4 uFocus; uniform vec3 uColor; uniform float uBase; varying vec3 vW;
        void main(){
          vec2 d = vW.xz - uFocus.xy;
          float dist = length(d);
          vec2 dir = vec2(sin(uFocus.z), cos(uFocus.z));
          float along = dot(d, dir) / max(dist, 0.001);
          float cone = smoothstep(0.82, 0.93, along) * smoothstep(12.5, 9.0, dist) * smoothstep(0.4, 1.2, dist) * uFocus.w;
          vec3 heat = vec3(1.5, 0.75, 0.25);
          vec3 col = mix(uColor, heat, cone * 0.7);
          gl_FragColor = vec4(col, uBase + cone * 0.8);
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  const cradleWoodPlain = std(0x6b4a2c, 0.85)
  const cradleWood = cradleWoodPlain
  const frostWood = std(0xb8a888, 0.6, { emissive: 0x0c1418 })

  /** a bishek: a rocking cradle with an embroidered blanket; `frost` — the empty one rimed with ice, a blue ribbon on its arch */
  const makeCradle = (frost = false) => {
    const cradle = new THREE.Group()
    const cradleWood = frost ? frostWood : cradleWoodPlain
    for (const side of [-1, 1]) {
      const runner = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.025, 4, 12, Math.PI * 0.55), cradleWood)
      runner.rotation.set(0, Math.PI / 2, Math.PI + Math.PI * 0.225)
      runner.position.set(side * 0.2, 0.56, 0)
      cradle.add(runner)
    }
    const box = merge([
      limb(new THREE.Vector3(-0.22, 0.12, -0.38), new THREE.Vector3(-0.22, 0.12, 0.38), 0.02, 0.02, 4),
      limb(new THREE.Vector3(0.22, 0.12, -0.38), new THREE.Vector3(0.22, 0.12, 0.38), 0.02, 0.02, 4),
      limb(new THREE.Vector3(-0.22, 0.3, -0.38), new THREE.Vector3(-0.22, 0.3, 0.38), 0.018, 0.018, 4),
      limb(new THREE.Vector3(0.22, 0.3, -0.38), new THREE.Vector3(0.22, 0.3, 0.38), 0.018, 0.018, 4),
      limb(new THREE.Vector3(-0.22, 0.12, -0.38), new THREE.Vector3(0.22, 0.12, -0.38), 0.02, 0.02, 4),
      limb(new THREE.Vector3(-0.22, 0.12, 0.38), new THREE.Vector3(0.22, 0.12, 0.38), 0.02, 0.02, 4),
      limb(new THREE.Vector3(0, 0.3, -0.38), new THREE.Vector3(0, 0.62, 0), 0.015, 0.015, 4),
      limb(new THREE.Vector3(0, 0.3, 0.38), new THREE.Vector3(0, 0.62, 0), 0.015, 0.015, 4),
    ])
    cradle.add(new THREE.Mesh(box, cradleWood))
    const blanket = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.72, 2, 3), std(0xffffff, 0.95, { map: ornamentTexture(), side: THREE.DoubleSide }))
    blanket.rotation.x = -Math.PI / 2
    blanket.position.y = 0.16
    cradle.add(blanket)
    if (frost) {
      const rib = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.32, 1, 3), std(0x2c5cb0, 0.7, { side: THREE.DoubleSide, emissive: 0x0a1a3a }))
      rib.position.set(0, 0.5, 0.02)
      cradle.add(rib)
    }
    cradle.traverse((o) => ((o as THREE.Mesh).castShadow = true))
    return cradle
  }

  let trap: LevelBuild['trap'] = null
  /** a jaw trap on a chain and stake; open() springs the jaws apart */
  const addTrap = (m: Marker) => {
    const g = new THREE.Group()
    const steel = std(0x3a3632, 0.5, { metalness: 0.7 })
    part0(new THREE.BoxGeometry(0.34, 0.02, 0.08), steel, g, 0, 0.02, 0)
    const jaws: THREE.Object3D[] = []
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group()
      pivot.position.set(0, 0.03, 0)
      const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 4, 12, Math.PI), steel)
      jaw.rotation.y = Math.PI / 2
      pivot.add(jaw)
      pivot.rotation.x = s * 0.15
      g.add(pivot)
      jaws.push(pivot)
    }
    // chain to a stake
    for (let i = 0; i < 6; i++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 3, 6), steel)
      link.position.set(0.2 + i * 0.05, 0.02, 0.02 * Math.sin(i))
      link.rotation.set(Math.PI / 2, 0, i % 2 ? Math.PI / 2 : 0)
      g.add(link)
    }
    part0(new THREE.CylinderGeometry(0.02, 0.012, 0.3, 5), cradleWood, g, 0.52, 0.12, 0)
    g.position.set(m.x, 0, m.z)
    g.rotation.y = 0.4
    root.add(g)
    // «Терновник у старого ключа»: the trap is set in a tangle of dry thorn
    for (let i = 0; i < 3; i++) {
      const a = 0.8 + i * 2.1 + rng() * 0.5
      const r = 1.6 + rng() * 0.6
      const x = m.x + Math.cos(a) * r
      const z = m.z + Math.sin(a) * r
      if (field.sample(x, z) > 0.3) addThornBush(x, z, i)
    }
    trap = {
      pos: new THREE.Vector3(m.x, 0, m.z),
      open: () => {
        jaws[0].rotation.x = -1.2
        jaws[1].rotation.x = 1.2
      },
    }
  }
  const part0 = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    parent.add(mesh)
    return mesh
  }

  let hearth: Hearth | null = null
  const startM = level.markers.find((m) => m.ch === 'P')
  /**
   * The family's yurt, not burned but swallowed by icy swamp silt and dug through by the ubyrs (docs/STORY.md, «Завязка»;
   * docs/ASSETS.md 2.1): white felt black with silt to two thirds, Aisylu's red embroidery under frost, the door torn off,
   * two burrows under the felt. Inside: the hearth flooded with black water, the overturned cauldron with the last coal,
   * the frosted cedar cradle, the kalkan and the bow on the wall lattice.
   */
  const addFloodedYurt = (m: Marker) => {
    const g = new THREE.Group()
    const R = 2.4
    const H = 1.3
    // the door looks toward the clearing where Aldar comes back from the river
    const toStart = startM ? new THREE.Vector3(startM.x - m.x, 0, startM.z - m.z).normalize() : new THREE.Vector3(0, 0, 1)
    const doorA = Math.atan2(toStart.x, toStart.z)
    const gap = 0.9
    // felt walls: silt and moss below, frosted white felt above
    const wall = new THREE.CylinderGeometry(R, R, H, 40, 6, true, doorA + gap / 2, Math.PI * 2 - gap)
    wall.translate(0, H / 2, 0)
    paint(wall, (p) => {
      const n = vnoise(p.x * 3 + 5, p.z * 3) * 0.5 + vnoise(p.y * 9, p.x * 2) * 0.3
      const silt = smoothstep(H * 0.72, H * 0.55, p.y + (n - 0.4) * 0.25)
      const moss = smoothstep(0.35, 0.0, p.y) * 0.6
      const felt: RGB = [0.5 + n * 0.08, 0.49 + n * 0.08, 0.46 + n * 0.08]
      const mud: RGB = [0.045 + moss * 0.0, 0.04 + moss * 0.03, 0.03]
      const frost = vnoise(p.x * 14, p.y * 14 + p.z * 7) > 0.72 ? 0.12 : 0
      return [lerp(felt[0], mud[0], silt) + frost, lerp(felt[1], mud[1], silt) + frost, lerp(felt[2], mud[2], silt) + frost * 1.1]
    })
    const feltMat = patchMaterial(std(0xffffff, 0.95, { vertexColors: true, side: THREE.DoubleSide }), { fade: true })
    const wm = new THREE.Mesh(wall, feltMat)
    wm.castShadow = true
    wm.receiveShadow = true
    g.add(wm)
    // Aisylu's red geometric embroidery round the top of the walls, faded under ice
    const band = new THREE.CylinderGeometry(R + 0.01, R + 0.01, 0.16, 40, 1, true, doorA + gap / 2, Math.PI * 2 - gap)
    band.translate(0, H - 0.12, 0)
    const bandMat = patchMaterial(std(0xd8a8a0, 0.9, { map: ornamentTexture(), side: THREE.DoubleSide }), { fade: true })
    g.add(new THREE.Mesh(band, bandMat))
    // the dome of felt over the roof poles
    const th = 1.0
    const rs = R / Math.sin(th)
    const dome = new THREE.SphereGeometry(rs, 32, 8, 0, Math.PI * 2, 0, th)
    dome.translate(0, H - rs * Math.cos(th), 0)
    paint(dome, (p) => {
      const n = vnoise(p.x * 2.5, p.z * 2.5)
      const k = 0.2 + n * 0.08
      const wet = vnoise(p.x * 1.3 + 9, p.z * 1.3) > 0.55 ? 0.55 : 1
      return [k * wet, k * wet * 0.98, k * wet * 0.94]
    })
    // the roof felt is matte and sodden: it must not shine under the coal's light
    const roofMat = patchMaterial(std(0xffffff, 1, { vertexColors: true, side: THREE.DoubleSide }), { fade: true })
    const roof = new THREE.Mesh(dome, roofMat)
    roof.castShadow = true
    g.add(roof)
    // the roof poles (uyk) show through the sagging felt: dark ribs from the crown wheel down to the walls
    const ribs: THREE.BufferGeometry[] = []
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2
      const pts: THREE.Vector3[] = []
      // on the dome's surface: its centre sits rs·cos(th) below the top of the walls
      const y0 = H - rs * Math.cos(th)
      for (let k = 0; k <= 6; k++) {
        const t = 0.16 + (k / 6) * (th - 0.16)
        pts.push(new THREE.Vector3(Math.sin(a) * rs * Math.sin(t), y0 + rs * Math.cos(t) + 0.015, Math.cos(a) * rs * Math.sin(t)))
      }
      ribs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.025, 4))
    }
    const ribMesh = new THREE.Mesh(merge(ribs), patchMaterial(std(0x1c140e, 1), { fade: true }))
    g.add(ribMesh)
    // dark patches where the silt soaked up into the felt
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2
      const t = 0.35 + rng() * 0.5
      const r = rs * Math.sin(t)
      const patch = new THREE.Mesh(new THREE.CircleGeometry(0.35 + rng() * 0.4, 10), patchMaterial(std(0x14110d, 1, { transparent: true, opacity: 0.55, depthWrite: false }), { fade: true }))
      patch.position.set(Math.sin(a) * r, H - rs * Math.cos(th) + rs * Math.cos(t) + 0.03, Math.cos(a) * r)
      patch.lookAt(patch.position.clone().multiplyScalar(2).setY(patch.position.y * 2 - (H - rs * Math.cos(th))))
      g.add(patch)
    }
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 5, 16), std(0x2a1d14, 0.9))
    crown.rotation.x = Math.PI / 2
    crown.position.y = H + rs * (1 - Math.cos(th)) - 0.05
    g.add(crown)
    // the door, torn off its hinges, on the ground before the threshold
    const doorMat = std(0x3a2a1c, 0.95, { map: barkTexture() })
    for (const k of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 1.2), doorMat)
      const dx = Math.sin(doorA) * (R + 0.9) + Math.cos(doorA) * k * 0.45
      const dz = Math.cos(doorA) * (R + 0.9) - Math.sin(doorA) * k * 0.45
      leaf.position.set(dx, 0.03 + (k > 0 ? 0.04 : 0), dz)
      leaf.rotation.set(0, doorA + k * 0.35, k * 0.05)
      leaf.castShadow = true
      g.add(leaf)
    }
    // two burrows of the ubyrs, clawed out of the earth under the felt
    const holeMat = std(0x020202, 1)
    const dirt = std(0xffffff, 1, { vertexColors: true })
    for (const a of [doorA + 2.1, doorA - 2.7]) {
      const hx = Math.sin(a) * (R - 0.1)
      const hz = Math.cos(a) * (R - 0.1)
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12).rotateX(-Math.PI / 2), holeMat)
      hole.position.set(hx, 0.02, hz)
      hole.scale.set(1, 1, 0.7)
      hole.rotation.y = a
      g.add(hole)
      for (let i = 0; i < 7; i++) {
        const b = a + (rng() - 0.5) * 0.8
        const r = R + 0.2 + rng() * 0.5
        const clod = new THREE.Mesh(displace(blob(0.16 + rng() * 0.12, 1), 0.05, 3, i), dirt)
        paint(clod.geometry, () => [0.05, 0.04, 0.03])
        clod.position.set(Math.sin(b) * r, 0.05, Math.cos(b) * r)
        g.add(clod)
      }
    }
    // inside, black river water over the floor
    const pool = new THREE.Mesh(new THREE.CircleGeometry(R * 0.92, 28).rotateX(-Math.PI / 2), std(0x05080a, 0.12, { metalness: 0.4 }))
    pool.position.y = 0.025
    pool.receiveShadow = true
    g.add(pool)
    // the hearth: a ring of stones, the cauldron overturned on the wet ash, the last coal glowing under its rim
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      batch.add(ROCK[i % 3], m.x + Math.cos(a) * 0.55, -0.05, m.z + Math.sin(a) * 0.55, a, 0.18, 0.2, 0.18)
    }
    const iron = std(0x1a1715, 0.6, { metalness: 0.6 })
    const cauldron = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), iron)
    cauldron.rotation.set(Math.PI - 0.5, 0, 0.2)
    cauldron.position.set(0.05, 0.2, 0.0)
    cauldron.castShadow = true
    g.add(cauldron)
    const coal = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), glow(2.6, 0.9, 0.2))
    coal.position.set(0.12, 0.05, 0.22)
    g.add(coal)
    // the cedar bishek Aldar carved for the child to come: on its side, rimed with frost, a blue ribbon on its arch
    const cradle = makeCradle(true)
    const ca = doorA + Math.PI * 0.62
    cradle.position.set(Math.sin(ca) * 1.35, 0, Math.cos(ca) * 1.35)
    cradle.rotation.set(0, ca, 1.25)
    g.add(cradle)
    // the kalkan on the wall lattice (the bow was taken by Azamat in haste)
    const gear = new THREE.Group()
    const ga = doorA + Math.PI
    gear.position.set(Math.sin(ga) * (R - 0.15), 0, Math.cos(ga) * (R - 0.15))
    gear.rotation.y = ga + Math.PI
    const shieldM = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 4, 0, Math.PI * 2, 0, 0.66), std(0x4a2e1a, 0.85))
    shieldM.rotation.x = Math.PI / 2
    shieldM.position.set(-0.35, 1.0, 0.25)
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), std(0x8a6a3a, 0.45, { metalness: 0.7 }))
    boss.rotation.x = Math.PI / 2
    boss.position.set(-0.35, 1.0, 0.36)
    // empty wooden pegs where the bow usually hangs: Azamat grabbed it when running to save their mother
    const peg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5).rotateX(Math.PI / 2), std(0x3a2414, 0.9))
    peg1.position.set(0.35, 1.05, 0.1)
    const peg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5).rotateX(Math.PI / 2), std(0x3a2414, 0.9))
    peg2.position.set(0.55, 1.05, 0.1)
    gear.add(shieldM, boss, peg1, peg2)
    gear.traverse((o) => (o.castShadow = true))
    g.add(gear)
    // the catch, dropped on its willow stick at the threshold
    const fishMat = std(0x4c5556, 0.7, { metalness: 0.1 })
    const catchG = new THREE.Group()
    catchG.add(new THREE.Mesh(limb(new THREE.Vector3(-0.5, 0.03, 0), new THREE.Vector3(0.6, 0.06, 0.1), 0.012, 0.01, 4), cradleWood))
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(displace(blob(0.1, 1), 0.01, 4, 20 + i), fishMat)
      f.scale.set(2.6, 0.45, 0.9)
      f.position.set(-0.25 + i * 0.3, 0.05, 0.08 + (rng() - 0.5) * 0.1)
      catchG.add(f)
    }
    catchG.position.set(Math.sin(doorA + 0.5) * (R + 1.6), 0, Math.cos(doorA + 0.5) * (R + 1.6))
    catchG.rotation.y = doorA + 1.2
    g.add(catchG)
    // rusty fur on the threshold: some small beast threw itself at the dead here
    const furMat = std(0x8a3f18, 1)
    const door = new THREE.Vector3(m.x + Math.sin(doorA) * (R + 0.35), 0, m.z + Math.cos(doorA) * (R + 0.35))
    for (let i = 0; i < 5; i++) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.12, 4), furMat)
      tuft.position.set(door.x - m.x + (rng() - 0.5) * 0.3, 0.03, door.z - m.z + (rng() - 0.5) * 0.3)
      tuft.rotation.set(Math.PI / 2 - 0.2, rng() * 6, 0)
      g.add(tuft)
    }
    g.position.set(m.x, 0, m.z)
    root.add(g)
    // the walls block everywhere but the doorway
    for (let a = doorA + gap / 2 + 0.12; a < doorA + Math.PI * 2 - gap / 2 - 0.05; a += 0.3) field.addCircle({ x: m.x + Math.sin(a) * R, z: m.z + Math.cos(a) * R, r: 0.32, occludes: false })
    field.addCircle({ x: m.x + 0.05, z: m.z, r: 0.42, occludes: false })
    const light = lights.add({ pos: new THREE.Vector3(m.x + 0.12, 0.35, m.z + 0.22), color: new THREE.Color(1, 0.42, 0.12), intensity: 1.4, distance: 3.2, flicker: 0.7, on: true })
    halos.add(new THREE.Vector3(m.x + 0.12, 0.15, m.z + 0.22), new THREE.Color(1, 0.4, 0.12), 0.7, 0.18, light)
    emitters.push({ pos: new THREE.Vector3(m.x, 0.4, m.z), kind: 'motes', rate: 1.5, radius: 2, acc: 0, active: () => true })
    hearth = { pos: new THREE.Vector3(m.x, 0, m.z), door, coal, gear, light }
    clues.fur = door.clone()
    clues.cradle = new THREE.Vector3(m.x + cradle.position.x, 0, m.z + cradle.position.z)
    clues.prints = door.clone().addScaledVector(toStart, -0.2).add(new THREE.Vector3(Math.cos(doorA) * 1.6, 0, -Math.sin(doorA) * 1.6))
  }

  /**
   * Three trails in the mud from the yurt into the forest (docs/STORY.md, «Завязка»): Aisylu's ichigi, the long bare feet
   * of the albasty beside them, and Azamat's hurried boots on top. They follow the shortest walkable path north and show
   * only in the heat focus: they guide the player instead of a map.
   */
  const addTracks = (from: Marker, to: Marker) => {
    const { cols, rows, walk } = level
    const idx = (c: number, r: number) => r * cols + c
    const prev = new Int32Array(cols * rows).fill(-1)
    const start = idx(from.col, from.row)
    const goal = idx(to.col, to.row)
    const q = [start]
    prev[start] = start
    // BFS that prefers cells away from walls, so the trail runs down the middle of the path
    const open = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && walk[idx(c, r)] === 1
    while (q.length) {
      const cur = q.shift()!
      if (cur === goal) break
      const c = cur % cols
      const r = (cur / cols) | 0
      for (const [dc, dr] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const nc = c + dc
        const nr = r + dr
        if (!open(nc, nr) || prev[idx(nc, nr)] !== -1) continue
        prev[idx(nc, nr)] = cur
        q.push(idx(nc, nr))
      }
    }
    if (prev[goal] === -1) return
    let pts: THREE.Vector2[] = []
    for (let cur = goal; ; cur = prev[cur]) {
      pts.push(new THREE.Vector2(((cur % cols) + 0.5) * CELL, (((cur / cols) | 0) + 0.5) * CELL))
      if (cur === start) break
    }
    pts.reverse()
    // pull the trail toward the centre of the corridor, then smooth it
    pts = pts.map((p) => {
      let sx = 0
      let sz = 0
      let k = 0
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const c = Math.floor(p.x / CELL) + dx
          const r = Math.floor(p.y / CELL) + dz
          if (open(c, r)) {
            sx += (c + 0.5) * CELL
            sz += (r + 0.5) * CELL
            k++
          }
        }
      return new THREE.Vector2(sx / k, sz / k)
    })
    for (let it = 0; it < 3; it++) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : p.clone().add(pts[i - 1]).add(pts[i + 1]).multiplyScalar(1 / 3)))
    const lens = [0]
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]))
    const total = lens[lens.length - 1]
    const at = (d: number) => {
      let i = 1
      while (i < lens.length - 1 && lens[i] < d) i++
      const t = (d - lens[i - 1]) / Math.max(1e-4, lens[i] - lens[i - 1])
      const p = pts[i - 1].clone().lerp(pts[i], THREE.MathUtils.clamp(t, 0, 1))
      const dir = pts[i].clone().sub(pts[i - 1]).normalize()
      return { p, dir }
    }
    const foot = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2)
    const ichigi = trackMaterial(new THREE.Color(0.16, 0.12, 0.09), 0.1)
    const bare = trackMaterial(new THREE.Color(0.22, 0.24, 0.26), 0.08)
    const boots = trackMaterial(new THREE.Color(0.13, 0.1, 0.08), 0.12)
    const walkers = [
      { mat: ichigi, stride: 0.62, len: 0.12, wid: 0.042, lat: -0.3, jit: 0.04 }, // Aisylu, led, not dragged
      { mat: bare, stride: 0.95, len: 0.2, wid: 0.05, lat: 0.32, jit: 0.06 }, // the albasty: long, bare, even
      { mat: boots, stride: 0.38, len: 0.085, wid: 0.035, lat: -0.15, jit: 0.14 }, // Azamat, running, over his mother's
    ]
    const m4 = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    for (const wk of walkers) {
      const mats: THREE.Matrix4[] = []
      let side = 1
      for (let d = 2.5 + rng() * 0.5; d < total - 1; d += wk.stride * (0.9 + rng() * 0.2)) {
        const { p, dir } = at(d)
        const nx = -dir.y
        const nz = dir.x
        const off = wk.lat + side * 0.1 + (rng() - 0.5) * wk.jit
        const x = p.x + nx * off
        const z = p.y + nz * off
        side = -side
        if (waterCell(Math.floor(x / CELL), Math.floor(z / CELL))) continue
        quat.setFromAxisAngle(up, Math.atan2(dir.x, dir.y) + (rng() - 0.5) * 0.3)
        m4.compose(new THREE.Vector3(x, 0.025, z), quat, new THREE.Vector3(wk.wid, 1, wk.len))
        mats.push(m4.clone())
      }
      const im = new THREE.InstancedMesh(foot, wk.mat, mats.length)
      mats.forEach((mm, i) => im.setMatrixAt(i, mm))
      im.renderOrder = 1
      im.frustumCulled = false
      root.add(im)
    }
  }

  const addMushroomPatch = (m: Marker) => {
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2
      const d = rng() * 1.6
      batch.add('glowmush', m.x + Math.cos(a) * d, 0, m.z + Math.sin(a) * d, rng() * 6, 0.9 + rng() * 0.8)
    }
    const ml = lights.add({ pos: new THREE.Vector3(m.x, 0.6, m.z), color: new THREE.Color(0.2, 0.9, 0.8), intensity: 3.5, distance: 6, flicker: 0, on: true })
    halos.add(new THREE.Vector3(m.x, 0.4, m.z), new THREE.Color(0.2, 0.9, 0.8), 3.2, 0.1, ml)
    emitters.push({ pos: new THREE.Vector3(m.x, 0.8, m.z), kind: 'fireflies', rate: 1.2, radius: 2.5, acc: 0, active: () => true })
  }

  const addSpring = (m: Marker) => {
    const g = new THREE.Group()
    g.position.set(m.x, 0, m.z)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      batch.add(ROCK[i % 3], m.x + Math.cos(a) * 1.75, -0.1, m.z + Math.sin(a) * 1.75, a, 0.38, 0.42, 0.38)
    }
    const water = new THREE.ShaderMaterial({
      uniforms: { uTime: shaftMat.uniforms.uTime, uAlive: { value: 1 } },
      vertexShader: springVert,
      fragmentShader: /* glsl */ `uniform float uTime; uniform float uAlive; varying vec2 vUv; ${GLSL_NOISE}
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float n = fbm(vUv * 6.0 + vec2(uTime * 0.07, -uTime * 0.05));
          float rip = sin(d * 22.0 - uTime * 2.2) * 0.5 + 0.5;
          vec3 deep = vec3(0.01, 0.03, 0.035);
          vec3 live = vec3(0.08, 0.75, 0.62);
          vec3 col = mix(deep, live * (0.45 + 0.9 * n), uAlive * smoothstep(1.0, 0.1, d));
          col += vec3(0.4, 1.6, 1.4) * pow(rip, 6.0) * 0.25 * uAlive * smoothstep(1.0, 0.2, d);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 32).rotateX(-Math.PI / 2), water)
    disc.position.y = 0.06
    g.add(disc)
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.28, 2, 3, 1), stoneMat)
    displace(st.geometry, 0.05, 3, 4)
    st.position.set(0, 0.7, -2.4)
    st.castShadow = true
    const tamga = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 4, 12, Math.PI * 1.4), glow(0.3, 1.5, 1.3))
    tamga.position.set(0, 1.0, -2.25)
    tamga.rotation.z = Math.PI * 0.8
    g.add(st, tamga)
    root.add(g)
    const light = lights.add({ pos: new THREE.Vector3(m.x, 1.0, m.z), color: new THREE.Color(0.25, 1, 0.85), intensity: 10, distance: 11, flicker: 0.1, on: true })
    halos.add(new THREE.Vector3(m.x, 0.6, m.z), new THREE.Color(0.25, 1, 0.85), 6.5, 0.3, light)
    emitters.push({ pos: new THREE.Vector3(m.x, 0.5, m.z), kind: 'fireflies', rate: 2.5, radius: 3, acc: 0, active: () => true })
    field.addCircle({ x: m.x, z: m.z, r: 1.5, occludes: false })
    field.addCircle({ x: m.x, z: m.z - 2.4, r: 0.35, occludes: false })
    spring = { pos: new THREE.Vector3(m.x, 0, m.z), light, water }
  }

  /**
   * A drop of living water Yanshishma (docs/ASSETS.md 2.4): a split black boulder with an old tamga, in its cleft over dead
   * roots a big drop of liquid silver hovers and trembles. Given to the earth, young shoots and white kurai flowers come up.
   */
  const silver = glow(1.5, 2.0, 2.6)
  const addDrop = (m: Marker) => {
    const g = new THREE.Group()
    g.position.set(m.x, 0, m.z)
    const black = std(0x16171a, 0.6, { map: barkTexture() })
    for (const k of [-1, 1]) {
      const half = new THREE.Mesh(displace(blob(0.55, 2), 0.18, 2, 8 + k), black)
      half.scale.set(0.62, 0.9, 1)
      half.position.set(k * 0.38, 0.35, 0)
      half.rotation.z = -k * 0.18
      half.castShadow = true
      half.receiveShadow = true
      g.add(half)
    }
    const tm = glow(0.5, 0.75, 0.95)
    const sign = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 4, 12, Math.PI * 1.4), tm)
    sign.position.set(-0.42, 0.55, 0.42)
    sign.rotation.set(0, -0.3, Math.PI * 0.8)
    g.add(sign)
    // dead roots in the cleft
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2
      g.add(new THREE.Mesh(limb(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(Math.cos(a) * 0.5, 0.25 + rng() * 0.3, Math.sin(a) * 0.5), 0.03, 0.008, 4), std(0x2a2620, 1)))
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), silver)
    orb.position.y = 1.1
    g.add(orb)
    // given to the earth: shoots and white kurai flowers round the stone
    const sprouts = new THREE.Group()
    const green = std(0x3f6a2a, 0.8, { side: THREE.DoubleSide })
    const white = std(0xe8e6dc, 0.6, { emissive: 0x2a2a26 })
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2
      const r = 0.7 + rng() * 1.6
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const h = 0.2 + rng() * 0.45
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.04, h).translate(0, h / 2, 0), green)
      blade.position.set(x, 0, z)
      blade.rotation.y = rng() * 6
      sprouts.add(blade)
      if (i % 3 === 0) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), white)
        fl.position.set(x, h + 0.02, z)
        sprouts.add(fl)
      }
    }
    sprouts.scale.setScalar(0.001)
    sprouts.visible = false
    g.add(sprouts)
    root.add(g)
    const light = lights.add({ pos: new THREE.Vector3(m.x, 1.2, m.z), color: new THREE.Color(0.7, 0.9, 1), intensity: 8, distance: 9, flicker: 0.15, on: true })
    halos.add(new THREE.Vector3(m.x, 1.1, m.z), new THREE.Color(0.72, 0.9, 1), 3.2, 0.5, light)
    const drop: Drop = { n: 0, pos: new THREE.Vector3(m.x, 0, m.z), group: g, orb, light, sprouts, taken: false, grove: null }
    drops.push(drop)
    emitters.push({ pos: new THREE.Vector3(m.x, 1.1, m.z), kind: 'sparkle', rate: 6, radius: 0.3, acc: 0, active: () => !drop.taken })
    const c = { x: m.x, z: m.z, r: 0.85, occludes: false }
    field.addCircle(c)
    stones.push(c)
  }

  const groveFoliage: THREE.Object3D[] = []
  const goldLeaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: new THREE.Color(0.35, 0.22, 0.04), emissiveIntensity: 0.6 })
  patchMaterial(goldLeaf, { wind: 0.03, windStart: 3.5, fade: true })
  const addDeadBirch = (m: Marker) => {
    const x = m.x + (rng() - 0.5) * 1.2
    const z = m.z + (rng() - 0.5) * 1.2
    const trunk = new THREE.Mesh(birchTrunkGeo(300 + m.col * 7 + m.row, 6.5), birchBark)
    trunk.position.set(x, 0, z)
    trunk.castShadow = true
    const branches = new THREE.Mesh(deadTreeGeo(500 + m.col + m.row * 3, 0.8, [0.18, 0.17, 0.16]), deadMat)
    branches.position.set(x, 1.5, z)
    branches.castShadow = true
    const leaves = new THREE.Mesh(birchLeavesGeo(600 + m.col + m.row, 1), goldLeaf)
    leaves.position.set(x, -0.5, z)
    leaves.scale.setScalar(0.001)
    leaves.visible = false
    leaves.castShadow = true
    root.add(trunk, branches, leaves)
    groveFoliage.push(leaves)
    field.addCircle({ x, z, r: 0.25, occludes: true })
  }

  // ---------- level v2 places (docs/LEVEL.md)

  /** the barrow: a low grassy mound ringed with stones, and a stele with the fourth tamga */
  const addBarrow = (m: Marker) => {
    const earth = std(0xffffff, 1, { vertexColors: true })
    const mound = new THREE.Mesh(displace(new THREE.SphereGeometry(3.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0.25, 1.2, 31), earth)
    paint(mound.geometry, (p) => {
      const k = 0.7 + vnoise(p.x * 1.5, p.z * 1.5) * 0.5
      return [0.05 * k, 0.06 * k, 0.035 * k]
    })
    mound.scale.set(1, 0.42, 1)
    mound.position.set(m.x, -0.1, m.z)
    mound.castShadow = true
    mound.receiveShadow = true
    root.add(mound)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng() * 0.1
      batch.add(ROCK[i % 3], m.x + Math.cos(a) * 3.9, -0.08, m.z + Math.sin(a) * 3.9, a, 0.32 + rng() * 0.12, 0.38, 0.32)
    }
    for (let i = 0; i < 18; i++) {
      const a = rng() * Math.PI * 2
      const d = rng() * 3
      batch.add('grass', m.x + Math.cos(a) * d, 1.4 * (1 - (d / 3.4) ** 2) - 0.15, m.z + Math.sin(a) * d, rng() * 6, 0.8 + rng() * 0.6)
    }
    field.addCircle({ x: m.x, z: m.z, r: 3.0, occludes: false })
    // the stele stands on the south side, toward the path
    const sx = m.x
    const sz = m.z + 4.6
    const stele = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.0, 0.34, 2, 4, 1), stoneMat)
    displace(stele.geometry, 0.07, 2.5, 77)
    stele.position.set(sx, 0.95, sz)
    stele.rotation.z = 0.05
    stele.castShadow = true
    root.add(stele)
    const tm = glow(0.9, 0.32, 0.12)
    const sign = new THREE.Group()
    sign.add(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.016, 4, 16), tm))
    const drops = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.01), tm)
    drops.position.y = -0.2
    sign.add(drops)
    sign.position.set(sx, 1.25, sz + 0.18)
    root.add(sign)
    const stc = { x: sx, z: sz, r: 0.45, occludes: false }
    field.addCircle(stc)
    stones.push(stc)
    halos.add(new THREE.Vector3(sx, 1.1, sz), new THREE.Color(0.9, 0.35, 0.15), 1.6, 0.14, null)
    // explicit page: the fourth tamga tells of Ural and the rule of the water
    barrowTamga = { pos: new THREE.Vector3(sx, 0, sz), id: 3, read: false }
  }
  let barrowTamga: LevelBuild['tamgas'][number] | null = null

  /** a traveller's cold hearth: thirty winters old, the stones sunk into the moss */
  const addOldHearth = (m: Marker) => {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      batch.add(ROCK[i % 3], m.x + Math.cos(a) * 0.6, -0.12, m.z + Math.sin(a) * 0.6, a, 0.16, 0.14, 0.16)
    }
    for (let i = 0; i < 3; i++) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 5), charMat)
      stick.rotation.set(Math.PI / 2, rng() * 6, 0)
      stick.position.set(m.x + (rng() - 0.5) * 0.4, 0.03, m.z + (rng() - 0.5) * 0.4)
      root.add(stick)
    }
    triggers.push({ id: 'A', pos: new THREE.Vector3(m.x, 0, m.z), fired: false })
  }

  let hollow: THREE.Vector3 | null = null
  let oak: THREE.Vector3 | null = null
  /**
   * Zone 12: the giant hollow oak in the middle of the glade. Azamat hides in its hollow 6 m up; Shurale waits in its crown.
   */
  const addGreatOak = (m: Marker) => {
    const bark = std(0xffffff, 1, { vertexColors: true, map: barkTexture() })
    const trunkG = limb(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0.25, 6.6, 0.1), 1.15, 0.62, 12)
    displace(trunkG, 0.12, 1.6, 41)
    paint(trunkG, (p) => {
      const k = 0.7 + vnoise(p.x * 3, p.y * 2) * 0.5
      return [0.07 * k, 0.058 * k, 0.045 * k]
    })
    const trunk = new THREE.Mesh(trunkG, patchMaterial(bark, { fade: true }))
    trunk.position.set(m.x, 0, m.z)
    trunk.castShadow = true
    trunk.receiveShadow = true
    root.add(trunk)
    const crown = new THREE.Mesh(deadTreeGeo(931, 2.1, [0.06, 0.05, 0.04]), deadMat)
    crown.position.set(m.x, 3.6, m.z)
    crown.castShadow = true
    root.add(crown)
    // roots like knuckles round its foot
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rng() * 0.3
      const r0 = new THREE.Vector3(m.x + Math.cos(a) * 0.9, 0.35, m.z + Math.sin(a) * 0.9)
      const r1 = new THREE.Vector3(m.x + Math.cos(a) * (2.2 + rng()), -0.1, m.z + Math.sin(a) * (2.2 + rng()))
      const root1 = new THREE.Mesh(limb(r0, r1, 0.32, 0.08, 6), trunk.material)
      root1.castShadow = true
      root.add(root1)
    }
    // the hollow, 5.5 m up on the side facing the way in; a warm breath inside: somebody is alive there
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.36, 14), std(0x030202, 1))
    hole.scale.set(0.8, 1.35, 1)
    hole.position.set(m.x + 0.2, 5.5, m.z + 0.7)
    root.add(hole)
    const light = lights.add({ pos: new THREE.Vector3(m.x + 0.2, 5.5, m.z + 1.1), color: new THREE.Color(1, 0.6, 0.3), intensity: 1.6, distance: 4, flicker: 0.3, on: true })
    halos.add(new THREE.Vector3(m.x + 0.2, 5.5, m.z + 0.85), new THREE.Color(1, 0.6, 0.3), 0.9, 0.12, light)
    field.addCircle({ x: m.x, z: m.z, r: 1.35, occludes: true })
    hollow = new THREE.Vector3(m.x + 0.2, 5.5, m.z + 0.9)
    oak = new THREE.Vector3(m.x, 0, m.z)
  }

  let nest: Nest | null = null
  /** zone 3: a raven's nest with a charm in it, on a bough over the path; an arrow brings it down */
  const addNest = (m: Marker) => {
    const w = wallDir(m.x, m.z)
    const tx = m.x + w.dir.x * (w.dist + 0.4)
    const tz = m.z + w.dir.z * (w.dist + 0.4)
    const tree = new THREE.Mesh(deadTreeGeo(717, 1.15), deadMat)
    tree.position.set(tx, 0, tz)
    tree.castShadow = true
    root.add(tree)
    // the bough reaching out over the path
    const bough = new THREE.Mesh(limb(new THREE.Vector3(tx, 3.1, tz), new THREE.Vector3(m.x - w.dir.x * 0.6, 3.6, m.z - w.dir.z * 0.6), 0.12, 0.04, 5), deadMat)
    bough.castShadow = true
    root.add(bough)
    const g = new THREE.Group()
    const twig = std(0x2a2016, 1)
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.22 - i * 0.04, 0.05, 4, 10), twig)
      t.rotation.x = Math.PI / 2
      t.position.y = i * 0.05
      g.add(t)
    }
    const charm = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 4, 10), glow(1.6, 0.9, 0.4))
    charm.position.y = 0.16
    g.add(charm)
    g.position.set(m.x, 3.45, m.z)
    g.traverse((o) => (o.castShadow = true))
    root.add(g)
    halos.add(new THREE.Vector3(m.x, 3.6, m.z), new THREE.Color(1, 0.6, 0.25), 0.8, 0.12, null)
    nest = { pos: new THREE.Vector3(m.x, 0, m.z), mesh: g, fallen: false, t: 0 }
  }

  let droppedBow: LevelBuild['droppedBow'] = null
  /** zone 5/7: Aldar's bow and quiver lost by Azamat at the stream crossing (TRG_CH1_BOW_STREAM) */
  const addDroppedBow = (m: Marker) => {
    const g = new THREE.Group()
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.12, 7), std(0x283036, 0.9))
    stone.position.set(0, 0.04, 0)
    stone.rotation.y = 0.6
    g.add(stone)
    const bowGeo = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.52, 0.1, 0.05),
        new THREE.Vector3(-0.32, 0.04, 0.02),
        new THREE.Vector3(0, 0.03, 0),
        new THREE.Vector3(0.32, 0.04, 0.02),
        new THREE.Vector3(0.52, 0.1, 0.05),
      ]),
      16,
      0.016,
      5,
    )
    const bowMesh = new THREE.Mesh(bowGeo, std(0x2c1a0e, 0.7))
    bowMesh.position.set(0, 0.08, 0)
    const strGeo = new THREE.CylinderGeometry(0.003, 0.003, 1.02, 3).rotateZ(Math.PI / 2)
    strGeo.translate(0, 0.18, 0.05)
    const strMesh = new THREE.Mesh(strGeo, std(0xb8ad90, 0.8))
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 6).rotateZ(Math.PI / 2), std(0x735738, 0.9))
    grip.position.set(0, 0.11, 0)
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.46, 8).rotateZ(1.35), std(0x4a3220, 0.85))
    quiver.position.set(0.12, 0.1, 0.16)
    for (let i = 0; i < 3; i++) {
      const arr = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.38, 4).rotateZ(1.35), std(0x6b5236, 0.8))
      arr.position.set(-0.12 - i * 0.03, 0.1 + i * 0.012, 0.14 + (i - 1) * 0.02)
      g.add(arr)
    }
    const blueThread = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.52, 0.18, 0.05),
          new THREE.Vector3(-0.58, 0.14, 0.09),
          new THREE.Vector3(-0.64, 0.09, 0.05),
        ]),
        8,
        0.007,
        4,
      ),
      std(0x2c5cb0, 0.85, { emissive: 0x0a1a3a }),
    )
    g.add(bowMesh, strMesh, grip, quiver, blueThread)
    g.position.set(m.x, 0, m.z)
    g.rotation.y = 0.4
    g.traverse((o) => (o.castShadow = true))
    root.add(g)
    const light = lights.add({ pos: new THREE.Vector3(m.x, 0.35, m.z), color: new THREE.Color(1.1, 0.75, 0.35), intensity: 0.9, distance: 3.5, flicker: 0.4, on: true })
    const halo = halos.add(new THREE.Vector3(m.x, 0.12, m.z), new THREE.Color(1.3, 0.85, 0.3), 0.75, 0.22, light)
    droppedBow = { pos: new THREE.Vector3(m.x, 0, m.z), mesh: g, light, halo, taken: false }
  }

  /** an arrow standing in a trunk at the edge of the path */
  const addTrunkArrow = (m: Marker) => {
    const w = wallDir(m.x, m.z)
    const pos = new THREE.Vector3(m.x + w.dir.x * (w.dist - 0.15), 1.25, m.z + w.dir.z * (w.dist - 0.15))
    const pine = new THREE.Mesh(limb(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.1, 7, 0), 0.26, 0.1, 7), deadMat)
    pine.position.set(m.x + w.dir.x * (w.dist + 0.15), 0, m.z + w.dir.z * (w.dist + 0.15))
    pine.castShadow = true
    root.add(pine)
    stuckArrows.push({ pos, dir: w.dir.clone().setY(-0.15).normalize() })
  }

  /** zone 11: a hunter's blind of branches, and a target of bark on a trunk with two arrows in it */
  const addBlind = (m: Marker) => {
    const w = wallDir(m.x, m.z)
    const bx = m.x + w.dir.x * (w.dist - 0.4)
    const bz = m.z + w.dir.z * (w.dist - 0.4)
    const branch = std(0x2a1e14, 1)
    for (let i = 0; i < 9; i++) {
      const a = new THREE.Vector3(bx + (rng() - 0.5) * 1.6, 0, bz + (rng() - 0.5) * 1.6)
      const top = new THREE.Vector3(bx - w.dir.x * 0.4, 1.4, bz - w.dir.z * 0.4)
      const b = new THREE.Mesh(limb(a, top, 0.035, 0.015, 4), branch)
      b.castShadow = true
      root.add(b)
    }
    // the target: a disc of bark on a trunk across the path
    const tdir = w.dir.clone().negate()
    const tx = m.x + tdir.x * 1.2
    const tz = m.z + tdir.z * 1.2
    const trunk = new THREE.Mesh(limb(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 4, 0), 0.24, 0.14, 7), deadMat)
    trunk.position.set(tx, 0, tz)
    trunk.castShadow = true
    root.add(trunk)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 14), std(0xb8955a, 0.9))
    disc.position.set(tx - tdir.x * 0.25, 1.3, tz - tdir.z * 0.25)
    disc.lookAt(m.x, 1.3, m.z)
    root.add(disc)
    field.addCircle({ x: tx, z: tz, r: 0.3, occludes: true })
    for (const k of [-1, 1]) {
      const pos = new THREE.Vector3(tx - tdir.x * 0.3 + tdir.z * k * 0.08, 1.3 + k * 0.06, tz - tdir.z * 0.3 - tdir.x * k * 0.08)
      stuckArrows.push({ pos, dir: tdir.clone().setY(-0.05).normalize() })
    }
  }

  /** zone 11: a pine fallen across the corridor, branches broken off */
  const addFallenPine = (m: Marker) => {
    const a = rng() * Math.PI
    const len = 6 + rng() * 2
    const dx = Math.cos(a) * len * 0.5
    const dz = Math.sin(a) * len * 0.5
    const log = new THREE.Mesh(limb(new THREE.Vector3(m.x - dx, 0.25, m.z - dz), new THREE.Vector3(m.x + dx, 0.18, m.z + dz), 0.32, 0.18, 8), deadMat)
    log.castShadow = true
    log.receiveShadow = true
    root.add(log)
    for (let i = 0; i < 5; i++) {
      const t = rng()
      const base = new THREE.Vector3(m.x - dx + dx * 2 * t, 0.3, m.z - dz + dz * 2 * t)
      const tip = base.clone().add(new THREE.Vector3((rng() - 0.5) * 1.2, 0.5 + rng() * 0.8, (rng() - 0.5) * 1.2))
      root.add(new THREE.Mesh(limb(base, tip, 0.05, 0.01, 4), deadMat))
    }
  }

  const thornCells: number[] = []
  const fallCells: number[] = []
  const barriers: Barrier[] = []
  const buildBarrier = (kind: Barrier['kind'], cells: number[]) => {
    if (!cells.length) return
    const g = new THREE.Group()
    const parts: THREE.BufferGeometry[] = []
    const circles: Circle[] = []
    let cx = 0
    let cz = 0
    let c0 = 1e9
    let c1 = -1e9
    let r0 = 1e9
    let r1 = -1e9
    for (const ci of cells) {
      const r = Math.floor(ci / level.cols)
      const c = ci - r * level.cols
      c0 = Math.min(c0, c)
      c1 = Math.max(c1, c)
      r0 = Math.min(r0, r)
      r1 = Math.max(r1, r)
      const x = (c + 0.5) * CELL
      const z = (r + 0.5) * CELL
      cx += x
      cz += z
      circles.push({ x, z, r: 1.3, occludes: false })
      field.blocked[ci] = 1
    }
    cx /= cells.length
    cz /= cells.length
    const mat = std(0xffffff, 0.9, { vertexColors: true }) as THREE.MeshStandardMaterial
    if (kind === 'thorns') {
      // a black tangle of thorny stems, taller than a man
      for (const ci of cells) {
        const r = Math.floor(ci / level.cols)
        const c = ci - r * level.cols
        for (let i = 0; i < 34; i++) {
          const a = new THREE.Vector3((c + rng()) * CELL - cx, -0.1, (r + rng()) * CELL - cz)
          const b = a.clone().add(new THREE.Vector3((rng() - 0.5) * 1.8, 1.2 + rng() * 1.6, (rng() - 0.5) * 1.8))
          parts.push(limb(a, b, 0.06, 0.004, 4))
          // side thorns
          const mid = a.clone().lerp(b, 0.3 + rng() * 0.4)
          parts.push(limb(mid, mid.clone().add(new THREE.Vector3((rng() - 0.5) * 0.5, 0.15, (rng() - 0.5) * 0.5)), 0.015, 0.002, 3))
        }
      }
      const geo = merge(parts)
      // bark-brown stems going pale toward the tips, so the tangle reads against the dark forest
      paint(geo, (p) => {
        const k = 0.7 + vnoise(p.x * 4, p.y * 4) * 0.6
        const tip = Math.min(1, Math.max(0, p.y / 2.6))
        return [lerp(0.13, 0.32, tip) * k, lerp(0.075, 0.24, tip) * k, lerp(0.05, 0.18, tip) * k]
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      g.add(mesh)
      // Shurale's berries smoulder ochre-red among the thorns: a sign this is not an ordinary bush
      const berry = glow(0.9, 0.18, 0.06)
      for (const ci of cells) {
        const r = Math.floor(ci / level.cols)
        const c = ci - r * level.cols
        for (let i = 0; i < 6; i++) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), berry)
          b.position.set((c + rng()) * CELL - cx, 0.5 + rng() * 1.6, (r + rng()) * CELL - cz)
          g.add(b)
        }
      }
    } else {
      // logs heaped across the passage
      const along = c1 - c0 >= r1 - r0
      const span = (Math.max(c1 - c0, r1 - r0) + 1) * CELL + 2.4
      for (let i = 0; i < 5; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.28 + rng() * 0.08, 0.34 + rng() * 0.08, span * (0.8 + rng() * 0.25), 9), woodMat)
        log.rotation.set(0, along ? 0 : Math.PI / 2, Math.PI / 2)
        log.rotateY((rng() - 0.5) * 0.25)
        log.position.set((rng() - 0.5) * 0.6, 0.3 + (i % 3) * 0.48, (i - 2) * 0.32 + (rng() - 0.5) * 0.2)
        if (!along) log.position.set(log.position.z, log.position.y, log.position.x)
        log.castShadow = true
        g.add(log)
      }
      for (let i = 0; i < 8; i++) {
        const a = new THREE.Vector3((rng() - 0.5) * span * 0.8, 0.3 + rng() * 1.2, (rng() - 0.5) * 0.8)
        g.add(new THREE.Mesh(limb(a, a.clone().add(new THREE.Vector3((rng() - 0.5) * 1.2, 0.6 + rng() * 0.6, (rng() - 0.5) * 1.2)), 0.04, 0.01, 4), woodMat))
      }
    }
    g.position.set(cx, 0, cz)
    root.add(g)
    for (const c of circles) field.addCircle(c)
    barriers.push({ kind, cells, circles, mesh: g, mat, open: false, t: -1, center: new THREE.Vector3(cx, 0, cz) })
  }


  // the other signs, at the story places (docs/TRACKING.md)
  const mk = (ch: string) => level.markers.find((m) => m.ch === ch)
  const hunter = mk('h')
  if (hunter) {
    // a long grey strand clenched in the hunter's hand: he fought the one with grey hair to her heels
    const hairMat = std(0x8a8a86, 0.7)
    for (let i = 0; i < 4; i++) {
      const a0 = new THREE.Vector3(hunter.x + 0.5, 0.05, hunter.z + 0.3)
      const a1 = a0.clone().add(new THREE.Vector3(0.6 + i * 0.12, 0.01, -0.4 + i * 0.15))
      root.add(new THREE.Mesh(limb(a0, a1, 0.006, 0.003, 3), hairMat))
    }
    clues.hair = new THREE.Vector3(hunter.x + 0.8, 0, hunter.z + 0.2)
  }
  const birch = mk('s')
  if (birch) {
    // a fresh blue ribbon among the faded ones
    const rib = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.7, 1, 4), std(0x2c5cb0, 0.7, { side: THREE.DoubleSide, emissive: 0x0a1a3a }))
    displace(rib.geometry, 0.04, 2, 9)
    rib.position.set(birch.x + 0.28, 1.15, birch.z + 0.12)
    rib.rotation.set(0.1, 0.6, 0.12)
    root.add(rib)
    clues.ribbon = new THREE.Vector3(birch.x + 0.6, 0, birch.z + 0.6)
  }
  const camp = mk('y')
  if (camp) {
    const c = makeCradle()
    c.position.set(camp.x + 3.1, 0, camp.z + 0.4)
    c.rotation.set(0, 2.1, 0.35)
    root.add(c)
    field.addCircle({ x: camp.x + 3.1, z: camp.z + 0.4, r: 0.45, occludes: false })
    clues.camp_cradle = new THREE.Vector3(camp.x + 3.1, 0, camp.z + 0.4)
  }
  for (const m of level.markers) {
    switch (m.ch) {
      case 'P':
        start = new THREE.Vector3(m.x, 0, m.z)
        break
      case 'f':
        addFire(m)
        break
      case 'b':
        addBrazier(m, false, false)
        break
      case 'L':
        addBrazier(m, true, true)
        break
      case 'm':
        addShaft(m)
        break
      case 't':
        addGreatTree(m)
        break
      case 'r':
        addBoulder(m)
        break
      case 'k':
        addBalbal(m)
        break
      case 'p':
        addPole(m)
        break
      case 'y':
        addYurt(m)
        break
      case 'g':
        addMushroomPatch(m)
        break
      case 'S':
        addSpring(m)
        break
      case 'D':
        addDrop(m)
        break
      case 'x':
        addDeadBirch(m)
        break
      case '=':
        gateCells.push(m.row * level.cols + m.col)
        break
      case 'h':
      case 's':
      case 'H':
      case 'c':
      case 'K':
        for (const c of addStoryProp(dctx, m)) field.addCircle(c)
        break
      case 'e':
        addFloodedYurt(m)
        break
      case 'N':
        addNest(m)
        break
      case 'i':
        addTrunkArrow(m)
        break
      case 'Y':
        addDroppedBow(m)
        break
      case 'W':
        addLedge(m)
        spawns.push(m)
        break
      case 'J':
        addBlind(m)
        break
      case 'l':
        addFallenPine(m)
        break
      case 'Q':
        break
      case 'C':
        addFire(m, false)
        break
      case 'v':
        addThread(m)
        break
      case 'M':
        addTrap(m)
        break
      case 'q':
        addBarrow(m)
        break
      case 'A':
        addOldHearth(m)
        break
      case 'T':
        addGreatOak(m)
        break
      case 'Z':
        thornCells.push(m.row * level.cols + m.col)
        break
      case 'O':
        fallCells.push(m.row * level.cols + m.col)
        break
      case 'U':
      case 'u':
      case 'w':
      case 'a':
      case 'B':
        spawns.push(m)
        break
      default:
        if (/[0-9]/.test(m.ch)) triggers.push({ id: m.ch, pos: new THREE.Vector3(m.x, 0, m.z), fired: false })
    }
  }

  // chapters 2–3: their own places and things
  const veilCells: number[] = []
  const bridgeCells: number[] = []
  const extras = urman
    ? emptyExtras()
    : buildExtras({
        biome,
        root,
        batch,
        rocks: biomeKit!.rocks,
        field,
        level,
        lights,
        vfx,
        halos,
        rng,
        stones,
        stuckArrows,
        triggers,
        tamgas,
        spawns,
        emitters,
        addFire,
        veilCells,
        bridgeCells,
        groundY: (x, z) => groundAt(gctx, x, z, field.sample(x, z), bedAt(x, z)).y,
      })

  // three trails in the mud from the flooded yurt's threshold to where the wolves wait
  const trailEnd = level.markers.find((m) => m.ch === '6')
  const hh = hearth as Hearth | null
  if (hh && trailEnd) {
    const col = Math.floor(hh.door.x / CELL)
    const row = Math.floor(hh.door.z / CELL)
    addTracks({ ch: 'e', col, row, x: hh.door.x, z: hh.door.z }, trailEnd)
  }

  if (groveCenter) {
    grove = {
      center: groveCenter,
      foliage: groveFoliage,
      light: lights.add({ pos: new THREE.Vector3(groveCenter.x, 4, groveCenter.z), color: new THREE.Color(1, 0.75, 0.35), intensity: 22, distance: 16, flicker: 0, on: false }),
      revived: false,
      t: 0,
    }
    halos.add(new THREE.Vector3(groveCenter.x, 3.5, groveCenter.z), new THREE.Color(1, 0.75, 0.35), 12, 0.22, grove.light)
    const gv = grove
    emitters.push({ pos: new THREE.Vector3(groveCenter.x, 2.5, groveCenter.z), kind: 'spores', rate: 8, radius: 5, acc: 0, active: () => gv.revived })
    const gc = groveCenter
    const owner = drops.find((d) => d.pos.distanceTo(gc) < 0.5)
    if (owner) owner.grove = grove
  }
  // drops are numbered along the way, south to north
  drops.sort((a, b) => b.pos.z - a.pos.z).forEach((d, i) => (d.n = i + 1))
  // the pines at the edge of the great oak's glade, where Shurale hides in phase 2
  const oakAt = oak as THREE.Vector3 | null
  const perches = level.markers.filter((m) => m.ch === 't' && oakAt && Math.hypot(m.x - oakAt.x, m.z - oakAt.z) < 26).map((m) => new THREE.Vector3(m.x, 0, m.z))

  // ---------- arena gate (thorns rise when the boss fight starts)
  let gate: Gate | null = null
  if (gateCells.length) {
    const parts: THREE.BufferGeometry[] = []
    const circles: Circle[] = []
    let cx = 0
    let cz = 0
    for (const ci of gateCells) {
      const r = Math.floor(ci / level.cols)
      const c = ci - r * level.cols
      const x0 = c * CELL
      const z0 = r * CELL
      cx += x0 + CELL / 2
      cz += z0 + CELL / 2
      for (let i = 0; i < 26; i++) {
        const a = new THREE.Vector3(x0 + rng() * CELL, -0.2, z0 + rng() * CELL)
        const b = a.clone().add(new THREE.Vector3((rng() - 0.5) * 2.5, 1.5 + rng() * 2.2, (rng() - 0.5) * 2.5))
        parts.push(limb(a, b, 0.09, 0.005, 4))
      }
      circles.push({ x: x0 + CELL / 2, z: z0 + CELL / 2, r: 1.3, occludes: false })
    }
    const geo = merge(parts)
    // black roots in the urman, black reeds and stone teeth at the crossing, ice spikes on the summit
    solid(geo, biome === 'cave' ? [0.32, 0.38, 0.44] : biome === 'steppe' ? [0.025, 0.035, 0.04] : [0.05, 0.035, 0.03])
    const mesh = new THREE.Mesh(geo, std(0xffffff, biome === 'cave' ? 0.3 : 0.9, { vertexColors: true }))
    mesh.castShadow = true
    mesh.position.y = -4.5
    mesh.visible = false
    root.add(mesh)
    gate = { cells: gateCells, mesh, circles, closed: false, anim: 0, center: new THREE.Vector3(cx / gateCells.length, 0, cz / gateCells.length) }
  }

  buildBarrier('thorns', thornCells)
  buildBarrier('deadfall', fallCells)
  if (veilCells.length) {
    const v = veilMesh(veilCells, level, rng)
    const circles = veilCells.map((ci) => ({ x: ((ci % level.cols) + 0.5) * CELL, z: (Math.floor(ci / level.cols) + 0.5) * CELL, r: 1.3, occludes: false }))
    for (const ci of veilCells) field.blocked[ci] = 1
    for (const c of circles) field.addCircle(c)
    const center = new THREE.Vector3(circles.reduce((a, c) => a + c.x, 0) / circles.length, 0, circles.reduce((a, c) => a + c.z, 0) / circles.length)
    root.add(v.group)
    barriers.push({ kind: 'veil', cells: veilCells, circles, mesh: v.group, mat: v.mat, open: false, t: -1, center })
    emitters.push({ pos: center.clone().setY(1), kind: 'spirit', rate: 10, radius: (veilCells.length * CELL) / 2, acc: 0, active: () => !barriers.find((b) => b.kind === 'veil')!.open })
  }
  if (bridgeCells.length) {
    const b = bridgeMesh(bridgeCells, level)
    const circles = bridgeCells.map((ci) => ({ x: ((ci % level.cols) + 0.5) * CELL, z: (Math.floor(ci / level.cols) + 0.5) * CELL, r: 1.3, occludes: false, low: true }))
    for (const ci of bridgeCells) field.blocked[ci] = 1
    for (const c of circles) field.addCircle(c)
    const center = new THREE.Vector3(circles.reduce((a, c) => a + c.x, 0) / circles.length, 0, circles.reduce((a, c) => a + c.z, 0) / circles.length)
    root.add(b.group)
    barriers.push({ kind: 'bridge', cells: bridgeCells, circles, mesh: b.group, mat: std(0x3a2a1c, 0.95), open: false, t: -1, center })
  }

  // the duel turns round the great oak
  const lit = level.markers.filter((m) => m.ch === 'L')
  const arenaCenter = extras.arena
    ? extras.arena.clone()
    : oakAt
    ? oakAt.clone()
    : lit.length
      ? new THREE.Vector3(lit.reduce((s, m) => s + m.x, 0) / lit.length, 0, lit.reduce((s, m) => s + m.z, 0) / lit.length)
      : start.clone()

  const instancedMeshes = batch.build(root)
  shaftTime = shaftMat.uniforms.uTime

  // lore order follows the path: the stone nearest the start tells the oldest story
  tamgas.sort((a, b) => b.pos.z - a.pos.z).forEach((t, i) => (t.id = (opts.loreBase ?? 0) + i))
  const bt = barrowTamga as LevelBuild['tamgas'][number] | null
  if (bt) {
    bt.id = tamgas.length
    tamgas.push(bt)
  }
  return { root, start, braziers, spring, drops, gate, emitters, triggers, spawns, arenaCenter, fires, instancedMeshes, halos, tamgas, clues, trackFocus, trap, barriers, hollow, oak, perches, hearth, nest, droppedBow, stuckArrows, stones, coldFires, threads, waterSpots, stream, biome, lake, extras }
}

export let shaftTime: { value: number } = { value: 0 }
/** 0..1 how much moonlight gets through the drifting clouds (drives shafts and pools). */
export const moonLevel = { value: 1 }

/** Ambient particle emitters near the player. */
export function updateEmitters(emitters: Emitter[], vfx: VFX, focus: THREE.Vector3, dt: number) {
  for (const e of emitters) {
    if (e.pos.distanceToSquared(focus) > 30 * 30 || !e.active()) continue
    e.acc += e.rate * dt
    while (e.acc >= 1) {
      e.acc -= 1
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * e.radius
      const x = e.pos.x + Math.cos(a) * r
      const z = e.pos.z + Math.sin(a) * r
      switch (e.kind) {
        case 'embers':
          vfx.add.spawn({ x, y: e.pos.y, z, vx: (Math.random() - 0.5) * 0.6, vy: 1.2 + Math.random() * 1.8, vz: (Math.random() - 0.5) * 0.6, r: 2.4, g: 0.9, b: 0.25, size: 0.05 + Math.random() * 0.05, life: 1 + Math.random() * 1.4, drag: 0.5, gravity: -0.3 })
          break
        case 'smoke':
          vfx.soft.spawn({ x, y: e.pos.y, z, vx: 0.2 + Math.random() * 0.2, vy: 0.7 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.3, r: 0.07, g: 0.065, b: 0.06, a: 0.35, size: 0.6, life: 3.5, drag: 0.3, grow: 3 })
          break
        case 'motes':
          vfx.add.spawn({ x, y: e.pos.y + (Math.random() - 0.5) * 3, z, vx: (Math.random() - 0.5) * 0.1, vy: -0.05 - Math.random() * 0.1, vz: (Math.random() - 0.5) * 0.1, r: 0.5, g: 0.65, b: 1.0, a: 0.6, size: 0.04, life: 4, drag: 0.1 })
          break
        case 'fireflies':
          vfx.add.spawn({ x, y: e.pos.y + Math.random() * 1.5, z, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.5, r: 0.6, g: 2.2, b: 1.6, a: 1, size: 0.06, life: 2.5 + Math.random() * 2, drag: 0.2 })
          break
        case 'sparkle':
          vfx.add.spawn({ x, y: e.pos.y, z, vx: (Math.random() - 0.5) * 0.4, vy: 0.3 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.4, r: 0.6, g: 2.4, b: 2.1, size: 0.05, life: 1.2, drag: 0.6 })
          break
        case 'spores':
          vfx.add.spawn({ x, y: 0.5 + Math.random() * 5, z, vx: (Math.random() - 0.5) * 0.3, vy: 0.15, vz: (Math.random() - 0.5) * 0.3, r: 2.0, g: 1.4, b: 0.4, size: 0.06, life: 4, drag: 0.2 })
          break
        case 'spirit':
          // the turquoise of the ancestors (docs/LEVELS.md, chapter 2): slow motes rising out of the veil
          vfx.add.spawn({ x, y: 0.2 + Math.random() * 2.4, z, vx: (Math.random() - 0.5) * 0.2, vy: 0.2 + Math.random() * 0.35, vz: (Math.random() - 0.5) * 0.2, r: 0.3, g: 1.9, b: 1.8, a: 0.9, size: 0.05 + Math.random() * 0.04, life: 2.5, drag: 0.4 })
          break
        case 'snow':
          vfx.soft.spawn({ x, y: 6 + Math.random() * 3, z, vx: 0.6 + Math.random() * 0.4, vy: -0.9 - Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.3, r: 0.75, g: 0.8, b: 0.9, a: 0.8, size: 0.06, life: 9, drag: 0.1 })
          break
      }
    }
  }
}
