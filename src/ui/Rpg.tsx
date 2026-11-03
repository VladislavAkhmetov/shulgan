import { useEffect, useState, type ReactNode } from 'react'
import type { Game } from '../game/Game'
import { ITEMS, LEVEL_VERSES, STATS, WOLF_NODES, type ItemId, type NodeId, type StatId } from '../game/rpg/data'
import { OUTFITS, type OutfitId, type RpgSnapshot } from '../game/rpg/state'
import type { JournalEntry } from '../game/clues'
import { Glyph, type GlyphId } from './glyphs'
import { Key, Mark, Rich, Seal, useNav } from './kit'
import { useHud } from './useHud'

// ======================================================================= shared

function Veil({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <div className={`anim-quick felt pointer-events-auto absolute inset-0 select-none ${strong ? 'veil-strong' : 'veil-left'}`}>{children}</div>
}

function Footer({ text }: { text: string }) {
  return (
    <div className="absolute bottom-8 left-[7vw] flex gap-5 font-ui text-[13px] text-bone/55">
      {text.split('  ').map((t) => (
        <span key={t}>
          <Rich text={t} />
        </span>
      ))}
    </div>
  )
}


function SkazLine({ r, width = 320 }: { r: RpgSnapshot; width?: number }) {
  const span = Math.max(1, r.levelTo - r.levelFrom)
  const k = r.ready > 0 ? 1 : Math.max(0, Math.min(1, (r.skaz - r.levelFrom) / span))
  return (
    <div style={{ width }}>
      <div className="h-[3px] bg-bone/12">
        <div className="h-full bg-amber transition-[width] duration-700" style={{ width: `${k * 100}%` }} />
      </div>
    </div>
  )
}

// ======================================================================= rest

type RestPane = 'level' | 'stats' | 'skills' | 'craft' | 'leave'

const NODE_ORDER: NodeId[] = ['leap', 'hide', 'pack', 'blood', 'fourth']
const NODE_POS: Record<NodeId, [number, number]> = { leap: [0, 0], hide: [0, 1], pack: [1, 0], blood: [1, 1], fourth: [1, 2] }

function nodeState(r: RpgSnapshot, id: NodeId) {
  const def = WOLF_NODES.find((n) => n.id === id)!
  if (r.nodes.includes(id)) return 'have'
  if (def.requires && !r.nodes.includes(def.requires)) return 'locked'
  return r.tamgaPoints > 0 ? 'open' : 'nopoints'
}

/** a rest menu line: what it does, and under it — its state in plain words */
function RestLine({ label, sub, on, accent, onHover, onClick }: { label: string; sub?: string; on: boolean; accent?: boolean; onHover: () => void; onClick: () => void }) {
  return (
    <button onMouseEnter={onHover} onClick={onClick} className="flex w-full items-start gap-3 py-2 text-left">
      <span className="mt-[13px]">
        <Mark on={on} />
      </span>
      <span>
        <span className={`block font-display text-[27px] leading-tight transition-colors duration-150 ${on ? 'text-amber' : 'text-bone/85'}`}>{label}</span>
        {sub && <span className={`block font-ui text-[14px] ${accent ? 'text-amber/90' : 'text-bone/45'}`}>{sub}</span>}
      </span>
    </button>
  )
}

function PaneHead({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-6">
      <div className="font-display text-[40px] leading-none text-bone">{title}</div>
      <p className="mt-2 max-w-[440px] font-ui text-[15px] leading-relaxed text-bone/60">{desc}</p>
    </div>
  )
}

function Action({ text, ok = true, onClick }: { text: string; ok?: boolean; onClick?: () => void }) {
  return (
    <button disabled={!ok} onClick={onClick} className={`mt-6 font-ui text-[16px] ${ok ? 'text-amber hover:text-[#f3b468]' : 'cursor-default text-bone/40'}`}>
      <Rich text={text} />
    </button>
  )
}

export function RestScreen({ game, kind, r }: { game: Game; kind: 'spring' | 'fire'; r: RpgSnapshot }) {
  const hud = useHud()
  const resin = r.items.find(([i]) => i === 'resin')?.[1] ?? 0
  const fireArrows = r.items.find(([i]) => i === 'arrow_fire')?.[1] ?? 0
  const fireMax = ITEMS.arrow_fire.max ?? 10
  const spent = game.restSpent

  const items: { id: RestPane; label: string; sub?: string; accent?: boolean }[] = []
  if (r.ready > 0) items.push({ id: 'level', label: 'Новый уровень', sub: `Сказ собран: уровень ${r.level} → ${r.level + r.ready}`, accent: true })
  items.push({ id: 'stats', label: 'Характеристики', sub: r.statPoints > 0 ? `Свободных очков: ${r.statPoints}` : 'Свободных очков нет', accent: r.statPoints > 0 })
  items.push({ id: 'skills', label: 'Навыки', sub: !r.wolfOpen ? 'Закрыто: нужна тамга' : r.tamgaPoints > 0 ? `Тамга Волка · очков: ${r.tamgaPoints}` : 'Тамга Волка', accent: r.wolfOpen && r.tamgaPoints > 0 })
  items.push({ id: 'craft', label: 'Ремесло', sub: `Огненные стрелы · смолы: ${resin}`, accent: resin > 0 && fireArrows < fireMax })
  items.push({ id: 'leave', label: 'В путь' })

  const [inPane, setInPane] = useState(false)
  const paneCount = (p: RestPane) => (p === 'stats' ? 4 : p === 'skills' && r.wolfOpen ? 5 : p === 'craft' ? 1 : 0)
  const activate = (p: RestPane) => {
    if (p === 'leave') return game.closeRest()
    if (p === 'level') {
      game.restSing()
      // after the song the line disappears; Характеристики becomes first — that is where the new points are
      setMi(0)
      return
    }
    if (paneCount(p) > 0) setInPane(true)
  }
  const [mi, setMi] = useNav({ count: items.length, enabled: !inPane, onOk: (i) => activate(items[i].id), onSide: (d) => d > 0 && activate(items[mi].id) })
  const pane = items[Math.min(mi, items.length - 1)].id
  const paneAct = (i: number) => {
    if (pane === 'stats') game.raiseStat(STATS[i].id)
    else if (pane === 'skills') game.learnNode(NODE_ORDER[i])
    else if (pane === 'craft') game.craftFireArrows()
  }
  const [pi, setPi] = useNav({
    count: paneCount(pane),
    enabled: inPane,
    onOk: paneAct,
    onBack: () => setInPane(false),
    onSide: (d) => {
      if (pane === 'stats') {
        if (d > 0) game.raiseStat(STATS[pi].id)
        else game.lowerStat(STATS[pi].id)
      } else if (d < 0) setInPane(false)
    },
  })
  useEffect(() => setPi(0), [pane, setPi])

  const span = Math.max(1, r.levelTo - r.levelFrom)
  const k = r.ready > 0 ? 1 : Math.max(0, Math.min(1, (r.skaz - r.levelFrom) / span))
  const footer = !inPane
    ? '[↑↓] выбор  [Enter] открыть  [Esc] в путь'
    : pane === 'stats'
      ? '[↑↓] характеристика  [→] +1  [←] вернуть  [Esc] назад'
      : pane === 'skills'
        ? '[↑↓] навык  [Enter] изучить  [Esc] назад'
        : '[Enter] сделать  [Esc] назад'

  return (
    <Veil>
      <div className="anim-menu absolute left-[6vw] top-[9vh] w-[min(360px,30vw)]">
        <div className="flex items-center gap-4">
          <Seal id={kind === 'spring' ? 'water' : 'flame'} size={44} />
          <div className="font-display text-[50px] leading-none text-bone">{kind === 'spring' ? 'Родник' : 'Костёр'}</div>
        </div>
        {/* what this rest gave */}
        <div className="mt-3 space-y-0.5 font-ui text-[14px] text-bone/60">
          <div>Здоровье восстановлено</div>
          <div>{kind === 'spring' ? `Живая вода: ${hud.sips} из ${hud.maxSips}` : `Масло в фонаре: ${Math.round(r.oil * 100)}%`}</div>
          <div>Здесь Тимер поднимется, если падёт</div>
        </div>
        {/* how far to the next level */}
        <div className="mt-6 border-t border-bone/10 pt-4">
          <div className="flex items-baseline justify-between font-ui text-[14px]">
            <span className="text-bone">Уровень {r.level}</span>
            <span className="tabular-nums text-bone/50">{r.ready > 0 ? 'Сказ собран' : `Сказ ${r.skaz} / ${r.levelTo}`}</span>
          </div>
          <div className="mt-2 h-[3px] bg-bone/12">
            <div className="h-full bg-amber transition-[width] duration-700" style={{ width: `${k * 100}%` }} />
          </div>
          <p className="mt-2 font-ui text-[13px] leading-snug text-bone/40">Сказ — опыт. Он копится за победы, тамги и находки, а у огня и родника становится уровнями.</p>
        </div>
        <div className="mt-5">
          {items.map((it, i) => (
            <RestLine
              key={it.id}
              label={it.label}
              sub={it.sub}
              accent={it.accent}
              on={i === mi && !inPane}
              onHover={() => {
                setMi(i)
                setInPane(false)
              }}
              onClick={() => activate(it.id)}
            />
          ))}
        </div>
      </div>

      <div key={pane} className="anim-pane absolute left-[38vw] top-[11vh] w-[min(500px,40vw)]">
        {pane === 'level' && (
          <div>
            <PaneHead title="Новый уровень" desc="Сэсэн споёт новую строку кубаира о Тимере. Каждый уровень даёт очко характеристик и очко навыков." />
            <div className="flex items-baseline gap-5 font-display leading-none">
              <span className="text-[64px] text-bone/45">{r.level}</span>
              <span className="text-[34px] text-bone/35">→</span>
              <span className="text-[88px] text-amber">{r.level + r.ready}</span>
            </div>
            <p className="mt-6 max-w-[420px] font-tale text-[22px] italic leading-snug text-bone/85">«{LEVEL_VERSES[r.level + 1] ?? LEVEL_VERSES[6]}»</p>
            <div className="mt-5 space-y-1 font-ui text-[15px] text-bone/80">
              <div>+{r.ready} очко характеристик</div>
              <div>+{r.ready} очко навыков</div>
            </div>
            <Action text="[Enter] Спеть" onClick={() => activate('level')} />
          </div>
        )}

        {pane === 'stats' && (
          <div>
            <PaneHead title="Характеристики" desc="Каждое очко усиливает Тимера навсегда. Вложенное за этот отдых можно вернуть, пока он не встал." />
            <div className={`mb-2 font-ui text-[15px] ${r.statPoints > 0 ? 'text-amber' : 'text-bone/45'}`}>{r.statPoints > 0 ? `Свободных очков: ${r.statPoints}` : 'Свободных очков нет — их дают новые уровни'}</div>
            {STATS.map((st, i) => {
              const on = inPane && i === pi
              const back = (spent[st.id] ?? 0) > 0
              return (
                <div
                  key={st.id}
                  onMouseEnter={() => {
                    setInPane(true)
                    setPi(i)
                  }}
                  className={`border-b border-bone/8 py-3 transition-colors ${on ? 'bg-bone/[0.03]' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <Mark on={on} />
                    <div className="flex-1">
                      <div className={`font-display text-[25px] leading-none ${on ? 'text-amber' : 'text-bone'}`}>{st.name}</div>
                      <div className="mt-1 font-ui text-[13px] text-bone/45">{st.desc}</div>
                    </div>
                    <button disabled={!back} onClick={() => game.lowerStat(st.id)} className="grid h-8 w-8 place-items-center rounded-[3px] border border-bone/20 font-ui text-[18px] text-bone/70 transition-opacity hover:border-bone/50 disabled:opacity-0" aria-label={`Вернуть очко: ${st.name}`}>
                      −
                    </button>
                    <span className="w-9 text-center font-display text-[30px] leading-none text-bone">{r.stats[st.id]}</span>
                    <button disabled={r.statPoints <= 0} onClick={() => game.raiseStat(st.id)} className="grid h-8 w-8 place-items-center rounded-[3px] border border-amber/50 font-ui text-[18px] text-amber transition-opacity hover:bg-amber/10 disabled:opacity-20" aria-label={`Повысить: ${st.name}`}>
                      +
                    </button>
                  </div>
                  <div className={`overflow-hidden pl-[18px] transition-all duration-200 ${on ? 'mt-2 max-h-24 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <Effects r={r} id={st.id} next={r.statPoints > 0} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {pane === 'skills' &&
          (!r.wolfOpen ? (
            <div>
              <PaneHead title="Навыки" desc="Навыки дают родовые тамги. Каждая тамга — ветка приёмов, каждый приём стоит одно очко навыков." />
              <div className="flex items-start gap-5">
                <Glyph id="wolf" size={64} className="shrink-0 text-bone/20" />
                <p className="max-w-[360px] font-ui text-[16px] leading-relaxed text-bone/70">Тамга Волка пока не найдена. Её носил охотник из волчьего рода: его останки лежат у тропы к роднику.</p>
              </div>
              <div className="mt-4 font-ui text-[14px] text-bone/45">Очков навыков: {r.tamgaPoints}. Они не сгорят.</div>
            </div>
          ) : (
            <div>
              <PaneHead title="Тамга Волка" desc="Приёмы ближнего боя. Каждый стоит одно очко навыков; нижние открываются после верхних." />
              <WolfTree r={r} focus={inPane ? NODE_ORDER[pi] : null} onHover={(id) => (setInPane(true), setPi(NODE_ORDER.indexOf(id)))} onLearn={(id) => game.learnNode(id)} />
            </div>
          ))}

        {pane === 'craft' && (
          <div>
            <PaneHead title="Ремесло" desc="Из найденных материалов. Смолу дают сосны и разорённые стоянки." />
            <button onMouseEnter={() => (setInPane(true), setPi(0))} onClick={() => game.craftFireArrows()} className={`flex w-full items-center gap-4 border-b border-bone/8 py-3 text-left ${inPane ? 'bg-bone/[0.03]' : ''}`}>
              <Mark on={inPane} />
              <Glyph id="arrow_fire" size={34} className="text-ember" />
              <div className="flex-1">
                <div className={`font-display text-[25px] leading-none ${inPane ? 'text-amber' : 'text-bone'}`}>Огненные стрелы ×3</div>
                <div className="mt-1.5 font-ui text-[14px] text-bone/55">
                  Нужно: смола ×1 · есть {resin}
                </div>
                <div className="font-ui text-[14px] text-bone/40">
                  В колчане {fireArrows} из {fireMax}
                </div>
              </div>
            </button>
            {resin <= 0 ? <Action ok={false} text="Нет смолы" /> : fireArrows >= fireMax ? <Action ok={false} text="Колчан полон" /> : <Action text="[Enter] Сделать" onClick={() => game.craftFireArrows()} />}
          </div>
        )}

        {pane === 'leave' && (
          <div>
            <PaneHead title="В путь" desc={kind === 'spring' ? 'Родник запомнит Тимера: если он падёт, то поднимется здесь.' : 'Огонь запомнит Тимера: если он падёт, то поднимется здесь.'} />
            {(r.statPoints > 0 || (r.wolfOpen && r.tamgaPoints > 0)) && <div className="font-ui text-[15px] text-amber/90">Остались свободные очки. Их можно потратить на любом следующем отдыхе.</div>}
            <Action text="[Enter] Встать" onClick={() => game.closeRest()} />
          </div>
        )}
      </div>

      <Footer text={footer} />
    </Veil>
  )
}

function Effects({ r, id, next }: { r: RpgSnapshot; id: StatId; next: boolean }) {
  return (
    <div className="space-y-0.5 font-ui text-[14px] text-bone/60">
      {r.effects[id].map(([label, now, nx]) => (
        <div key={label} className="flex gap-2 tabular-nums">
          <span>{label}</span>
          <span className="text-bone">{now}</span>
          {next && now !== nx && (
            <>
              <span className="text-bone/35">→</span>
              <span className="text-amber">{nx}</span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function WolfTree({ r, focus, onHover, onLearn }: { r: RpgSnapshot; focus: NodeId | null; onHover: (id: NodeId) => void; onLearn: (id: NodeId) => void }) {
  const X = [20, 272]
  const Y = [30, 120, 210]
  const def = focus ? WOLF_NODES.find((n) => n.id === focus)! : null
  const st = focus ? nodeState(r, focus) : null
  return (
    <div>
      <div className="flex items-center gap-5 font-ui text-[13px] text-bone/50">
        <span className={r.tamgaPoints > 0 ? 'text-amber' : ''}>Очков навыков: {r.tamgaPoints}</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rotate-45 bg-amber" /> изучено
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rotate-45 border border-amber" /> можно изучить
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rotate-45 border border-bone/30" /> закрыто
        </span>
      </div>
      <div className="relative mt-2 h-[250px] w-[470px]">
        <svg className="absolute inset-0" width={470} height={250} aria-hidden>
          {WOLF_NODES.filter((n) => n.requires).map((n) => {
            const [ax, ay] = NODE_POS[n.requires!]
            const [bx, by] = NODE_POS[n.id]
            const lit = r.nodes.includes(n.requires!)
            return <line key={n.id} x1={X[ax] + 9} y1={Y[ay] + 18} x2={X[bx] + 9} y2={Y[by] - 2} stroke={lit ? 'rgba(232,155,60,0.6)' : 'rgba(217,210,195,0.15)'} strokeWidth={1.5} />
          })}
        </svg>
        {WOLF_NODES.map((n) => {
          const [cx, cy] = NODE_POS[n.id]
          const s = nodeState(r, n.id)
          const on = focus === n.id
          return (
            <button key={n.id} onMouseEnter={() => onHover(n.id)} onClick={() => onLearn(n.id)} className="absolute flex items-center gap-3" style={{ left: X[cx], top: Y[cy] }}>
              <span className={`block h-[18px] w-[18px] rotate-45 transition-all duration-150 ${s === 'have' ? 'bg-amber' : s === 'open' ? 'border-[1.5px] border-amber' : 'border-[1.5px] border-bone/25'} ${on ? 'scale-125 shadow-[0_0_14px_rgba(232,155,60,0.6)]' : ''}`} />
              <span className={`whitespace-nowrap font-display text-[21px] leading-none ${on ? 'text-amber' : s === 'locked' ? 'text-bone/30' : 'text-bone'}`}>{n.name}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-1 min-h-[96px] max-w-[440px]">
        {def ? (
          <>
            <div className="font-ui text-[16px] leading-snug text-bone/85">{def.desc}</div>
            <div className="mt-3 font-ui text-[15px]">
              {st === 'have' && <span className="text-bone/45">Изучено</span>}
              {st === 'open' && (
                <span className="text-amber">
                  <Rich text="[Enter] Изучить · 1 очко" />
                </span>
              )}
              {st === 'locked' && <span className="text-bone/45">Сначала изучите «{WOLF_NODES.find((n) => n.id === def.requires)!.name}»</span>}
              {st === 'nopoints' && <span className="text-bone/45">Нужно очко навыков: его даст новый уровень</span>}
            </div>
          </>
        ) : (
          <div className="font-ui text-[15px] text-bone/50">
            <Rich text="Наведите на приём или нажмите [Enter], чтобы выбрать." />
          </div>
        )}
      </div>
    </div>
  )
}

// ======================================================================= сума

type Tab = 'clues' | 'gear' | 'supplies' | 'loot' | 'self'
const TABS: { id: Tab; label: string }[] = [
  { id: 'clues', label: 'Следы' },
  { id: 'gear', label: 'Снаряжение' },
  { id: 'supplies', label: 'Припасы' },
  { id: 'loot', label: 'Добыча' },
  { id: 'self', label: 'Персонаж' },
]

interface Entry {
  key: string
  glyph: GlyphId
  name: string
  kind: string
  desc: string
  verse?: string
  count?: string
  tag?: string
  active?: boolean
  action?: { label: string; run: () => void }
  stat?: StatId
  /** a question of the tracking journal */
  journal?: JournalEntry
}

const KIND_LABEL: Record<string, string> = { ammo: 'Стрелы', consumable: 'Припас', material: 'Добыча', amulet: 'Оберег' }

function entries(tab: Tab, r: RpgSnapshot, game: Game, combat: boolean, notes: JournalEntry[]): Entry[] {
  const count = (id: ItemId) => r.items.find(([i]) => i === id)?.[1] ?? 0
  if (tab === 'clues')
    return notes.map((j) => ({
      key: j.id,
      glyph: 'amanat' as GlyphId,
      name: j.title,
      kind: 'Что случилось',
      desc: '',
      count: `${j.found.length}/${j.total}`,
      tag: j.answer ? 'ясно' : undefined,
      active: !!j.answer,
      journal: j,
    }))
  const item = (id: ItemId, extra: Partial<Entry> = {}): Entry => ({ key: id, glyph: id, name: ITEMS[id].name, kind: KIND_LABEL[ITEMS[id].kind], desc: ITEMS[id].desc, verse: ITEMS[id].verse, ...extra })
  if (tab === 'gear') {
    const list: Entry[] = [
      { key: 'kylys', glyph: 'kylys', name: 'Короткий кылыс', kind: 'Оружие', desc: 'Связка из четырёх: Косой, Обратный, Укол, Полумесяц. Удержать удар — Рассечение, оно тратит огни запала.', verse: 'Дедовский. Сломался в бою, и кузнец перековал его короче.' },
      { key: 'bow', glyph: 'bow', name: 'Степной лук', kind: 'Оружие', desc: 'Урон растёт с натяжением.', verse: 'Рог, жилы и берёза на рыбьем клею.' },
      item('arrow', { count: `${count('arrow')}/${ITEMS.arrow.max}`, active: r.arrowType === 'arrow', tag: r.arrowType === 'arrow' ? 'на тетиве' : undefined, action: r.arrowType !== 'arrow' ? { label: 'Наложить', run: () => game.selectArrows('arrow') } : undefined }),
    ]
    if (count('arrow_fire') > 0)
      list.push(item('arrow_fire', { count: `${count('arrow_fire')}/${ITEMS.arrow_fire.max}`, active: r.arrowType === 'arrow_fire', tag: r.arrowType === 'arrow_fire' ? 'на тетиве' : undefined, action: r.arrowType !== 'arrow_fire' ? { label: 'Наложить', run: () => game.selectArrows('arrow_fire') } : undefined }))
    list.push({ key: 'lantern', glyph: 'lantern', name: 'Отцовский фонарь', kind: 'Свет', count: `${Math.round(r.oil * 100)}%`, desc: `Масла примерно на ${Math.max(0, Math.round((r.oil * 7) / 1))} мин. Долить можно у огня и жаровен.`, verse: 'Отец оставил его у порога, когда уходил в последний раз.' })
    // clothes: the base shirt and every outfit Timer owns
    const wear = (id: OutfitId | null, name: string, desc: string, verse: string) => {
      const on = r.outfit === id
      list.push({ key: 'outfit_' + (id ?? 'shirt'), glyph: id ? 'kaftan' : 'shirt', name, kind: 'Одежда', desc, verse, active: on, tag: on ? 'надета' : undefined, action: combat || on ? undefined : { label: 'Надеть', run: () => game.wearOutfit(id) } })
    }
    wear(null, 'Льняная рубаха', 'Ничего поверх: так Тимер ходит дома.', 'Небелёный лён, ворот без вышивки.')
    for (const id of r.outfits) wear(id, OUTFITS[id].name, OUTFITS[id].desc, OUTFITS[id].verse)
    for (const id of r.amulets) {
      const on = r.equipped === id
      list.push(item(id, { active: on, tag: on ? 'надет' : undefined, action: combat ? undefined : { label: on ? 'Снять' : 'Надеть', run: () => game.equipAmulet(id) } }))
    }
    return list
  }
  if (tab === 'supplies') return r.items.filter(([i]) => ITEMS[i].kind === 'consumable').map(([i, n]) => item(i, { count: String(n), tag: i === 'honey' ? 'клавиша Z' : 'клавиша C' }))
  if (tab === 'loot') return r.items.filter(([i]) => ITEMS[i].kind === 'material').map(([i, n]) => item(i, { count: String(n) }))
  return STATS.map((st) => ({ key: st.id, glyph: st.id === 'str' ? 'kylys' : st.id === 'end' ? 'kuskar' : st.id === 'agi' ? 'arrow' : 'eagle', name: st.name, kind: 'Тело', count: String(r.stats[st.id]), desc: st.desc, stat: st.id }))
}

export function SumaScreen({ game, r, combat }: { game: Game; r: RpgSnapshot; combat: boolean }) {
  const hud = useHud()
  const [tab, setTab] = useState<Tab>('clues')
  const list = entries(tab, r, game, combat, hud.journal)
  const switchTab = (d: -1 | 1) => setTab((t) => TABS[(TABS.findIndex((x) => x.id === t) + d + TABS.length) % TABS.length].id)
  const [i, setI] = useNav({ count: list.length, onOk: (k) => list[k]?.action?.run(), onSide: switchTab })
  useEffect(() => setI(0), [tab, setI])
  const e = list[Math.min(i, list.length - 1)]

  return (
    <Veil strong>
      <div className="anim-menu absolute left-[7vw] top-[11vh] w-[min(440px,36vw)]">
        <div className="flex items-end gap-4">
          <div className="font-display text-[56px] leading-none text-bone">Сума</div>
          <div className="mb-1.5 font-ui text-[14px] text-bone/50">Тимер · уровень {r.level}</div>
        </div>
        <div className="mt-6 flex gap-5 border-b border-bone/10 font-ui text-[15px]">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => (setTab(t.id), setI(0))} className={`-mb-px border-b pb-2 transition-colors ${tab === t.id ? 'border-amber text-amber' : 'border-transparent text-bone/50 hover:text-bone'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          {list.length === 0 && <div className="py-3 font-tale text-[19px] italic text-bone/45">Пусто.</div>}
          {list.map((x, k) => {
            const on = k === i
            return (
              <button key={x.key} onMouseEnter={() => setI(k)} onClick={() => x.action?.run()} className="flex w-full items-center gap-3 py-[7px] text-left">
                <Mark on={on} />
                <Glyph id={x.glyph} size={24} className={on ? 'text-amber' : x.active ? 'text-bone' : 'text-bone/70'} />
                <span className={`flex-1 font-ui text-[17px] ${on ? 'text-amber' : 'text-bone/90'}`}>{x.name}</span>
                {x.tag && <span className="font-ui text-[12px] text-bone/45">{x.tag}</span>}
                {x.count && <span className="min-w-8 text-right font-display text-[20px] leading-none text-bone">{x.count}</span>}
              </button>
            )
          })}
        </div>
        {tab === 'self' && (
          <div className="mt-6">
            <SkazLine r={r} width={300} />
            <div className="mt-2 font-ui text-[14px] tabular-nums text-bone/50">
              Сказ {r.skaz} / {r.levelTo}
              {r.ready > 0 && <span className="text-amber"> · кубаир готов, отдохни у огня</span>}
            </div>
            {r.wolfOpen && r.nodes.length > 0 && <div className="mt-3 font-ui text-[14px] text-bone/60">Тамга Волка: {r.nodes.map((n) => WOLF_NODES.find((w) => w.id === n)!.name).join(', ')}</div>}
          </div>
        )}
      </div>

      {e && (
        <div key={e.key} className="anim-pane absolute left-[48vw] top-[17vh] w-[min(480px,42vw)]">
          <Glyph id={e.glyph} size={96} strokeWidth={1.1} className="text-bone/85" />
          <div className="mt-5 font-ui text-[14px] text-bone/50">{e.kind}</div>
          <div className="font-display text-[46px] leading-tight text-bone">{e.name}</div>
          {e.desc && <p className="mt-3 font-ui text-[17px] leading-relaxed text-bone/85">{e.desc}</p>}
          {e.journal && (
            <div className="mt-4 space-y-2.5">
              {e.journal.found.map((n) => (
                <div key={n} className="flex gap-3 font-ui text-[16px] leading-snug text-bone/85">
                  <span className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rotate-45 bg-amber" />
                  {n}
                </div>
              ))}
              {Array.from({ length: e.journal.total - e.journal.found.length }, (_, k) => (
                <div key={k} className="flex gap-3 font-ui text-[16px] text-bone/30">
                  <span className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rotate-45 border border-bone/30" />
                  Знак ещё не найден
                </div>
              ))}
              {!e.journal.answer && <div className="pt-2 font-ui text-[14px] text-bone/45"><Rich text="Ищи по следам. Держи [V], чтобы знаки замерцали." /></div>}
            </div>
          )}
          {e.journal?.answer && <p className="mt-6 border-l-2 border-amber/70 pl-4 font-tale text-[20px] italic leading-snug text-bone/90">{e.journal.answer}</p>}
          {e.stat && (
            <div className="mt-4">
              <Effects r={r} id={e.stat} next={false} />
            </div>
          )}
          {e.verse && <p className="mt-6 border-l-2 border-ochre/70 pl-4 font-tale text-[20px] italic leading-snug text-bone/70">{e.verse}</p>}
          <div className="mt-7 font-ui text-[15px]">
            {e.action ? (
              <span className="text-amber">
                <Rich text={`[Enter] ${e.action.label}`} />
              </span>
            ) : combat && (ITEMS[e.key as ItemId]?.kind === 'amulet' || e.kind === 'Одежда') ? (
              <span className="text-[#d9714f]">Не в бою</span>
            ) : null}
          </div>
        </div>
      )}

      <Footer text="[Q] [E] раздел  [↑↓] выбор  [Enter] действие  [Tab] закрыть" />
    </Veil>
  )
}
