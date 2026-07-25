/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 container — version-agnostic public entry points.
 *
 * Decoders dispatch on the magic's version byte (`v4` = 0x04, `v5` = 0x05) so
 * every entry point accepts blobs of either container version. Encoders write
 * the v4 container by default. See `SPEC.md` for the magic registry and
 * version policy, `v4/SPEC.md` and `v5/SPEC.md` for the wire formats.
 */

import { toEastTypeValue, type EastTypeValue } from "../../type_of_type.js";
import { isVariant } from "../../containers/variant.js";
import type { EastType, ValueTypeOf } from "../../types.js";
import { IRType, type FunctionIR, type AsyncFunctionIR } from "../../ir.js";
import type { PlatformFunction } from "../../platform.js";
import { EastIR, AsyncEastIR } from "../../eastir.js";
import type { SourceMap } from "../../location.js";
import { type Beast2DecodeOptions } from "./shared.js";
import {
  MAGIC_BYTES,
  encodeBeast2V4For,
  decodeBeast2V4For,
  decodeBeast2V4,
  decodeIRWithSourceMapV4,
} from "./v4/container.js";
import {
  encodeBeast2V5For,
  decodeBeast2V5For,
  decodeBeast2V5ForAsync,
  decodeBeast2V5,
  decodeIRWithSourceMapV5,
} from "./v5/codec.js";
import type { Beast2Codec } from "./v5/frames.js";

export { MAGIC_BYTES } from "./v4/container.js";
export { MAGIC_BYTES_V5 } from "./v5/codec.js";
export type { Beast2DecodeOptions } from "./shared.js";
export type { Beast2Codec } from "./v5/frames.js";
export {
  registerWellKnownType,
  registeredWellKnownIds,
  WELL_KNOWN_CORE_ID_MAX,
  type RegisterWellKnownOptions,
} from "./v5/type-section.js";
export {
  Beast2Writer,
  type Beast2WriterOptions,
  encodeBeast2SegmentsFor,
  iterBeast2SegmentsFor,
  Beast2Pages,
  openBeast2PagesFor,
} from "./v5/stream.js";

// =============================================================================
// Magic dispatch
// =============================================================================

/** Container versions selectable by the encode entry points. */
export type Beast2Version = 4 | 5;

/**
 * Sniffs the container version from a blob's magic bytes.
 *
 * @param data - the blob to inspect
 * @returns the container version (4 or 5)
 * @throws {Error} When the data is too short, the magic prefix is wrong, or
 *   the version byte is unknown.
 */
function sniffVersion(data: Uint8Array): 4 | 5 {
  if (data.length < 8) {
    throw new Error(`Data too short for Beast2 format: ${data.length} bytes`);
  }
  for (let i = 0; i < 7; i++) {
    if (data[i] !== MAGIC_BYTES[i]) {
      throw new Error(`Invalid Beast2 magic at offset ${i}: expected 0x${MAGIC_BYTES[i]!.toString(16)}, got 0x${data[i]!.toString(16)}`);
    }
  }
  const version = data[7]!;
  if (version === 0x04) return 4;
  if (version === 0x05) return 5;
  throw new Error(`Unknown Beast2 version: 0x${version.toString(16)}`);
}

// =============================================================================
// Public API — Encode
// =============================================================================

/** Options accepted by {@link encodeBeast2For}. */
export type Beast2EncodeOptions = {
  /** Explicit source map to embed (overrides discovery from function values). */
  sourceMap?: SourceMap | null;
  /** Container version to write. Defaults to `4`. */
  version?: Beast2Version;
  /** v5 only: per-frame codec. Defaults to `"deflate"`. */
  codec?: Beast2Codec;
  /** v5 only: write the trailing index + footer (container roots).
   *  Defaults to `false`. */
  index?: boolean;
};

/**
 * Builds an encoder closure for the given type.
 *
 * The returned function encodes values of `type` into a self-contained beast2
 * blob. The container version defaults to v4; decode entry points accept every
 * version regardless. Version 5 writes the segment-terminated record stream
 * (see `v5/SPEC.md`) and accepts the `codec` and `index` options.
 *
 * @param type - the root East type (as `EastType` or `EastTypeValue`)
 * @param options - encode options (source map, container version, v5 codec/index)
 * @returns a reusable function encoding values of `type` to beast2 bytes
 */
export function encodeBeast2For(type: EastTypeValue, options?: Beast2EncodeOptions): (value: any) => Uint8Array
export function encodeBeast2For<T extends EastType>(type: T, options?: Beast2EncodeOptions): (value: ValueTypeOf<T>) => Uint8Array
export function encodeBeast2For(type: EastTypeValue | EastType, options?: Beast2EncodeOptions): (value: any) => Uint8Array {
  if ((options?.version ?? 4) === 5) {
    return encodeBeast2V5For(type as EastTypeValue, options);
  }
  return encodeBeast2V4For(type as EastTypeValue, options);
}

// =============================================================================
// Public API — Decode (known type)
// =============================================================================

/**
 * Builds a decoder closure for the given type.
 *
 * The returned function dispatches on the blob's magic version byte, so v4
 * blobs decode through the same entry point as newer container versions.
 *
 * @param type - the expected root East type (as `EastType` or `EastTypeValue`)
 * @param options - decode options (platform functions for decoded functions)
 * @returns a reusable function decoding beast2 bytes to values of `type`
 */
export function decodeBeast2For(type: EastTypeValue, options?: Beast2DecodeOptions): (data: Uint8Array) => any
export function decodeBeast2For<T extends EastType>(type: T, options?: Beast2DecodeOptions): (data: Uint8Array) => ValueTypeOf<T>
export function decodeBeast2For(type: EastTypeValue | EastType, options?: Beast2DecodeOptions): (data: Uint8Array) => any {
  const typeValue = toTypeValue(type);
  // Version decoders are built lazily on first use — most call sites only ever
  // see one container version.
  let v4: ((data: Uint8Array) => any) | undefined;
  let v5: ((data: Uint8Array) => any) | undefined;
  return (data: Uint8Array) => {
    if (sniffVersion(data) === 5) {
      v5 ??= decodeBeast2V5For(typeValue, options);
      return v5(data);
    }
    v4 ??= decodeBeast2V4For(typeValue, options);
    return v4(data);
  };
}

/**
 * Builds an async decoder closure for the given type.
 *
 * Identical to {@link decodeBeast2For} but decompresses v5 deflate frames with
 * the platform's async decompressor (`DecompressionStream`), so it works in
 * browsers where Node's zlib is unavailable. v4 blobs decode synchronously.
 *
 * @param type - the expected root East type (as `EastType` or `EastTypeValue`)
 * @param options - decode options (platform functions for decoded functions)
 * @returns a reusable async function decoding beast2 bytes to values of `type`
 */
export function decodeBeast2ForAsync(type: EastTypeValue, options?: Beast2DecodeOptions): (data: Uint8Array) => Promise<any>
export function decodeBeast2ForAsync<T extends EastType>(type: T, options?: Beast2DecodeOptions): (data: Uint8Array) => Promise<ValueTypeOf<T>>
export function decodeBeast2ForAsync(type: EastTypeValue | EastType, options?: Beast2DecodeOptions): (data: Uint8Array) => Promise<any> {
  const typeValue = toTypeValue(type);
  let v4: ((data: Uint8Array) => any) | undefined;
  let v5: ((data: Uint8Array) => Promise<any>) | undefined;
  return async (data: Uint8Array) => {
    if (sniffVersion(data) === 5) {
      v5 ??= decodeBeast2V5ForAsync(typeValue, options);
      return v5(data);
    }
    v4 ??= decodeBeast2V4For(typeValue, options);
    return v4(data);
  };
}

// =============================================================================
// Public API — Decode (self-describing)
// =============================================================================

/**
 * Decodes a self-describing blob using its embedded root type.
 *
 * @param data - a beast2 blob of any supported container version
 * @param options - decode options (platform functions for decoded functions)
 * @returns the blob's root type and decoded value
 */
export function decodeBeast2(data: Uint8Array, options?: Beast2DecodeOptions): { type: EastTypeValue; value: any } {
  if (sniffVersion(data) === 5) {
    return decodeBeast2V5(data, options);
  }
  return decodeBeast2V4(data, options);
}

// =============================================================================
// Public API — EastIR bundle (IR + source map travelling together)
// =============================================================================
// An EastIR instance carries both the Function IR tree and its SourceMap.
// These helpers serialize / deserialize the bundle end-to-end so that loc_ids
// remain resolvable across process boundaries. Mirrors the C native shape:
// `east_beast2_decode_ir(data, len, &ir_value, &source_map)` — both come out
// of / go into the same blob.

/** Encode an EastIR (or AsyncEastIR) as a beast2 blob that carries both the
 *  IR and its source map. Prefer this over `encodeBeast2For(IRType)(ir)` when
 *  encoding a program rather than opaque IR data. */
export function encodeEastIR<I extends any[], O>(eastIR: EastIR<I, O> | AsyncEastIR<I, O>, options?: Omit<Beast2EncodeOptions, "sourceMap">): Uint8Array {
  return encodeBeast2For(IRType, { ...options, sourceMap: eastIR.source_map })(eastIR.ir as any);
}

/** Decode a beast2 blob whose root is a Function IR into an EastIR. The
 *  returned wrapper has its source_map populated from the blob's source_map
 *  section, so downstream compile() resolves loc_ids automatically. */
export function decodeEastIR<I extends any[] = any[], O = any>(data: Uint8Array): EastIR<I, O> {
  const { ir, sourceMap } = decodeIRWithSourceMap(data);
  if (ir.type !== 'Function') {
    throw new Error(`decodeEastIR: expected Function IR at root, got ${ir.type}. Use decodeAsyncEastIR for async functions.`);
  }
  const result = new EastIR<I, O>(ir as FunctionIR);
  result.source_map = sourceMap;
  return result;
}

/** Async-function variant of decodeEastIR. */
export function decodeAsyncEastIR<I extends any[] = any[], O = any>(data: Uint8Array): AsyncEastIR<I, O> {
  const { ir, sourceMap } = decodeIRWithSourceMap(data);
  if (ir.type !== 'AsyncFunction') {
    throw new Error(`decodeAsyncEastIR: expected AsyncFunction IR at root, got ${ir.type}. Use decodeEastIR for sync functions.`);
  }
  const result = new AsyncEastIR<I, O>(ir as AsyncFunctionIR);
  result.source_map = sourceMap;
  return result;
}

/** Internal: decode an IRType blob of any container version and return both
 *  the IR value and the decoded source map. */
function decodeIRWithSourceMap(data: Uint8Array): { ir: any; sourceMap: SourceMap | null } {
  if (sniffVersion(data) === 5) {
    return decodeIRWithSourceMapV5(data);
  }
  return decodeIRWithSourceMapV4(data);
}

// =============================================================================
// Re-exports
// =============================================================================

// EAST_IR_SYMBOL and EAST_CAPTURES_SYMBOL are exported from compile.js directly

export function compileFunctionIR<I extends any[], O>(ir: FunctionIR, platform: PlatformFunction[]): (...args: I) => O {
  return new EastIR(ir).compile(platform) as (...args: I) => O;
}

export function compileAsyncFunctionIR<I extends any[], O>(ir: AsyncFunctionIR, platform: PlatformFunction[]): (...args: I) => Promise<O> {
  return new AsyncEastIR(ir).compile(platform) as (...args: I) => Promise<O>;
}

// =============================================================================
// Internal helpers
// =============================================================================

/** Normalizes an `EastType | EastTypeValue` to `EastTypeValue`. */
function toTypeValue(type: EastType | EastTypeValue): EastTypeValue {
  return isVariant(type) ? type as EastTypeValue : toEastTypeValue(type as EastType);
}
