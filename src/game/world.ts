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
import type { RpgState } from './rpg/state'

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
  releaseEagle(): void
  rpg: RpgState
  /** short message in the corner (pickups, warnings) */
  toast(text: string, kind?: 'item' | 'info' | 'warn', icon?: string): void
  /** an arrow stopped flying at pos (fire arrows can light braziers) */
  arrowLanded(pos: THREE.Vector3, fire: boolean): void
  bossEvent(ev: 'phase2' | 'death'): void
  spawnEnemy(kind: 'ubyr' | 'wolf' | 'albasty', x: number, z: number, aggro: boolean): Enemy
}
