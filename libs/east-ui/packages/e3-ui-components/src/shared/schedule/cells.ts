/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A schedule's event kinds as a builder reads them (#1039): each kind placed on
 * a paged resource kind read a cell at a time, and every other kind counted
 * before one of its events is read. It is the shared reader the Plan reads its
 * kinds through (`plan/root/cells.ts`, its adapter), and the Calendar next. It
 * holds no builder's type: its host gives it, in the terms below, each event
 * kind ({@link ScheduleCellKind}), the resource kinds read whole and the paged
 * one, the range it reads and its buckets, the drafts and the paged kind's rows
 * in view, and hands what it read to its own seams.
 *
 * # Cells
 *
 * A kind placed on the paged resource kind, whose source of the slice lists a
 * series index of its record, reads the events of the resources in view — and
 * of no resource, its Unassigned row's — tile by tile, never every event over
 * the range. A cell is a block of {@link SCHEDULE_CELL_BLOCK} of the paged
 * kind's resources, in the kind's order, in one tile of the series index: one
 * exact search a resource, `[…on, tile, key]` (`tileCellQueries`). The cells
 * wanted are the blocks meeting the rows in view and
 * {@link SCHEDULE_CELL_MARGIN} resources either side, by the tiles covering the
 * range read and one tile either side, with the cells of no resource in those
 * tiles. Every wanted cell's searches go in one request, which counts each
 * cell's entries before one is read; the entries of the cells not yet held, in
 * one more. A cell is kept while it is wanted, at the revision it was read at:
 * a pan or a scroll within the cells held reads nothing, and a commit reads the
 * wanted cells again, the old ones standing in until they land. A long event
 * its cells repeat, tile by tile, is one event, kept by its key. A window of
 * the paged kind's resources whose read failed — the paging runtime throws a
 * `PagedReadError` for it — gives no block, its host saying so where its rows
 * would be, with Retry, until a Retry lands it; anything else a read of it
 * throws is thrown on ({@link scheduleWindowKeys}).
 *
 * A paged kind its source of the slice narrows is the narrowing's resources, in
 * the source's index's order (#1344): its blocks are the narrowing's, so only
 * the narrowed resources in view have their events read. The rows in view are
 * reported under the narrowing their windows are, and a choice's rows still to
 * land are reported by none: until they are, a span of the last narrowing's
 * reads no cell, and its cells stand in.
 *
 * # Counted first
 *
 * Every other kind is counted before one of its events is read: one read
 * through its source of the slice, over the range for every resource, through
 * the source's interval index — the count its window's read asks first, so
 * counting asks e3 nothing of its own; one read through a day index, by the
 * entries it files under the days of the range, the search its window's read
 * asks first — an event under each day it runs on, so an upper bound on the
 * events, never their number (`exact` false); and one held whole in memory. A
 * kind within {@link SCHEDULE_EVENT_CAP} in the range is left to its host,
 * which reads it over the range as it reads a kind no reader names; past it,
 * its events are never read or drawn, and the reader names it among the kinds
 * past the cap (`capped`): a host counts none of its events on a resource's
 * row, nor its hours anywhere, and says so. Its host's other readers, which
 * read it over the range or within it — a footer's counts, an inspector's —
 * read it only once the same count over the range says it is within the cap
 * ({@link scheduleWithinCap}), never by what the reader last decided, which a
 * new narrowing outruns; past it they wait for the reader, which gives it no
 * cells.
 *
 * # The cap
 *
 * While the wanted cells hold at most {@link SCHEDULE_EVENT_CAP} entries, their
 * events draw. Past it — or past one batch of searches — and for a counted
 * kind past the cap, the kind's summary index draws its shading instead: its
 * cells, at the largest of its tiles that divides the host's bucket and serves
 * the narrowing whole, folded into the buckets — the share of each booked for a
 * kind whose rows book their buckets (`booked`), how many events touch it for
 * one whose rows mark them. With none to shade, a kind read by cells is read
 * over the range while its count there is within the cap, and past it, as a
 * counted kind with no summary, the notice: its rows hatched, and the host's
 * banner naming how many events there are — or, where the count is no number
 * of them (a day index's), that they are not counted — and the resolution its
 * smallest summary shades at, or none. A hidden kind is read for nothing:
 * given no cells, it draws nothing, and a host leaves it out of every figure
 * of its own — the kinds past the cap name none.
 *
 * # The narrowing, the drafts and the link ends
 *
 * A series index led by the narrowed fields serves the narrowing exactly; the
 * fields it leaves are asked of the events read, in one read
 * (`recordSliceWithin`). The drafts are the host's sessions', and each draws
 * where it places its event, read or not — but a draft of an event the
 * narrowing does not hold, which a narrowed range leaves out too: the stored
 * rows of the drafted events the cells do not hold are read by their keys, in
 * one read, and asked of the narrowing in the same read as the cells' events.
 * An event whose row the host wants though no cell holds it — a link's end
 * ({@link ScheduleCellKind.wanted}) — is read by its key in that read.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
    ArrayType, BlobType, DateTimeType, DictType, FloatType, OptionType, SortedMap, StringType, StructType,
    compareFor, encodeBeast2For, equalFor, fromEastTypeValue, none, parseFor, printFor, some,
    type EastType, type EastTypeValue, type ValueTypeOf, type option,
} from "@elaraai/east";
import { SeekQueryType } from "@elaraai/east-ui";
import {
    MAX_RECORD_SLICE_BATCH, tileCellQueries, tileIndexFor, tileNext, tileStart, tilesOver, tilingOf,
    type RecordSliceBindType, type RecordSliceCell, type RecordSliceCellRuns, type RecordSliceChoiceType, type RecordSliceEntry,
    type RecordSliceIndexType, type RecordTile,
} from "@elaraai/east-ui/internal";
import { SCHEDULE_EVENT_CAP, ScheduleDraftsType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import {
    recordSliceCellEntries, recordSliceCellRuns, recordSliceRevision, recordSliceRows, recordSliceWithin,
} from "@elaraai/east-ui-components/internal";
import { isPagedReadError } from "../../platform/paged-read-error.js";
import type { TimeResolution } from "../time/scale.js";
import type { ScheduleEventDraftsValue } from "./editing.js";

/** How many of a paged resource kind's resources a cell holds: a block of them, in the kind's order. */
export const SCHEDULE_CELL_BLOCK = 50;

/** The resources either side of the rows in view whose blocks are read too. */
export const SCHEDULE_CELL_MARGIN = 25;

/** A kind's source of the slice: a record Slice's controls — its reads, its counts and its cells go through it. */
export type ScheduleCellPart = ValueTypeOf<RecordSliceBindType>;

/** One bucket of a resource's shading, as the reader hands it to its host's seams: the bucket's start, and its value. */
const ShadeType = StructType({ at: DateTimeType, value: OptionType(FloatType) });

/** The resources' shading, as the reader hands it to its host's seams: by the key of the rows it stands in for, then by the resource key's text. */
const ShadingType = DictType(StringType, DictType(StringType, ArrayType(ShadeType)));

/** One bucket of a resource's shading: its start, and the share of it booked, how many events touch it, or `none` — the hatch. */
export type ScheduleCellShade = ValueTypeOf<typeof ShadeType>;

/** The resources' shading: by the key of the rows it stands in for, then by the resource key's text, each its buckets. */
export type ScheduleCellShading = ValueTypeOf<typeof ShadingType>;

/** What the reader read of each kind it gives cells, by the kind's slot: one beast2 of the kind's `cellsType` each. */
export type ScheduleCellReads = ValueTypeOf<DictType<StringType, BlobType>>;

/** One index of a record Slice's binding. */
type Index = ValueTypeOf<typeof RecordSliceIndexType>;
/** A record Slice's narrowing. */
type Where = ReadonlyMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>;

const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
/** Whether two narrowings, as a source names them, are one — none being none (#1344). */
const sameNarrowing = (a: string | undefined, b: string | undefined): boolean => (a === undefined || b === undefined ? a === b : stringEqual(a, b));
const blobEqual = equalFor(BlobType);
const shadingEqual = equalFor(ShadingType);
const draftsEqual = equalFor(DictType(StringType, ScheduleDraftsType));
const printQueries = printFor(ArrayType(SeekQueryType));

// ============================================================================
// What a host gives the reader
// ============================================================================

/** One event kind, as the reader reads it (see the module docs). */
export interface ScheduleCellKind {
    /** Its slot: what its cells, its shading and its notice are named by. */
    readonly key: string;
    /** Its name, as the notice names it: `Print job`. */
    readonly name: string;
    /** The resource kinds its events are placed on, by their slots. */
    readonly takes: readonly string[];
    /** Whether its rows shade the share of each bucket its events book — bars and chips — rather than how many touch it. */
    readonly booked: boolean;
    /** The key of the rows its shading stands in for on a resource kind's resources, by the resource kind's slot: its host's. */
    readonly shadeKey: (resources: string) => string;
    /** What its cells are encoded in: an Array of `{ key, row }`, at its record's key and row types. */
    readonly cellsType: EastTypeValue;
    /**
     * The `.east` text its series and summary indexes file a resource's events under, or no resource's: the key its
     * cells search for; `none` where its resource field cannot hold it.
     */
    readonly seriesKey: (resource: option<{ readonly kind: string; readonly key: string }>) => option<string>;
    /**
     * How many of its stored events overlap `[from, to)`, counted before one is read; `none` while the count is in
     * flight. For a kind read through a day index, the entries it files under the days of `[from, to)`: an upper bound
     * on the events, never their number ({@link ScheduleCellKind.exact}).
     */
    readonly count: (from: Date, to: Date) => option<bigint>;
    /** Whether {@link ScheduleCellKind.count} counts its events themselves: `false` for a kind read through a day index. */
    readonly exact: boolean;
    /** Its source of the slice, when it has one: what its cells, its summary and its narrowing are read through. */
    readonly part: ScheduleCellPart | undefined;
    /** Whether the viewer hides it: nothing of it draws, so no cell of it is read, and it gives no notice or shading. */
    readonly hidden: boolean;
    /** The keys' texts of its events whose rows its host wants though no cell holds them — a link's ends — read by their keys. */
    readonly wanted: readonly string[];
}

/** A resource kind read whole, as the reader hatches and shades its rows: its slot, and its resources' keys' texts in order. */
export interface ScheduleCellResources {
    /** Its slot. */
    readonly key: string;
    /** Its resources' keys' texts, in order. */
    readonly keys: readonly string[];
}

/** The paged resource kind, as the reader reads the blocks of it in view (see the module docs). */
export interface ScheduleCellPaged {
    /** Its slot. */
    readonly kind: string;
    /** How many of its resources a window of it holds: what a row in view's window places it by. */
    readonly window: number;
    /** Whether the viewer hides it: none of its rows draws, so no cell of it is read. */
    readonly hidden: boolean;
    /**
     * The keys' texts of its resources `[offset, offset + limit)`, in the order its rows draw them; `none` while that
     * window is in flight.
     */
    keys(offset: bigint, limit: bigint): option<readonly string[]>;
    /** How many resources it has — its narrowing holds, when its source narrows it — once known. */
    total(): option<bigint>;
    /** The narrowing its windows belong to, as its source names it (#1344); `undefined` for a kind no source narrows. */
    narrowing(): string | undefined;
}

/**
 * The paged kind's rows in view, as its host reports them: the first and the
 * last, each by its window and its key's text, and the narrowing they were
 * drawn under.
 */
export interface ScheduleCellSpan {
    /** The first row in view. */
    readonly first: { readonly w: number; readonly key: string };
    /** The last row in view. */
    readonly last: { readonly w: number; readonly key: string };
    /**
     * The narrowing the rows were drawn under, as the kind's source names it
     * (#1344): their windows are its. `undefined` for a kind its source does
     * not narrow.
     */
    readonly narrowing: string | undefined;
}

/** One bucket of the host's, by its start and its end, in ms. */
export interface ScheduleCellBucket {
    /** Its start. */
    readonly start: number;
    /** Its end, exclusive. */
    readonly end: number;
}

/** A range the reader read over, in ms: its start and its end, exclusive. */
export interface ScheduleCellRange {
    /** Its start. */
    readonly from: number;
    /** Its end, exclusive. */
    readonly to: number;
}

/** What {@link useScheduleCells} reads over. */
export interface ScheduleCellsArgs {
    /** The host's name, which heads what the reader logs — `Plan`: a read that fails is said as the host's. */
    readonly host: string;
    /** The event kinds. */
    readonly kinds: readonly ScheduleCellKind[];
    /** The resource kinds read whole: a counted kind past the cap shades, or is hatched, over their rows. */
    readonly resources: readonly ScheduleCellResources[];
    /** The paged resource kind, when one pages. */
    readonly paged: ScheduleCellPaged | undefined;
    /** The range the host reads its events over. */
    readonly range: { readonly from: Date; readonly to: Date } | undefined;
    /** The range cut into the host's buckets, in order: what a summary's shading is folded into. */
    readonly buckets: readonly ScheduleCellBucket[] | undefined;
    /** The host's resolution, which a summary's tile must divide; `undefined` on an axis of no time. */
    readonly resolution: TimeResolution | undefined;
    /** Every kind's drafts — the same object while they hold. */
    readonly drafts: ScheduleEventDraftsValue;
    /** The paged kind's rows in view, as the host last reported them; `undefined` before it has. */
    readonly span: ScheduleCellSpan | undefined;
}

// ============================================================================
// What the reader hands its host
// ============================================================================

/** A kind giving the notice in place of its events: too many of them in the range, and no summary that shades them here. */
export interface ScheduleCellNotice {
    /** The kind's slot. */
    readonly kind: string;
    /** Its name. */
    readonly name: string;
    /** How many of its events there are; `undefined` where its count is no number of them — a day index's — so they are not counted. */
    readonly events: number | undefined;
    /** The resolution its smallest summary shades at; `undefined` when it has none. */
    readonly resolution: RecordTile | undefined;
}

/** The rows a kind's cells hold, by the event's key's text, each its row's bytes. */
type HeldRows = ReadonlyMap<string, { readonly row: Uint8Array }>;

/** What the reader read: what its host's seams draw the kinds from, and what a gesture finds an event's row in. */
export interface ScheduleCellsRead {
    /**
     * What it read of each kind it gives cells, by the kind's slot: a kind read by its cells, their entries; one past
     * the cap, or hidden, none. A kind it names not is read over the range by its host — a counted kind only once its
     * count there is within the cap ({@link scheduleWithinCap}).
     */
    readonly reads: ScheduleCellReads;
    /** The resources' shading. */
    readonly shading: ScheduleCellShading;
    /** Every kind's drafts as the seams take them: a kind read by its cells, those of events its narrowing does not hold left out. */
    readonly drafts: ScheduleEventDraftsValue;
    /**
     * Each kind it gives cells, by its slot: the rows they hold, by the event's key's text — where a gesture finds an
     * event's row, one it does not hold read by its key; none for a kind given none, whose range is never read.
     */
    readonly held: ReadonlyMap<string, HeldRows>;
    /** The kinds giving the notice in place of their events. */
    readonly notices: readonly ScheduleCellNotice[];
    /**
     * The kinds past the cap the viewer shows, by their slots: none of their events is read or drawn, so a host counts
     * none of them on a resource's row, nor their hours anywhere — it says they are not counted, never 0. A count of them
     * over the window that counts the events themselves still counts them there. A hidden kind is in no host's figure,
     * and none of them.
     */
    readonly capped: ReadonlySet<string>;
    /**
     * Whether a read is in flight over a paged kind a kind is read by the cells of: the rows its cells have not landed
     * for wait on it ({@link ScheduleCellsRead.drawn}); `false` where no kind is read so, whose reads nothing waits on.
     */
    readonly reading: boolean;
    /**
     * The paged kind's resources whose rows draw what is known of them (#1398, CL2): those whose cells the last read
     * landed for — while a read over another range is in flight, less those it reads again, whose cells there never
     * landed; a read over the same range — a commit, another narrowing — leaves its cells standing in. Any other
     * resource's rows are unread and draw the region wash under what they hold, never an empty row, and a host's
     * figures of such a resource — an inspector's row facts — are placeholders until its cells land, never 0.
     * `undefined` where no kind is read by its cells over a paged kind.
     */
    readonly drawn: ReadonlySet<string> | undefined;
}

/**
 * Whether a kind is within the cap over a range (see the module docs): its
 * count there at most {@link SCHEDULE_EVENT_CAP} — the rule the reader decides
 * a counted kind by, over the range it reads, and a host's other readers ask
 * over the same range before they read the kind over it or within it.
 *
 * @param count - The kind's count ({@link ScheduleCellKind.count}) — every kind has one; a day index's, an upper bound, is past the cap wherever it is
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @returns `some(true)` within the cap; `some(false)` past it; `none` while the count is in flight
 */
export function scheduleWithinCap(count: ScheduleCellKind["count"], from: Date, to: Date): option<boolean> {
    const counted = count(from, to);
    return counted.type === "some" ? some(counted.value <= BigInt(SCHEDULE_EVENT_CAP)) : none;
}

/** A window of a paged resource kind's resources whose read failed: its host says so where its rows would be, with Retry. */
export const SCHEDULE_WINDOW_FAILED = "failed";

/**
 * One window of a paged resource kind's resources, as the reader reads it
 * (see the module docs): its resources' keys' texts, in order; `undefined`
 * while it is in flight; {@link SCHEDULE_WINDOW_FAILED} for a window whose read
 * failed — the paging runtime throws a `PagedReadError` for it
 * (`isPagedReadError`). Anything else a read of it throws is no read that
 * failed, and is thrown on.
 *
 * @param paged - The paged resource kind
 * @param w - The window, by its place among the kind's
 * @returns Its keys; `undefined` in flight; {@link SCHEDULE_WINDOW_FAILED} for a read that failed
 * @throws Whatever else reading the window throws
 */
export function scheduleWindowKeys(paged: ScheduleCellPaged, w: number): readonly string[] | undefined | typeof SCHEDULE_WINDOW_FAILED {
    try {
        const keys = paged.keys(BigInt(w * paged.window), BigInt(paged.window));
        return keys.type === "some" ? keys.value : undefined;
    } catch (error) {
        if (isPagedReadError(error)) return SCHEDULE_WINDOW_FAILED;
        throw error;
    }
}

// ============================================================================
// What a reader wants: blocks, tiles and buckets
// ============================================================================

/** The resources in view of a paged resource kind, by their place in its order: the first and the last. */
export interface ScheduleCellView {
    /** The first resource in view. */
    readonly first: number;
    /** The last resource in view. */
    readonly last: number;
}

/**
 * No row in view reported yet: the first resource, where a view opens — the
 * first block, and the next only once the rows in view reach within
 * {@link SCHEDULE_CELL_MARGIN} of it.
 */
export const SCHEDULE_CELL_OPENING: ScheduleCellView = { first: 0, last: 0 };

/**
 * The blocks of a paged resource kind's resources a reader wants: those
 * meeting the resources in view and {@link SCHEDULE_CELL_MARGIN} either side.
 *
 * @param view - The resources in view
 * @param total - How many resources the kind has, once known
 * @returns The blocks, by their place, ascending
 */
export function wantedBlocks(view: ScheduleCellView, total: number | undefined): number[] {
    const lo = Math.max(0, view.first - SCHEDULE_CELL_MARGIN);
    const hi = total === undefined ? view.last + SCHEDULE_CELL_MARGIN : Math.min(view.last + SCHEDULE_CELL_MARGIN, total - 1);
    const out: number[] = [];
    for (let b = Math.floor(lo / SCHEDULE_CELL_BLOCK); b <= Math.floor(hi / SCHEDULE_CELL_BLOCK); b++) out.push(b);
    return hi < lo ? [] : out;
}

/**
 * The tiles a reader wants over a range: those it overlaps, as e3 files an
 * event over them, and one either side, which a pan reaches first.
 *
 * @param tile - The index's tile
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @param limit - The most tiles to list
 * @returns The tiles' starts, ascending; `undefined` when there are more than `limit`
 */
export function wantedTiles(tile: RecordTile, from: Date, to: Date, limit: number): Date[] | undefined {
    const covering = tilesOver(tile, from, to, Math.max(1, limit - 2));
    if (covering === undefined) return undefined;
    const before = tileStart(tile, new Date(covering[0]!.getTime() - 1));
    return [before, ...covering, tileNext(tile, covering[covering.length - 1]!)];
}

/** The tiles that divide a bucket of each resolution — a bucket is a union of whole ones — the largest first. */
const DIVIDING: Readonly<Record<TimeResolution, readonly RecordTile[]>> = {
    hour: [],
    day: ["day"],
    week: ["week", "day"],
    month: ["month", "day"],
    quarter: ["quarter", "month", "day"],
    year: ["year", "quarter", "month", "day"],
};

/**
 * The tiles a summary may shade a resolution's buckets by: those that divide
 * its bucket, the largest first — an ISO week divides no month.
 *
 * @param resolution - The host's resolution; `undefined` on an axis of no time
 * @returns The tiles
 */
export function dividingTiles(resolution: TimeResolution | undefined): readonly RecordTile[] {
    return resolution === undefined ? [] : DIVIDING[resolution];
}

/** How many events touch a tile, and the milliseconds of it they cover: a summary's totals, as numbers. */
export interface ScheduleCellTotals {
    /** How many events touch it. */
    readonly count: number;
    /** The milliseconds of it they cover. */
    readonly ms: number;
}

/**
 * One resource's shading over the buckets (#1039): the totals of the summary
 * tiles inside each bucket added up — a tile that divides the bucket lies
 * wholly inside it — as the share of the bucket booked, at most all of it,
 * or how many events touch it.
 *
 * @param totals - The resource's totals, by tile start in ms
 * @param buckets - The buckets
 * @param booked - Whether its rows book their buckets: the share booked; else how many
 * @returns Its shading, a bucket each
 */
export function shadesOf(totals: ReadonlyMap<number, ScheduleCellTotals> | undefined, buckets: readonly ScheduleCellBucket[], booked: boolean): ScheduleCellShade[] {
    return buckets.map(({ start, end }) => {
        let count = 0;
        let ms = 0;
        for (const [at, t] of totals ?? []) {
            if (at < start || at >= end) continue;
            count += t.count;
            ms += t.ms;
        }
        return { at: new Date(start), value: some(booked ? Math.min(1, ms / (end - start)) : count) };
    });
}

/** The no-data hatch over the buckets: the notice's, a resource's row that shows nothing at this resolution. */
function hatchOf(buckets: readonly ScheduleCellBucket[]): ScheduleCellShade[] {
    return buckets.map(({ start }) => ({ at: new Date(start), value: none }));
}

// ============================================================================
// What a reader reads
// ============================================================================

/** A read whose counts or cells are still in flight. */
const READING = "reading";

/** The shading's totals, by a row's key, then by the resource's key: each tile's totals, or the hatch. */
type Totals = Map<string, { booked: boolean; byKey: Map<string, Map<number, ScheduleCellTotals> | "hatch"> }>;

/**
 * One read of every kind, the drafts each kind read by its cells leaves out, by the kind's slot, the paged kind's
 * resources whose cells it holds — `undefined` where no kind reads its cells over a paged kind — and the range it was
 * made over, `undefined` before the first.
 */
type Read = Omit<ScheduleCellsRead, "reading" | "drawn"> & {
    readonly dropped: ReadonlyMap<string, ReadonlySet<string>>;
    readonly covered: ReadonlySet<string> | undefined;
    readonly range: ScheduleCellRange | undefined;
};

/** No resource: what a reader that has read no block of the paged kind's wants. */
const NO_RESOURCES: ReadonlySet<string> = new Set();
/** No kind past the cap. */
const NONE_CAPPED: ReadonlySet<string> = new Set();
/** No rows: what a kind given no cells holds — a gesture reads one of its events by its key, never over the range. */
const NO_ROWS: HeldRows = new Map();

/** Whether two sets of resource keys hold the same keys. */
function sameKeys(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.size === b.size && [...a].every((key) => b.has(key));
}

/** Whether two ranges are the same range. */
function sameRange(a: ScheduleCellRange | undefined, b: ScheduleCellRange | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.from === b.from && a.to === b.to;
}

/** One kind's read. */
type KindRead =
    | { readonly mode: "cells"; readonly cells: Uint8Array; readonly held: HeldRows; readonly dropped: ReadonlySet<string> }
    | { readonly mode: "shade"; readonly cells: Uint8Array; readonly notice: ScheduleCellNotice | undefined; readonly paged: boolean }
    | { readonly mode: "window" };

/** A kind's types, as its cells are encoded in. */
interface KindCodec {
    readonly compareKey: (a: unknown, b: unknown) => number;
    readonly idOf: (key: unknown) => string;
    readonly keyOf: (id: string) => unknown;
    readonly encodeCells: (entries: { key: unknown; row: unknown }[]) => Uint8Array;
    readonly encodeRow: (row: unknown) => Uint8Array;
    readonly empty: Uint8Array;
}

/** A cell's searches, as a key of what the reader keeps. */
function cellText(index: string, cell: RecordSliceCell): string {
    return `${index}\u0000${printQueries([...cell.queries])}`;
}

/** A narrowing without its range of the field an index's tiles cover: the tiles hold the range. */
function withoutTiled(where: Where, from: string): Map<string, ValueTypeOf<typeof RecordSliceChoiceType>> {
    return new Map([...where].filter(([field, choice]) => !(stringEqual(field, from) && choice.type === "range")));
}

/** The fields of a narrowing an index's cells do not answer: all but its leading fields, and a range of its start. */
function residualOf(index: Index, where: Where): string[] {
    const tiling = tilingOf(index)!;
    const leading = index.fields.slice(0, -2);
    return [...where].filter(([field, choice]) => !leading.some((l) => stringEqual(l, field)) && !(stringEqual(field, tiling.from) && choice.type === "range"))
        .map(([field]) => field);
}

/** A block of resources and their keys' texts: what a cell holds of them. */
interface Block {
    /** Where the block's rows draw: a resource kind's slot. */
    readonly slot: string;
    /** Its place, among its kind's blocks. */
    readonly index: number;
    /** Its resources' keys' texts, in order. */
    readonly keys: readonly string[];
}

/** Whether a kind is read by its cells: placed on the paged kind, its source listing a series index of its record. */
function readByCells(kind: ScheduleCellKind, paged: ScheduleCellPaged | undefined): boolean {
    return paged !== undefined && kind.part !== undefined && kind.takes.some((slot) => stringEqual(slot, paged.kind))
        && kind.part.config.indexes.some((index) => index.series.type === "some");
}

/**
 * The reader's state across reads: the cells it holds, each kind's codec and
 * the series keys it has asked its kinds for.
 */
class CellsReader {
    /** The cells each kind's read holds, by the kind's slot and index: their entries by their searches' text, at a revision. */
    private readonly kept = new Map<string, { revision: string; cells: Map<string, RecordSliceEntry[]> }>();
    private readonly codecs = new WeakMap<object, KindCodec>();
    private readonly literals = new WeakMap<object, Map<string, string | undefined>>();
    private readonly unassigned = new WeakMap<object, { literal: string | undefined }>();
    /** Each kind's last encoded cells and rows held, by what they were made from: a read again that holds the same encodes nothing. */
    private readonly encoded = new Map<string, { from: readonly unknown[]; bytes: Uint8Array; held: HeldRows }>();
    /** The paged kind's resources whose blocks the latest read wants — landed or in flight — the same set while they hold. */
    private wantedKeys: ReadonlySet<string> = NO_RESOURCES;

    /** The paged kind's resources whose blocks the latest read wants (#1398): while it is in flight, the rows it reads again. */
    wanted(): ReadonlySet<string> {
        return this.wantedKeys;
    }

    /** A kind's codec, made once per kind's cells' type. */
    codecOf(kind: ScheduleCellKind): KindCodec {
        let codec = this.codecs.get(kind.cellsType);
        if (codec === undefined) {
            const cellsType = fromEastTypeValue(kind.cellsType) as ArrayType<StructType>;
            const fields = cellsType.value.fields as Record<string, EastType>;
            const keyType = fields["key"]!;
            const printKey = printFor(keyType);
            const parseKey = parseFor(keyType);
            const encodeCells = encodeBeast2For(cellsType) as (entries: { key: unknown; row: unknown }[]) => Uint8Array;
            const string = keyType.type === "String";
            codec = {
                compareKey: compareFor(keyType) as (a: unknown, b: unknown) => number,
                // An entry's id is its key's text: a String key as it is, any other key as East prints it.
                idOf: (key) => (string ? key as string : printKey(key as never)),
                keyOf: (id) => {
                    if (string) return id;
                    const read = parseKey(id);
                    return read.success ? read.value : undefined;
                },
                encodeCells,
                encodeRow: encodeBeast2For(fields["row"]!) as (row: unknown) => Uint8Array,
                empty: encodeCells([]),
            };
            this.codecs.set(kind.cellsType, codec);
        }
        return codec;
    }

    /** The `.east` text a kind's series and summary indexes file a resource's events under; `undefined` for one its field cannot name. */
    private literal(kind: ScheduleCellKind, slot: string, key: string): string | undefined {
        let held = this.literals.get(kind.seriesKey);
        if (held === undefined) { held = new Map(); this.literals.set(kind.seriesKey, held); }
        const at = `${slot}\u0000${key}`;
        if (!held.has(at)) {
            const literal = kind.seriesKey(some({ kind: slot, key }));
            held.set(at, literal.type === "some" ? literal.value : undefined);
        }
        return held.get(at);
    }

    /** The `.east` text a kind's indexes file its events on no resource under; `undefined` for a field that must name one. */
    private noResource(kind: ScheduleCellKind): string | undefined {
        let held = this.unassigned.get(kind.seriesKey);
        if (held === undefined) {
            const literal = kind.seriesKey(none);
            held = { literal: literal.type === "some" ? literal.value : undefined };
            this.unassigned.set(kind.seriesKey, held);
        }
        return held.literal;
    }

    /**
     * A kind's cells, encoded, and the rows they hold by the event's key's
     * text: made again only when what they are made from moved — the cells'
     * entries, the rows read by key and what the narrowing answered of them.
     */
    private encode(slot: string, codec: KindCodec, from: readonly unknown[], rows: ReadonlyMap<unknown, unknown>): { bytes: Uint8Array; held: HeldRows } {
        const last = this.encoded.get(slot);
        if (last !== undefined && last.from.length === from.length && last.from.every((part, i) => Object.is(part, from[i]))) return last;
        const entries: { key: unknown; row: unknown }[] = [];
        const held = new Map<string, { readonly row: Uint8Array }>();
        for (const [key, row] of rows) {
            entries.push({ key, row });
            held.set(codec.idOf(key), { row: codec.encodeRow(row) });
        }
        const made = { from, bytes: codec.encodeCells(entries), held };
        this.encoded.set(slot, made);
        return made;
    }

    /**
     * The cells' entries a kind's read holds, at the record's revision now:
     * those of the wanted cells it does not hold read in one request, and
     * every cell no longer wanted let go.
     *
     * @returns Each wanted cell's entries, in order; none while the revision or the read is in flight
     */
    private entriesOf(at: string, part: ScheduleCellPart, index: string, cells: readonly RecordSliceCell[]): option<RecordSliceEntry[][]> {
        const revision = recordSliceRevision(part);
        if (revision.type !== "some") return none;
        let kept = this.kept.get(at);
        if (kept === undefined || !stringEqual(kept.revision, revision.value)) {
            kept = { revision: revision.value, cells: new Map() };
            this.kept.set(at, kept);
        }
        const texts = cells.map((cell) => cellText(index, cell));
        const missing = cells.filter((_cell, i) => !kept.cells.has(texts[i]!));
        if (missing.length > 0) {
            const read = recordSliceCellEntries(part, index, missing);
            if (read.type !== "some") return none;
            for (const cell of missing) kept.cells.set(cellText(index, cell), read.value.get(cell.id) ?? []);
        }
        const wanted = new Set(texts);
        for (const text of [...kept.cells.keys()]) if (!wanted.has(text)) kept.cells.delete(text);
        return some(texts.map((text) => kept.cells.get(text)!));
    }

    /**
     * A read of every kind (see the module docs).
     *
     * @param args - What it reads over
     * @returns What it read; {@link READING} while a count, or a cell's count or entries, are in flight
     */
    read(args: Omit<ScheduleCellsArgs, "host">): Read | typeof READING {
        const { kinds, resources, paged, range, buckets, resolution, drafts, span } = args;
        if (range === undefined || buckets === undefined) return READING;
        const reads: [string, Uint8Array][] = [];
        const held = new Map<string, HeldRows>();
        const dropped = new Map<string, ReadonlySet<string>>();
        const notices: ScheduleCellNotice[] = [];
        const capped = new Set<string>();
        const over: ScheduleCellRange = { from: range.from.getTime(), to: range.to.getTime() };
        // The shading, by a row's key, then by the resource's key: each tile's totals, or the hatch.
        const totals: Totals = new Map();
        // The paged kind's blocks in view, read once for every kind placed on it — and its resources wanted, kept.
        let pagedBlocks: Block[] | typeof READING | undefined;
        const blocksOfPaged = (): Block[] | typeof READING => {
            if (pagedBlocks !== undefined) return pagedBlocks;
            pagedBlocks = paged === undefined || paged.hidden ? [] : this.pagedBlocks(paged, span);
            if (pagedBlocks !== READING) {
                const wanted = new Set(pagedBlocks.flatMap((block) => block.keys));
                if (!sameKeys(wanted, this.wantedKeys)) this.wantedKeys = wanted;
            }
            return pagedBlocks;
        };
        // A kind's resources' blocks, a counted kind's past the cap: the paged kind's in view, and every resource read whole.
        const blocksOf = (kind: ScheduleCellKind): Block[] | typeof READING => {
            const out: Block[] = [];
            for (const slot of kind.takes) {
                if (paged !== undefined && stringEqual(slot, paged.kind)) {
                    const blocks = blocksOfPaged();
                    if (blocks === READING) return READING;
                    out.push(...blocks);
                    continue;
                }
                const keys = resources.find((r) => stringEqual(r.key, slot))?.keys ?? [];
                for (let at = 0; at < keys.length; at += SCHEDULE_CELL_BLOCK) {
                    out.push({ slot, index: at / SCHEDULE_CELL_BLOCK, keys: keys.slice(at, at + SCHEDULE_CELL_BLOCK) });
                }
            }
            return out;
        };
        // Whether a kind drew its cells, or its shading, over the paged kind's blocks: then its rows draw what they hold.
        let byCells = false;
        for (const kind of kinds) {
            let read: KindRead | typeof READING;
            if (readByCells(kind, paged)) {
                if (kind.hidden) {
                    // Hidden: it draws nothing, so no cell of it is read — and given none, nothing reads its range.
                    read = { mode: "shade", cells: this.codecOf(kind).empty, notice: undefined, paged: false };
                } else {
                    const blocks = blocksOfPaged();
                    read = blocks === READING ? READING : this.cellsKind(kind, kind.part!, kind.part!.read().where, blocks, range, buckets, resolution, drafts, totals);
                }
            } else {
                read = this.countedKind(kind, range, buckets, resolution, totals, blocksOf);
            }
            if (read === READING) return READING;
            switch (read.mode) {
                // Its host reads it over the range, as it reads a kind no reader names.
                case "window": continue;
                case "cells":
                    reads.push([kind.key, read.cells]);
                    held.set(kind.key, read.held);
                    if (read.dropped.size > 0) dropped.set(kind.key, read.dropped);
                    byCells = true;
                    break;
                case "shade":
                    reads.push([kind.key, read.cells]);
                    held.set(kind.key, NO_ROWS);
                    if (read.notice !== undefined) notices.push(read.notice);
                    if (read.paged) byCells = true;
                    // Past the cap: none of its events is read, so no host counts one of them on a row. A hidden kind is in
                    // no host's figure at all, so it is named here by none.
                    if (!kind.hidden) capped.add(kind.key);
                    break;
            }
        }
        return {
            reads: new SortedMap(reads, compareString),
            shading: shadingOf(totals, buckets),
            drafts: narrowedDrafts(drafts, dropped),
            held,
            notices,
            capped: capped.size === 0 ? NONE_CAPPED : capped,
            dropped,
            // The resources whose cells this read holds: its blocks', where a kind drew its cells or its shading on them.
            covered: byCells ? this.wantedKeys : undefined,
            range: over,
        };
    }

    /**
     * The paged kind's blocks in view, each its resources' keys; {@link READING} while a window of them is in flight,
     * and while the rows in view are another narrowing's than the one the windows read now (#1344): a choice's rows
     * still to land and be reported, whose places the last narrowing's windows do not hold.
     */
    private pagedBlocks(paged: ScheduleCellPaged, span: ScheduleCellSpan | undefined): Block[] | typeof READING {
        const narrowing = paged.narrowing();
        if (span !== undefined && !sameNarrowing(span.narrowing, narrowing)) return READING;
        const size = paged.window;
        // Where a row in view sits in the kind's order: its window's start, while its window's keys are read. A window
        // whose read failed gives no block — its host says so where its rows would be, with its Retry, and no cell of it
        // is read until a Retry lands it.
        const place = (at: ScheduleCellSpan["first"]): number => {
            const keys = scheduleWindowKeys(paged, at.w);
            const i = Array.isArray(keys) ? keys.findIndex((key) => stringEqual(key, at.key)) : -1;
            return at.w * size + Math.max(0, i);
        };
        const view = span === undefined ? SCHEDULE_CELL_OPENING : { first: place(span.first), last: place(span.last) };
        const total = paged.total();
        const blocks: Block[] = [];
        for (const b of wantedBlocks(view, total.type === "some" ? Number(total.value) : undefined)) {
            const w = Math.floor((b * SCHEDULE_CELL_BLOCK) / size);
            const keys = scheduleWindowKeys(paged, w);
            if (keys === undefined) return READING;
            if (keys === SCHEDULE_WINDOW_FAILED) continue;
            const at = b * SCHEDULE_CELL_BLOCK - w * size;
            const own = keys.slice(at, at + SCHEDULE_CELL_BLOCK);
            if (own.length > 0) blocks.push({ slot: paged.kind, index: b, keys: own });
        }
        return blocks;
    }

    /**
     * A kind counted before one of its events is read (see the module docs):
     * within the cap, left to its host to read over the range; past it, its
     * summary's shading, or the notice — or, hidden, nothing.
     */
    private countedKind(
        kind: ScheduleCellKind, range: { from: Date; to: Date }, buckets: readonly ScheduleCellBucket[], resolution: TimeResolution | undefined,
        totals: Totals, blocksOf: (kind: ScheduleCellKind) => Block[] | typeof READING,
    ): KindRead | typeof READING {
        const within = scheduleWithinCap(kind.count, range.from, range.to);
        if (within.type !== "some") return READING;
        if (within.value) return { mode: "window" };
        // Past the cap: none of its events is read or drawn.
        if (kind.hidden) return { mode: "shade", cells: this.codecOf(kind).empty, notice: undefined, paged: false };
        const blocks = blocksOf(kind);
        if (blocks === READING) return READING;
        const where = kind.part === undefined ? new Map() : kind.part.read().where;
        return this.overBudget(kind, where, blocks, range, buckets, resolution, totals, this.eventsOf(kind, range), false);
    }

    /**
     * How many of a kind's events overlap a range, by its count: `undefined`
     * where the count is no number of them — a day index's — or is in flight.
     */
    private eventsOf(kind: ScheduleCellKind, range: { from: Date; to: Date }): number | undefined {
        if (!kind.exact) return undefined;
        const count = kind.count(range.from, range.to);
        return count.type === "some" ? Number(count.value) : undefined;
    }

    /**
     * A kind placed on the paged kind, read by its series index's cells: its
     * events while the cells hold at most the cap, its summary's shading past
     * it (see the module docs).
     */
    private cellsKind(
        kind: ScheduleCellKind, part: ScheduleCellPart, where: Where, blocks: readonly Block[], range: { from: Date; to: Date },
        buckets: readonly ScheduleCellBucket[], resolution: TimeResolution | undefined, drafts: ScheduleEventDraftsValue, totals: Totals,
    ): KindRead | typeof READING {
        const codec = this.codecOf(kind);
        const series = tileIndexFor(part.config.indexes, where, "series");
        const tiling = series === undefined ? undefined : tilingOf(series);
        const tiles = tiling === undefined ? undefined : wantedTiles(tiling.tile.type, range.from, range.to, MAX_RECORD_SLICE_BATCH);
        const cells: RecordSliceCell[] = [];
        let searches = 0;
        if (series !== undefined && tiles !== undefined) {
            const unassigned = this.noResource(kind);
            for (const tile of tiles) {
                for (const block of blocks) {
                    const literals = block.keys.flatMap((key) => {
                        const literal = this.literal(kind, block.slot, key);
                        return literal === undefined ? [] : [literal];
                    });
                    if (literals.length === 0) continue;
                    const queries = tileCellQueries(series, where, tile, literals).queries;
                    cells.push({ id: `${block.index}@${tile.getTime()}`, queries });
                    searches += queries.length;
                }
                if (unassigned !== undefined) {
                    const queries = tileCellQueries(series, where, tile, [unassigned]).queries;
                    cells.push({ id: `none@${tile.getTime()}`, queries });
                    searches += queries.length;
                }
            }
        }
        // More searches than one batch: as many events as the summary is for.
        if (series === undefined || tiles === undefined || searches > MAX_RECORD_SLICE_BATCH) {
            return this.overBudget(kind, where, blocks, range, buckets, resolution, totals, undefined, true);
        }
        const runs = recordSliceCellRuns(part, series.name, cells);
        if (runs.type !== "some") return READING;
        let count = 0n;
        for (const found of runs.value.values()) count += found.total;
        if (count > BigInt(SCHEDULE_EVENT_CAP)) {
            return this.overBudget(kind, where, blocks, range, buckets, resolution, totals, Number(count), true);
        }
        const read = this.entriesOf(`${kind.key}\u0000${series.name}`, part, series.name, cells);
        if (read.type !== "some") return READING;
        // Each event once, by its key: a long one is in every tile it touches.
        const rows = new SortedMap<unknown, unknown>([], codec.compareKey);
        for (const entries of read.value) {
            for (const entry of entries) if (entry.row?.type === "some") rows.set(entry.key, entry.row.value);
        }
        // The events not read whose rows are wanted: those drafted, and those its host wants by key — a link's ends.
        const kindDrafts = drafts.get(kind.key);
        const extra: { id: string; key: unknown }[] = [];
        const wanted = (id: string) => {
            const key = codec.keyOf(id);
            if (key !== undefined && !rows.has(key) && !extra.some((e) => stringEqual(e.id, id))) extra.push({ id, key });
        };
        const narrowing = withoutTiled(where, tiling!.from);
        if (narrowing.size > 0) for (const id of kindDrafts?.keys() ?? []) wanted(id);
        for (const id of kind.wanted) wanted(id);
        let stored: option<option<unknown>[]> = some([]);
        if (extra.length > 0) stored = recordSliceRows(part, extra.map((e) => e.key));
        // The rows asked of the narrowing: the cells', for the fields their searches leave, and the stored rows read by key.
        const asked: { key: unknown; row: unknown }[] = [];
        const residual = residualOf(series, where).length > 0;
        if (residual) for (const [key, row] of rows) asked.push({ key, row });
        const storedRows: { id: string; key: unknown; row: unknown }[] = [];
        if (stored.type === "some") {
            stored.value.forEach((row, i) => { if (row.type === "some") storedRows.push({ ...extra[i]!, row: row.value }); });
        }
        if (narrowing.size > 0) for (const { key, row } of storedRows) asked.push({ key, row });
        let within: boolean[] = [];
        if (asked.length > 0) {
            const answer = recordSliceWithin(part, narrowing, asked);
            if (answer.type !== "some") return READING;
            within = answer.value;
        }
        // What the narrowing does not hold draws nowhere, nor does a draft of it.
        const dropped = new Set<string>();
        let i = 0;
        if (residual) {
            for (const [key] of [...rows]) {
                if (!within[i++]) {
                    rows.delete(key);
                    dropped.add(codec.idOf(key));
                }
            }
        }
        for (const { id, key, row } of storedRows) {
            const holds = narrowing.size === 0 || within[i++] === true;
            if (holds) rows.set(key, row);
            else dropped.add(id);
        }
        // Drafts of events whose rows are still in flight show as drafted until they land.
        const made = this.encode(kind.key, codec, [...read.value, ...storedRows.map((s) => s.row), ...within], rows);
        return { mode: "cells", cells: made.bytes, held: made.held, dropped };
    }

    /**
     * A kind past the cap: its summary's shading, at the largest of its tiles
     * that divides the host's bucket and serves the narrowing whole; with none,
     * a kind read by cells (`windowed`) is read over the range while its count
     * there is within the cap — when it has not been counted past it — and
     * every kind past it gives the notice, `counted` its events, `undefined`
     * where its count is no number of them.
     */
    private overBudget(
        kind: ScheduleCellKind, where: Where, blocks: readonly Block[], range: { from: Date; to: Date },
        buckets: readonly ScheduleCellBucket[], resolution: TimeResolution | undefined, totals: Totals, counted: number | undefined, windowed: boolean,
    ): KindRead | typeof READING {
        const codec = this.codecOf(kind);
        const part = kind.part;
        const indexes = part?.config.indexes ?? [];
        // Whether its shading or its hatch draws over the paged kind's rows: then those rows draw what they hold.
        const paged = windowed;
        if (part !== undefined) {
            for (const tile of dividingTiles(resolution)) {
                const summary = tileIndexFor(indexes, where, "summary", (t) => t === tile);
                if (summary === undefined || residualOf(summary, where).length > 0) continue;
                const shaded = this.summaryCells(kind, part, where, summary, blocks, range, totals);
                if (shaded !== undefined) return shaded === READING ? READING : { mode: "shade", cells: codec.empty, notice: undefined, paged };
            }
        }
        let events = counted;
        if (windowed) {
            // Its count over the range it reads: the count its window's read asks first.
            const within = scheduleWithinCap(kind.count, range.from, range.to);
            if (within.type !== "some") return READING;
            if (within.value) return { mode: "window" };
            events = this.eventsOf(kind, range);
        }
        // The notice: the rows hatched, and the resolution the smallest summary shades at.
        for (const block of blocks) {
            const series = kind.shadeKey(block.slot);
            let held = totals.get(series);
            if (held === undefined) { held = { booked: kind.booked, byKey: new Map() }; totals.set(series, held); }
            for (const key of block.keys) held.byKey.set(key, "hatch");
        }
        const tiles = indexes.flatMap((index) => (index.summary.type === "some" ? [index.summary.value.tile.type] : []));
        const smallest = (["day", "week", "month", "quarter", "year"] as const).find((t) => tiles.includes(t));
        return { mode: "shade", cells: codec.empty, notice: { kind: kind.key, name: kind.name, events, resolution: smallest }, paged };
    }

    /**
     * A summary's cells over some blocks, folded into each resource's totals
     * by tile; `undefined` when they take more than one batch of searches.
     */
    private summaryCells(
        kind: ScheduleCellKind, part: ScheduleCellPart, where: Where, summary: Index, blocks: readonly Block[], range: { from: Date; to: Date },
        totals: Totals,
    ): true | typeof READING | undefined {
        const tiling = tilingOf(summary)!;
        const tiles = wantedTiles(tiling.tile.type, range.from, range.to, MAX_RECORD_SLICE_BATCH);
        if (tiles === undefined) return undefined;
        const cells: { cell: RecordSliceCell; block: Block; keys: string[]; tile: number }[] = [];
        let searches = 0;
        for (const tile of tiles) {
            for (const block of blocks) {
                const keys: string[] = [];
                const literals: string[] = [];
                for (const key of block.keys) {
                    const literal = this.literal(kind, block.slot, key);
                    if (literal === undefined) continue;
                    keys.push(key);
                    literals.push(literal);
                }
                if (literals.length === 0) continue;
                const queries = tileCellQueries(summary, where, tile, literals).queries;
                cells.push({ cell: { id: `${block.slot}:${block.index}@${tile.getTime()}`, queries }, block, keys, tile: tile.getTime() });
                searches += queries.length;
            }
        }
        if (searches > MAX_RECORD_SLICE_BATCH) return undefined;
        const runs = recordSliceCellRuns(part, summary.name, cells.map((c) => c.cell));
        if (runs.type !== "some") return READING;
        const read = this.entriesOf(`${kind.key}\u0000${summary.name}`, part, summary.name, cells.map((c) => c.cell));
        if (read.type !== "some") return READING;
        cells.forEach(({ cell, block, keys, tile }, n) => {
            const series = kind.shadeKey(block.slot);
            let held = totals.get(series);
            if (held === undefined) { held = { booked: kind.booked, byKey: new Map() }; totals.set(series, held); }
            const found = runs.value.get(cell.id) as RecordSliceCellRuns;
            const entries = read.value[n]!;
            // A search a key under each combination of the leading fields' values, the keys inner: the entries of
            // each search in order, those of an empty one none.
            let at = 0;
            found.ranges.forEach((range, q) => {
                const count = Number(range.count);
                const key = keys[q % keys.length]!;
                for (const entry of entries.slice(at, at + count)) {
                    if (entry.value?.type !== "some") continue;
                    const t = entry.value.value as { count: bigint; ms: bigint };
                    let byTile = held.byKey.get(key);
                    if (byTile === "hatch") continue;
                    if (byTile === undefined) { byTile = new Map(); held.byKey.set(key, byTile); }
                    const was = byTile.get(tile);
                    byTile.set(tile, { count: (was?.count ?? 0) + Number(t.count), ms: (was?.ms ?? 0) + Number(t.ms) });
                }
                at += count;
            });
            // A resource with no event in a tile still shades, at nothing.
            for (const key of keys) if (!held.byKey.has(key)) held.byKey.set(key, new Map());
        });
        return true;
    }
}

/** The shading the totals fold into, over the buckets: each row's key, then each resource's buckets. */
function shadingOf(totals: Totals, buckets: readonly ScheduleCellBucket[]): ScheduleCellShading {
    return new SortedMap([...totals].map(([series, { booked, byKey }]) => [series, new SortedMap([...byKey].map(([key, held]) =>
        [key, held === "hatch" ? hatchOf(buckets) : shadesOf(held, buckets, booked)] as [string, ScheduleCellShade[]]), compareString)] as [string, SortedMap<string, ScheduleCellShade[]>]),
    compareString);
}

/** Every kind's drafts, those a kind read by its cells leaves out dropped: the same object when it drops none. */
function narrowedDrafts(drafts: ScheduleEventDraftsValue, dropped: ReadonlyMap<string, ReadonlySet<string>>): ScheduleEventDraftsValue {
    if (dropped.size === 0) return drafts;
    return new SortedMap([...drafts].map(([kind, byId]): [string, ValueTypeOf<typeof ScheduleDraftsType>] => {
        const gone = dropped.get(kind);
        return [kind, gone === undefined ? byId : new SortedMap([...byId].filter(([id]) => !gone.has(id)), compareString)];
    }), compareString);
}

/**
 * Two reads alike: the same cells by their bytes — the rows they hold are
 * made from them — and the same shading, drafts, notices and kinds past the
 * cap; over a paged kind read by its cells, the same resources covered over
 * the same range, as its rows wait on them. A read over another range that
 * holds the same is the same, where nothing waits on its range: a pan within
 * the cap hands nothing on.
 */
function sameRead(a: Read, b: Read): boolean {
    const blobs = (x: ScheduleCellReads, y: ScheduleCellReads) => x.size === y.size && [...x].every(([slot, bytes]) => {
        const other = y.get(slot);
        return other !== undefined && blobEqual(other, bytes);
    });
    return blobs(a.reads, b.reads) && shadingEqual(a.shading, b.shading) && draftsEqual(a.drafts, b.drafts) && sameKeys(a.capped, b.capped)
        && sameKeys(a.covered, b.covered) && (a.covered === undefined || sameRange(a.range, b.range))
        && a.notices.length === b.notices.length && a.notices.every((n, i) => {
            const m = b.notices[i]!;
            return stringEqual(n.kind, m.kind) && n.events === m.events && n.resolution === m.resolution;
        });
}

/**
 * The kinds read by their cells (see the module docs): placed on the paged
 * resource kind, their sources listing a series index of their records.
 *
 * @param kinds - The event kinds
 * @param paged - The paged resource kind, when one pages
 * @returns Their slots, in order
 */
export function scheduleCellKinds(kinds: readonly ScheduleCellKind[], paged: ScheduleCellPaged | undefined): string[] {
    return kinds.filter((kind) => readByCells(kind, paged)).map((kind) => kind.key);
}

/**
 * The kinds' cells and counts (see the module docs), read in the component
 * that reads the event kinds' rows: what the host's seams draw the kinds from,
 * every kind's drafts as they take them, and what a gesture finds an event's
 * row in. Before the first read lands, every kind read by its cells draws
 * nothing yet, so no seam reads it over the range meanwhile; a read in flight
 * leaves the last standing, the drafts as they are now. Over a paged kind it
 * says which resources' rows draw what is known of them (`drawn`, #1398): every
 * other row's cells never landed, or are on their way over a range they were
 * not read over, and it draws the region wash — before the first read lands,
 * every row. A read again over the same range, a commit's or another
 * narrowing's, leaves the rows drawn as they were, their cells standing in.
 * It hands on the same object while what it hands on holds: where no kind is
 * read by its cells over a paged kind, a pan that leaves every kind within the
 * cap, or past it as it was, hands nothing on.
 *
 * @param args - What it reads over
 * @returns What it read
 */
export function useScheduleCells(args: ScheduleCellsArgs): ScheduleCellsRead {
    const [reader] = useState(() => new CellsReader());
    const { host, kinds, resources, paged, range, buckets, resolution, drafts, span } = args;
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    const read = useCallback(() => reader.read({
        kinds, resources, paged, buckets, resolution, drafts, span,
        range: from === undefined || to === undefined ? undefined : { from: new Date(from), to: new Date(to) },
    }), [reader, kinds, resources, paged, buckets, resolution, from, to, drafts, span]);
    const { result } = useTrackedEvaluation(read);
    const last = useRef<Read | undefined>(undefined);
    // Before the first read: every kind read by its cells draws nothing yet — and over a paged kind, no resource's row
    // drawn.
    const opening = useMemo((): Read => {
        const slots = scheduleCellKinds(kinds, paged);
        return {
            reads: new SortedMap(slots.map((slot): [string, Uint8Array] =>
                [slot, reader.codecOf(kinds.find((kind) => stringEqual(kind.key, slot))!).empty]), compareString),
            shading: new SortedMap([], compareString),
            drafts,
            held: new Map(),
            notices: [],
            capped: NONE_CAPPED,
            dropped: new Map(),
            covered: paged !== undefined && slots.length > 0 ? NO_RESOURCES : undefined,
            range: undefined,
        };
    }, [reader, kinds, drafts, paged]);
    // What it hands on: the same object while the read, whether one its rows wait on is in flight, what it reads again
    // and over which range hold.
    const handed = useRef<{ standing: Read; drafts: ScheduleEventDraftsValue; reading: boolean; wanted: ReadonlySet<string>; moved: boolean; read: ScheduleCellsRead } | undefined>(undefined);
    return useMemo((): ScheduleCellsRead => {
        if (!result.ok) console.error(`[${host}] the event kinds' cells could not be read:`, result.error);
        const inFlight = !result.ok || result.value === READING;
        if (!inFlight) {
            const next = result.value as Read;
            if (last.current === undefined || !sameRead(last.current, next)) last.current = next;
        }
        // While a read is in flight, the last stands in — the drafts as they are now, less those it found the narrowing does not hold.
        const standing = last.current ?? opening;
        const wanted = reader.wanted();
        // The resources whose cells it holds, over a paged kind read by its cells: only there does anything wait on a read.
        const covered = standing.covered;
        const reading = covered !== undefined && inFlight;
        // In flight over another range than the one standing was read over: its cells there never landed.
        const moved = reading && standing.range !== undefined && from !== undefined && to !== undefined && !sameRange(standing.range, { from, to });
        const was = handed.current;
        if (was !== undefined && was.standing === standing && was.reading === reading && was.moved === moved
            && (!inFlight || (Object.is(was.drafts, drafts) && was.wanted === wanted))) return was.read;
        // The rows that draw what is known of them: the resources whose cells it holds — over another range, less those it
        // reads again; over the same range, a commit's or another narrowing's read, every one, its cells standing in.
        const drawn = covered === undefined || !moved ? covered : new Set([...covered].filter((key) => !wanted.has(key)));
        const handedOn: ScheduleCellsRead = {
            reads: standing.reads,
            shading: standing.shading,
            drafts: inFlight ? narrowedDrafts(drafts, standing.dropped) : standing.drafts,
            held: standing.held,
            notices: standing.notices,
            capped: standing.capped,
            reading,
            drawn,
        };
        handed.current = { standing, drafts, reading, wanted, moved, read: handedOn };
        return handedOn;
    }, [host, result, opening, drafts, reader, from, to]);
}
