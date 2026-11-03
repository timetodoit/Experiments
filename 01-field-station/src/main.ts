import './style.css'
import init, { core_version } from './wasm/physics'
import wasmUrl from './wasm/physics_bg.wasm?url'
import { Survey } from './gpu/survey'
import { SheetRenderer, canvasTexture } from './gpu/sheet'
import { Survey2D, Sheet2D } from './fallback'
import { SurveyController, type SurveyRenderer } from './surveyCtl'
import { Specimen } from './specimen'
import { Taxonomy } from './taxonomy'
import { Xray } from './xray'
import { paintHerbarium } from './herbarium'
import type { SheetView } from './camera'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

// ── boot screen ──────────────────────────────────────────────────────────────
const bootCells = $('boot-cells')
for (let i = 0; i < 48; i++) bootCells.appendChild(document.createElement('i'))
const logEl = $('boot-log')
const pctEl = $('boot-pct')
document.body.classList.add('booting')
let pct = 0
const setPct = (p: number) => {
  pct = Math.max(pct, p)
  pctEl.textContent = String(Math.round(pct)).padStart(3, '0')
}
async function log(line: string, p: number) {
  const fast = reduced ? 0 : 9
  const row = document.createTextNode('')
  logEl.appendChild(row)
  for (let i = 0; i <= line.length; i++) {
    row.textContent = line.slice(0, i)
    if (fast && i % 2 === 0) await sleep(fast)
  }
  logEl.appendChild(document.createTextNode('\n'))
  setPct(p)
}

// ── cursor ───────────────────────────────────────────────────────────────────
const cursor = $('cursor')
const cursorRead = $('cursor-read')
let cursorOwner = ''
window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return
  cursor.classList.add('on')
  cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
  const over = (e.target as HTMLElement).closest('a,button')
  if (over) {
    cursor.dataset.mode = 'link'
    cursorRead.textContent = ''
    cursorOwner = 'link'
  } else if (cursorOwner === 'link') {
    cursor.dataset.mode = ''
    cursorOwner = ''
  }
})
document.addEventListener('pointerleave', () => cursor.classList.remove('on'))
const setCursor = (owner: string) => (mode: string, read: string) => {
  if (cursorOwner === 'link') return
  cursorOwner = mode || read ? owner : ''
  cursor.dataset.mode = mode
  cursorRead.textContent = read
}

// ── clock ────────────────────────────────────────────────────────────────────
const clock = $('clock')
setInterval(() => (clock.textContent = new Date().toISOString().slice(11, 19) + ' UTC'), 1000)

async function initGPU() {
  if (!('gpu' in navigator)) return null
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return null
    const device = await adapter.requestDevice()
    device.lost.then((info) => console.warn('WebGPU device lost:', info.message))
    return { adapter, device, format: navigator.gpu.getPreferredCanvasFormat() }
  } catch (err) {
    console.warn('WebGPU init failed', err)
    return null
  }
}

async function main() {
  await log('FIELD STATION 04 — SURVEY UNIT · BOOT', 6)
  await log('REQUESTING GPU ADAPTER ............', 14)
  const gpu = await initGPU()
  if (gpu) {
    const info = gpu.adapter.info
    const name = [info?.vendor, info?.architecture].filter(Boolean).join(' · ') || 'adapter'
    await log(`  ↳ ${name.toUpperCase()} · ${gpu.format.toUpperCase()}`, 24)
  } else {
    await log('  ↳ WEBGPU UNAVAILABLE — DEGRADING TO CANVAS2D', 24)
    $('degraded').hidden = false
  }

  await log('LOADING RUST CORE .................', 32)
  const t0 = performance.now()
  const wasm = await init({ module_or_path: wasmUrl })
  const bytes = await fetch(wasmUrl).then((r) => r.arrayBuffer()).then((b) => b.byteLength).catch(() => 0)
  const kb = bytes ? (bytes / 1024).toFixed(1) : '—'
  $('wasm-size').textContent = `physics_bg.wasm · ${kb} KB`
  await log(`  ↳ ${core_version().toUpperCase()} · ${kb} KB · ${(performance.now() - t0).toFixed(0)} MS`, 46)

  await document.fonts.ready

  // ── survey ──
  const surveyCanvas = $<HTMLCanvasElement>('survey-canvas')
  let surveyRenderer: SurveyRenderer
  if (gpu) {
    const mobile = matchMedia('(max-width: 760px)').matches
    const count = mobile ? 1 << 15 : 1 << 17
    await log(`COMPILING WGSL · survey.wgsl · ${count.toLocaleString('en-US')} PARTICLES`, 58)
    surveyRenderer = new Survey(gpu.device, surveyCanvas, gpu.format, count)
  } else {
    await log('RASTERISING TERRAIN ON CPU ........', 58)
    surveyRenderer = new Survey2D(surveyCanvas)
  }
  const survey = new SurveyController(surveyRenderer, $('survey-sticky'), $('survey'), {
    markers: $('markers'),
    label: $('lens-label'),
    name: $('lens-name'),
    sub: $('lens-sub'),
    title: $('hero-title'),
    coords: $('coords'),
    elev: $('r-elev'),
    slope: $('r-slope'),
    zoom: $('r-zoom'),
    count: $('r-count'),
    fpsEl: $('r-fps'),
    cue: document.querySelector('.scroll-cue') as HTMLElement,
    cursorRead: (s) => {
      if (cursorOwner === 'link' || cursorOwner === 'sheet' || cursorOwner === 'tax') return
      cursor.dataset.mode = ''
      cursorRead.textContent = s
    },
  })
  $('particle-count').textContent = surveyRenderer.count.toLocaleString('en-US')

  // ── specimen ──
  await log('PRESSING SPECIMEN FS04-0001 ........', 70)
  const sheetCanvas = $<HTMLCanvasElement>('sheet-canvas')
  let sheetView: SheetView
  if (gpu) {
    const tex = canvasTexture(gpu.device, paintHerbarium())
    sheetView = new SheetRenderer(gpu.device, sheetCanvas, gpu.format, 41 * 51 * 8, 40 * 50 * 6, tex)
  } else {
    sheetView = new Sheet2D(sheetCanvas)
  }
  const specimen = new Specimen(sheetView, wasm.memory, $('sheet-wrap'), {
    clips: $('clips'),
    wire: $('wire'),
    particles: $('s-particles'),
    constraints: $('s-constraints'),
    iter: $('s-iter'),
    torn: $('s-torn'),
    ms: $('s-ms'),
    mode: $('sheet-mode'),
    scalpelBtn: $('b-scalpel'),
    windBtn: $('b-wind'),
    windVal: $('wind-val'),
    dropBtn: $('b-drop'),
    resetBtn: $('b-reset'),
    cursor: setCursor('sheet'),
  })
  await log(`  ↳ ${specimen.cloth.particle_count()} PARTICLES · ${specimen.cloth.constraint_count()} CONSTRAINTS`, 80)

  // ── taxonomy ──
  const taxonomy = new Taxonomy($('taxonomy'), $('arena'), wasm.memory, {
    readout: $('t-readout'),
    flip: $('b-flip'),
    scatter: $('b-scatter'),
    respawn: $('b-respawn'),
    cursor: setCursor('tax'),
  })
  await log('SEEDING TAXONOMY · 36 RIGID BODIES', 90)

  // ── x-ray ──
  const xray = new Xray($('stage'), $('xray-count'), (on) => {
    sheetView.xray = on ? 1 : 0
  })
  $('xray-btn').addEventListener('click', () => xray.toggle())
  $('xray-cta').addEventListener('click', () => xray.toggle(true))

  // ── layout ──
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const sticky = $('survey-sticky')
    survey.resize(sticky.clientWidth, sticky.clientHeight, dpr)
    const wrap = $('sheet-wrap')
    specimen.resize(wrap.clientWidth, wrap.clientHeight, dpr)
    taxonomy.layout()
  }
  resize()
  let resizeT = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeT)
    resizeT = window.setTimeout(() => !xray.on && resize(), 120)
  })

  const watch = (el: HTMLElement, set: (v: boolean) => void) =>
    new IntersectionObserver((e) => set(e[0].isIntersecting), { rootMargin: '120px' }).observe(el)
  watch($('specimen'), (v) => (specimen.visible = v))
  watch($('taxonomy'), (v) => (taxonomy.visible = v))

  await log('CALCULATING CONTOURS ...............', 100)
  await sleep(reduced ? 0 : 260)

  // ── reveal: grid cells drop out in a random cascade ──
  const cells = [...bootCells.children] as HTMLElement[]
  const order = cells.map((_, i) => i).sort(() => Math.random() - 0.5)
  order.forEach((ci, k) => {
    const d = reduced ? 0 : k * 22
    setTimeout(() => cells[ci].classList.add('flash'), d)
    setTimeout(() => cells[ci].classList.add('off'), d + 70)
  })
  $('boot').classList.add('done')
  document.body.classList.remove('booting')
  setTimeout(() => document.body.classList.add('ready'), 500)

  // ── loop ──
  let last = performance.now()
  const start = last
  let intro = 0
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    const time = (now - start) / 1000
    intro = Math.min(1, intro + dt * 0.6)
    survey.update(dt, time, intro * intro * (3 - 2 * intro))
    if (specimen.visible || xray.on) specimen.update(dt, time)
    if (taxonomy.visible || xray.on) taxonomy.update(dt, time)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

main().catch((err) => {
  console.error(err)
  logEl.textContent += `\nFATAL: ${err?.message ?? err}`
})
