/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Re-cutting — a collection's pieces in, in order, and the canonical whole out,
 * segment by segment.
 *
 * The cut rule decides where a segment starts from the elements since the last
 * boundary and nothing else. So a piece the Writer wrote — a partition's
 * output, the segments of a record around an edit — cuts where the whole cuts
 * from the first boundary the two share: once the whole starts a segment where
 * the piece started one, every later segment of the piece is a segment of the
 * whole, byte for byte, and is carried over without being read. Only where the
 * two can disagree is anything re-cut: at a seam, where a piece's last segment
 * ended only because the piece did, and through elements given one by one — an
 * edited region — until the whole starts a segment where a piece does again.
 *
 * What comes out is what the Writer writes for the whole value, segment for
 * segment; nothing in it records where the pieces were cut.
 */

import { type EastTypeValue, EastTypeValueType, isTypeValueEqual } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { printFor } from "../../east.js";
import { compareFor } from "../../../comparison.js";
import { BufferReader, BufferWriter } from "../../binary-utils.js";
import { type PlatformDecodeContext, buildPlatformContext } from "../shared.js";
import { asTypeValue, readTypeSection } from "./type-section.js";
import { MAGIC_BYTES_V5, type V5DecodeContext, buildV5Decoder, isSegmentedRoot, readSourceMapSectionV5 } from "./codec.js";
import { FrameReader } from "./frames.js";
import { readBeast2Extents } from "./geometry.js";
import { startsSegmentAfter } from "./boundary.js";
import {
  Beast2ElementWriter,
  elementEncoderFor,
  type Beast2ElementOf,
  type Beast2ElementWriterOptions,
  type Beast2Segment,
} from "./stream.js";

/**
 * A segment of a collection the Writer wrote, as {@link recutBeast2For} takes
 * it: what a manifest entry records of it, and a way to read it.
 *
 * A re-cut reads a segment only where it has to look inside — at a seam, or to
 * re-cut through it — so a segment it carries over is never read at all.
 */
export interface Beast2SegmentRef {
  /** Elements (pairs, for a Dict) in the segment; at least one. */
  readonly count: number;
  /** Set/Dict: the segment's first key in its canonical bare encoding
   *  (`encodeBeast2FenceFor`) — a manifest entry's fence. Array: empty, and
   *  the first element is read when a seam needs it. */
  readonly fence: Uint8Array;
  /** The segment's logical size, when the caller knows it; otherwise it is
   *  read from the segment's frame when a seam after it needs it. */
  readonly logicalBytes?: number;
  /** Set/Dict: the fence of the segment that followed this one in the
   *  collection it was written in. The rule started a segment at that key
   *  after this one, so a seam where the same key follows again is decided
   *  without reading anything. */
  readonly nextFence?: Uint8Array;
  /**
   * Reads the segment.
   *
   * @returns the segment as a standalone blob holding exactly it
   */
  read(): Uint8Array | Promise<Uint8Array>;
}

/**
 * A piece of a collection, as {@link recutBeast2For} takes it: a run of
 * consecutive segments of a collection the Writer wrote, under the header the
 * re-cut writes, or elements.
 */
export type Beast2RecutPiece<T extends EastType = EastType, R extends Beast2SegmentRef = Beast2SegmentRef> =
  | { readonly segments: Iterable<R> | AsyncIterable<R> }
  | { readonly elements: Iterable<Beast2ElementOf<T>> | AsyncIterable<Beast2ElementOf<T>> };

/** Where {@link recutBeast2For} puts the whole's segments, in order. */
export interface Beast2RecutSink<R extends Beast2SegmentRef = Beast2SegmentRef> {
  /**
   * Receives a segment the re-cut wrote.
   *
   * @param segment - the segment, as a standalone blob
   */
  written(segment: Beast2Segment): void | Promise<void>;
  /**
   * Receives a segment of a piece that is a segment of the whole as it
   * stands, never read.
   *
   * @param segment - the reference it came as
   */
  carried(segment: R): void | Promise<void>;
}

/** Options accepted by {@link recutBeast2For}: those of the Writer the
 *  written segments go through. `headerPrefix` is the header the carried
 *  segments are under, when that is not the one the Writer builds for the
 *  type. */
export type Beast2RecutOptions = Beast2ElementWriterOptions;

/** What a re-cut came to. */
export type Beast2RecutStats = {
  /** The header every segment of the whole is under — what a manifest of it
   *  names. */
  header: Uint8Array;
  /** Segments carried over from the pieces. */
  carried: number;
  /** Segments written. */
  written: number;
};

/** Steps a reader over one root element by decoding it, and returns the
 *  length of its key: a Set element's whole length, a Dict pair's key, 0 for
 *  an Array element. */
type ElementParser = (reader: BufferReader, ctx: V5DecodeContext) => number;

function elementParserFor(typeValue: EastTypeValue): ElementParser {
  const typeCtx = new Map<bigint, any>();
  if (typeValue.type === "Dict") {
    const key = buildV5Decoder((typeValue as any).value.key, typeCtx);
    const value = buildV5Decoder((typeValue as any).value.value, typeCtx);
    return (reader, ctx) => {
      const start = reader.offset;
      key(reader, ctx);
      const keyLength = reader.offset - start;
      value(reader, ctx);
      return keyLength;
    };
  }
  const elem = buildV5Decoder((typeValue as any).value, typeCtx);
  const keyed = typeValue.type === "Set";
  return (reader, ctx) => {
    const start = reader.offset;
    elem(reader, ctx);
    return keyed ? reader.offset - start : 0;
  };
}

/** A segment read for a re-cut: its frame's logical bytes, and where its
 *  elements lie in them. */
class SegmentContent {
  constructor(
    /** The frame's logical bytes: the element count, then the elements. */
    private readonly logical: Uint8Array,
    /** Where the first element starts. */
    private readonly start: number,
    private readonly count: number,
    private readonly parse: ElementParser,
    /** A decode context with an empty definition table. */
    private readonly context: () => V5DecodeContext,
  ) {}

  /** The elements' canonical bytes before compression — what the cut rule
   *  measures a segment by. */
  get logicalBytes(): number {
    return this.logical.length - this.start;
  }

  /**
   * Each element's bytes and the length of its key, in order.
   *
   * Every element decodes against an empty definition table, so one that
   * refers to a container outside itself — a segment written before aliasing
   * was scoped per element — fails here, rather than being moved by byte copy
   * away from what it refers to.
   */
  *elements(): Generator<[Uint8Array, number], void> {
    const reader = new BufferReader(this.logical, this.start);
    for (let i = 0; i < this.count; i++) {
      const start = reader.offset;
      const keyLength = this.parse(reader, this.context());
      yield [this.logical.subarray(start, reader.offset), keyLength];
    }
    if (reader.offset !== this.logical.length) {
      throw new Error(`beast2 v5: ${this.logical.length - reader.offset} logical bytes after a segment's last element`);
    }
  }
}

/** One re-cut in progress. */
class Recutter<R extends Beast2SegmentRef> {
  carried = 0;
  written = 0;
  private readonly keyed: boolean;
  private readonly writer: Beast2ElementWriter;
  private readonly encodeElement: (element: unknown, writer: BufferWriter) => number;
  private readonly platform: PlatformDecodeContext = buildPlatformContext();
  /** Segments the writer has written that the sink has not been given yet. */
  private readonly queue: Beast2Segment[] = [];
  /** A segment that starts where the whole starts one, held until what
   *  follows says whether the whole ends one where it ends: then it is carried
   *  over whole, and otherwise its elements join what follows. The writer's
   *  open segment is empty while one is held. */
  private pending: R | null = null;
  /** What has been read of the segments in hand, so each is read once. */
  private readonly contents = new Map<R, SegmentContent>();
  private readonly scratch = new BufferWriter();

  constructor(
    private readonly typeValue: EastTypeValue,
    private readonly parse: ElementParser,
    private readonly sink: Beast2RecutSink<R>,
    options: Beast2RecutOptions | undefined,
  ) {
    this.keyed = typeValue.type !== "Array";
    this.writer = new Beast2ElementWriter(typeValue, { segment: (segment) => { this.queue.push(segment); } }, options);
    this.encodeElement = elementEncoderFor(typeValue, options?.sourceMap ?? null);
  }

  /**
   * Takes the next segment of a piece.
   *
   * @param ref - the segment
   * @param continues - whether the segment before it came from the same piece,
   *   whose writer cut between them
   */
  async segment(ref: R, continues: boolean): Promise<void> {
    if (!Number.isInteger(ref.count) || ref.count < 1) {
      throw new Error(`beast2 v5: recut: a segment holds at least one element, and a reference says ${ref.count}`);
    }
    const pending = this.pending;
    if (pending !== null) {
      // The whole started `pending` where its piece did, so it cuts after it
      // wherever the piece did.
      if (continues || await this.cutsAfter(pending, await this.hashInputOf(ref))) {
        await this.carry(pending);
        this.pending = ref;
        return;
      }
      this.pending = null;
      await this.dissolve(pending);
      await this.dissolve(ref);
      return;
    }
    if (this.writer.openCount === 0) {
      // The whole's first element opens its first segment.
      this.pending = ref;
      return;
    }
    if (startsSegmentAfter(this.writer.openCount, this.writer.openBytes, await this.hashInputOf(ref))) {
      this.writer.closeSegment();
      await this.drain();
      this.pending = ref;
      return;
    }
    await this.dissolve(ref);
  }

  /**
   * Takes the next element.
   *
   * @param element - an Array or Set element, or a Dict's `[key, value]` pair
   */
  async element(element: unknown): Promise<void> {
    // An encode that threw left its bytes behind; this one starts clean.
    this.scratch.pop();
    const keyLength = this.encodeElement(element, this.scratch);
    const bytes = this.scratch.toUint8Array();
    const pending = this.pending;
    if (pending !== null) {
      this.pending = null;
      if (await this.cutsAfter(pending, this.keyed ? bytes.subarray(0, keyLength) : bytes)) await this.carry(pending);
      else await this.dissolve(pending);
    }
    this.writer.addEncoded(bytes, keyLength);
    if (this.queue.length > 0) await this.drain();
  }

  /**
   * Writes what is left and hands the last segments to the sink.
   *
   * @returns what the re-cut came to
   */
  async finish(): Promise<Beast2RecutStats> {
    const pending = this.pending;
    this.pending = null;
    // The whole's last segment holds whatever is left, so a held segment ends
    // one wherever it ends.
    if (pending !== null) await this.carry(pending);
    this.writer.finish();
    await this.drain();
    return { header: this.writer.header, carried: this.carried, written: this.written };
  }

  /** Whether the cut rule starts a segment after `held` at an element whose
   *  hash input is `hashInput`. */
  private async cutsAfter(held: R, hashInput: Uint8Array): Promise<boolean> {
    const next = held.nextFence;
    if (this.keyed && next !== undefined && next.length === hashInput.length && next.every((byte, i) => byte === hashInput[i])) {
      return true;
    }
    return startsSegmentAfter(held.count, held.logicalBytes ?? (await this.content(held)).logicalBytes, hashInput);
  }

  /** The bytes the cut rule hashes for a segment's first element: its fence
   *  for a Set or Dict, the element itself for an Array. */
  private async hashInputOf(ref: R): Promise<Uint8Array> {
    if (this.keyed) return ref.fence;
    const first = (await this.content(ref)).elements().next();
    return (first.value as [Uint8Array, number])[0];
  }

  /** Hands a segment to the sink as it stands, after every segment written
   *  before it. */
  private async carry(ref: R): Promise<void> {
    this.writer.settle();
    await this.drain();
    this.contents.delete(ref);
    this.carried++;
    await this.sink.carried(ref);
  }

  /** Gives a segment's elements to the writer one by one: the whole does not
   *  start a segment where it starts, so the writer cuts them. */
  private async dissolve(ref: R): Promise<void> {
    const content = await this.content(ref);
    this.contents.delete(ref);
    for (const [bytes, keyLength] of content.elements()) {
      this.writer.addEncoded(bytes, keyLength);
      if (this.queue.length > 0) await this.drain();
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      this.written++;
      await this.sink.written(this.queue.shift()!);
    }
  }

  /** Reads a segment once: its standalone blob, checked to hold exactly the
   *  one segment its reference describes, of this collection's type. */
  private async content(ref: R): Promise<SegmentContent> {
    const held = this.contents.get(ref);
    if (held !== undefined) return held;
    const blob = await ref.read();
    const extents = readBeast2Extents(blob);
    if (!isTypeValueEqual(extents.typeValue, this.typeValue)) {
      const printType = printFor(EastTypeValueType);
      throw new Error(`beast2 v5: recut: a segment holds ${printType(extents.typeValue)}, not ${printType(this.typeValue)}`);
    }
    if (extents.offsets.length !== 1 || extents.counts[0] !== ref.count) {
      const holds = extents.offsets.length === 1 ? `${extents.counts[0]} elements` : `${extents.offsets.length} segments`;
      throw new Error(`beast2 v5: recut: a segment's reference says ${ref.count} elements, and its blob holds ${holds}`);
    }
    const head = new BufferReader(blob, MAGIC_BYTES_V5.length);
    readTypeSection(head);
    const sourceMap = readSourceMapSectionV5(head);
    const reader = new FrameReader(blob, extents.offsets[0]!).next();
    const count = reader.readVarint();
    if (count !== ref.count) {
      throw new Error(`beast2 v5: recut: a segment's frame declares ${count} elements, its index ${ref.count}`);
    }
    const platform = this.platform;
    const content = new SegmentContent(reader.buffer, reader.offset, count, this.parse,
      () => ({ containers: [], sourceMap, frozen: false, ...platform }));
    this.contents.set(ref, content);
    return content;
  }
}

/**
 * Builds a re-cut: `recut(pieces, sink)` writes the canonical whole of a
 * collection given as pieces in order, segment by segment.
 *
 * A piece is either a run of consecutive segments of a collection the Writer
 * wrote — given by reference, and read only where the re-cut must look inside
 * one — or elements. A segment of a piece that is a segment of the whole is
 * carried over as it came; everything else is written, cut by the rule. The
 * segments are exactly those the Writer writes for the whole value, so an edit
 * is a re-cut of the edited elements between the segments around them, and
 * costs what the edit touched plus at most a segment or two each side.
 *
 * @param type - the collection type (Array/Set/Dict)
 * @param options - the Writer's options for the written segments; its
 *   `headerPrefix` is the header the carried segments are under
 * @returns a function taking the pieces, in order, and the sink the whole's
 *   segments go to, and resolving to what the re-cut came to
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 *
 * @remarks
 * The pieces' segments must be the Writer's own — cut by the current rule,
 * with aliasing scoped per element and the same codec — or they are carried
 * over as something the Writer would not write; a collection stored some other
 * way is given as its elements. Elements in one piece must ascend in East
 * order (a Set's elements, a Dict's keys), which the re-cut checks; the order
 * across pieces is the caller's. The returned function rejects, having written
 * part of the whole, when a piece is out of order, a segment's blob is not the
 * one segment its reference describes, or the sink rejects.
 *
 * @example
 * ```ts
 * const type = ArrayType(IntegerType);
 * const blob = encodeBeast2PagedFor(type)(values);
 * const extents = readBeast2Extents(blob);
 * const segments = extents.counts.map((count, i) => ({
 *   count,
 *   fence: new Uint8Array(0),
 *   read: () => carveBeast2(blob, i, i + 1, extents),
 * }));
 * const parts: Uint8Array[] = [];
 * await recutBeast2For(type)([{ segments }, { elements: [42n] }], {
 *   written: (segment) => { parts.push(segment.blob); },
 *   carried: (segment) => { parts.push(segment.read() as Uint8Array); },
 * });
 * spliceBeast2(parts);  // encodeBeast2PagedFor(type)([...values, 42n])
 * ```
 */
export function recutBeast2For<T extends EastType, R extends Beast2SegmentRef = Beast2SegmentRef>(
  type: T | EastTypeValue,
  options?: Beast2RecutOptions,
): (pieces: Iterable<Beast2RecutPiece<T, R>> | AsyncIterable<Beast2RecutPiece<T, R>>, sink: Beast2RecutSink<R>) => Promise<Beast2RecutStats> {
  const typeValue = asTypeValue(type);
  if (!isSegmentedRoot(typeValue)) {
    throw new TypeError(`beast2 v5: recut addresses Array, Set or Dict values, not ${typeValue.type}`);
  }
  const parse = elementParserFor(typeValue);
  const dict = typeValue.type === "Dict";
  const keyType: EastTypeValue | null = typeValue.type === "Array" ? null
    : dict ? (typeValue as { value: { key: EastTypeValue } }).value.key : (typeValue as { value: EastTypeValue }).value;
  const cmp = keyType === null ? null : compareFor(keyType) as (a: unknown, b: unknown) => number;
  const printKey = keyType === null ? null : printFor(keyType);

  return async (pieces, sink) => {
    const recut = new Recutter<R>(typeValue, parse, sink, options);
    for await (const piece of pieces) {
      if ("segments" in piece) {
        let continues = false;
        for await (const segment of piece.segments) {
          await recut.segment(segment, continues);
          continues = true;
        }
        continue;
      }
      let prev: unknown;
      let has = false;
      for await (const element of piece.elements) {
        if (cmp !== null) {
          const key = dict ? (element as [unknown, unknown])[0] : element;
          if (has && cmp(prev, key) >= 0) {
            const noun = dict ? "Dict keys" : "Set elements";
            throw new Error(`beast2 v5: recut: a piece's ${noun} must ascend strictly in East order, and ${printKey!(key)} follows ${printKey!(prev)}`);
          }
          prev = key;
          has = true;
        }
        await recut.element(element);
      }
    }
    return recut.finish();
  };
}
