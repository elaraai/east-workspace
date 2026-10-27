/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's message table: the editing session's words — the history
 * item's and its banners', every editable collection's (`EditingMessages`) —
 * and what Search Records' line says of a person the rail's narrowing hides
 * (the shared hidden pick's words, `HiddenWords`). The app's nouns — a
 * shift's, a group's, a person's — are the payload's. English is the default;
 * the frame hands it to its parts as its words' `m`, as the Calendar's does.
 *
 * @packageDocumentation
 */

import { editingMessages, type EditingMessages, type Formatters } from "@elaraai/east-ui-components";
import { hiddenByText, type HiddenWords } from "../shared/schedule/words.js";

/** The Roster's message table. */
export interface RosterMessages extends EditingMessages, HiddenWords {}

/** The English table — the default. */
export const rosterMessages: RosterMessages = {
    ...editingMessages,
    hiddenByFilters: () => "hidden by the filters",
    hiddenBy: ({ filters, also }) => hiddenByText(filters, also),
};

/** The words the Roster speaks: its message table, and its locale's formatters. */
export interface RosterWords extends Formatters {
    /** The message table in effect. */
    m: RosterMessages;
}
