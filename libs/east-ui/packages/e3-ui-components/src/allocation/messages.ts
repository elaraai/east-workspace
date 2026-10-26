/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's message table: the editing session's words — the history
 * item's and its banners', every editable collection's (`EditingMessages`) —
 * and the board's own that are no noun of the app's: what Search Records
 * searches, the bins' keys (#1398), and what a bin's Details call its key. The
 * app's nouns — a lane, an arrival, a resource, the quantity — are the
 * payload's (`nouns.ts`). English is the default; the frame hands it to its
 * parts as its words' `m`.
 *
 * @packageDocumentation
 */

import { editingMessages, type EditingMessages, type Formatters } from "@elaraai/east-ui-components";

/** The Allocation's message table. */
export interface AllocationMessages extends EditingMessages {
    /** Search Records' box's placeholder, its icon's accessible name and the head of the popover it opens: what it searches — `Search bins by key`. */
    keySearch: () => string;
    /**
     * What the box says when no bin's key matches what is typed, and where a key is learnt: in a bin's Details, given an
     * inspector; else that keys are case-sensitive.
     */
    keySearchNoMatches: (p: { inspector: boolean }) => string;
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
    binKey: () => "Key",
    reservation: () => "Reservation",
};

/** The words the board speaks: its message table, and its locale's formatters. */
export interface AllocationWords extends Formatters {
    /** The message table in effect. */
    m: AllocationMessages;
}
