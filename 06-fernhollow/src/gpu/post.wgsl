// Fernhollow — post. Bloom mip chain (dual-filter down/up) and final composite:
// tonemap, split-RGB, film grain, speed-driven vignette.

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

fn down4(uv: vec2f) -> vec3f {
  let ts = 1.0 / vec2f(textureDimensions(src));
  let c = textureSample(src, samp, uv).rgb * 4.0;
  let a = textureSample(src, samp, uv + ts * vec2f(-1.0, -1.0)).rgb;
  let b = textureSample(src, samp, uv + ts * vec2f(1.0, -1.0)).rgb;
  let d = textureSample(src, samp, uv + ts * vec2f(-1.0, 1.0)).rgb;
  let e = textureSample(src, samp, uv + ts * vec2f(1.0, 1.0)).rgb;
  return (c + a + b + d + e) / 8.0;
}

// first level: soft-knee threshold + clamp so single hot pixels don't flicker
@fragment fn fs_down_first(i: VOut) -> @location(0) vec4f {
  var c = min(down4(i.uv), vec3f(24.0));
  let l = max(max(c.r, c.g), c.b);
  let thr = 0.75;
  let knee = 0.5;
  let s = clamp(l - thr + knee, 0.0, 2.0 * knee);
  let soft = s * s / (4.0 * knee + 1e-4);
  let w = max(soft, l - thr) / max(l, 1e-4);
  return vec4f(c * w, 1.0);
}
@fragment fn fs_down(i: VOut) -> @location(0) vec4f {
  return vec4f(down4(i.uv), 1.0);
}
@fragment fn fs_up(i: VOut) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(src));
  var s = textureSample(src, samp, i.uv + ts * vec2f(-2.0, 0.0)).rgb;
  s += textureSample(src, samp, i.uv + ts * vec2f(2.0, 0.0)).rgb;
  s += textureSample(src, samp, i.uv + ts * vec2f(0.0, -2.0)).rgb;
  s += textureSample(src, samp, i.uv + ts * vec2f(0.0, 2.0)).rgb;
  s += textureSample(src, samp, i.uv + ts * vec2f(-1.0, -1.0)).rgb * 2.0;
  s += textureSample(src, samp, i.uv + ts * vec2f(1.0, -1.0)).rgb * 2.0;
  s += textureSample(src, samp, i.uv + ts * vec2f(-1.0, 1.0)).rgb * 2.0;
  s += textureSample(src, samp, i.uv + ts * vec2f(1.0, 1.0)).rgb * 2.0;
  return vec4f(s / 12.0 * 0.92, 1.0);
}

// ── composite ────────────────────────────────────────────────────────────────
struct CU {
  res: vec4f, // w, h, 1/w, 1/h
  a: vec4f,   // time, exposure, bloom strength, grain
  b: vec4f,   // vignette strength, chromatic split, speed 0..1, disperse
};
@group(0) @binding(2) var bloomTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> cu: CU;

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn hash(p: vec2f) -> f32 {
  let q = fract(p * vec2f(443.897, 441.423));
  let r = q + dot(q, q.yx + 19.19);
  return fract((r.x + r.y) * r.x);
}

@fragment fn fs_composite(i: VOut) -> @location(0) vec4f {
  let uv = i.uv;
  let d = uv - 0.5;
  let aspect = cu.res.x * cu.res.w;
  // split-RGB, stronger towards the edges and with speed
  let ca = d * cu.b.y * (0.6 + dot(d, d) * 3.0);
  let hr = textureSample(src, samp, uv + ca).r;
  let hg = textureSample(src, samp, uv).g;
  let hb = textureSample(src, samp, uv - ca).b;
  let br = textureSample(bloomTex, samp, uv + ca * 1.6).r;
  let bg = textureSample(bloomTex, samp, uv).g;
  let bb = textureSample(bloomTex, samp, uv - ca * 1.6).b;
  var col = vec3f(hr, hg, hb) + vec3f(br, bg, bb) * cu.a.z;

  col *= cu.a.y;
  // night grade: cool shadows, keep highlights warm-cream
  let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3f(0.92, 1.0, 1.08), smoothstep(0.4, 0.0, lum) * 0.5);
  col = aces(col);

  // vignette tightens as the camera speeds up
  let vd = length(d * vec2f(aspect, 1.0)) / length(vec2f(aspect, 1.0) * 0.5);
  let inner = 0.62 - cu.b.z * 0.28;
  let vig = smoothstep(inner + 0.62, inner, vd);
  col *= mix(1.0, vig, cu.b.x);

  col = pow(col, vec3f(1.0 / 2.2));
  // film grain + dither (luma-weighted so blacks stay inky)
  let t = fract(cu.a.x * 7.31);
  let px = uv * cu.res.xy;
  let g = hash(px + t * 917.0) + hash(px * 1.7 - t * 311.0) - 1.0;
  col += g * cu.a.w * (0.35 + 0.65 * sqrt(max(lum, 0.0)));
  col += (hash(px + 3.3) - 0.5) / 255.0;
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
