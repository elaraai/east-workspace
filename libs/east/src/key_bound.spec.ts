/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bound of a key range (#1616, D2): a key's leaves in its sort order, the
 * types that are a key's type cut short, the words a bound of any other type
 * is refused in, and the test "at or past the bound" — false, then true, over
 * the keys in order, for the orders that are easy to get wrong: floats with
 * NaN, both zeros and both infinities, options, variants and nested structs.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { compareFor } from "./comparison.js";
import { none, some, variant } from "./containers/variant.js";
import { randomStream } from "./fuzz.js";
import { compareKeyToBoundFor, isKeyBoundType, keyAtOrPast, keyBoundRefusal, keyBoundValues, keyLeafAt, keyLeaves } from "./key_bound.js";
import { toEastTypeValue } from "./type_of_type.js";
import {
  ArrayType, DateTimeType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, type ValueTypeOf,
} from "./types.js";

/** Sheets printed, keyed by press, day and job. */
const Sheets = StructType({ press: StringType, day: DateTimeType, job: StringType });

/** An index's key: the index key, its parts a struct of their own, then the row's key. */
const Level = VariantType({ day: NullType, week: NullType });
const Indexed = StructType({
  ik: StructType({ on: StructType({ hall: StringType, press: StringType }), key: StringType, level: Level, tile: IntegerType }),
  k: StringType,
});

/** The paths of a key's leaves, as text. */
const paths = (type: Parameters<typeof keyLeaves>[0]) => keyLeaves(type).map((leaf) => leaf.path.join("."));

describe("a key's leaves (#1616)", () => {
  test("a key that is not a struct is one leaf, with no path, whatever it holds", () => {
    for (const type of [StringType, IntegerType, OptionType(StringType), Level, ArrayType(StringType)]) {
      const leaves = keyLeaves(type);
      assert.deepEqual(leaves.map((leaf) => leaf.path), [[]]);
      assert.equal(leaves[0]!.type.type, toEastTypeValue(type).type);
    }
  });

  test("a struct key's fields in declaration order, through nested structs, are its leaves", () => {
    assert.deepEqual(paths(Sheets), ["press", "day", "job"]);
    assert.deepEqual(paths(Indexed), ["ik.on.hall", "ik.on.press", "ik.key", "ik.level", "ik.tile", "k"]);
    // A field that holds a struct inside something else is one leaf: only a struct field is walked into.
    assert.deepEqual(paths(StructType({ at: OptionType(StructType({ x: IntegerType })), id: StringType })), ["at", "id"]);
    assert.deepEqual(keyLeaves(Indexed).map((leaf) => leaf.type.type), ["String", "String", "String", "Variant", "Integer", "String"]);
  });

  test("a type and its type value give the same leaves, and a leaf is read by its path", () => {
    assert.deepEqual(paths(toEastTypeValue(Indexed)), paths(Indexed));
    const key: ValueTypeOf<typeof Indexed> = { ik: { on: { hall: "H1", press: "P3" }, key: "j", level: variant("week", null), tile: 4n }, k: "row" };
    assert.deepEqual(keyLeaves(Indexed).map((leaf) => keyLeafAt(key, leaf.path)), ["H1", "P3", "j", variant("week", null), 4n, "row"]);
  });
});

describe("a bound's type is the key's type cut short (#1616)", () => {
  test("the whole key, its first fields in order, and its last field given cut short the same way", () => {
    assert.ok(isKeyBoundType(Sheets, Sheets));
    assert.ok(isKeyBoundType(Sheets, StructType({ press: StringType })));
    assert.ok(isKeyBoundType(Sheets, StructType({ press: StringType, day: DateTimeType })));
    assert.ok(isKeyBoundType(Indexed, StructType({ ik: StructType({ on: StructType({ hall: StringType }) }) })));
    assert.ok(isKeyBoundType(Indexed, StructType({ ik: StructType({ on: StructType({ hall: StringType, press: StringType }), key: StringType }) })));
    assert.ok(isKeyBoundType(Indexed, StructType({ ik: Indexed.fields.ik })));
    // A key that is not a struct is bounded by its own type.
    assert.ok(isKeyBoundType(StringType, StringType));
    assert.ok(isKeyBoundType(OptionType(IntegerType), OptionType(IntegerType)));
  });

  test("no other type: a later field alone, fields out of order, a field of another type, an earlier field cut short, no field at all, another key type", () => {
    assert.equal(isKeyBoundType(Sheets, StructType({ day: DateTimeType })), false);
    assert.equal(isKeyBoundType(Sheets, StructType({ day: DateTimeType, press: StringType })), false);
    assert.equal(isKeyBoundType(Sheets, StructType({ press: IntegerType })), false);
    assert.equal(isKeyBoundType(Sheets, StructType({ press: StringType, day: StringType })), false);
    assert.equal(isKeyBoundType(Sheets, StructType({ press: StringType, day: DateTimeType, job: StringType, more: StringType })), false);
    // Only the last field a bound gives may be cut short.
    assert.equal(isKeyBoundType(Indexed, StructType({ ik: StructType({ on: StructType({ hall: StringType }), key: StringType }) })), false);
    assert.equal(isKeyBoundType(Sheets, StructType({})), false);
    assert.equal(isKeyBoundType(StringType, IntegerType), false);
    assert.equal(isKeyBoundType(StringType, StructType({ press: StringType })), false);
  });

  test("a bound of another type is refused in one set of words, naming the key's fields in order", () => {
    assert.equal(keyBoundRefusal("from", Sheets, StructType({ press: StringType, day: DateTimeType })), undefined);
    assert.equal(keyBoundRefusal("from", Sheets, StructType({ day: DateTimeType })),
      "a range's `from` is no leading part of the key: a bound gives the key's first fields in order — press, day, job");
    assert.equal(keyBoundRefusal("to", Indexed, StructType({ k: StringType })),
      "a range's `to` is no leading part of the key: a bound gives the key's first fields in order — ik.on.hall, ik.on.press, ik.key, ik.level, ik.tile, k");
    assert.equal(keyBoundRefusal("prefix", Sheets, StructType({ job: StringType })),
      "a prefix is no leading part of the key: a bound gives the key's first fields in order — press, day, job");
    assert.equal(keyBoundRefusal("to", StringType, IntegerType), "a range's `to` is not the key's type: a bound of a String key is a String");
    assert.equal(keyBoundRefusal("from", StringType, StringType), undefined);
  });

  test("a prefix of a key that is not a struct is refused whatever its type, naming `get` and `range`", () => {
    assert.equal(keyBoundRefusal("prefix", StringType, StringType),
      "a prefix gives the first fields of a struct key, and this key is a String: read one key with `get`, or the keys between two with `range`");
    assert.equal(keyBoundRefusal("prefix", Level, Level),
      "a prefix gives the first fields of a struct key, and this key is a Variant: read one key with `get`, or the keys between two with `range`");
  });
});

describe("at or past a bound (#1616)", () => {
  /** A key whose leaves hold the orders that are easy to get wrong. */
  const Odd = StructType({
    x: FloatType,
    tag: OptionType(StringType),
    what: VariantType({ a: IntegerType, b: NullType }),
    at: StructType({ day: DateTimeType, n: IntegerType }),
  });
  type OddKey = ValueTypeOf<typeof Odd>;
  const floats = [NaN, -Infinity, Infinity, -0, 0, -1.5, 2.25, 1e300];
  const tags = [none, some(""), some("a"), some("b\u{1F600}"), some("￿")];
  const whats = [variant("a", -1n), variant("a", 7n), variant("b", null)];
  const days = [new Date(0), new Date("2026-06-01T00:00:00Z"), new Date("2026-06-01T00:00:00.001Z")];
  const random = randomStream(1616);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const key = (): OddKey => ({ x: pick(floats), tag: pick(tags), what: pick(whats), at: { day: pick(days), n: BigInt(Math.floor(random() * 3)) } }) as OddKey;
  const keys = Array.from({ length: 400 }, key).sort(compareFor(Odd));
  const leaves = keyLeaves(Odd);

  test("the key's leaves are x, tag, what, at.day and at.n", () => {
    assert.deepEqual(leaves.map((leaf) => leaf.path.join(".")), ["x", "tag", "what", "at.day", "at.n"]);
  });

  test("a bound of every length is false, then true, over the keys in order, and holds what comparing the leading leaves holds", () => {
    for (let count = 0; count <= leaves.length; count++) {
      const compares = leaves.slice(0, count).map((leaf) => compareFor(leaf.type));
      for (let trial = 0; trial < 60; trial++) {
        const values = keyBoundValues(Odd, key()).slice(0, count);
        const atOrPast = keyAtOrPast(leaves, values);
        const held = keys.map(atOrPast);
        // False, then true: never false again once it has held.
        const first = held.indexOf(true);
        assert.ok(first === -1 || held.slice(first).every((at) => at), `a bound of ${count} leaves is false, then true`);
        // The oracle: the leading leaves compared one at a time, by each leaf's own order.
        const oracle = keys.map((k) => {
          for (let i = 0; i < count; i++) {
            const order = compares[i]!(keyLeafAt(k, leaves[i]!.path), values[i]);
            if (order !== 0) return order > 0;
          }
          return true;
        });
        assert.deepEqual(held, oracle);
      }
    }
  });

  test("a key equal to a bound on every leaf the bound gives is at it; a bound of no leaf holds for every key", () => {
    const compare = compareKeyToBoundFor(leaves, 2);
    const at: OddKey = { x: -0, tag: some("a"), what: variant("b", null), at: { day: days[0]!, n: 0n } };
    assert.equal(compare(at, [-0, some("a")]), 0);
    // The zeros and NaN order as East orders them: -0 before 0, NaN after every number.
    assert.equal(compare(at, [0, some("a")]), -1);
    assert.equal(compare({ ...at, x: NaN }, [Infinity, some("a")]), 1);
    assert.equal(compare({ ...at, x: NaN }, [NaN, some("a")]), 0);
    // An option's none is before every some.
    assert.equal(compare({ ...at, tag: none }, [-0, some("")]), -1);
    assert.equal(keys.every(keyAtOrPast(leaves, [])), true);
  });

  test("a bound that is the whole key is at or past exactly the keys the key's own order puts at or after it", () => {
    const order = compareFor(Odd);
    for (let trial = 0; trial < 40; trial++) {
      const bound = key();
      const atOrPast = keyAtOrPast(leaves, keyBoundValues(Odd, bound));
      assert.deepEqual(keys.map(atOrPast), keys.map((k) => order(k, bound) >= 0));
    }
  });

  test("a bound's values are read by its own type, a cut-short struct among them", () => {
    const Cut = StructType({ x: FloatType, tag: OptionType(StringType), what: Odd.fields.what, at: StructType({ day: DateTimeType }) });
    assert.ok(isKeyBoundType(Odd, Cut));
    const bound: ValueTypeOf<typeof Cut> = { x: 2.25, tag: some("a"), what: variant("a", 7n), at: { day: days[1]! } };
    assert.deepEqual(keyBoundValues(Cut, bound), [2.25, some("a"), variant("a", 7n), days[1]]);
  });
});
