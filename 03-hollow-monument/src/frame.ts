import type { V3 } from './math'

/** Everything a renderer needs for one frame. Shared by WebGPU and Canvas2D paths. */
export interface FrameState {
  viewProj: Float32Array
  eye: V3
  /** focal length in CSS px (renderers scale by their own dpr) */
  focalCss: number
  time: number
  dt: number
  reduced: boolean
  /** target clouds and blend */
  a: number
  b: number
  mix: number
  turbulence: number
  /** LiDAR sweep, in scan-time units */
  sweepFront: number
  sweepReveal: number
  sweepWidth: number
  sweepStrength: number
  /** flashlight centre + radius (m), strength 0..1 */
  flash: [number, number, number, number]
  flashStrength: number
  /** shockwave impulse — strength 0 means none this frame */
  shock: [number, number, number, number]
  /** picked point highlight */
  sel: [number, number, number, number]
  intro: number
  /** 0..1, decaying flash after a click (post) */
  pulse: number
}

export interface PointRenderer {
  readonly kind: 'webgpu' | 'canvas2d'
  readonly count: number
  resize(w: number, h: number, dpr: number): void
  frame(f: FrameState): void
}
