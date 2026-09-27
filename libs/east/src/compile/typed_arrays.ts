/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { matrix } from "../containers/matrix.js";
import { EastError } from "../error.js";
import type { Location, SourceMap } from "../location.js";
import type { EastTypeValue } from "../type_of_type.js";

/* The TypedArray storage Vector and Matrix values use, and the checks their
 * builtins share. */

/** Allocates an empty TypedArray of the given length for a given element type */
export function allocateTypedArray(elementType: EastTypeValue, length: number): Float64Array | BigInt64Array | Uint8ClampedArray {
  if (elementType.type === "Float") return new Float64Array(length);
  if (elementType.type === "Integer") return new BigInt64Array(length);
  if (elementType.type === "Boolean") return new Uint8ClampedArray(length);
  throw new Error(`Unsupported vector element type: ${elementType.type}`);
}

/** Wraps to East's 64-bit Integer semantics */
export function wrapI64(x: bigint): bigint {
  return BigInt.asIntN(64, x);
}

/** Throws unless the vector/matrix element type parameter is Float or Integer */
export function requireNumericElem(builtin: string, T: EastTypeValue, loc_id: bigint, source_map: SourceMap | null): "Float" | "Integer" {
  if (T.type !== "Float" && T.type !== "Integer") {
    throw new EastError(`${builtin} requires Float or Integer elements`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
  }
  return T.type;
}

/** Throws the shared length-mismatch error for elementwise vector operands */
export function requireSameLength(a: { length: number }, b: { length: number }, loc_id: bigint, source_map: SourceMap | null): void {
  if (a.length !== b.length) {
    throw new EastError(`Vector length mismatch (${a.length} vs ${b.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
  }
}

/** Throws the shared dimension-mismatch error for elementwise matrix operands */
export function requireSameDims(a: matrix, b: matrix, loc_id: bigint, source_map: SourceMap | null): void {
  if (a.rows !== b.rows || a.cols !== b.cols) {
    throw new EastError(`Matrix dimension mismatch (${a.rows}x${a.cols} vs ${b.rows}x${b.cols})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
  }
}

/** Validates the sparse-accumulator invariant: parallel lengths and strictly ascending indices */
export function requireSparse(ix: BigInt64Array, v: { length: number }, loc_id: bigint, source_map: SourceMap | null): void {
  if (ix.length !== v.length) {
    throw new EastError(`Sparse index and value lengths differ (${ix.length} vs ${v.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
  }
  for (let i = 1; i < ix.length; i++) {
    if (ix[i]! <= ix[i - 1]!) {
      throw new EastError(`Sparse index vector must be strictly ascending`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
  }
}

/** Creates the appropriate TypedArray for a given element type */
export function createTypedArray(elementType: EastTypeValue, values: any[]): Float64Array | BigInt64Array | Uint8ClampedArray {
  if (elementType.type === "Float") {
    const arr = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) arr[i] = values[i];
    return arr;
  } else if (elementType.type === "Integer") {
    const arr = new BigInt64Array(values.length);
    for (let i = 0; i < values.length; i++) arr[i] = values[i];
    return arr;
  } else if (elementType.type === "Boolean") {
    const arr = new Uint8ClampedArray(values.length);
    for (let i = 0; i < values.length; i++) arr[i] = values[i] ? 1 : 0;
    return arr;
  } else {
    throw new Error(`Unsupported vector element type: ${elementType.type}`);
  }
}
