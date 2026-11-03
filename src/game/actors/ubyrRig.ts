import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { assignShadowLayers } from '../level/geo'
import { rimMaterial } from '../render/materials'
import { clamp } from '../util'
import { createUbyr, UBYR_CLIPS } from './models'
import { Rig, type RigState, type Spring, type V3 } from './rig'

let template: Promise<GLTF> | null = null
const UPPER =
  /^(Spine\d*|Neck|Head|LeftShoulder|RightShoulder|LeftArm|RightArm|LeftForeArm|RightForeArm)$/

/** Keep Mixamo's contact poses inside the existing gameplay hit windows. Times are clip seconds. */
const BLOWS = {
  swipe: { clip: 'swipe', hit: [0.44, 0.56], keys: [0.15, 0.95, 1.25, 2.35] },
  lunge: { clip: 'kick', hit: [0.46, 0.62], keys: [0.2, 0.68, 0.92, 2.7] },
} as const

interface RoarBone {
  bone: THREE.Bone
  sample: THREE.Interpolant
}

function blowTime(n: number, blow: typeof BLOWS[keyof typeof BLOWS]) {
  const [a, b] = blow.hit
  const [start, contact, end, recover] = blow.keys
  if (n < a) return THREE.MathUtils.lerp(start, contact, n / a)
  if (n < b) return THREE.MathUtils.lerp(contact, end, (n - a) / (b - a))
  return THREE.MathUtils.lerp(end, recover, (n - b) / (1 - b))
}

/** A separate skeleton, mixer and flash material per enemy; geometry and textures are shared. */
export class UbyrRig extends Rig {
  emerging = false
  private fallback = createUbyr()
  private mixer: THREE.AnimationMixer | null = null
  private actions: Record<string, THREE.AnimationAction> = {}
  private weights: Record<string, number> = {}
  private gait = Math.random()
  private roarT = -1
  private hit = 0
  private upper: RoarBone[] = []
  private q = new THREE.Quaternion()

  constructor() {
    super()
    this.root.add(this.fallback.root)
    template ??= new GLTFLoader().loadAsync('/models/ubyr_rig.glb')
    void template
      .then((gltf) => this.attach(gltf))
      .catch((e) => {
        console.warn('ubyr_rig.glb: using the procedural Ubyr', e)
      })
  }

  protected springFor(): Spring {
    return [3, 1, 0]
  }
  protected locomotion(): V3 {
    return [0, 0, 0]
  }

  private attach(gltf: GLTF) {
    const scene = clone(gltf.scene)
    const bones = new Map<string, THREE.Bone>()
    let meshes = 0
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
      const mesh = o as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      meshes++
      mesh.castShadow = mesh.receiveShadow = true
      mesh.frustumCulled = false
      const material = (m: THREE.Material) => {
        const mat = rimMaterial((m as THREE.MeshStandardMaterial).clone())
        this.flashMats.push(mat)
        return mat
      }
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(material)
        : material(mesh.material)
    })
    if (!meshes) throw new Error('Ubyr GLB has no skinned mesh')
    for (const name of [
      'walk',
      'run',
      'scream',
      'swipe',
      'kick',
      'hurt',
      'death',
    ]) {
      if (!gltf.animations.some((clip) => clip.name === name))
        throw new Error(`Missing Ubyr clip: ${name}`)
    }

    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const scale = 1.95 / (box.max.y - box.min.y)
    scene.scale.multiplyScalar(scale)
    scene.position.set(
      -(box.min.x + box.max.x) * 0.5 * scale,
      -box.min.y * scale,
      -(box.min.z + box.max.z) * 0.5 * scale,
    )
    this.mixer = new THREE.AnimationMixer(scene)
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip)
      action.play()
      action.paused = true // sample game time; one-shots never wrap back to their first frame
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      this.actions[clip.name] = action
      this.weights[clip.name] = 0
      action.setEffectiveWeight(0)
      if (clip.name === 'scream') {
        for (const track of clip.tracks) {
          if (!track.name.endsWith('.quaternion')) continue
          const bone = bones.get(track.name.slice(0, -11))
          if (bone && UPPER.test(bone.name.replace(/^mixamorig:?/, ''))) {
            this.upper.push({
              bone,
              sample: new THREE.QuaternionLinearInterpolant(
                track.times,
                track.values,
                4,
                new Float32Array(4),
              ),
            })
          }
        }
      }
    }
    // New meshes may arrive while this enemy is an eagle silhouette. Carry over its layers.
    scene.traverse((o) => {
      o.layers.mask = this.root.layers.mask
    })
    assignShadowLayers(scene)
    this.root.add(scene)
    this.root.remove(this.fallback.root)
  }

  scream() {
    this.roarT = 0
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
    let name = 'walk'
    let time = 0
    if (state.clip === UBYR_CLIPS.swipe || state.clip === UBYR_CLIPS.lunge) {
      const blow = state.clip === UBYR_CLIPS.swipe ? BLOWS.swipe : BLOWS.lunge
      name = blow.clip
      time = blowTime(n, blow)
    } else if (state.clip === UBYR_CLIPS.death) {
      name = 'death'
      time = n * this.actions.death.getClip().duration
    } else if (this.emerging) {
      name = 'scream'
      time = 0.4 + (1 - n) * 1.9
    } else if (state.clip === UBYR_CLIPS.stagger) {
      name = 'hurt'
      time = 0.8 // hold the recoiling pose while posture is broken / during a finisher
    } else if (state.clip === UBYR_CLIPS.hurt) {
      name = 'hurt'
      time = THREE.MathUtils.lerp(0.25, 1.45, n)
    } else if (state.speed > 0.15) {
      name = state.speed < 2.1 ? 'walk' : 'run'
      // walk is two slow steps; run is one short cycle. Phase follows distance, including wading.
      this.gait += (dt * state.speed) / (name === 'walk' ? 2.2 : 2.5)
      time = (this.gait % 1) * this.actions[name].getClip().duration
    }
    const blend = 1 - Math.exp(-dt * (state.clip ? 26 : 10))
    let total = 0
    for (const key in this.actions) {
      this.weights[key] += ((key === name ? 1 : 0) - this.weights[key]) * blend
      total += this.weights[key]
    }
    if (total < 0.001) this.weights[name] = total = 1
    for (const key in this.actions) {
      const action = this.actions[key]
      action.setEffectiveWeight(this.weights[key] / total)
      if (key === name)
        action.time = clamp(time, 0, action.getClip().duration - 0.00001)
    }
    this.mixer.update(0)

    if (state.clip) this.roarT = -1 // attacks and reactions interrupt the warning
    if (this.roarT >= 0) {
      this.roarT += dt
      const duration = 2.1
      const weight = Math.min(
        1,
        this.roarT / 0.18,
        (duration - this.roarT) / 0.25,
      )
      if (weight > 0) {
        for (const { bone, sample } of this.upper) {
          this.q.fromArray(sample.evaluate(0.35 + this.roarT))
          bone.quaternion.slerp(this.q, weight)
        }
      } else this.roarT = -1
    }
    // Preserve hit flashes and the attack warning on each enemy's own material.
    this.hit = Math.max(0, this.hit - dt * 7)
    const warning = this.eyeBoost * 0.1
    for (const mat of this.flashMats)
      mat.emissive.setRGB(
        this.hit * 1.4 + warning,
        this.hit * 1.2 + warning,
        this.hit + warning,
      )
  }
}
