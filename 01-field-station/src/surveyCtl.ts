import type { SurveyState } from './gpu/survey'
import { terrain } from './noise'
import { scramble } from './scramble'

export interface SurveyRenderer {
  readonly count: number
  readonly canvas: HTMLCanvasElement
  resize(w: number, h: number, dpr: number): void
  shock(x: number, y: number, time: number, strength?: number): void
  frame(s: SurveyState): void
}

type Rect = [number, number, number, number]

// lens silhouettes, in units of S (union of three rects, snapping between them)
const LAYOUTS: Rect[][] = [
  [[-0.5, -1, 1, 0], [-1, -0.25, 0.5, 1], [-0.75, -0.5, 0.75, 0.5]],
  [[-1, -0.35, 1, 0.35], [-0.35, -1, 0.35, 1], [-0.35, -0.35, 0.35, 0.35]],
  [[-1.3, -0.4, 0.5, 0.4], [0.1, -0.85, 0.95, 0.05], [-0.95, 0, -0.15, 0.85]],
  [[-0.75, -0.75, 0.75, 0.75], [-0.75, -0.75, 0.75, 0.75], [-0.25, 0.75, 0.75, 1.15]],
  [[0, -1, 1, 0], [-1, -0.5, 1, 0.5], [-1, 0, 0, 1]],
]

const SITES = [
  { name: 'Linum usitatissimum', code: 'FS04-0001', p: [-0.12, 0.06], n: 20, link: '#specimen' },
  { name: 'Typha latifolia', code: 'FS04-0007', p: [0.32, -0.18], n: 8 },
  { name: 'Amanita muscaria', code: 'FS04-0012', p: [-0.52, -0.22], n: 3 },
  { name: 'Equisetum arvense', code: 'FS04-0019', p: [0.58, 0.2], n: 10 },
  { name: 'Salix alba', code: 'FS04-0023', p: [-0.42, 0.3], n: 5 },
  { name: 'Nymphaea alba', code: 'FS04-0031', p: [0.08, -0.32], n: 14 },
]

export class SurveyController {
  state: SurveyState
  private w = 1
  private h = 1
  private pointer = { x: 0, y: 0, inside: false, down: false, downAt: 0, real: false }
  private mouseMap: [number, number] = [0, 0]
  private lastMouse: [number, number] = [0, 0]
  private layout = 0
  private layoutAt = 0
  private cur: number[] = new Array(12).fill(0)
  private vel: number[] = new Array(12).fill(0)
  private markers: HTMLElement[] = []
  private nearSite = -2
  private readoutAt = 0
  private fps = 60
  progress = 0
  visible = true

  constructor(
    private r: SurveyRenderer,
    private sticky: HTMLElement,
    private section: HTMLElement,
    private ui: {
      markers: HTMLElement
      label: HTMLElement
      name: HTMLElement
      sub: HTMLElement
      title: HTMLElement
      coords: HTMLElement
      elev: HTMLElement
      slope: HTMLElement
      zoom: HTMLElement
      count: HTMLElement
      fpsEl: HTMLElement
      cue: HTMLElement
      cursorRead: (s: string) => void
    },
  ) {
    this.state = {
      time: 0,
      dt: 0.016,
      mouse: [0, 0],
      mouseVel: [0, 0],
      lens: [0, 0],
      press: 0,
      zoom: 1,
      rects: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      scan: 0,
      intro: 0,
    }
    ui.count.textContent = r.count.toLocaleString('en-US')

    for (const [i, s] of SITES.entries()) {
      const m = document.createElement('button')
      m.className = 'marker mono'
      m.type = 'button'
      m.textContent = `${s.n}`
      m.setAttribute('aria-label', `${s.name}, ${s.n} specimens`)
      m.addEventListener('pointerdown', (e) => e.stopPropagation())
      m.addEventListener('click', (e) => {
        e.stopPropagation()
        if (s.link) document.querySelector(s.link)?.scrollIntoView({ behavior: 'smooth' })
        else {
          const [x, y] = this.sitePos(i)
          this.r.shock(x, y, this.state.time, 1.2)
        }
      })
      m.addEventListener('pointerenter', () => ui.cursorRead(`${s.code} · ${s.link ? 'open sheet' : 'pulse'}`))
      ui.markers.appendChild(m)
      this.markers.push(m)
    }

    const el = sticky
    el.addEventListener('pointermove', (e) => this.move(e))
    el.addEventListener('pointerenter', (e) => {
      this.pointer.inside = true
      this.move(e)
    })
    el.addEventListener('pointerleave', () => {
      this.pointer.inside = false
      this.release()
    })
    el.addEventListener('pointerdown', (e) => {
      this.move(e)
      this.pointer.down = true
      this.pointer.downAt = this.state.time
    })
    window.addEventListener('pointerup', () => this.release())
  }

  private move(e: PointerEvent) {
    const r = this.sticky.getBoundingClientRect()
    this.pointer.x = e.clientX - r.left
    this.pointer.y = e.clientY - r.top
    if (e.pointerType === 'mouse') this.pointer.real = true
    this.pointer.inside = true
  }

  private release() {
    if (!this.pointer.down) return
    this.pointer.down = false
    const held = this.state.time - this.pointer.downAt
    const [x, y] = this.state.mouse
    if (held < 0.2) {
      this.r.shock(x, y, this.state.time, 1)
      this.layout = (this.layout + 1) % LAYOUTS.length
      this.layoutAt = this.state.time
    } else if (this.state.press > 0.1) {
      this.r.shock(x, y, this.state.time, 0.5 + this.state.press * 1.2)
    }
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w
    this.h = h
    this.r.resize(w, h, dpr)
  }

  private sitePos(i: number): [number, number] {
    const s = SITES[i]
    return [s.p[0] * this.state.zoom, s.p[1] * this.state.zoom]
  }

  update(dt: number, time: number, intro: number) {
    const s = this.state
    s.time = time
    s.dt = Math.min(dt, 1 / 30)
    s.intro = intro
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05

    // scroll → zoom + title parallax
    const rect = this.section.getBoundingClientRect()
    const span = rect.height - window.innerHeight
    this.progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, span)))
    this.visible = rect.bottom > 0 && rect.top < window.innerHeight
    s.zoom = 1 + this.progress * 1.35
    this.ui.title.style.transform = `translate3d(0, ${-this.progress * 22}vh, 0)`
    this.ui.title.style.opacity = `${1 - this.progress * 1.6}`
    this.ui.cue.style.setProperty('--p', `${this.progress}`)
    if (!this.visible) return

    // pointer (or autopilot drift until a real mouse shows up)
    const aspect = this.w / this.h
    let tx: number
    let ty: number
    if (this.pointer.real || this.pointer.down) {
      tx = (this.pointer.x - this.w / 2) / this.h
      ty = (this.pointer.y - this.h / 2) / this.h
    } else {
      tx = Math.sin(time * 0.31) * aspect * 0.28
      ty = Math.sin(time * 0.47 + 1.3) * 0.2
    }
    this.mouseMap = [tx, ty]
    const k = 1 - Math.exp(-dt * 10)
    const mvx = (tx - this.lastMouse[0]) / Math.max(dt, 1e-3)
    const mvy = (ty - this.lastMouse[1]) / Math.max(dt, 1e-3)
    this.lastMouse = [tx, ty]
    s.mouseVel = [s.mouseVel[0] + (mvx - s.mouseVel[0]) * 0.3, s.mouseVel[1] + (mvy - s.mouseVel[1]) * 0.3]
    s.mouse = [this.mouseMap[0], this.mouseMap[1]]
    s.lens = [s.lens[0] + (tx - s.lens[0]) * k, s.lens[1] + (ty - s.lens[1]) * k]

    const holding = this.pointer.down && time - this.pointer.downAt > 0.18
    s.press = holding ? Math.min(1, s.press + dt * 0.8) : Math.max(0, s.press - dt * 2.2)
    const wantScan = this.pointer.inside || !this.pointer.real ? 1 : 0
    s.scan += (wantScan * intro - s.scan) * (1 - Math.exp(-dt * 6))

    // lens silhouette: snap through layouts, spring between them
    if (time - this.layoutAt > 2.6) {
      this.layout = (this.layout + 1) % LAYOUTS.length
      this.layoutAt = time
    }
    const S = 0.12 * (1 - s.press * 0.3)
    const L = LAYOUTS[this.layout]
    const sp = Math.hypot(s.mouseVel[0], s.mouseVel[1])
    const trail = [-s.mouseVel[0] * 0.035, -s.mouseVel[1] * 0.035]
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) {
        const i = r * 4 + c
        let t = L[r][c] * S
        if (r === 0) t += trail[c % 2] * Math.min(sp, 2)
        this.vel[i] += (t - this.cur[i]) * 260 * dt
        this.vel[i] *= Math.exp(-dt * 19)
        this.cur[i] += this.vel[i] * dt
      }
    s.rects = [
      this.cur.slice(0, 4) as Rect,
      this.cur.slice(4, 8) as Rect,
      this.cur.slice(8, 12) as Rect,
    ]

    this.r.frame(s)
    this.dom(time)
  }

  private dom(time: number) {
    const s = this.state
    const H = this.h
    const W = this.w
    // markers
    let best = -1
    let bestD = 0.11
    for (let i = 0; i < SITES.length; i++) {
      const [mx, my] = this.sitePos(i)
      const px = mx * H + W / 2
      const py = my * H + H / 2
      const m = this.markers[i]
      m.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`
      m.style.opacity = `${Math.min(1, s.intro * 1.5) * (px > -40 && px < W + 40 && py > -40 && py < H + 40 ? 1 : 0)}`
      const d = Math.hypot(mx - s.lens[0], my - s.lens[1])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    // lens label follows the lens
    const lx = s.lens[0] * H + W / 2
    const ly = s.lens[1] * H + H / 2 + 0.12 * H * 1.2 + 14
    this.ui.label.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translateX(-50%)`
    this.ui.label.style.opacity = `${s.scan}`

    const elev = terrain(s.lens[0], s.lens[1], s.zoom, time)
    const e = 0.004
    const gx = terrain(s.lens[0] + e, s.lens[1], s.zoom, time) - terrain(s.lens[0] - e, s.lens[1], s.zoom, time)
    const gy = terrain(s.lens[0], s.lens[1] + e, s.zoom, time) - terrain(s.lens[0], s.lens[1] - e, s.zoom, time)
    const slope = (Math.atan(Math.hypot(gx, gy) / (2 * e) * 0.35) * 180) / Math.PI
    const meters = elev * 420 - 151 - s.press * 120

    if (best !== this.nearSite) {
      this.markers[this.nearSite]?.classList.remove('near')
      this.nearSite = best
      if (best >= 0) {
        this.markers[best].classList.add('near')
        scramble(this.ui.name, SITES[best].name.toUpperCase())
      } else scramble(this.ui.name, elev < 0.36 ? 'OPEN WATER' : 'SCANNING')
    }
    const sub =
      best >= 0
        ? `${SITES[best].code} · ${(bestD * 1.8).toFixed(2)} KM`
        : `ELEV ${meters.toFixed(1)} M · ${slope.toFixed(0)}°`
    if (this.ui.sub.textContent !== sub) this.ui.sub.textContent = sub

    if (time - this.readoutAt > 0.1) {
      this.readoutAt = time
      const lat = 37.4243 - s.lens[1] * (0.02 / s.zoom)
      const lon = 122.0844 - s.lens[0] * (0.02 / s.zoom)
      this.ui.coords.textContent = `${lat.toFixed(4)}° N ${lon.toFixed(4)}° W`
      this.ui.elev.textContent = `${meters.toFixed(1)} M`
      this.ui.slope.textContent = `${slope.toFixed(1)}°`
      this.ui.zoom.textContent = `${s.zoom.toFixed(2)}×`
      this.ui.fpsEl.textContent = `${Math.round(this.fps)} FPS`
      this.ui.cursorRead(
        s.press > 0.05 ? `SINKING ${(s.press * 100).toFixed(0)}%` : `${lat.toFixed(3)}N ${meters.toFixed(0)}M`,
      )
    }
  }
}
