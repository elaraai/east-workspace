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
 * entirely. Two properties make the registry safe to open up to any package
 * (see {@link registerWellKnownType}):
 *
 * - **The hash makes id collisions loud.** It is computed over the schema's
 *   structural section bytes; a decoder compares the wire hash against the
 *   hash of its OWN registered schema for that id and hard-fails on
 *   mismatch. Two packages claiming the same id with different schemas
 *   produce a clear error, never silent schema confusion. Encoders only emit
 *   a well-known form on an exact byte match of the structural encoding, so
 *   a hash collision cannot mislabel an encode either.
 * - **The fallback form makes registration an optimization, not a
 *   requirement.** Kind 2 carries the structural bytes alongside the id, so
 *   a reader that has never heard of the id decodes it exactly as it would a
 *   kind-0 section. Only readers that recognize the id get the parse skip.
 *
 * Core schemas that every runtime is guaranteed to have (id 1 = `IRType`,
 * id 2 = `EastTypeValueType`) register as `universal` and use the compact
 * kind-1 form. Everything registered by a downstream package (id 3 =
 * `UIComponentType`, registered by east-ui) uses kind 2, because a reader
 * without that package must still be able to decode the blob — e3-core, for
 * one, decodes self-describing blobs without importing east-ui.
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
/** Type-section kind: well-known id + content hash + structural fallback. */
export const TYPE_SECTION_WELL_KNOWN_FALLBACK = 2;

// =============================================================================
// Well-known registry
// =============================================================================

interface WellKnownEntry {
  id: number;
  name: string;
  type: EastTypeValue;
  /** Emit the compact (fallback-free) form. Only for schemas every runtime
   *  is guaranteed to have — the two core ones. */
  universal: boolean;
  /** Lazily computed structural section bytes + hash. */
  bytes?: Uint8Array;
  hash?: bigint;
}

/** Registered well-known schemas, by id. Ids are pinned in v5/SPEC.md —
 *  never renumber. Populated by {@link registerWellKnownType}; the two core
 *  schemas below are registered at module load. */
const WELL_KNOWN = new Map<number, WellKnownEntry>();
/** Encode-side index: structural-bytes hash → entry (O(1) recognition). */
const wellKnownByHash = new Map<string, WellKnownEntry>();
/** Bumped on every registration so per-type memos re-resolve. */
let registryGeneration = 0;

/** Highest id reserved for schemas the core runtimes define. Downstream
 *  packages register above this. */
export const WELL_KNOWN_CORE_ID_MAX = 2;

/** Options accepted by {@link registerWellKnownType}. */
export type RegisterWellKnownOptions = {
  /** Human-readable schema name, used in drift diagnostics. */
  name: string;
  /** Emit the compact form (id + hash only, no structural fallback).
   *  Reserved for schemas the core runtimes always have — a blob written
   *  this way is undecodable by a runtime that lacks the id. Defaults to
   *  `false`, which is the right answer for every downstream package. */
  universal?: boolean;
};

/**
 * Registers a schema as beast2 v5 "well-known" under `id`, so encoders name
 * it by reference and decoders that know the id skip parsing it entirely.
 *
 * Registration is an **optimization, never a correctness requirement**: blobs
 * are written with a structural fallback, so a process that has not
 * registered the id still decodes them normally. Registering the same id
 * twice with the same schema is a no-op; registering a *different* schema
 * under a live id throws, and a mismatched id on the wire fails the decode
 * with a hash-mismatch diagnostic rather than silently using the wrong
 * schema.
 *
 * Call this at module load, before any encode or decode. Ids 1–2 are the
 * core runtime's ({@link WELL_KNOWN_CORE_ID_MAX}); downstream packages use
 * ids above that and should record their claim in
 * `libs/east/src/serialization/beast2/v5/SPEC.md`.
 *
 * @param id - the wire id to claim (see the registry table in v5/SPEC.md)
 * @param type - the schema, as an `EastType` or `EastTypeValue`
 * @param options - schema name and the `universal` (compact-form) opt-in
 * @throws {Error} When `id` is already registered to a different schema.
 *
 * @example
 * ```ts
 * // east-ui, at module load:
 * registerWellKnownType(3, UIComponentType, { name: "UIComponentType" });
 * ```
 */
export function registerWellKnownType(
  id: number,
  type: EastTypeValue | EastType,
  options: RegisterWellKnownOptions,
): void {
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`beast2 v5: well-known id must be a positive integer, got ${id}`);
  }
  const typeValue = asTypeValue(type);
  const bytes = structuralBytes(typeValue);
  const hash = fnv1a64(bytes);
  const existing = WELL_KNOWN.get(id);
  if (existing) {
    entryBytes(existing);
    if (existing.hash === hash) return; // idempotent re-registration
    throw new Error(
      `beast2 v5: well-known id ${id} is already registered to ${existing.name} ` +
      `(hash 0x${existing.hash!.toString(16)}); refusing to rebind it to ${options.name} ` +
      `(hash 0x${hash.toString(16)}). Pick an unused id and record it in v5/SPEC.md.`
    );
  }
  const entry: WellKnownEntry = {
    id,
    name: options.name,
    type: typeValue,
    universal: options.universal ?? false,
    bytes,
    hash,
  };
  WELL_KNOWN.set(id, entry);
  wellKnownByHash.set(hash.toString(16), entry);
  registryGeneration++;
}

/** Reports the registered well-known ids (diagnostics and tests). */
export function registeredWellKnownIds(): number[] {
  return [...WELL_KNOWN.keys()].sort((a, b) => a - b);
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
  writer.writeVarint(entry.universal ? TYPE_SECTION_WELL_KNOWN : TYPE_SECTION_WELL_KNOWN_FALLBACK);
  writer.writeVarint(entry.id);
  let hash = entry.hash!;
  for (let i = 0; i < 8; i++) {
    writer.writeUint8(Number(hash & 0xffn));
    hash >>= 8n;
  }
  // Non-universal ids carry the structural bytes so a reader that has never
  // registered the id decodes them exactly as a kind-0 section.
  if (!entry.universal) writer.writeBytes(bytes);
}

/** Memoized "is this type object well-known?" per type object. Invalidated
 *  by `registryGeneration` so a registration after first use still takes. */
const wellKnownForType = new WeakMap<object, { generation: number; entry: WellKnownEntry | null }>();

function resolveWellKnown(typeKey: object, bytes: Uint8Array): WellKnownEntry | null {
  const memo = wellKnownForType.get(typeKey);
  if (memo && memo.generation === registryGeneration) return memo.entry;
  const candidate = wellKnownByHash.get(fnv1a64(bytes).toString(16));
  // Hash match is not enough — verify the bytes so a collision can never
  // mislabel an encode.
  const entry = candidate && bytesEqual(bytes, entryBytes(candidate)) ? candidate : null;
  wellKnownForType.set(typeKey, { generation: registryGeneration, entry });
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

  const entry = WELL_KNOWN.get(id);
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
      `beast2 v5: well-known type id ${id} is not registered in this runtime, and the blob carries ` +
      `no structural fallback. Import the package that registers id ${id} (or re-encode without ` +
      `the universal/compact form).`
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

// Core schemas: present in every runtime by construction, so they take the
// compact form. Downstream registrations (east-ui's UIComponentType) go
// through registerWellKnownType and get the fallback form.
registerWellKnownType(1, irTypeValue, { name: "IRType", universal: true });
registerWellKnownType(2, EastTypeValueType, { name: "EastTypeValueType", universal: true });
