/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reading a collection's elements from its bytes as they arrive: every
 * container a collection is written in, a segment at a time, with the limit on
 * a segment's size and the refusals that come with reading a stream.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DictType, IntegerType, SetType, StringType, StructType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap, SortedSet } from "../../../index.js";
import {
  Beast2ElementWriter,
  Beast2Writer,
  decodeBeast2ElementsFor,
  encodeBeast2For,
  encodeBeast2PagedFor,
  encodeBeast2SegmentsFor,
  readBeast2Extents,
  RUN_MAX_BYTES,
} from "../index.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(StringType, RowType);

/** Every element the reader yields, in order. */
async function readAll<T>(elements: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const element of elements) out.push(element);
  return out;
}

/** The bytes `size` at a time. */
function* chunked(bytes: Uint8Array, size: number): Generator<Uint8Array> {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

describe("decodeBeast2ElementsFor", () => {
  test("reads a Dict from each container it is written in", async () => {
    const value = new SortedMap(
      Array.from({ length: 5_000 }, (_, i): [string, { id: bigint; name: string }] => [`k${String(i).padStart(7, "0")}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const expected = [...value];
    const batches: SortedMap<string, { id: bigint; name: string }>[] = [];
    for (let i = 0; i < expected.length; i += 700) batches.push(new SortedMap(expected.slice(i, i + 700), compareFor(StringType)));
    const containers: Record<string, Uint8Array> = {
      "paged": encodeBeast2PagedFor(TableType)(value),
      "paged, uncompressed": encodeBeast2PagedFor(TableType, { codec: "none" })(value),
      "encoded whole": encodeBeast2For(TableType)(value),
      "encoded whole, with an index": encodeBeast2For(TableType, { index: true })(value),
      "batched by the writer": encodeBeast2SegmentsFor(TableType)(batches),
      "v4": encodeBeast2For(TableType, { version: 4 })(value),
    };
    for (const [name, blob] of Object.entries(containers)) {
      assert.deepEqual(await readAll(decodeBeast2ElementsFor(TableType)([blob])), expected, name);
    }
  });

  test("reads Arrays and Sets, and an empty collection", async () => {
    const rows = Array.from({ length: 3_000 }, (_, i) => ({ id: BigInt(i), name: `row-${i}` }));
    assert.deepEqual(await readAll(decodeBeast2ElementsFor(ArrayType(RowType))([encodeBeast2PagedFor(ArrayType(RowType))(rows)])), rows);
    const names = new SortedSet(Array.from({ length: 3_000 }, (_, i) => `n${String(i).padStart(5, "0")}`), compareFor(StringType));
    const setType = SetType(StringType);
    assert.deepEqual(await readAll(decodeBeast2ElementsFor(setType)([encodeBeast2For(setType)(names)])), [...names]);
    assert.deepEqual(await readAll(decodeBeast2ElementsFor(TableType)([encodeBeast2PagedFor(TableType)(new Map())])), []);
    assert.deepEqual(await readAll(decodeBeast2ElementsFor(TableType)([encodeBeast2For(TableType)(new Map())])), []);
  });

  test("hands the Writer the elements it writes the canonical blob from", async () => {
    // Whatever container the value came in, the Writer given what the reader
    // yields writes the value's canonical bytes.
    const value = new SortedMap(
      Array.from({ length: 20_000 }, (_, i): [string, { id: bigint; name: string }] => [`k${String(i).padStart(7, "0")}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const expected = encodeBeast2PagedFor(TableType)(value);
    const batches: SortedMap<string, { id: bigint; name: string }>[] = [];
    const entries = [...value];
    for (let i = 0; i < entries.length; i += 333) batches.push(new SortedMap(entries.slice(i, i + 333), compareFor(StringType)));
    for (const source of [encodeBeast2SegmentsFor(TableType)(batches), encodeBeast2For(TableType)(value), expected]) {
      const chunks: Uint8Array[] = [];
      const writer = new Beast2ElementWriter(TableType, (bytes) => chunks.push(bytes.slice()));
      for await (const element of decodeBeast2ElementsFor(TableType)([source])) writer.add(element);
      writer.finish();
      assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), expected);
    }
  });

  test("keeps the aliasing inside an element", async () => {
    // Two fields naming one array: an element's own REF, which its segment's
    // table resolves.
    const type = DictType(StringType, StructType({ a: ArrayType(IntegerType), b: ArrayType(IntegerType) }));
    const shared = [1n, 2n, 3n];
    const value = new SortedMap([["x", { a: shared, b: shared }], ["y", { a: [4n], b: [5n] }]], compareFor(StringType));
    const read = await readAll(decodeBeast2ElementsFor(type)([encodeBeast2PagedFor(type)(value)]));
    const first = read[0]![1];
    assert.deepEqual(first, { a: shared, b: shared });
    assert.equal(first.a, first.b, "the two fields are one array, as they were written");
  });

  test("reads a stream a byte at a time, and pulls it only as far as it has read", async () => {
    const value = new SortedMap(
      Array.from({ length: 20_000 }, (_, i): [string, { id: bigint; name: string }] => [`k${String(i).padStart(7, "0")}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const blob = encodeBeast2PagedFor(TableType)(value);
    assert.deepEqual(await readAll(decodeBeast2ElementsFor(TableType)(chunked(blob, 1))), [...value]);

    // The first element needs the header and the first segment's frame, and
    // nothing after them.
    const extents = readBeast2Extents(blob);
    let pulled = 0;
    const source = (function* () {
      for (const chunk of chunked(blob, 1024)) {
        pulled += chunk.length;
        yield chunk;
      }
    })();
    const elements = decodeBeast2ElementsFor(TableType)(source);
    await elements.next();
    assert.ok(pulled <= extents.offsets[1]! + 1024, `pulled ${pulled} bytes to read the first element; its segment ends at ${extents.offsets[1]}`);
    await elements.return(undefined);
  });

  test("closes the stream when the reading ends early", async () => {
    let closed = false;
    const blob = encodeBeast2PagedFor(TableType)(new SortedMap(
      Array.from({ length: 10_000 }, (_, i): [string, { id: bigint; name: string }] => [`k${String(i).padStart(7, "0")}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType)));
    const source = (async function* () {
      try {
        yield* chunked(blob, 4096);
      } finally {
        closed = true;
      }
    })();
    for await (const element of decodeBeast2ElementsFor(TableType)(source)) {
      void element;
      break;
    }
    assert.ok(closed);
  });

  test("refuses a frame larger than a collection is read in, before reading it", async () => {
    // A whole-value encode is one frame; this one declares more logical bytes
    // than the limit, and none of them follow.
    const type = ArrayType(StringType);
    const head = encodeBeast2For(type, { codec: "none" })([]);
    const header = head.subarray(0, head.length - 5);  // up to the one frame: codec, lengths, TAG_NEW, 0
    const frameHeader = new Uint8Array(21);
    let at = 0;
    const varint = (v: number): void => {
      for (; v >= 0x80; v = Math.floor(v / 128)) frameHeader[at++] = (v & 0x7f) | 0x80;
      frameHeader[at++] = v;
    };
    varint(0);
    varint(RUN_MAX_BYTES + 1);
    varint(RUN_MAX_BYTES + 1);
    await assert.rejects(
      readAll(decodeBeast2ElementsFor(type)([header, frameHeader.subarray(0, at)])),
      /holds 67108865 bytes, more than the 67108864 a collection is read in at once — write the value segmented/,
    );
  });

  test("refuses a segment that aliases a container in an earlier one", async () => {
    // A writer told not to scope its aliasing: the second batch names the
    // array the first defined.
    const type = ArrayType(ArrayType(IntegerType));
    const shared = [1n, 2n];
    const chunks: Uint8Array[] = [];
    const writer = new Beast2Writer(type, (bytes) => chunks.push(bytes.slice()), { selfContained: false });
    writer.write([shared]);
    writer.write([shared]);
    writer.finish();
    await assert.rejects(
      readAll(decodeBeast2ElementsFor(type)([new Uint8Array(Buffer.concat(chunks))])),
      /beast2 v5: segment 1: container backref delta 1 out of range/,
    );
  });

  test("refuses bytes that hold another type", async () => {
    await assert.rejects(
      readAll(decodeBeast2ElementsFor(TableType)([encodeBeast2PagedFor(ArrayType(StringType))(["a"])])),
      /the bytes hold .*Array.*, not .*Dict/,
    );
    await assert.rejects(
      readAll(decodeBeast2ElementsFor(TableType)([encodeBeast2For(ArrayType(StringType), { version: 4 })(["a"])])),
      /the bytes hold .*Array.*, not .*Dict/,
    );
  });

  test("refuses a non-collection type up front", () => {
    assert.throws(() => decodeBeast2ElementsFor(IntegerType as never), /Array, Set or Dict values, not Integer/);
  });
});
