import * as THREE from 'three'
import { Music, type Mood } from './music'
import { isUbyrSound, UBYR_FALLBACK, UbyrAudio, type UbyrSound } from './ubyr'
import { isWolfSound, WOLF_FALLBACK, WolfAudio, type WolfSound } from './wolf'
import type { SampleOutput } from './recorded'

export type SoundKind =
  | UbyrSound
  | WolfSound
  | 'chirr'
  | 'whimper'
  | 'clang'
  | 'step_light'
  | 'step_heavy'
  | 'step_wolf'
  | 'groan'
  | 'growl'
  | 'howl'
  | 'whisper'
  | 'cast'
  | 'orb'
  | 'swing'
  | 'swing_heavy'
  | 'hit'
  | 'hit_heavy'
  | 'hurt'
  | 'dodge'
  | 'perfect'
  | 'lasso'
  | 'arrow'
  | 'arrow_hit'
  | 'eagle'
  | 'drink'
  | 'spring'
  | 'ignite'
  | 'giggle'
  | 'roar'
  | 'crack'
  | 'boom'
  | 'death'
  | 'ui'
  | 'leap'
  | 'thorns'
  | 'teleport'
  | 'revive'
  | 'bite'
  | 'heartbeat'
  | 'douse'
  | 'crackle'
  | 'water'
  | 'splash'
  | 'cry'
  | 'kurai'


/**
 * Procedural audio plus recorded creature banks. Enemy sounds are spatialised (HRTF) relative to the
 * hero with the listener oriented to the camera, so "left on screen" = "left ear".
 */
export class AudioEngine {
  ctx: AudioContext | null = null
  private master!: GainNode
  private sfx!: GainNode
  private music_!: GainNode
  private amb!: GainNode
  private verb!: ConvolverNode
  private verbSend!: GainNode
  private noise!: AudioBuffer
  private windGain!: GainNode
  private windFilter!: BiquadFilterNode
  music: Music | null = null
  private volume = 0.8
  private nextGust = 0
  private nextOwl = 8
  private nextCrack = 4
  private heartT = 0
  lowHp = 0
  private listenerPos = new THREE.Vector3()
  private ubyr: UbyrAudio | null = null
  private wolf: WolfAudio | null = null

  start() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 4
    comp.connect(ctx.destination)
    this.master = ctx.createGain()
    this.master.gain.value = this.volume
    this.master.connect(comp)
    this.verb = ctx.createConvolver()
    this.verb.buffer = this.impulse(3.2, 2.3)
    this.verbSend = ctx.createGain()
    this.verbSend.gain.value = 0.55
    this.verbSend.connect(this.verb)
    this.verb.connect(this.master)
    this.sfx = ctx.createGain()
    this.sfx.connect(this.master)
    this.music_ = ctx.createGain()
    this.music_.gain.value = 0.6
    this.music_.connect(this.master)
    this.amb = ctx.createGain()
    this.amb.gain.value = 0.7
    this.amb.connect(this.master)

    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

    // wind bed
    const wind = ctx.createBufferSource()
    wind.buffer = this.noise
    wind.loop = true
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'lowpass'
    this.windFilter.frequency.value = 420
    this.windFilter.Q.value = 0.7
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0.12
    wind.connect(this.windFilter).connect(this.windGain).connect(this.amb)
    wind.start()

    this.music = new Music(ctx, this.music_, this.verbSend, this.noise)
    this.ubyr = new UbyrAudio(ctx, (pos, vol, verb) => this.sampleOut(pos, vol, verb))
    this.wolf = new WolfAudio(ctx, (pos, vol, verb) => this.sampleOut(pos, vol, verb))
  }

  dispose() {
    this.ubyr?.dispose()
    this.wolf?.dispose()
    void this.ctx?.close()
  }

  setMood(m: Mood) {
    this.music?.setMood(m)
  }

  setVolume(v: number) {
    this.volume = v
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx!.currentTime, 0.05)
  }

  suspend(on: boolean) {
    if (!this.ctx) return
    if (on) void this.ctx.suspend()
    else void this.ctx.resume()
  }

  setListener(pos: THREE.Vector3, yaw: number) {
    this.listenerPos.copy(pos)
    const ctx = this.ctx
    if (!ctx) return
    const l = ctx.listener
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const t = ctx.currentTime
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02)
      l.positionY.setTargetAtTime(pos.y + 1.5, t, 0.02)
      l.positionZ.setTargetAtTime(pos.z, t, 0.02)
      l.forwardX.setValueAtTime(fx, t)
      l.forwardY.setValueAtTime(-0.4, t)
      l.forwardZ.setValueAtTime(fz, t)
      l.upX.setValueAtTime(0, t)
      l.upY.setValueAtTime(1, t)
      l.upZ.setValueAtTime(0, t)
    } else {
      l.setPosition(pos.x, pos.y + 1.5, pos.z)
      l.setOrientation(fx, -0.4, fz, 0, 1, 0)
    }
  }

  // ------------------------------------------------------------ primitives

  private impulse(sec: number, decay: number) {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * sec)
    const b = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
    return b
  }

  private out(pos: THREE.Vector3 | null | undefined, vol: number, verb = 0.25, track?: { nodes: AudioNode[]; panner?: PannerNode }) {
    const ctx = this.ctx!
    const g = ctx.createGain()
    track?.nodes.push(g)
    g.gain.value = vol
    if (pos) {
      const p = ctx.createPanner()
      if (track) { track.nodes.push(p); track.panner = p }
      p.panningModel = 'HRTF'
      p.distanceModel = 'inverse'
      p.refDistance = 3
      p.rolloffFactor = 1.1
      p.maxDistance = 45
      p.positionX.value = pos.x
      p.positionY.value = (pos.y || 0) + 1
      p.positionZ.value = pos.z
      g.connect(p)
      p.connect(this.sfx)
      if (verb > 0) {
        const s = ctx.createGain()
        track?.nodes.push(s)
        s.gain.value = verb
        p.connect(s).connect(this.verbSend)
      }
    } else {
      g.connect(this.sfx)
      if (verb > 0) {
        const s = ctx.createGain()
        track?.nodes.push(s)
        s.gain.value = verb
        g.connect(s).connect(this.verbSend)
      }
    }
    return g
  }

  private sampleOut(pos: THREE.Vector3 | null | undefined, vol: number, verb: number): SampleOutput {
    const track: { nodes: AudioNode[]; panner?: PannerNode } = { nodes: [] }
    const node = this.out(pos, vol, verb, track)
    return {
      node,
      update: () => {
        if (!pos || !track.panner) return
        const time = this.ctx!.currentTime
        track.panner.positionX.setTargetAtTime(pos.x, time, 0.025)
        track.panner.positionY.setTargetAtTime(pos.y + 1, time, 0.025)
        track.panner.positionZ.setTargetAtTime(pos.z, time, 0.025)
      },
      dispose: () => { for (const n of track.nodes) n.disconnect() },
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  }

  private nz(dest: AudioNode, t: number, o: { dur: number; type?: BiquadFilterType; f: number; f2?: number; q?: number; gain: number; a?: number }) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const flt = ctx.createBiquadFilter()
    flt.type = o.type ?? 'bandpass'
    flt.frequency.setValueAtTime(o.f, t)
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur)
    flt.Q.value = o.q ?? 1
    const g = ctx.createGain()
    this.env(g, t, o.a ?? 0.005, o.gain, o.dur)
    src.connect(flt).connect(g).connect(dest)
    src.start(t, Math.random())
    src.stop(t + o.dur + 0.05)
  }

  private tone(dest: AudioNode, t: number, o: { type?: OscillatorType; f: number; f2?: number; dur: number; gain: number; a?: number; vib?: number; lp?: number; q?: number; bp?: number }) {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.f, t)
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur)
    let node: AudioNode = osc
    if (o.vib) {
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 5.5
      const lg = ctx.createGain()
      lg.gain.value = o.vib
      lfo.connect(lg).connect(osc.frequency)
      lfo.start(t)
      lfo.stop(t + o.dur + 0.05)
    }
    if (o.lp || o.bp) {
      const f = ctx.createBiquadFilter()
      f.type = o.bp ? 'bandpass' : 'lowpass'
      f.frequency.value = o.bp ?? o.lp!
      f.Q.value = o.q ?? 1
      node.connect(f)
      node = f
    }
    const g = ctx.createGain()
    this.env(g, t, o.a ?? 0.01, o.gain, o.dur)
    node.connect(g).connect(dest)
    osc.start(t)
    osc.stop(t + o.dur + 0.05)
  }

  /**
   * A plucked dombra note on the kurai pentatonic (A minor): blows in a series climb the scale,
   * the finale adds a frame-drum stroke. step 0..7
   */
  note(step: number, drum = false) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime + 0.005
    const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33]
    const f = scale[Math.max(0, Math.min(scale.length - 1, step))]
    const o = this.out(null, 0.32, 0.25)
    this.tone(o, t, { type: 'triangle', f, dur: 0.45, gain: 0.5, a: 0.003, lp: 2400 })
    this.tone(o, t, { type: 'sine', f: f * 2, dur: 0.25, gain: 0.18, a: 0.003 })
    this.tone(o, t, { type: 'sine', f: f * 3, dur: 0.12, gain: 0.07, a: 0.002 })
    if (drum) {
      const d = this.out(null, 0.55, 0.35)
      this.tone(d, t, { f: 96, f2: 52, dur: 0.42, gain: 0.9, a: 0.004 })
      this.nz(d, t, { dur: 0.09, type: 'lowpass', f: 900, gain: 0.5 })
    }
  }

  // ------------------------------------------------------------ sound bank

  play(kind: SoundKind, pos?: THREE.Vector3 | null, vol = 1, emitter?: string | number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    if (isUbyrSound(kind)) {
      if (pos && pos.distanceToSquared(this.listenerPos) > 42 * 42) return
      if (this.ubyr?.play(kind, pos, vol, emitter)) return
      const fallback = UBYR_FALLBACK[kind]
      if (!fallback) return
      kind = fallback
    }
    if (isWolfSound(kind)) {
      if (pos && pos.distanceToSquared(this.listenerPos) > 42 * 42) return
      if (this.wolf?.play(kind, pos, vol, emitter)) return
      kind = WOLF_FALLBACK[kind]
    }
    const t = ctx.currentTime + 0.005
    const R = Math.random
    switch (kind) {
      case 'step_light': {
        const o = this.out(pos, vol * 0.5, 0.1)
        this.nz(o, t, { dur: 0.14, type: 'lowpass', f: 700, gain: 0.5 })
        this.nz(o, t, { dur: 0.08, f: 1900, q: 1.2, gain: 0.15 })
        break
      }
      case 'step_wolf': {
        const o = this.out(pos, vol * 0.45, 0.05)
        this.nz(o, t, { dur: 0.05, type: 'lowpass', f: 1000, gain: 0.5 })
        this.nz(o, t + 0.07, { dur: 0.05, type: 'lowpass', f: 900, gain: 0.4 })
        break
      }
      case 'step_heavy': {
        const o = this.out(pos, vol, 0.3)
        this.nz(o, t, { dur: 0.25, type: 'lowpass', f: 320, gain: 0.8 })
        this.tone(o, t, { f: 70, f2: 38, dur: 0.3, gain: 0.7 })
        this.nz(o, t + 0.03, { dur: 0.06, type: 'highpass', f: 2200, gain: 0.12 })
        break
      }
      case 'groan': {
        const o = this.out(pos, vol * 0.7, 0.4)
        const f = 80 + R() * 30
        this.tone(o, t, { type: 'sawtooth', f, f2: f * 0.75, dur: 1.3, gain: 0.35, a: 0.2, vib: 6, bp: 520 + R() * 200, q: 3 })
        this.nz(o, t, { dur: 1.1, f: 900, q: 2, gain: 0.08, a: 0.3 })
        break
      }
      case 'growl': {
        const o = this.out(pos, vol * 0.8, 0.2)
        this.tone(o, t, { type: 'sawtooth', f: 72, f2: 60, dur: 0.9, gain: 0.45, a: 0.08, vib: 14, lp: 420, q: 4 })
        this.nz(o, t, { dur: 0.8, type: 'lowpass', f: 500, gain: 0.25, a: 0.1 })
        break
      }
      case 'howl': {
        const o = this.out(pos, vol * 0.6, 0.9)
        const base = 360 + R() * 60
        const osc = ctx.createOscillator()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(base, t)
        osc.frequency.linearRampToValueAtTime(base * 1.6, t + 0.6)
        osc.frequency.linearRampToValueAtTime(base * 1.45, t + 1.8)
        osc.frequency.linearRampToValueAtTime(base * 1.05, t + 2.6)
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 5
        const lg = ctx.createGain()
        lg.gain.value = 8
        lfo.connect(lg).connect(osc.frequency)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.linearRampToValueAtTime(0.35, t + 0.5)
        g.gain.linearRampToValueAtTime(0.25, t + 2)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8)
        osc.connect(g).connect(o)
        osc.start(t)
        lfo.start(t)
        osc.stop(t + 2.9)
        lfo.stop(t + 2.9)
        break
      }
      case 'whisper': {
        const o = this.out(pos, vol * 0.7, 0.7)
        for (let i = 0; i < 5; i++) this.nz(o, t + i * 0.2 + R() * 0.1, { dur: 0.25, f: 2500 + R() * 1500, q: 3, gain: 0.25, a: 0.05 })
        this.tone(o, t, { f: 690, dur: 1.2, gain: 0.04, a: 0.4 })
        this.tone(o, t, { f: 697, dur: 1.2, gain: 0.04, a: 0.4 })
        break
      }
      case 'cast': {
        const o = this.out(pos, vol * 0.7, 0.6)
        this.tone(o, t, { type: 'triangle', f: 260, f2: 880, dur: 0.85, gain: 0.18, a: 0.3, vib: 20 })
        this.nz(o, t, { dur: 0.8, type: 'highpass', f: 3000, gain: 0.08, a: 0.4 })
        break
      }
      case 'orb': {
        const o = this.out(pos, vol * 0.5, 0.4)
        this.tone(o, t, { f: 180, f2: 140, dur: 0.5, gain: 0.25, vib: 30 })
        break
      }
      case 'swing': {
        const o = this.out(pos, vol * 0.6, 0.05)
        this.nz(o, t, { dur: 0.2, f: 1400, f2: 380, q: 1.4, gain: 0.55, a: 0.04 })
        break
      }
      case 'swing_heavy': {
        const o = this.out(pos, vol * 0.8, 0.1)
        this.nz(o, t, { dur: 0.34, f: 900, f2: 160, q: 1.2, gain: 0.7, a: 0.08 })
        this.tone(o, t, { f: 120, f2: 60, dur: 0.3, gain: 0.2, a: 0.08 })
        break
      }
      case 'hit': {
        const o = this.out(pos, vol, 0.15)
        this.tone(o, t, { f: 140, f2: 50, dur: 0.16, gain: 0.8 })
        this.nz(o, t, { dur: 0.07, type: 'lowpass', f: 2600, gain: 0.6 })
        this.nz(o, t + 0.01, { dur: 0.12, f: 600, q: 2, gain: 0.25 })
        break
      }
      case 'hit_heavy': {
        const o = this.out(pos, vol, 0.35)
        this.tone(o, t, { f: 110, f2: 32, dur: 0.38, gain: 1.0 })
        this.nz(o, t, { dur: 0.14, type: 'lowpass', f: 1800, gain: 0.8 })
        this.nz(o, t + 0.02, { dur: 0.3, type: 'lowpass', f: 400, gain: 0.5 })
        break
      }
      case 'hurt': {
        const o = this.out(null, vol * 0.8, 0.1)
        this.tone(o, t, { f: 210, f2: 70, dur: 0.22, gain: 0.6 })
        this.tone(o, t, { type: 'sawtooth', f: 150, f2: 105, dur: 0.22, gain: 0.18, lp: 900 })
        this.nz(o, t, { dur: 0.08, type: 'lowpass', f: 2000, gain: 0.4 })
        break
      }
      case 'dodge': {
        const o = this.out(null, vol * 0.4, 0)
        this.nz(o, t, { dur: 0.18, f: 2600, f2: 900, q: 0.8, gain: 0.35, a: 0.02 })
        break
      }
      case 'chirr': {
        // a marten's warning: a dry, quick chatter
        const o = this.out(pos, vol * 0.55, 0.15)
        for (let i = 0; i < 7; i++) this.nz(o, t + i * 0.034 + R() * 0.006, { dur: 0.022, f: 3200 + R() * 900, q: 6, gain: 0.5, a: 0.002 })
        this.tone(o, t, { type: 'triangle', f: 1900, f2: 1500, dur: 0.24, gain: 0.05, a: 0.01 })
        break
      }
      case 'splash': {
        // a foot in shallow water: a wet slap and a few droplets
        const o = this.out(pos, vol * 0.6, 0.2)
        this.nz(o, t, { dur: 0.22, type: 'bandpass', f: 1500, f2: 450, q: 0.7, gain: 0.55, a: 0.004 })
        for (let i = 0; i < 3; i++) this.tone(o, t + 0.05 + i * 0.045 + R() * 0.02, { type: 'sine', f: 1800 + R() * 1400, f2: 2600 + R() * 900, dur: 0.05, gain: 0.04, a: 0.002 })
        break
      }
      case 'cry': {
        // a child crying far away: broken sobs, then a long thin wail
        const o = this.out(pos, vol * 0.5, 0.7)
        for (let i = 0; i < 3; i++) this.tone(o, t + i * 0.42, { type: 'triangle', f: 560 + R() * 40, f2: 430, dur: 0.3, gain: 0.07, a: 0.03, vib: 18, lp: 1800 })
        this.tone(o, t + 1.35, { type: 'triangle', f: 640, f2: 470, dur: 1.1, gain: 0.08, a: 0.12, vib: 9, lp: 1900 })
        break
      }
      case 'kurai': {
        // a few breathy notes of a boy's kurai whistle
        const o = this.out(pos, vol * 0.45, 0.8)
        const notes = [587, 659, 784, 659, 523]
        notes.forEach((f, i) => {
          const at = t + i * 0.34
          this.tone(o, at, { type: 'sine', f, f2: f * 1.005, dur: 0.32, gain: 0.06, a: 0.05, vib: 6 })
          this.nz(o, at, { dur: 0.3, type: 'bandpass', f, q: 12, gain: 0.12, a: 0.06 })
        })
        break
      }
      case 'whimper': {
        // thin, broken whine of a trapped animal
        const o = this.out(pos, vol * 0.45, 0.2)
        this.tone(o, t, { f: 1150, f2: 760, dur: 0.42, gain: 0.16, a: 0.04, vib: 30 })
        this.tone(o, t + 0.5, { f: 980, f2: 700, dur: 0.3, gain: 0.1, a: 0.03, vib: 25 })
        break
      }
      case 'clang': {
        // Ответ: blade on blade, a bright ring that lingers
        const o = this.out(pos, vol * 0.7, 0.6)
        for (const [f, g] of [
          [1240, 0.22],
          [1873, 0.12],
          [2610, 0.07],
        ])
          this.tone(o, t, { f, f2: f * 0.985, dur: 0.9, gain: g, a: 0.002 })
        this.nz(o, t, { dur: 0.05, type: 'highpass', f: 3000, gain: 0.5 })
        break
      }
      case 'perfect': {
        const o = this.out(null, vol * 0.5, 0.9)
        for (const [f, g] of [
          [880, 0.25],
          [1318, 0.16],
          [1760, 0.1],
        ])
          this.tone(o, t, { f, dur: 1.4, gain: g, a: 0.005 })
        break
      }
      case 'lasso': {
        const o = this.out(null, vol * 0.5, 0.1)
        for (let i = 0; i < 3; i++) this.nz(o, t + i * 0.08, { dur: 0.09, f: 1200 + i * 300, q: 2, gain: 0.25 })
        this.nz(o, t + 0.26, { dur: 0.06, type: 'highpass', f: 2500, gain: 0.3 })
        break
      }
      case 'arrow': {
        const o = this.out(null, vol * 0.5, 0.05)
        this.tone(o, t, { type: 'triangle', f: 230, f2: 170, dur: 0.18, gain: 0.3 })
        this.nz(o, t, { dur: 0.12, f: 3200, q: 1.5, gain: 0.25 })
        break
      }
      case 'arrow_hit': {
        const o = this.out(pos, vol * 0.6, 0.1)
        this.nz(o, t, { dur: 0.05, type: 'lowpass', f: 3000, gain: 0.6 })
        this.tone(o, t, { f: 300, f2: 120, dur: 0.08, gain: 0.3 })
        break
      }
      case 'eagle': {
        const o = this.out(pos, vol * 0.45, 0.8)
        this.tone(o, t, { type: 'sawtooth', f: 1900, f2: 1250, dur: 0.7, gain: 0.25, vib: 40, bp: 2200, q: 2 })
        this.tone(o, t + 0.75, { type: 'sawtooth', f: 1700, f2: 1300, dur: 0.4, gain: 0.15, vib: 40, bp: 2000, q: 2 })
        break
      }
      case 'drink': {
        const o = this.out(null, vol * 0.5, 0.2)
        for (let i = 0; i < 4; i++) this.tone(o, t + i * 0.13, { f: 300 + R() * 250, f2: 500 + R() * 300, dur: 0.1, gain: 0.25 })
        this.tone(o, t + 0.5, { f: 660, dur: 0.9, gain: 0.08, a: 0.1 })
        this.tone(o, t + 0.5, { f: 990, dur: 0.9, gain: 0.05, a: 0.1 })
        break
      }
      case 'spring':
      case 'revive': {
        const o = this.out(pos, vol * 0.5, 1)
        const notes = kind === 'spring' ? [440, 523.25, 659.25, 880] : [293.66, 392, 440, 587.33, 659.25, 880]
        notes.forEach((f, i) => this.tone(o, t + i * 0.12, { f, dur: 1.6, gain: 0.16, a: 0.01 }))
        this.nz(o, t, { dur: 1.2, type: 'highpass', f: 5000, gain: 0.05, a: 0.4 })
        break
      }
      case 'ignite': {
        const o = this.out(pos, vol * 0.8, 0.2)
        this.nz(o, t, { dur: 0.7, type: 'lowpass', f: 200, f2: 2400, gain: 0.6, a: 0.12 })
        this.tone(o, t, { f: 80, f2: 140, dur: 0.5, gain: 0.25, a: 0.1 })
        break
      }
      case 'douse': {
        const o = this.out(pos, vol * 0.6, 0.3)
        this.nz(o, t, { dur: 0.8, type: 'lowpass', f: 2400, f2: 150, gain: 0.5, a: 0.02 })
        break
      }
      case 'giggle': {
        const o = this.out(pos, vol * 0.75, 0.8)
        const n = 6 + Math.floor(R() * 4)
        for (let i = 0; i < n; i++) {
          const f = 420 + R() * 260 + (i % 2) * 80
          this.tone(o, t + i * 0.11, { type: 'sawtooth', f, f2: f * 0.8, dur: 0.09, gain: 0.3, bp: 1100, q: 4 })
        }
        break
      }
      case 'roar': {
        const o = this.out(pos, vol, 0.9)
        this.tone(o, t, { type: 'sawtooth', f: 95, f2: 52, dur: 1.8, gain: 0.6, a: 0.15, vib: 10, lp: 700, q: 3 })
        this.tone(o, t, { type: 'square', f: 140, f2: 80, dur: 1.6, gain: 0.15, a: 0.2, bp: 900, q: 5 })
        this.nz(o, t, { dur: 1.7, type: 'lowpass', f: 900, f2: 300, gain: 0.5, a: 0.15 })
        break
      }
      case 'crack': {
        const o = this.out(pos, vol * 0.7, 0.4)
        for (let i = 0; i < 3; i++) this.nz(o, t + i * (0.03 + R() * 0.07), { dur: 0.04, type: 'highpass', f: 1200 + R() * 1500, gain: 0.5 })
        break
      }
      case 'boom': {
        const o = this.out(pos, vol, 0.6)
        this.tone(o, t, { f: 75, f2: 24, dur: 0.9, gain: 1.0 })
        this.nz(o, t, { dur: 0.6, type: 'lowpass', f: 500, f2: 120, gain: 0.9 })
        this.nz(o, t, { dur: 0.08, type: 'highpass', f: 1500, gain: 0.25 })
        break
      }
      case 'death': {
        const o = this.out(pos, vol * 0.7, 0.5)
        this.tone(o, t, { type: 'sawtooth', f: 220, f2: 55, dur: 0.8, gain: 0.3, lp: 800 })
        this.nz(o, t, { dur: 0.6, type: 'lowpass', f: 600, f2: 150, gain: 0.3 })
        break
      }
      case 'ui': {
        const o = this.out(null, vol * 0.4, 0.3)
        this.tone(o, t, { type: 'triangle', f: 660, dur: 0.15, gain: 0.15 })
        break
      }
      case 'leap': {
        const o = this.out(pos, vol * 0.8, 0.3)
        this.nz(o, t, { dur: 0.5, f: 300, f2: 1800, q: 1, gain: 0.5, a: 0.1 })
        break
      }
      case 'thorns': {
        const o = this.out(pos, vol * 0.8, 0.5)
        for (let i = 0; i < 12; i++) this.nz(o, t + i * 0.07 + R() * 0.04, { dur: 0.05, type: 'highpass', f: 900 + R() * 2000, gain: 0.35 })
        this.nz(o, t, { dur: 1.0, type: 'lowpass', f: 300, gain: 0.4, a: 0.2 })
        break
      }
      case 'teleport': {
        const o = this.out(pos, vol * 0.6, 0.8)
        this.nz(o, t, { dur: 0.5, f: 4000, f2: 400, q: 3, gain: 0.3, a: 0.3 })
        this.tone(o, t, { f: 1200, f2: 300, dur: 0.5, gain: 0.08 })
        break
      }
      case 'bite': {
        const o = this.out(pos, vol * 0.8, 0.1)
        this.nz(o, t, { dur: 0.06, type: 'highpass', f: 1500, gain: 0.6 })
        this.tone(o, t, { type: 'sawtooth', f: 160, f2: 90, dur: 0.15, gain: 0.25, lp: 900 })
        break
      }
      case 'crackle': {
        const o = this.out(pos, vol * 0.55, 0.15)
        const n = 1 + Math.floor(R() * 3)
        for (let i = 0; i < n; i++) this.nz(o, t + R() * 0.12, { dur: 0.02 + R() * 0.03, type: 'highpass', f: 1800 + R() * 3500, gain: 0.35 + R() * 0.3 })
        if (R() < 0.3) this.nz(o, t, { dur: 0.25, type: 'lowpass', f: 260, gain: 0.25, a: 0.05 })
        break
      }
      case 'water': {
        const o = this.out(pos, vol * 0.4, 0.4)
        for (let i = 0; i < 3; i++) {
          const f = 500 + R() * 900
          this.tone(o, t + R() * 0.3, { f, f2: f * (1.4 + R() * 0.6), dur: 0.05 + R() * 0.05, gain: 0.12 })
        }
        this.nz(o, t, { dur: 0.4, f: 1400 + R() * 600, q: 1.5, gain: 0.05, a: 0.1 })
        break
      }
      case 'heartbeat': {
        const o = this.out(null, vol * 0.7, 0)
        this.tone(o, t, { f: 58, f2: 40, dur: 0.18, gain: 0.8 })
        this.tone(o, t + 0.22, { f: 52, f2: 38, dur: 0.2, gain: 0.55 })
        break
      }
    }
  }

  // ------------------------------------------------------------ ambience

  update(dt: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    this.ubyr?.update()
    this.wolf?.update()
    const now = ctx.currentTime
    if (now > this.nextGust) {
      this.nextGust = now + 2 + Math.random() * 4
      const g = 0.06 + Math.random() * 0.14
      this.windGain.gain.setTargetAtTime(g, now, 1.2)
      this.windFilter.frequency.setTargetAtTime(250 + g * 2200, now, 1.5)
    }
    const lp = this.listenerPos
    const mood = this.music?.mood ?? 'explore'
    if (now > this.nextOwl && (mood === 'explore' || mood === 'tension')) {
      this.nextOwl = now + 18 + Math.random() * 25
      const a = Math.random() * Math.PI * 2
      const p = new THREE.Vector3(lp.x + Math.cos(a) * 25, 6, lp.z + Math.sin(a) * 25)
      const o = this.out(p, 0.5, 0.9)
      this.tone(o, now, { f: 390, f2: 370, dur: 0.45, gain: 0.25, a: 0.05, vib: 4 })
      this.tone(o, now + 0.6, { f: 350, f2: 330, dur: 0.7, gain: 0.22, a: 0.05, vib: 4 })
    }
    if (now > this.nextCrack) {
      this.nextCrack = now + 6 + Math.random() * 10
      const a = Math.random() * Math.PI * 2
      this.play('crack', new THREE.Vector3(lp.x + Math.cos(a) * 18, 0, lp.z + Math.sin(a) * 18), 0.35)
    }
    this.music?.update()
    if (this.lowHp > 0.5) {
      this.heartT -= dt
      if (this.heartT <= 0) {
        this.heartT = 0.9
        this.play('heartbeat', null, 0.6 * this.lowHp)
      }
    }
  }
}
