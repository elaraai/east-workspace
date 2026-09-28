/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where the nodes of a jq program are in its text.
 *
 * A {@link JqType} value is an East value and carries no positions, so the
 * parser and the printer return them beside it: a map from each node's path
 * in the tree to its range of text.
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from "../../types.js";
import type { JqPatternType, JqType, QuerySpanType } from "../types.js";

/** A node of a jq program. */
export type JqNode = ValueTypeOf<typeof JqType>;

/** A destructuring pattern of a jq program. */
export type JqPattern = ValueTypeOf<typeof JqPatternType>;

/** A range of text: `from` to `to`, exclusive, in UTF-16 code units. */
export interface JqRange {
  /** Its first offset. */
  from: number;
  /** The offset after its last. */
  to: number;
}

/**
 * The ranges of text a program's nodes cover, by the nodes' paths.
 *
 * @remarks
 * A node's path lists, from the root, each ancestor's case and the field or
 * index that leads to the next node: `"pipe.left.call.args[1]"` is the second
 * argument of the call on the left of the root pipe. The root's path is `""`.
 * An option's payload is its case, `some`: `"array.some"` is the body of
 * `[f]`. Patterns are nodes too: `"bind.patterns[0].array[1]"`.
 */
export type JqSpans = ReadonlyMap<string, JqRange>;

/**
 * A child of a node, with the step that leads to it.
 *
 * @internal
 */
export type JqChild =
  | { step: string; node: JqNode; pattern?: undefined }
  | { step: string; pattern: JqPattern; node?: undefined };

/**
 * Joins a node's path and a step to a child.
 *
 * @param path - the node's path
 * @param step - the step, as {@link jqChildren} gives it
 * @returns the child's path
 *
 * @internal
 */
export function childPath(path: string, step: string): string {
  return path === "" ? step : `${path}.${step}`;
}

/**
 * The children of a node, in the order they are written, with the steps that
 * lead to them.
 *
 * @param node - a program node
 * @returns its children
 *
 * @internal
 */
export function jqChildren(node: JqNode): JqChild[] {
  const n = (step: string, child: JqNode): JqChild => ({ step, node: child });
  const p = (step: string, child: JqPattern): JqChild => ({ step, pattern: child });
  const some = (step: string, option: { type: "none" | "some"; value: any }): JqChild[] =>
    option.type === "some" ? [n(`${step}.some`, option.value as JqNode)] : [];
  switch (node.type) {
    case "alternative": case "comma": case "pipe": case "binary":
      return [n(`${node.type}.left`, node.value.left), n(`${node.type}.right`, node.value.right)];
    case "array":
      return some("array", node.value);
    case "bind":
      return [
        n("bind.source", node.value.source),
        ...node.value.patterns.map((pattern: JqPattern, i: number) => p(`bind.patterns[${i}]`, pattern)),
        n("bind.body", node.value.body),
      ];
    case "call":
      return node.value.args.map((arg: JqNode, i: number) => n(`call.args[${i}]`, arg));
    case "def":
      return [n("def.body", node.value.body), n("def.rest", node.value.rest)];
    case "field":
      return [n("field.target", node.value.target)];
    case "foreach":
      return [
        n("foreach.source", node.value.source), p("foreach.pattern", node.value.pattern),
        n("foreach.init", node.value.init), n("foreach.update", node.value.update),
        ...some("foreach.extract", node.value.extract),
      ];
    case "format":
      return some("format.string", node.value.string);
    case "if":
      return [
        ...node.value.branches.flatMap((branch: { condition: JqNode; then: JqNode }, i: number) => [
          n(`if.branches[${i}].condition`, branch.condition), n(`if.branches[${i}].then`, branch.then),
        ]),
        ...some("if.otherwise", node.value.otherwise),
      ];
    case "index":
      return [n("index.target", node.value.target), n("index.index", node.value.index)];
    case "iterate":
      return [n("iterate.target", node.value.target)];
    case "label":
      return [n("label.body", node.value.body)];
    case "negate":
      return [n("negate", node.value)];
    case "object":
      return node.value.flatMap((entry: { key: { type: string; value: any }; value: { type: "none" | "some"; value: any } }, i: number) => [
        ...(entry.key.type === "computed" ? [n(`object[${i}].key.computed`, entry.key.value as JqNode)] : []),
        ...some(`object[${i}].value`, entry.value),
      ]);
    case "reduce":
      return [
        n("reduce.source", node.value.source), p("reduce.pattern", node.value.pattern),
        n("reduce.init", node.value.init), n("reduce.update", node.value.update),
      ];
    case "slice":
      return [n("slice.target", node.value.target), ...some("slice.from", node.value.from), ...some("slice.to", node.value.to)];
    case "string":
      return node.value.flatMap((part: { type: string; value: any }, i: number) =>
        part.type === "interpolate" ? [n(`string[${i}].interpolate`, part.value as JqNode)] : []);
    case "try":
      return [n("try.body", node.value.body), ...some("try.catch", node.value.catch)];
    case "update":
      return [n("update.path", node.value.path), n("update.value", node.value.value)];
    case "break": case "descend": case "identity": case "literal": case "variable":
      return [];
  }
}

/**
 * The children of a pattern, with the steps that lead to them.
 *
 * @param pattern - a pattern
 * @returns its sub-patterns
 *
 * @internal
 */
export function jqPatternChildren(pattern: JqPattern): { step: string; pattern: JqPattern }[] {
  switch (pattern.type) {
    case "array":
      return pattern.value.map((item: JqPattern, i: number) => ({ step: `array[${i}]`, pattern: item }));
    case "object":
      return pattern.value.flatMap((entry: { key: string; value: { type: "none" | "some"; value: any } }, i: number) =>
        entry.value.type === "some" ? [{ step: `object[${i}].value.some`, pattern: entry.value.value as JqPattern }] : []);
    case "variable":
      return [];
  }
}

/**
 * The range a node covers.
 *
 * @param spans - a program's spans, from the parser or the printer
 * @param path - the node's path
 * @returns its range, or `undefined` when the program has no such node
 *
 * @example
 * ```ts
 * const { spans } = parseJq(".orders | length");
 * spanOf(spans, "pipe.right");   // { from: 10, to: 16 }
 * ```
 */
export function spanOf(spans: JqSpans, path: string): JqRange | undefined {
  return spans.get(path);
}

/**
 * The innermost node covering an offset.
 *
 * @param spans - a program's spans, from the parser or the printer
 * @param offset - an offset in the text, from 0 to its length
 * @returns the path of the smallest range that holds the offset (its ends
 *   included), the deeper of two equal ranges; `undefined` when none does
 *
 * @example
 * ```ts
 * const { spans } = parseJq(".orders | length");
 * pathAt(spans, 12);   // "pipe.right"
 * ```
 */
export function pathAt(spans: JqSpans, offset: number): string | undefined {
  let best: { path: string; width: number } | undefined;
  for (const [path, { from, to }] of spans) {
    if (offset < from || offset > to) continue;
    const width = to - from;
    if (best === undefined || width < best.width || (width === best.width && path.length > best.path.length)) {
      best = { path, width };
    }
  }
  return best?.path;
}

/**
 * Locates a range of text as a {@link QuerySpanType} value: its offset and
 * length, and the line and column it starts at.
 *
 * @param text - the text
 * @param from - the range's first offset, in UTF-16 code units
 * @param to - the offset after its last
 * @returns the span: `offset` 0-based, `line` and `column` 1-based, all in
 *   UTF-16 code units
 *
 * @remarks
 * A line ends at `\n`, `\r\n` or a lone `\r`. A tab is one column, and a
 * character outside the Basic Multilingual Plane is two.
 *
 * @example
 * ```ts
 * toQuerySpan(".a\n| .b", 5, 7);   // { column: 3n, length: 2n, line: 2n, offset: 5n }
 * ```
 */
export function toQuerySpan(text: string, from: number, to: number): ValueTypeOf<typeof QuerySpanType> {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < from && i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return {
    column: BigInt(from - lineStart + 1),
    length: BigInt(to - from),
    line: BigInt(line),
    offset: BigInt(from),
  };
}
