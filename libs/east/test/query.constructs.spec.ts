/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The constructs a translated query uses (#925, X2). Queries become ordinary
 * East IR (#923), so every runtime runs them with the compiler it has; that
 * holds only while a translation uses nothing the runtimes' own compliance
 * suites leave untested. This lists every IR node kind and builtin in the
 * translation of each corpus case, each jq conformance case that passes and
 * each pair of the type matrix that checks (#987), and holds each to a
 * compliance suite that is not about queries. The other
 * suites are read from the exported IR (`make test-export`); without it the
 * check skips, unless EAST_CONFORMANCE_REQUIRED=1. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { IRType, checkJq, fromJSONFor, translateJq, walkIR, type IR } from "../src/index.js";
import { conformanceCases, runCase } from "./jq-conformance/run.js";
import { checkPair, matrixPairs } from "./query-types/run.js";
import { QUERY_CORPUS } from "./query.corpus.js";

// The exported corpus, which the root paths.mk names when the run goes through make
const CORPUS_DIR = process.env["EAST_TEST_IR_DIR"];
const REQUIRED = process.env["EAST_CONFORMANCE_REQUIRED"] === "1";

/**
 * The exported suites about queries, which do not count: East.jq's spec
 * (#923). jq's cases (#924), the type matrix and the corpus (#987) are each in
 * a directory of their own.
 */
const QUERY_SUITES: ReadonlySet<string> = new Set(["East_jq.json"]);

const decodeIR = fromJSONFor(IRType);

/** The constructs of a program: its IR node kinds, and each builtin it calls by name. */
function constructsOf(ir: IR, into: Set<string>): void {
  walkIR(ir, node => {
    into.add(node.type);
    if (node.type === "Builtin") into.add(`Builtin ${node.value.builtin}`);
  });
}

/**
 * Every translation the query suites run: each corpus case that checks, each
 * jq conformance case that passes on an input, and each pair of the type
 * matrix that checks.
 */
function translations(): { label: string; ir: IR }[] {
  const out: { label: string; ir: IR }[] = [];
  for (const c of QUERY_CORPUS) {
    const checked = checkJq(c.program, c.input, { root: c.root === true });
    if (checked.program !== null) out.push({ label: `corpus ${c.name}`, ir: translateJq(checked).fn().toIR().ir });
  }
  for (const r of conformanceCases().map(runCase)) {
    if (r.outcome.bucket !== "pass" || r.case.mustFail || r.passed === undefined) continue;
    out.push({ label: r.case.id, ir: translateJq(r.passed.checked).fn().toIR().ir });
  }
  for (const pair of matrixPairs()) {
    const check = checkPair(pair);
    if ("checked" in check) out.push({ label: `matrix ${pair.id}`, ir: translateJq(check.checked).fn().toIR().ir });
  }
  return out;
}

describe("the constructs of translated queries (X2)", () => {
  // `make test-export` runs this spec while the other specs write the corpus
  // it reads: a run that exports checks nothing, and the run after it checks.
  const exporting = process.env["EXPORT_TEST_IR"] !== undefined;
  const present = CORPUS_DIR !== undefined && existsSync(CORPUS_DIR);
  const missing = CORPUS_DIR === undefined
    ? "EAST_TEST_IR_DIR is unset: run it through make (make -C libs/east test)"
    : `no exported IR corpus in ${CORPUS_DIR}`;
  if (REQUIRED && !present && !exporting) throw new Error(`EAST_CONFORMANCE_REQUIRED=1 but ${missing}`);
  const skip = exporting ? "this run is exporting the IR corpus" : !present && missing;

  test("every construct a translation uses is exercised by a compliance suite not about queries", { skip }, () => {
    const dir = CORPUS_DIR!;
    const covered = new Set<string>();
    const suites = readdirSync(dir).filter(f => f.endsWith(".json") && !QUERY_SUITES.has(f)).sort();
    assert.ok(suites.length > 0, `no compliance suites in ${dir}`);
    for (const file of suites) constructsOf(decodeIR(JSON.parse(readFileSync(join(dir, file), "utf-8")).ir) as IR, covered);

    // Each construct, and the first translation that uses it.
    const used = new Map<string, string>();
    const programs = translations();
    for (const { label, ir } of programs) {
      const mine = new Set<string>();
      constructsOf(ir, mine);
      for (const construct of mine) if (!used.has(construct)) used.set(construct, label);
    }
    const uncovered = [...used].filter(([construct]) => !covered.has(construct)).map(([construct, label]) => `${construct} (first in ${label})`);
    assert.deepEqual(uncovered, [], `constructs only the query suites exercise (an export older than the specs lacks what they added: run \`make test-export\`)`);
    const names = [...used.keys()].sort();
    console.log(`[+] ${programs.length} translated programs use ${names.length} constructs, each exercised by ${suites.length} compliance suites: ${names.join(", ")}`);
  });
});
