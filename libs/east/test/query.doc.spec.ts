/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* devdocs/QUERY.md's examples (#932, D1): each fenced jq example that a result
 * line (`→ …`) follows is checked as an e3 root over the shared fixture, run,
 * and held to what the document says it gives: the value as East text, the
 * result type as a diagnostic prints a type, and the multiplicity; or the
 * diagnostic's message and its first suggestion; or the lint's message and the
 * program its fix makes. So the document cannot drift from the code. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { IntegerType, QueryFixType, checkJq, compareFor, evaluateJq, printFor, translateJq, type ValueTypeOf } from "../src/index.js";
import { describeType } from "../src/query/jq/shapes.js";
import { FixtureRoot, queryFixture } from "./query.fixture.js";

const DOC = readFileSync(new URL("../../devdocs/QUERY.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");

/** An example: the line its block opens on, its program, and its result, the result's lines joined. */
interface Example {
  readonly line: number;
  readonly program: string;
  readonly result: string;
}

/**
 * The document's examples: each fenced jq block a result line (`→ …`)
 * follows, the block's indent taken off, as a list item indents it.
 */
function examples(text: string): Example[] {
  const lines = text.split("\n");
  const found: Example[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)```jq$/.exec(lines[i]!);
    if (open === null) continue;
    const indent = open[1]!.length;
    let end = i + 1;
    while (end < lines.length && !/^\s*```$/.test(lines[end]!)) end++;
    const program = lines.slice(i + 1, end).map(l => l.slice(indent)).join("\n");
    const result: string[] = [];
    for (let k = end + 1; k < lines.length && lines[k]!.trim() !== ""; k++) result.push(lines[k]!.trim());
    if (result[0]?.startsWith("→ ") === true) found.push({ line: i + 1, program, result: result.join(" ") });
    i = end;
  }
  return found;
}

/** A value's line: the value as East text in backticks, ` · `, its type and multiplicity, and perhaps a note in parentheses. */
const VALUE = /^→ `([^`]+)` · (.+), (one|maybe|many)(?: \(.+\))?$/;
/** A query that does not check: its first error's message in backticks, and perhaps its first suggestion. */
const ERROR = /^→ `([a-z_]+: [^`]+)`(?: Suggestion: `([^`]+)`\.)?$/;
/** A lint: `warning`, its message in backticks, and perhaps the program its fix makes. */
const WARNING = /^→ warning `([a-z_]+: [^`]+)`(?: Fix: `([^`]+)`\.)?$/;

const compareInteger = compareFor(IntegerType);

/** The program a fix makes: its edits applied to the text, the last first, so each offset holds. */
function applyFix(text: string, fix: ValueTypeOf<typeof QueryFixType>): string {
  let out = text;
  for (const edit of [...fix.edits].sort((a, b) => compareInteger(b.offset, a.offset))) {
    out = out.slice(0, Number(edit.offset)) + edit.insert + out.slice(Number(edit.offset + edit.length));
  }
  return out;
}

describe("devdocs/QUERY.md's examples (D1)", () => {
  const fixture = queryFixture();
  const all = examples(DOC);

  test("each result line is one this test reads", () => {
    assert.ok(all.length > 0, "QUERY.md has no examples");
    for (const e of all) {
      assert.ok(VALUE.test(e.result) || ERROR.test(e.result) || WARNING.test(e.result), `QUERY.md:${e.line}: ${e.result}`);
    }
  });

  for (const e of all) {
    test(`QUERY.md:${e.line}: ${e.program.split("\n")[0]}`, () => {
      const checked = checkJq(e.program, FixtureRoot, { root: true });

      const value = VALUE.exec(e.result);
      if (value !== null) {
        const [, text, type, multiplicity] = value;
        assert.ok(checked.program !== null, checked.diagnostics.map(d => d.message).join("\n"));
        const resultType = translateJq(checked).resultType;
        assert.equal(printFor(resultType)(evaluateJq(checked, fixture)), text);
        assert.equal(describeType(resultType), type);
        assert.equal(checked.multiplicity, multiplicity);
        return;
      }

      const error = ERROR.exec(e.result);
      if (error !== null) {
        const [, message, suggestion] = error;
        assert.equal(checked.program, null, "the query checks");
        const first = checked.diagnostics.find(d => d.severity.type === "error");
        assert.ok(first !== undefined, "the query has no error");
        assert.equal(first.message, message);
        if (suggestion !== undefined) assert.equal(first.suggestions[0], suggestion);
        return;
      }

      const warning = WARNING.exec(e.result);
      assert.ok(warning !== null, e.result);
      const [, message, fixed] = warning;
      const lint = checked.diagnostics.find(d => d.severity.type === "warning");
      assert.ok(lint !== undefined, "the query has no lint");
      assert.equal(lint.message, message);
      if (fixed !== undefined) {
        assert.ok(lint.fixes.length > 0, "the lint has no fix");
        assert.equal(applyFix(e.program, lint.fixes[0]!), fixed);
      }
    });
  }
});
