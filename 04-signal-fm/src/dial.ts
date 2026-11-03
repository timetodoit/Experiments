// The FM tuning dial: a scale that slides under a fixed needle. Drag (with
// fling inertia), wheel, or nudge from the keyboard. Stations have a magnetic
// detent while dragging and pull the needle in when you let go nearby.

import { F_MAX, F_MIN, STATIONS } from './stations'

const NS = 'http://www.w3.org/2000/svg'
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const PAD = 48

export class Dial {
  freq: number
  private raw: number
  private vel = 0
  private drag: { id: number; x0: number; f0: number; lx: number; lt: number } | null = null
  private anim: { from: number; to: number; t0: number; dur: number } | null = null
  private ppm = 90
  private idle = 10
  private lastTenth = 0
  private svg: SVGSVGElement
  /** detent click (strength 0…1) */
  onTick: (strength: number) => void = () => {}
  /** the user took hold of the dial */
  onGrab: () => void = () => {}

  constructor(
    private root: HTMLElement,
    start: number,
  ) {
    this.freq = this.raw = start
    this.lastTenth = Math.round(start * 10)
    this.svg = document.createElementNS(NS, 'svg')
    this.svg.classList.add('dial-scale')
    root.prepend(this.svg)

    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      root.setPointerCapture(e.pointerId)
      this.anim = null
      this.vel = 0
      this.drag = { id: e.pointerId, x0: e.clientX, f0: this.raw, lx: e.clientX, lt: performance.now() }
      root.classList.add('grab')
      this.onGrab()
    })
    root.addEventListener('pointermove', (e) => {
      const d = this.drag
      if (!d || d.id !== e.pointerId) return
      this.raw = clamp(d.f0 - (e.clientX - d.x0) / this.ppm, F_MIN, F_MAX)
      const now = performance.now()
      const dt = Math.max(1, now - d.lt) / 1000
      const v = -(e.clientX - d.lx) / this.ppm / dt
      this.vel = this.vel * 0.6 + v * 0.4
      d.lx = e.clientX
      d.lt = now
    })
    const end = (e: PointerEvent) => {
      if (!this.drag || this.drag.id !== e.pointerId) return
      if (performance.now() - this.drag.lt > 80) this.vel = 0
      this.vel = clamp(this.vel, -24, 24)
      this.drag = null
      this.idle = 0
      root.classList.remove('grab')
    }
    root.addEventListener('pointerup', end)
    root.addEventListener('pointercancel', end)
    root.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
        const dy = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        this.nudge(dy * k * 0.0035, false)
      },
      { passive: false },
    )
  }

  get animating() {
    return this.anim !== null
  }

  /** Rebuild the scale for the current width. */
  layout() {
    const w = this.root.clientWidth
    this.ppm = w < 640 ? 64 : w < 1100 ? 84 : 104
    const span = (F_MAX - F_MIN) * this.ppm
    const H = 84
    const svg = this.svg
    svg.setAttribute('width', String(span + PAD * 2))
    svg.setAttribute('height', String(H))
    svg.setAttribute('viewBox', `0 0 ${span + PAD * 2} ${H}`)
    svg.textContent = ''
    const base = 56
    const ticks = document.createElementNS(NS, 'path')
    let d = ''
    for (let i = 0; i <= (F_MAX - F_MIN) * 10; i++) {
      const x = PAD + (i / 10) * this.ppm
      const h = i % 10 === 0 ? 24 : i % 5 === 0 ? 15 : 8
      d += `M${x.toFixed(1)} ${base}V${base - h}`
    }
    ticks.setAttribute('d', d)
    ticks.setAttribute('class', 'dial-ticks')
    svg.appendChild(ticks)
    const rule = document.createElementNS(NS, 'path')
    rule.setAttribute('d', `M${PAD} ${base + 0.5}H${PAD + span}`)
    rule.setAttribute('class', 'dial-ticks')
    svg.appendChild(rule)
    for (let f = F_MIN; f <= F_MAX; f += 1) {
      const t = document.createElementNS(NS, 'text')
      t.setAttribute('x', String(PAD + (f - F_MIN) * this.ppm))
      t.setAttribute('y', String(base + 20))
      t.setAttribute('class', f % 2 === 0 ? 'dial-num' : 'dial-num dim')
      t.textContent = String(f)
      svg.appendChild(t)
    }
    STATIONS.forEach((s, i) => {
      const x = PAD + (s.freq - F_MIN) * this.ppm
      const zone = document.createElementNS(NS, 'rect')
      zone.setAttribute('x', String(x - 0.85 * this.ppm))
      zone.setAttribute('y', String(base - 30))
      zone.setAttribute('width', String(1.7 * this.ppm))
      zone.setAttribute('height', '30')
      zone.setAttribute('class', 'dial-zone')
      svg.appendChild(zone)
      const g = document.createElementNS(NS, 'g')
      g.setAttribute('class', 'dial-station')
      g.setAttribute('transform', `translate(${x} 0)`)
      g.innerHTML = `<rect x="-22" y="2" width="44" height="17" rx="0"></rect><text x="0" y="14.5">${String(i + 1).padStart(2, '0')} ${s.call}</text><path d="M0 19V${base - 26}"></path>`
      svg.appendChild(g)
    })
    this.apply()
  }

  /** Animated tune to a frequency (presets, boot sweep). */
  jump(to: number, dur = 1.2) {
    this.anim = { from: this.freq, to, t0: performance.now(), dur: dur * 1000 }
    this.vel = 0
    this.drag = null
  }

  nudge(df: number, snapTenth = true) {
    this.anim = null
    this.vel = 0
    this.idle = 0
    let f = this.raw + df
    if (snapTenth) f = Math.round(f * 10) / 10
    this.raw = clamp(f, F_MIN, F_MAX)
    this.onGrab()
  }

  update(dt: number) {
    if (this.anim) {
      const a = this.anim
      const k = Math.min(1, (performance.now() - a.t0) / a.dur)
      this.freq = this.raw = a.from + (a.to - a.from) * ease(k)
      if (k >= 1) this.anim = null
    } else if (this.drag) {
      // magnetic detent while held
      this.freq = this.raw
      for (const s of STATIONS) {
        const dd = Math.abs(s.freq - this.raw)
        if (dd < 0.3) this.freq = this.raw + (s.freq - this.raw) * 0.75 * (1 - dd / 0.3)
      }
    } else {
      this.idle += dt
      this.raw += this.vel * dt
      this.vel *= Math.exp(-dt * 4.5)
      if (this.raw <= F_MIN || this.raw >= F_MAX) this.vel = 0
      this.raw = clamp(this.raw, F_MIN, F_MAX)
      if (Math.abs(this.vel) < 0.9 && this.idle > 0.35) {
        for (const s of STATIONS) {
          const dd = Math.abs(s.freq - this.raw)
          if (dd < 0.4) this.raw += (s.freq - this.raw) * (1 - Math.exp(-dt * (Math.abs(this.vel) < 0.2 ? 7 : 3)))
        }
      }
      this.freq = this.raw
    }

    const tenth = Math.round(this.freq * 10)
    if (tenth !== this.lastTenth) {
      if (!this.anim) this.onTick(tenth % 10 === 0 ? 1 : 0.55)
      this.lastTenth = tenth
    }
    this.apply()
    return this.freq
  }

  private apply() {
    const x = this.root.clientWidth / 2 - PAD - (this.freq - F_MIN) * this.ppm
    this.svg.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`
    this.root.setAttribute('aria-valuenow', this.freq.toFixed(1))
    this.root.setAttribute('aria-valuetext', `${this.freq.toFixed(1)} megahertz`)
  }
}
