import * as THREE from 'three'
import { Actor } from './actor'
import { createAzamat } from './models'
import { NPC_CLIPS } from './models2'
import type { Clip, Humanoid } from './rig'
import type { World } from '../world'
import { glow, std } from '../render/materials'
import { clamp, dampAngle, rand } from '../util'

export type SonState = 'follow' | 'stagger' | 'kneel' | 'stay' | 'still'

/** Azamat lifts the reed to his lips and plays */
const KURAI_CLIP: Clip = [
  { t: 0, p: { shL: [-1.4, 0, 0.35], elL: [-1.7, 0, 0], shR: [-1.3, 0, -0.25], elR: [-1.9, 0, 0], head: [-0.15, 0, 0], chest: [-0.08, 0, 0] } },
  { t: 0.5, p: { shL: [-1.45, 0, 0.35], elL: [-1.75, 0, 0], shR: [-1.35, 0, -0.25], elR: [-1.95, 0, 0], head: [-0.3, 0.1, 0], chest: [-0.15, 0, 0] }, b: [0.03, 0, -0.04] },
  { t: 1, p: { shL: [-1.4, 0, 0.35], elL: [-1.7, 0, 0], shR: [-1.3, 0, -0.25], elR: [-1.9, 0, 0], head: [-0.1, -0.1, 0], chest: [-0.05, 0, 0] } },
]

export const KURAI_CD = 10

/**
 * Azamat, eleven (docs/COMPANION.md §2). The anti-escort rule: no health bar; he keeps in the warm circle behind his
 * father's left shoulder, under the kalkan, and slips aside from blows by himself. «Зов курая» [Q] (10 s) is played by
 * the game through `play()`. In chapter 3 the grave cold of the cave brings him to his knees; after the marten's gift he
 * stays by the river with his father's vessel.
 */
export class Azamat extends Actor {
  rig: Humanoid
  state: SonState = 'follow'
  kuraiCd = 0
  /** seconds of the tune still playing */
  playT = 0
  /** set by the game every frame */
  combat = false
  speedNow = 0
  /** the copper vessel slung over his shoulder (chapter 3), shown once his father gives it to him */
  readonly vessel: THREE.Group
  private vesselGlow: THREE.MeshBasicMaterial
  private dodgeCd = 0
  private goal = new THREE.Vector3()
  /** the reflection follows him in the black water like everybody else's */
  private noteT = 0

  constructor(w: World, at: THREE.Vector3) {
    super(w)
    this.rig = createAzamat()
    w.scene.add(this.rig.root)
    this.pos.copy(at)
    this.radius = 0.25
    // the father's vessel, hung on a strap over his shoulder
    this.vessel = new THREE.Group()
    const copper = std(0x8a5a2e, 0.45, { metalness: 0.85 })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.068, 0.11, 8), copper)
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), copper)
    lid.position.y = 0.055
    this.vesselGlow = glow(3.2, 1.3, 0.35)
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), this.vesselGlow)
    this.vessel.add(body, lid, core)
    this.vessel.position.set(0.16, 0.05, 0.12)
    this.vessel.visible = false
    this.rig.joints.hips.add(this.vessel)
  }

  get canPlay() {
    return (this.state === 'follow' || this.state === 'still') && this.kuraiCd <= 0
  }

  /** «Зов курая»: true if he plays now (the game applies what the tune does) */
  play() {
    if (!this.canPlay) return false
    this.kuraiCd = KURAI_CD
    this.playT = 1.4
    this.noteT = 0
    this.w.sound('kurai', this.pos, { indicate: false, vol: 1 })
    return true
  }

  /** follow at once from the far side of the light (after a scene or a fall) */
  placeNear(p: THREE.Vector3, facing: number) {
    this.pos.set(p.x - Math.sin(facing) * 1.2 + Math.cos(facing) * 0.9, 0, p.z - Math.cos(facing) * 1.2 - Math.sin(facing) * 0.9)
    this.w.field.resolve(this.pos, this.radius)
  }

  update(dt: number, visible: boolean) {
    const w = this.w
    const p = w.player
    this.kuraiCd = Math.max(0, this.kuraiCd - dt)
    this.playT = Math.max(0, this.playT - dt)
    this.dodgeCd = Math.max(0, this.dodgeCd - dt)
    let speed = 0
    let clip: Clip | null = null
    let ct = 0
    if (this.state === 'follow' || this.state === 'stagger') {
      // behind the left shoulder, under the kalkan; in a fight, on the far side of Aldar from the nearest enemy
      const f = p.facing
      let gx = p.pos.x + Math.cos(f) * 0.95 - Math.sin(f) * 1.15
      let gz = p.pos.z - Math.sin(f) * 0.95 - Math.cos(f) * 1.15
      if (this.combat) {
        let near: THREE.Vector3 | null = null
        let bd = 14
        for (const e of w.enemies) {
          if (!e.alive || e.hidden || !e.aggro) continue
          const d = e.pos.distanceTo(p.pos)
          if (d < bd) {
            bd = d
            near = e.pos
          }
        }
        if (near) {
          const dx = p.pos.x - near.x
          const dz = p.pos.z - near.z
          const l = Math.hypot(dx, dz) || 1
          gx = p.pos.x + (dx / l) * 1.9 + (dz / l) * 0.5
          gz = p.pos.z + (dz / l) * 1.9 - (dx / l) * 0.5
        }
      }
      this.goal.set(gx, 0, gz)
      const dx = this.goal.x - this.pos.x
      const dz = this.goal.z - this.pos.z
      const d = Math.hypot(dx, dz)
      const far = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z)
      if (far > 16 && !visible) this.placeNear(p.pos, p.facing)
      else if (d > 0.35) {
        const max = this.state === 'stagger' ? 1.7 : 6
        speed = clamp(d * 2.6, 0, max)
        this.pos.x += (dx / d) * speed * dt
        this.pos.z += (dz / d) * speed * dt
        this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 9, dt)
      } else this.facing = dampAngle(this.facing, p.facing, 4, dt)
      // he slips aside from a blow aimed close to him
      if (this.dodgeCd <= 0) {
        for (const e of w.enemies) {
          if (!e.alive || e.state !== 'attack' || !e.telegraph) continue
          const ex = this.pos.x - e.pos.x
          const ez = this.pos.z - e.pos.z
          const ed = Math.hypot(ex, ez)
          if (ed > 3) continue
          this.dodgeCd = 1.2
          this.vel.x += (ex / (ed || 1)) * 7
          this.vel.z += (ez / (ed || 1)) * 7
          break
        }
      }
      if (this.playT > 0) {
        clip = KURAI_CLIP
        ct = 1 - this.playT / 1.4
        speed = Math.min(speed, 1)
        this.noteT -= dt
        if (this.noteT <= 0) {
          this.noteT = 0.12
          w.vfx.add.spawn({ x: this.pos.x + rand(-0.2, 0.2), y: 1.25, z: this.pos.z + rand(-0.2, 0.2), vx: rand(-0.4, 0.4), vy: rand(0.6, 1.2), vz: rand(-0.4, 0.4), r: 0.35, g: 1.9, b: 1.8, size: 0.07, life: 1.3, drag: 0.6 })
        }
      }
    } else if (this.state === 'kneel') clip = NPC_CLIPS.kneel
    else if (this.state === 'stay') clip = NPC_CLIPS.sitHug
    this.move(dt, 0, 0)
    this.speedNow = speed
    this.rig.update(dt, { speed, forward: 1, clip, t: ct, time: w.time })
    this.rig.root.position.set(this.pos.x, 0, this.pos.z)
    this.rig.root.rotation.y = this.facing
    this.rig.root.visible = visible
    if (this.vessel.visible) {
      const t = w.time
      const flick = 0.85 + 0.1 * Math.sin(t * 11) * Math.sin(t * 7.3 + 1)
      this.vesselGlow.color.setRGB(3.2 * flick, 1.3 * flick, 0.35 * flick)
    }
  }
}
