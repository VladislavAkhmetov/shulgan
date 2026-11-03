import * as THREE from 'three'
import { Batcher, blob, displace, limb, merge, paint, solid, type RGB } from './geo'
import type { LevelData, Marker } from './map'
import type { Circle, Field } from './field'
import type { LightSource } from '../render/lights'
import { ornamentTexture, patchMaterial, std } from '../render/materials'
import { fbm, lerp, mulberry32, smoothstep, vnoise } from '../util'

/**
 * Set dressing that sells the forest: tall pines with root flares lining the path, roots
 * crossing it, needle/leaf/moss litter, fallen branches, spider webs, light halos in the mist
 * and the story props (hunter's remains, shaman birch, fallen horse, charm arches, skull stakes).
 */

// ---------------------------------------------------------------- geometry

export function pineGeo(seed: number) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const H = 9 + rng() * 2.5
  const lx = (rng() - 0.5) * 0.5
  const lz = (rng() - 0.5) * 0.5
  const top = new THREE.Vector3(lx, H, lz)
  const trunk = limb(new THREE.Vector3(0, -0.3, 0), top, 0.34, 0.11, 9)
  paint(trunk, (p) => {
    const k = smoothstep(1.5, 7, p.y)
    const n = 0.8 + vnoise(p.x * 9, p.y * 3) * 0.4
    // grey-brown bark at the foot turning to the warm orange of pine bark up high
    return [lerp(0.09, 0.32, k) * n, lerp(0.07, 0.13, k) * n, lerp(0.06, 0.06, k) * n]
  })
  parts.push(trunk)
  // root flare
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng() * 0.6
    const r = 0.8 + rng() * 0.6
    const g = limb(new THREE.Vector3(Math.cos(a) * 0.12, 0.55, Math.sin(a) * 0.12), new THREE.Vector3(Math.cos(a) * r, -0.12, Math.sin(a) * r), 0.16, 0.035, 5)
    solid(g, [0.08, 0.065, 0.05])
    parts.push(g)
  }
  // dead stubs along the trunk
  for (let i = 0; i < 6; i++) {
    const y = 3 + rng() * (H - 5)
    const a = rng() * Math.PI * 2
    const base = new THREE.Vector3(lx * (y / H), y, lz * (y / H))
    const end = base.clone().add(new THREE.Vector3(Math.cos(a) * (0.5 + rng() * 0.8), -0.1 - rng() * 0.3, Math.sin(a) * (0.5 + rng() * 0.8)))
    const g = limb(base, end, 0.045, 0.01, 4)
    solid(g, [0.11, 0.08, 0.06])
    parts.push(g)
  }
  // crown: a few flattened clumps near the top
  const n = 5 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    const b = displace(blob(1 + rng() * 0.7, 1), 0.55, 1.2, seed + i)
    b.scale(1, 0.55, 1)
    const a = rng() * Math.PI * 2
    const d = 0.4 + rng() * 1.3
    const y = H - 2.6 + rng() * 2.8
    b.translate(lx * (y / H) + Math.cos(a) * d, y, lz * (y / H) + Math.sin(a) * d)
    paint(b, (p, nn) => {
      const k = 0.5 + nn.y * 0.45 + (vnoise(p.x * 2, p.z * 2) - 0.5) * 0.3
      return [0.035 * k, 0.07 * k, 0.05 * k]
    })
    parts.push(b)
  }
  return merge(parts)
}

function rootsGeo(seed: number) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let r = 0; r < 3; r++) {
    let p = new THREE.Vector3((r - 1) * 0.25, 0.14, 0)
    let rad = 0.11 - r * 0.015
    const ang = (r - 1) * 0.35 + (rng() - 0.5) * 0.3
    const len = 1.4 + rng() * 1.2
    for (let s = 0; s < 4; s++) {
      const q = p.clone().add(new THREE.Vector3(Math.sin(ang + (rng() - 0.5) * 0.7) * (len / 4), (s === 3 ? -0.12 : (rng() - 0.6) * 0.05), Math.cos(ang) * (len / 4)))
      q.y = Math.max(-0.1, Math.min(0.16, q.y))
      parts.push(limb(p, q, rad, rad * 0.72, 5))
      p = q
      rad *= 0.72
    }
  }
  return paint(merge(parts), (p, n) => {
    const moss = smoothstep(0.4, 0.9, n.y) * 0.6
    const k = 0.75 + vnoise(p.x * 6, p.z * 6) * 0.5
    return [lerp(0.08, 0.04, moss) * k, lerp(0.06, 0.07, moss) * k, lerp(0.045, 0.03, moss) * k]
  })
}

function branchGeo(seed: number) {
  const rng = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const a = new THREE.Vector3(-0.8, 0.05, 0)
  const b = new THREE.Vector3(0.8, 0.07, (rng() - 0.5) * 0.3)
  parts.push(limb(a, b, 0.05, 0.02, 5))
  for (let i = 0; i < 4; i++) {
    const s = a.clone().lerp(b, 0.2 + rng() * 0.7)
    const e = s.clone().add(new THREE.Vector3((rng() - 0.3) * 0.5, 0.02 + rng() * 0.15, (rng() - 0.5) * 0.7))
    parts.push(limb(s, e, 0.02, 0.006, 4))
  }
  return solid(merge(parts), [0.1, 0.085, 0.07])
}

// ---------------------------------------------------------------- textures

function canvas(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const c = cv.getContext('2d')!
  draw(c, size)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function litterTexture(kind: 'needles' | 'leaves' | 'moss') {
  return canvas(256, (c, s) => {
    const cx = s / 2
    const inside = () => {
      for (;;) {
        const x = Math.random() * s
        const y = Math.random() * s
        const d = Math.hypot(x - cx, y - cx) / cx
        if (d < 1 && Math.random() > d * d) return [x, y]
      }
    }
    if (kind === 'moss') {
      for (let i = 0; i < 900; i++) {
        const [x, y] = inside()
        const r = 2 + Math.random() * 7
        c.fillStyle = `rgba(${40 + Math.random() * 30},${60 + Math.random() * 40},${25 + Math.random() * 15},${0.6 + Math.random() * 0.4})`
        c.beginPath()
        c.arc(x, y, r, 0, Math.PI * 2)
        c.fill()
      }
      return
    }
    if (kind === 'leaves') {
      for (let i = 0; i < 70; i++) {
        const [x, y] = inside()
        c.save()
        c.translate(x, y)
        c.rotate(Math.random() * Math.PI * 2)
        const g = Math.random()
        c.fillStyle = g < 0.6 ? `rgb(${170 + Math.random() * 60},${120 + Math.random() * 50},${30})` : `rgb(${110 + Math.random() * 40},${70},${25})`
        c.beginPath()
        c.ellipse(0, 0, 9 + Math.random() * 6, 5 + Math.random() * 3, 0, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = 'rgba(60,40,15,0.8)'
        c.lineWidth = 1
        c.beginPath()
        c.moveTo(-10, 0)
        c.lineTo(10, 0)
        c.stroke()
        c.restore()
      }
      return
    }
    c.lineCap = 'round'
    for (let i = 0; i < 1400; i++) {
      const [x, y] = inside()
      const a = Math.random() * Math.PI * 2
      const l = 6 + Math.random() * 10
      const v = Math.random()
      c.strokeStyle = v < 0.5 ? `rgba(${120 + Math.random() * 60},${70 + Math.random() * 30},${35},1)` : `rgba(${70 + Math.random() * 30},${50},${30},1)`
      c.lineWidth = 1.4
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      c.stroke()
    }
    for (let i = 0; i < 6; i++) {
      const [x, y] = inside()
      c.strokeStyle = 'rgba(60,45,30,1)'
      c.lineWidth = 3
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 50)
      c.stroke()
    }
  })
}

function webTexture() {
  return canvas(256, (c, s) => {
    const cx = s / 2
    c.strokeStyle = 'rgba(255,255,255,0.85)'
    c.lineWidth = 1.1
    const spokes = 13
    const ang: number[] = []
    for (let i = 0; i < spokes; i++) ang.push((i / spokes) * Math.PI * 2 + (Math.random() - 0.5) * 0.2)
    for (const a of ang) {
      c.beginPath()
      c.moveTo(cx, cx)
      c.lineTo(cx + Math.cos(a) * cx * 0.98, cx + Math.sin(a) * cx * 0.98)
      c.stroke()
    }
    for (let r = 10; r < cx * 0.95; r += 7 + Math.random() * 3) {
      c.beginPath()
      ang.forEach((a, i) => {
        const rr = r * (0.92 + Math.random() * 0.12)
        const x = cx + Math.cos(a) * rr
        const y = cx + Math.sin(a) * rr
        if (i === 0) c.moveTo(x, y)
        else c.lineTo(x, y)
      })
      c.closePath()
      c.globalAlpha = 0.5 + Math.random() * 0.4
      c.stroke()
      c.globalAlpha = 1
    }
    // torn gap
    c.globalCompositeOperation = 'destination-out'
    c.beginPath()
    c.arc(cx + 40, cx - 20, 28, 0, Math.PI * 2)
    c.fill()
  })
}

let haloTex: THREE.Texture | null = null
function haloTexture() {
  return (haloTex ??= canvas(128, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.18, 'rgba(255,255,255,0.45)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.12)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, s, s)
  }))
}

// ---------------------------------------------------------------- light halos

export interface Halo {
  sprite: THREE.Sprite
  src: LightSource | null
  color: THREE.Color
  strength: number
  seed: number
}

/** Soft light scattering in the mist around every flame and glow. */
export class Halos {
  private list: Halo[] = []
  constructor(private root: THREE.Object3D) {}

  add(pos: THREE.Vector3, color: THREE.Color, size: number, strength: number, src: LightSource | null) {
    const mat = new THREE.SpriteMaterial({ map: haloTexture(), color: color.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    const sprite = new THREE.Sprite(mat)
    sprite.position.copy(pos)
    sprite.scale.setScalar(size)
    sprite.renderOrder = 14
    this.root.add(sprite)
    const h: Halo = { sprite, src, color: color.clone(), strength, seed: Math.random() * 100 }
    this.list.push(h)
    return h
  }

  update(time: number) {
    for (const h of this.list) {
      const lvl = h.src ? h.src.level : 1
      const fl = h.src ? h.src.flicker : 0
      const t = time * 9 + h.seed
      const flick = 1 - fl * (0.15 + 0.1 * Math.sin(t) * Math.sin(t * 1.7 + 1.3))
      const k = h.strength * lvl * flick
      h.sprite.visible = k > 0.01
      ;(h.sprite.material as THREE.SpriteMaterial).color.copy(h.color).multiplyScalar(k)
    }
  }
}

// ---------------------------------------------------------------- dressing

export interface DressCtx {
  root: THREE.Group
  batch: Batcher
  field: Field
  level: LevelData
  rng: () => number
  veg: THREE.Material
  plain: THREE.Material
  triggers: { id: string; pos: THREE.Vector3; fired: boolean }[]
}

export const PINES = ['pine0', 'pine1', 'pine2']

export function registerDressing(batch: Batcher, veg: THREE.Material, plain: THREE.Material) {
  PINES.forEach((k, i) => batch.register(k, pineGeo(200 + i), veg))
  batch.register('roots0', rootsGeo(301), plain, false)
  batch.register('roots1', rootsGeo(302), plain, false)
  batch.register('branch', branchGeo(303), plain, true)
  const litter = (kind: 'needles' | 'leaves' | 'moss') =>
    new THREE.MeshStandardMaterial({
      map: litterTexture(kind),
      // litter sits in shadow under the canopy: keep it muted so it reads as texture, not as a carpet
      color: kind === 'moss' ? new THREE.Color(0.7, 0.7, 0.7) : new THREE.Color(0.42, 0.38, 0.34),
      alphaTest: 0.45,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  batch.register('litterN', quad, litter('needles'), false)
  batch.register('litterL', quad, litter('leaves'), false)
  batch.register('litterM', quad, litter('moss'), false)
  const web = new THREE.MeshStandardMaterial({
    map: webTexture(),
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.4,
    emissive: new THREE.Color(0.05, 0.06, 0.08),
  })
  batch.register('web', new THREE.PlaneGeometry(1.5, 1.5), web, false, false)
}

/** Litter, roots, branches and webs along the corridor. */
export function placeDetails(ctx: DressCtx) {
  const { batch, field, level, rng } = ctx
  const grad = (x: number, z: number) => {
    const e = 0.3
    const gx = field.sample(x + e, z) - field.sample(x - e, z)
    const gz = field.sample(x, z + e) - field.sample(x, z - e)
    return Math.atan2(gx, gz)
  }
  let webs = 0
  for (let z = 0; z < level.depth; z += 1.5) {
    for (let x = 0; x < level.width; x += 1.5) {
      const px = x + rng() * 1.5
      const pz = z + rng() * 1.5
      const sd = field.sample(px, pz)
      const r = rng()
      if (field.isWater(px, pz)) continue
      if (sd > 0.15 && sd < 6) {
        // litter carpet
        if (r < 0.32) {
          const birch = fbm(px * 0.06 + 3, pz * 0.06 - 2) > 0.58
          const kind = sd < 1.3 && rng() < 0.55 ? 'litterM' : birch && rng() < 0.7 ? 'litterL' : 'litterN'
          const s = 1.1 + rng() * 1.6
          batch.add(kind, px, 0.012 + rng() * 0.004, pz, rng() * 6.28, s, 1, s)
        } else if (r < 0.455 && sd > 0.6) {
          batch.add('branch', px, 0, pz, rng() * 6.28, 0.7 + rng() * 0.6)
        }
      } else if (sd <= -0.15 && sd > -0.8) {
        // roots reaching out of the forest wall into the path
        if (r < 0.12) batch.add(rng() < 0.5 ? 'roots0' : 'roots1', px, 0, pz, grad(px, pz), 0.9 + rng() * 0.5)
        else if (r < 0.135 && webs < 26) {
          webs++
          const a = grad(px, pz)
          batch.add('web', px + Math.sin(a) * 0.3, 1.2 + rng() * 1.2, pz + Math.cos(a) * 0.3, a, 0.8 + rng() * 0.7, 0.8 + rng() * 0.7, 1, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4)
        }
      }
    }
  }
}

// ---------------------------------------------------------------- story props

const bone = std(0xb9b09c, 0.7)
const darkCloth = std(0x241b14, 1, { side: THREE.DoubleSide })
const wood = std(0x2c2016, 0.95)
let ribbonMat: THREE.Material | null = null
const ribbon = () => (ribbonMat ??= patchMaterial(std(0xffffff, 0.9, { vertexColors: true, side: THREE.DoubleSide }), { wind: 0.3, windStart: -10 }))

function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, cast = true) {
  const o = new THREE.Mesh(g, m)
  o.castShadow = cast
  o.receiveShadow = true
  parent.add(o)
  return o
}

function skull(parent: THREE.Object3D, s: number, animal: boolean) {
  const g = displace(blob(0.12 * s, 1), 0.03 * s, 6, s * 10)
  const m = mesh(g, bone, parent)
  m.scale.set(animal ? 0.75 : 1, animal ? 0.7 : 1.05, animal ? 1.9 : 1.1)
  return m
}

function ribbons(parent: THREE.Object3D, n: number, x: number, y: number, z: number, spread: number, rng: () => number) {
  const cols: RGB[] = [
    [0.55, 0.16, 0.08],
    [0.78, 0.74, 0.64],
    [0.12, 0.25, 0.42],
    [0.62, 0.44, 0.12],
    [0.2, 0.32, 0.18],
  ]
  for (let i = 0; i < n; i++) {
    const len = 0.4 + rng() * 0.8
    const g = solid(new THREE.PlaneGeometry(0.06, len, 1, 4).translate(0, -len / 2, 0), cols[i % cols.length])
    const m = mesh(g, ribbon(), parent, false)
    m.position.set(x + (rng() - 0.5) * spread, y + (rng() - 0.5) * 0.6, z + (rng() - 0.5) * spread)
    m.rotation.y = rng() * Math.PI
  }
}

export function addStoryProp(ctx: DressCtx, m: Marker): Circle[] {
  const { root, rng, triggers } = ctx
  const g = new THREE.Group()
  g.position.set(m.x, 0, m.z)
  root.add(g)
  const circles: Circle[] = []
  switch (m.ch) {
    case 'h': {
      // a hunter of Timer's clan, fallen with his lantern out
      g.rotation.y = rng() * Math.PI * 2
      skull(g, 1, false).position.set(0, 0.1, 0.75)
      for (let i = 0; i < 6; i++) {
        const rib = mesh(new THREE.TorusGeometry(0.15 - i * 0.008, 0.012, 4, 10, Math.PI), bone, g)
        rib.position.set(0, 0.06, 0.45 - i * 0.07)
        rib.rotation.set(0, Math.PI / 2, Math.PI / 2 + 0.2)
      }
      mesh(limb(new THREE.Vector3(0, 0.05, 0.6), new THREE.Vector3(0, 0.05, -0.05), 0.02, 0.02, 4), bone, g)
      for (const [a, b] of [
        [new THREE.Vector3(0.12, 0.04, 0.5), new THREE.Vector3(0.55, 0.04, 0.75)],
        [new THREE.Vector3(-0.12, 0.04, 0.5), new THREE.Vector3(-0.35, 0.04, 0.05)],
        [new THREE.Vector3(0.08, 0.04, -0.1), new THREE.Vector3(0.25, 0.04, -0.85)],
        [new THREE.Vector3(-0.08, 0.04, -0.1), new THREE.Vector3(-0.3, 0.04, -0.8)],
      ])
        mesh(limb(a, b, 0.025, 0.02, 4), bone, g)
      const cloak = mesh(displace(new THREE.PlaneGeometry(0.9, 1.1, 4, 4), 0.08, 3, 2), darkCloth, g)
      cloak.rotation.x = -Math.PI / 2
      cloak.position.set(0.05, 0.03, 0.15)
      // broken bow and spilled arrows
      mesh(limb(new THREE.Vector3(0.7, 0.03, 0.2), new THREE.Vector3(1.2, 0.05, -0.3), 0.016, 0.012, 4), wood, g)
      mesh(limb(new THREE.Vector3(1.25, 0.03, -0.4), new THREE.Vector3(1.5, 0.08, -0.9), 0.014, 0.01, 4), wood, g)
      for (let i = 0; i < 4; i++) {
        const a = new THREE.Vector3(-0.9 + rng() * 0.5, 0, -0.2 + rng() * 0.8)
        mesh(limb(a, a.clone().add(new THREE.Vector3((rng() - 0.5) * 0.3, 0.55, (rng() - 0.5) * 0.3)), 0.008, 0.008, 3), wood, g)
      }
      // his lantern, cold
      const lan = new THREE.Group()
      lan.position.set(-0.6, 0.08, 0.9)
      lan.rotation.z = Math.PI / 2.2
      g.add(lan)
      const iron = std(0x1a1a1c, 0.5, { metalness: 0.7 })
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 4), iron, lan).position.set(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06)
      }
      mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.025, 8), iron, lan).position.y = 0.09
      mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.025, 8), iron, lan).position.y = -0.09
      triggers.push({ id: 'h', pos: g.position.clone(), fired: false })
      break
    }
    case 's': {
      // shaman birch: an old tree heavy with prayer ribbons
      const trunkM = std(0xd8d2c4, 0.8)
      const trunk = mesh(limb(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.3, 7.5, 0.2), 0.32, 0.12, 9), trunkM, g)
      void trunk
      for (let i = 0; i < 9; i++) {
        const y = 1.6 + rng() * 4.5
        const a = rng() * Math.PI * 2
        const s = new THREE.Vector3(0.04 * y, y, 0.03 * y)
        const e = s.clone().add(new THREE.Vector3(Math.cos(a) * (1 + rng() * 1.4), 0.5 + rng() * 1.2, Math.sin(a) * (1 + rng() * 1.4)))
        mesh(limb(s, e, 0.07, 0.015, 5), trunkM, g)
        ribbons(g, 5, (s.x + e.x) / 2, (s.y + e.y) / 2 - 0.05, (s.z + e.z) / 2, 0.8, rng)
      }
      // black birch-bark marks
      for (let i = 0; i < 14; i++) {
        const y = rng() * 6
        const mk = mesh(new THREE.BoxGeometry(0.2 + rng() * 0.2, 0.03 + rng() * 0.05, 0.02), std(0x111010, 1), g, false)
        const a = rng() * Math.PI * 2
        const rr = lerp(0.33, 0.13, y / 7.5)
        mk.position.set(Math.sin(a) * rr + 0.04 * y, y, Math.cos(a) * rr + 0.03 * y)
        mk.rotation.y = a
      }
      // offering stone with a horse skull
      const st = mesh(displace(blob(0.4, 1), 0.12, 3, 4), std(0x55534c, 0.95), g)
      st.scale.set(1, 0.45, 1)
      st.position.set(1.1, 0.12, 0.4)
      skull(g, 1.6, true).position.set(1.1, 0.36, 0.4)
      circles.push({ x: m.x, z: m.z, r: 0.45, occludes: true }, { x: m.x + 1.1, z: m.z + 0.4, r: 0.4, occludes: false })
      triggers.push({ id: 's', pos: g.position.clone(), fired: false })
      break
    }
    case 'H': {
      // a fallen horse of the camp, with its ornamented saddle cloth
      g.rotation.y = rng() * Math.PI * 2
      const hide = std(0x2b2019, 0.95)
      const body = mesh(new THREE.CapsuleGeometry(0.42, 1.2, 4, 10), hide, g)
      body.rotation.set(0, 0, Math.PI / 2)
      body.position.y = 0.4
      body.scale.set(1, 1, 0.85)
      const neck = mesh(limb(new THREE.Vector3(0.8, 0.45, 0), new THREE.Vector3(1.45, 0.25, 0.3), 0.2, 0.14, 7), hide, g)
      void neck
      skull(g, 2.4, true).position.set(1.65, 0.2, 0.42)
      for (const [x, z, dx, dz] of [
        [0.55, 0.25, 0.9, 0.7],
        [0.45, -0.2, 1.0, -0.8],
        [-0.6, 0.2, -0.4, 1.0],
        [-0.65, -0.2, -0.9, -0.85],
      ])
        mesh(limb(new THREE.Vector3(x, 0.35, z), new THREE.Vector3(x + dx * 0.4, 0.1, z + dz), 0.07, 0.05, 6), hide, g)
      for (let i = 0; i < 5; i++) {
        const rib = mesh(new THREE.TorusGeometry(0.36, 0.02, 4, 10, Math.PI * 0.8), bone, g)
        rib.position.set(-0.25 + i * 0.13, 0.42, 0.18)
        rib.rotation.set(Math.PI / 2, 0, 0.3)
      }
      const cloth = mesh(new THREE.PlaneGeometry(0.9, 0.7, 3, 2), std(0xffffff, 0.9, { map: ornamentTexture(), side: THREE.DoubleSide }), g)
      cloth.position.set(-0.1, 0.83, -0.05)
      cloth.rotation.set(-Math.PI / 2 + 0.25, 0, 0)
      circles.push({ x: m.x, z: m.z, r: 1.0, occludes: false })
      triggers.push({ id: 'H', pos: g.position.clone(), fired: false })
      break
    }
    case 'c': {
      // arch of charms: birch-bark amulets, bones and little bells strung across the path
      for (const sx of [-2.4, 2.4]) {
        mesh(limb(new THREE.Vector3(sx, -0.2, 0), new THREE.Vector3(sx * 0.85, 3.8, 0), 0.09, 0.06, 6), wood, g)
        circles.push({ x: m.x + sx, z: m.z, r: 0.18, occludes: false })
      }
      mesh(limb(new THREE.Vector3(-2.1, 3.6, 0), new THREE.Vector3(2.1, 3.5, 0), 0.015, 0.015, 3), std(0x6b5638, 0.9), g, false)
      const amuletCols: RGB[] = [
        [0.85, 0.8, 0.7],
        [0.7, 0.66, 0.56],
        [0.6, 0.42, 0.14],
      ]
      for (let i = 0; i < 14; i++) {
        const x = -1.9 + (i / 13) * 3.8
        const len = 0.3 + rng() * 0.6
        const str = solid(new THREE.PlaneGeometry(0.012, len, 1, 3).translate(0, -len / 2, 0), [0.35, 0.3, 0.22])
        const sm = mesh(str, ribbon(), g, false)
        sm.position.set(x, 3.55, 0)
        const charm = solid(new THREE.PlaneGeometry(0.12, 0.16, 1, 2).translate(0, -len - 0.08, 0), amuletCols[i % 3])
        const cm = mesh(charm, ribbon(), g, false)
        cm.position.set(x, 3.55, 0)
        cm.rotation.y = rng() * Math.PI
      }
      ribbons(g, 6, 0, 3.4, 0, 3.6, rng)
      break
    }
    case 'K': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng()
        const x = Math.cos(a) * 0.7
        const z = Math.sin(a) * 0.7
        const h = 1.5 + rng() * 0.8
        mesh(limb(new THREE.Vector3(x, -0.2, z), new THREE.Vector3(x * 1.2, h, z * 1.2), 0.05, 0.02, 5), wood, g)
        const sk = skull(g, i === 0 ? 1.1 : 1.8, i !== 0)
        sk.position.set(x * 1.2, h + 0.05, z * 1.2)
        sk.rotation.y = a
        circles.push({ x: m.x + x, z: m.z + z, r: 0.15, occludes: false })
      }
      ribbons(g, 4, 0, 1.4, 0, 1, rng)
      break
    }
  }
  return circles
}
