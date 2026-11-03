// Onboarding: one lesson at a time, each closed by doing it, never by a timer (docs/UI.md, «Обучение»).

/** Running totals the game feeds every frame. Steps compare them with the values at the moment they appeared. */
export interface Tally {
  moved: number
  turned: number
  sense: number
  clues: number
  suma: number
  attacks: number
  dodges: number
  stance: number
  sips: number
}

export const zeroTally = (): Tally => ({ moved: 0, turned: 0, sense: 0, clues: 0, suma: 0, attacks: 0, dodges: 0, stance: 0, sips: 0 })

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

export type LessonId = 'path' | 'fight' | 'wounds'

const LESSONS: Record<LessonId, { title: string; steps: Step[] }> = {
  path: {
    title: 'Первые шаги',
    steps: [
      { id: 'move', keys: ['W', 'A', 'S', 'D'], title: 'Идти', text: 'Пройди немного от костра.', done: (d) => d.moved >= 5, progress: (d) => d.moved / 5 },
      { id: 'look', keys: ['Мышь'], title: 'Смотреть', text: 'Тимер видит только то, что перед ним. Обернись: что за спиной?', done: (d) => d.turned >= Math.PI * 1.5, progress: (d) => d.turned / (Math.PI * 1.5) },
      { id: 'sense', keys: ['V'], title: 'Чутьё — держать', text: 'Следы на земле засветятся, знаки замерцают.', done: (d) => d.sense >= 1.5, progress: (d) => d.sense / 1.5 },
      { id: 'clue', keys: ['F'], title: 'Осмотреть знак', text: 'Подойди к мерцающему знаку. Знаки скажут, кто увёл семью.', done: (_d, t) => t.clues >= 1 },
      { id: 'suma', keys: ['Tab'], title: 'Сума', text: 'В разделе «Следы» — что уже известно и чего не хватает.', done: (d) => d.suma >= 1 },
    ],
  },
  fight: {
    title: 'Бой',
    steps: [
      { id: 'attack', keys: ['ЛКМ'], title: 'Удар', text: 'Туда, куда смотрит Тимер. Бей подряд: каждый следующий удар сильнее.', done: (d) => d.attacks >= 3, progress: (d) => d.attacks / 3 },
      { id: 'dodge', keys: ['Пробел'], title: 'Рывок', text: 'В рывке Тимера не задеть. Ромбы внизу слева — сколько рывков в запасе.', done: (d) => d.dodges >= 1 },
      { id: 'stance', keys: ['Shift'], title: 'Стойка — держать', text: 'Тимер стоит лицом к врагу и не теряет его из виду.', done: (d) => d.stance >= 0.8, progress: (d) => d.stance / 0.8 },
    ],
  },
  wounds: {
    title: 'Раны',
    steps: [{ id: 'sip', keys: ['R'], title: 'Глоток живой воды', text: 'Капли внизу слева. Родник наполнит их снова.', done: (d) => d.sips >= 1 }],
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
