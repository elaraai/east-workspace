/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Type-value equality, apart from `type_of_type.ts` so that the beast2 type
 * table, which compares recursive wrappers with it, imports nothing that names
 * a recursive type: `type_of_type.ts` names one by a hash of its type table.
 */

import { getTypeId } from "./types.js";
import type { variant } from "./containers/variant.js";
import type { EastTypeValue } from "./type_of_type.js";

const isTypeValueEqualCache = new Map<number, Map<number, boolean>>();

/** One pair of wrappers an equality in progress has entered: a `ref` of the
 *  left id corresponds to a `ref` of the right id. */
type WrapperPair = readonly [left: bigint, right: bigint];

/**
 * Compares two EastTypeValue instances for type equality.
 *
 * @param t1 - First type value to compare
 * @param t2 - Second type value to compare
 * @returns `true` if the types are equal, `false` otherwise
 *
 * @remarks
 * This is the {@link EastTypeValue} version of {@link isTypeEqual}.
 *
 * Recursive types compare up to the naming of their wrappers:
 * `wrapper({id: a, inner: A})` equals `wrapper({id: b, inner: B})` when `A`
 * equals `B` with `ref(a)` standing for `ref(b)`. Within one scope `ref(N)`
 * equals `ref(N)` and `wrapper({id: N})`: the same recursive type seen from
 * inside and from outside its wrapper.
 *
 * Two recursive types with one id are one type, and their bodies are not
 * read: every runtime names a recursive type by a hash of its structure, so
 * one id is one type in every process, and the type checker compares types as
 * large as a UI component's at every node. An id read off the wire is the
 * writer's word for it, though. Compare types whose bytes this runtime did not
 * write, as a deploy compares a package's with the one deployed before it,
 * with {@link isTypeValueStructurallyEqual}.
 */
export function isTypeValueEqual(t1: EastTypeValue, t2: EastTypeValue): boolean {
  return typeValueEqual(t1, t2, []);
}

/** The id a `Recursive` payload names — the wrapper's own id, or a ref's. */
function recursiveId(payload: variant<"ref", bigint> | variant<"wrapper", { id: bigint; inner: any }>): bigint {
  return payload.type === "ref" ? payload.value : payload.value.id;
}

function typeValueEqual(t1: EastTypeValue, t2: EastTypeValue, env: WrapperPair[]): boolean {
  // Fast path: reference equality
  if (t1 === t2) return true;

  // Fast path: type_id equality
  const tid1 = getTypeId(t1);
  const tid2 = getTypeId(t2);
  if (tid1 !== undefined && tid1 === tid2) return true;

  // Recursive ref/wrapper equivalence: ref(N) and wrapper({id: N, inner})
  // denote the same recursive type when the ids match, or when the ids are a
  // pair of wrappers this comparison has already entered (alpha-equivalence).
  if (t1.type === "Recursive" && t2.type === "Recursive") {
    const id1 = recursiveId(t1.value);
    const id2 = recursiveId(t2.value);
    if (id1 === id2) return true;
    for (const [left, right] of env) {
      if (left === id1 && right === id2) return true;
    }
  }

  // Check cache. Stamped values carry this process's type ids, under which
  // structurally equal recursive types share one id, so their answer does not
  // depend on `env`.
  if (tid1 !== undefined && tid2 !== undefined) {
    const innerCache = isTypeValueEqualCache.get(tid1);
    if (innerCache) {
      const cached = innerCache.get(tid2);
      if (cached !== undefined) return cached;
    }
    const result = typeValueEqualImpl(t1, t2, env);
    let cache = isTypeValueEqualCache.get(tid1);
    if (!cache) { cache = new Map(); isTypeValueEqualCache.set(tid1, cache); }
    cache.set(tid2, result);
    return result;
  }

  return typeValueEqualImpl(t1, t2, env);
}

/** Structural comparison that uses typeValueEqual for children (handles ref/wrapper). */
function typeValueEqualImpl(t1: EastTypeValue, t2: EastTypeValue, env: WrapperPair[]): boolean {
  if (t1.type !== t2.type) return false;
  switch (t1.type) {
    case "Never": case "Null": case "Boolean": case "Integer":
    case "Float": case "String": case "DateTime": case "Blob":
      return true;
    case "Ref": case "Array": case "Vector": case "Matrix":
      return typeValueEqual(t1.value, (t2 as any).value, env);
    case "Set":
      return typeValueEqual(t1.value, (t2 as any).value, env);
    case "Dict":
      return typeValueEqual(t1.value.key, (t2 as any).value.key, env) &&
             typeValueEqual(t1.value.value, (t2 as any).value.value, env);
    case "Struct": {
      const f1 = t1.value as { name: string; type: EastTypeValue }[];
      const f2 = (t2 as any).value as { name: string; type: EastTypeValue }[];
      if (f1.length !== f2.length) return false;
      for (let i = 0; i < f1.length; i++) {
        if (f1[i]!.name !== f2[i]!.name) return false;
        if (!typeValueEqual(f1[i]!.type, f2[i]!.type, env)) return false;
      }
      return true;
    }
    case "Variant": {
      const c1 = t1.value as { name: string; type: EastTypeValue }[];
      const c2 = (t2 as any).value as { name: string; type: EastTypeValue }[];
      if (c1.length !== c2.length) return false;
      for (let i = 0; i < c1.length; i++) {
        if (c1[i]!.name !== c2[i]!.name) return false;
        if (!typeValueEqual(c1[i]!.type, c2[i]!.type, env)) return false;
      }
      return true;
    }
    case "Function": case "AsyncFunction": {
      const fn1 = t1.value as { inputs: EastTypeValue[]; output: EastTypeValue };
      const fn2 = (t2 as any).value as { inputs: EastTypeValue[]; output: EastTypeValue };
      if (fn1.inputs.length !== fn2.inputs.length) return false;
      for (let i = 0; i < fn1.inputs.length; i++) {
        if (!typeValueEqual(fn1.inputs[i]!, fn2.inputs[i]!, env)) return false;
      }
      return typeValueEqual(fn1.output, fn2.output, env);
    }
    case "Recursive": {
      const v1 = t1.value;
      const v2 = (t2 as any).value as typeof v1;
      // Same or paired ids were answered by typeValueEqual. Two wrappers
      // with different ids are equal when their bodies are, with each body's
      // refs standing for its own wrapper; a ref and a wrapper of different
      // ids, or two refs of different ids, are different scopes.
      if (v1.type === "wrapper" && v2.type === "wrapper") {
        env.push([v1.value.id, v2.value.id]);
        try {
          return typeValueEqual(v1.value.inner, v2.value.inner, env);
        } finally {
          env.pop();
        }
      }
      return false;
    }
    default:
      return false;
  }
}
