/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { type EastType, TypeMismatchError } from "./types.js";
import { type EastTypeValue, toEastTypeValue, isTypeValueEqual, isSubtypeValue } from "./type_of_type.js";
import { get_current_source_map, type Location } from "./location.js";

/**
 * One step from a root type down to the location of a {@link TypeDiff}.
 *
 * @remarks
 * A path is read left-to-right from the root. {@link renderTypePath} turns a
 * path into a string like `.binding.patch` or `.write(arg 0)`.
 */
export type TypePathSegment =
  /** Into struct field `name`. */
  | { readonly kind: "field"; readonly name: string }
  /** Into the payload of variant case `name`. */
  | { readonly kind: "case"; readonly name: string }
  /** Into the element of an `Array` / `Set` / `Vector` / `Matrix`. */
  | { readonly kind: "element" }
  /** Into the key of a `Dict`. */
  | { readonly kind: "key" }
  /** Into the value of a `Dict` or the referent of a `Ref`. */
  | { readonly kind: "value" }
  /** Into the function input at position `index`. */
  | { readonly kind: "input"; readonly index: number }
  /** Into the function output. */
  | { readonly kind: "output" };

/** A location inside a type, as a sequence of {@link TypePathSegment}s from the root. */
export type TypePath = readonly TypePathSegment[];

/**
 * A single point of incompatibility between an `actual` and an `expected` type.
 *
 * @remarks
 * Produced by {@link diffTypes} / {@link diffTypeValues}. Every record carries
 * the {@link TypePath} where the incompatibility was found and the two subtypes
 * at that location. The `kind` discriminant determines how `actual`/`expected`
 * should be read — for the structural kinds they carry the field/case type that
 * is the subject of the diff (see each variant):
 *
 * - `constructor` — different type constructors (e.g. `.Struct` vs `.Integer`,
 *   `.Array` vs `.Set`, sync `.Function` where async was required). `actual` and
 *   `expected` are the two whole subtypes.
 * - `primitive` — both sides are primitive leaves but differ (e.g. `.Integer` vs
 *   `.Float`). `actual`/`expected` are those leaves.
 * - `missing-field` — `expected` is a struct field absent from the actual struct;
 *   `actual` is the actual struct (context). `name` is the field.
 * - `extra-field` — `actual` is a struct field absent from the expected struct;
 *   `expected` is the expected struct (context). `name` is the field.
 * - `field-order` — both structs have the same shared fields but in a different
 *   order (struct field order is significant in East). `actual`/`expected` are
 *   the structs; `actualOrder`/`expectedOrder` list the shared names.
 * - `missing-case` — `expected` is a variant case payload required by the
 *   expected type but absent from the actual variant; `actual` is the actual
 *   variant (context).
 * - `extra-case` — `actual` is a variant case payload present in the actual type
 *   but not accepted by the expected variant; `expected` is the expected variant.
 * - `arity` — function input counts differ; `actual`/`expected` are the function
 *   types and `actualCount`/`expectedCount` the input counts.
 */
export type TypeDiff = {
  readonly path: TypePath;
  readonly actual: EastTypeValue;
  readonly expected: EastTypeValue;
} & (
  | { readonly kind: "constructor" }
  | { readonly kind: "primitive" }
  | { readonly kind: "missing-field"; readonly name: string }
  | { readonly kind: "extra-field"; readonly name: string }
  | { readonly kind: "field-order"; readonly actualOrder: readonly string[]; readonly expectedOrder: readonly string[] }
  | { readonly kind: "missing-case"; readonly name: string }
  | { readonly kind: "extra-case"; readonly name: string }
  | { readonly kind: "arity"; readonly actualCount: number; readonly expectedCount: number }
);

/** Options for {@link diffTypes} / {@link diffTypeValues}. */
export interface DiffTypesOptions {
  /** Stop after this many records, to bound work on pathologically large or
   * deeply divergent types. Defaults to 64. */
  readonly maxDiffs?: number;
}

const PRIMITIVE_TAGS: ReadonlySet<string> = new Set([
  "Never", "Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob",
]);

// "co": actual must be a subtype of expected (the assignability direction).
// "contra": expected must be a subtype of actual (function inputs).
// "inv": actual and expected must be equal (mutable container contents).
type Variance = "co" | "contra" | "inv";

function flip(v: Variance): Variance {
  return v === "co" ? "contra" : v === "contra" ? "co" : "inv";
}

// Already-compatible subtrees produce no diff. Reusing the canonical relations
// means everything East already considers equivalent — Option ≡ Variant{none,some},
// variant width subtyping, recursive alpha-equivalence — is pruned for free, and
// we only ever descend into a genuinely incompatible subtree to localize it.
function compatible(a: EastTypeValue, b: EastTypeValue, v: Variance): boolean {
  if (v === "inv") return isTypeValueEqual(a, b);
  if (v === "co") return isSubtypeValue(a, b);
  return isSubtypeValue(b, a);
}

function isFunctionLike(t: EastTypeValue): boolean {
  return t.type === "Function" || t.type === "AsyncFunction";
}

// Recursive bodies are compared at most once per id pair (see the assumption
// set in `walk`); this only bounds malformed/non-terminating input.
const MAX_PATH_DEPTH = 256;

interface DiffCtx {
  readonly diffs: TypeDiff[];
  readonly path: TypePathSegment[];
  /** Recursive id pairs `"a:b"` assumed to correspond while their bodies are
   * being compared — the coinductive hypothesis that breaks the cycle. */
  readonly assumed: Set<string>;
  readonly maxDiffs: number;
}

function walk(a: EastTypeValue, b: EastTypeValue, v: Variance, ctx: DiffCtx): void {
  if (ctx.diffs.length >= ctx.maxDiffs) return;
  if (a === b) return;
  // Absolute backstop against pathological depth; recursion is bounded by the
  // assumption set below, this only guards malformed input.
  if (ctx.path.length > MAX_PATH_DEPTH) return;
  if (compatible(a, b, v)) return;

  if (a.type === "Recursive" || b.type === "Recursive") {
    const aRef = a.type === "Recursive" && a.value.type === "ref" ? a.value.value : undefined;
    const bRef = b.type === "Recursive" && b.value.type === "ref" ? b.value.value : undefined;

    // Two back-references: equal recursive ids, or a pair we are already
    // unfolding (the coinductive hypothesis), are aligned — not a difference.
    if (aRef !== undefined && bRef !== undefined) {
      if (aRef === bRef || ctx.assumed.has(`${aRef}:${bRef}`)) return;
      ctx.diffs.push({ kind: "constructor", path: ctx.path.slice(), actual: a, expected: b });
      return;
    }

    // Two wrappers: assume their ids correspond, then compare the bodies once.
    // The assumption makes the paired back-references (handled above) align, so
    // we report only where the unfolded structures actually diverge.
    if (a.type === "Recursive" && a.value.type === "wrapper" && b.type === "Recursive" && b.value.type === "wrapper") {
      const key = `${a.value.value.id}:${b.value.value.id}`;
      if (ctx.assumed.has(key)) return;
      ctx.assumed.add(key);
      walk(a.value.value.inner, b.value.value.inner, v, ctx);
      return;
    }

    // One wrapper against a concrete type: unfold and compare its head.
    if (a.type === "Recursive" && a.value.type === "wrapper") { walk(a.value.value.inner, b, v, ctx); return; }
    if (b.type === "Recursive" && b.value.type === "wrapper") { walk(a, b.value.value.inner, v, ctx); return; }

    // A bare back-reference against a non-recursive type.
    ctx.diffs.push({ kind: "constructor", path: ctx.path.slice(), actual: a, expected: b });
    return;
  }

  const sameFunctionFamily = isFunctionLike(a) && isFunctionLike(b);

  if (a.type !== b.type && !sameFunctionFamily) {
    const kind = PRIMITIVE_TAGS.has(a.type) && PRIMITIVE_TAGS.has(b.type) ? "primitive" : "constructor";
    ctx.diffs.push({ kind, path: ctx.path.slice(), actual: a, expected: b });
    return;
  }

  switch (a.type) {
    case "Ref": {
      ctx.path.push({ kind: "value" });
      walk(a.value, (b as typeof a).value, "inv", ctx);
      ctx.path.pop();
      return;
    }
    case "Array": case "Set": case "Vector": case "Matrix": {
      ctx.path.push({ kind: "element" });
      walk(a.value, (b as typeof a).value, "inv", ctx);
      ctx.path.pop();
      return;
    }
    case "Dict": {
      const bv = (b as typeof a).value;
      ctx.path.push({ kind: "key" });
      walk(a.value.key, bv.key, "inv", ctx);
      ctx.path.pop();
      ctx.path.push({ kind: "value" });
      walk(a.value.value, bv.value, "inv", ctx);
      ctx.path.pop();
      return;
    }
    case "Struct": {
      diffStruct(a.value, (b as typeof a).value, a, b, v, ctx);
      return;
    }
    case "Variant": {
      diffVariant(a.value, (b as typeof a).value, a, b, v, ctx);
      return;
    }
    case "Function": case "AsyncFunction": {
      diffFunction(a, b, v, ctx);
      return;
    }
    // Equal primitives are compatible (returned above) and unequal ones are a
    // head mismatch (handled above), so a primitive cannot reach here. Listed
    // for exhaustiveness (Recursive is already excluded by the branch above).
    case "Never": case "Null": case "Boolean": case "Integer": case "Float":
    case "String": case "DateTime": case "Blob":
      return;
    default:
      throw new Error(`Unhandled type in type diff: ${(a satisfies never as EastTypeValue).type}`);
  }
}

type Fields = readonly { readonly name: string; readonly type: EastTypeValue }[];

function diffStruct(af: Fields, bf: Fields, a: EastTypeValue, b: EastTypeValue, v: Variance, ctx: DiffCtx): void {
  const aNames = af.map((f) => f.name);
  const bByName = new Map(bf.map((f) => [f.name, f.type]));
  const aSet = new Set(aNames);

  for (const f of bf) {
    if (!aSet.has(f.name)) ctx.diffs.push({ kind: "missing-field", name: f.name, path: ctx.path.slice(), actual: a, expected: f.type });
  }
  for (const f of af) {
    if (!bByName.has(f.name)) ctx.diffs.push({ kind: "extra-field", name: f.name, path: ctx.path.slice(), actual: f.type, expected: b });
  }

  const sharedA = aNames.filter((n) => bByName.has(n));
  const sharedB = bf.map((f) => f.name).filter((n) => aSet.has(n));
  if (sharedA.length === sharedB.length && sharedA.some((n, i) => n !== sharedB[i])) {
    ctx.diffs.push({ kind: "field-order", actualOrder: sharedA, expectedOrder: sharedB, path: ctx.path.slice(), actual: a, expected: b });
  }

  for (const f of af) {
    const bt = bByName.get(f.name);
    if (bt === undefined) continue;
    ctx.path.push({ kind: "field", name: f.name });
    walk(f.type, bt, v, ctx);
    ctx.path.pop();
  }
}

function diffVariant(ac: Fields, bc: Fields, a: EastTypeValue, b: EastTypeValue, v: Variance, ctx: DiffCtx): void {
  const aByName = new Map(ac.map((c) => [c.name, c.type]));
  const bByName = new Map(bc.map((c) => [c.name, c.type]));

  // Under covariance the actual case set must be a subset of the expected one
  // (width subtyping), so a case only in `actual` is the error; under
  // contravariance the requirement flips; invariance demands the sets match.
  if (v === "co" || v === "inv") {
    for (const c of ac) {
      if (!bByName.has(c.name)) ctx.diffs.push({ kind: "extra-case", name: c.name, path: ctx.path.slice(), actual: c.type, expected: b });
    }
  }
  if (v === "contra" || v === "inv") {
    for (const c of bc) {
      if (!aByName.has(c.name)) ctx.diffs.push({ kind: "missing-case", name: c.name, path: ctx.path.slice(), actual: a, expected: c.type });
    }
  }

  for (const c of ac) {
    const bt = bByName.get(c.name);
    if (bt === undefined) continue;
    ctx.path.push({ kind: "case", name: c.name });
    walk(c.type, bt, v, ctx);
    ctx.path.pop();
  }
}

function diffFunction(a: EastTypeValue, b: EastTypeValue, v: Variance, ctx: DiffCtx): void {
  const av = (a as Extract<EastTypeValue, { type: "Function" }>).value;
  const bv = (b as Extract<EastTypeValue, { type: "Function" }>).value;

  // A sync Function is assignable to an async one but not vice versa.
  if (a.type !== b.type) {
    const syncRequiredButAsyncGiven =
      (v === "co" && a.type === "AsyncFunction") ||
      (v === "contra" && b.type === "AsyncFunction") ||
      v === "inv";
    if (syncRequiredButAsyncGiven) ctx.diffs.push({ kind: "constructor", path: ctx.path.slice(), actual: a, expected: b });
  }

  if (av.inputs.length !== bv.inputs.length) {
    ctx.diffs.push({ kind: "arity", actualCount: av.inputs.length, expectedCount: bv.inputs.length, path: ctx.path.slice(), actual: a, expected: b });
  } else {
    for (let i = 0; i < av.inputs.length; i++) {
      ctx.path.push({ kind: "input", index: i });
      walk(av.inputs[i]!, bv.inputs[i]!, flip(v), ctx);
      ctx.path.pop();
    }
  }

  ctx.path.push({ kind: "output" });
  walk(av.output, bv.output, v, ctx);
  ctx.path.pop();
}

/**
 * Compute the structural differences that make `actual` not assignable to
 * `expected`, as a list of {@link TypeDiff} records.
 *
 * @param actual - The type that was supplied.
 * @param expected - The type that was required.
 * @param options - See {@link DiffTypesOptions}.
 * @returns One record per incompatible location. Empty when `actual` is
 * assignable to `expected` (a subtype of it).
 *
 * @remarks
 * The walk follows East's assignability rules — struct fields covariant with a
 * fixed field set, variant width subtyping, contravariant function inputs and
 * covariant outputs, invariant mutable-container contents. Subtrees that are
 * already compatible (including `OptionType<T>` against its `Variant{none, some}`
 * form) are pruned, so the result pinpoints only what actually differs rather
 * than restating the whole type. Use {@link renderTypeDiff} to format the result.
 */
export function diffTypeValues(actual: EastTypeValue, expected: EastTypeValue, options: DiffTypesOptions = {}): TypeDiff[] {
  const ctx: DiffCtx = { diffs: [], path: [], assumed: new Set(), maxDiffs: options.maxDiffs ?? 64 };
  walk(actual, expected, "co", ctx);
  return ctx.diffs;
}

/**
 * {@link EastType} entry point for {@link diffTypeValues}.
 *
 * @param actual - The type that was supplied.
 * @param expected - The type that was required.
 * @param options - See {@link DiffTypesOptions}.
 * @returns One {@link TypeDiff} per incompatible location; empty when `actual`
 * is assignable to `expected`.
 *
 * @remarks
 * Converts both types with {@link toEastTypeValue} (which interns them, enabling
 * the identity fast paths) and defers to {@link diffTypeValues}.
 */
export function diffTypes(actual: EastType, expected: EastType, options: DiffTypesOptions = {}): TypeDiff[] {
  return diffTypeValues(toEastTypeValue(actual), toEastTypeValue(expected), options);
}

/**
 * A compact, truncated string for an {@link EastTypeValue}, for use in diff
 * messages.
 *
 * @param type - The type value to summarize.
 * @param maxDepth - How many levels of compound types to expand before
 * collapsing to an ellipsis. Defaults to 1.
 * @param maxMembers - How many struct fields / variant cases to list before
 * `…+N`. Defaults to 4.
 * @returns A one-line summary such as `.Struct {nodes, links, metadata}` or
 * `.Function (.Integer) => .Null`.
 *
 * @remarks
 * The {@link EastTypeValue} sibling of `printTypeSummary`; it stays terse
 * (struct/variant members are listed by name) because the {@link TypePath} on a
 * {@link TypeDiff} already carries the precise location.
 */
export function printTypeValueSummary(type: EastTypeValue, maxDepth = 1, maxMembers = 4): string {
  switch (type.type) {
    case "Never": return ".Never";
    case "Null": return ".Null";
    case "Boolean": return ".Boolean";
    case "Integer": return ".Integer";
    case "Float": return ".Float";
    case "String": return ".String";
    case "DateTime": return ".DateTime";
    case "Blob": return ".Blob";
    case "Ref": return maxDepth <= 0 ? ".Ref …" : `.Ref ${printTypeValueSummary(type.value, maxDepth - 1, maxMembers)}`;
    case "Array": return maxDepth <= 0 ? ".Array …" : `.Array ${printTypeValueSummary(type.value, maxDepth - 1, maxMembers)}`;
    case "Set": return maxDepth <= 0 ? ".Set …" : `.Set ${printTypeValueSummary(type.value, maxDepth - 1, maxMembers)}`;
    case "Vector": return maxDepth <= 0 ? ".Vector …" : `.Vector ${printTypeValueSummary(type.value, maxDepth - 1, maxMembers)}`;
    case "Matrix": return maxDepth <= 0 ? ".Matrix …" : `.Matrix ${printTypeValueSummary(type.value, maxDepth - 1, maxMembers)}`;
    case "Dict":
      return maxDepth <= 0
        ? ".Dict …"
        : `.Dict (key=${printTypeValueSummary(type.value.key, maxDepth - 1, maxMembers)}, value=${printTypeValueSummary(type.value.value, maxDepth - 1, maxMembers)})`;
    case "Struct": {
      const names = type.value.map((f) => f.name);
      return `.Struct {${truncateMembers(names, maxMembers)}}`;
    }
    case "Variant": {
      const names = type.value.map((c) => c.name);
      return `.Variant (${truncateMembers(names, maxMembers).split(", ").join(" | ")})`;
    }
    case "Function": case "AsyncFunction": {
      const head = type.type === "AsyncFunction" ? ".AsyncFunction" : ".Function";
      if (maxDepth <= 0) return `${head} …`;
      const inputs = type.value.inputs.map((i) => printTypeValueSummary(i, maxDepth - 1, maxMembers)).join(", ");
      return `${head} (${inputs}) => ${printTypeValueSummary(type.value.output, maxDepth - 1, maxMembers)}`;
    }
    case "Recursive":
      return type.value.type === "ref"
        ? `.Recursive ref(${type.value.value})`
        : maxDepth <= 0 ? ".Recursive …" : `.Recursive ${printTypeValueSummary(type.value.value.inner, maxDepth, maxMembers)}`;
    default:
      throw new Error(`Unhandled type in type summary: ${(type satisfies never as EastTypeValue).type}`);
  }
}

function truncateMembers(names: readonly string[], maxMembers: number): string {
  if (names.length <= maxMembers) return names.join(", ");
  return `${names.slice(0, maxMembers).join(", ")}, …+${names.length - maxMembers}`;
}

/**
 * Render a {@link TypePath} as a readable location string.
 *
 * @param path - The path to render.
 * @returns e.g. `.binding.patch`, `.write(arg 0)`, `.items[]`, or `(root)` for
 * the empty path.
 */
export function renderTypePath(path: TypePath): string {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const seg of path) {
    switch (seg.kind) {
      case "field": out += `.${seg.name}`; break;
      case "case": out += `:${seg.name}`; break;
      // Collection traversals read as the element/key/value *type* (East
      // collections are homogeneous), not a particular index/entry.
      case "element": out += "[element]"; break;
      case "key": out += "[key]"; break;
      case "value": out += "[value]"; break;
      case "input": out += `(arg ${seg.index})`; break;
      case "output": out += "(ret)"; break;
    }
  }
  return out;
}

/** Options for {@link renderTypeDiff}. */
export interface RenderTypeDiffOptions {
  /** Maximum number of diff lines to show before `…and N more`. Defaults to 6. */
  readonly maxShown?: number;
  /** `maxDepth` passed to {@link printTypeValueSummary}. Defaults to 1. */
  readonly maxDepth?: number;
  /** `maxMembers` passed to {@link printTypeValueSummary}. Defaults to 4. */
  readonly maxMembers?: number;
}

function phrase(d: TypeDiff, summarize: (t: EastTypeValue) => string): string {
  switch (d.kind) {
    case "constructor":
    case "primitive":
      return `expected ${summarize(d.expected)}, found ${summarize(d.actual)}`;
    case "missing-field":
      return `missing field "${d.name}": ${summarize(d.expected)}`;
    case "extra-field":
      return `unexpected field "${d.name}": ${summarize(d.actual)}`;
    case "field-order":
      return `field order differs (expected ${d.expectedOrder.join(", ")}; found ${d.actualOrder.join(", ")})`;
    case "missing-case":
      return `missing variant case "${d.name}": ${summarize(d.expected)}`;
    case "extra-case":
      return `unexpected variant case "${d.name}": ${summarize(d.actual)}`;
    case "arity":
      return `expected ${d.expectedCount} argument${d.expectedCount === 1 ? "" : "s"}, found ${d.actualCount}`;
  }
}

/**
 * Format a list of {@link TypeDiff} records as a concise, multi-line message.
 *
 * @param diffs - The diffs from {@link diffTypes} / {@link diffTypeValues}.
 * @param options - See {@link RenderTypeDiffOptions}.
 * @returns A message with one line per location (deepest first), or `""` when
 * there are no diffs.
 *
 * @remarks
 * When every diff is a leaf mismatch sharing the same actual/expected pair (the
 * common case where one wrong inner type shows up at several call sites), a
 * single summary line is emitted ahead of the per-location lines.
 */
export function renderTypeDiff(diffs: readonly TypeDiff[], options: RenderTypeDiffOptions = {}): string {
  if (diffs.length === 0) return "";
  const maxShown = options.maxShown ?? 6;
  const summarize = (t: EastTypeValue): string => printTypeValueSummary(t, options.maxDepth ?? 1, options.maxMembers ?? 4);

  const lines: string[] = [];

  const allLeaves = diffs.every((d) => d.kind === "constructor" || d.kind === "primitive");
  if (allLeaves && diffs.length >= 2) {
    const pairs = new Set(diffs.map((d) => `${summarize(d.actual)} ${summarize(d.expected)}`));
    if (pairs.size === 1) {
      const d0 = diffs[0]!;
      lines.push(`all ${diffs.length} differences: found ${summarize(d0.actual)} where ${summarize(d0.expected)} was expected`);
    }
  }

  const sorted = [...diffs].sort((x, y) => y.path.length - x.path.length);
  for (const d of sorted.slice(0, maxShown)) {
    lines.push(`${renderTypePath(d.path)}: ${phrase(d, summarize)}`);
  }
  if (sorted.length > maxShown) lines.push(`…and ${sorted.length - maxShown} more`);

  return lines.join("\n");
}

/** Options for {@link typeMismatchError}. */
export interface TypeMismatchErrorOptions {
  /** Resolved source frames. Takes precedence over `loc_id`. */
  readonly location?: Location[];
  /** A source-map id, resolved into frames via the ambient source map (the one
   * established with `with_source_map` while building IR). Used by callers like
   * `coerce_to` that hold the id but not the map. */
  readonly loc_id?: bigint;
  /** Forwarded to {@link renderTypeDiff} when building the message. */
  readonly render?: RenderTypeDiffOptions;
}

/**
 * Build a {@link TypeMismatchError} for an assignability failure, populating its
 * rendered message and structured `diffs`/`actual`/`expected` from
 * {@link diffTypes}, and resolving frames from `loc_id` via the ambient source
 * map when no explicit `location` is given.
 *
 * @remarks
 * The diff is computed here (not in the error class) so {@link types.TypeMismatchError}
 * stays free of a dependency on the diff machinery.
 */
export function typeMismatchError(actual: EastType, expected: EastType, options: TypeMismatchErrorOptions = {}): TypeMismatchError {
  const diffs = diffTypes(actual, expected);
  const body = renderTypeDiff(diffs, options.render);
  const detail = body.length > 0
    ? body
    : `${printTypeValueSummary(toEastTypeValue(actual))} is not assignable to ${printTypeValueSummary(toEastTypeValue(expected))}`;
  const location = options.location
    ?? (options.loc_id !== undefined ? [...(get_current_source_map()?.resolve(options.loc_id) ?? [])] : []);
  return new TypeMismatchError(`East type mismatch:\n${detail}`, { actual, expected, diffs, location });
}
