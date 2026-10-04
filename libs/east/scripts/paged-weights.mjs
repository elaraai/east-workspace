#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Rewrites the checked-in fixture of decoded weights (#1129) from its source:
 *
 *   test/fixtures/paged-weights.beast2   from test/paged-weights.fixture.ts
 *
 *   node scripts/paged-weights.mjs
 *
 * `make paged-weights` builds first and runs this; it imports dist/.
 * `paged-weights.fixture.spec.ts` fails while the file differs from what this
 * writes.
 */
import { writeFileSync } from "node:fs";

const { pagedWeightsBytes } = await import("../dist/test/paged-weights.fixture.js");

const bytes = pagedWeightsBytes();
writeFileSync(new URL("../test/fixtures/paged-weights.beast2", import.meta.url), bytes);
console.log(`[+] Wrote test/fixtures/paged-weights.beast2 (${bytes.length} bytes)`);
