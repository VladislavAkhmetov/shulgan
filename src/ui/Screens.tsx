import { useEffect, useState, type ReactNode } from 'react'
import type { Game } from '../game/Game'
import { useHud } from './useHud'
import { Glyph } from './glyphs'
import { Key, Mark, Rich, Seal, useNav } from './kit'
import { Epilogue, LorePage, Prologue } from './Prologue'
import { RestScreen, SumaScreen } from './Rpg'

const CONTROLS: [string, string][] = [
  ['WASD', 'Идти'],
  ['Мышь', 'Смотреть и целиться'],
  ['1 · 2', 'Кылыс · лук'],
  ['ЛКМ', 'Кылыс: удар, держать — тяжёлый'],
  ['ЛКМ', 'Лук: держать — натянуть, отпустить — выстрел'],
  ['Пробел', 'Рывок'],
  ['Shift', 'Стойка'],
  ['ПКМ', 'Опустить лук, не стреляя'],
  ['X', 'Сменить стрелы'],
  ['Q', 'Аркан'],
  ['E', 'Беркут'],
  ['R', 'Живая вода'],
  ['Z · C', 'Мёд · кумыс'],
  ['T', 'Фонарь'],
  ['F', 'Действие, добить'],
  ['V', 'Чутьё следопыта (держать)'],
  ['Tab', 'Сума и следы'],
  ['Колесо', 'Приблизить'],
  ['Esc', 'Пауза'],
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

function Title({ game }: { game: Game }) {
  const s = useHud()
  const loading = !!s.loadingText
  const [controls, setControls] = useState(false)
  const items = [{ label: loading ? s.loadingText : 'Войти в урман', run: () => !loading && game.start() }, { label: 'Управление', run: () => setControls(true) }]
  const [i, setI] = useNav({ count: items.length, enabled: !controls, onOk: (k) => items[k].run() })
  useNav({ count: 0, enabled: controls, onOk: () => setControls(false), onBack: () => setControls(false) })
  return (
    <div className="absolute inset-0 select-none bg-[radial-gradient(ellipse_at_50%_42%,rgba(2,3,6,0.25)_0%,rgba(2,3,6,0.7)_50%,rgba(2,3,6,0.97)_88%)]">
      <div className="anim-fade-up absolute inset-x-0 top-[17vh] flex flex-col items-center">
        <Seal size={58} />
        <h1 className="mt-6 font-display text-[clamp(84px,11vw,148px)] leading-[0.9] tracking-[0.08em] text-bone [text-shadow:0_4px_40px_rgba(0,0,0,0.9)]">АМАНАТ</h1>
        <div className="mt-4 font-tale text-[22px] italic text-bone/65">Кубаир о Тимере-беркутчи</div>
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
          items.map((it, k) => <Line key={k} center label={it.label} dim={loading && k === 0} on={k === i} onHover={() => setI(k)} onClick={it.run} />)
        )}
      </div>
      <div className="absolute bottom-7 left-8 font-ui text-[13px] text-bone/40">Играйте в наушниках: здесь многое слышно раньше, чем видно</div>
      <div className="absolute bottom-7 right-8 text-right font-ui text-[13px] text-bone/30">
        <a href="/#viewer=berkut" className="mb-1 block text-amber/65 hover:text-amber">Полигон беркута · движения и атаки</a>
        <a href="/audio/wolf/CREDITS.md" target="_blank" rel="noopener noreferrer" className="mb-1 block underline decoration-bone/20 underline-offset-4 hover:text-bone/70">Звуки волков · авторы</a>
        <div>Вертикальный срез · глава первая</div>
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

function Pause({ game }: { game: Game }) {
  const s = useHud()
  const items: { id: 'go' | 'settings' | 'controls' | 'restart'; label: string }[] = [
    { id: 'go', label: 'Продолжить' },
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
    ['Обзор и слух', <Choice2 value={s.visionOn ? 'on' : 'off'} on={inPane && ri === 1} options={[['on', 'Как у Тимера'], ['off', 'Видно всё']]} />],
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
        <div className="font-ui text-[14px] text-bone/50">Глава первая</div>
        <div className="font-display text-[56px] leading-none text-bone">Урман</div>
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
        {pane === 'go' && <p className="max-w-[400px] font-tale text-[22px] italic leading-snug text-bone/55">Урман ждёт. Он умеет ждать.</p>}
        {pane === 'restart' && <p className="max-w-[400px] font-tale text-[22px] italic leading-snug text-bone/55">Кубаир начнётся с первой строки. Всё найденное пропадёт.</p>}
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
        <div className="font-display text-[clamp(72px,9vw,120px)] leading-none tracking-[0.06em] text-[#b8573a] [text-shadow:0_4px_40px_rgba(0,0,0,0.9)]">Тимер пал</div>
        {line && <p className="mx-auto mt-6 max-w-xl font-tale text-[24px] italic text-bone/75">{line}</p>}
        <button onClick={() => game.respawn()} className={`mt-12 font-ui text-[17px] text-bone/85 transition-opacity duration-700 hover:text-amber ${ready ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <Rich text="[F] Подняться у огня" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- end of chapter

function Victory() {
  const s = useHud()
  const water = s.given > 0 ? 'отдана земле' : s.drunk > 0 ? 'выпита' : 'не тронута'
  useNav({ count: 0, onOk: () => window.location.reload() })
  return (
    <div className="anim-fade-in absolute inset-0 grid select-none place-items-center bg-[radial-gradient(ellipse_at_center,rgba(14,10,6,0.88),rgba(2,3,6,0.97)_75%)]">
      <div className="flex flex-col items-center text-center">
        <Seal id="kuskar" size={52} />
        <div className="mt-6 font-ui text-[15px] text-bone/55">Конец первой главы</div>
        <div className="font-display text-[clamp(80px,9vw,120px)] leading-none tracking-[0.06em] text-bone">Урман</div>
        <p className="mt-6 max-w-xl font-tale text-[23px] italic leading-snug text-bone/75">Азамат жив. Айсылу увели к Вечному роднику, за долгом. Чьим — Шурале не сказал, но учуял на Тимере чужую воду.</p>
        <div className="mt-10 flex items-end gap-14">
          {[
            [String(s.kills), 'повержено'],
            [String(s.deaths), 'падений'],
            [water, 'живая вода'],
          ].map(([v, l]) => (
            <div key={l}>
              <div className={`font-display leading-none ${v.length > 3 ? 'text-[28px] text-jade' : 'text-[48px] text-bone'}`}>{v}</div>
              <div className="mt-2 font-ui text-[14px] text-bone/50">{l}</div>
            </div>
          ))}
        </div>
        <button onClick={() => window.location.reload()} className="mt-12 font-ui text-[16px] text-bone/80 hover:text-amber">
          <Rich text="[Enter] Пройти заново" />
        </button>
        <div className="mt-3 font-ui text-[13px] text-bone/35">Дальше: степь курганов</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the drop

function DropChoice({ game }: { game: Game }) {
  const opts = [
    { id: 'drink' as const, label: 'Испить', note: 'Ещё один глоток живой воды навсегда', tint: 'text-jade' },
    { id: 'give' as const, label: 'Отдать земле', note: 'Мёртвая роща оживёт и разгонит тьму', tint: 'text-amber' },
  ]
  const [i, setI] = useNav({ count: 2, axis: 'x', onOk: (k) => game.chooseDrop(opts[k].id) })
  return (
    <div className="anim-quick absolute inset-0 select-none bg-[linear-gradient(0deg,rgba(3,5,7,0.94)_0%,rgba(3,5,7,0.7)_40%,rgba(3,5,7,0.15)_75%)]">
      <div className="absolute inset-x-0 bottom-[13vh] flex flex-col items-center">
        <Glyph id="water" size={44} className="text-jade drop-shadow-[0_0_12px_rgba(95,224,200,0.8)]" />
        <p className="mt-5 max-w-2xl text-center font-tale text-[25px] italic leading-snug text-bone/90 text-shade">Живая вода принадлежит земле. Кто берёт её себе, берёт в долг.</p>
        <div className="mt-10 flex gap-24">
          {opts.map((o, k) => (
            <button key={o.id} onMouseEnter={() => setI(k)} onClick={() => game.chooseDrop(o.id)} className="flex flex-col items-center">
              <span className="flex items-center gap-3">
                <Mark on={k === i} />
                <span className={`font-display text-[40px] leading-none transition-colors ${k === i ? o.tint : 'text-bone/60'}`}>{o.label}</span>
                <Mark on={k === i} />
              </span>
              <span className={`mt-2 font-ui text-[15px] transition-colors ${k === i ? 'text-bone/75' : 'text-bone/35'}`}>{o.note}</span>
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

export function Screens({ game }: { game: Game }) {
  const s = useHud()
  if (s.lore !== null && s.screen === 'playing') return <LorePage game={game} id={s.lore} />
  if (s.rest && s.rpg && s.screen === 'playing') return <RestScreen game={game} kind={s.rest} r={s.rpg} />
  if (s.suma && s.rpg && s.screen === 'playing') return <SumaScreen game={game} r={s.rpg} combat={s.combat} />
  if (s.choice) return <DropChoice game={game} />
  if (s.screen === 'prologue') return <Prologue game={game} />
  if (s.screen === 'epilogue') return <Epilogue game={game} />
  if (s.screen === 'title') return <Title game={game} />
  if (s.screen === 'paused') return <Pause game={game} />
  if (s.screen === 'dead') return <Dead game={game} line={s.narration?.text} />
  if (s.screen === 'victory') return <Victory />
  return null
}
