/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A segment's rows read one at a time: each row, and each key, is its whole
 * decode's, at every type the fuzzer draws and in any order of reading; a
 * segment is held to what a whole decode holds it to, and a row to its own
 * references; and a segment that cannot be read from its bytes — a Set's, one
 * whose rows hold a function — is read through the same interface.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ArrayType, DictType, FunctionType, IntegerType, SetType, StringType, StructType,
  type EastType,
} from "../../../types.js";
import { compareFor, equalFor } from "../../../comparison.js";
import { randomStream, randomValueFor, seedFuzz } from "../../../fuzz.js";
import { East, SortedMap } from "../../../index.js";
import { SourceMap } from "../../../location.js";
import { BufferReader, BufferWriter } from "../../binary-utils.js";
import { buildPlatformContext } from "../shared.js";
import { encodeBeast2PagedFor, openBeast2PagesFor } from "../index.js";
import { asTypeValue } from "./type-section.js";
import { TAG_NEW, TAG_REF, type V5DecodeContext } from "./codec.js";
import { decodedWeightFor } from "./weight.js";
import { beast2SegmentRowsFor, buildSegmentRowsDecoder, type Beast2SegmentRows } from "./segment-rows.js";
import { randomRow, segmented } from "./segmented.spec.fixtures.js";

/** A decode context of its own, as the pager gives a segment's decoder. */
function context(): V5DecodeContext {
  return { containers: [], sourceMap: new SourceMap(), frozen: false, ...buildPlatformContext() };
}

describe("beast2 v5 a segment's rows, read one at a time", () => {
  test("each row and each key is its whole decode's, at random types, read in any order and again", () => {
    seedFuzz(0x1719);
    const draw = randomStream(0x1719);
    let read = 0;
    for (let n = 0; n < 150; n++) {
      const row = randomRow(draw);
      const kind = (["Array", "Dict", "Set"] as const)[n % 3]!;
      const root: EastType = kind === "Array" ? ArrayType(row) : kind === "Dict" ? DictType(StringType, row) : SetType(StringType);
      const rowValue = randomValueFor(row);
      const names = Array.from({ length: 14 }, (_, i) => `k${String(i).padStart(3, "0")}`);
      const rows: unknown[] = kind === "Array" ? names.map(() => rowValue()) : kind === "Dict" ? names.map((name) => [name, rowValue()]) : names;
      const pages = openBeast2PagesFor(root)(segmented(root, rows, 6));
      const rowsOf = beast2SegmentRowsFor(root);
      const sameRow = equalFor(row);
      let base = 0;
      for (let i = 0; i < pages.segmentCount; i++) {
        const segment = rowsOf(pages, i);
        const whole = rows.slice(base, base + segment.count);
        assert.equal(segment.count, Math.min(6, rows.length - base), `case ${n}, segment ${i}: its count`);
        assert.ok(segment.weight > 0);
        // Every row twice, in an order of the stream's: a read leaves nothing behind for the next.
        const order = [...whole.keys(), ...whole.keys()].sort(() => draw() - 0.5);
        for (const at of order) {
          const element = segment.element(at);
          if (kind === "Array") {
            assert.ok(sameRow(element as never, whole[at] as never), `case ${n}, segment ${i}, row ${at}`);
            assert.throws(() => segment.key(at), /an Array's rows have no keys/);
          } else if (kind === "Set") {
            assert.deepEqual([element, segment.key(at)], [whole[at], whole[at]], `case ${n}, segment ${i}, row ${at}`);
          } else {
            const [key, value] = whole[at] as [string, unknown];
            const [readKey, readValue] = element as [string, unknown];
            assert.deepEqual([readKey, segment.key(at)], [key, key], `case ${n}, segment ${i}, row ${at}: its key`);
            assert.ok(sameRow(readValue as never, value as never), `case ${n}, segment ${i}, row ${at}: its value`);
          }
          read++;
        }
        for (const outside of [-1, segment.count, 0.5]) assert.throws(() => segment.element(outside), RangeError);
        base += segment.count;
      }
      assert.equal(base, rows.length);
    }
    assert.ok(read >= 4000);
  });

  test("a row is decoded as the pager was opened: frozen, or not, and a new value each read", () => {
    const Rows = DictType(StringType, StructType({ tags: ArrayType(StringType), n: IntegerType }));
    const value = new SortedMap([["a", { tags: ["x"], n: 1n }], ["b", { tags: ["y", "z"], n: 2n }]], compareFor(StringType));
    const bytes = encodeBeast2PagedFor(Rows)(value as never);
    const rowsOf = beast2SegmentRowsFor(Rows);
    const frozen = rowsOf(openBeast2PagesFor(Rows, { frozen: true })(bytes), 0).element(1) as [string, { tags: string[] }];
    assert.ok(Object.isFrozen(frozen[1]) && Object.isFrozen(frozen[1].tags));
    const plain = rowsOf(openBeast2PagesFor(Rows)(bytes), 0);
    const first = plain.element(1) as [string, { tags: string[] }];
    assert.ok(!Object.isFrozen(first[1]));
    assert.ok(plain.element(1) !== first && (plain.element(1) as typeof first)[1] !== first[1], "each read builds its own");
    assert.deepEqual(first, ["b", { tags: ["y", "z"], n: 2n }]);
  });

  test("rows read from the bytes weigh the bytes; a Set's, and rows that hold a function, are decoded whole and weigh their decode", () => {
    const Row = StructType({ id: IntegerType, notes: StringType });
    const Rows = ArrayType(Row);
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: BigInt(i), notes: "n".repeat(200) }));
    const bytes = segmented(Rows, rows, 40);
    const read = beast2SegmentRowsFor(Rows)(openBeast2PagesFor(Rows)(bytes), 0);
    const decoded = decodedWeightFor(asTypeValue(Rows))(rows);
    // 40 rows of a varint and a 200-character string, and where each starts.
    assert.equal(read.weight, 1 + 40 * (1 + 2 + 200) + 4 * 41);
    assert.ok(read.weight < decoded, `${read.weight} bytes kept, where its decode weighs ${decoded}`);

    const Names = SetType(StringType);
    const names = rows.map((row) => `name-${String(row.id).padStart(2, "0")}`);
    const set = beast2SegmentRowsFor(Names)(openBeast2PagesFor(Names)(segmented(Names, names, 40)), 0);
    assert.deepEqual([set.count, set.key(7), set.element(39)], [40, "name-07", "name-39"]);
    assert.ok(set.weight >= decodedWeightFor(asTypeValue(Names))(new Set(names)));

    const Called = ArrayType(StructType({ id: IntegerType, run: FunctionType([], IntegerType) }));
    assert.throws(() => buildSegmentRowsDecoder(asTypeValue(Called)), TypeError);
    assert.throws(() => buildSegmentRowsDecoder(asTypeValue(Names)), TypeError);
    const called = rows.slice(0, 3).map((row) => ({ id: row.id, run: East.compile(East.function([], IntegerType, ($) => $.return(row.id)), []) }));
    const whole = beast2SegmentRowsFor(Called)(openBeast2PagesFor(Called)(segmented(Called, called, 3)), 0);
    assert.deepEqual([whole.count, (whole.element(2) as { id: bigint }).id], [3, 2n]);
    assert.throws(() => whole.element(3), RangeError);
    assert.throws(() => beast2SegmentRowsFor(StructType({ id: IntegerType })), TypeError);
  });
});

describe("beast2 v5 what a walk of a segment's rows refuses", () => {
  const Row = StructType({ items: ArrayType(IntegerType), n: IntegerType });

  /** The bytes of a row whose `items` is a new array of `items`. */
  function own(out: BufferWriter, items: bigint[], n: bigint): void {
    out.writeUint8(TAG_NEW);
    if (items.length > 0) {
      out.writeVarint(items.length);
      for (const item of items) out.writeZigzag(item);
    }
    out.writeVarint(0);
    out.writeZigzag(n);
  }

  /** The bytes of a row whose `items` is a reference `delta` definitions back. */
  function referring(out: BufferWriter, delta: number, n: bigint): void {
    out.writeUint8(TAG_REF);
    out.writeVarint(delta);
    out.writeZigzag(n);
  }

  /** Walks hand-made bytes of `n` rows of an Array of `Row`. */
  function walk(bytes: Uint8Array, n: number): Beast2SegmentRows {
    return buildSegmentRowsDecoder(asTypeValue(ArrayType(Row)))(new BufferReader(bytes, 0), context(), n) as Beast2SegmentRows;
  }

  test("rows that each hold their own containers are read", () => {
    const out = new BufferWriter();
    own(out, [1n, 2n, 3n], 0n);
    own(out, [], 1n);
    const rows = walk(out.pop(), 2);
    assert.deepEqual([rows.element(1), rows.element(0)], [{ items: [], n: 1n }, { items: [1n, 2n, 3n], n: 0n }]);
  });

  test("a row that names a container of the row before it is refused: it could not decode alone", () => {
    const out = new BufferWriter();
    own(out, [1n, 2n, 3n], 0n);
    referring(out, 1, 1n);
    assert.throws(() => walk(out.pop(), 2), /container backref delta 1 out of range \(0 definitions visible\)/);
  });

  test("a Dict's keys that do not ascend are refused, across the rows and from the segment before", () => {
    const Counts = asTypeValue(DictType(IntegerType, IntegerType));
    const bytes = (keys: bigint[]): BufferReader => {
      const out = new BufferWriter();
      for (const key of keys) {
        out.writeZigzag(key);
        out.writeZigzag(key * 10n);
      }
      return new BufferReader(out.pop(), 0);
    };
    const decode = buildSegmentRowsDecoder(Counts);
    const ascending = decode(bytes([1n, 2n, 5n]), context(), 3, { prev: undefined, has: false }) as Beast2SegmentRows;
    assert.deepEqual([ascending.key(2), ascending.element(1)], [5n, [2n, 20n]]);
    assert.throws(() => decode(bytes([1n, 5n, 2n]), context(), 3, { prev: undefined, has: false }), /not strictly ascending/);
    assert.throws(() => decode(bytes([1n, 1n]), context(), 2, { prev: undefined, has: false }), /not strictly ascending/);
    assert.throws(() => decode(bytes([3n, 4n]), context(), 2, { prev: 3n, has: true }), /not strictly ascending/);
  });
});
