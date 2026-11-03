import './style.css'
import init, { core_version } from './wasm/soft'
import wasmUrl from './wasm/soft_bg.wasm?url'
import { SoftGPU } from './gpu/soft'
import { Soft2D } from './fallback'
import { Sfx } from './audio'
import { Confetti } from './confetti'
import { Cursor } from './cursor'
import { GlyphFactory, type GlyphStat } from './glyphs'
import { Stage } from './stage'
import { StackGame } from './stack'
import { BUBBLEGUM, COBALT, LEMON, MINT, PALETTE, TOMATO } from './palette'
import type { Look, Renderer } from './types'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const dprNow = () => Math.min(devicePixelRatio || 1, 2)
const fmt = (n: number) => n.toLocaleString('en-US')
const G = 2400

// ── boot: a letter inflating, driven by real progress ────────────────────────
const logEl = $('boot-log')
const kpaEl = $('boot-kpa')
const bootLetter = $('boot-letter')
document.body.classList.add('booting')
let pct = 0
const setPct = (p: number) => {
  pct = Math.max(pct, Math.min(100, p))
  bootLetter.style.setProperty('--p', (pct / 100).toFixed(3))
  kpaEl.textContent = ((101.3 * pct) / 100).toFixed(1)
  if (!reduced) {
    bootLetter.classList.remove('puff')
    void bootLetter.offsetWidth
    bootLetter.classList.add('puff')
  }
}
async function log(line: string, p: number) {
  const row = document.createElement('div')
  logEl.appendChild(row)
  const step = reduced ? line.length : 3
  for (let i = 0; i <= line.length; i += step) {
    row.textContent = line.slice(0, i)
    if (!reduced) await sleep(8)
  }
  row.textContent = line
  while (logEl.children.length > 9) logEl.firstElementChild?.remove()
  setPct(p)
}

async function initGPU() {
  if (!('gpu' in navigator)) return null
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return null
    const device = await adapter.requestDevice()
    device.lost.then((info) => console.warn('WebGPU device lost:', info.message))
    device.addEventListener('uncapturederror', (e) => console.error('WebGPU:', (e as GPUUncapturedErrorEvent).error.message))
    return { adapter, device, format: navigator.gpu.getPreferredCanvasFormat() }
  } catch (err) {
    console.warn('WebGPU init failed', err)
    return null
  }
}
type GPU = Awaited<ReturnType<typeof initGPU>>

/** WebGPU if it compiles + validates, otherwise Canvas2D on a fresh canvas. */
async function makeRenderer(canvas: HTMLCanvasElement, gpu: GPU): Promise<{ renderer: Renderer; canvas: HTMLCanvasElement }> {
  if (gpu) {
    try {
      return { renderer: await SoftGPU.create(gpu.device, canvas, gpu.format), canvas }
    } catch (err) {
      console.warn('WebGPU renderer failed, using Canvas2D', err)
      // a canvas that has handed out a webgpu context can't give a 2d one
      const fresh = canvas.cloneNode(false) as HTMLCanvasElement
      canvas.replaceWith(fresh)
      canvas = fresh
    }
  }
  return { renderer: new Soft2D(canvas), canvas }
}

const heroLook = (cap: number): Look => ({
  outline: Math.max(3, Math.min(9, cap * 0.024)),
  rim: cap * 0.048,
  feather: cap * 0.075,
  shadowAlpha: 0.2,
  shadowX: cap * 0.016,
  shadowY: cap * 0.034,
  halftone: Math.max(4, Math.min(9, cap * 0.022)),
})
const stackLook = (cap: number): Look => ({
  outline: Math.max(2.5, Math.min(5.5, cap * 0.042)),
  rim: cap * 0.07,
  feather: cap * 0.11,
  shadowAlpha: 0.3,
  shadowX: cap * 0.03,
  shadowY: cap * 0.055,
  halftone: Math.max(3.5, Math.min(6.5, cap * 0.05)),
})

async function main() {
  await log('SOFT ’27 · A FESTIVAL OF SQUISHY THINGS', 4)
  await log('REQUESTING GPU ADAPTER', 10)
  const gpu = await initGPU()
  if (gpu) {
    const info = gpu.adapter.info
    const name = [info?.vendor, info?.architecture].filter(Boolean).join(' · ') || 'adapter'
    await log(`  ↳ WEBGPU · ${name.toUpperCase()} · ${gpu.format.toUpperCase()}`, 16)
  } else {
    await log('  ↳ NO WEBGPU — CANVAS2D PATHS, RUST PHYSICS', 16)
  }

  await log('LOADING RUST CORE', 22)
  const t0 = performance.now()
  const wasm = await init({ module_or_path: wasmUrl })
  const bytes = await fetch(wasmUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => b.byteLength)
    .catch(() => 0)
  const kb = bytes ? (bytes / 1024).toFixed(1) : '—'
  await log(`  ↳ ${core_version().toUpperCase()} · ${kb} KB · ${(performance.now() - t0).toFixed(0)} MS`, 30)

  await log('WAITING FOR BRICOLAGE GROTESQUE 800', 34)
  await Promise.race([document.fonts.load('800 100px "Bricolage Grotesque"').then(() => document.fonts.ready), sleep(3500)])

  const sfx = new Sfx()
  const fx = new Confetti($<HTMLCanvasElement>('fx'), reduced)
  const cursor = new Cursor($('cursor'), $('cursor-blob'), $('cursor-label'), reduced)
  const setCursor = (m: string, l: string) => {
    if (cursor.mode === 'link') return
    cursor.set(m, l)
  }
  const factory = new GlyphFactory()

  const dock = $('dock')
  const dockClear = () => Math.ceil(dock.getBoundingClientRect().height + (innerWidth < 640 ? 18 : 30))
  const applyDockClear = () => {
    const c = dockClear()
    document.documentElement.style.setProperty('--dock-clear', `${c}px`)
    return c
  }
  let clear = applyDockClear()

  // ── renderers ──
  const heroR = await makeRenderer($<HTMLCanvasElement>('poster-canvas'), gpu)
  const stackR = await makeRenderer($<HTMLCanvasElement>('stack-canvas'), gpu)
  const kind = heroR.renderer.kind
  if (kind !== 'webgpu') $('degraded').hidden = false
  $('renderer-tag').textContent = kind === 'webgpu' ? 'WebGPU' : 'Canvas2D'

  // ── 01 poster ──
  const heroGlyphs = new Map<string, GlyphStat>()
  let heroCap = 0
  let heroTemplateCap = 0
  const heroHint = $('hero-hint')
  const hero: Stage = new Stage($('poster'), heroR.canvas, wasm.memory, heroR.renderer, sfx, heroLook(200), {
    cursor: setCursor,
    onPopStart: (_i, m, x, y) => fx.burst(x, y, [m.color, LEMON, '#f4efe6'], 34, 0.7),
    onPopped: (i, m) => {
      // re-inflate from the top of the poster, somewhere nothing else is
      const top = hero.obstacleBottom() + 8
      const box = m.size * 1.05
      const home = m.home ?? { x: hero.w / 2, y: top + box }
      const spot = hero.findFree(home.x, box * 0.9, box, top, hero.floor) ?? [home.x, top + box / 2]
      hero.world.respawn(i, spot[0], spot[1], (Math.random() - 0.5) * 0.3, 0.22)
      m.popping = false
    },
  })
  hero.bottomInset = clear
  hero.setObstacles([...document.querySelectorAll<HTMLElement>('#poster [data-obstacle]')].map((el) => ({ el, ground: false })))
  hero.layout(dprNow())

  const heroFit = () => {
    const top = hero.obstacleBottom() + 16
    const avail = Math.max(120, hero.floor - top)
    // one row always reads S-O-F-T; width fitting happens in seedHero
    const cap = Math.min(hero.w * 0.3, avail * 0.78)
    return { cap: Math.max(56, Math.round(cap)), top }
  }

  await log(`EXTRACTING CONTOURS · MARCHING SQUARES`, 40)
  {
    const { cap } = heroFit()
    heroTemplateCap = cap
    const sp = cap * 0.032
    for (const [k, ch] of ['S', 'O', 'F', 'T'].entries()) {
      const st = factory.build(hero.world, ch, cap, sp)
      heroGlyphs.set(ch, st)
      const ring = st.holes ? `${st.rings} RINGS (${st.holes} HOLE)` : `${st.rings} RING`
      await log(`  ${ch}  ${st.points} PTS · ${ring} · ${st.triangles} TRIS · ${st.ms.toFixed(1)} MS`, 46 + k * 7)
    }
    for (const w of ['fest', '’27']) {
      const c = cap * 0.27
      const st = factory.build(hero.world, w, c, c * 0.06, true)
      heroGlyphs.set(w, st)
    }
    const fs = heroGlyphs.get('fest')!
    const yr = heroGlyphs.get('’27')!
    await log(`  “fest” ${fs.points} PTS · “’27” ${yr.points} PTS · ${fs.triangles + yr.triangles} TRIS`, 74)
  }

  const HERO_COLORS: Record<string, string> = { S: TOMATO, O: COBALT, F: BUBBLEGUM, T: MINT, fest: LEMON, '’27': LEMON }
  let seedToken = 0
  const seedHero = (animate: boolean) => {
    const token = ++seedToken
    hero.clear()
    const { cap, top } = heroFit()
    heroCap = cap
    const s = cap / heroTemplateCap
    const letters = ['S', 'O', 'F', 'T'].map((c) => heroGlyphs.get(c)!)
    const gap = cap * 0.07
    const placed: { st: GlyphStat; x: number; y: number }[] = []
    const anim = animate && !reduced
    const lift = anim ? cap * 0.2 : 0
    {
      let total = letters.reduce((a, st) => a + st.width * s, 0) + gap * 3
      const fit = Math.min(1, (hero.w * 0.94) / total)
      total *= fit
      let x = (hero.w - total) / 2
      for (const st of letters) {
        const w = st.width * s * fit
        placed.push({ st, x: x + w / 2, y: hero.floor - (st.height * s * fit) / 2 - 2 - lift })
        x += w + gap * fit
      }
      if (fit < 1) heroCap = cap * fit
    }
    const look = heroLook(heroCap)
    hero.look = look
    hero.world.set_radius(look.outline + 0.5)
    hero.grabRadius = heroCap * 0.16
    const sc = heroCap / heroTemplateCap
    const spawnAt = (st: GlyphStat, x: number, y: number, ang: number, color: string, check: boolean) => {
      if (token !== seedToken) return
      const w = st.width * sc
      const h = st.height * sc
      let spot: [number, number] | null = [x, y]
      if (check && !hero.world.region_free(x - w / 2, y - h / 2, x + w / 2, y + h / 2)) spot = hero.findFree(x, w, h, top, y + h / 2)
      if (!spot) return
      const i = hero.spawn(st, spot[0], spot[1], ang, st.cap * sc, anim ? 0.25 : 1, color)
      if (i >= 0) hero.metas[i].home = { x: spot[0], y: spot[1] }
    }
    placed.forEach((p, k) => {
      const go = () => spawnAt(p.st, p.x, p.y, (Math.random() - 0.5) * 0.06, HERO_COLORS[p.st.text], k > 0)
      if (anim) setTimeout(go, 120 + k * 140)
      else go()
    })
    // the small words drop onto S and T, wherever there is room
    const byText = (t: string) => placed.find((p) => p.st.text === t)!
    const drops: [string, string, number][] = [
      ['fest', 'S', -0.12],
      ['’27', 'T', 0.15],
    ]
    drops.forEach(([word, onto, a], k) => {
      const st = heroGlyphs.get(word)!
      const p = byText(onto)
      const h = st.height * sc
      const y = Math.max(top + h / 2 + 2, p.y - (p.st.height * sc) / 2 - h / 2 - cap * 0.12)
      const go = () => spawnAt(st, p.x, y, a, HERO_COLORS[word], true)
      if (anim) setTimeout(go, 800 + k * 200)
      else go()
    })
  }

  // ── 02 the stack ──
  const stack: Stage = new Stage($('stack'), stackR.canvas, wasm.memory, stackR.renderer, sfx, stackLook(100), {
    cursor: setCursor,
    onPopStart: (_i, m, x, y) => fx.burst(x, y, [m.color, '#f4efe6'], 30, 0.6),
    onPopped: (i) => stack.remove(i),
  })
  stack.bottomInset = clear
  const card = document.querySelector<HTMLElement>('#stack [data-obstacle]')!
  stack.setObstacles([
    { el: card, ground: false },
    { el: $('plinth'), ground: true },
  ])
  stack.layout(dprNow())

  const stackGlyphs = new Map<string, GlyphStat>()
  const game = new StackGame(
    stack,
    stackGlyphs,
    {
      drop: $<HTMLButtonElement>('drop-btn'),
      next: $('next-letter'),
      now: $('h-now'),
      best: $('h-best'),
      count: $('h-count'),
      lineCur: $('line-cur'),
      lineBest: $('line-best'),
      ruler: $('ruler'),
      toast: $('toast'),
      card,
      plinth: $('plinth'),
    },
    fx,
    sfx,
  )
  game.layout()
  stack.syncObstacles()
  {
    const tA = performance.now()
    let pts = 0
    let tris = 0
    let holes = 0
    const az = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for (let k = 0; k < az.length; k++) {
      const st = factory.build(stack.world, az[k], game.cap, game.cap * 0.055)
      stackGlyphs.set(az[k], st)
      pts += st.points
      tris += st.triangles
      holes += st.holes
      if (k % 6 === 5) setPct(76 + k * 0.6)
    }
    await log(`  A–Z ${fmt(pts)} PTS · ${holes} HOLES · ${fmt(tris)} TRIS · ${(performance.now() - tA).toFixed(0)} MS`, 92)
  }
  const applyStackLook = () => {
    const look = stackLook(game.cap)
    stack.look = look
    stack.world.set_radius(look.outline + 0.5)
  }
  applyStackLook()

  // ── colophon numbers ──
  {
    const hs = [...heroGlyphs.values()]
    const p = hs.reduce((a, s) => a + s.points, 0)
    const t = hs.reduce((a, s) => a + s.triangles, 0)
    const ms = hs.reduce((a, s) => a + s.ms, 0)
    $('n-points').textContent = fmt(p)
    $('c-extract').textContent = `This poster: ${hs.length} glyph bodies, ${fmt(p)} particles, ${fmt(t)} triangles, extracted in ${ms.toFixed(1)} ms on your machine.`
    $('c-wasm').textContent = `${core_version()} · soft_bg.wasm · ${kb} KB.`
    $('c-renderer').textContent =
      kind === 'webgpu'
        ? `Running on WebGPU (${gpu?.format ?? ''}, 4× MSAA).`
        : 'Running on the Canvas2D fallback — no WebGPU here, so even-odd paths with blur shadows.'
  }

  // ── controls ──
  const worlds = () => [hero.world, stack.world]
  let gravityUp = false
  let tilt: [number, number] | null = null
  const applyGravity = () => {
    const [gx, gy] = tilt ?? [0, G]
    const s = gravityUp ? -1 : 1
    for (const w of worlds()) w.set_gravity(gx * s, gy * s)
    game.flipped = gravityUp
  }
  applyGravity()

  const rInflate = $<HTMLInputElement>('r-inflate')
  const rStiff = $<HTMLInputElement>('r-stiff')
  let maxed = false
  rInflate.addEventListener('input', () => {
    sfx.unlock()
    const v = parseFloat(rInflate.value)
    for (const w of worlds()) w.set_inflate(v)
    const kpa = (101.3 * v).toFixed(0)
    $('v-inflate').textContent = `${kpa} kPa`
    $('n-kpa').textContent = kpa
    if (v >= 1.59 && !maxed) {
      maxed = true
      sfx.pop()
      for (const w of worlds()) w.jiggle(420)
      dock.classList.remove('maxed')
      void dock.offsetWidth
      dock.classList.add('maxed')
    } else if (v < 1.5) maxed = false
  })
  rStiff.addEventListener('input', () => {
    const v = parseFloat(rStiff.value)
    for (const w of worlds()) w.set_stiffness(v)
    $('v-stiff').textContent = v < 0.2 ? 'jelly' : v < 0.45 ? 'pudding' : v < 0.7 ? 'gummy' : v < 0.9 ? 'bouncy' : 'rubber'
  })
  const bGravity = $('b-gravity')
  bGravity.addEventListener('click', () => {
    gravityUp = !gravityUp
    bGravity.textContent = gravityUp ? 'Gravity ↑' : 'Gravity ↓'
    bGravity.setAttribute('aria-pressed', String(gravityUp))
    applyGravity()
  })
  $('b-reset').addEventListener('click', () => {
    seedHero(true)
    game.reset()
    rInflate.value = '1'
    rInflate.dispatchEvent(new Event('input'))
  })
  const bSound = $('b-sound')
  bSound.addEventListener('click', () => {
    sfx.unlock()
    sfx.setEnabled(!sfx.enabled)
    bSound.textContent = sfx.enabled ? 'Sound on' : 'Sound off'
    bSound.setAttribute('aria-pressed', String(sfx.enabled))
  })
  // Chrome only counts some events as audio-unlocking gestures (touchend, not touchstart)
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) window.addEventListener(ev, () => sfx.unlock(), { passive: true })
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'd' || e.key === 'D') && stack.visible && !(e.target as HTMLElement).closest('input')) {
      sfx.unlock()
      game.drop()
    }
  })

  // device tilt steers gravity where it needs no permission prompt (Android)
  if (matchMedia('(pointer: coarse)').matches) {
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return
      const gamma = Math.max(-60, Math.min(60, e.gamma))
      const beta = Math.max(-80, Math.min(80, e.beta))
      const gx = Math.sin((gamma * Math.PI) / 180) * G
      const gy = Math.max(0.35, Math.sin((Math.max(15, beta) * Math.PI) / 180)) * G
      tilt = [gx, gy]
      applyGravity()
    })
  }

  // ── layout ──
  const resize = () => {
    clear = applyDockClear()
    const dpr = dprNow()
    hero.bottomInset = clear
    stack.bottomInset = clear
    hero.layout(dpr)
    stack.layout(dpr)
    fx.resize(dpr)
    const { cap } = heroFit()
    if (heroCap && Math.abs(cap - heroCap) / heroCap > 0.14) seedHero(false)
    game.layout()
    stack.syncObstacles()
    applyStackLook()
  }
  fx.resize(dprNow())
  let resizeT = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeT)
    resizeT = window.setTimeout(resize, 160)
  })

  const watch = (el: HTMLElement, set: (v: boolean) => void, margin = '80px') =>
    new IntersectionObserver((e) => set(e[0].isIntersecting), { rootMargin: margin }).observe(el)
  watch($('poster'), (v) => (hero.visible = v))
  watch($('stack'), (v) => {
    stack.visible = v
    if (v) game.start()
  })
  new IntersectionObserver((e) => dock.classList.toggle('away', e[0].intersectionRatio > 0.3), { threshold: [0, 0.3, 0.6] }).observe(
    $('colophon'),
  )

  await log('PRESSURISING · 101.3 kPa', 100)
  await sleep(reduced ? 0 : 320)

  // ── reveal: the boot letter pops ──
  bootLetter.classList.add('popped')
  $('boot').classList.add('done')
  document.body.classList.remove('booting')
  if (!reduced) fx.burst(innerWidth / 2, innerHeight * 0.45, PALETTE, 70, 1)
  setTimeout(() => $('boot').remove(), 1200)
  seedHero(true)

  // handle for poking at the simulation from devtools
  ;(window as unknown as { soft: unknown }).soft = { hero, stack, game }

  let hinted = false
  // ── loop ──
  let last = performance.now()
  const start = last
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    const time = (now - start) / 1000
    if (hero.visible) hero.update(dt, time)
    if (stack.visible) {
      stack.update(dt, time)
      game.update(dt, time)
    }
    if (!hinted && hero.holding >= 0) {
      hinted = true
      heroHint.classList.add('used')
    }
    fx.update(dt)
    cursor.update(dt)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

main().catch((err) => {
  console.error(err)
  logEl.textContent += `\nSOMETHING WENT FLAT: ${err?.message ?? err}`
})
