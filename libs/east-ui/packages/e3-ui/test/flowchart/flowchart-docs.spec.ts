/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The Flowchart's TypeDoc examples are tested examples (#1243, as the Plan's
// and the Sheet's are). Each `@example` under `src/flowchart/` — the
// `<Flowchart>` tag's among them — is the verbatim `fn` of an `example()` in
// `test/flowchart/flowchart*.examples.tsx` that a spec runs, behind imports
// from the public packages and the module-scope statements of that file it
// reaches, each written as it is there. An example edited without its docs,
// or a doc example no test runs, fails here. The reading is
// `../docs.ts`, which the Plan's and the Sheet's specs share.

import { test } from "node:test";
import assert from "node:assert/strict";
import { docExamples } from "../docs.js";

test("every Flowchart @example is the verbatim fn of a tested example, imported from the public packages", () => {
    const { carries, failures } = docExamples("flowchart");
    assert.ok(carries("index.ts", "flowchartMinimal"), "<Flowchart> carries an @example: the smallest flowchart's");
    assert.deepEqual(failures, []);
});
