/** Deterministic choreography for the eagle review arena. Gameplay remains separate. */
export type Point3 = [number, number, number]
export type EagleDemoMode = 'game' | 'flap' | 'climb' | 'soar' | 'circle_left' | 'circle_right' | 'dive_attack' | 'sweep_attack' | 'grab_attack' | 'talon_strike' | 'talon_grip' | 'beak_call'
export type DemoMotion = {
  position: Point3
  heading: number
  pitch: number
  clip: string
  clipTime: number
  phase: string
  reveal: boolean
  contact: number | null
  targetLift: number
}

export const EAGLE_DEMOS: { id: EagleDemoMode; label: string; duration: number; group: 'flight' | 'attack' | 'detail'; description: string }[] = [
  { id: 'game', label: 'Вылет как в игре · E', duration: 3.9, group: 'flight', description: 'Подъём 0,7 с → облёт 1,3 с → пикирование 0,5 с → уход 1,4 с. Подсветка и удар по выбранной цели.' },
  { id: 'flap', label: 'Полёт со взмахами', duration: 4, group: 'flight', description: 'Низкий пролёт над поляной. Видны силовой взмах и отставание кисти крыла.' },
  { id: 'climb', label: 'Набор высоты', duration: 3, group: 'flight', description: 'Подъём с активными взмахами и поджатыми лапами.' },
  { id: 'soar', label: 'Парение', duration: 5, group: 'flight', description: 'Длинный пролёт на раскрытом крыле, небольшие коррекции хвостом.' },
  { id: 'circle_left', label: 'Кружить влево', duration: Math.PI * 2 / 1.05, group: 'flight', description: 'Полный круг радиусом 4 м, крен внутрь поворота и стабилизация головы.' },
  { id: 'circle_right', label: 'Кружить вправо', duration: Math.PI * 2 / 1.05, group: 'flight', description: 'Тот же манёвр с зеркальным креном.' },
  { id: 'dive_attack', label: 'Удар с высоты', duration: 3.2, group: 'attack', description: 'Сближение сверху, подбор крыла, вынос лап и удар когтями с уходом вверх.' },
  { id: 'sweep_attack', label: 'Бреющая атака', duration: 2.8, group: 'attack', description: 'Быстрый проход на уровне головы, короткий захват когтями и пролёт за цель.' },
  { id: 'grab_attack', label: 'Захват и подъём', duration: 4.2, group: 'attack', description: 'Эксперимент для лёгкой цели: захват лапами, подъём и отпускание.' },
  { id: 'talon_strike', label: 'Удар лапами', duration: .6, group: 'detail', description: 'Разбор позы удара на месте. Контакт когтей на 0,30 с.' },
  { id: 'talon_grip', label: 'Пальцы и когти', duration: 1.2, group: 'detail', description: 'Раскрытие трёх передних пальцев и противопоставленного заднего пальца.' },
  { id: 'beak_call', label: 'Клюв / крик', duration: 1.6, group: 'detail', description: 'Открывание нижней челюсти в отдельном клипе.' },
]

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => { const k = clamp(x); return k * k * (3 - 2 * k) }
const mix = (a: Point3, b: Point3, k: number): Point3 => a.map((n, i) => n + (b[i] - n) * k) as Point3
const along = (a: Point3, b: Point3) => Math.atan2(b[0] - a[0], b[2] - a[2])

export function sampleEagleDemo(mode: EagleDemoMode, time: number, target: Point3): DemoMotion {
  const t = Math.max(0, time)
  const hit: Point3 = [target[0], 1.75, target[2]]
  const out: DemoMotion = { position: [0, 2.5, 0], heading: 0, pitch: 0, clip: 'soar', clipTime: t, phase: 'Парение', reveal: false, contact: null, targetLift: 0 }
  if (mode === 'game') {
    out.contact = 2.5
    out.reveal = t >= .7
    const release: Point3 = [-.4, 1.25, .3]
    const circle = (ct: number): Point3 => {
      const radius = 6 * ease(ct / .22)
      return [Math.sin(ct * 2.2) * radius, 8.5 + Math.sin(ct * 3) * .3 + .75 * (1 - ease(ct / .22)), Math.cos(ct * 2.2) * radius]
    }
    const diveFrom = circle(1.3)
    const heading = along(diveFrom, hit)
    if (t < .7) {
      out.position = [release[0] * (1 - ease(t / .7)), release[1] + t / .7 * 8, release[2] * (1 - ease(t / .7))]
      out.heading = .2; out.pitch = -.4; out.clip = 'climb'; out.phase = 'Набор высоты'
    } else if (t < 2) {
      const ct = t - .7
      out.position = circle(ct); out.heading = ct * 2.2 + Math.PI / 2
      out.clip = 'circle_left'; out.clipTime = ct; out.phase = 'Облёт / раскрытие врагов'
    } else if (t < 2.5) {
      const k = (t - 2) / .5
      out.position = mix(diveFrom, hit, k * k); out.heading = heading
      out.pitch = .8 * (1 - ease((k - .65) / .35))
      out.clip = t < 2.2 ? 'dive' : 'talon_strike'; out.clipTime = t < 2.2 ? (t - 2) * 2.5 : t - 2.2
      out.phase = t < 2.2 ? 'Пикирование' : 'Вынос лап'
    } else {
      const k = t - 2.5
      out.position = [hit[0] + Math.sin(heading) * k * 6, hit[1] + k * 9, hit[2] + Math.cos(heading) * k * 6]
      out.heading = heading; out.pitch = -.65 * ease(k / .2)
      out.clip = t < 2.8 ? 'talon_strike' : 'pull_up'; out.clipTime = t < 2.8 ? t - 2.2 : t - 2.8
      out.phase = k < .12 ? 'Контакт когтей' : 'Уход вверх'
    }
  } else if (mode === 'circle_left' || mode === 'circle_right') {
    const sign = mode === 'circle_left' ? 1 : -1
    const a = t * 1.05 * sign
    out.position = [Math.sin(a) * 4, 4.2 + Math.sin(t * 2.1) * .12, Math.cos(a) * 4]
    out.heading = a + sign * Math.PI / 2; out.clip = mode; out.phase = sign === 1 ? 'Круг влево' : 'Круг вправо'
  } else if (mode === 'flap' || mode === 'soar') {
    const k = clamp(t / (mode === 'flap' ? 4 : 5))
    out.position = [-6 + k * 12, mode === 'flap' ? 2.3 : 4, Math.sin(k * Math.PI) * 1.5 - 1]
    out.heading = Math.atan2(12, Math.cos(k * Math.PI) * Math.PI * 1.5)
    out.clip = mode === 'flap' ? 'flight_flap' : 'soar'; out.phase = mode === 'flap' ? 'Полёт со взмахами' : 'Парение'
  } else if (mode === 'climb') {
    out.position = [-2 + t * .6, 1.5 + t * 2, -2 + t * .5]
    out.heading = Math.atan2(.6, .5); out.pitch = -.45; out.clip = 'climb'; out.phase = 'Набор высоты'
  } else if (mode === 'dive_attack' || mode === 'grab_attack') {
    const grab = mode === 'grab_attack'
    const contact = grab ? 1.4 : 1.6
    const from: Point3 = [target[0] - 5, grab ? 5 : 7.5, target[2] - 4]
    out.contact = contact; out.heading = along(from, hit)
    if (t < .5) {
      out.position = mix([from[0] - 1, from[1] + .15, from[2] - .8], from, ease(t / .5))
      out.clip = 'soar'; out.phase = 'Заход на цель'
    } else if (t < contact) {
      const k = clamp((t - .5) / (contact - .5))
      out.position = mix(from, hit, k * k); out.pitch = .7 * (1 - ease((k - .65) / .35))
      out.clip = t < contact - .3 ? 'dive' : 'talon_strike'
      out.clipTime = t < contact - .3 ? (t - .5) / (contact - .8) * .5 : t - (contact - .3)
      out.phase = t < contact - .3 ? 'Пикирование' : 'Раскрытие когтей'
    } else if (grab && t < 3.1) {
      const k = ease((t - contact) / 1.7)
      out.position = [hit[0] + k * .7, hit[1] + k * 2.5, hit[2] + k * .5]
      out.clip = 'talon_grip'; out.clipTime = Math.min(1.1, .3 + t - contact)
      out.targetLift = k * 2.5; out.phase = t < 1.6 ? 'Захват' : 'Подъём лёгкой цели'; out.pitch = -.15
    } else {
      const start = grab ? 3.1 : contact
      const k = t - start
      out.position = [hit[0] + (grab ? .7 : 0) + Math.sin(out.heading) * k * 4, hit[1] + (grab ? 2.5 : 0) + k * 3, hit[2] + (grab ? .5 : 0) + Math.cos(out.heading) * k * 4]
      out.pitch = -.4 * ease(k / .2)
      out.clip = !grab && k < .3 ? 'talon_strike' : 'pull_up'; out.clipTime = !grab && k < .3 ? .3 + k : k
      out.targetLift = grab ? 2.5 * (1 - ease(k / .6)) : 0
      out.phase = grab && k < .6 ? 'Отпускание цели' : 'Выход из атаки'
    }
  } else if (mode === 'sweep_attack') {
    out.contact = 1.2; out.heading = Math.PI / 2
    out.position = [target[0] + (t - 1.2) * 5.5, 1.75 + Math.max(0, t - 1.5) ** 2 * 1.2, target[2]]
    out.clip = t < .9 ? 'flight_flap' : t < 1.5 ? 'talon_strike' : 'pull_up'
    out.clipTime = t < .9 ? t : t < 1.5 ? t - .9 : t - 1.5
    out.pitch = -.35 * ease((t - 1.5) / .5)
    out.phase = t < .9 ? 'Бреющий проход' : t < 1.2 ? 'Вынос лап' : t < 1.35 ? 'Контакт когтей' : 'Пролёт за цель'
  } else {
    out.position = [0, 2, 0]; out.clip = mode; out.phase = mode === 'beak_call' ? 'Клюв / крик' : mode === 'talon_grip' ? 'Смыкание пальцев' : 'Удар лапами'
    out.contact = mode === 'talon_strike' ? .3 : null
  }
  return out
}
