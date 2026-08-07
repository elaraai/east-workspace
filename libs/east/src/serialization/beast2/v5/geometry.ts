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
  FOOTER_MAGIC_V5,
  INDEX_FLAG_SELF_CONTAINED,
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

/**
 * Ranged access to an immutable blob: its total byte size plus positional
 * reads.
 *
 * The blob is content-addressed and its size known up front, so callers only
 * ever request ranges inside `[0, size)` and `read` must return exactly the
 * requested bytes. Backed by anything that can serve byte ranges — a file
 * descriptor, an HTTP range request, an S3 ranged GET.
 */
export interface Beast2RangeReader {
  /** Total blob size in bytes. */
  readonly size: number;
  /**
   * Reads `length` bytes at absolute wire offset `offset`.
   *
   * @param offset - absolute byte offset into the blob
   * @param length - number of bytes to read
   * @returns exactly the requested bytes
   */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** Options accepted by {@link readBeast2ExtentsRanged}. */
export type ReadBeast2ExtentsRangedOptions = {
  /** Initial tail-probe size in bytes (default 64 KiB). When the index
   *  section is larger than the probe, one further tail read fetches the
   *  rest — the probe only tunes how often that second read happens. */
  tailProbeBytes?: number;
};

/**
 * A blob's {@link Beast2Extents} read via ranged access, plus the header
 * bytes {@link carveBeast2Ranged} reuses.
 *
 * Everything a paged reader needs to serve any window of the blob without
 * ever buffering it whole: the segment geometry addresses the frame byte
 * ranges, and `head` carries the header sections a window blob is assembled
 * under.
 */
export interface Beast2RangedExtents extends Beast2Extents {
  /** Total blob size in bytes. */
  readonly size: number;
  /** Bytes `[0, prefixEnd)` — the header sections and the root tag frame. */
  readonly head: Uint8Array;
}

/** Parses the u64 little-endian index offset from 8 bytes at `at`. */
function readU64LE(data: Uint8Array, at: number): number {
  let value = 0n;
  for (let i = 7; i >= 0; i--) {
    value = (value << 8n) | BigInt(data[at + i]!);
  }
  return Number(value);
}

/**
 * Reads the byte geometry of a segmented, indexed v5 collection blob through
 * ranged access — the footer and index from a tail read, the header sections
 * from a head read — without ever buffering the blob whole.
 *
 * The result carries everything {@link carveBeast2Ranged} needs to assemble
 * a standalone blob for any segment span whose frame bytes are then the only
 * further reads: total I/O for a window is O(header + index + window), not
 * O(blob).
 *
 * @param reader - ranged access to the blob
 * @param options - tail-probe tuning
 * @returns the blob's {@link Beast2RangedExtents}
 * @throws {Error} When the blob is not a v5 container, its root is not a
 *   collection, it carries no index, or the frame geometry is malformed —
 *   the same conditions {@link readBeast2Extents} rejects.
 */
export async function readBeast2ExtentsRanged(reader: Beast2RangeReader, options?: ReadBeast2ExtentsRangedOptions): Promise<Beast2RangedExtents> {
  const size = reader.size;
  if (size < MAGIC_BYTES_V5.length + 16) {
    throw new Error(`Data too short for Beast2 format: ${size} bytes`);
  }

  // Tail: footer first, then the index section (one further read when the
  // probe missed its start).
  const probe = Math.min(size, Math.max(options?.tailProbeBytes ?? 64 * 1024, 16));
  let tailStart = size - probe;
  let tail = await reader.read(tailStart, size - tailStart);
  const footerStart = size - 16;
  for (let i = 0; i < 8; i++) {
    if (tail[footerStart + 8 + i - tailStart] !== FOOTER_MAGIC_V5[i]) {
      throw new Error(`beast2 v5: blob carries no index — ranged reads need one (write with the index enabled, the default)`);
    }
  }
  const indexOffset = readU64LE(tail, footerStart - tailStart);
  if (indexOffset < MAGIC_BYTES_V5.length || indexOffset >= footerStart) {
    throw new Error(`beast2 v5: footer index offset ${indexOffset} out of range`);
  }
  const segmentsEnd = indexOffset - TAG_OR_TERMINATOR_FRAME.length;
  if (segmentsEnd < tailStart) {
    tailStart = segmentsEnd;
    tail = await reader.read(tailStart, size - tailStart);
  }

  // Index section — the same wire shape readIndex parses from a whole blob.
  const indexReader = new BufferReader(tail, indexOffset - tailStart);
  const flags = indexReader.readVarint();
  if ((flags & ~INDEX_FLAG_SELF_CONTAINED) !== 0) {
    throw new Error(`beast2 v5: unknown index flags 0x${flags.toString(16)}`);
  }
  const segmentCount = indexReader.readVarint();
  const offsets: number[] = new Array(segmentCount);
  const counts: number[] = new Array(segmentCount);
  let prev = 0;
  let elementCount = 0;
  for (let i = 0; i < segmentCount; i++) {
    prev += indexReader.readVarint();
    offsets[i] = prev;
    counts[i] = indexReader.readVarint();
    elementCount += counts[i]!;
    if (prev >= indexOffset) {
      throw new Error(`beast2 v5: index segment offset ${prev} overlaps the index section`);
    }
  }
  if (indexReader.offset !== footerStart - tailStart) {
    throw new Error(`beast2 v5: index section size mismatch (ends at ${indexReader.offset + tailStart}, footer at ${footerStart})`);
  }

  if (!isTagOrTerminatorFrame(tail, segmentsEnd - tailStart)) {
    throw new Error(`beast2 v5: terminator frame not found where expected (offset ${segmentsEnd})`);
  }

  // Head: header sections + root tag frame, ending exactly where the first
  // segment starts (or at the terminator, for an empty blob).
  const prefixEnd = segmentCount > 0 ? offsets[0]! : segmentsEnd;
  const head = await reader.read(0, prefixEnd);
  for (let i = 0; i < 8; i++) {
    if (head[i] !== MAGIC_BYTES_V5[i]) {
      if (i === 7 && head[i] === 0x04) {
        throw new Error(`beast2 v5: ranged reads need v5 blobs; this is a v4 container (re-encode with version 5)`);
      }
      throw new Error(`beast2 v5: not a beast2 v5 container`);
    }
  }
  const headReader = new BufferReader(head, MAGIC_BYTES_V5.length);
  const { rootType } = readTypeSection(headReader);
  if (!isSegmentedRoot(rootType)) {
    throw new Error(`beast2 v5: ranged reads address Array, Set or Dict roots, not ${rootType.type}`);
  }
  const sourceMap = readSourceMapSectionV5(headReader);
  const frameOffset = headReader.offset;
  if (frameOffset + 4 !== prefixEnd || !isTagOrTerminatorFrame(head, frameOffset)) {
    throw new Error(`beast2 v5: root tag frame not found where expected (offset ${frameOffset})`);
  }

  return {
    prefixEnd,
    segmentsEnd,
    indexOffset,
    offsets,
    counts,
    elementCount,
    selfContained: (flags & INDEX_FLAG_SELF_CONTAINED) !== 0,
    sourceMapEmpty: sourceMap.size <= 1n,
    typeValue: rootType,
    size,
    head,
  };
}

/**
 * Assembles a standalone blob for a run of segments from ranged parts — the
 * ranged counterpart of {@link carveBeast2}, producing byte-identical output
 * for the same span.
 *
 * The caller reads exactly the span's frame bytes
 * (`[extents.offsets[fromSegment], end of segment toSegment - 1)`) through
 * its {@link Beast2RangeReader} and passes them here; the result keeps the
 * extents' header bytes verbatim and appends a fresh terminator, index and
 * footer, so it decodes and pages like any carved blob.
 *
 * @param extents - the blob's ranged extents ({@link readBeast2ExtentsRanged})
 * @param frames - the span's segment frame bytes, exactly as stored
 * @param fromSegment - zero-based index of the first segment in `frames`
 * @param toSegment - zero-based index after the last segment in `frames`
 * @returns a standalone v5 blob holding exactly those segments
 * @throws {Error} When the segment range is invalid, the source is not
 *   self-contained, or `frames` does not match the span's byte length.
 */
export function carveBeast2Ranged(extents: Beast2RangedExtents, frames: Uint8Array, fromSegment: number, toSegment: number): Uint8Array {
  const n = extents.offsets.length;
  if (!Number.isInteger(fromSegment) || !Number.isInteger(toSegment) || fromSegment < 0 || toSegment < fromSegment || toSegment > n) {
    throw new Error(`beast2 v5: carve range [${fromSegment}, ${toSegment}) invalid (${n} segments)`);
  }
  if (!extents.selfContained) {
    throw new Error(`beast2 v5: blob has cross-segment aliasing — carve needs self-contained segments`);
  }
  const start = toSegment > fromSegment ? extents.offsets[fromSegment]! : 0;
  const end = toSegment > fromSegment ? segmentEnd(extents, toSegment - 1) : 0;
  if (frames.byteLength !== end - start) {
    throw new Error(`beast2 v5: segment span [${fromSegment}, ${toSegment}) is ${end - start} bytes, got ${frames.byteLength}`);
  }

  const writer = new BufferWriter();
  writer.writeBytes(extents.head);
  const segments: { offset: number; count: number }[] = [];
  if (toSegment > fromSegment) {
    const shift = extents.prefixEnd - start;
    for (let i = fromSegment; i < toSegment; i++) {
      segments.push({ offset: extents.offsets[i]! + shift, count: extents.counts[i]! });
    }
    writer.writeBytes(frames);
  }
  writer.writeBytes(TAG_OR_TERMINATOR_FRAME);
  writeIndexAndFooter(writer, segments, true);
  return writer.toUint8Array();
}

/**
 * The bytes that terminate a spliced or carved stream: the terminator frame
 * plus a self-contained index and footer for the given segment table — the
 * TypeScript mirror of the C runtime's `east_beast2_splice_tail`.
 *
 * With this, a blob can be *streamed* instead of assembled: emit a header
 * (`Beast2RangedExtents.head` or any part's `[0, prefixEnd)` bytes), then the
 * segment frame bytes (tracking their shifted absolute offsets), then this
 * tail — byte-identical to what {@link carveBeast2} / {@link spliceBeast2}
 * build in memory for the same content.
 *
 * @param segments - per-segment absolute (shifted) frame offsets and counts
 * @param streamEnd - the absolute wire offset where the segment frames end
 *   (header bytes plus frame bytes emitted so far)
 * @returns the terminator + index + footer bytes
 */
export function spliceBeast2Tail(segments: readonly { offset: number; count: number }[], streamEnd: number): Uint8Array {
  const writer = new BufferWriter();
  writer.writeBytes(TAG_OR_TERMINATOR_FRAME);
  writeIndexAndFooter(writer, [...segments], true, streamEnd + TAG_OR_TERMINATOR_FRAME.length);
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
