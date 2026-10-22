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
    /** What the canvas draws: the last complete read's entities. */
    readonly drawn: SchematicDrawn;
    /** Whether a read the drawing needs — a kind's rows, or its details read whole — is in flight. */
    readonly loading: boolean;
    /** Whether a complete read has landed. */
    readonly ready: boolean;
    /** Why the latest read failed. */
    readonly error: string | undefined;
}

/** The frame's data before its reader first reports: nothing drawn, a read in flight. */
export const INITIAL_SCHEMATIC_DATA: SchematicData = { drawn: EMPTY_DRAWN, loading: true, ready: false, error: undefined };

/** One entity as it was last drawn: the roles it was drawn from, and what was drawn — none for an unplaced item. */
interface Kept {
    readonly roles: unknown;
    readonly details: DetailsRoles | undefined;
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

/**
 * Reads the drawing (see the module docs).
 *
 * @param value - The payload
 * @returns What the Schematic has read
 */
export function useSchematicData(value: SchematicValue): SchematicData {
    const held = useRef<Held>({ value: undefined, kinds: new Map(), drawn: EMPTY_DRAWN });
    const read = useCallback(() => {
        // A payload built again holds functions of its own: what they draw is read again.
        const prior: Held = Object.is(held.current.value, value) ? held.current : { value, kinds: new Map(), drawn: EMPTY_DRAWN };
        const kinds = new Map<string, ReadonlyMap<string, Kept>>();
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
        const items: DrawnItem[] = [];
        const zones: DrawnZone[] = [];
        const links: DrawnLink[] = [];
        const nets: DrawnNet[] = [];
        for (const kind of value.items) {
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
        }
        for (const kind of value.zones) {
            const rows = kind.rows();
            if (rows.type !== "some") { loading = true; continue; }
            take(kind.key, rows.value, undefined, sameZone, (ref, roles) => drawnZone(ref, roles), zones);
        }
        for (const kind of value.links) {
            const rows = kind.rows();
            if (rows.type !== "some") { loading = true; continue; }
            take(kind.key, rows.value, undefined, sameLink, (ref, roles) => drawnLink(ref, roles), links);
        }
        for (const kind of value.nets) {
            const rows = kind.rows();
            if (rows.type !== "some") { loading = true; continue; }
            take(kind.key, rows.value, undefined, sameNet, (ref, roles) => drawnNet(ref, roles), nets);
        }
        const drawn = changed || kinds.size !== prior.kinds.size ? { items, zones, links, nets } : prior.drawn;
        return { held: { value, kinds, drawn } satisfies Held, loading };
    }, [value]);
    const { result } = useTrackedEvaluation(read);
    // The last complete read: a newer one in flight keeps it, so a scan landing redraws nothing until the read is whole.
    const complete = useRef<SchematicData | undefined>(undefined);
    if (result.ok) {
        const got = result.value;
        held.current = got.held;
        if (!got.loading && (complete.current === undefined || !Object.is(complete.current.drawn, got.held.drawn))) {
            complete.current = { drawn: got.held.drawn, loading: false, ready: true, error: undefined };
        }
    }
    const last = complete.current;
    const loading = result.ok ? result.value.loading : false;
    const error = result.ok ? undefined : result.error instanceof Error ? result.error.message : String(result.error);
    return useMemo(() => last === undefined ? { ...INITIAL_SCHEMATIC_DATA, loading, error }
        : last.loading === loading && last.error === error ? last : { ...last, loading, error }, [last, loading, error]);
}

/**
 * The drawing's reads, in a component of its own (#1343): each scan and page
 * that lands re-runs it alone, and it hands the frame what it read only when
 * what the frame shows moves.
 *
 * @param props - The payload, and where the data goes
 * @returns Nothing: it reads
 */
export function SchematicDataReader({ value, onData }: { value: SchematicValue; onData: (data: SchematicData) => void }): null {
    const data = useSchematicData(value);
    const reported = useRef<SchematicData | undefined>(undefined);
    useLayoutEffect(() => {
        if (Object.is(reported.current, data)) return;
        reported.current = data;
        onData(data);
    });
    return null;
}
