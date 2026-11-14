/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { KeyTest } from "../../containers/range.js";
import { EastError } from "../../error.js";
import { compareKeyToBoundFor, keyBoundRefusal, keyLeafAt, keyLeaves, type KeyBoundName } from "../../key_bound.js";
import type { Location, SourceMap } from "../../location.js";
import type { EastTypeValue } from "../../type_of_type.js";

/**
 * What a range builtin makes of one bound type, once, where the function is compiled: the tests
 * of a key a bound's value gives.
 *
 * @remarks
 * A bound's type is a type parameter of the builtin, so an IR can name one that is no leading
 * part of the key. It is refused here as `analyze` refuses it, in the same words, before the
 * builtin can run.
 *
 * @param name - Which bound: a range's `from` or `to`, or a prefix
 * @param K - The key's type
 * @param B - The bound's type
 * @returns `atOrPast(bound)`, the test "is this key at or past the bound?", and `past(bound)`, "is it past it?" — each false, then true, over the keys in order
 * @throws {EastError} When the bound's type is no leading part of the key
 *
 * @internal
 */
export function boundReader(loc_id: bigint, source_map: SourceMap | null, name: KeyBoundName, K: EastTypeValue, B: EastTypeValue): { atOrPast: (bound: unknown) => KeyTest<unknown>; past: (bound: unknown) => KeyTest<unknown> } {
  const refusal = keyBoundRefusal(name, K, B);
  if (refusal !== undefined) {
    throw new EastError(refusal, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
  }
  // The bound's leaves are as many of the key's first: read once here, compared by each leaf's own order.
  const paths = keyLeaves(B).map((leaf) => leaf.path);
  const leaves = keyLeaves(K);
  const compare = compareKeyToBoundFor(leaves, paths.length);
  const values = (bound: unknown): unknown[] => paths.map((path) => keyLeafAt(bound, path));
  // A bound that gives every leaf is a whole key: its test says which key it is, so a pager
  // places it at a segment's first key without reading the segment before.
  const whole = paths.length === leaves.length;
  return {
    atOrPast: (bound) => {
      const given = values(bound);
      const test = (key: unknown): boolean => compare(key, given) >= 0;
      return whole ? Object.assign(test, { isBound: (key: unknown): boolean => compare(key, given) === 0 }) : test;
    },
    past: (bound) => {
      const given = values(bound);
      return (key) => compare(key, given) > 0;
    },
  };
}
