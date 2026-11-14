/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bound of a key range, as an expression writes it (#1616, D1): the
 * arguments of `range` and `prefix` on a Dict and on a Set.
 *
 * A bound is written as the whole key or, for a struct key, as its first
 * fields: `{ press: "P1" }`, `{ press: "P1", day }`. Its type is the key's
 * type cut short to the fields written, in the key's own order however the
 * object lists them, and it is passed to the builtin as a type parameter.
 * What is written is checked here, where the function is built, by the rule
 * every runtime checks an IR by (`keyBoundRefusal`), and refused in its words.
 *
 * One copy, which {@link DictExpr} and {@link SetExpr} both use.
 *
 * @packageDocumentation
 */

import type { AST } from "../ast.js";
import { keyBoundRefusal, type KeyBoundName } from "../key_bound.js";
import { get_location_id } from "../location.js";
import { NullType, OptionType, StructType, isTypeEqual, type EastType } from "../types.js";
import { valueOrExprToAstTyped } from "./ast.js";
import { Expr, TypeSymbol } from "./expr.js";
import type { SubtypeExprOrValue } from "./types.js";

/**
 * A bound of a key range, as it is written: the whole key or, for a struct
 * key, its first fields in any order — the last of them, where it is a struct
 * itself, cut short the same way — or an expression of such a struct.
 *
 * @typeParam K - The key's East type
 *
 * @remarks
 * TypeScript cannot say "the first fields", so any of a struct key's fields may
 * be left out here; a bound that is no leading part of the key is refused where
 * the function is built, naming the key's fields in order.
 */
export type KeyBound<K> =
  K extends StructType<infer Fields> ? Expr<StructType> | { [F in keyof Fields]?: SubtypeExprOrValue<Fields[F]> | KeyBound<Fields[F]> } :
  SubtypeExprOrValue<K>;

/**
 * A prefix of a key, as it is written: the first fields of a struct key. A key
 * that is not a struct has no prefix.
 *
 * @typeParam K - The key's East type
 */
export type KeyPrefix<K> = K extends StructType ? KeyBound<K> : never;

/** The two bounds of a key range, either left out for that end of the collection. */
export interface KeyRangeBounds<K> {
  /** The range's first key is the first at or past this bound; left out, the collection's first key. */
  from?: KeyBound<K>;
  /** The range stops before the first key at or past this bound; left out, it runs to the collection's last. */
  to?: KeyBound<K>;
}

/** Whether a value is an object literal: what a struct is written as. */
function isObjectLiteral(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * The type of a bound as it is written: an expression's own type; for an
 * object literal over a struct key, the key's type cut short to the fields it
 * gives; for anything else, the key's type.
 *
 * @param keyType - The key's type
 * @param bound - The bound as written
 * @returns The bound's type, or `undefined` for an object literal whose fields are not the key's first
 */
function writtenBoundType(keyType: EastType, bound: unknown): EastType | undefined {
  if (bound instanceof Expr) return bound[TypeSymbol] as EastType;
  if (keyType.type !== "Struct" || !isObjectLiteral(bound)) return keyType;
  const keyFields = keyType.fields as Readonly<Record<string, EastType>>;
  const given = Object.keys(bound).filter((name) => bound[name] !== undefined);
  const leading = Object.keys(keyFields).slice(0, given.length);
  if (given.length === 0 || !given.every((name) => leading.includes(name))) return undefined;
  const fields: Record<string, EastType> = {};
  for (const [index, name] of leading.entries()) {
    const type = writtenBoundType(keyFields[name]!, bound[name]);
    if (type === undefined) return undefined;
    // Only the last field a bound gives may be cut short: each before it is written whole.
    if (index < leading.length - 1 && !isTypeEqual(type, keyFields[name]!)) return undefined;
    fields[name] = type;
  }
  return StructType(fields);
}

/**
 * The AST of a bound as it is written, typed as the key's type cut short.
 *
 * @param name - Which bound: a range's `from` or `to`, or a prefix
 * @param keyType - The key's type
 * @param bound - The bound as written
 * @returns The bound's AST; its `type` is the bound's type, a type parameter of the builtin
 * @throws {Error} When the bound is no leading part of the key, or a prefix is written on a key that is not a struct, in `keyBoundRefusal`'s words
 *
 * @internal
 */
export function keyBoundAst(name: KeyBoundName, keyType: EastType, bound: unknown): AST {
  const type = writtenBoundType(keyType, bound);
  const refusal = keyBoundRefusal(name, keyType, type);
  if (refusal !== undefined || type === undefined) throw new Error(refusal);
  return valueOrExprToAstTyped(bound, type);
}

/** One end of a range as the builtin takes it: an option of the bound, and the bound's type. */
interface RangeEnd {
  /** The bound's type: the key's own for an end left out. */
  readonly type: EastType;
  /** `some(bound)`, or `none` for an end left out. */
  readonly ast: AST;
}

/**
 * The two ends of a range as the range builtins take them.
 *
 * @param keyType - The key's type
 * @param bounds - The bounds as written
 * @returns Each end's option AST and its bound's type
 * @throws {Error} When a bound is no leading part of the key, in `keyBoundRefusal`'s words
 *
 * @internal
 */
export function keyRangeEnds(keyType: EastType, bounds: { readonly from?: unknown; readonly to?: unknown }): { from: RangeEnd; to: RangeEnd } {
  const end = (name: "from" | "to", bound: unknown): RangeEnd => {
    const loc_id = get_location_id();
    if (bound === undefined) {
      return {
        type: keyType,
        ast: { ast_type: "Variant", type: OptionType(keyType), case: "none", value: { ast_type: "Value", type: NullType, value: null, loc_id }, loc_id },
      };
    }
    const value = keyBoundAst(name, keyType, bound);
    return { type: value.type, ast: { ast_type: "Variant", type: OptionType(value.type), case: "some", value, loc_id } };
  };
  return { from: end("from", bounds.from), to: end("to", bounds.to) };
}
