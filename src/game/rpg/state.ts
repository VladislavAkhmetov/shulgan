import {
  ITEMS,
  LEVEL_CAP,
  LEVELS,
  OIL_SECONDS,
  WOLF_NODES,
  type ItemId,
  type NodeId,
  type StatId,
} from './data'

export interface RpgSnapshot {
  level: number
  skaz: number
  levelFrom: number
  levelTo: number
  ready: number
  statPoints: number
  tamgaPoints: number
  stats: Record<StatId, number>
  wolfOpen: boolean
  nodes: NodeId[]
  items: [ItemId, number][]
  amulets: ItemId[]
  equipped: ItemId | null
  /** worn clothes: null = the base shirt (docs/EQUIPMENT.md) */
  outfit: OutfitId | null
  outfits: OutfitId[]
  arrowType: 'arrow' | 'arrow_fire'
  oil: number
  honeyT: number
  kumysT: number
  maxHp: number
  /** what one more point would change: [label, now, next] */
  effects: Record<StatId, [string, string, string][]>
}

/** Clothes Timer can wear over the base body; each is a mesh `outfit_<id>` in hero_rig.glb. */
export type OutfitId = 'kaftan'
export const OUTFITS: Record<OutfitId, { name: string; desc: string; verse: string }> = {
  kaftan: { name: 'Кафтан беркутчи', desc: 'Лёгкая одежда охотника: стёганый кафтан, волчья накидка, перчатка для беркута.', verse: 'Айсылу вышивала кускар по краю всю зиму.' },
}

/** Character progression + inventory. Pure data: the Player reads derived values from here. */
export class RpgState {
  skaz = 0
  level = 1
  statPoints = 0
  tamgaPoints = 0
  stats: Record<StatId, number> = { str: 1, end: 1, agi: 1, spi: 1 }
  wolfOpen = false
  nodes = new Set<NodeId>()
  items = new Map<ItemId, number>()
  amulets = new Set<ItemId>()
  equipped: ItemId | null = null
  outfit: OutfitId | null = 'kaftan'
  outfits = new Set<OutfitId>(['kaftan'])
  arrowType: 'arrow' | 'arrow_fire' = 'arrow'
  oil = 1
  honeyT = 0
  kumysT = 0

  constructor() {
    this.items.set('arrow', 20)
    this.items.set('honey', 1)
  }

  // ---------------------------------------------------------------- skaz & levels
  levelFor(skaz: number) {
    let l = 1
    while (l < LEVEL_CAP && skaz >= LEVELS[l]) l++
    return l
  }
  /** levels earned but not yet "sung" at a rest */
  get ready() {
    return this.levelFor(this.skaz) - this.level
  }
  addSkaz(n: number) {
    const before = this.ready
    this.skaz += n
    return this.ready > before
  }
  /** At a spring or fire: the sesen sings the gathered lines and Timer grows. */
  sing() {
    const n = this.ready
    if (n <= 0) return 0
    this.level += n
    this.statPoints += n
    this.tamgaPoints += n
    return n
  }
  /** give back a point (only what was spent at this rest — the Game keeps that count) */
  lower(stat: StatId) {
    if (this.stats[stat] <= 1) return false
    this.stats[stat]--
    this.statPoints++
    return true
  }
  raise(stat: StatId) {
    if (this.statPoints <= 0 || this.stats[stat] >= 20) return false
    this.statPoints--
    this.stats[stat]++
    return true
  }
  canLearn(id: NodeId) {
    const def = WOLF_NODES.find((n) => n.id === id)
    if (!def || !this.wolfOpen || this.nodes.has(id) || this.tamgaPoints <= 0)
      return false
    return !def.requires || this.nodes.has(def.requires)
  }
  learn(id: NodeId) {
    if (!this.canLearn(id)) return false
    this.tamgaPoints--
    this.nodes.add(id)
    return true
  }
  has(id: NodeId) {
    return this.nodes.has(id)
  }

  // ---------------------------------------------------------------- inventory
  count(id: ItemId) {
    return this.items.get(id) ?? 0
  }
  /** returns how many actually fit */
  add(id: ItemId, n: number) {
    const def = ITEMS[id]
    if (def.kind === 'amulet') {
      const fresh = !this.amulets.has(id)
      this.amulets.add(id)
      if (!this.equipped) this.equipped = id
      return fresh ? 1 : 0
    }
    const cur = this.count(id)
    const next = def.max ? Math.min(def.max, cur + n) : cur + n
    this.items.set(id, next)
    return next - cur
  }
  take(id: ItemId, n = 1) {
    const cur = this.count(id)
    if (cur < n) return false
    this.items.set(id, cur - n)
    return true
  }
  equip(id: ItemId | null) {
    if (id && !this.amulets.has(id)) return
    this.equipped = id
  }
  wearing(id: ItemId) {
    return this.equipped === id
  }

  // ---------------------------------------------------------------- derived values
  get maxHp() {
    return Math.round(100 + (this.stats.end - 1) * 12)
  }
  get meleeMult() {
    return 1 + (this.stats.str - 1) * 0.06
  }
  get postureMult() {
    return 1 + (this.stats.str - 1) * 0.05
  }
  get bowDrawTime() {
    return 0.65 * (1 - (this.stats.agi - 1) * 0.05)
  }
  get arrowMult() {
    return 1 + (this.stats.agi - 1) * 0.06
  }
  get dodgeRecharge() {
    return (
      (1.1 * (1 - (this.stats.agi - 1) * 0.04)) / (this.kumysT > 0 ? 1.6 : 1)
    )
  }
  get eagleCd() {
    return 14 * (1 - (this.stats.spi - 1) * 0.06)
  }
  get oilDrain() {
    return (1 / OIL_SECONDS) * (1 - (this.stats.spi - 1) * 0.06) * (this.wearing('arslan_steel') ? 0.5 : 1)
  }
  get waterHeal() {
    return Math.round(48 * (1 + (this.stats.spi - 1) * 0.07))
  }
  get haste() {
    return this.kumysT > 0 ? 1.6 : 1
  }

  private effectRows(id: StatId): [string, number | string][] {
    const pct = (m: number) => `+${Math.round((m - 1) * 100)}%`
    const sec = (v: number) => `${v.toFixed(2).replace(/0$/, '')} с`
    if (id === 'str') return [['Урон клинка', pct(this.meleeMult)], ['Урон по стойке', pct(this.postureMult)]]
    if (id === 'end') return [['Здоровье', this.maxHp]]
    if (id === 'agi') return [['Рывок восстанавливается', sec(this.dodgeRecharge)], ['Натяжение лука', sec(this.bowDrawTime)], ['Урон стрел', pct(this.arrowMult)]]
    return [['Беркут восстанавливается', `${this.eagleCd.toFixed(1)} с`], ['Фонарь горит', `${(1 / this.oilDrain / 60).toFixed(1)} мин`], ['Глоток живой воды', this.waterHeal]]
  }

  /** current and +1 values of everything a stat touches */
  effects(id: StatId): [string, string, string][] {
    const now = this.effectRows(id)
    this.stats[id]++
    const next = this.effectRows(id)
    this.stats[id]--
    return now.map(([label, v], i) => [label, String(v), String(next[i][1])])
  }

  snapshot(): RpgSnapshot {
    return {
      level: this.level,
      skaz: this.skaz,
      levelFrom: LEVELS[this.level - 1] ?? 0,
      levelTo:
        LEVELS[Math.min(LEVEL_CAP, this.level)] ?? LEVELS[LEVELS.length - 1],
      ready: this.ready,
      statPoints: this.statPoints,
      tamgaPoints: this.tamgaPoints,
      stats: { ...this.stats },
      wolfOpen: this.wolfOpen,
      nodes: [...this.nodes],
      items: [...this.items.entries()].filter(([, n]) => n > 0),
      amulets: [...this.amulets],
      equipped: this.equipped,
      outfit: this.outfit,
      outfits: [...this.outfits],
      arrowType: this.arrowType,
      oil: Math.round(this.oil * 100) / 100,
      honeyT: Math.ceil(this.honeyT),
      kumysT: Math.ceil(this.kumysT),
      maxHp: this.maxHp,
      effects: { str: this.effects('str'), end: this.effects('end'), agi: this.effects('agi'), spi: this.effects('spi') },
    }
  }
}
