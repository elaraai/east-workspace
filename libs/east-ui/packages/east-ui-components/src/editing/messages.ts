/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing session's own words (#879) — the history bar's, and the
 * renderer's own draft issues'. Every editable collection's message table
 * carries them (the Sheet's `SheetMessages` extends {@link EditingMessages}),
 * so a host translates the history bar where it translates the collection, and
 * the bar speaks whatever words its collection hands it.
 *
 * Two kinds of text leave the renderer in canonical English, whatever the
 * viewer reads — the draft issues the patch events carry to the host, and the
 * session's own error — and are read back where they show
 * ({@link sessionErrorText}, the collection's issue text).
 *
 * @packageDocumentation
 */

import type { Formatters } from "../format/index.js";

/** The history bar's states that say something. */
export type EditHistoryWord = "stale" | "applying" | "unknown" | "reconciling" | "rejected" | "conflict";

/**
 * The editing session's message table — the history bar and the draft
 * issues.
 *
 * @remarks
 * `count` is a number already formatted for the locale; `n` is the raw number
 * beside it, for plural rules.
 */
export interface EditingMessages {
    /** The bar's status line. */
    historyStatus: (p: { status: EditHistoryWord }) => string;
    /** The issues button — `2 issues`. */
    issues: (p: { n: number; count: string }) => string;
    /** Its tooltip. */
    issuesTip: (p: { n: number; count: string }) => string;
    /** Undo. */
    undo: () => string;
    /** Undo's tooltip. */
    undoTip: () => string;
    /** Redo. */
    redo: () => string;
    /** Redo's tooltip. */
    redoTip: () => string;
    /** Discard. */
    discard: () => string;
    /** Discard's tooltip. */
    discardTip: () => string;
    /** Ask the source again for the confirmed revision. */
    retryRefresh: () => string;
    /** Send the same request again. */
    retryRequest: () => string;
    /** Apply. */
    apply: () => string;
    /** A source that applied a batch without its committed revision. */
    applyNoRevision: () => string;
    /** A field whose text could not be read. */
    issueInvalid: (p: { value: string }) => string;
    /** A draft field with no value. */
    issueRequired: () => string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The English table — the default every collection's table spreads. */
export const editingMessages: EditingMessages = {
    historyStatus: ({ status }) => {
        switch (status) {
            case "stale": return "Source changed — review or discard these drafts";
            case "applying": return "Applying changes…";
            case "unknown": return "Awaiting confirmation — retry the same request";
            case "reconciling": return "Applied — loading the confirmed revision…";
            case "rejected": return "Changes rejected — revise the draft before applying";
            case "conflict": return "Source conflict — review or discard these drafts";
        }
    },
    issues: ({ n, count }) => `${count} ${plural(n, "issue", "issues")}`,
    issuesTip: ({ n, count }) => `${count} ${plural(n, "issue", "issues")} · Go to first issue`,
    undo: () => "Undo",
    undoTip: () => "Undo · Ctrl+Z / ⌘Z",
    redo: () => "Redo",
    redoTip: () => "Redo · Ctrl+Shift+Z / ⌘⇧Z",
    discard: () => "Discard",
    discardTip: () => "Discard changes",
    retryRefresh: () => "Retry refresh",
    retryRequest: () => "Retry request",
    apply: () => "Apply changes",
    applyNoRevision: () => "The source applied the batch without its committed revision; recover this request before continuing",
    issueInvalid: ({ value }) => `Invalid input: ${value}`,
    issueRequired: () => "A value is required",
};

/** The words an editing surface speaks: a table carrying the editing messages, and its locale's formatters. */
export interface EditingWords extends Formatters {
    /** The message table in effect. */
    m: EditingMessages;
}

/**
 * The renderer's own draft issues, in their canonical English — the text the
 * patch events carry to the host, read back where they show.
 */
export const DRAFT_ISSUE_TEXT = {
    required: editingMessages.issueRequired(),
    invalid: (value: string): string => editingMessages.issueInvalid({ value }),
} as const;

/**
 * The editing session's own error text, in its canonical English — what the
 * session holds; the history bar shows it in the surface's words.
 */
export const SESSION_TEXT = {
    noRevision: editingMessages.applyNoRevision(),
} as const;

/**
 * The session's error as the history bar shows it: its own, in the surface's
 * words; a host's or a source's, as written.
 *
 * @param error - The session's error
 * @param w - The words
 * @returns The text to show
 */
export function sessionErrorText(error: string, w: EditingWords): string {
    return error === SESSION_TEXT.noRevision ? w.m.applyNoRevision() : error;
}
