import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import type { Field } from '../level/field'
import { clamp, smoothstep, wrapAngle } from '../util'

const CONE_RAYS = 150
const PERI_RAYS = 72
const PX_PER_M = 4
/** light sources the mask takes into account at once (the nearest ones) */
const MAX_LIGHTS = 32

interface VisLight {
  x: number
  z: number
  /** fully seen within `full` metres, nothing past `fade` */
  full: number
  fade: number
}

/**
 * Line-of-sight vision. Every frame we raymarch a cone (where the hero looks) and a small
 * all-round "peripheral" disc through the SDF + tree occluders, rasterise the resulting fans into
 * a world-space mask covering the whole level, then temporally smooth it. The post pass samples
 * that mask with reconstructed world positions, so tall objects are masked correctly.
 *   R = currently visible (smoothed)   G = explored (memory)
 *
 * Light gates the cone (docs/GDD.md, «Свет и обзор»): past the night-eyes radius a point is seen only
 * where something lights it — fires, braziers, moon shafts, the lantern. The peripheral disc is not gated:
 * what is right next to Timer he senses in any dark.
 */
export class Vision {
  readonly min: THREE.Vector2
  readonly size: THREE.Vector2
  private fanRT: THREE.WebGLRenderTarget
  private stateA: THREE.WebGLRenderTarget
  private stateB: THREE.WebGLRenderTarget
  private fanScene = new THREE.Scene()
  private fanCam: THREE.OrthographicCamera
  private cone: FanMesh
  private peri: FanMesh
  private smoothMat: THREE.ShaderMaterial
  private smoothQuad: FullScreenQuad

  origin = new THREE.Vector2()
  dir = 0
  range = 19
  halfAngle = THREE.MathUtils.degToRad(57)
  periR = 4.6
  enabled = true
  /** night eyes: what Timer makes out with no light at all (Game ties it to the moon behind the clouds) */
  darkFull = 4
  darkFade = 8
  private lights: VisLight[] = []
  private lightU = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4())
  private lightUniforms = {
    uOrigin: { value: new THREE.Vector2() },
    uDark: { value: new THREE.Vector2(4, 8) },
    uLights: { value: this.lightU },
    uLightCount: { value: 0 },
  }

  constructor(
    private renderer: THREE.WebGLRenderer,
    private field: Field,
    width: number,
    depth: number,
  ) {
    this.min = new THREE.Vector2(0, 0)
    this.size = new THREE.Vector2(width, depth)
    const w = Math.ceil(width * PX_PER_M)
    const h = Math.ceil(depth * PX_PER_M)
    const opts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    }
    this.fanRT = new THREE.WebGLRenderTarget(w, h, opts)
    this.stateA = new THREE.WebGLRenderTarget(w, h, opts)
    this.stateB = new THREE.WebGLRenderTarget(w, h, opts)
    this.fanCam = new THREE.OrthographicCamera(0, width, depth, 0, 0.1, 10)
    this.fanCam.position.set(0, 0, 5)

    // fan vertices are world (x, z): the fragment knows where it is and how lit that place is
    const fanMat = (lightGated: boolean) =>
      new THREE.ShaderMaterial({
        uniforms: this.lightUniforms,
        defines: lightGated ? { LIGHT_GATED: 1, MAX_LIGHTS } : { MAX_LIGHTS },
        vertexShader: /* glsl */ `attribute float intensity; varying float vI; varying vec2 vW;
          void main(){ vI = intensity; vW = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec2 uOrigin; uniform vec2 uDark; uniform vec4 uLights[MAX_LIGHTS]; uniform int uLightCount;
          varying float vI; varying vec2 vW;
          void main(){
            float v = vI;
            #ifdef LIGHT_GATED
              float lit = 1.0 - smoothstep(uDark.x, uDark.y, distance(vW, uOrigin));
              for (int i = 0; i < MAX_LIGHTS; i++) {
                if (i >= uLightCount) break;
                vec4 L = uLights[i];
                lit = max(lit, 1.0 - smoothstep(L.z, L.w, distance(vW, L.xy)));
              }
              v *= lit;
            #endif
            gl_FragColor = vec4(v, v, v, 1.0);
          }`,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    this.cone = new FanMesh(CONE_RAYS, fanMat(true))
    this.peri = new FanMesh(PERI_RAYS, fanMat(false))
    this.fanScene.add(this.cone.mesh, this.peri.mesh)

    this.smoothMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tCur; uniform sampler2D tPrev; uniform vec2 uTexel; uniform float uUp; uniform float uDown;
        varying vec2 vUv;
        void main(){
          float c = texture2D(tCur, vUv).r * 4.0
            + texture2D(tCur, vUv + vec2(uTexel.x, 0.0)).r + texture2D(tCur, vUv - vec2(uTexel.x, 0.0)).r
            + texture2D(tCur, vUv + vec2(0.0, uTexel.y)).r + texture2D(tCur, vUv - vec2(0.0, uTexel.y)).r;
          c /= 8.0;
          vec2 p = texture2D(tPrev, vUv).rg;
          float r = c > p.r ? mix(p.r, c, uUp) : mix(p.r, c, uDown);
          float g = max(p.g, c * 0.98);
          gl_FragColor = vec4(r, g, 0.0, 1.0);
        }`,
      uniforms: {
        tCur: { value: this.fanRT.texture },
        tPrev: { value: null },
        uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
        uUp: { value: 0.3 },
        uDown: { value: 0.1 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.smoothQuad = new FullScreenQuad(this.smoothMat)
    this.clear()
  }

  clear() {
    const r = this.renderer
    const prev = r.getRenderTarget()
    const cc = new THREE.Color()
    r.getClearColor(cc)
    const ca = r.getClearAlpha()
    r.setClearColor(0x000000, 0)
    for (const t of [this.fanRT, this.stateA, this.stateB]) {
      r.setRenderTarget(t)
      r.clear()
    }
    r.setRenderTarget(prev)
    r.setClearColor(cc, ca)
  }

  get texture() {
    return this.stateA.texture
  }

  /** Lights for the next update: Game hands in every glowing thing each frame (level = on/off fade 0..1). */
  setLights(list: { x: number; z: number; full: number; fade: number; level: number }[]) {
    this.lights.length = 0
    for (const l of list) if (l.level > 0.02) this.lights.push({ x: l.x, z: l.z, full: l.full * l.level, fade: l.fade * l.level })
  }

  /** 0..1: how well Timer could make out (x,z) by light alone (night eyes or any lit place) */
  lightAt(x: number, z: number) {
    let lit = 1 - smoothstep(this.darkFull, this.darkFade, Math.hypot(x - this.origin.x, z - this.origin.y))
    for (const l of this.lights) {
      if (lit >= 1) break
      lit = Math.max(lit, 1 - smoothstep(l.full, l.fade, Math.hypot(x - l.x, z - l.z)))
    }
    return lit
  }

  /** Is world point (x,z) currently seen by the hero? */
  sees(x: number, z: number) {
    if (!this.enabled) return Math.hypot(x - this.origin.x, z - this.origin.y) < 40
    const dx = x - this.origin.x
    const dz = z - this.origin.y
    const d = Math.hypot(dx, dz)
    if (d > this.range) return false
    if (d > this.periR) {
      const a = Math.atan2(dx, dz)
      if (Math.abs(wrapAngle(a - this.dir)) > this.halfAngle) return false
      if (this.lightAt(x, z) < 0.3) return false
    }
    return this.field.los(this.origin.x, this.origin.y, x, z)
  }

  update(ox: number, oz: number, dir: number, dt: number) {
    this.origin.set(ox, oz)
    this.dir = dir
    this.updateLightUniforms()
    const f = this.field
    // cone
    const N = CONE_RAYS
    const rIn = this.range * 0.55
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1)
      const a = dir - this.halfAngle + u * this.halfAngle * 2
      const dx = Math.sin(a)
      const dz = Math.cos(a)
      const d = f.ray(ox, oz, dx, dz, this.range, 1.7, 0.45)
      const edge = Math.min(u, 1 - u)
      const af = smoothstep(0, 0.1, edge)
      const inner = Math.min(d, rIn)
      const iOut = af * (d <= rIn ? 1 : clamp(1 - (d - rIn) / (this.range - rIn), 0, 1))
      this.cone.setRay(i, ox, oz, dx, dz, inner, d, af, iOut)
    }
    this.cone.setCenter(ox, oz)
    this.cone.commit()
    // peripheral disc
    const M = PERI_RAYS
    const pIn = this.periR * 0.5
    for (let i = 0; i < M; i++) {
      const a = (i / M) * Math.PI * 2
      const dx = Math.sin(a)
      const dz = Math.cos(a)
      const d = f.ray(ox, oz, dx, dz, this.periR, 1.2, 0.45)
      const inner = Math.min(d, pIn)
      const iOut = d <= pIn ? 1 : clamp(1 - (d - pIn) / (this.periR - pIn), 0, 1)
      this.peri.setRay(i, ox, oz, dx, dz, inner, d, 1, iOut)
    }
    this.peri.setCenter(ox, oz)
    this.peri.commit(true)

    const r = this.renderer
    const prev = r.getRenderTarget()
    const cc = new THREE.Color()
    r.getClearColor(cc)
    const ca = r.getClearAlpha()
    r.setClearColor(0x000000, 0)
    r.setRenderTarget(this.fanRT)
    r.clear()
    r.render(this.fanScene, this.fanCam)
    r.setClearColor(cc, ca)

    this.smoothMat.uniforms.tPrev.value = this.stateA.texture
    this.smoothMat.uniforms.uUp.value = 1 - Math.exp(-16 * dt)
    this.smoothMat.uniforms.uDown.value = 1 - Math.exp(-5 * dt)
    r.setRenderTarget(this.stateB)
    this.smoothQuad.render(r)
    r.setRenderTarget(prev)
    const t = this.stateA
    this.stateA = this.stateB
    this.stateB = t
  }

  private updateLightUniforms() {
    const u = this.lightUniforms
    u.uOrigin.value.copy(this.origin)
    u.uDark.value.set(this.darkFull, Math.max(this.darkFull + 0.01, this.darkFade))
    // only lights that can reach into the cone, nearest first
    const ox = this.origin.x
    const oz = this.origin.y
    const near = this.lights
      .map((l) => ({ l, d: Math.hypot(l.x - ox, l.z - oz) - l.fade }))
      .filter((e) => e.d < this.range)
      .sort((a, b) => a.d - b.d)
    const n = Math.min(MAX_LIGHTS, near.length)
    for (let i = 0; i < n; i++) {
      const l = near[i].l
      this.lightU[i].set(l.x, l.z, l.full, Math.max(l.full + 0.01, l.fade))
    }
    u.uLightCount.value = n
  }

  dispose() {
    this.fanRT.dispose()
    this.stateA.dispose()
    this.stateB.dispose()
  }
}

/** Triangle fan with an inner ring (full intensity) and an outer ring (falloff). */
class FanMesh {
  readonly mesh: THREE.Mesh
  private pos: Float32Array
  private inten: Float32Array
  private geo: THREE.BufferGeometry

  constructor(
    private n: number,
    mat: THREE.Material,
  ) {
    // vertex 0 = centre, 1..n inner ring, n+1..2n outer ring
    const vcount = 1 + n * 2
    this.pos = new Float32Array(vcount * 3)
    this.inten = new Float32Array(vcount)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('intensity', new THREE.BufferAttribute(this.inten, 1).setUsage(THREE.DynamicDrawUsage))
    this.mesh = new THREE.Mesh(this.geo, mat)
    this.mesh.frustumCulled = false
    this.setIndex(false)
  }

  private closed = false
  private setIndex(closed: boolean) {
    const n = this.n
    const idx: number[] = []
    const segs = closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const a = 1 + i
      const b = 1 + ((i + 1) % n)
      const oa = 1 + n + i
      const ob = 1 + n + ((i + 1) % n)
      idx.push(0, a, b)
      idx.push(a, oa, ob, a, ob, b)
    }
    this.geo.setIndex(idx)
    this.closed = closed
  }

  setCenter(x: number, z: number) {
    this.pos[0] = x
    this.pos[1] = z
    this.pos[2] = 0
    this.inten[0] = 1
  }

  setRay(i: number, ox: number, oz: number, dx: number, dz: number, dIn: number, dOut: number, iIn: number, iOut: number) {
    const a = (1 + i) * 3
    this.pos[a] = ox + dx * dIn
    this.pos[a + 1] = oz + dz * dIn
    this.pos[a + 2] = 0
    this.inten[1 + i] = iIn
    const b = (1 + this.n + i) * 3
    this.pos[b] = ox + dx * dOut
    this.pos[b + 1] = oz + dz * dOut
    this.pos[b + 2] = 0
    this.inten[1 + this.n + i] = iOut
  }

  commit(closed = false) {
    if (closed !== this.closed) this.setIndex(closed)
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.intensity.needsUpdate = true
  }
}
