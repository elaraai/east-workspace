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

import { type EastTypeValue, EastTypeValueType, isTypeValueEqual } from "../../../type_of_type.js";
import type { EastType, ValueTypeOf } from "../../../types.js";
import { printFor } from "../../east.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { SourceMap } from "../../../location.js";
import { compareFor } from "../../../comparison.js";
import { SortedSet } from "../../../containers/sortedset.js";
import { SortedMap } from "../../../containers/sortedmap.js";
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

/** The East comparator over a stream's order key — Set elements or Dict
 *  keys; `null` for Array roots, which have no order contract. */
function orderCmpFor(typeValue: EastTypeValue, kind: SegmentedKind): ((a: any, b: any) => number) | null {
  if (kind === "Array") return null;
  return compareFor(kind === "Set" ? (typeValue as any).value : (typeValue as any).value.key);
}

/** Running strict-ascent state threaded through ordered decodes. */
type SegmentOrder = { prev: any; has: boolean };

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
  /** Emit these exact bytes as the blob's header (magic + type section +
   *  source-map section + root tag frame) instead of building one. The bytes
   *  must come from a v5 blob of the same wire type — used by splice tooling
   *  to rebuild segments byte-compatible with an existing blob's header.
   *  When set, `sourceMap` must be the prefix's own decoded source map. */
  headerPrefix?: Uint8Array;
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
  private readonly orderCmp: ((a: any, b: any) => number) | null;
  private lastKey: any;
  private hasLast = false;
  private bytesWritten = 0;
  private finished = false;

  /**
   * @param type - the collection type this stream holds (Array/Set/Dict)
   * @param sink - receives output bytes as they are produced
   * @param options - codec, self-containment, index, and source map options
   * @throws {TypeError} When `type` is not an Array, Set or Dict type, or
   *   when `options.headerPrefix` is not a v5 header of exactly `type`.
   */
  constructor(type: T | EastTypeValue, sink: (bytes: Uint8Array) => void, options?: Beast2WriterOptions) {
    const typeValue = asTypeValue(type);
    this.kind = checkSegmented(typeValue);
    this.sink = sink;
    this.codec = options?.codec ?? "deflate";
    this.selfContained = options?.selfContained ?? true;
    this.withIndex = options?.index ?? true;
    this.orderCmp = orderCmpFor(typeValue, this.kind);

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
    // as its own frame so every indexed segment frame is pure. A caller-
    // provided prefix (splice tooling) is emitted verbatim instead — after
    // verifying its wire type IS the declared type, since a mismatched
    // prefix would write a blob whose header lies about its contents.
    if (options?.headerPrefix !== undefined) {
      verifyV5Magic(options.headerPrefix);
      const prefixReader = new BufferReader(options.headerPrefix, MAGIC_BYTES_V5.length);
      const { rootType } = readTypeSection(prefixReader);
      if (!isTypeValueEqual(rootType, typeValue)) {
        const printType = printFor(EastTypeValueType);
        throw new TypeError(`beast2 v5: headerPrefix declares wire type ${printType(rootType)}, not the writer's ${printType(typeValue)} — the prefix must come from a blob of the same wire type`);
      }
      this.ctx.containerCount = 1;
      this.ctx.segmentBaseDef = 1;
      this.emit(options.headerPrefix);
      return;
    }
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
   * Set/Dict batches must continue the stream's strict East (key) order:
   * segment content is the canonical value split at segment boundaries, so
   * each batch must be internally ascending and start above the previous
   * batch's last key. Pre-sort into batches (a `SortedMap`/`SortedSet` slice,
   * or an external sort), or encode arrival order as an Array of entries.
   *
   * @param batch - a value of the declared collection type
   * @throws {Error} When called after {@link finish}, or when a Set/Dict
   *   batch violates the stream's strict ascending (key) order.
   */
  write(batch: ValueTypeOf<T>): void {
    if (this.finished) throw new Error("write() after finish()");
    const count = this.kind === "Array" ? (batch as any[]).length : (batch as any).size;
    if (count === 0) return;
    if (this.orderCmp) this.checkAscent(batch);

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

  /** Validates that a Set/Dict batch continues the stream's strict ascent
   *  in East (key) order — within the batch and against the previous batch. */
  private checkAscent(batch: any): void {
    const keys: Iterable<any> = this.kind === "Set" ? batch : (batch as Map<any, any>).keys();
    for (const k of keys) {
      if (this.hasLast && this.orderCmp!(this.lastKey, k) >= 0) {
        throw new Error(
          `beast2 v5: ${this.kind} stream batches must be strictly ascending in East ` +
          `${this.kind === "Dict" ? "key" : "element"} order — segment content is the canonical value; ` +
          `pre-sort batches, or encode arrival order as an Array`
        );
      }
      this.lastKey = k;
      this.hasLast = true;
    }
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
  const cmp = orderCmpFor(typeValue, kind);
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
    // Canonical source order: SortedSet/SortedMap iterate in East order
    // already; a plain Set/Map (insertion order) is sorted first — segments
    // must hold the canonical value, and the writer validates the ascent.
    const iterable: Iterable<unknown> = kind === "Dict"
      ? ((value as unknown) instanceof SortedMap
          ? (value as SortedMap<unknown, unknown>).entries()
          : [...(value as Map<unknown, unknown>).entries()].sort((a, b) => cmp!(a[0], b[0])))
      : kind === "Set"
        ? ((value as unknown) instanceof SortedSet
            ? (value as Iterable<unknown>)
            : [...(value as Set<unknown>)].sort(cmp!))
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

/** Builds the per-segment decode closure shared by the iterator and pages.
 *
 *  For Set/Dict, an `order` state threads the strict-ascent validation: each
 *  decoded element/key must exceed `order.prev`. Passing one state across
 *  consecutive segments extends the check over the segment boundary; a fresh
 *  state validates a single segment in isolation. Violations are corruption
 *  (the wire must hold the canonical value), never data to repair. */
function buildSegmentDecoder(typeValue: EastTypeValue, kind: SegmentedKind): (reader: BufferReader, ctx: V5DecodeContext, n: number, order?: SegmentOrder) => any {
  const typeCtx = new Map<bigint, any>();
  const cmp = orderCmpFor(typeValue, kind);
  if (kind === "Dict") {
    const key = buildV5Decoder((typeValue as any).value.key, typeCtx);
    const val = buildV5Decoder((typeValue as any).value.value, typeCtx);
    return (reader, ctx, n, order) => {
      const map = new Map<any, any>();
      for (let i = 0; i < n; i++) {
        const k = key(reader, ctx);
        if (order) {
          if (order.has && cmp!(order.prev, k) >= 0) {
            throw new Error(`beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)`);
          }
          order.prev = k;
          order.has = true;
        }
        const v = val(reader, ctx);
        map.set(k, v);
      }
      if (ctx.frozen) Object.freeze(map);
      return map;
    };
  }
  const elem = buildV5Decoder((typeValue as any).value, typeCtx);
  if (kind === "Set") {
    return (reader, ctx, n, order) => {
      const set = new Set<any>();
      for (let i = 0; i < n; i++) {
        const item = elem(reader, ctx);
        if (order) {
          if (order.has && cmp!(order.prev, item) >= 0) {
            throw new Error(`beast2 v5: Set elements are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)`);
          }
          order.prev = item;
          order.has = true;
        }
        set.add(item);
      }
      if (ctx.frozen) Object.freeze(set);
      return set;
    };
  }
  return (reader, ctx, n) => {
    const arr: any[] = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = elem(reader, ctx);
    if (ctx.frozen) Object.freeze(arr);
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
    const ctx: V5DecodeContext = { containers: [], sourceMap, frozen: options?.frozen ?? false, ...buildPlatformContext(options) };
    const cursor = new FrameReader(data, frameOffset);

    let reader = cursor.next();
    const tag = reader.readUint8();
    if (tag !== TAG_NEW) {
      throw new Error(`beast2 v5: root container must be NEW (tag 0x${tag.toString(16)})`);
    }
    // The root container is definition 0 — segments never alias it, but the
    // definition numbering must match the writer's.
    ctx.containers.push(kind === "Array" ? [] : kind === "Set" ? new Set() : new Map());

    // One order state across all segments: Set/Dict streams must ascend
    // strictly over the whole stream, including across segment boundaries.
    const order: SegmentOrder | undefined = kind === "Array" ? undefined : { prev: undefined, has: false };
    for (;;) {
      if (reader.offset === reader.buffer.length) reader = cursor.next();
      const n = reader.readVarint();
      if (n === 0) break;
      yield decodeSegment(reader, ctx, n, order);
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

/** Decoded segments retained by a {@link Beast2Pages} for its element and
 *  keyed read paths (mirrors east-c's `B2V5_PAGES_LRU`): a keyed/indexed
 *  read loop over neighbouring rows then decodes each segment once instead
 *  of once per element. Bounded — at most this many decoded segments live
 *  per reader. */
const SEGMENT_CACHE_CAPACITY = 4;

/**
 * Random access over an indexed, self-contained v5 collection blob.
 *
 * Reads the footer + index once; `elementCount` is O(1) from the index, and
 * {@link segment} seeks to and decodes exactly one segment. Requires the blob
 * to carry an index (written by default by {@link Beast2Writer}); random
 * access additionally requires self-contained segments. The element and keyed
 * read paths ({@link element} / {@link get}) reuse decoded segments through a
 * small LRU, so a read loop over neighbouring rows decodes each segment once
 * rather than once per element; {@link segment} itself always decodes fresh.
 *
 * Set/Dict blobs page like Arrays: the wire holds the canonical value split
 * at segment boundaries (strictly ascending, disjoint segments), so row
 * windows ({@link slice}) and key lookups ({@link get}) address the sorted
 * order directly. The first Set/Dict access verifies the segment fences
 * (each segment's first key, probed without decoding whole segments) ascend
 * strictly, and every decoded segment is validated internally and against
 * the next fence — a blob violating the canonical-order contract fails with
 * a corruption error rather than mis-addressing rows.
 */
export class Beast2Pages<T extends EastType = EastType> {
  /** Per-segment element counts from the index (pairs for Dict roots). */
  readonly counts: readonly number[];
  /** Sum of all segment counts — the exact element (pair) count for every
   *  root kind: Set/Dict segments are disjoint ranges of the canonical
   *  value, so counts never overlap. */
  readonly elementCount: number;
  /** Whether segments are independently decodable. */
  readonly selfContained: boolean;
  private readonly data: Uint8Array;
  private readonly indexData: Beast2Index;
  private readonly kind: SegmentedKind;
  private readonly typeValue: EastTypeValue;
  private readonly sourceMap: SourceMap;
  private readonly decodeSegment: (reader: BufferReader, ctx: V5DecodeContext, n: number, order?: SegmentOrder) => any;
  private readonly platform: Beast2DecodeOptions | undefined;
  private readonly cumulative: number[];
  private readonly orderCmp: ((a: any, b: any) => number) | null;
  /** First key/element of each segment, in segment order (Set/Dict only). */
  private fences: any[] | null = null;
  private fenceDec: ((reader: BufferReader, ctx: V5DecodeContext) => any) | null = null;
  /** Decoded segments kept hot for the element and keyed read paths, keyed
   *  by segment index in LRU order (mirrors east-c's `B2V5_PAGES_LRU`).
   *  Only {@link element} and {@link get} route through it — the public
   *  {@link segment} stays a fresh decode, so a caller mutating its result
   *  cannot poison the cache. `first`/`last` carry a Set/Dict segment's key
   *  range so a hit can maintain the caller's order threading without a
   *  container walk. */
  private readonly segmentCache = new Map<number, { seg: any; first: any; last: any }>();

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
    this.typeValue = typeValue;
    this.sourceMap = sourceMap;
    this.decodeSegment = buildSegmentDecoder(typeValue, kind);
    this.platform = options;
    this.counts = index.counts;
    this.elementCount = index.totalCount;
    this.selfContained = index.selfContained;
    this.orderCmp = orderCmpFor(typeValue, kind);
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
   * Set/Dict segments are validated for strict internal ascent as they
   * decode (the canonical-order contract); a violation is a corruption
   * error, not data.
   *
   * @param i - zero-based segment index
   * @returns the segment's decoded collection
   * @throws {Error} When the blob is not self-contained (segments cannot be
   *   decoded independently), `i` is out of range, or a Set/Dict segment
   *   violates strict ascending order.
   */
  segment(i: number): ValueTypeOf<T> {
    const order: SegmentOrder | undefined = this.kind === "Array" ? undefined : { prev: undefined, has: false };
    return this.decodeSegmentCore(i, order);
  }

  /** Seeks to and decodes segment `i`, threading the caller's order state. */
  private decodeSegmentCore(i: number, order: SegmentOrder | undefined): any {
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
    const ctx: V5DecodeContext = { containers: [], sourceMap: this.sourceMap, frozen: this.platform?.frozen ?? false, ...buildPlatformContext(this.platform) };
    const value = this.decodeSegment(reader, ctx, n, order);
    if (reader.offset !== reader.buffer.length) {
      throw new Error(`beast2 v5: ${reader.buffer.length - reader.offset} logical bytes after segment ${i}`);
    }
    return value;
  }

  /** Decodes segment `i` through the LRU cache, threading the caller's
   *  order state exactly as a fresh decode would: a hit replays the
   *  boundary-ascent check against the cached segment's first key and
   *  advances `order` to its last. Serves {@link element} and {@link get}
   *  only — see {@link segmentCache}. */
  private segmentCached(i: number, order: SegmentOrder | undefined): any {
    const hit = this.segmentCache.get(i);
    if (hit !== undefined) {
      this.segmentCache.delete(i);
      this.segmentCache.set(i, hit); // refresh recency
      if (order !== undefined && this.orderCmp !== null) {
        if (order.has && this.orderCmp(order.prev, hit.first) >= 0) {
          throw new Error(`beast2 v5: ${this.kind === "Dict" ? "Dict keys" : "Set elements"} are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)`);
        }
        order.prev = hit.last;
        order.has = true;
      }
      return hit.seg;
    }
    const seg = this.decodeSegmentCore(i, order);
    let first: any;
    let last: any;
    if (this.kind !== "Array") {
      first = (this.kind === "Set" ? (seg as Set<any>).values() : (seg as Map<any, any>).keys()).next().value;
      // Segments are never empty, so a Set/Dict decode leaves the caller's
      // order state on the segment's last key.
      last = order?.prev;
    }
    this.segmentCache.set(i, { seg, first, last });
    if (this.segmentCache.size > SEGMENT_CACHE_CAPACITY) {
      this.segmentCache.delete(this.segmentCache.keys().next().value!);
    }
    return seg;
  }

  /** Decodes just the first key/element of segment `i` — a bounded probe
   *  (one frame inflate, one element decode), not a whole-segment decode. */
  private firstKey(i: number): any {
    if (!this.fenceDec) {
      const keyType = this.kind === "Dict" ? (this.typeValue as any).value.key : (this.typeValue as any).value;
      this.fenceDec = buildV5Decoder(keyType);
    }
    const cursor = new FrameReader(this.data, this.indexData.offsets[i]!);
    const reader = cursor.next();
    reader.readVarint();  // element count — segments are never empty
    const ctx: V5DecodeContext = { containers: [], sourceMap: this.sourceMap, frozen: this.platform?.frozen ?? false, ...buildPlatformContext(this.platform) };
    return this.fenceDec(reader, ctx);
  }

  /**
   * Probes segment `i`'s fence: its first Dict key, Set element, or Array
   * element, decoded without decoding the rest of the segment (one frame
   * inflate, one element decode).
   *
   * For Set/Dict roots the fences bound each segment's canonical key range —
   * segment `i` holds exactly the keys in `[fence(i), fence(i+1))` — which is
   * what partition-boundary selection walks.
   *
   * @param i - zero-based segment index
   * @returns the segment's first key or element
   * @throws {Error} When `i` is out of range or the blob is not
   *   self-contained.
   */
  fence(i: number): ValueTypeOf<T> extends Map<infer K, any> ? K : ValueTypeOf<T> extends Set<infer E> ? E : ValueTypeOf<T> extends (infer E)[] ? E : never {
    if (!this.selfContained) {
      throw new Error(`beast2 v5: blob has cross-segment aliasing — random access needs self-contained segments`);
    }
    if (i < 0 || i >= this.indexData.offsets.length) {
      throw new Error(`beast2 v5: segment ${i} out of range (${this.indexData.offsets.length} segments)`);
    }
    return this.firstKey(i);
  }

  /** Probes and verifies the segment fences once: each segment's first
   *  key/element must ascend strictly across segments. */
  private verifyFences(): any[] {
    if (this.fences) return this.fences;
    if (!this.selfContained) {
      throw new Error(`beast2 v5: blob has cross-segment aliasing — random access needs self-contained segments`);
    }
    const n = this.indexData.offsets.length;
    const fences: any[] = new Array(n);
    for (let i = 0; i < n; i++) fences[i] = this.firstKey(i);
    for (let i = 1; i < n; i++) {
      if (this.orderCmp!(fences[i - 1], fences[i]) >= 0) {
        throw new Error(`beast2 v5: segments ${i - 1} and ${i} are not disjoint ascending ${this.kind === "Dict" ? "key" : "element"} ranges — the wire must hold the canonical value (corrupt or pre-contract blob)`);
      }
    }
    this.fences = fences;
    return fences;
  }

  /** Decodes segment `i` with order threading, then checks its tail stays
   *  below the next segment's fence (segments must be disjoint ranges).
   *  Pass `cached` on the keyed read path to route through the segment LRU. */
  private decodeDisjoint(i: number, order: SegmentOrder, fences: any[], cached = false): any {
    const value = cached ? this.segmentCached(i, order) : this.decodeSegmentCore(i, order);
    if (i + 1 < fences.length && order.has && this.orderCmp!(order.prev, fences[i + 1]) >= 0) {
      throw new Error(`beast2 v5: segments ${i} and ${i + 1} are not disjoint ascending ${this.kind === "Dict" ? "key" : "element"} ranges — the wire must hold the canonical value (corrupt or pre-contract blob)`);
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
    const segment = this.segmentCached(seg, undefined) as any[];
    return segment[row - base];
  }

  /**
   * Reads a window of the collection by row range, decoding only the
   * segments the window touches.
   *
   * Rows address stream order — for Array roots the element order, for
   * Set/Dict roots the canonical East (key) order, since segments are
   * disjoint ascending ranges. Returns a collection value of the root kind
   * holding the window (an array, `Set`, or `Map` in that order).
   *
   * Clamps like `Array.prototype.slice`: a window past the end returns the
   * available tail (or an empty collection), never throws for being short.
   *
   * @param offset - zero-based row of the window's first element
   * @param limit - maximum number of elements (pairs) to return
   * @returns a collection of the root kind with the window's contents
   * @throws {Error} When `offset`/`limit` are negative or fractional, the
   *   blob is not self-contained, or a Set/Dict blob violates the
   *   canonical-order contract (non-ascending or overlapping segments).
   */
  slice(offset: number, limit: number): ValueTypeOf<T> {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0) {
      throw new Error(`beast2 v5: slice(${offset}, ${limit}) — offset and limit must be non-negative integers`);
    }
    const empty = (): any => this.kind === "Array" ? [] : this.kind === "Set" ? new Set() : new Map();
    if (limit === 0 || offset >= this.elementCount) return empty() as ValueTypeOf<T>;

    if (this.kind === "Array") {
      const out: any[] = [];
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

    // Set/Dict: rows address the canonical sorted order. Verify the fence
    // chain once, then decode the touched segments with one running order
    // state (validating ascent inside and across them) and a tail check
    // against the fence of the first untouched segment.
    const fences = this.verifyFences();
    const isSet = this.kind === "Set";
    const out = (isSet ? new Set<any>() : new Map<any, any>());
    let taken = 0;
    let { seg, base } = this.rowSegment(offset);
    const order: SegmentOrder = { prev: undefined, has: false };
    while (taken < limit && seg < this.cumulative.length) {
      const segment = this.decodeDisjoint(seg, order, fences);
      let skip = Math.max(0, offset - base);
      if (isSet) {
        for (const item of segment as Set<any>) {
          if (skip > 0) { skip--; continue; }
          if (taken >= limit) break;
          (out as Set<any>).add(item);
          taken++;
        }
      } else {
        for (const [k, v] of (segment as Map<any, any>).entries()) {
          if (skip > 0) { skip--; continue; }
          if (taken >= limit) break;
          (out as Map<any, any>).set(k, v);
          taken++;
        }
      }
      base += (segment as Set<any> | Map<any, any>).size;
      seg++;
    }
    return out as ValueTypeOf<T>;
  }

  /**
   * Looks up one Set element or Dict value by key (Set/Dict roots only):
   * binary-searches the verified segment fences for the only segment whose
   * range can hold the key, decodes it, and scans for an East-equal match.
   *
   * @param key - the Set element or Dict key to look up
   * @returns the Dict value (or the stored Set element) for `key`, or
   *   `undefined` when the collection does not contain it
   * @throws {Error} When the root is an Array, the blob is not
   *   self-contained, or the blob violates the canonical-order contract.
   */
  get(
    key: ValueTypeOf<T> extends Map<infer K, any> ? K : ValueTypeOf<T> extends Set<infer E> ? E : never,
  ): (ValueTypeOf<T> extends Map<any, infer V> ? V : ValueTypeOf<T> extends Set<infer E> ? E : never) | undefined {
    if (this.kind === "Array") {
      throw new Error(`beast2 v5: get() addresses Set and Dict roots; this blob holds Array — use element() or slice()`);
    }
    if (this.elementCount === 0) return undefined;
    const fences = this.verifyFences();
    // Greatest segment whose fence is <= key; a key below every fence is
    // below the collection's minimum.
    let lo = 0, hi = fences.length - 1;
    if (this.orderCmp!(key, fences[0]) < 0) return undefined;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.orderCmp!(fences[mid], key) <= 0) lo = mid;
      else hi = mid - 1;
    }
    const order: SegmentOrder = { prev: undefined, has: false };
    const segment = this.decodeDisjoint(lo, order, fences, true);
    if (this.kind === "Set") {
      for (const item of segment as Set<any>) {
        if (this.orderCmp!(item, key) === 0) return item;
      }
      return undefined;
    }
    for (const [k, v] of (segment as Map<any, any>).entries()) {
      if (this.orderCmp!(k, key) === 0) return v;
    }
    return undefined;
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
