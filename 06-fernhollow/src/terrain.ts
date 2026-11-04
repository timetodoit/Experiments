// Procedural valley: a heightfield carved around a closed spline, plus the scatter
// of flowers, leaves and light shafts that live on it. Everything is deterministic.

import { ClosedSpline, VALLEY_POINTS, type PathSample } from './path'

// ── small deterministic noise kit ────────────────────────────────────────────
export function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function vnoise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

export function fbm(x: number, y: number, oct = 4) {
  let s = 0
  let amp = 0.5
  let norm = 0
  for (let i = 0; i < oct; i++) {
    s += vnoise(x, y) * amp
    norm += amp
    amp *= 0.5
    const nx = x * 1.97 + y * 0.31 + 17.1
    y = y * 1.97 - x * 0.31 + 5.3
    x = nx
  }
  return s / norm
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ── the valley ───────────────────────────────────────────────────────────────
export const DOMAIN = 240 // terrain spans [-DOMAIN, DOMAIN] on x and z
const DF_RES = 2 // distance field cell size (world units)

export class ValleyField {
  readonly path = new ClosedSpline(VALLEY_POINTS)
  private df: Float32Array
  private dfN: number
  private floorTable: Float32Array
  private floorN = 1024

  constructor() {
    // brute-force distance field to the centreline on a coarse grid
    const N = Math.floor((DOMAIN * 2) / DF_RES) + 1
    this.dfN = N
    this.df = new Float32Array(N * N)
    const pts = this.path.points(420)
    const M = pts.length / 2
    for (let j = 0; j < N; j++) {
      const z = -DOMAIN + j * DF_RES
      for (let i = 0; i < N; i++) {
        const x = -DOMAIN + i * DF_RES
        let best = 1e9
        for (let k = 0; k < M; k++) {
          const dx = pts[k * 2] - x
          const dz = pts[k * 2 + 1] - z
          const d = dx * dx + dz * dz
          if (d < best) best = d
        }
        this.df[j * N + i] = Math.sqrt(best)
      }
    }
    // smoothed floor height along the rail, for the camera
    const raw = new Float32Array(this.floorN)
    const tmp: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }
    for (let i = 0; i < this.floorN; i++) {
      this.path.at((i / this.floorN) * this.path.length, tmp)
      raw[i] = this.height(tmp.x, tmp.z)
    }
    this.floorTable = new Float32Array(this.floorN)
    const R = 10
    for (let i = 0; i < this.floorN; i++) {
      let s = 0
      let w = 0
      for (let k = -R; k <= R; k++) {
        const g = Math.exp(-(k * k) / (R * R * 0.4))
        s += raw[(i + k + this.floorN) % this.floorN] * g
        w += g
      }
      this.floorTable[i] = s / w
    }
  }

  /** distance (xz) to the valley centreline, bilinear from the coarse field */
  dist(x: number, z: number) {
    const N = this.dfN
    const fx = Math.min(N - 1.001, Math.max(0, (x + DOMAIN) / DF_RES))
    const fz = Math.min(N - 1.001, Math.max(0, (z + DOMAIN) / DF_RES))
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const u = fx - i
    const v = fz - j
    const a = this.df[j * N + i]
    const b = this.df[j * N + i + 1]
    const c = this.df[(j + 1) * N + i]
    const d = this.df[(j + 1) * N + i + 1]
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }

  /** valley floor half-width at a point (varies slowly) */
  floorWidth(x: number, z: number) {
    return 7 + 6 * fbm(x * 0.011 + 3.1, z * 0.011 - 7.7, 2)
  }

  height(x: number, z: number) {
    const d = this.dist(x, z)
    const w = this.floorWidth(x, z)
    const n2 = fbm(x * 0.008 - 11.3, z * 0.008 + 2.2, 3)
    const t = smooth(w, w + 24 + 18 * n2, d)
    // U-shaped walls
    let h = Math.pow(t, 1.25) * (12 + 22 * n2)
    // ridged detail on the slopes for interesting silhouettes
    const r = fbm(x * 0.03 + 9.0, z * 0.03 - 4.0, 4)
    const ridge = 1 - Math.abs(2 * r - 1)
    h += ridge * ridge * 7 * t
    // rolling hills further out
    h += smooth(45, 120, d) * (8 + 26 * fbm(x * 0.006 + 40, z * 0.006 - 20, 3))
    // soft undulation on the floor
    h += (fbm(x * 0.07, z * 0.07, 3) - 0.5) * 1.1
    // lift the domain edges so the world never ends visibly
    const edge = Math.max(Math.abs(x), Math.abs(z))
    h += smooth(DOMAIN - 70, DOMAIN, edge) * 30
    return h
  }

  /** smoothed floor height under the rail at arc-length s */
  floorAt(s: number) {
    const L = this.path.length
    const u = ((((s % L) + L) % L) / L) * this.floorN
    const i = Math.floor(u)
    const f = u - i
    const a = this.floorTable[i % this.floorN]
    const b = this.floorTable[(i + 1) % this.floorN]
    return a + (b - a) * f
  }
}

// ── terrain mesh ─────────────────────────────────────────────────────────────
export interface TerrainMesh {
  vertices: Float32Array // pos3 normal3 glow patch  (8 floats)
  indices: Uint32Array
}

export function buildTerrain(v: ValleyField, res: number): TerrainMesh {
  const N = res + 1
  const step = (DOMAIN * 2) / res
  const H = new Float32Array(N * N)
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) H[j * N + i] = v.height(-DOMAIN + i * step, -DOMAIN + j * step)

  const vertices = new Float32Array(N * N * 8)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -DOMAIN + i * step
      const z = -DOMAIN + j * step
      const hl = H[j * N + Math.max(0, i - 1)]
      const hr = H[j * N + Math.min(N - 1, i + 1)]
      const hd = H[Math.max(0, j - 1) * N + i]
      const hu = H[Math.min(N - 1, j + 1) * N + i]
      let nx = hl - hr
      let ny = 2 * step
      let nz = hd - hu
      const l = Math.hypot(nx, ny, nz)
      nx /= l
      ny /= l
      nz /= l
      const d = v.dist(x, z)
      const w = v.floorWidth(x, z)
      const glow = Math.exp(-Math.max(0, d - w * 0.5) / 9)
      const patch = fbm(x * 0.05 + 100, z * 0.05, 3)
      const o = (j * N + i) * 8
      vertices[o] = x
      vertices[o + 1] = H[j * N + i]
      vertices[o + 2] = z
      vertices[o + 3] = nx
      vertices[o + 4] = ny
      vertices[o + 5] = nz
      vertices[o + 6] = glow
      vertices[o + 7] = patch
    }
  }
  const indices = new Uint32Array(res * res * 6)
  let k = 0
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * N + i
      const b = a + 1
      const c = a + N
      const d = c + 1
      indices[k++] = a
      indices[k++] = c
      indices[k++] = b
      indices[k++] = b
      indices[k++] = c
      indices[k++] = d
    }
  }
  return { vertices, indices }
}

// ── flowers ──────────────────────────────────────────────────────────────────
// night palette (linear, HDR-ish multipliers applied in the shader)
export const PALETTE: [number, number, number][] = [
  [0.26, 0.86, 1.0], // pale cyan
  [0.62, 0.42, 1.0], // lilac
  [1.0, 0.28, 0.72], // magenta
  [1.0, 0.56, 0.18], // warm amber
  [1.0, 0.9, 0.74], // cream white
  [0.16, 0.4, 1.0], // glowing blue
]
// hues that form drifts across the meadow (cream mostly appears as strays)
const DRIFT_HUES = [0, 1, 3, 2, 0, 1, 5, 3, 2, 4, 1]
const PAL_WEIGHTS = [0.28, 0.22, 0.12, 0.13, 0.13, 0.12]

function pickPalette(r: number) {
  let acc = 0
  for (let i = 0; i < PAL_WEIGHTS.length; i++) {
    acc += PAL_WEIGHTS[i]
    if (r < acc) return i
  }
  return 0
}

function gauss(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand())
}

const FLOWER_STRIDE = 12
/** pos3 size | rgb seed | petals rot kind intensity */
export function scatterFlowers(v: ValleyField, count: number): Float32Array {
  const out = new Float32Array(count * FLOWER_STRIDE)
  const rand = mulberry(1337)
  const p: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }
  const L = v.path.length
  for (let i = 0; i < count; i++) {
    let x = 0
    let z = 0
    let d = 0
    // clumpy meadow: rejection against a patch field
    for (let tries = 0; tries < 5; tries++) {
      v.path.at(rand() * L, p)
      const r = rand()
      if (r < 0.58) d = Math.abs(gauss(rand)) * 5.2
      else if (r < 0.86) d = 6 + Math.pow(rand(), 1.25) * 20
      else d = 18 + rand() * 42
      const side = rand() < 0.5 ? -1 : 1
      const nx = -p.tz
      const nz = p.tx
      x = p.x + nx * d * side + (rand() - 0.5) * 1.5
      z = p.z + nz * d * side + (rand() - 0.5) * 1.5
      const clump = fbm(x * 0.09 + 7, z * 0.09 - 3, 3)
      if (rand() < 0.2 + clump * clump * 1.6) break
    }
    const ground = v.height(x, z)
    const big = rand() < 0.035
    const size = big ? 0.2 + rand() * 0.12 : 0.05 + Math.pow(rand(), 2.4) * 0.12
    const stem = 0.04 + rand() * 0.32 * (size / 0.18)
    // colour drifts: a low-frequency field picks a dominant hue, with some strays
    const field = fbm(x * 0.022 - 50, z * 0.022 + 31, 2)
    const pi = rand() < 0.6 ? DRIFT_HUES[Math.floor(field * 26) % DRIFT_HUES.length] : pickPalette(rand())
    const c = PALETTE[pi]
    const tint = 0.85 + rand() * 0.3
    const o = i * FLOWER_STRIDE
    out[o] = x
    out[o + 1] = ground + stem
    out[o + 2] = z
    out[o + 3] = size
    out[o + 4] = Math.min(1, c[0] * tint)
    out[o + 5] = Math.min(1, c[1] * tint)
    out[o + 6] = Math.min(1, c[2] * tint)
    out[o + 7] = rand()
    out[o + 8] = 4 + Math.floor(rand() * 3)
    out[o + 9] = rand() * Math.PI * 2
    out[o + 10] = pi
    // the far slopes are dimmer, the rare blues burn bright
    const wall = smooth(10, 50, d)
    out[o + 11] = (0.55 + rand() * 0.75) * (pi === 5 ? 1.7 : 1) * (1 - wall * 0.55)
  }
  return out
}

const LEAF_STRIDE = 8
/** pos3 height | width lean seed type */
export function scatterLeaves(v: ValleyField, count: number): Float32Array {
  const out = new Float32Array(count * LEAF_STRIDE)
  const rand = mulberry(4242)
  const p: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }
  const L = v.path.length
  for (let i = 0; i < count; i++) {
    v.path.at(rand() * L, p)
    const r = rand()
    const d = r < 0.55 ? 1.8 + Math.abs(gauss(rand)) * 6.5 : 5 + Math.pow(rand(), 1.2) * 38
    const side = rand() < 0.5 ? -1 : 1
    const x = p.x - p.tz * d * side + (rand() - 0.5) * 2
    const z = p.z + p.tx * d * side + (rand() - 0.5) * 2
    const o = i * LEAF_STRIDE
    const type = rand() < 0.62 ? 0 : 1 // 0 grass blade, 1 leaf
    out[o] = x
    out[o + 1] = v.height(x, z) - 0.04
    out[o + 2] = z
    out[o + 3] = type === 0 ? 0.25 + Math.pow(rand(), 1.4) * 0.85 : 0.18 + rand() * 0.35
    out[o + 4] = type === 0 ? 0.035 + rand() * 0.045 : 0.07 + rand() * 0.08
    out[o + 5] = (rand() - 0.5) * 0.7
    out[o + 6] = rand()
    out[o + 7] = type
  }
  return out
}

/** a few tall soft light shafts standing in the far valley: pos3 width | height intensity seed tint */
export function placeRays(v: ValleyField, count: number): Float32Array {
  const out = new Float32Array(count * 8)
  const rand = mulberry(99)
  const p: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }
  const L = v.path.length
  for (let i = 0; i < count; i++) {
    v.path.at(((i + rand() * 0.6) / count) * L, p)
    const side = rand() < 0.5 ? -1 : 1
    const d = 6 + rand() * 22
    const x = p.x - p.tz * d * side
    const z = p.z + p.tx * d * side
    const o = i * 8
    out[o] = x
    out[o + 1] = v.height(x, z) - 2
    out[o + 2] = z
    out[o + 3] = 5 + rand() * 9
    out[o + 4] = 45 + rand() * 30
    out[o + 5] = 0.5 + rand() * 0.6
    out[o + 6] = rand()
    out[o + 7] = rand()
  }
  return out
}
