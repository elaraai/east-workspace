/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Taking a delivered collection in: a beast2 file from outside, read a segment
 * at a time and written through the Writer.
 *
 * A delivery is a collection some writer wrote. Usually that was a Writer, whose
 * rows are already the bytes the Writer writes for them; sometimes an older
 * writer or another tool, whose bytes differ in ways decoding and encoding again
 * would remove. Each segment is walked by its type without building a value
 * ({@link canonicalSkipperFor}), and when every row of it is the Writer's
 * encoding its rows go to the Writer as they stand, which cuts and frames them
 * again: for a delivery the Writer wrote, that walk and that framing are the
 * whole cost.
 *
 * A segment with a row the Writer would write otherwise is walked again with
 * the lenient skipper, which holds the bytes to what the decoder reads. If it
 * passes, the segment's rows are decoded — against one definition table, so a
 * row may alias a container of an earlier row, as an older writer's could — and
 * each is encoded again on its own. Anything else is refused, naming the
 * segment and what is wrong with it, in words every runner uses.
 *
 * A Set's elements and a Dict's keys must strictly ascend across the whole
 * delivery. A piece of a delivery — a run of its segments, by its index —
 * checks only its own rows: whoever assembles the pieces checks where they
 * meet.
 *
 * Memory is one segment of the delivery and the Writer's open segment. A
 * version 4 delivery has no segments, so it is read whole, within the limit a
 * segment is read in.
 */

import { type EastTypeValue, EastTypeValueType, isTypeValueEqual } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { SourceMap } from "../../../location.js";
import { printFor } from "../../east.js";
import { compareFor } from "../../../comparison.js";
import { SortedSet } from "../../../containers/sortedset.js";
import { SortedMap } from "../../../containers/sortedmap.js";
import { BufferReader, BufferWriter } from "../../binary-utils.js";
import { buildPlatformContext } from "../shared.js";
import { MAGIC_BYTES, decodeBeast2V4For, readBeast2V4Type } from "../v4/container.js";
import { asTypeValue, readTypeSection } from "./type-section.js";
import { FOOTER_MAGIC_V5, MAGIC_BYTES_V5, TAG_NEW, type V5DecodeContext, buildV5Decoder, readSourceMapSectionV5 } from "./codec.js";
import { CODEC_DEFLATE, CODEC_NONE, FRAME_HEADER_MAX, inflateRawSync } from "./frames.js";
import { RUN_MAX_BYTES } from "./runs.js";
import { SEGMENT_MAX_BYTES, decodeBeast2FenceFor } from "./boundary.js";
import { type Beast2SyncRangeReader, readBeast2ExtentsSync, readExact } from "./range.js";
import { elementEncoderFor } from "./stream.js";
import { Beast2ManifestWriter, type Beast2ManifestSink } from "./manifest-writer.js";
import { BEAST2_ZERO_WIDTH_MAX, Beast2NotCanonicalError, type CanonicalSkipper, canonicalSkipperFor, zeroWidth } from "./canonical.js";

/** Head reads the header sections are parsed from, in order: neither section
 *  says how long it is before it is parsed. The last is a ceiling — a type
 *  section wider than 16 MiB is malformed, not merely large. */
const HEAD_PROBE_BYTES = [4 * 1024, 256 * 1024, 16 * 1024 * 1024];

/** Options accepted by {@link intakeBeast2For}. */
export type Beast2IntakeOptions = {
  /** The delivery's segments `[from, to)`, by its index: a piece of a large
   *  delivery. Absent, the whole delivery is taken in. */
  segments?: { readonly from: number; readonly to: number };
  /** Frame the output on the worker pool. Defaults to `false`. */
  parallel?: boolean;
};

/** What an intake came to. */
export type Beast2IntakeStats = {
  /** Rows taken in: elements, or a Dict's pairs. */
  readonly rows: number;
  /** Segments of the delivery read: a version 4 delivery counts as one. */
  readonly segments: number;
  /** Of those, the segments read and written again, rather than carried as
   *  the Writer's bytes. */
  readonly rewritten: number;
};

/** A delivery refused: what is wrong with it, in the words every runner uses. */
export class Beast2IntakeError extends Error {
  /**
   * @param message - what is wrong, after the `intake: ` every refusal starts
   *   with
   */
  constructor(message: string) {
    super(`intake: ${message}`);
    this.name = "Beast2IntakeError";
  }
}

function refuse(message: string): never {
  throw new Beast2IntakeError(message);
}

/** The refusal of segment `n`'s frame, for what is wrong with it. */
function malformed(n: number, reason: string): never {
  refuse(`segment ${n} of the delivery is malformed: ${reason}`);
}

/** Whether a type holds a function anywhere. */
function holdsFunction(type: EastTypeValue, seen = new Set<EastTypeValue>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  switch (type.type) {
    case "Function":
    case "AsyncFunction":
      return true;
    case "Array":
    case "Set":
    case "Ref":
    case "Vector":
    case "Matrix":
      return holdsFunction(type.value as EastTypeValue, seen);
    case "Dict":
      return holdsFunction(type.value.key, seen) || holdsFunction(type.value.value, seen);
    case "Struct":
    case "Variant":
      return type.value.some((field) => holdsFunction(field.type, seen));
    case "Recursive": {
      const node = type.value as { type: "wrapper"; value: { inner: EastTypeValue } } | { type: "ref" };
      return node.type === "wrapper" && holdsFunction(node.value.inner, seen);
    }
    default:
      return false;
  }
}

/**
 * Builds an intake: `intake(delivery, sink)` reads a delivered collection of
 * `type` and writes it through the Writer as a manifest directory.
 *
 * @param type - the declared collection type (Array/Set/Dict); the delivery's
 *   header must name exactly it
 * @returns a function taking the delivery, the sink its manifest directory goes
 *   to, and the options, and returning what the intake came to
 * @throws {Beast2IntakeError} When the declared type is not a collection, or
 *   holds a function.
 *
 * @remarks
 * The returned function throws a {@link Beast2IntakeError} when the delivery is
 * refused: not a beast2 blob of version 4 or 5, another type, a segment larger
 * than {@link RUN_MAX_BYTES}, a malformed frame, a row the decoder cannot read,
 * or keys that do not strictly ascend. What it wrote to the sink before then
 * has no manifest, so no reader takes it as complete.
 *
 * @example
 * ```ts
 * const type = DictType(StringType, IntegerType);
 * const delivery = encodeBeast2PagedFor(type)(new Map([["a", 1n], ["b", 2n]]));
 * const files = new Map<string, Uint8Array>();
 * intakeBeast2For(type)({ size: delivery.length, read: (at, n) => delivery.subarray(at, at + n) }, {
 *   object: (hash, bytes) => files.set(`${hash}.beast2`, bytes),
 *   manifest: (bytes) => files.set("manifest.beast2", bytes),
 * });
 * // files holds the manifest the Writer writes for the value, and its segments
 * ```
 */
export function intakeBeast2For<T extends EastType>(
  type: T | EastTypeValue,
): (delivery: Beast2SyncRangeReader, sink: Beast2ManifestSink, options?: Beast2IntakeOptions) => Beast2IntakeStats {
  const typeValue = asTypeValue(type);
  if (typeValue.type !== "Array" && typeValue.type !== "Set" && typeValue.type !== "Dict") {
    refuse(`a delivery is an Array, Set or Dict, not ${typeValue.type}`);
  }
  if (holdsFunction(typeValue)) refuse("the declared type holds a function, which a delivery does not carry");
  const kind = typeValue.type;
  const keyType: EastTypeValue | null = kind === "Array" ? null
    : kind === "Set" ? (typeValue as { value: EastTypeValue }).value : (typeValue as { value: { key: EastTypeValue } }).value.key;
  const printType = printFor(EastTypeValueType);
  const printKey = keyType === null ? null : printFor(keyType);
  const cmp = keyType === null ? null : compareFor(keyType) as (a: unknown, b: unknown) => number;
  const decodeKey = keyType === null ? null : decodeBeast2FenceFor(keyType);
  const noun = kind === "Set" ? "Set elements" : "Dict keys";
  // Rows that encode to no bytes: their count is bounded as every decoder
  // bounds it, since the bytes left bound nothing.
  const zeroRows = kind === "Dict"
    ? zeroWidth((typeValue as { value: { key: EastTypeValue } }).value.key) && zeroWidth((typeValue as { value: { value: EastTypeValue } }).value.value)
    : zeroWidth((typeValue as { value: EastTypeValue }).value);

  // A row's skippers, strict and lenient: a Dict's key and then its value.
  const skippers = (lenient: boolean): { key: CanonicalSkipper; value: CanonicalSkipper | null } => kind === "Dict"
    ? {
      key: canonicalSkipperFor((typeValue as { value: { key: EastTypeValue } }).value.key, { lenient }),
      value: canonicalSkipperFor((typeValue as { value: { value: EastTypeValue } }).value.value, { lenient }),
    }
    : { key: canonicalSkipperFor((typeValue as { value: EastTypeValue }).value, { lenient }), value: null };
  const strict = skippers(false);
  const lenient = skippers(true);

  // A row's decoder, for a segment read and written again.
  const typeCtx = new Map<bigint, any>();
  const decodeRow: (reader: BufferReader, ctx: V5DecodeContext) => unknown = kind === "Dict"
    ? (() => {
      const key = buildV5Decoder((typeValue as { value: { key: EastTypeValue } }).value.key, typeCtx);
      const value = buildV5Decoder((typeValue as { value: { value: EastTypeValue } }).value.value, typeCtx);
      return (reader: BufferReader, ctx: V5DecodeContext) => [key(reader, ctx), value(reader, ctx)];
    })()
    : buildV5Decoder((typeValue as { value: EastTypeValue }).value, typeCtx);

  return (delivery, sink, options) => {
    // Opened at the first row, or at the end for an empty collection, so a
    // delivery refused by its header writes nothing.
    let opened: Beast2ManifestWriter | null = null;
    const writer = (): Beast2ManifestWriter => opened ??= new Beast2ManifestWriter(typeValue, sink, { parallel: options?.parallel ?? false });
    const encodeRow = elementEncoderFor(typeValue, null);
    const scratch = new BufferWriter();
    const spans: number[] = [];
    const defs: EastTypeValue[] = [];
    let previous: unknown;
    let hasPrevious = false;
    let rows = 0;
    let segments = 0;
    let rewritten = 0;

    /** Holds a row's key to strict ascent from the last. */
    const ascend = (key: unknown): void => {
      if (hasPrevious && cmp!(previous, key) >= 0) {
        refuse(`the delivery's ${noun} must ascend strictly in East order, and ${printKey!(key)} follows ${printKey!(previous)}`);
      }
      previous = key;
      hasPrevious = true;
    };

    /** Adds a row that is already the Writer's bytes. */
    const addBytes = (bytes: Uint8Array, keyLength: number): void => {
      if (decodeKey !== null) ascend(decodeKey(bytes.subarray(0, keyLength)));
      writer().addEncoded(bytes, keyLength);
      rows++;
    };

    /** Adds a row decoded from bytes the Writer would write otherwise. */
    const addValue = (row: unknown): void => {
      if (kind !== "Array") ascend(kind === "Dict" ? (row as [unknown, unknown])[0] : row);
      scratch.pop();
      const keyLength = encodeRow(row, scratch);
      writer().addEncoded(scratch.toUint8Array(), keyLength);
      rows++;
    };

    /** Walks a row with a pair of skippers, and returns its key's length. */
    const walk = (reader: BufferReader, pair: { key: CanonicalSkipper; value: CanonicalSkipper | null }, rowDefs: EastTypeValue[]): number => {
      const start = reader.offset;
      pair.key(reader, rowDefs);
      const keyLength = reader.offset - start;
      pair.value?.(reader, rowDefs);
      return kind === "Array" ? 0 : keyLength;
    };

    /**
     * Takes segment `n` in: `count` rows from `start` in a frame's logical
     * bytes. Returns where the segment ends.
     */
    const segment = (n: number, logical: Uint8Array, start: number, count: number): number => {
      segments++;
      if (zeroRows && count > BEAST2_ZERO_WIDTH_MAX) malformed(n, "its element count is more than a reader takes");
      const reader = new BufferReader(logical, start);
      spans.length = 0;
      let canonical = true;
      try {
        for (let i = 0; i < count; i++) {
          const at = reader.offset;
          defs.length = 0;
          const keyLength = walk(reader, strict, defs);
          spans.push(at, reader.offset, keyLength);
        }
      } catch (err) {
        if (!(err instanceof Beast2NotCanonicalError)) throw err;
        canonical = false;
      }
      if (canonical) {
        for (let i = 0; i < spans.length; i += 3) addBytes(logical.subarray(spans[i]!, spans[i + 1]!), spans[i + 2]!);
        return reader.offset;
      }

      // A row the Writer would write otherwise: the segment is held to what
      // the decoder reads, its rows sharing one definition table as a
      // decoder's do, and then read and written again.
      rewritten++;
      const loose = new BufferReader(logical, start);
      const shared: EastTypeValue[] = [];
      try {
        for (let i = 0; i < count; i++) walk(loose, lenient, shared);
      } catch (err) {
        if (err instanceof Beast2NotCanonicalError) refuse(`segment ${n} of the delivery holds a row that does not decode: ${err.reason}`);
        throw err;
      }
      const decoding = new BufferReader(logical, start);
      const ctx: V5DecodeContext = { containers: [], sourceMap: new SourceMap(), frozen: false, ...buildPlatformContext() };
      for (let i = 0; i < count; i++) addValue(decodeRow(decoding, ctx));
      return loose.offset;
    };

    /** A frame at `at`, no further than `end`: the segment it holds is `n`.
     *  Returns its logical bytes and where the next frame starts. */
    const frame = (n: number, at: number, end: number): { logical: Uint8Array; next: number } => {
      if (at >= end) malformed(n, "its frame runs past the end of the delivery");
      const head = new BufferReader(readExact(delivery, at, Math.min(FRAME_HEADER_MAX, end - at)), 0);
      let codec: number;
      let logicalBytes: number;
      let payloadBytes: number;
      try {
        codec = head.readVarint();
        logicalBytes = head.readVarint();
        payloadBytes = head.readVarint();
      } catch {
        malformed(n, "its frame runs past the end of the delivery");
      }
      if (logicalBytes > RUN_MAX_BYTES) {
        refuse(
          `segment ${n} of the delivery, at offset ${at}, holds ${logicalBytes} bytes, more than the ${RUN_MAX_BYTES} a ` +
          `segment is read in — write it again with a current Writer, whose segments stay under ${SEGMENT_MAX_BYTES} ` +
          `bytes: it was encoded whole, or cut by an older Writer that bounded a segment by its element count alone`
        );
      }
      if (codec !== CODEC_NONE && codec !== CODEC_DEFLATE) malformed(n, `its frame's codec, ${codec}, is not one every runner reads`);
      if (codec === CODEC_NONE && payloadBytes !== logicalBytes) malformed(n, "its frame's lengths disagree");
      const payloadAt = at + head.offset;
      if (payloadBytes > end - payloadAt) malformed(n, "its frame runs past the end of the delivery");
      const payload = readExact(delivery, payloadAt, payloadBytes);
      let logical: Uint8Array;
      if (codec === CODEC_NONE) {
        logical = payload;
      } else {
        try {
          logical = inflateRawSync(payload, logicalBytes);
        } catch {
          malformed(n, "its frame does not inflate to the length its header declares");
        }
      }
      return { logical, next: payloadAt + payloadBytes };
    };

    /** A segment's element count, at the front of its frame's logical bytes. */
    const countOf = (n: number, reader: BufferReader): number => {
      try {
        return reader.readVarint();
      } catch {
        malformed(n, "its element count runs past the end of its frame");
      }
    };

    const size = delivery.size;
    const magic = size >= 8 ? readExact(delivery, 0, 8) : new Uint8Array(0);
    const beast2 = magic.length === 8 && magic.subarray(0, 7).every((byte, i) => byte === MAGIC_BYTES_V5[i]);
    if (!beast2 || (magic[7] !== MAGIC_BYTES[7] && magic[7] !== MAGIC_BYTES_V5[7])) {
      refuse("the delivery is not a beast2 blob of version 4 or 5");
    }
    const checkType = (wire: EastTypeValue): void => {
      if (!isTypeValueEqual(wire, typeValue)) refuse(`the delivery holds ${printType(wire)}, not ${printType(typeValue)}`);
    };

    if (magic[7] === MAGIC_BYTES[7]) {
      // Version 4 has no segments: the delivery is read whole, within the
      // limit a segment is read in.
      if (options?.segments !== undefined) refuse("the delivery is a version 4 blob, which has no segments to take a range of");
      if (size > RUN_MAX_BYTES) {
        refuse(`the delivery is a version 4 blob longer than ${RUN_MAX_BYTES} bytes, which has no segments to read it in — write it again with a current Writer`);
      }
      const bytes = readExact(delivery, 0, size);
      let wire: EastTypeValue;
      try {
        wire = readBeast2V4Type(bytes);
      } catch {
        refuse("the delivery's header does not read");
      }
      checkType(wire);
      let value: unknown;
      try {
        value = decodeBeast2V4For(typeValue)(bytes);
      } catch {
        refuse("the delivery is a version 4 blob that does not decode as its type");
      }
      segments = 1;
      rewritten = 1;
      if (kind === "Array") {
        for (const row of value as unknown[]) addValue(row);
      } else if (kind === "Set") {
        for (const row of value instanceof SortedSet ? value : [...(value as Set<unknown>)].sort(cmp!)) addValue(row);
      } else {
        const entries = value instanceof SortedMap
          ? (value as SortedMap<unknown, unknown>).entries()
          : [...(value as Map<unknown, unknown>).entries()].sort((a, b) => cmp!(a[0], b[0]));
        for (const entry of entries) addValue(entry);
      }
      writer().finish();
      return { rows, segments, rewritten };
    }

    // The header: its sections say how long they are only once parsed.
    let rootType: EastTypeValue | null = null;
    let headerEnd = 0;
    for (const probe of HEAD_PROBE_BYTES) {
      const length = Math.min(size, probe);
      try {
        const head = new BufferReader(readExact(delivery, 0, length), MAGIC_BYTES_V5.length);
        rootType = readTypeSection(head).rootType;
        readSourceMapSectionV5(head);
        headerEnd = head.offset;
        break;
      } catch {
        if (length === size) break;
      }
    }
    if (rootType === null) refuse("the delivery's header does not read");
    checkType(rootType);

    const range = options?.segments;
    if (range !== undefined) {
      // A piece: the segments the index names, each its own frame.
      const footer = size >= 16 ? readExact(delivery, size - 8, 8) : new Uint8Array(0);
      if (footer.length !== 8 || !footer.every((byte, i) => byte === FOOTER_MAGIC_V5[i])) {
        refuse("the delivery has no index, so it has no segments to take a range of");
      }
      let extents: ReturnType<typeof readBeast2ExtentsSync>;
      try {
        extents = readBeast2ExtentsSync(delivery);
      } catch {
        refuse("the delivery's index does not read");
      }
      const count = extents.offsets.length;
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to <= range.from || range.to > count) {
        refuse(`segments [${range.from}, ${range.to}) are not a range of the delivery's ${count}`);
      }
      if (!extents.selfContained) refuse("the delivery's segments alias one another, so none is taken in apart from the rest");
      for (let i = range.from; i < range.to; i++) {
        const at = extents.offsets[i]!;
        const end = i + 1 < count ? extents.offsets[i + 1]! : extents.segmentsEnd;
        const { logical, next } = frame(i, at, end);
        if (next !== end) malformed(i, "its frame is not the length the delivery's index gives it");
        const reader = new BufferReader(logical, 0);
        const rowsIn = countOf(i, reader);
        if (rowsIn !== extents.counts[i]) malformed(i, "its element count disagrees with the delivery's index");
        if (segment(i, logical, reader.offset, rowsIn) !== logical.length) malformed(i, "its frame holds bytes after its last row");
      }
      writer().finish();
      return { rows, segments, rewritten };
    }

    // The whole delivery: its value stream front to back, a frame at a time.
    // The first frame opens the root; each segment is its count and its rows,
    // within one frame; a count of zero ends the root.
    let at = headerEnd;
    let n = 0;
    let current = frame(n, at, size);
    at = current.next;
    let reader = new BufferReader(current.logical, 0);
    while (reader.offset === reader.buffer.length) {
      current = frame(n, at, size);
      at = current.next;
      reader = new BufferReader(current.logical, 0);
    }
    if (reader.readUint8() !== TAG_NEW) refuse("the delivery's value stream does not open a collection");
    for (;;) {
      while (reader.offset === reader.buffer.length) {
        current = frame(n, at, size);
        at = current.next;
        reader = new BufferReader(current.logical, 0);
      }
      const rowsIn = countOf(n, reader);
      if (rowsIn === 0) break;
      reader.offset = segment(n, reader.buffer, reader.offset, rowsIn);
      n++;
    }
    if (reader.offset !== reader.buffer.length) refuse("the delivery's value stream holds bytes after its last segment");
    writer().finish();
    return { rows, segments, rewritten };
  };
}
