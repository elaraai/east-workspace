#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Rewrites the two checked-in query fixtures (#875) from their sources, as
 * the TypeScript front end makes them now, the jq conformance summary, and
 * QUERY.md's generated tables:
 *
 *   test/fixtures/query-corpus.beast2    from test/query.corpus.ts
 *   test/fixtures/query-fixture.beast2   from test/query.fixture.ts
 *   test/jq-conformance/summary.json     from running jq 1.8's suites (#924)
 *   devdocs/QUERY.md §10's tables         from src/query/jq/catalog.ts
 *   devdocs/QUERY.md §12's templates      from src/query/jq/messages.ts
 *   devdocs/QUERY.md §16's tables         from the conformance summary
 *
 *   node scripts/query-corpus.mjs
 *
 * `make query-corpus` builds first and runs this; it imports dist/.
 * `query.corpus.spec.ts`, `query.fixture.spec.ts`, `query.check.spec.ts` and
 * `query.conformance.spec.ts` fail while any of them differs from what this
 * writes.
 */
import { readFileSync, writeFileSync } from "node:fs";

const { queryCorpusBytes, withCatalogTables } = await import("../dist/test/query.corpus.js");
const { queryFixtureBytes } = await import("../dist/test/query.fixture.js");
const { conformanceCases, conformanceSummary, runCase, summaryText, withConformanceTables } = await import("../dist/test/jq-conformance/run.js");

const summary = conformanceSummary(conformanceCases().map(runCase));
writeFileSync(new URL("../test/jq-conformance/summary.json", import.meta.url), summaryText(summary));
console.log("[+] Wrote test/jq-conformance/summary.json");

const queryDoc = new URL("../devdocs/QUERY.md", import.meta.url);
writeFileSync(queryDoc, withConformanceTables(withCatalogTables(readFileSync(queryDoc, "utf8")), summary));
console.log("[+] Wrote devdocs/QUERY.md §10's catalog tables, §12's templates and §16's conformance tables");

const fixtures = new URL("../test/fixtures/", import.meta.url);
for (const [file, bytes] of [["query-corpus.beast2", queryCorpusBytes()], ["query-fixture.beast2", queryFixtureBytes()]]) {
  writeFileSync(new URL(file, fixtures), bytes);
  console.log(`[+] Wrote test/fixtures/${file} (${bytes.length} bytes)`);
}
