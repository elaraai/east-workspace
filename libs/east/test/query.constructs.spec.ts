/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The constructs a translated query uses (#925, X2). Queries become ordinary
 * East IR (#923), so every runtime runs them with the compiler it has; that
 * holds only while a translation uses nothing the runtimes' own compliance
 * suites leave untested. This lists every IR node kind and builtin in the
 * translation of each corpus case and each jq conformance case that passes,
 * and holds each to a compliance suite that is not about queries. The other
 * suites are read from the exported IR (`make test-export`); without it the
 * check skips, unless EAST_CONFORMANCE_REQUIRED=1. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { IRType, checkJq, fromJSONFor, translateJq, walkIR, type IR } from "../src/index.js";
import { conformanceCases, runCase } from "./jq-conformance/run.js";
import { QUERY_CORPUS } from "./query.corpus.js";

const CORPUS_DIR = process.env["EAST_TEST_IR_DIR"] ?? "/tmp/east-test-ir";
const REQUIRED = process.env["EAST_CONFORMANCE_REQUIRED"] === "1";

/** The exported suites about queries, which do not count: East.jq's spec (#923). jq's cases (#924) are in a directory of their own. */
const QUERY_SUITES: ReadonlySet<string> = new Set(["East_jq.json"]);

const decodeIR = fromJSONFor(IRType);

/** The constructs of a program: its IR node kinds, and each builtin it calls by name. */
function constructsOf(ir: IR, into: Set<string>): void {
  walkIR(ir, node => {
    into.add(node.type);
    if (node.type === "Builtin") into.add(`Builtin ${node.value.builtin}`);
  });
}

/** Every translation the query suites run: each corpus case that checks, and each jq conformance case that passes on an input. */
function translations(): { label: string; ir: IR }[] {
  const out: { label: string; ir: IR }[] = [];
  for (const c of QUERY_CORPUS) {
    const checked = checkJq(c.program, c.input, { root: c.root === true });
    if (checked.query !== null) out.push({ label: `corpus ${c.name}`, ir: translateJq(checked).fn().toIR().ir });
  }
  for (const r of conformanceCases().map(runCase)) {
    if (r.outcome.bucket !== "pass" || r.case.mustFail || r.passed === undefined) continue;
    out.push({ label: r.case.id, ir: translateJq(r.passed.checked).fn().toIR().ir });
  }
  return out;
}

describe("the constructs of translated queries (X2)", () => {
  // `make test-export` runs this spec while the other specs write the corpus
  // it reads: a run that exports checks nothing, and the run after it checks.
  const exporting = process.env["EXPORT_TEST_IR"] !== undefined;
  const present = existsSync(CORPUS_DIR);
  if (REQUIRED && !present && !exporting) throw new Error(`EAST_CONFORMANCE_REQUIRED=1 but no exported IR corpus in ${CORPUS_DIR}`);
  const skip = exporting ? "this run is exporting the IR corpus" : !present && `no exported IR corpus in ${CORPUS_DIR}`;

  test("every construct a translation uses is exercised by a compliance suite not about queries", { skip }, () => {
    const covered = new Set<string>();
    const suites = readdirSync(CORPUS_DIR).filter(f => f.endsWith(".json") && !QUERY_SUITES.has(f)).sort();
    assert.ok(suites.length > 0, `no compliance suites in ${CORPUS_DIR}`);
    for (const file of suites) constructsOf(decodeIR(JSON.parse(readFileSync(join(CORPUS_DIR, file), "utf-8")).ir) as IR, covered);

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
