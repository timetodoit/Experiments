// Canvas2D fallback: the same camera, chapters, morphs, sweep and shockwave,
// on a ~20k-point subsample, projected and simulated in JS.

import type { FrameState, PointRenderer } from './frame'
import { hash01 } from './math'

const BUCKETS = 10

export class Fallback2D implements PointRenderer {
  readonly kind = 'canvas2d' as const
  readonly count: number
  private ctx: CanvasRenderingContext2D
  private targets: Float32Array[]
  private pos: Float32Array
  private vel: Float32Array
  private free: Float32Array
  private seed: Float32Array
  private seed2: Float32Array
  private buckets: Float32Array[]
  private fill: number[] = new Array(BUCKETS + 1).fill(0)
  private dpr = 1

  constructor(readonly canvas: HTMLCanvasElement, clouds: Float32Array[], sample = 20_000) {
    const n = clouds[0].length / 8
    const m = Math.min(sample, n)
    this.count = m
    this.ctx = canvas.getContext('2d', { alpha: false })!
    // same indices in every cloud keeps the morph correspondence of the GPU path
    this.targets = clouds.map((c) => {
      const t = new Float32Array(m * 8)
      for (let j = 0; j < m; j++) {
        const i = Math.floor((j * n) / m)
        t.set(c.subarray(i * 8, i * 8 + 8), j * 8)
      }
      return t
    })
    this.pos = new Float32Array(m * 3)
    this.vel = new Float32Array(m * 3)
    this.free = new Float32Array(m).fill(-1)
    this.seed = new Float32Array(m)
    this.seed2 = new Float32Array(m)
    const t0 = this.targets[0]
    for (let j = 0; j < m; j++) {
      this.pos[j * 3] = t0[j * 8]
      this.pos[j * 3 + 1] = t0[j * 8 + 1]
      this.pos[j * 3 + 2] = t0[j * 8 + 2]
      this.seed[j] = hash01(j * 31 + 7)
      this.seed2[j] = hash01(j * 17 + 3)
    }
    this.buckets = Array.from({ length: BUCKETS + 1 }, () => new Float32Array(m * 3))
  }

  resize(w: number, h: number, dpr: number) {
    // the fallback stays at 1× for speed; points are drawn as rects anyway
    this.dpr = Math.min(dpr, 1.5)
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr))
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr))
  }

  frame(f: FrameState) {
    const { ctx, pos, vel, free } = this
    const m = this.count
    const A = this.targets[f.a]
    const B = this.targets[f.b]
    const dt = f.dt
    const W = this.canvas.width
    const H = this.canvas.height
    const vp = f.viewProj
    const focal = f.focalCss * this.dpr
    this.fill.fill(0)

    for (let j = 0; j < m; j++) {
      const t = j * 8
      const p = j * 3
      const sd = this.seed[j]
      const stagger = Math.min(1, Math.max(0, A[t + 7] * 0.6 + sd * 0.4))
      const l = Math.min(1, Math.max(0, (f.mix - stagger * 0.55) / 0.45))
      const e = l * l * (3 - 2 * l)
      const arc = Math.sin(Math.PI * e)
      let gx = A[t] + (B[t] - A[t]) * e
      let gy = A[t + 1] + (B[t + 1] - A[t + 1]) * e
      let gz = A[t + 2] + (B[t + 2] - A[t + 2]) * e
      if (arc > 0.001) {
        const k = arc * (1.5 + this.seed2[j] * 4.5) * f.turbulence
        gx += Math.sin(gy * 0.08 + f.time * 0.35 + sd * 6) * k
        gy += Math.sin(gz * 0.08 + f.time * 0.3) * k * 0.6
        gz += Math.sin(gx * 0.08 - f.time * 0.4) * k
      }
      let px = pos[p], py = pos[p + 1], pz = pos[p + 2]
      let vx = vel[p], vy = vel[p + 1], vz = vel[p + 2]
      let fr = free[j]
      if (f.shock[3] > 0) {
        const dx = px - f.shock[0], dy = py - f.shock[1], dz = pz - f.shock[2]
        const r = Math.hypot(dx, dy, dz)
        const R = 11 * f.shock[3]
        const fall = Math.exp(-(r * r) / (R * R))
        if (fall > 0.03) {
          const s = (0.5 + this.seed2[j]) * fall
          const ir = 1 / Math.max(r, 1e-3)
          vx += dx * ir * 30 * s
          vy += (dy * ir * 30 + 15) * s
          vz += dz * ir * 30 * s
          fr = Math.max(fr, 1.5 + sd * 0.9)
        }
      }
      if (fr > 0) {
        vy -= 26 * dt
        const drag = Math.exp(-dt * 0.4)
        vx *= drag; vy *= drag; vz *= drag
      } else {
        const ss = Math.min(1, Math.max(0, (fr + 0.9) / 0.9))
        const reattach = 1 - ss * ss * (3 - 2 * ss) * 0.92
        const k = 17 * (0.7 + 0.6 * sd) * reattach
        const c = 2 * Math.sqrt(k) * 0.74
        vx += ((gx - px) * k - vx * c) * dt
        vy += ((gy - py) * k - vy * c) * dt
        vz += ((gz - pz) * k - vz * c) * dt
      }
      px += vx * dt; py += vy * dt; pz += vz * dt
      if (py < 0 && fr > -0.5) {
        py = -py * 0.15
        vy = Math.abs(vy) * 0.4
        vx *= 0.75; vz *= 0.75
      }
      fr = Math.max(fr - dt, -1)
      pos[p] = px; pos[p + 1] = py; pos[p + 2] = pz
      vel[p] = vx; vel[p + 1] = vy; vel[p + 2] = vz
      free[j] = fr

      // sweep visibility
      const st = A[t + 7] + (B[t + 7] - A[t + 7]) * e
      const dS = st - f.sweepFront
      if (f.sweepReveal > 0.5 && dS > 0.004) continue
      // project
      const cx = vp[0] * px + vp[4] * py + vp[8] * pz + vp[12]
      const cy = vp[1] * px + vp[5] * py + vp[9] * pz + vp[13]
      const cw = vp[3] * px + vp[7] * py + vp[11] * pz + vp[15]
      if (cw < 0.35) continue
      const sx = (cx / cw * 0.5 + 0.5) * W
      const sy = (0.5 - cy / cw * 0.5) * H
      if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue
      const it = A[t + 3] + (B[t + 3] - A[t + 3]) * e
      const fog = Math.exp(-cw * 0.0042)
      let b = it * fog * 1.5
      const fdx = px - f.flash[0], fdy = py - f.flash[1], fdz = pz - f.flash[2]
      const glow = Math.exp(-(fdx * fdx + fdy * fdy + fdz * fdz) / Math.max(f.flash[3] * f.flash[3], 1e-3)) * f.flashStrength
      b += glow * 0.9
      const size = Math.min(4, Math.max(1.4, (0.1 * focal) / cw)) * (1 + glow * 0.6)
      const band = Math.exp(-(dS * dS) / (f.sweepWidth * f.sweepWidth)) * f.sweepStrength
      const bucket = band > 0.35 ? BUCKETS : Math.min(BUCKETS - 1, Math.floor(b * BUCKETS))
      const arr = this.buckets[bucket]
      const o = this.fill[bucket] * 3
      arr[o] = sx; arr[o + 1] = sy; arr[o + 2] = size
      this.fill[bucket]++
    }

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = '#0b0c0e'
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'lighter'
    for (let k = 0; k <= BUCKETS; k++) {
      const n = this.fill[k]
      if (!n) continue
      const arr = this.buckets[k]
      if (k === BUCKETS) {
        ctx.fillStyle = '#ff5a1f'
        ctx.globalAlpha = 0.9 * f.intro
      } else {
        const v = (k + 0.5) / BUCKETS
        const c = Math.round(110 + v * 130)
        ctx.fillStyle = `rgb(${c - 8},${c - 2},${c + 8})`
        ctx.globalAlpha = Math.min(1, 0.3 + v * 0.8) * f.intro
      }
      for (let q = 0; q < n; q++) {
        const s = arr[q * 3 + 2]
        ctx.fillRect(arr[q * 3] - s * 0.5, arr[q * 3 + 1] - s * 0.5, s, s)
      }
    }
    // selected point reticle
    if (f.sel[3] > 0) {
      const [x, y, z] = f.sel
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]
      if (cw > 0.35) {
        const sx = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw * 0.5 + 0.5) * W
        const sy = (0.5 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw * 0.5) * H
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        ctx.fillStyle = '#ff5a1f'
        ctx.fillRect(sx - 2, sy - 2, 4, 4)
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
