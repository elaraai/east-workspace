/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Running a jq query from a host: checked, translated to East IR, compiled
 * once and cached, then called (`devdocs/QUERY.md` §15).
 *
 * @packageDocumentation
 */

import { EastError } from "../error.js";
import type { Location } from "../location.js";
import type { PlatformFunction } from "../platform.js";
import { printFor } from "../serialization/east.js";
import { EastTypeType, canonicalTypeValue, toEastTypeValue } from "../type_of_type.js";
import type { EastType, ValueTypeOf } from "../types.js";
import type { QueryErrorType } from "./types.js";
import { checkJq, type CheckJqResult } from "./jq/check.js";
import { report } from "./jq/messages.js";
import { printJq } from "./jq/print.js";
import { childPath, jqChildren, type JqNode } from "./jq/spans.js";
import { translateJq, type JqTranslation } from "./jq/translate.js";

/** A diagnostic of a query: the checker's, or an error its run raised. */
export type QueryDiagnostic = ValueTypeOf<typeof QueryErrorType>;

/**
 * A query that does not check, or whose run raised an error: its diagnostics,
 * and a message that lists each error with its line and column in the jq text.
 *
 * @remarks
 * `diagnostics` holds the checker's diagnostics, lints included, when the
 * query does not check; for an error raised while it ran, one `runtime`
 * diagnostic whose message is the East error's and whose span is the jq
 * node that raised it.
 */
export class QueryError extends Error {
  /** The diagnostics, in the order found. */
  readonly diagnostics: QueryDiagnostic[];

  /**
   * @param diagnostics - the diagnostics; the message lists those of error severity
   */
  constructor(diagnostics: QueryDiagnostic[]) {
    const errors = diagnostics.filter(d => d.severity.type === "error");
    super((errors.length > 0 ? errors : diagnostics).map(d => {
      const where = d.span.type === "some" ? `jq ${d.span.value.line}:${d.span.value.column}: ` : "";
      return `${where}${d.message}`;
    }).join("\n"));
    this.name = "QueryError";
    this.diagnostics = diagnostics;
  }
}

/** Options for {@link evaluateJq}. */
export interface EvaluateJqOptions {
  /** The input's type: required with a program's text. */
  inputType?: EastType;
  /** The input is an e3 root, a struct of datasets: each field the query reads is passed alone, so a lazy one stays lazy. */
  root?: boolean;
  /** Allow the tooling-only builtins, whose platform functions `platform` gives (`devdocs/QUERY.md` §15.9). */
  tooling?: boolean;
  /** Platform functions, for function values in the input that need them. */
  platform?: PlatformFunction[];
}

/** A compiled query, and how to give it its input. */
interface Compiled {
  readonly translation: JqTranslation;
  readonly checked: CheckJqResult;
  readonly run: (...args: unknown[]) => unknown;
}

/** Compiled queries by their canonical text, input type and options, the oldest dropped past {@link CACHE_SIZE}. */
const cache = new Map<string, Compiled>();
const CACHE_SIZE = 64;
const printTypeValue = printFor(EastTypeType);

/**
 * Checks, translates, compiles and runs a jq query over a value.
 *
 * @param program - the query's text, or what {@link checkJq} made of it
 * @param input - the input: a decoded value, or a lazy one
 * @param options - `inputType` with text; `root` for an e3 root; `tooling`;
 *   `platform` for function values that need one
 * @returns the result: the element for a `one` query, an option for `maybe`,
 *   an array for `many`
 * @throws {QueryError} When the query does not check, carrying the
 *   checker's diagnostics; or when its run raises an error, as one `runtime`
 *   diagnostic at the jq node that raised it.
 *
 * @remarks
 * The compiled function is cached by the query's canonical text, its input
 * type and the options, so a query run again compiles once. With `root`, the
 * input is a struct and each field the query reads is its own argument.
 *
 * @example
 * ```ts
 * const Order = StructType({ id: IntegerType, total: FloatType });
 * const orders = [{ id: 1n, total: 250.0 }, { id: 2n, total: 1200.0 }];
 * evaluateJq("[.[] | select(.total > 1000) | .id]", orders, { inputType: ArrayType(Order) });
 * // [2n]
 * ```
 */
export function evaluateJq(program: string | CheckJqResult, input: unknown, options: EvaluateJqOptions = {}): unknown {
  const compiled = compile(program, options);
  const args = compiled.translation.inputs.map(i => i.name === null ? input : (input as Record<string, unknown>)[i.name]);
  try {
    return compiled.run(...args);
  } catch (e) {
    if (e instanceof EastError) throw new QueryError([runtimeDiagnostic(compiled.checked, e)]);
    throw e;
  }
}

/** A query checked, translated and compiled, from the cache when it was before. */
function compile(program: string | CheckJqResult, options: EvaluateJqOptions): Compiled {
  let checked: CheckJqResult;
  let key: string;
  if (typeof program === "string") {
    if (options.inputType === undefined) throw new TypeError("evaluateJq: a query's text needs options.inputType");
    const typeKey = printTypeValue(canonicalTypeValue(toEastTypeValue(options.inputType)));
    key = `${program}\u0000${typeKey}\u0000${options.root === true}\u0000${options.tooling === true}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    checked = checkJq(program, options.inputType, { root: options.root === true, tooling: options.tooling === true });
  } else {
    checked = program;
    if (checked.query === null) throw new QueryError(checked.diagnostics);
    const q = checked.query.value;
    key = `${printJq(q.program).text}\u0000${printTypeValue(q.input_type)}\u0000${checked.source.root}\u0000${options.tooling === true}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
  }
  if (checked.query === null) throw new QueryError(checked.diagnostics);
  const translation = translateJq(checked, { tooling: options.tooling === true });
  const run = translation.fn().toIR().compile(options.platform ?? []) as (...args: unknown[]) => unknown;
  const compiled: Compiled = { translation, checked, run };
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, compiled);
  return compiled;
}

/** A `runtime` diagnostic for an East error a query raised: at the jq node it names, when it names one. */
function runtimeDiagnostic(checked: CheckJqResult, error: EastError): QueryDiagnostic {
  const text = checked.source.text;
  const at = error.location.find((l: Location) => l.filename === "jq");
  let range: { from: number; to: number } | undefined;
  if (at !== undefined) {
    // The node that raised it: the innermost that starts at that line and column and can raise
    // (a literal, `.` or a variable, which can start at the same place, cannot).
    const offset = offsetOf(text, Number(at.line), Number(at.column));
    const kinds = checked.rewritten === null ? new Map<string, string>() : nodeKinds(checked.rewritten);
    for (const [path, span] of checked.source.spans) {
      if (span.from !== offset || LEAVES.has(kinds.get(path) ?? "")) continue;
      if (range === undefined || span.to - span.from < range.to - range.from) range = span;
    }
    range ??= { from: offset, to: offset };
  }
  return report(text, "runtime", range, `runtime: ${error.eastMessage}`);
}

/** The kinds of node that cannot raise an error. */
const LEAVES: ReadonlySet<string> = new Set(["identity", "literal", "variable"]);

/** Each node's kind, by its path. */
function nodeKinds(program: JqNode): Map<string, string> {
  const kinds = new Map<string, string>();
  const visit = (node: JqNode, path: string): void => {
    kinds.set(path, node.type);
    for (const child of jqChildren(node)) if (child.node !== undefined) visit(child.node, childPath(path, child.step));
  };
  visit(program, "");
  return kinds;
}

/** The offset of a line and column in a text, both 1-based, as `toQuerySpan` counts them. */
function offsetOf(text: string, line: number, column: number): number {
  let current = 1;
  let start = 0;
  for (let i = 0; i < text.length && current < line; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) { current += 1; start = i + 1; }
  }
  return Math.min(text.length, start + column - 1);
}

