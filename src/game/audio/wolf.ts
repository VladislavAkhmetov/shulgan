import { RecordedVoices, type OutputFactory } from './recorded'

export const WOLF_FALLBACK = {
  wolf_howl: 'howl', wolf_growl: 'growl', wolf_bark: 'growl', wolf_hurt: 'growl', wolf_death: 'growl',
} as const
export type WolfSound = keyof typeof WOLF_FALLBACK
export const isWolfSound = (kind: string): kind is WolfSound => Object.prototype.hasOwnProperty.call(WOLF_FALLBACK, kind)

/** Real wolf howls and canine close vocals. Source recordings retain their natural pitch. */
export class WolfAudio extends RecordedVoices<WolfSound> {
  constructor(ctx: AudioContext, out: OutputFactory) {
    super(ctx, out, {
      folder: 'wolf',
      groups: {
        howl: ['howl-1', 'howl-2'],
        growl: ['growl-1', 'growl-2', 'growl-3'],
        bark: ['bark-1', 'bark-2', 'bark-3'],
        hurt: ['hurt-malamute-1', 'hurt-malinois-1', 'hurt-malinois-2', 'hurt-malinois-3'],
        death: ['death-rasp-1', 'death-rasp-2'],
      },
      variation: 0.01,
      individualRange: 0.04,
      events: {
        wolf_howl: { group: 'howl', priority: 1, volume: 0.85, cutoff: 8200, reverb: 0.55 },
        wolf_growl: { group: 'growl', priority: 2, volume: 0.8, cutoff: 8200, reverb: 0.18 },
        wolf_bark: { group: 'bark', priority: 3, volume: 0.9, cutoff: 8200, reverb: 0.2 },
        wolf_hurt: { group: 'hurt', priority: 4, volume: 0.85, cutoff: 6200, reverb: 0.12 },
        wolf_death: { group: 'death', priority: 5, volume: 0.75, cutoff: 4800, reverb: 0.15 },
      },
    })
  }
}
