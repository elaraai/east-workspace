/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { greaterFor } from "../../comparison.js";
import type { BuiltinEvaluators } from "../runtime.js";
import { requireNumericElem, requireSparse, wrapI64 } from "../typed_arrays.js";
import { EastError } from "../../error.js";
import type { Location, SourceMap } from "../../location.js";
import type { PlatformFunction } from "../../platform.js";
import type { EastTypeValue } from "../../type_of_type.js";

/** The builtins for sparse accumulators over Vectors. @internal */
export const sparse_builtins = {
  // Sparse accumulators: parallel (ix, v) with strictly ascending ix.
  // Entries absent from a side are structurally absent, not explicit zeros:
  // an A-only entry passes through unscaled, a B-only entry contributes
  // alpha*vB even when alpha is NaN or infinite.
  SparseAxpy: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("SparseAxpy", T, loc_id, source_map);
    return (ixA: BigInt64Array, vA: Float64Array | BigInt64Array, ixB: BigInt64Array, vB: Float64Array | BigInt64Array, alpha: any) => {
      requireSparse(ixA, vA, loc_id, source_map);
      requireSparse(ixB, vB, loc_id, source_map);
      let count = 0;
      let i = 0;
      let j = 0;
      while (i < ixA.length && j < ixB.length) {
        const a = ixA[i]!;
        const b = ixB[j]!;
        if (a < b) i++;
        else if (b < a) j++;
        else { i++; j++; }
        count++;
      }
      count += (ixA.length - i) + (ixB.length - j);
      const outIx = new BigInt64Array(count);
      const outV = elem === "Float" ? new Float64Array(count) : new BigInt64Array(count);
      i = 0;
      j = 0;
      let k = 0;
      while (i < ixA.length && j < ixB.length) {
        const a = ixA[i]!;
        const b = ixB[j]!;
        if (a < b) {
          outIx[k] = a;
          (outV as any)[k] = vA[i]!;
          i++;
        } else if (b < a) {
          outIx[k] = b;
          (outV as any)[k] = elem === "Float" ? alpha * (vB[j] as number) : wrapI64(alpha * (vB[j] as bigint));
          j++;
        } else {
          outIx[k] = a;
          (outV as any)[k] = elem === "Float"
            ? (vA[i] as number) + alpha * (vB[j] as number)
            : wrapI64((vA[i] as bigint) + wrapI64(alpha * (vB[j] as bigint)));
          i++;
          j++;
        }
        k++;
      }
      for (; i < ixA.length; i++, k++) {
        outIx[k] = ixA[i]!;
        (outV as any)[k] = vA[i]!;
      }
      for (; j < ixB.length; j++, k++) {
        outIx[k] = ixB[j]!;
        (outV as any)[k] = elem === "Float" ? alpha * (vB[j] as number) : wrapI64(alpha * (vB[j] as bigint));
      }
      return { ix: outIx, v: outV };
    };
  },
  SparseFromPairs: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("SparseFromPairs", T, loc_id, source_map);
    return (ix: BigInt64Array, v: Float64Array | BigInt64Array) => {
      if (ix.length !== v.length) {
        throw new EastError(`Sparse index and value lengths differ (${ix.length} vs ${v.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      // Stable: order by (index, original position) so equal indices
      // accumulate in input order and the float result is deterministic.
      const order = new Array<number>(ix.length);
      for (let i = 0; i < ix.length; i++) order[i] = i;
      order.sort((p, q) => {
        const a = ix[p]!;
        const b = ix[q]!;
        if (a < b) return -1;
        if (a > b) return 1;
        return p - q;
      });
      let count = 0;
      for (let i = 0; i < order.length; i++) {
        if (i === 0 || ix[order[i]!]! !== ix[order[i - 1]!]!) count++;
      }
      const outIx = new BigInt64Array(count);
      const outV = elem === "Float" ? new Float64Array(count) : new BigInt64Array(count);
      let k = -1;
      for (let i = 0; i < order.length; i++) {
        const p = order[i]!;
        if (i === 0 || ix[p]! !== outIx[k]!) {
          k++;
          outIx[k] = ix[p]!;
          (outV as any)[k] = v[p]!;
        } else {
          (outV as any)[k] = elem === "Float"
            ? ((outV as Float64Array)[k]!) + (v[p] as number)
            : wrapI64(((outV as BigInt64Array)[k]!) + (v[p] as bigint));
        }
      }
      return { ix: outIx, v: outV };
    };
  },
  SparseFilterGt: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("SparseFilterGt", T, loc_id, source_map);
    const greater = greaterFor(T);
    return (ix: BigInt64Array, v: Float64Array | BigInt64Array, threshold: any) => {
      requireSparse(ix, v, loc_id, source_map);
      let count = 0;
      for (let i = 0; i < v.length; i++) {
        if (greater(v[i]!, threshold)) count++;
      }
      const outIx = new BigInt64Array(count);
      const outV = elem === "Float" ? new Float64Array(count) : new BigInt64Array(count);
      let k = 0;
      for (let i = 0; i < v.length; i++) {
        if (greater(v[i]!, threshold)) {
          outIx[k] = ix[i]!;
          (outV as any)[k] = v[i]!;
          k++;
        }
      }
      return { ix: outIx, v: outV };
    };
  },
} satisfies BuiltinEvaluators;
