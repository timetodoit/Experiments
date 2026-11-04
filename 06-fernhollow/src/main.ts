// Fernhollow — night valley engine. Raw WebGPU + WGSL, Canvas2D fallback.

import { audioStore } from './audio'
import { Scroller } from './scroller'
import { ValleyField, buildTerrain, scatterFlowers, scatterLeaves, placeRays } from './terrain'
import type { PathSample } from './path'
import { GPURenderer, type FrameData } from './gpu/renderer'
import { Fallback } from './fallback'

export { audioStore }

const INTRO_SECONDS = 3.8
const FOV_Y = (52 * Math.PI) / 180
const MAX_DPR = 1.75

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt))

function perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovy / 2)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[10] = far / (near - far)
  out[11] = -1
  out[14] = (near * far) / (near - far)
}
function mul(out: Float32Array, a: Float32Array, b: Float32Array) {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = s
    }
}

interface Quality {
  flowers: number
  leaves: number
  dust: number
  terrainRes: number
  dprCap: number
}
function pickQuality(): Quality {
  const small = Math.min(window.innerWidth, window.innerHeight) < 600
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const lowDpr = (window.devicePixelRatio || 1) < 1.25
  if (small || coarse) return { flowers: 48000, leaves: 20000, dust: 500, terrainRes: 200, dprCap: 1.5 }
  if (lowDpr) return { flowers: 90000, leaves: 36000, dust: 900, terrainRes: 280, dprCap: 1.25 }
  return { flowers: 110000, leaves: 44000, dust: 1100, terrainRes: 320, dprCap: MAX_DPR }
}

export class Valley {
  private container: HTMLElement
  private canvas: HTMLCanvasElement
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private scroller: Scroller
  private field?: ValleyField
  private gpu?: GPURenderer
  private fb?: Fallback
  private raf = 0
  private last = 0
  private time = 0
  private introStart = -1
  private loadedFired = false
  private hover = 0
  private hoverTarget = 0
  private mouse = { x: 0, y: 0, nx: 0, ny: 0, strength: 0, target: 0, sx: 0, sy: 0 }
  private tilt = { x: 0, y: 0 }
  private speedN = 0
  private css = { w: 1, h: 1, dpr: 1 }
  private quality = pickQuality()
  private disposers: (() => void)[] = []
  private destroyed = false

  // scratch
  private proj = new Float32Array(16)
  private view = new Float32Array(16)
  private vp = new Float32Array(16)
  private ps: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }

  constructor(
    root: HTMLElement,
    private onLoaded?: () => void,
    private onIntroDone?: () => void,
  ) {
    this.container = (root.querySelector('.js-canvas-container') as HTMLElement | null) ?? root
    this.canvas = document.createElement('canvas')
    this.container.appendChild(this.canvas)
    this.scroller = new Scroller(window, this.reduced ? 0.55 : 1.35)
    this.bindInput()
    void this.boot()
  }

  startHoverTransition() {
    this.hoverTarget = 1
  }
  stopHoverTransition() {
    this.hoverTarget = 0
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.scroller.dispose()
    for (const d of this.disposers) d()
    this.gpu?.destroy()
    this.canvas.remove()
  }

  // ── setup ──────────────────────────────────────────────────────────────────
  private async boot() {
    let ok = false
    try {
      ok = await this.bootGPU()
    } catch (err) {
      console.info('[fernhollow] WebGPU unavailable, using Canvas2D fallback:', err instanceof Error ? err.message : err)
      ok = false
    }
    if (this.destroyed) return
    if (!ok) this.bootFallback()
    this.observeSize()
    this.loaded()
    this.start()
  }

  private async bootGPU() {
    if (!('gpu' in navigator) || !navigator.gpu) return false
    if (import.meta.env.DEV && location.hash.includes('fallback')) return false // dev: force Canvas2D
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return false
    const device = await adapter.requestDevice()
    device.lost.then((info) => {
      if (info.reason !== 'destroyed') console.warn('[fernhollow] GPU device lost:', info.message)
    })
    // give the loader a frame to paint before the CPU-heavy generation
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const q = this.quality
    const field = new ValleyField()
    this.field = field
    const assets = {
      terrain: buildTerrain(field, q.terrainRes),
      flowers: scatterFlowers(field, q.flowers),
      leaves: scatterLeaves(field, q.leaves),
      rays: placeRays(field, 9),
      dustCount: q.dust,
    }
    try {
      this.gpu = await GPURenderer.create(device, this.canvas, assets)
    } catch (err) {
      device.destroy()
      // the canvas has a webgpu context now; swap it for a fresh one
      const fresh = document.createElement('canvas')
      this.canvas.replaceWith(fresh)
      this.canvas = fresh
      throw err
    }
    return true
  }

  private bootFallback() {
    const small = Math.min(window.innerWidth, window.innerHeight) < 600
    this.fb = new Fallback(this.canvas, small ? 1300 : 2600)
  }

  private observeSize() {
    const apply = () => {
      const r = this.container.getBoundingClientRect()
      const w = Math.max(1, r.width || window.innerWidth)
      const h = Math.max(1, r.height || window.innerHeight)
      let dpr = Math.min(window.devicePixelRatio || 1, this.quality.dprCap)
      // keep the pixel budget sane on huge screens
      const budget = 4.4e6
      if (w * h * dpr * dpr > budget) dpr = Math.sqrt(budget / (w * h))
      this.css = { w, h, dpr }
      if (this.gpu) this.gpu.resize(w * dpr, h * dpr)
      if (this.fb) this.fb.resize(w, h, dpr)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(this.container)
    this.disposers.push(() => ro.disconnect())
  }

  private bindInput() {
    const move = (e: PointerEvent) => {
      this.mouse.x = e.clientX
      this.mouse.y = e.clientY
      this.mouse.target = 1
    }
    const leave = () => {
      this.mouse.target = 0
    }
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') this.mouse.target = 0
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', move, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    window.addEventListener('blur', leave)
    const vis = () => {
      if (document.hidden) {
        cancelAnimationFrame(this.raf)
        this.raf = 0
      } else if (!this.raf && (this.gpu || this.fb)) {
        this.last = performance.now()
        this.raf = requestAnimationFrame(this.tick)
      }
    }
    document.addEventListener('visibilitychange', vis)
    this.disposers.push(
      () => window.removeEventListener('pointermove', move),
      () => window.removeEventListener('pointerdown', move),
      () => window.removeEventListener('pointerup', up),
      () => document.documentElement.removeEventListener('pointerleave', leave),
      () => window.removeEventListener('blur', leave),
      () => document.removeEventListener('visibilitychange', vis),
    )
  }

  private loaded() {
    if (this.loadedFired) return
    this.loadedFired = true
    this.onLoaded?.()
  }

  private start() {
    this.last = performance.now()
    if (!document.hidden) this.raf = requestAnimationFrame(this.tick)
  }

  // ── frame ──────────────────────────────────────────────────────────────────
  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min(1 / 20, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.time += dt
    if (this.introStart < 0) {
      this.introStart = this.time + 0.35 // let the loader fade first
      if (import.meta.env.DEV && location.hash.includes('skip')) this.introStart = -INTRO_SECONDS // dev: skip intro
    }
    const introT = clamp01((this.time - this.introStart) / INTRO_SECONDS)
    const intro = easeInOut(introT)

    // hover transition eases in ~1.4s, out a touch faster
    this.hover = damp(this.hover, this.hoverTarget, this.hoverTarget > this.hover ? 2.2 : 2.8, dt)
    const hoverE = this.hover * this.hover * (3 - 2 * this.hover)
    audioStore().setMuffle(hoverE)

    // during the intro the scroller is held so the push-in plays out cleanly
    this.scroller.update(dt, Math.max(hoverE, 1 - introT))
    const sp = Math.abs(this.scroller.velocity)
    this.speedN = damp(this.speedN, clamp01((sp - 1.2) / 22), 3, dt)

    // cursor (eased strength, smoothed position)
    const m = this.mouse
    m.strength = damp(m.strength, m.target, m.target ? 4 : 1.5, dt)
    m.sx = damp(m.sx, m.x, 14, dt)
    m.sy = damp(m.sy, m.y, 14, dt)
    m.nx = (m.sx / this.css.w) * 2 - 1
    m.ny = 1 - (m.sy / this.css.h) * 2
    const tiltOn = this.reduced ? 0 : m.strength
    this.tilt.x = damp(this.tilt.x, m.nx * tiltOn, 2.2, dt)
    this.tilt.y = damp(this.tilt.y, m.ny * tiltOn, 2.2, dt)

    if (this.gpu && this.field) this.frameGPU(intro, introT, hoverE)
    else if (this.fb) {
      this.fb.frame({
        time: this.time,
        s: this.scroller.current * 0.6,
        mouse: [m.sx, m.sy, m.strength],
        disperse: hoverE,
        intro,
        speed: this.speedN,
        tiltX: this.tilt.x,
        tiltY: this.tilt.y,
      })
    }
    if (introT >= 1) this.onIntroDone?.()
  }

  private frameGPU(intro: number, introT: number, hoverE: number) {
    const field = this.field!
    const path = field.path
    const s = this.scroller.current
    // intro: start low and further back, rise and push in
    const back = (1 - intro) * 22
    const camS = s - back
    path.at(camS, this.ps)
    const weave = Math.sin(camS * 0.021) * 2.2 + Math.sin(camS * 0.047 + 1.3) * 0.8
    const nx = -this.ps.tz
    const nz = this.ps.tx
    const lift = 1.7 + Math.sin(camS * 0.05) * 0.25 - (1 - intro) * 1.05
    const eye: V3 = [this.ps.x + nx * weave, field.floorAt(camS) + lift, this.ps.z + nz * weave]
    const ahead = 11
    path.at(camS + ahead, this.ps)
    const weaveT = Math.sin((camS + ahead) * 0.021) * 2.2 + Math.sin((camS + ahead) * 0.047 + 1.3) * 0.8
    const look: V3 = [
      this.ps.x - this.ps.tz * weaveT,
      field.floorAt(camS + ahead) + 1.25 + (1 - intro) * 0.9,
      this.ps.z + this.ps.tx * weaveT,
    ]
    let fwd = norm(sub(look, eye))
    let right = norm(cross(fwd, [0, 1, 0]))
    let up = cross(right, fwd)
    // tilt toward the cursor
    fwd = norm([
      fwd[0] + right[0] * this.tilt.x * 0.075 + up[0] * this.tilt.y * 0.045,
      fwd[1] + right[1] * this.tilt.x * 0.075 + up[1] * this.tilt.y * 0.045,
      fwd[2] + right[2] * this.tilt.x * 0.075 + up[2] * this.tilt.y * 0.045,
    ])
    // re-orthonormalise after the tilt
    right = norm(cross(fwd, [0, 1, 0]))
    up = cross(right, fwd)

    const z = [-fwd[0], -fwd[1], -fwd[2]] as V3
    const V = this.view
    V[0] = right[0]
    V[1] = up[0]
    V[2] = z[0]
    V[3] = 0
    V[4] = right[1]
    V[5] = up[1]
    V[6] = z[1]
    V[7] = 0
    V[8] = right[2]
    V[9] = up[2]
    V[10] = z[2]
    V[11] = 0
    V[12] = -dot(right, eye)
    V[13] = -dot(up, eye)
    V[14] = -dot(z, eye)
    V[15] = 1
    const aspect = this.css.w / this.css.h
    // portrait screens get a wider vertical fov so the valley still reads
    const fov = aspect < 1 ? FOV_Y * 1.25 : FOV_Y
    perspective(this.proj, fov, aspect, 0.08, 420)
    mul(this.vp, this.proj, this.view)

    const dpr = this.css.dpr
    const m = this.mouse
    const minDim = Math.min(this.css.w, this.css.h)
    const f: FrameData = {
      time: this.time,
      viewProj: this.vp,
      view: this.view,
      camPos: eye,
      right,
      up,
      fwd,
      aspect,
      tanHalf: Math.tan(fov / 2),
      dpr,
      mouse: [m.sx * dpr, (this.css.h - m.sy) * dpr, m.strength * (1 - hoverE * 0.5), minDim * 0.16 * dpr],
      disperse: hoverE,
      intro: introT < 1 ? clamp01(introT * 1.15) : 1,
      speed: this.speedN,
      wind: this.reduced ? 0.35 : 1,
      reduced: this.reduced ? 1 : 0,
      push: 0.95,
      calm: 0.35,
      fog: [0.0012, 0.0036, 0.0068, 1 / 72],
      exposure: 0.95 * (0.15 + 0.85 * intro),
      bloom: 0.62 + hoverE * 0.3,
      grain: 0.022,
      vignette: 0.6 + this.speedN * 0.35,
      chroma: 0.0022 + this.speedN * 0.005,
    }
    this.gpu!.render(f)
  }
}
