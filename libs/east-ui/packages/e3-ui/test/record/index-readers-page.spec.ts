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
 *   what the body's `events` and `within` give — the longest event a level
 *   files among them, read from the tile before the window's first up to the
 *   millisecond it ends at, where the page's runs stop reading that tile;
 * - a series index in time order's searches, a range a tile from a first key
 *   through a last (`inTimeCellQueries`, #1710), hold of every key what the
 *   body's `events` gives, and of a run of keys exactly what the index in key
 *   order holds of each of them;
 * - a summary's tiles that overlap the window are the body's `totals`;
 * - the record's totals, a summary with no key (#1732): the tiles of the
 *   page's range of whole tiles, under the narrowing's leading values, are
 *   exactly the body's `totals`;
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
import e3, {
    NestedUnderType, RECORD_TILES, SHORTEST_MS, builtIndex, indexBuildProgram, summaryMergeProgram, type RecordDef, type RecordIndexDef,
} from "@elaraai/e3";
import { at, seededStream } from "@elaraai/e3-core/test";
import { RecordNestedPathType, RecordNestedTotalsType, RecordSummaryTotalsType, type RecordNestedTotals, type RecordSummaryTotals } from "@elaraai/e3-types";
import {
    RecordSliceIndexType, SHORTEST_TILE_MS, areaQueries, inTimeCellQueries, intervalQueries, levelCellQueries, levelRuns, recordOnPrinter, summaryCellQueries,
    summaryRun, tileNext, totalsCellQueries, totalsRun,
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
        press_weeks: index.flatSeries({ key: "press", from: "start", to: "end", tile: "week" }),
        press_weeks_by_state: index.flatSeries({ on: ["state"], key: "press", from: "start", to: "end", tile: "week" }),
        weeks: index.flatSeries({ key: "press", from: "start", to: "end", tile: "week", order: "time" }),
        weeks_by_state: index.flatSeries({ on: ["state"], key: "press", from: "start", to: "end", tile: "week", order: "time" }),
        press_months: index.summary({ key: "press", from: "start", to: "end", tile: "month" }),
        // The record's totals a month, and a state's (#1732).
        months: index.totals({ from: "start", to: "end", tile: "month" }),
        months_by_state: index.totals({ on: ["state"], from: "start", to: "end", tile: "month" }),
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
        lines_in_time: index.nestedSeries({
            collections: {
                units: index.nestedSeries.rows({
                    jobs: index.nestedSeries.items({ from: "start", to: "end" }, { rollup: true }),
                    load: index.nestedSeries.values({ rollup: "sum" }),
                }),
            },
            tile: "week",
            summary: ["month"],
        }),
    }),
});

const keyOrder = compareFor(StringType);
const instantOrder = compareFor(DateTimeType);
const printInstant = printFor(DateTimeType);
const printString = printFor(StringType);
const printStart = printFor(OptionType(DateTimeType));

/** The instant some milliseconds after another, made by East. */
const later = East.compile(East.function([DateTimeType, IntegerType], DateTimeType, (_$, from, ms) =>
    East.DateTime.fromEpochMilliseconds(from.toEpochMilliseconds().add(ms))), []);

const HOUR = 3_600_000n;
const DAY = 24n * HOUR;
const PRESSES = ["P-1", "P-2", "P-3"];
const STATES = ["confirmed", "proposed"];
const ZONES = ["inbound", "storage"];
const OCT_5 = at("2026-10-05T00:00:00.000");

/**
 * The longest job a level files, started in the last millisecond of a tile: a month's 28 days from the end of
 * September, a quarter's 90 from the end of the third, and a year's 365 from the end of 2027, into a leap year. Each is
 * filed under the tile it starts in and ends late in the next, which is as far as a job filed before a tile reaches
 * into it: a window that starts before its end holds it, and one from its end on holds nothing filed before its own
 * tile.
 */
const LONGEST: readonly { readonly name: string; readonly level: "month" | "quarter" | "year"; readonly start: string; readonly end: string }[] = [
    { name: "E-longest-of-a-month", level: "month", start: "2026-09-30T23:59:59.999", end: "2026-10-28T23:59:59.999" },
    { name: "E-longest-of-a-quarter", level: "quarter", start: "2026-09-30T23:59:59.999", end: "2026-12-29T23:59:59.999" },
    { name: "E-longest-of-a-year", level: "year", start: "2027-12-31T23:59:59.999", end: "2028-12-30T23:59:59.999" },
];

/** The jobs: an hour to three years long, around October 2026; instants, ends before starts, and some not yet scheduled. */
function seededJobs(): SortedMap<string, Job> {
    const draw = seededStream(1618);
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
    for (const edge of LONGEST) rows.set(edge.name, job(0, at(edge.start), at(edge.end)));
    return rows;
}

/** The racks: across a floor of a hundred metres by sixty; some not yet placed, one outside the index's domain. */
function seededRacks(): SortedMap<string, Rack> {
    const draw = seededStream(1385);
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
    const draw = seededStream(1434);
    const dealt = Array.from({ length: 6 }, () => new SortedMap<string, Job>(undefined, keyOrder));
    let n = 0;
    for (const [key, job] of JOBS) dealt[n++ % dealt.length]!.set(key, job);
    // The first unit holds the edges, whatever else it is dealt
    for (const name of ["E-ends-at-from", "E-instant-at-from", "E-instant-at-to", "E-past-a-year", ...LONGEST.map((edge) => edge.name)]) {
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

/** The windows that start two milliseconds before each of the longest jobs ends, at its end, and a millisecond on: three days each. */
const REACHED = LONGEST.flatMap((edge) =>
    [-2n, 0n, 1n].map((ms) => ({ from: later(at(edge.end), ms), to: later(at(edge.end), ms + 3n * DAY), edge, ms })));

/** The windows of time: the week of the edges, an hour, two years, those at the longest jobs' ends, and seeded ones. */
const WINDOWS: { from: Date; to: Date }[] = (() => {
    const draw = seededStream(55);
    const out = [
        { from: at("2026-10-12T00:00:00.000"), to: at("2026-10-19T00:00:00.000") },
        { from: at("2026-10-12T09:00:00.000"), to: at("2026-10-12T10:00:00.000") },
        { from: at("2025-06-01T00:00:00.000"), to: at("2027-06-01T00:00:00.000") },
        ...REACHED.map(({ from, to }) => ({ from, to })),
    ];
    for (let n = 0; n < 30; n++) {
        const from = later(OCT_5, BigInt(Math.floor((draw() - 0.5) * 900)) * DAY + BigInt(Math.floor(draw() * 24)) * HOUR);
        out.push({ from, to: later(from, n % 3 === 0 ? HOUR * BigInt(1 + Math.floor(draw() * 30)) : DAY * BigInt(1 + Math.floor(draw() ** 2 * 400))) });
    }
    return out;
})();

/** The windows of the floor: a room, the floor, and seeded ones. */
const BOXES: { x: number; y: number; width: number; height: number }[] = (() => {
    const draw = seededStream(266);
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
    // What a series and a summary by key both file by: a series index says beside it what it carries, and its order.
    const tiling = (t: Pick<NonNullable<RecordIndexDef["summary"]>, "from" | "to" | "tile">, key: string, order: "key" | "time", copy: boolean) =>
        ({ key, from: t.from, to: t.to, tile: variant(t.tile, null), order: variant(order, null), copy });
    const summary = def.summary;
    return decodeBeast2For(RecordSliceIndexType)(encodeBeast2For(RecordSliceIndexType)({
        name, fields: [...(def.on ?? [])], sets: new Set(), structured: true, interval: none, area: none,
        series: def.series === undefined ? none : some(tiling(def.series, def.series.key, def.series.order, def.series.carries === "value")),
        // A summary keeps a key's totals, filed by it, or with no key the record's (#1732).
        summary: summary === undefined ? none : summary.key === undefined
            ? some(variant("totals", { from: summary.from, to: summary.to, tile: variant(summary.tile, null) }))
            : some(variant("keyed", tiling(summary, summary.key, "key", false))),
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
                // The page reads a run a level: the window's tiles, and the one before them where a job filed there can reach it
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

test("a level's shortest tile is e3's, and the longest job a level files is read from the tile before a window's first up to the millisecond it ends at (#1797)", () => {
    // How far a job filed at a level reaches past its tile: the page's lengths are e3's.
    assert.equal(Object.keys(SHORTEST_TILE_MS).length, RECORD_TILES.length);
    for (const tile of RECORD_TILES) assert.equal(BigInt(SHORTEST_TILE_MS[tile]), SHORTEST_MS[tile], `the shortest ${tile}`);

    const pressWeeks = e3.index(jobs.indexes.press_weeks);
    const body = East.compile(East.function([pressWeeks.type, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, press, from, to) =>
        pressWeeks.read(entries).events({ key: press, from, to }).collect($)), []);
    const held = heldOf(pressWeeks, JOBS);
    const index = pageIndex("press_weeks", jobs.indexes.press_weeks);
    const press = PRESSES[0]!;
    const sameKey = equalFor(StringType);
    for (const { from, to, edge, ms } of REACHED) {
        // A window that starts before the job's end holds it; one from its end on does not.
        const given = body(held.dict, press, from, to);
        assert.equal(given.has(edge.name), ms < 0n, `${edge.name} in ${window({ from, to })}, as the body gives it`);
        // The job is filed once, under the tile before the window's own at the level its length is the shortest tile
        // of: that level's run holds it up to the millisecond it ends at, and a millisecond on no run reads that tile.
        const holding = levelRuns("week", from, to).filter((run) => levelCellQueries(index, new Map(), run, [printString(press)]).queries
            .some((query) => searched(held, query).some(([entry]) => sameKey(entry.k, edge.name)))).map((run) => run.level);
        assert.deepEqual(holding, ms > 0n ? [] : [edge.level], `the runs of ${window({ from, to })} holding ${edge.name}`);
    }
});

test("a series index in time order: a range a tile from a first press through a last holds every press's events the body's `events` gives, and of a run of presses what the index in key order holds of each (#1710)", () => {
    /** The entries of a series index of the jobs: each carries its row. */
    type JobEvents = DictType<StructType<{ ik: EastType; k: StringType }>, typeof JobRow>;
    const [first, second, last] = PRESSES.map((press) => printString(press)) as [string, string, string];
    /** One index in time order through both, beside the index in key order over the same leading fields. */
    const through = (
        name: string, def: RecordIndexDef, held: Held<JobEvents>, byKey: { name: string; def: RecordIndexDef; held: Held<JobEvents> }, state: string | undefined,
        body: (entries: never, from: Date, to: Date) => ReadonlyMap<string, Job>,
    ): void => {
        const index = pageIndex(name, def);
        const keyed = pageIndex(byKey.name, byKey.def);
        const where: Parameters<typeof inTimeCellQueries>[1] = new Map(state === undefined ? [] : [["state", variant("values", [printString(state)])]]);
        let more = 0;
        let ranges = 0;
        for (const w of WINDOWS) {
            const runs = levelRuns("week", w.from, w.to);
            // Every press: a range a tile, from the first press through the last
            const queries = runs.flatMap((run) => inTimeCellQueries(index, where, run, first, last).queries);
            ranges += queries.length;
            const cells = queries.flatMap((query) => searched(held, query));
            const inWindow = cells.filter(([, row]) => overlaps(row, w.from, w.to));
            more += cells.length - inWindow.length;
            const given = body(held.dict, w.from, w.to);
            assert.deepEqual(keysIn(given), keysOf(inWindow, undefined), `the ${state ?? ""} jobs in ${window(w)}`);
            for (const [entry, row] of inWindow) assert.ok(equalFor(JobRow)(given.get(entry.k)!, row), "each with the row the index carries");
            // A run of presses: exactly what the index in key order holds of each of them, entry for entry — the last
            // press's entries among them, and no entry of a press past it. A job past a year is under each year it touches
            // in either index.
            for (const [from, to, presses] of [[first, second, PRESSES.slice(0, 2)], [second, last, PRESSES.slice(1)], [second, second, PRESSES.slice(1, 2)]] as const) {
                const run = runs.flatMap((level) => inTimeCellQueries(index, where, level, from, to).queries.flatMap((query) => searched(held, query)));
                const each = runs.flatMap((level) => levelCellQueries(keyed, where, level, presses.map((press) => printString(press))).queries
                    .flatMap((query) => searched(byKey.held, query)));
                assert.deepEqual(keysOf(run, undefined), keysOf(each, undefined), `the jobs on ${presses.join(", ")} in ${window(w)}`);
                assert.equal(run.length, each.length, `as many entries on ${presses.join(", ")} in ${window(w)} as the index in key order holds`);
                assert.ok(run.every(([, row]) => presses.includes(row.press)), `no job of another press among ${presses.join(", ")}'s`);
            }
        }
        assert.ok(more > 100, `the page's ranges hold more than the windows do, which its reader tests: ${more}`);
        assert.ok(ranges > WINDOWS.length * 4, `a range a tile a level: ${ranges}`);
    };

    const weeks = e3.index(jobs.indexes.weeks);
    const pressWeeks = e3.index(jobs.indexes.press_weeks);
    through("weeks", jobs.indexes.weeks, heldOf(weeks, JOBS), { name: "press_weeks", def: jobs.indexes.press_weeks, held: heldOf(pressWeeks, JOBS) }, undefined,
        East.compile(East.function([weeks.type, DateTimeType, DateTimeType], JobsType, ($, entries, from, to) =>
            weeks.read(entries).events({ from, to }).collect($)), []));
    const byState = e3.index(jobs.indexes.weeks_by_state);
    const pressWeeksByState = e3.index(jobs.indexes.press_weeks_by_state);
    through("weeks_by_state", jobs.indexes.weeks_by_state, heldOf(byState, JOBS),
        { name: "press_weeks_by_state", def: jobs.indexes.press_weeks_by_state, held: heldOf(pressWeeksByState, JOBS) }, "confirmed",
        East.compile(East.function([byState.type, DateTimeType, DateTimeType], JobsType, ($, entries, from, to) =>
            byState.read(entries).events({ on: { state: "confirmed" }, from, to }).collect($)), []));
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

test("the record's totals: the tiles of the page's range of whole tiles, under the narrowing's leading values, are exactly the body's `totals` (#1732)", () => {
    const Totals = DictType(DateTimeType, RecordSummaryTotalsType);
    /** The entries of a summary of the jobs: each tile's totals. */
    type TileTotals = DictType<StructType<{ ik: EastType; k: EastType }>, typeof RecordSummaryTotalsType>;
    /** One summary with no key through both: the page's range over each window's whole tiles, and the body's read of it. */
    const through = (
        name: string, def: RecordIndexDef, held: Held<TileTotals>, state: string | undefined,
        body: (entries: never, from: Date, to: Date) => Map<Date, RecordSummaryTotals>,
    ): number => {
        const index = pageIndex(name, def);
        const where: Parameters<typeof totalsCellQueries>[1] = new Map(state === undefined ? [] : [["state", variant("values", [printString(state)])]]);
        let tiles = 0;
        for (const w of WINDOWS) {
            // The page reads the whole tiles the window touches, no more: a tile's total is its own.
            const queries = totalsCellQueries(index, where, totalsRun("month", w.from, w.to)).queries;
            assert.equal(queries.length, 1, "one range under the narrowing's one combination of leading values");
            const page = new SortedMap<Date, RecordSummaryTotals>(queries.flatMap((query) => searched(held, query))
                .map(([entry, totals]): [Date, RecordSummaryTotals] => [(entry.ik as { readonly tile: Date }).tile, totals]), instantOrder);
            tiles += page.size;
            assert.ok(equalFor(Totals)(body(held.dict, w.from, w.to), page), `the ${state ?? "record's"} months in ${window(w)}`);
        }
        return tiles;
    };
    /** A summary's entries, its build filing a row's share of a tile at a time, merged as e3 merges them. */
    const totalsHeld = (def: RecordIndexDef) => summaryMergeProgram(builtIndex(jobs, def)).compile([]);
    const months = e3.index(jobs.indexes.months);
    const all = through("months", jobs.indexes.months, heldOf(months, JOBS, totalsHeld(jobs.indexes.months)), undefined,
        East.compile(East.function([months.type, DateTimeType, DateTimeType], Totals, ($, entries, from, to) =>
            months.read(entries).totals({ from, to }).collect($)), []));
    const byState = e3.index(jobs.indexes.months_by_state);
    const confirmed = through("months_by_state", jobs.indexes.months_by_state, heldOf(byState, JOBS, totalsHeld(jobs.indexes.months_by_state)), "confirmed",
        East.compile(East.function([byState.type, DateTimeType, DateTimeType], Totals, ($, entries, from, to) =>
            byState.read(entries).totals({ on: { state: "confirmed" }, from, to }).collect($)), []));
    assert.ok(all > 100 && confirmed > 100, `the windows hold tiles to read: ${all}, ${confirmed}`);
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
    type Place = ValueTypeOf<typeof RecordNestedPathType>;
    type Run = ValueTypeOf<typeof ik.run>;
    type Level = ValueTypeOf<typeof ik.level>;
    type Filed = (typeof held.entries)[number];
    const printPlace = printFor(ik.collection);
    const printPath = printFor(ik.path);
    const printRun = printFor(ik.run);
    const printLevel = printFor(ik.level);
    const printTile = printFor(ik.tile);
    /** A collection's place as the index's key holds one, from its field names: what the page's reader prints a place by. */
    const placeOf = (names: readonly string[]): Place => names.reduceRight<Place>((rest, key) => variant("step", { key, rest }), variant("end", null));
    /** A node's path as the index's key holds one (#1540): its units' keys, each an id of the index's under the units' case. */
    const pathOf = (units: readonly string[]) =>
        units.reduceRight<unknown>((rest, key) => variant("step", { key: variant("units", key), rest }), variant("end", null)) as ValueTypeOf<typeof ik.path>;
    /** The page's search of one run of a node at a level, over a run of its tiles (`plan/root/nested.ts`). */
    const pageRun = (place: readonly string[], row: string, path: readonly string[], run: Run, level: Level["type"], from: Date, to: Date): Query => {
        const leading = [printPlace(placeOf(place)), printString(row), printPath(pathOf(path)), printRun(run), printLevel(variant(level, null))];
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
        // The job's id, out of its collection's case of the index's ids.
        return (entry.ik.item.value as { readonly value: string }).value;
    };
    const UnderType = NestedUnderType(lines.indexes.lines_in_time);
    const underOf = ([entry]: Filed): ValueTypeOf<typeof UnderType> => {
        if (entry.ik.item.type !== "under") assert.fail(`an entry of a subtree names its item by the node holding it, and this one by its ${entry.ik.item.type}`);
        return entry.ik.item.value;
    };

    const Beneath = DictType(UnderType, JobRow);
    const MonthTotals = DictType(DateTimeType, RecordNestedTotalsType);
    const Weeks = DictType(DateTimeType, FloatType);
    const itemsOf = East.compile(East.function([inTime.type, StringType, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, line, unit, from, to) =>
        inTime.read(entries).items({ collection: ["units", "jobs"], row: line, path: [variant("units", unit)], from, to }).collect($)), []);
    const beneathOf = East.compile(East.function([inTime.type, StringType, DateTimeType, DateTimeType], Beneath, ($, entries, line, from, to) =>
        inTime.read(entries).subtree({ collection: ["units", "jobs"], row: line, from, to }).collect($)), []);
    const monthsOf = East.compile(East.function([inTime.type, StringType, StringType, DateTimeType, DateTimeType], MonthTotals, ($, entries, line, unit, from, to) =>
        inTime.read(entries).totals({ collection: ["units", "load"], row: line, path: [variant("units", unit)], from, to }).collect($)), []);
    const weeksOf = East.compile(East.function([inTime.type, StringType, DateTimeType, DateTimeType], Weeks, ($, entries, line, from, to) =>
        inTime.read(entries).subtotals({ collection: ["units", "load"], row: line, rollup: "sum", from, to }).collect($)), []);

    let more = 0;
    let rows = 0;
    let tiles = 0;
    for (const w of WINDOWS) {
        for (const [line, row] of LINES) {
            // A unit's own jobs: a run a level, the window's tiles and the one before them where a job filed there can reach it
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
            const beneath = new SortedMap<ValueTypeOf<typeof UnderType>, Job>(undefined, compareFor(UnderType));
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
