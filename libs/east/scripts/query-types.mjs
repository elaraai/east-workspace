#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Rewrites test/fixtures/query-types.json: every case of the type matrix
 * (#987) that jq can judge (test/query-types/run.ts), run through jq 1.8.1
 * on the input's East JSON, with the program between the filters of
 * test/query-types/view.ts, and its outputs or its error. The matrix's spec
 * holds East to them, so jq is the oracle wherever jq can see the value.
 * Then rewrites devdocs/QUERY.md §16.5's tables from where the cases land.
 *
 *   node scripts/query-types.mjs            # the fixture, then the tables
 *   node scripts/query-types.mjs --tables   # the tables alone, from the checked-in fixture
 *
 * `make query-types` builds first and runs this; it imports dist/, and the
 * fixture needs jq 1.8.1 on the PATH (CI has none: the fixture is checked in,
 * and query.types.spec.ts fails while a case's recorded input or program is
 * not the current one).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const { jqCases, jqFixtureText, matrixPairs, matrixSummary, readJqFixture, runPair, withMatrixTables, JQ_FIXTURE } =
  await import("../dist/test/query-types/run.js");

const QUERY_DOC = new URL("../devdocs/QUERY.md", import.meta.url);
const JQ = "jq-1.8.1";

if (!process.argv.includes("--tables")) {
  const version = spawnSync("jq", ["--version"], { encoding: "utf8" });
  if (version.status !== 0 || version.stdout.trim() !== JQ) {
    console.error(`[x] query-types needs ${JQ} on the PATH (found: ${version.error?.message ?? version.stdout.trim()})`);
    process.exit(1);
  }

  // Each shape's inputs once; each pair once, with its program as written, a digest of what jq ran, and each value's run.
  const inputs = {};
  const pairs = {};
  let count = 0;
  let errors = 0;
  for (const c of jqCases()) {
    const run = spawnSync("jq", ["-c", c.program], { input: c.input, encoding: "utf8" });
    if (run.error !== undefined) throw run.error;
    const record = {};
    if (run.status === 0) {
      record.outputs = run.stdout.split("\n").filter(line => line.length > 0);
    } else {
      record.error = run.stderr.trim();
      errors += 1;
    }
    (inputs[c.shape] ??= {})[c.label] = c.input;
    (pairs[c.pair] ??= { program: c.text, digest: c.digest, runs: {} }).runs[c.label] = record;
    count += 1;
  }
  writeFileSync(JQ_FIXTURE, jqFixtureText({ jq: JQ, inputs, pairs }));
  console.log(`[+] Wrote test/fixtures/query-types.json: ${count} cases of ${Object.keys(pairs).length} pairs run through ${JQ}, ${errors} of them raising an error`);
}

const fixture = readJqFixture();
const summary = matrixSummary(matrixPairs().map(pair => runPair(pair, fixture)));
// A Windows checkout has CRLF; the document is written with LF.
const doc = readFileSync(QUERY_DOC, "utf8").replaceAll("\r\n", "\n");
writeFileSync(QUERY_DOC, withMatrixTables(doc, summary));
const fails = summary.kinds.reduce((n, k) => n + k.fail, 0);
console.log(`[+] Wrote devdocs/QUERY.md §16.5's tables: ${summary.kinds.reduce((n, k) => n + k.cases, 0)} cases, ${fails} failing`);
