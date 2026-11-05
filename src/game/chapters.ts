// The three chapters (docs/STORY.md «Структура из трёх глав», docs/LEVELS.md): what each is built from and what carries over.

import { MAP, ZONES, type Zone } from './level/map'
import { MAP2, ZONES2 } from './level/map2'
import { MAP3, ZONES3 } from './level/map3'
import type { Keepsake } from './rpg/state'
import type { ClueId } from './clues'

export type ChapterId = 1 | 2 | 3

/** what the level is made of: the night forest, the steppe of barrows and black lakes, the cave and the summit */
export type Biome = 'urman' | 'steppe' | 'cave'

export interface ChapterEnv {
  /** the low fog colour of the vision pass */
  fog: [number, number, number]
  /** moonlight colour and its range of strength under the clouds */
  moon: [number, number, number]
  moonMin: number
  moonMax: number
  /** the cold fill: sky and ground colours, strength */
  sky: [number, number, number]
  ground: [number, number, number]
  hemi: number
  exposure: number
  /** drifting particles near the hero */
  air: 'needles' | 'grass' | 'snow'
}

export interface ChapterDef {
  id: ChapterId
  /** «Глава первая» */
  ordinal: string
  title: string
  /** a half-line under the title on the chapter cards */
  sub: string
  map: string[]
  zones: Zone[]
  biome: Biome
  env: ChapterEnv
  /** the first lore page of this chapter's stones (pages are shared in one list, src/ui/Prologue.tsx) */
  loreBase: number
}

export const CHAPTERS: Record<ChapterId, ChapterDef> = {
  1: {
    id: 1,
    ordinal: 'Глава первая',
    title: 'Урман',
    sub: 'ночной лес и торфяные омуты',
    map: MAP,
    zones: ZONES,
    biome: 'urman',
    // docs/LEVELS.md: conifer black-green, peat brown, the swamp blue of the fog, the amber of the coal
    env: { fog: [0.035, 0.05, 0.085], moon: [0.55, 0.68, 1.0], moonMin: 0.5, moonMax: 1.05, sky: [0.16, 0.22, 0.38], ground: [0.04, 0.035, 0.03], hemi: 0.4, exposure: 1.25, air: 'needles' },
    loreBase: 0,
  },
  2: {
    id: 2,
    ordinal: 'Глава вторая',
    title: 'Курганы у Чёрных вод',
    sub: 'каменная степь и зеркальные озёра',
    map: MAP2,
    zones: ZONES2,
    biome: 'steppe',
    // docs/LEVELS.md: ash-silver feather grass (#3a4247), basalt (#12151a), mercury-black water (#0a1017), the turquoise of the ancestors
    env: { fog: [0.045, 0.06, 0.07], moon: [0.62, 0.72, 0.95], moonMin: 0.65, moonMax: 1.2, sky: [0.2, 0.25, 0.32], ground: [0.05, 0.05, 0.055], hemi: 0.5, exposure: 1.25, air: 'grass' },
    loreBase: 3,
  },
  3: {
    id: 3,
    ordinal: 'Глава третья',
    title: 'Чрево Горы',
    sub: 'Шульган-Таш и вершина Иремеля',
    map: MAP3,
    zones: ZONES3,
    biome: 'cave',
    // docs/LEVELS.md: limestone grey (#23272a), blood ochre (#8f241e), icy steam (#a3c1d1), the silver of the spring (#e6f4ff)
    env: { fog: [0.05, 0.065, 0.08], moon: [0.6, 0.72, 0.95], moonMin: 0.55, moonMax: 1.0, sky: [0.14, 0.18, 0.24], ground: [0.05, 0.045, 0.045], hemi: 0.42, exposure: 1.3, air: 'snow' },
    loreBase: 6,
  },
}

/** what Aldar brings from one chapter into the next */
export interface Carry {
  waterDebt: number
  earthHealed: number
  arrows: number
  maxArrows: number
  keepsakes: Keepsake[]
  clues: ClueId[]
  kills: number
  deaths: number
}

export const freshCarry = (): Carry => ({ waterDebt: 0, earthHealed: 0, arrows: 3, maxArrows: 5, keepsakes: [], clues: [], kills: 0, deaths: 0 })

/**
 * The kubair is saved at the threshold of every chapter: what was carried in, so a return starts that chapter anew.
 * A chapter can also be opened directly with `#chapter=2` (play-testing).
 */
const KEY = 'amanat.progress.v2'

export interface Progress {
  chapter: ChapterId
  carry: Carry
}

export function loadProgress(): Progress | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Progress
    if (p.chapter !== 2 && p.chapter !== 3) return null
    return { chapter: p.chapter, carry: { ...freshCarry(), ...p.carry } }
  } catch {
    return null
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* private mode: the kubair is simply not kept */
  }
}

export function clearProgress() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}

/** `#chapter=2` opens that chapter straight away with what a careful player would carry */
export function chapterFromHash(): ChapterId | null {
  const m = /chapter=([123])/.exec(location.hash)
  return m ? (Number(m[1]) as ChapterId) : null
}
