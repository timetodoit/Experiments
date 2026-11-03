# 01 — Field Station 04

> A field survey of a wetland that does not exist.

An experimental single page in four movements, inspired by HUD scanners, botanical field maps and DOM inspector overlays.

| Section | What happens | Tech |
|---|---|---|
| **01 Survey** | Procedural terrain drawn as per-pixel contours. 131,072 pollen particles flow downhill along the terrain gradient. A morphing, grid-snapped scanner lens reveals a thermal halftone view. **Hold** to sink the ground (the pollen drains into it), **click** for a seismic pulse that ripples the contours and blasts the particles. Scroll to zoom. | WebGPU, WGSL compute + instanced quads |
| **02 Specimen** | A herbarium sheet hanging from five clips is a verlet cloth (2,091 particles, ~12k constraints) solved in Rust. Pull it, **Shift-drag** to cut it, drop it, watch torn pieces crumple on the floor. Texture is painted procedurally on a canvas. | Rust → WASM, zero-copy vertex streaming, WebGPU MSAA |
| **03 Taxonomy** | 36 descriptor tags are 2D rigid bodies (4 particles + 6 sticks each) with separating-axis collisions in Rust. They land on the words of the headline. Drag, throw, flip gravity, scatter. | Rust → WASM, DOM transforms |
| **04 Inspect** | Press **X** anywhere: the live page explodes into isometric layers and every node is annotated with the font, size, line-height and weight it's actually rendered with. | CSS 3D, computed styles |

Without WebGPU it falls back to a Canvas2D "degraded survey" running the same terrain function on the CPU; the Rust physics still runs.

## Develop

```bash
npm install
npm run dev
```

The compiled WASM lives in `src/wasm/` and is committed, so Node is all you need. To change the physics, install Rust + `wasm-pack` and rebuild:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
npm run wasm
```

## Map

```
crate/src/cloth.rs     tearable verlet cloth (pick, drag, gust, cut, floor)
crate/src/bodies.rs    verlet rigid bodies + SAT collision
src/gpu/survey.wgsl    terrain, lens, particle compute + render
src/gpu/sheet.wgsl     cloth shading, x-ray grid, sheared drop shadow
src/surveyCtl.ts       pointer → lens spring, layouts, markers, readouts
src/specimen.ts        cloth controller        src/taxonomy.ts   rigid body controller
src/xray.ts            isometric inspector     src/fallback.ts   Canvas2D path
```
