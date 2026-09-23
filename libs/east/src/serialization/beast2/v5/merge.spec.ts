/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The merge of sorted collections: a key several inputs hold folds in input
 * order; the output is the canonical blob of the merged value, whatever the
 * inputs' segments; a key range merges just its keys; and every refusal names
 * the input it is about.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DictType, IntegerType, SetType, StringType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { toEastTypeValue } from "../../../type_of_type.js";
import { SortedMap, SortedSet } from "../../../index.js";
import {
  COLLECTION_MANIFEST_KIND,
  type Beast2ManifestSource,
  type Beast2MergeOptions,
  type Beast2MergeSource,
  carveBeast2,
  decodeBeast2For,
  encodeBeast2FenceFor,
  encodeBeast2For,
  encodeBeast2PagedFor,
  encodeBeast2SegmentsFor,
  mergeBeast2For,
  openBeast2PagesFor,
  readBeast2Extents,
  segmentRuleFor,
} from "../index.js";

const DictSS = DictType(StringType, StringType);
const DictSI = DictType(StringType, IntegerType);

/** A sorted Dict from `[key, value]` pairs. */
const dict = <V>(entries: [string, V][]): SortedMap<string, V> => new SortedMap(entries, compareFor(StringType));

/** Merges `sources` and returns the output blob and what the merge came to. */
function mergeInto(type: Parameters<typeof mergeBeast2For>[0], sources: readonly Beast2MergeSource[], options?: Beast2MergeOptions) {
  const chunks: Uint8Array[] = [];
  const stats = mergeBeast2For(type, options)(sources, (bytes) => chunks.push(bytes));
  return { blob: new Uint8Array(Buffer.concat(chunks)), stats };
}

describe("beast2 v5 merge of sorted collections", () => {
  const concat = { merge: (_key: string, acc: string, value: string) => acc + value };

  test("folds a key several inputs hold, in input order", () => {
    const inputs = [
      encodeBeast2PagedFor(DictSS)(dict([["a", "1"], ["b", "x"]])),
      encodeBeast2PagedFor(DictSS)(dict([["a", "2"]])),
      encodeBeast2PagedFor(DictSS)(dict([["a", "3"], ["c", "y"]])),
    ];
    const { blob, stats } = mergeInto(DictSS, inputs, concat);
    assert.deepEqual([...decodeBeast2For(DictSS)(blob)], [["a", "123"], ["b", "x"], ["c", "y"]]);
    assert.deepEqual(stats, { inputs: 3, entries: 3, folds: 2 });
  });

  test("writes the canonical blob of the merged value, whatever the inputs' segments", () => {
    // Inputs cut into segments of the test's own size: the output is still the
    // bytes a writer of the merged value writes.
    const evens = dict(Array.from({ length: 6_000 }, (_, i) => [`k${String(2 * i).padStart(6, "0")}`, BigInt(i)] as [string, bigint]));
    const odds = dict(Array.from({ length: 6_000 }, (_, i) => [`k${String(2 * i + 1).padStart(6, "0")}`, BigInt(-i)] as [string, bigint]));
    const inSegmentsOf = (value: SortedMap<string, bigint>, size: number): Uint8Array => {
      const entries = [...value];
      const batches: SortedMap<string, bigint>[] = [];
      for (let i = 0; i < entries.length; i += size) batches.push(dict(entries.slice(i, i + size)));
      return encodeBeast2SegmentsFor(DictSI)(batches);
    };
    const { blob } = mergeInto(DictSI, [inSegmentsOf(evens, 700), inSegmentsOf(odds, 1_300)]);
    assert.deepEqual(blob, encodeBeast2PagedFor(DictSI)(dict([...evens, ...odds])));
  });

  test("merges just the keys of a range", () => {
    const value = dict(Array.from({ length: 5_000 }, (_, i) => [`k${String(i).padStart(6, "0")}`, BigInt(i)] as [string, bigint]));
    const blob = encodeBeast2PagedFor(DictSI)(value);
    const inRange = (from: string | undefined, to: string | undefined): SortedMap<string, bigint> =>
      dict([...value].filter(([k]) => (from === undefined || k >= from) && (to === undefined || k < to)));
    for (const [from, to] of [["k001000", "k003500"], ["k004000", undefined], [undefined, "k000010"], ["k002500", "k002500"]] as const) {
      const { blob: merged } = mergeInto(DictSI, [blob], { from, to });
      assert.deepEqual(merged, encodeBeast2PagedFor(DictSI)(inRange(from, to)), `[${from}, ${to})`);
    }
  });

  test("keeps a Set's shared element once under union", () => {
    const type = SetType(IntegerType);
    const set = (xs: bigint[]): SortedSet<bigint> => new SortedSet(xs, compareFor(IntegerType));
    const { blob, stats } = mergeInto(type, [encodeBeast2PagedFor(type)(set([1n, 3n])), encodeBeast2PagedFor(type)(set([2n, 3n]))], { union: true });
    assert.deepEqual([...decodeBeast2For(type)(blob)], [1n, 2n, 3n]);
    assert.equal(stats.folds, 1);
  });

  test("refuses a key several inputs hold without a fold, naming the key", () => {
    const inputs = [encodeBeast2PagedFor(DictSS)(dict([["a", "1"]])), encodeBeast2PagedFor(DictSS)(dict([["a", "2"]]))];
    assert.throws(() => mergeInto(DictSS, inputs), { message: `beast2 v5: duplicate Dict key emitted: "a" — Dict keys must be unique` });
  });

  test("reads inputs through ranged access and through manifests", () => {
    const value = dict(Array.from({ length: 3_000 }, (_, i) => [`k${String(i).padStart(6, "0")}`, `v${i}`] as [string, string]));
    const entries = [...value];
    const batches: SortedMap<string, string>[] = [];
    for (let i = 0; i < entries.length; i += 400) batches.push(dict(entries.slice(i, i + 400)));
    const blob = encodeBeast2SegmentsFor(DictSS)(batches);
    const extents = readBeast2Extents(blob);
    const pages = openBeast2PagesFor(DictSS)(blob);
    const fence = encodeBeast2FenceFor(StringType);
    const segments = extents.offsets.map((_, i) => carveBeast2(blob, i, i + 1, extents));
    const manifest: Beast2ManifestSource = {
      manifest: {
        kind: COLLECTION_MANIFEST_KIND,
        level: 0n,
        type: toEastTypeValue(DictSS),
        rule: segmentRuleFor(DictSS),
        header: "",
        entries: segments.map((segment, i) => ({ hash: `${i}`, fence: fence(pages.fence(i)), count: BigInt(extents.counts[i]!), bytes: BigInt(segment.length) })),
      },
      segment: (i) => segments[i]!,
    };
    const reader = { size: blob.length, read: (offset: number, length: number) => blob.subarray(offset, offset + length) };
    const expected = encodeBeast2PagedFor(DictSS)(value);
    assert.deepEqual(mergeInto(DictSS, [reader]).blob, expected);
    assert.deepEqual(mergeInto(DictSS, [manifest]).blob, expected);
    assert.deepEqual(mergeInto(DictSS, [manifest], { from: "k001234", to: "k002345" }).blob,
      encodeBeast2PagedFor(DictSS)(dict(entries.filter(([k]) => k >= "k001234" && k < "k002345"))));
  });

  test("names the input a refusal is about", () => {
    const good = encodeBeast2PagedFor(DictSS)(dict([["a", "1"]]));
    const otherType = encodeBeast2PagedFor(DictSI)(dict([["a", 1n]]));
    assert.throws(
      () => mergeInto(DictSS, [good, otherType], { labels: ["a.beast2", "b.beast2"] }),
      (err: Error) => err.message.startsWith("merge: input 1 (b.beast2) has type ") && err.message.includes(", expected "),
    );
    // An input without an index cannot be read by segment.
    const whole = encodeBeast2For(DictSS)(dict([["a", "1"]]));
    assert.throws(
      () => mergeInto(DictSS, [whole]),
      { message: "merge: input 0: beast2 v5: blob carries no index — carve/splice need one (write with the index enabled, the default)" },
    );
  });

  test("refuses no inputs, a root it cannot merge, and a fold that does not fit the root", () => {
    assert.throws(() => mergeInto(DictSS, []), { message: "merge: at least one input is needed" });
    assert.throws(() => mergeBeast2For(ArrayType(IntegerType)), { message: "merge: inputs must be Set or Dict blobs, got Array" });
    assert.throws(() => mergeBeast2For(SetType(IntegerType), { merge: (_k, a) => a }), /folds a Dict/);
    assert.throws(() => mergeBeast2For(DictSS, { union: true }), /collapses a Set/);
  });
});
