/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a v5 collection blob's segments end.
 *
 * A store that addresses segments individually needs segmentation to be a
 * **pure function of the value**: that is what makes equal values produce
 * equal segment sets, a one-row edit re-cut the segments around it, and two
 * states diff in O(changed segments). So every root's boundary is
 * *content-defined*: a segment **starts at** an element whose hash falls under
 * a threshold, within minimum and maximum bounds. Nothing about the writer
 * enters the decision — not the codec, not the compressed size, not how
 * elements were batched — so every runtime cuts the same value at the same
 * elements.
 *
 * The rule is also **size-aware**. Each element has a *logical size*: the
 * bytes of its canonical encoding, before compression, which per-element
 * aliasing makes a function of the element alone. The threshold rises with the
 * open segment's average element size, so a segment holds about
 * {@link SEGMENT_TARGET_COUNT} narrow elements or about
 * {@link SEGMENT_TARGET_BYTES} of wide ones — a collection of 1 MiB blobs is
 * not one 300 MiB segment. And it is **normalized**: the threshold is lower
 * until the open segment reaches that target and higher after, so segment
 * sizes gather near the target rather than spreading geometrically, which
 * bounds what one page read decodes.
 *
 * A Set or Dict hashes each element's key (its fence bytes, what a manifest
 * stores as a segment's first key); an Array, which has no key, hashes the
 * element's own canonical bytes. The cut falls *before* the deciding element,
 * so a keyed segment's first key is the key that decided its boundary, and a
 * stored segmentation can be checked from its fences, counts and logical sizes
 * ({@link isContentCut}).
 *
 * The constants are load-bearing wire state: a manifest records the rule id it
 * was cut under, so changing a constant means a new rule id, never a silent
 * re-cut.
 */

import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { type EastTypeValue } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { asTypeValue } from "./type-section.js";
import {
  buildV5Encoder,
  buildV5Decoder,
  createV5EncodeContext,
  isSegmentedRoot,
} from "./codec.js";
import type { Beast2DecodeOptions } from "../shared.js";
import { buildPlatformContext } from "../shared.js";
import { SourceMap } from "../../../location.js";

/** Fewest elements (pairs for a Dict) a segment holds before the hash is
 *  consulted — unless it already holds {@link SEGMENT_MIN_BYTES}. The
 *  collection's last segment is the exception: it holds whatever is left. */
export const SEGMENT_MIN_COUNT = 256;

/** A segment's expected size in narrow elements: the cut threshold is never
 *  below one element in this many. */
export const SEGMENT_TARGET_COUNT = 1024;

/** Most elements a segment holds: a segment this long forces the next element
 *  to start a new one, whatever its hash, which bounds a segment's decode cost
 *  whatever the keys are. */
export const SEGMENT_MAX_COUNT = 4096;

/** Fewest logical bytes that let a segment end by hash before it holds
 *  {@link SEGMENT_MIN_COUNT} elements — what lets a segment of wide rows end
 *  after a handful of them. */
export const SEGMENT_MIN_BYTES = 64 * 1024;

/** A segment's expected size in logical bytes for wide elements: the cut
 *  threshold rises with the open segment's average element size so that a
 *  segment holds about this many bytes. */
export const SEGMENT_TARGET_BYTES = 1024 * 1024;

/** Most logical bytes a segment holds before the next element is forced to
 *  start a new one. An element is never split, so one wider than this is a
 *  segment of its own. */
export const SEGMENT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The rule id Set and Dict segments are cut under, stamped into every
 * manifest: the hash, the bounds, and the version of this table. A writer that
 * changes any constant must change this id.
 */
export const SEGMENT_RULE_KEYED = "cdc/keyed/fnv1a-fmix32/256-1024-4096/64K-1M-8M/2";

/**
 * The rule id Array segments are cut under: the same test as
 * {@link SEGMENT_RULE_KEYED}, over each element's canonical bytes.
 */
export const SEGMENT_RULE_ARRAY = "cdc/array/fnv1a-fmix32/256-1024-4096/64K-1M-8M/2";

/** The low 32-bit word of the FNV-1a 64-bit offset basis. */
const FNV_OFFSET_LOW = 0x84222325;
/** The low 32-bit word of the FNV-1a 64-bit prime (2^40 + 0x1b3). */
const FNV_PRIME_LOW = 0x1b3;

/** `2^32 / SEGMENT_TARGET_COUNT` — the threshold for narrow elements. */
const NARROW_THRESHOLD = 2 ** 32 / SEGMENT_TARGET_COUNT;

/** `2^32 / SEGMENT_TARGET_BYTES` — the threshold per byte of average element
 *  size. */
const THRESHOLD_PER_BYTE = 2 ** 32 / SEGMENT_TARGET_BYTES;

/**
 * The boundary hash of an element: the low 32-bit word of its FNV-1a 64-bit
 * hash (`fnv1a64`), mixed by murmur3's 32-bit finalizer.
 *
 * @remarks
 * FNV-1a's low word evolves on its own — the prime's 2^40 term never reaches
 * it — so it runs in 32-bit integer arithmetic, once per element cut. Its low
 * bits depend only on the low bits of each byte, so the finalizer spreads every
 * input bit over the whole word before the threshold compares it.
 *
 * @param bytes - a key's fence bytes (Set/Dict), or an element's canonical
 *   bytes (Array)
 * @returns the hash, an unsigned 32-bit integer
 */
export function segmentBoundaryHash(bytes: Uint8Array): number {
  let h = FNV_OFFSET_LOW | 0;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, FNV_PRIME_LOW);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Whether an element with boundary hash `hash` starts a new segment after an
 * open segment of `count` elements and `bytes` logical bytes — the hash test
 * alone, without the bounds.
 *
 * @remarks
 * The base threshold is `2^32 × max(1 / 1024, (bytes / count) / 1 MiB)`: one
 * narrow element in {@link SEGMENT_TARGET_COUNT}, rising with the segment's
 * average element size so wide elements cut near {@link SEGMENT_TARGET_BYTES}.
 * The test takes a quarter of it until the open segment holds
 * {@link SEGMENT_TARGET_COUNT} elements or {@link SEGMENT_TARGET_BYTES}, and
 * four times it after, so segments gather near the target. An average of
 * 1 MiB or more makes every element a boundary.
 *
 * @param hash - the element's {@link segmentBoundaryHash}
 * @param count - elements in the open segment; at least one
 * @param bytes - logical bytes in the open segment
 * @returns whether the element starts a segment
 */
export function isSegmentBoundary(hash: number, count: number, bytes: number): boolean {
  const base = Math.max(NARROW_THRESHOLD, Math.floor((bytes * THRESHOLD_PER_BYTE) / count));
  const threshold = count >= SEGMENT_TARGET_COUNT || bytes >= SEGMENT_TARGET_BYTES
    ? Math.min(2 ** 32, base * 4)
    : Math.floor(base / 4);
  return hash < threshold;
}

/**
 * The cut rule for every element but a collection's first: whether the
 * element starts a new segment after an open segment of `count` elements and
 * `bytes` logical bytes.
 *
 * @remarks
 * A segment at a maximum always closes; one below both minimums never does;
 * otherwise the element's boundary hash decides ({@link isSegmentBoundary}).
 *
 * @param count - elements in the open segment; at least one
 * @param bytes - logical bytes in the open segment
 * @param hashInput - the bytes the rule hashes: a Set/Dict element's key
 *   fence bytes, an Array element's canonical bytes
 * @returns whether a new segment starts at the element
 */
export function startsSegmentAfter(count: number, bytes: number, hashInput: Uint8Array): boolean {
  if (count >= SEGMENT_MAX_COUNT || bytes >= SEGMENT_MAX_BYTES) return true;
  if (count < SEGMENT_MIN_COUNT && bytes < SEGMENT_MIN_BYTES) return false;
  return isSegmentBoundary(segmentBoundaryHash(hashInput), count, bytes);
}

/**
 * The boundary rule id a root type's segments are cut under.
 *
 * @param type - the blob's root collection type
 * @returns {@link SEGMENT_RULE_KEYED} for Set/Dict roots,
 *   {@link SEGMENT_RULE_ARRAY} for Array roots
 * @throws {TypeError} When the type is not an Array, Set or Dict type.
 */
export function segmentRuleFor(type: EastType | EastTypeValue): string {
  const typeValue = asTypeValue(type);
  if (!isSegmentedRoot(typeValue)) {
    throw new TypeError(`beast2 v5: segment rules address Array, Set or Dict roots, not ${typeValue.type}`);
  }
  return typeValue.type === "Array" ? SEGMENT_RULE_ARRAY : SEGMENT_RULE_KEYED;
}

/**
 * The key (Dict) or element (Set) type a root collection's fences hold.
 *
 * @param type - the blob's root collection type
 * @returns the order-key type, or `null` for an Array root (which has none)
 * @throws {TypeError} When the type is not an Array, Set or Dict type.
 */
export function segmentKeyTypeOf(type: EastType | EastTypeValue): EastTypeValue | null {
  const typeValue = asTypeValue(type);
  if (!isSegmentedRoot(typeValue)) {
    throw new TypeError(`beast2 v5: segment rules address Array, Set or Dict roots, not ${typeValue.type}`);
  }
  if (typeValue.type === "Array") return null;
  return typeValue.type === "Set"
    ? (typeValue as { value: EastTypeValue }).value
    : ((typeValue as { value: { key: EastTypeValue } }).value).key;
}

/**
 * Builds a curried encoder for a *bare* value of `type` — the canonical v5
 * value bytes with no container, header, or index around them.
 *
 * @remarks
 * This is the form a segment fence is stored in and the form the keyed rule
 * hashes, and it is position-independent: the encode runs against a fresh
 * context, so no container REF can ever fire and a key's bytes depend on the
 * key alone. The bytes are not self-describing — the reader supplies the
 * type, which a manifest carries. Each call returns bytes of its own, sized to
 * the key.
 *
 * @param type - the value's type
 * @returns a function encoding one value to its canonical bytes
 */
export function encodeBeast2FenceFor<T extends EastType>(type: T | EastTypeValue): (value: unknown) => Uint8Array {
  const encode = buildV5Encoder(asTypeValue(type));
  const writer = new BufferWriter(256);
  return (value) => {
    // An encode that threw left its bytes behind; the next key starts clean.
    if (writer.size !== 0) writer.pop();
    encode(value, writer, createV5EncodeContext(null, true));
    return writer.pop().slice();
  };
}

/**
 * Builds a curried decoder for the bare value bytes
 * {@link encodeBeast2FenceFor} produces.
 *
 * @param type - the value's type
 * @param options - decode options (platform functions for decoded functions)
 * @returns a function decoding canonical bytes to one value
 * @throws {Error} When the bytes are not exactly one value of `type`.
 */
export function decodeBeast2FenceFor<T extends EastType>(type: T | EastTypeValue, options?: Beast2DecodeOptions): (bytes: Uint8Array) => unknown {
  const decode = buildV5Decoder(asTypeValue(type));
  return (bytes) => {
    const reader = new BufferReader(bytes, 0);
    const value = decode(reader, {
      containers: [],
      sourceMap: new SourceMap(),
      frozen: options?.frozen ?? false,
      ...buildPlatformContext(options),
    });
    if (reader.offset !== bytes.length) {
      throw new Error(`beast2 v5: ${bytes.length - reader.offset} bytes after the encoded key`);
    }
    return value;
  };
}

/**
 * The running decision of where a collection's segments begin.
 *
 * Fed each element in canonical order — its logical size and the bytes the
 * rule hashes — it answers whether that element starts a new segment. The
 * answer depends only on the elements since the last boundary, so a writer
 * that hands elements over one at a time and one that replays the same
 * elements reach the same cuts, whatever runtime they run in.
 *
 * @example
 * ```ts
 * const cutter = new SegmentCutter();
 * for (const { bytes, key } of encodedElements) {
 *   if (cutter.startsSegment(bytes.length, key)) flush();
 *   segment.push(bytes);
 * }
 * flush();
 * ```
 */
export class SegmentCutter {
  private count = 0;
  private bytes = 0;

  /**
   * Accounts for one element and reports whether it starts a new segment.
   *
   * Never true for the collection's first element, which opens segment 0.
   *
   * @param elementBytes - the element's logical size: its canonical encoding's
   *   length (a Dict pair's key and value together)
   * @param hashInput - the bytes the rule hashes: a Set/Dict element's key
   *   fence bytes, an Array element's canonical bytes; hashed only when the
   *   open segment has reached its minimum
   * @returns whether a new segment starts at this element
   */
  startsSegment(elementBytes: number, hashInput: Uint8Array): boolean {
    if (this.count !== 0 && startsSegmentAfter(this.count, this.bytes, hashInput)) {
      this.count = 1;
      this.bytes = elementBytes;
      return true;
    }
    this.count++;
    this.bytes += elementBytes;
    return false;
  }

  /** Elements accounted for in the open segment. */
  get openCount(): number {
    return this.count;
  }

  /** Logical bytes accounted for in the open segment. */
  get openBytes(): number {
    return this.bytes;
  }
}

/**
 * Whether a stored Set or Dict blob's segmentation is one the keyed rule
 * produces, judged from its fences, counts and logical sizes alone.
 *
 * @remarks
 * This is what keeps a conforming writer's output off the decode path: a blob
 * that passes is carved into segment objects by byte copy, and one that fails
 * is laid out again under the rule. Every boundary the rule can produce is
 * visible here — a hash cut as a boundary fence after a segment that reached
 * its minimum, a forced cut as a segment at a maximum.
 *
 * The test is necessary, not sufficient: a writer that *skipped* a boundary
 * inside a segment cannot be detected without decoding it. An Array's cuts
 * hash whole elements, which no fence carries, so they are not judged here.
 *
 * @param fences - each segment's first key, in the canonical bare encoding
 *   {@link encodeBeast2FenceFor} produces, in segment order
 * @param counts - each segment's element (pair) count, in segment order
 * @param logicalBytes - each segment's logical size, in segment order
 *   (`readBeast2SegmentLogicalBytes`)
 * @returns whether the segmentation conforms to {@link SEGMENT_RULE_KEYED}
 */
export function isContentCut(fences: readonly Uint8Array[], counts: readonly number[], logicalBytes: readonly number[]): boolean {
  if (fences.length !== counts.length || logicalBytes.length !== counts.length) return false;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i]! > SEGMENT_MAX_COUNT) return false;
    // The last segment holds what is left.
    if (i < counts.length - 1 && !startsSegmentAfter(counts[i]!, logicalBytes[i]!, fences[i + 1]!)) return false;
  }
  return true;
}
