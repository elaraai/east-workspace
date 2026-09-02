/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Printing East type VALUES as TypeScript type-constructor source (#628).
 *
 * The IR carries every type as an `EastTypeValue` — the homoiconic value of
 * `EastTypeType` — and the printer needs the TypeScript expression that
 * rebuilds it: `ArrayType(IntegerType)`, `StructType({ a: IntegerType })`,
 * `OptionType(T)` for the exact Option shape, `RecursiveType(self => ...)`
 * for a recursive wrapper (nested wrappers name their self-references
 * `self`, `self2`, ...). A recursive `ref` resolves to the enclosing
 * wrapper's lambda parameter; a free ref (a fragment lifted out of its
 * wrapper) is an error. The python twin is `east/codegen/types.py`.
 */

import type { EastTypeValue } from "../type_of_type.js";

/** The names a printed module imports from `@elaraai/east` for type source. */
export const TYPE_IMPORTS = [
  "NullType", "NeverType", "BooleanType", "IntegerType", "FloatType", "StringType",
  "DateTimeType", "BlobType", "ArrayType", "SetType", "DictType", "StructType",
  "VariantType", "OptionType", "RefType", "VectorType", "MatrixType", "FunctionType",
  "AsyncFunctionType", "RecursiveType",
] as const;

const PRIMITIVES: Record<string, string> = {
  Null: "NullType", Never: "NeverType", Boolean: "BooleanType", Integer: "IntegerType",
  Float: "FloatType", String: "StringType", DateTime: "DateTimeType", Blob: "BlobType",
};

/** Whether `t` is the exact Option shape: `Variant{ none: Null, some: T }`. */
export function isOptionValue(t: EastTypeValue): boolean {
  if (t.type !== "Variant") return false;
  const cases = t.value as { name: string, type: EastTypeValue }[];
  return cases.length === 2 && cases[0]!.name === "none" && cases[0]!.type.type === "Null"
    && cases[1]!.name === "some";
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A struct field / variant case name as a JavaScript object key. */
export function objectKey(name: string): string {
  return IDENT.test(name) ? name : JSON.stringify(name);
}

/**
 * Prints an East type value as the TypeScript source that rebuilds it.
 *
 * @param t - The type value (the `type` field of an IR node, a type parameter)
 * @param scope - The stack of enclosing recursive wrappers as `[id, parameter name]`
 * @returns TypeScript source such as `DictType(StringType, ArrayType(IntegerType))`
 * @throws {Error} When a recursive `ref` has no enclosing wrapper in `scope`
 *
 * @example
 * ```ts
 * typeSource(toEastTypeValue(ArrayType(OptionType(IntegerType))));
 * // "ArrayType(OptionType(IntegerType))"
 * ```
 */
export function typeSource(t: EastTypeValue, scope: [bigint, string][] = []): string {
  const kind = t.type;
  const primitive = PRIMITIVES[kind];
  if (primitive !== undefined) return primitive;
  if (kind === "Array" || kind === "Set" || kind === "Ref" || kind === "Vector" || kind === "Matrix") {
    return `${kind}Type(${typeSource(t.value as EastTypeValue, scope)})`;
  }
  if (kind === "Dict") {
    const d = t.value as { key: EastTypeValue, value: EastTypeValue };
    return `DictType(${typeSource(d.key, scope)}, ${typeSource(d.value, scope)})`;
  }
  if (kind === "Struct") {
    const fields = (t.value as { name: string, type: EastTypeValue }[])
      .map(f => `${objectKey(f.name)}: ${typeSource(f.type, scope)}`);
    return `StructType({ ${fields.join(", ")} })`;
  }
  if (kind === "Variant") {
    const cases = t.value as { name: string, type: EastTypeValue }[];
    if (isOptionValue(t)) return `OptionType(${typeSource(cases[1]!.type, scope)})`;
    const parts = cases.map(c => `${objectKey(c.name)}: ${typeSource(c.type, scope)}`);
    return `VariantType({ ${parts.join(", ")} })`;
  }
  if (kind === "Function" || kind === "AsyncFunction") {
    const f = t.value as { inputs: EastTypeValue[], output: EastTypeValue };
    const inputs = f.inputs.map(i => typeSource(i, scope)).join(", ");
    return `${kind}Type([${inputs}], ${typeSource(f.output, scope)})`;
  }
  if (kind === "Recursive") {
    const payload = t.value as { type: "ref", value: bigint } | { type: "wrapper", value: { id: bigint, inner: EastTypeValue } };
    if (payload.type === "ref") {
      for (let i = scope.length - 1; i >= 0; i--) {
        if (scope[i]![0] === payload.value) return scope[i]![1];
      }
      throw new Error(`recursive ref ${payload.value} outside its wrapper`);
    }
    const name = scope.length === 0 ? "self" : `self${scope.length + 1}`;
    const inner = typeSource(payload.value.inner, [...scope, [payload.value.id, name]]);
    return `RecursiveType(${name} => ${inner})`;
  }
  throw new Error(`unknown type kind ${kind}`);
}

/**
 * A structural key for deduplicating hoisted type constants: two type values
 * that print to the same source rebuild the same type, whatever recursive
 * ids they were minted with.
 */
export function typeKey(t: EastTypeValue): string {
  return typeSource(t);
}
