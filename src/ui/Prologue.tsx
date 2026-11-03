import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Game } from '../game/Game'
import { Rich } from './kit'

/**
 * The myth of Ural-batyr told as ochre cave paintings (after the Shulgan-Tash / Kapova cave art):
 * lines are drawn as if by hand, pigment seeps into the stone, a torch flickers over the rock.
 * The past and the myth live here; the present is shown in the engine.
 */

type Stroke = { d: string; fill?: boolean; delay?: number; w?: number; glow?: boolean; dawn?: boolean }
type Tale = { text: string; strokes: Stroke[] }[]

// two half-arcs: a single near-closed arc lets SVG pick the wrong centre
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`
const drop = (x: number, y: number, s = 1) => `M${x} ${y} q${-6 * s} ${12 * s} 0 ${17 * s} q${6 * s} ${-5 * s} 0 ${-17 * s}Z`
const spruce = (x: number, h: number) => `M${x - 18} 318 L${x} ${318 - h} L${x + 18} 318 Z`

function rays(cx: number, cy: number, r0: number, r1: number, n: number) {
  let d = ''
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    d += `M${(cx + Math.cos(a) * r0).toFixed(1)} ${(cy + Math.sin(a) * r0).toFixed(1)} L${(cx + Math.cos(a) * r1).toFixed(1)} ${(cy + Math.sin(a) * r1).toFixed(1)} `
  }
  return d
}

const PROLOGUE: Tale = [
  {
    text: 'Слушайте. В давние времена, когда люди не знали смерти, жил батыр Урал.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: circle(640, 80, 34), delay: 0.3 },
      { d: rays(640, 80, 44, 62, 12), delay: 0.8 },
      { d: circle(300, 132, 15), delay: 1.0, fill: true },
      { d: 'M300 147 L302 235', delay: 1.3, w: 7 },
      { d: 'M258 204 L301 172 L346 156', delay: 1.6, w: 5 },
      { d: 'M302 235 L276 314 M302 235 L330 314', delay: 1.8, w: 6 },
      { d: 'M346 96 L346 318 M338 116 L346 96 L354 116', delay: 2.1, w: 3 },
      { d: 'M470 250 C500 236 545 236 572 250 C566 270 482 272 470 250Z', delay: 2.4, fill: true },
      { d: 'M482 262 L476 302 M494 265 L496 302 M552 263 L548 302 M564 258 L570 300', delay: 2.8, w: 4 },
      { d: 'M566 248 L590 220 L606 226 M590 220 L582 194 L572 186 M590 220 L600 196 L610 186', delay: 3.0, w: 4 },
    ],
  },
  {
    text: 'Узнал Урал, что смерть есть, и пошёл на неё: сквозь дивов и змеев, на крылатом Акбузате.',
    strokes: [
      { d: 'M210 240 C250 222 320 224 350 238 C356 258 330 268 300 268 L240 268 C220 266 205 256 210 240Z', fill: true },
      { d: 'M345 236 L372 194 L400 200 L388 214 L364 228', delay: 0.4, w: 6 },
      { d: 'M232 266 L222 316 M252 268 L260 316 M318 268 L310 316 M336 262 L350 312', delay: 0.7, w: 5 },
      { d: 'M212 244 C188 250 184 272 194 290', delay: 0.9, w: 4 },
      { d: 'M270 228 C250 180 230 160 206 148 M282 226 C286 176 300 150 332 138 M292 226 C306 190 332 174 364 170', delay: 1.2, w: 3 },
      { d: 'M286 222 L292 192', delay: 1.6, w: 5 },
      { d: circle(292, 181, 10), delay: 1.7, fill: true },
      { d: 'M296 198 L470 148', delay: 2.0, w: 3 },
      { d: 'M470 334 C520 300 500 250 540 240 C592 226 560 302 612 290 C664 278 620 200 662 180', delay: 2.3, w: 11 },
      { d: 'M662 180 L692 150 M662 180 L704 176 M662 180 L682 208', delay: 2.9, w: 6 },
      { d: circle(694, 148, 9) + circle(706, 176, 9) + circle(684, 210, 9), delay: 3.1, fill: true },
    ],
  },
  {
    text: 'Добыл он живую воду, но пить не стал. Разбрызгал её по земле, и вечной стала земля.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: circle(362, 150, 14), delay: 0.3, fill: true },
      { d: 'M362 164 C364 200 358 230 350 250', delay: 0.6, w: 7 },
      { d: 'M350 250 L392 262 L398 302 M350 250 L322 302', delay: 0.8, w: 6 },
      { d: 'M358 184 L330 140 M366 184 L394 138', delay: 1.0, w: 5 },
      { d: 'M318 132 Q362 164 406 130 Z', delay: 1.3, fill: true },
      {
        d: [drop(300, 170), drop(276, 214, 0.9), drop(250, 252, 0.8), drop(424, 172), drop(452, 214, 0.9), drop(478, 254, 0.8), drop(220, 286, 0.7), drop(506, 288, 0.7)].join(' '),
        delay: 1.8,
        fill: true,
        glow: true,
      },
      { d: 'M180 320 L180 250 M180 270 L160 250 M180 285 L202 262 M180 302 L160 286', delay: 2.6, w: 4 },
      { d: 'M570 320 L570 236 M570 258 L548 236 M570 274 L594 250 M570 292 L548 274 M570 304 L590 290', delay: 2.8, w: 4 },
      { d: 'M238 320 L232 298 M246 320 L248 296 M254 320 L262 300 M520 320 L516 300 M528 320 L532 296', delay: 3.1, w: 3 },
    ],
  },
  {
    text: 'С тех пор живая вода принадлежит земле. Кто возьмёт её себе, берёт в долг. Земля долги помнит.',
    strokes: [
      { d: circle(160, 292, 14), fill: true },
      { d: 'M174 296 C240 300 330 302 400 300 L470 308 M400 300 L462 294 M232 298 L252 270', delay: 0.4, w: 7 },
      { d: 'M110 318 L200 228 L246 270 L320 166 L382 240 L442 194 L522 280 L592 208 L710 318', delay: 1.4, w: 4 },
      { d: 'M200 228 L214 246 L230 240 M320 166 L336 196 L352 186 M442 194 L456 214 M592 208 L606 232 L622 226', delay: 2.2, w: 3 },
      { d: 'M250 330 c6 -8 12 8 18 0 c6 -8 12 8 18 0 M430 330 c6 -8 12 8 18 0 c6 -8 12 8 18 0 M600 330 c6 -8 12 8 18 0 c6 -8 12 8 18 0', delay: 2.8, w: 3, glow: true },
      { d: [circle(150, 90, 3), circle(260, 60, 2.5), circle(400, 80, 3), circle(520, 54, 2.5), circle(660, 96, 3), circle(700, 50, 2)].join(' '), delay: 3.2, fill: true },
    ],
  },
  {
    text: 'Прошли века. Мёртвые перестали ложиться в землю, и кочевья обходят урманы стороной. У кромки одного урмана встала юрта Тимера-беркутчи.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: 'M110 318 C112 278 168 278 170 318 Z M182 318 C184 290 222 290 224 318 Z', delay: 0.3, fill: true },
      { d: 'M140 278 C136 262 146 252 140 236 M203 290 C199 276 208 268 203 254', delay: 0.8, w: 2 },
      { d: circle(380, 302, 26), delay: 1.1, w: 3 },
      { d: 'M366 296 L356 312 M392 298 L402 314 M378 288 L384 276', delay: 1.5, w: 2.5 },
      { d: [spruce(610, 70), spruce(642, 92), spruce(676, 64), spruce(706, 84), spruce(590, 52)].join(' '), delay: 1.9, fill: true },
      { d: circle(522, 232, 11), delay: 2.4, fill: true },
      { d: 'M522 243 L524 280 M524 280 L512 316 M524 280 L540 314 M522 254 L508 278 M522 254 L536 270', delay: 2.6, w: 5 },
      { d: circle(538, 276, 5), delay: 3.0, fill: true, glow: true },
      { d: 'M466 154 C482 140 494 140 504 152 C514 140 526 140 542 154 M504 152 L504 164', delay: 3.2, w: 4 },
    ],
  },
]

function upperRays(cx: number, cy: number, r0: number, r1: number, n: number) {
  let d = ''
  for (let i = 1; i < n; i++) {
    const a = Math.PI + (i / n) * Math.PI
    d += `M${(cx + Math.cos(a) * r0).toFixed(1)} ${(cy + Math.sin(a) * r0).toFixed(1)} L${(cx + Math.cos(a) * r1).toFixed(1)} ${(cy + Math.sin(a) * r1).toFixed(1)} `
  }
  return d
}

const EPILOGUE: Tale = [
  {
    text: 'Над урманом взошло солнце. Тимер нёс спящего сына, и мёртвые в земле лежали тихо.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: 'M530 318 A72 72 0 0 1 674 318', delay: 0.3, w: 4, dawn: true },
      { d: upperRays(602, 318, 86, 112, 10), delay: 0.9, w: 3, dawn: true },
      { d: circle(166, 296, 12), delay: 1.2, fill: true },
      { d: 'M160 288 L148 266', delay: 1.4, w: 4 },
      { d: 'M180 300 C230 296 300 298 360 300', delay: 1.5, w: 8 },
      { d: 'M222 298 L172 318 L130 316 M242 300 L262 320 L302 322', delay: 1.8, w: 4 },
      { d: 'M130 316 l-15 -7 M130 316 l-16 2 M130 316 l-13 9 M302 322 l14 -6 M302 322 l15 3', delay: 2.0, w: 2.5 },
      { d: 'M360 300 L420 312 L462 316 M360 300 L410 296 L454 302', delay: 2.1, w: 5 },
      { d: circle(420, 206, 12), delay: 2.5, fill: true },
      { d: 'M420 218 L422 280 M422 280 L406 318 M422 280 L440 318', delay: 2.7, w: 6 },
      { d: 'M421 236 L452 214 L470 186 M421 236 L404 258', delay: 2.9, w: 5 },
      { d: circle(472, 180, 8), delay: 3.1, fill: true },
      { d: circle(406, 268, 5), delay: 3.3, fill: true, glow: true },
    ],
  },
  {
    text: 'Азамат рассказал: мать увела женщина с волосами до земли. За долгом, сказала она. Дорога к долгу вела через степь.',
    strokes: [
      { d: 'M100 320 C220 316 330 324 440 318 S640 316 710 320', w: 2.5 },
      { d: circle(640, 86, 26), delay: 0.3, w: 3, dawn: true },
      { d: rays(640, 86, 34, 48, 12), delay: 0.7, w: 2.5, dawn: true },
      { d: 'M430 318 C470 268 540 268 582 318 Z M600 318 C630 288 672 288 704 318 Z', delay: 1.0, fill: true },
      { d: 'M402 318 L402 292 L410 286 L418 292 L418 318 Z M590 318 L590 300 L597 295 L604 300 L604 318 Z', delay: 1.6, fill: true },
      { d: circle(250, 236, 11), delay: 2.0, fill: true },
      { d: 'M250 247 L252 284 M252 284 L238 318 M252 284 L270 314 M250 258 L268 276 M250 258 L236 280', delay: 2.2, w: 5 },
      { d: circle(268, 282, 5), delay: 2.6, fill: true, glow: true },
      { d: circle(222, 266, 8), delay: 2.7, fill: true },
      { d: 'M222 274 L221 298 M221 298 L212 318 M221 298 L230 318 M222 281 L235 281', delay: 2.8, w: 4 },
      { d: [circle(300, 322, 2), circle(326, 320, 2), circle(352, 322, 2), circle(378, 320, 2)].join(' '), delay: 2.9, fill: true },
      { d: 'M300 150 C315 136 328 136 338 148 C348 136 361 136 376 150 M338 148 L338 160', delay: 3.2, w: 4 },
    ],
  },
]

/** Pages of the kubair carved on the balbal stones along the path. */
const LORE: { title: string; text: string; strokes: Stroke[] }[] = [
  {
    title: 'Первая тамга · Шульген',
    text: 'Был у Урала брат Шульген. Урал отдал живую воду земле, а Шульген хотел оставить её себе и ушёл к дивам. Говорят, он до сих пор не может умереть.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: circle(250, 170, 14), delay: 0.2, fill: true },
      { d: 'M250 184 L252 260 M252 260 L232 318 M252 260 L272 318 M251 204 L292 196 M251 204 L222 232', delay: 0.4, w: 6 },
      { d: circle(420, 176, 13), delay: 0.9, fill: true },
      { d: 'M420 189 L424 262 M424 262 L408 318 M424 262 L446 312 M422 210 L456 226 M422 210 L392 200', delay: 1.1, w: 6 },
      { d: 'M330 300 L338 280 L326 262 L340 240 L330 222', delay: 1.6, w: 2.5 },
      { d: 'M560 312 C610 316 650 290 630 260 C610 232 566 250 588 274 C604 292 640 270 650 236 C660 208 690 196 700 178', delay: 1.9, w: 9 },
      { d: circle(704, 172, 10), delay: 2.5, fill: true },
      { d: 'M712 166 L726 160 M712 176 L726 180', delay: 2.7, w: 2.5 },
    ],
  },
  {
    title: 'Вторая тамга · Албасты',
    text: 'Албасты приходит к тем, кто носит дитя, и к роженицам. Волосы закрывают ей лицо, шёпот зовёт по имени. Света она не терпит.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: 'M170 318 C172 258 268 258 270 318 Z', delay: 0.2, fill: true },
      { d: 'M330 318 L342 300 L350 318 M346 318 L356 296 L364 318', delay: 0.7, w: 2.5 },
      { d: circle(470, 168, 13), delay: 1.1, fill: true },
      { d: 'M470 181 L466 250 L440 318 L500 318 L476 250', delay: 1.3, w: 4 },
      { d: 'M458 166 L446 250 M462 160 L452 268 M478 160 L490 262 M482 166 L496 244 M470 156 L470 210', delay: 1.8, w: 2 },
      { d: 'M468 206 L520 230 L552 236 M468 206 L430 232', delay: 2.4, w: 3 },
      { d: [circle(556, 236, 2.5), circle(560, 228, 2), circle(562, 244, 2)].join(' '), delay: 2.8, fill: true },
    ],
  },
  {
    title: 'Третья тамга · Шурале',
    text: 'Шурале — хозяин урмана. Пальцы длинные, как ветви, на лбу рог. Одиноких путников он защекочивает до смерти. Спасают огонь и твёрдая рука.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: ['M150 318 L170 240 L190 318 Z', 'M196 318 L214 222 L232 318 Z', 'M610 318 L630 236 L650 318 Z', 'M660 318 L678 250 L696 318 Z'].join(' '), delay: 0.2, fill: true },
      { d: circle(420, 140, 14), delay: 0.8, fill: true },
      { d: 'M424 128 L436 104', delay: 1.0, w: 4 },
      { d: 'M420 154 L418 236 M418 236 L392 318 M418 236 L446 318', delay: 1.2, w: 5 },
      { d: 'M419 172 L360 214 L330 262 M419 172 L478 210 L506 258', delay: 1.6, w: 4 },
      { d: 'M330 262 l-16 18 M330 262 l-6 24 M330 262 l6 24 M506 258 l16 18 M506 258 l6 24 M506 258 l-6 24', delay: 2.0, w: 2.5 },
      { d: circle(290, 230, 10), delay: 2.4, fill: true },
      { d: 'M290 240 L292 280 M292 280 L280 318 M292 280 L304 318 M291 254 L310 236', delay: 2.6, w: 4 },
      { d: 'M310 236 L316 214', delay: 2.9, w: 3, dawn: true },
      { d: circle(317, 208, 6), delay: 3.0, fill: true, dawn: true },
    ],
  },
  {
    title: 'Четвёртая тамга · Урал',
    text: 'Урал добыл живую воду и не выпил её. Он разбрызгал её по земле, чтобы вечной была не одна жизнь, а всё живое. С тех пор вода принадлежит земле. Кто взял её себе, взял в долг, и земля однажды спросит.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: circle(250, 160, 14), delay: 0.2, fill: true },
      { d: 'M250 174 L252 252 M252 252 L232 318 M252 252 L274 318 M251 196 L300 172 M251 196 L214 226', delay: 0.4, w: 6 },
      { d: 'M300 172 C318 160 332 162 340 170', delay: 0.9, w: 3 },
      { d: [circle(346, 196, 3), circle(362, 226, 3), circle(338, 248, 3), circle(380, 262, 3), circle(356, 284, 3)].join(' '), delay: 1.2, fill: true, glow: true },
      { d: 'M340 318 C338 300 344 292 350 286 M372 318 C372 302 368 294 362 290 M400 318 C400 304 406 298 412 296', delay: 1.9, w: 2.5, dawn: true },
      { d: 'M470 318 L540 236 L580 280 L640 196 L710 318', delay: 2.4, w: 3 },
      { d: 'M600 246 L640 196 L668 244', delay: 2.8, w: 2 },
    ],
  },
]

export function LorePage({ game, id }: { game: Game; id: number }) {
  const page = LORE[Math.min(LORE.length - 1, Math.max(0, id))]
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyF' || e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        game.closeLore()
      }
    }
    // let the key that opened the page settle first
    const t = window.setTimeout(() => window.addEventListener('keydown', onKey, true), 250)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [game])
  const words = page.text.split(' ')
  return (
    <div className="anim-fade-in absolute inset-0 overflow-hidden bg-[#0b0806]/95" onClick={() => game.closeLore()}>
      <Rock />
      <div className="absolute inset-x-0 top-[6%] text-center font-display text-[30px] text-[#e6d9c2]">{page.title}</div>
      <div className="absolute inset-x-0 top-[11%] mx-auto h-[56%] max-w-[1000px] px-6">
        <Panel strokes={page.strokes} />
      </div>
      <div className="absolute inset-x-0 bottom-[12%] mx-auto max-w-[820px] px-8 text-center">
        <p className="font-tale text-[26px] italic leading-snug text-[#e6d9c2] [text-shadow:0_2px_12px_rgba(0,0,0,0.9)]">
          {words.map((w, k) => (
            <span key={k} className="inline-block" style={{ animation: 'word-in 0.8s ease both', animationDelay: `${0.8 + k * 0.1}s` }}>
              {w}&nbsp;
            </span>
          ))}
        </p>
      </div>
      <Hint>
        <span>
          <Rich text="[F] [Esc] вернуться" />
        </span>
      </Hint>
    </div>
  )
}

const PANEL_MS = 9000

function Panel({ strokes }: { strokes: Stroke[] }) {
  return (
    <svg viewBox="0 0 800 400" className="h-full w-full" aria-hidden>
      <defs>
        <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="4" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="2" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.25" result="mask" />
          <feComposite in="d" in2="mask" operator="in" />
        </filter>
        <filter id="glowf">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#rough)" strokeLinecap="round" strokeLinejoin="round">
        {strokes.map((s, i) => (
          <path
            key={i}
            d={s.d}
            pathLength={1}
            className={s.fill ? 'glyph-fill' : 'glyph-stroke'}
            style={{ animationDelay: `${0.4 + (s.delay ?? 0)}s` }}
            fill={s.fill ? (s.glow ? '#5fe0c8' : s.dawn ? '#e89b3c' : '#9c3f24') : 'none'}
            stroke={s.glow ? '#5fe0c8' : s.dawn ? '#e8a04a' : '#a8472a'}
            strokeWidth={s.fill ? 2 : (s.w ?? 4)}
            filter={s.glow || s.dawn ? 'url(#glowf)' : undefined}
          />
        ))}
      </g>
    </svg>
  )
}

export function Prologue({ game }: { game: Game }) {
  return <CaveTale panels={PROLOGUE} onDone={() => game.endPrologue()} />
}

export function Epilogue({ game }: { game: Game }) {
  return <CaveTale panels={EPILOGUE} onDone={() => game.endEpilogue()} />
}

function CaveTale({ panels: PANELS, onDone }: { panels: Tale; onDone: () => void }) {
  const [i, setI] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const finish = useCallback(() => {
    if (leaving) return
    setLeaving(true)
    window.setTimeout(onDone, 1400)
  }, [onDone, leaving])
  const next = useCallback(() => {
    if (i >= PANELS.length - 1) finish()
    else setI((v) => v + 1)
  }, [i, finish, PANELS.length])

  useEffect(() => {
    const t = window.setTimeout(next, PANEL_MS + (i === PANELS.length - 1 ? 2500 : 0))
    return () => window.clearTimeout(t)
  }, [i, next])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') finish()
      else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, finish])

  const panel = PANELS[i]
  const words = useMemo(() => panel.text.split(' '), [panel])

  return (
    <div className={`absolute inset-0 overflow-hidden bg-[#0b0806] transition-opacity duration-[1400ms] ${leaving ? 'opacity-0' : 'opacity-100'}`} onClick={next}>
      <Rock />
      <div key={i} className="anim-fade-in absolute inset-x-0 top-[6%] mx-auto h-[62%] max-w-[1100px] px-6">
        <Panel strokes={panel.strokes} />
      </div>
      <div key={`t${i}`} className="absolute inset-x-0 bottom-[11%] mx-auto max-w-[860px] px-8 text-center">
        <div className="mb-2 font-ui text-[14px] font-medium text-amber/75" style={{ animation: 'fade-in 1.2s ease both', animationDelay: '0.6s' }}>
          Сэсэн
        </div>
        <p className="font-tale text-[27px] italic leading-snug text-[#e6d9c2] [text-shadow:0_2px_12px_rgba(0,0,0,0.9)]">
          {words.map((w, k) => (
            <span key={k} className="inline-block" style={{ animation: 'word-in 0.9s ease both', animationDelay: `${1.1 + k * 0.16}s` }}>
              {w}&nbsp;
            </span>
          ))}
        </p>
      </div>
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-2.5">
        {PANELS.map((_, k) => (
          <div key={k} className={`h-1.5 w-1.5 rotate-45 transition-colors duration-700 ${k <= i ? 'bg-amber/80' : 'bg-bone/20'}`} />
        ))}
      </div>
      <Hint>
        <span>
          <Rich text="[Пробел] дальше" />
        </span>
        <button
          className="pointer-events-auto underline-offset-4 hover:text-bone hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            finish()
          }}
        >
          <Rich text="[Esc] пропустить" />
        </button>
      </Hint>
    </div>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="absolute bottom-6 right-8 flex items-center gap-5 font-ui text-[13px] text-bone/45">{children}</div>
}

/** Cave wall: warm stone, mineral grain, and a torch that breathes. */
function Rock() {
  // static stone layers are composited once so the drawing animations never re-rasterise them
  return (
    <div className="absolute inset-0" style={{ transform: 'translateZ(0)', willChange: 'transform' }}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_45%_40%,#3a2a1e_0%,#21170f_45%,#0b0806_85%)]" />
      <svg className="absolute inset-0 h-full w-full opacity-60 mix-blend-overlay" aria-hidden>
        <filter id="stone">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="5" seed="11" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#stone)" />
      </svg>
      <svg className="absolute inset-0 h-full w-full opacity-25 mix-blend-soft-light" aria-hidden>
        <filter id="cracks">
          <feTurbulence type="turbulence" baseFrequency="0.006" numOctaves="3" seed="4" />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -9 4" />
        </filter>
        <rect width="100%" height="100%" filter="url(#cracks)" />
      </svg>
      <div className="torch absolute inset-0 bg-[radial-gradient(circle_at_30%_70%,rgba(255,150,60,0.28),transparent_55%)] mix-blend-screen" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.85)_100%)]" />
    </div>
  )
}
