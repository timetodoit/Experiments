// Time-of-day palettes. Six keyframes interpolated in OKLab, plus the light
// direction for the glass (sun by day, moon by night) and the CSS theme.

export type RGB = [number, number, number] // sRGB 0..1

interface KeyDef {
  h: number
  bg: string
  bg2: string
  fg: string
  accent: string
  text: string // headline ink
  glass: string
  sun: string
  inks: [string, string, string]
  glassAmt: number
  wght: number
  soft: number
  night: number
  grain: number
}

const KEYS: KeyDef[] = [
  { h: 0, bg: '#0a1022', bg2: '#18234a', fg: '#e9edf7', accent: '#7ff0ff', text: '#6fe3ff', glass: '#b7c8ff', sun: '#cfe6ff',
    inks: ['#2fd8ff', '#3a63ff', '#a9f4ff'], glassAmt: 0.05, wght: 300, soft: 100, night: 1, grain: 0.035 },
  { h: 6, bg: '#f7e3d7', bg2: '#e8d2ea', fg: '#3b2140', accent: '#d9566f', text: '#7b3f78', glass: '#fff1ea', sun: '#fff0dc',
    inks: ['#ff8a73', '#e25d98', '#9a7fe0'], glassAmt: 0.1, wght: 340, soft: 100, night: 0, grain: 0.03 },
  { h: 12, bg: '#f5f2ea', bg2: '#e9edf4', fg: '#0c1a44', accent: '#1d47ff', text: '#1430c8', glass: '#ffffff', sun: '#ffffff',
    inks: ['#1c3df0', '#0a1875', '#49a2ff'], glassAmt: 0.12, wght: 540, soft: 0, night: 0, grain: 0.025 },
  { h: 17, bg: '#f6dfb0', bg2: '#efc584', fg: '#3d1f05', accent: '#b8490a', text: '#a5400a', glass: '#fff3d6', sun: '#fff0c8',
    inks: ['#ee8a0a', '#c2390c', '#f8c440'], glassAmt: 0.1, wght: 460, soft: 40, night: 0, grain: 0.03 },
  { h: 19.2, bg: '#2c1740', bg2: '#6a2a4e', fg: '#fde6d6', accent: '#ff8a3d', text: '#ff9150', glass: '#ffd2c0', sun: '#ffc49a',
    inks: ['#ff7a2b', '#ff4a72', '#9a62ff'], glassAmt: 0.06, wght: 380, soft: 70, night: 0.75, grain: 0.035 },
  { h: 22, bg: '#0c1328', bg2: '#1a1f48', fg: '#e6ebf8', accent: '#8af2ff', text: '#74e4ff', glass: '#b7c8ff', sun: '#cfe6ff',
    inks: ['#36dcff', '#5470ff', '#c4f6ff'], glassAmt: 0.05, wght: 300, soft: 100, night: 1, grain: 0.035 },
]

export interface Palette {
  bg: RGB
  bg2: RGB
  fg: RGB
  accent: RGB
  text: RGB
  glass: RGB
  sun: RGB
  inks: [RGB, RGB, RGB]
  glassAmt: number
  wght: number
  soft: number
  night: number
  grain: number
}

export interface Light {
  x: number // screen-space direction towards the light (y down)
  y: number
  i: number // intensity
  elev: number // -1 (midnight) … 1 (noon)
  moon: boolean
}

const TAU = Math.PI * 2
const COLORS = ['bg', 'bg2', 'fg', 'accent', 'text', 'glass', 'sun'] as const
const NUMS = ['glassAmt', 'wght', 'soft', 'night', 'grain'] as const

// ── colour maths ─────────────────────────────────────────────────────────────
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export const hexRGB = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
]

function toOklab([R, G, B]: RGB): RGB {
  const r = toLin(R), g = toLin(G), b = toLin(B)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromOklab([L, A, B]: RGB): RGB {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    clamp01(toSrgb(clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))),
    clamp01(toSrgb(clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))),
    clamp01(toSrgb(clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))),
  ]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const mix3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
export const mixRGB = mix3
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

// keyframes pre-converted to OKLab
const LAB = KEYS.map((k) => {
  const c = {} as Record<(typeof COLORS)[number], RGB>
  for (const name of COLORS) c[name] = toOklab(hexRGB(k[name]))
  return { h: k.h, c, inks: k.inks.map((i) => toOklab(hexRGB(i))) as RGB[], k }
})

// ── time helpers ─────────────────────────────────────────────────────────────
export const wrap24 = (h: number) => ((h % 24) + 24) % 24
/** shortest signed distance from a to b on the 24h circle */
export const hourDelta = (a: number, b: number) => ((b - a + 36) % 24) - 12
export function nowHour() {
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}
export function fmtHour(h: number) {
  const mins = Math.floor(wrap24(h) * 60) % 1440
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}
export function phaseName(h: number) {
  const x = wrap24(h)
  if (x < 4.5) return 'Night'
  if (x < 7.5) return 'Dawn'
  if (x < 11) return 'Morning'
  if (x < 14) return 'Noon'
  if (x < 16.4) return 'Afternoon'
  if (x < 18.4) return 'Golden hour'
  if (x < 20.6) return 'Dusk'
  return 'Night'
}

// ── palette at an hour ───────────────────────────────────────────────────────
export function paletteAt(h: number): Palette {
  const x = wrap24(h)
  const n = LAB.length
  let i = 0
  for (let k = 0; k < n; k++) if (LAB[k].h <= x) i = k
  const a = LAB[i]
  const b = LAB[(i + 1) % n]
  const h1 = i + 1 < n ? b.h : b.h + 24
  const t = smoothstep(0, 1, (x - a.h) / (h1 - a.h))
  const out = {} as Palette
  for (const name of COLORS) out[name] = fromOklab(mix3(a.c[name], b.c[name], t))
  out.inks = [0, 1, 2].map((j) => fromOklab(mix3(a.inks[j], b.inks[j], t))) as [RGB, RGB, RGB]
  for (const name of NUMS) out[name] = lerp(a.k[name], b.k[name], t)
  return out
}

/** sun on the dial: 00h at the bottom, 06h left, 12h top, 18h right */
export function lightAt(h: number): Light {
  const a = (wrap24(h) / 24) * TAU
  const sx = -Math.sin(a)
  const sy = Math.cos(a)
  const elev = -Math.cos(a)
  const sunI = smoothstep(-0.18, 0.3, elev)
  const moonI = 0.6 * smoothstep(0.1, -0.35, elev)
  if (sunI >= moonI) return { x: sx, y: sy, i: Math.max(0.22, sunI), elev, moon: false }
  return { x: -sx, y: -sy, i: Math.max(0.22, moonI), elev, moon: true }
}

/** a pleasing ink from the palette, continuous in k (wraps every 3) */
export function inkAt(p: Palette, k: number): RGB {
  const f = ((k % 3) + 3) % 3
  const i = Math.floor(f)
  return mix3(p.inks[i], p.inks[(i + 1) % 3], smoothstep(0, 1, f - i))
}

export const css = (c: RGB, a = 1) =>
  a >= 1
    ? `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`
    : `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)} / ${a.toFixed(3)})`

let lastMeta = -1
export function applyCSS(p: Palette, h: number) {
  const s = document.documentElement.style
  s.setProperty('--bg', css(p.bg))
  s.setProperty('--bg2', css(p.bg2))
  s.setProperty('--fg', css(p.fg))
  s.setProperty('--fg-dim', css(p.fg, 0.62))
  s.setProperty('--line', css(p.fg, 0.16))
  s.setProperty('--accent', css(p.accent))
  s.setProperty('--text-ink', css(p.text))
  s.setProperty('--ink-1', css(p.inks[0]))
  s.setProperty('--ink-2', css(p.inks[1]))
  s.setProperty('--ink-3', css(p.inks[2]))
  s.setProperty('--glass-fill', css(p.bg, 0.38))
  s.setProperty('--wght', p.wght.toFixed(0))
  s.setProperty('--soft', p.soft.toFixed(0))
  document.documentElement.dataset.night = p.night > 0.5 ? '1' : '0'
  if (Math.abs(h - lastMeta) > 0.1) {
    lastMeta = h
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', css(p.bg))
  }
}
