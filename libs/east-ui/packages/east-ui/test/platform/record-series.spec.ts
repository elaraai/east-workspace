/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The series and summary indexes' planner (#1039, #1433): their markers read
 * back as themselves; their tiles are e3's, before 1970 and in the first
 * century too; a reader's runs are a level's tiles that can hold an event
 * overlapping the range — from the tile before the range's first, or its
 * first where no event filed before it reaches, to its last — and a summary's
 * from one before to one after; a cell's searches are a range a key, holding
 * exactly its keys' entries over its run under each combination of the leading
 * fields' chosen values; and neither index ever serves the rail's narrowing.
 *
 * And a series index in time order's (#1710): its marker names its order; a
 * cell's searches are a range a tile, from its first key through its last;
 * and a block of keys is read through the index led by the most of the
 * narrowing's choices, one in time order under the group the block stands in.
 * A series index whose entries carry a copy of each event says so in its
 * marker too (#1725).
 *
 * And a summary with no key, the record's totals a tile (#1732): its marker
 * reads back as itself, never as a tile marker; its cells are one range of
 * whole tiles under each combination of the leading fields' chosen values; a
 * narrowing reads through the totals led by the most of its exact choices that
 * leave it nothing but the window; and no reader of a resource's summary, nor
 * the rail, takes them for one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, decodeBeast2For, encodeBeast2For, equalFor, none, parseFor, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { randomStream } from "@elaraai/east/internal";
import { RecordSliceIndexType, RecordSliceWhereType } from "../../src/platform/slice/record-types.js";
import { MAX_RECORD_SLICE_RUNS, planRecordSlice, recordChoiceWhere } from "../../src/platform/slice/record-plan.js";
import {
    RECORD_TILES, SHORTEST_TILE_MS, inTimeCellQueries, isTiledIndex, levelCellQueries, levelRuns, levelsOf, readTileMarker, readTotalsMarker, seriesIndexFor,
    summaryCellQueries, summaryRun, tileIndexFor, tileIndexServes, tileMarkerFields, tileNext, tileStart, tilingOf, totalsCellQueries, totalsIndexFor,
    totalsMarkerFields, totalsOf, totalsRun, type RecordTile,
} from "../../src/platform/slice/record-series.js";

type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Choice = Where extends Map<string, infer C> ? C : never;
/** Whether a narrowing a planner hands on is one, as East compares two Dicts of choices. */
const sameWhere = equalFor(RecordSliceWhereType) as (a: ReadonlyMap<string, Choice>, b: Where) => boolean;
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

test("a tile marker names its fields by role, a series index's time order and its copies, marks a summary, and reads back as itself", () => {
    for (const marker of [
        { key: "press", from: "start", to: "end", tile: "week" as const, summary: false, order: "key" as const, copy: false },
        { key: "press", from: "start", to: "end", tile: "week" as const, summary: false, order: "time" as const, copy: false },
        { key: "press", from: "start", to: "end", tile: "month" as const, summary: true, order: "key" as const, copy: false },
        { key: "a=b", from: "__summary", to: "order=time", tile: "day" as const, summary: false, order: "key" as const, copy: false },
        // A series index carrying a copy of each event (#1725), in either order; a field named as the leaf is a field.
        { key: "press", from: "start", to: "end", tile: "week" as const, summary: false, order: "key" as const, copy: true },
        { key: "__copy", from: "start", to: "end", tile: "week" as const, summary: false, order: "time" as const, copy: true },
        ...RECORD_TILES.map(tile => ({ key: "k", from: "f", to: "t", tile, summary: true, order: "key" as const, copy: false })),
        ...RECORD_TILES.map(tile => ({ key: "k", from: "f", to: "t", tile, summary: false, order: "time" as const, copy: false })),
    ]) {
        assert.deepEqual(readTileMarker(tileMarkerFields(marker)), marker);
    }
    assert.deepEqual(tileMarkerFields({ key: "press", from: "start", to: "end", tile: "quarter", summary: true, order: "key", copy: false }),
        ["key=press", "from=start", "to=end", "tile=quarter", "__summary"]);
    assert.deepEqual(tileMarkerFields({ key: "press", from: "start", to: "end", tile: "week", summary: false, order: "key", copy: false }),
        ["key=press", "from=start", "to=end", "tile=week"], "an index in key order carrying its rows names no order and no copy: its marker is as it was");
    assert.deepEqual(tileMarkerFields({ key: "press", from: "start", to: "end", tile: "week", summary: false, order: "time", copy: false }),
        ["key=press", "from=start", "to=end", "tile=week", "order=time"]);
    assert.deepEqual(tileMarkerFields({ key: "press", from: "start", to: "end", tile: "week", summary: false, order: "time", copy: true }),
        ["key=press", "from=start", "to=end", "tile=week", "order=time", "__copy"]);
    assert.throws(() => tileMarkerFields({ key: "press", from: "start", to: "end", tile: "week", summary: true, order: "time", copy: false }),
        /A summary index is filed by key/);
    assert.throws(() => tileMarkerFields({ key: "press", from: "start", to: "end", tile: "week", summary: true, order: "key", copy: true }),
        /A summary index holds its totals: its marker names no copy/);
    for (const names of [
        ["key=k", "from=f", "to=t", "tile=week", "order=press"], ["key=k", "from=f", "to=t", "tile=week", "order=time", "order=time"],
        ["key=k", "from=f", "to=t", "tile=week", "order=time", "__summary"],
        ["key=k", "from=f", "to=t"], ["key=k", "from=f", "tile=week"], ["from=f", "to=t", "tile=week"],
        ["key=k", "key=j", "from=f", "to=t", "tile=week"], ["key=k", "from=f", "to=t", "tile=hour"],
        ["key=k", "from=f", "to=t", "tile=week", "__summary", "__summary"], ["key", "from=f", "to=t", "tile=week"],
        ["key=k", "from=f", "to=t", "tile=week", "cell=1.0"], ["key=k", "from=f", "to=t", "tile=week", "=x"],
        ["key=k", "from=f", "to=t", "tile=week", "__copy", "__copy"], ["key=k", "from=f", "to=t", "tile=week", "__copy", "__summary"],
    ]) {
        assert.equal(readTileMarker(names), undefined, names.join(", "));
    }
});

test("the record's totals a tile name their fields by role and mark themselves, read back as themselves, and never as a tile marker (#1732)", () => {
    for (const marker of [
        { from: "start", to: "end", tile: "month" as const },
        // A field named as the leaf, or as a role, is a field.
        { from: "__totals", to: "tile=week", tile: "year" as const },
        ...RECORD_TILES.map(tile => ({ from: "f", to: "t", tile })),
    ]) {
        assert.deepEqual(readTotalsMarker(totalsMarkerFields(marker)), marker);
    }
    assert.deepEqual(totalsMarkerFields({ from: "start", to: "end", tile: "quarter" }), ["from=start", "to=end", "tile=quarter", "__totals"]);
    assert.equal(readTileMarker(totalsMarkerFields({ from: "start", to: "end", tile: "month" })), undefined, "the record's totals are no tile marker");
    assert.equal(readTotalsMarker(tileMarkerFields({ key: "press", from: "start", to: "end", tile: "month", summary: true, order: "key", copy: false })), undefined,
        "a summary by key is no record's totals");
    for (const names of [
        ["from=f", "to=t", "tile=week"], ["from=f", "to=t", "__totals"], ["from=f", "tile=week", "__totals"],
        ["key=k", "from=f", "to=t", "tile=week", "__totals"], ["from=f", "to=t", "tile=week", "__totals", "__totals"],
        ["from=f", "to=t", "tile=hour", "__totals"], ["from=f", "from=g", "to=t", "tile=week", "__totals"],
        ["from=f", "to=t", "tile=week", "order=time", "__totals"], ["from=f", "to=t", "tile=week", "__summary", "__totals"],
        ["from=f", "to=t", "tile=week", "__copy", "__totals"], ["from=f", "to=t", "tile=week", "=x", "__totals"],
    ]) {
        assert.equal(readTotalsMarker(names), undefined, names.join(", "));
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
    // East's seeded stream: the same cases on every run.
    const next = randomStream(1039);
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

test("a series index files at its tile and every coarser one; a reader reads a run a level, from the tile before the range's first to its last", () => {
    assert.deepEqual(levelsOf("week"), ["week", "month", "quarter", "year"]);
    assert.deepEqual(levelsOf("day"), ["day", "week", "month", "quarter", "year"]);
    assert.deepEqual(levelsOf("year"), ["year"]);
    const runs = (tile: RecordTile, from: string, to: string) => levelRuns(tile, at(from), at(to))
        .map(run => [run.level, printInstant(run.from), printInstant(run.to)]);
    // 1–14 October 2026 over a week tile: the weeks from Mondays 21 September to 12 October, September and October,
    // the third and the fourth quarter, and 2025 and 2026 — each run's end the start of the tile after its last.
    assert.deepEqual(runs("week", "2026-10-01T00:00:00.000", "2026-10-15T00:00:00.000"), [
        ["week", "2026-09-21T00:00:00.000", "2026-10-19T00:00:00.000"],
        ["month", "2026-09-01T00:00:00.000", "2026-11-01T00:00:00.000"],
        ["quarter", "2026-07-01T00:00:00.000", "2027-01-01T00:00:00.000"],
        ["year", "2025-01-01T00:00:00.000", "2027-01-01T00:00:00.000"],
    ]);
    // Across a year's end and a quarter's at a day tile: Sunday 20 December is in the week of Monday the 14th.
    assert.deepEqual(runs("day", "2026-12-20T00:00:00.000", "2027-01-10T00:00:00.000"), [
        ["day", "2026-12-19T00:00:00.000", "2027-01-10T00:00:00.000"],
        ["week", "2026-12-07T00:00:00.000", "2027-01-11T00:00:00.000"],
        ["month", "2026-11-01T00:00:00.000", "2027-02-01T00:00:00.000"],
        ["quarter", "2026-07-01T00:00:00.000", "2027-04-01T00:00:00.000"],
        ["year", "2025-01-01T00:00:00.000", "2028-01-01T00:00:00.000"],
    ]);
    // A range ending at or before it starts is the instant at its start.
    assert.deepEqual(runs("year", "2026-10-07T00:00:00.000", "2026-10-07T00:00:00.000"), [["year", "2025-01-01T00:00:00.000", "2027-01-01T00:00:00.000"]]);
});

test("a run starts at the range's own tile where the range starts too far into it for an event filed before it to reach", () => {
    assert.deepEqual(SHORTEST_TILE_MS, { day: DAY, week: 7 * DAY, month: 28 * DAY, quarter: 90 * DAY, year: 365 * DAY });
    /** Where the run of a level starts, for a range starting at an instant. */
    const first = (level: RecordTile, from: string) => printInstant(levelRuns(level, at(from), at(from))[0]!.from);
    // A month's events are at most 28 days long: one filed in September ends before 29 October, to the millisecond.
    assert.equal(first("month", "2026-10-28T23:59:59.999"), "2026-09-01T00:00:00.000");
    assert.equal(first("month", "2026-10-29T00:00:00.000"), "2026-10-01T00:00:00.000");
    assert.equal(first("month", "2026-10-31T12:00:00.000"), "2026-10-01T00:00:00.000");
    assert.equal(first("month", "2026-11-01T00:00:00.000"), "2026-10-01T00:00:00.000", "the next month's start is reached from October again");
    // No instant of a February of 28 days is 28 days into it.
    assert.equal(first("month", "2026-02-28T23:59:59.999"), "2026-01-01T00:00:00.000");
    assert.equal(first("month", "2028-02-29T00:00:00.000"), "2028-02-01T00:00:00.000", "a leap year's last day of February is");
    // A quarter's are at most 90 days long: the fourth quarter's own from 30 December.
    assert.equal(first("quarter", "2026-12-29T23:59:59.999"), "2026-07-01T00:00:00.000");
    assert.equal(first("quarter", "2026-12-30T00:00:00.000"), "2026-10-01T00:00:00.000");
    assert.equal(first("quarter", "2026-03-31T23:59:59.999"), "2025-10-01T00:00:00.000", "a first quarter of 90 days is always reached");
    // A year's are at most 365: a leap year's own on its last day, a common year's never.
    assert.equal(first("year", "2028-12-30T23:59:59.999"), "2027-01-01T00:00:00.000");
    assert.equal(first("year", "2028-12-31T00:00:00.000"), "2028-01-01T00:00:00.000");
    assert.equal(first("year", "2026-12-31T23:59:59.999"), "2025-01-01T00:00:00.000");
    // Every day and every week is its level's shortest tile: always a tile back.
    assert.equal(first("day", "2026-10-07T23:59:59.999"), "2026-10-06T00:00:00.000");
    assert.equal(first("week", "2026-10-11T23:59:59.999"), "2026-09-28T00:00:00.000");
    // Each level by its own length: late in October the month's run is October's, the week's still a week back.
    assert.deepEqual(levelRuns("week", at("2026-10-30T00:00:00.000"), at("2026-11-03T00:00:00.000")).map(run => [run.level, printInstant(run.from), printInstant(run.to)]), [
        ["week", "2026-10-19T00:00:00.000", "2026-11-09T00:00:00.000"],
        ["month", "2026-10-01T00:00:00.000", "2026-12-01T00:00:00.000"],
        ["quarter", "2026-07-01T00:00:00.000", "2027-01-01T00:00:00.000"],
        ["year", "2025-01-01T00:00:00.000", "2027-01-01T00:00:00.000"],
    ]);
});

/**
 * Where a series index declared at a tile files an event, as e3 does: once, at the finest level from the tile up whose
 * shortest tile holds its length, under that level's tile holding its start; past a year, under each year it touches.
 */
function filings(tile: RecordTile, start: Date, end: Date): { level: RecordTile; tile: Date }[] {
    const length = end.getTime() - start.getTime();
    for (const level of levelsOf(tile)) {
        if (length <= SHORTEST_TILE_MS[level]) return [{ level, tile: tileStart(level, start) }];
    }
    const out: { level: RecordTile; tile: Date }[] = [];
    for (let year = tileStart("year", start); year.getTime() < end.getTime(); year = tileNext("year", year)) out.push({ level: "year", tile: year });
    return out;
}

/** Whether an event overlaps `[from, to)`: an instant — an end at or before its start — where the range holds its start. */
function overlaps(start: Date, end: Date, from: Date, to: Date): boolean {
    if (to.getTime() <= from.getTime()) return false;
    if (end.getTime() <= start.getTime()) return start.getTime() >= from.getTime() && start.getTime() < to.getTime();
    return start.getTime() < to.getTime() && end.getTime() > from.getTime();
}

test("a range's runs hold every event that overlaps it, wherever e3 files it, and start no earlier than one can reach from", () => {
    const next = randomStream(1797);
    const pick = <T>(of: readonly T[]): T => of[Math.floor(next() * of.length)]!;
    /** Whether a run of the event's level holds one of the tiles it is filed under. */
    const held = (tile: RecordTile, start: Date, end: Date, from: Date, to: Date): boolean => {
        const runs = levelRuns(tile, from, to);
        return filings(tile, start, end).some(filed => {
            const run = runs.find(r => r.level === filed.level)!;
            return filed.tile.getTime() >= run.from.getTime() && filed.tile.getTime() < run.to.getTime();
        });
    };
    let overlapping = 0;
    // At random: events an hour to four years long and instants, ranges an hour to two years wide, around 2026.
    for (let n = 0; n < 20_000; n++) {
        const tile = pick(RECORD_TILES);
        const start = new Date(Date.UTC(2026, 0, 1) + Math.floor((next() - 0.5) * 1500 * DAY));
        const length = pick([0, -3_600_000, 3_600_000, Math.floor(next() * 3 * DAY), Math.floor(next() * 120 * DAY), Math.floor(next() * 1500 * DAY)]);
        const end = new Date(start.getTime() + length);
        const from = new Date(start.getTime() + Math.floor((next() - 0.5) * 800 * DAY));
        const to = new Date(from.getTime() + pick([3_600_000, Math.floor(next() * 40 * DAY), Math.floor(next() * 730 * DAY)]));
        if (!overlaps(start, end, from, to)) continue;
        overlapping++;
        assert.ok(held(tile, start, end, from, to), `${tile}: [${printInstant(start)}, ${printInstant(end)}) in [${printInstant(from)}, ${printInstant(to)})`);
    }
    assert.ok(overlapping > 4000, `events overlap their ranges: ${overlapping}`);
    // At each level's edge, to the millisecond: the longest event a level files, started in the last millisecond of a
    // tile, and a range starting where it ends, a millisecond either side of it.
    for (const level of RECORD_TILES) {
        for (let n = 0; n < 400; n++) {
            const boundary = tileStart(level, new Date(Date.UTC(2026, 0, 1) + Math.floor((next() - 0.5) * 3000 * DAY)));
            const start = new Date(boundary.getTime() - 1);
            const end = new Date(start.getTime() + SHORTEST_TILE_MS[level]);
            assert.deepEqual(filings(level, start, end), [{ level, tile: tileStart(level, start) }], `the ${level}'s longest event is filed at it, a tile before`);
            for (const off of [-2, -1, 0, 1]) {
                const from = new Date(end.getTime() + off);
                const to = new Date(from.getTime() + DAY);
                const run = levelRuns(level, from, to)[0]!;
                const reaches = overlaps(start, end, from, to);
                assert.equal(reaches, off < 0, `${level}: a range from ${off} ms of the event's end`);
                if (reaches) assert.ok(held(level, start, end, from, to), `${level}: the event reaching ${printInstant(from)} is held`);
                // Past the event's end nothing filed before the range's own tile reaches it: the run starts there, or later.
                if (off > 0) assert.ok(run.from.getTime() >= boundary.getTime(), `${level}: no tile before ${printInstant(boundary)} is read from ${printInstant(from)}`);
            }
        }
    }
});

test("a summary's run is its tiles from the one before the range to the one after it", () => {
    const run = (tile: RecordTile, from: string, to: string) => {
        const read = summaryRun(tile, at(from), at(to));
        return [printInstant(read.from), printInstant(read.to)];
    };
    assert.deepEqual(run("month", "2026-10-01T00:00:00.000", "2026-10-15T00:00:00.000"), ["2026-09-01T00:00:00.000", "2026-12-01T00:00:00.000"]);
    assert.deepEqual(run("week", "2026-10-05T00:00:00.000", "2026-10-19T00:00:00.000"), ["2026-09-28T00:00:00.000", "2026-10-26T00:00:00.000"]);
});

const indexType = ArrayType(RecordSliceIndexType);
const week = { key: "press", from: "start", to: "end", tile: variant("week", null), order: variant("key", null), copy: false };
const month = { ...week, tile: variant("month", null) };
const weekInTime = { ...week, order: variant("time", null) };
/** The record's totals a month, and a quarter: a summary with no key (#1732). */
const monthTotals = { from: "start", to: "end", tile: variant("month", null) };
const quarterTotals = { ...monthTotals, tile: variant("quarter", null) };
const plain = { interval: none, area: none, series: none, summary: none, entries: false };
// A generated index's fields are the row fields it is led by alone (#1432): its key's `on`.
const indexes = decodeBeast2For(indexType)(encodeBeast2For(indexType)([
    { name: "jobs_by_time", fields: [], sets: new Set(), structured: true, ...plain, interval: some({ from: "start", to: "end", optional: false }) },
    { name: "by_press", fields: ["press"], sets: new Set(), structured: false, ...plain },
    // The record's totals, listed first: a reader of a resource's summary passes them over.
    { name: "jobs_month", fields: [], sets: new Set(), structured: true, ...plain, summary: some(variant("totals", monthTotals)) },
    { name: "jobs_by_state_month", fields: ["state"], sets: new Set(), structured: true, ...plain, summary: some(variant("totals", monthTotals)) },
    { name: "jobs_by_crew_month", fields: ["crews"], sets: new Set(["crews"]), structured: true, ...plain, summary: some(variant("totals", monthTotals)) },
    { name: "jobs_quarter", fields: [], sets: new Set(), structured: true, ...plain, summary: some(variant("totals", quarterTotals)) },
    { name: "jobs_by_press_week", fields: [], sets: new Set(), structured: true, ...plain, series: some(week) },
    { name: "jobs_by_state_press_week", fields: ["state"], sets: new Set(), structured: true, ...plain, series: some(week) },
    { name: "jobs_by_crew_press_week", fields: ["crews"], sets: new Set(["crews"]), structured: true, ...plain, series: some(week) },
    { name: "jobs_by_press_month", fields: [], sets: new Set(), structured: true, ...plain, summary: some(variant("keyed", month)) },
    { name: "jobs_by_state_press_month", fields: ["state"], sets: new Set(), structured: true, ...plain, summary: some(variant("keyed", month)) },
    { name: "jobs_by_hall_week", fields: ["hall"], sets: new Set(), structured: true, ...plain, series: some(weekInTime) },
    { name: "jobs_by_state_hall_week", fields: ["state", "hall"], sets: new Set(), structured: true, ...plain, series: some(weekInTime) },
    { name: "jobs_by_week", fields: [], sets: new Set(), structured: true, ...plain, series: some(weekInTime) },
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

const weekRun = levelRuns("week", monday, at("2026-10-19T00:00:00.000"))[0]!;
const october = summaryRun("month", at("2026-10-01T00:00:00.000"), at("2026-10-15T00:00:00.000"));

test("a series cell is a range a key over its run, under each combination of the leading fields' chosen values, the key flattened", () => {
    assert.deepEqual(levelCellQueries(byName("jobs_by_press_week"), where([]), weekRun, presses), {
        queries: presses.map(press => variant("range", {
            from: [press, ".week", "2026-09-28T00:00:00.000"], to: [press, ".week", "2026-10-19T00:00:00.000"],
        })), residual: [],
    });
    const led = levelCellQueries(byName("jobs_by_state_press_week"), where([["state", values(".late", ".held")]]), weekRun, presses.slice(0, 2));
    assert.deepEqual(led.queries, [".late", ".held"].flatMap(state => presses.slice(0, 2).map(press => variant("range", {
        from: [state, press, ".week", "2026-09-28T00:00:00.000"], to: [state, press, ".week", "2026-10-19T00:00:00.000"],
    }))), "the keys inner, in the order given, the leading values one by one");
    const year = levelRuns("week", monday, at("2026-10-19T00:00:00.000"))[3]!;
    assert.deepEqual(levelCellQueries(byName("jobs_by_crew_press_week"), where([["crews", values('"C-1"')]]), year, presses.slice(0, 1)).queries,
        [variant("range", { from: ['"C-1"', presses[0]!, ".year", "2025-01-01T00:00:00.000"], to: ['"C-1"', presses[0]!, ".year", "2027-01-01T00:00:00.000"] })]);
});

test("a summary cell is a range a key over its tiles", () => {
    assert.deepEqual(summaryCellQueries(byName("jobs_by_press_month"), where([]), october, presses.slice(0, 1)), {
        queries: [variant("range", { from: [presses[0]!, "2026-09-01T00:00:00.000"], to: [presses[0]!, "2026-12-01T00:00:00.000"] })], residual: [],
    });
    assert.deepEqual(summaryCellQueries(byName("jobs_by_state_press_month"), where([["state", values(".late")]]), october, presses.slice(0, 2)).queries,
        presses.slice(0, 2).map(press => variant("range", { from: [".late", press, "2026-09-01T00:00:00.000"], to: [".late", press, "2026-12-01T00:00:00.000"] })));
});

test("a cell leaves to the reader every choice but its leading fields' and a range of its start, which the runs cover", () => {
    const series = byName("jobs_by_state_press_week");
    assert.deepEqual(levelCellQueries(series, where([["state", values(".late")], ["start", window]]), weekRun, presses).residual, []);
    assert.deepEqual(levelCellQueries(series, where([["state", values(".late")], ["start", window], ["customer", values('"Acme"')]]), weekRun, presses).residual,
        ["customer"]);
    assert.deepEqual(levelCellQueries(byName("jobs_by_press_week"), where([["state", values(".late")], ["start", values("2026-10-06T00:00:00.000")]]), weekRun, presses).residual,
        ["start", "state"], "exact starts and a field the index is not led by are the reader's");
});

test("a cell it cannot plan is refused, naming why", () => {
    const series = byName("jobs_by_state_press_week");
    assert.throws(() => levelCellQueries(series, where([]), weekRun, presses), /takes exact values of 'state', which leads it/);
    assert.throws(() => levelCellQueries(series, where([["state", variant("prefix", "la")]]), weekRun, presses), /takes exact values of 'state'/);
    assert.throws(() => levelCellQueries(byName("jobs_by_crew_press_week"), where([["crews", values('"C-1"', '"C-2"')]]), weekRun, presses),
        /takes one value of 'crews', which fans out over a Set/);
    assert.throws(() => levelCellQueries(series, where([["state", values(...Array.from({ length: MAX_RECORD_SLICE_RUNS + 1 }, (_, i) => `"s${i}"`))]]), weekRun, presses),
        /more than 64 searches a key/);
    assert.throws(() => levelCellQueries(byName("jobs_by_press_week"), where([]), { ...weekRun, from: at("2026-09-22T00:00:00.000") }, presses),
        /2026-09-22T00:00:00\.000 starts no week tile of 'jobs_by_press_week'/);
    assert.throws(() => levelCellQueries(byName("jobs_by_press_week"), where([]), levelRuns("day", monday, monday)[0]!, presses),
        /'jobs_by_press_week' files at week, month, quarter, year: no day run/);
    assert.throws(() => levelCellQueries(byName("jobs_by_press_month"), where([]), weekRun, presses), /'jobs_by_press_month' is none/);
    assert.throws(() => summaryCellQueries(byName("jobs_by_press_week"), where([]), october, presses), /'jobs_by_press_week' is none/);
    assert.throws(() => summaryCellQueries(byName("jobs_month"), where([]), october, presses),
        /'jobs_month' keeps the record's totals, under no key: its cells are a range of its tiles \(totalsCellQueries\)/);
    assert.throws(() => levelCellQueries(byName("by_press"), where([]), weekRun, presses), /'by_press' is none/);
});

test("the record's totals a tile are read as one range of whole tiles under each combination of the leading fields' chosen values (#1732)", () => {
    const years = totalsRun("month", at("2026-01-01T00:00:00.000"), at("2028-01-01T00:00:00.000"));
    assert.deepEqual([printInstant(years.from), printInstant(years.to)], ["2026-01-01T00:00:00.000", "2028-01-01T00:00:00.000"], "whole years are whole months");
    const partial = totalsRun("quarter", at("2026-02-10T08:00:00.000"), at("2026-05-02T00:00:00.000"));
    assert.deepEqual([printInstant(partial.from), printInstant(partial.to)], ["2026-01-01T00:00:00.000", "2026-07-01T00:00:00.000"],
        "a range's run is the whole tiles it touches, no more");
    assert.deepEqual(totalsCellQueries(byName("jobs_month"), where([["start", window]]), years), {
        queries: [variant("range", { from: ["2026-01-01T00:00:00.000"], to: ["2028-01-01T00:00:00.000"] })], residual: [],
    }, "one range: the window's own choice of the start is none the totals are read under");
    assert.deepEqual(totalsCellQueries(byName("jobs_by_state_month"), where([["state", values(".late", ".held")]]), years).queries,
        [".late", ".held"].map(state => variant("range", { from: [state, "2026-01-01T00:00:00.000"], to: [state, "2028-01-01T00:00:00.000"] })),
        "a range under each state chosen, the leading values one by one");
    assert.deepEqual(totalsCellQueries(byName("jobs_month"), where([["state", values(".late")]]), years).residual, ["state"],
        "a choice it is not led by is left: such totals hold more than the narrowing");
    assert.throws(() => totalsCellQueries(byName("jobs_month"), where([]), { from: at("2026-01-15T00:00:00.000"), to: years.to }),
        /2026-01-15T00:00:00\.000 starts no month tile of 'jobs_month'/);
    assert.throws(() => totalsCellQueries(byName("jobs_by_state_month"), where([]), years), /takes exact values of 'state', which leads it/);
    assert.throws(() => totalsCellQueries(byName("jobs_by_press_month"), where([]), years),
        /'jobs_by_press_month' keeps a resource's totals, filed by key: the record's totals are a summary with no key/);
    assert.throws(() => totalsCellQueries(byName("by_press"), where([]), years), /'by_press' keeps no totals/);
});

test("the record's totals at a tile are read through those led by the most of the narrowing's exact choices that leave none of it but the window (#1732)", () => {
    assert.equal(totalsIndexFor(indexes, where([]), "month")?.name, "jobs_month", "under no choice, the totals led by none");
    assert.equal(totalsIndexFor(indexes, where([["start", window]]), "month")?.name, "jobs_month", "the window's own range is no choice they answer");
    assert.equal(totalsIndexFor(indexes, where([["state", values(".late")], ["start", window]]), "month")?.name, "jobs_by_state_month", "led by the state chosen");
    assert.equal(totalsIndexFor(indexes, where([["crews", values('"C-1"')]]), "month")?.name, "jobs_by_crew_month");
    assert.equal(totalsIndexFor(indexes, where([["crews", values('"C-1"', '"C-2"')]]), "month"), undefined,
        "a Set's field chosen twice would count an event on both twice, and the totals led by none leave it: none serves");
    assert.equal(totalsIndexFor(indexes, where([["customer", values('"Acme"')]]), "month"), undefined, "a choice no totals are led by: none serves");
    const many = Array.from({ length: MAX_RECORD_SLICE_RUNS + 1 }, (_, i) => `"s${i}"`);
    assert.equal(totalsIndexFor(indexes, where([["state", values(...many)]]), "month"), undefined, "more states than a cell takes searches: none serves");
    assert.equal(totalsIndexFor(indexes, where([["state", values(...many.slice(0, MAX_RECORD_SLICE_RUNS))]]), "month")?.name, "jobs_by_state_month",
        "as many as it takes: the totals led by the state");
    assert.equal(totalsIndexFor(indexes, where([]), "quarter")?.name, "jobs_quarter");
    assert.equal(totalsIndexFor(indexes, where([["state", values(".late")]]), "quarter"), undefined, "the quarter's totals are led by none, and leave the state");
    assert.equal(totalsIndexFor(indexes, where([]), "year"), undefined, "no totals at the tile");
    assert.deepEqual(totalsOf(byName("jobs_month")), monthTotals);
    assert.equal(totalsOf(byName("jobs_by_press_month")), undefined, "a summary by key keeps a resource's totals");
    assert.equal(tilingOf(byName("jobs_month")), undefined, "the record's totals are no resource's tiling");
    assert.deepEqual(["jobs_month", "jobs_by_press_month", "jobs_by_press_week", "by_press", "jobs_by_time"].map(name => isTiledIndex(byName(name))),
        [true, true, true, false, false], "a series or a summary — the record's totals among them — files events by time, and offers the rail nothing");
});

test("a cell of a series index in time order is a range a tile, from its first key through its last (#1710)", () => {
    // A fortnight from Monday 5 October: its two weeks, and the one before them.
    const mondays = ["2026-09-28", "2026-10-05", "2026-10-12"].map(day => `${day}T00:00:00.000`);
    const first = presses[0]!;
    const last = presses[2]!;
    assert.deepEqual(inTimeCellQueries(byName("jobs_by_week"), where([]), weekRun, first, last), {
        queries: mondays.map(tile => variant("range", { from: [".week", tile, first], to: [".week", tile, last, "true"] })), residual: [],
    }, "a tile each in the run's order, its end past the last key's entries");
    const led = inTimeCellQueries(byName("jobs_by_hall_week"), where([["hall", values('"H-01"', '"H-02"')]]), weekRun, first, last);
    assert.deepEqual(led.queries, ['"H-01"', '"H-02"'].flatMap(hall => mondays.map(tile => variant("range", {
        from: [hall, ".week", tile, first], to: [hall, ".week", tile, last, "true"],
    }))), "under each of the leading values, the tiles inner");
    // One key is a run of itself: from it through it.
    assert.deepEqual(inTimeCellQueries(byName("jobs_by_week"), where([]), { ...weekRun, to: tileNext("week", weekRun.from) }, first, first).queries,
        [variant("range", { from: [".week", mondays[0]!, first], to: [".week", mondays[0]!, first, "true"] })]);
    const year = levelRuns("week", monday, at("2026-10-19T00:00:00.000"))[3]!;
    assert.deepEqual(inTimeCellQueries(byName("jobs_by_week"), where([]), year, first, last).queries,
        ["2025", "2026"].map(y => variant("range", {
            from: [".year", `${y}-01-01T00:00:00.000`, first], to: [".year", `${y}-01-01T00:00:00.000`, last, "true"],
        })), "a year's tiles of a week's index, as its runs name them");
    // What the narrowing chooses beside the leading fields and the window is the reader's, as a key-ordered cell's is.
    assert.deepEqual(inTimeCellQueries(byName("jobs_by_hall_week"), where([["hall", values('"H-01"')], ["start", window], ["customer", values('"Acme"')]]),
        weekRun, first, last).residual, ["customer"]);
});

test("a cell in time order it cannot plan is refused, and a cell is planned by its index's own order (#1710)", () => {
    const [first, last] = [presses[0]!, presses[2]!];
    assert.throws(() => inTimeCellQueries(byName("jobs_by_press_week"), where([]), weekRun, first, last),
        /'jobs_by_press_week' is a series index in key order, a key's events together: its cells are a range a key \(levelCellQueries\)/);
    assert.throws(() => levelCellQueries(byName("jobs_by_week"), where([]), weekRun, presses),
        /'jobs_by_week' is a series index in time order, a tile's events together: its cells are a range a tile \(inTimeCellQueries\)/);
    assert.throws(() => inTimeCellQueries(byName("jobs_by_hall_week"), where([]), weekRun, first, last), /takes exact values of 'hall', which leads it/);
    assert.throws(() => inTimeCellQueries(byName("jobs_by_week"), where([]), { ...weekRun, to: at("2026-10-27T00:00:00.000") }, first, last),
        /2026-10-27T00:00:00\.000 starts no week tile of 'jobs_by_week'/);
    assert.throws(() => inTimeCellQueries(byName("jobs_by_week"), where([]), levelRuns("day", monday, monday)[0]!, first, last),
        /'jobs_by_week' files at week, month, quarter, year: no day run/);
    assert.throws(() => inTimeCellQueries(byName("jobs_by_press_month"), where([]), weekRun, first, last), /'jobs_by_press_month' is none/);
});

test("a block of keys is read through the series index led by the most of its narrowing, one in time order under the group it stands in (#1710)", () => {
    const hall = [() => '"H-01"'];
    // Under a group: the index in time order led by it, its leading field filled with the group.
    const grouped = seriesIndexFor(indexes, where([]), hall)!;
    assert.equal(grouped.index.name, "jobs_by_hall_week");
    assert.ok(sameWhere(grouped.where, where([["hall", values('"H-01"')]])));
    // Beside the rail's own choice of a leading field: the index led by both, the one the narrowing leaves filled.
    const narrowed = seriesIndexFor(indexes, where([["state", values(".late")]]), hall)!;
    assert.equal(narrowed.index.name, "jobs_by_state_hall_week");
    assert.ok(sameWhere(narrowed.where, where([["hall", values('"H-01"')], ["state", values(".late")]])), "the narrowing's own choice beside the group");
    // Under no group: no index is filled, and the one led by nothing listed first reads it, as `tileIndexFor` picks it.
    const flat = seriesIndexFor(indexes, where([]), [])!;
    assert.equal(flat.index.name, "jobs_by_press_week");
    assert.equal(flat.index.name, tileIndexFor(indexes, where([]), "series")?.name);
    assert.ok(sameWhere(flat.where, where([])));
    assert.equal(seriesIndexFor(indexes, where([["state", values(".late")]]), [])?.index.name, "jobs_by_state_press_week");
    // The rail's own choice of the group's field stands: nothing is left to fill.
    const chosen = seriesIndexFor(indexes, where([["hall", values('"H-07"')]]), hall)!;
    assert.equal(chosen.index.name, "jobs_by_hall_week");
    assert.ok(sameWhere(chosen.where, where([["hall", values('"H-07"')]])));
    // A block two rows deep: the index led by two fields is filled both, outermost first; with none led by as many, no
    // index in time order is filled, and one in key order reads the block.
    const deep = seriesIndexFor(indexes, where([]), [() => '"S-1"', () => '"H-01"'])!;
    assert.equal(deep.index.name, "jobs_by_state_hall_week");
    assert.ok(sameWhere(deep.where, where([["hall", values('"H-01"')], ["state", values('"S-1"')]])));
    assert.equal(seriesIndexFor(indexes.filter(index => index.fields.length < 2), where([]), [() => '"S-1"', () => '"H-01"'])?.index.name, "jobs_by_press_week");
    // Each row is given as the field it fills holds it; a field that can hold no such row's key fills no index.
    const typed = seriesIndexFor(indexes, where([]), [field => (field === "hall" ? '.some "H-01"' : undefined)])!;
    assert.ok(sameWhere(typed.where, where([["hall", values('.some "H-01"')]])), "the literal its own field gives");
    assert.equal(seriesIndexFor(indexes, where([]), [() => undefined])?.index.name, "jobs_by_press_week", "no field holds the row's key: one in key order reads the block");
    // A leading field before the group's is the narrowing's alone: left unchosen, its index serves none, though the
    // group's own field is chosen.
    assert.equal(seriesIndexFor(indexes.filter(index => index.name === "jobs_by_state_hall_week"), where([["hall", values('"H-07"')]]), hall), undefined);
    // With indexes in time order alone, a block under no group is read through the one led by nothing, and one led by
    // a group nothing fills serves none.
    const inTime = indexes.filter(index => index.series.type === "some" && index.series.value.order.type === "time");
    assert.equal(seriesIndexFor(inTime, where([]), [])?.index.name, "jobs_by_week");
    assert.equal(seriesIndexFor(inTime.filter(index => index.fields.length > 0), where([]), []), undefined);
    assert.equal(seriesIndexFor(indexes.filter(index => index.series.type !== "some"), where([]), hall), undefined, "a summary index is no series index");
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
    const tiled = indexes.filter(index => isTiledIndex(index));
    assert.ok(tiled.some(index => totalsOf(index) !== undefined), "the record's totals among them (#1732)");
    assert.equal(planRecordSlice(tiled, where([["press", values('"P-1005"')]]), "primary"), null);
    assert.equal(planRecordSlice(tiled, where([["state", values(".late")]]), "primary"), null);
    assert.equal(planRecordSlice(tiled, where([["crews", values('"C-1"')]]), "primary"), null, "nor the record's totals, led by a field the rail chooses");
    assert.equal(recordChoiceWhere({ indexes: tiled, scope: new Map() }, where([]), "state", values(".late")), null, "no choice is offered through one");
});
