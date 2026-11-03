// RPG data for the vertical slice (see docs/RPG.md). Texts follow docs/UI.md: the property in numbers, one line from the sesen.

export type ItemId = 'arrow' | 'arrow_fire' | 'honey' | 'kumys' | 'bone' | 'hide_wolf' | 'hair' | 'resin' | 'flint' | 'fur_fox' | 'fang' | 'birch_tamga' | 'shurale_finger' | 'arslan_steel'

export type ItemKind = 'ammo' | 'consumable' | 'material' | 'amulet'

export interface ItemDef {
  id: ItemId
  name: string
  kind: ItemKind
  desc: string
  /** the sesen's line about it */
  verse: string
  max?: number
}

export const ITEMS: Record<ItemId, ItemDef> = {
  arrow: { id: 'arrow', name: 'Стрелы', kind: 'ammo', max: 20, desc: 'Промахнувшиеся можно подобрать.', verse: 'Берёза дала древко, кремень дал жало.' },
  arrow_fire: { id: 'arrow_fire', name: 'Огненные стрелы', kind: 'ammo', max: 10, desc: 'Поджигают врага и жаровни. Мёртвым огонь наносит ×1.6.', verse: 'Мёртвые помнят костёр, на котором их провожали.' },
  honey: { id: 'honey', name: 'Дикий мёд', kind: 'consumable', max: 4, desc: '40 здоровья за 10 секунд.', verse: 'Бортник лез за ним на самую высокую сосну.' },
  kumys: { id: 'kumys', name: 'Кумыс', kind: 'consumable', max: 3, desc: '30 секунд: рывки и беркут восстанавливаются быстрее, шаг легче.', verse: 'Взбит в сабе до кислинки, как любил отец.' },
  bone: { id: 'bone', name: 'Кость убыра', kind: 'material', desc: 'На наконечники и обереги.', verse: 'Земля её не приняла.' },
  hide_wolf: { id: 'hide_wolf', name: 'Волчья шкура', kind: 'material', desc: 'Ценится в обмене.', verse: 'Тёмная, ни одного светлого волоса.' },
  hair: { id: 'hair', name: 'Прядь албасты', kind: 'material', desc: 'Шаманка знает, что с ней делать.', verse: 'Холодная, как вода подо льдом.' },
  resin: { id: 'resin', name: 'Смола', kind: 'material', desc: 'У огня: одна смола — три огненные стрелы.', verse: 'Сосна плачет ею, когда её ранят.' },
  flint: { id: 'flint', name: 'Кремень', kind: 'material', desc: 'На наконечники. Пригодится кузнецу.', verse: 'Ударь, и он отдаст огонь.' },
  fur_fox: { id: 'fur_fox', name: 'Лисья шкурка', kind: 'material', desc: 'Дорогой мех для обмена.', verse: 'Рыжая, как березняк в сентябре.' },
  fang: { id: 'fang', name: 'Клык волка', kind: 'amulet', desc: 'Ответ после идеального уклонения зажигает огонь запала.', verse: 'Охотник носил его на шее. Шнурок истёрся до нитки.' },
  birch_tamga: { id: 'birch_tamga', name: 'Берестяная тамга', kind: 'amulet', desc: 'Звуки во тьме слышны дальше и точнее.', verse: 'Её вырезают тем, кто ходит ночью.' },
  arslan_steel: { id: 'arslan_steel', name: 'Огниво Арслана', kind: 'amulet', desc: 'Фонарь тратит масло вдвое медленнее.', verse: 'На рукояти тамга рода Тимера. Такое было у отца.' },
  shurale_finger: { id: 'shurale_finger', name: 'Палец Шурале', kind: 'amulet', desc: 'Враг, пойманный арканом, теряет стойку от смеха.', verse: 'Длинный, сухой и всё ещё гнётся.' },
}

export type StatId = 'str' | 'end' | 'agi' | 'spi'

export const STATS: { id: StatId; name: string; desc: string }[] = [
  { id: 'str', name: 'Сила', desc: 'Удары кылысом и стойка врага' },
  { id: 'end', name: 'Стойкость', desc: 'Здоровье' },
  { id: 'agi', name: 'Ловкость', desc: 'Рывки, лук, стрелы' },
  { id: 'spi', name: 'Дух', desc: 'Беркут, фонарь, живая вода' },
]

export type NodeId = 'fourth' | 'blood' | 'leap' | 'pack' | 'hide'

export const WOLF_NODES: { id: NodeId; name: string; desc: string; requires?: NodeId }[] = [
  { id: 'leap', name: 'Бросок', desc: 'Выпад из рывка, попав, зажигает огонь запала.' },
  { id: 'hide', name: 'Вожак', desc: 'Удар беркута стоит два огня, а не три.', requires: 'leap' },
  { id: 'pack', name: 'Стая', desc: 'Серия переживает паузу до 1.5 секунды: связки можно сшивать.' },
  { id: 'blood', name: 'Кровь стаи', desc: 'В раже финал связки возвращает 8 здоровья.', requires: 'pack' },
  { id: 'fourth', name: 'Упорство', desc: 'Полученный удар не гасит запал.', requires: 'blood' },
]

/** what the sesen sings when Timer reaches a level (index = level) */
export const LEVEL_VERSES: Record<number, string> = {
  1: 'Кубаир о Тимере только начат.',
  2: 'Шёл Тимер урманом, и урман его запомнил.',
  3: 'Кылыс в его руке стал продолжением руки.',
  4: 'Волки обходят его тропу стороной.',
  5: 'Мёртвые оборачиваются ему вслед.',
  6: 'О нём поют уже у чужих костров.',
}

/** total Skaz needed for each level (index = level - 1) */
export const LEVELS = [0, 60, 150, 270, 420, 600, 820, 1080]
export const LEVEL_CAP = 6

export const SKAZ = {
  ubyr: 30,
  wolf: 20,
  albasty: 45,
  boss: 300,
  tamga: 40,
  echo: 25,
  drop: 50,
  clue: 20,
}

/** full lantern burns this many seconds */
export const OIL_SECONDS = 420
