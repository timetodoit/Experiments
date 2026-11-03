import './style.css'
import init, { Survey, core_version } from './wasm/monument'
import wasmUrl from './wasm/monument_bg.wasm?url'
import { Rig } from './camera'
import { CHAPTERS, CLOUD_NAMES, restingCloud, shapeAt, turbulence } from './story'
import { rasteriseWord } from './text'
import { GpuView } from './gpu/renderer'
import { Fallback2D } from './fallback'
import { Drone } from './audio'
import type { FrameState, PointRenderer } from './frame'
import { type V3, clamp, damp, lerp } from './math'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const mobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches
/** `?canvas` forces the Canvas2D fallback (handy for checking it on a WebGPU machine) */
const force2d = new URLSearchParams(location.search).has('canvas')
/** points per cloud — every cloud has the same count so index i can morph between them */
const N = mobile ? 150_000 : 600_000
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const ms = (v: number) => `${v.toFixed(1)} MS`
const yieldPaint = () => new Promise<void>((r) => setTimeout(r, 24))
const bind = (key: string, text: string) => document.querySelectorAll(`[data-bind="${key}"]`).forEach((el) => (el.textContent = text))

// ── boot screen ──────────────────────────────────────────────────────────────
document.body.classList.add('booting')
const bootStart = performance.now()
const tbody = $('boot-table').querySelector('tbody')!
const bootN = $('boot-n')
const bootBar = $('boot-bar')
const bootClock = $('boot-clock')
$('boot-of').textContent = `of ${fmt(N * 4)}`
let shownPts = 0
let resolvedPts = 0
let bootLive = true
const bootTick = () => {
  if (!bootLive) return
  shownPts = reduced ? resolvedPts : lerp(shownPts, resolvedPts, 0.18)
  if (Math.abs(shownPts - resolvedPts) < 40) shownPts = resolvedPts
  bootN.textContent = fmt(shownPts)
  bootClock.textContent = `T+${String(Math.round(performance.now() - bootStart)).padStart(4, '0')} MS`
  requestAnimationFrame(bootTick)
}
requestAnimationFrame(bootTick)
const STEPS = 9
let stepsDone = 0
function row(label: string, detail: string, time = '', err = false) {
  const tr = document.createElement('tr')
  if (err) tr.className = 'err'
  for (const t of [label, detail, time]) {
    const td = document.createElement('td')
    td.textContent = t
    tr.appendChild(td)
  }
  tbody.appendChild(tr)
  stepsDone++
  bootBar.style.width = `${(stepsDone / STEPS) * 100}%`
}

// ── cursor + tag ─────────────────────────────────────────────────────────────
const cursor = $('cursor')
const tag = $('tag')
const tagId = $('tag-id')
const tagA = $('tag-a')
const tagB = $('tag-b')

async function initGPU() {
  if (!('gpu' in navigator)) return null
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return null
    const device = await adapter.requestDevice()
    return { adapter, device, format: navigator.gpu.getPreferredCanvasFormat() }
  } catch (err) {
    console.warn('WebGPU init failed', err)
    return null
  }
}

async function main() {
  // 1 — GPU
  let t = performance.now()
  const gpu = force2d ? null : await initGPU()
  let adapterName = 'Canvas2D'
  if (gpu) {
    const info = gpu.adapter.info
    adapterName = [info?.vendor, info?.architecture].filter(Boolean).join(' · ') || 'WebGPU adapter'
    row('GPU adapter', `${adapterName} · ${gpu.format}`.toUpperCase(), ms(performance.now() - t))
  } else {
    row('GPU adapter', 'WebGPU unavailable → Canvas2D subsample'.toUpperCase(), ms(performance.now() - t), true)
  }
  await yieldPaint()

  // 2 — Rust core
  t = performance.now()
  const wasm = await init({ module_or_path: wasmUrl })
  const bytes = await fetch(wasmUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => b.byteLength)
    .catch(() => 0)
  const kb = bytes ? (bytes / 1024).toFixed(1) : '—'
  row('WASM core', `${core_version()} · ${kb} KB`.toUpperCase(), ms(performance.now() - t))
  bind('wasm', `monument_bg.wasm · ${kb} KB`)
  await yieldPaint()

  // 3 — glyph mask (Canvas2D → bytes → Rust)
  t = performance.now()
  await document.fonts.ready
  const mask = await rasteriseWord('HOLLOW', mobile ? 1100 : 1500)
  row('Glyph mask', `HOLLOW · ${mask.w} × ${mask.h} PX · GEIST 800`, ms(performance.now() - t))
  bind('mask', `${mask.w} × ${mask.h}`)
  await yieldPaint()

  // 4–7 — point clouds, each timed on its own so the loader shows real Rust cost
  const survey = new Survey(N)
  const times: number[] = []
  const gen = async (label: string, detail: () => string, run: () => void) => {
    const t0 = performance.now()
    run()
    const dt = performance.now() - t0
    times.push(dt)
    resolvedPts += N
    row(label, detail(), ms(dt))
    await yieldPaint()
  }
  await gen('Cloud 01 monument', () => `${fmt(N)} PTS · ${survey.monument_primitives()} SDF PRIMS · ${fmt(survey.candidates(0))} CANDIDATES`, () => survey.gen_monument(3))
  await gen('Cloud 02 terrain', () => `${fmt(N)} PTS · HEIGHTFIELD + RUINS`, () => survey.gen_terrain(7))
  await gen('Cloud 03 type', () => `${fmt(N)} PTS · EXTRUDED 7.0 M`, () => survey.gen_type(mask.data, mask.w, mask.h, 92, 7, 0.4, 11))
  await gen('Cloud 04 nebula', () => `${fmt(N)} PTS · DISPERSED`, () => survey.gen_nebula(13))

  // 8 — pick grid for the first cloud (others are built lazily, on first hover)
  t = performance.now()
  const cells = survey.build_grid(0, 80)
  const gridMs = performance.now() - t
  const gridBuilt = [true, false, false, false]
  row('Pick grid', `MONUMENT · ${fmt(cells)} CELLS · 3D DDA`, ms(gridMs))
  const rustTotal = times.reduce((a, b) => a + b, 0) + gridMs
  await yieldPaint()

  // zero-copy views into Rust linear memory; re-made if memory grows (lazy grids)
  const views: Float32Array[] = []
  const view = (k: number) => {
    if (!views[k] || views[k].length === 0) views[k] = new Float32Array(wasm.memory.buffer, survey.cloud_ptr(k), survey.cloud_len(k))
    return views[k]
  }
  const clouds = [0, 1, 2, 3].map(view)

  // 9 — renderer
  t = performance.now()
  let canvas = $<HTMLCanvasElement>('view')
  let renderer: PointRenderer | null = null
  if (gpu) {
    try {
      renderer = await GpuView.create(gpu.device, canvas, gpu.format, clouds)
      const mb = ((N * 32) / 1048576).toFixed(1)
      row('WGSL pipelines', `CLOUD.WGSL · POST.WGSL · 4 × ${mb} MB STORAGE`, ms(performance.now() - t))
    } catch (err) {
      console.error(err)
      // a canvas that has handed out a webgpu context can't give a 2d one
      const fresh = canvas.cloneNode() as HTMLCanvasElement
      canvas.replaceWith(fresh)
      canvas = fresh
      renderer = null
    }
  }
  if (!renderer) {
    renderer = new Fallback2D(canvas, clouds, 20_000)
    if (gpu) row('WGSL pipelines', 'FAILED → CANVAS2D SUBSAMPLE', ms(performance.now() - t), true)
    else row('Canvas2D', `${fmt(renderer.count)} PT SUBSAMPLE · JS PROJECTION`, ms(performance.now() - t))
    $('degraded').hidden = false
    $('degraded-n').textContent = fmt(renderer.count)
  }
  const R = renderer
  views.length = 0 // memory may have grown while building pipelines; refresh lazily

  // bind the real numbers into the story
  bind('n-total', fmt(N * 4))
  bind('n-points', fmt(N))
  bind('n-prims', String(survey.monument_primitives()))
  bind('renderer', R.kind === 'webgpu' ? 'WebGPU' : 'Canvas2D fallback')
  bind('adapter', adapterName)
  const credits = $('credits-times')
  credits.textContent = ''
  ;['Monument', 'Terrain', 'Type', 'Nebula'].forEach((name, i) => {
    credits.append(`${name} · ${times[i].toFixed(1)} ms`, document.createElement('br'))
  })
  credits.append(`Total · ${rustTotal.toFixed(1)} ms`)

  await yieldPaint()
  resolvedPts = N * 4

  // ── scene state ────────────────────────────────────────────────────────────
  const rig = new Rig()
  const drone = new Drone()
  const sections = [...document.querySelectorAll<HTMLElement>('.ch')]
  const railLinks = [...document.querySelectorAll<HTMLAnchorElement>('#rail a')]
  const railFill = $('rail-fill')
  let secH = sections[0].offsetHeight
  let cf = 0
  let cfTarget = 0
  let activeCh = -1
  let introDone = false

  const readScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight
    if (scrollY >= max - 2) return 5
    return clamp(scrollY / Math.max(secH, 1), 0, 5)
  }

  // LiDAR sweep — reveal on load, a brightening pass on chapter changes
  const sweep = { front: -0.1, reveal: 1, strength: 1, t0: 0, dur: 3.4, active: false }
  const startSweep = (reveal: boolean) => {
    if (reduced) {
      sweep.active = false
      sweep.front = 1.2
      sweep.reveal = 0
      sweep.strength = 0
      return
    }
    sweep.active = true
    sweep.t0 = performance.now()
    sweep.dur = reveal ? 3.4 : 2.3
    sweep.reveal = reveal ? 1 : 0
    sweep.strength = reveal ? 1 : 0.8
    sweep.front = -0.1
  }

  const pointer = { x: innerWidth / 2, y: innerHeight / 2, inside: false, mouse: true, down: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false }
  const flash = { p: [0, 0, 0] as V3, r: 2, s: 0 }
  const sel: [number, number, number, number] = [0, 0, 0, 0]
  let shock: [number, number, number, number] = [0, 0, 0, 0]
  let pulse = 0
  let tapUntil = 0
  let shape = shapeAt(0)

  const ensureGrid = (k: number) => {
    if (gridBuilt[k]) return
    const t0 = performance.now()
    survey.build_grid(k, 80)
    gridBuilt[k] = true
    views.length = 0
    console.info(`[hollow] pick grid ${CLOUD_NAMES[k]} built in ${(performance.now() - t0).toFixed(1)} ms`)
  }

  type Hit = { idx: number; k: number; p: V3; it: number; dist: number }
  const pickAt = (px: number, py: number): Hit | null => {
    const k = restingCloud(shape)
    if (k < 0) return null
    ensureGrid(k)
    const nx = (px / innerWidth) * 2 - 1
    const ny = 1 - (py / innerHeight) * 2
    const { o, d } = rig.ray(nx, ny)
    const focal = rig.focalPx(innerHeight)
    const idx = survey.pick(k, o[0], o[1], o[2], d[0], d[1], d[2], 7 / focal, 1.2)
    if (idx < 0) return null
    const v = view(k)
    const p: V3 = [v[idx * 8], v[idx * 8 + 1], v[idx * 8 + 2]]
    return { idx, k, p, it: v[idx * 8 + 3], dist: Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]) }
  }

  const showTag = (hit: Hit | null, x: number, y: number) => {
    const transit = !hit && restingCloud(shape) < 0
    if (!hit && !transit) {
      tag.classList.remove('on')
      return
    }
    tag.classList.add('on')
    tag.classList.toggle('transit', transit)
    if (hit) {
      tagId.textContent = `PT #${fmt(hit.idx)}`
      tagA.textContent = `Z ${hit.p[1].toFixed(2)} M · INT ${hit.it.toFixed(2)}`
      tagB.textContent = `X ${hit.p[0].toFixed(2)} Y ${(-hit.p[2]).toFixed(2)} · ${CLOUD_NAMES[hit.k]}`
    } else {
      tagId.textContent = 'POINTS IN TRANSIT'
      tagA.textContent = `${CLOUD_NAMES[shape.a]} → ${CLOUD_NAMES[shape.b]}`
      tagB.textContent = `${Math.round(shape.mix * 100)}% · ${fmt(N)} PTS`
    }
    const w = tag.offsetWidth
    const h = tag.offsetHeight
    const tx = x + 22 + w > innerWidth - 8 ? x - 22 - w : x + 22
    const ty = y + 20 + h > innerHeight - 8 ? y - 20 - h : y + 20
    tag.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
  }

  const blast = (px: number, py: number) => {
    const hit = pickAt(px, py)
    let c: V3
    if (hit) c = hit.p
    else {
      const { o, d } = rig.ray((px / innerWidth) * 2 - 1, 1 - (py / innerHeight) * 2)
      const tt = d[1] < -0.01 ? Math.min(-o[1] / d[1], 400) : 60
      c = [o[0] + d[0] * tt, Math.max(0, o[1] + d[1] * tt), o[2] + d[2] * tt]
    }
    shock = [c[0], c[1], c[2], 1]
    pulse = 1
    drone.thump()
    const ring = document.createElement('i')
    ring.style.left = `${px}px`
    ring.style.top = `${py}px`
    $('ripples').appendChild(ring)
    setTimeout(() => ring.remove(), 1200)
    return hit
  }

  // ── input ──────────────────────────────────────────────────────────────────
  const interactive = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.('a,button')
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointer.mouse = e.pointerType === 'mouse'
    pointer.inside = true
    if (pointer.mouse) {
      cursor.classList.add('on')
      cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
    }
    if (pointer.down) {
      const dx = e.clientX - pointer.sx
      const dy = e.clientY - pointer.sy
      if (!pointer.moved && Math.hypot(dx, dy) > 6) {
        pointer.moved = true
        rig.dragging = true
      }
      if (pointer.moved) {
        rig.drag(e.clientX - pointer.lx, e.clientY - pointer.ly)
        pointer.lx = e.clientX
        pointer.ly = e.clientY
      }
    }
  })
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || interactive(e.target)) return
    pointer.down = true
    pointer.moved = false
    pointer.sx = pointer.lx = e.clientX
    pointer.sy = pointer.ly = e.clientY
  })
  const release = () => {
    pointer.down = false
    rig.dragging = false
  }
  window.addEventListener('pointerup', (e) => {
    if (pointer.down && !pointer.moved && !interactive(e.target)) {
      const hit = blast(e.clientX, e.clientY)
      if (e.pointerType !== 'mouse') {
        tapUntil = performance.now() + 1800
        showTag(hit, e.clientX, e.clientY)
        if (hit) {
          flash.p = hit.p
          flash.s = 1
        }
      }
    }
    release()
  })
  window.addEventListener('pointercancel', release)
  document.documentElement.addEventListener('pointerleave', () => {
    pointer.inside = false
    cursor.classList.remove('on')
    tag.classList.remove('on')
  })

  railLinks.forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const k = Number(a.dataset.ch)
      window.scrollTo({ top: k === 5 ? document.documentElement.scrollHeight : k * secH, behavior: reduced ? 'auto' : 'smooth' })
    }),
  )
  $('replay').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
    setTimeout(() => startSweep(true), reduced ? 0 : 900)
  })
  const soundBtn = $('sound')
  soundBtn.addEventListener('click', async () => {
    const on = await drone.toggle()
    soundBtn.setAttribute('aria-pressed', String(on))
    $('sound-label').textContent = on ? 'Sound on' : 'Sound off'
  })

  // ── layout ─────────────────────────────────────────────────────────────────
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    R.resize(innerWidth, innerHeight, dpr)
    rig.aspect = innerWidth / Math.max(innerHeight, 1)
    secH = sections[0].offsetHeight
  }
  resize()
  let resizeT = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeT)
    resizeT = window.setTimeout(resize, 100)
  })

  // ── reveal ─────────────────────────────────────────────────────────────────
  row('Total in Rust', `${fmt(N * 4)} POINTS · 4 CLOUDS`, ms(rustTotal))
  await new Promise((r) => setTimeout(r, reduced ? 0 : 420))
  bootLive = false
  bootN.textContent = fmt(N * 4)
  $('boot').classList.add('done')
  document.body.classList.remove('booting')
  setTimeout(() => $('boot').classList.add('gone'), 1400)
  setTimeout(() => {
    introDone = true
  }, reduced ? 0 : 3600)
  startSweep(true)
  cfTarget = readScroll()
  cf = cfTarget

  // ── HUD ────────────────────────────────────────────────────────────────────
  const hud = {
    fps: $('fps'),
    cam: $('t-cam'),
    hdg: $('t-hdg'),
    cloud: $('t-cloud'),
    pts: $('t-pts'),
    ch: $('nav-ch'),
  }
  hud.pts.textContent = R.kind === 'webgpu' ? `${fmt(R.count)} × 4` : `${fmt(R.count)} / ${fmt(N)}`
  let fps = 60
  let frameNo = 0

  const fs: FrameState = {
    viewProj: rig.viewProj,
    eye: [0, 0, 0],
    focalCss: 1,
    time: 0,
    dt: 0,
    reduced,
    a: 0,
    b: 1,
    mix: 0,
    turbulence: 1,
    sweepFront: -0.1,
    sweepReveal: 1,
    sweepWidth: 0.0075,
    sweepStrength: 1,
    flash: [0, 0, 0, 1],
    flashStrength: 0,
    shock: [0, 0, 0, 0],
    sel: [0, 0, 0, 0],
    intro: 0,
    pulse: 0,
  }

  let last = performance.now()
  const start = last
  let intro = 0
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    const time = (now - start) / 1000
    intro = Math.min(1, intro + dt * 2)

    // scroll → damped chapter coordinate → camera + morph
    cfTarget = readScroll()
    cf = damp(cf, cfTarget, reduced ? 14 : 3.2, dt)
    if (Math.abs(cf - cfTarget) < 1e-4) cf = cfTarget
    rig.update(cf, dt, time, reduced)
    shape = shapeAt(cf)

    // chapter state
    const ch = clamp(Math.round(cfTarget), 0, 5)
    if (ch !== activeCh) {
      sections.forEach((s, i) => s.classList.toggle('on', i === ch))
      railLinks.forEach((a, i) => a.classList.toggle('on', i === ch))
      hud.ch.textContent = `${CHAPTERS[ch].n} ${CHAPTERS[ch].name}`
      if (activeCh >= 0 && introDone) startSweep(false)
      activeCh = ch
    }
    railFill.style.height = `${(cf / 5) * 100}%`

    // sweep
    if (sweep.active) {
      const k = clamp((now - sweep.t0) / (sweep.dur * 1000), 0, 1)
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      sweep.front = lerp(-0.08, 1.12, e)
      if (k >= 1) {
        sweep.active = false
        sweep.reveal = 0
        sweep.strength = 0
      }
    }

    // hover scan (mouse) / tap readout (touch)
    let hit: Hit | null = null
    const tapping = now < tapUntil
    if (pointer.inside && pointer.mouse && !pointer.moved && introDone) {
      hit = pickAt(pointer.x, pointer.y)
      showTag(hit, pointer.x, pointer.y)
    } else if (!tapping && !pointer.mouse) {
      tag.classList.remove('on')
    } else if (pointer.mouse && (pointer.moved || !pointer.inside)) {
      tag.classList.remove('on')
    }
    if (pointer.mouse) {
      if (!interactive(document.elementFromPoint(pointer.x, pointer.y))) cursor.dataset.mode = pointer.moved ? 'drag' : hit ? 'lock' : ''
      else cursor.dataset.mode = 'link'
    }
    if (hit) {
      if (flash.s < 0.05) flash.p = hit.p
      flash.p = [damp(flash.p[0], hit.p[0], 20, dt), damp(flash.p[1], hit.p[1], 20, dt), damp(flash.p[2], hit.p[2], 20, dt)]
      flash.r = damp(flash.r, clamp(hit.dist * 0.05, 1.2, 5.5), 10, dt)
      flash.s = damp(flash.s, 1, 10, dt)
      sel[0] = hit.p[0]
      sel[1] = hit.p[1]
      sel[2] = hit.p[2]
      sel[3] = 1
    } else {
      flash.s = damp(flash.s, 0, tapping ? 1.5 : 6, dt)
      if (!tapping) sel[3] = 0
    }

    // frame
    fs.eye = rig.eye
    fs.focalCss = rig.focalPx(innerHeight)
    fs.time = time
    fs.dt = dt
    fs.a = shape.a
    fs.b = shape.b
    fs.mix = shape.mix
    fs.turbulence = reduced ? 0.3 : 1
    fs.sweepFront = sweep.front
    fs.sweepReveal = sweep.reveal
    fs.sweepStrength = sweep.strength
    fs.flash = [flash.p[0], flash.p[1], flash.p[2], flash.r]
    fs.flashStrength = flash.s
    fs.shock = shock
    fs.sel = sel
    fs.intro = intro
    fs.pulse = pulse
    R.frame(fs)
    shock = [0, 0, 0, 0]
    pulse = damp(pulse, 0, 5, dt)

    drone.update(cf, turbulence(shape.mix))

    // HUD (throttled)
    fps = damp(fps, 1 / Math.max(dt, 1e-3), 3, dt)
    if (frameNo++ % 8 === 0) {
      const e = rig.eye
      const att = rig.attitude()
      hud.fps.textContent = `${Math.round(fps)} FPS`
      hud.cam.textContent = `X ${e[0].toFixed(1)}  Y ${(-e[2]).toFixed(1)}  Z ${e[1].toFixed(1)}`
      hud.hdg.textContent = `${att.hdg.toFixed(1)}°  P ${att.pitch.toFixed(1)}°  FOV ${((rig.fov * 180) / Math.PI).toFixed(0)}`
      hud.cloud.textContent =
        shape.mix > 0.005 && shape.mix < 0.995
          ? `${CLOUD_NAMES[shape.a]} → ${CLOUD_NAMES[shape.b]} ${String(Math.round(shape.mix * 100)).padStart(2, '0')}%`
          : CLOUD_NAMES[shape.mix >= 0.995 ? shape.b : shape.a]
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // a handle for whoever is inspecting this in devtools
  ;(window as unknown as { __hollow: unknown }).__hollow = { survey, rig, renderer: R, times, rustTotal, N }
}

main().catch((err) => {
  console.error(err)
  row('Fatal', String(err?.message ?? err).toUpperCase(), '', true)
})
