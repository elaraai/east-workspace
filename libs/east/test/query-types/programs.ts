/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The operations of the type matrix (#987): jq programs, each with the
 * types it applies to. The matrix is every shape × every program that
 * applies to it (`run.ts`), and the spec holds each such pair to check, or
 * to be refused where jq raises an error or `oracle.ts` lists the refusal:
 * a program that applies is never skipped.
 */

import { isDataType, type EastType } from "../../src/index.js";
import { isOrdered, nullablePayload, unify, unwrap } from "../../src/query/jq/shapes.js";
import type { Shape } from "./shapes.js";

/** A program of the matrix: its jq text for a shape, or `undefined` where it does not apply. */
export interface Program {
  readonly name: string;
  readonly family: string;
  readonly text: (shape: Shape) => string | undefined;
}

/** What a shape's type is made of, read through its recursive wrapper and references. */
const made = (t: EastType): EastType => unwrap(t);

const is = (...kinds: string[]) => (t: EastType): boolean => kinds.includes(made(t).type) && nullablePayload(made(t)) === undefined;
const number = is("Integer", "Float");
const string = is("String");
const datetime = is("DateTime");
const blob = is("Blob");
const struct = is("Struct");
const dict = is("Dict");
const seq = is("Array", "Set", "Vector");
const variant = (t: EastType): boolean => made(t).type === "Variant" && nullablePayload(made(t)) === undefined;
const option = (t: EastType): boolean => nullablePayload(made(t)) !== undefined;
const fn = is("Function");
const data = (t: EastType): boolean => isDataType(t);

/** A sequence's element type. */
function elementOf(t: EastType): EastType | undefined {
  const u = made(t);
  if (u.type === "Array") return u.value as EastType;
  if (u.type === "Set") return u.key as EastType;
  if (u.type === "Vector") return u.element as EastType;
  return undefined;
}
const seqOf = (pred: (e: EastType) => boolean) => (t: EastType): boolean => {
  const e = elementOf(t);
  return seq(t) && e !== undefined && e.type !== "Never" && pred(e);
};
const scalar = is("Null", "Boolean", "Integer", "Float", "String");
const addable = (e: EastType): boolean => number(e) || string(e) || is("Array", "Dict")(e);

/** A struct whose field values share one type, which `.[]`, `to_entries` and `map_values` need. */
function uniform(t: EastType): boolean {
  if (!struct(t)) return false;
  const fields = Object.values((made(t) as { fields: Record<string, EastType> }).fields);
  if (fields.length === 0) return false;
  let common: EastType | undefined = fields[0]!;
  for (const f of fields.slice(1)) common = common === undefined ? undefined : unify(common, f);
  return common !== undefined;
}

function program(family: string, name: string, text: string, applies: (t: EastType) => boolean): Program {
  return { name, family, text: shape => (applies(shape.type) ? text : undefined) };
}

function probed(family: string, name: string, text: (s: Shape) => string | undefined, applies: (t: EastType) => boolean): Program {
  return { name, family, text: shape => (applies(shape.type) ? text(shape) : undefined) };
}

function only(family: string, name: string, text: string, shapes: readonly string[]): Program {
  return { name, family, text: shape => (shapes.includes(shape.name) ? text : undefined) };
}

const all = (): boolean => true;
const orderedData = (t: EastType): boolean => data(t) && isOrdered(t);

/** A shape's element probe, when it is one a program can find alone: not an array, which jq reads as a run. */
const bareElement = (s: Shape): string | undefined => (s.probes.element === undefined || s.probes.element.startsWith("[") ? undefined : s.probes.element);

/** Every program of the matrix. */
export const PROGRAMS: readonly Program[] = [
  // ── Every kind ────────────────────────────────────────────────────────
  program("every", "identity", ".", data),
  program("every", "type", "type", all),
  program("every", "tostring", "tostring", data),
  program("every", "tojson", "tojson", data),
  program("every", "at-text", "@text", data),
  program("every", "at-json", "@json", data),
  program("every", "wrap-array", "[.]", data),
  program("every", "wrap-object", "{v: .}", data),
  program("every", "equal-self", ". == .", orderedData),
  program("every", "not-equal-self", ". != .", orderedData),
  program("every", "truthy", "if . then \"t\" else \"f\" end", data),
  program("every", "not", "not", data),
  program("every", "interpolate", "\"<\\(.)>\"", data),
  program("every", "descend-types", "[.. | type]", data),
  program("every", "walk-identity", "walk(.)", data),
  program("every", "error-catch", "try error(.) catch .", data),
  program("every", "sort-pair", "[., .] | sort", orderedData),
  program("every", "unique-pair", "[., .] | unique", orderedData),
  program("every", "length", "length", all),

  // ── Numbers ───────────────────────────────────────────────────────────
  program("number", "add-one", ". + 1", number),
  program("number", "add-half", ". + 0.5", number),
  program("number", "subtract-one", ". - 1", number),
  program("number", "double", ". * 2", number),
  program("number", "halve", ". / 2", number),
  program("number", "modulo", ". % 3", number),
  program("number", "negate", "-.", number),
  program("number", "floor", "floor", number),
  program("number", "ceil", "ceil", number),
  program("number", "round", "round", number),
  program("number", "fabs", "fabs", number),
  program("number", "sqrt", "sqrt", number),
  program("number", "log", "log", number),
  program("number", "square", "pow(.; 2)", number),
  program("number", "isnan", "isnan", number),
  program("number", "isinfinite", "isinfinite", number),
  program("number", "isnormal", "isnormal", number),
  program("number", "less-zero", ". < 0", number),
  program("number", "greater-zero", ". > 0", number),
  program("number", "less-half", ". < 0.5", number),
  program("number", "equal-zero", ". == 0", number),
  program("number", "times-float", ". * 1.5", number),
  program("number", "length", "length", number),
  program("number", "min-with-zero", "[., 0] | min", number),

  // ── Strings ───────────────────────────────────────────────────────────
  program("string", "length", "length", string),
  program("string", "utf8bytelength", "utf8bytelength", string),
  program("string", "ascii_downcase", "ascii_downcase", string),
  program("string", "ascii_upcase", "ascii_upcase", string),
  program("string", "split", "split(\"a\")", string),
  program("string", "split-characters", "split(\"\")", string),
  program("string", "divide", ". / \"b\"", string),
  program("string", "test", "test(\"a\")", string),
  program("string", "test-ignore-case", "test(\"A\"; \"i\")", string),
  program("string", "sub", "sub(\"a\"; \"X\")", string),
  program("string", "gsub", "gsub(\"a\"; \"X\")", string),
  program("string", "ltrimstr", "ltrimstr(\"ab\")", string),
  program("string", "rtrimstr", "rtrimstr(\"ab\")", string),
  program("string", "trimstr", "trimstr(\"ab\")", string),
  program("string", "trim", "trim", string),
  program("string", "ltrim", "ltrim", string),
  program("string", "rtrim", "rtrim", string),
  program("string", "startswith", "startswith(\"a\")", string),
  program("string", "endswith", "endswith(\"b\")", string),
  program("string", "at-base64", "@base64", string),
  // jq 1.8.1 has no @base32, and nor does East.
  program("string", "at-base32", "@base32", string),
  program("string", "at-html", "@html", string),
  program("string", "at-uri", "@uri", string),
  program("string", "at-sh", "@sh", string),
  program("string", "at-csv", "[.] | @csv", string),
  program("string", "at-tsv", "[.] | @tsv", string),
  program("string", "slice", ".[1:3]", string),
  program("string", "slice-tail", ".[-2:]", string),
  program("string", "index", "index(\"b\")", string),
  program("string", "rindex", "rindex(\"b\")", string),
  program("string", "indices", "indices(\"b\")", string),
  program("string", "contains", "contains(\"b\")", string),
  program("string", "inside", "inside(\"xabcabx\")", string),
  program("string", "repeat", ". * 2", string),
  program("string", "concat", ". + \"!\"", string),
  program("string", "tonumber", "tonumber", string),
  program("string", "less-than-b", ". < \"b\"", string),

  // ── DateTimes ─────────────────────────────────────────────────────────
  ...["year", "month", "day", "hour", "minute", "second", "millisecond", "weekday", "epoch_ms", "todate"].map(name => program("datetime", name, name, datetime)),
  program("datetime", "strftime", "strftime(\"%Y-%m-%dT%H:%M:%S\")", datetime),
  program("datetime", "after-2000", ". >= \"2000-01-01\"", datetime),
  program("datetime", "before-epoch", ". < \"1970-01-01\"", datetime),
  ...["millisecond", "second", "minute", "hour", "day", "week"].map(unit => program("datetime", `add-${unit}`, `datetime_add(1; "${unit}")`, datetime)),
  program("datetime", "diff-days", "datetime_diff(\"1970-01-01T00:00:00.000Z\"; \"day\")", datetime),
  program("datetime", "diff-milliseconds", "datetime_diff(\"1970-01-01\"; \"millisecond\")", datetime),

  // ── Blobs ─────────────────────────────────────────────────────────────
  program("blob", "length", "length", blob),
  program("blob", "at-base64", "@base64", blob),

  // ── Sequences: arrays, sets, vectors ──────────────────────────────────
  program("sequence", "iterate", "[.[]]", seq),
  program("sequence", "index-first", ".[0]", seq),
  program("sequence", "index-last", ".[-1]", seq),
  program("sequence", "index-past-end", ".[99]", seq),
  program("sequence", "slice-from", ".[1:]", seq),
  program("sequence", "slice-to", ".[:-1]", seq),
  program("sequence", "first", "first", seq),
  program("sequence", "last", "last", seq),
  program("sequence", "nth", "nth(1)", seq),
  program("sequence", "length", "length", seq),
  program("sequence", "map-identity", "map(.)", seqOf(data)),
  program("sequence", "map-tostring", "map(tostring)", seqOf(data)),
  program("sequence", "select-truthy", "[.[] | select(.)]", seqOf(data)),
  program("sequence", "sort", "sort", seqOf(isOrdered)),
  program("sequence", "sort_by", "sort_by(.)", seqOf(isOrdered)),
  program("sequence", "group_by", "group_by(.)", seqOf(isOrdered)),
  program("sequence", "unique", "unique", seqOf(isOrdered)),
  program("sequence", "unique_by", "unique_by(.)", seqOf(isOrdered)),
  program("sequence", "min", "min", seqOf(isOrdered)),
  program("sequence", "max", "max", seqOf(isOrdered)),
  program("sequence", "min_by", "min_by(.)", seqOf(isOrdered)),
  program("sequence", "max_by", "max_by(.)", seqOf(isOrdered)),
  program("sequence", "reverse", "reverse", seq),
  program("sequence", "any", "any", seqOf(data)),
  program("sequence", "all", "all", seqOf(data)),
  program("sequence", "add", "add", seqOf(addable)),
  program("sequence", "limit", "[limit(2; .[])]", seq),
  program("sequence", "first-of", "first(.[])", seq),
  program("sequence", "isempty", "isempty(.[])", seq),
  program("sequence", "count-reduce", "reduce .[] as $x (0; . + 1)", seq),
  program("sequence", "count-foreach", "[foreach .[] as $x (0; . + 1)]", seq),
  program("sequence", "to_entries", "to_entries", seq),
  program("sequence", "keys", "keys", seq),
  program("sequence", "has-zero", "has(0)", seq),
  probed("sequence", "until-short", () => "[.[]] | until(length < 2; .[1:])", seq),
  // An element found alone, and as a run of one: jq reads an array argument as a run.
  probed("sequence", "index-of", s => (s.probes.element === undefined ? undefined : `index(${s.probes.element})`), seqOf(isOrdered)),
  probed("sequence", "index-run", s => (s.probes.element === undefined ? undefined : `index([${s.probes.element}])`), seqOf(isOrdered)),
  probed("sequence", "rindex-of", s => { const e = bareElement(s); return e === undefined ? undefined : `rindex(${e})`; }, seqOf(isOrdered)),
  probed("sequence", "indices-of", s => (s.probes.element === undefined ? undefined : `indices(${s.probes.element})`), seqOf(isOrdered)),
  probed("sequence", "indices-run", s => (s.probes.element === undefined ? undefined : `indices([${s.probes.element}])`), seqOf(isOrdered)),
  probed("sequence", "contains-element", s => (s.probes.element === undefined ? undefined : `contains([${s.probes.element}])`), seqOf(isOrdered)),
  probed("sequence", "inside-probe", s => (s.probes.element === undefined ? undefined : `. as $s | [${s.probes.element}] | inside($s)`), seqOf(isOrdered)),
  // bsearch's argument is one element, whatever its type.
  probed("sequence", "bsearch", s => (s.probes.element === undefined ? undefined : `sort | bsearch(${s.probes.element})`), seqOf(isOrdered)),
  program("sequence", "join", "join(\",\")", seqOf(scalar)),
  program("sequence", "at-csv", "@csv", seqOf(scalar)),
  program("sequence", "at-tsv", "@tsv", seqOf(scalar)),
  program("sequence", "at-sh", "@sh", seqOf(scalar)),

  // ── Updates of arrays ─────────────────────────────────────────────────
  program("update", "update-each", ".[] |= .", is("Array")),
  program("update", "delete-first", "del(.[0])", is("Array")),
  program("update", "delete-all", "del(.[])", is("Array")),
  program("update", "update-slice", ".[1:3] |= .", is("Array")),
  program("update", "set-first", "if length > 0 then .[0] = .[0] else . end", is("Array")),

  // ── Arrays of arrays ──────────────────────────────────────────────────
  only("nested", "flatten", "flatten", ["array-array-integer"]),
  only("nested", "transpose", "transpose", ["array-array-integer"]),
  only("nested", "combinations", "[combinations]", ["array-array-integer"]),
  only("nested", "map-add", "map(add)", ["array-array-integer"]),

  // ── Matrices ──────────────────────────────────────────────────────────
  program("matrix", "rows", "[.[]]", is("Matrix")),
  program("matrix", "length", "length", is("Matrix")),
  program("matrix", "first-row", ".[0]", is("Matrix")),
  program("matrix", "flatten", "[.[][]]", is("Matrix")),

  // ── Dicts ─────────────────────────────────────────────────────────────
  program("dict", "values", "[.[]]", dict),
  probed("dict", "lookup", s => (s.probes.key === undefined ? undefined : `.[${s.probes.key}]`), dict),
  probed("dict", "lookup-missing", s => (s.probes.missing === undefined ? undefined : `.[${s.probes.missing}]`), dict),
  program("dict", "keys", "keys", dict),
  program("dict", "keys_unsorted", "keys_unsorted", dict),
  probed("dict", "has", s => (s.probes.key === undefined ? undefined : `has(${s.probes.key})`), dict),
  probed("dict", "has-missing", s => (s.probes.missing === undefined ? undefined : `has(${s.probes.missing})`), dict),
  program("dict", "length", "length", dict),
  program("dict", "to_entries", "to_entries", dict),
  program("dict", "from_entries", "to_entries | from_entries", dict),
  program("dict", "with_entries", "with_entries(.)", dict),
  program("dict", "map_values", "map_values(.)", dict),
  program("dict", "merge", ". + .", dict),
  program("dict", "deep-merge", ". * .", dict),
  probed("dict", "delete-key", s => (s.probes.key === undefined ? undefined : `del(.[${s.probes.key}])`), dict),
  probed("dict", "update-key", s => (s.probes.key === undefined ? undefined : `.[${s.probes.key}] |= .`), dict),
  program("dict", "group-values", "to_entries | group_by(.value) | length", (t: EastType) => dict(t) && isOrdered(t)),
  probed("dict", "in", s => (s.probes.key === undefined ? undefined : `. as $d | ${s.probes.key} | in($d)`), dict),
  probed("dict", "set-key", s => (s.probes.key === undefined ? undefined : `.[${s.probes.key}] = .[${s.probes.key}]`), dict),
  probed("dict", "alternative-key", s => (s.probes.key === undefined ? undefined : `.[${s.probes.key}] //= .[${s.probes.key}]`), dict),

  // ── Structs ───────────────────────────────────────────────────────────
  probed("struct", "field", s => (s.probes.field === undefined ? undefined : `.${s.probes.field}`), struct),
  probed("struct", "field-optional", s => (s.probes.field === undefined ? undefined : `.${s.probes.field}?`), struct),
  program("struct", "missing-optional", ".missing?", struct),
  program("struct", "keys", "keys", struct),
  program("struct", "keys_unsorted", "keys_unsorted", struct),
  probed("struct", "has", s => (s.probes.field === undefined ? undefined : `has("${s.probes.field}")`), struct),
  program("struct", "has-missing", "has(\"missing\")", struct),
  program("struct", "length", "length", struct),
  program("struct", "add-field", ". + {extra: 1}", struct),
  program("struct", "deep-merge", ". * {extra: 1}", struct),
  probed("struct", "delete-field", s => (s.probes.field === undefined ? undefined : `del(.${s.probes.field})`), struct),
  probed("struct", "update-field", s => (s.probes.field === undefined ? undefined : `.${s.probes.field} |= .`), struct),
  program("struct", "new-field", ".extra = 1", struct),
  probed("struct", "pick", s => (s.probes.field === undefined ? undefined : `pick(.${s.probes.field})`), struct),
  probed("struct", "construct", s => (s.probes.field === undefined ? undefined : `{${s.probes.field}}`), struct),
  probed("struct", "destructure", s => (s.probes.field === undefined ? undefined : `. as {${s.probes.field}: $x} | $x`), struct),
  program("struct", "values", "[.[]]", uniform),
  program("struct", "to_entries", "to_entries", uniform),
  program("struct", "with_entries", "with_entries(.)", uniform),
  program("struct", "map_values", "map_values(.)", uniform),
  program("struct", "field-types", "map_values(type)", struct),
  only("struct", "add-assign", ".a += 1", ["struct-one"]),
  only("struct", "construct-two", "{c, d}", ["struct-eight"]),

  // ── Variants ──────────────────────────────────────────────────────────
  program("variant", "tag", ".type", variant),
  program("variant", "payload", ".value", variant),
  probed("variant", "select-case", s => (s.probes.case === undefined ? undefined : `select(.type == "${s.probes.case}")`), variant),
  probed("variant", "if-case", s => (s.probes.case === undefined ? undefined : `if .type == "${s.probes.case}" then "yes" else "no" end`), variant),
  program("variant", "update-payload", ".value |= .", variant),
  // A payload's field read un-narrowed (null for the cases without it), and narrowed.
  only("variant", "payload-field", ".value.date", ["variant"]),
  only("variant", "narrowed-field", "select(.type == \"shipped\") | .value.date", ["variant"]),
  only("variant", "if-narrowed", "if .type == \"cancelled\" then .value.reason elif .type == \"shipped\" then .value.date else \"-\" end", ["variant"]),
  only("variant", "alternative-field", ".value.date // \"none\"", ["variant"]),

  // ── Options ───────────────────────────────────────────────────────────
  program("option", "values", "values", option),
  program("option", "is-null", ". == null", option),
  program("option", "if-null", "if . == null then \"none\" else \"some\" end", option),
  program("option", "select-present", "select(. != null)", option),
  only("option", "add-one", ". + 1", ["option-integer"]),
  only("option", "alternative", ". // 0", ["option-integer"]),
  only("option", "iterate-optional", "[.[]?]", ["option-array"]),
  only("option", "field-through", ".x", ["option-struct"]),

  // ── Recursive types ───────────────────────────────────────────────────
  program("recursive", "recurse-types", "[recurse | type]", (t: EastType) => made(t) !== t && t.type === "Recursive"),
  program("recursive", "descend-numbers", "[.. | numbers]", (t: EastType) => t.type === "Recursive"),
  only("recursive", "skus", "[recurse(.children[]) | .sku]", ["recursive-tree"]),
  only("recursive", "total-cost", "[recurse(.children[]) | .cost] | add", ["recursive-tree"]),
  only("recursive", "double-costs", "(.. | numbers) |= . * 2", ["recursive-tree"]),
  only("recursive", "depth-first", "[.. | objects | .sku?]", ["recursive-tree"]),

  // ── Refs ──────────────────────────────────────────────────────────────
  only("ref", "add-one", ". + 1", ["ref-integer"]),
  only("ref", "length", "length", ["ref-array"]),
  only("ref", "index", ".[0]", ["ref-array"]),
  only("ref", "field", ".a", ["ref-struct"]),
  // An update through a reference: the value it refers to, updated.
  only("ref", "update-element", ".[0] |= . + 1", ["ref-array"]),
  only("ref", "update-field", ".a |= . + 1", ["ref-struct"]),

  // ── Functions ─────────────────────────────────────────────────────────
  probed("function", "call", s => (s.probes.argument === undefined ? undefined : `call(.; ${s.probes.argument})`), fn),

  // ── Composites: types in combination ──────────────────────────────────
  only("composite", "shipped-ids", "[.[] | select(.status.type == \"shipped\") | .id]", ["composite-orders"]),
  only("composite", "tag-counts", "map(.tags | length)", ["composite-orders"]),
  only("composite", "attr-entries", "[.[] | .attrs | to_entries[]] | length", ["composite-orders"]),
  only("composite", "child-skus", "map(.children | map(.sku))", ["composite-orders"]),
  only("composite", "by-status", "group_by(.status.type) | map(length)", ["composite-orders"]),
  only("composite", "present-attrs", "[.[] | .attrs[] | values]", ["composite-orders"]),
  only("composite", "cell-lengths", "[.[] | length]", ["composite-cells"]),
  only("composite", "cell-keys", "keys | map(.region)", ["composite-cells"]),
  only("composite", "field-kinds", "[.[] | type]", ["composite-every-kind"]),
];
