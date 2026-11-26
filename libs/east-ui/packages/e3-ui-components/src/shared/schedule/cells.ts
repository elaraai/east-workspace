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
 * rows, the range it reads and its buckets, the drafts and the paged rows in
 * view, and hands what it read to its own seams. Every kind is asked in the
 * same read: one whose read is in flight holds back no other's, so the kinds'
 * requests go out together (#1771).
 *
 * The paged rows are a Calendar's paged resource kind, or a Plan's own rows
 * read a page at a time (#1541): the resources a page draws — one an entry of
 * a kind, any number of a Plan's group rows — each with the slot its row lands
 * on, so one paged source serves every kind of resource its rows lay out.
 *
 * # Cells
 *
 * A kind placed on the paged resource kind, whose source of the slice lists a
 * series index of its record, reads the events of the resources in view — and,
 * where the paged rows draw an Unassigned row, of no resource — a level at a
 * time, never every event over the range. A Plan's own rows draw none (#1541),
 * so it reads no event on no resource ({@link ScheduleCellPaged.unassigned}). The series index files each event once, at the level its
 * length fits (#1433), so a cell is a block of {@link SCHEDULE_CELL_BLOCK} of
 * the paged kind's resources, in the kind's order, over one level's run of
 * tiles (`levelRuns`: from two tiles before the range read to one after it):
 * one range a resource (`levelCellQueries`), whatever the range's width. The
 * cells wanted are the blocks meeting the rows in view and
 * {@link SCHEDULE_CELL_MARGIN} resources either side, each a level, with the
 * Unassigned row's cells where one is drawn. The reader keeps what it read by block, level and
 * tile — a range's entries split by the tile each names — so a pan or a zoom
 * asks, a block a level, one range a resource over the tiles it does not hold
 * (two, when a zoom out grows the run both ways): their searches in one
 * request, which counts their entries before one is read, beside the entries
 * of the tiles held; their entries in one more. Tiles are kept while their run
 * is wanted, at the revision they were read at: a pan or a scroll within the
 * tiles held reads nothing, and a commit reads the wanted runs again, the old
 * ones standing in until they land. An event past a year, filed under each
 * year it touches, is one event, kept by its key. A window of
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
 * # In time order
 *
 * A kind's source may list a series index in time order (#1710,
 * `index.flatSeries({ …, order: "time" })`), which files a tile's events together
 * in their keys' order: a cell of it is one range a tile, from the first of
 * the block's keys through the last (`inTimeCellQueries`), so what a screen of
 * rows reads follows what the window holds, never each row's history. Its last
 * leading fields are where its keys stand: the reader fills them, block by
 * block, from the rows the block's resources nest under
 * ({@link ScheduleCellKey.under}, a Plan's group), and a block is a slot's
 * resources under one such row. Each block is read through the series index
 * led by the most of what its narrowing then chooses (`seriesIndexFor`), so a
 * source that lists an index in time order led by its rows' group reads a
 * grouped page through it, and a page of no groups through an index the
 * narrowing alone serves — one in key order listed beside it. A Plan reads no
 * event on no resource, so a source listing the index in time order alone reads
 * a grouped Plan's every block; where no listed index serves a block, the kind
 * is read as one past the cap is. A range holds the
 * entries of every key between the block's first and last, which are the
 * block's own where its rows run in their keys' order under their group; the
 * reader keeps the entries of the block's keys and drops any other's, and
 * what it counts before a read is then at least the block's, never fewer.
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
 * While the cells of the blocks meeting the rows in view hold at most
 * {@link SCHEDULE_EVENT_CAP} entries, their events draw (#1768). The margin's
 * blocks are counted with them, in the same request, and read too, in their
 * order, while what is read stays within the cap: the cap holds what the
 * screen draws, never the rows read ahead. A block of the margin left unread
 * is no block whose cells landed: scrolled to before the read that has it in
 * view lands, its rows draw as unread. Past the cap in view — or past one
 * batch of searches — and for a counted
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
 * # Rows beneath a resource
 *
 * A kind whose events land a step beneath its resources ({@link ScheduleCellKind.child},
 * a Plan kind's `child`, #1541) reads its events by its resources, and its
 * shading counts each row beneath one on its own: through a summary led by
 * the child's field and keyed by the resource (`index.summary({ on: [<child
 * field>], key: <resource field>, … })`), a search a row — its key chosen of
 * that field, under its resource's key — filed under the child's slot by the
 * row's own key. A summary of the resources alone counts every row beneath a
 * resource alike, so it shades none of them: with no summary led by the
 * child's field, the kind is read as one with no summary is — within the cap
 * its events draw on their rows, and past it those rows are hatched and the
 * kind gives the notice, which says its counts are kept by its resources
 * alone where its source keeps theirs ({@link ScheduleCellNotice.keptBy}).
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
 * ({@link ScheduleCellKind.wanted}) — is read by its key in that read. A kind
 * its host reads over the window's rows alone, every draft it is given drawing
 * where it places its event ({@link ScheduleCellKind.windowField}: the
 * Calendar's, whose backlog it pages itself, #1424), has its drafts asked of
 * the narrowing the same way — but the window's range — so a draft of an event
 * the narrowing does not hold draws nowhere, and a backlog event a gesture
 * scheduled draws where it is placed.
 *
 * # A window's rows
 *
 * A counted kind within the cap whose events are read a window at a time —
 * through its source's interval index, or a day index, one event by its key —
 * is given cells too (#1599): its window's own stored rows, which its host
 * hands the reader a read of ({@link ScheduleCellKind.stored}). The reader
 * keeps them as it keeps a kind's cells, at the revision they were read at,
 * while its record, its narrowing and the range hold — a draft's redraw asks
 * e3 nothing, nor the kind's own read — and they stand while they are read
 * again: after a Save, after another session's write, under new choices. Its
 * host's seams draw the kind from them, so a draft made meanwhile draws at
 * once, and a gesture finds its event's row among them: a Save never stops the
 * editing. A kind read whole has no such read to wait on, and is left to its
 * host as before. Which of its drafts draw is as its window's own read drew
 * them: for a kind whose window draws a draft only of an event it holds, or of
 * a new one ({@link ScheduleCellKind.isNew}, #1343) — or, while its session has
 * yet to judge its drafts where its record reads now, of one the reader last
 * drew ({@link ScheduleCellKind.carrying}, #1599) — the drafts of the other
 * events are left out, told by the rows held and the row each draft's session
 * began from — e3 asked nothing.
 *
 * # The view
 *
 * What the reader hands on is its last complete read, made for a view: its
 * host's period, and the choices each kind's source holds. How that stands to
 * what is asked now is the one rule every builder reads its rows by
 * (`../view-read.ts`): a read again of the same view leaves its host live,
 * other choices of the same period leave what stands retained, and a period
 * stepped to draws none of a windowed kind's rows of the last. A host every
 * kind's read of which is made for its period — a Plan's, whose columns'
 * period says whether a kind draws its events or its summary's shading, and
 * whose buckets that shading is folded into — draws none of any kind's of the
 * last: its seams are handed nothing, and its rows wait on the read
 * ({@link scheduleSteppedCells}).
 *
 * # What a Save landed
 *
 * A Save's confirmation reads its events by their keys, never the cells, which
 * stand at the revision they were read at until the commit's are read again —
 * a round trip a deployed server makes long. A host that draws what Saves
 * landed hands the reader them as its editing keeps them
 * ({@link ScheduleCellsArgs.landed}): over a kind's cells read before them —
 * at another revision than the one its record reads at now, the rule every
 * host that draws what a Save landed reads its rows by (east-ui-components'
 * `readBeforeSaves`) — every event they landed draws as the Save left it,
 * laid under the drafts — a draft made since draws in its place, and one the
 * narrowing did not hold draws nowhere, as before the Save — and its row is
 * held as the Save left it, where a gesture and an inspector read it; one it
 * deleted draws nowhere, and is read by its key. Once a kind's cells are read
 * at the revision its record reads at now — or none of its cells is read, the
 * kind counted, past the cap or hidden — what landed of it is let go
 * ({@link ScheduleCellsArgs.shown}), so no frame draws both. Whichever
 * revision a Save was drafted at, cells read before the record's revision now
 * are from before it: two Saves before the cells are read again each keep
 * their events, and so does a Save drafted over another session's write the
 * cells have still to read.
 *
 * # What a kind is handed
 *
 * The reader tells each kind's seams what to draw from (e3-ui's
 * `ScheduleCellReadType`, #1771): the rows it read, as the page unpacked them
 * from e3, held under a handle the seams read through `schedule_cell_rows`
 * (`cell-rows.ts`) — never bytes packed for each kind to unpack again — or,
 * for a kind it reads none of (hidden, past the cap), nothing; a kind it
 * names not reads its window. It makes a kind's rows again only when what
 * they are made from moves — the cells' entries, the rows read by key, what
 * the narrowing answered of them — and once for kinds made from the same:
 * the cases of one record read through one source over the same slots hold
 * one set of spans, and one set of rows. The events a series read's entries
 * hold are filed by their keys once, and stand while the entries do: the rows
 * in view moving within the blocks held — a wheel's step — reads the same
 * entries, and orders none of them again. A window's own rows, which its kind
 * hands the reader as bytes, are unpacked once, when they are first read. A
 * row's own bytes, which a gesture or an inspector begins from, are made when
 * one is asked for. The rows the last few reads its host drew name stand; the
 * reader lets go of the others once its host has drawn past them, keeping
 * each kind's newest for a read on its way.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    ArrayType, DateTimeType, DictType, FloatType, OptionType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, none, parseFor, printFor, some, variant,
    type EastType, type EastTypeValue, type ValueTypeOf, type option,
} from "@elaraai/east";
import {
    MAX_RECORD_SLICE_BATCH, RecordSliceChoiceType, RecordSliceWhereType, levelRuns, seriesIndexFor, summaryCellQueries, summaryRun, tileIndexFor, tilingOf,
    type RecordSliceBindType, type RecordSliceCell, type RecordSliceCellRuns, type RecordSliceEntry, type RecordSliceIndexType,
    type RecordTile, type TileRun,
} from "@elaraai/east-ui/internal";
import { SCHEDULE_EVENT_CAP, ScheduleCellReadType, ScheduleDraftsType, ScheduleResourceRefType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import {
    RecordSliceKeptCells, readBeforeSaves, recordSliceCellEntries, recordSliceCellRuns, recordSliceRevision, recordSliceRows, recordSliceWithin,
} from "@elaraai/east-ui-components/internal";
import { isPagedReadError } from "../../platform/paged-read-error.js";
import type { TimeResolution } from "../time/scale.js";
import { coarserThan } from "../time/zoom.js";
import { sameView, viewState, type ReadView, type ViewState } from "../view-read.js";
import { holdCellRows, releaseCellRows } from "./cell-rows.js";
import { DraftedStanding } from "./drafted-rows.js";
import {
    NO_UNDER, entryKey, groupQueries, keyOrderOf, keyRunOf, sameUnder, underOf, type CellGroup, type KeyOrder, type SeriesGroup,
} from "./series-groups.js";
import type { ScheduleEventDraftsValue, ScheduleKindRows, ScheduleLanded, ScheduleLandedRow, ScheduleLandedRows } from "./editing.js";

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

/** What a kind's seams draw it from (#1771): its window, the rows a reader holds of it — by their handle — or none of its events. */
export type ScheduleCellRead = ValueTypeOf<typeof ScheduleCellReadType>;

/**
 * What the reader read of each kind it gives cells, by the kind's slot: the rows it holds of the kind, as the page
 * unpacked them, by the handle its seams read them through (`schedule_cell_rows`, #1771) — or none of its events.
 */
export type ScheduleCellReads = ValueTypeOf<DictType<StringType, typeof ScheduleCellReadType>>;

/** What a kind no reader names is read from: its window, which its seams read themselves (#1771). */
export const SCHEDULE_READ_WINDOW: ScheduleCellRead = variant("window", null);

/** What a kind given cells that hold none of its events draws from: nothing — hidden, or past the cap (#1771). */
const READ_NOTHING: ScheduleCellRead = variant("nothing", null);

/** One index of a record Slice's binding. */
type Index = ValueTypeOf<typeof RecordSliceIndexType>;
/** A record Slice's narrowing. */
type Where = ReadonlyMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>;

const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
/** Whether two narrowings, as a source names them, are one — none being none (#1344). */
const sameNarrowing = (a: string | undefined, b: string | undefined): boolean => (a === undefined || b === undefined ? a === b : stringEqual(a, b));
const shadingEqual = equalFor(ShadingType);
const readEqual = equalFor(ScheduleCellReadType);
const draftsEqual = equalFor(DictType(StringType, ScheduleDraftsType));
/** The slots a kind's events land on, as East prints them: what the kinds whose series reads are shared share (#1771). */
const printSlots = printFor(ArrayType(StringType));
/** A resource among the paged rows' (#1541): its slot and key, as East prints a `Schedule.Types.ResourceRef`. */
const printResourceRef = printFor(ScheduleResourceRefType);
const printWhere = printFor(RecordSliceWhereType);

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
    /**
     * What its rows are, as its seams read them through `schedule_cell_rows` (#1771) and its window's stored rows are
     * encoded in: an Array of `{ key, row }`, at its record's key and row types.
     */
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
    /**
     * The field its host's window narrows — its events' start — for a kind narrowed through its source whose every draft
     * given draws where it places its event (#1424: the Calendar's kinds whose backlog it pages itself). The reader asks
     * the narrowing — but that field's range — of the stored rows of the kind's drafted events its window does not hold,
     * read by their keys in one read, and leaves out the drafts of those the narrowing does not hold either, as it does
     * for a kind read by its cells; a new event, which no stored row names, keeps its draft. `undefined` leaves the
     * drafts to the host's seams, or to {@link ScheduleCellKind.isNew}.
     */
    readonly windowField?: string | undefined;
    /**
     * Whether an event is a new one — its editing session began from no stored row — for a kind narrowed through its
     * source whose window's read draws a draft only of an event it holds, or of a new one (#1343): a draft of an
     * existing event the narrowing does not hold, its window among it, never leaks into it. Given beside
     * {@link ScheduleCellKind.stored}, the reader leaves out the drafts of the events its window's rows do not hold that
     * are no new ones, asking e3 nothing. `undefined` for a kind every draft of which draws where it places its event,
     * and for one no source narrows.
     */
    readonly isNew?: ((id: string) => boolean) | undefined;
    /**
     * Whether its editing session has yet to judge its drafts where its record reads now (the shared editing's
     * `carrying`, #1599), for a kind given {@link ScheduleCellKind.isNew}: what the session says of an event — that it
     * is no new one — is then of the record as it was, and a draft the reader last drew stays drawn though its window's
     * rows, read again, hold its event no more. Another session removed it: left out as one the narrowing does not
     * hold, it left its builder until the session's read of it landed. `undefined` for a kind whose session judges its
     * drafts as its record is read.
     */
    readonly carrying?: (() => boolean) | undefined;
    /**
     * Its window's own stored rows over `[from, to)`, as one beast2 of {@link ScheduleCellKind.cellsType} — each row once
     * by its key, no draft in place — or `none` while their read is in flight: its host's, for a kind read a window at a
     * time whose events are read by their keys (through its source of the slice, or a day index). Within the cap the
     * reader keeps them as it keeps a kind's cells (see the module docs, "A window's rows"). `undefined` for a kind read
     * whole, which its host reads over the range itself.
     */
    readonly stored?: ((from: Date, to: Date) => option<Uint8Array>) | undefined;
    /**
     * The revision its record reads at now, for a kind given {@link ScheduleCellKind.stored} that no source of the slice
     * narrows — one read through a day index: what its rows standing are told from, as from before a Save or holding
     * it. A kind with a source reads its source's.
     */
    readonly revision?: (() => option<string>) | undefined;
    /**
     * Where its events land a step beneath its resources — a Plan kind's `child` (#1541, U1) — each row there counted on
     * its own past the cap, or zoomed out (see the module docs, "Rows beneath a resource"): those rows' slot; the field
     * of its record holding a row's own key, which a summary counting them is led by; the key a row's shading is filed
     * under, from the resource's key and the row's own, its host's (`rowKey`); and the `.east` text the field holds for a
     * row's key (`literal`), `undefined` for one it cannot hold. `undefined` for a kind landing on its resources' own rows.
     */
    readonly child?: {
        readonly slot: string;
        readonly field: string;
        readonly rowKey: (resource: string, child: string) => string;
        readonly literal: (child: string) => string | undefined;
    } | undefined;
}

/** A row a step beneath a resource that a kind's `child` lands on (#1541, U1): its slot, and its own key's text. */
export interface ScheduleCellChild {
    /** Its slot: the series its rows are of. */
    readonly slot: string;
    /** Its own key's text: the last step of its path. */
    readonly key: string;
}

/** A resource kind read whole, as the reader hatches and shades its rows: its slot, and its resources' keys' texts in order. */
export interface ScheduleCellResources {
    /** Its slot. */
    readonly key: string;
    /** Its resources' keys' texts, in order. */
    readonly keys: readonly string[];
    /** The rows beneath each resource a kind's `child` lands on (#1541, U1), by the resource's key's text; left out for none. */
    readonly children?: ReadonlyMap<string, readonly ScheduleCellChild[]> | undefined;
}

/** One resource a paged window draws: the slot its row lands on, and its key's text. */
export interface ScheduleCellKey {
    /** The slot its row lands on: the paged resource kind's, or a Plan's resources series' (#1541). */
    readonly slot: string;
    /** Its key's text. */
    readonly key: string;
    /**
     * Where its row stands (#1710): the keys' texts of the rows it nests under, outermost first — a Plan's group. What
     * a series index in time order led by them reads its events under (see the module docs, "In time order"); left out
     * for a resource under no row.
     */
    readonly under?: readonly string[] | undefined;
    /** The rows beneath it a kind's `child` lands on that the window draws (#1541, U1), in their order; left out for none. */
    readonly children?: readonly ScheduleCellChild[] | undefined;
}

/**
 * A resource as the reader names it among those whose rows it has drawn
 * ({@link ScheduleCellsRead.drawn}): its slot and its key's text, as East prints
 * a `Schedule.Types.ResourceRef` — two slots' resources of one key are two
 * resources (#1541).
 *
 * @param slot - The slot its row lands on
 * @param key - Its key's text
 * @returns Its name among the resources drawn
 */
export function scheduleCellId(slot: string, key: string): string {
    return printResourceRef({ kind: slot, key });
}

/** The paged rows, as the reader reads the blocks of them in view (see the module docs). */
export interface ScheduleCellPaged {
    /** The slots its rows land on: the paged resource kind's, or each of a Plan's resources series and kinds cases (#1541). */
    readonly kinds: readonly string[];
    /** How many entries a window of it holds: what a row in view's window places it by. */
    readonly window: number;
    /** Whether the viewer hides it: none of its rows draws, so no cell of it is read. */
    readonly hidden: boolean;
    /**
     * Whether its layout draws an Unassigned row beside its resources' — the Calendar's paged kind does — whose events, a
     * kind's on no resource, are read as a block of their own. `false` for a Plan's own rows, which draw none over rows
     * read a page at a time (#1541): an event on no resource is in no window, so none is read (#1710).
     */
    readonly unassigned: boolean;
    /**
     * The resources its entries `[offset, offset + limit)` draw, each by its slot and its key's text, in the order its
     * rows draw them — one an entry of a resource kind's, any number of a Plan's entry whose rows nest them (#1541);
     * `none` while that window is in flight.
     */
    keys(offset: bigint, limit: bigint): option<readonly ScheduleCellKey[]>;
    /** How many entries it has — its narrowing holds, when its source narrows it — once known. */
    total(): option<bigint>;
    /** The narrowing its windows belong to, as its source names it (#1344); `undefined` for rows no source narrows. */
    narrowing(): string | undefined;
}

/** A row in view at an end of a run of them: its window, and its key's text. */
export interface ScheduleCellEnd {
    /** Its window. */
    readonly w: number;
    /** Its key's text. */
    readonly key: string;
}

/** A run of the paged rows in view, in their windows' order: its first row and its last. */
export interface ScheduleCellRun {
    /** Its first row. */
    readonly first: ScheduleCellEnd;
    /** Its last row. */
    readonly last: ScheduleCellEnd;
}

/**
 * The paged kind's rows in view, as its host reports them: the runs of them,
 * each its first and its last row by its window and its key's text, and the
 * narrowing they were drawn under. One run, but where the rows in view go from
 * one series of the rows on into another over the same windows — a Plan's
 * rows beside a group at its top, each paging the same entries (#1710): a run
 * each, in the view's order.
 */
export interface ScheduleCellSpan {
    /** The runs of rows in view, in the view's order: at least one. */
    readonly runs: readonly ScheduleCellRun[];
    /**
     * The narrowing the rows were drawn under, as the kind's source names it
     * (#1344): their windows are its. `undefined` for a kind its source does
     * not narrow.
     */
    readonly narrowing: string | undefined;
}

/**
 * The span of the paged rows in view, from the rows themselves (#1710): each
 * row that stands for a resource by its window and its key's text, in the
 * view's order. The rows of one series run in their windows' order; a row of a
 * window before the last row's is the next series of the rows over the same
 * windows — a Plan's rows beside a group at its top — and starts a run of its
 * own.
 *
 * @param rows - The rows in view that stand for a resource, in the view's order
 * @param narrowing - The narrowing they were drawn under, as the kind's source names it (#1344)
 * @returns The span; `undefined` for no row
 */
export function scheduleCellSpanOf(rows: Iterable<ScheduleCellEnd>, narrowing: string | undefined): ScheduleCellSpan | undefined {
    const runs: { first: ScheduleCellEnd; last: ScheduleCellEnd }[] = [];
    for (const here of rows) {
        const run = runs[runs.length - 1];
        if (run === undefined || here.w < run.last.w) runs.push({ first: here, last: here });
        else run.last = here;
    }
    return runs.length === 0 ? undefined : { runs, narrowing };
}

/**
 * Whether two spans are the same rows in view: the same runs, each the same
 * rows at its ends, under the same narrowing (#1344) — what a host reports
 * again moves no read.
 *
 * @param a - One span
 * @param b - The other
 * @returns Whether they are the same rows in view
 */
export function sameCellSpan(a: ScheduleCellSpan, b: ScheduleCellSpan): boolean {
    const sameEnd = (x: ScheduleCellEnd, y: ScheduleCellEnd) => x.w === y.w && stringEqual(x.key, y.key);
    return a.runs.length === b.runs.length && a.runs.every((run, i) => sameEnd(run.first, b.runs[i]!.first) && sameEnd(run.last, b.runs[i]!.last))
        && sameNarrowing(a.narrowing, b.narrowing);
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
    /**
     * The period a read is made for, as text: a read for another is a step (`../view-read.ts`). A host whose rows are a
     * period's — the Calendar's day, week or month — names its range, and none of a windowed kind's rows of the last
     * draws under the next. A host whose range is a window panned over its rows — the Plan's — names its columns'
     * period: what the last range held stands while the next is read, and under another period of its columns it draws
     * none of any kind's ({@link scheduleSteppedCells}). Left out, every read is of one period.
     */
    readonly period?: string | undefined;
    /** The range cut into the host's buckets, in order: what a summary's shading is folded into. */
    readonly buckets: readonly ScheduleCellBucket[] | undefined;
    /** The host's resolution, which a summary's tile must divide; `undefined` on an axis of no time. */
    readonly resolution: TimeResolution | undefined;
    /**
     * Whether a kind read by its cells shades from its summary at a resolution coarser than its series index's tile,
     * reading none of its events (#1706): a Plan's zoom, a month past a week's tile. Left out, a kind shades only past
     * the cap — a Calendar's period draws its events however long.
     */
    readonly zoomShades?: boolean | undefined;
    /** Every kind's drafts — the same object while they hold. */
    readonly drafts: ScheduleEventDraftsValue;
    /** The paged kind's rows in view, as the host last reported them; `undefined` before it has. */
    readonly span: ScheduleCellSpan | undefined;
    /**
     * What confirmed Saves landed of the kinds read by their cells, as the host's editing hands them on (its `landed`):
     * drawn over a kind's cells read before the commit until they are read again (see the module docs); `undefined` for
     * a host that draws none.
     */
    readonly landed?: ScheduleLanded | undefined;
    /**
     * Lets go of what Saves landed of a kind once its cells are read since them, or none of them is read (its editing's
     * `shown`).
     */
    readonly shown?: ((kind: string, ids: Iterable<string>) => void) | undefined;
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
    /**
     * For a kind whose events land a step beneath its resources (#1541, U1), whose source keeps summaries of those
     * resources and none led by its child's field: the slots of its resources and of the rows beneath them — its counts
     * kept by its resources alone, which shade none of the rows beneath them. Left out otherwise.
     */
    readonly keptBy?: { readonly resources: string; readonly rows: string } | undefined;
}

/** The rows a kind's cells hold, by the event's key's text: each its row as the page unpacked it, its bytes made when asked for (#1771). */
type HeldRows = ScheduleKindRows;

/**
 * A read of the event kinds that failed: why, and the kinds whose own read
 * threw — a kind's window, its count over the range, what its narrowing holds
 * of its drafts, or its cells over the paged kind's blocks (#1599, #1710) — or
 * the paged kind's own rows. A read that threw is no read in flight, and
 * nothing waits on it: the rows whose cells it could not read draw no
 * "loading" for it. Its host says a kind's failure as its period's read
 * failed, with Retry; the paged kind's own rows' failure its paging says
 * where those rows are ({@link ScheduleCellsFailure.rows}).
 */
export interface ScheduleCellsFailure {
    /** Why it failed, in the read's own words. */
    readonly reason: string;
    /** The slots of the kinds whose own read threw, in the kinds' order; none where the failure was no one kind's. */
    readonly kinds: readonly string[];
    /**
     * Whether it was the paged kind's own rows that could not be read — their count, a window, as its paging runtime
     * says (`isPagedReadError`): which its host's paging says where those rows are, never as its period's. Every other
     * failure, a kind's cells among them, nothing else says: its host says it.
     */
    readonly rows: boolean;
}

/** What the reader read: what its host's seams draw the kinds from, and what a gesture finds an event's row in. */
export interface ScheduleCellsRead {
    /**
     * What it read of each kind it gives cells, by the kind's slot (#1771): a kind read by its cells, or by its window's
     * own rows, the rows it holds, by their handle; one past the cap, or hidden, none of its events. A kind it names not
     * is read over the range by its host ({@link SCHEDULE_READ_WINDOW}) — a counted kind only once its count there is
     * within the cap ({@link scheduleWithinCap}).
     */
    readonly reads: ScheduleCellReads;
    /** The resources' shading. */
    readonly shading: ScheduleCellShading;
    /**
     * Every kind's drafts as the seams take them: a kind read by its cells, or by its host over the window's rows alone
     * ({@link ScheduleCellKind.windowField}), those of events its narrowing does not hold left out; over a kind's cells
     * read before a Save of it, what the Save landed laid under them (see the module docs).
     */
    readonly drafts: ScheduleEventDraftsValue;
    /**
     * Each kind it gives cells, by its slot: the rows they hold, by the event's key's text — where a gesture finds an
     * event's row, one it does not hold read by its key; none for a kind given none, whose range is never read. Over
     * cells read before a Save of the kind, each event it landed as the Save left it, one it deleted read by its key.
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
     * for wait on it ({@link ScheduleCellsRead.drawn}); `false` where no kind is read so, whose reads nothing waits on,
     * and while a read has thrown, which is in flight no more.
     */
    readonly reading: boolean;
    /**
     * The paged rows' resources whose rows draw what is known of them (#1398, CL2), each by {@link scheduleCellId} — its
     * slot and its key, so two slots' resources of one key are apart (#1541): those whose cells the last read
     * landed for — while a read over another range is in flight, less those it reads again, whose cells there never
     * landed; a read over the same range — a commit, another narrowing — leaves its cells standing in. Any other
     * resource's rows are unread and draw the region wash under what they hold, never an empty row, and a host's
     * figures of such a resource — an inspector's row facts — are placeholders until its cells land, never 0.
     * `undefined` where no kind is read by its cells over a paged kind.
     */
    readonly drawn: ReadonlySet<string> | undefined;
    /**
     * The kinds whose cells are their window's own rows (see the module docs, "A window's rows"), by their slots: what
     * it holds of each is of the range it was read over alone, so a host whose range is a period draws none of it under
     * another ({@link ScheduleCellsRead.view}).
     */
    readonly windowed: ReadonlySet<string>;
    /**
     * How what it hands on stands to what its host asks now (`../view-read.ts`, the one rule every builder reads its
     * rows by): its last complete read's period and choices beside those asked, and whether a read is on its way.
     */
    readonly view: ViewState;
    /** Why its latest read failed, and the kinds whose own read threw; `undefined` while it reads, or has read. */
    readonly error: ScheduleCellsFailure | undefined;
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

/**
 * Which of the blocks a read wants it reads, by how many entries each block's
 * cells hold (#1768): every block meeting the rows in view, while together
 * they hold at most {@link SCHEDULE_EVENT_CAP} entries, and each of the
 * margin's, in their order, while what is read stays within it — the cap holds
 * what the screen draws, never the rows read ahead. A block of the margin past
 * it is left unread, and one after it that fits is read.
 *
 * @param blocks - Each block wanted, in order: whether only the margin wants it, and how many entries its cells hold
 * @returns Whether each is read, in order; `undefined` where the blocks in view alone hold more than the cap
 */
export function scheduleCellsWithinCap(blocks: readonly { readonly margin: boolean; readonly count: number }[]): boolean[] | undefined {
    let held = 0;
    for (const block of blocks) if (!block.margin) held += block.count;
    if (held > SCHEDULE_EVENT_CAP) return undefined;
    return blocks.map((block) => {
        if (!block.margin) return true;
        if (held + block.count > SCHEDULE_EVENT_CAP) return false;
        held += block.count;
        return true;
    });
}

/** A window of the paged rows whose read failed: its host says so where its rows would be, with Retry. */
export const SCHEDULE_WINDOW_FAILED = "failed";

/**
 * One window of the paged rows, as the reader reads it (see the module docs):
 * the resources it draws, in order; `undefined` while it is in flight;
 * {@link SCHEDULE_WINDOW_FAILED} for a window whose read failed — the paging
 * runtime throws a `PagedReadError` for it (`isPagedReadError`). Anything else
 * a read of it throws is no read that failed, and is thrown on.
 *
 * @param paged - The paged rows
 * @param w - The window, by its place among theirs
 * @returns Its resources; `undefined` in flight; {@link SCHEDULE_WINDOW_FAILED} for a read that failed
 * @throws Whatever else reading the window throws
 */
export function scheduleWindowKeys(paged: ScheduleCellPaged, w: number): readonly ScheduleCellKey[] | undefined | typeof SCHEDULE_WINDOW_FAILED {
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

/** A block of resources and their keys' texts: what a cell holds of them. */
export interface ScheduleCellBlock {
    /** Where the block's rows draw: the slot their rows land on. */
    readonly slot: string;
    /**
     * Its place among its slot's blocks: of resources read whole, its place in their order; of the paged rows, its window
     * and its place in that window (`w.j`), so a block is the same block however the view moves — and, of a place whose
     * resources of the slot stand under more rows than one, which of those it is after the first (`w.j.n`, #1710).
     */
    readonly id: string;
    /** Its resources' keys' texts, in order. */
    readonly keys: readonly string[];
    /** Where its resources stand (#1710): the keys' texts of the rows they nest under, outermost first; left out under no row. */
    readonly under?: readonly string[] | undefined;
    /**
     * Whether only the margin wants it (#1768): none of its resources is in view. The cap holds the blocks in view, and
     * such a block is read while what is read stays within it ({@link scheduleCellsWithinCap}); left out for one in view.
     */
    readonly margin?: boolean | undefined;
    /** The rows beneath each of its resources a kind's `child` lands on (#1541, U1), by the resource's key's text; left out for none. */
    readonly children?: ReadonlyMap<string, readonly ScheduleCellChild[]> | undefined;
}

/**
 * The paged rows' blocks a view wants, each its resources' keys: those meeting the rows in view and
 * {@link SCHEDULE_CELL_MARGIN} resources either side, in their windows' order — a block only the margin wants, none of
 * its resources in view, marked so (`margin`, #1768).
 *
 * A block is a window's own (#1541): its resources `[j × BLOCK, (j + 1) × BLOCK)` in the order the window draws
 * them, a block a slot their rows land on — as many as the window draws, one an entry of a resource kind's, any
 * number of a Plan's group rows — and, where they nest under rows, a block a row they stand under (#1710), so a
 * block's resources are one group's. A window whose read failed gives no block: its host says so where its rows
 * would be, with its Retry, and no cell of it is read until a Retry lands it.
 *
 * An end of the rows in view whose key its window does not hold — a row the window draws no more, or one that stands
 * for no resource — is read as the other end, and with neither held the view is read where the first end's window
 * opens, at its first resource (#1711). An end is never placed at its window's start for want of a place: the blocks
 * from there down to the view are none of the view's.
 *
 * Rows in view that run from one series of the rows on into another over the same windows — rows beside a group at a
 * Plan's top (#1710) — are a run each: each run's blocks are wanted, a window two runs meet in wanting the blocks
 * around each, and never the windows between one run's and another's.
 *
 * @param paged - The paged rows
 * @param span - The rows in view, as the host last reported them — a run of them, or several; `undefined` before it has: the first resource, where a view opens
 * @returns The blocks; `undefined` while a window of them is in flight, and while the rows in view are another
 *   narrowing's than the one the windows read now (#1344) — a choice's rows still to land and be reported, whose places
 *   the last narrowing's windows do not hold
 */
export function schedulePagedBlocks(paged: ScheduleCellPaged, span: ScheduleCellSpan | undefined): ScheduleCellBlock[] | undefined {
    const narrowing = paged.narrowing();
    if (span !== undefined && !sameNarrowing(span.narrowing, narrowing)) return undefined;
    const total = paged.total();
    const windows = total.type === "some" ? Math.ceil(Number(total.value) / paged.window) : undefined;
    const read = new Map<number, readonly ScheduleCellKey[]>();
    // A window's resources, read once; `undefined` while it is in flight, none of a window past the last or failed.
    const keysOf = (w: number): readonly ScheduleCellKey[] | undefined => {
        if (w < 0 || (windows !== undefined && w >= windows)) return [];
        const held = read.get(w);
        if (held !== undefined) return held;
        const keys = scheduleWindowKeys(paged, w);
        if (keys === undefined) return undefined;
        const out = keys === SCHEDULE_WINDOW_FAILED ? [] : keys;
        read.set(w, out);
        return out;
    };
    // Each end of the rows in view, by its window and its place there: `null` for a key its window does not hold.
    // Before any is reported, the first resource, where a view opens.
    const placeOf = (end: ScheduleCellEnd | undefined): { readonly w: number; readonly at: number } | null | undefined => {
        if (end === undefined) return { w: 0, at: 0 };
        const keys = keysOf(end.w);
        if (keys === undefined) return undefined;
        const at = keys.findIndex((k) => stringEqual(k.key, end.key));
        return at < 0 ? null : { w: end.w, at };
    };
    // Each window's wanted blocks: those meeting its places a run wants. A window two runs meet in wants the blocks
    // around each, never those between them; a place past its window's resources wants none.
    const wanted = new Map<number, Set<number>>();
    const want = (w: number, keys: readonly ScheduleCellKey[], lo: number, hi: number): void => {
        let held = wanted.get(w);
        if (held === undefined) wanted.set(w, (held = new Set()));
        const end = Math.min(keys.length - 1, hi);
        for (let j = Math.floor(Math.max(0, lo) / SCHEDULE_CELL_BLOCK); j * SCHEDULE_CELL_BLOCK <= end; j++) held.add(j);
    };
    // Each window's blocks meeting the rows in view, the margin aside (#1768): what the cap holds.
    const seen = new Map<number, Set<number>>();
    const see = (w: number, lo: number, hi: number): void => {
        let held = seen.get(w);
        if (held === undefined) seen.set(w, (held = new Set()));
        for (let j = Math.floor(Math.max(0, lo) / SCHEDULE_CELL_BLOCK); j * SCHEDULE_CELL_BLOCK <= hi; j++) held.add(j);
    };
    // Each run of the rows in view (#1710) — or, before any is reported, where a view opens — from its first row less the
    // margin to its last plus it.
    for (const run of span?.runs ?? [undefined]) {
        const firstAt = placeOf(run?.first);
        const lastAt = placeOf(run?.last);
        if (firstAt === undefined || lastAt === undefined) return undefined;
        // An end its window does not hold is read as the other; with neither, where the first end's window opens.
        const one = firstAt ?? lastAt ?? { w: run?.first.w ?? 0, at: 0 };
        const other = lastAt ?? one;
        // Its ends in their windows' order, whichever its host named first.
        const [first, last] = other.w < one.w || (other.w === one.w && other.at < one.at) ? [other, one] : [one, other];
        for (let w = first.w; w <= last.w; w++) {
            const keys = keysOf(w);
            if (keys === undefined) return undefined;
            want(w, keys, w === first.w ? first.at - SCHEDULE_CELL_MARGIN : 0, w === last.w ? last.at + SCHEDULE_CELL_MARGIN : keys.length - 1);
            see(w, w === first.w ? first.at : 0, w === last.w ? last.at : keys.length - 1);
        }
        // The margin spills into the window before the first, and after the last, as far as it reaches.
        if (first.at - SCHEDULE_CELL_MARGIN < 0 && first.w > 0) {
            const before = keysOf(first.w - 1);
            if (before === undefined) return undefined;
            want(first.w - 1, before, before.length + first.at - SCHEDULE_CELL_MARGIN, before.length - 1);
        }
        const lastKeys = keysOf(last.w);
        if (lastKeys === undefined) return undefined;
        if (last.at + SCHEDULE_CELL_MARGIN >= lastKeys.length) {
            const after = keysOf(last.w + 1);
            if (after === undefined) return undefined;
            want(last.w + 1, after, 0, last.at + SCHEDULE_CELL_MARGIN - lastKeys.length);
        }
    }
    const blocks: ScheduleCellBlock[] = [];
    for (const w of [...wanted.keys()].sort((a, b) => a - b)) {
        const keys = keysOf(w)!;
        for (const j of [...wanted.get(w)!].sort((a, b) => a - b)) {
            // Only the margin wants it (#1768): none of its resources is in view.
            const margin = seen.get(w)?.has(j) !== true;
            // A block a slot its resources' rows land on, under the rows they stand under (#1710), in the order the
            // window draws them — each with the rows beneath it a kind's `child` lands on (#1541, U1).
            const runs: { slot: string; under: readonly string[]; keys: string[]; children: Map<string, readonly ScheduleCellChild[]> }[] = [];
            for (const k of keys.slice(j * SCHEDULE_CELL_BLOCK, (j + 1) * SCHEDULE_CELL_BLOCK)) {
                const under = k.under ?? NO_UNDER;
                let run = runs.find((one) => stringEqual(one.slot, k.slot) && sameUnder(one.under, under));
                if (run === undefined) runs.push(run = { slot: k.slot, under, keys: [k.key], children: new Map() });
                else run.keys.push(k.key);
                if (k.children !== undefined) run.children.set(k.key, [...(run.children.get(k.key) ?? []), ...k.children]);
            }
            // A slot's first block of a place is named by the place; each further one, under another row, by which it is.
            const placed = new Map<string, number>();
            for (const run of runs) {
                const n = placed.get(run.slot) ?? 0;
                placed.set(run.slot, n + 1);
                blocks.push({
                    slot: run.slot, id: n === 0 ? `${w}.${j}` : `${w}.${j}.${n}`, keys: run.keys, ...(run.under.length > 0 && { under: run.under }),
                    ...(margin && { margin: true }), ...(run.children.size > 0 && { children: run.children }),
                });
            }
        }
    }
    return blocks;
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
 * resources whose cells it holds — `undefined` where no kind reads its cells over a paged kind — the range it was made
 * over, `undefined` before the first, and the revision each kind read by its cells was read at, by its slot.
 */
type Read = Omit<ScheduleCellsRead, "reading" | "drawn" | "view" | "error"> & {
    readonly dropped: ReadonlyMap<string, ReadonlySet<string>>;
    readonly covered: ReadonlySet<string> | undefined;
    readonly range: ScheduleCellRange | undefined;
    readonly revisions: ReadonlyMap<string, string>;
    /** The view it was made for: its host's period, and each kind's source's choices. */
    readonly made: ReadView;
};

/** No resource: what a reader that has read no block of the paged kind's wants. */
const NO_RESOURCES: ReadonlySet<string> = new Set();
/** No kind past the cap. */
const NONE_CAPPED: ReadonlySet<string> = new Set();
/** No rows: what a kind given no cells holds — a gesture reads one of its events by its key, never over the range. */
const NO_ROWS: HeldRows = { has: () => false, get: () => undefined, value: () => undefined, ids: () => [], rows: () => [] };
/** How many of the reads its host last drew the reader keeps the rows of (#1771): what a read still on its way draws from. */
const HANDED_KEPT = 3;
/** No drafted event left out. */
const NO_IDS: ReadonlySet<string> = new Set();
/** No kind read by its cells: no revision any was read at. */
const NO_REVISIONS: ReadonlyMap<string, string> = new Map();
/** No kind whose cells stand from before a Save of it: nothing laid. */
const NOTHING_LAID: ReadonlyMap<string, ScheduleLandedRows> = new Map();
/** No kind whose cells are its window's rows. */
const NONE_WINDOWED: ReadonlySet<string> = new Set();
/** No view asked yet: before a reader's first read. */
const NO_VIEW: ReadView = { period: "", choices: "" };

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

/** One kind's read: by its cells, at the revision they were read at. */
type KindRead =
    | {
        /** The handle its rows are held under (#1771), and the rows by the event's key's text. */
        readonly mode: "cells"; readonly handle: string; readonly held: HeldRows; readonly dropped: ReadonlySet<string>; readonly revision: string;
        /** Whether they are a series index's cells over the paged kind's blocks; `false` for its window's own rows. */
        readonly paged: boolean;
        /** The resources of the margin's blocks left unread beneath the cap (#1768), by {@link scheduleCellId}: their rows wait on a read. */
        readonly unread: ReadonlySet<string>;
    }
    | { readonly mode: "shade"; readonly notice: ScheduleCellNotice | undefined; readonly paged: boolean }
    | { readonly mode: "window" };

/** A kind's types, as its rows are read: their keys ordered and named, its window's stored rows unpacked, a row packed alone. */
interface KindCodec {
    readonly compareKey: (a: unknown, b: unknown) => number;
    readonly idOf: (key: unknown) => string;
    readonly keyOf: (id: string) => unknown;
    readonly decodeCells: (bytes: Uint8Array) => { key: unknown; row: unknown }[];
    readonly encodeRow: (row: unknown) => Uint8Array;
}

/** One entry of a kind's rows: its key, and its row — or the copy its index holds of it — as the kind's seams read it. */
interface CellEntry {
    readonly key: unknown;
    readonly row: unknown;
}

/**
 * The rows a reader holds of a kind (#1771): its entries as the page unpacked them — its cells', or its window's stored
 * rows, unpacked once (see the module docs, "A window's rows") — by the event's key's text, filed when first asked for,
 * and each row's bytes made when it is: a gesture or an inspector asks for one, and nothing else packs a row.
 */
class CellRows implements ScheduleKindRows {
    private byId: Map<string, unknown> | undefined;
    private readonly encoded = new Map<string, { readonly row: Uint8Array }>();

    /**
     * @param codec - The kind's codec
     * @param entries - Its entries, made when first read: the Array its seams read through `schedule_cell_rows`
     */
    constructor(private readonly codec: KindCodec, private readonly entries: () => readonly CellEntry[]) {}

    /** The rows by the event's key's text, filed once. */
    private filed(): Map<string, unknown> {
        if (this.byId === undefined) {
            this.byId = new Map();
            for (const entry of this.entries()) this.byId.set(this.codec.idOf(entry.key), entry.row);
        }
        return this.byId;
    }

    has(id: string): boolean {
        return this.filed().has(id);
    }

    get(id: string): { readonly row: Uint8Array } | undefined {
        const made = this.encoded.get(id);
        if (made !== undefined) return made;
        const rows = this.filed();
        if (!rows.has(id)) return undefined;
        const row = { row: this.codec.encodeRow(rows.get(id)) };
        this.encoded.set(id, row);
        return row;
    }

    value(id: string): unknown {
        return this.filed().get(id);
    }

    ids(): Iterable<string> {
        return this.filed().keys();
    }

    rows(): Iterable<readonly [string, unknown]> {
        return this.filed().entries();
    }
}

/** A kind's rows as the reader last made them (#1771): what they were made from, the handle they are held under, and the rows by key. */
interface Generation {
    readonly from: readonly unknown[];
    readonly handle: string;
    readonly held: HeldRows;
}

/** A kind's rows with what Saves landed laid over them: each landed event's row as its Save left it, one it deleted gone. */
class LaidRows implements ScheduleKindRows {
    /**
     * @param under - The rows the kind's cells hold
     * @param landed - What Saves landed of the kind, by the event's key's text
     */
    constructor(private readonly under: ScheduleKindRows, private readonly landed: ReadonlyMap<string, ScheduleLandedRow>) {}

    has(id: string): boolean {
        const laid = this.landed.get(id);
        return laid === undefined ? this.under.has(id) : laid.row !== undefined;
    }

    get(id: string): { readonly row: Uint8Array } | undefined {
        const laid = this.landed.get(id);
        if (laid === undefined) return this.under.get(id);
        return laid.row === undefined ? undefined : { row: laid.row };
    }

    value(id: string): unknown {
        const laid = this.landed.get(id);
        return laid === undefined ? this.under.value(id) : laid.value;
    }

    *ids(): Iterable<string> {
        for (const id of this.under.ids()) if (!this.landed.has(id)) yield id;
        for (const [id, laid] of this.landed) if (laid.row !== undefined) yield id;
    }

    *rows(): Iterable<readonly [string, unknown]> {
        for (const entry of this.under.rows()) if (!this.landed.has(entry[0])) yield entry;
        for (const [id, laid] of this.landed) if (laid.row !== undefined) yield [id, laid.value];
    }
}

/** What a read threw, kept, its message the thrown one's: what the reader's failures are. */
class ReadFailure extends Error {
    /**
     * @param thrown - What the read threw
     * @param name - The failure's name
     */
    constructor(readonly thrown: unknown, name: string) {
        super(thrown instanceof Error ? thrown.message : String(thrown));
        this.name = name;
    }
}

/** What a read of one kind threw, and the kind: what a failed read names the kinds it could not read by. */
class KindReadFailure extends ReadFailure {
    /**
     * @param thrown - What the kind's read threw
     * @param kind - The kind's slot
     */
    constructor(thrown: unknown, readonly kind: string) {
        super(thrown, "KindReadFailure");
    }
}

/** What reading the paged kind's own rows threw, as its paging runtime says a read failed: no one kind's failure (#1710). */
class PagedRowsFailure extends ReadFailure {
    /** @param thrown - What reading the rows threw: a `PagedReadError` */
    constructor(thrown: unknown) {
        super(thrown, "PagedRowsFailure");
    }
}

/** A narrowing without its range of the field an index's tiles cover: the tiles hold the range. */
function withoutTiled(where: Where, from: string): Map<string, ValueTypeOf<typeof RecordSliceChoiceType>> {
    return new Map([...where].filter(([field, choice]) => !(stringEqual(field, from) && choice.type === "range")));
}

/** The fields of a narrowing an index's cells do not answer: all but its leading fields, and a range of its start. */
function residualOf(index: Index, where: Where): string[] {
    const tiling = tilingOf(index)!;
    // An index's fields are its leading fields alone, its key's `on` (#1432).
    const leading = index.fields;
    return [...where].filter(([field, choice]) => !leading.some((l) => stringEqual(l, field)) && !(stringEqual(field, tiling.from) && choice.type === "range"))
        .map(([field]) => field);
}

/**
 * A group's tiles of one level a reader holds (#1433): contiguous, from `from`
 * to `to`, half-open, each tile's entries by its start — a tile no entry is
 * filed under holds none — and the entries of them all, in the tiles' order.
 */
interface Span {
    /** What its searches were made from: the group's keys and the narrowing's choices of the index's leading fields. */
    readonly identity: string;
    readonly from: number;
    readonly to: number;
    readonly byTile: ReadonlyMap<number, readonly RecordSliceEntry[]>;
    readonly entries: readonly RecordSliceEntry[];
}

/** The spans a series read holds, by the index read through: each group's a level, at the revision they were read at. */
type SpansByIndex = Map<string, { revision: string; spans: ReadonlyMap<string, Span> }>;

/** One group's run of one level a series read wants (#1433): the span of it held, and a cell for each part of it not held. */
interface SeriesWant {
    /** The span's name among a kind's: the group's, and the level's. */
    readonly key: string;
    /** What its searches were made from: the group's keys and the narrowing's choices of the index's leading fields. */
    readonly identity: string;
    readonly from: number;
    readonly to: number;
    /** The span of it held, at the revision counted; `undefined` for none. */
    readonly held: Span | undefined;
    /** A cell for each part of it not held. */
    readonly cells: readonly RecordSliceCell[];
    readonly group: SeriesGroup;
    /** The group's place among those counted. */
    readonly at: number;
}

/**
 * A series index's cells counted (#1433, #1768): each group's run of each level wanted, at the revision counted, and
 * how many entries each group's runs hold — of the tiles held, and of the parts not held — in the groups' order.
 */
interface SeriesCounted {
    readonly revision: string;
    readonly wanted: readonly SeriesWant[];
    readonly counts: readonly number[];
}

/** A series read's entries (#1433): each group's entries a level, of the groups read, at the revision they were read at. */
type SeriesEntries = { readonly entries: readonly (readonly RecordSliceEntry[])[]; readonly revision: string };

const printChoice = printFor(RecordSliceChoiceType);

/** The start of the tile an index entry names: a series' or a summary's, its key's `tile`. */
const tileOf = (entry: RecordSliceEntry): number => (entry.ik.value as { readonly tile: Date }).tile.getTime();

/** Whether a slot is one the paged rows land on. */
function pagedSlot(paged: ScheduleCellPaged | undefined, slot: string): boolean {
    return paged !== undefined && paged.kinds.some((kind) => stringEqual(kind, slot));
}

/** Whether a kind is read by its cells: placed on the paged rows, its source listing a series index of its record. */
function readByCells(kind: ScheduleCellKind, paged: ScheduleCellPaged | undefined): boolean {
    return paged !== undefined && kind.part !== undefined && kind.takes.some((slot) => pagedSlot(paged, slot))
        && kind.part.config.indexes.some((index) => index.series.type === "some");
}

/** A reader no builder holds any more lets go of the rows of every handle it made (#1771). */
const readersGone = new FinalizationRegistry<Set<string>>((made) => releaseCellRows(made));

/**
 * Test-only probe of a reader filing a series read's events by their keys —
 * lets "the rows in view moving within the blocks held files none of them
 * again" be asserted. `undefined` outside tests.
 */
let filedProbe: (() => void) | undefined;
/** Install (or clear) the test probe of a reader filing a series read's events. Test use only. */
export function setScheduleCellsFiledProbe(fn: (() => void) | undefined): void {
    filedProbe = fn;
}

/**
 * The reader's state across reads: the cells it holds, each kind's codec and
 * the series keys it has asked its kinds for.
 */
class CellsReader {
    /** The cells each kind's summary read holds, by the kind's slot and index: their entries by their searches' text, at a revision. */
    private readonly kept = new RecordSliceKeptCells();
    /**
     * The tiles the series reads hold (#1433), by the source the kinds read through and the slots their events land on —
     * the cases of one record read over the same blocks hold one set (#1771) — then by the index.
     */
    private readonly spans = new Map<string, Map<string, SpansByIndex>>();
    private readonly codecs = new WeakMap<object, KindCodec>();
    /** How a series index in time order orders the keys it files by (#1710), by a kind's cells' type and the field: made once each. */
    private readonly orders = new WeakMap<object, Map<string, KeyOrder>>();
    private readonly literals = new WeakMap<object, Map<string, string | undefined>>();
    private readonly unassigned = new WeakMap<object, { literal: string | undefined }>();
    /**
     * The events a series read's entries hold, each once by its key, as last filed — by the spans the kinds read through
     * one source over the same slots share (#1771), the cases of one record, whose keys are one type's: a read made from
     * the same entries, the next kind's or the next read's, files none of them again (east-workspace#1776). Never
     * changed once filed.
     */
    private readonly filed = new WeakMap<SpansByIndex, { readonly from: readonly (readonly RecordSliceEntry[])[]; readonly rows: SortedMap<unknown, unknown> }>();
    /** Each kind's rows as it last made them, by its slot (#1771): a read again made from the same makes nothing. */
    private readonly generations = new Map<string, Generation>();
    /** Every handle it holds rows under, made and not yet let go (#1771). */
    private readonly made = new Set<string>();
    /** What the reads its host last drew each kind from, the latest last (#1771): the rows they name stand. */
    private handed: ScheduleCellReads[] = [];
    /** The paged rows' resources whose blocks the latest read wants — landed or in flight — by {@link scheduleCellId}, the same set while they hold. */
    private wantedKeys: ReadonlySet<string> = NO_RESOURCES;
    /** The revision each kind read by its cells reads at now, as the latest read found it, by its slot — the same map while it says the same. */
    private nowAt: ReadonlyMap<string, string> = NO_REVISIONS;
    /**
     * The rows each kind's window read holds (see the module docs, "A window's rows"), by the kind's slot: kept while its
     * record's revision, its narrowing and the range — what they are named by, `at` — hold.
     */
    private readonly windows = new Map<string, { readonly at: string; readonly handle: string; readonly held: HeldRows }>();
    /** The view the latest read was asked for, in flight or not — the same object while it says the same. */
    private askedView: ReadView = NO_VIEW;
    /**
     * Which drafts a kind given {@link ScheduleCellKind.isNew} draws, and those its last read drew: what stands through
     * a carry-over (`drafted-rows.ts`).
     */
    private readonly standing = new DraftedStanding();

    constructor() {
        // Its builder gone, every handle it made is let go of.
        readersGone.register(this, this.made);
    }

    /**
     * Lets go of the rows no read its host may still draw from names (#1771): those of the latest {@link HANDED_KEPT}
     * reads its host drew stand, and so do the newest it made of each kind, for a read on its way.
     *
     * @param reads - What the read its host has just drawn draws each kind from
     */
    letGo(reads: ScheduleCellReads): void {
        if (!Object.is(this.handed[this.handed.length - 1], reads)) {
            this.handed.push(reads);
            if (this.handed.length > HANDED_KEPT) this.handed.shift();
        }
        const kept = new Set<string>();
        for (const one of this.handed) for (const [, read] of one) if (read.type === "rows") kept.add(read.value);
        for (const made of this.generations.values()) kept.add(made.handle);
        for (const window of this.windows.values()) kept.add(window.handle);
        const gone = [...this.made].filter((handle) => !kept.has(handle));
        for (const handle of gone) this.made.delete(handle);
        releaseCellRows(gone);
    }

    /** The paged rows' resources whose blocks the latest read wants (#1398), by {@link scheduleCellId}: while it is in flight, the rows it reads again. */
    wanted(): ReadonlySet<string> {
        return this.wantedKeys;
    }

    /**
     * The revision each kind read by its cells reads at now, by its slot, whatever of the latest read is in flight — none
     * for a kind whose record names none yet: cells standing from a read at another revision are from before it.
     */
    current(): ReadonlyMap<string, string> {
        return this.nowAt;
    }

    /** The view the latest read was asked for, whatever of it is in flight: its host's period, and each kind's source's choices. */
    asked(): ReadView {
        return this.askedView;
    }

    /** The revision a kind's record reads at now: its source's, else its host's say of it; `none` while it is not known. */
    private revisionOf(kind: ScheduleCellKind): option<string> {
        if (kind.part !== undefined) return recordSliceRevision(kind.part);
        return kind.revision === undefined ? none : kind.revision();
    }

    /** A kind's source's choices, printed — but its window's range, which the range read holds; the empty text for a kind no source narrows. */
    private choicesOf(kind: ScheduleCellKind): string {
        if (kind.part === undefined) return "";
        const where: Where = kind.part.read().where;
        return printWhere(new SortedMap([...(kind.windowField === undefined ? where : withoutTiled(where, kind.windowField))], compareString));
    }

    /**
     * A kind read a window at a time, within the cap (see the module docs, "A window's rows"): its window's own stored
     * rows, kept at the revision they were read at while its record, its narrowing and the range hold.
     *
     * @returns Its rows as its cells; {@link READING} while its revision or its window's read is in flight
     */
    private windowKind(kind: ScheduleCellKind, range: { from: Date; to: Date }): KindRead | typeof READING {
        const revision = this.revisionOf(kind);
        if (revision.type !== "some") return READING;
        const at = `${revision.value}\u0000${this.choicesOf(kind)}\u0000${range.from.getTime()}\u0000${range.to.getTime()}`;
        let kept = this.windows.get(kind.key);
        if (kept === undefined || !stringEqual(kept.at, at)) {
            const read = kind.stored!(range.from, range.to);
            if (read.type !== "some") return READING;
            const codec = this.codecOf(kind);
            const bytes = read.value;
            // Unpacked once, when first read: by the kind's seams, or for a gesture's row (#1771).
            let entries: readonly CellEntry[] | undefined;
            const rowsOf = (): readonly CellEntry[] => (entries ??= codec.decodeCells(bytes));
            const handle = holdCellRows(rowsOf);
            this.made.add(handle);
            kept = { at, handle, held: new CellRows(codec, rowsOf) };
            this.windows.set(kind.key, kept);
        }
        return { mode: "cells", handle: kept.handle, held: kept.held, dropped: NO_IDS, revision: revision.value, paged: false, unread: NO_RESOURCES };
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
                decodeCells: decodeBeast2For(cellsType) as (bytes: Uint8Array) => { key: unknown; row: unknown }[],
                encodeRow: encodeBeast2For(fields["row"]!) as (row: unknown) => Uint8Array,
            };
            this.codecs.set(kind.cellsType, codec);
        }
        return codec;
    }

    /** How a kind's series index in time order orders the keys it files by (#1710): by the type of the row field it names. */
    private orderOf(kind: ScheduleCellKind, field: string): KeyOrder {
        let held = this.orders.get(kind.cellsType);
        if (held === undefined) { held = new Map(); this.orders.set(kind.cellsType, held); }
        let order = held.get(field);
        if (order === undefined) { order = keyOrderOf(kind.cellsType, field); held.set(field, order); }
        return order;
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
     * A kind's rows, held under a handle its seams read them by, and the rows by the event's key's text (#1771): made
     * again only when what they are made from moved — the cells' entries, the rows read by key and what the narrowing
     * answered of them — and made once for kinds made from the same: the cases of one record read over the same blocks.
     * `rows` gives them by key when they are first read, which a read made from the same never asks.
     */
    private hold(slot: string, codec: KindCodec, from: readonly unknown[], rows: () => Iterable<readonly [unknown, unknown]>): Generation {
        const same = (made: Generation | undefined): made is Generation =>
            made !== undefined && made.from.length === from.length && made.from.every((part, i) => Object.is(part, from[i]));
        const last = this.generations.get(slot);
        if (same(last)) return last;
        for (const other of this.generations.values()) {
            if (!same(other)) continue;
            this.generations.set(slot, other);
            return other;
        }
        let entries: readonly CellEntry[] | undefined;
        const rowsOf = (): readonly CellEntry[] => (entries ??= [...rows()].map(([key, row]) => ({ key, row })));
        const handle = holdCellRows(rowsOf);
        this.made.add(handle);
        const made: Generation = { from, handle, held: new CellRows(codec, rowsOf) };
        this.generations.set(slot, made);
        return made;
    }

    /**
     * The spans a kind's series reads hold, by the index (#1771): those of every kind read through its source over the
     * same slots — the cases of one record, whose searches are one — so they read one set of rows.
     */
    private spansOf(kind: ScheduleCellKind, part: ScheduleCellPart): SpansByIndex {
        let bySlots = this.spans.get(part.key);
        if (bySlots === undefined) { bySlots = new Map(); this.spans.set(part.key, bySlots); }
        const slots = printSlots([...kind.takes]);
        let byIndex = bySlots.get(slots);
        if (byIndex === undefined) { byIndex = new Map(); bySlots.set(slots, byIndex); }
        return byIndex;
    }

    /**
     * A kind's series cells over the runs wanted, through one of its series
     * indexes, counted at the record's revision now (#1433, #1768): each
     * group's run of each level — the span of it held, and a cell for each part
     * of it not held, one range a key over each part, or through an index in
     * time order one a tile (#1710) — every part's searches in one request,
     * which counts their entries before one is read, and how many entries each
     * group's runs hold, its tiles held among them. Through an index in time
     * order a range holds every key between the group's first and last: what
     * is counted is at least the group's own.
     *
     * @returns The runs wanted, and each group's count in the groups' order; {@link READING} while the revision or a count
     *   is in flight
     */
    private seriesCounts(stored: SpansByIndex, part: ScheduleCellPart, series: Index, groups: readonly SeriesGroup[], runs: readonly TileRun[]):
        SeriesCounted | typeof READING {
        const revision = recordSliceRevision(part);
        if (revision.type !== "some") return READING;
        const last = stored.get(series.name);
        const kept = last !== undefined && stringEqual(last.revision, revision.value) ? last.spans : new Map<string, Span>();
        // Each group's run of each level: the span of it held, and a cell for each part of it not held.
        const wanted: SeriesWant[] = [];
        const missing: RecordSliceCell[] = [];
        groups.forEach((group, g) => {
            // What its searches are made from: its keys, and what its narrowing chooses of the index's leading fields.
            const leading = series.fields.map((field) => {
                const choice = group.where.get(field);
                return choice === undefined ? "" : printChoice(choice);
            }).join("\u0001");
            const identity = `${group.literals.join("\u0001")}\u0000${leading}`;
            for (const run of runs) {
                const key = `${group.id}\u0000${run.level}`;
                const from = run.from.getTime();
                const to = run.to.getTime();
                const span = kept.get(key);
                const held = span !== undefined && stringEqual(span.identity, identity) && span.from < to && span.to > from ? span : undefined;
                const parts: [number, number][] = held === undefined ? [[from, to]] : [];
                if (held !== undefined && from < held.from) parts.push([from, held.from]);
                if (held !== undefined && held.to < to) parts.push([held.to, to]);
                const cells = parts.map(([a, b]) => ({
                    id: `${group.id}@${run.level}@${a}`,
                    queries: groupQueries(series, group, { level: run.level, from: new Date(a), to: new Date(b) }),
                }));
                missing.push(...cells);
                wanted.push({ key, identity, from, to, held, cells, group, at: g });
            }
        });
        // Counted first: the entries of the tiles held, and of the parts not held, before one of those is read.
        const counts = groups.map(() => 0);
        for (const want of wanted) {
            if (want.held === undefined) continue;
            for (const [tile, entries] of want.held.byTile) if (tile >= want.from && tile < want.to) counts[want.at] = counts[want.at]! + entries.length;
        }
        if (missing.length > 0) {
            const found = recordSliceCellRuns(part, series.name, missing);
            if (found.type !== "some") return READING;
            for (const want of wanted) {
                for (const cell of want.cells) counts[want.at] = counts[want.at]! + Number(found.value.get(cell.id)?.total ?? 0n);
            }
        }
        return { revision: revision.value, wanted, counts };
    }

    /**
     * A kind's series cells read, of the groups `taken` takes in (#1433,
     * #1768): the entries of the parts not held, in one request — each cell
     * counted already, so none is searched again — each kept under the tile it
     * names, and every span no group taken in wants let go. Through an index in
     * time order the entries of each group's own keys are kept (#1710).
     *
     * @returns The groups taken in's entries a level, in order; {@link READING} while the entries are in flight
     */
    private seriesRead(stored: SpansByIndex, part: ScheduleCellPart, series: Index, counted: SeriesCounted, taken: readonly boolean[]): SeriesEntries | typeof READING {
        const reading = counted.wanted.filter((want) => taken[want.at] === true);
        const missing = reading.flatMap((want) => want.cells);
        let read: ReadonlyMap<string, RecordSliceEntry[]> = new Map();
        if (missing.length > 0) {
            const got = recordSliceCellEntries(part, series.name, missing);
            if (got.type !== "some") return READING;
            read = got.value;
        }
        const spans = new Map<string, Span>();
        const entries = reading.map(({ key, identity, from, to, held, cells, group }) => {
            let span = held !== undefined && held.from === from && held.to === to ? held : undefined;
            if (span === undefined) {
                const byTile = new Map<number, RecordSliceEntry[]>();
                if (held !== undefined) for (const [tile, list] of held.byTile) if (tile >= from && tile < to) byTile.set(tile, [...list]);
                for (const cell of cells) {
                    for (const entry of read.get(cell.id) ?? []) {
                        // Through an index in time order, a range holds the keys between the group's first and last too (#1710).
                        if (group.run !== undefined && !group.run.holds(entryKey(entry))) continue;
                        const tile = tileOf(entry);
                        const list = byTile.get(tile);
                        if (list === undefined) byTile.set(tile, [entry]);
                        else list.push(entry);
                    }
                }
                const ordered = [...byTile.keys()].sort((a, b) => a - b).flatMap((tile) => byTile.get(tile)!);
                span = { identity, from, to, byTile, entries: ordered };
            }
            spans.set(key, span);
            return span.entries;
        });
        // The spans this read takes in, and no other.
        stored.set(series.name, { revision: counted.revision, spans });
        return { entries, revision: counted.revision };
    }

    /**
     * A read of every kind (see the module docs), each asked whatever the others' reads are doing: a kind whose read is
     * in flight holds no other's back, so the kinds' requests go out together (#1771).
     *
     * @param args - What it reads over
     * @returns What it read; {@link READING} while a count, or a cell's count or entries, of any kind are in flight
     */
    read(args: Omit<ScheduleCellsArgs, "host">): Read | typeof READING {
        const { kinds, resources, paged, range, period, buckets, resolution, drafts, span, zoomShades } = args;
        // The revision each kind read by its cells, or its window's rows, reads at now, before anything of the read is in
        // flight: what cells standing from an earlier read are told from, as from before a Save or holding it. And each
        // narrowed kind's choices: what the read is asked under.
        const now = new Map<string, string>();
        const choices: string[] = [];
        for (const kind of kinds) {
            if (kind.hidden) continue;
            if (kind.part !== undefined) choices.push(`${kind.key}\u0000${this.choicesOf(kind)}`);
            if (!readByCells(kind, paged) && kind.stored === undefined) continue;
            const revision = this.revisionOf(kind);
            if (revision.type === "some") now.set(kind.key, revision.value);
        }
        if (!sameRevisions(now, this.nowAt)) this.nowAt = now.size === 0 ? NO_REVISIONS : now;
        // The view asked, whatever of the read is in flight: the host's period, and those choices.
        const made: ReadView = { period: period ?? "", choices: choices.join("\u0001") };
        if (!sameView(made, this.askedView)) this.askedView = made;
        if (range === undefined || buckets === undefined) return READING;
        const reads: [string, ScheduleCellRead][] = [];
        const held = new Map<string, HeldRows>();
        const dropped = new Map<string, ReadonlySet<string>>();
        const revisions = new Map<string, string>();
        const notices: ScheduleCellNotice[] = [];
        const capped = new Set<string>();
        const windowed = new Set<string>();
        // The resources of the margin's blocks a kind left unread beneath the cap (#1768): their rows wait on a read.
        const unread = new Set<string>();
        const over: ScheduleCellRange = { from: range.from.getTime(), to: range.to.getTime() };
        // The shading, by a row's key, then by the resource's key: each tile's totals, or the hatch.
        const totals: Totals = new Map();
        // The paged kind's blocks in view, read once for every kind placed on it — and its resources wanted, kept.
        let pagedBlocks: ScheduleCellBlock[] | typeof READING | undefined;
        const blocksOfPaged = (): ScheduleCellBlock[] | typeof READING => {
            if (pagedBlocks !== undefined) return pagedBlocks;
            try {
                pagedBlocks = paged === undefined || paged.hidden ? [] : schedulePagedBlocks(paged, span) ?? READING;
            } catch (thrown) {
                // The paged kind's own rows — their count, a window — failing to read: what its host's paging says where
                // those rows are, never as its period's (#1710). Anything else thrown is the reader's own failure.
                throw isPagedReadError(thrown) ? new PagedRowsFailure(thrown) : thrown;
            }
            if (pagedBlocks !== READING) {
                const wanted = new Set(pagedBlocks.flatMap((block) => block.keys.map((key) => scheduleCellId(block.slot, key))));
                if (!sameKeys(wanted, this.wantedKeys)) this.wantedKeys = wanted;
            }
            return pagedBlocks;
        };
        // A kind's resources' blocks, a counted kind's past the cap: the paged kind's in view, and every resource read whole.
        const blocksOf = (kind: ScheduleCellKind): ScheduleCellBlock[] | typeof READING => {
            const out: ScheduleCellBlock[] = [];
            for (const slot of kind.takes) {
                if (pagedSlot(paged, slot)) {
                    const blocks = blocksOfPaged();
                    if (blocks === READING) return READING;
                    out.push(...blocks.filter((block) => stringEqual(block.slot, slot)));
                    continue;
                }
                const whole = resources.find((r) => stringEqual(r.key, slot));
                const keys = whole?.keys ?? [];
                for (let at = 0; at < keys.length; at += SCHEDULE_CELL_BLOCK) {
                    const mine = keys.slice(at, at + SCHEDULE_CELL_BLOCK);
                    // The rows beneath its resources a kind's `child` lands on (#1541, U1).
                    const children = new Map(mine.flatMap((key) => {
                        const beneath = whole?.children?.get(key);
                        return beneath === undefined ? [] : [[key, beneath] as const];
                    }));
                    out.push({ slot, id: String(at / SCHEDULE_CELL_BLOCK), keys: mine, ...(children.size > 0 && { children }) });
                }
            }
            return out;
        };
        // Whether a kind drew its cells, or its shading, over the paged kind's blocks: then its rows draw what they hold.
        let byCells = false;
        // Whether a kind's read is in flight (#1771): every other kind is asked all the same, so their requests go out
        // together, never each once the one before it has landed.
        let inFlight = false;
        for (const kind of kinds) {
            let read: KindRead | typeof READING;
            let outside: ReadonlySet<string> | typeof READING = NO_IDS;
            // A kind whose own read throws is named by the failure: what its host says could not be read, and asks again.
            try {
                if (readByCells(kind, paged)) {
                    if (kind.hidden) {
                        // Hidden: it draws nothing, so no cell of it is read — and given none, nothing reads its range.
                        read = { mode: "shade", notice: undefined, paged: false };
                    } else {
                        // The paged rows' blocks of the slots it lands on.
                        const blocks = blocksOfPaged();
                        read = blocks === READING ? READING : this.cellsKind(kind, kind.part!, kind.part!.read().where,
                            blocks.filter((block) => kind.takes.some((slot) => stringEqual(slot, block.slot))), paged?.unassigned === true, range, buckets,
                            resolution, drafts, totals, zoomShades === true);
                    }
                } else {
                    read = this.countedKind(kind, range, buckets, resolution, totals, blocksOf);
                    // A narrowed kind every draft of which draws where it places its event — one given its window's rows,
                    // or read by its host over them alone (#1424): the drafts of events its narrowing does not hold left
                    // out, as a kind read by its cells leaves them.
                    if (read !== READING && kind.windowField !== undefined && kind.part !== undefined && !kind.hidden) {
                        const { part, windowField } = kind;
                        const held = read.mode === "cells" ? read.held : undefined;
                        outside = this.draftsOutside(kind, part, windowField, drafts, held);
                    } else if (read !== READING && read.mode === "cells" && kind.isNew !== undefined) {
                        // A kind whose window draws a draft only of an event it holds, or of a new one (#1343): the
                        // drafts of the other events left out, told by the rows held and where each draft began — but
                        // one drawn last, while its session has yet to judge it where its record reads now (#1599).
                        outside = draftsNotHeld(kind.key, drafts.get(kind.key), read.held, kind.isNew, kind.carrying?.() === true, this.standing);
                    }
                }
            } catch (thrown) {
                throw thrown instanceof KindReadFailure || thrown instanceof PagedRowsFailure ? thrown : new KindReadFailure(thrown, kind.key);
            }
            if (read === READING || outside === READING) {
                inFlight = true;
                continue;
            }
            if (outside.size > 0) dropped.set(kind.key, outside);
            switch (read.mode) {
                // Its host reads it over the range, as it reads a kind no reader names.
                case "window": continue;
                case "cells":
                    reads.push([kind.key, variant("rows", read.handle)]);
                    held.set(kind.key, read.held);
                    if (read.dropped.size > 0) dropped.set(kind.key, read.dropped);
                    revisions.set(kind.key, read.revision);
                    // A series index's cells draw over the paged kind's blocks; a window's rows are the range's alone.
                    if (read.paged) {
                        byCells = true;
                        for (const id of read.unread) unread.add(id);
                    } else windowed.add(kind.key);
                    break;
                case "shade":
                    reads.push([kind.key, READ_NOTHING]);
                    held.set(kind.key, NO_ROWS);
                    if (read.notice !== undefined) notices.push(read.notice);
                    if (read.paged) byCells = true;
                    // Past the cap: none of its events is read, so no host counts one of them on a row. A hidden kind is in
                    // no host's figure at all, so it is named here by none.
                    if (!kind.hidden) capped.add(kind.key);
                    break;
            }
        }
        if (inFlight) return READING;
        return {
            reads: new SortedMap(reads, compareString),
            shading: shadingOf(totals, buckets),
            drafts: narrowedDrafts(drafts, dropped),
            held,
            notices,
            capped: capped.size === 0 ? NONE_CAPPED : capped,
            dropped,
            // The resources whose cells this read holds: its blocks', where a kind drew its cells or its shading on them — but
            // those of the margin's blocks a kind left unread beneath the cap (#1768), whose rows wait on a read.
            covered: !byCells ? undefined : unread.size === 0 ? this.wantedKeys : new Set([...this.wantedKeys].filter((id) => !unread.has(id))),
            range: over,
            revisions: revisions.size === 0 ? NO_REVISIONS : revisions,
            windowed: windowed.size === 0 ? NONE_WINDOWED : windowed,
            made: this.askedView,
        };
    }

    /**
     * A kind counted before one of its events is read (see the module docs):
     * within the cap, left to its host to read over the range; past it, its
     * summary's shading, or the notice — or, hidden, nothing.
     */
    private countedKind(
        kind: ScheduleCellKind, range: { from: Date; to: Date }, buckets: readonly ScheduleCellBucket[], resolution: TimeResolution | undefined,
        totals: Totals, blocksOf: (kind: ScheduleCellKind) => ScheduleCellBlock[] | typeof READING,
    ): KindRead | typeof READING {
        const within = scheduleWithinCap(kind.count, range.from, range.to);
        if (within.type !== "some") return READING;
        // Within the cap: a kind read a window at a time is given its window's rows; one read whole, or hidden, is left
        // to its host.
        if (within.value) return kind.stored === undefined || kind.hidden ? { mode: "window" } : this.windowKind(kind, range);
        // Past the cap: none of its events is read or drawn.
        if (kind.hidden) return { mode: "shade", notice: undefined, paged: false };
        const blocks = blocksOf(kind);
        if (blocks === READING) return READING;
        const where = kind.part === undefined ? new Map() : kind.part.read().where;
        return this.overBudget(kind, where, blocks, range, buckets, resolution, totals, this.eventsOf(kind, range), false);
    }

    /**
     * The drafted events of a kind its host reads over the window's rows alone
     * (#1424) that its narrowing — but the window's range of `field` — does not
     * hold: their stored rows read by their keys in one read, and asked of the
     * narrowing in one more, as a kind read by its cells asks of the events its
     * cells do not hold. A new event, which no stored row names, keeps its draft.
     *
     * @param held - The rows the kind's window holds, when the reader keeps them: an event among them is the narrowing's, and is asked of nothing
     * @returns Their keys' texts; {@link READING} while a row or the narrowing's answer is in flight
     */
    private draftsOutside(kind: ScheduleCellKind, part: ScheduleCellPart, field: string, drafts: ScheduleEventDraftsValue,
        held?: HeldRows | undefined): ReadonlySet<string> | typeof READING {
        const kindDrafts = drafts.get(kind.key);
        if (kindDrafts === undefined || kindDrafts.size === 0) return NO_IDS;
        const narrowing = withoutTiled(part.read().where, field);
        // No narrowing holds every event: each draft draws.
        if (narrowing.size === 0) return NO_IDS;
        const codec = this.codecOf(kind);
        const asked: { id: string; key: unknown }[] = [];
        for (const id of kindDrafts.keys()) {
            if (held?.has(id) === true) continue;
            const key = codec.keyOf(id);
            if (key !== undefined) asked.push({ id, key });
        }
        if (asked.length === 0) return NO_IDS;
        const stored = recordSliceRows(part, asked.map((a) => a.key));
        if (stored.type !== "some") return READING;
        const rows: { id: string; key: unknown; row: unknown }[] = [];
        stored.value.forEach((row, i) => { if (row.type === "some") rows.push({ ...asked[i]!, row: row.value }); });
        if (rows.length === 0) return NO_IDS;
        const within = recordSliceWithin(part, narrowing, rows);
        if (within.type !== "some") return READING;
        const outside = new Set<string>();
        rows.forEach(({ id }, i) => { if (within.value[i] !== true) outside.add(id); });
        return outside.size === 0 ? NO_IDS : outside;
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
     * it (see the module docs). `unassigned` says whether the paged rows draw
     * an Unassigned row, whose events — those on no resource — are read too.
     * Where its host's zoom shades (`zoomShades`, #1706), a resolution coarser
     * than its series index's tile shades from its summary too, and reads none
     * of its events.
     */
    private cellsKind(
        kind: ScheduleCellKind, part: ScheduleCellPart, where: Where, blocks: readonly ScheduleCellBlock[], unassigned: boolean,
        range: { from: Date; to: Date }, buckets: readonly ScheduleCellBucket[], resolution: TimeResolution | undefined, drafts: ScheduleEventDraftsValue,
        totals: Totals, zoomShades: boolean,
    ): KindRead | typeof READING {
        const codec = this.codecOf(kind);
        const indexes = part.config.indexes;
        // The groups read: each block of resources in view, and the events on none where an Unassigned row draws them —
        // each a run of each level (#1433). Where none draws them they are read for nothing (#1710), and through an index
        // in time order led by the rows' group, which no block of theirs stands under, none would serve them.
        const groups: CellGroup[] = [];
        // The resources of each group only the margin wants, by the group (#1768): what waits on a read where the cap leaves it.
        const margins = new Map<string, readonly string[]>();
        for (const block of blocks) {
            const literals = block.keys.flatMap((key) => {
                const literal = this.literal(kind, block.slot, key);
                return literal === undefined ? [] : [literal];
            });
            if (literals.length === 0) continue;
            const id = `${block.slot}:${block.id}`;
            groups.push({ id, literals, under: block.under ?? NO_UNDER });
            if (block.margin === true) margins.set(id, block.keys.map((key) => scheduleCellId(block.slot, key)));
        }
        const unplaced = unassigned ? this.noResource(kind) : undefined;
        if (unplaced !== undefined) groups.push({ id: "none", literals: [unplaced], under: NO_UNDER });
        // The series index each group is read through, and the narrowing it is read under (#1710): the one led by the
        // most of the narrowing's choices, one in time order under the rows the group stands under. A range a key a
        // level, or through an index in time order a range a tile, under each combination of the leading values.
        const plans = new Map<string, { series: Index; runs: TileRun[]; groups: SeriesGroup[] }>();
        let served = true;
        let searches = 0;
        for (const group of groups) {
            const found = seriesIndexFor(indexes, where, group.under.map((text) => underOf(kind.cellsType, text)));
            const tiling = found === undefined ? undefined : tilingOf(found.index);
            if (found === undefined || tiling === undefined) { served = false; break; }
            let plan = plans.get(found.index.name);
            if (plan === undefined) {
                plan = { series: found.index, runs: levelRuns(tiling.tile.type, range.from, range.to), groups: [] };
                plans.set(found.index.name, plan);
            }
            const run = tiling.order.type === "time" ? keyRunOf(this.orderOf(kind, tiling.key), group.literals) : undefined;
            const reading: SeriesGroup = { ...group, where: found.where, run };
            plan.groups.push(reading);
            for (const level of plan.runs) searches += groupQueries(found.index, reading, level).length;
        }
        // With no group to read, the index a page of no groups is read through — or, a source listing one in time order,
        // that one — says which field its tiles cover: nothing is read of it.
        const standing = plans.values().next().value?.series ?? seriesIndexFor(indexes, where, [])?.index
            ?? indexes.find((index) => index.series.type === "some" && index.series.value.order.type === "time");
        const tiled = standing === undefined ? undefined : tilingOf(standing);
        // Zoomed out past its series index's tile (#1706): a month's, a quarter's or a year's buckets hold more than a
        // week's events can draw, so its summary shades them, and none of its events is read.
        if (zoomShades && resolution !== undefined && tiled !== undefined && coarserThan(resolution, tiled.tile.type)) {
            return this.overBudget(kind, where, blocks, range, buckets, resolution, totals, undefined, true);
        }
        // No series index serves a group, or its narrowing: more than one batch, as many events as the summary is for.
        if (!served || tiled === undefined || searches > MAX_RECORD_SLICE_BATCH) {
            return this.overBudget(kind, where, blocks, range, buckets, resolution, totals, undefined, true);
        }
        const revision = recordSliceRevision(part);
        if (revision.type !== "some") return READING;
        const reading = [...plans.values()];
        // The spans of the kinds read through its source over its slots (#1771): the cases of one record share them.
        const spansHeld = this.spansOf(kind, part);
        // Each index's cells counted, asked together: a count in flight of one never holds another's back.
        const counted = reading.map((plan) => this.seriesCounts(spansHeld, part, plan.series, plan.groups, plan.runs));
        // The spans of an index no group is read through now are let go.
        for (const name of [...spansHeld.keys()]) if (!plans.has(name)) spansHeld.delete(name);
        if (counted.some((one) => one === READING)) return READING;
        const counts = counted as SeriesCounted[];
        // The cap holds the groups meeting the rows in view, through every index together; the margin's are read too, in
        // their order, while what is read stays within it (#1768). Past it in view: its summary's shading.
        const weighed = counts.flatMap((one, p) => reading[p]!.groups.map((group, g) => ({ margin: margins.has(group.id), count: one.counts[g]! })));
        const taken = scheduleCellsWithinCap(weighed);
        if (taken === undefined) {
            const inView = weighed.reduce((sum, group) => (group.margin ? sum : sum + group.count), 0);
            return this.overBudget(kind, where, blocks, range, buckets, resolution, totals, inView, true);
        }
        // Each index's groups taken in read, asked together; the resources of those the cap leaves wait on a read.
        const unread = new Set<string>();
        const reads: (SeriesEntries | typeof READING)[] = [];
        let first = 0;
        for (const [p, one] of counts.entries()) {
            const plan = reading[p]!;
            const mine = taken.slice(first, first + plan.groups.length);
            first += plan.groups.length;
            for (const [g, group] of plan.groups.entries()) {
                if (mine[g] !== true) for (const id of margins.get(group.id) ?? []) unread.add(id);
            }
            reads.push(this.seriesRead(spansHeld, part, plan.series, one, mine));
        }
        if (reads.some((one) => one === READING)) return READING;
        const read = { entries: (reads as SeriesEntries[]).flatMap((one) => one.entries), revision: revision.value };
        // Each event once, by its key: one past a year is under every year it touches. Filed once for the entries read:
        // the rows in view moving within the blocks held — a wheel's step — reads the same entries, and ordering every
        // one of them by its key again, for each kind, was a third of what the step cost (east-workspace#1776). Never
        // changed once filed: every read made from the same entries reads these, each kind of the record's cases.
        const lastFiled = this.filed.get(spansHeld);
        const fileAgain = lastFiled === undefined || lastFiled.from.length !== read.entries.length
            || !lastFiled.from.every((entries, n) => Object.is(entries, read.entries[n]));
        const cells = fileAgain ? new SortedMap<unknown, unknown>([], codec.compareKey) : lastFiled.rows;
        if (fileAgain) {
            filedProbe?.();
            for (const entries of read.entries) {
                for (const entry of entries) if (entry.row?.type === "some") cells.set(entry.key, entry.row.value);
            }
            this.filed.set(spansHeld, { from: read.entries, rows: cells });
        }
        // The events not read whose rows are wanted: those drafted, and those its host wants by key — a link's ends.
        const kindDrafts = drafts.get(kind.key);
        const extra: { id: string; key: unknown }[] = [];
        const wanted = (id: string) => {
            const key = codec.keyOf(id);
            if (key !== undefined && !cells.has(key) && !extra.some((e) => stringEqual(e.id, id))) extra.push({ id, key });
        };
        const narrowing = withoutTiled(where, tiled.from);
        if (narrowing.size > 0) for (const id of kindDrafts?.keys() ?? []) wanted(id);
        for (const id of kind.wanted) wanted(id);
        let stored: option<option<unknown>[]> = some([]);
        if (extra.length > 0) stored = recordSliceRows(part, extra.map((e) => e.key));
        // The rows asked of the narrowing: the cells', for the fields their searches leave, and the stored rows read by key.
        const asked: { key: unknown; row: unknown }[] = [];
        // What the narrowing chooses beside an index's leading fields: asked of every row read, where any index leaves some.
        const residual = [...plans.values()].some((plan) => residualOf(plan.series, where).length > 0);
        if (residual) for (const [key, row] of cells) asked.push({ key, row });
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
        // What the narrowing does not hold draws nowhere, nor does a draft of it: the kind's rows are the cells' but
        // those of them the narrowing leaves out, with the rows read by key it holds beside them.
        const dropped = new Set<string>();
        const outside: unknown[] = [];
        const beside: { key: unknown; row: unknown }[] = [];
        let i = 0;
        if (residual) {
            for (const [key] of cells) {
                if (within[i++]) continue;
                outside.push(key);
                dropped.add(codec.idOf(key));
            }
        }
        for (const { id, key, row } of storedRows) {
            const holds = narrowing.size === 0 || within[i++] === true;
            if (holds) beside.push({ key, row });
            else dropped.add(id);
        }
        // Drafts of events whose rows are still in flight show as drafted until they land. The cells' events are copied
        // only where the kind's rows differ from them, and only once what the rows are made from has moved.
        const made = this.hold(kind.key, codec, [...read.entries, ...storedRows.map((s) => s.row), ...within], () => {
            if (outside.length === 0 && beside.length === 0) return cells;
            const rows = new SortedMap<unknown, unknown>(cells, codec.compareKey);
            for (const key of outside) rows.delete(key);
            for (const { key, row } of beside) rows.set(key, row);
            return rows;
        });
        return { mode: "cells", handle: made.handle, held: made.held, dropped, revision: read.revision, paged: true, unread: unread.size === 0 ? NO_RESOURCES : unread };
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
        kind: ScheduleCellKind, where: Where, blocks: readonly ScheduleCellBlock[], range: { from: Date; to: Date },
        buckets: readonly ScheduleCellBucket[], resolution: TimeResolution | undefined, totals: Totals, counted: number | undefined, windowed: boolean,
    ): KindRead | typeof READING {
        const part = kind.part;
        const indexes = part?.config.indexes ?? [];
        const child = kind.child;
        // Whether its shading or its hatch draws over the paged kind's rows: then those rows draw what they hold.
        const paged = windowed;
        if (part !== undefined) {
            for (const tile of dividingTiles(resolution)) {
                // A kind landing a step beneath its resources shades those rows from a summary led by its child's field,
                // each row its own counts (#1541, U1): never from its resources', which drew every row beneath one alike.
                const summary = child === undefined
                    ? tileIndexFor(indexes, where, "summary", (t) => t === tile)
                    : childSummaryFor(indexes, where, child.field, tile);
                if (summary === undefined || residualOf(summary, where).length > 0) continue;
                const shaded = child === undefined
                    ? this.summaryCells(kind, part, where, summary, blocks, range, totals)
                    : this.childCells(kind, child, part, where, summary, blocks, range, totals);
                if (shaded !== undefined) return shaded === READING ? READING : { mode: "shade", notice: undefined, paged };
            }
        }
        let events = counted;
        if (windowed) {
            // Its count over the range it reads: the count its window's read asks first.
            const within = scheduleWithinCap(kind.count, range.from, range.to);
            if (within.type !== "some") return READING;
            if (within.value) return kind.stored === undefined ? { mode: "window" } : this.windowKind(kind, range);
            events = this.eventsOf(kind, range);
        }
        // The notice: the rows hatched — beneath a resource, each row there (#1541, U1) — and the resolution the smallest
        // summary shades at.
        for (const block of blocks) {
            const series = kind.shadeKey(child === undefined ? block.slot : child.slot);
            let held = totals.get(series);
            if (held === undefined) { held = { booked: kind.booked, byKey: new Map() }; totals.set(series, held); }
            for (const key of block.keys) {
                if (child === undefined) { held.byKey.set(key, "hatch"); continue; }
                for (const row of block.children?.get(key) ?? []) if (stringEqual(row.slot, child.slot)) held.byKey.set(child.rowKey(key, row.key), "hatch");
            }
        }
        // A resource's summary shades — beneath one, a summary led by the child's field; the record's totals (#1732) are a
        // horizon's, and shade nothing.
        const keyed = indexes.filter((index) => index.summary.type === "some" && index.summary.value.type === "keyed");
        const shading = child === undefined ? keyed : keyed.filter((index) => index.fields.some((field) => stringEqual(field, child.field)));
        const tiles = shading.flatMap((index) => (index.summary.type === "some" && index.summary.value.type === "keyed" ? [index.summary.value.value.tile.type] : []));
        const smallest = (["day", "week", "month", "quarter", "year"] as const).find((t) => tiles.includes(t));
        // Beneath its resources, summaries of them alone: its counts are kept by its resources, which the notice says.
        const resources = kind.takes[0];
        const keptBy = child !== undefined && shading.length === 0 && keyed.length > 0 && resources !== undefined
            ? { resources, rows: child.slot } : undefined;
        return { mode: "shade", notice: { kind: kind.key, name: kind.name, events, resolution: smallest, ...(keptBy !== undefined && { keptBy }) }, paged };
    }

    /**
     * A summary's cells over some blocks, folded into each resource's totals
     * by tile; `undefined` when they take more than one batch of searches.
     */
    private summaryCells(
        kind: ScheduleCellKind, part: ScheduleCellPart, where: Where, summary: Index, blocks: readonly ScheduleCellBlock[], range: { from: Date; to: Date },
        totals: Totals,
    ): true | typeof READING | undefined {
        const tiling = tilingOf(summary)!;
        // Its tiles over the range, one range a key (#1433): what a resource's totals are split by tile from.
        const run = summaryRun(tiling.tile.type, range.from, range.to);
        const cells: { cell: RecordSliceCell; block: ScheduleCellBlock; keys: string[] }[] = [];
        let searches = 0;
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
            const queries = summaryCellQueries(summary, where, run, literals).queries;
            cells.push({ cell: { id: `${block.slot}:${block.id}`, queries }, block, keys });
            searches += queries.length;
        }
        if (searches > MAX_RECORD_SLICE_BATCH) return undefined;
        const runs = recordSliceCellRuns(part, summary.name, cells.map((c) => c.cell));
        if (runs.type !== "some") return READING;
        const read = this.kept.entries(`${kind.key}\u0000${summary.name}`, part, summary.name, cells.map((c) => c.cell));
        if (read.type !== "some") return READING;
        cells.forEach(({ cell, block, keys }, n) => {
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
                    // The tile its total is of, as the summary keys it.
                    const tile = tileOf(entry);
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

    /**
     * A summary led by a kind's child's field over the rows beneath some
     * blocks' resources (#1541, U1), folded into each row's totals by tile —
     * filed under the child's slot by the row's own key: a search a row, under
     * its key chosen of the field and its resource's key. A row its narrowing
     * leaves out, or whose key or resource the fields cannot hold, shades at
     * nothing. `undefined` when they take more than one batch of searches.
     */
    private childCells(
        kind: ScheduleCellKind, child: NonNullable<ScheduleCellKind["child"]>, part: ScheduleCellPart, where: Where, summary: Index,
        blocks: readonly ScheduleCellBlock[], range: { from: Date; to: Date }, totals: Totals,
    ): true | typeof READING | undefined {
        const tiling = tilingOf(summary)!;
        // Its tiles over the range, one range a row (#1433): what a row's totals are split by tile from.
        const run = summaryRun(tiling.tile.type, range.from, range.to);
        const series = kind.shadeKey(child.slot);
        let held = totals.get(series);
        if (held === undefined) { held = { booked: kind.booked, byKey: new Map() }; totals.set(series, held); }
        // What the narrowing chooses of the child's field: a row it leaves out holds none of the events it counts.
        const chosen = where.get(child.field);
        const cells: { cell: RecordSliceCell; rows: string[] }[] = [];
        const nothing: string[] = [];
        let searches = 0;
        for (const block of blocks) {
            const queries: RecordSliceCell["queries"][number][] = [];
            // The row each search counts for, search by search.
            const rows: string[] = [];
            for (const key of block.keys) {
                const resource = this.literal(kind, block.slot, key);
                for (const beneath of block.children?.get(key) ?? []) {
                    if (!stringEqual(beneath.slot, child.slot)) continue;
                    const row = child.rowKey(key, beneath.key);
                    const literal = child.literal(beneath.key);
                    if (resource === undefined || literal === undefined || (chosen?.type === "values" && !chosen.value.some((value) => stringEqual(value, literal)))) {
                        nothing.push(row);
                        continue;
                    }
                    // A narrowing is a Dict of its fields' choices: in its fields' order, as one decoded is.
                    const its = new SortedMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>([...where], compareString);
                    its.set(child.field, variant("values", [literal]));
                    for (const query of summaryCellQueries(summary, its, run, [resource]).queries) {
                        queries.push(query);
                        rows.push(row);
                    }
                }
            }
            if (queries.length === 0) continue;
            cells.push({ cell: { id: `${child.slot}:${block.id}`, queries }, rows });
            searches += queries.length;
        }
        if (searches > MAX_RECORD_SLICE_BATCH) return undefined;
        for (const row of nothing) if (!held.byKey.has(row)) held.byKey.set(row, new Map());
        if (cells.length === 0) return true;
        const runs = recordSliceCellRuns(part, summary.name, cells.map((c) => c.cell));
        if (runs.type !== "some") return READING;
        const read = this.kept.entries(`${kind.key}\u0000${summary.name}`, part, summary.name, cells.map((c) => c.cell));
        if (read.type !== "some") return READING;
        cells.forEach(({ cell, rows }, n) => {
            const found = runs.value.get(cell.id) as RecordSliceCellRuns;
            const entries = read.value[n]!;
            // The entries of each search in order, those of an empty one none.
            let at = 0;
            found.ranges.forEach((range, q) => {
                const count = Number(range.count);
                const row = rows[q]!;
                let byTile = held.byKey.get(row);
                if (byTile === undefined || byTile === "hatch") { byTile = new Map(); held.byKey.set(row, byTile); }
                for (const entry of entries.slice(at, at + count)) {
                    if (entry.value?.type !== "some") continue;
                    const t = entry.value.value as { count: bigint; ms: bigint };
                    // The tile its total is of, as the summary keys it.
                    const tile = tileOf(entry);
                    const was = byTile.get(tile);
                    byTile.set(tile, { count: (was?.count ?? 0) + Number(t.count), ms: (was?.ms ?? 0) + Number(t.ms) });
                }
                at += count;
            });
        });
        return true;
    }
}

/**
 * The summary that counts the rows beneath a resource a kind's `child` lands
 * on, at a tile (#1541, U1): of its summaries by key at the tile led by the
 * child's field, those whose leading fields the narrowing — a key of the
 * child's chosen of that field, as each search chooses one — chooses exactly,
 * the one led by the most; of two led by as many, the one listed first.
 *
 * @param indexes - The kind's source's indexes
 * @param where - Its narrowing
 * @param field - The child's field
 * @param tile - The tile wanted
 * @returns The index; `undefined` for none, or where the narrowing chooses the field otherwise than by its values
 */
function childSummaryFor(indexes: readonly Index[], where: Where, field: string, tile: RecordTile): Index | undefined {
    const chosen = where.get(field);
    if (chosen !== undefined && chosen.type !== "values") return undefined;
    const probe = new SortedMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>([...where], compareString);
    probe.set(field, variant("values", [""]));
    return tileIndexFor(indexes.filter((index) => index.fields.some((one) => stringEqual(one, field))), probe, "summary", (t) => t === tile);
}

/**
 * The drafted events of a kind that its window's rows do not hold and that are no new ones (see
 * {@link ScheduleCellKind.isNew}): what its window's own read never drew a draft of. Which drafts draw is the rule every
 * builder that draws its drafts over the rows it reads asks (`drafted-rows.ts`' `DraftedStanding`): one its window
 * holds, a new one, and — while its session has yet to judge its drafts where its record reads now — one the reader last
 * drew, its window read again without its event.
 *
 * @param kind - The kind's slot
 * @param drafts - The kind's drafts, by the event's key's text
 * @param held - The rows its window holds
 * @param isNew - Whether an event's session began from no stored row
 * @param carrying - Whether the kind's session has yet to judge its drafts where its record reads now
 * @param standing - The rule, and the drafts last drawn, which the kind's drawn here replace
 * @returns Their keys' texts
 */
export function draftsNotHeld(kind: string, drafts: ReadonlyMap<string, Uint8Array> | undefined, held: Pick<HeldRows, "has">, isNew: (id: string) => boolean,
    carrying: boolean, standing: DraftedStanding): ReadonlySet<string> {
    if (drafts === undefined || drafts.size === 0) { standing.drewKind(kind, NO_IDS); return NO_IDS; }
    let out: Set<string> | undefined;
    const drawn = new Set<string>();
    for (const id of drafts.keys()) {
        if (standing.stands(kind, id, { created: isNew(id), carrying }, held.has(id))) drawn.add(id);
        else (out ??= new Set()).add(id);
    }
    standing.drewKind(kind, drawn);
    return out ?? NO_IDS;
}

/** The shading the totals fold into, over the buckets: each row's key, then each resource's buckets. */
function shadingOf(totals: Totals, buckets: readonly ScheduleCellBucket[]): ScheduleCellShading {
    return new SortedMap([...totals].map(([series, { booked, byKey }]) => [series, new SortedMap([...byKey].map(([key, held]) =>
        [key, held === "hatch" ? hatchOf(buckets) : shadesOf(held, buckets, booked)] as [string, ScheduleCellShade[]]), compareString)] as [string, SortedMap<string, ScheduleCellShade[]>]),
    compareString);
}

/** Whether two reads' revisions are one: each kind read by its cells at the same revision. */
function sameRevisions(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
    return a.size === b.size && [...a].every(([kind, revision]) => {
        const other = b.get(kind);
        return other !== undefined && stringEqual(other, revision);
    });
}

/**
 * What Saves landed of the kinds whose cells stand from before them (see the module docs): those read at another
 * revision than the one the kind's record reads at now, as east-ui-components' `readBeforeSaves` tells it. A kind none
 * of whose cells is read is laid nothing.
 *
 * @param landed - What Saves landed of the kinds read by their cells
 * @param revisions - The revision each kind's standing cells were read at
 * @param now - The revision each kind's record reads at now
 * @returns Those kinds' landed events, by their slots; the one empty map while none stands from before
 */
export function landedBefore(
    landed: ScheduleLanded | undefined, revisions: ReadonlyMap<string, string>, now: ReadonlyMap<string, string>,
): ReadonlyMap<string, ScheduleLandedRows> {
    if (landed === undefined || landed.size === 0) return NOTHING_LAID;
    let out: Map<string, ScheduleLandedRows> | undefined;
    for (const [kind, rows] of landed) {
        const at = revisions.get(kind);
        if (at !== undefined && readBeforeSaves(at, now.get(kind), rows.from)) (out ??= new Map()).set(kind, rows);
    }
    return out ?? NOTHING_LAID;
}

/** Whether two sets of kinds' landed events are one: the same kinds, each the same events. */
function sameLanded(a: ReadonlyMap<string, ScheduleLandedRows>, b: ReadonlyMap<string, ScheduleLandedRows>): boolean {
    return a.size === b.size && [...a].every(([kind, rows]) => Object.is(b.get(kind), rows));
}

/**
 * The drafts and the rows held, with what Saves landed of each kind whose cells stand from before them laid in (see the
 * module docs): each event under its kind's drafts as the Save left it — but one a draft made since holds, which draws
 * in its place, and one its narrowing did not hold, which drew nowhere before the Save — and each row held as the Save
 * left it, one it deleted gone, read by its key.
 *
 * @param drafts - Every kind's drafts as the seams take them
 * @param held - The rows each kind's cells hold
 * @param dropped - The drafted events each kind's narrowing does not hold, by its slot
 * @param laid - What Saves landed of the kinds whose cells stand from before them
 * @param own - Every kind's drafts as the host's sessions hold them
 * @returns The drafts and the rows held; themselves while nothing is laid
 */
function laidLanded(
    drafts: ScheduleEventDraftsValue, held: ReadonlyMap<string, HeldRows>, dropped: ReadonlyMap<string, ReadonlySet<string>>,
    laid: ReadonlyMap<string, ScheduleLandedRows>, own: ScheduleEventDraftsValue,
): { readonly drafts: ScheduleEventDraftsValue; readonly held: ReadonlyMap<string, HeldRows> } {
    if (laid.size === 0) return { drafts, held };
    let outDrafts: SortedMap<string, ValueTypeOf<typeof ScheduleDraftsType>> | undefined;
    let outHeld: Map<string, HeldRows> | undefined;
    for (const [kind, landed] of laid) {
        const drafted = own.get(kind);
        const gone = dropped.get(kind);
        let kindDrafts: SortedMap<string, Uint8Array> | undefined;
        for (const [id, row] of landed.rows) {
            if (drafted?.has(id) === true || gone?.has(id) === true) continue;
            kindDrafts ??= new SortedMap(drafts.get(kind) ?? [], compareString);
            kindDrafts.set(id, row.draft);
        }
        // Each landed event's row as its Save left it, one it deleted gone: laid over the rows held, which are not copied.
        (outHeld ??= new Map(held)).set(kind, new LaidRows(held.get(kind) ?? NO_ROWS, landed.rows));
        if (kindDrafts !== undefined) (outDrafts ??= new SortedMap(drafts, compareString)).set(kind, kindDrafts);
    }
    return { drafts: outDrafts ?? drafts, held: outHeld ?? held };
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
 * Two reads alike: each kind drawn from the same — the same rows, by their
 * handle, made again only when what they are made from moved (#1771) — and
 * the same shading, drafts, notices and kinds past the cap; over a paged kind
 * read by its cells, the same resources covered over the same range, as its
 * rows wait on them. A read over another range that holds the same is the
 * same, where nothing waits on its range: a pan within the cap hands nothing
 * on.
 */
function sameRead(a: Read, b: Read): boolean {
    const drawnFrom = (x: ScheduleCellReads, y: ScheduleCellReads) => x.size === y.size && [...x].every(([slot, read]) => {
        const other = y.get(slot);
        return other !== undefined && readEqual(other, read);
    });
    return drawnFrom(a.reads, b.reads) && shadingEqual(a.shading, b.shading) && draftsEqual(a.drafts, b.drafts) && sameKeys(a.capped, b.capped)
        && sameKeys(a.windowed, b.windowed)
        && sameKeys(a.covered, b.covered) && (a.covered === undefined || sameRange(a.range, b.range))
        && a.notices.length === b.notices.length && a.notices.every((n, i) => {
            const m = b.notices[i]!;
            return stringEqual(n.kind, m.kind) && n.events === m.events && n.resolution === m.resolution
                && (n.keptBy === undefined ? m.keptBy === undefined
                    : m.keptBy !== undefined && stringEqual(n.keptBy.resources, m.keptBy.resources) && stringEqual(n.keptBy.rows, m.keptBy.rows));
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
 * The failure of a read its host says as its period's read failed, with Retry
 * (#1599, #1710): every one but the paged kind's own rows', which its paging
 * says where those rows are ({@link ScheduleCellsFailure.rows}) — a kind's
 * window, its count, its drafts, and its cells over the paged kind's blocks,
 * which nothing else says.
 *
 * @param read - What the reader handed on; `undefined` before it reads
 * @returns The failure its host says; `undefined` with none
 */
export function schedulePeriodFailure(read: Pick<ScheduleCellsRead, "error"> | undefined): ScheduleCellsFailure | undefined {
    const error = read?.error;
    return error === undefined || error.rows ? undefined : error;
}

/** No shading: what a host draws while it steps to another period. */
const NO_SHADING: ScheduleCellShading = new SortedMap([], compareString);
/** No kind's rows held. */
const NO_KINDS_HELD: ReadonlyMap<string, HeldRows> = new Map();
/** No kind giving the notice. */
const NO_NOTICES: readonly ScheduleCellNotice[] = [];

/**
 * What a read hands its host's seams while the period asked is another than
 * the one read (`../view-read.ts`' stepping), for a host every kind's read of
 * which is made for its period — a Plan's, whose columns' period says whether
 * a kind draws its events or its summary's shading, and whose buckets that
 * shading is folded into. Nothing of the period read draws under the labels of
 * the one asked: every kind is handed none of its events — so none is read
 * over the range meanwhile either — with no shading, no notice and no kind
 * past the cap, and over a paged kind no resource's row drawn, so every row
 * waits on the read as before a first. The drafts, whether a read is on its
 * way, the view and a failure are the read's own.
 *
 * @param read - What the reader handed on
 * @param kinds - The event kinds
 * @returns `read` itself, but while its view is stepping: the same with nothing of the period read to draw
 */
export function scheduleSteppedCells(read: ScheduleCellsRead, kinds: readonly ScheduleCellKind[]): ScheduleCellsRead {
    if (read.view !== "stepping") return read;
    return {
        ...read,
        reads: new SortedMap(kinds.map((kind): [string, ScheduleCellRead] => [kind.key, READ_NOTHING]), compareString),
        shading: NO_SHADING,
        held: NO_KINDS_HELD,
        notices: NO_NOTICES,
        capped: NONE_CAPPED,
        drawn: read.drawn === undefined ? undefined : NO_RESOURCES,
        windowed: NONE_WINDOWED,
    };
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
 * cap, or past it as it was, hands nothing on. Over a kind's cells read before
 * a Save of it, what the Save landed draws as the Save left it, and is let go
 * once they are read since (see the module docs).
 *
 * @param args - What it reads over
 * @returns What it read
 */
export function useScheduleCells(args: ScheduleCellsArgs): ScheduleCellsRead {
    const [reader] = useState(() => new CellsReader());
    const { host, kinds, resources, paged, range, period, buckets, resolution, zoomShades, drafts, span, landed, shown } = args;
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    const read = useCallback(() => reader.read({
        kinds, resources, paged, buckets, resolution, zoomShades, drafts, span, period,
        range: from === undefined || to === undefined ? undefined : { from: new Date(from), to: new Date(to) },
    }), [reader, kinds, resources, paged, buckets, resolution, zoomShades, from, to, period, drafts, span]);
    const { result } = useTrackedEvaluation(read);
    const last = useRef<Read | undefined>(undefined);
    // The revision each kind's record reads at now, as the read just made found it — in flight or not.
    const now = reader.current();
    // The view the read just made was asked for — in flight or not — and the view the read standing was made for.
    const asked = reader.asked();
    const made = useRef<ReadView | undefined>(undefined);
    // The last failure, the same object while a read fails the same way: its host is handed nothing new for it.
    const failed = useRef<ScheduleCellsFailure | undefined>(undefined);
    // The revision each kind's standing cells were read at: the last read landed's — a read the same as the one standing
    // stands for it, its cells holding the same rows at its revision.
    const revisions = useRef<ReadonlyMap<string, string>>(NO_REVISIONS);
    // Before the first read: every kind read by its cells draws nothing yet — and over a paged kind, no resource's row
    // drawn.
    const opening = useMemo((): Read => {
        const slots = scheduleCellKinds(kinds, paged);
        return {
            reads: new SortedMap(slots.map((slot): [string, ScheduleCellRead] => [slot, READ_NOTHING]), compareString),
            shading: new SortedMap([], compareString),
            drafts,
            held: new Map(),
            notices: [],
            capped: NONE_CAPPED,
            dropped: new Map(),
            covered: paged !== undefined && slots.length > 0 ? NO_RESOURCES : undefined,
            range: undefined,
            revisions: NO_REVISIONS,
            windowed: NONE_WINDOWED,
            made: NO_VIEW,
        };
    }, [kinds, drafts, paged]);
    // What it hands on: the same object while the read, whether one its rows wait on is in flight, what it reads again
    // and over which range, and what Saves landed over cells read before them hold.
    const handed = useRef<{
        standing: Read; drafts: ScheduleEventDraftsValue; reading: boolean; wanted: ReadonlySet<string>; moved: boolean;
        laid: ReadonlyMap<string, ScheduleLandedRows>; view: ViewState; error: ScheduleCellsFailure | undefined; read: ScheduleCellsRead;
    } | undefined>(undefined);
    const handedOn = useMemo((): ScheduleCellsRead => {
        // A read that threw: why, and the kind whose own read it was.
        let error: ScheduleCellsFailure | undefined;
        if (!result.ok) {
            const failure = result.error instanceof KindReadFailure ? result.error : undefined;
            const rows = result.error instanceof PagedRowsFailure;
            const thrown = failure?.thrown ?? (result.error instanceof PagedRowsFailure ? result.error.thrown : result.error);
            console.error(`[${host}] the event kinds' cells could not be read:`, thrown);
            const reason = thrown instanceof Error ? thrown.message : String(thrown);
            const was = failed.current;
            error = was !== undefined && stringEqual(was.reason, reason) && was.rows === rows
                && (failure === undefined ? was.kinds.length === 0 : was.kinds.length === 1 && stringEqual(was.kinds[0]!, failure.kind))
                ? was : { reason, kinds: failure === undefined ? [] : [failure.kind], rows };
            failed.current = error;
        }
        const inFlight = !result.ok || result.value === READING;
        if (!inFlight) {
            const next = result.value as Read;
            if (last.current === undefined || !sameRead(last.current, next)) last.current = next;
            if (!sameRevisions(revisions.current, next.revisions)) revisions.current = next.revisions;
            made.current = next.made;
        }
        // How what stands is to what is asked now: the one rule every builder reads its rows by.
        const view = viewState(made.current, asked, result.ok && result.value === READING);
        // While a read is in flight, the last stands in — the drafts as they are now, less those it found the narrowing does not hold.
        const standing = last.current ?? opening;
        const wanted = reader.wanted();
        // The resources whose cells it holds, over a paged kind read by its cells: only there does anything wait on a read —
        // one in flight, never one that threw, which nothing waits on (retest C7: its host's main busy, and its line saying
        // the events read, for as long as it stood).
        const covered = standing.covered;
        const reading = covered !== undefined && result.ok && result.value === READING;
        // In flight, or thrown, over another range than the one standing was read over: its cells there never landed.
        const moved = covered !== undefined && inFlight && standing.range !== undefined && from !== undefined && to !== undefined && !sameRange(standing.range, { from, to });
        // What Saves landed of the kinds whose cells stand from before them: drawn as the Saves left it.
        const laid = landedBefore(landed, revisions.current, now);
        const was = handed.current;
        if (was !== undefined && was.standing === standing && was.reading === reading && was.moved === moved && sameLanded(was.laid, laid)
            && was.view === view && was.error === error
            && (!inFlight || (Object.is(was.drafts, drafts) && was.wanted === wanted))) return was.read;
        // The rows that draw what is known of them: the resources whose cells it holds — over another range, less those it
        // reads again; over the same range, a commit's or another narrowing's read, every one, its cells standing in.
        const drawn = covered === undefined || !moved ? covered : new Set([...covered].filter((key) => !wanted.has(key)));
        const seams = laidLanded(inFlight ? narrowedDrafts(drafts, standing.dropped) : standing.drafts, standing.held, standing.dropped, laid, drafts);
        const read: ScheduleCellsRead = {
            reads: standing.reads,
            shading: standing.shading,
            drafts: seams.drafts,
            held: seams.held,
            notices: standing.notices,
            capped: standing.capped,
            reading,
            drawn,
            windowed: standing.windowed,
            view,
            error,
        };
        handed.current = { standing, drafts, reading, wanted, moved, laid, view, error, read };
        return read;
    }, [host, result, opening, drafts, reader, from, to, landed, now, asked]);
    // What Saves landed of a kind whose cells are read at the revision its record reads at now — or none of whose cells is
    // read: counted, past the cap or hidden — is let go, in the commit that draws its cells without it, so no frame draws both.
    useLayoutEffect(() => {
        if (landed === undefined || shown === undefined) return;
        for (const [kind, rows] of landed) {
            const at = revisions.current.get(kind);
            if (at === undefined || !readBeforeSaves(at, now.get(kind), rows.from)) shown(kind, [...rows.rows.keys()]);
        }
    }, [landed, shown, handedOn, now]);
    // The rows no read its host may still draw from names are let go, once its host has drawn the latest (#1771).
    useEffect(() => { reader.letGo(handedOn.reads); }, [reader, handedOn]);
    return handedOn;
}
