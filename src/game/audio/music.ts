/**
 * Adaptive score, fully synthesised.
 *
 *  explore  — kuray phrases (breathy, with the player's own hummed drone), low pad, long silences
 *  tension  — a throat-singer's drone rises, a slow frame-drum heartbeat, lone dumbyra plucks
 *  combat   — uzlyau: additive chest drone + a whistling overtone that glides along the natural
 *             harmonic series; galloping frame drum, strummed dumbyra, kubyz
 *  boss     — denser drums, shaker
 *  boss2    — the voice drops a tone and growls (kargyra sub-harmonic)
 *  victory  — the voice settles into a slow line, kuray answers
 *
 * Uzlyau model: a voice is a sum of harmonics with a glottal spectral tilt shaped by vowel formants.
 * The overtone melody is a second, sharply resonant bank of the same harmonics whose resonance
 * centre sweeps between harmonic numbers — passing through neighbours exactly like a singer's
 * tongue moving the resonance. Everything is scheduled sample-accurately (works offline too).
 */

export type Mood = 'explore' | 'tension' | 'combat' | 'boss' | 'boss2' | 'victory' | 'silent'

interface Mix {
  kuray: number
  drone: number
  overtone: number
  sub: number
  drums: number
  dumbyra: number
  kubyz: number
  pad: number
}

const MIX: Record<Mood, Mix> = {
  explore: { kuray: 1, drone: 0, overtone: 0, sub: 0, drums: 0, dumbyra: 0, kubyz: 0, pad: 0.06 },
  tension: { kuray: 0.2, drone: 0.6, overtone: 0.3, sub: 0, drums: 0.55, dumbyra: 0.5, kubyz: 0, pad: 0.08 },
  combat: { kuray: 0, drone: 0.85, overtone: 1, sub: 0, drums: 0.9, dumbyra: 0.8, kubyz: 0.35, pad: 0.06 },
  boss: { kuray: 0, drone: 0.95, overtone: 1, sub: 0.1, drums: 1.05, dumbyra: 0.9, kubyz: 0.45, pad: 0.08 },
  boss2: { kuray: 0, drone: 0.95, overtone: 1.05, sub: 0.4, drums: 1.0, dumbyra: 0.9, kubyz: 0.5, pad: 0.1 },
  victory: { kuray: 1, drone: 0.5, overtone: 0.6, sub: 0, drums: 0, dumbyra: 0.4, kubyz: 0, pad: 0.05 },
  silent: { kuray: 0, drone: 0, overtone: 0, sub: 0, drums: 0, dumbyra: 0, kubyz: 0, pad: 0.03 },
}

type Note = [step: number, harmonic: number, glide: number]

/** Overtone phrases over 24 steps (2 bars of triplet-eighths). Long holds, slow slides, grace flicks. */
const PHRASES: Note[][] = [
  [
    [0, 8, 0.18],
    [6, 9, 0.09],
    [9, 10, 0.07],
    [12, 12, 0.22],
    [17, 13, 0.02],
    [18, 12, 0.03],
    [20, 10, 0.12],
  ],
  [
    [0, 10, 0.12],
    [3, 9, 0.06],
    [6, 8, 0.14],
    [12, 9, 0.1],
    [14, 10, 0.06],
    [16, 12, 0.12],
    [21, 10, 0.16],
  ],
  [
    [0, 6, 0.25],
    [6, 8, 0.2],
    [11, 9, 0.03],
    [12, 8, 0.05],
    [15, 10, 0.14],
    [21, 9, 0.12],
  ],
  [
    [0, 12, 0.2],
    [5, 13, 0.02],
    [6, 12, 0.03],
    [9, 10, 0.1],
    [12, 9, 0.12],
    [18, 8, 0.2],
  ],
  [
    [0, 9, 0.15],
    [3, 10, 0.08],
    [6, 12, 0.12],
    [10, 16, 0.18],
    [15, 12, 0.14],
    [18, 10, 0.1],
    [21, 8, 0.2],
  ],
]

/** Temporarily muted layers (throat singing and jaw harp are off until the voice is reworked). */
const VOICE_ON = false
const KUBYZ_ON = false

const KURAY_NOTES = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33]
const BPM = 92
const OV_LO = 5
const OV_HI = 17

const ease = (u: number) => u * u * (3 - 2 * u)

class Uzlyau {
  readonly breath: GainNode
  readonly droneBus: GainNode
  readonly ovBus: GainNode
  readonly subBus: GainNode
  private drone: OscillatorNode[] = []
  private ov: { n: number; osc: OscillatorNode; g: GainNode }[] = []
  private sub: OscillatorNode
  private airFilter: BiquadFilterNode
  f0: number
  private c0 = 8
  private c1 = 8
  private ct0 = 0
  private cd = 0.01

  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    f0 = 110,
  ) {
    this.f0 = f0
    const t = ctx.currentTime
    this.breath = ctx.createGain()
    this.breath.connect(dest)
    this.droneBus = ctx.createGain()
    this.droneBus.gain.value = 0
    this.droneBus.connect(this.breath)
    this.ovBus = ctx.createGain()
    this.ovBus.gain.value = 0
    this.ovBus.connect(this.breath)
    this.subBus = ctx.createGain()
    this.subBus.gain.value = 0
    this.subBus.connect(this.breath)

    // shared vibrato (in cents, so every harmonic moves together) + slow pitch drift
    const vib = ctx.createOscillator()
    vib.frequency.value = 4.6
    const vibG = ctx.createGain()
    vibG.gain.value = 5
    vib.connect(vibG)
    const drift = ctx.createOscillator()
    drift.frequency.value = 0.13
    const driftG = ctx.createGain()
    driftG.gain.value = 4
    drift.connect(driftG)
    vib.start(t)
    drift.start(t)

    // chest drone: glottal tilt shaped by an "o/ы" vowel
    for (let n = 1; n <= 24; n++) {
      const f = n * f0
      const tilt = 1 / Math.pow(n, 1.15)
      const vowel = 0.3 + Math.exp(-(((f - 520) / 240) ** 2)) * 1.1 + Math.exp(-(((f - 1050) / 280) ** 2)) * 0.35 + Math.exp(-(((f - 2500) / 400) ** 2)) * 0.12
      const o = ctx.createOscillator()
      o.frequency.value = f
      vibG.connect(o.detune)
      driftG.connect(o.detune)
      const g = ctx.createGain()
      g.gain.value = tilt * vowel * 0.32
      o.connect(g).connect(this.droneBus)
      o.start(t)
      this.drone.push(o)
    }
    // overtone bank
    for (let n = OV_LO; n <= OV_HI; n++) {
      const o = ctx.createOscillator()
      o.frequency.value = n * f0
      vibG.connect(o.detune)
      driftG.connect(o.detune)
      const g = ctx.createGain()
      g.gain.value = this.resAmp(n, 8)
      o.connect(g).connect(this.ovBus)
      o.start(t)
      this.ov.push({ n, osc: o, g })
    }
    // shimmer on the whistle
    const sh = ctx.createOscillator()
    sh.frequency.value = 6.7
    const shG = ctx.createGain()
    shG.gain.value = 0.06
    sh.connect(shG).connect(this.ovBus.gain)
    sh.start(t)
    // breath air riding the resonance
    const air = ctx.createBufferSource()
    air.buffer = noise
    air.loop = true
    this.airFilter = ctx.createBiquadFilter()
    this.airFilter.type = 'bandpass'
    this.airFilter.frequency.value = 8 * f0
    this.airFilter.Q.value = 9
    const airG = ctx.createGain()
    airG.gain.value = 0.05
    air.connect(this.airFilter).connect(airG).connect(this.ovBus)
    air.start(t)
    // kargyra: rough sub-harmonic growl
    this.sub = ctx.createOscillator()
    this.sub.type = 'sawtooth'
    this.sub.frequency.value = f0 / 2
    const subLp = ctx.createBiquadFilter()
    subLp.type = 'lowpass'
    subLp.frequency.value = 380
    subLp.Q.value = 3
    const subG = ctx.createGain()
    subG.gain.value = 0.18
    this.sub.connect(subLp).connect(subG).connect(this.subBus)
    this.sub.start(t)
  }

  private resAmp(n: number, centre: number) {
    return 0.42 * Math.exp(-(((n - centre) / 0.38) ** 2)) * (1.1 - n / 40)
  }

  private centreAt(t: number) {
    if (t >= this.ct0 + this.cd) return this.c1
    if (t <= this.ct0) return this.c0
    return this.c0 + (this.c1 - this.c0) * ease((t - this.ct0) / this.cd)
  }

  setF0(f: number, t: number) {
    this.f0 = f
    this.drone.forEach((o, i) => o.frequency.setTargetAtTime(f * (i + 1), t, 0.5))
    for (const v of this.ov) v.osc.frequency.setTargetAtTime(f * v.n, t, 0.5)
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.5)
  }

  /** Slide the resonance to harmonic `n` starting at time t, over ~glide*3 seconds. */
  glide(n: number, t: number, glide: number) {
    const from = this.centreAt(t)
    const d = Math.max(0.035, glide * 3)
    const K = 8
    for (const v of this.ov) {
      v.g.gain.cancelScheduledValues(t)
      v.g.gain.setValueAtTime(this.resAmp(v.n, from), t)
      for (let k = 1; k <= K; k++) {
        const c = from + (n - from) * ease(k / K)
        v.g.gain.linearRampToValueAtTime(this.resAmp(v.n, c), t + (d * k) / K)
      }
    }
    this.airFilter.frequency.setTargetAtTime(n * this.f0, t, d / 2)
    this.c0 = from
    this.c1 = n
    this.ct0 = t
    this.cd = d
  }

  breathe(t: number, dur: number) {
    const g = this.breath.gain
    g.setTargetAtTime(0.05, t, 0.06)
    g.setTargetAtTime(1, t + dur, 0.12)
  }
}

export class Music {
  mood: Mood = 'explore'
  private buses: Record<'kuray' | 'voice' | 'drums' | 'dumbyra' | 'kubyz' | 'pad', GainNode>
  private voice: Uzlyau
  private step = 0
  private nextStep = 0
  private phrase = PHRASES[0]
  private nextKuray = 4
  private readonly sp = 60 / BPM / 3

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    verb: AudioNode,
    private noise: AudioBuffer,
  ) {
    const mk = (send: number, start = 0) => {
      const g = ctx.createGain()
      g.gain.value = start
      g.connect(out)
      const s = ctx.createGain()
      s.gain.value = send
      g.connect(s).connect(verb)
      return g
    }
    this.buses = { kuray: mk(0.8), voice: mk(0.6, 0.85), drums: mk(0.22), dumbyra: mk(0.35), kubyz: mk(0.3), pad: mk(0.4) }
    this.voice = new Uzlyau(ctx, this.buses.voice, noise)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 170
    lp.connect(this.buses.pad)
    for (const f of [55, 55.3, 82.4]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = f > 60 ? 0.25 : 0.5
      o.connect(g).connect(lp)
      o.start()
    }
    this.applyMix(true)
  }

  setMood(m: Mood) {
    if (m === this.mood) return
    const prev = this.mood
    this.mood = m
    const t = this.ctx.currentTime
    this.voice.setF0(m === 'boss2' ? 98 : 110, t)
    if (m === 'victory') this.kuray(t + 1.5, 9)
    const fight = (x: Mood) => x === 'combat' || x === 'boss' || x === 'boss2'
    if (fight(m) && !fight(prev)) this.step = Math.ceil(this.step / 12) * 12
    this.applyMix(false)
  }

  private applyMix(instant: boolean) {
    const m = MIX[this.mood]
    const t = this.ctx.currentTime
    const set = (p: AudioParam, v: number, tau: number) => (instant ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, tau))
    set(this.buses.kuray.gain, m.kuray, 2.5)
    set(this.buses.drums.gain, m.drums, 1.2)
    set(this.buses.dumbyra.gain, m.dumbyra, 1.2)
    set(this.buses.kubyz.gain, KUBYZ_ON ? m.kubyz : 0, 1.2)
    set(this.buses.pad.gain, m.pad, 2)
    set(this.voice.droneBus.gain, VOICE_ON ? m.drone : 0, 1.8)
    set(this.voice.ovBus.gain, VOICE_ON ? m.overtone : 0, 1.8)
    set(this.voice.subBus.gain, VOICE_ON ? m.sub : 0, 1.5)
  }

  /** A single kuray phrase now (prologue, story beats). */
  playKuray(n = 7) {
    this.kuray(this.ctx.currentTime + 0.4, n)
  }

  /** Realtime: schedule ~250 ms ahead. */
  update() {
    const now = this.ctx.currentTime
    if (this.nextStep < now) this.nextStep = now + 0.05
    this.scheduleUntil(now + 0.25)
    const m = this.mood
    if ((m === 'explore' || m === 'tension') && now > this.nextKuray) {
      this.nextKuray = now + 14 + Math.random() * 14
      this.kuray(now + 0.1, 4 + Math.floor(Math.random() * 4))
    }
  }

  /** Schedule every step up to time T (also used to pre-render offline). */
  scheduleUntil(T: number) {
    while (this.nextStep < T) {
      this.tick(this.step, this.nextStep)
      this.nextStep += this.sp
      this.step++
    }
  }

  private tick(step: number, t: number) {
    const m = this.mood
    const b = step % 12
    const ps = step % 24
    const fight = m === 'combat' || m === 'boss' || m === 'boss2'
    const f0 = this.voice.f0
    // ---- voice
    if (fight) {
      if (ps === 0) this.phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)]
      for (const [s, n, g] of this.phrase) if (s === ps) this.voice.glide(n, t, g)
      if (ps === 23) this.voice.breathe(t, 0.22)
    } else if (m === 'tension') {
      if (step % 24 === 0) this.voice.glide(Math.random() < 0.5 ? 6 : 8, t, 0.5)
      if (step % 48 === 44) this.voice.breathe(t, 0.6)
    } else if (m === 'victory') {
      if (step % 12 === 0) this.voice.glide([8, 9, 10, 12, 10, 9, 8, 6][Math.floor(step / 12) % 8], t, 0.35)
      if (step % 48 === 45) this.voice.breathe(t, 0.7)
    }
    // ---- drums: horse gallop  DUM . . . ta ta | DUM . . . ta ta
    if (m === 'tension') {
      if (b === 0) this.lowDrum(t, 0.7)
      if (b === 2) this.lowDrum(t, 0.4)
    } else if (fight) {
      if (b === 0) this.lowDrum(t, 1)
      if (b === 6) this.lowDrum(t, 0.85)
      if (b === 4 || b === 10) this.slap(t, 0.45)
      if (b === 5 || b === 11) this.slap(t, 0.6)
      if (m !== 'combat') {
        if (b === 3 || b === 9) this.lowDrum(t, 0.5)
        this.shaker(t, b % 6 === 0 ? 0.35 : 0.16)
      }
      if (m === 'boss2' && (b === 2 || b === 8)) this.slap(t, 0.5)
    }
    // ---- dumbyra: strummed root + fifth on the gallop
    if (fight) {
      const root = f0 * 2
      if (b === 0 || b === 6) this.strum(t, root, 1)
      if (b === 4 || b === 5 || b === 10 || b === 11) this.strum(t, root, 0.55)
      if (m !== 'combat' && (b === 2 || b === 8)) this.pluck(t, root * 2, 0.4)
      if (ps === 18 && Math.random() < 0.5) this.pluck(t, root * 1.333, 0.6)
    } else if (m === 'tension' && b === 0 && step % 24 === 0) {
      this.pluck(t, f0 * 2, 0.5)
    } else if (m === 'victory' && b === 0) {
      this.strum(t, f0 * 2, 0.4)
    }
    // ---- kubyz: sparse accents
    if (KUBYZ_ON && fight && (b === 0 || (m !== 'combat' && b === 6))) this.kubyz(t, this.sp * 3, f0 * 2, b === 0 ? 1 : 0.7)
  }

  // ------------------------------------------------------------ instruments

  private env(g: GainNode, t: number, peak: number, attack: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  }

  private lowDrum(t: number, v: number) {
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(92, t)
    o.frequency.exponentialRampToValueAtTime(46, t + 0.35)
    const g = ctx.createGain()
    this.env(g, t, 0.8 * v, 0.006, 0.5)
    o.connect(g).connect(this.buses.drums)
    o.start(t)
    o.stop(t + 0.55)
    this.noiseHit(t, 'lowpass', 380, 1, 0.3 * v, 0.16, this.buses.drums)
  }

  private slap(t: number, v: number) {
    this.noiseHit(t, 'bandpass', 1300, 1.2, 0.4 * v, 0.07, this.buses.drums)
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(190, t)
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08)
    const g = ctx.createGain()
    this.env(g, t, 0.3 * v, 0.004, 0.12)
    o.connect(g).connect(this.buses.drums)
    o.start(t)
    o.stop(t + 0.15)
  }

  private shaker(t: number, v: number) {
    this.noiseHit(t, 'highpass', 6000, 0.7, 0.16 * v, 0.06, this.buses.drums)
  }

  private noiseHit(t: number, type: BiquadFilterType, f: number, q: number, gain: number, dur: number, dest: AudioNode) {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const flt = ctx.createBiquadFilter()
    flt.type = type
    flt.frequency.value = f
    flt.Q.value = q
    const g = ctx.createGain()
    this.env(g, t, gain, 0.003, dur)
    src.connect(flt).connect(g).connect(dest)
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.02)
  }

  /** Karplus–Strong plucked string (dumbyra). */
  private pluck(t: number, f: number, v: number) {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const exc = ctx.createGain()
    this.env(exc, t, 0.5 * v, 0.001, 0.012)
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 2400 + v * 1500
    const delay = ctx.createDelay(0.05)
    delay.delayTime.value = 1 / f
    // averaging filter: |H| <= 1 at every frequency, so the loop always decays (a resonant biquad here explodes)
    const damp = ctx.createIIRFilter([0.5, 0.5], [1])
    const fb = ctx.createGain()
    fb.gain.setValueAtTime(0.985, t)
    fb.gain.setTargetAtTime(0.0, t + 1.4, 0.15)
    const out = ctx.createGain()
    out.gain.value = 0.55
    src.connect(tone).connect(exc).connect(delay)
    delay.connect(damp).connect(fb).connect(delay)
    delay.connect(out).connect(this.buses.dumbyra)
    src.start(t, Math.random() * 1.5)
    src.stop(t + 0.03)
    if (typeof window !== 'undefined' && ctx instanceof AudioContext) {
      const ms = (t - ctx.currentTime + 2.2) * 1000
      window.setTimeout(() => {
        fb.disconnect()
        out.disconnect()
      }, Math.max(0, ms))
    }
  }

  private strum(t: number, root: number, v: number) {
    this.pluck(t, root, v)
    this.pluck(t + 0.014, root * 1.5, v * 0.8)
    this.pluck(t + 0.026, root * 2, v * 0.45)
  }

  private kubyz(t: number, dur: number, f: number, v: number) {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = f
    const flt = ctx.createBiquadFilter()
    flt.type = 'bandpass'
    flt.Q.value = 10
    flt.frequency.setValueAtTime(500, t)
    flt.frequency.exponentialRampToValueAtTime(1700 + Math.random() * 500, t + dur * 0.45)
    flt.frequency.exponentialRampToValueAtTime(520, t + dur)
    const g = ctx.createGain()
    this.env(g, t, 0.2 * v, 0.005, dur)
    osc.connect(flt).connect(g).connect(this.buses.kubyz)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  /** One legato kuray phrase: a breathy end-blown reed gliding between notes over a hummed drone. */
  private kuray(t0: number, n: number) {
    const ctx = this.ctx
    const dest = this.buses.kuray
    const durs: number[] = []
    const notes: number[] = []
    let idx = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i++) {
      idx = Math.max(0, Math.min(KURAY_NOTES.length - 1, idx + Math.floor(Math.random() * 5) - 2))
      notes.push(KURAY_NOTES[idx])
      durs.push(i === n - 1 ? 2.8 : 0.7 + Math.random() * 1.3)
    }
    const total = durs.reduce((a, b) => a + b, 0)
    const osc = ctx.createOscillator()
    const o2 = ctx.createOscillator()
    o2.type = 'triangle'
    const o2g = ctx.createGain()
    o2g.gain.value = 0.07
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 5
    const lg = ctx.createGain()
    lg.gain.value = 0
    lfo.connect(lg)
    lg.connect(osc.frequency)
    lg.connect(o2.frequency)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(0.06, t0 + 0.4)
    let t = t0
    osc.frequency.setValueAtTime(notes[0] * 0.95, t)
    o2.frequency.setValueAtTime(notes[0] * 2 * 0.95, t)
    notes.forEach((f, i) => {
      osc.frequency.setTargetAtTime(f, t, 0.08)
      o2.frequency.setTargetAtTime(f * 2, t, 0.08)
      lg.gain.setTargetAtTime(0, t, 0.05)
      lg.gain.setTargetAtTime(f * 0.013, t + durs[i] * 0.45, 0.3)
      g.gain.setTargetAtTime(0.045 + Math.random() * 0.025, t + 0.1, 0.25)
      this.air(dest, t, durs[i], f)
      t += durs[i]
    })
    g.gain.setTargetAtTime(0.0001, t - 0.9, 0.4)
    osc.connect(g)
    o2.connect(o2g).connect(g)
    g.connect(dest)
    // the kurayist's hummed drone underneath
    const hum = ctx.createOscillator()
    hum.type = 'triangle'
    hum.frequency.value = 110
    const hlp = ctx.createBiquadFilter()
    hlp.type = 'lowpass'
    hlp.frequency.value = 500
    const hg = ctx.createGain()
    hg.gain.setValueAtTime(0.0001, t0)
    hg.gain.linearRampToValueAtTime(0.03, t0 + 1)
    hg.gain.setTargetAtTime(0.0001, t0 + total - 0.8, 0.4)
    hum.connect(hlp).connect(hg).connect(dest)
    for (const o of [osc, o2, lfo, hum]) {
      o.start(t0)
      o.stop(t0 + total + 1.2)
    }
  }

  private air(dest: AudioNode, t: number, dur: number, f: number) {
    const ctx = this.ctx
    for (const [mul, q, amp] of [
      [1, 4, 0.05],
      [2, 6, 0.025],
    ] as const) {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      const flt = ctx.createBiquadFilter()
      flt.type = 'bandpass'
      flt.frequency.value = f * mul
      flt.Q.value = q
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(amp * 1.6, t + 0.06)
      g.gain.setTargetAtTime(amp, t + 0.08, 0.15)
      g.gain.setTargetAtTime(0.0001, t + dur - 0.1, 0.08)
      src.connect(flt).connect(g).connect(dest)
      src.start(t, Math.random())
      src.stop(t + dur + 0.3)
    }
  }
}
