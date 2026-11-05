import * as THREE from 'three'

export interface LightSource {
  pos: THREE.Vector3
  color: THREE.Color
  intensity: number
  distance: number
  /** 0 = steady, 1 = strong fire flicker */
  flicker: number
  on: boolean
  /** current animated multiplier (for fades) */
  level: number
}

const POOL = 6

/**
 * Forward lighting with a fixed light count (no shader recompiles):
 * moon (directional, shadowed, follows the hero), cold hemisphere fill, the coal in the hero's belt vessel
 * (point, shadowed) and a pool of unshadowed point lights assigned to the nearest sources.
 */
export class Lighting {
  readonly moon: THREE.DirectionalLight
  readonly hemi: THREE.HemisphereLight
  /** the coal in Aldar's belt vessel (Ут-һауыт) */
  readonly lantern: THREE.PointLight
  /** the heat focus: the vessel's light gathered into a cone ahead (no shadow) */
  readonly focus: THREE.SpotLight
  private pool: THREE.PointLight[] = []
  readonly sources: LightSource[] = []
  readonly moonOffset = new THREE.Vector3(-14, 30, -9)
  private time = 0

  constructor(scene: THREE.Scene) {
    this.moon = new THREE.DirectionalLight(new THREE.Color(0.55, 0.68, 1.0), 1.0)
    this.moon.castShadow = true
    this.moon.shadow.mapSize.set(2048, 2048)
    const c = this.moon.shadow.camera
    c.left = -24
    c.right = 24
    c.top = 24
    c.bottom = -24
    c.near = 1
    c.far = 80
    this.moon.shadow.bias = -0.0006
    this.moon.shadow.normalBias = 0.05
    // only opted-in casters render into the shadow maps (see assignShadowLayers)
    this.moon.shadow.camera.layers.set(5)
    scene.add(this.moon, this.moon.target)

    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.16, 0.22, 0.38), new THREE.Color(0.04, 0.035, 0.03), 0.4)
    scene.add(this.hemi)

    this.lantern = new THREE.PointLight(new THREE.Color(1.0, 0.62, 0.3), 7, 18, 1.4)
    this.lantern.castShadow = true
    this.lantern.shadow.mapSize.set(512, 512)
    this.lantern.shadow.camera.near = 0.2
    // past ~12 m the coal's light is too faint to show a shadow
    this.lantern.shadow.camera.far = 12
    this.lantern.shadow.bias = -0.004
    this.lantern.shadow.radius = 2
    this.lantern.shadow.camera.layers.set(4)
    // the cube shadow (6 passes) refreshes every other frame; at 60 fps the swing still reads smoothly
    this.lantern.shadow.autoUpdate = false
    scene.add(this.lantern)

    this.focus = new THREE.SpotLight(new THREE.Color(1.0, 0.6, 0.28), 0, 15, 0.42, 0.55, 1.3)
    // Keep the light count stable. Hiding this light changes shader keys, including depth/distance passes.
    // At rest its intensity is zero; holding F changes uniforms, never the set of lights.
    scene.add(this.focus, this.focus.target)

    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 1.8)
      scene.add(l)
      this.pool.push(l)
    }
  }

  add(s: Omit<LightSource, 'level'> & { level?: number }) {
    const src: LightSource = { level: s.on ? 1 : 0, ...s }
    this.sources.push(src)
    return src
  }

  remove(s: LightSource) {
    const i = this.sources.indexOf(s)
    if (i >= 0) this.sources.splice(i, 1)
  }

  update(dt: number, focus: THREE.Vector3) {
    this.time += dt
    this.moon.position.copy(focus).add(this.moonOffset)
    this.moon.target.position.copy(focus)
    // Snap the shadow camera to texels to avoid shimmering while walking.
    const texel = 48 / 2048
    this.moon.position.x = Math.round(this.moon.position.x / texel) * texel
    this.moon.position.z = Math.round(this.moon.position.z / texel) * texel
    this.moon.target.position.x = this.moon.position.x - this.moonOffset.x
    this.moon.target.position.z = this.moon.position.z - this.moonOffset.z

    for (const s of this.sources) s.level += ((s.on ? 1 : 0) - s.level) * (1 - Math.exp(-6 * dt))
    const ranked = this.sources
      .filter((s) => s.level > 0.01)
      .map((s) => ({ s, d: s.pos.distanceToSquared(focus) }))
      .filter((e) => e.d < 34 * 34)
      .sort((a, b) => a.d - b.d)
    for (let i = 0; i < POOL; i++) {
      const l = this.pool[i]
      const e = ranked[i]
      if (!e) {
        l.intensity = 0
        continue
      }
      const s = e.s
      const fl = s.flicker
      const t = this.time * 9 + s.pos.x * 3.1 + s.pos.z
      const flick = 1 - fl * (0.18 + 0.12 * Math.sin(t) * Math.sin(t * 1.7 + 1.3) + 0.1 * Math.sin(t * 3.3))
      const edgeFade = 1 - Math.max(0, (Math.sqrt(e.d) - 26) / 8)
      l.position.copy(s.pos)
      if (fl > 0) {
        l.position.x += Math.sin(t * 0.7) * 0.06 * fl
        l.position.z += Math.cos(t * 0.9) * 0.06 * fl
      }
      l.color.copy(s.color)
      l.distance = s.distance
      l.intensity = s.intensity * s.level * flick * edgeFade
    }
  }
}
