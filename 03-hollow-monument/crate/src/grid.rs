//! Uniform grid over a point cloud + ray picking with a 3D DDA walk.
//!
//! Build: counting sort of point indices by cell (O(n), two allocations).
//! Pick:  walk the cells the ray crosses; in each, test the 3×3×3 neighbourhood
//!        for points whose perpendicular distance to the ray is within a cone
//!        (radius grows with distance, i.e. a constant number of screen pixels).
//!        Returns the hit nearest the eye. Stops one-and-a-half cells past the
//!        first hit.

use crate::clouds::STRIDE;

pub struct Grid {
    lo: [f32; 3],
    hi: [f32; 3],
    cell: f32,
    dims: [usize; 3],
    start: Vec<u32>,
    items: Vec<u32>,
}

impl Grid {
    pub fn build(data: &[f32], n: usize, lo: [f32; 3], hi: [f32; 3], cells_long_axis: f32) -> Grid {
        let ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        let cell = (ext[0].max(ext[1]).max(ext[2]) / cells_long_axis).max(0.25);
        let dims = [
            ((ext[0] / cell).ceil() as usize).max(1),
            ((ext[1] / cell).ceil() as usize).max(1),
            ((ext[2] / cell).ceil() as usize).max(1),
        ];
        let total = dims[0] * dims[1] * dims[2];
        let mut g = Grid { lo, hi, cell, dims, start: vec![0u32; total + 1], items: vec![0u32; n] };
        // pass 1: counts (stored shifted by one)
        for i in 0..n {
            let c = g.cell_index(&data[i * STRIDE..i * STRIDE + 3]);
            g.start[c + 1] += 1;
        }
        for c in 0..total {
            g.start[c + 1] += g.start[c];
        }
        // pass 2: scatter, using a cursor copy
        let mut cursor: Vec<u32> = g.start[..total].to_vec();
        for i in 0..n {
            let c = g.cell_index(&data[i * STRIDE..i * STRIDE + 3]);
            g.items[cursor[c] as usize] = i as u32;
            cursor[c] += 1;
        }
        g
    }

    pub fn cell_count(&self) -> usize {
        self.dims[0] * self.dims[1] * self.dims[2]
    }

    #[inline]
    fn coord(&self, v: f32, k: usize) -> usize {
        (((v - self.lo[k]) / self.cell) as isize).clamp(0, self.dims[k] as isize - 1) as usize
    }

    #[inline]
    fn cell_index(&self, p: &[f32]) -> usize {
        let (x, y, z) = (self.coord(p[0], 0), self.coord(p[1], 1), self.coord(p[2], 2));
        (z * self.dims[1] + y) * self.dims[0] + x
    }

    /// `o` origin, `d` unit direction, cone radius = min(rk · t, rmax). Returns index or −1.
    pub fn pick(&self, data: &[f32], o: [f32; 3], d: [f32; 3], rk: f32, rmax: f32) -> i32 {
        let rmax = rmax.min(self.cell);
        // slab test against the grid bounds
        let mut t0 = 0.0f32;
        let mut t1 = 1e9f32;
        for k in 0..3 {
            if d[k].abs() < 1e-8 {
                if o[k] < self.lo[k] || o[k] > self.hi[k] {
                    return -1;
                }
            } else {
                let inv = 1.0 / d[k];
                let (mut a, mut b) = ((self.lo[k] - o[k]) * inv, (self.hi[k] - o[k]) * inv);
                if a > b {
                    core::mem::swap(&mut a, &mut b);
                }
                t0 = t0.max(a);
                t1 = t1.min(b);
            }
        }
        if t1 < t0 {
            return -1;
        }
        let t_start = t0 + 1e-4;
        let p = [o[0] + d[0] * t_start, o[1] + d[1] * t_start, o[2] + d[2] * t_start];
        let mut c = [self.coord(p[0], 0) as isize, self.coord(p[1], 1) as isize, self.coord(p[2], 2) as isize];
        let mut step = [0isize; 3];
        let mut t_max = [1e9f32; 3];
        let mut t_delta = [1e9f32; 3];
        for k in 0..3 {
            if d[k] > 1e-8 {
                step[k] = 1;
                let edge = self.lo[k] + (c[k] + 1) as f32 * self.cell;
                t_max[k] = t_start + (edge - p[k]) / d[k];
                t_delta[k] = self.cell / d[k];
            } else if d[k] < -1e-8 {
                step[k] = -1;
                let edge = self.lo[k] + c[k] as f32 * self.cell;
                t_max[k] = t_start + (edge - p[k]) / d[k];
                t_delta[k] = -self.cell / d[k];
            }
        }

        let mut best = -1i32;
        let mut best_t = 1e9f32;
        let mut t_cell = t_start;
        let (dx, dy, dz) = (self.dims[0] as isize, self.dims[1] as isize, self.dims[2] as isize);
        for _ in 0..4096 {
            if best >= 0 && t_cell > best_t + self.cell * 1.5 {
                break;
            }
            for oz in -1..=1isize {
                let z = c[2] + oz;
                if z < 0 || z >= dz {
                    continue;
                }
                for oy in -1..=1isize {
                    let y = c[1] + oy;
                    if y < 0 || y >= dy {
                        continue;
                    }
                    for ox in -1..=1isize {
                        let x = c[0] + ox;
                        if x < 0 || x >= dx {
                            continue;
                        }
                        let ci = ((z * dy + y) * dx + x) as usize;
                        let (s, e) = (self.start[ci] as usize, self.start[ci + 1] as usize);
                        for &idx in &self.items[s..e] {
                            let b = idx as usize * STRIDE;
                            let v = [data[b] - o[0], data[b + 1] - o[1], data[b + 2] - o[2]];
                            let t = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
                            if t <= 0.05 || t >= best_t {
                                continue;
                            }
                            let perp2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] - t * t;
                            let r = (rk * t).min(rmax);
                            if perp2 < r * r {
                                best_t = t;
                                best = idx as i32;
                            }
                        }
                    }
                }
            }
            // advance
            let k = if t_max[0] < t_max[1] {
                if t_max[0] < t_max[2] {
                    0
                } else {
                    2
                }
            } else if t_max[1] < t_max[2] {
                1
            } else {
                2
            };
            t_cell = t_max[k];
            if t_cell > t1 {
                break;
            }
            c[k] += step[k];
            if c[k] < 0 || c[k] >= self.dims[k] as isize {
                break;
            }
            t_max[k] += t_delta[k];
        }
        best
    }
}
