// Confetti for records and pops: a fixed full-viewport 2D overlay that only draws
// while particles are alive.

interface Bit {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  vr: number
  w: number
  h: number
  c: string
  life: number
  round: boolean
}

export class Confetti {
  private g: CanvasRenderingContext2D | null
  private bits: Bit[] = []
  private w = 1
  private h = 1
  private dpr = 1
  private idle = true

  constructor(
    private canvas: HTMLCanvasElement,
    private reduced: boolean,
  ) {
    this.g = canvas.getContext('2d')
  }

  resize(dpr: number) {
    this.w = innerWidth
    this.h = innerHeight
    this.dpr = dpr
    this.canvas.width = Math.floor(this.w * dpr)
    this.canvas.height = Math.floor(this.h * dpr)
  }

  /** client-space burst */
  burst(x: number, y: number, colors: string[], n = 60, power = 1) {
    if (this.reduced) n = Math.min(n, 14)
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5
      const s = (300 + Math.random() * 900) * power * (this.reduced ? 0.4 : 1)
      this.bits.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        r: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 18,
        w: 6 + Math.random() * 9,
        h: 3 + Math.random() * 5,
        c: colors[i % colors.length],
        life: 1.4 + Math.random() * 1.2,
        round: Math.random() < 0.3,
      })
    }
    this.idle = false
  }

  update(dt: number) {
    const g = this.g
    if (!g || this.idle) return
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    g.clearRect(0, 0, this.w, this.h)
    const drag = Math.exp(-dt * 1.6)
    let alive = 0
    for (const b of this.bits) {
      b.life -= dt
      if (b.life <= 0) continue
      alive++
      b.vx *= drag
      b.vy = b.vy * drag + 1500 * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.r += b.vr * dt
      g.save()
      g.globalAlpha = Math.min(1, b.life * 2)
      g.translate(b.x, b.y)
      g.rotate(b.r)
      g.fillStyle = b.c
      g.strokeStyle = '#141110'
      g.lineWidth = 1.5
      if (b.round) {
        g.beginPath()
        g.arc(0, 0, b.h, 0, Math.PI * 2)
        g.fill()
        g.stroke()
      } else {
        // flutter: squash one axis like a spinning ribbon
        const s = Math.abs(Math.cos(b.r * 1.7)) * 0.8 + 0.2
        g.fillRect(-b.w / 2, (-b.h / 2) * s, b.w, b.h * s)
        g.strokeRect(-b.w / 2, (-b.h / 2) * s, b.w, b.h * s)
      }
      g.restore()
    }
    if (!alive) {
      this.bits = []
      this.idle = true
      g.clearRect(0, 0, this.w, this.h)
    } else if (this.bits.length > 600) this.bits = this.bits.filter((b) => b.life > 0)
  }
}
