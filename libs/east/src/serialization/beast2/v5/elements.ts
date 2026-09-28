/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A collection's elements, read from its bytes as they arrive.
 *
 * A store that takes collections from outside — a delivered file, an upload, a
 * program's output — cannot keep their bytes: the cuts, the aliasing, the codec
 * and the compressor all enter them, and none is known to be the canonical
 * writer's. What it can keep is the value, so it reads the elements and writes
 * them again through the Writer. This is the reading half, and it never holds
 * the value: the blob is read front to back, a frame at a time, and each
 * segment's elements are decoded against a definition table of their own and
 * handed over one by one.
 *
 * No index is needed, so the bytes can be a stream with nothing ahead of it. A
 * segment is the unit of memory, and the one limit is on it: a frame whose
 * logical bytes exceed {@link RUN_MAX_BYTES} is refused before it is read. That
 * is what refuses a large value encoded whole — one frame holding everything —
 * and a writer that batched segments too big to decode at once.
 */

import { type EastTypeValue, EastTypeValueType, isTypeValueEqual } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { printFor } from "../../east.js";
import { compareFor } from "../../../comparison.js";
import { SortedSet } from "../../../containers/sortedset.js";
import { SortedMap } from "../../../containers/sortedmap.js";
import { BufferReader } from "../../binary-utils.js";
import { type Beast2DecodeOptions, buildPlatformContext } from "../shared.js";
import { MAGIC_BYTES, decodeBeast2V4For, readBeast2V4Type } from "../v4/container.js";
import { asTypeValue, readTypeSection } from "./type-section.js";
import { MAGIC_BYTES_V5, TAG_NEW, type V5DecodeContext, buildV5Decoder, isSegmentedRoot, readSourceMapSectionV5 } from "./codec.js";
import { CODEC_DEFLATE, CODEC_NONE, CODEC_ZSTD, FRAME_HEADER_MAX, inflateRawSync } from "./frames.js";
import { RUN_MAX_BYTES } from "./runs.js";
import type { Beast2ElementOf } from "./stream.js";

/** Head reads the header sections are parsed from, in order: neither section
 *  says how long it is before it is parsed. The first holds any ordinary
 *  type section, so a stream is read no further ahead than it has to be; the
 *  last is a ceiling — a type section wider than 16 MiB is malformed, not
 *  merely large. */
const HEAD_PROBE_BYTES = [4 * 1024, 256 * 1024, 16 * 1024 * 1024];

/**
 * The bytes of a stream as they arrive, with enough buffered to parse the next
 * thing: a header, a frame, the whole of a small legacy blob.
 */
class ChunkQueue {
  private readonly iterator: AsyncIterator<Uint8Array> | Iterator<Uint8Array>;
  private readonly chunks: Uint8Array[] = [];
  /** How much of `chunks[0]` has been taken. */
  private head = 0;
  private ended = false;
  /** Bytes buffered and not yet taken. */
  available = 0;
  /** Bytes taken so far — the stream offset of the next byte. */
  offset = 0;

  constructor(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) {
    this.iterator = Symbol.asyncIterator in source
      ? (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
      : (source as Iterable<Uint8Array>)[Symbol.iterator]();
  }

  /** Buffers at least `n` bytes, or everything left when the stream ends
   *  first; answers whether `n` are buffered. */
  async fill(n: number): Promise<boolean> {
    while (this.available < n && !this.ended) {
      const next = await this.iterator.next();
      if (next.done === true) {
        this.ended = true;
        break;
      }
      if (next.value.length === 0) continue;
      this.chunks.push(next.value);
      this.available += next.value.length;
    }
    return this.available >= n;
  }

  /** The next `n` buffered bytes, contiguous, without taking them. */
  peek(n: number): Uint8Array {
    const first = this.chunks[0];
    if (first !== undefined && first.length - this.head >= n) return first.subarray(this.head, this.head + n);
    const out = new Uint8Array(n);
    let at = 0;
    for (let i = 0; at < n; i++) {
      const chunk = this.chunks[i]!;
      const from = i === 0 ? this.head : 0;
      const length = Math.min(chunk.length - from, n - at);
      out.set(chunk.subarray(from, from + length), at);
      at += length;
    }
    return out;
  }

  /** Takes the next `n` buffered bytes, contiguous. */
  take(n: number): Uint8Array {
    const bytes = this.peek(n);
    this.skip(n);
    return bytes;
  }

  /** Drops the next `n` buffered bytes. */
  skip(n: number): void {
    this.available -= n;
    this.offset += n;
    while (n > 0) {
      const room = this.chunks[0]!.length - this.head;
      if (room > n) {
        this.head += n;
        return;
      }
      n -= room;
      this.chunks.shift();
      this.head = 0;
    }
  }

  /** Stops reading the stream, releasing whatever it holds open. */
  async close(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.iterator.return?.();
  }
}

/**
 * Builds a reader of a collection's elements from its beast2 bytes: `read(chunks)`
 * yields the elements in order — an Array's in position, a Set's or Dict's
 * ascending — decoding one segment of the source at a time.
 *
 * Any container a collection is written in reads: a v5 blob, indexed or not,
 * cut canonically or batched by its writer, compressed or not, and a v4 blob.
 * Nothing about the source's layout survives into what is yielded, so writing
 * the elements through the Writer gives the canonical bytes of the value.
 *
 * @param type - the collection type (Array/Set/Dict) the bytes must hold
 * @param options - decode options (platform functions for decoded functions)
 * @returns a function reading the elements out of a stream of byte chunks
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 *
 * @remarks
 * Memory is one segment of the source. Each segment decodes against a
 * definition table of its own, which is what a self-contained blob — every
 * writer's default — promises; a segment that aliases a container defined in
 * an earlier one is refused, naming it. A frame whose logical bytes exceed
 * {@link RUN_MAX_BYTES} is refused before it is read, and so is a v4 blob
 * longer than that, since v4 has no segments: the fix is to write the value
 * segmented. The generator rejects on the first such refusal, on bytes that
 * hold another type, and on a malformed container; what it yielded before
 * stands. The stream is read no further than the value's last segment, and is
 * closed however the reading ends.
 *
 * @example
 * ```ts
 * const type = DictType(StringType, IntegerType);
 * const blob = encodeBeast2For(type)(new Map([["a", 1n], ["b", 2n]]));
 * for await (const [key, value] of decodeBeast2ElementsFor(type)([blob])) {
 *   // "a" 1n, then "b" 2n
 * }
 * ```
 */
export function decodeBeast2ElementsFor<T extends EastType>(
  type: T | EastTypeValue,
  options?: Beast2DecodeOptions,
): (chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) => AsyncGenerator<Beast2ElementOf<T>, void, undefined> {
  const typeValue = asTypeValue(type);
  if (!isSegmentedRoot(typeValue)) {
    throw new TypeError(`beast2: elements are read from Array, Set or Dict values, not ${typeValue.type}`);
  }
  const kind = typeValue.type as "Array" | "Set" | "Dict";
  const typeCtx = new Map<bigint, any>();
  let decodeElement: (reader: BufferReader, ctx: V5DecodeContext) => unknown;
  if (kind === "Dict") {
    const key = buildV5Decoder((typeValue as any).value.key, typeCtx);
    const value = buildV5Decoder((typeValue as any).value.value, typeCtx);
    decodeElement = (reader, ctx) => [key(reader, ctx), value(reader, ctx)];
  } else {
    decodeElement = buildV5Decoder((typeValue as any).value, typeCtx);
  }
  const platform = buildPlatformContext(options);
  const frozen = options?.frozen ?? false;
  const printType = printFor(EastTypeValueType);

  const checkType = (wire: EastTypeValue): void => {
    if (!isTypeValueEqual(wire, typeValue)) {
      throw new Error(`beast2: the bytes hold ${printType(wire)}, not ${printType(typeValue)}`);
    }
  };

  /** A v4 blob's elements: v4 has no segments, so the blob is read whole —
   *  within the same limit as a frame. */
  async function* legacyElements(queue: ChunkQueue): AsyncGenerator<unknown> {
    if (await queue.fill(RUN_MAX_BYTES + 1)) {
      throw new Error(
        `beast2: a v4 blob longer than ${RUN_MAX_BYTES} bytes has no segments to read it in — ` +
        `re-encode it with version 5, segmented`
      );
    }
    const bytes = queue.take(queue.available);
    checkType(readBeast2V4Type(bytes));
    const value = decodeBeast2V4For(typeValue, options)(bytes) as unknown;
    if (kind === "Array") {
      yield* value as unknown[];
    } else if (kind === "Set") {
      yield* value instanceof SortedSet ? value : [...(value as Set<unknown>)].sort(compareFor((typeValue as any).value));
    } else {
      const cmp = compareFor((typeValue as any).value.key);
      yield* value instanceof SortedMap
        ? (value as SortedMap<unknown, unknown>).entries()
        : [...(value as Map<unknown, unknown>).entries()].sort((a, b) => cmp(a[0], b[0]));
    }
  }

  /** The v5 value stream's elements, the header sections already taken. */
  async function* streamElements(queue: ChunkQueue, sourceMap: V5DecodeContext["sourceMap"]): AsyncGenerator<unknown> {
    let frames = 0;
    /** The next frame's logical bytes. */
    const nextFrame = async (): Promise<BufferReader> => {
      const at = queue.offset;
      await queue.fill(FRAME_HEADER_MAX);
      if (queue.available === 0) {
        throw new Error(`beast2 v5: truncated value stream (expected a frame at offset ${at})`);
      }
      const reader = new BufferReader(queue.peek(Math.min(FRAME_HEADER_MAX, queue.available)), 0);
      const codec = reader.readVarint();
      const logicalBytes = reader.readVarint();
      const payloadBytes = reader.readVarint();
      if (codec !== CODEC_NONE && codec !== CODEC_DEFLATE) {
        throw new Error(codec === CODEC_ZSTD
          ? `beast2 v5: frame uses codec 2 (zstd), which this runtime does not support`
          : `beast2 v5: unknown frame codec ${codec}`);
      }
      if (logicalBytes > RUN_MAX_BYTES) {
        throw new Error(
          `beast2: frame ${frames} at offset ${at} holds ${logicalBytes} bytes, more than the ${RUN_MAX_BYTES} a ` +
          `collection is read in at once — write the value segmented (the Writer's default), not encoded whole`
        );
      }
      if (codec === CODEC_NONE && payloadBytes !== logicalBytes) {
        throw new Error(`beast2 v5: uncompressed frame lengths disagree (${payloadBytes} != ${logicalBytes})`);
      }
      const headerBytes = reader.offset;
      if (!await queue.fill(headerBytes + payloadBytes)) {
        throw new Error(`beast2 v5: truncated frame (payload of ${payloadBytes} bytes runs past end of input)`);
      }
      queue.skip(headerBytes);
      const payload = queue.take(payloadBytes);
      frames++;
      return new BufferReader(codec === CODEC_NONE ? payload : inflateRawSync(payload, logicalBytes), 0);
    };

    let reader = await nextFrame();
    while (reader.offset === reader.buffer.length) reader = await nextFrame();
    const tag = reader.readUint8();
    if (tag !== TAG_NEW) {
      throw new Error(`beast2 v5: root container must be NEW (tag 0x${tag.toString(16)})`);
    }
    for (let segment = 0; ; segment++) {
      while (reader.offset === reader.buffer.length) reader = await nextFrame();
      const count = reader.readVarint();
      if (count === 0) break;
      // A segment's elements decode against a table of their own: a REF that
      // reaches past it aliases a container this reader no longer holds.
      const ctx: V5DecodeContext = { containers: [], sourceMap, frozen, ...platform };
      for (let i = 0; i < count; i++) {
        let element: unknown;
        try {
          element = decodeElement(reader, ctx);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`beast2 v5: segment ${segment}: ${message.replace(/^beast2 v5: /, "")}`);
        }
        yield element;
      }
    }
    if (reader.offset !== reader.buffer.length) {
      throw new Error(`beast2 v5: ${reader.buffer.length - reader.offset} logical bytes after the root terminator`);
    }
  }

  return async function* (chunks) {
    const queue = new ChunkQueue(chunks);
    try {
      if (!await queue.fill(MAGIC_BYTES_V5.length)) {
        throw new Error(`Data too short for Beast2 format: ${queue.available} bytes`);
      }
      const magic = queue.peek(MAGIC_BYTES_V5.length);
      for (let i = 0; i < 7; i++) {
        if (magic[i] !== MAGIC_BYTES_V5[i]) {
          throw new Error(`Invalid Beast2 magic at offset ${i}: expected 0x${MAGIC_BYTES_V5[i]!.toString(16)}, got 0x${magic[i]!.toString(16)}`);
        }
      }
      if (magic[7] === MAGIC_BYTES[7]) {
        yield* legacyElements(queue) as AsyncGenerator<Beast2ElementOf<T>>;
        return;
      }
      if (magic[7] !== MAGIC_BYTES_V5[7]) {
        throw new Error(`Unknown Beast2 version: 0x${magic[7]!.toString(16)}`);
      }

      let header: { rootType: EastTypeValue; sourceMap: V5DecodeContext["sourceMap"]; length: number } | null = null;
      let lastError: unknown;
      for (const probe of HEAD_PROBE_BYTES) {
        const whole = !await queue.fill(probe);
        try {
          const reader = new BufferReader(queue.peek(Math.min(probe, queue.available)), MAGIC_BYTES_V5.length);
          const { rootType } = readTypeSection(reader);
          header = { rootType, sourceMap: readSourceMapSectionV5(reader), length: reader.offset };
          break;
        } catch (err) {
          // A short head fails as a malformed one does: grow it first, and
          // report the failure once the whole header is in hand.
          if (whole) throw err;
          lastError = err;
        }
      }
      if (header === null) {
        throw new Error(`beast2: header not readable in the first ${HEAD_PROBE_BYTES[HEAD_PROBE_BYTES.length - 1]} bytes — ${
          lastError instanceof Error ? lastError.message : String(lastError)}`);
      }
      checkType(header.rootType);
      queue.skip(header.length);
      yield* streamElements(queue, header.sourceMap) as AsyncGenerator<Beast2ElementOf<T>>;
    } finally {
      await queue.close();
    }
  };
}
