import { World } from './wasm/physics'

type Kind = 'peach' | 'mint' | 'sky' | 'lilac' | 'sand' | 'rose' | 'big' | 'ink' | 'outline'

const TAGS: [string, Kind][] = [
  ['cultivated', 'peach'], ['edible', 'mint'], ['medicinal', 'sky'], ['summer bloom', 'lilac'],
  ['Linaceae', 'big'], ['annual', 'sand'], ['perennial', 'mint'], ['aquatic', 'sky'],
  ['FS04-0001', 'ink'], ['riparian', 'outline'], ['toxic', 'rose'], ['nitrogen fixer', 'mint'],
  ['Typhaceae', 'big'], ['pollinator magnet', 'peach'], ['wind-dispersed', 'sand'], ['rhizomatous', 'lilac'],
  ['20 specimens', 'ink'], ['deciduous', 'peach'], ['native', 'mint'], ['invasive', 'rose'],
  ['Salicaceae', 'big'], ['spore-bearing', 'lilac'], ['mycorrhizal', 'sand'], ['fibre crop', 'peach'],
  ['dye plant', 'sky'], ['night-blooming', 'lilac'], ['37.42° N', 'ink'], ['emergent', 'mint'],
  ['Nymphaeaceae', 'big'], ['floating-leaved', 'sky'], ['edge species', 'outline'], ['pioneer', 'sand'],
  ['shade-tolerant', 'outline'], ['seasonal', 'rose'], ['Equisetaceae', 'big'], ['living fossil', 'ink'],
]

export class Taxonomy {
  world: World
  private els: HTMLElement[] = []
  private sizes: [number, number][] = []
  private bodyOf: number[] = [] // tag index → body index (or -1)
  private statics: { el: HTMLElement; body: number }[] = []
  private spawned = false
  private gravityUp = false
  private grabbed = -1
  private uiAt = 0
  private w = 1
  private h = 1
  visible = false

  constructor(
    section: HTMLElement,
    private arena: HTMLElement,
    private memory: WebAssembly.Memory,
    private ui: { readout: HTMLElement; flip: HTMLElement; scatter: HTMLElement; respawn: HTMLElement; cursor: (m: string, r: string) => void },
  ) {
    this.world = new World(1, 1)
    for (const [label, kind] of TAGS) {
      const el = document.createElement('div')
      el.className = `tag ${['big', 'ink', 'outline'].includes(kind) ? kind : 't-' + kind}`
      el.textContent = label
      arena.appendChild(el)
      this.els.push(el)
      this.bodyOf.push(-1)
    }
    for (const el of section.querySelectorAll<HTMLElement>('[data-static]')) this.statics.push({ el, body: -1 })

    new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting && !this.spawned) this.spawn()
      },
      { threshold: 0.3 },
    ).observe(section)

    section.addEventListener('pointerdown', (e) => this.down(e))
    window.addEventListener('pointermove', (e) => this.move(e))
    window.addEventListener('pointerup', () => this.up())
    section.addEventListener('pointermove', (e) => {
      const t = (e.target as HTMLElement).closest('.tag')
      ui.cursor(t ? 'grab' : '', t ? 'DRAG · THROW' : 'CLICK · SCATTER')
    })
    section.addEventListener('pointerleave', () => ui.cursor('', ''))

    ui.flip.addEventListener('click', () => {
      this.gravityUp = !this.gravityUp
      this.world.set_gravity(0, this.gravityUp ? -2600 : 2600)
    })
    ui.scatter.addEventListener('click', () => this.world.blast(this.w / 2, this.h, this.w, 60))
    ui.respawn.addEventListener('click', () => this.respawn())

    // device tilt steers gravity where the browser allows it without a prompt
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return
      const gx = Math.sin(((e.gamma ?? 0) * Math.PI) / 180) * 2600
      const gy = Math.sin(((Math.min(90, Math.max(-90, e.beta ?? 90)) * Math.PI) / 180)) * 2600
      this.world.set_gravity(gx, this.gravityUp ? -gy : gy)
    })
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.arena.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  private down(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button,a') || document.body.classList.contains('xray')) return
    const [x, y] = this.local(e)
    const b = this.world.drag_start(x, y)
    if (b >= 0) {
      this.grabbed = b
      const i = this.bodyOf.indexOf(b)
      this.els[i]?.classList.add('grabbed')
      e.preventDefault()
    } else {
      this.world.blast(x, y, 320, 26)
    }
  }

  private move(e: PointerEvent) {
    if (this.grabbed < 0) return
    const [x, y] = this.local(e)
    this.world.drag_move(x, y)
  }

  private up() {
    if (this.grabbed < 0) return
    this.els[this.bodyOf.indexOf(this.grabbed)]?.classList.remove('grabbed')
    this.world.drag_end()
    this.grabbed = -1
  }

  layout() {
    const r = this.arena.getBoundingClientRect()
    this.w = r.width
    this.h = r.height
    this.world.resize(this.w, this.h)
    for (const [i, el] of this.els.entries()) this.sizes[i] = [el.offsetWidth, el.offsetHeight]
    for (const s of this.statics) {
      const b = s.el.getBoundingClientRect()
      const cx = b.left - r.left + b.width / 2
      const cy = b.top - r.top + b.height / 2
      // trim the line-box padding so tags rest on the glyphs, not the leading
      const hh = s.el.tagName === 'SPAN' || s.el.tagName === 'EM' ? b.height * 0.74 : b.height
      if (s.body < 0) s.body = this.world.add_body(cx, cy + (b.height - hh) * 0.2, b.width, hh, 0, true)
      else this.world.place(s.body, cx, cy + (b.height - hh) * 0.2, b.width, hh, 0)
    }
  }

  private spawn() {
    this.spawned = true
    this.layout()
    this.els.forEach((el, i) => {
      setTimeout(() => {
        const [w, h] = this.sizes[i]
        const x = w / 2 + Math.random() * (this.w - w)
        const y = -h - Math.random() * 200
        this.bodyOf[i] = this.world.add_body(x, y, w, h, (Math.random() - 0.5) * 1.2, false)
        el.classList.add('live')
      }, 120 + i * 70)
    })
  }

  private respawn() {
    this.els.forEach((_, i) => {
      const b = this.bodyOf[i]
      if (b < 0) return
      const [w, h] = this.sizes[i]
      setTimeout(() => {
        this.world.place(b, w / 2 + Math.random() * (this.w - w), -h - Math.random() * 600, w, h, (Math.random() - 0.5) * 2)
      }, i * 30)
    })
  }

  update(dt: number, time: number) {
    if (!this.spawned) return
    this.world.step(Math.min(dt, 1 / 30))
    const out = new Float32Array(this.memory.buffer, this.world.out_ptr(), this.world.body_count() * 3)
    for (let i = 0; i < this.els.length; i++) {
      const b = this.bodyOf[i]
      if (b < 0) continue
      const [w, h] = this.sizes[i]
      const x = out[b * 3] - w / 2
      const y = out[b * 3 + 1] - h / 2
      this.els[i].style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${out[b * 3 + 2].toFixed(4)}rad)`
    }
    if (time - this.uiAt > 0.15) {
      this.uiAt = time
      const n = this.bodyOf.filter((b) => b >= 0).length
      this.ui.readout.textContent = `${n} bodies · ${this.world.contacts()} contacts`
    }
  }
}
