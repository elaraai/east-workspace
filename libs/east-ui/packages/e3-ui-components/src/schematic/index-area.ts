/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Index of the item kinds read by area (#1393, `Schematic Builder Spec.md`
 * §8, D52): what no window holds of them, read for the Index alone.
 *
 * - **An open zone's items** are read through each such kind's source by the
 *   zone's box: the area index its window would read through
 *   (`schematicWindowPlan`), the box's cells (`areaCells`) counted, then —
 *   while they hold no more than a window reads — their entries read, each
 *   cell's kept at its revision while an open zone wants it; the narrowing's
 *   choices that index doesn't lead asked of the rows in one `within` (D28).
 *   The rows whose centre the zone holds are its items, nested as every item
 *   is. A zone whose box holds more than a window reads lists none of them,
 *   and says so.
 * - **Their details** are read beside them by the same cells, as the canvas
 *   reads a window's (D45): the details' rows of each cell's entries, every
 *   cell not held in one request of the details' record — the server reading
 *   each entry's key from the area index, none sent — kept at the kind's
 *   revision and the details' while an open zone wants it. So each item's dot
 *   carries its status, and its row its figure, as the canvas draws them
 *   (#1570); a zone's items are listed only once both have landed.
 * - **Its search** reads each such kind through its source's `search` fields
 *   (ruling 11), as a paged tab's search does (`pagedSearchWhere`): a prefix of
 *   the first field that combines with the rail's choices, its first
 *   {@link INDEX_MATCHES} matches read, and how many more it holds said.
 *
 * Nothing it reads is the record whole. Each result is the same object while
 * what it was read from is, and names the revision it read each kind at: what
 * a Save landed of a kind is drawn until the Index reads it since
 * (`drafted.ts`' `landedRead`).
 *
 * @packageDocumentation
 */

import { StringType, equalFor, none, printFor, type ValueTypeOf } from "@elaraai/east";
import { SeekQueryType } from "@elaraai/east-ui";
import { areaCells, type RecordSliceBindType, type RecordSliceCell, type RecordSliceEntry, type RecordSliceJoined } from "@elaraai/east-ui/internal";
import { SCHEMATIC_WINDOW_READ_ROWS, schematicWindowPlan, type SchematicAreaIndexes } from "@elaraai/e3-ui/internal";
import {
    pagedSearchTarget, pagedSearchWhere, recordSliceCellEntries, recordSliceCellJoins, recordSliceCellRuns, recordSliceOnPrinter, recordSlicePage,
    recordSliceRevision, recordSliceWithin,
} from "@elaraai/east-ui-components/internal";
import { defaultPagedRuntime, pagedSourceOf } from "../platform/paged-runtime.js";
import { READING, type Reading } from "./area.js";
import { drawnItem, type DetailsRoles, type DrawnItem, type DrawnZone, type ItemRoles } from "./canvas/drawn.js";
import type { SchematicValue } from "./data.js";
import { kindKeys, type KindKeys } from "../shared/schedule/kind-keys.js";
import { entryRow, type KindRows } from "./kind-rows.js";
import { RowMaking, type StoredRows } from "./made-rows.js";

/** A kind's source of the slice. */
type Part = ValueTypeOf<RecordSliceBindType>;
/** An item kind, decoded. */
type ItemKind = SchematicValue["items"][number];

const stringEqual = equalFor(StringType);
const printQuery = printFor(SeekQueryType);

/** A cell's details of none: no entry of it has a details row. */
const NO_JOINED: readonly RecordSliceJoined[] = [];

/** A kind's details' rows read by the cells an open zone's items were read by (D45), at the kind's revision and the details'. */
interface Joined {
    /** The `id` of the details' paged read. */
    readonly dict: string;
    /** The kind's revision the cells were read at. */
    readonly revision: string;
    /** The details' revision their rows were read at. */
    readonly details: string;
    /** Each cell's rows of the details, by its name, while an open zone wants it. */
    readonly cells: Map<string, readonly RecordSliceJoined[]>;
}

/** Lets go of the cells no open zone wants of one kind's, through every index: an index it reads none through, whole. */
function forgetCells<C>(byIndex: Map<string, { readonly cells: Map<string, C> }> | undefined, wanted: ReadonlyMap<string, ReadonlySet<string>>): void {
    if (byIndex === undefined) return;
    for (const [index, kept] of [...byIndex]) {
        const ids = wanted.get(index);
        if (ids === undefined) { byIndex.delete(index); continue; }
        for (const id of [...kept.cells.keys()]) if (!ids.has(id)) kept.cells.delete(id);
    }
}

/** The most matches of a search the Index reads a kind: past them, it says how many more there are. */
export const INDEX_MATCHES = 50;

/** An item kind read by area: the kind, its source of the slice and its area indexes. */
export interface IndexAreaKind {
    /** The kind. */
    readonly kind: ItemKind;
    /** Its source of the slice. */
    readonly part: Part;
    /** Its area indexes. */
    readonly areas: SchematicAreaIndexes;
}

/** What the Index read of the item kinds read by area. */
export interface IndexAreaRead {
    /** Their items: the open zones', or the search's matches — each once. */
    readonly items: readonly DrawnItem[];
    /** The zones whose box was read, by id: what they hold of those kinds is whole. */
    readonly read: ReadonlySet<string>;
    /** The zones whose box holds more than a window reads, by id: they list none of those kinds' items. */
    readonly crowded: ReadonlySet<string>;
    /** How many matches of the search those kinds hold past those read. */
    readonly more: number;
    /** The revision each kind was read at, by its slot. */
    readonly revisions: ReadonlyMap<string, string>;
}

/** Nothing read: no kind read by area, or no zone open and no search. */
export const NO_INDEX_AREA: IndexAreaRead = { items: [], read: new Set(), crowded: new Set(), more: 0, revisions: new Map() };

/** A zone's box, in world units. */
function boxOf(zone: DrawnZone): { minX: number; minY: number; maxX: number; maxY: number } {
    return { minX: zone.x, minY: zone.y, maxX: zone.x + zone.width, maxY: zone.y + zone.height };
}

/** Whether two lists of what a result was read from are the same parts, in order. */
function sameFrom(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length === b.length && a.every((part, i) => Object.is(part, b[i]));
}

/** The Index's reads of the item kinds read by area, kept across reads — see the module docs. */
export class SchematicIndexArea {
    /** Each kind's cells' entries, by its slot, then by the index they were read through, at a revision: those an open zone wants. */
    private readonly kept = new Map<string, Map<string, { readonly revision: string; readonly cells: Map<string, RecordSliceEntry[]> }>>();
    /** Each kind's cells' details, by its slot, then by the index they were read through (D45): those an open zone wants. */
    private readonly joined = new Map<string, Map<string, Joined>>();
    /** What the details' `rowsOf` has made of their rows: all a read asks for, at once, since the Index draws them in one pass. */
    private readonly making = new RowMaking();
    /** The last result, and what it was read from. */
    private last: { readonly from: readonly unknown[]; readonly result: IndexAreaRead } | undefined;

    /**
     * @param rows - The kinds' rows as their `rowsOf` makes them, shared with the paged Backlog: what a gesture on one rewrites
     */
    constructor(private readonly rows: KindRows<ItemRoles>) {}

    /**
     * What the Index reads of the kinds: the open zones' items, or — searching — the matches.
     *
     * @param kinds - The item kinds read by area
     * @param open - The zones open in the Index
     * @param query - The Index's search; empty, none
     * @returns What it read; {@link READING} while a count, a page or an answer is read
     */
    read(kinds: readonly IndexAreaKind[], open: readonly DrawnZone[], query: string): IndexAreaRead | Reading {
        if (kinds.length === 0 || (open.length === 0 && query === "")) return NO_INDEX_AREA;
        const from: unknown[] = [query];
        const items = new Map<string, DrawnItem>();
        const read = new Set<string>();
        const crowded = new Set<string>();
        const revisions = new Map<string, string>();
        let more = 0;
        for (const kind of kinds) {
            const revision = recordSliceRevision(kind.part);
            if (revision.type !== "some") return READING;
            from.push(kind.kind, revision.value);
            revisions.set(kind.kind.key, revision.value);
            const got = query === ""
                ? this.zones(kind, revision.value, open, from, read, crowded)
                : this.search(kind, revision.value, query, from);
            if (got === READING) return READING;
            for (const item of got.items) items.set(item.key, item);
            more += got.more;
        }
        const last = this.last;
        if (last !== undefined && sameFrom(last.from, from)) return last.result;
        const result = { items: [...items.values()], read, crowded, more, revisions };
        this.last = { from, result };
        return result;
    }

    /** A kind's items in the open zones: each zone's box's cells counted, then read while they hold no more than a window reads. */
    private zones(kind: IndexAreaKind, revision: string, open: readonly DrawnZone[], from: unknown[], read: Set<string>, crowded: Set<string>):
        { readonly items: readonly DrawnItem[]; readonly more: number } | Reading {
        const where = kind.part.read().where;
        const keys = kindKeys(kind.kind.keyType);
        const items: DrawnItem[] = [];
        const wanted = new Map<string, Set<string>>();
        for (const zone of open) {
            const box = boxOf(zone);
            const plan = schematicWindowPlan(kind.areas, where, box);
            const index = plan.index.name;
            const printOn = recordSliceOnPrinter(kind.part, index);
            const cells: RecordSliceCell[] = plan.prefixes.flatMap((prefix) => areaCells(prefix, box, plan.cell, printOn))
                .map((place) => ({ id: printQuery(place.query), queries: [place.query] }));
            // Counted first, in one request: a zone holding more than a window reads lists none of the kind's items.
            const runs = recordSliceCellRuns(kind.part, index, cells);
            if (runs.type !== "some") return READING;
            let total = 0n;
            for (const cell of cells) total += runs.value.get(cell.id)?.total ?? 0n;
            if (total > BigInt(SCHEMATIC_WINDOW_READ_ROWS)) { crowded.add(zone.key); continue; }
            // The entries and their details asked together: neither waits on the other's answer.
            const entries = this.entriesOf(kind, index, revision, cells);
            const details = this.detailsOf(kind, index, revision, cells, keys);
            if (entries === READING || details === READING) return READING;
            let ids = wanted.get(index);
            if (ids === undefined) { ids = new Set(); wanted.set(index, ids); }
            for (const cell of cells) ids.add(cell.id);
            // Each row once, as the cells hold it, by its key's text (#1549).
            const rows = new Map<string, { readonly key: unknown; readonly row: unknown }>();
            for (const cell of entries) for (const entry of cell) rows.set(keys.textOf(entry.key), { key: entry.key, row: entryRow(entry) });
            const listed = [...rows].map(([key, { row }]) => ({ key, row }));
            // The narrowing's choices the index doesn't lead, asked of the rows in one request (D28), each by its key.
            let held: readonly boolean[] | undefined;
            if (plan.residual.length > 0 && listed.length > 0) {
                const answer = recordSliceWithin(kind.part, where, [...rows.values()]);
                if (answer.type !== "some") return READING;
                held = answer.value;
            }
            // The answers as one text: the same while they are.
            from.push(zone.key, ...entries, ...(details?.joined ?? []), held === undefined ? "" : held.map((inside) => (inside ? "1" : "0")).join(""));
            const made = this.rows.rowsOf(kind.kind, revision, listed);
            listed.forEach(({ key }, i) => {
                if (held !== undefined && held[i] !== true) return;
                // Its details' roles, as the canvas draws them beside its own: a row of no details row draws its own alone.
                const own = details?.rows.get(key)?.roles as DetailsRoles | undefined;
                const item = drawnItem({ kind: kind.kind.key, key }, made.get(key)!.roles, own);
                // The zone's items: those whose centre it holds.
                if (item !== undefined && item.x >= box.minX && item.x <= box.maxX && item.y >= box.minY && item.y <= box.maxY) items.push(item);
            });
            read.add(zone.key);
        }
        this.forget(kind.kind.key, wanted);
        return { items, more: 0 };
    }

    /** A kind's search through its source's `search` fields: its first {@link INDEX_MATCHES} matches, and how many more. */
    private search(kind: IndexAreaKind, revision: string, query: string, from: unknown[]): { readonly items: readonly DrawnItem[]; readonly more: number } | Reading {
        const where = kind.part.read().where;
        const target = pagedSearchTarget(kind.part.config, where);
        // No field to search, or the rail's choices block every one: the search finds none of the kind's.
        if (target?.field === undefined) return { items: [], more: 0 };
        const within = pagedSearchWhere(target.field, where, query);
        if (within === null) return { items: [], more: 0 };
        // A read of the search's narrowing alone, never a read by area (#1432).
        const count = kind.part.countWhere({ where: within, area: none });
        if (count.type !== "some") return READING;
        const page = recordSlicePage(kind.part, { where: within, area: none }, 0n, BigInt(INDEX_MATCHES));
        if (page.type !== "some") return READING;
        const entries = page.value as RecordSliceEntry[];
        from.push(count.value, ...entries);
        const keys = kindKeys(kind.kind.keyType);
        const listed = entries.map((entry) => ({ key: keys.textOf(entry.key), row: entryRow(entry) }));
        const made = this.rows.rowsOf(kind.kind, revision, listed);
        const items: DrawnItem[] = [];
        for (const { key } of listed) {
            // A match with no position is the Backlog's.
            const item = drawnItem({ kind: kind.kind.key, key }, made.get(key)!.roles, undefined);
            if (item !== undefined) items.push(item);
        }
        return { items, more: Math.max(0, Number(count.value) - listed.length) };
    }

    /** Some cells' entries through an index at a revision: those not held read in one request. */
    private entriesOf(kind: IndexAreaKind, index: string, revision: string, cells: readonly RecordSliceCell[]): (readonly RecordSliceEntry[])[] | Reading {
        let byIndex = this.kept.get(kind.kind.key);
        if (byIndex === undefined) { byIndex = new Map(); this.kept.set(kind.kind.key, byIndex); }
        let kept = byIndex.get(index);
        if (kept === undefined || !stringEqual(kept.revision, revision)) {
            kept = { revision, cells: new Map() };
            byIndex.set(index, kept);
        }
        const held = kept.cells;
        const missing = cells.filter((cell) => !held.has(cell.id));
        if (missing.length > 0) {
            const got = recordSliceCellEntries(kind.part, index, missing);
            if (got.type !== "some") return READING;
            for (const cell of missing) held.set(cell.id, got.value.get(cell.id) ?? []);
        }
        return cells.map((cell) => held.get(cell.id)!);
    }

    /**
     * Some cells' details' rows (D45), as the canvas reads a window's (`area.ts`' `detailsOf`): the details' rows of the
     * cells' entries through an index — those not held read in one request of the details' record, the server reading
     * each entry's key from the index, none sent — kept at the kind's revision and the details', made their stored rows.
     *
     * @param kind - The kind
     * @param index - The area index the cells are of
     * @param revision - The kind's revision the cells' entries were read at
     * @param cells - The cells
     * @param keys - The kind's keys, which its details are keyed as: each details row by its key's text (#1549)
     * @returns The cells' rows of the details, in order, and the rows made of them, by key; `undefined` for a kind with
     *   no details, or details read by no paged read; {@link READING} while the details' revision or a cell's rows are read
     * @throws {Error} When the details' paged read is bound on no page this runtime serves
     */
    private detailsOf(kind: IndexAreaKind, index: string, revision: string, cells: readonly RecordSliceCell[], keys: KindKeys):
        { readonly joined: readonly (readonly RecordSliceJoined[])[]; readonly rows: StoredRows } | Reading | undefined {
        const details = kind.kind.details;
        if (details.type !== "some" || details.value.paged.type !== "some") return undefined;
        const dict = details.value.paged.value;
        const source = pagedSourceOf(dict);
        if (source === undefined) throw new Error(`The details' paged read '${dict}' is bound on no page this runtime serves`);
        const at = defaultPagedRuntime.revisionOf(source);
        if (at.type !== "some") return READING;
        let byIndex = this.joined.get(kind.kind.key);
        if (byIndex === undefined) { byIndex = new Map(); this.joined.set(kind.kind.key, byIndex); }
        let kept = byIndex.get(index);
        if (kept === undefined || !stringEqual(kept.dict, dict) || !stringEqual(kept.revision, revision) || !stringEqual(kept.details, at.value)) {
            kept = { dict, revision, details: at.value, cells: new Map() };
            byIndex.set(index, kept);
        }
        const held = kept.cells;
        const missing = cells.filter((cell) => !held.has(cell.id));
        if (missing.length > 0) {
            const got = recordSliceCellJoins(kind.part, index, missing, dict);
            if (got.type !== "some") return READING;
            for (const cell of missing) held.set(cell.id, got.value.get(cell.id) ?? NO_JOINED);
        }
        const joined = cells.map((cell) => held.get(cell.id)!);
        const present = new Map<string, unknown>();
        for (const cell of joined) for (const entry of cell) if (entry.row.type === "some") present.set(keys.textOf(entry.key), entry.row.value);
        // No budget is begun, so every row is made in this read.
        const rows = this.making.make(details.value, present);
        return rows === undefined ? READING : { joined, rows };
    }

    /** Lets go of the cells of a kind no open zone wants, its entries' and its details', through every index. */
    private forget(slot: string, wanted: ReadonlyMap<string, ReadonlySet<string>>): void {
        forgetCells(this.kept.get(slot), wanted);
        forgetCells(this.joined.get(slot), wanted);
    }
}
