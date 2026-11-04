// Generative night ambience: an evolving pad, filtered-noise wind, sparse
// crickets and the odd glassy chime. Everything feeds a master low-pass (the
// hover "muffle") and a master gain (mute fades). The AudioContext is only
// created inside the first toggle so no autoplay warnings fire on load.

export interface AudioStore {
  isInitialized: boolean
  muted: boolean
  initAudio(): void
  toggleMute(): boolean
  /** 0 = open, 1 = fully muffled */
  setMuffle(amount: number): void
}

const MIDI = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

// slow, open voicings (D lydian-ish wandering)
const CHORDS = [
  [50, 57, 64, 66, 73],
  [47, 54, 62, 69, 71],
  [43, 50, 59, 64, 69],
  [45, 52, 61, 64, 68],
  [48, 55, 62, 67, 71],
]
const CHIME_NOTES = [74, 76, 78, 81, 83, 86, 88]

class Ambience implements AudioStore {
  isInitialized = false
  muted = true
  private ctx: AudioContext | null = null
  private master!: GainNode
  private lowpass!: BiquadFilterNode
  private reverbIn!: GainNode
  private voices: { oscs: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode }[] = []
  private chord = 0
  private timers: number[] = []
  private muffle = 0
  private hidden = false

  initAudio() {
    if (this.isInitialized) return
    this.isInitialized = true
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      if (!this.ctx) return
      if (this.hidden) void this.ctx.suspend()
      else if (!this.muted) void this.ctx.resume()
    })
  }

  toggleMute() {
    if (!this.isInitialized) this.initAudio()
    if (!this.ctx) this.build()
    const ctx = this.ctx
    if (!ctx) return this.muted
    this.muted = !this.muted
    const now = ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(this.master.gain.value, now)
    if (!this.muted) {
      if (ctx.state !== 'running') void ctx.resume()
      this.master.gain.setTargetAtTime(0.9, now, 0.4)
      this.startSchedulers()
    } else {
      this.master.gain.setTargetAtTime(0, now, 0.35)
      this.stopSchedulers()
    }
    return this.muted
  }

  setMuffle(amount: number) {
    const a = Math.min(1, Math.max(0, amount))
    if (Math.abs(a - this.muffle) < 0.002) return
    this.muffle = a
    if (!this.ctx) return
    // exponential sweep 16 kHz → 380 Hz
    const f = 16000 * Math.pow(380 / 16000, a)
    this.lowpass.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08)
  }

  private build() {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx

    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.lowpass = ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.Q.value = 0.9
    this.lowpass.frequency.value = 16000 * Math.pow(380 / 16000, this.muffle)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    this.lowpass.connect(this.master)
    this.master.connect(comp)
    comp.connect(ctx.destination)

    // procedural reverb: decaying stereo noise impulse
    const conv = ctx.createConvolver()
    const len = Math.floor(ctx.sampleRate * 4.5)
    const ir = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
    }
    conv.buffer = ir
    this.reverbIn = ctx.createGain()
    this.reverbIn.gain.value = 1
    const wet = ctx.createGain()
    wet.gain.value = 0.55
    this.reverbIn.connect(conv)
    conv.connect(wet)
    wet.connect(this.lowpass)

    this.buildPad(ctx)
    this.buildWind(ctx)
  }

  private buildPad(ctx: AudioContext) {
    const padBus = ctx.createGain()
    padBus.gain.value = 0.11
    padBus.connect(this.lowpass)
    padBus.connect(this.reverbIn)
    const notes = CHORDS[0]
    notes.forEach((n, i) => {
      const gain = ctx.createGain()
      gain.gain.value = 0
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 700 + i * 120
      filter.Q.value = 0.6
      const oscs: OscillatorNode[] = []
      for (const [type, det] of [
        ['sawtooth', -7],
        ['triangle', 5],
      ] as const) {
        const o = ctx.createOscillator()
        o.type = type
        o.frequency.value = MIDI(n)
        o.detune.value = det + (Math.random() - 0.5) * 4
        const g = ctx.createGain()
        g.gain.value = type === 'sawtooth' ? 0.22 : 0.5
        o.connect(g)
        g.connect(filter)
        o.start()
        oscs.push(o)
      }
      // slow breathing on the filter and level
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.03 + Math.random() * 0.05
      const lfoAmt = ctx.createGain()
      lfoAmt.gain.value = 380
      lfo.connect(lfoAmt)
      lfoAmt.connect(filter.frequency)
      lfo.start()
      const pan = ctx.createStereoPanner()
      pan.pan.value = (i / (notes.length - 1)) * 1.2 - 0.6
      filter.connect(gain)
      gain.connect(pan)
      pan.connect(padBus)
      gain.gain.setTargetAtTime(0.16 / (1 + i * 0.25), ctx.currentTime + 0.1, 2.5)
      this.voices.push({ oscs, gain, filter })
    })
  }

  private buildWind(ctx: AudioContext) {
    const len = ctx.sampleRate * 6
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      let b0 = 0
      let b1 = 0
      for (let i = 0; i < len; i++) {
        // brown-ish noise, gently pink
        const w = Math.random() * 2 - 1
        b0 = 0.995 * b0 + w * 0.05
        b1 = 0.6 * b1 + w * 0.4
        d[i] = (b0 * 2.2 + b1 * 0.25) * 0.6
      }
      // crossfade loop seam
      const f = 2048
      for (let i = 0; i < f; i++) {
        const t = i / f
        d[i] = d[i] * t + d[len - f + i] * (1 - t)
      }
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.loopEnd = (len - 2048) / ctx.sampleRate
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 520
    bp.Q.value = 0.7
    const g = ctx.createGain()
    g.gain.value = 0.32
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.045
    const lfoA = ctx.createGain()
    lfoA.gain.value = 320
    lfo.connect(lfoA)
    lfoA.connect(bp.frequency)
    const lfo2 = ctx.createOscillator()
    lfo2.frequency.value = 0.07
    const lfo2A = ctx.createGain()
    lfo2A.gain.value = 0.16
    lfo2.connect(lfo2A)
    lfo2A.connect(g.gain)
    src.connect(bp)
    bp.connect(g)
    g.connect(this.lowpass)
    g.connect(this.reverbIn)
    src.start()
    lfo.start()
    lfo2.start()
  }

  private startSchedulers() {
    this.stopSchedulers()
    const loop = (fn: () => void, min: number, max: number) => {
      const tick = () => {
        if (this.muted) return
        if (!this.hidden) fn()
        this.timers.push(window.setTimeout(tick, (min + Math.random() * (max - min)) * 1000))
      }
      this.timers.push(window.setTimeout(tick, (min + Math.random() * (max - min)) * 500))
    }
    loop(() => this.nextChord(), 9, 14)
    loop(() => this.cricket(), 1.6, 5.5)
    loop(() => this.chime(), 6, 15)
  }

  private stopSchedulers() {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  private nextChord() {
    const ctx = this.ctx
    if (!ctx) return
    this.chord = (this.chord + 1 + Math.floor(Math.random() * 2)) % CHORDS.length
    const notes = CHORDS[this.chord]
    const now = ctx.currentTime
    this.voices.forEach((v, i) => {
      const f = MIDI(notes[i % notes.length])
      // voices glide at slightly different rates so changes smear
      for (const o of v.oscs) o.frequency.setTargetAtTime(f, now + i * 0.35, 1.6 + i * 0.4)
    })
  }

  private cricket() {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime + 0.02
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.8 - 0.9
    const out = ctx.createGain()
    out.gain.value = 0.02 + Math.random() * 0.025
    pan.connect(out)
    out.connect(this.lowpass)
    out.connect(this.reverbIn)
    const freq = 4200 + Math.random() * 900
    const trills = 1 + Math.floor(Math.random() * 3)
    let t = now
    for (let r = 0; r < trills; r++) {
      const pulses = 3 + Math.floor(Math.random() * 3)
      for (let p = 0; p < pulses; p++) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = freq
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(1, t + 0.004)
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.022)
        o.connect(g)
        g.connect(pan)
        o.start(t)
        o.stop(t + 0.03)
        t += 0.034
      }
      t += 0.16 + Math.random() * 0.12
    }
    window.setTimeout(() => {
      pan.disconnect()
      out.disconnect()
    }, (t - now + 0.5) * 1000)
  }

  private chime() {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime + 0.02
    const base = MIDI(CHIME_NOTES[Math.floor(Math.random() * CHIME_NOTES.length)])
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.4 - 0.7
    const out = ctx.createGain()
    out.gain.value = 0.035
    pan.connect(out)
    out.connect(this.lowpass)
    out.connect(this.reverbIn)
    for (const [ratio, amp, dec] of [
      [1, 1, 3.2],
      [2.76, 0.32, 1.6],
      [5.4, 0.12, 0.8],
    ]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = base * ratio
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime(amp, now + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + dec)
      o.connect(g)
      g.connect(pan)
      o.start(now)
      o.stop(now + dec + 0.1)
    }
    window.setTimeout(() => {
      pan.disconnect()
      out.disconnect()
    }, 4000)
  }
}

let store: Ambience | null = null
export function audioStore(): AudioStore {
  if (!store) store = new Ambience()
  return store
}
