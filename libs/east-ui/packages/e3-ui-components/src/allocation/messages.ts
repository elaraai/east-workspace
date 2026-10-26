/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's message table: the editing session's words — the history
 * item's and its banners', every editable collection's (`EditingMessages`) —
 * and the board's own that are no noun of the app's: what Search Records
 * searches, the bins' keys (#1398), what its line says of a bin the rail's
 * narrowing hides, and what a bin's Details call its key. The
 * app's nouns — a lane, an arrival, a resource, the quantity — are the
 * payload's (`nouns.ts`). English is the default; the frame hands it to its
 * parts as its words' `m`.
 *
 * @packageDocumentation
 */

import { editingMessages, type EditingMessages, type Formatters } from "@elaraai/east-ui-components";
import { hiddenByText } from "../shared/schedule/hidden.js";

/** The Allocation's message table. */
export interface AllocationMessages extends EditingMessages {
    /** Search Records' box's placeholder, its icon's accessible name and the head of the popover it opens: what it searches — `Search bins by key`. */
    keySearch: () => string;
    /**
     * What the box says when no bin's key matches what is typed, and where a key is learnt: in a bin's Details, given an
     * inspector; else that keys are case-sensitive.
     */
    keySearchNoMatches: (p: { inspector: boolean }) => string;
    /**
     * A bin the box lists that the rail's narrowing hides on the board, by its line — `3001 · LD-2201 · B-1 06:15 · Tue,
     * May 4, 2027 · hidden by the filters` — until e3 has said which choices hide it: a pick of it then clears every choice
     * of each source that hides it.
     */
    keySearchHidden: (p: { line: string }) => string;
    /**
     * The same bin once e3 has said which choices hide it — `… · hidden by Area: South — picking it clears that filter`:
     * a pick of it clears them and goes to the bin, every other choice kept. `filters` are those choices and `also` any
     * the pick clears with them, a choice that cannot stand without one of them — each as the rail words it.
     */
    keySearchHiddenBy: (p: { line: string; filters: readonly string[]; also: readonly string[] }) => string;
    /** The label of a bin's key among its facts in Details — `Key`: what Search Records finds it by. */
    binKey: () => string;
    /** The head of a reservation's own section in Details, over its key — `Reservation`. */
    reservation: () => string;
}

/** The English table — the default. */
export const allocationMessages: AllocationMessages = {
    ...editingMessages,
    keySearch: () => "Search bins by key",
    keySearchNoMatches: ({ inspector }) => (inspector ? "No bin's key matches. Select a bin to see its key in Details." : "No bin's key matches. Keys are case-sensitive."),
    keySearchHidden: ({ line }) => `${line} · hidden by the filters`,
    keySearchHiddenBy: ({ line, filters, also }) => `${line} · ${hiddenByText(filters, also)}`,
    binKey: () => "Key",
    reservation: () => "Reservation",
};

/** The words the board speaks: its message table, and its locale's formatters. */
export interface AllocationWords extends Formatters {
    /** The message table in effect. */
    m: AllocationMessages;
}
