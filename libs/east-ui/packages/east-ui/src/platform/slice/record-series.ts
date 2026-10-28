/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Queries for e3's series and summary indexes (#1039), the twin of
 * `record-interval.ts` and `record-area.ts`: a record's events filed by the key
 * they are on — a Plan's resource — and by each time tile they touch,
 * `{ …on, __tile, <key> }`. A series index holds an entry for each event in
 * each tile it touches, carrying the row; a summary index one entry for each
 * key in each tile, `{ count, ms }`, standing for every event touching it.
 *
 * A **cell** is some keys in one tile: what a reader reads of either index for
 * a block of its rows. Each key of a cell is one search, `[…on, tile, key]`,
 * which holds exactly that key's entries in that tile, so a cell's searches
 * hold its keys' entries and no others, in whatever order its keys come — a
 * block of rows narrowed or ordered by another index included. A reader asks
 * every cell it wants in one batch of searches, which counts each cell's
 * entries before one is read, and reads them in one batch of runs.
 *
 * Neither index serves the rail's narrowing (`record-plan.ts`): a series index
 * files an event under each tile it touches, so its runs would count the event
 * more than once, and a summary index's entries name no row. A narrowing
 * reaches a cell through the index's leading fields, chosen exactly; what else
 * it chooses is the reader's to ask of the events it draws (`within`).
 *
 * The tiles are e3's, to the millisecond (`e3.recordIndex.series`): a day and
 * an ISO week counted in whole milliseconds from the epoch and from the Monday
 * before it, so an instant before 1970 is tiled as one after it; a month, a
 * quarter and a year by the UTC calendar.
 */
import { DateTimeType, equalFor, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";
import type { RecordSliceChoiceType, RecordSliceIndexType, RecordSliceTileType, RecordSliceTilingType } from "./record-types.js";
import { MAX_RECORD_SLICE_RUNS } from "./record-plan.js";

type Choice = ValueTypeOf<RecordSliceChoiceType>;
type Index = ValueTypeOf<RecordSliceIndexType>;
type Tiling = ValueTypeOf<RecordSliceTilingType>;

/** A series or a summary index's tile field: the tile's start, after the index's leading fields and before its key. */
export const TILE_FIELD = "__tile";

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
 * The names of the struct `Data.bindPaged` marks a series or a summary index's
 * `__tile` with in a binding's index metadata, as an area index's `__area` is
 * marked with its box: the key, start and end fields and the tile, each named
 * with its role (`key=…`), and `__summary` for a summary index.
 *
 * @param marker - How the index files the record's events
 * @returns The marker struct's field names, in order
 */
export function tileMarkerFields(marker: TileMarker): string[] {
    return [`key=${marker.key}`, `from=${marker.from}`, `to=${marker.to}`, `tile=${marker.tile}`, ...(marker.summary ? [SUMMARY_MARKER] : [])];
}

/**
 * Read a series or a summary index's filing back from its `__tile` marker's
 * field names ({@link tileMarkerFields}).
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
 * The tiles a span `[from, to)` overlaps, as e3 files an event over them: each
 * tile's start, in order — the one tile holding `from` when `to` is at or
 * before it.
 *
 * @param tile - The tile
 * @param from - The span's start
 * @param to - Its end, exclusive
 * @param limit - The most tiles to list, at least one
 * @returns The tiles' starts; `undefined` when the span overlaps more than `limit` of them
 * @throws {Error} When `limit` is below one
 */
export function tilesOver(tile: RecordTile, from: Date, to: Date, limit: number): Date[] | undefined {
    if (!(limit >= 1)) throw new Error(`A span's tiles are listed one at least, not ${limit}`);
    let at = tileStart(tile, from);
    if (to.getTime() <= from.getTime()) return [at];
    const tiles: Date[] = [];
    while (at.getTime() < to.getTime()) {
        if (tiles.length >= limit) return undefined;
        tiles.push(at);
        at = tileNext(tile, at);
    }
    return tiles;
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
    return index.fields.slice(0, -2).every(field => {
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
     *  range of its start field, which the tiles cover. The reader asks of each event it draws whether the
     *  narrowing holds it (`within`); none, and every entry is the narrowing's. */
    readonly residual: readonly string[];
}

const printTile = printFor(DateTimeType);
const sameInstant = equalFor(DateTimeType);

/**
 * Plan a cell of a series or a summary index: some keys in one tile, a search
 * for each key under each combination of the narrowing's values of the index's
 * leading fields, `[…on, tile, key]`, holding that key's entries in that tile
 * and no other's. A range of the index's start field — the window — is the
 * reader's: its tiles cover it.
 *
 * @param index - A series or a summary index ({@link tileIndexFor})
 * @param where - The narrowing
 * @param tile - The tile's start ({@link tilesOver})
 * @param keys - The keys, as `.east` literals of the index's key field
 * @returns The cell's searches, and the fields the reader asks of each event
 * @throws {Error} When the index is neither, when the narrowing does not choose
 *   exact values of each of its leading fields (one of a Set's), when the
 *   combinations of them pass {@link MAX_RECORD_SLICE_RUNS}, or when `tile` is
 *   not the start of one of the index's tiles
 */
export function tileCellQueries(index: Index, where: ReadonlyMap<string, Choice>, tile: Date, keys: readonly string[]): TileCellPlan {
    const tiling = tilingOf(index);
    if (tiling === undefined) throw new Error(`A cell reads a series or a summary index, and '${index.name}' is neither`);
    if (!sameInstant(tileStart(tiling.tile.type, tile), tile)) {
        throw new Error(`${printTile(tile)} starts no ${tiling.tile.type} tile of '${index.name}'`);
    }
    const leading = index.fields.slice(0, -2);
    let prefixes: string[][] = [[]];
    for (const field of leading) {
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
    const at = printTile(tile);
    const queries = prefixes.flatMap(prefix => keys.map(key => variant("fields", { values: [...prefix, at, key], prefix: none })));
    const residual = [...where].filter(([field, choice]) => !leading.includes(field) && !(field === tiling.from && choice.type === "range"))
        .map(([field]) => field);
    return { queries, residual };
}
