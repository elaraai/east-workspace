/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Splitting a checked query over one dataset's pieces (#941).
 *
 * A query that works through one root dataset's rows can run as a split call:
 * each piece of the dataset runs the work done row by row and emits into an
 * output kind, e3 combines the pieces' outputs by that kind, and a final
 * function runs the rest of the query once, over the combined result
 * (`devdocs/QUERY.md` §17.1).
 *
 * Every program here is the translator's code for a part of the checked
 * program, so a piece computes what the whole query computes on its rows, and
 * a runtime error names its place in the query as the one unit's does. Every
 * merge is built, field by field, from associative primitives: adding as
 * `add` adds (numbers, strings, arrays and dicts), counting, the least, the
 * greatest, the first, the last, or, and, union and concatenation.
 *
 * A piece whose output combines by key — a grouping by totals, `unique`,
 * `unique_by`, a `reduce` — folds its rows into a table inside the piece, as
 * the merge folds them, and sends the table's entries on every so many rows
 * and at its end (#1093): the runner's sorter then folds a pair per key per
 * flush, not a pair per row. A table that gathers more keys than its rows
 * repay sends them on, and the piece's rows from there go straight on.
 *
 * @packageDocumentation
 */

import { compareFor } from "../../comparison.js";
import { SortedMap } from "../../containers/sortedmap.js";
import { SortedSet } from "../../containers/sortedset.js";
import { none } from "../../containers/variant.js";
import { func } from "../../expr/block.js";
import { withLocationCapture } from "../../location.js";
import { decodeBeast2 } from "../../serialization/beast2/index.js";
import { fromEastTypeValue } from "../../type_of_type.js";
import type { Expr } from "../../expr/expr.js";
import type { FunctionExpr } from "../../expr/function.js";
import {
  ArrayType, BooleanType, DictType, FunctionType, IntegerType, NullType, OptionType, SetType, StructType,
  isImmutableType, isTypeEqual, type EastType,
} from "../../types.js";
import type { CheckJqResult } from "./check.js";
import { nullablePayload, unwrap } from "./shapes.js";
import { childPath, jqChildren, type JqNode, type JqPattern, type JqRange } from "./spans.js";
import { addInto } from "./translate-builtins.js";
import { TranslationError, Translator, parts, type Block, type CallSite, type Emit, type Env, type RootValue, type TranslateJqOptions, type Value } from "./translate.js";

// ─── The public shape ───────────────────────────────────────────────────────

/** Options for {@link splitJq}. */
export interface SplitJqOptions {
  /** A `many` query's limit, as `translateJq`'s: the final function keeps this many outputs, and one more, so a caller can tell they were cut short. */
  maxOutputs?: number;
  /**
   * The rows a piece folds into its table before it sends the table's entries
   * on; 32,768 when omitted. A test forces small flushes with it.
   *
   * @internal
   */
  flushRows?: number;
  /**
   * The share of a flush's rows its table's keys may be: at one key more, a
   * piece sends the table on and the rest of its rows straight on; 1/32 when
   * omitted. A test forces the bypass with 0, and stops it with 1.
   *
   * @internal
   */
  bypassRatio?: number;
}

/** A query split over one dataset's pieces, or why it runs as one unit. */
export type JqSplit = JqSplitCall | JqWhole;

/**
 * A query split over one root dataset's pieces: the parts of a split call.
 *
 * @remarks
 * A split call's arguments are the query's inputs, in {@link JqSplitCall.inputs}'
 * order, the one named {@link JqSplitCall.over} partitioned. Each piece runs
 * {@link JqSplitCall.piece} over its piece of that dataset and the other inputs
 * whole, emitting into {@link JqSplitCall.output}'s kind; {@link JqSplitCall.then}
 * runs once over the assembled output and then the inputs, and gives the
 * query's result, exactly as `translateJq`'s translation gives it.
 */
export interface JqSplitCall {
  readonly kind: "split";
  /** The root field whose dataset the pieces are cut from. */
  readonly over: string;
  /** The inputs the piece program and the final function take, in order: the root fields the query reads, as `translateJq`'s. */
  readonly inputs: readonly { readonly name: string; readonly type: EastType }[];
  /** The query's result type, as `translateJq`'s: `T`, `Option<T>` or `Array<T>` by its multiplicity. */
  readonly resultType: EastType;
  /** How the pieces' outputs combine: the split call's output kind. */
  readonly output: JqSplitOutput;
  /**
   * The program each piece runs: a function of the inputs and then `emit`,
   * which gives nothing; `over`'s input is the piece.
   *
   * @returns the function
   */
  piece(): FunctionExpr<any[], any>;
  /**
   * The final function, of the assembled output and then the inputs, which
   * gives the query's result; `null` when the assembled output is the result.
   *
   * @returns the function, or `null`
   */
  then(): FunctionExpr<any[], any> | null;
  /** What the split does, for its explanation. */
  readonly stages: JqSplitStages;
  /** The root fields bound before the stream: every piece reads each whole. */
  readonly broadcast: readonly string[];
  /**
   * The root fields bound before the stream that the pieces read only at the
   * row's key: dicts keyed as the dataset is, which a split call partitions
   * with it, cut at the same keys (#942).
   */
  readonly copartitioned: readonly string[];
  /**
   * A join the pieces could read by key instead of whole: the split call's
   * rows re-keyed first, then joined cut at the same keys; `null` when the
   * query has none (#942).
   */
  readonly rekey: JqRekey | null;
  /** The reads that skip what they don't need. */
  readonly pruning: readonly JqPruning[];
}

/**
 * A join a split can make by key instead of reading the other side whole in
 * every piece (#942): when both datasets are large, the rows are first
 * re-keyed by the join key in a split call of their own, and the query's
 * split call then reads the re-keyed rows and the other side cut at the same
 * keys, every row meeting its key in its piece.
 *
 * @remarks
 * Re-keyed rows reach the pieces grouped by key, not in input order, so only
 * a query whose combine does not depend on the rows' order re-keys: totals
 * that count, add numbers, take the least or the greatest, test, or unite, a
 * grouping by such totals, `unique`, and a `reduce` that adds numbers. The
 * join call's answer is the split's: its output kind, programs and final
 * function, a Float sum added in another grouping.
 */
export interface JqRekey {
  /** The root field the pieces read by key: the join's other side, a dict. */
  readonly name: string;
  /** The join key's jq: a field of the row, each lookup's. */
  readonly key: JqRange;
  /** The join key's type: the other side's keys'. */
  readonly keyType: EastType;
  /** The re-key call's output: each key's rows, concatenated in input order. */
  readonly output: { readonly kind: "dict"; readonly type: EastType; merge(): FunctionExpr<any[], any> };
  /**
   * The program each piece of the re-key call runs: a function of the
   * dataset's piece and then `emit`, which sends each row under its key.
   *
   * @returns the function
   */
  piece(): FunctionExpr<any[], any>;
  /** The join call's inputs: the split's, the dataset's re-keyed. */
  readonly inputs: readonly { readonly name: string; readonly type: EastType }[];
  /**
   * The program each piece of the join call runs: the split's, over the
   * re-keyed rows, each key's in turn.
   *
   * @returns the function
   */
  joinPiece(): FunctionExpr<any[], any>;
  /**
   * The join call's final function: the split's, of the assembled output and
   * then the join call's inputs; `null` when the assembled output is the
   * result.
   *
   * @returns the function, or `null`
   */
  joinThen(): FunctionExpr<any[], any> | null;
}

/**
 * How a split call's pieces combine: its output kind, with its programs and
 * its zero.
 *
 * @remarks
 * - `array`: the pieces' rows concatenated in input order.
 * - `set`: the distinct rows.
 * - `dict`: rows by key, the values of equal keys folded with `merge`, a
 *   function of the key and two values, in input order; no `merge` keeps the
 *   first.
 * - `fold`: every piece's value folded with `combine`, a function of two
 *   values, starting from `zero`, in input order.
 */
export type JqSplitOutput =
  | { readonly kind: "array"; readonly type: EastType }
  | { readonly kind: "set"; readonly type: EastType }
  | { readonly kind: "dict"; readonly type: EastType; merge(): FunctionExpr<any[], any> }
  | { readonly kind: "fold"; readonly type: EastType; readonly zero: unknown; combine(): FunctionExpr<any[], any> };

/** The parts of a query a split runs where, as ranges of its text. */
export interface JqSplitStages {
  /** What each piece runs: from the read of the dataset through the last step done row by row. */
  readonly piece: JqRange;
  /** How the pieces' outputs combine. */
  readonly combine: JqCombine;
  /** What the final function runs once over the combined result; `null` when nothing follows the combine. */
  readonly then: JqRange | null;
}

/**
 * How a split's pieces' outputs combine, as its explanation says it.
 *
 * @remarks
 * - `concat`: the rows, concatenated in input order.
 * - `totals`: totals over every row, each combined by its rule.
 * - `group`: rows grouped by a key, each group's totals combined by their
 *   rules; with no totals, each group's rows are collected.
 * - `distinct`: the distinct rows (`unique`).
 * - `distinct_by`: the first row of each key (`unique_by`).
 * - `reduce`: a `reduce` into a dict, its updates combined by key, added
 *   (`+=`) or the last kept (`=`).
 * - `top`: the first `rows` rows of a sort (`sort_by(g) | .[:n]`,
 *   `sort | first`), each piece's kept and merged by the key `g` gives
 *   (`null` for `sort`, by the row), then by input order (#942).
 */
export type JqCombine =
  | { readonly kind: "concat" }
  | { readonly kind: "totals"; readonly range: JqRange; readonly totals: readonly JqTotal[] }
  | { readonly kind: "group"; readonly range: JqRange; readonly key: JqRange; readonly totals: readonly JqTotal[] | null }
  | { readonly kind: "distinct"; readonly range: JqRange }
  | { readonly kind: "distinct_by"; readonly range: JqRange; readonly key: JqRange }
  | { readonly kind: "reduce"; readonly range: JqRange; readonly key: JqRange; readonly update: "add" | "replace" }
  | { readonly kind: "top"; readonly range: JqRange; readonly key: JqRange | null; readonly rows: number };

/**
 * One total, and the rule its pieces' parts combine by: `count` counted,
 * `add` added as `add` adds, `min` and `max` the least and the greatest (by a
 * key, for `min_by` and `max_by`), `first` and `last`, `any` (or) and `all`
 * (and), and `union`, the distinct values.
 */
export interface JqTotal {
  /** The total's jq. */
  readonly range: JqRange;
  /** How its parts combine. */
  readonly rule: "count" | "add" | "min" | "max" | "first" | "last" | "any" | "all" | "union";
}

/** A query that runs as one unit, and why. */
export interface JqWhole {
  readonly kind: "whole";
  /** Why it is not split. */
  readonly reason: JqWholeReason;
  /** The reads that skip what they don't need. */
  readonly pruning: readonly JqPruning[];
}

/**
 * Why a query runs as one unit.
 *
 * @remarks
 * - `no_stream`: it works through no dataset's rows: it reads a count, a key,
 *   or a value whole.
 * - `nested`: it works through a dataset's rows inside an expression, not as
 *   its own pipeline.
 * - `stops_early`: it keeps only its first outputs, which one unit stops for
 *   as soon as it has them; `range` is the step that keeps them, or `null`
 *   for a stream's own outputs, which a caller caps.
 * - `position`: a step takes rows by their position, which one unit reads only
 *   as far as it needs.
 * - `every_row`: a step needs every row at once, as a sort does, and no work
 *   is done row by row before it.
 * - `state`: a step carries state from row to row.
 * - `calls`: the work done row by row calls a function value, which may call a
 *   platform function the runner does not load.
 * - `reads_again`: it reads the dataset it works through again, outside the
 *   stream.
 * - `key`: it groups by a key that is not one value a dict can hold.
 * - `shape`: it is not a pipeline the planner splits.
 */
export interface JqWholeReason {
  readonly code: "no_stream" | "nested" | "stops_early" | "position" | "every_row" | "state" | "calls" | "reads_again" | "key" | "shape";
  /** The jq the reason is about, when it is about some. */
  readonly range: JqRange | null;
  /** The builtin or the dataset the reason names, when it names one. */
  readonly name: string | null;
}

/**
 * A read that skips what it doesn't need.
 *
 * @remarks
 * - `count`: `.D | length` reads the count from the dataset's index, and no
 *   segment.
 * - `seek`: `.D[k]` or `.D | has(k)` reads only the segment that holds the key.
 * - `stop`: a stream that stops early reads only the segments it reaches.
 */
export interface JqPruning {
  readonly kind: "count" | "seek" | "stop";
  /** The dataset, by its root field. */
  readonly name: string;
  /** The jq that reads it. */
  readonly range: JqRange;
}

// ─── The pipeline ───────────────────────────────────────────────────────────

type Node<K extends JqNode["type"]> = Extract<JqNode, { type: K }>;

/** A step of a pipeline: a stage, or a binding whose body is the rest of the pipeline. */
type Step =
  | { readonly kind: "stage"; readonly node: JqNode; readonly path: string }
  | { readonly kind: "bind"; readonly node: Node<"bind">; readonly path: string };

/** A pipeline's steps, through its pipes and the bodies of its bindings. */
function pipeline(node: JqNode, path: string, out: Step[] = []): Step[] {
  if (node.type === "pipe") {
    pipeline(node.value.left, childPath(path, "pipe.left"), out);
    return pipeline(node.value.right, childPath(path, "pipe.right"), out);
  }
  if (node.type === "bind" && node.value.patterns.length === 1) {
    out.push({ kind: "bind", node, path });
    return pipeline(node.value.body, childPath(path, "bind.body"), out);
  }
  out.push({ kind: "stage", node, path });
  return out;
}

/** What a step of row work does to one row. */
type RowStep =
  /** `map(f)`: `f`'s outputs on the row, each as the map's element type. */
  | { readonly kind: "map"; readonly node: Node<"call">; readonly path: string }
  /** `flatten`: the row flattened, as the one row of an array would be. */
  | { readonly kind: "flatten"; readonly node: Node<"call">; readonly path: string }
  /** A stage of a stream, run on the row. */
  | { readonly kind: "each"; readonly node: JqNode; readonly path: string }
  /** A binding in a stream, bound from the row for the steps after it. */
  | { readonly kind: "bind"; readonly node: Node<"bind">; readonly path: string }
  /** The row as the type a node's outputs have: `.[]` making a stream, or `[…]` collecting one. */
  | { readonly kind: "as"; readonly path: string; readonly element: boolean };

/** The dataset a query works through, and the node that reads it. */
interface Source {
  readonly over: string;
  readonly path: string;
  /**
   * The path of the `to_entries` whose entries are the rows, `{key, value}`,
   * when the dataset is a dict read as its entries (#942); `undefined` when
   * the rows are its elements, or its values.
   */
  readonly entries?: string;
}

/** A query's row work: its source, what it does to each row, and what the rows are when it ends. */
interface Rows {
  /** The prefix's bindings, each read from the root. */
  readonly binds: readonly Extract<Step, { kind: "bind" }>[];
  readonly source: Source;
  readonly steps: readonly RowStep[];
  /** Whether the rows end as a stream (`.[]`), not a collection. */
  readonly stream: boolean;
  /** The path of the row work's first stage, and of its last. */
  readonly start: string;
  readonly end: string;
  /** Whether any work is done row by row. */
  readonly work: boolean;
  /** The collection the steps after the row work read, and its rows' type; `undefined` for a stream. */
  readonly elements: Elements | undefined;
  /** The pipeline's steps after the row work. */
  readonly after: readonly Step[];
}

/** A root field read, `.name`, on the root. */
function rootField(node: JqNode, readsRoot: boolean): string | undefined {
  if (!readsRoot) return undefined;
  if (node.type === "field" && node.value.target.type === "identity" && !node.value.optional) return node.value.name;
  return undefined;
}

/** `.name[]`, on the root. */
function rootStream(node: JqNode): string | undefined {
  if (node.type !== "iterate" || node.value.optional) return undefined;
  return rootField(node.value.target, true);
}

/** Whether a node is a call of a builtin by name and arity, not of a def. */
function isCall(node: JqNode, name: string, arity: number): node is Node<"call"> {
  return node.type === "call" && node.value.name === name && node.value.args.length === arity;
}

/** Whether a node is `.[]` on its input. */
function isIterate(node: JqNode): boolean {
  return node.type === "iterate" && !node.value.optional && node.value.target.type === "identity";
}

/** Whether the value after a node is a dict. */
function isDict(checked: CheckJqResult, path: string): boolean {
  return unwrap(typeAfter(checked, path)).type === "Dict";
}

/**
 * A dict's entries at a pipeline's step: `to_entries`, a collection of them;
 * `to_entries[]` or `to_entries | .[]`, a stream of them. The `to_entries`
 * node's path, the stream's, the last step's, and the index of the step after.
 */
function entriesAt(steps: readonly Step[], i: number): { entries: string; stream: string | undefined; end: string; next: number } | undefined {
  const step = steps[i];
  if (step?.kind !== "stage") return undefined;
  const node = step.node;
  if (node.type === "iterate" && !node.value.optional && isCall(node.value.target, "to_entries", 0)) {
    return { entries: childPath(step.path, "iterate.target"), stream: step.path, end: step.path, next: i + 1 };
  }
  if (!isCall(node, "to_entries", 0)) return undefined;
  const after = steps[i + 1];
  if (after?.kind === "stage" && isIterate(after.node)) return { entries: step.path, stream: after.path, end: after.path, next: i + 2 };
  return { entries: step.path, stream: undefined, end: step.path, next: i + 1 };
}

// ─── What the query reads, and what it does ─────────────────────────────────

/** The names of the variables a node and everything inside it read. */
function variablesIn(node: JqNode, out: Set<string> = new Set()): Set<string> {
  if (node.type === "variable") out.add(node.value);
  if (node.type === "object") {
    for (const entry of node.value) if (entry.key.type === "variable" && entry.value.type === "none") out.add(entry.key.value);
  }
  for (const child of jqChildren(node)) if (child.node !== undefined) variablesIn(child.node, out);
  return out;
}

/** The names a destructuring pattern binds. */
function patternNames(pattern: JqPattern): string[] {
  switch (pattern.type) {
    case "variable": return [pattern.value];
    case "array": return (pattern.value as JqPattern[]).flatMap(patternNames);
    case "object":
      return (pattern.value as { key: string; value: { type: "none" | "some"; value: any } }[])
        .flatMap(entry => entry.value.type === "none" ? [entry.key] : patternNames(entry.value.value));
  }
}

/** Whether a node, given an input, reads it: `.` reaches it. Conservative: a builtin call reads its input. */
function readsInput(node: JqNode): boolean {
  switch (node.type) {
    case "identity": case "descend": case "call": case "update": case "format": case "def":
      return true;
    case "literal": case "variable": case "break":
      return false;
    case "pipe":
      return readsInput(node.value.left);
    case "field": case "iterate":
      return readsInput(node.value.target);
    case "index":
      return readsInput(node.value.target) || readsInput(node.value.index);
    case "slice":
      return readsInput(node.value.target) || jqChildren(node).some(c => c.node !== undefined && c.step !== "slice.target" && readsInput(c.node));
    case "object":
      return node.value.some(entry =>
        (entry.key.type === "name" && entry.value.type === "none")
        || (entry.key.type === "computed" && readsInput(entry.key.value))
        || (entry.value.type === "some" && readsInput(entry.value.value)));
    case "if":
      return node.value.otherwise.type === "none" || jqChildren(node).some(c => c.node !== undefined && readsInput(c.node));
    case "reduce": case "foreach":
      return readsInput(node.value.source) || readsInput(node.value.init);
    default:
      return jqChildren(node).some(c => c.node !== undefined && readsInput(c.node));
  }
}

/** The first node in a subtree for which `test` holds, and its path. */
function findNode(node: JqNode, path: string, test: (node: JqNode) => boolean): { node: JqNode; path: string } | undefined {
  if (test(node)) return { node, path };
  for (const child of jqChildren(node)) {
    if (child.node === undefined) continue;
    const found = findNode(child.node, childPath(path, child.step), test);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Builtins that carry state from one row to the next: they read the program's further inputs. */
const STATEFUL: ReadonlySet<string> = new Set(["input", "inputs", "input_line_number"]);

/** Builtins that need every row of the collection they are given at once. */
const EVERY_ROW: ReadonlySet<string> = new Set([
  "sort", "sort_by", "group_by", "unique", "unique_by", "reverse", "min", "max", "min_by", "max_by", "add", "any", "all",
  "to_entries", "from_entries", "with_entries", "keys", "keys_unsorted", "transpose", "combinations", "join", "flatten",
  "tojson", "tostring", "walk", "paths", "leaf_paths", "length", "indices", "index", "rindex", "inside", "contains",
]);

/** Builtins that take rows by their position. */
const POSITIONAL: ReadonlySet<string> = new Set(["first", "last", "nth", "limit", "skip", "until"]);

// ─── Recognising the row work ───────────────────────────────────────────────

/** What recognising a query found: its row work, or why it has none. */
type Found = { readonly rows: Rows } | { readonly whole: JqWholeReason };

/** A reason, with the range of the node it is about. */
function reason(checked: CheckJqResult, code: JqWholeReason["code"], path: string | null, name: string | null = null): JqWholeReason {
  return { code, range: path === null ? null : rangeOf(checked, path), name };
}

/** A node's range of text. */
function rangeOf(checked: CheckJqResult, path: string): JqRange {
  const range = checked.source.spans.get(path);
  if (range === undefined) throw new TranslationError(`no text for the node at ${path || "the root"}`);
  return range;
}

/** The range from one node's start to another's end. */
function spanning(checked: CheckJqResult, from: string, to: string): JqRange {
  return { from: rangeOf(checked, from).from, to: rangeOf(checked, to).to };
}

/**
 * Finds a query's row work: the bindings before it, the dataset it streams,
 * the steps done to each row, and the steps after.
 */
function findRows(checked: CheckJqResult, program: JqNode): Found {
  const steps = pipeline(program, "");
  let i = 0;
  const binds: Extract<Step, { kind: "bind" }>[] = [];
  while (i < steps.length && steps[i]!.kind === "bind") binds.push(steps[i++] as Extract<Step, { kind: "bind" }>);
  const first = steps[i];
  if (first === undefined || first.kind !== "stage") return { whole: reason(checked, "shape", null) };
  // A def before the stream would have to be in scope where every piece runs.
  if (first.node.type === "def") return { whole: reason(checked, "shape", first.path) };

  let source: Source;
  let stream = false;
  let end = first.path;
  const rowSteps: RowStep[] = [];
  const field = rootField(first.node, true);
  const streamed = rootStream(first.node);
  if (field !== undefined) {
    source = { over: field, path: first.path };
    // `.D | to_entries`, `.D | to_entries[]`: a dict's entries are the rows (#942).
    const entries = isDict(checked, first.path) ? entriesAt(steps, i + 1) : undefined;
    if (entries !== undefined) {
      source = { ...source, entries: entries.entries };
      if (entries.stream !== undefined) {
        rowSteps.push({ kind: "as", path: entries.stream, element: false });
        stream = true;
      }
      end = entries.end;
      i = entries.next - 1;
    }
  } else if (streamed !== undefined) {
    source = { over: streamed, path: first.path };
    stream = true;
    rowSteps.push({ kind: "as", path: first.path, element: false });
  } else if (first.node.type === "array" && first.node.value.type === "some") {
    // `[.D[] | f]`, `[.D | to_entries[] | f]`: the stream's outputs, collected.
    const inner = pipeline(first.node.value.value, childPath(first.path, "array.some"));
    const head = inner[0];
    if (head?.kind !== "stage") return { whole: nestedOrNone(checked, first) };
    const over = rootStream(head.node);
    const dict = rootField(head.node, true);
    const entries = dict !== undefined && isDict(checked, head.path) ? entriesAt(inner, 1) : undefined;
    if (over !== undefined) {
      source = { over, path: head.path };
      rowSteps.push({ kind: "as", path: head.path, element: false }, ...streamSteps(inner.slice(1)), { kind: "as", path: first.path, element: true });
    } else if (dict !== undefined && entries?.stream !== undefined) {
      source = { over: dict, path: head.path, entries: entries.entries };
      rowSteps.push({ kind: "as", path: entries.stream, element: false }, ...streamSteps(inner.slice(entries.next)), { kind: "as", path: first.path, element: true });
    } else {
      return { whole: nestedOrNone(checked, first) };
    }
  } else if (first.node.type === "reduce" && rootStream(first.node.value.source) !== undefined) {
    // `reduce .D[] as $x (…)`: the reduce combines the dataset's rows.
    const sourcePath = childPath(first.path, "reduce.source");
    const row = typeAfter(checked, sourcePath);
    return checkBinds(checked, {
      binds, source: { over: rootStream(first.node.value.source)!, path: sourcePath },
      steps: [{ kind: "as", path: sourcePath, element: false }], stream: false, start: first.path, end: sourcePath, work: false,
      elements: { type: ArrayType(row), element: row }, after: steps.slice(i),
    });
  } else {
    return { whole: earlyOrNested(checked, first) };
  }

  i += 1;
  // The collection's row work: `map`, `flatten`, `[.[] | f]`; or `.[]` making a stream of the dataset.
  while (!stream && i < steps.length) {
    const step = steps[i]!;
    if (step.kind !== "stage") break;
    const node = step.node;
    const working = rowSteps.some(s => s.kind !== "as");
    if (isCall(node, "map", 1)) rowSteps.push({ kind: "map", node, path: step.path });
    else if (isCall(node, "flatten", 0)) rowSteps.push({ kind: "flatten", node, path: step.path });
    else if (node.type === "array" && node.value.type === "some") {
      const inner = pipeline(node.value.value, childPath(step.path, "array.some"));
      const head = inner[0];
      if (head?.kind !== "stage" || !isIterate(head.node)) break;
      rowSteps.push({ kind: "as", path: head.path, element: false }, ...streamSteps(inner.slice(1)), { kind: "as", path: step.path, element: true });
    } else if (isIterate(node) && !working) {
      // `.D | .[]`: the dataset's rows as a stream, which one unit stops early.
      rowSteps.push({ kind: "as", path: step.path, element: false });
      stream = true;
    } else break;
    end = step.path;
    i += 1;
  }
  if (stream) {
    // A stream's later steps all run row by row: it is the query's output.
    rowSteps.push(...streamSteps(steps.slice(i)));
    if (steps.length > i) end = steps[steps.length - 1]!.path;
    i = steps.length;
  }
  for (const s of rowSteps) {
    if (!("node" in s)) continue;
    const call = findNode(s.node, s.path, n => n.type === "call" && n.value.name === "call");
    if (call !== undefined) return { whole: reason(checked, "calls", call.path) };
    const stateful = findNode(s.node, s.path, n => n.type === "call" && STATEFUL.has(n.value.name));
    if (stateful !== undefined) return { whole: reason(checked, "state", stateful.path, nodeName(stateful.node)) };
  }
  return checkBinds(checked, {
    binds, source, steps: rowSteps, stream, start: first.path, end, work: rowSteps.some(s => s.kind !== "as"),
    elements: stream ? undefined : elementsOf(typeAfter(checked, end)), after: steps.slice(i),
  });
}

/** Row work whose bindings before the stream every piece can read: none reads the dataset again, and each gives one value. */
function checkBinds(checked: CheckJqResult, rows: Rows): Found {
  for (const bind of rows.binds) {
    if (readsRootField(bind.node.value.source, rows.source.over)) return { whole: reason(checked, "reads_again", bind.path, rows.source.over) };
    const result = checked.resultAt(childPath(bind.path, "bind.source"));
    if (result === null || result.mult.lo !== 1 || result.mult.hi !== 1) return { whole: reason(checked, "shape", bind.path) };
  }
  return { rows };
}

/** The steps of a stream after its source, each run on each row. */
function streamSteps(steps: readonly Step[]): RowStep[] {
  return steps.map((step): RowStep => step.kind === "bind" ? { kind: "bind", node: step.node, path: step.path } : { kind: "each", node: step.node, path: step.path });
}

/** The name a node is known by in a reason: a builtin's, or its kind. */
function nodeName(node: JqNode): string {
  if (node.type === "call") return node.value.name;
  return node.type;
}

/** Whether a node reads a root field anywhere in it, with the root as its input. */
function readsRootField(node: JqNode, name: string): boolean {
  if (rootField(node, true) === name) return true;
  if (node.type === "pipe") return readsRootField(node.value.left, name);
  return jqChildren(node).some(child => child.node !== undefined && child.step !== "pipe.right" && readsRootField(child.node, name));
}

/** Why a query whose first stage is not a stream runs as one unit: it stops early, or streams inside an expression, or streams nothing. */
function earlyOrNested(checked: CheckJqResult, first: Extract<Step, { kind: "stage" }>): JqWholeReason {
  const node = first.node;
  if (node.type === "call" && (POSITIONAL.has(node.value.name) || node.value.name === "isempty")) {
    if (findNode(node, first.path, n => rootStream(n) !== undefined) !== undefined) return reason(checked, "stops_early", first.path, node.value.name);
  }
  if (node.type === "reduce" || node.type === "foreach") return reason(checked, node.type === "reduce" ? "shape" : "state", first.path, node.type);
  return nestedOrNone(checked, first);
}

/** `nested` when a stream over a root field is somewhere inside the node; `no_stream` otherwise. */
function nestedOrNone(checked: CheckJqResult, first: Extract<Step, { kind: "stage" }>): JqWholeReason {
  const inner = findNode(first.node, first.path, n => rootStream(n) !== undefined || (n.type === "pipe" && rootField(n.value.left, true) !== undefined));
  if (inner !== undefined && inner.path !== first.path) return reason(checked, "nested", inner.path);
  return reason(checked, "no_stream", null);
}

// ─── Totals ─────────────────────────────────────────────────────────────────

/** A `map(g)` whose outputs a total works through, on each row. */
interface MapContext {
  readonly node: Node<"call">;
  readonly path: string;
}

/** The input a total works through: an array, a set or a dict, and its elements' type. */
interface Elements {
  /** The collection's type. */
  readonly type: EastType;
  /** Each element's type. */
  readonly element: EastType;
}

/**
 * One total in an expression over rows: its node, a hole the final function
 * fills with its value; the maps whose outputs it works through; and its
 * algebra, a partial value per piece combined by an associative rule.
 */
interface Leaf {
  readonly path: string;
  readonly node: JqNode;
  readonly rule: JqTotal["rule"];
  readonly range: JqRange;
  readonly maps: readonly MapContext[];
  /** The type of its input: the collection of the elements it works through. */
  readonly input: Elements;
  /** Its partial's type. */
  readonly type: EastType;
  /** Its partial's zero: a value of {@link Leaf.type}, an identity of `combine`. */
  readonly zero: unknown;
  /** Folds one element into a partial variable. */
  add(t: SplitTranslator, $: Block, acc: Expr, element: Expr, env: Env): void;
  /** Two partials combined, the earlier first. */
  combine(t: SplitTranslator, $: Block, a: Expr, b: Expr): Expr;
  /** The leaf node's value, as the one unit gives it, from its partial. */
  finish(t: SplitTranslator, $: Block, partial: Expr, env: Env): Expr;
}

/** An expression over rows, made of totals: its leaves, and the maps it reads through. */
interface Totals {
  readonly leaves: readonly Leaf[];
  readonly maps: readonly MapContext[];
}

/** The element type of a collection type that totals work through: an array's, a set's or a dict's values. */
function elementsOf(type: EastType): Elements | undefined {
  const t = unwrap(type);
  if (t.type === "Array") return { type: t, element: t.value as EastType };
  if (t.type === "Set") return { type: t, element: t.key as EastType };
  if (t.type === "Dict") return { type: t, element: t.value as EastType };
  return undefined;
}

/**
 * Decomposes an expression over a collection into totals.
 *
 * @param node - the expression
 * @param path - its path
 * @param input - the collection it reads: its type and its elements' type
 * @param maps - the maps whose outputs the collection is, outermost first
 * @returns the totals, or `undefined` when the expression reads the collection other than through totals
 */
function decompose(checked: CheckJqResult, node: JqNode, path: string, input: Elements, maps: readonly MapContext[], out: { leaves: Leaf[]; maps: MapContext[] }): boolean {
  const at = (step: string): string => childPath(path, step);
  const leaf = leafOf(checked, node, path, input, maps);
  if (leaf !== undefined) { out.leaves.push(leaf); return true; }
  switch (node.type) {
    case "literal": case "variable":
      return true;
    case "pipe": {
      const left = node.value.left;
      const leftPath = at("pipe.left");
      if (isCall(left, "map", 1)) {
        const mapped = checked.typeAt(leftPath)?.type;
        const elements = mapped === undefined ? undefined : elementsOf(mapped);
        if (elements === undefined) return false;
        const context: MapContext = { node: left, path: leftPath };
        out.maps.push(context);
        return decompose(checked, node.value.right, at("pipe.right"), elements, [...maps, context], out);
      }
      // The right side reads the left's value, never the collection.
      return decompose(checked, left, leftPath, input, maps, out);
    }
    case "field":
      return node.value.target.type !== "identity" && decompose(checked, node.value.target, at("field.target"), input, maps, out);
    case "index":
      return node.value.target.type !== "identity"
        && decompose(checked, node.value.target, at("index.target"), input, maps, out)
        && decompose(checked, node.value.index, at("index.index"), input, maps, out);
    case "object":
      return node.value.every((entry, i) => {
        if (entry.key.type === "computed") return false;
        if (entry.value.type === "none") return entry.key.type === "variable";
        return decompose(checked, entry.value.value, at(`object[${i}].value.some`), input, maps, out);
      });
    case "array":
      return node.value.type === "none" || decompose(checked, node.value.value, at("array.some"), input, maps, out);
    case "binary": case "alternative": case "comma":
      return decompose(checked, node.value.left, at(`${node.type}.left`), input, maps, out)
        && decompose(checked, node.value.right, at(`${node.type}.right`), input, maps, out);
    case "negate":
      return decompose(checked, node.value, at("negate"), input, maps, out);
    case "if":
      return node.value.otherwise.type === "some" && jqChildren(node).every(child => child.node === undefined || decompose(checked, child.node, at(child.step), input, maps, out));
    case "string":
      return jqChildren(node).every(child => child.node === undefined || decompose(checked, child.node, at(child.step), input, maps, out));
    default:
      return false;
  }
}

/** The algebra of a total, or `undefined` when a node is not one. */
function leafOf(checked: CheckJqResult, node: JqNode, path: string, input: Elements, maps: readonly MapContext[]): Leaf | undefined {
  // A call by name and arity; not narrowing `node`, which several tests below read.
  const named = (name: string, arity: number): boolean => node.type === "call" && node.value.name === name && node.value.args.length === arity;
  const call = node as Node<"call">;
  const E = input.element;
  const kind = unwrap(input.type).type;
  const range = maps.length === 0 ? rangeOf(checked, path) : spanning(checked, maps[0]!.path, path);
  const base = { path, node, range, maps, input };
  const option = OptionType(E);
  const representative = (t: SplitTranslator, $: Block, partial: Expr, env: Env, value: (p: Expr) => Expr): Expr => {
    // The leaf on a collection of the one element its partial holds: what it gives on every element.
    const type = t.typeAt(path, env);
    const one = t.matchValue(partial, {
      none: () => kind === "Set" ? t.value(new SortedSet([], compareFor(E)), input.type) : t.emptyArray(E),
      some: ($2, p) => {
        if (kind === "Set") {
          const set = t.declare($2, t.value(new SortedSet([], compareFor(E)), input.type), "one");
          t.stmt($2, t.b("SetTryInsert", [E], [set, value(p)], BooleanType, path));
          return set;
        }
        const array = t.declare($2, t.emptyArray(E), "one");
        t.push($2, array, value(p), path);
        return array;
      },
    }, input.type, path);
    return t.one(node, path, $, t.bind($, one, "elements"), env, type);
  };
  const pickBetter = (t: SplitTranslator, $: Block, a: Expr, b: Expr, better: (x: Expr, y: Expr) => Expr, type: EastType): Expr =>
    // b replaces a when a has none, or b is better.
    t.matchValue(b, {
      none: () => a,
      some: (_$2, y) => t.matchValue(a, {
        none: () => b,
        some: (_$3, x) => t.ifValue(better(y, x), () => b, () => a, type, path),
      }, type, path),
    }, type, path);

  if (named("length", 0)) {
    return {
      ...base, rule: "count", type: IntegerType, zero: 0n,
      add: (t, $, acc) => t.assign($, acc, t.add(acc, t.int(1), path)),
      combine: (t, _$, a, b) => t.add(a, b, path),
      finish: (_t, _$, partial) => partial,
    };
  }
  if (named("add", 0)) {
    const O = checked.typeAt(path)?.type;
    if (O === undefined) return undefined;
    const zero = addZero(O);
    if (zero === undefined) return undefined;
    const site = (t: SplitTranslator, $: Block): CallSite => ({ name: "add", path, args: [], argPaths: [], $, x: t.null(path), env: emptyEnv(), emit: () => {} });
    return {
      ...base, rule: "add", type: O, zero: zero.value,
      add: (t, $, acc, element) => addInto(t, site(t, $), $, acc, element, O),
      combine: (t, $, a, b) => {
        const sum = t.declare($, t.value(zero.value, O), "sum");
        addInto(t, site(t, $), $, sum, a, O);
        addInto(t, site(t, $), $, sum, b, O);
        return sum;
      },
      finish: (_t, _$, partial) => partial,
    };
  }
  if ((named("min", 0) || named("max", 0)) && kind !== "Dict") {
    const min = call.value.name === "min";
    const better = (t: SplitTranslator) => (x: Expr, y: Expr): Expr => min ? t.lt(x, y, path) : t.b("GreaterEqual", [E], [x, y], BooleanType, path);
    return {
      ...base, rule: min ? "min" : "max", type: option, zero: none,
      add: (t, $, acc, element) => {
        const value = t.bind($, element, "element");
        const take = t.matchValue(acc, { none: () => t.bool(true), some: (_$2, b) => better(t)(value, b) }, BooleanType, path);
        t.ifElse($, take, $2 => t.assign($2, acc, t.some(value, option)), undefined, path);
      },
      combine: (t, $, a, b) => pickBetter(t, $, a, b, better(t), option),
      finish: (t, $, partial, env) => representative(t, $, partial, env, p => p),
    };
  }
  if ((named("min_by", 1) || named("max_by", 1)) && kind !== "Dict") {
    const min = call.value.name === "min_by";
    const argPath = childPath(path, "call.args[0]");
    const sample = checked.resultAt(argPath);
    if (sample === null) return undefined;
    const keyOne = sample.mult.lo === 1 && sample.mult.hi === 1;
    const outputKey = checked.typeAt(argPath)?.type;
    if (outputKey === undefined) return undefined;
    const K = keyOne ? outputKey : ArrayType(outputKey);
    const Pair = StructType({ key: K, value: E });
    const pair = OptionType(Pair);
    const better = (t: SplitTranslator) => (x: Expr, y: Expr): Expr =>
      min ? t.lt(t.field(x, "key"), t.field(y, "key"), path) : t.b("GreaterEqual", [K], [t.field(x, "key"), t.field(y, "key")], BooleanType, path);
    return {
      ...base, rule: min ? "min" : "max", type: pair, zero: none,
      add: (t, $, acc, element, env) => {
        const value = t.bind($, element, "element");
        let key: Expr;
        if (keyOne) key = t.one(call.value.args[0]!, argPath, $, value, env, K);
        else {
          const keys = t.declare($, t.emptyArray(outputKey), "keys");
          t.gen(call.value.args[0]!, argPath, $, value, env, ($2, k) => t.push($2, keys, k, path));
          key = keys;
        }
        const candidate = t.bind($, t.struct(Pair, { key, value }), "pair");
        const take = t.matchValue(acc, { none: () => t.bool(true), some: (_$2, b) => better(t)(candidate, b) }, BooleanType, path);
        t.ifElse($, take, $2 => t.assign($2, acc, t.some(candidate, pair)), undefined, path);
      },
      combine: (t, $, a, b) => pickBetter(t, $, a, b, better(t), pair),
      finish: (t, $, partial, env) => representative(t, $, partial, env, p => t.field(p, "value")),
    };
  }
  const firstOrLast = named("first", 0) ? "first" : named("last", 0) ? "last"
    : node.type === "index" && node.value.target.type === "identity" ? indexLiteral(node) : undefined;
  if (firstOrLast !== undefined && kind !== "Dict") {
    const first = firstOrLast === "first";
    return {
      ...base, rule: firstOrLast, type: option, zero: none,
      add: (t, $, acc, element) => {
        if (first) t.match($, acc, { none: $2 => t.assign($2, acc, t.some(element, option)) }, path);
        else t.assign($, acc, t.some(element, option));
      },
      combine: (t, _$, a, b) => first
        ? t.matchValue(a, { none: () => b, some: () => a }, option, path)
        : t.matchValue(b, { none: () => a, some: () => b }, option, path),
      finish: (t, $, partial, env) => representative(t, $, partial, env, p => p),
    };
  }
  if ((named("any", 0) || named("all", 0) || named("any", 1) || named("all", 1))) {
    const any = call.value.name === "any";
    const argPath = childPath(path, "call.args[0]");
    const test = (t: SplitTranslator, $: Block, acc: Expr, v: Expr): void => {
      const truth = t.truthy(v, path);
      if (any) t.branch($, truth, $2 => t.assign($2, acc, t.bool(true)), () => {}, path);
      else t.branch($, truth, () => {}, $2 => t.assign($2, acc, t.bool(false)), path);
    };
    return {
      ...base, rule: any ? "any" : "all", type: BooleanType, zero: !any,
      add: (t, $, acc, element, env) => {
        if (call.value.args.length === 0) test(t, $, acc, element);
        else t.gen(call.value.args[0]!, argPath, $, element, env, ($2, v) => test(t, $2, acc, v));
      },
      combine: (t, _$, a, b) => t.b(any ? "BooleanOr" : "BooleanAnd", [], [a, b], BooleanType, path),
      finish: (_t, _$, partial) => partial,
    };
  }
  if (named("unique", 0) && kind !== "Dict" && isImmutableType(E)) {
    const S = SetType(E);
    return {
      ...base, rule: "union", type: S, zero: new SortedSet([], compareFor(E)),
      add: (t, $, acc, element) => t.stmt($, t.b("SetTryInsert", [E], [acc, element], BooleanType, path)),
      combine: (t, _$, a, b) => t.b("SetUnion", [E], [a, b], S, path),
      finish: (t, $, partial) => t.asArray($, partial, path)!,
    };
  }
  return undefined;
}

/** `first` or `last` for `.[0]` or `.[-1]`. */
function indexLiteral(node: Node<"index">): "first" | "last" | undefined {
  if (node.value.optional) return undefined;
  const index = node.value.index;
  // `.[-1]` is a negated literal.
  const literal = index.type === "literal" ? decodeIndex(index.value)
    : index.type === "negate" && index.value.type === "literal" ? negated(decodeIndex(index.value.value)) : undefined;
  return literal === 0n ? "first" : literal === -1n ? "last" : undefined;
}

/** A whole number negated, or `undefined`. */
function negated(n: bigint | undefined): bigint | undefined {
  return n === undefined ? undefined : -n;
}

/**
 * How many of an array's first elements a step reads, when it reads no others
 * (#942): `.[:n]` and `.[0:n]` its first `n`, `.[k]` its first `k + 1`,
 * `first` its first, and a read into one of those (`.[0].id`, `.[:3][1]`) as
 * many; `undefined` for any other step.
 */
function leadingRows(node: JqNode): number | undefined {
  const count = (n: bigint | undefined): number | undefined => n === undefined || n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER) ? undefined : Number(n);
  const literal = (option: { type: "none" | "some"; value?: any }): bigint | undefined | null =>
    option.type === "none" ? null : (option.value as JqNode).type === "literal" ? decodeIndex((option.value as Extract<JqNode, { type: "literal" }>).value) : undefined;
  if (isCall(node, "first", 0)) return 1;
  switch (node.type) {
    case "field":
      return node.value.target.type === "identity" ? undefined : leadingRows(node.value.target);
    case "index": {
      const { index, target } = node.value;
      if (target.type !== "identity") return readsInput(index) ? undefined : leadingRows(target);
      const k = index.type === "literal" ? count(decodeIndex(index.value)) : undefined;
      return k === undefined ? undefined : k + 1;
    }
    case "slice": {
      const { from, target, to } = node.value;
      if (target.type !== "identity") {
        const bounds = [from, to].every(b => b.type === "none" || !readsInput(b.value as JqNode));
        return bounds ? leadingRows(target) : undefined;
      }
      // From the start, or a literal index of it; to a literal index.
      const a = literal(from);
      const b = literal(to);
      if (a === undefined || (a !== null && count(a) === undefined) || b === null || b === undefined) return undefined;
      return count(b);
    }
    default:
      return undefined;
  }
}

// ─── Values and zeros ───────────────────────────────────────────────────────

/** An Integer literal's value, or `undefined`. */
function decodeIndex(blob: Uint8Array): bigint | undefined {
  const { value } = decodeBeast2(blob);
  return typeof value === "bigint" ? value : undefined;
}

/** `add`'s start, as the `add` rule starts: its identity, for its output type. */
function addZero(type: EastType): { value: unknown } | undefined {
  const t = unwrap(type);
  switch (t.type) {
    case "Null": return { value: null };
    case "Integer": return { value: 0n };
    case "Float": return { value: 0 };
    case "String": return { value: "" };
    case "Array": return { value: [] };
    case "Dict": return { value: new SortedMap([], compareFor(t.key as EastType)) };
    case "Variant": return t.cases !== undefined && "none" in (t.cases as object) ? { value: none } : undefined;
    default: return undefined;
  }
}

/** An environment with nothing in scope. */
function emptyEnv(): Env {
  return { vars: new Map(), defs: new Map(), labels: new Map(), instance: "", recursion: new Map() };
}

// ─── The translator, with holes ─────────────────────────────────────────────

/**
 * The translator for a part of a checked program: a node whose value is known
 * — a total the pieces computed, a map the totals read through — is a hole,
 * and gives that value where the program reaches it.
 */
class SplitTranslator extends Translator {
  readonly holes = new Map<string, Expr>();

  constructor(checked: CheckJqResult, options: TranslateJqOptions) {
    super(checked, options);
  }

  override gen(node: JqNode, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const hole = this.holes.get(path);
    if (hole === undefined) { super.gen(node, path, $, x, env, emit); return; }
    if (!this.ended($)) emit($, hole);
  }
}

// ─── The combine ────────────────────────────────────────────────────────────

/** How the rows combine, and what the final function starts from. */
type Combine =
  | { readonly kind: "concat" }
  | { readonly kind: "totals"; readonly path: string; readonly node: JqNode; readonly totals: Totals }
  | { readonly kind: "group"; readonly path: string; readonly mapPath: string; readonly key: { readonly node: JqNode; readonly path: string; readonly type: EastType }; readonly body: { readonly node: JqNode; readonly path: string }; readonly totals: Totals | null }
  | { readonly kind: "distinct"; readonly path: string }
  | { readonly kind: "distinct_by"; readonly path: string; readonly key: { readonly node: JqNode; readonly path: string; readonly type: EastType } }
  | { readonly kind: "reduce"; readonly path: string; readonly node: Node<"reduce">; readonly accType: EastType; readonly keyType: EastType; readonly valueType: EastType; readonly update: "add" | "replace" }
  | { readonly kind: "top"; readonly path: string; readonly keepPath: string; readonly key: SortKey | null; readonly rows: number; readonly element: EastType };

/**
 * How `sort_by(g)` keys a row, as the translator keys it (`keyed` in
 * `translate-builtins.ts`): `g`'s one output, or the array of its outputs.
 */
interface SortKey {
  readonly node: JqNode;
  readonly path: string;
  /** The key's type: `g`'s type, or an array of it. */
  readonly type: EastType;
  /** Whether `g` gives exactly one output. */
  readonly one: boolean;
}

/** What a split is made of: its row work, how the rows combine, and the steps after. */
interface Plan {
  readonly rows: Rows;
  readonly combine: Combine;
  /** The pipeline's steps after the combine, which the final function runs. */
  readonly rest: readonly Step[];
  /** The rows' type as they leave the row work. */
  readonly rowType: EastType;
  /** The value's type where the row work ends: the collection the combine reads. */
  readonly cutType: EastType;
}

/** The type of the value after a path, as the checker gave it. */
function typeAfter(checked: CheckJqResult, path: string): EastType {
  const type = checked.typeAt(path)?.type;
  if (type === undefined) throw new TranslationError(`no type for the node at ${path || "the root"}`);
  return type;
}

/** The type of each row as the row work leaves it: a binding passes its row on. */
function rowTypeOf(checked: CheckJqResult, rows: Rows): EastType {
  const last = [...rows.steps].reverse().find(s => s.kind !== "bind");
  if (last === undefined) {
    // A dict read as its entries: the rows are `to_entries`' elements.
    const elements = elementsOf(typeAfter(checked, rows.source.entries ?? rows.source.path));
    if (elements === undefined) throw new TranslationError(`.${rows.source.over} is not a collection`);
    return elements.element;
  }
  switch (last.kind) {
    case "map": case "flatten": return parts(typeAfter(checked, last.path)).value;
    case "as": return last.element ? parts(typeAfter(checked, last.path)).value : typeAfter(checked, last.path);
    default: return typeAfter(checked, last.path);
  }
}

/** A key a node gives on each row, when it is one value a dict can hold. */
function keyOf(checked: CheckJqResult, path: string): EastType | undefined {
  const result = checked.resultAt(path);
  if (result === null || result.mult.lo !== 1 || result.mult.hi !== 1) return undefined;
  const type = checked.typeAt(path)?.type;
  return type !== undefined && isImmutableType(type) ? type : undefined;
}

/**
 * How the rows combine: the step after the row work, when it is one the
 * pieces can combine for.
 */
function findCombine(checked: CheckJqResult, rows: Rows): { combine: Combine; rest: readonly Step[] } | { whole: JqWholeReason } | undefined {
  const [next, after] = [rows.after[0], rows.after[1]];
  const elements = rows.elements;
  if (next === undefined || next.kind !== "stage" || elements === undefined) return undefined;
  const node = next.node;
  const at = (step: string): string => childPath(next.path, step);
  const kind = unwrap(elements.type).type;
  const exactlyOne = (path: string): boolean => {
    const r = checked.resultAt(path);
    return r !== null && r.mult.lo === 1 && r.mult.hi === 1;
  };

  if (isCall(node, "group_by", 1) && kind !== "Dict" && after?.kind === "stage" && isCall(after.node, "map", 1)) {
    const keyPath = at("call.args[0]");
    const keyType = keyOf(checked, keyPath);
    if (keyType === undefined) return { whole: reason(checked, "key", keyPath) };
    const bodyPath = childPath(after.path, "call.args[0]");
    const body = after.node.value.args[0]!;
    // Each group is an array of the rows, as `group_by` gives it.
    const group = elementsOf(parts(typeAfter(checked, next.path)).value);
    const out = { leaves: [] as Leaf[], maps: [] as MapContext[] };
    const decomposed = group !== undefined && exactlyOne(bodyPath) && decompose(checked, body, bodyPath, group, [], out);
    return {
      combine: {
        kind: "group", path: next.path, mapPath: after.path,
        key: { node: node.value.args[0]!, path: keyPath, type: keyType },
        body: { node: body, path: bodyPath },
        totals: decomposed ? out : null,
      },
      rest: rows.after.slice(2),
    };
  }
  if (isCall(node, "unique", 0) && kind !== "Dict" && isImmutableType(elements.element)) {
    return { combine: { kind: "distinct", path: next.path }, rest: rows.after.slice(1) };
  }
  if (isCall(node, "unique_by", 1) && kind !== "Dict") {
    const keyPath = at("call.args[0]");
    const keyType = keyOf(checked, keyPath);
    if (keyType === undefined) return { whole: reason(checked, "key", keyPath) };
    return { combine: { kind: "distinct_by", path: next.path, key: { node: node.value.args[0]!, path: keyPath, type: keyType } }, rest: rows.after.slice(1) };
  }
  if (node.type === "reduce") {
    const reduce = reduceOf(checked, node, next.path);
    return reduce === undefined ? undefined : { combine: reduce, rest: rows.after.slice(1) };
  }
  // `sort_by(g) | .[:n]`, `sort | first`: the first rows of a sort, each piece's kept (#942).
  if ((isCall(node, "sort_by", 1) || isCall(node, "sort", 0)) && kind !== "Dict" && after?.kind === "stage") {
    const kept = leadingRows(after.node);
    if (kept !== undefined) {
      const element = parts(typeAfter(checked, next.path)).value;
      let key: SortKey | null = null;
      if (node.value.args.length === 1) {
        const argPath = at("call.args[0]");
        const sample = checked.resultAt(argPath);
        const output = checked.typeAt(argPath)?.type;
        if (sample === null || output === undefined) return undefined;
        const one = sample.mult.lo === 1 && sample.mult.hi === 1;
        key = { node: node.value.args[0]!, path: argPath, type: one ? output : ArrayType(output), one };
      }
      return { combine: { kind: "top", path: next.path, keepPath: after.path, key, rows: kept, element }, rest: rows.after.slice(1) };
    }
  }
  const out = { leaves: [] as Leaf[], maps: [] as MapContext[] };
  if (exactlyOne(next.path) && decompose(checked, node, next.path, elements, [], out) && out.leaves.length > 0) {
    return { combine: { kind: "totals", path: next.path, node, totals: out }, rest: rows.after.slice(1) };
  }
  return undefined;
}

/** `reduce .[] as $x ({}; .[k] += v)`, or `= v`: a dict its updates combine into by key. */
function reduceOf(checked: CheckJqResult, node: Node<"reduce">, path: string): Extract<Combine, { kind: "reduce" }> | undefined {
  const { init, source, update } = node.value;
  // Over the collection's rows, `.[]`, or the dataset's own, `.D[]`.
  if (!isIterate(source) && rootStream(source) === undefined) return undefined;
  if (init.type !== "object" || init.value.length !== 0) return undefined;
  if (update.type !== "update" || (update.value.op !== "+=" && update.value.op !== "=")) return undefined;
  const target = update.value.path;
  if (target.type !== "index" || target.value.optional || target.value.target.type !== "identity") return undefined;
  const updatePath = childPath(path, "reduce.update");
  const keyPath = childPath(updatePath, "update.path.index.index");
  const valuePath = childPath(updatePath, "update.value");
  if (readsInput(target.value.index) || readsInput(update.value.value)) return undefined;
  const one = (at: string): boolean => {
    const r = checked.resultAt(at);
    return r !== null && r.mult.lo === 1 && r.mult.hi === 1;
  };
  if (!one(keyPath) || !one(valuePath)) return undefined;
  const accType = checked.typeAt(`${path}#acc`)?.type;
  if (accType === undefined) return undefined;
  const acc = unwrap(accType);
  if (acc.type !== "Dict" || !isImmutableType(acc.key as EastType)) return undefined;
  return {
    kind: "reduce", path, node, accType,
    keyType: acc.key as EastType, valueType: acc.value as EastType,
    update: update.value.op === "+=" ? "add" : "replace",
  };
}

// ─── Splitting ──────────────────────────────────────────────────────────────

/**
 * Splits a checked query over one dataset's pieces, or says why it runs as one
 * unit.
 *
 * @param checked - what `checkJq` made of the query, checked as an e3 root; it
 *   must have no error
 * @param options - `maxOutputs` for a `many` query's limit
 * @returns the split call's parts, or the reason it runs as one unit, with the
 *   reads that skip what they don't need either way
 * @throws {TranslationError} When the query does not check, or was not checked
 *   as an e3 root.
 *
 * @remarks
 * A query splits when its pipeline reads one root dataset, `.D`, `.D[]` or
 * `[.D[] | f]`, and works through its rows: `map(f)`, `[.[] | f]`, `flatten`,
 * and every step of a stream. Then:
 * - **totals** over the rows (`length`, `add`, `min` / `max` and `_by`,
 *   `.[0]` / `first`, `.[-1]` / `last`, `any`, `all`, `unique`, each perhaps
 *   after `map(g)`, inside any expression of them) fold;
 * - `group_by(k) | map(E)` combines by key, `E`'s totals field by field, or
 *   each group's rows collected when `E` is not made of totals;
 * - `unique` is a set, and `unique_by(g)` a dict keeping each key's first row;
 * - `reduce .[] as $x ({}; .[k] += v)`, or `= v`, combines by key;
 * - anything else after the row work runs once, over the rows concatenated.
 *
 * Bindings before the stream, `.C as $c | …`, reach every piece: each piece
 * reads their datasets whole. A query whose row work stops early (a stream's
 * own outputs, `first`, `limit`) runs as one unit, which reads only as far as
 * it needs.
 *
 * @example
 * ```ts
 * const Order = StructType({ region: StringType, total: FloatType });
 * const root = StructType({ orders: ArrayType(Order) });
 * const checked = checkJq(".orders | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add})", root, { root: true });
 * const split = splitJq(checked);
 * split.kind;                       // "split"
 * split.output.kind;                // "dict": revenue by region, added
 * ```
 */
export function splitJq(checked: CheckJqResult, options: SplitJqOptions = {}): JqSplit {
  if (checked.query === null || checked.rewritten === null || checked.elementType === null || checked.multiplicity === null) {
    const errors = checked.diagnostics.filter(d => d.severity.type === "error").map(d => d.message);
    throw new TranslationError(`the program does not check: ${errors.join(" ")}`);
  }
  if (!checked.source.root) throw new TranslationError("splitJq splits a query checked as an e3 root");
  const program = checked.rewritten;
  const pruning = pruningOf(checked, program);
  const whole = (r: JqWholeReason): JqWhole => ({ kind: "whole", reason: r, pruning });

  const found = findRows(checked, program);
  if ("whole" in found) return whole(found.whole);
  const rows = found.rows;
  if (rows.stream && rows.after.length === 0) {
    // A stream is the query's outputs, which its caller caps: one unit stops as soon as it has them.
    return { kind: "whole", reason: reason(checked, "stops_early", null, rows.source.over), pruning: [...pruning, { kind: "stop", name: rows.source.over, range: rangeOf(checked, rows.source.path) }] };
  }
  const combined = findCombine(checked, rows);
  if (combined !== undefined && "whole" in combined) return whole(combined.whole);
  let combine: Combine;
  let rest: readonly Step[];
  if (combined !== undefined) {
    ({ combine, rest } = combined);
    // Totals with no work done to the rows, each read from the index or an end
    // of the dataset, are cheaper as one unit, which reads only those.
    if (combine.kind === "totals" && !rows.work && combine.totals.leaves.every(l => l.maps.length === 0 && (l.rule === "count" || l.rule === "first" || l.rule === "last"))) {
      const ends = combine.totals.leaves.find(l => l.rule !== "count");
      return whole(ends === undefined ? reason(checked, "no_stream", null, rows.source.over) : reason(checked, "position", ends.path, nodeName(ends.node)));
    }
  } else {
    const next = rows.after[0];
    if (!rows.work) {
      if (next === undefined) return whole(reason(checked, "no_stream", null, rows.source.over));
      return whole(whyNot(checked, next, rows.source.over));
    }
    // The rows are concatenated, and everything after them runs once.
    if (unwrap(typeAfter(checked, rows.end)).type !== "Array") return whole(reason(checked, "shape", rows.end));
    combine = { kind: "concat" };
    rest = rows.after;
  }
  const plan: Plan = { rows, combine, rest, rowType: rowTypeOf(checked, rows), cutType: typeAfter(checked, rows.end) };
  return splitCall(checked, plan, options, pruning);
}

/** Why the step after a query's row work keeps it one unit, when no work is done row by row. */
function whyNot(checked: CheckJqResult, step: Step, over: string): JqWholeReason {
  if (step.kind === "bind") return reason(checked, "every_row", step.path, "as");
  const node = step.node;
  // A key seek: one segment, not the rows.
  if (node.type === "call" && node.value.name === "has" && node.value.args.length === 1) return reason(checked, "no_stream", null, over);
  if (node.type === "slice" || (node.type === "index" && node.value.target.type === "identity")) return reason(checked, "position", step.path, node.type);
  if (node.type === "call" && POSITIONAL.has(node.value.name)) return reason(checked, "position", step.path, node.value.name);
  if (node.type === "foreach") return reason(checked, "state", step.path, "foreach");
  if (node.type === "call" && EVERY_ROW.has(node.value.name)) return reason(checked, "every_row", step.path, node.value.name);
  if (node.type === "reduce") return reason(checked, "state", step.path, "reduce");
  return reason(checked, "every_row", step.path, nodeName(node));
}

/** The reads a query makes that skip what they don't need: counts from the index, key seeks. */
function pruningOf(checked: CheckJqResult, program: JqNode): JqPruning[] {
  const out: JqPruning[] = [];
  const steps = pipeline(program, "");
  const visitPipeline = (list: readonly Step[]): void => {
    list.forEach((step, i) => {
      if (step.kind === "bind") {
        visitPipeline(pipeline(step.node.value.source, childPath(step.path, "bind.source")));
        return;
      }
      const field = rootField(step.node, true);
      const next = list[i + 1];
      if (field !== undefined && next?.kind === "stage") {
        if (isCall(next.node, "length", 0)) out.push({ kind: "count", name: field, range: spanning(checked, step.path, next.path) });
        if (isCall(next.node, "has", 1) && unwrap(typeAfter(checked, step.path)).type === "Dict") out.push({ kind: "seek", name: field, range: spanning(checked, step.path, next.path) });
      }
      if (step.node.type === "index") {
        const target = rootField(step.node.value.target, true);
        if (target !== undefined && unwrap(typeAfter(checked, childPath(step.path, "index.target"))).type === "Dict") {
          out.push({ kind: "seek", name: target, range: rangeOf(checked, step.path) });
        }
      }
    });
  };
  visitPipeline(steps);
  return out;
}

// ─── Joins (#942) ───────────────────────────────────────────────────────────

/**
 * What is known where a node of the row work runs: whether `.` is the row as
 * the dataset gives it, and the variables that hold it, or a field of it.
 */
interface RowContext {
  /** `.` is the row, as the dataset gives it. */
  readonly row: boolean;
  /** Variables holding the row, as the dataset gives it. */
  readonly rows: ReadonlySet<string>;
  /** Variables holding a field of the row, by the field names from the row to it. */
  readonly fields: ReadonlyMap<string, readonly string[]>;
  /** The defs in scope, by `name/arity`: what a call of one reads is not followed. */
  readonly defs: ReadonlySet<string>;
}

/** A lookup of a joined dict at a field of the row: the field names from the row to the key, and the key's path. */
interface Lookup {
  readonly fields: readonly string[];
  readonly path: string;
}

/** Builtins whose arguments run on the call's own input, so `.` in them is what it is at the call. */
const SAME_INPUT: ReadonlySet<string> = new Set([
  "select", "has", "in", "contains", "inside", "startswith", "endswith", "ltrimstr", "rtrimstr", "trimstr", "test", "split",
  "join", "error", "isempty", "first", "last", "nth", "limit", "skip", "index", "rindex", "indices", "range", "IN",
]);

/** Whether a filter gives its input, or nothing: `.`, `select(f)`, and pipes of them. */
function keepsInput(node: JqNode): boolean {
  if (node.type === "identity") return true;
  if (isCall(node, "select", 1)) return true;
  return node.type === "pipe" && keepsInput(node.value.left) && keepsInput(node.value.right);
}

/** The field names from the row to a node's value, when it reads a field of the row: `.a.b` where `.` is the row, `$r.a` where `$r` holds it, `$k` where `$k` holds one. */
function rowField(node: JqNode, cx: RowContext): readonly string[] | undefined {
  if (node.type === "variable") return cx.fields.get(node.value);
  if (node.type !== "field" || node.value.optional) return undefined;
  const target = node.value.target;
  if (target.type === "identity") return cx.row ? [node.value.name] : undefined;
  if (target.type === "variable" && cx.rows.has(target.value)) return [node.value.name];
  const inner = rowField(target, cx);
  return inner === undefined ? undefined : [...inner, node.value.name];
}

/** A context without some variables, which a pattern binds anew. */
function forgetting(cx: RowContext, names: readonly string[]): RowContext {
  if (names.length === 0) return cx;
  return {
    ...cx,
    rows: new Set([...cx.rows].filter(v => !names.includes(v))),
    fields: new Map([...cx.fields].filter(([v]) => !names.includes(v))),
  };
}

/** The context in a binding's body: the pattern's variables bound, one holding the row or a field of it when its source does. */
function binding(cx: RowContext, pattern: JqPattern, source: JqNode): RowContext {
  const next = forgetting(cx, patternNames(pattern));
  if (pattern.type !== "variable") return next;
  if (source.type === "identity" && cx.row) return { ...next, rows: new Set([...next.rows, pattern.value]) };
  const fields = rowField(source, cx);
  return fields === undefined || fields.length === 0 ? next : { ...next, fields: new Map([...next.fields, [pattern.value, fields]]) };
}

/**
 * Whether every read of `$name` in a node is a lookup at a field of the row:
 * `$name[.k]`, `$name[$r.k]`, `$name[$k]`, or `$name | has($k)`. Each lookup
 * is added to `found`. Conservative: what it cannot follow, a def's body or
 * a builtin whose arguments run on other values, reads `$name` otherwise.
 */
function lookupsOnly(node: JqNode, path: string, cx: RowContext, name: string, found: Lookup[]): boolean {
  const at = (step: string): string => childPath(path, step);
  const visit = (child: JqNode, step: string, inner: RowContext = cx): boolean => lookupsOnly(child, at(step), inner, name, found);
  const away: RowContext = { ...cx, row: false };
  switch (node.type) {
    case "variable":
      return node.value !== name;
    case "index": {
      const { index, target } = node.value;
      if (target.type === "variable" && target.value === name) {
        const fields = rowField(index, cx);
        if (fields === undefined || fields.length === 0) return false;
        found.push({ fields, path: at("index.index") });
        return true;
      }
      return visit(target, "index.target") && visit(index, "index.index");
    }
    case "pipe": {
      const { left, right } = node.value;
      if (left.type === "variable" && left.value === name) {
        // `$name | has($k)`, perhaps piped on (`| not`): has's key runs on `$name`, so only a variable holding a field of the row is one.
        let has = right;
        let hasPath = at("pipe.right");
        while (has.type === "pipe") {
          has = has.value.left;
          hasPath = childPath(hasPath, "pipe.left");
        }
        if (!isCall(has, "has", 1) || variablesIn(right).has(name)) return false;
        const fields = rowField(has.value.args[0]!, away);
        if (fields === undefined || fields.length === 0) return false;
        found.push({ fields, path: childPath(hasPath, "call.args[0]") });
        return true;
      }
      return visit(left, "pipe.left") && visit(right, "pipe.right", { ...cx, row: cx.row && keepsInput(left) });
    }
    case "bind": {
      const { body, patterns, source } = node.value;
      if (!visit(source, "bind.source")) return false;
      if (patterns.length !== 1) return !variablesIn(body).has(name);
      // A body where the pattern binds `$name` again reads another value.
      if (patternNames(patterns[0]!).includes(name)) return true;
      return visit(body, "bind.body", binding(cx, patterns[0]!, source));
    }
    case "reduce": case "foreach": {
      const v = node.value;
      if (!visit(v.source, `${node.type}.source`) || !visit(v.init, `${node.type}.init`)) return false;
      const names = patternNames(v.pattern);
      if (names.includes(name)) return true;
      // The update, and an extract, run on the state.
      const state: RowContext = { ...forgetting(cx, names), row: false };
      if (!visit(v.update, `${node.type}.update`, state)) return false;
      return node.type === "reduce" || node.value.extract.type === "none" || visit(node.value.extract.value as JqNode, "foreach.extract.some", state);
    }
    case "call": {
      const { args } = node.value;
      if (cx.defs.has(`${node.value.name}/${args.length}`)) return args.every(arg => !variablesIn(arg).has(name));
      const same = SAME_INPUT.has(node.value.name);
      return args.every((arg, i) => visit(arg, `call.args[${i}]`, same ? cx : away));
    }
    case "object":
      return node.value.every((entry, i) => {
        if (entry.key.type === "variable" && entry.value.type === "none") return entry.key.value !== name;
        if (entry.key.type === "computed" && !visit(entry.key.value as JqNode, `object[${i}].key.computed`)) return false;
        return entry.value.type === "none" || visit(entry.value.value as JqNode, `object[${i}].value.some`);
      });
    case "try":
      // The handler runs on the error's message.
      return visit(node.value.body, "try.body") && (node.value.catch.type === "none" || visit(node.value.catch.value as JqNode, "try.catch.some", away));
    case "update":
      // `|=`'s value runs on each position, the others' on `.`.
      return visit(node.value.path, "update.path") && visit(node.value.value, "update.value", node.value.op === "|=" ? away : cx);
    case "def": {
      if (variablesIn(node.value.body).has(name)) return false;
      return visit(node.value.rest, "def.rest", { ...cx, defs: new Set([...cx.defs, `${node.value.name}/${node.value.params.length}`]) });
    }
    default:
      return jqChildren(node).every(child => child.node === undefined || visit(child.node, child.step));
  }
}

/**
 * Every lookup the pieces make of a dict bound before the stream to `$name`,
 * each at a field of the row as the dataset gives it; `undefined` when a
 * piece reads it otherwise — whole, or at another key — or a later binding
 * every piece makes reads it.
 */
function rowLookups(plan: Plan, name: string): Lookup[] | undefined {
  const found: Lookup[] = [];
  const binds = plan.rows.binds;
  const bound = binds.findIndex(b => patternNames(b.node.value.patterns[0]!).includes(name));
  if (binds.slice(bound + 1).some(b => variablesIn(b.node.value.source).has(name))) return undefined;
  let cx: RowContext = { row: true, rows: new Set(), fields: new Map(), defs: new Set() };
  // The rows are the dataset's own until a step makes others.
  let intact = true;
  for (const step of plan.rows.steps) {
    const here: RowContext = { ...cx, row: intact };
    switch (step.kind) {
      case "as":
        break;
      case "flatten":
        intact = false;
        break;
      case "map": {
        const arg = step.node.value.args[0]!;
        if (!lookupsOnly(arg, childPath(step.path, "call.args[0]"), here, name, found)) return undefined;
        intact = intact && keepsInput(arg);
        break;
      }
      case "each":
        if (!lookupsOnly(step.node, step.path, here, name, found)) return undefined;
        intact = intact && keepsInput(step.node);
        break;
      case "bind": {
        const { patterns, source } = step.node.value;
        if (!lookupsOnly(source, childPath(step.path, "bind.source"), here, name, found)) return undefined;
        // From here on `$name` is another value.
        if (patternNames(patterns[0]!).includes(name)) return found;
        cx = binding(here, patterns[0]!, source);
        break;
      }
    }
  }
  const end: RowContext = { ...cx, row: intact };
  const c = plan.combine;
  const visit = (node: JqNode, path: string, inner: RowContext): boolean => lookupsOnly(node, path, inner, name, found);
  // A total runs on the rows together, never on one row.
  const totalsRead = (totals: Totals | null): boolean => totals !== null && [...totals.maps.map(m => m.node), ...totals.leaves.map(l => l.node)].some(n => variablesIn(n).has(name));
  switch (c.kind) {
    case "totals":
      return totalsRead(c.totals) ? undefined : found;
    case "group":
      return visit(c.key.node, c.key.path, end) && !totalsRead(c.totals) ? found : undefined;
    case "distinct_by":
      return visit(c.key.node, c.key.path, end) ? found : undefined;
    case "top":
      return c.key === null || visit(c.key.node, c.key.path, end) ? found : undefined;
    case "reduce": {
      const v = c.node.value;
      const names = patternNames(v.pattern);
      if (names.includes(name)) return found;
      let inner = forgetting(cx, names);
      if (intact && v.pattern.type === "variable") inner = { ...inner, rows: new Set([...inner.rows, v.pattern.value]) };
      const state: RowContext = { ...inner, row: false };
      return visit(v.init, childPath(c.path, "reduce.init"), { ...cx, row: false }) && visit(v.update, childPath(c.path, "reduce.update"), state) ? found : undefined;
    }
    default:
      return found;
  }
}

/**
 * Whether every binding before the stream that reads a dataset binds it whole
 * to one variable, `.B as $b`, which the pieces read only at fields of the
 * row: every lookup, by the field names from the row.
 */
function joinedAt(plan: Plan, dataset: string): Lookup[] | undefined {
  const binds = plan.rows.binds.filter(b => rootFieldsRead(b.node.value.source).includes(dataset));
  const found: Lookup[] = [];
  for (const b of binds) {
    const pattern = b.node.value.patterns[0]!;
    if (pattern.type !== "variable" || rootField(b.node.value.source, true) !== dataset) return undefined;
    const lookups = rowLookups(plan, pattern.value);
    if (lookups === undefined) return undefined;
    found.push(...lookups);
  }
  return found;
}

/** Whether two lists of field names are the same. */
function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/** The type of a field a row reads through struct fields alone, or `undefined`. */
function fieldType(row: EastType, fields: readonly string[]): EastType | undefined {
  let t: EastType = row;
  for (const name of fields) {
    const s = unwrap(t);
    if (s.type !== "Struct" || !(name in (s.fields as object))) return undefined;
    t = (s.fields as Record<string, EastType>)[name]!;
  }
  return t;
}

/**
 * The datasets a split call partitions with the one it is cut from (#942):
 * dicts keyed as it is, bound before the stream and read by the pieces only at
 * the row's key — the rows being the dataset's entries, `{key, value}`
 * (`.A | to_entries | map(… $b[.key] …)`). Cut at the same keys, a piece of
 * each holds the same keys, so a row's lookup finds in its piece what it
 * would find in the whole.
 */
function copartitionedOf(plan: Plan, inputs: readonly { name: string; type: EastType }[]): string[] {
  const source = plan.rows.source;
  if (source.entries === undefined) return [];
  const A = unwrap(inputs.find(i => i.name === source.over)!.type);
  if (A.type !== "Dict") return [];
  const out: string[] = [];
  for (const dataset of new Set(plan.rows.binds.flatMap(b => rootFieldsRead(b.node.value.source)))) {
    const B = inputs.find(i => i.name === dataset);
    if (dataset === source.over || B === undefined) continue;
    const t = unwrap(B.type);
    if (t.type !== "Dict" || !isTypeEqual(t.key as EastType, A.key as EastType)) continue;
    const lookups = joinedAt(plan, dataset);
    if (lookups === undefined || lookups.length === 0 || !lookups.every(l => sameFields(l.fields, ["key"]))) continue;
    out.push(dataset);
  }
  return out;
}

/** The field names a node reads from `.`, `.a.b`, or `undefined` for another node. */
function fieldsRead(node: JqNode): readonly string[] | undefined {
  if (node.type !== "field" || node.value.optional) return undefined;
  if (node.value.target.type === "identity") return [node.value.name];
  const inner = fieldsRead(node.value.target);
  return inner === undefined ? undefined : [...inner, node.value.name];
}

/** The node at a path inside a node at another. */
function nodeAt(node: JqNode, path: string, wanted: string): JqNode | undefined {
  if (path === wanted) return node;
  for (const child of jqChildren(node)) {
    if (child.node === undefined) continue;
    const at = childPath(path, child.step);
    if (wanted === at || wanted.startsWith(`${at}.`)) return nodeAt(child.node, at, wanted);
  }
  return undefined;
}

/**
 * Whether a group's total is order-blind: it counts, adds numbers, takes the
 * least or the greatest value, tests, or unites — or it is the group's first
 * or last row read at the group's own key (`.[0].region`, grouped by
 * `.region`), which every row of the group shares.
 */
function leafOrderBlind(leaf: Leaf, group: { readonly body: { readonly node: JqNode; readonly path: string }; readonly key: readonly string[] | undefined } | undefined): boolean {
  switch (leaf.rule) {
    case "count": case "any": case "all": case "union":
      return true;
    case "min": case "max":
      // `min_by` and `max_by` keep the first least and the last greatest: on a tie, the order decides.
      return !(leaf.node.type === "call" && (leaf.node.value.name === "min_by" || leaf.node.value.name === "max_by"));
    case "add": {
      const t = unwrap(nullablePayload(unwrap(leaf.type)) ?? leaf.type);
      return t.type === "Integer" || t.type === "Float" || t.type === "Null";
    }
    case "first": case "last": {
      if (group === undefined || group.key === undefined || leaf.maps.length > 0) return false;
      // The field reads around the total, from it outward.
      const read: string[] = [];
      let path = leaf.path;
      while (read.length < group.key.length && path.endsWith(".field.target")) {
        path = path.slice(0, -".field.target".length);
        const node = nodeAt(group.body.node, group.body.path, path);
        if (node?.type !== "field" || node.value.optional) return false;
        read.push(node.value.name);
      }
      return sameFields(read, group.key);
    }
  }
}

/**
 * Whether a combine gives the same answer whatever order its rows come in, as
 * re-keyed rows come, grouped by their key (#942): totals that are all
 * order-blind, a grouping by them, `unique`, and a `reduce` that adds numbers.
 * A Float sum is added in another grouping, as any split's is.
 */
function orderBlind(plan: Plan): boolean {
  const c = plan.combine;
  switch (c.kind) {
    case "totals":
      return c.totals.leaves.every(leaf => leafOrderBlind(leaf, undefined));
    case "group":
      return c.totals !== null && c.totals.leaves.every(leaf => leafOrderBlind(leaf, { body: c.body, key: fieldsRead(c.key.node) }));
    case "distinct":
      return true;
    case "reduce": {
      const t = unwrap(c.valueType);
      return c.update === "add" && (t.type === "Integer" || t.type === "Float");
    }
    default:
      return false;
  }
}

// ─── Building the call ──────────────────────────────────────────────────────

/** The input names and types of a split's programs: the root fields the query reads, as `translateJq` takes them. */
function inputsOf(checked: CheckJqResult): { name: string; type: EastType }[] {
  const fields = parts(unwrap(fromEastTypeValue(checked.query!.value.input_type))).fields;
  return checked.reads.map(name => ({ name, type: fields[name]! }));
}

/** The parts of the split call for a plan. */
function splitCall(checked: CheckJqResult, plan: Plan, options: SplitJqOptions, pruning: readonly JqPruning[]): JqSplitCall {
  const inputs = inputsOf(checked);
  if (!inputs.some(i => i.name === plan.rows.source.over)) throw new TranslationError(`.${plan.rows.source.over} is not one of the query's inputs`);
  const element = checked.elementType!;
  const multiplicity = checked.multiplicity!;
  const resultType = multiplicity === "one" ? element : multiplicity === "maybe" ? OptionType(element) : ArrayType(element);
  const output = outputOf(checked, plan);
  const rangeEnd = plan.rest.length === 0 ? null : spanning(checked, plan.rest[0]!.path, plan.rest[plan.rest.length - 1]!.path);
  // The assembled rows are the result when nothing follows them and they are its type.
  const thenNeeded = !(plan.combine.kind === "concat" && plan.rest.length === 0 && multiplicity === "one" && isTypeEqual(output.type, resultType));
  const copartitioned = copartitionedOf(plan, inputs);
  return {
    kind: "split",
    over: plan.rows.source.over,
    inputs,
    resultType,
    output,
    piece: () => pieceProgram(checked, plan, inputs, output, options),
    then: () => thenNeeded ? thenProgram(checked, plan, inputs, output, resultType, options) : null,
    stages: {
      piece: spanning(checked, plan.rows.start, plan.rows.end),
      combine: combineOf(checked, plan),
      then: rangeEnd,
    },
    broadcast: [...new Set(plan.rows.binds.flatMap(bind => rootFieldsRead(bind.node.value.source)))].filter(name => !copartitioned.includes(name)),
    copartitioned,
    rekey: copartitioned.length > 0 ? null : rekeyOf(checked, plan, inputs, output, resultType, thenNeeded, options),
    pruning,
  };
}

/**
 * The re-keyed join a split can make instead of reading a dict whole in every
 * piece (#942): the one dict, bound before the stream, that the pieces read
 * only at one field of the row as the dataset gives it — of the dict's key
 * type — when the combine is order-blind; `null` when there is none, or more
 * than one.
 */
function rekeyOf(
  checked: CheckJqResult, plan: Plan, inputs: readonly { name: string; type: EastType }[], output: JqSplitOutput,
  resultType: EastType, thenNeeded: boolean, options: SplitJqOptions,
): JqRekey | null {
  const source = plan.rows.source;
  if (source.entries !== undefined || !orderBlind(plan)) return null;
  const A = inputs.find(i => i.name === source.over)!;
  const elements = elementsOf(A.type);
  if (elements === undefined) return null;
  const R = elements.element;
  const joins: { name: string; fields: readonly string[]; key: EastType; range: JqRange }[] = [];
  for (const dataset of new Set(plan.rows.binds.flatMap(b => rootFieldsRead(b.node.value.source)))) {
    const B = inputs.find(i => i.name === dataset);
    if (dataset === source.over || B === undefined) continue;
    const t = unwrap(B.type);
    if (t.type !== "Dict") continue;
    const lookups = joinedAt(plan, dataset);
    if (lookups === undefined || lookups.length === 0) continue;
    const fields = lookups[0]!.fields;
    const key = fieldType(R, fields);
    if (!lookups.every(l => sameFields(l.fields, fields)) || key === undefined || !isTypeEqual(key, t.key as EastType)) continue;
    joins.push({ name: dataset, fields, key, range: rangeOf(checked, lookups[0]!.path) });
  }
  if (joins.length !== 1) return null;
  const join = joins[0]!;
  const Rows = ArrayType(R);
  const Keyed = DictType(join.key, Rows);
  const joinInputs = inputs.map(i => i.name === source.over ? { name: i.name, type: Keyed } : i);
  // Each key's rows, in input order: a re-keyed piece's rows.
  const rekeyed: SourceRows = (t, $, piece, each) => t.forEach($, piece, ($2, rows) => t.forEach($2, rows, ($3, item) => each($3, item), source.path, "row"), source.path, "rows");
  return {
    name: join.name,
    key: join.range,
    keyType: join.key,
    output: { kind: "dict", type: Keyed, merge: () => mergeFunction(checked, join.key, Rows, (t, _$, earlier, later) => t.b("ArrayConcat", [R], [earlier, later], Rows, source.path)) },
    piece: () => rekeyPiece(checked, A.type, R, join.fields, join.key, source, options),
    inputs: joinInputs,
    joinPiece: () => pieceProgram(checked, plan, joinInputs, output, options, rekeyed),
    joinThen: () => thenNeeded ? thenProgram(checked, plan, joinInputs, output, resultType, options) : null,
  };
}

/**
 * The re-key call's piece program (#942): each row of the piece sent on under
 * its join key, a key's rows gathered first in the piece's table, appended in
 * place, since the table alone holds them until it sends them on.
 */
function rekeyPiece(checked: CheckJqResult, A: EastType, R: EastType, fields: readonly string[], K: EastType, source: Source, options: SplitJqOptions): FunctionExpr<any[], any> {
  const Rows = ArrayType(R);
  return withLocationCapture(false, () => func([A, FunctionType([K, Rows], NullType)], NullType, ($, piece, emit) => {
    const t = new SplitTranslator(checked, {});
    const send = ($2: Block, ...args: Expr[]): void => t.stmt($2, t.callFn(emit as Expr, args, source.path));
    const append: Fold = (t2, $2, earlier, later) => {
      t2.stmt($2, t2.b("ArrayAppend", [R], [earlier, later], NullType, source.path));
      return earlier;
    };
    const table = pieceTable(t, $, K, { type: Rows, fold: append }, source.path, options, send);
    t.forEach($, piece as Expr, ($2, item) => {
      const row = t.bind($2, t.widenTo($2, item, R, source.path), "row");
      let key = row;
      for (const name of fields) key = t.field(key, name);
      const one = t.declare($2, t.emptyArray(R), "rows");
      t.push($2, one, row, source.path);
      table.add($2, key, one);
    }, source.path);
    table.flush($);
    return t.null();
  })) as unknown as FunctionExpr<any[], any>;
}

/** The root fields a node reads with the root as its input. */
function rootFieldsRead(node: JqNode, out: string[] = []): string[] {
  const field = rootField(node, true);
  if (field !== undefined) { out.push(field); return out; }
  if (node.type === "pipe") return rootFieldsRead(node.value.left, out);
  for (const child of jqChildren(node)) if (child.node !== undefined && child.step !== "pipe.right") rootFieldsRead(child.node, out);
  return out;
}

/** What the explanation says of a plan's combine. */
function combineOf(checked: CheckJqResult, plan: Plan): JqCombine {
  const c = plan.combine;
  const totals = (t: Totals): JqTotal[] => t.leaves.map(l => ({ range: l.range, rule: l.rule }));
  switch (c.kind) {
    case "concat": return { kind: "concat" };
    case "totals": return { kind: "totals", range: rangeOf(checked, c.path), totals: totals(c.totals) };
    case "group": return { kind: "group", range: spanning(checked, c.path, c.mapPath), key: rangeOf(checked, c.key.path), totals: c.totals === null ? null : totals(c.totals) };
    case "distinct": return { kind: "distinct", range: rangeOf(checked, c.path) };
    case "distinct_by": return { kind: "distinct_by", range: rangeOf(checked, c.path), key: rangeOf(checked, c.key.path) };
    case "reduce": return { kind: "reduce", range: rangeOf(checked, c.path), key: rangeOf(checked, childPath(c.path, "reduce.update.update.path.index.index")), update: c.update };
    case "top": return { kind: "top", range: spanning(checked, c.path, c.keepPath), key: c.key === null ? null : rangeOf(checked, c.key.path), rows: c.rows };
  }
}

/** The struct of a set of totals' partials: a field each, `p0`, `p1`, … */
function partialsType(leaves: readonly Leaf[]): EastType {
  return StructType(Object.fromEntries(leaves.map((leaf, i) => [`p${i}`, leaf.type])));
}

/** A group's partial: its totals', or its rows collected. */
function groupValueType(plan: Plan, c: Extract<Combine, { kind: "group" }>): EastType {
  return c.totals === null ? ArrayType(plan.rowType) : partialsType(c.totals.leaves);
}

/** The split call's output kind for a plan. */
function outputOf(checked: CheckJqResult, plan: Plan): JqSplitOutput {
  const c = plan.combine;
  const R = plan.rowType;
  switch (c.kind) {
    case "concat":
      return { kind: "array", type: ArrayType(R) };
    case "distinct":
      return { kind: "set", type: SetType(R) };
    case "distinct_by": {
      const K = c.key.type;
      return { kind: "dict", type: DictType(K, R), merge: () => mergeFunction(checked, K, R, foldOf(plan, c, R)) };
    }
    case "group": {
      const K = c.key.type;
      const V = groupValueType(plan, c);
      return { kind: "dict", type: DictType(K, V), merge: () => mergeFunction(checked, K, V, foldOf(plan, c, V)) };
    }
    case "totals": {
      const leaves = c.totals.leaves;
      const T = partialsType(leaves);
      const zero = Object.fromEntries(leaves.map((leaf, i) => [`p${i}`, leaf.zero]));
      return { kind: "fold", type: T, zero, combine: () => combineFunction(checked, T, (t, $, a, b) => combineStruct(t, $, leaves, a, b, T)) };
    }
    case "reduce": {
      const K = c.keyType;
      const V = c.valueType;
      return { kind: "dict", type: DictType(K, V), merge: () => mergeFunction(checked, K, V, foldOf(plan, c, V)) };
    }
    case "top": {
      // Each piece's first rows with their keys, in order; two pieces' merged, the earlier's first on a tie.
      const T = ArrayType(topPair(c));
      return { kind: "fold", type: T, zero: [], combine: () => combineFunction(checked, T, (t, $, a, b) => firstSorted(t, $, t.b("ArrayConcat", [topPair(c)], [a, b], T, c.path), c)) };
    }
  }
}

/** A row the first rows of a sort keep, with its key: the pairs `sort_by` sorts. */
function topPair(c: Extract<Combine, { kind: "top" }>): EastType {
  return StructType({ key: c.key?.type ?? c.element, value: c.element });
}

/**
 * Pairs sorted by their keys, stably, as `sort_by` sorts them, and the first
 * of them a top keeps.
 *
 * @param pairs - an array of {@link topPair}s
 * @param c - the top
 * @returns the first `c.rows` pairs in order
 */
function firstSorted(t: SplitTranslator, $: Block, pairs: Expr, c: Extract<Combine, { kind: "top" }>): Expr {
  const Pair = topPair(c);
  const K = c.key?.type ?? c.element;
  const A = ArrayType(Pair);
  const byKey = t.lambda([Pair], K, ["pair"], (_$f, pair) => t.field(pair, "key"), c.path);
  const sorted = t.bind($, t.b("ArraySort", [Pair, K], [pairs, byKey], A, c.path), "sorted");
  const size = t.bind($, t.size(sorted, c.path), "size");
  const end = t.ifValue(t.lt(size, t.int(c.rows), c.path), () => size, () => t.int(c.rows), IntegerType, c.path);
  return t.b("ArraySlice", [Pair], [sorted, t.int(0), end], A, c.path);
}

/** How a later value of a key folds into an earlier one: a function of the two, the earlier first, that gives the value. */
type Fold = (t: SplitTranslator, $: Block, earlier: Expr, later: Expr) => Expr;

/**
 * How a dict output's values of one key fold, the earlier first: the merge e3
 * runs, and a piece's table. `unique_by` keeps the earlier row, a grouping
 * combines its totals field by field or concatenates its rows, and a `reduce`
 * adds as `+=` adds or keeps the later value.
 */
function foldOf(plan: Plan, c: Extract<Combine, { kind: "distinct_by" | "group" | "reduce" }>, V: EastType): Fold {
  switch (c.kind) {
    case "distinct_by":
      return (_t, _$, earlier) => earlier;
    case "group": {
      const totals = c.totals;
      return (t, $, earlier, later) => totals === null
        ? t.b("ArrayConcat", [plan.rowType], [earlier, later], V, c.path)
        : combineStruct(t, $, totals.leaves, earlier, later, V);
    }
    case "reduce": {
      const path = childPath(c.path, "reduce.update");
      return (t, $, earlier, later) => c.update === "replace" ? later : t.widenTo($, t.arith($, "+", earlier, later, path), V, path);
    }
  }
}

/** Two structs of partials combined field by field, each by its total's rule. */
function combineStruct(t: SplitTranslator, $: Block, leaves: readonly Leaf[], a: Expr, b: Expr, type: EastType): Expr {
  const fields: Record<string, Expr> = {};
  leaves.forEach((leaf, i) => {
    fields[`p${i}`] = t.bind($, leaf.combine(t, $, t.field(a, `p${i}`), t.field(b, `p${i}`)), `p${i}`);
  });
  return t.struct(type, fields);
}

/** A dict output's merge: a function of the key and two values. */
function mergeFunction(checked: CheckJqResult, K: EastType, V: EastType, body: Fold): FunctionExpr<any[], any> {
  return withLocationCapture(false, () => func([K, V, V], V, ($, _key, a, b) => {
    const t = new SplitTranslator(checked, {});
    return t.as(body(t, $, a as Expr, b as Expr), V);
  })) as unknown as FunctionExpr<any[], any>;
}

/** A fold output's combine: a function of two values. */
function combineFunction(checked: CheckJqResult, T: EastType, body: (t: SplitTranslator, $: Block, a: Expr, b: Expr) => Expr): FunctionExpr<any[], any> {
  return withLocationCapture(false, () => func([T, T], T, ($, a, b) => {
    const t = new SplitTranslator(checked, {});
    return t.as(body(t, $, a as Expr, b as Expr), T);
  })) as unknown as FunctionExpr<any[], any>;
}

// ─── The piece program ──────────────────────────────────────────────────────

/** The variables a plan's bindings must give a part of the query that reads some of them. */
function bindsFor(binds: readonly Extract<Step, { kind: "bind" }>[], reads: ReadonlySet<string>): Extract<Step, { kind: "bind" }>[] {
  // A binding is kept when what reads its names, or a later binding kept, needs it.
  const kept: Extract<Step, { kind: "bind" }>[] = [];
  const needed = new Set(reads);
  for (let i = binds.length - 1; i >= 0; i--) {
    const bind = binds[i]!;
    if (!patternNames(bind.node.value.patterns[0]!).some(name => needed.has(name))) continue;
    kept.unshift(bind);
    for (const name of variablesIn(bind.node.value.source)) needed.add(name);
  }
  return kept;
}

/** Generates bindings from the root, then the rest with them in scope. */
function genBinds(t: SplitTranslator, $: Block, root: RootValue, binds: readonly Extract<Step, { kind: "bind" }>[], env: Env, then: ($: Block, env: Env) => void): void {
  const step = ($2: Block, i: number, scope: Env): void => {
    if (i === binds.length) { then($2, scope); return; }
    const bind = binds[i]!;
    const sourcePath = childPath(bind.path, "bind.source");
    const bodyPath = childPath(bind.path, "bind.body");
    t.gen(bind.node.value.source, sourcePath, $2, root, scope, ($3, value) => {
      t.destructure($3, bind.node.value.patterns[0]!, childPath(bind.path, "bind.patterns[0]"), value, scope, bodyPath, ($4, vars) => step($4, i + 1, { ...scope, vars }));
    });
  };
  step($, 0, env);
}

/** Runs the row work on one row: each row it gives, with the bindings in scope then. */
function genRow(t: SplitTranslator, $: Block, row: Expr, steps: readonly RowStep[], i: number, env: Env, done: ($: Block, row: Expr, env: Env) => void): void {
  if (t.ended($)) return;
  if (i === steps.length) { done($, row, env); return; }
  const step = steps[i]!;
  const next = ($2: Block, value: Expr, scope: Env = env): void => genRow(t, $2, value, steps, i + 1, scope, done);
  switch (step.kind) {
    case "map": {
      const element = t.typeAt(step.path, env).value as EastType;
      t.gen(step.node.value.args[0]!, childPath(step.path, "call.args[0]"), $, row, env, ($2, v) => next($2, t.bind($2, t.widenTo($2, v, element, step.path), "row")));
      return;
    }
    case "flatten": {
      // The row flattened as the one row of an array is: `flatten` is the same on every row.
      const one = t.declare($, t.emptyArray(t.type(row)), "row");
      t.push($, one, row, step.path);
      t.genBuiltin("flatten", [], [], step.path, $, one, env, ($2, flat) => t.forEach($2, flat, ($3, item) => next($3, item), step.path));
      return;
    }
    case "each":
      t.gen(step.node, step.path, $, row, env, ($2, v) => next($2, v));
      return;
    case "bind": {
      const source = childPath(step.path, "bind.source");
      const body = childPath(step.path, "bind.body");
      t.gen(step.node.value.source, source, $, row, env, ($2, value) => {
        t.destructure($2, step.node.value.patterns[0]!, childPath(step.path, "bind.patterns[0]"), value, env, body, ($3, vars) => next($3, row, { ...env, vars }));
      });
      return;
    }
    case "as": {
      const type = step.element ? t.typeAt(step.path, env).value as EastType : t.typeAt(step.path, env);
      next($, t.bind($, t.widenTo($, row, type, step.path), "row"));
      return;
    }
  }
}

/** The nodes the piece program generates: the row work, and what the combine computes on each row. */
function pieceNodes(plan: Plan): JqNode[] {
  const nodes: JqNode[] = [];
  for (const step of plan.rows.steps) if ("node" in step) nodes.push(step.node);
  const c = plan.combine;
  const leafNodes = (totals: Totals | null): JqNode[] => totals === null ? [] : [...totals.maps.map(m => m.node), ...totals.leaves.map(l => l.node)];
  switch (c.kind) {
    case "totals": nodes.push(...leafNodes(c.totals)); break;
    case "group": nodes.push(c.key.node, ...leafNodes(c.totals)); break;
    case "distinct_by": nodes.push(c.key.node); break;
    case "reduce": nodes.push(c.node); break;
    case "top": if (c.key !== null) nodes.push(c.key.node); break;
    default: break;
  }
  return nodes;
}

/** How a piece's program reads its rows from its piece: each row to `each`. */
type SourceRows = (t: SplitTranslator, $: Block, piece: Expr, each: ($: Block, item: Expr) => void) => void;

/** A piece's rows as its dataset gives them: its elements or a dict's values, or a dict's entries, `{key, value}`. */
function datasetRows(checked: CheckJqResult, source: Source): SourceRows {
  const entries = source.entries;
  if (entries === undefined) return (t, $, piece, each) => t.forEach($, piece, ($2, item) => each($2, item), source.path);
  const Entry = parts(typeAfter(checked, entries)).value;
  const fields = parts(Entry).fields;
  return (t, $, piece, each) => t.forEach($, piece, ($2, value, key) => each($2, t.bind($2, t.struct(Entry, {
    key: t.widenTo($2, key!, fields["key"]!, entries),
    value: t.widenTo($2, value, fields["value"]!, entries),
  }), "entry")), entries);
}

/**
 * A piece's first rows of a sort (#942): each row with its sort key, the
 * pairs sorted and cut back to the first `rows` once they are twice that, so
 * the piece holds a bounded number of them, and at the end.
 */
function topRows(t: SplitTranslator, $: Block, c: Extract<Combine, { kind: "top" }>): { add($: Block, row: Expr, env: Env): void; result($: Block): Expr } {
  const Pair = topPair(c);
  const kept = t.declare($, t.emptyArray(Pair), "top");
  const most = 2n * BigInt(c.rows) + 64n;
  return {
    add: ($2, row, env) => {
      const value = t.bind($2, t.widenTo($2, row, c.element, c.path), "row");
      t.push($2, kept, t.struct(Pair, { key: sortKey(t, $2, c, value, env), value }), c.path);
      t.ifElse($2, t.b("GreaterEqual", [IntegerType], [t.size(kept, c.path), t.int(most)], BooleanType, c.path),
        $3 => t.assign($3, kept, firstSorted(t, $3, kept, c)), undefined, c.path);
    },
    result: $2 => firstSorted(t, $2, kept, c),
  };
}

/** A row's sort key, as `sort_by` keys it: the key filter's one output, or the array of its outputs; for `sort`, the row. */
function sortKey(t: SplitTranslator, $: Block, c: Extract<Combine, { kind: "top" }>, row: Expr, env: Env): Expr {
  const key = c.key;
  if (key === null) return row;
  if (key.one) return t.one(key.node, key.path, $, row, env, key.type);
  const keys = t.declare($, t.emptyArray(parts(key.type).value), "keys");
  t.gen(key.node, key.path, $, row, env, ($2, k) => t.push($2, keys, k, c.path));
  return keys;
}

/** Generates the elements a total works through, from one row: the row, or the outputs of its maps. */
function genElements(t: SplitTranslator, $: Block, row: Expr, maps: readonly MapContext[], env: Env, each: ($: Block, element: Expr) => void): void {
  const step = ($2: Block, value: Expr, i: number): void => {
    if (i === maps.length) { each($2, value); return; }
    const map = maps[i]!;
    const element = t.typeAt(map.path, env).value as EastType;
    t.gen(map.node.value.args[0]!, childPath(map.path, "call.args[0]"), $2, value, env, ($3, v) => step($3, t.bind($3, t.widenTo($3, v, element, map.path), "element"), i + 1));
  };
  step($, row, 0);
}

/** Adds one row to totals' partials, each held in a variable. */
function addRow(t: SplitTranslator, $: Block, totals: Totals, accs: readonly Expr[], row: Expr, env: Env): void {
  totals.leaves.forEach((leaf, i) => genElements(t, $, row, leaf.maps, env, ($2, element) => leaf.add(t, $2, accs[i]!, element, env)));
}

/** The partials of totals over one row, as their struct. */
function rowPartials(t: SplitTranslator, $: Block, totals: Totals, row: Expr, env: Env, type: EastType): Expr {
  const accs = totals.leaves.map((leaf, i) => t.declare($, t.value(leaf.zero, leaf.type), `p${i}`));
  addRow(t, $, totals, accs, row, env);
  return t.struct(type, Object.fromEntries(accs.map((acc, i) => [`p${i}`, acc])));
}

/**
 * The program each piece runs: the bindings, the row work over the piece, and
 * what it emits. `rowsOf` reads the piece's rows: by default as the dataset
 * gives them; a re-keyed join's, each key's rows in turn.
 */
function pieceProgram(checked: CheckJqResult, plan: Plan, inputs: readonly { name: string; type: EastType }[], output: JqSplitOutput, options: SplitJqOptions, rowsOf: SourceRows = datasetRows(checked, plan.rows.source)): FunctionExpr<any[], any> {
  const emitType = output.kind === "dict" ? FunctionType([parts(output.type).key, parts(output.type).value], NullType)
    : output.kind === "fold" ? FunctionType([output.type], NullType)
    : FunctionType([output.kind === "set" ? parts(output.type).key : parts(output.type).value], NullType);
  const reads = new Set<string>();
  for (const node of pieceNodes(plan)) variablesIn(node, reads);
  const binds = bindsFor(plan.rows.binds, reads);
  return withLocationCapture(false, () => func([...inputs.map(i => i.type), emitType], NullType, ($, ...values) => {
    const t = new SplitTranslator(checked, {});
    const emit = values[values.length - 1] as Expr;
    const root: RootValue = { root: true, fields: new Map(inputs.map((input, i) => [input.name, values[i] as Expr])) };
    const c = plan.combine;
    const send = ($2: Block, ...args: Expr[]): void => t.stmt($2, t.callFn(emit, args, plan.rows.source.path));
    // A fold's partials are added up in the piece, and emitted once.
    const folded = c.kind === "totals" ? c.totals.leaves.map((leaf, i) => t.declare($, t.value(leaf.zero, leaf.type), `p${i}`)) : [];
    // An output that combines by key is folded by key in the piece first; a grouping that keeps its rows sends each on.
    const table = c.kind === "distinct" ? pieceTable(t, $, plan.rowType, undefined, c.path, options, send)
      : c.kind === "distinct_by" || c.kind === "reduce" || (c.kind === "group" && c.totals !== null)
        ? pieceTable(t, $, parts(output.type).key, { type: parts(output.type).value, fold: foldOf(plan, c, parts(output.type).value) }, c.path, options, send)
        : undefined;
    // The first rows of a sort are kept in the piece, and emitted once.
    const top = c.kind === "top" ? topRows(t, $, c) : undefined;
    genBinds(t, $, root, binds, emptyEnv(), ($2, env) => {
      const piece = root.fields.get(plan.rows.source.over)!;
      rowsOf(t, $2, piece, ($3, item) => genRow(t, $3, item, plan.rows.steps, 0, env, ($4, row, scope) => {
        switch (c.kind) {
          case "concat":
            send($4, t.widenTo($4, row, plan.rowType, plan.rows.end));
            return;
          case "distinct":
            table!.add($4, t.widenTo($4, row, plan.rowType, plan.rows.end));
            return;
          case "totals":
            addRow(t, $4, c.totals, folded, row, scope);
            return;
          case "group": {
            const key = t.one(c.key.node, c.key.path, $4, row, scope, c.key.type);
            if (c.totals === null) {
              const rows = t.declare($4, t.emptyArray(plan.rowType), "rows");
              t.push($4, rows, row, c.path);
              send($4, key, rows);
              return;
            }
            table!.add($4, key, rowPartials(t, $4, c.totals, row, scope, groupValueType(plan, c)));
            return;
          }
          case "distinct_by":
            table!.add($4, t.one(c.key.node, c.key.path, $4, row, scope, c.key.type), t.widenTo($4, row, plan.rowType, plan.rows.end));
            return;
          case "reduce": {
            const { node, path } = c;
            const updatePath = childPath(path, "reduce.update");
            const update = node.value.update as Node<"update">;
            const target = update.value.path as Node<"index">;
            t.destructure($4, node.value.pattern, childPath(path, "reduce.pattern"), row, scope, updatePath, ($5, vars) => {
              const inner: Env = { ...scope, vars };
              const accEnv = t.placeholder(c.accType);
              const key = t.one(target.value.index, childPath(updatePath, "update.path.index.index"), $5, accEnv, inner, c.keyType);
              const value = t.one(update.value.value, childPath(updatePath, "update.value"), $5, accEnv, inner, t.typeAt(childPath(updatePath, "update.value"), inner));
              table!.add($5, t.widenTo($5, key, c.keyType, path), t.widenTo($5, value, c.valueType, path));
            });
            return;
          }
          case "top":
            top!.add($4, row, scope);
            return;
        }
      }));
    });
    if (c.kind === "totals") send($, t.struct(output.type, Object.fromEntries(folded.map((acc, i) => [`p${i}`, acc]))));
    if (top !== undefined) send($, top.result($));
    table?.flush($);
    return t.null();
  })) as unknown as FunctionExpr<any[], any>;
}

// ─── The piece's table ──────────────────────────────────────────────────────

/** The rows a piece folds into its table before it sends the table's entries on: what bounds the table, whatever the keys. */
const FLUSH_ROWS = 32_768;

/**
 * The share of a flush's rows its table's keys may be: 1,024 keys in 32,768
 * rows, each key standing for 32 rows on average. A table costs more a row
 * than the runner's sorter it spares, unless each key stands for many rows:
 * on east-c, Release, over a piece's orders, a table of 8 to 1,024 keys made
 * a grouping by totals 9 to 23% cheaper and `unique_by` about a third, and
 * cost `unique` and a `reduce` adding a Float at most 9% more, while one of
 * 16,384 keys cost them 30 to 43% more (#1093). Trino's adaptive partial
 * aggregation stops at 0.8, but its table spares a shuffle over the network,
 * not a sort in the same process.
 */
const BYPASS_RATIO = 1 / 32;

/** A piece's table, as its row work uses it. */
interface Table {
  /** Folds one row's key, and its value for a dict, into the table, or sends them on once the table is bypassed. */
  add($: Block, key: Expr, value?: Expr): void;
  /** Sends on what the table holds, and empties it: at the piece's end. */
  flush($: Block): void;
}

/**
 * Declares a piece's table (#1093): a set of the rows, or a dict whose value
 * for a key is its rows' values folded by the output's merge, in input order.
 *
 * @param key - the type of the set's rows, or the dict's keys
 * @param value - the dict's value type and the merge's fold; `undefined` for a set
 * @param path - the combine's node, where the table's work is placed
 * @param options - `flushRows` and `bypassRatio`, for a test
 * @param send - sends a row, or a key and its value, on to the output
 * @returns the table
 *
 * @remarks
 * Every `flushRows` rows, and at the piece's end, the table sends each of its
 * entries on and empties, so it never holds more than that many rows'
 * contributions. A table may hold `bypassRatio` of a flush's rows as keys: the
 * key one past that sends the table on at once, and from there the piece
 * sends each row on as it comes, as a piece with no table does. A flush's keys
 * only grow, so the table is bypassed at its first key too many rather than at
 * the flush it would be found at, and never grows past that many keys. Either
 * way the runner's sorter folds each key's values in the order the piece sends
 * them, which is input order, so the output is the same values; a Float sum is
 * only added in another grouping.
 */
function pieceTable(t: SplitTranslator, $: Block, key: EastType, value: { type: EastType; fold: Fold } | undefined, path: string, options: SplitJqOptions, send: ($: Block, ...args: Expr[]) => void): Table {
  const flushRows = options.flushRows ?? FLUSH_ROWS;
  const ratio = options.bypassRatio ?? BYPASS_RATIO;
  if (!Number.isInteger(flushRows) || flushRows < 1) throw new RangeError(`splitJq: flushRows is ${flushRows}, not a whole number of rows from 1`);
  if (!(ratio >= 0 && ratio <= 1)) throw new RangeError(`splitJq: bypassRatio is ${ratio}, not a share from 0 to 1`);
  // The keys a table may hold: the share of a flush's rows, as a count.
  const most = Math.floor(ratio * flushRows);
  const table = value === undefined
    ? t.declare($, t.value(new SortedSet([], compareFor(key)), SetType(key)), "table")
    : t.declare($, t.value(new SortedMap([], compareFor(key)), DictType(key, value.type)), "table");
  const held = t.declare($, t.int(0), "held");
  const direct = t.declare($, t.bool(false), "direct");
  const size = (): Expr => value === undefined
    ? t.b("SetSize", [key], [table], IntegerType, path)
    : t.b("DictSize", [key, value.type], [table], IntegerType, path);
  const flush = ($2: Block): void => {
    if (value === undefined) {
      t.forEach($2, table, ($3, row) => send($3, row), path, "row");
      t.stmt($2, t.b("SetClear", [key], [table], NullType, path));
      return;
    }
    t.forEach($2, table, ($3, v, k) => send($3, k!, v), path, "value");
    t.stmt($2, t.b("DictClear", [key, value.type], [table], NullType, path));
  };
  // A key new to the table: one more than a flush may hold sends the table on, and every row after it.
  const added = ($2: Block): void => {
    t.ifElse($2, t.lt(t.int(most), size(), path), $3 => {
      flush($3);
      t.assign($3, direct, t.bool(true));
    }, undefined, path);
  };
  // A row into a set; a key's value into a dict, folded into the value it holds.
  const fold = ($2: Block, k: Expr, v: Expr | undefined): void => {
    if (value === undefined) {
      t.ifElse($2, t.b("SetTryInsert", [key], [table, k], BooleanType, path), $3 => added($3), undefined, path);
      return;
    }
    if (v === undefined) throw new TranslationError("a key with no value for a dict's table");
    const V = value.type;
    t.match($2, t.b("DictTryGet", [key, V], [table, k], OptionType(V), path), {
      none: $3 => {
        t.stmt($3, t.b("DictInsert", [key, V], [table, k, v], NullType, path));
        added($3);
      },
      some: ($3, earlier) => {
        const folded = value.fold(t, $3, earlier, v);
        // A fold that keeps the earlier value changes nothing.
        if (folded !== earlier) t.stmt($3, t.b("DictUpdate", [key, V], [table, k, t.as(folded, V)], NullType, path));
      },
    }, path);
  };
  return {
    add: ($2, k, v) => {
      // Each computed once, whichever way it goes.
      const bound = t.bind($2, k, "key");
      const boundValue = v === undefined ? undefined : t.bind($2, v, "value");
      t.ifElse($2, direct, $3 => send($3, ...(boundValue === undefined ? [bound] : [bound, boundValue])), $3 => {
        fold($3, bound, boundValue);
        t.assign($3, held, t.add(held, t.int(1), path));
        t.ifElse($3, t.b("GreaterEqual", [IntegerType], [held, t.int(flushRows)], BooleanType, path), $4 => {
          flush($4);
          t.assign($4, held, t.int(0));
        }, undefined, path);
      }, path);
    },
    flush,
  };
}

// ─── The final function ─────────────────────────────────────────────────────

/** The final function: the value the combine gives, the rest of the query on it, and the query's sink. */
function thenProgram(checked: CheckJqResult, plan: Plan, inputs: readonly { name: string; type: EastType }[], output: JqSplitOutput, resultType: EastType, options: SplitJqOptions): FunctionExpr<any[], any> {
  const c = plan.combine;
  const reads = new Set<string>();
  for (const step of plan.rest) variablesIn(step.node, reads);
  if (c.kind === "totals") variablesIn(c.node, reads);
  if (c.kind === "group") variablesIn(c.body.node, reads);
  const binds = bindsFor(plan.rows.binds, reads);
  const element = checked.elementType!;
  const multiplicity = checked.multiplicity!;
  return withLocationCapture(false, () => func([output.type, ...inputs.map(i => i.type)], resultType, ($, assembled, ...values) => {
    const t = new SplitTranslator(checked, options);
    const root: RootValue = { root: true, fields: new Map(inputs.map((input, i) => [input.name, values[i] as Expr])) };
    const all = assembled as Expr;
    // The value where the combine ends, and the rest of the query on it, each output to `sink`.
    const run = ($2: Block, env: Env, sink: Emit): void => {
      const rest = ($3: Block, value: Expr): void => genSteps(t, $3, value, plan.rest, 0, env, sink);
      switch (c.kind) {
        case "concat":
          rest($2, t.bind($2, t.widenTo($2, all, plan.cutType, plan.rows.end), "rows"));
          return;
        case "distinct":
          rest($2, t.bind($2, t.widenTo($2, t.asArray($2, all, c.path)!, typeAfter(checked, c.path), c.path), "rows"));
          return;
        case "distinct_by": {
          const out = t.declare($2, t.emptyArray(plan.rowType), "rows");
          t.forEach($2, all, ($3, value) => t.push($3, out, value, c.path), c.path);
          rest($2, t.bind($2, t.widenTo($2, out, typeAfter(checked, c.path), c.path), "rows"));
          return;
        }
        case "reduce":
          rest($2, t.bind($2, t.widenTo($2, all, typeAfter(checked, c.path), c.path), "reduced"));
          return;
        case "top": {
          // The first rows, in order: the sort's own first rows, which are all the step after it reads.
          const out = t.declare($2, t.emptyArray(c.element), "sorted");
          t.forEach($2, all, ($3, pair) => t.push($3, out, t.field(pair, "value"), c.path), c.path, "pair");
          rest($2, t.bind($2, t.widenTo($2, out, typeAfter(checked, c.path), c.path), "rows"));
          return;
        }
        case "totals": {
          const value = withTotals(t, $2, c.totals, all, env, c.node, c.path, plan.cutType);
          rest($2, value);
          return;
        }
        case "group": {
          const mapped = typeAfter(checked, c.mapPath);
          const out = t.declare($2, t.emptyArray(parts(mapped).value), "groups");
          t.forEach($2, all, ($3, partial) => {
            const groupType = parts(typeAfter(checked, c.path)).value;
            if (c.totals === null) {
              t.gen(c.body.node, c.body.path, $3, t.bind($3, t.widenTo($3, partial, groupType, c.path), "group"), env, ($4, v) => t.push($4, out, v, c.mapPath));
              return;
            }
            t.push($3, out, withTotals(t, $3, c.totals, partial, env, c.body.node, c.body.path, groupType), c.mapPath);
          }, c.path, "partial");
          rest($2, out);
          return;
        }
      }
    };
    return sink(t, $, element, multiplicity, options, ($2, emit) => genBinds(t, $2, root, binds, emptyEnv(), ($3, env) => run($3, env, emit)));
  })) as unknown as FunctionExpr<any[], any>;
}

/**
 * The value of an expression made of totals, given their partials: each total
 * finished, its node a hole that gives it, then the expression generated on a
 * collection it never reads.
 */
function withTotals(t: SplitTranslator, $: Block, totals: Totals, partials: Expr, env: Env, node: JqNode, path: string, inputType: EastType): Expr {
  const finished = totals.leaves.map((leaf, i) => t.bind($, leaf.finish(t, $, t.field(partials, `p${i}`), env), `total${i}`));
  totals.leaves.forEach((leaf, i) => t.holes.set(leaf.path, finished[i]!));
  for (const map of totals.maps) t.holes.set(map.path, t.placeholder(t.typeAt(map.path, env)));
  try {
    return t.one(node, path, $, t.placeholder(inputType), env, t.typeAt(path, env));
  } finally {
    totals.leaves.forEach(leaf => t.holes.delete(leaf.path));
    for (const map of totals.maps) t.holes.delete(map.path);
  }
}

/** Generates pipeline steps on a value, each output to the next, the last's to `emit`. */
function genSteps(t: SplitTranslator, $: Block, value: Expr, steps: readonly Step[], i: number, env: Env, emit: Emit): void {
  if (t.ended($)) return;
  if (i === steps.length) { emit($, value); return; }
  const step = steps[i]!;
  if (step.kind === "stage") {
    t.gen(step.node, step.path, $, value, env, ($2, v) => genSteps(t, $2, v, steps, i + 1, env, emit));
    return;
  }
  const bodyPath = childPath(step.path, "bind.body");
  t.gen(step.node.value.source, childPath(step.path, "bind.source"), $, value, env, ($2, bound) => {
    t.destructure($2, step.node.value.patterns[0]!, childPath(step.path, "bind.patterns[0]"), bound, env, bodyPath, ($3, vars) => genSteps(t, $3, value, steps, i + 1, { ...env, vars }, emit));
  });
}

/** The query's sink, as `translateJq` gives its result: the value, an option, or the outputs up to the limit and one more. */
function sink(t: SplitTranslator, $: Block, element: EastType, multiplicity: "one" | "maybe" | "many", options: SplitJqOptions, gen: ($: Block, emit: Emit) => void): Expr {
  if (multiplicity === "one") {
    const out = t.declare($, t.placeholder(element), "result");
    gen($, ($2, v) => t.assign($2, out, t.widenTo($2, v, element, "")));
    return out;
  }
  if (multiplicity === "maybe") {
    const option = OptionType(element);
    const out = t.declare($, t.none(option), "result");
    t.once($, ($2, label) => gen($2, ($3, v) => {
      t.assign($3, out, t.some(t.widenTo($3, v, element, ""), option));
      t.brk($3, label);
    }), "");
    return out;
  }
  const out = t.declare($, t.emptyArray(element), "results");
  const limit = options.maxOutputs;
  if (limit === undefined) {
    gen($, ($2, v) => t.push($2, out, v, ""));
    return out;
  }
  t.once($, ($2, label) => gen($2, ($3, v) => {
    t.push($3, out, v, "");
    t.ifElse($3, t.b("GreaterEqual", [IntegerType], [t.size(out, ""), t.int(limit + 1)], BooleanType, ""), $4 => t.brk($4, label), undefined, "");
  }), "");
  return out;
}
