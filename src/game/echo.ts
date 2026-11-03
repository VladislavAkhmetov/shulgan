import * as THREE from 'three'
import type { World } from './world'
import { createGhost, HERO_CLIPS } from './actors/models'
import type { Clip, Humanoid } from './actors/rig'

/** One beat of a memory: walk/run to a point, or hold a pose. */
export interface EchoSeg {
  to?: THREE.Vector3
  dur: number
  clip?: Clip
  /** head turn (radians) during the beat */
  look?: number
  whisper?: boolean
}

/**
 * Echo of memory: where someone died, their last seconds replay as a cold, translucent ghost
 * drawn over the darkness (it is remembered, not seen).
 */
export class Echo {
  private rig: Humanoid
  private mat: THREE.ShaderMaterial
  private segs: EchoSeg[] = []
  private i = 0
  private st = 0
  private total = -1
  private pos = new THREE.Vector3()
  private from = new THREE.Vector3()
  private facing = 0
  private w: World

  constructor(w: World, overlay: THREE.Scene) {
    this.w = w
    const g = createGhost()
    this.rig = g.rig
    this.mat = g.mat
    this.rig.root.visible = false
    overlay.add(this.rig.root)
  }

  get playing() {
    return this.total >= 0
  }

  play(start: THREE.Vector3, segs: EchoSeg[], facing?: number) {
    this.segs = segs
    this.i = 0
    this.st = 0
    this.total = 0
    this.pos.copy(start)
    this.from.copy(start)
    const first = segs.find((s) => s.to)
    this.facing = facing ?? (first?.to ? Math.atan2(first.to.x - start.x, first.to.z - start.z) : 0)
    this.rig.root.visible = true
    this.w.sound('whisper', start, { tone: 'magic', strength: 0.5 })
  }

  update(dt: number) {
    if (this.total < 0) return
    this.total += dt
    this.st += dt
    let seg = this.segs[this.i]
    if (seg && this.st >= seg.dur) {
      if (seg.to) this.pos.copy(seg.to)
      this.from.copy(this.pos)
      this.i++
      this.st = 0
      seg = this.segs[this.i]
      if (seg?.whisper) this.w.sound('whisper', this.pos, { indicate: false, vol: 0.8 })
      if (seg?.to) this.facing = Math.atan2(seg.to.x - this.pos.x, seg.to.z - this.pos.z)
    }
    let speed = 0
    let clip: Clip | null = null
    let ct = 0
    let look = 0
    let fade = 1
    if (seg) {
      const k = Math.min(1, this.st / seg.dur)
      if (seg.to) {
        this.pos.lerpVectors(this.from, seg.to, k)
        speed = this.from.distanceTo(seg.to) / seg.dur
      }
      if (seg.clip) {
        clip = seg.clip
        ct = k
      }
      look = seg.look ?? 0
    } else {
      // memory dissolves after the last beat
      clip = this.segs[this.segs.length - 1]?.clip ?? HERO_CLIPS.death
      ct = 1
      fade = 1 - this.st / 1.2
    }
    const fadeIn = Math.min(1, this.total / 0.6)
    const op = Math.max(0, 0.85 * fadeIn * fade)
    this.mat.uniforms.uOpacity.value = op
    this.mat.uniforms.uTime.value = this.w.time
    this.rig.update(dt, { speed, forward: 1, clip, t: ct, time: this.w.time, look, snap: clip ? 1.5 : 1 })
    this.rig.root.position.set(this.pos.x, 0, this.pos.z)
    this.rig.root.rotation.y = this.facing
    if (Math.random() < 0.5)
      this.w.vfx.add.spawn({ x: this.pos.x + (Math.random() - 0.5) * 0.5, y: 0.3 + Math.random() * 1.4, z: this.pos.z + (Math.random() - 0.5) * 0.5, vy: 0.4, r: 0.25, g: 0.5, b: 1.0, a: 0.5 * op, size: 0.05, life: 1.2, drag: 1 })
    if (!seg && fade <= 0) {
      this.total = -1
      this.rig.root.visible = false
    }
  }
}
