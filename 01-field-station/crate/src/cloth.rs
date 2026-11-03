//! Tearable verlet cloth.
//!
//! Particles live on a `cols × rows` grid. Structural sticks connect neighbours,
//! "bend" sticks connect particles two apart (and across quad diagonals) and are
//! automatically disabled when the structural sticks they span are torn, so a cut
//! line actually opens instead of being held together by stiffness.

use wasm_bindgen::prelude::*;

#[derive(Clone, Copy)]
struct Stick {
    a: u32,
    b: u32,
    rest: f32,
    alive: bool,
}

#[derive(Clone, Copy)]
struct Bend {
    a: u32,
    b: u32,
    rest: f32,
    s0: u32,
    s1: u32,
}

#[wasm_bindgen]
pub struct Cloth {
    cols: usize,
    rows: usize,
    pos: Vec<f32>,
    prev: Vec<f32>,
    inv_mass: Vec<f32>,
    base_mass: Vec<f32>,
    sticks: Vec<Stick>,
    bends: Vec<Bend>,
    h_edge: Vec<u32>,
    v_edge: Vec<u32>,
    normals: Vec<f32>,
    verts: Vec<f32>,
    indices: Vec<u32>,
    clip_step: usize,
    dirty: bool,
    grabbed: i32,
    grab_target: [f32; 3],
    torn: u32,
    time: f32,
    wind: f32,
    gravity: f32,
    tear_ratio: f32,
    iterations: u32,
    floor: f32,
}

#[inline]
fn cross2(ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    ax * by - ay * bx
}

#[wasm_bindgen]
impl Cloth {
    #[wasm_bindgen(constructor)]
    pub fn new(cols: usize, rows: usize, width: f32, height: f32) -> Cloth {
        let n = cols * rows;
        let mut pos = Vec::with_capacity(n * 3);
        let mut inv_mass = Vec::with_capacity(n);
        let clip_step = ((cols - 1) / 4).max(2);

        for j in 0..rows {
            for i in 0..cols {
                let u = i as f32 / (cols - 1) as f32;
                let v = j as f32 / (rows - 1) as f32;
                let x = (u - 0.5) * width;
                let y = height * 0.5 - v * height;
                // a faint initial ripple so the sheet never starts perfectly flat
                let z = (u * 9.0).sin() * (v * 3.0).sin() * 0.012;
                pos.extend_from_slice(&[x, y, z]);
                let d = i % clip_step;
                let pinned = j == 0 && (d == 0 || d == 1 || d == clip_step - 1);
                inv_mass.push(if pinned { 0.0 } else { 1.0 });
            }
        }

        let idx = |i: usize, j: usize| (j * cols + i) as u32;
        let mut sticks = Vec::new();
        let mut h_edge = vec![0u32; (cols - 1) * rows];
        let mut v_edge = vec![0u32; cols * (rows - 1)];
        let dist = |p: &Vec<f32>, a: u32, b: u32| {
            let (a, b) = (a as usize * 3, b as usize * 3);
            let dx = p[a] - p[b];
            let dy = p[a + 1] - p[b + 1];
            let dz = p[a + 2] - p[b + 2];
            (dx * dx + dy * dy + dz * dz).sqrt()
        };

        for j in 0..rows {
            for i in 0..cols {
                if i + 1 < cols {
                    let (a, b) = (idx(i, j), idx(i + 1, j));
                    h_edge[j * (cols - 1) + i] = sticks.len() as u32;
                    sticks.push(Stick { a, b, rest: dist(&pos, a, b), alive: true });
                }
                if j + 1 < rows {
                    let (a, b) = (idx(i, j), idx(i, j + 1));
                    v_edge[j * cols + i] = sticks.len() as u32;
                    sticks.push(Stick { a, b, rest: dist(&pos, a, b), alive: true });
                }
            }
        }

        let mut bends = Vec::new();
        for j in 0..rows {
            for i in 0..cols {
                if i + 2 < cols {
                    let (a, b) = (idx(i, j), idx(i + 2, j));
                    bends.push(Bend {
                        a,
                        b,
                        rest: dist(&pos, a, b),
                        s0: h_edge[j * (cols - 1) + i],
                        s1: h_edge[j * (cols - 1) + i + 1],
                    });
                }
                if j + 2 < rows {
                    let (a, b) = (idx(i, j), idx(i, j + 2));
                    bends.push(Bend {
                        a,
                        b,
                        rest: dist(&pos, a, b),
                        s0: v_edge[j * cols + i],
                        s1: v_edge[(j + 1) * cols + i],
                    });
                }
                if i + 1 < cols && j + 1 < rows {
                    // shear diagonals, bound to the quad's edges
                    let (a, b) = (idx(i, j), idx(i + 1, j + 1));
                    bends.push(Bend {
                        a,
                        b,
                        rest: dist(&pos, a, b),
                        s0: h_edge[j * (cols - 1) + i],
                        s1: v_edge[j * cols + i + 1],
                    });
                    let (a, b) = (idx(i + 1, j), idx(i, j + 1));
                    bends.push(Bend {
                        a,
                        b,
                        rest: dist(&pos, a, b),
                        s0: h_edge[(j + 1) * (cols - 1) + i],
                        s1: v_edge[j * cols + i],
                    });
                }
            }
        }

        let mut c = Cloth {
            cols,
            rows,
            prev: pos.clone(),
            base_mass: inv_mass.clone(),
            pos,
            inv_mass,
            sticks,
            bends,
            h_edge,
            v_edge,
            normals: vec![0.0; n * 3],
            verts: vec![0.0; n * 8],
            indices: Vec::with_capacity((cols - 1) * (rows - 1) * 6),
            clip_step,
            dirty: true,
            grabbed: -1,
            grab_target: [0.0; 3],
            torn: 0,
            time: 0.0,
            wind: 0.35,
            gravity: 9.0,
            tear_ratio: 2.6,
            iterations: 14,
            floor: -1e9,
        };
        c.build_mesh();
        c
    }

    pub fn set_wind(&mut self, w: f32) {
        self.wind = w;
    }
    pub fn set_tear_ratio(&mut self, r: f32) {
        self.tear_ratio = r;
    }
    pub fn set_floor(&mut self, y: f32) {
        self.floor = y;
    }
    pub fn set_iterations(&mut self, n: u32) {
        self.iterations = n.clamp(1, 64);
    }

    /// Release every pin: the sheet drops.
    pub fn release_pins(&mut self) {
        for (m, b) in self.inv_mass.iter_mut().zip(self.base_mass.iter_mut()) {
            *m = 1.0;
            *b = 1.0;
        }
        if self.grabbed >= 0 {
            self.inv_mass[self.grabbed as usize] = 0.0;
        }
    }

    pub fn step(&mut self, dt: f32) {
        let dt = dt.min(1.0 / 30.0);
        self.time += dt;
        let t = self.time;
        let dt2 = dt * dt;
        let n = self.cols * self.rows;
        let damping = 0.992;

        for p in 0..n {
            if self.inv_mass[p] == 0.0 {
                continue;
            }
            let k = p * 3;
            let (x, y, z) = (self.pos[k], self.pos[k + 1], self.pos[k + 2]);
            let vx = (x - self.prev[k]) * damping;
            let vy = (y - self.prev[k + 1]) * damping;
            let vz = (z - self.prev[k + 2]) * damping;
            // gusty wind field: travelling sine bands
            let gust = (0.6 + 0.4 * (t * 1.3 + x * 2.0).sin())
                * ((t * 0.7 + y * 1.7 + x * 0.9).sin() * 0.5 + 0.5);
            let w = self.wind * gust;
            let ax = w * 0.6 * (t * 0.5).sin();
            let ay = -self.gravity;
            let az = w * (2.2 + 1.2 * (t * 2.1 + x * 3.0 + y * 2.0).sin());
            self.prev[k] = x;
            self.prev[k + 1] = y;
            self.prev[k + 2] = z;
            self.pos[k] = x + vx + ax * dt2;
            self.pos[k + 1] = y + vy + ay * dt2;
            self.pos[k + 2] = z + vz + az * dt2;
        }

        for it in 0..self.iterations {
            self.apply_grab();
            for s in 0..self.sticks.len() {
                let st = self.sticks[s];
                if !st.alive {
                    continue;
                }
                let (a, b) = (st.a as usize, st.b as usize);
                let (ia, ib) = (self.inv_mass[a], self.inv_mass[b]);
                let (ka, kb) = (a * 3, b * 3);
                let dx = self.pos[kb] - self.pos[ka];
                let dy = self.pos[kb + 1] - self.pos[ka + 1];
                let dz = self.pos[kb + 2] - self.pos[ka + 2];
                let len = (dx * dx + dy * dy + dz * dz).sqrt().max(1e-6);
                if it == 0 && len > st.rest * self.tear_ratio {
                    self.sticks[s].alive = false;
                    self.torn += 1;
                    self.dirty = true;
                    continue;
                }
                let w = ia + ib;
                if w == 0.0 {
                    continue;
                }
                let diff = (len - st.rest) / (len * w);
                self.pos[ka] += dx * diff * ia;
                self.pos[ka + 1] += dy * diff * ia;
                self.pos[ka + 2] += dz * diff * ia;
                self.pos[kb] -= dx * diff * ib;
                self.pos[kb + 1] -= dy * diff * ib;
                self.pos[kb + 2] -= dz * diff * ib;
            }
            let stiffness = 0.35;
            for bd in 0..self.bends.len() {
                let b = self.bends[bd];
                if !self.sticks[b.s0 as usize].alive || !self.sticks[b.s1 as usize].alive {
                    continue;
                }
                let (a, c) = (b.a as usize, b.b as usize);
                let (ia, ic) = (self.inv_mass[a], self.inv_mass[c]);
                let w = ia + ic;
                if w == 0.0 {
                    continue;
                }
                let (ka, kc) = (a * 3, c * 3);
                let dx = self.pos[kc] - self.pos[ka];
                let dy = self.pos[kc + 1] - self.pos[ka + 1];
                let dz = self.pos[kc + 2] - self.pos[ka + 2];
                let len = (dx * dx + dy * dy + dz * dz).sqrt().max(1e-6);
                let diff = stiffness * (len - b.rest) / (len * w);
                self.pos[ka] += dx * diff * ia;
                self.pos[ka + 1] += dy * diff * ia;
                self.pos[ka + 2] += dz * diff * ia;
                self.pos[kc] -= dx * diff * ic;
                self.pos[kc + 1] -= dy * diff * ic;
                self.pos[kc + 2] -= dz * diff * ic;
            }
            // floor
            if self.floor > -1e8 {
                for p in 0..n {
                    let k = p * 3;
                    if self.pos[k + 1] < self.floor {
                        self.pos[k + 1] = self.floor;
                        // friction
                        self.prev[k] = self.pos[k] - (self.pos[k] - self.prev[k]) * 0.6;
                        self.prev[k + 2] = self.pos[k + 2] - (self.pos[k + 2] - self.prev[k + 2]) * 0.6;
                        self.prev[k + 1] = self.pos[k + 1];
                    }
                }
            }
        }
        self.apply_grab();
        self.build_mesh();
    }

    fn apply_grab(&mut self) {
        if self.grabbed >= 0 {
            let k = self.grabbed as usize * 3;
            self.pos[k] = self.grab_target[0];
            self.pos[k + 1] = self.grab_target[1];
            self.pos[k + 2] = self.grab_target[2];
        }
    }

    /// Nearest particle to a ray (perpendicular distance), or -1.
    pub fn pick(&self, ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32, max_dist: f32) -> i32 {
        let mut best = -1i32;
        let mut best_d = max_dist * max_dist;
        let n = self.cols * self.rows;
        for p in 0..n {
            let k = p * 3;
            let vx = self.pos[k] - ox;
            let vy = self.pos[k + 1] - oy;
            let vz = self.pos[k + 2] - oz;
            let t = vx * dx + vy * dy + vz * dz;
            if t < 0.0 {
                continue;
            }
            let d2 = vx * vx + vy * vy + vz * vz - t * t;
            if d2 < best_d {
                best_d = d2;
                best = p as i32;
            }
        }
        best
    }

    pub fn grab(&mut self, i: i32) {
        self.release();
        if i < 0 {
            return;
        }
        let k = i as usize * 3;
        self.grabbed = i;
        self.grab_target = [self.pos[k], self.pos[k + 1], self.pos[k + 2]];
        self.inv_mass[i as usize] = 0.0;
    }

    pub fn drag_to(&mut self, x: f32, y: f32, z: f32) {
        self.grab_target = [x, y, z];
    }

    pub fn release(&mut self) {
        if self.grabbed >= 0 {
            let g = self.grabbed as usize;
            self.inv_mass[g] = self.base_mass[g];
        }
        self.grabbed = -1;
    }

    /// Push particles near (x, y) on the z≈0 plane with a velocity impulse.
    pub fn gust(&mut self, x: f32, y: f32, vx: f32, vy: f32, radius: f32) {
        let n = self.cols * self.rows;
        let speed = (vx * vx + vy * vy).sqrt();
        for p in 0..n {
            if self.inv_mass[p] == 0.0 {
                continue;
            }
            let k = p * 3;
            let dx = self.pos[k] - x;
            let dy = self.pos[k + 1] - y;
            let d = (dx * dx + dy * dy).sqrt();
            if d < radius {
                let f = (1.0 - d / radius).powi(2);
                self.prev[k] -= vx * f;
                self.prev[k + 1] -= vy * f;
                self.prev[k + 2] += speed * f * 0.8;
            }
        }
    }

    /// Cut every live stick whose xy projection crosses segment A→B. Returns cut count.
    pub fn cut(&mut self, ax: f32, ay: f32, bx: f32, by: f32) -> u32 {
        let ex = bx - ax;
        let ey = by - ay;
        let mut count = 0;
        for s in 0..self.sticks.len() {
            let st = self.sticks[s];
            if !st.alive {
                continue;
            }
            let (ka, kb) = (st.a as usize * 3, st.b as usize * 3);
            let px = self.pos[ka];
            let py = self.pos[ka + 1];
            let dx = self.pos[kb] - px;
            let dy = self.pos[kb + 1] - py;
            let denom = cross2(dx, dy, ex, ey);
            if denom.abs() < 1e-9 {
                continue;
            }
            let qx = ax - px;
            let qy = ay - py;
            let t = cross2(qx, qy, ex, ey) / denom;
            let u = cross2(qx, qy, dx, dy) / denom;
            if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
                self.sticks[s].alive = false;
                count += 1;
            }
        }
        if count > 0 {
            self.torn += count;
            self.dirty = true;
        }
        count
    }

    fn build_mesh(&mut self) {
        let (cols, rows) = (self.cols, self.rows);
        if self.dirty {
            self.indices.clear();
            for j in 0..rows - 1 {
                for i in 0..cols - 1 {
                    let a = (j * cols + i) as u32;
                    let b = a + 1;
                    let c = a + cols as u32;
                    let d = c + 1;
                    let top = self.sticks[self.h_edge[j * (cols - 1) + i] as usize].alive;
                    let bottom = self.sticks[self.h_edge[(j + 1) * (cols - 1) + i] as usize].alive;
                    let left = self.sticks[self.v_edge[j * cols + i] as usize].alive;
                    let right = self.sticks[self.v_edge[j * cols + i + 1] as usize].alive;
                    if top && left {
                        self.indices.extend_from_slice(&[a, c, b]);
                    }
                    if right && bottom {
                        self.indices.extend_from_slice(&[b, c, d]);
                    }
                }
            }
        }

        for v in self.normals.iter_mut() {
            *v = 0.0;
        }
        for tri in self.indices.chunks_exact(3) {
            let (a, b, c) = (tri[0] as usize * 3, tri[1] as usize * 3, tri[2] as usize * 3);
            let e1 = [self.pos[b] - self.pos[a], self.pos[b + 1] - self.pos[a + 1], self.pos[b + 2] - self.pos[a + 2]];
            let e2 = [self.pos[c] - self.pos[a], self.pos[c + 1] - self.pos[a + 1], self.pos[c + 2] - self.pos[a + 2]];
            let nx = e1[1] * e2[2] - e1[2] * e2[1];
            let ny = e1[2] * e2[0] - e1[0] * e2[2];
            let nz = e1[0] * e2[1] - e1[1] * e2[0];
            for &k in &[a, b, c] {
                self.normals[k] += nx;
                self.normals[k + 1] += ny;
                self.normals[k + 2] += nz;
            }
        }
        // winding (a,c,b) → (c-a)×(b-a) already faces +z (toward the camera)
        for p in 0..cols * rows {
            let k = p * 3;
            let (nx, ny, nz) = (self.normals[k], self.normals[k + 1], self.normals[k + 2]);
            let l = (nx * nx + ny * ny + nz * nz).sqrt();
            let (nx, ny, nz) = if l > 1e-9 { (nx / l, ny / l, nz / l) } else { (0.0, 0.0, 1.0) };
            let o = p * 8;
            let i = p % cols;
            let j = p / cols;
            self.verts[o] = self.pos[k];
            self.verts[o + 1] = self.pos[k + 1];
            self.verts[o + 2] = self.pos[k + 2];
            self.verts[o + 3] = nx;
            self.verts[o + 4] = ny;
            self.verts[o + 5] = nz;
            self.verts[o + 6] = i as f32 / (cols - 1) as f32;
            self.verts[o + 7] = j as f32 / (rows - 1) as f32;
        }
    }

    /// Returns true once after topology changed (indices must be re-uploaded).
    pub fn take_dirty(&mut self) -> bool {
        let d = self.dirty;
        self.dirty = false;
        d
    }

    pub fn verts_ptr(&self) -> *const f32 {
        self.verts.as_ptr()
    }
    pub fn verts_len(&self) -> usize {
        self.verts.len()
    }
    pub fn indices_ptr(&self) -> *const u32 {
        self.indices.as_ptr()
    }
    pub fn indices_len(&self) -> usize {
        self.indices.len()
    }
    pub fn max_indices(&self) -> usize {
        (self.cols - 1) * (self.rows - 1) * 6
    }
    pub fn particle(&self, i: usize) -> Vec<f32> {
        let k = i * 3;
        vec![self.pos[k], self.pos[k + 1], self.pos[k + 2]]
    }
    /// xyz of every clip anchor on the top row.
    pub fn clip_positions(&self) -> Vec<f32> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < self.cols {
            let k = i * 3;
            out.extend_from_slice(&self.pos[k..k + 3]);
            i += self.clip_step;
        }
        out
    }
    pub fn torn(&self) -> u32 {
        self.torn
    }
    pub fn constraint_count(&self) -> usize {
        self.sticks.len() + self.bends.len()
    }
    pub fn particle_count(&self) -> usize {
        self.cols * self.rows
    }
    pub fn iterations(&self) -> u32 {
        self.iterations
    }
}
