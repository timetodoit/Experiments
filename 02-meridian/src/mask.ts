// Rasterise the hero headline into the dye-resolution mask the fluid reads.
// Layout comes from the real (transparent) DOM headline, so CSS stays the
// single source of truth. r = coverage, g = write order (line by line,
// left → right) which drives the "writes itself" intro.

export function rasteriseHeadline(
  lines: HTMLElement[],
  dw: number,
  dh: number,
  cssW: number,
  cssH: number,
  scrollY: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(dw * dh * 4)
  const cv = document.createElement('canvas')
  cv.width = dw
  cv.height = dh
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return out
  const sx = dw / cssW
  const sy = dh / cssH
  const n = lines.length
  lines.forEach((ln, k) => {
    const text = ln.textContent?.trim() ?? ''
    if (!text) return
    const cs = getComputedStyle(ln)
    const r = ln.getBoundingClientRect()
    const size = parseFloat(cs.fontSize) * sy
    ctx.clearRect(0, 0, dw, dh)
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${size.toFixed(2)}px ${cs.fontFamily}`
    const ls = parseFloat(cs.letterSpacing)
    if ('letterSpacing' in ctx && Number.isFinite(ls)) ctx.letterSpacing = `${(ls * sx).toFixed(2)}px`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#fff'
    const x = r.left * sx
    const y = (r.top + scrollY + r.height / 2) * sy
    ctx.fillText(text, x, y)
    const w = Math.max(1, ctx.measureText(text).width)
    const img = ctx.getImageData(0, 0, dw, dh).data
    for (let p = 0, i = 0; p < dw * dh; p++, i += 4) {
      const a = img[i + 3]
      if (a === 0 || a <= out[i]) continue
      const px = p % dw
      const ord = (k + Math.min(1, Math.max(0, (px - x) / w))) / n
      out[i] = a
      out[i + 1] = Math.round(ord * 255)
      out[i + 3] = 255
    }
  })
  return out
}
