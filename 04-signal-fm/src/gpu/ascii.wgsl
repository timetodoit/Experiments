// ─────────────────────────────────────────────────────────────────────────────
//  SIGNAL FM · ascii.wgsl — passes 2 and 3
//
//  fs_cells    (grid res)  : resolve 2 × 2 scene texels per cell, Sobel on
//                            depth + luminance for directional edge glyphs,
//                            Bayer-dithered ramp lookup, static, tearing,
//                            glyph scramble and the click ripple.
//                            out: r = glyph index, g = intensity, b = accent
//  fs_present  (pixel res) : one textureLoad from the cell buffer, one from
//                            the glyph atlas, duotone + hold bubble.
//
//  Everything uses textureLoad on integer coords: pixel-exact, no samplers,
//  no uniformity constraints.
// ─────────────────────────────────────────────────────────────────────────────

@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var cellTex: texture_2d<f32>;
@group(0) @binding(3) var atlas: texture_2d<f32>;

// mirrors glyphs.ts
const RAMP_N = 10.0;
const EDGE0 = 10.0;
const NOISE0 = 14.0;

fn wrapi(x: i32, n: i32) -> i32 { return ((x % n) + n) % n; }

fn loadCell(c: vec2i) -> vec4f {
  let g = vec2i(u.grid);
  let cc = vec2i(wrapi(c.x, g.x), clamp(c.y, 0, g.y - 1));
  let dim = vec2i(textureDimensions(sceneTex)) - vec2i(1);
  let b = cc * 2;
  let s = textureLoad(sceneTex, min(b, dim), 0)
        + textureLoad(sceneTex, min(b + vec2i(1, 0), dim), 0)
        + textureLoad(sceneTex, min(b + vec2i(0, 1), dim), 0)
        + textureLoad(sceneTex, min(b + vec2i(1, 1), dim), 0);
  return s * 0.25;
}

fn edgeVal(c: vec2i) -> f32 {
  let s = loadCell(c);
  return s.g * 4.0 + s.r * 0.8;
}

fn bayer2(a: vec2u) -> u32 { return ((a.x ^ a.y) & 1u) * 2u + (a.y & 1u); }
fn bayer4(p: vec2u) -> f32 {
  return f32(bayer2(p & vec2u(1u)) * 4u + bayer2((p >> vec2u(1u)) & vec2u(1u))) / 16.0;
}

@fragment
fn fs_cells(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let cell = vec2i(floor(pos.xy));
  let fc = vec2f(cell);
  let mo = u.motion;
  let tq = floor(u.rtime * 16.0) * mo; // static is frozen under reduced motion
  let off = clamp(1.0 - u.signal, 0.0, 1.0);
  let gl = clamp(u.glitch, 0.0, 1.0) * mo;

  // ── tearing: bands of rows slide sideways ──
  var shift = 0.0;
  let band = floor(fc.y / 2.0);
  let tear = gl + off * 0.16 * mo;
  if (hash21(vec2f(band, tq)) < tear * 0.5) {
    shift = floor((hash21(vec2f(band * 1.7 + 3.1, tq + 9.0)) - 0.5) * 2.0 * (3.0 + 36.0 * gl));
  }
  // vertical hold slips while badly tuned
  let roll = i32(floor(off * off * mo * fract(u.rtime * 0.37) * u.grid.y * 0.5));
  let src = cell + vec2i(i32(shift), roll);

  let c = loadCell(src);

  // ── Sobel on depth (dominant) + luminance ──
  let tl = edgeVal(src + vec2i(-1, -1));
  let tc = edgeVal(src + vec2i(0, -1));
  let tr = edgeVal(src + vec2i(1, -1));
  let ml = edgeVal(src + vec2i(-1, 0));
  let mr = edgeVal(src + vec2i(1, 0));
  let bl = edgeVal(src + vec2i(-1, 1));
  let bc = edgeVal(src + vec2i(0, 1));
  let br = edgeVal(src + vec2i(1, 1));
  let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  let gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  // cells are 2:3 — bring the gradient into square pixel space before taking its angle
  let gs = vec2f(gx, gy * u.cell.x / u.cell.y);
  let e = length(gs);
  var ang = atan2(gs.x, gs.y); // edge tangent angle, y up: 0 = '-', π/2 = '|'
  if (ang < 0.0) { ang += PI; }
  let bin = f32(i32(floor(ang / (PI * 0.25) + 0.5)) % 4);

  // ── luminance → static → beat → vignette ──
  var lum = c.r;
  let n = hash21(fc * vec2f(1.0, 1.31) + vec2f(tq * 17.0, tq * 3.0));
  let streak = step(0.985, hash21(vec2f(fc.y, tq * 1.3)));
  let stat = n * n * 0.9 + streak * 0.55;
  lum = mix(lum, stat, off * 0.94);
  lum *= 0.92 + 0.22 * u.beat;
  let uv = (fc + 0.5) / u.grid;
  let vg = length((uv - 0.5) * vec2f(1.0, 0.8));
  lum *= 1.0 - smoothstep(0.38, 0.85, vg) * 0.5;

  // ── click ripple through the glyph grid ──
  var ring = 0.0;
  let age = u.rtime - u.pulse.z;
  if (age >= 0.0 && age < 2.4) {
    let px = (fc + 0.5) * u.cell;
    let cp = u.pulse.xy * u.grid * u.cell;
    let d = length(px - cp) / u.cell.x;
    let r = age * 62.0;
    ring = exp(-pow((d - r) / 2.2, 2.0)) * (1.0 - age / 2.4);
    ring += exp(-pow((d - r * 0.6) / 1.6, 2.0)) * (1.0 - age / 2.4) * 0.5;
  }
  lum += ring * 0.85;
  let acc = clamp(c.b * (1.0 - off) + ring * 0.55, 0.0, 1.0);

  // ── glyph choice ──
  let lq = clamp(lum, 0.0, 1.0) * (RAMP_N - 1.0) + bayer4(vec2u(cell)) * 0.999 - 0.25;
  var glyph = clamp(floor(lq), 0.0, RAMP_N - 1.0);
  if (e * (1.0 - off) > 1.15 && glyph > 0.0) {
    glyph = EDGE0 + bin;
    lum = max(lum, 0.7);
  }
  let noiseN = max(u.glyphs - NOISE0, 1.0);
  let hs = hash21(fc + vec2f(tq * 3.1, tq * 1.7) + 0.37);
  if (hs < gl * 0.45 + off * 0.1 * mo + ring * 0.22) {
    glyph = NOISE0 + floor(hash21(fc.yx + vec2f(tq, 5.0)) * noiseN);
  }
  return vec4f(glyph, clamp(lum, 0.0, 1.0), acc, 0.0);
}

@fragment
fn fs_present(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let gridPx = u.grid * u.cell;
  let offs = floor((gridPx - u.res) * 0.5);
  let p = floor(pos.xy) + offs;
  let g = vec2i(u.grid);
  let cw = i32(u.cell.x);
  let ch = i32(u.cell.y);
  let cc = clamp(vec2i(floor(p / u.cell)), vec2i(0), g - vec2i(1));
  let c = textureLoad(cellTex, cc, 0);
  let lp = clamp(vec2i(p) - cc * vec2i(cw, ch), vec2i(0), vec2i(cw - 1, ch - 1));
  let gi = i32(c.r + 0.5);
  let mask = textureLoad(atlas, vec2i(gi * cw + lp.x, lp.y), 0).a;

  let ink = u.ink.rgb;
  let paper = u.paper.rgb;
  var bg = paper;
  var fg = mix(mix(paper, ink, 0.45), ink, smoothstep(0.05, 0.6, c.g));
  fg = mix(fg, u.accent.rgb, smoothstep(0.3, 0.75, c.b));
  if (c.b > 0.82) {
    // hot spots print as inverted blocks
    bg = u.accent.rgb;
    fg = paper;
  }

  // hold: a time bubble with inverted ink grows from the press point
  if (u.hold.z > 0.002) {
    let cpx = (vec2f(cc) + 0.5) * u.cell;
    let hp = u.hold.xy * gridPx;
    let d = length(cpx - hp);
    let r = u.hold.z * length(gridPx) * 0.62;
    if (d < r) {
      bg = ink;
      fg = mix(mix(ink, paper, 0.45), paper, smoothstep(0.05, 0.6, c.g));
    }
    if (abs(d - r) < u.cell.y * 0.55) {
      bg = u.accent.rgb;
      fg = paper;
    }
  }
  return vec4f(mix(bg, fg, mask), 1.0);
}
