// Scroll-driven camera: Catmull–Rom splines through key poses, plus a damped
// drag-orbit offset and a faint handheld drift.
//
// World units are metres, y up. The monument stands on y = 0, roughly
// x ∈ [-32, 48], z ∈ [-22, 34]; the void runs along z at x = 2, y 3 → 26.5.

import {
  type V3, add, catmull, clamp, cross, damp, length, lookAt, multiply, normalize, perspective, rotate, scale, sub,
} from './math'

export interface Key {
  /** chapter coordinate (0 = Arrival … 5 = Credits) */
  cf: number
  eye: V3
  target: V3
  /** vertical field of view, degrees */
  fov: number
  /** 0..1 — how much this pose pulls back on narrow (portrait) screens */
  fit: number
  /** camera roll, radians */
  roll: number
}

const k = (cf: number, eye: V3, target: V3, fov: number, fit = 1, roll = 0): Key => ({ cf, eye, target, fov, fit, roll })

export const KEYS: Key[] = [
  // 00 Arrival — wide three-quarter, low
  k(0.0, [-64, 13, 94], [6, 17, 0], 34, 0.55),
  k(0.5, [-12, 8, 100], [8, 18, 0], 36, 0.55),
  // 01 The Slab — the cantilever from below, then under it
  k(1.0, [76, 15, 54], [26, 24, 2], 40, 0.6, -0.035),
  k(1.5, [64, 11, 4], [30, 25, 2], 52, 0.25, 0.05),
  // 02 The Void — line up with the arch, then fly through it
  k(2.0, [2, 11, 60], [2, 12.5, 0], 48, 0.15),
  k(2.5, [2, 11.5, 6], [2, 12, -40], 60, 0, 0.025),
  // 03 Collapse — rise out behind it and look back as it falls
  k(3.0, [-24, 32, -64], [4, 6, 0], 44, 0.6),
  k(3.5, [-88, 44, 12], [4, 2, 0], 40, 0.6),
  // 04 Hollow — the word, frontal, then low and close
  k(4.0, [0, 5, 84], [0, -1.5, 0], 44),
  k(4.5, [28, 3.5, 44], [-4, 9, 0], 38, 0.7, -0.03),
  // 05 Credits — everything, dispersed
  k(5.0, [0, 34, 120], [0, 24, -4], 40, 0.8),
]

export class Rig {
  eye: V3 = [0, 0, 0]
  target: V3 = [0, 0, 0]
  forward: V3 = [0, 0, -1]
  right: V3 = [1, 0, 0]
  up: V3 = [0, 1, 0]
  fov = 0.7
  aspect = 1
  readonly view = new Float32Array(16)
  readonly proj = new Float32Array(16)
  readonly viewProj = new Float32Array(16)
  /** drag orbit (radians): live + spring-back targets */
  yaw = 0
  pitch = 0
  yawTarget = 0
  pitchTarget = 0
  dragging = false

  /** Orbit input in pixels. */
  drag(dx: number, dy: number) {
    this.yawTarget = clamp(this.yawTarget - dx * 0.0042, -0.75, 0.75)
    this.pitchTarget = clamp(this.pitchTarget + dy * 0.0032, -0.28, 0.32)
  }

  update(cf: number, dt: number, time: number, reduced: boolean) {
    // segment
    let i = 0
    while (i < KEYS.length - 2 && cf > KEYS[i + 1].cf) i++
    const a = KEYS[Math.max(i - 1, 0)]
    const b = KEYS[i]
    const c = KEYS[i + 1]
    const d = KEYS[Math.min(i + 2, KEYS.length - 1)]
    const t = clamp((cf - b.cf) / (c.cf - b.cf), 0, 1)
    const cr = (f: (q: Key) => number) => catmull(f(a), f(b), f(c), f(d), t)
    const eye: V3 = [cr((q) => q.eye[0]), cr((q) => q.eye[1]), cr((q) => q.eye[2])]
    const target: V3 = [cr((q) => q.target[0]), cr((q) => q.target[1]), cr((q) => q.target[2])]
    const fov = cr((q) => q.fov)
    const fit = clamp(cr((q) => q.fit), 0, 1)
    const roll = cr((q) => q.roll)

    // portrait screens: pull back along the view line
    const fitScale = clamp(1.45 / this.aspect, 1, 3.3)
    let off = scale(sub(eye, target), 1 + (fitScale - 1) * fit)

    // drag orbit, springing back once released
    if (!this.dragging) {
      this.yawTarget = damp(this.yawTarget, 0, 0.55, dt)
      this.pitchTarget = damp(this.pitchTarget, 0, 0.55, dt)
    }
    this.yaw = damp(this.yaw, this.yawTarget, 6, dt)
    this.pitch = damp(this.pitch, this.pitchTarget, 6, dt)
    off = rotate(off, [0, 1, 0], this.yaw)
    const side = normalize(cross([0, 1, 0], off))
    off = rotate(off, side, this.pitch)

    let e = add(target, off)
    if (!reduced) {
      e = add(e, [Math.sin(time * 0.37) * 0.35, Math.sin(time * 0.29 + 1.3) * 0.22, Math.sin(time * 0.23 + 2.1) * 0.3])
    }
    // never drop below the ground plane
    e[1] = Math.max(e[1], 0.8)

    this.eye = e
    this.target = target
    this.fov = (fov * Math.PI) / 180
    this.forward = normalize(sub(target, e))
    if (length(cross(this.forward, [0, 1, 0])) < 1e-3) this.forward = normalize(add(this.forward, [0, 0, 1e-3]))
    const up0 = rotate([0, 1, 0], this.forward, roll)
    this.right = normalize(cross(this.forward, up0))
    this.up = cross(this.right, this.forward)

    lookAt(this.view, e, target, this.up)
    perspective(this.proj, this.fov, this.aspect, 0.3, 900)
    multiply(this.viewProj, this.proj, this.view)
  }

  /** World ray through normalised device coords (x right, y up, ∈ [-1, 1]). */
  ray(nx: number, ny: number): { o: V3; d: V3 } {
    const th = Math.tan(this.fov / 2)
    const d = normalize(add(this.forward, add(scale(this.right, nx * th * this.aspect), scale(this.up, ny * th))))
    return { o: this.eye, d }
  }

  /** Project a world point → CSS pixels (or null if behind the camera). */
  project(p: V3, w: number, h: number): [number, number] | null {
    const m = this.viewProj
    const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
    const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
    const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
    if (cw < 0.1) return null
    return [(cx / cw * 0.5 + 0.5) * w, (0.5 - cy / cw * 0.5) * h]
  }

  /** Heading (deg, 0 = −z/north) and pitch (deg). */
  attitude() {
    const f = this.forward
    const hdg = ((Math.atan2(f[0], -f[2]) * 180) / Math.PI + 360) % 360
    const pitch = (Math.asin(clamp(f[1], -1, 1)) * 180) / Math.PI
    return { hdg, pitch }
  }

  /** Focal length in physical pixels for a framebuffer of height hPx. */
  focalPx(hPx: number) {
    return hPx / (2 * Math.tan(this.fov / 2))
  }
}
