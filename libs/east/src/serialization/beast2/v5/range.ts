/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 ranged access — reading a segmented, indexed blob's geometry
 * through positioned byte reads instead of a whole buffer.
 *
 * A v5 collection blob is `header · tag frame · segment frames · terminator
 * frame · index · footer`, so its whole geometry is recoverable from two
 * ranged reads: the tail (footer + index) and the head (header sections +
 * tag frame). Every segment frame's byte range is then known up front, and a
 * paging reader fetches only the frames it decodes: an Array index read or
 * a Set/Dict keyed read touches one frame, iteration touches each frame
 * once. The exception is a Set/Dict root's FIRST keyed read, which verifies
 * the segment fences by probing every frame once (as east-c does) — a
 * bounded prefix of each frame, read and inflated as far as it goes, never
 * the frame unless its first key is wider than the probe. I/O is O(header +
 * index + touched frames) in every case; peak memory is O(segment).
 *
 * Two reader shapes serve two consumers: {@link Beast2RangeReader} (async —
 * an HTTP range request, an S3 ranged GET, e3's dataset paging) and
 * {@link Beast2SyncRangeReader} (sync — a file descriptor with positioned
 * reads, a memory mapping, a plain `Uint8Array`), which is what a compiled
 * East body drives through `Beast2Pages` and `openBeast2LazyFor`. Core stays
 * free of any file system: the reader is injected.
 */

import { type EastTypeValue } from "../../../type_of_type.js";
import { BufferReader } from "../../binary-utils.js";
import { readTypeSection } from "./type-section.js";
import {
  MAGIC_BYTES_V5,
  FOOTER_MAGIC_V5,
  INDEX_FLAG_SELF_CONTAINED,
  readSourceMapSectionV5,
  isSegmentedRoot,
} from "./codec.js";

/** The exact bytes of the root NEW tag frame and of the terminator frame:
 *  codec `none`, one logical byte, payload `0x00`. */
export const TAG_OR_TERMINATOR_FRAME = new Uint8Array([0x00, 0x01, 0x01, 0x00]);

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

/**
 * Synchronous ranged access to an immutable blob — the sync twin of
 * {@link Beast2RangeReader}, for the paging readers a compiled East body
 * drives without awaiting (`Beast2Pages`, `openBeast2LazyFor`).
 *
 * Backed by anything that serves byte ranges synchronously: a file
 * descriptor with positioned reads (so the blob's residency is the page
 * cache, not the heap), a memory mapping, or a plain `Uint8Array`. As for
 * the async reader, `read` must return exactly the requested bytes, and the
 * returned buffer is the reader's to reuse only after the caller is done
 * with it — a paging reader decodes a frame as soon as it reads it.
 *
 * @example
 * ```ts
 * const fd = openSync("rows.beast2", "r");
 * const reader: Beast2SyncRangeReader = {
 *   size: fstatSync(fd).size,
 *   read(offset, length) {
 *     const out = new Uint8Array(length);
 *     let done = 0;
 *     while (done < length) done += readSync(fd, out, done, length - done, offset + done);
 *     return out;
 *   },
 * };
 * const rows = openBeast2LazyFor(ArrayType(RowType), { frozen: true })(reader);
 * ```
 */
export interface Beast2SyncRangeReader {
  /** Total blob size in bytes. */
  readonly size: number;
  /**
   * Reads `length` bytes at absolute wire offset `offset`.
   *
   * @param offset - absolute byte offset into the blob
   * @param length - number of bytes to read
   * @returns exactly the requested bytes
   */
  read(offset: number, length: number): Uint8Array;
}

/** Options accepted by {@link readBeast2ExtentsRanged} and
 *  {@link readBeast2ExtentsSync}. */
export type ReadBeast2ExtentsRangedOptions = {
  /** Initial tail-probe size in bytes (default 64 KiB). When the index
   *  section is larger than the probe, one further tail read fetches the
   *  rest — the probe only tunes how often that second read happens. */
  tailProbeBytes?: number;
};

/**
 * A blob's {@link Beast2Extents} read via ranged access, plus the header
 * bytes `carveBeast2Ranged` reuses.
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

/** Whether `source` is a {@link Beast2SyncRangeReader} rather than a blob —
 *  judged by shape, since a typed array from another realm fails
 *  `instanceof Uint8Array`. */
export function isBeast2SyncRangeReader(source: unknown): source is Beast2SyncRangeReader {
  const r = source as { size?: unknown; read?: unknown } | null;
  return r !== null && typeof r === "object" && typeof r.read === "function" && typeof r.size === "number";
}

/**
 * Reads exactly `length` bytes at `offset` through a sync reader, refusing a
 * short result up front: a reader that returns fewer bytes (a bare
 * `readSync` without the retry loop) would otherwise be reported as a
 * malformed blob.
 *
 * @param reader - the reader
 * @param offset - absolute byte offset
 * @param length - number of bytes
 * @returns exactly the requested bytes
 * @throws {Error} When the reader returns a different number of bytes.
 */
export function readExact(reader: Beast2SyncRangeReader, offset: number, length: number): Uint8Array {
  const bytes = reader.read(offset, length);
  if (bytes.length !== length) {
    throw new Error(`beast2 v5: reader returned ${bytes.length} bytes for a ${length}-byte range at offset ${offset}`);
  }
  return bytes;
}

/** Whether the 4 bytes at `offset` are a tag/terminator frame. */
export function isTagOrTerminatorFrame(data: Uint8Array, offset: number): boolean {
  if (offset + 4 > data.length) return false;
  for (let i = 0; i < 4; i++) {
    if (data[offset + i] !== TAG_OR_TERMINATOR_FRAME[i]) return false;
  }
  return true;
}

/** Parses the u64 little-endian index offset from 8 bytes at `at`. */
export function readU64LE(data: Uint8Array, at: number): number {
  let value = 0n;
  for (let i = 7; i >= 0; i--) {
    value = (value << 8n) | BigInt(data[at + i]!);
  }
  return Number(value);
}

/** The size of the initial tail read: the footer plus a probe of the index. */
function tailProbeSize(size: number, options: ReadBeast2ExtentsRangedOptions | undefined): number {
  return Math.min(size, Math.max(options?.tailProbeBytes ?? 64 * 1024, 16));
}

/** Reads the footer from a tail read holding `[tailStart, size)`: the index
 *  offset, validated against the blob size. */
function footerIndexOffset(tail: Uint8Array, tailStart: number, size: number): number {
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
  return indexOffset;
}

/** The parsed index section — the same wire shape `readIndex` parses from a
 *  whole blob — plus the terminator check ahead of it. */
type ParsedIndex = {
  segmentsEnd: number;
  offsets: number[];
  counts: number[];
  elementCount: number;
  selfContained: boolean;
};

/** Parses the index section and checks the terminator frame from a tail
 *  read holding `[tailStart, size)` that reaches back to the terminator. */
function parseIndexTail(tail: Uint8Array, tailStart: number, size: number, indexOffset: number): ParsedIndex {
  const footerStart = size - 16;
  const segmentsEnd = indexOffset - TAG_OR_TERMINATOR_FRAME.length;
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
  return { segmentsEnd, offsets, counts, elementCount, selfContained: (flags & INDEX_FLAG_SELF_CONTAINED) !== 0 };
}

/** Parses the header sections + root tag frame from a head read holding
 *  `[0, prefixEnd)`: the v5 magic, a collection root type, the source-map
 *  section, and the tag frame ending exactly at `prefixEnd`. */
function parseHead(head: Uint8Array, prefixEnd: number): { rootType: EastTypeValue; sourceMapEmpty: boolean } {
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
  return { rootType, sourceMapEmpty: sourceMap.size <= 1n };
}

/** Assembles the extents from the parsed tail and head. */
function assembleExtents(size: number, indexOffset: number, index: ParsedIndex, prefixEnd: number, head: Uint8Array): Beast2RangedExtents {
  const { rootType, sourceMapEmpty } = parseHead(head, prefixEnd);
  return {
    prefixEnd,
    segmentsEnd: index.segmentsEnd,
    indexOffset,
    offsets: index.offsets,
    counts: index.counts,
    elementCount: index.elementCount,
    selfContained: index.selfContained,
    sourceMapEmpty,
    typeValue: rootType,
    size,
    head,
  };
}

/**
 * Reads the byte geometry of a segmented, indexed v5 collection blob through
 * ranged access — the footer and index from a tail read, the header sections
 * from a head read — without ever buffering the blob whole.
 *
 * The result carries everything `carveBeast2Ranged` needs to assemble a
 * standalone blob for any segment span whose frame bytes are then the only
 * further reads: total I/O for a window is O(header + index + window), not
 * O(blob).
 *
 * @param reader - ranged access to the blob
 * @param options - tail-probe tuning
 * @returns the blob's {@link Beast2RangedExtents}
 * @throws {Error} When the blob is not a v5 container, its root is not a
 *   collection, it carries no index, or the frame geometry is malformed —
 *   the same conditions `readBeast2Extents` rejects.
 */
export async function readBeast2ExtentsRanged(reader: Beast2RangeReader, options?: ReadBeast2ExtentsRangedOptions): Promise<Beast2RangedExtents> {
  const size = reader.size;
  if (size < MAGIC_BYTES_V5.length + 16) {
    throw new Error(`Data too short for Beast2 format: ${size} bytes`);
  }
  // Tail: footer first, then the index section (one further read when the
  // probe missed its start).
  let tailStart = size - tailProbeSize(size, options);
  let tail = checkedLength(await reader.read(tailStart, size - tailStart), tailStart, size - tailStart);
  const indexOffset = footerIndexOffset(tail, tailStart, size);
  const segmentsEnd = indexOffset - TAG_OR_TERMINATOR_FRAME.length;
  if (segmentsEnd < tailStart) {
    tailStart = segmentsEnd;
    tail = checkedLength(await reader.read(tailStart, size - tailStart), tailStart, size - tailStart);
  }
  const index = parseIndexTail(tail, tailStart, size, indexOffset);
  // Head: header sections + root tag frame, ending exactly where the first
  // segment starts (or at the terminator, for an empty blob).
  const prefixEnd = index.offsets.length > 0 ? index.offsets[0]! : segmentsEnd;
  const head = checkedLength(await reader.read(0, prefixEnd), 0, prefixEnd);
  return assembleExtents(size, indexOffset, index, prefixEnd, head);
}

/** The exact-length check {@link readExact} applies, for an awaited read. */
function checkedLength(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  if (bytes.length !== length) {
    throw new Error(`beast2 v5: reader returned ${bytes.length} bytes for a ${length}-byte range at offset ${offset}`);
  }
  return bytes;
}

/**
 * The synchronous twin of {@link readBeast2ExtentsRanged}: the same two
 * ranged reads (tail, then head) through a {@link Beast2SyncRangeReader},
 * for the paging readers a compiled body drives without awaiting.
 *
 * @param reader - synchronous ranged access to the blob
 * @param options - tail-probe tuning
 * @returns the blob's {@link Beast2RangedExtents}
 * @throws {Error} When the blob is not a v5 container, its root is not a
 *   collection, it carries no index, or the frame geometry is malformed.
 */
export function readBeast2ExtentsSync(reader: Beast2SyncRangeReader, options?: ReadBeast2ExtentsRangedOptions): Beast2RangedExtents {
  const size = reader.size;
  if (size < MAGIC_BYTES_V5.length + 16) {
    throw new Error(`Data too short for Beast2 format: ${size} bytes`);
  }
  let tailStart = size - tailProbeSize(size, options);
  let tail = readExact(reader, tailStart, size - tailStart);
  const indexOffset = footerIndexOffset(tail, tailStart, size);
  const segmentsEnd = indexOffset - TAG_OR_TERMINATOR_FRAME.length;
  if (segmentsEnd < tailStart) {
    tailStart = segmentsEnd;
    tail = readExact(reader, tailStart, size - tailStart);
  }
  const index = parseIndexTail(tail, tailStart, size, indexOffset);
  const prefixEnd = index.offsets.length > 0 ? index.offsets[0]! : segmentsEnd;
  const head = readExact(reader, 0, prefixEnd);
  return assembleExtents(size, indexOffset, index, prefixEnd, head);
}

/** A {@link Beast2SyncRangeReader} over a whole in-memory blob: reads are
 *  zero-copy views. What the `Uint8Array` entry points wrap, so every paging
 *  reader has one source shape. */
export function bytesReader(data: Uint8Array): Beast2SyncRangeReader {
  return { size: data.length, read: (offset, length) => data.subarray(offset, offset + length) };
}
