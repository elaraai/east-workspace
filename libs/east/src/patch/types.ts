/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared types and context interfaces for the patch system.
 *
 * @module
 */

import type { EastTypeValue } from "../type_of_type.js";
import type {
  EastType,
  NullType,
  NeverType,
  BooleanType,
  IntegerType,
  FloatType,
  StringType,
  DateTimeType,
  BlobType,
  RefType,
  ArrayType,
  SetType,
  DictType,
  StructType,
  VariantType,
  RecursiveType,
} from "../types.js";
import type { variant as VariantValue } from "../containers/variant.js";

// ============================================================================
// Context types for recursive type handling
// ============================================================================

/**
 * Context for building diff handlers with proper recursive type support.
 * Handlers are built in parallel so that when we encounter a `.Recursive n`
 * back-reference, we can look up the appropriate handler from any array.
 */
export interface DiffContext {
  /** Diff handlers: (before, after) => Patch */
  diff: Array<(before: any, after: any) => any>;
  /** Types at each level - used to call equalFor/compareFor on Recursive back-references */
  types: Array<EastTypeValue>;
  /** Equality handlers for recursive types, keyed by type id */
  equal: Map<bigint, (a: any, b: any) => boolean>;
}

/**
 * Context for building apply handlers with proper recursive type support.
 */
export interface ApplyContext {
  /** Apply handlers: (base, patch) => value */
  apply: Array<(base: any, patch: any) => any>;
  /** Types at each level */
  types: Array<EastTypeValue>;
  /** Equality handlers for recursive types, keyed by type id */
  equal: Map<bigint, (a: any, b: any) => boolean>;
  /** Print handlers built in parallel - used for error messages */
  print: Map<bigint, (value: any) => string>;
}

/**
 * Context for building compose handlers with proper recursive type support.
 */
export interface ComposeContext {
  /** Compose handlers: (first, second) => combined patch */
  compose: Array<(first: any, second: any) => any>;
  /** Apply handlers built in parallel - used instead of calling applyFor with fresh context */
  apply: Array<(base: any, patch: any) => any>;
  /** Invert handlers built in parallel - used instead of calling invertFor with fresh context */
  invert: Array<(patch: any) => any>;
  /** Types at each level */
  types: Array<EastTypeValue>;
  /** Equality handlers for recursive types, keyed by type id */
  equal: Map<bigint, (a: any, b: any) => boolean>;
  /** Print handlers built in parallel - used for error messages */
  print: Map<bigint, (value: any) => string>;
}

/**
 * Context for building invert handlers with proper recursive type support.
 */
export interface InvertContext {
  /** Invert handlers: (patch) => inverted patch */
  invert: Array<(patch: any) => any>;
  /** Types at each level */
  types: Array<EastTypeValue>;
  /** Equality handlers for recursive types, keyed by type id */
  equal: Map<bigint, (a: any, b: any) => boolean>;
}

/**
 * A single conflict — two patches against the same base touch the same
 * leaf with different intentions.
 */
export interface Conflict {
  /**
   * Dot/bracket-encoded path from the root of T down to the conflicting
   * leaf. Format:
   *   - struct field: dot-joined name (e.g. `policy.maxWeeklyHours`)
   *   - array element: bracket-suffixed (e.g. `roster[2]`)
   *   - dict entry:    brace-suffixed (e.g. `prices{Cabernet}`)
   *   - variant case:  at-prefixed   (e.g. `status@active`)
   *   - root:          empty string
   */
  path: string;
  /** patchA's intended value at this path (whole patch operation, e.g. `{type:"replace",value:{before,after}}`). */
  valueA: any;
  /** patchB's intended value at this path. */
  valueB: any;
}

/**
 * Per-conflict resolution that the caller supplies to
 * `mergeWithResolutionsFor`. Keys are paths (matching `Conflict.path`).
 */
export type Resolution =
  | { type: "keepA" }
  | { type: "keepB" }
  | { type: "manual"; value: any };

/**
 * Context for building merge handlers with proper recursive type support.
 *
 * Carries only the merge-handler stack + types + equality cache. Unlike
 * `ComposeContext`, merge does NOT need apply/invert handlers — every merge
 * case is either a clean recursive walk over patch shapes, or a conflict that
 * the caller resolves; we never need to apply or invert a sub-patch as part of
 * merging.
 */
export interface MergeContext {
  /** Merge handlers, indexed by type-stack depth. Used for recursive-type
   *  back-references. The signature is the internal walker's; not exposed in
   *  the public API. */
  merge: Array<(
    a: VariantValue<string, any>,
    b: VariantValue<string, any>,
    path: string,
    accConflict: (path: string, vA: any, vB: any) => void,
    lookup: ((path: string) => Resolution | undefined) | null,
  ) => VariantValue<string, any>>;
  /** Types at each level — used to resolve `Recursive n` back-references. */
  types: Array<EastTypeValue>;
  /** Equality handlers for recursive types, keyed by type id. Threaded
   *  into every nested `equalFor(...)` call. */
  equal: Map<bigint, (a: any, b: any) => boolean>;
}

// ============================================================================
// Type-level PatchType (for TypeScript inference)
// ============================================================================

/** Type-level computation of the patch type for a given East type. */
export type PatchTypeOf<T extends EastType> =
  T extends NeverType | NullType | BooleanType | IntegerType | FloatType | StringType | DateTimeType | BlobType | import("../types.js").VectorType<any> | import("../types.js").MatrixType<any>
    ? VariantType<{ unchanged: NullType; replace: StructType<{ before: T; after: T }> }>
  : T extends RefType<infer V extends EastType>
    ? VariantType<{ unchanged: NullType; replace: StructType<{ before: T; after: T }>; patch: PatchTypeOf<V> }>
  : T extends ArrayType<infer E extends EastType>
    ? VariantType<{
        unchanged: NullType;
        replace: StructType<{ before: T; after: T }>;
        patch: ArrayType<StructType<{
          key: IntegerType;
          offset: IntegerType;
          operation: VariantType<{ delete: E; insert: E; update: PatchTypeOf<E> }>;
        }>>;
      }>
  : T extends SetType<infer K>
    ? VariantType<{
        unchanged: NullType;
        replace: StructType<{ before: T; after: T }>;
        patch: DictType<K, VariantType<{ delete: NullType; insert: NullType }>>;
      }>
  : T extends DictType<infer K, infer V extends EastType>
    ? VariantType<{
        unchanged: NullType;
        replace: StructType<{ before: T; after: T }>;
        patch: DictType<K, VariantType<{ delete: V; insert: V; update: PatchTypeOf<V> }>>;
      }>
  : T extends StructType<infer Fields>
    ? VariantType<{
        unchanged: NullType;
        replace: StructType<{ before: T; after: T }>;
        patch: StructType<{ [K in keyof Fields]: Fields[K] extends EastType ? PatchTypeOf<Fields[K]> : never }>;
      }>
  : T extends VariantType<infer Cases>
    ? VariantType<{
        unchanged: NullType;
        replace: StructType<{ before: T; after: T }>;
        patch: VariantType<{ [K in keyof Cases]: Cases[K] extends EastType ? PatchTypeOf<Cases[K]> : never }>;
      }>
  : T extends RecursiveType<infer _Node extends EastType>
    ? VariantType<{
        unchanged: NullType;
        replace: StructType<{ before: T; after: T }>;
        // RecursiveType uses replace-only semantics (no patch case)
      }>
  : VariantType<{ unchanged: NullType; replace: StructType<{ before: T; after: T }> }>;

/**
 * Error thrown when patch operations encounter conflicts.
 *
 * For merge operations, the `conflicts` field lists every detected conflict
 * with its path and the two divergent patch arms. The caller decides how to
 * format / render this information.
 */
export class ConflictError extends Error {
  /** Detailed conflict list (only populated by merge / merge-with-resolutions). */
  readonly conflicts: ReadonlyArray<Conflict>;

  constructor(message: string, conflicts: ReadonlyArray<Conflict> = []) {
    super(message);
    this.name = "ConflictError";
    this.conflicts = conflicts;
  }
}

// ============================================================================
// Array alignment
// ============================================================================

/**
 * The comparisons an Array diff's search of its middle may spend: the search
 * stops at ⌊ARRAY_DIFF_BUDGET / (m′ + n′)⌋ edits.
 *
 * @remarks
 * east-c's `ARRAY_DIFF_BUDGET` (`builtins/patch.c`) is the same number, so the
 * two runtimes stop at the same bound and keep the same pairs.
 * @internal
 */
export const ARRAY_DIFF_BUDGET = 2 ** 24;

/**
 * The pairs of positions an Array diff keeps from `before` and `after`.
 *
 * @remarks
 * The common start and end are kept whole. The matches are the middle's, in
 * ascending order: `before[beforeIndices[i]]` is kept as
 * `after[afterIndices[i]]`.
 * @internal
 */
export interface ArrayAlignment {
  /** The leading positions equal in both arrays, kept as they are. */
  start: number;
  /** The trailing positions equal in both, after `start`, kept as they are. */
  end: number;
  /** The middle's matched positions in `before`, ascending. */
  beforeIndices: number[];
  /** The middle's matched positions in `after`, ascending, pairwise with `beforeIndices`. */
  afterIndices: number[];
}

/**
 * Aligns two arrays: finds the pairs of positions their diff keeps.
 *
 * @remarks
 * Trims the longest common start, then the longest common end of what it
 * leaves, so the two never overlap. Over the middle between them, of m′ and
 * n′ elements, finds a shortest edit script by Myers' greedy forward
 * algorithm, to at most min(m′ + n′, ⌊{@link ARRAY_DIFF_BUDGET} / (m′ + n′)⌋)
 * edits; when no script within that bound exists, pairs the middle by
 * position, a pair whose two elements are equal being a match. The search
 * compares each cell of the middle at most once, so the whole alignment makes
 * at most 2^24 + m + n + 2 comparisons, and its trace holds at most 8,394,753
 * entries. east-c's `align_arrays` takes the same steps, so the two runtimes
 * keep the same pairs and give the same patch (#1425).
 *
 * @typeParam T - The arrays' element values
 * @param before - The array the diff starts from
 * @param after - The array it ends at
 * @param equal - The element equality the diff uses
 * @returns The common start and end, and the middle's matches
 * @internal
 */
export function alignArrays<T>(
  before: readonly T[],
  after: readonly T[],
  equal: (a: T, b: T) => boolean
): ArrayAlignment {
  const m = before.length;
  const n = after.length;

  let start = 0;
  while (start < m && start < n && equal(before[start]!, after[start]!)) {
    start++;
  }
  let end = 0;
  while (end < m - start && end < n - start && equal(before[m - 1 - end]!, after[n - 1 - end]!)) {
    end++;
  }

  const width = m - start - end;
  const height = n - start - end;
  if (width === 0 || height === 0) {
    // Nothing in the middle matches: the other side is deleted or inserted whole.
    return { start, end, beforeIndices: [], afterIndices: [] };
  }

  const total = width + height;
  const bound = Math.min(total, Math.floor(ARRAY_DIFF_BUDGET / total));
  const script = shortestScript(before, after, start, width, height, bound, equal);
  if (script !== null) {
    return { start, end, beforeIndices: script.beforeIndices, afterIndices: script.afterIndices };
  }

  // Past the bound: the middle's k-th element of `before` with its k-th of `after`.
  const beforeIndices: number[] = [];
  const afterIndices: number[] = [];
  const shorter = Math.min(width, height);
  for (let k = 0; k < shorter; k++) {
    if (equal(before[start + k]!, after[start + k]!)) {
      beforeIndices.push(start + k);
      afterIndices.push(start + k);
    }
  }
  return { start, end, beforeIndices, afterIndices };
}

/** The entries a search's trace holds up to step `d`: d+1 at each step. */
function traceEntries(d: number): number {
  return ((d + 1) * (d + 2)) / 2;
}

/**
 * Finds a shortest edit script over the middle of two arrays, by Myers' greedy
 * forward algorithm, to at most `bound` edits.
 *
 * @remarks
 * The middle is `before[offset … offset+width)` and `after[offset … offset+height)`.
 * A point (x, y) has passed over the first x elements of the one and the
 * first y of the other, on diagonal k = x − y; a move right deletes an
 * element of `before`, a move down inserts one of `after`, and a run along the
 * diagonal keeps each pair of equal elements. `v[k]` is the furthest x reached
 * on diagonal k. At each step d, diagonal k is reached down from k+1 when
 * k = −d, or when k ≠ d and v[k−1] < v[k+1], and right from k−1 otherwise — the
 * move that reaches further, and the insert where both reach as far — then
 * runs on while its elements are equal. `v` keeps x as computed, even past the
 * middle's edge; only cells inside it are compared. Each step's d+1 values are
 * kept in the trace, which the walk back reads.
 *
 * Every value fits 32 bits: a bound of 1 or more means a middle of at most
 * 2^24 elements, and with a bound of 0 the one step compares the middle's
 * first two elements, which the trim left unequal.
 *
 * @returns The matches, as positions in `before` and `after`, or `null` when no
 *   script of `bound` edits or fewer exists
 */
function shortestScript<T>(
  before: readonly T[],
  after: readonly T[],
  offset: number,
  width: number,
  height: number,
  bound: number,
  equal: (a: T, b: T) => boolean
): { beforeIndices: number[]; afterIndices: number[] } | null {
  const center = bound + 1;
  // v[center + 1], diagonal 1, starts at 0: the first step's move down from it
  // starts the search at (0, 0).
  const v = new Int32Array(2 * bound + 3);
  const capacity = traceEntries(bound);
  let trace = new Int32Array(Math.min(capacity, 1024));

  for (let d = 0; d <= bound; d++) {
    const row = traceEntries(d - 1);
    if (row + d + 1 > trace.length) {
      const grown = new Int32Array(Math.min(capacity, Math.max(2 * trace.length, row + d + 1)));
      grown.set(trace);
      trace = grown;
    }
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[center + k - 1]! < v[center + k + 1]!)
        ? v[center + k + 1]!
        : v[center + k - 1]! + 1;
      let y = x - k;
      while (x < width && y < height && equal(before[offset + x]!, after[offset + y]!)) {
        x++;
        y++;
      }
      v[center + k] = x;
      trace[row + ((k + d) >> 1)] = x;
      if (x >= width && y >= height) {
        return walkBack(trace, d, width, height, offset);
      }
    }
  }
  return null;
}

/**
 * Reads a shortest script's matches off a search's trace, walking back from the
 * end of the middle.
 *
 * @remarks
 * At step d the move is recomputed from step d−1's values by the search's own
 * rule; the run between where the move landed and the current point is
 * matches, and the walk goes on from the move's start. The run from (0, 0) is
 * the last. The (width + height − steps) / 2 matches are written from the end.
 *
 * @returns The matches, as positions in `before` and `after`, ascending
 */
function walkBack(
  trace: Int32Array,
  steps: number,
  width: number,
  height: number,
  offset: number
): { beforeIndices: number[]; afterIndices: number[] } {
  const count = (width + height - steps) / 2;
  const beforeIndices = new Array<number>(count);
  const afterIndices = new Array<number>(count);
  let i = count;
  let x = width;
  let y = height;

  for (let d = steps; d > 0; d--) {
    const k = x - y;
    const row = traceEntries(d - 2);
    const reached = (diagonal: number): number => trace[row + ((diagonal + d - 1) >> 1)]!;
    const down = k === -d || (k !== d && reached(k - 1) < reached(k + 1));
    const from = down ? k + 1 : k - 1;
    const fromX = reached(from);
    const landedX = down ? fromX : fromX + 1;
    while (x > landedX) {
      x--;
      y--;
      i--;
      beforeIndices[i] = offset + x;
      afterIndices[i] = offset + y;
    }
    x = fromX;
    y = fromX - from;
  }
  while (x > 0) {
    x--;
    y--;
    i--;
    beforeIndices[i] = offset + x;
    afterIndices[i] = offset + y;
  }
  return { beforeIndices, afterIndices };
}
