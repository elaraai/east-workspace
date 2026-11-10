/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows the Schematic draws whose numbers their fields' bounds don't hold
 * (#1585): an entity whose row, or its details row, breaks a bound of its
 * record's form wears the warn ring, stored or changed, as one holding a
 * conflict does, and a stored row's breach is a warning in Issues that holds
 * no Save — a changed row's is its session's readiness's, which does
 * (`issues.ts`). A form holding no number to a least or a most is read for
 * nothing. Each row the drawing draws is checked as its draft has it, else as
 * the Schematic's reads hold it — its kind's `rows`, its record read whole or
 * its narrowing read complete through its source; a kind read by area's
 * window; a kind's details read whole — and never read by its key: a details
 * record read by key, or a kind read by area's, is checked where a draft holds
 * its row.
 *
 * The read runs in a component of its own, {@link SchematicBoundsReader}: what
 * it reads is read again only as the reads move, never as a gesture does, and
 * the frame is handed the breaches only as they move (#1343).
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { StringType, equalFor, fromEastTypeValue, type EastType } from "@elaraai/east";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { fieldBreachIssue, fieldBreaches, useTrackedEvaluation, type FieldBreach } from "@elaraai/east-ui-components";
import { isBounded, rowBreaches } from "../shared/bounds.js";
import type { ScheduleEditing } from "../shared/schedule/editing.js";
import { draftedRow } from "../shared/schedule/records.js";
import { fieldLabelOf } from "../shared/schedule/refusals.js";
import type { SchematicDrawn } from "./canvas/drawn.js";
import type { SchematicValue, SchematicWindowRows } from "./data.js";
import type { SchematicBreach, SchematicBreaches } from "./issues.js";
import { detailsKey } from "./record-keys.js";

const stringEqual = equalFor(StringType);

/** A kind of any sort, as the payload carries it. */
type AnyKind = SchematicValue["items"][number] | SchematicValue["zones"][number] | SchematicValue["links"][number] | SchematicValue["nets"][number];

/** Rows as a read holds them, by key: each its bytes. */
type HeldRows = ReadonlyMap<string, { readonly row: Uint8Array }>;

/** No row breaking its field's bounds. */
export const NO_BREACHES: SchematicBreaches = new Map();

/** No stored row read. */
const NO_STORED: ReadonlyMap<string, HeldRows> = new Map();

/** No bound broken. */
const NONE: readonly FieldBreach[] = [];

/** A record whose form holds a number to bounds, and where its stored rows are read. */
interface BoundedRecord {
    /** Its key in the history: its kind's slot, or its details record's (`detailsKey`). */
    readonly record: string;
    /** Its form: what a breach names its field by. */
    readonly fields: readonly FieldSpecValue[];
    /** Its form's fields held to bounds. */
    readonly bounded: readonly FieldSpecValue[];
    /** One stored row's breaches, by its bytes. */
    readonly breachesOf: (bytes: Uint8Array) => readonly FieldBreach[];
    /**
     * Where its stored rows are read: its kind's `rows`, its kind's window (read by area), or its details read whole;
     * `undefined` for a record read by key, whose stored rows no read here asks for.
     */
    readonly reads: "rows" | "window" | "details" | undefined;
}

/** A kind with a record whose form holds a number to bounds, and its records so held: its own, then its details'. */
interface BoundedKind {
    readonly kind: AnyKind;
    readonly records: readonly BoundedRecord[];
}

/** Whether two of what the reader found say the same, in the same order. */
function sameBreaches(a: SchematicBreaches, b: SchematicBreaches): boolean {
    if (a.size !== b.size) return false;
    const theirs = [...b];
    return [...a].every(([id, found], i) => {
        const [other, said] = theirs[i]!;
        return stringEqual(id, other) && found.length === said.length && found.every((breach, j) => {
            const them = said[j]!;
            return stringEqual(breach.record, them.record) && stringEqual(breach.field, them.field) && stringEqual(breach.message, them.message)
                && breach.changed === them.changed;
        });
    });
}

/** Props of {@link SchematicBoundsReader}. */
export interface SchematicBoundsReaderProps {
    /** The payload: each kind, its form and its details' form. */
    value: SchematicValue;
    /** The kinds read by area, by slot: their stored rows are their windows'. */
    areas: ReadonlySet<string>;
    /** The rows each kind read by area holds in its window. */
    windows: SchematicWindowRows;
    /** What the canvas draws: the stored rows, the drafts in place — the rows checked. */
    drawing: SchematicDrawn;
    /** The editing over the records: each record's session, whose drafts are checked as they stand, and which rows they changed. */
    schedule: Pick<ScheduleEditing, "sessions" | "draftsOf">;
    /** The history's version: it moves with every change of the sessions. */
    version: number;
    /** Where the breaches go: called only when they move. */
    onBreaches: (breaches: SchematicBreaches) => void;
}

/**
 * The rows the drawing draws whose numbers their fields' bounds don't hold,
 * read in a component of its own (see the module docs). A read in flight, or
 * one that failed, holds none of its rows: the frame says why it failed.
 *
 * @param props - The payload, the kinds read by area and their windows, the drawing, the editing, and where the breaches go
 * @returns Nothing: it reads
 */
export function SchematicBoundsReader({ value, areas, windows, drawing, schedule, version, onBreaches }: SchematicBoundsReaderProps): null {
    const checked = useMemo(() => [...value.items, ...value.zones, ...value.links, ...value.nets].flatMap((kind): BoundedKind[] => {
        const records: BoundedRecord[] = [];
        const byArea = areas.has(kind.key);
        const own = kind.fields.filter(isBounded);
        if (own.length > 0) {
            records.push({
                record: kind.key, fields: kind.fields, bounded: own, breachesOf: rowBreaches(own, fromEastTypeValue(kind.rowType) as EastType),
                reads: byArea ? "window" : "rows",
            });
        }
        const details = kind.details.type === "some" ? kind.details.value : undefined;
        const theirs = details?.fields.filter(isBounded) ?? [];
        if (details !== undefined && theirs.length > 0) {
            records.push({
                record: detailsKey(kind.key), fields: details.fields, bounded: theirs, breachesOf: rowBreaches(theirs, fromEastTypeValue(details.rowType) as EastType),
                reads: details.rows.type === "some" && !byArea ? "details" : undefined,
            });
        }
        return records.length === 0 ? [] : [{ kind, records }];
    }), [value.items, value.zones, value.links, value.nets, areas]);
    // The stored rows each record's read holds, by its key in the history: the reads the drawing's are, so no request of
    // their own, read again only as they move.
    const read = useCallback((): ReadonlyMap<string, HeldRows> => {
        const out = new Map<string, HeldRows>();
        for (const { kind, records } of checked) {
            for (const { record, reads } of records) {
                try {
                    if (reads === "rows") {
                        const got = kind.rows();
                        if (got.type === "some") out.set(record, got.value);
                    } else if (reads === "details" && kind.details.type === "some" && kind.details.value.rows.type === "some") {
                        const got = kind.details.value.rows.value();
                        if (got.type === "some") out.set(record, got.value);
                    }
                } catch {
                    // Its kind's read failed, which the frame says: none of its rows is checked here meanwhile.
                    continue;
                }
            }
        }
        return out;
    }, [checked]);
    const { result } = useTrackedEvaluation(read);
    const stored = result.ok ? result.value : NO_STORED;
    const { sessions, draftsOf } = schedule;
    const now = useMemo((): SchematicBreaches => {
        if (checked.length === 0) return NO_BREACHES;
        const out = new Map<string, SchematicBreach[]>();
        const byKind = new Map(checked.map(({ kind, records }) => [kind.key, records] as const));
        const sessionOf = new Map(sessions.map((part) => [part.kind, part.session] as const));
        for (const entity of [...drawing.items, ...drawing.zones, ...drawing.links, ...drawing.nets]) {
            const records = byKind.get(entity.ref.kind);
            if (records === undefined) continue;
            const key = entity.ref.key;
            for (const { record, fields, bounded, breachesOf, reads } of records) {
                // As its draft has it, else as its read holds it.
                const entry = sessionOf.get(record)?.entries.get(key);
                let found = NONE;
                if (entry !== undefined) {
                    const drafted = draftedRow(entry);
                    if (drafted !== undefined) found = fieldBreaches(bounded, drafted.row);
                } else {
                    const bytes = (reads === "window" ? windows.get(entity.ref.kind)?.rows : stored.get(record))?.get(key)?.row;
                    if (bytes !== undefined) found = breachesOf(bytes);
                }
                if (found.length === 0) continue;
                const changed = draftsOf(record).has(key);
                let said = out.get(entity.key);
                if (said === undefined) {
                    said = [];
                    out.set(entity.key, said);
                }
                // In the words its session's readiness says a changed row's in.
                for (const breach of found) said.push({ record, field: fieldLabelOf(fields, breach.key), message: fieldBreachIssue(breach, { entry: key }).message, changed });
            }
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the sessions are mutable: the history's version says they moved
    }, [checked, stored, windows, drawing, sessions, draftsOf, version]);
    const reported = useRef(NO_BREACHES);
    useLayoutEffect(() => {
        if (sameBreaches(reported.current, now)) return;
        reported.current = now;
        onBreaches(now);
    });
    return null;
}
