/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A Plan's paged rows' collections, read a cell at a time through their
 * nested series index (#1438): the reader beside the canvas's paging, in a
 * component of its own as the event kinds' is (`events.ts`), and the wrapper
 * that draws each window of lean rows with what it read.
 *
 * # What it reads
 *
 * The blocks of {@link SCHEDULE_CELL_BLOCK} of the canvas's rows meeting those
 * in view, and the next block the way the view last went (#1797) — the one
 * after them where it went on down the rows, the one before them where it went
 * back up; none beside them for a view that has gone no way — top rows and
 * child rows alike, in the canvas's order. A folded row's children are no rows
 * of it, and their items are not read. For each row, each collection its series reads
 * (the seam's `uses`) and each level the collection's items are filed at, one
 * range over that level's run of tiles (#1433): `[place, row, path, .items,
 * level, from]` to `[…, to]`, every literal as the index's key prints it. A row
 * with children whose series subtotals them reads its subtotals too, one range
 * at the resolution's level, and never its descendants' cells for them; one
 * whose children's span series rolls them up into bands reads its subtree's
 * items, one range a level — which e3's fill puts back in the descendants that
 * hold them, so the bands roll up from them as over rows read whole.
 *
 * Every search it does not hold goes in one request, which counts each one's
 * entries first; the entries it does not hold go in one more. What it holds is
 * kept at the record's revision: a pan or a scroll within what it holds reads
 * nothing, and a commit reads what is wanted again, the last standing in until
 * it lands. Of the runs a view has left it keeps the most recently wanted
 * while they fit — the one rule every reader of a schedule's events keeps them
 * by (#1797, `shared/schedule/kept-spans.ts`) — so a view going back to rows it
 * has left reads nothing; they are none of the cells it hands on.
 *
 * # The cap
 *
 * While a collection's items in the cells wanted are at most
 * {@link SCHEDULE_EVENT_CAP}, they draw. Past it, no item of it is read, and the
 * rows of the series reading it shade from their totals — a parent rolling it
 * up into bands from its subtree's — at the canvas's bucket's own period where
 * the index keeps each row's totals at it, an item counted once as e3 counts
 * it, else at the coarsest period it keeps them at that divides the bucket, its
 * tiles inside each bucket added up: the share of each bucket booked, how many
 * items touch it, or its values folded as the series folds them. Where it keeps
 * them at no period that divides the bucket, the rows are hatched, and the
 * reader names the collection among its notices, with how many items there are
 * and the finest period its totals are kept at, which the canvas's banner says.
 *
 * # What it hands on
 *
 * The cells, encoded as the binding's fill takes them; the shading; each
 * parent's subtotals by its row's key, which the derivation draws in place of
 * its children's (`derivePlan`); and a version that moves when any of them
 * does, so the canvas's paged source, which draws each window through the
 * seam's `rows`, is read again. Beside them, while a read is in flight, the
 * rows waiting on it — each row with a run of tiles not held, as a pan, a
 * zoom, a scroll or a commit asks — which wash as a paged kind's unread rows
 * do (#1398, CL2) until their cells land.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
    ArrayType, BlobType, SortedMap, StringType, applyFor, compareFor, encodeBeast2For, equalFor, none, printFor, some, variant,
    type EastType, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { SeekQueryType } from "@elaraai/east-ui";
import { levelRuns, summaryRun, tileNext, type RecordTile } from "@elaraai/east-ui/internal";
import { nestedPathCases, nestedPathValue, nestedSpanName } from "@elaraai/e3-types";
import { Plan, PlanNestedShadingType, SCHEDULE_EVENT_CAP, type PlanNestedType } from "@elaraai/e3-ui/internal";
import { useSliceReactivity, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { windowedSourceOf } from "@elaraai/east-ui-components/internal";
import { indexedBindingOf, type IndexedBindingRead } from "../../platform/indexed-paged.js";
import { keyReaderOf } from "../../platform/key-text.js";
import { useRecordDrafts, type PreviewedRow, type RecordDraftsSession } from "../../shared/records/drafts.js";
import type { EditSession } from "@elaraai/east-ui-components";
import { SCHEDULE_CELL_BLOCK, dividingTiles, wantedBlocks, type ScheduleCellBucket, type ScheduleCellTravel } from "../../shared/schedule/cells.js";
import { scheduleSpansKept } from "../../shared/schedule/kept-spans.js";
import { pinnedRows, type PlanParentSubtotal, type PlanParentSubtotals, type PlanRootValue, type PlanRowIndex, type PlanRowValue } from "../model.js";
import type { PlanResolution, PlanScale } from "../scale.js";
import { bucketsOver } from "./cells.js";
import { eventReadRange } from "./events.js";
import { ownRefresh, ownSnapshot, usePagedRoots, usePagedWrapper } from "./wrapped-source.js";

/** The seam a Plan's root carries over paged rows beside their nested series index, decoded. */
export type PlanNestedValue = ValueTypeOf<typeof PlanNestedType>;
/** One series' read of one collection, as the seam carries it. */
type Use = PlanNestedValue["uses"][number];
/** The rows' shading past the cap, as the seam's window takes it. */
export type PlanNestedShadingValue = ValueTypeOf<typeof PlanNestedShadingType>;
type SeekQuery = ValueTypeOf<SeekQueryType>;
/** One search's bounds in the index, as a batch of searches answers them. */
type Range = { readonly found: boolean; readonly row: bigint; readonly count: bigint };
/** An entry of the index, as the binding's fill takes it. */
type Entry = { readonly ik: unknown; readonly value: unknown };
/** One shade of a row's bucket. */
type Shade = { readonly at: Date; readonly value: option<number> };

/** A collection past the cap that no totals shade at this resolution. */
export interface PlanNestedNotice {
    /** Its place: its field names from the row down. */
    readonly place: readonly string[];
    /** How many of its items the cells wanted hold. */
    readonly items: number;
    /** The finest period the index keeps each row's totals at, which shades its rows at a resolution it divides; `undefined` when it keeps them at none. */
    readonly resolution: RecordTile | undefined;
}

/** What the reader hands the canvas (see the module docs). */
export interface PlanNestedLead {
    /** The items read, encoded as the binding's fill takes them: a beast2 Array of the index's `{ ik, value }` entries. */
    readonly cells: Uint8Array;
    /** The rows' shading past the cap: by series, then by the row's path as East prints it, its buckets. */
    readonly shading: PlanNestedShadingValue;
    /** Each parent's subtotals as e3 keeps them, by its row's key. */
    readonly parents: PlanParentSubtotals;
    /** The collections past the cap that no totals shade at this resolution. */
    readonly notices: readonly PlanNestedNotice[];
    /** Moves each time the cells, the shading or the subtotals do: the canvas reads its windows again then. */
    readonly version: number;
    /** Whether a read is in flight: what stands was read before it. */
    readonly reading: boolean;
}

// ============================================================================
// The rows in view
// ============================================================================

/** The rows the view shows as its scroll rests: the first and the last, by their keys. */
export interface PlanNestedView {
    readonly first: string;
    readonly last: string;
}

/** Where the canvas's rows in view are, as it reports them to the reader: a store of one view. */
export interface PlanNestedViewStore {
    /** The view last reported; `undefined` before any is. */
    get(): PlanNestedView | undefined;
    /** Reports the rows in view: a view the store holds already moves nothing. */
    set(view: PlanNestedView | undefined): void;
    /** Listens for a view that moves; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

const stringEqual = equalFor(StringType);

/**
 * A store of the canvas's rows in view: the canvas writes it as its scroll
 * comes to rest, and the reader, a component of its own, reads it.
 *
 * @returns The store
 */
export function createNestedViewStore(): PlanNestedViewStore {
    let view: PlanNestedView | undefined;
    const listeners = new Set<() => void>();
    return {
        get: () => view,
        set(next) {
            if (next === view || (next !== undefined && view !== undefined && stringEqual(next.first, view.first) && stringEqual(next.last, view.last))) return;
            view = next;
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

// ============================================================================
// The literals an index's key prints
// ============================================================================

/** The `.east` literals a search of the nested series index names its bounds in, made once for a binding. */
interface Literals {
    /** A collection's place: its field names, as the key's place prints. */
    place(names: readonly string[]): string;
    /**
     * A node's path, as the key's path prints (#1540): the child rows' keys from the row down, each read from its text
     * at its own type and held under the case of the rows it is a key of, along the collection's place; `undefined`
     * for a key's text its type cannot read, or a path longer than the place has child rows for.
     */
    node(place: readonly string[], keys: readonly string[]): string | undefined;
    /** A row's key's leaves, from its id's text; `undefined` for text the key's type cannot read. */
    row(id: string): readonly string[] | undefined;
    /** A run of a node's entries. */
    run(run: unknown): string;
    /** A level. */
    level(level: RecordTile): string;
    /** A tile's start. */
    tile(at: Date): string;
    /** Entries, encoded as the binding's fill takes them. */
    encode(entries: readonly Entry[]): Uint8Array;
    /** An entry's key, as text: what names it among its run's entries. */
    key(ik: unknown): string;
    /** The prefix of the run an entry's key falls in: its place, its row, its path, its run and its level. */
    prefixOf(ik: unknown): string;
    /** An entry's value with its update applied, as e3 applies an index's patch. */
    update(value: unknown, patch: unknown): unknown;
}


/**
 * The child rows' keys from a row down to a node, each as the index's id (#1540): read from its text at the type its
 * rows are keyed by — a String as it is, any other as East prints it — and held under its rows' case of the index's
 * ids. The rows on the way to a collection are its place's fields but the last, each one's case its place so far; a
 * path longer than those is a tree's, whose rows are keyed as the rows listing them are, under the same case.
 *
 * @param ids - The index's ids: each collection of child rows and of items, by its case, and its key type
 * @param place - The collection's place: its field names from the row down
 * @param keys - The keys' texts, from the row down
 * @returns The ids; `undefined` for a text its type cannot read, or keys where the place has no child rows
 */
function nodeIds(ids: Readonly<Record<string, EastType>>, place: readonly string[], keys: readonly string[]): unknown[] | undefined {
    const cases = nestedPathCases(place);
    const out: unknown[] = [];
    for (const [i, text] of keys.entries()) {
        const idCase = cases[Math.min(i, cases.length - 1)];
        const type = idCase === undefined ? undefined : ids[idCase];
        if (idCase === undefined || type === undefined) return undefined;
        const id = keyReaderOf(type)(text);
        if (id === undefined) return undefined;
        out.push(variant(idCase, id));
    }
    return out;
}

/** A value's leaves as a search's bounds flatten them: a struct's fields in order, recursed; any other value printed. */
function leavesOf(type: EastType): (value: unknown) => string[] {
    if (type.type === "Struct") {
        const fields = Object.entries(type.fields as Record<string, EastType>).map(([name, field]) => [name, leavesOf(field)] as const);
        return (value) => fields.flatMap(([name, leaves]) => leaves((value as Record<string, unknown>)[name]));
    }
    const print = printFor(type);
    return (value) => [print(value as never)];
}

const literalsOf = new WeakMap<object, Literals>();

/** The literals of a binding's nested series index, made once for its entry type. */
function literals(binding: IndexedBindingRead): Literals {
    const nested = binding.nested!;
    let made = literalsOf.get(nested.entry);
    if (made !== undefined) return made;
    const fields = (nested.entry.fields.ik as StructType).fields as Record<string, EastType>;
    const printPlace = printFor(fields["collection"]!);
    const printPath = printFor(fields["path"]!);
    // The index's ids, off its key's path: a step's key is one of them.
    const ids = (fields["path"] as { readonly node: { readonly cases: { readonly step: StructType } } }).node.cases.step.fields["key"] as
        EastType & { readonly cases: Readonly<Record<string, EastType>> };
    const printRun = printFor(fields["run"]!);
    const printLevel = printFor(fields["level"]!);
    const printTile = printFor(fields["tile"]!);
    const keyLeaves = leavesOf(binding.key);
    const readKey = keyReaderOf(binding.key);
    const encode = encodeBeast2For(ArrayType(nested.entry)) as (entries: readonly Entry[]) => Uint8Array;
    const printKey = printFor(nested.entry.fields.ik);
    const apply = applyFor(nested.entry.fields.value) as (value: unknown, patch: unknown) => unknown;
    made = {
        place: (names) => printPlace(nestedPathValue(names) as never),
        node: (place, keys) => {
            const steps = nodeIds(ids.cases, place, keys);
            return steps === undefined ? undefined : printPath(nestedPathValue(steps) as never);
        },
        row: (id) => {
            const key = readKey(id);
            return key === undefined ? undefined : keyLeaves(key);
        },
        run: (run) => printRun(run as never),
        level: (level) => printLevel(variant(level, null) as never),
        tile: (at) => printTile(at as never),
        encode,
        key: (ik) => printKey(ik as never),
        prefixOf: (ik) => {
            const k = ik as { readonly collection: unknown; readonly row: unknown; readonly path: unknown; readonly run: unknown; readonly level: unknown };
            return [printPlace(k.collection as never), ...keyLeaves(k.row), printPath(k.path as never), printRun(k.run as never), printLevel(k.level as never)].join("\u0001");
        },
        update: apply,
    };
    literalsOf.set(nested.entry, made);
    return made;
}

// ============================================================================
// What a view wants
// ============================================================================

/** One run of a node's entries at one level, over a run of its tiles, and what it is read for. */
interface Cell {
    /** The run's literals but its tiles': what names the tiles held of it. */
    readonly prefix: string;
    /** The same, as a search's bounds lead with them. */
    readonly leading: readonly string[];
    /** Its first tile's start. */
    readonly from: Date;
    /** The start of the tile after its last. */
    readonly to: Date;
    /** What it reads: a node's own items, a parent's subtree's, a parent's subtotals, or a node's or a subtree's totals. */
    readonly kind: "items" | "subtree" | "subtotals" | "totals";
    /** The collection's place, as its key prints it: what the cap counts by. */
    readonly place: string;
    /** The canvas's row it is read for. */
    readonly row: PlanRowValue;
    /** Which of the seam's uses it serves, by its place among them. */
    readonly use: number;
}

/** What the reader reads over, as the canvas gives it. */
export interface PlanNestedArgs {
    /** The seam. */
    readonly seam: PlanNestedValue;
    /** The canvas's rows the body lays out, in order: a folded row's children are none of them. */
    readonly visible: readonly PlanRowValue[];
    /** Every row the canvas holds, by key, with each one's children. */
    readonly index: PlanRowIndex;
    /** The rows in view, as the canvas reports them at rest; `undefined` before it does, for the first block. */
    readonly view: PlanNestedView | undefined;
    /** The range the canvas reads: its window and the periods laid out beyond it. */
    readonly range: { readonly from: Date; readonly to: Date } | undefined;
    /** The canvas's buckets over the range. */
    readonly buckets: readonly ScheduleCellBucket[] | undefined;
    /** The canvas's resolution. */
    readonly resolution: PlanResolution | undefined;
    /** Each drafted row's Save, previewed (#1437): what it changes in the index, put into what is held. */
    readonly previews?: ReadonlyMap<string, PreviewedRow> | undefined;
}

/** The levels a subtotal is kept at: a tile's, from the index's tile up. */
const TILES: readonly RecordTile[] = ["day", "week", "month", "quarter", "year"];

/** The level a parent's subtotals are read at: the resolution's, where the index keeps them there. */
function subtotalLevel(resolution: PlanResolution | undefined, tile: RecordTile): RecordTile | undefined {
    const level = TILES.find((candidate) => candidate === resolution);
    return level === undefined || TILES.indexOf(level) < TILES.indexOf(tile) ? undefined : level;
}

/** Whether a row draws its children's subtotals: a heat or a table parent declaring an aggregate, or a group's strip. */
function subtotals(row: PlanRowValue): boolean {
    const kind = row.kind;
    return (kind.type === "heat" && kind.value.aggregate.type === "some") || (kind.type === "table" && kind.value.aggregate.type === "some")
        || (kind.type === "group" && kind.value.summary.type === "aggregate");
}

/** Whether a row rolls its children's runs up into bands: a span declaring a rollup. */
const rollsUp = (row: PlanRowValue): boolean => row.kind.type === "span" && row.kind.value.rollup.type === "some";

/** How a parent row derives its numbers from its children's: its subtotals, or its subtree's runs rolled up into bands. */
interface Derives {
    readonly subtotals: boolean;
    readonly rollsUp: boolean;
}
const DERIVES_NOTHING: Derives = { subtotals: false, rollsUp: false };

/** The rows in view, as places among the rows laid out; the first block's before the canvas reports any. */
function viewOf(view: PlanNestedView | undefined, visible: readonly PlanRowValue[]): { first: number; last: number } {
    if (view === undefined) return { first: 0, last: 0 };
    const first = visible.findIndex((row) => stringEqual(row.key, view.first));
    const last = visible.findIndex((row) => stringEqual(row.key, view.last));
    return first < 0 || last < first ? { first: 0, last: 0 } : { first, last };
}

/**
 * Every search a view wants (see the module docs): each row of the blocks
 * meeting it and of the next the way it went, each collection its series reads
 * at each level it is filed at; each parent's subtotals or subtree; and, past
 * the cap, each row's totals.
 *
 * @param args - What the reader reads over
 * @param lit - The index's literals
 * @param capped - The places past the cap, as their key prints them: their rows read totals in place of items
 * @param derives - How a row derives its numbers from its children's: as it was drawn before the reader shaded it
 * @param summary - The period the rows past the cap read their totals at; `undefined` where the index keeps them at none that divides the canvas's bucket
 * @param way - The way the rows in view last went (#1797); `undefined` for a view that has gone none
 * @returns The runs, each node's at a level once
 */
function wantedCells(args: PlanNestedArgs, lit: Literals, capped: ReadonlySet<string>, summary: RecordTile | undefined,
    derives: (row: PlanRowValue) => Derives, way: ScheduleCellTravel | undefined): Cell[] {
    const { seam, visible, index, range, resolution } = args;
    if (range === undefined) return [];
    const tile = seam.tile.type as RecordTile;
    const runs = new Map(levelRuns(tile, range.from, range.to).map((run) => [run.level, run] as const));
    const level = subtotalLevel(resolution, tile);
    const subtotalRun = level === undefined ? undefined : summaryRun(level, range.from, range.to);
    const totalsRun = summary === undefined ? undefined : summaryRun(summary, range.from, range.to);
    const places = seam.uses.map((use) => lit.place(use.place));
    const out = new Map<string, Cell>();
    const add = (kind: Cell["kind"], use: number, row: PlanRowValue, leaves: readonly string[], keys: readonly string[], run: unknown, at: RecordTile,
        from: Date, to: Date) => {
        // The node, by its keys along the collection's place: one whose keys the index cannot read holds nothing to read.
        const node = lit.node(seam.uses[use]!.place, keys);
        if (node === undefined) return;
        const leading = [places[use]!, ...leaves, node, lit.run(run), lit.level(at)];
        const prefix = leading.join("\u0001");
        if (!out.has(prefix)) out.set(prefix, { prefix, leading, from, to, kind, place: places[use]!, row, use });
    };
    // What one row wants: its own items, and what it derives from the rows beneath it.
    const want = (row: PlanRowValue): void => {
        if (row.id.type !== "entry") return;
        const [id, ...keys] = row.id.value.path;
        const leaves = id === undefined ? undefined : lit.row(id);
        if (leaves === undefined) return;
        const series = row.id.value.series;
        // Its own items, a level at a time — past the cap its totals.
        seam.uses.forEach((use, u) => {
            if (!stringEqual(use.series, series)) return;
            if (capped.has(places[u]!)) {
                if (totalsRun !== undefined) add("totals", u, row, leaves, keys, variant("totals", null), summary!, totalsRun.from, totalsRun.to);
                return;
            }
            for (const at of use.levels) {
                const run = runs.get(at.type as RecordTile);
                if (run !== undefined) add("items", u, row, leaves, keys, variant("items", null), run.level, run.from, run.to);
            }
        });
        // As a parent whose row derives its numbers from its children's: its subtotals, or its subtree's items — past the
        // cap its subtree's totals.
        const children = index.children.get(row.key) ?? [];
        const beneath = new Set(children.flatMap((child) => (child.id.type === "entry" ? [child.id.value.series] : [])));
        seam.uses.forEach((use, u) => {
            if (use.parents.type !== "some" || ![...beneath].some((s) => stringEqual(s, use.series))) return;
            const parents = use.parents.value;
            const how = derives(row);
            if (!(parents.type === "subtotals" ? how.subtotals : how.rollsUp)) return;
            if (parents.type === "subtotals") {
                if (level !== undefined && subtotalRun !== undefined) {
                    add("subtotals", u, row, leaves, keys, variant("subtotals", parents.value), level, subtotalRun.from, subtotalRun.to);
                }
                return;
            }
            if (capped.has(places[u]!)) {
                if (totalsRun !== undefined) add("totals", u, row, leaves, keys, variant("subtreeTotals", null), summary!, totalsRun.from, totalsRun.to);
                return;
            }
            for (const at of use.levels) {
                const run = runs.get(at.type as RecordTile);
                if (run !== undefined) add("subtree", u, row, leaves, keys, variant("subtree", null), run.level, run.from, run.to);
            }
        });
    };
    const view = viewOf(args.view, visible);
    for (const block of wantedBlocks(view, visible.length, way)) {
        for (let i = block * SCHEDULE_CELL_BLOCK; i < Math.min((block + 1) * SCHEDULE_CELL_BLOCK, visible.length); i++) want(visible[i]!);
    }
    // A pinned row stands under the ruler wherever the view rests, and is none of the rows laid out: its cells are
    // always wanted.
    for (const row of pinnedRows(index)) want(row);
    return [...out.values()];
}

// ============================================================================
// The reader
// ============================================================================

/** A read whose counts or entries are still in flight: the rows waiting on it, by their keys. */
interface Waiting {
    readonly waiting: ReadonlySet<string>;
}

/** No row waiting on a read. */
const NOTHING_WAITING: ReadonlySet<string> = new Set();

/** The rows of some runs not held, waiting on their read. */
const waitingOn = (cells: readonly Cell[]): Waiting => ({ waiting: new Set(cells.map((cell) => cell.row.key)) });

/** Whether a read is in flight. */
const isWaiting = (read: Read | Waiting): read is Waiting => "waiting" in read;

/** What a read lands: what the canvas draws. */
interface Read {
    readonly cells: Uint8Array;
    readonly shading: PlanNestedShadingValue;
    readonly parents: PlanParentSubtotals;
    readonly notices: readonly PlanNestedNotice[];
}

/** The tiles held of a run: their span, and their entries. */
interface Span {
    /** Its first tile's start, in ms. */
    readonly from: number;
    /** The start of the tile after its last, in ms. */
    readonly to: number;
    /** The entries of its tiles. */
    readonly entries: readonly Entry[];
}

/** A part of a run whose tiles are not held: what it searches, and its bounds in the index once counted. */
interface Part {
    /** Its text: the run's prefix and its tiles' bounds. */
    readonly text: string;
    /** The run it is part of. */
    readonly cell: Cell;
    /** The search. */
    readonly query: SeekQuery;
}

const compareString = compareFor(StringType);
const printPathText = printFor(ArrayType(StringType));
const shadingEqual = equalFor(PlanNestedShadingType);
const blobEqual = equalFor(BlobType);
const instantEqual = equalFor(Plan.Types.Instant);

/** Whether two answers' subtotals are the same: each parent's, each collection's, each bucket's. */
function sameParents(a: PlanParentSubtotals, b: PlanParentSubtotals): boolean {
    if (a.size !== b.size) return false;
    for (const [key, series] of a) {
        const other = b.get(key);
        if (other === undefined || other.length !== series.length) return false;
        for (let i = 0; i < series.length; i++) {
            const x = series[i]!;
            const y = other[i]!;
            if (x.length !== y.length || x.some((s, j) => !instantEqual(s.at, y[j]!.at) || !Object.is(s.value, y[j]!.value))) return false;
        }
    }
    return true;
}

/** Whether two places are one: the same names, in order. */
const samePlace = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((name, i) => stringEqual(name, b[i]!));

/** Whether two reads draw the same. */
function sameRead(a: Read, b: Read): boolean {
    return blobEqual(a.cells, b.cells) && shadingEqual(a.shading, b.shading) && sameParents(a.parents, b.parents)
        && a.notices.length === b.notices.length && a.notices.every((n, i) => {
            const m = b.notices[i]!;
            return n.items === m.items && n.resolution === m.resolution && samePlace(n.place, m.place);
        });
}

/** A tile's totals, as numbers: how many items touch it, the ms of it they cover, and their values' sum, least, greatest and last. */
interface Totals {
    readonly count: number;
    readonly ms: number;
    readonly values: { readonly sum: number; readonly min: number; readonly max: number; readonly last: number } | undefined;
}

/**
 * One row's shading over the buckets: the totals of the summary tiles inside
 * each bucket — a tile that divides the bucket lies wholly inside it — as the
 * share booked, how many items touch it, or their values folded.
 */
function shadesOf(tiles: ReadonlyMap<number, Totals>, buckets: readonly ScheduleCellBucket[], shade: Use["shade"]): Shade[] {
    return buckets.map(({ start, end }): Shade => {
        let count = 0;
        let ms = 0;
        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        let last: number | undefined;
        let lastAt = -Infinity;
        for (const [at, t] of tiles) {
            if (at < start || at >= end) continue;
            count += t.count;
            ms += t.ms;
            if (t.values !== undefined) {
                sum += t.values.sum;
                min = Math.min(min, t.values.min);
                max = Math.max(max, t.values.max);
                if (at > lastAt) { lastAt = at; last = t.values.last; }
            }
        }
        if (shade.type === "booked") return { at: new Date(start), value: some(Math.min(1, ms / (end - start))) };
        if (shade.type === "count") return { at: new Date(start), value: some(count) };
        if (count === 0) return { at: new Date(start), value: none };
        const fold = shade.value.type;
        const value = fold === "count" ? count : fold === "sum" ? sum : fold === "mean" ? sum / count : fold === "min" ? min : fold === "max" ? max : last;
        return { at: new Date(start), value: value === undefined || !Number.isFinite(value) ? none : some(value) };
    });
}

/** The no-data hatch over the buckets: a row past the cap that no totals shade at this resolution. */
function hatchOf(buckets: readonly ScheduleCellBucket[]): Shade[] {
    return buckets.map(({ start }) => ({ at: new Date(start), value: none }));
}

/** A tile's start out of an entry's key. */
const tileOf = (entry: Entry): Date => (entry.ik as { readonly tile: Date }).tile;

/** One previewed change of an entry: its key, and its op — an `insert` of its value, a `delete`, an `update` by its value's patch. */
interface Change {
    readonly ik: unknown;
    readonly op: { readonly type: string; readonly value: unknown };
}

/**
 * Every previewed drafted row's changes to the nested series index, by the
 * run each falls in and the entry's key; none for a row still read, or one
 * whose change does not apply.
 */
function previewedChanges(previews: ReadonlyMap<string, PreviewedRow> | undefined, index: string, lit: Literals): ReadonlyMap<string, ReadonlyMap<string, Change>> {
    const out = new Map<string, Map<string, Change>>();
    for (const row of previews?.values() ?? []) {
        if (row.state !== "previewed") continue;
        // Each change is keyed as the index keys its entries: the nested key, beside the row's own key.
        for (const [key, op] of row.changes.get(index) ?? []) {
            const ik = (key as { readonly ik: unknown }).ik;
            const prefix = lit.prefixOf(ik);
            let ops = out.get(prefix);
            if (ops === undefined) { ops = new Map(); out.set(prefix, ops); }
            ops.set(lit.key(ik), { ik, op: op as Change["op"] });
        }
    }
    return out;
}

/** A run's entries with its previewed changes in place, over the tiles it holds. */
function withChanges(entries: readonly Entry[], ops: ReadonlyMap<string, Change>, cell: Cell, lit: Literals): Entry[] {
    const from = cell.from.getTime();
    const to = cell.to.getTime();
    const byKey = new Map(entries.map((entry) => [lit.key(entry.ik), entry] as const));
    for (const [key, { ik, op }] of ops) {
        const at = tileOf({ ik, value: null }).getTime();
        if (op.type === "delete") byKey.delete(key);
        else if (op.type === "insert") { if (at >= from && at < to) byKey.set(key, { ik, value: op.value }); }
        else if (op.type === "update") {
            const was = byKey.get(key);
            if (was !== undefined) byKey.set(key, { ik, value: lit.update(was.value, op.value) });
        }
    }
    return [...byKey.values()];
}

/**
 * The reader's state across reads: the tiles it holds of each run at a
 * revision, the bounds of the parts it has counted and not yet read, and the
 * last cells it encoded.
 */
class NestedCellsReader {
    /**
     * The tiles held of each run, by its prefix, at a revision — the runs the
     * latest read wants last, and before them those it wants no more, kept
     * while they fit, the least recently wanted first (#1797); each part's
     * bounds counted and its entries once read; and the batches of searches and
     * of reads in flight, each asked again until it lands, so a part is asked
     * in one batch however the wanted runs move meanwhile.
     */
    private held: {
        revision: string; spans: Map<string, Span>; found: Map<string, Range>; read: Map<string, readonly Entry[]>;
        counting: Part[][]; reading: Part[][];
    } | undefined;
    /** The last cells encoded, and the entries and previews they were made from. */
    private encoded: { from: readonly (readonly Entry[])[]; previews: PlanNestedArgs["previews"]; bytes: Uint8Array } | undefined;
    /**
     * How each row derives its numbers from its children's, as it was last
     * drawn unshaded, by its key; and the rows the last read shaded. A row the
     * reader shades is drawn as heat, so what it reads for the row as a parent
     * — its subtree past the cap, its subtotals — is decided by what the row
     * was before it shaded: else it would read less, fall under the cap, and
     * shade no longer, over and over.
     */
    private derived = new Map<string, Derives>();
    private shadedRows: ReadonlySet<string> = new Set();
    /**
     * The first row in view the way was last told from, by its key, and the way the view had gone through the rows laid
     * out by then (#1797): none for a view that has gone no way. `undefined` before the canvas reports a view.
     */
    private went: { readonly first: string; readonly way: ScheduleCellTravel | undefined } | undefined;

    /**
     * The way the rows in view last went through the rows laid out (#1797): on where the view's first row stands after
     * the one the way was last told from, back where it stands before it — and as it stood while the view begins at the
     * same row, or that row is laid out no more. A read made again over the same view is told the same.
     *
     * @returns The way; `undefined` for a view that has gone none — before the canvas reports one, the first it reports,
     *   and one whose first row is laid out no more, which reads the first block alone
     */
    private wayOf(args: PlanNestedArgs): ScheduleCellTravel | undefined {
        const view = args.view;
        if (view === undefined) return undefined;
        const went = this.went;
        if (went !== undefined && stringEqual(went.first, view.first)) return went.way;
        const now = args.visible.findIndex((row) => stringEqual(row.key, view.first));
        if (now < 0) return undefined;
        const was = went === undefined ? -1 : args.visible.findIndex((row) => stringEqual(row.key, went.first));
        const way = was < 0 ? went?.way : was < now ? "forward" : "back";
        this.went = { first: view.first, way };
        return way;
    }

    /** How a row derives its numbers from its children's: as drawn, or, while this reader shades it, as it was. */
    private derivesOf = (row: PlanRowValue): Derives => {
        if (this.shadedRows.has(row.key)) return this.derived.get(row.key) ?? DERIVES_NOTHING;
        const how = { subtotals: subtotals(row), rollsUp: rollsUp(row) };
        this.derived.set(row.key, how);
        return how;
    };

    /**
     * What the view wants, read: every part of a run whose tiles are not
     * held, counted in one request and read in one more, then — the places
     * past the cap found — their rows' totals, the same way.
     *
     * @param args - What the reader reads over
     * @returns What the canvas draws; while a revision, a count or a read is in flight, the rows waiting on it
     * @throws {Error} When no runtime here built the binding the seam names, or it lists no nested series index
     */
    read(args: PlanNestedArgs): Read | Waiting {
        const binding = indexedBindingOf(args.seam.source);
        if (binding?.nested === undefined) {
            throw new Error(`The Plan's rows are read through '${args.seam.source}', which no indexed runtime here built with a nested series index`);
        }
        const lit = literals(binding);
        // The way the rows in view last went: the next block that way is read beside those they meet (#1797).
        const way = this.wayOf(args);
        const revision = binding.handle.revision();
        if (revision.type !== "some") return waitingOn(wantedCells(args, lit, new Set(), undefined, this.derivesOf, way));
        if (this.held === undefined || !stringEqual(this.held.revision, revision.value)) {
            this.held = { revision: revision.value, spans: new Map(), found: new Map(), read: new Map(), counting: [], reading: [] };
        }
        const index = binding.nested.index;
        // The periods the index keeps each row's totals at. Past the cap a row shades at the canvas's bucket's own where
        // that is one of them, else at the coarsest of them that divides the bucket: those that divide it come coarsest first.
        const kept = new Set(args.seam.summary.map((period) => period.type as RecordTile));
        const summary = dividingTiles(args.resolution).find((tile) => kept.has(tile));
        // The runs wanted, their parts not held counted; then the places past the cap, whose rows read their totals instead.
        const first = wantedCells(args, lit, new Set(), undefined, this.derivesOf, way);
        const firstParts = this.partsOf(first, lit);
        if (!this.counted(binding, index, firstParts)) return waitingOn(firstParts.map((part) => part.cell));
        const items = new Map<string, number>();
        for (const cell of first) {
            if (cell.kind !== "items" && cell.kind !== "subtree") continue;
            items.set(cell.place, (items.get(cell.place) ?? 0) + this.countOf(cell, firstParts));
        }
        const capped = new Set([...items].filter(([, n]) => n > SCHEDULE_EVENT_CAP).map(([place]) => place));
        const wanted = capped.size === 0 ? first : wantedCells(args, lit, capped, summary, this.derivesOf, way);
        const parts = capped.size === 0 ? firstParts : this.partsOf(wanted, lit);
        if (!this.counted(binding, index, parts)) return waitingOn(parts.map((part) => part.cell));
        // Every part's entries not held, in one request: their runs in the index's order, which a read of runs asks.
        const read = this.held.read;
        if (!this.entries(binding, index, parts)) return waitingOn(parts.filter((part) => !read.has(part.text)).map((part) => part.cell));
        // Each run's tiles held now: those it held in its span, and its parts'. A run wanted stands last among the spans:
        // the most recently wanted.
        const spans = this.held.spans;
        const byCell = new Map<string, Part[]>();
        for (const part of parts) {
            const list = byCell.get(part.cell.prefix);
            if (list === undefined) byCell.set(part.cell.prefix, [part]); else list.push(part);
        }
        for (const cell of wanted) {
            const from = cell.from.getTime();
            const to = cell.to.getTime();
            const span = spans.get(cell.prefix);
            const kept = span === undefined ? [] : span.entries.filter((entry) => { const t = tileOf(entry).getTime(); return t >= from && t < to; });
            const added = (byCell.get(cell.prefix) ?? []).flatMap((part) => read.get(part.text) ?? []);
            spans.delete(cell.prefix);
            spans.set(cell.prefix, { from, to, entries: added.length === 0 && span !== undefined && span.from === from && span.to === to ? span.entries : [...kept, ...added] });
        }
        // Of the runs wanted no more, the most recently wanted are kept while they fit, so a view going back to them
        // reads nothing (#1797) — the rest let go; and every part counted and read is held now.
        if (spans.size > wanted.length) {
            const prefixes = new Set(wanted.map((cell) => cell.prefix));
            const unwanted = [...spans].filter(([prefix]) => !prefixes.has(prefix));
            const staying = new Set(scheduleSpansKept(unwanted, (left) => left.entries.length).map(([prefix]) => prefix));
            for (const [prefix] of unwanted) if (!staying.has(prefix)) spans.delete(prefix);
        }
        for (const part of parts) {
            this.held.found.delete(part.text);
            read.delete(part.text);
        }
        return this.drawn(args, wanted, spans, capped, items, summary, TILES.find((tile) => kept.has(tile)));
    }

    /**
     * The parts of each run whose tiles are not held: before its span held,
     * and after it — the whole run where none of it is.
     */
    private partsOf(cells: readonly Cell[], lit: Literals): Part[] {
        const spans = this.held!.spans;
        const parts: Part[] = [];
        for (const cell of cells) {
            const from = cell.from.getTime();
            const to = cell.to.getTime();
            const span = spans.get(cell.prefix);
            const pieces: [number, number][] = span === undefined || span.to <= from || span.from >= to ? [[from, to]]
                : [...(from < span.from ? [[from, span.from] as [number, number]] : []), ...(to > span.to ? [[span.to, to] as [number, number]] : [])];
            for (const [low, high] of pieces) {
                const a = lit.tile(new Date(low));
                const b = lit.tile(new Date(high));
                parts.push({ text: `${cell.prefix}\u0002${a}\u0002${b}`, cell, query: variant("range", { from: [...cell.leading, a], to: [...cell.leading, b] }) });
            }
        }
        return parts;
    }

    /**
     * Every part counted: each batch in flight holding one asked again, and
     * the parts in none counted in one more request.
     *
     * @returns Whether every part is counted; `false` while a count is in flight
     */
    private counted(binding: IndexedBindingRead, index: string, parts: readonly Part[]): boolean {
        const held = this.held!;
        const found = held.found;
        return this.asked(parts, (part) => found.has(part.text), held.counting, (batch) => {
            const answer = binding.batches.seekAll(index, batch.map((part) => part.query));
            if (answer.type !== "some") return false;
            batch.forEach((part, i) => found.set(part.text, answer.value[i]!));
            return true;
        });
    }

    /**
     * Every counted part's entries read: each batch in flight holding one
     * asked again, and the parts in none read in one more request, their runs
     * in the index's order.
     *
     * @returns Whether every part's entries are read; `false` while a read is in flight
     */
    private entries(binding: IndexedBindingRead, index: string, parts: readonly Part[]): boolean {
        const held = this.held!;
        const { found, read } = held;
        const counted = parts.filter((part) => {
            if (found.get(part.text)!.count > 0n) return true;
            read.set(part.text, []);
            return false;
        }).sort((a, b) => Number(found.get(a.text)!.row - found.get(b.text)!.row));
        return this.asked(counted, (part) => read.has(part.text), held.reading, (batch) => {
            const runs = binding.batches.runsAll(index, batch.map((part) => found.get(part.text)!));
            if (runs.type !== "some") return false;
            let at = 0;
            for (const part of batch) {
                const n = Number(found.get(part.text)!.count);
                read.set(part.text, (runs.value.slice(at, at + n) as { ik: { value: unknown }; value: option<unknown> }[])
                    .map((entry): Entry => ({ ik: entry.ik.value, value: entry.value.type === "some" ? entry.value.value : null })));
                at += n;
            }
            return true;
        });
    }

    /**
     * Some parts asked of e3 in batches: each batch in flight holding a part
     * not yet answered asked again, the parts in none asked in a batch of their
     * own, and the batches that land let go.
     *
     * @param parts - The parts wanted
     * @param answered - Whether a part is answered
     * @param inFlight - The batches in flight, which this keeps
     * @param ask - Asks a batch: whether it landed, its answers kept
     * @returns Whether every part is answered
     */
    private asked(parts: readonly Part[], answered: (part: Part) => boolean, inFlight: Part[][], ask: (batch: readonly Part[]) => boolean): boolean {
        const missing = new Set(parts.filter((part) => !answered(part)).map((part) => part.text));
        if (missing.size === 0) return true;
        let complete = true;
        const asking = new Set<string>();
        for (const batch of [...inFlight]) {
            if (!batch.some((part) => missing.has(part.text))) continue;
            if (ask(batch)) inFlight.splice(inFlight.indexOf(batch), 1);
            else { complete = false; for (const part of batch) asking.add(part.text); }
        }
        const fresh = parts.filter((part) => missing.has(part.text) && !answered(part) && !asking.has(part.text));
        if (fresh.length > 0 && !ask(fresh)) {
            inFlight.push(fresh);
            complete = false;
        }
        return complete;
    }

    /** How many entries a run holds over its tiles: those held of them, and its parts' counted. */
    private countOf(cell: Cell, parts: readonly Part[]): number {
        const from = cell.from.getTime();
        const to = cell.to.getTime();
        const span = this.held!.spans.get(cell.prefix);
        let n = span === undefined ? 0 : span.entries.filter((entry) => { const t = tileOf(entry).getTime(); return t >= from && t < to; }).length;
        for (const part of parts) if (part.cell === cell) n += Number(this.held!.found.get(part.text)!.count);
        return n;
    }

    /**
     * What the cells held draw: the items encoded, the parents' subtotals, and the rows past the cap shaded or hatched —
     * `summary` the period their totals were read at, `finest` the finest the index keeps them at, which a notice names.
     */
    private drawn(args: PlanNestedArgs, cells: readonly Cell[], held: ReadonlyMap<string, Span>, capped: ReadonlySet<string>,
        items: ReadonlyMap<string, number>, summary: RecordTile | undefined, finest: RecordTile | undefined): Read {
        const binding = indexedBindingOf(args.seam.source)!;
        const lit = literals(binding);
        // Each drafted row's Save, previewed (#1437), put into what is held: an entry's insert or update where a held run's
        // tiles hold it, its delete dropping it — so every number e3 keeps draws with the drafts in place.
        const changes = previewedChanges(args.previews, binding.nested!.index, lit);
        const entriesOf = (cell: Cell): readonly Entry[] => {
            const entries = held.get(cell.prefix)!.entries;
            const ops = changes.get(cell.prefix);
            return ops === undefined ? entries : withChanges(entries, ops, cell, lit);
        };
        // The items, each cell's entries in the order wanted; the fill keeps an item filed in several tiles once.
        const itemCells = cells.filter((cell) => cell.kind === "items" || cell.kind === "subtree");
        const from = itemCells.map((cell) => held.get(cell.prefix)!.entries);
        const last = this.encoded;
        const bytes = last !== undefined && Object.is(last.previews, args.previews) && last.from.length === from.length
            && last.from.every((part, i) => Object.is(part, from[i])) ? last.bytes : lit.encode(itemCells.flatMap(entriesOf));
        this.encoded = { from, previews: args.previews, bytes };
        // Each parent's subtotals: a series a use, in the uses' order.
        const byRow = new Map<string, Map<number, PlanParentSubtotal[]>>();
        for (const cell of cells) {
            if (cell.kind !== "subtotals") continue;
            let uses = byRow.get(cell.row.key);
            if (uses === undefined) { uses = new Map(); byRow.set(cell.row.key, uses); }
            uses.set(cell.use, entriesOf(cell).map((entry): PlanParentSubtotal => ({
                at: variant("time", tileOf(entry)) as PlanParentSubtotal["at"],
                value: (entry.value as { readonly value: number }).value,
            })));
        }
        const parents: PlanParentSubtotals = new Map([...byRow].map(([key, uses]) => [key, [...uses].sort(([a], [b]) => a - b).map(([, series]) => series)] as const));
        // The rows past the cap: their totals at the period read, or the hatch where the index keeps them at none that divides the bucket.
        const shades = new Map<string, Map<string, Map<number, Totals>>>();
        const series = new Map<string, Use>();
        for (const cell of cells) {
            if (cell.kind !== "totals" || cell.row.id.type !== "entry") continue;
            const use = args.seam.uses[cell.use]!;
            const key = cell.row.id.value.series;
            series.set(key, use);
            let rows = shades.get(key);
            if (rows === undefined) { rows = new Map(); shades.set(key, rows); }
            const path = printPathText(cell.row.id.value.path);
            let tiles = rows.get(path);
            if (tiles === undefined) { tiles = new Map(); rows.set(path, tiles); }
            for (const entry of entriesOf(cell)) {
                const totals = (entry.value as { readonly value: { count: bigint; ms: bigint; values: option<Totals["values"] & object> } }).value;
                const at = tileOf(entry).getTime();
                const was = tiles.get(at);
                const values = totals.values.type === "some" ? totals.values.value : undefined;
                tiles.set(at, {
                    count: (was?.count ?? 0) + Number(totals.count), ms: (was?.ms ?? 0) + Number(totals.ms),
                    values: values === undefined ? was?.values : was?.values === undefined ? values
                        : { sum: was.values.sum + values.sum, min: Math.min(was.values.min, values.min), max: Math.max(was.values.max, values.max), last: values.last },
                });
            }
        }
        const buckets = args.buckets ?? [];
        const shading = new SortedMap<string, SortedMap<string, Shade[]>>([], compareString);
        for (const [key, rows] of shades) {
            const use = series.get(key)!;
            shading.set(key, new SortedMap([...rows].map(([path, tiles]) => [path, shadesOf(tiles, buckets, use.shade)] as const), compareString));
        }
        // A place past the cap no totals shade at this resolution: its rows hatched, and the notice — the rows laid out, and the pinned.
        const shown = [...pinnedRows(args.index), ...args.visible];
        const notices: PlanNestedNotice[] = [];
        if (summary === undefined && capped.size > 0) {
            for (const use of args.seam.uses) {
                const place = lit.place(use.place);
                if (!capped.has(place) || notices.some((n) => samePlace(n.place, use.place))) continue;
                notices.push({ place: use.place, items: items.get(place) ?? 0, resolution: finest });
                const rows = shading.get(use.series) ?? new SortedMap<string, Shade[]>([], compareString);
                for (const row of shown) {
                    if (row.id.type === "entry" && stringEqual(row.id.value.series, use.series)) rows.set(printPathText(row.id.value.path), hatchOf(buckets));
                }
                shading.set(use.series, rows);
            }
        }
        // The rows shaded now: their totals read, or hatched.
        const shadedRows = new Set(cells.flatMap((cell) => (cell.kind === "totals" ? [cell.row.key] : [])));
        for (const notice of notices) {
            for (const row of shown) {
                if (row.id.type === "entry" && args.seam.uses.some((use) => samePlace(use.place, notice.place) && stringEqual(use.series, row.id.value.series))) shadedRows.add(row.key);
            }
        }
        this.shadedRows = shadedRows;
        return { cells: bytes, shading: shading as unknown as PlanNestedShadingValue, parents, notices };
    }
}

/** What the reader hands on: what it read, and the rows waiting on a read in flight. */
export interface PlanNestedCells {
    /** What it read; `undefined` before the first read lands. */
    readonly lead: PlanNestedLead | undefined;
    /** The rows waiting on a read in flight, by their keys: the same set while they are the same rows. */
    readonly waiting: ReadonlySet<string>;
}

/**
 * The rows' collections, read a cell at a time (see the module docs), in a
 * tracked evaluation: a search that lands reads again. A read in flight
 * leaves the last standing, and says which rows wait on it; one that throws
 * leaves it too, and says why.
 *
 * @param args - What it reads over
 * @returns What it read, and the rows waiting on a read in flight
 */
export function usePlanNestedCells(args: PlanNestedArgs): PlanNestedCells {
    const [reader] = useState(() => new NestedCellsReader());
    const { seam, visible, index, view, range, buckets, resolution, previews } = args;
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    const read = useCallback(() => reader.read({
        seam, visible, index, view, buckets, resolution, previews,
        range: from === undefined || to === undefined ? undefined : { from: new Date(from), to: new Date(to) },
    }), [reader, seam, visible, index, view, buckets, resolution, previews, from, to]);
    const { result } = useTrackedEvaluation(read);
    const last = useRef<{ read: Read; lead: PlanNestedLead } | undefined>(undefined);
    const waited = useRef(NOTHING_WAITING);
    return useMemo((): PlanNestedCells => {
        if (!result.ok) console.error("[Plan] the rows' nested series could not be read:", result.error);
        const pending = result.ok && isWaiting(result.value) ? result.value.waiting : NOTHING_WAITING;
        // The rows waiting kept as they were while they are the same rows, so the canvas washes them once.
        const waiting = pending.size === waited.current.size && [...pending].every((key) => waited.current.has(key)) ? waited.current : pending;
        waited.current = waiting;
        const was = last.current;
        if (!result.ok || isWaiting(result.value)) {
            return { lead: was === undefined ? undefined : was.lead.reading ? was.lead : { ...was.lead, reading: true }, waiting };
        }
        const next = result.value;
        if (was !== undefined && sameRead(was.read, next)) {
            if (!was.lead.reading) return { lead: was.lead, waiting };
            const lead = { ...was.lead, reading: false };
            last.current = { read: was.read, lead };
            return { lead, waiting };
        }
        const lead: PlanNestedLead = { ...next, version: (was?.lead.version ?? 0) + 1, reading: false };
        last.current = { read: next, lead };
        return { lead, waiting };
    }, [result]);
}

/** Props of {@link PlanNestedReader}. */
export interface PlanNestedReaderProps {
    /** The seam. */
    seam: PlanNestedValue;
    /** The canvas's rows the body lays out, in order. */
    visible: readonly PlanRowValue[];
    /** Every row the canvas holds. */
    index: PlanRowIndex;
    /** The shared scale. */
    scale: PlanScale | undefined;
    /** The rows in view, as the canvas reports them at rest. */
    views: PlanNestedViewStore;
    /** The canvas's editing session, when it edits: each drafted row's Save previewed in what is read (#1437). */
    session?: (RecordDraftsSession & Pick<EditSession<unknown>, "subscribe" | "getSnapshot">) | undefined;
    /** Where what it read goes: called only when it moves. */
    onLead: (lead: PlanNestedLead | undefined) => void;
    /** Where the rows waiting on a read in flight go, by their keys: called only when they move, and with none as it unmounts. */
    onWaiting: (rows: ReadonlySet<string>) => void;
    /** Where the span of the collections the series read, and the read of what those shown hold in each period, go (#1438): called only when they move. */
    onSpan: (span: PlanNestedSpanRead | typeof SPAN_READING | undefined) => void;
}

/**
 * The rows' collections, read in a component of its own: each search that
 * lands re-runs it alone, and it hands the canvas what it read, and the rows
 * waiting on a read in flight, only when they move.
 *
 * @param props - What it reads over, and where it goes
 * @returns Nothing: it reads
 */
export function PlanNestedReader({ seam, visible, index, scale, views, session, onLead, onWaiting, onSpan }: PlanNestedReaderProps): null {
    const view = useSyncExternalStore(views.subscribe, views.get);
    const range = useMemo(() => eventReadRange(scale), [scale]);
    const buckets = useMemo(() => (scale === undefined || range === undefined ? undefined : bucketsOver(scale, range.from, range.to)), [scale, range]);
    const handle = indexedBindingOf(seam.source)?.handle;
    const previews = useRecordDrafts(session === undefined ? undefined : handle, session);
    const { lead, waiting } = usePlanNestedCells({ seam, visible, index, view, range, buckets, resolution: scale?.resolution, previews });
    const reported = useRef<PlanNestedCells>({ lead: undefined, waiting: NOTHING_WAITING });
    useLayoutEffect(() => {
        const was = reported.current;
        if (was.lead === lead && was.waiting === waiting) return;
        reported.current = { lead, waiting };
        if (was.lead !== lead) onLead(lead);
        if (was.waiting !== waiting) onWaiting(waiting);
    });
    // Gone, no row waits on it.
    useLayoutEffect(() => () => onWaiting(NOTHING_WAITING), [onWaiting]);
    // The span of what the series shown read, apart: it moves with the series and a commit, never with the view.
    const span = usePlanNestedSpan(seam, index);
    useLayoutEffect(() => { onSpan(span); }, [span, onSpan]);
    return null;
}

// ============================================================================
// The span of what the series read
// ============================================================================

/** The span of the collections a Plan's series read (#1438): `[from, to)`, in ms. */
export type PlanNestedSpan = readonly [number, number];

/**
 * How much the collections a Plan's series shown read hold in each period
 * (#1438), as e3 keeps it in the index's span at the period: what the
 * horizon's bars count. An item is in the count of each period it touches,
 * once — a quarter's count is e3's own, never its months' added up.
 */
export interface PlanNestedTotals {
    /** The period they are counted by. */
    readonly unit: RecordTile;
    /** Each period's count, by its start in ms: a period nothing touches has none. */
    readonly tiles: ReadonlyMap<number, number>;
}

/**
 * The span's read (#1438): the span of what every series reads — the horizon,
 * whichever are shown (#1440) — the periods the horizon's bars may count by,
 * and the read of their counts.
 */
export interface PlanNestedSpanRead {
    /** `[from, to)`, in ms: from the first period any collection of any series touches to the end of the last, by the finest period the index keeps the record's totals at. */
    readonly span: PlanNestedSpan;
    /** The periods the index keeps the record's totals at, finest first: those the horizon's bars may count by. */
    readonly periods: readonly RecordTile[];
    /**
     * How much the collections the series shown read hold in each period, at one of
     * {@link PlanNestedSpanRead.periods} — nothing while none is shown. A tracked read: an evaluation that reads it runs
     * again when it lands. While a read again is in flight — a commit's, another period's — it answers the last read,
     * at the period that was read by, so the bars hold still until the new counts land; {@link SPAN_READING} before the
     * first lands.
     */
    readonly totals: (period: RecordTile) => PlanNestedTotals | typeof SPAN_READING;
}

/** A span whose read is in flight. */
export const SPAN_READING = "reading";

/** An entry of a nested series index's span, as a read of its runs gives it: its tile, and its totals. */
type SpanEntry = { readonly ik: { readonly value: { readonly tile: Date } }; readonly value: option<{ readonly count: bigint }> };

/** A collection's place, printed as its key. */
const placeKey = (place: readonly string[]): string => place.join("\u0001");

/**
 * Where each collection's tiles at a period are in the index's span (#1438):
 * one batch of searches, each an exact match on a collection's place and the
 * period, which lead its key — the collection's tiles at the period follow, in
 * time order.
 *
 * @param binding - The binding the rows are read through
 * @param places - The collections' places, each by its field names from the row down
 * @param period - The period: one the index keeps the record's totals at
 * @returns Each collection's run, in the places' order, one holding no tile empty; {@link SPAN_READING} while the searches are in flight
 */
function spanRuns(binding: IndexedBindingRead, places: readonly (readonly string[])[], period: RecordTile): readonly Range[] | typeof SPAN_READING {
    const lit = literals(binding);
    const level = lit.level(period);
    const found = binding.batches.seekAll(nestedSpanName(binding.nested!.index),
        places.map((place) => variant("fields", { values: [lit.place(place), level], prefix: none })));
    return found.type === "some" ? found.value : SPAN_READING;
}

/** Two runs in the index's order: a read of runs asks them ascending and disjoint. */
const byRow = (a: Range, b: Range): number => (a.row < b.row ? -1 : a.row > b.row ? 1 : 0);

/**
 * The span of some collections, as the index's span keeps it at a period
 * (#1438): from the first period any of them touches across the record's rows
 * to the end of the last — one batch of searches, and one read of each
 * collection's first tile and its last.
 *
 * @param binding - The binding the rows are read through
 * @param places - The collections' places, each by its field names from the row down
 * @param period - The period: the finest the index keeps the record's totals at
 * @returns `[from, to)`, in ms; {@link SPAN_READING} while a read is in flight; undefined where none holds an item
 */
function spanOf(binding: IndexedBindingRead, places: readonly (readonly string[])[], period: RecordTile): PlanNestedSpan | typeof SPAN_READING | undefined {
    if (places.length === 0) return undefined;
    const runs = spanRuns(binding, places, period);
    if (runs === SPAN_READING) return SPAN_READING;
    const ends = runs.filter((run) => run.count > 0n).sort(byRow).flatMap((run): Range[] => {
        const first = { found: true, row: run.row, count: 1n };
        return run.count > 1n ? [first, { found: true, row: run.row + run.count - 1n, count: 1n }] : [first];
    });
    if (ends.length === 0) return undefined;
    const read = binding.batches.runsAll(nestedSpanName(binding.nested!.index), ends);
    if (read.type !== "some") return SPAN_READING;
    let first = Infinity;
    let last = -Infinity;
    for (const entry of read.value as readonly SpanEntry[]) {
        const at = entry.ik.value.tile.getTime();
        first = Math.min(first, at);
        last = Math.max(last, at);
    }
    return [first, tileNext(period, new Date(last)).getTime()];
}

/**
 * A collection's periods' counts, as the index's span keeps them at a period: each period's start, in ms, and the items
 * and values touching it across the rows, in order.
 */
type SpanCounts = readonly (readonly [number, number])[];

/**
 * How much each collection holds in each period, as the index's span keeps it
 * at the period (#1438): one batch of searches, and one read of their entries,
 * each collection's the next of them in the window that read answers.
 *
 * @param binding - The binding the rows are read through
 * @param places - The collections' places, each by its field names from the row down
 * @param period - The period: one the index keeps the record's totals at
 * @returns Each collection holding an item's periods' counts, by its place's key; {@link SPAN_READING} while a read is in flight
 */
function spanCounts(binding: IndexedBindingRead, places: readonly (readonly string[])[], period: RecordTile): ReadonlyMap<string, SpanCounts> | typeof SPAN_READING {
    const byPlace = new Map<string, SpanCounts>();
    if (places.length === 0) return byPlace;
    const runs = spanRuns(binding, places, period);
    if (runs === SPAN_READING) return SPAN_READING;
    const held = runs.map((run, i) => ({ run, key: placeKey(places[i]!) })).filter(({ run }) => run.count > 0n).sort((a, b) => byRow(a.run, b.run));
    if (held.length === 0) return byPlace;
    const read = binding.batches.runsAll(nestedSpanName(binding.nested!.index), held.map(({ run }) => ({ found: true, row: run.row, count: run.count })));
    if (read.type !== "some") return SPAN_READING;
    const entries = read.value as readonly SpanEntry[];
    let at = 0;
    for (const { run, key } of held) {
        const n = Number(run.count);
        byPlace.set(key, entries.slice(at, at + n).map((entry) => [entry.ik.value.tile.getTime(), entry.value.type === "some" ? Number(entry.value.value.count) : 0] as const));
        at += n;
    }
    return byPlace;
}

/** Whether two reads of a span say the same: its ends, the periods its bars may count by, and the read of their counts. */
function sameSpanRead(a: PlanNestedSpanRead, b: PlanNestedSpanRead): boolean {
    return a.span[0] === b.span[0] && a.span[1] === b.span[1] && a.totals === b.totals
        && a.periods.length === b.periods.length && a.periods.every((period, i) => period === b.periods[i]);
}

/**
 * The span of what every series the canvas lays out reads — the horizon,
 * whichever are shown — and the read of what the series shown hold in each
 * period (#1438, #1440), read again at each revision. The span is read by the
 * finest period the index keeps the record's totals at, each collection's
 * first tile and its last; the counts by the period the horizon draws its bars
 * by, every series' collections together, so switching a series asks nothing:
 * its collections leave the bars, and with none shown the strip still spans
 * what they hold, its bars empty, where it once fell back to the window alone
 * and moved with every drag. While a read again is in flight it is the last
 * read, so the horizon and its bars hold still until the new one lands.
 *
 * @param seam - The root's seam
 * @param index - Every row the canvas holds: its rows' series are the ones shown
 * @returns The span's read; {@link SPAN_READING} while the first read is in flight; undefined where no collection holds
 *   an item, or the index keeps the record's totals at no period
 */
export function usePlanNestedSpan(seam: PlanNestedValue, index: PlanRowIndex): PlanNestedSpanRead | typeof SPAN_READING | undefined {
    // Every place a series reads: one read for them all, whichever series are shown.
    const places = useMemo(() => {
        const out = new Map<string, readonly string[]>();
        for (const use of seam.uses) out.set(placeKey(use.place), use.place);
        return [...out.values()];
    }, [seam]);
    // The places the shown series read, printed as their key: what the bars count.
    const shownKey = useMemo(() => {
        const series = new Set<string>();
        for (const row of index.byKey.values()) if (row.id.type === "entry") series.add(row.id.value.series);
        // In the uses' own order, which a seam keeps: the same places print the same key.
        const keys: string[] = [];
        for (const use of seam.uses) {
            const key = placeKey(use.place);
            if (series.has(use.series) && !keys.includes(key)) keys.push(key);
        }
        return keys.join("\u0002");
    }, [seam, index]);
    const shown = useMemo(() => new Set(shownKey === "" ? [] : shownKey.split("\u0002")), [shownKey]);
    // The periods the index keeps the record's totals at, finest first: the span is read by the finest.
    const periods = useMemo(() => {
        const kept = new Set(seam.totals.map((period) => period.type as RecordTile));
        return TILES.filter((tile) => kept.has(tile));
    }, [seam]);
    const finest = periods[0];
    const read = useCallback(() => {
        const binding = indexedBindingOf(seam.source);
        return binding?.nested === undefined || finest === undefined ? undefined : spanOf(binding, places, finest);
    }, [seam.source, places, finest]);
    const { result } = useTrackedEvaluation(read);
    // What the series shown hold in each period, as the horizon asks it: the last read stands while one again is in flight.
    const counted = useRef<PlanNestedTotals | undefined>(undefined);
    const totals = useCallback((period: RecordTile): PlanNestedTotals | typeof SPAN_READING => {
        const binding = indexedBindingOf(seam.source);
        // No binding to read through holds nothing to count, as it holds no span.
        const byPlace = binding?.nested === undefined ? new Map<string, SpanCounts>() : spanCounts(binding, places, period);
        if (byPlace === SPAN_READING) return counted.current ?? SPAN_READING;
        const tiles = new Map<number, number>();
        for (const [key, counts] of byPlace) {
            if (!shown.has(key)) continue;
            for (const [at, n] of counts) tiles.set(at, (tiles.get(at) ?? 0) + n);
        }
        counted.current = { unit: period, tiles };
        return counted.current;
    }, [seam.source, places, shown]);
    const last = useRef<PlanNestedSpanRead | typeof SPAN_READING | undefined>(SPAN_READING);
    return useMemo(() => {
        if (!result.ok) {
            console.error("[Plan] the span of the rows' nested series could not be read:", result.error);
            return undefined;
        }
        const span = result.value;
        const next = span === SPAN_READING || span === undefined ? span : { span, periods, totals };
        const was = last.current;
        // Read again, the last read holds until the new one lands; the same read as the last is the last, so a reader of
        // it draws once.
        if (next === SPAN_READING && was !== SPAN_READING && was !== undefined) return was;
        if (next !== SPAN_READING && next !== undefined && was !== SPAN_READING && was !== undefined && sameSpanRead(was, next)) return was;
        last.current = next;
        return next;
    }, [result, periods, totals]);
}

// ============================================================================
// Rows read whole
// ============================================================================

/**
 * Rows read whole by their keys (#1438): what a gesture drafts — a row read
 * whole once, on its first change — and what a Save is confirmed by.
 */
export interface PlanWholeRows {
    /**
     * A row whole, encoded as the record holds it, by its id, at the record's
     * revision: `some(some(bytes))`, `some(none)` for a key the record holds no
     * row under, `none` while it is read — asked with every row asked and not
     * yet read, in one request. A tracked read: an evaluation that reads it
     * runs again when it lands.
     */
    read(id: string): option<option<Uint8Array>>;
    /**
     * Several rows whole, each as {@link PlanWholeRows.read} answers it, every
     * one not yet read asked in one request: `none` while any of them is read.
     * A tracked read.
     */
    readAll(ids: readonly string[]): option<ReadonlyMap<string, option<Uint8Array>>>;
}

const encodersOf = new WeakMap<object, (row: unknown) => Uint8Array>();

/** The rows a binding reads whole by key, kept at the record's revision. */
class WholeRows implements PlanWholeRows {
    private held: { revision: string; rows: Map<string, option<Uint8Array>>; asking: Set<string> } | undefined;

    constructor(private readonly source: string) {}

    read(id: string): option<option<Uint8Array>> {
        const all = this.readAll([id]);
        return all.type === "some" ? some(all.value.get(id)!) : none;
    }

    readAll(ids: readonly string[]): option<ReadonlyMap<string, option<Uint8Array>>> {
        const binding = indexedBindingOf(this.source);
        if (binding === undefined) return none;
        const revision = binding.handle.revision();
        if (revision.type !== "some") return none;
        if (this.held === undefined || !stringEqual(this.held.revision, revision.value)) {
            this.held = { revision: revision.value, rows: new Map(), asking: new Set() };
        }
        const held = this.held;
        // Every row asked and not yet read is asked again with these, in one request.
        for (const id of ids) if (!held.rows.has(id)) held.asking.add(id);
        if (held.asking.size > 0) {
            const asking = [...held.asking];
            const read = binding.batches.rowsAll(asking.map((asked) => keyOf(binding, asked)));
            if (read.type !== "some") return none;
            let encode = encodersOf.get(binding.row);
            if (encode === undefined) { encode = encodeBeast2For(binding.row) as (row: unknown) => Uint8Array; encodersOf.set(binding.row, encode); }
            asking.forEach((asked, i) => {
                const row = read.value[i]!;
                held.rows.set(asked, row.type === "some" ? some(encode(row.value)) : none);
                held.asking.delete(asked);
            });
        }
        return some(new Map(ids.map((id) => [id, held.rows.get(id)!])));
    }
}

/** A row's key from its id: a String key as it is, any other read back from its `.east` text. */
function keyOf(binding: IndexedBindingRead, id: string): unknown {
    const key = keyReaderOf(binding.key)(id);
    if (key === undefined) throw new Error(`The row id '${id}' is no key of the record's`);
    return key;
}

/**
 * The rows a Plan over paged rows beside their nested series index reads
 * whole (#1438): what its editing session drafts from.
 *
 * @param seam - The root's seam; `undefined` for a root reading no nested series index
 * @returns The rows read whole; `undefined` without a seam
 */
export function usePlanWholeRows(seam: PlanNestedValue | undefined): PlanWholeRows | undefined {
    const source = seam?.source;
    return useMemo(() => (source === undefined ? undefined : new WholeRows(source)), [source]);
}

// ============================================================================
// The windows drawn with what was read
// ============================================================================

/** No drafted rows. */
const NOTHING_DRAFTED = { drafts: new Map<string, Uint8Array>(), version: 0 };
/** No rows read whole for their links. */
const NO_ROWS_WHOLE: ReadonlyMap<string, Uint8Array> = new Map();

/**
 * The root with its paged rows drawn through the seam (#1438): ONE wrapper per
 * source, as the event kinds' is (`wrapped-source.ts`), each window its lean rows filled with the
 * cells read and the series run over them, the shading in place — its
 * revision naming the reader's version beside the source's own, so the driver
 * reads its windows again when what was read moves, the rows it holds
 * standing in. A window carries no entries (`CarriedWindowType`): its rows are
 * lean, and a gesture drafts from the row read whole by its key
 * ({@link usePlanWholeRows}).
 *
 * @param value - The latest root
 * @param data - Its data-stable twin
 * @param lead - What the reader read; `undefined` before it first lands, or for a root reading no nested series index
 * @param drafted - The session's drafted rows, whole, by id, and their version: each draws in its lean row's place
 * @param readWhole - Rows read whole for the link ends the cells do not hold, by id: each draws whole in its lean
 *   row's place, its runs where their times put them — a drafted row before it
 * @returns The two roots the canvas draws
 */
export function usePlanNestedRoot(value: PlanRootValue, data: PlanRootValue, lead: PlanNestedLead | undefined,
    drafted: { readonly drafts: ReadonlyMap<string, Uint8Array>; readonly version: number } = NOTHING_DRAFTED,
    readWhole: ReadonlyMap<string, Uint8Array> = NO_ROWS_WHOLE): { value: PlanRootValue; data: PlanRootValue } {
    const seam = data.nested.type === "some" ? data.nested.value : undefined;
    const paged = seam !== undefined && lead !== undefined ? windowedSourceOf(value.rows) : undefined;
    const rows = useMemo(() => new SortedMap([...readWhole, ...drafted.drafts], compareString), [readWhole, drafted.drafts]);
    // Which rows are read whole for their links names the revision too, so the windows are read again as they land.
    const whole = useMemo(() => [...readWhole.keys()].join("|"), [readWhole]);
    // A pick's series switched on or off names it too: the window function reads which are on as it draws a window.
    const picked = useSliceReactivity(data.pick.type === "some" ? data.pick.value.key : undefined);
    const wrapped = usePagedWrapper(paged, { lead, seam, rows, version: drafted.version, whole, picked }, (_source, latest) => ({
        page: (offset, limit) => {
            const l = latest();
            if (l.seam === undefined || l.lead === undefined) return none;
            const read = l.seam.rows(offset, limit, l.lead.cells, l.rows, l.lead.shading);
            // A window of lean rows carries no entry: none of them is a row whole, and an edit reads its row whole by key.
            return read.type === "some" ? some({ rows: read.value, entries: [] }) : none;
        },
        // What was read moving is a new revision: the driver reads its windows again, the rows it holds standing in.
        revision: () => {
            const l = latest();
            const r = l.src?.revision?.() ?? none;
            return some(`${r.type === "some" ? r.value : ""}#nested-${l.lead?.version ?? 0}-${l.version}-${l.whole}-${l.picked}`);
        },
        refresh: ownRefresh(latest),
        // The snapshot of the rows themselves, which what is read of them leaves.
        snapshot: ownSnapshot(latest),
    }));
    return usePagedRoots(value, data, wrapped);
}
