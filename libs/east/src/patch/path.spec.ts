/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    type PatchPath,
    type PatchPathSegment,
    field,
    index,
    dictKey,
    variantTag,
    pathToString,
    pathFromString,
    pathDisplay,
    joinField,
    joinIndex,
    joinKey,
    joinVariant,
} from "./path.js";

// ============================================================================
// pathToString — every segment kind, every concatenation pattern
// ============================================================================

describe("path: pathToString", () => {
    test("empty path → empty string", () => {
        assert.equal(pathToString([]), "");
    });

    test("single field → field name (no leading dot)", () => {
        assert.equal(pathToString([field("policy")]), "policy");
    });

    test("nested fields → dot-separated", () => {
        assert.equal(pathToString([field("a"), field("b"), field("c")]), "a.b.c");
    });

    test("array index → bracket-suffixed", () => {
        assert.equal(pathToString([field("roster"), index(2n)]), "roster[2]");
    });

    test("array index from JS number is normalised to bigint", () => {
        assert.equal(pathToString([field("roster"), index(2)]), "roster[2]");
    });

    test("array index of zero", () => {
        assert.equal(pathToString([index(0n)]), "[0]");
    });

    test("array index large bigint", () => {
        assert.equal(pathToString([index(9007199254740993n)]), "[9007199254740993]");
    });

    test("dict key → brace-suffixed", () => {
        assert.equal(pathToString([field("prices"), dictKey("Cabernet")]), "prices{Cabernet}");
    });

    test("dict key with spaces", () => {
        assert.equal(pathToString([dictKey("hello world")]), "{hello world}");
    });

    test("dict key with quotes (printFor StringType embeds them)", () => {
        // The path layer is verbatim — quotes are part of the key.
        assert.equal(pathToString([dictKey('"AU"')]), '{"AU"}');
    });

    test("variant tag → @-prefixed", () => {
        assert.equal(pathToString([field("status"), variantTag("active")]), "status@active");
    });

    test("variant tag at root", () => {
        assert.equal(pathToString([variantTag("pending")]), "@pending");
    });

    test("deeply nested every-kind chain", () => {
        const p: PatchPath = [
            field("ws"), field("rosters"), index(0n), field("shifts"),
            dictKey("morning"), field("status"), variantTag("scheduled"),
        ];
        assert.equal(pathToString(p), "ws.rosters[0].shifts{morning}.status@scheduled");
    });

    test("array-then-field combinations", () => {
        assert.equal(pathToString([index(0n), field("rate")]), "[0].rate");
    });

    test("dict-then-field combinations", () => {
        assert.equal(pathToString([dictKey("AU"), field("price")]), "{AU}.price");
    });

    test("variant-then-field combinations", () => {
        assert.equal(pathToString([variantTag("active"), field("since")]), "@active.since");
    });
});

// ============================================================================
// pathFromString — round-trip every shape
// ============================================================================

describe("path: pathFromString", () => {
    test("empty string → empty path", () => {
        assert.deepEqual(pathFromString(""), []);
    });

    test("single field, unprefixed", () => {
        assert.deepEqual(pathFromString("policy"), [field("policy")]);
    });

    test("nested fields", () => {
        assert.deepEqual(pathFromString("policy.maxHours"), [
            field("policy"),
            field("maxHours"),
        ]);
    });

    test("array index parsed as bigint", () => {
        const p = pathFromString("roster[42]");
        assert.equal(p.length, 2);
        const idx = p[1] as Extract<PatchPathSegment, { kind: "index" }>;
        assert.equal(idx.kind, "index");
        assert.equal(idx.index, 42n);
    });

    test("array index zero", () => {
        const [seg] = pathFromString("[0]") as [Extract<PatchPathSegment, { kind: "index" }>];
        assert.equal(seg.index, 0n);
    });

    test("array index large bigint round-trips losslessly", () => {
        const huge = "9007199254740993";  // > 2^53 — JS Number would lose precision
        const [seg] = pathFromString(`[${huge}]`) as [Extract<PatchPathSegment, { kind: "index" }>];
        assert.equal(seg.index.toString(), huge);
    });

    test("dict key plain", () => {
        assert.deepEqual(pathFromString("{AU}"), [dictKey("AU")]);
    });

    test("dict key with spaces", () => {
        assert.deepEqual(pathFromString("{hello world}"), [dictKey("hello world")]);
    });

    test("variant tag", () => {
        assert.deepEqual(pathFromString("@pending"), [variantTag("pending")]);
    });
});

// ============================================================================
// Round-trip — pathFromString ∘ pathToString = id
// ============================================================================

describe("path: round-trip", () => {
    const cases: PatchPath[] = [
        [],
        [field("a")],
        [field("a"), field("b")],
        [field("a"), index(0n)],
        [field("a"), dictKey("k")],
        [field("a"), variantTag("t")],
        [index(0n)],
        [index(7n), field("name")],
        [dictKey("k"), field("name")],
        [variantTag("t"), field("name")],
        [field("ws"), field("r"), index(0n), field("shifts"), dictKey("m"), variantTag("a")],
    ];

    for (const segs of cases) {
        const s = pathToString(segs);
        test(`round-trip: "${s || "(empty)"}"`, () => {
            assert.deepEqual(pathFromString(pathToString(segs)), segs);
            assert.equal(pathToString(pathFromString(s)), s);
        });
    }
});

// ============================================================================
// pathFromString — error cases
// ============================================================================

describe("path: pathFromString errors", () => {
    test("unbalanced [", () => {
        assert.throws(() => pathFromString("roster[2"));
    });

    test("unbalanced {", () => {
        assert.throws(() => pathFromString("prices{key"));
    });

    test("non-numeric array index", () => {
        assert.throws(() => pathFromString("roster[abc]"));
    });

    test("empty field segment (a..b)", () => {
        assert.throws(() => pathFromString("a..b"));
    });

    test("empty variant tag (@)", () => {
        assert.throws(() => pathFromString("status@"));
    });

    test("trailing dot", () => {
        assert.throws(() => pathFromString("a."));
    });

    test("dot only", () => {
        assert.throws(() => pathFromString("."));
    });

    test("leading dot before a field name", () => {
        // Format spec: root field has no leading dot. `.a` should not parse.
        assert.throws(() => pathFromString(".a"));
    });

    test("array index with leading + sign rejected", () => {
        // `BigInt("+1")` returns 1n in JS, but the format spec is decimal-only.
        assert.throws(() => pathFromString("a[+1]"));
    });

    test("empty array index rejected", () => {
        // `BigInt("")` returns 0n — silent acceptance is wrong; brackets must enclose a number.
        assert.throws(() => pathFromString("a[]"));
    });

    test("negative array index rejected", () => {
        // Array indices are non-negative; `BigInt("-1")` returns -1n which is meaningless.
        assert.throws(() => pathFromString("a[-1]"));
    });

    test("empty dict key rejected", () => {
        // `{}` slices an empty key — meaningless; format spec requires a non-empty key.
        assert.throws(() => pathFromString("{}"));
    });
});

// ============================================================================
// pathDisplay — UI label for one segment
// ============================================================================

describe("path: pathDisplay", () => {
    test("field returns name", () => {
        assert.equal(pathDisplay(field("rate")), "rate");
    });

    test("index returns [N]", () => {
        assert.equal(pathDisplay(index(3n)), "[3]");
    });

    test("index zero", () => {
        assert.equal(pathDisplay(index(0n)), "[0]");
    });

    test("index large bigint", () => {
        assert.equal(pathDisplay(index(9007199254740993n)), "[9007199254740993]");
    });

    test("dict key returns key (no braces)", () => {
        assert.equal(pathDisplay(dictKey("AU")), "AU");
    });

    test("variant tag returns @tag", () => {
        assert.equal(pathDisplay(variantTag("active")), "@active");
    });
});

// ============================================================================
// Internal joiners — string-prefix builders used by merge / walk / prune
// ============================================================================

describe("path: internal joiners", () => {
    test("joinField at root", () => {
        assert.equal(joinField("", "name"), "name");
    });

    test("joinField on prefix", () => {
        assert.equal(joinField("a.b", "c"), "a.b.c");
    });

    test("joinIndex on prefix", () => {
        assert.equal(joinIndex("roster", 2n), "roster[2]");
        assert.equal(joinIndex("roster", 2), "roster[2]");
    });

    test("joinKey on prefix", () => {
        assert.equal(joinKey("prices", "AU"), "prices{AU}");
    });

    test("joinVariant on prefix", () => {
        assert.equal(joinVariant("status", "active"), "status@active");
    });

    test("joiners agree with pathToString of a single segment", () => {
        assert.equal(joinField("", "x"), pathToString([field("x")]));
        assert.equal(joinIndex("", 0n), pathToString([index(0n)]));
        assert.equal(joinKey("", "k"), pathToString([dictKey("k")]));
        assert.equal(joinVariant("", "t"), pathToString([variantTag("t")]));
    });
});

// ============================================================================
// Builders — type-tag invariants on each constructor
// ============================================================================

describe("path: segment builders", () => {
    test("field() produces a kind=field segment", () => {
        const seg = field("name");
        assert.equal(seg.kind, "field");
        assert.equal((seg as { name: string }).name, "name");
    });

    test("index(bigint) keeps the bigint exactly", () => {
        const seg = index(42n);
        assert.equal(seg.kind, "index");
        assert.equal((seg as { index: bigint }).index, 42n);
    });

    test("index(number) coerces to bigint", () => {
        const seg = index(7);
        assert.equal((seg as { index: bigint }).index, 7n);
        assert.equal(typeof (seg as { index: bigint }).index, "bigint");
    });

    test("dictKey() produces a kind=key segment with the verbatim key", () => {
        const seg = dictKey('"AU"');
        assert.equal(seg.kind, "key");
        assert.equal((seg as { key: string }).key, '"AU"');
    });

    test("variantTag() produces a kind=variant segment", () => {
        const seg = variantTag("active");
        assert.equal(seg.kind, "variant");
        assert.equal((seg as { tag: string }).tag, "active");
    });

    test("field with empty name is permitted at construction (parser rejects on round-trip)", () => {
        // The constructor doesn't validate; pathFromString is the validation boundary.
        // Documented invariant: empty field names cannot survive round-trip.
        const seg = field("");
        assert.equal((seg as { name: string }).name, "");
    });
});

// ============================================================================
// Round-trip — extra exotic combinations & every-kind-twice chains
// ============================================================================

describe("path: round-trip exotic chains", () => {
    const exotic: PatchPath[] = [
        [field("a"), index(0n), index(1n)],                    // array of arrays
        [dictKey("k1"), dictKey("k2")],                        // dict of dicts
        [field("a"), variantTag("t1"), variantTag("t2")],      // variant of variant
        [field("a"), index(0n), variantTag("t"), field("x")],  // mixed depth
        [variantTag("t"), index(0n)],                          // variant→array  (variant case is array)
        [dictKey("k"), index(0n), variantTag("t")],            // dict→array→variant
        [field("a"), dictKey("k"), index(0n), field("b")],     // 4-level mixed
    ];

    for (const segs of exotic) {
        const s = pathToString(segs);
        test(`round-trip exotic: "${s}"`, () => {
            assert.deepEqual(pathFromString(s), segs);
            assert.equal(pathToString(pathFromString(s)), s);
        });
    }
});

// ============================================================================
// pathFromString — extra error cases
// ============================================================================

describe("path: pathFromString extra errors", () => {
    test("dot before bracket: empty field segment between . and [", () => {
        assert.throws(() => pathFromString("a.[0]"));
    });

    test("dot before variant tag: empty field segment between . and @", () => {
        assert.throws(() => pathFromString("a.@tag"));
    });

    test("dot before brace: empty field segment between . and {", () => {
        assert.throws(() => pathFromString("a.{k}"));
    });

    test("trailing characters after a closed bracket without separator", () => {
        // Valid: a[0].b ; Invalid: a[0]b — bare 'b' after ']' has no leading dot
        assert.throws(() => pathFromString("a[0]b"));
    });

    test("trailing characters after a closed brace without separator", () => {
        assert.throws(() => pathFromString("a{k}b"));
    });
});

// ============================================================================
// pathDisplay — every segment kind, plus stress
// ============================================================================

describe("path: pathDisplay extra", () => {
    test("dict key with internal quotes is shown verbatim (no braces stripped)", () => {
        assert.equal(pathDisplay(dictKey('"AU"')), '"AU"');
    });

    test("field with dot in name is shown literally (display, not parse)", () => {
        // Display layer makes no escaping promises — it's a UI hint, not a parser-safe encoding.
        assert.equal(pathDisplay(field("a.b")), "a.b");
    });

    test("variant tag with hyphens", () => {
        assert.equal(pathDisplay(variantTag("in-progress")), "@in-progress");
    });
});
