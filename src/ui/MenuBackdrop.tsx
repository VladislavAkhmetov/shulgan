import { useEffect, useRef, useState } from 'react'

// The trimmed 11.5-second clip becomes a quieter, roughly 19.2-second menu loop.
const PLAYBACK_RATE = 0.6
const VIDEO = '/video/menu-lake-moon-trimmed.mp4'
const POSTER = '/video/menu-lake-moon-trimmed.webp'

export function MenuBackdrop({ dim = false }: { dim?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => {
      setPlaying(false)
      setReducedMotion(preference.matches)
    }
    preference.addEventListener('change', change)
    return () => preference.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const resume = () => {
      if (document.hidden) {
        video.pause()
      } else {
        video.playbackRate = PLAYBACK_RATE
        void video.play().catch(() => setPlaying(false))
      }
    }
    video.defaultPlaybackRate = PLAYBACK_RATE
    video.addEventListener('loadeddata', resume)
    document.addEventListener('visibilitychange', resume)
    resume()

    return () => {
      document.removeEventListener('visibilitychange', resume)
      video.removeEventListener('loadeddata', resume)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [reducedMotion, failed])

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <img src={POSTER} alt="" className="absolute inset-0 h-full w-full object-cover" />
      {!reducedMotion && !failed && (
        <video
          ref={videoRef}
          src={VIDEO}
          poster={POSTER}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${playing ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg,rgba(2,3,6,0.08) 0%,rgba(2,3,6,0.02) 45%,rgba(2,3,6,0.62) 100%),radial-gradient(ellipse at 50% 40%,rgba(2,3,6,0.14) 0%,transparent 65%,rgba(2,3,6,0.28) 100%)' }}
      />
      <div className={`absolute inset-0 bg-[#020306] transition-opacity duration-300 ${dim ? 'opacity-65' : 'opacity-0'}`} />
    </div>
  )
}
