// THE STACK — drop letters, pile them up. Height is measured by Rust from the
// contact graph (bodies resting on the floor/plinth, or on something that is),
// counting only settled letters. 1 m = one letter cap height.

import type { Sfx } from './audio'
import type { Confetti } from './confetti'
import type { GlyphStat } from './glyphs'
import { PALETTE } from './palette'
import type { Stage } from './stage'

const KEY = 'soft.stack.best'
const MAX_LETTERS = 22

const load = () => {
  try {
    const v = parseFloat(localStorage.getItem(KEY) ?? '0')
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}
const save = (v: number) => {
  try {
    localStorage.setItem(KEY, v.toFixed(3))
  } catch {
    /* private mode */
  }
}

export interface StackUI {
  drop: HTMLButtonElement
  next: HTMLElement
  now: HTMLElement
  best: HTMLElement
  count: HTMLElement
  lineCur: HTMLElement
  lineBest: HTMLElement
  ruler: HTMLElement
  toast: HTMLElement
  card: HTMLElement
  plinth: HTMLElement
}

export class StackGame {
  cap = 100
  best = load()
  private queue: string[] = []
  private hold = 0
  private uiAt = 0
  private height = 0
  private started = false
  private lastColor = ''
  private toastT = 0
  /** records only count once the visitor has actually played */
  private played = false
  flipped = false

  constructor(
    private stage: Stage,
    private glyphs: Map<string, GlyphStat>,
    private ui: StackUI,
    private fx: Confetti,
    private sfx: Sfx,
  ) {
    this.refill()
    ui.drop.addEventListener('click', () => {
      sfx.unlock()
      this.played = true
      this.drop()
    })
    this.renderNext()
    this.renderBest()
  }

  private refill() {
    const az = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((c) => this.glyphs.has(c))
    for (let i = az.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[az[i], az[j]] = [az[j], az[i]]
    }
    this.queue.push(...az)
  }

  private renderNext() {
    if (!this.queue.length) this.refill()
    this.ui.next.textContent = this.queue[0] ?? '?'
  }

  private renderBest() {
    this.ui.best.textContent = `${this.best.toFixed(2)} m`
    this.ui.lineBest.querySelector('span')!.textContent = `Best ${this.best.toFixed(2)} m`
  }

  /** size letters + ruler for the current arena */
  layout() {
    const s = this.stage
    this.cap = Math.round(Math.max(54, Math.min(128, Math.min(s.w * 0.11, s.floor * 0.16))))
    s.grabRadius = this.cap * 0.2
    // the plinth is about one letter tall at any size
    this.ui.plinth.style.height = `${Math.round(Math.max(48, this.cap * 1.05))}px`
    const r = this.ui.ruler
    r.textContent = ''
    const n = Math.floor(s.floor / this.cap)
    for (let m = 0; m <= n; m++) {
      if (s.floor - m * this.cap < 64) break // keep clear of the section header
      const t = document.createElement('i')
      t.style.top = `${s.floor - m * this.cap}px`
      t.dataset.m = `${m} m`
      r.appendChild(t)
    }
  }

  start() {
    if (this.started) return
    this.started = true
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    ;[0, 1, 2].forEach((k) => setTimeout(() => this.drop(), reduced ? 0 : 250 + k * 420))
  }

  drop() {
    const s = this.stage
    if (!this.queue.length) this.refill()
    const ch = this.queue.shift()!
    this.renderNext()
    const stat = this.glyphs.get(ch)
    if (!stat) return
    // cap the pile: the oldest letter deflates and leaves
    const live = s.metas.filter((m) => !m.popping).length
    if (live >= MAX_LETTERS) {
      const oldest = s.metas.findIndex((m, i) => !m.popping && i !== s.holding)
      if (oldest >= 0) s.pop(oldest)
    }
    let color = PALETTE[Math.floor(Math.random() * PALETTE.length)]
    if (color === this.lastColor) color = PALETTE[(PALETTE.indexOf(color) + 1) % PALETTE.length]
    this.lastColor = color
    let x = s.w * 0.5 + (Math.random() - 0.5) * Math.min(s.w * 0.3, this.cap * 3)
    // puff into existence a little above the pile, so drops are catchable
    const pile = Math.min(s.floor, s.world.stack_top())
    let y = Math.max(this.cap * 0.85, pile - this.cap * 2.1)
    // never spawn inside the info card
    const cr = this.ui.card.getBoundingClientRect()
    const sr = s.canvas.getBoundingClientRect()
    const cl = cr.left - sr.left - this.cap * 0.7
    const crr = cr.right - sr.left + this.cap * 0.7
    if (cr.width && x > cl && x < crr) y = Math.max(y, cr.bottom - sr.top + this.cap * 0.75)
    y = Math.min(y, s.floor - this.cap)
    // never inside another letter: climb until there is room
    const bw = stat.width * (this.cap / stat.cap)
    const bh = stat.height * (this.cap / stat.cap)
    const spot = s.findFree(x, bw, bh, Math.min(y - bh / 2, this.cap * 0.3), y + bh / 2, true)
    if (!spot) return
    ;[x, y] = spot
    s.spawn(stat, x, y, (Math.random() - 0.5) * 0.3, this.cap, 0.3, color, ch)
  }

  reset() {
    this.stage.clear()
    this.height = 0
    this.hold = 0
  }

  update(dt: number, time: number) {
    const s = this.stage
    const top = s.world.stack_top()
    const h = Math.max(0, (s.floor - top) / this.cap)
    this.height += (h - this.height) * Math.min(1, dt * 6)
    if (s.holding >= 0) this.played = true
    const flipped = this.flipped

    // a record must hold for a second
    if (this.played && !flipped && h > this.best + 0.02 && s.metas.length > 0) {
      this.hold += dt
      if (this.hold > 1) {
        this.best = h
        save(h)
        this.renderBest()
        this.hold = 0
        this.celebrate(top)
      }
    } else this.hold = 0

    this.ui.lineCur.style.transform = `translate3d(0, ${(s.floor - this.height * this.cap).toFixed(1)}px, 0)`
    this.ui.lineBest.style.transform = `translate3d(0, ${(s.floor - this.best * this.cap).toFixed(1)}px, 0)`
    this.ui.lineBest.classList.toggle('show', this.best > 0.05)

    if (time - this.uiAt > 0.1) {
      this.uiAt = time
      const txt = flipped ? '—' : `${this.height.toFixed(2)} m`
      this.ui.now.textContent = txt
      this.ui.lineCur.querySelector('span')!.textContent = txt
      this.ui.count.textContent = String(s.metas.filter((m) => !m.popping).length)
    }
    if (this.toastT > 0) {
      this.toastT -= dt
      if (this.toastT <= 0) this.ui.toast.classList.remove('on')
    }
  }

  private celebrate(top: number) {
    const r = this.stage.canvas.getBoundingClientRect()
    const x = r.left + this.stage.w / 2
    const y = r.top + top
    this.fx.burst(x, y, PALETTE, 120, 1.1)
    this.fx.burst(r.left + this.stage.w * 0.2, y + 40, PALETTE, 40, 0.8)
    this.fx.burst(r.left + this.stage.w * 0.8, y + 40, PALETTE, 40, 0.8)
    this.sfx.fanfare()
    this.ui.toast.textContent = `New record — ${this.best.toFixed(2)} m of soft`
    this.ui.toast.classList.add('on')
    this.toastT = 2.6
  }
}
