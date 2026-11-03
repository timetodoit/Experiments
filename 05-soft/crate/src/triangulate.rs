//! Ear clipping with hole bridging (Eberly, "Triangulation by Ear Clipping").
//!
//! Runs once per glyph on the rest pose. The resulting index list is reused every
//! frame against the deforming particle positions — shape matching keeps the mesh
//! close enough to its rest topology that triangles stay valid.
//!
//! Convention (see `contour`): outers have positive shoelace area, holes negative,
//! so a convex vertex has `cross(prev, cur, next) > 0`.

use crate::contour::P;
use std::cmp::Ordering;

#[inline]
fn cross(o: P, a: P, b: P) -> f32 {
    (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
}

#[inline]
fn same(a: P, b: P) -> bool {
    (a.0 - b.0).abs() < 1e-5 && (a.1 - b.1).abs() < 1e-5
}

#[inline]
fn in_tri_strict(p: P, a: P, b: P, c: P) -> bool {
    cross(a, b, p) > 0.0 && cross(b, c, p) > 0.0 && cross(c, a, p) > 0.0
}

#[inline]
fn in_tri_any(p: P, a: P, b: P, c: P) -> bool {
    let d1 = cross(a, b, p);
    let d2 = cross(b, c, p);
    let d3 = cross(c, a, p);
    let neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(neg && pos)
}

/// Triangulate one outer ring (start, count) with its holes. Indices refer to `pts`.
pub fn triangulate(pts: &[P], outer: (usize, usize), holes: &[(usize, usize)]) -> Vec<u32> {
    let mut poly: Vec<usize> = (outer.0..outer.0 + outer.1).collect();
    let max_x = |h: &(usize, usize)| (h.0..h.0 + h.1).map(|i| pts[i].0).fold(f32::NEG_INFINITY, f32::max);
    let mut hs: Vec<(usize, usize)> = holes.to_vec();
    hs.sort_by(|a, b| max_x(b).partial_cmp(&max_x(a)).unwrap_or(Ordering::Equal));

    for &(h0, hc) in &hs {
        if hc < 3 {
            continue;
        }
        let mut mi = 0;
        for k in 0..hc {
            if pts[h0 + k].0 > pts[h0 + mi].0 {
                mi = k;
            }
        }
        let m = pts[h0 + mi];
        let n = poly.len();

        // cast a ray towards +x and find the closest edge it hits
        let mut best_x = f32::INFINITY;
        let mut best_e = usize::MAX;
        for i in 0..n {
            let a = pts[poly[i]];
            let b = pts[poly[(i + 1) % n]];
            if (a.1 > m.1) == (b.1 > m.1) {
                continue;
            }
            let x = a.0 + (m.1 - a.1) * (b.0 - a.0) / (b.1 - a.1);
            if x >= m.0 && x < best_x {
                best_x = x;
                best_e = i;
            }
        }

        let pi = if best_e == usize::MAX {
            // degenerate: bridge to the nearest vertex
            let mut bi = 0;
            let mut bd = f32::INFINITY;
            for (i, &v) in poly.iter().enumerate() {
                let d = (pts[v].0 - m.0).powi(2) + (pts[v].1 - m.1).powi(2);
                if d < bd {
                    bd = d;
                    bi = i;
                }
            }
            bi
        } else {
            let ea = best_e;
            let eb = (best_e + 1) % n;
            let mut cand = if pts[poly[ea]].0 > pts[poly[eb]].0 { ea } else { eb };
            let ipt = (best_x, m.1);
            let p = pts[poly[cand]];
            // a reflex vertex inside (M, I, P) would block visibility: take the one
            // closest in angle to the ray
            let mut best_ang = f32::INFINITY;
            let mut best_d = f32::INFINITY;
            for j in 0..n {
                if j == cand {
                    continue;
                }
                let v = pts[poly[j]];
                if v.0 < m.0 {
                    continue;
                }
                let prev = pts[poly[(j + n - 1) % n]];
                let next = pts[poly[(j + 1) % n]];
                if cross(prev, v, next) > 0.0 {
                    continue;
                }
                if in_tri_any(v, m, ipt, p) {
                    let dx = v.0 - m.0;
                    let dy = v.1 - m.1;
                    let d = (dx * dx + dy * dy).sqrt();
                    let ang = dy.abs() / (d + 1e-9);
                    if ang < best_ang - 1e-6 || ((ang - best_ang).abs() <= 1e-6 && d < best_d) {
                        best_ang = ang;
                        best_d = d;
                        cand = j;
                    }
                }
            }
            cand
        };

        let mut np = Vec::with_capacity(n + hc + 2);
        np.extend_from_slice(&poly[..=pi]);
        for k in 0..=hc {
            np.push(h0 + (mi + k) % hc);
        }
        np.push(poly[pi]);
        np.extend_from_slice(&poly[pi + 1..]);
        poly = np;
    }

    ear_clip(pts, &poly)
}

fn ear_clip(pts: &[P], poly: &[usize]) -> Vec<u32> {
    let mut idx: Vec<usize> = poly.to_vec();
    let mut tris: Vec<u32> = Vec::with_capacity(idx.len() * 3);
    let mut k = 0usize;
    let mut fails = 0usize;
    while idx.len() > 3 {
        let n = idx.len();
        if k >= n {
            k = 0;
        }
        let ia = idx[(k + n - 1) % n];
        let ib = idx[k];
        let ic = idx[(k + 1) % n];
        let (a, b, c) = (pts[ia], pts[ib], pts[ic]);
        // near-collinear vertices (straight edges after resampling) are accepted as
        // zero-area ears so every particle stays in the mesh and the fill follows it
        let tol = 1e-3 * (((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)) * ((c.0 - b.0).powi(2) + (c.1 - b.1).powi(2))).sqrt();
        let mut ear = cross(a, b, c) > -tol;
        if ear {
            for &v in idx.iter() {
                if v == ia || v == ib || v == ic {
                    continue;
                }
                let p = pts[v];
                if same(p, a) || same(p, b) || same(p, c) {
                    continue;
                }
                if in_tri_strict(p, a, b, c) {
                    ear = false;
                    break;
                }
            }
        }
        if ear {
            tris.extend_from_slice(&[ia as u32, ib as u32, ic as u32]);
            idx.remove(k);
            fails = 0;
            k = k.saturating_sub(1);
        } else {
            k += 1;
            fails += 1;
            if fails > n {
                // numerically stuck: drop the flattest vertex and carry on
                let mut best = 0;
                let mut best_a = f32::INFINITY;
                for j in 0..n {
                    let a = pts[idx[(j + n - 1) % n]];
                    let b = pts[idx[j]];
                    let c = pts[idx[(j + 1) % n]];
                    let ar = cross(a, b, c).abs();
                    if ar < best_a {
                        best_a = ar;
                        best = j;
                    }
                }
                let ia = idx[(best + n - 1) % n];
                let ib = idx[best];
                let ic = idx[(best + 1) % n];
                tris.extend_from_slice(&[ia as u32, ib as u32, ic as u32]);
                idx.remove(best);
                fails = 0;
                k = 0;
            }
        }
    }
    if idx.len() == 3 {
        tris.extend_from_slice(&[idx[0] as u32, idx[1] as u32, idx[2] as u32]);
    }
    tris
}
