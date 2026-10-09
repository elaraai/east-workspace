/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The Flowchart's TypeDoc examples are tested examples (#1243, #1244, as the
// Plan's and the Sheet's are). Each `@example` under `src/flowchart/` — the
// namespace's, `Flowchart.values`', `Flowchart.value`'s, `Flowchart.over`'s and
// the library's (#1246, #1248) — is the verbatim `fn` of an `example()` in
// `test/flowchart/flowchart*.examples.tsx` that a spec runs, behind imports
// from the public packages and the module-scope statements of that file it
// reaches, each written as it is there. An example edited without its docs,
// or a doc example no test runs, fails here. The reading is `../docs.ts`,
// which the Plan's and the Sheet's specs share.

import { test } from "node:test";
import assert from "node:assert/strict";
import { docExamples } from "../docs.js";

test("every Flowchart @example is the verbatim fn of a tested example, imported from the public packages", () => {
    const { carries, failures } = docExamples("flowchart");
    assert.ok(carries("index.ts", "flowchartFlows"), "<Flowchart> carries an @example: a record of flows by name");
    assert.ok(carries("values.ts", "flowchartFlows"), "Flowchart.values carries an @example: the record of flows it writes");
    assert.ok(carries("values.ts", "flowchartHandover"), "Flowchart.value carries an @example: one flow, a bound input's value");
    assert.ok(carries("over.ts", "flowchartDepot"), "Flowchart.over carries an @example: a flow from the host's tables, each an e3 input, narrowed by a slice (#1251)");
    assert.ok(carries("library.ts", "flowchartFlows"), "Flowchart.library.flows carries an @example: the Flows tab over a record of flows");
    assert.ok(carries("library.ts", "flowchartLibrary"), "Flowchart.library.states carries an @example: the library's tabs, each over its own rows (#1248)");
    assert.deepEqual(failures, []);
});
