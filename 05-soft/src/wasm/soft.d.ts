/* tslint:disable */
/* eslint-disable */

export class World {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Marching squares + simplification + resampling + triangulation.
     * `alpha` is one byte per pixel (w × h). Returns the template id.
     */
    add_template(alpha: Uint8Array | number[], w: number, h: number, unit: number, spacing: number): number;
    body_count(): number;
    body_grounded(i: number): boolean;
    body_kind(i: number): number;
    body_pop(i: number): number;
    body_ptr(): number;
    body_speed(i: number): number;
    body_top(i: number): number;
    body_x(i: number): number;
    body_y(i: number): number;
    clear(): void;
    contact_count(): number;
    drag(x: number, y: number): void;
    event_count(): number;
    events_ptr(): number;
    fill_len(): number;
    fill_ptr(): number;
    generation(): number;
    /**
     * Grab the body under the pointer: particles within `radius` get a soft spring.
     */
    grab(x: number, y: number, radius: number): number;
    grabbed(): number;
    /**
     * Topmost body under (x, y), or within `slop` px of its contour. -1 if none.
     */
    hit(x: number, y: number, slop: number): number;
    /**
     * Radial velocity kick (poke / scatter).
     */
    impulse(x: number, y: number, radius: number, strength: number): void;
    /**
     * Wobble every body along its normals (used when the pressure hits max).
     */
    jiggle(amount: number): void;
    constructor(width: number, height: number);
    point_count(): number;
    /**
     * Start deflating a body. Poll `body_pop` — it reaches 1 when fully deflated.
     */
    pop(i: number): void;
    pts_ptr(): number;
    /**
     * True when no live body's bounds (padded by the collision radius) touch the rect.
     * Used to pick spawn spots: a body born inside another can end up interlocked.
     */
    region_free(x0: number, y0: number, x1: number, y1: number): boolean;
    release(): void;
    remove_body(i: number): void;
    /**
     * Reset a body to its rest pose (used after a pop). `grow` < 1 inflates it back in.
     */
    respawn(i: number, cx: number, cy: number, angle: number, grow: number): void;
    ring_count(): number;
    ring_ptr(): number;
    set_bounds(left: number, top: number, right: number, bottom: number): void;
    set_color(i: number, r: number, g: number, b: number): void;
    set_gravity(gx: number, gy: number): void;
    /**
     * Target area multiplier (gas pressure). 1 = rest.
     */
    set_inflate(f: number): void;
    /**
     * Static rects: [x, y, w, h, ground] * n. `ground` = 1 roots the stack graph.
     */
    set_obstacles(data: Float32Array | number[]): void;
    set_pressure(k: number): void;
    /**
     * Collision thickness, CSS px (usually the rendered outline width).
     */
    set_radius(r: number): void;
    /**
     * 0 = jelly, 1 = rubber.
     */
    set_stiffness(s: number): void;
    set_substeps(n: number): void;
    spawn(t: number, cx: number, cy: number, angle: number, scale: number, grow: number, r: number, g: number, b: number, kind: number): number;
    stack_top(): number;
    step(dt: number): void;
    strip_len(): number;
    strip_ptr(): number;
    template_count(): number;
    template_height(t: number): number;
    template_holes(t: number): number;
    template_points(t: number): number;
    template_rings(t: number): number;
    template_triangles(t: number): number;
    template_width(t: number): number;
}

export function core_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_world_free: (a: number, b: number) => void;
    readonly core_version: () => [number, number];
    readonly world_add_template: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly world_body_count: (a: number) => number;
    readonly world_body_grounded: (a: number, b: number) => number;
    readonly world_body_kind: (a: number, b: number) => number;
    readonly world_body_pop: (a: number, b: number) => number;
    readonly world_body_ptr: (a: number) => number;
    readonly world_body_speed: (a: number, b: number) => number;
    readonly world_body_top: (a: number, b: number) => number;
    readonly world_body_x: (a: number, b: number) => number;
    readonly world_body_y: (a: number, b: number) => number;
    readonly world_clear: (a: number) => void;
    readonly world_contact_count: (a: number) => number;
    readonly world_drag: (a: number, b: number, c: number) => void;
    readonly world_event_count: (a: number) => number;
    readonly world_events_ptr: (a: number) => number;
    readonly world_fill_len: (a: number) => number;
    readonly world_fill_ptr: (a: number) => number;
    readonly world_generation: (a: number) => number;
    readonly world_grab: (a: number, b: number, c: number, d: number) => number;
    readonly world_grabbed: (a: number) => number;
    readonly world_hit: (a: number, b: number, c: number, d: number) => number;
    readonly world_impulse: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_jiggle: (a: number, b: number) => void;
    readonly world_new: (a: number, b: number) => number;
    readonly world_point_count: (a: number) => number;
    readonly world_pop: (a: number, b: number) => void;
    readonly world_pts_ptr: (a: number) => number;
    readonly world_region_free: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly world_release: (a: number) => void;
    readonly world_remove_body: (a: number, b: number) => void;
    readonly world_respawn: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly world_ring_count: (a: number) => number;
    readonly world_ring_ptr: (a: number) => number;
    readonly world_set_bounds: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_set_color: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_set_gravity: (a: number, b: number, c: number) => void;
    readonly world_set_inflate: (a: number, b: number) => void;
    readonly world_set_obstacles: (a: number, b: number, c: number) => void;
    readonly world_set_pressure: (a: number, b: number) => void;
    readonly world_set_radius: (a: number, b: number) => void;
    readonly world_set_stiffness: (a: number, b: number) => void;
    readonly world_set_substeps: (a: number, b: number) => void;
    readonly world_spawn: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly world_stack_top: (a: number) => number;
    readonly world_step: (a: number, b: number) => void;
    readonly world_strip_len: (a: number) => number;
    readonly world_strip_ptr: (a: number) => number;
    readonly world_template_count: (a: number) => number;
    readonly world_template_height: (a: number, b: number) => number;
    readonly world_template_holes: (a: number, b: number) => number;
    readonly world_template_points: (a: number, b: number) => number;
    readonly world_template_rings: (a: number, b: number) => number;
    readonly world_template_triangles: (a: number, b: number) => number;
    readonly world_template_width: (a: number, b: number) => number;
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
