/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * PatchType constructor for computing patch types from East types.
 *
 * @module
 */

import {
  type EastType,
  NullType,
  StructType,
  VariantType,
  ArrayType,
  DictType,
  IntegerType,
} from "../types.js";
import { type EastTypeValue, fromEastTypeValue } from "../type_of_type.js";
import { isVariant } from "../containers/variant.js";

/**
 * Construct the patch type for a given East type.
 *
 * Accepts either an `EastType` (the static type-definition object) or an
 * `EastTypeValue` (the runtime variant form, e.g. from a generic
 * platform-fn impl factory). The result is always an `EastType`, suitable
 * for passing to constructors like {@link StructType} or for round-tripping
 * via `toEastTypeValue` if a runtime form is needed.
 *
 * The patch type is a pure function of the type — every occurrence of a
 * type gets the same patch type, wherever it sits — and it is the type the
 * runtimes' patch values conform to, so it is one definition on every
 * runtime (`PatchType` in east-py's `types.py`; east-c's `patch.c` builds
 * values of exactly these shapes). A **recursive type is replace-only**:
 * its patch has `unchanged` and `replace` cases and no `patch` case, at the
 * wrapper and at every reference back to it, which is what `diffFor`,
 * `applyFor`, `composeFor`, `invertFor`, `mergeFor` and `walkPatch` implement
 * and what the type-level {@link PatchTypeOf} states. (An earlier version
 * descended into the wrapper's body on its first occurrence only, keyed by
 * object identity, so `Struct{a: Array<T>, b: T}` gave `a`'s element and `b`
 * different patch types — a type no runtime's values conformed to; #774.)
 *
 * `ctx` memoizes the result per type object across one computation.
 */
export function PatchType<T extends EastType>(type: T, ctx?: Map<EastType, EastType>): EastType;
export function PatchType(type: EastTypeValue, ctx?: Map<EastType, EastType>): EastType;
export function PatchType(type: EastType | EastTypeValue, ctx?: Map<EastType, EastType>): EastType {
  if (isVariant(type)) type = fromEastTypeValue(type as EastTypeValue);
  const context = ctx ?? new Map<EastType, EastType>();
  const cached = context.get(type);
  if (cached !== undefined) {
    return cached;
  }
  const result = patchTypeOf(type as EastType, context);
  context.set(type as EastType, result);
  return result;
}

function patchTypeOf(type: EastType, context: Map<EastType, EastType>): EastType {
  const t = type;

  if (
    t.type === "Never" ||
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
    return VariantType({
      unchanged: NullType,
      replace: StructType({ before: type, after: type }),
    });
  } else if (t.type === "Array") {
    const elementType = t.value;
    const elementPatchType = PatchType(elementType, context);
    const operationType = VariantType({
      delete: elementType,
      insert: elementType,
      update: elementPatchType,
    });
    const entryType = StructType({
      key: IntegerType,
      offset: IntegerType,
      operation: operationType,
    });
    return VariantType({
      unchanged: NullType,
      replace: StructType({ before: type, after: type }),
      patch: ArrayType(entryType),
    });
  } else if (t.type === "Set") {
    const keyType = t.key;
    const operationType = VariantType({
      delete: NullType,
      insert: NullType,
    });
    return VariantType({
      unchanged: NullType,
      replace: StructType({ before: type, after: type }),
      patch: DictType(keyType, operationType),
    });
  } else if (t.type === "Dict") {
    const keyType = t.key;
    const valueType = t.value;
    const valuePatchType = PatchType(valueType, context);
    const operationType = VariantType({
      delete: valueType,
      insert: valueType,
      update: valuePatchType,
    });
    return VariantType({
      unchanged: NullType,
      replace: StructType({ before: type, after: type }),
      patch: DictType(keyType, operationType),
    });
  } else if (t.type === "Struct") {
    const fieldTypes = t.fields;
    const patchFields: Record<string, EastType> = {};
    for (const [name, fieldType] of Object.entries(fieldTypes)) {
      patchFields[name] = PatchType(fieldType, context);
    }
    return VariantType({
      unchanged: NullType,
      replace: StructType({ before: type, after: type }),
      patch: StructType(patchFields),
    });
  } else if (t.type === "Variant") {
    const caseTypes = t.cases;
    const patchCases: Record<string, EastType> = {};
    for (const [name, caseType] of Object.entries(caseTypes)) {
      patchCases[name] = PatchType(caseType, context);
    }
    return VariantType({
      unchanged: NullType,
      replace: StructType({ before: type, after: type }),
      patch: VariantType(patchCases),
    });
  } else if (t.type === "Ref") {
    const innerType = t.value;
    const innerPatchType = PatchType(innerType, context);
    return VariantType({
      unchanged: NullType,
      replace: StructType({ before: type, after: type }),
      patch: innerPatchType,
    });
  } else if (t.type === "Recursive") {
    // Replace-only, at the wrapper and at every reference back to it: the
    // whole recursive value is the unit of change (see the module comment).
    return VariantType({
      unchanged: NullType,
      replace: StructType({ before: type, after: type }),
    });
  } else if (t.type === "Function" || t.type === "AsyncFunction") {
    return VariantType({
      unchanged: NullType,
      replace: StructType({ before: type, after: type }),
    });
  } else {
    throw new Error(`Unhandled type in PatchType: ${(t as EastType).type}`);
  }
}
