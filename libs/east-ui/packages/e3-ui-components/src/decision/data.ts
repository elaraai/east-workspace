/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's reads of the app's cases (`Decision Queue Spec.md`
 * R1–R6, D4, D5), in a component of their own, as every builder's are
 * (#1343): the cases through the payload's `decisions`, as the Plan and the
 * Sheet read rows — the record read whole, in its key order, or the slice's
 * `decisions` source a window at a time around the view as the list scrolls
 * and comes to rest, in its index's order — through the shared paged reading
 * the paged Library reads its rows by (`usePagedRows`). There is no cap, and
 * nothing is sorted or narrowed in the browser: each case's row holds its
 * verdict. A new narrowing's, revision's or count's cases are read while the
 * cases that last landed stand in, retained, and are swapped whole once they
 * land (R5, #1398 CL8), a new narrowing's from its start. What it read is
 * handed to the frame only when it moves.
 *
 * Whether the open case has left the list (R6) is read apart, in a component
 * of its own too, only while the cases read do not hold it: read whole, it has
 * left; through the slice's source, it is read by its key at the record's
 * revision and asked of the source's narrowing, as the Schematic's selected
 * rows are, and has left once its record holds none of it or the narrowing
 * leaves it out.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { StringType, equalFor, none } from "@elaraai/east";
import { DECISIONS_SOURCE, DecisionCaseType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import {
    readPagedWindows, recordSliceRevision, recordSliceRows, recordSliceWithin, usePagedRows,
    type PAGED_RETAINED, type PagedRange, type PagedRows, type PagedRowsRead,
} from "@elaraai/east-ui-components/internal";
import { sourcePart } from "../shared/schedule/visibility.js";
import { keyOfText, type DecisionQueueValue } from "./editing.js";
import type { DecisionCase } from "./cases.js";
import { decisionQueueMessages } from "./messages.js";

const caseEqual = equalFor(DecisionCaseType);
const stringEqual = equalFor(StringType);

/** One read of the cases: how many there are, those read by their place, and the revision they were read at. */
export type DecisionRead = PagedRowsRead<DecisionCase>;

/** What the queue has read. */
export interface DecisionData {
    /** The cases to draw: the read that last landed while a new one stands behind it or the read throws; `undefined` before one lands. */
    readonly read: DecisionRead | undefined;
    /** Whether the cases that last landed stand in, retained (R5): a new narrowing's, revision's or count's are read. */
    readonly standing: boolean;
    /** Whether they stand in for a new narrowing, whose cases are read from their start. */
    readonly filtering: boolean;
    /** Whether the list waits on a read: cases standing in, or cases in view not read yet. */
    readonly reading: boolean;
    /** Whether a read has landed: the frame's cold load is over (#1398, CL5). */
    readonly landed: boolean;
    /** The narrowing the cases drawn are of: the list keys its view by it, so a new narrowing's starts at its start. */
    readonly identity: string;
    /** Hears where the list's view rests: what its `VirtualRows` reports. */
    readonly onRangeChange: PagedRows<DecisionRead>["onRangeChange"];
    /** The retained content's attributes on the list while the cases stand in; `undefined` while they are live. */
    readonly retained: typeof PAGED_RETAINED | undefined;
    /** Why the latest read failed. */
    readonly error: string | undefined;
    /** Reads the cases again. */
    readonly retry: () => void;
}

const NO_RANGE = (): void => {};
const NO_RETRY = (): void => {};

/** Before any read: nothing read, nothing landed. */
export const INITIAL_DATA: DecisionData = {
    read: undefined, standing: false, filtering: false, reading: true, landed: false, identity: "", onRangeChange: NO_RANGE,
    retained: undefined, error: undefined, retry: NO_RETRY,
};

/** A read in flight: nothing counted, nothing read. */
const NOT_READ: DecisionRead = { count: undefined, rows: new Map(), revision: undefined };

/** The record read whole as it last read: each case by its key, so one that reads back as it was keeps its object. */
type WholeCases = ReadonlyMap<string, DecisionCase>;

/** Two reads drawing the same: the same count and revision, and the same case at every place. */
function sameRead(a: DecisionRead | undefined, b: DecisionRead | undefined): boolean {
    if (Object.is(a, b)) return true;
    if (a === undefined || b === undefined) return false;
    if (!Object.is(a.count, b.count) || !Object.is(a.revision, b.revision) || a.rows.size !== b.rows.size) return false;
    for (const [at, c] of a.rows) if (!Object.is(b.rows.get(at), c)) return false;
    return true;
}

/** Two reports the same: the frame would draw nothing new. */
function sameData(a: DecisionData, b: DecisionData): boolean {
    return sameRead(a.read, b.read) && a.standing === b.standing && a.filtering === b.filtering && a.reading === b.reading
        && a.landed === b.landed && Object.is(a.identity, b.identity) && a.onRangeChange === b.onRangeChange && a.retained === b.retained
        && Object.is(a.error, b.error) && a.retry === b.retry;
}

/**
 * Reads the cases (see the module docs).
 *
 * @param value - The payload
 * @returns What the queue has read
 */
export function useDecisionData(value: DecisionQueueValue): DecisionData {
    const { cases, entries } = value.decisions;
    const live = cases.type === "paged" ? cases.value : undefined;
    // Retry runs the reads again, after asking the cases' records again.
    const [nonce, setNonce] = useState(0);
    // The narrowing the cases are read under, read apart (#1354): a choice moves it, and the cases are read from their start.
    const readNarrowing = useCallback(() => live?.query() ?? "", [live]);
    const { result: narrowing } = useTrackedEvaluation(readNarrowing);
    const identity = live === undefined ? "whole" : `${live.id}|${narrowing.ok ? narrowing.value : ""}`;
    // The record read whole, apart from where the list rests: every case at once, so a scroll reads nothing again.
    const whole = useRef<WholeCases | undefined>(undefined);
    const readWhole = useCallback((): DecisionRead => {
        void nonce;
        if (cases.type !== "whole") return NOT_READ;
        const got = cases.value();
        if (got.type !== "some") return NOT_READ;
        const was = whole.current;
        const byKey = new Map<string, DecisionCase>();
        const rows = new Map<number, DecisionCase>();
        got.value.forEach((c, at) => {
            const held = was?.get(c.key);
            const kept = held !== undefined && caseEqual(held, c) ? held : c;
            byKey.set(c.key, kept);
            rows.set(at, kept);
        });
        whole.current = byKey;
        return { count: got.value.length, rows, revision: undefined };
    }, [cases, nonce]);
    const { result: wholeRead } = useTrackedEvaluation(readWhole);
    // The windows around the view, through the slice's source (R1): the rows of a range the paged reading asks for.
    const read = useCallback((range: PagedRange): DecisionRead => {
        void nonce;
        if (cases.type !== "paged") {
            if (!wholeRead.ok) throw wholeRead.error;
            return wholeRead.value;
        }
        const source = cases.value;
        const revision = source.revision();
        const total = source.total();
        const count = total.type === "some" ? Number(total.value) : undefined;
        const rows = revision.type === "some" ? readPagedWindows(range, count, (offset, limit) => source.page(offset, limit)) : new Map<number, DecisionCase>();
        return { count, rows, revision: revision.type === "some" ? revision.value : undefined };
    }, [cases, wholeRead, nonce]);
    // The cases that last landed stand in, retained, while a new narrowing's, revision's or count's land (R5).
    const paged = usePagedRows<DecisionCase, DecisionRead>(identity, read);
    const part = sourcePart(value.slice.type === "some" ? value.slice.value : undefined, DECISIONS_SOURCE);
    const retry = useCallback(() => {
        if (live !== undefined) live.refresh(none);
        if (entries.type === "some") entries.value.refresh(none);
        part?.retry();
        setNonce(n => n + 1);
    }, [live, entries, part]);
    const failed = paged.result.ok ? undefined : paged.result.error;
    return {
        // What last landed stays drawn while the read throws.
        read: paged.shown ?? paged.held, standing: paged.standing, filtering: paged.filtering, reading: paged.reading, landed: paged.landed,
        identity: paged.identity, onRangeChange: paged.onRangeChange, retained: paged.retained,
        error: failed === undefined ? undefined : failed instanceof Error ? failed.message : String(failed), retry,
    };
}

/**
 * The queue's reads, in a component of their own (#1343): each window that
 * lands re-runs it alone, and it hands the frame what it read only when that
 * moves.
 *
 * @param props - The payload, and where the data goes
 * @returns Nothing: it reads
 */
export const DecisionDataReader = memo(function DecisionDataReader({ value, onData }: {
    readonly value: DecisionQueueValue; readonly onData: (data: DecisionData) => void;
}): null {
    const data = useDecisionData(value);
    const reported = useRef<DecisionData | undefined>(undefined);
    useLayoutEffect(() => {
        const was = reported.current;
        if (was !== undefined && sameData(was, data)) return;
        reported.current = data;
        onData(data);
    });
    return null;
});

/**
 * Whether a read holds a case.
 *
 * @param read - The read
 * @param key - The case's key
 * @returns Whether a case of the read is the one keyed `key`
 */
function holds(read: DecisionRead, key: string): boolean {
    for (const c of read.rows.values()) if (stringEqual(c.key, key)) return true;
    return false;
}

/**
 * Whether the open case has left the list (R6; see the module docs), in a
 * component of its own: each answer landing re-runs it alone, and it tells the
 * frame once a read proves the case gone.
 *
 * @param props - The payload, the case the viewer opened, the cases drawn, whether they stand in for a new read, and
 *   where a case gone is told
 * @returns Nothing: it reads
 */
export const DecisionOpenReader = memo(function DecisionOpenReader({ value, open, read, standing, onGone }: {
    readonly value: DecisionQueueValue;
    /** The case the viewer opened; `undefined` for none, or for the first waiting case, which a read always holds. */
    readonly open: string | undefined;
    readonly read: DecisionRead | undefined;
    readonly standing: boolean;
    readonly onGone: (key: string) => void;
}): null {
    const readGone = useCallback((): boolean => {
        // A read standing in for a new one proves nothing yet; one that holds the case keeps it in the list.
        if (open === undefined || read === undefined || read.count === undefined || standing || holds(read, open)) return false;
        // Read whole: every case is in the read.
        if (value.decisions.cases.type === "whole") return true;
        const part = sourcePart(value.slice.type === "some" ? value.slice.value : undefined, DECISIONS_SOURCE);
        if (part === undefined || read.revision === undefined) return false;
        // Asked at the revision the read was made at: a read still to land at a newer one proves nothing yet.
        const revision = recordSliceRevision(part);
        if (revision.type !== "some" || !stringEqual(revision.value, read.revision)) return false;
        const key = keyOfText({ name: decisionQueueMessages.casesSession(), editing: value.decisions.editing }, open);
        const rows = recordSliceRows(part, [key]);
        if (rows.type !== "some") return false;
        const row = rows.value[0];
        // Its record holds none of it.
        if (row === undefined || row.type !== "some") return true;
        const where = part.read().where;
        if (where.size === 0) return false;
        // Its narrowing leaves it out.
        const within = recordSliceWithin(part, where, [{ key, row: row.value }]);
        return within.type === "some" && within.value[0] !== true;
    }, [value, open, read, standing]);
    const { result } = useTrackedEvaluation(readGone);
    // A read that fails proves nothing: the case stays open, and the cases' own read says what failed.
    const gone = result.ok && result.value;
    useEffect(() => {
        if (gone && open !== undefined) onGone(open);
    }, [gone, open, onGone]);
    return null;
});
