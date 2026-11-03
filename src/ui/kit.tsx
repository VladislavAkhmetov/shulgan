import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Glyph, type GlyphId } from './glyphs'

/** A key drawn as a key. */
export function Key({ k, className = '' }: { k: string; className?: string }) {
  return (
    <span className={`inline-grid h-[1.45em] min-w-[1.45em] place-items-center rounded-[3px] border border-bone/35 bg-black/40 px-[0.35em] align-[0.08em] font-ui text-[0.72em] font-bold not-italic leading-none text-bone/85 ${className}`}>
      {k}
    </span>
  )
}

/** Text where `[F]` becomes a key. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/\[([^\]]+)\]/)
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <Key key={i} k={p} /> : <Fragment key={i}>{p}</Fragment>))}
    </>
  )
}

/** The tamga stamped in ochre — our counterpart of a red seal. */
export function Seal({ id = 'amanat', size = 44, className = '' }: { id?: GlyphId; size?: number; className?: string }) {
  return (
    <span className={`relative inline-grid place-items-center ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full" aria-hidden>
        <filter id="seal-rough">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="5" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
        </filter>
        <rect x="2" y="2" width="36" height="36" rx="3" fill="#8f3a22" filter="url(#seal-rough)" opacity="0.92" />
      </svg>
      <Glyph id={id} size={size * 0.78} strokeWidth={2.2} className="relative text-[#140c08]" />
    </span>
  )
}

/** Small marker for the focused line of a menu. */
export function Mark({ on }: { on: boolean }) {
  return <span className={`inline-block h-1.5 w-1.5 rotate-45 bg-amber transition-all duration-150 ${on ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`} />
}

const UP = ['ArrowUp', 'KeyW']
const DOWN = ['ArrowDown', 'KeyS']
const LEFT = ['ArrowLeft', 'KeyA']
const RIGHT = ['ArrowRight', 'KeyD']
const OK = ['Enter', 'NumpadEnter', 'Space', 'KeyF']

interface NavOpts {
  count: number
  enabled?: boolean
  /** 'y' — up/down moves, 'x' — left/right moves */
  axis?: 'x' | 'y'
  onOk?: (i: number) => void
  /** consumed Escape (otherwise the game handles it) */
  onBack?: () => void
  /** the other axis: e.g. step into a pane / switch tabs */
  onSide?: (dir: -1 | 1) => void
  initial?: number
}

/**
 * Keyboard focus for a list. Listens in the capture phase and swallows the keys it uses,
 * so the game's own key handler (Esc closes panels) only sees what the menu leaves alone.
 */
export function useNav({ count, enabled = true, axis = 'y', onOk, onBack, onSide, initial = 0 }: NavOpts) {
  const [i, setI] = useState(initial)
  const ref = useRef({ count, onOk, onBack, onSide, i })
  ref.current = { count, onOk, onBack, onSide, i }
  useEffect(() => {
    if (i >= count && count > 0) setI(count - 1)
  }, [count, i])
  useEffect(() => {
    if (!enabled) return
    const prev = axis === 'y' ? UP : LEFT
    const next = axis === 'y' ? DOWN : RIGHT
    const sideA = axis === 'y' ? [...LEFT, 'KeyQ'] : UP
    const sideB = axis === 'y' ? [...RIGHT, 'KeyE'] : DOWN
    const onKey = (e: KeyboardEvent) => {
      const r = ref.current
      let used = true
      if (prev.includes(e.code)) setI((v) => (r.count ? (v - 1 + r.count) % r.count : 0))
      else if (next.includes(e.code)) setI((v) => (r.count ? (v + 1) % r.count : 0))
      else if (OK.includes(e.code) && !e.repeat) r.onOk?.(r.i)
      else if (e.code === 'Escape' && r.onBack) r.onBack()
      else if (r.onSide && sideA.includes(e.code)) r.onSide(-1)
      else if (r.onSide && sideB.includes(e.code)) r.onSide(1)
      else used = false
      if (used) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled, axis])
  return [i, setI] as const
}
