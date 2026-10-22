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
import { MAX_RECORD_SLICE_BATCH, RecordSliceSource, type RecordSliceReader } from "../../src/runtime/record-slice-source.js";
import type { SeekQueryType } from "../../src/contracts/source.js";

const indexType = ArrayType(RecordSliceIndexType);
const indexes = decodeBeast2For(indexType)(encodeBeast2For(indexType)([
    { name: "by_status_due", fields: ["status", "due"], sets: new Set(), structured: true, interval: none, area: none, series: none, summary: none },
    { name: "by_customer", fields: ["customer"], sets: new Set(), structured: false, interval: none, area: none, series: none, summary: none },
    { name: "by_skill", fields: ["skills"], sets: new Set(["skills"]), structured: false, interval: none, area: none, series: none, summary: none },
    { name: "by_status_skill", fields: ["status", "skills"], sets: new Set(["skills"]), structured: true, interval: none, area: none, series: none, summary: none },
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

type Range = { row: bigint; count: bigint };
/**
 * The virtual source as a reader that batches (#1351): each batch of searches
 * answered as its single searches would be, and each read of runs with their
 * rows in order — every batch kept, in the order asked.
 */
function batchingSource(size: bigint, ranges: Map<string, Range>) {
    const base = virtualSource(size, ranges);
    let pending = false;
    let short = false;
    const batches: Query[][] = [];
    const runs: Range[][] = [];
    const reader: RecordSliceReader<bigint> = {
        ...base.reader,
        seekAll(_index, queries) {
            batches.push([...queries]);
            if (pending) return none;
            return some(queries.map(query => {
                if (query.type !== "key") throw new Error("the fixture's batches search by key");
                const range = ranges.get(query.value);
                assert.ok(range, "fixture query must have known exact bounds");
                return { ...range, found: range.count > 0n };
            }));
        },
        runsAll(_index, asked) {
            runs.push(asked.map(({ row, count }) => ({ row, count })));
            if (pending) return none;
            const rows = asked.flatMap(({ row, count }) => Array.from({ length: Number(count) }, (_, i) => row + BigInt(i)));
            return some(decodeRows(encodeRows(short ? rows.slice(1) : rows)));
        },
    };
    return { reader, batches, runs, seeks: base.seeks, pages: base.pages, revision: base.revision,
        pending(value: boolean) { pending = value; },
        /** Answer each read of runs one entry short of what they hold. */
        short(value: boolean) { short = value; } };
}

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

test("a reader that batches is asked a plan's searches in one batch and a window across runs in one read; a window inside a run is its page (#1351)", () => {
    const source = batchingSource(100n, new Map([['"a"', { row: 10n, count: 10n }], ['"b"', { row: 60n, count: 20n }]]));
    const engine = new RecordSliceSource(source.reader);
    const expected = Array.from({ length: 100 }, (_, i) => BigInt(i)).filter(i => (i >= 10n && i < 20n) || (i >= 60n && i < 80n));
    assert.equal(unwrap(engine.resolve(union)).total, 30n);
    assert.deepEqual(source.batches, [union.queries], "every search in one batch, in the plan's order");
    assert.deepEqual(source.seeks, [], "no single search");
    // Rows 7 to 13 of the union: the last three of `a`'s run and the first four of `b`'s.
    assert.deepEqual(unwrap(engine.page(union, 7n, 7n)), expected.slice(7, 14));
    assert.deepEqual(source.runs, [[{ row: 17n, count: 3n }, { row: 60n, count: 4n }]], "the window's part of each run, read together");
    assert.deepEqual(source.pages, [], "no run is paged on its own");
    // Inside one run, the window is that run's page.
    assert.deepEqual(unwrap(engine.page(union, 12n, 5n)), expected.slice(12, 17));
    assert.deepEqual(source.pages, [{ offset: 62n, limit: 5n }]);
    assert.equal(source.runs.length, 1);
    // Read again, both are answered from what landed.
    assert.deepEqual(unwrap(engine.page(union, 7n, 7n)), expected.slice(7, 14));
    assert.deepEqual(unwrap(engine.page(union, 12n, 5n)), expected.slice(12, 17));
    assert.deepEqual([source.batches.length, source.runs.length, source.pages.length], [1, 1, 1]);
});

test("a batching reader's pending batch or read is `none`, never a partial count or window, and a read that disagrees with its bounds is refused (#1351)", () => {
    const source = batchingSource(100n, new Map([['"a"', { row: 10n, count: 10n }], ['"b"', { row: 60n, count: 20n }]]));
    const engine = new RecordSliceSource(source.reader);
    source.pending(true);
    assert.deepEqual(engine.resolve(union), none);
    assert.deepEqual(engine.page(union, 7n, 7n), none);
    source.pending(false);
    assert.equal(unwrap(engine.resolve(union)).total, 30n);
    assert.deepEqual(engine.page(union, 5n, 10n).type, "some");
    // Another revision: its window's read answers one entry short of the runs it asked.
    source.revision(some("B"));
    source.short(true);
    assert.throws(() => engine.page(union, 5n, 10n), /disagrees with its search bounds/);
    source.short(false);
    assert.equal(unwrap(engine.page(union, 5n, 10n)).length, 10, "a refused read does not poison its retry");
});

/**
 * The batching source as a reader that places and asks memberships (#1349):
 * a placement of runs counts their rows in segments of ten rows; an entry is
 * named by its row, its `ik` the row's text, and lies in the runs when its row
 * does — every read kept, in the order asked.
 */
function placingSource(size: bigint, ranges: Map<string, Range>) {
    const base = batchingSource(size, ranges);
    let pending = false;
    let skew = 0n;
    const placed: Range[][] = [];
    const asked: { runs: Range[]; entries: { ik: string; key: unknown }[] }[] = [];
    const reader: RecordSliceReader<bigint> = {
        ...base.reader,
        placeAll(_index, runs) {
            placed.push(runs.map(({ row, count }) => ({ row, count })));
            if (pending) return none;
            const bySegment = new Map<bigint, bigint>();
            for (const { row, count } of runs) {
                for (let at = row; at < row + count; at++) bySegment.set(at / 10n, (bySegment.get(at / 10n) ?? 0n) + 1n);
            }
            const total = runs.reduce((sum, run) => sum + run.count, 0n) + skew;
            return some({
                segments: [...bySegment].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([segment, rows]) => ({ offset: segment * 10n, count: 10n, rows })),
                placed: total, total, records: size, complete: true,
            });
        },
        withinAll(_index, runs, entries) {
            asked.push({ runs: runs.map(({ row, count }) => ({ row, count })), entries: entries.map(({ ik, key }) => ({ ik, key })) });
            if (pending) return none;
            return some(entries.map(({ ik }) => runs.some(({ row, count }) => parseInteger(ik) >= row && parseInteger(ik) < row + count)));
        },
    };
    return { reader, placed, asked, revision: base.revision,
        pending(value: boolean) { pending = value; base.pending(value); },
        /** Answer each placement this many rows off its runs' count. */
        skew(value: bigint) { skew = value; } };
}

test("a narrowing's rows are placed through its resolved runs, and a placement that disagrees with its bounds is refused (#1349)", () => {
    const source = placingSource(100n, new Map([['"a"', { row: 10n, count: 10n }], ['"b"', { row: 55n, count: 20n }]]));
    const engine = new RecordSliceSource(source.reader);
    source.pending(true);
    assert.deepEqual(engine.place(union), none, "nothing is placed while the runs are pending");
    assert.deepEqual(source.placed, [], "a placement waits for the runs it places");
    source.pending(false);
    const placement = unwrap(engine.place(union));
    assert.deepEqual(source.placed, [[{ row: 10n, count: 10n }, { row: 55n, count: 20n }]], "the plan's runs, ascending, whatever order its searches were in");
    assert.deepEqual(placement.segments.map(segment => [segment.offset, segment.rows]), [[10n, 10n], [50n, 5n], [60n, 10n], [70n, 5n]]);
    assert.deepEqual([placement.placed, placement.total, placement.records, placement.complete], [30n, 30n, 100n, true]);
    // Another revision whose placement counts a row its bounds do not hold.
    source.revision(some("B"));
    source.skew(1n);
    assert.throws(() => engine.place(union), /placement disagrees with its search bounds/);
    source.skew(0n);
    assert.equal(unwrap(engine.place(union)).total, 30n, "a refused placement does not poison its retry");
    assert.throws(() => new RecordSliceSource(batchingSource(100n, new Map()).reader).place(union), /cannot place/);
});

test("which of some entries a narrowing holds is asked of its resolved runs in one read, the reader deciding (#1349)", () => {
    const source = placingSource(100n, new Map([['"a"', { row: 10n, count: 10n }], ['"b"', { row: 55n, count: 20n }]]));
    const engine = new RecordSliceSource(source.reader);
    const entries = [9n, 10n, 19n, 20n, 54n, 55n, 74n, 75n].map(row => ({ ik: `${row}`, key: row }));
    assert.deepEqual(unwrap(engine.within(union, entries)), [false, true, true, false, false, true, true, false],
        "each run holds its first and last rows, and not those beside it");
    assert.deepEqual(source.asked, [{ runs: [{ row: 10n, count: 10n }, { row: 55n, count: 20n }], entries }], "every entry in one read, beside the runs");
    assert.deepEqual(unwrap(engine.within(union, [])), [], "asked of nothing, nothing is read");
    assert.equal(source.asked.length, 1);
    source.revision(some("B"));
    source.pending(true);
    assert.deepEqual(engine.within(union, entries), none, "a read pending is none, never a partial answer");
    assert.throws(() => new RecordSliceSource(batchingSource(100n, new Map()).reader).within(union, entries), /cannot read which rows/);
});

test("more entries than one request takes are asked as several reads, all in one pass, and answered in order (#1349)", () => {
    const source = placingSource(100n, new Map([['"a"', { row: 10n, count: 10n }], ['"b"', { row: 55n, count: 20n }]]));
    const engine = new RecordSliceSource(source.reader);
    // A record segment's rows, each with as many entries as its index fans them out to: past a request's keys.
    const entries = Array.from({ length: MAX_RECORD_SLICE_BATCH + 3 }, (_, i) => ({ ik: `${BigInt(i % 100)}`, key: BigInt(i) }));
    const within = unwrap(engine.within(union, entries));
    assert.deepEqual(source.asked.map(read => read.entries.length), [MAX_RECORD_SLICE_BATCH, 3], "a read for each request's worth, in one pass");
    assert.deepEqual(within, entries.map(({ ik }) => {
        const row = parseInteger(ik);
        return (row >= 10n && row < 20n) || (row >= 55n && row < 75n);
    }), "the answers in the entries' order");
    // The runs held at the revision, each part's read pending: no partial answer.
    source.pending(true);
    assert.deepEqual(engine.within(union, entries), none, "a part pending is none");
    assert.deepEqual(source.asked.slice(2).map(read => read.entries.length), [MAX_RECORD_SLICE_BATCH, 3], "every part asked in the pass");
});

test("a plan of more searches than one batch takes is asked as several batches, all in one pass (#1351)", () => {
    const keys = Array.from({ length: MAX_RECORD_SLICE_BATCH + 5 }, (_, i) => `"k${i}"`);
    const source = batchingSource(BigInt(2 * keys.length), new Map(keys.map((key, i) => [key, { row: BigInt(2 * i), count: 1n }])));
    const engine = new RecordSliceSource(source.reader);
    const plan: RecordSlicePlan = { index: "by_key", queries: keys.map(key => variant("key", key)) };
    assert.equal(unwrap(engine.resolve(plan)).total, BigInt(keys.length));
    assert.deepEqual(source.batches.map(batch => batch.length), [MAX_RECORD_SLICE_BATCH, 5]);
});

/**
 * A series index's cells (#1039) over a virtual index: each search by its
 * fields holds a known run, its entries the run's rows — every search, batch,
 * read and page kept, in the order asked. Without batching it answers single
 * searches and pages alone.
 */
function cellSource(ranges: Map<string, Range>, batching = true) {
    let revision: option<string> = some("A");
    let pending = false;
    let short = false;
    const batches: Query[][] = [];
    const seeks: Query[] = [];
    const runs: Range[][] = [];
    const pages: Range[] = [];
    const bounds = (query: Query) => {
        assert.equal(query.type, "fields", "a cell searches by its fields");
        const range = query.type === "fields" ? ranges.get(query.value.values.join("|")) : undefined;
        assert.ok(range, "fixture query must have known exact bounds");
        return { ...range, found: range.count > 0n };
    };
    const rowsOf = (asked: readonly Range[]) => asked.flatMap(({ row, count }) => Array.from({ length: Number(count) }, (_, i) => row + BigInt(i)));
    const reader: RecordSliceReader<bigint> = {
        revision: () => revision,
        total: () => some(1000n),
        seek(_index, query) {
            seeks.push(query);
            return pending ? none : some(bounds(query));
        },
        page(_index, offset, limit) {
            pages.push({ row: offset, count: limit });
            return pending ? none : some(decodeRows(encodeRows(rowsOf([{ row: offset, count: limit }]))));
        },
        ...(batching && {
            seekAll(_index: string, queries: readonly Query[]) {
                batches.push([...queries]);
                return pending ? none : some(queries.map(bounds));
            },
            runsAll(_index: string, asked: readonly Range[]) {
                runs.push(asked.map(({ row, count }) => ({ row, count })));
                if (pending) return none;
                const rows = rowsOf(asked);
                return some(decodeRows(encodeRows(short ? rows.slice(1) : rows)));
            },
        }),
    };
    return { reader, batches, seeks, runs, pages,
        revision(value: option<string>) { revision = value; },
        pending(value: boolean) { pending = value; },
        /** Answer each read of runs one entry short of what they hold. */
        short(value: boolean) { short = value; } };
}
const search = (...fields: string[]): Query => variant("fields", { values: fields, prefix: none });
// Cell `a` searches its keys out of the index's order and one key it holds nothing of; cell `b` shares a search with it.
const cellA = { id: "a", queries: [search("w1", "k2"), search("w1", "k1"), search("w1", "k9")] };
const cellB = { id: "b", queries: [search("w2", "k1"), search("w1", "k1")] };
const cellC = { id: "c", queries: [search("w3", "k1")] };
const cellRanges = new Map<string, Range>([
    ["w1|k1", { row: 10n, count: 3n }], ["w1|k2", { row: 13n, count: 2n }], ["w1|k9", { row: 15n, count: 0n }],
    ["w2|k1", { row: 40n, count: 4n }], ["w3|k1", { row: 70n, count: 1n }], ["w9|k1", { row: -1n, count: 1n }],
]);

test("a reader's cells are found in one batch of searches, each counted exactly before one entry is read, and kept for their revision (#1039)", () => {
    const source = cellSource(cellRanges);
    const engine = new RecordSliceSource(source.reader);
    const found = unwrap(engine.cellRuns("jobs_by_press_week", [cellA, cellB]));
    assert.deepEqual([...found].map(([id, runs]) => [id, runs.total]), [["a", 5n], ["b", 7n]]);
    assert.deepEqual(found.get("a")!.ranges.map(range => [range.row, range.count]), [[13n, 2n], [10n, 3n], [15n, 0n]], "each search's bounds, in its order");
    assert.deepEqual(source.batches, [[...cellA.queries, ...cellB.queries]], "every cell's searches in one batch, in order");
    assert.deepEqual([source.seeks.length, source.runs.length, source.pages.length], [0, 0, 0], "counted, not read");
    // Asked again, alone or together, a found cell asks nothing; a new one beside it asks its own searches.
    unwrap(engine.cellRuns("jobs_by_press_week", [cellB, cellA]));
    unwrap(engine.cellRuns("jobs_by_press_week", [cellB]));
    assert.equal(source.batches.length, 1);
    assert.equal(unwrap(engine.cellRuns("jobs_by_press_week", [cellA, cellC])).get("c")!.total, 1n);
    assert.deepEqual(source.batches.slice(1), [cellC.queries]);
    // Another revision asks every cell again; a batch pending is none, never a partial count.
    source.revision(some("B"));
    source.pending(true);
    assert.deepEqual(engine.cellRuns("jobs_by_press_week", [cellA]), none);
    source.pending(false);
    assert.equal(unwrap(engine.cellRuns("jobs_by_press_week", [cellA])).get("a")!.total, 5n);
    assert.deepEqual(source.batches.slice(2), [cellA.queries, cellA.queries]);
    assert.throws(() => engine.cellRuns("jobs_by_press_week", [cellA, { ...cellC, id: "a" }]), /Two cells are named 'a'/);
    assert.throws(() => engine.cellRuns("jobs_by_press_week", [{ id: "x", queries: [search("w9", "k1")] }]), /invalid search bounds/);
});

test("a reader's cells' entries are read in one read of their runs, each run once and ascending, and handed back cell by cell in their searches' order (#1039)", () => {
    const source = cellSource(cellRanges);
    const engine = new RecordSliceSource(source.reader);
    const read = unwrap(engine.cellEntries("jobs_by_press_week", [cellA, cellB]));
    assert.deepEqual(source.runs, [[{ row: 10n, count: 3n }, { row: 13n, count: 2n }, { row: 40n, count: 4n }]],
        "the run two cells share is read once, and an empty one not at all");
    assert.deepEqual(read.get("a"), [13n, 14n, 10n, 11n, 12n]);
    assert.deepEqual(read.get("b"), [40n, 41n, 42n, 43n, 10n, 11n, 12n]);
    assert.equal(source.batches.length, 1, "its searches are found once");
    assert.deepEqual(unwrap(engine.cellEntries("jobs_by_press_week", [{ id: "e", queries: [search("w1", "k9")] }])).get("e"), [],
        "a cell holding nothing reads nothing");
    assert.equal(source.runs.length, 1);
    // A read pending is none; one that answers short of its runs is refused, and its retry is not poisoned.
    source.revision(some("B"));
    source.pending(true);
    assert.deepEqual(engine.cellEntries("jobs_by_press_week", [cellA]), none);
    source.pending(false);
    source.short(true);
    assert.throws(() => engine.cellEntries("jobs_by_press_week", [cellA]), /disagrees with its search bounds/);
    source.short(false);
    assert.deepEqual(unwrap(engine.cellEntries("jobs_by_press_week", [cellA])).get("a"), [13n, 14n, 10n, 11n, 12n]);
    // Searches whose runs overlap without being one are refused: no entry is handed to a cell twice.
    const overlapping = cellSource(new Map([["w1|k1", { row: 10n, count: 3n }], ["w1|k2", { row: 12n, count: 2n }]]));
    assert.throws(() => new RecordSliceSource(overlapping.reader).cellEntries("jobs_by_press_week", [{ id: "x", queries: [search("w1", "k1"), search("w1", "k2")] }]),
        /overlap/);
});

test("a reader that does not batch finds cells by single searches, all started together, and reads a page a run (#1039)", () => {
    const source = cellSource(cellRanges, false);
    const engine = new RecordSliceSource(source.reader);
    const read = unwrap(engine.cellEntries("jobs_by_press_week", [cellA, cellB]));
    assert.deepEqual([read.get("a"), read.get("b")], [[13n, 14n, 10n, 11n, 12n], [40n, 41n, 42n, 43n, 10n, 11n, 12n]]);
    assert.deepEqual(source.seeks, [...cellA.queries, cellB.queries[0]!], "a search landed is not asked again in the pass");
    assert.deepEqual(source.pages, [{ row: 10n, count: 3n }, { row: 13n, count: 2n }, { row: 40n, count: 4n }]);
});

test("a cell a batch still in flight asks waits on it: a read wanting it asks that batch again as it was, and only the cells no batch asks in one more (#1039)", () => {
    const source = cellSource(cellRanges);
    const engine = new RecordSliceSource(source.reader);
    source.pending(true);
    assert.deepEqual(engine.cellRuns("jobs_by_press_week", [cellA, cellC]), none);
    // The view moves while it is in flight: `c` waits on the batch asking it, and `b`, which none asks, is asked alone.
    assert.deepEqual(engine.cellRuns("jobs_by_press_week", [cellC]), none);
    assert.deepEqual(engine.cellRuns("jobs_by_press_week", [cellB, cellC]), none);
    const first = [...cellA.queries, ...cellC.queries];
    assert.deepEqual(source.batches, [first, first, first, cellB.queries], "the batch in flight asked again as it was, never a part of it");
    // Both land: every cell they ask is found, `a` among them, and kept.
    source.pending(false);
    const found = unwrap(engine.cellRuns("jobs_by_press_week", [cellB, cellC]));
    assert.deepEqual([...found].map(([id, runs]) => [id, runs.total]), [["b", 7n], ["c", 1n]]);
    assert.deepEqual(source.batches.slice(4), [cellB.queries, first], "each batch asked again as it was, in the order its cells are wanted");
    assert.equal(unwrap(engine.cellRuns("jobs_by_press_week", [cellA])).get("a")!.total, 5n, "a cell its batch found, which no read waited on");
    assert.equal(source.batches.length, 6, "found when its batch landed: asked nothing");
    // Another revision lets every batch in flight go: its cells are asked again.
    source.pending(true);
    assert.deepEqual(engine.cellRuns("jobs_by_press_week", [{ id: "a", queries: [search("w3", "k2")] }]), none);
    source.revision(some("B"));
    assert.deepEqual(engine.cellRuns("jobs_by_press_week", [cellC]), none);
    assert.deepEqual(source.batches.slice(6), [[search("w3", "k2")], cellC.queries]);
});

test("a run a read still in flight asks waits on it: a read wanting it asks that read again as it was, and only the runs no read asks in one more (#1039)", () => {
    const source = cellSource(cellRanges);
    const engine = new RecordSliceSource(source.reader);
    unwrap(engine.cellRuns("jobs_by_press_week", [cellA, cellB, cellC]));
    source.pending(true);
    assert.deepEqual(engine.cellEntries("jobs_by_press_week", [cellA, cellB]), none);
    assert.deepEqual(engine.cellEntries("jobs_by_press_week", [cellB, cellC]), none);
    const first = [{ row: 10n, count: 3n }, { row: 13n, count: 2n }, { row: 40n, count: 4n }];
    assert.deepEqual(source.runs, [first, first, [{ row: 70n, count: 1n }]], "`b`'s runs wait on the read asking them; `c`'s, which none asks, are read alone");
    source.pending(false);
    const read = unwrap(engine.cellEntries("jobs_by_press_week", [cellB, cellC]));
    assert.deepEqual([read.get("b"), read.get("c")], [[40n, 41n, 42n, 43n, 10n, 11n, 12n], [70n]]);
    assert.deepEqual(source.runs.slice(3), [first, [{ row: 70n, count: 1n }]]);
    // Landed, the reads are let go: nothing is kept here, so a cell read again is read again.
    unwrap(engine.cellEntries("jobs_by_press_week", [cellC]));
    assert.deepEqual(source.runs.slice(5), [[{ row: 70n, count: 1n }]]);
    assert.equal(source.batches.length, 1, "its cells were found once");
});

test("past its bound of batches in flight, the oldest is let go: a cell waiting on it is asked again (#1039)", () => {
    const ranges = new Map(Array.from({ length: 40 }, (_, i): [string, Range] => [`w${i}|k1`, { row: BigInt(10 * i), count: 1n }]));
    const source = cellSource(ranges);
    const engine = new RecordSliceSource(source.reader);
    source.pending(true);
    const cell = (i: number) => ({ id: `c${i}`, queries: [search(`w${i}`, "k1")] });
    for (let i = 0; i < 33; i++) assert.deepEqual(engine.cellRuns("jobs_by_press_week", [cell(i)]), none);
    assert.equal(source.batches.length, 33);
    // The newest still waits on its batch; the oldest, let go, is a batch of its own again.
    assert.deepEqual(engine.cellRuns("jobs_by_press_week", [cell(32)]), none);
    assert.deepEqual(engine.cellRuns("jobs_by_press_week", [cell(0)]), none);
    assert.deepEqual(source.batches.slice(33), [cell(32).queries, cell(0).queries]);
    source.pending(false);
    assert.equal(unwrap(engine.cellRuns("jobs_by_press_week", [cell(0), cell(32)])).size, 2);
});

test("a revision not known for a moment lets nothing kept go: known again, the same revision asks nothing again (#1039)", () => {
    const source = cellSource(cellRanges);
    const engine = new RecordSliceSource(source.reader);
    unwrap(engine.cellEntries("jobs_by_press_week", [cellA]));
    const asked = [source.batches.length, source.runs.length];
    source.revision(none);
    assert.deepEqual(engine.cellRuns("jobs_by_press_week", [cellA]), none, "nothing is answered while the revision is unknown");
    source.revision(some("A"));
    assert.equal(unwrap(engine.cellRuns("jobs_by_press_week", [cellA])).get("a")!.total, 5n);
    assert.deepEqual([source.batches.length, source.runs.length], asked, "the cell found at the revision stands for it again");
    // Another revision lets it go.
    source.revision(some("B"));
    unwrap(engine.cellRuns("jobs_by_press_week", [cellA]));
    assert.equal(source.batches.length, asked[0]! + 1);
});
