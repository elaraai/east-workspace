/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The sources of a Plan's one `Slice.bindRecords` (#1344), place by place:
 * the `rows` source gives the canvas its rows, paged from it; a source named
 * after an event kind narrows that kind's events and its backlog, its reads
 * the kind's own; a resource kind's narrows that kind's rows and Choosers; and
 * a templates list's and an author's tab's narrow those cards. Every source
 * holding a `range` of the axis's arm holds the window with the others, but
 * the canvas's rows' — the `rows` source and each resource kind's — which the
 * dates on screen never narrow.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import type { PlanPayloadType } from "@elaraai/e3-ui/internal";
import type { RecordSliceBindType, RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import type { PlanAxisKind } from "../instant.js";
import type { PlanRootValue } from "../model.js";

/** One record Slice's controls: a source's part of the slice. */
export type PlanSourcePart = ValueTypeOf<RecordSliceBindType>;

/** The rail's chrome, as the canvas's root carries it. */
export type PlanSlicesChrome = ValueTypeOf<RecordSlicesChromeType>;

/** One event kind, as the Plan's payload carries it. */
type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];

/** An event kind narrowed through its source of the slice: the kind, and its part. */
export interface PlanEventPart {
    /** The event kind. */
    readonly kind: PlanEventKindValue;
    /** Its source's part of the slice: the Slice its reads, its counts and its Save notice go through. */
    readonly part: PlanSourcePart;
}

/** The source of a Plan's slice that gives the canvas its rows. */
export const ROWS_SOURCE = "rows";

const stringEqual = equalFor(StringType);

/**
 * The rail's chrome, when the Plan has a slice.
 *
 * @param value - The canvas's root
 * @returns Its chrome; `undefined` with no slice
 */
export function planSlices(value: PlanRootValue): PlanSlicesChrome | undefined {
    return value.slice.type === "some" ? value.slice.value : undefined;
}

/**
 * One source's part of the slice, by its name.
 *
 * @param chrome - The rail's chrome; `undefined` with no slice
 * @param source - The source's name (`rows`, an event kind's slot)
 * @returns Its part; `undefined` when the slice has no source of that name
 */
export function planPart(chrome: PlanSlicesChrome | undefined, source: string): PlanSourcePart | undefined {
    return chrome?.slice.parts.find((part) => stringEqual(part.source, source))?.slice;
}

/**
 * The event kinds narrowed through their sources: each kind the slice names a
 * source after, in the kinds' order.
 *
 * @param chrome - The rail's chrome; `undefined` with no slice
 * @param kinds - The Plan's event kinds
 * @returns Each such kind and its part
 */
export function planEventParts(chrome: PlanSlicesChrome | undefined, kinds: readonly PlanEventKindValue[]): PlanEventPart[] {
    return kinds.flatMap((kind) => {
        const part = planPart(chrome, kind.key);
        return part === undefined ? [] : [{ kind, part }];
    });
}

/** The range field's kind the axis reads a window in: `datetime` on a time axis, a number on a number axis, none on an ordinal one. */
function fitsAxis(fieldKind: string, axis: PlanAxisKind): boolean {
    return axis === "time" ? stringEqual(fieldKind, "datetime") : axis === "number" && (stringEqual(fieldKind, "integer") || stringEqual(fieldKind, "float"));
}

/** The sources whose ranges never hold the window while a canvas names no others: its `rows` source. */
export const PLAN_ROW_SOURCES: readonly string[] = [ROWS_SOURCE];

/**
 * The sources whose ranges never hold the window (#1344): the canvas's rows —
 * the `rows` source's, and each resource kind's — which the dates on screen
 * never narrow, so a pan, a step, the brush or a key reads no row again. A
 * date field there is a field of the rail the viewer sets.
 *
 * @param resources - The Plan's resource kinds
 * @returns Their sources' names, the `rows` source's first
 */
export function planRowSources(resources: readonly PlanResourceKindValue[]): readonly string[] {
    return resources.length === 0 ? PLAN_ROW_SOURCES : [ROWS_SOURCE, ...resources.map((kind) => kind.key)];
}

/**
 * The sources holding the window: each part whose range field speaks the
 * axis's arm, in the slice's order — the first leads — but the canvas's
 * rows', whose ranges never hold it.
 *
 * @param chrome - The rail's chrome; `undefined` with no slice
 * @param axis - The axis kind
 * @param rows - The sources whose ranges never hold the window ({@link planRowSources}); the `rows` source alone when omitted
 * @returns Each such source's name and part
 */
export function planWindowParts(
    chrome: PlanSlicesChrome | undefined, axis: PlanAxisKind, rows: readonly string[] = PLAN_ROW_SOURCES,
): { readonly source: string; readonly part: PlanSourcePart }[] {
    if (chrome === undefined || axis === "ordinal") return [];
    return chrome.slice.parts.flatMap(({ source, slice }) => {
        if (rows.some((name) => stringEqual(name, source))) return [];
        const range = slice.config.range;
        if (range.type === "none") return [];
        const field = slice.config.fields.find((f) => stringEqual(f.fieldId, range.value));
        return field !== undefined && !field.set && fitsAxis(field.kind, axis) ? [{ source, part: slice }] : [];
    });
}

/** One resource kind, as the Plan's payload carries it. */
type PlanResourceKindValue = ValueTypeOf<typeof PlanPayloadType>["resources"][number];

/** One of the library's tabs, as the Plan's payload carries it. */
type PlanLibraryTabValue = ValueTypeOf<typeof PlanPayloadType>["library"][number];

/**
 * The sources the Plan's frame follows itself, beside the `rows` source and
 * the event kinds', which the canvas reads through their parts: each resource
 * kind's the slice holds, whose shown keys narrow its rows and its Choosers;
 * each templates list's, whose keys narrow the Events tab; and each an
 * author's tab names — each once, in that order.
 *
 * @param value - The Plan's payload
 * @returns The sources' names
 */
export function planFollowedSources(value: ValueTypeOf<typeof PlanPayloadType>): string[] {
    const parts = planSlices(value.plan)?.slice.parts ?? [];
    const held = (name: string) => parts.some((part) => stringEqual(part.source, name));
    const named = [
        ...value.resources.map((kind) => kind.key).filter(held),
        ...value.events.flatMap((kind) => (kind.templatesSource.type === "some" ? [kind.templatesSource.value] : [])),
        ...value.library.flatMap((tab) => (tab.type === "tab" && tab.value.source.type === "some" ? [tab.value.source.value] : [])),
    ];
    return named.filter((name, i) => named.findIndex((other) => stringEqual(other, name)) === i);
}

/**
 * What the rail counts each source in, and heads it with folded, where the
 * source has no label of its own: the canvas's rows, an event kind's events
 * (`print job events`), a kind's templates, a resource kind's name, a tab's —
 * each as running text writes it, the first that names a source keeping it.
 *
 * @param kinds - The Plan's event kinds
 * @param resources - Its resource kinds
 * @param tabs - Its library's tabs
 * @param locale - The app's locale
 * @returns Each source's noun, by its name
 */
export function planNouns(kinds: readonly PlanEventKindValue[], resources: readonly PlanResourceKindValue[], tabs: readonly PlanLibraryTabValue[], locale: string): Record<string, string> {
    const lower = (text: string) => text.toLocaleLowerCase(locale);
    const nouns: Record<string, string> = { [ROWS_SOURCE]: "rows" };
    for (const kind of kinds) nouns[kind.key] ??= `${lower(kind.name)} events`;
    for (const kind of kinds) if (kind.templatesSource.type === "some") nouns[kind.templatesSource.value] ??= `${lower(kind.name)} templates`;
    for (const kind of resources) nouns[kind.key] ??= lower(kind.name);
    for (const tab of tabs) if (tab.type === "tab" && tab.value.source.type === "some") nouns[tab.value.source.value] ??= lower(tab.value.name);
    return nouns;
}
