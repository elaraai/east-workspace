/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The cross-language compliance stem (#628) — see `crosslang.examples.ts`.
 * Here the programs run as examples; the python twin
 * (`tests/conformance/test_cross_language_stem.py`) reads the exported IR
 * (`npm run export:examples`) and asserts its own builds are identical.
 */
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import * as ex from "./crosslang.examples.js";

await describe("Cross-language stem", (test) => {
    assert.examples(test, {
        crosslangArithmetic: ex.crosslangArithmetic,
        crosslangStatements: ex.crosslangStatements,
        crosslangCallbacks: ex.crosslangCallbacks,
        crosslangStructIfElse: ex.crosslangStructIfElse,
        crosslangVariantMatch: ex.crosslangVariantMatch,
        crosslangDictSet: ex.crosslangDictSet,
        crosslangStringsDatetime: ex.crosslangStringsDatetime,
        crosslangTryCatch: ex.crosslangTryCatch,
        crosslangWhile: ex.crosslangWhile,
    });
});
