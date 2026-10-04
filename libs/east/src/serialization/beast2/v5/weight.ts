/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Decoded weight (#1129): what a pager's cache counts a segment by — a number
 * defined on the values, the same in every runtime for the same segment
 * (v5/SPEC.md, "The pager's cache").
 *
 * The constants are east-c's layout on a 64-bit build, the node each value
 * takes from its value slab and what it allocates beside it, so in east-c the
 * weight is the memory a segment holds. Here it is an estimate, not V8's
 * memory: what it buys is that a program's lazily read inputs keep the same
 * segments in every runtime.
 *
 * east-c counts the weight as it decodes. Here a walk of the decoded segment
 * computes it, meeting the values in the order the decode built them, so a
 * container the decode met again through a REF — one object here — counts
 * where it was first met, and one first met inside a function, in its
 * captures, counts nowhere, as east-c's count leaves it.
 */

import { type EastTypeValue } from "../../../type_of_type.js";
import { EAST_CAPTURES_SYMBOL, EAST_IR_SYMBOL, type RuntimeContext } from "../../../compile.js";
import { InternalError } from "../../../error.js";
import type { AsyncFunctionIR, FunctionIR } from "../../../ir.js";

/** Boolean, Integer, Float and DateTime. */
const WEIGHT_SCALAR = 16;
/** A String, whose node holds up to {@link WEIGHT_STRING_INLINE} bytes. */
const WEIGHT_STRING = 72;
/** The UTF-8 bytes a String's node holds; a longer one allocates them, and a
 *  terminator, beside it. */
const WEIGHT_STRING_INLINE = 47;
/** A Blob, beside its bytes. */
const WEIGHT_BLOB = 24;
/** An Array, Set, Dict, Struct, Variant with a payload, or Ref. */
const WEIGHT_NODE = 104;
/** A Vector, beside its elements. */
const WEIGHT_VECTOR = 40;
/** A Matrix, beside its elements. */
const WEIGHT_MATRIX = 48;
/** A Function, whatever its IR and captures hold. */
const WEIGHT_FUNCTION = 360;
/** The elements a Set or Dict keeps in arrays alone; past this, in a tree. */
const WEIGHT_SMALL_MAX = 256;

/** Weighs one decoded value, adding each container it meets first to `seen`. */
type Weigher = (value: any, seen: Set<object>) => number;

/** A String's UTF-8 length, from its code units: a decoded String is well
 *  formed, its surrogates in pairs, and a lone one would encode as U+FFFD. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** A String's weight. A code unit is at most 3 bytes of UTF-8, so a String of
 *  15 units or fewer fits its node and is not measured. */
function stringWeight(text: string): number {
  if (text.length <= 15) return WEIGHT_STRING;
  const bytes = utf8Length(text);
  return bytes > WEIGHT_STRING_INLINE ? WEIGHT_STRING + bytes + 1 : WEIGHT_STRING;
}

/**
 * Builds the weigher of a type: a closure tree over the type, as the decoder's
 * is, so a walk dispatches on no type at run time.
 *
 * @param type - the type
 * @param typeCtx - the recursive types' weighers, by wrapper id, shared across
 *   the tree as the decoder's are
 * @returns the weigher
 */
function buildWeigher(type: EastTypeValue, typeCtx: Map<bigint, Weigher>): Weigher {
  switch (type.type) {
    case "Never":
    case "Null":
      return () => 0;

    case "Boolean":
    case "Integer":
    case "Float":
    case "DateTime":
      return () => WEIGHT_SCALAR;

    case "String":
      return (value: string) => stringWeight(value);

    case "Blob":
      return (value: Uint8Array) => WEIGHT_BLOB + value.length;

    case "Array": {
      const elem = buildWeigher(type.value, typeCtx);
      return (value: unknown[], seen) => {
        if (seen.has(value)) return 0;
        seen.add(value);
        let weight = WEIGHT_NODE + 8 * value.length;
        for (const item of value) weight += elem(item, seen);
        return weight;
      };
    }

    case "Set": {
      const elem = buildWeigher(type.value, typeCtx);
      return (value: Set<unknown>, seen) => {
        if (seen.has(value)) return 0;
        seen.add(value);
        const n = value.size;
        let weight = WEIGHT_NODE + (n <= WEIGHT_SMALL_MAX ? 8 : 16) * n;
        for (const item of value) weight += elem(item, seen);
        return weight;
      };
    }

    case "Dict": {
      const key = buildWeigher(type.value.key, typeCtx);
      const val = buildWeigher(type.value.value, typeCtx);
      return (value: Map<unknown, unknown>, seen) => {
        if (seen.has(value)) return 0;
        seen.add(value);
        const n = value.size;
        let weight = WEIGHT_NODE + (n <= WEIGHT_SMALL_MAX ? 16 : 32) * n;
        for (const [k, v] of value) {
          weight += key(k, seen);
          weight += val(v, seen);
        }
        return weight;
      };
    }

    case "Ref": {
      const inner = buildWeigher(type.value, typeCtx);
      return (value: { value: unknown }, seen) => {
        if (seen.has(value)) return 0;
        seen.add(value);
        return WEIGHT_NODE + inner(value.value, seen);
      };
    }

    case "Struct": {
      const fields: [string, Weigher][] = type.value.map(({ name, type: fieldType }) => [name, buildWeigher(fieldType, typeCtx)]);
      const node = WEIGHT_NODE + 8 * fields.length;
      return (value: Record<string, unknown>, seen) => {
        let weight = node;
        for (const [name, field] of fields) weight += field(value[name], seen);
        return weight;
      };
    }

    case "Variant": {
      // A case with no payload is a value the type shares: it weighs nothing.
      const cases: Record<string, { payload: Weigher; nullary: boolean }> = {};
      for (const { name, type: caseType } of type.value) {
        cases[name] = { payload: buildWeigher(caseType, typeCtx), nullary: caseType.type === "Null" };
      }
      return (value: { type: string; value: unknown }, seen) => {
        const c = cases[value.type]!;
        const payload = c.payload(value.value, seen);
        return c.nullary ? 0 : WEIGHT_NODE + payload;
      };
    }

    case "Recursive": {
      if (type.value.type === "wrapper") {
        let inner: Weigher;
        const ret: Weigher = (value, seen) => inner(value, seen);
        typeCtx.set(type.value.value.id, ret);
        inner = buildWeigher(type.value.value.inner, typeCtx);
        return ret;
      }
      const target = typeCtx.get(type.value.value);
      if (!target) throw new InternalError("Recursive type context not found during weigher build");
      return target;
    }

    case "Vector": {
      const per = type.value.type === "Boolean" ? 1 : 8;
      return (value: { length: number }) => WEIGHT_VECTOR + per * value.length;
    }

    case "Matrix": {
      const per = type.value.type === "Boolean" ? 1 : 8;
      return (value: { rows: number; cols: number }) => WEIGHT_MATRIX + per * value.rows * value.cols;
    }

    case "Function":
    case "AsyncFunction": {
      // A function weighs a constant. Its captures are walked for the
      // containers they define, which a REF past the function may meet again
      // and which then count nowhere, as in east-c, where the function's
      // decode sets aside all it built. Its IR's containers are its own: no
      // value outside the function holds one.
      const captureWeighers = new Map<EastTypeValue, Weigher>();
      return (value: { [EAST_IR_SYMBOL]?: FunctionIR | AsyncFunctionIR; [EAST_CAPTURES_SYMBOL]?: RuntimeContext }, seen) => {
        const ir = value[EAST_IR_SYMBOL];
        const captures = value[EAST_CAPTURES_SYMBOL];
        if (ir !== undefined && captures !== undefined) {
          for (const captureVar of ir.value.captures) {
            const entry = captures[captureVar.value.name];
            if (entry === undefined) continue;
            const captureType = captureVar.value.type as EastTypeValue;
            let weigh = captureWeighers.get(captureType);
            if (weigh === undefined) {
              weigh = buildWeigher(captureType, typeCtx);
              captureWeighers.set(captureType, weigh);
            }
            weigh(entry.value, seen);
          }
        }
        return WEIGHT_FUNCTION;
      };
    }

    default:
      throw new Error(`Unknown type: ${(type as { type: string }).type}`);
  }
}

/**
 * Builds the decoded-weight function of a type: the weight v5/SPEC.md ("The
 * pager's cache") gives a value of `type`, which east-c's decoder counts as it
 * builds the value. A pager's cache weighs each segment it keeps with its
 * collection type's, the segment's container and its elements.
 *
 * @param type - the type
 * @returns a function weighing one decoded value of `type`, each call a walk
 *   of its own
 * @throws {Error} When `type` is not an East type, naming it.
 * @internal
 */
export function decodedWeightFor(type: EastTypeValue): (value: unknown) => number {
  const weigh = buildWeigher(type, new Map());
  return (value) => weigh(value, new Set());
}
