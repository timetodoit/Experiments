//! Glyph extraction: bitmap → closed contours.
//!
//! 1. Marching squares over the alpha channel (iso-level 0.5) with linear edge
//!    interpolation and saddle disambiguation by the cell average. Every crossing is
//!    keyed by the grid edge it lies on, so segments link into closed loops through a
//!    flat adjacency table — no hashing.
//! 2. Douglas–Peucker removes the pixel staircase.
//! 3. Even arc-length resampling, so every particle carries the same mass and the
//!    shape-matching fit is not biased towards detailed corners.
//! 4. Rings are classified as outer / hole by nesting depth and oriented so that
//!    outers have positive shoelace area and holes negative. With that convention the
//!    edge normal `(e.y, -e.x)` always points out of the material (y grows downward).

pub type P = (f32, f32);

pub struct Shape {
    /// All ring points, concatenated, centred on their mean (the centre of mass).
    pub pts: Vec<P>,
    /// (start, count, is_hole). Every outer is followed by its holes.
    pub rings: Vec<(usize, usize, bool)>,
    pub width: f32,
    pub height: f32,
}

pub fn signed_area(r: &[P]) -> f32 {
    let n = r.len();
    let mut a = 0.0;
    for i in 0..n {
        let (x0, y0) = r[i];
        let (x1, y1) = r[(i + 1) % n];
        a += x0 * y1 - x1 * y0;
    }
    a * 0.5
}

pub fn point_in_ring(p: P, r: &[P]) -> bool {
    let n = r.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (ax, ay) = r[j];
        let (bx, by) = r[i];
        if (ay > p.1) != (by > p.1) {
            let xi = ax + (p.1 - ay) * (bx - ax) / (by - ay);
            if p.0 < xi {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

/// Marching squares. Returns closed loops in bitmap pixel coordinates.
pub fn marching_squares(alpha: &[u8], w: usize, h: usize, thr: f32) -> Vec<Vec<P>> {
    // padded grid: one ring of zero samples around the bitmap so every loop closes
    let pw = w + 2;
    let ph = h + 2;
    let val = |cx: usize, cy: usize| -> f32 {
        if cx == 0 || cy == 0 || cx > w || cy > h {
            0.0
        } else {
            alpha[(cy - 1) * w + (cx - 1)] as f32
        }
    };
    let hid = |cx: usize, cy: usize| (cy * pw + cx) * 2;
    let vid = |cx: usize, cy: usize| (cy * pw + cx) * 2 + 1;
    let n = pw * ph * 2;
    const NONE: u32 = u32::MAX;
    let mut adj = vec![[NONE; 2]; n];

    fn link(adj: &mut [[u32; 2]], a: usize, b: usize) {
        let put = |slot: &mut [u32; 2], v: usize| {
            if slot[0] == u32::MAX {
                slot[0] = v as u32;
            } else {
                slot[1] = v as u32;
            }
        };
        put(&mut adj[a], b);
        put(&mut adj[b], a);
    }

    for cy in 0..ph - 1 {
        for cx in 0..pw - 1 {
            let v0 = val(cx, cy);
            let v1 = val(cx + 1, cy);
            let v2 = val(cx + 1, cy + 1);
            let v3 = val(cx, cy + 1);
            let case = (v0 >= thr) as u8
                | ((v1 >= thr) as u8) << 1
                | ((v2 >= thr) as u8) << 2
                | ((v3 >= thr) as u8) << 3;
            if case == 0 || case == 15 {
                continue;
            }
            let t = hid(cx, cy);
            let r = vid(cx + 1, cy);
            let b = hid(cx, cy + 1);
            let l = vid(cx, cy);
            let centre = (v0 + v1 + v2 + v3) * 0.25 >= thr;
            match case {
                1 | 14 => link(&mut adj, l, t),
                2 | 13 => link(&mut adj, t, r),
                3 | 12 => link(&mut adj, l, r),
                4 | 11 => link(&mut adj, r, b),
                6 | 9 => link(&mut adj, t, b),
                7 | 8 => link(&mut adj, l, b),
                5 => {
                    if centre {
                        link(&mut adj, t, r);
                        link(&mut adj, b, l);
                    } else {
                        link(&mut adj, l, t);
                        link(&mut adj, r, b);
                    }
                }
                10 => {
                    if centre {
                        link(&mut adj, l, t);
                        link(&mut adj, r, b);
                    } else {
                        link(&mut adj, t, r);
                        link(&mut adj, b, l);
                    }
                }
                _ => {}
            }
        }
    }

    let pos = |id: usize| -> P {
        let cell = id / 2;
        let cx = cell % pw;
        let cy = cell / pw;
        if id % 2 == 0 {
            let a = val(cx, cy);
            let b = val(cx + 1, cy);
            let d = b - a;
            let t = if d.abs() > 1e-6 { ((thr - a) / d).clamp(0.0, 1.0) } else { 0.5 };
            (cx as f32 + t - 1.0, cy as f32 - 1.0)
        } else {
            let a = val(cx, cy);
            let b = val(cx, cy + 1);
            let d = b - a;
            let t = if d.abs() > 1e-6 { ((thr - a) / d).clamp(0.0, 1.0) } else { 0.5 };
            (cx as f32 - 1.0, cy as f32 + t - 1.0)
        }
    };

    let mut visited = vec![false; n];
    let mut loops = Vec::new();
    for start in 0..n {
        if visited[start] || adj[start][0] == NONE {
            continue;
        }
        let mut ring = Vec::new();
        let mut prev = NONE;
        let mut cur = start as u32;
        loop {
            visited[cur as usize] = true;
            ring.push(pos(cur as usize));
            let a = adj[cur as usize];
            let next = if a[0] != prev { a[0] } else { a[1] };
            if next == NONE || next as usize == start || visited[next as usize] {
                break;
            }
            prev = cur;
            cur = next;
            if ring.len() > n {
                break;
            }
        }
        if ring.len() >= 3 {
            loops.push(ring);
        }
    }
    loops
}

fn seg_dist2(p: P, a: P, b: P) -> f32 {
    let ex = b.0 - a.0;
    let ey = b.1 - a.1;
    let l2 = ex * ex + ey * ey;
    let t = if l2 > 1e-12 { (((p.0 - a.0) * ex + (p.1 - a.1) * ey) / l2).clamp(0.0, 1.0) } else { 0.0 };
    let dx = a.0 + ex * t - p.0;
    let dy = a.1 + ey * t - p.1;
    dx * dx + dy * dy
}

/// Douglas–Peucker on a closed ring (iterative).
pub fn simplify_closed(r: &[P], eps: f32) -> Vec<P> {
    let n = r.len();
    if n < 8 {
        return r.to_vec();
    }
    let mut far = 0;
    let mut best = -1.0;
    for (i, p) in r.iter().enumerate() {
        let d = (p.0 - r[0].0).powi(2) + (p.1 - r[0].1).powi(2);
        if d > best {
            best = d;
            far = i;
        }
    }
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[far] = true;
    let eps2 = eps * eps;
    let mut stack = vec![(0usize, far), (far, n)];
    while let Some((s, e)) = stack.pop() {
        if e <= s + 1 {
            continue;
        }
        let a = r[s];
        let b = r[e % n];
        let mut m = s;
        let mut dm = -1.0;
        for k in s + 1..e {
            let d = seg_dist2(r[k], a, b);
            if d > dm {
                dm = d;
                m = k;
            }
        }
        if dm > eps2 {
            keep[m] = true;
            stack.push((s, m));
            stack.push((m, e));
        }
    }
    r.iter().zip(keep).filter(|(_, k)| *k).map(|(p, _)| *p).collect()
}

/// Even arc-length resampling of a closed ring.
pub fn resample_closed(r: &[P], spacing: f32, min_n: usize) -> Vec<P> {
    let n = r.len();
    let mut cum = Vec::with_capacity(n + 1);
    cum.push(0.0f32);
    for i in 0..n {
        let a = r[i];
        let b = r[(i + 1) % n];
        let l = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
        cum.push(cum[i] + l);
    }
    let total = cum[n];
    if total <= 1e-3 {
        return r.to_vec();
    }
    let count = ((total / spacing.max(0.5)).round() as usize).max(min_n);
    let step = total / count as f32;
    let mut out = Vec::with_capacity(count);
    let mut seg = 0;
    for k in 0..count {
        let target = k as f32 * step;
        while seg < n - 1 && cum[seg + 1] < target {
            seg += 1;
        }
        let len = (cum[seg + 1] - cum[seg]).max(1e-6);
        let t = ((target - cum[seg]) / len).clamp(0.0, 1.0);
        let a = r[seg];
        let b = r[(seg + 1) % n];
        out.push((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
    }
    out
}

/// Full extraction. `unit` converts bitmap pixels → CSS pixels, `spacing` is in CSS pixels.
pub fn extract(alpha: &[u8], w: usize, h: usize, unit: f32, spacing: f32) -> Shape {
    let raw = marching_squares(alpha, w, h, 127.5);
    let mut rings: Vec<Vec<P>> = Vec::new();
    for r in raw {
        if r.len() < 8 || signed_area(&r).abs() < 24.0 {
            continue; // anti-aliasing specks
        }
        let s = simplify_closed(&r, 0.55);
        let scaled: Vec<P> = s.iter().map(|p| (p.0 * unit, p.1 * unit)).collect();
        let rs = resample_closed(&scaled, spacing, 10);
        if rs.len() >= 6 {
            rings.push(rs);
        }
    }

    // nesting depth → outer / hole
    let m = rings.len();
    let mut hole = vec![false; m];
    for i in 0..m {
        let mut depth = 0;
        for j in 0..m {
            if i != j && point_in_ring(rings[i][0], &rings[j]) {
                depth += 1;
            }
        }
        hole[i] = depth % 2 == 1;
    }
    for i in 0..m {
        let a = signed_area(&rings[i]);
        if (hole[i] && a > 0.0) || (!hole[i] && a < 0.0) {
            rings[i].reverse();
        }
    }
    // assign each hole to its tightest containing outer
    let mut parent = vec![usize::MAX; m];
    for i in 0..m {
        if !hole[i] {
            continue;
        }
        let mut best = f32::INFINITY;
        for j in 0..m {
            if hole[j] || !point_in_ring(rings[i][0], &rings[j]) {
                continue;
            }
            let a = signed_area(&rings[j]).abs();
            if a < best {
                best = a;
                parent[i] = j;
            }
        }
    }

    let mut pts = Vec::new();
    let mut out_rings = Vec::new();
    for o in 0..m {
        if hole[o] {
            continue;
        }
        out_rings.push((pts.len(), rings[o].len(), false));
        pts.extend_from_slice(&rings[o]);
        for hi in 0..m {
            if hole[hi] && parent[hi] == o {
                out_rings.push((pts.len(), rings[hi].len(), true));
                pts.extend_from_slice(&rings[hi]);
            }
        }
    }

    let nf = pts.len().max(1) as f32;
    let (mut mx, mut my) = (0.0, 0.0);
    let (mut x0, mut y0, mut x1, mut y1) = (f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
    for p in &pts {
        mx += p.0;
        my += p.1;
        x0 = x0.min(p.0);
        y0 = y0.min(p.1);
        x1 = x1.max(p.0);
        y1 = y1.max(p.1);
    }
    mx /= nf;
    my /= nf;
    for p in pts.iter_mut() {
        p.0 -= mx;
        p.1 -= my;
    }
    Shape {
        pts,
        rings: out_rings,
        width: (x1 - x0).max(0.0),
        height: (y1 - y0).max(0.0),
    }
}
