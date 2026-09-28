/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Writer check, held to both sides: a blob the Writer wrote is proved
 * segment by segment, its frames exactly the bytes it holds; and whatever the
 * Writer would not have written — a writer's own batches, frames deflated
 * another way, aliasing across segments, a segment the rule would cut, one past
 * its bounds — is refused, so the caller reads it as foreign.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, BlobType, DictType, IntegerType, SetType, StringType, StructType, type EastType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap, SortedSet } from "../../../index.js";
import { BufferWriter } from "../../binary-utils.js";
import {
  Beast2NotWritersError,
  Beast2Writer,
  RUN_MAX_BYTES,
  carveBeast2,
  checkBeast2WriterSegmentsFor,
  configureFramePool,
  encodeBeast2FenceFor,
  encodeBeast2PagedFor,
  encodeBeast2SegmentsFor,
  openBeast2PagesFor,
  readBeast2Extents,
  segmentKeyTypeOf,
  spliceBeast2,
  type Beast2WriterSegment,
} from "../index.js";
import { CODEC_DEFLATE, FRAME_HEADER_MAX } from "./frames.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(StringType, RowType);
const RowsType = ArrayType(RowType);
const NamesType = SetType(StringType);

type Row = { id: bigint; name: string };

const key = (i: number): string => `k${String(i).padStart(7, "0")}`;
const table = (n: number): SortedMap<string, Row> =>
  new SortedMap(Array.from({ length: n }, (_, i): [string, Row] => [key(i), { id: BigInt(i), name: `row-${i}` }]), compareFor(StringType));

/** Every segment the check yields for a blob, read from it in memory. */
async function checkAll(type: EastType, blob: Uint8Array): Promise<Beast2WriterSegment[]> {
  const extents = readBeast2Extents({ size: blob.length, read: (offset, length) => blob.subarray(offset, offset + length) });
  const out: Beast2WriterSegment[] = [];
  for await (const segment of checkBeast2WriterSegmentsFor(type)(extents, async (offset, length) => blob.subarray(offset, offset + length))) {
    out.push(segment);
  }
  return out;
}

/** A check's segments, held to the blob they came from: in order, each the
 *  bytes the blob holds for it, with its count and fence. */
function assertProved(type: EastType, blob: Uint8Array, segments: Beast2WriterSegment[]): void {
  const extents = readBeast2Extents(blob);
  assert.equal(segments.length, extents.offsets.length, "every segment is proved");
  const keyType = segmentKeyTypeOf(type);
  const fenceOf = keyType === null ? null : encodeBeast2FenceFor(keyType);
  segments.forEach((segment, i) => {
    const end = i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd;
    assert.equal(segment.index, i);
    assert.deepEqual(segment.frame, blob.subarray(extents.offsets[i]!, end), `segment ${i}'s frame is the blob's`);
    assert.equal(segment.count, extents.counts[i]);
    const carved = carveBeast2(blob, i, i + 1, extents);
    assert.deepEqual(segment.fence, fenceOf === null ? new Uint8Array(0) : fenceOf(openBeast2PagesFor(type)(carved).fence(0)), `segment ${i}'s fence`);
  });
  // The carved segments splice back into the blob, byte for byte.
  assert.deepEqual(spliceBeast2(segments.map((_, i) => carveBeast2(blob, i, i + 1, extents))), blob);
}

describe("checkBeast2WriterSegmentsFor", () => {
  test("proves a Dict, an Array and a Set the Writer wrote, segment by segment", async () => {
    const dict = encodeBeast2PagedFor(TableType)(table(20_000));
    assertProved(TableType, dict, await checkAll(TableType, dict));

    const rows = encodeBeast2PagedFor(RowsType)(Array.from({ length: 20_000 }, (_, i) => ({ id: BigInt(i), name: `row-${i % 97}` })));
    assertProved(RowsType, rows, await checkAll(RowsType, rows));

    const names = encodeBeast2PagedFor(NamesType)(new SortedSet(Array.from({ length: 9_000 }, (_, i) => key(i)), compareFor(StringType)));
    assertProved(NamesType, names, await checkAll(NamesType, names));
  });

  test("proves an empty collection, and one of a single segment", async () => {
    assert.deepEqual(await checkAll(TableType, encodeBeast2PagedFor(TableType)(new Map())), []);
    const one = encodeBeast2PagedFor(TableType)(table(10));
    assertProved(TableType, one, await checkAll(TableType, one));
  });

  test("proves the same with frames built on the frame pool and on this thread", async () => {
    const blob = encodeBeast2PagedFor(TableType)(table(30_000));
    const pooled = await checkAll(TableType, blob);
    const previous = configureFramePool({ workers: 1 });
    try {
      assert.deepEqual(await checkAll(TableType, blob), pooled);
    } finally {
      configureFramePool({ workers: previous.workers });
    }
  });

  test("refuses segments a writer batched", async () => {
    const entries = [...table(20_000)];
    const batches: SortedMap<string, Row>[] = [];
    for (let i = 0; i < entries.length; i += 333) batches.push(new SortedMap(entries.slice(i, i + 333), compareFor(StringType)));
    await assert.rejects(checkAll(TableType, encodeBeast2SegmentsFor(TableType)(batches)), Beast2NotWritersError);
  });

  test("refuses frames the Writer would have deflated", async () => {
    await assert.rejects(
      checkAll(TableType, encodeBeast2PagedFor(TableType, { codec: "none" })(table(20_000))),
      /segment 0's frame is not the Writer's deflate of its bytes/,
    );
  });

  test("refuses segments that alias one another", async () => {
    const type = ArrayType(ArrayType(IntegerType));
    const shared = [1n, 2n];
    const chunks: Uint8Array[] = [];
    const writer = new Beast2Writer(type, (bytes) => chunks.push(bytes.slice()), { selfContained: false, index: true });
    writer.write([shared]);
    writer.write([shared]);
    writer.finish();
    await assert.rejects(checkAll(type, new Uint8Array(Buffer.concat(chunks))), /the blob's segments alias one another/);
  });

  test("refuses a last segment the rule would have cut", async () => {
    // One batch of narrow rows the rule cuts into several segments: nothing
    // follows the one segment to test where it ends, so its elements are
    // walked.
    const blob = encodeBeast2SegmentsFor(TableType)([table(4_000)]);
    await assert.rejects(checkAll(TableType, blob), /the cut rule starts a segment inside the last segment, at its element \d+/);
  });

  test("refuses a segment of several elements past the rule's bytes", async () => {
    const type = ArrayType(BlobType);
    const wide = Array.from({ length: 20 }, (_, i) => new Uint8Array(512 * 1024).fill(i));
    const blob = encodeBeast2SegmentsFor(type)([wide, [new Uint8Array([1])]]);
    await assert.rejects(checkAll(type, blob), /segment 0 holds 20 elements in \d+ bytes, past the cut rule's bounds/);
  });

  test("refuses a segment larger than a collection is read in at once, before it reads or inflates it", async () => {
    const blob = encodeBeast2PagedFor(TableType)(table(10));
    const extents = readBeast2Extents({ size: blob.length, read: (offset, length) => blob.subarray(offset, offset + length) });
    const check = checkBeast2WriterSegmentsFor(TableType);

    // A frame longer than that is never read.
    const reads: number[] = [];
    const long = check({ ...extents, segmentsEnd: extents.offsets[0]! + RUN_MAX_BYTES + FRAME_HEADER_MAX + 1 }, async (offset, length) => {
      reads.push(length);
      return blob.subarray(offset, offset + length);
    });
    await assert.rejects(
      (async () => { for await (const segment of long) void segment; })(),
      /segment 0's frame is \d+ bytes, more than a segment is read in at once/,
    );
    assert.deepEqual(reads, []);

    // A short frame whose header declares more than that is never inflated: its
    // payload is no deflate stream, which inflating would have found.
    const frame = new BufferWriter();
    frame.writeVarint(CODEC_DEFLATE);
    frame.writeVarint(RUN_MAX_BYTES + 1);
    frame.writeVarint(4);
    frame.writeBytes(new Uint8Array(4));
    const bytes = frame.toUint8Array();
    const declared = check({ ...extents, offsets: [0], counts: [1], segmentsEnd: bytes.length }, async (offset, length) => bytes.subarray(offset, offset + length));
    await assert.rejects(
      (async () => { for await (const segment of declared) void segment; })(),
      new RegExp(`segment 0 holds ${RUN_MAX_BYTES + 1} bytes, more than the ${RUN_MAX_BYTES} a segment is read in at once`),
    );
  });

  test("refuses a blob of another type", async () => {
    await assert.rejects(checkAll(TableType, encodeBeast2PagedFor(RowsType)([{ id: 1n, name: "a" }])), /the blob holds another type/);
  });

  test("leaves a short read its own error, not a verdict", async () => {
    const blob = encodeBeast2PagedFor(TableType)(table(5_000));
    const extents = readBeast2Extents({ size: blob.length, read: (offset, length) => blob.subarray(offset, offset + length) });
    const check = checkBeast2WriterSegmentsFor(TableType)(extents, async (offset, length) => blob.subarray(offset, offset + length - 1));
    await assert.rejects(
      (async () => { for await (const segment of check) void segment; })(),
      (err: unknown) => err instanceof Error && !(err instanceof Beast2NotWritersError) && /returned \d+ of its \d+ bytes/.test(err.message),
    );
  });

  test("refuses a non-collection type up front", () => {
    assert.throws(() => checkBeast2WriterSegmentsFor(IntegerType as never), /Array, Set or Dict values, not Integer/);
  });
});
