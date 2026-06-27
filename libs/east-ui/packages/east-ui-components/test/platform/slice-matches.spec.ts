/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Direct tests for the auto-derived Slice.Search options projection
 * (`autoDeriveMatches`) — the path that powers the search dropdown when a slice
 * declares no `toMatch`. This is where #129 lived: the projected option `id`
 * carried a per-row ordinal joined by a stray NUL byte (`label\x00N`), so
 * selecting an option committed a query that matched nothing. The fix uses the
 * clean field value as both id and label, de-duplicated.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { autoDeriveMatches, autoDeriveFieldHints } from "../../src/platform/slice/index.js";

/** Build a minimal config exposing one or more string/non-string fields. */
function cfg(fields: Record<string, { type: string; get: (r: any) => unknown }>, searchFieldIds: string[] = []) {
    return {
        searchFieldIds,
        fields: new Map(Object.entries(fields).map(([id, f]) => [id, { type: f.type, value: { accessor: f.get } }])),
    };
}

test("autoDeriveMatches: id is the clean value — no ordinal, no NUL byte (#129)", () => {
    const rows = [{ country: "Germany" }, { country: "France" }];
    const out = autoDeriveMatches(rows, cfg({ country: { type: "string", get: (r) => r.country } }, ["country"]));
    assert.deepEqual(out.map(o => o.id), ["Germany", "France"]);
    assert.deepEqual(out.map(o => o.label), ["Germany", "France"]);
    // The historic bug: id was `${label}\x00${i}`. Guard against any regression.
    for (const o of out) {
        assert.ok(!o.id.includes("\x00"), `id "${JSON.stringify(o.id)}" must not contain a NUL`);
        assert.equal(o.id, o.label, "id must equal the clean label so selecting commits a valid query");
    }
});

test("autoDeriveMatches: de-duplicates repeated values (distinct options only)", () => {
    const rows = [{ country: "EU" }, { country: "EU" }, { country: "NA" }, { country: "EU" }];
    const out = autoDeriveMatches(rows, cfg({ country: { type: "string", get: (r) => r.country } }, ["country"]));
    assert.deepEqual(out.map(o => o.id), ["EU", "NA"]);
});

test("autoDeriveMatches: empty hits → empty options", () => {
    const out = autoDeriveMatches([], cfg({ country: { type: "string", get: (r) => r.country } }, ["country"]));
    assert.deepEqual(out, []);
});

test("autoDeriveMatches: no string field anywhere → empty (un-derivable)", () => {
    const rows = [{ sessions: 42n }, { sessions: 18n }];
    const out = autoDeriveMatches(rows, cfg({ sessions: { type: "integer", get: (r) => r.sessions } }, ["sessions"]));
    assert.deepEqual(out, []);
});

test("autoDeriveMatches: prefers the first searchable string field in searchFieldIds order", () => {
    const rows = [{ scenario: "v3", region: "EU" }];
    // searchFieldIds lists region first → it wins over scenario.
    const out = autoDeriveMatches(
        rows,
        cfg(
            { scenario: { type: "string", get: (r) => r.scenario }, region: { type: "string", get: (r) => r.region } },
            ["region", "scenario"],
        ),
    );
    assert.deepEqual(out.map(o => o.id), ["EU"]);
});

test("autoDeriveMatches: falls back to the first string field when searchFieldIds is empty", () => {
    const rows = [{ id: 1n, name: "Alice" }];
    const out = autoDeriveMatches(
        rows,
        cfg({ id: { type: "integer", get: (r) => r.id }, name: { type: "string", get: (r) => r.name } }, []),
    );
    assert.deepEqual(out.map(o => o.id), ["Alice"]);
});

test("autoDeriveMatches: skips null / undefined values — never offers a 'null'/'undefined' suggestion", () => {
    // Handle-owned slices (e.g. DecisionQueue) feed untyped JS rows; a missing
    // value must not become a junk substring query when selected.
    const rows = [{ country: "EU" }, { country: null }, { country: undefined }, { country: "NA" }];
    const out = autoDeriveMatches(rows, cfg({ country: { type: "string", get: (r) => r.country } }, ["country"]));
    assert.deepEqual(out.map(o => o.id), ["EU", "NA"]);
    for (const o of out) assert.ok(o.id !== "null" && o.id !== "undefined");
});

test("autoDeriveMatches: skips a configured search field that isn't a string", () => {
    const rows = [{ sessions: 5n, region: "APAC" }];
    // searchFieldIds names the integer field first; it must be skipped for the string one.
    const out = autoDeriveMatches(
        rows,
        cfg({ sessions: { type: "integer", get: (r) => r.sessions }, region: { type: "string", get: (r) => r.region } }, ["sessions", "region"]),
    );
    assert.deepEqual(out.map(o => o.id), ["APAC"]);
});

// ---------------------------------------------------------------------------
// autoDeriveFieldHints — #131: distinct value suggestions from the bound data
// ---------------------------------------------------------------------------

test("autoDeriveFieldHints: distinct values in insertion order", () => {
    const rows = [{ c: "EU" }, { c: "NA" }, { c: "EU" }, { c: "APAC" }, { c: "NA" }];
    assert.deepEqual(autoDeriveFieldHints(rows, (r: any) => r.c), ["EU", "NA", "APAC"]);
});

test("autoDeriveFieldHints: caps at the requested top-N (free entry beyond)", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ c: `v${i}` }));
    const out = autoDeriveFieldHints(rows, (r: any) => r.c, 50);
    assert.equal(out.length, 50);
    assert.equal(out[0], "v0");
});

test("autoDeriveFieldHints: skips null / undefined values", () => {
    const rows = [{ c: "A" }, { c: null }, { c: undefined }, { c: "B" }];
    assert.deepEqual(autoDeriveFieldHints(rows, (r: any) => r.c), ["A", "B"]);
});

test("autoDeriveFieldHints: empty rows → empty", () => {
    assert.deepEqual(autoDeriveFieldHints([], (r: any) => r.c), []);
});
