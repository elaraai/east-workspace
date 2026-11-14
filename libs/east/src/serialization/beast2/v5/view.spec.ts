/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A key range of a lazily opened Set or Dict is a view its pager serves
 * (#1616, D4 and D5).
 *
 * What a range read costs is asserted in segments decoded on the input's
 * pager — a count, never a clock — and is the table east-c's gates pin
 * (`test_paged_range`, `test_paged_range_body`), so the two runtimes decode the
 * same segments for the same reads:
 *
 * 1. making a range reads nothing; its size places its two ends, by the
 *    fences and the one segment that can hold each, and reads none between;
 * 2. a loop reads the range's segments, each once: its first and last through
 *    the cache, the ones between them fresh, to the fields the body reads;
 * 3. a keyed read tests the key against the bounds, which reads nothing, and
 *    inside them is the input's keyed read;
 * 4. a range of a range is placed among the rows of the range it narrows;
 * 5. any other read decodes the range's own rows into a collection that is
 *    not frozen, and leaves the input lazy; a range holds what its source held
 *    when it was taken;
 * 6. exactness, over bounds made from a seed: whole keys, leading parts of a
 *    struct key, prefixes and ranges of ranges, against a walk of the whole;
 * 7. a range whose ends cannot be placed refuses in a keyed read's words.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, BooleanType, DictType, IntegerType, SetType, StringType, StructType, type EastType } from "../../../types.js";
import { toEastTypeValue } from "../../../type_of_type.js";
import { compareFor } from "../../../comparison.js";
import { LazyReadError } from "../../../error.js";
import { isFrozenValue } from "../../../frozen.js";
import { East, SortedMap, SortedSet } from "../../../index.js";
import type { KeyTest } from "../../../containers/range.js";
import { boundReader } from "../../../compile/builtins/key_range.js";
import { beast2LazyStats, encodeBeast2SegmentsFor, openBeast2LazyFor, openBeast2PagesFor, spliceBeast2 } from "../index.js";
import { beast2PagedLoopStats } from "./project.js";

const PER_SEGMENT = 8;
const SEGMENTS = 12;
const ROWS = PER_SEGMENT * SEGMENTS;

/** A collection in canonical order as a blob of segments of `PER_SEGMENT`. */
function paged(type: EastType, value: Iterable<unknown>): Uint8Array {
  const items = [...value];
  const batches: unknown[] = [];
  for (let i = 0; i < items.length; i += PER_SEGMENT) {
    const chunk = items.slice(i, i + PER_SEGMENT);
    batches.push(type.type === "Dict" ? new Map(chunk as [unknown, unknown][]) : new Set(chunk));
  }
  return encodeBeast2SegmentsFor(type)(batches as never);
}

// Row r is 3r -> 10r, so a bound can fall between keys. Segment s holds rows
// 8s to 8s + 7, and its first key is 24s.
const Counts = DictType(IntegerType, IntegerType);
const counts = new SortedMap<bigint, bigint>(
  Array.from({ length: ROWS }, (_, i) => [BigInt(3 * i), BigInt(10 * i)] as [bigint, bigint]), compareFor(IntegerType));
const countsBlob = paged(Counts, counts);

const openCounts = (frozen = true, cacheBytes?: number): SortedMap<bigint, bigint> =>
  openBeast2LazyFor(Counts, cacheBytes === undefined ? { frozen } : { frozen, cacheBytes })(countsBlob) as SortedMap<bigint, bigint>;

/** Segments a lazy value's pager has decoded so far. */
const decoded = (lazy: unknown): number => beast2LazyStats(lazy)!.segmentsDecoded;

/** The tests the range builtins make of an Integer bound. */
const integer = toEastTypeValue(IntegerType);
const atOrPast = (bound: bigint): KeyTest<bigint> => boundReader(0n, null, "from", integer, integer).atOrPast(bound) as KeyTest<bigint>;

/** Which ends a compiled range gives: both, one, or neither. */
type Ends = "both" | "from" | "to" | "none";

/** `(d, a, b) => d.range(...)`'s size, with the ends `ends` names. */
function sizeOf(ends: Ends): (d: unknown, a: bigint, b: bigint) => bigint {
  return East.function([Counts, IntegerType, IntegerType], IntegerType, (_$, d, a, b) =>
    d.range(ends === "both" ? { from: a, to: b } : ends === "from" ? { from: a } : ends === "to" ? { to: b } : {}).size(),
  ).toIR().compile([]) as (d: unknown, a: bigint, b: bigint) => bigint;
}

/** `(d, a, b) =>` the sum of the values a loop over `d.range(...)` reads. */
function sumOf(ends: Ends): (d: unknown, a: bigint, b: bigint) => bigint {
  return East.function([Counts, IntegerType, IntegerType], IntegerType, ($, d, a, b) => {
    const sum = $.let(0n);
    $.for(d.range(ends === "both" ? { from: a, to: b } : ends === "from" ? { from: a } : ends === "to" ? { to: b } : {}), ($, value) => {
      $.assign(sum, sum.add(value));
    });
    $.return(sum);
  }).toIR().compile([]) as (d: unknown, a: bigint, b: bigint) => bigint;
}

describe("Beast2 v5 — a range of a lazily opened collection: what a read costs", () => {
  const sizes = { both: sizeOf("both"), from: sizeOf("from"), to: sizeOf("to"), none: sizeOf("none") };
  const sums = { both: sumOf("both"), from: sumOf("from"), to: sumOf("to"), none: sumOf("none") };
  const sumRows = (lo: number, rows: number): bigint => {
    let sum = 0n;
    for (let r = lo; r < lo + rows; r++) sum += BigInt(10 * r);
    return sum;
  };

  // [from, to] (-1 leaves that end out), the range's first row and its rows,
  // segments decoded once its size is asked, and once it is looped over.
  const cases: [number, number, number, number, number, number, string][] = [
    [30, 39, 10, 3, 1, 1, "inside one segment"],
    [30, 60, 10, 10, 2, 2, "across two segments"],
    [30, 108, 10, 26, 2, 4, "across four segments: the two between read fresh"],
    [24, 48, 8, 8, 0, 1, "from one segment's first key to the next's, as whole keys"],
    [-1, 15, 0, 5, 1, 1, "no `from`: the start of the collection"],
    [-1, -1, 0, ROWS, 0, SEGMENTS, "both ends open: every row"],
    [0, 15, 0, 5, 1, 1, "`from` the first key"],
    [31, 31, 0, 0, 1, 1, "an empty range between two keys"],
    [60, 30, 0, 0, 2, 2, "an inverted range"],
    [3000, -1, 0, 0, 1, 1, "`from` past the last key: the last segment is read"],
    [270, -1, 90, 6, 1, 1, "to the end of the collection"],
  ];
  for (const [from, to, lo, rows, afterSize, afterLoop, what] of cases) {
    test(what, () => {
      const ends: Ends = from >= 0 ? (to >= 0 ? "both" : "from") : to >= 0 ? "to" : "none";
      const lazy = openCounts();
      assert.equal(sizes[ends](lazy, BigInt(from), BigInt(to)), BigInt(rows));
      assert.equal(decoded(lazy), afterSize, "segments decoded for its size");
      assert.equal(sums[ends](lazy, BigInt(from), BigInt(to)), sumRows(lo, rows));
      assert.equal(decoded(lazy), afterLoop, "segments decoded once it is looped over");
      assert.equal(beast2LazyStats(lazy)!.hydrated, false, "the input is never read whole");
    });
  }

  test("a second loop decodes the segments between the ends alone", () => {
    const lazy = openCounts();
    assert.equal(sums.both(lazy, 30n, 108n), sumRows(10, 26));
    assert.equal(decoded(lazy), 4);
    assert.equal(sums.both(lazy, 30n, 108n), sumRows(10, 26));
    assert.equal(decoded(lazy), 6);
  });

  test("an empty collection, and one of a single segment", () => {
    const empty = openBeast2LazyFor(Counts, { frozen: true })(paged(Counts, []));
    assert.equal(sizes.both(empty, 3n, 30n), 0n);
    assert.equal(decoded(empty), 0);
    const few = openBeast2LazyFor(Counts, { frozen: true })(paged(Counts, [...counts].slice(0, 5)));
    assert.equal(sizes.both(few, 4n, 13n), 3n);
    assert.equal(decoded(few), 1);
  });
});

describe("Beast2 v5 — a range of a lazily opened collection: the view's rule", () => {
  test("a keyed read tests the bounds first", () => {
    const lazy = openCounts();
    const view = lazy.range(atOrPast(30n), atOrPast(60n));
    assert.equal(decoded(lazy), 0, "making a range reads nothing");
    assert.equal(view.has(3n), false);
    assert.equal(decoded(lazy), 0, "a key outside the bounds is absent, and nothing is read to say so");
    assert.equal(view.has(33n), true);
    assert.equal(decoded(lazy), 1, "a key inside the bounds is the input's keyed read");
    assert.equal(view.get(33n), 110n);
    assert.equal(view.has(34n), false, "a key inside the bounds that the input does not hold");
    assert.equal(decoded(lazy), 1);
  });

  test("a range of a range is placed among the rows of the range it narrows", () => {
    const lazy = openCounts();
    const view = lazy.range(atOrPast(30n), atOrPast(60n));
    assert.equal(view.has(33n), true);
    const before = decoded(lazy);
    const narrower = view.range(atOrPast(36n), atOrPast(600n));
    assert.equal(decoded(lazy), before, "a range of a range reads nothing to be made");
    assert.equal(narrower.size, 8);
    // Its size placed the range it narrows — whose last segment was not yet
    // read — and then itself among that range's rows: a `to` past every key
    // of the collection reads no segment past the range.
    assert.equal(decoded(lazy), before + 1);
    assert.equal(narrower.has(33n), false);
    assert.equal(view.range(atOrPast(0n), atOrPast(600n)).size, 10, "a range of a range is never wider than the range");
    assert.deepEqual([...narrower.keys()], [36n, 39n, 42n, 45n, 48n, 51n, 54n, 57n]);
  });

  test("its ends, and a walk from a key", () => {
    const view = openCounts().range(atOrPast(30n), atOrPast(60n));
    assert.equal(view.minKey(), 30n);
    assert.equal(view.maxKey(), 57n);
    assert.deepEqual([...view.keys(40n)], [42n, 45n, 48n, 51n, 54n, 57n]);
    assert.deepEqual([...view.entries()].length, 10);
    const none = openCounts().range(atOrPast(31n), atOrPast(31n));
    assert.equal(none.minKey(), undefined);
    assert.equal(none.maxKey(), undefined);
    assert.deepEqual([...none.keys(0n)], []);
  });

  test("a range is a new collection: changed, it decodes its own rows and leaves the input lazy", () => {
    const lazy = openCounts();
    const view = lazy.range(atOrPast(30n), atOrPast(60n));
    const other = lazy.range(atOrPast(30n), atOrPast(60n));
    assert.ok(isFrozenValue(lazy), "the input is frozen");
    assert.ok(!isFrozenValue(view), "a range of a frozen input is not frozen");
    view.set(31n, 0n);
    assert.equal(view.size, 11);
    assert.equal(decoded(lazy), 2, "the range's own rows, and no others");
    assert.equal(other.size, 10, "no other range of the input sees the change");
    assert.equal(other.has(31n), false);
    assert.equal(beast2LazyStats(lazy)!.hydrated, false, "the input stays lazy");
    assert.equal(lazy.size, ROWS);
    assert.throws(() => lazy.set(31n, 0n), /Cannot modify frozen SortedMap/);
    // Once it holds its rows, a range of it is a collection held in memory.
    const held = view.range(atOrPast(30n), atOrPast(39n));
    assert.equal(beast2LazyStats(held), undefined);
    assert.deepEqual([...held.keys()], [30n, 31n, 33n, 36n]);
  });

  test("a range holds what its source held when it was taken", () => {
    const plain = openCounts(false);
    const taken = plain.range(atOrPast(30n), atOrPast(60n));
    plain.delete(33n);
    assert.equal(plain.has(33n), false, "the source is changed");
    assert.equal(plain.size, ROWS - 1);
    assert.equal(taken.size, 10);
    assert.equal(taken.has(33n), true);
    // A range of the source taken now is of what it holds now.
    assert.equal(plain.range(atOrPast(30n), atOrPast(60n)).size, 9);
  });
});

describe("Beast2 v5 — a range of a lazily opened collection, read by a body", () => {
  test("a builtin the pager does not serve decodes the range's own rows", () => {
    const keys = East.function([Counts], SetType(IntegerType), (_$, d) => d.range({ from: 30n, to: 60n }).keys())
      .toIR().compile([]) as (d: unknown) => SortedSet<bigint>;
    const lazy = openCounts();
    assert.equal(keys(lazy).size, 10);
    assert.equal(decoded(lazy), 2);
    assert.equal(beast2LazyStats(lazy)!.hydrated, false);
  });

  test("a range put in a container is read whole there, and its input left lazy", () => {
    const held = East.function([Counts], ArrayType(Counts), (_$, d) => [d.range({ from: 30n, to: 60n })])
      .toIR().compile([]) as (d: unknown) => SortedMap<bigint, bigint>[];
    const lazy = openCounts();
    const [range] = held(lazy);
    assert.equal(range!.size, 10);
    assert.equal(beast2LazyStats(range)!.hydrated, true, "the range holds its own rows");
    assert.equal(decoded(lazy), 2);
    assert.equal(beast2LazyStats(lazy)!.hydrated, false);
  });

  test("a range changed by a body is its own rows changed", () => {
    const grown = East.function([Counts], IntegerType, ($, d) => {
      const r = $.let(d.range({ from: 30n, to: 60n }));
      $(r.insert(31n, 0n));
      $.return(r.size());
    }).toIR().compile([]) as (d: unknown) => bigint;
    const lazy = openCounts();
    assert.equal(grown(lazy), 11n);
    assert.equal(lazy.size, ROWS);
    assert.equal(beast2LazyStats(lazy)!.hydrated, false);
  });

  test("a loop over a range inside a loop over another range of the same input", () => {
    const nested = East.function([Counts], IntegerType, ($, d) => {
      const sum = $.let(0n);
      $.for(d.range({ from: 30n, to: 60n }), ($) => {
        $.for(d.range({ from: 0n, to: 9n }), ($, value) => { $.assign(sum, sum.add(value)); });
      });
      $.return(sum);
    }).toIR().compile([]) as (d: unknown) => bigint;
    const lazy = openCounts();
    assert.equal(nested(lazy), 10n * (0n + 10n + 20n));
    assert.equal(decoded(lazy), 3, "the outer range's two segments, and the inner's one, held from then");
  });

  test("a loop whose segments the cache drops while it runs reads every row", () => {
    const sum = East.function([Counts], IntegerType, ($, d) => {
      const total = $.let(0n);
      $.for(d.range({ from: 30n, to: 108n }), ($, value) => { $.assign(total, total.add(value).add(d.get(285n))); });
      $.return(total);
    }).toIR().compile([]) as (d: unknown) => bigint;
    // A cache of one segment, and a body that reads a key of the last.
    assert.equal(sum(openCounts(true, 1)), 5850n + 26n * 950n);
  });

  test("a loop that reads one field projects the segments between the ends, and reads the ends whole", () => {
    const Row = StructType({ amount: IntegerType, note: StringType });
    const Rows = DictType(IntegerType, Row);
    const rows = new SortedMap<bigint, { amount: bigint; note: string }>(
      Array.from({ length: ROWS }, (_, i) => [BigInt(3 * i), { amount: BigInt(10 * i), note: "a note no loop here reads" }] as [bigint, { amount: bigint; note: string }]),
      compareFor(IntegerType));
    const blob = paged(Rows, rows);
    const ranged = East.function([Rows], IntegerType, ($, d) => {
      const sum = $.let(0n);
      $.for(d.range({ from: 30n, to: 108n }), ($, row) => { $.assign(sum, sum.add(row.amount)); });
      $.return(sum);
    }).toIR().compile([]) as (d: unknown) => bigint;
    const whole = East.function([Rows], IntegerType, ($, d) => {
      const sum = $.let(0n);
      $.for(d, ($, row) => { $.assign(sum, sum.add(row.amount)); });
      $.return(sum);
    }).toIR().compile([]) as (d: unknown) => bigint;

    let lazy = openBeast2LazyFor(Rows, { frozen: true })(blob);
    let before = beast2PagedLoopStats();
    assert.equal(ranged(lazy), 5850n);
    let after = beast2PagedLoopStats();
    assert.deepEqual([after.segmentsProjected - before.segmentsProjected, after.segmentsWhole - before.segmentsWhole], [2, 2]);
    assert.equal(decoded(lazy), 4);

    // A whole loop projects every segment, as it did.
    lazy = openBeast2LazyFor(Rows, { frozen: true })(blob);
    before = beast2PagedLoopStats();
    assert.equal(whole(lazy), BigInt(10 * (ROWS * (ROWS - 1) / 2)));
    after = beast2PagedLoopStats();
    assert.deepEqual([after.segmentsProjected - before.segmentsProjected, after.segmentsWhole - before.segmentsWhole], [SEGMENTS, 0]);
  });

  test("a Set's range, and a prefix of a struct key", () => {
    const Numbers = SetType(IntegerType);
    const numbers = new SortedSet<bigint>(Array.from({ length: ROWS }, (_, i) => BigInt(3 * i)), compareFor(IntegerType));
    const size = East.function([Numbers], IntegerType, (_$, s) => s.range({ from: 30n, to: 108n }).size())
      .toIR().compile([]) as (s: unknown) => bigint;
    const sum = East.function([Numbers], IntegerType, ($, s) => {
      const total = $.let(0n);
      $.for(s.range({ from: 30n, to: 108n }), ($, key) => { $.assign(total, total.add(key)); });
      $.return(total);
    }).toIR().compile([]) as (s: unknown) => bigint;
    const lazySet = openBeast2LazyFor(Numbers, { frozen: true })(paged(Numbers, numbers));
    assert.equal(size(lazySet), 26n);
    assert.equal(decoded(lazySet), 2);
    assert.equal(sum(lazySet), 3n * 585n);
    assert.equal(decoded(lazySet), 4);
    assert.equal(beast2LazyStats(lazySet)!.hydrated, false);

    // Sheets printed, keyed { press, job }: a segment is one press.
    const Key = StructType({ press: StringType, job: IntegerType });
    const Sheets = DictType(Key, IntegerType);
    const sheets = new SortedMap<{ press: string; job: bigint }, bigint>(
      Array.from({ length: ROWS }, (_, i) => [{ press: `P${String(Math.floor(i / PER_SEGMENT)).padStart(2, "0")}`, job: BigInt(i % PER_SEGMENT) }, BigInt(i)] as [{ press: string; job: bigint }, bigint]),
      compareFor(Key));
    const ofPress = East.function([Sheets, StringType], IntegerType, (_$, d, press) => d.prefix({ press }).size())
      .toIR().compile([]) as (d: unknown, press: string) => bigint;
    const lazySheets = openBeast2LazyFor(Sheets, { frozen: true })(paged(Sheets, sheets));
    assert.equal(ofPress(lazySheets, "P03"), BigInt(PER_SEGMENT));
    assert.equal(decoded(lazySheets), 2, "the segment before the press, and the press's own");
  });
});

describe("Beast2 v5 — a range of a lazily opened collection: exactness", () => {
  /** A deterministic stream of numbers (an LCG), so the bounds are the same on every run. */
  let state = 0x1616d4d5n;
  const draw = (below: number): number => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return Number((state >> 33n) % BigInt(below));
  };

  const Key = StructType({ press: StringType, job: IntegerType });
  const Press = StructType({ press: StringType });
  const Sheets = DictType(Key, IntegerType);
  type SheetKey = { press: string; job: bigint };
  const pressOf = (i: number): string => `P${String(i).padStart(2, "0")}`;
  const sheets = new SortedMap<SheetKey, bigint>(
    Array.from({ length: ROWS }, (_, i) => [{ press: pressOf(Math.floor(i / PER_SEGMENT)), job: BigInt(i % PER_SEGMENT) }, BigInt(i)] as [SheetKey, bigint]),
    compareFor(Key));
  const blob = paged(Sheets, sheets);
  const allKeys = [...sheets.keys()];
  const K = toEastTypeValue(Key);
  const P = toEastTypeValue(Press);
  const wholeKey = boundReader(0n, null, "from", K, K);
  const pressOnly = boundReader(0n, null, "from", K, P);

  /** One end: left out, a whole key, or the key's first field. */
  const end = (): KeyTest<SheetKey> | undefined => {
    const pick = draw(3);
    const press = pressOf(draw(SEGMENTS + 2));  // two presses past the last
    if (pick === 0) return undefined;
    if (pick === 1) return wholeKey.atOrPast({ press, job: BigInt(draw(PER_SEGMENT + 2)) }) as KeyTest<SheetKey>;
    return pressOnly.atOrPast({ press }) as KeyTest<SheetKey>;
  };
  /** The rows a walk of the whole keeps between two tests. */
  const oracle = (from: KeyTest<SheetKey> | undefined, to: KeyTest<SheetKey> | undefined): [number, number] => {
    let lo = 0;
    if (from !== undefined) while (lo < ROWS && !from(allKeys[lo]!)) lo++;
    let hi = ROWS;
    if (to !== undefined) { hi = 0; while (hi < ROWS && !to(allKeys[hi]!)) hi++; }
    return [lo, Math.max(lo, hi)];
  };

  test("a range, a prefix and a range of a range are the rows a walk of the whole keeps", () => {
    const lazy = openBeast2LazyFor(Sheets, { frozen: true })(blob) as SortedMap<SheetKey, bigint>;
    const pages = openBeast2PagesFor(Sheets)(blob);
    const sameKeys = (got: SheetKey[], lo: number, hi: number): boolean =>
      got.length === hi - lo && got.every((key, i) => compareFor(Key)(key, allKeys[lo + i]!) === 0);
    for (let trial = 0; trial < 400; trial++) {
      let from = end();
      let to = end();
      if (draw(5) === 0) {
        // The entries at a prefix: from the first key at it up to the first past it.
        const press = { press: pressOf(draw(SEGMENTS + 2)) };
        from = pressOnly.atOrPast(press) as KeyTest<SheetKey>;
        to = pressOnly.past(press) as KeyTest<SheetKey>;
      }
      const [lo, hi] = oracle(from, to);
      const view = lazy.range(from, to);
      assert.equal(view.size, hi - lo, `trial ${trial}: size`);
      assert.ok(sameKeys([...view.keys()], lo, hi), `trial ${trial}: its walk`);
      for (let probe = 0; probe < 4; probe++) {
        const row = draw(ROWS);
        assert.equal(view.has(allKeys[row]!), row >= lo && row < hi, `trial ${trial}: a keyed read of row ${row}`);
      }
      assert.deepEqual(pages.rowRange(from as never, to as never), { lo, hi }, `trial ${trial}: the pager's row range`);

      // A range of it, by two more ends: the rows both ranges hold.
      const innerFrom = end();
      const innerTo = end();
      let [innerLo, innerHi] = oracle(innerFrom, innerTo);
      innerLo = Math.max(innerLo, lo);
      innerHi = Math.max(innerLo, Math.min(innerHi, hi));
      if (hi === lo) innerHi = innerLo = lo;  // within an empty range every range is empty
      const inner = view.range(innerFrom, innerTo);
      assert.equal(inner.size, innerHi - innerLo, `trial ${trial}: a range of the range`);
      assert.ok(sameKeys([...inner.keys()], innerLo, innerHi), `trial ${trial}: its walk`);
      const within = pages.rowRange(innerFrom as never, innerTo as never, lo, hi);
      assert.equal(within.hi - within.lo, innerHi - innerLo, `trial ${trial}: the pager's row range within the range`);
    }
    assert.equal(beast2LazyStats(lazy)!.hydrated, false, "the input is never read whole");
  });
});

describe("Beast2 v5 — a range whose ends cannot be placed", () => {
  test("is refused in a keyed read's words, at the read that needs them", () => {
    // The second half of the collection spliced ahead of the first: every
    // segment whole, and the fences no longer ascending.
    const rows = [...counts];
    const unordered = spliceBeast2([paged(Counts, rows.slice(ROWS / 2)), paged(Counts, rows.slice(0, ROWS / 2))]);
    const words = `beast2 v5: segments ${SEGMENTS / 2 - 1} and ${SEGMENTS / 2} are not disjoint ascending key ranges — the wire must hold the canonical value (corrupt or pre-contract blob)`;
    const refused = (err: unknown): boolean => err instanceof LazyReadError && err.message === words;
    const open = (): SortedMap<bigint, bigint> => openBeast2LazyFor(Counts, { frozen: true })(unordered) as SortedMap<bigint, bigint>;

    assert.throws(() => open().get(33n), refused, "a keyed read of the blob");
    const view = open().range(atOrPast(30n), atOrPast(60n));  // making it refuses nothing
    assert.throws(() => view.size, refused, "its size is refused, not zero");
    assert.throws(() => [...view], refused, "a walk of it");
    assert.throws(() => view.has(33n), refused, "a keyed read inside it");
    assert.throws(() => view.set(31n, 0n), refused, "a read that decodes its rows");

    const size = sizeOf("both");
    const sum = sumOf("both");
    const raised = (err: unknown): boolean => (err as Error).message === words;
    assert.throws(() => size(open(), 30n, 60n), raised, "a body's size of the range");
    assert.throws(() => sum(open(), 30n, 60n), raised, "a body's loop over it");
    const made = East.function([Counts], BooleanType, ($, d) => {
      $.let(d.range({ from: 30n, to: 60n }));
      $.return(true);
    }).toIR().compile([]) as (d: unknown) => boolean;
    assert.equal(made(open()), true, "a range that is made and never read refuses nothing");
  });
});
