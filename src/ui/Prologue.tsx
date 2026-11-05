import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Game } from '../game/Game'
import { Rich } from './kit'

/**
 * The sesen's words (docs/DIALOGUES.md, DLG_PROLOGUE_01) told as ochre cave paintings (after the Shulgan-Tash / Kapova cave art):
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

// DLG_PROLOGUE_01 (docs/DIALOGUES.md): the sesen on a black screen, told as ochre on stone; the last panel is the present
const PROLOGUE: Tale = [
  {
    text: 'Говорят, живая вода Йәншишмә не терпит сосудов.',
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
    text: 'Когда Урал-батыр добыл её, он не стал пить сам — расплескал по камням и травам, чтобы никогда не умирала сама земля.',
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
    text: 'А брат его Шульген зачерпнул пригоршню для себя, и с тех пор не может ни жить по-людски, ни лечь в могилу.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: 'M470 318 L560 186 L610 250 L660 170 L720 318', delay: 0.2, w: 3 },
      { d: circle(330, 300, 30), delay: 0.5, w: 3, glow: true },
      { d: circle(300, 190, 13), delay: 0.9, fill: true },
      { d: 'M300 203 L306 252 L280 286 L300 318 M306 252 L336 282', delay: 1.1, w: 6 },
      { d: 'M303 216 L326 238 L314 204 M303 216 L284 236 L298 202', delay: 1.5, w: 4 },
      { d: [drop(306, 196, 0.5), drop(318, 206, 0.4)].join(' '), delay: 2.0, fill: true, glow: true },
      { d: 'M250 318 c6 -10 12 10 18 0 M380 318 c6 -10 12 10 18 0', delay: 2.4, w: 2.5 },
      { d: 'M180 120 C200 100 240 104 250 130 M600 110 C620 92 660 96 668 124', delay: 2.8, w: 2.5 },
    ],
  },
  {
    text: 'Земля помнит каждую украденную каплю. Что взято у родника — взято в долг, в аманат. И однажды родник попросит вернуть своё.',
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
    text: 'Весной беркутчи Алдар поставил юрту у самой кромки старого урмана, вдали от родовых костров.',
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

// the end of chapter 1: no dawn — the Eternal night lasts until the debt is returned (docs/STORY.md)
const EPILOGUE: Tale = [
  {
    text: 'Отец, сын и куница вышли из урмана к степи курганов. Солнце так и не встало: долг ещё не был возвращён.',
    strokes: [
      { d: 'M100 320 C220 316 330 324 440 318 S640 316 710 320', w: 2.5 },
      { d: 'M626 70 A30 30 0 1 0 656 112 A24 24 0 1 1 626 70 Z', delay: 0.3, fill: true },
      { d: 'M430 318 C470 268 540 268 582 318 Z M600 318 C630 288 672 288 704 318 Z', delay: 0.8, fill: true },
      { d: 'M402 318 L402 292 L410 286 L418 292 L418 318 Z M590 318 L590 300 L597 295 L604 300 L604 318 Z', delay: 1.3, fill: true },
      { d: circle(250, 236, 11), delay: 1.8, fill: true },
      { d: 'M250 247 L252 284 M252 284 L238 318 M252 284 L270 314 M250 258 L268 276 M250 258 L236 280', delay: 2.0, w: 5 },
      { d: circle(240, 280, 5), delay: 2.4, fill: true, dawn: true },
      { d: circle(222, 266, 8), delay: 2.6, fill: true },
      { d: 'M222 274 L221 298 M221 298 L212 318 M221 298 L230 318 M222 281 L235 281', delay: 2.7, w: 4 },
      { d: 'M290 312 C300 300 316 300 324 308 L336 304 M300 312 L296 318 M318 312 L322 318', delay: 3.0, w: 3 },
      { d: 'M300 150 C315 136 328 136 338 148 C348 136 361 136 376 150 M338 148 L338 160', delay: 3.3, w: 4 },
    ],
  },
  {
    text: 'Где-то впереди, у Чёрных озёр, высокая женщина с седыми волосами до пят вела Айсылу к горе. Аманат вернётся до рассвета, сказала она.',
    strokes: [
      { d: 'M100 330 c20 -8 40 8 60 0 c20 -8 40 8 60 0 c20 -8 40 8 60 0 M300 344 c20 -8 40 8 60 0 c20 -8 40 8 60 0', w: 2.5, glow: true },
      { d: 'M480 318 L580 150 L640 230 L700 130 L760 318', delay: 0.4, w: 3 },
      { d: circle(330, 160, 12), delay: 1.0, fill: true },
      { d: 'M330 172 L326 240 L300 318 L360 318 L334 240', delay: 1.2, w: 4 },
      { d: 'M318 158 L304 250 M322 152 L312 270 M338 152 L350 262 M342 158 L356 244 M330 148 L330 200', delay: 1.6, w: 2 },
      { d: circle(400, 214, 10), delay: 2.1, fill: true },
      { d: 'M400 224 L402 270 L390 318 M402 270 L416 318 M401 236 L356 222', delay: 2.3, w: 5 },
      { d: 'M396 250 C410 254 418 262 414 276', delay: 2.7, w: 3 },
      { d: [circle(170, 80, 2.5), circle(260, 60, 2), circle(400, 76, 2.5), circle(520, 54, 2)].join(' '), delay: 3.1, fill: true },
    ],
  },
]

/** Pages of the kubair carved on the balbal stones along the path. */
const LORE: { title: string; text: string; strokes: Stroke[] }[] = [
  {
    title: 'Тамга на балбале · Албасты',
    text: 'Албасты — древний дух гор и вод. Она не злодейка, а неумолимый пристав земли. Приходит к тем, кто носит дитя, и уводит их к воде, когда земле пора взять своё.',
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
    title: 'Тамга на балбале · Шурале',
    text: 'Шурале — хозяин урмана. Пальцы длинные, как ветви, на лбу рог. Одиноких путников он защекочивает до смерти. Когда лес болеет, болеет и он. Спасают огонь и твёрдая рука.',
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
    title: 'Стела кургана · Урал и Шульген',
    text: 'Урал добыл живую воду и не выпил её: расплескал по земле, чтобы вечной была не одна жизнь, а всё живое. Брат его Шульген выпил её сам и стал бессмертным изгоем. С тех пор вода принадлежит земле, и кто взял её себе, взял в долг.',
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
  // chapter 2: the stones of the steppe of barrows
  {
    title: 'Балбал у кургана · Всадник с водой',
    text: 'Тридцать зим назад мимо этих камней скакал всадник с бурдюком у груди. Конь его пал у реки, и дальше он бежал пешком — к людям, к умирающему сыну.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: 'M520 318 L590 200 L640 260 L700 170 L760 318', delay: 0.2, w: 3 },
      { d: 'M250 250 C280 236 330 236 360 250 C356 270 262 272 250 250Z', delay: 0.6, fill: true },
      { d: 'M262 262 L250 300 M276 265 L282 302 M340 263 L336 302 M352 258 L364 298', delay: 1.0, w: 4 },
      { d: 'M356 248 L384 222 L398 228 M384 222 L378 196', delay: 1.2, w: 4 },
      { d: circle(300, 206, 10), delay: 1.6, fill: true },
      { d: 'M300 216 L304 244 M302 226 L330 222', delay: 1.8, w: 4 },
      { d: 'M326 214 C340 206 350 216 344 228 C336 236 322 232 326 214Z', delay: 2.2, fill: true, glow: true },
      { d: 'M160 330 c10 -6 20 6 30 0 M200 336 c10 -6 20 6 30 0', delay: 2.8, w: 2 },
    ],
  },
  {
    title: 'Стела Всадника',
    text: 'Здесь лежит Всадник, что стерёг дорогу к Чёрным озёрам. Мёртвые курганов помнят каждого, кто нёс воду с горы и не вернул её земле.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: 'M260 318 C300 238 500 238 540 318 Z', delay: 0.2, fill: true },
      { d: 'M400 252 L400 170 M392 186 L400 170 L408 186', delay: 0.8, w: 3 },
      { d: 'M386 168 C394 156 408 156 414 168 C410 176 390 176 386 168Z', delay: 1.1, fill: true },
      { d: circle(180, 210, 11), delay: 1.5, fill: true },
      { d: 'M180 221 L182 270 M182 270 L170 318 M182 270 L196 318 M181 236 L212 220', delay: 1.7, w: 5 },
      { d: [drop(222, 214, 0.7), drop(234, 230, 0.6)].join(' '), delay: 2.2, fill: true, glow: true },
      { d: 'M600 300 l12 -20 l12 20 M640 300 l12 -20 l12 20', delay: 2.8, w: 2.5 },
    ],
  },
  {
    title: 'Балбал песни',
    text: 'Огонь за водой зажигали по песне тростника. Как поёт курай — так и вспыхивают чаши. Кто не знает песни, тот не пройдёт к воде.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: 'M140 330 c20 -8 40 8 60 0 c20 -8 40 8 60 0 c20 -8 40 8 60 0', delay: 0.2, w: 2.5, glow: true },
      { d: 'M470 318 L470 200 M540 318 L540 180 M610 318 L610 210 M680 318 L680 190', delay: 0.5, w: 6 },
      { d: 'M456 200 L484 200 M526 180 L554 180 M596 210 L624 210 M666 190 L694 190', delay: 1.0, w: 4 },
      { d: [circle(470, 188, 7), circle(540, 168, 7), circle(610, 198, 7), circle(680, 178, 7)].join(' '), delay: 1.6, fill: true, dawn: true },
      { d: circle(250, 210, 10), delay: 2.0, fill: true },
      { d: 'M250 220 L252 266 M252 266 L240 318 M252 266 L264 318 M251 232 L292 216', delay: 2.2, w: 4 },
      { d: 'M292 216 L340 196', delay: 2.5, w: 3 },
      { d: 'M350 186 c6 -6 12 0 6 6 M370 170 c6 -6 12 0 6 6 M392 160 c6 -6 12 0 6 6', delay: 2.8, w: 2, glow: true },
    ],
  },
  // chapter 3: the red ochre of Shulgan-Tash
  {
    title: 'Охра Шульган-Таша · Колыбель и куница',
    text: 'Человек бежал с горы с водой, а у колыбели женщина три дня дышала в губы младенцу. Когда он вернулся, она упала. А у колыбели осталась сидеть куница.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: 'M100 318 L170 200 L220 260', delay: 0.2, w: 3 },
      { d: circle(250, 220, 10), delay: 0.6, fill: true },
      { d: 'M250 230 L254 264 M254 264 L236 316 M254 264 L276 312 M252 240 L280 232', delay: 0.8, w: 4 },
      { d: 'M278 224 C292 216 300 226 294 236 C286 244 272 240 278 224Z', delay: 1.1, fill: true, glow: true },
      { d: 'M470 300 C470 270 560 270 560 300 Z', delay: 1.6, w: 3 },
      { d: circle(450, 250, 10), delay: 1.9, fill: true },
      { d: 'M450 260 C448 280 444 300 440 318 M450 270 L486 280', delay: 2.1, w: 4 },
      { d: 'M590 306 C600 296 616 296 624 304 L636 300 M600 306 L596 316 M618 306 L622 316', delay: 2.6, w: 3, dawn: true },
    ],
  },
  {
    title: 'Охра Шульган-Таша · Два брата',
    text: 'Два брата у родника. Один расплескал воду по земле, и земля зазеленела. Другой выпил — и с тех пор сидит на горе, не живой и не мёртвый, и ждёт, кто станет ему братом.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: circle(400, 296, 34), delay: 0.2, w: 3, glow: true },
      { d: circle(250, 180, 12), delay: 0.7, fill: true },
      { d: 'M250 192 L252 256 M252 256 L232 318 M252 256 L274 318 M251 212 L300 236', delay: 0.9, w: 5 },
      { d: [drop(300, 250, 0.6), drop(286, 276, 0.5), drop(312, 280, 0.5)].join(' '), delay: 1.3, fill: true, glow: true },
      { d: 'M220 318 L216 300 M236 318 L240 296 M196 318 L192 304', delay: 1.6, w: 2.5, dawn: true },
      { d: circle(560, 190, 12), delay: 2.0, fill: true },
      { d: 'M560 202 L562 254 M562 254 L536 286 L560 318 M562 254 L590 284 M561 218 L530 236 L520 220', delay: 2.2, w: 5 },
      { d: [drop(522, 214, 0.5)].join(' '), delay: 2.6, fill: true, glow: true },
      { d: 'M620 318 L660 230 L700 318', delay: 2.9, w: 2.5 },
    ],
  },
]

// chapter 2 opens: the steppe of barrows and the black lakes
const CH2_TALE: Tale = [
  {
    text: 'Шурале сказал правду: тридцать зим назад через урман бежал человек с краденой водой. И кровь Алдара пахла так же.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: [spruce(150, 80), spruce(186, 104), spruce(222, 70), spruce(258, 92)].join(' '), delay: 0.2, fill: true },
      { d: circle(480, 220, 10), delay: 0.9, fill: true },
      { d: 'M480 230 L476 262 L452 296 M476 262 L500 300 M478 240 L506 232', delay: 1.1, w: 4 },
      { d: 'M504 224 C518 216 526 226 520 236 C512 244 498 240 504 224Z', delay: 1.6, fill: true, glow: true },
      { d: 'M560 318 L620 220 L660 270 L720 190 L760 318', delay: 2.2, w: 3 },
    ],
  },
  {
    text: 'Отец, сын и куница вышли в каменную степь. Впереди лежали курганы, за ними — Чёрные озёра, а за озёрами — гора.',
    strokes: [
      { d: 'M100 320 C220 316 330 324 440 318 S640 316 710 320', w: 2.5 },
      { d: 'M300 318 C340 268 410 268 450 318 Z M500 318 C524 290 566 290 590 318 Z', delay: 0.3, fill: true },
      { d: 'M372 270 L372 236 L380 230 L388 236 L388 270', delay: 0.9, fill: true },
      { d: circle(180, 234, 11), delay: 1.4, fill: true },
      { d: 'M180 245 L182 282 M182 282 L168 318 M182 282 L200 314 M180 256 L198 274', delay: 1.6, w: 5 },
      { d: circle(212, 262, 8), delay: 2.0, fill: true },
      { d: 'M212 270 L211 294 M211 294 L202 318 M211 294 L220 318 M212 277 L228 270', delay: 2.1, w: 4 },
      { d: 'M228 270 L244 256', delay: 2.4, w: 2, glow: true },
      { d: 'M240 312 C250 300 266 300 274 308 L286 304', delay: 2.7, w: 3, dawn: true },
      { d: 'M610 330 c20 -8 40 8 60 0 c20 -8 40 8 60 0', delay: 3.0, w: 2.5, glow: true },
    ],
  },
]

// the end of chapter 2: into the cave
const CH2_EPILOGUE: Tale = [
  {
    text: 'Чёрная вода показала Алдару то, чего не сказал отец: мать умерла, отдав ему своё дыхание. И с тех пор бежала рядом с ним по лесам.',
    strokes: [
      { d: 'M100 330 c20 -8 40 8 60 0 c20 -8 40 8 60 0 c20 -8 40 8 60 0 c20 -8 40 8 60 0', w: 2.5, glow: true },
      { d: circle(300, 200, 11), delay: 0.5, fill: true },
      { d: 'M300 211 L302 260 L290 318 M302 260 L316 318', delay: 0.7, w: 4 },
      { d: 'M286 196 L314 196 L310 186 L290 186 Z', delay: 1.1, fill: true, dawn: true },
      { d: 'M420 306 C430 296 446 296 454 304 L466 300 M430 306 L426 316 M448 306 L452 316', delay: 1.6, w: 3, dawn: true },
      { d: 'M300 340 L302 380 M420 340 L440 370', delay: 2.2, w: 2, glow: true },
    ],
  },
  {
    text: 'Хозяйка переправы пропустила их ради матери. Отец, сын и куница вошли в пещеру Шульган-Таш, где тридцать зим ждала тень Арслана.',
    strokes: [
      { d: 'M100 320 C220 316 330 324 440 318 S640 316 710 320', w: 2.5 },
      { d: 'M380 318 C380 220 520 220 520 318', delay: 0.3, w: 8 },
      { d: 'M400 318 C400 240 500 240 500 318 Z', delay: 0.8, fill: true },
      { d: circle(300, 250, 10), delay: 1.4, fill: true },
      { d: 'M300 260 L302 290 L292 318 M302 290 L312 318', delay: 1.6, w: 4 },
      { d: circle(330, 276, 7), delay: 1.9, fill: true },
      { d: 'M330 283 L329 302 L322 318 M329 302 L336 318', delay: 2.0, w: 3 },
      { d: 'M450 270 C454 250 446 240 450 224', delay: 2.6, w: 2, glow: true },
    ],
  },
]

// chapter 3 opens: the cave of Shulgan-Tash
const CH3_TALE: Tale = [
  {
    text: 'В пещере Шульган-Таш на стенах красной охрой нарисованы люди, кони и вода. Говорят, их рисовали те, кто видел, как Урал расплескал живую воду.',
    strokes: [
      { d: 'M120 80 C300 40 500 40 680 80 M120 80 L120 330 M680 80 L680 330', w: 3 },
      { d: 'M250 250 C280 236 330 236 360 250 C356 270 262 272 250 250Z', delay: 0.5, fill: true },
      { d: 'M262 262 L250 300 M276 265 L282 302 M340 263 L336 302 M352 258 L364 298 M356 248 L384 222 L398 228', delay: 0.9, w: 4 },
      { d: circle(500, 200, 10), delay: 1.5, fill: true },
      { d: 'M500 210 L502 260 L486 300 M502 260 L520 300 M501 226 L540 240', delay: 1.7, w: 4 },
      { d: [drop(540, 250, 0.7), drop(552, 274, 0.6), drop(530, 286, 0.5)].join(' '), delay: 2.2, fill: true, glow: true },
    ],
  },
  {
    text: 'А выше пещеры, на снежной вершине Иремеля, кипит Вечный родник. Туда албасты увела Айсылу. Аманат вернётся до рассвета.',
    strokes: [
      { d: 'M100 320 C220 312 330 326 440 318 S640 314 710 322', w: 2.5 },
      { d: 'M200 318 L400 100 L600 318', delay: 0.3, w: 4 },
      { d: 'M330 176 L400 100 L470 176 L440 166 L400 186 L360 166 Z', delay: 0.9, fill: true },
      { d: circle(400, 92, 14), delay: 1.5, w: 3, glow: true },
      { d: circle(360, 250, 10), delay: 2.0, fill: true },
      { d: 'M360 260 L362 300 L350 318 M362 300 L374 318', delay: 2.2, w: 4 },
      { d: [circle(170, 80, 2.5), circle(620, 70, 2.5), circle(680, 110, 2)].join(' '), delay: 2.8, fill: true },
    ],
  },
]

export function LorePage({ game, id }: { game: Game; id: number }) {
  const page = LORE[Math.min(LORE.length - 1, Math.max(0, id))]
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
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
          <Rich text="[E] [Esc] вернуться" />
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
            fill={s.fill ? (s.glow ? '#b8e8ff' : s.dawn ? '#e89b3c' : '#9c3f24') : 'none'}
            stroke={s.glow ? '#b8e8ff' : s.dawn ? '#e8a04a' : '#a8472a'}
            strokeWidth={s.fill ? 2 : (s.w ?? 4)}
            filter={s.glow || s.dawn ? 'url(#glowf)' : undefined}
          />
        ))}
      </g>
    </svg>
  )
}

export function Prologue({ game }: { game: Game }) {
  const panels = game.chapter === 1 ? PROLOGUE : game.chapter === 2 ? CH2_TALE : CH3_TALE
  return <CaveTale key={game.chapter} panels={panels} onDone={() => game.endPrologue()} />
}

export function Epilogue({ game }: { game: Game }) {
  return <CaveTale key={`e${game.chapter}`} panels={game.chapter === 1 ? EPILOGUE : CH2_EPILOGUE} onDone={() => game.endEpilogue()} />
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
