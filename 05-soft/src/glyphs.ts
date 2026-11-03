// Canvas2D rasterises a glyph (or a short word) into an alpha bitmap; Rust does
// the rest (marching squares → Douglas–Peucker → resampling → ear clipping).

import type { World } from './wasm/soft'

export const GLYPH_FONT = '"Bricolage Grotesque", "Arial Black", "Helvetica Neue", system-ui, sans-serif'
const RASTER = 260 // font px used for rasterising; bitmaps stay ~200–300 px tall

export interface GlyphStat {
  text: string
  template: number
  points: number
  rings: number
  holes: number
  triangles: number
  ms: number
  width: number
  height: number
  /** CSS cap height the template was built for */
  cap: number
}

export class GlyphFactory {
  private canvas = document.createElement('canvas')
  private g: CanvasRenderingContext2D
  private capPx: number

  constructor() {
    const g = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!g) throw new Error('2d context unavailable')
    this.g = g
    g.font = this.font()
    const m = g.measureText('H')
    this.capPx = Math.max(10, m.actualBoundingBoxAscent || RASTER * 0.7)
  }

  private font() {
    return `800 ${RASTER}px ${GLYPH_FONT}`
  }

  /** Rasterise `text`, optionally with a rounded stroke of `stroke` font px. */
  private raster(text: string, stroke: number) {
    const g = this.g
    g.font = this.font()
    const m = g.measureText(text)
    const pad = 6 + Math.ceil(stroke / 2)
    const left = Math.ceil(m.actualBoundingBoxLeft || 0)
    const right = Math.ceil(m.actualBoundingBoxRight || m.width)
    const asc = Math.ceil(m.actualBoundingBoxAscent || RASTER * 0.75)
    const desc = Math.ceil(m.actualBoundingBoxDescent || 0)
    const w = Math.max(8, left + right + pad * 2)
    const h = Math.max(8, asc + desc + pad * 2)
    this.canvas.width = w
    this.canvas.height = h
    g.font = this.font()
    g.textBaseline = 'alphabetic'
    g.fillStyle = '#fff'
    g.strokeStyle = '#fff'
    g.lineJoin = 'round'
    g.clearRect(0, 0, w, h)
    g.fillText(text, pad + left, pad + asc)
    if (stroke > 0) {
      g.lineWidth = stroke
      g.strokeText(text, pad + left, pad + asc)
    }
    const rgba = g.getImageData(0, 0, w, h).data
    const alpha = new Uint8Array(w * h)
    for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = rgba[j]
    return { alpha, w, h }
  }

  /**
   * Build a soft-body template. `cap` = target cap height in CSS px,
   * `spacing` = particle spacing along the contour in CSS px.
   * `fuse` bubble-letters multi-glyph words (a rounded stroke, just thick enough)
   * until they form one connected shape — separate pieces held together by shape
   * matching can straddle another letter and interlock with it.
   */
  build(world: World, text: string, cap: number, spacing: number, fuse = false): GlyphStat {
    const t0 = performance.now()
    let r = this.raster(text, 0)
    if (fuse) {
      for (let k = 1; k <= 8 && components(r.alpha, r.w, r.h) > 1; k++) r = this.raster(text, RASTER * 0.025 * k)
    }
    const unit = cap / this.capPx
    const t = world.add_template(r.alpha, r.w, r.h, unit, spacing)
    return {
      text,
      template: t,
      points: world.template_points(t),
      rings: world.template_rings(t),
      holes: world.template_holes(t),
      triangles: world.template_triangles(t),
      ms: performance.now() - t0,
      width: world.template_width(t),
      height: world.template_height(t),
      cap,
    }
  }
}

/** Number of 4-connected solid regions (alpha ≥ 128), ignoring specks. */
function components(a: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  let n = 0
  for (let i = 0; i < a.length; i++) {
    if (seen[i] || a[i] < 128) continue
    let size = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length) {
      const p = stack.pop()!
      size++
      const x = p % w
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]
      for (const q of nb) {
        if (q < 0 || q >= a.length || seen[q] || a[q] < 128) continue
        seen[q] = 1
        stack.push(q)
      }
    }
    if (size > 30) n++
  }
  return n
}
