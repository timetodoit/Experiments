# Experiments

Interactive experiments — rendering, simulation and interface ideas that don't need a reason to exist.

**Live:** https://timetodoit.github.io/Experiments/

| # | Experiment | Stack |
|---|-----------|-------|
| 01 | [Field Station 04](./01-field-station) — a field survey of a wetland that does not exist | WebGPU · WGSL compute · Rust → WASM cloth + rigid bodies |
| 02 | [Meridian](./02-meridian) — a day in ink | WebGPU stable-fluids sim (11 WGSL compute kernels) · liquid-glass refraction · time-of-day palettes |
| 03 | [Hollow Monument](./03-hollow-monument) — a LiDAR survey of a building that was never built | Rust SDF point-cloud generation + ray pick · WGSL compute morphs/physics · HDR post · scroll flythrough |
| 04 | [Signal FM](./04-signal-fm) — four stations broadcasting from nowhere | WGSL raymarching → ASCII glyph pass · Web Audio generative synthesis · tactile FM dial |
| 05 | [SOFT](./05-soft) — a festival of squishy things | Rust marching squares + shape-matching soft bodies · WebGPU/WGSL renderer · Web Audio · stacking game |

Each experiment is a self-contained folder with its own `package.json`. GitHub Actions builds every folder that has one and publishes the result to GitHub Pages under `/<folder>/`, with `index.html` at the root as the index.
