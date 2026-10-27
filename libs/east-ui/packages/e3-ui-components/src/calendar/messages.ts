/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar's message table: the editing session's words — the history
 * item's and its banners', every editable collection's (`EditingMessages`) —
 * and the Calendar's own that are no noun of the app's: what Search Records
 * searches, the event kinds' keys (#1398) — its views name an event by its
 * title, which the box never finds it by — and what it says where no key
 * matches. The app's nouns — a kind's name, a resource kind's — are the
 * payload's. English is the default; the frame hands it to its parts as its
 * words' `m`, as the Allocation's does.
 *
 * @packageDocumentation
 */

import { editingMessages, type EditingMessages, type Formatters } from "@elaraai/east-ui-components";

/** The Calendar's message table. */
export interface CalendarMessages extends EditingMessages {
    /**
     * Search Records' box's placeholder, its icon's accessible name and the head of the popover it opens: what it searches
     * — `Search events by key`.
     */
    keySearch: () => string;
    /** What the box says when no event's key matches what is typed: that it finds an event by its key. */
    keySearchNoMatches: () => string;
}

/** The English table — the default. */
export const calendarMessages: CalendarMessages = {
    ...editingMessages,
    keySearch: () => "Search events by key",
    keySearchNoMatches: () => "No matching events. Search by an event's key.",
};

/** The words the Calendar speaks: its message table, and its locale's formatters. */
export interface CalendarWords extends Formatters {
    /** The message table in effect. */
    m: CalendarMessages;
}
