/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The Sheet's TypeDoc examples are tested examples (#862). Each `@example`
// under `src/sheet/` — `<Sheet>`'s own among them — is the verbatim
// `fn` of an `example()` in `test/sheet/sheet*.examples.ts(x)` that a spec
// runs, behind imports from the public packages and the module-scope
// statements of that file it reaches, each written as it is there — an
// example's rows are an e3 declaration beside it (#1180). An example edited
// without its docs, or a doc example no test runs, fails here. (The editing contract the Sheet's
// transactions are named from holds its own examples to east-ui's tests,
// `test/contracts/editing-docs.spec.ts` there, since the Sheet moved to e3-ui,
// #1179.) The reading is `../docs.ts`, which the Plan's and the
// Flowchart's specs share.

import { test } from "node:test";
import assert from "node:assert/strict";
import { docExamples } from "../docs.js";

test("every Sheet @example is the verbatim fn of a tested example, imported from the public packages", () => {
    const { carries, failures } = docExamples("sheet");
    assert.ok(carries("index.ts", "sheetBasic"), "<Sheet> carries an @example: the smallest sheet's");
    assert.deepEqual(failures, []);
});
