/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v2 — complete encoder and decoder.
 *
 * File layout: magic(8) + type_table_section + string_table_section + value_data
 * Type table: flat array of unique types, referenced by varint index.
 * String table: flat array of unique strings, referenced by varint index.
 * Value data: type-driven positional encoding, no inline type tags.
 * Functions: IR encoded directly — EastTypeType schema positions auto-emit type table indices.
 *
 * See devdocs/BEAST2.md for the full specification.
 */

import { toEastTypeValue, EastTypeValueType, type EastTypeValue } from "../type_of_type.js";
import type { EastType, ValueTypeOf } from "../types.js";
import { getTypeId } from "../types.js";
import { isVariant, variant } from "../containers/variant.js";
import { BufferWriter, BufferReader } from "./binary-utils.js";
import { ref } from "../containers/ref.js";
import { matrix } from "../containers/matrix.js";
import { EAST_IR_SYMBOL, EAST_CAPTURES_SYMBOL, ReturnException, compile_internal, type RuntimeContext } from "../compile.js";
import { InternalError } from "../error.js";
import { IRType, type FunctionIR, type AsyncFunctionIR } from "../ir.js";
import type { PlatformFunction } from "../platform.js";
import type { AnalyzedIR } from "../analyze.js";
import { EastIR, AsyncEastIR } from "../eastir.js";
import { TypeTableBuilder, writeTypeTableSection, readTypeTableSection } from "./beast2-type-table.js";

// type_id of EastTypeValueType — schema positions with this id encode values as table indices
const EAST_TYPE_TYPE_TID = getTypeId(EastTypeValueType);

// Shared empty set for compile_internal's compilingNodes parameter (avoids per-call allocation)
const EMPTY_SET = new Set<any>();


// =============================================================================
// Magic bytes (v2: last byte = 0x02)
// =============================================================================

export const MAGIC_BYTES = new Uint8Array([0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x02]);

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
// Public types
// =============================================================================

export type Beast2DecodeOptions = {
  platform?: PlatformFunction[];
};

// =============================================================================
// Internal context types
// =============================================================================

type ValueEncoder = (value: any, writer: BufferWriter, ctx: EncodeContext) => void;
type ValueDecoder = (reader: BufferReader, ctx: DecodeContext) => any;

interface EncodeContext {
  refs: Map<any, number>;
  typeTable: TypeTableBuilder;
  stringTable: Map<string, number>;
  irEncoder: ValueEncoder;
}

interface DecodeContext {
  refs: Map<number, any>;
  typeTable: EastTypeValue[];
  stringTable: string[];
  irDecoder: ValueDecoder;
  platform: PlatformFunction[];
  platformFns: Record<string, any>;
  asyncPlatformFns: Set<string>;
}

// =============================================================================
// Value encoder factory
// =============================================================================

/**
 * Build a value encoder closure tree for the given type.
 * The tree is built once and reused for every encode call.
 */
function buildEncoder(type: EastTypeValue, typeCtx: Map<bigint, ValueEncoder> = new Map()): ValueEncoder {
  // At EastTypeType schema positions, encode values as type table indices.
  // Types are added lazily — if not already in the table, addETV adds it.
  if (getTypeId(type) === EAST_TYPE_TYPE_TID) {
    return (value: any, writer: BufferWriter, ctx: EncodeContext) => {
      if (!ctx.typeTable.has(value)) ctx.typeTable.addETV(value);
      writer.writeVarint(ctx.typeTable.indexOf(value));
    };
  }

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

    case "Ref": {
      let innerEncoder: ValueEncoder;
      const ret: ValueEncoder = (value, writer, ctx) => {
        if (ctx.refs.has(value)) {
          writer.writeVarint(writer.currentOffset - ctx.refs.get(value)!);
          return;
        }
        writer.writeVarint(0);
        ctx.refs.set(value, writer.currentOffset);
        innerEncoder(value.value, writer, ctx);
      };

      innerEncoder = buildEncoder(type.value, typeCtx);

      return ret;
    }

    case "Array": {
      let elemEncoder: ValueEncoder;
      const ret: ValueEncoder = (value, writer, ctx) => {
        if (ctx.refs.has(value)) {
          writer.writeVarint(writer.currentOffset - ctx.refs.get(value)!);
          return;
        }
        writer.writeVarint(0);
        ctx.refs.set(value, writer.currentOffset);
        writer.writeVarint(value.length);
        for (const item of value) elemEncoder(item, writer, ctx);
      };

      elemEncoder = buildEncoder(type.value, typeCtx);

      return ret;
    }

    case "Set": {
      const keyEncoder = buildEncoder(type.value, typeCtx);
      return (value, writer, ctx) => {
        if (ctx.refs.has(value)) {
          writer.writeVarint(writer.currentOffset - ctx.refs.get(value)!);
          return;
        }
        writer.writeVarint(0);
        ctx.refs.set(value, writer.currentOffset);
        writer.writeVarint(value.size);
        for (const key of value) keyEncoder(key, writer, ctx);
      };
    }

    case "Dict": {
      const keyEncoder = buildEncoder(type.value.key, typeCtx);
      let valEncoder: ValueEncoder;
      const ret: ValueEncoder = (value, writer, ctx) => {
        if (ctx.refs.has(value)) {
          writer.writeVarint(writer.currentOffset - ctx.refs.get(value)!);
          return;
        }
        writer.writeVarint(0);
        ctx.refs.set(value, writer.currentOffset);
        writer.writeVarint(value.size);
        for (const [k, v] of value) {
          keyEncoder(k, writer, ctx);
          valEncoder(v, writer, ctx);
        }
      };

      valEncoder = buildEncoder(type.value.value, typeCtx);

      return ret;
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
      // Pre-build capture encoders from the function type's IR capture types.
      // At build time we don't know the capture types (they come from the IR),
      // so we build them lazily on first call and cache.
      const captureEncoderCache = new Map<EastTypeValue, ValueEncoder>();

      return (value: any, writer: BufferWriter, ctx: EncodeContext) => {
        const ir = value[EAST_IR_SYMBOL] as FunctionIR | AsyncFunctionIR | undefined;
        if (!ir) throw new Error("Cannot serialize function: no IR attached");

        // Encode IR directly — buildEncoder for IRType automatically handles
        // EastTypeType positions as type table indices (no separate substitution)
        ctx.irEncoder(ir, writer, ctx);

        // Encode captures
        const captures = value[EAST_CAPTURES_SYMBOL] as RuntimeContext | undefined;
        const captureList = ir.value.captures;
        writer.writeVarint(captureList.length);

        for (const captureVar of captureList) {
          const name = captureVar.value.name;
          const captureType = captureVar.value.type as EastTypeValue;

          if (!captures) throw new InternalError("Function has captures but no EAST_CAPTURES_SYMBOL");
          const entry = captures[name];
          if (!entry) throw new InternalError(`Capture '${name}' not found`);

          // Get or build cached encoder for this capture type
          let enc = captureEncoderCache.get(captureType);
          if (!enc) {
            enc = buildEncoder(captureType);
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
  // At EastTypeType schema positions, decode values from type table indices.
  if (getTypeId(type) === EAST_TYPE_TYPE_TID) {
    return (reader: BufferReader, ctx: DecodeContext) => {
      const idx = reader.readVarint();
      if (idx >= ctx.typeTable.length) throw new Error(`Type table index ${idx} out of bounds (table has ${ctx.typeTable.length} entries)`);
      return ctx.typeTable[idx]!;
    };
  }

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

    case "Ref": {
      let innerDecoder: ValueDecoder;
      const ret: ValueDecoder = (reader, ctx) => {
        const startOffset = reader.offset;
        const dist = reader.readVarint();
        if (dist > 0) {
          const target = ctx.refs.get(startOffset - dist);
          if (!target) throw new Error(`Undefined Ref backreference at offset ${startOffset}, target ${startOffset - dist}`);
          return target;
        }
        const r = ref(undefined as any);
        ctx.refs.set(reader.offset, r);
        r.value = innerDecoder(reader, ctx);
        return r;
      };

      innerDecoder = buildDecoder(type.value, typeCtx);

      return ret;
    }

    case "Array": {
      let elemDecoder: ValueDecoder;
      const ret: ValueDecoder = (reader, ctx) => {
        const startOffset = reader.offset;
        const dist = reader.readVarint();
        if (dist > 0) {
          const target = ctx.refs.get(startOffset - dist);
          if (!target) throw new Error(`Undefined Array backreference at offset ${startOffset}`);
          return target;
        }
        const refOffset = reader.offset;
        const count = reader.readVarint();
        const arr = new Array(count);
        ctx.refs.set(refOffset, arr);
        for (let i = 0; i < count; i++) arr[i] = elemDecoder(reader, ctx);
        return arr;
      };

      elemDecoder = buildDecoder(type.value, typeCtx);

      return ret;
    }

    case "Set": {
      const keyDecoder = buildDecoder(type.value, typeCtx);
      return (reader, ctx) => {
        const startOffset = reader.offset;
        const dist = reader.readVarint();
        if (dist > 0) {
          const target = ctx.refs.get(startOffset - dist);
          if (!target) throw new Error(`Undefined Set backreference at offset ${startOffset}`);
          return target;
        }
        const set = new Set<any>();
        ctx.refs.set(reader.offset, set);
        const count = reader.readVarint();
        for (let i = 0; i < count; i++) set.add(keyDecoder(reader, ctx));
        return set;
      };
    }

    case "Dict": {
      const keyDecoder = buildDecoder(type.value.key, typeCtx);
      let valDecoder: ValueDecoder;
      const ret: ValueDecoder = (reader, ctx) => {
        const startOffset = reader.offset;
        const dist = reader.readVarint();
        if (dist > 0) {
          const target = ctx.refs.get(startOffset - dist);
          if (!target) throw new Error(`Undefined Dict backreference at offset ${startOffset}`);
          return target;
        }
        const map = new Map<any, any>();
        ctx.refs.set(reader.offset, map);
        const count = reader.readVarint();
        for (let i = 0; i < count; i++) map.set(keyDecoder(reader, ctx), valDecoder(reader, ctx));
        return map;
      };

      valDecoder = buildDecoder(type.value.value, typeCtx);

      return ret;
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

      // Cache capture decoders (same capture types produce same decoder)
      const captureDecoderCache = new Map<EastTypeValue, ValueDecoder>();

      return (reader: BufferReader, ctx: DecodeContext) => {
        // Decode IR directly — buildDecoder for IRType automatically restores
        // EastTypeType positions from type table indices
        const ir = ctx.irDecoder(reader, ctx) as FunctionIR | AsyncFunctionIR;

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
            dec = buildDecoder(captureType);
            captureDecoderCache.set(captureType, dec);
          }
          const captureValue = dec(reader, ctx);

          captureContext[name] = captureVar.value.mutable
            ? variant("boxed", captureValue)
            : variant("value", captureValue);
          typeContext[name] = captureType;
        }

        // Compile IR to callable function — mutate in place to avoid object spread allocations
        (ir.value as any).isAsync = isAsync;
        const compiled = compile_internal(ir as any as AnalyzedIR, typeContext, ctx.platformFns, ctx.asyncPlatformFns, ctx.platform, true, EMPTY_SET);
        const rawFn = compiled(captureContext);

        const fn = isAsync
          ? async (...inputs: any[]) => {
              try { return await rawFn(...inputs); }
              catch (e) { if (e instanceof ReturnException) return e.value; throw e; }
            }
          : (...inputs: any[]) => {
              try { return rawFn(...inputs); }
              catch (e) { if (e instanceof ReturnException) return e.value; throw e; }
            };

        // Attach IR and captures for re-serialization
        Object.defineProperty(fn, EAST_IR_SYMBOL, { value: ir, writable: false, enumerable: false, configurable: false });
        Object.defineProperty(fn, EAST_CAPTURES_SYMBOL, { value: captureContext, writable: false, enumerable: false, configurable: false });

        return fn;
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
// String table section
// =============================================================================

/**
 * Write the string table section:
 *   [varint header_byte_length] [varint count] [string entries...]
 * Each string entry: [varint byte_length] [UTF-8 bytes]
 */
function writeStringTableSection(stringTable: Map<string, number>, writer: BufferWriter): void {
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
function readStringTableSection(reader: BufferReader): string[] {
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

// =============================================================================
// IR encoder/decoder (module-level singletons)
// =============================================================================

const irTypeValue = toEastTypeValue(IRType);
const irEncoder = buildEncoder(irTypeValue);
const irDecoder = buildDecoder(irTypeValue);

// =============================================================================
// Public API — Encode
// =============================================================================

export function encodeBeast2For(type: EastTypeValue): (value: any) => Uint8Array
export function encodeBeast2For<T extends EastType>(type: T): (value: ValueTypeOf<T>) => Uint8Array
export function encodeBeast2For(type: EastTypeValue | EastType): (value: any) => Uint8Array {
  const eastType = isVariant(type) ? undefined : type as EastType;
  const typeValue = isVariant(type) ? type as EastTypeValue : toEastTypeValue(type as EastType);
  const valueEncoder = buildEncoder(typeValue);

  // Pre-build the type table for the root type (stable across encode calls).
  // IR types from function values are added per-call since they vary.
  const baseBuilder = new TypeTableBuilder();
  const baseRootIdx = eastType ? baseBuilder.add(eastType) : baseBuilder.add(typeValue);

  return (value: any) => {
    // Encode value data first — types and strings are added lazily.
    // Types are discovered at EastTypeType positions (IR annotations).
    // Strings are discovered at every String value position.
    const builder = baseBuilder.clone();
    const stringTable = new Map<string, number>();
    const valueWriter = new BufferWriter();
    const ctx: EncodeContext = { refs: new Map(), typeTable: builder, stringTable, irEncoder };
    valueEncoder(value, valueWriter, ctx);

    // Now write the final blob: magic + type table + string table + value data
    const writer = new BufferWriter();
    writer.writeBytes(MAGIC_BYTES);
    writeTypeTableSection(baseRootIdx, builder.entries, writer);
    writeStringTableSection(stringTable, writer);
    writer.writeBytes(valueWriter.toUint8Array());

    return writer.toUint8Array();
  };
}

// =============================================================================
// Public API — Decode (known type)
// =============================================================================

export function decodeBeast2For(type: EastTypeValue, options?: Beast2DecodeOptions): (data: Uint8Array) => any
export function decodeBeast2For<T extends EastType>(type: T, options?: Beast2DecodeOptions): (data: Uint8Array) => ValueTypeOf<T>
export function decodeBeast2For(type: EastTypeValue | EastType, options?: Beast2DecodeOptions): (data: Uint8Array) => any {
  if (!isVariant(type)) type = toEastTypeValue(type);
  const typeValue = type as EastTypeValue;

  // Pre-build value decoder once (reused on every decode call)
  const valueDecoder = buildDecoder(typeValue);
  const platform = options?.platform ?? [];
  const platformFns = Object.fromEntries(platform.map(fn => [fn.name, fn.fn]));
  const asyncPlatformFns = new Set(platform.filter(fn => fn.type === 'async').map(fn => fn.name));

  return (data: Uint8Array) => {
    verifyMagic(data);

    const reader = new BufferReader(data, MAGIC_BYTES.length);
    const { typeTable } = readTypeTableSection(reader);
    const stringTable = readStringTableSection(reader);

    const ctx: DecodeContext = {
      refs: new Map(),
      typeTable,
      stringTable,
      irDecoder,
      platform,
      platformFns,
      asyncPlatformFns,
    };
    const value = valueDecoder(reader, ctx);

    if (reader.offset !== data.length) {
      throw new Error(`${data.length - reader.offset} trailing bytes at offset ${reader.offset}`);
    }

    return value;
  };
}

// =============================================================================
// Public API — Decode (self-describing)
// =============================================================================

export function decodeBeast2(data: Uint8Array, options?: Beast2DecodeOptions): { type: EastTypeValue; value: any } {
  verifyMagic(data);

  const reader = new BufferReader(data, MAGIC_BYTES.length);
  const { rootType, typeTable } = readTypeTableSection(reader);
  const stringTable = readStringTableSection(reader);

  const valueDecoder = buildDecoder(rootType);
  const platform = options?.platform ?? [];
  const ctx: DecodeContext = {
    refs: new Map(),
    typeTable,
    stringTable,
    irDecoder,
    platform,
    platformFns: Object.fromEntries(platform.map(fn => [fn.name, fn.fn])),
    asyncPlatformFns: new Set(platform.filter(fn => fn.type === 'async').map(fn => fn.name)),
  };
  const value = valueDecoder(reader, ctx);

  if (reader.offset !== data.length) {
    throw new Error(`${data.length - reader.offset} trailing bytes at offset ${reader.offset}`);
  }

  return { type: rootType, value };
}

// =============================================================================
// Re-exports
// =============================================================================

export { EAST_IR_SYMBOL, EAST_CAPTURES_SYMBOL } from "../compile.js";

export function compileFunctionIR<I extends any[], O>(ir: FunctionIR, platform: PlatformFunction[]): (...args: I) => O {
  return new EastIR(ir).compile(platform) as (...args: I) => O;
}

export function compileAsyncFunctionIR<I extends any[], O>(ir: AsyncFunctionIR, platform: PlatformFunction[]): (...args: I) => Promise<O> {
  return new AsyncEastIR(ir).compile(platform) as (...args: I) => Promise<O>;
}
