/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { KeyTest } from "../../containers/range.js";
import type { option } from "../../containers/variant.js";
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

/** A sorted collection a range builtin cuts: a Dict's `SortedMap` or a Set's `SortedSet`, by tests of its keys. @internal */
export interface KeyRanged<C> {
  range(from?: KeyTest<unknown>, to?: KeyTest<unknown>): C;
}

/**
 * A key range builtin over a sorted collection (#1616), its bounds' types read once where the
 * function is compiled ({@link boundReader}): the entries from the first key at or past `from` up
 * to the first at or past `to`, found by a search down the tree and never by a walk — a new
 * collection, never frozen. A Dict's `range` and a Set's are this one builtin.
 *
 * @param K - The key's type
 * @param F - The `from` bound's type
 * @param T - The `to` bound's type
 * @returns The builtin: the collection, and each bound, given or not
 * @throws {EastError} When a bound's type is no leading part of the key
 *
 * @internal
 */
export function keyRange(loc_id: bigint, source_map: SourceMap | null, K: EastTypeValue, F: EastTypeValue, T: EastTypeValue): <C>(collection: KeyRanged<C>, fromBound: option<unknown>, toBound: option<unknown>) => C {
  const from = boundReader(loc_id, source_map, "from", K, F);
  const to = boundReader(loc_id, source_map, "to", K, T);
  return (collection, fromBound, toBound) => collection.range(
    fromBound.type === "some" ? from.atOrPast(fromBound.value) : undefined,
    toBound.type === "some" ? to.atOrPast(toBound.value) : undefined,
  );
}

/**
 * A key prefix builtin over a sorted collection (#1616): the entries whose key equals the prefix
 * on every field it gives — from the first key at it up to the first past it. A Dict's `prefix`
 * and a Set's are this one builtin.
 *
 * @param K - The key's type
 * @param P - The prefix's type
 * @returns The builtin: the collection, and the prefix
 * @throws {EastError} When the prefix's type is no leading part of the key
 *
 * @internal
 */
export function keyPrefix(loc_id: bigint, source_map: SourceMap | null, K: EastTypeValue, P: EastTypeValue): <C>(collection: KeyRanged<C>, bound: unknown) => C {
  const prefix = boundReader(loc_id, source_map, "prefix", K, P);
  return (collection, bound) => collection.range(prefix.atOrPast(bound), prefix.past(bound));
}
