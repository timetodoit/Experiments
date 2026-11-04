// Canvas2D fallback: a pseudo-3D valley floor of glowing dot-flowers seen in
// perspective, with parallax hill silhouettes, the same scroll/drift, cursor
// push and hover dispersal. No WebGPU required.

import { PALETTE, mulberry, fbm } from './terrain'

export interface FallbackFrame {
  time: number
  s: number // distance travelled
  mouse: [number, number, number] // css px x, y (y down), strength
  disperse: number
  intro: number
  speed: number
  tiltX: number
  tiltY: number
}

const DEPTH = 70

interface Dot {
  x: number
  z: number
  y: number
  size: number
  pal: number
  seed: number
}

function sprite(rgb: [number, number, number], petals: boolean) {
  const S = 64
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const css = (a: number, k = 1) =>
    `rgba(${Math.round(Math.min(1, rgb[0] * k) * 255)},${Math.round(Math.min(1, rgb[1] * k) * 255)},${Math.round(Math.min(1, rgb[2] * k) * 255)},${a})`
  const halo = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  halo.addColorStop(0, css(0.5))
  halo.addColorStop(0.3, css(0.16))
  halo.addColorStop(1, css(0))
  g.fillStyle = halo
  g.fillRect(0, 0, S, S)
  if (petals) {
    g.fillStyle = css(0.75, 0.9)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      g.beginPath()
      g.ellipse(S / 2 + Math.cos(a) * 7, S / 2 + Math.sin(a) * 7, 7, 4.2, a, 0, Math.PI * 2)
      g.fill()
    }
  }
  g.fillStyle = 'rgba(255,244,225,0.95)'
  g.beginPath()
  g.arc(S / 2, S / 2, petals ? 3.2 : 2.4, 0, Math.PI * 2)
  g.fill()
  return c
}

export class Fallback {
  private g: CanvasRenderingContext2D
  private dots: Dot[] = []
  private sprites: HTMLCanvasElement[] = []
  private motes: HTMLCanvasElement[] = []
  private w = 1
  private h = 1
  private dpr = 1
  private hills: { amp: number; seed: number; base: number; shade: string; par: number }[] = [
    { amp: 0.09, seed: 3, base: 0.5, shade: '#04080c', par: 0.15 },
    { amp: 0.07, seed: 11, base: 0.53, shade: '#03070a', par: 0.35 },
    { amp: 0.05, seed: 23, base: 0.56, shade: '#020406', par: 0.6 },
  ]

  constructor(readonly canvas: HTMLCanvasElement, count: number) {
    this.g = canvas.getContext('2d')!
    const rand = mulberry(77)
    for (let i = 0; i < count; i++) {
      const r = rand()
      // valley: dense along the floor, sparser up the sides
      const x = r < 0.6 ? (rand() - 0.5) * 16 : (rand() < 0.5 ? -1 : 1) * (8 + rand() * 26)
      const z = rand() * DEPTH
      const clump = fbm(x * 0.2, z * 0.2, 2)
      if (rand() > 0.25 + clump * 1.2) {
        i--
        continue
      }
      this.dots.push({
        x,
        z,
        y: Math.pow(Math.max(0, Math.abs(x) - 6), 1.35) * 0.28,
        size: 0.06 + Math.pow(rand(), 2) * 0.16,
        pal: Math.floor(rand() * PALETTE.length),
        seed: rand(),
      })
    }
    this.sprites = PALETTE.map((c) => sprite(c, true))
    this.motes = PALETTE.map((c) => sprite(c, false))
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    this.dpr = dpr
    this.canvas.width = Math.floor(w * dpr)
    this.canvas.height = Math.floor(h * dpr)
  }

  frame(f: FallbackFrame) {
    const { g, w, h } = this
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    g.globalCompositeOperation = 'source-over'
    const horizon = h * (0.47 - f.tiltY * 0.04)
    const sky = g.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#000000')
    sky.addColorStop(0.36, '#010307')
    sky.addColorStop(0.5, '#04121a')
    sky.addColorStop(0.62, '#020608')
    sky.addColorStop(1, '#000000')
    g.fillStyle = sky
    g.fillRect(0, 0, w, h)

    // parallax hill silhouettes
    for (const hl of this.hills) {
      g.fillStyle = hl.shade
      g.beginPath()
      g.moveTo(0, h)
      const off = f.s * hl.par * 2 + f.tiltX * 40 * hl.par
      for (let x = 0; x <= w; x += 8) {
        const n = fbm((x + off) * 0.004 + hl.seed, hl.seed, 3)
        const valley = Math.pow(Math.abs(x / w - 0.5) * 2, 1.6)
        g.lineTo(x, h * (hl.base - hl.amp * n * 2 * (0.3 + valley)) + (1 - valley) * h * 0.04)
      }
      g.lineTo(w, h)
      g.closePath()
      g.fill()
    }

    // flowers
    const cx = w / 2 - f.tiltX * w * 0.03
    const focal = h * 0.9
    const camY = 1.6
    const [mx, my, ms] = f.mouse
    const R = Math.min(w, h) * 0.2
    g.globalCompositeOperation = 'lighter'
    const order = this.dots
      .map((d, i) => ({ i, z: (((d.z - f.s) % DEPTH) + DEPTH) % DEPTH }))
      .sort((a, b) => b.z - a.z)
    for (const o of order) {
      const d = this.dots[o.i]
      const z = o.z + 0.6
      const grow = 1 - Math.min(1, Math.max(0, (z - 6 - d.seed * 8) / (30 + d.seed * 20)))
      const intro = Math.min(1, Math.max(0, (f.intro - d.seed * 0.5) / 0.5))
      const dsp = Math.min(1, Math.max(0, (f.disperse - d.seed * 0.35) / 0.65))
      const sway = Math.sin(f.time * 1.2 + d.x * 0.3 + d.seed * 6) * 0.05
      let sx = cx + ((d.x + sway) / z) * focal
      let sy = horizon + ((camY - d.y - dsp * (1 + d.seed * 3)) / z) * focal
      sx += ((sx - w / 2) / w) * dsp * 120 * (1 + d.seed)
      const ddx = sx - mx
      const ddy = sy - my
      const q = (ddx * ddx + ddy * ddy) / (R * R)
      const fpush = Math.exp(-q) * ms
      sx += ddx * fpush * 0.9
      sy += ddy * fpush * 0.9
      const glow = Math.exp(-q * 2.2) * ms
      const fog = 1 - Math.exp(-z * 0.03)
      const size = Math.max(1.5, ((d.size * (0.2 + 0.8 * grow) * (1 - dsp * 0.7)) / z) * focal * 3)
      const alpha = (1 - fog) * intro * Math.min(1, z / 1.5) * (0.55 + glow * 0.8)
      if (alpha < 0.01 || sx < -size || sx > w + size || sy < -size || sy > h + size) continue
      g.globalAlpha = Math.min(1, alpha)
      g.drawImage(dsp > 0.5 ? this.motes[d.pal] : this.sprites[d.pal], sx - size, sy - size, size * 2, size * 2)
    }
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'

    // vignette tightens with speed
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * (0.35 - f.speed * 0.12), w / 2, h / 2, Math.max(w, h) * 0.75)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, `rgba(0,0,0,${0.75 + f.speed * 0.2})`)
    g.fillStyle = vg
    g.fillRect(0, 0, w, h)
    if (f.intro < 1) {
      g.fillStyle = `rgba(0,0,0,${1 - f.intro})`
      g.fillRect(0, 0, w, h)
    }
  }
}
