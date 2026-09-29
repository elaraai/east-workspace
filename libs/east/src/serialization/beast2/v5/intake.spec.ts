/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The intake, held to the Writer: a delivery comes out as the directory the
 * Writer writes for the value it holds, however it was cut, framed or encoded,
 * and a delivery no reader reads is refused in the words every runner uses.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DictType, FloatType, FunctionType, IntegerType, SetType, StringType, type EastType } from "../../../types.js";
import { toEastTypeValue } from "../../../type_of_type.js";
import { SortedMap } from "../../../containers/sortedmap.js";
import { SortedSet } from "../../../containers/sortedset.js";
import { compareFor } from "../../../comparison.js";
import { BufferWriter } from "../../binary-utils.js";
import { encodeBeast2For } from "../index.js";
import { writeIndexAndFooter } from "./codec.js";
import { writeFrame } from "./frames.js";
import { TAG_OR_TERMINATOR_FRAME } from "./range.js";
import { readBeast2Extents } from "./geometry.js";
import { Beast2ElementWriter, elementEncoderFor, encodeBeast2PagedFor, encodeBeast2SegmentsFor } from "./stream.js";
import { Beast2ManifestWriter } from "./manifest-writer.js";
import { decodeCollectionManifest } from "./manifest.js";
import { RUN_MAX_BYTES } from "./runs.js";
import { Beast2IntakeError, intakeBeast2For, type Beast2IntakeOptions } from "./intake.js";

/** A manifest directory: the manifest, and the objects it names. */
type Directory = { manifest: Uint8Array | null; objects: Map<string, Uint8Array> };

/** The directory the Writer writes for a collection's elements. */
function writersDirectory(type: EastType, elements: Iterable<unknown>): Directory {
  const directory: Directory = { manifest: null, objects: new Map() };
  const writer = new Beast2ManifestWriter(type, {
    object: (hash, bytes) => { directory.objects.set(hash, bytes); },
    manifest: (bytes) => { directory.manifest = bytes; },
  });
  for (const element of elements) writer.add(element as never);
  writer.finish();
  return directory;
}

/** A delivery taken in: its directory and what the intake came to. */
function take(type: EastType, delivery: Uint8Array, options?: Beast2IntakeOptions): Directory & { rows: number; segments: number; rewritten: number } {
  const directory: Directory = { manifest: null, objects: new Map() };
  const stats = intakeBeast2For(type)({ size: delivery.length, read: (offset, length) => delivery.subarray(offset, offset + length) }, {
    object: (hash, bytes) => { directory.objects.set(hash, bytes); },
    manifest: (bytes) => { directory.manifest = bytes; },
  }, options);
  return { ...directory, ...stats };
}

/** Asserts a delivery is refused with exactly `message`, having written no
 *  manifest. */
function refused(type: EastType, delivery: Uint8Array, message: string, options?: Beast2IntakeOptions): void {
  let manifest: Uint8Array | null = null;
  assert.throws(
    () => intakeBeast2For(type)({ size: delivery.length, read: (offset, length) => delivery.subarray(offset, offset + length) }, {
      object: () => {},
      manifest: (bytes) => { manifest = bytes; },
    }, options),
    (err: unknown) => err instanceof Beast2IntakeError && err.message === message,
  );
  assert.equal(manifest, null, "a refused delivery writes no manifest");
}

/** A collection's elements, each in its canonical bytes. */
function rowsOf(type: EastType, elements: Iterable<unknown>): Uint8Array[] {
  const encode = elementEncoderFor(toEastTypeValue(type), null);
  const writer = new BufferWriter();
  return [...elements].map((element) => {
    writer.pop();
    encode(element, writer);
    return writer.toUint8Array().slice();
  });
}

/** Bytes written with a writer's own calls. */
function bytesOf(write: (writer: BufferWriter) => void): Uint8Array {
  const writer = new BufferWriter();
  write(writer);
  return writer.toUint8Array().slice();
}

/**
 * A v5 blob of `type` whose segments hold the given rows as bytes — the
 * Writer's or not — each segment its own uncompressed frame, under the
 * Writer's header, with an index.
 */
function blobOf(type: EastType, segments: readonly (readonly Uint8Array[])[]): Uint8Array {
  const out = new BufferWriter();
  out.writeBytes(new Beast2ElementWriter(type, { segment: () => {} }).header);
  const index: { offset: number; count: number }[] = [];
  for (const rows of segments) {
    const logical = new BufferWriter();
    logical.writeVarint(rows.length);
    for (const row of rows) logical.writeBytes(row);
    index.push({ offset: out.size, count: rows.length });
    writeFrame(out, logical.toUint8Array(), "none");
  }
  out.writeBytes(TAG_OR_TERMINATOR_FRAME);
  writeIndexAndFooter(out, index, true);
  return out.toUint8Array().slice();
}

const Table = DictType(StringType, IntegerType);
const table = new SortedMap(Array.from({ length: 20_000 }, (_, i) => [`k${String(i).padStart(7, "0")}`, BigInt(i)] as [string, bigint]), compareFor(StringType));

describe("intakeBeast2For", () => {
  test("takes a delivery the Writer wrote in as the Writer's directory, carrying every row", () => {
    const taken = take(Table, encodeBeast2PagedFor(Table)(table));
    assert.deepEqual({ manifest: taken.manifest, objects: taken.objects }, writersDirectory(Table, table.entries()));
    assert.equal(taken.rows, table.size);
    assert.equal(taken.rewritten, 0, "no segment is read and written again");
  });

  test("cuts a delivery batched by count where the rule cuts it", () => {
    const Wide = ArrayType(StringType);
    const rows = Array.from({ length: 6_000 }, (_, i) => `${i}:`.padEnd(900, "x"));
    const batches = Array.from({ length: 6 }, (_, b) => rows.slice(b * 1_000, (b + 1) * 1_000));
    const taken = take(Wide, encodeBeast2SegmentsFor(Wide)(batches));
    assert.deepEqual({ manifest: taken.manifest, objects: taken.objects }, writersDirectory(Wide, rows));
    assert.equal(taken.segments, 6);
    assert.equal(taken.rewritten, 0);
    assert.notDeepEqual(decodeCollectionManifest(taken.manifest!).entries.map((entry) => Number(entry.count)), batches.map((batch) => batch.length),
      "the rule cuts elsewhere than the batches");
  });

  test("reads a segment the Writer would write otherwise and writes it again, carrying the rest", () => {
    const Nested = ArrayType(ArrayType(IntegerType));
    const canonical = rowsOf(Nested, [[1n, 2n], [3n]]);
    const loose = [
      // [1, 2] in two runs.
      new Uint8Array([0x00, 0x01, 0x02, 0x01, 0x04, 0x00]),
      // An alias to the row before: [1, 2] again.
      new Uint8Array([0x01, 0x01]),
      // [3], its length padded.
      new Uint8Array([0x00, 0x81, 0x00, 0x06, 0x00]),
    ];
    const taken = take(Nested, blobOf(Nested, [canonical, loose]));
    assert.deepEqual({ manifest: taken.manifest, objects: taken.objects }, writersDirectory(Nested, [[1n, 2n], [3n], [1n, 2n], [1n, 2n], [3n]]));
    assert.equal(taken.segments, 2);
    assert.equal(taken.rewritten, 1, "only the second segment is written again");
  });

  test("writes the negative NaN the decoder reads as the NaN the Writer writes", () => {
    const Floats = ArrayType(FloatType);
    const taken = take(Floats, blobOf(Floats, [[new Uint8Array([0, 0, 0, 0, 0, 0, 0xf8, 0xff])]]));
    assert.deepEqual({ manifest: taken.manifest, objects: taken.objects }, writersDirectory(Floats, [NaN]));
  });

  test("takes a piece of a delivery by its index", () => {
    const blob = encodeBeast2PagedFor(Table)(table);
    const extents = readBeast2Extents(blob);
    assert.ok(extents.offsets.length >= 4, "the delivery has segments to piece");
    const entries = [...table.entries()];
    const starts = [0, ...extents.counts.map((_, i) => extents.counts.slice(0, i + 1).reduce((a, b) => a + b, 0))];
    for (const [from, to] of [[0, 2], [2, extents.offsets.length], [1, 2]] as const) {
      const taken = take(Table, blob, { segments: { from, to } });
      assert.deepEqual({ manifest: taken.manifest, objects: taken.objects }, writersDirectory(Table, entries.slice(starts[from], starts[to])), `segments [${from}, ${to})`);
      assert.equal(taken.segments, to - from);
    }
  });

  test("takes a version 4 delivery in whole", () => {
    const Names = SetType(StringType);
    const names = new SortedSet(["pear", "apple", "fig"], compareFor(StringType));
    const taken = take(Names, encodeBeast2For(Names, { version: 4 })(names));
    assert.deepEqual({ manifest: taken.manifest, objects: taken.objects }, writersDirectory(Names, names));
    assert.equal(taken.rewritten, 1);
  });

  test("takes an empty delivery in as the empty collection", () => {
    const empty = new SortedMap<string, bigint>(undefined, compareFor(StringType));
    for (const blob of [encodeBeast2PagedFor(Table)(empty), encodeBeast2For(Table)(empty)]) {
      const taken = take(Table, blob);
      assert.deepEqual({ manifest: taken.manifest, objects: taken.objects }, writersDirectory(Table, []));
      assert.equal(taken.rows, 0);
    }
  });

  test("refuses keys that do not ascend, within a segment and across segments", () => {
    const Names = SetType(StringType);
    refused(Names, blobOf(Names, [rowsOf(Names, ["b"]), rowsOf(Names, ["a"])]),
      `intake: the delivery's Set elements must ascend strictly in East order, and "a" follows "b"`);
    refused(Table, blobOf(Table, [rowsOf(Table, [["a", 1n], ["a", 2n]])]),
      `intake: the delivery's Dict keys must ascend strictly in East order, and "a" follows "a"`);
  });

  test("refuses a segment with a row that does not decode, naming what is wrong with it", () => {
    const Names = ArrayType(StringType);
    refused(Names, blobOf(Names, [rowsOf(Names, ["ok"]), [new Uint8Array([0x01, 0x80])]]),
      "intake: segment 1 of the delivery holds a row that does not decode: a String is not well-formed UTF-8");
    refused(ArrayType(ArrayType(IntegerType)), blobOf(ArrayType(ArrayType(IntegerType)), [[new Uint8Array([0x01, 0x01])]]),
      "intake: segment 0 of the delivery holds a row that does not decode: a container alias reaches outside its segment");
  });

  test("refuses a segment larger than one is read in, before reading it", () => {
    const Names = ArrayType(StringType);
    const head = new Beast2ElementWriter(Names, { segment: () => {} }).header;
    const blob = new Uint8Array([...head, ...bytesOf((w) => { w.writeVarint(1); w.writeVarint(RUN_MAX_BYTES + 1); w.writeVarint(1); w.writeUint8(0); })]);
    refused(Names, blob,
      `intake: segment 0 of the delivery, at offset ${head.length}, holds ${RUN_MAX_BYTES + 1} bytes, more than the ${RUN_MAX_BYTES} a segment is read in — ` +
      "write it again with a current Writer, whose segments stay under 8388608 bytes: it was encoded whole, or cut by an older Writer that bounded a segment by its element count alone");
  });

  test("refuses a delivery that is not a collection of the declared type", () => {
    refused(Table, new Uint8Array([1, 2, 3]), "intake: the delivery is not a beast2 blob of version 4 or 5");
    const other = encodeBeast2PagedFor(ArrayType(IntegerType))([1n, 2n]);
    assert.throws(() => take(ArrayType(StringType), other), (err: unknown) => err instanceof Beast2IntakeError && /^intake: the delivery holds .*, not .*$/.test(err.message));
    const paged = encodeBeast2PagedFor(Table)(table);
    const cut = Math.floor(paged.length / 2);
    const extents = readBeast2Extents(paged);
    const torn = extents.offsets.findIndex((_, i) => (i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd) > cut);
    refused(Table, paged.subarray(0, cut), `intake: segment ${torn} of the delivery is malformed: its frame runs past the end of the delivery`);
  });

  test("refuses a range it cannot take", () => {
    const paged = encodeBeast2PagedFor(Table)(table);
    const segments = readBeast2Extents(paged).offsets.length;
    refused(Table, paged, `intake: segments [0, ${segments + 1}) are not a range of the delivery's ${segments}`, { segments: { from: 0, to: segments + 1 } });
    refused(Table, encodeBeast2For(Table)(table), "intake: the delivery has no index, so it has no segments to take a range of", { segments: { from: 0, to: 1 } });
    refused(Table, encodeBeast2For(Table, { version: 4 })(table), "intake: the delivery is a version 4 blob, which has no segments to take a range of", { segments: { from: 0, to: 1 } });
  });

  test("refuses a declared type no delivery is", () => {
    assert.throws(() => intakeBeast2For(IntegerType as never), (err: unknown) => err instanceof Beast2IntakeError && err.message === "intake: a delivery is an Array, Set or Dict, not Integer");
    assert.throws(() => intakeBeast2For(ArrayType(FunctionType([], IntegerType))),
      (err: unknown) => err instanceof Beast2IntakeError && err.message === "intake: the declared type holds a function, which a delivery does not carry");
  });
});
