/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Beast2 v4 mutable value table — replaces the backref protocol.
 * All distinct Array/Set/Dict/Ref instances reachable from the root value
 * go into this table, indexed in depth-first walk order. Values that contain
 * mutable containers reference them by varint index instead of inline or backref.
 */

import { toEastTypeValue, type EastTypeValue } from "../../../type_of_type.js";
import { EAST_IR_SYMBOL, EAST_CAPTURES_SYMBOL, EAST_SOURCE_MAP_SYMBOL, type RuntimeContext } from "../../../compile.js";
import type { SourceMap } from "../../../location.js";
import { IRType, type FunctionIR, type AsyncFunctionIR } from "../../../ir.js";
import type { TypeTableBuilder } from "./type-table.js";

// Kind tags matching beast2 type table tag bytes
const TAG_ARRAY = 0x0A;
const TAG_DICT  = 0x0B;
const TAG_SET   = 0x0C;
const TAG_REF   = 0x0D;

export interface ValueTableEntry {
  kind: number;           // TAG_ARRAY | TAG_SET | TAG_DICT | TAG_REF
  type: EastTypeValue;    // the mutable container's type
  value: any;             // the actual JS value
}

const irTypeValue = toEastTypeValue(IRType);

/**
 * Walk a value graph depth-first, collecting all mutable container instances
 * into a table. Identity-keyed dedup: same JS object → same table index.
 * Returns the table entries in first-encounter order.
 */
export function buildValueTable(rootValue: any, rootType: EastTypeValue, typeTableBuilder?: TypeTableBuilder): { entries: ValueTableEntry[], sourceMap: SourceMap | null } {
  const table: ValueTableEntry[] = [];
  const indexMap = new Map<any, number>();
  const recursiveCtx = new Map<bigint, EastTypeValue>(); // id → inner type
  let discoveredSourceMap: SourceMap | null = null;

  function walk(value: any, type: EastTypeValue): void {
    switch (type.type) {
      case "Array": {
        if (indexMap.has(value)) return;
        const idx = table.length;
        indexMap.set(value, idx);
        table.push({ kind: TAG_ARRAY, type, value });
        const elemType = type.value;
        for (const item of value) walk(item, elemType);
        return;
      }
      case "Set": {
        if (indexMap.has(value)) return;
        const idx = table.length;
        indexMap.set(value, idx);
        table.push({ kind: TAG_SET, type, value });
        const keyType = type.value;
        for (const key of value) walk(key, keyType);
        return;
      }
      case "Dict": {
        if (indexMap.has(value)) return;
        const idx = table.length;
        indexMap.set(value, idx);
        table.push({ kind: TAG_DICT, type, value });
        const keyType = type.value.key;
        const valType = type.value.value;
        for (const [k, v] of value) {
          walk(k, keyType);
          walk(v, valType);
        }
        return;
      }
      case "Ref": {
        if (indexMap.has(value)) return;
        const idx = table.length;
        indexMap.set(value, idx);
        table.push({ kind: TAG_REF, type, value });
        walk(value.value, type.value);
        return;
      }
      case "Struct": {
        for (const field of type.value) {
          walk(value[field.name], field.type);
        }
        return;
      }
      case "Variant": {
        const caseType = type.value.find((c: any) => c.name === value.type);
        if (caseType) walk(value.value, caseType.type);
        return;
      }
      case "Recursive": {
        if ((type.value as any).type === "wrapper") {
          const id = (type.value as any).value.id as bigint;
          const inner = (type.value as any).value.inner as EastTypeValue;
          recursiveCtx.set(id, inner);
          // Register wrapper in type table before refs encounter it
          if (typeTableBuilder && !typeTableBuilder.has(type)) typeTableBuilder.addETV(type);
          walk(value, inner);
        } else {
          // ref — look up the recursive wrapper's inner type
          const id = (type.value as any).value as bigint;
          const inner = recursiveCtx.get(id);
          if (inner) walk(value, inner);
        }
        return;
      }
      case "Function":
      case "AsyncFunction": {
        // Walk the IR body — IR-internal arrays (captures, params, args, statements)
        // are mutable containers that go in the value table like everything else.
        const ir = value[EAST_IR_SYMBOL] as FunctionIR | AsyncFunctionIR | undefined;
        if (!ir) return;
        // Discover source map from first function encountered
        if (!discoveredSourceMap) {
          discoveredSourceMap = (value as any)[EAST_SOURCE_MAP_SYMBOL] as SourceMap | undefined ?? null;
        }
        walk(ir, irTypeValue);
        // Walk capture values (user-level data)
        const captures = value[EAST_CAPTURES_SYMBOL] as RuntimeContext | undefined;
        if (!captures) return;
        for (const captureVar of ir.value.captures) {
          const name = captureVar.value.name;
          const captureType = captureVar.value.type as EastTypeValue;
          const entry = captures[name];
          if (entry !== undefined) walk(entry.value, captureType);
        }
        return;
      }
      // Primitives: Null, Boolean, Integer, Float, String, DateTime, Blob, Vector, Matrix, Never
      default:
        return;
    }
  }

  walk(rootValue, rootType);
  return { entries: table, sourceMap: discoveredSourceMap };
}

/**
 * Build an identity map from a value table (for use during encoding).
 */
export function buildIndexMap(table: ValueTableEntry[]): Map<any, number> {
  const map = new Map<any, number>();
  for (let i = 0; i < table.length; i++) {
    map.set(table[i]!.value, i);
  }
  return map;
}

/**
 * Check if an EastTypeValue represents a mutable container type.
 */
export function isMutableType(type: EastTypeValue): boolean {
  return type.type === "Array" || type.type === "Set" || type.type === "Dict" || type.type === "Ref";
}

export { TAG_ARRAY, TAG_DICT, TAG_SET, TAG_REF };
