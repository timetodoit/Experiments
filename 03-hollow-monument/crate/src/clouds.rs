//! The four point clouds. Every generator writes exactly `n` points into `out`
//! with a stride of 8 floats:
//!
//!   [0..3] position (metres, y up)   [3] scan intensity 0..1
//!   [4..7] unit normal               [7] raw scan key (normalised later → scan time)
//!
//! Units are metres. The monument sits on the ground plane y = 0, roughly
//! x ∈ [-32, 48], z ∈ [-22, 34], 42 m tall.

use crate::noise::{fbm2, fract, smoothstep, vnoise2, vnoise3, Rng};
use crate::solids::{Prim, Scene};

pub const STRIDE: usize = 8;

/// Direction of the LiDAR sweep plane (scan key = dot(p, SWEEP)).
const SWEEP: [f32; 3] = [0.894, 0.18, -0.41];

#[inline]
fn put(out: &mut [f32], k: usize, p: [f32; 3], it: f32, n: [f32; 3], key: f32) {
    let o = &mut out[k * STRIDE..k * STRIDE + STRIDE];
    o[0] = p[0];
    o[1] = p[1];
    o[2] = p[2];
    o[3] = it.clamp(0.02, 1.0);
    o[4] = n[0];
    o[5] = n[1];
    o[6] = n[2];
    o[7] = key;
}

#[inline]
fn sweep_key(p: &[f32; 3]) -> f32 {
    p[0] * SWEEP[0] + p[1] * SWEEP[1] + p[2] * SWEEP[2]
}

/// If rejection sampling ran out of attempts, fill the tail by cloning earlier samples.
fn fill_tail(out: &mut [f32], from: usize, to: usize, start: usize, rng: &mut Rng) {
    if from >= to {
        return;
    }
    let avail = from - start;
    for k in from..to {
        let src = if avail > 0 { start + rng.below(avail) } else { 0 };
        for c in 0..STRIDE {
            out[k * STRIDE + c] = out[src * STRIDE + c];
        }
    }
}

/// Board-marked concrete: horizontal formwork lines on walls, a panel grid on slabs.
#[inline]
fn formwork(p: &[f32; 3], n: &[f32; 3]) -> f32 {
    if n[1].abs() < 0.5 {
        let board = fract(p[1] / 0.32);
        let along = if n[0].abs() > 0.5 { p[2] } else { p[0] };
        let joint = fract(along / 2.4);
        let mut f = 0.9 + 0.1 * (4.0 * (board - 0.5).abs() - 1.0);
        if joint < 0.025 || board < 0.04 {
            f *= 0.72;
        }
        f
    } else {
        let gx = fract(p[0] / 1.2);
        let gz = fract(p[2] / 1.2);
        if gx < 0.03 || gz < 0.03 {
            0.74
        } else {
            1.0
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
//  (a) THE MONUMENT
// ───────────────────────────────────────────────────────────────────────────

pub fn monument_prims() -> Vec<Prim> {
    let mut v = Vec::with_capacity(96);
    // podium
    v.push(Prim::bx([4.0, 1.5, 0.0], [36.0, 1.5, 22.0], 0.62));
    // monumental stair down to the ground, centred on the void
    for k in 1..12 {
        let top = 3.0 - k as f32 * 0.25;
        let z0 = 22.0 + (k - 1) as f32 * 0.95;
        v.push(Prim::bx([2.0, top * 0.5, z0 + 0.475], [12.0, top * 0.5, 0.475], 0.7));
    }
    // recessed ground floor (dark glazing line) + pilotis
    v.push(Prim::bx([-4.0, 5.0, -2.0], [18.0, 2.0, 8.0], 0.4));
    for &z in &[8.5f32, -12.5] {
        let mut x = -22.0;
        while x <= 14.5 {
            v.push(Prim::cyl_y([x, 5.0, z], 0.75, 2.0, 0.92));
            x += 6.0;
        }
    }
    // slab A
    v.push(Prim::bx([-4.0, 11.0, -2.0], [22.0, 4.0, 14.0], 0.72));
    // slab B (offset) + brise-soleil fins on its front face
    v.push(Prim::bx([6.0, 19.0, 1.0], [20.0, 4.0, 12.0], 0.7));
    let mut x = -12.6;
    while x <= 24.5 {
        v.push(Prim::bx([x, 19.0, 13.9], [0.22, 3.7, 0.9], 0.88));
        x += 2.4;
    }
    // the cantilever: 66 m long, 22 m unsupported beyond slab B
    v.push(Prim::bx([15.0, 26.0, 2.0], [33.0, 3.0, 9.5], 0.78));
    // top block
    v.push(Prim::bx([-5.0, 33.0, -2.0], [9.0, 4.0, 7.0], 0.66));
    // stair core tower
    v.push(Prim::bx([-20.0, 21.0, -11.0], [4.5, 21.0, 4.5], 0.6));
    // skewed bridge between block and tower
    v.push(Prim::bx([-12.5, 38.2, -7.0], [7.0, 0.9, 1.4], 0.82).yaw(0.32));

    // ── cuts ──
    // the void: a round-headed arch punched through four storeys along z
    v.push(Prim::bx([2.0, 12.0, 0.0], [5.5, 9.0, 23.5], 0.0).as_cut());
    v.push(Prim::cyl_z([2.0, 21.0, 0.0], 5.5, 23.5, 0.0).as_cut());
    // coffered soffit under the cantilever
    let mut cx = 28.5;
    while cx < 47.0 {
        let mut cz = -4.6;
        while cz < 9.5 {
            v.push(Prim::bx([cx, 23.15, cz], [1.55, 0.4, 1.55], 0.0).as_cut());
            cz += 4.2;
        }
        cx += 4.2;
    }
    // oculus through the cantilever tip
    v.push(Prim::cyl_y([40.0, 26.0, 2.0], 3.2, 4.0, 0.0).as_cut());
    // ribbon window recess in slab A
    v.push(Prim::bx([-14.0, 11.0, 12.0], [8.0, 1.2, 1.4], 0.0).as_cut());
    // vertical slot in the tower
    v.push(Prim::bx([-15.5, 24.0, -11.0], [0.7, 14.0, 0.55], 0.0).as_cut());
    v
}

pub fn monument(out: &mut [f32], n: usize, seed: u32) -> u32 {
    let scene = Scene::new(monument_prims(), true);
    let mut rng = Rng::new(seed);
    let mut grain = Rng::new(seed ^ 0xA5A5_1234);
    let n_ground = n / 9;
    let n_body = n - n_ground;

    let (k, tries) = {
        let out_ref = &mut *out;
        let scene_ref = &scene;
        scene.sample(&mut rng, n_body, |_| false, |k, p, nrm, pi| {
            let prim = &scene_ref.prims[pi];
            let refl = if prim.cut { 0.66 } else { prim.refl };
            let ao = scene_ref.ao(&p, &nrm);
            let sky = 0.8 + 0.2 * nrm[1].max(0.0);
            let it = refl * formwork(&p, &nrm) * ao * sky * (0.9 + 0.2 * grain.f());
            put(out_ref, k, p, it, nrm, sweep_key(&p));
        })
    };
    fill_tail(out, k, n_body, 0, &mut rng);

    // ground apron — darker under the structure (the cantilever's shadow)
    let (cx, cz, r_max) = (6.0f32, 4.0f32, 80.0f32);
    let mut g = n_body;
    let mut guard = 0u32;
    while g < n && guard < (n_ground as u32) * 40 {
        guard += 1;
        let (dx, dz) = rng.disk();
        let r = r_max * (dx * dx + dz * dz).sqrt();
        if rng.f() > smoothstep(r_max, r_max * 0.3, r) {
            continue;
        }
        let p = [cx + dx * r_max, 0.0, cz + dz * r_max];
        if scene.material(&[p[0], 0.03, p[2]]) {
            continue;
        }
        let shade = 1.0 - 0.12 * scene.column(p[0], p[2], &[2.5, 6.0, 12.0, 18.0, 25.0, 31.0]) as f32;
        let tex = 0.85 + 0.15 * vnoise2(p[0] * 0.7, p[2] * 0.7, 5);
        let paving = if fract(p[0] / 3.0) < 0.03 || fract(p[2] / 3.0) < 0.03 { 0.8 } else { 1.0 };
        let it = 0.3 * shade * tex * paving * (0.85 + 0.3 * grain.f()) * (1.0 - 0.5 * smoothstep(20.0, r_max, r));
        put(out, g, p, it, [0.0, 1.0, 0.0], sweep_key(&p));
        g += 1;
    }
    fill_tail(out, g, n, n_body, &mut rng);
    tries
}

// ───────────────────────────────────────────────────────────────────────────
//  (b) TERRAIN — the ruin field
// ───────────────────────────────────────────────────────────────────────────

struct Heightmap {
    res: usize,
    lo: f32,
    size: f32,
    h: Vec<f32>,
}

impl Heightmap {
    fn new(res: usize, lo: f32, size: f32, seed: u32) -> Heightmap {
        let mut h = vec![0.0; res * res];
        let cell = size / (res - 1) as f32;
        for j in 0..res {
            for i in 0..res {
                let x = lo + i as f32 * cell;
                let z = lo + j as f32 * cell;
                h[j * res + i] = Heightmap::eval(x, z, seed);
            }
        }
        Heightmap { res, lo, size, h }
    }

    fn eval(x: f32, z: f32, seed: u32) -> f32 {
        let dx = x - 4.0;
        let dz = z;
        let r2 = dx * dx + dz * dz;
        let r = r2.sqrt();
        let hills = (fbm2(x * 0.014 + 3.1, z * 0.014 - 1.3, seed, 4) * 0.5 + 0.5).powf(1.6) * 13.0;
        let ridge = (1.0 - fbm2(x * 0.03, z * 0.03, seed + 9, 3).abs()) * 1.6;
        let mound = 7.0 * (-r2 / (24.0 * 24.0)).exp();
        let rubble = fbm2(x * 0.42, z * 0.42, seed + 3, 2) * 0.55 * (-r2 / (42.0 * 42.0)).exp();
        let out = smoothstep(18.0, 80.0, r);
        (0.4 + hills * out + ridge * out + mound + rubble).max(0.12)
    }

    #[inline]
    fn at(&self, x: f32, z: f32) -> f32 {
        let f = (self.res - 1) as f32 / self.size;
        let u = ((x - self.lo) * f).clamp(0.0, (self.res - 1) as f32 - 0.001);
        let v = ((z - self.lo) * f).clamp(0.0, (self.res - 1) as f32 - 0.001);
        let (i, j) = (u as usize, v as usize);
        let (fu, fv) = (u - i as f32, v - j as f32);
        let r = self.res;
        let a = self.h[j * r + i];
        let b = self.h[j * r + i + 1];
        let c = self.h[(j + 1) * r + i];
        let d = self.h[(j + 1) * r + i + 1];
        (a + (b - a) * fu) + ((c + (d - c) * fu) - (a + (b - a) * fu)) * fv
    }
}

pub fn terrain(out: &mut [f32], n: usize, seed: u32) -> u32 {
    let mut rng = Rng::new(seed);
    let mut grain = Rng::new(seed ^ 0x51ED_2701);
    let hm = Heightmap::new(320, -100.0, 200.0, seed);
    // fine rubble only near the ruin, where the camera gets close
    let hgt = |x: f32, z: f32| {
        let dx = x - 4.0;
        let h = hm.at(x, z);
        if dx * dx + z * z < 55.0 * 55.0 {
            h + 0.12 * vnoise2(x * 1.9, z * 1.9, seed + 17)
        } else {
            h
        }
    };

    // ── ruins: what is left of the monument ──
    let mut prims = Vec::with_capacity(48);
    let sunk = |x: f32, z: f32, half: f32, depth: f32| hm.at(x, z) + half - depth;
    // the two piers of the void still stand
    prims.push(Prim::bx([-5.0, sunk(-5.0, 0.0, 6.5, 1.2), 0.0], [1.5, 6.5, 3.2], 0.74));
    prims.push(Prim::bx([9.0, sunk(9.0, 0.0, 5.0, 1.2), 0.0], [1.5, 5.0, 3.2], 0.74));
    // fallen lintel
    prims.push(Prim::bx([2.0, sunk(2.0, 9.0, 1.0, 0.5), 9.0], [9.5, 1.0, 2.2], 0.8).yaw(0.22));
    // the tower stump
    prims.push(Prim::bx([-20.0, sunk(-20.0, -11.0, 5.0, 1.0), -11.0], [4.5, 5.0, 4.5], 0.6));
    // fallen slabs
    for _ in 0..9 {
        let a = rng.f() * core::f32::consts::TAU;
        let r = rng.range(14.0, 46.0);
        let (x, z) = (4.0 + r * a.cos(), r * a.sin());
        let ey = rng.range(0.8, 1.6);
        prims.push(Prim::bx([x, sunk(x, z, ey, ey * 0.9), z], [rng.range(6.0, 14.0), ey, rng.range(2.5, 7.0)], 0.72).yaw(rng.f() * 3.1416));
    }
    // column stubs along the old pilotis lines
    for &z in &[8.5f32, -12.5] {
        let mut x = -22.0;
        while x <= 15.0 {
            if rng.f() < 0.75 {
                let hh = rng.range(0.8, 3.6);
                let (jx, jz) = (x + rng.range(-1.5, 1.5), z + rng.range(-1.5, 1.5));
                prims.push(Prim::cyl_y([jx, sunk(jx, jz, hh, 0.5), jz], 0.75, hh, 0.92));
            }
            x += 6.0;
        }
    }
    // wall fragments
    for _ in 0..5 {
        let a = rng.f() * core::f32::consts::TAU;
        let r = rng.range(20.0, 55.0);
        let (x, z) = (4.0 + r * a.cos(), r * a.sin());
        let ey = rng.range(2.5, 7.5);
        prims.push(Prim::bx([x, sunk(x, z, ey, 1.5), z], [rng.range(4.0, 10.0), ey, 0.5], 0.7).yaw(rng.f() * 3.1416));
    }
    let scene = Scene::new(prims, false);

    let n_ruin = n * 27 / 100;
    let (k, tries) = {
        let out_ref = &mut *out;
        let scene_ref = &scene;
        let hm_ref = &hm;
        scene.sample(&mut rng, n_ruin, |q| q[1] < hm_ref.at(q[0], q[2]), |k, p, nrm, pi| {
            let prim = &scene_ref.prims[pi];
            let ground = hm_ref.at(p[0], p[2]);
            let contact = 0.55 + 0.45 * smoothstep(ground, ground + 1.6, p[1]);
            let ao = scene_ref.ao(&p, &nrm);
            let it = prim.refl * formwork(&p, &nrm) * ao * contact * (0.82 + 0.18 * nrm[1].max(0.0)) * (0.88 + 0.24 * grain.f());
            put(out_ref, k, p, it, nrm, sweep_key(&p));
        })
    };
    fill_tail(out, k, n_ruin, 0, &mut rng);

    // ── the field itself ──
    let light = [-0.48f32, 0.8, 0.36];
    let ll = (light[0] * light[0] + light[1] * light[1] + light[2] * light[2]).sqrt();
    let light = [light[0] / ll, light[1] / ll, light[2] / ll];
    let (cx, r_max) = (4.0f32, 96.0f32);
    let mut g = n_ruin;
    let mut guard = 0u32;
    while g < n && guard < (n as u32) * 20 {
        guard += 1;
        let (dx, dz) = rng.disk();
        let r = r_max * (dx * dx + dz * dz).sqrt();
        let (x, z) = (cx + dx * r_max, dz * r_max);
        let y = hgt(x, z);
        if scene.material(&[x, y + 0.05, z]) {
            continue;
        }
        // normal from the heightmap alone (the fine rubble noise only moves y)
        let e = 0.6;
        let hx = (hm.at(x + e, z) - hm.at(x - e, z)) / (2.0 * e);
        let hz = (hm.at(x, z + e) - hm.at(x, z - e)) / (2.0 * e);
        let nl = (hx * hx + 1.0 + hz * hz).sqrt();
        let nrm = [-hx / nl, 1.0 / nl, -hz / nl];
        let lam = (nrm[0] * light[0] + nrm[1] * light[1] + nrm[2] * light[2]).max(0.0);
        // one-metre contour lines, darker — the survey sheet showing through
        let contour = 0.78 + 0.22 * smoothstep(0.0, 0.07, fract(y));
        // the field fades out in intensity rather than density (no wasted samples)
        let edge = smoothstep(r_max, r_max * 0.5, r);
        let it = (0.3 + 0.62 * lam) * contour * edge * (0.85 + 0.3 * grain.f());
        let p = [x, y, z];
        put(out, g, p, it, nrm, sweep_key(&p));
        g += 1;
    }
    fill_tail(out, g, n, n_ruin, &mut rng);
    tries
}

// ───────────────────────────────────────────────────────────────────────────
//  (c) TYPE — "HOLLOW" extruded from a Canvas2D rasterisation
// ───────────────────────────────────────────────────────────────────────────

/// `mask` is w×h bytes (row 0 = top), >127 = ink. The word is placed centred on
/// x = 0, standing on y = `y0`, extruded `depth` metres along z, `world_w` wide.
pub fn type_cloud(out: &mut [f32], n: usize, mask: &[u8], w: usize, h: usize, world_w: f32, depth: f32, y0: f32, seed: u32) -> u32 {
    let mut rng = Rng::new(seed);
    let s = world_w / w as f32;
    let inside = |i: isize, j: isize| -> bool {
        if i < 0 || j < 0 || i >= w as isize || j >= h as isize {
            false
        } else {
            mask[j as usize * w + i as usize] > 127
        }
    };
    let mut ink: Vec<u32> = Vec::new();
    // edges: pixel index << 2 | dir (0 +x, 1 −x, 2 +y(up), 3 −y(down))
    let mut edges: Vec<u32> = Vec::new();
    for j in 0..h as isize {
        for i in 0..w as isize {
            if !inside(i, j) {
                continue;
            }
            let id = (j as usize * w + i as usize) as u32;
            ink.push(id);
            if !inside(i + 1, j) {
                edges.push(id << 2);
            }
            if !inside(i - 1, j) {
                edges.push((id << 2) | 1);
            }
            if !inside(i, j - 1) {
                edges.push((id << 2) | 2);
            }
            if !inside(i, j + 1) {
                edges.push((id << 2) | 3);
            }
        }
    }
    let n_ground = n / 8;
    let n_word = n - n_ground;
    let mut k = 0;
    if !ink.is_empty() {
        let a_face = ink.len() as f32 * s * s; // one face
        let a_side = edges.len() as f32 * s * depth;
        let total = 2.0 * a_face + a_side;
        let x0 = -world_w * 0.5;
        let height = h as f32 * s;
        let hz = depth * 0.5;
        while k < n_word {
            let r = rng.f() * total;
            let (p, nrm, it) = if r < 2.0 * a_face {
                let id = ink[rng.below(ink.len())] as usize;
                let (i, j) = (id % w, id / w);
                let x = x0 + (i as f32 + rng.f()) * s;
                let y = y0 + (h as f32 - j as f32 - rng.f()) * s;
                if r < a_face {
                    let lift = (y - y0) / height;
                    ([x, y, hz], [0.0, 0.0, 1.0], 0.62 + 0.36 * lift)
                } else {
                    ([x, y, -hz], [0.0, 0.0, -1.0], 0.5)
                }
            } else {
                let e = edges[rng.below(edges.len())];
                let id = (e >> 2) as usize;
                let dir = e & 3;
                let (i, j) = ((id % w) as f32, (id / w) as f32);
                let t = rng.f();
                let z = rng.range(-hz, hz);
                let (px, py, nrm) = match dir {
                    0 => (i + 1.0, j + t, [1.0, 0.0, 0.0]),
                    1 => (i, j + t, [-1.0, 0.0, 0.0]),
                    2 => (i + t, j, [0.0, 1.0, 0.0]),
                    _ => (i + t, j + 1.0, [0.0, -1.0, 0.0]),
                };
                let x = x0 + px * s;
                let y = y0 + (h as f32 - py) * s;
                let it = if dir == 2 { 0.78 } else if dir == 3 { 0.32 } else { 0.52 };
                ([x, y, z], nrm, it)
            };
            let contact = 0.5 + 0.5 * smoothstep(y0, y0 + 3.5, p[1]);
            let it = it * formwork(&p, &nrm) * contact * (0.88 + 0.24 * rng.f());
            put(out, k, p, it, nrm, sweep_key(&p));
            k += 1;
        }
    }
    // ground plane the letters stand on
    let mut g = k;
    while g < n {
        let r = 72.0 * rng.f().powf(0.62);
        let (ca, sa) = rng.circle();
        let p = [r * ca, 0.0, r * sa * 0.8 + 4.0];
        let it = 0.26 * (1.0 - 0.6 * smoothstep(10.0, 72.0, r)) * (0.8 + 0.4 * rng.f());
        put(out, g, p, it, [0.0, 1.0, 0.0], sweep_key(&p));
        g += 1;
    }
    (ink.len() + edges.len()) as u32
}

// ───────────────────────────────────────────────────────────────────────────
//  (d) DISPERSED — a nebula of everything that was surveyed
// ───────────────────────────────────────────────────────────────────────────

pub fn nebula(out: &mut [f32], n: usize, seed: u32) -> u32 {
    let mut rng = Rng::new(seed);
    let c = [0.0f32, 26.0, -4.0];
    let n_shell = n * 55 / 100;
    let n_ring = n * 22 / 100;
    let mut k = 0;
    while k < n_shell {
        let d = rng.dir();
        let warp = vnoise3(d[0] * 1.7 + 4.0, d[1] * 1.7, d[2] * 1.7, seed);
        let r = 22.0 * (1.0 + 0.36 * warp) + rng.gauss() * 0.5;
        let p = [c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r];
        let it = 0.3 + 0.6 * (warp * 0.5 + 0.5) * (0.7 + 0.3 * rng.f());
        put(out, k, p, it, d, p[1] * 0.3 + p[0]);
        k += 1;
    }
    // a tilted orbit band
    let (ta, tb) = (0.42f32, -0.22f32);
    let (ca, sa, cb, sb) = (ta.cos(), ta.sin(), tb.cos(), tb.sin());
    while k < n_shell + n_ring {
        let (co, si) = rng.circle();
        let rr = 40.0 + rng.gauss() * 1.4;
        let (x, y, z) = (rr * co, rng.gauss() * 0.35, rr * si);
        // rotate about x then z
        let (y1, z1) = (y * ca - z * sa, y * sa + z * ca);
        let (x2, y2) = (x * cb - y1 * sb, x * sb + y1 * cb);
        let p = [c[0] + x2, c[1] + y2, c[2] + z1];
        let nl = (x2 * x2 + y2 * y2 + z1 * z1).sqrt().max(1e-3);
        let it = 0.35 + 0.45 * rng.f();
        put(out, k, p, it, [x2 / nl, y2 / nl, z1 / nl], p[1] * 0.3 + p[0]);
        k += 1;
    }
    // clumpy dust
    let mut guard = 0u32;
    while k < n && guard < n as u32 * 30 {
        guard += 1;
        let p = [c[0] + rng.gauss() * 18.0, c[1] + rng.gauss() * 11.0, c[2] + rng.gauss() * 18.0];
        if vnoise3(p[0] * 0.06, p[1] * 0.06, p[2] * 0.06, seed + 11) < 0.0 {
            continue;
        }
        let d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        let l = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt().max(1e-3);
        let it = 0.14 + 0.28 * rng.f();
        put(out, k, p, it, [d[0] / l, d[1] / l, d[2] / l], p[1] * 0.3 + p[0]);
        k += 1;
    }
    fill_tail(out, k, n, 0, &mut rng);
    guard
}
