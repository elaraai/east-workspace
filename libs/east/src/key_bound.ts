/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bound of a key range (#1616, D2): a leading part of a Dict's key or a
 * Set's element.
 *
 * A key's fields, in the key type's order and through nested structs, are its
 * **leaves**: `{ press, day, job }` has three, and an index's
 * `{ ik: { on, key }, k }` has `on`'s, then `key`, then `k`'s. A field that is
 * not a struct is one leaf, whatever it holds. Struct keys compare field by
 * field in declaration order, so the leaves in order ARE the key's sort order.
 *
 * A **bound** gives the first leaves and stops. Its type is the key's type cut
 * short: for a struct key, a struct of its first fields in order, each of the
 * key's own type but the last, which may be cut short the same way; for any
 * other key, the key's type.
 *
 * A key is **at or past** a bound when its first leaves, compared in order by
 * East's order for each, are greater than or equal to the bound's. That test
 * is false, then true, over the keys in order, so a bound names one row of a
 * sorted collection and a pair of them one run of rows.
 *
 * One copy of the rule for TypeScript: the range builtins, the API's key
 * search and east-ui's key search all read it here.
 *
 * @packageDocumentation
 */

import { compareFor } from "./comparison.js";
import { isVariant } from "./containers/variant.js";
import { toEastTypeValue, type EastTypeValue } from "./type_of_type.js";
import { isTypeValueEqual } from "./type_value_equal.js";
import type { EastType } from "./types.js";

/** One leaf of a key type: the field path that reaches it, and its type. */
export interface KeyLeaf {
  /** The field names from the key to the leaf, outermost first; empty for a key that is not a struct. */
  readonly path: readonly string[];
  /** The leaf's type. */
  readonly type: EastTypeValue;
}

/** A struct type value's fields, in declaration order. */
type Fields = readonly { readonly name: string; readonly type: EastTypeValue }[];

/** A type as a type value. */
function typeValueOf(type: EastTypeValue | EastType): EastTypeValue {
  return isVariant(type) ? type as EastTypeValue : toEastTypeValue(type as EastType);
}

/**
 * A key type's leaves, in the key's sort order: its fields in declaration
 * order, through nested structs.
 *
 * @param keyType - A Dict's key type or a Set's element type
 * @returns The leaves; one, with an empty path, for a key that is not a struct
 */
export function keyLeaves(keyType: EastTypeValue | EastType): KeyLeaf[] {
  const type = typeValueOf(keyType);
  if (type.type !== "Struct") return [{ path: [], type }];
  const out: KeyLeaf[] = [];
  for (const field of type.value as Fields) {
    for (const leaf of keyLeaves(field.type)) out.push({ path: [field.name, ...leaf.path], type: leaf.type });
  }
  return out;
}

/**
 * The value of one leaf of a key.
 *
 * @param key - The key, or a bound of it
 * @param path - The leaf's path, as {@link keyLeaves} gives it
 * @returns The value at the path
 */
export function keyLeafAt(key: unknown, path: readonly string[]): unknown {
  let value = key;
  for (const name of path) value = (value as Readonly<Record<string, unknown>>)[name];
  return value;
}

/**
 * Whether a type is a key's type cut short: the key's own type, or — for a
 * struct key — a struct of its first fields in order, each of the key's own
 * type but the last, which may be cut short the same way.
 *
 * @param keyType - The key's type
 * @param boundType - The bound's type
 * @returns Whether a value of `boundType` gives a leading part of the key
 */
export function isKeyBoundType(keyType: EastTypeValue | EastType, boundType: EastTypeValue | EastType): boolean {
  const key = typeValueOf(keyType);
  const bound = typeValueOf(boundType);
  if (isTypeValueEqual(key, bound)) return true;
  if (key.type !== "Struct" || bound.type !== "Struct") return false;
  const keyFields = key.value as Fields;
  const boundFields = bound.value as Fields;
  if (boundFields.length === 0 || boundFields.length > keyFields.length) return false;
  for (let i = 0; i < boundFields.length; i++) {
    const of = keyFields[i]!;
    const given = boundFields[i]!;
    if (given.name !== of.name) return false;
    const last = i === boundFields.length - 1;
    if (last ? !isKeyBoundType(of.type, given.type) : !isTypeValueEqual(of.type, given.type)) return false;
  }
  return true;
}

/** Which bound a refusal names: a range's `from` or `to`, or a prefix. */
export type KeyBoundName = "from" | "to" | "prefix";

/** How a refusal names a bound. */
const boundWords = (name: KeyBoundName): string => (name === "prefix" ? "a prefix" : `a range's \`${name}\``);

/** A key's leaves by name, in order: `press, day, job`. */
const leafNames = (keyType: EastTypeValue): string => keyLeaves(keyType).map((leaf) => leaf.path.join(".")).join(", ");

/**
 * Why a bound's type is refused, in the words every runtime says: `undefined`
 * for a type that is a leading part of the key.
 *
 * @remarks
 * A bound's type is a type parameter of the range builtins, so an IR can name
 * one that is no leading part of the key. It is refused wherever an IR is
 * checked — where the function is built, in `analyze`, and where east-c makes
 * the builtin — and never trusted.
 *
 * A prefix is the first fields of a struct key: on any other key it could name
 * one key only, and it is not a String's starts-with, so it is refused naming
 * the reads that say what was meant.
 *
 * @param name - Which bound: a range's `from` or `to`, or a prefix
 * @param keyType - The key's type
 * @param boundType - The bound's type; `undefined` for a bound written as fields that are not the key's first, which has no type to give
 * @returns The refusal's words, or `undefined`
 */
export function keyBoundRefusal(name: KeyBoundName, keyType: EastTypeValue | EastType, boundType: EastTypeValue | EastType | undefined): string | undefined {
  const key = typeValueOf(keyType);
  const leading = boundType !== undefined && isKeyBoundType(key, boundType);
  if (key.type !== "Struct") {
    if (name === "prefix") {
      return `a prefix gives the first fields of a struct key, and this key is a ${key.type}: read one key with \`get\`, or the keys between two with \`range\``;
    }
    return leading ? undefined : `${boundWords(name)} is not the key's type: a bound of a ${key.type} key is a ${key.type}`;
  }
  return leading ? undefined
    : `${boundWords(name)} is no leading part of the key: a bound gives the key's first fields in order — ${leafNames(key)}`;
}

/**
 * The leaves a bound gives: the values of its type's leaves, in order — as
 * many of the key's first leaves.
 *
 * @param boundType - The bound's type, a leading part of the key ({@link isKeyBoundType})
 * @param bound - The bound
 * @returns The bound's leaf values, in the key's leaf order
 */
export function keyBoundValues(boundType: EastTypeValue | EastType, bound: unknown): unknown[] {
  return keyLeaves(boundType).map((leaf) => keyLeafAt(bound, leaf.path));
}

/**
 * How a key stands to a bound: before it (-1), at it — equal on every leaf the
 * bound gives (0) — or past it (1).
 *
 * @remarks
 * Monotone over the keys in order, because it reads only the leading leaves,
 * which are the ones the order sorts by first.
 *
 * @param leaves - The key's leaves ({@link keyLeaves})
 * @param count - How many leading leaves a bound gives
 * @returns A comparison of a key with a bound's leaf values
 */
export function compareKeyToBoundFor(leaves: readonly KeyLeaf[], count: number): (key: unknown, values: readonly unknown[]) => 1 | 0 | -1 {
  const given = leaves.slice(0, count);
  const comparators = given.map((leaf) => compareFor(leaf.type) as (a: unknown, b: unknown) => 1 | 0 | -1);
  return (key, values) => {
    for (let i = 0; i < given.length; i++) {
      const order = comparators[i]!(keyLeafAt(key, given[i]!.path), values[i]);
      if (order !== 0) return order;
    }
    return 0;
  };
}

/**
 * The monotone test "is this key at or past the bound?": false, then true,
 * over the keys in order. A key equal to the bound on every leaf the bound
 * gives is at it.
 *
 * @param leaves - The key's leaves ({@link keyLeaves})
 * @param values - The bound's leaf values, as many of the key's first leaves ({@link keyBoundValues})
 * @returns The test
 */
export function keyAtOrPast(leaves: readonly KeyLeaf[], values: readonly unknown[]): (key: unknown) => boolean {
  const compare = compareKeyToBoundFor(leaves, values.length);
  return (key) => compare(key, values) >= 0;
}
