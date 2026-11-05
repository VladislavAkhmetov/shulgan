// Onboarding: one lesson at a time, each closed by doing it, never by a timer (docs/UI.md, «Обучение»).

/** Running totals the game feeds every frame. Steps compare them with the values at the moment they appeared. */
export interface Tally {
  moved: number
  turned: number
  /** the coal is in the vessel: 0 or 1 */
  ember: number
  /** seconds of the heat focus */
  focus: number
  attacks: number
  dodges: number
  /** seconds behind the kalkan */
  guard: number
  parries: number
  bashes: number
  /** the bow is out: 0 or 1 */
  bow: number
  /** seconds drawing */
  draw: number
  shots: number
  breaths: number
  /** times Azamat played the kurai */
  kurai: number
  /** seconds of the blood sense (chapter 3, without the vessel) */
  sense: number
}

export const zeroTally = (): Tally => ({ moved: 0, turned: 0, ember: 0, focus: 0, attacks: 0, dodges: 0, guard: 0, parries: 0, bashes: 0, bow: 0, draw: 0, shots: 0, breaths: 0, kurai: 0, sense: 0 })

interface Step {
  id: string
  keys: string[]
  title: string
  text: string
  /** `d` — progress since the step appeared, `t` — totals */
  done: (d: Tally, t: Tally) => boolean
  /** 0..1 for a slow action (walk, hold) */
  progress?: (d: Tally) => number
}

export type LessonId = 'path' | 'fight' | 'parry' | 'bow' | 'wounds' | 'kurai' | 'sense'

const LESSONS: Record<LessonId, { title: string; steps: Step[] }> = {
  path: {
    title: 'Первые шаги',
    steps: [
      { id: 'move', keys: ['W', 'A', 'S', 'D'], title: 'Идти', text: 'Подойди к юрте.', done: (d) => d.moved >= 5, progress: (d) => d.moved / 5 },
      { id: 'look', keys: ['Мышь'], title: 'Смотреть', text: 'Алдар видит только то, что перед ним. Обернись: что за спиной?', done: (d) => d.turned >= Math.PI * 1.5, progress: (d) => d.turned / (Math.PI * 1.5) },
      { id: 'ember', keys: ['E'], title: 'Последний уголь', text: 'Внутри юрты, под перевёрнутым казаном, ещё тлеет уголь родного очага.', done: (_d, t) => t.ember >= 1 },
      { id: 'focus', keys: ['F'], title: 'Фокус жара — держать', text: 'Жар сосуда на поясе проявит следы в грязи.', done: (d) => d.focus >= 1.5, progress: (d) => d.focus / 1.5 },
    ],
  },
  fight: {
    title: 'Бой',
    steps: [
      { id: 'attack', keys: ['ЛКМ'], title: 'Серия кылыса', text: 'Три удара подряд, каждый сильнее прежнего.', done: (d) => d.attacks >= 3, progress: (d) => d.attacks / 3 },
      { id: 'guard', keys: ['ПКМ'], title: 'Калкан — держать', text: 'Щит принимает удар целиком, но тратит запал.', done: (d) => d.guard >= 0.8, progress: (d) => d.guard / 0.8 },
      { id: 'dodge', keys: ['Пробел'], title: 'Перекат', text: 'В перекате Алдара не задеть. Красный блик — только так.', done: (d) => d.dodges >= 1 },
      { id: 'bash', keys: ['Shift', 'ЛКМ'], title: 'Удар щитом', text: 'Кромкой калкана: отбрасывает и сбивает защиту. В блоке — [E].', done: (d) => d.bashes >= 1 },
    ],
  },
  parry: {
    title: 'Калкан',
    steps: [{ id: 'parry', keys: ['ПКМ'], title: 'Парирование', text: 'Подними щит в миг удара: враг потеряет равновесие, сразу [ЛКМ] — ответное рассечение.', done: (d) => d.parries >= 1 }],
  },
  bow: {
    title: 'Лук йәйә',
    steps: [
      { id: 'stance', keys: ['2', 'Tab'], title: 'Стойка с луком', text: 'Или [Tab]. Стрел мало: их можно выдернуть из тел и деревьев, о камень они ломаются.', done: (_d, t) => t.bow >= 1 },
      { id: 'draw', keys: ['ПКМ'], title: 'Натянуть — держать', text: 'На пике натяжения линия вспыхнет: в этот миг выстрел пробивает насквозь.', done: (d) => d.draw >= 0.6, progress: (d) => d.draw / 0.6 },
      { id: 'shot', keys: ['ЛКМ'], title: 'Выстрел', text: 'Не отпуская [ПКМ].', done: (d) => d.shots >= 1 },
    ],
  },
  kurai: {
    title: 'Азамат',
    steps: [{ id: 'kurai', keys: ['Q'], title: 'Зов курая', text: 'Сын играет: броня духов трескается, древние камни отвечают голосами прошлого. Курай отдыхает 10 секунд.', done: (d) => d.kurai >= 1 }],
  },
  sense: {
    title: 'Без огня',
    steps: [{ id: 'sense', keys: ['F'], title: 'Чутьё крови — держать', text: 'Живая вода в крови Алдара тянется к роднику: серебряные искры показывают тропу.', done: (d) => d.sense >= 1.2, progress: (d) => d.sense / 1.2 }],
  },
  wounds: {
    title: 'Раны',
    steps: [{ id: 'breath', keys: ['V'], title: 'Перевести дух — держать', text: 'Сгорает 50 запала, возвращается здоровье. Старый ключ лечит полностью.', done: (d) => d.breaths >= 1 }],
  },
}

export interface TutorView {
  key: string
  lesson: string
  index: number
  of: number
  keys: string[]
  title: string
  text: string
  progress: number | null
  done: boolean
}

const STORE_KEY = 'amanat.tutor'

export class Tutor {
  /** lessons waiting, the current one first */
  private queue: { id: LessonId; i: number; base: Tally | null }[] = []
  private started = new Set<LessonId>()
  private doneT = -1
  enabled = true
  readonly tally = zeroTally()

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORE_KEY) !== 'off'
    } catch {
      /* storage unavailable */
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on
    try {
      localStorage.setItem(STORE_KEY, on ? 'on' : 'off')
    } catch {
      /* storage unavailable */
    }
  }

  /** Start a lesson once. `urgent` puts it before the current one (danger cannot wait for the journal). */
  begin(id: LessonId, urgent = false) {
    if (this.started.has(id)) return
    this.started.add(id)
    const item = { id, i: 0, base: null }
    if (urgent && this.queue.length && this.doneT < 0) {
      this.queue[0].base = null
      this.queue.unshift(item)
    } else if (urgent && this.queue.length) this.queue.splice(1, 0, item)
    else this.queue.push(item)
  }

  get active() {
    return this.enabled && this.queue.length > 0
  }

  /** Returns true the frame a step is completed (for a sound). */
  update(dt: number): boolean {
    const cur = this.queue[0]
    if (!cur) return false
    const step = LESSONS[cur.id].steps[cur.i]
    if (!cur.base) cur.base = { ...this.tally }
    if (this.doneT >= 0) {
      this.doneT -= dt
      if (this.doneT < 0) this.advance()
      return false
    }
    if (step.done(this.delta(cur.base), this.tally)) {
      this.doneT = 1.1
      return this.enabled
    }
    return false
  }

  private advance() {
    const cur = this.queue[0]
    cur.i++
    cur.base = null
    if (cur.i >= LESSONS[cur.id].steps.length) this.queue.shift()
    if (this.queue[0]) this.queue[0].base = null
  }

  private delta(base: Tally): Tally {
    const d = zeroTally()
    for (const k in d) {
      const key = k as keyof Tally
      d[key] = this.tally[key] - base[key]
    }
    return d
  }

  view(): TutorView | null {
    const cur = this.queue[0]
    if (!this.enabled || !cur) return null
    const lesson = LESSONS[cur.id]
    const step = lesson.steps[cur.i]
    const done = this.doneT >= 0
    const p = step.progress && cur.base ? Math.max(0, Math.min(1, step.progress(this.delta(cur.base)))) : null
    return {
      key: `${cur.id}-${step.id}`,
      lesson: lesson.title,
      index: cur.i + 1,
      of: lesson.steps.length,
      keys: step.keys,
      title: step.title,
      text: step.text,
      progress: done && p !== null ? 1 : p === null ? null : Math.round(p * 20) / 20,
      done,
    }
  }
}
