// SOFT — deforming glyph meshes.
//
// No vertex buffers: every pass reads the Rust particle buffer (pts) directly via
// vertex_index. Fill passes index particles; strip passes index particle*2 + side,
// where side 0 sits on the contour and side 1 is offset along the miter normal.
//
// Pass order: shadow fill → shadow feather → outline → fill → rim (gloss + shade).

struct U {
  res: vec4f,    // css width, css height, time, dpr
  geo: vec4f,    // outline width, rim width, shadow feather, shadow alpha
  shadow: vec4f, // offset x, offset y, halftone cell (css px), lift multiplier
  ink: vec4f,    // outline colour
};

struct Pt {
  pos: vec2f,
  nrm: vec2f,   // outward, miter-scaled
  body: f32,
  strain: f32,
  hole: f32,
  pad: f32,
};

struct Body {
  color: vec4f,
  center: vec2f,
  radius: f32,
  squash: f32,
  pop: f32,
  lift: f32,
  grow: f32,
  angle: f32,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> pts: array<Pt>;
@group(0) @binding(2) var<storage, read> bodies: array<Body>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec2f,
  @location(1) side: f32,
  @location(2) nrm: vec2f,
  @location(3) strain: f32,
  @location(4) @interpolate(flat) body: u32,
};

fn clip_of(p: vec2f) -> vec4f {
  return vec4f(p.x / u.res.x * 2.0 - 1.0, 1.0 - p.y / u.res.y * 2.0, 0.0, 1.0);
}

fn body_of(p: Pt) -> u32 {
  return u32(max(p.body, 0.0) + 0.5);
}

fn shadow_offset(b: Body) -> vec2f {
  return u.shadow.xy * (1.0 + b.lift * u.shadow.w);
}

fn emit(p: Pt, world: vec2f, side: f32) -> VOut {
  var o: VOut;
  o.clip = clip_of(world);
  o.world = world;
  o.side = side;
  o.nrm = p.nrm;
  o.strain = p.strain;
  o.body = body_of(p);
  return o;
}

fn fade(b: Body) -> f32 {
  return clamp(1.0 - b.pop * 1.15, 0.0, 1.0) * smoothstep(0.04, 0.3, b.grow);
}

// ── vertex stages ────────────────────────────────────────────────────────────

@vertex fn vs_fill(@builtin(vertex_index) vi: u32) -> VOut {
  let p = pts[vi];
  return emit(p, p.pos, 0.0);
}

@vertex fn vs_shadow_fill(@builtin(vertex_index) vi: u32) -> VOut {
  let p = pts[vi];
  let b = bodies[body_of(p)];
  return emit(p, p.pos + shadow_offset(b), 0.0);
}

@vertex fn vs_shadow_rim(@builtin(vertex_index) vi: u32) -> VOut {
  let p = pts[vi >> 1u];
  let side = f32(vi & 1u);
  let b = bodies[body_of(p)];
  let w = u.geo.x + u.geo.z * (1.0 + b.lift * 0.8);
  return emit(p, p.pos + shadow_offset(b) + p.nrm * (side * w), side);
}

@vertex fn vs_outline(@builtin(vertex_index) vi: u32) -> VOut {
  let p = pts[vi >> 1u];
  let side = f32(vi & 1u);
  // a hair of overlap inwards hides the seam against the fill
  let off = mix(-0.6, u.geo.x, side);
  return emit(p, p.pos + p.nrm * off, side);
}

@vertex fn vs_rim(@builtin(vertex_index) vi: u32) -> VOut {
  let p = pts[vi >> 1u];
  let side = f32(vi & 1u);
  let b = bodies[body_of(p)];
  // the rim shrinks at sharp corners (large miter) and when squashed, so the
  // inward strip never folds over itself
  let m = max(length(p.nrm), 1.0);
  let w = u.geo.y * (1.0 - 0.35 * b.squash) / (m * m);
  return emit(p, p.pos - (p.nrm / m) * side * w, side);
}

// ── fragment stages (premultiplied alpha out) ────────────────────────────────

@fragment fn fs_shadow(v: VOut) -> @location(0) vec4f {
  let b = bodies[v.body];
  let t = 1.0 - v.side;
  let a = u.geo.w * fade(b) * (1.0 - 0.45 * b.lift) * t * t * (3.0 - 2.0 * t);
  return vec4f(u.ink.rgb * a, a);
}

@fragment fn fs_outline(v: VOut) -> @location(0) vec4f {
  let b = bodies[v.body];
  let a = fade(b);
  return vec4f(u.ink.rgb * a, a);
}

@fragment fn fs_fill(v: VOut) -> @location(0) vec4f {
  let b = bodies[v.body];
  let r = max(b.radius, 1.0);
  let l = (v.world - b.center) / r;
  var c = b.color.rgb;

  // soft top light
  c = c * (1.05 - 0.13 * clamp(l.y, -1.0, 1.0));

  // printed halftone in the lower half, rotated 45°, sized in CSS px
  let cell = u.shadow.z;
  let g = mat2x2f(0.7071, 0.7071, -0.7071, 0.7071) * (v.world / cell);
  let f = fract(g) - vec2f(0.5);
  let d = length(f) * cell;
  let tone = smoothstep(0.15, 0.95, l.y) * 0.5;
  let rad = sqrt(tone) * cell * 0.62;
  let aa = 0.8 / max(u.res.w, 1.0);
  let ht = 1.0 - smoothstep(rad - aa, rad + aa, d);
  c = mix(c, c * 0.8, ht * step(0.001, tone));

  // squash-dependent gloss: the highlight blooms and stretches when compressed
  let sq = clamp(b.squash, 0.0, 1.0);
  let hp = (l - vec2f(-0.3, -0.48)) * vec2f(1.0 - 0.25 * sq, 1.7);
  let spec = exp(-dot(hp, hp) / (0.03 + 0.07 * sq)) * (0.26 + 0.42 * sq);
  c = mix(c, vec3f(1.0), clamp(spec, 0.0, 0.85));

  // local strain warms the surface a touch
  c = c + vec3f(0.06, 0.03, 0.0) * v.strain;

  // pop: blanch as it deflates
  c = mix(c, vec3f(1.0), b.pop * 0.5);

  let a = fade(b);
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)) * a, a);
}

@fragment fn fs_rim(v: VOut) -> @location(0) vec4f {
  let b = bodies[v.body];
  let n = normalize(v.nrm + vec2f(1e-5, 0.0));
  let light = normalize(vec2f(-0.55, -0.83));
  let lit = dot(n, light);
  let t = v.side;
  let band = smoothstep(0.0, 0.22, t) * (1.0 - smoothstep(0.32, 0.92, t));
  let corner = 1.0 / max(dot(v.nrm, v.nrm), 1.0);
  let hl = smoothstep(0.1, 0.85, lit) * band * (0.5 + 0.35 * b.squash + 0.35 * v.strain) * corner;
  let sh = smoothstep(0.1, 0.8, -lit) * (1.0 - t) * (1.0 - t) * 0.26;
  let a = fade(b);
  let ah = clamp(hl, 0.0, 0.9) * a;
  let ashade = sh * a;
  let alpha = ah + ashade * (1.0 - ah);
  return vec4f(vec3f(ah), alpha);
}
