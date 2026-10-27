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
 * kind's name and when it starts; one its kind's choices hide — its source's
 * narrowing but the window, which hides no event: a pick steps to it — says
 * which, as the rail words them, `· hidden by Status: Ready — picking it clears
 * that filter`, once e3 has said, `· hidden by the filters` until then (the
 * hidden pick, `hidden.tsx`): which of the events a list shows the choices
 * hide is asked of e3 over the page the list read them from
 * (`recordSliceWithinAt`), and which choices hide those, each read once at a
 * revision and a narrowing. Where the layout lays resources out — the
 * timeline's rows, the Resources view's columns — one whose resource its
 * resource kind's source hides says so too, that source's choices beside its
 * kind's own (`· hidden by Hall: Hall 2 — …`): the resources the source shows,
 * where the Calendar follows it, else which of them its narrowing holds, asked
 * of e3 by their keys, as the Allocation's bin is named by its resource's
 * source. A pick hands the frame the event (`onPick`), which clears what hides
 * it, steps to its period, selects it and brings it into view, and the box
 * shows its key. The box asks its query again as a kind's record moves — its
 * revision, or a kind read whole's commits — and lists its lines again as e3
 * says what hides an event, as a source's choices move, and as the layout
 * comes to lay resources out or leaves off.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, compareFor, equalFor, none, some, toEastTypeValue, type EastTypeValue, type ValueTypeOf, type option } from "@elaraai/east";
import { findKeyInline, type DatasetKeyMatchRange, type DatasetKeyQuery, type RecordSliceBindType, type RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type Formatters, type KeySearchSource } from "@elaraai/east-ui-components";
import {
    awaitTracked, recordSlicePage, recordSliceRevision, recordSliceRows, recordSliceSeek, recordSliceWithin, recordSliceWithinAt, toSeekQuery,
} from "@elaraai/east-ui-components/internal";
import { EMPTY_SCHEDULE_DRAFTS, heldRowOf, type ScheduleEditing, type ScheduleHeldRows } from "../shared/schedule/editing.js";
import { hiddenByText, hidingWords, type HiddenAnswer, type HidingWords } from "../shared/schedule/hidden.js";
import { hiddenVersion, type HiddenEvents, type KindHidden, type ResourceHidden } from "./hidden.js";
import type { CalendarEventPart } from "./window.js";
import type { CalendarItem, CalendarKind, CalendarRange, CalendarResource } from "./model.js";

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

/** What hides an event Search Records found: its kind's choices, its resource's source's, or both. */
export interface EventHiding {
    /** Its kind's choices hide it: what e3 said hides it — `undefined` until it has; absent where they show it. */
    readonly kind?: { readonly answer: HiddenAnswer | undefined } | undefined;
    /**
     * Its resource kind's source hides its resource, where the layout lays resources out: the kind's slot, and what e3
     * said hides the resource — `undefined` until it has; absent where it shows it.
     */
    readonly resource?: { readonly kind: string; readonly answer: HiddenAnswer | undefined } | undefined;
}

/** An event Search Records found: the event, its kind's name, and what hides it. */
export interface FoundEvent {
    readonly item: CalendarItem;
    readonly kind: string;
    /** What hides it; `undefined` for one nothing hides — its kind's choices, and its resource's source where it counts, show it. */
    readonly hidden: EventHiding | undefined;
}

/**
 * How a found event reads in the list: its key, its title, its kind's name and when it starts — or that it waits in the
 * backlog — and, one its kind's choices or its resource's source hide, what hides it.
 *
 * @param found - The event
 * @param format - The app's formatters
 * @param hiding - The choices that hide it and those a pick clears with them, as the rail words them, once e3 has said
 * @returns Its line
 */
export function foundEventLine(found: FoundEvent, format: Pick<Formatters, "weekdayDate" | "time">, hiding?: HidingWords): string {
    const { item } = found;
    const when = item.start.type === "some" ? `${format.weekdayDate(item.start.value)} ${format.time(item.start.value)}` : "backlog";
    const hidden = found.hidden === undefined ? [] : [hiding === undefined ? "hidden by the filters" : hiddenByText(hiding.filters, hiding.also)];
    return [item.key, ...(keyEqual(item.title, item.key) ? [] : [item.title]), found.kind, when, ...hidden].join(" · ");
}

/**
 * What hides an event its kind's choices leave out of the page the list read, as far as e3 has said.
 *
 * @param pick - Its kind's hidden pick
 * @param key - The event's key
 * @returns What hides it; `undefined` where e3 says the choices hold it — the list was read at another revision
 */
function hiddenOf(pick: KindHidden, key: string): EventHiding["kind"] {
    const state = pick.rows.stateOf(key);
    if (state !== undefined && !state.hidden) return undefined;
    return { answer: state?.hidden === true ? state.answer : undefined };
}

/**
 * The resource an event is drawn on where the layout lays resources out: its own, while it is scheduled — one waiting in
 * the backlog is a card of the Backlog, which narrows no event by its resource.
 *
 * @param item - The event
 * @returns Its resource; `undefined` for one with none, or one waiting in the backlog
 */
function laidOn(item: CalendarItem): CalendarResource | undefined {
    return item.start.type === "some" && item.resource.type === "some" ? item.resource.value : undefined;
}

/**
 * Which of some resources of a kind its source of the slice hides: by the resources the source shows, where the Calendar
 * follows it; else — the paged kind's, whose windows are its narrowing's rows themselves — as e3 says its narrowing holds
 * them, their rows read by their keys in one request and which of them the narrowing holds in one more.
 *
 * @param pick - The resource kind's hidden pick
 * @param keys - The resources' keys, each once
 * @returns The keys of those it hides
 */
async function hiddenResources(pick: ResourceHidden, keys: readonly string[]): Promise<readonly string[]> {
    const { shown, part, where } = pick;
    if (shown !== undefined) return shown.type === "some" ? keys.filter(key => !shown.value.has(key)) : [];
    if (part === undefined || where === undefined || where.size === 0) return [];
    return awaitTracked(() => {
        const rows = recordSliceRows(part, keys);
        if (rows.type === "none") return none;
        // A key the record holds no row by names no resource of it: nothing the source chooses hides it.
        const stored = keys.flatMap((key, i) => {
            const row = rows.value[i]!;
            return row.type === "some" ? [{ key, row: row.value }] : [];
        });
        const held = stored.length === 0 ? some<boolean[]>([]) : recordSliceWithin(part, where, stored);
        return held.type === "none" ? none : some(stored.flatMap(({ key }, i) => (held.value[i] ? [] : [key])));
    });
}

/**
 * The choices that hide a found event, and those a pick clears with them, as the rail words them — its kind's, then its
 * resource's source's — once e3 has said for each.
 *
 * @param found - The event
 * @param picks - Each kind's hidden pick
 * @param words - The app's formatters, which word a choice as the rail does
 * @returns The words; `undefined` while e3 has not said for each, or for an event nothing hides
 */
function eventHidingWords(found: FoundEvent, picks: HiddenEvents, words: Formatters): HidingWords | undefined {
    const { hidden } = found;
    if (hidden === undefined) return undefined;
    const said: HidingWords[] = [];
    if (hidden.kind !== undefined) {
        const pick = picks.kinds.get(found.item.kind);
        if (hidden.kind.answer === undefined || pick?.part === undefined) return undefined;
        said.push(hidingWords(pick.part.config.fields, pick.where ?? WHOLE, hidden.kind.answer, words));
    }
    if (hidden.resource !== undefined) {
        const pick = picks.resources.get(hidden.resource.kind);
        if (hidden.resource.answer === undefined || pick?.part === undefined) return undefined;
        said.push(hidingWords(pick.part.config.fields, pick.where ?? WHOLE, hidden.resource.answer, words));
    }
    return { filters: said.flatMap(w => w.filters), also: said.flatMap(w => w.also) };
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
    /** The app's formatters, which word a choice as the rail does. */
    readonly format: Formatters;
    /** Told the event a pick lands on. */
    readonly onPick: (found: FoundEvent) => void;
    /** The rows a kind read by its cells holds (#1424): a found event of such a kind is read from them, else by its key — never over the window. */
    readonly held?: ScheduleHeldRows | undefined;
    /** Each event kind's hidden pick and each resource kind's, by its slot: what e3 has said hides an event. */
    readonly hidden: HiddenEvents;
    /**
     * Whether the layout lays resources out — the timeline's rows, the Resources view's columns: there an event its
     * resource's source hides is hidden; the time grids, the month and the agenda narrow no event by its resource.
     */
    readonly laysResources: boolean;
}

/**
 * Search Records' source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The kinds and their parts, the editing, the window, the words, the pick, the hidden picks and the layout
 * @returns The source; `undefined` with no event kind to seek
 */
export function useCalendarFind({ kinds, parts, editing, range, format, onPick, held, hidden, laysResources }: CalendarFindProps): KeySearchSource | undefined {
    const latest = useRef({ kinds, parts, editing, range, format, onPick, held, hidden, laysResources });
    useLayoutEffect(() => { latest.current = { kinds, parts, editing, range, format, onPick, held, hidden, laysResources }; });
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
            if (run.items !== undefined) return run.items.slice(offset, offset + n).map((item, i): { at: number; found: FoundEvent } => ({ at: at + i, found: { item, kind: run.kind.name, hidden: undefined } }));
            const part = run.part!;
            const from = BigInt(run.start + offset);
            const entries = await awaitTracked(() => recordSlicePage(part, WHOLE, from, BigInt(n))) as readonly RecordEntry[];
            // Which of them the kind's choices hide, asked of e3 over the page just read — its narrowing but the window,
            // which hides no event — and which choices hide those (the hidden pick): nothing is asked with no choice.
            const pick = latest.current.hidden.kinds.get(run.kind.key);
            const where = pick?.where;
            const shown = where === undefined || where.size === 0 ? undefined : await awaitTracked(() => recordSliceWithinAt(part, where, from, BigInt(n)));
            if (pick !== undefined && shown !== undefined) pick.rows.askListed(Number(from), entries.map(entry => entry.key), shown);
            const { range: window, held } = latest.current;
            const drafts = draftsOf(run.kind);
            const read = await Promise.all(entries.map(entry => awaitTracked(() => run.kind.event(entry.key, drafts, window.from, window.to, heldRowOf(held, run.kind.key, entry.key)))));
            return read.map((event, i): { at: number; found: FoundEvent } => {
                const kind = pick === undefined || shown === undefined || shown[i] !== false ? undefined : hiddenOf(pick, entries[i]!.key);
                return { at: at + i, found: { item: event.item, kind: run.kind.name, hidden: kind === undefined ? undefined : { kind } } };
            });
        }));
        const listed = parts.flat();
        // Where the layout lays resources out, an event its resource's source hides is drawn nowhere: of the resources the
        // listed events stand on, those a source hides (`hiddenResources`), and which of its choices hide those, asked of
        // e3 a source at a time — the line saying so once e3 has said, as a kind's choices are named.
        const { hidden: picks, laysResources: lays } = latest.current;
        if (!lays) return listed;
        // The resources each source narrows that the listed events are drawn on, each once.
        const standing = new Map<string, string[]>();
        for (const { found: event } of listed) {
            const resource = laidOn(event.item);
            const where = resource === undefined ? undefined : picks.resources.get(resource.kind)?.where;
            if (resource === undefined || where === undefined || where.size === 0) continue;
            const keys = standing.get(resource.kind) ?? [];
            if (!keys.some(key => keyEqual(key, resource.key))) keys.push(resource.key);
            standing.set(resource.kind, keys);
        }
        if (standing.size === 0) return listed;
        const hides = new Map(await Promise.all([...standing].map(async ([kind, keys]) => {
            const pick = picks.resources.get(kind)!;
            const hidden = await hiddenResources(pick, keys);
            if (hidden.length > 0) pick.rows.askIds(hidden, true);
            return [kind, { pick, hidden }] as const;
        })));
        return listed.map(({ at, found: event }) => {
            const resource = laidOn(event.item);
            const hiding = resource === undefined ? undefined : hides.get(resource.kind);
            if (resource === undefined || hiding === undefined || !hiding.hidden.some(key => keyEqual(key, resource.key))) return { at, found: event };
            const state = hiding.pick.rows.stateOf(resource.key);
            // e3 says nothing of the source hides it — the record holds no resource by its key: no choice to clear.
            if (state !== undefined && !state.hidden) return { at, found: event };
            const answer = state?.hidden === true ? state.answer : undefined;
            return { at, found: { ...event, hidden: { ...event.hidden, resource: { kind: resource.kind, answer } } } };
        });
    }, [draftsOf]);
    const listRange = useCallback(async (row: number, limit: number) => {
        const listed = await eventsAt(row, limit);
        const { format: words, hidden: picks } = latest.current;
        // One its kind's choices, or its resource's source's, hide: the choices that do, as the rail words them, once e3
        // has said. A pick shows the event's key in the box: what its query is typed against.
        return listed.map(({ at, found: event }) => ({ row: at, label: foundEventLine(event, words, eventHidingWords(event, picks, words)), text: event.item.key }));
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
    // And lists its lines again as e3 says what hides an event, as a source's choices move, and as the layout comes to lay
    // resources out or leaves off.
    const laid = useRef({ lays: laysResources, moves: 0 });
    if (laid.current.lays !== laysResources) laid.current = { lays: laysResources, moves: laid.current.moves + 1 };
    const relist = hiddenVersion(hidden) + laid.current.moves;
    return useMemo(() => (any ? { resetKey: "calendar", requery, relist, keyType: KEY_TYPE, find, listRange, jump, clear, browseQuery: BROWSE_QUERY,
        noMatchesText: "No matching events. Search by an event's key." } : undefined), [any, requery, relist, find, listRange, jump, clear]);
}

/** A record's revision, as a token: `-` while it is not yet known. */
function revisionOf(revision: option<string>): string {
    return revision.type === "some" ? revision.value : "-";
}
