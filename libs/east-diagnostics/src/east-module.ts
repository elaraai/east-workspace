/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The slice of `@elaraai/east` the type-diff rewrite needs: the diff/render
 * entry points plus the type constructors the reifier builds with (so the
 * resulting types are interned and carry type ids, which `diffTypes` relies on).
 */
export interface EastModule {
  diffTypes(actual: unknown, expected: unknown, options?: { maxDiffs?: number }): unknown[];
  renderTypeDiff(diffs: readonly unknown[], options?: { maxShown?: number; maxDepth?: number; maxMembers?: number }): string;
  NeverType: unknown;
  NullType: unknown;
  BooleanType: unknown;
  IntegerType: unknown;
  FloatType: unknown;
  StringType: unknown;
  DateTimeType: unknown;
  BlobType: unknown;
  RefType(value: unknown): unknown;
  ArrayType(value: unknown): unknown;
  SetType(key: unknown): unknown;
  DictType(key: unknown, value: unknown): unknown;
  VectorType(element: unknown): unknown;
  MatrixType(element: unknown): unknown;
  StructType(fields: Record<string, unknown>): unknown;
  VariantType(cases: Record<string, unknown>): unknown;
  FunctionType(inputs: unknown[], output: unknown): unknown;
  AsyncFunctionType(inputs: unknown[], output: unknown): unknown;
  RecursiveType(f: (self: unknown) => unknown): unknown;
  /** Least upper bound of two types; throws when none exists. */
  TypeUnion(t1: unknown, t2: unknown): unknown;
}

// `null` = resolution failed (don't retry every diagnose); absent = not tried.
const cache = new Map<string, EastModule | null>();
const pendingImports = new Set<string>();

function validate(candidate: unknown): EastModule | null {
  const m = candidate as Record<string, unknown> | undefined;
  const mod = (typeof m?.["diffTypes"] === "function" ? m : (m?.["default"] as Record<string, unknown> | undefined)) ?? undefined;
  if (mod === undefined) return null;
  const fns = ["diffTypes", "renderTypeDiff", "StructType", "VariantType", "ArrayType", "RecursiveType", "FunctionType", "TypeUnion"];
  for (const f of fns) if (typeof mod[f] !== "function") return null;
  if (mod["IntegerType"] === undefined) return null;
  return mod as unknown as EastModule;
}

/**
 * Resolve the *project's* own `@elaraai/east` from `projectDir`, mirroring how
 * the service loads the project's `typescript`. Synchronous `require` is tried
 * first (Node >= 22.12 can require ESM); if that fails a background dynamic
 * import fills the cache so a later diagnose picks it up. Returns `undefined`
 * while unavailable — callers simply skip the rewrite.
 */
export function getEastModule(projectDir: string): EastModule | undefined {
  const cached = cache.get(projectDir);
  if (cached !== undefined) return cached ?? undefined;

  const require_ = createRequire(join(projectDir, "_.js"));
  let entry: string;
  try {
    entry = require_.resolve("@elaraai/east");
  } catch {
    cache.set(projectDir, null);
    return undefined;
  }

  try {
    const mod = validate(require_(entry));
    cache.set(projectDir, mod);
    return mod ?? undefined;
  } catch {
    if (!pendingImports.has(projectDir)) {
      pendingImports.add(projectDir);
      import(pathToFileURL(entry).href).then(
        (m) => cache.set(projectDir, validate(m)),
        () => cache.set(projectDir, null),
      );
    }
    return undefined;
  }
}
