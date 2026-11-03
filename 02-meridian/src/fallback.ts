// Canvas2D "watercolour sketch" used when WebGPU is missing or fails. Same
// inputs as the fluid (palette, light, splats, scroll), none of the physics:
// drifting pigment clouds and blooming drops. Glass falls back to CSS
// backdrop-filter (see .no-gpu in style.css).

import type { FrameInput, Grid, Renderer, SplatIn } from './gpu/fluid'
import { css, type RGB } from './palette'

interface Drop {
  x: number
  y: number
  r: number
  grow: number
  vx: number
  vy: number
  color: RGB
  a: number
  life: number
}

export class Canvas2DRenderer implements Renderer {
  readonly kind = 'canvas2d'
  readonly grid: Grid = { vw: 0, vh: 0, dw: 0, dh: 0 }
  private ctx: CanvasRenderingContext2D | null
  private w = 1
  private h = 1
  private dpr = 1
  private drops: Drop[] = []

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = Math.min(dpr, 1.5)
    this.w = Math.max(1, w)
    this.h = Math.max(1, h)
    this.canvas.width = Math.floor(this.w * this.dpr)
    this.canvas.height = Math.floor(this.h * this.dpr)
    return false
  }

  setMask() {}

  splat(s: SplatIn) {
    const radial = (s.radial ?? 0) > 0
    if (!radial && s.amount < 0.12 && Math.random() > 0.3) return
    if (this.drops.length > 160) this.drops.shift()
    this.drops.push({
      x: s.x * this.w,
      y: s.y * this.h,
      r: s.r * this.h * (radial ? 1.3 : 1.0),
      grow: radial ? 60 : 18,
      vx: (s.vx ?? 0) * 0.08,
      vy: (s.vy ?? 0) * 0.08,
      color: s.color,
      a: Math.min(0.85, 0.18 + s.amount * 0.35),
      life: 1,
    })
  }

  frame(f: FrameInput) {
    const ctx = this.ctx
    if (!ctx) return
    const k = this.dpr
    const W = this.canvas.width
    const H = this.canvas.height
    const { pal, light } = f
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    const g = ctx.createLinearGradient(W / 2 - light.x * W * 0.6, H / 2 - light.y * H * 0.6, W / 2 + light.x * W * 0.6, H / 2 + light.y * H * 0.6)
    g.addColorStop(0, css(pal.bg))
    g.addColorStop(1, css(pal.bg2))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    ctx.globalCompositeOperation = pal.night > 0.5 ? 'screen' : 'multiply'
    const t = f.time
    const m = Math.min(W, H)
    for (let i = 0; i < 5; i++) {
      const x = W * (0.5 + 0.38 * Math.sin(t * 0.05 * (i + 1) + i * 1.7))
      const y = H * (0.5 + 0.34 * Math.cos(t * 0.04 * (i + 2) + i * 2.3))
      const r = m * (0.32 + 0.08 * Math.sin(t * 0.3 + i))
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r)
      rg.addColorStop(0, css(pal.inks[i % 3], 0.28))
      rg.addColorStop(1, css(pal.inks[i % 3], 0))
      ctx.fillStyle = rg
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }

    const dt = f.dt
    for (const d of this.drops) {
      d.x += d.vx * dt
      d.y += d.vy * dt - f.scrollDelta
      d.vx *= Math.exp(-dt * 2)
      d.vy *= Math.exp(-dt * 2)
      d.r += d.grow * dt
      d.grow *= Math.exp(-dt * 1.5)
      d.life -= dt * (f.calm ? 0.4 : 0.22)
      const x = d.x * k
      const y = d.y * k
      const r = Math.max(1, d.r * k)
      const a = d.a * Math.max(0, d.life)
      const rg = ctx.createRadialGradient(x, y, r * 0.1, x, y, r)
      rg.addColorStop(0, css(d.color, a))
      rg.addColorStop(0.7, css(d.color, a * 0.6))
      rg.addColorStop(1, css(d.color, 0))
      ctx.fillStyle = rg
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    this.drops = this.drops.filter((d) => d.life > 0)
    ctx.globalCompositeOperation = 'source-over'
  }
}
