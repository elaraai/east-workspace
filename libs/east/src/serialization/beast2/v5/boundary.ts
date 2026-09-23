/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a v5 collection blob's segments end.
 *
 * Byte-adaptive batching cuts a segment when enough bytes have been *written*,
 * which makes segmentation a function of the writer: the same Dict encoded by
 * two runtimes, or by the same runtime after an edit, lands its boundaries
 * differently, so two equal values can hold no segment in common. A store that
 * addresses segments individually needs the opposite property — **segmentation
 * is a pure function of the value** — because that is what makes equal values
 * produce equal segment sets, a one-row edit re-cut one segment, and two states
 * diff in O(changed segments).
 *
 * So for Set and Dict roots the boundary is *content-defined*: a segment
 * **starts at** the element whose key hashes into a pinned pattern, within
 * pinned minimum and maximum element bounds. Nothing about the writer enters
 * the decision — not the codec, not the compressed size, not the order batches
 * were handed over — so all three runtimes cut the same value at the same keys.
 * Array roots have no key to hash and keep the byte-adaptive batching, which is
 * deterministic for one writer but not across runtimes.
 *
 * The cut falls *before* the boundary key rather than after it so that the key
 * which decided a boundary IS that segment's fence. A stored blob's fences are
 * probed without decoding a segment, so {@link isContentCut} can then answer
 * "was this cut by the rule?" from the segment index alone — which is what lets
 * a conforming runner's output be carved into segment objects by byte copy
 * instead of decoded and re-encoded.
 *
 * The constants are load-bearing wire state: a manifest records the
 * {@link SEGMENT_RULE_KEYED} id it was cut under, so changing a constant means
 * a new rule id, never a silent re-cut.
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

/** Fewest elements (pairs for a Dict) a content-defined segment may hold —
 *  below it the hash is not even consulted, so a run of boundary keys cannot
 *  produce a segment too small to amortize its object. The collection's LAST
 *  segment is the one exception: it holds whatever is left. */
export const SEGMENT_MIN_COUNT = 256;

/** The content-defined segment's expected size in elements: one key in
 *  {@link SEGMENT_TARGET_COUNT} hashes to a boundary, so segments average this
 *  many elements for uniformly distributed keys.
 *
 *  Bounds are element counts, never bytes: the only byte count a writer knows
 *  as it cuts is the *compressed* one, and deflate output is not byte-identical
 *  across zlib builds, so a byte bound could not be part of a rule three
 *  runtimes must agree on. A collection of very wide rows therefore gets large
 *  segments — a segment is the unit of every random read and of every one-row
 *  rewrite, so that is the exposure this constant carries. */
export const SEGMENT_TARGET_COUNT = 1024;

/** Most elements a content-defined segment may hold — reached when no key in
 *  the run hashes to a boundary, which bounds a segment's decode cost whatever
 *  the key distribution. A segment this long forces the next key to start a new
 *  one, so a forced cut's fence is NOT a boundary key — which is why
 *  {@link isContentCut} accepts a full segment as a boundary in its own right. */
export const SEGMENT_MAX_COUNT = 4096;

/** The low bits of a key's hash that must all be zero for the key to end a
 *  segment — `SEGMENT_TARGET_COUNT - 1`, so one key in the target ends one. */
const SEGMENT_MASK = SEGMENT_TARGET_COUNT - 1;

/**
 * The boundary rule id Set/Dict segments are cut under, stamped into every
 * manifest: the hash, the bounds, and the version of this table. A reader
 * comparing it against its own decides whether a blob is already cut the way
 * this build cuts, and a writer that changes any constant must change this id.
 */
export const SEGMENT_RULE_KEYED = "cdc/fnv1a64/256-1024-4096/1";

/**
 * The boundary rule id Array segments are cut under. Array roots have no key
 * to hash, so they keep the paged encoder's byte-adaptive batching — an
 * element cap refined toward a wire-byte target — which is deterministic for
 * one writer but not a pure function of the value across runtimes.
 */
export const SEGMENT_RULE_POSITIONAL = "pos/1000-2MiB/1";

/** FNV-1a 64-bit offset basis, as its high and low 32-bit words. */
const FNV_OFFSET_HIGH = 0xcbf29ce4;
const FNV_OFFSET_LOW = 0x84222325;
/** The FNV-1a 64-bit prime is 2^40 + 0x1b3: a hash times it is the hash times
 *  0x1b3 plus the hash shifted up 40 bits, which is what lets it run in 32-bit
 *  words. */
const FNV_PRIME_LOW = 0x1b3;

/**
 * The 64-bit FNV-1a hash of `bytes`.
 *
 * @remarks
 * Chosen over SHA-256 for the boundary rule because it is one multiply and one
 * xor per byte with no state beyond a 64-bit accumulator, so every runtime
 * reproduces it in a few lines and the per-element cost stays under the key's
 * own encode. It is not a cryptographic hash and carries no security claim —
 * the boundary is a layout decision, and a key chosen to avoid boundaries only
 * lengthens a segment as far as {@link SEGMENT_MAX_COUNT}.
 *
 * Computed in two 32-bit words rather than one BigInt, which a per-byte
 * multiply makes the dominant cost of cutting a collection: the low word times
 * 0x1b3 stays under 2^41, so its carry into the high word is exact in a double,
 * and the prime's 2^40 term reaches the high word as the low word shifted up 8.
 *
 * @param bytes - the bytes to hash
 * @returns the 64-bit hash
 */
export function fnv1a64(bytes: Uint8Array): bigint {
  let high = FNV_OFFSET_HIGH;
  let low = FNV_OFFSET_LOW;
  for (let i = 0; i < bytes.length; i++) {
    low = (low ^ bytes[i]!) >>> 0;
    const product = low * FNV_PRIME_LOW;
    high = (Math.imul(high, FNV_PRIME_LOW) + Math.floor(product / 0x100000000) + (low << 8)) >>> 0;
    low = product >>> 0;
  }
  return (BigInt(high) << 32n) | BigInt(low);
}

/**
 * Whether a key's canonical bytes start a content-defined segment, ignoring
 * the count bounds — the rule's hash test alone.
 *
 * @remarks
 * Only the hash's low bits decide, and FNV-1a's low 32-bit word evolves on its
 * own — the prime's 2^40 term never reaches it — so the test runs that word
 * alone, in 32-bit integer arithmetic, once per key of every collection cut.
 *
 * @param keyBytes - the key's canonical encoding ({@link encodeBeast2FenceFor})
 * @returns whether this key is a boundary key
 */
export function isSegmentBoundaryKey(keyBytes: Uint8Array): boolean {
  let low = FNV_OFFSET_LOW | 0;
  for (let i = 0; i < keyBytes.length; i++) low = Math.imul(low ^ keyBytes[i]!, FNV_PRIME_LOW);
  return (low & SEGMENT_MASK) === 0;
}

/**
 * The boundary rule id a root type's segments are cut under.
 *
 * @param type - the blob's root collection type
 * @returns {@link SEGMENT_RULE_KEYED} for Set/Dict roots,
 *   {@link SEGMENT_RULE_POSITIONAL} for Array roots
 * @throws {TypeError} When the type is not an Array, Set or Dict type.
 */
export function segmentRuleFor(type: EastType | EastTypeValue): string {
  const typeValue = asTypeValue(type);
  if (!isSegmentedRoot(typeValue)) {
    throw new TypeError(`beast2 v5: segment rules address Array, Set or Dict roots, not ${typeValue.type}`);
  }
  return typeValue.type === "Array" ? SEGMENT_RULE_POSITIONAL : SEGMENT_RULE_KEYED;
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
 * This is the form a segment fence is stored in and the form the boundary rule
 * hashes, and it must be both compact and position-independent: the encode runs
 * against a fresh context, so no container REF can ever fire and a key's bytes
 * depend on the key alone, never on what preceded it in the blob. The bytes are
 * not self-describing — the reader supplies the type, which a manifest carries.
 * Each call returns bytes of its own, sized to the key.
 *
 * @param type - the value's type
 * @returns a function encoding one value to its canonical bytes
 */
export function encodeBeast2FenceFor<T extends EastType>(type: T | EastTypeValue): (value: unknown) => Uint8Array {
  const encode = bareEncoderFor(type);
  return (value) => encode(value).slice();
}

/**
 * The bare encoder behind {@link encodeBeast2FenceFor}, writing into one reused
 * writer: each call returns a view of its encoding that the next call
 * overwrites.
 *
 * @remarks
 * What the cutter hashes and forgets once per key of every collection cut,
 * where a writer allocated per key was most of the rule's cost.
 *
 * @param type - the value's type
 * @returns a function encoding one value into the shared writer
 */
function bareEncoderFor(type: EastType | EastTypeValue): (value: unknown) => Uint8Array {
  const encode = buildV5Encoder(asTypeValue(type));
  const writer = new BufferWriter(256);
  return (value) => {
    // An encode that threw left its bytes behind; the next key starts clean.
    if (writer.size !== 0) writer.pop();
    encode(value, writer, createV5EncodeContext(null, true));
    return writer.pop();
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
 * The running decision of where a keyed collection's segments begin.
 *
 * Fed each element's key in canonical order, it answers whether that element
 * starts a new segment. The answer depends only on the keys seen since the last
 * boundary, so a writer that hands elements over one at a time and one that
 * replays the same keys reach the same cuts.
 *
 * @example
 * ```ts
 * const cutter = new SegmentCutter(StringType);
 * for (const key of keys) {
 *   if (cutter.startsSegment(key)) flush();
 *   batch.push(key);
 * }
 * flush();
 * ```
 */
export class SegmentCutter {
  private readonly fence: (value: unknown) => Uint8Array;
  private count = 0;

  /**
   * @param keyType - the collection's key (Dict) or element (Set) type
   */
  constructor(keyType: EastType | EastTypeValue) {
    this.fence = bareEncoderFor(keyType);
  }

  /**
   * Accounts for one element and reports whether it starts a new segment.
   *
   * Never true for the collection's first element, which opens segment 0.
   *
   * @param key - the element's key, in canonical order
   * @returns whether a new segment starts at this element
   */
  startsSegment(key: unknown): boolean {
    if (this.count >= SEGMENT_MAX_COUNT) {
      this.count = 1;
      return true;
    }
    // Below the minimum the hash is not consulted at all, which is both the
    // rule and the reason a short collection is one segment.
    if (this.count < SEGMENT_MIN_COUNT || !isSegmentBoundaryKey(this.fence(key))) {
      this.count++;
      return false;
    }
    this.count = 1;
    return true;
  }

  /** Elements accounted for in the open segment. */
  get openCount(): number {
    return this.count;
  }
}

/**
 * Whether a stored blob's segmentation is one the content rule produces,
 * judged from the segment index alone.
 *
 * @remarks
 * This is what keeps a conforming runner's output off the decode path: a blob
 * that passes is carved into segment objects by byte copy, and one that fails
 * is decoded and re-encoded under the rule. Every boundary the rule can produce
 * is visible here — a hash cut shows as a boundary fence above a segment that
 * reached the minimum, and a forced cut as a segment at exactly the maximum.
 *
 * The test is necessary, not sufficient: a writer that *skipped* a boundary key
 * inside a segment cannot be detected without decoding it. The writers are the
 * three runtimes' encoders, and a positionally batched blob fails almost surely
 * (a fence is a boundary key with probability 1 / {@link SEGMENT_TARGET_COUNT}),
 * which is the discrimination this is for.
 *
 * @param fences - each segment's first key, in the canonical bare encoding
 *   {@link encodeBeast2FenceFor} produces, in segment order
 * @param counts - each segment's element (pair) count, in segment order
 * @returns whether the segmentation conforms to {@link SEGMENT_RULE_KEYED}
 */
export function isContentCut(fences: readonly Uint8Array[], counts: readonly number[]): boolean {
  if (fences.length !== counts.length) return false;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i]! > SEGMENT_MAX_COUNT) return false;
    if (i === counts.length - 1) break;  // the last segment holds what is left
    if (counts[i] === SEGMENT_MAX_COUNT) continue;
    if (counts[i]! < SEGMENT_MIN_COUNT) return false;
    if (!isSegmentBoundaryKey(fences[i + 1]!)) return false;
  }
  return true;
}
