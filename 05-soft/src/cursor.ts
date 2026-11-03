// A squishy blob cursor: follows with a little lag, stretches along its velocity,
// swells into a lemon "grab" bubble over letters and squashes flat while holding.

export class Cursor {
  private x = -100
  private y = -100
  private tx = -100
  private ty = -100
  private vx = 0
  private vy = 0
  private on = false
  mode = ''

  constructor(
    private el: HTMLElement,
    private blob: HTMLElement,
    private label: HTMLElement,
    private reduced: boolean,
  ) {
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches
    if (!fine) {
      el.style.display = 'none'
      return
    }
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return
      this.tx = e.clientX
      this.ty = e.clientY
      if (!this.on) {
        this.on = true
        this.x = this.tx
        this.y = this.ty
        el.classList.add('on')
      }
      const t = e.target as HTMLElement
      if (t.closest('a,button,input,label')) this.set('link', '')
      else if (this.mode === 'link') this.set('', '')
    })
    document.addEventListener('pointerleave', () => {
      this.on = false
      el.classList.remove('on')
    })
    window.addEventListener('pointerdown', () => el.classList.add('down'))
    window.addEventListener('pointerup', () => el.classList.remove('down'))
  }

  set(mode: string, text: string) {
    if (mode === this.mode && this.label.textContent === text) return
    this.mode = mode
    this.el.dataset.mode = mode
    this.label.textContent = text
  }

  update(dt: number) {
    if (!this.on) return
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * 28)
    const nx = this.x + (this.tx - this.x) * k
    const ny = this.y + (this.ty - this.y) * k
    const inv = 1 / Math.max(dt, 1e-3)
    this.vx += ((nx - this.x) * inv - this.vx) * 0.35
    this.vy += ((ny - this.y) * inv - this.vy) * 0.35
    this.x = nx
    this.y = ny
    const sp = Math.hypot(this.vx, this.vy)
    const st = this.reduced ? 0 : Math.min(0.55, sp / 2600)
    const ang = Math.atan2(this.vy, this.vx)
    this.el.style.transform = `translate3d(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px, 0)`
    this.blob.style.transform = `rotate(${ang.toFixed(3)}rad) scale(${(1 + st).toFixed(3)}, ${(1 - st * 0.6).toFixed(3)})`
  }
}
