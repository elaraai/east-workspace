/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sorted runs — a Set's or Dict's elements in any order in, sorted canonical
 * collections out.
 *
 * A producer that cannot hand its keys over in order — a re-key, an index built
 * in another order than its source's — gives them to a
 * {@link Beast2RunSorter}. It holds them encoded, with aliasing scoped to each
 * element as every writer scopes it, and once it holds {@link RUN_MAX_COUNT} of
 * them or {@link RUN_MAX_BYTES} of their bytes it sorts them, folds the keys
 * that repeat, and writes them out as one run: the canonical blob of the run's
 * value, cut by the content-defined rule like every other. The runs are merged
 * afterwards (`mergeBeast2For`), a key range at a time if need be, and a key
 * that repeats across runs folds there, in run order.
 *
 * The caps are platform constants, not settings. Where a run closes decides how
 * a repeated key's values group before they fold, which for a fold over floats
 * decides the output's bytes; and both caps count what every runtime measures
 * alike — elements, and the bytes of their canonical encoding — so every
 * runtime closes a run at the same element.
 */

import { type EastTypeValue } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { printFor } from "../../east.js";
import { compareFor } from "../../../comparison.js";
import { BufferWriter } from "../../binary-utils.js";
import { asTypeValue } from "./type-section.js";
import { type V5EncodeContext, buildV5Encoder, createV5EncodeContext } from "./codec.js";
import { Beast2ElementWriter, type Beast2ElementOf, type Beast2ElementWriterOptions } from "./stream.js";
import { decodeBeast2FenceFor } from "./boundary.js";

/** Elements a run holds before it closes (pairs, for a Dict). */
export const RUN_MAX_COUNT = 131_072;

/** Bytes of canonical element encoding — keys and values both — a run holds
 *  before it closes. */
export const RUN_MAX_BYTES = 64 * 1024 * 1024;

/** Where a {@link Beast2RunSorter} writes one run. */
export interface Beast2RunSink {
  /**
   * Receives the run's bytes, in order.
   *
   * @param bytes - the next bytes of the run's blob
   */
  write(bytes: Uint8Array): void;
  /** Called after the run's last bytes: the blob is complete. */
  close(): void;
}

/** Options accepted by {@link Beast2RunSorter}. */
export type Beast2RunSorterOptions = Omit<Beast2ElementWriterOptions, "headerPrefix"> & {
  /**
   * Dict roots: how a key added more than once folds, `acc = merge(key, acc,
   * value)`, in the order its values were added. Without it such a key is
   * refused. A key's values fold within each run before the runs merge, so the
   * function must be associative.
   */
  merge?: (key: any, acc: any, value: any) => any;
  /** Set roots: an element added more than once is kept once. Without it such
   *  an element is refused. */
  union?: boolean;
};

/**
 * Sorts a Set's or Dict's elements, given in any order, into sorted canonical
 * runs.
 *
 * Each element is encoded as it is added, so what the sorter holds is bounded
 * by bytes rather than by what the elements decode to. When a run closes its
 * elements sort by key, stably — so a key's values stay in the order they were
 * added — and each run is written through {@link Beast2ElementWriter}, as the
 * bytes a writer of the run's value writes. Runs are numbered from zero in the
 * order they close; a key that repeats across runs is the merge's to fold.
 *
 * @example
 * ```ts
 * const type = DictType(StringType, IntegerType);
 * const runs: Uint8Array[][] = [];
 * const sorter = new Beast2RunSorter(type, () => {
 *   const chunks: Uint8Array[] = [];
 *   runs.push(chunks);
 *   return { write: (bytes) => chunks.push(bytes), close: () => {} };
 * }, { merge: (_key, acc, value) => acc + value });
 * sorter.add(["b", 1n]);
 * sorter.add(["a", 2n]);
 * sorter.add(["b", 3n]);
 * sorter.finish();
 * decodeBeast2For(type)(Buffer.concat(runs[0]!));  // Map { "a" => 2n, "b" => 4n }
 * ```
 */
export class Beast2RunSorter<T extends EastType = EastType> {
  private readonly typeValue: EastTypeValue;
  private readonly kind: "Set" | "Dict";
  private readonly openRun: (run: number) => Beast2RunSink;
  private readonly writerOptions: Beast2ElementWriterOptions;
  private readonly merge: ((key: any, acc: any, value: any) => any) | null;
  private readonly union: boolean;
  private readonly cmp: (a: unknown, b: unknown) => number;
  private readonly printKey: (key: unknown) => string;
  private readonly ctx: V5EncodeContext;
  /** Encodes one element at the end of the writer and returns the length of
   *  its key: a Set element's whole length, a Dict pair's key. */
  private readonly encodeElement: (element: unknown, writer: BufferWriter) => number;
  private readonly encodeValue: ((value: unknown, writer: BufferWriter, ctx: V5EncodeContext) => void) | null;
  private readonly decodeValue: ((bytes: Uint8Array) => unknown) | null;
  /** The open run's elements, back to back. */
  private readonly buffer = new BufferWriter();
  /** A folded element, while it is assembled. */
  private readonly folded = new BufferWriter();
  private starts: number[] = [];
  private keyLengths: number[] = [];
  private keys: unknown[] = [];
  private written = 0;
  private finished = false;

  /**
   * @param type - the collection type the runs hold (Set or Dict)
   * @param openRun - opens the sink for run `run`
   * @param options - the fold, and the runs' codec, source map and parallel
   *   framing
   * @throws {TypeError} When `type` is not a Set or Dict type, or the fold does
   *   not fit it: a merge function folds a Dict, union a Set.
   */
  constructor(type: T | EastTypeValue, openRun: (run: number) => Beast2RunSink, options?: Beast2RunSorterOptions) {
    const typeValue = asTypeValue(type);
    if (typeValue.type !== "Set" && typeValue.type !== "Dict") {
      throw new TypeError(`beast2 v5: sorted runs hold Set or Dict values, not ${typeValue.type} — an Array keeps the order it is written in`);
    }
    const { merge, union, ...writerOptions } = options ?? {};
    if (merge !== undefined && typeValue.type !== "Dict") {
      throw new TypeError(`beast2 v5: a merge function folds a Dict's values; a Set's equal elements collapse under union`);
    }
    if (union && typeValue.type !== "Set") {
      throw new TypeError(`beast2 v5: union collapses a Set's equal elements; a Dict's values fold with a merge function`);
    }
    this.typeValue = typeValue;
    this.kind = typeValue.type;
    this.openRun = openRun;
    this.writerOptions = writerOptions;
    this.merge = merge ?? null;
    this.union = union ?? false;
    this.ctx = createV5EncodeContext(writerOptions.sourceMap ?? null, true);
    this.ctx.containerCount = 1;

    const typeCtx = new Map<bigint, any>();
    if (typeValue.type === "Dict") {
      const dict = (typeValue as { value: { key: EastTypeValue; value: EastTypeValue } }).value;
      const key = buildV5Encoder(dict.key, typeCtx);
      const value = buildV5Encoder(dict.value, typeCtx);
      this.encodeElement = (element, writer) => {
        const start = writer.size;
        key((element as [unknown, unknown])[0], writer, this.ctx);
        const keyLength = writer.size - start;
        value((element as [unknown, unknown])[1], writer, this.ctx);
        return keyLength;
      };
      this.encodeValue = value;
      this.decodeValue = merge !== undefined ? decodeBeast2FenceFor(dict.value) : null;
      this.cmp = compareFor(dict.key) as (a: unknown, b: unknown) => number;
      this.printKey = printFor(dict.key);
    } else {
      const elementType = (typeValue as { value: EastTypeValue }).value;
      const elem = buildV5Encoder(elementType, typeCtx);
      this.encodeElement = (element, writer) => {
        const start = writer.size;
        elem(element, writer, this.ctx);
        return writer.size - start;
      };
      this.encodeValue = null;
      this.decodeValue = null;
      this.cmp = compareFor(elementType) as (a: unknown, b: unknown) => number;
      this.printKey = printFor(elementType);
    }
  }

  /** Runs written so far. The open run is not among them until a cap or
   *  {@link finish} closes it. */
  get runs(): number {
    return this.written;
  }

  /**
   * Encodes one element and adds it to the open run, which is written out once
   * it reaches {@link RUN_MAX_COUNT} elements or {@link RUN_MAX_BYTES}.
   *
   * @param element - a Set element, or a Dict's `[key, value]` pair
   * @throws {Error} When called after {@link finish}; when the element cannot
   *   be encoded, which leaves the sorter as it was; or, as the run it closes is
   *   written, when a key repeats without a fold or the merge function throws.
   */
  add(element: Beast2ElementOf<T>): void {
    if (this.finished) throw new Error("add() after finish()");
    const start = this.buffer.size;
    // Aliasing is scoped to the element, so its bytes depend on it alone and
    // it can be written into whichever run it lands in by byte copy.
    this.ctx.containerIndex.clear();
    this.ctx.segmentBaseDef = this.ctx.containerCount;
    let keyLength: number;
    try {
      keyLength = this.encodeElement(element, this.buffer);
    } catch (err) {
      const kept = this.buffer.toUint8Array().slice(0, start);
      this.buffer.pop();
      this.buffer.writeBytes(kept);
      throw err;
    }
    this.starts.push(start);
    this.keyLengths.push(keyLength);
    this.keys.push(this.kind === "Dict" ? (element as [unknown, unknown])[0] : element);
    if (this.keys.length >= RUN_MAX_COUNT || this.buffer.size >= RUN_MAX_BYTES) this.writeRun();
  }

  /**
   * Writes the open run, if it holds anything. Idempotent.
   *
   * @throws {Error} When a key of the open run repeats without a fold, or the
   *   merge function throws.
   */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.keys.length > 0) this.writeRun();
  }

  /** Sorts the open run, folds its repeated keys, and writes it. A failure
   *  leaves the run's sink without its `close` — the run is incomplete. */
  private writeRun(): void {
    const n = this.keys.length;
    const bytes = this.buffer.toUint8Array();
    const { starts, keyLengths, keys } = this;
    const end = (e: number): number => (e + 1 < n ? starts[e + 1]! : bytes.length);
    // Stable by construction: equal keys order by when they were added, which
    // is the order their values fold in.
    const order = Array.from({ length: n }, (_, i) => i);
    order.sort((a, b) => this.cmp(keys[a], keys[b]) || a - b);

    const sink = this.openRun(this.written);
    const writer = new Beast2ElementWriter(this.typeValue, (chunk) => sink.write(chunk), this.writerOptions);
    for (let i = 0; i < n;) {
      const first = order[i]!;
      let j = i + 1;
      while (j < n && this.cmp(keys[first], keys[order[j]!]) === 0) j++;
      if (j - i > 1 && this.merge === null && !this.union) {
        const noun = this.kind === "Dict" ? "Dict" : "Set";
        const part = this.kind === "Dict" ? "key" : "element";
        throw new Error(`beast2 v5: duplicate ${noun} ${part} emitted: ${this.printKey(keys[first])} — ${noun} ${part}s must be unique`);
      }
      if (j - i === 1 || this.merge === null) {
        writer.addEncoded(bytes.subarray(starts[first]!, end(first)), keyLengths[first]!);
      } else {
        const keyLength = keyLengths[first]!;
        let acc = this.decodeValue!(bytes.subarray(starts[first]! + keyLength, end(first)));
        for (let k = i + 1; k < j; k++) {
          const e = order[k]!;
          acc = this.merge(keys[first], acc, this.decodeValue!(bytes.subarray(starts[e]! + keyLengths[e]!, end(e))));
        }
        this.folded.writeBytes(bytes.subarray(starts[first]!, starts[first]! + keyLength));
        this.ctx.containerIndex.clear();
        this.ctx.segmentBaseDef = this.ctx.containerCount;
        this.encodeValue!(acc, this.folded, this.ctx);
        writer.addEncoded(this.folded.toUint8Array(), keyLength);
        this.folded.pop();
      }
      i = j;
    }
    writer.finish();
    sink.close();
    this.written++;
    this.buffer.pop();
    this.starts = [];
    this.keyLengths = [];
    this.keys = [];
  }
}
