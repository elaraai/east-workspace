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
 * What is pinned is the *symbol stream*, not how the bits reach the buffer, so
 * the implementation is free to be fast: {@link BitWriter} accumulates in a
 * machine word and flushes whole bytes rather than stepping bit by bit, Huffman
 * codes are pre-reversed into {@link LL_SYM} so emitting one is a shift and an
 * or, and match candidates are compared four bytes at a time. Each of those is
 * byte-for-byte output-preserving — `deflate.spec.ts` holds this file to a copy
 * of the bit-at-a-time original over structured and random inputs.
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

/** Reverse the low `width` bits of `value`. */
function reverseBits(value: number, width: number): number {
  let out = 0;
  for (let i = 0; i < width; i++) out |= ((value >>> i) & 1) << (width - 1 - i);
  return out;
}

/**
 * The fixed literal/length code (RFC 1951 §3.2.6), one entry per symbol, packed
 * as `(code reversed within its width) << 4 | width`.
 *
 * Huffman codes go out most-significant bit first while the sink packs
 * least-significant first, so reversing each code once — here — turns emitting
 * one into a single shift-and-or. Widths are 7…9 and codes at most 9 bits, so
 * the pair fits 13 bits. east-c holds the same table as a literal constant.
 */
const LL_SYM = ((): Uint16Array => {
  const table = new Uint16Array(288);
  for (let sym = 0; sym < 288; sym++) {
    let code: number;
    let width: number;
    if (sym <= 143) { code = 0x30 + sym; width = 8; }
    else if (sym <= 255) { code = 0x190 + sym - 144; width = 9; }
    else if (sym <= 279) { code = sym - 256; width = 7; }
    else { code = 0xC0 + sym - 280; width = 8; }
    table[sym] = (reverseBits(code, width) << 4) | width;
  }
  return table;
})();

/** The fixed distance code: five bits, reversed the same way. */
const DIST_CODE = ((): Uint8Array => {
  const table = new Uint8Array(30);
  for (let d = 0; d < 30; d++) table[d] = reverseBits(d, 5);
  return table;
})();

/**
 * LSB-first bit sink, as DEFLATE requires.
 *
 * Bits accumulate in `acc` and leave two bytes at a time. No field written here
 * is wider than 13 bits and a flush leaves fewer than 16 live, so `acc` never
 * reaches bit 31 and stays a small non-negative int32.
 */
class BitWriter {
  private buf: Uint8Array;
  private len = 0;
  private acc = 0;
  private nbits = 0;

  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(64, capacity));
  }

  private grow(need: number): void {
    let capacity = this.buf.length;
    while (capacity < need) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.buf);
    this.buf = grown;
  }

  /** Write `count` low bits of `value`, least-significant bit first. */
  writeBits(value: number, count: number): void {
    this.acc |= (value & ((1 << count) - 1)) << this.nbits;
    this.nbits += count;
    if (this.nbits >= 16) {
      if (this.len + 2 > this.buf.length) this.grow(this.len + 2);
      this.buf[this.len++] = this.acc & 0xff;
      this.buf[this.len++] = (this.acc >>> 8) & 0xff;
      this.acc >>>= 16;
      this.nbits -= 16;
    }
  }

  /** Emit a literal/length symbol in the fixed code. */
  writeLitLen(sym: number): void {
    const entry = LL_SYM[sym]!;
    this.writeBits(entry >>> 4, entry & 15);
  }

  /** Flush the tail, zero-padding the final partial byte. */
  finish(): Uint8Array {
    while (this.nbits > 0) {
      if (this.len + 1 > this.buf.length) this.grow(this.len + 1);
      this.buf[this.len++] = this.acc & 0xff;
      this.acc >>>= 8;
      this.nbits -= 8;
    }
    return this.buf.subarray(0, this.len);
  }
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
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);

  const hashAt = (i: number): number =>
    ((src[i]! << 10) ^ (src[i + 1]! << 5) ^ src[i + 2]!) & HASH_MASK;

  const insert = (i: number): void => {
    if (i + MIN_MATCH > n) return;
    const h = hashAt(i);
    prev[i] = head[h]!;
    head[h] = i;
  };

  /**
   * Length of the common prefix of `src` at `a` and at `b`, capped at `max` —
   * the same number a byte-at-a-time loop gives, which is what the output's
   * determinism rests on.
   */
  const matchLen = (a: number, b: number, max: number): number => {
    let len = 0;
    while (len + 4 <= max) {
      const x = view.getUint32(a + len, true);
      const y = view.getUint32(b + len, true);
      if (x !== y) {
        const diff = x ^ y;
        // Isolate the lowest differing bit; its byte is the first mismatch,
        // because the words were loaded little-endian.
        return len + ((31 - Math.clz32(diff & -diff)) >> 3);
      }
      len += 4;
    }
    while (len < max && src[a + len] === src[b + len]) len++;
    return len;
  };

  let pos = 0;
  while (pos < n) {
    let bestLen = 0;
    let bestDist = 0;
    // The position's hash, computed at most once per position: the chain head
    // and the literal-path insert below both want it, and on data that does not
    // compress that insert is the whole inner loop. -1 while `pos` is in the
    // last two bytes, which are never hashed.
    let hash = -1;

    if (pos + MIN_MATCH <= n) {
      hash = hashAt(pos);
      let cand = head[hash]!;
      let chain = 0;
      const maxLen = Math.min(MAX_MATCH, n - pos);
      while (cand >= 0 && chain++ < MAX_CHAIN) {
        const dist = pos - cand;
        if (dist > WINDOW) break;
        // A candidate can only matter by beating `bestLen`, which needs it to
        // match at index `bestLen` — so one compare rejects nearly every
        // candidate on data that does not compress. Rejecting it here is
        // exactly what the length loop would have done, so the symbol stream
        // is untouched. (`bestLen < maxLen` inside the loop, so both reads are
        // in bounds.)
        if (src[cand + bestLen] === src[pos + bestLen]) {
          const len = matchLen(cand, pos, maxLen);
          // Strictly greater: among equal-length matches the nearest wins,
          // which is part of what makes the output reproducible.
          if (len > bestLen) {
            bestLen = len;
            bestDist = dist;
            if (len === maxLen) break;
          }
        }
        cand = prev[cand]!;
      }
    }

    if (bestLen >= MIN_MATCH) {
      let lc = 0;
      while (lc < 28 && LEN_BASE[lc + 1]! <= bestLen) lc++;
      bw.writeLitLen(257 + lc);
      bw.writeBits(bestLen - LEN_BASE[lc]!, LEN_EXTRA[lc]!);

      let dc = 0;
      while (dc < 29 && DIST_BASE[dc + 1]! <= bestDist) dc++;
      bw.writeBits(DIST_CODE[dc]!, 5);
      bw.writeBits(bestDist - DIST_BASE[dc]!, DIST_EXTRA[dc]!);

      for (let i = 0; i < bestLen; i++) insert(pos + i);
      pos += bestLen;
    } else {
      bw.writeLitLen(src[pos]!);
      if (hash >= 0) {
        prev[pos] = head[hash]!;
        head[hash] = pos;
      }
      pos++;
    }
  }

  bw.writeLitLen(256);   // end of block
  return bw.finish();
}
