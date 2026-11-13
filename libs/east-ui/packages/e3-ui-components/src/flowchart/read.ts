/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's reads of the app's records (#1502, `Flowchart Records
 * Spec.md` R5, R6, D7), in a component of its own, as the Schematic's are
 * (`schematic/data.ts`): each kind's stored rows through its `rows()` — its
 * record read whole, or its narrowing read complete through its source of the
 * rail, page by page until done, four pages in flight at most (`PagedScan`,
 * inside the kind's own function) — never a window of it, with no cap and no
 * banner. The lanes and the decisions are read whole.
 *
 * - **Under `"hide"`** a transition kept whose end no state read holds has
 *   that end read by key through the states' source (`recordSliceRows`, the
 *   Plan's link ends' read), every such end in one request, at the states' key
 *   type (#1549): found, the state the narrowing hides holds it, and the
 *   transition is hidden with it; absent — or a text no key of theirs prints
 *   as — the end is a ghost, and Issues lists it. Under `"dim"` every row is
 *   read, so an end no state holds is absent.
 * - **The last settled read stands** while a newer one is in flight, so a new
 *   narrowing keeps what the canvas drew, busy, and the footer's loading line
 *   says what is read (`reading`) and whether it is a new narrowing
 *   (`filtering`). A read the flowchart has never settled is the frame's cold
 *   load: nothing drawn, never as empty.
 * - **Each kind is read on its own**: one whose read fails keeps what was
 *   drawn of it and says why under its kind, every other kind read; a read
 *   again — `attempt` moving — reads every kind afresh.
 *
 * It reads the stored rows alone: the frame draws the editing session's drafts
 * over them (`drafted.ts`). A kind's rows read again as they were — the same
 * keys, each row's bytes the same — are the same object, so the frame is handed
 * what it reads only when that moves. Beside them it says the revision each
 * kind read by key was read at (`revisions`) and the one its record reads at
 * now, whatever is in flight (`now`): rows read at another are from before it,
 * which tells stored rows read before a Save from rows read since.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { BlobType, StringType, SortedSet, compareFor, equalFor, type ValueTypeOf, type option } from "@elaraai/east";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { recordSliceRows } from "@elaraai/east-ui-components/internal";
import { kindKeys } from "../shared/schedule/kind-keys.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import type { FlowchartDecisionRoles, FlowchartLaneRoles, FlowchartStateRoles, FlowchartTransitionRoles, FlowchartValue } from "./model.js";

/** The Flowchart's kinds, by the prop each fills — and the slot each keeps its reads, its session and its failures under. */
export type FlowchartSort = "states" | "transitions" | "lanes" | "decisions";

/** The kinds in the Flowchart's order: what the loading line names first. */
export const FLOWCHART_SORTS: readonly FlowchartSort[] = ["states", "transitions", "lanes", "decisions"];

/** The kinds read through a source of the rail, each named after the kind. */
export const SOURCE_SORTS: readonly ("states" | "transitions")[] = ["states", "transitions"];

/** One stored row a read holds: its roles, read with it, and its row's bytes at the record's row type. */
export interface FlowchartStoredRow<R> {
    /** Its roles. */
    readonly roles: R;
    /** Its row, as bytes. */
    readonly row: Uint8Array;
}

/** A kind's stored rows a read holds, by key. */
export type FlowchartStored<R> = ReadonlyMap<string, FlowchartStoredRow<R>>;

/** Each kind's stored rows the settled read holds; `undefined` for a kind the Flowchart is not given. */
export interface FlowchartHeld {
    /** The states: the rows the narrowing keeps, or every row under `"dim"`. */
    readonly states: FlowchartStored<FlowchartStateRoles>;
    /** The transitions. */
    readonly transitions: FlowchartStored<FlowchartTransitionRoles> | undefined;
    /** The lanes, read whole. */
    readonly lanes: FlowchartStored<FlowchartLaneRoles> | undefined;
    /** The decisions, read whole. */
    readonly decisions: FlowchartStored<FlowchartDecisionRoles> | undefined;
}

/** What the Flowchart reads now, as the footer's loading line says it: the first kind in flight, and whether the read is of a new narrowing. */
export interface FlowchartReading {
    /** The kind. */
    readonly sort: FlowchartSort;
    /** Whether its source's narrowing is not the one its drawing was read under, which stands in meanwhile: `Updating states…`. */
    readonly filtering: boolean;
}

/** What the Flowchart has read of its kinds' records. */
export interface FlowchartData {
    /** Whether a read has settled: every kind read, or its read failed. */
    readonly ready: boolean;
    /** Whether a read is in flight. */
    readonly loading: boolean;
    /** What is read now, the first kind in flight in the Flowchart's order; `undefined` while nothing is. */
    readonly reading: FlowchartReading | undefined;
    /** Whether what is drawn of a kind was read under a narrowing its source no longer holds, the new one in flight: it stands in, kept, taking no edit. */
    readonly filtering: boolean;
    /** Why the read as a whole failed — outside any one kind's. */
    readonly error: string | undefined;
    /** Why a kind's read failed, by the kind. */
    readonly failures: ReadonlyMap<FlowchartSort, string>;
    /** Each kind's stored rows the settled read holds. */
    readonly held: FlowchartHeld;
    /**
     * The transitions held whose end no state read holds and the states' narrowing hides (D7), by key: hidden with it —
     * never drawn, and never an issue — yet held, so a state's Del deletes them with it (R10).
     */
    readonly hiddenWith: ReadonlySet<string>;
    /** The revision each kind's held rows were read at, for a kind its record is read by key of (its `entries`); none for one read whole. */
    readonly revisions: ReadonlyMap<FlowchartSort, string>;
    /**
     * The revision each such kind's record reads at now, whatever of the read is in flight: held rows read at another
     * are from before it (`drafted.ts`' `landedDrafts`).
     */
    readonly now: ReadonlyMap<FlowchartSort, string>;
}

const compareString = compareFor(StringType);
const sameString = equalFor(StringType);
const sameBytes = equalFor(BlobType);
const sameWhere = equalFor(RecordSliceWhereType);

/** A record Slice's narrowing, decoded. */
type Where = ValueTypeOf<typeof RecordSliceWhereType>;

/** No row held. */
const NO_ROWS: ReadonlyMap<string, never> = new Map<string, never>();

/** No transition hidden with its far end. */
const NO_KEYS: ReadonlySet<string> = new SortedSet<string>([], compareString);

/** No kind failed. */
const NO_FAILURES: ReadonlyMap<FlowchartSort, string> = new Map<FlowchartSort, string>();

/** No kind whose record names a revision. */
const NO_REVISIONS: ReadonlyMap<FlowchartSort, string> = new Map<FlowchartSort, string>();

/** Nothing held: a frame before its first read settles. */
const NOTHING_HELD: FlowchartHeld = { states: NO_ROWS, transitions: undefined, lanes: undefined, decisions: undefined };

/** The frame's data before its reader first reports: nothing drawn, a read in flight. */
export const INITIAL_FLOWCHART_DATA: FlowchartData = {
    ready: false, loading: true, reading: undefined, filtering: false, error: undefined, failures: NO_FAILURES, held: NOTHING_HELD, hiddenWith: NO_KEYS,
    revisions: NO_REVISIONS, now: NO_REVISIONS,
};

/** Why a read failed, as the box says it. */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * A kind's rows as they were, where they read again as they were: the same keys, each row's bytes the same.
 *
 * @param was - The rows last held
 * @param now - The rows read now
 * @returns `was` where they hold the same, else `now`
 */
function steady<R>(was: FlowchartStored<R> | undefined, now: FlowchartStored<R>): FlowchartStored<R> {
    if (was === undefined || was.size !== now.size) return now;
    for (const [key, entry] of now) {
        const last = was.get(key);
        if (last === undefined || !sameBytes(last.row, entry.row)) return now;
    }
    return was;
}

/** Two sets of keys holding the same keys. */
function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) return false;
    for (const key of a) if (!b.has(key)) return false;
    return true;
}

/** Two maps of failures saying the same. */
function sameFailures(a: ReadonlyMap<FlowchartSort, string>, b: ReadonlyMap<FlowchartSort, string>): boolean {
    if (a.size !== b.size) return false;
    for (const [sort, why] of a) {
        const other = b.get(sort);
        if (other === undefined || !sameString(other, why)) return false;
    }
    return true;
}

/** A kind as its read takes it: its stored rows, `none` while in flight, and its record read by key, whose revision they are read at. */
interface RowsReader {
    readonly rows: () => option<FlowchartStored<unknown>>;
    readonly entries: option<{ readonly revision: () => option<string> }>;
}

/** Two maps of revisions saying the same. */
function sameRevisions(a: ReadonlyMap<FlowchartSort, string>, b: ReadonlyMap<FlowchartSort, string>): boolean {
    if (a.size !== b.size) return false;
    for (const [sort, revision] of a) {
        const other = b.get(sort);
        if (other === undefined || !sameString(other, revision)) return false;
    }
    return true;
}

/** What one read of every kind gave: each kind's rows where they landed, why one failed, what is in flight, the far ends' verdict and the narrowings read under. */
interface Read {
    readonly rows: { -readonly [S in FlowchartSort]?: FlowchartStored<unknown> };
    readonly failures: ReadonlyMap<FlowchartSort, string>;
    readonly inFlight: ReadonlySet<FlowchartSort>;
    readonly hiddenWith: ReadonlySet<string>;
    readonly wheres: ReadonlyMap<FlowchartSort, Where>;
    /** The revision each kind read by key reads at now: what the rows this read holds of it were read at. */
    readonly now: ReadonlyMap<FlowchartSort, string>;
}

/**
 * Reads the records (see the module docs).
 *
 * @param value - The payload
 * @param attempt - Moves to read every kind afresh: a Retry
 * @returns What the Flowchart has read
 */
export function useFlowchartData(value: FlowchartValue, attempt = 0): FlowchartData {
    const read = useCallback((): Read => {
        // A Retry reads every kind again.
        void attempt;
        const chrome = getSomeorUndefined(value.slice);
        const rows: Read["rows"] = {};
        const failures = new Map<FlowchartSort, string>();
        const inFlight = new Set<FlowchartSort>();
        const now = new Map<FlowchartSort, string>();
        const take = (sort: FlowchartSort, kind: RowsReader | undefined) => {
            if (kind === undefined) return;
            try {
                // The revision its record reads at now, whatever of its rows is in flight: what they are read at.
                const at = kind.entries.type === "some" ? kind.entries.value.revision() : undefined;
                if (at?.type === "some") now.set(sort, at.value);
                const got = kind.rows();
                if (got.type === "some") rows[sort] = got.value;
                else inFlight.add(sort);
            } catch (error) {
                failures.set(sort, messageOf(error));
            }
        };
        take("states", value.states);
        take("transitions", getSomeorUndefined(value.transitions));
        take("lanes", getSomeorUndefined(value.lanes));
        take("decisions", getSomeorUndefined(value.decisions));

        // Under hide, the ends of the transitions kept that no state read holds: read by key through the states' source,
        // every such end in one request (D7). Found, the transition is hidden with it; absent, the end is a ghost.
        let hiddenWith: ReadonlySet<string> = NO_KEYS;
        const states = rows.states as FlowchartStored<FlowchartStateRoles> | undefined;
        const transitions = rows.transitions as FlowchartStored<FlowchartTransitionRoles> | undefined;
        const part = value.narrowed.type === "hide" ? sourcePart(chrome, "states") : undefined;
        if (part !== undefined && states !== undefined && transitions !== undefined) {
            const far = new SortedSet<string>([], compareString);
            for (const entry of transitions.values()) {
                if (!states.has(entry.roles.from)) far.add(entry.roles.from);
                if (!states.has(entry.roles.to)) far.add(entry.roles.to);
            }
            // Each end read back at the states' key type (#1549): a text no key of theirs prints as names no state, a ghost.
            const stateKeys = kindKeys(value.states.keyType);
            const asked = [...far].flatMap((text) => {
                const key = stateKeys.keyOf(text);
                return key === undefined ? [] : [{ text, key }];
            });
            if (asked.length > 0) {
                try {
                    const got = recordSliceRows(part, asked.map(({ key }) => key));
                    if (got.type === "none") inFlight.add("transitions");
                    else {
                        const held = new SortedSet<string>([], compareString);
                        got.value.forEach((row, i) => { if (row.type === "some") held.add(asked[i]!.text); });
                        if (held.size > 0) {
                            const hidden = new SortedSet<string>([], compareString);
                            for (const [key, entry] of transitions) {
                                if (held.has(entry.roles.from) || held.has(entry.roles.to)) hidden.add(key);
                            }
                            hiddenWith = hidden;
                        }
                    }
                } catch (error) {
                    failures.set("transitions", messageOf(error));
                }
            }
        }

        // The narrowing each kind read through its source was read under: what a new one is told from.
        const wheres = new Map<FlowchartSort, Where>();
        for (const sort of SOURCE_SORTS) {
            const source = sourcePart(chrome, sort);
            if (source !== undefined) wheres.set(sort, source.read().where);
        }
        return { rows, failures, inFlight, hiddenWith, wheres, now };
    }, [value, attempt]);
    const { result } = useTrackedEvaluation(read);

    // The last settled read, kept while a newer one is in flight: a kind whose read failed keeps what it held.
    const settled = useRef<{
        readonly held: FlowchartHeld; readonly hiddenWith: ReadonlySet<string>; readonly failures: ReadonlyMap<FlowchartSort, string>;
        readonly wheres: ReadonlyMap<FlowchartSort, Where>; readonly revisions: ReadonlyMap<FlowchartSort, string>;
    } | undefined>(undefined);
    if (result.ok && result.value.inFlight.size === 0) {
        const got = result.value;
        const was = settled.current;
        // A kind's rows read again as they were stay the same object — whatever payload read them, as they are told
        // apart by their bytes — and one whose read failed keeps what it held.
        const kept = <R>(sort: FlowchartSort, last: FlowchartStored<R> | undefined, given: boolean): FlowchartStored<R> | undefined => {
            if (!given) return undefined;
            const now = got.rows[sort] as FlowchartStored<R> | undefined;
            if (now === undefined) return last ?? (NO_ROWS as FlowchartStored<R>);
            return steady(last, now);
        };
        const held: FlowchartHeld = {
            states: kept("states", was?.held.states, true)!,
            transitions: kept("transitions", was?.held.transitions, value.transitions.type === "some"),
            lanes: kept("lanes", was?.held.lanes, value.lanes.type === "some"),
            decisions: kept("decisions", was?.held.decisions, value.decisions.type === "some"),
        };
        const same = was !== undefined && Object.is(was.held.states, held.states) && Object.is(was.held.transitions, held.transitions)
            && Object.is(was.held.lanes, held.lanes) && Object.is(was.held.decisions, held.decisions);
        settled.current = {
            held: same ? was.held : held,
            hiddenWith: was !== undefined && sameKeys(was.hiddenWith, got.hiddenWith) ? was.hiddenWith : got.hiddenWith,
            failures: was !== undefined && sameFailures(was.failures, got.failures) ? was.failures : got.failures.size === 0 ? NO_FAILURES : got.failures,
            wheres: got.wheres,
            // What every kind's rows were read at: the revisions this read found, each kind's rows landed at its own.
            revisions: was !== undefined && sameRevisions(was.revisions, got.now) ? was.revisions : got.now.size === 0 ? NO_REVISIONS : got.now,
        };
    }
    const last = settled.current;
    const loading = result.ok ? result.value.inFlight.size > 0 : false;
    const error = result.ok ? undefined : messageOf(result.error);
    // A kind's drawing read under a narrowing its source no longer holds stands in, kept, while the new one is read.
    const moved = (sort: FlowchartSort): boolean => {
        if (!result.ok || last === undefined) return false;
        const was = last.wheres.get(sort);
        const now = result.value.wheres.get(sort);
        return was !== undefined && now !== undefined && !sameWhere(was, now);
    };
    const filtering = result.ok && SOURCE_SORTS.some((sort) => moved(sort) && !result.value.failures.has(sort));
    const first = result.ok ? FLOWCHART_SORTS.find((sort) => result.value.inFlight.has(sort)) : undefined;
    const readingRef = useRef<FlowchartReading | undefined>(undefined);
    const readingNow: FlowchartReading | undefined = first === undefined ? undefined : { sort: first, filtering: moved(first) };
    const readingWas = readingRef.current;
    // The same object while it names the same kind the same way, so a page landing moves nothing.
    const reading = readingNow !== undefined && readingWas !== undefined && readingNow.sort === readingWas.sort && readingNow.filtering === readingWas.filtering
        ? readingWas : readingNow;
    readingRef.current = reading;
    // What the frame is handed: another object only as what it holds moves — a kind's rows, the transitions hidden with
    // their ends, a kind's failure — or what is read. The settled read is written afresh at every render, and the frame
    // taking what it is handed renders the reader again: handed a new object at every render, it would take one without end.
    const held = last?.held;
    const hiddenWith = last?.hiddenWith;
    const failures = last?.failures;
    const revisions = last?.revisions ?? NO_REVISIONS;
    // The revision each record reads at now — the latest read's, never the settled one's: the same object while it says the same.
    const nowRef = useRef<ReadonlyMap<FlowchartSort, string>>(NO_REVISIONS);
    const nowRead = result.ok ? result.value.now : NO_REVISIONS;
    const now = sameRevisions(nowRead, nowRef.current) ? nowRef.current : nowRead;
    nowRef.current = now;
    return useMemo((): FlowchartData => (held === undefined || hiddenWith === undefined || failures === undefined
        ? { ...INITIAL_FLOWCHART_DATA, loading: error === undefined, reading, error, now }
        : { ready: true, loading, reading, filtering, error, failures, held, hiddenWith, revisions, now }),
    [held, hiddenWith, failures, revisions, now, loading, reading, filtering, error]);
}

/**
 * The Flowchart's reads, in a component of its own (#1343, as the
 * Schematic's): each page that lands renders it again alone, and it hands the frame
 * what it read only when what the frame shows moves — once its own render is
 * done, so the frame draws it in a task of its own.
 *
 * @param props - The payload, the read's attempt, and where the data goes
 * @returns Nothing: it reads
 */
export function FlowchartDataReader({ value, attempt, onData }: {
    value: FlowchartValue; attempt: number; onData: (data: FlowchartData) => void;
}): null {
    const data = useFlowchartData(value, attempt);
    const reported = useRef<FlowchartData | undefined>(undefined);
    useEffect(() => {
        if (Object.is(reported.current, data)) return;
        reported.current = data;
        onData(data);
    });
    return null;
}
