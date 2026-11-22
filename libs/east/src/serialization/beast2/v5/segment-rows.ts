/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * BEAST2 v5: a segment's rows, read from its bytes one at a time.
 *
 * A whole decode builds every row of a segment to give one of them. In a
 * self-contained blob — every writer's default — aliasing is scoped to a root
 * element, so a row's bytes decode alone, and all a reader needs is where each
 * row starts. {@link beast2SegmentRowsFor} walks a segment once, parsing past
 * each row's value without building it (`project.ts`'s skipper) and noting
 * where the row starts; what it gives then decodes any row, or a Dict's key at
 * a row, from the segment's bytes when it is asked for. So a search of a
 * segment's keys, or a read of a few of its rows, costs the walk and those
 * rows, and what is kept between reads is the segment's bytes, not every row
 * built.
 *
 * The walk holds a segment's keys to what a whole decode holds them to — a
 * Dict's keys decode and are checked to ascend, and its last key to fall
 * before the next segment's fence — and its rows to one thing more, which is
 * what lets a row decode alone: every reference a row holds names a container
 * of that row. A value is checked where it is decoded: what a whole decode
 * refuses of one — a Dict inside it whose keys do not ascend — a read of that
 * row refuses, and the rows beside it read.
 *
 * A Set's rows are its keys, and a value that holds a function cannot be
 * parsed past: those segments are decoded whole, and read through the same
 * interface.
 *
 * @packageDocumentation
 */

import type { EastTypeValue } from "../../../type_of_type.js";
import type { EastType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import type { BufferReader } from "../../binary-utils.js";
import { asTypeValue } from "./type-section.js";
import { buildV5Decoder, isSegmentedRoot, type V5DecodeContext, type V5Decoder } from "./codec.js";
import { buildSkipper, type Skipper } from "./project.js";
import { decodedWeightFor } from "./weight.js";
import type { Beast2Pages, SegmentDecoder } from "./stream.js";

/**
 * One segment's rows, each read when it is asked for.
 *
 * @internal
 */
export interface Beast2SegmentRows {
  /** How many rows it holds: an Array's elements, a Set's, a Dict's pairs. */
  readonly count: number;
  /** What a cache counts it by, in bytes: the segment's logical bytes and
   *  where its rows start, for rows read from its bytes; the decoded weight of
   *  the whole segment (v5/SPEC.md, "The pager's cache"), for one decoded
   *  whole. */
  readonly weight: number;
  /**
   * A Set's element or a Dict's key at a row.
   *
   * @param row - the row, from 0, within the segment
   * @returns the key, decoded as the pager's options say (frozen, or not)
   * @throws {RangeError} When the row is outside the segment.
   * @throws {TypeError} When the root is an Array, whose rows have no keys.
   */
  key(row: number): unknown;
  /**
   * The row as an element of its collection: an Array's element, a Set's, or
   * a Dict's `[key, value]` pair.
   *
   * @param row - the row, from 0, within the segment
   * @returns the element, decoded as the pager's options say (frozen, or not)
   * @throws {RangeError} When the row is outside the segment.
   */
  element(row: number): unknown;
}

/** What a decode says of a Dict's keys that do not ascend. */
const KEYS_DESCEND = "beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)";

function outside(row: number, count: number): RangeError {
  return new RangeError(`beast2 v5: row ${row} is outside a segment of ${count} rows`);
}

/** A segment's rows read from its bytes: where each starts, and the decoders
 *  of one. Every read decodes against a definition table of its own, as a
 *  row's aliasing is scoped, through the one reader and context the walk was
 *  given. */
class RowsOfBytes implements Beast2SegmentRows {
  readonly count: number;
  readonly weight: number;

  constructor(
    private readonly reader: BufferReader,
    private readonly ctx: V5DecodeContext,
    /** Where each row starts, and, last, where the rows end. */
    private readonly offsets: Uint32Array,
    /** A Dict's key decoder; `null` for an Array. */
    private readonly decodeKey: V5Decoder | null,
    /** An Array's element decoder, or a Dict's value decoder. */
    private readonly decodeValue: V5Decoder,
  ) {
    this.count = offsets.length - 1;
    this.weight = reader.buffer.byteLength + offsets.byteLength;
  }

  /** The reader at a row's first byte, the definition table empty. */
  private at(row: number): BufferReader {
    if (!Number.isInteger(row) || row < 0 || row >= this.count) throw outside(row, this.count);
    this.ctx.containers.length = 0;
    this.reader.offset = this.offsets[row]!;
    return this.reader;
  }

  key(row: number): unknown {
    if (this.decodeKey === null) throw new TypeError(`beast2 v5: an Array's rows have no keys`);
    return this.decodeKey(this.at(row), this.ctx);
  }

  element(row: number): unknown {
    const reader = this.at(row);
    const element = this.decodeKey === null
      ? this.decodeValue(reader, this.ctx)
      : [this.decodeKey(reader, this.ctx), this.decodeValue(reader, this.ctx)];
    if (reader.offset !== this.offsets[row + 1]) {
      throw new Error(`beast2 v5: row ${row} decodes to ${reader.offset - this.offsets[row]!} bytes where the segment holds ${this.offsets[row + 1]! - this.offsets[row]!} for it`);
    }
    return element;
  }
}

/** A segment decoded whole, read as rows: a Set's, or one whose values cannot
 *  be parsed past. */
class RowsDecoded implements Beast2SegmentRows {
  readonly count: number;

  constructor(
    /** A Set's elements or a Dict's keys; `null` for an Array. */
    private readonly keys: readonly unknown[] | null,
    /** An Array's elements or a Dict's values; `null` for a Set. */
    private readonly values: readonly unknown[] | null,
    readonly weight: number,
  ) {
    this.count = (keys ?? values!).length;
  }

  private checked(row: number): number {
    if (!Number.isInteger(row) || row < 0 || row >= this.count) throw outside(row, this.count);
    return row;
  }

  key(row: number): unknown {
    if (this.keys === null) throw new TypeError(`beast2 v5: an Array's rows have no keys`);
    return this.keys[this.checked(row)];
  }

  element(row: number): unknown {
    const at = this.checked(row);
    if (this.keys === null) return this.values![at];
    return this.values === null ? this.keys[at] : [this.keys[at], this.values[at]];
  }
}

/**
 * The segment decoder that walks an Array's or a Dict's segment once and
 * gives its rows to read from its bytes ({@link Beast2SegmentRows}): what
 * {@link beast2SegmentRowsFor} hands the pager.
 *
 * The walk parses past every value, building none. A Dict's keys decode, and
 * are checked to ascend as a whole decode checks them. Each row is walked
 * against a definition table of its own, so a reference that names a
 * container of another row is out of range, and refused: such a row could not
 * decode alone.
 *
 * @param wire - the root type the bytes hold: an Array or a Dict
 * @returns the decoder of a segment's `n` rows
 * @throws {TypeError} When the root is a Set, whose rows are its keys, or its
 *   rows hold a function, which cannot be parsed past.
 * @internal
 */
export function buildSegmentRowsDecoder(wire: EastTypeValue): SegmentDecoder {
  if (wire.type === "Array") {
    const type = wire.value as EastTypeValue;
    const skipElement = buildSkipper(type, new Map());
    const element = buildV5Decoder(type);
    return (reader, ctx, n) => {
      const offsets = new Uint32Array(n + 1);
      for (let i = 0; i < n; i++) {
        offsets[i] = reader.offset;
        ctx.containers.length = 0;
        skipElement(reader, ctx);
      }
      offsets[n] = reader.offset;
      return new RowsOfBytes(reader, ctx, offsets, null, element);
    };
  }
  if (wire.type === "Dict") {
    const dict = wire.value as { key: EastTypeValue; value: EastTypeValue };
    const skipValue: Skipper = buildSkipper(dict.value, new Map());
    const typeCtx = new Map<bigint, V5Decoder>();
    const key = buildV5Decoder(dict.key, typeCtx);
    const value = buildV5Decoder(dict.value, typeCtx);
    const cmp = compareFor(dict.key);
    return (reader, ctx, n, order) => {
      const offsets = new Uint32Array(n + 1);
      for (let i = 0; i < n; i++) {
        offsets[i] = reader.offset;
        ctx.containers.length = 0;
        const k = key(reader, ctx);
        if (order) {
          if (order.has && cmp(order.prev, k) >= 0) throw new Error(KEYS_DESCEND);
          order.prev = k;
          order.has = true;
        }
        skipValue(reader, ctx);
      }
      offsets[n] = reader.offset;
      return new RowsOfBytes(reader, ctx, offsets, key, value);
    };
  }
  throw new TypeError(`beast2 v5: a segment's rows are read from the bytes of an Array or a Dict, not a ${wire.type}`);
}

/**
 * Builds the reader of a collection's segments as rows read one at a time:
 * for a pager over the collection's bytes and a segment's index, the
 * segment's {@link Beast2SegmentRows}.
 *
 * An Array's or a Dict's segment is walked once — a Dict's keys decoded and
 * checked to ascend, its fences and its last key checked as
 * {@link Beast2Pages.segmentDisjoint} checks them, every value parsed past —
 * and each row is then decoded from the segment's bytes when it is asked for,
 * as the pager's options say (frozen, or not). A Set's segment, and one whose
 * rows hold a function, is decoded whole and read through the same interface.
 * Nothing is cached here: the caller keeps what it is given.
 *
 * @param type - the collection type (Array/Set/Dict) the pagers are over
 * @returns the reader of one segment of a pager's
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 *
 * @example
 * ```ts
 * const type = DictType(StringType, StructType({ total: FloatType, notes: StringType }));
 * const rowsOf = beast2SegmentRowsFor(type);
 * const rows = rowsOf(openBeast2PagesFor(type, { frozen: true })(bytes), 0);
 * rows.key(3);      // the fourth key: no value built
 * rows.element(3);  // [key, value]: that row's alone
 * ```
 * @internal
 */
export function beast2SegmentRowsFor(type: EastType | EastTypeValue): (pages: Beast2Pages, i: number) => Beast2SegmentRows {
  const typeValue = asTypeValue(type);
  if (!isSegmentedRoot(typeValue)) {
    throw new TypeError(`beast2 v5: a segment's rows are an Array's, a Set's or a Dict's, not a ${typeValue.type}'s`);
  }
  const kind = typeValue.type;
  let walk: SegmentDecoder | null = null;
  if (kind !== "Set") {
    try {
      walk = buildSegmentRowsDecoder(typeValue);
    } catch (err) {
      // Rows that hold a function cannot be parsed past: decode whole.
      if (!(err instanceof TypeError)) throw err;
    }
  }
  if (walk !== null) {
    const decoder = walk;
    return (pages, i) => pages.segmentProjected(i, decoder) as unknown as Beast2SegmentRows;
  }
  const weigh = decodedWeightFor(typeValue);
  return (pages, i) => {
    if (kind === "Array") {
      const items = pages.segment(i) as unknown as readonly unknown[];
      return new RowsDecoded(null, items, weigh(items));
    }
    const value = pages.segmentDisjoint(i) as unknown;
    if (kind === "Set") {
      const keys = [...(value as ReadonlySet<unknown>)];
      return new RowsDecoded(keys, null, weigh(value) + 8 * keys.length);
    }
    const map = value as ReadonlyMap<unknown, unknown>;
    const keys: unknown[] = new Array(map.size);
    const values: unknown[] = new Array(map.size);
    let at = 0;
    for (const [k, v] of map) {
      keys[at] = k;
      values[at] = v;
      at++;
    }
    // The arrays the rows are read from cost a reference an element beside the value.
    return new RowsDecoded(keys, values, weigh(value) + 8 * (keys.length + values.length));
  };
}
