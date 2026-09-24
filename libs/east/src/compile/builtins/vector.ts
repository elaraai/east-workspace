/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { equalFor, greaterFor, lessFor } from "../../comparison.js";
import { type BuiltinEvaluators, call_function } from "../runtime.js";
import { allocateTypedArray, createTypedArray, requireNumericElem, requireSameLength, wrapI64 } from "../typed_arrays.js";
import { matrix } from "../../containers/matrix.js";
import { EastError } from "../../error.js";
import type { Location, SourceMap } from "../../location.js";
import type { PlatformFunction } from "../../platform.js";
import type { EastTypeValue } from "../../type_of_type.js";

/** The builtins for Vectors. @internal */
export const vector_builtins = {
  // Vector builtins
  VectorLength: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray) => BigInt(vec.length),

  VectorGet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, idx: bigint) => {
    const i = Number(idx);
    if (i < 0 || i >= vec.length) {
      throw new EastError(`Vector index ${idx} out of bounds (length ${vec.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if (vec instanceof Uint8ClampedArray) return vec[i]! !== 0;
    return vec[i]!;
  },

  VectorSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, idx: bigint, value: any) => {
    const i = Number(idx);
    if (i < 0 || i >= vec.length) {
      throw new EastError(`Vector index ${idx} out of bounds (length ${vec.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const result = vec.slice() as typeof vec;
    if (result instanceof Uint8ClampedArray) {
      result[i] = value ? 1 : 0;
    } else {
      (result as any)[i] = value;
    }
    return result;
  },

  VectorSlice: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, start: bigint, end: bigint) => {
    const s = Number(start);
    const e = Number(end);
    if (s < 0 || e > vec.length || s > e) {
      throw new EastError(`Vector slice [${start}, ${end}) out of bounds (length ${vec.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    return vec.slice(s, e);
  },

  VectorConcat: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
    const result = allocateTypedArray(T, a.length + b.length);
    result.set(a as any);
    result.set(b as any, a.length);
    return result;
  },

  VectorFromArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (arr: any[]) => {
    return createTypedArray(T, arr);
  },

  VectorToArray: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray) => {
    if (vec instanceof Uint8ClampedArray) {
      return Array.from(vec, v => v !== 0);
    }
    if (vec instanceof BigInt64Array) {
      const result: bigint[] = [];
      for (let i = 0; i < vec.length; i++) result.push(vec[i]!);
      return result;
    }
    return Array.from(vec);
  },

  VectorToMatrix: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, rows: bigint, cols: bigint) => {
    const r = Number(rows);
    const c = Number(cols);
    if (r * c !== vec.length) {
      throw new EastError(`Cannot reshape vector of length ${vec.length} to matrix ${r}×${c}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    return matrix(vec.slice() as any, r, c);
  },

  VectorZeros: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (len: bigint) => {
    return allocateTypedArray(T, Number(len));
  },

  VectorOnes: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (len: bigint) => {
    const arr = allocateTypedArray(T, Number(len));
    arr.fill((arr instanceof BigInt64Array ? 1n : 1) as never);
    return arr;
  },

  VectorFill: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (len: bigint, value: any) => {
    const n = Number(len);
    if (T.type === "Float") {
      const arr = new Float64Array(n);
      arr.fill(value);
      return arr;
    } else if (T.type === "Integer") {
      const arr = new BigInt64Array(n);
      arr.fill(value);
      return arr;
    } else {
      const arr = new Uint8ClampedArray(n);
      arr.fill(value ? 1 : 0);
      return arr;
    }
  },

  VectorMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, U: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, f: (elem: any, idx: bigint) => any) => {
    const len = vec.length;
    const results: any[] = [];
    for (let i = 0; i < len; i++) {
      const elem = vec instanceof Uint8ClampedArray ? (vec[i]! !== 0) : vec[i]!;
      results.push(call_function(loc_id, source_map,f, elem, BigInt(i)));
    }
    return createTypedArray(U, results);
  },

  VectorFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _U: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, init: any, f: (acc: any, elem: any, idx: bigint) => any) => {
    let acc = init;
    for (let i = 0; i < vec.length; i++) {
      const elem = vec instanceof Uint8ClampedArray ? (vec[i]! !== 0) : vec[i]!;
      acc = call_function(loc_id, source_map,f, acc, elem, BigInt(i));
    }
    return acc;
  },

  // Vector elementwise arithmetic + reductions. Reductions fold in index
  // order, left to right — part of the cross-runtime contract, since a
  // reassociated float sum gives a different last bit.
  VectorScale: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorScale", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array, alpha: any) => {
      if (elem === "Float") {
        const result = new Float64Array(v.length);
        for (let i = 0; i < v.length; i++) result[i] = (v[i] as number) * alpha;
        return result;
      }
      const result = new BigInt64Array(v.length);
      for (let i = 0; i < v.length; i++) result[i] = wrapI64((v[i] as bigint) * alpha);
      return result;
    };
  },
  VectorSum: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorSum", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array) => {
      if (elem === "Float") {
        let acc = 0;
        for (let i = 0; i < v.length; i++) acc += v[i] as number;
        return acc;
      }
      let acc = 0n;
      for (let i = 0; i < v.length; i++) acc = wrapI64(acc + (v[i] as bigint));
      return acc;
    };
  },
  VectorAddScaled: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorAddScaled", T, loc_id, source_map);
    return (a: Float64Array | BigInt64Array, b: Float64Array | BigInt64Array, alpha: any) => {
      requireSameLength(a, b, loc_id, source_map);
      if (elem === "Float") {
        const result = new Float64Array(a.length);
        for (let i = 0; i < a.length; i++) result[i] = (a[i] as number) + alpha * (b[i] as number);
        return result;
      }
      const result = new BigInt64Array(a.length);
      for (let i = 0; i < a.length; i++) result[i] = wrapI64((a[i] as bigint) + wrapI64(alpha * (b[i] as bigint)));
      return result;
    };
  },
  VectorMul: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorMul", T, loc_id, source_map);
    return (a: Float64Array | BigInt64Array, b: Float64Array | BigInt64Array) => {
      requireSameLength(a, b, loc_id, source_map);
      if (elem === "Float") {
        const result = new Float64Array(a.length);
        for (let i = 0; i < a.length; i++) result[i] = (a[i] as number) * (b[i] as number);
        return result;
      }
      const result = new BigInt64Array(a.length);
      for (let i = 0; i < a.length; i++) result[i] = wrapI64((a[i] as bigint) * (b[i] as bigint));
      return result;
    };
  },
  VectorAddScalar: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorAddScalar", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array, c: any) => {
      if (elem === "Float") {
        const result = new Float64Array(v.length);
        for (let i = 0; i < v.length; i++) result[i] = (v[i] as number) + c;
        return result;
      }
      const result = new BigInt64Array(v.length);
      for (let i = 0; i < v.length; i++) result[i] = wrapI64((v[i] as bigint) + c);
      return result;
    };
  },
  VectorDot: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorDot", T, loc_id, source_map);
    return (a: Float64Array | BigInt64Array, b: Float64Array | BigInt64Array) => {
      requireSameLength(a, b, loc_id, source_map);
      if (elem === "Float") {
        let acc = 0;
        for (let i = 0; i < a.length; i++) acc += (a[i] as number) * (b[i] as number);
        return acc;
      }
      let acc = 0n;
      for (let i = 0; i < a.length; i++) acc = wrapI64(acc + wrapI64((a[i] as bigint) * (b[i] as bigint)));
      return acc;
    };
  },
  VectorMax: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorMax", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array) => {
      if (v.length === 0) {
        throw new EastError("Cannot reduce empty Vector", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let best = v[0]!;
      for (let i = 1; i < v.length; i++) {
        if (less(best, v[i]!)) best = v[i]!;
      }
      return best;
    };
  },
  VectorMin: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorMin", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array) => {
      if (v.length === 0) {
        throw new EastError("Cannot reduce empty Vector", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let best = v[0]!;
      for (let i = 1; i < v.length; i++) {
        if (less(v[i]!, best)) best = v[i]!;
      }
      return best;
    };
  },
  VectorArgMax: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorArgMax", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array) => {
      if (v.length === 0) {
        throw new EastError("Cannot reduce empty Vector", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let bestIdx = 0;
      for (let i = 1; i < v.length; i++) {
        if (less(v[bestIdx]!, v[i]!)) bestIdx = i;
      }
      return BigInt(bestIdx);
    };
  },
  VectorArgMin: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorArgMin", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array) => {
      if (v.length === 0) {
        throw new EastError("Cannot reduce empty Vector", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let bestIdx = 0;
      for (let i = 1; i < v.length; i++) {
        if (less(v[i]!, v[bestIdx]!)) bestIdx = i;
      }
      return BigInt(bestIdx);
    };
  },
  VectorMean: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorMean", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array) => {
      let acc = 0;
      for (let i = 0; i < v.length; i++) acc += Number(v[i]!);
      return acc / v.length;
    };
  },
  VectorCumSum: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorCumSum", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array) => {
      if (elem === "Float") {
        const result = new Float64Array(v.length);
        let acc = 0;
        for (let i = 0; i < v.length; i++) {
          acc += v[i] as number;
          result[i] = acc;
        }
        return result;
      }
      const result = new BigInt64Array(v.length);
      let acc = 0n;
      for (let i = 0; i < v.length; i++) {
        acc = wrapI64(acc + (v[i] as bigint));
        result[i] = acc;
      }
      return result;
    };
  },
  VectorAbs: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorAbs", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array) => {
      if (elem === "Float") {
        const result = new Float64Array(v.length);
        for (let i = 0; i < v.length; i++) {
          const x = v[i] as number;
          result[i] = x < 0 ? -x : x;
        }
        return result;
      }
      const result = new BigInt64Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const x = v[i] as bigint;
        result[i] = wrapI64(x < 0n ? -x : x);
      }
      return result;
    };
  },
  VectorClamp: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorClamp", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array, lo: any, hi: any) => {
      const result = elem === "Float" ? new Float64Array(v.length) : new BigInt64Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const x = v[i]!;
        (result as any)[i] = less(x, lo) ? lo : less(hi, x) ? hi : x;
      }
      return result;
    };
  },

  // Vector gather/scatter and sorted search
  VectorGather: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (v: Float64Array | BigInt64Array | Uint8ClampedArray, idx: BigInt64Array) => {
    const result = allocateTypedArray(T, idx.length);
    for (let j = 0; j < idx.length; j++) {
      const i = Number(idx[j]!);
      if (i < 0 || i >= v.length) {
        throw new EastError(`Vector index ${idx[j]} out of bounds (length ${v.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      result[j] = v[i]! as never;
    }
    return result;
  },
  VectorScatterAdd: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorScatterAdd", T, loc_id, source_map);
    return (dst: Float64Array | BigInt64Array, idx: BigInt64Array, src: Float64Array | BigInt64Array) => {
      requireSameLength(idx, src, loc_id, source_map);
      const result = dst.slice() as Float64Array | BigInt64Array;
      for (let j = 0; j < idx.length; j++) {
        const i = Number(idx[j]!);
        if (i < 0 || i >= dst.length) {
          throw new EastError(`Vector index ${idx[j]} out of bounds (length ${dst.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
        if (elem === "Float") {
          (result as Float64Array)[i] = ((result as Float64Array)[i]!) + (src[j] as number);
        } else {
          (result as BigInt64Array)[i] = wrapI64(((result as BigInt64Array)[i]!) + (src[j] as bigint));
        }
      }
      return result;
    };
  },
  VectorSearchSorted: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const less = lessFor(T);
    const readElem = T.type === "Boolean"
      ? (v: any, i: number) => v[i] !== 0
      : (v: any, i: number) => v[i];
    return (haystack: Float64Array | BigInt64Array | Uint8ClampedArray, needles: Float64Array | BigInt64Array | Uint8ClampedArray) => {
      const result = new BigInt64Array(needles.length);
      for (let j = 0; j < needles.length; j++) {
        const needle = readElem(needles, j);
        let lo = 0;
        let hi = haystack.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (less(readElem(haystack, mid), needle)) {
            lo = mid + 1;
          } else {
            hi = mid;
          }
        }
        result[j] = BigInt(lo);
      }
      return result;
    };
  },

  // Vector masks and selection (comparisons use East's total order)
  VectorEq: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const equal = equalFor(T);
    const readElem = T.type === "Boolean"
      ? (v: any, i: number) => v[i] !== 0
      : (v: any, i: number) => v[i];
    return (a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
      requireSameLength(a, b, loc_id, source_map);
      const result = new Uint8ClampedArray(a.length);
      for (let i = 0; i < a.length; i++) result[i] = equal(readElem(a, i), readElem(b, i)) ? 1 : 0;
      return result;
    };
  },
  VectorLt: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const less = lessFor(T);
    const readElem = T.type === "Boolean"
      ? (v: any, i: number) => v[i] !== 0
      : (v: any, i: number) => v[i];
    return (a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
      requireSameLength(a, b, loc_id, source_map);
      const result = new Uint8ClampedArray(a.length);
      for (let i = 0; i < a.length; i++) result[i] = less(readElem(a, i), readElem(b, i)) ? 1 : 0;
      return result;
    };
  },
  VectorGt: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const greater = greaterFor(T);
    const readElem = T.type === "Boolean"
      ? (v: any, i: number) => v[i] !== 0
      : (v: any, i: number) => v[i];
    return (a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
      requireSameLength(a, b, loc_id, source_map);
      const result = new Uint8ClampedArray(a.length);
      for (let i = 0; i < a.length; i++) result[i] = greater(readElem(a, i), readElem(b, i)) ? 1 : 0;
      return result;
    };
  },
  VectorSelect: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (mask: Uint8ClampedArray, a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
    requireSameLength(mask, a, loc_id, source_map);
    requireSameLength(a, b, loc_id, source_map);
    const result = allocateTypedArray(T, mask.length);
    for (let i = 0; i < mask.length; i++) result[i] = (mask[i] !== 0 ? a[i]! : b[i]!) as never;
    return result;
  },
  VectorCompress: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (mask: Uint8ClampedArray, v: Float64Array | BigInt64Array | Uint8ClampedArray) => {
    requireSameLength(mask, v, loc_id, source_map);
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 0) count++;
    }
    const result = allocateTypedArray(T, count);
    let j = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 0) result[j++] = v[i]! as never;
    }
    return result;
  },
  VectorCountTrue: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[]) => (mask: Uint8ClampedArray) => {
    let count = 0n;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 0) count += 1n;
    }
    return count;
  },
} satisfies BuiltinEvaluators;
