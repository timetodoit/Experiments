import './style.css'
import { Fluid, KERNEL_COUNT, type GlassShape, type Renderer, type SplatIn } from './gpu/fluid'
import { Canvas2DRenderer } from './fallback'
import {
  applyCSS, fmtHour, hourDelta, inkAt, lightAt, nowHour, paletteAt, phaseName, wrap24, type Palette, type RGB,
} from './palette'
import { Dial } from './dial'
import { GlassCards } from './glass'
import { Cursor } from './cursor'
import { scrollProgress, splitChars } from './kinetic'
import { rasteriseHeadline } from './mask'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TAU = Math.PI * 2
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const small = matchMedia('(max-width: 760px), (pointer: coarse)').matches
const JACOBI = small ? 20 : 32 // must be even (ping-pong ends in pA)
const WRITE_DURATION = reduced ? 1.2 : 3.2

if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
scrollTo(0, 0)

// ── time of day ──────────────────────────────────────────────────────────────
type Mode = 'now' | 'chapter' | 'manual'
let hour = nowHour()
let target = hour
let mode: Mode = 'now'
let pal: Palette = paletteAt(hour)
applyCSS(pal, hour)

// ── boot ─────────────────────────────────────────────────────────────────────
const bootEl = $('boot')
const statsEl = $('boot-stats')
document.body.classList.add('booting')
async function stat(label: string, value: string) {
  const li = document.createElement('li')
  const a = document.createElement('span')
  const b = document.createElement('b')
  a.textContent = label
  b.textContent = value
  li.append(a, b)
  statsEl.append(li)
  await sleep(reduced ? 0 : 160)
}

async function initGPU() {
  if (!('gpu' in navigator) || !navigator.gpu) return null
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return null
    const device = await adapter.requestDevice()
    device.addEventListener('uncapturederror', (e) => console.error('[meridian] WebGPU:', (e as GPUUncapturedErrorEvent).error.message))
    return { adapter, device, format: navigator.gpu.getPreferredCanvasFormat() }
  } catch (err) {
    console.warn('[meridian] WebGPU init failed', err)
    return null
  }
}

function openHole(cx: number, cy: number, dur: number) {
  return new Promise<void>((resolve) => {
    const max = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 40
    bootEl.style.setProperty('--hx', `${cx}px`)
    bootEl.style.setProperty('--hy', `${cy}px`)
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur)
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      bootEl.style.setProperty('--hole', `${(e * max).toFixed(1)}px`)
      if (t < 1) requestAnimationFrame(step)
      else {
        bootEl.classList.add('gone')
        resolve()
      }
    }
    requestAnimationFrame(step)
  })
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  let canvas = $<HTMLCanvasElement>('ink')
  const notice = $('notice')
  await stat('Local time', `${fmtHour(hour)} — ${phaseName(hour)}`)

  const freshCanvas = () => {
    const c = canvas.cloneNode() as HTMLCanvasElement
    canvas.replaceWith(c)
    canvas = c
    return c
  }
  const toFallback = (why: string) => {
    document.documentElement.classList.remove('gpu')
    document.documentElement.classList.add('no-gpu')
    notice.hidden = false
    console.info(`[meridian] Canvas2D fallback: ${why}`)
    return new Canvas2DRenderer(freshCanvas())
  }

  let renderer: Renderer
  const gpu = await initGPU()
  if (gpu) {
    const info = gpu.adapter.info
    const name = [info?.vendor, info?.architecture].filter(Boolean).join(' · ') || 'WebGPU adapter'
    await stat('Adapter', name)
    try {
      renderer = await Fluid.create(gpu.device, canvas, gpu.format, JACOBI)
      document.documentElement.classList.add('gpu')
      gpu.device.lost.then((l) => {
        console.warn('[meridian] WebGPU device lost:', l.message)
        if (l.reason !== 'destroyed') {
          renderer = toFallback('device lost')
          resize(true)
        }
      })
    } catch (err) {
      console.error('[meridian] WebGPU pipelines failed', err)
      renderer = toFallback('pipeline error')
      await stat('WebGPU', 'shader error — sketch mode')
    }
  } else {
    renderer = toFallback('navigator.gpu or adapter missing')
    await stat('WebGPU', 'unavailable — sketch mode')
  }

  // fonts before measuring the headline
  await Promise.race([
    Promise.all([
      document.fonts.load('400 120px Fraunces'),
      document.fonts.load('italic 340 120px Fraunces'),
      document.fonts.ready,
    ]),
    sleep(3000),
  ]).catch(() => {})

  for (const k of document.querySelectorAll<HTMLElement>('.kinetic')) splitChars(k)

  // ── layout / resize ──
  const headline = [...document.querySelectorAll<HTMLElement>('#hero-title .ln')]
  const viewport = () => ({ w: canvas.clientWidth || innerWidth, h: canvas.clientHeight || innerHeight })
  let W = innerWidth
  let H = innerHeight
  function resize(force = false) {
    const v = viewport()
    W = v.w
    H = v.h
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const realloc = renderer.resize(W, H, dpr) || force
    if (realloc && renderer.kind === 'webgpu') {
      const g = renderer.grid
      renderer.setMask(rasteriseHeadline(headline, g.dw, g.dh, W, H, scrollY), g.dw, g.dh)
    }
    cards?.measure()
  }
  let cards: GlassCards | undefined
  resize()
  let resizeT = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeT)
    resizeT = window.setTimeout(() => resize(true), 160)
  })

  const g = renderer.grid
  if (renderer.kind === 'webgpu') {
    const mb = ((renderer as Fluid).bytes / 1048576).toFixed(1)
    await stat('Velocity field', `${g.vw} × ${g.vh}`)
    await stat('Dye field', `${g.dw} × ${g.dh} · ${mb} MB`)
    await stat('Pressure', `${JACOBI} Jacobi iterations`)
    await stat('Kernels', `${KERNEL_COUNT} WGSL compute · 1 render`)
    $('d-field').textContent = `${g.vw}×${g.vh}`
    $('c-vel').textContent = `${g.vw} × ${g.vh}`
    $('c-dye').textContent = `${g.dw} × ${g.dh}`
  } else {
    await stat('Renderer', 'Canvas2D')
    $('d-field').textContent = 'Canvas2D'
    $('c-vel').textContent = 'n/a (fallback)'
    $('c-dye').textContent = 'n/a (fallback)'
  }
  $('c-kernels').textContent = String(KERNEL_COUNT)
  $('c-jacobi').textContent = String(JACOBI)

  // ── splat helpers ──
  const force = reduced ? 0.5 : 1
  const emit = (s: SplatIn) => renderer.splat(s)
  const aspect = () => W / H
  function burst(x: number, y: number, s = 1, color?: RGB) {
    const c = color ?? inkAt(pal, Math.random() * 3)
    emit({ x, y, r: 0.045 * Math.sqrt(s), color: c, amount: 2.2 * s, radial: 620 * s * force })
    const petals = reduced ? 0 : 7
    const spin = Math.random() * TAU
    for (let p = 0; p < petals; p++) {
      const a = spin + (p / petals) * TAU + (Math.random() - 0.5) * 0.4
      const d = 0.035 * s
      emit({
        x: x + (Math.cos(a) * d) / aspect(),
        y: y + Math.sin(a) * d,
        r: 0.012 + Math.random() * 0.01,
        color: inkAt(pal, p * 0.9 + 1),
        amount: 0.5 * s,
        vx: Math.cos(a) * 520 * s * force,
        vy: Math.sin(a) * 520 * s * force,
      })
    }
  }
  const timeline: { at: number; run: () => void }[] = []
  let clock = 0
  const later = (sec: number, run: () => void) => timeline.push({ at: clock + sec, run })

  // ── dial ──
  const navTime = $('nav-time')
  const nowBtn = $('now-btn')
  const setMode = (m: Mode) => {
    mode = m
    nowBtn.setAttribute('aria-pressed', String(m === 'now'))
  }
  const dial = new Dial($('dial'), {
    start: () => setMode('manual'),
    end: () => {},
    scrub: (h, vel) => {
      setMode('manual')
      hour = target = h
      const sp = Math.abs(vel)
      if (sp > 0.8) {
        const [kx, ky] = dial.knobClient()
        const a = (h / 24) * TAU
        const dir = Math.sign(vel)
        const tx = -Math.cos(a) * dir
        const ty = -Math.sin(a) * dir
        const v = Math.min(sp, 30) * 60 * force
        emit({ x: kx / W, y: ky / H, vx: tx * v, vy: ty * v, r: 0.03, color: inkAt(pal, h), amount: Math.min(1.4, sp * 0.06) })
        if (sp > 5 && Math.random() < 0.22) {
          burst(kx / W + (Math.random() - 0.5) * 0.12, ky / H - Math.random() * 0.15, 0.55)
        }
      }
    },
  })
  nowBtn.addEventListener('click', () => {
    setMode('now')
    target = nowHour()
  })

  // ── glass cards ──
  cards = new GlassCards([...document.querySelectorAll<HTMLElement>('[data-glass]')], {
    drag: (cx, cy, vx, vy, w, h) => {
      emit({ x: cx / W, y: cy / H, vx: vx * 0.8 * force, vy: vy * 0.8 * force, r: (Math.max(w, h) / H) * 0.32, color: inkAt(pal, clock * 0.3), amount: 0.04 })
    },
  }, reduced)
  const dialEl = $('dial')

  // ── sections: each chapter pulls the clock to its hour ──
  const sections = [...document.querySelectorAll<HTMLElement>('[data-hour]')]
  const kineticSections = sections.filter((s) => s.id !== 'hero')
  let active: HTMLElement | null = null
  const activate = (sec: HTMLElement) => {
    if (sec === active) return
    active = sec
    sec.classList.add('in')
    const hv = sec.dataset.hour ?? 'now'
    if (hv === 'now') {
      setMode('now')
      target = nowHour()
      return
    }
    setMode('chapter')
    target = parseFloat(hv)
    const p = paletteAt(target)
    const n = reduced ? 1 : 4
    for (let k = 0; k < n; k++) {
      later(0.15 + k * 0.26, () => burst(0.12 + Math.random() * 0.76, 0.2 + Math.random() * 0.6, 0.75 + Math.random() * 0.5, p.inks[k % 3]))
    }
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) activate(e.target as HTMLElement)
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
  )

  // ── pointer: move = stir, click = drop, hold = pour ──
  const isUI = (t: EventTarget | null) => t instanceof Element && !!t.closest('a,button,[data-glass],#dial,.nav,.notice')
  const ptr = { x: 0, y: 0, px: 0, py: 0, has: false, down: false, ui: false, downAt: 0, moved: 0, type: 'mouse' }
  let lastInput = -1e9
  window.addEventListener('pointerdown', (e) => {
    lastInput = performance.now()
    ptr.type = e.pointerType
    ptr.x = ptr.px = e.clientX
    ptr.y = ptr.py = e.clientY
    ptr.has = true
    ptr.ui = isUI(e.target)
    if (ptr.ui) return
    ptr.down = true
    ptr.downAt = performance.now()
    ptr.moved = 0
  })
  window.addEventListener('pointermove', (e) => {
    lastInput = performance.now()
    ptr.type = e.pointerType
    if (!ptr.has) {
      ptr.px = e.clientX
      ptr.py = e.clientY
      ptr.has = true
    }
    ptr.moved += Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y)
    ptr.x = e.clientX
    ptr.y = e.clientY
  })
  const release = (e: PointerEvent, cancelled: boolean) => {
    if (ptr.down && !cancelled) {
      const held = performance.now() - ptr.downAt
      if (held < 230 && ptr.moved < 12 && !isUI(e.target)) burst(e.clientX / W, e.clientY / H, 1)
    }
    ptr.down = false
    if (e.pointerType !== 'mouse') ptr.has = false
  }
  window.addEventListener('pointerup', (e) => release(e, false))
  window.addEventListener('pointercancel', (e) => release(e, true))
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return
    const t = e.target as HTMLElement
    if (t.closest('button,a,input,textarea,[role="slider"]')) return
    e.preventDefault()
    lastInput = performance.now()
    burst(0.15 + Math.random() * 0.7, 0.2 + Math.random() * 0.6, 1.1 + Math.random() * 0.5)
  })

  // ── idle autopilot: slow curved brush strokes ──
  const strokes: { x: number; y: number; a: number; curv: number; speed: number; life: number; max: number; ci: number }[] = []
  let nextStroke = 0.4
  function autopilot(dt: number, idle: boolean, f60: number) {
    if (idle && !reduced) {
      nextStroke -= dt
      if (nextStroke <= 0) {
        nextStroke = 1.8 + Math.random() * 1.6
        strokes.push({
          x: W * (0.1 + Math.random() * 0.8), y: H * (0.15 + Math.random() * 0.7), a: Math.random() * TAU,
          curv: (Math.random() - 0.5) * 3.2, speed: 200 + Math.random() * 170, life: 0, max: 1.4 + Math.random() * 1.2,
          ci: Math.random() * 3,
        })
      }
    }
    for (const s of strokes) {
      s.life += dt
      s.a += s.curv * dt
      const vx = Math.cos(s.a) * s.speed
      const vy = Math.sin(s.a) * s.speed
      s.x += vx * dt
      s.y += vy * dt
      const fade = Math.sin(Math.PI * Math.min(1, s.life / s.max))
      emit({ x: s.x / W, y: s.y / H, vx: vx * 1.1 * f60, vy: vy * 1.1 * f60, r: 0.02, color: inkAt(pal, s.ci + s.life * 0.4), amount: 0.045 * fade * f60 })
    }
    for (let i = strokes.length - 1; i >= 0; i--) if (strokes[i].life >= strokes[i].max) strokes.splice(i, 1)
  }

  const cursor = new Cursor()
  const heroLocal = $('hero-local')
  const dSun = $('d-sun')
  const dLight = $('d-light')
  let cssHour = wrap24(hour + 12) // guarantees a first theme pass
  let lastScroll = scrollY
  let writeStart = Infinity
  let lastHud = 0
  const shapes: GlassShape[] = []

  // ── loop ──
  let last = performance.now()
  const t0 = last
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    const time = (now - t0) / 1000
    clock = time
    const f60 = dt * 60

    // clock: chapters/now ease towards their target, the dial sets it directly
    if (mode === 'now') target = nowHour()
    if (!dial.dragging) {
      const d = hourDelta(hour, target)
      hour = wrap24(hour + d * (1 - Math.exp(-dt * (Math.abs(d) > 0.05 ? 2.2 : 8))))
    }
    pal = paletteAt(hour)
    const light = lightAt(hour)
    if (Math.abs(hourDelta(cssHour, hour)) > 0.002) {
      cssHour = hour
      const phase = phaseName(hour)
      applyCSS(pal, hour)
      dial.set(hour, phase)
      navTime.textContent = `${fmtHour(hour)} — ${phase.toUpperCase()}`
    }
    if (now - lastHud > 250) {
      lastHud = now
      heroLocal.textContent = `Local ${fmtHour(nowHour())}`
      const deg = Math.round(light.elev * 66)
      dSun.textContent = `${deg > 0 ? '+' : ''}${deg}°${light.moon ? ' · moon up' : ''}`
      const az = Math.round(((Math.atan2(-light.x, light.y) * 180) / Math.PI + 360) % 360) // 06h → 090°, noon → 180°
      dLight.textContent = `${String(az).padStart(3, '0')}°`
    }

    // scheduled bursts
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].at <= time) {
        timeline[i].run()
        timeline.splice(i, 1)
      }
    }

    // pointer stirring (segment since last frame, subdivided)
    const dragging = cards!.dragging || dial.dragging
    if (ptr.has && (ptr.type === 'mouse' || ptr.down) && !dragging) {
      const dx = ptr.x - ptr.px
      const dy = ptr.y - ptr.py
      const dist = Math.hypot(dx, dy)
      if (dist > 0.5) {
        const steps = Math.min(4, Math.ceil(dist / 36))
        let vx = dx / dt
        let vy = dy / dt
        const vm = Math.hypot(vx, vy)
        if (vm > 4000) {
          vx *= 4000 / vm
          vy *= 4000 / vm
        }
        const k = force / Math.sqrt(steps)
        const c = inkAt(pal, time * 0.35)
        for (let s = 0; s < steps; s++) {
          const t = (s + 1) / steps
          emit({
            x: (ptr.px + dx * t) / W, y: (ptr.py + dy * t) / H, vx: vx * k, vy: vy * k,
            r: 0.022 + (Math.min(dist, 80) / 80) * 0.012, color: c,
            amount: Math.min(0.45, Math.max(0.02, (dist * 0.012) / steps)),
          })
        }
      }
    }
    ptr.px = ptr.x
    ptr.py = ptr.y

    // hold → pour
    const held = ptr.down ? (now - ptr.downAt) / 1000 : 0
    if (ptr.down && held > 0.22 && !dragging) {
      const hold = held - 0.22
      emit({ x: ptr.x / W, y: ptr.y / H, r: 0.022 + Math.min(hold, 3) * 0.012, color: inkAt(pal, time * 0.5), amount: 0.16 * f60, radial: 140 * f60 * force })
      cursor.pour = hold
    } else cursor.pour = Math.max(0, cursor.pour - dt * 6)

    autopilot(dt, now - lastInput > 3500, f60)

    // glass
    cards!.update(dt, time)
    shapes.length = 0
    cards!.shapes(shapes, H)
    const dr = dialEl.getBoundingClientRect()
    const dh = dr.width / 2
    shapes.push({ cx: dr.left + dh, cy: dr.top + dh, hw: dh, hh: dh, radius: dh, alpha: 1, bevel: dh * 0.55, refract: 26 })

    const sy = scrollY
    const scrollDelta = sy - lastScroll
    lastScroll = sy
    scrollProgress(kineticSections, H)

    const reveal = Math.min(1.1, Math.max(-0.1, (time - writeStart) / WRITE_DURATION))
    renderer.frame({
      dt, time, pal, light, shapes, scrollDelta, scrollY: sy, reveal, textRate: 1.5, calm: reduced,
    })
    cursor.update(dt)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // ── reveal: the drop swells, then opens a hole onto the ink ──
  await sleep(reduced ? 0 : 420)
  const drop = $('boot-drop')
  drop.classList.add('swell')
  await sleep(reduced ? 0 : 380)
  const dropRect = drop.getBoundingClientRect()
  const cx = dropRect.left + dropRect.width / 2
  const cy = dropRect.top + dropRect.height / 2
  document.body.classList.remove('booting')
  $('hero').classList.add('in')
  burst(cx / W, cy / H, 1.6, pal.text)
  writeStart = clock + (reduced ? 0 : 0.35)
  for (const s of sections) io.observe(s)
  await openHole(cx, cy, reduced ? 250 : 1250)
  document.body.classList.add('ready')
}

main().catch((err) => {
  console.error('[meridian] fatal', err)
  document.body.classList.remove('booting')
  $('boot').classList.add('gone')
  const n = $('notice')
  n.hidden = false
  n.textContent = `Something went wrong while starting: ${err?.message ?? err}`
})
