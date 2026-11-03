// ─────────────────────────────────────────────────────────────────────────────
//  SIGNAL FM · audio/engine.ts
//  The receiver. One AudioContext, four station slots, a static generator and
//  a master chain:
//
//   slot[i] ─ lowpass(weak signal) ─ gain(reception) ─┐
//   slot[i].wet ───────────────────── convolver ──────┤
//   static (noise → bandpass → highpass) ─────────────┼─ master ─ tone(lowpass)
//   bursts / ticks / pulses ──────────────────────────┘      ─ compressor ─ limiter ─┬─ volume ─ out
//                                                                                    └─ analyser
//
//  Patches are only alive while their station is within reception range; the
//  lookahead scheduler (setTimeout + currentTime) asks each live patch to
//  schedule notes up to `currentTime + LOOKAHEAD`.
// ─────────────────────────────────────────────────────────────────────────────

import { createPatch, type Patch } from './patches'

const LOOKAHEAD = 0.15 // s of audio scheduled ahead of currentTime
const LOOKAHEAD_HIDDEN = 1.4 // background tabs throttle timers to ~1 Hz
const TICK_MS = 25

export interface Bands {
  bass: number
  mid: number
  high: number
  level: number
}

interface Slot {
  input: BiquadFilterNode
  gain: GainNode
  wet: GainNode
  patch: Patch | null
  silentFor: number
  level: number
}

function impulse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      const k = i / len
      // early reflections: a few sparse taps, then a dense exponential tail
      const tap = i < ctx.sampleRate * 0.08 && Math.random() < 0.002 ? 2 : 1
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, decay) * tap
    }
  }
  return buf
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}

export class RadioEngine {
  readonly ctx: AudioContext
  /** cents offset summed into every oscillator's detune — the time-stretch pitch drop */
  readonly pitch: ConstantSourceNode
  /** shared white-noise buffer */
  readonly noise: AudioBuffer
  /** sequencer tempo multiplier (1 = normal, <1 = time-stretched) */
  rate = 1
  readonly analyser: AnalyserNode
  readonly spectrum: Uint8Array<ArrayBuffer>
  private wave: Uint8Array<ArrayBuffer>
  private master: GainNode
  private tone: BiquadFilterNode
  private volume: GainNode
  private reverbIn: GainNode
  private staticGain: GainNode
  private staticBP: BiquadFilterNode
  private slots: Slot[] = []
  private timer = 0
  private lastTick = 0
  private slowAmt = -1
  private crackle = 0
  readonly bands: Bands = { bass: 0, mid: 0, high: 0, level: 0 }

  constructor(stationCount: number) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new AC({ latencyHint: 'interactive' })
    const ctx = this.ctx
    this.noise = noiseBuffer(ctx, 2.5)

    // ── master chain ──
    this.master = ctx.createGain()
    this.master.gain.value = 0.85
    this.tone = ctx.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.frequency.value = 18000
    this.tone.Q.value = 0.6
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -20
    comp.knee.value = 8
    comp.ratio.value = 3.5
    comp.attack.value = 0.008
    comp.release.value = 0.22
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -2.5
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.002
    limiter.release.value = 0.08
    this.volume = ctx.createGain()
    this.volume.gain.value = 0.64
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.72
    this.analyser.minDecibels = -88
    this.analyser.maxDecibels = -18
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount)
    this.wave = new Uint8Array(this.analyser.fftSize)

    this.master.connect(this.tone).connect(comp).connect(limiter)
    limiter.connect(this.volume).connect(ctx.destination)
    limiter.connect(this.analyser) // visuals don't depend on the volume knob

    // ── shared reverb (generated impulse response) ──
    this.reverbIn = ctx.createGain()
    const conv = ctx.createConvolver()
    conv.buffer = impulse(ctx, 3.4, 3.2)
    const reverbOut = ctx.createGain()
    reverbOut.gain.value = 0.55
    this.reverbIn.connect(conv).connect(reverbOut).connect(this.master)

    // ── pitch CV for the time-stretch ──
    this.pitch = ctx.createConstantSource()
    this.pitch.offset.value = 0
    this.pitch.start()

    // ── inter-station static ──
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    this.staticBP = ctx.createBiquadFilter()
    this.staticBP.type = 'bandpass'
    this.staticBP.frequency.value = 2200
    this.staticBP.Q.value = 0.45
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 280
    this.staticGain = ctx.createGain()
    this.staticGain.gain.value = 0
    src.connect(this.staticBP).connect(hp).connect(this.staticGain).connect(this.master)
    src.start()

    for (let i = 0; i < stationCount; i++) {
      const input = ctx.createBiquadFilter()
      input.type = 'lowpass'
      input.frequency.value = 800
      input.Q.value = 0.9
      const gain = ctx.createGain()
      gain.gain.value = 0
      const wet = ctx.createGain()
      wet.gain.value = 0
      input.connect(gain).connect(this.master)
      wet.connect(this.reverbIn)
      this.slots.push({ input, gain, wet, patch: null, silentFor: 0, level: 0 })
    }
  }

  get now() {
    return this.ctx.currentTime
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume()
    if (!this.timer) this.pump()
  }

  private pump = () => {
    const until = this.ctx.currentTime + (document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD)
    for (const s of this.slots) s.patch?.schedule(until)
    this.timer = window.setTimeout(this.pump, TICK_MS)
  }

  /** Called every frame with per-station reception. Starts/stops patches. */
  setTuning(signals: number[], dt: number) {
    const t = this.now
    let best = 0
    this.slots.forEach((slot, i) => {
      const s = signals[i]
      best = Math.max(best, s)
      if (s > 0.001) {
        slot.silentFor = 0
        if (!slot.patch) {
          slot.patch = createPatch(i, this, slot.input, slot.wet)
          slot.patch.start()
        }
      } else if (slot.patch) {
        slot.silentFor += dt
        if (slot.silentFor > 1.5) {
          slot.patch.stop()
          slot.patch = null
        }
      }
      const lvl = Math.pow(s, 1.6)
      if (Math.abs(lvl - slot.level) > 0.001) {
        slot.level = lvl
        slot.gain.gain.setTargetAtTime(lvl, t, 0.05)
        slot.wet.gain.setTargetAtTime(lvl, t, 0.05)
        // a weak signal is a muffled signal
        slot.input.frequency.setTargetAtTime(500 + 17500 * s * s * s, t, 0.06)
      }
    })

    // static: louder in the dead zones, with a little crackle and drift
    this.crackle += dt
    if (this.crackle > 0.07) {
      this.crackle = 0
      const dead = Math.pow(1 - best, 1.25)
      const flick = 0.75 + Math.random() * 0.5
      this.staticGain.gain.setTargetAtTime(0.2 * dead * flick, t, 0.03)
      this.staticBP.frequency.setTargetAtTime(900 + Math.random() * 3400, t, 0.25)
    }
  }

  /** 0 … 1 hold amount → tempo + pitch drop + darker tone. */
  setSlow(amount: number) {
    if (Math.abs(amount - this.slowAmt) < 0.004) return
    this.slowAmt = amount
    this.rate = 1 - 0.46 * amount
    const t = this.now
    this.pitch.offset.setTargetAtTime(1200 * Math.log2(this.rate), t, 0.09)
    this.tone.frequency.setTargetAtTime(18000 * Math.pow(1500 / 18000, amount), t, 0.1)
  }

  setVolume(v: number) {
    this.volume.gain.setTargetAtTime(v * v, this.now, 0.05)
  }

  /** The 1.2 s station-change burst: noise through a sweeping bandpass + heterodyne whistle. */
  burst(dur = 1.2) {
    const ctx = this.ctx
    const t = this.now + 0.01
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 4.5
    bp.frequency.setValueAtTime(320, t)
    bp.frequency.exponentialRampToValueAtTime(5200, t + dur * 0.45)
    bp.frequency.exponentialRampToValueAtTime(650, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.55, t + 0.05)
    g.gain.linearRampToValueAtTime(0.38, t + dur * 0.7)
    g.gain.linearRampToValueAtTime(0, t + dur)
    src.connect(bp).connect(g).connect(this.master)
    src.start(t, Math.random() * 2)
    src.stop(t + dur + 0.05)

    const w = ctx.createOscillator()
    w.type = 'sine'
    w.frequency.setValueAtTime(3200, t)
    w.frequency.exponentialRampToValueAtTime(160, t + dur * 0.9)
    const wg = ctx.createGain()
    wg.gain.setValueAtTime(0, t)
    wg.gain.linearRampToValueAtTime(0.035, t + 0.15)
    wg.gain.linearRampToValueAtTime(0, t + dur)
    w.connect(wg).connect(this.master)
    w.start(t)
    w.stop(t + dur + 0.05)
    src.onended = () => {
      src.disconnect()
      bp.disconnect()
      g.disconnect()
    }
    w.onended = () => {
      w.disconnect()
      wg.disconnect()
    }
  }

  /** Mechanical detent click while dragging the dial. */
  tick(strength = 1) {
    const t = this.now
    if (t - this.lastTick < 0.028) return
    this.lastTick = t
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'bandpass'
    hp.frequency.value = 3800
    hp.Q.value = 2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.09 * strength, t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.018)
    src.connect(hp).connect(g).connect(this.master)
    src.start(t, Math.random() * 2, 0.03)
    src.onended = () => {
      src.disconnect()
      hp.disconnect()
      g.disconnect()
    }
  }

  /** Click on the scene: a sub thump that rings into the reverb. */
  pulse() {
    const ctx = this.ctx
    const t = this.now + 0.005
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(190, t)
    o.frequency.exponentialRampToValueAtTime(44, t + 0.45)
    this.pitch.connect(o.detune)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
    const send = ctx.createGain()
    send.gain.value = 0.5
    o.connect(g).connect(this.master)
    g.connect(send).connect(this.reverbIn)
    o.start(t)
    o.stop(t + 0.95)
    o.onended = () => {
      try {
        this.pitch.disconnect(o.detune)
      } catch {
        /* already gone */
      }
      o.disconnect()
      g.disconnect()
      send.disconnect()
    }
  }

  /** Short 1 kHz line-up tone, played once on TUNE IN. */
  lineup() {
    const ctx = this.ctx
    const t = this.now + 0.02
    const o = ctx.createOscillator()
    o.frequency.value = 1000
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.12, t + 0.01)
    g.gain.setValueAtTime(0.12, t + 0.32)
    g.gain.linearRampToValueAtTime(0, t + 0.34)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + 0.36)
    o.onended = () => {
      o.disconnect()
      g.disconnect()
    }
  }

  /** FFT → smoothed bands (0…1). Call once per frame. */
  analyse(dt: number): Bands {
    const a = this.analyser
    a.getByteFrequencyData(this.spectrum)
    a.getByteTimeDomainData(this.wave)
    const hz = this.ctx.sampleRate / a.fftSize
    const avg = (lo: number, hi: number) => {
      const i0 = Math.max(1, Math.floor(lo / hz))
      const i1 = Math.min(this.spectrum.length - 1, Math.ceil(hi / hz))
      let s = 0
      for (let i = i0; i <= i1; i++) s += this.spectrum[i]
      return s / ((i1 - i0 + 1) * 255)
    }
    let rms = 0
    for (let i = 0; i < this.wave.length; i += 2) {
      const v = (this.wave[i] - 128) / 128
      rms += v * v
    }
    rms = Math.sqrt(rms / (this.wave.length / 2))
    const raw = {
      bass: Math.pow(avg(30, 160), 1.6) * 1.5,
      mid: Math.pow(avg(160, 2400), 1.3) * 1.6,
      high: Math.pow(avg(2400, 11000), 1.1) * 2.2,
      level: Math.min(1, rms * 3.2),
    }
    const b = this.bands
    const follow = (cur: number, v: number) => {
      const k = v > cur ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 5)
      return cur + (Math.min(1, v) - cur) * k
    }
    b.bass = follow(b.bass, raw.bass)
    b.mid = follow(b.mid, raw.mid)
    b.high = follow(b.high, raw.high)
    b.level = follow(b.level, raw.level)
    return b
  }
}
