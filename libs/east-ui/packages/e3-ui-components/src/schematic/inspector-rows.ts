/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The inspected entity's stored rows (#1391, `Schematic Builder Spec.md` §9),
 * read in a component of their own, as the Calendar's selection is (#1343):
 * the row its kind's record holds, and its details row, each as bytes. A kind's
 * rows hold it where its read does — its record read whole, or its narrowing
 * read through its source — else it is read by its key through the kind's
 * `entries`; a details record read whole holds its row, and one read by key is
 * asked for it. The reader hands the frame what it read only when that moves,
 * so a scan landing elsewhere redraws no inspector. What its drafts make of
 * the rows is the inspector's: the reads are the record's alone.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { BlobType, StringType, equalFor } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { SchematicRef } from "./canvas/drawn.js";
import type { SchematicValue } from "./data.js";

const blobEqual = equalFor(BlobType);
const stringEqual = equalFor(StringType);

/** A kind of any sort, as the payload carries it. */
type AnyKind = SchematicValue["items"][number] | SchematicValue["zones"][number] | SchematicValue["links"][number] | SchematicValue["nets"][number];
/** A kind's details, as the payload carries them. */
type Details = Extract<AnyKind["details"], { type: "some" }>["value"];

/** A stored row as a read finds it: its bytes, the record holding none of it, or its read in flight. */
export type SchematicRowRead =
    | { readonly state: "held"; readonly row: Uint8Array }
    | { readonly state: "absent" }
    | { readonly state: "reading" };

/** The inspected entity's stored rows. */
export interface SchematicInspectedRows {
    /** The entity read; `undefined` for none. */
    readonly ref: SchematicRef | undefined;
    /** Its row, as its kind's record holds it. */
    readonly row: SchematicRowRead;
    /** Its details row; `undefined` for a kind with no details. */
    readonly details: SchematicRowRead | undefined;
}

/** Nothing inspected: no row read. */
export const NO_INSPECTED_ROWS: SchematicInspectedRows = { ref: undefined, row: { state: "absent" }, details: undefined };

const READING: SchematicRowRead = { state: "reading" };
const ABSENT: SchematicRowRead = { state: "absent" };

/** A row read by its key through a record's `entries`. */
function byKey(entries: AnyKind["entries"], key: string): SchematicRowRead | undefined {
    if (entries.type !== "some") return undefined;
    const got = entries.value.entry(key);
    if (got.type !== "some") return READING;
    return got.value.type === "some" ? { state: "held", row: got.value.value } : ABSENT;
}

/**
 * A kind's stored row of a key: where its rows hold it, else by its key through
 * its `entries`.
 *
 * @param kind - The kind
 * @param key - The row's key
 * @returns The read
 */
export function storedRow(kind: AnyKind, key: string): SchematicRowRead {
    const rows = kind.rows();
    if (rows.type === "some") {
        const entry = rows.value.get(key);
        if (entry !== undefined) return { state: "held", row: entry.row };
    }
    return byKey(kind.entries, key) ?? (rows.type === "some" ? ABSENT : READING);
}

/**
 * A kind's details row of a key: where its details read whole hold it, else by
 * its key through their `entries`.
 *
 * @param details - The kind's details
 * @param key - The row's key
 * @returns The read
 */
export function storedDetailsRow(details: Details, key: string): SchematicRowRead {
    if (details.rows.type === "some") {
        const rows = details.rows.value();
        if (rows.type !== "some") return READING;
        const entry = rows.value.get(key);
        return entry === undefined ? ABSENT : { state: "held", row: entry.row };
    }
    return byKey(details.entries, key) ?? ABSENT;
}

/** Whether two reads say the same. */
function readEqual(a: SchematicRowRead | undefined, b: SchematicRowRead | undefined): boolean {
    if (a === undefined || b === undefined) return a === undefined && b === undefined;
    if (a.state === "held" || b.state === "held") return a.state === "held" && b.state === "held" && blobEqual(a.row, b.row);
    return a.state === b.state;
}

/** Whether two of what the reader read say the same. */
function rowsEqual(a: SchematicInspectedRows, b: SchematicInspectedRows): boolean {
    const sameRef = a.ref === undefined || b.ref === undefined ? a.ref === undefined && b.ref === undefined
        : stringEqual(a.ref.kind, b.ref.kind) && stringEqual(a.ref.key, b.ref.key);
    return sameRef && readEqual(a.row, b.row) && readEqual(a.details, b.details);
}

/**
 * Reads the inspected entity's stored rows (see the module docs), handing them
 * on only when what they say moves.
 *
 * @param props - The payload, the entity inspected — `undefined` for none — and where its rows go
 * @returns Nothing: it reads
 */
export function SchematicInspectedReader({ value, inspected, onRows }: {
    value: SchematicValue; inspected: SchematicRef | undefined; onRows: (rows: SchematicInspectedRows) => void;
}): null {
    const read = useCallback((): SchematicInspectedRows => {
        if (inspected === undefined) return NO_INSPECTED_ROWS;
        const kind = [...value.items, ...value.zones, ...value.links, ...value.nets].find((k) => stringEqual(k.key, inspected.kind));
        if (kind === undefined) return { ref: inspected, row: ABSENT, details: undefined };
        return {
            ref: inspected,
            row: storedRow(kind, inspected.key),
            details: kind.details.type === "some" ? storedDetailsRow(kind.details.value, inspected.key) : undefined,
        };
    }, [value, inspected]);
    const { result } = useTrackedEvaluation(read);
    const reported = useRef<SchematicInspectedRows | undefined>(undefined);
    useLayoutEffect(() => {
        // A read that fails reads as in flight: the inspector says it is reading, and the frame's banners say why.
        const rows = result.ok ? result.value : { ref: inspected, row: READING, details: undefined };
        const was = reported.current;
        if (was !== undefined && rowsEqual(was, rows)) return;
        reported.current = rows;
        onRows(rows);
    });
    return null;
}
