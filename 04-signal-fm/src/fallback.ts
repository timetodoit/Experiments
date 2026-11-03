// Canvas2D fallback when WebGPU is unavailable: a 2D animated field per station
// (blob / tunnel / twisting bars / moon over water) quantised to the same glyph
// ramp, with the same static, tearing, ripple and hold bubble — driven by the
// same audio bands. One fillText per row keeps it cheap.

import { cellHeight, FONT, GLYPHS, NOISE0, RAMP_N } from './glyphs'
import { css } from './stations'
import type { FrameState, Renderer } from './renderer'

const fract = (x: number) => x - Math.floor(x)
const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453)
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export class Signal2D implements Renderer {
  readonly kind = 'canvas2d'
  cols = 1
  rows = 1
  private g: CanvasRenderingContext2D
  private cw = 12
  private ch = 18
  private dpr = 1
  private pulse = [0.5, 0.5, -100, -100]
  private lum = new Float32Array(1)
  private acc = new Uint8Array(1)

  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d', { alpha: false })!
  }

  resize(w: number, h: number, dpr: number, cellCss: number) {
    this.dpr = Math.min(dpr, 1.5)
    const W = Math.floor(w * this.dpr)
    const H = Math.floor(h * this.dpr)
    this.canvas.width = W
    this.canvas.height = H
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.cw = Math.max(7, Math.round(Math.max(cellCss, 10) * this.dpr))
    this.ch = cellHeight(this.cw)
    this.cols = Math.ceil(W / this.cw)
    this.rows = Math.ceil(H / this.ch)
    this.lum = new Float32Array(this.cols * this.rows)
    this.acc = new Uint8Array(this.cols * this.rows)
    // size the font so one advance == one cell
    const g = this.g
    g.font = `600 100px ${FONT}`
    const adv = g.measureText('M').width / 100 || 0.6
    g.font = `600 ${(this.cw / adv).toFixed(2)}px ${FONT}`
    g.textBaseline = 'middle'
    g.textAlign = 'left'
  }

  firePulse(x: number, y: number, rtime: number, stime: number) {
    this.pulse = [x, y, rtime, stime]
  }

  private field(scene: number, x: number, y: number, t: number, s: FrameState): number {
    const [bass, mid, high] = s.bands
    const mx = s.mouse[0] * 0.25
    const my = -s.mouse[1] * 0.2
    const px = x - mx
    const py = y - my
    if (scene === 0) {
      const r = Math.hypot(px, py)
      const a = Math.atan2(py, px)
      const edge = 0.32 + 0.08 * bass + 0.04 * Math.sin(a * 5 + t * 1.3) + 0.03 * Math.sin(a * 9 - t * 2.1) * mid
      const inside = sstep(edge + 0.02, edge - 0.08, r)
      const shade = 0.55 + 0.45 * Math.sin(px * 7 + t) * Math.cos(py * 6 - t * 0.7)
      return inside * (0.35 + 0.65 * shade * (1 - r * 1.2)) + 0.05
    }
    if (scene === 1) {
      const r = Math.max(0.04, Math.hypot(px, py * 1.2))
      const a = Math.atan2(py, px)
      const v = 0.25 / r + t * 1.6
      const rings = sstep(0.75, 0.95, fract(v * 0.5))
      const spokes = 0.5 + 0.5 * Math.cos(a * 6 + v * 0.3)
      return Math.min(1, r * 2.2) * (rings * 0.85 + spokes * 0.15 * (0.5 + bass))
    }
    if (scene === 2) {
      const id = Math.round(py / 0.07)
      const ly = py - id * 0.07
      if (Math.abs(id) > 6 || Math.abs(ly) > 0.025) return 0.04
      const tw = Math.cos(t * 0.6 + id * (0.25 + 0.3 * mid))
      const w = (0.42 - Math.abs(id) * 0.025 + 0.05 * bass) * Math.abs(tw)
      return Math.abs(px) < w ? 0.35 + 0.6 * (0.5 + 0.5 * tw) * (1 - Math.abs(px) / (w + 0.01)) : 0.04
    }
    // scene 3 — moon over water
    const hz = 0.08
    if (py < hz) {
      const d = Math.hypot(px, py + 0.22)
      const moon = sstep(0.11, 0.1, d)
      const halo = Math.max(0, 0.06 - d * 0.08) * (1 + high * 4)
      const star = hash(Math.floor(x * 120), Math.floor(y * 120)) > 0.992 ? 0.6 : 0
      return Math.min(1, 0.04 + moon * (0.5 + 0.5 * sstep(0.05, -0.08, px + 0.03)) + halo + star)
    }
    const depth = (py - hz) * 3 + 0.05
    const w = Math.sin(x / depth * 2.2 + t * 1.2) * Math.sin(1 / depth * 3.0 - t * 0.9) * (0.5 + bass)
    const glint = Math.max(0, 1 - Math.abs(px) / (0.04 + depth * 0.3)) * (0.5 + 0.5 * w)
    return 0.06 + Math.max(0, w) * 0.35 * Math.min(1, depth * 2) + glint * 0.8
  }

  frame(s: FrameState) {
    const { cols, rows, cw, ch, g } = this
    const W = this.canvas.width
    const H = this.canvas.height
    const aspect = (cols * cw) / (rows * ch)
    const mo = s.motion
    const tq = Math.floor(s.rtime * 16) * mo
    const off = Math.min(1, Math.max(0, 1 - s.signal))
    const gl = Math.min(1, s.glitch) * mo
    const age = s.rtime - this.pulse[2]

    for (let j = 0; j < rows; j++) {
      const band = Math.floor(j / 2)
      let shift = 0
      if (hash(band, tq) < (gl + off * 0.16 * mo) * 0.5) shift = Math.floor((hash(band * 1.7 + 3.1, tq + 9) - 0.5) * 2 * (3 + 36 * gl))
      for (let i = 0; i < cols; i++) {
        const si = (((i + shift) % cols) + cols) % cols
        const x = ((si + 0.5) / cols - 0.5) * aspect
        const y = (j + 0.5) / rows - 0.5
        let l = this.field(s.scene, x, y, s.time, s)
        const n = hash(i + tq * 17, j * 1.31 + tq * 3)
        const streak = hash(j, tq * 1.3) > 0.985 ? 0.55 : 0
        l = l + (n * n * 0.9 + streak - l) * off * 0.94
        l *= 0.92 + 0.22 * s.beat
        let ring = 0
        if (age >= 0 && age < 2.4) {
          const dx = (i + 0.5 - this.pulse[0] * cols) * cw
          const dy = (j + 0.5 - this.pulse[1] * rows) * ch
          const d = Math.hypot(dx, dy) / cw
          ring = Math.exp(-(((d - age * 62) / 2.2) ** 2)) * (1 - age / 2.4)
        }
        l += ring * 0.85
        const k = j * cols + i
        this.lum[k] = l
        this.acc[k] = ring > 0.5 || (s.scene === 3 && l > 0.85) ? 1 : 0
      }
    }

    g.fillStyle = css(s.paper)
    g.fillRect(0, 0, W, H)
    const ox = Math.floor((cols * cw - W) / 2)
    const oy = Math.floor((rows * ch - H) / 2)

    const draw = (ink: string, accent: string) => {
      for (let j = 0; j < rows; j++) {
        let main = ''
        let hot = ''
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i
          const l = Math.min(1, Math.max(0, this.lum[k]))
          let gi = Math.min(RAMP_N - 1, Math.max(0, Math.floor(l * (RAMP_N - 1) + BAYER[(j & 3) * 4 + (i & 3)] / 16 - 0.25)))
          if (hash(i + tq * 3.1, j + tq * 1.7 + 0.37) < gl * 0.45 + off * 0.1 * mo + (this.acc[k] ? 0.2 : 0))
            gi = NOISE0 + Math.floor(hash(j + tq, i + 5) * (GLYPHS.length - NOISE0))
          const glyph = GLYPHS[gi]
          if (this.acc[k]) {
            main += ' '
            hot += glyph
          } else {
            main += glyph
            hot += ' '
          }
        }
        const y = j * ch + ch / 2 - oy
        g.fillStyle = ink
        g.fillText(main, -ox, y)
        g.fillStyle = accent
        g.fillText(hot, -ox, y)
      }
    }
    draw(css(s.ink), css(s.accent))

    if (s.hold[2] > 0.002) {
      const r = s.hold[2] * Math.hypot(W, H) * 0.62
      const hx = s.hold[0] * cols * cw - ox
      const hy = s.hold[1] * rows * ch - oy
      g.save()
      g.beginPath()
      g.arc(hx, hy, r, 0, Math.PI * 2)
      g.clip()
      g.fillStyle = css(s.ink)
      g.fillRect(0, 0, W, H)
      draw(css(s.paper), css(s.accent))
      g.restore()
      g.strokeStyle = css(s.accent)
      g.lineWidth = ch * 0.9
      g.beginPath()
      g.arc(hx, hy, r, 0, Math.PI * 2)
      g.stroke()
    }
  }
}
