import './style.css'
import { STATIONS, F_MIN, tune, css } from './stations'
import { Dial } from './dial'
import { RadioEngine } from './audio/engine'
import { SignalGPU } from './gpu/signal'
import { Signal2D } from './fallback'
import { FONT } from './glyphs'
import type { FrameState, Renderer } from './renderer'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const fract = (x: number) => x - Math.floor(x)
const hash = (a: number, b: number) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453)

const rmq = matchMedia('(prefers-reduced-motion: reduce)')
let motion = rmq.matches ? 0 : 1
rmq.addEventListener('change', (e) => (motion = e.matches ? 0 : 1))

// ── test card readout ────────────────────────────────────────────────────────
const tcRead = $('tc-read')
const aboutSys = $('about-sys')
const readRows = new Map<string, HTMLElement>()
function setRead(key: string, value: string) {
  let dd = readRows.get(key)
  if (!dd) {
    const dt = document.createElement('dt')
    dt.textContent = key
    dd = document.createElement('dd')
    tcRead.append(dt, dd)
    readRows.set(key, dd)
  }
  dd.textContent = value
  let row = aboutSys.querySelector<HTMLElement>(`[data-k="${key}"]`)
  if (!row) {
    row = document.createElement('div')
    row.dataset.k = key
    row.innerHTML = `<dt></dt><dd></dd>`
    aboutSys.appendChild(row)
  }
  row.querySelector('dt')!.textContent = key
  row.querySelector('dd')!.textContent = value
}
document.querySelectorAll<HTMLElement>('.tc-pluge i').forEach((el, i) => el.style.setProperty('--k', String(Math.round((i / 11) * 100))))

// ── clock ────────────────────────────────────────────────────────────────────
const clockEl = $('clock')
const tcClock = $('tc-clock')
const tickClock = () => {
  const d = new Date()
  const s = d.toTimeString().slice(0, 8)
  const off = -d.getTimezoneOffset() / 60
  clockEl.textContent = `${s} UTC${off >= 0 ? '+' : '−'}${Math.abs(off)}`
  tcClock.textContent = s
}
tickClock()
setInterval(tickClock, 1000)

// ── cursor ───────────────────────────────────────────────────────────────────
const cursor = $('cursor')
const cursorRead = $('cursor-read')
let overUI: 'link' | 'dial' | '' = ''
window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return
  cursor.classList.add('on')
  cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
  const t = e.target as HTMLElement
  overUI = t.closest('.dial') ? 'dial' : t.closest('a,button,input,label') ? 'link' : ''
})
document.addEventListener('pointerleave', () => cursor.classList.remove('on'))

// ── GPU ──────────────────────────────────────────────────────────────────────
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

// ── state ────────────────────────────────────────────────────────────────────
const CELLS = [8, 10, 12, 14, 16]
const autoCell = () => (innerWidth < 600 ? 8 : innerWidth < 1100 ? 10 : 12)
let cellCss = autoCell()
let cellPicked = false
let renderer: Renderer
let engine: RadioEngine | null = null
let canvas = $<HTMLCanvasElement>('screen')
const dial = new Dial($('dial'), F_MIN)

function swapToFallback(reason: string) {
  if (renderer?.kind === 'canvas2d') return
  console.warn('Switching to Canvas2D:', reason)
  const fresh = document.createElement('canvas')
  fresh.id = 'screen'
  fresh.setAttribute('role', 'img')
  fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') ?? '')
  canvas.replaceWith(fresh)
  canvas = fresh
  renderer = new Signal2D(canvas)
  $('degraded').hidden = false
  layout()
}

function layout() {
  const dpr = Math.min(devicePixelRatio || 1, 2)
  renderer.resize(innerWidth, innerHeight, dpr, cellCss)
  document.documentElement.style.setProperty('--tuner-h', `${$('tuner-root').offsetHeight}px`)
  dial.layout()
  $('res-val').textContent = `${cellCss} px`
  setRead('Grid', `${renderer.cols} × ${renderer.rows} cells`)
  setRead('Cell', `${cellCss} px · DPR ${dpr.toFixed(2).replace(/\.?0+$/, '')}`)
}

// ── presets ──────────────────────────────────────────────────────────────────
const presetsEl = $('presets')
const presetBtns = STATIONS.map((s, i) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.innerHTML = `<i>${String(i + 1).padStart(2, '0')}</i>${s.freq.toFixed(1)}<span>${s.name}</span>`
  b.setAttribute('aria-label', `Tune to ${s.name}, ${s.freq.toFixed(1)} megahertz`)
  b.addEventListener('click', () => preset(i))
  presetsEl.appendChild(b)
  return b
})

let glitchEnv = 0
function preset(i: number) {
  const to = STATIONS[i].freq
  if (Math.abs(dial.freq - to) < 0.05) return
  engine?.burst(1.2)
  glitchEnv = 1
  dial.jump(to, 1.2)
}

// ── pointer: orbit, pulse, hold ──────────────────────────────────────────────
const mouseT: [number, number] = [0, 0]
const mouse: [number, number] = [0, 0]
let press: { id: number; x: number; y: number; t: number } | null = null
let holding = false
let keyHold = false
let holdPos: [number, number] = [0.5, 0.5]
let stime = 0
let rtime = 0
const isUI = (t: EventTarget | null) => !!(t as HTMLElement)?.closest?.('.top, .tuner, .now, .about, #boot, a, button, input')

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' || press?.id === e.pointerId) {
    mouseT[0] = (e.clientX / innerWidth) * 2 - 1
    mouseT[1] = -((e.clientY / innerHeight) * 2 - 1)
  }
  if (press?.id === e.pointerId) holdPos = [e.clientX / innerWidth, e.clientY / innerHeight]
})
window.addEventListener('pointerdown', (e) => {
  if (isUI(e.target) || press) return
  press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
  holdPos = [e.clientX / innerWidth, e.clientY / innerHeight]
  if (e.pointerType !== 'mouse') {
    mouseT[0] = (e.clientX / innerWidth) * 2 - 1
    mouseT[1] = -((e.clientY / innerHeight) * 2 - 1)
  }
})
const release = (e: PointerEvent) => {
  if (!press || press.id !== e.pointerId) return
  if (performance.now() - press.t < 260) firePulse(press.x / innerWidth, press.y / innerHeight)
  press = null
  holding = false
}
window.addEventListener('pointerup', release)
window.addEventListener('pointercancel', release)

function firePulse(x: number, y: number) {
  renderer.firePulse(x, y, rtime, stime)
  engine?.pulse()
}

// ── keyboard ─────────────────────────────────────────────────────────────────
const about = $('about')
const aboutBtn = $('about-btn')
function setAbout(open: boolean) {
  about.hidden = !open
  aboutBtn.setAttribute('aria-expanded', String(open))
  if (open) $('about-close').focus()
  else aboutBtn.focus()
}
aboutBtn.addEventListener('click', () => setAbout(true))
$('about-close').addEventListener('click', () => setAbout(false))

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !about.hidden) return setAbout(false)
  if (!about.hidden || (e.target as HTMLElement).tagName === 'INPUT') return
  if (document.body.classList.contains('booting')) return
  const step = e.shiftKey ? 1 : 0.1
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
    dial.nudge(step)
    e.preventDefault()
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
    dial.nudge(-step)
    e.preventDefault()
  } else if (e.key >= '1' && e.key <= '4') {
    preset(Number(e.key) - 1)
  } else if (e.key === 'PageUp' || e.key === 'PageDown') {
    const dir = e.key === 'PageUp' ? 1 : -1
    const cur = tune(dial.freq).nearest
    preset((cur + dir + STATIONS.length) % STATIONS.length)
    e.preventDefault()
  } else if (e.key === ' ' && !(e.target as HTMLElement).closest('button')) {
    if (!keyHold) holdPos = [0.5, 0.45]
    keyHold = true
    e.preventDefault()
  } else if (e.key === 'p' || e.key === 'P' || e.key === 'Enter') {
    if ((e.target as HTMLElement).closest('button, a')) return
    firePulse(0.5, 0.45)
  }
})
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') keyHold = false
})

// ── resolution ───────────────────────────────────────────────────────────────
const stepCell = (dir: number) => {
  const i = CELLS.indexOf(cellCss)
  const j = clamp((i < 0 ? CELLS.indexOf(12) : i) + dir, 0, CELLS.length - 1)
  if (CELLS[j] === cellCss) return
  cellCss = CELLS[j]
  cellPicked = true
  layout()
}
$('res-up').addEventListener('click', () => stepCell(-1))
$('res-dn').addEventListener('click', () => stepCell(1))

// ── volume ───────────────────────────────────────────────────────────────────
const vol = $<HTMLInputElement>('vol')
vol.addEventListener('input', () => engine?.setVolume(Number(vol.value) / 100))

// ── HUD ──────────────────────────────────────────────────────────────────────
const meterEl = $('meter')
const meterBars = Array.from({ length: 12 }, (_, i) => {
  const b = document.createElement('i')
  b.style.height = `${6 + i}px`
  meterEl.appendChild(b)
  return b
})
const el = {
  freq: $('freq'),
  lock: $('lock'),
  name: $('st-name'),
  num: $('st-num'),
  tag: $('st-tag'),
  track: $('np-track'),
  artist: $('np-artist'),
  from: $('np-from'),
  coords: $('np-coords'),
  time: $('np-time'),
  now: $('now'),
  listeners: $('listeners'),
  spectrum: $('spectrum'),
  bass: $('b-bass'),
  mid: $('b-mid'),
  high: $('b-high'),
  stretch: $('stretch'),
  stretchVal: $('stretch-val'),
  onair: $('onair'),
}
const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@?'
const listeners = STATIONS.map((s) => s.listeners)
let listenT = 0
let lockedIdx = -1
let lockedAt = 0
let hudT = 0
let lastNearest = -1
let lastCss = ''

function gauge(v: number, n = 8) {
  const k = Math.round(clamp(v) * n)
  return '▮'.repeat(k) + '▯'.repeat(n - k)
}

function spectrumText(cols = 28, rows = 6) {
  const lines: string[] = []
  const vals: number[] = []
  if (engine) {
    const spec = engine.spectrum
    const hz = engine.ctx.sampleRate / engine.analyser.fftSize
    for (let c = 0; c < cols; c++) {
      const f0 = 40 * Math.pow(16000 / 40, c / cols)
      const f1 = 40 * Math.pow(16000 / 40, (c + 1) / cols)
      const i0 = Math.max(1, Math.floor(f0 / hz))
      const i1 = Math.max(i0, Math.min(spec.length - 1, Math.floor(f1 / hz)))
      let s = 0
      for (let i = i0; i <= i1; i++) s += spec[i]
      vals.push(s / ((i1 - i0 + 1) * 255))
    }
  } else for (let c = 0; c < cols; c++) vals.push(0.05 + 0.04 * Math.random())
  for (let r = rows - 1; r >= 0; r--) {
    let line = ''
    for (const v of vals) {
      const lv = v * rows
      line += lv >= r + 1 ? '█' : lv >= r + 0.5 ? '▄' : '·'
    }
    lines.push(line)
  }
  return lines.join('\n')
}

function updateHUD(dt: number, f: number, tn: ReturnType<typeof tune>, bands: FrameState['bands'], slow: number) {
  const st = STATIONS[tn.nearest]
  const sig = tn.signal
  el.freq.textContent = f.toFixed(1)

  const lit = Math.round(clamp(sig + (Math.random() - 0.5) * 0.25 * (1 - sig)) * 12)
  meterBars.forEach((b, i) => b.classList.toggle('on', i < lit))
  const locked = sig > 0.92
  el.lock.textContent = locked ? 'Locked' : sig > 0.25 ? 'Weak' : 'Seek…'
  el.lock.classList.toggle('locked', locked)
  el.onair.classList.toggle('live', sig > 0.5)

  const nowLocked = locked ? tn.nearest : -1
  if (nowLocked !== lockedIdx) {
    lockedIdx = nowLocked
    if (locked) {
      lockedAt = rtime
      document.title = `Signal FM — ${st.freq.toFixed(1)} ${st.name}`
    }
    presetBtns.forEach((b, i) => b.classList.toggle('on', i === lockedIdx))
  }

  if (tn.nearest !== lastNearest) {
    lastNearest = tn.nearest
    el.num.textContent = `${String(tn.nearest + 1).padStart(2, '0')} / ${String(STATIONS.length).padStart(2, '0')}`
    el.tag.textContent = `${st.freq.toFixed(1)} FM · ${st.tag}`
    el.track.textContent = st.track
    el.artist.textContent = st.artist
    el.from.textContent = st.from
    el.coords.textContent = st.coords
  }

  // name resolves out of noise as you tune in
  const tq = Math.floor(rtime * 14)
  const p = motion ? clamp((1 - sig) * 1.15) : 0
  el.name.textContent = [...st.name].map((ch, i) => (ch !== ' ' && hash(i + 1, tq) < p ? SCRAMBLE[Math.floor(hash(tq, i) * SCRAMBLE.length)] : ch)).join('')
  el.name.classList.toggle('weak', sig < 0.35)
  el.now.style.opacity = String(0.35 + 0.65 * sig)

  listenT -= dt
  if (listenT <= 0) {
    listenT = 1.2 + Math.random() * 1.8
    listeners.forEach((v, i) => (listeners[i] = Math.max(3, Math.round(v + (Math.random() - 0.45) * Math.max(3, v * 0.004)))))
  }
  el.listeners.textContent = sig > 0.3 ? listeners[tn.nearest].toLocaleString('en-US') : '—'
  const el2 = locked ? Math.floor(rtime - lockedAt) : 0
  el.time.textContent = locked ? `${String(Math.floor(el2 / 60)).padStart(2, '0')}:${String(el2 % 60).padStart(2, '0')}` : '--:--'

  el.spectrum.textContent = spectrumText()
  el.bass.textContent = gauge(bands[0])
  el.mid.textContent = gauge(bands[1])
  el.high.textContent = gauge(bands[2])

  el.stretch.classList.toggle('on', slow > 0.04)
  el.stretchVal.textContent = `${(engine ? engine.rate : 1 - 0.46 * slow).toFixed(2)}×`
}

// ── boot ─────────────────────────────────────────────────────────────────────
async function main() {
  const fast = motion ? 1 : 0
  setRead('Station', 'Signal FM · 4 transmitters')
  setRead('Adapter', 'requesting…')
  const gpu = await initGPU()
  if (gpu) {
    const info = gpu.adapter.info
    const name = [info?.vendor, info?.architecture, info?.device].filter(Boolean).join(' · ') || 'WebGPU adapter'
    setRead('Adapter', name.toUpperCase())
    setRead('Backend', `WebGPU · ${gpu.format}`)
  } else {
    setRead('Adapter', 'none — WebGPU unavailable')
    setRead('Backend', 'Canvas2D fallback')
  }
  await sleep(160 * fast)

  try {
    await Promise.all([document.fonts.load(`600 24px ${FONT}`), document.fonts.load(`700 24px ${FONT}`), document.fonts.load('48px "Anton"')])
  } catch {
    /* fonts are a nicety */
  }

  if (gpu) {
    setRead('Scenes', 'compiling WGSL…')
    try {
      const t0 = performance.now()
      renderer = await SignalGPU.create(gpu.device, canvas, gpu.format)
      setRead('Scenes', `4 / 4 raymarchers · ${(performance.now() - t0).toFixed(0)} ms`)
      gpu.device.lost.then((info) => {
        console.warn('WebGPU device lost:', info.message)
        if (info.reason !== 'destroyed') swapToFallback('device lost')
      })
    } catch (err) {
      console.error(err)
      setRead('Scenes', 'WGSL failed — Canvas2D')
      renderer = new Signal2D(canvas)
      $('degraded').hidden = false
    }
  } else {
    renderer = new Signal2D(canvas)
    setRead('Scenes', '4 / 4 Canvas2D fields')
    $('degraded').hidden = false
  }
  layout()
  let resizeT = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeT)
    resizeT = window.setTimeout(() => {
      if (!cellPicked) cellCss = autoCell()
      layout()
    }, 120)
  })
  await sleep(160 * fast)
  setRead('Audio', 'awaiting gesture')
  setRead('Dial', '88.0 – 108.0 MHz')

  const btn = $<HTMLButtonElement>('tune-in')
  btn.disabled = false
  $('tune-state').textContent = 'Click to start the audio'
  btn.focus({ preventScroll: true })
  btn.addEventListener('click', async () => {
    btn.disabled = true
    try {
      engine = new RadioEngine(STATIONS.length)
      await engine.resume()
      engine.setVolume(Number(vol.value) / 100)
      engine.lineup()
      setRead('Audio', `${engine.ctx.sampleRate} Hz · running`)
    } catch (err) {
      console.error('Web Audio unavailable', err)
      engine = null
      setRead('Audio', 'unavailable')
    }
    $('boot').classList.add('off')
    setTimeout(() => $('boot').classList.add('gone'), motion ? 1200 : 50)
    document.body.classList.remove('booting')
    // sweep up from the bottom of the band, through the static, into station 1
    setTimeout(() => dial.jump(STATIONS[0].freq, 2.2), motion ? 500 : 50)
  })

  dial.onTick = (s) => engine?.tick(s)
  dial.onGrab = () => {
    if (document.activeElement !== $('dial')) $('dial').focus({ preventScroll: true })
  }

  // ── loop ──
  let last = performance.now()
  let slow = 0
  let beat = 0
  let bassSlow = 0
  let beatCool = 0
  let sceneGlitch = 0
  let lastScene = -1
  const idle: FrameState['bands'] = [0, 0, 0, 0]
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    rtime += dt

    const f = dial.update(dt)
    const tn = tune(f)
    if (engine) engine.setTuning(tn.signals, dt)

    if (press && performance.now() - press.t > 260) holding = true
    const wantSlow = holding || keyHold ? 1 : 0
    slow += (wantSlow - slow) * (1 - Math.exp(-dt * (wantSlow ? 3.2 : 5)))
    engine?.setSlow(slow)
    stime += dt * (1 - 0.78 * slow)

    let bands: FrameState['bands']
    if (engine) {
      const b = engine.analyse(dt)
      bands = [b.bass, b.mid, b.high, b.level]
    } else {
      idle[0] = 0.18 + 0.1 * Math.sin(rtime * 1.3)
      idle[1] = 0.15 + 0.08 * Math.sin(rtime * 0.7 + 1)
      idle[2] = 0.1 + 0.06 * Math.sin(rtime * 2.1)
      idle[3] = 0.15
      bands = idle
    }
    bassSlow += (bands[0] - bassSlow) * (1 - Math.exp(-dt * 3))
    beatCool -= dt
    if (bands[0] - bassSlow > 0.1 && beatCool <= 0) {
      beat = 1
      beatCool = 0.16
    }
    beat *= Math.exp(-dt * 8)

    if (tn.nearest !== lastScene) {
      if (lastScene >= 0) sceneGlitch = 0.7
      lastScene = tn.nearest
    }
    sceneGlitch *= Math.exp(-dt * 3)
    glitchEnv = Math.max(0, glitchEnv - dt / 1.2)
    const glitch = Math.max(Math.sin(glitchEnv * Math.PI) * 1.1, sceneGlitch, (1 - tn.signal) * 0.2)

    mouse[0] += (mouseT[0] - mouse[0]) * (1 - Math.exp(-dt * 3))
    mouse[1] += (mouseT[1] - mouse[1]) * (1 - Math.exp(-dt * 3))

    const c = `${css(tn.ink)}|${css(tn.paper)}|${css(tn.accent)}`
    if (c !== lastCss) {
      lastCss = c
      const root = document.documentElement.style
      root.setProperty('--ink', css(tn.ink))
      root.setProperty('--paper', css(tn.paper))
      root.setProperty('--accent', css(tn.accent))
    }

    hudT -= dt
    if (hudT <= 0) {
      hudT = 1 / 24
      updateHUD(1 / 24, f, tn, bands, slow)
    }

    // cursor
    if (holding || keyHold) {
      cursor.dataset.mode = 'hold'
      cursorRead.textContent = `${(1 - 0.46 * slow).toFixed(2)}×`
    } else if (press) {
      cursor.dataset.mode = 'press'
      cursorRead.textContent = ''
    } else {
      cursor.dataset.mode = overUI
      cursorRead.textContent = overUI === 'dial' ? '◂ tune ▸' : ''
    }

    const state: FrameState = {
      time: stime,
      rtime,
      bands,
      mouse,
      scene: tn.nearest,
      signal: tn.signal,
      glitch: glitch * motion,
      motion,
      slow,
      beat: beat * (motion ? 1 : 0.4),
      ink: tn.ink,
      paper: tn.paper,
      accent: tn.accent,
      hold: [holdPos[0], holdPos[1], slow],
    }
    try {
      renderer.frame(state)
    } catch (err) {
      console.error(err)
      swapToFallback('frame error')
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

main().catch((err) => {
  console.error(err)
  setRead('Fatal', String(err?.message ?? err))
})
