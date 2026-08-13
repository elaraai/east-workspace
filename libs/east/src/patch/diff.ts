/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * diffFor - Compute difference between two East values.
 *
 * @module
 */

import { toEastTypeValue, type EastTypeValue } from "../type_of_type.js";
import type { EastType, ValueTypeOf } from "../types.js";
import { isVariant, variant, type variant as VariantValue } from "../containers/variant.js";
import { equalFor, isFor, compareFor } from "../comparison.js";
import { SortedMap } from "../containers/sortedmap.js";
import { SortedSet } from "../containers/sortedset.js";
import type { ref } from "../containers/ref.js";
import { type DiffContext, computeLCS } from "./types.js";

export function diffFor(type: EastTypeValue, ctx?: DiffContext): (before: any, after: any) => any;
export function diffFor<T extends EastType>(type: T): (before: ValueTypeOf<T>, after: ValueTypeOf<T>) => any;
export function diffFor(type: EastTypeValue | EastType, ctx: DiffContext = { diff: [], types: [], equal: new Map() }): (before: any, after: any) => any {
  // Convert to EastTypeValue and use a properly typed variable
  const t: EastTypeValue = isVariant(type) ? type : toEastTypeValue(type as EastType);

  if (t.type === "Never") {
    return (_before: any, _after: any) => {
      throw new Error("Cannot diff values of type Never");
    };
  } else if (
    t.type === "Null" ||
    t.type === "Boolean" ||
    t.type === "Integer" ||
    t.type === "Float" ||
    t.type === "String" ||
    t.type === "DateTime" ||
    t.type === "Blob" ||
    t.type === "Vector" ||
    t.type === "Matrix"
  ) {
    const equal = equalFor(t);
    return (before: any, after: any) => {
      if (equal(before, after)) {
        return variant("unchanged", null);
      }
      return variant("replace", { before, after });
    };
  } else if (t.type === "Array") {
    let elementEqual: (a: any, b: any) => boolean;
    let elementDiff: (a: any, b: any) => any;
    let is: (a: any, b: any) => boolean;

    const ret = (before: any[], after: any[]) => {
      if (is(before, after)) {
        return variant("unchanged", null);
      }

      const { beforeIndices, afterIndices } = computeLCS(before, after, elementEqual);

      const operations: any[] = [];
      let beforePtr = 0;
      let afterPtr = 0;
      let lcsPtr = 0;
      let deleteCount = 0;   // emitted (unpaired) deletes only
      let insertCount = 0;   // emitted (unpaired) inserts only — pairs preserve length

      while (beforePtr < before.length || afterPtr < after.length) {
        const nextBeforeLCS = lcsPtr < beforeIndices.length ? beforeIndices[lcsPtr]! : before.length;
        const nextAfterLCS = lcsPtr < afterIndices.length ? afterIndices[lcsPtr]! : after.length;

        // Collect this chunk's would-be deletes and inserts. We don't decide
        // until both lists are gathered whether each is part of a pair (→
        // emitted as a single `update`) or stands alone.
        const chunkDeletes: Array<{ beforePtr: number; value: any }> = [];
        while (beforePtr < nextBeforeLCS) {
          chunkDeletes.push({ beforePtr, value: before[beforePtr]! });
          beforePtr++;
        }
        const chunkInserts: Array<{ afterPtr: number; value: any }> = [];
        while (afterPtr < nextAfterLCS) {
          chunkInserts.push({ afterPtr, value: after[afterPtr]! });
          afterPtr++;
        }

        // Pair the i-th chunk-local delete with the i-th chunk-local insert
        // and emit a single `update` op carrying the inner diff. Length of
        // the running array is unchanged for each paired position, so
        // `deleteCount` / `insertCount` stay frozen across the pair span.
        const pairCount = Math.min(chunkDeletes.length, chunkInserts.length);
        for (let i = 0; i < pairCount; i++) {
          const del = chunkDeletes[i]!;
          const ins = chunkInserts[i]!;
          // `del.beforePtr - deleteCount + insertCount` is the position the
          // old element currently sits at in the running array; the inner
          // patch transforms it in place.
          const actualPosition = del.beforePtr - deleteCount + insertCount;
          operations.push({
            key: BigInt(actualPosition),
            offset: 0n,
            operation: variant("update", elementDiff(del.value, ins.value)),
          });
        }

        // Excess deletes — the chunk had more elements removed than added.
        for (let i = pairCount; i < chunkDeletes.length; i++) {
          const del = chunkDeletes[i]!;
          const actualPosition = del.beforePtr - deleteCount + insertCount;
          operations.push({
            key: BigInt(actualPosition),
            offset: 0n,
            operation: variant("delete", del.value),
          });
          deleteCount++;
        }

        // Excess inserts — the chunk had more elements added than removed.
        for (let i = pairCount; i < chunkInserts.length; i++) {
          const ins = chunkInserts[i]!;
          operations.push({
            key: BigInt(ins.afterPtr),
            offset: 0n,
            operation: variant("insert", ins.value),
          });
          insertCount++;
        }

        if (lcsPtr < beforeIndices.length) {
          beforePtr++;
          afterPtr++;
          lcsPtr++;
        }
      }

      if (operations.length === 0) {
        return variant("unchanged", null);
      }

      return variant("patch", operations);
    };

    ctx.diff.push(ret);
    ctx.types.push(t);
    is = isFor(t, undefined, ctx.equal);
    elementEqual = equalFor(t.value as EastTypeValue, ctx.equal);
    elementDiff = diffFor(t.value as EastTypeValue, ctx);
    ctx.diff.pop();
    ctx.types.pop();

    return ret;
  } else if (t.type === "Set") {
    // Set keys cannot contain recursive types, so no context needed
    const is = isFor(t);
    const keyCompare = compareFor(t.value);

    return (before: SortedSet<any>, after: SortedSet<any>) => {
      if (is(before, after)) {
        return variant("unchanged", null);
      }

      const operations = new SortedMap<any, any>(undefined, keyCompare);

      for (const key of before) {
        if (!after.has(key)) {
          operations.set(key, variant("delete", null));
        }
      }

      for (const key of after) {
        if (!before.has(key)) {
          operations.set(key, variant("insert", null));
        }
      }

      if (operations.size === 0) {
        return variant("unchanged", null);
      }

      let deleteCount = 0;
      let insertCount = 0;
      for (const op of operations.values()) {
        if (op.type === "delete") deleteCount++;
        if (op.type === "insert") insertCount++;
      }
      if (deleteCount === before.size && insertCount === after.size && before.size > 0) {
        return variant("replace", { before, after });
      }

      return variant("patch", operations);
    };
  } else if (t.type === "Dict") {
    let valueDiff: (a: any, b: any) => any;
    let valueEqual: (a: any, b: any) => boolean;
    let is: (a: any, b: any) => boolean;
    // Dict keys cannot contain recursive types, so no context needed for keyCompare
    const keyCompare = compareFor(t.value.key);

    const ret = (before: SortedMap<any, any>, after: SortedMap<any, any>) => {
      if (is(before, after)) {
        return variant("unchanged", null);
      }

      const operations = new SortedMap<any, any>(undefined, keyCompare);

      for (const [key, beforeValue] of before) {
        if (!after.has(key)) {
          operations.set(key, variant("delete", beforeValue));
        } else {
          const afterValue = after.get(key)!;
          if (!valueEqual(beforeValue, afterValue)) {
            const patch = valueDiff(beforeValue, afterValue);
            operations.set(key, variant("update", patch));
          }
        }
      }

      for (const [key, afterValue] of after) {
        if (!before.has(key)) {
          operations.set(key, variant("insert", afterValue));
        }
      }

      if (operations.size === 0) {
        return variant("unchanged", null);
      }

      let insertCount = 0;
      let deleteCount = 0;
      for (const op of operations.values()) {
        if (op.type === "insert") insertCount++;
        if (op.type === "delete") deleteCount++;
      }
      if (insertCount === after.size && deleteCount === before.size && before.size > 0) {
        return variant("replace", { before, after });
      }

      return variant("patch", operations);
    };

    ctx.diff.push(ret);
    ctx.types.push(t);
    is = isFor(t, undefined, ctx.equal);
    valueDiff = diffFor(t.value.value, ctx);
    valueEqual = equalFor(t.value.value as EastTypeValue, ctx.equal);
    ctx.diff.pop();
    ctx.types.pop();

    return ret;
  } else if (t.type === "Struct") {
    const fieldDiffs: Record<string, (a: any, b: any) => any> = {};
    const fieldEquals: Record<string, (a: any, b: any) => boolean> = {};

    const ret = (before: Record<string, any>, after: Record<string, any>) => {
      if (before === after) {
        return variant("unchanged", null);
      }

      const patchFields: Record<string, any> = {};
      let allUnchanged = true;

      for (const { name } of t.value) {
        const beforeValue = before[name];
        const afterValue = after[name];

        if (fieldEquals[name]!(beforeValue, afterValue)) {
          patchFields[name] = variant("unchanged", null);
        } else {
          patchFields[name] = fieldDiffs[name]!(beforeValue, afterValue);
          allUnchanged = false;
        }
      }

      if (allUnchanged) {
        return variant("unchanged", null);
      }

      return variant("patch", patchFields);
    };

    ctx.diff.push(ret);
    ctx.types.push(t);
    for (const { name, type: fieldType } of t.value) {
      fieldDiffs[name] = diffFor(fieldType, ctx);
      fieldEquals[name] = equalFor(fieldType as EastTypeValue, ctx.equal);
    }
    ctx.diff.pop();
    ctx.types.pop();

    return ret;
  } else if (t.type === "Variant") {
    const caseDiffs: Record<string, (a: any, b: any) => any> = {};
    const caseEquals: Record<string, (a: any, b: any) => boolean> = {};

    const ret = (before: VariantValue, after: VariantValue) => {
      if (before === after) {
        return variant("unchanged", null);
      }

      if (before.type !== after.type) {
        return variant("replace", { before, after });
      }

      const caseName = before.type;
      if (caseEquals[caseName]!(before.value, after.value)) {
        return variant("unchanged", null);
      }

      const casePatch = caseDiffs[caseName]!(before.value, after.value);

      if (casePatch.type === "unchanged") {
        return variant("unchanged", null);
      }

      return variant("patch", variant(caseName, casePatch));
    };

    ctx.diff.push(ret);
    ctx.types.push(t);
    for (const { name, type: caseType } of t.value) {
      caseDiffs[name] = diffFor(caseType, ctx);
      caseEquals[name] = equalFor(caseType as EastTypeValue, ctx.equal);
    }
    ctx.diff.pop();
    ctx.types.pop();

    return ret;
  } else if (t.type === "Ref") {
    let innerDiff: (a: any, b: any) => any;
    let innerEqual: (a: any, b: any) => boolean;
    let is: (a: any, b: any) => boolean;

    const ret = (before: ref<any>, after: ref<any>) => {
      if (is(before, after)) {
        return variant("unchanged", null);
      }

      if (innerEqual(before.value, after.value)) {
        return variant("unchanged", null);
      }

      const innerPatch = innerDiff(before.value, after.value);

      if (innerPatch.type === "unchanged") {
        return variant("unchanged", null);
      }

      return variant("patch", innerPatch);
    };

    ctx.diff.push(ret);
    ctx.types.push(t);
    is = isFor(t, undefined, ctx.equal);
    innerDiff = diffFor(t.value, ctx);
    innerEqual = equalFor(t.value as EastTypeValue, ctx.equal);
    ctx.diff.pop();
    ctx.types.pop();

    return ret;
  } else if (t.type === "Recursive" && (t.value as any).type === "wrapper") {
    // Recursive wrapper: set up context stacks and recurse into inner type.
    // Uses replace-only semantics - no structural patching.
    let innerEqual: (a: any, b: any) => boolean;

    const ret = (before: any, after: any) => {
      if (innerEqual(before, after)) {
        return variant("unchanged", null);
      }
      return variant("replace", { before, after });
    };

    const selfEqual = equalFor(t, ctx.equal);
    ctx.equal.set((t.value as any).value.id as bigint, selfEqual);
    innerEqual = equalFor((t.value as any).value.inner as EastTypeValue, ctx.equal);

    return ret;
  } else if (t.type === "Recursive" && (t.value as any).type === "ref") {
    // Self-reference: look up by id
    const id = (t.value as any).value as bigint;
    const equal = ctx.equal.get(id);
    if (equal === undefined) {
      throw new Error(`Internal error: Recursive equal context not found in diffFor`);
    }
    return (before: any, after: any) => {
      if (equal(before, after)) {
        return variant("unchanged", null);
      }
      return variant("replace", { before, after });
    };
  } else if (t.type === "Function" || t.type === "AsyncFunction") {
    return (_before: any, _after: any) => variant("unchanged", null);
  } else {
    throw new Error(`Unhandled type in diffFor: ${(t as EastTypeValue).type}`);
  }
}
