// The meridian dial: a 24h ring, midnight at the bottom, noon at the top
// (06h on the left, 18h on the right — the sun's path across the sky).
// Drag anywhere on it to scrub; arrow keys nudge a quarter hour.

import { fmtHour, wrap24 } from './palette'

const NS = 'http://www.w3.org/2000/svg'
const TAU = Math.PI * 2
const R = 84

/** point on the ring for an hour, SVG units (centre 0,0, y down) */
export const dialPoint = (h: number, r: number): [number, number] => {
  const a = (h / 24) * TAU
  return [-Math.sin(a) * r, Math.cos(a) * r]
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  parent?.appendChild(e)
  return e
}

export interface DialEvents {
  scrub(hour: number, velocity: number): void // velocity in hours / second
  start(): void
  end(): void
}

export class Dial {
  dragging = false
  private knob: SVGCircleElement
  private hand: SVGLineElement
  private timeEl: HTMLElement
  private phaseEl: HTMLElement
  private lastA = 0
  private lastT = 0
  private vel = 0
  private hour = 0

  constructor(
    readonly root: HTMLElement,
    private ev: DialEvents,
  ) {
    const svg = el('svg', { viewBox: '-100 -100 200 200', 'aria-hidden': 'true' })
    el('circle', { class: 'd-track', r: R, fill: 'none' }, svg)
    el('line', { class: 'd-meridian', x1: 0, y1: -98, x2: 0, y2: 98 }, svg)
    for (let i = 0; i < 96; i++) {
      const h = i / 4
      const major = i % 24 === 0
      const hourTick = i % 4 === 0
      const len = major ? 11 : hourTick ? 6 : 2.5
      const [x1, y1] = dialPoint(h, R - len)
      const [x2, y2] = dialPoint(h, R)
      el('line', { class: `d-tick${major ? ' m' : hourTick ? ' h' : ''}`, x1, y1, x2, y2 }, svg)
    }
    for (const h of [0, 6, 12, 18]) {
      const [x, y] = dialPoint(h, R - 22)
      const t = el('text', { class: 'd-lab', x, y }, svg)
      t.textContent = String(h).padStart(2, '0')
    }
    // daylight arc, 06 → 19 through noon (clockwise on screen)
    const [ax, ay] = dialPoint(6, R + 8)
    const [bx, by] = dialPoint(19, R + 8)
    el('path', { class: 'd-day', d: `M ${ax} ${ay} A ${R + 8} ${R + 8} 0 1 1 ${bx} ${by}` }, svg)
    this.hand = el('line', { class: 'd-hand', x1: 0, y1: 0, x2: 0, y2: 0 }, svg)
    this.knob = el('circle', { class: 'd-knob', r: 6.5, cx: 0, cy: 0 }, svg)
    root.prepend(svg)
    this.timeEl = root.querySelector('[data-dial-time]') as HTMLElement
    this.phaseEl = root.querySelector('[data-dial-phase]') as HTMLElement

    root.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      root.setPointerCapture(e.pointerId)
      this.dragging = true
      this.lastA = this.angleOf(e)
      this.lastT = performance.now()
      this.vel = 0
      root.classList.add('grabbed')
      ev.start()
      this.handle(e)
    })
    root.addEventListener('pointermove', (e) => this.dragging && this.handle(e))
    const end = (e: PointerEvent) => {
      if (!this.dragging) return
      this.dragging = false
      root.classList.remove('grabbed')
      if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId)
      ev.end()
    }
    root.addEventListener('pointerup', end)
    root.addEventListener('pointercancel', end)
    root.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 1 : 0.25
      let d = 0
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step
      else if (e.key === 'PageUp') d = 1
      else if (e.key === 'PageDown') d = -1
      if (!d) return
      e.preventDefault()
      ev.scrub(wrap24(this.hour + d), 0)
    })
  }

  private angleOf(e: PointerEvent) {
    const r = this.root.getBoundingClientRect()
    const vx = e.clientX - (r.left + r.width / 2)
    const vy = e.clientY - (r.top + r.height / 2)
    return Math.atan2(-vx, vy) // 0 at the bottom, clockwise positive
  }

  private handle(e: PointerEvent) {
    const a = this.angleOf(e)
    const now = performance.now()
    const dt = Math.max(1, now - this.lastT) / 1000
    let da = a - this.lastA
    if (da > Math.PI) da -= TAU
    if (da < -Math.PI) da += TAU
    const v = ((da / TAU) * 24) / dt
    this.vel += (v - this.vel) * 0.5
    this.lastA = a
    this.lastT = now
    this.ev.scrub(wrap24((a / TAU) * 24), this.vel)
  }

  /** knob position in client (viewport) coordinates */
  knobClient(): [number, number] {
    const r = this.root.getBoundingClientRect()
    const [x, y] = dialPoint(this.hour, R)
    const s = r.width / 200
    return [r.left + r.width / 2 + x * s, r.top + r.height / 2 + y * s]
  }

  set(h: number, phase: string) {
    this.hour = h
    const [x, y] = dialPoint(h, R)
    const [hx, hy] = dialPoint(h, 50)
    this.knob.setAttribute('cx', x.toFixed(2))
    this.knob.setAttribute('cy', y.toFixed(2))
    this.hand.setAttribute('x1', hx.toFixed(2))
    this.hand.setAttribute('y1', hy.toFixed(2))
    this.hand.setAttribute('x2', x.toFixed(2))
    this.hand.setAttribute('y2', y.toFixed(2))
    const t = fmtHour(h)
    this.timeEl.textContent = t
    this.phaseEl.textContent = phase
    this.root.setAttribute('aria-valuenow', h.toFixed(2))
    this.root.setAttribute('aria-valuetext', `${t}, ${phase}`)
  }
}
