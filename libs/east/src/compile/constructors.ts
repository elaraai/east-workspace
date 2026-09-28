/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { AnalyzedIR } from "../analyze.js";
import { compareFor } from "../comparison.js";
import { compile_internal } from "./ir.js";
import { lazyReadErrorAt, type RuntimeContext } from "./runtime.js";
import { createTypedArray } from "./typed_arrays.js";
import { matrix } from "../containers/matrix.js";
import { ref } from "../containers/ref.js";
import { SortedMap } from "../containers/sortedmap.js";
import { SortedSet } from "../containers/sortedset.js";
import { variant } from "../containers/variant.js";
import type { IR, NewArrayIR, NewDictIR, NewMatrixIR, NewRefIR, NewSetIR, NewVectorIR, StructIR, VariantIR } from "../ir.js";
import type { SourceMap } from "../location.js";
import type { PlatformFunction } from "../platform.js";
import { readLazyWhole } from "../serialization/beast2/v5/lazy.js";
import type { EastTypeValue } from "../type_of_type.js";

/**
 * A constructor's compiled argument, reading whole a lazy collection value it
 * gives before the container holds it, as east-c reads a paged value that goes
 * into a container. A read that fails raises at the constructor's location.
 * An argument whose type is no collection cannot give one, and is left as it
 * is.
 */
function readWhole(arg: AnalyzedIR, compiled: (ctx: RuntimeContext) => any, loc_id: bigint, source_map: SourceMap | null): (ctx: RuntimeContext) => any {
  const kind = arg.value.type.type;
  if (kind !== "Array" && kind !== "Set" && kind !== "Dict" && kind !== "Recursive") return compiled;
  const read = (value: unknown): unknown => {
    try {
      readLazyWhole(value);
    } catch (e: unknown) {
      throw lazyReadErrorAt(e, loc_id, source_map);
    }
    return value;
  };
  return arg.value.isAsync
    ? async (ctx: RuntimeContext) => read(await compiled(ctx))
    : (ctx: RuntimeContext) => read(compiled(ctx));
}

/** Compiles the structs, variants, refs, and the collection literals. */
export function compile_constructors(ir: AnalyzedIR<StructIR | VariantIR | NewRefIR | NewArrayIR | NewSetIR | NewDictIR | NewVectorIR | NewMatrixIR>, ctx: Record<string, EastTypeValue>, platform: Record<string, (...args: any[]) => any>, asyncPlatformFns: Set<string>, platformDef: PlatformFunction[], compilingNodes: Set<IR>, source_map: SourceMap | null): (ctx: RuntimeContext) => any {
  const loc_id = ir.value.loc_id;
  if (ir.type === "Struct") {
    const fields = ir.value.fields.map(f => {
      return readWhole(f.value, compile_internal(f.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes), loc_id, source_map);
    });
    const keys = ir.value.fields.map(f => f.name);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const fs: [string, any][] = [];
        for (const [i, a] of fields.entries()) {
          fs.push([keys[i]!, await a(ctx)]);
        }
        return Object.fromEntries(fs);
      };
    } else {
      return (ctx: RuntimeContext) => Object.fromEntries(fields.map((a, i) => [keys[i]!, a(ctx)]));
    }
  } else if (ir.type === "Variant") {
    const k = ir.value.case;
    const v = readWhole(ir.value.value, compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes), loc_id, source_map);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => variant(k, await v(ctx));
    } else {
      return (ctx: RuntimeContext) => variant(k, v(ctx));
    }
  } else if (ir.type === "NewRef") {
    const value = readWhole(ir.value.value, compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes), loc_id, source_map);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => ref(await value(ctx));
    } else {
      return (ctx: RuntimeContext) => ref(value(ctx));
    }
  } else if (ir.type === "NewArray") {
    const values = ir.value.values.map(a => {
      return readWhole(a, compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes), loc_id, source_map);
    });
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        let vals: any[] = [];
        for (const a of values) {
          vals.push(await a(ctx));
        }
        return vals;
      }
    } else {
      return (ctx: RuntimeContext) => values.map(a => a(ctx));
    }
  } else if (ir.type === "NewSet") {
    const values = ir.value.values.map(a => {
      return readWhole(a, compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes), loc_id, source_map);
    });
    const keyComparer = compareFor(ir.value.type.value);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const keys: any[] = [];
        for (const a of values) {
          keys.push(await a(ctx));
        }
        return new SortedSet(keys, keyComparer);
      }
    } else {
      return (ctx: RuntimeContext) => new SortedSet(values.map(a => a(ctx)), keyComparer);
    }
  } else if (ir.type === "NewDict") {
    const values = ir.value.values.map(({key, value}) => {
      return [
        readWhole(key, compile_internal(key, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes), loc_id, source_map),
        readWhole(value, compile_internal(value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes), loc_id, source_map),
      ] as const;
    });
    const keyComparer = compareFor(ir.value.type.value.key);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const entries: [any, any][] = [];
        for (const [k, v] of values) {
          entries.push([await k(ctx), await v(ctx)]);
        }
        return new SortedMap(entries, keyComparer);
      }
    } else {
      return (ctx: RuntimeContext) => new SortedMap(values.map(([k, v]) => [k(ctx), v(ctx)]), keyComparer);
    }
  } else if (ir.type === "NewVector") {
    const elementType = ir.value.type.value; // element EastTypeValue
    const values = ir.value.values.map(a => {
      return compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes)
    });
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const vals: any[] = [];
        for (const a of values) {
          vals.push(await a(ctx));
        }
        return createTypedArray(elementType, vals);
      }
    } else {
      return (ctx: RuntimeContext) => {
        const vals = values.map(a => a(ctx));
        return createTypedArray(elementType, vals);
      }
    }
  } else if (ir.type === "NewMatrix") {
    const elementType = ir.value.type.value;
    const rows = Number(ir.value.rows);
    const cols = Number(ir.value.cols);
    const values = ir.value.values.map(a => {
      return compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes)
    });
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const vals: any[] = [];
        for (const a of values) {
          vals.push(await a(ctx));
        }
        return matrix(createTypedArray(elementType, vals), rows, cols);
      }
    } else {
      return (ctx: RuntimeContext) => {
        const vals = values.map(a => a(ctx));
        return matrix(createTypedArray(elementType, vals), rows, cols);
      }
    }
  } else {
    throw new Error(`Unhandled IR type ${(ir satisfies never as IR).type} at loc_id ${(ir as IR).value.loc_id}`); // The `satisfies never` here ensures that this branch is unreachable if all IR types are handled
  }
}
