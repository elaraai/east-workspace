/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The Flowchart's TypeDoc examples are tested examples (as the Plan's, the
// Sheet's and the Schematic's are). Each `@example` under `src/flowchart/` —
// the namespace's, `Flowchart.states`' and `Flowchart.templates`' (#1500) — is
// the verbatim `fn` of an `example()` in `test/flowchart/flowchart*.examples.tsx`
// that a spec checks, behind imports from the public packages and the
// module-scope statements of that file it reaches, each written as it is
// there. An example edited without its docs, or a doc example no test checks,
// fails here. The reading is `../docs.ts`, which the other components' specs
// share.

import { test } from "node:test";
import assert from "node:assert/strict";
import { docExamples } from "../docs.js";

test("every Flowchart @example is the verbatim fn of a tested example, imported from the public packages", () => {
    const { carries, failures } = docExamples("flowchart");
    assert.ok(carries("index.ts", "flowchartDwell"), "<Flowchart> carries an @example: the depot's states, transitions and lanes, three records read whole");
    assert.ok(carries("kinds.ts", "flowchartDepotEditing"), "Flowchart.states carries an @example: the depot's four records bound editable, each saved through its own patch door");
    assert.ok(carries("templates.ts", "flowchartDepot"), "Flowchart.templates carries an @example: the depot, each kind's cards a record following its own source of the rail, and the library's tabs");
    assert.deepEqual(failures, []);
});
