/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The series and summary indexes' planner (#1039): their markers read back as
 * themselves; their tiles are e3's, before 1970 and in the first century too;
 * a cell's searches hold exactly its keys' entries in its tile under each
 * combination of the leading fields' chosen values; and neither index ever
 * serves the rail's narrowing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, decodeBeast2For, encodeBeast2For, equalFor, none, parseFor, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceIndexType, RecordSliceWhereType } from "../../src/platform/slice/record-types.js";
import { MAX_RECORD_SLICE_RUNS, planRecordSlice, recordChoiceWhere } from "../../src/platform/slice/record-plan.js";
import {
    RECORD_TILES, TILE_FIELD, readTileMarker, tileCellQueries, tileIndexFor, tileIndexServes, tileMarkerFields, tileNext,
    tileStart, tilesOver, tilingOf, type RecordTile,
} from "../../src/platform/slice/record-series.js";

type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Choice = Where extends Map<string, infer C> ? C : never;
const parseInstant = parseFor(DateTimeType);
const printInstant = printFor(DateTimeType);
const sameInstant = equalFor(DateTimeType);
const DAY = 86_400_000;

/** The instant a `.east` DateTime literal names. */
function at(text: string): Date {
    const read = parseInstant(text);
    assert.ok(read.success, text);
    return read.value;
}

/** The first instant of a UTC day, from its calendar fields: another way to the day than counting milliseconds. */
function dayOf(instant: Date): Date {
    const start = new Date(0);
    start.setUTCFullYear(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
    return start;
}

/** A seeded stream of numbers in [0, 1) (mulberry32): the same cases on every run. */
function stream(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test("a tile marker names its fields by role, marks a summary, and reads back as itself", () => {
    for (const marker of [
        { key: "press", from: "start", to: "end", tile: "week" as const, summary: false },
        { key: "press", from: "start", to: "end", tile: "month" as const, summary: true },
        { key: "a=b", from: "__summary", to: "x=y", tile: "day" as const, summary: false },
        ...RECORD_TILES.map(tile => ({ key: "k", from: "f", to: "t", tile, summary: true })),
    ]) {
        assert.deepEqual(readTileMarker(tileMarkerFields(marker)), marker);
    }
    assert.deepEqual(tileMarkerFields({ key: "press", from: "start", to: "end", tile: "quarter", summary: true }),
        ["key=press", "from=start", "to=end", "tile=quarter", "__summary"]);
    for (const names of [
        ["key=k", "from=f", "to=t"], ["key=k", "from=f", "tile=week"], ["from=f", "to=t", "tile=week"],
        ["key=k", "key=j", "from=f", "to=t", "tile=week"], ["key=k", "from=f", "to=t", "tile=hour"],
        ["key=k", "from=f", "to=t", "tile=week", "__summary", "__summary"], ["key", "from=f", "to=t", "tile=week"],
        ["key=k", "from=f", "to=t", "tile=week", "cell=1.0"], ["key=k", "from=f", "to=t", "tile=week", "=x"],
    ]) {
        assert.equal(readTileMarker(names), undefined, names.join(", "));
    }
});

test("a day and a week are counted in whole milliseconds from the epoch and from the Monday before it, whichever side of 1970", () => {
    const cases: [RecordTile, string, string][] = [
        ["day", "2026-10-07T15:30:00.000", "2026-10-07T00:00:00.000"],
        ["day", "1969-12-31T12:00:00.000", "1969-12-31T00:00:00.000"],
        ["day", "1969-12-31T00:00:00.000", "1969-12-31T00:00:00.000"],
        ["day", "1969-12-30T23:59:59.999", "1969-12-30T00:00:00.000"],
        // 2026-10-07 is a Wednesday; 1969-12-29 the Monday weeks are counted from; 1969-12-28 a Sunday.
        ["week", "2026-10-07T15:30:00.000", "2026-10-05T00:00:00.000"],
        ["week", "2026-10-05T00:00:00.000", "2026-10-05T00:00:00.000"],
        ["week", "2026-10-04T23:59:59.999", "2026-09-28T00:00:00.000"],
        ["week", "1970-01-01T00:00:00.000", "1969-12-29T00:00:00.000"],
        ["week", "1969-12-28T12:00:00.000", "1969-12-22T00:00:00.000"],
        ["month", "1969-03-15T08:00:00.000", "1969-03-01T00:00:00.000"],
        ["quarter", "1969-11-02T00:00:00.000", "1969-10-01T00:00:00.000"],
        ["quarter", "2026-03-31T23:59:59.999", "2026-01-01T00:00:00.000"],
        ["quarter", "2026-04-01T00:00:00.000", "2026-04-01T00:00:00.000"],
        ["year", "1969-07-20T20:17:00.000", "1969-01-01T00:00:00.000"],
    ];
    for (const [tile, instant, start] of cases) {
        assert.deepEqual(tileStart(tile, at(instant)), at(start), `${tile} of ${instant}`);
    }
    assert.deepEqual(tileNext("week", at("2026-10-05T00:00:00.000")), at("2026-10-12T00:00:00.000"));
    assert.deepEqual(tileNext("quarter", at("2026-10-01T00:00:00.000")), at("2027-01-01T00:00:00.000"), "a quarter past December is the next year's");
    assert.deepEqual(tileNext("month", at("1969-12-01T00:00:00.000")), at("1970-01-01T00:00:00.000"));
    assert.deepEqual(tileNext("year", at("1969-01-01T00:00:00.000")), at("1970-01-01T00:00:00.000"));
});

test("a calendar tile of the first century is that century's, never one of the 1900s", () => {
    // Date.UTC reads a year below 100 as one of the 1900s: the tiles never do.
    const early = new Date(0);
    early.setUTCFullYear(50, 4, 17);
    early.setUTCHours(9);
    for (const tile of ["month", "quarter", "year"] as const) {
        const start = tileStart(tile, early);
        assert.equal(start.getUTCFullYear(), 50, `${tile}: ${printInstant(start)}`);
        assert.equal(tileNext(tile, start).getUTCFullYear(), tile === "year" ? 51 : 50);
    }
    assert.equal(tileStart("month", early).getUTCMonth(), 4);
    assert.equal(tileStart("quarter", early).getUTCMonth(), 3);
});

test("every instant lies in the one tile its start names, whose next tile starts where it ends, at random over five thousand years", () => {
    const next = stream(1039);
    for (let n = 0; n < 4000; n++) {
        // From about 460 BC to 4600 AD, to the millisecond.
        const instant = new Date(Math.floor((next() - 0.48) * 1.6e14));
        for (const tile of RECORD_TILES) {
            const start = tileStart(tile, instant);
            const after = tileNext(tile, start);
            const name = `${tile} of ${printInstant(instant)}`;
            assert.ok(start.getTime() <= instant.getTime() && instant.getTime() < after.getTime(), name);
            assert.ok(sameInstant(tileStart(tile, start), start), `${name}: its start is its own tile's`);
            assert.ok(sameInstant(tileStart(tile, new Date(after.getTime() - 1)), start), `${name}: its last millisecond is in it`);
            switch (tile) {
                case "day":
                    assert.ok(sameInstant(start, dayOf(instant)), name);
                    break;
                case "week":
                    assert.equal(start.getUTCDay(), 1, `${name}: a Monday`);
                    assert.ok(sameInstant(start, dayOf(start)), `${name}: at midnight`);
                    assert.equal(after.getTime() - start.getTime(), 7 * DAY);
                    break;
                default:
                    assert.ok(sameInstant(start, dayOf(start)) && start.getUTCDate() === 1, `${name}: the first of a month, at midnight`);
                    assert.equal(start.getUTCFullYear(), instant.getUTCFullYear(), name);
                    assert.equal(start.getUTCMonth(), tile === "month" ? instant.getUTCMonth()
                        : tile === "quarter" ? instant.getUTCMonth() - (instant.getUTCMonth() % 3) : 0, name);
            }
        }
    }
});

test("a span's tiles are those it overlaps, in order; an instant's is the one holding it; past the limit there are none", () => {
    const tiles = tilesOver("week", at("2026-10-07T00:00:00.000"), at("2026-10-26T00:00:00.000"), 10);
    assert.deepEqual(tiles, ["2026-10-05", "2026-10-12", "2026-10-19"].map(day => at(`${day}T00:00:00.000`)),
        "its end is exclusive: the week starting on it is not overlapped");
    assert.deepEqual(tilesOver("week", at("2026-10-07T00:00:00.000"), at("2026-10-26T00:00:00.001"), 10)?.length, 4);
    assert.deepEqual(tilesOver("month", at("2026-10-07T00:00:00.000"), at("2026-10-07T00:00:00.000"), 10), [at("2026-10-01T00:00:00.000")],
        "an instant is in the tile holding it");
    assert.deepEqual(tilesOver("day", at("2026-10-07T00:00:00.000"), at("2026-10-01T00:00:00.000"), 10), [at("2026-10-07T00:00:00.000")],
        "a span ending before it starts is the instant at its start, as e3 files it");
    assert.equal(tilesOver("day", at("2026-01-01T00:00:00.000"), at("2027-01-01T00:00:00.000"), 364), undefined);
    assert.equal(tilesOver("day", at("2026-01-01T00:00:00.000"), at("2027-01-01T00:00:00.000"), 365)?.length, 365);
    assert.throws(() => tilesOver("day", at("2026-01-01T00:00:00.000"), at("2026-01-02T00:00:00.000"), 0), /one at least/);
});

const indexType = ArrayType(RecordSliceIndexType);
const week = { key: "press", from: "start", to: "end", tile: variant("week", null) };
const month = { ...week, tile: variant("month", null) };
const plain = { interval: none, area: none, series: none, summary: none };
const indexes = decodeBeast2For(indexType)(encodeBeast2For(indexType)([
    { name: "jobs_by_time", fields: ["start"], sets: new Set(), structured: true, ...plain, interval: some({ from: "start", to: "end", optional: false }) },
    { name: "by_press", fields: ["press"], sets: new Set(), structured: false, ...plain },
    { name: "jobs_by_press_week", fields: [TILE_FIELD, "press"], sets: new Set(), structured: true, ...plain, series: some(week) },
    { name: "jobs_by_state_press_week", fields: ["state", TILE_FIELD, "press"], sets: new Set(), structured: true, ...plain, series: some(week) },
    { name: "jobs_by_crew_press_week", fields: ["crews", TILE_FIELD, "press"], sets: new Set(["crews"]), structured: true, ...plain, series: some(week) },
    { name: "jobs_by_press_month", fields: [TILE_FIELD, "press"], sets: new Set(), structured: true, ...plain, summary: some(month) },
    { name: "jobs_by_state_press_month", fields: ["state", TILE_FIELD, "press"], sets: new Set(), structured: true, ...plain, summary: some(month) },
]));
const byName = (name: string) => indexes.find(index => index.name === name)!;
const values = (...choices: string[]): Choice => variant("values", choices);
const window = variant("range", { from: "2026-10-05T00:00:00.000", to: "2026-10-19T00:00:00.000" });
/** A narrowing decoded at the runtime boundary, as a reader's arrives. */
function where(entries: [string, Choice][]): Where {
    return decodeBeast2For(RecordSliceWhereType)(encodeBeast2For(RecordSliceWhereType)(new Map(entries)));
}
const presses = ['.some "P-1005"', '.some "P-1006"', '.some "P-1013"'];
const monday = at("2026-10-05T00:00:00.000");

test("a cell is a search for each key in its tile, under each combination of the leading fields' chosen values", () => {
    assert.deepEqual(tileCellQueries(byName("jobs_by_press_week"), where([]), monday, presses), {
        queries: presses.map(press => variant("fields", { values: ["2026-10-05T00:00:00.000", press], prefix: none })), residual: [],
    });
    const led = tileCellQueries(byName("jobs_by_state_press_week"), where([["state", values(".late", ".held")]]), monday, presses.slice(0, 2));
    assert.deepEqual(led.queries, [".late", ".held"].flatMap(state => presses.slice(0, 2).map(press =>
        variant("fields", { values: [state, "2026-10-05T00:00:00.000", press], prefix: none }))), "the keys inner, in the order given");
    assert.deepEqual(tileCellQueries(byName("jobs_by_crew_press_week"), where([["crews", values('"C-1"')]]), monday, presses.slice(0, 1)).queries,
        [variant("fields", { values: ['"C-1"', "2026-10-05T00:00:00.000", presses[0]!], prefix: none })]);
    assert.deepEqual(tileCellQueries(byName("jobs_by_press_month"), where([]), at("2026-10-01T00:00:00.000"), presses).queries.length, 3,
        "a summary's cell is planned alike");
});

test("a cell leaves to the reader every choice but its leading fields' and a range of its start, which the tiles cover", () => {
    const series = byName("jobs_by_state_press_week");
    assert.deepEqual(tileCellQueries(series, where([["state", values(".late")], ["start", window]]), monday, presses).residual, []);
    assert.deepEqual(tileCellQueries(series, where([["state", values(".late")], ["start", window], ["customer", values('"Acme"')]]), monday, presses).residual,
        ["customer"]);
    assert.deepEqual(tileCellQueries(byName("jobs_by_press_week"), where([["state", values(".late")], ["start", values("2026-10-06T00:00:00.000")]]), monday, presses).residual,
        ["start", "state"], "exact starts and a field the index is not led by are the reader's");
});

test("a cell it cannot plan is refused, naming why", () => {
    const series = byName("jobs_by_state_press_week");
    assert.throws(() => tileCellQueries(series, where([]), monday, presses), /takes exact values of 'state', which leads it/);
    assert.throws(() => tileCellQueries(series, where([["state", variant("prefix", "la")]]), monday, presses), /takes exact values of 'state'/);
    assert.throws(() => tileCellQueries(byName("jobs_by_crew_press_week"), where([["crews", values('"C-1"', '"C-2"')]]), monday, presses),
        /takes one value of 'crews', which fans out over a Set/);
    assert.throws(() => tileCellQueries(series, where([["state", values(...Array.from({ length: MAX_RECORD_SLICE_RUNS + 1 }, (_, i) => `"s${i}"`))]]), monday, presses),
        /more than 64 searches a key/);
    assert.throws(() => tileCellQueries(byName("jobs_by_press_week"), where([]), at("2026-10-06T00:00:00.000"), presses),
        /2026-10-06T00:00:00\.000 starts no week tile of 'jobs_by_press_week'/);
    assert.throws(() => tileCellQueries(byName("by_press"), where([]), monday, presses), /'by_press' is neither/);
});

test("a narrowing's cells are read through the index led by the most of its exact choices, a summary's of a tile the reader takes", () => {
    assert.equal(tileIndexFor(indexes, where([]), "series")?.name, "jobs_by_press_week");
    assert.equal(tileIndexFor(indexes, where([["state", values(".late")]]), "series")?.name, "jobs_by_state_press_week");
    assert.equal(tileIndexFor(indexes, where([["state", values(".late")], ["crews", values('"C-1"')]]), "series")?.name, "jobs_by_state_press_week",
        "of two led by as many, the one listed first");
    assert.equal(tileIndexFor(indexes, where([["crews", values('"C-1"', '"C-2"')]]), "series")?.name, "jobs_by_press_week",
        "a Set's field chosen twice serves no cell, and one led by fewer reads it");
    assert.equal(tileIndexFor(indexes, where([["state", values(".late")]]), "summary")?.name, "jobs_by_state_press_month");
    assert.equal(tileIndexFor(indexes, where([]), "summary", tile => tile === "quarter"), undefined);
    assert.equal(tileIndexFor(indexes, where([]), "summary", tile => tile === "month")?.name, "jobs_by_press_month");
    assert.equal(tileIndexServes(byName("jobs_by_time"), where([])), false, "an interval index has no cells");
    assert.deepEqual(tilingOf(byName("jobs_by_press_month")), month);
    assert.equal(tilingOf(byName("by_press")), undefined);
});

test("neither a series nor a summary index serves the rail's narrowing: an ordinary index does, or none", () => {
    assert.deepEqual(planRecordSlice(indexes, where([["press", values('"P-1005"')]]), "primary"),
        { index: "by_press", queries: [variant("key", '"P-1005"')] });
    const tiled = indexes.filter(index => tilingOf(index) !== undefined);
    assert.equal(planRecordSlice(tiled, where([["press", values('"P-1005"')]]), "primary"), null);
    assert.equal(planRecordSlice(tiled, where([["state", values(".late")]]), "primary"), null);
    assert.equal(recordChoiceWhere(tiled, where([]), "state", values(".late")), null, "no choice is offered through one");
});
