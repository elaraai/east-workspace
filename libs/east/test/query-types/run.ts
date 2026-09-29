/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The type matrix (#987): every shape × every program that applies to it,
 * each run on each of the shape's values and judged against jq 1.8.1 where
 * jq can see the value and the result (`view.ts`), as recorded in
 * `test/fixtures/query-types.json` by `make query-types`, or against the
 * East oracle QUERY.md gives it where jq cannot (`oracle.ts`).
 *
 * A case's input reaches jq as East's JSON (`encodeJSONFor`) behind a filter
 * that turns it into the value jq sees, and each of jq's outputs comes back
 * through a filter that turns it into East JSON, which East's decoder reads
 * (`decodeJSONFor`) as a value of the query's element type. jq's text must be
 * that value's own encoding, so a Set jq gave out of East's order, or with
 * duplicates, is not read as the set it would decode to.
 *
 * A value's case lands in one bucket: it passes (East gives what jq gives);
 * it differs by a deviation of §13 that `oracle.ts` lists, and East gives
 * the oracle's value; it is East-only and gives the oracle's value; both
 * raise an error at run time; East refuses the program where jq raises an
 * error, or as `oracle.ts` lists with the section of QUERY.md that says so;
 * or it fails.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  ArrayType, OptionType, QueryError, checkJq, decodeJSONFor, encodeJSONFor, equalFor, evaluateJq, none, printFor, some, translateJq,
  type CheckJqResult, type EastType,
} from "../../src/index.js";
import { describeType } from "../../src/query/jq/shapes.js";
import { DEVIATIONS, REFUSALS, oracleFor } from "./oracle.js";
import { PROGRAMS, type Program } from "./programs.js";
import { SHAPES, type Shape, type ShapeValue } from "./shapes.js";
import { hasJqView, jqWrapped } from "./view.js";

/** A program run on a shape: one East test, over each of the shape's values. */
export interface Pair {
  /** `shape:family.program`. */
  readonly id: string;
  readonly shape: Shape;
  readonly program: Program;
  readonly text: string;
}

/** A pair's case for one value: `shape/value:family.program`. */
export function caseId(pair: Pair, value: ShapeValue): string {
  return `${pair.shape.name}/${value.label}:${pair.program.family}.${pair.program.name}`;
}

/** Every pair of the matrix, shape by shape, in the order the programs are listed. */
export function matrixPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const shape of SHAPES) {
    for (const program of PROGRAMS) {
      const text = program.text(shape);
      if (text !== undefined) pairs.push({ id: `${shape.name}:${program.family}.${program.name}`, shape, program, text });
    }
  }
  return pairs;
}

/** A pair's program checked for its shape's type: the check and its result type, or why East refuses it. */
export type PairCheck =
  | { readonly checked: CheckJqResult; readonly resultType: EastType }
  | { readonly refused: string };

/** Checks a pair's program for its shape's type. */
export function checkPair(pair: Pair): PairCheck {
  const checked = checkJq(pair.text, pair.shape.type);
  const errors = checked.diagnostics.filter(d => d.severity.type === "error");
  if (checked.query === null || checked.elementType === null || errors.length > 0) {
    return { refused: errors.map(d => d.message).join(" | ") || "does not check" };
  }
  return { checked, resultType: translateJq(checked).resultType };
}

/** Whether jq judges a pair: jq sees its input and, when East checks it, its outputs. */
function jqJudges(pair: Pair, check: PairCheck): boolean {
  return hasJqView(pair.shape.type) && ("refused" in check || hasJqView(check.checked.elementType!));
}

/** A value as East JSON's text. */
function jsonText(type: EastType, value: unknown): string {
  return new TextDecoder().decode(encodeJSONFor(type)(value as never));
}

/**
 * A case jq runs: its pair, its value's label, its input as East JSON, and
 * the program behind the filters of `view.ts`, with the pair's program as
 * written and a digest of the whole, which the fixture records.
 */
export interface JqCase {
  readonly pair: string;
  readonly shape: string;
  readonly label: string;
  readonly input: string;
  readonly program: string;
  readonly text: string;
  readonly digest: string;
}

/** The jq program of a pair: its outputs turned into East JSON when East checks it. */
function jqProgram(pair: Pair, check: PairCheck): string {
  return jqWrapped(pair.text, pair.shape.type, "refused" in check ? undefined : check.checked.elementType!);
}

/** A digest of a jq program: enough of its SHA-256 to tell a recorded run of another program. */
function digestOf(program: string): string {
  return createHash("sha256").update(program).digest("hex").slice(0, 16);
}

/** The cases jq judges, which `make query-types` runs through jq. */
export function jqCases(): JqCase[] {
  const out: JqCase[] = [];
  for (const pair of matrixPairs()) {
    const check = checkPair(pair);
    if (!jqJudges(pair, check)) continue;
    const program = jqProgram(pair, check);
    const digest = digestOf(program);
    for (const value of pair.shape.values) {
      out.push({ pair: pair.id, shape: pair.shape.name, label: value.label, input: jsonText(pair.shape.type, value.value), program, text: pair.text, digest });
    }
  }
  return out;
}

/** What jq did with one value: its outputs, or its error. */
export interface JqRecord {
  readonly outputs?: readonly string[];
  readonly error?: string;
}

/** What jq did with a pair: its program as written, the digest of what jq ran, and each value's run by label. */
export interface JqPairRecord {
  readonly program: string;
  readonly digest: string;
  readonly runs: Readonly<Record<string, JqRecord>>;
}

/**
 * The recorded runs of jq, `test/fixtures/query-types.json`: each shape's
 * inputs as East JSON by label, and each pair's runs.
 */
export interface JqFixture {
  readonly jq: string;
  readonly inputs: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly pairs: Readonly<Record<string, JqPairRecord>>;
}

/**
 * The fixture's text: a shape's inputs on one line and a pair on one line,
 * so a change to one is one line of a diff.
 *
 * @param fixture - the recorded runs
 * @returns the file's text
 */
export function jqFixtureText(fixture: JqFixture): string {
  const lines = (entries: Readonly<Record<string, unknown>>): string =>
    Object.entries(entries).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n");
  return `{\n "jq": ${JSON.stringify(fixture.jq)},\n "inputs": {\n${lines(fixture.inputs)}\n },\n "pairs": {\n${lines(fixture.pairs)}\n }\n}\n`;
}

/** The fixture's location. */
export const JQ_FIXTURE = new URL("../../../test/fixtures/query-types.json", import.meta.url);

/** The recorded runs, or none when the file is missing. */
export function readJqFixture(): JqFixture {
  try {
    return JSON.parse(readFileSync(JQ_FIXTURE, "utf8")) as JqFixture;
  } catch {
    return { jq: "", inputs: {}, pairs: {} };
  }
}

/** Where a value's case lands. */
export type Outcome =
  | { readonly bucket: "pass" }
  | { readonly bucket: "deviation"; readonly deviation: number }
  | { readonly bucket: "east-only" }
  | { readonly bucket: "error" }
  | { readonly bucket: "refused"; readonly section?: string }
  | { readonly bucket: "fail"; readonly detail: string };

/** A value's case run: where it lands, and what its compliance test asserts. */
export interface ValueRun {
  readonly id: string;
  readonly value: ShapeValue;
  readonly outcome: Outcome;
  /** The value East's result equals, or `error` when its run raises one; none for a refused program. */
  readonly expected?: { readonly value: unknown } | "error";
}

/** A pair run: its check, and each value's case. */
export interface PairRun {
  readonly pair: Pair;
  readonly check: PairCheck;
  readonly runs: readonly ValueRun[];
}

/** Runs a pair on each of its shape's values. */
export function runPair(pair: Pair, fixture: JqFixture): PairRun {
  const check = checkPair(pair);
  const runs = pair.shape.values.map(value => ("refused" in check ? refusedValue(pair, check, value, fixture) : runValue(pair, check, value, fixture)));
  return { pair, check, runs };
}

/** jq's record of a case, when it is recorded for the case's input and program as they are now. */
function recordOf(pair: Pair, check: PairCheck, value: ShapeValue, fixture: JqFixture): JqRecord | undefined {
  const entry = fixture.pairs[pair.id];
  if (entry === undefined || entry.program !== pair.text || entry.digest !== digestOf(jqProgram(pair, check))) return undefined;
  if (fixture.inputs[pair.shape.name]?.[value.label] !== jsonText(pair.shape.type, value.value)) return undefined;
  return entry.runs[value.label];
}

const NOT_RECORDED = "jq's run is not recorded for this input and program: run `make query-types` in libs/east";

/** A value's case of a program East refuses: `REFUSALS` lists it, or jq raises an error on it. */
function refusedValue(pair: Pair, check: { readonly refused: string }, value: ShapeValue, fixture: JqFixture): ValueRun {
  const id = caseId(pair, value);
  const fail = (detail: string): ValueRun => ({ id, value, outcome: { bucket: "fail", detail } });
  const listed = REFUSALS.find(r => r.applies(pair));
  if (listed !== undefined) return { id, value, outcome: { bucket: "refused", section: listed.section } };
  if (!jqJudges(pair, check)) return fail(`East refuses it (${check.refused}), which REFUSALS does not list`);
  const record = recordOf(pair, check, value, fixture);
  if (record === undefined) return fail(NOT_RECORDED);
  return record.error !== undefined
    ? { id, value, outcome: { bucket: "refused" } }
    : fail(`East refuses it (${check.refused}), where jq gives ${(record.outputs ?? []).join(", ") || "nothing"}`);
}

/** East's result for a value, or the error it raised. */
function eastResult(checked: CheckJqResult, value: unknown): { value: unknown } | { error: string } {
  try {
    return { value: evaluateJq(checked, value) };
  } catch (e) {
    if (e instanceof QueryError) return { error: e.message };
    return { error: `${(e as Error).name}: ${(e as Error).message}` };
  }
}

/** jq's outputs read as the query's result: the element, an option of it, or an array of them. */
function jqResult(record: JqRecord, checked: CheckJqResult): { value: unknown } | { error: string } | { unreadable: string } {
  if (record.error !== undefined) return { error: record.error };
  const element = checked.elementType!;
  const decode = decodeJSONFor(element);
  const encode = encodeJSONFor(element);
  const outputs: unknown[] = [];
  for (const text of record.outputs ?? []) {
    let read: unknown;
    try {
      read = decode(new TextEncoder().encode(text));
    } catch (e) {
      return { unreadable: `jq gives ${text}, which is not a ${describeType(element)} (${(e as Error).message})` };
    }
    const own = new TextDecoder().decode(encode(read as never));
    if (!isDeepStrictEqual(JSON.parse(text), JSON.parse(own))) return { unreadable: `jq gives ${text}, whose ${describeType(element)} East writes ${own}` };
    outputs.push(read);
  }
  const m = checked.multiplicity;
  if (m === "one") return outputs.length === 1 ? { value: outputs[0] } : { unreadable: `jq gives ${outputs.length} outputs to a query that gives one` };
  if (m === "maybe") return outputs.length <= 1 ? { value: outputs.length === 0 ? none : some(outputs[0]) } : { unreadable: `jq gives ${outputs.length} outputs to a query that gives at most one` };
  return { value: outputs };
}

function runValue(pair: Pair, check: { readonly checked: CheckJqResult; readonly resultType: EastType }, value: ShapeValue, fixture: JqFixture): ValueRun {
  const { checked, resultType } = check;
  const id = caseId(pair, value);
  const equal = equalFor(resultType);
  const print = printFor(resultType);
  // An oracle's value that is not of the result type is a fault of the oracle's, which the case reports.
  const show = (v: unknown): string => {
    try { return print(v as never); } catch { return `a value that is not a ${describeType(resultType)}`; }
  };
  const east = eastResult(checked, value.value);
  const fail = (detail: string): ValueRun => ({ id, value, outcome: { bucket: "fail", detail } });

  // East-only: jq cannot see the input or the result, so QUERY.md is the oracle.
  if (!jqJudges(pair, check)) {
    const oracle = oracleFor(pair.program);
    if (oracle === undefined) return fail(`jq cannot judge it, and there is no East oracle for ${pair.program.family}.${pair.program.name}`);
    const expected = oracle(pair.shape, value.value, resultType);
    if (expected === "error") {
      return "error" in east ? { id, value, outcome: { bucket: "east-only" }, expected: "error" } : fail(`gives ${show(east.value)}, where QUERY.md raises an error`);
    }
    if ("error" in east) return fail(`raises ${east.error}, where QUERY.md gives ${show(expected.value)}`);
    return equal(east.value as never, expected.value as never)
      ? { id, value, outcome: { bucket: "east-only" }, expected }
      : fail(`gives ${show(east.value)}, where QUERY.md gives ${show(expected.value)}`);
  }

  const record = recordOf(pair, check, value, fixture);
  if (record === undefined) return fail(NOT_RECORDED);
  const jq = jqResult(record, checked);

  // Where jq agrees, the case passes, a deviation or not.
  const agrees = "unreadable" in jq ? false
    : "error" in jq ? "error" in east
    : !("error" in east) && equal(east.value as never, jq.value as never);
  const deviation = agrees ? undefined : DEVIATIONS.find(d => d.applies(pair, value));
  if (deviation !== undefined) {
    // East differs as §13 says: it gives the oracle's value.
    const oracle = oracleFor(pair.program);
    if (oracle === undefined) return fail(`listed as §13.${deviation.deviation}, with no East oracle for it`);
    const expected = oracle(pair.shape, value.value, resultType);
    if (expected === "error") {
      return "error" in east ? { id, value, outcome: { bucket: "deviation", deviation: deviation.deviation }, expected: "error" } : fail(`gives ${show(east.value)}, where §13.${deviation.deviation} raises an error`);
    }
    if ("error" in east) return fail(`raises ${east.error}, where §13.${deviation.deviation} gives ${show(expected.value)}`);
    return equal(east.value as never, expected.value as never)
      ? { id, value, outcome: { bucket: "deviation", deviation: deviation.deviation }, expected }
      : fail(`gives ${show(east.value)}, where §13.${deviation.deviation} gives ${show(expected.value)}`);
  }

  if ("unreadable" in jq) return fail(jq.unreadable);
  if ("error" in jq) {
    return "error" in east ? { id, value, outcome: { bucket: "error" }, expected: "error" } : fail(`gives ${show(east.value)}, where jq raises: ${jq.error}`);
  }
  if ("error" in east) return fail(`raises ${east.error}, where jq gives ${show(jq.value)}`);
  return equal(east.value as never, jq.value as never)
    ? { id, value, outcome: { bucket: "pass" }, expected: { value: jq.value } }
    : fail(`gives ${show(east.value)}, where jq gives ${show(jq.value)}`);
}

/** The result type of a query of a multiplicity over an element type. */
export function resultTypeOf(element: EastType, multiplicity: "one" | "maybe" | "many"): EastType {
  return multiplicity === "one" ? element : multiplicity === "maybe" ? OptionType(element) : ArrayType(element);
}

/** The kinds of shape, in the order of the issue's table: a compliance suite each. */
export const KINDS = ["scalars", "arrays", "sets", "dicts", "tensors", "structs", "variants", "recursive", "refs", "functions", "composites"] as const;

/** Where the matrix's cases land, counted: what `devdocs/QUERY.md` §16.5's tables show. */
export interface MatrixSummary {
  /** Each kind's shapes, pairs and cases, and how many cases land in each bucket, in the order of {@link KINDS}. */
  readonly kinds: readonly {
    readonly kind: string; readonly shapes: number; readonly pairs: number; readonly cases: number;
    readonly pass: number; readonly deviation: number; readonly eastOnly: number; readonly error: number; readonly refused: number; readonly fail: number;
  }[];
  /** How many cases differ by each deviation of §13, by its number. */
  readonly deviations: readonly { readonly deviation: number; readonly cases: number }[];
  /** The pairs East refuses, by the section of QUERY.md that says so; none where jq raises an error too. */
  readonly refusals: readonly { readonly section: string | undefined; readonly pairs: readonly string[] }[];
}

/**
 * Counts where the matrix's cases land.
 *
 * @param runs - every pair's run, in matrix order
 * @returns the summary
 */
export function matrixSummary(runs: readonly PairRun[]): MatrixSummary {
  const kinds = KINDS.map(kind => {
    const of = runs.filter(r => r.pair.shape.kind === kind);
    const cases = of.flatMap(r => r.runs);
    const count = (bucket: Outcome["bucket"]): number => cases.filter(c => c.outcome.bucket === bucket).length;
    return {
      kind, shapes: new Set(of.map(r => r.pair.shape.name)).size, pairs: of.length, cases: cases.length,
      pass: count("pass"), deviation: count("deviation"), eastOnly: count("east-only"), error: count("error"), refused: count("refused"), fail: count("fail"),
    };
  });
  const deviations = new Map<number, number>();
  const refusals = new Map<string, Set<string>>();
  for (const r of runs) {
    for (const c of r.runs) {
      if (c.outcome.bucket === "deviation") deviations.set(c.outcome.deviation, (deviations.get(c.outcome.deviation) ?? 0) + 1);
      if (c.outcome.bucket === "refused") {
        const key = c.outcome.section ?? "";
        refusals.set(key, (refusals.get(key) ?? new Set()).add(r.pair.id));
      }
    }
  }
  return {
    kinds,
    deviations: [...deviations].sort(([a], [b]) => a - b).map(([deviation, cases]) => ({ deviation, cases })),
    refusals: [...refusals].sort(([a], [b]) => bySection(a, b)).map(([section, pairs]) => ({ section: section === "" ? undefined : section, pairs: [...pairs] })),
  };
}

/** Sections in document order, `13.5` before `13.27`; no section (jq's own error) first. */
function bySection(a: string, b: string): number {
  const x = a === "" ? [] : a.split(".").map(Number);
  const y = b === "" ? [] : b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/** The markers around §16.5's generated tables. */
const MATRIX_START = "<!-- matrix: written by `make query-types` from test/query-types/ and test/fixtures/query-types.json -->";
const MATRIX_END = "<!-- /matrix -->";

/**
 * `QUERY.md` with §16.5's tables as a summary makes them: the cases by kind
 * and bucket, the cases by deviation (with §13's titles), and the pairs East
 * refuses, by the section that says so.
 *
 * @param doc - `QUERY.md`'s text
 * @param summary - the summary
 * @returns the text with the tables between their markers replaced
 * @throws {Error} When the markers are missing, or a deviation or a section has no heading.
 */
export function withMatrixTables(doc: string, summary: MatrixSummary): string {
  const start = doc.indexOf(MATRIX_START);
  const end = doc.indexOf(MATRIX_END);
  if (start < 0 || end < start) throw new Error("devdocs/QUERY.md has no matrix table markers");
  const headings = new Map([...doc.matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.? (.+)$/gm)].map(m => [m[1]!, m[2]!]));
  const title = (section: string): string => {
    const text = headings.get(section);
    if (text === undefined) throw new Error(`§${section} has no heading in devdocs/QUERY.md`);
    return `§${section} ${text.replace(/\|/g, "\\|")}`;
  };
  const all = summary.kinds.reduce((t, k) => ({
    shapes: t.shapes + k.shapes, pairs: t.pairs + k.pairs, cases: t.cases + k.cases, pass: t.pass + k.pass, deviation: t.deviation + k.deviation,
    eastOnly: t.eastOnly + k.eastOnly, error: t.error + k.error, refused: t.refused + k.refused, fail: t.fail + k.fail,
  }), { shapes: 0, pairs: 0, cases: 0, pass: 0, deviation: 0, eastOnly: 0, error: 0, refused: 0, fail: 0 });
  const row = (name: string, k: typeof all): string =>
    `| ${name} | ${k.shapes} | ${k.pairs} | ${k.cases} | ${k.pass} | ${k.deviation} | ${k.eastOnly} | ${k.error} | ${k.refused} | ${k.fail} |`;
  const lines = [
    MATRIX_START,
    "| Kind | Shapes | Pairs | Cases | Pass | Deviation | East-only | Error | Refused | Fail |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...summary.kinds.map(k => row(k.kind, k)),
    row("All", all),
    "",
    "| Deviation | Cases |",
    "|---|---|",
    ...summary.deviations.map(d => `| ${title(`13.${d.deviation}`)} | ${d.cases} |`),
    "",
    "| Refused by | Pairs |",
    "|---|---|",
    ...summary.refusals.map(r => `| ${r.section === undefined ? "jq raises an error too" : title(r.section)} | ${r.pairs.length}: ${r.pairs.join(", ")} |`),
    MATRIX_END,
  ];
  return `${doc.slice(0, start)}${lines.join("\n")}${doc.slice(end + MATRIX_END.length)}`;
}
