// ─────────────────────────────────────────────────────────────────────────────
//  FIELD STATION 04 · survey.wgsl
//  Procedural terrain (contours + hillshade), a morphing scanner lens and a
//  pollen particle system that flows downhill along the terrain gradient.
//  "map space": m = (fragPx - res/2) / res.y   (y grows downward, like the DOM)
// ─────────────────────────────────────────────────────────────────────────────

struct U {
  res: vec2f,
  time: f32,
  dt: f32,
  mouse: vec2f,
  mouseVel: vec2f,
  lens: vec2f,
  press: f32,
  zoom: f32,
  rA: vec4f,
  rB: vec4f,
  rC: vec4f,
  dpr: f32,
  scan: f32,
  count: f32,
  intro: f32,
  shocks: array<vec4f, 8>, // xy = centre (map), z = start time, w = strength
};

struct Particle {
  pos: vec2f,
  vel: vec2f,
  life: f32,
  seed: f32,
  pad: vec2f,
};

@group(0) @binding(0) var<uniform> u: U;

// ── noise ───────────────────────────────────────────────────────────────────
fn hash2(p: vec2f) -> vec2f {
  let k = vec2f(0.3183099, 0.3678794);
  let q = p * k + k.yx;
  return -1.0 + 2.0 * fract(16.0 * k * fract(q.x * q.y * (q.x + q.y)));
}

fn hash1(n: f32) -> f32 {
  return fract(sin(n) * 43758.5453123);
}

fn gnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(hash2(i), f);
  let b = dot(hash2(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0));
  let c = dot(hash2(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0));
  let d = dot(hash2(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  let rot = mat2x2f(0.8, 0.6, -0.6, 0.8);
  for (var i = 0; i < 5; i++) {
    s += a * gnoise(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return s;
}

// base terrain, no interaction
fn terrain(m: vec2f) -> f32 {
  var p = m * (2.4 / u.zoom) + vec2f(3.1, 1.7);
  p += 0.05 * vec2f(sin(u.time * 0.11 + p.y * 1.3), cos(u.time * 0.09 + p.x * 1.1));
  return 0.5 + fbm(p) * 0.9;
}

// terrain + cursor depression + seismic ripples
fn height(m: vec2f) -> f32 {
  var h = terrain(m);
  let d = m - u.mouse;
  h -= u.press * 0.42 * exp(-dot(d, d) / 0.010);
  for (var s = 0; s < 8; s++) {
    let sh = u.shocks[s];
    let age = u.time - sh.z;
    if (age > 0.0 && age < 3.0) {
      let r = length(m - sh.xy);
      let x = (r - age * 0.42) * 16.0;
      h += sh.w * 0.07 * sin(x * 2.2) * exp(-x * x * 0.25) * (1.0 - age / 3.0);
    }
  }
  return h;
}

fn sdBox(p: vec2f, mn: vec2f, mx: vec2f) -> f32 {
  let c = (mn + mx) * 0.5;
  let b = max((mx - mn) * 0.5, vec2f(0.0));
  let d = abs(p - c) - b;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

fn lensSdf(m: vec2f) -> f32 {
  let q = m - u.lens;
  return min(min(sdBox(q, u.rA.xy, u.rA.zw), sdBox(q, u.rB.xy, u.rB.zw)), sdBox(q, u.rC.xy, u.rC.zw));
}

fn toMap(fp: vec2f) -> vec2f {
  return (fp - u.res * 0.5) / u.res.y;
}

// @@COMPUTE
// ── particle simulation ─────────────────────────────────────────────────────
@group(0) @binding(1) var<storage, read_write> ps: array<Particle>;

fn curl(p: vec2f) -> vec2f {
  let e = 0.05;
  let a = gnoise(p + vec2f(0.0, e));
  let b = gnoise(p - vec2f(0.0, e));
  let c = gnoise(p + vec2f(e, 0.0));
  let d = gnoise(p - vec2f(e, 0.0));
  return vec2f(a - b, -(c - d)) / (2.0 * e);
}

fn respawn(p: ptr<function, Particle>, salt: f32) {
  let aspect = u.res.x / u.res.y;
  let r1 = hash1((*p).seed * 17.13 + salt * 3.7);
  let r2 = hash1((*p).seed * 31.71 + salt * 1.3 + 4.1);
  (*p).pos = vec2f((r1 - 0.5) * aspect * 1.04, (r2 - 0.5) * 1.04);
  (*p).vel = vec2f(0.0);
  (*p).life = 0.6 + hash1((*p).seed + salt) * 1.4;
}

@compute @workgroup_size(256)
fn cs_particles(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&ps)) {
    return;
  }
  var p = ps[i];
  let dt = u.dt;

  let e = 0.003;
  let hx = height(p.pos + vec2f(e, 0.0)) - height(p.pos - vec2f(e, 0.0));
  let hy = height(p.pos + vec2f(0.0, e)) - height(p.pos - vec2f(0.0, e));
  let grad = vec2f(hx, hy) / (2.0 * e);
  let h = height(p.pos);

  var acc = -grad * 0.2;
  acc += curl(p.pos * 3.2 + vec2f(u.time * 0.03, 0.0)) * 0.11;

  // cursor wake: moving the lens shoves pollen aside
  let dm = p.pos - u.mouse;
  let r2 = dot(dm, dm);
  let speed = length(u.mouseVel);
  acc += (dm / sqrt(r2 + 1e-5)) * (1.0 - u.press) * min(speed, 4.0) * 1.6 * exp(-r2 / 0.003);
  // swirl around the depression while held
  acc += vec2f(-dm.y, dm.x) * u.press * 2.2 * exp(-r2 / 0.02);

  for (var s = 0; s < 8; s++) {
    let sh = u.shocks[s];
    let age = u.time - sh.z;
    if (age > 0.0 && age < 2.5) {
      let d = p.pos - sh.xy;
      let r = length(d) + 1e-4;
      let x = (r - age * 0.42) * 22.0;
      acc += (d / r) * sh.w * 9.0 * exp(-x * x) * (1.0 - age / 2.5);
    }
  }

  let water = smoothstep(0.37, 0.34, h);
  p.vel += acc * dt;
  p.vel *= exp(-dt * (1.4 + water * 3.5));
  p.pos += p.vel * dt;
  p.life -= dt * (0.12 + water * 0.9);

  let aspect = u.res.x / u.res.y;
  if (p.life <= 0.0 || abs(p.pos.x) > aspect * 0.55 || abs(p.pos.y) > 0.56) {
    respawn(&p, u.time);
  }
  ps[i] = p;
}

// @@RENDER
// ── fullscreen terrain ──────────────────────────────────────────────────────
@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

const YELLOW = vec3f(0.957, 1.0, 0.0);
const INK = vec3f(0.024, 0.024, 0.02);

@fragment
fn fs_terrain(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let m = toMap(fp.xy);
  let h = height(m);

  // derivatives taken in uniform control flow
  let lv = h * 22.0;
  let fw = fwidth(lv);
  let dhx = dpdx(h) * u.res.y;
  let dhy = dpdy(h) * u.res.y;

  let n = normalize(vec3f(-dhx * 0.35, -dhy * 0.35, 1.0));
  let shade = clamp(dot(n, normalize(vec3f(-0.55, -0.6, 0.6))), 0.0, 1.0);

  let f = fract(lv);
  let line = 1.0 - smoothstep(0.0, fw * 1.25, min(f, 1.0 - f));
  let idx = floor(lv + 0.5);
  let major = select(0.0, 1.0, abs(idx - 5.0 * floor(idx / 5.0 + 0.5)) < 0.5);

  // water: dotted fill below sea level
  let sea = 0.36;
  let water = smoothstep(sea + 0.004, sea - 0.004, h);
  let cell = fract(fp.xy / (6.0 * u.dpr)) - 0.5;
  let dots = 1.0 - smoothstep(0.10, 0.22, length(cell));

  // outside lens: dim HUD map
  var col = INK;
  col += vec3f(0.02, 0.022, 0.0) * shade * (1.0 - water);
  col = mix(col, vec3f(0.36, 0.42, 0.5) * 0.35, water * dots * 0.9);
  let lineA = mix(0.16, 0.55, major) * (1.0 - water * 0.6);
  col += YELLOW * line * lineA * 0.85;

  // shockwave glow rings
  for (var s = 0; s < 8; s++) {
    let sh = u.shocks[s];
    let age = u.time - sh.z;
    if (age > 0.0 && age < 3.0) {
      let r = length(m - sh.xy);
      let ring = exp(-pow((r - age * 0.42) * 90.0, 2.0)) * (1.0 - age / 3.0);
      col += YELLOW * ring * 0.6 * sh.w;
    }
  }

  // inside lens: thermal scan with vertical halftone stripes
  let sd = lensSdf(m) * u.res.y;
  let inside = 1.0 - smoothstep(-0.5, 0.5, sd);
  if (u.scan > 0.001) {
    let intensity = clamp(pow(shade, 1.6) * 1.25 + (h - 0.5) * 0.9 - water * 0.4, 0.0, 1.0);
    let stripe = fract(fp.x / (4.0 * u.dpr));
    let bar = smoothstep(intensity + 0.08, intensity - 0.08, abs(stripe - 0.5) * 2.0);
    var scan = mix(INK, YELLOW, bar);
    // water reads as a yellow dot screen; contours invert against whatever is under them
    scan = mix(scan, YELLOW * 0.8, water * dots * (1.0 - bar));
    let lineCol = mix(YELLOW, INK, bar);
    scan = mix(scan, lineCol, line * (0.45 + major * 0.5));
    // crosshair at lens centre
    let c = (fp.xy - (u.lens * u.res.y + u.res * 0.5)) / u.dpr;
    let ch = select(0.0, 1.0, (abs(c.x) < 11.0 && abs(c.y) < 0.75) || (abs(c.y) < 11.0 && abs(c.x) < 0.75));
    scan = mix(scan, vec3f(1.0), ch);
    col = mix(col, scan, inside * u.scan);
    let border = 1.0 - smoothstep(0.4 * u.dpr, 1.3 * u.dpr, abs(sd));
    col = mix(col, YELLOW, border * u.scan);
  }

  // film grain + vignette
  let g = hash1(dot(fp.xy, vec2f(12.9898, 78.233)) + fract(u.time) * 91.0) - 0.5;
  col += g * 0.035;
  let vg = length((fp.xy / u.res) - 0.5);
  col *= 1.0 - vg * vg * 0.9;

  return vec4f(col * u.intro, 1.0);
}

// ── particle render (instanced quads) ───────────────────────────────────────
@group(0) @binding(1) var<storage, read> psr: array<Particle>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) alpha: f32,
};

@vertex
fn vs_particle(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = psr[ii];
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let c = corners[vi];
  let speed = length(p.vel);
  let size = (0.75 + min(speed * 4.0, 0.9)) * u.dpr;
  let px = p.pos * u.res.y + u.res * 0.5 + c * size;
  var o: VOut;
  o.pos = vec4f(px.x / u.res.x * 2.0 - 1.0, 1.0 - px.y / u.res.y * 2.0, 0.0, 1.0);
  o.uv = c;
  let fade = smoothstep(0.0, 0.25, p.life) * smoothstep(2.1, 1.7, p.life);
  o.alpha = clamp(0.035 + speed * 1.6, 0.0, 0.55) * fade * u.intro;
  return o;
}

@fragment
fn fs_particle(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }
  let m = toMap(in.pos.xy);
  let inside = 1.0 - smoothstep(-0.5, 0.5, lensSdf(m) * u.res.y);
  let lensOn = inside * u.scan;
  let outsideCol = YELLOW * 0.55;
  let insideCol = vec3f(0.02);
  let col = mix(outsideCol, insideCol, lensOn);
  let a = in.alpha * (1.0 - d * 0.6) * mix(1.0, 3.0, lensOn);
  // additive outside, darkening ink inside the lens (premultiplied)
  return vec4f(col * a * (1.0 - lensOn), a * lensOn * 0.85);
}
