/* tslint:disable */
/* eslint-disable */

export class Cloth {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * xyz of every clip anchor on the top row.
     */
    clip_positions(): Float32Array;
    constraint_count(): number;
    /**
     * Cut every live stick whose xy projection crosses segment A→B. Returns cut count.
     */
    cut(ax: number, ay: number, bx: number, by: number): number;
    drag_to(x: number, y: number, z: number): void;
    grab(i: number): void;
    /**
     * Push particles near (x, y) on the z≈0 plane with a velocity impulse.
     */
    gust(x: number, y: number, vx: number, vy: number, radius: number): void;
    indices_len(): number;
    indices_ptr(): number;
    iterations(): number;
    max_indices(): number;
    constructor(cols: number, rows: number, width: number, height: number);
    particle(i: number): Float32Array;
    particle_count(): number;
    /**
     * Nearest particle to a ray (perpendicular distance), or -1.
     */
    pick(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max_dist: number): number;
    release(): void;
    /**
     * Release every pin: the sheet drops.
     */
    release_pins(): void;
    set_floor(y: number): void;
    set_iterations(n: number): void;
    set_tear_ratio(r: number): void;
    set_wind(w: number): void;
    step(dt: number): void;
    /**
     * Returns true once after topology changed (indices must be re-uploaded).
     */
    take_dirty(): boolean;
    torn(): number;
    verts_len(): number;
    verts_ptr(): number;
}

export class World {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds a rectangle. Returns its body index.
     */
    add_body(cx: number, cy: number, w: number, h: number, angle: number, is_static: boolean): number;
    /**
     * Radial impulse (px of displacement per step) around a point.
     */
    blast(x: number, y: number, radius: number, strength: number): void;
    body_count(): number;
    contacts(): number;
    drag_end(): void;
    drag_move(px: number, py: number): void;
    /**
     * Start dragging the body under (px, py). Returns body index or -1.
     */
    drag_start(px: number, py: number): number;
    iterations(): number;
    constructor(width: number, height: number);
    out_ptr(): number;
    /**
     * Teleport a body (used to re-place static obstacles on resize, or respawn).
     */
    place(body: number, cx: number, cy: number, w: number, h: number, angle: number): void;
    resize(width: number, height: number): void;
    set_gravity(gx: number, gy: number): void;
    step(dt: number): void;
}

export function core_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_cloth_free: (a: number, b: number) => void;
    readonly __wbg_world_free: (a: number, b: number) => void;
    readonly cloth_clip_positions: (a: number) => [number, number];
    readonly cloth_constraint_count: (a: number) => number;
    readonly cloth_cut: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly cloth_drag_to: (a: number, b: number, c: number, d: number) => void;
    readonly cloth_grab: (a: number, b: number) => void;
    readonly cloth_gust: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly cloth_indices_len: (a: number) => number;
    readonly cloth_indices_ptr: (a: number) => number;
    readonly cloth_iterations: (a: number) => number;
    readonly cloth_max_indices: (a: number) => number;
    readonly cloth_new: (a: number, b: number, c: number, d: number) => number;
    readonly cloth_particle: (a: number, b: number) => [number, number];
    readonly cloth_particle_count: (a: number) => number;
    readonly cloth_pick: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly cloth_release: (a: number) => void;
    readonly cloth_release_pins: (a: number) => void;
    readonly cloth_set_floor: (a: number, b: number) => void;
    readonly cloth_set_iterations: (a: number, b: number) => void;
    readonly cloth_set_tear_ratio: (a: number, b: number) => void;
    readonly cloth_set_wind: (a: number, b: number) => void;
    readonly cloth_step: (a: number, b: number) => void;
    readonly cloth_take_dirty: (a: number) => number;
    readonly cloth_torn: (a: number) => number;
    readonly cloth_verts_len: (a: number) => number;
    readonly cloth_verts_ptr: (a: number) => number;
    readonly core_version: () => [number, number];
    readonly world_add_body: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly world_blast: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_body_count: (a: number) => number;
    readonly world_contacts: (a: number) => number;
    readonly world_drag_end: (a: number) => void;
    readonly world_drag_move: (a: number, b: number, c: number) => void;
    readonly world_drag_start: (a: number, b: number, c: number) => number;
    readonly world_iterations: (a: number) => number;
    readonly world_new: (a: number, b: number) => number;
    readonly world_out_ptr: (a: number) => number;
    readonly world_place: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly world_resize: (a: number, b: number, c: number) => void;
    readonly world_set_gravity: (a: number, b: number, c: number) => void;
    readonly world_step: (a: number, b: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
