/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sources of the Calendar's slice, place by place (#1343). An event kind's
 * source narrows the kind's own reads, so its events in every layout and its
 * backlog follow it; the Calendar follows the others itself — each resource
 * kind's, whose rows narrow the columns, the timeline's rows and the resource
 * Choosers; each templates list's, whose keys narrow the Templates tab; and
 * each source an app's tab names. Overlaps and checks read every event.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { DateTimeType, OptionType, SortedMap, StringType, compareFor, equalFor, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceChoiceType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { useSlicesReactivity, useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { KeyVisibilityWords } from "../shared/schedule/visibility.js";
import type { CalendarEventPart } from "./window.js";
import type { CalendarValue } from "./model.js";

const stringEqual = equalFor(StringType);
const compareString = compareFor(StringType);
/** A backlog kind's start unset, as the record Slice writes the choice and its index keys it: the kind's backlog. */
const UNSET: ValueTypeOf<RecordSliceChoiceType> = variant("values", [printFor(OptionType(DateTimeType))(none)]);

/**
 * The sources the Calendar follows beside its event kinds': each resource
 * kind's the slice holds, each templates list's and each one an app's tab
 * names — each once, in that order.
 *
 * @param value - The payload
 * @returns The sources' names
 */
export function followedSources(value: CalendarValue): string[] {
    const parts = value.slice.type === "some" ? value.slice.value.slice.parts : [];
    const held = (name: string) => parts.some(part => stringEqual(part.source, name));
    const named = [
        ...value.resources.map(kind => kind.key).filter(held),
        ...value.events.flatMap(kind => kind.templatesSource.type === "some" ? [kind.templatesSource.value] : []),
        ...value.library.flatMap(tab => tab.type === "tab" && tab.value.source.type === "some" ? [tab.value.source.value] : []),
    ];
    return named.filter((name, i) => named.findIndex(other => stringEqual(other, name)) === i);
}

/**
 * What the rail counts each source in, and heads it with folded, where the
 * source has no label of its own: an event kind's events (`production
 * events`), a kind's templates, a resource kind's name, a tab's — each as
 * running text writes it, the first that names a source keeping it.
 *
 * @param value - The payload
 * @param locale - The app's locale
 * @returns Each source's noun, by its name
 */
export function calendarNouns(value: CalendarValue, locale: string): Record<string, string> {
    const lower = (text: string) => text.toLocaleLowerCase(locale);
    const nouns: Record<string, string> = {};
    for (const kind of value.events) nouns[kind.key] ??= `${lower(kind.name)} events`;
    for (const kind of value.events) if (kind.templatesSource.type === "some") nouns[kind.templatesSource.value] ??= `${lower(kind.name)} templates`;
    for (const kind of value.resources) nouns[kind.key] ??= lower(kind.name);
    for (const tab of value.library) if (tab.type === "tab" && tab.value.source.type === "some") nouns[tab.value.source.value] ??= lower(tab.value.name);
    return nouns;
}

/**
 * What a source's failed narrowing says, by its name.
 *
 * @param name - The source's name, as its banner says it
 * @returns Its results moved while read, or could not be read
 */
export function calendarSaid(name: string): KeyVisibilityWords {
    return { changed: `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)} results changed; retry the narrowing.`, failed: `Could not load ${name} results` };
}

/** What the rail hides of the backlog. */
export interface BacklogNarrowing {
    /** The backlog kinds whose source's choices — its window aside, which the backlog never reads — narrow their backlog. */
    readonly narrowing: readonly CalendarEventPart[];
    /** The stored unscheduled events those choices hide; `undefined` while a count is read, or none narrows. */
    readonly hidden: number | undefined;
    /** Clears those choices, each source keeping its window; `undefined` while none narrows. */
    readonly clear: (() => void) | undefined;
}

/** A source's choices but its start's: what narrows its backlog. */
function backlogWhere(where: ValueTypeOf<RecordSliceWhereType>, start: string): SortedMap<string, ValueTypeOf<RecordSliceChoiceType>> {
    const kept = new SortedMap([...where].filter(([field]) => !stringEqual(field, start)), compareString);
    kept.set(start, UNSET);
    return kept;
}

/**
 * What the rail hides of the backlog (#1343): each backlog kind's source
 * narrows its unscheduled events by its choices but its window, so the
 * Backlog tab counts `N of M` — what shows, beside the stored events those
 * choices hide, two index counts per kind — and clears those choices alone.
 *
 * @param eventParts - Each event kind narrowed through its source
 * @returns The narrowing kinds, what they hide and how they clear
 */
export function useBacklogNarrowing(eventParts: readonly CalendarEventPart[]): BacklogNarrowing {
    const parts = useMemo(() => eventParts.filter(({ kind }) => kind.backlog), [eventParts]);
    const version = useSlicesReactivity(parts.map(({ part }) => part.key));
    const narrowing = useMemo(() => parts.filter(({ kind, part }) => [...part.read().where.keys()].some(field => !stringEqual(field, kind.schedule.start))),
        // `version` moves with each source's choices.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [parts, version]);
    const read = useCallback(() => {
        let hidden = 0n;
        for (const { kind, part } of narrowing) {
            const start = kind.schedule.start;
            const all = part.countWhere(new SortedMap([[start, UNSET]], compareString));
            const shown = part.countWhere(backlogWhere(part.read().where, start));
            if (all.type === "none" || shown.type === "none") return none;
            hidden += all.value - shown.value;
        }
        return some(hidden);
    }, [narrowing]);
    const { result } = useTrackedEvaluation(read);
    const clear = useMemo(() => narrowing.length === 0 ? undefined : () => {
        for (const { kind, part } of narrowing) {
            const state = part.read();
            const window = new SortedMap([...state.where].filter(([field]) => stringEqual(field, kind.schedule.start)), compareString);
            part.write({ ...state, where: window, preset: none });
        }
    }, [narrowing]);
    const hidden = narrowing.length > 0 && result.ok && result.value.type === "some" ? Number(result.value.value) : undefined;
    return { narrowing, hidden, clear };
}
