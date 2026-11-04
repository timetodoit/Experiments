// Fernhollow — scene pass. Sky, terrain, leaves, light shafts, flowers, dust.
// All drawn into one HDR target; bloom/grade happen in post.wgsl.

struct U {
  viewProj: mat4x4f,
  view: mat4x4f,
  camPos: vec4f,   // xyz, w = time
  camRight: vec4f, // xyz, w = aspect
  camUp: vec4f,    // xyz, w = tan(fovY/2)
  camFwd: vec4f,   // xyz, w = dpr
  res: vec4f,      // w, h, 1/w, 1/h (device px)
  mouse: vec4f,    // x, y (device px, y up), strength 0..1, radius px
  params: vec4f,   // disperse 0..1, intro 0..1, speed 0..1, pixel scale (f * h / 2)
  fog: vec4f,      // rgb, density
  misc: vec4f,     // wind amount, reduced motion, push strength, calm-zone strength
};
@group(0) @binding(0) var<uniform> u: U;

fn T() -> f32 { return u.camPos.w; }

fn fogAmt(dist: f32) -> f32 {
  let k = dist * u.fog.w;
  return 1.0 - exp(-pow(k, 1.35));
}

fn hash11(p: f32) -> f32 { return fract(sin(p * 127.1 + 311.7) * 43758.5453); }
fn hash31(p: f32) -> vec3f {
  return fract(sin(vec3f(p * 127.1, p * 269.5 + 3.1, p * 419.2 + 7.7)) * 43758.5453);
}

// corners of a two-triangle quad
fn quadCorner(vi: u32) -> vec2f {
  var q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                          vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  return q[vi];
}

// screen-space repel field around the cursor. returns (offset px, glow)
fn mouseField(sp: vec2f) -> vec3f {
  let d = sp - u.mouse.xy;
  let r = u.mouse.w;
  let q = dot(d, d) / (r * r);
  let f = exp(-q) * u.mouse.z;
  let glow = exp(-q * 3.0) * u.mouse.z;
  return vec3f(d * f * u.misc.z, glow);
}

// calm the centre of the frame so the headline reads
fn calmZone(ndc: vec2f) -> f32 {
  // an ellipse around the headline, biased upwards; above the horizon it dims more
  let c = length((ndc - vec2f(0.0, 0.12)) * vec2f(0.75, 1.5));
  let up = smoothstep(-0.15, 0.25, ndc.y);
  return mix(1.0 - u.misc.w * (0.7 + 0.6 * up), 1.0, smoothstep(0.1, 0.8, c));
}

fn toScreen(clip: vec4f) -> vec2f {
  return (clip.xy / clip.w * 0.5 + 0.5) * u.res.xy;
}
fn fromScreen(sp: vec2f, clip: vec4f) -> vec4f {
  let ndc = sp * u.res.zw * 2.0 - 1.0;
  return vec4f(ndc * clip.w, clip.z, clip.w);
}

// ─────────────────────────────────────────────────────────────────────────────
// fullscreen helper
struct FsOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};
@vertex fn vs_sky(@builtin(vertex_index) vi: u32) -> FsOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: FsOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.ndc = p[vi];
  return o;
}

@fragment fn fs_sky(i: FsOut) -> @location(0) vec4f {
  let dir = normalize(u.camFwd.xyz + u.camRight.xyz * i.ndc.x * u.camRight.w * u.camUp.w
                      + u.camUp.xyz * i.ndc.y * u.camUp.w);
  let e = dir.y;
  // black zenith, deep blue band, a breath of teal right at the horizon
  var col = vec3f(0.0004, 0.0007, 0.0016);
  col = mix(vec3f(0.0016, 0.0046, 0.0095), col, smoothstep(-0.02, 0.26, e));
  col += vec3f(0.0012, 0.0075, 0.0095) * exp(-abs(e - 0.01) * 22.0);
  // a few faint stars, high up only
  let sd = dir / max(abs(dir.y), 0.2);
  let cell = floor(sd.xz * 140.0);
  let h = fract(sin(dot(cell, vec2f(12.9898, 78.233))) * 43758.5453);
  let local = fract(sd.xz * 140.0) - 0.5;
  let star = smoothstep(0.18, 0.0, length(local)) * step(0.9965, h) * smoothstep(0.12, 0.45, e);
  let tw = 0.6 + 0.4 * sin(T() * (1.0 + h * 3.0) + h * 80.0);
  col += vec3f(0.55, 0.65, 0.8) * star * tw * 0.6;
  return vec4f(col * u.params.y, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// terrain
struct TIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) extra: vec2f, // floor glow, patch noise
};
struct TOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) nrm: vec3f,
  @location(2) extra: vec2f,
};
@vertex fn vs_terrain(i: TIn) -> TOut {
  var o: TOut;
  o.pos = u.viewProj * vec4f(i.pos, 1.0);
  o.world = i.pos;
  o.nrm = i.nrm;
  o.extra = i.extra;
  return o;
}
@fragment fn fs_terrain(i: TOut) -> @location(0) vec4f {
  let n = normalize(i.nrm);
  let toCam = u.camPos.xyz - i.world;
  let dist = length(toCam);
  let v = toCam / dist;
  // near-black moss, barely lit by a cold sky and by the flowers themselves
  let moss = mix(vec3f(0.0016, 0.0032, 0.0022), vec3f(0.0028, 0.0046, 0.0028), i.extra.y);
  let sky = 0.6 + 0.4 * n.y;
  let moon = max(dot(n, normalize(vec3f(-0.4, 0.55, -0.7))), 0.0);
  let rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  var col = moss * sky + vec3f(0.002, 0.004, 0.006) * moon;
  col += vec3f(0.003, 0.010, 0.012) * rim * (1.0 - i.extra.x * 0.5);
  // bioluminescent bounce light on the valley floor, patchy
  let patchy = smoothstep(0.35, 0.75, i.extra.y);
  col += vec3f(0.004, 0.012, 0.011) * i.extra.x * (0.5 + patchy) * u.params.y;
  let f = fogAmt(dist);
  col = mix(col * u.params.y, u.fog.rgb, f);
  return vec4f(col, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// leaves & grass: cylindrical billboards anchored at the base, cut-out
struct LIn {
  @location(0) a0: vec4f, // pos3, height
  @location(1) a1: vec4f, // width, lean, seed, type
};
struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) info: vec4f, // type, fog, glow, seed
  @location(2) shade: f32,
};
@vertex fn vs_leaf(@builtin(vertex_index) vi: u32, i: LIn) -> LOut {
  var o: LOut;
  let c = quadCorner(vi);
  let v01 = c.y * 0.5 + 0.5;
  let base = i.a0.xyz;
  let seed = i.a1.z;
  let toCam = u.camPos.xyz - base;
  let dist = length(toCam);
  // leaves grow in further back than the flowers
  let grow = 1.0 - smoothstep(32.0 + seed * 22.0, 72.0 + seed * 30.0, dist);
  let g = grow * grow * (3.0 - 2.0 * grow);
  let intro = smoothstep(seed * 0.45, seed * 0.45 + 0.55, u.params.y);
  let dsp = smoothstep(seed * 0.3, seed * 0.3 + 0.7, u.params.x);
  let nearFade = smoothstep(0.8, 3.0, dist);
  let hgt = i.a0.w * mix(0.08, 1.0, g) * intro * (1.0 - dsp * 0.85) * mix(0.3, 1.0, nearFade);
  let wdt = i.a1.x * mix(0.4, 1.0, g);
  let side = normalize(vec3f(-toCam.z, 0.0, toCam.x));
  // sway grows with height along the blade
  let t = T();
  let w = sin(t * 1.1 + base.x * 0.21 + base.z * 0.17 + seed * 6.28) * 0.6
        + sin(t * 2.3 + base.x * 0.5 + seed * 3.0) * 0.25;
  let bend = v01 * v01;
  let swayDir = normalize(vec3f(0.8, 0.0, 0.6));
  var p = base + side * c.x * wdt + vec3f(0.0, v01 * hgt, 0.0);
  p += (swayDir * w * u.misc.x * 0.22 + side * i.a1.y * 0.6) * bend * hgt;
  var clip = u.viewProj * vec4f(p, 1.0);
  // cursor pushes the blade tips sideways in screen space
  let mid = u.viewProj * vec4f(base + vec3f(0.0, hgt * 0.6, 0.0), 1.0);
  var glow = 0.0;
  if (mid.w > 0.05 && clip.w > 0.05) {
    let mf = mouseField(toScreen(mid));
    glow = mf.z;
    let sp = toScreen(clip) + mf.xy * (0.25 + 0.75 * v01);
    clip = fromScreen(sp, clip);
  }
  o.pos = clip;
  o.uv = vec2f(c.x, v01);
  o.info = vec4f(i.a1.w, fogAmt(dist), glow, seed);
  o.shade = u.params.y;
  return o;
}
@fragment fn fs_leaf(i: LOut) -> @location(0) vec4f {
  let y = i.uv.y;
  var wprof: f32;
  if (i.info.x < 0.5) {
    wprof = pow(max(1.0 - y, 0.0), 0.75) * smoothstep(0.0, 0.06, y); // grass: taper to a tip
  } else {
    wprof = pow(max(sin(3.14159 * clamp(y * 0.92 + 0.04, 0.0, 1.0)), 0.0), 0.9); // leaf: lens
  }
  let x = abs(i.uv.x);
  let aa = max(fwidth(i.uv.x) * 1.2, 0.02);
  let a = smoothstep(wprof, wprof - aa, x) * step(0.001, wprof);
  // dark teal-green body, lit from below by the flowers, cold rim near the tip
  var col = mix(vec3f(0.0035, 0.010, 0.0085), vec3f(0.006, 0.016, 0.012), i.info.w);
  col += vec3f(0.004, 0.020, 0.016) * pow(1.0 - y, 2.0);
  col += vec3f(0.002, 0.010, 0.012) * smoothstep(0.5, 1.0, x / max(wprof, 0.01)) * y;
  col *= 1.0 - 0.35 * smoothstep(0.05, 0.0, abs(i.uv.x)) * step(0.5, i.info.x); // midrib
  col += vec3f(0.05, 0.16, 0.15) * i.info.z;
  col = mix(col * i.shade, u.fog.rgb, i.info.y);
  if (a < 0.04) { discard; }
  return vec4f(col * a, a);
}

// ─────────────────────────────────────────────────────────────────────────────
// light shafts: tall additive billboards standing in the distance
struct RIn {
  @location(0) a0: vec4f, // pos3, width
  @location(1) a1: vec4f, // height, intensity, seed, tint
};
struct ROut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) amp: vec4f, // rgb*intensity, seed
};
@vertex fn vs_ray(@builtin(vertex_index) vi: u32, i: RIn) -> ROut {
  var o: ROut;
  let c = quadCorner(vi);
  let v01 = c.y * 0.5 + 0.5;
  let base = i.a0.xyz;
  let toCam = u.camPos.xyz - base;
  let dist = length(toCam.xz);
  let side = normalize(vec3f(-toCam.z, 0.0, toCam.x));
  // shafts lean very slightly, like moonlight through a gap
  let p = base + side * (c.x * i.a0.w * (0.7 + 0.3 * v01) + v01 * i.a1.x * 0.08)
        + vec3f(0.0, v01 * i.a1.x, 0.0);
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.uv = vec2f(c.x, v01);
  let fade = smoothstep(18.0, 55.0, dist) * (1.0 - smoothstep(150.0, 210.0, dist));
  let flick = 0.65 + 0.35 * sin(T() * 0.23 + i.a1.z * 30.0) * sin(T() * 0.37 + i.a1.z * 11.0);
  let tint = mix(vec3f(0.30, 0.62, 0.78), vec3f(0.48, 0.48, 0.85), i.a1.w);
  o.amp = vec4f(tint * i.a1.y * fade * flick * 0.2 * u.params.y * (1.0 - u.params.x * 0.6), i.a1.z);
  return o;
}
@fragment fn fs_ray(i: ROut) -> @location(0) vec4f {
  let x = i.uv.x;
  let y = i.uv.y;
  let core = exp(-x * x * 5.0);
  let streak = 0.75 + 0.25 * sin(x * 9.0 + i.amp.w * 20.0 + y * 2.0);
  let vert = smoothstep(0.0, 0.22, y) * pow(1.0 - y, 1.6);
  let a = core * streak * vert;
  return vec4f(i.amp.rgb * a, 0.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// flowers: spherical billboards with a procedural rosette
struct FIn {
  @location(0) a0: vec4f, // pos3, size
  @location(1) a1: vec4f, // rgb, seed
  @location(2) a2: vec4f, // petals, rotation, palette index, intensity
};
struct FOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) @interpolate(flat) prm: vec4f, // petals, rotation, openness, mote
  @location(3) @interpolate(flat) amp: vec4f, // brightness, glow, alpha, seed
};

const HALO = 1.7; // quad extends past the petals for the soft glow

@vertex fn vs_flower(@builtin(vertex_index) vi: u32, i: FIn) -> FOut {
  var o: FOut;
  let c = quadCorner(vi);
  let seed = i.a1.w;
  let t = T();
  var p = i.a0.xyz;

  // wind sway (stems pivot at the ground: offset scales with size)
  let wind = u.misc.x;
  p.x += sin(t * 1.3 + p.x * 0.35 + p.z * 0.27 + seed * 6.28) * 0.05 * wind;
  p.z += cos(t * 1.1 + p.x * 0.22 - p.z * 0.31 + seed * 3.1) * 0.035 * wind;

  let rel0 = p - u.camPos.xyz;
  let dist = length(rel0);

  // bloom: tiny buds far away, full flowers close to the camera
  let near = 5.0 + seed * 9.0;
  let far = 34.0 + seed * 34.0;
  let grow = 1.0 - smoothstep(near, far, dist);
  let g = grow * grow * (3.0 - 2.0 * grow);

  // intro: flowers bloom in from darkness, staggered
  let intro = smoothstep(seed * 0.5, seed * 0.5 + 0.5, u.params.y);

  // hover: disperse into floating motes
  let dsp0 = smoothstep(seed * 0.35, seed * 0.35 + 0.65, u.params.x);
  let dsp = dsp0 * dsp0 * (3.0 - 2.0 * dsp0);
  let fwd = u.camFwd.xyz;
  let lateral = rel0 - fwd * dot(rel0, fwd);
  let outward = lateral / max(length(lateral), 0.5);
  let drift = vec3f(sin(t * 0.43 + seed * 21.0), sin(t * 0.31 + seed * 13.0) * 0.6 + 0.4,
                    cos(t * 0.37 + seed * 7.0));
  p += (outward * (1.5 + seed * 4.0) + vec3f(0.0, 0.8 + seed * 2.6, 0.0) + drift * 1.4) * dsp
       * clamp(dist * 0.08, 0.3, 2.0);

  let size = i.a0.w * mix(0.16, 1.0, g) * mix(0.0, 1.0, intro);
  let moteSize = 0.03 + seed * 0.03;
  let worldR = mix(size, moteSize, dsp);

  var clip = u.viewProj * vec4f(p, 1.0);
  if (clip.w < 0.05) {
    o.pos = vec4f(0.0, 0.0, 2.0, 1.0); // behind the camera: cull
    return o;
  }
  var sp = toScreen(clip);
  let mf = mouseField(sp);
  sp += mf.xy;

  // projected radius with a floor: sub-pixel flowers become 1.4px dots with conserved energy
  let rawR = worldR * u.params.w / clip.w;
  let minR = 1.4 * u.camFwd.w;
  let r = clamp(rawR, minR, 180.0 * u.camFwd.w);
  let energy = min(1.0, (rawR * rawR) / (minR * minR));

  sp += c * r * HALO;
  clip = fromScreen(sp, clip);

  let fog = fogAmt(dist);
  let nearFade = smoothstep(0.5, 1.8, dist);
  let ndc = clip.xy / clip.w;
  var bright = i.a2.w * mix(0.45, 1.0, g) * (1.0 - fog) * nearFade * mix(0.6, 1.0, energy);
  bright *= calmZone(ndc) * intro;
  bright *= 1.0 + mf.z * 0.85 + dsp * 0.9;

  o.pos = clip;
  o.uv = c * HALO;
  o.col = i.a1.rgb;
  o.prm = vec4f(i.a2.x, i.a2.y + seed * t * 0.08 * (1.0 - u.misc.y), g, dsp);
  o.amp = vec4f(bright, mf.z, energy * (1.0 - fog * 0.6) * nearFade, seed);
  return o;
}

@fragment fn fs_flower(i: FOut) -> @location(0) vec4f {
  let uv = i.uv;
  let r = length(uv);
  let th = atan2(uv.y, uv.x) + i.prm.y;
  let n = i.prm.x;
  let open = i.prm.z;
  // rosette edge: lobes from |cos(n*θ/2)|, buds are closed and round
  let lobe = pow(abs(cos(th * n * 0.5)), 0.95);
  let edge = mix(0.42, 0.34 + 0.66 * lobe, open) * mix(0.55, 1.0, open);
  let aa = max(fwidth(r) * 1.25, 0.015);
  let petal = smoothstep(edge, edge - aa - 0.07 * open, r);
  // inner shading, faint veins and a translucent rim
  let t = clamp(r / max(edge, 0.05), 0.0, 1.0);
  let vein = 1.0 - 0.4 * pow(abs(sin(th * n * 0.5)), 8.0) * open;
  let rim = smoothstep(0.6, 0.92, t) * 0.35 * open;
  let body = (mix(1.35, 0.28, pow(t, 1.2)) + rim) * vein;
  let core = smoothstep(0.2, 0.02, r);
  let halo = exp(-r * r * 3.2) * 0.3;

  let base = i.col;
  // petals deepen in saturation towards the rim, the core runs warm and hot
  let deep = pow(base, vec3f(1.8));
  let pc = mix(base, deep, smoothstep(0.25, 1.0, t));
  let coreCol = mix(vec3f(1.0, 0.86, 0.62), base, 0.35);
  var col = pc * petal * body * 0.4 + coreCol * core * 1.4 + deep * halo * 0.5;
  var a = max(petal * 0.72, core) * i.amp.z;

  // mote: a round glowing dot
  let mote = i.prm.w;
  let md = exp(-r * r * 9.0);
  col = mix(col, (base * 0.8 + vec3f(0.25)) * (md * 2.6 + exp(-r * r * 2.0) * 0.25), mote);
  a = mix(a, md * 0.3 * i.amp.z, mote);

  // cursor glow lifts the whole bloom
  col += base * i.amp.y * exp(-r * r * 1.6) * 0.3;

  return vec4f(col * i.amp.x, a);
}

// ─────────────────────────────────────────────────────────────────────────────
// dust motes & fireflies in a box that wraps around the camera
struct DOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) col: vec4f,
};
const DUST_BOX = vec3f(48.0, 11.0, 48.0);

@vertex fn vs_dust(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DOut {
  var o: DOut;
  let c = quadCorner(vi);
  let fi = f32(ii);
  let h = hash31(fi * 1.37 + 0.5);
  let h2 = hash31(fi * 2.11 + 9.0);
  let t = T();
  let firefly = h2.x < 0.06;
  let vel = (h2 - 0.5) * vec3f(0.5, 0.18, 0.5) + vec3f(0.0, 0.06, 0.0);
  let wob = vec3f(sin(t * 0.7 + h.x * 40.0), sin(t * 0.9 + h.y * 30.0), cos(t * 0.6 + h.z * 50.0))
          * select(0.15, 0.6, firefly);
  let centre = u.camPos.xyz + u.camFwd.xyz * vec3f(16.0, 0.0, 16.0) + vec3f(0.0, 1.8, 0.0);
  let raw = h * DUST_BOX + vel * t + wob;
  let rel = (fract((raw - centre) / DUST_BOX + 0.5) - 0.5) * DUST_BOX;
  var p = centre + rel;
  // edge fade so wrap-around never pops
  let e = abs(rel / (DUST_BOX * 0.5));
  let edge = 1.0 - smoothstep(0.75, 1.0, max(max(e.x, e.y), e.z));
  p.y += u.params.x * (0.6 + h.y) * 1.5;

  var clip = u.viewProj * vec4f(p, 1.0);
  if (clip.w < 0.1) {
    o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    return o;
  }
  var sp = toScreen(clip);
  let mf = mouseField(sp);
  sp += mf.xy * 1.3;
  let worldR = select(0.012 + h.z * 0.02, 0.035 + h.z * 0.03, firefly);
  let rawR = worldR * u.params.w / clip.w;
  let minR = 1.1 * u.camFwd.w;
  let r = clamp(rawR, minR, 40.0 * u.camFwd.w);
  let energy = min(1.0, rawR * rawR / (minR * minR));
  sp += c * r * 2.5;
  clip = fromScreen(sp, clip);

  let dist = length(p - u.camPos.xyz);
  let near = smoothstep(0.4, 2.5, dist);
  var col: vec3f;
  var amp: f32;
  if (firefly) {
    let blink = pow(0.5 + 0.5 * sin(t * (0.9 + h.x * 1.4) + h.y * 60.0), 5.0);
    col = mix(vec3f(0.85, 1.0, 0.45), vec3f(1.0, 0.75, 0.35), h.z);
    amp = blink * 2.0;
  } else {
    col = mix(vec3f(0.55, 0.8, 0.9), vec3f(0.8, 0.75, 0.95), h.y);
    amp = (0.09 + 0.07 * sin(t * 1.5 + h.x * 90.0)) * (1.0 - smoothstep(8.0, 26.0, length(rel)));
  }
  amp *= energy * edge * near * (1.0 - fogAmt(dist)) * u.params.y * (1.0 + mf.z * 3.0 + u.params.x * 0.8);
  o.pos = clip;
  o.uv = c * 2.5;
  o.col = vec4f(col * amp, 0.0);
  return o;
}
@fragment fn fs_dust(i: DOut) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  let a = exp(-r2 * 2.2) + exp(-r2 * 0.35) * 0.08;
  return vec4f(i.col.rgb * a, 0.0);
}
