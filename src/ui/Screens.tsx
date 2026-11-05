import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Game } from '../game/Game'
import { useHud } from './useHud'
import { Glyph } from './glyphs'
import { Key, Mark, Rich, Seal, useNav } from './kit'
import { Epilogue, LorePage, Prologue } from './Prologue'
import { KEEPSAKES } from '../game/rpg/state'
import { CHAPTERS, loadProgress, type Progress } from '../game/chapters'
import { ENDINGS } from '../game/script'
import { MenuBackdrop } from './MenuBackdrop'

// docs/ROADMAP.md, «Управление»
const CONTROLS: [string, string][] = [
  ['WASD', 'Идти'],
  ['Мышь', 'Смотреть и целиться'],
  ['Tab · 1 · 2', 'Стойка: кылыс и калкан · лук'],
  ['ЛКМ', 'Серия кылыса, держать — тяжёлый выпад'],
  ['ПКМ', 'Калкан: держать — блок, в миг удара — парирование'],
  ['Shift + ЛКМ', 'Удар щитом (в блоке — E)'],
  ['ПКМ → ЛКМ', 'Лук: натянуть, на пике — пробивной выстрел'],
  ['Пробел', 'Перекат'],
  ['F', 'Сосуд: вспышка, держать — фокус жара'],
  ['F', 'С луком: огненная стрела (35 запала)'],
  ['R', 'Беркут Кара: коготь с неба'],
  ['Q', 'Курай Азамата (главы 2–3)'],
  ['V', 'Перевести дух (держать, 50 запала)'],
  ['E', 'Действие, подобрать, добить'],
  ['Колесо', 'Приблизить'],
  ['Esc', 'Пауза и журнал «Следы»'],
]

function Controls() {
  return (
    <div className="grid grid-cols-2 gap-x-10 gap-y-2.5 font-ui text-[15px]">
      {CONTROLS.map(([k, v]) => (
        <div key={k + v} className="flex items-center gap-3">
          <span className="w-[70px] text-right">
            <Key k={k} />
          </span>
          <span className="text-bone/75">{v}</span>
        </div>
      ))}
    </div>
  )
}

function Line({ label, on, onHover, onClick, center = false, dim = false }: { label: ReactNode; on: boolean; onHover: () => void; onClick: () => void; center?: boolean; dim?: boolean }) {
  return (
    <button onMouseEnter={onHover} onClick={onClick} className={`flex items-center gap-3 py-1.5 transition-colors duration-150 ${center ? 'justify-center' : ''} ${on ? 'text-amber' : dim ? 'text-bone/40' : 'text-bone/75 hover:text-bone'}`}>
      <Mark on={on} />
      <span className="font-display text-[28px] leading-tight">{label}</span>
      {center && <Mark on={on} />}
    </button>
  )
}

// ---------------------------------------------------------------- title

function Title({ game, onContinue }: { game: Game; onContinue: (p: Progress) => void }) {
  const s = useHud()
  const loading = !!s.loadingText
  const [controls, setControls] = useState(false)
  // the kubair is kept at the threshold of every chapter
  const [saved] = useState(() => (game.chapter === 1 ? loadProgress() : null))
  const first = game.chapter === 1 ? 'Войти в урман' : `${game.def.ordinal}: ${game.def.title}`
  const items = [
    ...(saved && !loading ? [{ label: `Продолжить: ${CHAPTERS[saved.chapter].title}`, run: () => onContinue(saved) }] : []),
    { label: loading ? s.loadingText : saved ? 'Начать кубаир заново' : first, run: () => !loading && game.start() },
    { label: 'Управление', run: () => setControls(true) },
  ]
  const [i, setI] = useNav({ count: items.length, enabled: !controls, onOk: (k) => items[k].run() })
  useNav({ count: 0, enabled: controls, onOk: () => setControls(false), onBack: () => setControls(false) })
  return (
    <div className="absolute inset-0 isolate overflow-hidden select-none bg-[#020306]">
      <MenuBackdrop dim={controls} />
      <div className="anim-fade-up absolute inset-x-0 top-[17vh] flex flex-col items-center">
        <Seal size={58} />
        <h1 className="mt-6 font-display text-[clamp(84px,11vw,148px)] leading-[0.9] tracking-[0.08em] text-bone [text-shadow:0_4px_40px_rgba(0,0,0,0.9)]">АМАНАТ</h1>
        <div className="mt-4 font-tale text-[22px] italic text-bone/65">Кубаир об Алдаре-беркутчи</div>
      </div>
      <div className="absolute inset-x-0 top-[62vh] flex flex-col items-center">
        {controls ? (
          <div className="anim-pane flex flex-col items-center">
            <Controls />
            <button onClick={() => setControls(false)} className="mt-8 font-ui text-[14px] text-bone/55 hover:text-bone">
              <Rich text="[Esc] Назад" />
            </button>
          </div>
        ) : (
          items.map((it, k) => <Line key={k} center label={it.label} dim={loading && it.label === s.loadingText} on={k === i} onHover={() => setI(k)} onClick={it.run} />)
        )}
      </div>
      <div className="absolute bottom-7 left-8 font-ui text-[13px] text-bone/40">Играйте в наушниках: здесь многое слышно раньше, чем видно</div>
      <div className="absolute bottom-7 right-8 text-right font-ui text-[13px] text-bone/30">
        <a href="/#viewer=berkut" className="mb-1 block text-amber/65 hover:text-amber">Полигон беркута · движения и атаки</a>
        <a href="/audio/wolf/CREDITS.md" target="_blank" rel="noopener noreferrer" className="mb-1 block underline decoration-bone/20 underline-offset-4 hover:text-bone/70">Звуки волков · авторы</a>
        <div>Кубаир в трёх главах</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- pause

function Choice2({ value, options, on }: { value: string; options: [string, string][]; on: boolean }) {
  return (
    <span className="flex items-center gap-3 font-ui text-[16px]">
      {options.map(([v, l]) => (
        <span key={v} className={value === v ? (on ? 'text-amber' : 'text-bone') : 'text-bone/30'}>
          {l}
        </span>
      ))}
    </span>
  )
}

/** «Следы»: what the signs told, the keepsakes, the drops of living water */
function Journal() {
  const s = useHud()
  const k = s.kit
  return (
    <div className="w-[min(560px,46vw)] font-ui">
      {s.journal.map((q) => (
        <div key={q.id} className="mb-5">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[24px] leading-none text-bone">{q.title}</span>
            <span className="text-[13px] text-bone/45">
              {q.found.length} из {q.total}
            </span>
          </div>
          <ul className="mt-1.5 flex flex-col gap-1 text-[15px] leading-snug text-bone/75">
            {q.found.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rotate-45 bg-amber/70" />
                {n}
              </li>
            ))}
            {Array.from({ length: q.total - q.found.length }, (_, i) => (
              <li key={i} className="flex gap-2 text-bone/25">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rotate-45 border border-bone/25" />…
              </li>
            ))}
          </ul>
          {q.answer && <p className="mt-1.5 font-tale text-[18px] italic text-amber/85">{q.answer}</p>}
        </div>
      ))}
      {k && k.keepsakes.length > 0 && (
        <div className="mb-4">
          <div className="font-display text-[22px] text-bone">Обереги</div>
          {k.keepsakes.map((id) => (
            <div key={id} className="mt-1.5 flex items-start gap-3">
              <Glyph id={id} size={22} className="mt-0.5 text-amber" />
              <div>
                <div className="text-[15px] text-bone/85">
                  {KEEPSAKES[id].name} · <span className="text-bone/60">{KEEPSAKES[id].desc}</span>
                </div>
                <div className="font-tale text-[15px] italic text-bone/45">{KEEPSAKES[id].verse}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {k && (
        <div className="text-[14px] text-bone/55">
          Капли живой воды: отдано земле {k.earthHealed}, выпито {k.waterDebt}. Стрелы: {k.arrows} из {k.maxArrows}.
        </div>
      )}
    </div>
  )
}

function Pause({ game }: { game: Game }) {
  const s = useHud()
  const items: { id: 'go' | 'journal' | 'settings' | 'controls' | 'restart'; label: string }[] = [
    { id: 'go', label: 'Продолжить' },
    { id: 'journal', label: 'Следы' },
    { id: 'settings', label: 'Настройки' },
    { id: 'controls', label: 'Управление' },
    { id: 'restart', label: 'Начать заново' },
  ]
  const [inPane, setInPane] = useState(false)
  const run = (k: number) => {
    const id = items[k].id
    if (id === 'go') game.resume()
    else if (id === 'restart') window.location.reload()
    else if (id === 'settings') setInPane(true)
  }
  const [i, setI] = useNav({ count: items.length, enabled: !inPane, onOk: run, onSide: (d) => d > 0 && items[i].id === 'settings' && setInPane(true) })
  const change = (row: number, d: -1 | 1) => {
    if (row === 0) game.setQuality(s.quality === 'high' ? 'low' : 'high')
    else if (row === 1) game.setVision(!s.visionOn)
    else if (row === 2) game.setTutor(!s.tutorOn)
    else game.setVolume(Math.max(0, Math.min(1, Math.round((s.volume + d * 0.1) * 10) / 10)))
  }
  const [ri, setRi] = useNav({ count: 4, enabled: inPane, onOk: (r) => change(r, 1), onSide: (d) => change(ri, d), onBack: () => setInPane(false) })
  const pane = items[i].id
  const rows: [string, ReactNode][] = [
    ['Графика', <Choice2 value={s.quality} on={inPane && ri === 0} options={[['high', 'Высокая'], ['low', 'Быстрая']]} />],
    ['Обзор и слух', <Choice2 value={s.visionOn ? 'on' : 'off'} on={inPane && ri === 1} options={[['on', 'Как у Алдара'], ['off', 'Видно всё']]} />],
    ['Обучение', <Choice2 value={s.tutorOn ? 'on' : 'off'} on={inPane && ri === 2} options={[['on', 'Показывать'], ['off', 'Скрыть']]} />],
    [
      'Громкость',
      <span className="flex items-center gap-3">
        <span className="h-[3px] w-40 bg-bone/15">
          <span className="block h-full bg-amber" style={{ width: `${s.volume * 100}%` }} />
        </span>
        <span className="w-10 font-ui text-[15px] tabular-nums text-bone/70">{Math.round(s.volume * 100)}</span>
      </span>,
    ],
  ]
  return (
    <div className="anim-quick veil-left felt absolute inset-0 select-none">
      <div className="anim-menu absolute left-[7vw] top-[13vh]">
        <div className="font-ui text-[14px] text-bone/50">{game.def.ordinal}</div>
        <div className="max-w-[34vw] font-display text-[56px] leading-none text-bone">{game.def.title}</div>
        <div className="mt-10">
          {items.map((it, k) => (
            <Line key={it.id} label={it.label} on={k === i && !inPane} onHover={() => (setI(k), setInPane(false))} onClick={() => run(k)} />
          ))}
        </div>
      </div>
      <div key={pane} className="anim-pane absolute left-[44vw] top-[17vh]">
        {pane === 'settings' && (
          <div className="w-[480px]">
            {rows.map(([label, ctl], r) => (
              <button key={label} onMouseEnter={() => (setInPane(true), setRi(r))} onClick={() => change(r, 1)} className="flex w-full items-center gap-3 border-b border-bone/8 py-3.5 text-left">
                <Mark on={inPane && ri === r} />
                <span className={`w-44 font-display text-[24px] leading-none ${inPane && ri === r ? 'text-amber' : 'text-bone'}`}>{label}</span>
                {ctl}
              </button>
            ))}
            <div className="mt-5 font-ui text-[13px] text-bone/45">
              <Rich text="[←] [→] изменить" />
            </div>
          </div>
        )}
        {pane === 'controls' && <Controls />}
        {pane === 'journal' && <Journal />}
        {pane === 'go' && <p className="max-w-[400px] font-tale text-[22px] italic leading-snug text-bone/55">{s.kit?.vesselGiven ? 'Огонь остался у Азамата. Кровь чует тропу.' : game.chapter === 1 ? 'Уголь в меди тлеет. Урман ждёт.' : 'Уголь в меди тлеет. Дорога ждёт.'}</p>}
        {pane === 'restart' && <p className="max-w-[400px] font-tale text-[22px] italic leading-snug text-bone/55">{game.chapter === 1 ? 'Кубаир начнётся с первой строки. Всё найденное пропадёт.' : 'Глава начнётся сначала, с того, что Алдар принёс в неё.'}</p>}
      </div>
      <div className="absolute bottom-8 left-[7vw] font-ui text-[13px] text-bone/55">
        <Rich text="[↑↓] выбор   [Enter] открыть   [Esc] вернуться в игру" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- death

function Dead({ game, line }: { game: Game; line?: string }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 1400)
    return () => window.clearTimeout(t)
  }, [])
  useNav({ count: 0, enabled: ready, onOk: () => game.respawn() })
  return (
    <div className="anim-fade-in absolute inset-0 grid select-none place-items-center bg-[radial-gradient(ellipse_at_center,rgba(50,8,4,0.35),rgba(0,0,0,0.9)_75%)]">
      <div className="text-center">
        <div className="font-display text-[clamp(72px,9vw,120px)] leading-none tracking-[0.06em] text-[#b8573a] [text-shadow:0_4px_40px_rgba(0,0,0,0.9)]">Алдар пал</div>
        {line && <p className="mx-auto mt-6 max-w-xl font-tale text-[24px] italic text-bone/75">{line}</p>}
        <button onClick={() => game.respawn()} className={`mt-12 font-ui text-[17px] text-bone/85 transition-opacity duration-700 hover:text-amber ${ready ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <Rich text="[E] Подняться у огня" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- end of chapter

const CHAPTER_END: Record<number, { ordinal: string; text: string }> = {
  1: { ordinal: 'Конец первой главы', text: 'Азамат жив и идёт рядом, за щитом отца. Айсылу ведут к воде, что течёт в Алдаре не по праву. Шурале сказал: он сам и есть тот долг.' },
  2: { ordinal: 'Конец второй главы', text: 'Чёрная вода показала правду: отец напоил Алдара живой водой, мать отдала ему своё дыхание и стала Сусар. Впереди — гора, где ждёт тень Арслана.' },
}

function Victory({ game }: { game: Game }) {
  const s = useHud()
  const water = `${s.given} / ${s.drunk}`
  const next = game.chapter < 3 ? CHAPTERS[(game.chapter + 1) as 2 | 3] : null
  useNav({ count: 0, onOk: () => game.nextChapter() })
  const end = CHAPTER_END[game.chapter] ?? CHAPTER_END[1]
  return (
    <div className="anim-fade-in absolute inset-0 grid select-none place-items-center bg-[radial-gradient(ellipse_at_center,rgba(14,10,6,0.88),rgba(2,3,6,0.97)_75%)]">
      <div className="flex flex-col items-center text-center">
        <Seal id="kuskar" size={52} />
        <div className="mt-6 font-ui text-[15px] text-bone/55">{end.ordinal}</div>
        <div className="max-w-[80vw] font-display text-[clamp(64px,8vw,112px)] leading-none tracking-[0.04em] text-bone">{game.def.title}</div>
        <p className="mt-6 max-w-xl font-tale text-[23px] italic leading-snug text-bone/75">{end.text}</p>
        <div className="mt-10 flex items-end gap-14">
          {[
            [String(s.kills), 'повержено'],
            [String(s.deaths), 'падений'],
            [water, 'капли: отдано / выпито'],
          ].map(([v, l]) => (
            <div key={l}>
              <div className={`font-display leading-none ${v.length > 3 ? 'text-[28px] text-jade' : 'text-[48px] text-bone'}`}>{v}</div>
              <div className="mt-2 font-ui text-[14px] text-bone/50">{l}</div>
            </div>
          ))}
        </div>
        <button onClick={() => game.nextChapter()} className="mt-12 font-ui text-[17px] text-bone/85 hover:text-amber">
          <Rich text={next ? `[Enter] Дальше: ${next.title}` : '[Enter] Дальше'} />
        </button>
        <div className="mt-3 font-ui text-[13px] text-bone/35">Кубаир сохранён на пороге главы</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the end of the kubair

function Ending({ game }: { game: Game }) {
  const s = useHud()
  const id = s.ending ?? 'life'
  const e = ENDINGS[id]
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 2400)
    return () => window.clearTimeout(t)
  }, [])
  useNav({ count: 0, enabled: ready, onOk: () => game.endEnding() })
  const words = e.text.split(' ')
  const dark = id === 'shulgen'
  return (
    <div className={`anim-fade-in absolute inset-0 grid select-none place-items-center ${dark ? 'bg-[radial-gradient(ellipse_at_center,rgba(6,8,12,0.9),rgba(1,2,4,0.98)_75%)]' : 'bg-[radial-gradient(ellipse_at_50%_35%,rgba(120,70,30,0.35),rgba(14,10,6,0.9)_55%,rgba(2,3,6,0.97)_85%)]'}`}>
      <div className="flex max-w-[860px] flex-col items-center px-8 text-center">
        <Seal id="amanat" size={52} />
        <div className="mt-6 font-ui text-[15px] text-bone/55">Сэсэн · постаревший Азамат</div>
        <div className={`font-display text-[clamp(60px,7vw,100px)] leading-none tracking-[0.04em] ${dark ? 'text-[#9fb4c4]' : 'text-bone'}`}>{e.title}</div>
        <p className="mt-7 font-tale text-[24px] italic leading-snug text-bone/80">
          {words.map((w, k) => (
            <span key={k} className="inline-block" style={{ animation: 'word-in 0.9s ease both', animationDelay: `${0.6 + k * 0.07}s` }}>
              {w}&nbsp;
            </span>
          ))}
        </p>
        <div className="mt-10 flex items-end gap-14">
          {[
            [String(s.kills), 'повержено'],
            [String(s.deaths), 'падений'],
            [`${s.given} / ${s.drunk}`, 'капли: отдано / выпито'],
          ].map(([v, l]) => (
            <div key={l}>
              <div className={`font-display leading-none ${v.length > 3 ? 'text-[28px] text-jade' : 'text-[44px] text-bone'}`}>{v}</div>
              <div className="mt-2 font-ui text-[14px] text-bone/50">{l}</div>
            </div>
          ))}
        </div>
        <button onClick={() => game.endEnding()} className={`mt-12 font-ui text-[16px] text-bone/80 transition-opacity duration-700 hover:text-amber ${ready ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <Rich text="[Enter] Кубаир допет" />
        </button>
      </div>
    </div>
  )
}

/** TRG_CH3_FINAL_CHOICE: [E] return the debt (the cut palm over the bowl) · [F] drink from the spring */
function FinalChoice({ game }: { game: Game }) {
  const opts = [
    { id: 'give' as const, key: 'E', label: 'Вернуть аманат', note: 'Рассечь ладонь над чашей: родник возьмёт украденную воду', tint: 'text-[#b8e8ff]' },
    { id: 'drink' as const, key: 'F', label: 'Выпить из родника', note: 'Стать бессмертным, как Шульген', tint: 'text-[#d9714f]' },
  ]
  const [i, setI] = useNav({ count: 2, axis: 'x' })
  const focused = useRef(i)
  focused.current = i
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const id = e.code === 'KeyE' ? 'give' : e.code === 'KeyF' ? 'drink' : e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' ? opts[focused.current].id : null
      if (!id) return
      e.preventDefault()
      game.chooseFinal(id)
    }
    const t = window.setTimeout(() => window.addEventListener('keydown', onKey, true), 300)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [game])
  return (
    <div className="anim-quick absolute inset-0 select-none bg-[linear-gradient(0deg,rgba(3,5,7,0.95)_0%,rgba(3,5,7,0.72)_42%,rgba(3,5,7,0.2)_78%)]">
      <div className="absolute inset-x-0 bottom-[13vh] flex flex-col items-center">
        <Glyph id="water" size={48} className="text-[#e6f4ff] drop-shadow-[0_0_14px_rgba(230,244,255,0.85)]" />
        <div className="mt-3 font-ui text-[14px] text-bone/50">Чаша Йәншишмә</div>
        <p className="mt-3 max-w-2xl text-center font-tale text-[25px] italic leading-snug text-bone/90 text-shade">Аманат вернётся до рассвета. Вода, что течёт в Алдаре, принадлежит земле.</p>
        <div className="mt-10 flex gap-24">
          {opts.map((o, k) => (
            <button key={o.id} onMouseEnter={() => setI(k)} onClick={() => game.chooseFinal(o.id)} className="flex flex-col items-center">
              <span className="flex items-center gap-3">
                <Key k={o.key} className="text-[15px]" />
                <span className={`font-display text-[40px] leading-none transition-colors ${k === i ? o.tint : 'text-bone/60'}`}>{o.label}</span>
              </span>
              <span className={`mt-2 max-w-[280px] font-ui text-[15px] transition-colors ${k === i ? 'text-bone/80' : 'text-bone/35'}`}>{o.note}</span>
            </button>
          ))}
        </div>
        <div className="mt-8 font-ui text-[13px] text-bone/45">
          <Rich text="[←] [→] выбор   [Enter] решить" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the drop

function DropChoice({ game, n }: { game: Game; n: number }) {
  const opts = [
    { id: 'drink' as const, key: 'E', label: 'Выпить', note: 'Запал +20 · кылыс +10% · лук натягивается быстрее', cost: 'Уголь у пояса притихнет: свет −6%', tint: 'text-[#d9714f]' },
    { id: 'give' as const, key: 'F', label: 'Отдать земле', note: 'Больная земля исцелится', cost: 'Часть долга вернётся роднику', tint: 'text-[#b8e8ff]' },
  ]
  // arrows move the focus; [Enter] decides the focused one; [E] always drinks, [F] always gives (docs/LEVELS.md)
  const [i, setI] = useNav({ count: 2, axis: 'x', onBack: () => game.closeChoice() })
  const focused = useRef(i)
  focused.current = i
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const pickId = e.code === 'KeyE' ? 'drink' : e.code === 'KeyF' ? 'give' : e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' ? opts[focused.current].id : null
      if (!pickId) return
      e.preventDefault()
      game.chooseDrop(pickId)
    }
    // capture phase: the list's own handler (same target, registered first) stops propagation but not this listener
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [game])
  return (
    <div className="anim-quick absolute inset-0 select-none bg-[linear-gradient(0deg,rgba(3,5,7,0.94)_0%,rgba(3,5,7,0.7)_40%,rgba(3,5,7,0.15)_75%)]">
      <div className="absolute inset-x-0 bottom-[13vh] flex flex-col items-center">
        <Glyph id="water" size={44} className="text-[#b8e8ff] drop-shadow-[0_0_12px_rgba(184,232,255,0.8)]" />
        <div className="mt-3 font-ui text-[14px] text-bone/50">Капля живой воды Йәншишмә · {n} из 5</div>
        <p className="mt-3 max-w-2xl text-center font-tale text-[25px] italic leading-snug text-bone/90 text-shade">Живая вода не терпит сосудов. Что взято у родника — взято в долг.</p>
        <div className="mt-10 flex gap-24">
          {opts.map((o, k) => (
            <button key={o.id} onMouseEnter={() => setI(k)} onClick={() => game.chooseDrop(o.id)} className="flex flex-col items-center">
              <span className="flex items-center gap-3">
                <Key k={o.key} className="text-[15px]" />
                <span className={`font-display text-[40px] leading-none transition-colors ${k === i ? o.tint : 'text-bone/60'}`}>{o.label}</span>
              </span>
              <span className={`mt-2 font-ui text-[15px] transition-colors ${k === i ? 'text-bone/80' : 'text-bone/35'}`}>{o.note}</span>
              <span className={`mt-0.5 font-ui text-[13px] transition-colors ${k === i ? 'text-bone/55' : 'text-bone/25'}`}>{o.cost}</span>
            </button>
          ))}
        </div>
        <div className="mt-8 font-ui text-[13px] text-bone/45">
          <Rich text="[←] [→] выбор   [Enter] решить   [Esc] отойти" />
        </div>
      </div>
    </div>
  )
}

export function Screens({ game, onContinue }: { game: Game; onContinue: (p: Progress) => void }) {
  const s = useHud()
  if (s.lore !== null && s.screen === 'playing') return <LorePage game={game} id={s.lore} />
  if (s.choice !== null && s.screen === 'playing') return <DropChoice game={game} n={s.choice} />
  if (s.finalChoice && s.screen === 'playing') return <FinalChoice game={game} />
  if (s.screen === 'prologue') return <Prologue game={game} />
  if (s.screen === 'epilogue') return <Epilogue game={game} />
  if (s.screen === 'title') return <Title game={game} onContinue={onContinue} />
  if (s.screen === 'paused') return <Pause game={game} />
  if (s.screen === 'dead') return <Dead game={game} line={s.narration?.text} />
  if (s.screen === 'victory') return <Victory game={game} />
  if (s.screen === 'ending') return <Ending game={game} />
  return null
}
