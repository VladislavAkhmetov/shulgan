import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Batcher, blob, displace, ensureUv, limb, merge, paint, prep, solid, type RGB } from './geo'
import { Halos, PINES, addStoryProp, placeDetails, registerDressing } from './dressing'
import { CELL, type LevelData, type Marker } from './map'
import type { ClueId } from '../clues'
import type { Circle, Field } from './field'
import { fbm, lerp, mulberry32, smoothstep, vnoise, GLSL_NOISE } from '../util'
import { barkTexture, birchTexture, glow, groundTexture, needleTexture, ornamentTexture, patchMaterial, std } from '../render/materials'
import type { Lighting, LightSource } from '../render/lights'
import { makeFlame, type VFX } from '../render/vfx'
import { buildStream, type Stream } from './water'


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

export interface Drop {
  pos: THREE.Vector3
  group: THREE.Group
  orb: THREE.Mesh
  light: LightSource
  taken: boolean
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

/** Thorns that burn, or a deadfall that can be pushed from one side (docs/LEVEL.md). */
export interface Barrier {
  kind: 'thorns' | 'deadfall'
  cells: number[]
  circles: Circle[]
  mesh: THREE.Group
  mat: THREE.MeshStandardMaterial
  open: boolean
  /** opening animation 0..1, -1 = idle */
  t: number
  center: THREE.Vector3
}

export type EmitterKind = 'embers' | 'smoke' | 'motes' | 'fireflies' | 'sparkle' | 'spores'

export interface Emitter {
  pos: THREE.Vector3
  kind: EmitterKind
  rate: number
  radius: number
  acc: number
  active: () => boolean
}

export interface LevelBuild {
  root: THREE.Group
  start: THREE.Vector3
  braziers: Brazier[]
  spring: Spring | null
  drop: Drop | null
  grove: Grove | null
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
  /** where each sign of the abductors lies (docs/TRACKING.md) */
  clues: Partial<Record<ClueId, THREE.Vector3>>
  /** footprint materials: the tracker's sense makes them glow */
  trackMats: THREE.MeshStandardMaterial[]
  /** the hunter's trap that holds the marten */
  trap: { pos: THREE.Vector3; open: () => void } | null
  barriers: Barrier[]
  /** the hollow tree where Azamat cries (a sound landmark) */
  hollow: THREE.Vector3 | null
  /** centres of shallow-water cells (babble near the banks) */
  waterSpots: THREE.Vector3[]
  /** the mountain stream surface (docs/ART.md, "Вода"); the game feeds it the moon and the waders */
  stream: Stream | null
}

const springVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

export function buildLevel(scene: THREE.Scene, level: LevelData, field: Field, lights: Lighting, vfx: VFX): LevelBuild {
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
  const halos = new Halos(root)

  const markersOf = (ch: string) => level.markers.filter((m) => m.ch === ch)
  const dropMarker = markersOf('D')[0]
  const groveCenter = dropMarker ? new THREE.Vector3(dropMarker.x, 0, dropMarker.z) : null

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

  // ---------- undergrowth along the edges and scattered debris
  for (let z = 0; z < level.depth; z += 0.9) {
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
      if (sd < 1.4 && r < 0.22) batch.add(rng() < 0.5 ? 'fern0' : 'fern1', px, 0, pz, rot, 0.8 + rng() * 0.8)
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
  placeDetails(dctx)

  // ---------- markers
  const braziers: Brazier[] = []
  const emitters: Emitter[] = []
  const fires: LightSource[] = []
  const spawns: Marker[] = []
  let start = new THREE.Vector3(10, 0, 10)
  let spring: Spring | null = null
  let drop: Drop | null = null
  let grove: Grove | null = null
  const gateCells: number[] = []

  const ironMat = std(0x1a1715, 0.6, { metalness: 0.6 })
  const woodMat = std(0x2a1e15, 0.95, { map: barkTexture() })
  const charMat = std(0x0d0b0a, 1)
  const stoneMat = std(0x55534d, 0.95, { map: barkTexture() })
  const ornMat = std(0xffffff, 0.8, { map: ornamentTexture() })
  const boneMat = std(0xb8b0a0, 0.7)

  const addFire = (m: Marker) => {
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
    const light = lights.add({ pos: new THREE.Vector3(m.x, 1.2, m.z), color: new THREE.Color(1, 0.5, 0.2), intensity: 13, distance: 15, flicker: 1, on: true })
    fires.push(light)
    halos.add(new THREE.Vector3(m.x, 1.0, m.z), new THREE.Color(1, 0.5, 0.2), 6.5, 0.5, light)
    emitters.push({ pos: new THREE.Vector3(m.x, 0.6, m.z), kind: 'embers', rate: 9, radius: 0.3, acc: 0, active: () => true })
    emitters.push({ pos: new THREE.Vector3(m.x, 1.3, m.z), kind: 'smoke', rate: 3, radius: 0.2, acc: 0, active: () => true })
    field.addCircle({ x: m.x, z: m.z, r: 0.75, occludes: false })
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
    field.addCircle({ x, z, r: r * 0.92, occludes: true })
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
    field.addCircle({ x: m.x, z: m.z, r: 0.45, occludes: false })
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
  const trackMats: THREE.MeshStandardMaterial[] = []
  const cradleWood = std(0x6b4a2c, 0.85)

  /** a bishek: a rocking cradle with an embroidered blanket */
  const makeCradle = () => {
    const cradle = new THREE.Group()
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

  /** The family's yurt, burned: the place the game begins (docs/STORY.md, chapter 1). */
  const addFamilyYurt = (m: Marker) => {
    const g = new THREE.Group()
    const parts: THREE.BufferGeometry[] = []
    const R = 2.4
    const n = 30
    // the kerege lattice, burned down to stumps on one side
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const burnt = Math.sin(a * 1.3 + 0.7) > 0.1
      if (burnt && rng() < 0.55) continue
      const a2 = a + 0.4
      const h = burnt ? 0.25 + rng() * 0.35 : 1.15 + (rng() - 0.5) * 0.2
      parts.push(limb(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R), new THREE.Vector3(Math.cos(a2) * R, h, Math.sin(a2) * R), 0.03, 0.025, 4))
      parts.push(limb(new THREE.Vector3(Math.cos(a2) * R, 0, Math.sin(a2) * R), new THREE.Vector3(Math.cos(a) * R, h, Math.sin(a) * R), 0.03, 0.025, 4))
    }
    // roof poles fallen inward
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2
      const b = new THREE.Vector3(Math.cos(a) * R, 0.2 + rng() * 0.9, Math.sin(a) * R)
      const e = new THREE.Vector3(Math.cos(a) * 0.3 + (rng() - 0.5) * 1.2, 0.04, Math.sin(a) * 0.3 + (rng() - 0.5) * 1.2)
      parts.push(limb(b, e, 0.04, 0.025, 4))
    }
    // the door frame still stands
    parts.push(limb(new THREE.Vector3(-0.45, 0, R), new THREE.Vector3(-0.45, 1.5, R), 0.05, 0.05, 4))
    parts.push(limb(new THREE.Vector3(0.45, 0, R), new THREE.Vector3(0.45, 1.5, R), 0.05, 0.05, 4))
    parts.push(limb(new THREE.Vector3(-0.5, 1.5, R), new THREE.Vector3(0.5, 1.5, R), 0.05, 0.05, 4))
    const frame = merge(parts)
    paint(frame, (p) => {
      const k = 0.5 + vnoise(p.x * 6, p.y * 6) * 0.5
      const ember = p.y < 0.35 && vnoise(p.x * 3 + 7, p.z * 3) > 0.62 ? 1 : 0
      return [0.05 * k + ember * 0.22, 0.035 * k + ember * 0.05, 0.025 * k]
    })
    const fm = new THREE.Mesh(frame, std(0xffffff, 1, { vertexColors: true }))
    fm.castShadow = true
    g.add(fm)
    // the crown wheel (shanyrak) fell into the ashes
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 5, 16), charMat)
    wheel.rotation.set(Math.PI / 2 - 0.25, 0, 0.2)
    wheel.position.set(-0.3, 0.12, 0.2)
    g.add(wheel)
    // ash bed and smouldering spots
    const ash = new THREE.Mesh(new THREE.CircleGeometry(R * 0.95, 24).rotateX(-Math.PI / 2), std(0x2a2724, 1))
    ash.position.y = 0.015
    ash.receiveShadow = true
    g.add(ash)
    // a scatter of small embers, dim, breathing in the ash
    const emberMat = glow(0.7, 0.16, 0.03)
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2
      const r = Math.sqrt(rng()) * R * 0.85
      const coal = new THREE.Mesh(new THREE.CircleGeometry(0.025 + rng() * 0.05, 5).rotateX(-Math.PI / 2), emberMat)
      coal.position.set(Math.cos(a) * r, 0.025, Math.sin(a) * r)
      g.add(coal)
    }
    // Aisylu's embroidered felt, scorched
    const orn = std(0x8a7a66, 0.95, { map: ornamentTexture(), side: THREE.DoubleSide })
    for (let i = 0; i < 4; i++) {
      const felt = new THREE.Mesh(new THREE.PlaneGeometry(1.0 + rng() * 0.6, 0.7 + rng() * 0.4, 3, 2), i < 2 ? orn : std(0x221a14, 1, { side: THREE.DoubleSide }))
      displace(felt.geometry, 0.12, 2, i + 11)
      felt.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.5, rng() * 6, 0)
      const a = rng() * Math.PI * 2
      felt.position.set(Math.cos(a) * (R + 0.3 + rng() * 0.8), 0.05, Math.sin(a) * (R + 0.3 + rng() * 0.8))
      felt.receiveShadow = true
      g.add(felt)
    }
    // the cradle (bishek) Timer carved for the child to come — untouched by the fire
    const cradle = makeCradle()
    cradle.position.set(R + 1.1, 0, 0.6)
    cradle.rotation.y = 0.5
    g.add(cradle)
    // the catch, dropped on its willow stick
    const fishMat = std(0x4c5556, 0.7, { metalness: 0.1 })
    const stick = new THREE.Mesh(limb(new THREE.Vector3(-0.5, 0.03, 0), new THREE.Vector3(0.6, 0.06, 0.1), 0.012, 0.01, 4), cradleWood)
    const catchG = new THREE.Group()
    catchG.add(stick)
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(displace(blob(0.1, 1), 0.01, 4, 20 + i), fishMat)
      f.scale.set(2.6, 0.45, 0.9)
      f.position.set(-0.25 + i * 0.3, 0.05, 0.08 + (rng() - 0.5) * 0.1)
      f.rotation.y = (rng() - 0.5) * 0.6
      catchG.add(f)
    }
    catchG.position.set(R + 0.4, 0, R + 0.6)
    catchG.rotation.y = 2.2
    g.add(catchG)

    g.position.set(m.x, 0, m.z)
    g.rotation.y = 0.9
    root.add(g)
    const smoke = new THREE.Vector3(0.3, 0, -0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.9)
    emitters.push({ pos: new THREE.Vector3(m.x + smoke.x, 0.4, m.z + smoke.z), kind: 'smoke', rate: 2.5, radius: 1.2, acc: 0, active: () => true })
    emitters.push({ pos: new THREE.Vector3(m.x, 0.15, m.z), kind: 'embers', rate: 4, radius: 1.6, acc: 0, active: () => true })
    halos.add(new THREE.Vector3(m.x, 0.3, m.z), new THREE.Color(1, 0.35, 0.12), 3.2, 0.22, null)
    field.addCircle({ x: m.x, z: m.z, r: 2.2, occludes: false })
    const cr = new THREE.Vector3(R + 1.1, 0, 0.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.9)
    field.addCircle({ x: m.x + cr.x, z: m.z + cr.z, r: 0.45, occludes: false })
    clues.cradle = new THREE.Vector3(m.x + cr.x, 0, m.z + cr.z)
    clues.prints = new THREE.Vector3(m.x, 0, m.z - 3.2)
  }

  /**
   * Ash footprints from the burned yurt into the forest: Aisylu's, the boy's, and the long bare feet of the dead.
   * They follow the shortest walkable path north and guide the player instead of a map.
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
    const ashMat = std(0x7a736a, 1, { transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    const deadMat = std(0x0f0c0a, 1, { transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    ashMat.userData.base = 0.6
    deadMat.userData.base = 0.75
    trackMats.push(ashMat, deadMat)
    const CLOTH_AT = 10
    const BREAK_AT = Math.min(24, total - 4)
    const walkers = [
      { mat: ashMat, stride: 0.62, len: 0.12, wid: 0.045, lat: -0.35, jit: 0.04 }, // Aisylu
      { mat: ashMat, stride: 0.42, len: 0.085, wid: 0.035, lat: 0.32, jit: 0.1, until: BREAK_AT }, // Azamat, stumbling, until he breaks free
      { mat: deadMat, stride: 0.85, len: 0.17, wid: 0.055, lat: -0.85, jit: 0.12 }, // the dead
      { mat: deadMat, stride: 0.8, len: 0.17, wid: 0.055, lat: 0.85, jit: 0.12 },
    ]
    const m4 = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    {
      // a scrap of Aisylu's dress caught on a dry branch by the trail
      const { p, dir } = at(CLOTH_AT)
      const n = new THREE.Vector2(-dir.y, dir.x)
      const sp = p.clone().add(n.multiplyScalar(-0.9))
      const branch = new THREE.Mesh(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.25, 0.75, 0.1), 0.025, 0.01, 4), std(0x2a1d14, 1))
      branch.position.set(sp.x, 0, sp.y)
      root.add(branch)
      const scrap = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.24, 2, 2), std(0x7d8fb8, 0.9, { map: ornamentTexture(), side: THREE.DoubleSide }))
      displace(scrap.geometry, 0.03, 3, 5)
      scrap.position.set(sp.x + 0.2, 0.58, sp.y + 0.08)
      scrap.rotation.set(0.2, Math.atan2(dir.x, dir.y), 0.3)
      root.add(scrap)
      clues.cloth = new THREE.Vector3(sp.x, 0, sp.y)
    }
    for (const wk of walkers) {
      const mats: THREE.Matrix4[] = []
      let side = 1
      const end = 'until' in wk ? (wk.until as number) : total - 1
      for (let d = 3 + rng() * 0.5; d < end; d += wk.stride * (0.9 + rng() * 0.2)) {
        // the trail thins out as the ash wears off their feet
        if (d > 22 && rng() < (d - 22) / (total - 22) * 0.75) continue
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
      if ('until' in wk) {
        // the boy breaks away: small running prints leave the trail into the thicket
        const { p, dir } = at(BREAK_AT)
        const n = new THREE.Vector2(-dir.y, dir.x)
        const probe = (k: number) => open(Math.floor((p.x + n.x * k * 3) / CELL), Math.floor((p.y + n.y * k * 3) / CELL))
        const sgn = probe(1) || !probe(-1) ? 1 : -1
        const away = n.clone().multiplyScalar(sgn).add(dir.clone().multiplyScalar(0.5)).normalize()
        let side2 = 1
        for (let k = 0; k < 9; k++) {
          const q2 = p.clone().add(away.clone().multiplyScalar(0.4 + k * 0.5))
          const qx = q2.x - away.y * side2 * 0.08
          const qz = q2.y + away.x * side2 * 0.08
          side2 = -side2
          quat.setFromAxisAngle(up, Math.atan2(away.x, away.y) + (rng() - 0.5) * 0.4)
          m4.compose(new THREE.Vector3(qx, 0.025, qz), quat, new THREE.Vector3(wk.wid, 1, wk.len * 0.9))
          mats.push(m4.clone())
        }
        // his kurai whistle, dropped where he tore free
        const wp = p.clone().add(away.clone().multiplyScalar(0.3))
        const kurai = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.32, 6), std(0xc9b48a, 0.7))
        kurai.rotation.set(Math.PI / 2, 0, Math.atan2(away.x, away.y) + 0.8)
        kurai.position.set(wp.x, 0.03, wp.y)
        kurai.castShadow = true
        root.add(kurai)
        clues.whistle = new THREE.Vector3(wp.x, 0, wp.y)
      }
      const im = new THREE.InstancedMesh(foot, wk.mat, mats.length)
      mats.forEach((mm, i) => im.setMatrixAt(i, mm))
      im.receiveShadow = true
      im.renderOrder = 1
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

  const addDrop = (m: Marker) => {
    const g = new THREE.Group()
    g.position.set(m.x, 0, m.z)
    const altar = new THREE.Mesh(displace(blob(0.6, 2), 0.25, 2, 8), stoneMat)
    altar.scale.set(1, 0.7, 1)
    altar.position.y = 0.25
    altar.castShadow = true
    altar.receiveShadow = true
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), glow(0.6, 2.6, 2.2))
    orb.scale.set(1, 1.35, 1)
    orb.position.y = 1.35
    g.add(altar, orb)
    root.add(g)
    const light = lights.add({ pos: new THREE.Vector3(m.x, 1.4, m.z), color: new THREE.Color(0.3, 1, 0.9), intensity: 8, distance: 9, flicker: 0.15, on: true })
    halos.add(new THREE.Vector3(m.x, 1.35, m.z), new THREE.Color(0.3, 1, 0.9), 3.4, 0.55, light)
    drop = { pos: new THREE.Vector3(m.x, 0, m.z), group: g, orb, light, taken: false }
    emitters.push({ pos: new THREE.Vector3(m.x, 1.35, m.z), kind: 'sparkle', rate: 6, radius: 0.3, acc: 0, active: () => !!drop && !drop.taken })
    field.addCircle({ x: m.x, z: m.z, r: 0.6, occludes: false })
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
    field.addCircle({ x: sx, z: sz, r: 0.45, occludes: false })
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

  /** the bee tree: an old pine with a carved hollow and a climbing rope */
  const addBeeTree = (m: Marker) => {
    batch.add(PINES[1], m.x, 0, m.z, rng() * 6, 1.35, 1.25, 1.35)
    const g = new THREE.Group()
    g.position.set(m.x, 0, m.z)
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.55), std(0x050403, 1, { side: THREE.DoubleSide }))
    hole.position.set(0, 2.6, 0.36)
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.62, 0.04), woodMat)
    board.position.set(0.26, 2.6, 0.33)
    board.rotation.y = 0.5
    g.add(hole, board)
    for (let i = 0; i < 3; i++) {
      const rope = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.018, 4, 18), std(0x6a5a3e, 1))
      rope.rotation.x = Math.PI / 2 + (rng() - 0.5) * 0.2
      rope.position.y = 0.9 + i * 0.7
      g.add(rope)
    }
    root.add(g)
    field.addCircle({ x: m.x, z: m.z, r: 0.6, occludes: true })
    emitters.push({ pos: new THREE.Vector3(m.x, 2.6, m.z + 0.4), kind: 'fireflies', rate: 0.6, radius: 1.2, acc: 0, active: () => true })
  }

  let hollow: THREE.Vector3 | null = null
  /** the old tree of the glade: a black hollow where the boy is hidden */
  const addHollowTree = (m: Marker) => {
    addGreatTree(m)
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.42, 14), std(0x030202, 1))
    hole.scale.set(0.8, 1.3, 1)
    hole.position.set(m.x, 1.25, m.z + 0.82)
    root.add(hole)
    // a faint warm breath inside: somebody is alive there
    const light = lights.add({ pos: new THREE.Vector3(m.x, 1.2, m.z + 1.2), color: new THREE.Color(1, 0.6, 0.3), intensity: 1.6, distance: 4, flicker: 0.3, on: true })
    halos.add(new THREE.Vector3(m.x, 1.25, m.z + 0.9), new THREE.Color(1, 0.6, 0.3), 0.9, 0.12, light)
    hollow = new THREE.Vector3(m.x, 0, m.z + 1)
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

  // ash footprints from the burned yurt to where the wolves wait
  const yurtM = level.markers.find((m) => m.ch === 'e')
  const trailEnd = level.markers.find((m) => m.ch === '6')
  if (yurtM && trailEnd) addTracks(yurtM, trailEnd)

  // the other signs, at the story places (docs/TRACKING.md)
  const mk = (ch: string) => level.markers.find((m) => m.ch === ch)
  const hunter = mk('h')
  if (hunter) {
    // a long black strand clenched in the hunter's hand
    const hairMat = std(0x0a0808, 0.8)
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
  const horse = mk('H')
  if (horse) {
    // drag furrows of the dead turning east, toward the mountains
    const furrow = std(0x0d0a08, 1, { transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 3.2).rotateX(-Math.PI / 2), furrow)
      f.position.set(horse.x + 2.2, 0.02, horse.z - 0.4 + i * 0.35)
      f.rotation.y = Math.PI / 2 + (i - 1) * 0.08
      root.add(f)
    }
    clues.turn = new THREE.Vector3(horse.x + 1.6, 0, horse.z)
  }
  const arch = mk('c')
  if (arch) clues.charms = new THREE.Vector3(arch.x, 0, arch.z + 1.2)

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
        addFamilyYurt(m)
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
      case 'n':
        addBeeTree(m)
        break
      case 'T':
        addHollowTree(m)
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
  }

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
    solid(geo, [0.05, 0.035, 0.03])
    const mesh = new THREE.Mesh(geo, std(0xffffff, 0.9, { vertexColors: true }))
    mesh.castShadow = true
    mesh.position.y = -4.5
    mesh.visible = false
    root.add(mesh)
    gate = { cells: gateCells, mesh, circles, closed: false, anim: 0, center: new THREE.Vector3(cx / gateCells.length, 0, cz / gateCells.length) }
  }

  buildBarrier('thorns', thornCells)
  buildBarrier('deadfall', fallCells)

  const lit = level.markers.filter((m) => m.ch === 'L')
  const arenaCenter = lit.length
    ? new THREE.Vector3(lit.reduce((s, m) => s + m.x, 0) / lit.length, 0, lit.reduce((s, m) => s + m.z, 0) / lit.length)
    : start.clone()

  const instancedMeshes = batch.build(root)
  shaftTime = shaftMat.uniforms.uTime

  // lore order follows the path: the stone nearest the start tells the oldest story
  tamgas.sort((a, b) => b.pos.z - a.pos.z).forEach((t, i) => (t.id = i))
  if (barrowTamga) tamgas.push(barrowTamga)
  return { root, start, braziers, spring, drop, grove, gate, emitters, triggers, spawns, arenaCenter, fires, instancedMeshes, halos, tamgas, clues, trackMats, trap, barriers, hollow, waterSpots, stream }
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
      }
    }
  }
}
