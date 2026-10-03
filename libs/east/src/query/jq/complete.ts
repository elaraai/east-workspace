/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Completions at a cursor in jq text, from the type there
 * (`devdocs/QUERY.md` §19).
 *
 * @packageDocumentation
 */

import { printFor } from "../../serialization/east.js";
import { StringType, isTypeEqual, type EastType } from "../../types.js";
import { BUILTINS } from "./catalog.js";
import { checkJq, type CheckJqResult } from "./check.js";
import { plainKind } from "./describe.js";
import { scanJq, type JqLexeme } from "./lex.js";
import { parseJq } from "./parse.js";
import { describeType, membersOf, nullablePayload, orNull, unwrap, type Result } from "./shapes.js";

const printString = printFor(StringType);

/** What a completion is. */
export type JqCompletionKind = "dataset" | "field" | "case" | "key" | "value" | "variable" | "builtin";

/** One completion. */
export interface JqCompletion {
  /** What the list shows: a field's name, `$x`, a builtin's name, a case, a value. */
  label: string;
  /** What it is. */
  kind: JqCompletionKind;
  /** The East type, a builtin's signature (`select(f)`), or a value's count. */
  detail: string;
  /** One line: the plain kind, a builtin's rule, `only when .status.type == "shipped"`. */
  doc?: string;
  /** The text that replaces the range: `select(` for a builtin with arguments, `shipped"` inside a string. */
  insert: string;
  /** A field only one case of an un-narrowed variant has. */
  warn?: boolean;
}

/** Options for {@link completeJq}. */
export interface CompleteJqOptions {
  /** The input is an e3 root: its fields are data sources. */
  root?: boolean;
  /** Offer the tooling-only builtins. */
  tooling?: boolean;
  /**
   * Values in the data, from a summary: the most common values at a path
   * (the path's text, `.customer_id`, or a dict's, `$customers`) that start
   * with a prefix.
   */
  values?(path: string, prefix: string): { value: string; count: number }[];
  /** A data source's one-line description. */
  describeRoot?(name: string): string | undefined;
}

/** What {@link completeJq} offers: the items, and the text they replace. */
export interface JqCompletions {
  /** The first offset of the text an item replaces: the start of the word being typed. */
  from: number;
  /** The offset after its last: the cursor. The caller may extend it over the rest of the word. */
  to: number;
  /** The items, most specific first, then by label; at most 40. */
  items: JqCompletion[];
}

const MAX_ITEMS = 40;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PARAMS = ["f", "g", "h", "i", "j", "k", "l", "m"];

/** A text completed inside a string: escaped as a jq string's text, then the closing quote — `say \"hi\""`. */
function closeString(text: string): string {
  return printString(text).slice(1);
}

/** A builtin's signatures: `first, first(f)`. */
function signature(name: string, arities: readonly number[]): string {
  return arities.map(n => n === 0 ? name : `${name}(${PARAMS.slice(0, n).join("; ")})`).join(", ");
}

/** The lexemes of a postfix chain ending at `end` (exclusive index), and where it starts. */
function chainStart(lexemes: readonly JqLexeme[], end: number): number {
  let i = end - 1;
  let start = end;
  const adjacent = (j: number): boolean => j + 1 >= end || lexemes[j]!.to === lexemes[j + 1]!.from;
  while (i >= 0 && adjacent(i)) {
    const l = lexemes[i]!;
    if (l.role === "field") { start = i; i -= 1; continue; }
    if (l.role === "punct" && (l.value === "]" || l.value === ")")) {
      const open = l.value === "]" ? "[" : "(";
      let depth = 0;
      let j = i;
      for (; j >= 0; j--) {
        const m = lexemes[j]!;
        if (m.role === "punct" && m.value === l.value) depth += 1;
        if (m.role === "punct" && m.value === open) depth -= 1;
        if (depth === 0) break;
      }
      if (j < 0) return start;
      start = j;
      i = j - 1;
      // A call's name before its arguments, or a target before an index.
      if (open === "(") {
        if (i >= 0 && lexemes[i]!.role === "ident" && lexemes[i]!.to === lexemes[i + 1]!.from) start = i;
        return start;
      }
      continue;
    }
    if (l.role === "punct" && (l.value === "." || l.value === "..")) return i;
    if (l.role === "variable" || l.role === "loc" || l.role === "ident") return i;
    return start;
  }
  return start;
}

/** What closes the brackets and keywords still open at the end of some text, so a prefix parses. */
function closers(lexemes: readonly JqLexeme[]): string {
  const stack: { open: string; last: string }[] = [];
  for (const l of lexemes) {
    if (l.role === "punct" && (l.value === "(" || l.value === "[" || l.value === "{")) stack.push({ open: l.value, last: "" });
    else if (l.role === "punct" && (l.value === ")" || l.value === "]" || l.value === "}")) stack.pop();
    else if (l.role === "keyword" && (l.value === "if" || l.value === "def")) stack.push({ open: l.value, last: l.value });
    else if (l.role === "keyword" && l.value === "end" && stack[stack.length - 1]?.open === "if") stack.pop();
    else if (l.role === "punct" && l.value === ";" && stack[stack.length - 1]?.open === "def") stack.pop();
    else if (l.role === "keyword" && stack.length > 0 && stack[stack.length - 1]!.open === "if") stack[stack.length - 1]!.last = l.value;
  }
  let out = "";
  for (const { open, last } of [...stack].reverse()) {
    if (open === "(") out += ")";
    else if (open === "[") out += "]";
    else if (open === "{") out += "}";
    else if (open === "def") out += "; .";
    else out += last === "if" || last === "elif" ? " then . end" : " end";
  }
  return out;
}

/** Checks a prefix of the text, repaired so it parses, and finds the node that spans a range of it. */
function typeOfRange(prefix: string, from: number, to: number, input: EastType, root: boolean): { checked: CheckJqResult; path: string } | undefined {
  const repaired = prefix + closers(scanJq(prefix).filter(l => l.role !== "ws" && l.role !== "comment"));
  const parsed = parseJq(repaired);
  if (parsed.program.type === "none") return undefined;
  let path: string | undefined;
  for (const [p, range] of parsed.spans) {
    if (range.from === from && range.to === to && (path === undefined || p.length > path.length)) path = p;
  }
  if (path === undefined) return undefined;
  return { checked: checkJq(parsed, input, { root }), path };
}

/** The items that complete a field after a value of a result's shape. */
function fieldItems(result: Result, variantText: string | undefined): JqCompletion[] {
  const items: JqCompletion[] = [];
  const seen = new Set<string>();
  const members = membersOf(result.shape);
  const payloads = members.filter(m => m.case !== undefined).length > 1;
  const add = (item: JqCompletion): void => {
    if (seen.has(item.label)) return;
    seen.add(item.label);
    items.push(item);
  };
  for (const member of members) {
    const t = unwrap(member.shape.type);
    const inner = unwrap(nullablePayload(t) ?? t);
    const optional = nullablePayload(t) !== undefined;
    if (inner.type === "Struct") {
      for (const [name, field] of Object.entries(inner.fields as Record<string, EastType>)) {
        const read = optional || (payloads && member.case !== undefined) ? orNull(field) ?? field : field;
        const insert = NAME.test(name) ? name : printString(name);
        if (payloads && member.case !== undefined) {
          add({ label: name, kind: "field", detail: describeType(read), doc: `only when ${variantText ?? "."}.type == ${printString(member.case)}`, insert, warn: true });
        } else {
          add({ label: name, kind: "field", detail: describeType(read), doc: plainKind(read), insert });
        }
      }
    } else if (inner.type === "Variant" && nullablePayload(inner) === undefined) {
      const cases = Object.keys(inner.cases as Record<string, EastType>);
      add({ label: "type", kind: "field", detail: "String", doc: `case name: ${cases.join(", ")}`, insert: "type" });
      add({ label: "value", kind: "field", detail: "the case's payload", doc: "narrow first to read a case's fields exactly", insert: "value" });
    } else if (inner.type === "Dict") {
      add({ label: "[", kind: "key", detail: describeType(inner), doc: `look up by ${describeType(inner.key as EastType)} key`, insert: "[" });
    }
  }
  return items;
}

/** Keeps the items whose label starts with the typed text, most specific first, then by label. */
function finish(from: number, to: number, items: JqCompletion[], typed: string, exact: boolean): JqCompletions {
  const order: readonly JqCompletionKind[] = ["case", "value", "key", "dataset", "field", "variable", "builtin"];
  const lower = typed.toLowerCase();
  const kept = items.filter(item => item.label.toLowerCase().startsWith(lower) && (exact || item.label !== typed));
  kept.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { from, to, items: kept.slice(0, MAX_ITEMS) };
}

/**
 * The completions at a cursor in jq text, from the type at the cursor.
 *
 * @param text - the program, usually mid-edit
 * @param offset - the cursor, in UTF-16 code units
 * @param input - the type the program runs on
 * @param options - `root` for an e3 root, `tooling`, and the values in the
 *   data from a summary
 * @returns the items and the range they replace, or `null` where nothing
 *   completes
 *
 * @remarks
 * The text before the cursor is repaired so it parses (brackets closed, an
 * `if` ended) and checked, and the value before the cursor typed:
 * - inside `.F.type == "` — the variant's case names;
 * - inside `== "` after another path — the values in the data, from
 *   `options.values`;
 * - inside `$d["` — the dict's keys, from `options.values`;
 * - after `.` or a path — at an e3 root, its data sources; on a struct, its
 *   fields; on a variant, `type` and `value`; under an un-narrowed `.F.value`,
 *   every case's fields as `Option<T>`, marked `warn` with the case that has
 *   each; on a dict, `[`;
 * - after `$` — the variables in scope;
 * - a word — the builtins (and defs) whose names start with it, inserting
 *   `name(` for those that take arguments.
 *
 * @example
 * ```ts
 * const done = completeJq(".orders[0].to", 13, FixtureRoot);
 * done!.items.map(i => i.label);   // ["total"]
 * ```
 */
export function completeJq(text: string, offset: number, input: EastType, options: CompleteJqOptions = {}): JqCompletions | null {
  const before = text.slice(0, offset);
  const lexemes = scanJq(before).filter(l => l.role !== "ws" && l.role !== "comment");
  const last = lexemes[lexemes.length - 1];
  if (last === undefined || last.to !== offset) return null;
  const root = options.root === true;
  const at = lexemes.length - 1;

  // Inside a string: a case name, a value in the data, or a dict's key.
  if (last.role === "unterminated") {
    const typed = last.value;
    const from = last.from + 1;
    const previous = lexemes[at - 1];
    if (previous?.role === "op" && (previous.value === "==" || previous.value === "!=")) {
      const start = chainStart(lexemes, at - 1);
      if (start >= at - 1) return null;
      const chainFrom = lexemes[start]!.from;
      const chainTo = lexemes[at - 2]!.to;
      const tail = lexemes[at - 2]!;
      if (tail.role === "field" && tail.value === "type") {
        // The variant is the chain without its `.type`.
        const variantTo = tail.from;
        const target = variantTo === chainFrom
          ? typeOfRange(`${before.slice(0, chainFrom)}.`, chainFrom, chainFrom + 1, input, root)
          : typeOfRange(before.slice(0, variantTo), chainFrom, variantTo, input, root);
        const result = target?.checked.resultAt(target.path);
        if (result === null || result === undefined) return null;
        const items: JqCompletion[] = [];
        for (const member of membersOf(result.shape)) {
          const t = unwrap(member.shape.type);
          const variant = unwrap(nullablePayload(t) ?? t);
          if (variant.type !== "Variant") continue;
          for (const name of Object.keys(variant.cases as Record<string, EastType>)) {
            items.push({ label: name, kind: "case", detail: `case of ${describeType(variant)}`, insert: closeString(name) });
          }
        }
        return finish(from, offset, items, typed, true);
      }
      const values = options.values?.(before.slice(chainFrom, chainTo), typed) ?? [];
      return finish(from, offset, values.map(v => ({ label: v.value, kind: "value", detail: `${v.count} in data`, insert: closeString(v.value) })), typed, true);
    }
    if (previous?.role === "punct" && previous.value === "[" && lexemes[at - 2]?.role === "variable") {
      const dict = lexemes[at - 2]!;
      const values = options.values?.(dict.text, typed) ?? [];
      return finish(from, offset, values.map(v => ({ label: v.value, kind: "key", detail: `${v.count} in data`, insert: closeString(v.value) })), typed, true);
    }
    return null;
  }

  // After `.` or a path: fields, cases' fields, data sources.
  if (last.role === "field" || (last.role === "punct" && last.value === ".")) {
    const typed = last.role === "field" ? last.value : "";
    const from = offset - typed.length;
    const start = chainStart(lexemes, at);
    const chainFrom = start < at ? lexemes[start]!.from : last.from;
    const target = start < at
      ? typeOfRange(before.slice(0, last.from), chainFrom, last.from, input, root)
      : typeOfRange(`${before.slice(0, last.from)}.`, last.from, last.from + 1, input, root);
    if (target === undefined) return null;
    const result = target.checked.resultAt(target.path);
    if (result === null) return null;
    if (root && start >= at && result.shape.kind === "type" && isTypeEqual(result.shape.type, input)) {
      const t = unwrap(input);
      if (t.type === "Struct") {
        const items = Object.entries(t.fields as Record<string, EastType>).map(([name, field]): JqCompletion => {
          const doc = options.describeRoot?.(name) ?? plainKind(field);
          return { label: name, kind: "dataset", detail: describeType(field), doc, insert: NAME.test(name) ? name : printString(name) };
        });
        return finish(from, offset, items, typed, false);
      }
    }
    // Under `.F.value`, the variant's text for a payload field's doc.
    const valueRead = before.slice(chainFrom, last.from);
    const variantText = valueRead.endsWith(".value") ? valueRead.slice(0, -".value".length) || "." : undefined;
    return finish(from, offset, fieldItems(result, variantText), typed, false);
  }

  // After `$`: the variables in scope.
  if (last.role === "variable" || (last.role === "other" && last.text === "$")) {
    const typed = last.role === "variable" ? last.value : "";
    const target = typeOfRange(`${before.slice(0, last.from)}.`, last.from, last.from + 1, input, root);
    const scope = target?.checked.scopeAt(target.path);
    if (scope === null || scope === undefined) return null;
    const items: JqCompletion[] = [];
    for (const [name, value] of scope.vars) {
      if (value.shape.kind !== "type") continue;
      const type = value.shape.type;
      items.push({ label: `$${name}`, kind: "variable", detail: describeType(type), doc: plainKind(type), insert: name });
    }
    return finish(last.from + 1, offset, items, `$${typed}`, false);
  }

  // A word: the builtins and defs whose names start with it.
  if (last.role === "ident") {
    const typed = last.value;
    const items: JqCompletion[] = [];
    for (const [name, builtin] of BUILTINS) {
      if (name.startsWith("@")) continue;
      if (builtin.status !== "supported" && !(builtin.status === "tooling" && options.tooling === true)) continue;
      const takesArguments = !builtin.arities.includes(0);
      items.push({ label: name, kind: "builtin", detail: signature(name, builtin.arities), doc: builtin.rule ?? "", insert: takesArguments ? `${name}(` : name });
    }
    const target = typeOfRange(`${before.slice(0, last.from)}.`, last.from, last.from + 1, input, root);
    for (const def of target?.checked.scopeAt(target.path)?.defs ?? []) {
      const [name, arity] = def.split("/") as [string, string];
      if (items.some(item => item.label === name)) continue;
      items.push({ label: name, kind: "builtin", detail: signature(name, [Number(arity)]), doc: "a def of this program", insert: arity === "0" ? name : `${name}(` });
    }
    return finish(last.from, offset, items, typed, false);
  }
  return null;
}
