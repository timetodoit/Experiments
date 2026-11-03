/* @ts-self-types="./monument.d.ts" */

export class Survey {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SurveyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_survey_free(ptr, 0);
    }
    /**
     * [min x, min y, min z, max x, max y, max z]
     * @param {number} k
     * @returns {Float32Array}
     */
    bounds(k) {
        const ret = wasm.survey_bounds(this.__wbg_ptr, k);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Build the pick grid for slot k. Returns the number of cells.
     * @param {number} k
     * @param {number} cells_long_axis
     * @returns {number}
     */
    build_grid(k, cells_long_axis) {
        const ret = wasm.survey_build_grid(this.__wbg_ptr, k, cells_long_axis);
        return ret >>> 0;
    }
    /**
     * Candidates tested (or primitives touched) by the last generation of slot k.
     * @param {number} k
     * @returns {number}
     */
    candidates(k) {
        const ret = wasm.survey_candidates(this.__wbg_ptr, k);
        return ret >>> 0;
    }
    /**
     * @param {number} k
     * @returns {number}
     */
    cloud_len(k) {
        const ret = wasm.survey_cloud_len(this.__wbg_ptr, k);
        return ret >>> 0;
    }
    /**
     * @param {number} k
     * @returns {number}
     */
    cloud_ptr(k) {
        const ret = wasm.survey_cloud_ptr(this.__wbg_ptr, k);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    count() {
        const ret = wasm.survey_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} seed
     */
    gen_monument(seed) {
        wasm.survey_gen_monument(this.__wbg_ptr, seed);
    }
    /**
     * @param {number} seed
     */
    gen_nebula(seed) {
        wasm.survey_gen_nebula(this.__wbg_ptr, seed);
    }
    /**
     * @param {number} seed
     */
    gen_terrain(seed) {
        wasm.survey_gen_terrain(this.__wbg_ptr, seed);
    }
    /**
     * `mask`: w×h coverage bytes from a Canvas2D rasterisation (row 0 = top).
     * @param {Uint8Array | number[]} mask
     * @param {number} w
     * @param {number} h
     * @param {number} world_w
     * @param {number} depth
     * @param {number} y0
     * @param {number} seed
     */
    gen_type(mask, w, h, world_w, depth, y0, seed) {
        const val2 = +w;
        const val3 = +h;
        const val4 = +world_w;
        const val5 = +depth;
        const val6 = +y0;
        const val7 = +seed;
        const ptr0 = passArray8ToWasm0(mask, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.survey_gen_type(this.__wbg_ptr, ptr0, len0, val2, val3, val4, val5, val6, val7);
    }
    /**
     * Number of SDF primitives (solids + cuts) the monument is built from.
     * @returns {number}
     */
    monument_primitives() {
        const ret = wasm.survey_monument_primitives(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} n
     */
    constructor(n) {
        const ret = wasm.survey_new(n);
        this.__wbg_ptr = ret;
        SurveyFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Nearest point to the ray (o, d) within a cone of radius rk·t (capped at rmax).
     * Returns the point index or −1.
     * @param {number} k
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @param {number} rk
     * @param {number} rmax
     * @returns {number}
     */
    pick(k, ox, oy, oz, dx, dy, dz, rk, rmax) {
        const ret = wasm.survey_pick(this.__wbg_ptr, k, ox, oy, oz, dx, dy, dz, rk, rmax);
        return ret;
    }
    /**
     * @returns {number}
     */
    stride() {
        const ret = wasm.survey_stride(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) Survey.prototype[Symbol.dispose] = Survey.prototype.free;

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
        "./monument_bg.js": import0,
    };
}

const SurveyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_survey_free(ptr, 1));

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

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
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
        module_or_path = new URL('monument_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
