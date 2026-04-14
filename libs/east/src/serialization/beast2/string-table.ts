/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { BufferWriter, BufferReader } from "../binary-utils.js";

/**
 * Write the string table section:
 *   [varint header_byte_length] [varint count] [string entries...]
 * Each string entry: [varint byte_length] [UTF-8 bytes]
 */
export function writeStringTableSection(stringTable: Map<string, number>, writer: BufferWriter): void {
  const hw = new BufferWriter();
  hw.writeVarint(stringTable.size);
  // Write strings in index order (Map preserves insertion order, indices are sequential)
  for (const [str] of stringTable) {
    hw.writeStringUtf8Varint(str);
  }
  const headerBytes = hw.toUint8Array();
  writer.writeVarint(headerBytes.length);
  writer.writeBytes(headerBytes);
}

/**
 * Read the string table section into a string[] array.
 */
export function readStringTableSection(reader: BufferReader): string[] {
  const headerByteLength = reader.readVarint();
  const headerEnd = reader.offset + headerByteLength;
  const count = reader.readVarint();
  const table = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    table[i] = reader.readStringUtf8Varint();
  }
  if (reader.offset !== headerEnd) {
    throw new Error(`String table size mismatch: expected offset ${headerEnd}, got ${reader.offset}`);
  }
  return table;
}
