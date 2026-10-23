/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Schematic kind read by area (#1393, `Schematic Builder Spec.md` §10.4,
 * D25, D41): its viewport's window read from an area index alone, a cell at a
 * time, as the Plan's events are read (`plan/root/cells.ts`, #1039).
 *
 * # The window
 *
 * The canvas writes where its viewport rests — its box, its zoom and the tier
 * its items draw at — to a store of its own ({@link createViewportStore}),
 * rendering nothing for it. A kind's window is that viewport padded by the
 * largest card's half size at the zoom ({@link windowOf}), so a card whose
 * centre lies just outside still draws; it holds while the viewport stays
 * inside the box its searches reach — the window grown by its margin — and is
 * at least half its size ({@link windowHolds}), so a pan or a zoom inside the
 * margin reads nothing.
 *
 * # What it reads
 *
 * e3-ui's planner names the area index a window reads and its leading values
 * (`schematicWindowPlan`, SC34); each of the window's searches (`areaQueries`)
 * is a cell. Every cell not yet found goes in one request, counted before an
 * entry is read; while they hold at most `SCHEMATIC_WINDOW_ROWS`, the entries
 * of the cells not held go in one read of their runs, each cell's kept at the
 * revision it was read at while the window wants it — so a window into new
 * cells searches and reads only those. A narrowing the index doesn't lead is
 * asked of the window's rows, and of the far ends read beside them, in one
 * `within` (D28), each row's answer kept for its revision and narrowing; under
 * `narrowed="dim"` every row is read, and `within` says which match.
 *
 * Past `SCHEMATIC_WINDOW_ROWS`, the density (D25): one request finds the
 * bounds of the raster's cells — the level whose cells are about a
 * sixty-fourth of the window's reach — and of the coarser levels' cells, by
 * their exact keys (`schematicRaster`). The coarser levels' rows, boxes larger
 * than half a raster cell, are read as rows while they number no more than a
 * window draws, in one read of their runs; past that they are spread over the
 * raster cells their cells cover (`schematicDensityCells`), and no row is read.
 * No search of the density is kept as a cell: the source's cells are the
 * window's alone. The footer says how many rows it shades in the viewport
 * ({@link densityInView}).
 *
 * Its items' details are read at every tier — a dot draws its item's status
 * too (D45) — by the runs its window's rows were read by: the window's cells,
 * or at density the coarser levels' runs, every cell not held in one request
 * of the details' record, the server reading each entry's key from the area
 * index, none sent (`recordSliceCellJoins`); each cell's kept at the kind's
 * revision and the details' while the window wants it, so a pan reads only the
 * cells it adds, and a commit to the details reads them again. The far ends of
 * the links and nets that touch the window are read by key, a request a kind,
 * through the kind's own paged read — whether or not its source joins its rows.
 *
 * # What it keeps
 *
 * Each kind's state across reads (`Slot`): its window, its plan and its cells,
 * what each was read from — and every result the same object while what it
 * was read from is, so a read that lands elsewhere, or a viewport resting
 * inside the window, plans nothing, asks nothing, makes nothing and hands the
 * frame nothing new.
 *
 * @packageDocumentation
 */

import {
    ArrayType, IntegerType, StringType, StructType, compareFor, encodeBeast2For, equalFor, fromEastTypeValue, printFor,
    type StructType as StructTypeOf, type ValueTypeOf,
} from "@elaraai/east";
import { SeekQueryType, type SeekRangeType } from "@elaraai/east-ui";
import {
    RecordSliceWhereType, areaQueries, type RecordSliceBindType, type RecordSliceCell, type RecordSliceEntry, type RecordSliceJoined,
} from "@elaraai/east-ui/internal";
import {
    SCHEMATIC_WINDOW_ROWS, schematicDensityCells, schematicRaster, schematicWindowPlan,
    type SchematicAreaIndexes, type SchematicDensityCell, type SchematicRaster, type SchematicWindowPlan,
} from "@elaraai/e3-ui/internal";
import {
    recordSliceBounds, recordSliceCellEntries, recordSliceCellJoins, recordSliceCellRuns, recordSliceRevision, recordSliceRunEntries,
    recordSliceRunJoins, recordSliceWithin,
} from "@elaraai/east-ui-components/internal";
import { defaultPagedRuntime, pagedSourceOf, type PagedRow } from "../platform/paged-runtime.js";
import { SCHEMATIC_CARD_MAX_PX, type LodTier, type WorldBox } from "./canvas/model.js";
import type { SchematicValue } from "./data.js";

/** An item kind or a zone kind: what reads by area. */
export type SchematicAreaKind = SchematicValue["items"][number] | SchematicValue["zones"][number];
/** A kind's source of the slice. */
type Part = ValueTypeOf<RecordSliceBindType>;
/** A record Slice's narrowing, decoded. */
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
/** A kind's details, closed. */
type Details = Extract<SchematicAreaKind["details"], { type: "some" }>["value"];
/** One key search, decoded. */
type Query = ValueTypeOf<typeof SeekQueryType>;
/** One search's bounds, decoded. */
type Range = ValueTypeOf<typeof SeekRangeType>;
/** A kind's stored rows, by key: each one's roles beside its bytes. */
type StoredRows = ReadonlyMap<string, { readonly roles: unknown; readonly row: Uint8Array }>;

const stringEqual = equalFor(StringType);
const rowOrder = compareFor(IntegerType);
const printQuery = printFor(SeekQueryType);
const printWhere = printFor(RecordSliceWhereType);

/** A read still in flight. */
export const READING = "reading";
/** A read still in flight. */
export type Reading = typeof READING;

// ============================================================================
// The viewport and the window
// ============================================================================

/** Where the canvas's viewport rests (#1393): what a kind read by area reads its window around. */
export interface SchematicViewport {
    /** Its box, in world units. */
    readonly box: WorldBox;
    /** Its pixels per world unit. */
    readonly ppu: number;
    /** The tier its items draw at: their cards' details are read at card and label zoom. */
    readonly lod: LodTier;
}

/** Where the canvas's viewport rests, as the canvas reports it to the reader: a store of one viewport. */
export interface SchematicViewportStore {
    /** The viewport last reported; `undefined` before any is. */
    get(): SchematicViewport | undefined;
    /** Reports where the viewport rests: one the store holds already moves nothing. */
    set(viewport: SchematicViewport): void;
    /** Listens for a viewport that moves; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

/**
 * A store of where the canvas's viewport rests (#1393): the canvas writes it
 * as its camera comes to rest, and the reader, a component of its own, reads
 * it — the canvas renders nothing for it, as the Plan's span store does.
 *
 * @returns The store
 */
export function createViewportStore(): SchematicViewportStore {
    let viewport: SchematicViewport | undefined;
    const listeners = new Set<() => void>();
    const same = (a: SchematicViewport, b: SchematicViewport) => a.ppu === b.ppu && a.lod === b.lod
        && a.box.minX === b.box.minX && a.box.minY === b.box.minY && a.box.maxX === b.box.maxX && a.box.maxY === b.box.maxY;
    return {
        get: () => viewport,
        set(next) {
            if (viewport !== undefined && same(viewport, next)) return;
            viewport = next;
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

/**
 * How far past the viewport a card or a labelled pin whose centre lies outside still draws, in screen pixels: half the
 * widest one ({@link SCHEMATIC_CARD_MAX_PX}), each shorter than it is wide. A card drawn at its item's own width spans
 * that box, which the area index files its row by (SC34), and reaches past it by less.
 */
export const SCHEMATIC_CARD_REACH_PX = SCHEMATIC_CARD_MAX_PX / 2;

/** A dot's reach past the viewport, in screen pixels: its marker and its ring. */
const DOT_REACH_PX = 10;

/** A kind's window (§10.4): the viewport padded by the largest card's half size, and the box its searches reach. */
export interface SchematicWindow {
    /** The viewport padded by the largest card's half size at its zoom: what its searches are planned over. */
    readonly box: WorldBox;
    /** The box its searches hold: the padded viewport grown by an eighth of its larger side on each side (`areaQueries`'s margin). */
    readonly reach: WorldBox;
}

/** A box's larger side. */
function larger(box: WorldBox): number {
    return Math.max(box.maxX - box.minX, box.maxY - box.minY);
}

/**
 * A viewport's window (§10.4): the viewport padded by the largest card's half
 * size at its zoom — a dot's at dot zoom — and the box its searches reach.
 *
 * @param viewport - Where the viewport rests
 * @returns Its window
 */
export function windowOf(viewport: SchematicViewport): SchematicWindow {
    const pad = (viewport.lod === "dot" ? DOT_REACH_PX : SCHEMATIC_CARD_REACH_PX) / viewport.ppu;
    const { minX, minY, maxX, maxY } = viewport.box;
    const box = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    const margin = larger(box) / 8;
    return { box, reach: { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin } };
}

/**
 * Whether a window holds for a viewport (§10.4): its padded box lies inside
 * the window's reach and is at least half the window's size, so a pan or a
 * zoom inside the margin reads nothing, and a zoom in by more than half plans
 * the window again at its finer cells.
 *
 * @param window - The window read
 * @param viewport - Where the viewport rests now
 * @returns Whether the window still holds
 */
export function windowHolds(window: SchematicWindow, viewport: SchematicViewport): boolean {
    const next = windowOf(viewport).box;
    const { reach } = window;
    return next.minX >= reach.minX && next.minY >= reach.minY && next.maxX <= reach.maxX && next.maxY <= reach.maxY
        && larger(next) >= larger(window.box) / 2;
}

// ============================================================================
// The reads
// ============================================================================

/** A kind's rows read by area: each row's decoded value, by its key. */
export type SchematicAreaRows = ReadonlyMap<string, unknown>;

/** A density raster, as the canvas draws it (D25): its cells holding rows, each its corner and how many. */
export interface SchematicDensity {
    /** Its cells' side, in world units. */
    readonly side: number;
    /** Its cells that hold rows: each its left edge, its top and how many rows it holds. */
    readonly cells: readonly SchematicDensityCell[];
    /** The most rows a cell holds: what the raster's shading is scaled to. */
    readonly most: number;
    /** The box its cells cover, in world units: its window's reach. */
    readonly box: WorldBox;
    /** Whether the coarser levels' rows are spread over its cells, each cell's count then holding a share of theirs. */
    readonly spread: boolean;
    /** Whether a narrowing the index doesn't lead is left out of it, which the footer says. */
    readonly unnarrowed: boolean;
}

/** How many rows a density shades in a box (#1393): what the footer says of a kind drawn as its density. */
export interface SchematicDensityInView {
    /**
     * How many: every row of each cell inside the box, and the box's share of each cell it cuts — the cell's rows held
     * evenly over its part in the drawing's extent — whole below a hundred and to two significant figures above, where it
     * is not exact.
     */
    readonly rows: number;
    /** Whether that is exact: every cell the box meets lies inside it, the density covers the box, and no coarser level's rows are spread. */
    readonly exact: boolean;
}

/**
 * How many rows a density shades in a box (#1393, D25) — the viewport's, where
 * it rests: what the footer says of a kind drawn as its density. A cell's rows
 * lie in its part of the drawing's extent, as Issues holds every item to the
 * extent, so a cell reaching past the extent's edge lies in the box while its
 * part in the extent does: the view Fit leaves, the extent edge to edge, counts
 * every row exactly whatever cell the extent's edge cuts. A cell wholly outside
 * the extent holds rows only where they stand outside it, and is taken whole. A
 * cell the box cuts gives the box its share of the cell's rows, as the density
 * holds a coarser cell's rows evenly over the cells it covers; a count that
 * takes a share is an estimate, said to two significant figures.
 *
 * @param density - The kind's density
 * @param box - The box, in world units
 * @param extent - The drawing's extent, in world units
 * @returns How many rows it shades in the box, and whether that is exact
 */
export function densityInView(density: SchematicDensity, box: WorldBox, extent: WorldBox): SchematicDensityInView {
    const { side, box: covered } = density;
    let exact = !density.spread && box.minX >= covered.minX && box.minY >= covered.minY && box.maxX <= covered.maxX && box.maxY <= covered.maxY;
    let rows = 0;
    for (const cell of density.cells) {
        // The cell's rows lie in its part of the extent; a cell outside the extent holds them where they stand.
        const whole = { minX: cell.minX, minY: cell.minY, maxX: cell.minX + side, maxY: cell.minY + side };
        const part = overlap(whole, extent) ?? whole;
        const seen = overlap(part, box);
        if (seen === undefined) continue;
        if (part.minX >= box.minX && part.maxX <= box.maxX && part.minY >= box.minY && part.maxY <= box.maxY) {
            rows += cell.count;
            continue;
        }
        exact = false;
        rows += cell.count * ((seen.maxX - seen.minX) / (part.maxX - part.minX)) * ((seen.maxY - seen.minY) / (part.maxY - part.minY));
    }
    return { rows: exact ? rows : roughly(rows), exact };
}

/** Where two boxes overlap, with an area; `undefined` where they only touch, or not at all. */
function overlap(a: WorldBox, b: WorldBox): WorldBox | undefined {
    const minX = Math.max(a.minX, b.minX), minY = Math.max(a.minY, b.minY), maxX = Math.min(a.maxX, b.maxX), maxY = Math.min(a.maxY, b.maxY);
    return minX < maxX && minY < maxY ? { minX, minY, maxX, maxY } : undefined;
}

/** An estimate's count, as it is said: whole below a hundred, else to two significant figures. */
function roughly(n: number): number {
    if (n < 100) return Math.round(n);
    const unit = 10 ** (Math.floor(Math.log10(n)) - 1);
    return Math.round(n / unit) * unit;
}

/** A kind's window as it was read, before its narrowing is asked of it (#1393). */
export interface SchematicWindowRead {
    /** The plan it was read by. */
    readonly plan: SchematicWindowPlan;
    /** The revision it was read at. */
    readonly revision: string;
    /** Its rows, by key: the window's — or, at density, the coarser levels' — the narrowing not yet asked of them. */
    readonly rows: SchematicAreaRows;
    /** Its density, past the rows a window draws; `undefined` while it draws items. */
    readonly density: SchematicDensity | undefined;
    /** Where its rows were read from in its index, which its details are read by (D45): its cells, or at density the coarser levels' runs. */
    readonly at: { readonly cells: readonly RecordSliceCell[] } | { readonly runs: readonly Range[] };
    /** What its rows were read from: the same parts, the same rows. */
    readonly from: readonly unknown[];
}

/** A kind's rows read by area, the narrowing asked of them (#1393). */
export interface SchematicAreaRead {
    /** The rows it draws, by key: within its narrowing — every one read under `narrowed="dim"`. */
    readonly rows: SchematicAreaRows;
    /**
     * The rows its narrowing holds, while one narrows it: under `narrowed="dim"` those `within` answered for, else every
     * row it draws; `undefined` while nothing narrows it.
     */
    readonly matched: ReadonlySet<string> | undefined;
    /** What its rows were read from: the same parts, the same rows. */
    readonly from: readonly unknown[];
}

/** An entry's row: its joined row, or the whole row its index carries (D29). */
function rowOf(entry: RecordSliceEntry): unknown {
    if (entry.row?.type === "some") return entry.row.value;
    if (entry.value?.type === "some") return entry.value.value;
    return undefined;
}

/** No narrowing: under `narrowed="dim"`, a window reads every row. */
const NO_WHERE: Where = new Map();

/** No rows. */
const NO_ROWS: SchematicAreaRows = new Map();

/** No entries: the coarser levels' while none holds a row, or while their rows are spread. */
const NO_ENTRIES: readonly RecordSliceEntry[] = [];

/** No runs: the coarser levels' while none holds a row, or while their rows are spread. */
const NO_RUNS: readonly Range[] = [];

/** No details' rows: a cell's, or runs', that hold no entry. */
const NO_JOINED: readonly RecordSliceJoined[] = [];

/** The most within answers a kind keeps at a revision and a narrowing, past which those of rows no longer read go. */
const MAX_KEPT_ANSWERS = 20_000;

/** Each kind's encoder of the rows it read, as its `rowsOf` takes them: an Array of `{ key, row }`. */
type RowsEncoder = (read: { key: string; row: unknown }[]) => Uint8Array;

/** A window's plan, and its searches as the cells it reads: for the source's config, the narrowing and the window they were planned for. */
interface Planned {
    readonly config: unknown;
    readonly where: Where;
    readonly window: SchematicWindow;
    readonly plan: SchematicWindowPlan;
    readonly cells: readonly RecordSliceCell[];
}

/** A window's density raster: its plan's, over its reach, and its searches — its cells' ranges, then the coarser levels' keys. */
interface Rastered {
    readonly planned: Planned;
    readonly raster: SchematicRaster;
    readonly cells: number;
    readonly queries: readonly Query[];
}

/**
 * A kind's details' rows read by the runs its window's rows were read by (D45), at the kind's revision and the details':
 * each cell's, and the coarser levels' runs' at density.
 */
interface Joined {
    /** The `id` of the details' paged read. */
    readonly dict: string;
    /** The index the runs are of. */
    readonly index: string;
    /** The kind's revision the runs were found at. */
    readonly revision: string;
    /** The details' revision their rows were read at. */
    readonly details: string;
    /** Each cell's rows of the details, by its name, while the window wants it. */
    readonly cells: Map<string, readonly RecordSliceJoined[]>;
    /** The coarser levels' runs' rows of the details, for the runs they were read by. */
    runs: { readonly runs: readonly Range[]; readonly joined: readonly RecordSliceJoined[] } | undefined;
}

/** What the reader holds of one kind read by area, across reads: each part beside what it was read from. */
interface Slot {
    /** The window it holds. */
    window?: SchematicWindow;
    /** Its window's plan and cells. */
    planned?: Planned;
    /** How many entries its window's cells hold, found at a revision. */
    found?: { readonly revision: string; readonly planned: Planned; readonly total: bigint };
    /** Each cell's entries, read through an index at a revision. */
    kept?: { readonly index: string; readonly revision: string; readonly cells: Map<string, RecordSliceEntry[]> };
    /** Its density's raster. */
    rastered?: Rastered;
    /** The raster's searches' bounds, found at a revision. */
    bounds?: { readonly revision: string; readonly raster: SchematicRaster; readonly found: readonly Range[] };
    /** The coarser levels' rows, read for the bounds they were found by, and the runs they were read by. */
    coarse?: { readonly found: readonly Range[]; readonly runs: readonly Range[]; readonly entries: readonly RecordSliceEntry[] };
    /** The density it last drew. */
    density?: SchematicDensity;
    /** Its window as it was last read, for its plan and its revision. */
    read?: { readonly planned: Planned; readonly revision: string; readonly read: SchematicWindowRead };
    /** Its far ends' rows, as the read by key gave them. */
    far?: { readonly read: readonly PagedRow[]; readonly rows: SchematicAreaRows };
    /** The narrowing's answers, at a revision and a narrowing. */
    answers?: { readonly revision: string; readonly where: string; held: ReadonlyMap<string, boolean> };
    /** Its rows, the narrowing asked of them, for what they were read from. */
    narrowed?: { readonly read: SchematicWindowRead; readonly far: SchematicAreaRows; readonly where: Where; readonly dim: boolean; readonly result: SchematicAreaRead };
    /** Its rows made its stored rows: and what they were made from — the kind itself among it, whose accessors make the roles. */
    made?: { readonly from: readonly unknown[]; readonly rows: StoredRows };
    /** Its details' rows, read by the runs its window's rows were read by (D45). */
    joined?: Joined;
    /** Its items' details made their stored rows, for the details and the rows read: each cell's, in the window's order. */
    details?: { readonly details: Details; readonly from: readonly (readonly RecordSliceJoined[])[]; readonly rows: StoredRows };
    /** The rows its window holds, as the frame is handed them. */
    holding?: { readonly revision: string; readonly rows: ReadonlyMap<string, { readonly row: Uint8Array }> };
}

/**
 * The reader's state across reads (see the module docs): each kind's window,
 * the cells it read at their revision, the narrowing's answers, the density it
 * drew and the rows it made — every part beside what it was read from.
 */
export class SchematicAreaReader {
    private readonly slots = new Map<string, Slot>();
    private readonly encoders = new WeakMap<object, RowsEncoder>();

    /** A kind's state, made empty on first use. */
    private slotOf(key: string): Slot {
        let slot = this.slots.get(key);
        if (slot === undefined) {
            slot = {};
            this.slots.set(key, slot);
        }
        return slot;
    }

    /**
     * The rows a kind's window holds at a revision, as the frame is handed them:
     * the same object while they and the revision hold.
     *
     * @param slot - The kind's slot
     * @param revision - The revision they were read at
     * @param rows - The rows, by key
     * @returns What the window holds
     */
    held(slot: string, revision: string, rows: ReadonlyMap<string, { readonly row: Uint8Array }>): { readonly revision: string; readonly rows: ReadonlyMap<string, { readonly row: Uint8Array }> } {
        const state = this.slotOf(slot);
        const was = state.holding;
        if (was !== undefined && Object.is(was.rows, rows) && stringEqual(was.revision, revision)) return was;
        const now = { revision, rows };
        state.holding = now;
        return now;
    }

    /**
     * A kind's window as it is read (see the module docs): its rows, or its
     * density past the rows a window draws — the same object while its plan
     * and its revision hold.
     *
     * @param kind - The kind
     * @param part - Its source of the slice
     * @param areas - Its area indexes
     * @param viewport - Where the viewport rests
     * @param dim - Whether every row is read, the narrowing drawn as context (`narrowed="dim"`)
     * @returns What the window holds; {@link READING} while a search or a read is in flight
     */
    window(kind: SchematicAreaKind, part: Part, areas: SchematicAreaIndexes, viewport: SchematicViewport, dim: boolean): SchematicWindowRead | Reading {
        const revision = recordSliceRevision(part);
        if (revision.type !== "some") return READING;
        const slot = this.slotOf(kind.key);
        const planned = this.plannedOf(slot, part, areas, dim ? NO_WHERE : part.read().where, this.windowFor(slot, viewport));
        const last = slot.read;
        if (last !== undefined && Object.is(last.planned, planned) && stringEqual(last.revision, revision.value)) return last.read;
        const total = this.totalOf(slot, part, planned, revision.value);
        if (total === READING) return READING;
        const read = total > BigInt(SCHEMATIC_WINDOW_ROWS)
            ? this.density(slot, part, planned, revision.value, dim)
            : this.rows(slot, part, planned, revision.value);
        if (read === READING) return READING;
        slot.read = { planned, revision: revision.value, read };
        return read;
    }

    /** The window a kind reads for a viewport: the one it holds while it holds, else the viewport's own. */
    private windowFor(slot: Slot, viewport: SchematicViewport): SchematicWindow {
        const held = slot.window;
        if (held !== undefined && windowHolds(held, viewport)) return held;
        const next = windowOf(viewport);
        slot.window = next;
        return next;
    }

    /** A window's plan and its cells, planned again only when the source, the narrowing or the window moves. */
    private plannedOf(slot: Slot, part: Part, areas: SchematicAreaIndexes, where: Where, window: SchematicWindow): Planned {
        const last = slot.planned;
        if (last !== undefined && Object.is(last.config, part.config) && Object.is(last.where, where) && Object.is(last.window, window)) return last;
        const plan = schematicWindowPlan(areas, where, window.box);
        // A cell a search: the same search in every window that holds it (`areaQueries`), so a pan asks only the cells it adds.
        const cells = plan.prefixes.flatMap((prefix) => areaQueries(prefix, window.box, plan.cell)).map((query) => ({ id: printQuery(query), queries: [query] }));
        const planned = { config: part.config, where, window, plan, cells };
        slot.planned = planned;
        return planned;
    }

    /** How many entries a window's cells hold: found in one request, once a revision. */
    private totalOf(slot: Slot, part: Part, planned: Planned, revision: string): bigint | Reading {
        const last = slot.found;
        if (last !== undefined && Object.is(last.planned, planned) && stringEqual(last.revision, revision)) return last.total;
        const runs = recordSliceCellRuns(part, planned.plan.index.name, planned.cells);
        if (runs.type !== "some") return READING;
        let total = 0n;
        for (const found of runs.value.values()) total += found.total;
        slot.found = { revision, planned, total };
        return total;
    }

    /** A window's rows: its cells' entries, those of the cells not held read in one read of their runs. */
    private rows(slot: Slot, part: Part, planned: Planned, revision: string): SchematicWindowRead | Reading {
        const entries = this.entriesOf(slot, part, planned.plan.index.name, revision, planned.cells);
        if (entries === READING) return READING;
        return { plan: planned.plan, revision, rows: rowsOfEntries(entries), density: undefined, at: { cells: planned.cells }, from: entries };
    }

    /**
     * The cells' entries a kind's window holds, at the record's revision through
     * an index: those of the wanted cells it doesn't hold read in one read of
     * their runs, and every cell no longer wanted let go.
     *
     * @returns Each wanted cell's entries, in order; {@link READING} while the read is in flight
     */
    private entriesOf(slot: Slot, part: Part, index: string, revision: string, cells: readonly RecordSliceCell[]): (readonly RecordSliceEntry[])[] | Reading {
        let kept = slot.kept;
        if (kept === undefined || !stringEqual(kept.index, index) || !stringEqual(kept.revision, revision)) {
            kept = { index, revision, cells: new Map() };
            slot.kept = kept;
        }
        const held = kept.cells;
        const missing = cells.filter((cell) => !held.has(cell.id));
        if (missing.length > 0) {
            const read = recordSliceCellEntries(part, index, missing);
            if (read.type !== "some") return READING;
            for (const cell of missing) held.set(cell.id, read.value.get(cell.id) ?? []);
        }
        const wanted = new Set(cells.map((cell) => cell.id));
        for (const id of [...held.keys()]) if (!wanted.has(id)) held.delete(id);
        return cells.map((cell) => held.get(cell.id)!);
    }

    /**
     * A kind's density past the rows a window draws (D25): the bounds of the
     * raster's cells over the window's reach and of the coarser levels' cells,
     * in one request; the coarser levels' rows read in one read of their runs
     * while they number no more than a window draws, else spread over the
     * raster.
     */
    private density(slot: Slot, part: Part, planned: Planned, revision: string, dim: boolean): SchematicWindowRead | Reading {
        const index = planned.plan.index.name;
        const rastered = this.rasteredOf(slot, planned);
        const found = this.boundsOf(slot, part, index, rastered, revision);
        if (found === READING) return READING;
        const counts = found.slice(0, rastered.cells).map((range) => range.count);
        const coarse = found.slice(rastered.cells);
        let total = 0n;
        for (const range of coarse) total += range.count;
        // The coarser levels' rows, boxes larger than half a raster cell: drawn as rows while a window would draw them all.
        const few = total <= BigInt(SCHEMATIC_WINDOW_ROWS);
        let entries = NO_ENTRIES;
        let runs = NO_RUNS;
        if (few && total > 0n) {
            const read = this.coarseOf(slot, part, index, found, coarse);
            if (read === READING) return READING;
            entries = read.entries;
            runs = read.runs;
        }
        // Under `dim` the raster counts every row; otherwise the fields the index doesn't lead aren't counted in it.
        const unnarrowed = dim ? part.read().where.size > 0 : planned.plan.residual.length > 0;
        const density = this.densityOf(slot, rastered, counts, few ? undefined : coarse.map((range) => range.count), unnarrowed);
        return { plan: planned.plan, revision, rows: rowsOfEntries([entries]), density, at: { runs }, from: [entries, density] };
    }

    /** A window's density raster and its searches, planned again only with the window's plan. */
    private rasteredOf(slot: Slot, planned: Planned): Rastered {
        const last = slot.rastered;
        if (last !== undefined && Object.is(last.planned, planned)) return last;
        const raster = schematicRaster(planned.plan, planned.window.reach);
        const ranges = raster.cells.flat().map((cell) => cell.query);
        const rastered = { planned, raster, cells: ranges.length, queries: [...ranges, ...raster.coarse.map((cell) => cell.query)] };
        slot.rastered = rastered;
        return rastered;
    }

    /** A raster's searches' bounds: found in one request, once a revision, and kept as no cell. */
    private boundsOf(slot: Slot, part: Part, index: string, rastered: Rastered, revision: string): readonly Range[] | Reading {
        const last = slot.bounds;
        if (last !== undefined && Object.is(last.raster, rastered.raster) && stringEqual(last.revision, revision)) return last.found;
        const found = recordSliceBounds(part, index, rastered.queries);
        if (found.type !== "some") return READING;
        slot.bounds = { revision, raster: rastered.raster, found: found.value };
        return found.value;
    }

    /**
     * The coarser levels' rows: the runs holding any, ascending, read in one read — once for the bounds they were found
     * by — and those runs, which their details are read by.
     */
    private coarseOf(
        slot: Slot, part: Part, index: string, found: readonly Range[], coarse: readonly Range[],
    ): { readonly runs: readonly Range[]; readonly entries: readonly RecordSliceEntry[] } | Reading {
        const last = slot.coarse;
        if (last !== undefined && Object.is(last.found, found)) return last;
        // Each coarser cell an exact key: their runs are disjoint, read in the index's order.
        const runs = coarse.filter((range) => range.count > 0n).sort((a, b) => rowOrder(a.row, b.row));
        const read = recordSliceRunEntries(part, index, runs);
        if (read.type !== "some") return READING;
        const got = { found, runs, entries: read.value };
        slot.coarse = got;
        return got;
    }

    /** A raster's density, as the canvas draws it: the one it last drew while its cells read again as they were, over the same box. */
    private densityOf(slot: Slot, rastered: Rastered, counts: readonly bigint[], spread: readonly bigint[] | undefined, unnarrowed: boolean): SchematicDensity {
        const { raster } = rastered;
        const box = rastered.planned.window.reach;
        const cells = schematicDensityCells(raster, counts, spread);
        const spreads = spread !== undefined;
        const last = slot.density;
        if (last !== undefined && last.side === raster.side && last.unnarrowed === unnarrowed && last.spread === spreads && sameBox(last.box, box)
            && sameCells(last.cells, cells)) return last;
        const density = { side: raster.side, cells, most: cells.reduce((most, cell) => Math.max(most, cell.count), 0), box, spread: spreads, unnarrowed };
        slot.density = density;
        return density;
    }

    /**
     * The rows of some of a kind's keys its window doesn't hold — the far ends
     * of the links and nets that touch it — read by key through the kind's own
     * paged read, in one request: the same rows while that read's answer is.
     *
     * @param slot - The kind's slot
     * @param paged - The `id` of its paged read; `undefined` for a kind with none
     * @param keys - The keys, in order
     * @returns Each row the record holds, by key; {@link READING} while the read is in flight
     * @throws {Error} When the kind has no paged read, or it is bound on no page this runtime serves
     */
    farEnds(slot: string, paged: string | undefined, keys: readonly string[]): SchematicAreaRows | Reading {
        if (keys.length === 0) return NO_ROWS;
        if (paged === undefined) throw new Error(`The kind "${slot}" read by area reads its far ends by key through its own paged read, and it has none`);
        const source = pagedSourceOf(paged);
        if (source === undefined) throw new Error(`The kind "${slot}"'s paged read '${paged}' is bound on no page this runtime serves`);
        const read = defaultPagedRuntime.rowsAll(source, keys);
        if (read.type !== "some") return READING;
        const state = this.slotOf(slot);
        if (state.far !== undefined && Object.is(state.far.read, read.value)) return state.far.rows;
        const rows = new Map<string, unknown>();
        for (const row of read.value) if (row.row.type === "some") rows.set(row.key as string, row.row.value);
        state.far = { read: read.value, rows };
        return rows;
    }

    /**
     * A kind's rows read by area, its narrowing asked of them (D28): those it
     * holds drawn — every one under `dim`, those it holds the matches — each
     * row's answer kept at its revision and narrowing, so a pan asks only of
     * the rows it adds; every row asked in one request. The same object while
     * what it was read from is.
     *
     * @param kind - The kind
     * @param part - Its source of the slice
     * @param read - Its window, as it was read
     * @param far - Its far ends, read by key
     * @param dim - Whether the narrowing is drawn as context
     * @returns The rows it draws, and under `dim` the matches; {@link READING} while the narrowing's answer is in flight
     */
    narrowed(kind: SchematicAreaKind, part: Part, read: SchematicWindowRead, far: SchematicAreaRows, dim: boolean): SchematicAreaRead | Reading {
        const where = part.read().where;
        const slot = this.slotOf(kind.key);
        const last = slot.narrowed;
        if (last !== undefined && Object.is(last.read, read) && Object.is(last.far, far) && Object.is(last.where, where) && last.dim === dim) return last.result;
        const result = this.narrow(slot, part, read, far, where, dim);
        if (result !== READING) slot.narrowed = { read, far, where, dim, result };
        return result;
    }

    /** A kind's rows, its narrowing asked of them (see {@link SchematicAreaReader.narrowed}). */
    private narrow(slot: Slot, part: Part, read: SchematicWindowRead, far: SchematicAreaRows, where: Where, dim: boolean): SchematicAreaRead | Reading {
        const rows = far.size === 0 ? read.rows : new Map([...read.rows, ...far]);
        if (where.size === 0) return { rows, matched: undefined, from: [...read.from, far] };
        // Read by key, a far end is held to the whole narrowing; a window read through an index that serves it whole, to nothing.
        const residual = dim || read.plan.residual.length > 0;
        if (!residual && far.size === 0) return { rows, matched: new Set(rows.keys()), from: [...read.from, far] };
        const held = this.answersOf(slot, part, read.revision, where, residual ? rows : far);
        if (held === READING) return READING;
        if (dim) {
            const matched = new Set<string>();
            for (const key of rows.keys()) if (held.get(key) === true) matched.add(key);
            return { rows, matched, from: [...read.from, far, held] };
        }
        const shown = new Map<string, unknown>();
        for (const [key, row] of rows) {
            const asked = residual || far.has(key);
            if (!asked || held.get(key) === true) shown.set(key, row);
        }
        return { rows: shown, matched: new Set(shown.keys()), from: [...read.from, far, held] };
    }

    /** Which of some rows a narrowing holds: each answer kept at its revision and narrowing, the rows not yet answered asked in one request. */
    private answersOf(slot: Slot, part: Part, revision: string, where: Where, rows: SchematicAreaRows): ReadonlyMap<string, boolean> | Reading {
        const text = printWhere(where);
        let kept = slot.answers;
        if (kept === undefined || !stringEqual(kept.revision, revision) || !stringEqual(kept.where, text)) {
            kept = { revision, where: text, held: new Map() };
            slot.answers = kept;
        }
        const held = kept.held;
        const asked = [...rows].filter(([key]) => !held.has(key)).map(([key, row]) => ({ key, row }));
        if (asked.length === 0) return held;
        const answer = recordSliceWithin(part, where, asked);
        if (answer.type !== "some") return READING;
        // A fresh map: what the rows are drawn from moved.
        const next = new Map(held.size + asked.length > MAX_KEPT_ANSWERS ? [...held].filter(([key]) => rows.has(key)) : held);
        asked.forEach(({ key }, i) => next.set(key, answer.value[i] === true));
        kept.held = next;
        return next;
    }

    /** A kind's encoder of the rows it read, made once per kind's row type. */
    private encoderOf(kind: { readonly rowType: SchematicAreaKind["rowType"] }): RowsEncoder {
        let encode = this.encoders.get(kind);
        if (encode === undefined) {
            const row = fromEastTypeValue(kind.rowType) as StructTypeOf;
            encode = encodeBeast2For(ArrayType(StructType({ key: StringType, row }))) as RowsEncoder;
            this.encoders.set(kind, encode);
        }
        return encode;
    }

    /**
     * A kind's rows made its stored rows (#1393), through its `rowsOf`: each
     * one's roles beside its bytes — made again only when what they were read
     * from moved.
     *
     * @param kind - The kind
     * @param read - Its rows, the narrowing asked of them
     * @returns Its stored rows, by key
     */
    rowsOf<K extends SchematicAreaKind>(kind: K, read: SchematicAreaRead): ReturnType<K["rowsOf"]> {
        const slot = this.slotOf(kind.key);
        const from = [kind, ...read.from];
        const last = slot.made;
        if (last !== undefined && sameFrom(last.from, from)) return last.rows as ReturnType<K["rowsOf"]>;
        const rows = (kind.rowsOf as (bytes: Uint8Array) => StoredRows)(this.encoderOf(kind)([...read.rows].map(([key, row]) => ({ key, row }))));
        slot.made = { from, rows };
        return rows as ReturnType<K["rowsOf"]>;
    }

    /**
     * The details of the items a kind's window holds, made their stored rows
     * (§12, D45): read by the runs its rows were read by — its cells, or at
     * density the coarser levels' runs — every cell not held in one request of
     * the details' record, the server reading each entry's key from the area
     * index, none sent; each cell's kept at the kind's revision and the
     * details' while the window wants it, so a pan reads only the cells it
     * adds and a commit to the details reads them again. Read at every tier: a
     * dot draws its item's status too. A far end, drawn off the window, has
     * none read.
     *
     * @param slot - The kind's slot
     * @param details - Its details
     * @param part - Its source of the slice: the area index its window was read through
     * @param read - Its window, as it was read
     * @returns Their details' rows, by key; `undefined` for details read whole or by no paged read; {@link READING} while the read is in flight
     * @throws {Error} When the details' paged read is bound on no page this runtime serves
     */
    detailsOf(slot: string, details: Details, part: Part, read: SchematicWindowRead): StoredRows | Reading | undefined {
        if (details.paged.type !== "some") return undefined;
        const dict = details.paged.value;
        const source = pagedSourceOf(dict);
        if (source === undefined) throw new Error(`The details' paged read '${dict}' is bound on no page this runtime serves`);
        const revision = defaultPagedRuntime.revisionOf(source);
        if (revision.type !== "some") return READING;
        const state = this.slotOf(slot);
        const index = read.plan.index.name;
        let kept = state.joined;
        if (kept === undefined || !stringEqual(kept.dict, dict) || !stringEqual(kept.index, index)
            || !stringEqual(kept.revision, read.revision) || !stringEqual(kept.details, revision.value)) {
            kept = { dict, index, revision: read.revision, details: revision.value, cells: new Map(), runs: undefined };
            state.joined = kept;
        }
        const parts = this.joinedOf(kept, part, read.at);
        if (parts === READING) return READING;
        const last = state.details;
        if (last !== undefined && Object.is(last.details, details) && sameFrom(last.from, parts)) return last.rows;
        const present: { key: string; row: unknown }[] = [];
        for (const joined of parts) {
            for (const entry of joined) if (entry.row.type === "some") present.push({ key: entry.key as string, row: entry.row.value });
        }
        const made = details.rowsOf(this.encoderOf(details)(present)) as StoredRows;
        state.details = { details, from: parts, rows: made };
        return made;
    }

    /**
     * A window's details' rows (see {@link SchematicAreaReader.detailsOf}): its
     * cells' — those not held read in one request, and every cell no longer
     * wanted let go — or the coarser levels' runs', read once for the runs.
     *
     * @returns Each cell's rows of the details, in the window's order, or the runs'; {@link READING} while the read is in flight
     */
    private joinedOf(kept: Joined, part: Part, at: SchematicWindowRead["at"]): readonly (readonly RecordSliceJoined[])[] | Reading {
        if ("runs" in at) {
            if (kept.runs === undefined || !Object.is(kept.runs.runs, at.runs)) {
                let joined = NO_JOINED;
                if (at.runs.length > 0) {
                    const got = recordSliceRunJoins(part, kept.index, at.runs, kept.dict);
                    if (got.type !== "some") return READING;
                    joined = got.value;
                }
                kept.runs = { runs: at.runs, joined };
            }
            return [kept.runs.joined];
        }
        const held = kept.cells;
        const missing = at.cells.filter((cell) => !held.has(cell.id));
        if (missing.length > 0) {
            const got = recordSliceCellJoins(part, kept.index, missing, kept.dict);
            if (got.type !== "some") return READING;
            for (const cell of missing) held.set(cell.id, got.value.get(cell.id) ?? NO_JOINED);
        }
        const wanted = new Set(at.cells.map((cell) => cell.id));
        for (const id of [...held.keys()]) if (!wanted.has(id)) held.delete(id);
        return at.cells.map((cell) => held.get(cell.id)!);
    }
}

/** The rows some cells' entries hold, by key: each row once. */
function rowsOfEntries(entries: readonly (readonly RecordSliceEntry[])[]): Map<string, unknown> {
    const rows = new Map<string, unknown>();
    for (const cell of entries) {
        for (const entry of cell) {
            const row = rowOf(entry);
            if (row !== undefined) rows.set(entry.key as string, row);
        }
    }
    return rows;
}

/** Whether two lists of what rows were read from are the same parts, in order. */
function sameFrom(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length === b.length && a.every((part, i) => Object.is(part, b[i]));
}

/** Whether two boxes are the same box. */
function sameBox(a: WorldBox, b: WorldBox): boolean {
    return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

/** Whether two densities' cells read the same: each at the same corner, holding as many rows. */
function sameCells(a: readonly SchematicDensityCell[], b: readonly SchematicDensityCell[]): boolean {
    return a.length === b.length && a.every((cell, i) => cell.minX === b[i]!.minX && cell.minY === b[i]!.minY && cell.count === b[i]!.count);
}
