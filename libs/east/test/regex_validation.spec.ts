/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCrossPlatformCompatible, RECOMMENDED_PATTERNS } from "../src/expr/regex_validation.js";

// Formerly a console-printing harness at the bottom of regex_validation.ts,
// guarded by a run-as-main argv check that fired inside bundles (#324).

test("safe cross-platform patterns validate clean", () => {
    const safe: RegExp[] = [
        /\w+/,                  // basic word pattern
        /\w+@\w+\.\w+/,         // email-ish
        /hello/i,               // case insensitive
        /^test$/m,              // multiline mode
        /a.*b/s,                // dotall mode
        /[a-z0-9]+/i,           // character class
        /^start.*end$/,         // anchors
        /(cat|dog)/,            // groups and alternation
        /a{2,5}b*c+d?/,         // quantifiers
    ];
    for (const regex of safe) {
        const result = validateCrossPlatformCompatible(regex);
        assert.equal(result.isValid, true, `${regex} should be valid: ${result.errors.join(", ")}`);
        assert.deepEqual(result.errors, [], `${regex} should have no errors`);
    }
});

test("JavaScript-specific flags are rejected", () => {
    for (const regex of [/test/g, /test/u, /test/y]) {
        const result = validateCrossPlatformCompatible(regex);
        assert.equal(result.isValid, false, `${regex} should be invalid`);
        assert.match(result.errors[0]!, /JavaScript-specific/, `${regex} names the offending flag`);
    }
});

test("JavaScript-only pattern features are rejected", () => {
    const named = validateCrossPlatformCompatible(/(?<name>\w+)\k<name>/);
    assert.equal(named.isValid, false);
    assert.ok(named.errors.some(e => e.includes("\\k<name>")), "named backreference error");

    const unicodeProp = validateCrossPlatformCompatible(/\p{Letter}/u);
    assert.equal(unicodeProp.isValid, false);
    assert.ok(unicodeProp.errors.some(e => e.includes("\\p{...}")), "unicode property error");
});

test("PCRE-only features are rejected", () => {
    const keep = validateCrossPlatformCompatible(/foo\Kbar/);
    assert.equal(keep.isValid, false);
    assert.ok(keep.errors.some(e => e.includes("\\K")), "keep assertion error");
});

test("divergent-behaviour patterns warn without failing", () => {
    const posix = validateCrossPlatformCompatible(/[[:alpha:]]+/);
    assert.equal(posix.isValid, true);
    assert.ok(posix.warnings.some(w => w.includes("POSIX")), "POSIX class warning");
});

test("every RECOMMENDED_PATTERN is itself cross-platform compatible", () => {
    for (const [name, regex] of Object.entries(RECOMMENDED_PATTERNS)) {
        const result = validateCrossPlatformCompatible(regex);
        assert.equal(result.isValid, true, `${name} should be valid: ${result.errors.join(", ")}`);
    }
});
