/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The shared Library payload used by Schedule builder panes. */
import { none, some } from "@elaraai/east";
import type { LibraryItemValue, LibraryValue } from "@elaraai/east-ui-components";

/** A Schedule card with its standard face and no unrelated media/facets. */
export function scheduleLibraryCard(fields: Pick<LibraryItemValue, "key" | "label" | "sublabel" | "icon" | "status" | "trailing" | "draggable" | "filtered" | "placed" | "search" | "groups">): LibraryItemValue {
    return { ...fields, media: none, avatar: none, byline: none, action: none, facets: new Map(), dims: new Map() };
}
/** A pane's Library: filling its pane with shared search, grouping and cards. */
export function scheduleLibrary(fields: Pick<LibraryValue, "id" | "items" | "groupOptions" | "noun" | "onCardClick">, virtualize = false): LibraryValue {
    return {
        ...fields, hint: none, groupSummaries: new Map(), dimOptions: [], defaultDimensions: [], filterOptions: [], searchable: true,
        addLabel: none, onAdd: none, slice: none,
        style: some({ height: some("fill"), maxHeight: none, virtualization: some(virtualize), columns: none, mediaPlacement: none, mediaSize: none }),
        variant: none, layout: none, toolbar: true,
    };
}
/**
 * A Library tab's count while a narrowing may hide some of its cards (#1339):
 * `10 of 33` while it narrows, else the count alone, which the pane formats.
 *
 * @param words - The app's number formatter
 * @param shown - The cards the narrowing shows
 * @param total - Every card the tab would list
 * @param narrowing - Whether a narrowing is in force
 * @returns The tab's count
 */
export function narrowedCount(words: { number: (value: number) => string }, shown: number, total: number, narrowing: boolean): string | number {
    return narrowing ? `${words.number(shown)} of ${words.number(total)}` : total;
}
