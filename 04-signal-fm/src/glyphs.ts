// Glyph set shared by the WGSL ASCII pass and the Canvas2D fallback.
//   [0, 10)   luminance ramp
//   [10, 14)  edge glyphs, ordered by edge angle: 0°, 45°, 90°, 135°
//   [14, …)   noise / scramble glyphs (static + transition tears)
// The indices are mirrored as constants in ascii.wgsl.

export const RAMP = ' .:-=+*#%@'
export const EDGES = '-/|\\'
export const NOISE = '01<>[]{}?!~^;$&░▒▓█'
export const GLYPHS = [...RAMP, ...EDGES, ...NOISE]
export const RAMP_N = RAMP.length
export const EDGE0 = RAMP_N
export const NOISE0 = RAMP_N + EDGES.length
export const GLYPH_COUNT = GLYPHS.length

export const FONT = '"JetBrains Mono", ui-monospace, monospace'

/** Cell aspect: glyph cells are 2 : 3 (w : h). */
export const cellHeight = (w: number) => Math.round(w * 1.5)

/**
 * Rasterise the atlas: one row of `GLYPH_COUNT` cells, white on transparent.
 * Block shades are drawn as pixel dither patterns so they stay crisp at any size.
 */
export function buildAtlas(cw: number, ch: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = cw * GLYPH_COUNT
  c.height = ch
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const weight = cw < 18 ? 700 : 600
  g.font = `${weight} ${Math.round(ch * 0.74)}px ${FONT}`

  GLYPHS.forEach((glyph, i) => {
    const x0 = i * cw
    g.save()
    g.beginPath()
    g.rect(x0, 0, cw, ch)
    g.clip()
    const shade = '░▒▓█'.indexOf(glyph)
    if (shade >= 0) {
      const dens = [0.25, 0.5, 0.75, 1][shade]
      const px = Math.max(1, Math.round(cw / 8))
      for (let y = 0; y < ch; y += px)
        for (let x = 0; x < cw; x += px) {
          const bx = (x / px) & 3
          const by = (y / px) & 3
          const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][by * 4 + bx] / 16
          if (bayer < dens) g.fillRect(x0 + x, y, px, px)
        }
    } else if (glyph === '|') {
      // crisp hairlines for the edge set
      const w = Math.max(1, Math.round(cw / 7))
      g.fillRect(x0 + Math.round((cw - w) / 2), 0, w, ch)
    } else if (glyph === '-' && i >= EDGE0) {
      const w = Math.max(1, Math.round(cw / 7))
      g.fillRect(x0, Math.round((ch - w) / 2), cw, w)
    } else if ((glyph === '/' || glyph === '\\') && i >= EDGE0) {
      g.strokeStyle = '#fff'
      g.lineWidth = Math.max(1, cw / 7)
      g.lineCap = 'square'
      g.beginPath()
      if (glyph === '/') {
        g.moveTo(x0, ch)
        g.lineTo(x0 + cw, 0)
      } else {
        g.moveTo(x0, 0)
        g.lineTo(x0 + cw, ch)
      }
      g.stroke()
    } else {
      g.fillText(glyph, x0 + cw / 2, ch / 2 + ch * 0.03)
    }
    g.restore()
  })
  return c
}
