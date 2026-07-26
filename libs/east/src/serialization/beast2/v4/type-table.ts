/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v2 flat type table encoder and decoder.
 *
 * The type table is a flat array where each unique sub-type is defined once
 * and referenced by varint index. Tag bytes serve as direct array indices
 * into dispatch tables for zero-branch decoding.
 *
 * See devdocs/BEAST2.md for the format specification.
 */

import { toEastTypeValue, type EastTypeValue } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { getTypeId } from "../../../types.js";
import { isVariant, variant } from "../../../containers/variant.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";

// =============================================================================
// Tag bytes (frequency-ordered, used as direct array indices)
// =============================================================================

const TAG_NULL           = 0x00;
const TAG_STRING         = 0x01;
const TAG_INTEGER        = 0x02;
const TAG_FLOAT          = 0x03;
const TAG_BOOLEAN        = 0x04;
const TAG_DATETIME       = 0x05;
const TAG_BLOB           = 0x06;
const TAG_NEVER          = 0x07;
const TAG_VARIANT        = 0x08;
const TAG_STRUCT         = 0x09;
const TAG_ARRAY          = 0x0A;
const TAG_DICT           = 0x0B;
const TAG_SET            = 0x0C;
const TAG_REF            = 0x0D;
const TAG_VECTOR         = 0x0E;
const TAG_MATRIX         = 0x0F;
const TAG_FUNCTION       = 0x10;
const TAG_ASYNC_FUNCTION = 0x11;
const TAG_RECURSIVE      = 0x12;

const TAG_FOR_TYPE: Record<string, number> = {
  Null: TAG_NULL, String: TAG_STRING, Integer: TAG_INTEGER, Float: TAG_FLOAT,
  Boolean: TAG_BOOLEAN, DateTime: TAG_DATETIME, Blob: TAG_BLOB, Never: TAG_NEVER,
  Variant: TAG_VARIANT, Struct: TAG_STRUCT, Array: TAG_ARRAY, Dict: TAG_DICT,
  Set: TAG_SET, Ref: TAG_REF, Vector: TAG_VECTOR, Matrix: TAG_MATRIX,
  Function: TAG_FUNCTION, AsyncFunction: TAG_ASYNC_FUNCTION, Recursive: TAG_RECURSIVE,
};

// =============================================================================
// Encoder
// =============================================================================

interface TableEntry {
  tag: number;
  params: Uint8Array;
}

/**
 * Builds a flat type table from types. Handles both EastType (which has
 * recursive wrappers with .node) and EastTypeValue (which has depth-based
 * Recursive(N) — no inner pointer, so cannot be recursive root).
 *
 * Usage:
 *   const builder = new TypeTableBuilder();
 *   const rootIdx = builder.add(myType);           // EastType or EastTypeValue
 *   builder.addETV(someIRTypeAnnotation);           // EastTypeValue from IR
 *   writeTypeTableSection(rootIdx, builder.entries, writer);
 */
export class TypeTableBuilder {
  readonly entries: TableEntry[] = [];
  /** EastType pointer → table index */
  private readonly etMap = new Map<any, number>();
  /** EastTypeValue object → table index (identity-based) */
  private readonly etvMap = new Map<any, number>();
  /** type_id → table index (for cross-object lookup when identity fails) */
  private readonly tidMap = new Map<number, number>();
  /** Recursive wrapper source ID (bigint) → table index */
  private readonly recIdMap = new Map<bigint, number>();

  /** Get the type_id → index map (for IR type substitution). */
  getIndexMap(): Map<number, number> {
    return this.tidMap;
  }

  /** Create a shallow clone with the same entries and index maps. */
  clone(): TypeTableBuilder {
    const c = new TypeTableBuilder();
    for (const e of this.entries) c.entries.push(e);
    for (const [k, v] of this.etMap) c.etMap.set(k, v);
    for (const [k, v] of this.etvMap) c.etvMap.set(k, v);
    for (const [k, v] of this.tidMap) c.tidMap.set(k, v);
    for (const [k, v] of this.recIdMap) c.recIdMap.set(k, v);
    return c;
  }

  /** Add a type. Accepts both EastType and EastTypeValue. */
  add(type: EastType | EastTypeValue): number {
    if (isVariant(type)) {
      return this.visitETV(type as EastTypeValue);
    }
    return this.visitET(type as EastType);
  }

  /** Add an EastTypeValue (for IR type annotations). */
  addETV(etv: EastTypeValue): number {
    return this.visitETV(etv);
  }

  /** Look up an EastTypeValue's table index by identity, type_id, or recursive ref ID. */
  indexOf(etv: EastTypeValue): number {
    const idx = this.etvMap.get(etv);
    if (idx !== undefined) return idx;
    const tid = getTypeId(etv);
    if (tid !== undefined) {
      const tidIdx = this.tidMap.get(tid);
      if (tidIdx !== undefined) return tidIdx;
    }
    // Recursive ref: look up by the ref's bigint ID
    if ((etv as any).type === "Recursive" && (etv as any).value?.type === "ref") {
      const refId = (etv as any).value.value as bigint;
      const recIdx = this.recIdMap.get(refId);
      if (recIdx !== undefined) return recIdx;
    }
    throw new Error(`Type not in table: ${(etv as any).type}`);
  }

  /** Check if an EastTypeValue is in the table (by identity, type_id, or recursive ref ID). */
  has(etv: EastTypeValue): boolean {
    if (this.etvMap.has(etv)) return true;
    const tid = getTypeId(etv);
    if (tid !== undefined && this.tidMap.has(tid)) return true;
    // Recursive ref: check by bigint ID
    if ((etv as any).type === "Recursive" && (etv as any).value?.type === "ref") {
      return this.recIdMap.has((etv as any).value.value as bigint);
    }
    return false;
  }

  // ── EastType walker (handles Recursive wrappers) ────────────────────

  private visitET(type: EastType): number {
    const existing = this.etMap.get(type);
    if (existing !== undefined) return existing;

    const t = type as any;

    if (t.type === "Recursive") {
      // Allocate index BEFORE recursing — self-references find this index
      const idx = this.allocate();
      this.etMap.set(type, idx);
      // Register type_id so ETV path can find this entry via tidMap
      const recTid = getTypeId(type);
      if (recTid !== undefined) {
        this.tidMap.set(recTid, idx);
        this.recIdMap.set(BigInt(recTid), idx);
      }
      const innerIdx = this.visitET(t.node);
      this.entries[idx] = { tag: TAG_RECURSIVE, params: varint(innerIdx) };
      return idx;
    }

    // Check EastTypeValue identity cache for dedup
    const etv = toEastTypeValue(type);
    const etvIdx = this.etvMap.get(etv);
    if (etvIdx !== undefined) {
      this.etMap.set(type, etvIdx);
      return etvIdx;
    }

    // Primitives
    if (t.type === "Never" || t.type === "Null" || t.type === "Boolean" ||
        t.type === "Integer" || t.type === "Float" || t.type === "String" ||
        t.type === "DateTime" || t.type === "Blob") {
      return this.emitPrimitive(type, etv, t.type);
    }

    // Single-parameter containers
    if (t.type === "Array" || t.type === "Ref") {
      const elemIdx = this.visitET(t.value);
      return this.emit(type, etv, TAG_FOR_TYPE[t.type]!, varint(elemIdx));
    }
    if (t.type === "Set") {
      const elemIdx = this.visitET(t.key);
      return this.emit(type, etv, TAG_SET, varint(elemIdx));
    }
    if (t.type === "Vector" || t.type === "Matrix") {
      const elemIdx = this.visitET(t.element);
      return this.emit(type, etv, TAG_FOR_TYPE[t.type]!, varint(elemIdx));
    }

    if (t.type === "Dict") {
      const ki = this.visitET(t.key);
      const vi = this.visitET(t.value);
      return this.emit(type, etv, TAG_DICT, varints(ki, vi));
    }

    if (t.type === "Struct") {
      return this.emitNamedFields(type, etv, TAG_STRUCT,
        Object.keys(t.fields), (name: string) => this.visitET(t.fields[name]));
    }

    if (t.type === "Variant") {
      return this.emitNamedFields(type, etv, TAG_VARIANT,
        Object.keys(t.cases), (name: string) => this.visitET(t.cases[name]));
    }

    if (t.type === "Function" || t.type === "AsyncFunction") {
      return this.emitFunc(type, etv, t.type,
        t.inputs.map((i: EastType) => this.visitET(i)), this.visitET(t.output));
    }

    throw new Error(`Unknown EastType: ${t.type}`);
  }

  // ── EastTypeValue walker (for lazily-discovered types) ──────────────

  private visitETV(etv: EastTypeValue): number {
    const existing = this.etvMap.get(etv);
    if (existing !== undefined) return existing;
    // Check type_id for cross-path dedup (ET path may have already added this type)
    const etvTid = getTypeId(etv);
    if (etvTid !== undefined) {
      const tidIdx = this.tidMap.get(etvTid);
      if (tidIdx !== undefined) return tidIdx;
    }

    const caseName = etv.type as string;

    if (caseName === "Recursive") {
      const inner = etv.value as any;
      if (inner.type === "wrapper") {
        // Recursive wrapper: allocate first, recurse into inner, fill.
        const idx = this.allocate();
        this.entries[idx] = { tag: TAG_RECURSIVE, params: EMPTY };
        this.registerETV(etv, idx);
        // Register wrapper's bigint ID so refs can find it
        const wrapperId = inner.value.id as bigint;
        this.recIdMap.set(wrapperId, idx);
        const innerIdx = this.visitETV(inner.value.inner as EastTypeValue);
        this.entries[idx] = { tag: TAG_RECURSIVE, params: varint(innerIdx) };
        return idx;
      }
      // Self-reference Recursive(ref) — find existing wrapper by ID or type_id.
      const refId = (etv.value as any).value as bigint;
      const recIdx = this.recIdMap.get(refId);
      if (recIdx !== undefined) return recIdx;
      const tid = getTypeId(etv);
      if (tid !== undefined) {
        const tidIdx = this.tidMap.get(tid);
        if (tidIdx !== undefined) return tidIdx;
      }
      // Scan for wrapper by tag
      for (let i = 0; i < this.entries.length; i++) {
        if (this.entries[i]?.tag === TAG_RECURSIVE) return i;
      }
      throw new Error("Recursive self-reference but no wrapper in table");
    }

    // Primitives
    if (caseName === "Never" || caseName === "Null" || caseName === "Boolean" ||
        caseName === "Integer" || caseName === "Float" || caseName === "String" ||
        caseName === "DateTime" || caseName === "Blob") {
      const idx = this.allocate();
      this.registerETV(etv, idx);
      this.entries[idx] = { tag: TAG_FOR_TYPE[caseName]!, params: EMPTY };
      return idx;
    }

    // Single-parameter containers
    if (caseName === "Array" || caseName === "Set" || caseName === "Ref" ||
        caseName === "Vector" || caseName === "Matrix") {
      const elemIdx = this.visitETV(etv.value as EastTypeValue);
      const idx = this.allocate();
      this.registerETV(etv, idx);
      this.entries[idx] = { tag: TAG_FOR_TYPE[caseName]!, params: varint(elemIdx) };
      return idx;
    }

    if (caseName === "Dict") {
      const ki = this.visitETV(etv.value.key as EastTypeValue);
      const vi = this.visitETV(etv.value.value as EastTypeValue);
      const idx = this.allocate();
      this.registerETV(etv, idx);
      this.entries[idx] = { tag: TAG_DICT, params: varints(ki, vi) };
      return idx;
    }

    if (caseName === "Struct") {
      const fields = etv.value as { name: string; type: EastTypeValue }[];
      const indices = fields.map(f => this.visitETV(f.type));
      const idx = this.emitNamedFieldsETV(etv, TAG_STRUCT, fields.map(f => f.name), indices);
      return idx;
    }

    if (caseName === "Variant") {
      const cases = etv.value as { name: string; type: EastTypeValue }[];
      const indices = cases.map(c => this.visitETV(c.type));
      const idx = this.emitNamedFieldsETV(etv, TAG_VARIANT, cases.map(c => c.name), indices);
      return idx;
    }

    if (caseName === "Function" || caseName === "AsyncFunction") {
      const inputs = etv.value.inputs as EastTypeValue[];
      const inputIndices = inputs.map(i => this.visitETV(i));
      const outputIdx = this.visitETV(etv.value.output as EastTypeValue);
      const idx = this.emitFuncETV(etv, caseName, inputIndices, outputIdx);
      return idx;
    }

    throw new Error(`Unknown EastTypeValue case: ${caseName}`);
  }


  // ── Helpers ─────────────────────────────────────────────────────────

  private allocate(): number {
    const idx = this.entries.length;
    this.entries.push(null!); // placeholder, must be filled
    return idx;
  }

  /** Register an EastTypeValue in both identity and type_id maps. */
  private registerETV(etv: EastTypeValue, idx: number): void {
    this.etvMap.set(etv, idx);
    const tid = getTypeId(etv);
    if (tid !== undefined) this.tidMap.set(tid, idx);
  }

  private emitPrimitive(et: EastType, etv: EastTypeValue, typeName: string): number {
    const idx = this.allocate();
    this.etMap.set(et, idx);
    this.registerETV(etv, idx);
    this.entries[idx] = { tag: TAG_FOR_TYPE[typeName]!, params: EMPTY };
    return idx;
  }

  private emit(et: EastType, etv: EastTypeValue, tag: number, params: Uint8Array): number {
    const idx = this.allocate();
    this.etMap.set(et, idx);
    this.registerETV(etv, idx);
    this.entries[idx] = { tag, params };
    return idx;
  }

  private emitNamedFields(
    et: EastType, etv: EastTypeValue, tag: number,
    names: string[], resolve: (name: string) => number,
  ): number {
    const indices = names.map(resolve);
    const w = new BufferWriter();
    w.writeVarint(names.length);
    for (let i = 0; i < names.length; i++) {
      w.writeStringUtf8Varint(names[i]!);
      w.writeVarint(indices[i]!);
    }
    return this.emit(et, etv, tag, w.toUint8Array());
  }

  private emitNamedFieldsETV(
    etv: EastTypeValue, tag: number, names: string[], indices: number[],
  ): number {
    const w = new BufferWriter();
    w.writeVarint(names.length);
    for (let i = 0; i < names.length; i++) {
      w.writeStringUtf8Varint(names[i]!);
      w.writeVarint(indices[i]!);
    }
    const idx = this.allocate();
    this.registerETV(etv, idx);
    this.entries[idx] = { tag, params: w.toUint8Array() };
    return idx;
  }

  private emitFunc(
    et: EastType, etv: EastTypeValue, typeName: string,
    inputIndices: number[], outputIdx: number,
  ): number {
    const w = new BufferWriter();
    w.writeVarint(inputIndices.length);
    for (const ii of inputIndices) w.writeVarint(ii);
    w.writeVarint(outputIdx);
    return this.emit(et, etv, TAG_FOR_TYPE[typeName]!, w.toUint8Array());
  }

  private emitFuncETV(
    etv: EastTypeValue, caseName: string,
    inputIndices: number[], outputIdx: number,
  ): number {
    const w = new BufferWriter();
    w.writeVarint(inputIndices.length);
    for (const ii of inputIndices) w.writeVarint(ii);
    w.writeVarint(outputIdx);
    const idx = this.allocate();
    this.registerETV(etv, idx);
    this.entries[idx] = { tag: TAG_FOR_TYPE[caseName]!, params: w.toUint8Array() };
    return idx;
  }
}

const EMPTY = new Uint8Array(0);

function varint(value: number): Uint8Array {
  const w = new BufferWriter();
  w.writeVarint(value);
  return w.toUint8Array();
}

function varints(...values: number[]): Uint8Array {
  const w = new BufferWriter();
  for (const v of values) w.writeVarint(v);
  return w.toUint8Array();
}

// =============================================================================
// Type Table Section Writer
// =============================================================================

/**
 * Write the type table section to a BufferWriter:
 *   [varint header_byte_length] [varint root_idx] [varint count] [entries...]
 */
export function writeTypeTableSection(
  rootIdx: number,
  entries: TableEntry[],
  writer: BufferWriter,
): void {
  const hw = new BufferWriter();
  hw.writeVarint(rootIdx);
  hw.writeVarint(entries.length);
  for (const e of entries) {
    hw.writeUint8(e.tag);
    hw.writeBytes(e.params);
  }
  const headerBytes = hw.toUint8Array();
  writer.writeVarint(headerBytes.length);
  writer.writeBytes(headerBytes);
}

// =============================================================================
// Type Table Section Decoder
// =============================================================================

/**
 * Parsed type table entry before reconstruction to EastTypeValue.
 */
interface ParsedEntry {
  tag: number;
  /** For primitives: undefined. For others: parsed parameters. */
  childIndices: number[];
  /** For Struct/Variant: field/case names */
  names?: string[];
}

// ── Section skip-cache (#417) ─────────────────────────────────────────
// Every decode used to re-parse (and re-intern) the blob's whole type-table
// section; for recursive schemas (IRType, EastTypeValueType, UIComponentType)
// that parse dominates small-blob decode time. Sections are content-addressed
// here: same payload bytes ⇒ the same parsed (frozen, shared) table. Keyed on
// the FNV-1a-64 of the payload with a full byte compare on hit, so a corrupted
// section misses and parses/fails exactly as before. Bounded — the distinct
// schema count per process is tiny.

interface CachedTypeSection {
  /** A private copy of the section payload (the decode-time view aliases the
   *  caller's blob and must not be retained). */
  payload: Uint8Array;
  rootType: EastTypeValue;
  typeTable: readonly EastTypeValue[];
}

const TYPE_SECTION_CACHE_MAX = 128;
const typeSectionCache = new Map<number, CachedTypeSection[]>();
let typeSectionCacheCount = 0;

/** Fast FNV-1a-32 for the cache key. Number arithmetic on purpose — the
 *  BigInt FNV-1a-64 used for the v5 well-known wire hash costs more per byte
 *  than the parse this cache skips. Collisions are handled by the full byte
 *  compare below; the hash only needs distribution, not identity. */
function hashSectionPayload(bytes: Uint8Array): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  // Fold the length in so same-hash different-length buckets never mix.
  return (h ^ bytes.length) >>> 0;
}

function payloadEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Read the type table section from a BufferReader.
 * Returns the root EastTypeValue and the full type table for IR restoration.
 *
 * The reader must be positioned after the magic bytes. Parsed sections are
 * cached by content (#417): decoding N blobs of the same schema parses the
 * section once and shares one frozen table.
 */
export function readTypeTableSection(reader: BufferReader): {
  rootType: EastTypeValue;
  typeTable: EastTypeValue[];
} {
  const headerByteLength = reader.readVarint();
  const payload = reader.readBytesView(headerByteLength);

  const key = hashSectionPayload(payload);
  const bucket = typeSectionCache.get(key);
  if (bucket) {
    for (const entry of bucket) {
      if (payloadEqual(entry.payload, payload)) {
        return { rootType: entry.rootType, typeTable: entry.typeTable as EastTypeValue[] };
      }
    }
  }

  const result = parseTypeTableSectionPayload(payload);

  if (typeSectionCacheCount >= TYPE_SECTION_CACHE_MAX) {
    // Evict the oldest hash bucket (Map preserves insertion order).
    const oldest = typeSectionCache.keys().next().value;
    if (oldest !== undefined) {
      typeSectionCacheCount -= typeSectionCache.get(oldest)!.length;
      typeSectionCache.delete(oldest);
    }
  }
  const stored: CachedTypeSection = {
    payload: new Uint8Array(payload),
    rootType: result.rootType,
    typeTable: Object.freeze(result.typeTable),
  };
  const existing = typeSectionCache.get(key);
  if (existing) existing.push(stored);
  else typeSectionCache.set(key, [stored]);
  typeSectionCacheCount++;

  return { rootType: stored.rootType, typeTable: stored.typeTable as EastTypeValue[] };
}

/** Parse a type table section payload (`varint(root_idx) varint(count)
 *  entries…`) — the uncached path behind {@link readTypeTableSection}. */
function parseTypeTableSectionPayload(payload: Uint8Array): {
  rootType: EastTypeValue;
  typeTable: EastTypeValue[];
} {
  const reader = new BufferReader(payload, 0);
  const rootIdx = reader.readVarint();
  const entryCount = reader.readVarint();

  // Phase 1: Parse raw entries
  const parsed = new Array<ParsedEntry>(entryCount);
  for (let i = 0; i < entryCount; i++) {
    parsed[i] = ENTRY_PARSERS[reader.readUint8()]!(reader);
  }

  if (reader.offset !== payload.length) {
    throw new Error(`Type table size mismatch: expected offset ${payload.length}, got ${reader.offset}`);
  }

  // Phase 2: Reconstruct EastTypeValue tree with depth-based Recursive references
  const table = reconstructTypes(parsed, rootIdx);

  return { rootType: table[rootIdx]!, typeTable: table };
}

/**
 * Skip the type table section without decoding.
 */
export function skipTypeTableSection(reader: BufferReader): void {
  reader.skip(reader.readVarint());
}

// ── Entry parsers (fixed-index dispatch table) ────────────────────────

type EntryParser = (reader: BufferReader) => ParsedEntry;

function parsePrimitive(tag: number): EntryParser {
  const entry: ParsedEntry = { tag, childIndices: [] };
  return () => entry;
}

function parseSingleParam(tag: number): EntryParser {
  return (r) => ({ tag, childIndices: [r.readVarint()] });
}

function parseDict(r: BufferReader): ParsedEntry {
  return { tag: TAG_DICT, childIndices: [r.readVarint(), r.readVarint()] };
}

function parseNamedFields(tag: number): EntryParser {
  return (r) => {
    const n = r.readVarint();
    const names: string[] = [];
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      names.push(r.readStringUtf8Varint());
      indices.push(r.readVarint());
    }
    return { tag, childIndices: indices, names };
  };
}

function parseFunc(tag: number): EntryParser {
  return (r) => {
    const n = r.readVarint();
    const indices: number[] = [];
    for (let i = 0; i < n; i++) indices.push(r.readVarint());
    indices.push(r.readVarint()); // output
    return { tag, childIndices: indices };
  };
}

function parseRecursive(r: BufferReader): ParsedEntry {
  return { tag: TAG_RECURSIVE, childIndices: [r.readVarint()] };
}

const ENTRY_PARSERS: EntryParser[] = [
  /* 0x00 */ parsePrimitive(TAG_NULL),
  /* 0x01 */ parsePrimitive(TAG_STRING),
  /* 0x02 */ parsePrimitive(TAG_INTEGER),
  /* 0x03 */ parsePrimitive(TAG_FLOAT),
  /* 0x04 */ parsePrimitive(TAG_BOOLEAN),
  /* 0x05 */ parsePrimitive(TAG_DATETIME),
  /* 0x06 */ parsePrimitive(TAG_BLOB),
  /* 0x07 */ parsePrimitive(TAG_NEVER),
  /* 0x08 */ parseNamedFields(TAG_VARIANT),
  /* 0x09 */ parseNamedFields(TAG_STRUCT),
  /* 0x0A */ parseSingleParam(TAG_ARRAY),
  /* 0x0B */ parseDict,
  /* 0x0C */ parseSingleParam(TAG_SET),
  /* 0x0D */ parseSingleParam(TAG_REF),
  /* 0x0E */ parseSingleParam(TAG_VECTOR),
  /* 0x0F */ parseSingleParam(TAG_MATRIX),
  /* 0x10 */ parseFunc(TAG_FUNCTION),
  /* 0x11 */ parseFunc(TAG_ASYNC_FUNCTION),
  /* 0x12 */ parseRecursive,
];

// ─�� Reconstruction: flat table → EastTypeValue with Recursive(depth) ──

const TAG_TO_CASE: string[] = [
  "Null", "String", "Integer", "Float", "Boolean", "DateTime", "Blob", "Never",
  "Variant", "Struct", "Array", "Dict", "Set", "Ref", "Vector", "Matrix",
  "Function", "AsyncFunction", "Recursive",
];

const PRIMITIVE_ETV: EastTypeValue[] = [
  variant("Null", null) as EastTypeValue,
  variant("String", null) as EastTypeValue,
  variant("Integer", null) as EastTypeValue,
  variant("Float", null) as EastTypeValue,
  variant("Boolean", null) as EastTypeValue,
  variant("DateTime", null) as EastTypeValue,
  variant("Blob", null) as EastTypeValue,
  variant("Never", null) as EastTypeValue,
];

/**
 * Reconstruct EastTypeValue objects from parsed flat table entries.
 *
 * Recursive entries are converted to proper EastTypeValue trees where
 * self-references use depth-based Recursive(N) — compatible with
 * _decodeCursorFor's typeCtx stack mechanism.
 *
 * One table index yields exactly **one** object, shared by every reference to
 * it. That is what makes a decoded type round-trip: {@link TypeTableBuilder}
 * dedups EastTypeValues by identity, so re-encoding a decoded value must see
 * the same object wherever the wire table said "same index". Rebuilding a
 * nested recursive type per reference (as this did before) gave `IRType` 25
 * wrapper entries instead of 2 and made TS re-encode a decoded IR program to
 * 5426 bytes where east-c — which interns decoded types — produced the
 * original 1792.
 */
function reconstructTypes(parsed: ParsedEntry[], _rootIdx: number): EastTypeValue[] {
  const table = new Array<EastTypeValue>(parsed.length);
  // Track which indices are Recursive wrappers and their inner indices
  const recursiveEntries = new Map<number, number>(); // wrapper_idx → inner_idx
  // Wrapper indices whose rebuilt subtree references no *enclosing* wrapper.
  // Such a wrapper is self-contained, so one object can serve every reference
  // to it — see the `closed` computation below.
  const closedWrappers = new Set<number>();
  // Shallowest depthStack position referenced by the subtree currently under
  // construction (Infinity = nothing referenced). Read/reset around each
  // wrapper to decide whether that wrapper escaped its own scope.
  let minRefPos = Infinity;

  // First pass: identify all Recursive entries
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i]!.tag === TAG_RECURSIVE) {
      recursiveEntries.set(i, parsed[i]!.childIndices[0]!);
    }
  }

  // Build each entry. For non-recursive entries, this is straightforward.
  // For the inner types of recursive entries, self-references (indices pointing
  // back to a Recursive wrapper) must be replaced with Recursive(depth).
  //
  // We process bottom-up: entries with lower indices are built first (they
  // have no forward references except through Recursive wrappers).

  // recursionStack tracks which Recursive wrapper indices are "in scope"
  // as we build types, so we can compute depth for Recursive(N) references.

  function build(idx: number, depthStack: number[]): EastTypeValue {
    // If this index is a Recursive wrapper currently being built, emit Recursive(ref(id)).
    // The id is the table index of the wrapper entry.
    const stackPos = depthStack.indexOf(idx);
    if (stackPos !== -1) {
      if (stackPos < minRefPos) minRefPos = stackPos;
      return variant("Recursive", variant("ref", BigInt(idx))) as EastTypeValue;
    }

    // If already built, reuse. A Recursive wrapper only qualifies once it is
    // known to be closed: an *open* wrapper's `ref`s resolve against the scope
    // it was built in, so it cannot be shared with a different scope.
    if (table[idx] !== undefined && (!recursiveEntries.has(idx) || closedWrappers.has(idx))) {
      return table[idx]!;
    }

    const entry = parsed[idx]!;

    // Recursive wrapper: push wrapper index on stack, recurse into inner compound.
    // toEastTypeValue pushes BOTH the RecursiveType wrapper and the inner compound
    // type onto its stack, so we mirror that here for matching depth values.
    if (entry.tag === TAG_RECURSIVE) {
      const innerIdx = entry.childIndices[0]!;
      const base = depthStack.length; // the position this wrapper occupies
      const outerMinRefPos = minRefPos;
      minRefPos = Infinity;
      depthStack.push(idx); // Push wrapper — stays on stack for depth counting
      const inner = buildCompound(innerIdx, depthStack, null);
      depthStack.pop();
      // Closed ⇔ nothing under this wrapper referenced a wrapper above it.
      // East guarantees this for every type it can construct (RecursiveType
      // rejects SCC > 1), so this is the universal case; the check only keeps
      // a hand-crafted mutually-recursive table from sharing a scoped object.
      const closed = minRefPos >= base;
      minRefPos = closed ? outerMinRefPos : Math.min(outerMinRefPos, minRefPos);
      const wrapped = variant("Recursive", variant("wrapper", { id: BigInt(idx), inner })) as unknown as EastTypeValue;
      table[idx] = wrapped;
      if (closed) closedWrappers.add(idx);
      return wrapped;
    }

    // Primitives
    if (entry.tag <= TAG_NEVER) {
      table[idx] = PRIMITIVE_ETV[entry.tag]!;
      return table[idx]!;
    }

    const result = buildCompound(idx, depthStack, null);
    table[idx] = result;
    return result;
  }

  /**
   * Build a compound type entry, pushing to the depth stack.
   * If recursiveOwner is set, self-references to that index (the Recursive
   * wrapper) will be found on the stack at the position where this compound
   * type is pushed.
   */
  function buildCompound(idx: number, depthStack: number[], recursiveOwner: number | null): EastTypeValue {
    const entry = parsed[idx]!;
    // Push: the index that self-references should find.
    // If this compound is the inner type of a Recursive wrapper, push the
    // wrapper's index so Recursive(depth) resolves to it.
    const stackEntry = recursiveOwner ?? idx;
    depthStack.push(stackEntry);

    let result: EastTypeValue;

    switch (entry.tag) {
      case TAG_VARIANT: {
        const cases = entry.names!.map((name, i) => ({
          name, type: build(entry.childIndices[i]!, depthStack),
        }));
        result = variant("Variant", cases) as EastTypeValue;
        break;
      }
      case TAG_STRUCT: {
        const fields = entry.names!.map((name, i) => ({
          name, type: build(entry.childIndices[i]!, depthStack),
        }));
        result = variant("Struct", fields) as EastTypeValue;
        break;
      }
      case TAG_ARRAY:
        result = variant("Array", build(entry.childIndices[0]!, depthStack)) as EastTypeValue;
        break;
      case TAG_DICT:
        result = variant("Dict", {
          key: build(entry.childIndices[0]!, depthStack),
          value: build(entry.childIndices[1]!, depthStack),
        }) as EastTypeValue;
        break;
      case TAG_SET:
        result = variant("Set", build(entry.childIndices[0]!, depthStack)) as EastTypeValue;
        break;
      case TAG_REF:
        result = variant("Ref", build(entry.childIndices[0]!, depthStack)) as EastTypeValue;
        break;
      case TAG_VECTOR:
        result = variant("Vector", build(entry.childIndices[0]!, depthStack)) as EastTypeValue;
        break;
      case TAG_MATRIX:
        result = variant("Matrix", build(entry.childIndices[0]!, depthStack)) as EastTypeValue;
        break;
      case TAG_FUNCTION:
      case TAG_ASYNC_FUNCTION: {
        const n = entry.childIndices.length - 1;
        const inputs = [];
        for (let i = 0; i < n; i++) inputs.push(build(entry.childIndices[i]!, depthStack));
        const output = build(entry.childIndices[n]!, depthStack);
        result = variant(TAG_TO_CASE[entry.tag]!, { inputs, output }) as EastTypeValue;
        break;
      }
      default:
        throw new Error(`Unexpected compound tag 0x${entry.tag.toString(16)}`);
    }

    depthStack.pop();
    return result;
  }

  // Build ALL entries (not just root-reachable). Extra entries from IR
  // capture types are needed for function IR type restoration during decode.
  for (let i = 0; i < parsed.length; i++) {
    if (table[i] === undefined) build(i, []);
  }

  return table;
}
