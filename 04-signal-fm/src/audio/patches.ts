// ─────────────────────────────────────────────────────────────────────────────
//  SIGNAL FM · audio/patches.ts
//  Four generative patches. Each owns a small persistent graph (filters,
//  delays, drones, LFOs) built in `build()` and torn down in `stop()`, plus
//  short-lived voices created by the step sequencer in `play(step, time)`.
//  Voices disconnect themselves `onended`, persistent nodes are tracked and
//  disconnected on stop — nothing is left attached to the context.
//
//  Every pitched source has the engine's `pitch` ConstantSource summed into
//  its detune, so the hold-to-time-stretch pitch drop reaches all of them.
// ─────────────────────────────────────────────────────────────────────────────

import type { RadioEngine } from './engine'

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const rnd = Math.random
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]

interface ToneOpts {
  detune?: number
  /** nodes whose output is summed into the detune param (default: engine pitch) */
  mods?: AudioNode[]
  /** extra nodes to disconnect when the voice ends */
  extra?: AudioNode[]
}

function perc(p: AudioParam, t: number, a: number, peak: number, decay: number) {
  p.setValueAtTime(0, t)
  p.linearRampToValueAtTime(peak, t + a)
  p.exponentialRampToValueAtTime(0.0001, t + a + decay)
}

function swell(p: AudioParam, t: number, a: number, peak: number, hold: number, r: number) {
  p.setValueAtTime(0, t)
  p.linearRampToValueAtTime(peak, t + a)
  p.setValueAtTime(peak, t + a + hold)
  p.linearRampToValueAtTime(0, t + a + hold + r)
}

export abstract class Patch {
  protected ctx: AudioContext
  readonly out: GainNode
  protected wet: GainNode
  protected next = 0
  protected step = 0
  protected abstract stepDur: number
  private keep: AudioNode[] = []
  private live: AudioScheduledSourceNode[] = []
  private dead = false

  constructor(
    protected e: RadioEngine,
    dry: AudioNode,
    wet: AudioNode,
  ) {
    this.ctx = e.ctx
    this.out = this.ctx.createGain()
    this.wet = this.ctx.createGain()
    this.out.gain.value = 0
    this.wet.gain.value = 0
    this.out.connect(dry)
    this.wet.connect(wet)
  }

  /** time multiplier for envelopes (stretches with the hold effect) */
  protected get s() {
    return 1 / this.e.rate
  }

  start() {
    const t = this.ctx.currentTime
    for (const g of [this.out, this.wet]) {
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(1, t + 0.6)
    }
    this.next = t + 0.08
    this.build(t)
  }

  /** Lookahead entry point: schedule every step that starts before `until`. */
  schedule(until: number) {
    if (this.dead) return
    // fell behind (tab was asleep): skip ahead instead of bursting notes
    if (this.next < this.ctx.currentTime - 0.25) this.next = this.ctx.currentTime + 0.02
    while (this.next < until) {
      this.play(this.step, this.next)
      this.next += (this.stepDur * this.swing(this.step)) / this.e.rate
      this.step++
    }
  }

  stop() {
    if (this.dead) return
    this.dead = true
    const t = this.ctx.currentTime
    for (const g of [this.out, this.wet]) {
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(g.gain.value, t)
      g.gain.linearRampToValueAtTime(0, t + 0.35)
    }
    window.setTimeout(() => {
      for (const s of this.live) {
        try {
          s.stop()
        } catch {
          /* never started */
        }
      }
      for (const n of this.keep) n.disconnect()
      this.out.disconnect()
      this.wet.disconnect()
      this.live.length = 0
      this.keep.length = 0
    }, 500)
  }

  protected abstract build(t: number): void
  protected abstract play(step: number, t: number): void
  protected swing(_step: number) {
    return 1
  }

  // ── persistent graph helpers ───────────────────────────────────────────
  protected hold<T extends AudioNode>(n: T): T {
    this.keep.push(n)
    return n
  }

  protected gainNode(v: number, dest?: AudioNode) {
    const g = this.hold(this.ctx.createGain())
    g.gain.value = v
    if (dest) g.connect(dest)
    return g
  }

  protected filter(type: BiquadFilterType, freq: number, q: number, dest?: AudioNode) {
    const f = this.hold(this.ctx.createBiquadFilter())
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    if (dest) f.connect(dest)
    return f
  }

  /** Feedback delay with a damped loop. Returns the input. */
  protected delay(time: number, feedback: number, tone: number, dest: AudioNode) {
    const input = this.gainNode(1)
    const d = this.hold(this.ctx.createDelay(2))
    d.delayTime.value = time
    const fb = this.gainNode(feedback)
    const lp = this.filter('lowpass', tone, 0.5)
    input.connect(d)
    d.connect(lp).connect(fb).connect(d)
    lp.connect(dest)
    return input
  }

  /** Persistent LFO into a param or a summing node. */
  protected lfo(freq: number, depth: number, target: AudioParam | AudioNode, type: OscillatorType = 'sine') {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    const g = this.gainNode(depth)
    o.connect(g)
    if (target instanceof AudioParam) g.connect(target)
    else g.connect(target)
    o.start()
    this.live.push(o)
    this.hold(o)
    return o
  }

  /** Persistent pitched oscillator. */
  protected drone(type: OscillatorType, freq: number, dest: AudioNode, detune = 0) {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.detune.value = detune
    this.e.pitch.connect(o.detune)
    o.connect(dest)
    o.start()
    o.onended = () => {
      try {
        this.e.pitch.disconnect(o.detune)
      } catch {
        /* gone */
      }
      o.disconnect()
    }
    this.live.push(o)
    return o
  }

  /** Persistent looping buffer. */
  protected loop(buf: AudioBuffer, dest: AudioNode) {
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(dest)
    src.start(this.ctx.currentTime, rnd() * buf.duration)
    src.onended = () => src.disconnect()
    this.live.push(src)
    return src
  }

  // ── transient voices ───────────────────────────────────────────────────
  protected tone(type: OscillatorType, freq: number, t: number, dur: number, dest: AudioNode, o: ToneOpts = {}) {
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (o.detune) osc.detune.value = o.detune
    const mods = o.mods ?? [this.e.pitch]
    for (const m of mods) m.connect(osc.detune)
    osc.connect(dest)
    osc.start(t)
    osc.stop(t + dur)
    osc.onended = () => {
      for (const m of mods) {
        try {
          m.disconnect(osc.detune)
        } catch {
          /* gone */
        }
      }
      osc.disconnect()
      if (o.extra) for (const n of o.extra) n.disconnect()
    }
    return osc
  }

  protected hiss(t: number, dur: number, dest: AudioNode, extra: AudioNode[] = []) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.e.noise
    src.loop = true
    this.e.pitch.connect(src.detune)
    src.connect(dest)
    src.start(t, rnd() * 2)
    src.stop(t + dur)
    src.onended = () => {
      try {
        this.e.pitch.disconnect(src.detune)
      } catch {
        /* gone */
      }
      src.disconnect()
      for (const n of extra) n.disconnect()
    }
    return src
  }

  /** A one-shot gain node into `dest`, cleaned up by the voice that uses it. */
  protected vca(dest: AudioNode) {
    const g = this.ctx.createGain()
    g.gain.value = 0
    g.connect(dest)
    return g
  }

  protected vcf(type: BiquadFilterType, freq: number, q: number, dest: AudioNode) {
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    f.connect(dest)
    return f
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  01 · HALCYON — slow pads, sub, glass bells into a long tail
// ═════════════════════════════════════════════════════════════════════════════
class Halcyon extends Patch {
  protected stepDur = 0.5
  private pad!: BiquadFilterNode
  private bells!: GainNode
  private sub!: OscillatorNode
  private subG!: GainNode
  private chords = [
    [50, 57, 62, 64, 69],
    [46, 53, 58, 62, 65],
    [43, 50, 55, 58, 62],
    [48, 55, 60, 64, 67],
  ]
  private pent = [74, 76, 78, 81, 83, 86, 88]

  protected build() {
    this.pad = this.filter('lowpass', 950, 0.8, this.out)
    this.pad.connect(this.gainNode(0.75, this.wet))
    this.lfo(0.055, 520, this.pad.frequency)

    this.bells = this.gainNode(1, this.out)
    this.bells.connect(this.gainNode(0.9, this.wet))
    this.bells.connect(this.delay(0.75, 0.42, 2600, this.out))

    this.subG = this.gainNode(0, this.out)
    this.sub = this.drone('sine', mtof(38), this.subG)

    // room air: banded noise breathing slowly
    const airG = this.gainNode(0.012, this.out)
    const air = this.filter('bandpass', 700, 0.7, airG)
    this.loop(this.e.noise, air)
    this.lfo(0.11, 0.009, airG.gain)
  }

  protected play(step: number, t: number) {
    const s = this.s
    if (step % 16 === 0) {
      const ch = this.chords[(step / 16) % this.chords.length]
      for (const m of ch) {
        const g = this.vca(this.pad)
        const a = 2.4 * s
        const h = 3.6 * s
        const r = 3.8 * s
        swell(g.gain, t, a, 0.04, h, r)
        this.tone('sawtooth', mtof(m), t, a + h + r + 0.05, g, { detune: -7 })
        this.tone('sawtooth', mtof(m), t, a + h + r + 0.05, g, { detune: 7, extra: [g] })
      }
      this.sub.frequency.setTargetAtTime(mtof(ch[0] - 12), t, 0.9)
      this.subG.gain.setTargetAtTime(0.13, t, 1.5)
    }
    if (rnd() < (step % 2 === 0 ? 0.22 : 0.08)) this.bell(t, pick(this.pent))
  }

  private bell(t: number, m: number) {
    const s = this.s
    const g = this.vca(this.bells)
    perc(g.gain, t, 0.004, 0.065, 2.6 * s)
    this.tone('sine', mtof(m), t, 2.8 * s, g, { extra: [g] })
    const g2 = this.vca(this.bells)
    perc(g2.gain, t, 0.002, 0.02, 0.9 * s)
    this.tone('sine', mtof(m) * 2.76, t, 1.0 * s, g2, { extra: [g2] })
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  02 · FURNACE — minimal techno, 124 BPM, sidechained bass + dub stabs
// ═════════════════════════════════════════════════════════════════════════════
class Furnace extends Patch {
  protected stepDur = 60 / 124 / 4
  private drums!: GainNode
  private duck!: GainNode
  private bassF!: BiquadFilterNode
  private stabs!: GainNode
  private base = 320
  private line = [0, 0, 45, 0, 0, 0, 45, 48, 0, 0, 45, 0, 0, 52, 45, 0]

  protected build() {
    this.drums = this.gainNode(0.9, this.out)
    this.duck = this.gainNode(1, this.out)
    this.bassF = this.filter('lowpass', this.base, 9, this.duck)
    this.stabs = this.gainNode(1)
    const bp = this.filter('bandpass', 1300, 1.4, this.duck)
    this.stabs.connect(bp)
    bp.connect(this.delay(this.stepDur * 3, 0.48, 2200, this.duck))
    bp.connect(this.gainNode(0.5, this.wet))
  }

  protected play(step: number, t: number) {
    const s16 = step % 16
    const bar = Math.floor(step / 16)
    if (s16 === 0) this.base = 260 + 760 * (0.5 + 0.5 * Math.sin(bar * 0.37))
    if (s16 % 4 === 0) {
      this.kick(t)
      this.duck.gain.setValueAtTime(0.3, t)
      this.duck.gain.setTargetAtTime(1, t + 0.03, 0.08 * this.s)
    }
    if (s16 % 4 === 2) this.hat(t, 0.15, 0.045)
    else if (rnd() < 0.32) this.hat(t, 0.045, 0.03)
    if (s16 === 14 && bar % 2 === 1) this.hat(t, 0.1, 0.3)
    if (s16 === 4 || s16 === 12) this.clap(t)
    const n = this.line[s16]
    if (n) this.bass(t, n, s16 === 7 || s16 === 13)
    if ((bar % 2 === 0 && s16 === 6) || (bar % 4 === 3 && s16 === 11)) this.stab(t)
  }

  private kick(t: number) {
    const s = this.s
    const g = this.vca(this.drums)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.95, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45 * s)
    const o = this.tone('sine', 155, t, 0.5 * s, g, { extra: [g] })
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11 * s)
    const cg = this.vca(this.drums)
    perc(cg.gain, t, 0.001, 0.18, 0.012)
    const hp = this.vcf('highpass', 3000, 0.7, cg)
    this.hiss(t, 0.03, hp, [hp, cg])
  }

  private hat(t: number, amp: number, dec: number) {
    const g = this.vca(this.drums)
    perc(g.gain, t, 0.001, amp, dec * this.s)
    const hp = this.vcf('highpass', 7600, 0.8, g)
    this.hiss(t, dec * this.s + 0.05, hp, [hp, g])
  }

  private clap(t: number) {
    const g = this.vca(this.drums)
    g.gain.setValueAtTime(0, t)
    for (let i = 0; i < 3; i++) {
      g.gain.linearRampToValueAtTime(0.32, t + i * 0.011 + 0.001)
      g.gain.linearRampToValueAtTime(0.05, t + i * 0.011 + 0.009)
    }
    g.gain.linearRampToValueAtTime(0.3, t + 0.035)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24 * this.s)
    const bp = this.vcf('bandpass', 1500, 1.1, g)
    const send = this.vca(this.wet)
    send.gain.value = 0.25
    g.connect(send)
    this.hiss(t, 0.3 * this.s, bp, [bp, g, send])
  }

  private bass(t: number, m: number, accent: boolean) {
    const s = this.s
    const g = this.vca(this.bassF)
    perc(g.gain, t, 0.003, 0.22, 0.2 * s)
    this.tone('sawtooth', mtof(m), t, 0.26 * s, g)
    this.tone('square', mtof(m - 12), t, 0.26 * s, g, { detune: 4, extra: [g] })
    const f = this.bassF.frequency
    f.cancelScheduledValues(t)
    f.setValueAtTime(this.base + (accent ? 2200 : 900), t)
    f.setTargetAtTime(this.base, t + 0.01, 0.06 * s)
  }

  private stab(t: number) {
    const s = this.s
    for (const m of [57, 60, 64, 67]) {
      const g = this.vca(this.stabs)
      perc(g.gain, t, 0.002, 0.06, 0.28 * s)
      this.tone('sawtooth', mtof(m), t, 0.32 * s, g, { detune: rnd() * 10 - 5, extra: [g] })
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  03 · VELVET TAPE — swung lo-fi arpeggio, wow & flutter, vinyl crackle
// ═════════════════════════════════════════════════════════════════════════════
function crackleBuffer(ctx: BaseAudioContext) {
  const len = ctx.sampleRate * 3
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) {
    d[i] += (Math.random() * 2 - 1) * 0.012
    if (Math.random() < 0.00035) {
      const amp = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.75)
      for (let k = 0; k < 24 && i + k < len; k++) d[i + k] += amp * Math.exp(-k / 3)
    }
  }
  return buf
}

class VelvetTape extends Patch {
  protected stepDur = 60 / 84 / 4
  private wob!: GainNode
  private keys!: GainNode
  private drums!: GainNode
  private mods: AudioNode[] = []
  private chords = [
    [53, 57, 60, 64],
    [52, 55, 59, 62],
    [50, 53, 57, 60, 64],
    [48, 52, 55, 59, 62],
  ]
  private order = [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 4, 3, 2, 1]

  protected swing(step: number) {
    return step % 2 === 0 ? 1.18 : 0.82
  }

  protected build() {
    // wow (slow) + flutter (fast) summed into a cents bus
    this.wob = this.gainNode(1)
    this.lfo(0.48, 15, this.wob)
    this.lfo(5.7, 3.5, this.wob)
    this.mods = [this.e.pitch, this.wob]

    // tape: soft lowpass + tanh saturation
    const shaper = this.hold(this.ctx.createWaveShaper())
    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2)
    }
    shaper.curve = curve
    shaper.connect(this.out)
    const tape = this.filter('lowpass', 4300, 0.5, shaper)

    this.keys = this.gainNode(1, tape)
    this.keys.connect(this.gainNode(0.55, this.wet))
    this.keys.connect(this.delay(this.stepDur * 3, 0.36, 1700, tape))

    this.drums = this.gainNode(0.8)
    this.drums.connect(this.filter('lowpass', 5200, 0.6, tape))

    const crackG = this.gainNode(0.2, this.out)
    this.loop(crackleBuffer(this.ctx), this.filter('highpass', 900, 0.6, crackG))
  }

  protected play(step: number, t: number) {
    const s = this.s
    const s16 = step % 16
    const bar = Math.floor(step / 16)
    const ch = this.chords[bar % this.chords.length]

    // arpeggio
    const m = ch[this.order[s16] % ch.length] + 12 + (s16 >= 8 && bar % 2 === 1 ? 12 : 0)
    const g = this.vca(this.keys)
    perc(g.gain, t, 0.004, 0.075, 0.34 * s)
    this.tone('triangle', mtof(m), t, 0.42 * s, g, { mods: this.mods, extra: [g] })
    const g2 = this.vca(this.keys)
    perc(g2.gain, t, 0.004, 0.012, 0.18 * s)
    this.tone('square', mtof(m), t, 0.24 * s, g2, { mods: this.mods, detune: 8, extra: [g2] })

    // electric-piano-ish chord bed on the downbeat
    if (s16 === 0) {
      for (const n of ch) {
        const pg = this.vca(this.keys)
        perc(pg.gain, t, 0.03, 0.03, 3.2 * s)
        this.tone('sine', mtof(n) * 2, t, 1.4 * s, pg, { mods: this.mods })
        this.tone('sine', mtof(n), t, 3.4 * s, pg, { mods: this.mods, extra: [pg] })
      }
    }

    // drums
    if (s16 === 0 || s16 === 10 || (s16 === 7 && rnd() < 0.4)) this.kick(t)
    if (s16 === 4 || s16 === 12) this.snare(t)
    if (s16 % 2 === 0) this.hat(t, s16 % 4 === 2 ? 0.05 : 0.028)
  }

  private kick(t: number) {
    const s = this.s
    const g = this.vca(this.drums)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.75, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38 * s)
    const o = this.tone('sine', 110, t, 0.4 * s, g, { extra: [g] })
    o.frequency.exponentialRampToValueAtTime(44, t + 0.14 * s)
  }

  private snare(t: number) {
    const s = this.s
    const g = this.vca(this.drums)
    perc(g.gain, t, 0.002, 0.22, 0.2 * s)
    const bp = this.vcf('bandpass', 1900, 0.9, g)
    this.hiss(t, 0.26 * s, bp, [bp, g])
    const tg = this.vca(this.drums)
    perc(tg.gain, t, 0.002, 0.1, 0.09 * s)
    this.tone('triangle', 185, t, 0.12 * s, tg, { extra: [tg] })
  }

  private hat(t: number, amp: number) {
    const g = this.vca(this.drums)
    perc(g.gain, t, 0.001, amp, 0.03 * this.s)
    const hp = this.vcf('highpass', 6200, 0.7, g)
    this.hiss(t, 0.06, hp, [hp, g])
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  04 · LOW TIDE — drone, wandering shortwave band, morse, sonar, glass
// ═════════════════════════════════════════════════════════════════════════════
const MORSE: Record<string, string> = { S: '...', I: '..', G: '--.', N: '-.', A: '.-', L: '.-..', F: '..-.', M: '--', O: '---', W: '.--', H: '....', E: '.', R: '.-.' }

function morseSteps(text: string) {
  const out: string[] = []
  for (const ch of text) {
    if (ch === ' ') {
      out.push(' ', ' ', ' ', ' ')
      continue
    }
    for (const sym of MORSE[ch] ?? '') out.push(sym, ' ')
    out.push(' ', ' ')
  }
  return out
}

class LowTide extends Patch {
  protected stepDur = 0.25
  private swBP!: BiquadFilterNode
  private whistle!: OscillatorNode
  private morse!: GainNode
  private glass!: GainNode
  private sonar!: GainNode
  private msg = morseSteps('SIGNAL FM NOWHERE')

  protected build() {
    const droneG = this.gainNode(0.15, this.out)
    const lp = this.filter('lowpass', 380, 3.5, droneG)
    lp.connect(this.gainNode(0.6, this.wet))
    this.lfo(0.045, 230, lp.frequency)
    this.lfo(0.09, 0.05, droneG.gain)
    this.drone('sawtooth', 55, lp, -6)
    this.drone('sawtooth', 55, lp, 7)
    this.drone('sine', 110, lp)
    this.drone('triangle', 164.81, lp, 3)
    this.drone('sawtooth', 82.41, lp, -2)

    const swG = this.gainNode(0.06, this.out)
    this.swBP = this.filter('bandpass', 1400, 5, swG)
    this.loop(this.e.noise, this.swBP)

    const wg = this.gainNode(0.006, this.out)
    this.lfo(0.27, 0.005, wg.gain)
    this.whistle = this.drone('sine', 1800, wg)

    this.morse = this.gainNode(1, this.out)
    this.morse.connect(this.gainNode(0.5, this.wet))
    this.glass = this.gainNode(0.6, this.wet)
    this.glass.connect(this.gainNode(0.4, this.out))
    this.sonar = this.gainNode(1, this.out)
  }

  protected play(step: number, t: number) {
    const s = this.s
    if (step % 3 === 0) this.swBP.frequency.setTargetAtTime(600 + rnd() * 2600, t, 0.5)
    if (step % 16 === 0) this.whistle.frequency.setTargetAtTime(900 + rnd() * 2200, t, 1.6)

    // a transmission every 32 s, starting 4 s in
    const k = (step - 16) % 128
    if (k >= 0 && k < this.msg.length) {
      const sym = this.msg[k]
      if (sym !== ' ') {
        const dur = (sym === '.' ? 0.07 : 0.2) * s
        const g = this.vca(this.morse)
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.07, t + 0.004)
        g.gain.setValueAtTime(0.07, t + dur)
        g.gain.linearRampToValueAtTime(0, t + dur + 0.006)
        this.tone('sine', 860, t, dur + 0.02, g, { extra: [g] })
      }
    }

    if (step % 32 === 0) {
      const g = this.vca(this.sonar)
      swell(g.gain, t, 0.6 * s, 0.32, 0.4 * s, 3 * s)
      this.tone('sine', 41.2, t, 4.1 * s, g, { extra: [g] })
    }

    if (rnd() < 0.05) {
      const g = this.vca(this.glass)
      perc(g.gain, t, 0.002, 0.05, 4 * s)
      this.tone('sine', pick([880, 1320, 1760, 2200, 2640, 1100]), t, 4.2 * s, g, { extra: [g] })
    }
  }
}

export function createPatch(i: number, e: RadioEngine, dry: AudioNode, wet: AudioNode): Patch {
  switch (i) {
    case 0:
      return new Halcyon(e, dry, wet)
    case 1:
      return new Furnace(e, dry, wet)
    case 2:
      return new VelvetTape(e, dry, wet)
    default:
      return new LowTide(e, dry, wet)
  }
}
