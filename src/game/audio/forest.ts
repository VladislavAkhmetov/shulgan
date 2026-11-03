import * as THREE from 'three'
import type { Mood } from './music'
import { RecordedVoices, type OutputFactory, type SampleOutput } from './recorded'

export type ForestSound = 'forest_creak' | 'forest_rustle'
const CREAKS = ['creak-1', 'creak-2', 'creak-3', 'creak-4']
const RUSTLES = ['rustle-1', 'rustle-2', 'rustle-3', 'rustle-4', 'rustle-5']
export function isForestSound(kind: string): kind is ForestSound {
  return kind === 'forest_creak' || kind === 'forest_rustle'
}

export interface EnvironmentWorld {
  fires: readonly { pos: THREE.Vector3; active: () => boolean; gain: number }[]
  water: readonly THREE.Vector3[]
  spring: THREE.Vector3 | null
  trees: readonly THREE.Vector3[]
  bushes: readonly THREE.Vector3[]
  cue: (kind: ForestSound, pos: THREE.Vector3, volume: number) => void
}

interface Loop {
  source: AudioBufferSourceNode
  envelope: GainNode
  filter: BiquadFilterNode
  cutoff: number
  output: SampleOutput
  pos: THREE.Vector3 | null
  target: THREE.Vector3 | null
  range: number
  level: number
  wanted: boolean
  silentFor: number
  stopping: boolean
}

/** Field recordings: a quiet canopy bed, local continuous water/fire and sparse natural cues. */
export class ForestAudio extends RecordedVoices<ForestSound> {
  private world: EnvironmentWorld | null = null
  private loops = new Map<string, Loop>()
  private selectionT = 0
  private creakT = 6
  private rustleT = 3
  private lastTree: THREE.Vector3 | null = null
  private lastBush: THREE.Vector3 | null = null

  constructor(ctx: AudioContext, out: OutputFactory) {
    super(ctx, out, {
      folder: 'forest',
      extraFiles: { wind: 'wind-loop.wav', fire: 'fire-loop.wav', stream: 'river-loop.wav', spring: 'spring-loop.wav' },
      groups: {
        creak: CREAKS,
        rustle: RUSTLES,
      },
      events: {
        forest_creak: { group: 'creak', priority: 1, volume: 1, cutoff: 5000, reverb: 0.2 },
        forest_rustle: { group: 'rustle', priority: 1, volume: 1, cutoff: 7000, reverb: 0.08 },
      },
      variation: 0.015,
    })
  }

  setWorld(world: EnvironmentWorld) {
    this.world = world
    this.selectionT = 0
  }

  protected override onBufferReady() {
    this.selectionT = 0
  }

  private ensureLoop(key: string, file: string, pos: THREE.Vector3 | null, level: number, range: number) {
    const old = this.loops.get(key)
    if (old) { old.wanted = true; old.target = pos; return }
    const buffer = this.buffers.get(file)
    if (!buffer) return
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    const cutoff = file === 'stream' ? 2400 : 7500
    filter.frequency.value = cutoff
    filter.Q.value = 0.7
    const envelope = this.ctx.createGain()
    envelope.gain.value = 0
    const point = pos?.clone() ?? null
    const output = this.out(point, 1, pos ? 0.06 : 0)
    source.connect(filter).connect(envelope).connect(output.node)
    const loop: Loop = { source, envelope, filter, cutoff, output, pos: point, target: pos, range, level, wanted: true, silentFor: 0, stopping: false }
    this.loops.set(key, loop)
    this.track(source, () => {
      source.disconnect(); filter.disconnect(); envelope.disconnect(); output.dispose()
      if (this.loops.get(key) === loop) this.loops.delete(key)
    })
    // Separate fireplaces have separate phases, so approaching two never doubles an identical crackle.
    source.start(0, Math.random() * buffer.duration)
  }

  private select(listener: THREE.Vector3) {
    const world = this.world
    for (const loop of this.loops.values()) loop.wanted = false
    if (!world) return
    this.ensureLoop('wind', 'wind', null, 0.16, 0)
    // Keep at most two local fires audible. Fading tails are released after one second.
    let first = -1, second = -1, d1 = 18 * 18, d2 = d1
    for (let i = 0; i < world.fires.length; i++) {
      const fire = world.fires[i]
      if (!fire.active()) continue
      const d = fire.pos.distanceToSquared(listener)
      if (d < d1) { second = first; d2 = d1; first = i; d1 = d }
      else if (d < d2) { second = i; d2 = d }
    }
    for (const i of [first, second]) if (i >= 0) {
      const fire = world.fires[i]
      this.ensureLoop(`fire:${i}`, 'fire', fire.pos, fire.gain, 18)
    }
    let nearest: THREE.Vector3 | null = null, distance = 20 * 20
    for (const point of world.water) {
      const d = point.distanceToSquared(listener)
      if (d < distance) { nearest = point; distance = d }
    }
    if (nearest) this.ensureLoop('stream', 'stream', nearest, 0.9, 20)
    if (world.spring && world.spring.distanceToSquared(listener) < 14 * 14)
      this.ensureLoop('spring', 'spring', world.spring, 0.8, 14)
  }

  private nearby(points: readonly THREE.Vector3[], listener: THREE.Vector3, min: number, max: number, previous: THREE.Vector3 | null) {
    let chosen: THREE.Vector3 | null = null, count = 0
    for (const point of points) {
      const d = point.distanceToSquared(listener)
      if (point !== previous && d > min * min && d < max * max && Math.random() < 1 / ++count) chosen = point
    }
    return chosen
  }

  updateWorld(dt: number, listener: THREE.Vector3, mood: Mood) {
    super.update()
    this.selectionT -= dt
    if (this.selectionT <= 0) { this.selectionT = 0.25; this.select(listener) }
    const now = this.ctx.currentTime
    for (const loop of this.loops.values()) {
      if (loop.stopping) continue
      if (loop.pos && loop.target) loop.pos.lerp(loop.target, 1 - Math.exp(-dt * 4))
      const distance = loop.pos ? loop.pos.distanceTo(listener) : 0
      // The panner supplies inverse-distance falloff; this envelope makes the outer boundary silent.
      const edge = loop.range ? THREE.MathUtils.clamp((loop.range - distance) / (loop.range * 0.3), 0, 1) : 1
      const gain = loop.wanted ? loop.level * edge : 0
      loop.envelope.gain.setTargetAtTime(gain, now, gain ? 0.25 : 0.15)
      loop.filter.frequency.setTargetAtTime(loop.pos ? loop.cutoff * (1 - Math.min(1, distance / loop.range) * 0.64) : 1800, now, 0.25)
      loop.output.update()
      loop.silentFor = loop.wanted ? 0 : loop.silentFor + dt
      if (loop.silentFor > 1.1) { loop.stopping = true; loop.source.stop() }
    }
    const world = this.world
    if (!world) return
    const quiet = mood === 'explore' || mood === 'tension'
    // Timers continue during combat, but incidental movement never disguises an enemy's warning.
    this.creakT -= dt
    this.rustleT -= dt
    if (this.creakT <= 0) {
      this.creakT = 9 + Math.random() * 8
      const point = quiet ? this.nearby(world.trees, listener, 5, 17, this.lastTree) : null
      if (point && CREAKS.some((name) => this.buffers.has(name))) {
        this.lastTree = point
        world.cue('forest_creak', point, 1.2)
      }
    }
    if (this.rustleT <= 0) {
      this.rustleT = 5 + Math.random() * 6
      const point = quiet ? this.nearby(world.bushes, listener, 3, 11, this.lastBush) : null
      if (point && RUSTLES.some((name) => this.buffers.has(name))) {
        this.lastBush = point
        world.cue('forest_rustle', point, 0.85)
      }
    }
  }

  override dispose() {
    this.world = null
    super.dispose()
    this.loops.clear()
  }
}
