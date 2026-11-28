/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the specs of segmented collections draw their blobs from: a collection's
 * rows cut into segments by hand, a table of numbered rows, and a row of random
 * fields.
 */

import { compareFor } from "../../../comparison.js";
import { SortedMap } from "../../../containers/sortedmap.js";
import { IntegerType, StructType, type EastType } from "../../../types.js";
import { randomType } from "../../../fuzz.js";
import { encodeBeast2SegmentsFor, type Beast2Codec } from "../index.js";

/**
 * A collection's rows cut into segments of `per`: a geometry a spec chooses,
 * where the cut rule would hold a small value in one segment.
 *
 * @param type - the collection's type
 * @param rows - its rows, in canonical order: an Array's elements, a Set's, a Dict's `[key, value]` pairs
 * @param per - the rows a segment holds
 * @param codec - the frames' codec; the writer's own without it
 * @returns the collection's bytes
 */
export function segmented(type: EastType, rows: readonly unknown[], per: number, codec?: Beast2Codec): Uint8Array {
  const batches: unknown[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    batches.push(type.type === "Dict" ? new Map(chunk as [unknown, unknown][]) : type.type === "Set" ? new Set(chunk) : chunk);
  }
  return encodeBeast2SegmentsFor(type, codec === undefined ? undefined : { codec })(batches as never);
}

/**
 * A canonical Dict of `n` rows, keyed `offset` to `offset + n - 1`, each its
 * key and `row-<key>`.
 *
 * @param n - how many rows
 * @param offset - the first row's key
 * @returns the table
 */
export function makeTable(n: number, offset = 0): SortedMap<bigint, { id: bigint; name: string }> {
  const entries: [bigint, { id: bigint; name: string }][] = [];
  for (let i = 0; i < n; i++) {
    const id = BigInt(i + offset);
    entries.push([id, { id, name: `row-${i + offset}` }]);
  }
  return new SortedMap(entries, compareFor(IntegerType));
}

/**
 * A row of 1 to 6 random fields, nested recursion included.
 *
 * @param draw - the stream the field count is drawn from
 * @returns the row's type
 */
export function randomRow(draw: () => number): EastType {
  const fields: Record<string, EastType> = {};
  const n = 1 + Math.floor(draw() * 6);
  for (let i = 0; i < n; i++) {
    fields[`f${i}`] = randomType(1, { includeRecursive: false, includeFunctions: false, nestedRecursive: true });
  }
  return StructType(fields);
}
