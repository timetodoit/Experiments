// One soft-body arena: a Rust World, a renderer, pointer/touch input, DOM obstacles,
// impact sounds and pops. Used by both the poster hero and THE STACK.

import { World } from './wasm/soft'
import type { Sfx } from './audio'
import type { GlyphStat } from './glyphs'
import type { Frame, Look, Renderer } from './types'

export interface BodyMeta {
  label: string
  /** rendered cap height, CSS px (drives pitch) */
  size: number
  color: string
  popping: boolean
  home?: { x: number; y: number }
  born: number
}

export interface StageHooks {
  cursor?: (mode: string, label: string) => void
  onPopStart?: (i: number, meta: BodyMeta, clientX: number, clientY: number) => void
  onPopped?: (i: number, meta: BodyMeta) => void
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const INTERACTIVE = 'a,button,input,label,select,textarea,.dock'

export class Stage {
  world: World
  metas: BodyMeta[] = []
  w = 1
  h = 1
  floor = 1
  bottomInset = 0
  visible = false
  grabRadius = 30
  private grabbed = -1
  private client = { x: 0, y: 0 }
  private touchId: number | null = null
  private lastTap = { t: 0, body: -1 }
  private obstacleEls: { el: HTMLElement; ground: boolean }[] = []
  private hover = false
  private sizeKey = ''

  constructor(
    readonly host: HTMLElement,
    public canvas: HTMLCanvasElement,
    private memory: WebAssembly.Memory,
    public renderer: Renderer,
    private sfx: Sfx,
    public look: Look,
    private hooks: StageHooks = {},
  ) {
    this.world = new World(1, 1)

    host.addEventListener('pointerdown', (e) => this.down(e))
    window.addEventListener('pointermove', (e) => this.move(e))
    window.addEventListener('pointerup', () => this.up())
    window.addEventListener('pointercancel', () => this.up())
    host.addEventListener('dblclick', (e) => {
      const [x, y] = this.local(e.clientX, e.clientY)
      const i = this.world.hit(x, y, 6)
      if (i >= 0) this.pop(i)
    })
    host.addEventListener('pointerleave', () => {
      if (this.hover) hooks.cursor?.('', '')
      this.hover = false
    })

    // Touch: claim the gesture only when it starts on a letter, so the page still scrolls.
    host.addEventListener('touchstart', (e) => this.touchStart(e), { passive: false })
    window.addEventListener('touchmove', (e) => this.touchMove(e), { passive: false })
    window.addEventListener('touchend', (e) => this.touchEnd(e))
    window.addEventListener('touchcancel', (e) => this.touchEnd(e))
  }

  private local(cx: number, cy: number): [number, number] {
    const r = this.canvas.getBoundingClientRect()
    return [cx - r.left, cy - r.top]
  }

  private down(e: PointerEvent) {
    if (e.pointerType === 'touch' || e.button !== 0) return
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return
    this.sfx.unlock()
    this.client.x = e.clientX
    this.client.y = e.clientY
    const [x, y] = this.local(e.clientX, e.clientY)
    const i = this.world.grab(x, y, this.grabRadius)
    if (i >= 0) {
      this.grabbed = i
      e.preventDefault()
      try {
        this.host.setPointerCapture(e.pointerId)
      } catch {
        /* not capturable */
      }
      this.hooks.cursor?.('hold', 'squish')
    } else {
      // poke the nearby letters
      this.world.impulse(x, y, 170, 520)
    }
  }

  private move(e: PointerEvent) {
    if (e.pointerType === 'touch') return
    this.client.x = e.clientX
    this.client.y = e.clientY
    if (this.grabbed >= 0 || !this.visible) return
    const t = e.target as HTMLElement | null
    if (!t || !this.host.contains(t)) return
    if (t.closest(INTERACTIVE)) {
      this.hover = false
      return
    }
    const [x, y] = this.local(e.clientX, e.clientY)
    const over = this.world.hit(x, y, 4) >= 0
    this.hover = true
    this.hooks.cursor?.(over ? 'grab' : '', over ? 'grab' : '')
  }

  private up() {
    if (this.grabbed < 0) return
    this.world.release()
    this.grabbed = -1
    this.hooks.cursor?.('grab', 'grab')
  }

  private touchStart(e: TouchEvent) {
    if (this.touchId !== null) return
    const t = e.changedTouches[0]
    if (!t || (t.target as HTMLElement).closest?.(INTERACTIVE)) return
    // (audio unlocks on touchend — Chrome doesn't count touchstart as a gesture)
    const [x, y] = this.local(t.clientX, t.clientY)
    const i = this.world.grab(x, y, this.grabRadius * 1.25)
    if (i < 0) return
    e.preventDefault()
    const now = performance.now()
    if (this.lastTap.body === i && now - this.lastTap.t < 330) {
      this.world.release()
      this.lastTap.body = -1
      this.pop(i)
      return
    }
    this.lastTap = { t: now, body: i }
    this.touchId = t.identifier
    this.grabbed = i
    this.client.x = t.clientX
    this.client.y = t.clientY
  }

  private touchMove(e: TouchEvent) {
    if (this.touchId === null) return
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchId) continue
      e.preventDefault()
      this.client.x = t.clientX
      this.client.y = t.clientY
    }
  }

  private touchEnd(e: TouchEvent) {
    if (this.touchId === null) return
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchId) continue
      this.touchId = null
      this.world.release()
      this.grabbed = -1
    }
  }

  pop(i: number) {
    const m = this.metas[i]
    if (!m || m.popping) return
    this.world.pop(i)
    m.popping = true
    if (this.grabbed === i) this.grabbed = -1
    const r = this.canvas.getBoundingClientRect()
    const x = this.world.body_x(i)
    const y = this.world.body_y(i)
    const pan = (x / Math.max(1, this.w)) * 2 - 1
    this.sfx.pop(pan)
    this.sfx.deflate(pan)
    this.hooks.onPopStart?.(i, m, r.left + x, r.top + y)
  }

  /** Register DOM elements that letters collide with. */
  setObstacles(list: { el: HTMLElement; ground: boolean }[]) {
    this.obstacleEls = list
    this.syncObstacles()
  }

  obstacleBottom() {
    const r = this.canvas.getBoundingClientRect()
    let b = 0
    for (const o of this.obstacleEls) {
      if (o.ground) continue
      const e = o.el.getBoundingClientRect()
      if (e.width && e.height) b = Math.max(b, e.bottom - r.top)
    }
    return b
  }

  syncObstacles() {
    const r = this.canvas.getBoundingClientRect()
    const data: number[] = []
    for (const o of this.obstacleEls) {
      const e = o.el.getBoundingClientRect()
      if (!e.width || !e.height) continue
      data.push(e.left - r.left, e.top - r.top, e.width, e.height, o.ground ? 1 : 0)
    }
    this.world.set_obstacles(new Float32Array(data))
  }

  layout(dpr: number) {
    const r = this.canvas.getBoundingClientRect()
    this.w = Math.max(1, r.width)
    this.h = Math.max(1, r.height)
    this.floor = Math.max(40, this.h - this.bottomInset)
    this.world.set_bounds(0, 0, this.w, this.floor)
    const key = `${this.w}x${this.h}@${dpr}`
    if (key !== this.sizeKey) {
      this.sizeKey = key
      this.renderer.resize(this.w, this.h, dpr)
    }
    this.syncObstacles()
  }

  spawn(stat: GlyphStat, x: number, y: number, angle: number, cap: number, grow: number, color: string, label = stat.text) {
    const scale = cap / stat.cap
    const [r, g, b] = hexToRgb(color)
    const i = this.world.spawn(stat.template, x, y, angle, scale, grow, r, g, b, 0)
    if (i < 0) return -1
    this.metas[i] = { label, size: stat.height * scale, color, popping: false, born: performance.now() }
    return i
  }

  /**
   * Free spot for a w×h box between `yTop` and `yMax` — the highest one, or the lowest
   * with `upward` — trying `preferX` first and then positions across the arena.
   */
  findFree(preferX: number, w: number, h: number, yTop: number, yMax: number, upward = false): [number, number] | null {
    const hw = w / 2
    const hh = h / 2
    const minX = hw + 4
    const maxX = this.w - hw - 4
    const xs = [preferX]
    for (let k = 1; k <= 12; k++) xs.push(preferX + k * hw * 0.6, preferX - k * hw * 0.6)
    const step = Math.max(12, hh * 0.5)
    const rows: number[] = []
    for (let y = yTop + hh; y <= yMax - hh; y += step) rows.push(y)
    if (upward) rows.reverse()
    for (const y of rows) {
      for (const x0 of xs) {
        const x = Math.min(maxX, Math.max(minX, x0))
        if (this.world.region_free(x - hw, y - hh, x + hw, y + hh)) return [x, y]
      }
    }
    return null
  }

  remove(i: number) {
    if (i < 0 || i >= this.metas.length) return
    if (this.grabbed === i) this.grabbed = -1
    else if (this.grabbed > i) this.grabbed -= 1
    this.world.remove_body(i)
    this.metas.splice(i, 1)
  }

  clear() {
    this.grabbed = -1
    this.world.clear()
    this.metas = []
  }

  get holding() {
    return this.grabbed
  }

  frame(): Frame {
    const buf = this.memory.buffer
    const w = this.world
    const nPts = w.point_count()
    const nBodies = w.body_count()
    const nRings = w.ring_count()
    return {
      pts: new Float32Array(buf, w.pts_ptr(), nPts * 8),
      bodies: new Float32Array(buf, w.body_ptr(), nBodies * 12),
      rings: new Uint32Array(buf, w.ring_ptr(), nRings * 4),
      fill: new Uint32Array(buf, w.fill_ptr(), w.fill_len()),
      strip: new Uint32Array(buf, w.strip_ptr(), w.strip_len()),
      generation: w.generation(),
      nPts,
      nBodies,
      nRings,
    }
  }

  update(dt: number, time: number) {
    if (this.grabbed >= 0) {
      if (this.world.grabbed() < 0) this.grabbed = -1
      else {
        const [x, y] = this.local(this.client.x, this.client.y)
        this.world.drag(x, y)
      }
    }
    this.world.step(dt)

    // impacts → boings
    const n = this.world.event_count()
    if (n) {
      const ev = new Float32Array(this.memory.buffer, this.world.events_ptr(), n * 4)
      for (let k = 0; k < n; k++) {
        const m = this.metas[ev[k * 4]]
        if (!m) continue
        this.sfx.boing(m.size, ev[k * 4 + 1], (ev[k * 4 + 2] / this.w) * 2 - 1)
      }
    }

    // finished pops (iterate backwards: handlers may remove bodies)
    for (let i = this.metas.length - 1; i >= 0; i--) {
      const m = this.metas[i]
      if (m.popping && this.world.body_pop(i) >= 1) this.hooks.onPopped?.(i, m)
    }

    this.renderer.draw(this.frame(), this.look, time)
  }
}
