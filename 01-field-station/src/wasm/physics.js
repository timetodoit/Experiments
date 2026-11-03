/* @ts-self-types="./physics.d.ts" */

export class Cloth {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ClothFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_cloth_free(ptr, 0);
    }
    /**
     * xyz of every clip anchor on the top row.
     * @returns {Float32Array}
     */
    clip_positions() {
        const ret = wasm.cloth_clip_positions(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    constraint_count() {
        const ret = wasm.cloth_constraint_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Cut every live stick whose xy projection crosses segment A→B. Returns cut count.
     * @param {number} ax
     * @param {number} ay
     * @param {number} bx
     * @param {number} by
     * @returns {number}
     */
    cut(ax, ay, bx, by) {
        const ret = wasm.cloth_cut(this.__wbg_ptr, ax, ay, bx, by);
        return ret >>> 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    drag_to(x, y, z) {
        wasm.cloth_drag_to(this.__wbg_ptr, x, y, z);
    }
    /**
     * @param {number} i
     */
    grab(i) {
        wasm.cloth_grab(this.__wbg_ptr, i);
    }
    /**
     * Push particles near (x, y) on the z≈0 plane with a velocity impulse.
     * @param {number} x
     * @param {number} y
     * @param {number} vx
     * @param {number} vy
     * @param {number} radius
     */
    gust(x, y, vx, vy, radius) {
        wasm.cloth_gust(this.__wbg_ptr, x, y, vx, vy, radius);
    }
    /**
     * @returns {number}
     */
    indices_len() {
        const ret = wasm.cloth_indices_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    indices_ptr() {
        const ret = wasm.cloth_indices_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    iterations() {
        const ret = wasm.cloth_iterations(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    max_indices() {
        const ret = wasm.cloth_max_indices(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} cols
     * @param {number} rows
     * @param {number} width
     * @param {number} height
     */
    constructor(cols, rows, width, height) {
        const ret = wasm.cloth_new(cols, rows, width, height);
        this.__wbg_ptr = ret;
        ClothFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} i
     * @returns {Float32Array}
     */
    particle(i) {
        const ret = wasm.cloth_particle(this.__wbg_ptr, i);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    particle_count() {
        const ret = wasm.cloth_particle_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Nearest particle to a ray (perpendicular distance), or -1.
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @param {number} max_dist
     * @returns {number}
     */
    pick(ox, oy, oz, dx, dy, dz, max_dist) {
        const ret = wasm.cloth_pick(this.__wbg_ptr, ox, oy, oz, dx, dy, dz, max_dist);
        return ret;
    }
    release() {
        wasm.cloth_release(this.__wbg_ptr);
    }
    /**
     * Release every pin: the sheet drops.
     */
    release_pins() {
        wasm.cloth_release_pins(this.__wbg_ptr);
    }
    /**
     * @param {number} y
     */
    set_floor(y) {
        wasm.cloth_set_floor(this.__wbg_ptr, y);
    }
    /**
     * @param {number} n
     */
    set_iterations(n) {
        wasm.cloth_set_iterations(this.__wbg_ptr, n);
    }
    /**
     * @param {number} r
     */
    set_tear_ratio(r) {
        wasm.cloth_set_tear_ratio(this.__wbg_ptr, r);
    }
    /**
     * @param {number} w
     */
    set_wind(w) {
        wasm.cloth_set_wind(this.__wbg_ptr, w);
    }
    /**
     * @param {number} dt
     */
    step(dt) {
        wasm.cloth_step(this.__wbg_ptr, dt);
    }
    /**
     * Returns true once after topology changed (indices must be re-uploaded).
     * @returns {boolean}
     */
    take_dirty() {
        const ret = wasm.cloth_take_dirty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    torn() {
        const ret = wasm.cloth_torn(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    verts_len() {
        const ret = wasm.cloth_verts_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    verts_ptr() {
        const ret = wasm.cloth_verts_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) Cloth.prototype[Symbol.dispose] = Cloth.prototype.free;

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
     * Adds a rectangle. Returns its body index.
     * @param {number} cx
     * @param {number} cy
     * @param {number} w
     * @param {number} h
     * @param {number} angle
     * @param {boolean} is_static
     * @returns {number}
     */
    add_body(cx, cy, w, h, angle, is_static) {
        const ret = wasm.world_add_body(this.__wbg_ptr, cx, cy, w, h, angle, is_static);
        return ret >>> 0;
    }
    /**
     * Radial impulse (px of displacement per step) around a point.
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @param {number} strength
     */
    blast(x, y, radius, strength) {
        wasm.world_blast(this.__wbg_ptr, x, y, radius, strength);
    }
    /**
     * @returns {number}
     */
    body_count() {
        const ret = wasm.world_body_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    contacts() {
        const ret = wasm.world_contacts(this.__wbg_ptr);
        return ret >>> 0;
    }
    drag_end() {
        wasm.world_drag_end(this.__wbg_ptr);
    }
    /**
     * @param {number} px
     * @param {number} py
     */
    drag_move(px, py) {
        wasm.world_drag_move(this.__wbg_ptr, px, py);
    }
    /**
     * Start dragging the body under (px, py). Returns body index or -1.
     * @param {number} px
     * @param {number} py
     * @returns {number}
     */
    drag_start(px, py) {
        const ret = wasm.world_drag_start(this.__wbg_ptr, px, py);
        return ret;
    }
    /**
     * @returns {number}
     */
    iterations() {
        const ret = wasm.world_iterations(this.__wbg_ptr);
        return ret >>> 0;
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
    out_ptr() {
        const ret = wasm.world_out_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Teleport a body (used to re-place static obstacles on resize, or respawn).
     * @param {number} body
     * @param {number} cx
     * @param {number} cy
     * @param {number} w
     * @param {number} h
     * @param {number} angle
     */
    place(body, cx, cy, w, h, angle) {
        wasm.world_place(this.__wbg_ptr, body, cx, cy, w, h, angle);
    }
    /**
     * @param {number} width
     * @param {number} height
     */
    resize(width, height) {
        wasm.world_resize(this.__wbg_ptr, width, height);
    }
    /**
     * @param {number} gx
     * @param {number} gy
     */
    set_gravity(gx, gy) {
        wasm.world_set_gravity(this.__wbg_ptr, gx, gy);
    }
    /**
     * @param {number} dt
     */
    step(dt) {
        wasm.world_step(this.__wbg_ptr, dt);
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
        "./physics_bg.js": import0,
    };
}

const ClothFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_cloth_free(ptr, 1));
const WorldFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_world_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

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
        module_or_path = new URL('physics_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
