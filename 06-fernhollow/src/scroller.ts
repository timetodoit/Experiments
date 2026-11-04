// Virtual scroller: wheel / touch push a target distance along the rail, the
// current value chases it with exponential damping. When nobody is scrolling
// the valley keeps drifting forward on its own.

const WHEEL_K = 0.011 // world units per wheel pixel
const TOUCH_MULT = 20 // touch deltas are tiny next to wheel deltas
const MAX_LEAD = 70 // how far target may run ahead of current
const IDLE_AFTER = 1.4 // seconds without input before the drift resumes

export class Scroller {
  target = 0
  current = 0
  velocity = 0 // world units / s (smoothed)
  private idle = 0
  private drift = 1
  private lastTouchY: number | null = null
  private disposers: (() => void)[] = []

  constructor(
    el: Window,
    private driftSpeed: number,
  ) {
    const wheel = (e: WheelEvent) => {
      let dy = e.deltaY
      if (e.deltaMode === 1) dy *= 16
      else if (e.deltaMode === 2) dy *= window.innerHeight
      this.push(Math.max(-400, Math.min(400, dy)))
    }
    const tstart = (e: TouchEvent) => {
      this.lastTouchY = e.touches[0]?.clientY ?? null
    }
    const tmove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY
      if (y === undefined || this.lastTouchY === null) return
      const dy = this.lastTouchY - y
      this.lastTouchY = y
      this.push(Math.max(-30, Math.min(30, dy)) * TOUCH_MULT)
    }
    const tend = () => {
      this.lastTouchY = null
    }
    el.addEventListener('wheel', wheel, { passive: true })
    el.addEventListener('touchstart', tstart, { passive: true })
    el.addEventListener('touchmove', tmove, { passive: true })
    el.addEventListener('touchend', tend, { passive: true })
    this.disposers.push(
      () => el.removeEventListener('wheel', wheel),
      () => el.removeEventListener('touchstart', tstart),
      () => el.removeEventListener('touchmove', tmove),
      () => el.removeEventListener('touchend', tend),
    )
  }

  private gate = 1
  private push(px: number) {
    this.target += px * WHEEL_K * this.gate
    this.target = Math.max(this.current - MAX_LEAD, Math.min(this.current + MAX_LEAD, this.target))
    this.idle = 0
  }

  /** freeze 0..1 eases the flight to a standstill (hover transition) */
  update(dt: number, freeze: number) {
    this.gate = 1 - freeze
    this.idle += dt
    const want = this.idle > IDLE_AFTER ? 1 : 0
    this.drift += (want - this.drift) * (1 - Math.exp(-dt * (want ? 0.7 : 4)))
    this.target += this.driftSpeed * this.drift * (1 - freeze) * dt
    // while frozen, pull the target back onto the camera so it coasts to a stop
    if (freeze > 0) this.target -= (this.target - this.current) * freeze * (1 - Math.exp(-dt * 3))
    const prev = this.current
    this.current += (this.target - this.current) * (1 - Math.exp(-dt * 2.6))
    const v = (this.current - prev) / Math.max(dt, 1e-4)
    this.velocity += (v - this.velocity) * (1 - Math.exp(-dt * 5))
  }

  dispose() {
    for (const d of this.disposers) d()
  }
}
