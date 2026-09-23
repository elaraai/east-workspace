/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sorted runs: each run is the canonical blob of its sorted, folded value; a
 * key's values fold in the order they were added; a run closes at the element
 * cap or the byte cap; and the runs a pinned sequence of elements closes are
 * the runs east-c closes for it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, BlobType, DictType, IntegerType, SetType, StringType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap, SortedSet } from "../../../index.js";
import {
  Beast2RunSorter,
  type Beast2RunSorterOptions,
  RUN_MAX_BYTES,
  RUN_MAX_COUNT,
  decodeBeast2For,
  encodeBeast2PagedFor,
  fnv1a64,
  mergeBeast2For,
  openBeast2PagesFor,
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
    const digestOf = (runs: readonly Uint8Array[]): string =>
      fnv1a64(new TextEncoder().encode(runs.map((run) => fnv1a64(run).toString(16).padStart(16, "0")).join(",")))
        .toString(16).padStart(16, "0");

    test("closes and writes the runs east-c writes for a permuted Dict", () => {
      // 300,000 distinct keys in a permuted order: 7919 is prime to 300,000.
      const n = 300_000;
      const elements = Array.from({ length: n }, (_, i) => [key((i * 7919) % n), BigInt(i)] as [string, bigint]);
      const runs = sortInto(DictSI, elements);
      assert.deepEqual(runs.map((run) => openBeast2PagesFor(DictSI)(run).elementCount), [RUN_MAX_COUNT, RUN_MAX_COUNT, n - 2 * RUN_MAX_COUNT]);
      assert.equal(digestOf(runs), "289758f1dbfa71fb");
    });

    test("closes and writes the runs east-c writes for a Set under union", () => {
      // 300,000 elements over 200,000 values: each repeats, within a run and
      // across runs.
      const type = SetType(StringType);
      const elements = Array.from({ length: 300_000 }, (_, i) => `e${String((i * 7919) % 200_000).padStart(6, "0")}`);
      const runs = sortInto(type, elements, { union: true });
      assert.equal(runs.length, 3);
      assert.equal(digestOf(runs), "0268e95d59fbf26a");
    });
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
