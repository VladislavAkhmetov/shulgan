import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { assignShadowLayers } from '../level/geo'
import { rimMaterial } from '../render/materials'

let template: Promise<GLTF> | null = null
const LOOPS = new Set(['flight_flap', 'climb', 'soar', 'circle_left', 'circle_right'])
const REQUIRED = ['climb', 'circle_left', 'dive', 'talon_strike', 'pull_up']

/** Cached skin and textures, independent skeleton/mixer, game-clock animation sampling. */
export class EagleRig {
  readonly root = new THREE.Group()
  readonly ready: Promise<boolean>
  private model: THREE.Object3D | null = null
  private mixer: THREE.AnimationMixer | null = null
  private actions = new Map<string, THREE.AnimationAction>()
  private weights = new Map<string, number>()
  private materials: THREE.Material[] = []
  private disposed = false
  private last = { name: 'climb', time: 0 }

  constructor() {
    this.root.name = 'Kara_Animated_Berkut'
    template ??= new GLTFLoader().loadAsync('/models/berkut_rig.glb')
    this.ready = template.then((gltf) => {
      if (this.disposed) return false
      for (const name of REQUIRED) if (!gltf.animations.some((c) => c.name === name)) throw new Error(`Missing eagle clip: ${name}`)
      const model = clone(gltf.scene)
      let meshes = 0
      model.traverse((object) => {
        const mesh = object as THREE.SkinnedMesh
        if (!mesh.isSkinnedMesh) return
        meshes++; mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false
        mesh.layers.mask = this.root.layers.mask
        const material = (original: THREE.Material) => {
          const mat = rimMaterial((original as THREE.MeshStandardMaterial).clone(), new THREE.Color(.22, .17, .10))
          // The eagle remains readable above the dark forest without losing the source plumage.
          mat.emissiveMap = mat.map
          mat.emissive.setRGB(.32, .24, .14); mat.emissiveIntensity = .65
          this.materials.push(mat)
          return mat
        }
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(material) : material(mesh.material)
      })
      if (!meshes) throw new Error('Eagle GLB has no skinned mesh')
      assignShadowLayers(model)
      this.model = model; this.root.add(model); this.mixer = new THREE.AnimationMixer(model)
      for (const clip of gltf.animations) {
        const action = this.mixer.clipAction(clip)
        action.play(); action.paused = true; action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true
        action.setEffectiveWeight(0); this.actions.set(clip.name, action); this.weights.set(clip.name, 0)
      }
      this.sample(this.last.name, this.last.time, 0, true)
      return true
    }).catch((error) => {
      template = null
      console.warn('berkut_rig.glb: eagle model could not be loaded', error)
      return false
    })
  }

  /** Clip seconds follow the skill's phase clock, including hit-stop and slow motion. */
  sample(name: string, time: number, dt: number, snap = false) {
    this.last = { name, time }
    if (this.disposed || !this.mixer) return
    const selected = this.actions.get(name)
    if (!selected) return
    const blend = snap ? 1 : 1 - Math.exp(-dt * (name === 'talon_strike' ? 38 : 20))
    let sum = 0
    for (const [key] of this.actions) {
      const current = this.weights.get(key) ?? 0
      const weight = current + ((key === name ? 1 : 0) - current) * blend
      this.weights.set(key, weight); sum += weight
    }
    for (const [key, action] of this.actions) action.setEffectiveWeight((this.weights.get(key) ?? 0) / (sum || 1))
    const duration = selected.getClip().duration
    const nonnegative = Math.max(0, time)
    selected.time = LOOPS.has(name) ? nonnegative % duration : Math.min(nonnegative, duration - .00001)
    this.mixer.update(0)
    this.root.updateMatrixWorld(true)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.mixer?.stopAllAction()
    if (this.model && this.mixer) this.mixer.uncacheRoot(this.model)
    this.model?.traverse((object) => { const mesh = object as THREE.SkinnedMesh; if (mesh.isSkinnedMesh) mesh.skeleton.dispose() })
    for (const material of this.materials) material.dispose()
    this.materials.length = 0; this.actions.clear(); this.weights.clear()
    this.root.clear(); this.root.removeFromParent(); this.model = null; this.mixer = null
  }
}
