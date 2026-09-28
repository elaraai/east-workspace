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
 * input. This check proves such a blob instead, for the cost of stepping over
 * each element and deflating each segment again:
 *
 * - its header is the Writer's for its type, and its segments are
 *   self-contained;
 * - each element is the Writer's encoding of the element it holds, stepped
 *   over without being decoded (`canonicalSkipperFor`) against a definition
 *   table of its own, and a Set's elements or a Dict's keys strictly ascend
 *   across the whole blob;
 * - the elements, walked in order through the cutter, start a segment exactly
 *   where the blob's segments start, and nowhere else;
 * - each segment's frame is the pinned deflate of its logical bytes, byte for
 *   byte.
 *
 * What a writer batched, what an older rule cut, a frame deflated another way,
 * an element that aliases another, one that decodes but would encode otherwise:
 * each fails the check, and the caller reads the blob as foreign. The walk runs
 * on the calling thread; the deflates run on the frame pool's workers where
 * there is a pool, so most of the check's cost spreads over cores.
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
import { asTypeValue } from "./type-section.js";
import { isSegmentedRoot } from "./codec.js";
import { CODEC_NONE, FRAME_HEADER_MAX, type FrameHeader, inflateRawSync, readFrameHeader, writeFrame } from "./frames.js";
import { type FramePool, type PendingFrame, framePool } from "./frame-pool.js";
import { RUN_MAX_BYTES } from "./runs.js";
import { SegmentCutter, decodeBeast2FenceFor, segmentKeyTypeOf } from "./boundary.js";
import { Beast2ElementWriter } from "./stream.js";
import { Beast2NotCanonicalError, canonicalSkipperFor, canonicalVarint } from "./canonical.js";
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

/** How long a frame is waited for without blocking: far longer than a segment
 *  takes to deflate, so past it the frame's worker may be gone. */
const FRAME_POLL_MS = 1_000;

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
 * is its own. A value holding a function is not proved: its captures' types are
 * known only once its IR is decoded. The segments in flight are what the check
 * holds: up to one per frame pool worker, and across every check in the process
 * two per worker — but always one of each check's, so each goes on — or one
 * without a pool. None is larger than {@link RUN_MAX_BYTES}: a larger one is
 * refused before it is read or inflated. A frame whose worker is lost is framed
 * on the calling thread, and the check frames the rest there too.
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
  // A Set's element is its key; a Dict's pair is its key, then its value; an
  // Array's element has no key.
  const skipKey = keyType === null ? null : canonicalSkipperFor(keyType);
  const skipRest = typeValue.type === "Dict" ? canonicalSkipperFor((typeValue as { value: { value: EastTypeValue } }).value.value)
    : typeValue.type === "Array" ? canonicalSkipperFor((typeValue as { value: EastTypeValue }).value)
    : null;
  const header = new Beast2ElementWriter(typeValue, { segment: () => {} }).header;

  return async function* (extents, read) {
    if (!isTypeValueEqual(extents.typeValue, typeValue)) throw new Beast2NotWritersError("the blob holds another type");
    if (!extents.selfContained) throw new Beast2NotWritersError("the blob's segments alias one another");
    if (!bytesEqual(extents.head, header)) throw new Beast2NotWritersError("the blob's header is not the Writer's for its type");

    let pool = framePool();
    /** A segment proved, and its frame built again: on this thread, or on the
     *  pool it was handed to. */
    type Queued = { segment: Beast2WriterSegment; framed: Uint8Array | { pending: PendingFrame; on: FramePool } };
    const queue: Queued[] = [];

    /** A frame the pool is building, once it is done — or `null` when its
     *  worker failed or was lost. Taken exactly once, which frees its slot. */
    const collect = async ({ pending, on }: { pending: PendingFrame; on: FramePool }): Promise<Uint8Array | null> => {
      try {
        // Waiting yields to the event loop, where the pool hears a worker fail
        // and gives itself up. A frame on a pool given up, or not ready long
        // past a deflate's time, is taken anyway: taking it fails at once on
        // a pool given up, and waits out the pool's own bound on a lost worker.
        const since = Date.now();
        while (!pending.ready() && framePool() === on && Date.now() - since < FRAME_POLL_MS) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        return pending.take();
      } catch {
        return null;
      } finally {
        framesInFlight--;
      }
    };

    /** Waits for a segment's frame to be built again, and holds it to the
     *  frame the blob holds. */
    const settle = async (item: Queued): Promise<Beast2WriterSegment> => {
      let again = item.framed instanceof Uint8Array ? item.framed : await collect(item.framed);
      if (again === null) {
        // Its worker failed or was lost: this segment, and every one after,
        // is framed on this thread.
        pool = null;
        again = frameAgain(openFrame(item.segment.frame, item.segment.index, item.segment.count).logical);
      }
      if (!bytesEqual(again, item.segment.frame)) {
        throw new Beast2NotWritersError(`segment ${item.segment.index}'s frame is not the Writer's deflate of its bytes`);
      }
      return item.segment;
    };

    const n = extents.offsets.length;
    const cutter = new SegmentCutter();
    const defs: EastTypeValue[] = [];
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
        if (count < 1) throw new Beast2NotWritersError(`segment ${i} holds no elements`);
        const { logical, reader } = openFrame(frame, i, count);

        let fence = NO_FENCE;
        for (let j = 0; j < count; j++) {
          const at = reader.offset;
          defs.length = 0;
          let keyEnd = at;
          try {
            if (skipKey !== null) {
              skipKey(reader, defs);
              keyEnd = reader.offset;
            }
            skipRest?.(reader, defs);
          } catch (err) {
            if (!(err instanceof Beast2NotCanonicalError)) throw err;
            throw new Beast2NotWritersError(`segment ${i}'s element ${j} is not the Writer's encoding: ${err.message.replace(/^beast2 v5: /, "")}`);
          }
          const element = logical.subarray(at, reader.offset);
          const hashInput = keyType === null ? element : logical.subarray(at, keyEnd);
          // The rule starts a segment at the first element of every segment
          // but the first, and at no other.
          if (cutter.startsSegment(element.length, hashInput) !== (j === 0 && i > 0)) {
            throw new Beast2NotWritersError(j === 0
              ? `segment ${i} does not start where the cut rule starts one`
              : `the cut rule starts a segment inside segment ${i}, at its element ${j}`);
          }
          if (decodeKey !== null) {
            let key: unknown;
            try {
              key = decodeKey(hashInput);
            } catch (err) {
              throw new Beast2NotWritersError(`segment ${i}'s element ${j}'s key does not decode (${messageOf(err)})`);
            }
            if ((i > 0 || j > 0) && cmp!(lastKey, key) >= 0) {
              throw new Beast2NotWritersError(`segment ${i}'s element ${j} does not follow the one before it in the order of its keys`);
            }
            lastKey = key;
            if (j === 0) fence = new Uint8Array(hashInput);
          }
        }
        if (reader.offset !== logical.length) {
          throw new Beast2NotWritersError(`segment ${i} holds ${logical.length - reader.offset} bytes after its elements`);
        }

        const segment: Beast2WriterSegment = { index: i, frame, count, fence };
        if (pool === null) {
          queue.push({ segment, framed: frameAgain(logical) });
        } else {
          // Room on the pool: this check's frames up to a worker each, and every
          // check's up to two per worker, past which the oldest settles first.
          while (pool !== null && queue.length > 0 && (queue.length >= pool.workers || framesInFlight >= 2 * pool.workers)) {
            yield await settle(queue.shift()!);
          }
          if (pool === null) {
            queue.push({ segment, framed: frameAgain(logical) });
          } else {
            framesInFlight++;
            queue.push({ segment, framed: { pending: pool.submit(logical, "deflate"), on: pool } });
          }
        }
        while (queue.length > 0 && (queue[0]!.framed instanceof Uint8Array || queue[0]!.framed.pending.ready())) {
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
 *  count, which must be the one the index gives, written as the Writer writes
 *  it. */
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
    declared = canonicalVarint(reader, "its element count");
  } catch (err) {
    throw new Beast2NotWritersError(`segment ${index}'s frame does not open with its element count (${messageOf(err)})`);
  }
  if (declared !== count) {
    throw new Beast2NotWritersError(`segment ${index}'s frame holds ${declared} elements, and the blob's index ${count}`);
  }
  return { logical, reader };
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
