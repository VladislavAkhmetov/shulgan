// A chapter's own script (chapters 2–3): the game asks it first at every point where the story can take over.

import type * as THREE from 'three'
import type { Interaction } from './Game'
import type { Barrier } from './level/build'
import type { BossEvent } from './world'

export interface Director {
  /** the opening scene, after the sesen's tale */
  begin(): void
  update(dt: number): void
  /** what [E] does here before anything else (null — nothing of the chapter's) */
  interaction(): Interaction | null
  /** an arrow in flight: true — something of the chapter took it */
  arrowProbe(pos: THREE.Vector3, fire: boolean): boolean
  /** an arrow came down: its fate, or null to let the game decide */
  arrowLanded(pos: THREE.Vector3, fire: boolean): 'keep' | 'break' | 'burn' | null
  /** a numbered or lettered trigger of the map fired: true — the chapter handled it */
  trigger(id: string, pos: THREE.Vector3): boolean
  /** Aldar steps through the gate of the arena */
  bossIntro(): void
  onBossDefeated(): void
  bossEvent(ev: BossEvent): void
  /** Azamat played the kurai (after the game applied the general effects) */
  kurai(): void
  respawn(): void
  /** Aldar's thought at a barrier of the chapter and what [E] says there */
  barrier(b: Barrier): { thought: string; label: string } | null
}
