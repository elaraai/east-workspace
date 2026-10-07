/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The Plan's TypeDoc examples are tested examples (#1177, the Sheet's #862
// precedent). Each `@example` under `src/plan/` — the `<Plan>` tag's among
// them — is the verbatim `fn` of an `example()` in
// `test/plan/plan*.examples.tsx` that a spec runs, behind imports from the
// public packages and the module-scope statements of that file it reaches,
// each written as it is there — an example's data is an e3 declaration beside
// it (#1178). An example edited without its docs, or a doc example no test
// runs, fails here. The reading is `../docs.ts`, which the Sheet's and
// the Flowchart's specs share.

import { test } from "node:test";
import assert from "node:assert/strict";
import { docExamples } from "../docs.js";

test("every Plan @example is the verbatim fn of a tested example, imported from the public packages", () => {
    const { carries, failures } = docExamples("plan");
    assert.ok(carries("index.ts", "planSeriesData"), "<Plan> carries an @example: a canvas of data and its series");
    assert.ok(carries("index.ts", "planEvents"), "<Plan> carries an @example: the smallest Plan of event kinds");
    assert.ok(carries("refs.ts", "planEventLinks") && carries("over.ts", "planEventLinks"), "Plan.eventRef and Plan.over carry an @example: links between events, and rows over a dataset");
    assert.ok(carries("library.ts", "planLibrary"), "Plan.library.tab carries an @example: the library pane's tabs, an author's own among them");
    assert.deepEqual(failures, []);
});
