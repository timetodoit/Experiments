/* tslint:disable */
/* eslint-disable */

export class Survey {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * [min x, min y, min z, max x, max y, max z]
     */
    bounds(k: number): Float32Array;
    /**
     * Build the pick grid for slot k. Returns the number of cells.
     */
    build_grid(k: number, cells_long_axis: number): number;
    /**
     * Candidates tested (or primitives touched) by the last generation of slot k.
     */
    candidates(k: number): number;
    cloud_len(k: number): number;
    cloud_ptr(k: number): number;
    count(): number;
    gen_monument(seed: number): void;
    gen_nebula(seed: number): void;
    gen_terrain(seed: number): void;
    /**
     * `mask`: w×h coverage bytes from a Canvas2D rasterisation (row 0 = top).
     */
    gen_type(mask: Uint8Array | number[], w: number, h: number, world_w: number, depth: number, y0: number, seed: number): void;
    /**
     * Number of SDF primitives (solids + cuts) the monument is built from.
     */
    monument_primitives(): number;
    constructor(n: number);
    /**
     * Nearest point to the ray (o, d) within a cone of radius rk·t (capped at rmax).
     * Returns the point index or −1.
     */
    pick(k: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, rk: number, rmax: number): number;
    stride(): number;
}

export function core_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_survey_free: (a: number, b: number) => void;
    readonly core_version: () => [number, number];
    readonly survey_bounds: (a: number, b: number) => [number, number];
    readonly survey_build_grid: (a: number, b: number, c: number) => number;
    readonly survey_candidates: (a: number, b: number) => number;
    readonly survey_cloud_len: (a: number, b: number) => number;
    readonly survey_cloud_ptr: (a: number, b: number) => number;
    readonly survey_count: (a: number) => number;
    readonly survey_gen_monument: (a: number, b: number) => void;
    readonly survey_gen_nebula: (a: number, b: number) => void;
    readonly survey_gen_terrain: (a: number, b: number) => void;
    readonly survey_gen_type: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly survey_monument_primitives: (a: number) => number;
    readonly survey_new: (a: number) => number;
    readonly survey_pick: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly survey_stride: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
