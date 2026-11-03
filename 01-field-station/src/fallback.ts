// Canvas2D "degraded survey" used when WebGPU is unavailable. Same inputs as the
// GPU path, a fraction of the fidelity — still the same terrain function.

import { Camera, type SheetView } from './camera'
import { terrain } from './noise'
import type { SurveyState } from './gpu/survey'

const SCALE = 3 // terrain raster is computed at 1/3 resolution

export class Survey2D {
  readonly count = 3500
  private g: CanvasRenderingContext2D
  private base?: HTMLCanvasElement
  private scan?: HTMLCanvasElement
  private builtZoom = -1
  private px = new Float32Array(this.count * 2)
  private pv = new Float32Array(this.count * 2)
  private shocks: { x: number; y: number; t: number; s: number }[] = []
  width = 1
  height = 1
  dpr = 1

  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!
    for (let i = 0; i < this.count; i++) this.respawn(i)
  }

  private respawn(i: number) {
    const aspect = this.width / this.height || 1.6
    this.px[i * 2] = (Math.random() - 0.5) * aspect
    this.px[i * 2 + 1] = Math.random() - 0.5
    this.pv[i * 2] = this.pv[i * 2 + 1] = 0
  }

  resize(w: number, h: number, dpr: number) {
    this.width = w
    this.height = h
    this.dpr = Math.min(dpr, 1.5)
    this.canvas.width = Math.floor(w * this.dpr)
    this.canvas.height = Math.floor(h * this.dpr)
    this.builtZoom = -1
  }

  shock(x: number, y: number, time: number, strength = 1) {
    this.shocks.push({ x, y, t: time, s: strength })
  }

  private build(zoom: number) {
    const w = Math.ceil(this.width / SCALE)
    const h = Math.ceil(this.height / SCALE)
    const base = document.createElement('canvas')
    const scan = document.createElement('canvas')
    base.width = scan.width = w
    base.height = scan.height = h
    const bi = base.getContext('2d')!.createImageData(w, h)
    const si = scan.getContext('2d')!.createImageData(w, h)
    const hs = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) hs[y * w + x] = terrain((x * SCALE - this.width / 2) / this.height, (y * SCALE - this.height / 2) / this.height, zoom, 0)
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        const v = hs[i]
        const lv = v * 22
        const f = lv - Math.floor(lv)
        const fw = Math.abs(hs[i + 1] * 22 - lv) + Math.abs(hs[i + w] * 22 - lv)
        const line = Math.max(0, 1 - Math.min(f, 1 - f) / (fw * 1.2 + 1e-4))
        const major = Math.abs(Math.round(lv) % 5) === 0 ? 1 : 0
        const water = v < 0.36 ? 1 : 0
        const dot = water && x % 2 === 0 && y % 2 === 0 ? 1 : 0
        const a = (major ? 0.55 : 0.16) * line
        const o = i * 4
        bi.data[o] = 6 + 234 * a + dot * 30
        bi.data[o + 1] = 6 + 249 * a + dot * 36
        bi.data[o + 2] = 5 + dot * 44
        bi.data[o + 3] = 255
        const dx = hs[i + 1] - hs[i - 1]
        const dy = hs[i + w] - hs[i - w]
        const shade = Math.max(0, Math.min(1, 0.5 - dx * 40 - dy * 40 + (v - 0.5) * 0.9 - water * 0.4))
        const bar = Math.abs(((x * SCALE) / 4) % 1 - 0.5) * 2 < shade ? 1 : 0
        const ink = line * (major ? 0.85 : 0.35)
        si.data[o] = (6 + 238 * bar) * (1 - ink)
        si.data[o + 1] = (6 + 249 * bar) * (1 - ink)
        si.data[o + 2] = 5
        si.data[o + 3] = 255
      }
    base.getContext('2d')!.putImageData(bi, 0, 0)
    scan.getContext('2d')!.putImageData(si, 0, 0)
    this.base = base
    this.scan = scan
    this.builtZoom = zoom
  }

  frame(s: SurveyState) {
    if (Math.abs(s.zoom - this.builtZoom) > 0.08) this.build(s.zoom)
    const g = this.g
    const W = this.width
    const H = this.height
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    g.globalAlpha = s.intro
    g.imageSmoothingEnabled = true
    g.drawImage(this.base!, 0, 0, W, H)

    // particles
    const aspect = W / H
    const e = 0.004
    g.fillStyle = 'rgba(244,255,0,0.55)'
    this.shocks = this.shocks.filter((k) => s.time - k.t < 2.5)
    for (let i = 0; i < this.count; i++) {
      let x = this.px[i * 2]
      let y = this.px[i * 2 + 1]
      const hx = terrain(x + e, y, s.zoom, 0) - terrain(x - e, y, s.zoom, 0)
      const hy = terrain(x, y + e, s.zoom, 0) - terrain(x, y - e, s.zoom, 0)
      let ax = (-hx / (2 * e)) * 0.32
      let ay = (-hy / (2 * e)) * 0.32
      const dx = x - s.mouse[0]
      const dy = y - s.mouse[1]
      const r2 = dx * dx + dy * dy
      ax += -dx * s.press * 30 * Math.exp(-r2 / 0.01) - dy * s.press * 2 * Math.exp(-r2 / 0.02)
      ay += -dy * s.press * 30 * Math.exp(-r2 / 0.01) + dx * s.press * 2 * Math.exp(-r2 / 0.02)
      for (const k of this.shocks) {
        const ddx = x - k.x
        const ddy = y - k.y
        const r = Math.hypot(ddx, ddy) + 1e-4
        const q = (r - (s.time - k.t) * 0.42) * 22
        const f = k.s * 9 * Math.exp(-q * q)
        ax += (ddx / r) * f
        ay += (ddy / r) * f
      }
      let vx = (this.pv[i * 2] + ax * s.dt) * Math.exp(-s.dt * 1.4)
      let vy = (this.pv[i * 2 + 1] + ay * s.dt) * Math.exp(-s.dt * 1.4)
      x += vx * s.dt
      y += vy * s.dt
      this.pv[i * 2] = vx
      this.pv[i * 2 + 1] = vy
      this.px[i * 2] = x
      this.px[i * 2 + 1] = y
      if (Math.abs(x) > aspect * 0.55 || Math.abs(y) > 0.56 || Math.random() < 0.002) this.respawn(i)
      g.fillRect(x * H + W / 2, y * H + H / 2, 1.4, 1.4)
    }

    // lens
    if (s.scan > 0.01) {
      const cx = s.lens[0] * H + W / 2
      const cy = s.lens[1] * H + H / 2
      g.save()
      g.beginPath()
      for (const r of s.rects) {
        const w = (r[2] - r[0]) * H
        const h = (r[3] - r[1]) * H
        if (w > 0.5 && h > 0.5) g.rect(cx + r[0] * H, cy + r[1] * H, w, h)
      }
      g.clip('nonzero')
      g.globalAlpha = s.scan
      g.drawImage(this.scan!, 0, 0, W, H)
      g.restore()
      g.strokeStyle = '#f4ff00'
      g.lineWidth = 1
      for (const r of s.rects) g.strokeRect(cx + r[0] * H, cy + r[1] * H, (r[2] - r[0]) * H, (r[3] - r[1]) * H)
      g.fillStyle = '#fff'
      g.fillRect(cx - 10, cy - 0.5, 20, 1)
      g.fillRect(cx - 0.5, cy - 10, 1, 20)
    }
    g.globalAlpha = 1
  }
}

/** Flat-shaded Canvas2D renderer for the cloth. */
export class Sheet2D implements SheetView {
  cam = new Camera()
  xray = 0
  private g: CanvasRenderingContext2D
  private verts = new Float32Array(0)
  private indices = new Uint32Array(0)
  private count = 0
  private dpr = 1

  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = Math.min(dpr, 1.5)
    this.canvas.width = Math.floor(w * this.dpr)
    this.canvas.height = Math.floor(h * this.dpr)
    this.cam.resize(w, h)
  }

  upload(verts: Float32Array, indices: Uint32Array | null, indexCount: number) {
    this.verts = verts.slice()
    if (indices) this.indices = indices.slice()
    this.count = indexCount
  }

  frame() {
    const g = this.g
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    g.clearRect(0, 0, this.cam.width, this.cam.height)
    const v = this.verts
    const n = v.length / 8
    const sx = new Float32Array(n)
    const sy = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const p = this.cam.project(v[i * 8], v[i * 8 + 1], v[i * 8 + 2])
      sx[i] = p[0]
      sy[i] = p[1]
    }
    for (let t = 0; t < this.count; t += 3) {
      const a = this.indices[t]
      const b = this.indices[t + 1]
      const c = this.indices[t + 2]
      const nz = Math.abs(v[a * 8 + 5])
      const ny = v[a * 8 + 4]
      const l = Math.max(0.45, Math.min(1, 0.5 + nz * 0.45 + ny * 0.2))
      g.fillStyle = this.xray > 0.5 ? `rgba(244,255,0,${0.1 + l * 0.2})` : `rgb(${239 * l | 0},${234 * l | 0},${219 * l | 0})`
      g.beginPath()
      g.moveTo(sx[a], sy[a])
      g.lineTo(sx[b], sy[b])
      g.lineTo(sx[c], sy[c])
      g.closePath()
      g.fill()
      g.strokeStyle = g.fillStyle
      g.lineWidth = 0.6
      g.stroke()
    }
  }
}
