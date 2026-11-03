// The four transmitters. Frequencies sit on the 88.0–108.0 MHz dial; each one
// owns a generative patch (audio/patches.ts), an SDF scene (gpu/scene.wgsl,
// SCENE override = index) and a duotone.

export type RGB = [number, number, number]

export interface Station {
  freq: number
  call: string
  name: string
  tag: string
  track: string
  artist: string
  from: string
  coords: string
  listeners: number
  ink: RGB
  paper: RGB
  accent: RGB
}

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export const STATIONS: Station[] = [
  {
    freq: 90.2,
    call: 'HLC',
    name: 'Halcyon',
    tag: 'Ambient for empty rooms',
    track: 'Breathing Exercise No. 4',
    artist: 'The Quiet Engineers',
    from: 'A lighthouse with no sea',
    coords: '62.01° N 06.77° W',
    listeners: 4213,
    ink: hex('#f2ecdc'),
    paper: hex('#1b2bff'),
    accent: hex('#ff7a45'),
  },
  {
    freq: 95.8,
    call: 'FRN',
    name: 'Furnace',
    tag: 'Minimal pulse · 124 BPM',
    track: 'Corridor Logic (Dub)',
    artist: 'Unit Hollow',
    from: 'Car park, level −4',
    coords: '51.92° N 04.47° E',
    listeners: 12877,
    ink: hex('#0d0b09'),
    paper: hex('#ff5a1f'),
    accent: hex('#fff3e0'),
  },
  {
    freq: 100.6,
    call: 'VLT',
    name: 'Velvet Tape',
    tag: 'Lo-fi arpeggios, warped',
    track: 'Knots I Tied in 1996',
    artist: 'Mira & the Cassette Ghosts',
    from: 'Back room of a closed video store',
    coords: '41.15° N 08.61° W',
    listeners: 2304,
    ink: hex('#cdb8ff'),
    paper: hex('#14111d'),
    accent: hex('#ff4f9a'),
  },
  {
    freq: 105.3,
    call: 'LTD',
    name: 'Low Tide',
    tag: 'Drone & shortwave',
    track: 'Numbers for the Moon',
    artist: 'Station Nobody',
    from: 'A buoy, 200 km off nowhere',
    coords: '00.00° N 00.00° E',
    listeners: 418,
    ink: hex('#f4f6ef'),
    paper: hex('#0f3b2a'),
    accent: hex('#ffe08a'),
  },
]

export const F_MIN = 88.0
export const F_MAX = 108.0

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export interface Tuning {
  /** per-station reception, 0 (nothing) … 1 (locked) */
  signals: number[]
  /** index of the closest station on the dial */
  nearest: number
  /** reception of the nearest station */
  signal: number
  ink: RGB
  paper: RGB
  accent: RGB
}

const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Reception model: full lock within ±0.04 MHz, gone beyond ±0.85 MHz. */
export function tune(f: number): Tuning {
  const signals = STATIONS.map((s) => 1 - smooth(0.04, 0.85, Math.abs(f - s.freq)))
  let nearest = 0
  for (let i = 1; i < STATIONS.length; i++)
    if (Math.abs(f - STATIONS[i].freq) < Math.abs(f - STATIONS[nearest].freq)) nearest = i

  // palette drifts between neighbours, mostly inside the dead zone
  let a = 0
  while (a < STATIONS.length - 1 && STATIONS[a + 1].freq < f) a++
  const b = Math.min(a + 1, STATIONS.length - 1)
  let k = 0
  if (b !== a && f > STATIONS[a].freq) k = smooth(0.42, 0.58, (f - STATIONS[a].freq) / (STATIONS[b].freq - STATIONS[a].freq))
  const A = STATIONS[a]
  const B = STATIONS[b]
  return {
    signals,
    nearest,
    signal: signals[nearest],
    ink: mixc(A.ink, B.ink, k),
    paper: mixc(A.paper, B.paper, k),
    accent: mixc(A.accent, B.accent, k),
  }
}

export const css = (c: RGB) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`
