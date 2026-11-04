// Closed Catmull-Rom spline with an arc-length lookup table.
// Used both as the valley centreline (terrain carving, flower scatter) and the camera rail.

export type V3 = [number, number, number]

export interface PathSample {
  x: number
  y: number
  z: number
  tx: number // unit tangent (xz plane is what matters)
  ty: number
  tz: number
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

export class ClosedSpline {
  readonly length: number
  private readonly table: Float32Array // x,y,z per sample, evenly spaced in arc length
  private readonly n: number

  constructor(private readonly pts: V3[], samples = 2048) {
    // dense raw sampling in parameter space
    const raw = samples * 4
    const rx = new Float64Array(raw + 1)
    const ry = new Float64Array(raw + 1)
    const rz = new Float64Array(raw + 1)
    const cum = new Float64Array(raw + 1)
    for (let i = 0; i <= raw; i++) {
      const p = this.param(i / raw)
      rx[i] = p[0]
      ry[i] = p[1]
      rz[i] = p[2]
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(rx[i] - rx[i - 1], ry[i] - ry[i - 1], rz[i] - rz[i - 1])
    }
    this.length = cum[raw]
    // resample at equal arc-length steps
    this.n = samples
    this.table = new Float32Array(samples * 3)
    let j = 0
    for (let i = 0; i < samples; i++) {
      const target = (i / samples) * this.length
      while (j < raw - 1 && cum[j + 1] < target) j++
      const seg = cum[j + 1] - cum[j] || 1
      const f = (target - cum[j]) / seg
      this.table[i * 3] = rx[j] + (rx[j + 1] - rx[j]) * f
      this.table[i * 3 + 1] = ry[j] + (ry[j + 1] - ry[j]) * f
      this.table[i * 3 + 2] = rz[j] + (rz[j + 1] - rz[j]) * f
    }
  }

  /** position at curve parameter u in [0,1) (not arc-length uniform) */
  private param(u: number): V3 {
    const n = this.pts.length
    const f = (((u % 1) + 1) % 1) * n
    const i = Math.floor(f)
    const t = f - i
    const a = this.pts[(i - 1 + n) % n]
    const b = this.pts[i % n]
    const c = this.pts[(i + 1) % n]
    const d = this.pts[(i + 2) % n]
    return [cr(a[0], b[0], c[0], d[0], t), cr(a[1], b[1], c[1], d[1], t), cr(a[2], b[2], c[2], d[2], t)]
  }

  /** sample at arc-length distance s (wraps) */
  at(s: number, out?: PathSample): PathSample {
    const o = out ?? { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1 }
    const L = this.length
    const u = ((((s % L) + L) % L) / L) * this.n
    const i = Math.floor(u)
    const f = u - i
    const T = this.table
    const n = this.n
    const a = (i % n) * 3
    const b = ((i + 1) % n) * 3
    o.x = T[a] + (T[b] - T[a]) * f
    o.y = T[a + 1] + (T[b + 1] - T[a + 1]) * f
    o.z = T[a + 2] + (T[b + 2] - T[a + 2]) * f
    // tangent from a centred difference a few samples wide (smooth)
    const p = ((i - 2 + n) % n) * 3
    const q = ((i + 3) % n) * 3
    let tx = T[q] - T[p]
    let ty = T[q + 1] - T[p + 1]
    let tz = T[q + 2] - T[p + 2]
    const l = Math.hypot(tx, ty, tz) || 1
    tx /= l
    ty /= l
    tz /= l
    o.tx = tx
    o.ty = ty
    o.tz = tz
    return o
  }

  /** evenly spaced points along the curve (xz), for distance fields */
  points(count: number): Float32Array {
    const out = new Float32Array(count * 2)
    const tmp: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }
    for (let i = 0; i < count; i++) {
      this.at((i / count) * this.length, tmp)
      out[i * 2] = tmp.x
      out[i * 2 + 1] = tmp.z
    }
    return out
  }
}

// The valley centreline: a lazy, lopsided loop so the camera never runs out of valley.
export const VALLEY_POINTS: V3[] = [
  [0, 0, -96],
  [58, 0, -84],
  [100, 0, -40],
  [94, 0, 18],
  [62, 0, 58],
  [20, 0, 72],
  [-18, 0, 98],
  [-66, 0, 86],
  [-102, 0, 38],
  [-96, 0, -22],
  [-58, 0, -64],
]
