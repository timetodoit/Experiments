//! Constructive solid geometry built from signed-distance primitives.
//!
//! The scene SDF is   sdf(p) = min( max( ∪ solids, −∪ cuts ), ground(p) )
//!
//! Surface sampling: instead of throwing random points into the bounding box and
//! hoping they land within |sdf| < ε (acceptance ≈ 0.1 % for thin shells), we draw
//! candidates *on the faces of every primitive* (area-weighted) and keep a
//! candidate only if the CSG SDF changes sign across it — i.e. the point a hair
//! inside is material and the point a hair outside is air. That is exactly the
//! zero set of the combined SDF, and the face we sampled gives us the exact
//! normal for free. Each primitive carries a neighbour list (primitives whose
//! AABBs overlap its own, expanded by a margin) so a test touches ~6 primitives
//! instead of ~80.

use crate::noise::Rng;

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Box,
    CylY,
    CylZ,
}

#[derive(Clone, Copy)]
pub struct Prim {
    pub kind: Kind,
    pub c: [f32; 3],
    /// Box: half extents. CylY: (r, half height, r). CylZ: (r, r, half length).
    pub e: [f32; 3],
    cs: f32,
    sn: f32,
    pub refl: f32,
    pub cut: bool,
    aligned: bool,
    lo: [f32; 3],
    hi: [f32; 3],
}

#[inline]
fn len2(x: f32, y: f32) -> f32 {
    (x * x + y * y).sqrt()
}

impl Prim {
    fn make(kind: Kind, c: [f32; 3], e: [f32; 3], refl: f32) -> Prim {
        let mut p = Prim { kind, c, e, cs: 1.0, sn: 0.0, refl, cut: false, aligned: kind == Kind::Box, lo: [0.0; 3], hi: [0.0; 3] };
        p.finish();
        p
    }
    pub fn bx(c: [f32; 3], e: [f32; 3], refl: f32) -> Prim {
        Prim::make(Kind::Box, c, e, refl)
    }
    pub fn cyl_y(c: [f32; 3], r: f32, hh: f32, refl: f32) -> Prim {
        Prim::make(Kind::CylY, c, [r, hh, r], refl)
    }
    pub fn cyl_z(c: [f32; 3], r: f32, hl: f32, refl: f32) -> Prim {
        Prim::make(Kind::CylZ, c, [r, r, hl], refl)
    }
    /// Rotate a box about the world Y axis.
    pub fn yaw(mut self, a: f32) -> Prim {
        self.cs = a.cos();
        self.sn = a.sin();
        self.aligned = false;
        self.finish();
        self
    }
    pub fn as_cut(mut self) -> Prim {
        self.cut = true;
        self
    }

    fn finish(&mut self) {
        let (ex, ey, ez) = (self.e[0], self.e[1], self.e[2]);
        let wx = self.cs.abs() * ex + self.sn.abs() * ez;
        let wz = self.sn.abs() * ex + self.cs.abs() * ez;
        let w = [wx, ey, wz];
        for k in 0..3 {
            self.lo[k] = self.c[k] - w[k];
            self.hi[k] = self.c[k] + w[k];
        }
    }

    #[inline]
    fn local(&self, p: &[f32; 3]) -> [f32; 3] {
        let dx = p[0] - self.c[0];
        let dy = p[1] - self.c[1];
        let dz = p[2] - self.c[2];
        [self.cs * dx + self.sn * dz, dy, -self.sn * dx + self.cs * dz]
    }

    #[inline]
    fn to_world_dir(&self, v: [f32; 3]) -> [f32; 3] {
        [self.cs * v[0] - self.sn * v[2], v[1], self.sn * v[0] + self.cs * v[2]]
    }

    #[inline]
    pub fn contains(&self, p: &[f32; 3]) -> bool {
        // branch-free AABB test; for axis-aligned boxes it is the whole answer
        let in_box = (p[0] > self.lo[0]) & (p[0] < self.hi[0]) & (p[1] > self.lo[1]) & (p[1] < self.hi[1]) & (p[2] > self.lo[2]) & (p[2] < self.hi[2]);
        if !in_box || self.aligned {
            return in_box;
        }
        let l = self.local(p);
        match self.kind {
            Kind::Box => l[0].abs() < self.e[0] && l[1].abs() < self.e[1] && l[2].abs() < self.e[2],
            Kind::CylY => l[0] * l[0] + l[2] * l[2] < self.e[0] * self.e[0] && l[1].abs() < self.e[1],
            Kind::CylZ => l[0] * l[0] + l[1] * l[1] < self.e[0] * self.e[0] && l[2].abs() < self.e[2],
        }
    }

    /// Squared distance from p to the primitive's world AABB (0 inside).
    #[inline]
    pub fn aabb_dist2(&self, p: &[f32; 3]) -> f32 {
        let mut d2 = 0.0;
        for k in 0..3 {
            let v = (self.lo[k] - p[k]).max(p[k] - self.hi[k]).max(0.0);
            d2 += v * v;
        }
        d2
    }

    /// Exact signed distance.
    #[inline]
    pub fn sdf(&self, p: &[f32; 3]) -> f32 {
        let l = self.local(p);
        match self.kind {
            Kind::Box => {
                let qx = l[0].abs() - self.e[0];
                let qy = l[1].abs() - self.e[1];
                let qz = l[2].abs() - self.e[2];
                let ox = qx.max(0.0);
                let oy = qy.max(0.0);
                let oz = qz.max(0.0);
                (ox * ox + oy * oy + oz * oz).sqrt() + qx.max(qy.max(qz)).min(0.0)
            }
            Kind::CylY => {
                let dx = len2(l[0], l[2]) - self.e[0];
                let dy = l[1].abs() - self.e[1];
                dx.max(dy).min(0.0) + len2(dx.max(0.0), dy.max(0.0))
            }
            Kind::CylZ => {
                let dx = len2(l[0], l[1]) - self.e[0];
                let dz = l[2].abs() - self.e[2];
                dx.max(dz).min(0.0) + len2(dx.max(0.0), dz.max(0.0))
            }
        }
    }

    /// Area of face `f` (box: 6 faces; cylinders: side + 2 caps).
    pub fn face_area(&self, f: usize) -> f32 {
        let e = self.e;
        match self.kind {
            Kind::Box => match f / 2 {
                0 => 4.0 * e[1] * e[2],
                1 => 4.0 * e[0] * e[2],
                _ => 4.0 * e[0] * e[1],
            },
            Kind::CylY => {
                if f == 0 {
                    core::f32::consts::TAU * e[0] * 2.0 * e[1]
                } else {
                    core::f32::consts::PI * e[0] * e[0]
                }
            }
            Kind::CylZ => {
                if f == 0 {
                    core::f32::consts::TAU * e[0] * 2.0 * e[2]
                } else {
                    core::f32::consts::PI * e[0] * e[0]
                }
            }
        }
    }

    pub fn face_count(&self) -> usize {
        if self.kind == Kind::Box {
            6
        } else {
            3
        }
    }

    /// Uniform point on face `f`, with the primitive's outward normal (world space).
    pub fn sample_face(&self, f: usize, rng: &mut Rng) -> ([f32; 3], [f32; 3]) {
        let e = self.e;
        let (lp, ln) = match self.kind {
            Kind::Box => {
                let axis = f / 2;
                let s = if f % 2 == 0 { 1.0 } else { -1.0 };
                let mut p = [rng.range(-e[0], e[0]), rng.range(-e[1], e[1]), rng.range(-e[2], e[2])];
                let mut n = [0.0; 3];
                p[axis] = s * e[axis];
                n[axis] = s;
                (p, n)
            }
            Kind::CylY | Kind::CylZ => {
                let (r, hl) = if self.kind == Kind::CylY { (e[0], e[1]) } else { (e[0], e[2]) };
                let (a, b, h, na, nb, nh) = if f == 0 {
                    let (c, s) = rng.circle();
                    (r * c, r * s, rng.range(-hl, hl), c, s, 0.0)
                } else {
                    let (dx, dy) = rng.disk();
                    let s = if f == 1 { 1.0 } else { -1.0 };
                    (r * dx, r * dy, s * hl, 0.0, 0.0, s)
                };
                if self.kind == Kind::CylY {
                    ([a, h, b], [na, nh, nb])
                } else {
                    ([a, b, h], [na, nb, nh])
                }
            }
        };
        let wp = self.to_world_dir(lp);
        let wn = self.to_world_dir(ln);
        ([wp[0] + self.c[0], wp[1] + self.c[1], wp[2] + self.c[2]], wn)
    }
}

/// A coarse uniform grid listing, per cell, the primitives whose AABB (grown by
/// a margin) overlaps that cell. Lookups touch 2–8 primitives instead of all.
struct CellIndex {
    lo: [f32; 3],
    inv: f32,
    dims: [usize; 3],
    start: Vec<u32>,
    items: Vec<u16>,
}

impl CellIndex {
    fn new(prims: &[Prim], cell: f32, margin: f32) -> CellIndex {
        let mut lo = [f32::MAX; 3];
        let mut hi = [f32::MIN; 3];
        for p in prims {
            for k in 0..3 {
                lo[k] = lo[k].min(p.lo[k] - margin);
                hi[k] = hi[k].max(p.hi[k] + margin);
            }
        }
        if prims.is_empty() {
            lo = [0.0; 3];
            hi = [1.0; 3];
        }
        let dims = [
            (((hi[0] - lo[0]) / cell).ceil() as usize).max(1),
            (((hi[1] - lo[1]) / cell).ceil() as usize).max(1),
            (((hi[2] - lo[2]) / cell).ceil() as usize).max(1),
        ];
        let total = dims[0] * dims[1] * dims[2];
        let mut lists: Vec<Vec<u16>> = vec![Vec::new(); total];
        let inv = 1.0 / cell;
        // cuts first so the occupancy test can bail out early
        for pass in 0..2 {
            for (j, p) in prims.iter().enumerate() {
                if (pass == 0) != p.cut {
                    continue;
                }
                let r = |v: f32, k: usize| (((v - lo[k]) * inv).floor() as isize).clamp(0, dims[k] as isize - 1) as usize;
                let (x0, x1) = (r(p.lo[0] - margin, 0), r(p.hi[0] + margin, 0));
                let (y0, y1) = (r(p.lo[1] - margin, 1), r(p.hi[1] + margin, 1));
                let (z0, z1) = (r(p.lo[2] - margin, 2), r(p.hi[2] + margin, 2));
                for z in z0..=z1 {
                    for y in y0..=y1 {
                        for x in x0..=x1 {
                            lists[(z * dims[1] + y) * dims[0] + x].push(j as u16);
                        }
                    }
                }
            }
        }
        let mut start = Vec::with_capacity(total + 1);
        let mut items = Vec::new();
        start.push(0u32);
        for l in &lists {
            items.extend_from_slice(l);
            start.push(items.len() as u32);
        }
        CellIndex { lo, inv, dims, start, items }
    }

    #[inline]
    fn get(&self, p: &[f32; 3]) -> &[u16] {
        let mut idx = [0usize; 3];
        for k in 0..3 {
            let c = ((p[k] - self.lo[k]) * self.inv).floor();
            if c < 0.0 || c >= self.dims[k] as f32 {
                return &[];
            }
            idx[k] = c as usize;
        }
        let ci = (idx[2] * self.dims[1] + idx[1]) * self.dims[0] + idx[0];
        &self.items[self.start[ci] as usize..self.start[ci + 1] as usize]
    }
}

pub struct Scene {
    pub prims: Vec<Prim>,
    /// occupancy lookups (tight margin)
    occ: CellIndex,
    /// distance lookups for AO probes (margin = probe reach)
    near: CellIndex,
    /// Everything below y = 0 counts as material (the ground).
    pub ground: bool,
    faces: Vec<(u16, u8)>,
    cdf: Vec<f32>,
    /// guide table: guide[k] = first face whose CDF reaches k/len of the total
    guide: Vec<u32>,
}

/// Furthest AO probe distance (and the margin of the distance index).
const AO_REACH: f32 = 2.4;

impl Scene {
    pub fn new(prims: Vec<Prim>, ground: bool) -> Scene {
        let occ = CellIndex::new(&prims, 2.0, 0.05);
        let near = CellIndex::new(&prims, 1.5, AO_REACH + 0.05);
        let mut faces = Vec::new();
        let mut cdf = Vec::new();
        let mut acc = 0.0;
        for (i, p) in prims.iter().enumerate() {
            for f in 0..p.face_count() {
                // faces resting on the ground and facing down can never be seen
                let down = match p.kind {
                    Kind::Box => f == 3,
                    Kind::CylY => f == 2,
                    Kind::CylZ => false,
                };
                if ground && !p.cut && down && p.lo[1].abs() < 1e-3 {
                    continue;
                }
                acc += p.face_area(f);
                faces.push((i as u16, f as u8));
                cdf.push(acc);
            }
        }
        let total = *cdf.last().unwrap_or(&1.0);
        let g_len = (cdf.len() * 4).max(1);
        let mut guide = Vec::with_capacity(g_len);
        let mut f = 0usize;
        for k in 0..g_len {
            let r = k as f32 / g_len as f32 * total;
            while f + 1 < cdf.len() && cdf[f] < r {
                f += 1;
            }
            guide.push(f as u32);
        }
        Scene { prims, occ, near, ground, faces, cdf, guide }
    }

    /// Material occupancy: inside some solid and inside no cut (or below ground).
    #[inline]
    pub fn material(&self, p: &[f32; 3]) -> bool {
        if self.ground && p[1] < 0.0 {
            return true;
        }
        let mut solid = false;
        for &j in self.occ.get(p) {
            let pr = &self.prims[j as usize];
            if pr.contains(p) {
                if pr.cut {
                    return false;
                }
                solid = true;
            }
        }
        solid
    }

    /// CSG signed distance clamped to `cap` (exact whenever the true distance is
    /// below `cap` ≤ AO_REACH). Primitives whose AABB is farther than the current
    /// best are skipped without evaluating their SDF.
    #[inline]
    pub fn sdf_capped(&self, p: &[f32; 3], cap: f32) -> f32 {
        let mut s = cap;
        let mut c = cap;
        for &j in self.near.get(p) {
            let pr = &self.prims[j as usize];
            let best = if pr.cut { c } else { s };
            if best > 0.0 && pr.aabb_dist2(p) >= best * best {
                continue;
            }
            let d = pr.sdf(p);
            if pr.cut {
                c = c.min(d);
            } else {
                s = s.min(d);
            }
        }
        let mut d = s.max(-c);
        if self.ground {
            d = d.min(p[1]);
        }
        d
    }

    /// Count how many of the heights `ys` are inside material in the vertical
    /// column at (x, z). Used for the shadow the structure casts on the ground.
    pub fn column(&self, x: f32, z: f32, ys: &[f32]) -> usize {
        ys.iter().filter(|&&y| y >= 0.0 && self.material(&[x, y, z])).count()
    }

    /// Classic SDF ambient occlusion: march along the normal and compare the
    /// distance field with the distance travelled.
    pub fn ao(&self, p: &[f32; 3], n: &[f32; 3]) -> f32 {
        const H: [(f32, f32); 2] = [(0.6, 0.62), (AO_REACH, 0.42)];
        let mut occ = 0.0;
        for &(h, w) in &H {
            let q = [p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h];
            let d = self.sdf_capped(&q, h);
            occ += ((h - d) / h).clamp(0.0, 1.0) * w;
        }
        (1.0 - occ).clamp(0.0, 1.0)
    }

    /// Draw `target` surface samples. `extra(q)` adds material (e.g. a heightfield)
    /// on top of the CSG. `write(k, p, n, prim_index)` receives accepted samples.
    /// Returns (accepted, candidates tested).
    pub fn sample<F, W>(&self, rng: &mut Rng, target: usize, extra: F, mut write: W) -> (usize, u32)
    where
        F: Fn(&[f32; 3]) -> bool,
        W: FnMut(usize, [f32; 3], [f32; 3], usize),
    {
        const EPS: f32 = 0.025;
        let total = *self.cdf.last().unwrap_or(&0.0);
        let mut k = 0;
        let mut tries: u32 = 0;
        let max_tries = (target as u32).saturating_mul(60).max(1000);
        while k < target && tries < max_tries {
            tries += 1;
            let u = rng.f();
            let r = u * total;
            // guide table jump, then a short linear walk of the face CDF
            let mut lo = self.guide[((u * self.guide.len() as f32) as usize).min(self.guide.len() - 1)] as usize;
            while lo + 1 < self.cdf.len() && self.cdf[lo] < r {
                lo += 1;
            }
            let (pi, f) = self.faces[lo];
            let pi = pi as usize;
            let prim = &self.prims[pi];
            let (p, no) = prim.sample_face(f as usize, rng);
            // a cut's outward normal points into material; the surface normal is its opposite
            let n = if prim.cut { [-no[0], -no[1], -no[2]] } else { no };
            let inner = [p[0] - n[0] * EPS, p[1] - n[1] * EPS, p[2] - n[2] * EPS];
            let outer = [p[0] + n[0] * EPS, p[1] + n[1] * EPS, p[2] + n[2] * EPS];
            let mat = |q: &[f32; 3]| self.material(q) || extra(q);
            // the zero set of the CSG field: material just inside, air just outside
            if !mat(&outer) && mat(&inner) {
                write(k, p, n, pi);
                k += 1;
            }
        }
        (k, tries)
    }
}
