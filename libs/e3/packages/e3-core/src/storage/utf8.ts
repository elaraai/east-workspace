/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Length of the longest prefix of `bytes` that ends on a UTF-8 character
 * boundary.
 *
 * A log is read a window of bytes at a time, and each window decoded on its
 * own, so a window that stopped mid-character would decode to U+FFFD on both
 * sides of the boundary and corrupt a paged read. Malformed input is left
 * alone: there is nothing to preserve.
 *
 * @param bytes - The window's bytes
 * @returns The length of its prefix that holds whole characters
 */
export function completeUtf8Length(bytes: Uint8Array): number {
  // Walk back over the trailing continuation bytes to the lead byte of the
  // final sequence; keep that sequence only if all of its bytes are present.
  for (let i = bytes.length - 1, trailing = 0; i >= 0 && trailing < 4; i--, trailing++) {
    const byte = bytes[i]!;
    if ((byte & 0xc0) === 0x80) continue;
    const width = byte < 0x80 ? 1 : (byte & 0xe0) === 0xc0 ? 2 : (byte & 0xf0) === 0xe0 ? 3 : 4;
    return trailing + 1 >= width ? bytes.length : i;
  }
  return bytes.length;
}
