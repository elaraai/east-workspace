/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { compareFor } from "../../comparison.js";
import { type BuiltinEvaluators, call_function, FROZEN_MESSAGE, iterationLocks, lockForIteration, unlockForIteration } from "../runtime.js";
import { SortedMap } from "../../containers/sortedmap.js";
import { SortedSet } from "../../containers/sortedset.js";
import { type option, variant } from "../../containers/variant.js";
import { EastError } from "../../error.js";
import { isFrozenValue } from "../../frozen.js";
import type { Location, SourceMap } from "../../location.js";
import type { PlatformFunction } from "../../platform.js";
import type { EastTypeValue } from "../../type_of_type.js";

/** The builtins for Arrays. @internal */
export const array_builtins = {
  ArrayGenerate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (size: bigint, f: (i: bigint) => any) => {
    const result: any[] = [];
    for (let i = 0n; i < size; i += 1n) {
      const v = call_function(loc_id, source_map,f, i);
      result.push(v);
    }
    return result;
  },
  ArrayRange: (_loc_id: bigint, _source_map: SourceMap | null) => (start: bigint, end: bigint, step: bigint) => {
    const result: any[] = [];
    if (step === 0n) {
      return result; // empty array
    } else if (step > 0n) {
      for (let i = start; i < end; i += step) {
        result.push(i);
      }
    } else { // step < 0
      for (let i = start; i > end; i += step) {
        result.push(i);
      }
    }
    return result;
  },
  ArrayLinspace: (_loc_id: bigint, _source_map: SourceMap | null) => (start: number, end: number, size: bigint) => {
    const result: any[] = [];
    if (size <= 0n) {
      return result; // empty array
    } else if (size === 1n) {
      return [start];
    } else {
      const step = (end - start) / Number(size - 1n);
      for (let i = 0n; i < size; i += 1n) {
        result.push(start + Number(i) * step);
      }
    }
    return result;
  },
  ArraySize: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => BigInt(array.length),
  ArrayHas: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint) => {
    const i = Number(key);
    return i >= 0 && i < array.length;
  },
  ArrayGet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint) => {
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      throw new EastError(`Array index ${key} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      return array[i];
    }
  },
  ArrayGetOrDefault: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint, defaultFn: (key: bigint) => any) => {
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      return call_function(loc_id, source_map,defaultFn, key);
    } else {
      return array[i];
    }
  },
  ArrayTryGet: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint) => {
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      return variant("none", null);
    } else {
      return variant("some", array[i]);
    }
  },
  ArrayUpdate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint, value: any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      throw new EastError(`Array index ${key} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      array[i] = value;
      return null;
    }
  },
  ArrayMerge: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint, value: any, merger: (existing: any, value: any, key: bigint) => any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      throw new EastError(`Array index ${key} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      const new_value = call_function(loc_id, source_map,merger, array[i], value, key);
      array[i] = new_value;
      return null;
    }
  },
  ArrayPushLast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], value: any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.push(value);
    return null;
  },
  ArrayPopLast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if (array.length === 0) {
      throw new EastError("Cannot pop from empty Array", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      return array.pop();
    }
  },
  ArrayPushFirst: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], value: any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.unshift(value);
    return null;
  },
  ArrayPopFirst: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if (array.length === 0) {
      throw new EastError("Cannot pop from empty Array", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      return array.shift();
    }
  },
  ArrayAppend: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], other: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.push(...other);
    return null;
  },
  ArrayPrepend: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], other: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.unshift(...other);
    return null;
  },
  ArrayMergeAll: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], other: any[], merger: (v1: any, v2: any, key: bigint) => any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(array);
    lockForIteration(other);
    try {
      for (let i = 0; i < other.length; i++) {
        const key = BigInt(i);
        if (i < array.length) {
          const new_value = call_function(loc_id, source_map,merger, array[i], other[i], key);
          array[i] = new_value;
        } else {
          throw new EastError(`Array index ${key} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
      }
    } finally {
      unlockForIteration(other);
      unlockForIteration(array);
    }
    return null;
  },
  ArrayClear: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.length = 0;
    return null;
  },
  ArraySortInPlace: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => (array: any[], by: (a: any) => any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(array);
    try {
      const cmp = compareFor(T2);
      array.sort((a, b) => {
        const projectedA = call_function(loc_id, source_map,by, a);
        const projectedB = call_function(loc_id, source_map,by, b);
        return cmp(projectedA, projectedB);
      });
    } finally {
      unlockForIteration(array);
    }
    return null;
  },
  ArrayReverseInPlace: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.reverse();
    return null;
  },
  ArraySort: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => (array: any[], by: (a: any) => any) => {
    const cmp = compareFor(T2);
    const newArray = [...array];
    newArray.sort((a, b) => {
      const projectedA = call_function(loc_id, source_map,by, a);
      const projectedB = call_function(loc_id, source_map,by, b);
      return cmp(projectedA, projectedB);
    });
    return newArray;
  },
  ArrayReverse: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    const newArray = [...array];
    newArray.reverse();
    return newArray;
  },
  ArrayIsSorted: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], by: (a: any) => any) => {
      if (array.length < 2) return true;

      lockForIteration(array);
      try {
        let projectedPrev = call_function(loc_id, source_map,by, array[0]!);

        for (let i = 1; i < array.length; i++) {
          const projectedCurr = call_function(loc_id, source_map,by, array[i]);

          if (cmp(projectedPrev, projectedCurr) > 0) {
            return false;
          }

          projectedPrev = projectedCurr;
        }
      } finally {
        unlockForIteration(array);
      }
      return true;
    };
  },
  ArrayFindSortedFirst: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], key: any, by: (a: any) => any) => {
      let low = 0;
      let high = array.length;

      lockForIteration(array);
      try {
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const projectedMid = call_function(loc_id, source_map,by, array[mid]!);

          if (cmp(projectedMid, key) < 0) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }
      } finally {
        unlockForIteration(array);
      }

      return BigInt(low);
    };
  },
  ArrayFindSortedLast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], key: any, by: (a: any) => any) => {
      let low = 0;
      let high = array.length;

      lockForIteration(array);
      try {
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const projectedMid = call_function(loc_id, source_map,by, array[mid]!);

          if (cmp(projectedMid, key) <= 0) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }
      } finally {
        unlockForIteration(array);
      }

      return BigInt(low);
    };
  },
  ArrayFindSortedRange: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], key: any, by: (a: any) => any) => {
      let lo = -1;
      let hi = array.length;
      
      lockForIteration(array);
      try {
        // Main search loop - find any equal element or determine the range doesn't exist
        while (lo < hi - 1) {
          const mid = Math.floor((lo + hi) / 2);
          const projectedMid = call_function(loc_id, source_map,by, array[mid]!);

          const cmpResult = cmp(projectedMid, key);
          if (cmpResult < 0) {
            lo = mid;
          } else if (cmpResult > 0) {
            hi = mid;
          } else {
            // Found an equal element! Now find the first and last positions
            // within the constrained range

            // Find first position in range [max(lo, -1), mid]
            let firstLo = Math.max(lo, -1);
            let firstHi = mid + 1;

            while (firstLo < firstHi - 1) {
              const firstMid = Math.floor((firstLo + firstHi) / 2);
              const projectedFirst = call_function(loc_id, source_map,by, array[firstMid]!);

              if (cmp(projectedFirst, key) < 0) {
                firstLo = firstMid;
              } else {
                firstHi = firstMid;
              }
            }

            // Find last position in range [mid, min(hi, array.length)]
            let lastLo = mid - 1;
            let lastHi = Math.min(hi, array.length);

            while (lastLo < lastHi - 1) {
              const lastMid = Math.floor((lastLo + lastHi) / 2);
              const projectedLast = call_function(loc_id, source_map,by, array[lastMid]!);

              if (cmp(projectedLast, key) <= 0) {
                lastLo = lastMid;
              } else {
                lastHi = lastMid;
              }
            }

            return { start: BigInt(firstLo + 1), end: BigInt(lastLo + 1) };
          }
        }
      } finally {
        unlockForIteration(array);
      }

      // No equal element found - return empty range
      return { start: BigInt(lo + 1), end: BigInt(lo + 1) };
    };
  },
  ArrayFindFirst: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], value: any, by: (a: any) => any) => {
      lockForIteration(array);
      try {
        for (let i = 0; i < array.length; i++) {
          const projected = call_function(loc_id, source_map,by, array[i]);
          if (cmp(projected, value) === 0) {
            return variant("some", BigInt(i));
          }
        }
        return variant("none", null);
      } finally {
        unlockForIteration(array);
      }
    };
  },
  ArrayConcat: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (a1: any[], a2: any[]) => {
    return [...a1, ...a2];
  },
  ArraySlice: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], start: bigint, end: bigint) => {
    const startNum = Number(start);
    const endNum = Number(end);
    return array.slice(startNum, endNum);
  },
  ArrayGetKeys: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], keys: bigint[], onMissing: (key: bigint) => any) => {
    return keys.map(k => {
      const i = Number(k);
      if (i < 0 || i >= array.length) {
        return call_function(loc_id, source_map,onMissing, k);
      } else {
        return array[i];
      }
    });
  },
  ArrayForEach: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      array.forEach((x, i) => {
        return call_function(loc_id, source_map,f, x, BigInt(i));
      });
      return null;
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayCopy: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    return [...array];
  },
  ArrayMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      return array.map((x, i) => {
        return call_function(loc_id, source_map,f, x, BigInt(i));
      });
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayFilter: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      return array.filter((x, i) => {
        return call_function(loc_id, source_map,f, x, BigInt(i));
      });
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayFilterMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      const result: any[] = [];
      for (let i = 0; i < array.length; i++) {
        const v: option<any> = call_function(loc_id, source_map,f, array[i], BigInt(i));
        if (v.type === "some") {
          result.push(v.value);
        }
      }
      return result;
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayFirstMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      for (let i = 0; i < array.length; i++) {
        const v: option<any> = call_function(loc_id, source_map,f, array[i], BigInt(i));
        if (v.type === "some") {
          return v;
        }
      }
      return variant("none", null);
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], init: any, f: (acc: any, x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      return array.reduce((acc, x, i) => {
        return call_function(loc_id, source_map,f, acc, x, BigInt(i));
      }, init);
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayScan: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], init: any, f: (acc: any, x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      const result: any[] = [];
      let acc = init;
      for (let i = 0; i < array.length; i++) {
        acc = call_function(loc_id, source_map,f, acc, array[i], BigInt(i));
        result.push(acc);
      }
      return result;
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayMapReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], mapFn: (x: any, i: bigint) => any, reduceFn: (x: any, y:any) => any) => {
    if (array.length === 0) {
      throw new EastError("Cannot reduce empty array with no initial value", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(array);
    try {
      let acc = call_function(loc_id, source_map,mapFn, array[0], 0n);
      for (let i = 1; i < array.length; i++) {
        const mapped = call_function(loc_id, source_map,mapFn, array[i], BigInt(i));
        acc = call_function(loc_id, source_map,reduceFn, acc, mapped);
      }
      return acc;
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayStringJoin: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[]) => (x: string[], y:string) => x.join(y),
  ArrayToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, T2: EastTypeValue) => {
    const compare = compareFor(T2);
    return (array: any[], f: (x: any, i: bigint) => any) => {
      lockForIteration(array);
      try {
        const result = new SortedSet([], compare);
        for (let i = 0; i < array.length; i++) {
          const v = call_function(loc_id, source_map,f, array[i], BigInt(i));
          result.add(v);
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },
  ArrayToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, K2: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (array: any[], keyFn: (v: any, i: bigint) => any, valueFn: (v: any, i: bigint) => any, onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(array);
      try {
        for (let i = 0; i < array.length; i++) {
          const v = array[i];
          const k = call_function(loc_id, source_map,keyFn, v, BigInt(i));
          let val = call_function(loc_id, source_map,valueFn, v, BigInt(i));
          const existing = result.get(k);
          if (existing === undefined) {
            result.set(k, val);
          } else {
            val = call_function(loc_id, source_map,onConflict, existing, val, k);
            result.set(k, val);
          }
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },
  ArrayFlattenToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], fn: (value: any) => any[]) => {
    return array.flatMap(v => {
      return call_function(loc_id, source_map,fn, v);
    });
  },
  ArrayFlattenToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (array: any[], fn: (value: any) => any[]) => {
      const result = new SortedSet([], compare);
      lockForIteration(array);
      try {
        for (const v of array) {
          const subset = call_function(loc_id, source_map,fn, v);
          for (const k of subset) {
            result.add(k);
          }
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },
  ArrayFlattenToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, K2: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (array: any[], fn: (value: any) => any[], onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(array);
      try {
        for (const v of array) {
          const subdict = call_function(loc_id, source_map,fn, v);
          for (const [k, val] of subdict.entries()) {
            const existing = result.get(k);
            if (existing === undefined) {
              result.set(k, val);
            } else {
              const new_val = call_function(loc_id, source_map,onConflict, existing, val, k);
              result.set(k, new_val);
            }
          }
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },
  ArrayGroupFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (array: any[], keyFn: (v: any, i: bigint) => any, init: (k: any) => any, folder: (acc: any, v: any, i: bigint) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(array);
      try {
        for (let i = 0; i < array.length; i++) {
          const v = array[i];
          const k = call_function(loc_id, source_map,keyFn, v, BigInt(i));
          let existing = result.get(k);
          if (existing === undefined) {
            existing = call_function(loc_id, source_map,init, k);
          }
          const new_val = call_function(loc_id, source_map,folder, existing, v, BigInt(i));
          result.set(k, new_val);
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },
} satisfies BuiltinEvaluators;
