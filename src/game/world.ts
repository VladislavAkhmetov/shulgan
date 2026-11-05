import type * as THREE from 'three'
import type { Field } from './level/field'
import type { LevelBuild } from './level/build'
import type { VFX } from './render/vfx'
import type { AudioEngine, SoundKind } from './audio/audio'
import type { Vision } from './render/vision'
import type { Lighting } from './render/lights'
import type { Player } from './actors/player'
import type { Enemy } from './actors/enemies'
import type { Projectiles } from './actors/projectiles'
import type { SoundOpts } from './types'
import type { KitState } from './rpg/state'

export type BossEvent = 'phase2' | 'death' | 'perch' | 'unperch' | 'flare' | 'scar' | 'drink'

/** Services every actor can reach. Implemented by Game. */
export interface World {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  field: Field
  vfx: VFX
  audio: AudioEngine
  vision: Vision
  lighting: Lighting
  level: LevelBuild
  player: Player
  enemies: Enemy[]
  projectiles: Projectiles
  time: number
  sound(kind: SoundKind, pos: THREE.Vector3 | null, opts?: SoundOpts): void
  hitstop(sec: number): void
  shake(amount: number): void
  slowmo(sec: number, scale?: number): void
  damagePulse(k: number): void
  playerNoise(pos: THREE.Vector3, radius: number): void
  onEnemyDeath(e: Enemy): void
  isLit(x: number, z: number): boolean
  perfectDodge(): void
  /** Aldar sends Kara from his glove (docs/COMPANION.md, «Коготь с неба») */
  releaseEagle(): void
  /** «Вспышка живицы»: a ring of sparks around the belt vessel */
  vesselFlash(pos: THREE.Vector3): void
  kit: KitState
  /** short message in the corner (pickups, warnings) */
  toast(text: string, kind?: 'item' | 'info' | 'warn', icon?: string): void
  /** an arrow stopped flying at pos: it stays (wood, ground), breaks (stone) or burns (thorns) */
  arrowLanded(pos: THREE.Vector3, fire: boolean): 'keep' | 'break' | 'burn'
  /** every step of an arrow's flight: true = something here took it (a raven's nest, a perched Shurale) */
  arrowProbe(pos: THREE.Vector3, fire: boolean): boolean
  /** phase2 · perch/unperch (Shurale in the crowns) · flare (a parry lights the summit) · scar (Shulgen steps behind Aldar) · drink (he heals at the spring) */
  bossEvent(ev: BossEvent): void
  /** Shurale's root trap: black roots break out under pos after a moment unless the vessel's flash burns them */
  spawnRoots(pos: THREE.Vector3): void
  spawnEnemy(kind: 'ubyr' | 'wolf' | 'morok', x: number, z: number, aggro: boolean): Enemy
  /** the overlay scene: drawn over the vision mask (memory echoes, spirits) */
  overlay: THREE.Scene
}
