#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Rewrites the two checked-in query fixtures (#875) from their sources, as
 * the TypeScript front end makes them now:
 *
 *   test/fixtures/query-corpus.beast2    from test/query.corpus.ts
 *   test/fixtures/query-fixture.beast2   from test/query.fixture.ts
 *
 *   node scripts/query-corpus.mjs
 *
 * `make query-corpus` builds first and runs this; it imports dist/.
 * `query.corpus.spec.ts` and `query.fixture.spec.ts` fail while either file
 * differs from what this writes.
 */
import { writeFileSync } from "node:fs";

const { queryCorpusBytes } = await import("../dist/test/query.corpus.js");
const { queryFixtureBytes } = await import("../dist/test/query.fixture.js");

const fixtures = new URL("../test/fixtures/", import.meta.url);
for (const [file, bytes] of [["query-corpus.beast2", queryCorpusBytes()], ["query-fixture.beast2", queryFixtureBytes()]]) {
  writeFileSync(new URL(file, fixtures), bytes);
  console.log(`[+] Wrote test/fixtures/${file} (${bytes.length} bytes)`);
}
