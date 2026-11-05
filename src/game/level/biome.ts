// What the ground, the walls and the small things are made of outside the urman (docs/LEVELS.md, chapters 2–3):
// the steppe of barrows — ash-silver feather grass, basalt and mercury-black lakes; the cave of Shulgan-Tash — limestone,
// ice and the underground river, and above SUMMIT_ROW the snowy summit of Iremel under the open sky.

import * as THREE from 'three'
import { Batcher, blob, displace, ensureUv, limb, merge, paint, type RGB } from './geo'
import { CELL, type LevelData } from './map'
import type { Field } from './field'
import { fbm, lerp, mulberry32, smoothstep, vnoise, GLSL_NOISE } from '../util'
import { globalUniforms, patchMaterial, std } from '../render/materials'
import type { Biome } from '../chapters'

export interface BiomeOpts {
  biome: Biome
  /** chapter 3: rows above this are the open summit */
  summitRow?: number
  /** chapter 3: deep cells above this row are the abyss under the ledge, not water */
  abyssRow?: number
  /** chapter 2: cell rects of the dry riverbed (cracked clay instead of grass) */
  clay?: [number, number, number, number][]
  /** chapter 2: rows below this are still the edge of the urman (trees instead of basalt) */
  forestRow?: number
}

/** a 0..1 bilinear sample of a per-cell mask */
export function cellMask(level: LevelData, arr: Uint8Array | ((c: number, r: number) => number)) {
  const get = typeof arr === 'function' ? arr : (c: number, r: number) => arr[r * level.cols + c]
  const at = (c: number, r: number) => (c >= 0 && r >= 0 && c < level.cols && r < level.rows ? get(c, r) : 0)
  return (x: number, z: number) => {
    const fx = x / CELL - 0.5
    const fz = z / CELL - 0.5
    const c0 = Math.floor(fx)
    const r0 = Math.floor(fz)
    const tx = fx - c0
    const tz = fz - r0
    return lerp(lerp(at(c0, r0), at(c0 + 1, r0), tx), lerp(at(c0, r0 + 1), at(c0 + 1, r0 + 1), tx), tz)
  }
}

const inRects = (rects: [number, number, number, number][] | undefined, c: number, r: number) => !!rects?.some(([c0, r0, c1, r1]) => c >= c0 && c <= c1 && r >= r0 && r <= r1)

export interface GroundCtx {
  o: BiomeOpts
  level: LevelData
  /** deep water (not the abyss), 0..1 */
  deepAt: (x: number, z: number) => number
  /** the abyss under the ledge, 0..1 */
  abyssAt: (x: number, z: number) => number
  clayAt: (x: number, z: number) => number
}

export function groundCtx(o: BiomeOpts, level: LevelData): GroundCtx {
  const abyssRow = o.abyssRow ?? -1
  const deepAt = cellMask(level, (c, r) => (level.deep[r * level.cols + c] && r >= abyssRow ? 1 : 0))
  const abyssAt = cellMask(level, (c, r) => (level.deep[r * level.cols + c] && r < abyssRow ? 1 : 0))
  const clayAt = cellMask(level, (c, r) => (inRects(o.clay, c, r) ? 1 : 0))
  return { o, level, deepAt, abyssAt, clayAt }
}

/** colour and height of the ground at a vertex; `sd` — metres to the nearest wall (negative inside), `wm` — the stream bed */
export function groundAt(g: GroundCtx, x: number, z: number, sd: number, wm: number): { c: RGB; y: number } {
  const n = fbm(x * 0.13, z * 0.13)
  const n2 = vnoise(x * 0.7, z * 0.7)
  const dk = g.deepAt(x, z)
  const ab = g.abyssAt(x, z)
  const row = z / CELL
  let c: RGB
  let y: number
  if (g.o.biome === 'steppe') {
    const k = 0.75 + 0.5 * n
    // the steppe floor: ash-silver soil under the feather grass (#3a4247 at the tips)
    const floor: RGB = [0.07 * k, 0.076 * k, 0.078 * k]
    const worn: RGB = [0.055 * (0.8 + 0.4 * n2), 0.058 * (0.8 + 0.4 * n2), 0.056 * (0.8 + 0.4 * n2)]
    const basalt: RGB = [0.03, 0.033, 0.04]
    if (sd > 0) {
      const t = smoothstep(0.2, 3, sd + (n - 0.5) * 2)
      c = [lerp(worn[0], floor[0], t), lerp(worn[1], floor[1], t), lerp(worn[2], floor[2], t)]
      y = 0
    } else {
      // the walls are hills and basalt ridges: grass on the slopes, bare black stone along the crests
      const h = Math.min(-sd, 6)
      const crest = smoothstep(1.2, 3.5, h + (n2 - 0.5) * 1.4)
      c = [lerp(floor[0], basalt[0], crest), lerp(floor[1], basalt[1], crest), lerp(floor[2], basalt[2], crest)]
      y = h * 0.42 * (0.65 + 0.6 * n)
    }
    const cl = g.clayAt(x, z)
    if (cl > 0 && sd > -0.5) {
      // the dry riverbed: pale cracked clay
      const crack = smoothstep(0.035, 0.0, Math.abs(vnoise(x * 1.4 + 3, z * 1.4) - 0.5)) + smoothstep(0.03, 0.0, Math.abs(vnoise(x * 2.3, z * 2.3 + 5) - 0.5)) * 0.7
      const ck = (0.8 + 0.35 * n2) * (1 - Math.min(1, crack) * 0.55)
      const clay: RGB = [0.13 * ck, 0.108 * ck, 0.08 * ck]
      c = [lerp(c[0], clay[0], cl), lerp(c[1], clay[1], cl), lerp(c[2], clay[2], cl)]
      y -= cl * 0.18
    }
  } else {
    const summit = row < (g.o.summitRow ?? -1)
    if (summit) {
      const k = 0.86 + 0.24 * n
      const snow: RGB = [0.3 * k, 0.33 * k, 0.38 * k]
      const rock: RGB = [0.055, 0.06, 0.07]
      if (sd > 0) {
        const drift = smoothstep(0.1, 1.6, sd)
        c = [lerp(snow[0] * 0.85, snow[0], drift), lerp(snow[1] * 0.85, snow[1], drift), lerp(snow[2] * 0.88, snow[2], drift)]
        y = (n2 - 0.5) * 0.08
      } else {
        const h = Math.min(-sd, 6)
        const bare = smoothstep(0.6, 0.2, vnoise(x * 0.9, z * 0.9) + h * 0.05) * smoothstep(0.5, 2.5, h)
        c = [lerp(snow[0], rock[0], bare), lerp(snow[1], rock[1], bare), lerp(snow[2], rock[2], bare)]
        y = h * 0.5 * (0.6 + 0.7 * n)
      }
    } else {
      // limestone grey (#23272a), damp darker where water stands, ochre seeping out of the cracks here and there
      const k = 0.75 + 0.5 * n
      const lime: RGB = [0.075 * k, 0.078 * k, 0.08 * k]
      const damp: RGB = [0.04, 0.045, 0.05]
      const ochre = smoothstep(0.72, 0.85, vnoise(x * 0.35 + 11, z * 0.35))
      if (sd > 0) {
        const w = smoothstep(0.65, 0.4, n2) * 0.6
        c = [lerp(lime[0], damp[0], w) + ochre * 0.03, lerp(lime[1], damp[1], w) + ochre * 0.008, lerp(lime[2], damp[2], w)]
        y = 0
      } else {
        const h = Math.min(-sd, 6)
        c = [lime[0] * 1.15 + ochre * 0.04, lime[1] * 1.12 + ochre * 0.01, lime[2] * 1.1]
        y = h * 0.55 * (0.6 + 0.7 * n)
      }
    }
  }
  if (wm > 0) {
    const gv = 0.75 + 0.5 * vnoise(x * 1.9 + 7, z * 1.9) + (n2 - 0.5) * 0.3
    const bed: RGB = g.o.biome === 'cave' ? [0.05 * gv, 0.058 * gv, 0.065 * gv] : [0.04 * gv, 0.044 * gv, 0.048 * gv]
    c = [lerp(c[0], bed[0], wm * 0.9), lerp(c[1], bed[1], wm * 0.9), lerp(c[2], bed[2], wm * 0.9)]
    y = Math.min(y, -0.24 * wm)
  }
  if (dk > 0.01) {
    // the black lakes and the river: the ground falls away under the surface (a ragged shore, not the cell grid)
    const t = smoothstep(0.2, 0.7, dk + (n2 - 0.5) * 0.35 + (n - 0.5) * 0.25)
    c = [lerp(c[0], 0.006, t), lerp(c[1], 0.009, t), lerp(c[2], 0.013, t)]
    y = lerp(y, -2.2 - n * 0.3, t)
  }
  if (ab > 0.01) {
    const t = smoothstep(0.05, 0.6, ab)
    c = [lerp(c[0], 0.002, t), lerp(c[1], 0.003, t), lerp(c[2], 0.005, t)]
    y = lerp(y, -9, t)
  }
  return { c, y }
}

// ---------------------------------------------------------------- instanced shapes

/** a stone with its own palette: basalt, limestone, snowy rock */
function stoneGeo(seed: number, base: RGB, top: RGB, stretch = 0.62) {
  const g = displace(blob(1, 2), 0.5, 1.3, seed * 3.7)
  g.scale(1, stretch, 1)
  g.computeVertexNormals()
  g.translate(0, 0.25, 0)
  return paint(g, (p, n) => {
    const up = smoothstep(0.45, 0.9, n.y + (vnoise(p.x * 2.5, p.z * 2.5) - 0.5) * 0.5)
    const k = 0.8 + vnoise(p.x * 6 + seed, p.y * 6) * 0.4
    return [lerp(base[0], top[0], up) * k, lerp(base[1], top[1], up) * k, lerp(base[2], top[2], up) * k]
  })
}

/** feather grass (ковыль): long silver plumes that bend in the wind */
function kovylGeo(seed: number, dry = false) {
  const rng = mulberry32(seed)
  const pos: number[] = []
  const col: number[] = []
  const blades = dry ? 6 : 12
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2
    const r = rng() * 0.22
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const h = (dry ? 0.25 : 0.5) + rng() * (dry ? 0.25 : 0.55)
    const lean = (rng() - 0.5) * 0.7
    const w = 0.03
    const tip: RGB = dry ? [0.16, 0.13, 0.09] : [0.32 + rng() * 0.08, 0.36 + rng() * 0.08, 0.38 + rng() * 0.08]
    const root: RGB = dry ? [0.06, 0.05, 0.035] : [0.05, 0.06, 0.055]
    pos.push(x - w, 0, z, x + w, 0, z, x + lean, h, z + lean * 0.6)
    col.push(...root, ...root, ...tip)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  ensureUv(g)
  return g
}

/** a stalagmite (up) or a stalactite (down): a lumpy cone of wet limestone or ice */
function spikeGeo(seed: number, down: boolean, ice = false) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 1 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const h = 0.8 + rng() * 1.6
    const r = 0.12 + rng() * 0.16
    const g = new THREE.ConeGeometry(r, h, 6, 3)
    displace(g, 0.04, 4, seed + i)
    g.translate((rng() - 0.5) * 0.5, h / 2, (rng() - 0.5) * 0.5)
    if (down) g.rotateX(Math.PI)
    parts.push(g)
  }
  const g = merge(parts)
  return paint(g, (p) => {
    const k = 0.8 + vnoise(p.x * 5 + seed, p.y * 5) * 0.4
    return ice ? [0.32 * k, 0.4 * k, 0.48 * k] : [0.1 * k, 0.098 * k, 0.095 * k]
  })
}

/** a dead steppe snag: a low, wind-bent bare tree */
function snagGeo(seed: number) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const lean = new THREE.Vector3((rng() - 0.5) * 0.8, 0, (rng() - 0.5) * 0.8)
  const top = new THREE.Vector3(lean.x, 2.6 + rng(), lean.z)
  parts.push(limb(new THREE.Vector3(0, -0.2, 0), top, 0.16, 0.05, 6))
  for (let i = 0; i < 6; i++) {
    const t = 0.35 + rng() * 0.6
    const a = new THREE.Vector3(lean.x * t, top.y * t, lean.z * t)
    const b = a.clone().add(new THREE.Vector3((rng() - 0.5) * 1.8, 0.4 + rng() * 0.8, (rng() - 0.5) * 1.8))
    parts.push(limb(a, b, 0.05, 0.01, 4))
  }
  const g = merge(parts)
  return paint(g, (p) => {
    const k = 0.7 + vnoise(p.x * 4, p.y * 4) * 0.5
    return [0.07 * k, 0.065 * k, 0.06 * k]
  })
}

export interface BiomeKit {
  /** keys registered with the batcher */
  rocks: string[]
}

/** register the shapes of this biome with the batcher (keys avoid the tree names: no trunk shadow stand-ins for them) */
export function registerBiome(batch: Batcher, o: BiomeOpts): BiomeKit {
  const fade = (m: THREE.MeshStandardMaterial) => patchMaterial(m, { fade: true })
  const lowVeg = patchMaterial(std(0xffffff, 0.95, { vertexColors: true, side: THREE.DoubleSide }), { wind: 0.16, windStart: 0.05 })
  if (o.biome === 'steppe') {
    const mat = fade(std(0xffffff, 0.92, { vertexColors: true }))
    const plain = std(0xffffff, 0.92, { vertexColors: true })
    for (let i = 0; i < 3; i++) batch.register('basalt' + i, stoneGeo(40 + i, [0.035, 0.038, 0.045], [0.06, 0.065, 0.068], 0.55 + i * 0.12), mat)
    batch.register('pebble_s', stoneGeo(50, [0.05, 0.052, 0.055], [0.08, 0.085, 0.085]), plain, false)
    batch.register('kovyl0', kovylGeo(61), lowVeg, false)
    batch.register('kovyl1', kovylGeo(62), lowVeg, false)
    batch.register('kovyl_dry', kovylGeo(63, true), lowVeg, false)
    batch.register('snag0', snagGeo(71), fade(std(0xffffff, 1, { vertexColors: true })))
    batch.register('snag1', snagGeo(72), fade(std(0xffffff, 1, { vertexColors: true })))
    return { rocks: ['basalt0', 'basalt1', 'basalt2'] }
  }
  const mat = fade(std(0xffffff, 0.85, { vertexColors: true }))
  const plain = std(0xffffff, 0.9, { vertexColors: true })
  for (let i = 0; i < 3; i++) batch.register('lime' + i, stoneGeo(80 + i, [0.085, 0.085, 0.088], [0.12, 0.118, 0.115], 0.8 + i * 0.25), mat)
  for (let i = 0; i < 2; i++) batch.register('snowrock' + i, stoneGeo(90 + i, [0.06, 0.065, 0.075], [0.4, 0.43, 0.48], 0.7), mat)
  batch.register('pebble_c', stoneGeo(95, [0.07, 0.07, 0.075], [0.1, 0.1, 0.1]), plain, false)
  batch.register('stalag0', spikeGeo(101, false), mat)
  batch.register('stalag1', spikeGeo(102, false), mat)
  batch.register('stalac0', spikeGeo(103, true), mat, false)
  batch.register('stalac1', spikeGeo(104, true, true), mat, false)
  batch.register('icespike', spikeGeo(105, false, true), std(0xffffff, 0.3, { vertexColors: true, emissive: 0x0a141c }), false)
  return { rocks: ['lime0', 'lime1', 'lime2'] }
}

/** walls: basalt ridges and snags in the steppe; limestone masses, stalagmites and hanging stalactites in the cave */
export function placeBiomeWalls(batch: Batcher, field: Field, level: LevelData, o: BiomeOpts, g: GroundCtx, rng: () => number) {
  const step = 1.4
  const summitRow = o.summitRow ?? -1
  for (let z = 0; z < level.depth; z += step) {
    for (let x = 0; x < level.width; x += step) {
      const px = x + rng() * step
      const pz = z + rng() * step
      const sd = field.sample(px, pz)
      if (sd > -0.2 || sd < -6.5) continue
      if (g.deepAt(px, pz) > 0.05 || g.abyssAt(px, pz) > 0.05) continue
      const row = pz / CELL
      const r = rng()
      const rot = rng() * Math.PI * 2
      const ground = groundAt(g, px, pz, sd, 0).y
      const edge = sd > -2.4
      if (o.biome === 'steppe') {
        if (o.forestRow !== undefined && row >= o.forestRow) continue
        if (edge && r < 0.32) {
          const s = 0.5 + rng() * 1.1
          batch.add('basalt' + Math.floor(rng() * 3), px, ground - 0.25, pz, rot, s, s * (0.8 + rng() * 0.7), s, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3)
        } else if (edge && r < 0.62) batch.add(rng() < 0.5 ? 'kovyl0' : 'kovyl1', px, ground, pz, rot, 1 + rng() * 0.7)
        else if (!edge && r < 0.1) {
          const s = 1.3 + rng() * 1.8
          batch.add('basalt' + Math.floor(rng() * 3), px, ground - 0.5, pz, rot, s, s * (0.6 + rng() * 0.6), s)
        } else if (r < 0.125) batch.add(rng() < 0.5 ? 'snag0' : 'snag1', px, ground - 0.1, pz, rot, 0.8 + rng() * 0.5)
        else if (r < 0.4) batch.add(rng() < 0.5 ? 'kovyl0' : 'kovyl1', px, ground, pz, rot, 0.9 + rng() * 0.6)
      } else if (row < summitRow) {
        if (edge && r < 0.5) {
          const s = 0.6 + rng() * 1.3
          batch.add('snowrock' + Math.floor(rng() * 2), px, ground - 0.3, pz, rot, s, s * (0.7 + rng() * 0.8), s)
        } else if (r < 0.15) {
          const s = 1.4 + rng() * 1.6
          batch.add('snowrock' + Math.floor(rng() * 2), px, ground - 0.6, pz, rot, s, s, s)
        }
      } else {
        if (edge && r < 0.45) {
          const s = 0.7 + rng() * 1.3
          batch.add('lime' + Math.floor(rng() * 3), px, ground - 0.3, pz, rot, s, s * (0.9 + rng() * 1.1), s, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25)
        } else if (edge && r < 0.62) batch.add(rng() < 0.5 ? 'stalag0' : 'stalag1', px, ground - 0.1, pz, rot, 0.8 + rng() * 0.9)
        else if (sd < -1.2 && r < 0.8) {
          // the vault comes down to meet the walls: icicles and stalactites hang over the edges of the way
          batch.add(rng() < 0.6 ? 'stalac0' : 'stalac1', px, 5.2 + rng() * 1.5, pz, rot, 0.9 + rng() * 1.1)
        } else if (r < 0.88) {
          const s = 1.5 + rng() * 1.6
          batch.add('lime' + Math.floor(rng() * 3), px, ground - 0.6, pz, rot, s, s * (1 + rng()), s)
        }
      }
    }
  }
}

/** small things on the floor: feather grass and pebbles, reeds along the shallows; pebbles, ice and snow tufts above */
export function placeBiomeGround(batch: Batcher, field: Field, level: LevelData, o: BiomeOpts, g: GroundCtx, waterAt: (x: number, z: number) => number, rng: () => number) {
  const step = 0.85
  const summitRow = o.summitRow ?? -1
  for (let z = 0; z < level.depth; z += step) {
    for (let x = 0; x < level.width; x += step) {
      const px = x + rng() * step
      const pz = z + rng() * step
      const sd = field.sample(px, pz)
      if (sd < -0.1 || sd > 40) continue
      if (g.deepAt(px, pz) > 0.02) continue
      const r = rng()
      const rot = rng() * Math.PI * 2
      const wv = waterAt(px, pz)
      if (o.biome === 'steppe') {
        if (wv > 0.12) {
          if (wv < 0.6 && r < 0.4) batch.add('kovyl1', px, -0.1, pz, rot, 1 + rng() * 0.5, 1.6 + rng(), 1)
          continue
        }
        const clay = g.clayAt(px, pz)
        if (clay > 0.4) {
          if (r < 0.04) batch.add('kovyl_dry', px, -0.15, pz, rot, 0.9 + rng() * 0.5)
          else if (r < 0.08) batch.add('pebble_s', px, -0.2, pz, rot, 0.1 + rng() * 0.15)
          continue
        }
        const dense = sd > 1 ? 0.34 : 0.5
        if (r < dense) batch.add(rng() < 0.5 ? 'kovyl0' : 'kovyl1', px, 0, pz, rot, 0.75 + rng() * 0.6)
        else if (r < dense + 0.025) batch.add('pebble_s', px, -0.05, pz, rot, 0.1 + rng() * 0.2)
      } else if (pz / CELL < summitRow) {
        if (r < 0.03) batch.add('snowrock' + Math.floor(rng() * 2), px, -0.08, pz, rot, 0.12 + rng() * 0.2)
      } else {
        if (wv > 0.12) {
          if (r < 0.06) batch.add('icespike', px, -0.15, pz, rot, 0.25 + rng() * 0.25)
          continue
        }
        if (sd < 1.3 && r < 0.09) batch.add(rng() < 0.5 ? 'stalag0' : 'stalag1', px, -0.05, pz, rot, 0.25 + rng() * 0.35)
        else if (r < 0.14) batch.add('pebble_c', px, -0.05, pz, rot, 0.08 + rng() * 0.18)
      }
    }
  }
}

// ---------------------------------------------------------------- deep water

export interface Lake {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
}

/**
 * Mercury-black deep water (#0a1017) over the lowered ground: a single plane at the surface level; the banks hide it
 * where the ground stands above. It mirrors the moon in slow ripples and lets a little of what lies under it show through —
 * the reflections of chapter 2 are drawn there (docs/LEVELS.md, TRG_CH2_LAKE_MIRROR).
 */
export function buildLake(level: LevelData, o: BiomeOpts, moon: { value: number }, moonDir: THREE.Vector3): Lake | null {
  const abyssRow = o.abyssRow ?? -1
  let c0 = 1e9
  let c1 = -1e9
  let r0 = 1e9
  let r1 = -1e9
  for (let r = 0; r < level.rows; r++)
    for (let c = 0; c < level.cols; c++)
      if (level.deep[r * level.cols + c] && r >= abyssRow) {
        c0 = Math.min(c0, c)
        c1 = Math.max(c1, c)
        r0 = Math.min(r0, r)
        r1 = Math.max(r1, r)
      }
  if (c0 > c1) return null
  const x0 = (c0 - 2) * CELL
  const z0 = (r0 - 2) * CELL
  const w = (c1 - c0 + 5) * CELL
  const d = (r1 - r0 + 5) * CELL
  const cave = o.biome === 'cave'
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uMoon: moon,
      uMoonDir: { value: moonDir.clone().normalize() },
      uClarity: { value: cave ? 0.92 : 0.86 },
      uFlow: { value: new THREE.Vector2(cave ? 0.0 : 0.02, cave ? -0.35 : 0.01) },
      // unlit, so it must stay darker than the moonlit ground round it: mercury-black (#0a1017), a faint sky at grazing angles
      uTint: { value: cave ? new THREE.Color(0.003, 0.005, 0.007) : new THREE.Color(0.002, 0.0035, 0.006) },
      uSky: { value: cave ? new THREE.Color(0.012, 0.02, 0.026) : new THREE.Color(0.025, 0.034, 0.05) },
    },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform float uMoon; uniform vec3 uMoonDir; uniform float uClarity; uniform vec2 uFlow;
      uniform vec3 uTint; uniform vec3 uSky; varying vec3 vW;
      ${GLSL_NOISE}
      void main(){
        vec2 p = vW.xz * 0.35 + uFlow * uTime;
        float e = 0.08;
        float h0 = fbm(p + vec2(uTime * 0.03, 0.0));
        float hx = fbm(p + vec2(e, 0.0) + vec2(uTime * 0.03, 0.0));
        float hz = fbm(p + vec2(0.0, e) + vec2(uTime * 0.03, 0.0));
        vec3 N = normalize(vec3((h0 - hx) * 0.7, 1.0, (h0 - hz) * 0.7));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 R = reflect(-V, N);
        // the iso camera looks almost straight down the moon's reflection: keep the highlight a scatter of small glints
        float spec = pow(max(dot(R, uMoonDir), 0.0), 1400.0);
        float glint = step(0.9, fbm(vW.xz * 3.1 + uTime * 0.15));
        vec3 col = uTint + uSky * (0.15 + fres * 2.5) * uMoon + vec3(0.55, 0.65, 0.85) * (spec * 0.35 + glint * spec * 0.9 + glint * 0.006) * uMoon * uMoon;
        float a = mix(uClarity, 1.0, fres);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: true,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat)
  mesh.position.set(x0 + w / 2, -0.12, z0 + d / 2)
  mesh.renderOrder = 5
  mesh.name = 'lake'
  mesh.receiveShadow = false
  return { mesh, mat }
}
