import * as THREE from 'three'
import { CELL, type LevelData } from './map'
import { fbm } from '../util'

export interface Circle {
  x: number
  z: number
  r: number
  /** blocks line of sight */
  occludes: boolean
  /** low over water or ground (the raised drawbridge's gap): it stops the feet, an arrow flies over it */
  low?: boolean
}

/**
 * Signed distance field of the walkable space (positive = free, metres to the forest edge),
 * plus analytic circle obstacles (boulders, great trees). Used for:
 *  - character collision (sliding along organic, noisy forest edges)
 *  - line-of-sight raymarching for the vision cone and enemy perception
 *  - a Dijkstra flow field for enemy navigation
 */
export class Field {
  readonly res = 0.5
  readonly nx: number
  readonly nz: number
  readonly sdf: Float32Array
  /** the same field for the eye: deep water stops the feet, not the gaze or an arrow (the same array without open cells) */
  readonly see: Float32Array
  readonly level: LevelData
  readonly circles: Circle[] = []
  private cellCircles: Circle[][]
  /** Extra blocked cells (gate) toggled at runtime */
  readonly blocked: Uint8Array
  readonly flow: Float32Array
  private flowTarget = -1

  constructor(level: LevelData) {
    this.level = level
    this.nx = Math.ceil(level.width / this.res)
    this.nz = Math.ceil(level.depth / this.res)
    this.cellCircles = Array.from({ length: level.cols * level.rows }, () => [])
    this.blocked = new Uint8Array(level.cols * level.rows)
    this.flow = new Float32Array(level.cols * level.rows)
    this.sdf = this.buildSdf(level.walk)
    if (level.open.some((v) => v)) {
      const seeMask = new Uint8Array(level.walk.length)
      for (let i = 0; i < seeMask.length; i++) seeMask[i] = level.walk[i] | level.open[i]
      this.see = this.buildSdf(seeMask)
    } else this.see = this.sdf
  }

  private buildSdf(free: Uint8Array) {
    const { nx, nz, res, level } = this
    const N = nx * nz
    const out = new Float32Array(N)
    const solid = new Uint8Array(N)
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * res
        const z = (j + 0.5) * res
        const c = Math.floor(x / CELL)
        const r = Math.floor(z / CELL)
        const w = c >= 0 && r >= 0 && c < level.cols && r < level.rows ? free[r * level.cols + c] : 0
        solid[j * nx + i] = w ? 0 : 1
      }
    }
    const dOut = chamfer(solid, nx, nz, 1)
    const dIn = chamfer(solid, nx, nz, 0)
    const raw = new Float32Array(N)
    for (let k = 0; k < N; k++) {
      raw[k] = solid[k] ? -(dIn[k] * res - res * 0.5) : dOut[k] * res - res * 0.5
    }
    // Organic edge: perturb with noise, then blur.
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * res
        const z = (j + 0.5) * res
        raw[j * nx + i] += (fbm(x * 0.32, z * 0.32) - 0.5) * 1.5
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let s = 0
        let n = 0
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di
            const jj = j + dj
            if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue
            s += raw[jj * nx + ii]
            n++
          }
        }
        out[j * nx + i] = s / n
      }
    }
    return out
  }

  addCircle(c: Circle) {
    this.circles.push(c)
    const { cols, rows } = this.level
    const c0 = Math.max(0, Math.floor((c.x - c.r) / CELL))
    const c1 = Math.min(cols - 1, Math.floor((c.x + c.r) / CELL))
    const r0 = Math.max(0, Math.floor((c.z - c.r) / CELL))
    const r1 = Math.min(rows - 1, Math.floor((c.z + c.r) / CELL))
    for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) this.cellCircles[r * cols + cc].push(c)
  }

  removeCircle(c: Circle) {
    const i = this.circles.indexOf(c)
    if (i >= 0) this.circles.splice(i, 1)
    for (const list of this.cellCircles) {
      const k = list.indexOf(c)
      if (k >= 0) list.splice(k, 1)
    }
  }

  /** Bilinear SDF sample in metres. Outside the map is solid. */
  sample(x: number, z: number) {
    return this.sampleOf(this.sdf, x, z)
  }

  /** the field for the eye and for arrows: deep water is open */
  seeSample(x: number, z: number) {
    return this.see === this.sdf ? this.sampleOf(this.sdf, x, z) : this.sampleOf(this.see, x, z)
  }

  /** what an arrow in flight runs into: walls and every obstacle circle, but not open water */
  seeClearance(x: number, z: number) {
    let d = this.seeSample(x, z)
    for (const c of this.circlesNear(x, z)) if (!c.low) d = Math.min(d, Math.hypot(x - c.x, z - c.z) - c.r)
    return d
  }

  /** deep water under this point (an arrow that falls here is lost) */
  isDeep(x: number, z: number) {
    const ci = this.cellOf(x, z)
    return ci >= 0 && this.level.deep[ci] === 1 && this.level.walk[ci] === 0
  }

  private sampleOf(s: Float32Array, x: number, z: number) {
    const { nx, nz, res } = this
    const fx = x / res - 0.5
    const fz = z / res - 0.5
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return -5
    const tx = fx - i
    const tz = fz - j
    const a = s[j * nx + i]
    const b = s[j * nx + i + 1]
    const c = s[(j + 1) * nx + i]
    const d = s[(j + 1) * nx + i + 1]
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz
  }

  /** Distance including circle obstacles (used for spawn checks). */
  clearance(x: number, z: number) {
    let d = this.sample(x, z)
    const list = this.circlesNear(x, z)
    for (const c of list) d = Math.min(d, Math.hypot(x - c.x, z - c.z) - c.r)
    return d
  }

  circlesNear(x: number, z: number) {
    const c = Math.floor(x / CELL)
    const r = Math.floor(z / CELL)
    if (c < 0 || r < 0 || c >= this.level.cols || r >= this.level.rows) return []
    return this.cellCircles[r * this.level.cols + c]
  }

  /** Push a circle of radius `rad` out of walls and obstacles. Returns true if it collided. */
  resolve(p: THREE.Vector3, rad: number) {
    let hit = false
    for (let it = 0; it < 3; it++) {
      const d = this.sample(p.x, p.z)
      if (d < rad) {
        const e = 0.12
        let gx = this.sample(p.x + e, p.z) - this.sample(p.x - e, p.z)
        let gz = this.sample(p.x, p.z + e) - this.sample(p.x, p.z - e)
        const gl = Math.hypot(gx, gz) || 1
        gx /= gl
        gz /= gl
        p.x += gx * (rad - d)
        p.z += gz * (rad - d)
        hit = true
      }
    }
    for (const c of this.circlesNear(p.x, p.z)) {
      const dx = p.x - c.x
      const dz = p.z - c.z
      const dist = Math.hypot(dx, dz)
      const min = c.r + rad
      if (dist < min && dist > 1e-4) {
        p.x = c.x + (dx / dist) * min
        p.z = c.z + (dz / dist) * min
        hit = true
      }
    }
    return hit
  }

  /**
   * March a ray through the field. Stops `pen` metres inside a wall (so the first row of
   * trees at a forest edge is still visible) or at the first occluding circle.
   */
  ray(ox: number, oz: number, dx: number, dz: number, maxD: number, pen: number, circleExtra = 0) {
    let t = 0
    let hitC = Infinity
    let last = -1
    const { cols, rows } = this.level
    while (t < maxD) {
      const x = ox + dx * t
      const z = oz + dz * t
      const cc = Math.floor(x / CELL)
      const rr = Math.floor(z / CELL)
      const ci = cc < 0 || rr < 0 || cc >= cols || rr >= rows ? -2 : rr * cols + cc
      if (ci !== last && ci >= 0) {
        last = ci
        for (const c of this.cellCircles[ci]) {
          if (!c.occludes) continue
          const th = rayCircle(ox, oz, dx, dz, c.x, c.z, c.r)
          if (th < hitC) hitC = th + circleExtra
        }
      }
      if (t >= hitC) return hitC
      const d = this.seeSample(x, z)
      if (d < -pen) return Math.min(t, hitC)
      t += d > 0 ? Math.min(Math.max(d * 0.9, 0.2), 0.9) : 0.2
    }
    return Math.min(maxD, hitC)
  }

  los(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax
    const dz = bz - az
    const d = Math.hypot(dx, dz)
    if (d < 0.01) return true
    return this.ray(ax, az, dx / d, dz / d, d, 0.25) >= d - 0.35
  }

  cellOf(x: number, z: number) {
    const c = Math.floor(x / CELL)
    const r = Math.floor(z / CELL)
    if (c < 0 || r < 0 || c >= this.level.cols || r >= this.level.rows) return -1
    return r * this.level.cols + c
  }

  /** Shallow water under this point (slows and splashes, docs/LEVEL.md). */
  isWater(x: number, z: number) {
    const ci = this.cellOf(x, z)
    return ci >= 0 && this.level.water[ci] === 1
  }

  passable(ci: number) {
    return ci >= 0 && this.level.walk[ci] === 1 && this.blocked[ci] === 0
  }

  /** Dijkstra flow field toward the target cell (recomputed only when the target cell changes). */
  updateFlow(x: number, z: number, force = false) {
    const target = this.cellOf(x, z)
    if (target < 0 || (target === this.flowTarget && !force)) return
    this.flowTarget = target
    const { cols, rows } = this.level
    const dist = this.flow
    dist.fill(Infinity)
    dist[target] = 0
    const heap = new MinHeap()
    heap.push(target, 0)
    while (heap.size) {
      const [cur, d] = heap.pop()
      if (d > dist[cur]) continue
      const cr = Math.floor(cur / cols)
      const cc = cur - cr * cols
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const r = cr + dr
          const c = cc + dc
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue
          const ni = r * cols + c
          if (!this.passable(ni)) continue
          if (dr && dc && (!this.passable(cr * cols + c) || !this.passable(r * cols + cc))) continue
          const nd = d + (dr && dc ? 1.414 : 1)
          if (nd < dist[ni]) {
            dist[ni] = nd
            heap.push(ni, nd)
          }
        }
      }
    }
  }

  /** Direction toward the flow target from (x,z). Writes into out (y=0). */
  flowDir(x: number, z: number, out: THREE.Vector3) {
    const ci = this.cellOf(x, z)
    const { cols } = this.level
    out.set(0, 0, 0)
    if (ci < 0 || !isFinite(this.flow[ci])) return false
    const cr = Math.floor(ci / cols)
    const cc = ci - cr * cols
    let best = this.flow[ci]
    let bi = -1
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const ni = (cr + dr) * cols + cc + dc
        if (ni < 0 || ni >= this.flow.length) continue
        if (this.flow[ni] < best) {
          best = this.flow[ni]
          bi = ni
        }
      }
    }
    if (bi < 0) return false
    const br = Math.floor(bi / cols)
    const bc = bi - br * cols
    out.set((bc + 0.5) * CELL - x, 0, (br + 0.5) * CELL - z)
    const l = out.length()
    if (l > 1e-4) out.multiplyScalar(1 / l)
    return true
  }
}

function rayCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, r: number) {
  const fx = ox - cx
  const fz = oz - cz
  const c = fx * fx + fz * fz - r * r
  if (c < 0) return Infinity // origin inside: ignore
  const b = fx * dx + fz * dz
  const disc = b * b - c
  if (disc < 0) return Infinity
  const t = -b - Math.sqrt(disc)
  return t > 0 ? t : Infinity
}

/** Two-pass chamfer distance transform (in cells) to the nearest cell whose solid flag != `of`. */
function chamfer(solid: Uint8Array, nx: number, nz: number, of: number) {
  const INF = 1e6
  const d = new Float32Array(nx * nz)
  for (let k = 0; k < d.length; k++) d[k] = solid[k] === of ? 0 : INF
  // For dOut (of=1): cells that are solid get 0, free cells measure distance to solid.
  const D = 1.4142
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      let v = d[k]
      if (i > 0) v = Math.min(v, d[k - 1] + 1)
      if (j > 0) {
        v = Math.min(v, d[k - nx] + 1)
        if (i > 0) v = Math.min(v, d[k - nx - 1] + D)
        if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + D)
      }
      d[k] = v
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i
      let v = d[k]
      if (i < nx - 1) v = Math.min(v, d[k + 1] + 1)
      if (j < nz - 1) {
        v = Math.min(v, d[k + nx] + 1)
        if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + D)
        if (i > 0) v = Math.min(v, d[k + nx - 1] + D)
      }
      d[k] = v
    }
  }
  return d
}

class MinHeap {
  private ids: number[] = []
  private ks: number[] = []
  get size() {
    return this.ids.length
  }
  push(id: number, k: number) {
    const ids = this.ids
    const ks = this.ks
    ids.push(id)
    ks.push(k)
    let i = ids.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (ks[p] <= ks[i]) break
      ;[ids[p], ids[i]] = [ids[i], ids[p]]
      ;[ks[p], ks[i]] = [ks[i], ks[p]]
      i = p
    }
  }
  pop(): [number, number] {
    const ids = this.ids
    const ks = this.ks
    const top: [number, number] = [ids[0], ks[0]]
    const lid = ids.pop()!
    const lk = ks.pop()!
    if (ids.length) {
      ids[0] = lid
      ks[0] = lk
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < ids.length && ks[l] < ks[m]) m = l
        if (r < ids.length && ks[r] < ks[m]) m = r
        if (m === i) break
        ;[ids[m], ids[i]] = [ids[i], ids[m]]
        ;[ks[m], ks[i]] = [ks[i], ks[m]]
        i = m
      }
    }
    return top
  }
}
