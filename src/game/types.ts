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
}

export type HitResult = 'hit' | 'iframe' | 'perfect' | 'immune'

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
  /** visual slash arc */
  slash?: { dir: number; tilt?: number; scale?: number; color?: THREE.Color }
}
