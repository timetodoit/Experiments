// CPU port of the terrain function in survey.wgsl — used for the live elevation
// readout and the Canvas2D fallback. Kept bit-for-bit structurally identical.

const fract = (x: number) => x - Math.floor(x)
const KX = 0.3183099
const KY = 0.3678794

function grad(ix: number, iy: number, fx: number, fy: number) {
  const qx = ix * KX + KY
  const qy = iy * KY + KX
  const f = fract(qx * qy * (qx + qy))
  const gx = -1 + 2 * fract(16 * KX * f)
  const gy = -1 + 2 * fract(16 * KY * f)
  return gx * fx + gy * fy
}

export function gnoise(x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const wx = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const wy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const a = grad(ix, iy, fx, fy)
  const b = grad(ix + 1, iy, fx - 1, fy)
  const c = grad(ix, iy + 1, fx, fy - 1)
  const d = grad(ix + 1, iy + 1, fx - 1, fy - 1)
  const ab = a + (b - a) * wx
  const cd = c + (d - c) * wx
  return ab + (cd - ab) * wy
}

export function fbm(x: number, y: number) {
  let a = 0.5
  let s = 0
  for (let i = 0; i < 5; i++) {
    s += a * gnoise(x, y)
    // mat2x2f(0.8, 0.6, -0.6, 0.8) * p  (column-major)
    const nx = (0.8 * x - 0.6 * y) * 2.03
    const ny = (0.6 * x + 0.8 * y) * 2.03
    x = nx
    y = ny
    a *= 0.5
  }
  return s
}

export function terrain(mx: number, my: number, zoom: number, time: number) {
  let px = mx * (2.4 / zoom) + 3.1
  let py = my * (2.4 / zoom) + 1.7
  const ox = 0.05 * Math.sin(time * 0.11 + py * 1.3)
  const oy = 0.05 * Math.cos(time * 0.09 + px * 1.1)
  px += ox
  py += oy
  return 0.5 + fbm(px, py) * 0.9
}
