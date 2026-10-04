/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lazy pager-backed collection values — observational equivalence with the
 * eager decode: lazy reads (size / get / has / iteration / index reads) and
 * transparent hydration on everything else, for Dict, Set and Array roots.
 */

import { describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  IntegerType, StringType, ArrayType, SetType, DictType, StructType,
  FloatType, OptionType, RecursiveType, VariantType, RefType, VectorType, FunctionType,
  type EastType,
} from "../../../types.js";
import { compareFor, equalFor } from "../../../comparison.js";
import { LazyReadError } from "../../../error.js";
import { SortedMap, SortedSet, isEastDict, isEastSet } from "../../../index.js";
import {
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2PagedFor,
  encodeBeast2SegmentsFor,
  iterBeast2SegmentsFor,
  openBeast2LazyFor,
  openBeast2PagesFor,
  isBeast2LazySafe,
  beast2LazyStats,
  readBeast2Extents,
  spliceBeast2,
  Beast2Pages,
  type Beast2Codec,
} from "../index.js";
import type { Beast2SyncRangeReader } from "../index.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(IntegerType, RowType);

/** A collection in canonical order as a blob of 100-element segments, or
 *  `per` — a geometry chosen here rather than by the cut rule, so that a small
 *  value still spans several segments. */
function paged(type: EastType, value: Iterable<unknown>, codec?: Beast2Codec, per = 100): Uint8Array {
  const items = [...value];
  const batches: unknown[] = [];
  for (let i = 0; i < items.length; i += per) {
    const chunk = items.slice(i, i + per);
    batches.push(type.type === "Dict" ? new Map(chunk as [unknown, unknown][]) : type.type === "Set" ? new Set(chunk) : chunk);
  }
  return encodeBeast2SegmentsFor(type, codec === undefined ? undefined : { codec })(batches as never);
}

function makeTable(n: number, offset = 0): SortedMap<bigint, { id: bigint; name: string }> {
  const entries: [bigint, { id: bigint; name: string }][] = [];
  for (let i = 0; i < n; i++) {
    const id = BigInt(i + offset);
    entries.push([id, { id, name: `row-${i + offset}` }]);
  }
  return new SortedMap(entries, compareFor(IntegerType));
}

describe("Beast2 v5 — lazy Dict", () => {
  test("lazy reads match the eager decode without hydration", () => {
    const value = makeTable(350);
    const blob = paged(TableType, value);
    const lazy = openBeast2LazyFor(TableType)(blob);

    assert.ok(lazy instanceof SortedMap);
    assert.ok(isEastDict(lazy));
    assert.equal(lazy.size, 350);
    assert.equal(lazy.get(42n)?.name, "row-42");
    assert.equal(lazy.get(9999n), undefined);
    assert.ok(lazy.has(0n));
    assert.ok(!lazy.has(-1n));
    assert.equal(lazy.minKey(), 0n);
    assert.equal(lazy.maxKey(), 349n);
    assert.deepEqual([...lazy.keys()].slice(0, 3), [0n, 1n, 2n]);

    const eq = equalFor(TableType);
    assert.ok(eq(new SortedMap([...lazy], compareFor(IntegerType)), value), "iteration yields the whole value in canonical order");
  });

  test("mutation hydrates transparently and preserves identity semantics", () => {
    const value = makeTable(250);
    const blob = paged(TableType, value);
    const lazy = openBeast2LazyFor(TableType)(blob);

    lazy.set(9999n, { id: 9999n, name: "added" });
    assert.equal(lazy.size, 251);
    assert.equal(lazy.get(123n)?.name, "row-123");
    assert.equal(lazy.get(9999n)?.name, "added");
    assert.ok(lazy.delete(0n));
    assert.equal(lazy.size, 250);
  });

  test("re-encoding a lazy value round-trips", () => {
    const value = makeTable(150);
    const blob = paged(TableType, value);
    const lazy = openBeast2LazyFor(TableType)(blob);
    const reencoded = encodeBeast2For(TableType)(lazy);
    const eq = equalFor(TableType);
    assert.ok(eq(decodeBeast2For(TableType)(reencoded), value));
  });

  test("empty blobs open as empty values", () => {
    const blob = paged(TableType, makeTable(0));
    const lazy = openBeast2LazyFor(TableType)(blob);
    assert.ok(lazy instanceof SortedMap);
    assert.equal(lazy.size, 0);
    assert.equal(lazy.minKey(), undefined);
    assert.equal(lazy.maxKey(), undefined);
    assert.deepEqual([...lazy], []);
  });

  test("cross-segment order violations surface the eager decoder's error", () => {
    const high = paged(TableType, makeTable(100, 1000));
    const low = paged(TableType, makeTable(100, 0));
    const corrupt = spliceBeast2([high, low]);
    const lazy = openBeast2LazyFor(TableType)(corrupt);
    assert.throws(() => [...lazy], {
      message: "beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)",
    });
  });

  test("hydration mid-generator keeps the in-flight iterator on the original sequence", () => {
    const value = makeTable(250);
    const blob = paged(TableType, value);
    const lazy = openBeast2LazyFor(TableType)(blob);

    const it = lazy.entries();
    const head = [it.next().value!, it.next().value!, it.next().value!];
    lazy.set(9999n, { id: 9999n, name: "added" });  // hydrates mid-generator
    const rest = [...it];
    const keys = [...head, ...rest].map(([k]) => k);
    assert.equal(keys.length, 250, "the in-flight iterator completes the pre-hydration sequence");
    for (let i = 1; i < keys.length; i++) {
      assert.ok(keys[i - 1]! < keys[i]!, "canonical ascending order throughout");
    }
    assert.equal([...lazy].length, 251, "a new iteration sees the mutation");
  });

  test("iteration from a key seeks the owning segment through the fences and streams from there", () => {
    // Rows wide enough that a fence probe (a 4 KiB prefix) is not the whole
    // frame, so the reads say which segments were decoded and which only
    // probed.
    const WideRow = StructType({ id: IntegerType, name: StringType });
    const WideTable = DictType(IntegerType, WideRow);
    const entries: [bigint, { id: bigint; name: string }][] = [];
    for (let i = 0; i < 350; i++) entries.push([BigInt(i), { id: BigInt(i), name: `row-${i}-`.padEnd(200, "x") }]);
    const value = new SortedMap(entries, compareFor(IntegerType));
    const blob = paged(WideTable, value, "none");
    const extents = readBeast2Extents(blob);
    assert.equal(extents.offsets.length, 4);
    const frame = (i: number): { offset: number; length: number } => ({
      offset: extents.offsets[i]!,
      length: (i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd) - extents.offsets[i]!,
    });
    assert.ok(frame(0).length > 8192, "a frame is wider than a fence probe");

    const reads: { offset: number; length: number }[] = [];
    const reader: Beast2SyncRangeReader = {
      size: blob.length,
      read(offset, length) {
        reads.push({ offset, length });
        return blob.subarray(offset, offset + length);
      },
    };
    // The decoded values are SortedMaps (range iteration is theirs), typed
    // as Maps by the decoder's signature.
    const sorted = (value: unknown): SortedMap<bigint, { id: bigint; name: string }> => value as SortedMap<bigint, { id: bigint; name: string }>;
    const eager = sorted(decodeBeast2For(WideTable)(blob));
    const lazy = sorted(openBeast2LazyFor(WideTable)(reader));

    // From a key inside segment 2: the same entries as the eager value's
    // range iteration, segments 2 and 3 decoded, segments 0 and 1 only
    // probed for their fences.
    reads.length = 0;
    assert.deepEqual([...lazy.entries(250n)], [...eager.entries(250n)]);
    assert.equal([...lazy.keys(250n)].length, 100);
    const decodedWhole = (i: number): boolean => reads.some((r) => r.offset === frame(i).offset && r.length === frame(i).length);
    assert.ok(decodedWhole(2) && decodedWhole(3), "the owning segment and the ones after it are read whole");
    assert.ok(!decodedWhole(0) && !decodedWhole(1), "the segments before the key are only probed");
    assert.ok(reads.every((r) => r.length <= 4096 || r.offset >= frame(2).offset), "no read before the owning segment exceeds a fence probe");
    assert.equal(lazy.size, 350, "the value did not hydrate");

    // A second seek on the same value keeps the verified fences: no fence
    // is probed again, and only the owning segment is read.
    reads.length = 0;
    assert.deepEqual([...lazy.entries(320n)], [...eager.entries(320n)]);
    assert.ok(reads.length > 0 && reads.every((r) => r.length > 4096), "no read of a later seek is a fence probe");
    assert.ok(decodedWhole(3) && !decodedWhole(2), "only the owning segment is read");

    // Every kind of key: absent between two keys, exactly a fence, the last
    // key, before the first, after the last.
    const absentTable = new SortedMap(entries.filter(([k]) => k % 2n === 0n), compareFor(IntegerType));
    const absentBlob = paged(WideTable, absentTable);
    const absentEager = sorted(decodeBeast2For(WideTable)(absentBlob));
    const absentLazy = sorted(openBeast2LazyFor(WideTable)(absentBlob));
    for (const key of [251n, 200n, 348n, -5n, 10_000n, 0n]) {
      assert.deepEqual([...absentLazy.entries(key)], [...absentEager.entries(key)], `entries from ${key}`);
      assert.deepEqual([...absentLazy.keys(key)], [...absentEager.keys(key)], `keys from ${key}`);
      assert.deepEqual([...absentLazy.values(key)], [...absentEager.values(key)], `values from ${key}`);
    }
    assert.deepEqual([...sorted(openBeast2LazyFor(WideTable)(paged(WideTable, makeTable(0)))).entries(5n)], []);
  });

  test("iteration from a key refuses a blob whose fences do not ascend, in the words every keyed read uses", () => {
    // The seek goes through the pager's own verified fences, so a fence
    // violation reads the same here as from `get`, from `slice`, and from
    // east-c — one sentence per condition, whatever path reaches it.
    const high = paged(TableType, makeTable(100, 1000));
    const low = paged(TableType, makeTable(100, 0));
    const blob = spliceBeast2([high, low]);
    const lazy = openBeast2LazyFor(TableType)(blob) as SortedMap<bigint, { id: bigint; name: string }>;
    const fenceError = {
      message: "beast2 v5: segments 0 and 1 are not disjoint ascending key ranges — the wire must hold the canonical value (corrupt or pre-contract blob)",
    };
    assert.throws(() => [...lazy.entries(1050n)], fenceError);
    assert.throws(() => openBeast2PagesFor(TableType)(blob).get(1050n), fenceError, "the keyed read says the same");
  });
});

describe("Beast2 v5 — lazy Set", () => {
  const Tags = SetType(StringType);

  function makeTags(n: number): SortedSet<string> {
    return new SortedSet(
      Array.from({ length: n }, (_, i) => `tag-${String(i).padStart(4, "0")}`),
      compareFor(StringType),
    );
  }

  test("lazy reads match the eager decode without hydration", () => {
    const value = makeTags(300);
    const blob = paged(Tags, value);
    const lazy = openBeast2LazyFor(Tags)(blob);

    assert.ok(lazy instanceof SortedSet);
    assert.ok(isEastSet(lazy));
    assert.equal(lazy.size, 300);
    assert.ok(lazy.has("tag-0042"));
    assert.ok(!lazy.has("missing"));
    assert.equal(lazy.minKey(), "tag-0000");
    assert.equal(lazy.maxKey(), "tag-0299");
    assert.deepEqual([...lazy].slice(0, 2), ["tag-0000", "tag-0001"]);
  });

  test("iteration from an element seeks the owning segment without hydrating", () => {
    const value = makeTags(300);
    const blob = paged(Tags, value);
    const eager = decodeBeast2For(Tags)(blob) as SortedSet<string>;
    const lazy = openBeast2LazyFor(Tags)(blob) as SortedSet<string>;
    for (const from of ["tag-0250", "tag-0250x", "tag-0100", "tag-0299", "a", "z"]) {
      assert.deepEqual([...lazy.keys(from)], [...eager.keys(from)], `keys from ${from}`);
      assert.deepEqual([...lazy.entries(from)], [...eager.entries(from)], `entries from ${from}`);
    }
    assert.equal(lazy.size, 300);
    const corrupt = openBeast2LazyFor(Tags)(spliceBeast2([
      paged(Tags, new SortedSet(["z-1", "z-2"], compareFor(StringType))),
      blob,
    ])) as SortedSet<string>;
    assert.throws(() => [...corrupt.keys("tag-0100")], {
      message: "beast2 v5: segments 0 and 1 are not disjoint ascending element ranges — the wire must hold the canonical value (corrupt or pre-contract blob)",
    });
  });

  test("set algebra hydrates transparently", () => {
    const value = makeTags(120);
    const blob = paged(Tags, value);
    const lazy = openBeast2LazyFor(Tags)(blob);

    const other = new SortedSet(["tag-0000", "extra"], compareFor(StringType));
    const union = lazy.union(other);
    assert.equal(union.size, 121);
    assert.ok(lazy.isSupersetOf(new SortedSet(["tag-0001"], compareFor(StringType))));
  });
});

describe("Beast2 v5 — lazy Array", () => {
  const Rows = ArrayType(StringType);
  const rows = Array.from({ length: 260 }, (_, i) => `row-${i}`);

  test("length, index reads, and iteration are lazy", () => {
    const blob = paged(Rows, rows);
    const lazy = openBeast2LazyFor(Rows)(blob);

    assert.ok(Array.isArray(lazy));
    assert.equal(lazy.length, 260);
    assert.equal(lazy[0], "row-0");
    assert.equal(lazy[259], "row-259");
    assert.equal(lazy[260], undefined);
    assert.deepEqual([...lazy], rows);
    const collected: [number, string][] = [];
    for (const [i, v] of lazy.entries()) collected.push([i, v]);
    assert.deepEqual(collected[0], [0, "row-0"]);
    assert.equal(collected.length, 260);
  });

  test("any other operation hydrates transparently", () => {
    const blob = paged(Rows, rows);
    const lazy = openBeast2LazyFor(Rows)(blob);

    assert.deepEqual(lazy.slice(10, 12), ["row-10", "row-11"]);
    lazy.push("appended");
    assert.equal(lazy.length, 261);
    assert.equal(lazy[260], "appended");
    assert.equal(lazy[0], "row-0");
  });

  test("hydration mid-iteration keeps the in-flight iterator on the original sequence", () => {
    const blob = paged(Rows, rows);
    const lazy = openBeast2LazyFor(Rows)(blob);

    const it = lazy[Symbol.iterator]();
    const head = [it.next().value!, it.next().value!];
    lazy.push("appended");  // hydrates mid-generator
    const rest = [...it];
    assert.deepEqual([...head, ...rest], rows, "the in-flight iterator completes the pre-hydration sequence");
    assert.equal(lazy.length, 261, "a fresh read sees the mutation");
  });

  test("non-canonical index strings behave exactly like the eager array", () => {
    const blob = paged(Rows, rows);
    const eager = decodeBeast2For(Rows)(blob);
    const lazy = openBeast2LazyFor(Rows)(blob);
    // `Number("01")` parses to 1, but "01" is an ordinary (absent) property
    // on an eager array — the proxy must not serve an element for it.
    for (const prop of ["", "01", " 2", "1e2", "-0", "2.0"]) {
      assert.equal(
        (lazy as unknown as Record<string, unknown>)[prop],
        (eager as unknown as Record<string, unknown>)[prop],
        `property ${JSON.stringify(prop)}`,
      );
    }
    assert.equal(lazy[2], "row-2", "canonical index reads still serve elements");
  });

  test("hydration handles very large segments without argument-limit overflow", () => {
    const IntRows = ArrayType(IntegerType);
    const big = Array.from({ length: 200_000 }, (_, i) => BigInt(i));
    // One batch → one 200k-element segment: a spread-push hydration would
    // overflow the engine's argument limit here.
    const blob = encodeBeast2SegmentsFor(IntRows)([big]);
    const lazy = openBeast2LazyFor(IntRows)(blob);
    lazy.push(200_000n);  // hydrates
    assert.equal(lazy.length, 200_001);
    assert.equal(lazy[0], 0n);
    assert.equal(lazy[199_999], 199_999n);
    assert.equal(lazy[200_000], 200_000n);
  });
});

describe("Beast2 v5 — lazy shape gate (isBeast2LazySafe)", () => {
  test("value-semantic element shapes are lazy-eligible", () => {
    assert.ok(isBeast2LazySafe(ArrayType(IntegerType)));
    assert.ok(isBeast2LazySafe(SetType(StringType)));
    assert.ok(isBeast2LazySafe(DictType(IntegerType, StructType({ id: IntegerType, name: StringType }))));
    assert.ok(isBeast2LazySafe(ArrayType(OptionType(StructType({ a: FloatType })))));
    const Tree = RecursiveType((t) => VariantType({ leaf: IntegerType, pair: StructType({ l: t, r: t }) }));
    assert.ok(isBeast2LazySafe(ArrayType(Tree)), "recursion without containers stays eligible");
  });

  test("mutable-nested and identity-compared element shapes open eager", () => {
    assert.ok(!isBeast2LazySafe(ArrayType(ArrayType(IntegerType))), "nested array — writes through a read-out element would drop");
    assert.ok(!isBeast2LazySafe(DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) }))));
    assert.ok(!isBeast2LazySafe(DictType(IntegerType, SetType(IntegerType))));
    assert.ok(!isBeast2LazySafe(ArrayType(DictType(StringType, IntegerType))));
    assert.ok(!isBeast2LazySafe(ArrayType(StructType({ r: RefType(IntegerType) }))));
    assert.ok(!isBeast2LazySafe(ArrayType(VectorType(FloatType))), "`is()` compares vectors by identity");
    assert.ok(!isBeast2LazySafe(SetType(VectorType(FloatType))));
    assert.ok(!isBeast2LazySafe(ArrayType(FunctionType([], IntegerType))), "closures can capture mutable state");
    const TreeWithList = RecursiveType((t) => VariantType({ leaf: ArrayType(IntegerType), pair: StructType({ l: t, r: t }) }));
    assert.ok(!isBeast2LazySafe(ArrayType(TreeWithList)), "a container anywhere on the recursion is reachable");
  });

  test("non-collection roots are never lazy-eligible", () => {
    assert.ok(!isBeast2LazySafe(StringType));
    assert.ok(!isBeast2LazySafe(StructType({ a: IntegerType })));
  });
});

describe("Beast2 v5 — pages segment cache", () => {
  const RowsT = ArrayType(RowType);
  const structRows = Array.from({ length: 500 }, (_, i) => ({ id: BigInt(i), name: `r-${i}` }));

  test("element reads reuse the decoded segment; a segment the cache let go decodes fresh", () => {
    // One segment kept: a read of another lets the first go.
    const pages = openBeast2PagesFor(RowsT, { cacheBytes: 1 })(paged(RowsT, structRows));
    const a = pages.element(42);
    const b = pages.element(43);
    assert.equal(a, pages.element(42), "a re-read of the kept segment returns the cached decode");
    assert.equal((a as { id: bigint }).id, 42n);
    assert.equal((b as { id: bigint }).id, 43n);
    pages.element(142);
    const again = pages.element(42);
    assert.notEqual(again, a, "a segment let go decodes fresh");
    assert.deepEqual(again, a, "with identical content");
    const { hits, evictions, segments } = pages.cacheStats;
    assert.deepEqual([pages.segmentsDecoded, hits, evictions, segments], [3, 2, 2, 1]);
  });

  test("keyed reads reuse the decoded segment; the public segment() stays fresh", () => {
    const pages = openBeast2PagesFor(TableType)(paged(TableType, makeTable(350)));
    const v1 = pages.get(42n);
    const v2 = pages.get(42n);
    assert.equal(v1, v2, "the same cached segment serves repeated keyed reads");
    assert.equal((v1 as { name: string }).name, "row-42");
    assert.notEqual(pages.segment(0), pages.segment(0), "segment() decodes fresh so callers cannot poison the cache");
  });

  test("counts the segments it decodes and the fences it probes, a kept segment's read not among them", () => {
    const rows = openBeast2PagesFor(RowsT)(paged(RowsT, structRows));
    rows.element(42);
    rows.element(43);
    assert.equal(rows.segmentsDecoded, 1, "the second read is served by the kept segment");
    rows.segment(0);
    assert.equal(rows.segmentsDecoded, 2, "segment() decodes fresh, and counts");
    assert.equal(rows.fencesProbed, 0, "an Array read probes no fence");

    const table = openBeast2PagesFor(TableType)(paged(TableType, makeTable(350)));
    assert.equal(table.segmentCount, 4);
    table.get(42n);
    table.get(43n);
    assert.equal(table.fencesProbed, 4, "the first keyed read verifies every fence, once");
    assert.equal(table.segmentsDecoded, 1);
    assert.equal(table.fence(3), 300n);
    assert.equal(table.fencesProbed, 4, "a fence the keyed read probed is kept: asking for it again probes nothing");

    const fresh = openBeast2PagesFor(TableType)(paged(TableType, makeTable(350)));
    assert.equal(fresh.fence(2), 200n);
    assert.equal(fresh.fence(2), 200n);
    assert.equal(fresh.fencesProbed, 1, "a Dict fence is probed once and kept");
    assert.equal(fresh.get(42n)?.name, "row-42");
    assert.equal(fresh.fencesProbed, 4, "a keyed read probes only the fences not yet kept");

    // An Array's first element may be a container its caller changes, so it
    // is never kept.
    rows.fence(1);
    rows.fence(1);
    assert.equal(rows.fencesProbed, 2, "an Array's fence is probed afresh each time");
  });

  // The cache's rules, as east-c's gate holds its own pager to them
  // (test_beast2_pages_cache.c): segments of 8 elements, weighed as
  // v5/SPEC.md's "The pager's cache" says.
  const IntRows = ArrayType(IntegerType);
  const RowTable = DictType(IntegerType, StringType);
  /** An Array of 8 Integers: its Array (104), its 8 slots and its 8 Integers. */
  const ARRAY_SEGMENT = 104 + 8 * 8 + 8 * 16;
  /** A Dict of 8 Integers to "row-N": its Dict (104), its 8 entries, and 8
   *  Integer keys and 8 Strings that fit their nodes. */
  const DICT_SEGMENT = 104 + 8 * 16 + 8 * (16 + 72);
  /** 0 to n - 1 as an Array of Integers, in segments of 8. */
  const intRows = (n: number): Uint8Array => paged(IntRows, Array.from({ length: n }, (_, i) => BigInt(i)), undefined, 8);
  /** i to "row-i" for i from 0 to n - 1 as a Dict, in segments of 8. */
  const rowTable = (n: number): Uint8Array =>
    paged(RowTable, new SortedMap(Array.from({ length: n }, (_, i): [bigint, string] => [BigInt(i), `row-${i}`]), compareFor(IntegerType)), undefined, 8);

  test("keeps 256 MiB of decoded weight unless cacheBytes says otherwise, and refuses a budget that is no number of bytes", () => {
    const blob = intRows(96);
    assert.equal(openBeast2PagesFor(IntRows)(blob).cacheStats.budget, 256 * 1024 * 1024);
    assert.equal(openBeast2PagesFor(IntRows, { cacheBytes: 1 })(blob).cacheStats.budget, 1);
    for (const cacheBytes of [-1, Number.NaN]) {
      assert.throws(() => openBeast2PagesFor(IntRows, { cacheBytes })(blob), {
        name: "TypeError",
        message: `beast2 v5: cacheBytes is a decoded weight in bytes, 0 or more, not ${cacheBytes}`,
      });
    }
  });

  test("keeps the most recently used segments within its budget of decoded weight", () => {
    const pages = openBeast2PagesFor(IntRows, { cacheBytes: 3 * ARRAY_SEGMENT })(intRows(96));
    assert.equal(pages.segmentCount, 12);
    // Rows of these segments, in an order no four misses of which run in key
    // order, beside a model: the three most recently used, newest first.
    const order = [5, 0, 9, 5, 2, 11, 0, 7, 9, 3, 5, 10, 1, 9, 6, 0, 6, 11];
    const model: number[] = [];
    let misses = 0;
    let hits = 0;
    let evictions = 0;
    order.forEach((s, r) => {
      const at = model.indexOf(s);
      if (at >= 0) {
        hits++;
        model.splice(at, 1);
      } else {
        misses++;
        if (model.length === 3) {
          model.pop();
          evictions++;
        }
      }
      model.unshift(s);
      assert.equal(pages.element(s * 8 + (r % 8)), BigInt(s * 8 + (r % 8)));
    });
    const stats = pages.cacheStats;
    assert.deepEqual([pages.segmentsDecoded, stats.hits, stats.evictions, stats.droppedBehind], [misses, hits, evictions, 0]);
    assert.deepEqual([stats.segments, stats.weight, stats.peakWeight], [3, 3 * ARRAY_SEGMENT, 3 * ARRAY_SEGMENT]);
    for (const s of model) pages.element(s * 8);
    assert.deepEqual([pages.cacheStats.hits, pages.segmentsDecoded], [hits + 3, misses], "the model's segments are the ones cached");
  });

  test("keeps the newest segment, over budget, alone at a budget of 1", () => {
    const pages = openBeast2PagesFor(IntRows, { cacheBytes: 1 })(intRows(96));
    pages.element(4 * 8);
    pages.element(4 * 8);
    assert.deepEqual([pages.segmentsDecoded, pages.cacheStats.segments, pages.cacheStats.weight], [1, 1, ARRAY_SEGMENT]);
    pages.element(8 * 8);
    pages.element(4 * 8);
    assert.deepEqual([pages.segmentsDecoded, pages.cacheStats.segments], [3, 1], "segment 4 went when segment 8 came");
  });

  test("drops behind keyed reads and row reads in key order, decoding each segment once and keeping two", () => {
    const table = openBeast2PagesFor(RowTable)(rowTable(160));
    for (let k = 0; k < 160; k++) assert.equal(table.get(BigInt(k)), `row-${k}`);
    const kept = table.cacheStats;
    assert.deepEqual([table.segmentsDecoded, kept.hits, kept.droppedBehind], [20, 140, 18]);
    assert.deepEqual([kept.segments, kept.weight, kept.peakWeight], [2, 2 * DICT_SEGMENT, 3 * DICT_SEGMENT]);

    const rows = openBeast2PagesFor(IntRows)(intRows(96));
    for (let row = 0; row < 96; row++) rows.element(row);
    assert.deepEqual([rows.segmentsDecoded, rows.cacheStats.droppedBehind, rows.cacheStats.segments], [12, 10, 2]);
  });

  test("leaves a working set read at random to survive a run in key order over the same input", () => {
    // Segments 15, 2 and 7 are read first, then every key of 5 through 12. The
    // run reads 7 as a hit, skips from 6 to 8, and drops only what it decoded
    // itself: 5, 6, 8, 9 and 10.
    const pages = openBeast2PagesFor(RowTable)(rowTable(160));
    for (const s of [15, 2, 7]) pages.get(BigInt(s * 8));
    for (let k = 5 * 8; k < 13 * 8; k++) pages.get(BigInt(k));
    const after = pages.cacheStats;
    assert.deepEqual([pages.segmentsDecoded, after.droppedBehind, after.segments], [10, 5, 5]);
    for (const s of [15, 2, 7, 12]) pages.get(BigInt(s * 8 + 1));
    assert.deepEqual([pages.segmentsDecoded, pages.cacheStats.hits], [10, after.hits + 4], "the working set survived the run");
  });

  test("ends a run at a backward read: the next drops nothing until its own fourth miss", () => {
    const pages = openBeast2PagesFor(RowTable)(rowTable(160));
    for (let k = 0; k < 10 * 8; k++) pages.get(BigInt(k));
    assert.equal(pages.cacheStats.droppedBehind, 8);
    for (const s of [3, 4, 5]) pages.get(BigInt(s * 8));
    assert.deepEqual([pages.cacheStats.droppedBehind, pages.cacheStats.segments], [8, 5]);
    pages.get(BigInt(6 * 8));
    assert.deepEqual([pages.cacheStats.droppedBehind, pages.cacheStats.segments], [10, 4]);
  });

  test("lets its segments go when its lazy value is read whole, and only then", () => {
    const pages = openBeast2PagesFor(RowTable)(rowTable(32));
    pages.get(1n);
    pages.get(9n);
    assert.equal(pages.cacheStats.segments, 2);
    pages.clearCache();
    assert.deepEqual([pages.cacheStats.segments, pages.cacheStats.weight], [0, 0]);
    pages.get(1n);
    assert.deepEqual([pages.segmentsDecoded, pages.cacheStats.segments], [3, 1], "a read after is a miss");

    // A lazy value lets its pager's segments go once it holds its collection
    // whole — read whole for an operation the pager cannot serve, or cleared —
    // since every read goes to the whole collection from there.
    const cleared = mock.method(Beast2Pages.prototype, "clearCache");
    try {
      const map = openBeast2LazyFor(RowTable)(rowTable(32)) as SortedMap<bigint, string>;
      assert.equal(map.get(17n), "row-17");
      assert.equal(cleared.mock.callCount(), 0, "a keyed read keeps its segment");
      map.set(99n, "added");
      const tags = openBeast2LazyFor(SetType(StringType))(paged(SetType(StringType), ["a", "b", "c"], undefined, 1)) as SortedSet<string>;
      assert.ok(tags.has("b"));
      tags.clear();
      const rows = openBeast2LazyFor(IntRows)(intRows(32));
      assert.equal(rows[9], 9n);
      rows.push(32n);
      assert.equal(cleared.mock.callCount(), 3, "a write to the map, a clear of the set, a write to the array");
      for (const call of cleared.mock.calls) {
        const pager = call.this as Beast2Pages;
        assert.deepEqual([pager.cacheStats.segments, pager.cacheStats.weight], [0, 0]);
      }
    } finally {
      cleared.mock.restore();
    }
  });
});

describe("Beast2 v5 — what a lazy value's reads came to (beast2LazyStats)", () => {
  test("counts a Dict's segment decodes and fence probes, and weighs the whole read an operation makes", () => {
    const blob = paged(TableType, makeTable(500));
    // The gauge the whole read is weighed by: read once before it, once after.
    const readings = [1_000, 4_096];
    // One segment kept, so the reads below that cycle over five decode each
    // again.
    const lazy = openBeast2LazyFor(TableType, { resident: () => readings.shift()!, cacheBytes: 1 })(blob) as SortedMap<bigint, { id: bigint; name: string }>;
    assert.deepEqual(beast2LazyStats(lazy), { segments: 5, segmentsDecoded: 0, fencesProbed: 0, hydrated: false, hydratedBytes: 0 });

    lazy.get(42n);
    lazy.get(43n);
    assert.deepEqual(beast2LazyStats(lazy), { segments: 5, segmentsDecoded: 1, fencesProbed: 5, hydrated: false, hydratedBytes: 0 });

    // Keyed reads that cycle over more segments than the pager keeps decode
    // each again: every read but the first, of the segment kept, misses.
    for (let round = 0; round < 2; round++) {
      for (const key of [0n, 100n, 200n, 300n, 400n]) lazy.get(key);
    }
    assert.deepEqual(beast2LazyStats(lazy), { segments: 5, segmentsDecoded: 10, fencesProbed: 5, hydrated: false, hydratedBytes: 0 });
    assert.equal(readings.length, 2, "reads the pager serves weigh nothing");

    // A write is an operation the pager cannot serve: it reads the map whole,
    // a decode of each segment, and the gauge says what that added.
    lazy.set(9_999n, { id: 9_999n, name: "added" });
    assert.deepEqual(beast2LazyStats(lazy), { segments: 5, segmentsDecoded: 15, fencesProbed: 5, hydrated: true, hydratedBytes: 3_096 });
  });

  test("says an Array was read whole, adding nothing without a gauge", () => {
    const Rows = ArrayType(StringType);
    const lazy = openBeast2LazyFor(Rows)(paged(Rows, Array.from({ length: 260 }, (_, i) => `row-${i}`)));
    assert.equal(lazy[150], "row-150");
    assert.deepEqual(beast2LazyStats(lazy), { segments: 3, segmentsDecoded: 1, fencesProbed: 0, hydrated: false, hydratedBytes: 0 });
    lazy.push("appended");
    assert.deepEqual(beast2LazyStats(lazy), { segments: 3, segmentsDecoded: 4, fencesProbed: 0, hydrated: true, hydratedBytes: 0 });
  });

  test("a gauge that reads lower after the whole read adds nothing, and a clear is no whole read", () => {
    const Tags = SetType(StringType);
    const tags = new SortedSet(Array.from({ length: 150 }, (_, i) => `tag-${String(i).padStart(4, "0")}`), compareFor(StringType));
    const readings = [8_192, 4_096];
    const shrunk = openBeast2LazyFor(Tags, { resident: () => readings.shift()! })(paged(Tags, tags));
    assert.equal(shrunk.union(new SortedSet(["extra"], compareFor(StringType))).size, 151);
    assert.deepEqual(beast2LazyStats(shrunk), { segments: 2, segmentsDecoded: 2, fencesProbed: 0, hydrated: true, hydratedBytes: 0 });

    const cleared = openBeast2LazyFor(Tags)(paged(Tags, tags));
    cleared.clear();
    assert.equal(cleared.size, 0);
    assert.deepEqual(beast2LazyStats(cleared), { segments: 2, segmentsDecoded: 0, fencesProbed: 0, hydrated: false, hydratedBytes: 0 });
  });

  test("reads a Dict's and a Set's least and greatest keys once, however often they are asked for", () => {
    const table = openBeast2LazyFor(TableType)(paged(TableType, makeTable(500))) as SortedMap<bigint, { id: bigint; name: string }>;
    const Tags = SetType(StringType);
    const tags = openBeast2LazyFor(Tags)(paged(Tags, new SortedSet(
      Array.from({ length: 250 }, (_, i) => `tag-${String(i).padStart(4, "0")}`),
      compareFor(StringType),
    ))) as SortedSet<string>;
    for (let i = 0; i < 3; i++) {
      assert.equal(table.minKey(), 0n);
      assert.equal(table.maxKey(), 499n);
      assert.equal(tags.minKey(), "tag-0000");
      assert.equal(tags.maxKey(), "tag-0249");
    }
    // The least is the first fence, probed once; the greatest is the last
    // segment's last, decoded once.
    assert.deepEqual(beast2LazyStats(table), { segments: 5, segmentsDecoded: 1, fencesProbed: 1, hydrated: false, hydratedBytes: 0 });
    assert.deepEqual(beast2LazyStats(tags), { segments: 3, segmentsDecoded: 1, fencesProbed: 1, hydrated: false, hydratedBytes: 0 });
  });

  test("says nothing of a value not opened lazily", () => {
    const blob = paged(TableType, makeTable(10));
    assert.equal(beast2LazyStats(decodeBeast2For(TableType)(blob)), undefined);
    assert.equal(beast2LazyStats(["row-0"]), undefined);
    assert.equal(beast2LazyStats(42n), undefined);
    assert.equal(beast2LazyStats(null), undefined);
  });
});

describe("Beast2 v5 — negative zero keys", () => {
  // A plain JS Set or Map reads -0 as 0 and merges the two; every paged read
  // keeps them apart, as the whole-value decode and east-c do. deepStrictEqual
  // compares numbers by SameValue, so it tells -0 from 0.
  test("stay apart from zero through every paged and lazy read", () => {
    const Weights = DictType(FloatType, StringType);
    const blob = encodeBeast2PagedFor(Weights)(new SortedMap<number, string>(
      [[-0, "negative"], [0, "positive"], [1.5, "one and a half"]], compareFor(FloatType)));
    const entries = [[-0, "negative"], [0, "positive"], [1.5, "one and a half"]];
    const pages = openBeast2PagesFor(Weights)(blob);
    assert.deepEqual([...(pages.segment(0) as Map<number, string>).entries()], entries, "segment()");
    assert.deepEqual([...(pages.slice(0, 3) as Map<number, string>).entries()], entries, "slice()");
    assert.equal(pages.get(-0), "negative");
    assert.equal(pages.get(0), "positive");
    assert.deepEqual([...iterBeast2SegmentsFor(Weights)(blob)].flatMap((segment) => [...(segment as Map<number, string>).entries()]), entries, "the segment iterator");
    assert.deepEqual([...(openBeast2LazyFor(Weights)(blob) as SortedMap<number, string>).entries()], entries, "lazy iteration");

    const Floats = SetType(FloatType);
    const set = encodeBeast2PagedFor(Floats)(new SortedSet([NaN, 0, -0], compareFor(FloatType)));
    assert.deepEqual([...(openBeast2PagesFor(Floats)(set).segment(0) as Set<number>)], [-0, 0, NaN]);
    assert.deepEqual([...openBeast2LazyFor(Floats)(set)], [-0, 0, NaN]);
  });
});

describe("Beast2 v5 — lazy reads that fail", () => {
  /** An assertion that a read failed with a {@link LazyReadError} saying `message`. */
  const lazyReadError = (message: string) => (err: unknown): boolean =>
    err instanceof LazyReadError && err.message === message;

  test("a Dict read raises a LazyReadError, and a fill that fails leaves the map unread", () => {
    const high = paged(TableType, makeTable(100, 1000));
    const low = paged(TableType, makeTable(100, 0));
    const lazy = openBeast2LazyFor(TableType)(spliceBeast2([high, low]));
    const orderMessage = "beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)";

    assert.throws(() => lazy.get(1050n), lazyReadError(
      "beast2 v5: segments 0 and 1 are not disjoint ascending key ranges — the wire must hold the canonical value (corrupt or pre-contract blob)",
    ));
    assert.throws(() => [...lazy], lazyReadError(orderMessage));
    // The fill reads the high segment, then fails on the low one.
    assert.throws(() => lazy.set(5000n, { id: 5000n, name: "added" }), lazyReadError(orderMessage));
    assert.equal(lazy.size, 200, "the map is unread, not half-filled");
    assert.throws(() => lazy.set(5000n, { id: 5000n, name: "added" }), lazyReadError(orderMessage), "the next write reads again");
  });

  test("an Array whose segment cannot be read raises a LazyReadError, and a fill that fails leaves it unread", () => {
    const Rows = ArrayType(StringType);
    const rows = Array.from({ length: 260 }, (_, i) => `row-${i}`);
    const blob = paged(Rows, rows);
    const extents = readBeast2Extents(blob);
    assert.equal(extents.offsets.length, 3);
    let failing = true;
    const reader: Beast2SyncRangeReader = {
      size: blob.length,
      read(offset, length) {
        if (failing && offset >= extents.offsets[1]! && offset < extents.segmentsEnd) {
          throw new Error("EIO: the segment could not be read");
        }
        return blob.subarray(offset, offset + length);
      },
    };
    const lazy = openBeast2LazyFor(Rows)(reader);
    const ioError = lazyReadError("EIO: the segment could not be read");

    assert.equal(lazy[0], "row-0");
    assert.throws(() => lazy[150], ioError);
    assert.throws(() => [...lazy], ioError);
    // The fill reads segment 0, then fails on segment 1.
    assert.throws(() => lazy.slice(0, 2), ioError);
    assert.equal(lazy.length, 260, "the array is unread, not half-filled");

    failing = false;
    assert.deepEqual(lazy.slice(0, 2), ["row-0", "row-1"], "the next access reads again");
    assert.equal(lazy.length, 260);
    assert.equal(lazy[259], "row-259");
  });
});
