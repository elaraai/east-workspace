/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The field form's own words (#1147) — what it adds around the shared inputs:
 * an Option's Set and Clear, a reference's Unassigned, a number's help line, a
 * checklist's count. A builder's message table carries them (as the Sheet's
 * carries the editing session's), so a host translates the form where it
 * translates the builder, and hands the form its words.
 *
 * @packageDocumentation
 */

import type { Formatters } from "../../format/index.js";

/**
 * The field form's message table.
 *
 * @remarks
 * `label` is a field's label, the author's; `min`, `max`, `step`, `done` and
 * `total` are numbers already formatted for the locale.
 */
export interface FieldFormMessages {
    /** A reference's choice for no key, first in its select. */
    unassigned: () => string;
    /** An Option's choice for none, first in its select; what an empty Option shows. */
    notSet: () => string;
    /** The button that gives an empty Option a value. */
    set: () => string;
    /** The button that empties an Option — `Clear Crew`. */
    clear: (p: { label: string }) => string;
    /** An empty Option, printed. */
    noValue: () => string;
    /** A Boolean, printed. */
    yesNo: (p: { value: boolean }) => string;
    /** A number's help line — `1–20 people · step 1`. */
    numberHelp: (p: { min: string | undefined; max: string | undefined; unit: string | undefined; step: string | undefined }) => string;
    /** What the tags' box shows while empty. */
    tagPlaceholder: () => string;
    /** A checklist's items done of all — `2 / 5 done`. */
    checklistCount: (p: { done: string; total: string }) => string;
    /** The box an item is added in. */
    addItem: () => string;
    /** An item's remove control — `Remove Torque check`. */
    removeItem: (p: { text: string }) => string;
}

/** The English table — the default. */
export const fieldFormMessages: FieldFormMessages = {
    unassigned: () => "Unassigned",
    notSet: () => "Not set",
    set: () => "Set",
    clear: ({ label }) => `Clear ${label}`,
    noValue: () => "—",
    yesNo: ({ value }) => (value ? "Yes" : "No"),
    numberHelp: ({ min, max, unit, step }) => {
        const range = min !== undefined && max !== undefined ? `${min}–${max}`
            : min !== undefined ? `at least ${min}`
                : max !== undefined ? `at most ${max}` : undefined;
        const counted = range === undefined ? (unit === undefined ? undefined : `in ${unit}`) : unit === undefined ? range : `${range} ${unit}`;
        return [counted, step === undefined ? undefined : `step ${step}`].filter((part) => part !== undefined).join(" · ");
    },
    tagPlaceholder: () => "Add a tag",
    checklistCount: ({ done, total }) => `${done} / ${total} done`,
    addItem: () => "Add item ⏎",
    removeItem: ({ text }) => `Remove ${text}`,
};

/** The words a field form speaks: its message table, and its locale's formatters. */
export interface FieldFormWords extends Formatters {
    /** The message table in effect. */
    m: FieldFormMessages;
}
