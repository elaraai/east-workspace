/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * CRC-32 (ISO-HDLC, the checksum of zip and gzip), in every runtime.
 *
 * A zip names each entry's bytes by their CRC-32, which its writer computes
 * and its reader checks, and e3 reads and writes its zips wherever it runs: on
 * Node, and in a browser. Node's zlib computes the checksum in native code
 * (`zlib.crc32`, from Node 22.2), reached as the frame layer reaches zlib —
 * through a guarded `process.getBuiltinModule`, which a browser answers with
 * `undefined`, so no bundler sees a `node:zlib` import. Where the runtime has
 * no zlib, or a zlib without `crc32`, the checksum is computed here, a byte at
 * a time through a table. The two give the same answer for every input.
 */

/** Node's zlib `crc32`: the CRC-32 of `data`, going on from `value`. */
type ZlibCrc32 = (data: Uint8Array, value?: number) => number;

/** Node's zlib `crc32` where the runtime has it, `null` elsewhere. Resolved
 *  once via `process.getBuiltinModule`, so bundlers never see a `node:zlib`
 *  import. */
const zlibCrc32: ZlibCrc32 | null = (() => {
  const zlib = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
    .process?.getBuiltinModule?.("node:zlib") as { crc32?: unknown } | undefined;
  return typeof zlib?.crc32 === "function" ? (zlib.crc32 as ZlibCrc32) : null;
})();

/** The CRC of each byte under the reflected polynomial 0xEDB88320, built on
 *  first use. */
let table: Int32Array | null = null;

/** {@link table}, built if it is not yet. */
function crcTable(): Int32Array {
  if (table === null) {
    table = new Int32Array(256);
    for (let byte = 0; byte < 256; byte++) {
      let crc = byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      table[byte] = crc;
    }
  }
  return table;
}

/**
 * The CRC-32 of `data`, computed here, a byte at a time through a table: what
 * {@link crc32} gives where the runtime has no zlib.
 *
 * @param data - the bytes
 * @param value - the CRC-32 of the bytes before them, which the checksum goes
 *   on from: 0, the default, for none
 * @returns the CRC-32, an unsigned 32-bit integer
 *
 * @example
 * ```ts
 * crc32Pure(new TextEncoder().encode("123456789"));  // 0xcbf43926
 * ```
 */
export function crc32Pure(data: Uint8Array, value = 0): number {
  const crcs = crcTable();
  let crc = ~value;
  for (let i = 0; i < data.length; i++) crc = crcs[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return ~crc >>> 0;
}

/**
 * The CRC-32 of `data`, as a zip names an entry's bytes: Node's zlib computes
 * it where the runtime has one, and {@link crc32Pure} elsewhere — a browser —
 * with the same answer.
 *
 * @param data - the bytes
 * @param value - the CRC-32 of the bytes before them, which the checksum goes
 *   on from: 0, the default, for none
 * @returns the CRC-32, an unsigned 32-bit integer
 *
 * @example
 * ```ts
 * const bytes = new TextEncoder().encode("123456789");
 * crc32(bytes);                                          // 0xcbf43926
 * crc32(bytes.subarray(4), crc32(bytes.subarray(0, 4))); // 0xcbf43926, in two parts
 * ```
 */
export function crc32(data: Uint8Array, value = 0): number {
  return zlibCrc32 === null ? crc32Pure(data, value) : zlibCrc32(data, value);
}
