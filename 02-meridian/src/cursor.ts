// Custom cursor: an ink dot plus a trailing ring that swells while pouring.
// Fine pointers only (hidden by CSS on touch).

export class Cursor {
  private el = document.getElementById('cursor') as HTMLElement
  private ring = this.el.querySelector('.c-ring') as HTMLElement
  private dot = this.el.querySelector('.c-dot') as HTMLElement
  private label = this.el.querySelector('.c-label') as HTMLElement
  private x = -100
  private y = -100
  private rx = -100
  private ry = -100
  pour = 0

  constructor() {
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return
      this.x = e.clientX
      this.y = e.clientY
      this.el.classList.add('on')
      const t = e.target as Element
      let mode = ''
      if (t.closest('#dial')) mode = 'scrub'
      else if (t.closest('a,button')) mode = 'link'
      else if (t.closest('[data-glass]')) mode = 'drag'
      if (this.el.dataset.mode !== mode) {
        this.el.dataset.mode = mode
        this.label.textContent = mode === 'scrub' ? 'Scrub time' : mode === 'drag' ? 'Drag glass' : ''
      }
    })
    document.documentElement.addEventListener('pointerleave', () => this.el.classList.remove('on'))
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 16)
    this.rx += (this.x - this.rx) * k
    this.ry += (this.y - this.ry) * k
    this.dot.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`
    const s = 1 + Math.min(this.pour, 3) * 0.9
    this.ring.style.transform = `translate3d(${this.rx}px, ${this.ry}px, 0) scale(${s.toFixed(3)})`
    this.label.style.transform = `translate3d(${this.rx + 24}px, ${this.ry - 6}px, 0)`
  }
}
