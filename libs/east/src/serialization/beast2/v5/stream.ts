/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 streaming and paging APIs.
 *
 * - {@link Beast2ElementWriter} — the canonical writer: elements in, segments
 *   out where the content-defined cut rule places them, so a collection's
 *   bytes are a function of its value alone — as one blob, or as the
 *   standalone segment blobs a manifest names. Every writer of a stored
 *   collection writes through it.
 * - {@link encodeBeast2PagedFor} — one whole value through the element writer.
 * - {@link Beast2Writer} — append-only streaming writer: each `write(batch)`
 *   becomes one root segment (one frame), so writer memory is O(batch), never
 *   the whole collection. The geometry is the caller's.
 * - {@link encodeBeast2SegmentsFor} — in-memory convenience over the writer.
 * - {@link iterBeast2SegmentsFor} — sequential segment iterator: yields one
 *   decoded collection per root segment with O(segment) decoded memory.
 * - {@link openBeast2PagesFor} — random access over an indexed blob: O(1)
 *   `elementCount`, per-segment decode via footer + index seeks.
 *
 * Streaming roots are collections (Array/Set/Dict). Writers default to
 * self-contained output — aliasing scoped per root element — so segments are
 * pageable and parallel-decodable and an element's bytes depend on the element
 * alone; pass `selfContained: false` to keep whole-stream aliasing at the cost
 * of random access.
 */

import { type EastTypeValue, EastTypeValueType, isTypeValueEqual } from "../../../type_of_type.js";
import type { ArrayType, DictType, EastType, SetType, ValueTypeOf } from "../../../types.js";
import { printFor } from "../../east.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { SourceMap } from "../../../location.js";
import { compareFor } from "../../../comparison.js";
import { SortedSet } from "../../../containers/sortedset.js";
import { SortedMap } from "../../../containers/sortedmap.js";
import { type Beast2DecodeOptions, buildPlatformContext } from "../shared.js";
import { writeTypeSection, readTypeSection, asTypeValue } from "./type-section.js";
import { type Beast2Codec, FrameReader, openFramePrefix, writeFrame } from "./frames.js";
import { framePool, type FramePool, type PendingFrame } from "./frame-pool.js";
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
import { type Beast2SyncRangeReader, TAG_OR_TERMINATOR_FRAME, bytesReader, isBeast2SyncRangeReader, readExact, readU64LE, readBeast2ExtentsSync } from "./range.js";
import { SegmentCutter, decodeBeast2FenceFor } from "./boundary.js";
import { isBeast2ManifestSource, type Beast2ManifestSource } from "./manifest.js";

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
  /** Scope aliasing per root element, so segments decode independently and an
   *  element's bytes never depend on which objects its neighbours share: the
   *  same collection encodes to the same bytes however it was built, and an
   *  encoded element can move between segments by byte copy. Defaults to
   *  `true`. */
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
  /**
   * Deflate frames on worker threads (issue #763). Defaults to `false`.
   *
   * The bytes are identical either way: frames reach the sink in order, and
   * index offsets are assigned as they land. The pool has one worker per CPU
   * the process may use, at most 32 — a writer keeps two frames per worker in
   * flight, and throughput flattens well before that. Node only; elsewhere,
   * and on a single CPU, the writer frames inline.
   */
  parallel?: boolean;
};

/** Logical bytes a parallel writer produces inline before it asks for the
 *  frame pool: workers cost tens of milliseconds to start, and a value this
 *  small deflates faster than that on one thread. */
const POOL_MIN_LOGICAL_BYTES = 8 * 1024 * 1024;

// =============================================================================
// Framing
// =============================================================================

/**
 * Frames segments' logical bytes — inline, or on the frame pool — and lands
 * each frame in the order its segment was submitted, with what the submitter
 * said about it. Both writers frame through one of these.
 */
class FramePipeline<I> {
  private readonly codec: Beast2Codec;
  private readonly parallel: boolean;
  private readonly land: (frame: Uint8Array, info: I) => void;
  /** `undefined` until decided; `null` when frames are written inline. */
  private pool: FramePool | null | undefined;
  private logicalWritten = 0;
  /** Frames submitted to the pool and not yet landed, in order. */
  private readonly inflight: { frame: PendingFrame; info: I }[] = [];

  constructor(codec: Beast2Codec, parallel: boolean, land: (frame: Uint8Array, info: I) => void) {
    this.codec = codec;
    this.parallel = parallel;
    this.land = land;
  }

  /** Frames one segment, or hands it to the pool; its frame lands once every
   *  frame submitted before it has. */
  submit(logical: Uint8Array, info: I): void {
    this.logicalWritten += logical.length;
    const pool = this.poolFor();
    if (pool === null) {
      const frame = new BufferWriter();
      writeFrame(frame, logical, this.codec);
      this.land(frame.toUint8Array(), info);
      return;
    }
    // Back-pressure: at most two frames per worker in flight, so the
    // writer's memory stays O(workers x segment).
    while (this.inflight.length >= pool.workers * 2) this.appendFrames(1);
    this.inflight.push({ frame: pool.submit(logical, this.codec), info });
    this.appendFrames(0);
  }

  /** Lands every in-flight frame. */
  settle(): void {
    this.appendFrames(Infinity);
  }

  /** The pool to frame on — decided once a parallel writer has produced
   *  enough bytes to be worth it. While frames are in flight the writer keeps
   *  the pool they are on, so frames cannot interleave out of order; with none
   *  in flight it follows the process's current pool — a new one after an idle
   *  pool retired its workers, `null` once a pool has lost a worker — so a
   *  writer never submits to terminated workers. */
  private poolFor(): FramePool | null {
    if (this.pool === undefined) {
      if (!this.parallel || this.logicalWritten < POOL_MIN_LOGICAL_BYTES) return null;
      this.pool = framePool();
    } else if (this.pool !== null && this.inflight.length === 0) {
      this.pool = framePool();
    }
    return this.pool;
  }

  /** Lands the done frames at the head of the in-flight queue, in order;
   *  blocks until at least `minimum` have landed (`Infinity` settles the
   *  queue). */
  private appendFrames(minimum: number): void {
    let appended = 0;
    while (this.inflight.length > 0) {
      const head = this.inflight[0]!;
      if (appended >= minimum && !head.frame.ready()) return;
      const bytes = head.frame.take();
      this.inflight.shift();
      this.land(bytes, head.info);
      appended++;
    }
  }
}

/**
 * The header a collection blob of `typeValue` starts with: magic, type
 * section, source-map section, then the root tag as its own frame so every
 * indexed segment frame is pure. A caller-provided prefix (splice tooling) is
 * the header instead — after verifying its wire type IS the declared type,
 * since a mismatched prefix would write a blob whose header lies about its
 * contents.
 */
function headerFor(typeValue: EastTypeValue, sourceMap: SourceMap | null, headerPrefix: Uint8Array | undefined): Uint8Array {
  if (headerPrefix !== undefined) {
    verifyV5Magic(headerPrefix);
    const prefixReader = new BufferReader(headerPrefix, MAGIC_BYTES_V5.length);
    const { rootType } = readTypeSection(prefixReader);
    if (!isTypeValueEqual(rootType, typeValue)) {
      const printType = printFor(EastTypeValueType);
      throw new TypeError(`beast2 v5: headerPrefix declares wire type ${printType(rootType)}, not the writer's ${printType(typeValue)} — the prefix must come from a blob of the same wire type`);
    }
    return headerPrefix;
  }
  const head = new BufferWriter();
  head.writeBytes(MAGIC_BYTES_V5);
  writeTypeSection(typeValue, head);
  writeSourceMapSectionV5(sourceMap, head);
  writeFrame(head, new Uint8Array([TAG_NEW]), "none");
  return head.toUint8Array();
}

/** A segment as a standalone blob: the collection's header, the segment's
 *  frame, the terminator, and an index naming the one segment — byte for byte
 *  what carving it out of the whole blob gives. */
function segmentBlob(head: Uint8Array, frame: Uint8Array, count: number): Uint8Array {
  const blob = new BufferWriter(head.length + frame.length + TAG_OR_TERMINATOR_FRAME.length + 32);
  blob.writeBytes(head);
  blob.writeBytes(frame);
  blob.writeBytes(TAG_OR_TERMINATOR_FRAME);
  writeIndexAndFooter(blob, [{ offset: head.length, count }], true);
  return blob.toUint8Array();
}

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
 * Where the segments fall is the caller's choice here. A collection that is
 * stored is written through {@link Beast2ElementWriter} instead, which cuts
 * where the content-defined rule says, so equal values store as equal bytes.
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
  /** Frames each segment and puts it on the sink as it lands, recording its
   *  index entry there. */
  private readonly frames: FramePipeline<number>;

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
    this.selfContained = options?.selfContained ?? true;
    this.withIndex = options?.index ?? true;
    this.orderCmp = orderCmpFor(typeValue, this.kind);
    this.frames = new FramePipeline<number>(options?.codec ?? "deflate", options?.parallel ?? false, (frame, count) => {
      this.index.push({ offset: this.bytesWritten, count });
      this.emit(frame);
    });

    const sourceMap = options?.sourceMap ?? null;
    this.ctx = createV5EncodeContext(sourceMap, this.selfContained);

    // A self-contained stream starts every root element with an empty identity
    // map, so no REF reaches past the element it sits in: sharing inside an
    // element is kept, sharing between elements is written out again.
    const scoped = this.selfContained;
    const typeCtx = new Map<bigint, any>();
    if (this.kind === "Dict") {
      const key = buildV5Encoder((typeValue as any).value.key, typeCtx);
      const val = buildV5Encoder((typeValue as any).value.value, typeCtx);
      this.encodeElems = (value, logical) => {
        for (const [k, v] of value) {
          if (scoped) {
            this.ctx.containerIndex.clear();
            this.ctx.segmentBaseDef = this.ctx.containerCount;
          }
          key(k, logical, this.ctx);
          val(v, logical, this.ctx);
        }
      };
    } else {
      const elem = buildV5Encoder((typeValue as any).value, typeCtx);
      this.encodeElems = (value, logical) => {
        for (const item of value) {
          if (scoped) {
            this.ctx.containerIndex.clear();
            this.ctx.segmentBaseDef = this.ctx.containerCount;
          }
          elem(item, logical, this.ctx);
        }
      };
    }

    const head = headerFor(typeValue, sourceMap, options?.headerPrefix);
    // The root container consumes definition 0 (no root object exists on the
    // encode side — batches are independent values, so nothing can alias it);
    // segments scope from definition 1 to match the decoder's numbering.
    this.ctx.containerCount = 1;
    this.ctx.segmentBaseDef = 1;
    this.emit(head);
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
   * @throws {Error} When called after {@link finish}, when a Set/Dict
   *   batch violates the stream's strict ascending (key) order, or — for a
   *   parallel writer — when a frame worker failed to build a frame or stopped
   *   responding. A lost frame cannot be rebuilt, so the stream fails loudly
   *   and cannot be finished; the process frames inline from then on.
   */
  write(batch: ValueTypeOf<T>): void {
    if (this.finished) throw new Error("write() after finish()");
    const count = this.kind === "Array" ? (batch as any[]).length : (batch as any).size;
    if (count === 0) return;
    if (this.orderCmp) this.checkAscent(batch);

    const logical = new BufferWriter();
    logical.writeVarint(count);
    this.encodeElems(batch, logical);
    this.frameSegment(count, logical.toUint8Array());
  }

  /**
   * Writes one root segment from elements that are already encoded — each in
   * its canonical bytes, with aliasing scoped to itself — which is how
   * {@link Beast2ElementWriter} writes the segments it cuts.
   *
   * The elements are copied before this returns, so the caller may reuse the
   * buffer. Their order is the caller's to keep: nothing here decodes them to
   * check a Set or Dict's ascent.
   *
   * @param count - the elements (pairs, for a Dict) the bytes hold; a
   *   zero-count segment is skipped
   * @param elements - the elements' bytes, back to back
   * @throws {Error} When called after {@link finish}, or — for a parallel
   *   writer — when a frame worker failed (see {@link write}).
   */
  writeEncodedSegment(count: number, elements: Uint8Array): void {
    if (this.finished) throw new Error("write() after finish()");
    if (count === 0) return;
    const logical = new BufferWriter(elements.length + 10);
    logical.writeVarint(count);
    logical.writeBytes(elements);
    this.frameSegment(count, logical.toUint8Array());
  }

  /** Frames one segment's logical bytes — inline, or on the frame pool — and
   *  records its index entry as its frame lands. */
  private frameSegment(count: number, logicalBytes: Uint8Array): void {
    this.segments++;
    this.frames.submit(logicalBytes, count);
  }

  /**
   * Waits for every in-flight frame and passes it to the sink, so the sink
   * holds every segment written so far. A writer about to go quiet then holds
   * nothing on the pool, which lets an idle pool retire its workers. A no-op
   * for a serial writer.
   *
   * @throws {Error} For a parallel writer, when an in-flight frame's worker
   *   failed or stopped responding (see {@link write}).
   */
  settle(): void {
    this.frames.settle();
  }

  /**
   * Terminates the stream: writes the terminator frame and, unless disabled,
   * the index and footer. Idempotent.
   *
   * @throws {Error} For a parallel writer, when an in-flight frame's worker
   *   failed or stopped responding (see {@link write}).
   */
  finish(): void {
    if (this.finished) return;
    this.frames.settle();
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
// Canonical element writer
// =============================================================================

/** An element of a collection type as {@link Beast2ElementWriter.add} takes
 *  it: an Array or Set element, or a Dict's `[key, value]` pair. */
export type Beast2ElementOf<T> =
  T extends DictType<infer K, infer V> ? [ValueTypeOf<K>, ValueTypeOf<V>] :
  T extends SetType<infer E> ? ValueTypeOf<E> :
  T extends ArrayType<infer E> ? ValueTypeOf<E> :
  unknown;

/** Options accepted by {@link Beast2ElementWriter}. Its blobs are always
 *  indexed and self-contained, so neither is an option here. */
export type Beast2ElementWriterOptions = Omit<Beast2WriterOptions, "selfContained" | "index">;

/**
 * One segment of a collection as a store keeps it: a standalone blob, and what
 * a manifest entry records of it.
 */
export interface Beast2Segment {
  /** Elements (pairs, for a Dict) in the segment. */
  readonly count: number;
  /** Set/Dict: the segment's first key in its canonical bare encoding
   *  (`encodeBeast2FenceFor`) — its fence. Array: empty. */
  readonly fence: Uint8Array;
  /** The segment's logical size: its elements' canonical bytes before
   *  compression, which is what the cut rule measures a segment by. */
  readonly logicalBytes: number;
  /** The segment as a standalone v5 blob: the collection's header, the
   *  segment's frame, the terminator, and an index of the one segment. */
  readonly blob: Uint8Array;
}

/** Where a {@link Beast2ElementWriter} puts a collection written as separate
 *  segment blobs rather than one blob. */
export interface Beast2SegmentSink {
  /**
   * Receives each segment once it is written, in order.
   *
   * @param segment - the segment
   */
  segment(segment: Beast2Segment): void;
}

/** What a segment's frame lands with, before its blob is assembled. */
type SegmentFacts = Omit<Beast2Segment, "blob">;

/**
 * Builds an encoder of a collection's root elements, one at a time, each in
 * its canonical bytes: aliasing is scoped to the element, so no REF reaches a
 * neighbour and the element's bytes depend on it alone.
 *
 * @param typeValue - the collection type (Array/Set/Dict)
 * @param sourceMap - the stream's source map, for function values
 * @returns a function appending one element's bytes to a writer and returning
 *   the length of its key: a Set element's whole length, a Dict pair's key, 0
 *   for an Array element, which has none
 * @throws {TypeError} When `typeValue` is not an Array, Set or Dict type.
 * @internal
 */
export function elementEncoderFor(typeValue: EastTypeValue, sourceMap: SourceMap | null): (element: unknown, writer: BufferWriter) => number {
  const kind = checkSegmented(typeValue);
  const ctx = createV5EncodeContext(sourceMap, true);
  // The root container is definition 0, so elements define from 1.
  ctx.containerCount = 1;
  const typeCtx = new Map<bigint, any>();
  if (kind === "Dict") {
    const key = buildV5Encoder((typeValue as any).value.key, typeCtx);
    const value = buildV5Encoder((typeValue as any).value.value, typeCtx);
    return (element, writer) => {
      ctx.containerIndex.clear();
      ctx.segmentBaseDef = ctx.containerCount;
      const start = writer.size;
      key((element as [unknown, unknown])[0], writer, ctx);
      const keyLength = writer.size - start;
      value((element as [unknown, unknown])[1], writer, ctx);
      return keyLength;
    };
  }
  const elem = buildV5Encoder((typeValue as any).value, typeCtx);
  const keyed = kind === "Set";
  return (element, writer) => {
    ctx.containerIndex.clear();
    ctx.segmentBaseDef = ctx.containerCount;
    const start = writer.size;
    elem(element, writer, ctx);
    return keyed ? writer.size - start : 0;
  };
}

/**
 * The canonical writer of a collection: elements go in one at a time, in
 * canonical order, and segments come out wherever the content-defined cut rule
 * ({@link SegmentCutter}) places them — as one blob, or as the standalone
 * segment blobs a manifest names, one at a time to a {@link Beast2SegmentSink}.
 *
 * Each element is encoded as it arrives, with aliasing scoped to itself, so
 * its bytes depend on the element alone — and the cut rule reads nothing but
 * those bytes. The blob is therefore a function of the value: whichever
 * process writes a collection, in whichever runtime, and however its elements
 * were produced, it writes the same bytes. That is what lets a
 * content-addressed store keep an equal value once and diff two values by
 * segment.
 *
 * Memory is one open segment. Elements that are already encoded — sorted runs,
 * a merge, a re-cut — go in through {@link addEncoded}, without a decode.
 *
 * @example
 * ```ts
 * const chunks: Uint8Array[] = [];
 * const type = DictType(StringType, IntegerType);
 * const writer = new Beast2ElementWriter(type, (b) => chunks.push(b));
 * writer.add(["a", 1n]);
 * writer.add(["b", 2n]);
 * writer.finish();
 * decodeBeast2For(type)(Buffer.concat(chunks));  // Map { "a" => 1n, "b" => 2n }
 *
 * const segments: Beast2Segment[] = [];
 * const split = new Beast2ElementWriter(type, { segment: (s) => segments.push(s) });
 * split.add(["a", 1n]);
 * split.finish();
 * segments[0].blob;  // segment 0 as a standalone blob, under split.header
 * ```
 */
export class Beast2ElementWriter<T extends EastType = EastType> {
  private readonly kind: SegmentedKind;
  /** The writer of the one blob, when that is the output. */
  private readonly blob: Beast2Writer<T> | null;
  /** The framing of the segment blobs, when those are the output. */
  private readonly frames: FramePipeline<SegmentFacts> | null;
  private readonly head: Uint8Array;
  private readonly encodeElement: (element: unknown, writer: BufferWriter) => number;
  private readonly orderCmp: ((a: any, b: any) => number) | null;
  private cutter = new SegmentCutter();
  /** The open segment's elements, back to back. */
  private readonly open = new BufferWriter();
  /** Elements in the open segment. */
  private count = 0;
  /** The length of the open segment's first key — its fence. */
  private firstKeyLength = 0;
  private written = 0;
  private lastKey: unknown;
  private hasLast = false;
  private finished = false;

  /**
   * @param type - the collection type (Array/Set/Dict)
   * @param sink - receives the blob's bytes as they are produced; or, as a
   *   {@link Beast2SegmentSink}, each segment as a standalone blob
   * @param options - codec, source map, header prefix and parallel framing
   * @throws {TypeError} When `type` is not an Array, Set or Dict type, or
   *   when `options.headerPrefix` is not a v5 header of exactly `type`.
   */
  constructor(type: T | EastTypeValue, sink: ((bytes: Uint8Array) => void) | Beast2SegmentSink, options?: Beast2ElementWriterOptions) {
    const typeValue = asTypeValue(type);
    this.kind = checkSegmented(typeValue);
    this.orderCmp = orderCmpFor(typeValue, this.kind);
    this.encodeElement = elementEncoderFor(typeValue, options?.sourceMap ?? null);
    const head = headerFor(typeValue, options?.sourceMap ?? null, options?.headerPrefix);
    this.head = head;
    if (typeof sink === "function") {
      this.blob = new Beast2Writer<T>(typeValue, sink, options);
      this.frames = null;
    } else {
      this.blob = null;
      this.frames = new FramePipeline<SegmentFacts>(options?.codec ?? "deflate", options?.parallel ?? false,
        (frame, facts) => sink.segment({ ...facts, blob: segmentBlob(head, frame, facts.count) }));
    }
  }

  /** Segments written so far; the open segment is not among them until the
   *  cut rule closes it or {@link finish} does. */
  get segments(): number {
    return this.written;
  }

  /** The header every segment is written under — magic, type section,
   *  source-map section and root tag — which a manifest names as its header. */
  get header(): Uint8Array {
    return this.head;
  }

  /**
   * Encodes one element and appends it to the collection.
   *
   * @param element - an Array or Set element, or a Dict's `[key, value]` pair
   * @throws {Error} When called after {@link finish}, when a Set element or
   *   Dict key does not ascend strictly from the last in East order, or when
   *   the element cannot be encoded — which leaves the writer as it was.
   */
  add(element: Beast2ElementOf<T>): void {
    if (this.finished) throw new Error("add() after finish()");
    let key: unknown;
    if (this.orderCmp !== null) {
      key = this.kind === "Dict" ? (element as [unknown, unknown])[0] : element;
      if (this.hasLast && this.orderCmp(this.lastKey, key) >= 0) {
        throw new Error(
          `beast2 v5: ${this.kind} ${this.kind === "Dict" ? "keys" : "elements"} must arrive strictly ascending in East order — ` +
          `the blob holds the canonical value; sort them first, or write arrival order as an Array`
        );
      }
    }
    const start = this.open.size;
    let keyLength: number;
    try {
      keyLength = this.encodeElement(element, this.open);
    } catch (err) {
      const kept = this.open.toUint8Array().slice(0, start);
      this.open.pop();
      this.open.writeBytes(kept);
      throw err;
    }
    if (this.orderCmp !== null) {
      this.lastKey = key;
      this.hasLast = true;
    }
    this.place(start, keyLength);
  }

  /**
   * Appends one element that is already in its canonical bytes — encoded
   * with aliasing scoped to itself, as {@link add} encodes one — without
   * decoding it.
   *
   * Order is the caller's to keep: a Set or Dict's elements must arrive
   * strictly ascending, and nothing here decodes them to check.
   *
   * @param element - the element's canonical bytes (a Dict pair's key, then
   *   its value)
   * @param keyLength - the length of the key at the front of `element`: a Set
   *   element's whole length, a Dict pair's key; ignored for an Array
   * @throws {Error} When called after {@link finish}.
   */
  addEncoded(element: Uint8Array, keyLength: number): void {
    if (this.finished) throw new Error("add() after finish()");
    const start = this.open.size;
    this.open.writeBytes(element);
    this.place(start, keyLength);
  }

  /** Accounts for the element just appended at `start`, and when the cut rule
   *  starts a segment at it, writes out the segment that closes. */
  private place(start: number, keyLength: number): void {
    const bytes = this.open.toUint8Array();
    const element = bytes.subarray(start);
    // An Array element has no key, so the rule hashes it whole.
    const hashed = this.kind === "Array" ? element : element.subarray(0, keyLength);
    if (this.cutter.startsSegment(element.length, hashed)) {
      this.writeSegment(bytes.subarray(0, start));
      const carried = element.slice();
      this.open.pop();
      this.open.writeBytes(carried);
      this.count = 0;
    }
    if (this.count === 0) this.firstKeyLength = keyLength;
    this.count++;
  }

  /**
   * Waits for every in-flight frame and passes it to the sink, so the sink
   * holds every segment written so far. A no-op for a serial writer.
   *
   * @throws {Error} For a parallel writer, when an in-flight frame's worker
   *   failed or stopped responding (see {@link Beast2Writer.write}).
   */
  settle(): void {
    if (this.blob !== null) this.blob.settle();
    else this.frames!.settle();
  }

  /** Elements in the open segment.
   *  @internal */
  get openCount(): number {
    return this.cutter.openCount;
  }

  /** Logical bytes in the open segment.
   *  @internal */
  get openBytes(): number {
    return this.cutter.openBytes;
  }

  /**
   * Ends the open segment here, for a caller that knows the cut rule starts
   * one at what comes next without handing it over: writes the open segment,
   * and makes the next element the first of a segment.
   *
   * @throws {Error} When called after {@link finish}.
   * @internal
   */
  closeSegment(): void {
    if (this.finished) throw new Error("add() after finish()");
    this.writeSegment(this.open.toUint8Array());
    this.open.pop();
    this.count = 0;
    this.cutter = new SegmentCutter();
  }

  /**
   * Writes the open segment and — for a blob — the terminator, index and
   * footer. Idempotent.
   *
   * @throws {Error} For a parallel writer, when an in-flight frame's worker
   *   failed or stopped responding (see {@link Beast2Writer.write}).
   */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.writeSegment(this.open.toUint8Array());
    if (this.blob !== null) this.blob.finish();
    else this.frames!.settle();
  }

  /** Writes the open segment, whose elements are `elements`, unless it is
   *  empty. */
  private writeSegment(elements: Uint8Array): void {
    if (this.count === 0) return;
    this.written++;
    if (this.blob !== null) {
      this.blob.writeEncodedSegment(this.count, elements);
      return;
    }
    const logical = new BufferWriter(elements.length + 10);
    logical.writeVarint(this.count);
    logical.writeBytes(elements);
    this.frames!.submit(logical.toUint8Array(), {
      count: this.count,
      fence: this.kind === "Array" ? new Uint8Array(0) : elements.slice(0, this.firstKeyLength),
      logicalBytes: elements.length,
    });
  }
}

// =============================================================================
// Paged whole-value encode
// =============================================================================

/** Options accepted by {@link encodeBeast2PagedFor}. */
export type Beast2PagedEncodeOptions = {
  /** Per-frame codec. Defaults to `"deflate"`. */
  codec?: Beast2Codec;
  /** Source map for function values in the stream, written to the header. */
  sourceMap?: SourceMap | null;
};

/**
 * Builds a curried paged encoder: `encode(value)` writes one whole collection
 * value as a segmented, self-contained, indexed v5 blob, cut by the
 * content-defined rule through {@link Beast2ElementWriter}.
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
 * @param options - codec and source map options
 * @returns a function encoding a collection value to an indexed v5 blob
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 */
export function encodeBeast2PagedFor<T extends EastType>(type: T | EastTypeValue, options?: Beast2PagedEncodeOptions): (value: ValueTypeOf<T>) => Uint8Array {
  const typeValue = asTypeValue(type);
  const kind = checkSegmented(typeValue);
  const cmp = orderCmpFor(typeValue, kind);

  return (value) => {
    // Canonical source order: SortedSet/SortedMap iterate in East order
    // already; a plain Set/Map (insertion order) is sorted first.
    const elements: Iterable<unknown> = kind === "Dict"
      ? ((value as unknown) instanceof SortedMap
          ? (value as SortedMap<unknown, unknown>).entries()
          : [...(value as Map<unknown, unknown>).entries()].sort((a, b) => cmp!(a[0], b[0])))
      : kind === "Set"
        ? ((value as unknown) instanceof SortedSet
            ? (value as Iterable<unknown>)
            : [...(value as Set<unknown>)].sort(cmp!))
        : (value as Iterable<unknown>);

    const chunks: Uint8Array[] = [];
    let total = 0;
    // Frames deflate on worker threads where the runtime has them (#763).
    const writer = new Beast2ElementWriter(typeValue, (b) => { chunks.push(b); total += b.length; }, { ...options, parallel: true });
    for (const element of elements) writer.add(element);
    writer.finish();
    const out = new Uint8Array(total);
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
 *  (the wire must hold the canonical value), never data to repair.
 *
 *  A Set/Dict segment is a SortedSet/SortedMap under the East comparator, as a
 *  whole-value decode is: a plain JS Set or Map compares keys by SameValueZero,
 *  which reads a `-0` key as `0` and merges it with a `0` beside it. */
function buildSegmentDecoder(typeValue: EastTypeValue, kind: SegmentedKind): (reader: BufferReader, ctx: V5DecodeContext, n: number, order?: SegmentOrder) => any {
  const typeCtx = new Map<bigint, any>();
  const cmp = orderCmpFor(typeValue, kind);
  if (kind === "Dict") {
    const key = buildV5Decoder((typeValue as any).value.key, typeCtx);
    const val = buildV5Decoder((typeValue as any).value.value, typeCtx);
    return (reader, ctx, n, order) => {
      const map = new SortedMap<any, any>(undefined, cmp!);
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
      const set = new SortedSet<any>(undefined, cmp!);
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

/** The bytes a fence probe reads first: the frame header plus enough of the
 *  payload for the first key of any ordinary row. A key that does not fit
 *  grows the probe fourfold until it does, the final attempt reading the
 *  frame whole (mirrors east-c's probe). */
const FENCE_PROBE_BYTES = 4096;

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
 * The blob is either a whole `Uint8Array` or a {@link Beast2SyncRangeReader}:
 * through a reader the open reads only the tail (footer + index) and the
 * head (header sections), and every segment read fetches exactly that
 * segment's frame — a file-backed reader keeps the wire bytes in the page
 * cache rather than on the heap. A Set/Dict root's first keyed read verifies
 * the fences, probing a bounded prefix of every frame once (never the frame,
 * unless its first key is wider than the probe); later keyed reads fetch one
 * frame.
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
  private readonly source: Beast2SyncRangeReader;
  /** The manifest behind this reader, when the segments are separate blobs
   *  rather than runs of one. */
  private readonly manifestSource: Beast2ManifestSource | null = null;
  /** Wire offset of the terminator frame — where the last segment's frame ends. */
  private readonly segmentsEnd: number;
  private readonly indexData: Beast2Index;
  private readonly kind: SegmentedKind;
  private readonly typeValue: EastTypeValue;
  /** The stream's source map. For a manifest it starts empty and is replaced
   *  by the first segment's own header map, which every segment shares. */
  private sourceMap: SourceMap;
  private readonly decodeSegment: (reader: BufferReader, ctx: V5DecodeContext, n: number, order?: SegmentOrder) => any;
  private readonly platform: Beast2DecodeOptions | undefined;
  private readonly cumulative: number[];
  private readonly orderCmp: ((a: any, b: any) => number) | null;
  /** First key/element of each segment, in segment order (Set/Dict only). */
  private fences: any[] | null = null;
  private fenceDec: ((reader: BufferReader, ctx: V5DecodeContext) => any) | null = null;
  /** The decoder of a manifest's stored fence bytes, built on first use. */
  private manifestFenceDec: ((bytes: Uint8Array) => any) | null = null;
  /** Decoded segments kept hot for the element and keyed read paths, keyed
   *  by segment index in LRU order (mirrors east-c's `B2V5_PAGES_LRU`).
   *  Only {@link element} and {@link get} route through it — the public
   *  {@link segment} stays a fresh decode, so a caller mutating its result
   *  cannot poison the cache. `first`/`last` carry a Set/Dict segment's key
   *  range so a hit can maintain the caller's order threading without a
   *  container walk. */
  private readonly segmentCache = new Map<number, { seg: any; first: any; last: any }>();

  /** @internal Use {@link openBeast2PagesFor}. */
  constructor(source: Uint8Array | Beast2SyncRangeReader | Beast2ManifestSource, typeValue: EastTypeValue, options?: Beast2DecodeOptions) {
    let kind: SegmentedKind;
    let sourceMap: SourceMap;
    let index: Beast2Index;
    if (isBeast2ManifestSource(source)) {
      // A manifest names its segments; there is no one blob to take geometry
      // from. Counts and fences come from the entries, and a segment is its
      // own blob — so no offset in this index is ever read, and the header
      // (with it the source map) is parsed from the first segment opened.
      kind = checkSegmented(typeValue);
      sourceMap = new SourceMap();
      const entries = source.manifest.entries;
      index = {
        selfContained: true,
        offsets: entries.map(() => 0),
        counts: entries.map((e) => Number(e.count)),
        totalCount: entries.reduce((sum, e) => sum + Number(e.count), 0),
      };
      this.manifestSource = source;
      this.segmentsEnd = 0;
      this.source = bytesReader(new Uint8Array(0));
    } else if (!isBeast2SyncRangeReader(source)) {
      ({ kind, sourceMap } = openSegmented(source, typeValue));
      const whole = readIndex(source);
      if (!whole) {
        throw new Error(`beast2 v5: blob has no index/footer — paging needs a writer with index enabled`);
      }
      index = whole;
      // readIndex validated the footer, so the u64 before its magic is the
      // index offset; the terminator frame sits directly ahead of it.
      this.segmentsEnd = readU64LE(source, source.length - 16) - TAG_OR_TERMINATOR_FRAME.length;
      this.source = bytesReader(source);
    } else {
      // Two positioned reads — the tail, then the head — give the whole
      // geometry; the segment frames are read one at a time from here on.
      const extents = readBeast2ExtentsSync(source);
      ({ kind, sourceMap } = openSegmented(extents.head, typeValue));
      index = { selfContained: extents.selfContained, offsets: [...extents.offsets], counts: [...extents.counts], totalCount: extents.elementCount };
      this.segmentsEnd = extents.segmentsEnd;
      this.source = source;
    }
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

  /** Reads segment `i`'s frame — exactly its wire bytes, from its index
   *  offset to the next segment's (or the terminator) — and opens its
   *  logical chunk. The only place segment bytes are fetched, so a ranged
   *  source touches one frame per decode, and a manifest source touches one
   *  segment blob. */
  private frameReader(i: number): BufferReader {
    if (this.manifestSource !== null) return this.manifestFrameReader(i);
    const start = this.indexData.offsets[i]!;
    const end = i + 1 < this.indexData.offsets.length ? this.indexData.offsets[i + 1]! : this.segmentsEnd;
    return new FrameReader(readExact(this.source, start, end - start), 0).next();
  }

  /** Segment `i`'s frame out of its own standalone blob: the blob's geometry
   *  names exactly one frame, and its header carries the source map every
   *  segment of this collection shares. */
  private manifestFrameReader(i: number): BufferReader {
    const blob = this.manifestSource!.segment(i);
    const reader = isBeast2SyncRangeReader(blob) ? blob : bytesReader(blob);
    const extents = readBeast2ExtentsSync(reader);
    if (extents.offsets.length !== 1) {
      throw new Error(`beast2 v5: manifest entry ${i} holds ${extents.offsets.length} segments, not one`);
    }
    if (this.sourceMap.size <= 1n) {
      this.sourceMap = openSegmented(extents.head, this.typeValue).sourceMap;
    }
    const start = extents.offsets[0]!;
    return new FrameReader(readExact(reader, start, extents.segmentsEnd - start), 0).next();
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
    const reader = this.frameReader(i);
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
   *  (a prefix of the frame read and inflated, one element decode), not a
   *  whole-segment decode. A first key wider than the probe grows it; the
   *  final attempt reads the frame whole, so corruption is still reported
   *  with the frame's own error. */
  private firstKey(i: number): any {
    // A manifest stores every fence already, so a bisect over one reads no
    // segment bytes at all — the whole point of carrying them.
    if (this.manifestSource !== null) {
      if (!this.manifestFenceDec) {
        const keyType = this.kind === "Dict" ? (this.typeValue as any).value.key : (this.typeValue as any).value;
        this.manifestFenceDec = decodeBeast2FenceFor(keyType, this.platform);
      }
      return this.manifestFenceDec(this.manifestSource.manifest.entries[i]!.fence);
    }
    if (!this.fenceDec) {
      const keyType = this.kind === "Dict" ? (this.typeValue as any).value.key : (this.typeValue as any).value;
      this.fenceDec = buildV5Decoder(keyType);
    }
    const start = this.indexData.offsets[i]!;
    const end = i + 1 < this.indexData.offsets.length ? this.indexData.offsets[i + 1]! : this.segmentsEnd;
    const frameLen = end - start;
    for (let probe = Math.min(frameLen, FENCE_PROBE_BYTES); ; probe = Math.min(frameLen, probe * 4)) {
      const whole = probe === frameLen;
      const bytes = readExact(this.source, start, probe);
      const ctx: V5DecodeContext = { containers: [], sourceMap: this.sourceMap, frozen: this.platform?.frozen ?? false, ...buildPlatformContext(this.platform) };
      if (whole) {
        const reader = new FrameReader(bytes, 0).next();
        reader.readVarint();  // element count — segments are never empty
        return this.fenceDec(reader, ctx);
      }
      try {
        const reader = openFramePrefix(bytes);
        if (reader !== null) {
          reader.readVarint();
          return this.fenceDec(reader, ctx);
        }
      } catch {
        // Short, or corrupt: more of the frame decides which.
      }
    }
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
   * holding the window (an array, `SortedSet`, or `SortedMap` in that order).
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
    const empty = (): any => this.kind === "Array" ? []
      : this.kind === "Set" ? new SortedSet<any>(undefined, this.orderCmp!) : new SortedMap<any, any>(undefined, this.orderCmp!);
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
    const out = empty() as Set<any> | Map<any, any>;
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
   * The segment a canonical-order scan from `key` starts in (Set/Dict roots
   * only): the greatest segment whose fence is at most `key`, or segment 0
   * when `key` precedes every fence.
   *
   * Segments are disjoint ascending ranges, so this is the only segment that
   * can hold `key` and the first that can hold anything at or above it — it
   * is what {@link get} looks up in, and where a range iteration from a lower
   * bound begins. The fences are probed and verified to ascend strictly on
   * first use and kept thereafter, so a blob that violates the canonical-order
   * contract is refused before the search can land anywhere rather than
   * mis-addressing rows.
   *
   * @param key - the Set element or Dict key to seek to
   * @returns the zero-based segment index
   * @throws {Error} When the root is an Array, the blob is not
   *   self-contained, or its segment fences do not ascend.
   */
  segmentFor(
    key: ValueTypeOf<T> extends Map<infer K, any> ? K : ValueTypeOf<T> extends Set<infer E> ? E : never,
  ): number {
    if (this.kind === "Array") {
      throw new Error(`beast2 v5: segmentFor() addresses Set and Dict roots; this blob holds Array — use slice()`);
    }
    const fences = this.verifyFences();
    if (fences.length === 0 || this.orderCmp!(key, fences[0]) < 0) return 0;
    let lo = 0, hi = fences.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.orderCmp!(fences[mid], key) <= 0) lo = mid;
      else hi = mid - 1;
    }
    return lo;
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
    // A key below every fence is below the collection's minimum.
    if (this.orderCmp!(key, fences[0]) < 0) return undefined;
    const order: SegmentOrder = { prev: undefined, has: false };
    const segment = this.decodeDisjoint(this.segmentFor(key), order, fences, true);
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
 * Builds a curried pages opener: `open(source)` parses the header, footer and
 * index once and returns a {@link Beast2Pages} for random access.
 *
 * `source` is the whole blob, a {@link Beast2SyncRangeReader} over it — then
 * only the tail, the head and the segments actually read are ever fetched —
 * or a {@link Beast2ManifestSource}, whose segments are separate blobs and
 * whose fences are already decoded, so a keyed read touches exactly one.
 *
 * @param type - the collection type (Array/Set/Dict)
 * @param options - decode options (platform functions for decoded functions)
 * @returns a function opening a blob for paged reads
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 */
export function openBeast2PagesFor<T extends EastType>(type: T | EastTypeValue, options?: Beast2DecodeOptions): (source: Uint8Array | Beast2SyncRangeReader | Beast2ManifestSource) => Beast2Pages<T> {
  const typeValue = asTypeValue(type);
  checkSegmented(typeValue);
  return (source) => new Beast2Pages<T>(source, typeValue, options);
}
