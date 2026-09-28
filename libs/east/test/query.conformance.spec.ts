/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* jq 1.8's own test suites run against East's jq (#924).
 *
 * J1: every case passes, differs by a deviation of devdocs/QUERY.md §13, or
 * is skipped for a reason; none fails.
 * J2: test/jq-conformance/summary.json holds where they land now, and
 * QUERY.md §16's tables are made from it; `make query-corpus` rewrites both.
 * J3: each case that passes on an input runs again as a compliance test: its
 * translation, called on its typed input, gives jq's expected outputs. Under
 * EXPORT_TEST_IR (`make test-export`) each suite's tests are written to
 * <dir>/query-conformance/, where east-c and east-py run them (#925). */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { translateJq } from "../src/index.js";
import { DEVIATIONS, SKIPS } from "./jq-conformance/deviations.js";
import {
  SUITES, conformanceCases, conformanceSummary, runCase, summaryText, withConformanceTables,
  type ConformanceSummary,
} from "./jq-conformance/run.js";
import { assertEast, describeEast } from "./platforms.spec.js";

const SUMMARY_FILE = new URL("../../test/jq-conformance/summary.json", import.meta.url);
const QUERY_DOC = new URL("../../devdocs/QUERY.md", import.meta.url);

const runs = conformanceCases().map(runCase);
const summary = conformanceSummary(runs);

/** The cases that pass on an input, which run again as compliance tests. */
const compliance = runs.filter(r => r.outcome.bucket === "pass" && !r.case.mustFail);

describe("jq 1.8 conformance", () => {
  test("no case fails (J1)", () => {
    const failing = runs.flatMap(r => (r.outcome.bucket === "fail" ? [`${r.case.id}: ${r.outcome.detail}`] : []));
    assert.deepEqual(failing, []);
  });

  test("every deviation names an entry of §13, and every skip its reason (J1)", () => {
    const doc = readFileSync(QUERY_DOC, "utf8");
    const entries = new Set([...doc.matchAll(/^### 13\.(\d+) /gm)].map(m => Number(m[1])));
    for (const r of runs) {
      if (r.outcome.bucket === "deviation") {
        assert.ok(entries.has(r.outcome.deviation), `${r.case.id} cites §13.${r.outcome.deviation}, which QUERY.md lacks`);
        assert.ok(r.outcome.why.trim().length > 0, `${r.case.id} says why it differs`);
      }
      if (r.outcome.bucket === "skipped") assert.match(r.outcome.reason, /^(untypeable|excluded|resource|runner): \S/, r.case.id);
    }
  });

  test("deviations.ts lists cases of the suites, each once", () => {
    const ids = new Set(runs.map(r => r.case.id));
    for (const id of [...DEVIATIONS.keys(), ...SKIPS.keys()]) assert.ok(ids.has(id), `${id} is not a case of the suites`);
    for (const id of DEVIATIONS.keys()) assert.ok(!SKIPS.has(id), `${id} is both a deviation and a skip`);
  });

  test("summary.json is where the cases land now (J2)", () => {
    assert.equal(readFileSync(SUMMARY_FILE, "utf8"), summaryText(summary), "test/jq-conformance/summary.json is stale: run `make query-corpus` in libs/east");
  });

  test("QUERY.md §16's tables are summary.json's (J2)", () => {
    const doc = readFileSync(QUERY_DOC, "utf8");
    const pinned = JSON.parse(readFileSync(SUMMARY_FILE, "utf8")) as ConformanceSummary;
    assert.equal(withConformanceTables(doc, pinned), doc, "devdocs/QUERY.md's conformance tables are stale: run `make query-corpus` in libs/east");
  });

  test("every case that passes on an input is a compliance test (J3)", () => {
    const passes = summary.suites.reduce((n, s) => n + s.pass, 0);
    const compileFailures = runs.filter(r => r.outcome.bucket === "pass" && r.case.mustFail).length;
    assert.equal(compliance.length, passes - compileFailures);
    assert.ok(compliance.every(r => r.passed !== undefined && r.passed.expected !== undefined));
    console.log(`[+] jq conformance: ${compliance.length} cases that pass on an input run as compliance tests`);
  });
});

/** Runs `f` with `make test-export`'s directory, EXPORT_TEST_IR, set to a subdirectory of it. */
function inExportSubdirectory<T>(name: string, f: () => T): T {
  const root = process.env.EXPORT_TEST_IR;
  if (root === undefined || root === "") return f();
  process.env.EXPORT_TEST_IR = join(root, name);
  try {
    return f();
  } finally {
    process.env.EXPORT_TEST_IR = root;
  }
}

for (const suite of SUITES) {
  const cases = compliance.filter(r => r.case.file === suite);
  if (cases.length === 0) continue;
  await inExportSubdirectory("query-conformance", () => describeEast(suite, test => {
    for (const r of cases) {
      const passed = r.passed!;
      test(r.case.id, $ => {
        // The input's type is the case's, known only here: its value is of it, as the harness typed it.
        const input = $.const(passed.input as never, passed.inputType);
        const result = $.let(translateJq(passed.checked).fn().call(input));
        $(assertEast.equal(result, passed.expected as never));
      });
    }
  }));
}
