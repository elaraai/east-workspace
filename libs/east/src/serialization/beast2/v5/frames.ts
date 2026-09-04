/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 frame layer — the on-wire transport of the value stream.
 *
 * The v5 value stream is a sequence of frames; the concatenation of the
 * decompressed frame payloads forms the logical value encoding. Each frame:
 *
 *     varint(codec_id) varint(uncompressed_len) varint(payload_len) payload
 *
 * Codec 0 (`none`) stores the logical bytes raw (`payload_len` must equal
 * `uncompressed_len`); codec 1 (`deflate`) stores a raw DEFLATE (RFC 1951)
 * stream that must inflate to exactly `uncompressed_len` bytes. Codec 2 is
 * reserved for zstd. Writers choose a codec per frame, so a blob may mix
 * compressed and uncompressed frames.
 *
 * Inflate uses Node's zlib when available (loaded via
 * `process.getBuiltinModule`, which browser bundlers ignore); without it the
 * sync path falls back to the portable decoder in `./inflate.ts`, so
 * synchronous decode works in every runtime. The async decode entry points
 * prefer the platform's native `DecompressionStream` for throughput.
 */

import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { deterministicDeflateRaw } from "./deflate.js";
import { inflateRawPure } from "./inflate.js";

/** Codec id: store logical bytes uncompressed. */
export const CODEC_NONE = 0;
/** Codec id: raw DEFLATE (RFC 1951). The mandatory baseline codec. */
export const CODEC_DEFLATE = 1;
/** Codec id reserved for zstd — not yet implemented by any runtime. */
export const CODEC_ZSTD = 2;

/** Codec names accepted by the encode entry points. */
export type Beast2Codec = "none" | "deflate";

/** Frames with payloads below this size are stored uncompressed. */
export const COMPRESSION_THRESHOLD = 64;

/** Upper bound on a single frame's uncompressed length (1 GiB) — guards
 *  against decompression bombs and absurd allocations on corrupt input. */
export const MAX_FRAME_UNCOMPRESSED = 1 << 30;

/** Resolves a codec name to its wire id. */
export function codecId(codec: Beast2Codec): number {
  return codec === "deflate" ? CODEC_DEFLATE : CODEC_NONE;
}

// =============================================================================
// Deflate bindings
// =============================================================================

type ZlibModule = {
  constants: { Z_SYNC_FLUSH: number };
  deflateRawSync(data: Uint8Array): Uint8Array;
  inflateRawSync(data: Uint8Array, options?: { maxOutputLength?: number; finishFlush?: number }): Uint8Array;
};

/** Node's zlib when running under Node, `null` in browsers. Resolved once via
 *  `process.getBuiltinModule` so bundlers never see a `node:zlib` import. */
const zlib: ZlibModule | null =
  (globalThis as any).process?.getBuiltinModule?.("node:zlib") ?? null;

/**
 * Compresses logical bytes with raw DEFLATE.
 *
 * Uses beast2's own specified encoder rather than the platform's zlib, so the
 * bytes are identical in every runtime — see `./deflate.ts` for why that
 * matters (content-addressing) and how the algorithm is pinned. It needs no
 * platform support at all, so browsers can compress too.
 *
 * @param data - the logical bytes to compress
 * @returns the raw DEFLATE stream
 */
export function deflateRawSync(data: Uint8Array): Uint8Array {
  return deterministicDeflateRaw(data);
}

/**
 * Decompresses a raw DEFLATE frame payload synchronously.
 *
 * Prefers Node's zlib (native code); without it — browsers — falls back to
 * the portable pure-TS inflate, so synchronous decode works everywhere.
 *
 * @param payload - the compressed frame payload
 * @param uncompressedLen - the expected logical byte length from the frame header
 * @returns the logical bytes
 * @throws {Error} When the stream is corrupt or the output length mismatches.
 */
export function inflateRawSync(payload: Uint8Array, uncompressedLen: number): Uint8Array {
  if (!zlib) {
    return inflateRawPure(payload, uncompressedLen);
  }
  const out = zlib.inflateRawSync(payload, { maxOutputLength: uncompressedLen });
  if (out.length !== uncompressedLen) {
    throw new Error(`beast2 v5: frame inflated to ${out.length} bytes, header declared ${uncompressedLen}`);
  }
  return out;
}

/**
 * Decompresses a raw DEFLATE frame payload asynchronously, preferring the
 * platform's native decompressor (`DecompressionStream("deflate-raw")`) in
 * browsers; falls back to the portable pure-TS inflate when neither zlib nor
 * `DecompressionStream` exists.
 *
 * @param payload - the compressed frame payload
 * @param uncompressedLen - the expected logical byte length from the frame header
 * @returns the logical bytes
 * @throws {Error} When the stream is corrupt or the output length mismatches.
 */
export async function inflateRawAsync(payload: Uint8Array, uncompressedLen: number): Promise<Uint8Array> {
  if (zlib) return inflateRawSync(payload, uncompressedLen);
  const DS = (globalThis as any).DecompressionStream as (new (format: string) => { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> }) | undefined;
  if (!DS) {
    return inflateRawPure(payload, uncompressedLen);
  }
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DS("deflate-raw"));
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > uncompressedLen) {
      throw new Error(`beast2 v5: frame inflated past the declared ${uncompressedLen} bytes`);
    }
  }
  if (total !== uncompressedLen) {
    throw new Error(`beast2 v5: frame inflated to ${total} bytes, header declared ${uncompressedLen}`);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// =============================================================================
// Frame write
// =============================================================================

/**
 * Writes one frame carrying the given logical bytes.
 *
 * Small payloads (below {@link COMPRESSION_THRESHOLD}) and payloads that
 * deflate fails to shrink are stored with codec `none` regardless of the
 * requested codec — the codec id is a per-frame writer choice.
 *
 * @param out - the wire-level writer to append the frame to
 * @param logical - the logical bytes this frame carries
 * @param codec - the requested codec for this frame
 */
export function writeFrame(out: BufferWriter, logical: Uint8Array, codec: Beast2Codec): void {
  if (codec === "deflate" && logical.length >= COMPRESSION_THRESHOLD) {
    const compressed = deflateRawSync(logical);
    if (compressed.length < logical.length) {
      out.writeVarint(CODEC_DEFLATE);
      out.writeVarint(logical.length);
      out.writeVarint(compressed.length);
      out.writeBytes(compressed);
      return;
    }
  }
  out.writeVarint(CODEC_NONE);
  out.writeVarint(logical.length);
  out.writeVarint(logical.length);
  out.writeBytes(logical);
}

// =============================================================================
// Frame read
// =============================================================================

/** A parsed frame header plus the payload's wire position. */
export interface FrameHeader {
  codec: number;
  uncompressedLen: number;
  payloadLen: number;
  /** Wire offset of the first payload byte. */
  payloadOffset: number;
  /** Wire offset of the byte after the payload (the next frame). */
  endOffset: number;
}

/**
 * Parses one frame header at `offset` and validates its bounds.
 *
 * @param data - the whole blob
 * @param offset - wire offset of the frame's first byte
 * @returns the parsed header
 * @throws {Error} When the header is truncated, the codec is unknown, the
 *   lengths are inconsistent, or the payload runs past the end of input.
 */
export function readFrameHeader(data: Uint8Array, offset: number): FrameHeader {
  const reader = new BufferReader(data, offset);
  const codec = reader.readVarint();
  const uncompressedLen = reader.readVarint();
  const payloadLen = reader.readVarint();
  if (codec !== CODEC_NONE && codec !== CODEC_DEFLATE) {
    if (codec === CODEC_ZSTD) {
      throw new Error(`beast2 v5: frame uses codec 2 (zstd), which this runtime does not support`);
    }
    throw new Error(`beast2 v5: unknown frame codec ${codec}`);
  }
  if (uncompressedLen > MAX_FRAME_UNCOMPRESSED) {
    throw new Error(`beast2 v5: frame declares ${uncompressedLen} uncompressed bytes (limit ${MAX_FRAME_UNCOMPRESSED})`);
  }
  if (codec === CODEC_NONE && payloadLen !== uncompressedLen) {
    throw new Error(`beast2 v5: uncompressed frame lengths disagree (${payloadLen} != ${uncompressedLen})`);
  }
  const payloadOffset = reader.offset;
  if (payloadOffset + payloadLen > data.length) {
    throw new Error(`beast2 v5: truncated frame (payload of ${payloadLen} bytes runs past end of input)`);
  }
  return { codec, uncompressedLen, payloadLen, payloadOffset, endOffset: payloadOffset + payloadLen };
}

/**
 * Sequential reader over the value stream's frames, yielding one
 * {@link BufferReader} per logical chunk.
 *
 * The driver decides when to stop pulling frames — the logical value encoding
 * is self-terminating, so bytes after the last consumed frame (the optional
 * index and footer) are never touched by this reader.
 */
export class FrameReader {
  /** Wire offset of the next unread frame (after the last consumed one). */
  wireOffset: number;
  /** Wire offsets of each consumed frame's first byte, in order. */
  readonly frameOffsets: number[] = [];
  private readonly data: Uint8Array;
  private readonly inflate: FrameInflate;

  /**
   * @param data - the whole blob
   * @param offset - wire offset of the first value-stream frame
   * @param inflate - decompressor for deflate frames (defaults to the sync
   *   zlib binding; the async decode path pre-inflates and injects a lookup)
   */
  constructor(data: Uint8Array, offset: number, inflate: FrameInflate = defaultInflate) {
    this.data = data;
    this.wireOffset = offset;
    this.inflate = inflate;
  }

  /** Whether another frame could start here (any unread bytes remain). */
  hasBytes(): boolean {
    return this.wireOffset < this.data.length;
  }

  /**
   * Consumes the next frame and returns a reader over its logical chunk.
   *
   * @returns a reader positioned at the chunk's first byte
   * @throws {Error} When no bytes remain or the frame is malformed.
   */
  next(): BufferReader {
    if (!this.hasBytes()) {
      throw new Error(`beast2 v5: truncated value stream (expected another frame at offset ${this.wireOffset})`);
    }
    const start = this.wireOffset;
    const h = readFrameHeader(this.data, start);
    this.frameOffsets.push(start);
    this.wireOffset = h.endOffset;
    const payload = this.data.subarray(h.payloadOffset, h.endOffset);
    if (h.codec === CODEC_NONE) {
      return new BufferReader(payload, 0);
    }
    return new BufferReader(this.inflate(payload, h.uncompressedLen, start), 0);
  }
}

/**
 * Opens the logical chunk of a frame from a PREFIX of its wire bytes — what
 * a fence probe reads: the frame header and however much of the payload the
 * prefix holds, inflated as far as it goes, so the first element decodes
 * without the frame being read whole.
 *
 * `null` when the prefix does not hold the frame header, the codec is not
 * one this runtime reads, or a deflate payload cannot be partially inflated
 * here (no zlib — the portable decoder needs the whole stream); the caller
 * then reads the frame whole, which also reports any corruption.
 *
 * @param prefix - the frame's first bytes, from its wire offset
 * @returns a reader over the logical bytes the prefix yields, or `null`
 * @throws {Error} When the prefix is corrupt rather than short — the caller
 *   retries with more of the frame, and the whole-frame read reports it.
 */
export function openFramePrefix(prefix: Uint8Array): BufferReader | null {
  const reader = new BufferReader(prefix, 0);
  let codec: number;
  let uncompressedLen: number;
  let payloadLen: number;
  try {
    codec = reader.readVarint();
    uncompressedLen = reader.readVarint();
    payloadLen = reader.readVarint();
  } catch {
    return null;
  }
  if (codec !== CODEC_NONE && codec !== CODEC_DEFLATE) return null;
  const payload = prefix.subarray(reader.offset, Math.min(prefix.length, reader.offset + payloadLen));
  if (codec === CODEC_NONE) return new BufferReader(payload, 0);
  if (!zlib) return null;
  // A truncated raw DEFLATE stream flushes what it reached instead of
  // failing — exactly the prefix the probe wants.
  return new BufferReader(zlib.inflateRawSync(payload, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: uncompressedLen }), 0);
}

/** Decompressor signature used by {@link FrameReader}: receives the payload,
 *  the declared uncompressed length, and the frame's wire start offset. */
export type FrameInflate = (payload: Uint8Array, uncompressedLen: number, frameStart: number) => Uint8Array;

function defaultInflate(payload: Uint8Array, uncompressedLen: number): Uint8Array {
  return inflateRawSync(payload, uncompressedLen);
}

/**
 * Pre-inflates every deflate frame from `offset` to the end of input
 * asynchronously and returns an inflate lookup keyed by frame start offset —
 * the browser decode path pairs this with a {@link FrameReader} and then runs
 * the ordinary synchronous decode.
 *
 * @param data - the whole blob
 * @param offset - wire offset of the first value-stream frame
 * @returns an inflate function serving the precomputed chunks
 */
export async function preInflateFrames(data: Uint8Array, offset: number): Promise<FrameInflate> {
  const chunks = new Map<number, Uint8Array>();
  let pos = offset;
  while (pos < data.length) {
    let h: FrameHeader;
    try {
      h = readFrameHeader(data, pos);
    } catch {
      // Not a valid frame — the trailing index/footer starts here. The sync
      // decode drive stops pulling frames on its own; anything malformed
      // before that point is reported by the sync pass with full context.
      break;
    }
    if (h.codec === CODEC_DEFLATE) {
      try {
        chunks.set(pos, await inflateRawAsync(data.subarray(h.payloadOffset, h.endOffset), h.uncompressedLen));
      } catch {
        // Corrupt frame, or index/footer bytes that merely looked like a
        // frame header — leave it to the sync pass, which stops at the true
        // end of the value stream and reports real corruption with context.
        break;
      }
    }
    pos = h.endOffset;
  }
  return (payload, uncompressedLen, frameStart) => {
    const chunk = chunks.get(frameStart);
    if (chunk) return chunk;
    return inflateRawSync(payload, uncompressedLen);
  };
}
