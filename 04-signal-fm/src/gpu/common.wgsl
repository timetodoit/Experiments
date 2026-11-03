// ─────────────────────────────────────────────────────────────────────────────
//  SIGNAL FM · common.wgsl — prepended to scene.wgsl and ascii.wgsl
//  One uniform block for all three passes. Byte offsets are hand-packed and
//  mirrored in signal.ts (Float32Array index = offset / 4).
// ─────────────────────────────────────────────────────────────────────────────

struct U {
  res: vec2f,      //   0  canvas size, device px
  grid: vec2f,     //   8  ASCII grid, cols × rows
  cell: vec2f,     //  16  cell size, device px (w, h)
  time: f32,       //  24  scene time (slows down while held)
  rtime: f32,      //  28  wall-clock time
  bands: vec4f,    //  32  bass, mid, high, level   (0…1)
  mouse: vec2f,    //  48  smoothed pointer, -1…1, y up
  signal: f32,     //  56  reception of the nearest station
  glitch: f32,     //  60  transition tear amount
  motion: f32,     //  64  0 under prefers-reduced-motion
  slow: f32,       //  68  hold / time-stretch amount
  glyphs: f32,     //  72  glyph count in the atlas
  beat: f32,       //  76  kick envelope
  pulse: vec4f,    //  80  xy = click (grid uv, y down), z = wall time, w = scene time
  ink: vec4f,      //  96  duotone foreground (rgb)
  paper: vec4f,    // 112  duotone background (rgb)
  accent: vec4f,   // 128  hot-spot colour (rgb)
  hold: vec4f,     // 144  xy = hold point (grid uv), z = bubble radius 0…1
};                 // 160 bytes

@group(0) @binding(0) var<uniform> u: U;

const PI = 3.14159265;

@vertex
fn vs_full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn hash31(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}
