// Paints the herbarium sheet texture: paper, a pressed flax specimen, tape,
// a collector's label and an ink stamp. Everything procedural, no image assets.

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function paintHerbarium(W = 1024, H = 1280): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const r = rng(4)

  // paper
  g.fillStyle = '#efeadb'
  g.fillRect(0, 0, W, H)
  const grad = g.createRadialGradient(W * 0.45, H * 0.4, 100, W * 0.5, H * 0.5, W * 0.95)
  grad.addColorStop(0, 'rgba(255,255,250,0.35)')
  grad.addColorStop(1, 'rgba(160,140,100,0.18)')
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 2600; i++) {
    g.strokeStyle = `rgba(${90 + r() * 60},${80 + r() * 50},${50 + r() * 40},${0.04 + r() * 0.05})`
    g.lineWidth = 0.6 + r() * 0.8
    const x = r() * W
    const y = r() * H
    const a = r() * Math.PI
    const l = 3 + r() * 10
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
    g.stroke()
  }
  // foxing spots
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(150,110,60,${0.03 + r() * 0.05})`
    g.beginPath()
    g.arc(r() * W, r() * H, 4 + r() * 22, 0, Math.PI * 2)
    g.fill()
  }

  // margin rule + header
  g.strokeStyle = 'rgba(40,40,30,0.35)'
  g.lineWidth = 1.5
  g.strokeRect(44, 44, W - 88, H - 88)
  g.fillStyle = '#1d1c17'
  g.font = '600 22px "IBM Plex Mono", monospace'
  g.fillText('FIELD STATION 04 — HERBARIUM', 72, 96)
  g.font = '400 18px "IBM Plex Mono", monospace'
  g.fillStyle = 'rgba(29,28,23,0.7)'
  g.fillText('SHORELINE WETLAND SURVEY · SHEET 1 OF 1', 72, 126)
  g.font = '600 64px "Inter Tight", sans-serif'
  g.fillStyle = '#1d1c17'
  g.textAlign = 'right'
  g.fillText('FS04-0001', W - 72, 118)
  g.textAlign = 'left'

  // ruler
  g.fillStyle = '#1d1c17'
  for (let i = 0; i <= 10; i++) {
    const x = 72 + i * 22
    g.fillRect(x, H - 120, 1.5, i % 5 === 0 ? 18 : 10)
  }
  g.fillRect(72, H - 120, 222, 1.5)
  g.font = '400 15px "IBM Plex Mono", monospace'
  g.fillText('0', 68, H - 84)
  g.fillText('5 cm', 268, H - 84)

  // ── specimen ──
  const stemBase = { x: W * 0.42, y: H - 170 }
  const leaf = (x: number, y: number, ang: number, len: number) => {
    g.save()
    g.translate(x, y)
    g.rotate(ang)
    g.beginPath()
    g.moveTo(0, 0)
    g.quadraticCurveTo(len * 0.5, -len * 0.13, len, 0)
    g.quadraticCurveTo(len * 0.5, len * 0.13, 0, 0)
    const lg = g.createLinearGradient(0, 0, len, 0)
    lg.addColorStop(0, '#4f5a33')
    lg.addColorStop(1, '#7c8550')
    g.fillStyle = lg
    g.fill()
    g.strokeStyle = 'rgba(40,45,20,0.6)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(2, 0)
    g.lineTo(len * 0.92, 0)
    g.stroke()
    g.restore()
  }

  const flower = (x: number, y: number, size: number, rot: number) => {
    g.save()
    g.translate(x, y)
    g.rotate(rot)
    for (let p = 0; p < 5; p++) {
      g.save()
      g.rotate((p / 5) * Math.PI * 2 + r() * 0.12)
      const pg = g.createRadialGradient(0, size * 0.35, 2, 0, size * 0.5, size * 0.7)
      pg.addColorStop(0, '#d9e2f7')
      pg.addColorStop(0.6, '#a9bde9')
      pg.addColorStop(1, '#8aa2d8')
      g.fillStyle = pg
      g.beginPath()
      g.moveTo(0, 0)
      g.bezierCurveTo(size * 0.42, size * 0.18, size * 0.5, size * 0.92, 0, size * 1.0)
      g.bezierCurveTo(-size * 0.5, size * 0.92, -size * 0.42, size * 0.18, 0, 0)
      g.fill()
      g.strokeStyle = 'rgba(70,90,160,0.45)'
      g.lineWidth = 1
      for (let v = -3; v <= 3; v++) {
        g.beginPath()
        g.moveTo(0, size * 0.1)
        g.quadraticCurveTo(v * size * 0.06, size * 0.5, v * size * 0.1, size * 0.92)
        g.stroke()
      }
      g.restore()
    }
    g.fillStyle = '#e8c547'
    g.beginPath()
    g.arc(0, 0, size * 0.14, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#8a6a1c'
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2
      g.beginPath()
      g.arc(Math.cos(a) * size * 0.08, Math.sin(a) * size * 0.08, 2.2, 0, Math.PI * 2)
      g.fill()
    }
    g.restore()
  }

  // three stems
  const stems = [
    { dx: -30, top: { x: W * 0.36, y: 300 }, bend: -80 },
    { dx: 0, top: { x: W * 0.55, y: 240 }, bend: 60 },
    { dx: 24, top: { x: W * 0.68, y: 420 }, bend: 120 },
  ]
  for (const s of stems) {
    const x0 = stemBase.x + s.dx
    const y0 = stemBase.y
    const cx = (x0 + s.top.x) / 2 + s.bend
    const cy = (y0 + s.top.y) / 2
    g.strokeStyle = '#58603a'
    g.lineWidth = 4
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(x0, y0)
    g.quadraticCurveTo(cx, cy, s.top.x, s.top.y)
    g.stroke()
    // leaves along the stem
    for (let k = 0.12; k < 0.9; k += 0.075) {
      const t = k
      const px = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * s.top.x
      const py = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * s.top.y
      const side = Math.floor(k * 100) % 2 === 0 ? 1 : -1
      leaf(px, py, -Math.PI / 2 + side * (0.5 + r() * 0.3), 46 + r() * 30)
    }
    flower(s.top.x, s.top.y, 74 + r() * 16, r() * Math.PI)
  }
  // buds
  g.fillStyle = '#7c8a54'
  for (const [x, y] of [
    [W * 0.3, 380],
    [W * 0.62, 330],
  ]) {
    g.beginPath()
    g.ellipse(x, y, 9, 16, 0.4, 0, Math.PI * 2)
    g.fill()
  }
  // root tangle
  g.strokeStyle = 'rgba(110,90,60,0.8)'
  g.lineWidth = 1.6
  for (let i = 0; i < 26; i++) {
    g.beginPath()
    g.moveTo(stemBase.x, stemBase.y)
    let x = stemBase.x
    let y = stemBase.y
    for (let k = 0; k < 5; k++) {
      x += (r() - 0.5) * 28
      y += 6 + r() * 10
      g.lineTo(x, y)
    }
    g.stroke()
  }

  // tape strips
  const tape = (x: number, y: number, a: number) => {
    g.save()
    g.translate(x, y)
    g.rotate(a)
    g.fillStyle = 'rgba(232,222,190,0.82)'
    g.fillRect(-46, -12, 92, 24)
    g.strokeStyle = 'rgba(160,140,90,0.3)'
    g.strokeRect(-46, -12, 92, 24)
    g.restore()
  }
  tape(stemBase.x - 6, stemBase.y - 70, -0.2)
  tape(W * 0.5, 690, 0.35)
  tape(W * 0.66, 760, -0.5)

  // collector's label
  const lx = W - 470
  const ly = H - 330
  g.fillStyle = '#f6f2e6'
  g.fillRect(lx, ly, 398, 230)
  g.strokeStyle = '#1d1c17'
  g.lineWidth = 1.5
  g.strokeRect(lx, ly, 398, 230)
  g.fillRect(lx, ly + 44, 398, 1)
  g.fillStyle = '#1d1c17'
  g.font = '500 15px "IBM Plex Mono", monospace'
  g.fillText('PLANTS OF THE SHORELINE WETLAND', lx + 16, ly + 28)
  g.font = 'italic 400 38px "Instrument Serif", serif'
  g.fillText('Linum usitatissimum', lx + 16, ly + 92)
  g.font = '400 15px "IBM Plex Mono", monospace'
  const lines = ['Common flax · Linaceae', 'Disturbed bank, N. shore, 4 m', '37.4243° N · 122.0844° W', 'Det. SURVEY UNIT 04 · 03.XI.2026']
  lines.forEach((l, i) => g.fillText(l, lx + 16, ly + 128 + i * 24))

  // stamp
  g.save()
  g.translate(W - 210, 300)
  g.rotate(-0.28)
  g.strokeStyle = 'rgba(196,52,40,0.62)'
  g.fillStyle = 'rgba(196,52,40,0.62)'
  g.lineWidth = 4
  g.beginPath()
  g.arc(0, 0, 92, 0, Math.PI * 2)
  g.stroke()
  g.lineWidth = 1.5
  g.beginPath()
  g.arc(0, 0, 80, 0, Math.PI * 2)
  g.stroke()
  g.font = '700 21px "IBM Plex Mono", monospace'
  g.textAlign = 'center'
  g.fillText('VERIFIED', 0, 8)
  g.font = '500 13px "IBM Plex Mono", monospace'
  g.fillText('FIELD STATION 04', 0, -30)
  g.fillText('★ 2026 ★', 0, 42)
  g.restore()
  g.textAlign = 'left'

  return c
}
