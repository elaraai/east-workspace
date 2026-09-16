/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The deterministic DEFLATE encoder, held to the bit-at-a-time original.
 *
 * e3 content-addresses beast2 bytes, so this encoder's output is part of the
 * wire format: a byte that moves re-keys every stored collection. The
 * word-packed rewrite (#762) changed only how bits reach the buffer, so the
 * gate is a differential one — {@link referenceDeflateRaw} below is the
 * pre-#762 implementation, kept verbatim as the oracle, and every input here
 * must compress to exactly the same bytes under both. The inflate check on top
 * proves the shared answer is really RFC 1951.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deterministicDeflateRaw } from "./deflate.js";
import { inflateRawPure } from "./inflate.js";

// ===================================================================
//  The oracle: the encoder exactly as it stood before #762.
// ===================================================================

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const HASH_SIZE = 1 << 15;
const HASH_MASK = HASH_SIZE - 1;
const MAX_CHAIN = 32;

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** The pre-#762 bit sink: one bit at a time, a byte at a time out. */
class ReferenceBitWriter {
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

  writeBits(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.cur |= ((value >> i) & 1) << this.bit;
      if (++this.bit === 8) { this.push(this.cur); this.cur = 0; this.bit = 0; }
    }
  }

  writeCode(code: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) this.writeBits((code >> i) & 1, 1);
  }

  finish(): Uint8Array {
    if (this.bit > 0) this.push(this.cur);
    return this.buf.subarray(0, this.len);
  }
}

function referenceWriteLitLen(bw: ReferenceBitWriter, sym: number): void {
  if (sym <= 143) bw.writeCode(0x30 + sym, 8);
  else if (sym <= 255) bw.writeCode(0x190 + sym - 144, 9);
  else if (sym <= 279) bw.writeCode(sym - 256, 7);
  else bw.writeCode(0xC0 + sym - 280, 8);
}

/** The encoder as it stood before #762 — the byte-identity oracle. */
function referenceDeflateRaw(src: Uint8Array): Uint8Array {
  const bw = new ReferenceBitWriter(Math.max(64, src.length >> 1));
  bw.writeBits(1, 1);
  bw.writeBits(1, 2);

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
      referenceWriteLitLen(bw, 257 + lc);
      bw.writeBits(bestLen - LEN_BASE[lc]!, LEN_EXTRA[lc]!);

      let dc = 0;
      while (dc < 29 && DIST_BASE[dc + 1]! <= bestDist) dc++;
      bw.writeCode(dc, 5);
      bw.writeBits(bestDist - DIST_BASE[dc]!, DIST_EXTRA[dc]!);

      for (let i = 0; i < bestLen; i++) insert(pos + i);
      pos += bestLen;
    } else {
      referenceWriteLitLen(bw, src[pos]!);
      insert(pos);
      pos++;
    }
  }

  referenceWriteLitLen(bw, 256);
  return bw.finish();
}

// ===================================================================
//  Inputs
// ===================================================================

/** xorshift32 — a fixed stream, so a failure reproduces exactly. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}

function randomBytes(n: number, seed: number): Uint8Array {
  const next = rng(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = next() & 0xff;
  return out;
}

/** Rows of a plausible table: repeated field names, drifting numbers. */
function structuredBytes(rows: number, seed: number): Uint8Array {
  const next = rng(seed);
  const parts: string[] = [];
  for (let i = 0; i < rows; i++) {
    parts.push(
      `{"id":${i},"site":"site-${i % 40}","region":"R${i % 7}",` +
      `"f1":${(next() % 100000) / 1000},"n1":${i % 1000},"flag":${(next() & 1) === 1}}`,
    );
  }
  return new TextEncoder().encode(parts.join("\n"));
}

function cases(): { name: string; bytes: Uint8Array }[] {
  const out: { name: string; bytes: Uint8Array }[] = [];
  // Degenerate lengths around the 3-byte minimum match and the word compare.
  for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 32, 33]) {
    out.push({ name: `random ${n}B`, bytes: randomBytes(n, 0x5eed + n) });
    out.push({ name: `one byte x${n}`, bytes: new Uint8Array(n).fill(0x41) });
  }
  // A run of one byte: the longest possible matches, back to back.
  out.push({ name: "one byte x100k", bytes: new Uint8Array(100_000).fill(0) });
  // Every byte distinct, then every byte distinct twice: no match, then a
  // match at exactly the window's far edge.
  const distinct = new Uint8Array(256);
  for (let i = 0; i < 256; i++) distinct[i] = i;
  out.push({ name: "all distinct bytes", bytes: distinct });
  const twice = new Uint8Array(512);
  twice.set(distinct, 0);
  twice.set(distinct, 256);
  out.push({ name: "all distinct bytes, twice", bytes: twice });
  // A block repeated at exactly WINDOW distance, and just past it.
  for (const gap of [WINDOW - 1, WINDOW, WINDOW + 1]) {
    const bytes = randomBytes(gap + 64, 0xc0ffee);
    bytes.set(bytes.subarray(0, 64), gap);
    out.push({ name: `64B repeated at ${gap}`, bytes });
  }
  // Incompressible and compressible bulk.
  out.push({ name: "random 1 MiB", bytes: randomBytes(1 << 20, 0xabcdef) });
  out.push({ name: "structured 4 MiB", bytes: structuredBytes(60_000, 0x1234) });
  return out;
}

// ===================================================================

describe("beast2 v5 deterministic deflate", () => {
  test("is byte-identical to the pre-#762 encoder", () => {
    for (const { name, bytes } of cases()) {
      const actual = deterministicDeflateRaw(bytes);
      const expected = referenceDeflateRaw(bytes);
      assert.deepEqual(
        Array.from(actual),
        Array.from(expected),
        `${name}: the word-packed encoder must reproduce the original's bytes`,
      );
    }
  });

  test("round-trips through inflate", () => {
    for (const { name, bytes } of cases()) {
      const round = inflateRawPure(deterministicDeflateRaw(bytes), bytes.length);
      assert.deepEqual(Array.from(round), Array.from(bytes), `${name}: inflate(deflate(x)) === x`);
    }
  });

  test("compresses a byte run hard, and never expands a frame beyond its literals", () => {
    const run = new Uint8Array(100_000).fill(0x7f);
    assert.ok(deterministicDeflateRaw(run).length < run.length / 100);
    // Incompressible input still goes out as fixed-Huffman literals, which cost
    // at most 9 bits each. The frame writer is what falls back to codec `none`.
    const noise = randomBytes(64 * 1024, 0x99);
    assert.ok(deterministicDeflateRaw(noise).length <= Math.ceil((noise.length * 9) / 8) + 16);
  });

  test("respects a subarray's bounds", () => {
    // The word compare loads through a DataView, which must be built on the
    // view's own window rather than the whole backing buffer.
    const backing = randomBytes(4096, 0x777);
    const middle = backing.subarray(1000, 3000);
    assert.deepEqual(
      Array.from(deterministicDeflateRaw(middle)),
      Array.from(referenceDeflateRaw(middle)),
    );
  });
});
