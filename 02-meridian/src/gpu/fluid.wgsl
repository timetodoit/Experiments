// ─────────────────────────────────────────────────────────────────────────────
//  MERIDIAN · fluid.wgsl
//  Stable fluids (Stam 1999 · GPU Gems ch. 38) as WGSL compute kernels.
//  Fields live in storage buffers; all sampling is manual bilinear filtering.
//
//  Grid convention: cell (0,0) is top-left, y grows downward (DOM space).
//  Velocity grid  ≈ 1/4 of the viewport (CSS px), units = velocity cells / s.
//  Dye grid       = 2 × velocity grid. Dye texel = (rgb · density, density).
//
//  This file is split on "// @@name" markers. COMMON is prepended to every
//  kernel, MASK only to the kernels that read the headline mask texture.
//  Each kernel is compiled as its own module with its own bindings, so no
//  binding is ever shared between a read and a read_write view.
// ─────────────────────────────────────────────────────────────────────────────

// @@COMMON
struct Splat {
  pos: vec2f,     // viewport uv, y down
  force: vec2f,   // line: velocity cells/s · radial: x = outward speed
  color: vec4f,   // rgb pigment, a = density of ink added at the centre
  radius: f32,    // gaussian radius in viewport-height units
  kind: f32,      // 0 = line splat, 1 = radial burst
  pad: vec2f,
};                // 48 bytes

struct SimU {
  vsize: vec2f,          //   0  velocity grid size
  dsize: vec2f,          //   8  dye grid size
  dt: f32,               //  16
  time: f32,             //  20
  curl: f32,             //  24  vorticity confinement strength
  velDiss: f32,          //  28
  dyeDiss: f32,          //  32
  nSplats: f32,          //  36
  textRate: f32,         //  40  how fast the headline re-forms (1/s)
  reveal: f32,           //  44  write-on progress 0..1 (mask.g = write order)
  textColor: vec4f,      //  48  rgb = headline ink, a = target density
  shift: vec2f,          //  64  page scroll this frame, in viewport uv
  maskOff: vec2f,        //  72  headline mask offset, in dye cells
  inkTint: vec4f,        //  80  rgb = palette ink, a = how much old ink re-themes
  light: vec4f,          //  96  xy = screen dir towards sun/moon, z = intensity, w = night
  splats: array<Splat, 32>, // 112
};

@group(0) @binding(0) var<uniform> u: SimU;

fn vdim() -> vec2i { return vec2i(u.vsize); }
fn ddim() -> vec2i { return vec2i(u.dsize); }

fn vix(c: vec2i) -> u32 {
  let s = vdim();
  let q = clamp(c, vec2i(0), s - vec2i(1));
  return u32(q.y * s.x + q.x);
}

fn dix(c: vec2i) -> u32 {
  let s = ddim();
  let q = clamp(c, vec2i(0), s - vec2i(1));
  return u32(q.y * s.x + q.x);
}

fn aspectRatio() -> f32 { return u.vsize.x / u.vsize.y; }

fn splatDelta(uv: vec2f, s: Splat) -> vec2f {
  var d = uv - s.pos;
  d.x *= aspectRatio();
  return d;
}

fn splatW(uv: vec2f, s: Splat) -> f32 {
  let d = splatDelta(uv, s);
  return exp(-dot(d, d) / max(s.radius * s.radius, 1e-6));
}

// @@MASK
// Headline mask: r = coverage, g = write order (0 → 1, line by line, left → right)
@group(0) @binding(3) var mask: texture_2d<f32>;

fn maskAt(dc: vec2i) -> vec2f {
  let sz = vec2i(textureDimensions(mask));
  let p = dc + vec2i(u.maskOff);
  let inside = p.x >= 0 && p.y >= 0 && p.x < sz.x && p.y < sz.y;
  let m = textureLoad(mask, clamp(p, vec2i(0), sz - vec2i(1)), 0).rg;
  return select(vec2f(0.0), m, inside);
}

// @@vforces
// velocity: copy B → A, adding pointer/burst splats and the headline's bleed
@group(0) @binding(1) var<storage, read> velIn: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> velOut: array<vec2f>;

@compute @workgroup_size(8, 8)
fn cs_vforces(@builtin(global_invocation_id) gid: vec3u) {
  let s = vdim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let i = vix(c);
  let uv = (vec2f(c) + 0.5) / u.vsize;
  var v = velIn[i];

  let n = u32(u.nSplats);
  for (var k = 0u; k < n; k++) {
    let sp = u.splats[k];
    let w = splatW(uv, sp);
    if (sp.kind > 0.5) {
      let d = splatDelta(uv, sp);
      v += d / (length(d) + 1e-4) * sp.force.x * w;
    } else {
      v += sp.force * w;
    }
  }

  // the letters never sit still: a slow wobble inside the glyphs, and a small
  // downward "drip" right behind the pen while the headline writes itself
  let m = maskAt(c * 2);
  if (m.x > 0.0) {
    let t = u.time;
    let wob = vec2f(
      sin(uv.y * 47.0 + t * 1.7) + sin(uv.x * 23.0 - t * 0.9),
      cos(uv.x * 41.0 - t * 1.3) + cos(uv.y * 19.0 + t * 0.7)
    );
    v += wob * m.x * 2.5 * u.dt;
    let pd = (m.y - u.reveal) / 0.02;
    v.y += exp(-pd * pd) * m.x * 160.0 * u.dt;
  }
  velOut[i] = v;
}

// @@curl
@group(0) @binding(1) var<storage, read> velIn: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> curlOut: array<f32>;

@compute @workgroup_size(8, 8)
fn cs_curl(@builtin(global_invocation_id) gid: vec3u) {
  let s = vdim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let L = velIn[vix(c - vec2i(1, 0))].y;
  let R = velIn[vix(c + vec2i(1, 0))].y;
  let B = velIn[vix(c - vec2i(0, 1))].x;
  let T = velIn[vix(c + vec2i(0, 1))].x;
  curlOut[vix(c)] = 0.5 * ((R - L) - (T - B));
}

// @@vort
// vorticity confinement: f = ε (N × ω), N = ∇|ω| / |∇|ω||
@group(0) @binding(1) var<storage, read> velIn: array<vec2f>;
@group(0) @binding(2) var<storage, read> curlIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> velOut: array<vec2f>;

@compute @workgroup_size(8, 8)
fn cs_vort(@builtin(global_invocation_id) gid: vec3u) {
  let s = vdim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let L = abs(curlIn[vix(c - vec2i(1, 0))]);
  let R = abs(curlIn[vix(c + vec2i(1, 0))]);
  let B = abs(curlIn[vix(c - vec2i(0, 1))]);
  let T = abs(curlIn[vix(c + vec2i(0, 1))]);
  let C = curlIn[vix(c)];
  var f = 0.5 * vec2f(T - B, R - L);
  f = f / (length(f) + 1e-4);
  f = f * u.curl * C * vec2f(1.0, -1.0);
  let v = velIn[vix(c)] + f * u.dt;
  velOut[vix(c)] = clamp(v, vec2f(-2000.0), vec2f(2000.0));
}

// @@div
// divergence, with reflected velocity at the walls (no-through boundary)
@group(0) @binding(1) var<storage, read> velIn: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> divOut: array<f32>;

@compute @workgroup_size(8, 8)
fn cs_div(@builtin(global_invocation_id) gid: vec3u) {
  let s = vdim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let C = velIn[vix(c)];
  var L = velIn[vix(c - vec2i(1, 0))].x;
  var R = velIn[vix(c + vec2i(1, 0))].x;
  var B = velIn[vix(c - vec2i(0, 1))].y;
  var T = velIn[vix(c + vec2i(0, 1))].y;
  if (c.x == 0) { L = -C.x; }
  if (c.x == s.x - 1) { R = -C.x; }
  if (c.y == 0) { B = -C.y; }
  if (c.y == s.y - 1) { T = -C.y; }
  divOut[vix(c)] = 0.5 * (R - L + T - B);
}

// @@pdecay
// warm-start the pressure solve from a damped copy of last frame
@group(0) @binding(1) var<storage, read_write> pOut: array<f32>;

@compute @workgroup_size(8, 8)
fn cs_pdecay(@builtin(global_invocation_id) gid: vec3u) {
  let s = vdim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let i = vix(c);
  pOut[i] = pOut[i] * 0.8;
}

// @@jacobi
@group(0) @binding(1) var<storage, read> pIn: array<f32>;
@group(0) @binding(2) var<storage, read> divIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> pOut: array<f32>;

@compute @workgroup_size(8, 8)
fn cs_jacobi(@builtin(global_invocation_id) gid: vec3u) {
  let s = vdim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let L = pIn[vix(c - vec2i(1, 0))];
  let R = pIn[vix(c + vec2i(1, 0))];
  let B = pIn[vix(c - vec2i(0, 1))];
  let T = pIn[vix(c + vec2i(0, 1))];
  pOut[vix(c)] = (L + R + B + T - divIn[vix(c)]) * 0.25;
}

// @@grad
// projection: subtract the pressure gradient → divergence-free velocity
@group(0) @binding(1) var<storage, read> velIn: array<vec2f>;
@group(0) @binding(2) var<storage, read> pIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> velOut: array<vec2f>;

@compute @workgroup_size(8, 8)
fn cs_grad(@builtin(global_invocation_id) gid: vec3u) {
  let s = vdim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let L = pIn[vix(c - vec2i(1, 0))];
  let R = pIn[vix(c + vec2i(1, 0))];
  let B = pIn[vix(c - vec2i(0, 1))];
  let T = pIn[vix(c + vec2i(0, 1))];
  let i = vix(c);
  velOut[i] = velIn[i] - 0.5 * vec2f(R - L, T - B);
}

// @@vadvect
// semi-Lagrangian self-advection; `shift` carries the field with page scroll
@group(0) @binding(1) var<storage, read> velIn: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> velOut: array<vec2f>;

fn sampleVel(p: vec2f) -> vec2f {
  let q = p - 0.5;
  let i0 = vec2i(floor(q));
  let f = q - vec2f(i0);
  let a = velIn[vix(i0)];
  let b = velIn[vix(i0 + vec2i(1, 0))];
  let cc = velIn[vix(i0 + vec2i(0, 1))];
  let d = velIn[vix(i0 + vec2i(1, 1))];
  let inside = p.x >= 0.0 && p.y >= 0.0 && p.x <= u.vsize.x && p.y <= u.vsize.y;
  return select(vec2f(0.0), mix(mix(a, b, f.x), mix(cc, d, f.x), f.y), inside);
}

@compute @workgroup_size(8, 8)
fn cs_vadvect(@builtin(global_invocation_id) gid: vec3u) {
  let s = vdim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let i = vix(c);
  let p = vec2f(c) + 0.5 - u.dt * velIn[i] + u.shift * u.vsize;
  velOut[i] = sampleVel(p) / (1.0 + u.velDiss * u.dt);
}

// @@dadvect
@group(0) @binding(1) var<storage, read> dyeIn: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> dyeOut: array<vec4f>;

fn sampleVel(p: vec2f) -> vec2f {
  let q = p - 0.5;
  let i0 = vec2i(floor(q));
  let f = q - vec2f(i0);
  let a = vel[vix(i0)];
  let b = vel[vix(i0 + vec2i(1, 0))];
  let cc = vel[vix(i0 + vec2i(0, 1))];
  let d = vel[vix(i0 + vec2i(1, 1))];
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}

fn sampleDye(p: vec2f) -> vec4f {
  let q = p - 0.5;
  let i0 = vec2i(floor(q));
  let f = q - vec2f(i0);
  let a = dyeIn[dix(i0)];
  let b = dyeIn[dix(i0 + vec2i(1, 0))];
  let cc = dyeIn[dix(i0 + vec2i(0, 1))];
  let d = dyeIn[dix(i0 + vec2i(1, 1))];
  let inside = p.x >= 0.0 && p.y >= 0.0 && p.x <= u.dsize.x && p.y <= u.dsize.y;
  return select(vec4f(0.0), mix(mix(a, b, f.x), mix(cc, d, f.x), f.y), inside);
}

@compute @workgroup_size(8, 8)
fn cs_dadvect(@builtin(global_invocation_id) gid: vec3u) {
  let s = ddim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let uvc = (vec2f(c) + 0.5) / u.dsize;
  let v = sampleVel(uvc * u.vsize);
  let ratio = u.dsize / u.vsize;
  let p = vec2f(c) + 0.5 - u.dt * v * ratio + u.shift * u.dsize;
  dyeOut[dix(c)] = sampleDye(p) / (1.0 + u.dyeDiss * u.dt);
}

// @@dforces
// dye: copy B → A adding splat ink, then pull the glyphs back towards the
// headline mask (this is what makes smeared letters re-form)
@group(0) @binding(1) var<storage, read> dyeIn: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dyeOut: array<vec4f>;

@compute @workgroup_size(8, 8)
fn cs_dforces(@builtin(global_invocation_id) gid: vec3u) {
  let s = ddim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let i = dix(c);
  let uv = (vec2f(c) + 0.5) / u.dsize;
  var d = dyeIn[i];

  let n = u32(u.nSplats);
  for (var k = 0u; k < n; k++) {
    let sp = u.splats[k];
    let w = splatW(uv, sp);
    d += vec4f(sp.color.rgb, 1.0) * (sp.color.a * w);
  }

  let m = maskAt(c);
  if (m.x > 0.002) {
    let written = 1.0 - smoothstep(u.reveal - 0.004, u.reveal, m.y);
    let front = smoothstep(u.reveal - 0.06, u.reveal, m.y) * written;
    let rate = mix(u.textRate, 18.0, front);
    let k = (1.0 - exp(-rate * u.dt)) * m.x * written;
    let goal = vec4f(u.textColor.rgb, 1.0) * (u.textColor.a * m.x);
    d = mix(d, goal, k);
  }
  dyeOut[i] = clamp(d, vec4f(0.0), vec4f(12.0));
}

// @@shade
// dye → premultiplied display colour: relief lighting from the density
// gradient (wet-ink sheen towards the sun), watercolour edge pooling by day
// and edge glow by night
@group(0) @binding(1) var<storage, read> dyeIn: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dispOut: array<vec4f>;

fn alphaAt(c: vec2i) -> f32 {
  return 1.0 - exp(-dyeIn[dix(c)].a * 1.4);
}

@compute @workgroup_size(8, 8)
fn cs_shade(@builtin(global_invocation_id) gid: vec3u) {
  let s = ddim();
  let c = vec2i(gid.xy);
  if (c.x >= s.x || c.y >= s.y) { return; }
  let d = dyeIn[dix(c)];
  let a = 1.0 - exp(-d.a * 1.4);
  var col = d.rgb / max(d.a, 1e-3);
  col = mix(col, u.inkTint.rgb, u.inkTint.a);

  let g = 0.5 * vec2f(
    alphaAt(c + vec2i(1, 0)) - alphaAt(c - vec2i(1, 0)),
    alphaAt(c + vec2i(0, 1)) - alphaAt(c - vec2i(0, 1))
  );
  let nrm = normalize(vec3f(-g * 7.0, 1.0));
  let ld = normalize(vec3f(u.light.xy, 0.8));
  let relief = 1.0 + (dot(nrm, ld) - ld.z) * 1.1;
  let hv = normalize(ld + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(nrm, hv), 0.0), 60.0) * u.light.z * 0.5 * smoothstep(0.05, 0.5, a);

  let edge = clamp(length(g) * 4.0, 0.0, 1.0);
  let edgeK = mix(1.0 - 0.4 * edge, 1.0 + 0.6 * edge, u.light.w);
  let rgb = clamp(col * relief * edgeK, vec3f(0.0), vec3f(1.5));
  dispOut[dix(c)] = vec4f(rgb * a + vec3f(spec), a);
}
