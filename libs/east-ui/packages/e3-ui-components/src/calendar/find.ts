/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records (#1398): the Calendar toolbar's key search over its event
 * kinds' records by primary key — never a field search, which is the rail's,
 * and never what the grid draws. It is the shared key search's item over each
 * kind's own record, as the Schematic's Find seeks its kinds'.
 *
 * - **A kind narrowed through its source of the slice** is sought through e3
 *   with no narrowing: `recordSliceSeek` places the query's run in the
 *   record's own order, and `recordSlicePage` reads the rows a list shows by
 *   position, each read as an event by its key (the kind's `event`, its drafts
 *   in place).
 * - **A kind read whole** is sought in its events — every one its record
 *   holds, scheduled or in its backlog — their keys in East's order, as the
 *   server finds a key (`findKeyInline`).
 *
 * The matches are one list, each kind's run in its keys' order, the kinds in
 * the Calendar's order. A line names an event by its key, its title, its
 * kind's name and when it starts; a pick hands the frame the event
 * (`onPick`), which steps to its period, selects it and brings it into view,
 * and the box shows its key. The box asks its query again as a kind's record
 * moves — its revision, or a kind read whole's commits.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, compareFor, equalFor, none, toEastTypeValue, type EastTypeValue, type ValueTypeOf, type option } from "@elaraai/east";
import { findKeyInline, type DatasetKeyMatchRange, type DatasetKeyQuery, type RecordSliceBindType, type RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type Formatters, type KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked, recordSlicePage, recordSliceRevision, recordSliceSeek, toSeekQuery } from "@elaraai/east-ui-components/internal";
import { EMPTY_SCHEDULE_DRAFTS, type ScheduleEditing } from "../shared/schedule/editing.js";
import type { CalendarEventPart } from "./window.js";
import type { CalendarItem, CalendarKind, CalendarRange } from "./model.js";

/** An event's key is a String: the search's text parses against that. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);
const keyEqual = equalFor(StringType);
/** East's order of String keys. */
const compareKeys = compareFor(StringType);

/** No narrowing: a record's own rows, in its order. */
const WHOLE: ValueTypeOf<typeof RecordSliceWhereType> = new Map();
/** An empty box lists the first of the events every kind's record holds. */
const BROWSE_QUERY: DatasetKeyQuery = { prefix: "" };
/** The whole of time, for a kind read whole: every event its record holds. */
const EVER = { from: new Date(-8_640_000_000_000_000), to: new Date(8_640_000_000_000_000) };

/** A record Slice's part, as a kind's source of the slice. */
type RecordPart = ValueTypeOf<RecordSliceBindType>;
/** An entry of a record's window, as every record Slice binding reads one: its key — a kind's are Strings — and its row. */
interface RecordEntry { readonly key: string }

/** One kind's matches: a run of its record's rows, from `start`, or a kind read whole's events. */
interface FindRun {
    readonly kind: CalendarKind;
    /** Its source of the slice; `undefined` for a kind read whole. */
    readonly part: RecordPart | undefined;
    /** Where its matches start, in its record's own order: a kind read through its source. */
    readonly start: number;
    readonly count: number;
    /** A kind read whole's matches, in its keys' order. */
    readonly items: readonly CalendarItem[] | undefined;
}

/** An event Search Records found: the event, and its kind's name. */
export interface FoundEvent {
    readonly item: CalendarItem;
    readonly kind: string;
}

/**
 * How a found event reads in the list: its key, its title, its kind's name and when it starts — or that it waits in the backlog.
 *
 * @param found - The event
 * @param format - The app's formatters
 * @returns Its line
 */
export function foundEventLine(found: FoundEvent, format: Pick<Formatters, "weekdayDate" | "time">): string {
    const { item } = found;
    const when = item.start.type === "some" ? `${format.weekdayDate(item.start.value)} ${format.time(item.start.value)}` : "backlog";
    return [item.key, ...(keyEqual(item.title, item.key) ? [] : [item.title]), found.kind, when].join(" · ");
}

/**
 * The events of a kind read whole that a query finds, in East's order of their keys: as the server finds a key in a
 * record's own order (`findKeyInline`) — a key's start, a quoted key, a range.
 *
 * @param items - The kind's events, in any order
 * @param query - The query the box parsed
 * @returns The events it finds, in key order
 */
export function wholeEventMatches(items: readonly CalendarItem[], query: DatasetKeyQuery): CalendarItem[] {
    const byKey = new Map(items.map(item => [item.key, item] as const));
    const keys = [...byKey.keys()].sort(compareKeys);
    const range = findKeyInline(KEY_TYPE, keys, query);
    return range.found ? keys.slice(range.row, range.row + range.count).map(key => byKey.get(key)!) : [];
}

/** The runs a list's rows `[row, row + limit)` fall in: each kind's matches after the one before. */
function runsAt(runs: readonly FindRun[], row: number, limit: number): { run: FindRun; offset: number; n: number; at: number }[] {
    const out: { run: FindRun; offset: number; n: number; at: number }[] = [];
    let base = 0;
    for (const run of runs) {
        const from = Math.max(row, base), to = Math.min(row + limit, base + run.count);
        if (from < to) out.push({ run, offset: from - base, n: to - from, at: from });
        base += run.count;
    }
    return out;
}

/** Props of {@link useCalendarFind}. */
export interface CalendarFindProps {
    /** The event kinds, in the Calendar's order. */
    readonly kinds: readonly CalendarKind[];
    /** Each kind narrowed through its source of the slice. */
    readonly parts: readonly CalendarEventPart[];
    /** The editing whose drafts an event is read with; `undefined` for a read-only Calendar. */
    readonly editing: ScheduleEditing | undefined;
    /** The window the Calendar shows: what an event is read over, by key past it. */
    readonly range: CalendarRange;
    /** The app's formatters. */
    readonly format: Pick<Formatters, "weekdayDate" | "time">;
    /** Told the event a pick lands on. */
    readonly onPick: (found: FoundEvent) => void;
}

/**
 * Search Records' source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The kinds and their parts, the editing, the window, the words and the pick
 * @returns The source; `undefined` with no event kind to seek
 */
export function useCalendarFind({ kinds, parts, editing, range, format, onPick }: CalendarFindProps): KeySearchSource | undefined {
    const latest = useRef({ kinds, parts, editing, range, format, onPick });
    useLayoutEffect(() => { latest.current = { kinds, parts, editing, range, format, onPick }; });
    const partOf = useCallback((kind: CalendarKind) => latest.current.parts.find(p => keyEqual(p.kind.key, kind.key))?.part, []);
    const draftsOf = useCallback((kind: CalendarKind) => latest.current.editing?.drafts.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS, []);
    // What the last find found, each kind's run; a find answered after a newer one asked finds nothing here.
    const found = useRef<readonly FindRun[]>([]);
    const asked = useRef(0);
    const find = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        const mine = ++asked.current;
        const seek = toSeekQuery(query);
        const runs = await Promise.all(latest.current.kinds.flatMap((kind): Promise<FindRun>[] => {
            const part = partOf(kind);
            if (part !== undefined) {
                return [awaitTracked(() => recordSliceSeek(part, WHOLE, seek)).then((at): FindRun =>
                    ({ kind, part, start: at.found ? Number(at.row) : 0, count: at.found ? Number(at.count) : 0, items: undefined }))];
            }
            // A kind read a window at a time with no source of the slice has no index to seek: it lists nothing.
            if (kind.entries.type === "some") return [];
            const drafts = draftsOf(kind);
            return [Promise.all([awaitTracked(() => kind.items(EVER.from, EVER.to, drafts, none)),
                kind.backlog ? awaitTracked(() => kind.unscheduled(EVER.from, EVER.to, drafts, none)) : Promise.resolve([] as CalendarItem[])])
                .then(([scheduled, backlog]): FindRun => {
                    const items = wholeEventMatches([...scheduled, ...backlog], query);
                    return { kind, part: undefined, start: 0, count: items.length, items };
                })];
        }));
        if (mine === asked.current) found.current = runs;
        const count = runs.reduce((sum, run) => sum + run.count, 0);
        return { found: count > 0, row: 0, count };
    }, [partOf, draftsOf]);
    /** The matches at the list's rows `[row, row + limit)`, each with the row it is at. */
    const eventsAt = useCallback(async (row: number, limit: number): Promise<{ at: number; found: FoundEvent }[]> => {
        const parts = await Promise.all(runsAt(found.current, row, limit).map(async ({ run, offset, n, at }) => {
            if (run.items !== undefined) return run.items.slice(offset, offset + n).map((item, i) => ({ at: at + i, found: { item, kind: run.kind.name } }));
            const part = run.part!;
            const entries = await awaitTracked(() => recordSlicePage(part, WHOLE, BigInt(run.start + offset), BigInt(n))) as readonly RecordEntry[];
            const { range: window } = latest.current;
            const drafts = draftsOf(run.kind);
            const read = await Promise.all(entries.map(entry => awaitTracked(() => run.kind.event(entry.key, drafts, window.from, window.to, none))));
            return read.map((event, i) => ({ at: at + i, found: { item: event.item, kind: run.kind.name } }));
        }));
        return parts.flat();
    }, [draftsOf]);
    const listRange = useCallback(async (row: number, limit: number) => {
        const { format: words } = latest.current;
        // A pick shows the event's key in the box: what its query is typed against.
        return (await eventsAt(row, limit)).map(({ at, found: event }) => ({ row: at, label: foundEventLine(event, words), text: event.item.key }));
    }, [eventsAt]);
    const jump = useCallback((row: number) => {
        void eventsAt(row, 1).then(([hit]) => { if (hit !== undefined) latest.current.onPick(hit.found); })
            .catch((error: unknown) => { console.error("[Calendar] Search Records could not read the event it found:", error); });
    }, [eventsAt]);
    const clear = useCallback(() => { asked.current++; found.current = []; }, []);
    // The box asks its query again as what its lines are read from moves: each source's record's revision, each kind
    // read whole's commits — tracked, so a window the grid reads moves none of it.
    const readAnswers = useCallback(() => kinds.map((kind): string => {
        const part = parts.find(p => keyEqual(p.kind.key, kind.key))?.part;
        if (part !== undefined) return revisionOf(recordSliceRevision(part));
        const history = kind.history();
        return history.type === "some" ? `${history.value.length}:${history.value[0]?.at.getTime() ?? ""}` : "-";
    }).join("\n"), [kinds, parts]);
    const { result } = useTrackedEvaluation(readAnswers);
    const answers = result.ok ? result.value : "";
    const [requery, setRequery] = useState(0);
    const seen = useRef(answers);
    useEffect(() => {
        if (keyEqual(seen.current, answers)) return;
        seen.current = answers;
        setRequery(n => n + 1);
    }, [answers]);
    const any = kinds.length > 0;
    return useMemo(() => (any ? { resetKey: "calendar", requery, keyType: KEY_TYPE, find, listRange, jump, clear, browseQuery: BROWSE_QUERY,
        noMatchesText: "No matching events. Search by an event's key." } : undefined), [any, requery, find, listRange, jump, clear]);
}

/** A record's revision, as a token: `-` while it is not yet known. */
function revisionOf(revision: option<string>): string {
    return revision.type === "some" ? revision.value : "-";
}
