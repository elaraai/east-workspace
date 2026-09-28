/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Summaries: one generated jq program that profiles a value of a type leaf by
 * leaf, which runs wherever queries run (`devdocs/QUERY.md` §19).
 *
 * @packageDocumentation
 */

import { printFor } from "../../serialization/east.js";
import {
  ArrayType, DateTimeType, DictType, FloatType, IntegerType, OptionType, StringType, StructType, type EastType,
} from "../../types.js";
import { plainKind } from "./describe.js";
import { nullablePayload, unwrap } from "./shapes.js";

const printString = printFor(StringType);

/** A value and how many times it occurs. */
const TextCountType = StructType({ n: IntegerType, value: StringType });

/**
 * What a summary says about one leaf path of the rows.
 *
 * @remarks
 * - `cases` — a variant's cases in declared order, each with how many rows
 *   hold it (zero counts kept).
 * - `count` — how many values reach the path (a list's elements each count).
 * - `dates` — for dates: the first and last, and the counts per month
 *   (`"2026-03"`) and per year.
 * - `distinct` — how many different values: for text, cases and whole numbers.
 * - `kind` — the plain kind: `"text"`, `"number, sometimes missing"`, ….
 * - `lengths` — for lists and lookup tables: the shortest and longest.
 * - `missing` — how many values are null.
 * - `numbers` — for numbers: the least, greatest, mean and median.
 * - `values` — for text and yes-or-no: the most common values, by count and
 *   then value.
 */
export const SummaryLeafType = StructType({
  cases: OptionType(ArrayType(TextCountType)),
  count: IntegerType,
  dates: OptionType(StructType({
    max: DateTimeType,
    min: DateTimeType,
    months: ArrayType(TextCountType),
    years: ArrayType(StructType({ n: IntegerType, value: IntegerType })),
  })),
  distinct: OptionType(IntegerType),
  kind: StringType,
  lengths: OptionType(StructType({ max: IntegerType, min: IntegerType })),
  missing: IntegerType,
  numbers: OptionType(StructType({ max: FloatType, mean: FloatType, median: FloatType, min: FloatType })),
  values: OptionType(ArrayType(TextCountType)),
});

/**
 * A summary: how many rows, and each leaf path's {@link SummaryLeafType}, by
 * its jq path from a row (`.total`, `.lines[].sku`, `.status.value.date`).
 */
export const SummaryType = StructType({ count: IntegerType, leaves: DictType(StringType, SummaryLeafType) });

/** Options for {@link summaryProgram}. */
export interface SummaryProgramOptions {
  /** The most leaf paths to summarise, shallowest first: 100 by default. */
  maxLeaves?: number;
  /** How many of the most common text values to keep: 20 by default. */
  topValues?: number;
}

/** One leaf to summarise: its path from a row, the jq that reaches it, and its type. */
interface Leaf {
  path: string;
  reach: string;
  type: EastType;
  cases?: readonly string[];
}

/** A field's name in a path: bare when it is an identifier. */
function fieldStep(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `.${name}` : `.${printString(name)}`;
}

/** The leaves of a row type, breadth first. */
function leavesOf(row: EastType, maxLeaves: number): Leaf[] {
  const leaves: Leaf[] = [];
  const queue: { type: EastType; path: string; reach: string; seen: ReadonlySet<EastType> }[] = [
    { type: row, path: ".", reach: ".", seen: new Set() },
  ];
  // A path read after another: `.` then `.a` is `.a`, and a reach through a
  // case's `select` continues after a pipe.
  const join = (base: string, step: string): string => {
    if (base === ".") return step.startsWith("[") ? `.${step}` : step;
    return base.endsWith(")") ? `${base} | ${step.startsWith("[") ? `.${step}` : step}` : `${base}${step}`;
  };
  while (queue.length > 0 && leaves.length < maxLeaves) {
    const item = queue.shift()!;
    const { type, path, reach } = item;
    let seen = item.seen;
    // A recursive type is summarised once, where it is first reached.
    if (type.type === "Recursive") {
      if (seen.has(type)) continue;
      seen = new Set([...seen, type]);
    }
    const t = unwrap(type);
    const payload = nullablePayload(t);
    const inner = payload === undefined ? t : unwrap(payload);
    switch (inner.type) {
      case "String": case "Integer": case "Float": case "Boolean": case "DateTime":
        leaves.push({ path, reach, type });
        break;
      case "Array": case "Set": case "Vector": case "Dict": {
        leaves.push({ path, reach, type });
        const element = inner.type === "Array" ? inner.value : inner.type === "Set" ? inner.key : inner.type === "Vector" ? inner.element : inner.value;
        queue.push({ type: element as EastType, path: join(path, "[]"), reach: join(reach, payload === undefined ? "[]" : "[]?"), seen });
        break;
      }
      case "Struct":
        for (const [name, field] of Object.entries(inner.fields as Record<string, EastType>)) {
          queue.push({ type: field, path: join(path, fieldStep(name)), reach: join(reach, fieldStep(name)), seen });
        }
        break;
      case "Variant": {
        const cases = inner.cases as Record<string, EastType>;
        leaves.push({ path: join(path, ".type"), reach: join(reach, ".type"), type: payload === undefined ? StringType : OptionType(StringType), cases: Object.keys(cases) });
        for (const [name, caseType] of Object.entries(cases)) {
          if (unwrap(caseType).type === "Null") continue;
          const narrowed = `${reach === "." ? "" : `${reach} | `}select(.type == ${printString(name)}) | .value`;
          queue.push({ type: caseType, path: join(path, ".value"), reach: `(${narrowed})`, seen });
        }
        break;
      }
      default:
        break;
    }
  }
  return leaves.slice(0, maxLeaves);
}

/** The jq for one leaf's summary, over `$rows`. */
function leafProgram(leaf: Leaf, topValues: number): string {
  const t = unwrap(leaf.type);
  const nullable = nullablePayload(t) !== undefined;
  const inner = unwrap(nullablePayload(t) ?? t);
  const reach = leaf.reach;
  const kind = leaf.cases !== undefined ? `one of${nullable ? ", sometimes missing" : ""}` : plainKind(leaf.type);
  const counts = (of: string, value: string) => `${of} | group_by(.) | map({n: length, value: (.[0] // ${value})})`;
  const top = `sort_by({n: -.n, value}) | .[:${topValues}]`;
  let cases = "null";
  let dates = "null";
  let distinct = "null";
  let lengths = "null";
  let numbers = "null";
  let values = "null";
  if (leaf.cases !== undefined) {
    cases = `[${leaf.cases.map(c => `{n: ([$p[] | select(. == ${printString(c)})] | length), value: ${printString(c)}}`).join(", ")}]`;
    distinct = "($p | unique | length)";
  } else {
    switch (inner.type) {
      case "String":
        distinct = "($p | unique | length)";
        values = `(${counts("$p", "\"\"")} | ${top})`;
        break;
      case "Boolean":
        values = `(${counts("$p | map(tostring)", "\"\"")} | ${top})`;
        break;
      case "Integer": case "Float":
        if (inner.type === "Integer") distinct = "($p | unique | length)";
        numbers = "(if ($p | length) == 0 then null else ($p | map(. + 0.0)) as $n | "
          + "{max: ($n | max // 0.0), mean: ($n | add / length), median: ($n | sort | .[length / 2 | floor] // 0.0), min: ($n | min // 0.0)} end)";
        break;
      case "DateTime":
        dates = "(if ($p | length) == 0 then null else "
          + `{max: ($p | max // $epoch), min: ($p | min // $epoch), months: (${counts("$p | map(strftime(\"%Y-%m\"))", "\"\"")}), `
          + `years: (${counts("$p | map(year)", "0")})} end)`;
        break;
      default:
        lengths = "($p | map(length) | if length == 0 then null else {max: (max // 0), min: (min // 0)} end)";
        break;
    }
  }
  const missing = nullable ? "([$v[] | select(. == null)] | length)" : "0";
  const present = nullable ? "[$v[] | values] as $p | " : "$v as $p | ";
  return `{key: ${printString(leaf.path)}, value: ([$rows[] | ${reach}] as $v | ${present}`
    + `{cases: ${cases}, count: ($v | length), dates: ${dates}, distinct: ${distinct}, kind: ${printString(kind)}, `
    + `lengths: ${lengths}, missing: ${missing}, numbers: ${numbers}, values: ${values}})}`;
}

/**
 * Two leaves that give every part of a {@link SummaryLeafType} its type: one
 * with every optional part and one with none. The summary lists them first and
 * drops them, so its leaves have exactly that type whatever the rows hold.
 */
const PROTOTYPES = [
  "{key: \"\", value: {cases: [{n: 0, value: \"\"}], count: 0, dates: {max: $epoch, min: $epoch, months: [{n: 0, value: \"\"}], "
    + "years: [{n: 0, value: 0}]}, distinct: 0, kind: \"\", lengths: {max: 0, min: 0}, missing: 0, "
    + "numbers: {max: 0.0, mean: 0.0, median: 0.0, min: 0.0}, values: [{n: 0, value: \"\"}]}}",
  "{key: \"\", value: {cases: null, count: 0, dates: null, distinct: null, kind: \"\", lengths: null, missing: 0, numbers: null, values: null}}",
];

/**
 * A jq program that summarises a value of a type, leaf by leaf, to a
 * {@link SummaryType}.
 *
 * @param type - the type of the value the program runs on
 * @param options - how many leaves, and how many text values per leaf
 * @returns the program's text, which checks against `type` to `SummaryType`
 *
 * @remarks
 * The rows are the elements of an array or set, the values of a dict, and
 * otherwise the value itself. The leaves are the paths from a row to each
 * scalar, each variant's `.type` and each case's payload leaves (counted
 * where the case holds), and each list, shallowest first. The program binds
 * the rows once and builds each leaf's summary with jq over them, so it runs
 * wherever queries run, and after any program: `prefix + " | " +
 * summaryProgram(typeAfterPrefix)` summarises the rows at that stage.
 *
 * @example
 * ```ts
 * const program = summaryProgram(ArrayType(StructType({ total: FloatType })));
 * checkJq(program, ArrayType(StructType({ total: FloatType }))).elementType;   // SummaryType
 * ```
 */
export function summaryProgram(type: EastType, options: SummaryProgramOptions = {}): string {
  const t = unwrap(type);
  const payload = nullablePayload(t);
  const container = unwrap(payload ?? t);
  const elementOf = (u: EastType): EastType | undefined =>
    u.type === "Array" ? u.value as EastType : u.type === "Set" ? u.key as EastType : u.type === "Vector" ? u.element as EastType
      : u.type === "Dict" ? u.value as EastType : undefined;
  const element = elementOf(container);
  const rows = element === undefined ? "[.]" : payload === undefined ? "[.[]]" : "[.[]?]";
  const leaves = leavesOf(element ?? type, options.maxLeaves ?? 100);
  const entries = [...PROTOTYPES, ...leaves.map(leaf => leafProgram(leaf, options.topValues ?? 20))];
  return `("1970-01-01T00:00:00Z" | fromdate) as $epoch | ${rows} as $rows | `
    + `{count: ($rows | length), leaves: ([${entries.join(", ")}] | .[2:] | from_entries)}`;
}
