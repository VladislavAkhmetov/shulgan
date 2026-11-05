// Tiny external store bridging the game loop and React HUD (useSyncExternalStore).

import type { KitSnapshot } from '../rpg/state'
import type { JournalEntry } from '../clues'
import type { TutorView } from '../tutor'

export type Screen = 'title' | 'prologue' | 'epilogue' | 'loading' | 'playing' | 'paused' | 'dead' | 'victory' | 'ending'

/** the three endings (docs/STORY.md «Капли живой воды и три концовки») */
export type EndingId = 'life' | 'blood' | 'shulgen'

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
  dodge: number
  dodgeMax: number
  dodgeRecharge: number
  /** Запал and its ceiling (grows with every drop drunk) */
  fervor: number
  maxFervor: number
  /** eagle cooldown 0..1 (0 = ready) */
  eagleCd: number
  /** the stance: [1] kylys + kalkan or [2] the bow */
  weapon: 'blade' | 'bow'
  /** kalkan is taken from the yurt wall with the coal */
  armed: boolean
  /** the bow is found by the stream */
  hasBow: boolean
  bowDraw: number
  /** the draw is at its peak: a shot now pierces */
  bowPeak: boolean
  /** the next arrow is lit at the vessel */
  fireNocked: boolean
  /** the belt vessel: lit at all, clogged with mud (s left), flash cooldown 0..1, heat focus held */
  vessel: { lit: boolean; clog: number; flashCd: number; focus: boolean }
  /** «Перевести дух» held: 0..1 */
  breath: number
  boss: BossHud | null
  /** what [E] does here; `key` overrides the key, `hold` 0..1 for a held action */
  prompt: { text: string; key: string; hold: number | null } | null
  narration: Narration | null
  hint: string | null
  /** the current onboarding step */
  tutor: TutorView | null
  tutorOn: boolean
  /** the title of a place entered for the first time */
  zone: { id: number; name: string; sub: string } | null
  /** the choice at a drop of living water is open: its number (1..5) */
  choice: number | null
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
  kit: KitSnapshot | null
  toasts: { id: number; text: string; kind: 'item' | 'info' | 'warn'; icon?: string }[]
  combat: boolean
  /** what the signs have told so far */
  journal: JournalEntry[]
  /** Susar, once freed: what she is doing and how many unseen enemies she smells */
  companion: { state: string; threats: number } | null
  /** Azamat at his father's side (chapters 2–3): the kurai's cooldown 0..1 and what he is doing */
  son: { cd: number; state: string } | null
  chapter: 1 | 2 | 3
  /** chapter 3: the choice at the bowl of Yanshishma is open */
  finalChoice: boolean
  ending: EndingId | null
  /** Shulgen's blow from behind: the scar on Aldar's chest flares (0..1) */
  scar: number
  /** chapter 3 without the vessel: the blood senses the way */
  sense: boolean
}

const initial: HudState = {
  screen: 'title',
  hp: 100,
  maxHp: 100,
  dodge: 2,
  dodgeMax: 2,
  dodgeRecharge: 1,
  fervor: 40,
  maxFervor: 100,
  eagleCd: 0,
  weapon: 'blade',
  armed: false,
  hasBow: false,
  bowDraw: 0,
  bowPeak: false,
  fireNocked: false,
  vessel: { lit: false, clog: 0, flashCd: 0, focus: false },
  breath: 0,
  boss: null,
  prompt: null,
  narration: null,
  hint: null,
  tutor: null,
  tutorOn: true,
  zone: null,
  choice: null,
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
  kit: null,
  toasts: [],
  combat: false,
  journal: [],
  companion: null,
  son: null,
  chapter: 1,
  finalChoice: false,
  ending: null,
  scar: 0,
  sense: false,
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

  /** a new chapter starts from a clean HUD; the player's settings stay */
  reset() {
    const { volume, quality, visionOn, tutorOn } = this.state
    this.state = { ...initial, volume, quality, visionOn, tutorOn }
    this.listeners.forEach((l) => l())
  }

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
