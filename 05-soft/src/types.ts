/** Zero-copy views into Rust linear memory for one frame. */
export interface Frame {
  /** per point: x, y, nx, ny, body, strain, hole, 0 */
  pts: Float32Array
  /** per body: r, g, b, a, cx, cy, radius, squash, pop, lift, grow, angle */
  bodies: Float32Array
  /** per ring: start, count, body, hole */
  rings: Uint32Array
  fill: Uint32Array
  strip: Uint32Array
  generation: number
  nPts: number
  nBodies: number
  nRings: number
}

export const PT_STRIDE = 8
export const BODY_STRIDE = 12

/** Per-stage art direction, CSS px. */
export interface Look {
  outline: number
  rim: number
  feather: number
  shadowAlpha: number
  shadowX: number
  shadowY: number
  halftone: number
}

export interface Renderer {
  readonly kind: 'webgpu' | 'canvas2d'
  resize(w: number, h: number, dpr: number): void
  draw(f: Frame, look: Look, time: number): void
}

export const INK: [number, number, number] = [0.078, 0.067, 0.063]
