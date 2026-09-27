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

/** The builtins for Dicts. @internal */
export const dict_builtins = {
  DictGenerate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const keyComparer = compareFor(K);
    return (size: bigint, keyFn: (i: bigint) => any, valueFn: (i: bigint) => any, onConflict: (v1: any, v2: any, key: any) => any) => {
      const result = new SortedMap([], keyComparer);
      for (let i = 0n; i < size; i += 1n) {
        const k = call_function(loc_id, source_map,keyFn, i);
        const v = call_function(loc_id, source_map,valueFn, i);
        const existing = result.get(k);
        if (existing !== undefined) {
          const v2 = call_function(loc_id, source_map,onConflict, existing, v, k);
          result.set(k, v2);
        } else {
          result.set(k, v);
        }
      }
      return result;
    }
  },
  DictSize: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>) => BigInt(d.size),
  DictHas: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any) => d.has(key),
  DictGet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any) => {
      const result = d.get(key);
      if (result === undefined) {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      } else {
        return result;
      }
    }
  },
  DictGetOrDefault: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any, onMissingFn: (key: any) => any) => {
    const result = d.get(key);
    if (result === undefined) {
      return call_function(loc_id, source_map,onMissingFn, key);
    } else {
      return result;
    }
  },
  DictTryGet: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any) => {
    const result = d.get(key);
    if (result === undefined) {
      return variant("none", null);
    } else {
      return variant("some", result);
    }
  },
  DictInsert: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any, value: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(d) || 0) > 0) {
        throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const existing = d.get(key);
      if (existing !== undefined) {
        throw new EastError(`Dict already contains key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      } else {
        d.set(key, value);
      }
      return null;
    }
  },
  DictGetOrInsert: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any, onMissing: (key: any) => any) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const existing = d.get(key);
    if (existing === undefined) {
      const newValue = call_function(loc_id, source_map,onMissing, key);
      d.set(key, newValue);
      return newValue;
    } else {
      return existing;
    }
  },
  DictInsertOrUpdate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any, value: any, onConflictFn: (existing: any, newValue: any, key: any) => any) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const existing = d.get(key);
    if (existing !== undefined) {
      const result = call_function(loc_id, source_map,onConflictFn, existing, value, key);
      d.set(key, result);
    } else {
      d.set(key, value);
    }
    return null;
  },
  DictUpdate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any, value: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if (d.has(key)) {
        d.set(key, value);
        return null;
      } else {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  DictSwap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any, value: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let existing = d.get(key);
      if (existing === undefined) {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      d.set(key, value);
      return existing;
    };
  },
  DictMerge: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any, value: any, mergeFn: (existing: any, value: any, key: any) => any, initialFn: (key: any) => any) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    let existing = d.get(key);
    if (existing === undefined) {
      existing = call_function(loc_id, source_map,initialFn, key);
    }
    const new_value = call_function(loc_id, source_map,mergeFn, existing, value, key);
    d.set(key, new_value);
    return null;
  },
  DictDelete: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(d) || 0) > 0) {
        throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const existed = d.delete(key);
      if (!existed) {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      return null;
    }
  },
  DictTryDelete: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    return d.delete(key);
  },
  DictPop: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(d) || 0) > 0) {
        throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const existing = d.get(key);
      if (existing === undefined) {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      } else {
        d.delete(key);
        return existing;
      }
    };
  },
  DictClear: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    d.clear();
    return null;
  },
  DictUnionInPlace: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d1: Map<any, any>, d2: Map<any, any>, onConflict: (v1: any, v2: any, key: any) => any) => {
    if (isFrozenValue(d1)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d1) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    d2.forEach((v2, k) => {
      const v1 = d1.get(k);
      if (v1 === undefined) {
        d1.set(k, v2);
      } else {
        const new_value = call_function(loc_id, source_map,onConflict, v1, v2, k);
        d1.set(k, new_value);
      }
    });
    return null;
  },
  DictMergeAll: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d1: SortedMap<any, any>, d2: SortedMap<any, any>, mergeFn: (v1: any, v2: any, key: any) => any, initialFn: (key: any) => any) => {
    if (isFrozenValue(d1)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d1) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    d2.forEach((v2, k) => {
      let v1 = d1.get(k);
      if (v1 === undefined) {
        v1 = call_function(loc_id, source_map,initialFn, k);
      }
      const new_value = call_function(loc_id, source_map,mergeFn, v1, v2, k);
      d1.set(k, new_value);
    });
    return null;
  },
  DictKeys: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: Map<any, any>) => {
      return new SortedSet([...d.keys()], compare);
    }
  },
  DictGetKeys: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>, keys: SortedSet<any>, onMissing: (key: any) => any) => {
      const result = new SortedMap([], compare);
      for (const k of keys) {
        const v = d.get(k);
        if (v !== undefined) {
          result.set(k, v);
        } else {
          const new_v = call_function(loc_id, source_map,onMissing, k);
          result.set(k, new_v);
        }
      }
      return result;
    }
  },
  DictForEach: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2) => (d: Map<any, any>, f: (k: any, v: any) => any) => {
    lockForIteration(d);
    try {
      d.forEach((v, k) => {
        call_function(loc_id, source_map,f, v, k);
      });
      return null;
    } finally {
      unlockForIteration(d);
    }
  },
  DictCopy: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>) => {
      return new SortedMap([...d], compare);
    }
  },
  DictMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>, f: (v: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const v2 = call_function(loc_id, source_map,f, v, k);
          result.set(k, v2);
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFilter: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>, f: (v: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const keep = call_function(loc_id, source_map,f, v, k);
          if (keep) {
            result.set(k, v);
          }
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFilterMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>, f: (v: any, k: any) => option<any>) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const v2: option<any> = call_function(loc_id, source_map,f, v, k);
          if (v2.type === "some") {
            result.set(k, v2.value);
          }
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFirstMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, f: (v: any, k: any) => option<any>) => {
    lockForIteration(d);
    try {
      for (const [k, v] of d) {
        const result: option<any> = call_function(loc_id, source_map,f, v, k);
        if (result.type === "some") {
          return result;
        }
      }
      return variant("none", null);
    } finally {
      unlockForIteration(d);
    }
  },
  DictMapReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, mapFn: (v: any, k: any) => any, reduceFn: (x: any, y: any) => any) => {
    if (d.size === 0) {
      throw new EastError("Cannot reduce empty dictionary with no initial value", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(d);
    try {
      const iterator = d[Symbol.iterator]();
      const first = iterator.next().value!;
      let acc = call_function(loc_id, source_map,mapFn, first[1], first[0]);
      for (const [k, v] of iterator) {
        const mapped = call_function(loc_id, source_map,mapFn, v, k);
        acc = call_function(loc_id, source_map,reduceFn, acc, mapped);
      }
      return acc;
    } finally {
      unlockForIteration(d);
    }
  },
  DictReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, f: (acc: any, v: any, k: any) => any, init: any) => {
    let acc = init;
    lockForIteration(d);
    try {
      for (const [k, v] of d) {
        acc = call_function(loc_id, source_map,f, acc, v, k);
      }
      return acc;
    } finally {
      unlockForIteration(d);
    }
  },
  DictScan: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, f: (acc: any, v: any, k: any) => any, init: any) => {
    const result: any[] = [];
    let acc = init;
    lockForIteration(d);
    try {
      for (const [k, v] of d) {
        acc = call_function(loc_id, source_map,f, acc, v, k);
        result.push(acc);
      }
      return result;
    } finally {
      unlockForIteration(d);
    }
  },
  DictToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, valueFn: (v: any, k: any) => any) => {
    const ret = [];
    lockForIteration(d);
    try {
      for (const [k, v] of d) {
        const v2 = call_function(loc_id, source_map,valueFn, v, k);
        ret.push(v2);
      }
      return ret;
    } finally {
      unlockForIteration(d);
    }
  },
  DictToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: SortedMap<any, any>, fn: (v: any, k: any) => any) => {
      const result = new SortedSet([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const k2 = call_function(loc_id, source_map,fn, v, k);
          result.add(k2);
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: Map<any, any>, keyFn: (v: any, k: any) => any, valueFn: (v: any, k: any) => any, onConflict: (v1: any, v2: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const k2 = call_function(loc_id, source_map,keyFn, v, k);
          const v2 = call_function(loc_id, source_map,valueFn, v, k);
          const existing = result.get(k2);
          if (existing !== undefined) {
            const v3 = call_function(loc_id, source_map,onConflict, existing, v2, k2);
            result.set(k2, v3);
          } else {
            result.set(k2, v2);
          }
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFlattenToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, fn: (key: any, value: any) => any[]) => {
    const ret = [];
    lockForIteration(d);
    try {
      for (const [k, v] of d.entries()) {
        const subarray = call_function(loc_id, source_map,fn, v, k);
        for (const item of subarray) {
          ret.push(item);
        }
      }
      return ret;
    } finally {
      unlockForIteration(d);
    }
  },
  DictFlattenToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: Map<any, any>, fn: (key: any, value: any) => any[]) => {
      const result = new SortedSet([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d.entries()) {
          const subset = call_function(loc_id, source_map,fn, v, k);
          for (const k2 of subset) {
            result.add(k2);
          }
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFlattenToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: Map<any, any>, fn: (key: any, value: any) => any[], onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d.entries()) {
          const subdict = call_function(loc_id, source_map,fn, v, k);
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
        unlockForIteration(d);
      }
    }
  },
  DictGroupFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: Map<any, any>, keyFn: (v: any, k: any) => any, init: (k2: any) => any, folder: (acc: any, v: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d.entries()) {
          const k2 = call_function(loc_id, source_map,keyFn, v, k);
          let existing = result.get(k2);
          if (existing === undefined) {
            existing = call_function(loc_id, source_map,init, k2);
          }
          const new_val = call_function(loc_id, source_map,folder, existing, v, k);
          result.set(k2, new_val);
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
} satisfies BuiltinEvaluators;
