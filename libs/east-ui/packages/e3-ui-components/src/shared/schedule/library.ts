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
export function scheduleLibrary(fields: Pick<LibraryValue, "id" | "items" | "groupOptions" | "noun" | "onCardClick">): LibraryValue {
    return {
        ...fields, hint: none, groupSummaries: new Map(), dimOptions: [], defaultDimensions: [], filterOptions: [], searchable: true,
        addLabel: none, onAdd: none, slice: none,
        style: some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none }),
        variant: none, layout: none, toolbar: true,
    };
}
