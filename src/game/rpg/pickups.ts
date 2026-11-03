import * as THREE from 'three'
import type { ItemId } from './data'
import { glow, std } from '../render/materials'

export type PickupKind = 'pouch' | 'amulet' | 'bottle' | 'drop'

export interface Pickup {
  pos: THREE.Vector3
  items: [ItemId, number][]
  oil: number
  label: string
  /** walked over = taken (enemy drops); otherwise F */
  auto: boolean
  kind: PickupKind
  mesh: THREE.Object3D
  taken: boolean
  onTake?: () => void
}

const leather = std(0x4a3220, 0.85)
const strap = std(0x2a1c12, 0.9)
const glass = new THREE.MeshStandardMaterial({
  color: 0x8a5a20,
  roughness: 0.2,
  metalness: 0,
  emissive: new THREE.Color(0.25, 0.12, 0.02),
})
const amuletGlow = glow(1.6, 0.9, 0.4)
const dropGlow = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0.5, 0.32, 0.12),
  transparent: true,
  opacity: 0.6,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})

function pouchMesh(scale = 1) {
  const g = new THREE.Group()
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), leather)
  bag.scale.set(1, 0.75, 0.8)
  bag.position.y = 0.12
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, 0.08, 8),
    strap,
  )
  neck.position.y = 0.25
  g.add(bag, neck)
  g.scale.setScalar(scale)
  g.traverse((o) => (o.castShadow = true))
  return g
}

function bottleMesh() {
  const g = new THREE.Group()
  const b = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 0.24, 10),
    glass,
  )
  b.position.y = 0.12
  const cork = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.035, 0.06, 6),
    strap,
  )
  cork.position.y = 0.27
  g.add(b, cork)
  g.rotation.z = 0.25
  return g
}

function amuletMesh() {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.09, 0.015, 6, 16),
    amuletGlow,
  )
  const charm = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, 0.12, 5),
    amuletGlow,
  )
  charm.position.y = -0.11
  charm.rotation.x = Math.PI
  g.add(ring, charm)
  g.position.y = 0.6
  return g
}

/** Things to pick up: story finds, caches, enemy drops. */
export class Pickups {
  readonly list: Pickup[] = []
  private root = new THREE.Group()

  constructor(scene: THREE.Scene) {
    scene.add(this.root)
  }

  spawn(
    pos: THREE.Vector3,
    items: [ItemId, number][],
    opts: { label: string; kind: PickupKind; oil?: number; onTake?: () => void },
  ) {
    const holder = new THREE.Group()
    holder.position.set(pos.x, 0, pos.z)
    let mesh: THREE.Object3D
    if (opts.kind === 'amulet') mesh = amuletMesh()
    else if (opts.kind === 'bottle') mesh = bottleMesh()
    else mesh = pouchMesh(opts.kind === 'drop' ? 0.7 : 1)
    holder.add(mesh)
    // a faint glint so finds read in the dark
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(opts.kind === 'amulet' ? 0.6 : 0.35, 16).rotateX(
        -Math.PI / 2,
      ),
      dropGlow,
    )
    halo.position.y = 0.03
    holder.add(halo)
    this.root.add(holder)
    const p: Pickup = {
      pos: holder.position.clone(),
      items,
      oil: opts.oil ?? 0,
      label: opts.label,
      auto: opts.kind === 'drop',
      kind: opts.kind,
      mesh: holder,
      taken: false,
      onTake: opts.onTake,
    }
    this.list.push(p)
    return p
  }

  take(p: Pickup) {
    p.taken = true
    p.mesh.visible = false
  }

  update(time: number) {
    for (const p of this.list) {
      if (p.taken || p.kind !== 'amulet') continue
      const m = p.mesh.children[0]
      m.position.y = 0.6 + Math.sin(time * 2 + p.pos.x) * 0.06
      m.rotation.y = time * 1.2
    }
  }
}
