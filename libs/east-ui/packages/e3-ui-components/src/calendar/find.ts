/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records (#1398): the Calendar toolbar's key search over its event
 * kinds' records by primary key — never a field search, which is the rail's,
 * and never what the grid draws. It is every builder's Search Records
 * (`shared/schedule/search-records.ts`) over each kind's own record:
 *
 * - **A kind narrowed through its source of the slice** is sought through e3
 *   with no choice of the viewer's — on a page whose source holds a scope
 *   (#1621), among the scope's rows alone — each row a list shows read as an
 *   event by its key (the kind's `event`, its drafts in place).
 * - **A kind read whole** is sought in its events — every one its record
 *   holds, scheduled or in its backlog — their keys in East's order.
 *
 * The matches are one list, each kind's in its keys' order, the kinds in the
 * Calendar's order. A line names an event by its key, its title, its kind's
 * name and when it starts; one the rail's narrowing hides says so, as every
 * builder's does (the shared hidden pick, `shared/schedule/hidden.ts`), the
 * Calendar saying which of its sources hide it: its kind's — its choices,
 * never its window, which hides no event: a pick steps to it — and, where the
 * layout lays resources out — the timeline's rows, the Resources view's
 * columns — its resource kind's, that source's choices beside its kind's own
 * (`· hidden by Hall: Hall 2 — …`): the resources the source shows, where the
 * Calendar follows it, else which of them its narrowing holds, asked of e3 by
 * their keys. A pick hands the frame the event (`onPick`), which clears what
 * hides it, steps to its period, selects it and brings it into view, and the
 * box shows its key. The box asks its query again as a kind's record moves —
 * its revision, or a kind read whole's commits — and lists its lines again as
 * e3 says what hides an event, as a source's choices move, and as the layout
 * comes to lay resources out or leaves off.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { DateTimeType, StringType, equalFor, none, printFor, some, type option } from "@elaraai/east";
import type { KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked } from "@elaraai/east-ui-components/internal";
import { EMPTY_SCHEDULE_DRAFTS, heldRowOf, type ScheduleEditing, type ScheduleHeldRows } from "../shared/schedule/editing.js";
import { hiddenLine, type RowHidden, type RowHiding, type SourceHidden } from "../shared/schedule/hidden.js";
import type { HiddenPicks } from "../shared/schedule/hidden-pick.js";
import { STRING_KEYS } from "../shared/schedule/kind-keys.js";
import { rowsWithin, useSearchRecords, type SoughtSource } from "../shared/schedule/search-records.js";
import type { CalendarWords } from "./messages.js";
import type { CalendarEventPart } from "./window.js";
import type { CalendarItem, CalendarKind, CalendarRange, CalendarResource } from "./model.js";

const keyEqual = equalFor(StringType);
const printInstant = printFor(DateTimeType);

/** The whole of time, for a kind read whole: every event its record holds. */
const EVER = { from: new Date(-8_640_000_000_000_000), to: new Date(8_640_000_000_000_000) };

/** An event Search Records found: the event, its kind's name, and what hides it. */
export interface FoundEvent {
    readonly item: CalendarItem;
    readonly kind: string;
    /**
     * What hides it, as far as e3 has said: its kind's source, its choices leaving it out — and, where the layout lays
     * resources out, its resource kind's, hiding its resource; `undefined` for one nothing hides.
     */
    readonly hidden: readonly RowHidden[] | undefined;
}

/** An event as a list holds it: the event, and its kind's name. */
interface Listed {
    readonly item: CalendarItem;
    readonly kind: string;
}

/**
 * How a found event reads in the list: its key, its title, its kind's name and when it starts — or that it waits in the
 * backlog — and, one the rail's narrowing hides, what hides it, in the Calendar's words (the shared hidden pick).
 *
 * @param found - The event
 * @param words - The Calendar's words: the app's formatters, and its message table
 * @returns Its line
 */
export function foundEventLine(found: FoundEvent, words: CalendarWords): string {
    const { item } = found;
    const when = item.start.type === "some" ? `${words.weekdayDate(item.start.value)} ${words.time(item.start.value)}` : words.backlog ?? "backlog";
    const hidden = found.hidden === undefined ? [] : [hiddenLine(found.hidden, words, words.m)];
    return [item.key, ...(keyEqual(item.title, item.key) ? [] : [item.title]), found.kind, when, ...hidden].join(" · ");
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
 * them, asked by their keys (`rowsWithin`). A key the record holds no row by names no resource of it: nothing the source
 * chooses hides it.
 *
 * @param pick - The resource kind's hidden pick
 * @param shown - The resources its source shows, where the Calendar follows it — `none` while it narrows none; `undefined`
 *   for the paged kind
 * @param keys - The resources' keys, each once
 * @returns The keys of those it hides
 */
async function hiddenResources(pick: SourceHidden, shown: option<ReadonlySet<string>> | undefined, keys: readonly string[]): Promise<readonly string[]> {
    const { part, where } = pick;
    if (shown !== undefined) return shown.type === "some" ? keys.filter(key => !shown.value.has(key)) : [];
    if (part === undefined || where === undefined || where.size === 0) return [];
    const held = await awaitTracked(() => rowsWithin(part, where, keys));
    return keys.filter((key) => held.get(key) === false);
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
    /** The Calendar's words: the app's formatters, which word a choice as the rail does, and its message table — what the box says. */
    readonly format: CalendarWords;
    /** Told the event a pick lands on. */
    readonly onPick: (found: FoundEvent) => void;
    /** The rows a kind read by its cells holds (#1424): a found event of such a kind is read from them, else by its key — never over the window. */
    readonly held?: ScheduleHeldRows | undefined;
    /** Each event kind's hidden pick and each resource kind's, by its slot: what e3 has said hides an event. */
    readonly picks: HiddenPicks;
    /**
     * The resources each resource kind's source shows, by the kind's slot, where the Calendar follows the source — `none`
     * while it narrows none; the paged kind's absent, whose windows are its narrowing's rows themselves.
     */
    readonly resourcesShown: ReadonlyMap<string, option<ReadonlySet<string>>>;
    /**
     * Whether the layout lays resources out — the timeline's rows, the Resources view's columns: there an event its
     * resource's source hides is hidden; the time grids, the month and the agenda narrow no event by its resource.
     */
    readonly laysResources: boolean;
    /**
     * Each resource kind's name as running text writes it, by its slot: what a line says an event stands on where the
     * kind's source's page does not hold it (#1621) — `its crew is not on this page`.
     */
    readonly resourceWords: ReadonlyMap<string, string>;
}

/**
 * Search Records' source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The kinds and their parts, the editing, the window, the words, the pick, the hidden picks, what each
 *   resource kind's source shows, the layout and the resource kinds' names
 * @returns The source; `undefined` with no event kind to seek
 */
export function useCalendarFind({ kinds, parts, editing, range, format, onPick, held, picks, resourcesShown, laysResources, resourceWords }: CalendarFindProps): KeySearchSource | undefined {
    const latest = useRef({ editing, range, format, onPick, held, picks, resourcesShown, laysResources, resourceWords });
    useLayoutEffect(() => { latest.current = { editing, range, format, onPick, held, picks, resourcesShown, laysResources, resourceWords }; });
    const sources = useMemo(() => kinds.flatMap((kind): SoughtSource<Listed>[] => {
        const draftsOf = () => latest.current.editing?.drafts.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS;
        const part = parts.find(p => keyEqual(p.kind.key, kind.key))?.part;
        if (part !== undefined) {
            return [{
                part, keys: STRING_KEYS, pick: picks.get(kind.key),
                // Each row a list shows read as an event by its key, over the window the Calendar shows, its drafts in place.
                read: ({ id }) => {
                    const { range: window, held: cells } = latest.current;
                    const event = kind.event(id, draftsOf(), window.from, window.to, heldRowOf(cells, kind.key, id));
                    return event.type === "none" ? none : some(some({ item: event.value.item, kind: kind.name }));
                },
            }];
        }
        // A kind read a window at a time with no source of the slice has no index to seek: it lists nothing.
        if (kind.entries.type === "some") return [];
        return [{
            // Every event its record holds, scheduled or in its backlog.
            rows: () => {
                const drafts = draftsOf();
                const scheduled = kind.items(EVER.from, EVER.to, drafts, none);
                const backlog = kind.backlog ? kind.unscheduled(EVER.from, EVER.to, drafts, none) : some<CalendarItem[]>([]);
                if (scheduled.type === "none" || backlog.type === "none") return none;
                return some([...scheduled.value, ...backlog.value].map((item) => ({ item, kind: kind.name })));
            },
            idOf: (event) => event.item.key, keys: STRING_KEYS,
            // Its commits: what tells the box the events were read again.
            token: () => {
                const history = kind.history();
                const last = history.type === "some" ? history.value[0] : undefined;
                return history.type === "none" ? "-" : `${history.value.length}:${last === undefined ? "" : printInstant(last.at)}`;
            },
        }];
    }), [kinds, parts, picks]);
    return useSearchRecords({
        name: "Calendar", resetKey: "calendar", sources,
        // A pick shows the event's key in the box: what its query is typed against.
        line: ({ item, hidden }) => ({ label: foundEventLine({ ...item, hidden }, latest.current.format), text: item.item.key }),
        onPick: ({ item, hidden }) => { latest.current.onPick({ ...item, hidden }); },
        // Where no key matches, the box says it finds an event by its key — never by its title, which the views draw.
        noMatchesText: format.m.keySearchNoMatches(),
        // Where the layout lays resources out, an event its resource's source hides is drawn nowhere: of the resources the
        // listed events stand on, those a source hides, each standing on the event's resource there.
        hidings: async (events): Promise<readonly (readonly RowHiding[])[]> => {
            const { picks: sourcePicks, resourcesShown: shown, laysResources: lays, resourceWords: named } = latest.current;
            if (!lays) return events.map(() => []);
            // The resources each source narrows that the listed events are drawn on, each once.
            const standing = new Map<string, string[]>();
            for (const { item } of events) {
                const resource = laidOn(item);
                const where = resource === undefined ? undefined : sourcePicks.get(resource.kind)?.where;
                if (resource === undefined || where === undefined || where.size === 0) continue;
                const keys = standing.get(resource.kind) ?? [];
                if (!keys.some(key => keyEqual(key, resource.key))) keys.push(resource.key);
                standing.set(resource.kind, keys);
            }
            const hides = new Map(await Promise.all([...standing].map(async ([kind, keys]) => {
                const pick = sourcePicks.get(kind)!;
                return [kind, { pick, hidden: await hiddenResources(pick, shown.get(kind), keys) }] as const;
            })));
            return events.map(({ item }) => {
                const resource = laidOn(item);
                const hiding = resource === undefined ? undefined : hides.get(resource.kind);
                return resource === undefined || hiding === undefined || !hiding.hidden.some(key => keyEqual(key, resource.key)) ? []
                    : [{ pick: hiding.pick, id: resource.key, what: named.get(resource.kind) }];
            });
        },
        // And lists its lines again as e3 says what hides an event, as a source's choices move, as what a resource kind's
        // source shows moves, and as the layout comes to lay resources out or leaves off.
        relistBy: [...picks.values(), ...resourcesShown.values(), laysResources],
    });
}
