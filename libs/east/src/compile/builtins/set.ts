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
import { printFor } from "../../serialization/east.js";
import type { EastTypeValue } from "../../type_of_type.js";

/** The builtins for Sets. @internal */
export const set_builtins = {
  SetGenerate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const keyComparer = compareFor(K);
    return (size: bigint, keyFn: (i: bigint) => any, onConflict: (key: any) => null) => {
      const result = new SortedSet([], keyComparer);
      for (let i = 0n; i < size; i += 1n) {
        const k = call_function(loc_id, source_map,keyFn, i);
        if (result.has(k)) {
          call_function(loc_id, source_map,onConflict, k);
        } else {
          result.add(k);
        }
      }
      return result;
    }
  },
  SetSize: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>) => BigInt(s.size),
  SetHas: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>, key: any) => s.has(key),
  SetInsert: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const print = printFor(K);
    return (s: Set<any>, key: any) => {
      if (isFrozenValue(s)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(s) || 0) > 0) {
        throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const size_before = s.size;
      s.add(key);
      if (s.size === size_before) {
        throw new EastError(`Set already contains key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      return null;
    }
  },
  SetTryInsert: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>, key: any) => {
    if (isFrozenValue(s)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(s) || 0) > 0) {
      throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const size_before = s.size;
    s.add(key);
    return s.size > size_before;
  },
  SetDelete: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const print = printFor(K);
    return (s: Set<any>, key: any) => {
      if (isFrozenValue(s)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(s) || 0) > 0) {
        throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if (!s.delete(key)) {
        throw new EastError(`Set does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      return null;
    }
  },
  SetTryDelete: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>, key: any) => {
    if (isFrozenValue(s)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(s) || 0) > 0) {
      throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    return s.delete(key);
  },
  SetClear: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>) => {
    if (isFrozenValue(s)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(s) || 0) > 0) {
      throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    s.clear();
    return null
  },
  SetUnionInPlace: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => {
    if (isFrozenValue(s1)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(s1) || 0) > 0) {
      throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    s2.forEach(v => s1.add(v));
    return null;
  },
  SetUnion: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.union(s2),
  SetIntersect: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.intersection(s2),
  SetDiff: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.difference(s2),
  SetSymDiff: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.symmetricDifference(s2),
  SetIsSubset: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.isSubsetOf(s2),
  SetIsDisjoint: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.isDisjointFrom(s2),
  SetCopy: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const compare = compareFor(K);
    return (s: SortedSet<any>) => {
      return new SortedSet([...s], compare);
    }
  },
  SetForEach: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, f: (x: any) => any) => {
    lockForIteration(s);
    try {
      s.forEach(x => {
        call_function(loc_id, source_map,f, x);
      });
      return null;
    } finally {
      unlockForIteration(s);
    }
  },
  SetFilter: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const compare = compareFor(K);
    return (s: SortedSet<any>, f: (x: any) => any) => {
      const result = new SortedSet([], compare);
      lockForIteration(s);
      try {
        s.forEach(x => {
          const keep = call_function(loc_id, source_map,f, x);
          if (keep) {
            result.add(x);
          }
        });
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetFilterMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K);
    return (s: SortedSet<any>, f: (k: any) => option<any>) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        s.forEach(k => {
          const v2: option<any> = call_function(loc_id, source_map,f, k);
          if (v2.type === "some") {
            result.set(k, v2.value);
          }
        });
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetFirstMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: SortedSet<any>, f: (k: any) => any) => {
    lockForIteration(s);
    try {
      for (const k of s) {
        const v: option<any> = call_function(loc_id, source_map,f, k);
        if (v.type === "some") {
          return v;
        }
      }
      return variant("none", null);
    } finally {
      unlockForIteration(s);
    }
  },
  SetMapReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: SortedSet<any>, mapFn: (k: any) => any, reduceFn: (x: any, y: any) => any) => {
    if (s.size === 0) {
      throw new EastError("Cannot reduce empty set with no initial value", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(s);
    try {
      const iterator = s[Symbol.iterator]();
      const first = iterator.next().value;
      let acc = call_function(loc_id, source_map,mapFn, first);
      for (const k of iterator) {
        const mapped = call_function(loc_id, source_map,mapFn, k);
        acc = call_function(loc_id, source_map,reduceFn, acc, mapped);
      }
      return acc;
    } finally {
      unlockForIteration(s);
    }
  },
  SetMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K);
    return (s: SortedSet<any>, f: (x: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        s.forEach(x => {
          const v = call_function(loc_id, source_map,f, x);
          result.set(x, v);
        });
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, f: (acc: any, x: any) => any, init: any) => {
    let acc = init;
    lockForIteration(s);
    try {
      for (const x of s) {
        acc = call_function(loc_id, source_map,f, acc, x);
      }
      return acc;
    } finally {
      unlockForIteration(s);
    }
  },
  SetScan: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, f: (acc: any, x: any) => any, init: any) => {
    const result: any[] = [];
    let acc = init;
    lockForIteration(s);
    try {
      for (const x of s) {
        acc = call_function(loc_id, source_map,f, acc, x);
        result.push(acc);
      }
      return result;
    } finally {
      unlockForIteration(s);
    }
  },
  SetToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, valueFn: (key: any) => any) => {
    const ret = [];
    lockForIteration(s);
    try {
      for (const k of s) {
        const v = call_function(loc_id, source_map,valueFn, k);
        ret.push(v);
      }
      return ret;
    } finally {
      unlockForIteration(s);
    }
  },
  SetToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: SortedSet<any>, f: (x: any) => any) => {
      const result = new SortedSet([], compare);
      lockForIteration(s);
      try {
        for (const x of s) {
          const v = call_function(loc_id, source_map,f, x);
          result.add(v);
        };
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: Set<any>, keyFn: (key: any) => any, valueFn: (key: any) => any, onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        for (const k of s) {
          const k2 = call_function(loc_id, source_map,keyFn, k);
          let v2 = call_function(loc_id, source_map,valueFn, k);
          const existing = result.get(k2);
          if (existing !== undefined) {
            v2 = call_function(loc_id, source_map,onConflict, existing, v2, k2);
            result.set(k2, v2);
          } else {
            result.set(k2, v2);
          }
        }
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetFlattenToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, fn: (value: any) => any[]) => {
    const ret = [];
    lockForIteration(s);
    try {
      for (const k of s) {
        const subarray = call_function(loc_id, source_map,fn, k);
        ret.push(...subarray);
      }
      return ret;
    } finally {
      unlockForIteration(s);
    }
  },
  SetFlattenToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: Set<any>, fn: (value: any) => any[]) => {
      const result = new SortedSet([], compare);
      lockForIteration(s);
      try {
        for (const k of s) {
          const subset = call_function(loc_id, source_map,fn, k);
          for (const k2 of subset) {
            result.add(k2);
          }
        }
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetFlattenToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: Set<any>, fn: (value: any) => any[], onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        for (const k of s) {
          const subdict = call_function(loc_id, source_map,fn, k);
          for (const [k2, v2] of subdict.entries()) {
            const existing = result.get(k2);
            if (existing === undefined) {
              result.set(k2, v2);
            } else {
              const new_v2 = call_function(loc_id, source_map,onConflict, existing, v2, k2);
              result.set(k2, new_v2);
            }
          }
        }
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetGroupFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, K2: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: Set<any>, keyFn: (k: any) => any, init: (k2: any) => any, folder: (acc: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        for (const k of s) {
          const k2 = call_function(loc_id, source_map,keyFn, k);
          let existing = result.get(k2);
          if (existing === undefined) {
            existing = call_function(loc_id, source_map,init, k2);
          }
          const new_val = call_function(loc_id, source_map,folder, existing, k);
          result.set(k2, new_val);
        }
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
} satisfies BuiltinEvaluators;
