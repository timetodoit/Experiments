//! Field Station 04 — physics core.
//!
//! Two simulations live here and are driven from TypeScript every frame:
//!   * `Cloth` — a tearable position-based (verlet) herbarium sheet, rendered by WebGPU.
//!   * `World` — 2D verlet rigid bodies with SAT collision, rendered as DOM nodes.
//!
//! Both expose raw pointers into linear memory so JS can build typed-array views
//! with zero copies.

mod bodies;
mod cloth;

pub use bodies::World;
pub use cloth::Cloth;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn core_version() -> String {
    format!("physics.rs {}", env!("CARGO_PKG_VERSION"))
}
