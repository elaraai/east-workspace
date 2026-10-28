/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The Schematic's TypeDoc examples are tested examples (#1384, as the Plan's,
// the Sheet's and the Flowchart's are). Each `@example` under
// `src/schematic/` — the `Schematic` namespace's — is the verbatim `fn` of an
// `example()` in `test/schematic/schematic*.examples.tsx` that a spec runs,
// behind imports from the public packages and the module-scope statements of
// that file it reaches, each written as it is there. An example edited without
// its docs, or a doc example no test runs, fails here. The reading is
// `../docs.ts`, which the Plan's, the Sheet's and the Flowchart's specs share.

import { test } from "node:test";
import assert from "node:assert/strict";
import { docExamples } from "../docs.js";

test("every Schematic @example is the verbatim fn of a tested example, imported from the public packages", () => {
    const { carries, failures } = docExamples("schematic");
    assert.ok(carries("index.ts", "schematicFloor"), "<Schematic> carries an @example: the data centre floor");
    assert.deepEqual(failures, []);
});
