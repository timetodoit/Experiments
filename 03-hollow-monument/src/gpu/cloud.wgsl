// ─────────────────────────────────────────────────────────────────────────────
//  HOLLOW MONUMENT · cloud.wgsl
//  Compute: every point springs toward a blend of two target clouds (with a
//  per-point stagger, turbulence mid-flight, and shockwave ballistics with a
//  floor bounce). Render: instanced, camera-facing soft quads, additive into an
//  HDR target, coloured by scan intensity with a LiDAR sweep band.
//  The file is split at the markers below into a compute module and a render
//  module so the state buffer is read_write in one and read-only in the other.
// ─────────────────────────────────────────────────────────────────────────────

struct U {
  viewProj: mat4x4f, // floats  0..15
  camPos: vec4f,     // 16..19  xyz eye, w = focal length (px)
  res: vec4f,        // 20..23  framebuffer w, h (px), dpr, point world radius (m)
  t: vec4f,          // 24..27  time, dt, count, reduced motion (0/1)
  morph: vec4f,      // 28..31  cloud a, cloud b, mix 0..1, brightness gain
  sweep: vec4f,      // 32..35  front (scan time), reveal (0/1), band width, band strength
  flash: vec4f,      // 36..39  flashlight centre xyz, radius (m)
  shock: vec4f,      // 40..43  impulse centre xyz, strength (non-zero on the click frame only)
  sel: vec4f,        // 44..47  picked point xyz, on (0/1)
  look: vec4f,       // 48..51  intro fade, flashlight strength, fog density, turbulence gain
};

// one live point: 48 bytes
struct S {
  pos: vec4f, // xyz position, w = intensity (blended)
  vel: vec4f, // xyz velocity, w = "free" timer (s): > 0 ballistic, < 0 re-attaching
  nrm: vec4f, // xyz normal (blended), w = scan time (blended)
};

// one target point (straight from Rust): 32 bytes
struct T {
  p: vec4f, // xyz, w = intensity
  n: vec4f, // normal xyz, w = scan time
};

@group(0) @binding(0) var<uniform> u: U;

const PI = 3.14159265;
const ORANGE = vec3f(1.0, 0.353, 0.122);

fn hash11(n: u32) -> f32 {
  let s = n * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return f32((w >> 22u) ^ w) / 4294967296.0;
}

// cheap divergence-ish flow field (sum of phase-shifted sines)
fn flow(p: vec3f, t: f32) -> vec3f {
  let a = vec3f(
    sin(p.y * 1.7 + t) + sin(p.z * 2.3 - t * 0.7),
    sin(p.z * 1.9 + t * 0.8) + sin(p.x * 2.1 + t * 0.5),
    sin(p.x * 1.6 - t * 0.6) + sin(p.y * 2.7 + t * 0.9)
  );
  let q = p * 2.7 + vec3f(3.1, 1.7, 4.2);
  let b = vec3f(sin(q.y + t * 1.3), sin(q.z - t * 1.1), sin(q.x + t * 0.9));
  return a * 0.4 + b * 0.25;
}

// @@COMPUTE
@group(0) @binding(1) var<storage, read_write> st: array<S>;
@group(0) @binding(2) var<storage, read> c0: array<T>;
@group(0) @binding(3) var<storage, read> c1: array<T>;
@group(0) @binding(4) var<storage, read> c2: array<T>;
@group(0) @binding(5) var<storage, read> c3: array<T>;

fn tgt(k: u32, i: u32) -> T {
  switch k {
    case 0u: { return c0[i]; }
    case 1u: { return c1[i]; }
    case 2u: { return c2[i]; }
    default: { return c3[i]; }
  }
}

@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(u.t.z)) {
    return;
  }
  var s = st[i];
  let dt = u.t.y;
  let time = u.t.x;
  let A = tgt(u32(u.morph.x), i);
  let B = tgt(u32(u.morph.y), i);
  let seed = hash11(i);
  let seed2 = hash11(i ^ 0x9e3779b9u);

  // per-point stagger: the scan direction leads, noise breaks it up
  let spread = 0.55;
  let stagger = clamp(A.n.w * 0.6 + seed * 0.4, 0.0, 1.0);
  let l = clamp((u.morph.z - stagger * spread) / (1.0 - spread), 0.0, 1.0);
  let e = l * l * (3.0 - 2.0 * l);
  let arc = sin(PI * e);
  var goal = mix(A.p.xyz, B.p.xyz, e);
  goal += flow(goal * 0.05 + vec3f(seed * 1.5), time * 0.35) * arc * (1.5 + seed2 * 4.5) * u.look.w;

  var pos = s.pos.xyz;
  var vel = s.vel.xyz;
  var freeT = s.vel.w;

  // shockwave impulse (only on the frame the click lands)
  if (u.shock.w > 0.0) {
    let d = pos - u.shock.xyz;
    let r = length(d);
    let R = 11.0 * u.shock.w;
    let fall = exp(-(r * r) / (R * R));
    if (fall > 0.03) {
      let dir = d / max(r, 1e-3);
      vel += (dir * 30.0 + vec3f(0.0, 15.0, 0.0)) * fall * (0.5 + seed2);
      freeT = max(freeT, 1.5 + seed * 0.9);
    }
  }

  var acc = vec3f(0.0);
  if (freeT > 0.0) {
    // ballistic: gravity + a little air drag
    acc = vec3f(0.0, -26.0, 0.0);
    vel *= exp(-dt * 0.4);
  } else {
    // spring home; stiffness ramps back in over ~0.9 s after a blast
    let reattach = 1.0 - smoothstep(-0.9, 0.0, freeT) * 0.92;
    let k = 17.0 * (0.7 + 0.6 * seed) * reattach;
    let c = 2.0 * sqrt(k) * 0.74;
    acc = (goal - pos) * k - vel * c;
    acc += flow(pos * 0.08, time * 0.6) * arc * 9.0 * u.look.w;
  }
  vel += acc * dt;
  let sp = length(vel);
  if (sp > 90.0) {
    vel *= 90.0 / sp;
  }
  pos += vel * dt;

  // floor at y = 0
  if (pos.y < 0.0 && freeT > -0.5) {
    pos.y = -pos.y * 0.15;
    vel.y = abs(vel.y) * 0.4;
    vel.x *= 0.75;
    vel.z *= 0.75;
  }
  freeT = max(freeT - dt, -1.0);

  s.pos = vec4f(pos, mix(A.p.w, B.p.w, e));
  s.vel = vec4f(vel, freeT);
  s.nrm = vec4f(normalize(mix(A.n.xyz, B.n.xyz, e) + vec3f(0.0, 1e-4, 0.0)), mix(A.n.w, B.n.w, e));
  st[i] = s;
}

// @@RENDER
@group(0) @binding(1) var<storage, read> sr: array<S>;

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
};

fn culled() -> VO {
  var o: VO;
  o.pos = vec4f(0.0, 0.0, 2.0, 1.0); // beyond the far plane → clipped
  o.uv = vec2f(0.0);
  o.col = vec3f(0.0);
  return o;
}

@vertex
fn vs_point(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let s = sr[ii];
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let c = corners[vi];
  var p = s.pos.xyz;
  let n = s.nrm.xyz;
  let stime = s.nrm.w;
  let dpr = u.res.z;

  // LiDAR sweep: a plane of scan-time moving through the cloud
  let dS = stime - u.sweep.x;
  let band = exp(-(dS * dS) / (u.sweep.z * u.sweep.z)) * u.sweep.w;
  var vis = 1.0;
  var trail = 0.0;
  if (u.sweep.y > 0.5) {
    vis = 1.0 - smoothstep(-0.004, 0.006, dS);
    trail = select(0.0, exp(dS * 38.0), dS < 0.0);
  }
  if (vis < 0.002) {
    return culled();
  }

  // flashlight: points near the scan point glow and shiver
  let fd = distance(p, u.flash.xyz);
  let fr = max(u.flash.w, 1e-3);
  let glow = exp(-(fd * fd) / (fr * fr)) * u.look.y;
  let jt = u32(floor(u.t.x * 30.0));
  let jv = vec3f(hash11(ii * 3u + jt * 7919u), hash11(ii * 3u + 1u + jt * 104729u), hash11(ii * 3u + 2u + jt * 1299709u)) - 0.5;
  p += jv * glow * 0.32 * (1.0 - u.t.w);

  let sel = u.sel.w * exp(-pow(distance(p, u.sel.xyz) / 0.6, 2.0));

  let clip = u.viewProj * vec4f(p, 1.0);
  let w = clip.w;
  if (w < 0.35) {
    return culled();
  }

  // size: world radius → pixels, clamped; big sprites spread their energy
  let px0 = u.res.w * u.camPos.w / w;
  let px = clamp(px0 * (1.0 + glow * 0.9 + sel * 1.6), 0.75 * dpr, 7.5 * dpr);
  let refPx = 1.15 * dpr;
  let spreadE = clamp(pow(refPx / px, 1.5), 0.06, 1.0);
  let nearFade = smoothstep(0.4, 3.5, w);

  // brightness: scan intensity × incidence (facing the scanner returns more) × fog
  let viewDir = normalize(u.camPos.xyz - p);
  let facing = abs(dot(n, viewDir));
  let fog = exp(-w * u.look.z);
  let b = s.pos.w * (0.3 + 0.7 * facing) * fog;
  let speed = length(s.vel.xyz);

  let lo = vec3f(0.34, 0.38, 0.45);
  let hi = vec3f(0.86, 0.9, 0.96);
  var col = mix(lo, hi, clamp(b * 1.25, 0.0, 1.0)) * b;
  col += vec3f(0.55, 0.62, 0.7) * min(speed * 0.012, 0.35); // airborne points catch light
  col += vec3f(0.85, 0.92, 1.0) * glow * 0.85;
  col += vec3f(0.9, 0.94, 1.0) * trail * 0.55;
  col *= u.morph.w;
  col += ORANGE * (band * 0.9 + sel * 1.6);
  col *= vis * nearFade * spreadE * u.look.x;

  var o: VO;
  let off = c * px / u.res.xy * 2.0;
  o.pos = vec4f(clip.xy + off * w, clip.z, w);
  o.uv = c;
  o.col = col;
  return o;
}

@fragment
fn fs_point(i: VO) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) {
    discard;
  }
  let a = exp(-r2 * 3.0) - 0.0498;
  return vec4f(i.col * a, a);
}
