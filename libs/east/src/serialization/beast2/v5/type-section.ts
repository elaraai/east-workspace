/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 type section.
 *
 * Three encodings, discriminated by a leading kind varint:
 *
 *     varint(0)  structural: the v4 type-table section verbatim
 *                (varint(byte_len) varint(root_idx) varint(count) entries…)
 *     varint(1)  well-known compact: varint(id) + u64-LE FNV-1a-64 hash
 *     varint(2)  well-known + fallback: varint(id) + hash + structural bytes
 *
 * A well-known id names a schema by reference so decoders skip parsing it
 * entirely.
 *
 * **The registry is part of the wire format, not a runtime extension point.**
 * The id set is fixed here and mirrored verbatim in east-c and east-py, and
 * adding to it is a format change requiring all three runtimes to ship
 * together. It is deliberately NOT open to downstream packages: if a package
 * could register an id, the same value would encode to different bytes
 * depending on which packages a process happened to import, and e3
 * content-addresses beast2 bytes — the same logical value would land under
 * two different hashes, splitting caches and duplicating objects. Encodes
 * must be a pure function of (value, type, options), so the registry has to
 * be a constant of the format.
 *
 * Both current ids are therefore `universal`: every runtime has them by
 * construction, so they use the compact kind-1 form with no fallback.
 *
 * Kind 2 (id + hash + structural fallback) is **decode-only** here: nothing
 * in this release emits it. It exists so a later release can add ids without
 * breaking decoders shipped now — those decoders fall back to the structural
 * bytes instead of failing on an id they've never heard of.
 */

import { toEastTypeValue, EastTypeValueType, type EastTypeValue } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { isVariant } from "../../../containers/variant.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { TypeTableBuilder, writeTypeTableSection, readTypeTableSection, skipTypeTableSection } from "../v4/type-table.js";
import { fnv1a64, irTypeValue } from "../shared.js";

export { fnv1a64 } from "../shared.js";

/** Type-section kind: structural (v4 type-table payload follows). */
export const TYPE_SECTION_STRUCTURAL = 0;
/** Type-section kind: well-known id + content hash, no fallback. */
export const TYPE_SECTION_WELL_KNOWN = 1;
/** Type-section kind: well-known id + content hash + structural fallback.
 *  Decode-only in this release — see the module comment. */
export const TYPE_SECTION_WELL_KNOWN_FALLBACK = 2;

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

/** The well-known schemas — a constant of the wire format, mirrored verbatim
 *  in east-c (`v5/container.c`) and reachable from east-py through it. Ids
 *  are pinned in v5/SPEC.md; never renumber, and never add one without
 *  shipping all three runtimes together. */
const WELL_KNOWN: readonly WellKnownEntry[] = [
  { id: 1, name: "IRType", type: irTypeValue },
  { id: 2, name: "EastTypeValueType", type: EastTypeValueType },
];

/** Encode-side index: structural-bytes hash → entry (O(1) recognition).
 *  Built lazily on first use so module init stays cheap. */
let wellKnownByHash: Map<string, WellKnownEntry> | null = null;

function byHash(): Map<string, WellKnownEntry> {
  if (!wellKnownByHash) {
    wellKnownByHash = new Map();
    for (const entry of WELL_KNOWN) {
      entryBytes(entry);
      wellKnownByHash.set(entry.hash!.toString(16), entry);
    }
  }
  return wellKnownByHash;
}

/** Looks up a well-known entry by id. */
function wellKnownById(id: number): WellKnownEntry | undefined {
  return WELL_KNOWN.find(e => e.id === id);
}

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
 * The encoder recognizes a well-known schema **by content**, not by identity:
 * it encodes the root type's structural section bytes and looks for a
 * registered schema with the same hash (then verifies the bytes). So a
 * library never tells beast2 "use id 3 for this encode" — it registers the
 * schema once at module load, and any encode of a structurally identical type
 * is named by reference automatically. Resolution is memoized per type object,
 * so this costs one WeakMap hit per encode after the first.
 *
 * @param type - the root type (as `EastType` or `EastTypeValue`)
 * @param writer - the wire-level writer
 */
export function writeTypeSection(type: EastTypeValue | EastType, writer: BufferWriter): void {
  const bytes = structuralBytes(type);
  const entry = resolveWellKnown(type as object, bytes);
  if (!entry) {
    writer.writeVarint(TYPE_SECTION_STRUCTURAL);
    writer.writeBytes(bytes);
    return;
  }
  // Both current ids are universal (every runtime has them), so the compact
  // form is always correct here. Kind 2 is never emitted — see the module
  // comment on why the registry is closed.
  writer.writeVarint(TYPE_SECTION_WELL_KNOWN);
  writer.writeVarint(entry.id);
  let hash = entry.hash!;
  for (let i = 0; i < 8; i++) {
    writer.writeUint8(Number(hash & 0xffn));
    hash >>= 8n;
  }
}

/** Memoized "is this type object well-known?", keyed on the type object. */
const wellKnownForType = new WeakMap<object, WellKnownEntry | null>();

function resolveWellKnown(typeKey: object, bytes: Uint8Array): WellKnownEntry | null {
  const memo = wellKnownForType.get(typeKey);
  if (memo !== undefined) return memo;
  const candidate = byHash().get(fnv1a64(bytes).toString(16));
  // Hash match is not enough — verify the bytes so a collision can never
  // mislabel an encode.
  const entry = candidate && bytesEqual(bytes, entryBytes(candidate)) ? candidate : null;
  wellKnownForType.set(typeKey, entry);
  return entry;
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
  if (kind !== TYPE_SECTION_WELL_KNOWN && kind !== TYPE_SECTION_WELL_KNOWN_FALLBACK) {
    throw new Error(`beast2 v5: unknown type section kind ${kind}`);
  }
  const hasFallback = kind === TYPE_SECTION_WELL_KNOWN_FALLBACK;
  const id = reader.readVarint();
  let hash = 0n;
  for (let i = 0; i < 8; i++) {
    hash |= BigInt(reader.readUint8()) << BigInt(8 * i);
  }

  const entry = wellKnownById(id);
  if (entry) {
    entryBytes(entry);
    if (entry.hash === hash) {
      // The whole point: skip the schema entirely.
      if (hasFallback) skipTypeTableSection(reader);
      return { rootType: entry.type };
    }
    if (!hasFallback) {
      throw new Error(
        `beast2 v5: well-known type ${id} (${entry.name}) hash mismatch — blob 0x${hash.toString(16)}, ` +
        `this runtime 0x${entry.hash!.toString(16)}. The encoding and decoding runtimes disagree on the ` +
        `${entry.name} schema; re-encode with a structural type section or align runtime versions.`
      );
    }
    // Drifted, but the blob carries its own schema — decode it rather than
    // silently substituting this runtime's (different) idea of that id.
  } else if (!hasFallback) {
    throw new Error(
      `beast2 v5: unknown well-known type id ${id} with no structural fallback — the blob was ` +
      `written by a newer runtime whose format registry this one does not have. Upgrade @elaraai/east.`
    );
  }

  const { rootType } = readTypeTableSection(reader);
  return { rootType };
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

