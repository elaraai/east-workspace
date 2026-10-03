/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * UUIDv7 generation for execution IDs.
 *
 * UUIDv7 (RFC 9562) provides:
 * - Timestamp-sortable: First 48 bits are millisecond Unix timestamp
 * - Globally unique: No coordination required across machines/repos
 * - Lexicographically ordered: max(id) = latest, of the ids one process
 *   mints; ids two processes mint in one millisecond sort by chance
 *
 * Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 *   - x: timestamp, then a counter (`rand_a`, 12 bits), then random
 *   - 7: version (7)
 *   - y: variant (8, 9, a, or b)
 */

/** The largest value of the counter in `rand_a`'s 12 bits. */
const COUNTER_MAX = 0xfff;

/** A new millisecond's counter starts at random with its top bit clear, so at
 *  least 2,048 ids fit in the millisecond before the counter overflows. */
const COUNTER_SEED_MASK = 0x7ff;

/**
 * Makes a UUIDv7 generator whose ids sort in the order it mints them, within
 * a millisecond as across them: RFC 9562 §6.2's Method 1, a counter in
 * `rand_a`.
 *
 * @remarks
 * It keeps the last id's timestamp and counter:
 * - in a new millisecond, the counter starts at random, its top bit clear;
 * - in the same millisecond, or when the clock reads earlier than the last
 *   id's timestamp (the RFC's monotonic error checking), the timestamp is kept
 *   and the counter goes up by one;
 * - a counter that would overflow moves the timestamp on by a millisecond, and
 *   starts at random again.
 *
 * So a timestamp runs ahead of the clock only past an overflow, or while the
 * clock reads earlier than it did. The 62 bits of `rand_b` are random in every
 * id, from the Web Crypto API's `getRandomValues`, which Node and every
 * browser provide.
 *
 * @param now - The clock, in epoch milliseconds
 * @returns The generator: each call mints the next id
 *
 * @internal
 */
export function uuidv7Generator(now: () => number = Date.now): () => string {
  let timestamp = -1;
  let counter = 0;
  return () => {
    const random = globalThis.crypto.getRandomValues(new Uint8Array(10));
    const seed = ((random[0]! << 8) | random[1]!) & COUNTER_SEED_MASK;
    const clock = now();
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
    for (let i = 9; i < 16; i++) {
      bytes[i] = random[i - 6]!;
    }

    // Convert to hex string with dashes
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/** This process's generator, which every id e3 mints comes from. */
const mint = uuidv7Generator();

/**
 * Generate a new UUIDv7.
 *
 * @remarks
 * It sorts after every id this process minted before it, as RFC 9562 §6.2's
 * Method 1 keeps them ({@link uuidv7Generator}), so a store that takes the
 * largest id for the latest finds the last one minted. Ids two processes mint
 * in the same millisecond sort by chance.
 *
 * @returns A new UUIDv7 string
 */
export function uuidv7(): string {
  return mint();
}

/**
 * Extract the timestamp from a UUIDv7.
 *
 * @param uuid - A UUIDv7 string
 * @returns The Date when the UUID was generated
 * @throws If the UUID is malformed
 */
export function uuidv7Timestamp(uuid: string): Date {
  // Remove dashes and validate format
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID format: ${uuid}`);
  }

  // Extract first 12 hex chars (48 bits = 6 bytes) as timestamp
  const timestampHex = hex.slice(0, 12);
  const timestamp = parseInt(timestampHex, 16);

  return new Date(timestamp);
}

/**
 * Validate that a string is a valid UUIDv7.
 *
 * @param uuid - String to validate
 * @returns True if the string is a valid UUIDv7
 */
export function isUuidv7(uuid: string): boolean {
  // Check format: 8-4-4-4-12 hex chars
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return pattern.test(uuid);
}
