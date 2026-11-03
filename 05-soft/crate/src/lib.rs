//! SOFT — physics core for a festival of squishy things.
//!
//! Pipeline, all in Rust:
//!   1. `contour`     — marching squares over a Canvas2D glyph bitmap, Douglas–Peucker,
//!                      even arc-length resampling, outer/hole classification.
//!   2. `triangulate` — ear clipping with hole bridging (rest pose, once per glyph).
//!   3. `world`       — shape-matching soft bodies (Müller et al. 2005) with linear
//!                      deformation, an area/gas-pressure constraint, point-vs-polygon
//!                      collisions, friction, static DOM obstacles and pointer springs.
//!
//! Everything the renderer needs is exposed as raw pointers into linear memory so the
//! TypeScript side can build zero-copy typed-array views each frame.

mod contour;
mod triangulate;
mod world;

pub use world::World;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn core_version() -> String {
    format!("soft.rs {}", env!("CARGO_PKG_VERSION"))
}
