/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An East type as jq sees it, in words: the paths a query can read, and the
 * plain kind of each value (`devdocs/QUERY.md` §19).
 *
 * @packageDocumentation
 */

import type { EastType } from "../../types.js";
import { jsonString } from "./literals.js";
import { describeType, nullablePayload, unwrap } from "./shapes.js";

/**
 * The kind of a value, in plain words: `text`, `number`, `whole number`,
 * `date`, `yes or no`, `one of`, `list`, `lookup table`, `record`,
 * `calculation`, with `, sometimes missing` for an Option.
 *
 * @param type - the type
 * @returns its kind
 *
 * @example
 * ```ts
 * plainKind(OptionType(FloatType));   // "number, sometimes missing"
 * ```
 */
export function plainKind(type: EastType): string {
  const t = unwrap(type);
  const payload = nullablePayload(t);
  if (payload !== undefined) return `${plainKind(payload)}, sometimes missing`;
  switch (t.type) {
    case "String": return "text";
    case "Integer": return "whole number";
    case "Float": return "number";
    case "Boolean": return "yes or no";
    case "DateTime": return "date";
    case "Array": case "Set": case "Vector": case "Matrix": return "list";
    case "Dict": return "lookup table";
    case "Struct": return "record";
    case "Variant": return "one of";
    case "Function": case "AsyncFunction": return "calculation";
    case "Blob": return "bytes";
    case "Null": return "nothing";
    default: return t.type;
  }
}

/** A type for one line of a description: its fields' names for a struct, its cases' for a variant. */
function brief(type: EastType): string {
  const t = unwrap(type);
  const payload = nullablePayload(t);
  if (payload !== undefined) return `Option<${brief(payload)}>`;
  if (t.type === "Struct") {
    const names = Object.keys(t.fields as Record<string, EastType>);
    return `Struct{${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""}}`;
  }
  // A function's inputs are what a call must build, so they are spelt out.
  return describeType(type, t.type === "Function" || t.type === "AsyncFunction" ? 1 : 0);
}

/**
 * Describes an East type as jq reads it: one line per path, indented by its
 * depth, with the type at that path.
 *
 * @param type - the type
 * @param options - `maxDepth`, how deep to go (6 by default)
 * @returns the description, lines joined by `\n`
 *
 * @remarks
 * - A struct's fields are `.name`, an array's elements `[]`, a dict's values
 *   `[<K>]` for its key type `K`.
 * - A variant's case is `.type`, listed as its case names, and each case's
 *   payload is under `.value`, marked `(when case)`.
 * - An option's value is read through it, as jq reads through `null`.
 * - A recursive type is described once; where it recurs the line says
 *   `(recursive: <path>)`, the path it was first described at.
 * - The text is stable, so agents and tests can read it.
 *
 * @example
 * ```ts
 * describeJqType(StructType({ id: IntegerType, tags: ArrayType(StringType) }));
 * // ".  Struct{id, tags}\n  .id  Integer\n  .tags  Array<String>\n    .tags[]  String"
 * ```
 */
export function describeJqType(type: EastType, options: { maxDepth?: number } = {}): string {
  const maxDepth = options.maxDepth ?? 6;
  const lines: string[] = [];
  const recursive = new Map<EastType, string>();
  const visit = (t: EastType, path: string, depth: number, when: string): void => {
    const indent = "  ".repeat(depth);
    const shown = path === "" ? "." : path;
    if (t.type === "Recursive") {
      const seen = recursive.get(t);
      if (seen !== undefined) {
        lines.push(`${indent}${shown}  (recursive: ${seen === "" ? "." : seen})${when}`);
        return;
      }
      recursive.set(t, path);
    }
    lines.push(`${indent}${shown}  ${brief(t)}${when}`);
    if (depth >= maxDepth) return;
    const u = unwrap(t);
    const payload = nullablePayload(u);
    if (payload !== undefined) {
      const inner = unwrap(payload);
      if (inner.type === "Struct" || inner.type === "Variant") visitChildren(inner, path, depth, when);
      return;
    }
    visitChildren(u, path, depth, when);
  };
  const visitChildren = (u: EastType, path: string, depth: number, when: string): void => {
    switch (u.type) {
      case "Struct":
        for (const [name, field] of Object.entries(u.fields as Record<string, EastType>)) {
          visit(field, `${path}.${/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : jsonString(name)}`, depth + 1, when);
        }
        return;
      case "Array": visit(u.value as EastType, `${path}[]`, depth + 1, when); return;
      case "Set": visit(u.key as EastType, `${path}[]`, depth + 1, when); return;
      case "Vector": visit(u.element as EastType, `${path}[]`, depth + 1, when); return;
      case "Matrix": visit(u.element as EastType, `${path}[][]`, depth + 1, when); return;
      case "Dict": visit(u.value as EastType, `${path}[<${describeType(u.key as EastType, 1)}>]`, depth + 1, when); return;
      case "Variant": {
        const cases = u.cases as Record<string, EastType>;
        lines.push(`${"  ".repeat(depth + 1)}${path}.type  ${Object.keys(cases).map(c => jsonString(c)).join(" | ")}${when}`);
        for (const [name, payload] of Object.entries(cases)) {
          if (unwrap(payload).type === "Null") continue;
          visit(payload, `${path}.value`, depth + 1, ` (when ${name})`);
        }
        return;
      }
      default:
        return;
    }
  };
  visit(type, "", 0, "");
  return lines.join("\n");
}
