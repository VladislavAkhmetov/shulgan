// Tiny external store bridging the game loop and React HUD (useSyncExternalStore).

import type { RpgSnapshot } from '../rpg/state'
import type { JournalEntry } from '../clues'
import type { TutorView } from '../tutor'

export type Screen = 'title' | 'prologue' | 'epilogue' | 'loading' | 'playing' | 'paused' | 'dead' | 'victory'

export interface Narration {
  id: number
  speaker: string
  text: string
}

export interface BossHud {
  name: string
  title: string
  hp: number
  maxHp: number
  posture: number
  maxPosture: number
}

export interface HudState {
  screen: Screen
  hp: number
  maxHp: number
  sips: number
  maxSips: number
  dodge: number
  /** Запал 0..30: every 10 is a fire */
  zeal: number
  dodgeMax: number
  dodgeRecharge: number
  lassoCd: number
  eagleCd: number
  bowDraw: number
  /** [1] kylys or [2] bow */
  weapon: 'blade' | 'bow'
  torchOn: boolean
  torchDoused: number
  boss: BossHud | null
  prompt: string | null
  narration: Narration | null
  hint: string | null
  /** the current onboarding step */
  tutor: TutorView | null
  tutorOn: boolean
  /** the title of a place entered for the first time */
  zone: { id: number; name: string; sub: string } | null
  choice: boolean
  grab: number | null
  drunk: number
  given: number
  kills: number
  deaths: number
  fps: number
  debug: string | null
  quality: 'high' | 'low'
  visionOn: boolean
  volume: number
  loadingText: string
  /** cinematic mode: letterbox, no HUD, camera directed */
  cinema: boolean
  cineLine: Narration | null
  /** nothing is happening: the HUD dissolves to leave only the forest */
  calm: boolean
  /** open lore page (tamga stone) */
  lore: number | null
  rpg: RpgSnapshot | null
  /** rest screen at a spring or fire */
  rest: 'spring' | 'fire' | null
  /** inventory (сума) open */
  suma: boolean
  toasts: { id: number; text: string; kind: 'item' | 'info' | 'warn'; icon?: string }[]
  combat: boolean
  /** what the signs have told so far */
  journal: JournalEntry[]
  /** the tracker's sense is held */
  sense: boolean
  /** Susar, once freed: what she is doing and how many unseen enemies she smells */
  companion: { state: string; threats: number } | null
}

const initial: HudState = {
  screen: 'title',
  hp: 100,
  maxHp: 100,
  sips: 3,
  maxSips: 3,
  dodge: 2,
  zeal: 0,
  dodgeMax: 2,
  dodgeRecharge: 1,
  lassoCd: 0,
  eagleCd: 0,
  bowDraw: 0,
  weapon: 'blade',
  torchOn: true,
  torchDoused: 0,
  boss: null,
  prompt: null,
  narration: null,
  hint: null,
  tutor: null,
  tutorOn: true,
  zone: null,
  choice: false,
  grab: null,
  drunk: 0,
  given: 0,
  kills: 0,
  deaths: 0,
  fps: 0,
  debug: null,
  quality: 'high',
  visionOn: true,
  volume: 0.8,
  loadingText: '',
  cinema: false,
  cineLine: null,
  calm: false,
  lore: null,
  rpg: null,
  rest: null,
  suma: false,
  toasts: [],
  combat: false,
  journal: [],
  sense: false,
  companion: null,
}

type Listener = () => void

function shallowEqual(a: unknown, b: unknown) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a as object)
  if (ka.length !== Object.keys(b as object).length) return false
  for (const k of ka) if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false
  return true
}

class Store {
  private state: HudState = { ...initial }
  private listeners = new Set<Listener>()

  get = () => this.state

  set(partial: Partial<HudState>) {
    let changed = false
    for (const k in partial) {
      const key = k as keyof HudState
      if (!shallowEqual(this.state[key], partial[key])) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.state = { ...this.state, ...partial }
    this.listeners.forEach((l) => l())
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
}

export const hud = new Store()
