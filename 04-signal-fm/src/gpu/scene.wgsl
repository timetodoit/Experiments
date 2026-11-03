// ─────────────────────────────────────────────────────────────────────────────
//  SIGNAL FM · scene.wgsl — pass 1 of 3
//  Sphere-traced SDF scenes rendered into an rgba16float target at 2 × 2
//  texels per ASCII cell. One pipeline per station via the SCENE override, so
//  each pipeline only contains its own map().
//
//  output: r = luminance, g = depth (t / tmax, 1 = sky), b = accent, a = 1
// ─────────────────────────────────────────────────────────────────────────────

override SCENE: i32 = 0;

// ── helpers ─────────────────────────────────────────────────────────────────
fn rotX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn rotZ(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
fn rot2(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * p.x - s * p.y, s * p.x + c * p.y); }

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn sdBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn sdBox2(p: vec2f, b: vec2f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

fn sdTorus(p: vec3f, R: f32, r: f32) -> f32 {
  let q = vec2f(length(p.xz) - R, p.y);
  return length(q) - r;
}

// click shockwave: a spherical ring expanding from c (scene time, so it slows when held)
fn pulseWave(p: vec3f, c: vec3f) -> f32 {
  let age = u.time - u.pulse.w;
  if (age < 0.0 || age > 3.5) { return 0.0; }
  let x = length(p - c) - age * 3.2;
  return exp(-x * x * 5.0) * exp(-age * 1.2) * 0.32;
}

// ── 0 · HALCYON — breathing metaball blob with a gyroid skin ───────────────
fn gyroid(p: vec3f) -> f32 { return dot(sin(p), cos(p.zxy)); }

fn map0(q: vec3f) -> vec2f {
  let t = u.time;
  let b = u.bands;
  let p = rotY(rotX(q, sin(t * 0.13) * 0.3), t * 0.17);
  var d = length(p) - (1.05 + 0.24 * b.x + 0.06 * sin(t * 1.1));
  for (var i = 0; i < 4; i++) {
    let fi = f32(i);
    let o = vec3f(sin(t * 0.61 + fi * 1.7), cos(t * 0.47 + fi * 2.3), sin(t * 0.53 + fi * 4.1)) * (0.95 + 0.3 * b.y);
    d = smin(d, length(p - o) - (0.4 + 0.12 * b.z), 0.42);
  }
  d += gyroid(p * 3.0 + vec3f(0.0, t * 0.5, t * 0.2)) * (0.08 + 0.14 * b.y);
  d -= pulseWave(q, vec3f(0.0));
  d *= 0.72; // displacement breaks the Lipschitz bound; under-step
  let fl = q.y + 2.1;
  if (fl < d) { return vec2f(fl, 0.0); }
  return vec2f(d, 1.0);
}

// ── 1 · FURNACE — endless corridor of arched doorways ──────────────────────
const SPACING = 2.6;

fn camZ() -> f32 { return u.time * 1.7; }

fn lampPos() -> vec3f {
  let t = u.time;
  return vec3f(sin(t * 0.7) * 0.45, 0.1 + sin(t * 1.3) * 0.18, camZ() + 5.2);
}

fn door2(p: vec2f, w: f32, h: f32) -> f32 {
  // arched opening: a rectangle (half-width w, height h below y = 0) capped by a semicircle
  let arch = length(p) - w;
  let rect = sdBox2(p - vec2f(0.0, -h * 0.5), vec2f(w, h * 0.5));
  return min(arch, rect);
}

fn map1(q: vec3f) -> vec2f {
  let t = u.time;
  let b = u.bands;
  let id = floor(q.z / SPACING);
  let lz = q.z - (id + 0.5) * SPACING;
  let sway = sin(id * 0.9 + t * 0.8) * (0.03 + 0.1 * b.x);
  let xy = rot2(q.xy, sway);
  let door = door2(xy - vec2f(0.0, 0.25), 1.2 + 0.12 * b.x, 2.1);
  let wall = sdBox2(xy - vec2f(0.0, 0.6), vec2f(3.4, 2.4));
  var d = max(max(wall, -door), abs(lz) - 0.16);
  // conservative bound to the neighbouring slab, so rays can't skip it through a doorway
  d = min(d, SPACING - abs(lz) - 0.16);
  d -= pulseWave(q, vec3f(0.0, -0.2, camZ() + 3.0));
  var res = vec2f(d, 1.0);
  let lamp = length(q - lampPos()) - (0.1 + 0.12 * b.z + 0.05 * u.beat);
  if (lamp < res.x) { res = vec2f(lamp, 2.0); }
  let fl = q.y + 1.5;
  if (fl < res.x) { res = vec2f(fl, 0.0); }
  return res;
}

// ── 2 · VELVET TAPE — a twisting stack of slabs, orbited by a thin ring ────
fn slab(p: vec3f, id: f32) -> f32 {
  let t = u.time;
  let b = u.bands;
  let q0 = p - vec3f(0.0, id * 0.34, 0.0);
  let tw = id * (0.2 + 0.32 * b.y) + t * 0.35 + sin(t * 0.4 + id * 0.6) * 0.35;
  let q = rotY(q0, tw);
  let s = 0.95 - abs(id) * 0.055 + 0.14 * b.x * (1.0 - abs(id) / 6.0);
  return sdBox(q, vec3f(s, 0.12, s * 0.62), 0.035);
}

fn map2(q: vec3f) -> vec2f {
  let t = u.time;
  let p = rotY(q, t * 0.08);
  let id = clamp(round(p.y / 0.34), -5.0, 5.0);
  var d = slab(p, id);
  d = min(d, slab(p, clamp(id - 1.0, -5.0, 5.0)));
  d = min(d, slab(p, clamp(id + 1.0, -5.0, 5.0)));
  d -= pulseWave(q, vec3f(0.0));
  var r = rotX(q, 1.15 + sin(t * 0.21) * 0.25);
  r = rotZ(r, t * 0.3);
  let ring = sdTorus(r, 2.25 + 0.15 * u.bands.z, 0.025 + 0.05 * u.bands.z);
  var res = vec2f(d, 1.0);
  if (ring < res.x) { res = vec2f(ring, 2.0); }
  let fl = q.y + 2.25;
  if (fl < res.x) { res = vec2f(fl, 0.0); }
  return res;
}

// ── 3 · LOW TIDE — open water under a moon ─────────────────────────────────
fn moonDir() -> vec3f { return normalize(vec3f(0.0, 0.3, 1.0)); }

fn waves(xz: vec2f) -> f32 {
  let t = u.time;
  var h = 0.0;
  var a = 0.26 * (0.55 + 0.9 * u.bands.x);
  var f = 0.32;
  var dir = vec2f(1.0, 0.25);
  for (var i = 0; i < 5; i++) {
    let x = dot(xz, normalize(dir)) * f + t * (0.9 + f * 0.5) + f32(i) * 1.3;
    h += a * (exp(sin(x) - 1.0) * 2.0 - 0.8);
    dir = rot2(dir, 1.7);
    f *= 1.85;
    a *= 0.48;
  }
  h += sin(xz.x * 3.1 + t * 2.0) * sin(xz.y * 2.7 - t * 1.6) * 0.04 * u.bands.z;
  return h;
}

fn map3(q: vec3f) -> vec2f {
  let h = waves(q.xz) + pulseWave(vec3f(q.x, 0.0, q.z), vec3f(0.0, 0.0, 8.0)) * 1.8;
  return vec2f((q.y - h) * 0.55, 3.0);
}

// ── dispatch (SCENE is a pipeline constant: the other branches compile away)
fn map(p: vec3f) -> vec2f {
  if (SCENE == 0) { return map0(p); }
  if (SCENE == 1) { return map1(p); }
  if (SCENE == 2) { return map2(p); }
  return map3(p);
}

fn tmaxS() -> f32 {
  if (SCENE == 1) { return 38.0; }
  if (SCENE == 3) { return 55.0; }
  return 16.0;
}

fn fogK() -> f32 {
  if (SCENE == 0) { return 0.012; }
  if (SCENE == 1) { return 0.0032; }
  if (SCENE == 2) { return 0.008; }
  return 0.0009;
}

struct Cam { ro: vec3f, rd: vec3f };

fn camera(uv: vec2f) -> Cam {
  let t = u.time;
  let m = u.mouse;
  var ro: vec3f;
  var ta: vec3f;
  var fl = 1.6;
  if (SCENE == 0) {
    let yaw = m.x * 1.1 + t * 0.05;
    let pitch = 0.22 + m.y * 0.35;
    ro = vec3f(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch)) * 4.4;
    ta = vec3f(0.0, -0.15, 0.0);
  } else if (SCENE == 1) {
    let z = camZ();
    ro = vec3f(m.x * 0.7, -0.2 + m.y * 0.45, z);
    ta = vec3f(m.x * 1.6, -0.25 + m.y * 0.6, z + 4.0);
    fl = 1.3;
  } else if (SCENE == 2) {
    let yaw = m.x * 1.3 + 0.4;
    let pitch = 0.12 + m.y * 0.45;
    ro = vec3f(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch)) * 5.3;
    ta = vec3f(0.0);
  } else {
    ro = vec3f(m.x * 1.6, 1.25 + m.y * 0.7, -2.0);
    ta = vec3f(m.x * 3.0, 1.0 + m.y * 1.6, 12.0);
  }
  // bass + kick shake (off under reduced motion)
  let sh = u.motion * (u.bands.x * 0.045 + u.beat * 0.03);
  ro += vec3f(sin(u.rtime * 37.0), sin(u.rtime * 43.0 + 1.3), sin(u.rtime * 29.0)) * sh;
  let ww = normalize(ta - ro);
  let uu = normalize(cross(vec3f(0.0, 1.0, 0.0), ww));
  let vv = cross(ww, uu);
  return Cam(ro, normalize(uv.x * uu + uv.y * vv + fl * ww));
}

fn march(ro: vec3f, rd: vec3f, tmax: f32) -> vec2f {
  var t = 0.02;
  var m = -1.0;
  for (var i = 0; i < 110; i++) {
    let h = map(ro + rd * t);
    if (abs(h.x) < 0.0012 * t + 0.0004) { m = h.y; break; }
    t += h.x;
    if (t > tmax) { break; }
  }
  if (t > tmax) { m = -1.0; }
  return vec2f(t, m);
}

fn calcNormal(p: vec3f, t: f32) -> vec3f {
  let e = vec2f(1.0, -1.0) * 0.0015 * max(1.0, t * 0.5);
  return normalize(
    e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x +
    e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

fn softShadow(ro: vec3f, rd: vec3f, tmax: f32) -> f32 {
  var res = 1.0;
  var t = 0.04;
  for (var i = 0; i < 28; i++) {
    let h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.03, 0.45);
    if (res < 0.02 || t > tmax) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

fn ambientOcc(p: vec3f, n: vec3f) -> f32 {
  var o = 0.0;
  var w = 1.0;
  for (var i = 1; i <= 5; i++) {
    let h = 0.05 * f32(i);
    o += (h - map(p + n * h).x) * w;
    w *= 0.75;
  }
  return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}

// background: soft gradient; for Low Tide a starfield and a lit moon
fn sky(rd: vec3f) -> vec2f {
  if (SCENE == 3) {
    let md = moonDir();
    let c = dot(rd, md);
    var l = 0.035 + 0.07 * clamp(rd.y + 0.1, 0.0, 1.0);
    var a = 0.0;
    let sc = floor(vec2f(atan2(rd.x, rd.z), rd.y) * 150.0);
    let st = hash21(sc);
    if (st > 0.994 && rd.y > 0.04) {
      l += 0.55 * (0.6 + 0.4 * sin(u.rtime * 3.0 + st * 80.0));
      a = 0.25;
    }
    let right = normalize(cross(vec3f(0.0, 1.0, 0.0), md));
    let up = cross(md, right);
    let r = 0.085 + 0.008 * u.bands.z;
    let o = vec2f(dot(rd, right), dot(rd, up)) / r;
    let o2 = dot(o, o);
    if (o2 < 1.0 && c > 0.0) {
      let n = vec3f(o, sqrt(1.0 - o2));
      let lit = clamp(dot(n, normalize(vec3f(-0.75, 0.3, 0.6))), 0.0, 1.0);
      let crater = hash21(floor(o * 4.0 + 7.0)) * 0.18;
      l = 0.2 + 0.85 * lit - crater * lit;
      a = smoothstep(0.25, 0.7, lit);
    }
    l += pow(max(c, 0.0), 90.0) * (0.3 + 0.5 * u.bands.z) + pow(max(c, 0.0), 10.0) * 0.07;
    return vec2f(l, a);
  }
  return vec2f(0.045 + 0.045 * rd.y, 0.0);
}

@fragment
fn fs_scene(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let gridPx = u.grid * u.cell;
  let sp = pos.xy * 0.5 * u.cell; // 2 × 2 texels per cell → grid pixels
  var uv = (sp - gridPx * 0.5) / gridPx.y * 2.0;
  uv.y = -uv.y;
  let cam = camera(uv);
  let tmax = tmaxS();
  let hit = march(cam.ro, cam.rd, tmax);
  let bg = sky(cam.rd);

  var lum = bg.x;
  var acc = bg.y;
  var depth = 1.0;

  if (hit.y >= 0.0) {
    let t = hit.x;
    let p = cam.ro + cam.rd * t;
    let mat = hit.y;
    depth = t / tmax;
    if (mat > 1.5 && mat < 2.5) {
      // emissive (lamp, ring)
      lum = 1.0;
      acc = 1.0;
    } else {
      let n = calcNormal(p, t);
      var ld = normalize(vec3f(0.6, 0.8, -0.45));
      var att = 1.0;
      if (SCENE == 1) {
        let lv = lampPos() - p;
        ld = normalize(lv);
        att = 3.2 / (1.0 + 0.09 * dot(lv, lv));
      }
      if (SCENE == 3) { ld = moonDir(); }
      let dif = max(dot(n, ld), 0.0);
      let fres = pow(1.0 - max(dot(n, -cam.rd), 0.0), 4.0);
      let energy = 0.85 + 0.6 * u.bands.w + 0.45 * u.beat;

      if (mat > 2.5) {
        // water: reflected sky + moon glint
        let r = reflect(cam.rd, n);
        let s2 = sky(r);
        let glint = pow(max(dot(r, moonDir()), 0.0), 260.0);
        let crest = smoothstep(0.05, 0.55, p.y) * 0.3;
        lum = 0.1 + dif * 0.3 + crest + s2.x * (0.35 + fres) + glint * 2.2;
        acc = max(s2.y * 0.6, smoothstep(0.35, 0.9, glint * 2.0));
      } else {
        var sh = 1.0;
        if (SCENE == 1) {
          sh = softShadow(p + n * 0.01, ld, length(lampPos() - p) - 0.35);
        } else {
          sh = softShadow(p + n * 0.01, ld, 8.0);
        }
        let occ = ambientOcc(p, n);
        let hv = normalize(ld - cam.rd);
        let spec = pow(max(dot(n, hv), 0.0), 40.0) * sh;
        lum = (dif * sh * 0.9 + 0.1 + 0.08 * n.y) * occ * att * energy + spec * 0.7 + fres * (0.15 + 0.4 * u.bands.z) * occ;
        if (mat < 0.5) {
          // floors get a printed pattern so the ASCII has something to hold on to
          if (SCENE == 1) {
            lum *= 0.55 + 0.45 * step(0.5, fract(p.z * 0.5 + 0.25));
          } else {
            let gx = abs(fract(p.x * 1.25) - 0.5);
            let gz = abs(fract(p.z * 1.25) - 0.5);
            lum *= 0.7 + 0.3 * step(0.06, min(gx, gz));
          }
          lum *= 0.85;
        }
        acc = smoothstep(0.55, 0.95, spec) * 0.8;
      }
    }
    let f = 1.0 - exp(-t * t * fogK());
    lum = mix(lum, bg.x, f);
    acc *= 1.0 - f;
  }

  lum = lum / (1.0 + lum * 0.3);
  return vec4f(clamp(lum, 0.0, 1.5), depth, clamp(acc, 0.0, 1.0), 1.0);
}
