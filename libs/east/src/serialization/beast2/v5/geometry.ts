/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 byte geometry — carve and splice over canonical segments.
 *
 * A segmented v5 blob is `header · tag frame · segment frames · terminator
 * frame · index · footer`, and canonical Set/Dict segments are disjoint
 * ascending ranges, so:
 *
 * - a run of segment frames is a valid sub-collection ({@link carveBeast2}),
 * - a sequence of runs is a valid merge ({@link spliceBeast2}),
 *
 * both by byte copy — no value is decoded. {@link rebuildBeast2} re-encodes
 * decoded batches under an existing blob's exact header bytes, so a partially
 * carved segment (split mid-range at a key boundary) can be rebuilt into a
 * blob that splices cleanly against byte-copied runs of the same source.
 *
 * These are the primitives under partitioned dataflow execution: an
 * orchestrator carves a huge collection dataset into key-range partition
 * slices, runs each slice independently, and splices the output shards.
 */

import { type EastTypeValue } from "../../../type_of_type.js";
import { BufferReader, BufferWriter } from "../../binary-utils.js";
import { readTypeSection } from "./type-section.js";
import {
  MAGIC_BYTES_V5,
  readIndex,
  writeIndexAndFooter,
  readSourceMapSectionV5,
  isSegmentedRoot,
} from "./codec.js";
import { Beast2Writer } from "./stream.js";
import type { Beast2Codec } from "./frames.js";

/** The exact bytes of the root NEW tag frame and of the terminator frame:
 *  codec `none`, one logical byte, payload `0x00`. */
const TAG_OR_TERMINATOR_FRAME = new Uint8Array([0x00, 0x01, 0x01, 0x00]);

/**
 * The byte geometry of a segmented, indexed v5 blob.
 *
 * All offsets are absolute wire offsets into the blob the extents were read
 * from. The value stream occupies `[0, indexOffset)`: header sections and the
 * root tag frame in `[0, prefixEnd)`, segment frames in
 * `[prefixEnd, segmentsEnd)`, and the terminator frame in
 * `[segmentsEnd, indexOffset)`.
 */
export interface Beast2Extents {
  /** End of the header sections + root tag frame — the first segment frame
   *  starts here. */
  readonly prefixEnd: number;
  /** End of the last segment frame — the terminator frame starts here. */
  readonly segmentsEnd: number;
  /** Wire offset of the index section. */
  readonly indexOffset: number;
  /** Absolute wire offset of each segment's frame. */
  readonly offsets: readonly number[];
  /** Element count of each segment (pairs for Dict roots). */
  readonly counts: readonly number[];
  /** Sum of all segment counts. */
  readonly elementCount: number;
  /** Whether segments are independently decodable (no cross-segment
   *  aliasing) — required by both carve and splice. */
  readonly selfContained: boolean;
  /** Whether the header source-map section carries no stacks. */
  readonly sourceMapEmpty: boolean;
  /** The blob's wire root type. */
  readonly typeValue: EastTypeValue;
}

/** Reads the little-endian u64 index offset from the footer. */
function readFooterIndexOffset(data: Uint8Array): number {
  const footerStart = data.length - 16;
  let indexOffset = 0n;
  for (let i = 7; i >= 0; i--) {
    indexOffset = (indexOffset << 8n) | BigInt(data[footerStart + i]!);
  }
  return Number(indexOffset);
}

/** Whether the 4 bytes at `offset` are a tag/terminator frame. */
function isTagOrTerminatorFrame(data: Uint8Array, offset: number): boolean {
  if (offset + 4 > data.length) return false;
  for (let i = 0; i < 4; i++) {
    if (data[offset + i] !== TAG_OR_TERMINATOR_FRAME[i]) return false;
  }
  return true;
}

/**
 * Reads the byte geometry of a segmented, indexed v5 collection blob.
 *
 * Validates the parts of the container that carve and splice rely on: the v5
 * magic, a collection root, a well-formed trailing index, the root tag frame
 * directly after the header sections, segment frames contiguous from there,
 * and the terminator frame directly before the index.
 *
 * @param data - the whole blob
 * @returns the blob's {@link Beast2Extents}
 * @throws {Error} When the blob is not a v5 container, its root is not a
 *   collection, it carries no index, or the frame geometry is malformed.
 */
export function readBeast2Extents(data: Uint8Array): Beast2Extents {
  if (data.length < 8) {
    throw new Error(`Data too short for Beast2 format: ${data.length} bytes`);
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== MAGIC_BYTES_V5[i]) {
      if (i === 7 && data[i] === 0x04) {
        throw new Error(`beast2 v5: carve/splice need v5 blobs; this is a v4 container (re-encode with version 5)`);
      }
      throw new Error(`beast2 v5: not a beast2 v5 container`);
    }
  }

  const reader = new BufferReader(data, MAGIC_BYTES_V5.length);
  const { rootType } = readTypeSection(reader);
  if (!isSegmentedRoot(rootType)) {
    throw new Error(`beast2 v5: carve/splice address Array, Set or Dict roots, not ${rootType.type}`);
  }
  const sourceMap = readSourceMapSectionV5(reader);
  const frameOffset = reader.offset;

  const index = readIndex(data);
  if (!index) {
    throw new Error(`beast2 v5: blob carries no index — carve/splice need one (write with the index enabled, the default)`);
  }

  if (!isTagOrTerminatorFrame(data, frameOffset)) {
    throw new Error(`beast2 v5: root tag frame not found where expected (offset ${frameOffset})`);
  }
  const prefixEnd = frameOffset + 4;
  if (index.offsets.length > 0 && index.offsets[0] !== prefixEnd) {
    throw new Error(`beast2 v5: segments not contiguous with the header (first segment at ${index.offsets[0]}, header ends at ${prefixEnd})`);
  }

  const indexOffset = readFooterIndexOffset(data);
  const segmentsEnd = indexOffset - TAG_OR_TERMINATOR_FRAME.length;
  if (segmentsEnd < prefixEnd || !isTagOrTerminatorFrame(data, segmentsEnd)) {
    throw new Error(`beast2 v5: terminator frame not found where expected (offset ${segmentsEnd})`);
  }

  return {
    prefixEnd,
    segmentsEnd,
    indexOffset,
    offsets: index.offsets,
    counts: index.counts,
    elementCount: index.totalCount,
    selfContained: index.selfContained,
    sourceMapEmpty: sourceMap.size <= 1n,
    typeValue: rootType,
  };
}

/** The end offset of segment `i`'s frame. */
function segmentEnd(extents: Beast2Extents, i: number): number {
  return i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd;
}

/**
 * Carves a run of segments out of a blob into a standalone blob, by byte
 * copy.
 *
 * The result keeps the source's header bytes (type section and source map)
 * verbatim, copies the segment frames of `[fromSegment, toSegment)`
 * untouched, and appends a fresh terminator, index and footer. For Set/Dict
 * roots the canonical-segment contract makes any run of segments a valid
 * sub-collection; for Array roots the run is the corresponding row range.
 *
 * @param data - the source blob
 * @param fromSegment - zero-based index of the first segment to keep
 * @param toSegment - zero-based index after the last segment to keep
 * @param extents - the source's extents, when already read
 * @returns a standalone v5 blob holding exactly those segments
 * @throws {Error} When the segment range is invalid or the source is not
 *   self-contained (its segments cannot be reinterpreted independently).
 */
export function carveBeast2(data: Uint8Array, fromSegment: number, toSegment: number, extents?: Beast2Extents): Uint8Array {
  const ext = extents ?? readBeast2Extents(data);
  const n = ext.offsets.length;
  if (!Number.isInteger(fromSegment) || !Number.isInteger(toSegment) || fromSegment < 0 || toSegment < fromSegment || toSegment > n) {
    throw new Error(`beast2 v5: carve range [${fromSegment}, ${toSegment}) invalid (${n} segments)`);
  }
  if (!ext.selfContained) {
    throw new Error(`beast2 v5: blob has cross-segment aliasing — carve needs self-contained segments`);
  }

  const writer = new BufferWriter();
  writer.writeBytes(data.subarray(0, ext.prefixEnd));
  const segments: { offset: number; count: number }[] = [];
  if (toSegment > fromSegment) {
    const start = ext.offsets[fromSegment]!;
    const end = segmentEnd(ext, toSegment - 1);
    const shift = ext.prefixEnd - start;
    for (let i = fromSegment; i < toSegment; i++) {
      segments.push({ offset: ext.offsets[i]! + shift, count: ext.counts[i]! });
    }
    writer.writeBytes(data.subarray(start, end));
  }
  writer.writeBytes(TAG_OR_TERMINATOR_FRAME);
  writeIndexAndFooter(writer, segments, true);
  return writer.toUint8Array();
}

/**
 * Splices segmented blobs into one blob, by byte copy.
 *
 * The parts must share byte-identical header prefixes (same wire type
 * section and source-map section — carved and {@link rebuildBeast2}-rebuilt
 * blobs of one source qualify by construction) and be self-contained. The
 * result keeps the first part's header, concatenates every part's segment
 * frames untouched, and appends a fresh terminator, index and footer.
 *
 * For Set/Dict roots the parts' key ranges must ascend disjointly in part
 * order — that is the canonical-segment contract, and readers of the spliced
 * blob reject violations as corrupt. The splice itself never decodes a
 * value, so it cannot check the ordering; callers validate it from the parts'
 * fences when the parts are not carved from one canonical source.
 *
 * @param parts - the blobs to splice, in order
 * @returns one v5 blob holding every part's segments in part order
 * @throws {Error} When no parts are given, a part is malformed or not
 *   self-contained, or the parts' header prefixes differ.
 */
export function spliceBeast2(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 0) {
    throw new Error(`beast2 v5: splice needs at least one part`);
  }
  const extents = parts.map((part) => readBeast2Extents(part));
  const first = parts[0]!;
  const firstExt = extents[0]!;

  const writer = new BufferWriter();
  writer.writeBytes(first.subarray(0, firstExt.prefixEnd));
  const segments: { offset: number; count: number }[] = [];
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]!;
    const ext = extents[p]!;
    if (!ext.selfContained) {
      throw new Error(`beast2 v5: splice part ${p} has cross-segment aliasing — splice needs self-contained segments`);
    }
    if (ext.prefixEnd !== firstExt.prefixEnd || !bytesEqual(part, first, firstExt.prefixEnd)) {
      throw new Error(`beast2 v5: splice part ${p} has differing header sections — parts must share one wire type and source map`);
    }
    const shift = writer.size - ext.prefixEnd;
    for (let i = 0; i < ext.offsets.length; i++) {
      segments.push({ offset: ext.offsets[i]! + shift, count: ext.counts[i]! });
    }
    writer.writeBytes(part.subarray(ext.prefixEnd, ext.segmentsEnd));
  }
  writer.writeBytes(TAG_OR_TERMINATOR_FRAME);
  writeIndexAndFooter(writer, segments, true);
  return writer.toUint8Array();
}

/** Whether the first `length` bytes of `a` and `b` are identical. */
function bytesEqual(a: Uint8Array, b: Uint8Array, length: number): boolean {
  if (a.length < length || b.length < length) return false;
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Options accepted by {@link rebuildBeast2}. */
export type RebuildBeast2Options = {
  /** Per-frame codec for the re-encoded segments. Defaults to `"deflate"`. */
  codec?: Beast2Codec;
  /** The header source's extents, when already read. */
  extents?: Beast2Extents;
};

/**
 * Re-encodes decoded batches into a blob under an existing blob's exact
 * header bytes.
 *
 * Splice requires byte-identical header prefixes, and type sections are not
 * guaranteed byte-identical across independently-built encoders — so when a
 * segment must be split mid-range (a partition boundary landing inside it),
 * the split halves are rebuilt with this function against the source blob
 * itself, and the results splice cleanly with byte-copied runs of the same
 * source.
 *
 * Set/Dict batches must be internally ascending and mutually disjoint in
 * order, as for {@link Beast2Writer}; empty batches are skipped.
 *
 * @param headerSource - the blob whose header bytes (and wire type) to reuse
 * @param batches - collection values, one per segment
 * @param options - codec and pre-read extents
 * @returns a standalone v5 blob with one segment per non-empty batch
 * @throws {Error} When the header source is malformed, or a Set/Dict batch
 *   violates strict ascending (key) order.
 */
export function rebuildBeast2(headerSource: Uint8Array, batches: Iterable<unknown>, options?: RebuildBeast2Options): Uint8Array {
  const ext = options?.extents ?? readBeast2Extents(headerSource);

  // Re-parse the header's source map so re-encoded function values resolve
  // their stacks against the header section the result carries verbatim.
  const reader = new BufferReader(headerSource, MAGIC_BYTES_V5.length);
  readTypeSection(reader);
  const sourceMap = readSourceMapSectionV5(reader);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const writer = new Beast2Writer(ext.typeValue, (b) => { chunks.push(b); total += b.length; }, {
    headerPrefix: headerSource.subarray(0, ext.prefixEnd),
    sourceMap,
    ...(options?.codec !== undefined && { codec: options.codec }),
  });
  for (const batch of batches) writer.write(batch as never);
  writer.finish();

  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}
