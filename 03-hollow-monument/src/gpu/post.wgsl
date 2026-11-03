// ─────────────────────────────────────────────────────────────────────────────
//  HOLLOW MONUMENT · post.wgsl
//  HDR points → ¼-res bright pass → separable gaussian (H, V) → composite:
//  bloom, filmic shoulder, faint radial aberration, scanlines, grain, vignette.
//  Every textureSample happens at the top level of a fragment entry point
//  (uniform control flow).
// ─────────────────────────────────────────────────────────────────────────────

struct P {
  res: vec4f,  // output w, h (px), dpr, time
  fx: vec4f,   // bloom strength, exposure, grain, scanline strength
  bg: vec4f,   // background rgb (display space), vignette
  misc: vec4f, // intro fade, bright-pass threshold, aberration, flash (shock) 0..1
};

@group(0) @binding(0) var<uniform> pu: P;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;

struct FV {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> FV {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: FV;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

// full-res HDR → ¼ res: four bilinear taps cover a 4×4 footprint, then a soft-knee threshold
@fragment
fn fs_down(i: FV) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(src));
  let a = textureSample(src, samp, i.uv + t * vec2f(-1.0, -1.0)).rgb;
  let b = textureSample(src, samp, i.uv + t * vec2f(1.0, -1.0)).rgb;
  let c = textureSample(src, samp, i.uv + t * vec2f(-1.0, 1.0)).rgb;
  let d = textureSample(src, samp, i.uv + t * vec2f(1.0, 1.0)).rgb;
  let col = (a + b + c + d) * 0.25;
  let l = max(luma(col), 1e-4);
  let thr = pu.misc.y;
  let k = clamp((l - thr * 0.6) / (thr * 0.8), 0.0, 1.0);
  return vec4f(col * k * k, 1.0);
}

// 9-tap gaussian as 5 linear-filtered taps
fn blur(uv: vec2f, dir: vec2f) -> vec3f {
  let t = dir / vec2f(textureDimensions(src));
  var c = textureSample(src, samp, uv).rgb * 0.2270270270;
  c += textureSample(src, samp, uv + t * 1.3846153846).rgb * 0.3162162162;
  c += textureSample(src, samp, uv - t * 1.3846153846).rgb * 0.3162162162;
  c += textureSample(src, samp, uv + t * 3.2307692308).rgb * 0.0702702703;
  c += textureSample(src, samp, uv - t * 3.2307692308).rgb * 0.0702702703;
  return c;
}

@fragment
fn fs_blur_h(i: FV) -> @location(0) vec4f {
  return vec4f(blur(i.uv, vec2f(1.6, 0.0)), 1.0);
}

@fragment
fn fs_blur_v(i: FV) -> @location(0) vec4f {
  return vec4f(blur(i.uv, vec2f(0.0, 1.6)), 1.0);
}

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_comp(i: FV) -> @location(0) vec4f {
  let uv = i.uv;
  let ctr = uv - 0.5;
  let ab = pu.misc.z * dot(ctr, ctr);
  let cr = textureSample(src, samp, uv - ctr * ab).r;
  let cg = textureSample(src, samp, uv).g;
  let cb = textureSample(src, samp, uv + ctr * ab).b;
  let bl = textureSample(bloomTex, samp, uv).rgb;

  var hdr = vec3f(cr, cg, cb) + bl * pu.fx.x;
  hdr *= pu.misc.x;
  // filmic shoulder (exposure → 1 − e^−x), slightly desaturated highlights
  var col = vec3f(1.0) - exp(-hdr * pu.fx.y);
  col = mix(col, vec3f(luma(col)), 0.12 * smoothstep(0.5, 1.0, luma(col)));

  // background: near-black with a faint cold horizon lift
  let horizon = exp(-pow((uv.y - 0.58) * 3.2, 2.0)) * 0.012;
  let bg = pu.bg.rgb + vec3f(0.8, 0.85, 1.0) * horizon;
  col = bg + col * (vec3f(1.0) - bg);

  // click flash
  col += vec3f(1.0, 0.353, 0.122) * pu.misc.w * 0.05;

  // scanlines (2 css px period), grain, vignette
  let sl = 0.5 + 0.5 * cos(i.pos.y * PI_ / max(pu.res.z, 1.0));
  col *= 1.0 - pu.fx.w * sl;
  let g = hash12(i.pos.xy + fract(pu.res.w * 7.31) * 517.0) - 0.5;
  col += g * pu.fx.z;
  let v = dot(ctr * vec2f(1.0, 0.86), ctr * vec2f(1.0, 0.86));
  col *= 1.0 - pu.bg.w * smoothstep(0.08, 0.5, v);

  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}

const PI_ = 3.14159265;
