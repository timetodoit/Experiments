//! Hollow Monument — survey core.
//!
//! Generates four point clouds of identical size N by sampling the surfaces of
//! signed-distance-field geometry, and answers ray picks against them through a
//! uniform grid. Point data lives in linear memory; JS builds zero-copy
//! `Float32Array` views from `cloud_ptr` / `cloud_len` and uploads them to the GPU
//! as storage buffers.
//!
//! Cloud slots: 0 MONUMENT · 1 TERRAIN · 2 TYPE · 3 NEBULA
//! Layout per point (8 × f32): x y z intensity | nx ny nz scan_time

mod clouds;
mod grid;
mod noise;
mod solids;

use clouds::STRIDE;
use grid::Grid;
use wasm_bindgen::prelude::*;

pub const SLOTS: usize = 4;

#[wasm_bindgen]
pub fn core_version() -> String {
    format!("monument.rs {}", env!("CARGO_PKG_VERSION"))
}

#[wasm_bindgen]
pub struct Survey {
    n: usize,
    clouds: Vec<Vec<f32>>,
    bounds: Vec<[f32; 6]>,
    grids: Vec<Option<Grid>>,
    scratch: Vec<f32>,
    pairs: Vec<u64>,
    pairs_tmp: Vec<u64>,
    candidates: Vec<u32>,
}

#[wasm_bindgen]
impl Survey {
    #[wasm_bindgen(constructor)]
    pub fn new(n: usize) -> Survey {
        let n = n.max(1024);
        Survey {
            n,
            clouds: (0..SLOTS).map(|_| vec![0.0f32; n * STRIDE]).collect(),
            bounds: vec![[0.0; 6]; SLOTS],
            grids: (0..SLOTS).map(|_| None).collect(),
            scratch: Vec::new(),
            pairs: Vec::new(),
            pairs_tmp: Vec::new(),
            candidates: vec![0; SLOTS],
        }
    }

    pub fn count(&self) -> usize {
        self.n
    }

    pub fn stride(&self) -> usize {
        STRIDE
    }

    /// Number of SDF primitives (solids + cuts) the monument is built from.
    pub fn monument_primitives(&self) -> usize {
        clouds::monument_prims().len()
    }

    pub fn gen_monument(&mut self, seed: u32) {
        let c = clouds::monument(&mut self.clouds[0], self.n, seed);
        self.candidates[0] = c;
        self.finalize(0);
    }

    pub fn gen_terrain(&mut self, seed: u32) {
        let c = clouds::terrain(&mut self.clouds[1], self.n, seed);
        self.candidates[1] = c;
        self.finalize(1);
    }

    /// `mask`: w×h coverage bytes from a Canvas2D rasterisation (row 0 = top).
    pub fn gen_type(&mut self, mask: &[u8], w: usize, h: usize, world_w: f32, depth: f32, y0: f32, seed: u32) {
        let w = w.max(1);
        let h = h.max(1).min(mask.len() / w);
        let c = clouds::type_cloud(&mut self.clouds[2], self.n, mask, w, h, world_w, depth, y0, seed);
        self.candidates[2] = c;
        self.finalize(2);
    }

    pub fn gen_nebula(&mut self, seed: u32) {
        let c = clouds::nebula(&mut self.clouds[3], self.n, seed);
        self.candidates[3] = c;
        self.finalize(3);
    }

    /// Candidates tested (or primitives touched) by the last generation of slot k.
    pub fn candidates(&self, k: usize) -> u32 {
        self.candidates[k.min(SLOTS - 1)]
    }

    /// Build the pick grid for slot k. Returns the number of cells.
    pub fn build_grid(&mut self, k: usize, cells_long_axis: f32) -> usize {
        let k = k.min(SLOTS - 1);
        let b = self.bounds[k];
        let pad = 0.01;
        let g = Grid::build(
            &self.clouds[k],
            self.n,
            [b[0] - pad, b[1] - pad, b[2] - pad],
            [b[3] + pad, b[4] + pad, b[5] + pad],
            cells_long_axis,
        );
        let cells = g.cell_count();
        self.grids[k] = Some(g);
        cells
    }

    pub fn cloud_ptr(&self, k: usize) -> *const f32 {
        self.clouds[k.min(SLOTS - 1)].as_ptr()
    }

    pub fn cloud_len(&self, k: usize) -> usize {
        self.clouds[k.min(SLOTS - 1)].len()
    }

    /// [min x, min y, min z, max x, max y, max z]
    pub fn bounds(&self, k: usize) -> Vec<f32> {
        self.bounds[k.min(SLOTS - 1)].to_vec()
    }

    /// Nearest point to the ray (o, d) within a cone of radius rk·t (capped at rmax).
    /// Returns the point index or −1.
    #[allow(clippy::too_many_arguments)]
    pub fn pick(&self, k: usize, ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32, rk: f32, rmax: f32) -> i32 {
        let k = k.min(SLOTS - 1);
        let l = (dx * dx + dy * dy + dz * dz).sqrt();
        if l < 1e-9 {
            return -1;
        }
        match &self.grids[k] {
            Some(g) => g.pick(&self.clouds[k], [ox, oy, oz], [dx / l, dy / l, dz / l], rk, rmax),
            None => -1,
        }
    }
}

/// Spread the low 10 bits of v so there are two zero bits between each.
#[inline]
fn spread10(v: u32) -> u32 {
    let mut x = v & 0x3ff;
    x = (x | (x << 16)) & 0x030000ff;
    x = (x | (x << 8)) & 0x0300f00f;
    x = (x | (x << 4)) & 0x030c30c3;
    x = (x | (x << 2)) & 0x09249249;
    x
}

impl Survey {
    /// Normalise scan keys to [0, 1], compute bounds, and reorder points along a
    /// Morton curve so index i lands at a similar relative position in every
    /// cloud — morphs then flow coherently instead of exploding randomly.
    fn finalize(&mut self, k: usize) {
        let n = self.n;
        let d = &mut self.clouds[k];
        let mut lo = [f32::MAX; 3];
        let mut hi = [f32::MIN; 3];
        let (mut kmin, mut kmax) = (f32::MAX, f32::MIN);
        for i in 0..n {
            let b = i * STRIDE;
            for c in 0..3 {
                lo[c] = lo[c].min(d[b + c]);
                hi[c] = hi[c].max(d[b + c]);
            }
            kmin = kmin.min(d[b + 7]);
            kmax = kmax.max(d[b + 7]);
        }
        let inv = 1.0 / (kmax - kmin).max(1e-6);
        for i in 0..n {
            let b = i * STRIDE + 7;
            d[b] = (d[b] - kmin) * inv;
        }
        self.bounds[k] = [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]];

        // Morton (Z-order) key over the cloud's own normalised bounds, then a
        // two-pass LSD radix sort (15 + 15 bits). Point i of every cloud sits at
        // the same relative position along the curve, so a morph maps
        // neighbourhoods onto neighbourhoods instead of scattering.
        let sc = [
            1023.0 / (hi[0] - lo[0]).max(1e-6),
            1023.0 / (hi[1] - lo[1]).max(1e-6),
            1023.0 / (hi[2] - lo[2]).max(1e-6),
        ];
        // (key << 32 | index) pairs sort with sequential reads only
        self.pairs.resize(n, 0);
        self.pairs_tmp.resize(n, 0);
        for i in 0..n {
            let q = |c: usize| (((d[i * STRIDE + c] - lo[c]) * sc[c]) as u32).min(1023);
            let key = (spread10(q(0)) << 2) | (spread10(q(1)) << 1) | spread10(q(2));
            self.pairs[i] = ((key as u64) << 32) | i as u64;
        }
        const B: usize = 1 << 15;
        let mut count = vec![0u32; B + 1];
        for pass in 0..2 {
            let shift = 32 + pass * 15;
            count.iter_mut().for_each(|c| *c = 0);
            for &p in &self.pairs {
                count[((p >> shift) as usize & (B - 1)) + 1] += 1;
            }
            for b in 0..B {
                count[b + 1] += count[b];
            }
            for &p in &self.pairs {
                let bucket = (p >> shift) as usize & (B - 1);
                self.pairs_tmp[count[bucket] as usize] = p;
                count[bucket] += 1;
            }
            core::mem::swap(&mut self.pairs, &mut self.pairs_tmp);
        }
        self.scratch.resize(n * STRIDE, 0.0);
        let s = &mut self.scratch;
        for (dst, &p) in self.pairs.iter().enumerate() {
            let src = (p & 0xffff_ffff) as usize;
            s[dst * STRIDE..dst * STRIDE + STRIDE].copy_from_slice(&d[src * STRIDE..src * STRIDE + STRIDE]);
        }
        core::mem::swap(d, s);
        self.grids[k] = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_and_pick() {
        let n = 600_000;
        let mut s = Survey::new(n);
        let t = std::time::Instant::now();
        s.gen_monument(3);
        let t_m = t.elapsed();
        let t = std::time::Instant::now();
        s.gen_terrain(7);
        let t_t = t.elapsed();
        let (w, h) = (400usize, 100usize);
        let mut mask = vec![0u8; w * h];
        for j in 10..90 {
            for i in 20..380 {
                if (i / 30) % 2 == 0 {
                    mask[j * w + i] = 255;
                }
            }
        }
        let t = std::time::Instant::now();
        s.gen_type(&mask, w, h, 90.0, 7.0, 0.4, 11);
        let t_y = t.elapsed();
        let t = std::time::Instant::now();
        s.gen_nebula(13);
        let t_n = t.elapsed();
        let t = std::time::Instant::now();
        for k in 0..4 {
            s.build_grid(k, 80.0);
        }
        let t_g = t.elapsed();
        eprintln!("monument {:?} (cand {}) terrain {:?} type {:?} nebula {:?} grids {:?}", t_m, s.candidates(0), t_t, t_y, t_n, t_g);
        eprintln!("bounds m {:?}", s.bounds(0));
        eprintln!("bounds t {:?}", s.bounds(1));
        let t = std::time::Instant::now();
        let hit = s.pick(0, -62.0, 14.0, 92.0, 68.0, 3.0, -92.0, 0.006, 1.0);
        eprintln!("pick {} in {:?}", hit, t.elapsed());
        assert!(hit >= 0);
        let d = &s.clouds[0];
        for i in 0..n {
            assert!(d[i * 8 + 3].is_finite() && d[i * 8].is_finite());
        }
    }
}
