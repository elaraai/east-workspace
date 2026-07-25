/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 type section.
 *
 * Two encodings, discriminated by a leading kind varint:
 *
 *     varint(0)  structural: the v4 type-table section verbatim
 *                (varint(byte_len) varint(root_idx) varint(count) entries…)
 *     varint(1)  well-known: varint(id) + u64-LE FNV-1a-64 content hash
 *
 * The well-known form names a schema registered identically in every runtime
 * (id 1 = `IRType`, id 2 = `EastTypeValueType`; id 3 is reserved for
 * `UIComponentType`). The hash is computed over the schema's structural
 * section bytes; a decoder verifies the wire hash against the hash of its own
 * registered encoding and fails loudly on drift — the guard exists to catch
 * runtime-version skew, not adversarial input. Encoders only emit the
 * well-known form on an exact byte match of the structural encoding, so a
 * hash collision can never mislabel an encode.
 */

import { toEastTypeValue, EastTypeValueType, type EastTypeValue } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { isVariant } from "../../../containers/variant.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { TypeTableBuilder, writeTypeTableSection, readTypeTableSection } from "../v4/type-table.js";
import { fnv1a64, irTypeValue } from "../shared.js";

export { fnv1a64 } from "../shared.js";

/** Type-section kind: structural (v4 type-table payload follows). */
export const TYPE_SECTION_STRUCTURAL = 0;
/** Type-section kind: well-known id + content hash follows. */
export const TYPE_SECTION_WELL_KNOWN = 1;

// =============================================================================
// Well-known registry
// =============================================================================

interface WellKnownEntry {
  id: number;
  name: string;
  type: EastTypeValue;
  /** Lazily computed structural section bytes + hash. */
  bytes?: Uint8Array;
  hash?: bigint;
}

/** The registered well-known schemas. Ids are pinned in v5/SPEC.md — never
 *  renumber. Id 3 (`UIComponentType`) is reserved for east-ui and not
 *  registered here: emitting it requires every possible reader to know it,
 *  which the core runtimes cannot assume. */
const WELL_KNOWN: WellKnownEntry[] = [
  { id: 1, name: "IRType", type: irTypeValue },
  { id: 2, name: "EastTypeValueType", type: EastTypeValueType },
];

/** Structural section bytes keyed on the type object — the v5 flavour of the
 *  #417 encoder section cache (the section is value-independent in v5). */
const structuralBytesCache = new WeakMap<object, Uint8Array>();

/** Encodes a type's structural section bytes (the v4 type-table section). */
function structuralBytes(type: EastTypeValue | EastType): Uint8Array {
  const cached = structuralBytesCache.get(type as object);
  if (cached) return cached;
  const builder = new TypeTableBuilder();
  const rootIdx = builder.add(type);
  const writer = new BufferWriter();
  writeTypeTableSection(rootIdx, builder.entries, writer);
  const bytes = writer.toUint8Array();
  structuralBytesCache.set(type as object, bytes);
  return bytes;
}

function entryBytes(entry: WellKnownEntry): Uint8Array {
  if (!entry.bytes) {
    entry.bytes = structuralBytes(entry.type);
    entry.hash = fnv1a64(entry.bytes);
  }
  return entry.bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// =============================================================================
// Section write / read
// =============================================================================

/**
 * Writes the v5 type section for a root type.
 *
 * Emits the well-known form when the type's structural encoding matches a
 * registered schema byte-for-byte, otherwise the structural form.
 *
 * @param type - the root type (as `EastType` or `EastTypeValue`)
 * @param writer - the wire-level writer
 */
export function writeTypeSection(type: EastTypeValue | EastType, writer: BufferWriter): void {
  const bytes = structuralBytes(type);
  for (const entry of WELL_KNOWN) {
    if (bytesEqual(bytes, entryBytes(entry))) {
      writer.writeVarint(TYPE_SECTION_WELL_KNOWN);
      writer.writeVarint(entry.id);
      let hash = entry.hash!;
      for (let i = 0; i < 8; i++) {
        writer.writeUint8(Number(hash & 0xffn));
        hash >>= 8n;
      }
      return;
    }
  }
  writer.writeVarint(TYPE_SECTION_STRUCTURAL);
  writer.writeBytes(bytes);
}

/**
 * Reads the v5 type section.
 *
 * @param reader - the wire-level reader positioned at the section start
 * @returns the root type
 * @throws {Error} When a well-known id is not registered in this runtime or
 *   its content hash disagrees with this runtime's registered schema.
 */
export function readTypeSection(reader: BufferReader): { rootType: EastTypeValue } {
  const kind = reader.readVarint();
  if (kind === TYPE_SECTION_STRUCTURAL) {
    const { rootType } = readTypeTableSection(reader);
    return { rootType };
  }
  if (kind !== TYPE_SECTION_WELL_KNOWN) {
    throw new Error(`beast2 v5: unknown type section kind ${kind}`);
  }
  const id = reader.readVarint();
  let hash = 0n;
  for (let i = 0; i < 8; i++) {
    hash |= BigInt(reader.readUint8()) << BigInt(8 * i);
  }
  const entry = WELL_KNOWN.find(e => e.id === id);
  if (!entry) {
    throw new Error(`beast2 v5: well-known type id ${id} is not registered in this runtime (encoder/decoder version drift?)`);
  }
  entryBytes(entry);
  if (entry.hash !== hash) {
    throw new Error(
      `beast2 v5: well-known type ${id} (${entry.name}) hash mismatch — blob 0x${hash.toString(16)}, ` +
      `this runtime 0x${entry.hash!.toString(16)}. The encoding and decoding runtimes disagree on the ` +
      `${entry.name} schema; re-encode with a structural type section or align runtime versions.`
    );
  }
  return { rootType: entry.type };
}

/**
 * Normalizes an `EastType | EastTypeValue` to `EastTypeValue`.
 *
 * @param type - the type in either representation
 * @returns the `EastTypeValue` form
 */
export function asTypeValue(type: EastType | EastTypeValue): EastTypeValue {
  return isVariant(type) ? type as EastTypeValue : toEastTypeValue(type as EastType);
}
