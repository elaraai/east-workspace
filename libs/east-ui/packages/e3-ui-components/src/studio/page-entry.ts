/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page of the pages record, read: the entry under a page's key, the layout
 * a page draws of it, and a placement's visual in a page's live version —
 * what the page, the builder and an alert's check (#1674) read a page by.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { StudioKeyType, type StudioEntryType, type StudioPageType, type StudioPagesType, type StudioVisualType } from "@elaraai/e3-ui/internal";

/** One entry of the pages record. */
type Entry = ValueTypeOf<typeof StudioEntryType>;
/** A page's key. */
type Key = ValueTypeOf<typeof StudioKeyType>;
/** One layout of a page: its title, its placements and its starting filters. */
type Layout = ValueTypeOf<typeof StudioPageType>;
/** A visual. */
type Visual = ValueTypeOf<typeof StudioVisualType>;

const keyEqual = equalFor(StudioKeyType);

/**
 * The entry the pages record holds under a page's key: found by the key's
 * value, since the record's key order is its own.
 *
 * @param pages - The pages record
 * @param key - The page's key
 * @returns The entry; `undefined` for a key the record holds none under
 */
export function entryOf(pages: ValueTypeOf<typeof StudioPagesType>, key: Key): Entry | undefined {
    for (const [at, found] of pages) {
        if (keyEqual(at, key)) return found;
    }
    return undefined;
}

/**
 * The layout of an entry a page draws: a template's own; a page's draft, or
 * its live version.
 *
 * @param entry - The entry
 * @param version - Which of a page's layouts is drawn
 * @returns The layout; `undefined` for a live version a page has not published
 */
export function layoutOf(entry: Entry, version: "live" | "draft"): Layout | undefined {
    // A template's layout is its draft, and it has no other.
    if (entry.kind.type === "template" || version === "draft") return entry.draft;
    return entry.live.type === "some" ? entry.live.value.page : undefined;
}

/**
 * The visual a placement holds in a page's live version: what an alert on it
 * checks (#1674).
 *
 * @param pages - The pages record
 * @param key - The page's key
 * @param cell - The placement's key
 * @returns The visual; `undefined` where the record holds no such page, it is
 *   not published, its live version has no such placement, or the placement
 *   holds no visual
 */
export function liveVisualOf(pages: ValueTypeOf<typeof StudioPagesType>, key: Key, cell: string): Visual | undefined {
    const entry = entryOf(pages, key);
    const layout = entry === undefined || entry.kind.type !== "page" ? undefined : layoutOf(entry, "live");
    const content = layout?.cells.find((held) => held.key === cell)?.content;
    return content?.type === "visual" ? content.value : undefined;
}
