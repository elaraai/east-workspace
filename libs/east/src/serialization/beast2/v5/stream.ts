/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 streaming and paging APIs.
 *
 * - {@link Beast2Writer} — append-only streaming writer: each `write(batch)`
 *   becomes one root segment (one frame), so writer memory is O(batch), never
 *   the whole collection.
 * - {@link encodeBeast2SegmentsFor} — in-memory convenience over the writer.
 * - {@link iterBeast2SegmentsFor} — sequential segment iterator: yields one
 *   decoded collection per root segment with O(segment) decoded memory.
 * - {@link openBeast2PagesFor} — random access over an indexed blob: O(1)
 *   `elementCount`, per-segment decode via footer + index seeks.
 *
 * Streaming roots are collections (Array/Set/Dict). Writers default to
 * self-contained segments (aliasing scoped per segment) so their output is
 * pageable and parallel-decodable; pass `selfContained: false` to keep
 * whole-stream aliasing at the cost of random access.
 */

import { type EastTypeValue } from "../../../type_of_type.js";
import type { EastType, ValueTypeOf } from "../../../types.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { SourceMap } from "../../../location.js";
import { type Beast2DecodeOptions, buildPlatformContext } from "../shared.js";
import { writeTypeSection, readTypeSection, asTypeValue } from "./type-section.js";
import { type Beast2Codec, FrameReader, writeFrame } from "./frames.js";
import {
  MAGIC_BYTES_V5,
  TAG_NEW,
  type V5EncodeContext,
  type V5DecodeContext,
  createV5EncodeContext,
  buildV5Encoder,
  buildV5Decoder,
  writeSourceMapSectionV5,
  readSourceMapSectionV5,
  writeIndexAndFooter,
  readIndex,
  isSegmentedRoot,
  type Beast2Index,
} from "./codec.js";

/** The collection kinds a v5 stream can hold at the root. */
type SegmentedKind = "Array" | "Set" | "Dict";

/** Validates that a root type is streamable and returns its kind. */
function checkSegmented(typeValue: EastTypeValue): SegmentedKind {
  if (!isSegmentedRoot(typeValue)) {
    throw new TypeError(`beast2 v5 streams hold Array, Set or Dict values, not ${typeValue.type}`);
  }
  return typeValue.type as SegmentedKind;
}

/** Options accepted by {@link Beast2Writer} and {@link encodeBeast2SegmentsFor}. */
export type Beast2WriterOptions = {
  /** Per-frame codec. Defaults to `"deflate"`. */
  codec?: Beast2Codec;
  /** Scope aliasing per segment so the output is pageable and segments decode
   *  independently. Defaults to `true`. */
  selfContained?: boolean;
  /** Write the trailing index + footer at {@link Beast2Writer.finish}.
   *  Defaults to `true`. */
  index?: boolean;
  /** Source map for function values in the stream, written to the header. */
  sourceMap?: SourceMap | null;
};

// =============================================================================
// Streaming writer
// =============================================================================

/**
 * Append-only streaming writer for a v5 collection blob.
 *
 * Each {@link write} encodes one batch — a value of the declared collection
 * type — as one root segment, so peak writer memory is one batch plus its
 * aliased containers, never the whole collection. Output bytes are pushed to
 * the `sink` as they are produced; the header is written at construction and
 * {@link finish} appends the terminator (plus index and footer by default),
 * so the byte stream is append-only end to end.
 *
 * @example
 * ```ts
 * const chunks: Uint8Array[] = [];
 * const writer = new Beast2Writer(ArrayType(StringType), (b) => chunks.push(b));
 * writer.write(["a", "b"]);
 * writer.write(["c"]);
 * writer.finish();
 * const blob = Buffer.concat(chunks);
 * decodeBeast2For(ArrayType(StringType))(blob);  // ["a", "b", "c"]
 * ```
 */
export class Beast2Writer<T extends EastType = EastType> {
  /** Number of segments written so far. */
  segments = 0;
  private readonly kind: SegmentedKind;
  private readonly sink: (bytes: Uint8Array) => void;
  private readonly codec: Beast2Codec;
  private readonly selfContained: boolean;
  private readonly withIndex: boolean;
  private readonly ctx: V5EncodeContext;
  private readonly encodeElems: (value: any, logical: BufferWriter) => void;
  private readonly index: { offset: number; count: number }[] = [];
  private bytesWritten = 0;
  private finished = false;

  /**
   * @param type - the collection type this stream holds (Array/Set/Dict)
   * @param sink - receives output bytes as they are produced
   * @param options - codec, self-containment, index, and source map options
   * @throws {TypeError} When `type` is not an Array, Set or Dict type.
   */
  constructor(type: T | EastTypeValue, sink: (bytes: Uint8Array) => void, options?: Beast2WriterOptions) {
    const typeValue = asTypeValue(type);
    this.kind = checkSegmented(typeValue);
    this.sink = sink;
    this.codec = options?.codec ?? "deflate";
    this.selfContained = options?.selfContained ?? true;
    this.withIndex = options?.index ?? true;

    const sourceMap = options?.sourceMap ?? null;
    this.ctx = createV5EncodeContext(sourceMap, this.selfContained);

    const typeCtx = new Map<bigint, any>();
    if (this.kind === "Dict") {
      const key = buildV5Encoder((typeValue as any).value.key, typeCtx);
      const val = buildV5Encoder((typeValue as any).value.value, typeCtx);
      this.encodeElems = (value, logical) => {
        for (const [k, v] of value) {
          key(k, logical, this.ctx);
          val(v, logical, this.ctx);
        }
      };
    } else {
      const elem = buildV5Encoder((typeValue as any).value, typeCtx);
      this.encodeElems = (value, logical) => {
        for (const item of value) elem(item, logical, this.ctx);
      };
    }

    // Header: magic + type section + source map section, then the root tag
    // as its own frame so every indexed segment frame is pure.
    const head = new BufferWriter();
    head.writeBytes(MAGIC_BYTES_V5);
    writeTypeSection(typeValue, head);
    writeSourceMapSectionV5(sourceMap, head);
    writeFrame(head, new Uint8Array([TAG_NEW]), "none");
    // The root container consumes definition 0 (no root object exists on the
    // encode side — batches are independent values, so nothing can alias it);
    // segments scope from definition 1 to match the decoder's numbering.
    this.ctx.containerCount = 1;
    this.ctx.segmentBaseDef = 1;
    this.emit(head.toUint8Array());
  }

  /**
   * Encodes one batch as one root segment.
   *
   * Empty batches are skipped — a segment count is never zero, so the stream
   * terminator stays unambiguous.
   *
   * @param batch - a value of the declared collection type
   * @throws {Error} When called after {@link finish}.
   */
  write(batch: ValueTypeOf<T>): void {
    if (this.finished) throw new Error("write() after finish()");
    const count = this.kind === "Array" ? (batch as any[]).length : (batch as any).size;
    if (count === 0) return;

    if (this.selfContained) {
      this.ctx.containerIndex.clear();
      this.ctx.segmentBaseDef = this.ctx.containerCount;
    }

    const logical = new BufferWriter();
    logical.writeVarint(count);
    this.encodeElems(batch, logical);

    const frame = new BufferWriter();
    writeFrame(frame, logical.toUint8Array(), this.codec);
    this.index.push({ offset: this.bytesWritten, count });
    this.segments++;
    this.emit(frame.toUint8Array());
  }

  /**
   * Terminates the stream: writes the terminator frame and, unless disabled,
   * the index and footer. Idempotent.
   */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    const tail = new BufferWriter();
    writeFrame(tail, new Uint8Array([0x00]), "none");
    if (this.withIndex) {
      // writeIndexAndFooter derives the index offset from the writer's size,
      // so seed it with the bytes already emitted.
      const before = tail.size;
      writeIndexAndFooterAt(tail, this.bytesWritten + before, this.index, this.selfContained && !this.ctx.crossSegmentRef);
    }
    this.emit(tail.toUint8Array());
  }

  private emit(bytes: Uint8Array): void {
    this.bytesWritten += bytes.length;
    this.sink(bytes);
  }
}

/** Writes the index + footer where the index offset is `absoluteOffset`
 *  rather than the writer's own size (the writer streams to a sink). */
function writeIndexAndFooterAt(writer: BufferWriter, absoluteOffset: number, segments: { offset: number; count: number }[], selfContained: boolean): void {
  const local = new BufferWriter();
  writeIndexAndFooter(local, segments, selfContained);
  // writeIndexAndFooter stamped its own size as the index offset (0 here, as
  // `local` starts empty at the index) — restamp the footer's u64 with the
  // absolute offset.
  const bytes = local.toUint8Array();
  let v = BigInt(absoluteOffset);
  for (let i = 0; i < 8; i++) {
    bytes[bytes.length - 16 + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  writer.writeBytes(bytes);
}

// =============================================================================
// In-memory convenience encode
// =============================================================================

/**
 * Builds a curried batch encoder: `encode(batches)` returns one v5 blob with
 * one segment per non-empty batch. The in-memory convenience form of
 * {@link Beast2Writer} — use the writer to stream to a file or socket.
 *
 * @param type - the collection type (Array/Set/Dict)
 * @param options - writer options
 * @returns a function encoding an iterable of batches to v5 bytes
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 */
export function encodeBeast2SegmentsFor<T extends EastType>(type: T | EastTypeValue, options?: Beast2WriterOptions): (batches: Iterable<ValueTypeOf<T>>) => Uint8Array {
  checkSegmented(asTypeValue(type));
  return (batches) => {
    const chunks: Uint8Array[] = [];
    const writer = new Beast2Writer(type, (b) => chunks.push(b), options);
    for (const batch of batches) writer.write(batch);
    writer.finish();
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  };
}

// =============================================================================
// Paged whole-value encode
// =============================================================================

/** Default element cap per segment for {@link encodeBeast2PagedFor}. Small
 *  enough that one segment decodes cheaply, large enough that frames stay far
 *  above the compression threshold and per-segment overhead (frame header +
 *  index entry) is negligible. */
export const BEAST2_PAGED_BATCH_DEFAULT = 1_000;

/** Default wire-byte target per segment for {@link encodeBeast2PagedFor}.
 *  Wide rows would otherwise make element-capped segments arbitrarily large —
 *  and a paging reader decodes whole segments, so segment size IS the random-
 *  access cost. Batching adapts toward this target from measured output. */
export const BEAST2_PAGED_TARGET_BYTES_DEFAULT = 2 * 1024 * 1024;

/** The probe batch that seeds the byte-adaptive batching — small, so one
 *  pathologically wide first batch cannot blow past the target unmeasured. */
const PAGED_PROBE_BATCH = 16;

/** Options accepted by {@link encodeBeast2PagedFor}. */
export type Beast2PagedEncodeOptions = {
  /** Element (pair for Dict roots) cap per segment. Defaults to
   *  {@link BEAST2_PAGED_BATCH_DEFAULT}. */
  batchSize?: number;
  /** Wire-byte target per segment — batches shrink below `batchSize` when
   *  measured element size would exceed it. Defaults to
   *  {@link BEAST2_PAGED_TARGET_BYTES_DEFAULT}. */
  targetSegmentBytes?: number;
  /** Per-frame codec. Defaults to `"deflate"`. */
  codec?: Beast2Codec;
  /** Source map for function values in the stream, written to the header. */
  sourceMap?: SourceMap | null;
};

/**
 * Builds a curried paged encoder: `encode(value)` writes one whole collection
 * value as a segmented, self-contained, indexed v5 blob — `batchSize` elements
 * per segment.
 *
 * The write-side sibling of {@link openBeast2PagesFor}: a blob written this
 * way supports random access ({@link Beast2Pages.segment} /
 * {@link Beast2Pages.element} / {@link Beast2Pages.slice}) without decoding
 * the rest. Decoding the whole blob through the ordinary entry points yields
 * exactly the input value. Note the bytes differ from the whole-value
 * `encodeBeast2For` encode of the same value (segment framing is part of the
 * bytes), so content-addressed stores hash the two forms differently.
 *
 * @param type - the collection type (Array/Set/Dict)
 * @param options - batch size, codec, and source map options
 * @returns a function encoding a collection value to an indexed v5 blob
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 */
export function encodeBeast2PagedFor<T extends EastType>(type: T | EastTypeValue, options?: Beast2PagedEncodeOptions): (value: ValueTypeOf<T>) => Uint8Array {
  const typeValue = asTypeValue(type);
  const kind = checkSegmented(typeValue);
  const batchCap = Math.max(1, Math.floor(options?.batchSize ?? BEAST2_PAGED_BATCH_DEFAULT));
  const targetBytes = Math.max(1, Math.floor(options?.targetSegmentBytes ?? BEAST2_PAGED_TARGET_BYTES_DEFAULT));
  const writerOptions: Beast2WriterOptions = {
    ...(options?.codec !== undefined && { codec: options.codec }),
    ...(options?.sourceMap !== undefined && { sourceMap: options.sourceMap }),
  };

  return (value) => {
    const makeBatch: (items: unknown[]) => ValueTypeOf<EastType> =
      kind === "Array" ? (items) => items as ValueTypeOf<EastType>
      : kind === "Set" ? (items) => new Set(items) as ValueTypeOf<EastType>
      : (items) => new Map(items as [unknown, unknown][]) as ValueTypeOf<EastType>;
    const iterable: Iterable<unknown> = kind === "Dict"
      ? (value as Map<unknown, unknown>).entries()
      : (value as Iterable<unknown>);

    // Byte-adaptive batching: a throwaway scratch encode of the first few
    // elements measures the average wire size, and batches then target
    // `targetSegmentBytes` (never above the element cap). Re-encoding the
    // probe costs a handful of elements; the real stream starts with
    // full-size, right-sized segments. Batching is a pure function of the
    // value, so the bytes stay deterministic for content-addressing.
    const items = iterable[Symbol.iterator]();
    const probe: unknown[] = [];
    while (probe.length < PAGED_PROBE_BATCH) {
      const n = items.next();
      if (n.done) break;
      probe.push(n.value);
    }
    let nextBatch = batchCap;
    if (probe.length > 0) {
      let scratchBytes = 0;
      let scratchHeader = 0;
      const scratch = new Beast2Writer(typeValue, (b) => { scratchBytes += b.length; }, writerOptions);
      scratchHeader = scratchBytes;
      scratch.write(makeBatch(probe));
      const avg = Math.max(1, (scratchBytes - scratchHeader) / probe.length);
      nextBatch = Math.max(1, Math.min(batchCap, Math.floor(targetBytes / avg)));
    }

    const chunks: Uint8Array[] = [];
    let bodyBytes = 0;
    const writer = new Beast2Writer(typeValue, (b) => {
      chunks.push(b);
      bodyBytes += b.length;
    }, writerOptions);
    const headerBytes = bodyBytes;
    let written = 0;
    let batch: unknown[] = [];
    const flush = (): void => {
      if (batch.length === 0) return;
      writer.write(makeBatch(batch));
      written += batch.length;
      batch = [];
      // Refine toward the target as real output accumulates (drifting data).
      const avg = Math.max(1, (bodyBytes - headerBytes) / written);
      nextBatch = Math.max(1, Math.min(batchCap, Math.floor(targetBytes / avg)));
    };
    const pump = (item: unknown): void => {
      batch.push(item);
      if (batch.length >= nextBatch) flush();
    };
    for (const p of probe) pump(p);
    for (let n = items.next(); !n.done; n = items.next()) pump(n.value);
    flush();
    writer.finish();

    const out = new Uint8Array(bodyBytes);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  };
}

// =============================================================================
// Segment iterator
// =============================================================================

/** Verifies the v5 magic without dispatching (stream APIs are v5-only). */
function verifyV5Magic(data: Uint8Array): void {
  if (data.length < 8) {
    throw new Error(`Data too short for Beast2 format: ${data.length} bytes`);
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== MAGIC_BYTES_V5[i]) {
      if (i === 7 && data[i] === 0x04) {
        throw new Error(`beast2 v5: segment APIs need a v5 blob; this is a v4 container (re-encode with version 5)`);
      }
      throw new Error(`Invalid Beast2 v5 magic at offset ${i}: expected 0x${MAGIC_BYTES_V5[i]!.toString(16)}, got 0x${data[i]!.toString(16)}`);
    }
  }
}

/** Parses the header of a v5 collection blob for the segment-level readers. */
function openSegmented(data: Uint8Array, typeValue: EastTypeValue): { kind: SegmentedKind; sourceMap: SourceMap; frameOffset: number } {
  verifyV5Magic(data);
  const kind = checkSegmented(typeValue);
  const reader = new BufferReader(data, MAGIC_BYTES_V5.length);
  readTypeSection(reader);
  const sourceMap = readSourceMapSectionV5(reader);
  return { kind, sourceMap, frameOffset: reader.offset };
}

/** Builds the per-segment decode closure shared by the iterator and pages. */
function buildSegmentDecoder(typeValue: EastTypeValue, kind: SegmentedKind): (reader: BufferReader, ctx: V5DecodeContext, n: number) => any {
  const typeCtx = new Map<bigint, any>();
  if (kind === "Dict") {
    const key = buildV5Decoder((typeValue as any).value.key, typeCtx);
    const val = buildV5Decoder((typeValue as any).value.value, typeCtx);
    return (reader, ctx, n) => {
      const map = new Map<any, any>();
      for (let i = 0; i < n; i++) {
        const k = key(reader, ctx);
        const v = val(reader, ctx);
        map.set(k, v);
      }
      return map;
    };
  }
  const elem = buildV5Decoder((typeValue as any).value, typeCtx);
  if (kind === "Set") {
    return (reader, ctx, n) => {
      const set = new Set<any>();
      for (let i = 0; i < n; i++) set.add(elem(reader, ctx));
      return set;
    };
  }
  return (reader, ctx, n) => {
    const arr: any[] = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = elem(reader, ctx);
    return arr;
  };
}

/**
 * Builds a curried segment iterator: `segments(data)` yields one decoded
 * collection per root segment, in stream order, with O(segment) decoded
 * memory. The caller merges (or processes each batch and drops it).
 *
 * @param type - the collection type (Array/Set/Dict)
 * @param options - decode options (platform functions for decoded functions)
 * @returns a function returning a generator over decoded segments
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 */
export function iterBeast2SegmentsFor<T extends EastType>(type: T | EastTypeValue, options?: Beast2DecodeOptions): (data: Uint8Array) => Generator<ValueTypeOf<T>> {
  const typeValue = asTypeValue(type);
  checkSegmented(typeValue);

  return function* (data: Uint8Array) {
    const { kind, sourceMap, frameOffset } = openSegmented(data, typeValue);
    const decodeSegment = buildSegmentDecoder(typeValue, kind);
    const ctx: V5DecodeContext = { containers: [], sourceMap, ...buildPlatformContext(options) };
    const cursor = new FrameReader(data, frameOffset);

    let reader = cursor.next();
    const tag = reader.readUint8();
    if (tag !== TAG_NEW) {
      throw new Error(`beast2 v5: root container must be NEW (tag 0x${tag.toString(16)})`);
    }
    // The root container is definition 0 — segments never alias it, but the
    // definition numbering must match the writer's.
    ctx.containers.push(kind === "Array" ? [] : kind === "Set" ? new Set() : new Map());

    for (;;) {
      if (reader.offset === reader.buffer.length) reader = cursor.next();
      const n = reader.readVarint();
      if (n === 0) break;
      yield decodeSegment(reader, ctx, n);
    }
    if (reader.offset !== reader.buffer.length) {
      throw new Error(`beast2 v5: ${reader.buffer.length - reader.offset} logical bytes after the root terminator`);
    }
    // Trailing bytes must be nothing or a well-formed index + footer.
    if (cursor.wireOffset !== data.length && readIndex(data) === null) {
      throw new Error(`beast2 v5: ${data.length - cursor.wireOffset} trailing bytes at offset ${cursor.wireOffset} (no footer)`);
    }
  };
}

// =============================================================================
// Paging reader
// =============================================================================

/**
 * Random access over an indexed, self-contained v5 collection blob.
 *
 * Reads the footer + index once; `elementCount` is O(1) from the index, and
 * {@link segment} seeks to and decodes exactly one segment. Requires the blob
 * to carry an index (written by default by {@link Beast2Writer}); random
 * access additionally requires self-contained segments.
 */
export class Beast2Pages<T extends EastType = EastType> {
  /** Per-segment element counts from the index (pairs for Dict roots). */
  readonly counts: readonly number[];
  /** Sum of all segment counts. For Array roots this is the exact element
   *  count; for Set/Dict roots it is an upper bound (cross-segment duplicate
   *  keys collapse on merge). */
  readonly elementCount: number;
  /** Whether segments are independently decodable. */
  readonly selfContained: boolean;
  private readonly data: Uint8Array;
  private readonly indexData: Beast2Index;
  private readonly kind: SegmentedKind;
  private readonly sourceMap: SourceMap;
  private readonly decodeSegment: (reader: BufferReader, ctx: V5DecodeContext, n: number) => any;
  private readonly platform: Beast2DecodeOptions | undefined;
  private readonly cumulative: number[];

  /** @internal Use {@link openBeast2PagesFor}. */
  constructor(data: Uint8Array, typeValue: EastTypeValue, options?: Beast2DecodeOptions) {
    const { kind, sourceMap, frameOffset } = openSegmented(data, typeValue);
    void frameOffset;
    const index = readIndex(data);
    if (!index) {
      throw new Error(`beast2 v5: blob has no index/footer — paging needs a writer with index enabled`);
    }
    this.data = data;
    this.indexData = index;
    this.kind = kind;
    this.sourceMap = sourceMap;
    this.decodeSegment = buildSegmentDecoder(typeValue, kind);
    this.platform = options;
    this.counts = index.counts;
    this.elementCount = index.totalCount;
    this.selfContained = index.selfContained;
    this.cumulative = new Array(index.counts.length);
    let sum = 0;
    for (let i = 0; i < index.counts.length; i++) {
      sum += index.counts[i]!;
      this.cumulative[i] = sum;
    }
  }

  /** Number of segments in the blob. */
  get segmentCount(): number {
    return this.indexData.offsets.length;
  }

  /**
   * Decodes one segment by index.
   *
   * @param i - zero-based segment index
   * @returns the segment's decoded collection
   * @throws {Error} When the blob is not self-contained (segments cannot be
   *   decoded independently) or `i` is out of range.
   */
  segment(i: number): ValueTypeOf<T> {
    if (!this.selfContained) {
      throw new Error(`beast2 v5: blob has cross-segment aliasing — random access needs self-contained segments`);
    }
    if (i < 0 || i >= this.indexData.offsets.length) {
      throw new Error(`beast2 v5: segment ${i} out of range (${this.indexData.offsets.length} segments)`);
    }
    const cursor = new FrameReader(this.data, this.indexData.offsets[i]!);
    const reader = cursor.next();
    const n = reader.readVarint();
    if (n !== this.indexData.counts[i]) {
      throw new Error(`beast2 v5: segment ${i} declares ${n} elements, index says ${this.indexData.counts[i]}`);
    }
    const ctx: V5DecodeContext = { containers: [], sourceMap: this.sourceMap, ...buildPlatformContext(this.platform) };
    const value = this.decodeSegment(reader, ctx, n);
    if (reader.offset !== reader.buffer.length) {
      throw new Error(`beast2 v5: ${reader.buffer.length - reader.offset} logical bytes after segment ${i}`);
    }
    return value;
  }

  /** Binary-searches the cumulative counts for the segment owning `row`,
   *  returning its index and the global row of its first element. */
  private rowSegment(row: number): { seg: number; base: number } {
    let lo = 0, hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid]! <= row) lo = mid + 1;
      else hi = mid;
    }
    return { seg: lo, base: lo === 0 ? 0 : this.cumulative[lo - 1]! };
  }

  /**
   * Reads one element by row index (Array roots only): binary-searches the
   * index, decodes that single segment, and returns the row.
   *
   * @param row - zero-based element index across the whole collection
   * @returns the decoded element
   * @throws {Error} When the root is not an Array or `row` is out of range.
   */
  element(row: number): ValueTypeOf<T> extends (infer E)[] ? E : never {
    if (this.kind !== "Array") {
      throw new Error(`beast2 v5: element() addresses Array roots; this blob holds ${this.kind}`);
    }
    if (row < 0 || row >= this.elementCount) {
      throw new Error(`beast2 v5: element ${row} out of range (${this.elementCount} elements)`);
    }
    const { seg, base } = this.rowSegment(row);
    const segment = this.segment(seg) as any[];
    return segment[row - base];
  }

  /**
   * Reads a window of elements by row range (Array roots only), decoding only
   * the segments the window touches.
   *
   * Clamps like `Array.prototype.slice`: a window past the end returns the
   * available tail (or an empty array), never throws for being short.
   *
   * @param offset - zero-based row of the window's first element
   * @param limit - maximum number of elements to return
   * @returns the decoded elements from `offset`, at most `limit` of them
   * @throws {Error} When the root is not an Array, `offset`/`limit` are
   *   negative or fractional, or the blob is not self-contained.
   */
  slice(offset: number, limit: number): ValueTypeOf<T> {
    if (this.kind !== "Array") {
      throw new Error(`beast2 v5: slice() addresses Array roots; this blob holds ${this.kind}`);
    }
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0) {
      throw new Error(`beast2 v5: slice(${offset}, ${limit}) — offset and limit must be non-negative integers`);
    }
    const out: any[] = [];
    if (limit === 0 || offset >= this.elementCount) return out as ValueTypeOf<T>;
    let { seg, base } = this.rowSegment(offset);
    while (out.length < limit && seg < this.cumulative.length) {
      const segment = this.segment(seg) as any[];
      for (let i = Math.max(0, offset - base); i < segment.length && out.length < limit; i++) {
        out.push(segment[i]);
      }
      base += segment.length;
      seg++;
    }
    return out as ValueTypeOf<T>;
  }
}

/**
 * Builds a curried pages opener: `open(data)` parses the header, footer and
 * index once and returns a {@link Beast2Pages} for random access.
 *
 * @param type - the collection type (Array/Set/Dict)
 * @param options - decode options (platform functions for decoded functions)
 * @returns a function opening a blob for paged reads
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 */
export function openBeast2PagesFor<T extends EastType>(type: T | EastTypeValue, options?: Beast2DecodeOptions): (data: Uint8Array) => Beast2Pages<T> {
  const typeValue = asTypeValue(type);
  checkSegmented(typeValue);
  return (data) => new Beast2Pages<T>(data, typeValue, options);
}
