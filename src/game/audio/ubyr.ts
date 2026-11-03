import type * as THREE from 'three'
import { RecordedVoices, type OutputFactory } from './recorded'
export type { SampleOutput } from './recorded'

export const UBYR_FALLBACK = {
  ubyr_groan: 'groan', ubyr_buried: 'groan', ubyr_growl: 'growl', ubyr_attack: 'growl',
  ubyr_hurt: 'groan', ubyr_death: 'death', ubyr_emerge: null,
} as const
export type UbyrSound = keyof typeof UBYR_FALLBACK
export const isUbyrSound = (kind: string): kind is UbyrSound => Object.prototype.hasOwnProperty.call(UBYR_FALLBACK, kind)

/** Recorded CC0 Ubyr voices, with a layered earth sound during emergence. */
export class UbyrAudio extends RecordedVoices<UbyrSound> {
  private lastEarth = ''
  private pendingEarth = new Map<string | number | symbol, { pos: THREE.Vector3 | null | undefined; volume: number; started: number }>()
  private disposed = false
  constructor(ctx: AudioContext, out: OutputFactory) {
    super(ctx, out, {
      folder: 'ubyr',
      groups: {
        groan: ['groan-1', 'groan-2', 'groan-3'],
        growl: ['growl-1', 'growl-2', 'growl-3'],
        attack: ['attack-1', 'attack-2', 'attack-3'],
        hurt: ['hurt-1', 'hurt-2', 'hurt-3'],
        death: ['death-1', 'death-2', 'death-3'],
      },
      extraFiles: { earth1: 'earth-emerge-1.wav', earth2: 'earth-emerge-2.wav' },
      events: {
        ubyr_buried: { group: 'groan', priority: 0, volume: 0.42, rate: 0.87, cutoff: 550, reverb: 0.12 },
        ubyr_groan: { group: 'groan', priority: 1, volume: 0.7 },
        ubyr_growl: { group: 'growl', priority: 2 },
        ubyr_emerge: { group: 'growl', priority: 3, volume: 0.8, delay: 0.28 },
        ubyr_attack: { group: 'attack', priority: 3 },
        ubyr_hurt: { group: 'hurt', priority: 4 },
        ubyr_death: { group: 'death', priority: 5 },
      },
    })
  }

  play(kind: UbyrSound, pos: THREE.Vector3 | null | undefined, volume: number, emitter?: string | number) {
    if (kind !== 'ubyr_emerge') return super.play(kind, pos, volume, emitter)
    // Earth is a physical action, not a mouth: a hurt/death voice must not suppress it.
    const ground = pos?.clone()
    const started = this.ctx.currentTime
    const key = emitter ?? Symbol()
    if (!this.earth(ground, volume) && !this.pendingEarth.has(key)) {
      this.pendingEarth.set(key, { pos: ground, volume, started })
      void this.ready.then(() => this.flushEarth(true))
    }
    super.play(kind, pos, volume, emitter)
    return true // never substitute the emergence with a synthetic crack
  }

  private earth(pos: THREE.Vector3 | null | undefined, volume: number, elapsed = 0) {
    const available = ['earth1', 'earth2'].filter((name) => this.buffers.has(name))
    if (!available.length) return false
    const name = available.find((n) => n !== this.lastEarth) ?? available[0]
    this.lastEarth = name
    const buffer = this.buffers.get(name)!
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const ground = pos?.clone()
    if (ground) ground.y -= 0.7
    const output = this.out(ground, volume * 1.35, 0.12)
    const envelope = this.ctx.createGain()
    const at = this.ctx.currentTime + 0.005
    const remaining = buffer.duration - elapsed
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(1, at + 0.012)
    envelope.gain.setValueAtTime(1, at + Math.max(0.012, remaining - 0.1))
    envelope.gain.linearRampToValueAtTime(0, at + remaining)
    source.connect(envelope).connect(output.node)
    this.track(source, () => { source.disconnect(); envelope.disconnect(); output.dispose() })
    source.start(at, elapsed)
    return true
  }

  protected onBufferReady(name: string) {
    if (name === 'earth1' || name === 'earth2') this.flushEarth()
  }

  private flushEarth(final = false) {
    if (this.disposed) return
    for (const [key, event] of this.pendingEarth) {
      const elapsed = this.ctx.currentTime - event.started
      if (elapsed >= 1.7 || this.earth(event.pos, event.volume, elapsed) || final) this.pendingEarth.delete(key)
    }
  }

  dispose() {
    this.disposed = true
    this.pendingEarth.clear()
    super.dispose()
  }
}
