// A low drone for the survey: detuned oscillators through a resonant low-pass,
// band-passed brown noise for wind, a slow filter LFO. Pitch walks up with
// scroll. Created lazily on the first user gesture; off by default.

export class Drone {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private filter!: BiquadFilterNode
  private oscs: OscillatorNode[] = []
  private ratios = [1, 1.0035, 0.5, 1.4983, 2.001]
  private noiseGain!: GainNode
  on = false

  private build() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    comp.connect(ctx.destination)
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(comp)

    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 340
    this.filter.Q.value = 5
    this.filter.connect(this.master)

    const levels = [0.16, 0.12, 0.2, 0.05, 0.035]
    const types: OscillatorType[] = ['sawtooth', 'sawtooth', 'sine', 'triangle', 'sine']
    this.oscs = this.ratios.map((r, i) => {
      const o = ctx.createOscillator()
      o.type = types[i]
      o.frequency.value = 41.2 * r
      const g = ctx.createGain()
      g.gain.value = levels[i]
      o.connect(g).connect(this.filter)
      o.start()
      return o
    })

    // brown noise → band-pass, for air
    const len = ctx.sampleRate * 3
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
      d[i] = last * 3.2
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    noise.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 520
    bp.Q.value = 0.6
    this.noiseGain = ctx.createGain()
    this.noiseGain.gain.value = 0.11
    noise.connect(bp).connect(this.noiseGain).connect(this.master)
    noise.start()

    // slow breathing on the cutoff
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 140
    lfo.connect(lfoGain).connect(this.filter.frequency)
    lfo.start()
  }

  /** Must be called from a user gesture. */
  async toggle() {
    if (!this.ctx) this.build()
    const ctx = this.ctx!
    this.on = !this.on
    if (this.on) await ctx.resume()
    const t = ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(this.on ? 0.5 : 0, t, this.on ? 0.8 : 0.25)
    return this.on
  }

  /** cf ∈ [0, 5]: pitch rises a minor sixth over the whole survey; turbulence opens the filter. */
  update(cf: number, turbulence: number) {
    if (!this.ctx || !this.on) return
    const t = this.ctx.currentTime
    const base = 41.2 * Math.pow(2, (cf * 1.6) / 12)
    this.oscs.forEach((o, i) => o.frequency.setTargetAtTime(base * this.ratios[i], t, 0.4))
    this.filter.frequency.setTargetAtTime(300 + turbulence * 900 + cf * 30, t, 0.3)
    this.noiseGain.gain.setTargetAtTime(0.09 + turbulence * 0.2, t, 0.3)
  }

  /** A sub thump for the shockwave. */
  thump() {
    if (!this.ctx || !this.on) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(110, t)
    o.frequency.exponentialRampToValueAtTime(32, t + 0.5)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + 1)
  }
}
