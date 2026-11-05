import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Game } from './game/Game'
import { hud } from './game/core/store'
import { Hud } from './ui/Hud'
import { Screens } from './ui/Screens'
import { ModelViewer } from './ui/ModelViewer'
import { EagleViewer } from './ui/EagleViewer'
import { chapterFromHash, clearProgress, freshCarry, type Carry, type ChapterId, type Progress } from './game/chapters'

// the hash is read live: typing /#viewer=… into an open page only fires `hashchange` (no reload)
const onHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const readHash = () => location.hash

export default function App() {
  const hash = useSyncExternalStore(onHash, readHash, () => '')
  // /#viewer: asset check page instead of the game
  if (hash.startsWith('#viewer')) {
    const name = hash.split('=')[1] || 'hero_rig'
    if (name === 'berkut' || name === 'berkut_rig') return <EagleViewer />
    return (
      <div className="h-full w-full bg-[#020306]">
        <ModelViewer key={name} src={name} />
      </div>
    )
  }
  return <Game_ />
}

interface Run {
  chapter: ChapterId
  carry?: Carry
  autostart: boolean
  key: number
}

/** `#chapter=2` (play-testing): what a careful player carries into that chapter */
function testCarry(ch: ChapterId): Carry {
  return { ...freshCarry(), arrows: 6, maxArrows: 8, keepsakes: ['fang', 'feather'], earthHealed: ch === 3 ? 2 : 1, waterDebt: ch === 3 ? 1 : 1 }
}

function Game_() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [run, setRun] = useState<Run>(() => {
    const ch = chapterFromHash()
    return { chapter: ch ?? 1, carry: ch && ch > 1 ? testCarry(ch) : undefined, autostart: false, key: 0 }
  })

  useEffect(() => {
    if (!hostRef.current) return
    const g = new Game(hostRef.current, {
      chapter: run.chapter,
      carry: run.carry,
      autostart: run.autostart,
      // the next chapter is a new world; the kubair over, the title comes back
      onChapterEnd: (next, carry) => {
        if (next) setRun((r) => ({ chapter: next, carry, autostart: true, key: r.key + 1 }))
        else {
          clearProgress()
          setRun((r) => ({ chapter: 1, carry: undefined, autostart: false, key: r.key + 1 }))
        }
      },
    })
    setGame(g)
    // Debug handle for playtesting from the console.
    ;(window as unknown as { __game?: Game; __hud?: typeof hud }).__game = g
    ;(window as unknown as { __hud?: typeof hud }).__hud = hud
    return () => g.dispose()
  }, [run])

  const onContinue = (p: Progress) => setRun((r) => ({ chapter: p.chapter, carry: p.carry, autostart: true, key: r.key + 1 }))

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#020306]">
      <div ref={hostRef} className="absolute inset-0 cursor-crosshair" />
      {game && <Hud key={`h${run.key}`} game={game} />}
      {game && <Screens key={`s${run.key}`} game={game} onContinue={onContinue} />}
    </div>
  )
}
