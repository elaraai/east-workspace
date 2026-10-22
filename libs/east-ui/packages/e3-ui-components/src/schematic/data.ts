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
 * over them (#1388), by which rows each read holds and their details' roles.
 *
 * Each kind is read on its own (#1387, SC32): a kind whose read fails keeps
 * what was drawn of it, says why under its slot, and leaves every other kind
 * read; the frame says so in a banner, with Retry. A read again — `attempt`
 * moving — reads every kind afresh.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import {
    EMPTY_DRAWN, drawnItem, drawnLink, drawnNet, drawnZone,
    type DetailsRoles, type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type SchematicDrawn, type SchematicRef,
} from "./canvas/drawn.js";

/** The Schematic's payload, decoded. */
export type SchematicValue = ValueTypeOf<typeof Schematic.Types.Payload>;

const sameItem = equalFor(Schematic.Types.Item);
const sameZone = equalFor(Schematic.Types.Zone);
const sameLink = equalFor(Schematic.Types.Link);
const sameNet = equalFor(Schematic.Types.Net);
const sameDetails = equalFor(Schematic.Types.DetailsRoles);

/** What the Schematic has read of its kinds' records. */
export interface SchematicData {
    /** What the canvas draws: the last settled read's entities. */
    readonly drawn: SchematicDrawn;
    /** Whether a read the drawing needs — a kind's rows, or its details read whole — is in flight. */
    readonly loading: boolean;
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
}

/** One row a kind's read holds: its details' roles, where its kind's details are read whole beside it. */
export interface SchematicHeldRow {
    readonly details: DetailsRoles | undefined;
}

/** Each kind's rows a read holds, by the kind's slot, then by key. */
export type SchematicHeldRows = ReadonlyMap<string, ReadonlyMap<string, SchematicHeldRow>>;

/** No kind failed. */
const NO_FAILURES: ReadonlyMap<string, string> = new Map();

/** No kind read. */
const NO_ROWS: ReadonlyMap<string, number> = new Map();

/** No row held. */
const NO_HELD: SchematicHeldRows = new Map();

/** The frame's data before its reader first reports: nothing drawn, a read in flight. */
export const INITIAL_SCHEMATIC_DATA: SchematicData = {
    drawn: EMPTY_DRAWN, loading: true, ready: false, error: undefined, failures: NO_FAILURES, rows: NO_ROWS, held: NO_HELD,
};

/** One entity as it was last drawn: the roles it was drawn from, its details' roles, and what was drawn — none for an unplaced item. */
interface Kept extends SchematicHeldRow {
    readonly roles: unknown;
    readonly drawn: unknown;
}

/** What was last read, for the payload it was read under: each kind's entities by its slot, then by key, and the drawing. */
interface Held {
    readonly value: SchematicValue | undefined;
    readonly kinds: ReadonlyMap<string, ReadonlyMap<string, Kept>>;
    readonly drawn: SchematicDrawn;
}

/** One kind's stored rows a read holds, each its roles. */
type Rows<R> = ReadonlyMap<string, { readonly roles: R }>;

/** Why a read failed, as the banner says it. */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** A map's entries as one string: equal whenever the map holds the same. */
function signatureOf(map: ReadonlyMap<string, string | number>): string {
    return [...map].map(([key, value]) => `${key}\u0000${value}`).join("\u0001");
}

/**
 * Reads the drawing (see the module docs).
 *
 * @param value - The payload
 * @param attempt - Moves to read every kind afresh: a Retry
 * @returns What the Schematic has read
 */
export function useSchematicData(value: SchematicValue, attempt = 0): SchematicData {
    const held = useRef<Held>({ value: undefined, kinds: new Map(), drawn: EMPTY_DRAWN });
    const read = useCallback(() => {
        // A Retry reads every kind again, from what was drawn.
        void attempt;
        // A payload built again holds functions of its own: what they draw is read again.
        const prior: Held = Object.is(held.current.value, value) ? held.current : { value, kinds: new Map(), drawn: EMPTY_DRAWN };
        const kinds = new Map<string, ReadonlyMap<string, Kept>>();
        const failures = new Map<string, string>();
        let loading = false;
        let changed = prior.kinds.size === 0;
        /** One kind's entities: each kept where its roles and its details read again as they were, else drawn again. */
        const take = <R, E>(slot: string, rows: Rows<R>, details: Rows<DetailsRoles> | undefined, same: (a: R, b: R) => boolean,
            draw: (ref: SchematicRef, roles: R, details: DetailsRoles | undefined) => E | undefined, out: E[]) => {
            const was = prior.kinds.get(slot);
            if (was === undefined || was.size !== rows.size) changed = true;
            const kept = new Map<string, Kept>();
            for (const [key, entry] of rows) {
                const its = details?.get(key)?.roles;
                const last = was?.get(key);
                const keep = last !== undefined && same(last.roles as R, entry.roles)
                    && (last.details === undefined ? its === undefined : its !== undefined && sameDetails(last.details, its));
                const drawn = keep ? last.drawn as E | undefined : draw({ kind: slot, key }, entry.roles, its);
                if (!keep) changed = true;
                kept.set(key, { roles: entry.roles, details: its, drawn });
                if (drawn !== undefined) out.push(drawn);
            }
            kinds.set(slot, kept);
        };
        /** A kind whose read failed: what was drawn of it stays, and why is kept under its slot. */
        const failed = <E>(slot: string, error: unknown, out: E[]) => {
            failures.set(slot, messageOf(error));
            const was = prior.kinds.get(slot);
            if (was === undefined) return;
            kinds.set(slot, was);
            for (const kept of was.values()) if (kept.drawn !== undefined) out.push(kept.drawn as E);
        };
        const items: DrawnItem[] = [];
        const zones: DrawnZone[] = [];
        const links: DrawnLink[] = [];
        const nets: DrawnNet[] = [];
        for (const kind of value.items) {
            try {
                const rows = kind.rows();
                // A kind's details read whole beside it: what its cards draw where the kind gives none.
                let details: Rows<DetailsRoles> | undefined;
                if (kind.details.type === "some" && kind.details.value.rows.type === "some") {
                    const got = kind.details.value.rows.value();
                    if (got.type === "some") details = got.value;
                    else loading = true;
                }
                if (rows.type !== "some") { loading = true; continue; }
                take(kind.key, rows.value, details, sameItem, drawnItem, items);
            } catch (error) {
                failed(kind.key, error, items);
            }
        }
        for (const kind of value.zones) {
            try {
                const rows = kind.rows();
                if (rows.type !== "some") { loading = true; continue; }
                take(kind.key, rows.value, undefined, sameZone, (ref, roles) => drawnZone(ref, roles), zones);
            } catch (error) {
                failed(kind.key, error, zones);
            }
        }
        for (const kind of value.links) {
            try {
                const rows = kind.rows();
                if (rows.type !== "some") { loading = true; continue; }
                take(kind.key, rows.value, undefined, sameLink, (ref, roles) => drawnLink(ref, roles), links);
            } catch (error) {
                failed(kind.key, error, links);
            }
        }
        for (const kind of value.nets) {
            try {
                const rows = kind.rows();
                if (rows.type !== "some") { loading = true; continue; }
                take(kind.key, rows.value, undefined, sameNet, (ref, roles) => drawnNet(ref, roles), nets);
            } catch (error) {
                failed(kind.key, error, nets);
            }
        }
        const drawn = changed || kinds.size !== prior.kinds.size ? { items, zones, links, nets } : prior.drawn;
        return { held: { value, kinds, drawn } satisfies Held, loading, failures };
    }, [value, attempt]);
    const { result } = useTrackedEvaluation(read);
    // The last settled read: a newer one in flight keeps it, so a scan landing redraws nothing until the read is whole.
    // What it holds moves with what it draws: a row added, removed, or its roles or details changed, draws anew.
    const settled = useRef<{
        drawn: SchematicDrawn; failures: ReadonlyMap<string, string>; rows: ReadonlyMap<string, number>; held: SchematicHeldRows;
    } | undefined>(undefined);
    if (result.ok) {
        const got = result.value;
        held.current = got.held;
        if (!got.loading) {
            const rows = new Map([...got.held.kinds].map(([slot, kept]) => [slot, kept.size] as const));
            const was = settled.current;
            if (was === undefined || !Object.is(was.drawn, got.held.drawn) || signatureOf(was.failures) !== signatureOf(got.failures)
                || signatureOf(was.rows) !== signatureOf(rows)) {
                settled.current = {
                    drawn: got.held.drawn,
                    failures: was !== undefined && signatureOf(was.failures) === signatureOf(got.failures) ? was.failures : got.failures,
                    rows: was !== undefined && signatureOf(was.rows) === signatureOf(rows) ? was.rows : rows,
                    held: got.held.kinds,
                };
            }
        }
    }
    const last = settled.current;
    const loading = result.ok ? result.value.loading : false;
    const error = result.ok ? undefined : messageOf(result.error);
    return useMemo((): SchematicData => (last === undefined
        ? { ...INITIAL_SCHEMATIC_DATA, loading, error }
        : { drawn: last.drawn, loading, ready: true, error, failures: last.failures, rows: last.rows, held: last.held }), [last, loading, error]);
}

/**
 * The drawing's reads, in a component of its own (#1343): each scan and page
 * that lands re-runs it alone, and it hands the frame what it read only when
 * what the frame shows moves.
 *
 * @param props - The payload, the read's attempt, and where the data goes
 * @returns Nothing: it reads
 */
export function SchematicDataReader({ value, attempt, onData }: { value: SchematicValue; attempt: number; onData: (data: SchematicData) => void }): null {
    const data = useSchematicData(value, attempt);
    const reported = useRef<SchematicData | undefined>(undefined);
    useLayoutEffect(() => {
        if (Object.is(reported.current, data)) return;
        reported.current = data;
        onData(data);
    });
    return null;
}
