import * as THREE from 'three'
import { GLSL_NOISE, rand } from '../util'

export const projScale = { value: 600 }

export interface SpawnOpts {
  x: number
  y: number
  z: number
  vx?: number
  vy?: number
  vz?: number
  r: number
  g: number
  b: number
  a?: number
  size: number
  life: number
  drag?: number
  gravity?: number
  grow?: number
}

/** CPU-simulated pooled point sprites. */
export class Particles {
  readonly points: THREE.Points
  private pos: Float32Array
  private col: Float32Array
  private size: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private maxLife: Float32Array
  private baseA: Float32Array
  private baseSize: Float32Array
  private drag: Float32Array
  private grav: Float32Array
  private grow: Float32Array
  private next = 0
  private alive = 0

  constructor(
    private max: number,
    additive: boolean,
  ) {
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 4)
    this.size = new Float32Array(max)
    this.vel = new Float32Array(max * 3)
    this.life = new Float32Array(max)
    this.maxLife = new Float32Array(max)
    this.baseA = new Float32Array(max)
    this.baseSize = new Float32Array(max)
    this.drag = new Float32Array(max)
    this.grav = new Float32Array(max)
    this.grow = new Float32Array(max)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: projScale },
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor;
        void main(){
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: additive
        ? /* glsl */ `varying vec4 vColor; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a; gl_FragColor = vec4(vColor.rgb * vColor.a * a, 1.0); }`
        : /* glsl */ `varying vec4 vColor; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, d); gl_FragColor = vec4(vColor.rgb, vColor.a * a); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = additive ? 20 : 10
  }

  spawn(o: SpawnOpts) {
    const i = this.next
    this.next = (this.next + 1) % this.max
    this.pos[i * 3] = o.x
    this.pos[i * 3 + 1] = o.y
    this.pos[i * 3 + 2] = o.z
    this.vel[i * 3] = o.vx ?? 0
    this.vel[i * 3 + 1] = o.vy ?? 0
    this.vel[i * 3 + 2] = o.vz ?? 0
    this.col[i * 4] = o.r
    this.col[i * 4 + 1] = o.g
    this.col[i * 4 + 2] = o.b
    this.baseA[i] = o.a ?? 1
    this.baseSize[i] = o.size
    this.life[i] = o.life
    this.maxLife[i] = o.life
    this.drag[i] = o.drag ?? 1
    this.grav[i] = o.gravity ?? 0
    this.grow[i] = o.grow ?? 0
    this.alive = Math.max(this.alive, i + 1)
  }

  burst(n: number, o: SpawnOpts, spread: number, up = 0) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2
      const s = Math.random() * spread
      this.spawn({
        ...o,
        vx: (o.vx ?? 0) + Math.cos(a) * s,
        vz: (o.vz ?? 0) + Math.sin(a) * s,
        vy: (o.vy ?? 0) + up * (0.4 + Math.random() * 0.8),
        life: o.life * (0.6 + Math.random() * 0.6),
        size: o.size * (0.6 + Math.random() * 0.7),
      })
    }
  }

  update(dt: number) {
    const n = this.max
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0
        this.size[i] = 0
        continue
      }
      this.life[i] -= dt
      const k = Math.exp(-this.drag[i] * dt)
      this.vel[i * 3] *= k
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt
      this.vel[i * 3 + 2] *= k
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      const t = 1 - this.life[i] / this.maxLife[i]
      const fade = Math.min(1, t * 6) * (1 - t) * 1.2
      this.col[i * 4 + 3] = this.baseA[i] * Math.min(1, fade)
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * t)
    }
    const g = this.points.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.aColor.needsUpdate = true
    g.attributes.aSize.needsUpdate = true
  }
}

// ---------- Flames (camera-facing, shared material, seeded by world position) ----------

export const flameMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv; varying float vSeed;
    void main(){
      vUv = uv;
      vSeed = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.71;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; varying vec2 vUv; varying float vSeed;
    ${GLSL_NOISE}
    void main(){
      float t = uTime * 1.7 + vSeed * 10.0;
      float n = fbm(vec2(vUv.x * 3.0 + vSeed, vUv.y * 2.2 - t * 1.4));
      float n2 = vnoise(vec2(vUv.x * 7.0, vUv.y * 5.0 - t * 2.6));
      float y = vUv.y;
      float w = (1.0 - y) * 0.55 + 0.05;
      float x = abs(vUv.x - 0.5 + (n - 0.5) * 0.35 * y);
      float body = smoothstep(w, w * 0.25, x);
      float f = body * smoothstep(0.0, 0.1, y) * smoothstep(1.0, 0.25, y + (n2 - 0.5) * 0.5 + n * 0.25);
      vec3 c = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.55, 0.15), smoothstep(0.1, 0.6, f));
      c = mix(c, vec3(1.0, 0.9, 0.7), smoothstep(0.65, 1.0, f));
      gl_FragColor = vec4(c * f * 2.0, 1.0);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
})

const flameGeo = new THREE.PlaneGeometry(1, 1.6).translate(0, 0.8, 0)

export class Billboards {
  readonly list: THREE.Object3D[] = []
  private q = new THREE.Quaternion()
  add(o: THREE.Object3D) {
    this.list.push(o)
    return o
  }
  update(camera: THREE.Camera) {
    for (const o of this.list) {
      if (!o.visible) continue
      if (o.parent) {
        o.parent.getWorldQuaternion(this.q)
        o.quaternion.copy(this.q.invert().multiply(camera.quaternion))
      } else o.quaternion.copy(camera.quaternion)
    }
  }
}

export function makeFlame(scale = 1) {
  const g = new THREE.Group()
  const m1 = new THREE.Mesh(flameGeo, flameMaterial)
  m1.scale.setScalar(scale)
  const m2 = new THREE.Mesh(flameGeo, flameMaterial)
  m2.scale.set(scale * 0.7, scale * 0.8, scale)
  m2.position.set(0.12 * scale, 0, 0.05)
  g.add(m1, m2)
  g.renderOrder = 15
  return g
}

// ---------- Slash arcs ----------

/** unit arc band: uv.x runs along the arc, uv.y from inner to outer edge; the shader bends it to size */
function arcGeometry(segs = 64) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const u = i / segs
    pos.push(u, 0, 0, u, 0, 1)
    uv.push(u, 0, u, 1)
    if (i < segs) {
      const k = i * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

const slashShader = {
  vertexShader: /* glsl */ `
    uniform float uInner; uniform float uOuter; uniform float uAngle;
    varying vec2 vUv;
    void main(){
      vUv = uv;
      float a = (uv.x - 0.5) * uAngle;
      float r = mix(uInner, uOuter, uv.y);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(sin(a) * r, 0.0, cos(a) * r, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uProgress; uniform float uFade; uniform vec3 uColor; uniform float uDir;
    varying vec2 vUv;
    void main(){
      float u = uDir > 0.0 ? vUv.x : 1.0 - vUv.x;
      float head = smoothstep(uProgress, uProgress - 0.08, u);
      float tail = smoothstep(uProgress - 0.75, uProgress - 0.05, u);
      // thin bright edge near the weapon tip, a soft wake inside it
      float edge = smoothstep(0.7, 0.93, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
      float wake = smoothstep(0.0, 0.9, vUv.y) * smoothstep(1.0, 0.85, vUv.y) * 0.12;
      float a = head * tail * tail * (edge + wake) * (1.0 - uFade);
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
}

interface Slash {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  t: number
  dur: number
  active: boolean
}

export class Slashes {
  private pool: Slash[] = []
  constructor(scene: THREE.Scene) {
    const geo = arcGeometry()
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.ShaderMaterial({
        ...slashShader,
        uniforms: {
          uProgress: { value: 0 },
          uFade: { value: 0 },
          uColor: { value: new THREE.Color(1, 1, 1) },
          uDir: { value: 1 },
          uInner: { value: 1.5 },
          uOuter: { value: 2.45 },
          uAngle: { value: Math.PI * 0.9 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 18
      scene.add(mesh)
      this.pool.push({ mesh, mat, t: 0, dur: 0.22, active: false })
    }
  }

  /**
   * yaw = facing; tilt rotates the arc plane (0 = horizontal, ~1.4 = vertical overhead).
   * inner/outer are the trail's radii (a weapon passes its striking part through that band), angle is the sweep
   * in radians; scale multiplies the radii (creatures without a weapon only give a scale).
   */
  spawn(x: number, y: number, z: number, yaw: number, opts: { color?: THREE.Color; scale?: number; inner?: number; outer?: number; angle?: number; dir?: number; tilt?: number; dur?: number } = {}) {
    const s = this.pool.find((p) => !p.active) ?? this.pool[0]
    s.active = true
    s.t = 0
    s.dur = opts.dur ?? 0.22
    s.mesh.visible = true
    s.mesh.position.set(x, y, z)
    s.mesh.rotation.set(0, 0, 0)
    s.mesh.rotateY(yaw)
    s.mesh.rotateZ(opts.tilt ?? 0)
    const k = opts.scale ?? 1
    s.mat.uniforms.uInner.value = (opts.inner ?? 1.5) * k
    s.mat.uniforms.uOuter.value = (opts.outer ?? 2.45) * k
    s.mat.uniforms.uAngle.value = Math.min(Math.PI * 2, opts.angle ?? Math.PI * 0.9)
    s.mat.uniforms.uColor.value.copy(opts.color ?? new THREE.Color(1.4, 1.1, 0.8))
    s.mat.uniforms.uDir.value = opts.dir ?? 1
  }

  update(dt: number) {
    for (const s of this.pool) {
      if (!s.active) continue
      s.t += dt
      const p = s.t / s.dur
      s.mat.uniforms.uProgress.value = Math.min(1.3, p * 2.2)
      s.mat.uniforms.uFade.value = Math.max(0, (p - 0.45) / 0.55)
      if (p >= 1) {
        s.active = false
        s.mesh.visible = false
      }
    }
  }
}

// ---------- Ground rings (shockwaves, telegraphs, pulses) ----------

interface Ring {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  t: number
  dur: number
  from: number
  to: number
  active: boolean
  hold: boolean
}

export class Rings {
  private pool: Ring[] = []
  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 1 },
          uWidth: { value: 0.1 },
          uFill: { value: 0 },
        },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uAlpha; uniform float uWidth; uniform float uFill; varying vec2 vUv;
          void main(){
            float d = length(vUv - 0.5) * 2.0;
            float ring = smoothstep(1.0, 1.0 - uWidth, d) * smoothstep(1.0 - uWidth * 2.5, 1.0 - uWidth, d);
            float fill = smoothstep(1.0, 0.0, d) * uFill;
            float a = (ring + fill) * uAlpha;
            gl_FragColor = vec4(uColor * a, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.visible = false
      mesh.renderOrder = 12
      scene.add(mesh)
      this.pool.push({ mesh, mat, t: 0, dur: 1, from: 0, to: 1, active: false, hold: false })
    }
  }

  spawn(x: number, z: number, opts: { from: number; to: number; dur: number; color: THREE.Color; width?: number; fill?: number; hold?: boolean; y?: number }) {
    const r = this.pool.find((p) => !p.active) ?? this.pool[0]
    r.active = true
    r.t = 0
    r.dur = opts.dur
    r.from = opts.from
    r.to = opts.to
    r.hold = !!opts.hold
    r.mesh.visible = true
    r.mesh.position.set(x, opts.y ?? 0.06, z)
    r.mat.uniforms.uColor.value.copy(opts.color)
    r.mat.uniforms.uWidth.value = opts.width ?? 0.12
    r.mat.uniforms.uFill.value = opts.fill ?? 0
    return r
  }

  update(dt: number) {
    for (const r of this.pool) {
      if (!r.active) continue
      r.t += dt
      const p = Math.min(1, r.t / r.dur)
      const e = r.hold ? p : 1 - Math.pow(1 - p, 3)
      const s = r.from + (r.to - r.from) * e
      r.mesh.scale.setScalar(Math.max(0.01, s))
      r.mat.uniforms.uAlpha.value = r.hold ? Math.min(1, p * 3) : 1 - p
      if (r.t >= r.dur) {
        r.active = false
        r.mesh.visible = false
      }
    }
  }
}

/** Convenience bundle passed around the game. */
export class VFX {
  readonly add: Particles
  readonly soft: Particles
  readonly slashes: Slashes
  readonly rings: Rings
  readonly billboards = new Billboards()

  constructor(scene: THREE.Scene) {
    this.add = new Particles(2600, true)
    this.soft = new Particles(1400, false)
    scene.add(this.add.points, this.soft.points)
    this.slashes = new Slashes(scene)
    this.rings = new Rings(scene)
  }

  update(dt: number, camera: THREE.Camera, time: number) {
    flameMaterial.uniforms.uTime.value = time
    this.add.update(dt)
    this.soft.update(dt)
    this.slashes.update(dt)
    this.rings.update(dt)
    this.billboards.update(camera)
  }

  /** Dark ichor + sparks when something is struck. */
  hit(x: number, y: number, z: number, dirX: number, dirZ: number, heavy: boolean, color = new THREE.Color(0.25, 0.02, 0.03)) {
    const n = heavy ? 26 : 14
    for (let i = 0; i < n; i++) {
      const s = rand(2, heavy ? 9 : 6)
      this.soft.spawn({
        x,
        y,
        z,
        vx: dirX * s + rand(-2, 2),
        vy: rand(1, 5),
        vz: dirZ * s + rand(-2, 2),
        r: color.r,
        g: color.g,
        b: color.b,
        a: 0.9,
        size: rand(0.06, 0.16),
        life: rand(0.35, 0.7),
        drag: 2,
        gravity: 14,
      })
    }
    for (let i = 0; i < (heavy ? 18 : 8); i++) {
      const s = rand(3, 10)
      this.add.spawn({
        x,
        y,
        z,
        vx: dirX * s + rand(-3, 3),
        vy: rand(0, 4),
        vz: dirZ * s + rand(-3, 3),
        r: 2.2,
        g: 1.2,
        b: 0.5,
        a: 1,
        size: rand(0.04, 0.09),
        life: rand(0.15, 0.35),
        drag: 4,
        gravity: 6,
      })
    }
  }

  dust(x: number, z: number, n = 12, radius = 1, color = new THREE.Color(0.3, 0.28, 0.25)) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = rand(0.5, 3) * radius
      this.soft.spawn({
        x: x + Math.cos(a) * radius * 0.3,
        y: 0.15,
        z: z + Math.sin(a) * radius * 0.3,
        vx: Math.cos(a) * s,
        vy: rand(0.3, 1.2),
        vz: Math.sin(a) * s,
        r: color.r,
        g: color.g,
        b: color.b,
        a: 0.35,
        size: rand(0.5, 1.1) * radius,
        life: rand(0.6, 1.2),
        drag: 3,
        grow: 1.5,
      })
    }
  }
}
