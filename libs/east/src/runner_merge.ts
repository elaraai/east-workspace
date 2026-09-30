/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The merge of a merge unit's parts (issue #770), over a {@link UnitIO}.
 *
 * Canonical Set or Dict collections of one type in — sorted, indexed beast2 v5
 * blobs, or manifest directories, as a unit's parts are staged — and one
 * canonical collection out, merged by `mergeBeast2For`: every part is read
 * segment by segment through ranged reads, and the output is written through
 * the canonical element writer, so it is byte-identical to what that writer
 * writes for the merged value. Memory is one decoded segment per part plus one
 * open output segment. This module opens and checks the parts, reads the key
 * range and loads the fold, refusing each in the words east-c and east-py use.
 *
 * Equal keys across parts fold in part order: with a merge function (Dict
 * parts) `acc = merge(key, acc, value)`; in union mode (Set parts) the first
 * element stands. Without a fold, an equal key is the library's duplicate
 * error. A part whose keys do not ascend, a part whose type is not part 0's,
 * and an Array part are refused.
 *
 * With a key range (a blob of `Struct{from: Option<K>, to: Option<K>}` over
 * the parts' key type) only the keys in `[from, to)` merge: every part is
 * sought to the segment owning `from` through its fences and read up to the
 * first key at or past `to`, so a unit over a range of a large output reads
 * that range's share of each part, plus at most one segment. An absent bound
 * is open; both absent is the whole merge.
 *
 * This is the fan-in of a split task's set and dict parts: e3 runs it as a
 * merge unit on the task's runner, one per key range of a group of parts, and
 * never decodes a part itself. east-c and east-py merge through the same
 * contract, so the three runners write the same bytes.
 */

import { type EastTypeValue, fromEastTypeValue, isTypeValueEqual, toEastTypeValue } from "./type_of_type.js";
import { OptionType, StructType } from "./types.js";
import type { option } from "./containers/variant.js";
import type { PlatformFunction } from "./platform.js";
import type { EastIR } from "./eastir.js";
import { printTypeValue } from "./compile/runtime.js";
import {
  decodeBeast2For,
  mergeBeast2For,
  readBeast2Extents,
  readBeast2HeaderType,
  readBeast2Manifest,
  readBeast2Type,
  type Beast2ManifestSink,
  type Beast2ManifestSource,
  type Beast2MergeStats,
  type Beast2SyncRangeReader,
  type CollectionManifest,
} from "./serialization/beast2/index.js";
import { type UnitIO, loadUnitProgram, readUnitRange, segmentPath } from "./runner_io.js";

/** A compiled `(K, V, V) -> V` fold of equal keys. */
export type UnitMergeFunction = (key: unknown, acc: unknown, value: unknown) => unknown;

/**
 * Loads a merge function: an IR file holding a `(K, V, V) -> V` East function
 * over the given key and value types, compiled with the unit's platforms.
 * Shared by a run unit's dict output and the merge of parts.
 *
 * @param io - the unit's files
 * @param path - the IR file, in any encoding a unit may name
 * @param keyType - the key type
 * @param valueType - the value type
 * @param platforms - the unit's platform functions
 * @param subject - what the function must match, for the message: `the emit
 *   parameter` or `the inputs`
 * @returns the compiled merge function
 * @throws {Error} When the IR is not a function of that shape, naming the
 *   expected and the actual types.
 */
export function loadUnitMergeFunction(
  io: UnitIO,
  path: string,
  keyType: EastTypeValue,
  valueType: EastTypeValue,
  platforms: PlatformFunction[],
  subject: string,
): UnitMergeFunction {
  const bundle = loadUnitProgram(io, path);
  const fnType = (bundle.ir as { value: { type: EastTypeValue } }).value.type;
  const shape = fnType.type === "Function" ? fnType.value as { inputs: EastTypeValue[]; output: EastTypeValue } : null;
  if (shape === null || shape.inputs.length !== 3 ||
      !isTypeValueEqual(shape.inputs[0]!, keyType) ||
      !isTypeValueEqual(shape.inputs[1]!, valueType) ||
      !isTypeValueEqual(shape.inputs[2]!, valueType) ||
      !isTypeValueEqual(shape.output, valueType)) {
    throw new Error(
      `merge function: expected a function (K, V, V) -> V matching ${subject} ` +
      `(K = ${printTypeValue(keyType)}, V = ${printTypeValue(valueType)}), got ${printTypeValue(fnType)}`,
    );
  }
  return (bundle as EastIR<unknown[], unknown>).compile(platforms) as UnitMergeFunction;
}

/** Options accepted by {@link mergeUnitParts}. */
export interface UnitMergeOptions {
  /** Dict parts: an IR file holding a `(K, V, V) -> V` East function over the
   *  parts' key and value types, compiled with `platforms`. Equal keys fold
   *  with it in part order. */
  merge?: string;
  /** Set parts: the first of equal elements stands. */
  union?: boolean;
  /** A beast2 blob of `Struct{from: Option<K>, to: Option<K>}` over the
   *  parts' key type: only the keys in `[from, to)` merge; an absent bound is
   *  open. */
  range?: string;
  /** The platform functions the merge function compiles with. */
  platforms?: PlatformFunction[];
  /** Whether the unit's host places a manifest part's segments as they are
   *  read: the unit's `fetch`. */
  fetch?: boolean;
}

/** The keys a merge covers: `[from, to)`, a bound `undefined` when open —
 *  East values are never `undefined`. */
interface KeyRange {
  from: unknown;
  to: unknown;
}

/** A part opened and checked: its type, and what the merge reads it through
 *  — ranged reads on its file, or the segments of a manifest directory. */
interface OpenedPart {
  type: EastTypeValue;
  source: Beast2SyncRangeReader | Beast2ManifestSource;
}

/**
 * The segments of the manifest directory at `path`, each read through ranged
 * reads on its file in `<path>.segments/`, the layout e3 stages parts in, and
 * asked for as it is first read when the unit's host places segments as they
 * are read.
 */
function manifestSource(io: UnitIO, path: string, manifest: CollectionManifest, fetch: boolean): Beast2ManifestSource {
  return {
    manifest,
    segment(i) {
      const file = segmentPath(path, manifest.entries[i]!.hash);
      io.segment(file, fetch);
      let size: number;
      try {
        size = io.size(file);
      } catch {
        throw new Error(`beast2 v5: manifest segment ${file} cannot be read`);
      }
      return { size, read: (offset, length) => readUnitRange(io, file, offset, length) };
    },
  };
}

/**
 * Opens part `index` at `path` and checks it is a canonical Set or Dict
 * collection of `expected`'s type: a blob, read through ranged reads on its
 * file, or a manifest directory, read through its segment files.
 *
 * @throws {Error} When there is no file at `path`, it is not a blob (too
 *   short, or without the magic — the reader's own words), it cannot be read
 *   as a canonical collection blob or a manifest, or its type is not
 *   `expected`.
 */
function openPart(io: UnitIO, path: string, index: number, expected: EastTypeValue | null, fetch: boolean): OpenedPart {
  let size: number;
  try {
    size = io.size(path);
  } catch {
    throw new Error(`merge: input ${index} (${path}): cannot open the file`);
  }
  const reader: Beast2SyncRangeReader = { size, read: (offset, length) => readUnitRange(io, path, offset, length) };
  let manifest: CollectionManifest | null;
  let type: EastTypeValue;
  let selfContained: boolean;
  try {
    // The header first: a file too short for a blob, or one without the
    // magic, is refused in the reader's words — the sentence east-c and
    // east-py give for the same bytes — before the index is looked for.
    readBeast2HeaderType(reader);
    // A manifest directory is the collection its manifest names, its
    // segments standalone blobs, each self-contained.
    manifest = readBeast2Manifest(reader);
    if (manifest !== null) {
      type = manifest.type;
      selfContained = true;
    } else {
      const extents = readBeast2Extents(reader);
      type = extents.typeValue;
      selfContained = extents.selfContained;
    }
  } catch (err) {
    throw new Error(`merge: input ${index} (${path}): ${(err as Error).message ?? String(err)}`);
  }
  if (expected !== null && !isTypeValueEqual(type, expected)) {
    throw new Error(`merge: input ${index} (${path}) has type ${printTypeValue(type)}, expected ${printTypeValue(expected)} (input 0)`);
  }
  if (type.type !== "Set" && type.type !== "Dict") {
    throw new Error(`merge: inputs must be Set or Dict blobs, got ${type.type}`);
  }
  if (!selfContained) {
    throw new Error(`merge: input ${index} (${path}): the blob is not self-contained`);
  }
  return { type, source: manifest === null ? reader : manifestSource(io, path, manifest, fetch) };
}

/**
 * Reads a range blob: `Struct{from: Option<K>, to: Option<K>}` over the parts'
 * key type, self-describing, checked against that type.
 *
 * @throws {Error} When the file cannot be read or read as a beast2 blob, or
 *   its type is not the bounds struct over the parts' key type.
 */
function readKeyRange(io: UnitIO, path: string, keyType: EastTypeValue): KeyRange {
  let bytes: Uint8Array;
  try {
    bytes = io.read(path);
  } catch {
    throw new Error(`merge: range (${path}): cannot open the file`);
  }
  // The same shape east-c builds (merge.c) and e3-core writes
  // (execution/steps.ts): the bounds struct over the key type.
  const key = fromEastTypeValue(keyType);
  const rangeType = toEastTypeValue(StructType({ from: OptionType(key), to: OptionType(key) }));
  let type: EastTypeValue;
  try {
    type = readBeast2Type(bytes);
  } catch (err) {
    throw new Error(`merge: range (${path}): ${(err as Error).message ?? String(err)}`);
  }
  if (!isTypeValueEqual(type, rangeType)) {
    throw new Error(`merge: range (${path}) has type ${printTypeValue(type)}, expected ${printTypeValue(rangeType)} (bounds over the inputs' key type)`);
  }
  let bounds: { from: option<unknown>; to: option<unknown> };
  try {
    bounds = decodeBeast2For(rangeType)(bytes);
  } catch (err) {
    throw new Error(`merge: range (${path}): ${(err as Error).message ?? String(err)}`);
  }
  return {
    from: bounds.from.type === "some" ? bounds.from.value : undefined,
    to: bounds.to.type === "some" ? bounds.to.value : undefined,
  };
}

/**
 * Merges a merge unit's sorted Set or Dict parts of one type into one
 * canonical collection.
 *
 * @param io - the unit's files
 * @param parts - the parts, in the order equal keys fold; at least one
 * @param output - the sink a manifest directory is written through, or the
 *   blob's bytes as they are produced
 * @param options - the fold, its platforms, the key range, and the unit's
 *   `fetch`
 * @returns the account: parts merged, entries written, keys folded
 * @throws {Error} With the merge's message — a part of another type than part
 *   0's, an Array part, keys that do not ascend, a fold whose signature does
 *   not match the parts, a range blob of another shape than the bounds over
 *   the parts' key type, a file that cannot be read, a shared key without a
 *   fold — leaving the output unfinalised (no terminator or index, or no
 *   manifest). Nothing is written before every part has opened.
 */
export function mergeUnitParts(
  io: UnitIO,
  parts: readonly string[],
  output: Beast2ManifestSink | ((bytes: Uint8Array) => void),
  options: UnitMergeOptions = {},
): Beast2MergeStats {
  if (parts.length === 0) throw new Error("merge: at least one input is needed");
  if (options.merge !== undefined && options.union) {
    throw new Error("merge: a merge function and union are two folds — give one");
  }
  const fetch = options.fetch ?? false;
  const first = openPart(io, parts[0]!, 0, null, fetch);
  const type = first.type;
  const dict = type.type === "Dict";
  if (options.merge !== undefined && !dict) throw new Error("merge: a merge function applies to Dict inputs only");
  if (options.union && dict) throw new Error("merge: union applies to Set inputs only");
  const keyType = (dict ? (type.value as { key: EastTypeValue }).key : type.value) as EastTypeValue;
  const merge = options.merge !== undefined
    ? loadUnitMergeFunction(io, options.merge, keyType, (type.value as { value: EastTypeValue }).value, options.platforms ?? [], "the inputs")
    : undefined;
  const range = options.range !== undefined ? readKeyRange(io, options.range, keyType) : { from: undefined, to: undefined };
  const opened = [first];
  for (let i = 1; i < parts.length; i++) opened.push(openPart(io, parts[i]!, i, type, fetch));

  return mergeBeast2For(type, {
    ...(merge !== undefined && { merge }),
    union: options.union ?? false,
    from: range.from,
    to: range.to,
    labels: parts,
    // Frames deflate on worker threads, where the host has them (#763).
    parallel: true,
  })(opened.map((part) => part.source), output);
}
