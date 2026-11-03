// X-ray: explodes the live DOM into isometric layers and annotates each node
// with the type spec it is actually rendered with (read from computed styles).

const SELECTOR = [
  'h1 .ln', 'h2', 'p', 'button', 'canvas', '.tag', '.card', '.meta', '.readout', '.chips li', '.pills li',
  '.stats div', '.sec-head span', '.colophon > div', '.marker', '.lens-label', '.clip', '.sheet-tag', '.scroll-cue',
].join(',')

const COLORS = {
  heading: '#ff3d9a',
  text: '#ff4d4d',
  mono: '#2bd46a',
  ui: '#f4ff00',
  canvas: '#3ad6ff',
}

export class Xray {
  on = false
  private annotated: HTMLElement[] = []
  private t = 0

  constructor(
    private stage: HTMLElement,
    private countEl: HTMLElement,
    private onChange: (on: boolean) => void,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'x' || e.key === 'X') this.toggle()
      if (e.key === 'Escape' && this.on) this.toggle()
    })
    window.addEventListener('scroll', () => this.origin(), { passive: true })
    window.addEventListener('pointermove', (e) => {
      if (!this.on) return
      const x = e.clientX / innerWidth - 0.5
      const y = e.clientY / innerHeight - 0.5
      document.body.style.setProperty('--rz', `${-34 + x * 36}deg`)
      document.body.style.setProperty('--rx', `${52 - y * 26}deg`)
    })
  }

  private origin() {
    if (this.on) this.stage.style.setProperty('--xo', `${scrollY + innerHeight / 2}px`)
  }

  toggle(force?: boolean) {
    this.on = force ?? !this.on
    const b = document.body
    clearTimeout(this.t)
    b.classList.add('xray-anim')
    if (this.on) {
      this.origin()
      this.annotate()
      b.classList.add('xray')
    } else {
      b.classList.remove('xray')
      b.style.removeProperty('--rz')
      b.style.removeProperty('--rx')
    }
    this.t = window.setTimeout(() => {
      b.classList.remove('xray-anim')
      if (!this.on) this.clear()
    }, 1300)
    this.onChange(this.on)
  }

  private clear() {
    for (const el of this.annotated) {
      el.removeAttribute('data-xray')
      el.removeAttribute('data-xdim')
      el.classList.remove('xr-rel')
      el.style.removeProperty('--xz')
      el.style.removeProperty('--xc')
    }
    this.annotated = []
  }

  private annotate() {
    this.clear()
    const vh = innerHeight
    for (const el of this.stage.querySelectorAll<HTMLElement>(SELECTOR)) {
      const r = el.getBoundingClientRect()
      // only annotate what is near the viewport — keeps it legible and cheap
      if (r.width < 2 || r.height < 2 || r.bottom < -vh * 0.6 || r.top > vh * 1.6) continue
      const cs = getComputedStyle(el)
      let label: string
      let color: string
      if (el instanceof HTMLCanvasElement) {
        label = `canvas#${el.id} ${el.width}×${el.height} · ${el.id === 'survey-canvas' || el.id === 'sheet-canvas' ? 'webgpu' : '2d'}`
        color = COLORS.canvas
      } else {
        const family = cs.fontFamily.split(',')[0].replace(/["']/g, '').replace('IBM Plex Mono', 'Plex Mono')
        const size = Math.round(parseFloat(cs.fontSize))
        const lh = cs.lineHeight === 'normal' ? Math.round(size * 1.2) : Math.round(parseFloat(cs.lineHeight))
        const tagName = el.tagName.toLowerCase()
        const id = el.id ? `#${el.id}` : ''
        label = /^h[1-3]$/.test(tagName) || el.classList.contains('ln')
          ? `${tagName}${id} ${family} ${size}/${lh} · ${cs.fontWeight}`
          : `${family} ${size}/${lh} · ${cs.fontWeight}`
        color = /^h[1-3]$/.test(tagName) || el.classList.contains('ln')
          ? COLORS.heading
          : el.classList.contains('tag') || tagName === 'button' || el.classList.contains('marker')
            ? COLORS.ui
            : family.includes('Mono')
              ? COLORS.mono
              : COLORS.text
      }
      el.dataset.xray = label
      if (r.width > 120) el.dataset.xdim = `${Math.round(el.offsetWidth)} × ${Math.round(el.offsetHeight)}`
      let depth = 0
      for (let p = el.parentElement; p && p !== this.stage; p = p.parentElement) depth++
      el.style.setProperty('--xz', `${30 + depth * 34}px`)
      el.style.setProperty('--xc', color)
      if (cs.position === 'static') el.classList.add('xr-rel')
      this.annotated.push(el)
    }
    this.countEl.textContent = `${this.annotated.length}`
  }
}
