/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The UUIDv7 a client mints to name a call it starts (east-workspace#1554),
 * so it can ask the server to stop the call before the start answers.
 *
 * The same ids as e3-core's `uuidv7` (RFC 9562 §6.2's Method 1: a millisecond
 * timestamp, then a counter in `rand_a`, then random bits), kept here because
 * the client depends on no package of the server's.
 *
 * @packageDocumentation
 */

/** The largest value of the counter in `rand_a`'s 12 bits. */
const COUNTER_MAX = 0xfff;

/** A new millisecond's counter starts at random with its top bit clear, so at
 *  least 2,048 ids fit in the millisecond before the counter overflows. */
const COUNTER_SEED_MASK = 0x7ff;

let timestamp = -1;
let counter = 0;

/**
 * Mints a UUIDv7 of now, which sorts after every id this process minted
 * before it.
 *
 * @remarks
 * In a new millisecond the counter starts at random; in the same one, or when
 * the clock reads earlier than the last id's timestamp, the timestamp is kept
 * and the counter goes up by one; a counter that would overflow moves the
 * timestamp on by a millisecond. The 62 bits of `rand_b` are random, from the
 * Web Crypto API's `getRandomValues`, which Node and every browser provide.
 *
 * @returns The id
 *
 * @internal
 */
export function uuidv7(): string {
  const random = globalThis.crypto.getRandomValues(new Uint8Array(10));
  const seed = ((random[0]! << 8) | random[1]!) & COUNTER_SEED_MASK;
  const clock = Date.now();
  if (clock > timestamp) {
    timestamp = clock;
    counter = seed;
  } else if (counter < COUNTER_MAX) {
    counter++;
  } else {
    timestamp++;
    counter = seed;
  }

  const bytes = new Uint8Array(16);
  // Bytes 0-5: the timestamp (big-endian, 48 bits)
  bytes[0] = (timestamp / 0x10000000000) & 0xff;
  bytes[1] = (timestamp / 0x100000000) & 0xff;
  bytes[2] = (timestamp / 0x1000000) & 0xff;
  bytes[3] = (timestamp / 0x10000) & 0xff;
  bytes[4] = (timestamp / 0x100) & 0xff;
  bytes[5] = timestamp & 0xff;
  // Bytes 6-7: the version (0111) and the counter's 12 bits
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  // Bytes 8-15: the variant (10) and 62 random bits
  bytes[8] = (random[2]! & 0x3f) | 0x80;
  for (let i = 9; i < 16; i++) bytes[i] = random[i - 6]!;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
