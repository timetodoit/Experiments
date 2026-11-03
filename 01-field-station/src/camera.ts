import { invert, lookAt, multiply, perspective, transform, type Mat4 } from './math'

/** Perspective camera for the herbarium sheet + pointer ray helpers. */
export class Camera {
  viewProj: Mat4 = new Float32Array(16)
  inverse: Mat4 = new Float32Array(16)
  eye = [0, -0.12, 4.1]
  width = 1
  height = 1

  resize(w: number, h: number) {
    this.width = w
    this.height = h
    const aspect = w / h
    // keep the whole sheet (≈1.6 × 2.0) in frame regardless of aspect
    const fov = aspect < 0.8 ? 2 * Math.atan(Math.tan(0.36) * (0.8 / aspect)) : 0.72
    const proj = perspective(fov, aspect, 0.1, 50)
    const view = lookAt(this.eye, [0, this.eye[1], 0], [0, 1, 0])
    this.viewProj = multiply(proj, view)
    this.inverse = invert(this.viewProj)
  }

  /** Ray (origin, normalized direction) through a CSS-pixel point on the canvas. */
  ray(px: number, py: number): { o: number[]; d: number[] } {
    const nx = (px / this.width) * 2 - 1
    const ny = 1 - (py / this.height) * 2
    const a = transform(this.inverse, nx, ny, 0)
    const b = transform(this.inverse, nx, ny, 1)
    const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]
    const f = [b[0] / b[3], b[1] / b[3], b[2] / b[3]]
    const d = [f[0] - o[0], f[1] - o[1], f[2] - o[2]]
    const l = Math.hypot(d[0], d[1], d[2])
    return { o, d: [d[0] / l, d[1] / l, d[2] / l] }
  }

  /** Intersect a pointer ray with the plane z = depth. */
  onPlane(px: number, py: number, depth = 0): [number, number, number] {
    const { o, d } = this.ray(px, py)
    const t = (depth - o[2]) / d[2]
    return [o[0] + d[0] * t, o[1] + d[1] * t, depth]
  }

  /** World → CSS pixel (+ clip w for depth sorting). */
  project(x: number, y: number, z: number): [number, number, number] {
    const c = transform(this.viewProj, x, y, z)
    return [((c[0] / c[3] + 1) / 2) * this.width, ((1 - c[1] / c[3]) / 2) * this.height, c[3]]
  }
}

/** Common surface for the WebGPU and Canvas2D sheet renderers. */
export interface SheetView {
  cam: Camera
  xray: number
  resize(w: number, h: number, dpr: number): void
  upload(verts: Float32Array, indices: Uint32Array | null, indexCount: number): void
  frame(time: number): void
}
