/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What a group's own row counts of the events beneath it (#1716): over rows
 * read a page at a time, each group's row in view — and a section's header
 * drawn inside a group — says how many events land beneath it, a column at a
 * time, open or folded, at every zoom its records' totals divide.
 *
 * # Which records, and which totals
 *
 * A group's row counts the records whose kinds land on a series nested in its
 * own (the landing's `within`). To read a page of rows the Plan already fills
 * a kind's series index in time order's last leading fields from the groups
 * above each row (`standingFields`, `cells.ts`'s "In time order"): a row one
 * step down a path is named by the first of those fields, two steps down by
 * the second. The counts take the same match: a group's row whose path holds
 * `d` steps chooses the first `d` of them, each the key of the step it names,
 * and reads the record's totals the narrowing then chooses exactly
 * (`totalsIndexFor`): `index.totals({ on: ["hall"], … })` for a hall's row,
 * `on: ["hall", "line"]` for a line's. Nothing is declared on the kinds or
 * the series: a record whose source lists no totals led by those fields is
 * not counted, and the row's hover names it. So is a record whose totals keep
 * no period dividing the columns, and one the rail's filters narrow by what
 * its totals cannot answer ({@link bandRead}): a count never leaves a filter
 * out.
 *
 * A section's header adds no step to a path: inside a group it counts as the
 * group's row does, the records landing within the section alone; at the top
 * of a paged Plan its path is none, its rows span every window, and it counts
 * nothing.
 *
 * The kinds of one record's cases read through one source and count once. A
 * kind the viewer hides in the Series tab is counted while another of its
 * record's shows, and the hover says so; a record every kind of which is
 * hidden, or which lands only on series hidden, is not counted at all.
 *
 * # When, and how much
 *
 * The reader is a component of its own beside the events' (`events.ts`), so
 * nothing the rows draw waits on it, and it asks for nothing while the rows'
 * own reads are on their way — the windows the view waits for, the events'
 * cells, and the events of a period the columns have just taken — nor until
 * the frame's loading line has cleared: the line stays a while once shown, so
 * that it never blinks, and counts drawn as it was due to clear kept it on
 * the screen. The reader times the line on a clock of its own, over the reads
 * the frame's runs on, so neither its requests nor its drawing come before
 * the rows'. It takes what it reads over a commit late: the events' reader
 * starts its reads in the render that moves the rows in view or the columns,
 * and the canvas hears they are in flight only as that render commits. It
 * reads as the canvas's scroll comes to rest, for the group rows the view
 * shows ({@link PlanBandSpanStore}): one
 * search a row a record, covering every column, at the largest of the tiles
 * dividing the columns the record's totals are kept at (`dividingTiles`), each
 * totals index's searches in one request. What it reads it keeps itself, as a
 * shading keeps its summaries, for the record's revision over the period
 * around the window — the window's month at a day's zoom, its quarter at a
 * week's, its year beyond — so a scroll back, or a pan within that period,
 * reads nothing; the rows it has read there are asked for again with the rows
 * in view, a few screens' worth, so none is read twice. A row's counts say the
 * period they were read at, and a row draws only those of the period its
 * columns take: a zoom draws none of the last period's on its new columns,
 * and lays none of them out again.
 *
 * A count is how many events touch a column: the tiles inside it added up. An
 * event that runs over several tiles of a column is counted in each of them —
 * a three-day job three times in a week's column of day totals — so a record
 * that keeps its totals at the columns' own period counts each event once.
 *
 * The counts are e3's: an edit not yet saved shows once it is.
 *
 * @packageDocumentation
 */

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SortedMap, StringType, compareFor, equalFor, variant, type ValueTypeOf } from "@elaraai/east";
import { planHideId, type PlanPayloadType } from "@elaraai/e3-ui/internal";
import {
    RECORD_TILES, standingFields, totalsIndexFor, totalsOf, totalsRun, type RecordSliceChoiceType, type RecordSliceWhereType, type RecordTile,
} from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { RecordSliceKeptCells, recordSliceTotalsOf, useLoadingReveal, type RecordSliceTileTotals } from "@elaraai/east-ui-components/internal";
import { dividingTiles, shadesOf, type ScheduleCellBucket, type ScheduleCellTotals } from "../../shared/schedule/cells.js";
import { underOf } from "../../shared/schedule/series-groups.js";
import type { TimeResolution } from "../../shared/time/scale.js";
import { hides } from "../frame/hidden.js";
import type { PlanScale } from "../scale.js";
import { bucketsOver } from "./cells.js";
import type { PlanEventRange } from "./events.js";
import type { PlanLandingValue } from "./landings.js";
import type { PlanEventPart, PlanSourcePart } from "./sources.js";

/** One event kind, as the payload carries it. */
type EventKind = ValueTypeOf<typeof PlanPayloadType>["events"][number];
/** A record Slice's narrowing. */
type Where = ValueTypeOf<RecordSliceWhereType>;
/** One choice of a narrowing. */
type Choice = ValueTypeOf<typeof RecordSliceChoiceType>;

const stringEqual = equalFor(StringType);
const compareString = compareFor(StringType);

// ============================================================================
// The group rows in view
// ============================================================================

/** A group's own row, or a section's header, in view, as the canvas reports it as its scroll rests (#1716). */
export interface PlanBandInView {
    /** The row's key. */
    readonly key: string;
    /** Its series: the group's, or the section's. */
    readonly series: string;
    /** Its path: a group row's, its own key last; a section header's, the entry it is drawn in — none at the top. */
    readonly path: readonly string[];
}

/** Where the canvas reports the group rows in view as its scroll rests (#1716): a store of the last report. */
export interface PlanBandSpanStore {
    /** The rows last reported, in the view's order; none before any is. */
    get(): readonly PlanBandInView[];
    /** Reports the rows in view: the same rows reported again move nothing. */
    set(bands: readonly PlanBandInView[]): void;
    /** Listens for rows that move; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

/** No group row in view. */
const NO_BANDS: readonly PlanBandInView[] = [];

/** Whether two reports name the same rows, in the same order. */
function sameBands(a: readonly PlanBandInView[], b: readonly PlanBandInView[]): boolean {
    return a.length === b.length && a.every((band, i) => stringEqual(band.key, b[i]!.key));
}

/**
 * A store of the group rows in view (#1716): the canvas writes it as its scroll comes to rest, beside the span of the
 * resources' rows its events' reader reads, and the counts' reader reads it — the canvas renders nothing for it.
 *
 * @returns The store
 */
export function createBandSpanStore(): PlanBandSpanStore {
    let bands = NO_BANDS;
    const listeners = new Set<() => void>();
    return {
        get: () => bands,
        set(next) {
            if (sameBands(next, bands)) return;
            bands = next.length === 0 ? NO_BANDS : next;
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

// ============================================================================
// What a group's row draws
// ============================================================================

/** One column a group's row counts events in (#1716). */
export interface PlanBandColumn {
    /** The column's start. */
    readonly at: Date;
    /** How many events touch it, every record's together. */
    readonly total: number;
    /** Each record's share, by its kinds' names, in the kinds' order: those with none in the column left out. */
    readonly shares: readonly { readonly names: string; readonly count: number }[];
}

/** Why a record beneath a group's row is not counted (#1716). */
export type PlanBandUncountedWhy =
    /** Its source lists no totals led by the fields that name the row's group. */
    | "totals"
    /** It lists them at no period that divides the columns. */
    | "zoom"
    /** The rail chooses what they cannot answer: a count never leaves a filter out. */
    | "filters";

/** A record beneath a group's row that it does not count (#1716). */
export interface PlanBandUncounted {
    /** Its kinds' names, as one. */
    readonly names: string;
    /** Why it is not counted. */
    readonly why: PlanBandUncountedWhy;
    /** The fields its totals would be led by, outermost first: what the hover names them by. */
    readonly fields: readonly string[];
}

/** What a group's own row draws of the events beneath it (#1716). */
export interface PlanBandCounts {
    /** Each column with events, in order. */
    readonly columns: readonly PlanBandColumn[];
    /** The largest count of a column of any row of its series the reader holds: the one scale a level's rows tint on. */
    readonly top: number;
    /** The records beneath it it does not count. */
    readonly uncounted: readonly PlanBandUncounted[];
    /** The kinds the viewer hides that it counts, by their names: their records' other kinds show. */
    readonly hidden: readonly string[];
    /** The columns' period they were read at: a row whose columns take another draws none of them. */
    readonly period: TimeResolution | undefined;
}

/** Where the counts' reader hands each group's row its counts (#1716): a store each row reads its own from. */
export interface PlanBandCountsStore {
    /** A row's counts; `undefined` for a row with none — not read, or counting nothing. */
    get(key: string): PlanBandCounts | undefined;
    /** Hands on the counts: a row whose counts are the object they were draws nothing again. */
    set(next: ReadonlyMap<string, PlanBandCounts>): void;
    /** Listens for counts that move; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

/** No group row's counts. */
const NO_COUNTS: ReadonlyMap<string, PlanBandCounts> = new Map();

/**
 * A store of the group rows' counts (#1716): the counts' reader writes it, and each group's row reads its own entry,
 * so counts that land draw again the rows whose numbers moved, and no other.
 *
 * @returns The store
 */
export function createBandCountsStore(): PlanBandCountsStore {
    let held = NO_COUNTS;
    const listeners = new Set<() => void>();
    return {
        get: (key) => held.get(key),
        set(next) {
            if (next === held) return;
            held = next;
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

/** The group rows' counts the canvas's rows read (#1716); `null` outside a canvas whose rows are read a page at a time. */
export const PlanBandCountsContext = createContext<PlanBandCountsStore | null>(null);

/** Listens to nothing: a row outside a canvas that counts. */
const NO_SUBSCRIBE = (): (() => void) => () => undefined;

/**
 * A group's row's counts (#1716), read from the canvas's store: the row draws again as its own move, and as no other
 * row's do.
 *
 * @param key - The row's key
 * @returns Its counts; `undefined` for none
 */
export function usePlanBandCounts(key: string): PlanBandCounts | undefined {
    const store = useContext(PlanBandCountsContext);
    const get = useCallback(() => store?.get(key), [store, key]);
    return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, get, get);
}

// ============================================================================
// Which records a row counts
// ============================================================================

/** A record a group's row counts the events of (#1716). */
export interface PlanBandSource {
    /** Its source's name in the slice: the kinds of one record's cases read through it, and count once. */
    readonly source: string;
    /** Its source's part: what its totals are read through. */
    readonly part: PlanSourcePart;
    /** Its kinds landing beneath the row the viewer shows, by their names, in the kinds' order. */
    readonly names: readonly string[];
    /** Those it hides in the Series tab, counted with them. */
    readonly hidden: readonly string[];
    /** The fields that name the row's group, outermost first, each with the `.east` literal of the key it holds there. */
    readonly choices: readonly { readonly field: string; readonly literal: string }[];
}

/** The records a group's row counts, and those beneath it it cannot (#1716). */
export interface PlanBandPlan {
    readonly sources: readonly PlanBandSource[];
    readonly uncounted: readonly PlanBandUncounted[];
}

/** A row that counts nothing. */
const NO_PLAN: PlanBandPlan = { sources: [], uncounted: [] };

/**
 * The records a group's row counts (see the module docs): the kinds landing on a series nested in its own, by their
 * sources — each the fields of its series index in time order that name the row's group, with the keys its path
 * holds. A record whose source lists no totals led by those fields, or whose fields cannot hold the keys, is named
 * among those not counted; a kind the viewer hides counts while another of its record's shows.
 *
 * @param band - The row
 * @param kinds - The event kinds, as the payload carries them
 * @param landings - The series they land on
 * @param parts - The kinds narrowed through their sources, and their parts
 * @param hidden - The ids the viewer hides in the Series tab
 * @returns What it counts; nothing for a row at the top of the path — a section's header there
 */
export function planBandSources(
    band: PlanBandInView, kinds: readonly EventKind[], landings: readonly PlanLandingValue[], parts: readonly PlanEventPart[], hidden: readonly string[],
): PlanBandPlan {
    const d = band.path.length;
    if (d === 0) return NO_PLAN;
    // Each record beneath it, by its source: its kinds, and every nesting depth its resources stand under.
    const bySource = new Map<string, { part: PlanSourcePart | undefined; kinds: EventKind[]; standings: Set<number> }>();
    for (const landing of landings) {
        if (!landing.within.some((key) => stringEqual(key, band.series))) continue;
        // A landing the viewer hides, or one nested in a series hidden, draws nothing, and is counted nowhere.
        if ([...landing.within, landing.key].some((key) => hides(hidden, planHideId.series(key)))) continue;
        // The steps before its resources' keys: a row a step beneath a resource stands under the resource's.
        const standing = Number(landing.depth) - (landing.under.type === "some" ? 2 : 1);
        for (const slot of landing.kinds) {
            const kind = kinds.find((one) => stringEqual(one.key, slot));
            if (kind === undefined || standing < d) continue;
            let held = bySource.get(kind.source);
            if (held === undefined) {
                held = { part: parts.find((p) => stringEqual(p.kind.key, slot))?.part, kinds: [], standings: new Set() };
                bySource.set(kind.source, held);
            }
            held.standings.add(standing);
            if (!held.kinds.some((one) => stringEqual(one.key, kind.key))) held.kinds.push(kind);
        }
    }
    const sources: PlanBandSource[] = [];
    const uncounted: PlanBandUncounted[] = [];
    for (const [source, { part, kinds: mine, standings }] of bySource) {
        const shown = mine.filter((kind) => !hides(hidden, planHideId.events(kind.key)));
        // Every kind of it hidden: the viewer took it off the canvas, and it is counted nowhere.
        if (shown.length === 0) continue;
        const names = shown.map((kind) => kind.name);
        const indexes = part?.config.indexes ?? [];
        // The fields the Plan fills from the rows above its resources, outermost first: the first `d` name this row.
        // When one source lands at multiple nesting depths beneath this band, every depth must resolve to the same `d` fields.
        let fields: readonly string[] | undefined;
        for (const standing of standings) {
            const resolved = indexes.map((index) => standingFields(index, standing)).find((one) => one !== undefined)?.slice(0, d);
            if (resolved === undefined || resolved.length < d) { fields = undefined; break; }
            if (fields === undefined) fields = resolved;
            else if (!fields.every((field, i) => stringEqual(field, resolved[i]!))) { fields = undefined; break; }
        }
        const led = fields !== undefined && indexes.some((index) => totalsOf(index) !== undefined
            && fields.every((field) => index.fields.some((one) => stringEqual(one, field))));
        // Each of them with the key of the step of the row's path it names, as the field holds it.
        const choices: { field: string; literal: string }[] = [];
        for (const [i, field] of (fields ?? []).entries()) {
            const literal = underOf(mine[0]!.cellsType, band.path[i]!)(field);
            if (literal !== undefined) choices.push({ field, literal });
        }
        if (part === undefined || fields === undefined || !led || choices.length < d) {
            uncounted.push({ names: names.join(", "), why: "totals", fields: fields ?? [] });
            continue;
        }
        sources.push({
            source, part, names, choices,
            hidden: mine.filter((kind) => hides(hidden, planHideId.events(kind.key))).map((kind) => kind.name),
        });
    }
    return sources.length === 0 && uncounted.length === 0 ? NO_PLAN : { sources, uncounted };
}

/**
 * A source's narrowing with a row's group chosen (#1716): each field that names it its key, where the narrowing leaves
 * the field; where it chooses values of it, the key among them alone.
 *
 * @param where - The source's narrowing
 * @param choices - The fields and the keys that name the row's group
 * @returns The narrowing; `"none"` where the narrowing chooses keys of the group's that are not this row's — it holds
 *   none of the row's events; `undefined` where it chooses a field otherwise than by its values
 */
export function bandWhere(where: Where, choices: PlanBandSource["choices"]): Where | "none" | undefined {
    // A narrowing is a Dict of its fields' choices: in its fields' order, as one decoded is.
    const out = new SortedMap<string, Choice>([...where], compareString);
    for (const { field, literal } of choices) {
        const chosen = where.get(field);
        if (chosen !== undefined && chosen.type !== "values") return undefined;
        if (chosen !== undefined && !chosen.value.some((value) => stringEqual(value, literal))) return "none";
        out.set(field, variant("values", [literal]));
    }
    return out;
}

/**
 * How a group's row reads a record's totals (#1716): under its narrowing at a tile; nothing, the narrowing holding
 * none of the row's events; or not at all, and why.
 */
export type PlanBandRead =
    | { readonly where: Where; readonly tile: RecordTile }
    | { readonly none: true }
    | { readonly why: PlanBandUncountedWhy };

/**
 * How a group's row reads a record's totals (#1716): through the totals that serve its narrowing — the source's own,
 * the row's group chosen ({@link bandWhere}) — at the largest of the tiles dividing the columns they are kept at.
 * Where none serves it there, why: totals that serve the narrowing the row's events are held to whatever the viewer
 * chooses — the page's scope, and the row's group — at such a tile leave the filters what they cannot answer; totals
 * that serve it, or the narrowing, at another period alone leave the zoom; and with neither, the record keeps no totals
 * led by the fields that name the group.
 *
 * @param config - The record's source's config: its indexes, and the fields its page's scope holds
 * @param where - The source's narrowing, its page's scope among it
 * @param choices - The fields and the keys that name the row's group ({@link PlanBandSource.choices})
 * @param tiles - The tiles dividing the columns, the largest first (`dividingTiles`)
 * @returns The narrowing and the tile; nothing to read; or why the row does not count the record
 */
export function bandRead(
    config: PlanSourcePart["config"], where: Where, choices: PlanBandSource["choices"], tiles: readonly RecordTile[],
): PlanBandRead {
    const chosen = bandWhere(where, choices);
    if (chosen === "none") return { none: true };
    const served = (narrowing: Where, at: readonly RecordTile[]) => at.find((tile) => totalsIndexFor(config.indexes, narrowing, tile) !== undefined);
    const tile = chosen === undefined ? undefined : served(chosen, tiles);
    if (chosen !== undefined && tile !== undefined) return { where: chosen, tile };
    // The narrowing the row's events are held to whatever the viewer chooses: the page's scope, and the row's group.
    const held = bandWhere(new SortedMap<string, Choice>([...where].filter(([field]) => config.scope.has(field)), compareString), choices);
    if (held === "none" || held === undefined) return { none: true };
    if (served(held, tiles) !== undefined) return { why: "filters" };
    const elsewhere = served(held, RECORD_TILES) !== undefined || (chosen !== undefined && served(chosen, RECORD_TILES) !== undefined);
    return { why: elsewhere ? "zoom" : "totals" };
}

/** The period around the range a counts' read is kept over, by the columns' period: a pan within it reads nothing. */
const KEPT_OVER: Readonly<Record<TimeResolution, RecordTile>> = {
    hour: "day", day: "month", week: "quarter", month: "year", quarter: "year", year: "year",
};

/** How many of the group rows read at one period a reader asks for again with the rows in view: a few screens' worth. */
export const BAND_ROWS_KEPT = 90;

/** How many periods' reads a reader keeps the group rows of. */
const PERIODS_KEPT = 4;

/** What a read is still waiting on. */
const READING = "reading";

/** A source's read at a tile: the rows asking it, each with its narrowing. */
interface TileRead {
    readonly part: PlanSourcePart;
    readonly tile: RecordTile;
    readonly rows: { readonly band: number; readonly source: number; readonly where: Where }[];
}

/** A tile's totals as numbers, which a shading folds. */
function asNumbers(tiles: ReadonlyMap<number, RecordSliceTileTotals>): Map<number, ScheduleCellTotals> {
    return new Map([...tiles].map(([at, t]) => [at, { count: Number(t.count), ms: Number(t.ms) }] as const));
}

/**
 * The counts of some group rows (see the module docs): each row's records read through their totals at the largest
 * tile dividing the columns that serves the row's narrowing, every source's reads asked before any is waited on, and
 * folded into the columns. A tracked read, run under the host's evaluation.
 *
 * @param bands - The rows
 * @param plans - What each counts ({@link planBandSources}), in their order
 * @param resolution - The columns' period
 * @param buckets - The columns
 * @param over - The period around the range the read is kept over
 * @param kept - The reader's cells: what it read, kept for each record's revision
 * @param place - What the reads are kept for among the reader's: that period's
 * @returns Each row's counts, by its key — a row that counts nothing left out; {@link READING} while a read is in flight
 * @throws {Error} As a source's read of its totals does
 */
export function readBandCounts(
    bands: readonly PlanBandInView[], plans: readonly PlanBandPlan[], resolution: TimeResolution | undefined,
    buckets: readonly ScheduleCellBucket[], over: { readonly from: Date; readonly to: Date }, kept: RecordSliceKeptCells, place: string,
): Map<string, PlanBandCounts> | typeof READING {
    const tiles = dividingTiles(resolution);
    // Each row's records not counted at this zoom or under these filters, beside those its plan names.
    const notCounted = plans.map((plan) => [...plan.uncounted]);
    // Each row's records' totals by tile, by the record's place among its plan's; a record its narrowing leaves none of
    // the row's events counts nothing.
    const read = plans.map((plan) => plan.sources.map((): ReadonlyMap<number, RecordSliceTileTotals> | undefined => undefined));
    const reads = new Map<string, TileRead>();
    plans.forEach((plan, b) => {
        plan.sources.forEach((source, s) => {
            const how = bandRead(source.part.config, source.part.read().where, source.choices, tiles);
            if ("none" in how) { read[b]![s] = new Map(); return; }
            if ("why" in how) {
                notCounted[b]!.push({ names: source.names.join(", "), why: how.why, fields: source.choices.map((c) => c.field) });
                return;
            }
            const at = `${source.source}\u0000${how.tile}`;
            let held = reads.get(at);
            if (held === undefined) { held = { part: source.part, tile: how.tile, rows: [] }; reads.set(at, held); }
            held.rows.push({ band: b, source: s, where: how.where });
        });
    });
    let pending = false;
    for (const { part, tile, rows } of reads.values()) {
        const got = recordSliceTotalsOf(part, kept, place, rows.map((row) => row.where), tile, over.from.getTime(), over.to.getTime());
        if (got.type !== "some") { pending = true; continue; }
        rows.forEach((row, i) => { read[row.band]![row.source] = got.value[i] ?? new Map(); });
    }
    if (pending) return READING;
    // Each row's columns: its records' tiles inside each column added up.
    const columns = plans.map((plan, b) => {
        const shades = plan.sources.map((_source, s) => {
            const tilesRead = read[b]![s];
            return tilesRead === undefined ? undefined : shadesOf(asNumbers(tilesRead), buckets, false);
        });
        const out: PlanBandColumn[] = [];
        buckets.forEach((bucket, k) => {
            const shares: { names: string; count: number }[] = [];
            plan.sources.forEach((source, s) => {
                const value = shades[s]?.[k]?.value;
                const count = value?.type === "some" ? value.value : 0;
                if (count > 0) shares.push({ names: source.names.join(", "), count });
            });
            const total = shares.reduce((sum, share) => sum + share.count, 0);
            if (total > 0) out.push({ at: new Date(bucket.start), total, shares });
        });
        return out;
    });
    // One scale a level: the largest column of any row of the same series held.
    const tops = new Map<string, number>();
    bands.forEach((band, b) => {
        const most = columns[b]!.reduce((max, column) => Math.max(max, column.total), 0);
        tops.set(band.series, Math.max(tops.get(band.series) ?? 0, most));
    });
    const out = new Map<string, PlanBandCounts>();
    bands.forEach((band, b) => {
        const plan = plans[b]!;
        if (plan.sources.length === 0 && notCounted[b]!.length === 0) return;
        const hiddenCounted = plan.sources.flatMap((source) => source.hidden);
        out.set(band.key, { columns: columns[b]!, top: tops.get(band.series) ?? 0, uncounted: notCounted[b]!, hidden: hiddenCounted, period: resolution });
    });
    return out;
}

/** Whether two rows' counts draw the same. */
function sameCounts(a: PlanBandCounts, b: PlanBandCounts): boolean {
    return a.period === b.period && a.top === b.top && a.columns.length === b.columns.length
        && a.columns.every((column, i) => {
            const other = b.columns[i]!;
            return column.at.getTime() === other.at.getTime() && column.total === other.total && column.shares.length === other.shares.length
                && column.shares.every((share, j) => stringEqual(share.names, other.shares[j]!.names) && share.count === other.shares[j]!.count);
        })
        && a.uncounted.length === b.uncounted.length
        && a.uncounted.every((one, i) => stringEqual(one.names, b.uncounted[i]!.names) && one.why === b.uncounted[i]!.why)
        && a.hidden.length === b.hidden.length && a.hidden.every((name, i) => stringEqual(name, b.hidden[i]!));
}

// ============================================================================
// The reader
// ============================================================================

/** Props of {@link PlanBandCountsReader}. */
export interface PlanBandCountsReaderProps {
    /** The event kinds, as the payload carries them. */
    kinds: readonly EventKind[];
    /** The series they land on. */
    landings: readonly PlanLandingValue[];
    /** The kinds narrowed through their sources of the slice, and their parts. */
    parts: readonly PlanEventPart[];
    /** The shared scale: its columns. */
    scale: PlanScale | undefined;
    /** The range the canvas reads its events over: the columns counted. */
    range: PlanEventRange | undefined;
    /** The ids the viewer hides in the Series tab. */
    hidden: readonly string[];
    /** The group rows in view, as the canvas reports them at rest. */
    bands: PlanBandSpanStore;
    /** Where each row's counts go. */
    counts: PlanBandCountsStore;
    /**
     * Whether the rows' own reads are on their way — the windows the view waits for, the events' cells, or the events of
     * the period the columns have just taken: none is asked meanwhile.
     */
    waiting: boolean;
    /**
     * Whether a read the view waits for is in flight, as the frame's loading line hears it: the counts wait too for the
     * line, which stays a while once shown, to clear.
     */
    loading: boolean;
}

/**
 * The group rows' counts, read in a component of its own (see the module docs): each search that lands re-runs it
 * alone, and the rows whose counts moved draw again, through the store each reads its own from. While the rows' own
 * reads are on their way, or the frame's loading line has yet to clear, it asks for nothing, and the counts it handed
 * on stand; what it reads over it takes a commit after it is given, once the canvas has heard what the events' reader
 * set out to read. A row draws only the counts read at the period its columns take, so under another it draws none
 * until the period's land.
 *
 * @param props - What the counts are read over, where they go, and whether the rows' reads are on their way
 * @returns Nothing: it reads
 */
export function PlanBandCountsReader({ kinds, landings, parts, scale, range, hidden, bands, counts, waiting, loading }: PlanBandCountsReaderProps): null {
    const inView = useSyncExternalStore(bands.subscribe, bands.get);
    // The frame's loading line, shown as the frame shows it: a clock timed as the frame's, over the same reads.
    const lineShown = useLoadingReveal(loading);
    const rowsFirst = waiting || loading || lineShown;
    // What it reads over, a commit behind what it is given: the events' reader beside it starts its reads in the render
    // that moves the rows in view, the columns or the kinds shown, and `waiting` says so only once that render commits.
    // Read in that render, the counts' requests would go out beside the rows' own.
    const given = useMemo(() => ({ inView, kinds, landings, parts, scale, range, hidden }), [inView, kinds, landings, parts, scale, range, hidden]);
    const [heard, setHeard] = useState(given);
    useLayoutEffect(() => { if (heard !== given) setHeard(given); }, [heard, given]);
    const resolution = heard.scale?.resolution;
    const from = heard.range?.from.getTime();
    const to = heard.range?.to.getTime();
    // The period around the range the read is kept over: a pan within it reads nothing, and its reads keep their place.
    const over = useMemo(() => (resolution === undefined || from === undefined || to === undefined ? undefined
        : totalsRun(KEPT_OVER[resolution], new Date(from), new Date(to))), [resolution, from, to]);
    const place = over === undefined || resolution === undefined ? undefined : `plan-bands\u0000${resolution}\u0000${over.from.getTime()}`;
    // What it read, its own: a canvas mounted again reads afresh, and two canvases over one source never let go of each other's.
    const [kept] = useState(() => new RecordSliceKeptCells());
    // The rows read at each period, the latest first: asked for again with the rows in view, so none is read twice.
    const asked = useRef(new Map<string, readonly PlanBandInView[]>());
    const shown = heard.inView;
    const wanted = useMemo(() => {
        if (place === undefined) return NO_BANDS;
        const was = asked.current.get(place) ?? NO_BANDS;
        const fresh = shown.filter((band) => !was.some((one) => stringEqual(one.key, band.key)));
        const merged = [...shown, ...was.filter((one) => !shown.some((band) => stringEqual(band.key, one.key)))].slice(0, Math.max(BAND_ROWS_KEPT, shown.length));
        const list = fresh.length === 0 && merged.length === was.length ? was : merged;
        asked.current.delete(place);
        asked.current.set(place, list);
        while (asked.current.size > PERIODS_KEPT) {
            const evicted = asked.current.keys().next().value!;
            asked.current.delete(evicted);
            kept.prune((at) => at.includes(`\u0000${evicted}\u0000`));
        }
        return list;
    }, [shown, place, kept]);
    // What each row counts: known as its row and the kinds are.
    const plans = useMemo(() => wanted.map((band) => planBandSources(band, heard.kinds, heard.landings, heard.parts, heard.hidden)), [wanted, heard]);
    const scaleHeard = heard.scale;
    const buckets = useMemo(() => (scaleHeard === undefined || from === undefined || to === undefined ? undefined
        : bucketsOver(scaleHeard, new Date(from), new Date(to))), [scaleHeard, from, to]);
    const read = useCallback(() => {
        if (over === undefined || place === undefined || buckets === undefined || plans.every((plan) => plan.sources.length === 0 && plan.uncounted.length === 0)) {
            return NO_COUNTS;
        }
        // The rows' own reads first, and the line that says them: neither is ever behind the counts'.
        if (rowsFirst) return READING;
        return readBandCounts(wanted, plans, resolution, buckets, over, kept, place);
    }, [wanted, plans, resolution, buckets, over, kept, place, rowsFirst]);
    const { result } = useTrackedEvaluation(read);
    // The counts handed on: each row's the object it was while it draws the same.
    const handed = useRef<ReadonlyMap<string, PlanBandCounts>>(NO_COUNTS);
    useLayoutEffect(() => {
        if (!result.ok) {
            console.error("[Plan] the group rows' counts could not be read:", result.error);
            return;
        }
        // While a read is on its way the counts handed on stand: a row draws only those of its columns' period, so after a
        // zoom none draws, and no row is drawn again for them.
        if (result.value === READING) return;
        const was = handed.current;
        const next = new Map<string, PlanBandCounts>();
        let moved = result.value.size !== was.size;
        for (const [key, one] of result.value) {
            const before = was.get(key);
            if (before !== undefined && sameCounts(before, one)) next.set(key, before);
            else { next.set(key, one); moved = true; }
        }
        if (!moved) return;
        handed.current = next;
        counts.set(next);
    }, [result, counts]);
    return null;
}
