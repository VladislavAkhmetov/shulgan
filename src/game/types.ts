import type * as THREE from 'three'
import type { SoundKind } from './audio/audio'
import type { Tone } from './render/indicators'

export interface SoundOpts {
  tone?: Tone
  strength?: number
  /** merge repeated sounds from one source into a single indicator */
  id?: number | string
  /** false = never show an indicator (UI / own sounds) */
  indicate?: boolean
  vol?: number
}

export interface HitInfo {
  dmg: number
  x: number
  z: number
  knock: number
  heavy?: boolean
  grab?: boolean
  /** a red-flash attack: the kalkan does not stop it (docs/COMBAT.md) */
  unblockable?: boolean
}

/** perfect = dodged in the first moment · parry = met by the kalkan's boss at the right moment · blocked = taken on the shield */
export type HitResult = 'hit' | 'iframe' | 'perfect' | 'parry' | 'blocked' | 'immune'

export interface AttackDef {
  dur: number
  hitStart: number
  hitEnd: number
  range: number
  arc: number
  dmg: number
  posture?: number
  knock: number
  heavy?: boolean
  lunge?: number
  lungeStart?: number
  lungeEnd?: number
  cd?: number
  /** clip phases: [clipName, nStart, nEnd] */
  phases: [string, number, number][]
  sound?: SoundKind
  swing?: SoundKind
  grab?: boolean
  /** a red flash before it: cannot be blocked or parried, only dodged or broken by Kara */
  unblockable?: boolean
  /** visual slash arc */
  slash?: { dir: number; tilt?: number; scale?: number; color?: THREE.Color }
}
