// Liquid-glass cards: plain DOM text on transparent rounded rects. Their live
// rects are sent to the composite shader every frame, which does the actual
// refraction. Cards drift on their own and can be thrown around (mouse/pen
// anywhere on the card, touch via the grip so the page still scrolls).

import type { GlassShape } from './gpu/fluid'

interface Card {
  el: HTMLElement
  ox: number
  oy: number
  vx: number
  vy: number
  seed: number
  alpha: number
  radius: number
  drag: boolean
  lx: number
  ly: number
  lt: number
  home: boolean
}

export interface GlassEvents {
  drag(cx: number, cy: number, vx: number, vy: number, w: number, h: number): void
}

export class GlassCards {
  readonly cards: Card[]
  dragging = false

  constructor(
    els: HTMLElement[],
    private ev: GlassEvents,
    private reduced: boolean,
  ) {
    this.cards = els.map((el, i) => ({
      el, ox: 0, oy: 0, vx: 0, vy: 0, seed: i * 1.7 + 0.3, alpha: 0, radius: 28,
      drag: false, lx: 0, ly: 0, lt: 0, home: false,
    }))
    for (const c of this.cards) this.bind(c)
    this.measure()
  }

  measure() {
    for (const c of this.cards) c.radius = parseFloat(getComputedStyle(c.el).borderTopLeftRadius) || 24
  }

  private bind(c: Card) {
    const el = c.el
    el.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('a,button')) return
      if (e.pointerType === 'touch' && !t.closest('.grip')) return
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      c.drag = true
      c.home = false
      c.vx = c.vy = 0
      c.lx = e.clientX
      c.ly = e.clientY
      c.lt = performance.now()
      this.dragging = true
      el.classList.add('grabbed')
    })
    el.addEventListener('pointermove', (e) => {
      if (!c.drag) return
      const now = performance.now()
      const dt = Math.max(4, now - c.lt) / 1000
      const dx = e.clientX - c.lx
      const dy = e.clientY - c.ly
      c.ox += dx
      c.oy += dy
      c.vx += (dx / dt - c.vx) * 0.5
      c.vy += (dy / dt - c.vy) * 0.5
      c.lx = e.clientX
      c.ly = e.clientY
      c.lt = now
      const r = el.getBoundingClientRect()
      this.ev.drag(r.left + r.width / 2, r.top + r.height / 2, c.vx, c.vy, r.width, r.height)
    })
    const end = (e: PointerEvent) => {
      if (!c.drag) return
      c.drag = false
      if (performance.now() - c.lt > 70) c.vx = c.vy = 0
      this.dragging = this.cards.some((k) => k.drag)
      el.classList.remove('grabbed')
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('dblclick', () => (c.home = true))
  }

  update(dt: number, time: number) {
    const lx = innerWidth * 0.42
    const ly = innerHeight * 0.42
    for (const c of this.cards) {
      if (!c.drag) {
        c.ox += c.vx * dt
        c.oy += c.vy * dt
        const k = Math.exp(-dt * 4)
        c.vx *= k
        c.vy *= k
        if (c.home) {
          const h = Math.exp(-dt * 5)
          c.ox *= h
          c.oy *= h
          if (Math.abs(c.ox) + Math.abs(c.oy) < 0.5) c.home = false
        }
        // soft walls
        if (Math.abs(c.ox) > lx) { c.ox = Math.sign(c.ox) * lx; c.vx *= -0.4 }
        if (Math.abs(c.oy) > ly) { c.oy = Math.sign(c.oy) * ly; c.vy *= -0.4 }
      }
      const drift = this.reduced ? 0 : 1
      const dx = drift * (Math.sin(time * 0.31 + c.seed) * 7 + Math.sin(time * 0.17 + c.seed * 2.1) * 4)
      const dy = drift * (Math.cos(time * 0.27 + c.seed * 1.3) * 6)
      c.el.style.transform = `translate3d(${(c.ox + dx).toFixed(2)}px, ${(c.oy + dy).toFixed(2)}px, 0)`
      const want = c.el.closest('section')?.classList.contains('in') ? 1 : 0
      c.alpha += (want - c.alpha) * (1 - Math.exp(-dt * 3))
    }
  }

  shapes(out: GlassShape[], vh: number) {
    for (const c of this.cards) {
      if (c.alpha < 0.01) continue
      const r = c.el.getBoundingClientRect()
      if (r.bottom < -60 || r.top > vh + 60 || r.width < 2) continue
      const hw = r.width / 2
      const hh = r.height / 2
      out.push({
        cx: r.left + hw,
        cy: r.top + hh,
        hw,
        hh,
        radius: Math.min(c.radius, hw, hh),
        alpha: c.alpha,
        bevel: Math.min(34, Math.min(hw, hh) * 0.5),
        refract: 20,
      })
    }
  }
}
