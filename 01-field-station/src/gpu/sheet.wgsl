// ─────────────────────────────────────────────────────────────────────────────
//  FIELD STATION 04 · sheet.wgsl
//  Shades the herbarium sheet simulated in Rust (verlet cloth). Vertex data is
//  streamed straight out of WASM linear memory every frame.
// ─────────────────────────────────────────────────────────────────────────────

struct U {
  viewProj: mat4x4f,
  eye: vec4f,
  light: vec4f,
  shadow: vec4f, // x,y = shadow shear, z = wall depth, w = opacity
  params: vec4f, // x = time, y = xray, z = stress highlight
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
};

@vertex
fn vs_sheet(v: VIn) -> VOut {
  var o: VOut;
  o.pos = u.viewProj * vec4f(v.pos, 1.0);
  o.wp = v.pos;
  o.nrm = v.nrm;
  o.uv = v.uv;
  return o;
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs_sheet(in: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(in.nrm);
  if (!ff) {
    n = -n;
  }
  let L = normalize(u.light.xyz);
  let V = normalize(u.eye.xyz - in.wp);
  let H = normalize(L + V);
  let diff = max(dot(n, L), 0.0);
  let wrap = 0.42 + diff * 0.68;
  let spec = pow(max(dot(n, H), 0.0), 48.0) * 0.07;
  // fake ambient occlusion: deeper folds (further from camera) darken
  let ao = clamp(1.0 + in.wp.z * 0.55, 0.62, 1.08);

  // sample in uniform control flow, then pick the side
  let front = textureSample(tex, samp, in.uv).rgb;
  let show = textureSample(tex, samp, vec2f(1.0 - in.uv.x, in.uv.y)).rgb;
  let gridUv = in.uv * vec2f(40.0, 50.0);
  let w = fwidth(gridUv);
  let g = abs(fract(gridUv) - 0.5);
  let line = max(1.0 - smoothstep(0.0, w.x * 1.2, 0.5 - g.x), 1.0 - smoothstep(0.0, w.y * 1.2, 0.5 - g.y));

  // reverse side of the paper: blank, warmer, faint show-through
  let back = mix(vec3f(0.89, 0.86, 0.78), show, 0.12);
  let base = select(back, front, ff);
  var col = base * wrap * ao + spec;

  // x-ray: wire grid + depth tint
  let depth = clamp(in.wp.z * 2.0 + 0.5, 0.0, 1.0);
  let xcol = mix(vec3f(0.04, 0.04, 0.05), vec3f(0.95, 1.0, 0.0) * 0.22, depth) + vec3f(0.95, 1.0, 0.0) * line * 0.85;
  col = mix(col, xcol, u.params.y);
  let grain = (hash(in.pos.xy) - 0.5) * 0.025;
  return vec4f(col + grain, 1.0);
}

// drop shadow: the same mesh, sheared onto the back wall
@vertex
fn vs_shadow(v: VIn) -> @builtin(position) vec4f {
  let wall = u.shadow.z;
  let lift = v.pos.z - wall;
  let p = vec3f(v.pos.x + lift * u.shadow.x, v.pos.y + lift * u.shadow.y, wall);
  return u.viewProj * vec4f(p, 1.0);
}

@fragment
fn fs_shadow() -> @location(0) vec4f {
  // premultiplied black; blended with MAX so overlapping folds don't double up
  return vec4f(0.0, 0.0, 0.0, u.shadow.w);
}
