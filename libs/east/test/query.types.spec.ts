/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The type matrix (#987): every East type a query reads × every jq program
 * its kind admits (test/query-types/).
 *
 * M1: every shape × every program that applies to it is a pair, run on each
 * of the shape's values; the spec fails on a gap.
 * M2: a case jq can see agrees with jq 1.8.1's recorded run, which is current,
 * or differs as a listed deviation of §13 says, and each listed deviation
 * still differs somewhere; a case jq cannot see gives the value of the
 * section of QUERY.md its oracle follows; East refuses only where jq raises an
 * error or a section says so; none fails. QUERY.md §16.5's tables are where
 * the cases land.
 * M3: under EXPORT_TEST_IR (`make test-export`) each kind's pairs are a
 * compliance suite in <dir>/query-types/: each pair's query as East.jq builds
 * it, called on each value, equal to the expected result or raising an error,
 * which east-c and east-py run. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { East } from "../src/index.js";
import { inExportSubdirectory } from "./export-subdirectory.js";
import { assertEast, describeEast } from "./platforms.spec.js";
import { DEVIATIONS, ORACLE_SECTIONS, REFUSALS } from "./query-types/oracle.js";
import { PROGRAMS } from "./query-types/programs.js";
import {
  KINDS, caseId, jqCases, matrixPairs, matrixSummary, readJqFixture, runPair, withMatrixTables,
} from "./query-types/run.js";
import { SHAPES } from "./query-types/shapes.js";

const QUERY_DOC = new URL("../../devdocs/QUERY.md", import.meta.url);

/** QUERY.md, with the line endings `make query-types` writes: a Windows checkout has CRLF. */
function readDoc(): string {
  return readFileSync(QUERY_DOC, "utf8").replaceAll("\r\n", "\n");
}

const fixture = readJqFixture();
const pairs = matrixPairs();
const runs = pairs.map(pair => runPair(pair, fixture));

describe("the type matrix (#987)", () => {
  test("every program applies to a shape, and every shape takes a program (M1)", () => {
    for (const program of PROGRAMS) assert.ok(pairs.some(p => p.program === program), `${program.family}.${program.name} applies to no shape`);
    for (const shape of SHAPES) assert.ok(pairs.some(p => p.shape === shape), `${shape.name} takes no program`);
  });

  test("every shape is of a kind of the issue's table, and every kind has shapes (M1)", () => {
    for (const shape of SHAPES) assert.ok((KINDS as readonly string[]).includes(shape.kind), `${shape.name} is of no kind`);
    for (const kind of KINDS) assert.ok(SHAPES.some(s => s.kind === kind), `no shape is ${kind}`);
  });

  test("shapes, programs and cases are named uniquely (M1)", () => {
    const shapes = SHAPES.map(s => s.name);
    assert.equal(new Set(shapes).size, shapes.length);
    const programs = PROGRAMS.map(p => `${p.family}.${p.name}`);
    assert.equal(new Set(programs).size, programs.length);
    const cases = pairs.flatMap(p => p.shape.values.map(v => caseId(p, v)));
    assert.equal(new Set(cases).size, cases.length);
  });

  test("every pair runs on each of its shape's values (M1)", () => {
    for (const r of runs) assert.equal(r.runs.length, r.pair.shape.values.length, r.pair.id);
    const cases = runs.reduce((n, r) => n + r.runs.length, 0);
    console.log(`[+] jq type matrix: ${SHAPES.length} shapes × ${PROGRAMS.length} programs, ${pairs.length} pairs, ${cases} cases`);
  });

  test("no case fails (M2)", () => {
    const failing = runs.flatMap(r => r.runs.flatMap(c => (c.outcome.bucket === "fail" ? [`${c.id}: ${c.outcome.detail}`] : [])));
    assert.deepEqual(failing, []);
  });

  test("the recorded runs are jq 1.8.1's, each of a case as it is now (M2)", () => {
    assert.equal(fixture.jq, "jq-1.8.1");
    const current = new Set(jqCases().map(c => `${c.pair} on ${c.label}`));
    const stale = "is no case now: run `make query-types` in libs/east";
    for (const [pair, entry] of Object.entries(fixture.pairs)) {
      for (const label of Object.keys(entry.runs)) assert.ok(current.has(`${pair} on ${label}`), `test/fixtures/query-types.json records ${pair} on ${label}, which ${stale}`);
    }
    const shapes = new Set(jqCases().map(c => `${c.shape} ${c.label}`));
    for (const [shape, inputs] of Object.entries(fixture.inputs)) {
      for (const label of Object.keys(inputs)) assert.ok(shapes.has(`${shape} ${label}`), `test/fixtures/query-types.json holds ${shape}'s ${label}, which ${stale}`);
    }
  });

  test("every deviation names an entry of §13, and differs somewhere (M2)", () => {
    const entries = new Set([...readDoc().matchAll(/^### 13\.(\d+) /gm)].map(m => Number(m[1])));
    for (const d of DEVIATIONS) {
      assert.ok(entries.has(d.deviation), `§13.${d.deviation} is not an entry of QUERY.md`);
      assert.ok(d.why.trim().length > 0, `§13.${d.deviation} says why`);
      const differs = runs.some(r => r.runs.some(c => c.outcome.bucket === "deviation" && c.outcome.deviation === d.deviation));
      assert.ok(differs, `§13.${d.deviation} (${d.why}) differs in no case: drop it from DEVIATIONS`);
    }
  });

  test("every refusal and every oracle names a section of QUERY.md, and every refusal refuses a pair (M2)", () => {
    const sections = new Set([...readDoc().matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.? /gm)].map(m => m[1]!));
    for (const r of REFUSALS) {
      assert.ok(sections.has(r.section), `§${r.section} is not a section of QUERY.md`);
      assert.ok(runs.some(run => run.runs.some(c => c.outcome.bucket === "refused" && c.outcome.section === r.section)), `§${r.section} (${r.why}) refuses no pair: drop it from REFUSALS`);
    }
    for (const [family, section] of Object.entries(ORACLE_SECTIONS)) assert.ok(sections.has(section), `${family}'s oracles follow §${section}, which QUERY.md lacks`);
    for (const r of runs) {
      if (r.runs.some(c => c.outcome.bucket === "east-only")) assert.ok(ORACLE_SECTIONS[r.pair.program.family] !== undefined, `${r.pair.id}'s oracle follows no section`);
    }
  });

  test("QUERY.md §16.5's tables are where the cases land (M2)", () => {
    const doc = readDoc();
    assert.equal(withMatrixTables(doc, matrixSummary(runs)), doc, "devdocs/QUERY.md §16.5's tables are stale: run `make query-types-tables` in libs/east");
  });
});

// The compliance suites (M3): a pair's query once, as East.jq builds it, called on each of its shape's values.
for (const kind of KINDS) {
  const ofKind = runs.filter(r => r.pair.shape.kind === kind);
  await inExportSubdirectory("query-types", () => describeEast(`jq type matrix: ${kind}`, test => {
    for (const r of ofKind) {
      const check = r.check;
      if ("refused" in check) continue;
      test(r.pair.id, $ => {
        const shape = r.pair.shape;
        const query = $.let(East.function([shape.type], check.resultType, ($2, x) => East.jq(x, r.pair.text, check.resultType)));
        for (const c of r.runs) {
          const input = c.value.bind?.($) ?? $.const(c.value.value as never, shape.type);
          const result = query(input);
          if (c.expected === "error") $(assertEast.throws(result));
          else $(assertEast.equal(result, c.expected!.value as never));
        }
      });
    }
  }));
}
