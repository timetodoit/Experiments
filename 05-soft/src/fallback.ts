// Canvas2D renderer used when WebGPU is unavailable (or its pipeline fails to
// validate). Same Rust buffers, drawn as even-odd paths: soft shadow, thick ink
// outline, flat fill, clipped gloss + emboss highlight.

import { BODY_STRIDE, INK, PT_STRIDE, type Frame, type Look, type Renderer } from './types'

const css = (r: number, g: number, b: number, a = 1) =>
  `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`
const INK_CSS = css(INK[0], INK[1], INK[2])

export class Soft2D implements Renderer {
  readonly kind = 'canvas2d' as const
  private g: CanvasRenderingContext2D
  private w = 1
  private h = 1
  private dpr = 1

  constructor(readonly canvas: HTMLCanvasElement) {
    const g = canvas.getContext('2d')
    if (!g) throw new Error('2d context unavailable')
    this.g = g
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.floor(w * dpr))
    this.canvas.height = Math.max(1, Math.floor(h * dpr))
  }

  draw(f: Frame, look: Look) {
    const { g, dpr } = this
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, this.w, this.h)
    if (!f.nBodies) return
    const P = f.pts
    const B = f.bodies

    // group rings per body (rings are contiguous per body)
    const paths: Path2D[] = []
    for (let r = 0; r < f.nRings; r++) {
      const start = f.rings[r * 4]
      const count = f.rings[r * 4 + 1]
      const body = f.rings[r * 4 + 2]
      const path = (paths[body] ??= new Path2D())
      for (let k = 0; k < count; k++) {
        const o = (start + k) * PT_STRIDE
        if (k === 0) path.moveTo(P[o], P[o + 1])
        else path.lineTo(P[o], P[o + 1])
      }
      path.closePath()
    }

    g.lineJoin = 'round'
    for (let b = 0; b < f.nBodies; b++) {
      const path = paths[b]
      if (!path) continue
      const o = b * BODY_STRIDE
      const [cr, cg, cb] = [B[o], B[o + 1], B[o + 2]]
      const cx = B[o + 4]
      const cy = B[o + 5]
      const rad = Math.max(1, B[o + 6])
      const squash = B[o + 7]
      const pop = B[o + 8]
      const lift = B[o + 9]
      const grow = B[o + 10]
      const fade = Math.max(0, Math.min(1, 1 - pop * 1.15)) * Math.min(1, Math.max(0, (grow - 0.04) / 0.26))
      if (fade <= 0.001) continue
      g.globalAlpha = fade

      // shadow + outline silhouette
      g.save()
      g.shadowColor = `rgba(20,17,16,${look.shadowAlpha * (1 - 0.45 * lift)})`
      g.shadowBlur = (look.feather * (1 + lift * 0.8)) * dpr
      g.shadowOffsetX = look.shadowX * (1 + lift * 1.6) * dpr
      g.shadowOffsetY = look.shadowY * (1 + lift * 1.6) * dpr
      g.fillStyle = INK_CSS
      g.strokeStyle = INK_CSS
      g.lineWidth = look.outline * 2
      g.stroke(path)
      g.fill(path, 'evenodd')
      g.restore()

      // fill
      const mix = (c: number) => c + (1 - c) * pop * 0.5
      g.fillStyle = css(mix(cr), mix(cg), mix(cb))
      g.fill(path, 'evenodd')

      // gloss, clipped to the glyph
      g.save()
      g.clip(path, 'evenodd')
      const hx = cx - rad * 0.3
      const hy = cy - rad * 0.48
      const grad = g.createRadialGradient(hx, hy, 0, hx, hy, rad * (0.42 + 0.25 * squash))
      grad.addColorStop(0, `rgba(255,255,255,${0.32 + 0.35 * squash})`)
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
      const shade = g.createLinearGradient(0, cy - rad, 0, cy + rad)
      shade.addColorStop(0, 'rgba(255,255,255,0.06)')
      shade.addColorStop(1, 'rgba(0,0,0,0.12)')
      g.fillStyle = shade
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
      // emboss: stroke the glyph shifted down-right; only the top-left inner edge shows
      g.translate(look.rim * 0.3, look.rim * 0.42)
      g.strokeStyle = 'rgba(255,255,255,0.32)'
      g.lineWidth = look.rim * 0.5
      g.stroke(path)
      g.restore()
    }
    g.globalAlpha = 1
  }
}
