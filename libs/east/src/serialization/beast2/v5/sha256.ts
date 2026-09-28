/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SHA-256 (FIPS 180-4), the name of every object a manifest directory holds.
 *
 * A store names an object by the SHA-256 of its bytes, and a manifest names
 * its segments and its header the same way. A runtime that writes a manifest
 * directory therefore writes the names the store would give its files, and the
 * store takes each one in under its name without hashing it again. `east` runs
 * in the browser as well as on Node, so the hash is written here rather than
 * borrowed from a platform; east-c carries the same function, which east-py
 * binds.
 */

/** The round constants: the first 32 bits of the fractional parts of the cube
 *  roots of the first 64 primes. */
const K = Int32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
);

/** Folds the 64-byte block at `offset` into `state`. Words are int32: every
 *  sum is taken mod 2^32 by `| 0`, and `>>>` reads a word as unsigned. */
function compress(state: Int32Array, w: Int32Array, data: Uint8Array, offset: number): void {
  for (let t = 0; t < 16; t++) {
    const i = offset + t * 4;
    w[t] = (data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!;
  }
  for (let t = 16; t < 64; t++) {
    const x = w[t - 15]!;
    const y = w[t - 2]!;
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0;
  }
  let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!;
  let e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
  for (let t = 0; t < 64; t++) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[t]! + w[t]!) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  state[0] = (state[0]! + a) | 0;
  state[1] = (state[1]! + b) | 0;
  state[2] = (state[2]! + c) | 0;
  state[3] = (state[3]! + d) | 0;
  state[4] = (state[4]! + e) | 0;
  state[5] = (state[5]! + f) | 0;
  state[6] = (state[6]! + g) | 0;
  state[7] = (state[7]! + h) | 0;
}

/**
 * The SHA-256 digest of `bytes`, in lowercase hex — the name a store gives an
 * object, and a manifest gives each object it names.
 *
 * @param bytes - the bytes to hash
 * @returns the digest as 64 lowercase hex digits
 *
 * @example
 * ```ts
 * sha256Hex(new TextEncoder().encode("abc"));
 * // "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
 * ```
 */
export function sha256Hex(bytes: Uint8Array): string {
  const state = Int32Array.of(
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  );
  const w = new Int32Array(64);
  const whole = bytes.length - (bytes.length % 64);
  for (let offset = 0; offset < whole; offset += 64) compress(state, w, bytes, offset);

  // The rest, a 1 bit, zeros, and the message's length in bits as a
  // big-endian u64 — one block, or two when the length does not fit after
  // the rest.
  const rest = bytes.length - whole;
  const tail = new Uint8Array(rest < 56 ? 64 : 128);
  tail.set(bytes.subarray(whole));
  tail[rest] = 0x80;
  const bits = bytes.length * 8;
  const high = Math.floor(bits / 0x100000000);
  const low = bits >>> 0;
  const at = tail.length - 8;
  tail[at] = high >>> 24;
  tail[at + 1] = high >>> 16;
  tail[at + 2] = high >>> 8;
  tail[at + 3] = high;
  tail[at + 4] = low >>> 24;
  tail[at + 5] = low >>> 16;
  tail[at + 6] = low >>> 8;
  tail[at + 7] = low;
  for (let offset = 0; offset < tail.length; offset += 64) compress(state, w, tail, offset);

  let hex = "";
  for (let i = 0; i < 8; i++) hex += (state[i]! >>> 0).toString(16).padStart(8, "0");
  return hex;
}
