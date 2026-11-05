import { useEffect, useRef, useState } from 'react'
import type { Game } from '../game/Game'
import type { TutorView } from '../game/tutor'
import { Glyph, type GlyphId } from './glyphs'
import { Key, Rich } from './kit'
import { useHud } from './useHud'

function Bar({ value, max, fill, ghost = true }: { value: number; max: number; fill: string; ghost?: boolean }) {
  const pct = `${Math.max(0, Math.min(1, value / max)) * 100}%`
  return (
    <div className="relative h-full w-full overflow-hidden bg-black/55 shadow-[0_0_0_1px_rgba(217,210,195,0.12)]">
      {ghost && <div className="absolute inset-y-0 left-0 bg-[#a4452c]/70 transition-[width] delay-300 duration-700 ease-out" style={{ width: pct }} />}
      <div className={`absolute inset-y-0 left-0 transition-[width] duration-100 ${fill}`} style={{ width: pct }} />
    </div>
  )
}

/** A skill: its sign, a thin ring for cooldown or charge, a count, and the key under it. */
function Skill({ id, k, cd = 0, charge, count, active = false, dim = false, warn = false, small = false }: { id: GlyphId; k: string; cd?: number; charge?: number; count?: number; active?: boolean; dim?: boolean; warn?: boolean; small?: boolean }) {
  const s = small ? 38 : 48
  const r = s / 2 - 2
  const c = 2 * Math.PI * r
  const ring = charge !== undefined ? charge : cd > 0.001 ? 1 - cd : null
  const color = warn ? '#c4552a' : active ? '#e89b3c' : 'rgba(217,210,195,0.7)'
  return (
    <div className={`flex flex-col items-center gap-1 transition-opacity duration-300 ${dim ? 'opacity-35' : ''}`}>
      <div className="relative grid place-items-center" style={{ width: s, height: s }}>
        <div className="absolute inset-1 rounded-full bg-black/45" />
        <svg className="absolute inset-0 -rotate-90" width={s} height={s} aria-hidden>
          <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke="rgba(217,210,195,0.12)" strokeWidth={1.5} />
          {ring !== null && <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, ring)))} />}
        </svg>
        <Glyph id={id} size={small ? 20 : 26} className={`relative ${warn ? 'text-ember' : active ? 'text-amber' : cd > 0.001 ? 'text-bone/45' : 'text-bone/90'}`} />
      </div>
      <div className="flex items-center gap-1">
        <Key k={k} className="text-[11px] opacity-70" />
        {count !== undefined && <span className="font-display text-[15px] leading-none text-bone text-shade">{count}</span>}
      </div>
    </div>
  )
}

/** One onboarding step: keys, what it does, why; it stays until Aldar does it. */
function Lesson({ t }: { t: TutorView }) {
  return (
    <div key={`lesson-${t.key}`} className={`anim-fade-up text-shade transition-opacity duration-500 ${t.done ? 'opacity-70' : ''}`}>
      <div className="font-ui text-[13px] text-amber/80">
        {t.lesson}
        {t.of > 1 && <span className="text-bone/45"> · {t.index} из {t.of}</span>}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="flex gap-1 text-[22px]">
          {t.keys.map((k) => (
            <Key key={k} k={k} className={`transition-colors duration-300 ${t.done ? 'border-amber/70 text-amber' : ''}`} />
          ))}
        </span>
        <span className={`font-display text-[28px] leading-none transition-colors duration-300 ${t.done ? 'text-amber' : 'text-bone'}`}>{t.title}</span>
        <span className={`h-2 w-2 rotate-45 bg-amber transition-all duration-300 ${t.done ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`} />
      </div>
      <p className="mt-1.5 font-ui text-[15px] leading-snug text-bone/75">{t.text}</p>
      {t.progress !== null && (
        <div className="mt-2.5 h-[2px] w-56 bg-bone/15">
          <div className="h-full bg-amber transition-[width] duration-200" style={{ width: `${t.progress * 100}%` }} />
        </div>
      )}
    </div>
  )
}

/** the quiver: a tick for every place, lit for every arrow in it */
function Quiver({ n, max }: { n: number; max: number }) {
  return (
    <div className="flex h-3 items-end gap-[3px]">
      {Array.from({ length: max }, (_, i) => (
        <div key={i} className={`w-[3px] transition-[height,background-color] duration-200 ${i < n ? 'h-3 bg-bone/90' : 'h-1.5 bg-bone/20'}`} />
      ))}
    </div>
  )
}

export function Hud({ game }: { game: Game }) {
  void game
  const s = useHud()
  if (s.screen !== 'playing' && s.screen !== 'paused' && s.screen !== 'dead') return null
  const menu = s.lore !== null || s.choice !== null || s.screen === 'paused' || s.screen === 'dead'
  const playing = s.screen === 'playing' && !menu
  const lowHp = s.hp / s.maxHp < 0.3
  const cine = s.cinema
  // outside danger the interface dissolves; vitals linger faintly
  const skillsOpacity = cine || menu ? 0 : s.calm ? 0 : 1
  const vitalsOpacity = cine || menu ? 0 : s.calm ? 0.25 : 1
  const k = s.kit
  const arrows = k?.arrows ?? 0
  const maxArrows = k?.maxArrows ?? 5
  const hpWidth = Math.max(220, Math.min(440, s.maxHp * 2.4))
  const fervorWidth = Math.max(160, Math.min(hpWidth, s.maxFervor * 2.2))
  const v = s.vessel

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* letterbox */}
      <div className="absolute inset-x-0 top-0 z-10 h-[11vh] bg-black transition-transform duration-[1200ms] ease-[cubic-bezier(0.6,0,0.2,1)]" style={{ transform: cine ? 'none' : 'translateY(-100%)' }} />
      <div className="absolute inset-x-0 bottom-0 z-10 h-[11vh] bg-black transition-transform duration-[1200ms] ease-[cubic-bezier(0.6,0,0.2,1)]" style={{ transform: cine ? 'none' : 'translateY(100%)' }} />
      {cine && s.cineLine && (
        <div key={`cine-${s.cineLine.id}`} className="absolute inset-x-0 bottom-[13vh] z-20 mx-auto max-w-[900px] px-8 text-center">
          <div className="mb-1.5 font-ui text-[13px] font-medium text-amber/80" style={{ animation: 'fade-in 1s ease both' }}>
            {s.cineLine.speaker}
          </div>
          <p className="font-tale text-[28px] italic leading-snug text-[#ece2cf] text-shade">
            {s.cineLine.text.split(' ').map((w, k) => (
              <span key={k} className="inline-block" style={{ animation: 'word-in 0.8s ease both', animationDelay: `${0.25 + k * 0.12}s` }}>
                {w}&nbsp;
              </span>
            ))}
          </p>
        </div>
      )}

      {/* a place entered for the first time: its name, carved, and the sesen's half-line */}
      {s.zone && !cine && !menu && (
        <div key={`zone-${s.zone.id}`} className="absolute inset-x-0 top-[9vh] flex flex-col items-center text-center text-shade" style={{ animation: 'zone-card 4.8s ease both' }}>
          <div className="h-px w-40 bg-gradient-to-r from-transparent via-amber/60 to-transparent" />
          <div className="mt-3 font-display text-[44px] leading-none tracking-[0.04em] text-bone">{s.zone.name}</div>
          <div className="mt-2 font-tale text-[18px] italic text-bone/60">{s.zone.sub}</div>
        </div>
      )}

      {/* boss: name over a long thin line, bottom centre */}
      {s.boss && !menu && (
        <div className="anim-fade-in absolute bottom-10 left-1/2 w-[min(760px,54vw)] -translate-x-1/2" style={{ opacity: cine ? 0 : 1 }}>
          <div className="mb-1.5 flex items-baseline gap-3 text-shade">
            <span className="font-display text-[30px] leading-none text-bone">{s.boss.name}</span>
            <span className="font-tale text-[16px] italic text-bone/55">{s.boss.title}</span>
          </div>
          <div className="h-[6px]">
            <Bar value={s.boss.hp} max={s.boss.maxHp} fill="bg-[#b34a2c]" />
          </div>
          <div className="mt-[3px] h-[2px] w-full">
            <Bar value={s.boss.posture} max={s.boss.maxPosture} ghost={false} fill={s.boss.posture >= s.boss.maxPosture ? 'bg-amber' : 'bg-amber/55'} />
          </div>
        </div>
      )}

      {/* the sesen speaks in the lower third */}
      {s.narration && !cine && !menu && s.screen !== 'dead' && (
        <div key={`narr-${s.narration.id}`} className={`anim-fade-up absolute left-1/2 w-[min(760px,70vw)] -translate-x-1/2 text-center ${s.boss ? 'bottom-[136px]' : 'bottom-[120px]'}`}>
          <div className="font-ui text-[13px] font-medium text-amber/80 text-shade">{s.narration.speaker}</div>
          <div className="mt-0.5 font-tale text-[23px] italic leading-snug text-bone text-shade">{s.narration.text}</div>
        </div>
      )}

      {/* how-to: top left. A lesson step waits until it is done; a hint shows once, when it matters */}
      {!cine && !menu && (
        <div className="absolute left-8 top-8 flex max-w-[460px] flex-col gap-4">
          {s.tutor && <Lesson t={s.tutor} />}
          {s.hint && (
            <div key={`hint-${s.hint}`} className="anim-fade-up border-l-2 border-amber/60 pl-3 font-ui text-[15px] leading-relaxed text-bone/85 text-shade">
              <Rich text={s.hint} />
            </div>
          )}
        </div>
      )}

      {/* what can be done right here — under Aldar */}
      {s.prompt && playing && !cine && (
        <div key={`prompt-${s.prompt.text}`} className="anim-quick absolute left-1/2 top-[61%] flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap font-ui text-[16px] text-bone text-shade">
          {s.prompt.key && (
            <span className="relative grid place-items-center">
              <Key k={s.prompt.key} className="text-[14px]" />
              {s.prompt.hold !== null && (
                <svg className="pointer-events-none absolute -inset-2 -rotate-90" viewBox="0 0 40 40" aria-hidden>
                  <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(232,155,60,0.9)" strokeWidth="2" strokeDasharray={107} strokeDashoffset={107 * (1 - s.prompt.hold)} />
                </svg>
              )}
            </span>
          )}
          <span>
            <Rich text={s.prompt.hold !== null ? `${s.prompt.text} — держать` : s.prompt.text} />
          </span>
        </div>
      )}

      {/* grab escape */}
      {s.grab !== null && (
        <div className="absolute left-1/2 top-[38%] w-64 -translate-x-1/2 text-center">
          <div className="font-display text-[44px] leading-none text-amber text-shade">Вырвись</div>
          <div className="mt-3 h-[4px]">
            <Bar value={s.grab} max={1} ghost={false} fill="bg-amber" />
          </div>
          <div className="mt-2 flex justify-center gap-2 font-ui text-sm text-bone/80">
            <Key k="ЛКМ" /> <Key k="Пробел" />
          </div>
        </div>
      )}

      {/* pickups and warnings: a short column over the vitals */}
      <div className="absolute bottom-[118px] left-8 flex flex-col items-start gap-1" style={{ opacity: cine ? 0 : 1 }}>
        {!menu &&
          s.toasts.map((t) => (
            <div key={t.id} className={`anim-fade-up flex items-center gap-2 font-ui text-[15px] text-shade ${t.kind === 'warn' ? 'text-[#d9714f]' : t.kind === 'info' ? 'text-amber' : 'text-bone/90'}`}>
              {t.icon && <Glyph id={t.icon as GlyphId} size={18} className="opacity-90" />}
              <span>{t.text}</span>
            </div>
          ))}
      </div>

      {/* bottom-left: vitals */}
      <div className="absolute bottom-8 left-8 transition-opacity duration-[1500ms]" style={{ opacity: vitalsOpacity }}>
        <div className="mb-2 flex h-5 items-center gap-2">
          {s.son && (
            <span className={`flex items-center gap-1.5 font-ui text-[13px] text-shade ${s.son.state === 'follow' && s.son.cd === 0 ? 'text-[#7fe0d8]' : 'text-bone/60'}`}>
              <Glyph id="kurai" size={18} />
              Азамат
              {s.son.state === 'kneel' ? ' · на коленях' : s.son.state === 'stagger' ? ' · еле идёт' : s.son.state === 'stay' ? ' · у огня' : s.son.cd > 0 ? '' : ' · курай готов'}
            </span>
          )}
          {s.companion && (
            <span className={`flex items-center gap-1.5 font-ui text-[13px] text-shade transition-colors ${s.companion.threats > 0 ? 'text-amber' : 'text-bone/60'}`}>
              <Glyph id="marten" size={20} />
              Сусар
              {s.companion.state === 'leap' ? ' · срывает покров' : s.companion.state === 'point' ? ' · указывает на дерево' : s.companion.threats > 0 ? ` · чует: ${s.companion.threats}` : s.companion.state === 'sniff' ? ' · нашла знак' : ''}
            </span>
          )}
          {s.breath > 0 && (
            <span className="anim-fade-in flex items-center gap-1.5 font-ui text-[13px] text-amber text-shade">
              <Glyph id="breath" size={18} /> Перевести дух
              <span className="ml-1 h-[2px] w-16 bg-bone/15">
                <span className="block h-full bg-amber" style={{ width: `${s.breath * 100}%` }} />
              </span>
            </span>
          )}
        </div>
        <div className="h-[6px] transition-[width] duration-700" style={{ width: hpWidth }}>
          <Bar value={s.hp} max={s.maxHp} fill={lowHp ? 'bg-[#c4552a]' : 'bg-[#e4dac7]'} />
        </div>
        {/* Запал: what the shield and the fire arrow spend; notches at 35 (a fire arrow) and 50 (a breath) */}
        <div className="relative mt-[4px] h-[3px] transition-[width] duration-700" style={{ width: fervorWidth }}>
          <Bar value={s.fervor} max={s.maxFervor} ghost={false} fill="bg-[#e8893a]" />
          {[35, 50].map((n) => (
            <div key={n} className={`absolute -top-[2px] h-[7px] w-px ${s.fervor >= n ? 'bg-[#ffd29a]' : 'bg-bone/35'}`} style={{ left: `${(n / s.maxFervor) * 100}%` }} />
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-4">
          <div className="flex items-center gap-2">
            {Array.from({ length: s.dodgeMax }, (_, i) => {
              const full = i < s.dodge
              const charging = i === s.dodge
              return (
                <div key={i} className="relative h-2.5 w-2.5 rotate-45 bg-black/50 shadow-[0_0_0_1px_rgba(217,210,195,0.35)]">
                  <div className="absolute inset-0 origin-bottom bg-bone/85" style={{ transform: `scaleY(${full ? 1 : charging ? s.dodgeRecharge : 0})` }} />
                </div>
              )
            })}
          </div>
          <span className="font-ui text-[12px] tabular-nums text-[#e8893a]/80 text-shade">запал {s.fervor}</span>
          {k && k.waterDebt + k.earthHealed > 0 && (
            <span className="flex items-center gap-1 font-ui text-[12px] text-bone/55 text-shade">
              <Glyph id="water" size={15} className="text-[#b8e8ff]" />
              {k.earthHealed > 0 && <span>отдано {k.earthHealed}</span>}
              {k.waterDebt > 0 && <span className="text-[#d9714f]">выпито {k.waterDebt}</span>}
            </span>
          )}
        </div>
      </div>

      {/* bottom-right: the stances, the vessel, Kara */}
      <div className="absolute bottom-8 right-8 flex items-end gap-3 transition-opacity duration-[1500ms]" style={{ opacity: skillsOpacity }}>
        <div className="mr-2 flex items-end gap-2">
          <Skill id={s.armed ? 'kalkan' : 'kylys'} k="1" active={s.weapon === 'blade'} dim={s.weapon !== 'blade'} />
          {s.hasBow && (
            <div className="flex flex-col items-center gap-1.5">
              <Quiver n={arrows} max={maxArrows} />
              <Skill
                id={s.fireNocked ? 'arrow_fire' : 'bow'}
                k="2"
                count={arrows}
                active={s.weapon === 'bow'}
                dim={s.weapon !== 'bow' || arrows === 0}
                warn={(s.weapon === 'bow' && arrows === 0) || s.bowPeak}
                charge={s.bowDraw > 0 ? s.bowDraw : undefined}
              />
            </div>
          )}
        </div>
        {k?.vesselGiven ? <Skill id="water" k="F" active={s.sense} /> : <Skill id="vessel" k="F" active={v.lit && (v.focus || s.fireNocked)} dim={!v.lit && v.clog === 0} warn={v.clog > 0} cd={v.lit ? v.flashCd : 0} count={v.clog > 0 ? v.clog : undefined} />}
        {s.son && s.son.state !== 'stay' && <Skill id="kurai" k="Q" cd={s.son.cd} dim={s.son.state !== 'follow'} active={s.son.cd === 0 && s.son.state === 'follow'} />}
        <Skill id="eagle" k="R" cd={s.eagleCd} />
      </div>

      {/* the heat focus: the world narrows to the cone of the vessel's light */}
      <div className="absolute inset-0 transition-opacity duration-500" style={{ opacity: v.focus && !menu ? 1 : 0, background: 'radial-gradient(ellipse at 50% 55%, transparent 35%, rgba(40,22,6,0.3) 70%, rgba(8,5,2,0.6) 100%)' }} />
      {v.focus && !menu && <div className="anim-quick absolute left-1/2 top-6 -translate-x-1/2 font-ui text-[13px] text-amber/80 text-shade">Фокус жара</div>}
      {/* chapter 3: the blood senses the way — a silver hush at the edges */}
      <div className="absolute inset-0 transition-opacity duration-500" style={{ opacity: s.sense && !menu ? 1 : 0, background: 'radial-gradient(ellipse at 50% 55%, transparent 40%, rgba(120,150,190,0.12) 75%, rgba(20,30,45,0.45) 100%)' }} />
      {s.sense && !menu && <div className="anim-quick absolute left-1/2 top-6 -translate-x-1/2 font-ui text-[13px] text-[#b8e8ff]/85 text-shade">Чутьё крови</div>}
      {/* the scar on Aldar's chest flares: Shulgen is behind */}
      {s.scar > 0 && !menu && <div className="pointer-events-none absolute inset-0" style={{ opacity: Math.min(1, s.scar * 1.6), boxShadow: 'inset 0 0 180px rgba(200,190,230,0.45)', background: 'radial-gradient(circle at 50% 52%, rgba(230,220,255,0.18), transparent 22%)' }} />}
      {v.clog > 0 && playing && <div className="anim-quick absolute left-1/2 top-6 -translate-x-1/2 font-ui text-[13px] text-[#d9714f] text-shade"><Rich text="Прорези забиты тиной · вспышка [F] вычистит" /></div>}
      {s.debug && <div className="absolute left-3 top-3 font-mono text-[11px] text-bone/60">{s.debug}</div>}
      {lowHp && playing && <div className="absolute inset-0 shadow-[inset_0_0_160px_rgba(120,10,6,0.35)]" />}
    </div>
  )
}
