// The journal «Следы»: signs along the way and the questions they answer (docs/LEVELS.md, TRG_CH1_RIBBON; docs/DIALOGUES.md).

export type QuestionId = 'who' | 'alive' | 'why' | 'past' | 'price'
export type ClueId = 'fur' | 'prints' | 'cradle' | 'hair' | 'ribbon' | 'kurai' | 'camp_cradle' | 'tamga' | 'kurgan_echo' | 'horseman' | 'mirror' | 'arslan' | 'ochre' | 'susar_gift'

export interface ClueDef {
  id: ClueId
  q: QuestionId
  /** what the [E] prompt says (empty: found another way — a trigger, a tamga stone) */
  prompt: string
  /** Aldar's words when he looks closer */
  thought: string
  /** the line it adds to the journal */
  note: string
}

export const CLUES: Record<ClueId, ClueDef> = {
  fur: { id: 'fur', q: 'who', prompt: 'Осмотреть порог', thought: 'Убыры. Вырылись прямо из-под кошмы... И зверёк какой-то кидался им в ноги. Держал у порога.', note: 'Убыры вырылись из-под кошмы. Какой-то рыжий зверёк держал их у порога.' },
  prints: { id: 'prints', q: 'alive', prompt: 'Осмотреть следы', thought: 'Ичиги Айсылу. Рядом — босые, длинные... А поверх — сапожки Азамата. Сам побежал за матерью в урман.', note: 'Айсылу увели. Азамат сам побежал за матерью в урман.' },
  cradle: { id: 'cradle', q: 'why', prompt: 'Осмотреть колыбель', thought: 'Колыбель в инее. Пустая. Её даже не тронули.', note: 'Колыбель не тронули: пришли не за вещами.' },
  hair: { id: 'hair', q: 'who', prompt: 'Осмотреть руку охотника', thought: 'В кулаке у охотника седая прядь. Длинная, до самых пят.', note: 'Охотник дрался с той, у кого седые волосы до пят.' },
  ribbon: { id: 'ribbon', q: 'alive', prompt: 'Осмотреть ленту', thought: 'Синяя шерсть. Айсылу вплетала её в косу по утрам. Низко повязана — как раз по плечо Азамату. Сын показывает мне дорогу.', note: 'Азамат повязал ленту матери по плечо себе: показывает дорогу.' },
  kurai: { id: 'kurai', q: 'alive', prompt: '', thought: '', note: 'Из чащи впереди доносится курай Азамата.' },
  camp_cradle: { id: 'camp_cradle', q: 'why', prompt: 'Осмотреть колыбель', thought: 'И здесь колыбель. Пустая. В этом кочевье тоже ждали ребёнка.', note: 'В разорённом кочевье тоже ждали ребёнка.' },
  tamga: { id: 'tamga', q: 'why', prompt: '', thought: '', note: 'Албасты уводит к воде тех, кто носит дитя (тамга на балбале).' },
  kurgan_echo: { id: 'kurgan_echo', q: 'past', prompt: '', thought: '', note: 'Голос кургана: тридцать зим назад Арслан скакал с гор с живой водой к умирающему первенцу.' },
  horseman: { id: 'horseman', q: 'past', prompt: '', thought: '', note: 'Стела Всадника: мёртвые помнят того, кто взял у родника воду и не вернул.' },
  mirror: { id: 'mirror', q: 'past', prompt: '', thought: '', note: 'В Чёрных озёрах вместо Алдара отражается Арслан, а вместо куницы — мать в коралловом кашмау.' },
  arslan: { id: 'arslan', q: 'price', prompt: '', thought: '', note: 'Тень Арслана: родник вытолкнул отца — в нём текла простая смертная кровь.' },
  ochre: { id: 'ochre', q: 'price', prompt: '', thought: '', note: 'Охра в пещере: один брат расплескал воду по земле, другой выпил — и не может умереть.' },
  susar_gift: { id: 'susar_gift', q: 'price', prompt: '', thought: '', note: 'Сусар отдала Азамату последний ҡот и ушла вместе с Арсланом.' },
}

/** `chapter` — from which chapter the question is shown (the journal does not run ahead of the story) */
export const QUESTIONS: { id: QuestionId; chapter: number; title: string; clues: ClueId[]; answer: string }[] = [
  { id: 'who', chapter: 1, title: 'Кто пришёл к юрте?', clues: ['fur', 'hair'], answer: 'Убыры вырылись из-под земли. Вела их та, у кого седые волосы до пят.' },
  { id: 'alive', chapter: 1, title: 'Живы ли они?', clues: ['prints', 'ribbon', 'kurai'], answer: 'Азамат жив и ведёт отца по следу. Айсылу уводят дальше.' },
  { id: 'why', chapter: 1, title: 'Зачем им Айсылу?', clues: ['cradle', 'camp_cradle', 'tamga'], answer: 'Албасты пришла за ребёнком, которого носит Айсылу. Но почему ей позволено?' },
  { id: 'past', chapter: 2, title: 'Что было тридцать зим назад?', clues: ['kurgan_echo', 'horseman', 'mirror'], answer: 'Отец напоил умирающего Алдара живой водой с Иремеля. А мать отдала ему свой ҡот — и обернулась куницей Сусар.' },
  { id: 'price', chapter: 3, title: 'Чем платят роднику?', clues: ['arslan', 'ochre', 'susar_gift'], answer: 'Родник возьмёт только украденную воду — или всю кровь того, в ком она течёт. Чем больше вернул земле, тем меньше он возьмёт.' },
]

export interface JournalEntry {
  id: QuestionId
  title: string
  found: string[]
  total: number
  answer: string | null
}

export function journal(found: Set<ClueId>, chapter = 1): JournalEntry[] {
  return QUESTIONS.filter((q) => q.chapter <= chapter).map((q) => {
    const f = q.clues.filter((c) => found.has(c))
    return { id: q.id, title: q.title, found: f.map((c) => CLUES[c].note), total: q.clues.length, answer: f.length === q.clues.length ? q.answer : null }
  })
}
