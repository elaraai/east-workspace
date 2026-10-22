/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Plan's events read by cells (#1039): an event kind placed on a paged
 * resource kind, whose source of the slice lists a series index of its
 * record, reads the events of the resources in view — and of no resource, its
 * Unassigned row's — tile by tile, never every event over the window.
 *
 * # What it reads
 *
 * A cell is a block of {@link PLAN_CELL_BLOCK} of the paged kind's resources,
 * in the kind's order, in one tile of the series index: one exact search a
 * resource, `[…on, tile, key]` (`tileCellQueries`). The cells wanted are the
 * blocks meeting the rows in view and {@link PLAN_CELL_MARGIN} resources
 * either side, by the tiles covering the range the canvas reads — its window
 * and the periods it lays out beyond each edge — and one tile either side,
 * with the cells of no resource in those tiles. Every wanted cell's searches
 * go in one request, which counts each cell's entries before one is read; the
 * entries of the cells not yet held, in one more. A cell is kept while it is
 * wanted, at the revision it was read at: a pan or a scroll within the cells
 * held reads nothing, and a commit reads the wanted cells again, the old ones
 * standing in until they land. A long event its cells repeat, tile by tile, is
 * one event, kept by its key.
 *
 * # The budget
 *
 * While the wanted cells hold at most {@link PLAN_CELL_BUDGET} entries, their
 * events draw. Past it — or past one batch of searches — the kind's summary
 * index draws its shading instead: its cells, at the largest of its tiles that
 * divides the canvas's bucket and serves the narrowing whole, folded into the
 * buckets — the share of each booked for a kind drawn as bars or chips, how
 * many events touch it for one drawn as tiles or marks. With none to shade,
 * the kind draws its events over the window while the rail's exact count of
 * them is within the budget, and past it the notice: its rows hatched, and the
 * frame's banner naming how many events there are and the resolution that
 * shows their shading. A kind placed on resources read whole, whose source
 * lists a summary index, shades past the budget the same way, the rail's exact
 * count deciding.
 *
 * # The narrowing, the drafts and the link ends
 *
 * A series index led by the narrowed fields serves the narrowing exactly; the
 * fields it leaves are asked of the events read, in one read
 * (`recordSliceWithin`). The drafts are the session's, and each draws where it
 * places its event, read or not — but a draft of an event the narrowing does
 * not hold, which a narrowed window leaves out too: the stored rows of the
 * drafted events the cells do not hold are read by their keys, in one read,
 * and asked of the narrowing in the same read as the cells' events. A link's
 * event end the cells do not hold is read by its key in that read, so it
 * finds its row.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
    ArrayType, BlobType, SortedMap, StringType, compareFor, encodeBeast2For, equalFor, fromEastTypeValue, none, parseFor, printFor, some,
    type EastType, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { SeekQueryType } from "@elaraai/east-ui";
import {
    MAX_RECORD_SLICE_BATCH, tileCellQueries, tileIndexFor, tileNext, tileStart, tilesOver, tilingOf,
    type RecordSliceCell, type RecordSliceCellRuns, type RecordSliceChoiceType, type RecordSliceEntry, type RecordSliceIndexType, type RecordTile,
} from "@elaraai/east-ui/internal";
import {
    PLAN_PAGE_SIZE, PlanEventDraftsType, PlanEventShadingType,
    type PlanEventReadsType, type PlanEventShadeType, type PlanPayloadType, type ScheduleDraftsType,
} from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import {
    recordSliceCellEntries, recordSliceCellRuns, recordSliceRevision, recordSliceRows, recordSliceWithin,
} from "@elaraai/east-ui-components/internal";
import type { TimeResolution } from "../../shared/time/scale.js";
import { timeInstant } from "../instant.js";
import type { PlanRootValue } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanEventPart, PlanSourcePart } from "./sources.js";

/** The most entries the Plan reads by cells over the view (#1039): past it, a summary's shading. */
export const PLAN_CELL_BUDGET = 10_000;

/** How many of a paged resource kind's resources a cell holds: a block of them, in the kind's order. */
export const PLAN_CELL_BLOCK = 50;

/** The resources either side of the rows in view whose blocks are read too. */
export const PLAN_CELL_MARGIN = 25;

type PlanPayloadValue = ValueTypeOf<typeof PlanPayloadType>;
/** One event kind, as the payload carries it. */
type EventKind = PlanPayloadValue["events"][number];
/** One resource kind, as the payload carries it. */
type ResourceKind = PlanPayloadValue["resources"][number];
/** A paged resource kind's rows, as the payload carries them. */
type Paged = Extract<PlanPayloadValue["paged"], { type: "some" }>["value"];
/** Every kind's drafts, by kind then by entry id. */
type Drafts = ValueTypeOf<typeof PlanEventDraftsType>;
/** One kind's drafts, by entry id. */
type KindDrafts = ValueTypeOf<typeof ScheduleDraftsType>;
/** What a reader read of each kind by its cells, by the kind's slot. */
type Reads = ValueTypeOf<typeof PlanEventReadsType>;
/** The resources' shading. */
type Shading = ValueTypeOf<typeof PlanEventShadingType>;
/** One bucket of a resource's shading. */
type Shade = ValueTypeOf<typeof PlanEventShadeType>;
/** One index of a record Slice's binding. */
type Index = ValueTypeOf<typeof RecordSliceIndexType>;
/** A record Slice's narrowing. */
type Where = ReadonlyMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>;
/** The canvas's links. */
type Links = PlanRootValue["links"];

const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const shadingEqual = equalFor(PlanEventShadingType);
const draftsEqual = equalFor(PlanEventDraftsType);
const printQueries = printFor(ArrayType(SeekQueryType));

// ============================================================================
// What a reader wants: blocks, tiles and buckets
// ============================================================================

/** The resources in view of a paged resource kind, by their place in its order: the first and the last. */
export interface PlanCellView {
    /** The first resource in view. */
    readonly first: number;
    /** The last resource in view. */
    readonly last: number;
}

/**
 * No row in view reported yet: the first resource, where a canvas opens — the
 * first block, and the next only once the rows in view reach within
 * {@link PLAN_CELL_MARGIN} of it.
 */
export const PLAN_CELL_OPENING: PlanCellView = { first: 0, last: 0 };

/**
 * The blocks of a paged resource kind's resources a reader wants: those
 * meeting the resources in view and {@link PLAN_CELL_MARGIN} either side.
 *
 * @param view - The resources in view
 * @param total - How many resources the kind has, once known
 * @returns The blocks, by their place, ascending
 */
export function wantedBlocks(view: PlanCellView, total: number | undefined): number[] {
    const lo = Math.max(0, view.first - PLAN_CELL_MARGIN);
    const hi = total === undefined ? view.last + PLAN_CELL_MARGIN : Math.min(view.last + PLAN_CELL_MARGIN, total - 1);
    const out: number[] = [];
    for (let b = Math.floor(lo / PLAN_CELL_BLOCK); b <= Math.floor(hi / PLAN_CELL_BLOCK); b++) out.push(b);
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
 * @param resolution - The canvas's resolution; `undefined` on an axis of no time
 * @returns The tiles
 */
export function dividingTiles(resolution: TimeResolution | undefined): readonly RecordTile[] {
    return resolution === undefined ? [] : DIVIDING[resolution];
}

/** One bucket of the canvas, by its start and its end, in ms. */
export interface PlanCellBucket {
    /** Its start. */
    readonly start: number;
    /** Its end, exclusive. */
    readonly end: number;
}

/**
 * The buckets a range is cut into at a scale's resolution: the range the
 * canvas reads starts and ends on whole periods, the window's and those laid
 * out beyond it.
 *
 * @param scale - The canvas's scale
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @returns The buckets, in order
 */
export function bucketsOver(scale: PlanScale, from: Date, to: Date): PlanCellBucket[] {
    const out: PlanCellBucket[] = [];
    for (let at = from.getTime(); at < to.getTime();) {
        const next = scale.offset(timeInstant(new Date(at)), 1);
        const end = next.type === "time" ? next.value.getTime() : NaN;
        if (!(end > at)) break;
        out.push({ start: at, end });
        at = end;
    }
    return out;
}

/** How many events touch a tile, and the milliseconds of it they cover: a summary's totals, as numbers. */
export interface PlanCellTotals {
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
 * @param booked - Whether its rows draw bars or chips: the share booked; else how many
 * @returns Its shading, a bucket each
 */
export function shadesOf(totals: ReadonlyMap<number, PlanCellTotals> | undefined, buckets: readonly PlanCellBucket[], booked: boolean): Shade[] {
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
function hatchOf(buckets: readonly PlanCellBucket[]): Shade[] {
    return buckets.map(({ start }) => ({ at: new Date(start), value: none }));
}

// ============================================================================
// What a reader reads
// ============================================================================

/** The rows of a paged resource kind in view: the first and the last, each by its window and its key's text. */
export interface PlanCellSpan {
    /** The first row in view. */
    readonly first: { readonly w: number; readonly key: string };
    /** The last row in view. */
    readonly last: { readonly w: number; readonly key: string };
}

/** A kind drawing the notice in place of its events: too many of them at this resolution, and no summary to shade them. */
export interface PlanCellNotice {
    /** The kind's slot. */
    readonly kind: string;
    /** Its name. */
    readonly name: string;
    /** How many of its events are in view, as far as they are counted. */
    readonly events: number;
    /** The resolution its smallest summary shades at; `undefined` when it has none. */
    readonly resolution: RecordTile | undefined;
}

/** What the reader read: what the seams draw the kinds from, and what a gesture finds an event's row in. */
export interface PlanCellsRead {
    /** What a reader read of each kind by its cells, by its slot: the seams' `reads`. A kind it names not is read over the window. */
    readonly reads: Reads;
    /** The resources' shading: the seams' `shading`. */
    readonly shading: Shading;
    /** Every kind's drafts as the seams take them: a kind read by its cells, those of events its narrowing does not hold left out. */
    readonly drafts: Drafts;
    /** Each kind read by its cells, by its slot: the rows they hold, by the event's key's text — where a gesture finds an event's row. */
    readonly held: ReadonlyMap<string, ReadonlyMap<string, { readonly row: Uint8Array }>>;
    /** The kinds drawing the notice in place of their events. */
    readonly notices: readonly PlanCellNotice[];
    /** Whether a read is in flight: what is drawn stands in until it lands. */
    readonly reading: boolean;
}

/** What {@link usePlanCells} reads over. */
export interface PlanCellsArgs {
    /** The event kinds, as the payload carries them. */
    readonly kinds: readonly EventKind[];
    /** The resource kinds, as the payload carries them: a kind read whole shades over their rows. */
    readonly resources: readonly ResourceKind[];
    /** The event kinds narrowed through their sources of the slice, and the parts they read through. */
    readonly parts: readonly PlanEventPart[];
    /** The paged resource kind's rows, when a kind pages. */
    readonly paged: Paged | undefined;
    /** The canvas's scale: its resolution and its buckets. */
    readonly scale: PlanScale | undefined;
    /** The range the canvas reads its events over. */
    readonly range: { readonly from: Date; readonly to: Date } | undefined;
    /** Every kind's drafts — the same object while they hold. */
    readonly drafts: Drafts;
    /** The ids the viewer hides in the library's Series tab. */
    readonly hidden: readonly string[];
    /** The paged kind's rows in view, as the canvas last reported them; `undefined` before it has. */
    readonly span: PlanCellSpan | undefined;
    /** The canvas's links: an event end the cells do not hold is read by its key. */
    readonly links: Links;
}

/** A read whose cells are still in flight. */
const READING = "reading";

/** The rows a kind's cells hold, by the event's key's text, each its row's bytes. */
type HeldRows = ReadonlyMap<string, { readonly row: Uint8Array }>;

/** One read of every kind, and the drafts each kind read by its cells leaves out, by the kind's slot. */
type Read = Omit<PlanCellsRead, "reading"> & { readonly dropped: ReadonlyMap<string, ReadonlySet<string>> };

/** One kind's read. */
type KindRead =
    | { readonly mode: "cells"; readonly cells: Uint8Array; readonly held: HeldRows; readonly dropped: ReadonlySet<string> }
    | { readonly mode: "shade"; readonly cells: Uint8Array; readonly notice: PlanCellNotice | undefined }
    | { readonly mode: "window" };

/** A kind's types, as its cells are encoded in. */
interface KindCodec {
    readonly keyType: EastType;
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

/** A narrowing without its range of the field an index's tiles cover: the tiles hold the window. */
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

    /** A kind's codec, made once per kind. */
    codecOf(kind: EventKind): KindCodec {
        let codec = this.codecs.get(kind);
        if (codec === undefined) {
            const cellsType = fromEastTypeValue(kind.cellsType) as ArrayType<StructType>;
            const fields = cellsType.value.fields as Record<string, EastType>;
            const keyType = fields["key"]!;
            const printKey = printFor(keyType);
            const parseKey = parseFor(keyType);
            const encodeCells = encodeBeast2For(cellsType) as (entries: { key: unknown; row: unknown }[]) => Uint8Array;
            const string = keyType.type === "String";
            codec = {
                keyType,
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
            this.codecs.set(kind, codec);
        }
        return codec;
    }

    /** The `.east` text a kind's series and summary indexes file a resource's events under; `undefined` for one its field cannot name. */
    private literal(kind: EventKind, slot: string, key: string): string | undefined {
        let held = this.literals.get(kind);
        if (held === undefined) { held = new Map(); this.literals.set(kind, held); }
        const at = `${slot}\u0000${key}`;
        if (!held.has(at)) {
            const literal = kind.seriesKey(some({ kind: slot, key }));
            held.set(at, literal.type === "some" ? literal.value : undefined);
        }
        return held.get(at);
    }

    /** The `.east` text a kind's indexes file its events on no resource under; `undefined` for a field that must name one. */
    private noResource(kind: EventKind): string | undefined {
        let held = this.unassigned.get(kind);
        if (held === undefined) {
            const literal = kind.seriesKey(none);
            held = { literal: literal.type === "some" ? literal.value : undefined };
            this.unassigned.set(kind, held);
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
    private entriesOf(at: string, part: PlanSourcePart, index: string, cells: readonly RecordSliceCell[]): option<RecordSliceEntry[][]> {
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
     * @returns What it read; {@link READING} while a cell's count or entries are in flight
     */
    read(args: PlanCellsArgs): Read | typeof READING {
        const { parts, paged, scale, range, drafts, hidden, span, links } = args;
        const reads: [string, Uint8Array][] = [];
        const held = new Map<string, HeldRows>();
        const dropped = new Map<string, ReadonlySet<string>>();
        const notices: PlanCellNotice[] = [];
        // The shading, by a row's key, then by the resource's key: each tile's totals, or the hatch.
        const totals = new Map<string, { booked: boolean; byKey: Map<string, Map<number, PlanCellTotals> | "hatch"> }>();
        if (range === undefined || scale === undefined) return READING;
        const buckets = bucketsOver(scale, range.from, range.to);
        // The paged kind's blocks in view, read once for every kind placed on it.
        let pagedBlocks: Block[] | typeof READING | undefined;
        const blocksOfPaged = (): Block[] | typeof READING => {
            if (pagedBlocks !== undefined) return pagedBlocks;
            pagedBlocks = paged === undefined || hidden.some((id) => stringEqual(id, `resources.${paged.kind}`)) ? [] : this.pagedBlocks(paged, span);
            return pagedBlocks;
        };
        for (const { kind, part } of parts) {
            if (hidden.some((id) => stringEqual(id, `events.${kind.key}`))) continue;
            const indexes = part.config.indexes;
            const series = indexes.some((index) => index.series.type === "some");
            const summary = indexes.some((index) => index.summary.type === "some");
            if (!series && !summary) continue;
            const where = part.read().where;
            let read: KindRead | typeof READING;
            if (series && paged !== undefined) {
                const blocks = blocksOfPaged();
                read = blocks === READING ? READING : this.cellsKind(kind, part, where, blocks, range, buckets, scale.resolution, drafts, links, totals);
            } else {
                read = this.wholeKind(kind, part, where, args.resources, range, buckets, scale.resolution, totals);
            }
            if (read === READING) return READING;
            if (read.mode === "window") continue;
            reads.push([kind.key, read.cells]);
            if (read.mode === "cells") {
                held.set(kind.key, read.held);
                if (read.dropped.size > 0) dropped.set(kind.key, read.dropped);
            } else if (read.notice !== undefined) {
                notices.push(read.notice);
            }
        }
        return {
            reads: new SortedMap(reads, compareString),
            shading: shadingOf(totals, buckets),
            drafts: narrowedDrafts(drafts, dropped),
            held,
            notices,
            dropped,
        };
    }

    /** The paged kind's blocks in view, each its resources' keys; {@link READING} while a window of them is in flight. */
    private pagedBlocks(paged: Paged, span: PlanCellSpan | undefined): Block[] | typeof READING {
        const windowKeys = (w: number): string[] | undefined => {
            const keys = paged.keys(BigInt(w * PLAN_PAGE_SIZE), BigInt(PLAN_PAGE_SIZE));
            return keys.type === "some" ? keys.value : undefined;
        };
        // Where a row in view sits in the kind's order: its window's start, while its window's keys are read.
        const place = (at: PlanCellSpan["first"]): number => {
            const i = windowKeys(at.w)?.findIndex((key) => stringEqual(key, at.key)) ?? -1;
            return at.w * PLAN_PAGE_SIZE + Math.max(0, i);
        };
        const view = span === undefined ? PLAN_CELL_OPENING : { first: place(span.first), last: place(span.last) };
        const total = paged.total();
        const blocks: Block[] = [];
        for (const b of wantedBlocks(view, total.type === "some" ? Number(total.value) : undefined)) {
            const w = Math.floor((b * PLAN_CELL_BLOCK) / PLAN_PAGE_SIZE);
            const keys = windowKeys(w);
            if (keys === undefined) return READING;
            const at = b * PLAN_CELL_BLOCK - w * PLAN_PAGE_SIZE;
            const own = keys.slice(at, at + PLAN_CELL_BLOCK);
            if (own.length > 0) blocks.push({ slot: paged.kind, index: b, keys: own });
        }
        return blocks;
    }

    /**
     * A kind placed on the paged kind, read by its series index's cells: its
     * events while the cells hold at most the budget, its summary's shading
     * past it (see the module docs).
     */
    private cellsKind(
        kind: EventKind, part: PlanSourcePart, where: Where, blocks: readonly Block[], range: { from: Date; to: Date },
        buckets: readonly PlanCellBucket[], resolution: TimeResolution | undefined, drafts: Drafts, links: Links,
        totals: Map<string, { booked: boolean; byKey: Map<string, Map<number, PlanCellTotals> | "hatch"> }>,
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
            return this.overBudget(kind, part, where, blocks, range, buckets, resolution, totals, undefined, true);
        }
        const runs = recordSliceCellRuns(part, series.name, cells);
        if (runs.type !== "some") return READING;
        let count = 0n;
        for (const found of runs.value.values()) count += found.total;
        if (count > BigInt(PLAN_CELL_BUDGET)) {
            return this.overBudget(kind, part, where, blocks, range, buckets, resolution, totals, Number(count), true);
        }
        const read = this.entriesOf(`${kind.key}\u0000${series.name}`, part, series.name, cells);
        if (read.type !== "some") return READING;
        // Each event once, by its key: a long one is in every tile it touches.
        const rows = new SortedMap<unknown, unknown>([], codec.compareKey);
        for (const entries of read.value) {
            for (const entry of entries) if (entry.row?.type === "some") rows.set(entry.key, entry.row.value);
        }
        // The events not read whose rows are wanted: those drafted, and a link's ends.
        const kindDrafts = drafts.get(kind.key);
        const extra: { id: string; key: unknown }[] = [];
        const wanted = (id: string) => {
            const key = codec.keyOf(id);
            if (key !== undefined && !rows.has(key) && !extra.some((e) => stringEqual(e.id, id))) extra.push({ id, key });
        };
        const narrowing = withoutTiled(where, tiling!.from);
        if (narrowing.size > 0) for (const id of kindDrafts?.keys() ?? []) wanted(id);
        for (const link of links) {
            for (const end of [link.from, link.to]) {
                if (end.row.type === "entry" && end.row.value.path.length === 0 && stringEqual(end.row.value.series, kind.key)) wanted(end.run);
            }
        }
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
     * A kind with a summary placed on resources read whole: its events over
     * the window while the rail's exact count of them is within the budget,
     * its summary's shading past it.
     */
    private wholeKind(
        kind: EventKind, part: PlanSourcePart, where: Where, resources: readonly ResourceKind[], range: { from: Date; to: Date },
        buckets: readonly PlanCellBucket[], resolution: TimeResolution | undefined,
        totals: Map<string, { booked: boolean; byKey: Map<string, Map<number, PlanCellTotals> | "hatch"> }>,
    ): KindRead | typeof READING {
        const count = part.count();
        if (count.type !== "some") return READING;
        if (count.value <= BigInt(PLAN_CELL_BUDGET)) return { mode: "window" };
        const blocks: Block[] = [];
        for (const slot of kind.takes) {
            const rows = resources.find((r) => stringEqual(r.key, slot))?.rows ?? [];
            for (let at = 0; at < rows.length; at += PLAN_CELL_BLOCK) {
                blocks.push({ slot, index: at / PLAN_CELL_BLOCK, keys: rows.slice(at, at + PLAN_CELL_BLOCK).map((row) => row.key) });
            }
        }
        return this.overBudget(kind, part, where, blocks, range, buckets, resolution, totals, Number(count.value), false);
    }

    /**
     * A kind past the budget: its summary's shading, at the largest of its
     * tiles that divides the canvas's bucket and serves the narrowing whole;
     * with none, its events over the window while the rail's exact count is
     * within the budget — when it has not been counted past it — and the
     * notice past it.
     */
    private overBudget(
        kind: EventKind, part: PlanSourcePart, where: Where, blocks: readonly Block[], range: { from: Date; to: Date },
        buckets: readonly PlanCellBucket[], resolution: TimeResolution | undefined,
        totals: Map<string, { booked: boolean; byKey: Map<string, Map<number, PlanCellTotals> | "hatch"> }>,
        counted: number | undefined, windowed: boolean,
    ): KindRead | typeof READING {
        const codec = this.codecOf(kind);
        const indexes = part.config.indexes;
        for (const tile of dividingTiles(resolution)) {
            const summary = tileIndexFor(indexes, where, "summary", (t) => t === tile);
            if (summary === undefined || residualOf(summary, where).length > 0) continue;
            const shaded = this.summaryCells(kind, part, where, summary, blocks, range, totals);
            if (shaded !== undefined) return shaded === READING ? READING : { mode: "shade", cells: codec.empty, notice: undefined };
        }
        let events = counted;
        if (windowed) {
            const count = part.count();
            if (count.type !== "some") return READING;
            if (count.value <= BigInt(PLAN_CELL_BUDGET)) return { mode: "window" };
            events = Number(count.value);
        }
        // The notice: the rows hatched, and the resolution the smallest summary shades at.
        for (const block of blocks) {
            const series = `${block.slot}.${kind.draw.type}`;
            let held = totals.get(series);
            if (held === undefined) { held = { booked: booked(kind), byKey: new Map() }; totals.set(series, held); }
            for (const key of block.keys) held.byKey.set(key, "hatch");
        }
        const tiles = indexes.flatMap((index) => (index.summary.type === "some" ? [index.summary.value.tile.type] : []));
        const smallest = (["day", "week", "month", "quarter", "year"] as const).find((t) => tiles.includes(t));
        return { mode: "shade", cells: codec.empty, notice: { kind: kind.key, name: kind.name, events: events ?? 0, resolution: smallest } };
    }

    /**
     * A summary's cells over some blocks, folded into each resource's totals
     * by tile; `undefined` when they take more than one batch of searches.
     */
    private summaryCells(
        kind: EventKind, part: PlanSourcePart, where: Where, summary: Index, blocks: readonly Block[], range: { from: Date; to: Date },
        totals: Map<string, { booked: boolean; byKey: Map<string, Map<number, PlanCellTotals> | "hatch"> }>,
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
            const series = `${block.slot}.${kind.draw.type}`;
            let held = totals.get(series);
            if (held === undefined) { held = { booked: booked(kind), byKey: new Map() }; totals.set(series, held); }
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

/** Whether a kind's rows draw bars or chips, which shade as the share of each bucket booked. */
function booked(kind: EventKind): boolean {
    return kind.draw.type === "span" || kind.draw.type === "cards";
}

/** The shading the totals fold into, over the buckets: each row's key, then each resource's buckets. */
function shadingOf(totals: ReadonlyMap<string, { booked: boolean; byKey: ReadonlyMap<string, ReadonlyMap<number, PlanCellTotals> | "hatch"> }>,
    buckets: readonly PlanCellBucket[]): Shading {
    return new SortedMap([...totals].map(([series, { booked, byKey }]) => [series, new SortedMap([...byKey].map(([key, held]) =>
        [key, held === "hatch" ? hatchOf(buckets) : shadesOf(held, buckets, booked)] as [string, Shade[]]), compareString)] as [string, SortedMap<string, Shade[]>]),
    compareString);
}

/** Every kind's drafts, those a kind read by its cells leaves out dropped: the same object when it drops none. */
function narrowedDrafts(drafts: Drafts, dropped: ReadonlyMap<string, ReadonlySet<string>>): Drafts {
    if (dropped.size === 0) return drafts;
    return new SortedMap([...drafts].map(([kind, byId]): [string, KindDrafts] => {
        const gone = dropped.get(kind);
        return [kind, gone === undefined ? byId : new SortedMap([...byId].filter(([id]) => !gone.has(id)), compareString)];
    }), compareString);
}

/**
 * Two reads alike: the same cells by their bytes — the rows they hold are
 * made from them — and the same shading, drafts and notices.
 */
function sameRead(a: Read, b: Read): boolean {
    const blobs = (x: Reads, y: Reads) => x.size === y.size && [...x].every(([slot, bytes]) => {
        const other = y.get(slot);
        return other !== undefined && blobEqual(other, bytes);
    });
    return blobs(a.reads, b.reads) && shadingEqual(a.shading, b.shading) && draftsEqual(a.drafts, b.drafts)
        && a.notices.length === b.notices.length && a.notices.every((n, i) => {
            const m = b.notices[i]!;
            return stringEqual(n.kind, m.kind) && n.events === m.events && n.resolution === m.resolution;
        });
}

/** Where the paged kind's rows in view are, as the canvas reports them to its cells' reader: a store of one span. */
export interface PlanCellSpanStore {
    /** The span last reported; `undefined` before any is. */
    get(): PlanCellSpan | undefined;
    /** Reports the rows in view: a span the store holds already moves nothing. */
    set(span: PlanCellSpan | undefined): void;
    /** Listens for a span that moves; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

/**
 * A store of the paged kind's rows in view (#1039): the canvas writes it as
 * its scroll comes to rest, and the cells' reader, a component of its own,
 * reads it — the canvas renders nothing for it.
 *
 * @returns The store
 */
export function createCellSpanStore(): PlanCellSpanStore {
    let span: PlanCellSpan | undefined;
    const listeners = new Set<() => void>();
    const same = (a: PlanCellSpan["first"], b: PlanCellSpan["first"]) => a.w === b.w && stringEqual(a.key, b.key);
    return {
        get: () => span,
        set(next) {
            if (next === span || (next !== undefined && span !== undefined && same(next.first, span.first) && same(next.last, span.last))) return;
            span = next;
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

/**
 * The paged kind's rows in view among the canvas's items: the first and the
 * last row a paged window placed, each by its window and its resource's key
 * — the last step of its path.
 *
 * @param items - The rows in view, in order: each its key and its id
 * @param origin - Which window each paged row came from
 * @returns The span; `undefined` when no paged row is in view
 */
export function cellSpanOf(
    items: readonly { readonly key: string; readonly path: readonly string[] }[], origin: ReadonlyMap<string, { readonly w: number }>,
): PlanCellSpan | undefined {
    let first: PlanCellSpan["first"] | undefined;
    let last: PlanCellSpan["first"] | undefined;
    for (const { key, path } of items) {
        const at = origin.get(key);
        const resource = path[path.length - 1];
        if (at === undefined || resource === undefined) continue;
        const here = { w: at.w, key: resource };
        first ??= here;
        last = here;
    }
    return first === undefined || last === undefined ? undefined : { first, last };
}

/**
 * Whether a Plan reads a kind by its cells or shades it past the budget: a
 * kind whose source lists a series or a summary index.
 *
 * @param parts - The event kinds narrowed through their sources
 * @returns The slots of such kinds
 */
export function cellKinds(parts: readonly PlanEventPart[]): string[] {
    return parts.filter(({ part }) => part.config.indexes.some((index) => index.series.type === "some" || index.summary.type === "some"))
        .map(({ kind }) => kind.key);
}

/**
 * The kinds' cells (see the module docs), read in the component that reads
 * the event kinds' rows: what the seams draw the kinds from, every kind's
 * drafts as they take them, and what a gesture finds an event's row in.
 * Before the first read lands, every kind it reads draws nothing yet, so no
 * seam reads it over the window meanwhile; a read in flight leaves the last
 * standing, the drafts as they are now.
 *
 * @param args - What it reads over
 * @returns What it read
 */
export function usePlanCells(args: PlanCellsArgs): PlanCellsRead {
    const [reader] = useState(() => new CellsReader());
    const { kinds, resources, parts, paged, scale, range, drafts, hidden, span, links } = args;
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    const read = useCallback(() => reader.read({
        kinds, resources, parts, paged, scale, drafts, hidden, span, links,
        range: from === undefined || to === undefined ? undefined : { from: new Date(from), to: new Date(to) },
    }), [reader, kinds, resources, parts, paged, scale, from, to, drafts, hidden, span, links]);
    const { result } = useTrackedEvaluation(read);
    const last = useRef<Read | undefined>(undefined);
    // Before the first read: every kind it reads draws nothing yet.
    const opening = useMemo((): Read => ({
        reads: new SortedMap(cellKinds(parts).map((slot): [string, Uint8Array] =>
            [slot, reader.codecOf(kinds.find((kind) => stringEqual(kind.key, slot))!).empty]), compareString),
        shading: new SortedMap([], compareString),
        drafts,
        held: new Map(),
        notices: [],
        dropped: new Map(),
    }), [reader, parts, kinds, drafts]);
    // What it hands on: the same object while the read and whether one is in flight hold.
    const handed = useRef<{ from: Read; drafts: Drafts; reading: boolean; read: PlanCellsRead } | undefined>(undefined);
    return useMemo((): PlanCellsRead => {
        if (!result.ok) console.error("[Plan] the event kinds' cells could not be read:", result.error);
        const reading = !result.ok || result.value === READING;
        if (!reading) {
            const next = result.value as Read;
            if (last.current === undefined || !sameRead(last.current, next)) last.current = next;
        }
        // While a read is in flight, the last stands in — the drafts as they are now, less those it found the narrowing does not hold.
        const from = last.current ?? opening;
        const was = handed.current;
        if (was !== undefined && was.from === from && was.reading === reading && (!reading || Object.is(was.drafts, drafts))) return was.read;
        const read: PlanCellsRead = { ...from, drafts: reading ? narrowedDrafts(drafts, from.dropped) : from.drafts, reading };
        handed.current = { from, drafts, reading, read };
        return read;
    }, [result, opening, drafts]);
}
