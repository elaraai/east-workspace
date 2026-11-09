/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's message table: the editing session's words — the history
 * item's and its banners', every editable collection's (`EditingMessages`) —
 * what Search Records' line says of a person the rail's narrowing hides
 * (the shared hidden pick's words, `HiddenWords`), and why it refuses an
 * optimiser's answer at the week's edges (#1553). The app's nouns — a
 * shift's, a group's, a person's — are the payload's. English is the default;
 * the frame hands it to its parts as its words' `m`, as the Calendar's does.
 *
 * @packageDocumentation
 */

import { editingMessages, type EditingMessages, type Formatters } from "@elaraai/east-ui-components";
import { hiddenByText, type HiddenWords } from "../shared/schedule/words.js";

/**
 * Why the Roster refuses an answer of an optimiser that takes the week's edges (#1553): the banner's line, before its
 * `Nothing changed.` — each naming the duty as the landing does (`optimise.ts`' `rosterDutyName`), `unit` the period the
 * Roster publishes by.
 */
export interface RosterOptimiseWords {
    /** It changes or removes a duty whose period takes no edit — `Elara's answer removes N. Ochre · Sat Mar 4 Night · Inbound, in a week not available to edit.` */
    optimiseFixed: (p: { duty: string; removes: boolean; unit: "week" | "day" }) => string;
    /** It puts a duty in a period that takes no edit — `Elara's answer puts N. Ochre · Sun Mar 12 Night · Inbound in a week not available to edit.` */
    optimiseClosed: (p: { duty: string; unit: "week" | "day" }) => string;
    /** It puts a duty beyond the week and the weeks either side, whose periods the Roster has not read — `Elara's answer puts a duty starting Mon, Mar 27, 2028 beyond the weeks either side.` */
    optimiseBeyond: (p: { duty: string }) => string;
    /** It gives one key among both the week's duties and its edges — `Elara's answer gives N. Ochre · Sat Mar 4 Night · Inbound twice, among the week's duties and its edges.` */
    optimiseTwice: (p: { duty: string }) => string;
}

/** The Roster's message table. */
export interface RosterMessages extends EditingMessages, HiddenWords, RosterOptimiseWords {}

/** Where a period that takes no edit stands, as a refusal says it. */
const closedPeriod = (unit: "week" | "day") => unit === "day" ? "on a day not available to edit" : "in a week not available to edit";

/** The English table — the default. */
export const rosterMessages: RosterMessages = {
    ...editingMessages,
    hiddenByFilters: () => "hidden by the filters",
    hiddenBy: ({ filters, also }) => hiddenByText(filters, also),
    optimiseFixed: ({ duty, removes, unit }) => `Elara's answer ${removes ? "removes" : "changes"} ${duty}, ${closedPeriod(unit)}.`,
    optimiseClosed: ({ duty, unit }) => `Elara's answer puts ${duty} ${closedPeriod(unit)}.`,
    optimiseBeyond: ({ duty }) => `Elara's answer puts ${duty} beyond the weeks either side.`,
    optimiseTwice: ({ duty }) => `Elara's answer gives ${duty} twice, among the week's duties and its edges.`,
};

/** The words the Roster speaks: its message table, and its locale's formatters. */
export interface RosterWords extends Formatters {
    /** The message table in effect. */
    m: RosterMessages;
}
