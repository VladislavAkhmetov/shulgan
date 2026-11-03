import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Susar's own body: a real skeleton fitted to the image-to-3D marten, and a procedural animator built for her.
 *
 * Skeleton (≈40 bones): hips → spine ×3 → chest → neck ×2 → head; hips → tail ×8; four legs of four bones each
 * (front: shoulder, elbow, wrist, paw; hind: thigh, knee, hock, paw). Joints are placed from the mesh itself.
 * Skinning: every leg is cut out of the surface by a flood fill from its sole, so a leg only ever follows its own
 * bones; weights are then smoothed over the mesh so the body bends as one soft curve.
 * Motion: feet planted by two-bone IK with a walk ↔ bound gait, a flexing spine, an S-bend into turns, a stabilised
 * head that looks at things, and a verlet tail. Poses (sit, alert, sniff, crouch, trapped) are springs on a handful
 * of body parameters, so every transition flows. docs/COMPANION.md.
 */

export type MartenPose = 'stand' | 'sit' | 'alert' | 'sniff' | 'crouch' | 'trapped'
export type LegId = 'FL' | 'FR' | 'HL' | 'HR'
const LEGS: LegId[] = ['FL', 'FR', 'HL', 'HR']

export interface MartenInput {
  /** ground speed, m/s */
  speed: number
  /** rad/s, + = turning toward +x of her body (facing increasing) */
  turnRate: number
  pose: MartenPose
  /** something to look at (world), or null to look ahead */
  look: THREE.Vector3 | null
  time: number
  /** she smells an unseen enemy: the glow brightens */
  warn: boolean
}

/** nose to tail tip, metres: larger than life so she reads from the iso camera */
export const MARTEN_LEN = 1.15
const TAIL_N = 8

// ======================================================================= helpers

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const ID = new THREE.Quaternion()
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** a critically-damped-ish spring with a touch of overshoot: the "plastic" in every transition */
class Spring {
  v = 0
  constructor(
    public x: number,
    private k = 7,
    private z = 0.78,
  ) {}
  step(target: number, dt: number) {
    const w = this.k
    this.v += (w * w * (target - this.x) - 2 * this.z * w * this.v) * dt
    this.x += this.v * dt
    return this.x
  }
}

interface Joint {
  bone: THREE.Bone
  /** rest direction toward the child joint (or end point), in the bone's own frame */
  dir: THREE.Vector3
  len: number
}

// ======================================================================= body

export interface MartenBody {
  root: THREE.Group
  mesh: THREE.SkinnedMesh
  animator: MartenAnimator
  rim: { value: THREE.Color }
  bones: THREE.Bone[]
}

export async function loadMarten(url: string): Promise<MartenBody> {
  const gltf = await new GLTFLoader().loadAsync(url)
  let src: THREE.Mesh | null = null
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o) => {
    if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh
  })
  if (!src) throw new Error('no mesh in ' + url)
  return buildMarten(src)
}

function buildMarten(srcMesh: THREE.Mesh): MartenBody {
  const geo = srcMesh.geometry.clone()
  geo.applyMatrix4(srcMesh.matrixWorld)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  const v = new THREE.Vector3()

  // ---- orientation: the long axis becomes +z with the head forward (the paws sit nearer the head: the tail is long)
  geo.computeBoundingBox()
  let bb = geo.boundingBox!
  const alongX = bb.max.x - bb.min.x > bb.max.z - bb.min.z
  const lowY = bb.min.y + (bb.max.y - bb.min.y) * 0.1
  let feet = 0
  let nFeet = 0
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i)
    if (v.y < lowY) {
      feet += alongX ? v.x : v.z
      nFeet++
    }
  }
  const mid0 = alongX ? (bb.min.x + bb.max.x) / 2 : (bb.min.z + bb.max.z) / 2
  const sgn = feet / Math.max(1, nFeet) < mid0 ? -1 : 1
  geo.rotateY(Math.atan2(-(alongX ? sgn : 0), alongX ? 0 : sgn))
  geo.computeBoundingBox()
  bb = geo.boundingBox!
  const k = MARTEN_LEN / (bb.max.z - bb.min.z)
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
  geo.scale(k, k, k)
  geo.computeBoundingBox()
  bb = geo.boundingBox!
  const L = bb.max.z - bb.min.z
  const H = bb.max.y
  const zMin = bb.min.z
  const zMax = bb.max.z
  const P = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.getX(i)
    P[i * 3 + 1] = pos.getY(i)
    P[i * 3 + 2] = pos.getZ(i)
  }
  const X = (i: number) => P[i * 3]
  const Y = (i: number) => P[i * 3 + 1]
  const Z = (i: number) => P[i * 3 + 2]

  // ---- connectivity by position (UV seams split vertices; the surface is one piece)
  const eps = L * 0.0015
  const keyOf = new Map<string, number>()
  const uid = new Int32Array(n)
  const uRep: number[] = []
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(X(i) / eps)},${Math.round(Y(i) / eps)},${Math.round(Z(i) / eps)}`
    let u = keyOf.get(key)
    if (u === undefined) {
      u = uRep.length
      keyOf.set(key, u)
      uRep.push(i)
    }
    uid[i] = u
  }
  const nu = uRep.length
  const idx = geo.index ? (geo.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i)
  const nbSets: Set<number>[] = Array.from({ length: nu }, () => new Set())
  for (let t = 0; t < idx.length; t += 3) {
    const a = uid[idx[t]]
    const b = uid[idx[t + 1]]
    const c = uid[idx[t + 2]]
    nbSets[a].add(b).add(c)
    nbSets[b].add(a).add(c)
    nbSets[c].add(a).add(b)
  }
  const nbStart = new Int32Array(nu + 1)
  for (let u = 0; u < nu; u++) nbStart[u + 1] = nbStart[u] + nbSets[u].size
  const nbList = new Int32Array(nbStart[nu])
  for (let u = 0; u < nu; u++) {
    let j = nbStart[u]
    for (const w of nbSets[u]) nbList[j++] = w
  }
  const UX = (u: number) => X(uRep[u])
  const UY = (u: number) => Y(uRep[u])
  const UZ = (u: number) => Z(uRep[u])

  // ---- body profile along z
  const halfW = (zc: number) => {
    let m = 0
    for (let u = 0; u < nu; u++) if (Math.abs(UZ(u) - zc) < L * 0.03) m = Math.max(m, Math.abs(UX(u)))
    return m || L * 0.05
  }
  const topY = (zc: number) => {
    let m = 0
    for (let u = 0; u < nu; u++) if (Math.abs(UZ(u) - zc) < L * 0.03 && UY(u) > m) m = UY(u)
    return m
  }
  /** underside of the body: lowest point of the central strip (legs hang off the sides) */
  const bellyY = (zc: number) => {
    const w = halfW(zc) * 0.3
    let m = Infinity
    for (let u = 0; u < nu; u++) if (Math.abs(UZ(u) - zc) < L * 0.03 && Math.abs(UX(u)) < w && UY(u) < m) m = UY(u)
    return m === Infinity ? H * 0.4 : m
  }
  const centerY = (zc: number) => (topY(zc) + bellyY(zc)) / 2

  // ---- feet: the lowest vertices, split front/back (k-means on z) and left/right
  const low: number[] = []
  for (let u = 0; u < nu; u++) if (UY(u) < H * 0.05) low.push(u)
  let cF = zMax - L * 0.25
  let cB = zMin + L * 0.4
  for (let it = 0; it < 8; it++) {
    let sf = 0
    let nf = 0
    let sb = 0
    let nb = 0
    for (const u of low) {
      if (Math.abs(UZ(u) - cF) < Math.abs(UZ(u) - cB)) {
        sf += UZ(u)
        nf++
      } else {
        sb += UZ(u)
        nb++
      }
    }
    if (nf) cF = sf / nf
    if (nb) cB = sb / nb
  }
  if (cF < cB) [cF, cB] = [cB, cF]
  const footOf: Record<LegId, { x: number; z: number; toe: number; seeds: number[] }> = {} as never
  for (const id of LEGS) {
    const front = id[0] === 'F'
    const side = id[1] === 'L' ? 1 : -1
    const g = low.filter((u) => Math.abs(UZ(u) - cF) < Math.abs(UZ(u) - cB) === front && UX(u) * side > 0)
    const sx = g.reduce((a, u) => a + UX(u), 0)
    const sz = g.reduce((a, u) => a + UZ(u), 0)
    const c = Math.max(1, g.length)
    footOf[id] = {
      x: g.length ? sx / c : side * L * 0.05,
      z: g.length ? sz / c : front ? cF : cB,
      toe: g.length ? Math.max(...g.map(UZ)) : (front ? cF : cB) + L * 0.03,
      seeds: g,
    }
  }

  // ---- legs cut out of the surface: flood fill from the sole up to just above the belly, on its own side
  const region = new Uint8Array(nu) // 0 torso, 1..4 legs, 5 tail
  const legTop: Record<LegId, number> = {} as never
  LEGS.forEach((id, li) => {
    const f = footOf[id]
    const side = id[1] === 'L' ? 1 : -1
    const by = bellyY(f.z)
    const ty = topY(f.z)
    const lim = by + (ty - by) * 0.22
    legTop[id] = by
    const wx = halfW(f.z) * 0.12
    const seen = new Uint8Array(nu)
    const q = [...f.seeds]
    for (const u of q) seen[u] = 1
    while (q.length) {
      const u = q.pop()!
      region[u] = li + 1
      for (let j = nbStart[u]; j < nbStart[u + 1]; j++) {
        const w = nbList[j]
        if (seen[w]) continue
        seen[w] = 1
        if (UY(w) < lim && UX(w) * side > wx && Math.abs(UZ(w) - f.z) < L * 0.17 && region[w] === 0) q.push(w)
      }
    }
  })
  // the leg's own centre line at a height
  const legAt = (li: number, h: number, fallback: THREE.Vector3) => {
    let sx = 0
    let sz = 0
    let c = 0
    for (let u = 0; u < nu; u++)
      if (region[u] === li + 1 && Math.abs(UY(u) - h) < H * 0.035) {
        sx += UX(u)
        sz += UZ(u)
        c++
      }
    return c > 3 ? new THREE.Vector3(sx / c, h, sz / c) : fallback.clone().setY(h)
  }

  // ---- the skeleton's joints
  const legJ: Record<LegId, THREE.Vector3[]> = {} as never // top, mid, low, paw, toe
  LEGS.forEach((id, li) => {
    const f = footOf[id]
    const front = id[0] === 'F'
    const lh = legTop[id]
    const base = new THREE.Vector3(f.x, 0, f.z)
    const ty = topY(f.z)
    const paw = legAt(li, H * 0.045, base)
    const lowJ = legAt(li, lh * (front ? 0.2 : 0.27), base)
    const upper = legAt(li, lh * 0.9, base)
    let midJ: THREE.Vector3
    let top: THREE.Vector3
    if (front) {
      // foreleg: the elbow sits where the leg leaves the belly, at its back edge, so the whole visible
      // forearm is one rigid bone; the shoulder joint is up and FORWARD of it (the humerus slopes down-back),
      // about as long as the forearm — the elbow is bent at rest and folds back from there
      midJ = upper.clone()
      midJ.z -= L * 0.012
      const fore = midJ.distanceTo(lowJ)
      top = midJ.clone().add(new THREE.Vector3(0, 0.8, 0.6).multiplyScalar(fore * 0.8))
      top.x = midJ.x * 0.8
      top.y = Math.min(top.y, ty - (ty - lh) * 0.2)
    } else {
      midJ = legAt(li, lh * 0.6, base)
      top = new THREE.Vector3(upper.x * 0.7, lh + (ty - lh) * 0.42, upper.z - 0.01 * L)
    }
    const toe = new THREE.Vector3(f.x, H * 0.012, Math.max(f.toe, paw.z + L * 0.02))
    legJ[id] = [top, midJ, lowJ, paw, toe]
  })
  const hipZ = (legJ.HL[0].z + legJ.HR[0].z) / 2
  const chestZ = (legJ.FL[0].z + legJ.FR[0].z) / 2
  const spineP: THREE.Vector3[] = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const z = hipZ + (chestZ - hipZ) * t
    return new THREE.Vector3(0, centerY(z), z)
  })
  const headPivotZ = zMax - L * 0.15
  const neckP = [0.38, 0.72].map((t) => {
    const z = chestZ + (headPivotZ - chestZ) * t
    return new THREE.Vector3(0, centerY(z), z)
  })
  const headP = new THREE.Vector3(0, centerY(headPivotZ), headPivotZ)
  const noseP = new THREE.Vector3(0, centerY(zMax - L * 0.025) - H * 0.02, zMax)
  // tail: where the body thins out behind the hips, then along the tail's own centre
  const thick = (z: number) => topY(z) - bellyY(z)
  const hipThick = thick(hipZ)
  let tailZ = hipZ - L * 0.04
  for (let z = hipZ - L * 0.03; z > hipZ - L * 0.3; z -= L * 0.01) {
    tailZ = z
    if (thick(z) < hipThick * 0.58) break
  }
  const tailCentre = (z: number) => {
    let sx = 0
    let sy = 0
    let c = 0
    for (let u = 0; u < nu; u++)
      if (Math.abs(UZ(u) - z) < L * 0.02) {
        sx += UX(u)
        sy += UY(u)
        c++
      }
    return c ? new THREE.Vector3(sx / c, sy / c, z) : new THREE.Vector3(0, centerY(z), z)
  }
  const tailP: THREE.Vector3[] = []
  for (let i = 0; i <= TAIL_N; i++) {
    const t = i / TAIL_N
    const z = tailZ + (zMin + L * 0.01 - tailZ) * Math.pow(t, 0.92)
    tailP.push(i === 0 ? new THREE.Vector3(0, centerY(tailZ), tailZ) : tailCentre(z))
  }
  for (let u = 0; u < nu; u++) if (region[u] === 0 && UZ(u) < tailZ) region[u] = 5
  // how thick the bushy tail is around each of its points: the fur, not the bone, rests on the ground
  const tailR = tailP.map((c) => {
    let s = 0
    let cnt = 0
    for (let u = 0; u < nu; u++)
      if (region[u] === 5 && Math.abs(UZ(u) - c.z) < L * 0.02) {
        s += Math.hypot(UX(u) - c.x, UY(u) - c.y)
        cnt++
      }
    return cnt ? s / cnt : L * 0.02
  })

  // ---- bones (rest rotations identity: a bone's rest direction is simply its child's offset)
  const root = new THREE.Group()
  root.name = 'marten'
  const bones: THREE.Bone[] = []
  const at = new Map<THREE.Bone, THREE.Vector3>()
  const mk = (name: string, p: THREE.Vector3, parent: THREE.Object3D) => {
    const b = new THREE.Bone()
    b.name = name
    const pp = parent instanceof THREE.Bone ? at.get(parent)! : new THREE.Vector3()
    b.position.copy(p).sub(pp)
    b.userData.rest = b.position.clone()
    parent.add(b)
    at.set(b, p.clone())
    bones.push(b)
    return b
  }
  const hips = mk('hips', spineP[0], root)
  const s1 = mk('spine1', spineP[1], hips)
  const s2 = mk('spine2', spineP[2], s1)
  const s3 = mk('spine3', spineP[3], s2)
  const chest = mk('chest', spineP[4], s3)
  const neck1 = mk('neck1', neckP[0], chest)
  const neck2 = mk('neck2', neckP[1], neck1)
  const head = mk('head', headP, neck2)
  const tail: THREE.Bone[] = []
  let tp: THREE.Bone = hips
  for (let i = 0; i < TAIL_N; i++) {
    tp = mk('tail' + i, tailP[i], tp)
    tail.push(tp)
  }
  const leg: Record<LegId, THREE.Bone[]> = {} as never
  for (const id of LEGS) {
    const J = legJ[id]
    const parent = id[0] === 'F' ? chest : hips
    const names = id[0] === 'F' ? ['shoulder', 'elbow', 'wrist', 'paw'] : ['thigh', 'knee', 'hock', 'paw']
    const top = mk(names[0] + id, J[0], parent)
    const midB = mk(names[1] + id, J[1], top)
    const lowB = mk(names[2] + id, J[2], midB)
    const pawB = mk(names[3] + id, J[3], lowB)
    leg[id] = [top, midB, lowB, pawB]
  }
  // the end of each chain (no bone): where the last bone points
  const ends = new Map<THREE.Bone, THREE.Vector3>([[head, noseP], [tail[TAIL_N - 1], tailP[TAIL_N]]])
  for (const id of LEGS) ends.set(leg[id][3], legJ[id][4])
  const childOf = new Map<THREE.Bone, THREE.Bone>([
    [hips, s1],
    [s1, s2],
    [s2, s3],
    [s3, chest],
    [chest, neck1],
    [neck1, neck2],
    [neck2, head],
  ])
  for (let i = 0; i < TAIL_N - 1; i++) childOf.set(tail[i], tail[i + 1])
  for (const id of LEGS) for (let i = 0; i < 3; i++) childOf.set(leg[id][i], leg[id][i + 1])
  const joint = (b: THREE.Bone): Joint => {
    const end = childOf.has(b) ? at.get(childOf.get(b)!)! : ends.get(b)!
    const d = end.clone().sub(at.get(b)!)
    return { bone: b, dir: d.clone().normalize(), len: d.length() }
  }

  // ---- skin weights
  const nb = bones.length
  const bi = (b: THREE.Bone) => bones.indexOf(b)
  const segA: THREE.Vector3[] = []
  const segB: THREE.Vector3[] = []
  for (const b of bones) {
    segA.push(at.get(b)!)
    segB.push(childOf.has(b) ? at.get(childOf.get(b)!)! : ends.get(b) ?? at.get(b)!)
  }
  // the tail starts at tail0, not at the hips: the hips segment covers the rump instead
  segA[bi(hips)] = tailP[0]
  segB[bi(hips)] = spineP[1]
  const allow: Uint8Array[] = Array.from({ length: 6 }, () => new Uint8Array(nb))
  const torsoSet = [hips, s1, s2, s3, chest, neck1, neck2, head, tail[0], leg.FL[0], leg.FR[0], leg.HL[0], leg.HR[0]]
  for (const b of torsoSet) allow[0][bi(b)] = 1
  LEGS.forEach((id, li) => {
    for (const b of leg[id]) allow[li + 1][bi(b)] = 1
    for (const b of id[0] === 'F' ? [chest, s3] : [hips, s1]) allow[li + 1][bi(b)] = 1
  })
  for (const b of [...tail, hips]) allow[5][bi(b)] = 1
  // a torso vertex may follow an upper leg bone only near that leg
  const penal = new Float32Array(nb).fill(1)
  for (const id of LEGS) penal[bi(leg[id][0])] = 1.7
  const W = new Float32Array(nu * nb)
  const ab = new THREE.Vector3()
  const ap = new THREE.Vector3()
  const pu = new THREE.Vector3()
  for (let u = 0; u < nu; u++) {
    pu.set(UX(u), UY(u), UZ(u))
    const mask = allow[region[u]]
    const cand: [number, number][] = []
    for (let b = 0; b < nb; b++) {
      if (!mask[b]) continue
      ab.subVectors(segB[b], segA[b])
      ap.subVectors(pu, segA[b])
      const l2 = ab.lengthSq()
      const t = l2 > 1e-9 ? THREE.MathUtils.clamp(ap.dot(ab) / l2, 0, 1) : 0
      // keep the opposite side out of a side bone (left shoulder never pulls the right flank)
      let d = ap.sub(ab.multiplyScalar(t)).length() * penal[b]
      if (penal[b] > 1 && segA[b].x * pu.x < 0) d *= 4
      cand.push([b, d])
    }
    cand.sort((a, b) => a[1] - b[1])
    let sum = 0
    for (let j = 0; j < Math.min(3, cand.length); j++) {
      const w = 1 / Math.pow(cand[j][1] + L * 0.012, 4)
      W[u * nb + cand[j][0]] = w
      sum += w
    }
    for (let j = 0; j < Math.min(3, cand.length); j++) W[u * nb + cand[j][0]] /= sum
  }
  // smoothing over the surface: soft, continuous bends (masked, so legs stay their own)
  const tmp = new Float32Array(nb)
  for (let it = 0; it < 10; it++) {
    for (let u = 0; u < nu; u++) {
      const mask = allow[region[u]]
      const deg = nbStart[u + 1] - nbStart[u]
      if (!deg) continue
      tmp.fill(0)
      for (let j = nbStart[u]; j < nbStart[u + 1]; j++) {
        const w = nbList[j]
        for (let b = 0; b < nb; b++) tmp[b] += W[w * nb + b]
      }
      let sum = 0
      for (let b = 0; b < nb; b++) {
        const val = mask[b] ? 0.45 * W[u * nb + b] + (0.55 * tmp[b]) / deg : 0
        W[u * nb + b] = val
        sum += val
      }
      if (sum > 0) for (let b = 0; b < nb; b++) W[u * nb + b] /= sum
    }
  }
  const skinIndex = new Uint16Array(n * 4)
  const skinWeight = new Float32Array(n * 4)
  const top4: number[] = []
  for (let i = 0; i < n; i++) {
    const u = uid[i]
    top4.length = 0
    for (let b = 0; b < nb; b++) if (W[u * nb + b] > 0.002) top4.push(b)
    top4.sort((a, b) => W[u * nb + b] - W[u * nb + a])
    let sum = 0
    for (let j = 0; j < Math.min(4, top4.length); j++) sum += W[u * nb + top4[j]]
    for (let j = 0; j < Math.min(4, top4.length); j++) {
      skinIndex[i * 4 + j] = top4[j]
      skinWeight[i * 4 + j] = W[u * nb + top4[j]] / sum
    }
    if (!top4.length) skinWeight[i * 4] = 1
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4))
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  geo.computeBoundingSphere()

  // ---- material: matte fur, a faint inner warmth and a golden rim
  const sm = srcMesh.material as THREE.MeshStandardMaterial
  const mat = new THREE.MeshStandardMaterial({
    map: sm.map,
    normalMap: sm.normalMap,
    roughness: 0.92,
    metalness: 0,
    emissive: new THREE.Color(1, 0.72, 0.42),
    emissiveMap: sm.map,
    emissiveIntensity: 0.1,
  })
  const rim = { value: new THREE.Color(0.5, 0.33, 0.13) }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = rim
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  float rimK = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);\n  totalEmissiveRadiance += uRim * rimK;',
      )
  }
  const mesh = new THREE.SkinnedMesh(geo, mat)
  mesh.castShadow = true
  mesh.frustumCulled = false
  root.add(mesh)
  root.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld)

  const animator = new MartenAnimator({
    root,
    hips: joint(hips),
    spine: [joint(s1), joint(s2), joint(s3), joint(chest)],
    neck: [joint(neck1), joint(neck2)],
    head: joint(head),
    tail: tail.map(joint),
    legs: Object.fromEntries(LEGS.map((id) => [id, leg[id].map(joint)])) as Record<LegId, Joint[]>,
    rest: {
      paw: Object.fromEntries(LEGS.map((id) => [id, legJ[id][3].clone()])) as Record<LegId, THREE.Vector3>,
      toe: Object.fromEntries(LEGS.map((id) => [id, legJ[id][4].clone()])) as Record<LegId, THREE.Vector3>,
      low: Object.fromEntries(LEGS.map((id) => [id, legJ[id][2].clone()])) as Record<LegId, THREE.Vector3>,
      hipsY: spineP[0].y,
      tail: tailP.map((p) => p.clone()),
      tailR,
      L,
      H,
    },
    rim,
  })
  return { root, mesh, animator, rim, bones }
}

// ======================================================================= animator

interface Rig {
  root: THREE.Group
  hips: Joint
  spine: Joint[]
  neck: Joint[]
  head: Joint
  tail: Joint[]
  legs: Record<LegId, Joint[]>
  rest: {
    paw: Record<LegId, THREE.Vector3>
    toe: Record<LegId, THREE.Vector3>
    low: Record<LegId, THREE.Vector3>
    hipsY: number
    tail: THREE.Vector3[]
    /** mean fur radius around each tail point */
    tailR: number[]
    L: number
    H: number
  }
  rim: { value: THREE.Color }
}

/** body parameters each pose sets; springs carry the body between them */
interface PoseParams {
  /** hips height offset, × rest hips height */
  drop: number
  /** whole-body pitch about the hips, + = nose up */
  pitch: number
  /** spine arch, + = chest up relative to the hips */
  flex: number
  /** head pitch in the world, + = nose up */
  head: number
  /** roll onto her side (trapped) */
  roll: number
  /** front paws pulled up to the chest (standing on hind legs) */
  tuck: number
  /** hind paws brought forward under the body, × length */
  hindFwd: number
  /** hind soles flat on the ground (sitting, standing up) */
  heel: number
  /** legs follow the body instead of the ground (lying) */
  limp: number
  /** tail rest pitch, + = up */
  tailLift: number
  /** chest lowered, × rest hips height (sniffing, crouching) */
  chestDrop: number
}

const POSES: Record<MartenPose, PoseParams> = {
  stand: { drop: 0, pitch: 0, flex: 0, head: 0.05, roll: 0, tuck: 0, hindFwd: 0, heel: 0, limp: 0, tailLift: 0.08, chestDrop: 0 },
  sit: { drop: -0.62, pitch: 0.62, flex: 0.18, head: 0.05, roll: 0, tuck: 0, hindFwd: 0.2, heel: 1, limp: 0, tailLift: -0.25, chestDrop: 0 },
  alert: { drop: -0.35, pitch: 1.18, flex: 0.1, head: 0.12, roll: 0, tuck: 1, hindFwd: 0.12, heel: 1, limp: 0, tailLift: -0.35, chestDrop: 0 },
  sniff: { drop: -0.05, pitch: -0.1, flex: -0.12, head: -0.85, roll: 0, tuck: 0, hindFwd: 0, heel: 0, limp: 0, tailLift: 0.15, chestDrop: 0.22 },
  crouch: { drop: -0.32, pitch: -0.04, flex: -0.08, head: -0.05, roll: 0, tuck: 0, hindFwd: 0, heel: 0.3, limp: 0, tailLift: -0.15, chestDrop: 0.3 },
  trapped: { drop: -0.62, pitch: 0, flex: 0.25, head: 0.35, roll: 1.35, tuck: 0, hindFwd: 0, heel: 0, limp: 1, tailLift: 0, chestDrop: 0 },
}
const PARAM_KEYS = Object.keys(POSES.stand) as (keyof PoseParams)[]

/**
 * The mustelid bound, read as a cat's leap. Phase 0 = the hinds touch down. Stance windows follow from the sweep
 * (no sliding), so the long flight comes from long leaps at a lower step rate.
 */
const BOUND = {
  freq0: 2.4,
  freqK: 0.14,
  /** when each paw lands (phase = 1 − offset): hinds together, forepaws together after the leap */
  offs: { HL: 0, HR: 0.06, FL: 0.42, FR: 0.36 } as Record<LegId, number>,
  /** forepaws land this far ahead of their rest spot (× sweep), hinds push off this far behind */
  frontAhead: 0.3,
  /** negative: the hinds come down ahead of their rest spot, up under the belly */
  hindBehind: -0.12,
  /** share of the hind swing spent trailing behind, stretched, before it swings forward */
  hindHold: 0.38,
  /** stretched sweep, × upper-leg length */
  swing: 1.3,
  /** the forepaw stretches out ahead late in its swing, × length */
  reach: 0.085,
  /** the carpus folds up right after lift-off; then the reach, where the paw droops off the forearm */
  frontFoldEnd: 0.55,
  /** in the reach: carpus bent down from the forearm line, and the toes further down, rad */
  droop: 0.55,
  toeDroop: 0.35,
  frontLift: 0.06,
  hindLift: 0.05,
  /** the long stretched flight after the push-off, and the short gathered one after the forepaws */
  flight: [0.2, 0.62] as [number, number],
  gatherFlight: [0.86, 1.0] as [number, number],
  /** body rise in the leap, × length */
  height: 0.075,
  /** the hump: spine bends down while the pelvis tips up */
  gatherAt: 0.97,
  hump: 1.1,
  humpPelvis: 0.38,
  stretch: 0.16,
  nose: 0.07,
  noseUpAt: 0.3,
}
/** 0 outside a..b, a smooth hill inside */
const bump = (x: number, a: number, b: number) => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)))

export class MartenAnimator {
  private rig: Rig
  private p: Record<keyof PoseParams, Spring>
  private phase = 0
  private amp = new Spring(0, 5, 1)
  private bound = new Spring(0, 3, 1)
  private turn = new Spring(0, 5, 0.9)
  private lookYaw = new Spring(0, 6, 0.85)
  private tailPts: THREE.Vector3[] = []
  private tailPrev: THREE.Vector3[] = []
  private tailReady = false
  private struggle = 0
  private wq = new THREE.Quaternion()

  constructor(rig: Rig) {
    this.rig = rig
    this.p = Object.fromEntries(PARAM_KEYS.map((k) => [k, new Spring(POSES.stand[k], k === 'roll' || k === 'limp' ? 4.5 : 6.5, 0.72)])) as Record<keyof PoseParams, Spring>
  }

  /** place her at once in a pose (no transition), e.g. lying in the trap at the start */
  snap(pose: MartenPose) {
    for (const k of PARAM_KEYS) {
      this.p[k].x = POSES[pose][k]
      this.p[k].v = 0
    }
    this.tailReady = false
  }

  update(dt: number, inp: MartenInput) {
    if (dt <= 0) return
    dt = Math.min(dt, 0.05)
    const r = this.rig
    const { L, H } = r.rest
    const target = POSES[inp.pose]
    const P = {} as Record<keyof PoseParams, number>
    for (const k of PARAM_KEYS) P[k] = this.p[k].step(target[k], dt)
    const moving = inp.pose === 'stand' || inp.pose === 'crouch'
    const speed = moving ? inp.speed : 0
    const amp = this.amp.step(smooth(0.05, 0.7, speed), dt)
    // walk → a low, gliding cat-like trot → the mustelid bound only at a real run
    const bound = this.bound.step(smooth(3.6, 5.6, speed), dt)
    const trot = smooth(1.5, 2.6, speed) * (1 - bound)
    const turn = this.turn.step(THREE.MathUtils.clamp(inp.turnRate, -5, 5), dt)
    const t = inp.time

    // ---- gait clock: short legs take quick light steps (like a cat or a weasel); the bound takes fewer, longer leaps
    const freq = THREE.MathUtils.lerp(Math.min(1.5 + speed * 0.42 + trot * 1.1, 4.6), BOUND.freq0 + speed * BOUND.freqK, bound)
    this.phase = (this.phase + dt * freq) % 1
    const ph = this.phase
    const duty = 0.62 - 0.1 * trot - 0.26 * bound
    const stride = (speed / freq) * amp
    // paws skim the ground in a walk/trot; only the bound lifts them
    const lift = (0.022 - 0.004 * trot) * L * amp * (1 - bound)
    // walk: lateral sequence; trot: diagonal pairs (FL with HR, FR with HL)
    const wt: Record<LegId, number> = { HL: 0, FL: 0.25 + 0.25 * trot, HR: 0.5, FR: 0.75 + 0.25 * trot }
    const offs = {} as Record<LegId, number>
    for (const id of LEGS) offs[id] = THREE.MathUtils.lerp(wt[id], BOUND.offs[id], bound)
    const s2 = Math.sin(ph * Math.PI * 2)
    // the bound, like a cat's leap: the hinds push off far behind and the body flies stretched out, forepaws
    // reaching ahead; the forepaws land far forward and the back gathers into a hump as the hinds swing up under
    // the chest. gather: +1 gathered (just before the hinds land), −1 stretched (mid-leap)
    const gather = Math.cos(Math.PI * 2 * (ph - BOUND.gatherAt)) * bound * amp
    const gIn = Math.max(0, gather)
    const gOut = Math.max(0, -gather)
    // walking/trotting: the back stays level, only a supple sideways S
    const flexGait = 0.015 * (1 - bound) * Math.sin(ph * Math.PI * 4) * amp - BOUND.hump * gIn + BOUND.stretch * gOut
    const leap = bump(ph, BOUND.flight[0], BOUND.flight[1]) * BOUND.height + bump(ph, BOUND.gatherFlight[0], BOUND.gatherFlight[1]) * BOUND.height * 0.25
    const bob = (0.003 * (1 - bound) * Math.cos(ph * Math.PI * 4) + leap * bound) * L * amp
    // the pelvis tips up as the back humps; nose up on the push-off, down onto the forepaws
    const pitchGait = (BOUND.humpPelvis * gIn - 0.08 * gOut + BOUND.nose * Math.cos(Math.PI * 2 * (ph - BOUND.noseUpAt))) * bound * amp
    const sway = (0.07 - 0.02 * trot) * (1 - bound) * s2 * amp
    const breath = Math.sin(t * 2.1) * 0.025 * (1 - amp)

    // trapped: now and then she tugs at the jaw of the trap
    if (inp.pose === 'trapped') {
      const cyc = (t * 0.55) % 1
      this.struggle = cyc < 0.18 ? Math.sin((cyc / 0.18) * Math.PI) : 0
    } else this.struggle *= Math.exp(-dt * 6)

    // ---- root and hips
    r.root.updateMatrixWorld(true)
    const hips = r.hips.bone
    hips.position.y = r.rest.hipsY * (1 + P.drop - 0.035 * trot * amp) + bob + this.struggle * 0.01 * L
    const lean = -turn * speed * 0.035
    hips.quaternion.setFromEuler(new THREE.Euler(-(P.pitch + pitchGait) - this.struggle * 0.12, -turn * 0.06 - sway, P.roll + lean, 'YXZ'))
    hips.updateMatrixWorld()

    // ---- spine: FK, the arch and the S of a turn spread over four bones; the chest can dip
    const arch = P.flex + flexGait + breath + this.struggle * 0.25
    const bend = turn * 0.075 + sway * 0.6
    // the hump of the bound curls mostly in the front half of the back, so the back rounds over instead of sloping
    const humpK = Math.min(1, Math.max(0, -flexGait) / BOUND.hump) * bound
    r.spine.forEach((j, i) => {
      const k = THREE.MathUtils.lerp([0.22, 0.27, 0.27, 0.24][i], [0.1, 0.22, 0.34, 0.34][i], humpK)
      const dip = i === 3 ? 0 : -P.chestDrop * 0.6 * [0.2, 0.4, 0.4][i]
      j.bone.quaternion.setFromEuler(new THREE.Euler(-(arch * k) - dip, bend * (0.8 + i * 0.25), 0, 'YXZ'))
      j.bone.updateMatrixWorld()
    })

    // ---- neck and head: the head keeps its own aim in the world, the neck takes up the difference
    const chestQ = r.spine[3].bone.getWorldQuaternion(_q)
    let wantYaw = 0
    if (inp.look) {
      const hp = r.head.bone.getWorldPosition(_v)
      const rootYaw = new THREE.Euler().setFromQuaternion(r.root.quaternion, 'YXZ').y
      wantYaw = THREE.MathUtils.clamp(Math.atan2(inp.look.x - hp.x, inp.look.z - hp.z) - rootYaw, -Math.PI, Math.PI)
      wantYaw = Math.atan2(Math.sin(wantYaw), Math.cos(wantYaw))
      wantYaw = THREE.MathUtils.clamp(wantYaw, -1.25, 1.25)
    }
    wantYaw += turn * 0.12
    const yaw = this.lookYaw.step(wantYaw, dt)
    const headWorld = this.wq.copy(r.root.getWorldQuaternion(_q2)).multiply(_q2.setFromEuler(new THREE.Euler(-P.head + this.struggle * 0.2, yaw, P.roll * 0.45, 'YXZ')))
    const rel = chestQ.clone().invert().multiply(headWorld)
    const n1 = ID.clone().slerp(rel, 0.42)
    const restAfter1 = n1.clone().invert().multiply(rel)
    const n2 = ID.clone().slerp(restAfter1, 0.5)
    const hq = n2.clone().invert().multiply(restAfter1)
    r.neck[0].bone.quaternion.copy(n1)
    r.neck[0].bone.updateMatrixWorld()
    r.neck[1].bone.quaternion.copy(n2)
    r.neck[1].bone.updateMatrixWorld()
    r.head.bone.quaternion.copy(hq)
    r.head.bone.updateMatrixWorld()

    // ---- legs: paws on the ground by IK (or following the body when she lies)
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(r.root.quaternion)
    for (const id of LEGS) {
      const front = id[0] === 'F'
      const side = id[1] === 'L' ? 1 : -1
      const j = r.legs[id]
      // gait offset for this paw. A planted paw stays put on the ground, so in stance it sweeps
      // stride × duty; that sweep is capped by what the leg can reach while staying bent — at a run the
      // stance gets shorter and a flight phase covers the rest (a bound), instead of the leg locking straight
      const lp = (ph + offs[id]) % 1
      const want = stride * duty
      // in the leap the legs may stretch almost straight (forepaws land far ahead, hinds push off far behind);
      // walking and trotting they stay bent
      const sweep = Math.min(want, THREE.MathUtils.lerp(this.maxSweep(id), this.maxSweep(id, true), bound))
      const centre = sweep * bound * (front ? BOUND.frontAhead : -BOUND.hindBehind)
      // (walk/trot never leave the ground — a short sweep just means quicker steps; only the bound flies)
      const d = want > 1e-6 ? THREE.MathUtils.lerp(duty, Math.max(duty * (sweep / want), 0.16), bound) : duty
      let gz: number
      let gy = 0
      let swing = 0
      // the forepaw's reach in the leap (0 outside it)
      let reachK = 0
      if (lp < d) gz = centre + sweep * (0.5 - lp / d)
      else {
        const u = (lp - d) / (1 - d)
        // in the leap the hinds stay stretched out behind after the push-off, then swing up under the belly late
        gz = centre + sweep * (-0.5 + THREE.MathUtils.lerp(smooth(0, 1, u), front ? smooth(0, 1, u) : smooth(BOUND.hindHold, 1, u), bound))
        // bound: the paw folds up right after it leaves the ground, then the forepaw stretches out ahead
        // (carpus open, reaching like a cat) and the hind swings up under the belly
        const fold = THREE.MathUtils.lerp(Math.sin(Math.PI * u), front ? bump(u, 0, BOUND.frontFoldEnd) : Math.sin(Math.PI * u), bound)
        gy = lift * Math.sin(Math.PI * u) + bound * amp * L * (front ? BOUND.frontLift : BOUND.hindLift) * Math.sin(Math.PI * u)
        if (front) gz += bound * amp * L * BOUND.reach * bump(u, 0.3, 1.08)
        swing = fold * amp
        if (front) reachK = smooth(BOUND.frontFoldEnd - 0.2, BOUND.frontFoldEnd + 0.05, u) * (1 - smooth(0.88, 1, u)) * bound * amp
      }
      const rp = r.rest.paw[id]
      const local = new THREE.Vector3(rp.x, rp.y + gy, rp.z + gz + (front ? 0 : P.hindFwd * L))
      if (front) local.z -= P.chestDrop * 0.05 * L
      const ground = r.root.localToWorld(local.clone())
      // where the paw would be if the leg just hung from the body (lying, or tucked)
      const topW = j[0].bone.getWorldPosition(new THREE.Vector3())
      const hang = j[0].bone.parent!.localToWorld(r.rest.paw[id].clone().sub(this.parentRest(j[0])))
      let goal = ground.clone().lerp(hang, P.limp)
      if (inp.pose === 'trapped' && id === 'FL') {
        // the caught paw, stretched toward the trap; a tug pulls it back
        const reach = j[0].len + j[1].len + j[2].len
        const dirW = fwd.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, -0.4, 0)).normalize()
        goal = topW.clone().addScaledVector(dirW, reach * (0.95 - this.struggle * 0.15))
      }
      if (front && P.tuck > 0.01) {
        // paws drawn up to the chest
        const chestW = r.spine[3].bone.getWorldPosition(new THREE.Vector3())
        const tuck = chestW.addScaledVector(new THREE.Vector3(0, -1, 0).applyQuaternion(r.spine[3].bone.getWorldQuaternion(new THREE.Quaternion())), H * 0.18)
        tuck.addScaledVector(fwd, L * 0.05)
        tuck.x += side * L * 0.025 * Math.cos(r.root.rotation.y)
        tuck.z -= side * L * 0.025 * Math.sin(r.root.rotation.y)
        goal.lerp(tuck, P.tuck)
      }
      // the last segment: carpus / metatarsus from the paw up; heels go down when she sits or stands up
      const lowRest = r.rest.low[id].clone().sub(rp)
      if (!front) lowRest.lerp(new THREE.Vector3(0, H * 0.015, -lowRest.length()), P.heel)
      // swing flexion: the hock folds the hind paw forward under it, but the carpus folds the front paw
      // BACK (pads up), the wrist leading — never a human knee bend
      lowRest.applyAxisAngle(new THREE.Vector3(1, 0, 0), front ? swing * (0.8 + 0.35 * bound) : -swing * 0.6)
      const lowW = lowRest.applyQuaternion(P.limp > 0.5 ? j[0].bone.parent!.getWorldQuaternion(new THREE.Quaternion()) : r.root.quaternion)
      let lowGoal = goal.clone().add(lowW)
      // two-bone IK for the upper limb: the elbow folds back and stays tucked to the ribs, the knee forward and a little outward
      const out = front ? 0.08 : 0.25
      const pole = fwd.clone().multiplyScalar(front ? -1 : 1).add(new THREE.Vector3(side * out * Math.cos(r.root.rotation.y), front ? -0.15 : 0, -side * out * Math.sin(r.root.rotation.y))).normalize()
      // in the bound a foreleg out ahead (the reach, the landing) is almost straight — the IK otherwise keeps a
      // 28° bend at full stretch, which read as a knee kinked down in the middle of the leg. The arc of a cat's
      // leap comes from the wrist: the paw droops off the forearm (below)
      const stretch = front ? 0.97 + 0.025 * bound : 0.97
      if (reachK > 0.001) {
        // the reach: the foreleg goes out straight toward the paw's goal
        const straight = topW.clone().addScaledVector(goal.clone().sub(topW).normalize(), (j[0].len + j[1].len) * stretch)
        lowGoal.lerp(straight, reachK)
      }
      let midP = solve2(topW, lowGoal, j[0].len, j[1].len, pole, front ? 0.3 : 0, stretch)
      // in the reach the carpus and toes hang off the forearm, folded DOWN (pads back), not level with the body.
      // Measured from where the wrist really is (the straight-leg target can lie a hair beyond reach)
      let toeReach: THREE.Vector3 | null = null
      if (reachK > 0.001) {
        const sideAx = new THREE.Vector3(1, 0, 0).applyQuaternion(r.root.quaternion)
        const fa = lowGoal.clone().sub(midP).normalize()
        lowGoal = midP.clone().addScaledVector(fa, j[1].len)
        goal = goal.clone().lerp(lowGoal.clone().addScaledVector(fa.clone().applyAxisAngle(sideAx, BOUND.droop), j[2].len), reachK)
        toeReach = fa.applyAxisAngle(sideAx, BOUND.droop + BOUND.toeDroop)
      }
      if (front) {
        // the carpus never bends forward past the forearm line (no "human knee"): when the leg trails behind,
        // the wrist joint moves back over the paw instead of the paw sliding ahead of the wrist
        const sideAx = new THREE.Vector3(1, 0, 0).applyQuaternion(r.root.quaternion)
        const l3 = j[2].len
        for (let it = 0; it < 3; it++) {
          const fa = lowGoal.clone().sub(midP).normalize()
          const pa = goal.clone().sub(lowGoal).normalize()
          const ang = Math.atan2(fa.clone().cross(pa).dot(sideAx), fa.dot(pa))
          if (ang >= -0.12) break
          lowGoal = goal.clone().addScaledVector(fa.applyAxisAngle(sideAx, -0.12), -l3)
          midP = solve2(topW, lowGoal, j[0].len, j[1].len, pole, front ? 0.3 : 0, stretch)
        }
      }
      aim(j[0], midP)
      aim(j[1], lowGoal)
      aim(j[2], goal)
      // the paw: toes point ahead, curl as the foot swings
      const toe = r.rest.toe[id].clone().sub(rp).applyAxisAngle(new THREE.Vector3(1, 0, 0), swing * (front ? 1.5 : 0.9) + P.limp * 0.5).applyQuaternion(r.root.quaternion)
      if (toeReach) toe.lerp(toeReach.multiplyScalar(toe.length()), reachK)
      aim(j[3], j[3].bone.getWorldPosition(new THREE.Vector3()).add(toe))
    }

    // ---- tail: a verlet chain that wants its rest shape, sways lazily, lags behind every move
    this.updateTail(dt, t, P.tailLift, amp, bound, turn, inp.pose === 'trapped')

    // ---- the glow breathes, brighter when she smells something
    const g = 0.5 + 0.12 * Math.sin(t * 1.7) + (inp.warn ? 0.3 : 0)
    r.rim.value.setRGB(0.5 * g, 0.33 * g, 0.13 * g)
  }

  private sweepCache: Partial<Record<string, number>> = {}
  /** the longest fore-aft paw sweep this leg allows with its knee/elbow still bent (or nearly straight: a leap) */
  private maxSweep(id: LegId, stretched = false) {
    const key = id + (stretched ? 's' : '')
    const c = this.sweepCache[key]
    if (c !== undefined) return c
    const j = this.rig.legs[id]
    const top = this.parentRest(j[0]).add(j[0].bone.userData.rest)
    const low = this.rig.rest.low[id]
    // a little beyond the rest span, well short of locking straight
    const reach = Math.max((j[0].len + j[1].len) * 0.9, top.distanceTo(low) * 1.04)
    const h = top.y - low.y
    const half = Math.sqrt(Math.max(reach * reach - h * h, 0))
    // stretched (the leap): the leg swings well past the vertical both ways; at the ends of the stance the paw is
    // on its toes (the IK can fall a hair short), which reads as the push-off and the reach
    const s = stretched ? Math.max(2 * half, (j[0].len + j[1].len) * BOUND.swing) : Math.max(2 * half, reach * 0.3)
    this.sweepCache[key] = s
    return s
  }

  /** rest position of a bone's parent (identity rest rotations: positions add up) */
  private parentRest(b: Joint) {
    const out = new THREE.Vector3()
    let o: THREE.Object3D | null = b.bone.parent
    while (o && (o as THREE.Bone).isBone) {
      out.add((o as THREE.Bone).userData.rest ?? o.position)
      o = o.parent
    }
    return out
  }

  private updateTail(dt: number, t: number, lift: number, amp: number, bound: number, turn: number, trapped: boolean) {
    const r = this.rig
    const chain = r.tail
    const N = chain.length
    const base = chain[0].bone.getWorldPosition(new THREE.Vector3())
    const hipsQ = r.hips.bone.getWorldQuaternion(new THREE.Quaternion())
    // the shape the tail wants: its rest curve, lifted, with a travelling sway
    const want: THREE.Vector3[] = [base.clone()]
    let prev = base.clone()
    const wagF = trapped ? 5 : 1.4 + bound * 2.2
    const wagA = trapped ? 0.18 : 0.16 + 0.1 * bound + 0.06 * (1 - amp)
    // the fur rests on the ground: no point of the tail sinks below its own radius
    const floor = (i: number) => r.root.position.y + r.rest.tailR[i] * 0.75
    for (let i = 0; i < N; i++) {
      const seg = r.rest.tail[i + 1].clone().sub(r.rest.tail[i])
      const len = seg.length()
      const yaw = Math.sin(t * wagF - i * 0.35) * wagA * (0.35 + 0.45 * (i / N)) - turn * 0.05 * (i / N)
      seg.normalize().applyEuler(new THREE.Euler(-lift * (0.5 + 0.6 * (i / N)), yaw, 0, 'YXZ')).applyQuaternion(hipsQ)
      const next = prev.clone().addScaledVector(seg, len)
      // a wanted shape that dives into the ground lies along it instead (so the pull never fights the floor)
      if (next.y < floor(i + 1)) {
        const dy = floor(i + 1) - prev.y
        const flat = Math.sqrt(Math.max(len * len - dy * dy, 0))
        const h = new THREE.Vector3(seg.x, 0, seg.z)
        if (h.lengthSq() < 1e-8) h.set(0, 0, -1).applyQuaternion(hipsQ).setY(0)
        next.copy(prev).addScaledVector(h.normalize(), flat).setY(prev.y + Math.min(dy, len))
      }
      prev = next
      want.push(prev)
    }
    if (!this.tailReady || this.tailPts[0].distanceTo(base) > 1.5) {
      this.tailPts = want.map((p) => p.clone())
      this.tailPrev = want.map((p) => p.clone())
      this.tailReady = true
    }
    const pts = this.tailPts
    const pr = this.tailPrev
    // a bushy tail is an elastic rod, not a flag: well damped, light, stiff right to the tip
    const damp = Math.pow(0.8, dt * 60)
    const maxBend = 0.35
    const wantDir = (i: number) => want[i].clone().sub(want[i - 1]).normalize()
    pts[0].copy(base)
    for (let i = 1; i <= N; i++) {
      const vel = pts[i].clone().sub(pr[i]).multiplyScalar(damp)
      pr[i].copy(pts[i])
      // no gravity term: the wanted shape already droops, and a dt² pull settles at a different sag every
      // uneven frame (a sub-millimetre flicker at the tip)
      pts[i].add(vel)
      // pull toward the wanted shape: stiffest at the root, still firm at the tip
      const k = 1 - Math.pow(1 - (0.36 - 0.14 * (i / N)), dt * 60)
      const goal = pts[i - 1].clone().add(want[i].clone().sub(want[i - 1]))
      pts[i].lerp(goal, k)
      // keep each segment its length
      const len = r.rest.tail[i].distanceTo(r.rest.tail[i - 1])
      const dir = pts[i].clone().sub(pts[i - 1]).normalize()
      // bending stiffness: each joint strays at most maxBend from the bend it has in the wanted shape.
      // (Measured from straight, it fought the tail's own curve: the clamp straightened, the pull bent back,
      // and the back half buzzed every frame.)
      const expected = i === 1 ? wantDir(1) : pts[i - 1].clone().sub(pts[i - 2]).normalize().applyQuaternion(_q.setFromUnitVectors(wantDir(i - 1), wantDir(i)))
      const ang = expected.angleTo(dir)
      if (ang > maxBend) dir.copy(expected).applyQuaternion(_q2.identity().slerp(_q.setFromUnitVectors(expected, dir), maxBend / ang))
      pts[i].copy(pts[i - 1]).addScaledVector(dir, len)
      if (pts[i].y < floor(i)) {
        pts[i].y = floor(i)
        // resting on the ground: no bounce off it
        pr[i].y = pts[i].y
      }
    }
    for (let i = 0; i < N; i++) aim(chain[i], pts[i + 1])
  }
}

/** turn a bone so its rest direction points at a world target (rest rotations are identity) */
function aim(j: Joint, target: THREE.Vector3) {
  const b = j.bone
  const parent = b.parent!
  parent.updateMatrixWorld()
  const from = b.getWorldPosition(new THREE.Vector3())
  const want = target.clone().sub(from)
  if (want.lengthSq() < 1e-10) return
  const pq = parent.getWorldQuaternion(new THREE.Quaternion())
  want.applyQuaternion(pq.invert()).normalize()
  b.quaternion.setFromUnitVectors(j.dir, want)
  b.updateMatrixWorld()
}

/** two-bone IK: where the middle joint goes so that a→mid→target has lengths l1, l2, bending toward the pole.
 *  The joint never locks straight (paws may fall a hair short at full stretch) nor folds flat. */
function solve2(a: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, minFold = 0, maxStretch = 0.97) {
  const d = target.clone().sub(a)
  const dist = THREE.MathUtils.clamp(d.length(), Math.max(Math.abs(l1 - l2), (l1 + l2) * minFold) + 1e-4, (l1 + l2) * maxStretch)
  const dir = d.normalize()
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
  const ortho = pole.clone().addScaledVector(dir, -pole.dot(dir))
  if (ortho.lengthSq() < 1e-8) ortho.set(0, 1, 0)
  ortho.normalize()
  return a.clone().addScaledVector(dir, cosA * l1).addScaledVector(ortho, sinA * l1)
}
