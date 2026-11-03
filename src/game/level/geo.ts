import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { fbm } from '../util'

export type RGB = [number, number, number]

// ---------------------------------------------------------------- geometry helpers

export function paint(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3) => RGB) {
  const pos = g.attributes.position
  const nor = g.attributes.normal
  const col = new Float32Array(pos.count * 3)
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i)
    if (nor) n.fromBufferAttribute(nor, i)
    const c = fn(p, n)
    col[i * 3] = c[0]
    col[i * 3 + 1] = c[1]
    col[i * 3 + 2] = c[2]
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}
export const solid = (g: THREE.BufferGeometry, c: RGB) => paint(g, () => c)

export function ensureUv(g: THREE.BufferGeometry) {
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
  return g
}

/** Smooth, welded icosphere suitable for displacement. */
export function blob(r: number, detail: number) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, detail)
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  g = mergeVertices(g)
  return g
}

export function displace(g: THREE.BufferGeometry, amt: number, freq: number, seed = 0) {
  const pos = g.attributes.position
  const p = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i)
    const n1 = fbm(p.x * freq + seed, p.z * freq + p.y * 0.7 * freq, 3) - 0.5
    const n2 = fbm(p.y * freq + 7.1 + seed, p.x * freq - p.z * freq, 3) - 0.5
    const n3 = fbm(p.z * freq - 3.3 + seed, p.y * freq + 2.2, 3) - 0.5
    pos.setXYZ(i, p.x + n1 * amt, p.y + n2 * amt, p.z + n3 * amt)
  }
  g.computeVertexNormals()
  return g
}

/** Normalise for merging: non-indexed, with uv and colour. */
export function prep(g: THREE.BufferGeometry) {
  ensureUv(g)
  if (!g.attributes.normal) g.computeVertexNormals()
  return g.index ? g.toNonIndexed() : g
}
export function merge(list: THREE.BufferGeometry[], groups = false) {
  return mergeGeometries(list.map(prep), groups)!
}

/** Cylinder from point a to point b. */
export function limb(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, seg = 6) {
  const len = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1)
  g.translate(0, len / 2, 0)
  const dir = b.clone().sub(a).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  g.applyQuaternion(q)
  g.translate(a.x, a.y, a.z)
  return g
}

// ---------------------------------------------------------------- instancing in spatial chunks

interface BatchType {
  geo: THREE.BufferGeometry
  mat: THREE.Material | THREE.Material[]
  cast: boolean
  receive: boolean
  chunks: Map<number, THREE.Matrix4[]>
}

export class Batcher {
  private types = new Map<string, BatchType>()
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()
  private s = new THREE.Vector3()
  private p = new THREE.Vector3()
  readonly chunk = 40

  register(key: string, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], cast = true, receive = true) {
    this.types.set(key, { geo, mat, cast, receive, chunks: new Map() })
  }

  add(key: string, x: number, y: number, z: number, rotY: number, sx: number, sy = sx, sz = sx, tiltX = 0, tiltZ = 0) {
    const t = this.types.get(key)!
    this.e.set(tiltX, rotY, tiltZ)
    this.q.setFromEuler(this.e)
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz))
    const ck = Math.floor(x / this.chunk) + Math.floor(z / this.chunk) * 1000
    let arr = t.chunks.get(ck)
    if (!arr) t.chunks.set(ck, (arr = []))
    arr.push(this.m.clone())
  }

  build(parent: THREE.Object3D) {
    let meshes = 0
    for (const [key, t] of this.types) {
      for (const arr of t.chunks.values()) {
        const im = new THREE.InstancedMesh(t.geo, t.mat, arr.length)
        im.name = key
        arr.forEach((m, i) => im.setMatrixAt(i, m))
        im.instanceMatrix.needsUpdate = true
        im.castShadow = t.cast
        im.receiveShadow = t.receive
        im.computeBoundingSphere()
        parent.add(im)
        meshes++
      }
    }
    return meshes
  }
}


/**
 * Small details (fingers, hair, rags, ribbons, bones) do not need to cast shadows: from the
 * isometric camera their shadows are invisible, but each one costs a draw call per shadow pass
 * (moon + 6 faces of the lantern's cube map).
 */
export function trimShadows(root: THREE.Object3D, minRadius = 0.14) {
  const s = new THREE.Vector3()
  let trimmed = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.castShadow || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return
    const g = m.geometry
    if (!g.boundingSphere) g.computeBoundingSphere()
    m.getWorldScale(s)
    const r = g.boundingSphere!.radius * Math.max(s.x, s.y, s.z)
    if (r < minRadius) {
      m.castShadow = false
      trimmed++
    }
  })
  return trimmed
}

/** Shadow layers: the lantern's cube shadow and the moon only render objects on these layers. */
export const LAYER_LANTERN_SHADOW = 4
export const LAYER_MOON_SHADOW = 5
const BIG_CASTERS = /^(spruce|pine|birch|dead|boulder)/
const MOON_ONLY = /^(bush|log)/

/** Opt shadow casters into the right light passes; small or flat things cast nothing. */
export function assignShadowLayers(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.castShadow) return
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) {
      if (BIG_CASTERS.test(m.name)) {
        m.layers.enable(LAYER_LANTERN_SHADOW)
        m.layers.enable(LAYER_MOON_SHADOW)
      } else if (MOON_ONLY.test(m.name)) m.layers.enable(LAYER_MOON_SHADOW)
      else m.castShadow = false
      return
    }
    m.layers.enable(LAYER_LANTERN_SHADOW)
    m.layers.enable(LAYER_MOON_SHADOW)
  })
}
