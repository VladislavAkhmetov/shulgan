import * as THREE from 'three'
import { mulberry32, smoothstep } from '../util'
import { globalUniforms } from '../render/materials'

/**
 * The mountain stream (docs/ART.md, "Вода").
 *
 * Everything that does not change at runtime is baked once into two small textures over the stream's bounding box:
 *  - data:  R = coverage (same mask that sinks the ground bed), G = distance to the bank, B = foam around stones,
 *           A = current speed (fast in the middle, lazy at the banks)
 *  - flow:  RG = downstream direction, from the geodesic distance to the stream's upper end
 * The shader advects ripples, foam lace and caustics along that flow (two-phase flow mapping), keeps three's
 * lighting and shadows, but tames the moon's mirror highlight into sparse glitter and lets the lantern and fires
 * break into warm broken streaks.
 */

export interface StreamStone {
  x: number
  z: number
  /** horizontal scale of the rock */
  s: number
  /** breaks the surface (foam ring and a wake) or lies on the bed */
  top: boolean
}

export interface Stream {
  mesh: THREE.Mesh
  stones: StreamStone[]
  /** shader knobs (for tuning from the console: __game.level.stream.uniforms) */
  uniforms: Record<string, THREE.IUniform>
  /** Feed the moon and anyone wading (foam collars and wakes). */
  update(moon: THREE.DirectionalLight, waders: { x: number; z: number }[]): void
}

const RES = 4 // texels per metre
const MAX_WADERS = 4

// ---------------------------------------------------------------- tileable noise

function periodicValue(n: number, period: number, seed: number) {
  const rnd = mulberry32(seed)
  const g = new Float32Array(period * period)
  for (let i = 0; i < g.length; i++) g[i] = rnd()
  const out = new Float32Array(n * n)
  const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * period
      const fy = (y / n) * period
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = q(fx - x0)
      const ty = q(fy - y0)
      const x1 = (x0 + 1) % period
      const y1 = (y0 + 1) % period
      const a = g[y0 * period + x0]
      const b = g[y0 * period + x1]
      const c = g[y1 * period + x0]
      const d = g[y1 * period + x1]
      out[y * n + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
    }
  return out
}

/** F2 - F1 of a wrapped cellular pattern, in cell units: 0 on the cell borders. */
function periodicCells(n: number, cells: number, seed: number) {
  const rnd = mulberry32(seed)
  const pts = new Float32Array(cells * cells * 2)
  for (let i = 0; i < pts.length; i++) pts[i] = 0.15 + rnd() * 0.7
  const out = new Float32Array(n * n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells
      const fy = (y / n) * cells
      const cx = Math.floor(fx)
      const cy = Math.floor(fy)
      let f1 = 9
      let f2 = 9
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const gx = (((cx + ox) % cells) + cells) % cells
          const gy = (((cy + oy) % cells) + cells) % cells
          const k = (gy * cells + gx) * 2
          const dx = cx + ox + pts[k] - fx
          const dy = cy + oy + pts[k + 1] - fy
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < f1) {
            f2 = f1
            f1 = d
          } else if (d < f2) f2 = d
        }
      out[y * n + x] = f2 - f1
    }
  return out
}

function dataTexture(data: Uint8Array, w: number, h: number, repeat: boolean) {
  const t = new THREE.DataTexture(data, w, h)
  t.magFilter = THREE.LinearFilter
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.anisotropy = 4
  } else {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    t.minFilter = THREE.LinearFilter
  }
  t.needsUpdate = true
  return t
}

/** Ripples: RG = slope (x, z), A = height. A blend of soft swell and sharp crests, like water over gravel. */
function rippleTexture(n = 256) {
  const o = [periodicValue(n, 3, 11), periodicValue(n, 6, 12), periodicValue(n, 12, 13)]
  const h = new Float32Array(n * n)
  for (let i = 0; i < h.length; i++) {
    const soft = o[0][i] * 0.55 + o[1][i] * 0.3 + o[2][i] * 0.15
    const crest = 1 - Math.abs(o[0][i] * 2 - 1)
    const crest2 = 1 - Math.abs(o[1][i] * 2 - 1)
    h[i] = soft * 0.55 + crest * crest * 0.3 + crest2 * crest2 * 0.15
  }
  let lo = Infinity
  let hi = -Infinity
  for (const v of h) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const gx = new Float32Array(n * n)
  const gy = new Float32Array(n * n)
  let gmax = 1e-6
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x
      gx[i] = h[y * n + ((x + 1) % n)] - h[y * n + ((x - 1 + n) % n)]
      gy[i] = h[((y + 1) % n) * n + x] - h[((y - 1 + n) % n) * n + x]
      gmax = Math.max(gmax, Math.abs(gx[i]), Math.abs(gy[i]))
    }
  const data = new Uint8Array(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = (gx[i] / gmax) * 127.5 + 127.5
    data[i * 4 + 1] = (gy[i] / gmax) * 127.5 + 127.5
    data[i * 4 + 2] = 128
    data[i * 4 + 3] = ((h[i] - lo) / (hi - lo)) * 255
  }
  return dataTexture(data, n, n, true)
}

/** Foam: R = lace (thin bubble borders), G = soft drifting patches. */
function foamTexture(n = 256) {
  const big = periodicCells(n, 9, 21)
  const small = periodicCells(n, 22, 22)
  const b0 = periodicValue(n, 4, 23)
  const b1 = periodicValue(n, 8, 24)
  const b2 = periodicValue(n, 16, 25)
  const data = new Uint8Array(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const l1 = 1 - smoothstep(0.0, 0.16, big[i])
    const l2 = 1 - smoothstep(0.0, 0.22, small[i])
    const blob = b0[i] * 0.55 + b1[i] * 0.3 + b2[i] * 0.15
    data[i * 4] = Math.min(1, Math.max(l1, l2 * 0.75) * (0.55 + blob * 0.7)) * 255
    data[i * 4 + 1] = blob * 255
    data[i * 4 + 2] = 0
    data[i * 4 + 3] = 255
  }
  return dataTexture(data, n, n, true)
}

// ---------------------------------------------------------------- the bake

/** Two-pass chamfer distance (in texels) to the nearest seed; `pass` marks texels the distance may travel through. */
function chamfer(dist: Float32Array, nx: number, nz: number, pass: Uint8Array, iterations: number) {
  const D = Math.SQRT2
  for (let it = 0; it < iterations; it++) {
    let changed = false
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        const i = z * nx + x
        if (!pass[i]) continue
        let d = dist[i]
        if (x > 0) d = Math.min(d, dist[i - 1] + 1)
        if (z > 0) {
          d = Math.min(d, dist[i - nx] + 1)
          if (x > 0) d = Math.min(d, dist[i - nx - 1] + D)
          if (x < nx - 1) d = Math.min(d, dist[i - nx + 1] + D)
        }
        if (d < dist[i]) {
          dist[i] = d
          changed = true
        }
      }
    for (let z = nz - 1; z >= 0; z--)
      for (let x = nx - 1; x >= 0; x--) {
        const i = z * nx + x
        if (!pass[i]) continue
        let d = dist[i]
        if (x < nx - 1) d = Math.min(d, dist[i + 1] + 1)
        if (z < nz - 1) {
          d = Math.min(d, dist[i + nx] + 1)
          if (x < nx - 1) d = Math.min(d, dist[i + nx + 1] + D)
          if (x > 0) d = Math.min(d, dist[i + nx - 1] + D)
        }
        if (d < dist[i]) {
          dist[i] = d
          changed = true
        }
      }
    if (!changed) break
  }
}

export interface StreamInput {
  /** water cells: [col, row] list */
  cells: [number, number][]
  cell: number
  /** 0..1 stream-bed mask, identical to the one that lowers the ground */
  bedAt: (x: number, z: number) => number
  /** the plane's height */
  level: number
  seed?: number
}

export function buildStream(inp: StreamInput): Stream | null {
  if (!inp.cells.length) return null
  const rng = mulberry32(inp.seed ?? 4242)
  let c0 = Infinity
  let c1 = -Infinity
  let r0 = Infinity
  let r1 = -Infinity
  for (const [c, r] of inp.cells) {
    c0 = Math.min(c0, c)
    c1 = Math.max(c1, c)
    r0 = Math.min(r0, r)
    r1 = Math.max(r1, r)
  }
  const x0 = c0 * inp.cell - 2
  const z0 = r0 * inp.cell - 2
  const W = (c1 + 1) * inp.cell + 2 - x0
  const D = (r1 + 1) * inp.cell + 2 - z0
  const nx = Math.ceil(W * RES)
  const nz = Math.ceil(D * RES)
  const N = nx * nz
  const tx = (i: number) => x0 + ((i % nx) + 0.5) / RES
  const tz = (i: number) => z0 + (Math.floor(i / nx) + 0.5) / RES

  // coverage and "inside" (where the bed dips under the surface)
  const wm = new Float32Array(N)
  const inside = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    wm[i] = inp.bedAt(tx(i), tz(i))
    inside[i] = wm[i] > 0.3 ? 1 : 0
  }

  // distance to the bank (metres)
  const bank = new Float32Array(N)
  for (let i = 0; i < N; i++) bank[i] = inside[i] ? 1e9 : 0
  chamfer(bank, nx, nz, inside, 2)
  for (let i = 0; i < N; i++) bank[i] = inside[i] ? Math.max(0, bank[i] - 0.5) / RES : 0

  // connected pieces of the stream; each flows from its upper (north-west) end, the way the valley falls
  const comp = new Int32Array(N).fill(-1)
  const geo = new Float32Array(N).fill(1e9)
  const proj = (i: number) => tx(i) + tz(i) * 0.6
  let nComp = 0
  for (let s = 0; s < N; s++) {
    if (!inside[s] || comp[s] >= 0) continue
    const list: number[] = [s]
    comp[s] = nComp
    for (let k = 0; k < list.length; k++) {
      const i = list[k]
      const x = i % nx
      const z = (i - x) / nx
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const zz = z + dz
          if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue
          const j = zz * nx + xx
          if (inside[j] && comp[j] < 0) {
            comp[j] = nComp
            list.push(j)
          }
        }
    }
    let lo = Infinity
    for (const i of list) lo = Math.min(lo, proj(i))
    for (const i of list) if (proj(i) < lo + 1.2) geo[i] = 0
    nComp++
  }
  chamfer(geo, nx, nz, inside, 60)

  // downstream direction = gradient of the geodesic distance, smoothed, then spread past the banks
  let fx = new Float32Array(N)
  let fz = new Float32Array(N)
  const has = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (!inside[i] || geo[i] > 1e8) continue
    const x = i % nx
    const z = (i - x) / nx
    const g = (xx: number, zz: number) => {
      if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) return geo[i]
      const j = zz * nx + xx
      return inside[j] && geo[j] < 1e8 ? geo[j] : geo[i]
    }
    const gx = g(x + 1, z) - g(x - 1, z)
    const gz = g(x, z + 1) - g(x, z - 1)
    const l = Math.hypot(gx, gz)
    if (l < 1e-4) continue
    fx[i] = gx / l
    fz[i] = gz / l
    has[i] = 1
  }
  for (let pass = 0; pass < 14; pass++) {
    const ox = new Float32Array(N)
    const oz = new Float32Array(N)
    const nh = new Uint8Array(N)
    for (let i = 0; i < N; i++) {
      const x = i % nx
      const z = (i - x) / nx
      let sx = 0
      let sz = 0
      let w = 0
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const zz = z + dz
          if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue
          const j = zz * nx + xx
          if (!has[j]) continue
          sx += fx[j]
          sz += fz[j]
          w++
        }
      if (w > 0 && (has[i] || pass > 3)) {
        const l = Math.hypot(sx, sz) || 1
        ox[i] = sx / l
        oz[i] = sz / l
        nh[i] = 1
      }
    }
    fx = ox
    fz = oz
    has.set(nh)
  }
  for (let i = 0; i < N; i++)
    if (!has[i]) {
      fx[i] = 0.86
      fz[i] = 0.5
    }
  const flowAt = (x: number, z: number): [number, number] => {
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((x - x0) * RES)))
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((z - z0) * RES)))
    const i = iz * nx + ix
    return [fx[i], fz[i]]
  }
  const sample = (arr: Float32Array, x: number, z: number) => {
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((x - x0) * RES)))
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((z - z0) * RES)))
    return arr[iz * nx + ix]
  }

  // stones: a few flat ones break the surface, gravel and pebbles lie on the bed
  const stones: StreamStone[] = []
  const insideList: number[] = []
  for (let i = 0; i < N; i++) if (inside[i]) insideList.push(i)
  const area = insideList.length / (RES * RES)
  const far = (x: number, z: number, d: number, top: boolean) => stones.every((s) => (top && !s.top) || Math.hypot(s.x - x, s.z - z) > d)
  const nTop = Math.round(area * 0.03)
  for (let tries = 0; tries < 400 && stones.filter((s) => s.top).length < nTop; tries++) {
    const i = insideList[Math.floor(rng() * insideList.length)]
    const x = tx(i) + (rng() - 0.5) / RES
    const z = tz(i) + (rng() - 0.5) / RES
    const b = bank[i]
    if (b < 0.25 || b > 2.2) continue
    if (!far(x, z, 2.6, true)) continue
    stones.push({ x, z, s: 0.26 + rng() * 0.26, top: true })
  }
  const nPeb = Math.round(area * 0.45)
  for (let tries = 0; tries < nPeb * 4 && stones.length < nTop + nPeb; tries++) {
    const i = insideList[Math.floor(rng() * insideList.length)]
    const x = tx(i) + (rng() - 0.5) / RES
    const z = tz(i) + (rng() - 0.5) / RES
    if (bank[i] < 0.15) continue
    if (stones.some((s) => Math.hypot(s.x - x, s.z - z) < (s.top ? s.s * 1.4 + 0.15 : 0.28))) continue
    stones.push({ x, z, s: 0.06 + rng() * rng() * 0.12, top: false })
  }

  // foam around the stones that break the surface: a ring at the stone, a tapering wake downstream
  const rock = new Float32Array(N)
  for (const s of stones) {
    if (!s.top) continue
    const [dx, dz] = flowAt(s.x, s.z)
    const r = s.s * 1.05
    const reach = 3.4
    const ix0 = Math.max(0, Math.floor((s.x - reach - x0) * RES))
    const ix1 = Math.min(nx - 1, Math.ceil((s.x + reach - x0) * RES))
    const iz0 = Math.max(0, Math.floor((s.z - reach - z0) * RES))
    const iz1 = Math.min(nz - 1, Math.ceil((s.z + reach - z0) * RES))
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * nx + ix
        const px = tx(i) - s.x
        const pz = tz(i) - s.z
        const d = Math.hypot(px, pz)
        const along = px * dx + pz * dz
        const across = -px * dz + pz * dx
        const ring = 1 - smoothstep(r * 0.9, r + 0.28, d)
        // the upstream face piles up water: a little more foam in front
        const pile = along < 0 ? (1 - smoothstep(r, r + 0.5, d)) * 0.35 : 0
        const wid = r * 0.7 + Math.max(along, 0) * 0.16
        const wake = along > 0 ? Math.exp(-(across * across) / (wid * wid)) * Math.exp(-along / 2.2) * 0.85 : 0
        rock[i] = Math.max(rock[i], Math.min(1, ring + pile), wake)
      }
  }

  const data = new Uint8Array(N * 4)
  const flow = new Uint8Array(N * 4)
  for (let i = 0; i < N; i++) {
    const spd = 0.4 + 0.6 * smoothstep(0.1, 1.5, bank[i])
    data[i * 4] = wm[i] * 255
    data[i * 4 + 1] = Math.min(1, bank[i] / 2) * 255
    data[i * 4 + 2] = rock[i] * 255
    data[i * 4 + 3] = spd * 255
    flow[i * 4] = fx[i] * 127.5 + 127.5
    flow[i * 4 + 1] = fz[i] * 127.5 + 127.5
    flow[i * 4 + 2] = 0
    flow[i * 4 + 3] = 255
  }
  // texture row 0 = northern edge (z0): the shader maps world xz straight onto uv
  const dataTex = dataTexture(data, nx, nz, false)
  const flowTex = dataTexture(flow, nx, nz, false)

  const waders = Array.from({ length: MAX_WADERS }, () => new THREE.Vector3(0, 0, 0))
  const uniforms = {
    uData: { value: dataTex },
    uFlow: { value: flowTex },
    uRip: { value: rippleTexture() },
    uFoamTex: { value: foamTexture() },
    uRect: { value: new THREE.Vector4(x0, z0, 1 / W, 1 / D) },
    uSky: { value: new THREE.Color(0.05, 0.07, 0.11) },
    uMoonSpec: { value: 0.07 },
    uGlitter: { value: 1 },
    uWaders: { value: waders },
    uTime: globalUniforms.uTime,
  }

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, depthWrite: false })
  mat.premultipliedAlpha = true
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')

    // capture the moon's share of the specular so the camera's built-in mirror angle never turns the stream white
    let lightsBegin = THREE.ShaderChunk.lights_fragment_begin
    const dirOpen = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'
    const rectOpen = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )'
    if (lightsBegin.includes(dirOpen) && lightsBegin.includes(rectOpen)) {
      lightsBegin = lightsBegin
        .replace(dirOpen, `vec3 wSpecPre = reflectedLight.directSpecular;\n${dirOpen}`)
        .replace(
          rectOpen,
          /* glsl */ `reflectedLight.directSpecular = wSpecPre + min((reflectedLight.directSpecular - wSpecPre) * uMoonSpec, vec3(0.3));
          #if NUM_DIR_LIGHTS > 0
            wMoonCol = directLight.color;
            wMoonDir = directLight.direction;
          #endif
          ${rectOpen}`,
        )
    }

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vWPos;
        uniform sampler2D uData; uniform sampler2D uFlow; uniform sampler2D uRip; uniform sampler2D uFoamTex;
        uniform vec4 uRect; uniform vec3 uSky; uniform float uMoonSpec; uniform float uGlitter; uniform float uTime;
        uniform vec3 uWaders[${MAX_WADERS}];`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 wUv = (vWPos.xz - uRect.xy) * uRect.zw;
        vec4 wd = texture2D(uData, wUv);
        vec2 fdir = texture2D(uFlow, wUv).rg * 2.0 - 1.0;
        float wCover = wd.r;
        float wBank = wd.g * 2.0;
        float wRock = wd.b;
        float wSpd = wd.a;
        float wEdge = smoothstep(0.3, 0.56, wCover);
        if (wEdge < 0.002) discard;

        // two-phase flow mapping: each layer slides downstream and resets while the other one is at full weight
        const float PER = 1.7;
        vec2 vel = fdir * wSpd * 0.95;
        float ph0 = fract(uTime / PER);
        float ph1 = fract(uTime / PER + 0.5);
        float wA = 1.0 - abs(1.0 - 2.0 * ph0);
        vec2 pA = vWPos.xz - vel * ph0 * PER;
        vec2 pB = vWPos.xz - vel * ph1 * PER + vec2(0.37, 0.61);

        vec4 rA1 = texture2D(uRip, pA * 0.3);
        vec4 rA2 = texture2D(uRip, pA * 0.77 + vec2(0.5, 0.2));
        vec4 rB1 = texture2D(uRip, pB * 0.3);
        vec4 rB2 = texture2D(uRip, pB * 0.77 + vec2(0.5, 0.2));
        vec2 gA = (rA1.xy * 2.0 - 1.0) * 0.8 + (rA2.xy * 2.0 - 1.0) * 0.6;
        vec2 gB = (rB1.xy * 2.0 - 1.0) * 0.8 + (rB2.xy * 2.0 - 1.0) * 0.6;
        vec2 slope = mix(gB, gA, wA);
        float h1 = mix(rB1.a, rA1.a, wA);
        float h2 = mix(rB2.a, rA2.a, wA);

        // standing chop where water tumbles over stones (does not drift: it is held by the stone)
        vec2 chop = texture2D(uRip, vWPos.xz * 1.1 + vec2(0.0, uTime * 0.21)).xy * 2.0 - 1.0;
        chop += texture2D(uRip, vWPos.xz * 0.9 - vec2(uTime * 0.17, 0.0)).xy * 2.0 - 1.0;

        // people wading: a foam collar at the legs and a narrow wake downstream
        float wWade = 0.0;
        for (int i = 0; i < ${MAX_WADERS}; i++) {
          vec3 w = uWaders[i];
          if (w.z <= 0.0) continue;
          vec2 d = vWPos.xz - w.xy;
          float along = dot(d, fdir);
          float across = dot(d, vec2(-fdir.y, fdir.x));
          float collar = (1.0 - smoothstep(0.16, 0.5, length(d))) * 0.8;
          float wid = 0.16 + max(along, 0.0) * 0.18;
          float wake = along > 0.0 ? exp(-across * across / (wid * wid)) * exp(-along / 1.2) * 0.6 : 0.0;
          wWade = max(wWade, max(collar, wake) * w.z);
        }

        float rough = (0.16 + 0.12 * wSpd) * smoothstep(0.32, 0.7, wCover);
        slope = slope * rough + chop * (wRock * 0.32 + wWade * 0.4);
        vec3 wN = normalize(vec3(-slope.x, 1.0, -slope.y));

        // foam: thin broken line at the banks, rings and wakes at stones, lace patches drifting midstream
        float lace = mix(texture2D(uFoamTex, pB * 0.7).r, texture2D(uFoamTex, pA * 0.7).r, wA);
        float blob = mix(texture2D(uFoamTex, pB * 0.16 + 0.3).g, texture2D(uFoamTex, pA * 0.16 + 0.3).g, wA);
        float bankFoam = (1.0 - smoothstep(0.0, 0.32, wBank + (blob - 0.5) * 0.45)) * smoothstep(0.25, 0.6, blob + 0.15);
        float drift = smoothstep(0.62, 0.86, blob) * 0.42 * wSpd;
        float fMask = clamp(max(max(bankFoam * 0.7, wRock * (0.75 + 0.25 * blob)), max(drift, wWade)), 0.0, 1.0);
        float foam = clamp((lace * 1.05 + fMask * 1.05 - 1.0) * 2.4, 0.0, 1.0) * smoothstep(0.03, 0.2, fMask);
        // churned white water right against the stone
        foam = max(foam, smoothstep(0.88, 1.0, wRock) * (0.45 + 0.4 * lace));

        // body: clear and gold-green over the shallows, cold teal and darker where it runs deep
        float deep = smoothstep(0.0, 1.7, wBank);
        vec3 body = mix(vec3(0.05, 0.065, 0.05), vec3(0.006, 0.022, 0.03), deep);
        float alpha = mix(0.26, 0.74, deep);
        // caustic net: ridges where the two ripple scales cross mid-height
        float caust = pow(clamp(1.0 - abs(h1 + h2 - 1.0) * 3.2, 0.0, 1.0), 5.0) * (1.0 - deep * 0.55);
        body += vec3(0.42, 0.5, 0.48) * caust * 0.28;
        alpha += caust * 0.06;

        vec3 wV = normalize(cameraPosition - vWPos);
        float wF = 0.03 + 0.97 * pow(1.0 - clamp(dot(wN, wV), 0.0, 1.0), 5.0);
        alpha = mix(alpha, 1.0, wF * 0.5);

        diffuseColor.rgb = mix(body, vec3(0.5, 0.56, 0.6), foam);
        diffuseColor.a = mix(alpha, 0.9, foam) * wEdge;
        vec3 wMoonCol = vec3(0.0);
        vec3 wMoonDir = vec3(0.0, 1.0, 0.0);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.13, 0.8, foam);')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(0.01, 0.014, 0.02) * foam;')
      .replace('#include <lights_fragment_begin>', lightsBegin)
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        /* glsl */ `
        // point lights (lantern, fires, moonbeams) keep their highlights, softly compressed so the ripples
        // still break them into streaks instead of saturating into a solid blob
        vec3 wSpec = totalSpecular * 0.9 / (1.0 + totalSpecular * 0.7) * (1.0 - foam);
        // the night sky in the ripples; near the banks the water mirrors the dark wall of the forest
        vec3 wR = reflect(-wV, wN);
        float bankDark = smoothstep(0.1, 1.3, wBank);
        vec3 wEnv = uSky * (0.35 + 0.65 * smoothstep(-0.1, 0.9, wR.y)) * wF * 2.2 * bankDark * (1.0 - foam);
        // moon glitter: sparse twinkles inside the moon's mirror lobe (view space, like the lights)
        vec3 vR = reflect(-geometryViewDir, normal);
        float lobe = pow(max(dot(vR, wMoonDir), 0.0), 18.0);
        float tw = texture2D(uRip, pA * 1.6 + vec2(0.13, 0.71)).a * texture2D(uRip, pB * 2.1 - vec2(uTime * 0.05, 0.0)).a;
        float sparkle = smoothstep(0.66, 0.86, tw);
        sparkle *= sparkle;
        vec3 wGlit = wMoonCol * lobe * (sparkle * 1.8 + 0.01) * uGlitter * (1.0 - foam) * smoothstep(0.35, 0.7, wCover);
        vec3 outgoingLight = (totalDiffuse + totalEmissiveRadiance) * diffuseColor.a + (wSpec + wEnv + wGlit) * wEdge;`,
      )
      // the output is premultiplied above
      .replace('#include <premultiplied_alpha_fragment>', '')
  }
  mat.customProgramCacheKey = () => 'mountain-stream'

  const g = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2).translate(x0 + W / 2, inp.level, z0 + D / 2)
  const mesh = new THREE.Mesh(g, mat)
  mesh.receiveShadow = true
  mesh.renderOrder = 2
  mesh.name = 'water'

  const bankAt = (x: number, z: number) => sample(bank, x, z)
  return {
    mesh,
    stones,
    uniforms,
    update(moon, list) {
      // cool sky sheen follows the clouds over the moon (and turns warm at dawn with the moon colour)
      uniforms.uSky.value.copy(moon.color).multiplyScalar(0.1 * moon.intensity)
      for (let i = 0; i < MAX_WADERS; i++) {
        const w = list[i]
        const inWater = w && w.x > x0 && w.z > z0 && w.x < x0 + W && w.z < z0 + D ? smoothstep(0.0, 0.25, bankAt(w.x, w.z)) : 0
        waders[i].set(w?.x ?? 0, w?.z ?? 0, inWater)
      }
    },
  }
}
