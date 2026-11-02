/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East built from names and types held as values.
 *
 * East names a struct's fields, and a variant's cases, where its code is
 * written: `row.jobs`, `variant("some", x)`. Code that builds East programs
 * over types it is handed — a library generating a program for whatever record
 * its caller declares — holds those names, and the types, as values. These
 * build the same program pieces from them: a field read, a struct, a variant,
 * and the patch functions of a type. Each checks its names against the type as
 * the program is built, so a name the type does not have fails there, naming
 * the name and the type. In TypeScript each gives an expression of the type it
 * is handed, or of `EastType` where the type is known only as a value.
 *
 * A value read more than once — by {@link fields} or {@link withField} — is
 * read from the expression given each time: give a variable (a parameter, or a
 * `$.let`), not a computation.
 *
 * @packageDocumentation
 */
import { get_location_id } from "../location.js";
import { type EastType, type StructType, isTypeEqual } from "../types.js";
import { printTypeValueSummary } from "../type_diff.js";
import { PatchType } from "../patch/index.js";
import { toEastTypeValue } from "../type_of_type.js";
import { variant } from "../containers/variant.js";
import { Expr } from "./expr.js";
import type { ExprType } from "./types.js";
import type { FunctionExpr } from "./function.js";
import { builtin, from, fromAst, func, wrapRecursive } from "./block.js";

/** A type in a refusal's words: its kind, and a struct's fields or a variant's cases by name. */
function words(type: EastType): string {
  return printTypeValueSummary(toEastTypeValue(type), 1, 64);
}

/** A value read through a recursive wrapper: its node; any other value as it is. */
function opened(value: Expr): Expr {
  const type = Expr.type(value);
  if (type.type !== "Recursive") return value;
  return fromAst({ ast_type: "UnwrapRecursive", type: type.node as EastType, loc_id: get_location_id(), value: Expr.ast(value) });
}

/** A struct type, or a recursive type's struct node; refused, naming what was asked of it, for any other type. */
function structOf(asked: string, type: EastType): StructType {
  const node = type.type === "Recursive" ? type.node as EastType : type;
  if (node.type !== "Struct") throw new Error(`${asked}: ${words(type)} is not a struct`);
  return node;
}

/**
 * Reads a struct's field by a name held as a value — what `value.name` reads
 * where the name is written. A recursive value is read through to its node.
 *
 * @typeParam T - The field's type, where the caller holds it
 * @param value - A struct, or a recursive value whose node is one
 * @param name - The field
 * @param type - The field's type, where the caller holds it: checked, and the expression typed by it
 * @returns The field's expression
 * @throws {Error} When the value is not a struct, has no field of the name, or the field is not of the type given
 */
export function field<T extends EastType = EastType>(value: Expr, name: string, type?: T): ExprType<T> {
  const struct = opened(value);
  const node = structOf(`East.field '${name}'`, Expr.type(value));
  const held = (node.fields as Readonly<Record<string, EastType>>)[name];
  if (held === undefined) throw new Error(`East.field: ${words(node)} has no field '${name}'`);
  if (type !== undefined && !isTypeEqual(held, type)) {
    throw new Error(`East.field: '${name}' of ${words(node)} is ${words(held)}, not ${words(type)}`);
  }
  return fromAst({ ast_type: "GetField", type: held, loc_id: get_location_id(), field: name, struct: Expr.ast(struct) }) as ExprType<T>;
}

/**
 * A struct's fields, by names held as values: each field's expression, in the
 * order given, or in the struct's own order — to spread into a call, or into
 * {@link struct}.
 *
 * @param value - A struct, or a recursive value whose node is one: give a variable, for it is read once a field
 * @param names - The fields, in the order wanted; every field, in the struct's order, where none are given
 * @returns The fields' expressions
 * @throws {Error} When the value is not a struct, or has no field of a name given
 */
export function fields(value: Expr, names?: readonly string[]): ExprType<EastType>[] {
  const node = structOf("East.fields", Expr.type(value));
  return (names ?? Object.keys(node.fields)).map((name) => field(value, name));
}

/**
 * Builds a struct of a type held as a value from its fields, given by name or
 * in the type's order — what a struct literal builds where its names are
 * written. A recursive type's node is built, and wrapped in it.
 *
 * @typeParam T - The struct's type
 * @param type - A struct type, or a recursive type whose node is one
 * @param values - Each field's value or expression: by name, every field once; or in the type's order, one a field
 * @returns The struct's expression
 * @throws {Error} When the type is not a struct, a name is not one of its fields, a field has no value, or a value is
 *   not of its field's type
 */
export function struct<T extends EastType>(type: T, values: Readonly<Record<string, unknown>> | readonly unknown[]): ExprType<T> {
  const node = structOf("East.struct", type);
  const names = Object.keys(node.fields);
  let byName: Readonly<Record<string, unknown>>;
  if (Array.isArray(values)) {
    if (values.length !== names.length) throw new Error(`East.struct: ${words(node)} has ${names.length} fields, given ${values.length}`);
    byName = Object.fromEntries(names.map((name, at) => [name, values[at]]));
  } else {
    byName = values as Readonly<Record<string, unknown>>;
    const stranger = Object.keys(byName).find((name) => !names.includes(name));
    if (stranger !== undefined) throw new Error(`East.struct: ${words(node)} has no field '${stranger}'`);
    const missing = names.find((name) => !(name in byName));
    if (missing !== undefined) throw new Error(`East.struct: no value for the field '${missing}' of ${words(node)}`);
  }
  const built = from(byName as never, node as EastType);
  return (type.type === "Recursive" ? wrapRecursive(built as never, type as never) : built) as ExprType<T>;
}

/**
 * A struct with one field replaced, by a name held as value: the same type,
 * every other field as it is. A recursive value's node is rebuilt, and wrapped
 * again.
 *
 * @typeParam V - The struct's expression, whose type the result keeps
 * @param value - A struct, or a recursive value whose node is one: give a variable, for it is read once a field
 * @param name - The field replaced
 * @param replacement - Its new value or expression
 * @returns The struct with the field replaced: an expression of the value's own type
 * @throws {Error} When the value is not a struct, has no field of the name, or the replacement is not of its type
 */
export function withField<V extends Expr>(value: V, name: string, replacement: unknown): V {
  const type = Expr.type(value);
  const node = structOf("East.withField", type);
  if (!(name in node.fields)) throw new Error(`East.withField: ${words(node)} has no field '${name}'`);
  return struct(type, Object.fromEntries(Object.keys(node.fields).map((held) => [held, held === name ? replacement : field(value, held)]))) as unknown as V;
}

/**
 * A variant of a type held as a value, holding a value in a case by a name
 * held as a value — what `variant(name, value)` builds where the case is
 * written. A recursive type's node is built, and wrapped in it.
 *
 * @typeParam T - The variant's type
 * @param type - A variant type, or a recursive type whose node is one
 * @param name - The case
 * @param value - Its value or expression
 * @returns The variant's expression
 * @throws {Error} When the type is not a variant, has no case of the name, or the value is not of the case's type
 */
export function inCase<T extends EastType>(type: T, name: string, value: unknown): ExprType<T> {
  const node = type.type === "Recursive" ? type.node as EastType : type;
  if (node.type !== "Variant") throw new Error(`East.inCase: ${words(type)} is not a variant`);
  if (!(name in node.cases)) throw new Error(`East.inCase: ${words(node)} has no case '${name}'`);
  const built = from(variant(name, value) as never, node as EastType);
  return (type.type === "Recursive" ? wrapRecursive(built as never, type as never) : built) as ExprType<T>;
}

/**
 * The patch functions of a type held as a value ({@link patchesFor}): each an
 * East function of the type, bound and called as any other.
 *
 * @typeParam T - The type patched
 */
export interface Patches<T extends EastType = EastType> {
  /** The type's patches, `PatchType(T)`. */
  readonly patchType: EastType;
  /** `(before, after) → the patch between them` */
  readonly diff: FunctionExpr<[T, T], EastType>;
  /** `(value, patch) → the value patched`: an East runtime error when the patch was made against another value */
  readonly apply: FunctionExpr<[T, EastType], T>;
  /** `(first, second) → one patch doing both`: an East runtime error when the second does not follow the first */
  readonly compose: FunctionExpr<[EastType, EastType], EastType>;
  /** `(patch) → the patch undoing it` */
  readonly invert: FunctionExpr<[EastType], EastType>;
}

/**
 * The patch functions of a type held as a value: diff, apply, compose and
 * invert, each an East function of the type — what `East.diff`,
 * `East.applyPatch`, `East.composePatch` and `East.invertPatch` build where
 * the type is written, and the program side of `diffFor`.
 *
 * @typeParam T - The type patched
 * @param type - The type
 * @returns Its patch type and its patch functions
 */
export function patchesFor<T extends EastType>(type: T): Patches<T> {
  // From the type's runtime form: a type known only as a value has a patch TypeScript cannot compute.
  const patchType = PatchType(toEastTypeValue(type));
  // Built over the type as an East type: the functions' own signatures are the ones declared.
  const valueType: EastType = type;
  return {
    patchType,
    diff: func([valueType, valueType], patchType, (_$, before, after) =>
      builtin("Diff", [valueType, patchType], [before, after], patchType)) as unknown as FunctionExpr<[T, T], EastType>,
    apply: func([valueType, patchType], valueType, (_$, value, patch) =>
      builtin("ApplyPatch", [valueType, patchType], [value, patch], valueType)) as unknown as FunctionExpr<[T, EastType], T>,
    compose: func([patchType, patchType], patchType, (_$, first, second) =>
      builtin("ComposePatch", [valueType, patchType], [first, second], patchType)) as unknown as FunctionExpr<[EastType, EastType], EastType>,
    invert: func([patchType], patchType, (_$, patch) =>
      builtin("InvertPatch", [valueType, patchType], [patch], patchType)) as unknown as FunctionExpr<[EastType], EastType>,
  };
}
