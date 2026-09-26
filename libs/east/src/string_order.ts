/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { defaultComparator } from "sorted-btree";

/** A code unit at or above U+D800: a surrogate, or a character in U+E000–U+FFFF. */
const HIGH_CODE_UNIT = /[\uD800-￿]/;

/**
 * Orders two strings by code point, which is the order of their UTF-8 bytes
 * and the order east-c and east-py compare them in.
 *
 * @param x - a string
 * @param y - another string
 * @returns -1, 0 or 1 as `x` sorts before, with or after `y`
 *
 * @remarks
 * JavaScript's `<` orders UTF-16 code units. That agrees with code points
 * unless the strings first differ at a surrogate in one and a code unit in
 * U+E000–U+FFFF in the other: the surrogate belongs to a character above
 * U+FFFF, which sorts after both. Only two strings that each hold a code unit
 * at or above U+D800 can differ that way, so every other pair keeps `<`.
 *
 * @internal
 */
export function compareStrings(x: string, y: string): 1 | 0 | -1 {
  if (!HIGH_CODE_UNIT.test(x) || !HIGH_CODE_UNIT.test(y)) return x < y ? -1 : (x > y ? 1 : 0);
  const length = x.length < y.length ? x.length : y.length;
  for (let i = 0; i < length; i++) {
    let a = x.charCodeAt(i);
    let b = y.charCodeAt(i);
    if (a !== b) {
      // Rotate U+D800–U+FFFF so surrogates sort above U+E000–U+FFFF.
      if (a >= 0xD800 && b >= 0xD800) {
        a = a >= 0xE000 ? a - 0x800 : a + 0x2000;
        b = b >= 0xE000 ? b - 0x800 : b + 0x2000;
      }
      return a < b ? -1 : 1;
    }
  }
  return x.length < y.length ? -1 : (x.length > y.length ? 1 : 0);
}

/**
 * The key order of a `SortedMap` or `SortedSet` built without a comparison
 * function: sorted-btree's default order, except that two strings order by
 * code point, as East orders them.
 *
 * @param a - a key
 * @param b - another key
 * @returns a negative number, zero or a positive number as `a` sorts before,
 *   with or after `b`
 *
 * @remarks
 * The beast2 encoder writes a `SortedMap` or `SortedSet` in its own order, so
 * a String-keyed one built without `compareFor` must already hold East's order.
 *
 * @internal
 */
export function defaultKeyCompare(a: unknown, b: unknown): number {
  return typeof a === "string" && typeof b === "string"
    ? compareStrings(a, b)
    : defaultComparator(a as Parameters<typeof defaultComparator>[0], b as Parameters<typeof defaultComparator>[1]);
}
