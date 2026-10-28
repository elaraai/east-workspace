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
 *   filed at a level ends before the end of the tile after the one holding its
 *   start, so a reader finds every event at a level that overlaps a range by
 *   reading that level's tiles from the one before the range's first: a
 *   **run** ({@link levelRuns}).
 * - A **summary index** keeps one entry for each key in each of its tiles,
 *   `{ on, key, tile }` → `{ count, ms }`, standing for every event touching
 *   it; a reader reads its tiles over the range ({@link summaryRun}).
 *
 * A **cell** is some keys over one run: what a reader reads of either index
 * for a block of its rows. Each key of a cell is one range search — the key
 * leads the tile in either index's key — holding exactly that key's entries in
 * the run, so a cell's searches hold its keys' entries and no others, in
 * whatever order its keys come — a block of rows narrowed or ordered by
 * another index included. A reader asks every cell it wants in one batch of
 * searches, which counts each cell's entries before one is read, and reads
 * them in one batch of runs: one range a key a level, whatever the range's
 * width.
 *
 * Neither index serves the rail's narrowing (`record-plan.ts`): a series index
 * files an event past a year under each year it touches, so its runs would
 * count the event more than once, and a summary index's entries name no row.
 * A narrowing reaches a cell through the index's leading fields, chosen
 * exactly; what else it chooses is the reader's to ask of the events it draws
 * (`within`).
 *
 * The tiles are e3's, to the millisecond (`index.series`): a day and
 * an ISO week counted in whole milliseconds from the epoch and from the Monday
 * before it, so an instant before 1970 is tiled as one after it; a month, a
 * quarter and a year by the UTC calendar.
 */
import { DateTimeType, equalFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";
import { RecordSliceTileType, type RecordSliceChoiceType, type RecordSliceIndexType, type RecordSliceTilingType } from "./record-types.js";
import { MAX_RECORD_SLICE_RUNS } from "./record-plan.js";

type Choice = ValueTypeOf<RecordSliceChoiceType>;
type Index = ValueTypeOf<RecordSliceIndexType>;
type Tiling = ValueTypeOf<RecordSliceTilingType>;

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
}

/** The marker's name for a summary index. */
const SUMMARY_MARKER = "__summary";
const TILE_ROLES = ["key", "from", "to", "tile"] as const;

/**
 * The names of the struct `Data.bindPaged` marks a series or a summary index
 * with in a binding's index metadata — its kind's `series` or `summary` case
 * (#1432), as an area index's case names its box: the key, start and end
 * fields and the tile, each named with its role (`key=…`), and `__summary` for
 * a summary index. A marker's names are the kind's own, never a row field
 * among the index's.
 *
 * @param marker - How the index files the record's events
 * @returns The marker struct's field names, in order
 */
export function tileMarkerFields(marker: TileMarker): string[] {
    return [`key=${marker.key}`, `from=${marker.from}`, `to=${marker.to}`, `tile=${marker.tile}`, ...(marker.summary ? [SUMMARY_MARKER] : [])];
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
    let summary = false;
    for (const name of names) {
        if (name === SUMMARY_MARKER) {
            if (summary) return undefined;
            summary = true;
            continue;
        }
        const at = name.indexOf("=");
        const role = name.slice(0, Math.max(at, 0));
        if (at <= 0 || !(TILE_ROLES as readonly string[]).includes(role) || roles.has(role)) return undefined;
        roles.set(role, name.slice(at + 1));
    }
    const key = roles.get("key"), from = roles.get("from"), to = roles.get("to"), tile = RECORD_TILES.find(t => t === roles.get("tile"));
    if (key === undefined || from === undefined || to === undefined || tile === undefined) return undefined;
    return { key, from, to, tile, summary };
}

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;
/** An ISO week, in milliseconds. */
const WEEK_MS = 604_800_000;
/** 1969-12-29T00:00:00Z, the Monday before the epoch, in milliseconds: where weeks are counted from. */
const MONDAY_MS = -259_200_000;

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

/**
 * How a series or a summary index files a record's events: the index's own
 * metadata, or `undefined` for an index of another kind.
 *
 * @param index - The index
 * @returns Its key, start and end fields and its tile
 */
export function tilingOf(index: Index): Tiling | undefined {
    return index.series.type === "some" ? index.series.value : index.summary.type === "some" ? index.summary.value : undefined;
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
    if (tilingOf(index) === undefined) return false;
    return index.fields.every(field => {
        const choice = where.get(field);
        return choice?.type === "values" && choice.value.length > 0 && (!index.sets.has(field) || new Set(choice.value).size === 1);
    });
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
        const tiling = which === "series" ? index.series : index.summary;
        if (tiling.type !== "some" || !accept(tiling.value.tile.type) || !tileIndexServes(index, where)) continue;
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
 * run a level, each from two tiles before the one holding `from` — the tile
 * before it, which may hold an event reaching into the range, and the one a
 * pan back reaches first — to the one after the tile holding the range's last
 * instant, the one a pan on reaches first.
 *
 * @param tile - The declared tile
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @returns A run a level, the finest first
 */
export function levelRuns(tile: RecordTile, from: Date, to: Date): TileRun[] {
    return levelsOf(tile).map(level => ({
        level,
        from: tilePrevious(level, tilePrevious(level, tileStart(level, from))),
        to: tileNext(level, tileNext(level, lastTile(level, from, to))),
    }));
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
        if (prefixes.length * values.length > MAX_RECORD_SLICE_RUNS) {
            throw new Error(`A cell of '${index.name}' needs more than ${MAX_RECORD_SLICE_RUNS} searches a key; choose fewer values`);
        }
        prefixes = prefixes.flatMap(prefix => values.map(value => [...prefix, value]));
    }
    return prefixes;
}

/** The fields of a narrowing a cell's searches leave to the reader: all but the leading fields and a range of the start field. */
function residualOf(index: Index, tiling: Tiling, where: ReadonlyMap<string, Choice>): string[] {
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
 * Plan a cell of a series index (#1433): some keys over one level's run, a
 * range search for each key under each combination of the narrowing's values
 * of the index's leading fields, `[…on, key, level, from]` to
 * `[…on, key, level, to]` — the key flattened, the leading values one by one
 * (#1432) — holding that key's entries at that level in the run's tiles and
 * no other's. A range of the index's start field — the window — is the
 * reader's: its runs cover it.
 *
 * @param index - A series index ({@link tileIndexFor})
 * @param where - The narrowing
 * @param run - The level and its tiles ({@link levelRuns})
 * @param keys - The keys, as `.east` literals of the index's key field
 * @returns The cell's searches, and the fields the reader asks of each event
 * @throws {Error} When the index is no series index, when the narrowing does
 *   not choose exact values of each of its leading fields (one of a Set's), when
 *   the combinations of them pass {@link MAX_RECORD_SLICE_RUNS}, when the
 *   index files at no such level, or when the run's ends do not start tiles of
 *   its level
 */
export function levelCellQueries(index: Index, where: ReadonlyMap<string, Choice>, run: TileRun, keys: readonly string[]): TileCellPlan {
    if (index.series.type !== "some") throw new Error(`A level's cell reads a series index, and '${index.name}' is none`);
    const tiling = index.series.value;
    if (!levelsOf(tiling.tile.type).includes(run.level)) {
        throw new Error(`'${index.name}' files at ${levelsOf(tiling.tile.type).join(", ")}: no ${run.level} run`);
    }
    checkRun(index, run.level, run);
    const level = printLevel(variant(run.level, null));
    const from = printTile(run.from);
    const to = printTile(run.to);
    const queries = leadingValues(index, where).flatMap(prefix => keys.map(key =>
        variant("range", { from: [...prefix, key, level, from], to: [...prefix, key, level, to] })));
    return { queries, residual: residualOf(index, tiling, where) };
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
    const tiling = index.summary.value;
    checkRun(index, tiling.tile.type, run);
    const from = printTile(run.from);
    const to = printTile(run.to);
    const queries = leadingValues(index, where).flatMap(prefix => keys.map(key =>
        variant("range", { from: [...prefix, key, from], to: [...prefix, key, to] })));
    return { queries, residual: residualOf(index, tiling, where) };
}
