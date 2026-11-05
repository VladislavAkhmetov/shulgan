import * as THREE from 'three'
import type { Keepsake } from './state'
import { glow, std } from '../render/materials'

/** quiver: a pouch of arrows · keepsake: a charm · upgrade: the old quiver (5 → 8) */
export type PickupKind = 'quiver' | 'keepsake' | 'upgrade'

/** A cache taken with [E] (docs/LEVELS.md, TRG_ARROW_PICKUP): arrows, a keepsake, the old quiver. */
export interface Pickup {
  pos: THREE.Vector3
  arrows: number
  keepsake: Keepsake | null
  label: string
  kind: PickupKind
  mesh: THREE.Object3D
  taken: boolean
  onTake?: () => void
}

const leather = std(0x4a3220, 0.85)
const strap = std(0x2a1c12, 0.9)
const shaftMat = std(0x6b5236, 0.8)
const charmGlow = glow(1.6, 0.9, 0.4)
const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.32, 0.12), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })

/** a leather quiver leaning on something, a few shafts out of its mouth */
function quiverMesh(old: boolean) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.55, 8), old ? std(0x2e2218, 0.95) : leather)
  body.position.y = 0.27
  body.rotation.z = 0.35
  g.add(body)
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 4), shaftMat)
    s.position.set(0.13 + (i - 1.5) * 0.015, 0.62, (i % 2) * 0.02)
    s.rotation.z = 0.35
    g.add(s)
  }
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 4, 10), strap)
  band.rotation.set(Math.PI / 2, 0.35, 0)
  band.position.set(0.05, 0.4, 0)
  g.add(band)
  if (old) {
    // Aisylu's kind of tassel: blue wool on the old quiver too
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), std(0x2c5cb0, 0.8, { emissive: 0x0a1a3a }))
    tassel.position.set(-0.02, 0.3, 0.09)
    g.add(tassel)
  }
  g.traverse((o) => (o.castShadow = true))
  return g
}

function charmMesh() {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 16), charmGlow)
  const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), charmGlow)
  tooth.position.y = -0.11
  tooth.rotation.x = Math.PI
  g.add(ring, tooth)
  g.position.y = 0.6
  return g
}

export class Pickups {
  readonly list: Pickup[] = []
  private root = new THREE.Group()

  constructor(scene: THREE.Scene) {
    scene.add(this.root)
  }

  spawn(pos: THREE.Vector3, opts: { label: string; kind: PickupKind; arrows?: number; keepsake?: Keepsake; onTake?: () => void; hidden?: boolean }) {
    const holder = new THREE.Group()
    holder.position.set(pos.x, 0, pos.z)
    holder.add(opts.kind === 'keepsake' ? charmMesh() : quiverMesh(opts.kind === 'upgrade'))
    // a faint glint so finds read in the dark
    const h = new THREE.Mesh(new THREE.CircleGeometry(opts.kind === 'keepsake' ? 0.6 : 0.4, 16).rotateX(-Math.PI / 2), halo)
    h.position.y = 0.03
    holder.add(h)
    holder.visible = !opts.hidden
    this.root.add(holder)
    const p: Pickup = { pos: holder.position.clone(), arrows: opts.arrows ?? 0, keepsake: opts.keepsake ?? null, label: opts.label, kind: opts.kind, mesh: holder, taken: false, onTake: opts.onTake }
    this.list.push(p)
    return p
  }

  take(p: Pickup) {
    p.taken = true
    p.mesh.visible = false
  }

  update(time: number) {
    for (const p of this.list) {
      if (p.taken || p.kind !== 'keepsake') continue
      const m = p.mesh.children[0]
      m.position.y = 0.6 + Math.sin(time * 2 + p.pos.x) * 0.06
      m.rotation.y = time * 1.2
    }
  }
}
