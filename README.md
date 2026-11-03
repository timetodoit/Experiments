# Experiments

Interactive experiments — rendering, simulation and interface ideas that don't need a reason to exist.

**Live:** https://timetodoit.github.io/Experiments/

| # | Experiment | Stack |
|---|-----------|-------|
| 01 | [Field Station 04](./01-field-station) — a field survey of a wetland that does not exist | WebGPU · WGSL · Rust → WebAssembly |

Each experiment is a self-contained folder with its own `package.json`. GitHub Actions builds every folder that has one and publishes the result to GitHub Pages under `/<folder>/`, with `index.html` at the root as the index.
