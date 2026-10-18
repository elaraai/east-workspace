/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Library tab over a source of a builder's rail (#1339, #1340): the cards
 * the source shows, the tab's count (`12 of 69`), what the tab says when the
 * rail empties it, with Clear filters for that source alone, and its pane's
 * busy state while the source resolves. Every builder's tab that lists a
 * record's rows reads its source through this, so a filter narrows a tab as it
 * narrows the board.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import type { option, ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { LibraryEmpty, LibraryNarrowing } from "@elaraai/east-ui-components";
import { narrowedCount, type CountWords } from "@elaraai/east-ui-components/internal";
import type { KeyVisibility } from "./visibility.js";

/** What one source of the rail shows of a tab. */
export interface SourceShown {
    /** The keys that show: `none` while the source narrows nothing. */
    keys: option<Set<string>>;
    /** A new membership resolving, or the last read failed: the tab takes no gesture, as main takes none. */
    busy: boolean;
    /** Whether a complete membership has resolved: until it has, an empty tab says nothing of the filters. */
    ready: boolean;
    /** Clears the source's choices, the rail's other sources keeping theirs; `undefined` with no such source. */
    clear: (() => void) | undefined;
}

/**
 * A source's visibility as a tab reads it: the same object while the source's
 * membership, its state and its part stand, so a tab's cards are filtered again
 * only when what it shows changes.
 *
 * @param shown - The source's visibility (`useSourceVisibility`)
 * @param part - The source's part of the slice, whose Clear all clears it alone
 * @returns What the source shows of a tab
 */
export function useSourceShown(shown: KeyVisibility, part: ValueTypeOf<RecordSliceBindType> | undefined): SourceShown {
    const { keys, ready } = shown, busy = shown.loading || shown.error !== undefined;
    return useMemo(() => ({ keys, busy, ready, clear: part === undefined ? undefined : () => { part.clearAll(); } }), [keys, busy, ready, part]);
}

/** A tab over a source, as its Library and its pane take it. */
export interface SourceTab<C> {
    /** The cards the source shows, in their order. */
    cards: readonly C[];
    /** The tab's count: `12 of 69` while its source narrows, else the count alone. */
    count: string | number;
    /** While its source narrows: what the tab says when that leaves it no card, and its Clear filters. */
    narrowing: LibraryNarrowing | undefined;
    /** An empty tab's own words; none while its narrowing has not resolved (the rail's banner speaks for it). */
    empty: LibraryEmpty | undefined;
    /** The pane's attributes: busy, and taking no gesture, while its source resolves or after its read fails. */
    pane: { "aria-busy"?: true; inert?: true };
}

/**
 * A tab over a source (see the module docs).
 *
 * @param args - The tab's cards, each one's key in the source's record, what the source shows, the tab's plural noun as running text writes it, and the app's number formatter
 * @returns The cards it shows, its count, its narrowed and its own empty states, and its pane's attributes
 */
export function sourceTab<C>(args: {
    cards: readonly C[]; keyOf: (card: C) => string; shown: SourceShown; noun: string; words: CountWords;
}): SourceTab<C> {
    const { cards, keyOf, shown, noun, words } = args;
    const keys = shown.keys;
    const shownCards = keys.type === "none" ? cards : cards.filter(card => keys.value.has(keyOf(card)));
    const narrowing = keys.type === "none" || shown.clear === undefined || !shown.ready ? undefined
        : { empty: { title: `No ${noun} match the filters`, description: `Change or clear the filters to see more ${noun}.` }, onClear: shown.clear };
    return {
        cards: shownCards,
        count: narrowedCount(words, shownCards.length, cards.length, keys.type === "some"),
        narrowing,
        empty: keys.type === "some" && !shown.ready ? undefined : { title: `No ${noun}` },
        pane: shown.busy ? { "aria-busy": true, inert: true } : {},
    };
}
