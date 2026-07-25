/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Deterministic DEFLATE encoder for beast2 v5 frames.
 *
 * **Why we ship our own encoder.** Inflate is universally interoperable — any
 * valid RFC 1951 stream decodes identically under zlib, zlib-ng, miniz and the
 * browser's `DecompressionStream`. Deflate is not: every library picks its own
 * match finding and Huffman trees, so the same input compresses to different
 * (all valid) bytes. Measured: miniz, node's zlib and CPython's zlib disagree
 * three ways on identical input. Since e3 content-addresses beast2 bytes, an
 * implementation-defined encoder would give one logical value several hashes
 * depending on which runtime wrote it — splitting caches and duplicating
 * objects.
 *
 * So beast2 pins the *encoder*, not the library: this algorithm is specified
 * in v5/SPEC.md and implemented identically here and in east-c (east-py reaches
 * it through the C bridge). Output is a pure function of the input. Decoders
 * stay liberal and simply inflate, so nothing downstream needs porting.
 *
 * The three things implementations disagree on are all pinned here:
 * - **Fixed Huffman blocks** (`BTYPE=01`) — no dynamic tree construction,
 *   which is the largest source of divergence.
 * - **A specified match finder** — 3-byte hash of fixed width, chains bounded
 *   at {@link MAX_CHAIN}, greedy with a strictly-greater comparison so the
 *   shortest distance wins ties.
 * - **Specified window and bit packing**, straight from RFC 1951.
 *
 * It compresses less than zlib (~1.6x larger) and that is the price of
 * determinism; it still beats the uncompressed form by ~3.3x on real data.
 */

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;

/** Match-chain bound. Pinned by the format: it caps work AND fixes the output. */
const MAX_CHAIN = 32;

// RFC 1951 §3.2.5 length and distance tables.
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** LSB-first bit sink, as DEFLATE requires. */
class BitWriter {
  private buf: Uint8Array;
  private len = 0;
  private cur = 0;
  private bit = 0;

  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(64, capacity));
  }

  private push(byte: number): void {
    if (this.len === this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf[this.len++] = byte;
  }

  /** Write `count` low bits of `value`, least-significant bit first. */
  writeBits(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.cur |= ((value >> i) & 1) << this.bit;
      if (++this.bit === 8) { this.push(this.cur); this.cur = 0; this.bit = 0; }
    }
  }

  /** Write a Huffman code, most-significant bit of the code first. */
  writeCode(code: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) this.writeBits((code >> i) & 1, 1);
  }

  finish(): Uint8Array {
    if (this.bit > 0) this.push(this.cur);
    return this.buf.subarray(0, this.len);
  }
}

/** Emit a literal/length symbol in the fixed code (RFC 1951 §3.2.6). */
function writeLitLen(bw: BitWriter, sym: number): void {
  if (sym <= 143) bw.writeCode(0x30 + sym, 8);
  else if (sym <= 255) bw.writeCode(0x190 + sym - 144, 9);
  else if (sym <= 279) bw.writeCode(sym - 256, 7);
  else bw.writeCode(0xC0 + sym - 280, 8);
}

/**
 * Compresses `src` to a raw DEFLATE stream, deterministically.
 *
 * The output is a pure function of the input — byte-identical to east-c's
 * implementation of the same specified algorithm — and is ordinary RFC 1951
 * DEFLATE, so any standard inflate reads it.
 *
 * @param src - the bytes to compress
 * @returns a raw DEFLATE stream (no zlib header, no trailer)
 */
export function deterministicDeflateRaw(src: Uint8Array): Uint8Array {
  const bw = new BitWriter(Math.max(64, src.length >> 1));
  bw.writeBits(1, 1);   // BFINAL — beast2 frames are a single block
  bw.writeBits(1, 2);   // BTYPE = 01, fixed Huffman

  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(src.length > 0 ? src.length : 1).fill(-1);
  const n = src.length;

  const hashAt = (i: number): number =>
    ((src[i]! << 10) ^ (src[i + 1]! << 5) ^ src[i + 2]!) & HASH_MASK;

  const insert = (i: number): void => {
    if (i + MIN_MATCH > n) return;
    const h = hashAt(i);
    prev[i] = head[h]!;
    head[h] = i;
  };

  let pos = 0;
  while (pos < n) {
    let bestLen = 0;
    let bestDist = 0;

    if (pos + MIN_MATCH <= n) {
      let cand = head[hashAt(pos)]!;
      let chain = 0;
      const maxLen = Math.min(MAX_MATCH, n - pos);
      while (cand >= 0 && chain++ < MAX_CHAIN) {
        const dist = pos - cand;
        if (dist > WINDOW) break;
        let len = 0;
        while (len < maxLen && src[cand + len] === src[pos + len]) len++;
        // Strictly greater: among equal-length matches the nearest wins,
        // which is part of what makes the output reproducible.
        if (len > bestLen) {
          bestLen = len;
          bestDist = dist;
          if (len === maxLen) break;
        }
        cand = prev[cand]!;
      }
    }

    if (bestLen >= MIN_MATCH) {
      let lc = 0;
      while (lc < 28 && LEN_BASE[lc + 1]! <= bestLen) lc++;
      writeLitLen(bw, 257 + lc);
      bw.writeBits(bestLen - LEN_BASE[lc]!, LEN_EXTRA[lc]!);

      let dc = 0;
      while (dc < 29 && DIST_BASE[dc + 1]! <= bestDist) dc++;
      bw.writeCode(dc, 5);
      bw.writeBits(bestDist - DIST_BASE[dc]!, DIST_EXTRA[dc]!);

      for (let i = 0; i < bestLen; i++) insert(pos + i);
      pos += bestLen;
    } else {
      writeLitLen(bw, src[pos]!);
      insert(pos);
      pos++;
    }
  }

  writeLitLen(bw, 256);   // end of block
  return bw.finish();
}
