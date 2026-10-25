/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's reads of the app's records (#1386, `Schematic Builder
 * Spec.md` §10.4), in a component of its own, as the Allocation's day and the
 * Roster's week are (#1343): each kind's rows through its `rows` — its record
 * read whole, or its narrowing read complete through its source of the slice —
 * and the details of a kind whose details are read whole beside it, made what
 * the canvas draws (`canvas/drawn.ts`). An entity whose roles read again as
 * they were keeps what was drawn of it, so the drawing keeps its identity
 * while nothing it shows moves, and the frame is handed what it reads only
 * when that moves. While a read the drawing needs is in flight, the frame keeps
 * the last complete drawing; one it has never read is never drawn as empty.
 * It reads the stored rows alone: the frame draws the editing session's drafts
 * over them (#1388), by which rows each read holds and their details' roles,
 * and lists in the library's Backlog the rows an item kind's read holds with
 * no position (#1389).
 *
 * Each kind is read on its own (#1387, SC32): a kind whose read fails keeps
 * what was drawn of it, says why under its slot, and leaves every other kind
 * read; the frame says so in a banner, with Retry. A read again — `attempt`
 * moving — reads every kind afresh.
 *
 * A kind whose source of the slice lists an area index is read by area
 * (#1393, §10.4): its viewport's window, a cell at a time (`area.ts`), never
 * its record whole nor its narrowing complete — its rows, or past
 * `SCHEMATIC_WINDOW_ROWS` in view its density; its items' details by the runs its
 * window was read by, at every zoom, so a dot draws its item's status (D45);
 * its whole drawing's density, which the minimap draws (`overview`); and the
 * far ends of the links and nets that touch it, by key. One
 * that lists area indexes none of which reads it — none led by no field, or
 * one boxing its rows otherwise than its roles — is refused as it reads,
 * naming what to declare (SC34). The previous window stays drawn until the
 * next lands, and until every row of it is made: a read makes a budget's
 * worth of the rows new to it (`area.ts`), and the next read, a task later,
 * the rest, so a frame draws between them. A kind whose read is in flight, or
 * whose rows are still being made, keeps what was drawn of it, so the read
 * that next draws it keeps each entity that reads again as it was.
 *
 * What it reads now is the footer's loading line's to say (#1398, CL3): the
 * first kind in the Schematic's order whose rows, details or narrowing are in
 * flight — its record whole, its window's rows in view, its density's counts,
 * or its rows' details — and whether that read is of a new narrowing — the
 * kind's source's narrowing no longer the one its drawing was read under,
 * which stands in meanwhile. A kind's rows draw while their details are read:
 * each card keeps the places of the roles its details give, a placeholder in
 * each (`canvas/drawn.ts`' `pending`), and a row whose details were drawn
 * before keeps them until they land again — never a value it has not read.
 * While a kind's window is read, the area its drawing does not cover yet is
 * said, for the canvas to wash (`unread`, CL2); and where its read fails, the
 * area it failed reading, for the canvas to say so at (`failedAreas`, CL11).
 * While what it hands the frame was read under a narrowing its kind's source
 * no longer holds — the new one in flight — it says so (`filtering`), for the
 * frame to draw it as kept and take no edit on it until the new one lands (CL8).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { StringType, compareFor, equalFor, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { Schematic, schematicAreaIndexes, type SchematicAreaIndexes } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { sourcePart } from "../shared/schedule/visibility.js";
import {
    READING, SchematicAreaReader, boxMinus, unreadArea, windowOf,
    type SchematicAreaKind, type SchematicDensity, type SchematicViewport, type SchematicViewportStore, type SchematicWindowRead,
} from "./area.js";
import {
    EMPTY_DRAWN, drawnItem, drawnLink, drawnNet, drawnZone,
    type CardRoles, type DetailsRoles, type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type ItemRoles, type SchematicDrawn, type SchematicRef,
} from "./canvas/drawn.js";
import type { WorldBox } from "./canvas/model.js";

/** The Schematic's payload, decoded. */
export type SchematicValue = ValueTypeOf<typeof Schematic.Types.Payload>;

const sameItem = equalFor(Schematic.Types.Item);
const sameZone = equalFor(Schematic.Types.Zone);
const sameLink = equalFor(Schematic.Types.Link);
const sameNet = equalFor(Schematic.Types.Net);
const sameDetails = equalFor(Schematic.Types.DetailsRoles);
const sameWhere = equalFor(RecordSliceWhereType);
const sameString = equalFor(StringType);
const compareString = compareFor(StringType);

/** A record Slice's narrowing, decoded. */
type Where = ValueTypeOf<typeof RecordSliceWhereType>;

/**
 * What the Schematic reads now, as the footer's loading line says it (#1398, CL3): the first kind in the Schematic's
 * order whose read is in flight, and whether that read is of a new narrowing, the last standing in.
 */
export interface SchematicReading {
    /** The kind's slot. */
    readonly slot: string;
    /**
     * What of it is read: its record whole, or its narrowing complete (`rows`: `Loading racks…`); its window's rows
     * (`area`: `Loading racks in view`); its density's counts (`counts`: `Loading counts`); or its rows' details, its rows
     * drawn meanwhile (`details`: `Loading details for 12 racks`).
     */
    readonly what: "rows" | "area" | "counts" | "details";
    /** Whether its source's narrowing is not the one its drawing was read under: `Filtering racks…`, whatever is read. */
    readonly filtering: boolean;
    /** How many of its rows drawn wait on their details; `0` but while its details are read. */
    readonly waiting: number;
}

/** What the Schematic has read of its kinds' records. */
export interface SchematicData {
    /** What the canvas draws: the last settled read's entities. */
    readonly drawn: SchematicDrawn;
    /** Whether a read the drawing needs — a kind's rows, or its details read whole — is in flight. */
    readonly loading: boolean;
    /** What is read now, the first kind in flight in the Schematic's order; `undefined` while nothing is. */
    readonly reading: SchematicReading | undefined;
    /**
     * Whether what the canvas draws of a kind was read under a narrowing its source no longer holds, the new one's read
     * in flight (#1398, CL8): it stands in, kept, until the new one lands — never a kind whose read of it failed.
     */
    readonly filtering: boolean;
    /** Whether a read has settled: every kind read, or its read failed. */
    readonly ready: boolean;
    /** Why the read as a whole failed — outside any one kind's. */
    readonly error: string | undefined;
    /** Why a kind's read failed, by the kind's slot. */
    readonly failures: ReadonlyMap<string, string>;
    /** How many rows each kind's settled read holds, by the kind's slot — those with no position among them. */
    readonly rows: ReadonlyMap<string, number>;
    /**
     * Each kind's rows the settled read holds, by the kind's slot, then by key — each one's details' roles, where its
     * kind's details are read whole beside it (#1388): which rows a draft draws over, and what a drafted card draws.
     */
    readonly held: SchematicHeldRows;
    /**
     * Each item kind's rows the settled read holds with no position, by the kind's slot, then by key — each one's roles,
     * in the read's order (#1389): what the library's Backlog lists, the drafts over them.
     */
    readonly unplaced: SchematicUnplacedRows;
    /**
     * Each kind read by area, by its slot: the rows its settled window holds, by key, each its row's bytes — what a
     * gesture's original, a Save's confirmation and the inspector find a row in before reading it by key (#1393).
     */
    readonly windows: SchematicWindowRows;
    /** Each kind read by area drawing its density in place of items, by its slot (D25). */
    readonly density: ReadonlyMap<string, SchematicDensity>;
    /** Each kind read by area's whole drawing's density, by its slot: what the minimap draws of it (#1393). */
    readonly overview: ReadonlyMap<string, SchematicDensity>;
    /**
     * Each kind read by area under `narrowed="dim"` and a narrowing, by its slot: the rows its window holds that the
     * narrowing holds, as `within` answered (D28) — what draws as a match, and the rest as context.
     */
    readonly matched: ReadonlyMap<string, ReadonlySet<string>>;
    /**
     * What the reads in flight have not drawn yet, in world units, as disjoint boxes (#1398, CL2): each kind read by area
     * whose window's rows or counts are read, the reach it reads less the reach its drawing holds — what the canvas washes.
     */
    readonly unread: readonly WorldBox[];
    /**
     * Each kind read by area whose read failed, by its slot: the area it failed reading — its window's reach less what its
     * drawing holds, or, where its drawing holds it all, the reach — where the canvas says so, at its top-left (CL11).
     */
    readonly failedAreas: ReadonlyMap<string, readonly WorldBox[]>;
}

/** The rows a kind's window holds, by key, each its row's bytes, and the revision of the record they were read at. */
export interface SchematicWindowHeld {
    /** The record's revision they were read at. */
    readonly revision: string;
    /** The rows, by key. */
    readonly rows: ReadonlyMap<string, { readonly row: Uint8Array }>;
}

/** Each kind read by area, by its slot: the rows its window holds, at the revision they were read at. */
export type SchematicWindowRows = ReadonlyMap<string, SchematicWindowHeld>;

/** Each item kind's rows a read holds with no position, by the kind's slot, then by key: each one's roles. */
export type SchematicUnplacedRows = ReadonlyMap<string, ReadonlyMap<string, ItemRoles>>;

/** One row a kind's read holds: its details' roles, where its kind's details are read whole beside it. */
export interface SchematicHeldRow {
    readonly details: DetailsRoles | undefined;
    /** The card roles its kind's details give, while its details row is read and none stands in: a drafted card over it holds their places (#1398). */
    readonly pending?: CardRoles | undefined;
}

/** Each kind's rows a read holds, by the kind's slot, then by key. */
export type SchematicHeldRows = ReadonlyMap<string, ReadonlyMap<string, SchematicHeldRow>>;

/** No kind failed. */
const NO_FAILURES: ReadonlyMap<string, string> = new Map();

/** No kind read. */
const NO_ROWS: ReadonlyMap<string, number> = new Map();

/** No row held. */
const NO_HELD: SchematicHeldRows = new Map();

/** No row with no position. */
const NO_UNPLACED: SchematicUnplacedRows = new Map();

/** No kind read by area. */
const NO_WINDOWS: SchematicWindowRows = new Map();

/** No kind drawing its density, and none's overview read. */
const NO_DENSITY: ReadonlyMap<string, SchematicDensity> = new Map();

/** No kind read by area under a dimmed narrowing. */
const NO_MATCHED: ReadonlyMap<string, ReadonlySet<string>> = new Map();

/** Nothing unread. */
const NO_BOXES: readonly WorldBox[] = [];

/** No kind read by area failed. */
const NO_FAILED_AREAS: ReadonlyMap<string, readonly WorldBox[]> = new Map();

/** The frame's data before its reader first reports: nothing drawn, a read in flight. */
export const INITIAL_SCHEMATIC_DATA: SchematicData = {
    drawn: EMPTY_DRAWN, loading: true, reading: undefined, filtering: false, ready: false, error: undefined, failures: NO_FAILURES, rows: NO_ROWS, held: NO_HELD,
    unplaced: NO_UNPLACED, windows: NO_WINDOWS, density: NO_DENSITY, overview: NO_DENSITY, matched: NO_MATCHED, unread: NO_BOXES,
    failedAreas: NO_FAILED_AREAS,
};

/**
 * The kinds read by area, by their slots (#1393): each item and zone kind
 * whose source of the slice lists an area index — what is never read whole,
 * nor its narrowing complete, whether or not its indexes read it.
 *
 * @param value - The payload
 * @returns Their slots
 */
export function areaSlots(value: SchematicValue): ReadonlySet<string> {
    const chrome = getSomeorUndefined(value.slice);
    const slots = new Set<string>();
    for (const kind of [...value.items, ...value.zones]) {
        if (sourcePart(chrome, kind.key)?.config.indexes.some((index) => index.area.type === "some") === true) slots.add(kind.key);
    }
    return slots;
}

/** One entity as it was last drawn: the roles it was drawn from, its details' roles, and what was drawn — none for an unplaced item. */
interface Kept extends SchematicHeldRow {
    readonly roles: unknown;
    readonly drawn: unknown;
}

/**
 * What was last read, for the payload it was read under: each kind's entities by its slot, then by key, what each
 * kind's were made from — its stored rows, its details' and what of them was unread — the narrowing each kind read
 * through its source was drawn under, the reach each kind read by area's drawing covers, and the drawing.
 */
interface Held {
    readonly value: SchematicValue | undefined;
    readonly kinds: ReadonlyMap<string, ReadonlyMap<string, Kept>>;
    readonly inputs: ReadonlyMap<string, Inputs>;
    readonly wheres: ReadonlyMap<string, Where>;
    readonly reaches: ReadonlyMap<string, WorldBox>;
    readonly drawn: SchematicDrawn;
}

/** What one kind's entities were made from: its stored rows, its details', and the card roles they give while they are read. */
interface Inputs {
    readonly rows: unknown;
    readonly details: unknown;
    readonly unread: CardRoles | undefined;
}

/** Nothing held: a payload read for the first time. */
function nothingHeld(value: SchematicValue | undefined): Held {
    return { value, kinds: new Map(), inputs: new Map(), wheres: new Map(), reaches: new Map(), drawn: EMPTY_DRAWN };
}

/** One kind's stored rows a read holds, each its roles. */
type Rows<R> = ReadonlyMap<string, { readonly roles: R }>;

/** Why a read failed, as the banner says it. */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Whether two lists of boxes are the same boxes, in order. */
function sameBoxes(a: readonly WorldBox[], b: readonly WorldBox[]): boolean {
    return a.length === b.length && a.every((box, i) => box.minX === b[i]!.minX && box.minY === b[i]!.minY && box.maxX === b[i]!.maxX && box.maxY === b[i]!.maxY);
}

/** Whether two kinds' failed areas say the same. */
function sameAreas(a: ReadonlyMap<string, readonly WorldBox[]>, b: ReadonlyMap<string, readonly WorldBox[]>): boolean {
    if (a.size !== b.size) return false;
    for (const [slot, boxes] of a) {
        const other = b.get(slot);
        if (other === undefined || !sameBoxes(boxes, other)) return false;
    }
    return true;
}

/** A map's entries as one string: equal whenever the map holds the same. */
function signatureOf(map: ReadonlyMap<string, string | number>): string {
    return [...map].map(([key, value]) => `${key}\u0000${value}`).join("\u0001");
}

/** Two maps holding the same objects under the same keys. */
function sameEntries<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>): boolean {
    if (a.size !== b.size) return false;
    for (const [key, value] of a) if (!Object.is(b.get(key), value)) return false;
    return true;
}

/** Whether each kind's drawing was read under the same narrowing in both: East deciding which narrowings are the same. */
function sameWheres(a: ReadonlyMap<string, Where>, b: ReadonlyMap<string, Where>): boolean {
    if (a.size !== b.size) return false;
    for (const [slot, where] of a) {
        const other = b.get(slot);
        if (other === undefined || !sameWhere(where, other)) return false;
    }
    return true;
}

/** A kind's read that threw: why. */
interface Refused {
    readonly refused: unknown;
}

/** What a read through a kind's `rows()` gave: its rows, `none` while in flight, or why it threw. */
function rowsRead<T>(read: () => T): T | Refused {
    try {
        return read();
    } catch (refused) {
        return { refused };
    }
}

/** Whether a read threw. */
function isRefused(read: unknown): read is Refused {
    return typeof read === "object" && read !== null && "refused" in read;
}

/**
 * Reads the drawing (see the module docs).
 *
 * @param value - The payload
 * @param attempt - Moves to read every kind afresh: a Retry
 * @param viewport - Where the canvas's viewport rests, which a kind read by area reads its window around; `undefined` before the canvas has reported it
 * @returns What the Schematic has read
 */
export function useSchematicData(value: SchematicValue, attempt = 0, viewport?: SchematicViewport): SchematicData {
    const held = useRef<Held>(nothingHeld(undefined));
    // The reads by area: each kind's window, the cells it read and the rows it made, across reads (#1393).
    const [areaReader] = useState(() => new SchematicAreaReader());
    // Rows a read leaves to make, the next read makes, a task later, so a frame draws between: it moves to ask it (#1393).
    const [makes, setMakes] = useState(0);
    const read = useCallback(() => {
        // A Retry reads every kind again, from what was drawn.
        void attempt;
        void makes;
        areaReader.begin();
        // A payload built again holds functions of its own: what they draw is read again.
        const prior: Held = Object.is(held.current.value, value) ? held.current : nothingHeld(value);
        const kinds = new Map<string, ReadonlyMap<string, Kept>>();
        const inputs = new Map<string, Inputs>();
        const wheres = new Map<string, Where>();
        const reaches = new Map<string, WorldBox>();
        const failures = new Map<string, string>();
        const windows = new Map<string, SchematicWindowHeld>();
        const density = new Map<string, SchematicDensity>();
        const overview = new Map<string, SchematicDensity>();
        const matched = new Map<string, ReadonlySet<string>>();
        const failedAreas = new Map<string, readonly WorldBox[]>();
        let loading = false;
        // The kinds whose rows, details or narrowing are in flight, and what of each: what the footer's loading line says
        // (#1398, CL3) — a kind's rows before its details.
        const inFlight = new Set<string>();
        const what = new Map<string, SchematicReading["what"]>();
        const awaiting = (slot: string, doing: SchematicReading["what"]) => {
            loading = true;
            inFlight.add(slot);
            if (doing !== "details" || !what.has(slot)) what.set(slot, doing);
        };
        let changed = prior.kinds.size === 0;
        /**
         * One kind's entities: each kept where its roles and its details read again as they were, else drawn again — all
         * of them, unread, where its rows and its details are the very ones the last read drew from — the narrowing they
         * were read under, and the reach a kind read by area's drawing covers. While its details are read (`unread`, the
         * card roles they give), a row keeps the details it was drawn with, and one with none waits on them, its card
         * holding their places (#1398).
         */
        const take = <R, E>(slot: string, rows: Rows<R>, details: Rows<DetailsRoles> | undefined, same: (a: R, b: R) => boolean,
            draw: (ref: SchematicRef, roles: R, details: DetailsRoles | undefined, pending: CardRoles | undefined) => E | undefined, out: E[],
            unread?: CardRoles, reach?: WorldBox) => {
            const was = prior.kinds.get(slot);
            const from = prior.inputs.get(slot);
            inputs.set(slot, { rows, details, unread });
            const where = whereOf(slot);
            if (where !== undefined) wheres.set(slot, where);
            if (reach !== undefined) reaches.set(slot, reach);
            if (was !== undefined && from !== undefined && Object.is(from.rows, rows) && Object.is(from.details, details) && Object.is(from.unread, unread)) {
                kinds.set(slot, was);
                for (const kept of was.values()) if (kept.drawn !== undefined) out.push(kept.drawn as E);
                return;
            }
            if (was === undefined || was.size !== rows.size) changed = true;
            const kept = new Map<string, Kept>();
            for (const [key, entry] of rows) {
                const last = was?.get(key);
                // While its details are read, the details it was drawn with stand in; one with none waits on them.
                const its = details?.get(key)?.roles ?? (unread !== undefined ? last?.details : undefined);
                const pending = unread !== undefined && its === undefined ? unread : undefined;
                // A row made again as it was is the same object (`area.ts`' made rows): compared as such before as values.
                const keep = last !== undefined && (Object.is(last.roles, entry.roles) || same(last.roles as R, entry.roles))
                    && (Object.is(last.details, its) || (last.details !== undefined && its !== undefined && sameDetails(last.details, its)))
                    && Object.is(last.pending, pending);
                const drawn = keep ? last.drawn as E | undefined : draw({ kind: slot, key }, entry.roles, its, pending);
                if (!keep) changed = true;
                kept.set(key, { roles: entry.roles, details: its, pending, drawn });
                if (drawn !== undefined) out.push(drawn);
            }
            kinds.set(slot, kept);
        };
        /**
         * What was drawn of a kind stays — whose read failed, or is in flight, or whose rows are still being made — and
         * what it was drawn from, so the read that next draws it keeps each entity that reads again as it was.
         */
        const carry = <E>(slot: string, out: E[]) => {
            const was = prior.kinds.get(slot);
            if (was === undefined) return;
            kinds.set(slot, was);
            const from = prior.inputs.get(slot);
            if (from !== undefined) inputs.set(slot, from);
            const where = prior.wheres.get(slot);
            if (where !== undefined) wheres.set(slot, where);
            const reach = prior.reaches.get(slot);
            if (reach !== undefined) reaches.set(slot, reach);
            for (const kept of was.values()) if (kept.drawn !== undefined) out.push(kept.drawn as E);
        };
        /**
         * A kind whose read failed: what was drawn of it stays, and why is kept under its slot — and, read by area, the area
         * it failed reading: its window's reach less what its drawing holds, or the reach, where its drawing holds it all.
         */
        const failed = <E>(slot: string, error: unknown, out: E[]) => {
            failures.set(slot, messageOf(error));
            const want = areaReader.wanted(slot)?.reach;
            if (want !== undefined) {
                const area = boxMinus(want, prior.reaches.get(slot));
                failedAreas.set(slot, area.length > 0 ? area : [want]);
            }
            carry(slot, out);
        };
        // The item and zone kinds whose read is in flight, or whose rows are still being made: drawn as they were.
        const pending = new Set<string>();
        const items: DrawnItem[] = [];
        const zones: DrawnZone[] = [];
        const links: DrawnLink[] = [];
        const nets: DrawnNet[] = [];
        const chrome = getSomeorUndefined(value.slice);
        // The narrowing a kind's source holds now; `undefined` for a kind read through none.
        const whereOf = (slot: string): Where | undefined => sourcePart(chrome, slot)?.read().where;
        const dim = value.narrowed.show.type === "dim";
        // The drawing's extent, where a window's rows lie as the viewport's count of them weighs them — the footer's too.
        const extent = { minX: 0, minY: 0, maxX: value.extent.width, maxY: value.extent.height };

        // The links and the nets, read complete (D17): first, as the far ends of those that touch a window are read by key.
        const linkReads = value.links.map((kind) => rowsRead(() => kind.rows()));
        const netReads = value.nets.map((kind) => rowsRead(() => kind.rows()));

        // Each item and zone kind read by area: its window, its narrowing not yet asked of it (#1393).
        const byArea = new Map<string, {
            readonly kind: SchematicAreaKind; readonly part: NonNullable<ReturnType<typeof sourcePart>>; readonly areas: SchematicAreaIndexes;
            readonly read: SchematicWindowRead;
        }>();
        /** A kind's read by area, where its source lists an area index: its window, or `READING`; `undefined` for a kind read through `rows()`. */
        const areaRead = (kind: SchematicAreaKind, sort: "items" | "zones"): SchematicWindowRead | typeof READING | undefined => {
            const part = sourcePart(chrome, kind.key);
            const where = `Schematic.${sort}: "${kind.name}"`;
            const areas = part === undefined ? undefined : schematicAreaIndexes(part.config.indexes, kind.box, sort, where);
            if (part === undefined || areas === undefined) return undefined;
            // Nothing is read before the canvas says where its viewport rests.
            if (viewport === undefined) return READING;
            const got = areaReader.window(kind, part, areas, viewport, dim, extent);
            if (got !== READING) byArea.set(kind.key, { kind, part, areas, read: got });
            return got;
        };
        // What a kind's window's read waits on, as the line says it: its rows in view, or its density's counts.
        const windowWait = (slot: string): SchematicReading["what"] => (areaReader.waiting(slot) === "counts" ? "counts" : "area");
        // Each item kind read through `rows()`, its details read whole beside it: its rows, to draw once the far ends are read.
        const wholeItems: {
            readonly kind: SchematicAreaKind; readonly rows: Rows<ItemRoles>; readonly details: Rows<DetailsRoles> | undefined; readonly unread: CardRoles | undefined;
        }[] = [];
        const wholeZones: { readonly kind: SchematicAreaKind; readonly rows: Rows<ValueTypeOf<typeof Schematic.Types.Zone>> }[] = [];
        for (const kind of value.items) {
            try {
                const area = areaRead(kind, "items");
                if (area === READING) { awaiting(kind.key, windowWait(kind.key)); pending.add(kind.key); continue; }
                if (area !== undefined) continue;
                const rows = kind.rows();
                // A kind's details read whole beside it: what its cards draw where the kind gives none — its rows drawn while
                // they are read, each card holding the places of the roles they give (#1398).
                let details: Rows<DetailsRoles> | undefined;
                let unread: CardRoles | undefined;
                if (kind.details.type === "some" && kind.details.value.rows.type === "some") {
                    const got = kind.details.value.rows.value();
                    if (got.type === "some") details = got.value;
                    else { unread = kind.details.value.roles; awaiting(kind.key, "details"); }
                }
                if (rows.type !== "some") { awaiting(kind.key, "rows"); pending.add(kind.key); continue; }
                wholeItems.push({ kind, rows: rows.value, details, unread });
            } catch (error) {
                failed(kind.key, error, items);
            }
        }
        for (const kind of value.zones) {
            try {
                const area = areaRead(kind, "zones");
                if (area === READING) { awaiting(kind.key, windowWait(kind.key)); pending.add(kind.key); continue; }
                if (area !== undefined) continue;
                const rows = kind.rows();
                if (rows.type !== "some") { awaiting(kind.key, "rows"); pending.add(kind.key); continue; }
                wholeZones.push({ kind, rows: rows.value });
            } catch (error) {
                failed(kind.key, error, zones);
            }
        }

        // The far ends of the links and nets that touch a window (D17, §12): an end of a kind read by area its window
        // doesn't hold, where the other end is drawn in the window's reach — held by its window, or read whole there.
        const reach = viewport === undefined ? undefined : windowOf(viewport).reach;
        const placedAt = new Map<string, ItemRoles>();
        for (const { kind, rows } of wholeItems) for (const [key, entry] of rows) placedAt.set(`${kind.key}\u0000${key}`, entry.roles);
        const touches = (ref: SchematicRef): boolean => {
            const area = byArea.get(ref.kind);
            if (area !== undefined) return area.read.rows.has(ref.key);
            const roles = placedAt.get(`${ref.kind}\u0000${ref.key}`);
            const at = roles === undefined ? undefined : getSomeorUndefined(roles.position);
            return at !== undefined && reach !== undefined && at.x >= reach.minX && at.x <= reach.maxX && at.y >= reach.minY && at.y <= reach.maxY;
        };
        const far = new Map<string, Set<string>>();
        const wantFar = (ends: readonly SchematicRef[]) => {
            if (!ends.some(touches)) return;
            for (const end of ends) {
                const area = byArea.get(end.kind);
                if (area === undefined || area.read.rows.has(end.key)) continue;
                let keys = far.get(end.kind);
                if (keys === undefined) { keys = new Set(); far.set(end.kind, keys); }
                keys.add(end.key);
            }
        };
        if (byArea.size > 0) {
            for (const got of linkReads) {
                if (isRefused(got) || got.type !== "some") continue;
                for (const entry of got.value.values()) wantFar([entry.roles.from, entry.roles.to]);
            }
            for (const got of netReads) {
                if (isRefused(got) || got.type !== "some") continue;
                for (const entry of got.value.values()) wantFar([...entry.roles.sources, ...entry.roles.destinations]);
            }
        }

        // Each kind read by area: its far ends by key through its own paged read, its narrowing asked of its rows and theirs
        // in one request, its rows made its stored rows, and its items' details by the runs its window was read by.
        const areaRows = new Map<string, {
            readonly rows: Rows<unknown>; readonly details: Rows<DetailsRoles> | undefined; readonly unread: CardRoles | undefined; readonly reach: WorldBox;
        }>();
        for (const [slot, { kind, part, areas, read: windowRead }] of byArea) {
            const isItem = value.items.some((item) => Object.is(item, kind));
            // Its whole drawing's density, which the minimap draws: read beside its window, never holding the drawing up. One
            // that fails is said as its kind's read failing, with Retry, its rows still drawn.
            try {
                const whole = areaReader.overview(kind, part, areas, extent, dim);
                if (whole !== READING) overview.set(slot, whole);
            } catch (error) {
                failures.set(slot, messageOf(error));
            }
            try {
                // Only an item is a link's end or a net's member: a zone kind has no far ends.
                const paged = "paged" in kind ? getSomeorUndefined(kind.paged) : undefined;
                const farRows = areaReader.farEnds(slot, paged, [...(far.get(slot) ?? [])].sort(compareString));
                if (farRows === READING) { awaiting(slot, "area"); pending.add(slot); continue; }
                const narrowed = areaReader.narrowed(kind, part, windowRead, farRows, dim);
                if (narrowed === READING) { awaiting(slot, "area"); pending.add(slot); continue; }
                // Made over as many reads as their making takes, a frame drawing between.
                const made = areaReader.rowsOf(kind, narrowed);
                if (made === READING) { awaiting(slot, "area"); pending.add(slot); continue; }
                const rows = made as ReadonlyMap<string, { readonly roles: unknown; readonly row: Uint8Array }>;
                // At every zoom: a dot draws its item's status too (D45). Its rows draw while their details are read, each
                // card holding the places of the roles they give (#1398).
                let details: Rows<DetailsRoles> | undefined;
                let unread: CardRoles | undefined;
                if (kind.details.type === "some") {
                    const got = areaReader.detailsOf(slot, kind.details.value, part, windowRead);
                    if (got === READING) { unread = kind.details.value.roles; awaiting(slot, "details"); }
                    else if (got !== undefined) details = got as Rows<DetailsRoles>;
                }
                areaRows.set(slot, { rows, details, unread, reach: windowRead.window.reach });
                // The same object while its rows hold: what the frame hands on moves only when they do.
                windows.set(slot, areaReader.held(slot, windowRead.revision, rows));
                if (windowRead.density !== undefined) density.set(slot, windowRead.density);
                if (narrowed.matched !== undefined) matched.set(slot, narrowed.matched);
            } catch (error) {
                if (isItem) failed(slot, error, items);
                else failed(slot, error, zones);
            }
        }

        // What each kind draws, in the Schematic's order of its kinds.
        for (const kind of value.items) {
            if (pending.has(kind.key)) { carry(kind.key, items); continue; }
            const area = areaRows.get(kind.key);
            if (area !== undefined) { take(kind.key, area.rows as Rows<ItemRoles>, area.details, sameItem, drawnItem, items, area.unread, area.reach); continue; }
            const whole = wholeItems.find((one) => Object.is(one.kind, kind));
            if (whole !== undefined) take(kind.key, whole.rows, whole.details, sameItem, drawnItem, items, whole.unread);
        }
        for (const kind of value.zones) {
            if (pending.has(kind.key)) { carry(kind.key, zones); continue; }
            const area = areaRows.get(kind.key);
            if (area !== undefined) {
                take(kind.key, area.rows as Rows<ValueTypeOf<typeof Schematic.Types.Zone>>, undefined, sameZone, (ref, roles) => drawnZone(ref, roles), zones,
                    undefined, area.reach);
                continue;
            }
            const whole = wholeZones.find((one) => Object.is(one.kind, kind));
            if (whole !== undefined) take(kind.key, whole.rows, undefined, sameZone, (ref, roles) => drawnZone(ref, roles), zones);
        }
        value.links.forEach((kind, i) => {
            const got = linkReads[i]!;
            if (isRefused(got)) { failed(kind.key, got.refused, links); return; }
            if (got.type !== "some") { awaiting(kind.key, "rows"); carry(kind.key, links); return; }
            take(kind.key, got.value, undefined, sameLink, (ref, roles) => drawnLink(ref, roles), links);
        });
        value.nets.forEach((kind, i) => {
            const got = netReads[i]!;
            if (isRefused(got)) { failed(kind.key, got.refused, nets); return; }
            if (got.type !== "some") { awaiting(kind.key, "rows"); carry(kind.key, nets); return; }
            take(kind.key, got.value, undefined, sameNet, (ref, roles) => drawnNet(ref, roles), nets);
        });
        const drawn = changed || kinds.size !== prior.kinds.size ? { items, zones, links, nets } : prior.drawn;
        // The first kind in flight in the Schematic's order: what the footer's loading line names, what of it is read — and
        // how many of its rows wait on their details — and whether its source's narrowing has moved from the one its drawing
        // was read under, which stands in meanwhile.
        const first = [...value.items, ...value.zones, ...value.links, ...value.nets].find((kind) => inFlight.has(kind.key))?.key;
        const was = first === undefined ? undefined : prior.wheres.get(first);
        const now = first === undefined ? undefined : whereOf(first);
        let doing = first === undefined ? undefined : what.get(first) ?? "rows";
        let waiting = 0;
        if (first !== undefined && doing === "details") for (const kept of kinds.get(first)?.values() ?? []) if (kept.pending !== undefined && kept.drawn !== undefined) waiting += 1;
        // Every row drawn with the details it was drawn with, standing in — a new revision of them read again: none waits,
        // and the read is of the kind's rows in view, or whole.
        if (first !== undefined && doing === "details" && waiting === 0) doing = byArea.has(first) ? "area" : "rows";
        const reading: SchematicReading | undefined = first === undefined || doing === undefined ? undefined
            : { slot: first, what: doing, filtering: was !== undefined && now !== undefined && !sameWhere(was, now), waiting };
        // What the reads in flight have not drawn yet (CL2): each kind read by area whose window's rows or counts are read,
        // the reach it reads less the reach its drawing holds — never a kind whose read failed, which says so instead.
        const unread = unreadArea([...value.items, ...value.zones].flatMap((kind) => {
            const doingNow = what.get(kind.key);
            const want = areaReader.wanted(kind.key)?.reach;
            if ((doingNow !== "area" && doingNow !== "counts") || failures.has(kind.key) || want === undefined) return [];
            return [{ want, have: reaches.get(kind.key) }];
        }));
        // Whether what is drawn may be handed on: nothing in flight but details, whose rows draw meanwhile (#1398).
        const drawable = [...inFlight].every((slot) => what.get(slot) === "details");
        // The narrowing each kind's source holds now: what the drawing handed on was read under, or stands in for (CL8).
        const narrowings = new Map<string, Where>();
        for (const kind of [...value.items, ...value.zones, ...value.links, ...value.nets]) {
            const where = whereOf(kind.key);
            if (where !== undefined) narrowings.set(kind.key, where);
        }
        return {
            held: { value, kinds, inputs, wheres, reaches, drawn } satisfies Held, loading, reading, narrowings, failures, windows, density, overview,
            matched, unmade: areaReader.unmade, unread, failedAreas, drawable,
        };
    }, [value, attempt, viewport, areaReader, makes]);
    const { result } = useTrackedEvaluation(read);
    // A read that left rows to make asks the next a task later: a frame draws between, each read making a budget's worth.
    const unmade = result.ok && result.value.unmade;
    useEffect(() => {
        if (!unmade) return undefined;
        const timer = setTimeout(() => setMakes((n) => n + 1), 0);
        return () => clearTimeout(timer);
    }, [unmade, makes]);
    // What the last read said is read now, kept while it names the same kind the same way; and what it has not drawn yet,
    // kept while it is the same area.
    const readingRef = useRef<SchematicReading | undefined>(undefined);
    const unreadRef = useRef<readonly WorldBox[]>(NO_BOXES);
    // The last settled read: a newer one in flight keeps it, so a scan landing redraws nothing until the read is whole — but
    // for details, whose rows draw meanwhile, each card holding their places (#1398), once a first read has settled whole:
    // the frame opens on what its first read drew, details and all. What it holds moves with what it draws: a row added,
    // removed, or its roles or details changed, draws anew — and the narrowing each kind's drawing was read under.
    const settled = useRef<{
        drawn: SchematicDrawn; failures: ReadonlyMap<string, string>; rows: ReadonlyMap<string, number>; held: SchematicHeldRows;
        unplaced: SchematicUnplacedRows; windows: SchematicWindowRows; density: ReadonlyMap<string, SchematicDensity>;
        overview: ReadonlyMap<string, SchematicDensity>; matched: ReadonlyMap<string, ReadonlySet<string>>;
        failedAreas: ReadonlyMap<string, readonly WorldBox[]>; wheres: ReadonlyMap<string, Where>;
    } | undefined>(undefined);
    if (result.ok) {
        const got = result.value;
        held.current = got.held;
        if (!got.loading || (settled.current !== undefined && got.drawable)) {
            const rows = new Map([...got.held.kinds].map(([slot, kept]) => [slot, kept.size] as const));
            const was = settled.current;
            const overview = got.overview;
            if (was === undefined || !Object.is(was.drawn, got.held.drawn) || signatureOf(was.failures) !== signatureOf(got.failures)
                || signatureOf(was.rows) !== signatureOf(rows) || !sameEntries(was.windows, got.windows) || !sameEntries(was.density, got.density)
                || !sameEntries(was.overview, overview) || !sameEntries(was.matched, got.matched) || !sameAreas(was.failedAreas, got.failedAreas)
                || !sameWheres(was.wheres, got.held.wheres)) {
                settled.current = {
                    drawn: got.held.drawn,
                    failures: was !== undefined && signatureOf(was.failures) === signatureOf(got.failures) ? was.failures : got.failures,
                    rows: was !== undefined && signatureOf(was.rows) === signatureOf(rows) ? was.rows : rows,
                    held: got.held.kinds,
                    unplaced: unplacedOf(value, got.held.kinds),
                    windows: was !== undefined && sameEntries(was.windows, got.windows) ? was.windows : got.windows,
                    density: was !== undefined && sameEntries(was.density, got.density) ? was.density : got.density,
                    overview: was !== undefined && sameEntries(was.overview, overview) ? was.overview : overview,
                    matched: was !== undefined && sameEntries(was.matched, got.matched) ? was.matched : got.matched,
                    failedAreas: was !== undefined && sameAreas(was.failedAreas, got.failedAreas) ? was.failedAreas : got.failedAreas,
                    wheres: got.held.wheres,
                };
            }
        }
    }
    const last = settled.current;
    const loading = result.ok ? result.value.loading : false;
    const error = result.ok ? undefined : messageOf(result.error);
    // What the canvas draws stands in (#1398, CL8): a kind's drawing read under a narrowing its source no longer holds —
    // but one whose read of the new one failed, which says so instead.
    const filtering = result.ok && last !== undefined && [...result.value.narrowings].some(([slot, now]) => {
        const was = last.wheres.get(slot);
        return was !== undefined && !sameWhere(was, now) && !result.value.failures.has(slot);
    });
    // What is read now: the same object while it names the same kind the same way, so a landing that leaves it moves nothing.
    const readingNow = result.ok ? result.value.reading : undefined;
    const readingWas = readingRef.current;
    const reading = readingNow !== undefined && readingWas !== undefined && sameString(readingNow.slot, readingWas.slot)
        && readingNow.what === readingWas.what && readingNow.filtering === readingWas.filtering && readingNow.waiting === readingWas.waiting
        ? readingWas : readingNow;
    readingRef.current = reading;
    const unreadNow = result.ok ? result.value.unread : NO_BOXES;
    const unread = sameBoxes(unreadNow, unreadRef.current) ? unreadRef.current : unreadNow;
    unreadRef.current = unread;
    return useMemo((): SchematicData => (last === undefined
        ? { ...INITIAL_SCHEMATIC_DATA, loading, reading, error, unread }
        : {
            drawn: last.drawn, loading, reading, filtering, ready: true, error, failures: last.failures, rows: last.rows, held: last.held,
            unplaced: last.unplaced, windows: last.windows, density: last.density, overview: last.overview, matched: last.matched,
            unread, failedAreas: last.failedAreas,
        }),
    [last, loading, reading, filtering, error, unread]);
}

/**
 * Each item kind's rows a read holds with no position (#1389): the rows it
 * drew nothing of, each one's roles, in the read's order — for a kind whose
 * `x` and `y` are Options; none for a kind whose every row is placed.
 *
 * @param value - The payload the read was made under
 * @param kinds - Each kind's rows the read holds, by its slot
 * @returns The rows, by the kind's slot, then by key
 */
function unplacedOf(value: SchematicValue, kinds: ReadonlyMap<string, ReadonlyMap<string, Kept>>): SchematicUnplacedRows {
    const out = new Map<string, ReadonlyMap<string, ItemRoles>>();
    for (const kind of value.items) {
        if (!kind.backlog) continue;
        const rows = new Map<string, ItemRoles>();
        for (const [key, kept] of kinds.get(kind.key) ?? []) if (kept.drawn === undefined) rows.set(key, kept.roles as ItemRoles);
        out.set(kind.key, rows);
    }
    return out;
}

/**
 * The drawing's reads, in a component of its own (#1343): each scan and page
 * that lands re-runs it alone, and it hands the frame what it read only when
 * what the frame shows moves. It hears where the canvas's viewport rests from
 * the store the canvas writes (#1393), re-reading only itself as it moves. It
 * hands the frame what it read once its own render is done, so the frame
 * draws it in a task of its own: a read that settles a window of thousands of
 * rows, and the frame drawing them, are never one long task (#1393).
 *
 * @param props - The payload, the read's attempt, the viewport's store, and where the data goes
 * @returns Nothing: it reads
 */
export function SchematicDataReader({ value, attempt, viewport, onData }: {
    value: SchematicValue; attempt: number; viewport: SchematicViewportStore; onData: (data: SchematicData) => void;
}): null {
    const rests = useSyncExternalStore(viewport.subscribe, viewport.get, viewport.get);
    // Only a drawing with a kind read by area reads anything where the viewport rests: any other is read once.
    const byArea = useMemo(() => areaSlots(value).size > 0, [value]);
    const data = useSchematicData(value, attempt, byArea ? rests : undefined);
    const reported = useRef<SchematicData | undefined>(undefined);
    useEffect(() => {
        if (Object.is(reported.current, data)) return;
        reported.current = data;
        onData(data);
    });
    return null;
}
