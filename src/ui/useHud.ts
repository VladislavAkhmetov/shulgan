import { useSyncExternalStore } from 'react'
import { hud } from '../game/core/store'

export function useHud() {
  return useSyncExternalStore(hud.subscribe, hud.get)
}
