/* @ts-self-types="./soft.d.ts" */

export class World {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorldFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_world_free(ptr, 0);
    }
    /**
     * Marching squares + simplification + resampling + triangulation.
     * `alpha` is one byte per pixel (w × h). Returns the template id.
     * @param {Uint8Array | number[]} alpha
     * @param {number} w
     * @param {number} h
     * @param {number} unit
     * @param {number} spacing
     * @returns {number}
     */
    add_template(alpha, w, h, unit, spacing) {
        const val2 = +w;
        const val3 = +h;
        const val4 = +unit;
        const val5 = +spacing;
        const ptr0 = passArray8ToWasm0(alpha, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.world_add_template(this.__wbg_ptr, ptr0, len0, val2, val3, val4, val5);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    body_count() {
        const ret = wasm.world_body_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {boolean}
     */
    body_grounded(i) {
        const ret = wasm.world_body_grounded(this.__wbg_ptr, i);
        return ret !== 0;
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    body_kind(i) {
        const ret = wasm.world_body_kind(this.__wbg_ptr, i);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    body_pop(i) {
        const ret = wasm.world_body_pop(this.__wbg_ptr, i);
        return ret;
    }
    /**
     * @returns {number}
     */
    body_ptr() {
        const ret = wasm.world_body_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    body_speed(i) {
        const ret = wasm.world_body_speed(this.__wbg_ptr, i);
        return ret;
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    body_top(i) {
        const ret = wasm.world_body_top(this.__wbg_ptr, i);
        return ret;
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    body_x(i) {
        const ret = wasm.world_body_x(this.__wbg_ptr, i);
        return ret;
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    body_y(i) {
        const ret = wasm.world_body_y(this.__wbg_ptr, i);
        return ret;
    }
    clear() {
        wasm.world_clear(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    contact_count() {
        const ret = wasm.world_contact_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     */
    drag(x, y) {
        wasm.world_drag(this.__wbg_ptr, x, y);
    }
    /**
     * @returns {number}
     */
    event_count() {
        const ret = wasm.world_event_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    events_ptr() {
        const ret = wasm.world_events_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    fill_len() {
        const ret = wasm.world_fill_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    fill_ptr() {
        const ret = wasm.world_fill_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    generation() {
        const ret = wasm.world_generation(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Grab the body under the pointer: particles within `radius` get a soft spring.
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @returns {number}
     */
    grab(x, y, radius) {
        const ret = wasm.world_grab(this.__wbg_ptr, x, y, radius);
        return ret;
    }
    /**
     * @returns {number}
     */
    grabbed() {
        const ret = wasm.world_grabbed(this.__wbg_ptr);
        return ret;
    }
    /**
     * Topmost body under (x, y), or within `slop` px of its contour. -1 if none.
     * @param {number} x
     * @param {number} y
     * @param {number} slop
     * @returns {number}
     */
    hit(x, y, slop) {
        const ret = wasm.world_hit(this.__wbg_ptr, x, y, slop);
        return ret;
    }
    /**
     * Radial velocity kick (poke / scatter).
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @param {number} strength
     */
    impulse(x, y, radius, strength) {
        wasm.world_impulse(this.__wbg_ptr, x, y, radius, strength);
    }
    /**
     * Wobble every body along its normals (used when the pressure hits max).
     * @param {number} amount
     */
    jiggle(amount) {
        wasm.world_jiggle(this.__wbg_ptr, amount);
    }
    /**
     * @param {number} width
     * @param {number} height
     */
    constructor(width, height) {
        const ret = wasm.world_new(width, height);
        this.__wbg_ptr = ret;
        WorldFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    point_count() {
        const ret = wasm.world_point_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Start deflating a body. Poll `body_pop` — it reaches 1 when fully deflated.
     * @param {number} i
     */
    pop(i) {
        wasm.world_pop(this.__wbg_ptr, i);
    }
    /**
     * @returns {number}
     */
    pts_ptr() {
        const ret = wasm.world_pts_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * True when no live body's bounds (padded by the collision radius) touch the rect.
     * Used to pick spawn spots: a body born inside another can end up interlocked.
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @returns {boolean}
     */
    region_free(x0, y0, x1, y1) {
        const ret = wasm.world_region_free(this.__wbg_ptr, x0, y0, x1, y1);
        return ret !== 0;
    }
    release() {
        wasm.world_release(this.__wbg_ptr);
    }
    /**
     * @param {number} i
     */
    remove_body(i) {
        wasm.world_remove_body(this.__wbg_ptr, i);
    }
    /**
     * Reset a body to its rest pose (used after a pop). `grow` < 1 inflates it back in.
     * @param {number} i
     * @param {number} cx
     * @param {number} cy
     * @param {number} angle
     * @param {number} grow
     */
    respawn(i, cx, cy, angle, grow) {
        wasm.world_respawn(this.__wbg_ptr, i, cx, cy, angle, grow);
    }
    /**
     * @returns {number}
     */
    ring_count() {
        const ret = wasm.world_ring_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    ring_ptr() {
        const ret = wasm.world_ring_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} left
     * @param {number} top
     * @param {number} right
     * @param {number} bottom
     */
    set_bounds(left, top, right, bottom) {
        wasm.world_set_bounds(this.__wbg_ptr, left, top, right, bottom);
    }
    /**
     * @param {number} i
     * @param {number} r
     * @param {number} g
     * @param {number} b
     */
    set_color(i, r, g, b) {
        wasm.world_set_color(this.__wbg_ptr, i, r, g, b);
    }
    /**
     * @param {number} gx
     * @param {number} gy
     */
    set_gravity(gx, gy) {
        wasm.world_set_gravity(this.__wbg_ptr, gx, gy);
    }
    /**
     * Target area multiplier (gas pressure). 1 = rest.
     * @param {number} f
     */
    set_inflate(f) {
        wasm.world_set_inflate(this.__wbg_ptr, f);
    }
    /**
     * Static rects: [x, y, w, h, ground] * n. `ground` = 1 roots the stack graph.
     * @param {Float32Array | number[]} data
     */
    set_obstacles(data) {
        const ptr0 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.world_set_obstacles(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} k
     */
    set_pressure(k) {
        wasm.world_set_pressure(this.__wbg_ptr, k);
    }
    /**
     * Collision thickness, CSS px (usually the rendered outline width).
     * @param {number} r
     */
    set_radius(r) {
        wasm.world_set_radius(this.__wbg_ptr, r);
    }
    /**
     * 0 = jelly, 1 = rubber.
     * @param {number} s
     */
    set_stiffness(s) {
        wasm.world_set_stiffness(this.__wbg_ptr, s);
    }
    /**
     * @param {number} n
     */
    set_substeps(n) {
        wasm.world_set_substeps(this.__wbg_ptr, n);
    }
    /**
     * @param {number} t
     * @param {number} cx
     * @param {number} cy
     * @param {number} angle
     * @param {number} scale
     * @param {number} grow
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} kind
     * @returns {number}
     */
    spawn(t, cx, cy, angle, scale, grow, r, g, b, kind) {
        const ret = wasm.world_spawn(this.__wbg_ptr, t, cx, cy, angle, scale, grow, r, g, b, kind);
        return ret;
    }
    /**
     * @returns {number}
     */
    stack_top() {
        const ret = wasm.world_stack_top(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} dt
     */
    step(dt) {
        wasm.world_step(this.__wbg_ptr, dt);
    }
    /**
     * @returns {number}
     */
    strip_len() {
        const ret = wasm.world_strip_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    strip_ptr() {
        const ret = wasm.world_strip_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    template_count() {
        const ret = wasm.world_template_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} t
     * @returns {number}
     */
    template_height(t) {
        const ret = wasm.world_template_height(this.__wbg_ptr, t);
        return ret;
    }
    /**
     * @param {number} t
     * @returns {number}
     */
    template_holes(t) {
        const ret = wasm.world_template_holes(this.__wbg_ptr, t);
        return ret >>> 0;
    }
    /**
     * @param {number} t
     * @returns {number}
     */
    template_points(t) {
        const ret = wasm.world_template_points(this.__wbg_ptr, t);
        return ret >>> 0;
    }
    /**
     * @param {number} t
     * @returns {number}
     */
    template_rings(t) {
        const ret = wasm.world_template_rings(this.__wbg_ptr, t);
        return ret >>> 0;
    }
    /**
     * @param {number} t
     * @returns {number}
     */
    template_triangles(t) {
        const ret = wasm.world_template_triangles(this.__wbg_ptr, t);
        return ret >>> 0;
    }
    /**
     * @param {number} t
     * @returns {number}
     */
    template_width(t) {
        const ret = wasm.world_template_width(this.__wbg_ptr, t);
        return ret;
    }
}
if (Symbol.dispose) World.prototype[Symbol.dispose] = World.prototype.free;

/**
 * @returns {string}
 */
export function core_version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.core_version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./soft_bg.js": import0,
    };
}

const WorldFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_world_free(ptr, 1));

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('soft_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
