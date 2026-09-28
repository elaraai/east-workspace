/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * jq 1.8's own test suites run against East's jq (#924). Each case is read as
 * jq's runner reads it (`src/jq_test.c`), its input typed as an East value
 * (`typing.ts`), and its program checked, translated and run with
 * `evaluateJq`; its outputs are compared with jq's. Every case lands in one
 * bucket: it passes, it differs by a deviation of `devdocs/QUERY.md` §13, it
 * is skipped for a reason, or it fails. `query.conformance.spec.ts` holds that
 * none fails, and that `summary.json` counts them as they are now.
 */

import { readFileSync } from "node:fs";
import {
  ArrayType, NullType, OptionType, QueryError, TranslationError, checkJq, equalFor, evaluateJq, none, printFor, printType, some,
  type CheckJqResult, type EastType, type option,
} from "../../src/index.js";
import { DEVIATIONS, SKIPS } from "./deviations.js";
import { expectedAs, readJson, typeOf, valueOf, type Json } from "./typing.js";

/** The suites, in the order the summary lists them. */
export const SUITES = ["jq.test", "man.test", "onig.test", "optional.test"] as const;

/** One case of a suite. */
export interface JqTestCase {
  /** `file:line`, the line its program is on. */
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly program: string;
  /** The input's text; none for a case that must fail to compile. */
  readonly input: string | undefined;
  /** The expected outputs' text; for a case that must fail, jq's message. */
  readonly expected: readonly string[];
  /** The program must fail to compile (`%%FAIL`). */
  readonly mustFail: boolean;
}

/**
 * Reads a suite as jq's test runner does: blank lines and `#` lines separate
 * cases; a case is a program line, an input line and its expected outputs; and
 * after `%%FAIL` a program that must fail to compile, and its message.
 *
 * @param file - the suite's name
 * @param text - its text
 * @returns its cases, in order
 */
export function readSuite(file: string, text: string): JqTestCase[] {
  const lines = text.split("\n").map(l => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const separator = (l: string): boolean => /^[ \t]*(#|$)/.test(l);
  const cases: JqTestCase[] = [];
  let i = 0;
  let mustFail = false;
  while (i < lines.length) {
    const program = lines[i]!;
    i += 1;
    if (separator(program)) continue;
    if (program === "%%FAIL" || program === "%%FAIL IGNORE MSG") { mustFail = true; continue; }
    const line = i;
    // jq takes the line after the program as its input, whatever it holds.
    const input = mustFail ? undefined : lines[i++];
    const expected: string[] = [];
    while (i < lines.length && !separator(lines[i]!)) expected.push(lines[i++]!);
    cases.push({ id: `${file}:${line}`, file, line, program, input, expected, mustFail });
    mustFail = false;
  }
  return cases;
}

/** Every case of the vendored suites. */
export function conformanceCases(): JqTestCase[] {
  return SUITES.flatMap(file => readSuite(file, readFileSync(new URL(`../../../test/jq-conformance/jq-1.8/${file}`, import.meta.url), "utf8")));
}

/** Where a case lands. */
export type Outcome =
  | { readonly bucket: "pass" }
  | { readonly bucket: "deviation"; readonly deviation: number; readonly why: string }
  | { readonly bucket: "skipped"; readonly reason: string }
  | { readonly bucket: "fail"; readonly detail: string };

/** A case run: where it lands, and for one that passes with an input, what the export needs. */
export interface CaseRun {
  readonly case: JqTestCase;
  readonly outcome: Outcome;
  readonly passed?: {
    readonly checked: CheckJqResult;
    readonly inputType: EastType;
    readonly input: unknown;
    readonly resultType: EastType;
    readonly result: unknown;
    /** jq's expected outputs as a value of `resultType`; for a case that must fail, none. */
    readonly expected: unknown;
  };
}

/** Why a case did not pass, before the deviations and skips place it. */
type Miss =
  | { readonly kind: "untypeable"; readonly why: string }
  | { readonly kind: "diagnostics"; readonly checked: CheckJqResult }
  | { readonly kind: "different"; readonly detail: string };

/**
 * Runs a case, and places it: a case that does not pass lands in a skip or a
 * deviation when it is listed as one (`deviations.ts`) or its diagnostics say
 * which (an excluded builtin, one §13.17 or §13.8 lists), and else fails. A
 * listed case that passes fails too, so the list stays true.
 *
 * @param c - the case
 * @returns where it lands
 */
export function runCase(c: JqTestCase): CaseRun {
  const run = attempt(c);
  const listed = DEVIATIONS.get(c.id);
  const skip = SKIPS.get(c.id);
  if (!("kind" in run)) {
    if (listed !== undefined || skip !== undefined) return { case: c, outcome: { bucket: "fail", detail: "passes, but deviations.ts lists it" } };
    return { case: c, outcome: { bucket: "pass" }, passed: run };
  }
  if (listed !== undefined) return { case: c, outcome: { bucket: "deviation", ...listed } };
  if (skip !== undefined) return { case: c, outcome: { bucket: "skipped", reason: skip } };
  if (run.kind === "untypeable") return { case: c, outcome: { bucket: "skipped", reason: `untypeable: ${run.why}` } };
  if (run.kind === "diagnostics") {
    const placed = byDiagnostics(run.checked);
    if (placed !== undefined) return { case: c, outcome: placed };
    return { case: c, outcome: { bucket: "fail", detail: run.checked.diagnostics.filter(d => d.severity.type === "error").map(d => d.message).join(" | ") } };
  }
  return { case: c, outcome: { bucket: "fail", detail: run.detail } };
}

/** Where the checker's diagnostics place a case: an excluded builtin, or one §13.17 or §13.8 lists as unavailable. */
function byDiagnostics(checked: CheckJqResult): Outcome | undefined {
  const errors = checked.diagnostics.filter(d => d.severity.type === "error");
  for (const d of errors) {
    const excluded = /^unsupported: (\S+) is excluded/.exec(d.message);
    if (excluded !== null) return { bucket: "skipped", reason: `excluded: ${excluded[1]}` };
  }
  for (const d of errors) {
    const unavailable = /^unsupported: (\S+) is not available in queries: (.*)$/.exec(d.message);
    if (unavailable === null) continue;
    if (unavailable[2]!.includes("§13.8")) return { bucket: "deviation", deviation: 8, why: `${unavailable[1]}: ${unavailable[2]}` };
    return { bucket: "deviation", deviation: 17, why: `${unavailable[1]}: ${unavailable[2]}` };
  }
  return undefined;
}

/** A case's outputs as jq's, or why they are not. */
function attempt(c: JqTestCase): NonNullable<CaseRun["passed"]> | Miss {
  if (c.mustFail) {
    const checked = checkJq(c.program, NullType);
    if (checked.diagnostics.some(d => d.severity.type === "error")) return { checked, inputType: NullType, input: null, resultType: NullType, result: null, expected: undefined };
    return { kind: "different", detail: "checks, where jq fails to compile it" };
  }
  let json: Json;
  try {
    json = readJson(c.input ?? "");
  } catch (e) {
    return { kind: "untypeable", why: `jq reads an input JSON does not: ${(e as Error).message}` };
  }
  const typed = typeOf(json);
  if ("untypeable" in typed) return { kind: "untypeable", why: typed.untypeable };
  const checked = checkJq(c.program, typed.type);
  if (checked.query === null || checked.elementType === null) return { kind: "diagnostics", checked };
  const element = checked.elementType;
  const input = valueOf(json, typed.type);
  let result: unknown;
  try {
    result = evaluateJq(checked, input);
  } catch (e) {
    // A runtime's own error (a string too long for it) is placed as any other difference.
    const kind = e instanceof QueryError || e instanceof TranslationError ? "" : `${(e as Error).name}: `;
    return { kind: "different", detail: `${kind}${(e as Error).message}` };
  }
  const maybe = result as option<unknown>;
  const outputs = checked.multiplicity === "one" ? [result]
    : checked.multiplicity === "maybe" ? (maybe.type === "some" ? [maybe.value] : [])
    : result as unknown[];
  const print = printFor(element);
  const equal = equalFor(element);
  if (outputs.length !== c.expected.length) {
    return { kind: "different", detail: `${outputs.length} outputs (${outputs.map(o => print(o as never)).join(", ")}), where jq gives ${c.expected.length} (${c.expected.join(", ")})` };
  }
  const expectedValues: unknown[] = [];
  for (let k = 0; k < outputs.length; k++) {
    let expected: { value: unknown } | undefined;
    try {
      expected = expectedAs(readJson(c.expected[k]!), element);
    } catch (e) {
      return { kind: "different", detail: `jq's output ${c.expected[k]} does not read: ${(e as Error).message}` };
    }
    if (expected === undefined) return { kind: "different", detail: `jq's output ${c.expected[k]} is not a ${printType(element)}; East gives ${print(outputs[k] as never)}` };
    if (!equal(outputs[k] as never, expected.value as never)) {
      return { kind: "different", detail: `output ${k + 1} is ${print(outputs[k] as never)}, where jq gives ${c.expected[k]}` };
    }
    expectedValues.push(expected.value);
  }
  const resultType = checked.multiplicity === "one" ? element : checked.multiplicity === "maybe" ? OptionType(element) : ArrayType(element);
  const expected = checked.multiplicity === "one" ? expectedValues[0]
    : checked.multiplicity === "maybe" ? (expectedValues.length === 0 ? none : some(expectedValues[0]))
    : expectedValues;
  return { checked, inputType: typed.type, input, resultType, result, expected };
}

/** Where every case lands, counted and listed: what `summary.json` holds. */
export interface ConformanceSummary {
  /** Each suite's cases, and how many land in each bucket, in the order of {@link SUITES}. */
  readonly suites: readonly { readonly suite: string; readonly cases: number; readonly pass: number; readonly deviation: number; readonly skipped: number; readonly fail: number }[];
  /** The cases that differ by each deviation of §13, by its number. */
  readonly deviations: readonly { readonly deviation: number; readonly cases: readonly string[] }[];
  /** The cases skipped, by the kind of reason: `untypeable`, `excluded`, `resource`, `runner`. */
  readonly skipped: readonly { readonly reason: string; readonly cases: readonly string[] }[];
  /** The cases that fail. */
  readonly fail: readonly string[];
}

/**
 * Counts and lists where the cases land.
 *
 * @param runs - every case's run, in the suites' order
 * @returns the summary
 */
export function conformanceSummary(runs: readonly CaseRun[]): ConformanceSummary {
  const suites = SUITES.map(suite => {
    const of = runs.filter(r => r.case.file === suite);
    const count = (bucket: Outcome["bucket"]): number => of.filter(r => r.outcome.bucket === bucket).length;
    return { suite, cases: of.length, pass: count("pass"), deviation: count("deviation"), skipped: count("skipped"), fail: count("fail") };
  });
  const deviations = new Map<number, string[]>();
  const skipped = new Map<string, string[]>();
  for (const r of runs) {
    if (r.outcome.bucket === "deviation") deviations.set(r.outcome.deviation, [...(deviations.get(r.outcome.deviation) ?? []), r.case.id]);
    if (r.outcome.bucket === "skipped") {
      const reason = r.outcome.reason.split(":")[0]!;
      skipped.set(reason, [...(skipped.get(reason) ?? []), r.case.id]);
    }
  }
  return {
    suites,
    deviations: [...deviations].sort(([a], [b]) => a - b).map(([deviation, cases]) => ({ deviation, cases })),
    skipped: [...skipped].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([reason, cases]) => ({ reason, cases })),
    fail: runs.filter(r => r.outcome.bucket === "fail").map(r => r.case.id),
  };
}

/** The summary as `summary.json` holds it. */
export function summaryText(summary: ConformanceSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

/** The markers around §16's generated tables. */
const TABLES_START = "<!-- conformance: written by `make query-corpus` from test/jq-conformance/summary.json -->";
const TABLES_END = "<!-- /conformance -->";

/**
 * `QUERY.md` with §16's tables as a summary makes them: the counts by suite
 * and bucket, the cases by deviation (with §13's titles, from the document),
 * and the skipped cases by reason.
 *
 * @param doc - `QUERY.md`'s text
 * @param summary - the summary
 * @returns the text with the tables between their markers replaced
 * @throws {Error} When the markers are missing, or a deviation has no §13 entry.
 */
export function withConformanceTables(doc: string, summary: ConformanceSummary): string {
  const start = doc.indexOf(TABLES_START);
  const end = doc.indexOf(TABLES_END);
  if (start < 0 || end < start) throw new Error("devdocs/QUERY.md has no conformance table markers");
  const titles = new Map([...doc.matchAll(/^### 13\.(\d+) (.+)$/gm)].map(m => [Number(m[1]), m[2]!]));
  const all = summary.suites.reduce((t, s) => ({ cases: t.cases + s.cases, pass: t.pass + s.pass, deviation: t.deviation + s.deviation, skipped: t.skipped + s.skipped, fail: t.fail + s.fail }),
    { cases: 0, pass: 0, deviation: 0, skipped: 0, fail: 0 });
  const lines = [
    TABLES_START,
    "| Suite | Cases | Pass | Deviation | Skipped | Fail |",
    "|---|---|---|---|---|---|",
    ...summary.suites.map(s => `| \`${s.suite}\` | ${s.cases} | ${s.pass} | ${s.deviation} | ${s.skipped} | ${s.fail} |`),
    `| All | ${all.cases} | ${all.pass} | ${all.deviation} | ${all.skipped} | ${all.fail} |`,
    "",
    "| Deviation | Cases |",
    "|---|---|",
    ...summary.deviations.map(d => {
      const title = titles.get(d.deviation);
      if (title === undefined) throw new Error(`deviation ${d.deviation} has no §13 entry in devdocs/QUERY.md`);
      return `| §13.${d.deviation} ${title.replace(/\|/g, "\\|")} | ${d.cases.length}: ${d.cases.join(", ")} |`;
    }),
    "",
    "| Skipped | Cases |",
    "|---|---|",
    ...summary.skipped.map(s => `| ${s.reason} | ${s.cases.length}: ${s.cases.join(", ")} |`),
    TABLES_END,
  ];
  return `${doc.slice(0, start)}${lines.join("\n")}${doc.slice(end + TABLES_END.length)}`;
}
