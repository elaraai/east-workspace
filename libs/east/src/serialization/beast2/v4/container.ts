/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v4 container codec — the globally-sectioned format.
 *
 * File layout: magic(8) + type_table_section + string_table_section +
 * source_map_section + value_table_section + value_stream.
 * Type table: flat array of unique types, referenced by varint index.
 * String table: flat array of unique strings, referenced by varint index.
 * Value stream: type-driven positional encoding, no inline type tags.
 * Functions: IR encoded directly — EastTypeType values are regular variants.
 *
 * See v4/SPEC.md for the wire specification. Version-agnostic entry points
 * (magic dispatch across v4/v5) live in `../index.ts`.
 */

import { toEastTypeValue, type EastTypeValue } from "../../../type_of_type.js";
import type { EastType, ValueTypeOf } from "../../../types.js";
import { isVariant, variant } from "../../../containers/variant.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { ref } from "../../../containers/ref.js";
import { matrix } from "../../../containers/matrix.js";
import { EAST_IR_SYMBOL, EAST_CAPTURES_SYMBOL, EAST_SOURCE_MAP_SYMBOL, type RuntimeContext } from "../../../compile.js";
import { InternalError } from "../../../error.js";
import type { FunctionIR, AsyncFunctionIR } from "../../../ir.js";
import { TypeTableBuilder, writeTypeTableSection, readTypeTableSection } from "./type-table.js";
import { writeStringTableSection, readStringTableSection } from "./string-table.js";
import { writeSourceMapSection, readSourceMapSection } from "./sourcemap-table.js";
import type { SourceMap } from "../../../location.js";
import { buildValueTable, buildIndexMap, isMutableType, type ValueTableEntry, TAG_ARRAY, TAG_DICT, TAG_SET, TAG_REF } from "./value-table.js";
import { type Beast2DecodeOptions, type PlatformDecodeContext, buildPlatformContext, describeNoIrValue, finishDecodedFunction, irTypeValue } from "../shared.js";

// v4: EastTypeType values are encoded as regular variants (no special type-table-index encoding).
// This ensures uniform encoding across value stream and value table, and simplifies multi-runtime implementations.

// =============================================================================
// Magic bytes (v4: last byte = 0x04)
// =============================================================================

export const MAGIC_BYTES = new Uint8Array([0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x04]);

function verifyMagic(data: Uint8Array): void {
  if (data.length < 8) {
    throw new Error(`Data too short for Beast2 format: ${data.length} bytes`);
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== MAGIC_BYTES[i]) {
      if (i < 7) throw new Error(`Invalid Beast2 magic at offset ${i}: expected 0x${MAGIC_BYTES[i]!.toString(16)}, got 0x${data[i]!.toString(16)}`);
      throw new Error(`Unknown Beast2 version: 0x${data[i]!.toString(16)}`);
    }
  }
}

// =============================================================================
// Internal context types
// =============================================================================

type ValueEncoder = (value: any, writer: BufferWriter, ctx: EncodeContext) => void;
type ValueDecoder = (reader: BufferReader, ctx: DecodeContext) => any;

interface EncodeContext {
  indexMap: Map<any, number>;  // identity map: mutable value → table index
  typeTable: TypeTableBuilder;
  stringTable: Map<string, number>;
}

interface DecodeContext extends PlatformDecodeContext {
  mutableValues: any[];  // decoded mutable containers by index
  typeTable: EastTypeValue[];
  stringTable: string[];
  sourceMap: SourceMap | null;
}

// =============================================================================
// Value encoder factory
// =============================================================================

/**
 * Build a value encoder closure tree for the given type.
 * The tree is built once and reused for every encode call.
 */
function buildEncoder(type: EastTypeValue, typeCtx: Map<bigint, ValueEncoder> = new Map()): ValueEncoder {
  switch (type.type) {
    case "Never":
      return () => { throw new Error("Cannot encode value of type Never"); };

    case "Null":
      return () => {};

    case "Boolean":
      return (value, writer) => writer.writeUint8(value ? 1 : 0);

    case "Integer":
      return (value, writer) => writer.writeZigzag(value);

    case "Float":
      return (value, writer) => writer.writeFloat64LE(value);

    case "String":
      return (value: string, writer: BufferWriter, ctx: EncodeContext) => {
        let idx = ctx.stringTable.get(value);
        if (idx === undefined) {
          idx = ctx.stringTable.size;
          ctx.stringTable.set(value, idx);
        }
        writer.writeVarint(idx);
      };

    case "DateTime":
      return (value, writer) => writer.writeZigzag(BigInt(value.valueOf()));

    case "Blob":
      return (value, writer) => {
        writer.writeVarint(value.length);
        writer.writeBytes(value);
      };

    case "Ref":
    case "Array":
    case "Set":
    case "Dict": {
      // v4: all mutable containers are in the value table, encoded as varint(index)
      return (value, writer, ctx) => {
        const idx = ctx.indexMap.get(value);
        if (idx === undefined) throw new InternalError(`Mutable ${type.type} not found in value table during encode`);
        writer.writeVarint(idx);
      };
    }

    case "Struct": {
      const fieldEncoders: [string, ValueEncoder][] = [];
      const ret: ValueEncoder = (value, writer, ctx) => {
        for (const [name, enc] of fieldEncoders) enc(value[name], writer, ctx);
      };

      for (const { name, type: fieldType } of type.value) {
        fieldEncoders.push([name, buildEncoder(fieldType, typeCtx)]);
      }

      return ret;
    }

    case "Variant": {
      const caseEncoders: Record<string, ValueEncoder> = {};
      const caseTags: Record<string, number> = {};
      const ret: ValueEncoder = (value, writer, ctx) => {
        writer.writeVarint(caseTags[value.type]!);
        caseEncoders[value.type]!(value.value, writer, ctx);
      };

      for (let i = 0; i < type.value.length; i++) {
        const { name, type: caseType } = type.value[i]!;
        caseTags[name] = i;
        caseEncoders[name] = buildEncoder(caseType, typeCtx);
      }

      return ret;
    }

    case "Recursive": {
      if ((type.value as any).type === "wrapper") {
        let inner: ValueEncoder;
        const ret: ValueEncoder = (value, writer, ctx) => inner(value, writer, ctx);
        typeCtx.set((type.value as any).value.id as bigint, ret);
        inner = buildEncoder((type.value as any).value.inner, typeCtx);
        return ret;
      }
      const target = typeCtx.get((type.value as any).value as bigint);
      if (!target) throw new InternalError("Recursive type context not found during encoder build");
      return target;
    }

    case "Function":
    case "AsyncFunction": {
      // Build IR encoder in the same typeCtx so recursive types resolve correctly
      const fnIrEncoder = buildEncoder(irTypeValue, typeCtx);
      const captureEncoderCache = new Map<EastTypeValue, ValueEncoder>();

      return (value: any, writer: BufferWriter, ctx: EncodeContext) => {
        const ir = value[EAST_IR_SYMBOL] as FunctionIR | AsyncFunctionIR | undefined;
        if (!ir) throw new Error(`Cannot serialize function: no IR attached (${describeNoIrValue(value)})`);

        fnIrEncoder(ir, writer, ctx);

        const captures = value[EAST_CAPTURES_SYMBOL] as RuntimeContext | undefined;
        const captureList = ir.value.captures;
        writer.writeVarint(captureList.length);

        for (const captureVar of captureList) {
          const name = captureVar.value.name;
          const captureType = captureVar.value.type as EastTypeValue;

          if (!captures) throw new InternalError("Function has captures but no EAST_CAPTURES_SYMBOL");
          const entry = captures[name];
          if (!entry) throw new InternalError(`Capture '${name}' not found`);

          let enc = captureEncoderCache.get(captureType);
          if (!enc) {
            enc = buildEncoder(captureType, typeCtx);
            captureEncoderCache.set(captureType, enc);
          }
          enc(entry.value, writer, ctx);
        }
      };
    }

    case "Vector":
      return (value, writer) => {
        writer.writeVarint(value.length);
        writer.writeBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      };

    case "Matrix":
      return (value, writer) => {
        writer.writeVarint(value.rows);
        writer.writeVarint(value.cols);
        writer.writeBytes(new Uint8Array(value.data.buffer, value.data.byteOffset, value.data.byteLength));
      };

    default:
      throw new Error(`Unknown type: ${(type as any).type}`);
  }
}

// =============================================================================
// Value decoder factory
// =============================================================================

/**
 * Build a value decoder closure tree for the given type.
 * The tree is built once and reused for every decode call.
 */
function buildDecoder(type: EastTypeValue, typeCtx: Map<bigint, ValueDecoder> = new Map()): ValueDecoder {
  switch (type.type) {
    case "Never":
      return () => { throw new Error("Cannot decode value of type Never"); };

    case "Null":
      return () => null;

    case "Boolean":
      return (reader) => reader.readBoolean();

    case "Integer":
      return (reader) => reader.readZigzag();

    case "Float":
      return (reader) => reader.readFloat64LE();

    case "String":
      return (reader: BufferReader, ctx: DecodeContext) => {
        const idx = reader.readVarint();
        if (idx >= ctx.stringTable.length) throw new Error(`String table index ${idx} out of bounds (table has ${ctx.stringTable.length} entries)`);
        return ctx.stringTable[idx]!;
      };

    case "DateTime":
      return (reader) => new Date(Number(reader.readZigzag()));

    case "Blob":
      return (reader) => reader.readBytes(reader.readVarint());

    case "Ref":
    case "Array":
    case "Set":
    case "Dict": {
      // v4: mutable containers are read as varint(table_index) — the actual
      // content was decoded from the mutable_value_table_section.
      return (reader, ctx) => {
        const idx = reader.readVarint();
        if (idx >= ctx.mutableValues.length) throw new Error(`Invalid mutable value table index ${idx} (table has ${ctx.mutableValues.length} entries)`);
        return ctx.mutableValues[idx];
      };
    }

    case "Struct": {
      const fields = type.value as { name: string; type: EastTypeValue }[];
      const names: string[] = [];
      const decoders: ValueDecoder[] = [];
      const ret: ValueDecoder = (reader, ctx) => {
        const result: Record<string, any> = {};
        for (let i = 0; i < names.length; i++) result[names[i]!] = decoders[i]!(reader, ctx);
        return result;
      };

      for (const { name, type: fieldType } of fields) {
        names.push(name);
        decoders.push(buildDecoder(fieldType, typeCtx));
      }

      return ret;
    }

    case "Variant": {
      const caseDecoders: [string, ValueDecoder][] = [];
      const ret: ValueDecoder = (reader, ctx) => {
        const tagIndex = reader.readVarint();
        if (tagIndex >= caseDecoders.length) throw new Error(`Invalid variant tag ${tagIndex}`);
        const [caseName, caseDec] = caseDecoders[tagIndex]!;
        return variant(caseName, caseDec(reader, ctx));
      };

      for (const { name, type: caseType } of type.value) {
        caseDecoders.push([name, buildDecoder(caseType, typeCtx)]);
      }

      return ret;
    }

    case "Recursive": {
      if ((type.value as any).type === "wrapper") {
        let inner: ValueDecoder;
        const ret: ValueDecoder = (reader, ctx) => inner(reader, ctx);
        typeCtx.set((type.value as any).value.id as bigint, ret);
        inner = buildDecoder((type.value as any).value.inner, typeCtx);
        return ret;
      }
      const target = typeCtx.get((type.value as any).value as bigint);
      if (!target) throw new InternalError("Recursive type context not found during decoder build");
      return target;
    }

    case "Function":
    case "AsyncFunction": {
      const isAsync = type.type === "AsyncFunction";
      const fnType = type;
      const fnIrDecoder = buildDecoder(irTypeValue, typeCtx);
      const captureDecoderCache = new Map<EastTypeValue, ValueDecoder>();

      return (reader: BufferReader, ctx: DecodeContext) => {
        const ir = fnIrDecoder(reader, ctx) as FunctionIR | AsyncFunctionIR;

        if (ir.type !== (isAsync ? "AsyncFunction" : "Function")) {
          throw new Error(`Expected ${fnType.type} IR, got ${ir.type}`);
        }

        // Decode captures
        const captureCount = reader.readVarint();
        if (captureCount !== ir.value.captures.length) {
          throw new Error(`Capture count mismatch: IR has ${ir.value.captures.length}, data has ${captureCount}`);
        }

        const captureContext: RuntimeContext = {};
        const typeContext: Record<string, EastTypeValue> = {};

        for (const captureVar of ir.value.captures) {
          const name = captureVar.value.name;
          const captureType = captureVar.value.type as EastTypeValue;

          // Get or build cached decoder for this capture type
          let dec = captureDecoderCache.get(captureType);
          if (!dec) {
            dec = buildDecoder(captureType, typeCtx);
            captureDecoderCache.set(captureType, dec);
          }
          const captureValue = dec(reader, ctx);

          captureContext[name] = captureVar.value.mutable
            ? variant("boxed", captureValue)
            : variant("value", captureValue);
          typeContext[name] = captureType;
        }

        return finishDecodedFunction(ir, isAsync, captureContext, typeContext, ctx, ctx.sourceMap);
      };
    }

    case "Vector": {
      const elemType = type.value.type;
      const bpe = elemType === "Float" ? 8 : elemType === "Integer" ? 8 : 1;
      return (reader) => {
        const len = reader.readVarint();
        const raw = new Uint8Array(reader.readBytesView(len * bpe));
        if (elemType === "Float") return new Float64Array(raw.buffer, 0, len);
        if (elemType === "Integer") return new BigInt64Array(raw.buffer, 0, len);
        return new Uint8ClampedArray(raw.buffer, 0, len);
      };
    }

    case "Matrix": {
      const elemType = type.value.type;
      const bpe = elemType === "Float" ? 8 : elemType === "Integer" ? 8 : 1;
      return (reader) => {
        const rows = reader.readVarint();
        const cols = reader.readVarint();
        const raw = new Uint8Array(reader.readBytesView(rows * cols * bpe));
        if (elemType === "Float") return matrix(new Float64Array(raw.buffer, 0, rows * cols), rows, cols);
        if (elemType === "Integer") return matrix(new BigInt64Array(raw.buffer, 0, rows * cols), rows, cols);
        return matrix(new Uint8ClampedArray(raw.buffer, 0, rows * cols), rows, cols);
      };
    }

    default:
      throw new Error(`Unknown type: ${(type as any).type}`);
  }
}

// =============================================================================
// Mutable value table section (v4)
// =============================================================================

function writeValueTableEntry(entry: ValueTableEntry, writer: BufferWriter, ctx: EncodeContext, encTypeCtx: Map<bigint, ValueEncoder>): void {
  const type = entry.type;
  const value = entry.value;

  // Write kind tag
  writer.writeUint8(entry.kind);

  // Element encoder — handles both inline (non-mutable) and table-ref (mutable) cases
  const encodeElem = (elemType: EastTypeValue, val: any, w: BufferWriter, c: EncodeContext) => {
    if (isMutableType(elemType)) {
      const idx = c.indexMap.get(val);
      if (idx === undefined) throw new InternalError("Nested mutable value not in value table");
      w.writeVarint(idx);
    } else {
      buildEncoder(elemType, encTypeCtx)(val, w, c);
    }
  };

  switch (type.type) {
    case "Array": {
      if (!ctx.typeTable.has(type.value)) ctx.typeTable.addETV(type.value);
      writer.writeVarint(ctx.typeTable.indexOf(type.value));
      writer.writeVarint(value.length);
      for (const item of value) encodeElem(type.value, item, writer, ctx);
      break;
    }
    case "Set": {
      if (!ctx.typeTable.has(type.value)) ctx.typeTable.addETV(type.value);
      writer.writeVarint(ctx.typeTable.indexOf(type.value));
      writer.writeVarint(value.size);
      for (const key of value) encodeElem(type.value, key, writer, ctx);
      break;
    }
    case "Dict": {
      if (!ctx.typeTable.has(type.value.key)) ctx.typeTable.addETV(type.value.key);
      if (!ctx.typeTable.has(type.value.value)) ctx.typeTable.addETV(type.value.value);
      writer.writeVarint(ctx.typeTable.indexOf(type.value.key));
      writer.writeVarint(ctx.typeTable.indexOf(type.value.value));
      writer.writeVarint(value.size);
      for (const [k, v] of value) {
        encodeElem(type.value.key, k, writer, ctx);
        encodeElem(type.value.value, v, writer, ctx);
      }
      break;
    }
    case "Ref": {
      if (!ctx.typeTable.has(type.value)) ctx.typeTable.addETV(type.value);
      writer.writeVarint(ctx.typeTable.indexOf(type.value));
      encodeElem(type.value, value.value, writer, ctx);
      break;
    }
  }
}

function readMutableValueTableSection(reader: BufferReader, ctx: DecodeContext): void {
  const sectionByteLength = reader.readVarint();
  const sectionEnd = reader.offset + sectionByteLength;
  const entryCount = reader.readVarint();

  if (entryCount === 0) {
    if (reader.offset !== sectionEnd) throw new Error(`Value table section size mismatch`);
    return;
  }

  // Two-pass decode: pre-allocate all containers, then fill elements.
  // Each entry is prefixed with varint(byte_length), enabling trivial skip in pass 1.

  // Pass 1: read entry headers, pre-allocate empty containers, skip element data by byte length
  const entryOffsets: number[] = new Array(entryCount);
  const entryLengths: number[] = new Array(entryCount);

  for (let i = 0; i < entryCount; i++) {
    const entryByteLength = reader.readVarint();
    const entryStart = reader.offset;
    const kindTag = reader.readUint8();

    switch (kindTag) {
      case TAG_ARRAY: {
        reader.readVarint(); // elem type idx (skip)
        const count = reader.readVarint();
        ctx.mutableValues.push(new Array(count));
        break;
      }
      case TAG_SET: {
        reader.readVarint(); // elem type idx (skip)
        reader.readVarint(); // count (skip — Set doesn't pre-allocate by count)
        ctx.mutableValues.push(new Set<any>());
        break;
      }
      case TAG_DICT: {
        reader.readVarint(); // key type idx (skip)
        reader.readVarint(); // val type idx (skip)
        reader.readVarint(); // count (skip)
        ctx.mutableValues.push(new Map<any, any>());
        break;
      }
      case TAG_REF: {
        reader.readVarint(); // inner type idx (skip)
        ctx.mutableValues.push(ref(undefined as any));
        break;
      }
      default:
        throw new Error(`Unknown value table kind tag 0x${kindTag.toString(16)}`);
    }

    entryOffsets[i] = entryStart;
    entryLengths[i] = entryByteLength;
    // Skip to next entry using byte length
    reader.offset = entryStart + entryByteLength;
  }

  if (reader.offset !== sectionEnd) {
    throw new Error(`Value table section size mismatch: expected ${sectionEnd}, got ${reader.offset}`);
  }

  // Pre-build decoders for ALL recursive types in the decoded type table into
  // a shared typeCtx. This ensures cross-type references resolve correctly
  // (e.g., IR arrays inside Functions reference both IRType and EastTypeType).
  const decTypeCtx = new Map<bigint, ValueDecoder>();
  for (const t of ctx.typeTable) {
    if (t.type === "Recursive" && (t.value as any)?.type === "wrapper") {
      buildDecoder(t, decTypeCtx);
    }
  }

  // Cache decoders by element type index — most entries share the same type
  const decoderCache = new Map<number, ValueDecoder>();
  const getCachedDecoder = (typeIdx: number): ValueDecoder => {
    let dec = decoderCache.get(typeIdx);
    if (!dec) {
      dec = buildDecoder(ctx.typeTable[typeIdx]!, decTypeCtx);
      decoderCache.set(typeIdx, dec);
    }
    return dec;
  };

  // Pass 2: fill elements in REVERSE order — children (higher indices) before parents.
  // The walker produces parents-before-children, so reversing ensures a parent's
  // element decoders (e.g., Function compilers) see fully-populated child entries.
  for (let i = entryCount - 1; i >= 0; i--) {
    const r = new BufferReader(reader.buffer, entryOffsets[i]!);
    const kindTag = r.readUint8();

    switch (kindTag) {
      case TAG_ARRAY: {
        const elemTypeIdx = r.readVarint();
        const elemType = ctx.typeTable[elemTypeIdx]!;
        const count = r.readVarint();
        const arr = ctx.mutableValues[i]! as any[];
        const isMut = isMutableType(elemType);
        const dec = isMut ? null : getCachedDecoder(elemTypeIdx);
        for (let j = 0; j < count; j++) {
          arr[j] = isMut ? ctx.mutableValues[r.readVarint()] : dec!(r, ctx);
        }
        break;
      }
      case TAG_SET: {
        const elemTypeIdx = r.readVarint();
        const elemType = ctx.typeTable[elemTypeIdx]!;
        const count = r.readVarint();
        const set = ctx.mutableValues[i]! as Set<any>;
        const isMut = isMutableType(elemType);
        const dec = isMut ? null : getCachedDecoder(elemTypeIdx);
        for (let j = 0; j < count; j++) {
          set.add(isMut ? ctx.mutableValues[r.readVarint()] : dec!(r, ctx));
        }
        break;
      }
      case TAG_DICT: {
        const keyTypeIdx = r.readVarint();
        const valTypeIdx = r.readVarint();
        const keyType = ctx.typeTable[keyTypeIdx]!;
        const valType = ctx.typeTable[valTypeIdx]!;
        const count = r.readVarint();
        const map = ctx.mutableValues[i]! as Map<any, any>;
        const keyMut = isMutableType(keyType);
        const valMut = isMutableType(valType);
        const keyDec = keyMut ? null : getCachedDecoder(keyTypeIdx);
        const valDec = valMut ? null : getCachedDecoder(valTypeIdx);
        for (let j = 0; j < count; j++) {
          const k = keyMut ? ctx.mutableValues[r.readVarint()] : keyDec!(r, ctx);
          const v = valMut ? ctx.mutableValues[r.readVarint()] : valDec!(r, ctx);
          map.set(k, v);
        }
        break;
      }
      case TAG_REF: {
        const innerTypeIdx = r.readVarint();
        const innerType = ctx.typeTable[innerTypeIdx]!;
        const rv = ctx.mutableValues[i]! as { value: any };
        if (isMutableType(innerType)) {
          rv.value = ctx.mutableValues[r.readVarint()];
        } else {
          rv.value = getCachedDecoder(innerTypeIdx)(r, ctx);
        }
        break;
      }
    }
  }
}

// =============================================================================
// Public API — Encode (v4 container)
// =============================================================================

/** Cached root-closure type table + its serialized section bytes, keyed on
 *  the type object handed to {@link encodeBeast2V4For} (#417). The curried
 *  encoder already amortized the closure build within one closure; this
 *  extends it across closures, and lets an encode whose value walk added no
 *  types reuse the serialized section bytes verbatim. */
interface BaseTypeTableEntry {
  builder: TypeTableBuilder;
  rootIdx: number;
  sectionBytes: Uint8Array;
}

const baseTypeTableCache = new WeakMap<object, BaseTypeTableEntry>();

function baseTypeTableFor(type: EastTypeValue | EastType, eastType: EastType | undefined, typeValue: EastTypeValue): BaseTypeTableEntry {
  const cached = baseTypeTableCache.get(type as object);
  if (cached) return cached;
  const builder = new TypeTableBuilder();
  const rootIdx = eastType ? builder.add(eastType) : builder.add(typeValue);
  const sw = new BufferWriter();
  writeTypeTableSection(rootIdx, builder.entries, sw);
  const entry: BaseTypeTableEntry = { builder, rootIdx, sectionBytes: sw.toUint8Array() };
  baseTypeTableCache.set(type as object, entry);
  return entry;
}

/**
 * Builds a v4-container encoder closure for the given type.
 *
 * @param type - the root East type (as `EastType` or `EastTypeValue`)
 * @param options - optional explicit source map to embed
 * @returns a reusable function encoding values of `type` to v4 beast2 bytes
 */
export function encodeBeast2V4For(type: EastTypeValue, options?: { sourceMap?: SourceMap | null }): (value: any) => Uint8Array
export function encodeBeast2V4For<T extends EastType>(type: T, options?: { sourceMap?: SourceMap | null }): (value: ValueTypeOf<T>) => Uint8Array
export function encodeBeast2V4For(type: EastTypeValue | EastType, options?: { sourceMap?: SourceMap | null }): (value: any) => Uint8Array {
  const eastType = isVariant(type) ? undefined : type as EastType;
  const typeValue = isVariant(type) ? type as EastTypeValue : toEastTypeValue(type as EastType);
  // Build encoder tree once at setup — save the typeCtx for reuse by value table entries
  const setupTypeCtx = new Map<bigint, ValueEncoder>();
  const valueEncoder = buildEncoder(typeValue, setupTypeCtx);

  // Root-closure type table (stable across encode calls AND closures — #417).
  const base = baseTypeTableFor(type, eastType, typeValue);
  const baseRootIdx = base.rootIdx;
  const baseEntryCount = base.builder.entries.length;

  return (value: any) => {
    const builder = base.builder.clone();
    const stringTable = new Map<string, number>();
    // Build the mutable value table by walking the value graph.
    // The walk also discovers the source map from any function in the value graph.
    const vtResult = buildValueTable(value, typeValue, builder);
    const vtEntries = vtResult.entries;
    const indexMap = buildIndexMap(vtEntries);

    // Source map: explicit option > root value > discovered during walk > null
    const sourceMap = options?.sourceMap
      ?? (value?.[EAST_SOURCE_MAP_SYMBOL] as SourceMap | undefined)
      ?? vtResult.sourceMap
      ?? null;
    const ctx: EncodeContext = { indexMap, typeTable: builder, stringTable };

    // Encode value table entries FIRST — this discovers types and strings
    // from inside mutable containers (which are varint refs in the value stream)
    const vtWriter = new BufferWriter();
    vtWriter.writeVarint(vtEntries.length);
    for (const entry of vtEntries) {
      // Buffer each entry, then write varint(byte_length) + entry bytes
      const entryWriter = new BufferWriter();
      writeValueTableEntry(entry, entryWriter, ctx, setupTypeCtx);
      const entryBytes = entryWriter.toUint8Array();
      vtWriter.writeVarint(entryBytes.length);
      vtWriter.writeBytes(entryBytes);
    }

    // Encode the value stream (mutable containers are written as varint indices)
    const valueWriter = new BufferWriter();
    valueEncoder(value, valueWriter, ctx);

    // Source map filenames must be added to stringTable before writing string table section
    const smWriter = new BufferWriter();
    writeSourceMapSection(sourceMap, stringTable, smWriter);

    // Write the final blob: magic + type table + string table + source map + value table + value data
    const writer = new BufferWriter();
    writer.writeBytes(MAGIC_BYTES);
    if (builder.entries.length === baseEntryCount) {
      // The value walk added no types — the section is the cached root
      // closure, byte for byte (#417).
      writer.writeBytes(base.sectionBytes);
    } else {
      writeTypeTableSection(baseRootIdx, builder.entries, writer);
    }
    writeStringTableSection(stringTable, writer);
    writer.writeBytes(smWriter.toUint8Array());
    // Write value table section with byte-length prefix
    const vtBytes = vtWriter.toUint8Array();
    writer.writeVarint(vtBytes.length);
    writer.writeBytes(vtBytes);
    writer.writeBytes(valueWriter.toUint8Array());

    return writer.toUint8Array();
  };
}

// =============================================================================
// Public API — Decode (v4 container, known type)
// =============================================================================

/**
 * Builds a v4-container decoder closure for the given type.
 *
 * @param type - the expected root East type (as `EastType` or `EastTypeValue`)
 * @param options - decode options (platform functions for decoded functions)
 * @returns a reusable function decoding v4 beast2 bytes to values of `type`
 */
export function decodeBeast2V4For(type: EastTypeValue, options?: Beast2DecodeOptions): (data: Uint8Array) => any
export function decodeBeast2V4For<T extends EastType>(type: T, options?: Beast2DecodeOptions): (data: Uint8Array) => ValueTypeOf<T>
export function decodeBeast2V4For(type: EastTypeValue | EastType, options?: Beast2DecodeOptions): (data: Uint8Array) => any {
  if (!isVariant(type)) type = toEastTypeValue(type);
  const typeValue = type as EastTypeValue;

  // Pre-build value decoder once (reused on every decode call)
  const valueDecoder = buildDecoder(typeValue);
  const platformCtx = buildPlatformContext(options);

  return (data: Uint8Array) => {
    verifyMagic(data);

    const reader = new BufferReader(data, MAGIC_BYTES.length);
    const { typeTable } = readTypeTableSection(reader);
    const stringTable = readStringTableSection(reader);
    const sourceMap = readSourceMapSection(reader, stringTable);

    const ctx: DecodeContext = {
      mutableValues: [],
      typeTable,
      stringTable,
      sourceMap,
      ...platformCtx,
    };
    readMutableValueTableSection(reader, ctx);
    const value = valueDecoder(reader, ctx);

    if (reader.offset !== data.length) {
      throw new Error(`${data.length - reader.offset} trailing bytes at offset ${reader.offset}`);
    }

    return value;
  };
}

// =============================================================================
// Public API — IR + source map (v4 container)
// =============================================================================

/**
 * Decodes a v4 IRType blob and returns both the IR value and the decoded
 * source map. Backs the version-agnostic `decodeEastIR` / `decodeAsyncEastIR`.
 *
 * @param data - a v4 beast2 blob whose root is a Function/AsyncFunction IR
 * @returns the decoded IR value and the blob's source map (or `null`)
 */
export function decodeIRWithSourceMapV4(data: Uint8Array): { ir: any; sourceMap: SourceMap | null } {
  verifyMagic(data);
  const reader = new BufferReader(data, MAGIC_BYTES.length);
  const { typeTable } = readTypeTableSection(reader);
  const stringTable = readStringTableSection(reader);
  const sourceMap = readSourceMapSection(reader, stringTable);

  const valueDecoder = buildDecoder(irTypeValue);
  const ctx: DecodeContext = {
    mutableValues: [],
    typeTable,
    stringTable,
    sourceMap,
    ...buildPlatformContext(),
  };
  readMutableValueTableSection(reader, ctx);
  const ir = valueDecoder(reader, ctx);
  if (reader.offset !== data.length) {
    throw new Error(`${data.length - reader.offset} trailing bytes at offset ${reader.offset}`);
  }
  return { ir, sourceMap };
}

// =============================================================================
// Public API — Decode (v4 container, self-describing)
// =============================================================================

/**
 * Decodes a self-describing v4 blob using its embedded root type.
 *
 * @param data - a v4 beast2 blob
 * @param options - decode options (platform functions for decoded functions)
 * @returns the blob's root type and decoded value
 */
export function decodeBeast2V4(data: Uint8Array, options?: Beast2DecodeOptions): { type: EastTypeValue; value: any } {
  verifyMagic(data);

  const reader = new BufferReader(data, MAGIC_BYTES.length);
  const { rootType, typeTable } = readTypeTableSection(reader);
  const stringTable = readStringTableSection(reader);
  const sourceMap = readSourceMapSection(reader, stringTable);

  const valueDecoder = buildDecoder(rootType);
  const ctx: DecodeContext = {
    mutableValues: [],
    typeTable,
    stringTable,
    sourceMap,
    ...buildPlatformContext(options),
  };
  readMutableValueTableSection(reader, ctx);
  const value = valueDecoder(reader, ctx);

  if (reader.offset !== data.length) {
    throw new Error(`${data.length - reader.offset} trailing bytes at offset ${reader.offset}`);
  }

  return { type: rootType, value };
}
