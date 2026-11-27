/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Queries for e3's series and summary indexes (#1039), the twin of
 * `record-interval.ts` and `record-area.ts`: a record's events filed by the key
 * they are on — a Plan's resource — and by time (#1432, #1433).
 *
 * - A **series index** files each event once, `{ on, key, level, tile }`: at
 *   the finest level, from its declared tile up to the year, whose shortest
 *   tile holds the event's length, under that level's tile holding its start —
 *   or, past a year, under each year it touches — carrying the row. An event
 *   filed at a level is no longer than that level's shortest tile
 *   ({@link SHORTEST_TILE_MS}), so it ends before the end of the tile after
 *   the one holding its start: a reader finds every event at a level that
 *   overlaps a range by reading that level's tiles from the one before the
 *   range's first — or from the range's first, where the range starts too far
 *   into it for an event filed before it to reach: a **run**
 *   ({@link levelRuns}).
 * - A **summary index** keeps one entry for each key in each of its tiles,
 *   `{ on, key, tile }` → `{ count, ms }`, standing for every event touching
 *   it; a reader reads its tiles over the range ({@link summaryRun}).
 * - A **series index in time order** (#1710) files the same entries as a
 *   series index, the tile before the key: `{ on, level, tile, key, past }`, a
 *   tile's events together in their keys' order, `past` false in every entry.
 * - A series index declared with a `value` (#1725) files its events as either
 *   order does, each entry carrying a **copy** of its event — what the value
 *   gives of the row — in the row's place: its reader draws the copies, and
 *   never takes one for a row.
 * - A summary with no key keeps the **record's totals** a tile (#1732), `{ on,
 *   tile }` → `{ count, ms }`: one entry a tile under each combination of its
 *   leading values, whatever the events are on. A source names them in its
 *   binding's `totals`; a reader reads a range of their tiles under the
 *   narrowing's values of their leading fields ({@link totalsCellQueries}),
 *   through the totals that leave it nothing of the narrowing but the window
 *   ({@link totalsIndexFor}). No reader of a resource's summary takes them for
 *   one: a summary's metadata says which it is.
 *
 * A **cell** is some keys over one run: what a reader reads of an index for a
 * block of its rows. Each key of a cell is one range search — the key leads
 * the tile in a series or a summary index's key — holding exactly that key's
 * entries in the run, so a cell's searches hold its keys' entries and no
 * others, in whatever order its keys come — a block of rows narrowed or
 * ordered by another index included. A reader asks every cell it wants in one
 * batch of searches, which counts each cell's entries before one is read, and
 * reads them in one batch of runs: one range a key a level, whatever the
 * range's width.
 *
 * A cell of a series index in time order is one range search a tile
 * ({@link inTimeCellQueries}): from the first of its keys through the last,
 * under the level and the tile. It holds the entries of every key between
 * them in the index — the cell's own, where its keys are neighbours there, as
 * a block of rows in their keys' order under one group is — so its reader
 * keeps the entries of the cell's keys and drops the rest, and its count
 * before a read is the cell's where its keys are neighbours, and at least it
 * otherwise. Each range lies where its tile's entries do, whatever each key's
 * history holds: what a screen of rows reads follows what the window holds.
 *
 * Its last leading fields are where its keys stand (`on`): the group a Plan's
 * rows nest under. A reader fills those the narrowing leaves from the rows
 * its block stands under ({@link seriesIndexFor}), so a block is read under
 * its own group, and the groups' keys need follow no order between them.
 *
 * Neither index serves the rail's narrowing (`record-plan.ts`): a series index
 * files an event past a year under each year it touches, so its runs would
 * count the event more than once, and a summary index's entries name no row.
 * A narrowing reaches a cell through the index's leading fields, chosen
 * exactly; what else it chooses is the reader's to ask of the events it draws
 * (`within`).
 *
 * The tiles are e3's, to the millisecond (`index.flatSeries`): a day and
 * an ISO week counted in whole milliseconds from the epoch and from the Monday
 * before it, so an instant before 1970 is tiled as one after it; a month, a
 * quarter and a year by the UTC calendar.
 */
import { BooleanType, DateTimeType, SortedMap, StringType, compareFor, equalFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";
import {
    RecordSliceTileType, type RecordSliceChoiceType, type RecordSliceIndexType, type RecordSliceOrderType, type RecordSliceTilingType,
    type RecordSliceTotalsType,
} from "./record-types.js";
import { MAX_RECORD_SLICE_RUNS, recordPrefixesExtended } from "./record-plan.js";

type Choice = ValueTypeOf<RecordSliceChoiceType>;
type Index = ValueTypeOf<RecordSliceIndexType>;
type Tiling = ValueTypeOf<RecordSliceTilingType>;
type Totals = ValueTypeOf<RecordSliceTotalsType>;

/** A tile: a day, an ISO week from Monday, a calendar month, a quarter or a year, in UTC. */
export type RecordTile = keyof RecordSliceTileType["cases"] & string;

/** The tiles, from the shortest. */
export const RECORD_TILES: readonly RecordTile[] = ["day", "week", "month", "quarter", "year"];

/** How a series or a summary index files a record's events, as a binding's index metadata carries it. */
export interface TileMarker {
    /** The row field naming what an event is on. */
    readonly key: string;
    /** The row field an event starts at. */
    readonly from: string;
    /** The row field it ends at. */
    readonly to: string;
    /** The tile. */
    readonly tile: RecordTile;
    /** Whether the index is a summary — its totals — rather than a series of its events. */
    readonly summary: boolean;
    /** The order a series index files its entries in (#1710): by key, or by time; a summary index's is by key. */
    readonly order: RecordOrder;
    /**
     * Whether a series index's entries carry a copy of each event — what its `value` gives of the row — in the row's
     * place (#1725); a summary index's carry its totals, and its is false.
     */
    readonly copy: boolean;
}

/** The order a series index files its entries in: by the key an event is on, or by time. */
export type RecordOrder = keyof RecordSliceOrderType["cases"] & string;

/** The marker's name for a summary index. */
const SUMMARY_MARKER = "__summary";
/** The marker's name for a series index whose entries carry a copy of each event (#1725). */
const COPY_MARKER = "__copy";
const TILE_ROLES = ["key", "from", "to", "tile", "order"] as const;
/** The orders a marker names. */
const RECORD_ORDERS: readonly RecordOrder[] = ["key", "time"];

/**
 * The names of the struct `Data.bindPaged` marks a series or a summary index
 * with in a binding's index metadata — its kind's `series` or `summary` case
 * (#1432), as an area index's case names its box: the key, start and end
 * fields and the tile, each named with its role (`key=…`), `order=time` for a
 * series index in time order (#1710) — an index in key order names none —
 * `__copy` for a series index whose entries carry a copy of each event
 * (#1725), and `__summary` for a summary index. A marker's names are the
 * kind's own, never a row field among the index's.
 *
 * @param marker - How the index files the record's events
 * @returns The marker struct's field names, in order
 * @throws {Error} For a summary index in time order, or carrying a copy: a summary is filed by key, and holds its totals
 */
export function tileMarkerFields(marker: TileMarker): string[] {
    if (marker.summary && marker.order !== "key") throw new Error("A summary index is filed by key: its marker names no order");
    if (marker.summary && marker.copy) throw new Error("A summary index holds its totals: its marker names no copy");
    return [`key=${marker.key}`, `from=${marker.from}`, `to=${marker.to}`, `tile=${marker.tile}`,
        ...(marker.order === "key" ? [] : [`order=${marker.order}`]), ...(marker.copy ? [COPY_MARKER] : []), ...(marker.summary ? [SUMMARY_MARKER] : [])];
}

/**
 * Read a series or a summary index's filing back from its marker's field
 * names ({@link tileMarkerFields}).
 *
 * @param names - The marker struct's field names
 * @returns The filing, or `undefined` when the names are not a tile marker's
 */
export function readTileMarker(names: readonly string[]): TileMarker | undefined {
    const roles = new Map<string, string>();
    // The names a marker holds once each, alone: a summary's, and a copy's.
    const leaves = new Set<string>();
    for (const name of names) {
        if (name === SUMMARY_MARKER || name === COPY_MARKER) {
            if (leaves.has(name)) return undefined;
            leaves.add(name);
            continue;
        }
        const at = name.indexOf("=");
        const role = name.slice(0, Math.max(at, 0));
        if (at <= 0 || !(TILE_ROLES as readonly string[]).includes(role) || roles.has(role)) return undefined;
        roles.set(role, name.slice(at + 1));
    }
    const key = roles.get("key"), from = roles.get("from"), to = roles.get("to"), tile = RECORD_TILES.find(t => t === roles.get("tile"));
    // A marker that names no order is an index in key order; one that names it names an order, and never a summary's.
    const order = roles.has("order") ? RECORD_ORDERS.find(o => o === roles.get("order")) : "key";
    if (key === undefined || from === undefined || to === undefined || tile === undefined || order === undefined) return undefined;
    const summary = leaves.has(SUMMARY_MARKER);
    const copy = leaves.has(COPY_MARKER);
    // A summary is filed by key, and holds its totals.
    if (summary && (order !== "key" || copy)) return undefined;
    return { key, from, to, tile, summary, order, copy };
}

/** How a summary index with no key files the record's totals (#1732), as a binding's index metadata carries it. */
export interface TotalsMarker {
    /** The row field an event starts at. */
    readonly from: string;
    /** The row field it ends at. */
    readonly to: string;
    /** The tile. */
    readonly tile: RecordTile;
}

/** The marker's name for the record's totals: a summary with no key. */
const TOTALS_MARKER = "__totals";
const TOTALS_ROLES = ["from", "to", "tile"] as const;

/**
 * The names of the struct `Data.bindPaged` marks the record's totals with in a
 * binding's index metadata (#1732) — a summary index with no key, which its
 * `totals` lists: the start and end fields and the tile, each named with its
 * role, and `__totals`. Its kind is a summary's, whose entries name no row; a
 * marker naming no key is never a {@link tileMarkerFields | tile marker}, so
 * neither is read as the other.
 *
 * @param marker - How the summary files the record's totals
 * @returns The marker struct's field names, in order
 */
export function totalsMarkerFields(marker: TotalsMarker): string[] {
    return [`from=${marker.from}`, `to=${marker.to}`, `tile=${marker.tile}`, TOTALS_MARKER];
}

/**
 * Read the record's totals' filing back from its marker's field names ({@link totalsMarkerFields}).
 *
 * @param names - The marker struct's field names
 * @returns The filing, or `undefined` when the names are not the totals' marker
 */
export function readTotalsMarker(names: readonly string[]): TotalsMarker | undefined {
    const roles = new Map<string, string>();
    let marked = false;
    for (const name of names) {
        if (name === TOTALS_MARKER) {
            if (marked) return undefined;
            marked = true;
            continue;
        }
        const at = name.indexOf("=");
        const role = name.slice(0, Math.max(at, 0));
        if (at <= 0 || !(TOTALS_ROLES as readonly string[]).includes(role) || roles.has(role)) return undefined;
        roles.set(role, name.slice(at + 1));
    }
    const from = roles.get("from"), to = roles.get("to"), tile = RECORD_TILES.find(t => t === roles.get("tile"));
    return !marked || from === undefined || to === undefined || tile === undefined ? undefined : { from, to, tile };
}

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;
/** An ISO week, in milliseconds. */
const WEEK_MS = 604_800_000;
/** 1969-12-29T00:00:00Z, the Monday before the epoch, in milliseconds: where weeks are counted from. */
const MONDAY_MS = -259_200_000;

/**
 * Each level's shortest tile, in milliseconds, as e3 files by it: a day; a
 * week; a month's 28 days; a quarter's 90, January to March in a common year;
 * a year's 365. An event a series index files at a level is no longer than
 * this, which is what bounds how far one filed in a tile reaches past it
 * ({@link levelRuns}).
 */
export const SHORTEST_TILE_MS: Readonly<Record<RecordTile, number>> = {
    day: DAY_MS,
    week: WEEK_MS,
    month: 28 * DAY_MS,
    quarter: 90 * DAY_MS,
    year: 365 * DAY_MS,
};

/** An instant floored to a whole number of `length` milliseconds from `origin`, whichever its sign. */
function flooredTo(ms: number, length: number, origin: number): number {
    return ms - ((((ms - origin) % length) + length) % length);
}

/** The first instant of a UTC month, the month counted on into the next years past December. */
function monthStart(year: number, month: number): Date {
    // Never Date.UTC, which reads a year below 100 as one of the 1900s.
    const at = new Date(0);
    at.setUTCFullYear(year, month, 1);
    return at;
}

/**
 * The start of the tile holding an instant, as e3 files it: a day and a week
 * floored in whole milliseconds from the epoch and from the Monday before it, a
 * month, a quarter and a year by the UTC calendar.
 *
 * @param tile - The tile
 * @param at - The instant
 * @returns The tile's start
 */
export function tileStart(tile: RecordTile, at: Date): Date {
    switch (tile) {
        case "day": return new Date(flooredTo(at.getTime(), DAY_MS, 0));
        case "week": return new Date(flooredTo(at.getTime(), WEEK_MS, MONDAY_MS));
        case "month": return monthStart(at.getUTCFullYear(), at.getUTCMonth());
        case "quarter": return monthStart(at.getUTCFullYear(), at.getUTCMonth() - (at.getUTCMonth() % 3));
        case "year": return monthStart(at.getUTCFullYear(), 0);
    }
}

/**
 * The start of the tile after one, as e3 files it.
 *
 * @param tile - The tile
 * @param start - A tile's start
 * @returns The next tile's start
 */
export function tileNext(tile: RecordTile, start: Date): Date {
    switch (tile) {
        case "day": return new Date(start.getTime() + DAY_MS);
        case "week": return new Date(start.getTime() + WEEK_MS);
        case "month": return monthStart(start.getUTCFullYear(), start.getUTCMonth() + 1);
        case "quarter": return monthStart(start.getUTCFullYear(), start.getUTCMonth() + 3);
        case "year": return monthStart(start.getUTCFullYear() + 1, start.getUTCMonth());
    }
}

/** A summary index filed by key's tiling: a resource's totals a tile, never the record's (#1732). */
function keyedTiling(index: Index): Tiling | undefined {
    return index.summary.type === "some" && index.summary.value.type === "keyed" ? index.summary.value.value : undefined;
}

/**
 * How a series or a summary index filed by key files a record's events: the
 * index's own metadata, or `undefined` for an index of another kind — the
 * record's totals among them, which no reader of a key's events or totals
 * reads (#1732).
 *
 * @param index - The index
 * @returns Its key, start and end fields and its tile
 */
export function tilingOf(index: Index): Tiling | undefined {
    return index.series.type === "some" ? index.series.value : keyedTiling(index);
}

/**
 * The record's totals a summary index with no key keeps (#1732): its start
 * and end fields and its tile; `undefined` for any other index, a summary by
 * key among them.
 *
 * @param index - The index
 * @returns Its fields and its tile
 */
export function totalsOf(index: Index): Totals | undefined {
    return index.summary.type === "some" && index.summary.value.type === "totals" ? index.summary.value.value : undefined;
}

/**
 * Whether an index files a record's events by time — a series index, or a
 * summary, by key or the record's totals (#1732) — so a reader reads its cells
 * and the rail is offered none of its fields.
 *
 * @param index - The index
 * @returns Whether it is one
 */
export function isTiledIndex(index: Index): boolean {
    return index.series.type === "some" || index.summary.type === "some";
}

/** Whether a narrowing chooses exact values of each of an index's leading fields — one of a field that fans out over a Set. */
function leadingChosen(index: Index, where: ReadonlyMap<string, Choice>): boolean {
    return index.fields.every(field => {
        const choice = where.get(field);
        return choice?.type === "values" && choice.value.length > 0 && (!index.sets.has(field) || new Set(choice.value).size === 1);
    });
}

/**
 * Whether a series or a summary index reads a narrowing's cells: whether the
 * narrowing chooses exact values of each of the index's leading fields — one
 * of a field that fans out over a Set, so no event is counted twice.
 *
 * @param index - The index
 * @param where - The narrowing
 * @returns Whether its cells hold the narrowing's events of their keys, or more
 */
export function tileIndexServes(index: Index, where: ReadonlyMap<string, Choice>): boolean {
    return tilingOf(index) !== undefined && leadingChosen(index, where);
}

/**
 * The index of a binding's that reads a narrowing's cells: of its series
 * indexes — or its summary indexes — whose leading fields the narrowing
 * chooses exactly ({@link tileIndexServes}), the one led by the most of them,
 * so the fewest of the narrowing's choices are left for the reader to ask; of
 * two led by as many, the one listed first.
 *
 * @param indexes - The binding's indexes
 * @param where - The narrowing
 * @param which - A series index, or a summary index
 * @param accept - Which tiles the reader takes; every tile by default
 * @returns The index, or `undefined` when none serves the narrowing
 */
export function tileIndexFor(indexes: readonly Index[], where: ReadonlyMap<string, Choice>, which: "series" | "summary",
    accept: (tile: RecordTile) => boolean = () => true): Index | undefined {
    let best: Index | undefined;
    for (const index of indexes) {
        // A summary by key: the record's totals are no resource's (#1732).
        const tiling = which === "series" ? (index.series.type === "some" ? index.series.value : undefined) : keyedTiling(index);
        if (tiling === undefined || !accept(tiling.tile.type) || !tileIndexServes(index, where)) continue;
        if (best === undefined || index.fields.length > best.fields.length) best = index;
    }
    return best;
}

/** A cell's searches, and what of the narrowing they leave to the reader. */
export interface TileCellPlan {
    /** The searches, one for each combination of the leading fields' chosen values and each key, the keys inner. */
    readonly queries: ValueTypeOf<SeekQueryType>[];
    /** The fields of the narrowing the searches do not answer — every field but the index's leading fields and a
     *  range of its start field, which the runs cover. The reader asks of each event it draws whether the
     *  narrowing holds it (`within`); none, and every entry is the narrowing's. */
    readonly residual: readonly string[];
}

const printTile = printFor(DateTimeType);
const printLevel = printFor(RecordSliceTileType);
const sameInstant = equalFor(DateTimeType);
const compareInstant = compareFor(DateTimeType);
const compareField = compareFor(StringType);
/** What an end past a key's entries gives a series index in time order's `past` (#1710): every entry's is false. */
const PAST = printFor(BooleanType)(true);

/** The start of the tile before one, as e3 files it. */
function tilePrevious(tile: RecordTile, start: Date): Date {
    switch (tile) {
        case "day": return new Date(start.getTime() - DAY_MS);
        case "week": return new Date(start.getTime() - WEEK_MS);
        case "month": return monthStart(start.getUTCFullYear(), start.getUTCMonth() - 1);
        case "quarter": return monthStart(start.getUTCFullYear(), start.getUTCMonth() - 3);
        case "year": return monthStart(start.getUTCFullYear() - 1, start.getUTCMonth());
    }
}

/** The start of the tile holding a range's last instant: `to` less a millisecond, or `from` for a range ending at or before it. */
function lastTile(tile: RecordTile, from: Date, to: Date): Date {
    return tileStart(tile, to.getTime() > from.getTime() ? new Date(to.getTime() - 1) : from);
}

/**
 * The tiles of one level a reader reads, half-open: from the first tile's
 * start to the start of the tile after the last.
 */
export interface TileRun {
    /** The level. */
    readonly level: RecordTile;
    /** The first tile's start. */
    readonly from: Date;
    /** The start of the tile after the last. */
    readonly to: Date;
}

/**
 * The levels a series index declared at a tile files at (#1433), the finest
 * first: the tile, and every coarser one up to the year.
 *
 * @param tile - The declared tile
 * @returns The tile and every coarser one
 */
export function levelsOf(tile: RecordTile): readonly RecordTile[] {
    return RECORD_TILES.slice(RECORD_TILES.indexOf(tile));
}

/**
 * What a reader reads of a series index over a range `[from, to)` (#1433): a
 * run a level, the tiles that can hold an event overlapping the range and no
 * other — to the tile holding the range's last instant, from the one holding
 * `from`, or the one before it where an event filed there can reach the range.
 *
 * An event filed at a level starts in its tile and is no longer than the
 * level's shortest tile ({@link SHORTEST_TILE_MS}), so one filed before the
 * tile holding `from` ends less than that length after the tile's start. Where
 * `from` lies at least as far into its tile, no such event reaches it, and the
 * run starts at the tile holding `from`: late in a month, a quarter or a year.
 * Every day and every week is its level's shortest tile, so theirs always
 * starts a tile back. An event longer than a year is filed under each year it
 * touches, the range's own among them.
 *
 * @param tile - The declared tile
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @returns A run a level, the finest first
 */
export function levelRuns(tile: RecordTile, from: Date, to: Date): TileRun[] {
    return levelsOf(tile).map(level => {
        const first = tileStart(level, from);
        const reached = from.getTime() - first.getTime() < SHORTEST_TILE_MS[level];
        return { level, from: reached ? tilePrevious(level, first) : first, to: tileNext(level, lastTile(level, from, to)) };
    });
}

/**
 * What a reader reads of a summary index over a range `[from, to)` (#1433):
 * its tiles from the one before the tile holding `from` to the one after the
 * tile holding the range's last instant. A total is split by tile, so nothing
 * before them carries in.
 *
 * @param tile - The summary's tile
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @returns The run, half-open
 */
export function summaryRun(tile: RecordTile, from: Date, to: Date): { readonly from: Date; readonly to: Date } {
    return { from: tilePrevious(tile, tileStart(tile, from)), to: tileNext(tile, tileNext(tile, lastTile(tile, from, to))) };
}

/**
 * The combinations of the narrowing's exact values of an index's leading
 * fields, each a cell's search's first leaves, refused naming why where the
 * narrowing does not choose them exactly.
 */
function leadingValues(index: Index, where: ReadonlyMap<string, Choice>): string[][] {
    let prefixes: string[][] = [[]];
    for (const field of index.fields) {
        const choice = where.get(field);
        if (choice?.type !== "values" || choice.value.length === 0) {
            throw new Error(`A cell of '${index.name}' takes exact values of '${field}', which leads it: choose them, or read the cells of an index it does not lead`);
        }
        const values = [...new Set(choice.value)];
        if (index.sets.has(field) && values.length !== 1) {
            throw new Error(`A cell of '${index.name}' takes one value of '${field}', which fans out over a Set`);
        }
        const extended = recordPrefixesExtended(prefixes, values);
        if (extended === undefined) {
            throw new Error(`A cell of '${index.name}' needs more than ${MAX_RECORD_SLICE_RUNS} searches a key; choose fewer values`);
        }
        prefixes = extended;
    }
    return prefixes;
}

/** The fields of a narrowing a cell's searches leave to the reader: all but the leading fields and a range of the start field. */
function residualOf(index: Index, tiling: { readonly from: string }, where: ReadonlyMap<string, Choice>): string[] {
    return [...where].filter(([field, choice]) => !index.fields.includes(field) && !(field === tiling.from && choice.type === "range"))
        .map(([field]) => field);
}

/** Refuses a run whose ends do not start tiles of its level. */
function checkRun(index: Index, level: RecordTile, run: { readonly from: Date; readonly to: Date }): void {
    for (const at of [run.from, run.to]) {
        if (!sameInstant(tileStart(level, at), at)) throw new Error(`${printTile(at)} starts no ${level} tile of '${index.name}'`);
    }
}

/**
 * A series index's filing, and a run's level as its key holds it: refused for
 * an index that is none, or filed in another order, for a level it files at
 * none of, and for a run whose ends start no tiles of its level.
 */
function seriesRun(index: Index, order: RecordOrder, run: TileRun): { readonly tiling: Tiling; readonly level: string } {
    if (index.series.type !== "some") throw new Error(`A level's cell reads a series index, and '${index.name}' is none`);
    const tiling = index.series.value;
    if (tiling.order.type !== order) {
        throw new Error(order === "key"
            ? `'${index.name}' is a series index in time order, a tile's events together: its cells are a range a tile (inTimeCellQueries)`
            : `'${index.name}' is a series index in key order, a key's events together: its cells are a range a key (levelCellQueries)`);
    }
    if (!levelsOf(tiling.tile.type).includes(run.level)) {
        throw new Error(`'${index.name}' files at ${levelsOf(tiling.tile.type).join(", ")}: no ${run.level} run`);
    }
    checkRun(index, run.level, run);
    return { tiling, level: printLevel(variant(run.level, null)) };
}

/**
 * Plan a cell of a series index (#1433): some keys over one level's run, a
 * range search for each key under each combination of the narrowing's values
 * of the index's leading fields, `[…on, key, level, from]` to
 * `[…on, key, level, to]` — the key flattened, the leading values one by one
 * (#1432) — holding that key's entries at that level in the run's tiles and
 * no other's. A range of the index's start field — the window — is the
 * reader's: its runs cover it.
 *
 * @param index - A series index in key order ({@link seriesIndexFor})
 * @param where - The narrowing
 * @param run - The level and its tiles ({@link levelRuns})
 * @param keys - The keys, as `.east` literals of the index's key field
 * @returns The cell's searches, and the fields the reader asks of each event
 * @throws {Error} When the index is no series index, or one in time order; when
 *   the narrowing does not choose exact values of each of its leading fields
 *   (one of a Set's), when the combinations of them pass
 *   {@link MAX_RECORD_SLICE_RUNS}, when the index files at no such level, or
 *   when the run's ends do not start tiles of its level
 */
export function levelCellQueries(index: Index, where: ReadonlyMap<string, Choice>, run: TileRun, keys: readonly string[]): TileCellPlan {
    const { tiling, level } = seriesRun(index, "key", run);
    const from = printTile(run.from);
    const to = printTile(run.to);
    const queries = leadingValues(index, where).flatMap(prefix => keys.map(key =>
        variant("range", { from: [...prefix, key, level, from], to: [...prefix, key, level, to] })));
    return { queries, residual: residualOf(index, tiling, where) };
}

/**
 * Plan a cell of a series index in time order (#1710): a run of keys over one
 * level's run of tiles, a range search for each tile under each combination of
 * the narrowing's values of the index's leading fields, `[…on, level, tile,
 * first]` to `[…on, level, tile, last, true]` — through the last key: `past`
 * is false in every entry, so an end that gives it true lies after that key's
 * entries and before the next key's. A search holds the entries at that level
 * and tile of every key from `first` to `last` in the index's order: the
 * cell's own keys', and those of any key between them, which its reader drops.
 *
 * @param index - A series index in time order ({@link seriesIndexFor})
 * @param where - The narrowing, the index's leading fields chosen exactly
 * @param run - The level and its tiles ({@link levelRuns})
 * @param first - The first of the cell's keys in the index's order, as a `.east` literal of its key field
 * @param last - The last of them
 * @returns The cell's searches, a tile each in the run's order under each combination of the leading values, and the
 *   fields the reader asks of each event
 * @throws {Error} When the index is no series index, or one in key order; and as {@link levelCellQueries} does
 */
export function inTimeCellQueries(index: Index, where: ReadonlyMap<string, Choice>, run: TileRun, first: string, last: string): TileCellPlan {
    const { tiling, level } = seriesRun(index, "time", run);
    const tiles: string[] = [];
    for (let at = run.from; compareInstant(at, run.to) < 0; at = tileNext(run.level, at)) tiles.push(printTile(at));
    const queries = leadingValues(index, where).flatMap(prefix => tiles.map(tile =>
        variant("range", { from: [...prefix, level, tile, first], to: [...prefix, level, tile, last, PAST] })));
    return { queries, residual: residualOf(index, tiling, where) };
}

/**
 * A row a block's keys stand under, as a leading field of a series index in
 * time order holds it (#1710): the `.east` literal of the row's key at the
 * field's type, or `undefined` where the field can hold no such key.
 */
export type RecordUnder = (field: string) => string | undefined;

/**
 * Where a block's keys stand in a series index in time order (#1710): its last
 * leading fields, as many as the rows the block stands under, outermost first —
 * what a reader fills from those rows to read the block's cells, and a drop
 * writes into the event it lands under them. None for an index in key order,
 * for a block under no row, and for an index led by fewer fields than the rows
 * it stands under.
 *
 * @param index - The series index
 * @param depth - How many rows the block stands under
 * @returns The fields; `undefined` where none of the index's fields stands for them
 */
export function standingFields(index: Index, depth: number): readonly string[] | undefined {
    if (depth === 0 || depth > index.fields.length) return undefined;
    if (index.series.type !== "some" || index.series.value.order.type !== "time") return undefined;
    return index.fields.slice(index.fields.length - depth);
}

/**
 * A narrowing with a series index in time order's leading fields filled from
 * where a block's keys stand (#1710). The index's last leading fields are
 * where its keys stand, outermost first — as many as the block stands under —
 * and each of them the narrowing leaves is one of `under`; one the narrowing
 * chooses itself stays its choice, and a leading field before them is the
 * narrowing's alone. An index in key order, one led by fewer fields than the
 * block stands under, or one a field of which can hold no such row's key, is
 * filled nothing.
 */
function underFilled(index: Index, where: ReadonlyMap<string, Choice>, under: readonly RecordUnder[]): ReadonlyMap<string, Choice> {
    const standing = standingFields(index, under.length);
    if (standing === undefined || standing.every(field => where.has(field))) return where;
    // A narrowing is a Dict of its fields' choices: in its fields' order, as one decoded is.
    const filled = new SortedMap<string, Choice>([...where], compareField);
    for (const [i, field] of standing.entries()) {
        if (where.has(field)) continue;
        const literal = under[i]!(field);
        if (literal === undefined) return where;
        filled.set(field, variant("values", [literal]));
    }
    return filled;
}

/**
 * The series index of a binding's that reads a block of keys' cells (#1710),
 * and the narrowing it reads them under. Of its series indexes whose leading
 * fields that narrowing chooses exactly ({@link tileIndexServes}), the one led
 * by the most of them; of two led by as many, the one listed first — as
 * {@link tileIndexFor} picks one. An index in time order's last leading fields
 * are where its keys stand, and it reads the block under the narrowing with
 * those of them it leaves filled from `under`, outermost first: the group a
 * Plan's rows nest under, as a `.east` literal of the index's leading field
 * ({@link RecordUnder}).
 * So a kind's source that lists an index in time order led by its rows' group
 * reads a grouped page through it, a block under its own group, and one that
 * lists an index in key order beside it reads a page of no groups through
 * that.
 *
 * @param indexes - The binding's indexes
 * @param where - The narrowing
 * @param under - Where the block's keys stand, outermost first, each as a leading field holds it; none for keys under no group
 * @returns The index and the narrowing its cells are read under; `undefined` when none serves
 */
export function seriesIndexFor(indexes: readonly Index[], where: ReadonlyMap<string, Choice>, under: readonly RecordUnder[]):
    { readonly index: Index; readonly where: ReadonlyMap<string, Choice> } | undefined {
    let best: { index: Index; where: ReadonlyMap<string, Choice> } | undefined;
    for (const index of indexes) {
        if (index.series.type !== "some") continue;
        const filled = underFilled(index, where, under);
        if (!tileIndexServes(index, filled)) continue;
        if (best === undefined || index.fields.length > best.index.fields.length) best = { index, where: filled };
    }
    return best;
}

/**
 * Plan a cell of a summary index (#1433): some keys over a run of its tiles, a
 * range search for each key under each combination of the narrowing's values
 * of the index's leading fields, `[…on, key, from]` to `[…on, key, to]`.
 *
 * @param index - A summary index
 * @param where - The narrowing
 * @param run - Its tiles ({@link summaryRun})
 * @param keys - The keys, as `.east` literals of the index's key field
 * @returns The cell's searches, and the fields the reader asks of each event
 * @throws {Error} As {@link levelCellQueries} does, for a summary index
 */
export function summaryCellQueries(index: Index, where: ReadonlyMap<string, Choice>, run: { readonly from: Date; readonly to: Date },
    keys: readonly string[]): TileCellPlan {
    if (index.summary.type !== "some") throw new Error(`A summary's cell reads a summary index, and '${index.name}' is none`);
    const tiling = keyedTiling(index);
    if (tiling === undefined) {
        throw new Error(`'${index.name}' keeps the record's totals, under no key: its cells are a range of its tiles (totalsCellQueries)`);
    }
    checkRun(index, tiling.tile.type, run);
    const from = printTile(run.from);
    const to = printTile(run.to);
    const queries = leadingValues(index, where).flatMap(prefix => keys.map(key =>
        variant("range", { from: [...prefix, key, from], to: [...prefix, key, to] })));
    return { queries, residual: residualOf(index, tiling, where) };
}

/**
 * The whole tiles a read of the record's totals over a range `[from, to)`
 * reads (#1732): from the start of the tile holding `from` to the start of the
 * tile after the one holding its last instant. A total is split by tile, so a
 * tile's total is its own, and nothing outside the range's tiles counts in
 * them.
 *
 * @param tile - The totals' tile
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @returns The run, half-open
 */
export function totalsRun(tile: RecordTile, from: Date, to: Date): { readonly from: Date; readonly to: Date } {
    return { from: tileStart(tile, from), to: tileNext(tile, lastTile(tile, from, to)) };
}

/**
 * Plan a cell of the record's totals (#1732): a run of their tiles, a range
 * search under each combination of the narrowing's values of their leading
 * fields, `[…on, from]` to `[…on, to]` — the leading values one by one — each
 * holding that combination's total of each tile in the run.
 *
 * @param index - A summary index with no key ({@link totalsIndexFor})
 * @param where - The narrowing
 * @param run - Its tiles ({@link totalsRun})
 * @returns The cell's searches, and the fields of the narrowing its totals do not answer: none, for totals that serve it
 * @throws {Error} When the index keeps no record's totals; when the narrowing does not choose exact values of each of
 *   its leading fields (one of a Set's), or the combinations of them pass {@link MAX_RECORD_SLICE_RUNS}; or when the
 *   run's ends do not start tiles of its tile
 */
export function totalsCellQueries(index: Index, where: ReadonlyMap<string, Choice>, run: { readonly from: Date; readonly to: Date }): TileCellPlan {
    const totals = totalsOf(index);
    if (totals === undefined) {
        throw new Error(keyedTiling(index) !== undefined
            ? `'${index.name}' keeps a resource's totals, filed by key: the record's totals are a summary with no key, index.totals({ from, to, tile })`
            : `'${index.name}' keeps no totals: the record's totals are a summary with no key, index.totals({ from, to, tile })`);
    }
    checkRun(index, totals.tile.type, run);
    const from = printTile(run.from);
    const to = printTile(run.to);
    const queries = leadingValues(index, where).map(prefix => variant("range", { from: [...prefix, from], to: [...prefix, to] }));
    return { queries, residual: residualOf(index, totals, where) };
}

/**
 * The record's totals at a tile that a narrowing is read through (#1732): of
 * those whose leading fields it chooses exactly — one value of a field that
 * fans out over a Set, so no event is counted twice — and which leave none of
 * its choices to a reader, a total holding no event the narrowing does not
 * hold, the ones led by the most fields; of two led by as many, the one listed
 * first. The window's own range of their start field is no choice they leave:
 * a total is a tile's, whatever the window. Totals whose leading values the
 * narrowing chooses in more than {@link MAX_RECORD_SLICE_RUNS} combinations
 * serve it not, as a cell of them could not be planned.
 *
 * @param indexes - The binding's indexes
 * @param where - The narrowing
 * @param tile - The tile wanted
 * @returns The index, or `undefined` when none at the tile serves the narrowing
 */
export function totalsIndexFor(indexes: readonly Index[], where: ReadonlyMap<string, Choice>, tile: RecordTile): Index | undefined {
    let best: Index | undefined;
    for (const index of indexes) {
        const totals = totalsOf(index);
        if (totals === undefined || totals.tile.type !== tile || !leadingChosen(index, where) || residualOf(index, totals, where).length > 0) continue;
        if (!combinationsFit(index, where)) continue;
        if (best === undefined || index.fields.length > best.fields.length) best = index;
    }
    return best;
}

/** Whether the narrowing's values of an index's leading fields make no more combinations than a cell takes searches a key. */
function combinationsFit(index: Index, where: ReadonlyMap<string, Choice>): boolean {
    let combinations = 1;
    for (const field of index.fields) {
        const choice = where.get(field);
        combinations *= choice?.type === "values" ? new Set(choice.value).size : 0;
        if (combinations > MAX_RECORD_SLICE_RUNS) return false;
    }
    return true;
}
