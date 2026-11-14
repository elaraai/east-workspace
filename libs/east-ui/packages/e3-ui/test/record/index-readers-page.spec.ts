/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A body's reader of each kind of index, held to the page's (e3#1618, rule
 * 9). The runs an index answers a window with are written twice by necessity:
 * as the TypeScript that makes a page's searches (east-ui's `intervalQueries`,
 * `levelRuns` and `levelCellQueries`, `summaryRun` and `summaryCellQueries`,
 * `areaQueries`) and as the East a task or a function runs (`@elaraai/e3`'s
 * `e3.index(def).read`). Here the same seeded records and windows go through
 * both, over the entries each index's own build program files:
 *
 * - an interval's searches hold exactly the rows the body's `overlapping`
 *   gives, each once;
 * - a series' and an area's searches hold more than a window, which a page's
 *   reader tests as it draws: what they hold that the window does is exactly
 *   what the body's `events` and `within` give;
 * - a summary's tiles that overlap the window are the body's `totals`.
 *
 * A search is answered as e3 answers one (e3-api-server's `key-search.ts`): a
 * `fields` search by the index key's own leading fields, and a `range` by the
 * leading leaves of the collection's flattened key, from one bound up to
 * another.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType,
    compareFor, compareKeyToBoundFor, decodeBeast2For, encodeBeast2For, equalFor, keyLeaves, none, parseFor, printFor, some, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import e3, { builtIndex, indexBuildProgram, summaryMergeProgram, type RecordDef, type RecordIndexDef } from "@elaraai/e3";
import { RecordSummaryTotalsType, type RecordSummaryTotals } from "@elaraai/e3-types";
import {
    RecordSliceIndexType, areaQueries, intervalQueries, levelCellQueries, levelRuns, recordOnPrinter, summaryCellQueries, summaryRun, tileNext,
} from "@elaraai/east-ui/internal";

type Index = ValueTypeOf<typeof RecordSliceIndexType>;
type Query = ReturnType<typeof areaQueries>[number];

// ── The records, and their rows ──────────────────────────────────────────────

/** A print job: its press and state, and when it runs, or not yet. */
const JobRow = StructType({ press: StringType, state: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), title: StringType });
const JobsType = DictType(StringType, JobRow);
type Job = ValueTypeOf<typeof JobRow>;
const jobs = e3.record("jobs", JobsType, {
    initial: new Map(),
    indexes: (index) => ({
        in_time: index.interval({ from: "start", to: "end" }),
        in_time_by_state: index.interval({ on: ["state"], from: "start", to: "end" }),
        press_weeks: index.series({ key: "press", from: "start", to: "end", tile: "week" }),
        press_weeks_by_state: index.series({ on: ["state"], key: "press", from: "start", to: "end", tile: "week" }),
        press_months: index.summary({ key: "press", from: "start", to: "end", tile: "month" }),
    }),
});

/** A rack on a floor: its box's centre, or none yet, and its size, in metres. */
const RackRow = StructType({ zone: StringType, x: OptionType(FloatType), y: OptionType(FloatType), w: FloatType, h: FloatType });
const RacksType = DictType(StringType, RackRow);
type Rack = ValueTypeOf<typeof RackRow>;
const racks = e3.record("racks", RacksType, {
    initial: new Map(),
    indexes: (index) => ({
        by_area: index.area({ x: "x", y: "y", width: "w", height: "h", at: "centre", cell: 0.01 }),
        by_zone_area: index.area({ on: ["zone"], x: "x", y: "y", width: "w", height: "h", at: "centre", cell: 0.01 }),
    }),
});

const keyOrder = compareFor(StringType);
const instantOrder = compareFor(DateTimeType);
const readInstant = parseFor(DateTimeType);
const printInstant = printFor(DateTimeType);
const printString = printFor(StringType);
const printStart = printFor(OptionType(DateTimeType));

/** An instant written as East prints one, read by East's parser. */
function at(text: string): Date {
    const read = readInstant(text);
    assert.ok(read.success, text);
    return read.value;
}
/** The instant some milliseconds after another, made by East. */
const later = East.compile(East.function([DateTimeType, IntegerType], DateTimeType, (_$, from, ms) =>
    East.DateTime.fromEpochMilliseconds(from.toEpochMilliseconds().add(ms))), []);

/** A seeded stream of numbers in [0, 1) (mulberry32), so a failure names a case that comes again. */
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

const HOUR = 3_600_000n;
const DAY = 24n * HOUR;
const PRESSES = ["P-1", "P-2", "P-3"];
const STATES = ["confirmed", "proposed"];
const ZONES = ["inbound", "storage"];
const OCT_5 = at("2026-10-05T00:00:00.000");

/** The jobs: an hour to three years long, around October 2026; instants, ends before starts, and some not yet scheduled. */
function seededJobs(): SortedMap<string, Job> {
    const draw = stream(1618);
    const rows = new SortedMap<string, Job>(undefined, keyOrder);
    const job = (n: number, start: Date | undefined, end: Date | undefined): Job => decodeBeast2For(JobRow)(encodeBeast2For(JobRow)({
        press: PRESSES[n % 3]!, state: STATES[n % 2]!, start: start === undefined ? none : some(start), end: end === undefined ? none : some(end), title: `Job ${n}`,
    }));
    for (let n = 0; n < 240; n++) {
        const start = later(OCT_5, BigInt(Math.floor((draw() - 0.5) * 800)) * DAY + BigInt(Math.floor(draw() * 24)) * HOUR);
        const scale = n % 20 === 7 ? 1100 : n % 8 === 3 ? 200 : 12;
        const end = later(start, HOUR + BigInt(Math.floor(draw() ** 2 * scale * 24)) * HOUR);
        const key = `W-${String(n).padStart(4, "0")}`;
        if (n % 10 === 0) rows.set(key, job(n, undefined, undefined));
        else if (n % 10 === 1) rows.set(key, job(n, start, undefined));
        else if (n % 10 === 2) rows.set(key, job(n, start, later(start, -HOUR)));
        else rows.set(key, job(n, start, end));
    }
    rows.set("E-ends-at-from", job(0, at("2026-10-05T00:00:00.000"), at("2026-10-12T00:00:00.000")));
    rows.set("E-instant-at-from", job(0, at("2026-10-12T00:00:00.000"), undefined));
    rows.set("E-instant-at-to", job(0, at("2026-10-19T00:00:00.000"), undefined));
    rows.set("E-past-a-year", job(0, at("2025-11-20T06:00:00.000"), at("2027-02-10T18:00:00.000")));
    return rows;
}

/** The racks: across a floor of a hundred metres by sixty; some not yet placed, one outside the index's domain. */
function seededRacks(): SortedMap<string, Rack> {
    const draw = stream(1385);
    const rows = new SortedMap<string, Rack>(undefined, keyOrder);
    const rack = (n: number, x: number | undefined, y: number | undefined, size: number): Rack => decodeBeast2For(RackRow)(encodeBeast2For(RackRow)({
        zone: ZONES[n % 2]!, x: x === undefined ? none : some(x), y: y === undefined ? none : some(y), w: size, h: size / 2,
    }));
    for (let n = 0; n < 400; n++) {
        const size = n % 25 === 0 ? 5 + draw() * 25 : 0.2 + draw() * 2;
        rows.set(`R-${String(n).padStart(4, "0")}`, n % 40 === 13 ? rack(n, undefined, undefined, size) : rack(n, draw() * 100, draw() * 60, size));
    }
    rows.set("E-outside-the-domain", rack(0, 5_000_000, 10, 1));
    return rows;
}

const JOBS = seededJobs();
const RACKS = seededRacks();

/** The windows of time: the week of the edges, an hour, two years, and seeded ones. */
const WINDOWS: { from: Date; to: Date }[] = (() => {
    const draw = stream(55);
    const out = [
        { from: at("2026-10-12T00:00:00.000"), to: at("2026-10-19T00:00:00.000") },
        { from: at("2026-10-12T09:00:00.000"), to: at("2026-10-12T10:00:00.000") },
        { from: at("2025-06-01T00:00:00.000"), to: at("2027-06-01T00:00:00.000") },
    ];
    for (let n = 0; n < 30; n++) {
        const from = later(OCT_5, BigInt(Math.floor((draw() - 0.5) * 900)) * DAY + BigInt(Math.floor(draw() * 24)) * HOUR);
        out.push({ from, to: later(from, n % 3 === 0 ? HOUR * BigInt(1 + Math.floor(draw() * 30)) : DAY * BigInt(1 + Math.floor(draw() ** 2 * 400))) });
    }
    return out;
})();

/** The windows of the floor: a room, the floor, and seeded ones. */
const BOXES: { x: number; y: number; width: number; height: number }[] = (() => {
    const draw = stream(266);
    const out = [{ x: 40, y: 20, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 60 }, { x: 4_999_990, y: 0, width: 20, height: 20 }];
    for (let n = 0; n < 20; n++) {
        const side = n % 4 === 0 ? 0.5 + draw() * 2 : 2 + draw() ** 2 * 60;
        out.push({ x: draw() * 110 - 5, y: draw() * 70 - 5, width: side, height: side * (0.3 + draw()) });
    }
    return out;
})();

// ── An index's entries, and a search of them as e3 answers one ───────────────

/** An index as its record's state holds it: its entries in order, and its key's types. */
interface Held {
    readonly ik: EastType;
    readonly entryKey: EastType;
    readonly entries: readonly [{ ik: Record<string, unknown>; k: unknown }, unknown][];
    /** The entries as a compiled function takes them. */
    readonly dict: never;
}

/** The entries an index's own build program files for some rows, a summary's summed by its merge. */
function heldOf(rec: RecordDef, declared: RecordIndexDef, rows: unknown): Held {
    const def = builtIndex(rec, declared);
    const summary = def.summary !== undefined;
    const entryKey = StructType({ ik: def.keyType, k: summary ? NullType : (rec.type as EastType & { key: EastType }).key });
    const entries = new SortedMap<unknown, unknown>(undefined, compareFor(entryKey) as never);
    const merge = summary ? summaryMergeProgram(def).compile([]) as (entry: unknown, a: RecordSummaryTotals, b: RecordSummaryTotals) => RecordSummaryTotals : undefined;
    const build = indexBuildProgram(rec.type, def).compile([]) as (piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
    build(rows, (entry, value) => {
        const before = entries.get(entry);
        entries.set(entry, before === undefined || merge === undefined ? value : merge(entry, before as RecordSummaryTotals, value as RecordSummaryTotals));
        return null;
    });
    return { ik: def.keyType, entryKey, entries: [...entries] as Held["entries"], dict: entries as never };
}

/** The entries a search holds, as e3 answers one (`key-search.ts`). */
function searched(index: Held, query: Query): Held["entries"] {
    if (query.type === "range") {
        // A range bounds the collection's flattened key, `{ ik, k }`, by its leading leaves.
        const leaves = keyLeaves(index.entryKey);
        const bound = (literals: readonly string[]) => literals.map((literal, i) => {
            const parsed = parseFor(leaves[i]!.type)(literal);
            assert.ok(parsed.success, `${literal} is a leaf of the key`);
            return parsed.value;
        });
        const from = bound(query.value.from);
        const to = bound(query.value.to);
        const atFrom = compareKeyToBoundFor(leaves, from.length);
        const atTo = compareKeyToBoundFor(leaves, to.length);
        return index.entries.filter(([entry]) => atFrom(entry, from) >= 0 && atTo(entry, to) < 0);
    }
    assert.equal(query.type, "fields", "a page's search is a range, or exact leading fields");
    assert.equal(query.value.prefix.type, "none");
    // Exact leading fields of the index key, `ik`.
    const fields = (index.ik as StructType<Record<string, EastType>>).fields;
    const names = Object.keys(fields).slice(0, query.value.values.length);
    const values = names.map((name, i) => {
        const parsed = parseFor(fields[name]!)(query.value.values[i]!);
        assert.ok(parsed.success, `${query.value.values[i]} is the key's '${name}'`);
        return parsed.value;
    });
    return index.entries.filter(([entry]) => names.every((name, i) => equalFor(fields[name]!)(entry.ik[name], values[i])));
}

/** The row keys of some entries, each once, in key order; fails where a row is held twice and `once` says none is. */
function keysOf(entries: Held["entries"], once: string | undefined): string[] {
    const keys = entries.map(([entry]) => entry.k as string);
    if (once !== undefined) assert.equal(new Set(keys).size, keys.length, `${once}: the page's searches hold a row once`);
    return [...new Set(keys)].sort(keyOrder);
}

/** A page's index metadata, as `Data.bindPaged` gives a record Slice one. */
function pageIndex(name: string, def: RecordIndexDef): Index {
    const tiling = (t: NonNullable<RecordIndexDef["series"]>) => ({ key: t.key, from: t.from, to: t.to, tile: variant(t.tile, null) });
    return decodeBeast2For(RecordSliceIndexType)(encodeBeast2For(RecordSliceIndexType)({
        name, fields: [...(def.on ?? [])], sets: new Set(), structured: true, interval: none, area: none,
        series: def.series === undefined ? none : some(tiling(def.series)),
        summary: def.summary === undefined ? none : some(tiling(def.summary)),
        entries: false,
    }));
}

/** Whether a job overlaps `[from, to)`, by the interval index's edges: the plain test a page's reader draws by. */
function overlaps(job: Job, from: Date, to: Date): boolean {
    if (job.start.type === "none" || instantOrder(from, to) >= 0) return false;
    const start = job.start.value;
    const end = job.end.type === "some" ? job.end.value : start;
    if (instantOrder(end, start) <= 0) return instantOrder(start, from) >= 0 && instantOrder(start, to) < 0;
    return instantOrder(start, to) < 0 && instantOrder(end, from) > 0;
}

const window = (w: { from: Date; to: Date }): string => `[${printInstant(w.from)}, ${printInstant(w.to)})`;
const Keys = DictType(StringType, NullType);
const keysIn = (rows: ReadonlyMap<string, unknown>): string[] => [...rows.keys()].sort(keyOrder);

// ── Each kind, through both ──────────────────────────────────────────────────

test("an interval index: the page's start range and carry-in ranges hold exactly the rows the body's `overlapping` gives, each once", () => {
    const inTime = e3.index(jobs.indexes.in_time);
    const body = East.compile(East.function([inTime.type, DateTimeType, DateTimeType], Keys, ($, entries, from, to) =>
        inTime.read(entries).overlapping({ from, to }).collect($)), []);
    const held = heldOf(jobs, jobs.indexes.in_time, JOBS);
    const unled = recordOnPrinter(StructType({}));
    let rows = 0;
    for (const w of WINDOWS) {
        const choice = variant("range", { from: printStart(some(w.from)), to: printStart(some(w.to)) });
        const queries = intervalQueries([], choice, { from: "start", to: "end", optional: true }, unled);
        assert.ok(queries.length <= 55, "one start range and at most 54 carried in");
        const page = keysOf(queries.flatMap((query) => searched(held, query)), window(w));
        rows += page.length;
        assert.deepEqual(keysIn(body(held.dict, w.from, w.to)), page, `the jobs in ${window(w)}`);
    }
    assert.ok(rows > 500, `the windows hold jobs to read: ${rows}`);

    // Led by a state: each read takes it exactly
    const byState = e3.index(jobs.indexes.in_time_by_state);
    const bodyIn = East.compile(East.function([byState.type, StringType, DateTimeType, DateTimeType], Keys, ($, entries, state, from, to) =>
        byState.read(entries).overlapping({ on: { state }, from, to }).collect($)), []);
    const heldByState = heldOf(jobs, jobs.indexes.in_time_by_state, JOBS);
    const led = recordOnPrinter(StructType({ state: StringType }));
    for (const w of WINDOWS.slice(0, 10)) {
        for (const state of STATES) {
            const choice = variant("range", { from: printStart(some(w.from)), to: printStart(some(w.to)) });
            const queries = intervalQueries([printString(state)], choice, { from: "start", to: "end", optional: true }, led);
            assert.deepEqual(keysIn(bodyIn(heldByState.dict, state, w.from, w.to)), keysOf(queries.flatMap((query) => searched(heldByState, query)), window(w)),
                `the ${state} jobs in ${window(w)}`);
        }
    }

    // The backlog: the page's Unset, the starts under none
    const unset = East.compile(East.function([inTime.type], Keys, ($, entries) => inTime.read(entries).unset().collect($)), []);
    const backlog = intervalQueries([], variant("values", [printStart(none)]), { from: "start", to: "end", optional: true }, unled);
    assert.deepEqual(keysIn(unset(held.dict)), keysOf(backlog.flatMap((query) => searched(held, query)), "the backlog"));
});

test("a series index: of what the page's run a level holds, the events that overlap the window are exactly the body's `events`, each once", () => {
    const cases = [
        { name: "press_weeks" as const, state: undefined as string | undefined },
        { name: "press_weeks_by_state" as const, state: "confirmed" },
    ];
    for (const { name, state } of cases) {
        const def = jobs.indexes[name];
        const input = e3.index(def);
        const body = East.compile(East.function([input.type as EastType, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, press, from, to) =>
            (input.read(entries as never) as unknown as { events(w: object): { collect(b: unknown): never } })
                .events({ ...(state !== undefined && { on: { state } }), key: press, from, to }).collect($)), []);
        const held = heldOf(jobs, def, JOBS);
        const index = pageIndex(name, def);
        const where = new Map(state === undefined ? [] : [["state", variant("values", [printString(state)])] as const]);
        let more = 0;
        for (const w of WINDOWS) {
            for (const press of PRESSES) {
                // The page reads a run a level, two tiles before the window's first and one after its last
                const runs = levelRuns("week", w.from, w.to);
                const cells = runs.flatMap((run) => levelCellQueries(index, where as never, run, [printString(press)]).queries.flatMap((query) => searched(held, query)));
                const inWindow = cells.filter(([, row]) => overlaps(row as Job, w.from, w.to));
                more += cells.length - inWindow.length;
                const given = body(held.dict, press, w.from, w.to) as ReadonlyMap<string, Job>;
                assert.deepEqual(keysIn(given), keysOf(inWindow, undefined), `the ${state ?? ""} jobs on ${press} in ${window(w)}`);
                for (const [entry, row] of inWindow) assert.ok(equalFor(JobRow)(given.get(entry.k as string)!, row as Job), "each with the row the index carries");
            }
        }
        assert.ok(more > 100, `the page's runs hold more than the windows do, which its reader tests: ${more}`);
    }
});

test("a summary index: the tiles of the page's run that overlap the window are the body's `totals`", () => {
    const months = e3.index(jobs.indexes.press_months);
    const Totals = DictType(DateTimeType, RecordSummaryTotalsType);
    const body = East.compile(East.function([months.type, StringType, DateTimeType, DateTimeType], Totals, ($, entries, press, from, to) =>
        months.read(entries).totals({ key: press, from, to }).collect($)), []);
    const held = heldOf(jobs, jobs.indexes.press_months, JOBS);
    const index = pageIndex("press_months", jobs.indexes.press_months);
    let tiles = 0;
    for (const w of WINDOWS) {
        for (const press of PRESSES) {
            // The page reads a tile before the window's first and one after its last
            const run = summaryRun("month", w.from, w.to);
            const cell = summaryCellQueries(index, new Map(), run, [printString(press)]).queries.flatMap((query) => searched(held, query));
            const expected = new SortedMap<Date, RecordSummaryTotals>(undefined, instantOrder);
            for (const [entry, totals] of cell) {
                const tile = entry.ik.tile as Date;
                if (instantOrder(tile, w.to) < 0 && instantOrder(tileNext("month", tile), w.from) > 0) expected.set(tile, totals as RecordSummaryTotals);
            }
            tiles += expected.size;
            assert.ok(equalFor(Totals)(body(held.dict, press, w.from, w.to), expected), `the months of ${press} in ${window(w)}`);
        }
    }
    assert.ok(tiles > 100, `the windows hold tiles to read: ${tiles}`);
});

test("an area index: of what the page's searches of a viewport hold, the rows whose box meets it are exactly the body's `within`, each once", () => {
    /** Whether a rack's box, by its centre, meets a window, its edges included. */
    const meets = East.compile(East.function([RackRow, FloatType, FloatType, FloatType, FloatType], BooleanType, ($, rack, x, y, width, height) => {
        $.match(rack.x, {
            some: ($, cx) => {
                $.match(rack.y, {
                    some: ($, cy) => {
                        $.return(East.lessEqual(cx.subtract(rack.w.divide(2.0)), x.add(width)).and(() => East.greaterEqual(cx.add(rack.w.divide(2.0)), x))
                            .and(() => East.lessEqual(cy.subtract(rack.h.divide(2.0)), y.add(height))).and(() => East.greaterEqual(cy.add(rack.h.divide(2.0)), y)));
                    },
                });
            },
        });
        return false;
    }), []);
    const cases = [
        { def: racks.indexes.by_area, zone: undefined as string | undefined, printOn: recordOnPrinter(StructType({})) },
        { def: racks.indexes.by_zone_area, zone: "storage", printOn: recordOnPrinter(StructType({ zone: StringType })) },
    ];
    for (const { def, zone, printOn } of cases) {
        const input = e3.index(def);
        const body = East.compile(East.function([input.type as EastType, FloatType, FloatType, FloatType, FloatType], RacksType, ($, entries, x, y, width, height) =>
            (input.read(entries as never) as unknown as { within(w: object): { collect(b: unknown): never } })
                .within({ ...(zone !== undefined && { on: { zone } }), x, y, width, height }).collect($)), []);
        const held = heldOf(racks, def, RACKS);
        let more = 0;
        let rows = 0;
        for (const box of BOXES) {
            const queries = areaQueries(zone === undefined ? [] : [printString(zone)], { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height }, 2 ** -7, printOn);
            assert.ok(queries.length <= 266, "at most 266 searches a combination");
            const page = queries.flatMap((query) => searched(held, query));
            const inBox = page.filter(([, row]) => meets(row as Rack, box.x, box.y, box.width, box.height));
            more += page.length - inBox.length;
            rows += inBox.length;
            assert.deepEqual(keysIn(body(held.dict, box.x, box.y, box.width, box.height) as ReadonlyMap<string, Rack>), keysOf(inBox, `${box.width} by ${box.height} at ${box.x}, ${box.y}`),
                `the ${zone ?? ""} racks in ${box.width} by ${box.height} at ${box.x}, ${box.y}`);
        }
        assert.ok(rows > 300 && more > 50, `the windows hold racks, and the page's searches more than they do: ${rows}, ${more}`);
    }
});
