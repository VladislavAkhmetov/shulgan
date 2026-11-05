// What Aldar carries (docs/COMBAT.md, docs/LEVELS.md «Карта ключевых триггеров», docs/ROADMAP.md «Решения реализации»).
// Pure data: the Player and the Game read derived values from here.

/** keepsakes act always once found; they are listed in the journal */
export type Keepsake = 'fang' | 'feather'

export const KEEPSAKES: Record<Keepsake, { name: string; desc: string; verse: string }> = {
  fang: { name: 'Волчий клык', desc: 'Ответное рассечение +20% урона.', verse: 'Охотник волчьего рода носил его на шее. Шнурок истёрся до нитки.' },
  feather: { name: 'Воронье перо', desc: 'Упавшие и застрявшие стрелы видны в темноте.', verse: 'Ворон стащил его у кого-то в гнездо. Перо всё ещё пахнет дымом.' },
}

export interface KitSnapshot {
  ember: boolean
  bow: boolean
  arrows: number
  maxArrows: number
  fervor: number
  maxFervor: number
  waterDebt: number
  earthHealed: number
  keepsakes: Keepsake[]
  vesselGiven: boolean
}

export class KitState {
  /** the last coal of the home hearth is in the belt vessel (TRG_CH1_EMBER): light, kalkan */
  ember = false
  /** Aldar's bow, lost by Azamat and found by the stream (TRG_CH1_BOW_STREAM) */
  bow = false
  arrows = 0
  maxArrows = 5
  /** Запал */
  fervor = 40
  /** drops of living water drunk */
  waterDebt = 0
  /** drops given back to the earth */
  earthHealed = 0
  keepsakes = new Set<Keepsake>()
  /** chapter 3, zone 2: the vessel is left with Azamat — no light, no flash, no fire arrows (docs/LEVELS.md) */
  vesselGiven = false

  get maxFervor() {
    return 100 + 20 * this.waterDebt
  }
  /** «повышает урон кылыса»: +10% for every drop drunk */
  get meleeMult() {
    return 1 + 0.1 * this.waterDebt
  }
  /** the draw is 0.9 s and grows 15% faster for every drop drunk */
  get drawTime() {
    return 0.9 / (1 + 0.15 * this.waterDebt)
  }
  /** the coal dims by 6% for every drop: the water of Shulgen drives out Aldar's own blood */
  get lightMult() {
    return Math.max(0.4, 1 - 0.06 * this.waterDebt)
  }

  /** returns how many fit in the quiver */
  addArrows(n: number) {
    const before = this.arrows
    this.arrows = Math.min(this.maxArrows, this.arrows + n)
    return this.arrows - before
  }
  takeArrow() {
    if (this.arrows <= 0) return false
    this.arrows--
    return true
  }
  get quiverRoom() {
    return this.maxArrows - this.arrows
  }

  addFervor(n: number) {
    this.fervor = Math.min(this.maxFervor, this.fervor + n)
  }
  spendFervor(n: number) {
    if (this.fervor < n) return false
    this.fervor -= n
    return true
  }

  snapshot(): KitSnapshot {
    return {
      ember: this.ember,
      bow: this.bow,
      arrows: this.arrows,
      maxArrows: this.maxArrows,
      fervor: Math.floor(this.fervor),
      maxFervor: this.maxFervor,
      waterDebt: this.waterDebt,
      earthHealed: this.earthHealed,
      keepsakes: [...this.keepsakes],
      vesselGiven: this.vesselGiven,
    }
  }
}
