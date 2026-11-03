import type * as THREE from 'three'

export interface SampleOutput {
  node: GainNode
  update(): void
  dispose(): void
}
export type OutputFactory = (pos: THREE.Vector3 | null | undefined, volume: number, reverb: number) => SampleOutput
interface VoiceRule {
  group: string
  priority: number
  volume?: number
  rate?: number
  cutoff?: number
  reverb?: number
  delay?: number
}
interface VoiceConfig<Kind extends string> {
  folder: string
  groups: Record<string, readonly string[]>
  events: Record<Kind, VoiceRule>
  extraFiles?: Record<string, string>
  variation?: number
  individualRange?: number
}
interface Voice {
  source: AudioBufferSourceNode
  envelope: GainNode
  output: SampleOutput
  priority: number
  start: number
}

/** Shared lifecycle for recorded creature voices, with one mouth per actor. */
export class RecordedVoices<Kind extends string> {
  readonly ready: Promise<void>
  protected buffers = new Map<string, AudioBuffer>()
  protected playing = new Map<AudioBufferSourceNode, () => void>()
  private voices = new Map<string | number | symbol, Voice>()
  private last: Record<string, string> = {}
  private abort = new AbortController()

  constructor(protected ctx: AudioContext, protected out: OutputFactory, private config: VoiceConfig<Kind>) {
    const files = new Map(Object.entries(config.extraFiles ?? {}))
    for (const name of new Set(Object.values(config.groups).flat())) files.set(name, name + '.wav')
    this.ready = Promise.all([...files].map(async ([name, file]) => {
      try {
        const response = await fetch(`/audio/${config.folder}/${file}`, { signal: this.abort.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.arrayBuffer()
        if (this.abort.signal.aborted) return
        const buffer = await ctx.decodeAudioData(data)
        if (!this.abort.signal.aborted) {
          this.buffers.set(name, buffer)
          this.onBufferReady(name)
        }
      } catch (error) {
        if (!this.abort.signal.aborted) console.warn(`${config.folder} audio ${name}: procedural fallback`, error)
      }
    })).then(() => {})
  }

  /** False asks the engine to use its procedural fallback; suppressed voices are already handled. */
  play(kind: Kind, pos: THREE.Vector3 | null | undefined, volume: number, emitter?: string | number) {
    const rule = this.config.events[kind]
    const available = this.config.groups[rule.group].filter((name) => this.buffers.has(name))
    if (!available.length) return false
    const key = emitter ?? Symbol()
    const now = this.ctx.currentTime
    const old = this.voices.get(key)
    if (old && (old.priority > rule.priority || now - old.start < 0.12 && old.priority >= rule.priority)) return true
    if (!old && this.voices.size >= 12) return true
    if (old) {
      old.envelope.gain.cancelScheduledValues(now)
      old.envelope.gain.setTargetAtTime(0, now, 0.012)
      old.source.stop(now + 0.06)
    }
    const alternatives = available.filter((name) => name !== this.last[rule.group])
    const choices = alternatives.length ? alternatives : available
    const name = choices[Math.floor(Math.random() * choices.length)]
    this.last[rule.group] = name
    const source = this.ctx.createBufferSource()
    source.buffer = this.buffers.get(name)!
    const spread = this.config.individualRange ?? 0.1
    const individual = typeof emitter === 'number' ? 1 - spread / 2 + (emitter * 7 % 13) / 13 * spread : 1
    const variation = this.config.variation ?? 0.03
    source.playbackRate.value = individual * (1 - variation + Math.random() * variation * 2) * (rule.rate ?? 1)
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = rule.cutoff ?? 5800
    const envelope = this.ctx.createGain()
    const at = now + (rule.delay ?? 0.005)
    const duration = source.buffer.duration / source.playbackRate.value
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(1, at + 0.018)
    envelope.gain.setValueAtTime(1, at + Math.max(0.02, duration - 0.07))
    envelope.gain.linearRampToValueAtTime(0, at + duration)
    const output = this.out(pos, volume * (rule.volume ?? 0.95), rule.reverb ?? 0.28)
    source.connect(filter).connect(envelope).connect(output.node)
    const voice = { source, envelope, output, priority: rule.priority, start: now }
    this.voices.set(key, voice)
    this.track(source, () => {
      source.disconnect(); filter.disconnect(); envelope.disconnect(); output.dispose()
      if (this.voices.get(key) === voice) this.voices.delete(key)
    })
    source.start(at)
    this.afterPlay(kind, pos, volume)
    return true
  }

  protected afterPlay(_kind: Kind, _pos: THREE.Vector3 | null | undefined, _volume: number) {}
  protected onBufferReady(_name: string) {}

  protected track(source: AudioBufferSourceNode, cleanup: () => void) {
    const once = () => {
      if (!this.playing.delete(source)) return
      cleanup()
    }
    this.playing.set(source, once)
    source.onended = once
  }

  update() {
    for (const voice of this.voices.values()) voice.output.update()
  }

  dispose() {
    this.abort.abort()
    for (const [source, cleanup] of this.playing) { source.stop(); cleanup() }
    this.voices.clear()
    this.buffers.clear()
  }
}
