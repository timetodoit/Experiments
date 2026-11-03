//! Deterministic RNG, integer hashes and value noise. No allocation, no std::time.

/// xorshift64* — tiny, fast and deterministic across platforms.
pub struct Rng {
    s: u64,
}

impl Rng {
    pub fn new(seed: u32) -> Rng {
        let mut s = (seed as u64).wrapping_add(0x9E37_79B9_7F4A_7C15);
        s = (s ^ (s >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        s = (s ^ (s >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        Rng { s: (s ^ (s >> 31)) | 1 }
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.s;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.s = x;
        (x.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 32) as u32
    }

    /// Uniform in [0, 1).
    #[inline]
    pub fn f(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (1.0 / 16_777_216.0)
    }

    #[inline]
    pub fn range(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.f()
    }

    /// Uniform integer in [0, n).
    #[inline]
    pub fn below(&mut self, n: usize) -> usize {
        ((self.next_u32() as u64 * n as u64) >> 32) as usize
    }

    /// Cheap approximately-gaussian sample (sum of 4 uniforms), σ ≈ 1.
    #[inline]
    pub fn gauss(&mut self) -> f32 {
        (self.f() + self.f() + self.f() + self.f() - 2.0) * 1.732
    }

    /// Uniform point in the unit disk (rejection — no trig; wasm has no native sin/cos).
    #[inline]
    pub fn disk(&mut self) -> (f32, f32) {
        loop {
            let x = self.f() * 2.0 - 1.0;
            let y = self.f() * 2.0 - 1.0;
            if x * x + y * y <= 1.0 {
                return (x, y);
            }
        }
    }

    /// Uniform (cos θ, sin θ).
    #[inline]
    pub fn circle(&mut self) -> (f32, f32) {
        loop {
            let (x, y) = self.disk();
            let l2 = x * x + y * y;
            if l2 > 1e-4 {
                let inv = 1.0 / l2.sqrt();
                return (x * inv, y * inv);
            }
        }
    }

    /// Uniform direction on the unit sphere.
    #[inline]
    pub fn dir(&mut self) -> [f32; 3] {
        loop {
            let v = [self.f() * 2.0 - 1.0, self.f() * 2.0 - 1.0, self.f() * 2.0 - 1.0];
            let l2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
            if l2 <= 1.0 && l2 > 1e-4 {
                let inv = 1.0 / l2.sqrt();
                return [v[0] * inv, v[1] * inv, v[2] * inv];
            }
        }
    }
}

#[inline]
fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
    let mut h = (x as u32).wrapping_mul(0x8da6_b343)
        ^ (y as u32).wrapping_mul(0xd816_3841)
        ^ (z as u32).wrapping_mul(0xcb1a_b31f)
        ^ seed.wrapping_mul(0x9E37_79B9);
    h ^= h >> 13;
    h = h.wrapping_mul(0x5bd1_e995);
    h ^= h >> 15;
    (h & 0x00ff_ffff) as f32 * (1.0 / 16_777_215.0)
}

#[inline]
fn fade(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// 2D value noise in [-1, 1].
pub fn vnoise2(x: f32, y: f32, seed: u32) -> f32 {
    let xf = x.floor();
    let yf = y.floor();
    let (xi, yi) = (xf as i32, yf as i32);
    let (u, v) = (fade(x - xf), fade(y - yf));
    let a = hash3(xi, yi, 0, seed);
    let b = hash3(xi + 1, yi, 0, seed);
    let c = hash3(xi, yi + 1, 0, seed);
    let d = hash3(xi + 1, yi + 1, 0, seed);
    lerp(lerp(a, b, u), lerp(c, d, u), v) * 2.0 - 1.0
}

/// 3D value noise in [-1, 1].
pub fn vnoise3(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    let (xf, yf, zf) = (x.floor(), y.floor(), z.floor());
    let (xi, yi, zi) = (xf as i32, yf as i32, zf as i32);
    let (u, v, w) = (fade(x - xf), fade(y - yf), fade(z - zf));
    let c000 = hash3(xi, yi, zi, seed);
    let c100 = hash3(xi + 1, yi, zi, seed);
    let c010 = hash3(xi, yi + 1, zi, seed);
    let c110 = hash3(xi + 1, yi + 1, zi, seed);
    let c001 = hash3(xi, yi, zi + 1, seed);
    let c101 = hash3(xi + 1, yi, zi + 1, seed);
    let c011 = hash3(xi, yi + 1, zi + 1, seed);
    let c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
    let x00 = lerp(c000, c100, u);
    let x10 = lerp(c010, c110, u);
    let x01 = lerp(c001, c101, u);
    let x11 = lerp(c011, c111, u);
    lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2.0 - 1.0
}

pub fn fbm2(x: f32, y: f32, seed: u32, oct: u32) -> f32 {
    let (mut px, mut py) = (x, y);
    let (mut a, mut s, mut n) = (0.5, 0.0, 0.0);
    for i in 0..oct {
        s += a * vnoise2(px, py, seed.wrapping_add(i * 101));
        n += a;
        // rotate + scale between octaves to hide the lattice
        let (qx, qy) = (0.8 * px - 0.6 * py, 0.6 * px + 0.8 * py);
        px = qx * 2.03;
        py = qy * 2.03;
        a *= 0.5;
    }
    s / n
}

#[allow(dead_code)]
pub fn fbm3(x: f32, y: f32, z: f32, seed: u32, oct: u32) -> f32 {
    let (mut px, mut py, mut pz) = (x, y, z);
    let (mut a, mut s, mut n) = (0.5, 0.0, 0.0);
    for i in 0..oct {
        s += a * vnoise3(px, py, pz, seed.wrapping_add(i * 131));
        n += a;
        px = px * 2.01 + 1.7;
        py = py * 2.03 - 3.1;
        pz = pz * 1.99 + 0.9;
        a *= 0.5;
    }
    s / n
}

#[inline]
pub fn fract(x: f32) -> f32 {
    x - x.floor()
}

#[inline]
pub fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
