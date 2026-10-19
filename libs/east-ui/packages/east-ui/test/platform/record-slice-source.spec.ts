/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, IntegerType, decodeBeast2For, encodeBeast2For, none, parseFor,
    some, variant, type option, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceIndexType, RecordSliceWhereType } from "../../src/platform/slice/record-types.js";
import { planRecordSlice, type RecordSlicePlan } from "../../src/platform/slice/record-plan.js";
import { RecordSliceSource, type RecordSliceReader } from "../../src/runtime/record-slice-source.js";
import type { SeekQueryType } from "../../src/contracts/source.js";

const indexType = ArrayType(RecordSliceIndexType);
const indexes = decodeBeast2For(indexType)(encodeBeast2For(indexType)([
    { name: "by_status_due", fields: ["status", "due"], sets: new Set(), structured: true, interval: none },
    { name: "by_customer", fields: ["customer"], sets: new Set(), structured: false, interval: none },
    { name: "by_skill", fields: ["skills"], sets: new Set(["skills"]), structured: false, interval: none },
    { name: "by_status_skill", fields: ["status", "skills"], sets: new Set(["skills"]), structured: true, interval: none },
]));
const values = (...choices: string[]) => variant("values", choices);
// Use decoded East dictionaries, including ordered Set metadata, at the runtime boundary.
function plan(entries: [string, ValueTypeOf<typeof RecordSliceWhereType> extends Map<string, infer V> ? V : never][]) {
    const state = decodeBeast2For(RecordSliceWhereType)(encodeBeast2For(RecordSliceWhereType)(new Map(entries)));
    return planRecordSlice(indexes, state, "primary");
}

test("record paths preserve exact fields, scalar keys, half-open ranges and bounded alternatives", () => {
    assert.deepEqual(plan([]), { index: "primary", queries: [] });
    assert.deepEqual(plan([["status", values('.held', '.late')], ["due", variant("range", { from: '2026-05-01T00:00:00.000', to: '2026-06-01T00:00:00.000' })]]), {
        index: "by_status_due", queries: [".held", ".late"].map(status => variant("range", {
            from: [status, '2026-05-01T00:00:00.000'], to: [status, '2026-06-01T00:00:00.000'],
        })),
    });
    assert.deepEqual(plan([["customer", values('"Acme"')]]), { index: "by_customer", queries: [variant("key", '"Acme"')] });
    assert.deepEqual(plan([["status", values('.held')], ["due", variant("prefix", "May")]]), {
        index: "by_status_due", queries: [variant("fields", { values: ['.held'], prefix: some("May") })],
    });
    assert.equal(plan([["status", values('.held')], ["customer", values('"Acme"')]]), null);
    assert.equal(plan([["due", variant("range", { from: "1", to: "5" })]]), null, "a trailing field needs its leading exact choices");
    assert.throws(() => plan([["status", values(...Array.from({ length: 65 }, (_, i) => `v${i}`))]]), /choose fewer values/);
});

test("Set paths cannot repeat or omit primary rows under a partial or multiple choice", () => {
    assert.deepEqual(plan([["skills", values('"lift"')]]), { index: "by_skill", queries: [variant("key", '"lift"')] });
    assert.equal(plan([["skills", values('"lift"', '"pack"')]]), null);
    assert.equal(plan([["skills", variant("prefix", "li")]]), null);
    assert.equal(planRecordSlice([indexes[3]!], new Map([["status", values(".held")]]), "primary"), null,
        "an unfixed trailing Set would duplicate some records and omit empty Sets");
});

type Query = ValueTypeOf<SeekQueryType>;
const integerParser = parseFor(IntegerType);
function parseInteger(text: string): bigint {
    const result = integerParser(text);
    assert.ok(result.success);
    return result.value;
}
const decodeRows = decodeBeast2For(ArrayType(IntegerType));
const encodeRows = encodeBeast2For(ArrayType(IntegerType));
function virtualSource(size: bigint, ranges: Map<string, { row: bigint; count: bigint }>) {
    let revision: option<string> = some("A");
    let pending = false;
    let held: readonly string[] = [];
    let failure: Error | undefined;
    let trim = 2048n;
    const seeks: Query[] = [];
    const pages: { offset: bigint; limit: bigint }[] = [];
    const reader: RecordSliceReader<bigint> = {
        revision: () => revision,
        total: () => pending ? none : some(size),
        seek(_index, query) {
            seeks.push(query);
            if (failure) throw failure;
            if (pending || (query.type === "key" && held.includes(query.value))) return none;
            const range = query.type === "key" ? ranges.get(query.value)
                : query.type === "range" ? { row: parseInteger(query.value.from[0]!), count: parseInteger(query.value.to[0]!) - parseInteger(query.value.from[0]!) }
                    : undefined;
            assert.ok(range, "fixture query must have known exact bounds");
            return some({ ...range, found: range.count > 0n });
        },
        page(_index, offset, limit) {
            pages.push({ offset, limit });
            if (failure) throw failure;
            if (pending) return none;
            const count = limit < trim ? limit : trim;
            return some(decodeRows(encodeRows(Array.from({ length: Number(count) }, (_, i) => offset + BigInt(i)))));
        },
    };
    return { reader, seeks, pages, pending(value: boolean) { pending = value; }, failure(error?: Error) { failure = error; },
        revision(value: option<string>) { revision = value; }, trim(value: bigint) { trim = value; },
        /** Keep these key searches pending, every other one answered. */
        hold(...keys: string[]) { held = keys; } };
}
const union: RecordSlicePlan = { index: "by_status", queries: [variant("key", '"b"'), variant("key", '"a"')] };

function unwrap<T>(value: option<T>): T { assert.equal(value.type, "some"); return value.value; }

test("union pages and search insertion positions agree with the ordered filtered view", () => {
    const source = virtualSource(100n, new Map([['"a"', { row: 10n, count: 10n }], ['"b"', { row: 60n, count: 20n }]]));
    source.trim(3n);
    const engine = new RecordSliceSource(source.reader);
    const expected = Array.from({ length: 100 }, (_, i) => BigInt(i)).filter(i => (i >= 10n && i < 20n) || (i >= 60n && i < 80n));
    assert.equal(unwrap(engine.resolve(union)).total, 30n);
    for (const offset of [0, 7, 10, 27, 30, 50]) {
        assert.deepEqual(unwrap(engine.page(union, BigInt(offset), 7n)), expected.slice(offset, offset + 7));
    }
    const original = unwrap(engine.page(union, 7n, 7n));
    const reads = source.pages.length;
    assert.equal(unwrap(engine.page(union, 7n, 7n)), original);
    assert.equal(source.pages.length, reads, "repeat rendering reuses completed windows");
    for (const [from, to] of [[0, 1], [18, 67], [40, 40], [90, 95]]) {
        const matches = expected.filter(i => i >= BigInt(from!) && i < BigInt(to!));
        assert.deepEqual(unwrap(engine.seek(union, variant("range", { from: [`${from}`], to: [`${to}`] }))), {
            found: matches.length > 0, row: BigInt(expected.filter(i => i < BigInt(from!)).length), count: BigInt(matches.length),
        });
    }
    assert.equal(source.pages.length, reads, "searches and counts never read rows");
});

test("a trillion-row source needs two searches and five row reads for a cross-range window", () => {
    const source = virtualSource(10_000_000_000_000n, new Map([
        ['"a"', { row: 1_000_000_000_000n, count: 1_000_000_000n }],
        ['"b"', { row: 4_000_000_000_000n, count: 1_000_000_000n }],
    ]));
    const engine = new RecordSliceSource(source.reader);
    assert.equal(unwrap(engine.resolve(union)).total, 2_000_000_000n);
    assert.equal(source.seeks.length, 2);
    assert.equal(source.pages.length, 0);
    assert.deepEqual(unwrap(engine.page(union, 999_999_998n, 5n)), [1_000_999_999_998n, 1_000_999_999_999n, 4_000_000_000_000n, 4_000_000_000_001n, 4_000_000_000_002n]);
    assert.deepEqual(source.pages.map(page => page.limit), [2n, 3n]);
    assert.equal(source.seeks.length, 2);
    assert.equal(unwrap(engine.page(union, 0n, 1_000_000_000n)).length, 2048, "an oversized request stays bounded");
});

test("a selection read again asks its source only for the searches still pending; another revision asks them all again (#1360)", () => {
    // A window over an interval index is some fifty-five searches, which land one
    // by one: a read while some are pending never asks again for one that landed.
    const source = virtualSource(100n, new Map([['"a"', { row: 10n, count: 10n }], ['"b"', { row: 60n, count: 20n }]]));
    const engine = new RecordSliceSource(source.reader);
    source.hold('"b"');
    assert.deepEqual(engine.resolve(union), none);
    assert.deepEqual(source.seeks, [variant("key", '"b"'), variant("key", '"a"')]);
    assert.deepEqual(engine.resolve(union), none);
    assert.deepEqual(source.seeks.slice(2), [variant("key", '"b"')], "the landed search is not asked again");
    source.hold();
    assert.equal(unwrap(engine.resolve(union)).total, 30n);
    assert.deepEqual(source.seeks.slice(3), [variant("key", '"b"')]);
    assert.deepEqual(unwrap(engine.seek(union, variant("key", '"a"'))), { found: true, row: 0n, count: 10n },
        "a key search the selection has asked is answered from it");
    assert.equal(source.seeks.length, 4);
    source.revision(some("B"));
    assert.equal(unwrap(engine.resolve(union)).total, 30n);
    assert.deepEqual(source.seeks.slice(4), [variant("key", '"b"'), variant("key", '"a"')], "another revision asks every search again");
});

test("pending requests, failures and revision changes cannot produce partial counts or stale windows", () => {
    const source = virtualSource(100n, new Map([['"a"', { row: 10n, count: 10n }], ['"b"', { row: 60n, count: 20n }]]));
    const engine = new RecordSliceSource(source.reader);
    source.pending(true);
    assert.deepEqual(engine.resolve(union), none);
    assert.equal(source.seeks.length, 2, "all independent requests start even while the first is pending");
    source.pending(false);
    const original = unwrap(engine.page(union, 0n, 5n));
    source.revision(some("B"));
    source.pending(true);
    assert.deepEqual(engine.resolve(union), none);
    assert.deepEqual(engine.page(union, 0n, 5n), none);
    source.pending(false);
    const error = new Error("offline");
    source.failure(error);
    assert.throws(() => engine.resolve(union), error);
    source.failure();
    assert.notEqual(unwrap(engine.page(union, 0n, 5n)), original, "new revision never reuses an old window object");
    source.revision(none);
    assert.deepEqual(engine.resolve(union), none);
    source.revision(some("C"));
    source.trim(0n);
    assert.throws(() => engine.page(union, 0n, 5n), /disagrees with its search bounds/);
    source.trim(2n);
    assert.deepEqual(unwrap(engine.page(union, 0n, 5n)), [10n, 11n, 12n, 13n, 14n], "failed pages do not poison retries");
});
