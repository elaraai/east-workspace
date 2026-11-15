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
 * - a summary's tiles that overlap the window are the body's `totals`;
 * - a nested series index's runs of a node are read as a series' and a
 *   summary's are, a run a level and a run of tiles (e3-ui-components'
 *   `plan/root/nested.ts`): what they hold that the window does is exactly the
 *   body's `items`, `subtree`, `totals` and `subtotals`.
 *
 * A search is answered as e3 answers one (e3-api-server's `key-search.ts`): a
 * `fields` search by the index key's own leading fields, and a `range` by the
 * leading leaves of the collection's flattened key, from one bound up to
 * another.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SortedMap, SortedSet, StringType, StructType,
    compareFor, compareKeyToBoundFor, decodeBeast2For, encodeBeast2For, equalFor, keyLeaves, none, parseFor, printFor, some, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import e3, { NestedUnderType, builtIndex, indexBuildProgram, summaryMergeProgram, type RecordDef, type RecordIndexDef } from "@elaraai/e3";
import { RecordNestedPathType, RecordNestedTotalsType, RecordSummaryTotalsType, type RecordNestedTotals, type RecordSummaryTotals } from "@elaraai/e3-types";
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

/** A press line: its units, each with its own jobs and its load, a value a day. */
const UnitRow = StructType({ jobs: JobsType, load: DictType(DateTimeType, FloatType) });
const LineRow = StructType({ name: StringType, units: DictType(StringType, UnitRow) });
const LinesType = DictType(StringType, LineRow);
const lines = e3.record("lines", LinesType, {
    initial: new Map(),
    indexes: (index) => ({
        lines_in_time: index.nested({
            collections: {
                units: index.nested.rows({
                    jobs: index.nested.items({ from: "start", to: "end" }, { rollup: true }),
                    load: index.nested.values({ rollup: "sum" }),
                }),
            },
            tile: "week",
            summary: "month",
        }),
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

/** The lines: two, of three units each, the seeded jobs dealt out among the units, and a load a day for each. */
function seededLines(): ValueTypeOf<typeof LinesType> {
    const draw = stream(1434);
    const dealt = Array.from({ length: 6 }, () => new SortedMap<string, Job>(undefined, keyOrder));
    let n = 0;
    for (const [key, job] of JOBS) dealt[n++ % dealt.length]!.set(key, job);
    // The first unit holds the edges, whatever else it is dealt
    for (const name of ["E-ends-at-from", "E-instant-at-from", "E-instant-at-to", "E-past-a-year"]) {
        const job = JOBS.get(name);
        assert.ok(job !== undefined, name);
        dealt[0]!.set(name, job);
    }
    const rows = new SortedMap<string, ValueTypeOf<typeof LineRow>>(undefined, keyOrder);
    for (let line = 0; line < 2; line++) {
        const units = new SortedMap<string, ValueTypeOf<typeof UnitRow>>(undefined, keyOrder);
        for (let unit = 0; unit < 3; unit++) {
            // Quarters, so a sum is exact in whatever order it is added
            const load = new SortedMap<Date, number>(
                Array.from({ length: 200 }, (_, day): [Date, number] => [later(OCT_5, BigInt(day - 100) * DAY + 6n * HOUR), Math.floor(draw() * 64) / 4]), instantOrder);
            units.set(`U-${unit + 1}`, { jobs: dealt[line * 3 + unit]!, load });
        }
        rows.set(`L-${line + 1}`, { name: `Line ${line + 1}`, units });
    }
    return decodeBeast2For(LinesType)(encodeBeast2For(LinesType)(rows));
}

const LINES = seededLines();

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
    // A window that is one point, a rack's centre, its width and height written as the zero below zero: a page's
    // search takes it as a window of no width, which holds the rack
    const centre = [...RACKS.values()].flatMap((rack) => (rack.x.type === "some" && rack.y.type === "some" ? [{ x: rack.x.value, y: rack.y.value }] : []))[0];
    assert.ok(centre !== undefined, "a rack is placed");
    out.push({ ...centre, width: -0, height: -0 });
    for (let n = 0; n < 20; n++) {
        const side = n % 4 === 0 ? 0.5 + draw() * 2 : 2 + draw() ** 2 * 60;
        out.push({ x: draw() * 110 - 5, y: draw() * 70 - 5, width: side, height: side * (0.3 + draw()) });
    }
    return out;
})();

// ── An index's entries, and a search of them as e3 answers one ───────────────

/** The type of an index's entries: `Dict<{ ik, k }, P>`. */
type EntriesType = DictType<StructType<{ ik: EastType; k: EastType }>, EastType>;
/** An entry's key, and what it carries, each as the index's own entries' type decodes. */
type EntryOf<T extends EntriesType> = readonly [ValueTypeOf<T["key"]>, ValueTypeOf<T["value"]>];

/** An index as its record's state holds it: its entries in order, typed by the index's own entries' type, and its key's types. */
interface Held<T extends EntriesType> {
    readonly ik: T["key"]["fields"]["ik"];
    readonly entryKey: T["key"];
    readonly entries: readonly EntryOf<T>[];
    /** The entries as a compiled function takes them. */
    readonly dict: never;
}

/**
 * The entries an index's own build program files for some rows.
 *
 * @param input - The index, as `e3.index` gives it
 * @param rows - The record's rows
 * @param merge - A summary's merge of two totals filed under one key (`summaryMergeProgram`): its build files a row's
 *   share of a tile at a time
 * @returns The entries, in the index's order
 */
function heldOf<T extends EntriesType>(
    input: { readonly type: T; readonly record: RecordDef; readonly index: RecordIndexDef }, rows: unknown,
    merge?: (entry: ValueTypeOf<T["key"]>, a: ValueTypeOf<T["value"]>, b: ValueTypeOf<T["value"]>) => ValueTypeOf<T["value"]>,
): Held<T> {
    type Key = ValueTypeOf<T["key"]>;
    type Carried = ValueTypeOf<T["value"]>;
    const def = builtIndex(input.record, input.index);
    const entryKey: T["key"] = input.type.key;
    const entries = new SortedMap<Key, Carried>(undefined, compareFor(entryKey));
    const build = indexBuildProgram(input.record.type, def).compile([]) as (piece: unknown, emit: (entry: Key, value: Carried) => null) => unknown;
    build(rows, (entry, value) => {
        const before = entries.get(entry);
        entries.set(entry, before === undefined || merge === undefined ? value : merge(entry, before, value));
        return null;
    });
    return { ik: entryKey.fields.ik, entryKey, entries: [...entries], dict: entries as never };
}

/** A struct's field by a name known only as a search is answered: its value, which the field's own type compares. */
const fieldOf = (struct: object, name: string): unknown => Reflect.get(struct, name);

/** The entries a search holds, as e3 answers one (`key-search.ts`). */
function searched<T extends EntriesType>(index: Held<T>, query: Query): readonly EntryOf<T>[] {
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
    const ik: EastType = index.ik;
    if (ik.type !== "Struct") assert.fail("an index a page searches by fields has a struct key");
    const fields = ik.fields;
    const names = Object.keys(fields).slice(0, query.value.values.length);
    const values = names.map((name, i) => {
        const parsed = parseFor(fields[name]!)(query.value.values[i]!);
        assert.ok(parsed.success, `${query.value.values[i]} is the key's '${name}'`);
        return parsed.value;
    });
    return index.entries.filter(([entry]) => names.every((name, i) => equalFor(fields[name]!)(fieldOf(entry.ik, name), values[i])));
}

/** The entries of an index over rows keyed by a String. */
type KeyedByString = DictType<StructType<{ ik: EastType; k: StringType }>, EastType>;

/** The row keys of some entries, each once, in key order; fails where a row is held twice and `once` says none is. */
function keysOf<T extends KeyedByString>(entries: readonly EntryOf<T>[], once: string | undefined): string[] {
    const keys = entries.map(([entry]) => entry.k);
    const distinct = new SortedSet(keys, keyOrder);
    if (once !== undefined) assert.equal(distinct.size, keys.length, `${once}: the page's searches hold a row once`);
    return [...distinct];
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
    const held = heldOf(inTime, JOBS);
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
    const heldByState = heldOf(byState, JOBS);
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
    /** The entries of a series index of the jobs: each carries its row. */
    type JobEvents = DictType<StructType<{ ik: EastType; k: StringType }>, typeof JobRow>;
    /** One index through both: the page's runs of a press over each window, and the body's read of it. */
    const through = (
        name: string, def: RecordIndexDef, held: Held<JobEvents>, state: string | undefined,
        body: (entries: never, press: string, from: Date, to: Date) => ReadonlyMap<string, Job>,
    ): void => {
        const index = pageIndex(name, def);
        const where: Parameters<typeof levelCellQueries>[1] = new Map(state === undefined ? [] : [["state", variant("values", [printString(state)])]]);
        let more = 0;
        for (const w of WINDOWS) {
            for (const press of PRESSES) {
                // The page reads a run a level, two tiles before the window's first and one after its last
                const runs = levelRuns("week", w.from, w.to);
                const cells = runs.flatMap((run) => levelCellQueries(index, where, run, [printString(press)]).queries.flatMap((query) => searched(held, query)));
                const inWindow = cells.filter(([, row]) => overlaps(row, w.from, w.to));
                more += cells.length - inWindow.length;
                const given = body(held.dict, press, w.from, w.to);
                assert.deepEqual(keysIn(given), keysOf(inWindow, undefined), `the ${state ?? ""} jobs on ${press} in ${window(w)}`);
                for (const [entry, row] of inWindow) assert.ok(equalFor(JobRow)(given.get(entry.k)!, row), "each with the row the index carries");
            }
        }
        assert.ok(more > 100, `the page's runs hold more than the windows do, which its reader tests: ${more}`);
    };

    const pressWeeks = e3.index(jobs.indexes.press_weeks);
    through("press_weeks", jobs.indexes.press_weeks, heldOf(pressWeeks, JOBS), undefined,
        East.compile(East.function([pressWeeks.type, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, press, from, to) =>
            pressWeeks.read(entries).events({ key: press, from, to }).collect($)), []));
    const byState = e3.index(jobs.indexes.press_weeks_by_state);
    through("press_weeks_by_state", jobs.indexes.press_weeks_by_state, heldOf(byState, JOBS), "confirmed",
        East.compile(East.function([byState.type, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, press, from, to) =>
            byState.read(entries).events({ on: { state: "confirmed" }, key: press, from, to }).collect($)), []));
});

test("a summary index: the tiles of the page's run that overlap the window are the body's `totals`", () => {
    const months = e3.index(jobs.indexes.press_months);
    const Totals = DictType(DateTimeType, RecordSummaryTotalsType);
    const body = East.compile(East.function([months.type, StringType, DateTimeType, DateTimeType], Totals, ($, entries, press, from, to) =>
        months.read(entries).totals({ key: press, from, to }).collect($)), []);
    const held = heldOf(months, JOBS, summaryMergeProgram(builtIndex(jobs, jobs.indexes.press_months)).compile([]));
    const index = pageIndex("press_months", jobs.indexes.press_months);
    let tiles = 0;
    for (const w of WINDOWS) {
        for (const press of PRESSES) {
            // The page reads a tile before the window's first and one after its last
            const run = summaryRun("month", w.from, w.to);
            const cell = summaryCellQueries(index, new Map(), run, [printString(press)]).queries.flatMap((query) => searched(held, query));
            const expected = new SortedMap<Date, RecordSummaryTotals>(undefined, instantOrder);
            for (const [entry, totals] of cell) {
                const tile = entry.ik.tile;
                if (instantOrder(tile, w.to) < 0 && instantOrder(tileNext("month", tile), w.from) > 0) expected.set(tile, totals);
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
    /** The entries of an area index of the racks: each carries its row. */
    type RackCells = DictType<StructType<{ ik: EastType; k: StringType }>, typeof RackRow>;
    /** One index through both: the page's searches of each viewport, and the body's read of it. */
    const through = (
        held: Held<RackCells>, zone: string | undefined, printOn: ReturnType<typeof recordOnPrinter>,
        body: (entries: never, x: number, y: number, width: number, height: number) => ReadonlyMap<string, Rack>,
    ): void => {
        let more = 0;
        let rows = 0;
        for (const box of BOXES) {
            const queries = areaQueries(zone === undefined ? [] : [printString(zone)], { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height }, 2 ** -7, printOn);
            assert.ok(queries.length <= 266, "at most 266 searches a combination");
            const page = queries.flatMap((query) => searched(held, query));
            const inBox = page.filter(([, row]) => meets(row, box.x, box.y, box.width, box.height));
            more += page.length - inBox.length;
            rows += inBox.length;
            assert.deepEqual(keysIn(body(held.dict, box.x, box.y, box.width, box.height)), keysOf(inBox, `${box.width} by ${box.height} at ${box.x}, ${box.y}`),
                `the ${zone ?? ""} racks in ${box.width} by ${box.height} at ${box.x}, ${box.y}`);
        }
        assert.ok(rows > 300 && more > 50, `the windows hold racks, and the page's searches more than they do: ${rows}, ${more}`);
    };

    const byArea = e3.index(racks.indexes.by_area);
    through(heldOf(byArea, RACKS), undefined, recordOnPrinter(StructType({})),
        East.compile(East.function([byArea.type, FloatType, FloatType, FloatType, FloatType], RacksType, ($, entries, x, y, width, height) =>
            byArea.read(entries).within({ x, y, width, height }).collect($)), []));
    const byZone = e3.index(racks.indexes.by_zone_area);
    through(heldOf(byZone, RACKS), "storage", recordOnPrinter(StructType({ zone: StringType })),
        East.compile(East.function([byZone.type, FloatType, FloatType, FloatType, FloatType], RacksType, ($, entries, x, y, width, height) =>
            byZone.read(entries).within({ on: { zone: "storage" }, x, y, width, height }).collect($)), []));
});

test("a nested series index: of what the page's runs of a node hold, what the window holds is exactly the body's `items`, `subtree`, `totals` and `subtotals`", () => {
    const inTime = e3.index(lines.indexes.lines_in_time);
    const held = heldOf(inTime, LINES);
    const ik = held.ik.fields;
    type Path = ValueTypeOf<typeof RecordNestedPathType>;
    type Run = ValueTypeOf<typeof ik.run>;
    type Level = ValueTypeOf<typeof ik.level>;
    type Filed = (typeof held.entries)[number];
    const printPath = printFor(ik.path);
    const printRun = printFor(ik.run);
    const printLevel = printFor(ik.level);
    const printTile = printFor(ik.tile);
    /** A path as the index's key holds one, from its names: what the page's reader prints a place and a node by. */
    const pathOf = (names: readonly string[]): Path => names.reduceRight<Path>((rest, key) => variant("step", { key, rest }), variant("end", null));
    /** The page's search of one run of a node at a level, over a run of its tiles (`plan/root/nested.ts`). */
    const pageRun = (place: readonly string[], row: string, path: readonly string[], run: Run, level: Level["type"], from: Date, to: Date): Query => {
        const leading = [printPath(pathOf(place)), printString(row), printPath(pathOf(path)), printRun(run), printLevel(variant(level, null))];
        return variant("range", { from: [...leading, printTile(from)], to: [...leading, printTile(to)] });
    };
    /** An entry's job, out of its value: the item of the units' jobs. */
    const jobOf = ([, value]: Filed): Job => {
        if (value.type !== "item" || value.value.type !== "units" || value.value.value.type !== "jobs") assert.fail(`an entry of the jobs' runs carries a job, and this one a ${value.type}`);
        return value.value.value.value;
    };
    /** An entry's item's id, or the keys down to the node holding it with its id. */
    const idOf = ([entry]: Filed): string => {
        if (entry.ik.item.type !== "id") assert.fail(`an entry of a node's own items names its item by its id, and this one by its ${entry.ik.item.type}`);
        return entry.ik.item.value;
    };
    const underOf = ([entry]: Filed): ValueTypeOf<typeof NestedUnderType> => {
        if (entry.ik.item.type !== "under") assert.fail(`an entry of a subtree names its item by the node holding it, and this one by its ${entry.ik.item.type}`);
        return entry.ik.item.value;
    };

    const Beneath = DictType(NestedUnderType, JobRow);
    const MonthTotals = DictType(DateTimeType, RecordNestedTotalsType);
    const Weeks = DictType(DateTimeType, FloatType);
    const itemsOf = East.compile(East.function([inTime.type, StringType, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, line, unit, from, to) =>
        inTime.read(entries).items({ collection: ["units", "jobs"], row: line, path: [unit], from, to }).collect($)), []);
    const beneathOf = East.compile(East.function([inTime.type, StringType, DateTimeType, DateTimeType], Beneath, ($, entries, line, from, to) =>
        inTime.read(entries).subtree({ collection: ["units", "jobs"], row: line, from, to }).collect($)), []);
    const monthsOf = East.compile(East.function([inTime.type, StringType, StringType, DateTimeType, DateTimeType], MonthTotals, ($, entries, line, unit, from, to) =>
        inTime.read(entries).totals({ collection: ["units", "load"], row: line, path: [unit], from, to }).collect($)), []);
    const weeksOf = East.compile(East.function([inTime.type, StringType, DateTimeType, DateTimeType], Weeks, ($, entries, line, from, to) =>
        inTime.read(entries).subtotals({ collection: ["units", "load"], row: line, rollup: "sum", from, to }).collect($)), []);

    let more = 0;
    let rows = 0;
    let tiles = 0;
    for (const w of WINDOWS) {
        for (const [line, row] of LINES) {
            // A unit's own jobs: a run a level, two tiles before the window's first and one after its last
            for (const unit of row.units.keys()) {
                const cells = levelRuns("week", w.from, w.to).flatMap((run) =>
                    searched(held, pageRun(["units", "jobs"], line, [unit], variant("items", null), run.level, run.from, run.to)));
                const inWindow = cells.filter((filed) => overlaps(jobOf(filed), w.from, w.to));
                more += cells.length - inWindow.length;
                // A job past a year is filed under each year it touches: the page's fill holds it once
                const expected = new SortedMap<string, Job>(inWindow.map((filed): [string, Job] => [idOf(filed), jobOf(filed)]), keyOrder);
                rows += expected.size;
                assert.ok(equalFor(JobsType)(itemsOf(held.dict, line, unit, w.from, w.to), expected), `the jobs of ${line} ${unit} in ${window(w)}`);

                // Its load's totals a month: the tiles of the page's run that overlap the window
                const run = summaryRun("month", w.from, w.to);
                const months = new SortedMap<Date, RecordNestedTotals>(undefined, instantOrder);
                for (const [entry, value] of searched(held, pageRun(["units", "load"], line, [unit], variant("totals", null), "month", run.from, run.to))) {
                    const tile = entry.ik.tile;
                    if (instantOrder(w.from, w.to) < 0 && instantOrder(tile, w.to) < 0 && instantOrder(tileNext("month", tile), w.from) > 0) {
                        if (value.type !== "totals") assert.fail(`an entry of a node's totals carries them, and this one a ${value.type}`);
                        months.set(tile, value.value);
                    }
                }
                tiles += months.size;
                assert.ok(equalFor(MonthTotals)(monthsOf(held.dict, line, unit, w.from, w.to), months), `the load's months of ${line} ${unit} in ${window(w)}`);
            }

            // The jobs beneath the line, each named by the unit holding it and its id
            const cells = levelRuns("week", w.from, w.to).flatMap((run) =>
                searched(held, pageRun(["units", "jobs"], line, [], variant("subtree", null), run.level, run.from, run.to)));
            const beneath = new SortedMap<ValueTypeOf<typeof NestedUnderType>, Job>(undefined, compareFor(NestedUnderType));
            for (const filed of cells) {
                if (overlaps(jobOf(filed), w.from, w.to)) beneath.set(underOf(filed), jobOf(filed));
            }
            assert.ok(equalFor(Beneath)(beneathOf(held.dict, line, w.from, w.to), beneath), `the jobs beneath ${line} in ${window(w)}`);

            // The line's sum of its units' load a week
            const run = summaryRun("week", w.from, w.to);
            const sum = { fold: variant("sum", null), aggregate: variant("sum", null) };
            const weeks = new SortedMap<Date, number>(undefined, instantOrder);
            for (const [entry, value] of searched(held, pageRun(["units", "load"], line, [], variant("subtotals", sum), "week", run.from, run.to))) {
                const tile = entry.ik.tile;
                if (instantOrder(w.from, w.to) < 0 && instantOrder(tile, w.to) < 0 && instantOrder(tileNext("week", tile), w.from) > 0) {
                    if (value.type !== "subtotal") assert.fail(`an entry of a parent's subtotals carries one, and this one a ${value.type}`);
                    weeks.set(tile, value.value);
                }
            }
            tiles += weeks.size;
            assert.ok(equalFor(Weeks)(weeksOf(held.dict, line, w.from, w.to), weeks), `the load's weeks of ${line} in ${window(w)}`);
        }
    }
    assert.ok(rows > 300 && tiles > 300 && more > 100, `the windows hold jobs and tiles, and the page's runs more than they do: ${rows}, ${tiles}, ${more}`);
});
