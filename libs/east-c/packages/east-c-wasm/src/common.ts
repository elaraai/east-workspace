/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @elaraai/east-c-wasm/common
 *
 * Platform-agnostic core for east-c-wasm. Provides a high-level interface
 * matching east-py's pattern: compile(ir, platform) → callable.
 */

import {
    type EastTypeValue,
    ArrayType,
    EastTypeType,
} from "@elaraai/east";
import {
    type PlatformFunction,
    encodeBeast2For,
    decodeBeast2For,
    SortedSet,
    SortedMap,
} from "@elaraai/east/internal";
import { variant } from "@elaraai/east";

// Extend EmscriptenModule with east-c-wasm specific C exports
export interface EastWasmModule extends EmscriptenModule {
    UTF8ToString: (ptr: number, maxBytesToRead?: number) => string;
    stringToUTF8: (str: string, outPtr: number, maxBytesToRead?: number) => void;
    lengthBytesUTF8: (str: string) => number;
    _east_wasm_init: () => void;
    _east_wasm_register_platform: (namePtr: number, isGeneric: number, isAsync: number) => void;
    _east_wasm_compile: (irPtr: number, irLen: number) => number;
    _east_wasm_compile_json: (jsonPtr: number, jsonLen: number) => number;
    _east_wasm_compile_east: (textPtr: number, textLen: number) => number;
    _east_wasm_call: (handle: number, resultPtr: number, resultLenPtr: number, errorPtr: number, errorLenPtr: number) => number;
    _east_wasm_call_with_args: (handle: number, argsPtr: number, argsLen: number, resultPtr: number, resultLenPtr: number, errorPtr: number, errorLenPtr: number) => number;
    _east_wasm_free: (handle: number) => void;
    _east_wasm_gc: () => void;
    _east_wasm_malloc: (size: number) => number;
    _east_wasm_free_buf: (ptr: number) => void;
    _east_wasm_last_error: () => number;
    _east_wasm_invoke_fn: (handleId: number, argsPtr: number, argsLen: number, resultPtr: number, resultLenPtr: number, errorPtr: number, errorLenPtr: number) => number;
    _east_wasm_get_fn_type: (handle: number, outPtr: number, outLenPtr: number) => number;
    // Direct value accessors (pointer-based, no beast2)
    _east_wasm_value_kind: (ptr: number) => number;
    _east_wasm_get_bool: (ptr: number) => number;
    _east_wasm_get_number: (ptr: number) => number;
    _east_wasm_get_string_ptr: (ptr: number) => number;
    _east_wasm_get_string_len: (ptr: number) => number;
    _east_wasm_get_blob_ptr: (ptr: number) => number;
    _east_wasm_get_blob_len: (ptr: number) => number;
    _east_wasm_collection_len: (ptr: number) => number;
    _east_wasm_array_get: (ptr: number, idx: number) => number;
    _east_wasm_set_get: (ptr: number, idx: number) => number;
    _east_wasm_dict_key: (ptr: number, idx: number) => number;
    _east_wasm_dict_value: (ptr: number, idx: number) => number;
    _east_wasm_struct_field_name: (ptr: number, idx: number) => number;
    _east_wasm_struct_field_value: (ptr: number, idx: number) => number;
    _east_wasm_variant_tag: (ptr: number) => number;
    _east_wasm_variant_value: (ptr: number) => number;
    _east_wasm_ref_get: (ptr: number) => number;
    _east_wasm_vector_data: (ptr: number) => number;
    _east_wasm_vector_len: (ptr: number) => number;
    _east_wasm_matrix_data: (ptr: number) => number;
    _east_wasm_matrix_rows: (ptr: number) => number;
    _east_wasm_matrix_cols: (ptr: number) => number;
    _east_wasm_value_release: (ptr: number) => void;
    _east_wasm_call_ptr: (handle: number, errorPtr: number, errorLenPtr: number) => number;
    _east_wasm_call_ptr_with_args: (handle: number, argsPtr: number, argsLen: number, errorPtr: number, errorLenPtr: number) => number;
    _east_wasm_decode_value: (dataPtr: number, dataLen: number, errorPtr: number, errorLenPtr: number) => number;
}

/** Result buffer size (1MB) — matches C side */
const RESULT_BUF_SIZE = 1024 * 1024;

/** Error buffer size (64KB) */
const ERROR_BUF_SIZE = 64 * 1024;

/**
 * Compiled function — callable with native JS values, backed by WASM.
 * Call free() when done to release the WASM handle.
 */
export interface CompiledFunction {
    (...args: unknown[]): unknown;
    free(): void;
}

/**
 * Options for creating an EastWasm instance.
 */
export interface EastWasmOptions {
    wasmUrl?: string | undefined;
    glueUrl?: string | undefined;
}

/**
 * EastWasm instance. Compile East IR to callable functions.
 */
export interface EastWasm {
    /** Compile East IR from JSON bytes — no JS IR round-trip. */
    compileFromJson(json: Uint8Array, platform?: PlatformFunction[]): CompiledFunction;

    /** Compile East IR from Beast2-full encoded bytes. */
    compileFromBeast2(bytes: Uint8Array, platform?: PlatformFunction[]): CompiledFunction;

    /** Compile East IR from East text format. */
    compileFromEast(text: string, platform?: PlatformFunction[]): CompiledFunction;

    /** Decode a beast2 data value (any type) — no IR, no compilation. */
    decodeValue(bytes: Uint8Array): unknown;

    /** Run garbage collection on the WASM heap. */
    gc(): void;
}

// ============================================================================
// Internal types for the platform bridge
// ============================================================================

type PlatformFn = (args: Uint8Array[]) => Uint8Array | null;
type GenericPlatformFactory = (typeParamsBytes: Uint8Array) => PlatformFn;

interface PlatformRegistration {
    name: string;
    isGeneric: boolean;
    isAsync: boolean;
    fn?: PlatformFn | undefined;
    factory?: GenericPlatformFactory | undefined;
}

// ============================================================================
// Module-level state
// ============================================================================

/** Handle resolver for creating function handle wrappers in the platform bridge. */
let _handleResolver: {
    mod: EastWasmModule;
    invokeBufs: { resultBufPtr: number; errorBufPtr: number; resultLenPtr: number; errorLenPtr: number };
} | null = null;

/** Set the handle resolver. Called once after module init. */
export function setHandleResolver(mod: EastWasmModule): void {
    _handleResolver = {
        mod,
        invokeBufs: {
            resultBufPtr: mod._malloc(RESULT_BUF_SIZE),
            errorBufPtr: mod._malloc(ERROR_BUF_SIZE),
            resultLenPtr: mod._malloc(4),
            errorLenPtr: mod._malloc(4),
        },
    };
}

// ============================================================================
// Core: createEastWasmFromModule
// ============================================================================

/**
 * Create an EastWasm instance from an initialized Emscripten module.
 */
export function createEastWasmFromModule(
    mod: EastWasmModule,
    externalState?: { platformFns: Map<string, PlatformRegistration>; genericCache: Map<string, PlatformFn> },
): EastWasm {
    const platformFns = externalState?.platformFns ?? new Map<string, PlatformRegistration>();
    const genericCache = externalState?.genericCache ?? new Map<string, PlatformFn>();

    // Pre-allocate result and error buffers in WASM memory
    const resultBufPtr = mod._malloc(RESULT_BUF_SIZE);
    const errorBufPtr = mod._malloc(ERROR_BUF_SIZE);
    const resultLenPtr = mod._malloc(4);
    const errorLenPtr = mod._malloc(4);


    mod._east_wasm_init();

    function allocString(s: string): number {
        const len = mod.lengthBytesUTF8(s) + 1;
        const ptr = mod._malloc(len);
        mod.stringToUTF8(s, ptr, len);
        return ptr;
    }

    function writeBytes(data: Uint8Array): number {
        const ptr = mod._malloc(data.length);
        mod.HEAPU8.set(data, ptr);
        return ptr;
    }

    function registerPlatform(reg: PlatformRegistration): void {
        platformFns.set(reg.name, reg);
        const namePtr = allocString(reg.name);
        mod._east_wasm_register_platform(namePtr, reg.isGeneric ? 1 : 0, reg.isAsync ? 1 : 0);
        mod._free(namePtr);
    }

    function compileBeast2(irBytes: Uint8Array): number {
        const irPtr = writeBytes(irBytes);
        const handle = mod._east_wasm_compile(irPtr, irBytes.length);
        mod._free(irPtr);
        if (handle === 0) {
            const errPtr = mod._east_wasm_last_error();
            const detail = errPtr ? mod.UTF8ToString(errPtr) : 'unknown error';
            throw new Error(`east-c-wasm compile: ${detail}`);
        }
        return handle;
    }

    function compileJson(json: Uint8Array): number {
        const jsonPtr = writeBytes(json);
        const handle = mod._east_wasm_compile_json(jsonPtr, json.length);
        mod._free(jsonPtr);
        if (handle === 0) {
            const errPtr = mod._east_wasm_last_error();
            const detail = errPtr ? mod.UTF8ToString(errPtr) : 'unknown error';
            throw new Error(`east-c-wasm compile_json: ${detail}`);
        }
        return handle;
    }

    function callHandle(handle: number): Uint8Array | null {
        new DataView(mod.HEAPU8.buffer, resultLenPtr, 4).setUint32(0, RESULT_BUF_SIZE, true);
        new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).setUint32(0, ERROR_BUF_SIZE, true);

        const rc = mod._east_wasm_call(handle, resultBufPtr, resultLenPtr, errorBufPtr, errorLenPtr);

        if (rc !== 0) {
            const errLen = new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).getUint32(0, true);
            const errBytes = new Uint8Array(mod.HEAPU8.buffer, errorBufPtr, errLen);
            throw new Error(`east-c-wasm: ${new TextDecoder().decode(errBytes)}`);
        }

        const resLen = new DataView(mod.HEAPU8.buffer, resultLenPtr, 4).getUint32(0, true);
        if (resLen === 0) return null;
        return new Uint8Array(mod.HEAPU8.buffer, resultBufPtr, resLen).slice();
    }

    function callHandleWithArgs(handle: number, argsBytes: Uint8Array): Uint8Array | null {
        const argsPtr = writeBytes(argsBytes);
        new DataView(mod.HEAPU8.buffer, resultLenPtr, 4).setUint32(0, RESULT_BUF_SIZE, true);
        new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).setUint32(0, ERROR_BUF_SIZE, true);

        const rc = mod._east_wasm_call_with_args(handle, argsPtr, argsBytes.length, resultBufPtr, resultLenPtr, errorBufPtr, errorLenPtr);
        mod._free(argsPtr);

        if (rc !== 0) {
            const errLen = new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).getUint32(0, true);
            const errBytes = new Uint8Array(mod.HEAPU8.buffer, errorBufPtr, errLen);
            throw new Error(`east-c-wasm: ${new TextDecoder().decode(errBytes)}`);
        }

        const resLen = new DataView(mod.HEAPU8.buffer, resultLenPtr, 4).getUint32(0, true);
        if (resLen === 0) return null;
        return new Uint8Array(mod.HEAPU8.buffer, resultBufPtr, resLen).slice();
    }

    /** Ask C for the Beast2-encoded function type of a compiled handle, decode it once. */
    function getFnTypeFromHandle(handle: number): { inputTypes: EastTypeValue[]; outputType: EastTypeValue } {
        new DataView(mod.HEAPU8.buffer, resultLenPtr, 4).setUint32(0, RESULT_BUF_SIZE, true);

        const rc = mod._east_wasm_get_fn_type(handle, resultBufPtr, resultLenPtr);
        if (rc !== 0) {
            return { inputTypes: [], outputType: { type: 'Null' } as EastTypeValue };
        }

        const len = new DataView(mod.HEAPU8.buffer, resultLenPtr, 4).getUint32(0, true);
        const typeBytes = new Uint8Array(mod.HEAPU8.buffer, resultBufPtr, len).slice();

        const fnType = decodeBeast2For(EastTypeType)(typeBytes) as EastTypeValue;
        if (fnType.type === 'Function' || fnType.type === 'AsyncFunction') {
            return { inputTypes: fnType.value.inputs, outputType: fnType.value.output };
        }
        return { inputTypes: [], outputType: { type: 'Null' } as EastTypeValue };
    }

    function ensurePlatformRegistered(platform?: PlatformFunction[]): void {
        if (!platform) return;
        for (const reg of buildPlatformRegistrations(platform)) {
            if (platformFns.has(reg.name)) continue;
            registerPlatform(reg);
        }
    }

    /** Read an EastValue* pointer from WASM memory into a JS value. */
    function readValueFromPtr(ptr: number): unknown {
        if (ptr === 0) return null;
        const kind = mod._east_wasm_value_kind(ptr);
        switch (kind) {
        case 0: /* NULL */     return null;
        case 1: /* BOOLEAN */  return mod._east_wasm_get_bool(ptr) !== 0;
        case 2: /* INTEGER */  return BigInt(mod._east_wasm_get_number(ptr));
        case 3: /* FLOAT */    return mod._east_wasm_get_number(ptr);
        case 4: /* STRING */ {
            const sptr = mod._east_wasm_get_string_ptr(ptr);
            const slen = mod._east_wasm_get_string_len(ptr);
            return mod.UTF8ToString(sptr, slen);
        }
        case 5: /* DATETIME */ return mod._east_wasm_get_number(ptr);
        case 6: /* BLOB */ {
            const bptr = mod._east_wasm_get_blob_ptr(ptr);
            const blen = mod._east_wasm_get_blob_len(ptr);
            return new Uint8Array(mod.HEAPU8.buffer, bptr, blen).slice();
        }
        case 7: /* ARRAY */ {
            const len = mod._east_wasm_collection_len(ptr);
            const arr = new Array(len);
            for (let i = 0; i < len; i++) {
                arr[i] = readValueFromPtr(mod._east_wasm_array_get(ptr, i));
            }
            return arr;
        }
        case 8: /* SET — C stores items in sorted order, SortedSet preserves that */ {
            const len = mod._east_wasm_collection_len(ptr);
            const items: unknown[] = [];
            for (let i = 0; i < len; i++) {
                items.push(readValueFromPtr(mod._east_wasm_set_get(ptr, i)));
            }
            return new SortedSet(items);
        }
        case 9: /* DICT — C stores entries in sorted key order, SortedMap preserves that */ {
            const len = mod._east_wasm_collection_len(ptr);
            const entries: [unknown, unknown][] = [];
            for (let i = 0; i < len; i++) {
                const k = readValueFromPtr(mod._east_wasm_dict_key(ptr, i));
                const v = readValueFromPtr(mod._east_wasm_dict_value(ptr, i));
                entries.push([k, v]);
            }
            return new SortedMap(entries);
        }
        case 10: /* STRUCT */ {
            const nf = mod._east_wasm_collection_len(ptr);
            const obj: Record<string, unknown> = {};
            for (let i = 0; i < nf; i++) {
                const namePtr = mod._east_wasm_struct_field_name(ptr, i);
                const name = mod.UTF8ToString(namePtr);
                const valPtr = mod._east_wasm_struct_field_value(ptr, i);
                obj[name] = readValueFromPtr(valPtr);
            }
            return obj;
        }
        case 11: /* VARIANT */ {
            const tagPtr = mod._east_wasm_variant_tag(ptr);
            const tag = mod.UTF8ToString(tagPtr);
            const valPtr = mod._east_wasm_variant_value(ptr);
            return variant(tag, readValueFromPtr(valPtr));
        }
        case 12: /* REF */
            return readValueFromPtr(mod._east_wasm_ref_get(ptr));
        case 13: /* VECTOR */ {
            const vlen = mod._east_wasm_vector_len(ptr);
            const vdata = mod._east_wasm_vector_data(ptr);
            // Assume float64 for now (most common vector element type)
            return new Float64Array(mod.HEAPF64.buffer, vdata, vlen).slice();
        }
        case 14: /* MATRIX */ {
            const rows = mod._east_wasm_matrix_rows(ptr);
            const cols = mod._east_wasm_matrix_cols(ptr);
            const mdata = mod._east_wasm_matrix_data(ptr);
            return { rows, cols, data: new Float64Array(mod.HEAPF64.buffer, mdata, rows * cols).slice() };
        }
        case 15: /* FUNCTION */
            // Cannot marshal function values to JS — return a placeholder
            return { type: 'function', value: null };
        default:
            return null;
        }
    }

    /** Call a compiled function, return EastValue* pointer (no beast2). */
    function callHandlePtr(handle: number): number {
        new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).setUint32(0, ERROR_BUF_SIZE, true);
        const ptr = mod._east_wasm_call_ptr(handle, errorBufPtr, errorLenPtr);
        if (ptr === 0) {
            const errLen = new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).getUint32(0, true);
            if (errLen > 0) {
                const errBytes = new Uint8Array(mod.HEAPU8.buffer, errorBufPtr, errLen);
                throw new Error(`east-c-wasm: ${new TextDecoder().decode(errBytes)}`);
            }
        }
        return ptr;
    }

    /** Call a compiled function with args, return EastValue* pointer (no beast2). */
    function callHandlePtrWithArgs(handle: number, argsBytes: Uint8Array): number {
        const argsPtr = writeBytes(argsBytes);
        new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).setUint32(0, ERROR_BUF_SIZE, true);
        const ptr = mod._east_wasm_call_ptr_with_args(handle, argsPtr, argsBytes.length, errorBufPtr, errorLenPtr);
        mod._free(argsPtr);
        if (ptr === 0) {
            const errLen = new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).getUint32(0, true);
            if (errLen > 0) {
                const errBytes = new Uint8Array(mod.HEAPU8.buffer, errorBufPtr, errLen);
                throw new Error(`east-c-wasm: ${new TextDecoder().decode(errBytes)}`);
            }
        }
        return ptr;
    }

    /** Create a CompiledFunction from a WASM handle + type info */
    function wrapHandle(handle: number, inputTypes: EastTypeValue[], outputType: EastTypeValue): CompiledFunction {
        const inputEncoders = inputTypes.map(t => encodeBeast2For(t));

        const fn = (...args: unknown[]): unknown => {
            let resultPtr: number;
            if (args.length === 0) {
                resultPtr = callHandlePtr(handle);
            } else {
                const encodedArgs: Uint8Array[] = args.map((arg, i) => {
                    const encoder = inputEncoders[i];
                    if (!encoder) throw new Error(`no input type for arg ${i}`);
                    return encoder(arg);
                });
                const packedArgs = encodeArgsList(encodedArgs);
                resultPtr = callHandlePtrWithArgs(handle, packedArgs);
            }

            if (resultPtr === 0) return null;
            const result = readValueFromPtr(resultPtr);
            mod._east_wasm_value_release(resultPtr);
            return result;
        };

        fn.free = () => mod._east_wasm_free(handle);
        return fn as CompiledFunction;
    }

    function compileEast(text: Uint8Array): number {
        const textPtr = writeBytes(text);
        const handle = mod._east_wasm_compile_east(textPtr, text.length);
        mod._free(textPtr);
        if (handle === 0) {
            const errPtr = mod._east_wasm_last_error();
            const detail = errPtr ? mod.UTF8ToString(errPtr) : 'unknown error';
            throw new Error(`east-c-wasm compile_east: ${detail}`);
        }
        return handle;
    }

    return {
        compileFromJson(json: Uint8Array, platform?: PlatformFunction[]): CompiledFunction {
            ensurePlatformRegistered(platform);
            const handle = compileJson(json);
            const { inputTypes, outputType } = getFnTypeFromHandle(handle);
            return wrapHandle(handle, inputTypes, outputType);
        },

        compileFromBeast2(bytes: Uint8Array, platform?: PlatformFunction[]): CompiledFunction {
            ensurePlatformRegistered(platform);
            const handle = compileBeast2(bytes);
            const { inputTypes, outputType } = getFnTypeFromHandle(handle);
            return wrapHandle(handle, inputTypes, outputType);
        },

        compileFromEast(text: string, platform?: PlatformFunction[]): CompiledFunction {
            ensurePlatformRegistered(platform);
            const textBytes = new TextEncoder().encode(text);
            const handle = compileEast(textBytes);
            const { inputTypes, outputType } = getFnTypeFromHandle(handle);
            return wrapHandle(handle, inputTypes, outputType);
        },

        decodeValue(bytes: Uint8Array): unknown {
            const dataPtr = writeBytes(bytes);
            new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).setUint32(0, ERROR_BUF_SIZE, true);
            const ptr = mod._east_wasm_decode_value(dataPtr, bytes.length, errorBufPtr, errorLenPtr);
            mod._free(dataPtr);
            if (ptr === 0) {
                const errLen = new DataView(mod.HEAPU8.buffer, errorLenPtr, 4).getUint32(0, true);
                if (errLen > 0) {
                    const errBytes = new Uint8Array(mod.HEAPU8.buffer, errorBufPtr, errLen);
                    throw new Error(`east-c-wasm decode: ${new TextDecoder().decode(errBytes)}`);
                }
                return null;
            }
            const result = readValueFromPtr(ptr);
            mod._east_wasm_value_release(ptr);
            return result;
        },

        gc(): void {
            mod._east_wasm_gc();
        },
    };
}

// ============================================================================
// Platform bridge
// ============================================================================

/**
 * Build the platform call bridge for Emscripten module options.
 */
export function createPlatformBridge(
    platformFns: Map<string, PlatformRegistration>,
    genericCache: Map<string, PlatformFn>,
    getMod: () => EastWasmModule,
): (namePtr: number, tpPtr: number, tpLen: number, argsPtr: number, argsLen: number, outPtr: number, outLenPtr: number) => number {
    return (
        namePtr: number,
        tpPtr: number, tpLen: number,
        argsPtr: number, argsLen: number,
        outPtr: number, outLenPtr: number,
    ): number => {
        const mod = getMod();

        try {
            const name = mod.UTF8ToString(namePtr);
            const reg = platformFns.get(name);
            if (!reg) {
                writeErrorToWasmBridge(mod, `platform function not registered: ${name}`, outPtr, outLenPtr);
                return 1;
            }

            // Decode args from WASM memory
            const argsData = new Uint8Array(mod.HEAPU8.buffer, argsPtr, argsLen).slice();
            const args = decodeArgsList(argsData);

            // Get the implementation
            let impl: PlatformFn;
            if (reg.isGeneric && reg.factory) {
                const tpBytes = tpLen > 0
                    ? new Uint8Array(mod.HEAPU8.buffer, tpPtr, tpLen).slice()
                    : new Uint8Array(0);
                const cacheKey = `${name}|${bufToHex(tpBytes)}`;
                let cached = genericCache.get(cacheKey);
                if (!cached) {
                    cached = reg.factory(tpBytes);
                    genericCache.set(cacheKey, cached);
                }
                impl = cached;
            } else if (reg.fn) {
                impl = reg.fn;
            } else {
                writeErrorToWasmBridge(mod, `platform function ${name} has no implementation`, outPtr, outLenPtr);
                return 1;
            }

            const result = impl(args);

            if (!writeResultToWasm(mod, result, outPtr, outLenPtr)) {
                writeErrorToWasmBridge(mod, 'platform result too large', outPtr, outLenPtr);
                return 1;
            }
            return 0;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            writeErrorToWasmBridge(mod, msg, outPtr, outLenPtr);
            return 1;
        }
    };
}

/** Write result bytes to WASM buffer. Returns true on success, false on overflow. */
function writeResultToWasm(mod: EastWasmModule, result: Uint8Array | null, outPtr: number, outLenPtr: number): boolean {
    if (result && result.length > 0) {
        const outLenView = new DataView(mod.HEAPU8.buffer, outLenPtr, 4);
        const capacity = outLenView.getUint32(0, true);
        if (result.length > capacity) {
            return false;
        }
        new Uint8Array(mod.HEAPU8.buffer, outPtr, result.length).set(result);
        outLenView.setUint32(0, result.length, true);
    } else {
        new DataView(mod.HEAPU8.buffer, outLenPtr, 4).setUint32(0, 0, true);
    }
    return true;
}

function writeErrorToWasmBridge(mod: EastWasmModule, msg: string, outPtr: number, outLenPtr: number): void {
    const encoded = new TextEncoder().encode(msg);
    const outLenView = new DataView(mod.HEAPU8.buffer, outLenPtr, 4);
    const capacity = outLenView.getUint32(0, true);
    const len = Math.min(encoded.length, capacity);
    new Uint8Array(mod.HEAPU8.buffer, outPtr, len).set(encoded.subarray(0, len));
    outLenView.setUint32(0, len, true);
}

// ============================================================================
// Helpers
// ============================================================================

const FN_HANDLE_SENTINEL = 0xFFFFFFFF;

/** Decode args list from packed format: [count:u32le][len1:u32le][data1]... */
function decodeArgsList(data: Uint8Array): Uint8Array[] {
    if (data.length < 4) return [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = view.getUint32(0, true);
    const args: Uint8Array[] = [];
    let offset = 4;
    for (let i = 0; i < count; i++) {
        if (offset + 4 > data.length) break;
        const len = view.getUint32(offset, true);
        offset += 4;

        if (len === FN_HANDLE_SENTINEL) {
            const headerStart = offset;
            if (offset + 12 > data.length) break;
            offset += 4; // handle_id
            offset += 4; // input_count
            const typeLen = view.getUint32(offset, true);
            offset += 4; // type_len
            if (offset + typeLen > data.length) break;
            offset += typeLen;
            const packed = new Uint8Array(4 + (offset - headerStart));
            const packedView = new DataView(packed.buffer);
            packedView.setUint32(0, FN_HANDLE_SENTINEL, true);
            packed.set(data.subarray(headerStart, offset), 4);
            args.push(packed);
        } else {
            if (offset + len > data.length) break;
            args.push(data.subarray(offset, offset + len));
            offset += len;
        }
    }
    return args;
}

function isFnHandleArg(argBytes: Uint8Array): boolean {
    if (argBytes.length < 16) return false;
    const view = new DataView(argBytes.buffer, argBytes.byteOffset, argBytes.byteLength);
    return view.getUint32(0, true) === FN_HANDLE_SENTINEL;
}

function parseFnHandleArg(argBytes: Uint8Array): { handleId: number; inputCount: number; fnTypeBytes: Uint8Array } {
    const view = new DataView(argBytes.buffer, argBytes.byteOffset, argBytes.byteLength);
    const handleId = view.getUint32(4, true);
    const inputCount = view.getUint32(8, true);
    const typeLen = view.getUint32(12, true);
    const fnTypeBytes = argBytes.slice(16, 16 + typeLen);
    return { handleId, inputCount, fnTypeBytes };
}

function extractFnSignature(fnType: EastTypeValue): { inputs: EastTypeValue[]; output: EastTypeValue } {
    if (fnType.type === 'Function' || fnType.type === 'AsyncFunction') {
        return { inputs: fnType.value.inputs, output: fnType.value.output };
    }
    throw new Error(`extractFnSignature: unexpected type ${(fnType as { type: string }).type}`);
}

/** Create a JS callable wrapper around a WASM temp handle (for platform function callbacks). */
function createFnHandleWrapper(
    handleId: number,
    fnType: EastTypeValue,
    mod: EastWasmModule,
    invokeBufs: { resultBufPtr: number; errorBufPtr: number; resultLenPtr: number; errorLenPtr: number },
): (...args: unknown[]) => unknown {
    const { inputs, output } = extractFnSignature(fnType);
    const inputEncoders = inputs.map(t => encodeBeast2For(t));
    const outputDecoder = decodeBeast2For(output);

    return (...jsArgs: unknown[]): unknown => {
        const encodedArgs: Uint8Array[] = jsArgs.map((arg, i) => {
            const encoder = inputEncoders[i];
            if (!encoder) throw new Error(`invoke_fn: no input type for arg ${i}`);
            return encoder(arg);
        });
        const packedArgs = encodeArgsList(encodedArgs);

        const argsPtr = mod._malloc(packedArgs.length);
        mod.HEAPU8.set(packedArgs, argsPtr);

        new DataView(mod.HEAPU8.buffer, invokeBufs.resultLenPtr, 4).setUint32(0, RESULT_BUF_SIZE, true);
        new DataView(mod.HEAPU8.buffer, invokeBufs.errorLenPtr, 4).setUint32(0, ERROR_BUF_SIZE, true);

        const rc = mod._east_wasm_invoke_fn(
            handleId, argsPtr, packedArgs.length,
            invokeBufs.resultBufPtr, invokeBufs.resultLenPtr,
            invokeBufs.errorBufPtr, invokeBufs.errorLenPtr,
        );

        mod._free(argsPtr);

        if (rc !== 0) {
            const errLen = new DataView(mod.HEAPU8.buffer, invokeBufs.errorLenPtr, 4).getUint32(0, true);
            const errBytes = new Uint8Array(mod.HEAPU8.buffer, invokeBufs.errorBufPtr, errLen);
            throw new Error(new TextDecoder().decode(errBytes));
        }

        const resLen = new DataView(mod.HEAPU8.buffer, invokeBufs.resultLenPtr, 4).getUint32(0, true);
        if (resLen === 0) return null;

        const resultBytes = new Uint8Array(mod.HEAPU8.buffer, invokeBufs.resultBufPtr, resLen).slice();
        return outputDecoder(resultBytes);
    };
}

/** Encode args list into packed format: [count:u32le][len1:u32le][data1]... */
function encodeArgsList(args: Uint8Array[]): Uint8Array {
    let totalLen = 4;
    for (const arg of args) totalLen += 4 + arg.length;
    const buf = new Uint8Array(totalLen);
    const view = new DataView(buf.buffer);
    view.setUint32(0, args.length, true);
    let offset = 4;
    for (const arg of args) {
        view.setUint32(offset, arg.length, true);
        offset += 4;
        buf.set(arg, offset);
        offset += arg.length;
    }
    return buf;
}

function bufToHex(buf: Uint8Array): string {
    if (buf.length === 0) return '';
    const hex: string[] = [];
    for (let i = 0; i < buf.length; i++) {
        hex.push(buf[i]!.toString(16).padStart(2, '0'));
    }
    return hex.join('');
}

// ============================================================================
// Platform function registration bridge
// ============================================================================

function buildPlatformRegistrations(allPlatform: PlatformFunction[]): PlatformRegistration[] {
    return allPlatform.map(pf => {
        const isGeneric = (pf.type_parameters?.length ?? 0) > 0;
        const isAsync = pf.type === 'async';

        if (isGeneric) {
            return {
                name: pf.name,
                isGeneric: true,
                isAsync,
                factory: (typeParamsBytes: Uint8Array) => {
                    const typeParams = decodeTypeParams(typeParamsBytes);
                    const inputTypes = pf.inputsFn ? pf.inputsFn(...typeParams) : pf.inputs;
                    const outputType = pf.outputsFn ? pf.outputsFn(...typeParams) : pf.output;
                    const jsFn = pf.fn(...typeParams);
                    return (args: Uint8Array[]) => callJsPlatformFn(jsFn, inputTypes, outputType, args, allPlatform);
                },
            };
        }

        return {
            name: pf.name,
            isGeneric: false,
            isAsync,
            fn: (args: Uint8Array[]) => callJsPlatformFn(pf.fn, pf.inputs, pf.output, args, allPlatform),
        };
    });
}

/**
 * Bridge between WASM Beast2-encoded bytes and JS platform function implementations.
 * Decodes args, resolves function handles, calls the JS function, encodes result.
 */
function callJsPlatformFn(
    fn: (...args: unknown[]) => unknown,
    inputTypes: EastTypeValue[],
    outputType: EastTypeValue,
    args: Uint8Array[],
    allPlatform?: PlatformFunction[],
): Uint8Array | null {
    const decodeOptions = allPlatform ? { platform: allPlatform } : undefined;
    const decoded = args.map((argBytes, i) => {
        if (isFnHandleArg(argBytes) && _handleResolver) {
            const { handleId, fnTypeBytes } = parseFnHandleArg(argBytes);
            const fnType = decodeBeast2For(EastTypeType)(fnTypeBytes) as EastTypeValue;
            return createFnHandleWrapper(handleId, fnType, _handleResolver.mod, _handleResolver.invokeBufs);
        }
        const decoder = decodeBeast2For(inputTypes[i]!, decodeOptions);
        return decoder(argBytes);
    });
    const result = fn(...decoded);

    if (outputType.type === 'Null') {
        if (result != null && typeof (result as any).catch === 'function') {
            (result as Promise<unknown>).catch(() => {});
        }
        return null;
    }
    if (result === null || result === undefined) return null;
    const encoder = encodeBeast2For(outputType);
    return encoder(result);
}

function decodeTypeParams(typeParamsBytes: Uint8Array): EastTypeValue[] {
    if (typeParamsBytes.length === 0) return [];
    return decodeBeast2For(ArrayType(EastTypeType))(typeParamsBytes) as EastTypeValue[];
}
