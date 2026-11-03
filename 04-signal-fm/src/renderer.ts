import type { RGB } from './stations'

/** Everything a renderer needs from the page, once per frame. */
export interface FrameState {
  time: number // scene time (stretched while held)
  rtime: number // wall time
  bands: [number, number, number, number] // bass, mid, high, level
  mouse: [number, number] // -1…1, y up
  scene: number
  signal: number
  glitch: number
  motion: number
  slow: number
  beat: number
  ink: RGB
  paper: RGB
  accent: RGB
  hold: [number, number, number] // grid uv x, y, bubble radius
}

export interface Renderer {
  readonly kind: 'webgpu' | 'canvas2d'
  readonly cols: number
  readonly rows: number
  resize(w: number, h: number, dpr: number, cellCss: number): void
  firePulse(x: number, y: number, rtime: number, stime: number): void
  frame(s: FrameState): void
}
