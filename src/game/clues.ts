// Tracking: signs of the abductors along the path, and the questions they answer (docs/TRACKING.md).

export type QuestionId = 'who' | 'alive' | 'why' | 'where'
export type ClueId = 'prints' | 'cradle' | 'cloth' | 'whistle' | 'hair' | 'ribbon' | 'camp_cradle' | 'lore_albasty' | 'turn' | 'charms'

export interface ClueDef {
  id: ClueId
  q: QuestionId
  /** what the [F] prompt says */
  prompt: string
  /** Timer's thought when he looks closer (empty: found another way, e.g. reading a tamga) */
  thought: string
  /** the line it adds to the journal */
  note: string
}

export const CLUES: Record<ClueId, ClueDef> = {
  prints: { id: 'prints', q: 'who', prompt: 'Осмотреть следы', thought: 'Следы Айсылу и Азамата. Рядом босые, и пятка не гнётся. Так ходят мёртвые.', note: 'У юрты были убыры: босые следы, пятка не гнётся.' },
  hair: { id: 'hair', q: 'who', prompt: 'Осмотреть руку охотника', thought: 'В кулаке у охотника прядь чёрных волос. Длинная, как аркан.', note: 'Охотник дрался с той, у кого волосы до земли.' },
  cloth: { id: 'cloth', q: 'alive', prompt: 'Снять лоскут с ветки', thought: 'Лоскут от платья Айсылу. Шаги ровные, её не тащили. Её вели.', note: 'Айсылу шла сама: её вели, а не тащили.' },
  whistle: { id: 'whistle', q: 'alive', prompt: 'Поднять курай', thought: 'Курай Азамата. Детские следы уходят в чащу, одни. Он вырвался.', note: 'Азамат вырвался и убежал в чащу. За ним никто не пошёл.' },
  ribbon: { id: 'ribbon', q: 'alive', prompt: 'Осмотреть ленту', thought: 'Синяя лента на берёзе духов. Свежая. Айсылу оставляет знак.', note: 'Айсылу жива и оставляет знаки.' },
  cradle: { id: 'cradle', q: 'why', prompt: 'Осмотреть колыбель', thought: 'Огонь обошёл колыбель. Её даже не тронули.', note: 'Колыбель цела. Пришедшие искали не вещи.' },
  camp_cradle: { id: 'camp_cradle', q: 'why', prompt: 'Осмотреть колыбель', thought: 'И здесь колыбель. Пустая. В этом кочевье тоже ждали ребёнка.', note: 'В разорённом кочевье тоже ждали ребёнка.' },
  lore_albasty: { id: 'lore_albasty', q: 'why', prompt: '', thought: '', note: 'Албасты приходит к тем, кто носит дитя (вторая тамга).' },
  turn: { id: 'turn', q: 'where', prompt: 'Осмотреть борозды', thought: 'Здесь борозды мёртвых поворачивают на восход. К горам.', note: 'Их ведут на восход, к горам.' },
  charms: { id: 'charms', q: 'where', prompt: 'Осмотреть обереги', thought: 'Обереги свежие. Кто-то здесь боится. Впереди плачет ребёнок.', note: 'Впереди поляна хозяина урмана. Там плачет ребёнок.' },
}

export const QUESTIONS: { id: QuestionId; title: string; clues: ClueId[]; answer: string }[] = [
  { id: 'who', title: 'Кто пришёл к юрте?', clues: ['prints', 'hair'], answer: 'Семью увели убыры. Вела их албасты.' },
  { id: 'alive', title: 'Живы ли они?', clues: ['cloth', 'whistle', 'ribbon'], answer: 'Оба живы. Азамат где-то в урмане, Айсылу ведут дальше.' },
  { id: 'why', title: 'Почему мы?', clues: ['cradle', 'camp_cradle', 'lore_albasty'], answer: 'Албасты пришла за ребёнком, которого носит Айсылу. Но почему ей позволено?' },
  { id: 'where', title: 'Куда их ведут?', clues: ['turn', 'charms'], answer: 'На восход, к горам. А сначала через поляну Шурале.' },
]

export interface JournalEntry {
  id: QuestionId
  title: string
  found: string[]
  total: number
  answer: string | null
}

export function journal(found: Set<ClueId>): JournalEntry[] {
  return QUESTIONS.map((q) => {
    const f = q.clues.filter((c) => found.has(c))
    return { id: q.id, title: q.title, found: f.map((c) => CLUES[c].note), total: q.clues.length, answer: f.length === q.clues.length ? q.answer : null }
  })
}
