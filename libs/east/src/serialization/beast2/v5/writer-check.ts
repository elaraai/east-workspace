/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Proving that a collection blob from outside is, segment by segment, what the
 * Writer writes for its value.
 *
 * A store that takes a collection from outside cannot trust its layout, so it
 * reads the elements and writes them again through the Writer
 * (`decodeBeast2ElementsFor`). But every runtime's Writer writes the same
 * bytes for a value, so a blob one of them wrote is already the store's bytes,
 * and writing it again decodes and encodes every element only to reproduce its
 * input. This check proves such a blob's segments instead, for the cost of
 * deflating each one again:
 *
 * - its header is the Writer's for its type, and its segments are
 *   self-contained;
 * - each segment's frame is the pinned deflate of its logical bytes, byte for
 *   byte;
 * - each segment but the first starts where the cut rule starts one after the
 *   segment before it, which takes its first element, walked against a
 *   definition table of its own; and a Set's or Dict's first keys ascend;
 * - no segment of more than one element reaches {@link SEGMENT_MAX_BYTES}: the
 *   rule lets a segment pass it only through its last element, which cannot be
 *   told apart without walking the segment, so such a segment is read as
 *   foreign;
 * - the last segment, which no start follows, is walked whole through the
 *   cutter, which must start no segment inside it.
 *
 * What a writer batched, what an older rule cut, a frame deflated another way,
 * an element that aliases another: each fails the check, and the caller reads
 * the blob as foreign. The deflates run on the frame pool's workers where there
 * is a pool, so the check's cost spreads over cores.
 *
 * A segment larger than {@link RUN_MAX_BYTES}, the most a collection is read in
 * at once, fails too, before it is read, or before it is inflated when only its
 * header says so. The Writer writes one only for an element that large, which
 * reading the blob as foreign refuses, so the check never holds more of a blob
 * than that read would.
 */

import { BufferReader, BufferWriter } from "../../binary-utils.js";
import { type EastTypeValue, isTypeValueEqual } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { buildPlatformContext } from "../shared.js";
import { asTypeValue, readTypeSection } from "./type-section.js";
import { MAGIC_BYTES_V5, type V5DecodeContext, isSegmentedRoot, readSourceMapSectionV5 } from "./codec.js";
import { CODEC_NONE, FRAME_HEADER_MAX, type FrameHeader, inflateRawSync, readFrameHeader, writeFrame } from "./frames.js";
import { type PendingFrame, framePool } from "./frame-pool.js";
import { RUN_MAX_BYTES } from "./runs.js";
import {
  SEGMENT_MAX_BYTES,
  SEGMENT_MAX_COUNT,
  SegmentCutter,
  decodeBeast2FenceFor,
  segmentKeyTypeOf,
  startsSegmentAfter,
} from "./boundary.js";
import { Beast2ElementWriter } from "./stream.js";
import { elementParserFor } from "./recut.js";
import type { Beast2RangedExtents } from "./range.js";

/** A segment of a blob from outside, proved the Writer's. */
export interface Beast2WriterSegment {
  /** The segment's position in the blob. */
  readonly index: number;
  /** The segment's frame: exactly the bytes the blob holds for it. */
  readonly frame: Uint8Array;
  /** Elements (pairs, for a Dict) in the segment. */
  readonly count: number;
  /** Set/Dict: the segment's first key in its canonical bare encoding, which a
   *  manifest entry records as its fence. Array: empty. */
  readonly fence: Uint8Array;
}

/**
 * Thrown by {@link checkBeast2WriterSegmentsFor}'s check at the first thing it
 * finds that the Writer would not have written.
 */
export class Beast2NotWritersError extends Error {
  /**
   * @param message - what the Writer would not have written
   */
  constructor(message: string) {
    super(`beast2 v5: ${message}`);
    this.name = "Beast2NotWritersError";
  }
}

/** Reads `length` bytes of the blob at `offset`. */
export type Beast2CheckRead = (offset: number, length: number) => Promise<Uint8Array>;

/** An Array segment's fence. */
const NO_FENCE = new Uint8Array(0);

/** Frames every check in the process has on the frame pool: kept to two per
 *  worker, as a Writer keeps its own, however many checks run at once. */
let framesInFlight = 0;

/**
 * Builds a check of a collection blob from outside against what the Writer
 * writes for its value.
 *
 * @param type - the collection type (Array/Set/Dict) the blob must hold
 * @returns a function taking the blob's ranged extents and ranged reads of its
 *   bytes, and yielding each segment, in order, once it is proved the Writer's
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 *
 * @remarks
 * The check throws {@link Beast2NotWritersError} at the first segment the Writer
 * would not have written, having yielded the ones before it: a caller that
 * needs the whole blob to be the Writer's discards them. An error a read throws
 * is its own. The segments in flight are what the check holds: up to one per
 * frame pool worker, and across every check in the process two per worker —
 * but always one of each check's, so each goes on — or one without a pool.
 * None is larger than {@link RUN_MAX_BYTES}: a larger one is refused before it
 * is read or inflated.
 *
 * @example
 * ```ts
 * const type = ArrayType(IntegerType);
 * const blob = encodeBeast2PagedFor(type)([1n, 2n, 3n]);
 * const extents = readBeast2Extents({ size: blob.length, read: (o, l) => blob.subarray(o, o + l) });
 * const check = checkBeast2WriterSegmentsFor(type);
 * for await (const segment of check(extents, async (o, l) => blob.subarray(o, o + l))) {
 *   // segment 0, proved: its frame is the bytes the blob holds for it
 * }
 * ```
 */
export function checkBeast2WriterSegmentsFor(
  type: EastType | EastTypeValue,
): (extents: Beast2RangedExtents, read: Beast2CheckRead) => AsyncGenerator<Beast2WriterSegment, void, undefined> {
  const typeValue = asTypeValue(type);
  if (!isSegmentedRoot(typeValue)) {
    throw new TypeError(`beast2 v5: a Writer check addresses Array, Set or Dict values, not ${typeValue.type}`);
  }
  const keyType = segmentKeyTypeOf(typeValue);
  const decodeKey = keyType === null ? null : decodeBeast2FenceFor(keyType);
  const cmp = keyType === null ? null : compareFor(keyType) as (a: unknown, b: unknown) => number;
  const parse = elementParserFor(typeValue);
  const header = new Beast2ElementWriter(typeValue, { segment: () => {} }).header;
  const platform = buildPlatformContext();

  return async function* (extents, read) {
    if (!isTypeValueEqual(extents.typeValue, typeValue)) throw new Beast2NotWritersError("the blob holds another type");
    if (!extents.selfContained) throw new Beast2NotWritersError("the blob's segments alias one another");
    if (!bytesEqual(extents.head, header)) throw new Beast2NotWritersError("the blob's header is not the Writer's for its type");
    const head = new BufferReader(extents.head, MAGIC_BYTES_V5.length);
    readTypeSection(head);
    const sourceMap = readSourceMapSectionV5(head);
    const context = (): V5DecodeContext => ({ containers: [], sourceMap, frozen: false, ...platform });

    const pool = framePool();
    const queue: { segment: Beast2WriterSegment; framed: PendingFrame | Uint8Array }[] = [];

    /** A frame the pool is building, once it is done — or `null` when its
     *  worker failed or was lost. Taken exactly once, which frees its slot. */
    const collect = async (pending: PendingFrame): Promise<Uint8Array | null> => {
      try {
        while (!pending.ready()) await new Promise((resolve) => setTimeout(resolve, 1));
        return pending.take();
      } catch {
        return null;
      } finally {
        framesInFlight--;
      }
    };

    /** Waits for a segment's frame to be built again, and holds it to the
     *  frame the blob holds. */
    const settle = async (item: { segment: Beast2WriterSegment; framed: PendingFrame | Uint8Array }): Promise<Beast2WriterSegment> => {
      const again = item.framed instanceof Uint8Array
        ? item.framed
        // A worker that failed or was lost leaves the frame to this thread.
        : await collect(item.framed) ?? frameAgain(openFrame(item.segment.frame, item.segment.index, item.segment.count).logical);
      if (!bytesEqual(again, item.segment.frame)) {
        throw new Beast2NotWritersError(`segment ${item.segment.index}'s frame is not the Writer's deflate of its bytes`);
      }
      return item.segment;
    };

    const n = extents.offsets.length;
    let before: { count: number; bytes: number } | null = null;
    let lastKey: unknown;
    try {
      for (let i = 0; i < n; i++) {
        const start = extents.offsets[i]!;
        const end = i + 1 < n ? extents.offsets[i + 1]! : extents.segmentsEnd;
        // The Writer's frame is never longer than its logical bytes and a header.
        if (end - start > RUN_MAX_BYTES + FRAME_HEADER_MAX) {
          throw new Beast2NotWritersError(`segment ${i}'s frame is ${end - start} bytes, more than a segment is read in at once`);
        }
        const frame = await read(start, end - start);
        if (frame.length !== end - start) {
          throw new Error(`beast2 v5: a read of segment ${i} returned ${frame.length} of its ${end - start} bytes`);
        }
        const count = extents.counts[i]!;
        const { logical, reader } = openFrame(frame, i, count);
        const bytes = logical.length - reader.offset;
        if (count < 1 || count > SEGMENT_MAX_COUNT || (count > 1 && bytes >= SEGMENT_MAX_BYTES)) {
          throw new Beast2NotWritersError(`segment ${i} holds ${count} elements in ${bytes} bytes, past the cut rule's bounds`);
        }

        const firstStart = reader.offset;
        const keyLength = parseElement(parse, reader, context, `segment ${i}'s first element`);
        const first = logical.subarray(firstStart, reader.offset);
        const hashInput = keyType === null ? first : first.subarray(0, keyLength);
        if (before !== null && !startsSegmentAfter(before.count, before.bytes, hashInput)) {
          throw new Beast2NotWritersError(`segment ${i} does not start where the cut rule starts one`);
        }
        if (decodeKey !== null) {
          let key: unknown;
          try {
            key = decodeKey(hashInput);
          } catch (err) {
            throw new Beast2NotWritersError(`segment ${i}'s first key does not decode (${messageOf(err)})`);
          }
          if (i > 0 && cmp!(lastKey, key) >= 0) {
            throw new Beast2NotWritersError(`segment ${i}'s first key does not follow the segment before it`);
          }
          lastKey = key;
        }
        if (i === n - 1) {
          // Nothing follows the last segment to say where it ends, so its
          // elements are walked: the rule must start no segment inside it.
          const cutter = new SegmentCutter();
          cutter.startsSegment(first.length, hashInput);
          for (let k = 1; k < count; k++) {
            const at = reader.offset;
            const length = parseElement(parse, reader, context, `the last segment's element ${k}`);
            const element = logical.subarray(at, reader.offset);
            if (cutter.startsSegment(element.length, keyType === null ? element : element.subarray(0, length))) {
              throw new Beast2NotWritersError(`the cut rule starts a segment inside the last segment, at its element ${k}`);
            }
          }
          if (reader.offset !== logical.length) {
            throw new Beast2NotWritersError(`the last segment holds ${logical.length - reader.offset} bytes after its elements`);
          }
        }

        const segment: Beast2WriterSegment = { index: i, frame, count, fence: keyType === null ? NO_FENCE : new Uint8Array(hashInput) };
        if (pool === null) {
          queue.push({ segment, framed: frameAgain(logical) });
        } else {
          // Room on the pool: this check's frames up to a worker each, and every
          // check's up to two per worker, past which the oldest settles first.
          while (queue.length > 0 && (queue.length >= pool.workers || framesInFlight >= 2 * pool.workers)) {
            yield await settle(queue.shift()!);
          }
          framesInFlight++;
          queue.push({ segment, framed: pool.submit(logical, "deflate") });
        }
        before = { count, bytes };
        while (queue.length > 0 && (queue[0]!.framed instanceof Uint8Array || queue[0]!.framed.ready())) {
          yield await settle(queue.shift()!);
        }
      }
      while (queue.length > 0) yield await settle(queue.shift()!);
    } finally {
      // A check that ended early — a refusal, or a caller that stopped —
      // still takes its frames, freeing their slots on the pool.
      for (const item of queue.splice(0)) {
        if (!(item.framed instanceof Uint8Array)) await collect(item.framed);
      }
    }
  };
}

/** A segment's frame opened: its logical bytes, and a reader past its element
 *  count, which must be the one the index gives. */
function openFrame(frame: Uint8Array, index: number, count: number): { logical: Uint8Array; reader: BufferReader } {
  let h: FrameHeader;
  try {
    h = readFrameHeader(frame, 0);
    if (h.endOffset !== frame.length) throw new Error(`${frame.length - h.endOffset} bytes follow its first frame`);
  } catch (err) {
    throw new Beast2NotWritersError(`segment ${index} is not one well-formed frame (${messageOf(err)})`);
  }
  if (h.uncompressedLen > RUN_MAX_BYTES) {
    throw new Beast2NotWritersError(`segment ${index} holds ${h.uncompressedLen} bytes, more than the ${RUN_MAX_BYTES} a segment is read in at once`);
  }
  let logical: Uint8Array;
  try {
    const payload = frame.subarray(h.payloadOffset, h.endOffset);
    logical = h.codec === CODEC_NONE ? payload : inflateRawSync(payload, h.uncompressedLen);
  } catch (err) {
    throw new Beast2NotWritersError(`segment ${index} is not one well-formed frame (${messageOf(err)})`);
  }
  const reader = new BufferReader(logical, 0);
  let declared: number;
  try {
    declared = reader.readVarint();
  } catch (err) {
    throw new Beast2NotWritersError(`segment ${index}'s frame does not open with its element count (${messageOf(err)})`);
  }
  if (declared !== count) {
    throw new Beast2NotWritersError(`segment ${index}'s frame holds ${declared} elements, and the blob's index ${count}`);
  }
  return { logical, reader };
}

/** Steps over one element, against a definition table of its own, and
 *  returns its key's length — refusing an element that does not decode alone. */
function parseElement(
  parse: ReturnType<typeof elementParserFor>,
  reader: BufferReader,
  context: () => V5DecodeContext,
  what: string,
): number {
  try {
    return parse(reader, context());
  } catch (err) {
    throw new Beast2NotWritersError(`${what} does not decode on its own (${messageOf(err)})`);
  }
}

/** The frame the Writer writes for a segment's logical bytes. */
function frameAgain(logical: Uint8Array): Uint8Array {
  const out = new BufferWriter();
  writeFrame(out, logical, "deflate");
  return out.toUint8Array();
}

/** Whether two byte strings are equal. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** An error's message. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
