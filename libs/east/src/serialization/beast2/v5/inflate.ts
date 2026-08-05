/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Portable raw-DEFLATE (RFC 1951) inflate for beast2 v5 frames.
 *
 * **Why we ship our own inflate.** v5 deflate frames must decode wherever
 * East values are read, and the synchronous decode surface
 * (`decodeBeast2For`) is embedded in call sites that cannot become async —
 * React renderers, platform-function bodies, extension hosts. Node has
 * `node:zlib`; browsers expose only the async `DecompressionStream`, which
 * cannot back a synchronous decoder. This module closes that gap: a
 * dependency-free inflate used whenever zlib is absent, so the sync entry
 * points work in every runtime. `frames.ts` still prefers zlib when present,
 * and the async decode entry points still use the platform's native
 * decompressor for throughput.
 *
 * Decodes the full format — stored, fixed-Huffman and dynamic-Huffman blocks.
 * Our own deterministic encoder emits only single fixed-Huffman blocks, but
 * foreign writers (east-c's miniz, CPython's zlib, node's zlib) may emit any
 * mix, and inflate must stay liberal for the format's interoperability
 * guarantee to hold.
 *
 * The structure follows Mark Adler's canonical "puff" reference decoder:
 * canonical-Huffman decode via per-length counts rather than lookup tables.
 * That trades peak speed for being small and auditable; frames on the
 * browser sync path (UI payloads) inflate in well under a millisecond.
 */

/** Longest Huffman code the format permits. */
const MAXBITS = 15;

// RFC 1951 §3.2.5 length and distance tables (length symbols 257–285,
// distance symbols 0–29).
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

// RFC 1951 §3.2.7: the order in which code-length-code lengths are stored.
const CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** LSB-first bit source over the compressed payload, as DEFLATE requires. */
class BitReader {
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;

  constructor(private readonly src: Uint8Array) {}

  /** Reads `count` bits (least-significant bit first), `count` ≤ 13. */
  bits(count: number): number {
    while (this.bitCnt < count) {
      if (this.pos >= this.src.length) {
        throw new Error(`beast2 v5: truncated DEFLATE stream`);
      }
      this.bitBuf |= this.src[this.pos++]! << this.bitCnt;
      this.bitCnt += 8;
    }
    const value = this.bitBuf & ((1 << count) - 1);
    this.bitBuf >>>= count;
    this.bitCnt -= count;
    return value;
  }

  /** Discards buffered bits up to the next byte boundary. After any `bits()`
   *  call at most 7 bits of the current byte remain buffered, so dropping the
   *  buffer IS the alignment. */
  align(): void {
    this.bitBuf = 0;
    this.bitCnt = 0;
  }

  /** Reads `len` raw bytes (call only when byte-aligned). */
  bytes(len: number): Uint8Array {
    if (this.pos + len > this.src.length) {
      throw new Error(`beast2 v5: truncated DEFLATE stream`);
    }
    const view = this.src.subarray(this.pos, this.pos + len);
    this.pos += len;
    return view;
  }
}

/** A canonical Huffman code, in puff's counted representation. */
interface Huffman {
  /** `count[len]` = number of codes of bit length `len` (index 0 unused). */
  count: Int32Array;
  /** Symbols ordered by (code length, then symbol value). */
  symbol: Int32Array;
}

/** Builds a canonical Huffman code from the first `n` code lengths.
 *  Over-subscribed codes are rejected; incomplete codes are permitted (an
 *  unassigned code simply fails to decode if the stream ever uses it). */
function buildHuffman(lengths: Uint8Array, n: number): Huffman {
  const count = new Int32Array(MAXBITS + 1);
  for (let i = 0; i < n; i++) count[lengths[i]!]!++;
  if (count[0] === n) {
    return { count, symbol: new Int32Array(0) };
  }
  let left = 1;
  for (let len = 1; len <= MAXBITS; len++) {
    left <<= 1;
    left -= count[len]!;
    if (left < 0) {
      throw new Error(`beast2 v5: over-subscribed Huffman code in DEFLATE stream`);
    }
  }
  const offs = new Int32Array(MAXBITS + 1);
  for (let len = 1; len < MAXBITS; len++) {
    offs[len + 1] = offs[len]! + count[len]!;
  }
  const symbol = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (lengths[i]! !== 0) symbol[offs[lengths[i]!]!++] = i;
  }
  return { count, symbol };
}

/** Decodes one symbol, reading the code bit-by-bit (codes are packed
 *  most-significant bit first within the LSB-first bitstream). */
function decodeSym(br: BitReader, h: Huffman): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len <= MAXBITS; len++) {
    code |= br.bits(1);
    const count = h.count[len]!;
    if (code - first < count) {
      return h.symbol[index + (code - first)]!;
    }
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error(`beast2 v5: invalid Huffman code in DEFLATE stream`);
}

let fixedLit: Huffman | null = null;
let fixedDist: Huffman | null = null;

/** The fixed-Huffman tables of RFC 1951 §3.2.6, built once on first use. */
function fixedTables(): [Huffman, Huffman] {
  if (!fixedLit || !fixedDist) {
    const litLengths = new Uint8Array(288);
    litLengths.fill(8, 0, 144);
    litLengths.fill(9, 144, 256);
    litLengths.fill(7, 256, 280);
    litLengths.fill(8, 280, 288);
    fixedLit = buildHuffman(litLengths, 288);
    const distLengths = new Uint8Array(30);
    distLengths.fill(5);
    fixedDist = buildHuffman(distLengths, 30);
  }
  return [fixedLit, fixedDist];
}

/** Reads a dynamic block's header (RFC 1951 §3.2.7) and builds its tables. */
function dynamicTables(br: BitReader): [Huffman, Huffman] {
  const hlit = br.bits(5) + 257;
  const hdist = br.bits(5) + 1;
  const hclen = br.bits(4) + 4;
  if (hlit > 286 || hdist > 30) {
    throw new Error(`beast2 v5: DEFLATE dynamic block declares too many codes (${hlit} literal/length, ${hdist} distance)`);
  }
  const clcLengths = new Uint8Array(19);
  for (let i = 0; i < hclen; i++) {
    clcLengths[CLC_ORDER[i]!] = br.bits(3);
  }
  const clc = buildHuffman(clcLengths, 19);

  const lengths = new Uint8Array(hlit + hdist);
  let i = 0;
  while (i < hlit + hdist) {
    const sym = decodeSym(br, clc);
    if (sym < 16) {
      lengths[i++] = sym;
      continue;
    }
    let value = 0;
    let repeat: number;
    if (sym === 16) {
      if (i === 0) {
        throw new Error(`beast2 v5: DEFLATE repeat code with no previous length`);
      }
      value = lengths[i - 1]!;
      repeat = 3 + br.bits(2);
    } else if (sym === 17) {
      repeat = 3 + br.bits(3);
    } else {
      repeat = 11 + br.bits(7);
    }
    if (i + repeat > hlit + hdist) {
      throw new Error(`beast2 v5: DEFLATE length repeat runs past the declared code count`);
    }
    while (repeat-- > 0) lengths[i++] = value;
  }
  if (lengths[256] === 0) {
    throw new Error(`beast2 v5: DEFLATE dynamic block has no end-of-block code`);
  }
  return [buildHuffman(lengths, hlit), buildHuffman(lengths.subarray(hlit), hdist)];
}

/**
 * Decompresses a raw DEFLATE stream without platform support.
 *
 * Accepts any valid RFC 1951 stream (stored, fixed and dynamic blocks, in
 * any mix) and enforces the beast2 frame contract: the stream must inflate
 * to exactly `uncompressedLen` bytes.
 *
 * @param payload - the raw DEFLATE stream (no zlib header or trailer)
 * @param uncompressedLen - the expected output length from the frame header
 * @returns the decompressed bytes
 * @throws {Error} When the stream is truncated or corrupt, or its output
 *   length disagrees with `uncompressedLen`.
 */
export function inflateRawPure(payload: Uint8Array, uncompressedLen: number): Uint8Array {
  const out = new Uint8Array(uncompressedLen);
  let outPos = 0;
  const br = new BitReader(payload);
  for (;;) {
    const bfinal = br.bits(1);
    const btype = br.bits(2);
    if (btype === 3) {
      throw new Error(`beast2 v5: invalid DEFLATE block type 3`);
    }
    if (btype === 0) {
      br.align();
      const header = br.bytes(4);
      const len = header[0]! | (header[1]! << 8);
      const nlen = header[2]! | (header[3]! << 8);
      if ((len ^ 0xffff) !== nlen) {
        throw new Error(`beast2 v5: stored DEFLATE block length check failed`);
      }
      if (outPos + len > uncompressedLen) {
        throw new Error(`beast2 v5: frame inflated past the declared ${uncompressedLen} bytes`);
      }
      out.set(br.bytes(len), outPos);
      outPos += len;
    } else {
      const [lit, dist] = btype === 1 ? fixedTables() : dynamicTables(br);
      for (;;) {
        const sym = decodeSym(br, lit);
        if (sym < 256) {
          if (outPos >= uncompressedLen) {
            throw new Error(`beast2 v5: frame inflated past the declared ${uncompressedLen} bytes`);
          }
          out[outPos++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          if (sym > 285) {
            throw new Error(`beast2 v5: invalid DEFLATE length symbol ${sym}`);
          }
          const length = LEN_BASE[sym - 257]! + br.bits(LEN_EXTRA[sym - 257]!);
          const dsym = decodeSym(br, dist);
          if (dsym > 29) {
            throw new Error(`beast2 v5: invalid DEFLATE distance symbol ${dsym}`);
          }
          const distance = DIST_BASE[dsym]! + br.bits(DIST_EXTRA[dsym]!);
          if (distance > outPos) {
            throw new Error(`beast2 v5: DEFLATE match distance ${distance} reaches before the start of output`);
          }
          if (outPos + length > uncompressedLen) {
            throw new Error(`beast2 v5: frame inflated past the declared ${uncompressedLen} bytes`);
          }
          // Byte-by-byte so overlapping matches replicate, as LZ77 requires.
          for (let k = 0; k < length; k++) {
            out[outPos] = out[outPos - distance]!;
            outPos++;
          }
        }
      }
    }
    if (bfinal) break;
  }
  if (outPos !== uncompressedLen) {
    throw new Error(`beast2 v5: frame inflated to ${outPos} bytes, header declared ${uncompressedLen}`);
  }
  return out;
}
