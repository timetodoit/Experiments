// Small column-major matrix / vector helpers (WebGPU clip space: z ∈ [0, 1]).

export type V3 = [number, number, number]

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
/** Frame-rate independent exponential approach. */
export const damp = (from: number, to: number, rate: number, dt: number) => lerp(from, to, 1 - Math.exp(-rate * dt))

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const length = (a: V3) => Math.hypot(a[0], a[1], a[2])
export const normalize = (a: V3): V3 => {
  const l = length(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
export const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** Rotate v about a unit axis by angle (Rodrigues). */
export function rotate(v: V3, axis: V3, a: number): V3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const k = cross(axis, v)
  const d = dot(axis, v) * (1 - c)
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d]
}

export function perspective(out: Float32Array, fovY: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovY / 2)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[10] = far / (near - far)
  out[11] = -1
  out[14] = (near * far) / (near - far)
  return out
}

export function lookAt(out: Float32Array, eye: V3, target: V3, up: V3) {
  const z = normalize(sub(eye, target))
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0
  out[12] = -dot(x, eye); out[13] = -dot(y, eye); out[14] = -dot(z, eye); out[15] = 1
  return out
}

export function multiply(out: Float32Array, a: Float32Array, b: Float32Array) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3]
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3
  }
  return out
}

/** Uniform Catmull–Rom on scalars. */
export function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/** PCG hash → [0, 1). Same integer recipe as `hash11` in cloud.wgsl. */
export function hash01(i: number) {
  let x = (Math.imul(i, 747796405) + 2891336453) >>> 0
  x = Math.imul((x >>> ((x >>> 28) + 4)) ^ x, 277803737) >>> 0
  x = ((x >>> 22) ^ x) >>> 0
  return x / 4294967296
}
