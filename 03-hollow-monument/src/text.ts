// Rasterise a word with Canvas2D and return a tightly-cropped coverage mask
// (one byte per pixel, row 0 = top) for Rust to extrude.

export interface Mask {
  data: Uint8Array
  w: number
  h: number
}

export async function rasteriseWord(word: string, width = 1500): Promise<Mask> {
  const family = '"Geist", "Helvetica Neue", Arial, sans-serif'
  try {
    await document.fonts.load(`800 200px Geist`, word)
  } catch {
    /* fall back to whatever sans the system has */
  }
  const H = Math.round(width * 0.36)
  const c = document.createElement('canvas')
  c.width = width
  c.height = H
  const g = c.getContext('2d', { willReadFrequently: true })!
  let size = 200
  g.font = `800 ${size}px ${family}`
  if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '-0.02em'
  const m = g.measureText(word)
  size = Math.floor((size * width * 0.96) / Math.max(m.width, 1))
  g.font = `800 ${size}px ${family}`
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  g.fillText(word, width / 2, H * 0.82)

  const img = g.getImageData(0, 0, width, H).data
  let x0 = width, x1 = 0, y0 = H, y1 = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < width; x++) {
      if (img[(y * width + x) * 4 + 3] > 127) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < x0) return { data: new Uint8Array([255]), w: 1, h: 1 }
  const pad = 2
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad)
  y1 = Math.min(H - 1, y1 + pad)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = img[((y + y0) * width + (x + x0)) * 4 + 3]
  }
  return { data, w, h }
}
