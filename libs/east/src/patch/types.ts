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
// Helper functions
// ============================================================================


/**
 * Compute the Longest Common Subsequence of two arrays.
 * @internal
 */
export function computeLCS<T>(
  before: T[],
  after: T[],
  equal: (a: T, b: T) => boolean
): { beforeIndices: number[]; afterIndices: number[] } {
  const m = before.length;
  const n = after.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (equal(before[i - 1]!, after[j - 1]!)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const beforeIndices: number[] = [];
  const afterIndices: number[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (equal(before[i - 1]!, after[j - 1]!)) {
      beforeIndices.unshift(i - 1);
      afterIndices.unshift(j - 1);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return { beforeIndices, afterIndices };
}
