/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 flat type table — encoder and decoder.
 *
 * The type table is a flat array in which each distinct type is one entry,
 * referenced by varint index; tag bytes double as indices into the decoder's
 * dispatch table. The v4 container writes it as its first section and the v5
 * container reuses it verbatim as the structural type section.
 *
 * **The table is canonical** (#770): a pure function of the type, so the same
 * type writes the same bytes in every runtime (east-c's `type_table.c` applies
 * the same rules, and east-py encodes through it) and whether the type was
 * built in code or read back off the wire. e3 content-addresses beast2 bytes,
 * so anything less puts one value under several hashes. The rules, as
 * {@link TypeTableBuilder} applies them:
 *
 * - Entries are committed in a post-order walk over the type in declaration
 *   order: Struct fields as declared, Variant cases as sorted, Function inputs
 *   then output, Dict key then value. A child therefore sits at a lower index
 *   than its parent, which the decoders rely on.
 * - A Recursive wrapper takes its index before its body is walked, so the
 *   body's self-references name that index.
 * - An entry whose bytes (tag + parameters) are already in the table is not
 *   written again. Two occurrences of one type — inside or outside a
 *   recursive wrapper's body, as an `EastType` or as an `EastTypeValue`, as
 *   one object or as many — are one entry.
 * - Two Recursive wrappers are one entry when {@link isTypeValueEqual} says
 *   so. A wrapper's id is a runtime artefact (a type id in one process, a
 *   table index off the wire) and is not written, so wrappers compare up to
 *   their naming.
 *
 * Nothing here constructs an `EastType`. Type ids are serialized into IR, so
 * an encode must not shift the ids of the types built after it.
 *
 * See v4/SPEC.md for the entry grammar and v5/SPEC.md for the type section.
 */

import { toEastTypeValue, isTypeValueEqual, type EastTypeValue } from "../../../type_of_type.js";
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

/** A Recursive wrapper whose body is being walked. */
interface OpenWrapper {
  id: bigint;
  idx: number;
}

/** A Recursive wrapper whose entry is complete. */
interface CommittedWrapper {
  etv: EastTypeValue;
  idx: number;
}

type RecursivePayload = variant<"ref", bigint> | variant<"wrapper", { id: bigint; inner: EastTypeValue }>;

/**
 * Builds the canonical flat type table of one or more types (see the module
 * comment for the rules). Accepts `EastType` (converted with
 * {@link toEastTypeValue}, which allocates no type) and `EastTypeValue`.
 *
 * Usage:
 *   const builder = new TypeTableBuilder();
 *   const rootIdx = builder.add(myType);           // EastType or EastTypeValue
 *   builder.add(someIRTypeAnnotation);              // a later type shares entries
 *   writeTypeTableSection(rootIdx, builder.entries, writer);
 */
export class TypeTableBuilder {
  readonly entries: TableEntry[] = [];
  /** Entry bytes (tag + parameters) → index: the same bytes are the same wire node. */
  private readonly byContent = new Map<string, number>();
  /** Type object (EastType or EastTypeValue) → index: a memo over the walk. */
  private readonly byObject = new Map<object, number>();
  /** type_id → index, for the values `toEastTypeValue` stamps. */
  private readonly byTid = new Map<number, number>();
  /** Recursive wrapper id → the wrapper's index, for every wrapper added. */
  private readonly byWrapperId = new Map<bigint, number>();
  /** Committed wrappers, deduplicated structurally. */
  private readonly wrappers: CommittedWrapper[] = [];
  /** Wrappers whose bodies are being walked, innermost last. */
  private readonly open: OpenWrapper[] = [];

  /** Create a copy with the same entries and lookups (the v4 encoder extends a
   *  cached root closure per value). */
  clone(): TypeTableBuilder {
    const c = new TypeTableBuilder();
    for (const e of this.entries) c.entries.push(e);
    for (const [k, v] of this.byContent) c.byContent.set(k, v);
    for (const [k, v] of this.byObject) c.byObject.set(k, v);
    for (const [k, v] of this.byTid) c.byTid.set(k, v);
    for (const [k, v] of this.byWrapperId) c.byWrapperId.set(k, v);
    for (const w of this.wrappers) c.wrappers.push(w);
    for (const w of this.open) c.open.push(w);
    return c;
  }

  /** Add a type and return its index; a type already in the table returns its
   *  existing index and writes nothing. Accepts both EastType and EastTypeValue. */
  add(type: EastType | EastTypeValue): number {
    const memo = this.byObject.get(type as object);
    if (memo !== undefined) return memo;
    const etv = isVariant(type) ? type as EastTypeValue : toEastTypeValue(type as EastType);
    const idx = this.visit(etv);
    this.byObject.set(type as object, idx);
    return idx;
  }

  /** Add an EastTypeValue (for IR type annotations). */
  addETV(etv: EastTypeValue): number {
    return this.add(etv);
  }

  /** Look up a type's index without adding it: by object, by type_id, or — for
   *  a Recursive ref or wrapper — by the wrapper's id. */
  indexOf(etv: EastTypeValue): number {
    const idx = this.lookup(etv);
    if (idx === undefined) throw new Error(`Type not in table: ${etv.type}`);
    return idx;
  }

  /** Whether {@link indexOf} would find the type. `add` is idempotent, so a
   *  miss here is never a reason not to add. */
  has(etv: EastTypeValue): boolean {
    return this.lookup(etv) !== undefined;
  }

  private lookup(etv: EastTypeValue): number | undefined {
    const memo = this.byObject.get(etv);
    if (memo !== undefined) return memo;
    const tid = getTypeId(etv);
    if (tid !== undefined) {
      const known = this.byTid.get(tid);
      if (known !== undefined) return known;
    }
    if (etv.type === "Recursive") {
      const id = recursiveId(etv.value as RecursivePayload);
      return this.openWrapper(id) ?? this.byWrapperId.get(id);
    }
    return undefined;
  }

  // ── The walk ────────────────────────────────────────────────────────

  private visit(etv: EastTypeValue): number {
    const memo = this.byObject.get(etv);
    if (memo !== undefined) return memo;
    const tid = getTypeId(etv);
    if (tid !== undefined) {
      const known = this.byTid.get(tid);
      if (known !== undefined) {
        this.byObject.set(etv, known);
        return known;
      }
    }
    const idx = this.visitNode(etv);
    this.byObject.set(etv, idx);
    if (tid !== undefined) this.byTid.set(tid, idx);
    return idx;
  }

  /** Commit the entry of a node after its children (post-order). */
  private visitNode(etv: EastTypeValue): number {
    switch (etv.type) {
      case "Never": case "Null": case "Boolean": case "Integer":
      case "Float": case "String": case "DateTime": case "Blob":
        return this.commit(TAG_FOR_TYPE[etv.type]!, EMPTY);

      case "Array": case "Set": case "Ref": case "Vector": case "Matrix":
        return this.commit(TAG_FOR_TYPE[etv.type]!, varint(this.visit(etv.value as EastTypeValue)));

      case "Dict": {
        const ki = this.visit(etv.value.key as EastTypeValue);
        const vi = this.visit(etv.value.value as EastTypeValue);
        return this.commit(TAG_DICT, varints(ki, vi));
      }

      case "Struct": case "Variant": {
        const members = etv.value as { name: string; type: EastTypeValue }[];
        const indices = members.map(m => this.visit(m.type));
        const w = new BufferWriter();
        w.writeVarint(members.length);
        for (let i = 0; i < members.length; i++) {
          w.writeStringUtf8Varint(members[i]!.name);
          w.writeVarint(indices[i]!);
        }
        return this.commit(TAG_FOR_TYPE[etv.type]!, w.toUint8Array());
      }

      case "Function": case "AsyncFunction": {
        const inputs = (etv.value.inputs as EastTypeValue[]).map(i => this.visit(i));
        const output = this.visit(etv.value.output as EastTypeValue);
        const w = new BufferWriter();
        w.writeVarint(inputs.length);
        for (const ii of inputs) w.writeVarint(ii);
        w.writeVarint(output);
        return this.commit(TAG_FOR_TYPE[etv.type]!, w.toUint8Array());
      }

      case "Recursive":
        return this.visitRecursive(etv.value as RecursivePayload, etv);

      default:
        throw new Error(`Unknown EastTypeValue case: ${(etv as any).type}`);
    }
  }

  private visitRecursive(payload: RecursivePayload, etv: EastTypeValue): number {
    const id = recursiveId(payload);
    // A self-reference — a ref, or the wrapper spelled out again inside its
    // own body — names the wrapper being walked.
    const open = this.openWrapper(id);
    if (open !== undefined) return open;
    if (payload.type === "ref") {
      // A ref outside its wrapper's body stands for the whole recursive type.
      const committed = this.byWrapperId.get(id);
      if (committed !== undefined) return committed;
      throw new Error(`beast2 type table: Recursive ref(${id}) is bound by no wrapper`);
    }
    // The wrapper's entry exists only once its body does, so a repeat is found
    // by comparing types, not bytes — up to the naming of wrappers.
    for (const w of this.wrappers) {
      if (isTypeValueEqual(w.etv, etv)) return w.idx;
    }
    // Take the index before the body so its self-references resolve.
    const idx = this.entries.length;
    this.entries.push(null!);
    this.open.push({ id, idx });
    let innerIdx: number;
    try {
      innerIdx = this.visit(payload.value.inner);
    } finally {
      this.open.pop();
    }
    this.entries[idx] = { tag: TAG_RECURSIVE, params: varint(innerIdx) };
    this.wrappers.push({ etv, idx });
    this.byWrapperId.set(id, idx);
    return idx;
  }

  private openWrapper(id: bigint): number | undefined {
    for (let i = this.open.length - 1; i >= 0; i--) {
      if (this.open[i]!.id === id) return this.open[i]!.idx;
    }
    return undefined;
  }

  /** Append an entry unless the same bytes are already in the table. */
  private commit(tag: number, params: Uint8Array): number {
    const key = contentKey(tag, params);
    const existing = this.byContent.get(key);
    if (existing !== undefined) return existing;
    const idx = this.entries.length;
    this.entries.push({ tag, params });
    this.byContent.set(key, idx);
    return idx;
  }
}

const EMPTY = new Uint8Array(0);

/** The id a `Recursive` payload names — the wrapper's own id, or a ref's. */
function recursiveId(payload: RecursivePayload): bigint {
  return payload.type === "ref" ? payload.value : payload.value.id;
}

/** The entry's bytes as a map key (one code unit per byte). */
function contentKey(tag: number, params: Uint8Array): string {
  let key = String.fromCharCode(tag);
  for (let i = 0; i < params.length; i++) key += String.fromCharCode(params[i]!);
  return key;
}

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
    const tag = reader.readUint8();
    const parse = ENTRY_PARSERS[tag];
    if (!parse) throw new Error(`Type table entry ${i} has unknown tag 0x${tag.toString(16)}`);
    parsed[i] = parse(reader);
    // Every child index names an entry of this table.
    for (const child of parsed[i]!.childIndices) {
      if (child >= entryCount) throw new Error(`Type table entry ${i} references entry ${child} of ${entryCount}`);
    }
  }

  if (reader.offset !== payload.length) {
    throw new Error(`Type table size mismatch: expected offset ${payload.length}, got ${reader.offset}`);
  }
  if (rootIdx >= entryCount) {
    throw new Error(`Type table root index ${rootIdx} out of range (${entryCount} entries)`);
  }

  // Phase 2: Reconstruct EastTypeValue tree with Recursive wrapper/ref references
  const table = reconstructTypes(parsed);

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

// ── Reconstruction: flat table → EastTypeValue with wrapper/ref recursion ──

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

/** A type built inside a wrapper's body, with the shallowest open wrapper
 *  (a stack position) its `ref`s reach. */
interface OpenBuild {
  value: EastTypeValue;
  minRef: number;
}

/**
 * Reconstruct EastTypeValue objects from parsed flat table entries.
 *
 * A Recursive entry becomes `wrapper({id, inner})` whose id is its table
 * index; inside its body a reference back to it is `ref(id)`. The returned
 * table holds every entry's **closed** form — built in no wrapper's scope, so
 * it is a complete type wherever it is used (v4 value-table entries name
 * element types by index).
 *
 * The same entry can be reached from inside a wrapper's body and from outside
 * it — a canonical table writes `Array<T>` once whether it occurs as `T`'s
 * child or as another field's type — and the two readings are different
 * objects: inside, references to `T` are `ref`s; outside, they are the
 * wrapper. So an object built under a wrapper (one that holds a `ref` to it)
 * is memoized only for that wrapper's scope, and an object that references no
 * open wrapper is closed and memoized for good. One table index yields one
 * closed object, shared by every reference to it, so a decoded type is a
 * canonical input to {@link TypeTableBuilder} in turn.
 */
function reconstructTypes(parsed: ParsedEntry[]): EastTypeValue[] {
  const closed = new Array<EastTypeValue | undefined>(parsed.length);
  // Open wrapper indices, outermost first; `scopes[i]` memoizes what was
  // built under `stack[i]` and reaches an open wrapper.
  const stack: number[] = [];
  const scopes: Map<number, OpenBuild>[] = [];
  // Non-wrapper entries under construction: a cycle through them has no
  // wrapper to close it and is malformed.
  const building = new Set<number>();
  // Shallowest stack position referenced by the subtree under construction
  // (Infinity = nothing referenced).
  let minRef = Infinity;

  function build(idx: number): EastTypeValue {
    const pos = stack.indexOf(idx);
    if (pos !== -1) {
      if (pos < minRef) minRef = pos;
      return variant("Recursive", variant("ref", BigInt(idx))) as EastTypeValue;
    }
    const done = closed[idx];
    if (done !== undefined) return done;
    if (scopes.length > 0) {
      const scoped = scopes[scopes.length - 1]!.get(idx);
      if (scoped !== undefined) {
        if (scoped.minRef < minRef) minRef = scoped.minRef;
        return scoped.value;
      }
    }

    const entry = parsed[idx]!;
    if (entry.tag <= TAG_NEVER) {
      const primitive = PRIMITIVE_ETV[entry.tag]!;
      closed[idx] = primitive;
      return primitive;
    }

    const depth = stack.length;
    const outerMinRef = minRef;
    minRef = Infinity;
    let result: EastTypeValue;
    if (entry.tag === TAG_RECURSIVE) {
      stack.push(idx);
      scopes.push(new Map());
      let inner: EastTypeValue;
      try {
        inner = build(entry.childIndices[0]!);
      } finally {
        stack.pop();
        scopes.pop();
      }
      result = variant("Recursive", variant("wrapper", { id: BigInt(idx), inner })) as unknown as EastTypeValue;
    } else {
      if (building.has(idx)) {
        throw new Error(`Type table entry ${idx} refers to itself without a Recursive wrapper`);
      }
      building.add(idx);
      try {
        result = buildCompound(entry);
      } finally {
        building.delete(idx);
      }
    }
    const mine = minRef;
    // Closed ⇔ nothing under this entry referenced a wrapper open above it
    // (a wrapper's own self-references sit at `depth`, so it stays closed).
    if (mine >= depth) {
      closed[idx] = result;
    } else {
      scopes[scopes.length - 1]!.set(idx, { value: result, minRef: mine });
    }
    minRef = Math.min(outerMinRef, mine);
    return result;
  }

  function buildCompound(entry: ParsedEntry): EastTypeValue {
    switch (entry.tag) {
      case TAG_VARIANT:
      case TAG_STRUCT: {
        const members = entry.names!.map((name, i) => ({ name, type: build(entry.childIndices[i]!) }));
        return variant(TAG_TO_CASE[entry.tag]!, members) as EastTypeValue;
      }
      case TAG_ARRAY:
      case TAG_SET:
      case TAG_REF:
      case TAG_VECTOR:
      case TAG_MATRIX:
        return variant(TAG_TO_CASE[entry.tag]!, build(entry.childIndices[0]!)) as EastTypeValue;
      case TAG_DICT: {
        const key = build(entry.childIndices[0]!);
        const value = build(entry.childIndices[1]!);
        return variant("Dict", { key, value }) as EastTypeValue;
      }
      case TAG_FUNCTION:
      case TAG_ASYNC_FUNCTION: {
        const n = entry.childIndices.length - 1;
        const inputs: EastTypeValue[] = [];
        for (let i = 0; i < n; i++) inputs.push(build(entry.childIndices[i]!));
        const output = build(entry.childIndices[n]!);
        return variant(TAG_TO_CASE[entry.tag]!, { inputs, output }) as EastTypeValue;
      }
      default:
        throw new Error(`Unexpected compound tag 0x${entry.tag.toString(16)}`);
    }
  }

  // Build ALL entries (not just root-reachable) in their closed form. Extra
  // entries from IR capture types are needed for function IR type restoration
  // during v4 decode.
  for (let i = 0; i < parsed.length; i++) {
    if (closed[i] === undefined) build(i);
  }

  return closed as EastTypeValue[];
}
