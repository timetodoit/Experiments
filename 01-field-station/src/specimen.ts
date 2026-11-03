import { Cloth } from './wasm/physics'
import type { SheetView } from './camera'

const COLS = 41
const ROWS = 51
const WINDS = [0, 0.35, 1.4]

/** Owns the Rust cloth, routes pointer input and streams vertices to a renderer. */
export class Specimen {
  cloth!: Cloth
  private windIdx = 1
  private scalpel = false
  private mode: 'idle' | 'grab' | 'cut' = 'idle'
  private grabDepth = 0
  private last: [number, number, number] | null = null
  private hoverPrev: [number, number, number] | null = null
  private stepMs = 0
  private uiAt = 0
  private dropped = false
  visible = false

  constructor(
    private view: SheetView,
    private memory: WebAssembly.Memory,
    private wrap: HTMLElement,
    private ui: {
      clips: HTMLElement
      wire: HTMLElement
      particles: HTMLElement
      constraints: HTMLElement
      iter: HTMLElement
      torn: HTMLElement
      ms: HTMLElement
      mode: HTMLElement
      scalpelBtn: HTMLElement
      windBtn: HTMLElement
      windVal: HTMLElement
      dropBtn: HTMLElement
      resetBtn: HTMLElement
      cursor: (mode: string, read: string) => void
    },
  ) {
    this.create()
    const el = wrap
    el.addEventListener('pointerdown', (e) => this.down(e))
    el.addEventListener('pointermove', (e) => this.move(e))
    el.addEventListener('pointerup', (e) => this.up(e))
    el.addEventListener('pointercancel', (e) => this.up(e))
    el.addEventListener('pointerleave', () => {
      this.hoverPrev = null
      ui.cursor('', '')
    })
    el.addEventListener('dblclick', () => this.create())

    ui.scalpelBtn.addEventListener('click', () => {
      this.scalpel = !this.scalpel
      ui.scalpelBtn.querySelector('.led')!.classList.toggle('on', this.scalpel)
    })
    ui.windBtn.addEventListener('click', () => {
      this.windIdx = (this.windIdx + 1) % WINDS.length
      this.cloth.set_wind(WINDS[this.windIdx])
      ui.windVal.textContent = WINDS[this.windIdx].toFixed(2)
      ui.windBtn.querySelector('.led')!.classList.toggle('on', WINDS[this.windIdx] > 0)
    })
    ui.dropBtn.addEventListener('click', () => {
      this.cloth.release_pins()
      this.dropped = true
    })
    ui.resetBtn.addEventListener('click', () => this.create())
  }

  create() {
    this.cloth?.free()
    this.cloth = new Cloth(COLS, ROWS, 1.6, 2.0)
    this.cloth.set_floor(-1.4)
    this.cloth.set_wind(WINDS[this.windIdx])
    this.dropped = false
    this.mode = 'idle'
    this.ui.particles.textContent = this.cloth.particle_count().toLocaleString('en-US')
    this.ui.constraints.textContent = this.cloth.constraint_count().toLocaleString('en-US')
    this.ui.iter.textContent = `${this.cloth.iterations()}×`
    this.placeClips()
  }

  resize(w: number, h: number, dpr: number) {
    this.view.resize(w, h, dpr)
    this.placeClips()
  }

  private placeClips() {
    const cam = this.view.cam
    if (cam.width < 2) return
    const p = this.cloth.clip_positions()
    this.ui.clips.innerHTML = ''
    let y = 0
    for (let i = 0; i < p.length; i += 3) {
      const [sx, sy] = cam.project(p[i], p[i + 1], p[i + 2])
      const c = document.createElement('div')
      c.className = 'clip'
      c.innerHTML = '<i></i>'
      c.style.transform = `translate(${sx}px, ${sy}px)`
      this.ui.clips.appendChild(c)
      y = sy
    }
    this.ui.wire.style.top = `${y - 15}px`
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.wrap.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  private down(e: PointerEvent) {
    if (document.body.classList.contains('xray')) return
    const [x, y] = this.local(e)
    this.wrap.setPointerCapture(e.pointerId)
    if (this.scalpel || e.shiftKey || e.button === 2) {
      this.mode = 'cut'
      this.last = this.view.cam.onPlane(x, y, 0)
      return
    }
    const { o, d } = this.view.cam.ray(x, y)
    const i = this.cloth.pick(o[0], o[1], o[2], d[0], d[1], d[2], 0.09)
    if (i >= 0) {
      this.cloth.grab(i)
      this.grabDepth = this.cloth.particle(i)[2]
      this.mode = 'grab'
    } else {
      // missed the sheet: slicing gesture by default
      this.mode = 'cut'
      this.last = this.view.cam.onPlane(x, y, 0)
    }
  }

  private move(e: PointerEvent) {
    const [x, y] = this.local(e)
    const cam = this.view.cam
    if (this.mode === 'grab') {
      const p = cam.onPlane(x, y, this.grabDepth)
      this.cloth.drag_to(p[0], p[1], p[2])
      this.ui.cursor('grab', 'TENSION')
    } else if (this.mode === 'cut' && this.last) {
      const p = cam.onPlane(x, y, 0)
      this.cloth.cut(this.last[0], this.last[1], p[0], p[1])
      this.last = p
      this.ui.cursor('cut', 'INCISION')
    } else {
      const p = cam.onPlane(x, y, 0)
      if (this.hoverPrev) {
        const vx = p[0] - this.hoverPrev[0]
        const vy = p[1] - this.hoverPrev[1]
        if (Math.hypot(vx, vy) > 0.002) this.cloth.gust(p[0], p[1], vx * 0.35, vy * 0.35, 0.28)
      }
      this.hoverPrev = p
      this.ui.cursor(this.scalpel || e.shiftKey ? 'cut' : '', this.scalpel || e.shiftKey ? 'SCALPEL' : 'PULL · ⇧ CUT')
    }
  }

  private up(e: PointerEvent) {
    if (this.wrap.hasPointerCapture(e.pointerId)) this.wrap.releasePointerCapture(e.pointerId)
    if (this.mode === 'grab') this.cloth.release()
    this.mode = 'idle'
    this.last = null
  }

  update(dt: number, time: number) {
    const t0 = performance.now()
    this.cloth.step(Math.min(dt, 1 / 30))
    this.stepMs += (performance.now() - t0 - this.stepMs) * 0.1

    const dirty = this.cloth.take_dirty()
    const buf = this.memory.buffer
    const verts = new Float32Array(buf, this.cloth.verts_ptr(), this.cloth.verts_len())
    const n = this.cloth.indices_len()
    const indices = dirty ? new Uint32Array(buf, this.cloth.indices_ptr(), n) : null
    this.view.upload(verts, indices, n)
    this.view.frame(time)

    if (time - this.uiAt > 0.15) {
      this.uiAt = time
      const torn = this.cloth.torn()
      this.ui.torn.textContent = torn.toLocaleString('en-US')
      this.ui.ms.textContent = `${this.stepMs.toFixed(2)} ms`
      this.ui.mode.textContent = this.dropped
        ? 'Pins released — specimen at rest'
        : torn > 400
          ? 'Specimen compromised'
          : torn > 0
            ? `Incision recorded · ${torn} fibres`
            : 'Tension field nominal'
    }
  }
}
