/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sorted runs: each run is the canonical blob of its sorted, folded value, or
 * that value's manifest directory; a key's values fold pairwise in the order
 * they were added; a run closes at the element cap or the byte cap; and the
 * runs a pinned sequence of elements closes are the runs east-c closes for it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ArrayType, BlobType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, OptionType, RecursiveType, SetType,
  StringType, StructType, VariantType,
} from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap, SortedSet } from "../../../index.js";
import {
  Beast2RunSorter,
  type Beast2RunSorterOptions,
  FOLD_TABLE_MAX_KEY_BYTES,
  FOLD_TABLE_MAX_KEYS,
  RUN_MAX_BYTES,
  RUN_MAX_COUNT,
  decodeBeast2For,
  decodeCollectionManifest,
  encodeBeast2PagedFor,
  fnv1a64,
  mergeBeast2For,
  openBeast2PagesFor,
  spliceBeast2,
} from "../index.js";

/** Sorts `elements` through a run sorter and returns each run's bytes. */
function sortInto<T>(type: Parameters<typeof encodeBeast2PagedFor>[0], elements: Iterable<T>, options?: Beast2RunSorterOptions): Uint8Array[] {
  const runs: Uint8Array[][] = [];
  const closed: boolean[] = [];
  const sorter = new Beast2RunSorter(type, (run) => {
    assert.equal(run, runs.length, "runs are numbered in the order they open");
    const chunks: Uint8Array[] = [];
    runs.push(chunks);
    closed.push(false);
    return { write: (bytes) => chunks.push(bytes), close: () => { closed[run] = true; } };
  }, options);
  for (const element of elements) sorter.add(element as never);
  sorter.finish();
  assert.equal(sorter.runs, runs.length);
  assert.ok(closed.every((c) => c), "every run is closed");
  return runs.map((chunks) => new Uint8Array(Buffer.concat(chunks)));
}

/** A digest of runs' bytes, which east-c's `tests/test_beast2_runs.c` pins
 *  alike: FNV-1a over the runs' own FNV-1a digests, in hex, comma-joined. */
const parityDigestOf = (runs: readonly Uint8Array[]): string =>
  fnv1a64(new TextEncoder().encode(runs.map((run) => fnv1a64(run).toString(16).padStart(16, "0")).join(",")))
    .toString(16).padStart(16, "0");

/** `k0000042`-style keys, which order the way their numbers do. */
const key = (i: number): string => `k${String(i).padStart(7, "0")}`;

describe("beast2 v5 sorted runs", () => {
  const DictSI = DictType(StringType, IntegerType);
  const sum = { merge: (_key: string, acc: bigint, value: bigint) => acc + value };

  test("writes a run as the canonical blob of its sorted, folded value", () => {
    const added: [string, bigint][] = [["c", 1n], ["a", 2n], ["c", 3n], ["b", 4n], ["a", 5n]];
    const [run, ...rest] = sortInto(DictSI, added, sum);
    assert.equal(rest.length, 0);
    const expected = new SortedMap<string, bigint>([["a", 7n], ["b", 4n], ["c", 4n]], compareFor(StringType));
    assert.deepEqual(run, encodeBeast2PagedFor(DictSI)(expected));
  });

  test("folds a key's values in the order they were added", () => {
    const type = DictType(StringType, StringType);
    const [run] = sortInto(type, [["k", "a"], ["j", "x"], ["k", "b"], ["k", "c"]], {
      merge: (_key: string, acc: string, value: string) => acc + value,
    });
    assert.deepEqual([...decodeBeast2For(type)(run!)], [["j", "x"], ["k", "abc"]]);
  });

  test("folds four or more of a key's values pairwise, in order", () => {
    // The grouping is a rule: east-c's `tests/test_beast2_runs.c` pins the
    // same string, since for a fold over floats it decides the bytes.
    const type = DictType(StringType, StringType);
    const added = ["a", "b", "c", "d", "e", "f", "g"].map((v) => ["k", v] as [string, string]);
    const [run] = sortInto(type, added, { merge: (_key: string, older: string, newer: string) => `(${older}${newer})` });
    assert.deepEqual([...decodeBeast2For(type)(run!)], [["k", "(((ab)(cd))((ef)g))"]]);
  });

  test("copies each value O(log n) times through a merge that copies its operands", () => {
    // A merge that builds a new value from both of its own copies what each
    // holds; folded one value at a time that is O(n²) for a key's n values.
    const type = DictType(StringType, ArrayType(IntegerType));
    const n = 4_096;
    let copied = 0;
    const [run] = sortInto(type, Array.from({ length: n }, (_, i) => ["k", [BigInt(i)]] as [string, bigint[]]), {
      merge: (_key: string, older: bigint[], newer: bigint[]) => { copied += older.length + newer.length; return [...older, ...newer]; },
    });
    assert.deepEqual(decodeBeast2For(type)(run!).get("k"), Array.from({ length: n }, (_, i) => BigInt(i)));
    assert.equal(copied, n * Math.log2(n), "each of n values copied log2(n) times");
  });

  test("keeps a Set's repeated element once under union, and refuses it without", () => {
    const type = SetType(StringType);
    const [run] = sortInto(type, ["b", "a", "b", "c", "a"], { union: true });
    assert.deepEqual([...decodeBeast2For(type)(run!)], ["a", "b", "c"]);
    assert.throws(
      () => sortInto(type, ["b", "a", "b"]),
      { message: `beast2 v5: duplicate Set element emitted: "b" — Set elements must be unique` },
    );
  });

  test("refuses a Dict key added twice without a merge function", () => {
    assert.throws(
      () => sortInto(DictSI, [["k", 1n], ["j", 2n], ["k", 3n]]),
      { message: `beast2 v5: duplicate Dict key emitted: "k" — Dict keys must be unique` },
    );
  });

  test("closes a run at the element cap", () => {
    const type = SetType(IntegerType);
    const elements = Array.from({ length: RUN_MAX_COUNT + 10 }, (_, i) => BigInt(RUN_MAX_COUNT + 10 - i));
    const runs = sortInto(type, elements);
    assert.deepEqual(runs.map((run) => openBeast2PagesFor(type)(run).elementCount), [RUN_MAX_COUNT, 10]);
    // The first run holds the elements added first, whatever their keys.
    assert.equal([...decodeBeast2For(type)(runs[1]!)].at(-1), 10n);
  });

  test("closes a run at the byte cap", () => {
    // Elements of 2 MiB: the run that reaches the cap is written with the
    // element that reached it.
    const type = DictType(StringType, BlobType);
    const payload = new Uint8Array(2 * 1024 * 1024).fill(7);
    const elements = Array.from({ length: 40 }, (_, i) => [key(i), payload] as [string, Uint8Array]);
    const perElement = key(0).length + 1 + 4 + payload.length;
    const first = Math.ceil(RUN_MAX_BYTES / perElement);
    const runs = sortInto(type, elements, { codec: "none" });
    assert.deepEqual(runs.map((run) => openBeast2PagesFor(type)(run).elementCount), [first, 40 - first]);
  });

  test("is left as it was by an element that fails to encode", () => {
    const runs: Uint8Array[][] = [];
    const sorter = new Beast2RunSorter(DictSI, () => {
      const chunks: Uint8Array[] = [];
      runs.push(chunks);
      return { write: (bytes) => chunks.push(bytes), close: () => {} };
    });
    sorter.add(["b", 1n]);
    assert.throws(() => sorter.add(["a", "not an integer" as never]));
    sorter.add(["a", 2n]);
    sorter.finish();
    assert.deepEqual([...decodeBeast2For(DictSI)(Buffer.concat(runs[0]!))], [["a", 2n], ["b", 1n]]);
    assert.throws(() => sorter.add(["c", 3n]), /after finish/);
  });

  test("writes no run when nothing was added", () => {
    assert.deepEqual(sortInto(DictSI, []), []);
  });

  test("writes each run as a manifest directory when its sink takes one", () => {
    // 7919 is prime to 136,072: every key once, in a permuted order, over two
    // runs.
    const n = RUN_MAX_COUNT + 5_000;
    const elements = Array.from({ length: n }, (_, i) => [key((i * 7919) % n), BigInt(i)] as [string, bigint]);
    const blobs = sortInto(DictSI, elements);
    const dirs: { objects: Map<string, Uint8Array>; manifest: Uint8Array | null }[] = [];
    const sorter = new Beast2RunSorter(DictSI, (run) => {
      assert.equal(run, dirs.length, "runs are numbered in the order they open");
      const dir = { objects: new Map<string, Uint8Array>(), manifest: null as Uint8Array | null };
      dirs.push(dir);
      return { object: (hash, bytes) => { dir.objects.set(hash, bytes); }, manifest: (bytes) => { dir.manifest = bytes; } };
    });
    for (const element of elements) sorter.add(element);
    sorter.finish();
    assert.equal(dirs.length, 2);
    dirs.forEach((dir, i) => {
      const entries = decodeCollectionManifest(dir.manifest!).entries;
      assert.deepEqual(spliceBeast2(entries.map((entry) => dir.objects.get(entry.hash)!)), blobs[i], `run ${i}'s segments are its blob's`);
    });
  });

  test("refuses a root it cannot sort, and a fold that does not fit the root", () => {
    const open = () => ({ write: () => {}, close: () => {} });
    assert.throws(() => new Beast2RunSorter(ArrayType(IntegerType), open), /Set or Dict values, not Array/);
    assert.throws(() => new Beast2RunSorter(SetType(IntegerType), open, { merge: (_k, a) => a }), /folds a Dict/);
    assert.throws(() => new Beast2RunSorter(DictSI, open, { union: true }), /collapses a Set/);
  });

  describe("two-runtime parity", () => {
    // Where a run closes decides how a repeated key's values group before they
    // fold, so east and east-c must close runs at the same elements and write
    // each as the same bytes. The same sequences and digests are pinned in
    // east-c's `tests/test_beast2_runs.c`.

    test("closes and writes the runs east-c writes for a permuted Dict", () => {
      // 300,000 distinct keys in a permuted order: 7919 is prime to 300,000.
      const n = 300_000;
      const elements = Array.from({ length: n }, (_, i) => [key((i * 7919) % n), BigInt(i)] as [string, bigint]);
      const runs = sortInto(DictSI, elements);
      assert.deepEqual(runs.map((run) => openBeast2PagesFor(DictSI)(run).elementCount), [RUN_MAX_COUNT, RUN_MAX_COUNT, n - 2 * RUN_MAX_COUNT]);
      assert.equal(parityDigestOf(runs), "d90d3818c52e31bb");
    });

    test("closes and writes the runs east-c writes for a Set under union", () => {
      // 300,000 elements over 200,000 values: each repeats, within a run and
      // across runs.
      const type = SetType(StringType);
      const elements = Array.from({ length: 300_000 }, (_, i) => `e${String((i * 7919) % 200_000).padStart(6, "0")}`);
      const runs = sortInto(type, elements, { union: true });
      assert.equal(runs.length, 3);
      assert.equal(parityDigestOf(runs), "a4a7379f0468c2be");
    });
  });
});

describe("beast2 v5 sorted runs, folded as added", () => {
  // SPEC.md, "Folding as added": a fold whose values do not grow folds a key's
  // values in a table in front of the open run.
  const DictSI = DictType(StringType, IntegerType);
  const sum = { merge: (_key: string, acc: bigint, value: bigint) => acc + value };
  const open = () => ({ write: () => {}, close: () => {} });
  /** A key of `length` characters, distinct for each `i`. */
  const long = (i: number, length: number): string => key(i).padEnd(length, "x");

  test("takes a Dict's merge over a bounded value, and a Set's union", () => {
    const takes = (type: Parameters<typeof encodeBeast2PagedFor>[0], options?: Beast2RunSorterOptions): boolean =>
      new Beast2RunSorter(type, open, options).foldTableState().on;
    const keep = { merge: (_key: unknown, older: unknown) => older };
    assert.equal(takes(DictSI, sum), true);
    assert.equal(takes(DictType(StringType, StructType({ n: IntegerType, at: OptionType(DateTimeType), up: BooleanType })), keep), true);
    assert.equal(takes(DictType(IntegerType, VariantType({ none: StructType({}), some: FloatType })), keep), true);
    assert.equal(takes(SetType(StringType), { union: true }), true);
    // Values that grow as they fold keep today's path, and so does no fold.
    assert.equal(takes(DictType(StringType, StringType), keep), false);
    assert.equal(takes(DictType(StringType, ArrayType(IntegerType)), keep), false);
    assert.equal(takes(DictType(StringType, StructType({ n: IntegerType, tag: StringType })), keep), false);
    assert.equal(takes(DictType(StringType, RecursiveType((self) => VariantType({ leaf: IntegerType, node: ArrayType(self) }))), keep), false);
    assert.equal(takes(DictSI), false);
    assert.equal(takes(SetType(StringType)), false);
  });

  test("folds few keys' values as they are added, into one run of the keys", () => {
    const regions = ["north", "south", "east", "west", "central"];
    const elements = Array.from({ length: 2 * RUN_MAX_COUNT + 7 }, (_, i) => [regions[i % 5]!, BigInt(i)] as [string, bigint]);
    const runs = sortInto(DictSI, elements, sum);
    const expected = new SortedMap<string, bigint>(undefined, compareFor(StringType));
    for (const [k, v] of elements) expected.set(k, (expected.get(k) ?? 0n) + v);
    assert.deepEqual(runs, [encodeBeast2PagedFor(DictSI)(expected)]);
  });

  test("holds at most FOLD_TABLE_MAX_KEYS keys, and spills at the next new one", () => {
    const sorter = new Beast2RunSorter(DictSI, open, sum);
    for (let i = 0; i < FOLD_TABLE_MAX_KEYS; i++) {
      sorter.add([key(i), 1n]);
      sorter.add([key(i), 2n]);
      assert.ok(sorter.foldTableState().keys <= FOLD_TABLE_MAX_KEYS);
    }
    assert.deepEqual(sorter.foldTableState(), { on: true, keys: FOLD_TABLE_MAX_KEYS, keyBytes: FOLD_TABLE_MAX_KEYS * 9 });
    // Two elements a key: the table stays on once it has spilled.
    sorter.add([key(FOLD_TABLE_MAX_KEYS), 1n]);
    assert.deepEqual(sorter.foldTableState(), { on: true, keys: 1, keyBytes: 9 });
    assert.equal(sorter.runs, 0, "the spill went into the open run");
  });

  test("holds at most FOLD_TABLE_MAX_KEY_BYTES of keys, and spills at the next new key past them", () => {
    // Keys of 4,094 characters are 4,096 canonical bytes, their count a
    // two-byte varint: 4,096 of them are the bound exactly.
    const sorter = new Beast2RunSorter(DictSI, open, sum);
    const fit = FOLD_TABLE_MAX_KEY_BYTES / 4_096;
    for (let i = 0; i < fit; i++) {
      sorter.add([long(i, 4_094), 1n]);
      sorter.add([long(i, 4_094), 2n]);
      assert.ok(sorter.foldTableState().keyBytes <= FOLD_TABLE_MAX_KEY_BYTES);
    }
    assert.deepEqual(sorter.foldTableState(), { on: true, keys: fit, keyBytes: FOLD_TABLE_MAX_KEY_BYTES });
    sorter.add([long(fit, 4_094), 1n]);
    assert.deepEqual(sorter.foldTableState(), { on: true, keys: 1, keyBytes: 4_096 });
  });

  test("lets a key whose bytes alone pass the byte bound into the empty table", () => {
    // A key of 16 MiB of characters, a four-byte varint before them.
    const big = "b".repeat(FOLD_TABLE_MAX_KEY_BYTES);
    const runs: Uint8Array[][] = [];
    const sorter = new Beast2RunSorter(DictSI, () => {
      const chunks: Uint8Array[] = [];
      runs.push(chunks);
      return { write: (bytes) => chunks.push(bytes), close: () => {} };
    }, sum);
    sorter.add([big, 1n]);
    sorter.add([big, 2n]);
    assert.deepEqual(sorter.foldTableState(), { on: true, keys: 1, keyBytes: FOLD_TABLE_MAX_KEY_BYTES + 4 });
    sorter.add(["a", 3n]);
    assert.deepEqual(sorter.foldTableState(), { on: true, keys: 1, keyBytes: 2 });
    sorter.finish();
    assert.deepEqual([...decodeBeast2For(DictSI)(Buffer.concat(runs[0]!))], [["a", 3n], [big, 3n]]);
  });

  test("steps aside at its first spill when it absorbed fewer than two elements a key", () => {
    const sorter = new Beast2RunSorter(DictSI, open, sum);
    for (let i = 0; i < FOLD_TABLE_MAX_KEYS; i++) sorter.add([key(i), 1n]);
    sorter.add([key(0), 1n]);
    // 65,537 absorbed for 65,536 keys: fewer than two a key.
    sorter.add([key(FOLD_TABLE_MAX_KEYS), 1n]);
    assert.deepEqual(sorter.foldTableState(), { on: false, keys: 0, keyBytes: 0 });
    // Every element after goes into the open run, which closes at the cap.
    for (let i = 0; sorter.runs === 0; i++) sorter.add([key(i), 1n]);
    assert.equal(sorter.runs, 1);
  });

  test("is left as it was by an element that fails to encode, or a fold that throws", () => {
    const runs: Uint8Array[][] = [];
    const sorter = new Beast2RunSorter(DictSI, () => {
      const chunks: Uint8Array[] = [];
      runs.push(chunks);
      return { write: (bytes) => chunks.push(bytes), close: () => {} };
    }, {
      merge: (_key: string, acc: bigint, value: bigint) => {
        if (value === 13n) throw new Error("unlucky");
        return acc + value;
      },
    });
    sorter.add(["a", 1n]);
    sorter.add(["a", 2n]);
    sorter.add(["a", 4n]);
    assert.throws(() => sorter.add(["a", 13n]), /unlucky/);
    assert.throws(() => sorter.add(["b", "not an integer" as never]));
    assert.deepEqual(sorter.foldTableState(), { on: true, keys: 1, keyBytes: 2 });
    sorter.add(["a", 8n]);
    sorter.finish();
    assert.deepEqual([...decodeBeast2For(DictSI)(Buffer.concat(runs[0]!))], [["a", 15n]]);
  });

  test("fails, as east-c's does, once a merge throws as the table spills: it takes nothing more, and finishes nothing", () => {
    // The first key spills into the open run, and the second's fold throws: a
    // sorter that went on would hold the first in the run and the table both.
    let unlucky = false;
    const sorter = new Beast2RunSorter(DictSI, open, {
      merge: (_key: string, acc: bigint, value: bigint) => {
        if (unlucky) throw new Error("unlucky");
        return acc + value;
      },
    });
    sorter.add([key(0), 1n]);
    sorter.add([key(0), 2n]);
    // Three values: two partials, which fold as the table spills.
    for (const value of [1n, 2n, 10n]) sorter.add([key(1), value]);
    for (let i = 2; i < FOLD_TABLE_MAX_KEYS; i++) {
      sorter.add([key(i), 1n]);
      sorter.add([key(i), 2n]);
    }
    unlucky = true;
    assert.throws(() => sorter.add([key(FOLD_TABLE_MAX_KEYS), 1n]), /unlucky/);
    assert.throws(() => sorter.add([key(FOLD_TABLE_MAX_KEYS + 1), 1n]), /the sorter failed as it wrote a run or spilled its fold table/);
    assert.throws(() => sorter.finish(), /the sorter failed as it wrote a run or spilled its fold table/);
    assert.throws(() => sorter.finish(), /the sorter failed/, "and again");
  });

  test("fails once a run cannot be written: it takes nothing more, and finishes nothing", () => {
    const sorter = new Beast2RunSorter(DictSI, open);
    sorter.add(["k", 1n]);
    sorter.add(["k", 2n]);
    assert.throws(() => sorter.finish(), /duplicate Dict key emitted/);
    assert.throws(() => sorter.finish(), /the sorter failed/, "a second finish does not pass for a first that wrote the run");
    assert.throws(() => sorter.add(["j", 3n]), /the sorter failed/);
  });

  test("over exact value types, writes what a plain fold does (seeded)", () => {
    // The runs differ from a sorter's without the table — fewer, each key in
    // fewer of them — but merged, an exact fold's are the same bytes.
    const Tally = StructType({ count: IntegerType, any: BooleanType });
    type Tally = { count: bigint; any: boolean };
    // Drawn from `keys`, a shape's distinct keys pass FOLD_TABLE_MAX_KEYS in
    // the last two: once by single draws, so the table steps aside, and once
    // by pairs, so it spills and stays on.
    const shapes = [
      { keys: 1, length: 1_000, repeat: 1 },
      { keys: 5, length: 50_000, repeat: 1 },
      { keys: 1_000, length: 50_000, repeat: 3 },
      { keys: 300_000, length: 100_000, repeat: 1 },
      { keys: 140_000, length: 200_000, repeat: 2 },
    ];
    for (const [seed, shape] of shapes.entries()) {
      // xorshift32: the same stream on every run.
      let state = 0x9e3779b9 ^ (seed + 1);
      const next = (): number => {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return state;
      };
      // Each drawn key `repeat` times in a row: the table spills as it fills
      // when it absorbed two a key, and steps aside when it did not.
      const drawn = Array.from({ length: shape.length }, (_, i) => i % shape.repeat === 0 ? next() % shape.keys : -1);
      for (let i = 0; i < drawn.length; i++) if (drawn[i] === -1) drawn[i] = drawn[i - 1]!;
      const context = `seed ${seed}: ${JSON.stringify(shape)}`;

      const merged = (type: Parameters<typeof encodeBeast2PagedFor>[0], elements: unknown[], options: Beast2RunSorterOptions): Uint8Array => {
        const chunks: Uint8Array[] = [];
        mergeBeast2For(type, options)(sortInto(type, elements, options), (bytes) => chunks.push(bytes));
        return new Uint8Array(Buffer.concat(chunks));
      };

      const sums = new SortedMap<string, bigint>(undefined, compareFor(StringType));
      const pairs = drawn.map((k, i) => [key(k), BigInt(next() % 1_000) - BigInt(i % 3)] as [string, bigint]);
      for (const [k, v] of pairs) sums.set(k, sums.has(k) ? sums.get(k)! + v : v);
      assert.deepEqual(merged(DictSI, pairs, sum), encodeBeast2PagedFor(DictSI)(sums), `sums, ${context}`);

      const TallyDict = DictType(IntegerType, Tally);
      const add = { merge: (_key: bigint, a: Tally, b: Tally): Tally => ({ count: a.count + b.count, any: a.any || b.any }) };
      const tallies = new SortedMap<bigint, Tally>(undefined, compareFor(IntegerType));
      const tallied = drawn.map((k) => [BigInt(k) - 50_000n, { count: 1n, any: next() % 97 === 0 }] as [bigint, Tally]);
      for (const [k, v] of tallied) tallies.set(k, tallies.has(k) ? add.merge(k, tallies.get(k)!, v) : v);
      assert.deepEqual(merged(TallyDict, tallied, add), encodeBeast2PagedFor(TallyDict)(tallies), `tallies, ${context}`);

      const SetS = SetType(StringType);
      const elements = drawn.map((k) => key(k));
      assert.deepEqual(
        merged(SetS, elements, { union: true }),
        encodeBeast2PagedFor(SetS)(new SortedSet(elements, compareFor(StringType))),
        `a set, ${context}`,
      );
    }
  });

  test("closes and writes the runs east-c writes when long keys spill the table at its byte bound", () => {
    // Pinned in east-c's `tests/test_beast2_runs.c`. 10,000 keys of 4,096
    // canonical bytes, each added twice, then once more: the table spills at
    // its byte bound every 4,096 keys, and the open run reaches the byte cap
    // in the middle of the fourth spill. The floats show how they grouped.
    const type = DictType(StringType, FloatType);
    const elements = Array.from({ length: 30_000 }, (_, i) => [
      long(i < 20_000 ? i >> 1 : i - 20_000, 4_094),
      [0.1, 1e16, -1e16, 3.3, -0.7][i % 5]! * ((i % 11) + 1),
    ] as [string, number]);
    const runs = sortInto(type, elements, { merge: (_key: string, acc: number, value: number) => acc + value, codec: "none" });
    assert.deepEqual(runs.map((run) => openBeast2PagesFor(type)(run).elementCount), [10_000, 3_647]);
    assert.equal(parityDigestOf(runs), "d5b51e634f965575");
  });
});

describe("beast2 v5 sorted runs, merged", () => {
  // The runs and the merge together are the any-order write: whatever order
  // the elements came in and wherever the runs closed, merging the runs is the
  // canonical blob of the value.
  test("merge back into the canonical blob of the whole value", () => {
    const type = DictType(StringType, IntegerType);
    const n = 300_000;
    const expected = new SortedMap<string, bigint>(undefined, compareFor(StringType));
    const elements: [string, bigint][] = [];
    for (let i = 0; i < n; i++) {
      const k = key((i * 7919) % 200_000);
      elements.push([k, BigInt(i)]);
      expected.set(k, (expected.get(k) ?? 0n) + BigInt(i));
    }
    const merge = (_key: string, acc: bigint, value: bigint): bigint => acc + value;
    const runs = sortInto(type, elements, { merge });
    assert.ok(runs.length > 1);
    const chunks: Uint8Array[] = [];
    const stats = mergeBeast2For(type, { merge })(runs, (bytes) => chunks.push(bytes));
    assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), encodeBeast2PagedFor(type)(expected));
    assert.equal(stats.entries, expected.size);

    const setType = SetType(StringType);
    const set = new SortedSet<string>(elements.map(([k]) => k), compareFor(StringType));
    const setRuns = sortInto(setType, elements.map(([k]) => k), { union: true });
    const setChunks: Uint8Array[] = [];
    mergeBeast2For(setType, { union: true })(setRuns, (bytes) => setChunks.push(bytes));
    assert.deepEqual(new Uint8Array(Buffer.concat(setChunks)), encodeBeast2PagedFor(setType)(set));
  });
});
