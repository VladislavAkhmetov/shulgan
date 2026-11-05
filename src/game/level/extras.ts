// The places and things of chapters 2 and 3 (docs/LEVELS.md, docs/ASSETS.md 2.5–2.6), built from the markers of
// level/map2.ts and level/map3.ts. Whatever the game needs to act on is returned in `Extras`.

import * as THREE from 'three'
import { blob, displace, limb, merge, paint, solid, type Batcher, type RGB } from './geo'
import { CELL, type LevelData, type Marker } from './map'
import type { Circle, Field } from './field'
import type { Halos } from './dressing'
import { mulberry32, vnoise, GLSL_NOISE } from '../util'
import { barkTexture, glow, globalUniforms, patchMaterial, std } from '../render/materials'
import type { Lighting, LightSource } from '../render/lights'
import { makeFlame, type VFX } from '../render/vfx'
import type { Biome } from '../chapters'

/** an old balbal that answers the kurai (chapter 2): `echo` — the voice of thirty winters ago, `melody` — the order of the bowls */
export interface EchoStone {
  pos: THREE.Vector3
  kind: 'echo' | 'melody'
  heard: boolean
  /** its tamga flares turquoise while the kurai sounds */
  glow: THREE.MeshBasicMaterial
}

/** a high fire bowl on a stone pillar in the black water (TRG_CH2_BRAZIER_SHOT) */
export interface FireBowl {
  /** the bowl itself, 3 m up */
  pos: THREE.Vector3
  lit: boolean
  flame: THREE.Object3D
  coal: THREE.Mesh
  light: LightSource
  /** the turquoise sign on the pillar that shows its note while the melody plays */
  sign: THREE.MeshBasicMaterial
}

/** the rope that holds the drawbridge up (shoot it) */
export interface Rope {
  a: THREE.Vector3
  b: THREE.Vector3
  mesh: THREE.Mesh
  cut: boolean
}

/** an icicle cluster over the path in the karst shaft: an arrow brings it down on whoever stands below */
export interface Icicle {
  pos: THREE.Vector3
  mesh: THREE.Object3D
  fallen: boolean
  t: number
}

export interface Extras {
  echoes: EchoStone[]
  bowls: FireBowl[]
  rope: Rope | null
  icicles: Icicle[]
  /** the basalt islets of the crossing (chapter 2 arena) */
  islets: THREE.Vector3[]
  /** the mouth of Shulgan-Tash at the far end of chapter 2 */
  exit: THREE.Vector3 | null
  /** the sacrificial stone of the flooded sanctuary: three arrows lie on it */
  altar: THREE.Vector3 | null
  /** chapter 3: where the Shadow of Arslan rises by the river, and his old fire pit with four arrows */
  arslan: THREE.Vector3 | null
  fatherArrows: THREE.Vector3 | null
  /** the bowl of Yanshishma, Aisylu by it, Shulgen's stone */
  basin: THREE.Vector3 | null
  basinWater: THREE.ShaderMaterial | null
  basinLight: LightSource | null
  aisylu: THREE.Vector3 | null
  shulgenSeat: THREE.Vector3 | null
  /** the centre of the boss duel */
  arena: THREE.Vector3 | null
  crystals: LightSource[]
}

export const emptyExtras = (): Extras => ({ echoes: [], bowls: [], rope: null, icicles: [], islets: [], exit: null, altar: null, arslan: null, fatherArrows: null, basin: null, basinWater: null, basinLight: null, aisylu: null, shulgenSeat: null, arena: null, crystals: [] })

export interface ExtrasCtx {
  biome: Biome
  root: THREE.Group
  batch: Batcher
  rocks: string[]
  field: Field
  level: LevelData
  lights: Lighting
  vfx: VFX
  halos: Halos
  rng: () => number
  stones: Circle[]
  stuckArrows: { pos: THREE.Vector3; dir: THREE.Vector3 }[]
  triggers: { id: string; pos: THREE.Vector3; fired: boolean }[]
  tamgas: { pos: THREE.Vector3; id: number; read: boolean }[]
  spawns: Marker[]
  emitters: { pos: THREE.Vector3; kind: 'embers' | 'smoke' | 'motes' | 'fireflies' | 'sparkle' | 'spores' | 'spirit' | 'snow'; rate: number; radius: number; acc: number; active: () => boolean }[]
  /** a fire pit (cold: lit later) */
  addFire: (m: Marker, lit: boolean) => void
  /** spirit veil and drawbridge cells, built as barriers by build.ts */
  veilCells: number[]
  bridgeCells: number[]
  /** the ground height at a point (hills, the lowered bed of the lakes) */
  groundY: (x: number, z: number) => number
}

const stoneTex = barkTexture()

/** the direction from (x, z) toward the nearest wall, and how far it is */
function wallDir(field: Field, x: number, z: number) {
  const e = 0.4
  const gx = field.sample(x + e, z) - field.sample(x - e, z)
  const gz = field.sample(x, z + e) - field.sample(x, z - e)
  const l = Math.hypot(gx, gz) || 1
  return { dir: new THREE.Vector3(-gx / l, 0, -gz / l), dist: Math.max(0.3, field.sample(x, z)) }
}

/** red ochre on stone: hunters, a marten, a running man with a waterskin, a woman over a cradle (the Kapova cave manner) */
function ochreTexture(seed: number) {
  const s = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.clearRect(0, 0, s, s)
  const rng = mulberry32(seed)
  ctx.strokeStyle = 'rgba(190,60,40,0.92)'
  ctx.fillStyle = 'rgba(180,55,36,0.9)'
  ctx.lineCap = 'round'
  ctx.lineWidth = 7
  const man = (x: number, y: number, k = 1) => {
    ctx.beginPath()
    ctx.arc(x, y, 7 * k, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x, y + 7 * k)
    ctx.lineTo(x + 2 * k, y + 40 * k)
    ctx.lineTo(x - 12 * k, y + 66 * k)
    ctx.moveTo(x + 2 * k, y + 40 * k)
    ctx.lineTo(x + 16 * k, y + 64 * k)
    ctx.moveTo(x, y + 18 * k)
    ctx.lineTo(x - 16 * k, y + 32 * k)
    ctx.moveTo(x, y + 18 * k)
    ctx.lineTo(x + 18 * k, y + 26 * k)
    ctx.stroke()
  }
  if (seed % 2) {
    // the man with a waterskin running from the mountain; a marten beside a cradle
    ctx.beginPath()
    ctx.moveTo(20, 120)
    ctx.lineTo(70, 40)
    ctx.lineTo(110, 100)
    ctx.stroke()
    man(150, 60)
    ctx.beginPath()
    ctx.ellipse(172, 88, 12, 8, 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(40, 210)
    ctx.bezierCurveTo(70, 190, 120, 190, 150, 205)
    ctx.lineTo(176, 196)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(205, 205, 22, Math.PI, 0)
    ctx.stroke()
  } else {
    // two brothers at a spring: one pours the water on the ground, one drinks
    man(70, 50)
    man(180, 50)
    ctx.beginPath()
    ctx.arc(125, 200, 30, 0, Math.PI * 2)
    ctx.stroke()
    for (let i = 0; i < 6; i++) {
      ctx.beginPath()
      ctx.arc(40 + rng() * 40, 150 + rng() * 60, 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.moveTo(180, 70)
    ctx.lineTo(196, 30)
    ctx.stroke()
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function buildExtras(cx: ExtrasCtx): Extras {
  const { root, batch, field, level, lights, halos, rng, stones, stuckArrows, triggers, tamgas, spawns, emitters } = cx
  const ex = emptyExtras()
  const rocks = cx.rocks
  const granite = std(0x8a8a82, 0.95, { map: stoneTex })
  const basaltMat = std(0x2a2d33, 0.9, { map: stoneTex })
  const lichen = std(0x8a7a3a, 1)
  const charMat = std(0x0d0b0a, 1)
  const woodMat = std(0x3a2a1c, 0.95, { map: stoneTex })
  const cave = cx.biome === 'cave'

  /** a tall anthropomorphic granite warrior, yellow lichen on the shoulders (docs/ASSETS.md 2.5) */
  const balbal = (x: number, z: number, h: number, seed: number, faceTo?: THREE.Vector3) => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, h, 0.45, 2, 5, 2), granite)
    displace(body.geometry, 0.08, 1.6, seed)
    body.position.y = h / 2 - 0.1
    const head = new THREE.Mesh(displace(blob(0.32, 1), 0.06, 3, seed + 1), granite)
    head.scale.set(1, 1.25, 0.9)
    head.position.y = h + 0.18
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.05), charMat)
    brow.position.set(0, h + 0.28, 0.27)
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.05), charMat)
    mouth.position.set(0, h + 0.05, 0.27)
    // arms carved on the chest, hands folded over a cup
    const arms = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 4, 10, Math.PI), granite)
    arms.position.set(0, h * 0.62, 0.24)
    arms.rotation.z = Math.PI
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.12, 8), granite)
    cup.position.set(0, h * 0.5, 0.3)
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(displace(blob(0.09 + rng() * 0.06, 1), 0.03, 4, seed + i), lichen)
      l.position.set((rng() - 0.5) * 0.6, h - 0.2 - rng() * 0.6, (rng() - 0.5) * 0.4)
      l.scale.y = 0.4
      g.add(l)
    }
    g.add(body, head, brow, mouth, arms, cup)
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
    g.position.set(x, cx.groundY(x, z), z)
    g.rotation.set((rng() - 0.5) * 0.08, faceTo ? Math.atan2(faceTo.x - x, faceTo.z - z) : rng() * Math.PI * 2, (rng() - 0.5) * 0.1)
    root.add(g)
    const c = { x, z, r: 0.5, occludes: false }
    field.addCircle(c)
    stones.push(c)
    return g
  }

  /** a barrow: a mound of earth and grass ringed with stones (big: the Horseman, with a pole and a horse skull) */
  const kurgan = (m: Marker, big: boolean) => {
    const R = big ? 5.6 : 2.9
    const H = big ? 2.4 : 1.1
    const earth = std(0xffffff, 1, { vertexColors: true })
    const mound = new THREE.Mesh(displace(new THREE.SphereGeometry(R, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0.3, 1, m.col), earth)
    paint(mound.geometry, (p) => {
      const k = 0.7 + vnoise(p.x * 1.3, p.z * 1.3) * 0.5
      return [0.06 * k, 0.065 * k, 0.062 * k]
    })
    mound.scale.set(1, H / R, 1)
    mound.position.set(m.x, -0.1, m.z)
    mound.castShadow = true
    mound.receiveShadow = true
    root.add(mound)
    const ring = big ? 22 : 12
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + rng() * 0.1
      batch.add(rocks[i % rocks.length], m.x + Math.cos(a) * (R + 0.6), -0.1, m.z + Math.sin(a) * (R + 0.6), a, 0.32 + rng() * 0.15, 0.42, 0.32)
    }
    for (let i = 0; i < (big ? 40 : 14); i++) {
      const a = rng() * Math.PI * 2
      const d = Math.sqrt(rng()) * R * 0.9
      batch.add(rng() < 0.5 ? 'kovyl0' : 'kovyl1', m.x + Math.cos(a) * d, H * Math.sqrt(Math.max(0, 1 - (d / R) ** 2)) - 0.18, m.z + Math.sin(a) * d, rng() * 6, 0.8 + rng() * 0.6)
    }
    if (big) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.4, 6), woodMat)
      pole.position.set(m.x + 0.4, H + 1.5, m.z - 0.3)
      pole.rotation.z = 0.08
      pole.castShadow = true
      const skull = new THREE.Mesh(displace(blob(0.2, 1), 0.06, 4, 5), std(0xb8b0a0, 0.7))
      skull.scale.set(0.8, 0.7, 1.7)
      skull.position.set(m.x + 0.5, H + 3.25, m.z - 0.25)
      root.add(pole, skull)
      // a rusted spear thrust into the top, a tattered horsetail on it
      const spear = new THREE.Mesh(limb(new THREE.Vector3(m.x - 1.2, H - 0.2, m.z + 0.6), new THREE.Vector3(m.x - 1.6, H + 2.4, m.z + 1.2), 0.03, 0.02, 4), charMat)
      root.add(spear)
    }
    field.addCircle({ x: m.x, z: m.z, r: R * 0.92, occludes: big })
  }

  /** a stone pillar standing up out of the black water, a bowl of resin on top (docs/ASSETS.md 2.5) */
  const fireBowl = (m: Marker) => {
    const g = new THREE.Group()
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 4.6, 7, 4), basaltMat)
    displace(pillar.geometry, 0.08, 1.4, m.row)
    pillar.position.y = 0.9
    pillar.castShadow = true
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.32, 0.38, 10, 1, true), granite)
    bowl.position.y = 3.35
    bowl.castShadow = true
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 4, 12), granite)
    rim.rotation.x = Math.PI / 2
    rim.position.y = 3.53
    const coal = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12).rotateX(-Math.PI / 2), glow(1.4, 0.32, 0.07))
    coal.position.y = 3.45
    coal.visible = false
    const fl = makeFlame(0.9)
    fl.position.y = 3.4
    fl.visible = false
    cx.vfx.billboards.add(fl)
    // a turquoise sign on the pillar's face toward the alley: it flares with its note when the melody plays
    const sign = glow(0.05, 0.25, 0.25)
    const s = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.028, 4, 12, Math.PI * 1.4), sign)
    s.position.set(-0.5, 1.9, 0)
    s.rotation.set(0, -Math.PI / 2, Math.PI * 0.8)
    g.add(pillar, bowl, rim, coal, fl, s)
    g.position.set(m.x, 0, m.z)
    root.add(g)
    const light = lights.add({ pos: new THREE.Vector3(m.x, 4.1, m.z), color: new THREE.Color(1, 0.52, 0.22), intensity: 12, distance: 15, flicker: 0.8, on: false })
    halos.add(new THREE.Vector3(m.x, 3.7, m.z), new THREE.Color(1, 0.52, 0.22), 5, 0.45, light)
    const b: FireBowl = { pos: new THREE.Vector3(m.x, 3.4, m.z), lit: false, flame: fl, coal, light, sign }
    emitters.push({ pos: new THREE.Vector3(m.x, 3.6, m.z), kind: 'embers', rate: 5, radius: 0.3, acc: 0, active: () => b.lit })
    ex.bowls.push(b)
    field.addCircle({ x: m.x, z: m.z, r: 0.55, occludes: false })
  }

  /** a shield split in the grass with two arrows standing in it (docs/LEVELS.md, chapter 2 zone 1) */
  const splitShield = (m: Marker) => {
    const shield = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 4, 0, Math.PI * 1.6, 0, 0.7), std(0x3a2a1a, 0.9))
    shield.position.set(m.x, 0.25, m.z)
    shield.rotation.set(-1.1, 0.4, 0.2)
    shield.castShadow = true
    root.add(shield)
    for (const k of [-1, 1]) stuckArrows.push({ pos: new THREE.Vector3(m.x + k * 0.12, 0.42, m.z + 0.1 * k), dir: new THREE.Vector3(0.3 * k, -0.8, 0.5).normalize() })
  }

  /** the spirit veil: a turquoise haze across the alley, cold to the touch (opens when the bowls burn in the right order) */
  const veilMat = std(0x0, 1, { emissive: new THREE.Color(0.1, 0.55, 0.55), transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })

  /** the cave of Shulgan-Tash: a black mouth in the cliff, cold breath out of it */
  const caveMouth = (m: Marker) => {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.9, 6, 12, Math.PI), basaltMat)
    displace(arch.geometry, 0.3, 1, 9)
    arch.position.set(m.x, 0, m.z - 1.2)
    arch.castShadow = true
    const dark = new THREE.Mesh(new THREE.CircleGeometry(2.3, 16, 0, Math.PI), std(0x010101, 1))
    dark.position.set(m.x, 0.01, m.z - 1.3)
    root.add(arch, dark)
    emitters.push({ pos: new THREE.Vector3(m.x, 0.6, m.z), kind: 'smoke', rate: 2, radius: 1.2, acc: 0, active: () => true })
    ex.exit = new THREE.Vector3(m.x, 0, m.z)
  }

  /** an altar stone of the flooded sanctuary: three old arrows lie at its foot */
  const altar = (m: Marker) => {
    const stone = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 1.0, 3, 2, 2), basaltMat)
    displace(stone.geometry, 0.08, 1.5, 3)
    stone.position.set(m.x, 0.35, m.z)
    stone.castShadow = true
    root.add(stone)
    const tm = glow(0.2, 0.9, 0.85)
    const sign = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 4, 12, Math.PI * 1.3), tm)
    sign.position.set(m.x, 0.76, m.z)
    sign.rotation.x = -Math.PI / 2
    root.add(sign)
    const c = { x: m.x, z: m.z, r: 0.75, occludes: false }
    field.addCircle(c)
    stones.push(c)
    for (let i = 0; i < 3; i++) {
      const a = 2.2 + i * 0.7
      stuckArrows.push({ pos: new THREE.Vector3(m.x + Math.cos(a) * 1.15, 0.08, m.z + Math.sin(a) * 1.15), dir: new THREE.Vector3(Math.cos(a + 1.4), -0.1, Math.sin(a + 1.4)).normalize() })
    }
    ex.altar = new THREE.Vector3(m.x, 0, m.z)
    halos.add(new THREE.Vector3(m.x, 0.9, m.z), new THREE.Color(0.2, 0.9, 0.85), 1.6, 0.12, null)
  }

  /** the post on the island that holds the drawbridge up by a rope */
  let postTop: THREE.Vector3 | null = null
  const ropePost = (m: Marker) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.8, 6), woodMat)
    post.position.set(m.x, 1.4, m.z)
    post.castShadow = true
    root.add(post)
    field.addCircle({ x: m.x, z: m.z, r: 0.2, occludes: false })
    postTop = new THREE.Vector3(m.x, 2.7, m.z)
  }

  /** red ochre paintings on the cave wall (lore page) */
  const ochre = (m: Marker) => {
    const w = wallDir(field, m.x, m.z)
    const at = new THREE.Vector3(m.x + w.dir.x * (w.dist + 0.2), 1.6, m.z + w.dir.z * (w.dist + 0.2))
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: ochreTexture(m.row), transparent: true, roughness: 1, emissive: new THREE.Color(0.25, 0.06, 0.03), emissiveMap: ochreTexture(m.row), depthWrite: false }))
    plane.position.copy(at)
    plane.lookAt(m.x, 1.6, m.z)
    root.add(plane)
    tamgas.push({ pos: new THREE.Vector3(m.x, 0, m.z), id: 0, read: false })
    halos.add(at.clone().addScaledVector(w.dir, -0.3), new THREE.Color(0.9, 0.3, 0.15), 2.2, 0.08, null)
  }

  /** a cluster of icicles hanging from the vault over the way */
  const icicle = (m: Marker) => {
    const g = new THREE.Group()
    const ice = std(0xa3c1d1, 0.25, { emissive: 0x0c1820, transparent: true, opacity: 0.9 })
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 7; i++) {
      const h = 0.7 + rng() * 1.1
      const cone = new THREE.ConeGeometry(0.09 + rng() * 0.1, h, 5)
      cone.rotateX(Math.PI)
      cone.translate((rng() - 0.5) * 0.9, -h / 2, (rng() - 0.5) * 0.9)
      parts.push(cone)
    }
    const cap = displace(blob(0.6, 1), 0.2, 2, m.row)
    cap.scale(1.2, 0.35, 1.2)
    parts.push(cap)
    g.add(new THREE.Mesh(merge(parts), ice))
    g.position.set(m.x, 4.6, m.z)
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
    root.add(g)
    // a pale ring of frost on the ground under it: here it will fall
    const frost = new THREE.Mesh(new THREE.CircleGeometry(1.8, 18).rotateX(-Math.PI / 2), std(0x7a8c96, 1, { transparent: true, opacity: 0.18, depthWrite: false }))
    frost.position.set(m.x, 0.03, m.z)
    root.add(frost)
    halos.add(new THREE.Vector3(m.x, 4.2, m.z), new THREE.Color(0.55, 0.75, 0.9), 1.4, 0.08, null)
    ex.icicles.push({ pos: new THREE.Vector3(m.x, 0, m.z), mesh: g, fallen: false, t: 0 })
  }

  /** ice crystals glowing cold in the dark: after the vessel is given away, the only lights of the shaft */
  const crystalMat = glow(0.45, 0.85, 1.25)
  const crystal = (m: Marker) => {
    const w = wallDir(field, m.x, m.z)
    const bx = m.x + w.dir.x * Math.max(0, w.dist - 0.4)
    const bz = m.z + w.dir.z * Math.max(0, w.dist - 0.4)
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 6; i++) {
      const h = 0.4 + rng() * 0.9
      const c = new THREE.ConeGeometry(0.07 + rng() * 0.06, h, 5)
      c.translate(0, h / 2, 0)
      c.rotateX((rng() - 0.5) * 0.9)
      c.rotateZ((rng() - 0.5) * 0.9)
      c.translate((rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4)
      parts.push(c)
    }
    const mesh = new THREE.Mesh(merge(parts), crystalMat)
    mesh.position.set(bx, cx.groundY(bx, bz), bz)
    root.add(mesh)
    const light = lights.add({ pos: new THREE.Vector3(bx, 0.9, bz), color: new THREE.Color(0.45, 0.75, 1), intensity: 5, distance: 9, flicker: 0.05, on: true })
    halos.add(new THREE.Vector3(bx, 0.6, bz), new THREE.Color(0.5, 0.8, 1), 3, 0.25, light)
    emitters.push({ pos: new THREE.Vector3(bx, 0.8, bz), kind: 'sparkle', rate: 1.5, radius: 0.6, acc: 0, active: () => true })
    ex.crystals.push(light)
    field.addCircle({ x: bx, z: bz, r: 0.35, occludes: false })
  }

  /** the Eternal spring: a round bowl of white quartz and marble, boiling silver-gold water glowing from within (ASSETS 2.6) */
  const basin = (m: Marker) => {
    const quartz = std(0xd8dde0, 0.55, { map: stoneTex })
    const ringN = 16
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2
      const s = new THREE.Mesh(displace(blob(0.42, 1), 0.12, 2, i), quartz)
      s.scale.set(1.2, 0.7, 0.9)
      s.position.set(m.x + Math.cos(a) * 1.95, 0.2, m.z + Math.sin(a) * 1.95)
      s.rotation.y = -a
      s.castShadow = true
      root.add(s)
    }
    const water = new THREE.ShaderMaterial({
      uniforms: { uTime: globalUniforms.uTime, uLife: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform float uLife; varying vec2 vUv; ${GLSL_NOISE}
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float n = fbm(vUv * 7.0 + vec2(uTime * 0.25, -uTime * 0.2));
          float boil = pow(fbm(vUv * 14.0 - uTime * 0.6), 3.0);
          vec3 silver = vec3(0.9, 0.96, 1.0);
          vec3 gold = vec3(1.0, 0.82, 0.5);
          vec3 col = mix(silver, gold, n * 0.6) * (0.9 + boil * 2.6) * uLife;
          col *= smoothstep(1.0, 0.75, d) * 1.6 + 0.2;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.75, 32).rotateX(-Math.PI / 2), water)
    disc.position.set(m.x, 0.14, m.z)
    root.add(disc)
    const light = lights.add({ pos: new THREE.Vector3(m.x, 1.4, m.z), color: new THREE.Color(0.85, 0.92, 1), intensity: 16, distance: 18, flicker: 0.12, on: true })
    halos.add(new THREE.Vector3(m.x, 0.8, m.z), new THREE.Color(0.85, 0.92, 1), 7, 0.4, light)
    emitters.push({ pos: new THREE.Vector3(m.x, 0.6, m.z), kind: 'sparkle', rate: 10, radius: 1.4, acc: 0, active: () => true })
    emitters.push({ pos: new THREE.Vector3(m.x, 0.8, m.z), kind: 'smoke', rate: 2, radius: 1.2, acc: 0, active: () => true })
    field.addCircle({ x: m.x, z: m.z, r: 2.1, occludes: false })
    ex.basin = new THREE.Vector3(m.x, 0, m.z)
    ex.basinWater = water
    ex.basinLight = light
    ex.arena = new THREE.Vector3(m.x, 0, m.z)
  }

  const alley: THREE.Vector3 = new THREE.Vector3()
  {
    const zs = level.markers.filter((m) => m.ch === 'z')
    if (zs.length) alley.set(zs.reduce((s, m) => s + m.x, 0) / zs.length, 0, zs.reduce((s, m) => s + m.z, 0) / zs.length)
  }
  for (const m of level.markers) {
    switch (m.ch) {
      case 'E':
        if (cave) ochre(m)
        else {
          const g = balbal(m.x, m.z, 2.4, m.row * 7 + m.col)
          const tm = glow(0.12, 0.45, 0.45)
          const sign = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.022, 4, 14, Math.PI * 1.3), tm)
          sign.position.set(0, 1.35, 0.24)
          sign.rotation.z = Math.PI * 0.85
          g.add(sign)
          halos.add(new THREE.Vector3(m.x, 1.6, m.z), new THREE.Color(0.3, 0.95, 0.9), 1.8, 0.1, null)
          // the first one tells of Arslan, the second gives the melody of the bowls (the stones are read in order along the path)
          ex.echoes.push({ pos: new THREE.Vector3(m.x, 0, m.z), kind: 'echo', heard: false, glow: tm })
          tamgas.push({ pos: new THREE.Vector3(m.x, 0, m.z), id: 0, read: false })
        }
        break
      case 'z':
        balbal(m.x, m.z, 1.9 + rng() * 0.7, m.row * 5 + m.col, new THREE.Vector3(alley.x, 0, m.z))
        break
      case 'X':
        if (cave) {
          // Shulgen's stone at the bowl's edge
          batch.add(rocks[0], m.x, -0.15, m.z, rng() * 6, 0.9, 0.7, 0.9)
          const c = { x: m.x, z: m.z, r: 0.8, occludes: false }
          field.addCircle(c)
          stones.push(c)
          ex.shulgenSeat = new THREE.Vector3(m.x, 0, m.z)
          spawns.push(m)
        } else kurgan(m, true)
        break
      case 'Y':
        if (cave) ex.arslan = new THREE.Vector3(m.x, 0, m.z)
        else kurgan(m, false)
        break
      case 'I':
        splitShield(m)
        break
      case 'o':
        fireBowl(m)
        break
      case '!':
        cx.veilCells.push(m.row * level.cols + m.col)
        break
      case '_':
        cx.bridgeCells.push(m.row * level.cols + m.col)
        break
      case 'F':
        triggers.push({ id: 'F', pos: new THREE.Vector3(m.x, 0, m.z), fired: false })
        break
      case 'n':
        ropePost(m)
        break
      case 'j':
        altar(m)
        break
      case '}':
        caveMouth(m)
        break
      case '@':
        if (cave) ex.aisylu = new THREE.Vector3(m.x, 0, m.z)
        else ex.islets.push(new THREE.Vector3(m.x, 0, m.z))
        break
      case 'G':
      case 'R':
      case 'V':
      case '$':
        if (m.ch === 'R') {
          // the archer's stone: waist-high, he stands on it out of the kylys's reach
          batch.add(rocks[1], m.x, -0.15, m.z, rng() * 6, 1.3, 1.1, 1.3)
          const c = { x: m.x, z: m.z, r: 1.25, occludes: false }
          field.addCircle(c)
          stones.push(c)
        }
        if (m.ch === 'V') ex.arena = new THREE.Vector3(m.x, 0, m.z)
        spawns.push(m)
        break
      case '&':
        cx.addFire(m, false)
        ex.fatherArrows = new THREE.Vector3(m.x + 3.2, 0, m.z + 1.0)
        break
      case '^':
        icicle(m)
        break
      case '*':
        crystal(m)
        break
      case '{':
        basin(m)
        break
    }
  }
  // the melody balbal is the one by the black channel (the second along the path)
  if (ex.echoes.length > 1) {
    ex.echoes.sort((a, b) => b.pos.z - a.pos.z)
    ex.echoes[ex.echoes.length - 1].kind = 'melody'
  }
  // the drawbridge's rope: from the post on the island to the tip of the raised deck
  if (postTop && cx.bridgeCells.length) {
    const pt = postTop as THREE.Vector3
    const cs = cx.bridgeCells.map((ci) => ci % level.cols)
    const rs = cx.bridgeCells.map((ci) => Math.floor(ci / level.cols))
    const west = Math.min(...cs) * CELL
    const east = (Math.max(...cs) + 1) * CELL
    const zc = ((Math.min(...rs) + Math.max(...rs) + 1) / 2) * CELL
    // the raised deck's tip stands over its hinge on the island side
    const tip = new THREE.Vector3(east - Math.cos(1.2) * (east - west), Math.sin(1.2) * (east - west), zc)
    const a = pt.clone()
    const b = tip.clone()
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const len = a.distanceTo(b)
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 5), std(0x8a7350, 0.9))
    rope.position.copy(mid)
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    root.add(rope)
    ex.rope = { a, b, mesh: rope, cut: false }
    halos.add(mid.clone(), new THREE.Color(1, 0.75, 0.4), 0.9, 0.12, null)
  }
  void veilMat
  return ex
}

/** the spirits' veil: a turquoise haze in the shape of the cells it closes */
export function veilMesh(cells: number[], level: LevelData, rng: () => number) {
  const g = new THREE.Group()
  const mat = std(0x0, 1, { emissive: new THREE.Color(0.12, 0.6, 0.58), transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }) as THREE.MeshStandardMaterial
  for (const ci of cells) {
    const r = Math.floor(ci / level.cols)
    const c = ci - r * level.cols
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 1.2, 2.6 + rng() * 0.8, 3, 3), mat)
      displace(p.geometry, 0.25, 1.2, ci + i)
      p.position.set((c + 0.5) * CELL + (rng() - 0.5) * 0.6, 1.3, (r + 0.5) * CELL + (i - 1) * 0.35)
      p.rotation.y = (rng() - 0.5) * 0.4
      g.add(p)
    }
  }
  return { group: g, mat }
}

/** the drawbridge: planks on two beams, hinged at the island end and raised (rotation.z animates it down) */
export function bridgeMesh(cells: number[], level: LevelData) {
  const cs = cells.map((ci) => ci % level.cols)
  const rs = cells.map((ci) => Math.floor(ci / level.cols))
  const west = Math.min(...cs) * CELL
  const east = (Math.max(...cs) + 1) * CELL
  const z0 = Math.min(...rs) * CELL
  const z1 = (Math.max(...rs) + 1) * CELL
  const L = east - west
  const W = (z1 - z0) * 0.6
  const pivot = new THREE.Group()
  pivot.position.set(east, 0.15, (z0 + z1) / 2)
  const wood = std(0x3a2a1c, 0.95, { map: stoneTex })
  const planks: THREE.BufferGeometry[] = []
  for (let i = 0; i < Math.floor(L / 0.32); i++) {
    const p = new THREE.BoxGeometry(0.28, 0.08, W * (0.94 + ((i * 37) % 7) * 0.01))
    p.translate(-0.2 - i * 0.32, 0, 0)
    planks.push(p)
  }
  for (const k of [-1, 1]) {
    const beam = new THREE.BoxGeometry(L, 0.12, 0.14)
    beam.translate(-L / 2, -0.08, (k * W) / 2.2)
    planks.push(beam)
  }
  const deck = new THREE.Mesh(merge(planks), wood)
  deck.castShadow = true
  deck.receiveShadow = true
  pivot.add(deck)
  pivot.rotation.z = -1.2
  const g = new THREE.Group()
  g.add(pivot)
  return { group: g, pivot }
}

export const RGB_TEAL: RGB = [0.3, 0.95, 0.9]
void solid
