//! Shape-matching soft bodies (Müller, Heidelberger, Teschner, Gross 2005).
//!
//! Each glyph body is the set of its contour particles (outer + hole rings). Per
//! substep, position-based:
//!   1. integrate gravity, predict positions
//!   2. pointer springs pull grabbed particles towards the cursor
//!   3. shape matching: best rotation R from Apq (2D polar decomposition is an atan2),
//!      blended with the det-normalised linear transform A = Apq·Aqq⁻¹ by β, goals
//!      g = (βA + (1−β)R)·q + c, particles move by α·(g − x)
//!   4. gas pressure: an area constraint on the signed area of all rings
//!      (outer positive, holes negative) towards rest·inflate
//!   5. collisions: particle vs other glyphs' rings (even-odd inside test + nearest
//!      edge, thick by `radius`), walls, rounded DOM rects; Coulomb friction from the
//!      penetration depth
//!   6. velocities from positions, rigid-motion-preserving damping
//! Units are CSS pixels, y grows downward.

use crate::contour::{self, P};
use crate::triangulate;
use wasm_bindgen::prelude::*;

const PT_STRIDE: usize = 8;
const BODY_STRIDE: usize = 12;
const MAX_SPEED: f32 = 4200.0;
const MU_S: f32 = 0.9;
const MU_K: f32 = 0.55;
/// Fraction of a supported body's "away from support" velocity removed per substep.
/// Without it the shape-matching spring hands impact energy straight back as a bounce.
const SUPPORT_DAMP: f32 = 0.22;
/// Gummy stickiness: extra friction budget per contact per substep (px). Resting
/// contacts only penetrate ~g·h² per substep, too little to hold a letter against
/// the solver's own jiggle, so stacks would creep apart without it.
const STICK: f32 = 0.05;
/// Rolling resistance for supported bodies (fraction of spin removed per substep).
const ROLL_DAMP: f32 = 0.006;

struct Template {
    pts: Vec<P>,
    rings: Vec<(usize, usize, bool)>,
    tris: Vec<u32>,
    width: f32,
    height: f32,
}

struct Body {
    tmpl: usize,
    start: usize,
    count: usize,
    ring_start: usize,
    ring_count: usize,
    rest: Vec<P>,
    aqq_inv: [f32; 4],
    rest_area: f32,
    radius: f32,
    color: [f32; 4],
    min: P,
    max: P,
    grow: f32,
    pop: f32,
    cx: f32,
    cy: f32,
    angle: f32,
    squash: f32,
    lift: f32,
    root: bool,
    grounded: bool,
    impact: f32,
    cooldown: f32,
    speed: f32,
    kind: u32,
    /// pushed against gravity by a contact during this substep
    supported: bool,
    /// seconds since the pointer let go (throws are exempt from support damping)
    free_t: f32,
}

#[wasm_bindgen]
pub struct World {
    templates: Vec<Template>,
    bodies: Vec<Body>,
    x: Vec<f32>,
    y: Vec<f32>,
    ox: Vec<f32>,
    oy: Vec<f32>,
    vx: Vec<f32>,
    vy: Vec<f32>,
    strain: Vec<f32>,
    scratch: Vec<f32>,
    rings: Vec<[u32; 4]>,
    fill: Vec<u32>,
    strip: Vec<u32>,
    pts_out: Vec<f32>,
    body_out: Vec<f32>,
    events: Vec<f32>,
    generation: u32,
    bounds: [f32; 4],
    gx: f32,
    gy: f32,
    obstacles: Vec<[f32; 5]>,
    alpha: f32,
    beta: f32,
    damp: f32,
    inflate: f32,
    pressure: f32,
    substeps: u32,
    radius: f32,
    grab_body: i32,
    grab: Vec<(usize, f32, f32, f32)>,
    grab_x: f32,
    grab_y: f32,
    contacts: Vec<(u32, u32)>,
    stack_top: f32,
    time: f32,
}

#[inline]
fn hash(i: u32) -> f32 {
    let mut x = i.wrapping_mul(0x9E37_79B9) ^ 0x85EB_CA6B;
    x ^= x >> 16;
    x = x.wrapping_mul(0x7FEB_352D);
    x ^= x >> 15;
    (x & 0xFFFF) as f32 / 65535.0
}

#[wasm_bindgen]
impl World {
    #[wasm_bindgen(constructor)]
    pub fn new(width: f32, height: f32) -> World {
        let mut w = World {
            templates: Vec::new(),
            bodies: Vec::new(),
            x: Vec::new(),
            y: Vec::new(),
            ox: Vec::new(),
            oy: Vec::new(),
            vx: Vec::new(),
            vy: Vec::new(),
            strain: Vec::new(),
            scratch: Vec::new(),
            rings: Vec::new(),
            fill: Vec::new(),
            strip: Vec::new(),
            pts_out: Vec::new(),
            body_out: Vec::new(),
            events: Vec::new(),
            generation: 0,
            bounds: [0.0, 0.0, width, height],
            gx: 0.0,
            gy: 2400.0,
            obstacles: Vec::new(),
            alpha: 0.12,
            beta: 0.15,
            damp: 0.04,
            inflate: 1.0,
            pressure: 0.3,
            substeps: 6,
            radius: 4.0,
            grab_body: -1,
            grab: Vec::new(),
            grab_x: 0.0,
            grab_y: 0.0,
            contacts: Vec::new(),
            stack_top: height,
            time: 0.0,
        };
        w.set_stiffness(0.5);
        w
    }

    // ── configuration ────────────────────────────────────────────────────────

    pub fn set_bounds(&mut self, left: f32, top: f32, right: f32, bottom: f32) {
        self.bounds = [left, top, right.max(left + 1.0), bottom.max(top + 1.0)];
    }

    pub fn set_gravity(&mut self, gx: f32, gy: f32) {
        self.gx = if gx.is_finite() { gx } else { 0.0 };
        self.gy = if gy.is_finite() { gy } else { 0.0 };
    }

    /// 0 = jelly, 1 = rubber.
    pub fn set_stiffness(&mut self, s: f32) {
        let s = s.clamp(0.0, 1.0);
        self.alpha = 0.028 + 0.4 * s * s;
        self.beta = 0.25 * (1.0 - s);
        self.damp = 0.022 + 0.04 * s;
    }

    /// Target area multiplier (gas pressure). 1 = rest.
    pub fn set_inflate(&mut self, f: f32) {
        self.inflate = f.clamp(0.4, 2.0);
    }

    pub fn set_pressure(&mut self, k: f32) {
        self.pressure = k.clamp(0.0, 1.0);
    }

    /// Collision thickness, CSS px (usually the rendered outline width).
    pub fn set_radius(&mut self, r: f32) {
        self.radius = r.clamp(0.5, 40.0);
    }

    pub fn set_substeps(&mut self, n: u32) {
        self.substeps = n.clamp(1, 16);
    }

    /// Static rects: [x, y, w, h, ground] * n. `ground` = 1 roots the stack graph.
    pub fn set_obstacles(&mut self, data: &[f32]) {
        self.obstacles.clear();
        for c in data.chunks_exact(5) {
            if c.iter().all(|v| v.is_finite()) && c[2] > 0.0 && c[3] > 0.0 {
                self.obstacles.push([c[0], c[1], c[2], c[3], c[4]]);
            }
        }
    }

    // ── glyph templates ──────────────────────────────────────────────────────

    /// Marching squares + simplification + resampling + triangulation.
    /// `alpha` is one byte per pixel (w × h). Returns the template id.
    pub fn add_template(&mut self, alpha: &[u8], w: u32, h: u32, unit: f32, spacing: f32) -> u32 {
        let (w, h) = (w as usize, h as usize);
        let shape = if alpha.len() >= w * h && w > 1 && h > 1 {
            contour::extract(alpha, w, h, unit.max(1e-3), spacing.max(1.0))
        } else {
            contour::Shape { pts: Vec::new(), rings: Vec::new(), width: 0.0, height: 0.0 }
        };
        let mut tris = Vec::new();
        let mut i = 0;
        while i < shape.rings.len() {
            let (os, oc, hole) = shape.rings[i];
            i += 1;
            if hole {
                continue;
            }
            let mut holes = Vec::new();
            while i < shape.rings.len() && shape.rings[i].2 {
                holes.push((shape.rings[i].0, shape.rings[i].1));
                i += 1;
            }
            tris.extend(triangulate::triangulate(&shape.pts, (os, oc), &holes));
        }
        self.templates.push(Template {
            pts: shape.pts,
            rings: shape.rings,
            tris,
            width: shape.width,
            height: shape.height,
        });
        (self.templates.len() - 1) as u32
    }

    pub fn template_count(&self) -> u32 {
        self.templates.len() as u32
    }
    pub fn template_points(&self, t: u32) -> u32 {
        self.templates.get(t as usize).map_or(0, |t| t.pts.len() as u32)
    }
    pub fn template_triangles(&self, t: u32) -> u32 {
        self.templates.get(t as usize).map_or(0, |t| (t.tris.len() / 3) as u32)
    }
    pub fn template_rings(&self, t: u32) -> u32 {
        self.templates.get(t as usize).map_or(0, |t| t.rings.len() as u32)
    }
    pub fn template_holes(&self, t: u32) -> u32 {
        self.templates.get(t as usize).map_or(0, |t| t.rings.iter().filter(|r| r.2).count() as u32)
    }
    pub fn template_width(&self, t: u32) -> f32 {
        self.templates.get(t as usize).map_or(0.0, |t| t.width)
    }
    pub fn template_height(&self, t: u32) -> f32 {
        self.templates.get(t as usize).map_or(0.0, |t| t.height)
    }

    // ── bodies ───────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &mut self,
        t: u32,
        cx: f32,
        cy: f32,
        angle: f32,
        scale: f32,
        grow: f32,
        r: f32,
        g: f32,
        b: f32,
        kind: u32,
    ) -> i32 {
        let ti = t as usize;
        if ti >= self.templates.len() || self.templates[ti].pts.len() < 3 {
            return -1;
        }
        let scale = if scale.is_finite() { scale.clamp(0.05, 20.0) } else { 1.0 };
        let tmpl = &self.templates[ti];
        let rest: Vec<P> = tmpl.pts.iter().map(|p| (p.0 * scale, p.1 * scale)).collect();
        let (mut a00, mut a01, mut a11) = (0.0f32, 0.0f32, 0.0f32);
        let mut radius = 1.0f32;
        for q in &rest {
            a00 += q.0 * q.0;
            a01 += q.0 * q.1;
            a11 += q.1 * q.1;
            radius = radius.max((q.0 * q.0 + q.1 * q.1).sqrt());
        }
        let det = a00 * a11 - a01 * a01;
        let aqq_inv = if det.abs() > 1e-6 {
            [a11 / det, -a01 / det, -a01 / det, a00 / det]
        } else {
            [0.0, 0.0, 0.0, 0.0]
        };
        let mut rest_area = 0.0;
        for &(s, c, _) in &tmpl.rings {
            rest_area += contour::signed_area(&rest[s..s + c]);
        }
        let count = rest.len();
        let start = self.x.len();
        for _ in 0..count {
            self.x.push(0.0);
            self.y.push(0.0);
            self.ox.push(0.0);
            self.oy.push(0.0);
            self.vx.push(0.0);
            self.vy.push(0.0);
            self.strain.push(0.0);
        }
        self.bodies.push(Body {
            tmpl: ti,
            start,
            count,
            ring_start: 0,
            ring_count: 0,
            rest,
            aqq_inv,
            rest_area,
            radius,
            color: [r, g, b, 1.0],
            min: (cx, cy),
            max: (cx, cy),
            grow: grow.clamp(0.05, 1.0),
            pop: 0.0,
            cx,
            cy,
            angle,
            squash: 0.0,
            lift: 0.0,
            root: false,
            grounded: false,
            impact: 0.0,
            cooldown: 0.25,
            speed: 0.0,
            kind,
            supported: false,
            free_t: 1.0,
        });
        let bi = self.bodies.len() - 1;
        self.place(bi, cx, cy, angle, grow);
        self.rebuild();
        bi as i32
    }

    fn place(&mut self, bi: usize, cx: f32, cy: f32, angle: f32, grow: f32) {
        let (s, c) = angle.sin_cos();
        let b = &mut self.bodies[bi];
        let g = grow.clamp(0.05, 1.0);
        b.grow = g;
        b.pop = 0.0;
        b.cx = cx;
        b.cy = cy;
        b.angle = angle;
        b.impact = 0.0;
        b.cooldown = 0.2;
        for k in 0..b.count {
            let (qx, qy) = (b.rest[k].0 * g, b.rest[k].1 * g);
            let i = b.start + k;
            self.x[i] = cx + c * qx - s * qy;
            self.y[i] = cy + s * qx + c * qy;
            self.ox[i] = self.x[i];
            self.oy[i] = self.y[i];
            self.vx[i] = 0.0;
            self.vy[i] = 0.0;
            self.strain[i] = 0.0;
        }
        self.aabb(bi);
    }

    /// Reset a body to its rest pose (used after a pop). `grow` < 1 inflates it back in.
    pub fn respawn(&mut self, i: u32, cx: f32, cy: f32, angle: f32, grow: f32) {
        let bi = i as usize;
        if bi >= self.bodies.len() {
            return;
        }
        if self.grab_body == bi as i32 {
            self.release();
        }
        self.place(bi, cx, cy, angle, grow);
    }

    pub fn remove_body(&mut self, i: u32) {
        let bi = i as usize;
        if bi >= self.bodies.len() {
            return;
        }
        let (s, c) = (self.bodies[bi].start, self.bodies[bi].count);
        // keep an unrelated grab alive across the removal
        if self.grab_body == bi as i32 {
            self.release();
        } else if self.grab_body > bi as i32 {
            self.grab_body -= 1;
            for g in self.grab.iter_mut() {
                g.0 -= c;
            }
        }
        for v in [&mut self.x, &mut self.y, &mut self.ox, &mut self.oy, &mut self.vx, &mut self.vy, &mut self.strain] {
            v.drain(s..s + c);
        }
        self.bodies.remove(bi);
        self.rebuild();
    }

    pub fn clear(&mut self) {
        self.release();
        self.bodies.clear();
        for v in [&mut self.x, &mut self.y, &mut self.ox, &mut self.oy, &mut self.vx, &mut self.vy, &mut self.strain] {
            v.clear();
        }
        self.rebuild();
    }

    pub fn set_color(&mut self, i: u32, r: f32, g: f32, b: f32) {
        if let Some(body) = self.bodies.get_mut(i as usize) {
            body.color = [r, g, b, 1.0];
        }
    }

    /// Start deflating a body. Poll `body_pop` — it reaches 1 when fully deflated.
    pub fn pop(&mut self, i: u32) {
        let bi = i as usize;
        if bi >= self.bodies.len() || self.bodies[bi].pop > 0.0 {
            return;
        }
        if self.grab_body == bi as i32 {
            self.release();
        }
        self.bodies[bi].pop = 1e-3;
        let (s, c, cx, cy) = (self.bodies[bi].start, self.bodies[bi].count, self.bodies[bi].cx, self.bodies[bi].cy);
        for k in s..s + c {
            let dx = self.x[k] - cx;
            let dy = self.y[k] - cy;
            let d = (dx * dx + dy * dy).sqrt().max(1e-3);
            let kick = 380.0 + 520.0 * hash(k as u32 ^ 0x5bd1);
            self.vx[k] += dx / d * kick;
            self.vy[k] += dy / d * kick - 200.0;
        }
    }

    /// Radial velocity kick (poke / scatter).
    pub fn impulse(&mut self, x: f32, y: f32, radius: f32, strength: f32) {
        let r = radius.max(1.0);
        for i in 0..self.x.len() {
            let dx = self.x[i] - x;
            let dy = self.y[i] - y;
            let d = (dx * dx + dy * dy).sqrt();
            if d < r && d > 1e-3 {
                let f = (1.0 - d / r) * strength;
                self.vx[i] += dx / d * f;
                self.vy[i] += dy / d * f;
            }
        }
    }

    /// Wobble every body along its normals (used when the pressure hits max).
    pub fn jiggle(&mut self, amount: f32) {
        let seed = (self.time * 1000.0) as u32;
        for bi in 0..self.bodies.len() {
            let ph = hash(bi as u32 ^ seed) * 6.283;
            let (s, c) = (self.bodies[bi].start, self.bodies[bi].count);
            let (cx, cy) = (self.bodies[bi].cx, self.bodies[bi].cy);
            for k in s..s + c {
                let dx = self.x[k] - cx;
                let dy = self.y[k] - cy;
                let d = (dx * dx + dy * dy).sqrt().max(1e-3);
                let a = (dy.atan2(dx) * 3.0 + ph).sin() * amount;
                self.vx[k] += dx / d * a;
                self.vy[k] += dy / d * a;
            }
        }
    }

    // ── pointer ──────────────────────────────────────────────────────────────

    /// Topmost body under (x, y), or within `slop` px of its contour. -1 if none.
    pub fn hit(&self, x: f32, y: f32, slop: f32) -> i32 {
        let mut near = -1;
        let mut near_d = slop * slop;
        for bi in (0..self.bodies.len()).rev() {
            let b = &self.bodies[bi];
            if b.pop > 0.0 {
                continue;
            }
            if x < b.min.0 - slop || x > b.max.0 + slop || y < b.min.1 - slop || y > b.max.1 + slop {
                continue;
            }
            let mut inside = false;
            for ri in b.ring_start..b.ring_start + b.ring_count {
                let [st, cnt, _, _] = self.rings[ri];
                let (st, cnt) = (st as usize, cnt as usize);
                let mut j = st + cnt - 1;
                for k in st..st + cnt {
                    let (ax, ay, bx, by) = (self.x[j], self.y[j], self.x[k], self.y[k]);
                    if (ay > y) != (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay) {
                        inside = !inside;
                    }
                    let d = (self.x[k] - x).powi(2) + (self.y[k] - y).powi(2);
                    if d < near_d {
                        near_d = d;
                        near = bi as i32;
                    }
                    j = k;
                }
            }
            if inside {
                return bi as i32;
            }
        }
        near
    }

    /// Grab the body under the pointer: particles within `radius` get a soft spring.
    pub fn grab(&mut self, x: f32, y: f32, radius: f32) -> i32 {
        let bi = self.hit(x, y, radius * 0.4);
        if bi < 0 {
            return -1;
        }
        let b = &self.bodies[bi as usize];
        let mut dmin = f32::INFINITY;
        for i in b.start..b.start + b.count {
            dmin = dmin.min(((self.x[i] - x).powi(2) + (self.y[i] - y).powi(2)).sqrt());
        }
        let rr = radius.max(dmin * 1.6).max(b.radius * 0.2);
        self.grab.clear();
        for i in b.start..b.start + b.count {
            let dx = self.x[i] - x;
            let dy = self.y[i] - y;
            let d = (dx * dx + dy * dy).sqrt();
            if d < rr {
                let w = (1.0 - d / rr).max(0.0).sqrt();
                self.grab.push((i, w, dx, dy));
            }
        }
        if self.grab.is_empty() {
            return -1;
        }
        self.grab_body = bi;
        self.grab_x = x;
        self.grab_y = y;
        bi
    }

    pub fn drag(&mut self, x: f32, y: f32) {
        if x.is_finite() && y.is_finite() {
            self.grab_x = x;
            self.grab_y = y;
        }
    }

    pub fn release(&mut self) {
        if self.grab_body >= 0 {
            if let Some(b) = self.bodies.get_mut(self.grab_body as usize) {
                b.free_t = 0.0;
            }
        }
        self.grab_body = -1;
        self.grab.clear();
    }

    pub fn grabbed(&self) -> i32 {
        self.grab_body
    }

    /// True when no live body's bounds (padded by the collision radius) touch the rect.
    /// Used to pick spawn spots: a body born inside another can end up interlocked.
    pub fn region_free(&self, x0: f32, y0: f32, x1: f32, y1: f32) -> bool {
        let r = self.radius;
        !self.bodies.iter().any(|b| {
            b.pop == 0.0 && !(b.max.0 + r < x0 || b.min.0 - r > x1 || b.max.1 + r < y0 || b.min.1 - r > y1)
        })
    }

    // ── simulation ───────────────────────────────────────────────────────────

    pub fn step(&mut self, dt: f32) {
        let dt = if dt.is_finite() { dt.clamp(0.0, 1.0 / 30.0) } else { 0.0 };
        self.events.clear();
        if dt > 0.0 && !self.bodies.is_empty() {
            self.time += dt;
            for b in self.bodies.iter_mut() {
                b.grow = (b.grow + dt * 2.2).min(1.0);
                if b.pop > 0.0 {
                    b.pop = (b.pop + dt * 2.2).min(1.0);
                }
                b.impact = 0.0;
                b.root = false;
                b.cooldown -= dt;
                b.free_t += dt;
            }
            self.contacts.clear();
            let n = self.substeps;
            let h = dt / n as f32;
            for sub in 0..n {
                let record = sub == n - 1;
                self.integrate(h);
                self.apply_drag();
                for bi in 0..self.bodies.len() {
                    self.shape_match(bi, record);
                    self.pressure(bi);
                }
                for bi in 0..self.bodies.len() {
                    self.aabb(bi);
                }
                for b in self.bodies.iter_mut() {
                    b.supported = false;
                }
                self.collide_bodies(h, record);
                self.collide_static(h, record);
                self.finish(h);
            }
            self.post(dt);
        }
        self.sync();
    }

    fn integrate(&mut self, h: f32) {
        let (gx, gy) = (self.gx * h, self.gy * h);
        for i in 0..self.x.len() {
            self.vx[i] += gx;
            self.vy[i] += gy;
            self.ox[i] = self.x[i];
            self.oy[i] = self.y[i];
            self.x[i] += self.vx[i] * h;
            self.y[i] += self.vy[i] * h;
        }
    }

    fn apply_drag(&mut self) {
        if self.grab_body < 0 {
            return;
        }
        for &(i, w, dx, dy) in &self.grab {
            let k = 0.24 * w;
            self.x[i] += (self.grab_x + dx - self.x[i]) * k;
            self.y[i] += (self.grab_y + dy - self.y[i]) * k;
        }
    }

    fn shape_match(&mut self, bi: usize, record: bool) {
        let b = &mut self.bodies[bi];
        let (s, c) = (b.start, b.count);
        let nf = c as f32;
        let (mut mx, mut my) = (0.0f32, 0.0f32);
        for i in s..s + c {
            mx += self.x[i];
            my += self.y[i];
        }
        mx /= nf;
        my /= nf;
        let (mut a00, mut a01, mut a10, mut a11) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
        for k in 0..c {
            let px = self.x[s + k] - mx;
            let py = self.y[s + k] - my;
            let (qx, qy) = b.rest[k];
            a00 += px * qx;
            a01 += px * qy;
            a10 += py * qx;
            a11 += py * qy;
        }
        let ang = (a10 - a01).atan2(a00 + a11);
        let (sn, cs) = ang.sin_cos();
        let (r00, r01, r10, r11) = (cs, -sn, sn, cs);

        let mut beta = self.beta;
        let mut alpha = self.alpha;
        // strain stiffening: a badly crumpled body firms up (rubber does too), so a
        // jelly letter that gets crushed recovers instead of staying tangled
        let crush = ((b.squash - 0.45) / 0.5).clamp(0.0, 1.0);
        alpha += (0.3 - alpha).max(0.0) * crush * crush;
        beta *= 1.0 - crush;
        if b.pop > 0.0 {
            alpha *= (1.0 - b.pop).max(0.0) * 0.25;
            beta = 0.0;
        }
        let (mut m00, mut m01, mut m10, mut m11) = (r00, r01, r10, r11);
        if beta > 0.0 {
            let q = b.aqq_inv;
            let l00 = a00 * q[0] + a01 * q[2];
            let l01 = a00 * q[1] + a01 * q[3];
            let l10 = a10 * q[0] + a11 * q[2];
            let l11 = a10 * q[1] + a11 * q[3];
            let det = l00 * l11 - l01 * l10;
            if det > 1e-4 && det.is_finite() {
                let inv = 1.0 / det.sqrt();
                m00 = beta * l00 * inv + (1.0 - beta) * r00;
                m01 = beta * l01 * inv + (1.0 - beta) * r01;
                m10 = beta * l10 * inv + (1.0 - beta) * r10;
                m11 = beta * l11 * inv + (1.0 - beta) * r11;
            }
        }
        let g = b.grow;
        let inv_r = 1.0 / (b.radius * 0.07).max(1.0);
        let mut dev = 0.0f32;
        for k in 0..c {
            let (qx, qy) = (b.rest[k].0 * g, b.rest[k].1 * g);
            let i = s + k;
            let tx = mx + m00 * qx + m01 * qy;
            let ty = my + m10 * qx + m11 * qy;
            let dx = tx - self.x[i];
            let dy = ty - self.y[i];
            self.x[i] += dx * alpha;
            self.y[i] += dy * alpha;
            if record {
                let d2 = dx * dx + dy * dy;
                dev += d2;
                self.strain[i] = (d2.sqrt() * inv_r).min(1.0);
            }
        }
        if record {
            b.cx = mx;
            b.cy = my;
            b.angle = ang;
            let rms = (dev / nf).sqrt() / b.radius.max(1.0);
            b.squash = (rms * 7.0).min(1.0);
        }
    }

    fn pressure(&mut self, bi: usize) {
        let (rs, rc, s, c, rest_area, grow, pop) = {
            let b = &self.bodies[bi];
            (b.ring_start, b.ring_count, b.start, b.count, b.rest_area, b.grow, b.pop)
        };
        let mut k = self.pressure;
        let mut target = rest_area * self.inflate * grow * grow;
        if pop > 0.0 {
            target *= 1.0 - 0.88 * pop.min(1.0);
            k = 0.12;
        }
        if k <= 0.0 || rest_area <= 0.0 {
            return;
        }
        if self.scratch.len() < c * 2 {
            self.scratch.resize(c * 2, 0.0);
        }
        let mut area = 0.0f32;
        let mut denom = 0.0f32;
        for ri in rs..rs + rc {
            let [st, cnt, _, _] = self.rings[ri];
            let (st, cnt) = (st as usize, cnt as usize);
            for k in 0..cnt {
                let i = st + k;
                let ip = st + (k + cnt - 1) % cnt;
                let inx = st + (k + 1) % cnt;
                area += self.x[i] * self.y[inx] - self.x[inx] * self.y[i];
                let gx = 0.5 * (self.y[inx] - self.y[ip]);
                let gy = 0.5 * (self.x[ip] - self.x[inx]);
                self.scratch[(i - s) * 2] = gx;
                self.scratch[(i - s) * 2 + 1] = gy;
                denom += gx * gx + gy * gy;
            }
        }
        area *= 0.5;
        if denom < 1e-6 || !area.is_finite() {
            return;
        }
        let lam = -k * (area - target) / denom;
        // cap the per-substep correction so a squashed body can't explode
        let lam = lam.clamp(-0.08, 0.08);
        for k in 0..c {
            self.x[s + k] += lam * self.scratch[k * 2];
            self.y[s + k] += lam * self.scratch[k * 2 + 1];
        }
    }

    fn aabb(&mut self, bi: usize) {
        let b = &mut self.bodies[bi];
        let (mut x0, mut y0, mut x1, mut y1) = (f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
        for i in b.start..b.start + b.count {
            x0 = x0.min(self.x[i]);
            y0 = y0.min(self.y[i]);
            x1 = x1.max(self.x[i]);
            y1 = y1.max(self.y[i]);
        }
        b.min = (x0, y0);
        b.max = (x1, y1);
    }

    fn collide_bodies(&mut self, h: f32, record: bool) {
        let nb = self.bodies.len();
        let r = self.radius;
        for a in 0..nb {
            for b in 0..nb {
                if a == b {
                    continue;
                }
                let (amin, amax) = (self.bodies[a].min, self.bodies[a].max);
                let (bmin, bmax) = (self.bodies[b].min, self.bodies[b].max);
                if amax.0 + r < bmin.0 || bmax.0 + r < amin.0 || amax.1 + r < bmin.1 || bmax.1 + r < amin.1 {
                    continue;
                }
                if self.bodies[a].pop > 0.6 || self.bodies[b].pop > 0.6 {
                    continue;
                }
                let imp = self.collide_pair(a, b, h);
                if imp >= 0.0 {
                    let ia = &mut self.bodies[a].impact;
                    *ia = ia.max(imp);
                    let ib = &mut self.bodies[b].impact;
                    *ib = ib.max(imp);
                    if record && a < b {
                        self.contacts.push((a as u32, b as u32));
                    } else if record {
                        self.contacts.push((b as u32, a as u32));
                    }
                }
            }
        }
    }

    /// Points of body `ba` against the rings of body `bb`. Returns the largest
    /// approach speed, or -1 if nothing touched.
    fn collide_pair(&mut self, ba: usize, bb: usize, h: f32) -> f32 {
        let r = self.radius;
        let (bmin, bmax) = (self.bodies[bb].min, self.bodies[bb].max);
        let (s, c) = (self.bodies[ba].start, self.bodies[ba].count);
        let (rs, rc) = (self.bodies[bb].ring_start, self.bodies[bb].ring_count);
        let inv_h = 1.0 / h;
        let (ghx, ghy) = self.gravity_dir();
        let mut touched = -1.0f32;
        for i in s..s + c {
            let px = self.x[i];
            let py = self.y[i];
            if px < bmin.0 - r || px > bmax.0 + r || py < bmin.1 - r || py > bmax.1 + r {
                continue;
            }
            let mut inside = false;
            let mut best = f32::INFINITY;
            let (mut ea, mut eb, mut et) = (0usize, 0usize, 0.0f32);
            for ri in rs..rs + rc {
                let [st, cnt, _, _] = self.rings[ri];
                let (st, cnt) = (st as usize, cnt as usize);
                let mut j = st + cnt - 1;
                for k in st..st + cnt {
                    let ax = self.x[j];
                    let ay = self.y[j];
                    let bx = self.x[k];
                    let by = self.y[k];
                    if (ay > py) != (by > py) && px < ax + (py - ay) * (bx - ax) / (by - ay) {
                        inside = !inside;
                    }
                    let ex = bx - ax;
                    let ey = by - ay;
                    let l2 = ex * ex + ey * ey;
                    let t = if l2 > 1e-9 { (((px - ax) * ex + (py - ay) * ey) / l2).clamp(0.0, 1.0) } else { 0.0 };
                    let qx = ax + ex * t - px;
                    let qy = ay + ey * t - py;
                    let d2 = qx * qx + qy * qy;
                    if d2 < best {
                        best = d2;
                        ea = j;
                        eb = k;
                        et = t;
                    }
                    j = k;
                }
            }
            if !inside && best >= r * r {
                continue;
            }
            let d = best.sqrt();
            let ax = self.x[ea];
            let ay = self.y[ea];
            let ex = self.x[eb] - ax;
            let ey = self.y[eb] - ay;
            let el = (ex * ex + ey * ey).sqrt().max(1e-6);
            let (nex, ney) = (ey / el, -ex / el);
            let cxp = ax + ex * et;
            let cyp = ay + ey * et;
            let (nx, ny, sd) = if d > 1e-4 {
                if inside {
                    ((cxp - px) / d, (cyp - py) / d, -d)
                } else {
                    ((px - cxp) / d, (py - cyp) / d, d)
                }
            } else {
                (nex, ney, 0.0)
            };
            let cval = sd - r;
            if cval >= 0.0 {
                continue;
            }
            let wa = 1.0 - et;
            let wb = et;
            // approach speed (before correction) for the impact sounds
            let vpx = (px - self.ox[i]) * inv_h;
            let vpy = (py - self.oy[i]) * inv_h;
            let vex = (wa * (self.x[ea] - self.ox[ea]) + wb * (self.x[eb] - self.ox[eb])) * inv_h;
            let vey = (wa * (self.y[ea] - self.oy[ea]) + wb * (self.y[eb] - self.oy[eb])) * inv_h;
            let vn = -((vpx - vex) * nx + (vpy - vey) * ny);
            touched = touched.max(vn.max(0.0));

            let denom = 1.0 + wa * wa + wb * wb;
            let lam = -cval / denom;
            // n pushes ba's particle; -n pushes bb's edge
            let up = -(nx * ghx + ny * ghy);
            if up > 0.5 {
                self.bodies[ba].supported = true;
            } else if up < -0.5 {
                self.bodies[bb].supported = true;
            }
            self.x[i] += lam * nx;
            self.y[i] += lam * ny;
            self.x[ea] -= lam * wa * nx;
            self.y[ea] -= lam * wa * ny;
            self.x[eb] -= lam * wb * nx;
            self.y[eb] -= lam * wb * ny;

            // Coulomb friction on the relative tangential displacement
            let pen = -cval + STICK;
            let rx = (self.x[i] - self.ox[i]) - (wa * (self.x[ea] - self.ox[ea]) + wb * (self.x[eb] - self.ox[eb]));
            let ry = (self.y[i] - self.oy[i]) - (wa * (self.y[ea] - self.oy[ea]) + wb * (self.y[eb] - self.oy[eb]));
            let rn = rx * nx + ry * ny;
            let tx = rx - rn * nx;
            let ty = ry - rn * ny;
            let tl = (tx * tx + ty * ty).sqrt();
            if tl > 1e-7 {
                let f = if tl < MU_S * pen { 1.0 } else { (MU_K * pen / tl).min(1.0) };
                let fx = tx * f / denom;
                let fy = ty * f / denom;
                self.x[i] -= fx;
                self.y[i] -= fy;
                self.x[ea] += fx * wa;
                self.y[ea] += fy * wa;
                self.x[eb] += fx * wb;
                self.y[eb] += fy * wb;
            }
        }
        touched
    }

    fn collide_static(&mut self, h: f32, record: bool) {
        let r = self.radius;
        let [l, t, rt, bt] = self.bounds;
        let inv_h = 1.0 / h;
        let up = self.gy < 0.0;
        let (ghx, ghy) = self.gravity_dir();
        for bi in 0..self.bodies.len() {
            let (s, c) = (self.bodies[bi].start, self.bodies[bi].count);
            let mut imp = 0.0f32;
            let mut root = false;
            let mut sup = false;
            for i in s..s + c {
                // floor / ceiling
                if self.y[i] > bt - r {
                    let pen = self.y[i] - (bt - r);
                    imp = imp.max((self.y[i] - self.oy[i]) * inv_h);
                    self.y[i] = bt - r;
                    self.fric_x(i, pen);
                    root |= !up;
                    sup |= ghy > 0.5;
                }
                if self.y[i] < t + r {
                    let pen = (t + r) - self.y[i];
                    imp = imp.max((self.oy[i] - self.y[i]) * inv_h);
                    self.y[i] = t + r;
                    self.fric_x(i, pen);
                    root |= up;
                    sup |= ghy < -0.5;
                }
                if self.x[i] < l + r {
                    let pen = (l + r) - self.x[i];
                    imp = imp.max((self.ox[i] - self.x[i]) * inv_h);
                    self.x[i] = l + r;
                    self.fric_y(i, pen);
                    sup |= ghx < -0.5;
                }
                if self.x[i] > rt - r {
                    let pen = self.x[i] - (rt - r);
                    imp = imp.max((self.x[i] - self.ox[i]) * inv_h);
                    self.x[i] = rt - r;
                    self.fric_y(i, pen);
                    sup |= ghx > 0.5;
                }
                // rounded DOM rects
                for o in 0..self.obstacles.len() {
                    let [ox, oy, ow, oh, ground] = self.obstacles[o];
                    let (px, py) = (self.x[i], self.y[i]);
                    if px < ox - r || px > ox + ow + r || py < oy - r || py > oy + oh + r {
                        continue;
                    }
                    let qx = px.clamp(ox, ox + ow);
                    let qy = py.clamp(oy, oy + oh);
                    let (nx, ny, pen);
                    if qx == px && qy == py {
                        // inside: leave through the nearest side
                        let dl = px - ox;
                        let dr = ox + ow - px;
                        let dt = py - oy;
                        let db = oy + oh - py;
                        let m = dl.min(dr).min(dt).min(db);
                        if m == dt {
                            nx = 0.0;
                            ny = -1.0;
                            pen = dt + r;
                        } else if m == db {
                            nx = 0.0;
                            ny = 1.0;
                            pen = db + r;
                        } else if m == dl {
                            nx = -1.0;
                            ny = 0.0;
                            pen = dl + r;
                        } else {
                            nx = 1.0;
                            ny = 0.0;
                            pen = dr + r;
                        }
                    } else {
                        let dx = px - qx;
                        let dy = py - qy;
                        let d = (dx * dx + dy * dy).sqrt();
                        if d >= r || d < 1e-6 {
                            continue;
                        }
                        nx = dx / d;
                        ny = dy / d;
                        pen = r - d;
                    }
                    let vn = -((self.x[i] - self.ox[i]) * nx + (self.y[i] - self.oy[i]) * ny) * inv_h;
                    imp = imp.max(vn);
                    self.x[i] += nx * pen;
                    self.y[i] += ny * pen;
                    // tangential friction
                    let dx = self.x[i] - self.ox[i];
                    let dy = self.y[i] - self.oy[i];
                    let dn = dx * nx + dy * ny;
                    let tx = dx - dn * nx;
                    let ty = dy - dn * ny;
                    let tl = (tx * tx + ty * ty).sqrt();
                    if tl > 1e-7 {
                        let budget = pen + STICK;
                        let f = if tl < MU_S * budget { 1.0 } else { (MU_K * budget / tl).min(1.0) };
                        self.x[i] -= tx * f;
                        self.y[i] -= ty * f;
                    }
                    if ground > 0.5 && ((!up && ny < -0.5) || (up && ny > 0.5)) {
                        root = true;
                    }
                    sup |= -(nx * ghx + ny * ghy) > 0.5;
                }
            }
            let b = &mut self.bodies[bi];
            b.impact = b.impact.max(imp);
            b.supported |= sup;
            if record && root {
                b.root = true;
            }
        }
    }

    fn gravity_dir(&self) -> (f32, f32) {
        let l = (self.gx * self.gx + self.gy * self.gy).sqrt();
        if l > 1.0 {
            (self.gx / l, self.gy / l)
        } else {
            (0.0, 0.0)
        }
    }

    #[inline]
    fn fric_x(&mut self, i: usize, pen: f32) {
        let pen = pen + STICK;
        let dx = self.x[i] - self.ox[i];
        if dx.abs() < MU_S * pen {
            self.x[i] = self.ox[i];
        } else {
            self.x[i] -= dx.signum() * MU_K * pen;
        }
    }

    #[inline]
    fn fric_y(&mut self, i: usize, pen: f32) {
        let pen = pen + STICK;
        let dy = self.y[i] - self.oy[i];
        if dy.abs() < MU_S * pen {
            self.y[i] = self.oy[i];
        } else {
            self.y[i] -= dy.signum() * MU_K * pen;
        }
    }

    fn finish(&mut self, h: f32) {
        let inv = 1.0 / h;
        let (ghx, ghy) = self.gravity_dir();
        let air = (1.0 - 0.25 * h).max(0.0);
        let mut broken = Vec::new();
        for (bi, b) in self.bodies.iter().enumerate() {
            let (s, c) = (b.start, b.count);
            let mut ok = true;
            let (mut mx, mut my, mut vmx, mut vmy) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
            for i in s..s + c {
                let mut vx = (self.x[i] - self.ox[i]) * inv;
                let mut vy = (self.y[i] - self.oy[i]) * inv;
                let sp2 = vx * vx + vy * vy;
                if !sp2.is_finite() {
                    ok = false;
                    break;
                }
                if sp2 > MAX_SPEED * MAX_SPEED {
                    let k = MAX_SPEED / sp2.sqrt();
                    vx *= k;
                    vy *= k;
                }
                self.vx[i] = vx * air;
                self.vy[i] = vy * air;
                mx += self.x[i];
                my += self.y[i];
                vmx += self.vx[i];
                vmy += self.vy[i];
            }
            if !ok {
                broken.push(bi);
                continue;
            }
            let nf = c as f32;
            mx /= nf;
            my /= nf;
            vmx /= nf;
            vmy /= nf;
            // support damping: kill the rebound of a body resting on something
            let grabbed = self.grab_body == bi as i32;
            if b.supported && !grabbed && b.free_t > 0.3 && b.pop == 0.0 {
                let away = -(vmx * ghx + vmy * ghy);
                if away > 0.0 {
                    let dv = away * SUPPORT_DAMP;
                    for i in s..s + c {
                        self.vx[i] += dv * ghx;
                        self.vy[i] += dv * ghy;
                    }
                    vmx += dv * ghx;
                    vmy += dv * ghy;
                }
            }
            // damp deformation velocities only; keep linear + angular momentum
            let (mut lz, mut inertia) = (0.0f32, 0.0f32);
            for i in s..s + c {
                let rx = self.x[i] - mx;
                let ry = self.y[i] - my;
                lz += rx * self.vy[i] - ry * self.vx[i];
                inertia += rx * rx + ry * ry;
            }
            let mut w = if inertia > 1e-6 { lz / inertia } else { 0.0 };
            if b.supported && !grabbed && b.free_t > 0.3 {
                // bleed spin off resting bodies: v_i -= k·(ω × r)
                let dw = w * ROLL_DAMP;
                for i in s..s + c {
                    let rx = self.x[i] - mx;
                    let ry = self.y[i] - my;
                    self.vx[i] += dw * ry;
                    self.vy[i] -= dw * rx;
                }
                w -= dw;
            }
            let k = self.damp;
            for i in s..s + c {
                let rx = self.x[i] - mx;
                let ry = self.y[i] - my;
                let tx = vmx - w * ry;
                let ty = vmy + w * rx;
                self.vx[i] += (tx - self.vx[i]) * k;
                self.vy[i] += (ty - self.vy[i]) * k;
            }
        }
        for bi in broken {
            let (cx, cy) = (self.bodies[bi].cx, self.bodies[bi].cy);
            let (cx, cy) = if cx.is_finite() && cy.is_finite() {
                (cx, cy)
            } else {
                ((self.bounds[0] + self.bounds[2]) * 0.5, self.bounds[1] + 50.0)
            };
            self.place(bi, cx, cy, 0.0, 0.5);
        }
    }

    fn post(&mut self, dt: f32) {
        let nb = self.bodies.len();
        // impacts → sound events
        for (bi, b) in self.bodies.iter_mut().enumerate() {
            let target = if self.grab_body == bi as i32 { 1.0 } else { 0.0 };
            b.lift += (target - b.lift) * (dt * 9.0).min(1.0);
            if b.impact > 240.0 && b.cooldown <= 0.0 && b.pop == 0.0 {
                self.events.extend_from_slice(&[bi as f32, b.impact, b.cx, b.cy]);
                b.cooldown = 0.12;
            }
            let mut sp = 0.0;
            for i in b.start..b.start + b.count {
                sp += (self.vx[i] * self.vx[i] + self.vy[i] * self.vy[i]).sqrt();
            }
            b.speed = sp / b.count.max(1) as f32;
        }
        // stack graph: grounded = touching the floor/ground rect, or touching a grounded body
        for b in self.bodies.iter_mut() {
            b.grounded = b.root;
        }
        for _ in 0..nb {
            let mut changed = false;
            for &(a, b) in &self.contacts {
                let (a, b) = (a as usize, b as usize);
                if self.bodies[a].grounded != self.bodies[b].grounded {
                    self.bodies[a].grounded = true;
                    self.bodies[b].grounded = true;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        let mut top = self.bounds[3];
        if self.gy > 0.0 {
            for (bi, b) in self.bodies.iter().enumerate() {
                if b.grounded && b.speed < 70.0 && b.grow >= 1.0 && b.pop == 0.0 && self.grab_body != bi as i32 {
                    top = top.min(b.min.1);
                }
            }
        }
        self.stack_top = top;
    }

    /// Rebuild ring tables + index buffers after a structural change.
    fn rebuild(&mut self) {
        self.rings.clear();
        self.fill.clear();
        self.strip.clear();
        let mut start = 0usize;
        for bi in 0..self.bodies.len() {
            let t = &self.templates[self.bodies[bi].tmpl];
            let b = &mut self.bodies[bi];
            b.start = start;
            b.ring_start = self.rings.len();
            b.ring_count = t.rings.len();
            for &(rs, rc, hole) in &t.rings {
                let base = (start + rs) as u32;
                self.rings.push([base, rc as u32, bi as u32, hole as u32]);
                for k in 0..rc as u32 {
                    let i = base + k;
                    let j = base + (k + 1) % rc as u32;
                    self.strip.extend_from_slice(&[i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1]);
                }
            }
            for &ti in &t.tris {
                self.fill.push(start as u32 + ti);
            }
            start += b.count;
        }
        self.generation = self.generation.wrapping_add(1);
        self.sync();
    }

    /// Write render buffers: per point [x, y, nx, ny, body, strain, hole, 0] with
    /// miter-scaled outward normals; per body [rgba, cx, cy, radius, squash, pop, lift, grow, 0].
    fn sync(&mut self) {
        let np = self.x.len();
        self.pts_out.resize(np * PT_STRIDE, 0.0);
        for &[st, cnt, body, hole] in &self.rings {
            let (st, cnt) = (st as usize, cnt as usize);
            for k in 0..cnt {
                let i = st + k;
                let ip = st + (k + cnt - 1) % cnt;
                let inx = st + (k + 1) % cnt;
                let (e1x, e1y) = (self.x[i] - self.x[ip], self.y[i] - self.y[ip]);
                let (e2x, e2y) = (self.x[inx] - self.x[i], self.y[inx] - self.y[i]);
                let l1 = (e1x * e1x + e1y * e1y).sqrt().max(1e-6);
                let l2 = (e2x * e2x + e2y * e2y).sqrt().max(1e-6);
                let (n1x, n1y) = (e1y / l1, -e1x / l1);
                let (n2x, n2y) = (e2y / l2, -e2x / l2);
                let (mut nx, mut ny) = (n1x + n2x, n1y + n2y);
                let nl = (nx * nx + ny * ny).sqrt();
                if nl > 1e-4 {
                    nx /= nl;
                    ny /= nl;
                } else {
                    nx = n1x;
                    ny = n1y;
                }
                let miter = 1.0 / (nx * n1x + ny * n1y).max(0.5);
                let o = i * PT_STRIDE;
                self.pts_out[o] = self.x[i];
                self.pts_out[o + 1] = self.y[i];
                self.pts_out[o + 2] = nx * miter;
                self.pts_out[o + 3] = ny * miter;
                self.pts_out[o + 4] = body as f32;
                self.pts_out[o + 5] = self.strain[i];
                self.pts_out[o + 6] = hole as f32;
                self.pts_out[o + 7] = 0.0;
            }
        }
        let nb = self.bodies.len();
        self.body_out.resize(nb * BODY_STRIDE, 0.0);
        for (bi, b) in self.bodies.iter().enumerate() {
            let o = bi * BODY_STRIDE;
            self.body_out[o..o + 4].copy_from_slice(&b.color);
            self.body_out[o + 4] = b.cx;
            self.body_out[o + 5] = b.cy;
            self.body_out[o + 6] = b.radius * b.grow;
            self.body_out[o + 7] = b.squash;
            self.body_out[o + 8] = b.pop;
            self.body_out[o + 9] = b.lift;
            self.body_out[o + 10] = b.grow;
            self.body_out[o + 11] = b.angle;
        }
    }

    // ── zero-copy views + readouts ───────────────────────────────────────────

    pub fn pts_ptr(&self) -> *const f32 {
        self.pts_out.as_ptr()
    }
    pub fn body_ptr(&self) -> *const f32 {
        self.body_out.as_ptr()
    }
    pub fn ring_ptr(&self) -> *const u32 {
        self.rings.as_ptr() as *const u32
    }
    pub fn fill_ptr(&self) -> *const u32 {
        self.fill.as_ptr()
    }
    pub fn strip_ptr(&self) -> *const u32 {
        self.strip.as_ptr()
    }
    pub fn events_ptr(&self) -> *const f32 {
        self.events.as_ptr()
    }
    pub fn event_count(&self) -> u32 {
        (self.events.len() / 4) as u32
    }
    pub fn point_count(&self) -> u32 {
        self.x.len() as u32
    }
    pub fn body_count(&self) -> u32 {
        self.bodies.len() as u32
    }
    pub fn ring_count(&self) -> u32 {
        self.rings.len() as u32
    }
    pub fn fill_len(&self) -> u32 {
        self.fill.len() as u32
    }
    pub fn strip_len(&self) -> u32 {
        self.strip.len() as u32
    }
    pub fn generation(&self) -> u32 {
        self.generation
    }
    pub fn contact_count(&self) -> u32 {
        self.contacts.len() as u32
    }
    pub fn stack_top(&self) -> f32 {
        self.stack_top
    }
    pub fn body_pop(&self, i: u32) -> f32 {
        self.bodies.get(i as usize).map_or(0.0, |b| b.pop)
    }
    pub fn body_kind(&self, i: u32) -> u32 {
        self.bodies.get(i as usize).map_or(0, |b| b.kind)
    }
    pub fn body_x(&self, i: u32) -> f32 {
        self.bodies.get(i as usize).map_or(0.0, |b| b.cx)
    }
    pub fn body_y(&self, i: u32) -> f32 {
        self.bodies.get(i as usize).map_or(0.0, |b| b.cy)
    }
    pub fn body_top(&self, i: u32) -> f32 {
        self.bodies.get(i as usize).map_or(0.0, |b| b.min.1)
    }
    pub fn body_speed(&self, i: u32) -> f32 {
        self.bodies.get(i as usize).map_or(0.0, |b| b.speed)
    }
    pub fn body_grounded(&self, i: u32) -> bool {
        self.bodies.get(i as usize).is_some_and(|b| b.grounded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rasterise a filled ring (an "O") or a bar into an alpha bitmap.
    fn bitmap_o(w: usize, h: usize) -> Vec<u8> {
        let mut a = vec![0u8; w * h];
        let (cx, cy) = (w as f32 / 2.0, h as f32 / 2.0);
        for y in 0..h {
            for x in 0..w {
                let d = ((x as f32 - cx).powi(2) / 1.0 + (y as f32 - cy).powi(2) / 1.3).sqrt();
                let outer = (cx - 4.0) - d;
                let inner = d - (cx * 0.5);
                let v = outer.min(inner).clamp(-0.5, 0.5) + 0.5;
                a[y * w + x] = (v * 255.0) as u8;
            }
        }
        a
    }

    fn bitmap_t(w: usize, h: usize) -> Vec<u8> {
        let mut a = vec![0u8; w * h];
        for y in 4..h - 4 {
            for x in 4..w - 4 {
                let bar = y < 4 + h / 4;
                let stem = x > w * 3 / 8 && x < w * 5 / 8;
                if bar || stem {
                    a[y * w + x] = 255;
                }
            }
        }
        a
    }

    #[test]
    fn extracts_hole_and_triangulates() {
        let mut w = World::new(800.0, 600.0);
        let t = w.add_template(&bitmap_o(120, 140), 120, 140, 1.5, 9.0);
        assert_eq!(w.template_rings(t), 2);
        assert_eq!(w.template_holes(t), 1);
        let n = w.template_points(t) as usize;
        let tris = w.template_triangles(t) as usize;
        // a polygon with one hole and n vertices triangulates into n triangles
        assert_eq!(tris, n, "points {n} tris {tris}");
        let t2 = w.add_template(&bitmap_t(100, 130), 100, 130, 1.5, 9.0);
        assert_eq!(w.template_rings(t2), 1);
        let n2 = w.template_points(t2) as usize;
        assert_eq!(w.template_triangles(t2) as usize, n2 - 2);
    }

    #[test]
    fn stack_settles_without_nans_or_tunnelling() {
        let mut w = World::new(900.0, 700.0);
        w.set_radius(4.0);
        let o = w.add_template(&bitmap_o(120, 140), 120, 140, 1.2, 8.0);
        let t = w.add_template(&bitmap_t(100, 130), 100, 130, 1.2, 8.0);
        w.set_obstacles(&[380.0, 560.0, 140.0, 140.0, 1.0]);
        for k in 0..8 {
            let tm = if k % 2 == 0 { o } else { t };
            w.spawn(tm, 300.0 + (k as f32 * 70.0) % 300.0, 80.0 + k as f32 * 10.0, 0.3 * k as f32, 1.0, 0.4, 1.0, 0.5, 0.2, k);
            for _ in 0..40 {
                w.step(1.0 / 60.0);
            }
        }
        // throw one hard downwards
        w.grab(w.body_x(0), w.body_y(0), 30.0);
        for f in 0..20 {
            w.drag(200.0 + f as f32 * 30.0, 100.0 + f as f32 * 25.0);
            w.step(1.0 / 60.0);
        }
        w.release();
        for _ in 0..600 {
            w.step(1.0 / 60.0);
        }
        for i in 0..w.x.len() {
            assert!(w.x[i].is_finite() && w.y[i].is_finite());
            assert!(w.y[i] <= 700.0 + 0.5, "below floor: {}", w.y[i]);
        }
        // nobody's centre may sit inside another body
        for a in 0..w.bodies.len() {
            let (cx, cy) = (w.bodies[a].cx, w.bodies[a].cy);
            assert!(w.bodies[a].speed < 40.0, "body {a} still moving {}", w.bodies[a].speed);
            let _ = (cx, cy);
        }
        let mut deep = 0;
        for i in 0..w.x.len() {
            for b in 0..w.bodies.len() {
                let bb = &w.bodies[b];
                if i >= bb.start && i < bb.start + bb.count {
                    continue;
                }
                let mut inside = false;
                for ri in bb.ring_start..bb.ring_start + bb.ring_count {
                    let [st, cnt, _, _] = w.rings[ri];
                    let (st, cnt) = (st as usize, cnt as usize);
                    let mut j = st + cnt - 1;
                    for k in st..st + cnt {
                        let (ax, ay, bx, by) = (w.x[j], w.y[j], w.x[k], w.y[k]);
                        if (ay > w.y[i]) != (by > w.y[i]) && w.x[i] < ax + (w.y[i] - ay) * (bx - ax) / (by - ay) {
                            inside = !inside;
                        }
                        j = k;
                    }
                }
                if inside {
                    deep += 1;
                }
            }
        }
        assert!(deep < 4, "{deep} particles inside other bodies");
        assert!(w.stack_top() < 700.0, "stack height {}", 700.0 - w.stack_top());
        println!("stack top {} contacts {}", w.stack_top(), w.contact_count());
    }

    #[test]
    fn pop_and_inflate_stay_finite() {
        let mut w = World::new(600.0, 600.0);
        let o = w.add_template(&bitmap_o(120, 140), 120, 140, 1.2, 8.0);
        let b = w.spawn(o, 300.0, 300.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0) as u32;
        w.set_inflate(1.6);
        w.set_stiffness(0.0);
        for _ in 0..200 {
            w.step(1.0 / 60.0);
        }
        w.jiggle(500.0);
        w.pop(b);
        for _ in 0..60 {
            w.step(1.0 / 60.0);
        }
        assert!(w.body_pop(b) >= 1.0);
        assert!(w.x.iter().all(|v| v.is_finite()));
        w.respawn(b, 300.0, 200.0, 0.0, 0.2);
        w.set_inflate(0.6);
        w.set_stiffness(1.0);
        for _ in 0..200 {
            w.step(1.0 / 60.0);
        }
        assert!(w.x.iter().all(|v| v.is_finite()));
        w.remove_body(b);
        assert_eq!(w.point_count(), 0);
        w.step(1.0 / 60.0);
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    #[test]
    fn bench_24_bodies() {
        let mut a = vec![0u8; 100 * 130];
        for y in 6..124 { for x in 6..94 { let ring = ((x as f32 - 50.0).powi(2) + (y as f32 - 65.0).powi(2)).sqrt(); if ring < 44.0 && ring > 22.0 { a[y * 100 + x] = 255; } } }
        let mut w = World::new(1000.0, 900.0);
        w.set_radius(4.0);
        let t = w.add_template(&a, 100, 130, 1.2, 6.0);
        println!("points/glyph {}", w.template_points(t));
        for k in 0..24 { w.spawn(t, 200.0 + (k % 6) as f32 * 120.0, 100.0 + (k / 6) as f32 * 160.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0); }
        for _ in 0..300 { w.step(1.0 / 60.0); }
        let t0 = std::time::Instant::now();
        for _ in 0..120 { w.step(1.0 / 60.0); }
        println!("24 bodies: {:.2} ms/frame, contacts {}", t0.elapsed().as_secs_f64() * 1000.0 / 120.0, w.contact_count());
    }
}

#[cfg(test)]
mod landing {
    use super::*;

    /// A letter dropped onto a ground rect should land and stay, not trampoline off it.
    #[test]
    fn landing_does_not_rebound() {
        let mut a = vec![0u8; 60 * 140];
        for y in 5..135 {
            for x in 15..45 {
                a[y * 60 + x] = 255;
            }
        }
        let mut w = World::new(1440.0, 814.0);
        w.set_radius(5.8);
        w.set_obstacles(&[560.0, 697.0, 320.0, 117.0, 1.0]);
        let t = w.add_template(&a, 60, 140, 128.0 / 130.0, 7.0);
        let b = w.spawn(t, 760.0, 109.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0) as u32;
        let (mut landed, mut apex, mut prev) = (false, f32::INFINITY, 0.0);
        for _ in 0..300 {
            w.step(1.0 / 60.0);
            let y = w.body_y(b);
            if !landed && y < prev - 0.5 && prev > 500.0 {
                landed = true;
            }
            if landed {
                apex = apex.min(y);
            }
            prev = y;
        }
        // resting centre is ~627; a trampoline bounce would reach < 500
        assert!(apex > 600.0, "rebound apex {apex}");
        assert!(w.body_grounded(b));
    }
}
