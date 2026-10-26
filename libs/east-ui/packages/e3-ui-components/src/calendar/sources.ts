/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sources of the Calendar's slice, place by place (#1343). An event kind's
 * source narrows the kind's own reads, so its events in every layout and its
 * backlog follow it — what its choices hide of the backlog is the shared
 * `useBacklogNarrowing`'s (`shared/schedule/backlog.ts`, which the Plan reads
 * too); the Calendar follows the others itself — each resource kind's, whose
 * rows narrow the columns, the timeline's rows and the resource Choosers; each
 * templates list's, whose keys narrow the Templates tab; and each source an
 * app's tab names. Overlaps and checks read every event.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { KeyVisibilityWords } from "../shared/schedule/visibility.js";
import type { CalendarValue } from "./model.js";

const stringEqual = equalFor(StringType);

/**
 * The sources the Calendar follows beside its event kinds': each resource
 * kind's the slice holds, each templates list's and each one an app's tab
 * names — each once, in that order. A paged resource kind's source is followed
 * by none (#1424): it narrows the kind's windows themselves (`pages.ts`), so no
 * key of it is scanned.
 *
 * @param value - The payload
 * @returns The sources' names
 */
export function followedSources(value: CalendarValue): string[] {
    const parts = value.slice.type === "some" ? value.slice.value.slice.parts : [];
    const held = (name: string) => parts.some(part => stringEqual(part.source, name));
    const paged = (name: string) => value.paged.type === "some" && stringEqual(value.paged.value.kind, name);
    const named = [
        ...value.resources.map(kind => kind.key).filter(name => held(name) && !paged(name)),
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
