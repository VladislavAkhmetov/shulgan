import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Game } from './game/Game'
import { Hud } from './ui/Hud'
import { Screens } from './ui/Screens'
import { ModelViewer } from './ui/ModelViewer'

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
    return (
      <div className="h-full w-full bg-[#020306]">
        <ModelViewer key={name} src={name} />
      </div>
    )
  }
  return <Game_ />
}

function Game_() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [game, setGame] = useState<Game | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const g = new Game(hostRef.current)
    setGame(g)
    // Debug handle for playtesting from the console.
    ;(window as unknown as { __game?: Game }).__game = g
    return () => g.dispose()
  }, [])

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#020306]">
      <div ref={hostRef} className="absolute inset-0 cursor-crosshair" />
      {game && <Hud game={game} />}
      {game && <Screens game={game} />}
    </div>
  )
}
