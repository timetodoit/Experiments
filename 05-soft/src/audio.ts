// Web Audio synthesis — no samples. The context is created on the first user
// gesture (autoplay policy); until then every call is a silent no-op.
//   boing   : sine with a falling pitch sweep + decaying vibrato (the wobble)
//   squelch : band-passed noise with a downward filter sweep
//   pop     : bright noise click + a fast sine chirp
//   fanfare : a bouncy triangle arpeggio for new records

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private last = 0
  private voices = 0
  enabled = true

  /** Call from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 6
      const master = ctx.createGain()
      master.gain.value = this.enabled ? 0.8 : 0
      master.connect(comp)
      comp.connect(ctx.destination)
      const len = Math.floor(ctx.sampleRate * 0.5)
      const noise = ctx.createBuffer(1, len, ctx.sampleRate)
      const ch = noise.getChannelData(0)
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1
      this.ctx = ctx
      this.master = master
      this.noise = noise
    } catch (err) {
      console.warn('audio unavailable', err)
    }
  }

  get ready() {
    return !!this.ctx && this.enabled
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.03)
  }

  private claim(minGap: number) {
    if (!this.ctx || !this.master || !this.enabled || this.ctx.state !== 'running') return null
    const now = this.ctx.currentTime
    if (now - this.last < minGap || this.voices > 7) return null
    this.last = now
    return now
  }

  private voice(node: AudioScheduledSourceNode, end: number) {
    this.voices++
    node.onended = () => this.voices--
    node.stop(end)
  }

  private panner(x: number) {
    const ctx = this.ctx!
    if (typeof ctx.createStereoPanner !== 'function') return this.master!
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-0.8, Math.min(0.8, x))
    p.connect(this.master!)
    return p
  }

  /** size: letter height in CSS px. speed: impact velocity px/s. pan: -1..1 */
  boing(size: number, speed: number, pan = 0) {
    const vol = Math.min(1, Math.max(0, (speed - 200) / 2400)) ** 1.1 * 0.55
    if (vol < 0.02) return
    const now = this.claim(0.045)
    if (now === null) return
    const ctx = this.ctx!
    const out = this.panner(pan)
    const f0 = Math.max(70, Math.min(620, 150 * Math.pow(220 / Math.max(30, size), 0.75))) * (0.94 + Math.random() * 0.12)
    const dur = 0.32 + Math.min(0.25, size / 1600)

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f0 * 2.1, now)
    osc.frequency.exponentialRampToValueAtTime(f0, now + 0.07)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 15 + Math.random() * 6
    const depth = ctx.createGain()
    depth.gain.setValueAtTime(f0 * 0.22, now)
    depth.gain.exponentialRampToValueAtTime(f0 * 0.01, now + dur)
    lfo.connect(depth)
    depth.connect(osc.frequency)
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0.0001, now)
    amp.gain.exponentialRampToValueAtTime(vol, now + 0.006)
    amp.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    osc.connect(amp)
    amp.connect(out)
    osc.start(now)
    lfo.start(now)
    lfo.stop(now + dur + 0.02)
    this.voice(osc, now + dur + 0.02)

    this.squelch(vol * 0.5, now, out)
  }

  private squelch(vol: number, now: number, out: AudioNode) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 3.5
    bp.frequency.setValueAtTime(1400, now)
    bp.frequency.exponentialRampToValueAtTime(260, now + 0.09)
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(vol, now)
    amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.1)
    src.connect(bp)
    bp.connect(amp)
    amp.connect(out)
    src.start(now, Math.random() * 0.3)
    this.voice(src, now + 0.12)
  }

  pop(pan = 0) {
    const now = this.claim(0.02)
    if (now === null) return
    const ctx = this.ctx!
    const out = this.panner(pan)
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1800
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0.7, now)
    amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
    src.connect(hp)
    hp.connect(amp)
    amp.connect(out)
    src.start(now)
    this.voice(src, now + 0.08)

    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1300, now)
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.09)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.35, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
    osc.connect(g)
    g.connect(out)
    osc.start(now)
    this.voice(osc, now + 0.14)
  }

  /** Deflating balloon: a pitch-falling, filtered raspberry. */
  deflate(pan = 0) {
    const now = this.claim(0.02)
    if (now === null) return
    const ctx = this.ctx!
    const out = this.panner(pan)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(420, now)
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.45)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(2400, now)
    lp.frequency.exponentialRampToValueAtTime(300, now + 0.45)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.48)
    osc.connect(lp)
    lp.connect(g)
    g.connect(out)
    osc.start(now)
    this.voice(osc, now + 0.5)
  }

  fanfare() {
    const now = this.claim(0)
    if (now === null) return
    const ctx = this.ctx!
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = now + i * 0.085
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(f * 0.7, t)
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.03)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
      osc.connect(g)
      g.connect(this.master!)
      osc.start(t)
      this.voice(osc, t + 0.34)
    })
  }
}
