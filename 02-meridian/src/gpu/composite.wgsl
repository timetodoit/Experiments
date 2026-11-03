// ─────────────────────────────────────────────────────────────────────────────
//  MERIDIAN · composite.wgsl
//  Full-screen pass: paper + shaded ink, then "liquid glass" for every DOM card
//  (rounded-rect SDF). Inside a card the ink is refracted along the bevel
//  normal, split chromatically at the rim, frosted in the interior, and lit by
//  a specular rim whose direction follows the sun (or moon).
//  No textures are sampled here (fields are storage buffers, bilerped by hand),
//  so there are no uniformity constraints on the branches below.
//  Pixel space: fc.xy, origin top-left, canvas pixels (CSS px × dpr).
// ─────────────────────────────────────────────────────────────────────────────

struct RU {
  res: vec2f,          //   0  canvas size (px)
  dsize: vec2f,        //   8  dye grid size
  time: f32,           //  16
  dpr: f32,            //  20
  nGlass: f32,         //  24
  grain: f32,          //  28
  bg: vec4f,           //  32  paper
  bg2: vec4f,          //  48  paper, towards the light
  light: vec4f,        //  64  xy = dir towards light (screen), z = intensity, w = night
  glassTint: vec4f,    //  80  rgb, a = amount
  sunCol: vec4f,       //  96  specular colour
  glass: array<vec4f, 12>, // 112  per shape: [cx, cy, hw, hh], [radius, alpha, bevel, refract]
};

@group(0) @binding(0) var<uniform> r: RU;
@group(0) @binding(1) var<storage, read> disp: array<vec4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
};

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VSOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: VSOut;
  o.pos = vec4f(p, 0.0, 1.0);
  return o;
}

fn dix(c: vec2i) -> u32 {
  let s = vec2i(r.dsize);
  let q = clamp(c, vec2i(0), s - vec2i(1));
  return u32(q.y * s.x + q.x);
}

fn dispAt(uv: vec2f) -> vec4f {
  let q = uv * r.dsize - 0.5;
  let i0 = vec2i(floor(q));
  let f = q - vec2f(i0);
  let a = disp[dix(i0)];
  let b = disp[dix(i0 + vec2i(1, 0))];
  let c = disp[dix(i0 + vec2i(0, 1))];
  let d = disp[dix(i0 + vec2i(1, 1))];
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn paper(uv: vec2f) -> vec3f {
  let g = clamp(dot(uv - 0.5, r.light.xy) * 0.9 + 0.5, 0.0, 1.0);
  return mix(r.bg.rgb, r.bg2.rgb, smoothstep(0.0, 1.0, g));
}

fn scene(uv: vec2f) -> vec3f {
  let d = dispAt(uv);
  return paper(uv) * (1.0 - d.a) + d.rgb;
}

fn sdRR(p: vec2f, b: vec2f, rad: f32) -> f32 {
  let q = abs(p) - b + vec2f(rad);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - rad;
}

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_main(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = fc.xy;
  let uv = px / r.res;
  var col = scene(uv);

  // nearest glass shape
  let n = u32(r.nGlass);
  var best = 1e9;
  var bi = 0u;
  for (var i = 0u; i < n; i++) {
    let g0 = r.glass[i * 2u];
    let g1 = r.glass[i * 2u + 1u];
    let d = sdRR(px - g0.xy, g0.zw, g1.x);
    if (d < best) {
      best = d;
      bi = i;
    }
  }

  if (n > 0u) {
    let g0 = r.glass[bi * 2u];
    let g1 = r.glass[bi * 2u + 1u];
    let c = g0.xy;
    let hs = g0.zw;
    let rad = g1.x;
    let alpha = g1.y;
    let bev = max(g1.z, 1.0);
    let refr = g1.w;
    let L = r.light.xy;

    // soft contact shadow, cast away from the light
    if (best > 0.0) {
      let sd = sdRR(px - c + L * 14.0 * r.dpr, hs, rad);
      let sh = exp(-max(sd, 0.0) / (18.0 * r.dpr)) * 0.14 * alpha * mix(1.0, 0.45, r.light.w);
      col = col * (1.0 - sh);
    }

    if (best < 1.0) {
      let lp = px - c;
      let e = vec2f(0.75, 0.0);
      let nx = sdRR(lp + e.xy, hs, rad) - sdRR(lp - e.xy, hs, rad);
      let ny = sdRR(lp + e.yx, hs, rad) - sdRR(lp - e.yx, hs, rad);
      let nrm = vec2f(nx, ny) / max(length(vec2f(nx, ny)), 1e-5); // outward bevel normal

      let t = clamp(-best / bev, 0.0, 1.0);   // 0 at the rim → 1 past the bevel
      let edge = 1.0 - t;
      let bend = edge * edge;

      // slight magnification of the interior + the rim pulls in ink from outside
      let base = c + lp * 0.965;
      let off = nrm * bend * refr;
      let ca = 0.10 + 0.25 * edge;
      let pG = base + off;
      let pR = base + off * (1.0 + ca) + nrm * ca * 2.0 * r.dpr;
      let pB = base + off * (1.0 - ca) - nrm * ca * 2.0 * r.dpr;

      // frost: 7-tap disc, wider towards the centre
      let fr = (2.5 + 4.5 * t) * r.dpr;
      var fro = scene(pG / r.res);
      for (var k = 0; k < 6; k++) {
        let a = f32(k) * 1.0471976 + 0.4;
        fro += scene((pG + vec2f(cos(a), sin(a)) * fr) / r.res);
      }
      fro = fro / 7.0;
      let sR = scene(pR / r.res).r;
      let sB = scene(pB / r.res).b;
      let rimMix = smoothstep(0.0, 0.9, edge);
      var gcol = vec3f(mix(fro.r, sR, rimMix), fro.g, mix(fro.b, sB, rimMix));
      gcol = mix(gcol, r.glassTint.rgb, r.glassTint.a);

      // lighting: specular rim towards the light, weaker counter-rim opposite,
      // a hairline edge, and a faint inner shade on the side away from light
      let ndl = dot(nrm, L);
      let rim = pow(edge, 2.6);
      let spec = (pow(max(ndl, 0.0), 2.0) + 0.35 * pow(max(-ndl, 0.0), 2.0)) * rim * r.light.z;
      let lw = 1.3 * r.dpr;
      let hair = (1.0 - smoothstep(0.0, lw, abs(best + lw * 0.7))) * (0.3 + 0.7 * max(ndl, 0.0));
      let inner = pow(edge, 4.0) * max(-ndl, 0.0) * 0.10;
      gcol = gcol * (1.0 - inner) + r.sunCol.rgb * (spec * 0.75 + hair * (0.25 + 0.5 * r.light.z));

      let cov = clamp(0.5 - best, 0.0, 1.0);
      col = mix(col, gcol, cov * alpha);
    }
  }

  // paper grain + a soft vignette
  let gr = hash12(px + fract(r.time * 13.0) * 517.0) - 0.5;
  col += vec3f(gr * r.grain);
  let vg = length(uv - 0.5);
  col *= 1.0 - 0.16 * smoothstep(0.45, 0.95, vg) * (1.0 - 0.3 * r.light.w);
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
