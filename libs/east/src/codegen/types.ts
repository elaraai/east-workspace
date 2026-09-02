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
import { type Doc, bracket, flat } from "./doc.js";

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

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** A struct field / variant case name as a JavaScript object key. */
export function objectKey(name: string): string {
  return IDENT.test(name) ? name : JSON.stringify(name);
}

/**
 * An East type value as the layout document of the TypeScript source that
 * rebuilds it: a struct, variant or parameter list breaks one entry per
 * line when the line it sits on would pass the width (`codegen/doc`).
 *
 * @param t - The type value (the `type` field of an IR node, a type parameter)
 * @param scope - The stack of enclosing recursive wrappers as `[id, parameter name]`
 * @returns The document; {@link typeSource} is its one-line rendering
 * @throws {Error} When a recursive `ref` has no enclosing wrapper in `scope`
 */
export function typeDoc(t: EastTypeValue, scope: [bigint, string][] = []): Doc {
  const kind = t.type;
  const primitive = PRIMITIVES[kind];
  if (primitive !== undefined) return primitive;
  if (kind === "Array" || kind === "Set" || kind === "Ref" || kind === "Vector" || kind === "Matrix") {
    return [`${kind}Type(`, typeDoc(t.value as EastTypeValue, scope), ")"];
  }
  if (kind === "Dict") {
    const d = t.value as { key: EastTypeValue, value: EastTypeValue };
    return ["DictType(", typeDoc(d.key, scope), ", ", typeDoc(d.value, scope), ")"];
  }
  if (kind === "Struct") {
    const fields = (t.value as { name: string, type: EastTypeValue }[])
      .map((f): Doc => [objectKey(f.name), ": ", typeDoc(f.type, scope)]);
    return ["StructType(", bracket("{", fields, "}", " "), ")"];
  }
  if (kind === "Variant") {
    const cases = t.value as { name: string, type: EastTypeValue }[];
    if (isOptionValue(t)) return ["OptionType(", typeDoc(cases[1]!.type, scope), ")"];
    const parts = cases.map((c): Doc => [objectKey(c.name), ": ", typeDoc(c.type, scope)]);
    return ["VariantType(", bracket("{", parts, "}", " "), ")"];
  }
  if (kind === "Function" || kind === "AsyncFunction") {
    const f = t.value as { inputs: EastTypeValue[], output: EastTypeValue };
    const inputs = bracket("[", f.inputs.map(i => typeDoc(i, scope)), "]");
    return [`${kind}Type(`, inputs, ", ", typeDoc(f.output, scope), ")"];
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
    const body = typeDoc(payload.value.inner, [...scope, [payload.value.id, name]]);
    return [`RecursiveType(${name} => `, body, ")"];
  }
  throw new Error(`unknown type kind ${kind}`);
}

/**
 * Prints an East type value as the TypeScript source that rebuilds it, on
 * one line.
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
  return flat(typeDoc(t, scope));
}

/**
 * A structural key for deduplicating hoisted type constants: two type values
 * that print to the same source rebuild the same type, whatever recursive
 * ids they were minted with.
 */
export function typeKey(t: EastTypeValue): string {
  return typeSource(t);
}

/**
 * Adds to `into` the constructor names `typeSource(t)` spells — what a
 * printed module must import for the type. A walk over the type, case for
 * case with {@link typeSource}.
 *
 * @param t - The type value
 * @param into - The set of imported names being collected
 */
export function typeConstructors(t: EastTypeValue, into: Set<string>): void {
  const kind = t.type;
  const primitive = PRIMITIVES[kind];
  if (primitive !== undefined) {
    into.add(primitive);
    return;
  }
  if (kind === "Array" || kind === "Set" || kind === "Ref" || kind === "Vector" || kind === "Matrix") {
    into.add(`${kind}Type`);
    typeConstructors(t.value as EastTypeValue, into);
    return;
  }
  if (kind === "Dict") {
    const d = t.value as { key: EastTypeValue, value: EastTypeValue };
    into.add("DictType");
    typeConstructors(d.key, into);
    typeConstructors(d.value, into);
    return;
  }
  if (kind === "Struct") {
    into.add("StructType");
    for (const f of t.value as { name: string, type: EastTypeValue }[]) typeConstructors(f.type, into);
    return;
  }
  if (kind === "Variant") {
    const cases = t.value as { name: string, type: EastTypeValue }[];
    if (isOptionValue(t)) {
      into.add("OptionType");
      typeConstructors(cases[1]!.type, into);
      return;
    }
    into.add("VariantType");
    for (const c of cases) typeConstructors(c.type, into);
    return;
  }
  if (kind === "Function" || kind === "AsyncFunction") {
    const f = t.value as { inputs: EastTypeValue[], output: EastTypeValue };
    into.add(`${kind}Type`);
    for (const i of f.inputs) typeConstructors(i, into);
    typeConstructors(f.output, into);
    return;
  }
  if (kind === "Recursive") {
    const payload = t.value as { type: "ref", value: bigint } | { type: "wrapper", value: { id: bigint, inner: EastTypeValue } };
    if (payload.type === "wrapper") {
      into.add("RecursiveType");
      typeConstructors(payload.value.inner, into);
    }
    return;
  }
  throw new Error(`unknown type kind ${kind}`);
}
