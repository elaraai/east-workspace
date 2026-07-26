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
 * Deflate uses Node's zlib when available (loaded via
 * `process.getBuiltinModule`, which browser bundlers ignore); browsers fall
 * back to the async `CompressionStream`/`DecompressionStream` path used by
 * the async decode entry points.
 */

import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { deterministicDeflateRaw } from "./deflate.js";

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
  deflateRawSync(data: Uint8Array): Uint8Array;
  inflateRawSync(data: Uint8Array, options?: { maxOutputLength?: number }): Uint8Array;
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
 * @param payload - the compressed frame payload
 * @param uncompressedLen - the expected logical byte length from the frame header
 * @returns the logical bytes
 * @throws {Error} When zlib is unavailable (browsers — use the async decode
 *   entry points), the stream is corrupt, or the output length mismatches.
 */
export function inflateRawSync(payload: Uint8Array, uncompressedLen: number): Uint8Array {
  if (!zlib) {
    throw new Error(`beast2 v5: synchronous inflate needs Node's zlib; use the async decode entry points in browsers`);
  }
  const out = zlib.inflateRawSync(payload, { maxOutputLength: uncompressedLen });
  if (out.length !== uncompressedLen) {
    throw new Error(`beast2 v5: frame inflated to ${out.length} bytes, header declared ${uncompressedLen}`);
  }
  return out;
}

/**
 * Decompresses a raw DEFLATE frame payload asynchronously via
 * `DecompressionStream("deflate-raw")` — the browser path.
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
    throw new Error(`beast2 v5: no inflate available (neither Node's zlib nor DecompressionStream)`);
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
