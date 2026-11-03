import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { assignShadowLayers } from '../level/geo'
import { rimMaterial } from '../render/materials'
import { clamp } from '../util'
import { createWolf, WOLF_CLIPS } from './models'
import { Rig, type Clip, type RigState, type Spring, type V3 } from './rig'
import { WolfMotion } from './wolfMotion'

let template: Promise<GLTF> | null = null

/** Shared geometry/textures, with an independent skeleton, animation and hit flash per wolf. */
export class WolfRig extends Rig {
  readonly ready: Promise<boolean>
  private fallback = createWolf()
  private mixer: THREE.AnimationMixer | null = null
  private motion: WolfMotion | null = null
  private actions: Record<string, THREE.AnimationAction> = {}
  private weights: Record<string, number> = {}
  private gait = Math.random()
  private idleTime = Math.random() * 4
  private hit = 0
  private previousClip: Clip | null = null
  private previousTime = 0
  private reaction = Math.random() < 0.5 ? 'hit_left' : 'hit_right'

  constructor() {
    super()
    this.root.add(this.fallback.root)
    template ??= new GLTFLoader().loadAsync('/models/wolf_rig.glb')
    this.ready = template.then((gltf) => {
      this.attach(gltf)
      return true
    }).catch((error) => {
      console.warn('wolf_rig.glb: using the procedural wolf', error)
      return false
    })
  }

  protected springFor(): Spring { return [3, 1, 0] }
  protected locomotion(): V3 { return [0, 0, 0] }

  private attach(gltf: GLTF) {
    for (const name of ['idle', 'idle_low', 'walk', 'run', 'attack', 'run_jump', 'hit_left', 'hit_right', 'death']) {
      if (!gltf.animations.some((clip) => clip.name === name)) throw new Error(`Missing wolf clip: ${name}`)
    }
    const model = clone(gltf.scene)
    model.name = 'wolf-model'
    let meshes = 0
    model.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      meshes++
      mesh.castShadow = mesh.receiveShadow = true
      mesh.frustumCulled = false
      const material = (original: THREE.Material) => {
        const mat = rimMaterial((original as THREE.MeshStandardMaterial).clone())
        this.flashMats.push(mat)
        return mat
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(material) : material(mesh.material)
    })
    if (!meshes) throw new Error('Wolf GLB has no skinned mesh')

    // The supplied mesh faces -X; all actors in the game face +Z.
    model.rotation.y = Math.PI / 2
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const scale = 0.95 / (box.max.y - box.min.y)
    model.scale.multiplyScalar(scale)
    model.position.set(
      -(box.min.x + box.max.x) * 0.5 * scale,
      -box.min.y * scale,
      -(box.min.z + box.max.z) * 0.5 * scale,
    )
    this.mixer = new THREE.AnimationMixer(model)
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip)
      action.play()
      action.paused = true
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.setEffectiveWeight(0)
      this.actions[clip.name] = action
      this.weights[clip.name] = 0
    }
    // Loading may finish after the eagle has revealed this wolf through the forest.
    model.traverse((object) => { object.layers.mask = this.root.layers.mask })
    assignShadowLayers(model)
    this.root.add(model)
    this.motion = new WolfMotion(model, this.root)
    this.root.remove(this.fallback.root)
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.fallback.root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      geometries.add(mesh.geometry)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }

  hitFlash() {
    this.hit = 1
    if (!this.mixer) this.fallback.hitFlash()
  }

  update(dt: number, state: RigState) {
    if (!this.mixer) {
      this.fallback.eyeBoost = this.eyeBoost
      this.fallback.update(dt, state)
      return
    }
    const n = clamp(state.t ?? 0, 0, 1)
    const clip = state.clip ?? null
    if (clip === WOLF_CLIPS.hurt && (this.previousClip !== clip || n < this.previousTime)) {
      this.reaction = this.reaction === 'hit_left' ? 'hit_right' : 'hit_left'
    }
    this.previousClip = clip
    this.previousTime = n
    this.idleTime += dt
    let name = (state.fear ?? 0) > 0.5 ? 'idle_low' : 'idle'
    let time = this.idleTime % this.actions[name].getClip().duration
    if (clip === WOLF_CLIPS.crouch) {
      name = 'attack'
      time = THREE.MathUtils.lerp(0.15, 0.55, n)
    } else if (clip === WOLF_CLIPS.leap) {
      name = 'run_jump'
      // Take off with the existing lunge (0.38); contact remains inside 0.42–0.62.
      time = THREE.MathUtils.lerp(0.17, this.actions.run_jump.getClip().duration, n)
    } else if (clip === WOLF_CLIPS.death) {
      name = 'death'
      time = n * this.actions.death.getClip().duration
    } else if (clip === WOLF_CLIPS.stagger) {
      name = this.reaction
      time = this.actions[name].getClip().duration * 0.45
    } else if (clip === WOLF_CLIPS.hurt) {
      name = this.reaction
      time = n * this.actions[name].getClip().duration
    } else if (state.speed > 0.15) {
      name = state.speed < 2.6 ? 'walk' : 'run'
      // Phase follows distance, including the existing shallow-water speed reduction.
      this.gait += dt * state.speed / (name === 'walk' ? 1.2 : 2.4)
      time = (this.gait % 1) * this.actions[name].getClip().duration
    }
    const blend = 1 - Math.exp(-dt * (clip ? 30 : 10))
    let total = 0
    for (const key in this.actions) {
      let weight = this.weights[key] + ((key === name ? 1 : 0) - this.weights[key]) * blend
      if (weight < 0.0001) weight = 0
      this.weights[key] = weight
      total += weight
    }
    if (total < 0.001) this.weights[name] = total = 1
    for (const key in this.actions) {
      const action = this.actions[key]
      action.setEffectiveWeight(this.weights[key] / total)
      if (key === name) action.time = clamp(time, 0, action.getClip().duration - 0.00001)
    }
    this.motion?.restore()
    this.mixer.update(0)
    this.motion?.update(dt, state, this.gait)
    this.hit = Math.max(0, this.hit - dt * 7)
    const warning = this.eyeBoost * 0.12
    for (const mat of this.flashMats) mat.emissive.setRGB(
      this.hit * 1.4 + warning,
      this.hit * 1.2 + warning * 0.35,
      this.hit + warning * 0.15,
    )
  }
}
