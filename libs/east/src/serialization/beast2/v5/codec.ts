/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 codec — the single-pass, segment-terminated record stream.
 *
 * Blob layout:
 *
 *     magic[8]               0x89 "East" 0x0D 0x0A 0x05
 *     type_section           well-known id + hash, or structural (v4 table)
 *     source_map_section     varint(len) + stacks with inline filenames
 *     value stream           frames carrying the logical value encoding
 *     [index_section]        optional — segment offsets/counts (see stream.ts)
 *     [footer]               u64-LE index offset + footer magic
 *
 * Logical value encoding (type-directed, positional):
 * - immutable scalars encode as in v4, except strings are inline
 *   (`varint(len) + utf8`) — there is no string table.
 * - mutable containers (Array/Set/Dict/Ref) carry a tag byte: `0x00 NEW`
 *   defines the container (registered in definition-start preorder) and is
 *   followed by its content; `0x01 REF` + `varint(delta)` aliases the
 *   container defined `delta` definitions ago. Relative deltas make decode
 *   independent of segment scoping — a self-contained segment resolves the
 *   same deltas with a fresh table that a sequential reader resolves with a
 *   global one.
 * - Array/Set/Dict content is segment-terminated:
 *   `repeat[varint(n>0) + n elements] varint(0)` — no up-front totals.
 *   Set/Dict content is the canonical value split at segment boundaries:
 *   strictly ascending in East (key) order across the whole stream, no
 *   duplicates — segments concatenate, and decoders reject anything else
 *   as corrupt. Encoders sort plain `Map`/`Set` inputs to keep logical
 *   value → bytes independent of the JS container flavor.
 * - Function values emit a source-map delta (`varint(n_new)` + stacks not yet
 *   written to this stream), then their IR, then `varint(capture_count)` +
 *   captures. Location ids inside IR stay plain integer data, so round-trips
 *   preserve them exactly.
 *
 * See v5/SPEC.md for the full wire specification.
 */

import { type EastTypeValue } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { variant } from "../../../containers/variant.js";
import { ref } from "../../../containers/ref.js";
import { SortedSet } from "../../../containers/sortedset.js";
import { SortedMap } from "../../../containers/sortedmap.js";
import { matrix } from "../../../containers/matrix.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";
import { compareFor } from "../../../comparison.js";
import { EAST_IR_SYMBOL, EAST_CAPTURES_SYMBOL, EAST_SOURCE_MAP_SYMBOL, type RuntimeContext } from "../../../compile.js";
import { InternalError } from "../../../error.js";
import type { FunctionIR, AsyncFunctionIR } from "../../../ir.js";
import { SourceMap, type Location } from "../../../location.js";
import { type Beast2DecodeOptions, type PlatformDecodeContext, buildPlatformContext, describeNoIrValue, finishDecodedFunction, irTypeValue } from "../shared.js";
import { writeTypeSection, readTypeSection, asTypeValue } from "./type-section.js";
import { type Beast2Codec, FrameReader, type FrameInflate, writeFrame, preInflateFrames } from "./frames.js";

// =============================================================================
// Wire constants
// =============================================================================

/** The v5 container magic: the beast2 magic with version byte 0x05. */
export const MAGIC_BYTES_V5 = new Uint8Array([0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x05]);

/** Container tag: defines a new mutable container at this position. */
export const TAG_NEW = 0x00;
/** Container tag: aliases a previously defined container by relative delta. */
export const TAG_REF = 0x01;

// =============================================================================
// Contexts
// =============================================================================

/** Mutable state threaded through a v5 encode pass. */
export interface V5EncodeContext {
  /** Identity map: container object → definition index. Cleared per root
   *  segment by self-contained writers. */
  containerIndex: Map<any, number>;
  /** Count of container definitions so far (the definition counter). */
  containerCount: number;
  /** Definition count at the start of the current root segment — REFs
   *  reaching below this mark are cross-segment aliases. */
  segmentBaseDef: number;
  /** Whether any REF crossed a root-segment boundary. */
  crossSegmentRef: boolean;
  /** The stream's source map (header map, or adopted from the first function
   *  value that carries one). */
  sourceMap: SourceMap | null;
  /** Number of source-map stacks already written (header + inline deltas),
   *  including the index-0 empty sentinel. */
  sourceMapEmitted: number;
  /** Self-contained mode: inline source-map growth is forbidden (stacks
   *  emitted mid-stream would be unreachable from later segments). */
  selfContained: boolean;
}

/** Creates a fresh v5 encode context.
 *
 * @param sourceMap - the pre-resolved header source map, if any
 * @param selfContained - whether the writer scopes aliasing per segment
 * @returns the initialized context
 */
export function createV5EncodeContext(sourceMap: SourceMap | null, selfContained: boolean): V5EncodeContext {
  return {
    containerIndex: new Map(),
    containerCount: 0,
    segmentBaseDef: 0,
    crossSegmentRef: false,
    sourceMap,
    sourceMapEmitted: sourceMap ? Number(sourceMap.size) : 1,
    selfContained,
  };
}

/** Mutable state threaded through a v5 decode pass. */
export interface V5DecodeContext extends PlatformDecodeContext {
  /** Every decoded container in definition order — REF deltas resolve from
   *  the tail of this list. */
  containers: any[];
  /** The stream's source map, accumulated from the header section and inline
   *  deltas. Attached to every decoded function. */
  sourceMap: SourceMap;
}

// =============================================================================
// Source map section (v5: inline filenames)
// =============================================================================

function writeStack(stack: readonly Location[], writer: BufferWriter): void {
  writer.writeVarint(stack.length);
  for (const frame of stack) {
    writer.writeStringUtf8Varint(frame.filename);
    writer.writeVarint(Number(frame.line));
    writer.writeVarint(Number(frame.column));
  }
}

function readStack(reader: BufferReader): Location[] {
  const frameCount = reader.readVarint();
  const stack: Location[] = new Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const filename = reader.readStringUtf8Varint();
    const line = reader.readVarint();
    const column = reader.readVarint();
    stack[i] = { filename, line: BigInt(line), column: BigInt(column) };
  }
  return stack;
}

/**
 * Writes the v5 source_map_section: `varint(payload_len)` + `varint(count)` +
 * stacks with inline filenames. Entry 0 (the empty sentinel) is implicit.
 *
 * @param sourceMap - the header source map, or `null` for an empty section
 * @param writer - the wire-level writer
 */
export function writeSourceMapSectionV5(sourceMap: SourceMap | null, writer: BufferWriter): void {
  const payload = new BufferWriter();
  if (!sourceMap || sourceMap.size <= 1n) {
    payload.writeVarint(0);
  } else {
    const entries = sourceMap.entries();
    payload.writeVarint(entries.length - 1);
    for (let i = 1; i < entries.length; i++) {
      writeStack(entries[i]!, payload);
    }
  }
  const bytes = payload.toUint8Array();
  writer.writeVarint(bytes.length);
  writer.writeBytes(bytes);
}

/**
 * Reads the v5 source_map_section into a fresh {@link SourceMap}.
 *
 * @param reader - the wire-level reader positioned at the section start
 * @returns the decoded source map (stack ids match encode-side ids)
 */
export function readSourceMapSectionV5(reader: BufferReader): SourceMap {
  const payloadLen = reader.readVarint();
  const end = reader.offset + payloadLen;
  const map = new SourceMap();
  const stackCount = reader.readVarint();
  for (let i = 0; i < stackCount; i++) {
    map.intern_stack(readStack(reader));
  }
  if (reader.offset !== end) {
    throw new Error(`beast2 v5: source map section size mismatch: expected offset ${end}, got ${reader.offset}`);
  }
  return map;
}

// =============================================================================
// Value encoder factory
// =============================================================================

type V5Encoder = (value: any, writer: BufferWriter, ctx: V5EncodeContext) => void;
type V5Decoder = (reader: BufferReader, ctx: V5DecodeContext) => any;

/** Emits the NEW tag and registers a container definition; returns false when
 *  the container was already defined and a REF was written instead. */
function beginContainer(value: any, writer: BufferWriter, ctx: V5EncodeContext): boolean {
  const idx = ctx.containerIndex.get(value);
  if (idx !== undefined) {
    writer.writeUint8(TAG_REF);
    writer.writeVarint(ctx.containerCount - idx);
    if (idx < ctx.segmentBaseDef) ctx.crossSegmentRef = true;
    return false;
  }
  writer.writeUint8(TAG_NEW);
  ctx.containerIndex.set(value, ctx.containerCount++);
  return true;
}

/**
 * Builds a v5 value encoder closure tree for the given type.
 *
 * @param type - the type to encode
 * @param typeCtx - recursive-type resolution context shared across the tree
 * @returns the encoder closure
 */
export function buildV5Encoder(type: EastTypeValue, typeCtx: Map<bigint, V5Encoder> = new Map()): V5Encoder {
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
      return (value: string, writer: BufferWriter) => writer.writeStringUtf8Varint(value);

    case "DateTime":
      return (value, writer) => writer.writeZigzag(BigInt(value.valueOf()));

    case "Blob":
      return (value, writer) => {
        writer.writeVarint(value.length);
        writer.writeBytes(value);
      };

    case "Array": {
      let elem: V5Encoder;
      const ret: V5Encoder = (value, writer, ctx) => {
        if (!beginContainer(value, writer, ctx)) return;
        const n = value.length;
        if (n > 0) {
          writer.writeVarint(n);
          for (const item of value) elem(item, writer, ctx);
        }
        writer.writeVarint(0);
      };
      elem = buildV5Encoder(type.value, typeCtx);
      return ret;
    }

    case "Set": {
      let elem: V5Encoder;
      const cmp = compareFor(type.value);
      const ret: V5Encoder = (value, writer, ctx) => {
        if (!beginContainer(value, writer, ctx)) return;
        const n = value.size;
        if (n > 0) {
          writer.writeVarint(n);
          // The wire holds the canonical value: elements in East total order.
          // A SortedSet iterates in that order already; a plain Set iterates
          // in insertion order and is sorted first, so the same logical value
          // always produces the same bytes (and the same content hash).
          const items: Iterable<any> = value instanceof SortedSet ? value : [...value].sort(cmp);
          for (const item of items) elem(item, writer, ctx);
        }
        writer.writeVarint(0);
      };
      elem = buildV5Encoder(type.value, typeCtx);
      return ret;
    }

    case "Dict": {
      let key: V5Encoder;
      let val: V5Encoder;
      const cmpKey = compareFor(type.value.key);
      const ret: V5Encoder = (value, writer, ctx) => {
        if (!beginContainer(value, writer, ctx)) return;
        const n = value.size;
        if (n > 0) {
          writer.writeVarint(n);
          // Canonical wire order, as for Set: plain Maps sort by key first.
          const entries: Iterable<[any, any]> = value instanceof SortedMap
            ? value
            : [...value.entries()].sort((a: [any, any], b: [any, any]) => cmpKey(a[0], b[0]));
          for (const [k, v] of entries) {
            key(k, writer, ctx);
            val(v, writer, ctx);
          }
        }
        writer.writeVarint(0);
      };
      key = buildV5Encoder(type.value.key, typeCtx);
      val = buildV5Encoder(type.value.value, typeCtx);
      return ret;
    }

    case "Ref": {
      let inner: V5Encoder;
      const ret: V5Encoder = (value, writer, ctx) => {
        if (!beginContainer(value, writer, ctx)) return;
        inner(value.value, writer, ctx);
      };
      inner = buildV5Encoder(type.value, typeCtx);
      return ret;
    }

    case "Struct": {
      const fieldEncoders: [string, V5Encoder][] = [];
      const ret: V5Encoder = (value, writer, ctx) => {
        for (const [name, enc] of fieldEncoders) enc(value[name], writer, ctx);
      };
      for (const { name, type: fieldType } of type.value) {
        fieldEncoders.push([name, buildV5Encoder(fieldType, typeCtx)]);
      }
      return ret;
    }

    case "Variant": {
      const caseEncoders: Record<string, V5Encoder> = {};
      const caseTags: Record<string, number> = {};
      const ret: V5Encoder = (value, writer, ctx) => {
        writer.writeVarint(caseTags[value.type]!);
        caseEncoders[value.type]!(value.value, writer, ctx);
      };
      for (let i = 0; i < type.value.length; i++) {
        const { name, type: caseType } = type.value[i]!;
        caseTags[name] = i;
        caseEncoders[name] = buildV5Encoder(caseType, typeCtx);
      }
      return ret;
    }

    case "Recursive": {
      if ((type.value as any).type === "wrapper") {
        let inner: V5Encoder;
        const ret: V5Encoder = (value, writer, ctx) => inner(value, writer, ctx);
        typeCtx.set((type.value as any).value.id as bigint, ret);
        inner = buildV5Encoder((type.value as any).value.inner, typeCtx);
        return ret;
      }
      const target = typeCtx.get((type.value as any).value as bigint);
      if (!target) throw new InternalError("Recursive type context not found during encoder build");
      return target;
    }

    case "Function":
    case "AsyncFunction": {
      const fnIrEncoder = buildV5Encoder(irTypeValue, typeCtx);
      const captureEncoderCache = new Map<EastTypeValue, V5Encoder>();

      return (value: any, writer: BufferWriter, ctx: V5EncodeContext) => {
        const ir = value[EAST_IR_SYMBOL] as FunctionIR | AsyncFunctionIR | undefined;
        if (!ir) throw new Error(`Cannot serialize function: no IR attached (${describeNoIrValue(value)})`);

        // Source-map delta: stacks of the stream's map not yet on the wire.
        const sm = (value as any)[EAST_SOURCE_MAP_SYMBOL] as SourceMap | undefined ?? null;
        if (ctx.sourceMap === null && sm) ctx.sourceMap = sm;
        if (ctx.sourceMap !== null && sm === ctx.sourceMap && Number(ctx.sourceMap.size) > ctx.sourceMapEmitted) {
          if (ctx.selfContained) {
            throw new Error(
              `beast2 v5: self-contained streams cannot add function source maps mid-stream; ` +
              `pass the source map to the writer up front or disable selfContained`
            );
          }
          const entries = ctx.sourceMap.entries();
          writer.writeVarint(entries.length - ctx.sourceMapEmitted);
          for (let i = ctx.sourceMapEmitted; i < entries.length; i++) {
            writeStack(entries[i]!, writer);
          }
          ctx.sourceMapEmitted = entries.length;
        } else {
          writer.writeVarint(0);
        }

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
            enc = buildV5Encoder(captureType, typeCtx);
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

/** Reads a container tag; resolves and returns the aliased container for REF,
 *  or `undefined` for NEW (the caller then defines the container). */
function readContainerTag(reader: BufferReader, ctx: V5DecodeContext): any | undefined {
  const tag = reader.readUint8();
  if (tag === TAG_NEW) return undefined;
  if (tag !== TAG_REF) {
    throw new Error(`beast2 v5: invalid container tag 0x${tag.toString(16)}`);
  }
  const delta = reader.readVarint();
  if (delta < 1 || delta > ctx.containers.length) {
    throw new Error(`beast2 v5: container backref delta ${delta} out of range (${ctx.containers.length} definitions visible)`);
  }
  return ctx.containers[ctx.containers.length - delta];
}

/**
 * Builds a v5 value decoder closure tree for the given type.
 *
 * @param type - the type to decode
 * @param typeCtx - recursive-type resolution context shared across the tree
 * @returns the decoder closure
 */
export function buildV5Decoder(type: EastTypeValue, typeCtx: Map<bigint, V5Decoder> = new Map()): V5Decoder {
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
      return (reader) => reader.readStringUtf8Varint();

    case "DateTime":
      return (reader) => new Date(Number(reader.readZigzag()));

    case "Blob":
      return (reader) => reader.readBytes(reader.readVarint());

    case "Array": {
      let elem: V5Decoder;
      const ret: V5Decoder = (reader, ctx) => {
        const aliased = readContainerTag(reader, ctx);
        if (aliased !== undefined) return aliased;
        const arr: any[] = [];
        ctx.containers.push(arr);
        for (;;) {
          const n = reader.readVarint();
          if (n === 0) break;
          for (let i = 0; i < n; i++) arr.push(elem(reader, ctx));
        }
        return arr;
      };
      elem = buildV5Decoder(type.value, typeCtx);
      return ret;
    }

    case "Set": {
      let elem: V5Decoder;
      const cmp = compareFor(type.value);
      const ret: V5Decoder = (reader, ctx) => {
        const aliased = readContainerTag(reader, ctx);
        if (aliased !== undefined) return aliased;
        // The wire must hold the canonical value: strictly ascending in East
        // order across the container's whole content (segments concatenate).
        // Anything else is corrupt — decoders validate, never repair.
        const set = new SortedSet<any>(undefined, cmp);
        ctx.containers.push(set);
        let has = false;
        let prev: any;
        for (;;) {
          const n = reader.readVarint();
          if (n === 0) break;
          for (let i = 0; i < n; i++) {
            const item = elem(reader, ctx);
            if (has && cmp(prev, item) >= 0) {
              throw new Error(`beast2 v5: Set elements are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)`);
            }
            prev = item;
            has = true;
            set.add(item);
          }
        }
        return set;
      };
      elem = buildV5Decoder(type.value, typeCtx);
      return ret;
    }

    case "Dict": {
      let key: V5Decoder;
      let val: V5Decoder;
      const cmpKey = compareFor(type.value.key);
      const ret: V5Decoder = (reader, ctx) => {
        const aliased = readContainerTag(reader, ctx);
        if (aliased !== undefined) return aliased;
        // Canonical wire order, as for Set: keys strictly ascending across
        // the whole content, no duplicates. Validate, never repair.
        const map = new SortedMap<any, any>(undefined, cmpKey);
        ctx.containers.push(map);
        let has = false;
        let prev: any;
        for (;;) {
          const n = reader.readVarint();
          if (n === 0) break;
          for (let i = 0; i < n; i++) {
            const k = key(reader, ctx);
            if (has && cmpKey(prev, k) >= 0) {
              throw new Error(`beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)`);
            }
            prev = k;
            has = true;
            const v = val(reader, ctx);
            map.set(k, v);
          }
        }
        return map;
      };
      key = buildV5Decoder(type.value.key, typeCtx);
      val = buildV5Decoder(type.value.value, typeCtx);
      return ret;
    }

    case "Ref": {
      let inner: V5Decoder;
      const ret: V5Decoder = (reader, ctx) => {
        const aliased = readContainerTag(reader, ctx);
        if (aliased !== undefined) return aliased;
        const cell = ref(undefined as any);
        ctx.containers.push(cell);
        cell.value = inner(reader, ctx);
        return cell;
      };
      inner = buildV5Decoder(type.value, typeCtx);
      return ret;
    }

    case "Struct": {
      const fields = type.value as { name: string; type: EastTypeValue }[];
      const names: string[] = [];
      const decoders: V5Decoder[] = [];
      const ret: V5Decoder = (reader, ctx) => {
        const result: Record<string, any> = {};
        for (let i = 0; i < names.length; i++) result[names[i]!] = decoders[i]!(reader, ctx);
        return result;
      };
      for (const { name, type: fieldType } of fields) {
        names.push(name);
        decoders.push(buildV5Decoder(fieldType, typeCtx));
      }
      return ret;
    }

    case "Variant": {
      const caseDecoders: [string, V5Decoder][] = [];
      const ret: V5Decoder = (reader, ctx) => {
        const tagIndex = reader.readVarint();
        if (tagIndex >= caseDecoders.length) throw new Error(`Invalid variant tag ${tagIndex}`);
        const [caseName, caseDec] = caseDecoders[tagIndex]!;
        return variant(caseName, caseDec(reader, ctx));
      };
      for (const { name, type: caseType } of type.value) {
        caseDecoders.push([name, buildV5Decoder(caseType, typeCtx)]);
      }
      return ret;
    }

    case "Recursive": {
      if ((type.value as any).type === "wrapper") {
        let inner: V5Decoder;
        const ret: V5Decoder = (reader, ctx) => inner(reader, ctx);
        typeCtx.set((type.value as any).value.id as bigint, ret);
        inner = buildV5Decoder((type.value as any).value.inner, typeCtx);
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
      const fnIrDecoder = buildV5Decoder(irTypeValue, typeCtx);
      const captureDecoderCache = new Map<EastTypeValue, V5Decoder>();

      return (reader: BufferReader, ctx: V5DecodeContext) => {
        // Inline source-map delta.
        const newStacks = reader.readVarint();
        for (let i = 0; i < newStacks; i++) {
          ctx.sourceMap.intern_stack(readStack(reader));
        }

        const ir = fnIrDecoder(reader, ctx) as FunctionIR | AsyncFunctionIR;
        if (ir.type !== (isAsync ? "AsyncFunction" : "Function")) {
          throw new Error(`Expected ${fnType.type} IR, got ${ir.type}`);
        }

        const captureCount = reader.readVarint();
        if (captureCount !== ir.value.captures.length) {
          throw new Error(`Capture count mismatch: IR has ${ir.value.captures.length}, data has ${captureCount}`);
        }

        const captureContext: RuntimeContext = {};
        const typeContext: Record<string, EastTypeValue> = {};

        for (const captureVar of ir.value.captures) {
          const name = captureVar.value.name;
          const captureType = captureVar.value.type as EastTypeValue;

          let dec = captureDecoderCache.get(captureType);
          if (!dec) {
            dec = buildV5Decoder(captureType, typeCtx);
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
// Whole-value encode
// =============================================================================

/** Options accepted by the v5 whole-value encoder. */
export type Beast2V5EncodeOptions = {
  /** Explicit source map to embed in the header section. */
  sourceMap?: SourceMap | null;
  /** Per-frame codec. Defaults to `"deflate"`. */
  codec?: Beast2Codec;
  /** Write the trailing index + footer (container roots only). Defaults to
   *  `false` for whole-value encodes. */
  index?: boolean;
};

/** Whether a root type takes the segmented container framing. */
export function isSegmentedRoot(type: EastTypeValue): boolean {
  return type.type === "Array" || type.type === "Set" || type.type === "Dict";
}

/**
 * Builds a v5 whole-value encoder closure for the given type.
 *
 * @param type - the root East type (as `EastType` or `EastTypeValue`)
 * @param options - encode options (source map, codec, index)
 * @returns a reusable function encoding values of `type` to v5 beast2 bytes
 */
export function encodeBeast2V5For(type: EastTypeValue | EastType, options?: Beast2V5EncodeOptions): (value: any) => Uint8Array {
  const typeValue = asTypeValue(type);
  const codec: Beast2Codec = options?.codec ?? "deflate";
  const withIndex = (options?.index ?? false) && isSegmentedRoot(typeValue);

  const setupTypeCtx = new Map<bigint, V5Encoder>();
  const valueEncoder = buildV5Encoder(typeValue, setupTypeCtx);

  // Header bytes up to the source-map section are value-independent — build
  // the magic + type section once per closure.
  const headWriter = new BufferWriter();
  headWriter.writeBytes(MAGIC_BYTES_V5);
  writeTypeSection(typeValue, headWriter);
  const headBytes = headWriter.toUint8Array();

  return (value: any) => {
    const sourceMap = options?.sourceMap
      ?? ((value as any)?.[EAST_SOURCE_MAP_SYMBOL] as SourceMap | undefined)
      ?? null;
    const ctx = createV5EncodeContext(sourceMap, false);

    const writer = new BufferWriter();
    writer.writeBytes(headBytes);
    writeSourceMapSectionV5(sourceMap, writer);

    if (!withIndex) {
      // Single frame carrying the whole logical value encoding.
      const logical = new BufferWriter();
      valueEncoder(value, logical, ctx);
      writeFrame(writer, logical.toUint8Array(), codec);
      return writer.toUint8Array();
    }

    // Indexed layout: tag frame, one segment frame, terminator frame — every
    // indexed segment frame holds exactly `varint(n) + n elements`.
    ctx.containerCount++;
    ctx.containerIndex.set(value, 0);
    ctx.segmentBaseDef = 1;

    writeFrame(writer, new Uint8Array([TAG_NEW]), "none");

    const count = typeValue.type === "Array" ? value.length : value.size;
    const segments: { offset: number; count: number }[] = [];
    if (count > 0) {
      const logical = new BufferWriter();
      logical.writeVarint(count);
      encodeSegmentElements(typeValue, value, logical, ctx, setupTypeCtx);
      segments.push({ offset: writer.size, count });
      writeFrame(writer, logical.toUint8Array(), codec);
    }
    writeFrame(writer, new Uint8Array([0x00]), "none");

    writeIndexAndFooter(writer, segments, !ctx.crossSegmentRef);
    return writer.toUint8Array();
  };

  function encodeSegmentElements(rootType: EastTypeValue, value: any, logical: BufferWriter, ctx: V5EncodeContext, typeCtx: Map<bigint, V5Encoder>): void {
    if (rootType.type === "Array" || rootType.type === "Set") {
      const elem = getElemEncoder(rootType.value, typeCtx);
      for (const item of value) elem(item, logical, ctx);
    } else {
      const key = getElemEncoder(rootType.value.key, typeCtx);
      const val = getElemEncoder(rootType.value.value, typeCtx);
      for (const [k, v] of value) {
        key(k, logical, ctx);
        val(v, logical, ctx);
      }
    }
  }
}

const elemEncoderCache = new WeakMap<Map<bigint, V5Encoder>, Map<EastTypeValue, V5Encoder>>();

/** Builds (and caches per type context) an element encoder. */
function getElemEncoder(elemType: EastTypeValue, typeCtx: Map<bigint, V5Encoder>): V5Encoder {
  let cache = elemEncoderCache.get(typeCtx);
  if (!cache) {
    cache = new Map();
    elemEncoderCache.set(typeCtx, cache);
  }
  let enc = cache.get(elemType);
  if (!enc) {
    enc = buildV5Encoder(elemType, typeCtx);
    cache.set(elemType, enc);
  }
  return enc;
}

// =============================================================================
// Index + footer
// =============================================================================

/** The v5 footer magic: the beast2 magic family with terminal byte 0xF5. */
export const FOOTER_MAGIC_V5 = new Uint8Array([0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0xF5]);

/** Index flag bit: segments are independently decodable (no cross-segment
 *  aliasing), so paging readers may seek. */
export const INDEX_FLAG_SELF_CONTAINED = 0x01;

/**
 * Writes the index_section and footer.
 *
 * @param writer - the wire-level writer (its current size is the index offset)
 * @param segments - per-segment absolute frame offsets and element counts
 * @param selfContained - whether segments are independently decodable
 * @param indexOffsetOverride - the absolute wire offset of the index section,
 *   when the writer holds only a suffix of the stream (a standalone tail);
 *   defaults to the writer's current size
 */
export function writeIndexAndFooter(writer: BufferWriter, segments: { offset: number; count: number }[], selfContained: boolean, indexOffsetOverride?: number): void {
  const indexOffset = indexOffsetOverride ?? writer.size;
  writer.writeVarint(selfContained ? INDEX_FLAG_SELF_CONTAINED : 0);
  writer.writeVarint(segments.length);
  let prev = 0;
  for (const seg of segments) {
    writer.writeVarint(seg.offset - prev);
    writer.writeVarint(seg.count);
    prev = seg.offset;
  }
  writeU64LE(writer, indexOffset);
  writer.writeBytes(FOOTER_MAGIC_V5);
}

function writeU64LE(writer: BufferWriter, value: number): void {
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    writer.writeUint8(Number(v & 0xffn));
    v >>= 8n;
  }
}

/** A parsed v5 index. */
export interface Beast2Index {
  selfContained: boolean;
  /** Absolute wire offset of each segment's frame. */
  offsets: number[];
  /** Element count of each segment (pairs for Dict roots). */
  counts: number[];
  /** Sum of all segment counts. */
  totalCount: number;
}

/**
 * Reads the index_section + footer from the tail of a blob.
 *
 * @param data - the whole blob
 * @returns the parsed index, or `null` when the blob carries no footer
 * @throws {Error} When a footer is present but the index is malformed.
 */
export function readIndex(data: Uint8Array): Beast2Index | null {
  if (data.length < 16) return null;
  const footerStart = data.length - 16;
  for (let i = 0; i < 8; i++) {
    if (data[footerStart + 8 + i] !== FOOTER_MAGIC_V5[i]) return null;
  }
  let indexOffset = 0n;
  for (let i = 7; i >= 0; i--) {
    indexOffset = (indexOffset << 8n) | BigInt(data[footerStart + i]!);
  }
  const offset = Number(indexOffset);
  if (offset < 8 || offset >= footerStart) {
    throw new Error(`beast2 v5: footer index offset ${offset} out of range`);
  }
  const reader = new BufferReader(data, offset);
  const flags = reader.readVarint();
  if ((flags & ~INDEX_FLAG_SELF_CONTAINED) !== 0) {
    throw new Error(`beast2 v5: unknown index flags 0x${flags.toString(16)}`);
  }
  const segmentCount = reader.readVarint();
  const offsets: number[] = new Array(segmentCount);
  const counts: number[] = new Array(segmentCount);
  let prev = 0;
  let totalCount = 0;
  for (let i = 0; i < segmentCount; i++) {
    prev += reader.readVarint();
    offsets[i] = prev;
    counts[i] = reader.readVarint();
    totalCount += counts[i]!;
    if (prev >= offset) {
      throw new Error(`beast2 v5: index segment offset ${prev} overlaps the index section`);
    }
  }
  if (reader.offset !== footerStart) {
    throw new Error(`beast2 v5: index section size mismatch (ends at ${reader.offset}, footer at ${footerStart})`);
  }
  return { selfContained: (flags & INDEX_FLAG_SELF_CONTAINED) !== 0, offsets, counts, totalCount };
}

// =============================================================================
// Whole-value decode
// =============================================================================

interface V5DecodeResult {
  value: any;
  rootType: EastTypeValue;
  sourceMap: SourceMap;
}

/** Parses the v5 header and returns the wire root type plus a reader
 *  positioned at the first value-stream frame. */
function readHeader(data: Uint8Array): { rootType: EastTypeValue; sourceMap: SourceMap; frameOffset: number } {
  if (data.length < 8) {
    throw new Error(`Data too short for Beast2 format: ${data.length} bytes`);
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== MAGIC_BYTES_V5[i]) {
      throw new Error(`Invalid Beast2 v5 magic at offset ${i}: expected 0x${MAGIC_BYTES_V5[i]!.toString(16)}, got 0x${data[i]!.toString(16)}`);
    }
  }
  const reader = new BufferReader(data, MAGIC_BYTES_V5.length);
  const { rootType } = readTypeSection(reader);
  const sourceMap = readSourceMapSectionV5(reader);
  return { rootType, sourceMap, frameOffset: reader.offset };
}

/** Decodes a whole v5 blob with the given decode type (`null` = use the wire
 *  root type), enforcing whole-stream strictness. */
function decodeV5(data: Uint8Array, decodeType: EastTypeValue | null, options: Beast2DecodeOptions | undefined, inflate?: FrameInflate): V5DecodeResult {
  const { rootType, sourceMap, frameOffset } = readHeader(data);
  const typeValue = decodeType ?? rootType;
  const ctx: V5DecodeContext = {
    containers: [],
    sourceMap,
    ...buildPlatformContext(options),
  };
  const cursor = new FrameReader(data, frameOffset, inflate);
  const segmentCounts: number[] | null = isSegmentedRoot(typeValue) ? [] : null;

  let value: any;
  if (segmentCounts) {
    value = decodeSegmentedRoot(typeValue, cursor, ctx, segmentCounts);
  } else {
    const reader = cursor.next();
    const dec = cachedRootDecoder(typeValue);
    value = dec(reader, ctx);
    if (reader.offset !== reader.buffer.length) {
      throw new Error(`beast2 v5: ${reader.buffer.length - reader.offset} logical bytes after the root value`);
    }
  }

  verifyTrailing(data, cursor.wireOffset, segmentCounts);
  return { value, rootType, sourceMap };
}

// Decoder closure trees, shared across decodes of the same root type.
//
// Building them per decode is the dominant cost for a large recursive schema
// — a UIComponentType blob spent ~200 ms per decode in buildDecoder and the
// GC churn of the closures it allocates, versus 0.04 ms in east-c, whose
// decoder is a switch over types and allocates nothing. Decoders take their
// DecodeContext as a parameter and capture nothing per-decode, so sharing
// them is safe; the key is the root type object, which is a module-level
// singleton for well-known schemas and the #417-cached instance otherwise.
const rootDecoderCache = new WeakMap<object, V5Decoder>();
const elementDecoderCache = new WeakMap<object, { elemDec: V5Decoder | null; keyDec: V5Decoder | null; valDec: V5Decoder | null }>();

function cachedRootDecoder(typeValue: EastTypeValue): V5Decoder {
  const hit = rootDecoderCache.get(typeValue as object);
  if (hit) return hit;
  const dec = buildV5Decoder(typeValue);
  rootDecoderCache.set(typeValue as object, dec);
  return dec;
}

function cachedElementDecoders(typeValue: EastTypeValue, kind: string, typeCtx: Map<bigint, V5Decoder>) {
  const hit = elementDecoderCache.get(typeValue as object);
  if (hit) return hit;
  const built = {
    elemDec: kind === "Dict" ? null : buildV5Decoder((typeValue as any).value, typeCtx),
    keyDec: kind === "Dict" ? buildV5Decoder((typeValue as any).value.key, typeCtx) : null,
    valDec: kind === "Dict" ? buildV5Decoder((typeValue as any).value.value, typeCtx) : null,
  };
  elementDecoderCache.set(typeValue as object, built);
  return built;
}

/** Decodes a segmented (Array/Set/Dict) root across frames. */
function decodeSegmentedRoot(typeValue: EastTypeValue, cursor: FrameReader, ctx: V5DecodeContext, segmentCounts: number[]): any {
  let reader = cursor.next();
  const tag = reader.readUint8();
  if (tag !== TAG_NEW) {
    throw new Error(`beast2 v5: root container must be NEW (tag 0x${tag.toString(16)})`);
  }

  const kind = typeValue.type as "Array" | "Set" | "Dict";
  // Set/Dict wire content is the canonical value split at segment boundaries:
  // strictly ascending in East order across the whole stream, no duplicates.
  // Segments concatenate; a violation is corruption, not data to repair.
  const cmp: ((a: any, b: any) => number) | null = kind === "Array" ? null
    : compareFor(kind === "Set" ? (typeValue as any).value : (typeValue as any).value.key);
  const container: any = kind === "Array" ? []
    : kind === "Set" ? new SortedSet<any>(undefined, cmp!)
    : new SortedMap<any, any>(undefined, cmp!);
  ctx.containers.push(container);

  const typeCtx = new Map<bigint, V5Decoder>();
  const { elemDec, keyDec, valDec } = cachedElementDecoders(typeValue, kind, typeCtx);

  let has = false;
  let prev: any;
  for (;;) {
    if (reader.offset === reader.buffer.length) reader = cursor.next();
    const n = reader.readVarint();
    if (n === 0) break;
    segmentCounts.push(n);
    if (kind === "Array") {
      for (let i = 0; i < n; i++) container.push(elemDec!(reader, ctx));
    } else if (kind === "Set") {
      for (let i = 0; i < n; i++) {
        const item = elemDec!(reader, ctx);
        if (has && cmp!(prev, item) >= 0) {
          throw new Error(`beast2 v5: Set elements are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)`);
        }
        prev = item;
        has = true;
        container.add(item);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const k = keyDec!(reader, ctx);
        if (has && cmp!(prev, k) >= 0) {
          throw new Error(`beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)`);
        }
        prev = k;
        has = true;
        const v = valDec!(reader, ctx);
        container.set(k, v);
      }
    }
  }
  if (reader.offset !== reader.buffer.length) {
    throw new Error(`beast2 v5: ${reader.buffer.length - reader.offset} logical bytes after the root terminator`);
  }

  return container;
}

/** Enforces whole-stream strictness after the value stream: the remaining
 *  bytes must be nothing, or a consistent index + footer. */
function verifyTrailing(data: Uint8Array, wireOffset: number, segmentCounts: number[] | null): void {
  if (wireOffset === data.length) return;
  if (segmentCounts === null) {
    throw new Error(`beast2 v5: ${data.length - wireOffset} trailing bytes at offset ${wireOffset}`);
  }
  const index = readIndex(data);
  if (!index) {
    throw new Error(`beast2 v5: ${data.length - wireOffset} trailing bytes at offset ${wireOffset} (no footer)`);
  }
  // The footer's index offset must sit exactly where the value stream ended.
  const footerStart = data.length - 16;
  let indexOffset = 0n;
  for (let i = 7; i >= 0; i--) {
    indexOffset = (indexOffset << 8n) | BigInt(data[footerStart + i]!);
  }
  if (Number(indexOffset) !== wireOffset) {
    throw new Error(`beast2 v5: index offset ${Number(indexOffset)} does not match end of value stream ${wireOffset}`);
  }
  if (index.counts.length !== segmentCounts.length) {
    throw new Error(`beast2 v5: index declares ${index.counts.length} segments, stream has ${segmentCounts.length}`);
  }
  for (let i = 0; i < segmentCounts.length; i++) {
    if (index.counts[i] !== segmentCounts[i]) {
      throw new Error(`beast2 v5: index segment ${i} count ${index.counts[i]} disagrees with stream count ${segmentCounts[i]}`);
    }
  }
}

/**
 * Builds a v5 decoder closure for the given type.
 *
 * @param type - the expected root East type (as `EastType` or `EastTypeValue`)
 * @param options - decode options (platform functions for decoded functions)
 * @returns a reusable function decoding v5 beast2 bytes to values of `type`
 */
export function decodeBeast2V5For(type: EastTypeValue | EastType, options?: Beast2DecodeOptions): (data: Uint8Array) => any {
  const typeValue = asTypeValue(type);
  return (data: Uint8Array) => decodeV5(data, typeValue, options).value;
}

/**
 * Builds an async v5 decoder closure — pre-inflates deflate frames with the
 * platform's native async decompressor. In browsers the sync entry points
 * fall back to the portable pure-TS inflate, so this is a throughput
 * optimization for large blobs, not a requirement.
 *
 * @param type - the expected root East type (as `EastType` or `EastTypeValue`)
 * @param options - decode options (platform functions for decoded functions)
 * @returns a reusable async function decoding v5 beast2 bytes
 */
export function decodeBeast2V5ForAsync(type: EastTypeValue | EastType, options?: Beast2DecodeOptions): (data: Uint8Array) => Promise<any> {
  const typeValue = asTypeValue(type);
  return async (data: Uint8Array) => {
    const { frameOffset } = readHeader(data);
    const inflate = await preInflateFrames(data, frameOffset);
    return decodeV5(data, typeValue, options, inflate).value;
  };
}

/**
 * Decodes a self-describing v5 blob using its embedded root type.
 *
 * @param data - a v5 beast2 blob
 * @param options - decode options (platform functions for decoded functions)
 * @returns the blob's root type and decoded value
 */
export function decodeBeast2V5(data: Uint8Array, options?: Beast2DecodeOptions): { type: EastTypeValue; value: any } {
  const result = decodeV5(data, null, options);
  return { type: result.rootType, value: result.value };
}

/**
 * Decodes a v5 IRType blob and returns both the IR value and the decoded
 * source map. Backs the version-agnostic `decodeEastIR` / `decodeAsyncEastIR`.
 *
 * @param data - a v5 beast2 blob whose root is a Function/AsyncFunction IR
 * @returns the decoded IR value and the blob's source map
 */
export function decodeIRWithSourceMapV5(data: Uint8Array): { ir: any; sourceMap: SourceMap | null } {
  const result = decodeV5(data, irTypeValue, undefined);
  return { ir: result.value, sourceMap: result.sourceMap };
}
