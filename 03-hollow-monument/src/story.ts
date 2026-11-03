// Chapters and the morph timeline. Everything is driven by one number:
// cf ∈ [0, 5], the (damped) chapter coordinate derived from scroll.

import { clamp, smoothstep } from './math'

export const CLOUD_NAMES = ['MONUMENT', 'TERRAIN', 'TYPE', 'NEBULA'] as const

export const CHAPTERS = [
  { n: '00', name: 'Arrival' },
  { n: '01', name: 'The Slab' },
  { n: '02', name: 'The Void' },
  { n: '03', name: 'Collapse' },
  { n: '04', name: 'Hollow' },
  { n: '05', name: 'Credits' },
] as const

/**
 * Shape coordinate s ∈ [0, 3]: integer = a cloud at rest, fraction = morph.
 * Piecewise-linear in cf with plateaus so every chapter has time to breathe.
 */
const SHAPE: [number, number][] = [
  [0, 0],
  [2.5, 0], // monument holds through The Void
  [3.05, 1], // collapses around the camera as it leaves the arch
  [3.55, 1],
  [3.98, 2], // the field rises into the word
  [4.5, 2],
  [4.95, 3], // the word disperses
  [5, 3],
]

export function shapeAt(cf: number) {
  let s = 0
  for (let i = 0; i < SHAPE.length - 1; i++) {
    const [x0, y0] = SHAPE[i]
    const [x1, y1] = SHAPE[i + 1]
    if (cf >= x0 && cf <= x1) {
      s = y0 + (y1 - y0) * ((cf - x0) / Math.max(x1 - x0, 1e-6))
      break
    }
    if (cf > x1) s = y1
  }
  const a = clamp(Math.floor(s), 0, 2)
  const mix = clamp(s - a, 0, 1)
  return { a, b: a + 1, mix, s }
}

/** Which cloud the points are (mostly) resting on, for picking; −1 mid-morph. */
export function restingCloud(sh: ReturnType<typeof shapeAt>) {
  if (sh.mix < 0.06) return sh.a
  if (sh.mix > 0.94) return sh.b
  return -1
}

/** Turbulence gain during morphs: peaks mid-transition. */
export const turbulence = (mix: number) => smoothstep(0, 0.5, mix) * smoothstep(1, 0.5, mix)
