/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The merge of sorted collections — k canonical Set or Dict collections in, one
 * canonical blob, or one manifest directory, out.
 *
 * The inputs are read segment by segment and their current keys held in a heap
 * ordered by key and then by input, so a key that several inputs hold leaves
 * the heap once per input, in input order, and folds there. The merged entries
 * go out through the element writer, so the output is the canonical blob of
 * the merged value — the bytes any writer of that value writes, whoever wrote
 * the inputs and however their segments fell. Memory is one decoded segment per
 * input plus one open output segment.
 *
 * With a key range only the keys in `[from, to)` merge: each input starts at
 * the segment owning `from`, found through its fences, and stops at the first
 * key at or past `to`, so merging one range of a large output reads that
 * range's share of each input, plus at most one segment.
 */

import { type EastTypeValue, EastTypeValueType, isTypeValueEqual } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { printFor } from "../../east.js";
import { compareFor } from "../../../comparison.js";
import type { SortedMap } from "../../../containers/sortedmap.js";
import type { SortedSet } from "../../../containers/sortedset.js";
import { asTypeValue } from "./type-section.js";
import { Beast2ElementWriter, type Beast2ElementWriterOptions } from "./stream.js";
import { openBeast2LazyFor } from "./lazy.js";
import { readBeast2Extents } from "./geometry.js";
import { type Beast2SyncRangeReader, isBeast2SyncRangeReader } from "./range.js";
import { isBeast2ManifestSource, type Beast2ManifestSource } from "./manifest.js";
import { Beast2ManifestWriter, type Beast2ManifestSink } from "./manifest-writer.js";

/** One input to a merge: a canonical collection blob, synchronous ranged access
 *  to one, or a manifest naming its segments. */
export type Beast2MergeSource = Uint8Array | Beast2SyncRangeReader | Beast2ManifestSource;

/** Options accepted by {@link mergeBeast2For}. */
export type Beast2MergeOptions = Omit<Beast2ElementWriterOptions, "headerPrefix"> & {
  /**
   * Dict inputs: how a key several inputs hold folds, `acc = merge(key, acc,
   * value)`, in input order. Without it such a key is refused. Must be
   * associative when the inputs are runs or partials of one value: their
   * values folded in groups before they reach the merge.
   */
  merge?: (key: any, acc: any, value: any) => any;
  /** Set inputs: an element several inputs hold is kept once. Without it such
   *  an element is refused. */
  union?: boolean;
  /** Merge only the keys at or above this one. East values are never
   *  `undefined`, which leaves the range open below. */
  from?: unknown;
  /** Merge only the keys below this one; `undefined` leaves it open above. */
  to?: unknown;
  /** Names each input in error messages, beside its position — a path, say. */
  labels?: readonly string[];
};

/** What a merge came to. */
export type Beast2MergeStats = {
  /** Inputs merged. */
  inputs: number;
  /** Entries written. */
  entries: number;
  /** Entries that folded into, or collapsed into, an equal key's entry. */
  folds: number;
};

/**
 * Builds a merge of sorted Set or Dict collections of one type into one
 * canonical collection: `merge(sources, sink)`.
 *
 * @param type - the collection type every input holds (Set or Dict)
 * @param options - the fold, the key range, input labels, and the output's
 *   codec, source map and parallel framing
 * @returns a function merging its sources, in the order equal keys fold, into
 *   `sink` — the blob's bytes as they are produced, or, given a
 *   {@link Beast2ManifestSink}, a manifest directory — and returning what it
 *   came to
 * @throws {TypeError} When `type` is not a Set or Dict type, or the fold does
 *   not fit it: a merge function folds a Dict, union a Set.
 *
 * @remarks
 * The returned function throws, before writing anything, when no source is
 * given or a source is not a canonical collection of `type`; while merging,
 * when an input's keys do not ascend, a key repeats without a fold, or the
 * merge function throws. A failed merge leaves its output without the
 * terminator and index, or a manifest directory without its manifest, so
 * nothing reads it as complete. Messages name the input:
 * `merge: input 2 (<label>): …`.
 *
 * @example
 * ```ts
 * const type = SetType(IntegerType);
 * const blob = (xs: bigint[]) => encodeBeast2PagedFor(type)(new Set(xs));
 * const chunks: Uint8Array[] = [];
 * mergeBeast2For(type, { union: true })([blob([1n, 3n]), blob([2n, 3n])], (b) => chunks.push(b));
 * decodeBeast2For(type)(Buffer.concat(chunks));  // Set { 1n, 2n, 3n }
 * ```
 */
export function mergeBeast2For<T extends EastType>(type: T | EastTypeValue, options?: Beast2MergeOptions): (sources: readonly Beast2MergeSource[], sink: ((bytes: Uint8Array) => void) | Beast2ManifestSink) => Beast2MergeStats {
  const typeValue = asTypeValue(type);
  if (typeValue.type !== "Set" && typeValue.type !== "Dict") {
    throw new TypeError(`merge: inputs must be Set or Dict blobs, got ${typeValue.type}`);
  }
  const { merge, union, from, to, labels, ...writerOptions } = options ?? {};
  if (merge !== undefined && typeValue.type !== "Dict") {
    throw new TypeError(`beast2 v5: a merge function folds a Dict's values; a Set's equal elements collapse under union`);
  }
  if (union && typeValue.type !== "Set") {
    throw new TypeError(`beast2 v5: union collapses a Set's equal elements; a Dict's values fold with a merge function`);
  }
  const dict = typeValue.type === "Dict";
  const keyType: EastTypeValue = dict
    ? (typeValue as { value: { key: EastTypeValue } }).value.key
    : (typeValue as { value: EastTypeValue }).value;
  const cmp = compareFor(keyType) as (a: unknown, b: unknown) => number;
  const printKey = printFor(keyType);
  const printType = printFor(EastTypeValueType);
  const open = openBeast2LazyFor(typeValue, { frozen: true });

  return (sources, sink) => {
    if (sources.length === 0) throw new Error("merge: at least one input is needed");
    const named = (i: number): string => (labels?.[i] !== undefined ? `merge: input ${i} (${labels[i]})` : `merge: input ${i}`);
    const failed = (i: number, err: unknown): Error => new Error(`${named(i)}: ${(err as Error).message ?? String(err)}`);

    // Every input is opened before anything is written, so an input that is
    // not a collection of the type refuses the merge rather than truncating it.
    const iterators = sources.map((source, i): Iterator<unknown> => {
      let wire: EastTypeValue;
      try {
        wire = isBeast2ManifestSource(source)
          ? source.manifest.type
          : (isBeast2SyncRangeReader(source) ? readBeast2Extents(source) : readBeast2Extents(source)).typeValue;
      } catch (err) {
        throw failed(i, err);
      }
      if (!isTypeValueEqual(wire, typeValue)) {
        throw new Error(`${named(i)} has type ${printType(wire)}, expected ${printType(typeValue)}`);
      }
      try {
        const lazy = open(source);
        return dict ? (lazy as SortedMap<unknown, unknown>).entries(from) : (lazy as SortedSet<unknown>).keys(from);
      } catch (err) {
        throw failed(i, err);
      }
    });

    const heads: ({ key: unknown; value: unknown } | null)[] = new Array(iterators.length).fill(null);
    const advance = (i: number): void => {
      let next: IteratorResult<unknown>;
      try {
        next = iterators[i]!.next();
      } catch (err) {
        throw failed(i, err);
      }
      if (next.done) {
        heads[i] = null;
        return;
      }
      const [key, value] = dict ? (next.value as [unknown, unknown]) : [next.value, undefined];
      heads[i] = to !== undefined && cmp(key, to) >= 0 ? null : { key, value };
    };
    for (let i = 0; i < iterators.length; i++) advance(i);

    // A binary min-heap over the inputs' current keys, ordered by (key,
    // input), so equal keys leave in input order.
    const heap: number[] = [];
    for (let i = 0; i < heads.length; i++) if (heads[i] !== null) heap.push(i);
    const before = (a: number, b: number): boolean => {
      const order = cmp(heads[a]!.key, heads[b]!.key);
      return order < 0 || (order === 0 && a < b);
    };
    const siftDown = (at: number): void => {
      for (;;) {
        const l = 2 * at + 1;
        const r = l + 1;
        let least = at;
        if (l < heap.length && before(heap[l]!, heap[least]!)) least = l;
        if (r < heap.length && before(heap[r]!, heap[least]!)) least = r;
        if (least === at) return;
        [heap[at], heap[least]] = [heap[least]!, heap[at]!];
        at = least;
      }
    };
    for (let i = (heap.length >> 1) - 1; i >= 0; i--) siftDown(i);

    const writer = typeof sink === "function"
      ? new Beast2ElementWriter(typeValue, sink, writerOptions)
      : new Beast2ManifestWriter(typeValue, sink, writerOptions);
    let entries = 0;
    let folds = 0;
    // The current key's entry is held until a greater key arrives, so every
    // equal key folds into it before it is written.
    let held: { key: unknown; value: unknown } | null = null;
    while (heap.length > 0) {
      const i = heap[0]!;
      const { key, value } = heads[i]!;
      if (held !== null && cmp(held.key, key) === 0) {
        if (merge !== undefined) {
          held.value = merge(key, held.value, value);
        } else if (!union) {
          const noun = dict ? "Dict" : "Set";
          const part = dict ? "key" : "element";
          throw new Error(`beast2 v5: duplicate ${noun} ${part} emitted: ${printKey(key)} — ${noun} ${part}s must be unique`);
        }
        folds++;
      } else {
        if (held !== null) {
          writer.add(dict ? [held.key, held.value] : held.key);
          entries++;
        }
        held = { key, value };
      }
      advance(i);
      if (heads[i] === null) {
        heap[0] = heap[heap.length - 1]!;
        heap.pop();
      }
      if (heap.length > 0) siftDown(0);
    }
    if (held !== null) {
      writer.add(dict ? [held.key, held.value] : held.key);
      entries++;
    }
    writer.finish();
    return { inputs: iterators.length, entries, folds };
  };
}
