/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { SourceMap, type Location } from "../../../location.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";

/**
 * Write the source_map_section in beast2 v3 bespoke format.
 *
 * Wire format:
 *   varint(section_byte_length)
 *   varint(stack_count)
 *   repeated stack_count times:
 *     varint(frame_count)
 *     repeated frame_count times:
 *       varint(filename_string_idx)
 *       zigzag(line)
 *       zigzag(column)
 *
 * If sourceMap is null, writes an empty section (stack_count = 0).
 * Filenames are added to the provided string table for dedup.
 */
export function writeSourceMapSection(
  sourceMap: SourceMap | null,
  stringTable: Map<string, number>,
  writer: BufferWriter,
): void {
  const hw = new BufferWriter();

  if (!sourceMap || sourceMap.size <= 1n) {
    // Empty or only the sentinel empty stack — write stack_count = 0
    hw.writeVarint(0);
  } else {
    const entries = sourceMap.entries();
    // Skip entry 0 (always the empty stack sentinel) — decoder knows index 0 is []
    hw.writeVarint(entries.length - 1);
    for (let i = 1; i < entries.length; i++) {
      const stack = entries[i]!;
      hw.writeVarint(stack.length);
      for (const frame of stack) {
        // Add filename to string table if not present
        let strIdx = stringTable.get(frame.filename);
        if (strIdx === undefined) {
          strIdx = stringTable.size;
          stringTable.set(frame.filename, strIdx);
        }
        hw.writeVarint(strIdx);
        hw.writeVarint(Number(frame.line));
        hw.writeVarint(Number(frame.column));
      }
    }
  }

  const headerBytes = hw.toUint8Array();
  writer.writeVarint(headerBytes.length);
  writer.writeBytes(headerBytes);
}

/**
 * Read the source_map_section from beast2 v3 bespoke format.
 * Returns a SourceMap populated with the decoded stacks.
 */
export function readSourceMapSection(
  reader: BufferReader,
  stringTable: string[],
): SourceMap {
  const sectionByteLength = reader.readVarint();
  const sectionEnd = reader.offset + sectionByteLength;

  const map = new SourceMap();
  const stackCount = reader.readVarint();

  for (let i = 0; i < stackCount; i++) {
    const frameCount = reader.readVarint();
    const stack: Location[] = new Array(frameCount);
    for (let j = 0; j < frameCount; j++) {
      const filenameIdx = reader.readVarint();
      const line = reader.readVarint();
      const column = reader.readVarint();
      stack[j] = {
        filename: stringTable[filenameIdx] ?? '<unknown>',
        line: BigInt(line),
        column: BigInt(column),
      };
    }
    map.intern_stack(stack);
  }

  if (reader.offset !== sectionEnd) {
    throw new Error(`Source map section size mismatch: expected offset ${sectionEnd}, got ${reader.offset}`);
  }

  return map;
}
