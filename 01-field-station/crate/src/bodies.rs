//! 2D verlet rigid bodies (rectangles) with separating-axis collision.
//!
//! Each body is 4 particles held by 6 sticks (edges + diagonals). Collisions use
//! SAT to find the minimum-penetration edge, then split the correction between
//! the penetrating vertex and the two edge endpoints (Jakobsen-style), which gives
//! believable rotation and stacking without an explicit inertia tensor.
//! Units are CSS pixels, y grows downward.

use wasm_bindgen::prelude::*;

#[derive(Clone, Copy)]
struct Body {
    v: [usize; 4],
    is_static: bool,
    min: [f32; 2],
    max: [f32; 2],
}

#[derive(Clone, Copy)]
struct Stick {
    a: usize,
    b: usize,
    rest: f32,
}

#[wasm_bindgen]
pub struct World {
    x: Vec<f32>,
    y: Vec<f32>,
    ox: Vec<f32>,
    oy: Vec<f32>,
    fixed: Vec<bool>,
    bodies: Vec<Body>,
    sticks: Vec<Stick>,
    width: f32,
    height: f32,
    gx: f32,
    gy: f32,
    drag: i32,
    drag_u: f32,
    drag_v: f32,
    drag_x: f32,
    drag_y: f32,
    out: Vec<f32>,
    contacts: u32,
    iterations: u32,
}

#[wasm_bindgen]
impl World {
    #[wasm_bindgen(constructor)]
    pub fn new(width: f32, height: f32) -> World {
        World {
            x: Vec::new(),
            y: Vec::new(),
            ox: Vec::new(),
            oy: Vec::new(),
            fixed: Vec::new(),
            bodies: Vec::new(),
            sticks: Vec::new(),
            width,
            height,
            gx: 0.0,
            gy: 2600.0,
            drag: -1,
            drag_u: 0.0,
            drag_v: 0.0,
            drag_x: 0.0,
            drag_y: 0.0,
            out: Vec::new(),
            contacts: 0,
            iterations: 8,
        }
    }

    pub fn resize(&mut self, width: f32, height: f32) {
        self.width = width;
        self.height = height;
    }

    pub fn set_gravity(&mut self, gx: f32, gy: f32) {
        self.gx = gx;
        self.gy = gy;
    }

    fn corners(cx: f32, cy: f32, w: f32, h: f32, angle: f32) -> [(f32, f32); 4] {
        let (s, c) = angle.sin_cos();
        let hw = w * 0.5;
        let hh = h * 0.5;
        let local = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)];
        let mut out = [(0.0, 0.0); 4];
        for (k, (lx, ly)) in local.iter().enumerate() {
            out[k] = (cx + lx * c - ly * s, cy + lx * s + ly * c);
        }
        out
    }

    /// Adds a rectangle. Returns its body index.
    pub fn add_body(&mut self, cx: f32, cy: f32, w: f32, h: f32, angle: f32, is_static: bool) -> usize {
        let base = self.x.len();
        for (px, py) in World::corners(cx, cy, w, h, angle).iter() {
            self.x.push(*px);
            self.y.push(*py);
            self.ox.push(*px);
            self.oy.push(*py);
            self.fixed.push(is_static);
        }
        let v = [base, base + 1, base + 2, base + 3];
        if !is_static {
            for &(a, b) in &[(0, 1), (1, 2), (2, 3), (3, 0), (0, 2), (1, 3)] {
                let (a, b) = (v[a], v[b]);
                let rest = ((self.x[a] - self.x[b]).powi(2) + (self.y[a] - self.y[b]).powi(2)).sqrt();
                self.sticks.push(Stick { a, b, rest });
            }
        }
        self.bodies.push(Body { v, is_static, min: [0.0; 2], max: [0.0; 2] });
        self.out.extend_from_slice(&[cx, cy, angle]);
        self.bodies.len() - 1
    }

    /// Teleport a body (used to re-place static obstacles on resize, or respawn).
    pub fn place(&mut self, body: usize, cx: f32, cy: f32, w: f32, h: f32, angle: f32) {
        let b = self.bodies[body];
        for (k, (px, py)) in World::corners(cx, cy, w, h, angle).iter().enumerate() {
            let p = b.v[k];
            self.x[p] = *px;
            self.y[p] = *py;
            self.ox[p] = *px;
            self.oy[p] = *py;
        }
    }

    /// Radial impulse (px of displacement per step) around a point.
    pub fn blast(&mut self, x: f32, y: f32, radius: f32, strength: f32) {
        for p in 0..self.x.len() {
            if self.fixed[p] {
                continue;
            }
            let dx = self.x[p] - x;
            let dy = self.y[p] - y;
            let d = (dx * dx + dy * dy).sqrt().max(1.0);
            if d < radius {
                let f = strength * (1.0 - d / radius);
                self.ox[p] -= dx / d * f;
                self.oy[p] -= dy / d * f;
            }
        }
    }

    fn center(&self, b: usize) -> (f32, f32) {
        let v = self.bodies[b].v;
        (
            (self.x[v[0]] + self.x[v[1]] + self.x[v[2]] + self.x[v[3]]) * 0.25,
            (self.y[v[0]] + self.y[v[1]] + self.y[v[2]] + self.y[v[3]]) * 0.25,
        )
    }

    fn project(&self, b: usize, nx: f32, ny: f32) -> (f32, f32) {
        let v = self.bodies[b].v;
        let mut mn = f32::MAX;
        let mut mx = f32::MIN;
        for &p in &v {
            let d = self.x[p] * nx + self.y[p] * ny;
            mn = mn.min(d);
            mx = mx.max(d);
        }
        (mn, mx)
    }

    fn update_aabb(&mut self, b: usize) {
        let v = self.bodies[b].v;
        let mut mn = [f32::MAX; 2];
        let mut mx = [f32::MIN; 2];
        for &p in &v {
            mn[0] = mn[0].min(self.x[p]);
            mn[1] = mn[1].min(self.y[p]);
            mx[0] = mx[0].max(self.x[p]);
            mx[1] = mx[1].max(self.y[p]);
        }
        self.bodies[b].min = mn;
        self.bodies[b].max = mx;
    }

    fn collide(&mut self, b1: usize, b2: usize) -> bool {
        let mut min_dist = f32::MAX;
        let mut normal = (0.0f32, 0.0f32);
        let mut edge = (0usize, 0usize);
        let mut edge_body = b1;

        for &bi in &[b1, b2] {
            let v = self.bodies[bi].v;
            for k in 0..4 {
                let (a, c) = (v[k], v[(k + 1) % 4]);
                let ex = self.x[c] - self.x[a];
                let ey = self.y[c] - self.y[a];
                let len = (ex * ex + ey * ey).sqrt().max(1e-6);
                let (nx, ny) = (-ey / len, ex / len);
                let (min_a, max_a) = self.project(b1, nx, ny);
                let (min_b, max_b) = self.project(b2, nx, ny);
                let dist = if min_a < min_b { min_b - max_a } else { min_a - max_b };
                if dist > 0.0 {
                    return false;
                }
                if dist.abs() < min_dist {
                    min_dist = dist.abs();
                    normal = (nx, ny);
                    edge = (a, c);
                    edge_body = bi;
                }
            }
        }

        let depth = min_dist;
        let (vb, eb) = if edge_body == b2 { (b1, b2) } else { (b2, b1) };
        let (ecx, ecy) = self.center(eb);
        let (vcx, vcy) = self.center(vb);
        if normal.0 * (vcx - ecx) + normal.1 * (vcy - ecy) < 0.0 {
            normal = (-normal.0, -normal.1);
        }
        let mut smallest = f32::MAX;
        let mut vi = 0usize;
        for &p in &self.bodies[vb].v {
            let d = normal.0 * (self.x[p] - ecx) + normal.1 * (self.y[p] - ecy);
            if d < smallest {
                smallest = d;
                vi = p;
            }
        }

        let (cvx, cvy) = (normal.0 * depth, normal.1 * depth);
        let (e1, e2) = edge;
        let t = if (self.x[e1] - self.x[e2]).abs() > (self.y[e1] - self.y[e2]).abs() {
            (self.x[vi] - cvx - self.x[e1]) / (self.x[e2] - self.x[e1])
        } else {
            (self.y[vi] - cvy - self.y[e1]) / (self.y[e2] - self.y[e1])
        };
        let t = if t.is_finite() { t.clamp(0.0, 1.0) } else { 0.5 };
        let lambda = 1.0 / (t * t + (1.0 - t) * (1.0 - t));

        let v_static = self.bodies[vb].is_static;
        let e_static = self.bodies[eb].is_static;
        let (fv, fe) = match (v_static, e_static) {
            (false, false) => (0.5, 0.5),
            (true, false) => (0.0, 1.0),
            (false, true) => (1.0, 0.0),
            _ => return false,
        };
        if fe > 0.0 {
            self.x[e1] -= cvx * (1.0 - t) * fe * lambda;
            self.y[e1] -= cvy * (1.0 - t) * fe * lambda;
            self.x[e2] -= cvx * t * fe * lambda;
            self.y[e2] -= cvy * t * fe * lambda;
        }
        if fv > 0.0 {
            self.x[vi] += cvx * fv;
            self.y[vi] += cvy * fv;
            // tangential friction on the contact vertex
            let (tx, ty) = (-normal.1, normal.0);
            let vx = self.x[vi] - self.ox[vi];
            let vy = self.y[vi] - self.oy[vi];
            let vt = vx * tx + vy * ty;
            self.ox[vi] += tx * vt * 0.12;
            self.oy[vi] += ty * vt * 0.12;
        }
        true
    }

    /// Start dragging the body under (px, py). Returns body index or -1.
    pub fn drag_start(&mut self, px: f32, py: f32) -> i32 {
        for b in (0..self.bodies.len()).rev() {
            if self.bodies[b].is_static {
                continue;
            }
            let v = self.bodies[b].v;
            let mut inside = true;
            for k in 0..4 {
                let (a, c) = (v[k], v[(k + 1) % 4]);
                let cr = (self.x[c] - self.x[a]) * (py - self.y[a]) - (self.y[c] - self.y[a]) * (px - self.x[a]);
                if cr < 0.0 {
                    inside = false;
                    break;
                }
            }
            if inside {
                let (p0, p1, p3) = (v[0], v[1], v[3]);
                let (ux, uy) = (self.x[p1] - self.x[p0], self.y[p1] - self.y[p0]);
                let (wx, wy) = (self.x[p3] - self.x[p0], self.y[p3] - self.y[p0]);
                let (rx, ry) = (px - self.x[p0], py - self.y[p0]);
                self.drag_u = ((rx * ux + ry * uy) / (ux * ux + uy * uy)).clamp(0.0, 1.0);
                self.drag_v = ((rx * wx + ry * wy) / (wx * wx + wy * wy)).clamp(0.0, 1.0);
                self.drag = b as i32;
                self.drag_x = px;
                self.drag_y = py;
                return b as i32;
            }
        }
        -1
    }

    pub fn drag_move(&mut self, px: f32, py: f32) {
        self.drag_x = px;
        self.drag_y = py;
    }

    pub fn drag_end(&mut self) {
        self.drag = -1;
    }

    fn apply_drag(&mut self) {
        if self.drag < 0 {
            return;
        }
        let v = self.bodies[self.drag as usize].v;
        let (u, w) = (self.drag_u, self.drag_v);
        let wts = [(1.0 - u) * (1.0 - w), u * (1.0 - w), u * w, (1.0 - u) * w];
        let mut px = 0.0;
        let mut py = 0.0;
        for k in 0..4 {
            px += self.x[v[k]] * wts[k];
            py += self.y[v[k]] * wts[k];
        }
        let (ex, ey) = (self.drag_x - px, self.drag_y - py);
        let s: f32 = wts.iter().map(|a| a * a).sum::<f32>().max(1e-4);
        for k in 0..4 {
            let f = wts[k] / s * 0.5;
            self.x[v[k]] += ex * f;
            self.y[v[k]] += ey * f;
        }
    }

    pub fn step(&mut self, dt: f32) {
        let dt = dt.min(1.0 / 30.0);
        let dt2 = dt * dt;
        let n = self.x.len();
        for p in 0..n {
            if self.fixed[p] {
                continue;
            }
            let vx = (self.x[p] - self.ox[p]) * 0.998;
            let vy = (self.y[p] - self.oy[p]) * 0.998;
            self.ox[p] = self.x[p];
            self.oy[p] = self.y[p];
            self.x[p] += vx + self.gx * dt2;
            self.y[p] += vy + self.gy * dt2;
        }

        self.contacts = 0;
        let nb = self.bodies.len();
        for _ in 0..self.iterations {
            for s in 0..self.sticks.len() {
                let st = self.sticks[s];
                let dx = self.x[st.b] - self.x[st.a];
                let dy = self.y[st.b] - self.y[st.a];
                let len = (dx * dx + dy * dy).sqrt().max(1e-6);
                let diff = (len - st.rest) / len * 0.5;
                self.x[st.a] += dx * diff;
                self.y[st.a] += dy * diff;
                self.x[st.b] -= dx * diff;
                self.y[st.b] -= dy * diff;
            }
            self.apply_drag();
            let top = if self.gy < 0.0 { 0.0 } else { -4000.0 };
            for p in 0..n {
                if self.fixed[p] {
                    continue;
                }
                self.x[p] = self.x[p].clamp(0.0, self.width);
                self.y[p] = self.y[p].clamp(top, self.height);
            }
            for b in 0..nb {
                self.update_aabb(b);
            }
            for i in 0..nb {
                for j in (i + 1)..nb {
                    let (a, b) = (self.bodies[i], self.bodies[j]);
                    if a.is_static && b.is_static {
                        continue;
                    }
                    if a.max[0] < b.min[0] || b.max[0] < a.min[0] || a.max[1] < b.min[1] || b.max[1] < a.min[1] {
                        continue;
                    }
                    if self.collide(i, j) {
                        self.contacts += 1;
                    }
                }
            }
        }

        // wall friction + a little restitution, once per step
        for p in 0..n {
            if self.fixed[p] {
                continue;
            }
            if self.y[p] >= self.height - 0.01 || self.y[p] <= 0.01 && self.gy < 0.0 {
                let vy = self.y[p] - self.oy[p];
                self.oy[p] = self.y[p] + vy * 0.25;
                self.ox[p] = self.x[p] - (self.x[p] - self.ox[p]) * 0.82;
            }
            if self.x[p] <= 0.01 || self.x[p] >= self.width - 0.01 {
                let vx = self.x[p] - self.ox[p];
                self.ox[p] = self.x[p] + vx * 0.25;
                self.oy[p] = self.y[p] - (self.y[p] - self.oy[p]) * 0.82;
            }
        }

        for b in 0..nb {
            let v = self.bodies[b].v;
            let (cx, cy) = self.center(b);
            let ang = (self.y[v[1]] - self.y[v[0]]).atan2(self.x[v[1]] - self.x[v[0]]);
            self.out[b * 3] = cx;
            self.out[b * 3 + 1] = cy;
            self.out[b * 3 + 2] = ang;
        }
    }

    pub fn out_ptr(&self) -> *const f32 {
        self.out.as_ptr()
    }
    pub fn body_count(&self) -> usize {
        self.bodies.len()
    }
    pub fn contacts(&self) -> u32 {
        self.contacts
    }
    pub fn iterations(&self) -> u32 {
        self.iterations
    }
}
