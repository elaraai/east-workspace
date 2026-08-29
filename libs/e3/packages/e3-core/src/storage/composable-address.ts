/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Segment-aligned composable content addressing (prototype).
 *
 * e3 addresses objects by the SHA-256 of their bytes. That address cannot be
 * computed for a blob assembled without reading it — which is exactly what
 * server-side composition (an S3 multipart upload built from `UploadPartCopy`
 * ranges) does, and what carve/splice are: pure byte operations over beast2 v5
 * segment frames.
 *
 * This module defines an address that DOES compose. A blob is decomposed into
 * structural leaves — the header prefix (`[0, prefixEnd)`, including the root
 * tag frame), one leaf per segment frame, and the trailing terminator + index
 * + footer — and the address is a hash over the leaves' digests:
 *
 * ```
 * address = "seg1:" + SHA256( DOMAIN ‖ u32be(leafCount) ‖ H(leaf₀) ‖ … ‖ H(leafₙ) )
 * ```
 *
 * The leaves tile the blob exactly, so the address still commits to every
 * byte, and the decomposition is read off the blob's own index, so the address
 * remains a pure function of the bytes. What it adds is composition: because
 * {@link carveBeast2} and {@link spliceBeast2} copy segment frames VERBATIM,
 * a composed blob's frame leaves are byte-identical to its sources' — so its
 * address follows from the sources' stored frame digests plus a locally-built
 * tail, reading ZERO frame bytes.
 *
 * Why the leaves must be frame-aligned: a carve shifts every frame by
 * `prefixEnd - offsets[from]`, which is not a multiple of any fixed chunk
 * size, so fixed-size (or content-defined) chunking misaligns under carve and
 * composes nothing. Only structure-defined leaves survive the shift.
 *
 * Scope: this is the addressing core. It deliberately does not touch
 * {@link ObjectStore} — wiring it into the storage interface, and the
 * frame-aware streaming digester a runner needs to produce digests while it
 * writes, are separate steps (see `design/composable-addressing.md`).
 */

import { createHash } from 'node:crypto';
import { readBeast2Extents, spliceBeast2Tail } from '@elaraai/east';

/** Address scheme tag. Addresses are `"<scheme>:<hex>"` so a store can hold
 *  both these and legacy `sha256:` addresses without ambiguity. */
export const COMPOSABLE_ADDRESS_SCHEME = 'seg1';

/** Domain separation: binds a digest to this scheme, so a leaf digest can
 *  never be mistaken for an address or for a digest under a later scheme. */
const DOMAIN = Buffer.from(`e3-object-${COMPOSABLE_ADDRESS_SCHEME}\0`, 'ascii');

/** Digest width in bytes (SHA-256). Fixed width is what makes the
 *  concatenation in {@link addressFromLeafDigests} unambiguous. */
const DIGEST_BYTES = 32;

function sha256(...parts: readonly Uint8Array[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

/**
 * The structural leaves of a blob — a partition of its bytes.
 *
 * An indexed beast2 v5 collection blob yields `[header, frame₀ … frameₙ₋₁,
 * tail]`. Anything else — no index, or a non-collection root — is a single
 * leaf holding the whole blob, which keeps the address total over every
 * object the store can hold.
 *
 * @param blob - the object's bytes
 * @returns the leaves, in order, together covering exactly `blob`
 */
export function objectLeaves(blob: Uint8Array): Uint8Array[] {
  let ext;
  try {
    ext = readBeast2Extents(blob);
  } catch {
    return [blob];
  }
  const leaves: Uint8Array[] = [blob.subarray(0, ext.prefixEnd)];
  for (let i = 0; i < ext.offsets.length; i++) {
    const end = i + 1 < ext.offsets.length ? ext.offsets[i + 1]! : ext.segmentsEnd;
    leaves.push(blob.subarray(ext.offsets[i]!, end));
  }
  leaves.push(blob.subarray(ext.segmentsEnd));
  return leaves;
}

/**
 * Folds a leaf-digest vector into an address.
 *
 * The preimage carries the domain tag and an explicit leaf count before the
 * fixed-width digests, so no two different leaf vectors share a preimage.
 *
 * @param digests - one digest per leaf, in leaf order
 * @returns the object address
 */
export function addressFromLeafDigests(digests: readonly Uint8Array[]): string {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(digests.length);
  return `${COMPOSABLE_ADDRESS_SCHEME}:${sha256(DOMAIN, count, ...digests).toString('hex')}`;
}

/**
 * The address of a blob, computed from its bytes.
 *
 * @param blob - the object's bytes
 * @returns the object address
 */
export function computeAddress(blob: Uint8Array): string {
  return addressFromLeafDigests(objectLeaves(blob).map((leaf) => sha256(leaf)));
}

/**
 * The per-object digest side-car: everything composition may use.
 *
 * It carries NO frame bytes — only their digests — so any address built from
 * one is structurally incapable of having read the frames it names. `head` is
 * present because splice parts must share byte-identical header sections and
 * a composed blob carries its source's header verbatim.
 */
export interface ObjectDigests {
  /** `SHA256(blob[0, prefixEnd))`. */
  readonly headDigest: Uint8Array;
  /** The header bytes themselves — small, and needed to build a composed
   *  blob and to check splice-part compatibility. */
  readonly head: Uint8Array;
  /** End of the header sections + root tag frame. */
  readonly prefixEnd: number;
  /** End of the last segment frame. */
  readonly segmentsEnd: number;
  /** Absolute wire offset of each segment frame. */
  readonly offsets: readonly number[];
  /** Element (pair) count of each segment. */
  readonly counts: readonly number[];
  /** `SHA256` of each segment frame's bytes. */
  readonly frameDigests: readonly Uint8Array[];
}

/** The end offset of segment `i`'s frame. */
function segmentEnd(d: Pick<ObjectDigests, 'offsets' | 'segmentsEnd'>, i: number): number {
  return i + 1 < d.offsets.length ? d.offsets[i + 1]! : d.segmentsEnd;
}

/**
 * Computes a blob's digest side-car. This is the one operation that reads
 * every byte — a store does it once, while the object is being written.
 *
 * @param blob - the object's bytes
 * @returns the side-car
 * @throws {Error} When the blob is not a segmented, indexed v5 collection —
 *   such objects are addressed as a single leaf and never composed.
 */
export function digestsOf(blob: Uint8Array): ObjectDigests {
  const ext = readBeast2Extents(blob);
  const frameDigests: Uint8Array[] = [];
  for (let i = 0; i < ext.offsets.length; i++) {
    const end = i + 1 < ext.offsets.length ? ext.offsets[i + 1]! : ext.segmentsEnd;
    frameDigests.push(sha256(blob.subarray(ext.offsets[i]!, end)));
  }
  return {
    headDigest: sha256(blob.subarray(0, ext.prefixEnd)),
    head: blob.subarray(0, ext.prefixEnd),
    prefixEnd: ext.prefixEnd,
    segmentsEnd: ext.segmentsEnd,
    offsets: [...ext.offsets],
    counts: [...ext.counts],
    frameDigests,
  };
}

/** The shifted segment table and stream end a carve produces. */
function carveLayout(d: ObjectDigests, fromSegment: number, toSegment: number) {
  const n = d.offsets.length;
  if (!Number.isInteger(fromSegment) || !Number.isInteger(toSegment) ||
      fromSegment < 0 || toSegment < fromSegment || toSegment > n) {
    throw new Error(`composable address: carve range [${fromSegment}, ${toSegment}) invalid (${n} segments)`);
  }
  const start = toSegment > fromSegment ? d.offsets[fromSegment]! : 0;
  const shift = d.prefixEnd - start;
  const segments: { offset: number; count: number }[] = [];
  for (let i = fromSegment; i < toSegment; i++) {
    segments.push({ offset: d.offsets[i]! + shift, count: d.counts[i]! });
  }
  const frameBytes = toSegment > fromSegment ? segmentEnd(d, toSegment - 1) - start : 0;
  return { segments, streamEnd: d.prefixEnd + frameBytes, frameBytes };
}

/**
 * The address of `carveBeast2(blob, fromSegment, toSegment)`, computed from
 * the side-car alone — no frame bytes are read.
 *
 * @param d - the source's side-car
 * @param fromSegment - zero-based index of the first segment kept
 * @param toSegment - zero-based index after the last segment kept
 * @returns the carved object's address
 * @throws {Error} When the segment range is invalid.
 */
export function addressOfCarve(d: ObjectDigests, fromSegment: number, toSegment: number): string {
  const { segments, streamEnd } = carveLayout(d, fromSegment, toSegment);
  const tail = spliceBeast2Tail(segments, streamEnd);
  return addressFromLeafDigests([
    d.headDigest,
    ...d.frameDigests.slice(fromSegment, toSegment),
    sha256(tail),
  ]);
}

/**
 * The side-car a carve would itself have, derived from the source's side-car
 * — so a slice can be carved again, or spliced, without ever being read.
 *
 * @param d - the source's side-car
 * @param fromSegment - zero-based index of the first segment kept
 * @param toSegment - zero-based index after the last segment kept
 * @returns the carved object's side-car
 * @throws {Error} When the segment range is invalid.
 */
export function digestsOfCarve(d: ObjectDigests, fromSegment: number, toSegment: number): ObjectDigests {
  const { segments, streamEnd } = carveLayout(d, fromSegment, toSegment);
  return {
    headDigest: d.headDigest,
    head: d.head,
    prefixEnd: d.prefixEnd,
    segmentsEnd: streamEnd,
    offsets: segments.map((s) => s.offset),
    counts: segments.map((s) => s.count),
    frameDigests: d.frameDigests.slice(fromSegment, toSegment),
  };
}

/** Whether the first `length` bytes of `a` and `b` are identical. */
function bytesEqual(a: Uint8Array, b: Uint8Array, length: number): boolean {
  if (a.length < length || b.length < length) return false;
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The concatenated segment table and stream end a splice produces. */
function spliceLayout(parts: readonly ObjectDigests[]) {
  if (parts.length === 0) throw new Error(`composable address: splice needs at least one part`);
  const first = parts[0]!;
  const segments: { offset: number; count: number }[] = [];
  const frameDigests: Uint8Array[] = [];
  let pos = first.prefixEnd;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]!;
    // Splice requires byte-identical header sections — the same refusal
    // spliceBeast2 makes, applied here so a composed address can never name
    // a blob the byte-level splice would reject.
    if (part.prefixEnd !== first.prefixEnd || !bytesEqual(part.head, first.head, first.prefixEnd)) {
      throw new Error(`composable address: splice part ${p} has differing header sections — parts must share one wire type and source map`);
    }
    const shift = pos - part.prefixEnd;
    for (let i = 0; i < part.offsets.length; i++) {
      segments.push({ offset: part.offsets[i]! + shift, count: part.counts[i]! });
    }
    frameDigests.push(...part.frameDigests);
    pos += part.segmentsEnd - part.prefixEnd;
  }
  return { first, segments, frameDigests, streamEnd: pos };
}

/**
 * The address of `spliceBeast2(parts)`, computed from the parts' side-cars
 * alone — no frame bytes are read.
 *
 * @param parts - the parts' side-cars, in splice order
 * @returns the spliced object's address
 * @throws {Error} When no parts are given, or the parts' header sections
 *   differ (the same refusal `spliceBeast2` makes).
 */
export function addressOfSplice(parts: readonly ObjectDigests[]): string {
  const { first, segments, frameDigests, streamEnd } = spliceLayout(parts);
  return addressFromLeafDigests([
    first.headDigest,
    ...frameDigests,
    sha256(spliceBeast2Tail(segments, streamEnd)),
  ]);
}

/**
 * The side-car a splice would itself have, derived from its parts'.
 *
 * @param parts - the parts' side-cars, in splice order
 * @returns the spliced object's side-car
 * @throws {Error} When no parts are given, or the parts' header sections differ.
 */
export function digestsOfSplice(parts: readonly ObjectDigests[]): ObjectDigests {
  const { first, segments, frameDigests, streamEnd } = spliceLayout(parts);
  return {
    headDigest: first.headDigest,
    head: first.head,
    prefixEnd: first.prefixEnd,
    segmentsEnd: streamEnd,
    offsets: segments.map((s) => s.offset),
    counts: segments.map((s) => s.count),
    frameDigests,
  };
}

// ---------------------------------------------------------------------------
// Side-car serialization
// ---------------------------------------------------------------------------

/**
 * Serializes a side-car for storage beside its object.
 *
 * At 32 bytes per segment a side-car is a fraction of a percent of the blob,
 * but it is NOT bounded: a large object has thousands of segments, so the
 * side-car must be stored somewhere without a small item cap (an S3 object
 * beside the blob, not a DynamoDB attribute — see the design doc).
 *
 * Layout: `u32be(prefixEnd) u32be(segmentsEnd) u32be(n) head[prefixEnd]
 * headDigest[32] (u32be(offset) u32be(count) digest[32]) × n`.
 *
 * @param d - the side-car
 * @returns its bytes
 */
export function encodeObjectDigests(d: ObjectDigests): Uint8Array {
  const n = d.frameDigests.length;
  const out = Buffer.alloc(12 + d.prefixEnd + DIGEST_BYTES + n * (8 + DIGEST_BYTES));
  let o = 0;
  o = out.writeUInt32BE(d.prefixEnd, o);
  o = out.writeUInt32BE(d.segmentsEnd, o);
  o = out.writeUInt32BE(n, o);
  Buffer.from(d.head).copy(out, o); o += d.prefixEnd;
  Buffer.from(d.headDigest).copy(out, o); o += DIGEST_BYTES;
  for (let i = 0; i < n; i++) {
    o = out.writeUInt32BE(d.offsets[i]!, o);
    o = out.writeUInt32BE(d.counts[i]!, o);
    Buffer.from(d.frameDigests[i]!).copy(out, o); o += DIGEST_BYTES;
  }
  return out;
}

/**
 * Parses a side-car written by {@link encodeObjectDigests}.
 *
 * @param bytes - the serialized side-car
 * @returns the side-car
 * @throws {Error} When the bytes are truncated or internally inconsistent.
 */
export function decodeObjectDigests(bytes: Uint8Array): ObjectDigests {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 12) throw new Error(`composable address: side-car truncated (${buf.length} bytes)`);
  const prefixEnd = buf.readUInt32BE(0);
  const segmentsEnd = buf.readUInt32BE(4);
  const n = buf.readUInt32BE(8);
  const expected = 12 + prefixEnd + DIGEST_BYTES + n * (8 + DIGEST_BYTES);
  if (buf.length !== expected) {
    throw new Error(`composable address: side-car is ${buf.length} bytes, expected ${expected} for ${n} segments`);
  }
  let o = 12;
  const head = Uint8Array.prototype.slice.call(buf, o, o + prefixEnd); o += prefixEnd;
  const headDigest = Uint8Array.prototype.slice.call(buf, o, o + DIGEST_BYTES); o += DIGEST_BYTES;
  const offsets: number[] = [];
  const counts: number[] = [];
  const frameDigests: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    offsets.push(buf.readUInt32BE(o)); o += 4;
    counts.push(buf.readUInt32BE(o)); o += 4;
    frameDigests.push(Uint8Array.prototype.slice.call(buf, o, o + DIGEST_BYTES)); o += DIGEST_BYTES;
  }
  return { headDigest, head, prefixEnd, segmentsEnd, offsets, counts, frameDigests };
}
